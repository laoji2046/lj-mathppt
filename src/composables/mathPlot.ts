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
/** 刻度配置：step=刻度间隔（数学单位）；pi=按弧度标注（π/2、π、3π/2…）；yLabels=要标数字的 y 值 */
export interface TickCfg { step?: number; pi?: boolean; yLabels?: number[] }

/** 把弧度值写成课本样式：π/2、π、3π/2、2π（负号用数学减号） */
export function piLabel(v: number): string {
  const k = Math.round(v / (Math.PI / 2))
  if (!k) return ''
  const sign = k < 0 ? '−' : ''
  const a = Math.abs(k)
  if (a === 1) return sign + 'π/2'
  if (a === 2) return sign + 'π'
  if (a % 2 === 1) return sign + a + 'π/2'
  return sign + (a / 2) + 'π'
}

export function axesSvg(view: View, w: number, h: number, stroke: string, sw: number, withTicks = true, cfg: TickCfg = {}): string {
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
  const tickFs = Math.max(10, Math.min(w, h) * 0.05)
  if (withTicks) {
    const span = view.xmax - view.xmin
    const step = cfg.step || (span <= 6 ? 1 : span <= 14 ? 2 : 4)
    const t = Math.max(4, Math.min(w, h) * 0.018)
    for (let x = Math.ceil(view.xmin / step - 1e-6) * step; x <= view.xmax; x += step) {
      if (Math.abs(x) < 1e-6) continue
      const px = X(x)
      s += '<line x1="' + n1(px) + '" y1="' + n1(y0 - t) + '" x2="' + n1(px) + '" y2="' + n1(y0 + t) + '" stroke="' + stroke + '" stroke-width="' + n1(thin) + '"/>'
      // 弧度刻度（三角函数）：在轴下方标出 π/2、π、3π/2…（贴边的不标，避免被裁）
      if (cfg.pi && px > tickFs * 1.7 && px < w - tickFs * 1.7) {
        s += textSvg(px, y0 + tickFs * 1.05, piLabel(x), tickFs, stroke, 'middle')
      }
    }
    if (!cfg.pi) {
      for (let y = Math.ceil(view.ymin / step) * step; y <= view.ymax; y += step) {
        if (Math.abs(y) < 1e-6) continue
        const py = Y(y)
        s += '<line x1="' + n1(x0 - t) + '" y1="' + n1(py) + '" x2="' + n1(x0 + t) + '" y2="' + n1(py) + '" stroke="' + stroke + '" stroke-width="' + n1(thin) + '"/>'
      }
    }
    // 指定的 y 值：画刻度 + 左侧数字（如三角函数标 ±1）
    for (const y of cfg.yLabels || []) {
      if (y <= view.ymin || y >= view.ymax) continue
      const py = Y(y)
      s += '<line x1="' + n1(x0 - t) + '" y1="' + n1(py) + '" x2="' + n1(x0 + t) + '" y2="' + n1(py) + '" stroke="' + stroke + '" stroke-width="' + n1(thin) + '"/>'
      s += textSvg(x0 - t - tickFs * 0.35, py, (y < 0 ? '−' : '') + Math.abs(y), tickFs, stroke, 'end')
    }
  }
  // 轴标放在轴的末端（x 在右端上方、y 在上端右侧），不要贴在原点旁边
  const fs = Math.max(11, Math.min(w, h) * 0.055)
  s += textSvg(w - head * 0.35, Math.max(fs * 0.95, y0 - fs * 0.95), 'x', fs, stroke, 'end')
  s += textSvg(Math.min(w - fs, x0 + fs * 0.85), Math.max(fs * 0.95, head * 0.9), 'y', fs, stroke, 'start')
  s += textSvg(x0 - 9, y0 + 13, 'O', Math.max(10, Math.min(w, h) * 0.05), stroke, 'middle')
  return s
}

// ---------------------------------------------------------------------------
// 函数图像
// ---------------------------------------------------------------------------

export interface Ctx { w: number; h: number; stroke: string; sw: number; fs: number; view: View; m: Mapper }

