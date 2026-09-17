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
export interface ParamSpec {
  key: string; label: string; def: number; step?: number; min?: number; max?: number
  /** 只在**满足条件**时才在属性面板里显示（例如"线2"的参数在条数设为 1 时先藏起来） */
  showIf?: (p: Record<string, number>) => boolean
  /** 布尔参数：属性面板渲染成**勾选框**（值仍是 0 / 1，存在同一个 params 里） */
  bool?: boolean
}

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
  return FUNCTIONS[kind]?.params ?? CONICS[kind]?.params ?? []
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

  /**
   * **正态密度曲线**（可调 μ / σ ✓）——用户要求 ✓。
   *
   * f(x) = 1/(σ√2π) · e^(−(x−μ)²/(2σ²)) ✓（用户给的原式 ✓）
   * 峰值处画虚线并标出 1/(σ√2π) ✓（与用户给的示意图一致 ✓）。
   * ⚠ σ 必须 > 0 ✗ —— 这里统一用 max(0.2, σ) 兜底 ✓，避免除零把曲线拉飞 ✓。
   */
  normal: {
    label: '正态密度曲线（可调参数）',
    params: [
      { key: 'mu', label: '均值 μ', def: 0, step: 0.1, min: -5, max: 5 },
      { key: 'sigma', label: '标准差 σ', def: 1, step: 0.1, min: 0.2, max: 3 },
      { key: 'a', label: '左界 a', def: -1, step: 0.1, min: -5, max: 5 },
      { key: 'b', label: '右界 b', def: 1, step: 0.1, min: -5, max: 5 },
    ],
    f: (x, p) => {
      const s = Math.max(0.2, p.sigma)
      return Math.exp(-((x - p.mu) ** 2) / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI))
    },
    view: { xmin: -1.6, xmax: 1.6, ymin: -0.14, ymax: 0.45 },
    viewOf: (p) => {
      const s = Math.max(0.2, p.sigma)
      const peak = 1 / (s * Math.sqrt(2 * Math.PI))
      // ⭐ C 方案：x 收窄到 ±1.6 ✓ y 收紧到 peak×[−0.35, 1.12] ✓
      return { xmin: p.mu - 1.6, xmax: p.mu + 1.6, ymin: -peak * 0.35, ymax: peak * 1.12 }
    },
    extra: (c, p) => {
      const s = Math.max(0.2, p.sigma)
      const peak = 1 / (s * Math.sqrt(2 * Math.PI))
      const px = c.m.X(p.mu)
      const py = c.m.Y(peak)
      const y0 = c.m.Y(0)
      const sw = Math.max(1, c.sw * 0.55)
      // 曲线本体（与本图形 f 同一式子 ✓ 参数一致 ✓）
      const fn = (x: number) => Math.exp(-((x - p.mu) ** 2) / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI))
      // ⭐ 区间 [a,b] 的阴影 ✓（用户要求 ✓ 对应示意图里的面积 B ✓）
      //   采样后沿 x 轴闭合 ✓ 半透明填充 ✓ —— 透明度低 ✓ 曲线仍清晰可见 ✓。
      const a = Math.min(p.a ?? -1, p.b ?? 1)
      const b = Math.max(p.a ?? -1, p.b ?? 1)
      const steps = 60
      let d = 'M ' + n1(c.m.X(a)) + ' ' + n1(y0)
      for (let i = 0; i <= steps; i++) {
        const x = a + ((b - a) * i) / steps
        d += ' L ' + n1(c.m.X(x)) + ' ' + n1(c.m.Y(fn(x)))
      }
      d += ' L ' + n1(c.m.X(b)) + ' ' + n1(y0) + ' Z'
      const shade = '<path d="' + d + '" fill="' + c.stroke + '" opacity="0.18" stroke="none"/>'
      // a、b 处两条竖直细线 + 轴下标注 ✓
      const fs = Math.max(9, c.h * 0.072)
      const vline = (xv: number) =>
        '<line x1="' + n1(c.m.X(xv)) + '" y1="' + n1(y0) + '" x2="' + n1(c.m.X(xv)) + '" y2="' +
        n1(c.m.Y(fn(xv))) + '" stroke="' + c.stroke + '" stroke-width="' + n1(Math.max(0.8, c.sw * 0.4)) + '"/>'
      const vlabel = (xv: number, t: string) =>
        '<text x="' + n1(c.m.X(xv)) + '" y="' + n1(y0 + fs + 3) + '" font-size="' + n1(fs) +
        '" text-anchor="middle" fill="' + c.stroke + '">' + t + '</text>'
      const marks = vline(a) + vline(b) + vlabel(a, 'a') + vlabel(b, 'b')
      const dash =
        '<line x1="' + n1(px) + '" y1="' + n1(py) + '" x2="' + n1(px) + '" y2="' + n1(y0) +
        '" stroke="' + c.stroke + '" stroke-width="' + n1(sw) +
        '" stroke-dasharray="5 4" opacity="0.75"/>'
      const label =
        '<text x="' + n1(px + 5) + '" y="' + n1(Math.max(fs + 2, py - 5)) + '" font-size="' + n1(fs) +
        '" fill="' + c.stroke + '">1/(σ√2π)</text>'
      return shade + marks + dash + label
    },
  },
}
// ---------------------------------------------------------------------------
// 自定义函数（空白）：自己解析表达式，不 eval —— 安全、离线、无 CSP 问题
// ---------------------------------------------------------------------------

type Node = (x: number) => number

const FN1: Record<string, (v: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp,
  ln: Math.log, log: Math.log10, log2: Math.log2,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
}

/** 解析表达式成 x → y 的函数；语法不认识就返回 null（调用方提示用户）。
 *  支持：+ − * / ^ 、括号、常数 pi / e、单参函数（sin/cos/ln/sqrt/abs/…）。
 *  优先级按数学惯例：^ 高于 * / 高于 + −，且 -x^2 = -(x^2)、a^b^c 右结合。 */
