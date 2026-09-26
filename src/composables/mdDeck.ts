/**
 * Markdown 双向转换（Reveal.js 规范）：
 * - '---' 切割横向幻灯片；'--' 切割垂直子页面；'Note: ' 标识演讲者备注。
 * - deckToMarkdown / markdownToDeck 互为逆操作（内容级：文本/标题/公式/图片/备注；其它元素类型不保真）。
 * - 块级公式 $$...$$ 导入后是**混排元素**（$\\displaystyle ...$，与模板库同一套约定），
 *   反向导出时再还原成 $$...$$，来回不丢内容、也不产出 math 元素。
 */
import type { Deck, Slide, TextElement, MathElement, RichTextElement, ImageElement } from '@/types'
import { estimateTextHeight } from '@/types'

function isText(e: { type: string }): e is TextElement { return e.type === 'text' }
function isMath(e: { type: string }): e is MathElement { return e.type === 'math' }
function isRichtex(e: { type: string }): e is RichTextElement { return e.type === 'richtex' }
function isImage(e: { type: string }): e is ImageElement { return e.type === 'image' }

/** 单页 → markdown 内容行 */
function slideToMd(s: Slide): string {
  const lines: string[] = []
  const els = [...s.elements].sort((a, b) => (a.y - b.y) || (a.x - b.x))
  els.forEach((e) => {
    if (isText(e)) {
      const t = e.text.trim()
      if (!t) return
      if (e.fontSize >= 48) lines.push('# ' + t)
      else if (e.fontSize >= 32) lines.push('## ' + t)
      else lines.push(t)
    } else if (isMath(e)) {
      const l = (e.latex || '').trim()
      if (l) lines.push('$$' + l + '$$')
    } else if (isRichtex(e)) {
      const t = e.text.trim()
      if (!t) return
      // 独立成行的展示公式（$\displaystyle X$）在 markdown 里还原成块级 $$X$$
      const disp = t.match(/^\$\s*\\displaystyle\s+([\s\S]+)\$$/)
      lines.push(disp ? '$$' + disp[1].trim() + '$$' : t)
    } else if (isImage(e)) {
      if (e.src) lines.push('![](' + e.src + ')')
    }
  })
  if (s.notes) { lines.push(''); lines.push('Note: ' + s.notes) }
  return lines.join('\n')
}

/** deck → markdown（Reveal 规范） */
export function deckToMarkdown(deck: Deck): string {
  const roots = deck.slides.filter((s) => !s.parentId)
  const out: string[] = []
  roots.forEach((root, ri) => {
    if (ri > 0) out.push('---')
    out.push(slideToMd(root))
    deck.slides.filter((s) => s.parentId === root.id).forEach((child) => {
      out.push('--')
      out.push(slideToMd(child))
    })
  })
  return out.join('\n')
}

function uid(prefix: string) { return prefix + '_' + Math.random().toString(36).slice(2, 10) }

/**
 * 展示公式元素（Markdown 的 $$...$$）：**混排元素 + $\displaystyle ...$**，不是 math 元素 ——
 * 与模板库同一套约定（见 templates/mathAppletTemplates.ts 的 display()）。
 * 用内联写法而不是 \[...\]：MathJax 会给 display 公式套 margin:1em 0，在元素框里白白撑高。
 */
function displayEl(latex: string, y: number): Slide['elements'][number] {
  return {
    id: uid('el'), type: 'richtex', x: 150, y, w: 1620, h: 140, rot: 0, fitMode: 'shrink',
    text: '$' + '\\displaystyle ' + latex + '$', fontSize: 32, color: '#1a1a1a', fontWeight: 400,
    fontFamily: 'sans', align: 'center', bgColor: 'transparent', shadow: 'none',
  } as any
}

/**
 * 把一段 markdown 内容解析成一页的元素与备注。
 *
 * **块模型**：连续的若干非空行 = 一个「块」= 一个元素框（多行文字在一个框里），空行分隔块。
 * 为什么不是「一行一个框」：Word 导入时一行往往只是半句话，一行一框会切出几百页（实测真题 83 页、解析版 365 页），
 * 而且半句话就翻页。改成块模型后「一道题 = 一个框」，页数能压到 1/3 左右，排版也像正文。
 * 这也是标准 Markdown 的段落语义（连续行属于同一段）。
 */
