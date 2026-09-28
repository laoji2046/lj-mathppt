/**
 * 【v1723】图形库「向量」分类的三张图：三角形法则 / 平行四边形法则 / 等和线。
 *
 * 纯函数出 SVG ✓ —— 画布（MathFigureElement.vue）与打印/导出的兜底（reveal/renderer.ts figureInner）
 * 共用同一份实现 ✓ 不会出现「屏幕上有、打印出来空白」✗ 那种事（v1229 的教训 ✓）。
 *
 * 向量记号的画法：字母 + **上方小箭头**（不依赖字体里的组合箭头 U+20D7 ✗ 那种字体一换就变方框 ✓）。
 */

export const VECTOR_FIG_KINDS = ['vecTriangle', 'vecParallelogram', 'vecEqualSum'] as const

/** 是不是「向量」分类里的图 ✓ */
export function isVectorFigKind(kind: string): boolean {
  return (VECTOR_FIG_KINDS as readonly string[]).indexOf(kind) >= 0
}

/** 三张图的配色（固定 ✓ 换主题也不影响「哪条是哪条」✓） */
const C_A = '#2563eb'
const C_B = '#dc2626'
const C_S = '#059669'
const C_G = '#6b7280'

interface Pt { x: number; y: number }

function arrow(a: Pt, b: Pt, color: string, lw: number, dash = ''): string {
  const dx = b.x - a.x, dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len, uy = dy / len
  const head = Math.max(8, lw * 4.5)
  const bx = b.x - ux * head, by = b.y - uy * head
  const px = -uy, py = ux
  const half = head * 0.42
  const d = dash ? ` stroke-dasharray="${dash}"` : ''
  return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${color}" stroke-width="${lw}" stroke-linecap="round"${d}/>` +
    `<polygon points="${b.x.toFixed(1)},${b.y.toFixed(1)} ${(bx + px * half).toFixed(1)},${(by + py * half).toFixed(1)} ${(bx - px * half).toFixed(1)},${(by - py * half).toFixed(1)}" fill="${color}"/>`
}

function line(a: Pt, b: Pt, color: string, lw: number, dash = '5 4'): string {
  const d = dash ? ` stroke-dasharray="${dash}"` : ''
  return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${color}" stroke-width="${lw}"${d}/>`
}

function dot(p: Pt, color = '#111827', r = 3.2): string {
  return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}" fill="${color}"/>`
}

function txt(x: number, y: number, s: string, color = '#111827', size = 15, anchor = 'middle', italic = false): string {
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" fill="${color}" text-anchor="${anchor}"` +
    (italic ? ' font-style="italic"' : '') + `>${s}</text>`
}

/** 向量记号：斜体字母 + 上方小箭头 ✓ */
function vec(x: number, y: number, s: string, color: string, size = 15): string {
  const half = Math.max(5, s.length * size * 0.30)
  const top = y - size * 0.86
  const head = 4.2
  return txt(x, y, s, color, size, 'middle', true) +
    `<line x1="${(x - half).toFixed(1)}" y1="${top.toFixed(1)}" x2="${(x + half - head).toFixed(1)}" y2="${top.toFixed(1)}" stroke="${color}" stroke-width="1.3"/>` +
    `<polygon points="${(x + half).toFixed(1)},${top.toFixed(1)} ${(x + half - head).toFixed(1)},${(top - head * 0.55).toFixed(1)} ${(x + half - head).toFixed(1)},${(top + head * 0.55).toFixed(1)}" fill="${color}"/>`
}

/** 归一化坐标（0~1）→ 画布坐标 ✓ 四周留 6% 边距 ✓ */
function P(w: number, h: number, u: number, v: number): Pt {
  return { x: w * (0.06 + 0.88 * u), y: h * (0.08 + 0.84 * v) }
}

function triangle(w: number, h: number, lw: number, base: string): string {
  const A = P(w, h, 0.02, 0.96), B = P(w, h, 0.52, 0.66), C = P(w, h, 0.98, 0.06)
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  let out = ''
  out += arrow(A, B, C_A, lw * 1.15)
  out += arrow(B, C, C_B, lw * 1.15)
  out += arrow(A, C, C_S, lw * 1.25)
  out += dot(A, base) + dot(B, base) + dot(C, base)
  out += txt(A.x - 12, A.y + 16, 'A', '#111827', 15)
  out += txt(B.x + 6, B.y + 20, 'B', '#111827', 15)
  out += txt(C.x + 4, C.y - 10, 'C', '#111827', 15)
  const m1 = mid(A, B), m2 = mid(B, C), m3 = mid(A, C)
  out += vec(m1.x - 6, m1.y - 10, 'a', C_A)
  out += vec(m2.x + 20, m2.y - 2, 'b', C_B)
  out += vec(m3.x + 4, m3.y - 12, 'a+b', C_S)
  out += txt(w * 0.5, h * 0.985, '首尾相接：AB + BC = AC', C_G, 13)
  return out
}