export function compileExpr(src: string): ((x: number) => number) | null {
  const s = String(src || "").replace(/\s+/g, "").replace(/×/g, "*").replace(/÷/g, "/")
  if (!s) return null
  let i = 0
  const fail = (): never => { throw new Error("expr") }
  const expr = (): Node => {
    let a = term()
    for (;;) {
      if (s[i] === "+") { i++; const b = term(); const p = a; a = (x) => p(x) + b(x) }
      else if (s[i] === "-") { i++; const b = term(); const p = a; a = (x) => p(x) - b(x) }
      else return a
    }
  }
  const term = (): Node => {
    let a = unary()
    for (;;) {
      if (s[i] === "*") { i++; const b = unary(); const p = a; a = (x) => p(x) * b(x) }
      else if (s[i] === "/") { i++; const b = unary(); const p = a; a = (x) => p(x) / b(x) }
      // **隐式乘法**：2x、3(x+1)、2sin(x) 都当乘法 —— 数学写法里太常见，
      // 不支持的话用户一写 2x 就"语法错误"，很挫败。
      else if (s[i] && /[0-9A-Za-z(]/.test(s[i])) { const b = unary(); const p = a; a = (x) => p(x) * b(x) }
      else return a
    }
  }
  const unary = (): Node => {
    if (s[i] === "-") { i++; const b = unary(); return (x) => -b(x) }
    if (s[i] === "+") { i++; return unary() }
    return power()
  }
  const power = (): Node => {
    const a = atom()
    if (s[i] === "^") { i++; const b = unary(); return (x) => Math.pow(a(x), b(x)) }
    return a
  }
  const atom = (): Node => {
    if (s[i] === "(") {
      i++
      const e = expr()
      if (s[i] !== ")") fail()
      i++
      return e
    }
    const num = /^[0-9]+(\.[0-9]+)?/.exec(s.slice(i))
    if (num && /[0-9.]/.test(s[i])) { i += num[0].length; const v = parseFloat(num[0]); return () => v }
    const idm = /^[A-Za-z][A-Za-z0-9]*/.exec(s.slice(i))
    const name = idm ? idm[0] : ''
    if (!name) fail()
    i += name.length
    if (name === "x") return (x) => x
    if (name === "pi") return () => Math.PI
    if (name === "e") return () => Math.E
    const fn = FN1[name]
    if (!fn) fail()
    if (s[i] !== "(") fail()
    i++
    const arg = expr()
    if (s[i] !== ")") fail()
    i++
    return (x) => fn(arg(x))
  }
  try {
    const root = expr()
    if (i !== s.length) return null      // 有没吃完的字符 = 语法不完整
    return root
  } catch { return null }
}

/** 自定义函数里的一条曲线：表达式 + 自己的颜色 / 虚实 / 粗细 */
export interface CustomFnLine {
  expr: string
  /** 线条颜色；不填用元素自身的 stroke */
  color?: string
  /** 虚实：solid 实线 / dash 虚线 / dot 点线 */
  dash?: 'solid' | 'dash' | 'dot'
  /** 线宽；不填用元素自身的 strokeWidth */
  width?: number
  /** 关掉这条曲线（保留表达式，方便临时对比） */
  visible?: boolean
}

/** 自定义函数图的配置 */
export interface CustomFn {
  /** 单条表达式（旧存档用这个字段） */
  expr?: string
  /** 多条函数（新）：每条可单独设颜色 / 虚实 / 粗细，可叠加对比 */
  lines?: CustomFnLine[]
  x0: number; x1: number
  y0: number; y1: number
  grid?: boolean
  axes?: boolean
}

/** 虚实 → stroke-dasharray */
function dashArrayOf(dash: CustomFnLine['dash']): string {
  return dash === 'dash' ? ' stroke-dasharray="7 5"' : dash === 'dot' ? ' stroke-dasharray="1.5 4"' : ''
}

/** 网格（浅色细线，画在曲线下面） */
function gridSvg(view: View, w: number, h: number, m: Mapper): string {
  const stepOf = (lo: number, hi: number) => {
    const span = Math.abs(hi - lo) || 1
    const raw = span / 10
    const mag = Math.pow(10, Math.floor(Math.log10(raw)))
    const n = raw / mag
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag
  }
  const sx = stepOf(view.xmin, view.xmax)
  const sy = stepOf(view.ymin, view.ymax)
  let out = '<g stroke="#c9d6e8" stroke-width="1">'
  for (let x = Math.ceil(view.xmin / sx) * sx; x <= view.xmax + 1e-9; x += sx) {
    const px = m.X(x)
    out += '<line x1="' + px.toFixed(1) + '" y1="0" x2="' + px.toFixed(1) + '" y2="' + h + '"/>'
  }
  for (let y = Math.ceil(view.ymin / sy) * sy; y <= view.ymax + 1e-9; y += sy) {
    const py = m.Y(y)
    out += '<line x1="0" y1="' + py.toFixed(1) + '" x2="' + w + '" y2="' + py.toFixed(1) + '"/>'
  }
  return out + "</g>"
}

/** 自定义函数图：网格 / 坐标轴 / 曲线，三样都可开关。
 *  表达式解析不了就返回 null，调用方给提示。 */
export function customFigure(cfg: CustomFn, w: number, h: number, stroke: string, sw: number): string | null {
  // 兼容：新存档用 lines[]，旧存档只有一条 expr
  const lines: CustomFnLine[] = cfg.lines && cfg.lines.length ? cfg.lines : (cfg.expr ? [{ expr: cfg.expr }] : [])
  const view: View = { xmin: cfg.x0, xmax: cfg.x1, ymin: cfg.y0, ymax: cfg.y1 }
  const m = mapper(view, w, h)
  let s = cfg.grid ? gridSvg(view, w, h, m) : ""
  if (cfg.axes !== false) s += axesSvg(view, w, h, stroke, sw, true)
  // 每条曲线用自己的颜色/虚实/粗细；**某条写错不影响其它条**（只有全错才返回 null）
  let any = false
  for (const ln of lines) {
    if (ln.visible === false) continue
    const f = compileExpr(ln.expr || '')
    if (!f) continue
    const d = plotFunction(f, view, w, h, 600)
    if (!d) continue
    any = true
    s += '<path d="' + d + '" fill="none" stroke="' + (ln.color || stroke) +
      '" stroke-width="' + n1(ln.width && ln.width > 0 ? ln.width : sw) + '"' + dashArrayOf(ln.dash) +
      ' stroke-linecap="round" stroke-linejoin="round"/>'
  }
  if (!any && lines.length) return null
  return s
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

/** 椭圆的窗口：**比 4:3 高一些** —— 4:3 时纵轴只有横轴的 75%，看着太短。
 *  纵横比 1.15 时纵轴≈横轴的 87%，接近教材里的样子。
 *  ⚠ 静态 view 与 viewOf 必须用**同一个比例**：元素框是按静态 view 给的，
 *    比例不一致图形会被拉伸。 */
const ELLIPSE_AR = 1.15
export function ellipseWindow(a: number, b: number): View {
  const k = Math.max(0.5, Math.max(a, b) * 1.28)
  return { xmin: -k * ELLIPSE_AR, xmax: k * ELLIPSE_AR, ymin: -k, ymax: k }
}
/** 长轴在 y 轴的自定义椭圆用的窗口 —— 把上面那个转 90°（纵横比取倒数）。
 *  ⚠ 元素框的宽高比必须和窗口一致，否则图形会被拉伸（见 ellipseWindow 的注释）。 */
export function ellipseWindowV(a: number, b: number): View {
  const k = Math.max(0.5, Math.max(a, b) * 1.28)
  return { xmin: -k, xmax: k, ymin: -k * ELLIPSE_AR, ymax: k * ELLIPSE_AR }
}

/** 按尺寸算出合适的显示窗口（留 25% 边距，且保持大致 4:3 的比例） */
function windowFor(halfW: number, halfH: number): View {
  const hx = Math.max(1, halfW * 1.25)
  const hy = Math.max(1, halfH * 1.25)
  const ar = 4 / 3
  let x0 = hx, y0 = hy
  if (hx / hy > ar) y0 = hx / ar
  else x0 = hy * ar
  return { xmin: -x0, xmax: x0, ymin: -y0, ymax: y0 }
}

export const CONICS: Record<string, {
  label: string
  view: View
  /** 窗口随参数变（自定义曲线用） */
  viewOf?: (p: Record<string, number>) => View
  params?: ParamSpec[]
}> = {
  // —— 焦点在 x 轴 ——
  conicCircle: { label: '圆 x²+y²=r²', view: { xmin: -3.6, xmax: 3.6, ymin: -3.2, ymax: 3.2 } },
  ellipse: { label: '椭圆（焦点在 x 轴）', view: ellipseWindow(4, 3) },
  hyperbola: { label: '双曲线（焦点在 x 轴）', view: { xmin: -6.6, xmax: 6.6, ymin: -4.8, ymax: 4.8 }, params: [{ key: 'aline', label: '显示渐近线', def: 1, bool: true }] },
  conicParabola: { label: '抛物线 y²=2px（焦点在 x 轴）', view: { xmin: -4.6, xmax: 8.2, ymin: -6, ymax: 6 }, params: [{ key: 'dline', label: '显示准线', def: 1, bool: true }] },
  conicFocusDir: { label: '圆锥曲线统一定义（焦点·准线）', view: { xmin: -4.6, xmax: 8.2, ymin: -6, ymax: 6 } },
  // —— 带准线 / 离心率 ——
  ellipseDirectrix: { label: '椭圆（焦点·准线）', view: { xmin: -7.6, xmax: 7.6, ymin: -4.1, ymax: 4.1 } },
  hyperbolaDirectrix: { label: '双曲线（焦点·准线）', view: { xmin: -6.9, xmax: 6.9, ymin: -4.9, ymax: 4.9 }, params: [{ key: 'aline', label: '显示渐近线', def: 1, bool: true }] },
  ellipseFamily: { label: '椭圆族（离心率 e 变化）', view: { xmin: -5, xmax: 5, ymin: -4.7, ymax: 4.7 } },
  hyperbolaFamily: { label: '双曲线族（离心率 e 变化）', view: { xmin: -6.2, xmax: 6.2, ymin: -6.2, ymax: 6.2 } },
  eccAnim: { label: '椭圆离心率变化（动画）', view: { xmin: -5.3, xmax: 5.3, ymin: -4.5, ymax: 4.5 } },
  // —— 焦点在 y 轴 ——
  ellipseV: { label: '椭圆（焦点在 y 轴）', view: { xmin: -4.4, xmax: 4.4, ymin: -5.6, ymax: 5.6 } },
  hyperbolaV: { label: '双曲线（焦点在 y 轴）', view: { xmin: -5.6, xmax: 5.6, ymin: -6.4, ymax: 6.4 }, params: [{ key: 'aline', label: '显示渐近线', def: 1, bool: true }] },
  conicParabolaV: { label: '抛物线 x²=2py（焦点在 y 轴）', view: { xmin: -5.4, xmax: 5.4, ymin: -3.6, ymax: 7.6 }, params: [{ key: 'dline', label: '显示准线', def: 1, bool: true }] },
  conicCircleY: { label: '圆（圆心在 y 轴·与 x 轴相切）', view: { xmin: -4.4, xmax: 4.4, ymin: -1.8, ymax: 7 } },
  // —— 自定义：参数自己给，窗口随参数自适应 ——
  conicCustomEllipse: {
    label: '自定义椭圆 + 直线/线段（可调 a、b 与多条线）',
    view: ellipseWindow(4, 3),
    params: [
      { key: 'a', label: 'a（半长轴）', def: 4, step: 0.5, min: 0.5, max: 20 },
      { key: 'b', label: 'b（半短轴）', def: 3, step: 0.5, min: 0.5, max: 20 },
      { key: 'ab', label: '显示 a、b 标注', def: 1, bool: true },
      // 准线默认**关**：自定义椭圆原来没有准线，默认开会让老图元突然多两条线
      { key: 'dline', label: '显示准线', def: 0, bool: true },
    ],
    viewOf: (p) => ellipseWindow(p.a || 1, p.b || 1),
  },
  conicCustomEllipseV: {
    label: '自定义椭圆（长轴在 y 轴）+ 直线/线段（可调 a、b 与多条线）',
    view: ellipseWindowV(4, 3),
    params: [
      { key: 'a', label: 'a（半长轴）', def: 4, step: 0.5, min: 0.5, max: 20 },
      { key: 'b', label: 'b（半短轴）', def: 3, step: 0.5, min: 0.5, max: 20 },
      { key: 'ab', label: '显示 a、b 标注', def: 1, bool: true },
      { key: 'dline', label: '显示准线', def: 0, bool: true },
    ],
    viewOf: (p) => ellipseWindowV(p.a || 1, p.b || 1),
  },
  conicCustomHyperbola: {
    label: '自定义双曲线 + 直线/线段（可调 a、b 与多条线）',
    view: { xmin: -6.5, xmax: 6.5, ymin: -4.9, ymax: 4.9 },
    params: [
      { key: 'a', label: 'a（实半轴）', def: 3, step: 0.5, min: 0.3, max: 20 },
      { key: 'b', label: 'b（虚半轴）', def: 2, step: 0.5, min: 0.3, max: 20 },
      { key: 'dline', label: '显示准线', def: 0, bool: true },
      { key: 'aline', label: '显示渐近线', def: 0, bool: true },
    ],
    viewOf: (p) => {
      // **渐近线与支线的显示要协调**（用户实报：开口大的双曲线，支线成了小短弧、
      // 渐近线却一路画到框角 ✗）。做法：取景高度按"支线正好够到上下边"来定，
      // 宽度再保证支线有伸展余量 —— 支线与渐近线就会几乎同时到达框边 ✓。
      const a = Math.max(0.1, p.a || 3), b = Math.max(0.1, p.b || 2)
      const tv = 1.45
      const hy = b * Math.sinh(tv)
      const hx = Math.max(a * Math.cosh(tv), (hy * 4) / 3)
      return windowFor(hx, hy)
    },
  },
  conicCustomCircle: {
    label: '自定义圆 + 直线/线段（可调圆心、半径与多条线）',
    view: { xmin: -6, xmax: 6, ymin: -4.5, ymax: 4.5 },     // 4:3，与 viewOf 一致
    params: [
      { key: 'cx', label: '圆心 x', def: 0, step: 0.5, min: -20, max: 20 },
      { key: 'cy', label: '圆心 y', def: 0, step: 0.5, min: -20, max: 20 },
      { key: 'cr', label: '半径 r', def: 3, step: 0.5, min: 0.2, max: 20 },
    ],
    viewOf: (p) => {
      // 取景跟着圆心走，**保持 4:3**（元素框是按静态 view 的纵横比给的，比例不一致会拉伸）。
      // ⚠ 宽度必须有**下界（= 静态 view 的 6）**：如果取景严格跟半径一起放大，
      //   拖"半径"滑杆时**画面上什么都不会变** ✗（实测：r 从 3 调到 6，曲线像素尺寸一模一样）。
      //   加上下界之后，小圆是"在固定比例的坐标系里长大" ✓，大圆才撑大取景 ✓。
      const rr = Math.max(0.2, p.cr || 3)
      const hx = Math.max(6, rr * 1.25)
      const hy = (hx * 3) / 4
      const cx = p.cx || 0, cy = p.cy || 0
      return { xmin: cx - hx, xmax: cx + hx, ymin: cy - hy, ymax: cy + hy }
    },
  },
  conicCustomParabola: {
    label: '自定义抛物线 + 直线/线段（可调 p、开口方向与多条线）',
    // 静态 view 与 viewOf 都按 4:3 —— 不一致的话元素框会把图形拉伸
    view: { xmin: -8, xmax: 8, ymin: -6, ymax: 6 },
    params: [
      { key: 'p', label: 'p（焦准距）', def: 4, step: 0.5, min: 0.2, max: 20 },
      { key: 'dir', label: '开口：1右 2上 3左 4下', def: 1, step: 1, min: 1, max: 4 },
      { key: 'dline', label: '显示准线', def: 1, bool: true },
    ],
    viewOf: (p) => {
      // 取景按**开口方向**整体偏移：图形朝开口的**反方向**靠，给开口那边留出空间
      //（用户实报：开口向右时原来只占右半、左边一大片空 ✗）。
      // ⚠ 四种方向都必须保持 **4:3** —— 元素框是按静态 view 的纵横比给的，纵横比不一致会把图形拉伸。
      const pp = Math.max(0.2, p.p || 2)
      const dir = Math.round(p.dir || 1)
      if (dir === 1) return { xmin: -3 * pp, xmax: 7 * pp, ymin: -3.75 * pp, ymax: 3.75 * pp }
      if (dir === 3) return { xmin: -7 * pp, xmax: 3 * pp, ymin: -3.75 * pp, ymax: 3.75 * pp }
      if (dir === 2) return { xmin: -1.76 * pp, xmax: 1.76 * pp, ymin: -0.66 * pp, ymax: 1.98 * pp }
      return { xmin: -1.76 * pp, xmax: 1.76 * pp, ymin: -1.98 * pp, ymax: 0.66 * pp }
    },
  },
}

/** 「圆锥曲线 + 直线 / 线段」：给所有**自定义**圆锥曲线补上的"多条线"参数。
 *  n 默认 0 = 一条都不画 —— **老图元完全不变**；showIf 让属性面板只显示用得上的那几个。 */
export const LINE_PARAMS: ParamSpec[] = [
  { key: 'n', label: '直线 / 线段条数', def: 0, step: 1, min: 0, max: 4 },
  // 线段两端的圆点本来是"一眼区分线段 / 整条直线"用的；但教材图里常常不要，所以做成可选项。
  // 默认 1（显示）→ **老图元外观完全不变**。
  { key: 'ldot', label: '线段端点圆点', def: 1, bool: true, showIf: (p) => (p.n || 0) >= 1 },
  { key: 'chord', label: '显示弦长', def: 0, bool: true, showIf: (p) => (p.n || 0) >= 1 },
]
for (let i = 1; i <= 4; i++) {
  const on = (p: Record<string, number>) => (p.n || 0) >= i
  LINE_PARAMS.push(
    { key: 'k' + i, label: '线' + i + ' 斜率 k', def: i === 1 ? 0.6 : 0, step: 0.1, min: -10, max: 10, showIf: on },
    { key: 'm' + i, label: '线' + i + ' 截距 m', def: i === 1 ? -1 : 0, step: 0.5, min: -20, max: 20, showIf: on },
    // 起终点放到 ±50：线段要能伸出取景框，"整条直线"才不会显得被一个矩形框住
    { key: 's' + i, label: '线' + i + ' 起点 x', def: 0, step: 0.5, min: -50, max: 50, showIf: on },
    { key: 'e' + i, label: '线' + i + ' 终点 x（与起点相同 = 整条直线）', def: 0, step: 0.5, min: -50, max: 50, showIf: on },
  )
}
/** 「圆锥曲线的标注点」：圆点 + 名称。名称是字符串 ✗（params 只能放数字），
 *  所以名字存在元素的 pointLabels 里（与 lineColors 同一套做法）。pn 默认 0 = 不画 → 老图元不变。 */
export const POINT_PARAMS: ParamSpec[] = [
  { key: 'pn', label: '标注点的个数', def: 0, step: 1, min: 0, max: 6 },
]
for (let i = 1; i <= 6; i++) {
  const on = (p: Record<string, number>) => (p.pn || 0) >= i
  POINT_PARAMS.push(
    { key: 'px' + i, label: '点' + i + ' 横坐标 x', def: 0, step: 0.5, min: -50, max: 50, showIf: on },
    { key: 'py' + i, label: '点' + i + ' 纵坐标 y', def: 0, step: 0.5, min: -50, max: 50, showIf: on },
  )
}

// 挂到所有自定义圆锥曲线上（挂在 conicFigure 之前，此时 CONICS 已完整定义）
for (const kk of ['conicCustomCircle', 'conicCustomEllipse', 'conicCustomEllipseV', 'conicCustomHyperbola', 'conicCustomParabola']) {
  const dd = CONICS[kk]
  if (dd) dd.params = [...(dd.params || []), ...LINE_PARAMS, ...POINT_PARAMS]
}

/** 把直线 y = kx + m 裁到显示窗口里（**窗口外不画多余线段**），返回可见段两端点。 */
function clipLine(k: number, b2: number, view: View): [[number, number], [number, number]] | null {
  const pts: [number, number][] = []
  const add = (x: number, y: number) => {
    if (x < view.xmin - 1e-9 || x > view.xmax + 1e-9 || y < view.ymin - 1e-9 || y > view.ymax + 1e-9) return
    if (pts.some((p) => Math.abs(p[0] - x) < 1e-9 && Math.abs(p[1] - y) < 1e-9)) return
    pts.push([x, y])
  }
  add(view.xmin, k * view.xmin + b2)
  add(view.xmax, k * view.xmax + b2)
  if (Math.abs(k) > 1e-9) {
    add((view.ymin - b2) / k, view.ymin)
    add((view.ymax - b2) / k, view.ymax)
  }
  if (pts.length < 2) return null
  pts.sort((p, q) => (p[0] - q[0]) || (p[1] - q[1]))
  return [pts[0], pts[pts.length - 1]]
}

/** 画「多条直线 / 线段」（参数见 LINE_PARAMS）。返回空串 = 没开。
 *  线段按起终点 x 截断，直线铺满窗口；两者都先裁到窗口内，不会溢到元素框外面。 */
function drawExtraLines(kind: string, pv: Record<string, number>, view: View, w: number, h: number, stroke: string, sw: number, colors?: (string | null)[]): string {
  const n = Math.max(0, Math.min(4, Math.round(pv.n || 0)))
  if (!n) return ''
  const dots = Math.round(pv.ldot ?? 1) !== 0        // 线段端点圆点，可选
  const mm = mapper(view, w, h)
  const r = Math.max(2, Math.min(w, h) * 0.011)
  let out = ''
  for (let i = 1; i <= n; i++) {
    const k = pv['k' + i] || 0, b2 = pv['m' + i] || 0
    const sN = pv['s' + i] ?? 0, eN = pv['e' + i] ?? 0
    const seg = Math.abs(eN - sN) > 1e-6                 // 起终点不同 = 线段
    const span = clipLine(k, b2, view)
    if (!span) continue
    let lo = Math.min(span[0][0], span[1][0]), hi = Math.max(span[0][0], span[1][0])
    if (seg) {
      lo = Math.max(lo, Math.min(sN, eN))
      hi = Math.min(hi, Math.max(sN, eN))
      if (hi - lo < 1e-9) continue
    }
    const col = colors && colors[i - 1] ? colors[i - 1]! : stroke     // 每条线可以有自己的颜色
    out += lineSvg(mm.X(lo), mm.Y(k * lo + b2), mm.X(hi), mm.Y(k * hi + b2), col, sw)
    if (seg && dots) out += dotSvg(mm.X(lo), mm.Y(k * lo + b2), r, col) + dotSvg(mm.X(hi), mm.Y(k * hi + b2), r, col)
    // 弦长：这条线与曲线的两个交点之间的距离，标在弦中点（默认关）
    if (Math.round(pv.chord ?? 0)) {
      const rs = conicLineRoots(kind, pv, i)
      if (rs.length >= 2) {
        const dd = Math.hypot(rs[0].x - rs[1].x, rs[0].y - rs[1].y)
        const fs2 = Math.max(11, Math.min(w, h) * 0.05)
        const mx = (rs[0].x + rs[1].x) / 2, my = (rs[0].y + rs[1].y) / 2
        out += textSvg(mm.X(mx) + fs2 * 0.35, mm.Y(my) - fs2 * 0.45, dd.toFixed(2), fs2, stroke)
      }
    }
  }
  return out
}

/** 圆锥曲线 + 直线：把每条线在当前窗口里的**两个可见端点**算成元素像素坐标，给拖拽手柄用。
 *  （手柄的 left/top 就是这个坐标系，见 MathFigureElement 的 .mf-handle） */
export function conicLineHandles(kind: string, w: number, h: number, params?: Record<string, number>, pointLinks?: (PointLink | null)[], lineLinks?: (LineLink | null)[]): { i: number; which: 0 | 1; x: number; y: number }[] {
  const def = CONICS[kind]
  if (!def) return []
  const pv = conicEffectiveParams(kind, params, pointLinks, lineLinks)
  const n = Math.max(0, Math.min(4, Math.round(pv.n || 0)))
  if (!n) return []
  const view = def.viewOf ? def.viewOf(pv) : def.view
  const mm = mapper(view, w, h)
  const out: { i: number; which: 0 | 1; x: number; y: number }[] = []
  for (let i = 1; i <= n; i++) {
    const k = pv['k' + i] || 0, b2 = pv['m' + i] || 0
    const sN = pv['s' + i] ?? 0, eN = pv['e' + i] ?? 0
    const seg = Math.abs(eN - sN) > 1e-6
    const span = clipLine(k, b2, view)
    if (!span) continue
    let lo = Math.min(span[0][0], span[1][0]), hi = Math.max(span[0][0], span[1][0])
    if (seg) {
      lo = Math.max(lo, Math.min(sN, eN))
      hi = Math.min(hi, Math.max(sN, eN))
      if (hi - lo < 1e-9) continue
    }
    out.push({ i, which: 0, x: mm.X(lo), y: mm.Y(k * lo + b2) })
    out.push({ i, which: 1, x: mm.X(hi), y: mm.Y(k * hi + b2) })
  }
  return out
}

/** 拖动某条线的**一个端点**：另一端固定，由这两点反算斜率 k 与截距 m
 *  （直线只有 2 个自由度，两个点正好定死）；线段还要一并更新起终点 x。
 *  传入的是被拖端点的元素像素坐标。返回要写回 params 的补丁。 */
export function conicLineDrag(
  kind: string, w: number, h: number, params: Record<string, number>,
  i: number, which: 0 | 1, px: number, py: number,
): Record<string, number> {
  const def = CONICS[kind]
  if (!def) return {}
  const pv = withParams(kind, params)
  const view = def.viewOf ? def.viewOf(pv) : def.view
  const own = conicLineHandles(kind, w, h, params).filter((q) => q.i === i)
  const other = own.find((q) => q.which !== which)
  if (!other) return {}
  // mapper 的逆：X(x)=(x−xmin)·w/(xmax−xmin)，Y(y)=h−(y−ymin)·h/(ymax−ymin)
  const sx = w / (view.xmax - view.xmin), sy = h / (view.ymax - view.ymin)
  const fx = (p: number) => view.xmin + p / sx
  const fy = (p: number) => view.ymin + (h - p) / sy
  const ax = fx(other.x), ay = fy(other.y)
  let bx = fx(px), by = fy(py)
  // 拖成竖直时斜率无穷：给一点点错位（k 会很大，但不出 NaN / Infinity）
  if (Math.abs(bx - ax) < 1e-6) bx = ax + 1e-6
  const k = (by - ay) / (bx - ax)
  const m2 = ay - k * ax
  const patch: Record<string, number> = {}
  patch['k' + i] = +k.toFixed(4)
  patch['m' + i] = +m2.toFixed(4)
  const sN = pv['s' + i] ?? 0, eN = pv['e' + i] ?? 0
  if (Math.abs(eN - sN) > 1e-6) {                 // 线段：两端 x 跟着两个端点走
    patch['s' + i] = +Math.min(ax, bx).toFixed(3)
    patch['e' + i] = +Math.max(ax, bx).toFixed(3)
  }
  return patch
}

/** 标注点的绑定：
 *  ① { line, which } —— **直线与曲线的交点**（随直线动）
 *  ② { on:'curve', t, br } —— **在曲线上滑动的动点**（t 是参数，br 用来区分双曲线的两支）
 *  绑上之后位置一律**现算** ✓，不再用 px/py。 */
export type PointLink =
  | { line: number; which: 0 | 1 }
  | { on: 'curve'; t: number; br?: 0 | 1 }

/** 参数 t（+分支）在圆锥曲线上的位置 —— 与 conicFigure 里各分支的画法**严格一致**。 */
export function conicPointAtT(kind: string, params: Record<string, number> | undefined, t: number, br: 0 | 1 = 0): { x: number; y: number } | null {
  const pv = withParams(kind, params)
  if (kind === 'conicCustomCircle') {
    const cx = pv.cx || 0, cy = pv.cy || 0, r = Math.max(0.2, pv.cr || 3)
    return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) }
  }
  if (kind === 'conicCustomEllipse') {
    const a = Math.max(0.2, pv.a || 4), b = Math.max(0.2, pv.b || 3)
    return { x: a * Math.cos(t), y: b * Math.sin(t) }
  }
  if (kind === 'conicCustomEllipseV') {
    const a = Math.max(0.2, pv.a || 4), b = Math.max(0.2, pv.b || 3)
    return { x: b * Math.cos(t), y: a * Math.sin(t) }
  }
  if (kind === 'conicCustomHyperbola') {
    const a = Math.max(0.1, pv.a || 3), b = Math.max(0.1, pv.b || 2)
    const s = br === 1 ? -1 : 1
    return { x: s * a * Math.cosh(t), y: b * Math.sinh(t) }
  }
  if (kind === 'conicCustomParabola') {
    const p = Math.max(0.05, pv.p || 4), dir = Math.round(pv.dir || 1)
    const x0 = (t * t) / (2 * p), y0 = t
    if (dir === 2) return { x: y0, y: x0 }
    if (dir === 3) return { x: -x0, y: y0 }
    if (dir === 4) return { x: y0, y: -x0 }
    return { x: x0, y: y0 }
  }
  return null
}

