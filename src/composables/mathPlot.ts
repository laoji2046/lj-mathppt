/**
 * 函数图像 / 圆锥曲线的纯几何：给定像素框（w×h）与数学坐标窗口，产出 SVG 片段字符串。
 *
 * 刻意不依赖 Vue —— 便于在 node 里单独跑校验（esbuild 打包后直接调用），
 * 也让 MathFigureElement 的 switch 保持精简。
 *
 * 坐标约定：SVG 用户坐标 = 元素框坐标（0,0 左上 ~ w,h 右下），
 * 与 MathFigureElement 的 viewBox="0 0 w h" 一致。曲线越出窗口或遇到非有限值即断线，
 * 避免渐近线（tan、1/x）把线拉到框外。
 */

export interface View { xmin: number; xmax: number; ymin: number; ymax: number }
export interface Mapper { X: (x: number) => number; Y: (y: number) => number }

export function mapper(view: View, w: number, h: number): Mapper {
  const sx = w / (view.xmax - view.xmin)
  const sy = h / (view.ymax - view.ymin)
  return { X: (x) => (x - view.xmin) * sx, Y: (y) => h - (y - view.ymin) * sy }
}

const n1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '0')
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 采样 y=f(x) 成 path 的 d（越出窗口 / NaN / ∞ 处断线，多段用空格连接） */
export function plotFunction(f: (x: number) => number, view: View, w: number, h: number, steps = 360): string {
  const { X, Y } = mapper(view, w, h)
  const margin = h * 0.06
  const out: string[] = []
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const x = view.xmin + ((view.xmax - view.xmin) * i) / steps
    const y = f(x)
    const py = Number.isFinite(y) ? Y(y) : NaN
    if (!Number.isFinite(py) || py < -margin || py > h + margin) {
      if (d) { out.push(d); d = '' }
      continue
    }
    d += (d ? ' L ' : 'M ') + n1(X(x)) + ' ' + n1(py)
  }
  if (d) out.push(d)
  return out.join(' ')
}

/** 参数曲线（椭圆 / 双曲线分支等） */
export function plotParametric(
  fx: (t: number) => number,
  fy: (t: number) => number,
  t0: number,
  t1: number,
  view: View,
  w: number,
  h: number,
  steps = 360,
): string {
  const { X, Y } = mapper(view, w, h)
  const margin = h * 0.06
  const out: string[] = []
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps
    const x = fx(t), y = fy(t)
    if (!Number.isFinite(x) || !Number.isFinite(y)) { if (d) { out.push(d); d = '' } continue }
    const px = X(x), py = Y(y)
    if (py < -margin || py > h + margin || px < -w * 0.1 || px > w * 1.1) {
      if (d) { out.push(d); d = '' }
      continue
    }
    d += (d ? ' L ' : 'M ') + n1(px) + ' ' + n1(py)
  }
  if (d) out.push(d)
  return out.join(' ')
}

/** 点 */
export function dotSvg(px: number, py: number, r: number, fill: string): string {
  return '<circle cx="' + n1(px) + '" cy="' + n1(py) + '" r="' + n1(r) + '" fill="' + fill + '"/>'
}
/** 文本（数学习惯：斜体衬线） */
export function textSvg(px: number, py: number, str: string, size: number, color: string, anchor = 'middle'): string {
  return '<text x="' + n1(px) + '" y="' + n1(py) + '" font-size="' + n1(size) + '" fill="' + color +
    '" font-family="Times New Roman, Georgia, serif" font-style="italic" text-anchor="' + anchor +
    '" dominant-baseline="middle">' + esc(str) + '</text>'
}
/** 直线段（可选虚线） */
export function lineSvg(x1: number, y1: number, x2: number, y2: number, stroke: string, sw: number, dash = ''): string {
  return '<line x1="' + n1(x1) + '" y1="' + n1(y1) + '" x2="' + n1(x2) + '" y2="' + n1(y2) +
    '" stroke="' + stroke + '" stroke-width="' + n1(sw) + '"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>'
}