function parallelogram(w: number, h: number, lw: number, base: string): string {
  const O = P(w, h, 0.04, 0.94)
  const A = P(w, h, 0.74, 0.80)
  const B = P(w, h, 0.34, 0.06)
  const C: Pt = { x: A.x + B.x - O.x, y: A.y + B.y - O.y }
  let out = ''
  out += line(A, C, C_G, lw * 0.7)
  out += line(B, C, C_G, lw * 0.7)
  out += arrow(O, A, C_A, lw * 1.15)
  out += arrow(O, B, C_B, lw * 1.15)
  out += arrow(O, C, C_S, lw * 1.25)
  out += dot(O, base) + dot(A, base) + dot(B, base) + dot(C, base)
  out += txt(O.x - 14, O.y + 18, 'O', '#111827', 15)
  out += txt(A.x + 8, A.y + 18, 'A', '#111827', 15)
  out += txt(B.x - 6, B.y - 10, 'B', '#111827', 15)
  out += txt(C.x + 8, C.y - 8, 'C', '#111827', 15)
  out += vec((O.x + A.x) / 2 - 8, (O.y + A.y) / 2 + 20, 'a', C_A)
  out += vec((O.x + B.x) / 2 - 26, (O.y + B.y) / 2, 'b', C_B)
  out += vec((O.x + C.x) / 2 + 6, (O.y + C.y) / 2 + 6, 'a+b', C_S)
  out += txt(w * 0.5, h * 0.985, '共起点：OA + OB = OC（OC 是对角线）', C_G, 13)
  return out
}

function equalSum(w: number, h: number, lw: number, base: string): string {
  const O = P(w, h, 0.04, 0.94)
  const A = P(w, h, 0.86, 0.78)
  const B = P(w, h, 0.26, 0.04)
  const mid: Pt = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }
  const dir: Pt = { x: A.x - B.x, y: A.y - B.y }
  const ext = (k: number, f0: number, f1: number): [Pt, Pt] => {
    const c: Pt = { x: O.x + k * (mid.x - O.x), y: O.y + k * (mid.y - O.y) }
    return [{ x: c.x - dir.x * f0, y: c.y - dir.y * f0 }, { x: c.x + dir.x * f1, y: c.y + dir.y * f1 }]
  }
  let out = ''
  const [h1a, h1b] = ext(0.55, 0.10, 0.95)
  const [l1a, l1b] = ext(1.00, 0.16, 1.05)
  const [h2a, h2b] = ext(1.45, 0.06, 0.72)
  out += line(h1a, h1b, C_G, lw * 0.75, '5 4')
  out += line(h2a, h2b, C_G, lw * 0.75, '5 4')
  out += line(l1a, l1b, C_B, lw * 1.3, '')
  const Pt1: Pt = { x: O.x + 0.42 * (A.x - O.x) + 0.58 * (B.x - O.x), y: O.y + 0.42 * (A.y - O.y) + 0.58 * (B.y - O.y) }
  out += line(Pt1, { x: O.x + 0.42 * (A.x - O.x), y: O.y + 0.42 * (A.y - O.y) }, C_G, lw * 0.6, '2 3')
  out += line(Pt1, { x: O.x + 0.58 * (B.x - O.x), y: O.y + 0.58 * (B.y - O.y) }, C_G, lw * 0.6, '2 3')
  out += arrow(O, A, C_A, lw * 1.1)
  out += arrow(O, B, C_A, lw * 1.1)
  out += arrow(O, Pt1, C_S, lw * 1.3)
  out += dot(O, base) + dot(A, base) + dot(B, base) + dot(Pt1, C_S)
  out += txt(O.x - 14, O.y + 18, 'O', '#111827', 15)
  out += txt(A.x + 10, A.y + 18, 'A', '#111827', 15)
  out += txt(B.x - 12, B.y - 8, 'B', '#111827', 15)
  out += txt(Pt1.x + 14, Pt1.y + 6, 'P', C_S, 15)
  out += vec((O.x + A.x) / 2 - 10, (O.y + A.y) / 2 + 18, 'a', C_A, 14)
  out += vec((O.x + B.x) / 2 - 24, (O.y + B.y) / 2, 'b', C_A, 14)
  out += vec((O.x + Pt1.x) / 2, (O.y + Pt1.y) / 2 - 12, 'OP', C_S, 14)
  out += txt(l1b.x - 4, l1b.y + 20, 'x+y=1（等和线）', C_B, 12.5, 'end')
  out += txt(h1b.x - 4, h1b.y + 18, 'x+y=0.5', C_G, 12, 'end')
  out += txt(h2b.x + 6, h2b.y + 16, 'x+y=1.5', C_G, 12, 'start')
  out += txt(w * 0.5, h * 0.985, 'x + y = k 的点都在与 AB 平行的直线上（k = 1 即直线 AB）', C_G, 12.5)
  return out
}

/** 出整张图的 SVG 内容（不含 <svg> 外壳 ✓ 由调用方包） */
export function vectorFigureSvg(kind: string, w: number, h: number, stroke = '#2563eb', sw = 2): string {
  const lw = Math.max(1.4, sw * 0.95)
  const base = stroke || '#2563eb'
  if (kind === 'vecTriangle') return triangle(w, h, lw, base)
  if (kind === 'vecParallelogram') return parallelogram(w, h, lw, base)
  if (kind === 'vecEqualSum') return equalSum(w, h, lw, base)
  return ''
}