/** 把平面上的点**投影到曲线上**（粗扫 + 三分细化）→ 返回最接近的 (t, br)。
 *  拖动动点时走这里：它于是"沿曲线滑到离手指最近的位置" ✓，而不会跑出曲线 ✓。 */
export function conicTAt(kind: string, params: Record<string, number> | undefined, tx: number, ty: number, br0: 0 | 1 = 0): { t: number; br: 0 | 1 } {
  const d2 = (t: number, br: 0 | 1) => { const p = conicPointAtT(kind, params, t, br); return p ? (p.x - tx) ** 2 + (p.y - ty) ** 2 : Infinity }
  const lo0 = kind === 'conicCustomParabola' ? -30 : kind === 'conicCustomHyperbola' ? -3.2 : 0
  const hi0 = kind === 'conicCustomParabola' ? 30 : kind === 'conicCustomHyperbola' ? 3.2 : Math.PI * 2
  const brs: (0 | 1)[] = kind === 'conicCustomHyperbola' ? [0, 1] : [br0]
  let bt = lo0, bb: 0 | 1 = br0, bd = Infinity
  for (const br of brs) {
    for (let i = 0; i <= 96; i++) {
      const t = lo0 + ((hi0 - lo0) * i) / 96
      const d = d2(t, br)
      if (d < bd) { bd = d; bt = t; bb = br }
    }
  }
  // 三分细化（在初值附近的小区间里）
  const span = (hi0 - lo0) / 96
  let a = Math.max(lo0, bt - span), b = Math.min(hi0, bt + span)
  for (let k = 0; k < 48; k++) {
    const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3
    if (d2(m1, bb) < d2(m2, bb)) b = m2; else a = m1
  }
  return { t: (a + b) / 2, br: bb }
}

