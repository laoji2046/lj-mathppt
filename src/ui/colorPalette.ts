/**
 * 调色板数据（对齐 PowerPoint 的「主题颜色 / 标准色」面板）。
 *
 * Office 的 10 个主题色是：背景1、文字1、背景2、文字2 + 强调色1~6。
 * 本项目只有主题的 bg/text/primary/accent/muted 几个 token，所以前四个从主题取，
 * 强调色里 primary/accent 也来自主题，**剩下 4 个是固定的补色**（跟 Office 默认色相一致）——
 * 这一点如实标注，不假装整排都是主题色。
 */
import type { Theme } from '@/templates/pptTheme'

/** 十六进制 → RGB */
function toRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '').trim()
  const s = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h.padEnd(6, '0')
  return [parseInt(s.slice(0, 2), 16) || 0, parseInt(s.slice(2, 4), 16) || 0, parseInt(s.slice(4, 6), 16) || 0]
}
function toHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}
/** 把颜色按比例混向白（t>0）或黑（t<0）：t=1 全白、t=-1 全黑 */
export function shade(hex: string, t: number): string {
  const [r, g, b] = toRgb(hex)
  const target: [number, number, number] = t >= 0 ? [255, 255, 255] : [0, 0, 0]
  const k = Math.abs(t)
  return toHex([r + (target[0] - r) * k, g + (target[1] - g) * k, b + (target[2] - b) * k])
}

/** 10 个主题基色：前四个来自主题，强调色 1~2 来自主题，3~6 为固定补色 */
export function themeBaseColors(theme: Theme): string[] {
  return [
    theme.bg === 'transparent' ? '#ffffff' : theme.bg, // 背景1
    theme.text,                                        // 文字1
    shade(theme.text, 0.82),                           // 背景2
    theme.muted,                                       // 文字2
    theme.primary,                                     // 强调色1
    theme.accent,                                      // 强调色2
    '#2f9e63', '#3c9bb0', '#7c4bb8', '#b23f88',        // 强调色3~6（固定补色）
  ]
}

/** 主题色 5 档浓淡（PPT 那 5 行：淡 → 深） */
export const TINT_STEPS = [0.8, 0.6, 0.4, 0, -0.25]

/** 标准色（PPT 面板底部那一排） */
export const STANDARD_COLORS = [
  '#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050',
  '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0',
]

/** 拼出「主题颜色」那一整块：每列一个基色，纵向 5 档 */
export function themeGrid(theme: Theme): string[][] {
  return themeBaseColors(theme).map((base) => TINT_STEPS.map((t) => (t === 0 ? base : shade(base, t))))
}
