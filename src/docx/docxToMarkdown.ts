/**
 * .docx → Markdown（应用内导入用）。
 *
 * 设计要点：
 * - **块模型**：一道题（题干 + 选项 + 图）合成「一个块」，对应应用里的**一个元素框** —— 不再半句一页。
 * - **按块装箱分页**：一个块整体放进当前页，放不下才换页 → 一页常装 2~3 题，且题目不会被拦腰截断。
 * - **图片内嵌 data URL**：粘进来就能显示，不受相对路径影响。
 * - 字号线（<!--font:N-->）写在首行，应用的导入器认它，保证「分页估算」与「实际排版」同字号。
 */
import { listEntries, readEntry, readText, type ZipEntry } from './zip'
import { parseXml, kids, first, type XmlNode } from './xml'
import { ommlToLatex } from './omml'

export interface DocxStats {
  paragraphs: number
  formulas: number
  images: number
  tables: number
  pageBreaks: number
  /** MathType / OLE 对象公式的个数：这类公式是嵌入对象，读不到内容（不是 Word 原生公式） */
  oleFormulas: number
}
export interface DocxOptions {
  /** 正文字号（默认 22：比手动排版小一点，一页能装更多） */
  fontPx?: number
  /** 每页像素预算（画布高 1080，默认 900） */
  pagePx?: number
  /** 分组方式：auto=标题与题号成块；question=只有题号成块；heading=只有标题成块；line=不分组 */
  group?: 'auto' | 'question' | 'heading' | 'line'
}
export interface DocxResult { markdown: string; stats: DocxStats }