/** 第 i 个标注点的**实际位置**：绑在交点上就现算，否则用 px{i}/py{i}。
 *  绑着但线已经离开曲线（无交点）→ 返回 null（这一点暂时不画）。 */
export function conicPointPos(kind: string, params: Record<string, number> | undefined, i: number, links?: (PointLink | null)[]): { x: number; y: number } | null {
  const pv = withParams(kind, params)
  const lk = links && links[i - 1]
  if (lk && 'on' in lk) return conicPointAtT(kind, params, lk.t, lk.br ?? 0)   // 动点：在曲线上
  if (lk && 'line' in lk) {                                                    // 交点：随直线动
    const rs = conicLineRoots(kind, params, lk.line)
    return rs[lk.which] || rs[0] || null
  }
  return { x: pv['px' + i] || 0, y: pv['py' + i] || 0 }
}

/** 画「标注点」：圆点 + 名称（名称取自 pointLabels，没有就用 P_1、P_2…）。
 *  先铺一层白底再画实心点 —— 它画在圆锥曲线**下面**（各分支都是往 s 上追加后 return，
 *  只能加在前面），有白底才不会被曲线压住看不清。 */
function drawExtraPoints(kind: string, pv: Record<string, number>, view: View, w: number, h: number, stroke: string, labels?: (string | null)[], links?: (PointLink | null)[]): string {
  const n = Math.max(0, Math.min(6, Math.round(pv.pn || 0)))
  if (!n) return ''
  const mm = mapper(view, w, h)
  const m0 = Math.min(w, h)
  const rr = Math.max(2.2, m0 * 0.014)
  const fs = Math.max(11, m0 * 0.055)
  let out = ''
  for (let i = 1; i <= n; i++) {
    const pos = conicPointPos(kind, pv, i, links)
    if (!pos) continue
    const px = mm.X(pos.x), py = mm.Y(pos.y)
    out += dotSvg(px, py, rr * 1.75, '#ffffff')
    out += dotSvg(px, py, rr, stroke)
    const t = String((labels && labels[i - 1]) || ('P_' + i)).trim()
    if (t) out += textSvg(px + fs * 0.8, py - fs * 0.75, t, fs, stroke)
  }
  return out
}