/** 关键点标记：小圆点 + 坐标文字（如指数函数的 (0,1)、对数函数的 (1,0)） */
export function keyPointSvg(c: Ctx, x: number, y: number, text: string): string {
  const px = c.m.X(x), py = c.m.Y(y)
  const r = Math.max(2.6, Math.min(c.w, c.h) * 0.014)
  return dotSvg(px, py, r, c.stroke) +
    textSvg(px + c.fs * 0.45, py - c.fs * 0.9, text, c.fs, c.stroke, 'start')
}

/** 可调参数的描述（属性面板据此生成输入框） */
export interface ParamSpec { key: string; label: string; def: number; step?: number; min?: number; max?: number }

/** 分段函数的一段：f 在 [from, to] 上 */
export interface Piece { f: (x: number, p: Record<string, number>) => number; from: number; to: number }

/** 空心点（分段函数断点处"取不到"的那个端点） */
export function openDotSvg(c: Ctx, x: number, y: number): string {
  const px = c.m.X(x), py = c.m.Y(y)
  const r = Math.max(2.6, Math.min(c.w, c.h) * 0.014)
  return '<circle cx="' + n1(px) + '" cy="' + n1(py) + '" r="' + n1(r) + '" fill="#fff" stroke="' + c.stroke +
    '" stroke-width="' + n1(Math.max(1.2, c.sw * 0.7)) + '"/>'
}

/** 参数值格式化（整数不带小数点） */
export function fmt2(n: number): string {
  const s = Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : n.toFixed(2)
  return s.replace('-', '−')   // 用数学减号，和 π 刻度保持一致
}

export interface FunctionDef {
  label: string
  f: (x: number, p: Record<string, number>) => number
  view: View
  /** 视图随参数变化（如振幅 A 变了，y 轴范围跟着变） */
  viewOf?: (p: Record<string, number>) => View
  /** 分段函数：按段分别采样（各段端点各自取到，免去人为断点） */
  pieces?: Piece[]
  /** 可调参数（属性面板生成输入框，如 y=Asin(ωx+φ) 的 A/ω/φ） */
  params?: ParamSpec[]
  /** 额外元素（虚线渐近线、关键点等） */
  extra?: (c: Ctx, p: Record<string, number>) => string
  /** 不画坐标轴（个别图自带） */
  noAxes?: boolean
  /** 刻度配置（三角函数用 π 弧度、指数/对数标 y 值）；tickOf 随参数变化 */
  tick?: TickCfg
  tickOf?: (p: Record<string, number>) => TickCfg
}

/** 取某个图形的可调参数说明（无参数返回空数组） */
export function figureParams(kind: string): ParamSpec[] {
  return FUNCTIONS[kind]?.params ?? []
}

