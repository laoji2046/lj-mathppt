/**
 * Markdown 双向转换（Reveal.js 规范）：
 * - '---' 切割横向幻灯片；'--' 切割垂直子页面；'Note: ' 标识演讲者备注。
 * - deckToMarkdown / markdownToDeck 互为逆操作（内容级：文本/标题/公式/图片/备注；其它元素类型不保真）。
 * - 块级公式 $$...$$ 导入后是**混排元素**（$\\displaystyle ...$，与模板库同一套约定），
 *   反向导出时再还原成 $$...$$，来回不丢内容、也不产出 math 元素。
 */
import type { Deck, Slide, TextElement, MathElement, RichTextElement, ImageElement } from '@/types'

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

/** 把一段 markdown 内容解析成一页的元素与备注 */
function mdBlockToSlide(lines: string[]): Slide {
  const elements = { list: [] as Slide['elements'], y: 120, indent: 0 }
  const notes: string[] = []
  let mathBuf = '', inBlock = false
  const push = (e: Slide['elements'][number], advance?: number) => { elements.list.push(e); elements.y += advance ?? (isMath(e) ? 140 : 80) }
  for (let raw of lines) {
    let line = raw.trimEnd()
    // 块级数学 $$...$$（可跨多行）
    if (inBlock) {
      const end = line.indexOf('$$')
      if (end >= 0) { mathBuf += '\n' + line.slice(0, end); push(displayEl(mathBuf.trim(), elements.y), 140); mathBuf = ''; inBlock = false }
      else { mathBuf += '\n' + line }
      continue
    }
    const mstart = line.indexOf('$$')
    if (mstart >= 0) {
      const end = line.indexOf('$$', mstart + 2)
      if (end >= 0) { const latex = line.slice(mstart + 2, end).trim(); push(displayEl(latex, elements.y), 140) }
      else { mathBuf = line.slice(mstart + 2); inBlock = true }
      continue
    }
    const note = line.match(/^Note:\s*(.*)$/)
    if (note) { notes.push(note[1].trim()); continue }
    if (!line.trim()) continue
    // 图片 ![alt](src)
    const img = line.match(/^!\[[^\]]*\]\(([^)]+)\)/)
    if (img) { push({ id: uid('el'), type: 'image', x: 150, y: elements.y, w: 900, h: 520, rot: 0, src: img[1].trim(), fit: 'contain' } as any); continue }
    // 标题 # / ## / ###
    const h = line.match(/^(#{1,3})\s+(.*)$/)
    if (h) {
      const lvl = h[1].length
      const fs = lvl === 1 ? 48 : lvl === 2 ? 40 : 32
      const color = lvl === 1 ? '#1a1a1a' : '#c0392b'
      push({ id: uid('el'), type: 'text', x: 150, y: elements.y, w: 1620, h: 70, rot: 0, text: h[2].trim(), fontSize: fs, color, fontWeight: 700, align: 'left', fontFamily: 'hei-bold', bgColor: 'transparent', shadow: 'none' } as any)
      continue
    }
    // 内联 $...$ → richtex；否则正文文本
    const hasInline = /\$[^\n]+?\$/.test(line)
    if (hasInline || line.includes('\\(')) {
      push({ id: uid('el'), type: 'richtex', x: 150, y: elements.y, w: 1620, h: 120, rot: 0, fitMode: 'shrink', text: line, fontSize: 26, color: '#1a1a1a', fontWeight: 400, fontFamily: 'sans', align: 'left', bgColor: 'transparent', shadow: 'none' } as any)
    } else {
      push({ id: uid('el'), type: 'text', x: 150, y: elements.y, w: 1620, h: 70, rot: 0, text: line, fontSize: 26, color: '#1a1a1a', fontWeight: 400, align: 'left', fontFamily: 'sans', bgColor: 'transparent', shadow: 'none' } as any)
    }
  }
  // 容错：$$ 只写了一半（例如删掉了一个 $）时，也把已收集的公式内容保留下来，避免整块公式凭空消失
  if (inBlock) {
    const rest = mathBuf.replace(/\$+\s*$/, '').trim()
    if (rest) push(displayEl(rest, elements.y), 140)
    mathBuf = ''; inBlock = false
  }
  return { id: uid('slide'), bg: '#ffffff', elements: elements.list, notes: notes.join('\n') || undefined, parentId: undefined }
}

/** markdown → deck（按 '---' 横切 / '--' 垂直） */
export function markdownToDeck(md: string): Deck {
  const src = md.replace(/\r\n/g, '\n')
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
      const s = mdBlockToSlide(vb2)
      if (vi > 0 && lastRoot) s.parentId = lastRoot.id
      else lastRoot = s
      slides.push(s)
    })
  })
  return { title: 'Markdown 导入', width: 1920, height: 1080, slides }
}