/** 圆锥曲线的**标注点**在元素像素坐标下的位置（拖拽手柄用，坐标系同 .mf-handle）。 */
export function conicPointHandles(kind: string, w: number, h: number, params?: Record<string, number>, links?: (PointLink | null)[], lineLinks?: (LineLink | null)[]): { i: number; x: number; y: number }[] {
  const def = CONICS[kind]
  if (!def) return []
  const pv = conicEffectiveParams(kind, params, links, lineLinks)
  const n = Math.max(0, Math.min(6, Math.round(pv.pn || 0)))
  if (!n) return []
  const view = def.viewOf ? def.viewOf(pv) : def.view
  const mm = mapper(view, w, h)
  const out: { i: number; x: number; y: number }[] = []
  for (let i = 1; i <= n; i++) {
    const pos = conicPointPos(kind, pv, i, links)
    if (!pos) continue
    out.push({ i, x: mm.X(pos.x), y: mm.Y(pos.y) })
  }
  return out
}

/** 拖动标注点：元素像素坐标 → 图形坐标。返回的是**元素补丁**（可能写 params，也可能改 pointLinks）。
 *  · 普通点 → 写回 px{i} / py{i}
 *  · **动点** → 改它的曲线参数 t：沿曲线滑到**离手指最近**的位置 ✓（绝不会跑出曲线）
 *  · 交点   → 以另一端为支点**转动那条线**（交点必须落在曲线上，所以不会精确停在指针处 ✓） */