/** 把外部参数与默认值合并 */
export function withParams(kind: string, params?: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const sp of figureParams(kind)) out[sp.key] = typeof params?.[sp.key] === 'number' ? (params as any)[sp.key] : sp.def
  return out
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
  hook: { label: '双钩 y=x+1/x', f: (x) => x + 1 / x, view: { xmin: -5.5, xmax: 5.5, ymin: -6, ymax: 6 } },
  tangent: {
    label: '正切 y=tan x', f: Math.tan, view: { xmin: -7, xmax: 7, ymin: -4, ymax: 4 },
    tick: { step: PI / 2, pi: true },
    extra: (c) => {
      let s = ''
      for (const k of [-1.5, -0.5, 0.5, 1.5]) {
        const x = k * PI
        s += lineSvg(c.m.X(x), c.m.Y(c.view.ymax), c.m.X(x), c.m.Y(c.view.ymin), c.stroke, Math.max(1, c.sw * 0.55), '5 5')
      }
      return s
    },
  },
  // 三角函数：x 轴按弧度标注（π/2、π、3π/2、2π），y 轴标 ±1；
  // 视图左右各留一点余量，免得 π 刻度贴边被裁
  sine: {
    label: '正弦 y=sin x', f: Math.sin, view: { xmin: -7, xmax: 7, ymin: -1.7, ymax: 1.7 },
    tick: { step: PI / 2, pi: true, yLabels: [1, -1] },
  },
  cosine: {
    label: '余弦 y=cos x', f: Math.cos, view: { xmin: -7, xmax: 7, ymin: -1.7, ymax: 1.7 },
    tick: { step: PI / 2, pi: true, yLabels: [1, -1] },
  },
  // 可调参数版：A / ω / φ 都能在属性面板里改；虚线画出参考正弦 y=sin x，方便看变换
  sinusoid: {
    label: '正弦型 y=Asin(ωx+φ)（可调参数）',
    params: [
      { key: 'A', label: '振幅 A', def: 2, step: 0.5, min: 0.2, max: 5 },
      { key: 'w', label: '角频率 ω', def: 2, step: 0.5, min: 0.5, max: 6 },
      { key: 'phi', label: '初相 φ', def: PI / 6, step: 0.5236, min: -PI, max: PI },
    ],
    f: (x, p) => p.A * Math.sin(p.w * x + p.phi),
    // 默认视图（A=2 时与 viewOf 一致）；实际绘制一律走 viewOf
    view: { xmin: -3.7, xmax: 3.7, ymin: -3, ymax: 3 },
    viewOf: (p) => ({ xmin: -3.7, xmax: 3.7, ymin: -(p.A * 1.3 + 0.4), ymax: p.A * 1.3 + 0.4 }),
    tickOf: (p) => ({ step: PI / 2, pi: true, yLabels: [p.A, -p.A] }),
    extra: (c) => {
      const d = plotFunction((x) => Math.sin(x), c.view, c.w, c.h)
      return d
        ? '<path d="' + d + '" fill="none" stroke="' + c.stroke + '" stroke-width="' + (c.sw * 0.6).toFixed(2) +
          '" stroke-dasharray="6 5" opacity="0.5"/>'
        : ''
    },
  },
  // 分段函数：x<0 取 x²、x≥0 取 x+1；断点处实心点表示"取到"、空心点表示"取不到"
  piecewise: {
    label: '分段函数（实心/空心点）',
    f: (x) => (x < 0 ? x * x : x + 1),
    pieces: [
      { f: (x) => x * x, from: -2.6, to: 0 },
      { f: (x) => x + 1, from: 0, to: 3.4 },
    ],
    view: { xmin: -2.9, xmax: 3.7, ymin: -1.4, ymax: 4.9 },
    extra: (c) => keyPointSvg(c, 0, 1, '(0,1)') + openDotSvg(c, 0, 0),
  },
  // 含参二次函数：对称轴随 a 移动，讲"区间最值 / 含参讨论"用
  paramQuadratic: {
    label: '含参二次函数 y=x²−2ax+1（可调 a）',
    params: [{ key: 'a', label: '参数 a', def: 1, step: 0.5, min: -3, max: 3 }],
    f: (x, p) => x * x - 2 * p.a * x + 1,
    view: { xmin: -4.6, xmax: 4.6, ymin: -4.5, ymax: 9.5 },
    extra: (c, p) => {
      const vy = 1 - p.a * p.a
      let s = lineSvg(c.m.X(p.a), c.m.Y(c.view.ymin), c.m.X(p.a), c.m.Y(c.view.ymax), c.stroke, Math.max(1, c.sw * 0.55), '6 5')
      s += keyPointSvg(c, p.a, vy, '(' + fmt2(p.a) + ',' + fmt2(vy) + ')')
      s += textSvg(c.m.X(p.a) + c.fs * 0.4, c.m.Y(c.view.ymax) + c.fs * 1.1, 'x=a', c.fs, c.stroke, 'start')
      return s
    },
  },
  // 含参绝对值：顶点沿 x 轴平移
  paramAbs: {
    label: '含参绝对值 y=|x−a|（可调 a）',
    params: [{ key: 'a', label: '参数 a', def: 1, step: 0.5, min: -3, max: 3 }],
    f: (x, p) => Math.abs(x - p.a),
    view: { xmin: -4.6, xmax: 4.6, ymin: -1.4, ymax: 5 },
    extra: (c, p) => keyPointSvg(c, p.a, 0, '(' + fmt2(p.a) + ',0)'),
  },
  // 指数 / 对数：教科书都要标出定点 (0,1) / (1,0)
  exponential: {
    label: '指数 y=2ˣ', f: (x) => Math.pow(2, x), view: { xmin: -4, xmax: 4, ymin: -1.2, ymax: 8.5 },
    extra: (c) => keyPointSvg(c, 0, 1, '(0,1)'),
  },
  expDecay: {
    label: '指数 y=(1/2)ˣ', f: (x) => Math.pow(0.5, x), view: { xmin: -4, xmax: 4, ymin: -1.2, ymax: 8.5 },
    extra: (c) => keyPointSvg(c, 0, 1, '(0,1)'),
  },
  logarithm: {
    label: '对数 y=log₂x', f: (x) => Math.log2(x), view: { xmin: -1.2, xmax: 8.5, ymin: -3.2, ymax: 3.4 },
    extra: (c) => keyPointSvg(c, 1, 0, '(1,0)'),
  },
}

