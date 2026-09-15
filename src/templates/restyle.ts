/**
 * 把课件的**样式**对齐到本应用的设计主题（设计宪法见 templates/pptTheme.ts）。
 *
 * ⚠ 只改样式、**绝不碰内容** ✓ —— 文字、公式、表格 rows、图片地址一律不动 ✓。
 *    这是"忠实优先"的取向：导入默认保持原课件的样子 ✓，本功能是**可选的后续动作** ✓，
 *    而且调用方会 pushHistory ✓ 可以 Ctrl+Z 撤销 ✓。
 *
 * 对齐的四件事（都取主题 tokens ✓）：
 *   1. 字号 → 吸附到 TypeScale 的**最近档位** ✗（宪法第一条：禁止随手写 27、31 这种数 ✓）
 *   2. 字体 → 大字号用 fontTitle ✓，正文用 fontBody ✓
 *   3. 背景 → 换成主题底色 ✓（"这是我们的风格"最直观的体现 ✓）
 *   4. 文字颜色 → **保留色相** ✗，只把与背景的对比度夹到可读区间 ✓
 *      （不整片换色 ✓ —— 原课件的红/蓝是**语义** ✓，全换掉等于把导入的价值丢了 ✓）
 */
import type { Deck, Slide, SlideElement } from '@/types'
import { getTheme, type Theme } from './pptTheme'
import { tableContentHeight, textBlockHeight } from '@/composables/textMetrics'

/** 最近档位吸附 */
function snapSize(px: number, theme: Theme): number {
  const scale = [theme.type.display, theme.type.h1, theme.type.h2, theme.type.h3, theme.type.body, theme.type.small, theme.type.label]
  let best = scale[0]
  for (const v of scale) if (Math.abs(v - px) < Math.abs(best - px)) best = v
  return best
}

/** #rrggbb → [h, s, l] */
function toHsl(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(String(hex || '').trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h * 360, s, l]
}
function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const a = s * Math.min(l, 1 - l)
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * v).toString(16).padStart(2, '0')
  }
  return '#' + f(0) + f(8) + f(4)
}
/** 相对亮度（WCAG 用近似即可 ✓） */
function luma(hex: string): number {
  const m = /^#([0-9a-fA-F]{6})$/.exec(String(hex || ''))
  if (!m) return 0.5
  const n = parseInt(m[1], 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}
/**
 * 让文字在给定背景上可读 ✓ —— **保色相** ✗，只调明度。
 * 背景亮 → 把字压暗 ✓；背景暗 → 把字提亮 ✓。色相与饱和度关系尽量保住 ✓。
 */
function readableOn(color: string, bg: string): string {
  const hsl = toHsl(color)
  const bgHsl = toHsl(bg) || [0, 0, 1]
  if (!hsl) return color
  const bgLight = bgHsl[2] > 0.55
  let [h, s, l] = hsl
  const contrast = Math.abs(luma(color) - luma(bg))
  if (contrast >= 0.35) return color                       // 已经够清楚 ✓ 不动 ✓
  if (bgLight && l > 0.45) l = 0.32                        // 亮底上的浅字 → 压暗 ✓
  else if (!bgLight && l < 0.6) l = 0.82                   // 暗底上的深字 → 提亮 ✓
  else l = bgLight ? Math.min(l, 0.45) : Math.max(l, 0.6)
  if (s < 0.06) { h = 0; s = 0 }                           // 纯灰保持中性 ✓
  return hslToHex(h, s, l)
}

/** 大字号用标题字，正文用正文字 ✓（分界取 h2 档位 ✓） */
function pickFont(size: number, theme: Theme): string {
  return size >= theme.type.h2 ? theme.fontTitle : theme.fontBody
}

/** 对齐单个元素；返回是否改动过 ✓ */
export function restyleElement(el: SlideElement, theme: Theme, slideBg: string): boolean {
  let changed = false
  const anyEl = el as any
  if (el.type === 'text' || el.type === 'richtex') {
    const snapped = snapSize(Number(anyEl.fontSize) || theme.type.body, theme)
    if (anyEl.fontSize !== snapped) { anyEl.fontSize = snapped; changed = true }
    const font = pickFont(snapped, theme)
    if (anyEl.fontFamily !== font) { anyEl.fontFamily = font; changed = true }
    const col = readableOn(String(anyEl.color || theme.text), slideBg)
    if (anyEl.color !== col) { anyEl.color = col; changed = true }
    // ⚠ 字号一改，框高必须跟着重算 ✗ —— 应用的文字是 overflow:hidden ✓，
    //   字变大就会**裁字** ✓（实测：表格最后一行被裁 ✓）。这是"只改样式"必须付的代价 ✓。
    const boxW = Number(anyEl.w) || 400
    const need = textBlockHeight(String(anyEl.text || ''), snapped, boxW, Number(anyEl.lineHeight) || 1.4)
    if (need > (Number(anyEl.h) || 0)) { anyEl.h = need; changed = true }
    if (anyEl.bgColor && anyEl.bgColor !== 'transparent') {
      // 文字底块的颜色不动 ✓（那是原课件的强调块 ✓），只保证字在其上可读 ✓
      const c2 = readableOn(String(anyEl.color || theme.text), anyEl.bgColor)
      if (anyEl.color !== c2) { anyEl.color = c2; changed = true }
    }
  } else if (el.type === 'table') {
    const snapped = snapSize(Number(anyEl.fontSize) || theme.type.small, theme)
    if (anyEl.fontSize !== snapped) { anyEl.fontSize = snapped; changed = true }
    // 表格圆角/边框色跟主题 ✓
    if (anyEl.borderColor !== theme.line) { anyEl.borderColor = theme.line; changed = true }
    // 表格同理：重算内容高 ✓（列宽在 colWidths 里 ✓）
    if (Array.isArray(anyEl.colWidths) && anyEl.colWidths.length && Array.isArray(anyEl.rows)) {
      anyEl.h = tableContentHeight(anyEl.rows, anyEl.colWidths, snapped)
      changed = true
    }
  } else if (el.type === 'shape') {
    if (anyEl.cornerRadius !== undefined && anyEl.cornerRadius > theme.radius) {
      anyEl.cornerRadius = theme.radius
      changed = true
    }
    if (anyEl.stroke && anyEl.stroke !== 'transparent') {
      const c2 = readableOn(String(anyEl.stroke), slideBg)
      if (anyEl.stroke !== c2) { anyEl.stroke = c2; changed = true }
    }
  } else if (el.type === 'line' || el.type === 'arrow') {
    const c2 = readableOn(String(anyEl.stroke || theme.text), slideBg)
    if (anyEl.stroke !== c2) { anyEl.stroke = c2; changed = true }
  }
  // 其余类型（image / mathfig / chart / embed / icon / geogebra / desmos …）**一律不动** ✓
  return changed
}

/**
 * 把整份课件的样式对齐到主题 ✓。返回"改动了多少个元素" ✓（好给用户一个交代 ✓）。
 */
export function restyleDeck(deck: Deck, themeId?: string): { theme: Theme; changed: number; slides: number } {
  const theme = getTheme(themeId || deck.theme || 'edumath')
  let changed = 0
  let slides = 0
  for (const s of deck.slides as Slide[]) {
    const before = s.bg
    // 1) 页面背景换成主题底色 ✓（这是"我们的风格"最直观的一处 ✓）
    s.bg = theme.bg
    if (before !== theme.bg) slides++
    for (const el of s.elements || []) {
      if (restyleElement(el, theme, theme.bg)) changed++
    }
  }
  ;(deck as any).theme = theme.id
  return { theme, changed, slides }
}