export function conicPointDrag(
  kind: string, w: number, h: number, params: Record<string, number>, i: number, px: number, py: number,
  links?: (PointLink | null)[], lineLinks?: (LineLink | null)[],
): { params?: Record<string, number>; pointLinks?: (PointLink | null)[] } {
  const def = CONICS[kind]
  if (!def) return {}
  const pv = conicEffectiveParams(kind, params, links, lineLinks)
  const view = def.viewOf ? def.viewOf(pv) : def.view
  const sx = w / (view.xmax - view.xmin), sy = h / (view.ymax - view.ymin)
  const fx = view.xmin + px / sx, fy = view.ymin + (h - py) / sy
  const lk = links && links[i - 1]
  if (lk && 'on' in lk) {
    const r = conicTAt(kind, params, fx, fy, lk.br ?? 0)
    const next = [...(links || [])]
    next[i - 1] = { on: 'curve', t: +r.t.toFixed(4), br: r.br }
    return { pointLinks: next }
  }
  if (lk && 'line' in lk) {
    // 如果这条线是**绑定的切线**，它的 k/m 是算出来的 ✗ —— 拖动改不了它，直接不动
    //（要动就动那个切点：动点一滑，切线跟着转 ✓）
    if (lineLinks && lineLinks[lk.line - 1]) return {}
    // ⚠ 交点**必须落在圆锥曲线上** ✗ —— 所以"拖到指针处"在数学上不可能 ✓。
    //   正确语义（几何画板里拖弦的端点就是这个）：**以另一端为支点转动这条线** ✓。
    const rs = conicLineRoots(kind, pv, lk.line)
    const other = rs[1 - lk.which]
    if (other) {
      let dx = fx - other.x, dy = fy - other.y
      if (Math.abs(dx) < 1e-6) dx = 1e-6        // 与支点几乎同 x：给一点点错位，避免除零
      const k2 = dy / dx
      return { params: { ['k' + lk.line]: +k2.toFixed(4), ['m' + lk.line]: +(other.y - k2 * other.x).toFixed(4) } }
    }
    const k = pv['k' + lk.line] || 0
    return { params: { ['m' + lk.line]: +(fy - k * fx).toFixed(3) } }
  }
  return { params: { ['px' + i]: +fx.toFixed(3), ['py' + i]: +fy.toFixed(3) } }
}

/** 圆锥曲线在 xOy 里的二次型系数：**A x² + B y² + C x + D y + E = 0**（都是轴对齐的，没有 xy 项）。
 *  抛物线的四个开口方向各对应一组一次项 —— 与 conicFigure 里 mapPt 的映射严格一致。 */
export function conicQuadratic(kind: string, params?: Record<string, number>): { A: number; B: number; C: number; D: number; E: number } | null {
  const pv = withParams(kind, params)
  const g = (k: string, d = 0) => (typeof pv[k] === 'number' ? pv[k] : d)
  if (kind === 'conicCustomCircle') {
    const cx = g('cx'), cy = g('cy'), r = Math.max(0.2, g('cr', 3))
    return { A: 1, B: 1, C: -2 * cx, D: -2 * cy, E: cx * cx + cy * cy - r * r }
  }
  if (kind === 'conicCustomEllipse') {
    const a = Math.max(0.2, g('a', 4)), b = Math.max(0.2, g('b', 3))
    return { A: 1 / (a * a), B: 1 / (b * b), C: 0, D: 0, E: -1 }
  }
  if (kind === 'conicCustomEllipseV') {
    const a = Math.max(0.2, g('a', 4)), b = Math.max(0.2, g('b', 3))
    return { A: 1 / (b * b), B: 1 / (a * a), C: 0, D: 0, E: -1 }
  }
  if (kind === 'conicCustomHyperbola') {
    const a = Math.max(0.1, g('a', 3)), b = Math.max(0.1, g('b', 2))
    return { A: 1 / (a * a), B: -1 / (b * b), C: 0, D: 0, E: -1 }
  }
  if (kind === 'conicCustomParabola') {
    const p = Math.max(0.05, g('p', 4)), dir = Math.round(g('dir', 1))
    if (dir === 1) return { A: 0, B: 1, C: -2 * p, D: 0, E: 0 }   // y² = 2px
    if (dir === 2) return { A: 1, B: 0, C: 0, D: -2 * p, E: 0 }   // x² = 2py
    if (dir === 3) return { A: 0, B: 1, C: 2 * p, D: 0, E: 0 }    // y² = −2px
    return { A: 1, B: 0, C: 0, D: 2 * p, E: 0 }                   // x² = −2py
  }
  return null
}

/** **直线 / 线段 与圆锥曲线的交点**。把 y = kx + m 代入二次型解一元二次方程；
 *  线段只保留落在它起终 x 之间的根。相切（判别式 0）自然只出一个点。
 *  返回图形坐标，line 是第几条线（从 1 起）。 */
export function conicLineRoots(kind: string, params: Record<string, number> | undefined, line: number): { x: number; y: number }[] {
  const q = conicQuadratic(kind, params)
  if (!q) return []
  const pv = withParams(kind, params)
  const k = pv['k' + line] || 0, m2 = pv['m' + line] || 0
  const sN = pv['s' + line] ?? 0, eN = pv['e' + line] ?? 0
  const seg = Math.abs(eN - sN) > 1e-6
  const lo = Math.min(sN, eN), hi = Math.max(sN, eN)
  const A2 = q.A + q.B * k * k
  const B2 = 2 * q.B * k * m2 + q.C + q.D * k
  const C2 = q.B * m2 * m2 + q.D * m2 + q.E
  const roots: number[] = []
  if (Math.abs(A2) < 1e-12) {
    if (Math.abs(B2) > 1e-12) roots.push(-C2 / B2)            // 退化成一次方程（抛物线与平行于轴的直线）
  } else {
    const disc = B2 * B2 - 4 * A2 * C2
    // 判别式用**相对**容差：相切时 disc 理论上是 0，浮点会给到 ±1e-16 量级；
    // 写死 1e-9 的话系数一大就误判成"无交点" ✗
    const tol = 1e-9 * (B2 * B2 + Math.abs(4 * A2 * C2) + 1e-12)
    if (disc >= -tol) {
      const sq = Math.sqrt(Math.max(0, disc))
      roots.push((-B2 + sq) / (2 * A2), (-B2 - sq) / (2 * A2))
    }
  }
  // ⚠ 按 x **升序**排：绑定时 which=0/1 才有稳定含义 ✓ 否则直线一动两个交点就可能互换 ✗
  const pts = roots
    .filter((x) => isFinite(x) && !(seg && (x < lo - 1e-9 || x > hi + 1e-9)))
    .sort((a, b) => a - b)
    .map((x) => ({ x, y: k * x + m2 }))
  // 两个根几乎重合 = **相切**（竖直切线用大斜率近似时尤其明显）→ 只留一个 ✓
  if (pts.length === 2) {
    const eps = 1e-3 * (1 + Math.abs(pts[0].x) + Math.abs(pts[0].y))
    if (Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) < eps) return [pts[0]]
  }
  return pts
}

export function conicLineIntersections(kind: string, params?: Record<string, number>, pointLinks?: (PointLink | null)[], lineLinks?: (LineLink | null)[]): { x: number; y: number; line: number; which: 0 | 1 }[] {
  const pv = conicEffectiveParams(kind, params, pointLinks, lineLinks)
  const n = Math.max(0, Math.min(4, Math.round(pv.n || 0)))
  const raw: { x: number; y: number; line: number; which: 0 | 1 }[] = []
  for (let i = 1; i <= n; i++) {
    conicLineRoots(kind, pv, i).forEach((p, w) => raw.push({ x: p.x, y: p.y, line: i, which: (w === 0 ? 0 : 1) as 0 | 1 }))
  }
  // 去重：两条线交于一点、或切点被两个根各算一次
  const uniq: { x: number; y: number; line: number; which: 0 | 1 }[] = []
  for (const p of raw) {
    if (uniq.some((q2) => Math.hypot(q2.x - p.x, q2.y - p.y) < 1e-6)) continue
    uniq.push(p)
  }
  return uniq
}

