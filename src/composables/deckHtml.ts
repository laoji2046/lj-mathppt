/**
 * 「本页 HTML 可编辑并回写」：
 * - 文本/公式/richtex/图片：内容+常用属性用 data-* 直接可编辑；
 * - 其它富元素（shape/table/chart/icon/embed/mathfig/line/arrow/pen/geogebra/desmos）：用 data-json 精确往返（可浏览，不手改内部）。
 * - 位置写在 style="left;top;width;height"；输出结构化：每个元素带注释号/类型、图片 <img> 缩进嵌套、元素间空行。
 */
import type { Slide, SlideElement } from '@/types'

function esc(s: string) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const EDITABLE = new Set(['text', 'math', 'richtex', 'image'])
const LABEL: Record<string, (e: any) => string> = {
  shape: (e) => e.shape || 'rect',
  table: (e) => (e.rows?.length || 0) + '行×' + (e.rows?.[0]?.length || 0) + '列',
  chart: (e) => e.chartType || 'chart',
  icon: (e) => e.icon || 'icon',
  embed: (e) => e.kind || 'embed',
  mathfig: () => 'mathfig',
  line: () => 'line',
  arrow: () => 'arrow',
  pen: () => 'pen',
  geogebra: () => 'geo',
  desmos: () => 'desmos',
}

export function slideToSourceHtml(s: Slide): string {
  const els = [...s.elements].sort((a, b) => (a.y - b.y) || (a.x - b.x))
  const lines: string[] = []
  els.forEach((e: any, i) => {
    const type = e.type
    const st = 'left:' + e.x + ';top:' + e.y + ';width:' + e.w + ';height:' + e.h + ';' + (e.rot ? 'rotate:' + e.rot + ';' : '')
    const label = LABEL[type]?.(e) || ''
    const head = '<!-- ' + (i + 1) + ' · ' + type + (label ? ' · ' + label : '') + ' -->'
    let body = ''
    if (type === 'text') body = '<div data-type="text" style="' + st + '" data-fontsize="' + e.fontSize + '" data-color="' + esc(e.color || '') + '" data-font="' + esc(e.fontFamily || '') + '" data-fontweight="' + e.fontWeight + '" data-align="' + e.align + '">' + esc(e.text) + '</div>'
    else if (type === 'math') body = '<div data-type="math" style="' + st + '" data-latex="' + esc(e.latex) + '" data-fontsize="' + e.fontSize + '" data-color="' + esc(e.color || '') + '" data-align="' + (e.align || 'center') + '"></div>'
    else if (type === 'richtex') body = '<div data-type="richtex" style="' + st + '" data-fontsize="' + e.fontSize + '" data-color="' + esc(e.color || '') + '" data-font="' + esc(e.fontFamily || '') + '" data-fontweight="' + e.fontWeight + '">' + esc(e.text) + '</div>'
    else if (type === 'image') body = '<div data-type="image" style="' + st + '" data-src="' + esc(e.src) + '" data-fit="' + (e.fit || 'contain') + '">\n  <img src="' + esc(e.src) + '">\n</div>'
    else if (EDITABLE.has(type)) body = '<div data-type="' + type + '" style="' + st + '"></div>'
    else body = '<div data-type="' + type + '" style="' + st + '" data-json="' + esc(JSON.stringify(e)) + '" data-label="' + esc(label || type) + '"></div>'
    lines.push(head + '\n' + body)
  })
  return lines.join('\n\n')
}

function num(v: string | null, d: number): number { const n = parseFloat(v as string); return isNaN(n) ? d : n }
function styleOf(node: Element): { x: number; y: number; w: number; h: number; rot: number } {
  const st = node.getAttribute('style') || ''
  const get = (k: string) => { const m = st.match(new RegExp(k + '\\s*:\\s*([^;]+)')); return m ? m[1] : '' }
  return { x: num(get('left'), 0), y: num(get('top'), 0), w: num(get('width'), 0), h: num(get('height'), 0), rot: num(get('rotate'), 0) }
}