function mdBlockToSlide(lines: string[], opts: { fontSize?: number } = {}): Slide {
  const elements = { list: [] as Slide['elements'], y: 120 }
  const notes: string[] = []
  let mathBuf = '', inBlock = false
  const baseFs = opts.fontSize ?? 26
  const TOP = 120, BOTTOM = 1080 - 60            // 正文上边距 / 可用底边
  // 行距按元素自身高度推进（自身高度 + 20 间隙），不再固定 80px（那会让相邻元素重叠 40~440px）
  const push = (e: Slide['elements'][number]) => { elements.list.push(e); elements.y += (e.h ?? 70) + 20 }

  /** 落一个块：整块合成一个元素；太高就整体缩字号（最低 14px），别把一页撑爆 */
  const flushBlock = (buf: string[]) => {
    if (!buf.length) return
    const text = buf.join('\n').trim()
    if (!text) return
    const avail = BOTTOM - TOP
    let fs = baseFs
    let h = estimateTextHeight(text, fs, 1620)
    if (h > avail) {
      fs = Math.max(14, Math.floor((baseFs * avail) / h))
      h = estimateTextHeight(text, fs, 1620)
    }
    const base = {
      id: uid('el'), x: 150, y: elements.y, w: 1620, h, rot: 0, text, fontSize: fs,
      color: '#1a1a1a', fontWeight: 400, fontFamily: 'sans', align: 'left',
      bgColor: 'transparent', shadow: 'none',
    }
    const isMix = text.includes('$') || text.includes('\\(')
    push(isMix ? ({ ...base, type: 'richtex', fitMode: 'shrink' } as any) : ({ ...base, type: 'text' } as any))
  }

  const buf: string[] = []
  const flush = () => { flushBlock(buf); buf.length = 0 }
  for (const raw of lines) {
    const line = raw.trimEnd()
    // 跨行的块级公式：先落掉已攒的块，收齐后再单独成一个显示公式元素
    if (inBlock) {
      const end = line.indexOf('$$')
      if (end >= 0) { mathBuf += '\n' + line.slice(0, end); push(displayEl(mathBuf.trim(), elements.y)); mathBuf = ''; inBlock = false }
      else mathBuf += '\n' + line
      continue
    }
    // 只有**整行以 $$ 开头**才算显示公式；夹在行中间的 $$ 当普通内容，
    // 否则「B.B₁C₁⊥平面AA₁D」这种行会被拦腰截断、剩下的文字被丢掉（这正是 Word 导入踩过的坑）
    if (line.startsWith('$$')) {
      const end = line.indexOf('$$', 2)
      if (end >= 0) { flush(); push(displayEl(line.slice(2, end).trim(), elements.y)) }
      else { flush(); mathBuf = line.slice(2); inBlock = true }
      continue
    }
    const note = line.match(/^Note:\s*(.*)$/)
    if (note) { notes.push(note[1].trim()); continue }
    // 【v1648】空行不一定是块的分界（用户报：AI 回答插进来变成好多行 ✗）——
    //   AI 常在每行之间也空一行，若照样切块，一道题会被拆成「题干 / 选项 / 答案」好几个框 ✗。
    //   规则：**当前块是"题号块"（首行像 `1.` `2、`）时，空行只当作块内的空行**，一直攒到下一题 ✓
    if (!line.trim()) {
      if (buf.length && /^\s*\d{1,3}\s*[.、．]/.test(buf[0])) { buf.push(""); continue }
      flush()
      continue
    }
    // 独占一行的图片：不能塞进文字块里（应用只认行首的 ![]()）
    const img = line.match(/^!\[[^\]]*\]\(([^)]+)\)$/)
    if (img) { flush(); push({ id: uid('el'), type: 'image', x: 150, y: elements.y, w: 900, h: 520, rot: 0, src: img[1].trim(), fit: 'contain' } as any); continue }
    // 标题：自己成块
    const h = line.match(/^(#{1,3})\s+(.*)$/)
    if (h) {
      flush()
      const lvl = h[1].length
      const fs = lvl === 1 ? 48 : lvl === 2 ? 40 : 32
      const color = lvl === 1 ? '#1a1a1a' : '#c0392b'
      push({ id: uid('el'), type: 'text', x: 150, y: elements.y, w: 1620, h: estimateTextHeight(h[2].trim(), fs, 1620, 1.3), rot: 0, text: h[2].trim(), fontSize: fs, color, fontWeight: 700, align: 'left', fontFamily: 'hei-bold', bgColor: 'transparent', shadow: 'none' } as any)
      continue
    }
    buf.push(line)                                  // 其余行攒进当前块
  }
  flush()
  // 容错：$$ 只写了一半（例如删掉了一个 $）时，也把已收集的公式内容保留下来，避免整块公式凭空消失
  if (inBlock) {
    const rest = mathBuf.replace(/\$+\s*$/, '').trim()
    if (rest) push(displayEl(rest, elements.y))
    mathBuf = ''; inBlock = false
  }
  return { id: uid('slide'), bg: '#ffffff', elements: elements.list, notes: notes.join('\n') || undefined, parentId: undefined }
}

/**
 * markdown → deck（按 '---' 横切 / '--' 垂直）。
 * opts.fontSize 是正文字号（默认 26）—— Word 导入这类内容长的文档可以调小，一页就能装更多。
 */
export function markdownToDeck(md: string, opts: { fontSize?: number } = {}): Deck {
  let src = md.replace(/\r\n/g, '\n')
  // 正文字号指令：<!--font:20-->（转换器生成，也可以手写）—— 字号越小一页装得越多
  const fm = src.match(/<!--\s*font\s*:\s*(\d{2})\s*-->/)
  if (fm) {
    const n = parseInt(fm[1], 10)
    if (n >= 12 && n <= 64) opts = { ...opts, fontSize: n }
    src = src.replace(fm[0], '')
  }
  const lines = src.split('\n')
  // 先按顶层 '---' 切成横向块（把每个横向块内再按 '--' 分垂直）
  const horizBlocks: string[][] = []
  let cur: string[] = []
  const flush = () => { if (cur.length) { horizBlocks.push(cur); cur = [] } }
  for (const l of lines) {
    if (/^\s*---\s*$/.test(l)) flush()
    else cur.push(l)
  }
  flush()
  if (!horizBlocks.length) horizBlocks.push([])
  const slides: Slide[] = []
  let lastRoot: Slide | null = null
  horizBlocks.forEach((hb) => {
    const vert: string[][] = []
    let vb: string[] = []
    const fvb = () => { if (vb.length) { vert.push(vb); vb = [] } }
    for (const l of hb) { if (/^\s*--\s*$/.test(l)) fvb(); else vb.push(l) }
    fvb()
    if (!vert.length) vert.push([])
    vert.forEach((vb2, vi) => {
      const s = mdBlockToSlide(vb2, opts)
      if (vi > 0 && lastRoot) s.parentId = lastRoot.id
      else lastRoot = s
      slides.push(s)
    })
  })
  return { title: 'Markdown 导入', width: 1920, height: 1080, slides }
}
