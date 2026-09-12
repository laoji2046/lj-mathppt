/**
 * PDF 导入：两条路，按实际情况自动选。
 *
 * - **text**：抽出文本层 → 重建行 / 段落 → Markdown → 走应用自己的 markdownToDeck。
 *   出的是**可编辑**的文字；但 PDF 里没有公式结构，公式会残（分式、根号、上下标会散掉甚至整块丢失），
 *   扫描件更是一个字都提不出来。
 * - **image**：整页渲染成图片，一页一张幻灯片。**公式、图形、扫描件全部保真**，代价是不可编辑。
 *
 * 分页口径与 Word 导入共用（packPages / lineWeight / isQuestionStart 都从 docxToMarkdown 引），
 * 两边各写一套的话，同一个文档换个入口进来分页就会不一样。
 */
import { loadPdfJs } from '@/composables/usePdf'
import { packPages, isQuestionStart } from '@/docx/docxToMarkdown'

export interface PdfProbe {
  pages: number
  pageW: number
  pageH: number
  /** 有多少页有文本层 */
  textPages: number
  /** 首页文本块数（判断扫描件的依据） */
  firstItems: number
  /** 各页文本块数 */
  items: number[]
  /** 各页图片数 */
  images: number[]
  /** 自动判断的默认模式 */
  mode: 'text' | 'image'
}
export interface PdfTextStats {
  pages: number
  chars: number
  questions: number
  columns: number
  /** 文本模式下没有带过来的插图数量 */
  skippedImages: number
  /** 识别出的页眉 / 页脚条数（已剔除，不写进正文） */
  headers: number
}
export interface PdfImageStats {
  pages: number
  /** 生成的图片总字节（估算 deck 体积） */
  bytes: number
  /** 其中按扫描件（JPEG）处理的页数 */
  scanned: number
}
export interface PdfOpts {
  from?: number
  to?: number
  fontPx?: number
  pagePx?: number
  /** 图片模式的目标宽度（px） */
  maxWidth?: number
  onProgress?: (done: number, total: number) => void
}

interface TI { str: string; x: number; y: number; w: number; h: number }
interface Row { y: number; h: number; x: number; x2: number; text: string }

async function withPdf<T>(data: Uint8Array, fn: (doc: any, lib: any) => Promise<T>): Promise<T> {
  const lib = await loadPdfJs()
  // 传进去的是同一块内存，pdf.js 会接管它 ⇒ 复制一份，免得调用方后面的读取拿到被改过的数据
  const doc = await lib.getDocument({ data: data.slice() }).promise
  try { return await fn(doc, lib) } finally { try { doc.destroy() } catch { /* 忽略 */ } }
}

function itemsOf(tc: any): TI[] {
  const out: TI[] = []
  for (const it of tc.items || []) {
    const s = it.str || ''
    if (!s.trim()) continue
    const t = it.transform || [1, 0, 0, 1, 0, 0]
    out.push({ str: s, x: t[4], y: t[5], w: it.width || 0, h: Math.abs(t[3]) || it.height || 10 })
  }
  return out
}

/** 分栏检测：中间有一条竖缝、两边都有足够内容 → 按两栏分别处理。混着读会把左右栏串成一行。 */
function splitColumns(items: TI[], pageW: number): TI[][] {
  const mid = pageW / 2
  const band = pageW * 0.05
  let cross = 0, left = 0, right = 0
  for (const it of items) {
    const c = it.x + it.w / 2
    if (c < mid - band) left++
    else if (c > mid + band) right++
    else cross++
  }
  const n = items.length
  if (n > 40 && cross <= Math.max(2, n * 0.03) && left > n * 0.25 && right > n * 0.25) {
    return [items.filter((i) => i.x + i.w / 2 < mid), items.filter((i) => i.x + i.w / 2 >= mid)]
  }
  return [items]
}