/** 直角坐标轴（带箭头 + 整数刻度；0 不在窗口内时贴边） */
export function axesSvg(view: View, w: number, h: number, stroke: string, sw: number, withTicks = true): string {
  const { X, Y } = mapper(view, w, h)
  const y0 = Math.min(h, Math.max(0, Y(0)))
  const x0 = Math.min(w, Math.max(0, X(0)))
  const thin = Math.max(1, sw * 0.6)
  const head = Math.max(7, Math.min(w, h) * 0.035)
  let s = ''
  s += '<line x1="0" y1="' + n1(y0) + '" x2="' + n1(w) + '" y2="' + n1(y0) + '" stroke="' + stroke + '" stroke-width="' + n1(thin) + '"/>'
  s += '<polygon points="' + n1(w) + ',' + n1(y0) + ' ' + n1(w - head) + ',' + n1(y0 - head * 0.42) + ' ' + n1(w - head) + ',' + n1(y0 + head * 0.42) + '" fill="' + stroke + '"/>'
  s += '<line x1="' + n1(x0) + '" y1="' + n1(h) + '" x2="' + n1(x0) + '" y2="0" stroke="' + stroke + '" stroke-width="' + n1(thin) + '"/>'
  s += '<polygon points="' + n1(x0) + ',0 ' + n1(x0 - head * 0.42) + ',' + n1(head) + ' ' + n1(x0 + head * 0.42) + ',' + n1(head) + '" fill="' + stroke + '"/>'
  if (withTicks) {
    const span = view.xmax - view.xmin
    const step = span <= 6 ? 1 : span <= 14 ? 2 : 4
    const t = Math.max(4, Math.min(w, h) * 0.018)
    for (let x = Math.ceil(view.xmin / step) * step; x <= view.xmax; x += step) {
      if (Math.abs(x) < 1e-9) continue
      const px = X(x)
      s += '<line x1="' + n1(px) + '" y1="' + n1(y0 - t) + '" x2="' + n1(px) + '" y2="' + n1(y0 + t) + '" stroke="' + stroke + '" stroke-width="' + n1(thin) + '"/>'
    }
    for (let y = Math.ceil(view.ymin / step) * step; y <= view.ymax; y += step) {
      if (Math.abs(y) < 1e-9) continue
      const py = Y(y)
      s += '<line x1="' + n1(x0 - t) + '" y1="' + n1(py) + '" x2="' + n1(x0 + t) + '" y2="' + n1(py) + '" stroke="' + stroke + '" stroke-width="' + n1(thin) + '"/>'
    }
  }
  s += textSvg(Math.min(w - 10, x0 + 10), Math.max(12, y0 - 12), 'x', Math.max(11, Math.min(w, h) * 0.055), stroke, 'start')
  s += textSvg(Math.max(14, x0 + 12), Math.min(h - 12, 14), 'y', Math.max(11, Math.min(w, h) * 0.055), stroke, 'start')
  s += textSvg(x0 - 9, y0 + 13, 'O', Math.max(10, Math.min(w, h) * 0.05), stroke, 'middle')
  return s
}

// ---------------------------------------------------------------------------
// 函数图像
// ---------------------------------------------------------------------------

export interface Ctx { w: number; h: number; stroke: string; sw: number; view: View; m: Mapper }

export interface FunctionDef {
  label: string
  f: (x: number) => number
  view: View
  /** 额外元素（虚线渐近线等） */
  extra?: (c: Ctx) => string
  /** 不画坐标轴（个别图自带） */
  noAxes?: boolean
}

const TAU = Math.PI * 2
const { PI } = Math