/** 直线与圆锥曲线的**绑定**：目前一种 —— 这条线是**某个标注点处的切线**（tangentAt = 点序号）。
 *  绑上之后 k、m 每次**现算** ✓，所以动点一滑、切线就跟着转 ✓。 */
export interface LineLink { tangentAt: number }

/** 圆锥曲线在点 (x0,y0) 处的**切线** y = kx + m。
 *  二次型 F = Ax²+By²+Cx+Dy+E → 切线为 (2Ax0+C)(x−x0) + (2By0+D)(y−y0) = 0。
 *  ⚠ 竖直切线（椭圆左右顶点那种）用**很大的斜率**近似 —— 直线模型 y=kx+m 表示不了竖直 ✓。 */
export function conicTangentAt(kind: string, params: Record<string, number> | undefined, x0: number, y0: number): { k: number; m: number } | null {
  const q = conicQuadratic(kind, params)
  if (!q) return null
  const A = 2 * q.A * x0 + q.C
  const B = 2 * q.B * y0 + q.D
  if (Math.abs(B) < 1e-9) {
    if (Math.abs(A) < 1e-9) return null
    return { k: 1e4, m: y0 - 1e4 * x0 }
  }
  const k = -A / B
  return { k, m: y0 - k * x0 }
}

/** 把"绑定的线"解析成实际参数：切线由它的**切点**现算 → 覆盖 k{i}/m{i}。
 *  顺序：动点 / 自由点 → 切线 → （交点在 conicPointPos 里用已经生效的参数现算）✓ */
export function conicEffectiveParams(
  kind: string, params: Record<string, number> | undefined,
  pointLinks?: (PointLink | null)[], lineLinks?: (LineLink | null)[],
): Record<string, number> {
  const pv = { ...withParams(kind, params) }
  if (!lineLinks) return pv
  for (let i = 0; i < lineLinks.length; i++) {
    const lk = lineLinks[i]
    if (!lk) continue
    const pt = conicPointPos(kind, pv, lk.tangentAt, pointLinks)
    if (!pt) continue
    const km = conicTangentAt(kind, pv, pt.x, pt.y)
    // ⚠ **不要四舍五入** ✗ —— 舍入会让"严格相切"变成"差一点点"，判别式掉到负数，
    //   于是切线算出**0 个交点**（实测 t=0.8 的切线就是这样消失的）。全精度留着 ✓
    if (km) { pv['k' + (i + 1)] = km.k; pv['m' + (i + 1)] = km.m }
  }
  return pv
}