/** 按 y 聚成行：容差按行高走，这样上下标（y 不同、字号小）会并进它所属的那一行 */
function rowsOf(items: TI[]): Row[] {
  const arr = items.slice().sort((a, b) => b.y - a.y || a.x - b.x)
  const rows: Row[] = []
  let cur: TI[] = []
  let baseY = 0, lineH = 0
  const flush = () => {
    if (!cur.length) return
    const s = cur.slice().sort((a, b) => a.x - b.x)
    let text = ''
    let end = -1e9
    let size = 0
    for (const it of s) {
      size = Math.max(size, it.h)
      if (end > -1e8 && it.x - end > size * 0.3) text += ' '
      text += it.str
      end = Math.max(end, it.x + it.w)
    }
    const x0 = s[0].x
    const x1 = Math.max(...s.map((i) => i.x + i.w))
    rows.push({ y: baseY, h: lineH, x: x0, x2: x1, text: text.replace(/[ \t]+/g, ' ').trim() })
    cur = []
  }
  for (const it of arr) {
    if (!cur.length) { cur = [it]; baseY = it.y; lineH = it.h; continue }
    if (Math.abs(it.y - baseY) <= Math.max(2, lineH * 0.55)) { cur.push(it); lineH = Math.max(lineH, it.h) }
    else { flush(); cur = [it]; baseY = it.y; lineH = it.h }
  }
  flush()
  return rows.filter((r) => r.text)
}

/** 页边重复文本的归一化键：去掉空白与数字，这样"第 557 页"和"第 558 页"算同一条 */
function normEdge(t: string): string {
  return t.replace(/[ \t]+/g, '').replace(/[0-9０-９]+/g, '#').slice(0, 32)
}
/** 纯页码行（"第 557 页 共 1043 页" / "557 / 1043" / "- 12 -"） */
function isPageNumberLine(t: string): boolean {
  const s = t.trim()
  if (!s || s.length > 24) return false
  return /^[-—–\s]*第?\s*\d{1,4}\s*页?(\s*[/·共]\s*\d{1,4}\s*页?)?[-—–\s]*$/.test(s) ||
    /^\d{1,4}\s*\/\s*\d{1,4}$/.test(s)
}

/** PDF 里的题号比 Word 杂：'12.' 之外还有 '2895 (2024·全国·高三专题练习)' 这种四位数编号 */
function isQuestionStartPdf(t: string): boolean {
  if (isQuestionStart(t)) return true
  return /^\d{3,4}\s*[（(【\[]?\s*20\d\d/.test(t.trim())
}

/** 可能是标题的行：短、居中、字号明显大于正文 */
function headingLevel(r: Row, medH: number, box: { x0: number; x1: number }): number {
  const t = r.text.trim()
  if (t.length > 26 || t.length < 2) return 0
  if (r.h < medH * 1.15) return 0
  const c = (r.x + r.x2) / 2
  const mid = (box.x0 + box.x1) / 2
  const halfW = (box.x1 - box.x0) / 2
  if (Math.abs(c - mid) > halfW * 0.16) return 0
  return r.h >= medH * 1.5 ? 1 : 2
}

/** 一行行排成 Markdown：空行 = 块的分界（应用的导入器按空行分块，一块 = 一个元素框） */
function rowsToMarkdown(rows: Row[], box: { x0: number; x1: number }, stats: PdfTextStats): string[] {
  const out: string[] = []
  if (!rows.length) return out
  const hs = rows.map((r) => r.h).sort((a, b) => a - b)
  const medH = hs[hs.length >> 1] || 10
  let prev: Row | null = null
  let qLast = 0
  for (const r of rows) {
    if (/^\d{1,4}\s*$/.test(r.text)) continue          // 孤零零的页码
    let blank = false
    let level = 0
    if (prev) {
      const gap = prev.y - r.y - Math.max(prev.h, r.h) * 0.92
      if (gap > medH * 0.85) blank = true
    }
    if (isQuestionStartPdf(r.text)) {
      const m = r.text.match(/^(\d{1,4})/)
      const n = m ? parseInt(m[1], 10) : 0
      // 题号是**连续**的才认；但第一道题必须无条件开个头（讲义里的题号动辄 2895 起，
      // 按"和上一个差 ≤ 8"去卡的话，永远开不了头，题数会一直是 0）
      if (qLast === 0 || (n > qLast && n - qLast <= 8)) { qLast = n; stats.questions++ }
      blank = true
    }
    level = headingLevel(r, medH, box)
    if (level) blank = true
    if (blank && out.length && out[out.length - 1] !== '') out.push('')
    out.push(level ? '#'.repeat(level) + ' ' + r.text : r.text)
    prev = r
  }
  while (out.length && out[out.length - 1] === '') out.pop()
  return out
}

/** 先探一遍：页数、每页文本块/图片数、默认模式 */
export async function probePdf(data: Uint8Array): Promise<PdfProbe> {
  return withPdf(data, async (doc, lib) => {
    const pages = doc.numPages
    const items: number[] = []
    const images: number[] = []
    let pageW = 595, pageH = 842
    let textPages = 0
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p)
      if (p === 1) { const vp = page.getViewport({ scale: 1 }); pageW = vp.width; pageH = vp.height }
      const tc = await page.getTextContent()
      const n = (tc.items || []).filter((i: any) => (i.str || '').trim()).length
      items.push(n)
      if (n >= 20) textPages++
      let imgs = 0
      try {
        const ops = await page.getOperatorList()
        imgs = ops.fnArray.filter((f: number) => f === lib.OPS.paintImageXObject || f === lib.OPS.paintJpegXObject).length
      } catch { /* 有些页拿不到算子表，忽略 */ }
      images.push(imgs)
      page.cleanup?.()
    }
    const firstItems = items[0] || 0
    return {
      pages, pageW, pageH, textPages, firstItems, items, images,
      mode: firstItems >= 20 ? 'text' : 'image',
    }
  })
}