export const FUNCTIONS: Record<string, FunctionDef> = {
  linear: { label: '一次函数 y=x+1', f: (x) => x + 1, view: { xmin: -4, xmax: 4, ymin: -4, ymax: 5 } },
  parabola: { label: '二次函数 y=x²', f: (x) => x * x, view: { xmin: -3.2, xmax: 3.2, ymin: -1.6, ymax: 8.6 } },
  cubic: { label: '三次函数 y=x³', f: (x) => x * x * x, view: { xmin: -2.2, xmax: 2.2, ymin: -5, ymax: 5 } },
  absolute: { label: '绝对值 y=|x|', f: (x) => Math.abs(x), view: { xmin: -4.2, xmax: 4.2, ymin: -1.2, ymax: 5 } },
  sqrt: { label: '根式 y=√x', f: (x) => Math.sqrt(x), view: { xmin: -1.2, xmax: 9.5, ymin: -1, ymax: 3.6 } },
  reciprocal: { label: '反比例 y=1/x', f: (x) => 1 / x, view: { xmin: -6, xmax: 6, ymin: -6, ymax: 6 } },
  hook: {
    label: '双钩 y=x+1/x', f: (x) => x + 1 / x, view: { xmin: -5.5, xmax: 5.5, ymin: -6, ymax: 6 },
    extra: (c) => lineSvg(c.m.X(c.view.xmin), c.m.Y(c.view.ymin), c.m.X(c.view.xmax), c.m.Y(c.view.ymax), c.stroke, Math.max(1, c.sw * 0.6), '6 5'),
  },
  tangent: {
    label: '正切 y=tan x', f: Math.tan, view: { xmin: -TAU, xmax: TAU, ymin: -4, ymax: 4 },
    extra: (c) => {
      let s = ''
      for (const k of [-1.5, -0.5, 0.5, 1.5]) {
        const x = k * PI
        s += lineSvg(c.m.X(x), c.m.Y(c.view.ymax), c.m.X(x), c.m.Y(c.view.ymin), c.stroke, Math.max(1, c.sw * 0.55), '5 5')
      }
      return s
    },
  },
  sine: { label: '正弦 y=sin x', f: Math.sin, view: { xmin: -TAU, xmax: TAU, ymin: -1.7, ymax: 1.7 } },
  cosine: { label: '余弦 y=cos x', f: Math.cos, view: { xmin: -TAU, xmax: TAU, ymin: -1.7, ymax: 1.7 } },
  sinusoid: { label: '正弦型 y=2sin(2x+π/6)', f: (x) => 2 * Math.sin(2 * x + PI / 6), view: { xmin: -PI, xmax: PI, ymin: -2.7, ymax: 2.7 } },
  exponential: { label: '指数 y=2ˣ', f: (x) => Math.pow(2, x), view: { xmin: -4, xmax: 4, ymin: -1.2, ymax: 8.5 } },
  expDecay: { label: '指数 y=(1/2)ˣ', f: (x) => Math.pow(0.5, x), view: { xmin: -4, xmax: 4, ymin: -1.2, ymax: 8.5 } },
  logarithm: { label: '对数 y=log₂x', f: (x) => Math.log2(x), view: { xmin: -1.2, xmax: 8.5, ymin: -3.2, ymax: 3.4 } },
}

export function functionFigure(kind: string, w: number, h: number, stroke: string, sw: number): string {
  const def = FUNCTIONS[kind]
  if (!def) return ''
  const view = def.view
  const m = mapper(view, w, h)
  const ctx: Ctx = { w, h, stroke, sw, view, m }
  let s = def.noAxes ? '' : axesSvg(view, w, h, stroke, sw)
  if (def.extra) s += def.extra(ctx)
  const d = plotFunction(def.f, view, w, h)
  if (d) {
    s += '<path d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="' + n1(sw) +
      '" stroke-linecap="round" stroke-linejoin="round"/>'
  }
  return s
}

// ---------------------------------------------------------------------------
// 圆锥曲线
// ---------------------------------------------------------------------------

export const CONICS: Record<string, { label: string; view: View }> = {
  conicCircle: { label: '圆 x²+y²=r²', view: { xmin: -3.4, xmax: 3.4, ymin: -3, ymax: 3 } },
  ellipse: { label: '椭圆（焦点·顶点）', view: { xmin: -5, xmax: 5, ymin: -3.6, ymax: 3.6 } },
  hyperbola: { label: '双曲线（焦点·渐近线）', view: { xmin: -6, xmax: 6, ymin: -4.6, ymax: 4.6 } },
  conicParabola: { label: '抛物线 y²=2px（焦点·准线）', view: { xmin: -2.6, xmax: 6, ymin: -4.4, ymax: 4.4 } },
  conicFocusDir: { label: '圆锥曲线统一定义', view: { xmin: -2.6, xmax: 6, ymin: -4.4, ymax: 4.4 } },
}