export function sourceHtmlToSlide(html: string): SlideElement[] {
  const out: SlideElement[] = []
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    doc.body.querySelectorAll('[data-type]').forEach((n) => {
      const type = n.getAttribute('data-type') || ''
      const { x, y, w, h, rot } = styleOf(n)
      const setPos = (el: any) => { el.x = x; el.y = y; el.w = w; el.h = h; el.rot = rot; return el }
      if (type === 'text') {
        out.push(setPos({ id: 'el_' + Math.random().toString(36).slice(2, 10), type: 'text', text: n.textContent || '', fontSize: num(n.getAttribute('data-fontsize'), 28), color: n.getAttribute('data-color') || '#1a1a1a', fontFamily: n.getAttribute('data-font') || 'sans', fontWeight: num(n.getAttribute('data-fontweight'), 400), align: (n.getAttribute('data-align') as any) || 'left', bgColor: 'transparent', shadow: 'none' }))
      } else if (type === 'math') {
        out.push(setPos({ id: 'el_' + Math.random().toString(36).slice(2, 10), type: 'math', latex: n.getAttribute('data-latex') || '', fontSize: num(n.getAttribute('data-fontsize'), 28), color: n.getAttribute('data-color') || '#1a1a1a', align: (n.getAttribute('data-align') as any) || 'center' }))
      } else if (type === 'richtex') {
        out.push(setPos({ id: 'el_' + Math.random().toString(36).slice(2, 10), type: 'richtex', text: n.textContent || '', fontSize: num(n.getAttribute('data-fontsize'), 28), color: n.getAttribute('data-color') || '#1a1a1a', fontFamily: n.getAttribute('data-font') || 'sans', fontWeight: num(n.getAttribute('data-fontweight'), 400), align: 'left', bgColor: 'transparent', shadow: 'none' }))
      } else if (type === 'image') {
        out.push(setPos({ id: 'el_' + Math.random().toString(36).slice(2, 10), type: 'image', src: n.getAttribute('data-src') || '', fit: (n.getAttribute('data-fit') as any) || 'contain' }))
      } else {
        const json = n.getAttribute('data-json')
        if (json) { const el = JSON.parse(json); if (el) out.push(setPos({ ...el, id: el.id || ('el_' + Math.random().toString(36).slice(2, 10)) })) }
      }
    })
  } catch { /* 解析失败保持原样 */ }
  return out
}

/** 简单格式化 HTML（按标签缩进） */
export function prettyHtml(html: string): string {
  // 强格式化：按标签嵌套缩进。叶子元素(<div>text</div>)同行；含子标签(如 <img>)则子标缩进、闭合对齐；注释同位；块间空行。
  const tokens = String(html).match(/<!--[\s\S]*?-->|<\/?[^>]+>|[^<]+/g) || []
  let depth = 0
  const out: string[] = []
  let cur = ''
  let hasText = false
  const flush = () => { if (cur.trim() !== '') out.push(cur.trimEnd()); cur = ''; hasText = false }
  const pad = (n: number) => '  '.repeat(Math.max(0, n))
  tokens.forEach((tok) => {
    if (tok.startsWith('<!--')) { flush(); if (out.length && out[out.length - 1] !== '') out.push(''); out.push(pad(depth) + tok.trim()); return }
    if (tok[0] !== '<') { cur += tok; if (tok.trim() !== '') hasText = true; return }
    if (tok.startsWith('</')) {
      if (hasText || cur.trim() !== '') { cur += tok; flush(); depth = Math.max(0, depth - 1) }
      else { depth = Math.max(0, depth - 1); flush(); out.push(pad(depth) + tok) }
      return
    }
    if (/\/>$/.test(tok) || /^<(img|br|hr|meta|input)\b/i.test(tok)) {
      if (!hasText && cur.trim() !== '') { flush(); out.push(pad(depth) + tok) }
      else cur += tok
      return
    }
    flush(); cur = pad(depth) + tok; depth++
  })
  flush()
  return out.join('\\n').replace(/\\n{3,}/g, '\\n\\n').trim()
}