/** 文本模式：逐页抽文本 → Markdown */
export async function pdfToMarkdown(data: Uint8Array, opts: PdfOpts = {}): Promise<{ markdown: string; stats: PdfTextStats }> {
  const fontPx = opts.fontPx ?? 22
  const pagePx = opts.pagePx ?? 900
  const stats: PdfTextStats = { pages: 0, chars: 0, questions: 0, columns: 0, skippedImages: 0, headers: 0 }
  return withPdf(data, async (doc, lib) => {
    const total = doc.numPages
    const from = Math.max(1, opts.from ?? 1)
    const to = Math.min(total, opts.to ?? total)
    const lines: string[] = []
    /** 逐页先收集（页眉页脚要跨页统计才知道哪些是重复的），最后统一成 Markdown */
    const pages: ({ rows: Row[]; box: { x0: number; x1: number } | null } | null)[] = []
    for (let p = from; p <= to; p++) {
      const page = await doc.getPage(p)
      const vp = page.getViewport({ scale: 1 })
      const tc = await page.getTextContent()
      const items = itemsOf(tc)
      stats.pages++
      stats.chars += items.reduce((n, i) => n + i.str.length, 0)
      try {
        const ops = await page.getOperatorList()
        stats.skippedImages += ops.fnArray.filter((f: number) => f === lib.OPS.paintImageXObject || f === lib.OPS.paintJpegXObject).length
      } catch { /* 忽略 */ }
      page.cleanup?.()
      opts.onProgress?.(p - from + 1, to - from + 1)
      if (!items.length) { pages.push(null); continue }
      const cols = splitColumns(items, vp.width)
      if (cols.length > 1) stats.columns++
      const rows: Row[] = []
      const boxes: { x0: number; x1: number }[] = []
      for (const col of cols) {
        const rs = rowsOf(col)
        if (!rs.length) continue
        boxes.push({ x0: Math.min(...rs.map((r) => r.x)), x1: Math.max(...rs.map((r) => r.x2)) })
        rows.push(...rs)
      }
      pages.push({ rows, box: boxes.length === 1 ? boxes[0] : null })
    }
    // 页眉 / 页脚：**每页都在**且位置在页边的那一两行（讲义书名、页码、"第 557 页 共 1043 页"）。
    // 不去掉的话，每一张幻灯片头上都会挂着一遍书名，正文里还夹着页码。
    const pageCount = pages.length
    const tally = new Map<string, number>()
    for (const pg of pages) {
      if (!pg || !pg.rows.length) continue
      const edge = [...pg.rows.slice(0, 2), ...pg.rows.slice(-2)]
      const uniq = new Set<string>()
      for (const r of edge) {
        const k = normEdge(r.text)
        if (k && !uniq.has(k)) { uniq.add(k); tally.set(k, (tally.get(k) || 0) + 1) }
      }
    }
    const noise = new Set<string>()
    for (const [k, n] of tally) if (n >= Math.max(3, pageCount * 0.5)) noise.add(k)
    stats.headers = noise.size
    for (const pg of pages) {
      if (!pg || !pg.rows.length) continue
      const keep: Row[] = []
      pg.rows.forEach((r, i) => {
        const atEdge = i < 2 || i >= pg.rows.length - 2
        if (atEdge && noise.has(normEdge(r.text))) return
        if (isPageNumberLine(r.text)) return
        keep.push(r)
      })
      if (!keep.length) continue
      const md = rowsToMarkdown(keep, pg.box || { x0: 0, x1: 9999 }, stats)
      if (!md.length) continue
      if (lines.length && lines[lines.length - 1] !== '') lines.push('')
      lines.push(...md)
    }
    const packed = packPages(lines, pagePx, fontPx)
    return { markdown: '<!--font:' + fontPx + '-->\n' + packed.join('\n'), stats }
  })
}