export function conicFigure(kind: string, w: number, h: number, stroke: string, sw: number, fill = 'none'): string {
  const def = CONICS[kind]
  if (!def) return ''
  const view = def.view
  const m = mapper(view, w, h)
  const { X, Y } = m
  const m0 = Math.min(w, h)
  const thin = Math.max(1, sw * 0.55)
  const fs = Math.max(11, m0 * 0.055)
  const r = Math.max(2.2, m0 * 0.014)
  const dash = '6 5'
  const curve = (d: string) => d
    ? '<path d="' + d + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + n1(sw) +
      '" stroke-linecap="round" stroke-linejoin="round"/>'
    : ''
  let s = axesSvg(view, w, h, stroke, sw, false)
  const label = (x: number, y: number, t: string, dx = 0, dy = 0) => textSvg(X(x) + dx, Y(y) + dy, t, fs, stroke)

  if (kind === 'conicCircle') {
    const R = 2
    s += curve(plotParametric((t) => R * Math.cos(t), (t) => R * Math.sin(t), 0, TAU, view, w, h))
    s += dotSvg(X(0), Y(0), r, stroke)
    s += label(0, 0, 'O', -fs * 0.8, fs * 0.9)
    s += lineSvg(X(0), Y(0), X(R), Y(0), stroke, thin)
    s += dotSvg(X(R), Y(0), r * 0.85, stroke)
    s += label(R, 0, 'r', 0, -fs * 0.85)
  } else if (kind === 'ellipse') {
    const a = 4, b = 3, c = Math.sqrt(a * a - b * b)
    s += curve(plotParametric((t) => a * Math.cos(t), (t) => b * Math.sin(t), 0, TAU, view, w, h))
    s += lineSvg(X(-a), Y(0), X(a), Y(0), stroke, thin, dash)
    s += dotSvg(X(-c), Y(0), r, stroke) + dotSvg(X(c), Y(0), r, stroke)
    s += label(-c, 0, 'F₁', 0, fs * 1.1) + label(c, 0, 'F₂', 0, fs * 1.1)
    s += dotSvg(X(0), Y(0), r, stroke) + label(0, 0, 'O', -fs * 0.9, fs * 0.95)
    s += label(-a, 0, 'A₁', -fs * 0.75, -fs * 0.9) + label(a, 0, 'A₂', fs * 0.75, -fs * 0.9)
  } else if (kind === 'hyperbola') {
    const a = 2.5, b = 2, c = Math.sqrt(a * a + b * b)
    const u = 1.75
    s += curve(plotParametric((t) => a * Math.cosh(t), (t) => b * Math.sinh(t), -u, u, view, w, h))
    s += curve(plotParametric((t) => -a * Math.cosh(t), (t) => b * Math.sinh(t), -u, u, view, w, h))
    // 渐近线 y = ±(b/a)x
    const xa = view.xmax
    s += lineSvg(X(-xa), Y(-(b / a) * -xa), X(xa), Y((b / a) * xa), stroke, thin, dash)
    s += lineSvg(X(-xa), Y((b / a) * -xa), X(xa), Y(-(b / a) * xa), stroke, thin, dash)
    s += dotSvg(X(-c), Y(0), r, stroke) + dotSvg(X(c), Y(0), r, stroke)
    s += label(-c, 0, 'F₁', 0, fs * 1.15) + label(c, 0, 'F₂', 0, fs * 1.15)
    s += dotSvg(X(-a), Y(0), r * 0.9, stroke) + dotSvg(X(a), Y(0), r * 0.9, stroke)
    s += label(-a, 0, 'A₁', -fs * 0.7, -fs * 0.95) + label(a, 0, 'A₂', fs * 0.7, -fs * 0.95)
  } else if (kind === 'conicParabola' || kind === 'conicFocusDir') {
    const p = 2                            // y² = 2px，焦点 (p/2, 0)，准线 x = -p/2
    const yMax = Math.min(view.ymax, Math.sqrt(2 * p * view.xmax) * 0.98)
    s += curve(plotParametric((t) => (t * t) / (2 * p), (t) => t, -yMax, yMax, view, w, h))
    s += lineSvg(X(-p / 2), Y(view.ymin), X(-p / 2), Y(view.ymax), stroke, thin, dash)
    s += dotSvg(X(p / 2), Y(0), r, stroke)
    s += label(p / 2, 0, 'F', 0, fs * 1.2)
    if (kind === 'conicFocusDir') {
      const y0 = 1.7
      const px = (y0 * y0) / (2 * p), py = y0
      s += dotSvg(X(px), Y(py), r, stroke)
      s += label(px, py, 'P', fs * 0.9, -fs * 0.95)
      s += lineSvg(X(p / 2), Y(0), X(px), Y(py), stroke, thin)
      s += lineSvg(X(px), Y(py), X(-p / 2), Y(py), stroke, thin)
      s += dotSvg(X(-p / 2), Y(py), r * 0.85, stroke)
      s += label(-p / 2, py, 'H', -fs * 0.85, -fs * 0.85)
    } else {
      s += label(-p / 2, view.ymax - 0.35, '准线', -fs * 1.5, 0)
    }
  }
  return s
}

export const FUNCTION_KINDS = Object.keys(FUNCTIONS)
export const CONIC_KINDS = Object.keys(CONICS)