const TEXT_W = 1620
const CJK = /[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/

/** 估算一段文字的高度 —— 口径必须与 src/types 的 estimateTextHeight 一致，否则分页会估错 */
export function textHeight(text: string, fontSize: number, lineHeight = 1.55): number {
  const perLine = Math.max(8, TEXT_W / fontSize)
  const marked = text.replace(/\$[^$]*\$/g, (m) => '\u0001'.repeat(Math.max(2, Math.round((m.length - 2) * 0.5))))
  let units = 0
  let lines = 1
  for (const ch of marked) {
    const w = ch === '\u0001' ? 1 : CJK.test(ch) ? 1 : 0.55
    units += w
    if (units > perLine) { lines++; units = w }
  }
  return Math.round(lines * fontSize * lineHeight) + 12
}
function lineWeight(line: string, fontPx: number): number {
  const t = line.trim()
  if (!t) return 0
  if (t.startsWith('![')) return 540
  if (t.startsWith('$$')) return 160
  if (/^#{1,6} /.test(t)) {
    const lv = t.match(/^#+/)![0].length
    const fs = lv === 1 ? 48 : lv === 2 ? 40 : 32
    return textHeight(t.replace(/^#+ /, ''), fs, 1.3) + 20
  }
  return textHeight(t, fontPx) + 20
}
function isQuestionStart(line: string): boolean {
  return /^[0-9]{1,3}\s*[.、．]/.test(line.trim())
}
function isHeadingLine(line: string): boolean {
  return /^#{1,6} /.test(line)
}

/** 字节 → data URL（分块 base64，避免大图撑爆调用栈） */
function dataUrlOf(bytes: Uint8Array, name: string): string {
  const ext = (name.split('.').pop() || 'png').toLowerCase()
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : 'image/png'
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return 'data:' + mime + ';base64,' + btoa(bin)
}

interface Ctx {
  rels: Record<string, string>
  entries: Map<string, ZipEntry>
  buf: Uint8Array
  stats: DocxStats
}

/** 一个段落 → 若干 Markdown 行（图片独占一行；其余行合成一个块） */
async function paragraph(p: XmlNode, ctx: Ctx): Promise<string[] | null> {
  const pPr = kids(p).find((k) => k.name === 'w:pPr')
  let style = ''
  let outline = ''
  if (pPr) {
    const ps = kids(pPr).find((k) => k.name === 'w:pStyle')
    if (ps) style = ps.attrs['w:val'] || ''
    const ol = kids(pPr).find((k) => k.name === 'w:outlineLvl')
    if (ol) outline = ol.attrs['w:val'] || ''
  }
  type Item = { t: 'text' | 'math' | 'img'; v: string; vert?: string }
  const items: Item[] = []
  let bold = true
  let maxSz = 0
  let sawText = false

  const eatRun = async (r: XmlNode) => {
    const rPr = kids(r).find((k) => k.name === 'w:rPr')
    let rBold = false
    let vert = ''
    if (rPr) {
      rBold = kids(rPr).some((k) => k.name === 'w:b' || k.name === 'w:bCs')
      const va = kids(rPr).find((k) => k.name === 'w:vertAlign')
      if (va) vert = va.attrs['w:val'] || ''
      const sz = kids(rPr).find((k) => k.name === 'w:sz')
      if (sz) maxSz = Math.max(maxSz, parseInt(sz.attrs['w:val'] || '0', 10) / 2)
    }
    if (!rBold) bold = false
    for (const k of kids(r)) {
      if (k.name === 'w:t') {
        const s = textOfNode(k)
        if (s.trim()) sawText = true
        items.push({ t: 'text', v: s, vert })
      } else if (k.name === 'w:tab') items.push({ t: 'text', v: '    ' })
      else if (k.name === 'w:br') {
        if (k.attrs['w:type'] === 'page') items.push({ t: 'text', v: '\u0000PAGE' })
        else items.push({ t: 'text', v: '\n' })
      } else if (k.name === 'w:object') {
        // MathType / 老式公式编辑器：公式是嵌入的 OLE 对象（word/embeddings/*.bin），
        // 文本层读不到内容，预览图又是 wmf/emf（浏览器不认）——只能计数并提示用户先在 Word 里转换
        ctx.stats.oleFormulas++
      } else if (k.name === 'w:drawing' || k.name === 'w:pict') {
        const blip = first(k, 'a:blip')
        const rid = blip && (blip.attrs['r:embed'] || blip.attrs['r:link'])
        const target = rid ? ctx.rels[rid] : ''
        const entry = target ? ctx.entries.get(target) : undefined
        if (entry) {
          const bytes = await readEntry(ctx.buf, entry)
          ctx.stats.images++
          items.push({ t: 'img', v: dataUrlOf(bytes, entry.name) })
          sawText = true
        }
      }
    }
  }
  const eat = async (node: XmlNode) => {
    for (const k of kids(node)) {
      if (k.name === 'w:r') await eatRun(k)
      else if (k.name === 'm:oMath') {
        const latex = ommlToLatex(k)
        if (latex) { ctx.stats.formulas++; items.push({ t: 'math', v: latex }); sawText = true }
      } else if (k.name === 'm:oMathPara') {
        const latex = ommlToLatex(k)
        if (latex) { ctx.stats.formulas++; items.push({ t: 'math', v: latex }); sawText = true }
      } else if (k.name === 'w:hyperlink' || k.name === 'w:ins' || k.name === 'w:smartTag' || k.name === 'w:sdt' || k.name === 'w:sdtContent') await eat(k)
    }
  }
  await eat(p)
  if (!sawText) return null

  // 上标 / 下标 run 与前一个字符合成数学（Word 里 x² 常常只是「上标格式的 run」）
  const merged: Item[] = []
  for (const it of items) {
    if (it.t === 'text' && it.vert) {
      const mark = it.vert === 'superscript' ? '^' : '_'
      const val = it.v.trim()
      if (!val) continue
      const prev = merged[merged.length - 1]
      if (prev && prev.t === 'text' && prev.v.length) {
        const base = prev.v.slice(-1)
        prev.v = prev.v.slice(0, -1)
        merged.push({ t: 'math', v: base + mark + '{' + val + '}' })
      } else if (prev && prev.t === 'math') {
        merged.pop()
        merged.push({ t: 'math', v: '{' + prev.v + '}' + mark + '{' + val + '}' })
      } else merged.push({ t: 'math', v: mark + '{' + val + '}' })
      continue
    }
    merged.push(it)
  }
  // 相邻公式合并成一个 $…$：否则会拼出连续两个美元符，被应用当成显示公式、把该行剩下的文字整段吃掉
  const squashed: Item[] = []
  for (const it of merged) {
    if (it.t === 'text' && it.v === '') continue      // 只丢**真正为空**的 run（制表位转成的空格要留）
    const prev = squashed[squashed.length - 1]
    if (it.t === 'math' && prev && prev.t === 'math') { prev.v += it.v; continue }
    squashed.push({ ...it })
  }

  const onlyMath = squashed.length > 0 && squashed.every((it) => it.t === 'math')
  const lines: string[] = []
  if (onlyMath) {
    for (const it of squashed) lines.push('$$' + it.v + '$$')
  } else {
    let cur = ''
    const textLines: string[] = []
    for (const it of squashed) {
      if (it.t === 'text') cur += it.v
      else if (it.t === 'math') cur += '$' + it.v + '$'
      else if (it.t === 'img') {
        if (cur.trim()) textLines.push(cur.trim())
        cur = ''
        textLines.push('![](' + it.v + ')')
      }
    }
    if (cur.trim()) textLines.push(cur.trim())
    const lvl = headingLevel(style, outline, bold, maxSz, textLines.find((l) => !l.startsWith('![')) || '')
    for (const b of textLines) {
      if (b.startsWith('![')) { lines.push(b); continue }
      lines.push((lvl ? '#'.repeat(lvl) + ' ' : '') + b)
    }
  }
  // 段落里的手动分页 → 页面分隔（--- 是应用的横向分页符）
  const out: string[] = []
  for (const l of lines) {
    if (l.includes('\u0000PAGE')) {
      const part = l.replace('\u0000PAGE', '').trim()
      if (part) out.push(part)
      out.push('---')
      ctx.stats.pageBreaks++
    } else out.push(l)
  }
  ctx.stats.paragraphs++
  return out.length ? out : null
}

function textOfNode(n: XmlNode): string {
  let s = ''
  for (const k of n.kids) s += typeof k === 'string' ? k : textOfNode(k)
  return s
}

/** 标题判定：显式样式 → 大纲级别 → 「一、」这类编号 → 整段加粗且更大 */
function headingLevel(style: string, outline: string, bold: boolean, maxSz: number, text: string): number {
  const s = (style || '').toLowerCase()
  const m = s.match(/heading\s*([1-6])/)
  if (m && m[1]) return Math.min(3, parseInt(m[1], 10))
  if (outline !== '') {
    const lv = parseInt(outline, 10)
    if (Number.isFinite(lv) && lv <= 2) return lv + 1
  }
  const t = text.trim()
  if (/^[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341]+\u3001/.test(t) && t.length < 30) return 2
  if (bold && maxSz >= 16 && t.length < 34) return 2
  return 0
}

/** 表格 → 「单元格 | 单元格」的行（应用的 Markdown 模型没有表格语法，这样至少内容不丢） */
function tableLines(tbl: XmlNode): string[] {
  const out: string[] = []
  for (const tr of kids(tbl, 'w:tr')) {
    const cells: string[] = []
    for (const tc of kids(tr, 'w:tc')) {
      const parts: string[] = []
      for (const p of kids(tc, 'w:p')) {
        let s = ''
        for (const r of kids(p, 'w:r')) {
          for (const k of kids(r)) {
            if (k.name === 'w:t') s += textOfNode(k)
            else if (k.name === 'w:tab') s += '    '
          }
        }
        if (s.trim()) parts.push(s.trim())
      }
      cells.push(parts.join(' '))
    }
    if (cells.some((c) => c)) out.push(cells.join(' | '))
  }
  return out
}

/** 按块装箱分页：一个块整体放进当前页，放不下才换页 */
function packPages(lines: string[], budgetPx: number, fontPx: number): string[] {
  const items: { kind: 'block' | 'blank' | 'page'; lines?: string[]; weight?: number }[] = []
  let cur: string[] = []
  const flushCur = () => {
    if (!cur.length) return
    items.push({ kind: 'block', lines: cur, weight: cur.reduce((n, l) => n + lineWeight(l, fontPx), 0) })
    cur = []
  }
  for (const line of lines) {
    if (line === '---') { flushCur(); items.push({ kind: 'page' }); continue }
    if (!line.trim()) { flushCur(); items.push({ kind: 'blank' }); continue }
    cur.push(line)
  }
  flushCur()
  const out: string[] = []
  let used = 0
  let has = false
  const newPage = () => { out.push('---'); used = 0; has = false }
  for (const it of items) {
    if (it.kind === 'page') { newPage(); continue }
    if (it.kind === 'blank') { out.push(''); continue }
    // 超长块（比如一整道解析题）单独一页也装不下：**按行拆**，拆到下一页去。
    // 不拆的话应用会把它压到最小字号（14px）还是溢出画布 —— 实测这类越界能有几十个元素。
    if ((it.weight || 0) > budgetPx) {
      let acc = 0
      for (const line of it.lines || []) {
        const w = lineWeight(line, fontPx)
        if (has && acc + w > budgetPx) { newPage(); acc = 0 }
        out.push(line)
        acc += w
        used = acc
        has = true
      }
      continue
    }
    if (has && used + (it.weight || 0) > budgetPx) newPage()
    out.push(...(it.lines || []))
    used += it.weight || 0
    has = true
  }
  return out
}

export async function docxToMarkdown(buf: Uint8Array, opts: DocxOptions = {}): Promise<DocxResult> {
  const fontPx = opts.fontPx ?? 22
  const pagePx = opts.pagePx ?? 900
  const group = opts.group ?? 'auto'
  const entries = listEntries(buf)
  const relsXml = await readText(buf, 'word/_rels/document.xml.rels')
  const docXml = await readText(buf, 'word/document.xml')
  if (!docXml) throw new Error('这不是 .docx 文件（里面没有 word/document.xml）。老的 .doc 请先用 Word 另存为 .docx。')
  const rels: Record<string, string> = {}
  if (relsXml) {
    for (const m of relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      const t = m[2].replace(/^\.\//, '')
      rels[m[1]] = t.startsWith('media/') ? 'word/' + t : t
    }
  }
  const doc = parseXml(docXml)
  const body = first(doc, 'w:body')
  if (!body) throw new Error('document.xml 里没有 w:body')
  const stats: DocxStats = { paragraphs: 0, formulas: 0, images: 0, tables: 0, pageBreaks: 0, oleFormulas: 0 }
  const ctx: Ctx = { rels, entries: new Map(entries.map((e) => [e.name, e])), buf, stats }

  const content: string[] = []
  const qState = { lastQ: 0 }
  const needBreak = (head: string): boolean => {
    if (group === 'line') return false
    if (isHeadingLine(head)) return true
    if (group === 'heading') return false
    if (isQuestionStart(head)) {
      const n = parseInt(head.trim().match(/^([0-9]{1,3})/)![1], 10)
      if (n > qState.lastQ && n - qState.lastQ <= 6) { qState.lastQ = n; return true }
    }
    return false
  }
  for (const b of kids(body)) {
    if (b.name === 'w:p') {
      const lines = await paragraph(b, ctx)
      if (!lines) continue
      if (needBreak(lines[0] || '') && content.length && content[content.length - 1].trim() !== '') content.push('')
      content.push(...lines)
    } else if (b.name === 'w:tbl') {
      stats.tables++
      const t = tableLines(b)
      if (t.length) { if (content.length && content[content.length - 1].trim() !== '') content.push(''); content.push(...t) }
    } else if (b.name === 'w:sectPr') {
      content.push('---')
      stats.pageBreaks++
    }
  }
  // 收尾：连续空行压成一个
  const cleaned: string[] = []
  for (const l of content) {
    if (!l.trim() && (!cleaned.length || !cleaned[cleaned.length - 1].trim())) continue
    cleaned.push(l)
  }
  while (cleaned.length && !cleaned[0].trim()) cleaned.shift()
  while (cleaned.length && !cleaned[cleaned.length - 1].trim()) cleaned.pop()

  const paged = packPages(cleaned, pagePx, fontPx)
  const head = '<!--font:' + fontPx + '-->'
  return { markdown: head + '\n' + paged.join('\n'), stats }
}