/** 图片模式：逐页渲染成图片，一页一张幻灯片（公式 / 图形 / 扫描件都保真） */
export async function pdfToDeck(data: Uint8Array, opts: PdfOpts = {}): Promise<{ deck: any; stats: PdfImageStats }> {
  const maxWidth = opts.maxWidth ?? 1400
  const stats: PdfImageStats = { pages: 0, bytes: 0, scanned: 0 }
  return withPdf(data, async (doc, lib) => {
    const total = doc.numPages
    const from = Math.max(1, opts.from ?? 1)
    const to = Math.min(total, opts.to ?? total)
    const slides: any[] = []
    for (let p = from; p <= to; p++) {
      const page = await doc.getPage(p)
      const v1 = page.getViewport({ scale: 1 })
      const nText = (await page.getTextContent()).items.filter((i: any) => (i.str || '').trim()).length
      let bigImg = 0
      try {
        const ops = await page.getOperatorList()
        bigImg = ops.fnArray.filter((f: number) => f === lib.OPS.paintImageXObject || f === lib.OPS.paintJpegXObject).length
      } catch { /* 忽略 */ }
      const scale = Math.min(3, maxWidth / v1.width)
      const vp = page.getViewport({ scale })
      const cv = document.createElement('canvas')
      cv.width = Math.max(1, Math.round(vp.width))
      cv.height = Math.max(1, Math.round(vp.height))
      const ctx = cv.getContext('2d')
      if (!ctx) throw new Error('无法创建画布上下文')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, cv.width, cv.height)
      await page.render({ canvasContext: ctx, viewport: vp }).promise
      // 扫描件本来就是位图，转 JPEG 体积小一个数量级；有文本层的页面用 PNG，字才不糊
      const scanned = nText < 20 && bigImg >= 1
      if (scanned) stats.scanned++
      const url = scanned ? cv.toDataURL('image/jpeg', 0.86) : cv.toDataURL('image/png')
      stats.pages++
      stats.bytes += Math.round(url.length * 0.75)
      // 铺满画布：高占 940，宽度按页面宽高比，超宽再回收
      let h = 940
      let w = Math.round((h * vp.width) / vp.height)
      if (w > 1560) { w = 1560; h = Math.round((w * vp.height) / vp.width) }
      slides.push({
        id: 'pdf-' + p + '-' + Math.random().toString(36).slice(2, 8),
        bg: '#ffffff',
        elements: [{
          id: 'pdfimg-' + p + '-' + Math.random().toString(36).slice(2, 8),
          type: 'image',
          x: Math.round((1920 - w) / 2),
          y: Math.round((1080 - h) / 2),
          w, h, rot: 0,
          src: url,
          fit: 'contain',
        }],
      })
      page.cleanup?.()
      opts.onProgress?.(p - from + 1, to - from + 1)
    }
    return { deck: { version: 1, current: 0, slides }, stats }
  })
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}