export function conicFigure(kind: string, w: number, h: number, baseStroke: string, sw: number, fill = 'none', params?: Record<string, number>, opt?: { conicStroke?: string; lineColors?: (string | null)[]; pointLabels?: (string | null)[]; pointLinks?: (PointLink | null)[]; lineLinks?: (LineLink | null)[] }): string {
  const def = CONICS[kind]
  if (!def) return ''
  // ⚠ 用**生效参数**：绑定的切线由切点现算 k/m → 覆盖原来的值（动点一动切线就转 ✓）
  const pv = conicEffectiveParams(kind, params, opt?.pointLinks, opt?.lineLinks)
  // ⚠ 参数名从 stroke 改成 baseStroke，再让 stroke 指向"**圆锥曲线自己的颜色**" ——
  //   这样下面各个绘制分支**一行都不用改**（它们本来就写 stroke）。
  //   坐标轴仍用元素主色 baseStroke；多条线各自用 lineColors[i]（没给就回落主色）。
  const stroke = opt?.conicStroke || baseStroke
  const view = def.viewOf ? def.viewOf(pv) : def.view
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
  let s = axesSvg(view, w, h, baseStroke, sw, false)
  // 「圆锥曲线 + 直线 / 线段」：在 s 的**最前面**加一次就够 —— 后面各分支只管往 s 上追加再 return s，
  // 所以不需要改动任何一个分支（改四个分支结尾容易漏、也容易错）。
  // 画在圆锥曲线**下面**，交点处线条不会互相压住。
  s += drawExtraLines(kind, pv, view, w, h, baseStroke, sw, opt?.lineColors)
  s += drawExtraPoints(kind, pv, view, w, h, baseStroke, opt?.pointLabels, opt?.pointLinks)
  const label = (x: number, y: number, t: string, dx = 0, dy = 0) => textSvg(X(x) + dx, Y(y) + dy, t, fs, stroke)
  const dot = (x: number, y: number, k = 1) => dotSvg(X(x), Y(y), r * k, stroke)

  // —— 自定义圆锥曲线：a / b / p 由用户给，窗口跟着自适应 ——
  if (kind === 'conicCustomCircle') {
    const cx = pv.cx || 0, cy = pv.cy || 0
    const rr = Math.max(0.2, pv.cr || 3)
    s += curve(plotParametric((t) => cx + rr * Math.cos(t), (t) => cy + rr * Math.sin(t), 0, TAU, view, w, h))
    s += dot(cx, cy)                       // 圆心
    return s
  }
  if (kind === 'conicCustomEllipse') {
    const a = Math.max(0.2, pv.a), b = Math.max(0.2, pv.b)
    const a2 = Math.max(a, b), b2 = Math.min(a, b)      // a 是半长轴（名不副实时自动纠正）
    const c = Math.sqrt(Math.max(0, a2 * a2 - b2 * b2))
    s += curve(plotParametric((t) => a * Math.cos(t), (t) => b * Math.sin(t), 0, TAU, view, w, h))
    s += lineSvg(X(-a), Y(0), X(a), Y(0), stroke, thin, dash)
    s += dot(-c, 0) + dot(c, 0)
    s += label(-c, 0, 'F₁', 0, fs * 1.15) + label(c, 0, 'F₂', 0, fs * 1.15)
    // a / b 标注可选（默认显示，老图元不变）—— 教材图里一般不把参数值印在图上
    if (Math.round(pv.ab ?? 1)) {
      s += label(a, 0, 'a=' + a, fs * 0.5, -fs * 0.6)
      s += label(0, b, 'b=' + b, fs * 0.5, -fs * 0.6)
    }
    // 准线 x = ±a²/c（c 是半焦距）。默认关 —— 老图元不会突然多两条线。
    if (Math.round(pv.dline ?? 0) && a > b + 1e-6) {
      const dxx = (a * a) / Math.sqrt(a * a - b * b)
      s += lineSvg(X(dxx), Y(view.ymin), X(dxx), Y(view.ymax), stroke, thin, dash)
      s += lineSvg(X(-dxx), Y(view.ymin), X(-dxx), Y(view.ymax), stroke, thin, dash)
    }
    return s
  }
  if (kind === 'conicCustomEllipseV') {
    // x²/b² + y²/a² = 1（长轴在 y 轴上），跟 conicCustomEllipse 上下对称
    const a0 = Math.max(0.2, pv.a), b0 = Math.max(0.2, pv.b)
    const a = Math.max(a0, b0), b = Math.min(a0, b0)      // a 是半长轴（竖着）
    const c = Math.sqrt(Math.max(0, a * a - b * b))
    s += curve(plotParametric((t) => b * Math.cos(t), (t) => a * Math.sin(t), 0, TAU, view, w, h))
    s += lineSvg(X(0), Y(-a), X(0), Y(a), stroke, thin, dash)
    s += dot(0, -c) + dot(0, c)
    s += label(0, -c, 'F₁', fs * 1.25, 0) + label(0, c, 'F₂', fs * 1.25, 0)
    if (Math.round(pv.ab ?? 1)) {
      s += label(0, a, 'a=' + a, fs * 0.5, -fs * 0.6)
      s += label(b, 0, 'b=' + b, -fs * 1.6, -fs * 0.6)
    }
    // 长轴在 y 轴：准线是 y = ±a²/c
    if (Math.round(pv.dline ?? 0) && c > 1e-6) {
      const dyy = (a * a) / c
      s += lineSvg(X(view.xmin), Y(dyy), X(view.xmax), Y(dyy), stroke, thin, dash)
      s += lineSvg(X(view.xmin), Y(-dyy), X(view.xmax), Y(-dyy), stroke, thin, dash)
    }
    return s
  }
  if (kind === 'conicCustomHyperbola') {
    const a = Math.max(0.1, pv.a), b = Math.max(0.1, pv.b)
    const U = 3
    s += curve(plotParametric((t) => a * Math.cosh(t), (t) => b * Math.sinh(t), -U, U, view, w, h))
    s += curve(plotParametric((t) => -a * Math.cosh(t), (t) => b * Math.sinh(t), -U, U, view, w, h))
    const c = Math.sqrt(a * a + b * b)
    s += dot(-c, 0) + dot(c, 0)
    s += label(-c, 0, 'F₁', 0, fs * 1.15) + label(c, 0, 'F₂', 0, fs * 1.15)
    s += label(a, 0, 'a=' + a, fs * 0.5, -fs * 0.6)
    // 渐近线 y = ±(b/a)x 与准线 x = ±a²/c —— 都默认关（原来没有，默认开会改老图元外观）
    if (Math.round(pv.aline ?? 0)) {
      const xa = view.xmax * 0.98
      s += lineSvg(X(-xa), Y(-(b / a) * xa), X(xa), Y((b / a) * xa), stroke, thin, dash)
      s += lineSvg(X(-xa), Y((b / a) * xa), X(xa), Y(-(b / a) * xa), stroke, thin, dash)
    }
    if (Math.round(pv.dline ?? 0)) {
      const dxx = (a * a) / c
      s += lineSvg(X(dxx), Y(view.ymin), X(dxx), Y(view.ymax), stroke, thin, dash)
      s += lineSvg(X(-dxx), Y(view.ymin), X(-dxx), Y(view.ymax), stroke, thin, dash)
    }
    return s
  }
  if (kind === 'conicCustomParabola') {
    const pp = Math.max(0.05, pv.p)
    const dir = Math.round(pv.dir || 1)
    // 先按"开口向右"算，再按方向映射：(x,y) → 右/上/左/下
    const mapPt = (x: number, y: number): [number, number] => {
      if (dir === 2) return [y, x]
      if (dir === 3) return [-x, y]
      if (dir === 4) return [y, -x]
      return [x, y]
    }
    const yLo = (dir === 2 || dir === 4) ? view.xmin : view.ymin
    const yHi = (dir === 2 || dir === 4) ? view.xmax : view.ymax
    // 采样到「开口轴」在取景里的真实范围为止。
    // ⚠ 原来用 max(xmax, ymax)*1.2 当上限、且越界就把 d 置空 —— 那是把整条路径**清空** ✗。
    //   开口向左/向下时取景是镜像的，上限会被算小，末尾几个采样点一越界整条曲线就没了（实测）。
    //   现在按方向取真实上限，越界只跳过（continue）而不清空。
    const lim = dir === 1 ? view.xmax : dir === 3 ? -view.xmin : dir === 2 ? view.ymax : -view.ymin
    const step = (yHi - yLo) / 400
    let d = ''
    for (let y = yLo; y <= yHi + 1e-9; y += step) {
      const x = (y * y) / (2 * pp)
      if (x < -1e-9 || x > lim * 1.02) continue
      const [qx, qy] = mapPt(x, y)
      d += (d ? ' L ' : 'M ') + X(qx).toFixed(1) + ' ' + Y(qy).toFixed(1)
    }
    s += curve(d)
    const [fx, fy] = mapPt(pp / 2, 0)
    const [dx2, dy2] = mapPt(-pp / 2, 0)
    s += dot(fx, fy) + label(fx, fy, 'F', fs * 0.6, -fs * 0.7)
    // 准线可选（默认显示 → 老图元不变）
    if (Math.round(pv.dline ?? 1)) {
      if (dir === 1 || dir === 3) s += lineSvg(X(dx2), Y(-view.ymax), X(dx2), Y(view.ymax), stroke, thin, dash)
      else s += lineSvg(X(view.xmin), Y(dy2), X(view.xmax), Y(dy2), stroke, thin, dash)
      s += label(dx2, (dir === 1 || dir === 3) ? view.ymax * 0.92 : view.xmax * 0.92, '准线', 0, 0)
    }
    return s
  }
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
    // 渐近线 y = ±(b/a)x（可关，默认显示 → 老图元不变）
    if (Math.round(pv.aline ?? 1)) {
      const xa = view.xmax * 0.98
      s += lineSvg(X(-xa), Y(-(b / a) * -xa), X(xa), Y((b / a) * xa), stroke, thin, dash)
      s += lineSvg(X(-xa), Y((b / a) * -xa), X(xa), Y(-(b / a) * xa), stroke, thin, dash)
    }
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
    if (Math.round(pv.aline ?? 1)) {
      const xa = view.xmax * 0.98
      s += lineSvg(X(-xa), Y(-(a / b) * -xa), X(xa), Y((a / b) * xa), stroke, thin, dash)
      s += lineSvg(X(-xa), Y((a / b) * -xa), X(xa), Y(-(a / b) * xa), stroke, thin, dash)
    }
    s += dot(0, -c) + dot(0, c)
    s += label(0, -c, 'F₁', fs * 1.25, 0) + label(0, c, 'F₂', fs * 1.25, 0)
    s += dot(0, -a, 0.9) + dot(0, a, 0.9)
    s += label(0, -a, 'A₁', fs * 1.15, -fs * 0.9) + label(0, a, 'A₂', fs * 1.15, fs * 0.9)
  } else if (kind === 'conicParabola' || kind === 'conicFocusDir') {
    const p = 2                            // y² = 2px，焦点 (p/2, 0)，准线 x = −p/2
    const yMax = Math.min(view.ymax * 0.88, Math.sqrt(2 * p * view.xmax * 0.86))
    s += curve(plotParametric((t) => (t * t) / (2 * p), (t) => t, -yMax, yMax, view, w, h))
    if (Math.round(pv.dline ?? 1)) s += lineSvg(X(-p / 2), Y(view.ymin), X(-p / 2), Y(view.ymax), stroke, thin, dash)
    s += dot(p / 2, 0) + label(p / 2, 0, 'F', 0, fs * 1.25)
    if (kind === 'conicFocusDir') {
      const y0 = 1.7
      const px = (y0 * y0) / (2 * p), py = y0
      s += dot(px, py) + label(px, py, 'P', fs * 0.95, -fs * 0.95)
      s += lineSvg(X(p / 2), Y(0), X(px), Y(py), stroke, thin)
      s += lineSvg(X(px), Y(py), X(-p / 2), Y(py), stroke, thin)
      s += dot(-p / 2, py, 0.85) + label(-p / 2, py, 'H', -fs * 0.85, -fs * 0.85)
    } else if (Math.round(pv.dline ?? 1)) {
      s += label(-p / 2, view.ymax * 0.92, '准线', -fs * 1.6, 0)
    }
  } else if (kind === 'conicParabolaV') {
    const p = 2                            // x² = 2py，焦点 (0, p/2)，准线 y = −p/2
    const xMax = Math.min(view.xmax * 0.88, Math.sqrt(2 * p * view.ymax * 0.86))
    s += curve(plotParametric((t) => t, (t) => (t * t) / (2 * p), -xMax, xMax, view, w, h))
    if (Math.round(pv.dline ?? 1)) {
      s += lineSvg(X(view.xmin), Y(-p / 2), X(view.xmax), Y(-p / 2), stroke, thin, dash)
      s += label(view.xmax * 0.86, -p / 2, '准线', 0, -fs * 0.9)
    }
    s += dot(0, p / 2) + label(0, p / 2, 'F', -fs * 0.95, fs * 0.2)
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
    if (Math.round(pv.aline ?? 1)) {
      const xa = view.xmax * 0.98
      s += lineSvg(X(-xa), Y((b / a) * -xa), X(xa), Y((b / a) * xa), stroke, thin, dash)
      s += lineSvg(X(-xa), Y(-(b / a) * -xa), X(xa), Y(-(b / a) * xa), stroke, thin, dash)
    }
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
