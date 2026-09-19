/**
 * content_list.json → 正文文本（**含双栏重排**）
 *
 * 为什么需要：MinerU 给的是"版面块 + bbox" ✓，但 **full.md 是纯文本** ✗ ——
 * 双栏卷里块的顺序常常是"左1 右1 左2 右2"（按识别顺序），直接拼起来题干会串行 ✗。
 * 这里用 bbox 的 x 中心做**列检测**：一页里 x 中心有明显断层 → 分左右栏 → 先左后右 ✓
 *
 * 纯函数、不依赖 Tauri → 可以对着真 content_list 单测 ✓
 */

/** content_list 里的一个块（只取我们用得到的字段） */
export interface ContentBlock {
  type?: string
  text?: string
  img_path?: string
  table_body?: string
  bbox?: number[]
  /** 图片的**图注**（以前被丢掉，题图就没 caption 了 ✗） */
  image_caption?: string
  image_footnote?: string
  page_idx?: number
}

/** 需要**整块丢掉**的类型（页眉页脚页码不是题目 ✓） */
const DROP = new Set(['header', 'footer', 'page_number'])
/** 参与"列检测"的类型（图片/表格也占版面，但用文字块判列更稳） */
const TEXTY = new Set(['text', 'equation'])

const bboxOf = (b: ContentBlock): [number, number, number, number] => {
  const a = b.bbox || []
  return [Number(a[0]) || 0, Number(a[1]) || 0, Number(a[2]) || 0, Number(a[3]) || 0]
}
const cx = (b: ContentBlock) => { const [x0, , x1] = bboxOf(b); return (x0 + x1) / 2 }

/**
 * 按"页内列"重排块。规则：
 * 1) 先按 `page_idx` 分页（没有就按原顺序一页）✓
 * 2) 每页取文字块的 x 中心：**最大间隙**明显（> 页宽的 22%）且两侧都占 ≥30% → 判为双栏 ✓
 * 3) 双栏：先左栏（按 y 再 x）后右栏；单栏：只按 y 排 ✓
 * ⚠ 宁可判成单栏（保守），也不要误拆 —— 误拆会把题切碎 ✗
 */
export function reorderBlocks(blocks: ContentBlock[]): ContentBlock[] {
  const keep = blocks.filter((b) => !DROP.has(String(b.type || '')))
  const pages = new Map<number, ContentBlock[]>()
  keep.forEach((b, i) => {
    const p = Number.isFinite(Number(b.page_idx)) ? Number(b.page_idx) : 0
    if (!pages.has(p)) pages.set(p, [])
    pages.get(p)!.push({ ...b, __i: i } as ContentBlock & { __i: number })
  })
  const out: ContentBlock[] = []
  for (const p of Array.from(pages.keys()).sort((a, b) => a - b)) {
    const arr = pages.get(p)!
    const texts = arr.filter((b) => TEXTY.has(String(b.type || '')))
    const xs = arr.map(bboxOf)
    const x0 = Math.min(...xs.map((v) => v[0]))
    const x1 = Math.max(...xs.map((v) => v[2]))
    const pageW = Math.max(1, x1 - x0)
    let left: ContentBlock[] = []
    let right: ContentBlock[] = []
    if (texts.length >= 4) {
      const cxs = texts.map(cx).sort((a, b) => a - b)
      let gap = 0, at = -1
      for (let i = 1; i < cxs.length; i++) {
        const g = cxs[i] - cxs[i - 1]
        if (g > gap) { gap = g; at = i }
      }
      if (at > 0 && gap > pageW * 0.22) {
        const split = (cxs[at - 1] + cxs[at]) / 2
        const L = arr.filter((b) => cx(b) < split)
        const R = arr.filter((b) => cx(b) >= split)
        if (L.length >= arr.length * 0.3 && R.length >= arr.length * 0.3) { left = L; right = R }
      }
    }
    const byY = (a: ContentBlock, b: ContentBlock) => {
      const A = bboxOf(a), B = bboxOf(b)
      return A[1] - B[1] || A[0] - B[0] || ((a as any).__i - (b as any).__i)
    }
    if (left.length && right.length) out.push(...left.sort(byY), ...right.sort(byY))
    else out.push(...arr.sort(byY))
  }
  return out
}

/** 组装成"一行一块"的正文（跳页眉页脚、图片合成为 ![](path)、表格给 HTML/表格体交给 stripHtml） */
export function assembleContentDoc(rawJson: string): string {
  let arr: ContentBlock[] = []
  try { const v = JSON.parse(rawJson); if (Array.isArray(v)) arr = v as ContentBlock[] } catch { return '' }
  if (!arr.length) return ''
  let out = ''
  for (const b of reorderBlocks(arr)) {
    const ty = String(b.type || '')
    // 【v1453】把 MinerU 的**图注**写进 alt（以前是空 alt，图注就丢了；题库的 caption 正是靠它 ✓）
    if (ty === 'image') {
      const p = String(b.img_path || '')
      if (p) {
        const cap = String(b.image_caption || '').replace(/[[\]]/g, ' ').replace(/\s+/g, ' ').trim()
        out += '![' + cap + '](' + p + ')\n'
      }
      continue
    }
    const t = String(b.text || b.table_body || '')
    if (t) out += t + '\n'
    // 【v1451 修】表格 / 公式块**没有可用文本**但带了图（MinerU 常把图形判成 table、把公式裁成图）：
    //   必须把图放进来 —— 否则这块的图既不在正文、也绑不到题上，**静默丢失** ✗
    if (!t && (ty === 'table' || ty === 'equation')) {
      const p = String(b.img_path || '')
      if (p) out += '![](' + p + ')\n'
    }
  }
  return out
}
/** 【v1453】图片在原文里的几何位置：path → { page, y }（按「同页 + y」归属到题，比字符偏移稳 ✓） */
export function imagePositions(rawJson: string): Record<string, { page: number; y: number }> {
  const out: Record<string, { page: number; y: number }> = {}
  let arr: ContentBlock[] = []
  try { const v = JSON.parse(rawJson); if (Array.isArray(v)) arr = v as ContentBlock[] } catch { return out }
  for (const b of arr) {
    const p = String((b && b.img_path) || '')
    if (!p) continue
    const bb = Array.isArray(b.bbox) ? b.bbox : []
    out[p] = { page: Number(b.page_idx) || 0, y: Number(bb[1]) || 0 }
  }
  return out
}

/** 【v1453】正文块的几何位置（与 assembleContentDoc **同一顺序**）：给「这张图落在哪道题之后」用 ✓ */
export function blockGeometry(rawJson: string): { head: string; page: number; y: number }[] {
  let arr: ContentBlock[] = []
  try { const v = JSON.parse(rawJson); if (Array.isArray(v)) arr = v as ContentBlock[] } catch { return [] }
  const out: { head: string; page: number; y: number }[] = []
  for (const b of reorderBlocks(arr)) {
    const t = String(b.text || b.table_body || '').replace(/\s+/g, ' ').trim()
    if (!t) continue
    const bb = Array.isArray(b.bbox) ? b.bbox : []
    out.push({ head: t.slice(0, 12), page: Number(b.page_idx) || 0, y: Number(bb[1]) || 0 })
  }
  return out
}