export function functionFigure(kind: string, w: number, h: number, stroke: string, sw: number, params?: Record<string, number>): string {
  const def = FUNCTIONS[kind]
  if (!def) return ''
  const p = withParams(kind, params)
  const view = def.viewOf ? def.viewOf(p) : def.view
  const m = mapper(view, w, h)
  const ctx: Ctx = { w, h, stroke, sw, fs: Math.max(11, Math.min(w, h) * 0.055), view, m }
  const tick = def.tickOf ? def.tickOf(p) : def.tick
  let s = def.noAxes ? '' : axesSvg(view, w, h, stroke, sw, true, tick)
  if (def.extra) s += def.extra(ctx, p)
  const curve = (d: string) => d
    ? '<path d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="' + n1(sw) +
      '" stroke-linecap="round" stroke-linejoin="round"/>'
    : ''
  if (def.pieces) {
    for (const pc of def.pieces) s += curve(plotFunction((x) => pc.f(x, p), { ...view, xmin: pc.from, xmax: pc.to }, w, h))
  } else {
    s += curve(plotFunction((x) => def.f(x, p), view, w, h))
  }
  return s
}

// ---------------------------------------------------------------------------
// 圆锥曲线
// ---------------------------------------------------------------------------

export const CONICS: Record<string, { label: string; view: View }> = {
  // —— 焦点在 x 轴 ——
  conicCircle: { label: '圆 x²+y²=r²', view: { xmin: -3.6, xmax: 3.6, ymin: -3.2, ymax: 3.2 } },
  ellipse: { label: '椭圆（焦点在 x 轴）', view: { xmin: -5.4, xmax: 5.4, ymin: -4, ymax: 4 } },
  hyperbola: { label: '双曲线（焦点在 x 轴）', view: { xmin: -6.6, xmax: 6.6, ymin: -4.8, ymax: 4.8 } },
  conicParabola: { label: '抛物线 y²=2px（焦点在 x 轴）', view: { xmin: -4.6, xmax: 8.2, ymin: -6, ymax: 6 } },
  conicFocusDir: { label: '圆锥曲线统一定义（焦点·准线）', view: { xmin: -4.6, xmax: 8.2, ymin: -6, ymax: 6 } },
  // —— 带准线 / 离心率 ——
  ellipseDirectrix: { label: '椭圆（焦点·准线）', view: { xmin: -7.6, xmax: 7.6, ymin: -4.1, ymax: 4.1 } },
  hyperbolaDirectrix: { label: '双曲线（焦点·准线）', view: { xmin: -6.9, xmax: 6.9, ymin: -4.9, ymax: 4.9 } },
  ellipseFamily: { label: '椭圆族（离心率 e 变化）', view: { xmin: -5, xmax: 5, ymin: -4.7, ymax: 4.7 } },
  hyperbolaFamily: { label: '双曲线族（离心率 e 变化）', view: { xmin: -6.2, xmax: 6.2, ymin: -6.2, ymax: 6.2 } },
  eccAnim: { label: '椭圆离心率变化（动画）', view: { xmin: -5.3, xmax: 5.3, ymin: -4.5, ymax: 4.5 } },
  // —— 焦点在 y 轴 ——
  ellipseV: { label: '椭圆（焦点在 y 轴）', view: { xmin: -4.4, xmax: 4.4, ymin: -5.6, ymax: 5.6 } },
  hyperbolaV: { label: '双曲线（焦点在 y 轴）', view: { xmin: -5.6, xmax: 5.6, ymin: -6.4, ymax: 6.4 } },
  conicParabolaV: { label: '抛物线 x²=2py（焦点在 y 轴）', view: { xmin: -5.4, xmax: 5.4, ymin: -3.6, ymax: 7.6 } },
  conicCircleY: { label: '圆（圆心在 y 轴·与 x 轴相切）', view: { xmin: -4.4, xmax: 4.4, ymin: -1.8, ymax: 7 } },
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
  const dot = (x: number, y: number, k = 1) => dotSvg(X(x), Y(y), r * k, stroke)

  if (kind === 'conicCircle') {
    const R = 2
    s += curve(plotParametric((t) => R * Math.cos(t), (t) => R * Math.sin(t), 0, TAU, view, w, h))
    s += dot(0, 0)
    s += lineSvg(X(0), Y(0), X(R), Y(0), stroke, thin)
    s += dot(R, 0, 0.85) + label(R, 0, 'r', 0, -fs * 0.85)
  } else if (kind === 'conicCircleY') {
    // 圆心在 y 轴上、与 x 轴相切于原点：x² + (y−R)² = R²
    const R = 2
    s += curve(plotParametric((t) => R * Math.cos(t), (t) => R + R * Math.sin(t), 0, TAU, view, w, h))
    s += dot(0, R) + label(0, R, 'C', -fs * 0.85, -fs * 0.9)
    s += lineSvg(X(0), Y(R), X(R), Y(R), stroke, thin)
    s += dot(R, R, 0.85) + label(R, R, 'r', 0, -fs * 0.85)
    s += dot(0, 0, 0.85)                  // 与 x 轴的切点（原点，O 由坐标轴标注）
  } else if (kind === 'ellipse') {
    const a = 4, b = 3, c = Math.sqrt(a * a - b * b)
    s += curve(plotParametric((t) => a * Math.cos(t), (t) => b * Math.sin(t), 0, TAU, view, w, h))
    s += lineSvg(X(-a), Y(0), X(a), Y(0), stroke, thin, dash)
    s += dot(-c, 0) + dot(c, 0)
    s += label(-c, 0, 'F₁', 0, fs * 1.15) + label(c, 0, 'F₂', 0, fs * 1.15)
    s += dot(0, 0)
    s += label(-a, 0, 'A₁', -fs * 0.8, -fs * 0.9) + label(a, 0, 'A₂', fs * 0.8, -fs * 0.9)
  } else if (kind === 'ellipseV') {
    // x²/b² + y²/a² = 1（长轴在 y 轴上），焦点 F₁(0,−c)、F₂(0,c)
    const a = 4, b = 3, c = Math.sqrt(a * a - b * b)
    s += curve(plotParametric((t) => b * Math.cos(t), (t) => a * Math.sin(t), 0, TAU, view, w, h))
    s += lineSvg(X(0), Y(-a), X(0), Y(a), stroke, thin, dash)
    s += dot(0, -c) + dot(0, c)
    s += label(0, -c, 'F₁', fs * 1.25, 0) + label(0, c, 'F₂', fs * 1.25, 0)
    s += dot(0, 0)
    s += label(0, -a, 'A₁', fs * 1.1, -fs * 0.95) + label(0, a, 'A₂', fs * 1.1, fs * 0.95)
  } else if (kind === 'hyperbola') {
    const a = 2.5, b = 2, c = Math.sqrt(a * a + b * b)
    const u = 1.28                        // 曲线止于 x≈±5.2，坐标轴再长出去一截
    s += curve(plotParametric((t) => a * Math.cosh(t), (t) => b * Math.sinh(t), -u, u, view, w, h))
    s += curve(plotParametric((t) => -a * Math.cosh(t), (t) => b * Math.sinh(t), -u, u, view, w, h))
    // 渐近线 y = ±(b/a)x
    const xa = view.xmax * 0.98
    s += lineSvg(X(-xa), Y(-(b / a) * -xa), X(xa), Y((b / a) * xa), stroke, thin, dash)
    s += lineSvg(X(-xa), Y((b / a) * -xa), X(xa), Y(-(b / a) * xa), stroke, thin, dash)
    s += dot(-c, 0) + dot(c, 0)
    s += label(-c, 0, 'F₁', 0, fs * 1.15) + label(c, 0, 'F₂', 0, fs * 1.15)
    s += dot(-a, 0, 0.9) + dot(a, 0, 0.9)
    s += label(-a, 0, 'A₁', -fs * 0.75, -fs * 0.95) + label(a, 0, 'A₂', fs * 0.75, -fs * 0.95)
  } else if (kind === 'hyperbolaV') {
    // y²/a² − x²/b² = 1（实轴在 y 轴上），焦点 F₁(0,−c)、F₂(0,c)，渐近线 y = ±(a/b)x
    const a = 2.5, b = 2, c = Math.sqrt(a * a + b * b)
    const u = 1.42
    s += curve(plotParametric((t) => b * Math.sinh(t), (t) => a * Math.cosh(t), -u, u, view, w, h))
    s += curve(plotParametric((t) => b * Math.sinh(t), (t) => -a * Math.cosh(t), -u, u, view, w, h))
    const xa = view.xmax * 0.98
    s += lineSvg(X(-xa), Y(-(a / b) * -xa), X(xa), Y((a / b) * xa), stroke, thin, dash)
    s += lineSvg(X(-xa), Y((a / b) * -xa), X(xa), Y(-(a / b) * xa), stroke, thin, dash)
    s += dot(0, -c) + dot(0, c)
    s += label(0, -c, 'F₁', fs * 1.25, 0) + label(0, c, 'F₂', fs * 1.25, 0)
    s += dot(0, -a, 0.9) + dot(0, a, 0.9)
    s += label(0, -a, 'A₁', fs * 1.15, -fs * 0.9) + label(0, a, 'A₂', fs * 1.15, fs * 0.9)
  } else if (kind === 'conicParabola' || kind === 'conicFocusDir') {
    const p = 2                            // y² = 2px，焦点 (p/2, 0)，准线 x = −p/2
    const yMax = Math.min(view.ymax * 0.88, Math.sqrt(2 * p * view.xmax * 0.86))
    s += curve(plotParametric((t) => (t * t) / (2 * p), (t) => t, -yMax, yMax, view, w, h))
    s += lineSvg(X(-p / 2), Y(view.ymin), X(-p / 2), Y(view.ymax), stroke, thin, dash)
    s += dot(p / 2, 0) + label(p / 2, 0, 'F', 0, fs * 1.25)
    if (kind === 'conicFocusDir') {
      const y0 = 1.7
      const px = (y0 * y0) / (2 * p), py = y0
      s += dot(px, py) + label(px, py, 'P', fs * 0.95, -fs * 0.95)
      s += lineSvg(X(p / 2), Y(0), X(px), Y(py), stroke, thin)
      s += lineSvg(X(px), Y(py), X(-p / 2), Y(py), stroke, thin)
      s += dot(-p / 2, py, 0.85) + label(-p / 2, py, 'H', -fs * 0.85, -fs * 0.85)
    } else {
      s += label(-p / 2, view.ymax * 0.92, '准线', -fs * 1.6, 0)
    }
  } else if (kind === 'conicParabolaV') {
    const p = 2                            // x² = 2py，焦点 (0, p/2)，准线 y = −p/2
    const xMax = Math.min(view.xmax * 0.88, Math.sqrt(2 * p * view.ymax * 0.86))
    s += curve(plotParametric((t) => t, (t) => (t * t) / (2 * p), -xMax, xMax, view, w, h))
    s += lineSvg(X(view.xmin), Y(-p / 2), X(view.xmax), Y(-p / 2), stroke, thin, dash)
    s += dot(0, p / 2) + label(0, p / 2, 'F', -fs * 0.95, fs * 0.2)
    s += label(view.xmax * 0.86, -p / 2, '准线', 0, -fs * 0.9)
  } else if (kind === 'ellipseDirectrix') {
    // 椭圆 x²/a²+y²/b²=1：焦点 F(±c,0)、准线 x=±a²/c；第二定义 PF/PH = e（图中画出 PF₂ 与 PH）
    const a = 4, b = 3, c = Math.sqrt(a * a - b * b), dx = (a * a) / c
    s += curve(plotParametric((t) => a * Math.cos(t), (t) => b * Math.sin(t), 0, TAU, view, w, h))
    s += lineSvg(X(dx), Y(view.ymin), X(dx), Y(view.ymax), stroke, thin, dash)
    s += lineSvg(X(-dx), Y(view.ymin), X(-dx), Y(view.ymax), stroke, thin, dash)
    s += dot(-c, 0) + dot(c, 0)
    s += label(-c, 0, 'F₁', 0, fs * 1.2) + label(c, 0, 'F₂', 0, fs * 1.2)
    s += dot(0, 0)   // 原点：O 由坐标轴统一标注，不重复标
    s += label(dx, view.ymax * 0.87, 'l₂', fs * 0.75, 0)
    s += label(-dx, view.ymax * 0.87, 'l₁', -fs * 0.75, 0)
    const pu = 2.1, px2 = a * Math.cos(pu), py2 = b * Math.sin(pu)
    s += lineSvg(X(c), Y(0), X(px2), Y(py2), stroke, thin)
    s += lineSvg(X(px2), Y(py2), X(dx), Y(py2), stroke, thin)
    s += dot(px2, py2) + label(px2, py2, 'P', fs * 0.9, -fs * 0.95)
    s += dot(dx, py2, 0.85) + label(dx, py2, 'H', fs * 0.8, -fs * 0.85)
  } else if (kind === 'hyperbolaDirectrix') {
    // 双曲线 x²/a²−y²/b²=1：焦点 F(±c,0)、准线 x=±a²/c、渐近线 y=±(b/a)x
    const a = 2.5, b = 2, c = Math.sqrt(a * a + b * b), dx = (a * a) / c
    const u = 1.28
    s += curve(plotParametric((t) => a * Math.cosh(t), (t) => b * Math.sinh(t), -u, u, view, w, h))
    s += curve(plotParametric((t) => -a * Math.cosh(t), (t) => b * Math.sinh(t), -u, u, view, w, h))
    const xa = view.xmax * 0.98
    s += lineSvg(X(-xa), Y((b / a) * -xa), X(xa), Y((b / a) * xa), stroke, thin, dash)
    s += lineSvg(X(-xa), Y(-(b / a) * -xa), X(xa), Y(-(b / a) * xa), stroke, thin, dash)
    s += lineSvg(X(dx), Y(view.ymin), X(dx), Y(view.ymax), stroke, thin, dash)
    s += lineSvg(X(-dx), Y(view.ymin), X(-dx), Y(view.ymax), stroke, thin, dash)
    s += dot(-c, 0) + dot(c, 0)
    s += label(-c, 0, 'F₁', 0, fs * 1.2) + label(c, 0, 'F₂', 0, fs * 1.2)
    s += dot(-a, 0, 0.9) + dot(a, 0, 0.9)
    s += label(-a, 0, 'A₁', -fs * 0.75, -fs * 0.95) + label(a, 0, 'A₂', fs * 0.75, -fs * 0.95)
    s += label(dx, view.ymax * 0.9, 'l₂', fs * 0.7, 0)
    s += label(-dx, view.ymax * 0.9, 'l₁', -fs * 0.7, 0)
  } else if (kind === 'ellipseFamily') {
    // 同一长半轴 a，离心率 e 越大越扁（e=0 即圆）
    const a = 4
    for (const e of [0, 0.4, 0.7, 0.9, 0.96]) {
      const b = a * Math.sqrt(Math.max(0.02, 1 - e * e))
      s += curve(plotParametric((t) => a * Math.cos(t), (t) => b * Math.sin(t), 0, TAU, view, w, h))
      s += label(0, b, 'e=' + e, fs * 0.62, -fs * 0.85)
    }
    s += dot(0, 0)   // 原点：O 由坐标轴统一标注，不重复标
  } else if (kind === 'hyperbolaFamily') {
    // 同一实半轴 a，离心率 e 越大开口越"张"（渐近线越陡）
    const a = 2
    for (const e of [1.3, 2, 3]) {
      const b = a * Math.sqrt(e * e - 1)
      const u = 1.35
      s += curve(plotParametric((t) => a * Math.cosh(t), (t) => b * Math.sinh(t), -u, u, view, w, h))
      s += curve(plotParametric((t) => -a * Math.cosh(t), (t) => b * Math.sinh(t), -u, u, view, w, h))
      s += label(a * Math.cosh(0.85), b * Math.sinh(0.85), 'e=' + e, fs * 0.55, -fs * 0.7)
    }
    s += dot(-a, 0, 0.9) + dot(a, 0, 0.9)
    s += dot(0, 0)   // 原点：O 由坐标轴统一标注，不重复标
  } else if (kind === 'eccAnim') {
    // 离心率变化的动画：SMIL 在若干关键帧之间补间（图形结构一致，浏览器可平滑插值）
    const a = 4
    const es = [0.05, 0.3, 0.55, 0.78, 0.92]
    const ds = es.map((e) => plotParametric((t) => a * Math.cos(t), (t) => a * Math.sqrt(1 - e * e) * Math.sin(t), 0, TAU, view, w, h, 96))
    const loop = ds.concat(ds.slice(0, -1).reverse())
    s += '<path d="' + ds[0] + '" fill="none" stroke="' + stroke + '" stroke-width="' + n1(sw) + '">' +
      '<animate attributeName="d" values="' + loop.join(';') + '" dur="9s" repeatCount="indefinite"/></path>'
    const cxList = es.map((e) => X(a * e))
    const cxLoop = cxList.concat(cxList.slice(0, -1).reverse())
    for (const side of [1, -1]) {
      s += '<circle cx="' + n1(side * cxList[0]) + '" cy="' + n1(Y(0)) + '" r="' + n1(r) + '" fill="' + stroke + '">' +
        '<animate attributeName="cx" values="' + cxLoop.map((v) => n1(side * v)).join(';') + '" dur="9s" repeatCount="indefinite"/></circle>'
    }
    s += textSvg(X(view.xmin) + fs * 0.8, Y(view.ymax) + fs * 1.3, 'e 增大 → 椭圆越扁', fs * 0.8, stroke, 'start')
    s += dot(0, 0)   // 原点：O 由坐标轴统一标注，不重复标
  }
  return s
}

export const FUNCTION_KINDS = Object.keys(FUNCTIONS)
export const CONIC_KINDS = Object.keys(CONICS)

/** 视图宽高比（宽/高） */
export function viewAspect(kind: string): number | null {
  const v = FUNCTIONS[kind]?.view ?? CONICS[kind]?.view
  if (!v) return null
  return (v.xmax - v.xmin) / (v.ymax - v.ymin)
}

/**
 * 按视图宽高比给出插入尺寸。元素 SVG 用 preserveAspectRatio="none"（可自由拉伸），
 * 只有框与视图同比例时图形才不变形 —— 圆才会是圆、抛物线才不会被压扁。
 */
export function figureBox(kind: string, baseW = 520, minH = 200, maxH = 680): { w: number; h: number } | null {
  const a = viewAspect(kind)
  if (!a) return null
  // 先按基准宽定高，超出上下限时改由高度反推宽度 —— 两条边至少一条达标，且**比例始终不变**
  let w = baseW
  let h = w / a
  if (h > maxH) { h = maxH; w = h * a }
  if (h < minH) { h = minH; w = h * a }
  return { w: Math.round(w), h: Math.round(h) }
}
