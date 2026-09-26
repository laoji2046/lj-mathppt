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

/** 采样 y=f(x) 成 path 的 d（越出窗口 / NaN / ∞ 处断线，多段用空格连接）。
 *
 *  ⚠ **xRange**：只画 [x0,x1] 这一截，但**像素映射仍用 view**（plotFunction 的第 2 个参数）。
 *  分段函数必须走这个参数 —— 以前是传 `{...view, xmin: a, xmax: b}`：
 *  那样采样范围对了，可**像素映射也跟着变成 [a,b] → 整段被拉伸铺满整个画布** ✗
 *  （用户实报"分段不正确"；内置的「分段函数（实心/空心点）」卡片其实一直是这个毛病）。
 *  不传 xRange 时行为与原来完全一致。 */
export function plotFunction(
  f: (x: number) => number, view: View, w: number, h: number, steps = 360, xRange?: [number, number],
): string {
  const { X, Y } = mapper(view, w, h)
  const xs = xRange ? xRange[0] : view.xmin
  const xe = xRange ? xRange[1] : view.xmax
  const margin = h * 0.06
  const out: string[] = []
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const x = xs + ((xe - xs) * i) / steps
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
export interface TickCfg { step?: number; pi?: boolean; yLabels?: number[]; /** 坐标轴的虚线样式（空 = 实线） */ dash?: string }

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
  const axd = cfg.dash ? ' stroke-dasharray="' + cfg.dash + '"' : ''
  s += '<line x1="0" y1="' + n1(y0) + '" x2="' + n1(w) + '" y2="' + n1(y0) + '" stroke="' + stroke + '" stroke-width="' + n1(thin) + '"' + axd + '/>'
  s += '<polygon points="' + n1(w) + ',' + n1(y0) + ' ' + n1(w - head) + ',' + n1(y0 - head * 0.42) + ' ' + n1(w - head) + ',' + n1(y0 + head * 0.42) + '" fill="' + stroke + '"/>'
  s += '<line x1="' + n1(x0) + '" y1="' + n1(h) + '" x2="' + n1(x0) + '" y2="0" stroke="' + stroke + '" stroke-width="' + n1(thin) + '"' + axd + '/>'
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
  /** 把**同一组的参数并成一行**显示（如 x/y/大小 一行、k/m 一行、起/终一行）；
   *  同一 group 的第一个参数的 label 用来定行，其余用 short 当行内小标题 */
  group?: string
  /** 并成一行时用的**短标题**（如 "x"、"k"、"起x"） */
  short?: string
  /** 并成一行时，**框左边的名字**（如"曲线"、"坐标轴"）；不给就从第一个参数的 label 里猜 */
  groupTitle?: string
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
  if (kind === 'histogram') return histogramParams()          // 【M2.11】统计图 ✓
  if (kind === 'freqLine') return freqLineParams()            // 【M2.12】
  if (kind === 'scatter') return scatterParams()
  if (kind === 'freqTable') return freqTableParams()
  if (kind === 'vennIntersect' || kind === 'vennUnion' || kind === 'vennComplement') {
    // 【v1638】交/并/补 是独立类型（模式已定）→ 不给「类型」下拉，其余参数同韦恩图 ✓
    return [{ key: 'gap', label: '两圆间距（0=几乎重合，2.2 以上相离）', def: 1, min: 0, max: 3, step: 0.05 },
      { key: 'rmask', label: '区域填充掩码（0=用上面预设）', def: 4, min: 0, max: 255, step: 1 }]
  }
  if (kind === 'vennFigure') return [
    { key: 'mode', label: '类型（0交 1并 2补 3子集 4相离 5三集）', def: 0, min: 0, max: 5, step: 1 },
    { key: 'shade', label: '打阴影', def: 1, min: 0, max: 1, step: 1, bool: true },
    { key: 'gap', label: '两圆间距（0=几乎重合，2.2 以上相离）', def: 1, min: 0, max: 3, step: 0.05 },
    // 【v1637】区域填充掩码：两位集合 bit0=A bit1=B bit2=A∩B bit3=两圆外；三位 bit0..6 七个区域 bit7=三圆外 ✓
    //   =0 时退回老的「打阴影」预设行为（向后兼容 ✓）
    { key: 'rmask', label: '区域填充掩码（0=用上面预设）', def: 0, min: 0, max: 255, step: 1 },
  ]
  if (kind === 'setNumberline') return [
    { key: 'a', label: '左端点 a', def: -1, min: -1000, max: 1000, step: 0.5 },
    { key: 'b', label: '右端点 b', def: 2, min: -1000, max: 1000, step: 0.5 },
    { key: 'leftOpen', label: '左端点空心（开）', def: 1, min: 0, max: 1, step: 1, bool: true },
    { key: 'rightOpen', label: '右端点空心（开）', def: 1, min: 0, max: 1, step: 1, bool: true },
    { key: 'shadeLine', label: '把区间加粗标出', def: 1, min: 0, max: 1, step: 1, bool: true },
  ]
  return FUNCTIONS[kind]?.params ?? CONICS[kind]?.params ?? []
}

/** 把外部参数与默认值合并 */
/** 【M2.11】频率分布直方图：可调参数（组距 / 起点 / 箱数 / 各箱高度=频率·组距 ✓）
 *  h1..h10 就是图上每根柱子的高度 ✓（可直接照书上数字填 ✓，也可以用属性面板里的"粘贴原始数据"自动算 ✓） */
const HIST_MAX = 10
export function histogramParams(): ParamSpec[] {
  const out: ParamSpec[] = [
    { key: 'start', label: '起始边界', def: 345, min: -1000, max: 100000, step: 1 },
    { key: 'bw', label: '组距', def: 10, min: 0.1, max: 10000, step: 1 },
    { key: 'n', label: '组数', def: 8, min: 1, max: HIST_MAX, step: 1 },
    { key: 'ymax', label: '纵轴最大值（0=自动）', def: 0, min: 0, max: 1, step: 0.001 },
    { key: 'ystep', label: '纵轴刻度步长（0=自动）', def: 0, min: 0, max: 1, step: 0.001 },
  ]
  // 默认给一组**像真题那样**的样例 ✓（一打开就有柱子 ✓ 老师粘自己的数据就把它们覆盖掉 ✓）
  const sample = [0.005, 0.01, 0.02, 0.025, 0.015, 0.01, 0.005, 0.005, 0, 0]
  for (let i = 1; i <= HIST_MAX; i++) {
    out.push({ key: 'h' + i, label: '第 ' + i + ' 组 频率/组距', def: sample[i - 1] || 0, min: 0, max: 1, step: 0.001, showIf: (p: Record<string, number>) => Number(p.n || 8) >= i })
  }
  return out
}
/** 频率分布直方图：自己算坐标（不依赖其它图元的助手 ✓，改起来不怕碰坏别人 ✓） */
export function histogramFigure(w: number, h: number, stroke: string, sw: number, params?: Record<string, number>, labels?: { x?: string; y?: string; bars?: string }): string {
  const p = withParams('histogram', params)
  const n = Math.max(1, Math.min(HIST_MAX, Math.round(p.n || 8)))
  const bw = p.bw > 0 ? p.bw : 10
  const start = Number.isFinite(p.start) ? p.start : 0
  const vals: number[] = []
  for (let i = 0; i < n; i++) vals.push(Math.max(0, p['h' + (i + 1)] || 0))
  const mv = Math.max(0.0001, ...vals)
  /** 「好看的步长」= 1 / 2 / 2.5 / 5 × 10ⁿ ✓ —— 老师要的是书上那种整齐刻度（0.005 / 0.01 / 0.015 …）✓ */
  const niceStep = (raw: number): number => {
    if (!(raw > 0)) return 1
    const e = Math.pow(10, Math.floor(Math.log10(raw)))
    const m = raw / e
    const k = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10
    return k * e
  }
  const ymaxFix = Number(p.ymax) || 0            // 手填了就用它 ✓（0 = 自动 ✓）
  const stepY = Number(p.ystep) > 0 ? Number(p.ystep) : niceStep(mv / 4)
  let ymax = ymaxFix > 0 ? ymaxFix : Math.ceil(mv / stepY) * stepY
  if (ymaxFix <= 0 && ymax - mv < stepY * 0.2) ymax += stepY   // 最高的柱子别顶到框 ✓
  if (ymax < mv) ymax = Math.ceil(mv / stepY) * stepY
  // ⚠ 左/上要**留出写字的地方** ✗ —— 原来 padL=46 太窄 ✓，纵轴刻度数字（anchor=end ✓）
  //   和「频率 / 组距」两行标题会挤在同一块地方叠在一起 ✗（老师截图 ✓）
  const padL = 74, padR = 30, padT = 34, padB = 40
  const X = (v: number) => padL + ((v - start) / (n * bw)) * (w - padL - padR)
  const Y = (v: number) => h - padB - (v / ymax) * (h - padT - padB)
  const ink = stroke || '#111'          // 用元素自己的描边色 ✓（主题深浅都能看清 ✓）
  // 字号按**宽度**算 ✓（图宽而扁时按高度算会变成巨字 ✗）
  const fs = Math.max(10, Math.min(17, Math.round(w * 0.032)))
  const L: string[] = []
  // 纵轴（带原点断口 ✓ —— 表示纵轴不从 0 起 ✓）
  const x0 = X(start), y0 = Y(0), yTop = Y(ymax)
  L.push('<path d="M ' + n1(x0) + ' ' + n1(y0) + ' L ' + n1(x0 - 7) + ' ' + n1(y0 - 4) + ' L ' + n1(x0 - 4) + ' ' + n1(y0 - 8) + ' L ' + n1(x0) + ' ' + n1(y0 - 12) + '" fill="none" stroke="' + ink + '" stroke-width="' + n1(sw) + '"/>')
  // 【M2.13】两轴都带**箭头** ✓（老师要求 ✓）
  L.push(axisArrow(x0, y0 - 12, x0, yTop - 4, ink, sw))
  L.push(axisArrow(x0, y0, X(start + n * bw) + 16, y0, ink, sw))
  // 柱体 + 纵轴虚线 + 刻度
  // 纵轴刻度：画 1..4 档 ✓ —— **最上面那档不画** ✓（那一格留给「频率 / 组距」两行标题 ✓ 书上也常这样 ✓）
  // ⚠ 刻度数字别用 n1 ✗ —— 它是"一位小数"✓，0.005 会被写成 0.0 ✗（老师截图里就是 0.0 ✓）
  const num = (v: number): string => {
    if (!Number.isFinite(v)) return '0'
    const a = Math.abs(v)
    if (a >= 100) return String(Math.round(v))
    if (a >= 1) return String(Math.round(v * 1000) / 1000)
    if (a === 0) return '0'
    return String(Number(v.toFixed(4)))
  }
  // 【v1633】每组填充（用户要求：可对所有组 / 指定组设阴影、颜色）——
  //   编码放在 labels.bars：`图案:颜色|图案:颜色|…`（空 = 不填）✓
  const barSpec = String(labels?.bars || "")
  const barArr = barSpec ? barSpec.split("|") : []
  const defs: string[] = []
  const patIds = new Set<string>()
  const uid = Math.random().toString(36).slice(2, 7)
  const patternDef = (id: string, kind: string, color: string): string => {
    const head = '<pattern id="' + id + '" width="8" height="8" patternUnits="userSpaceOnUse">'
    if (kind === "h") return head + '<path d="M-2 2 L2 -2 M0 8 L8 0 M6 10 L10 6" stroke="' + color + '" stroke-width="1.1"/></pattern>'
    if (kind === "x") return head + '<path d="M0 8 L8 0 M0 0 L8 8" stroke="' + color + '" stroke-width="1.1"/></pattern>'
    if (kind === "d") return head + '<circle cx="2" cy="2" r="0.9" fill="' + color + '"/></pattern>'
    return head + '<path d="M0 0 L8 0 M0 0 L0 8" stroke="' + color + '" stroke-width="0.9"/></pattern>'
  }
  const barFill = (i: number): string => {
    const spec = barArr[i]
    if (!spec) return "none"
    const parts = spec.split(":")
    const pat = parts[0] || "", col = parts[1] || ink
    if (!pat) return "none"
    if (pat === "s") return col
    const id = "hp" + uid + "_" + i
    if (!patIds.has(id)) { patIds.add(id); defs.push(patternDef(id, pat, col)) }
    return "url(#" + id + ")"
  }
  for (let i = 0; i < n; i++) {
    const v = vals[i]
    if (v <= 0) continue
    const xa = X(start + i * bw), xb = X(start + (i + 1) * bw), yv = Y(v)
    L.push('<rect x="' + n1(xa) + '" y="' + n1(yv) + '" width="' + n1(xb - xa) + '" height="' + n1(y0 - yv) + '" fill="' + barFill(i) + '" stroke="' + ink + '" stroke-width="' + n1(sw) + '"/>')
  }
  // 刻度线画到**最上面一档之下** ✓（最顶那格留给「频率 / 组距」✓）
  for (let k = 1; stepY * k < ymax - stepY * 1e-6; k++) {
    const yy = Y(stepY * k)
    L.push('<line x1="' + n1(x0) + '" y1="' + n1(yy) + '" x2="' + n1(X(start + n * bw)) + '" y2="' + n1(yy) + '" stroke="#666" stroke-width="1" stroke-dasharray="5 4"/>')
    L.push('<text x="' + n1(x0 - 8) + '" y="' + n1(yy + fs * 0.35) + '" font-size="' + fs + '" fill="' + ink + '" text-anchor="end">' + num(stepY * k) + '</text>')
  }
  // 横轴边界刻度（只标边界值 ✓ 与书上一致 ✓）
  for (let i = 0; i <= n; i++) {
    const xv = X(start + i * bw)
    L.push('<text x="' + n1(xv) + '" y="' + n1(y0 + fs * 1.35) + '" font-size="' + fs + '" fill="' + ink + '" text-anchor="middle">' + num(start + i * bw) + '</text>')
  }
  L.push('<text x="' + n1(x0 + 4) + '" y="' + n1(y0 + fs * 2.7) + '" font-size="' + fs + '" fill="' + ink + '">O</text>')
  // 轴标题
  // 「频率 / 组距」写在**最左边那一列** ✓（刻度数字的左边 ✓ 不再叠在一起 ✓）
  const labX = fs * 1.35
  // 【M2.13】轴标注可手填 ✓（纵轴默认「频率/组距」两行 ✓，填了就用填的 ✓）
  const yl = String(labels?.y || '')
  if (yl) {
    L.push('<text x="' + n1(fs * 1.35) + '" y="' + n1(yTop + fs * 0.4) + '" font-size="' + fs + '" fill="' + ink + '" text-anchor="middle">' + yl + '</text>')
  } else {
    L.push('<text x="' + n1(labX) + '" y="' + n1(yTop - fs * 0.15) + '" font-size="' + fs + '" fill="' + ink + '" text-anchor="middle">频率</text>')
    L.push('<text x="' + n1(labX) + '" y="' + n1(yTop + fs * 1.05) + '" font-size="' + fs + '" fill="' + ink + '" text-anchor="middle">组距</text>')
  }
  L.push('<text x="' + n1(X(start + n * bw) + 12) + '" y="' + n1(y0 - fs * 0.35) + '" font-size="' + fs + '" fill="' + ink + '">' + String(labels?.x || '分组') + '</text>')
  // 【v1633】图案定义（<defs>）要跟着图形一起出去，且必须在使用它的 <rect> 之前/同一 svg 内 ✓
  return (defs.length ? '<defs>' + defs.join('') + '</defs>' : '') + L.join('')
}


/** 【M2.13】带箭头的坐标轴（统计图共用 ✓）—— 箭头 + 轴末端标注 ✓ */
export function axisArrow(x1: number, y1: number, x2: number, y2: number, ink: string, sw: number, a = 16): string {
  const ang = Math.atan2(y2 - y1, x2 - x1)
  const p = (d: number, off: number) => n1(x2 - d * Math.cos(ang - off)) + ' ' + n1(y2 - d * Math.sin(ang - off))
  // ⚠ 箭头原来 a=7 / 半角 0.4 ✗ —— 又短又宽 ✓，缩到讲义里几乎看不见 ✗（老师截图 ✓）
  //   改成"细长实心三角" ✓：长约 16 单位（≈ 线宽的 8~10 倍 ✓）、半角 0.2 ✓ —— 就是教材上那种箭头 ✓
  const half = 0.2
  const shaftEnd = 0.9                                    // 线画到箭头根部稍前一点 ✓ 免得从三角里透出来 ✓
  return '<line x1="' + n1(x1) + '" y1="' + n1(y1) + '" x2="' + n1(x2 - (a * shaftEnd) * Math.cos(ang)) + '" y2="' + n1(y2 - (a * shaftEnd) * Math.sin(ang)) + '" stroke="' + ink + '" stroke-width="' + n1(sw) + '"/>'
    + '<path d="M ' + n1(x2) + ' ' + n1(y2) + ' L ' + p(a, half) + ' L ' + p(a, -half) + ' Z" fill="' + ink + '"/>'
}
/** 【M2.13】频率分布表：分组区间 / 频数 / 频率 / 频率·组距 ✓（画成一张表 ✓ 可直接插讲义 ✓） */
export function freqTableParams(): ParamSpec[] {
  const out: ParamSpec[] = [
    { key: 'start', label: '起始边界', def: 345, min: -1000, max: 100000, step: 1 },
    { key: 'bw', label: '组距', def: 10, min: 0.1, max: 10000, step: 1 },
    { key: 'n', label: '组数', def: 8, min: 1, max: HIST_MAX, step: 1 },
    { key: 'showDensity', label: '显示「频率/组距」列', def: 0, min: 0, max: 1, step: 1, bool: true },
  ]
  const sample = [4, 8, 15, 22, 25, 14, 6, 2, 0, 0]
  for (let i = 1; i <= HIST_MAX; i++) out.push({ key: 'f' + i, label: '第 ' + i + ' 组 频数', def: sample[i - 1] || 0, min: 0, max: 100000, step: 1, showIf: (q: Record<string, number>) => Number(q.n || 8) >= i })
  return out
}
export function freqTableFigure(w: number, h: number, stroke: string, sw: number, params?: Record<string, number>, labels?: { x?: string; y?: string; bars?: string }): string {
  const p = withParams('freqTable', params)
  const n = Math.max(1, Math.min(HIST_MAX, Math.round(p.n || 8)))
  const bw = p.bw > 0 ? p.bw : 10
  const start = Number.isFinite(p.start) ? p.start : 0
  const f: number[] = []
  // ⚠ 必须写 'f' + (i + 1) ✗ —— 写成 'f' + i + 1 会拼出 'f01' ✓，频数永远是 0 ✗（截图里就是全 0 ✓）
  for (let i = 0; i < n; i++) f.push(Math.max(0, Math.round(p['f' + (i + 1)] || 0)))
  const total = f.reduce((a, b) => a + b, 0) || 1
  const density = p.showDensity > 0.5
  const cols = density ? 4 : 3
  const rowH = (h - 8) / (n + 2)
  const x0 = 6, tw = w - 12
  const ink = stroke || '#111'
  const fs = Math.max(9, Math.min(15, Math.round(rowH * 0.5)))
  const cw = tw / cols
  const L: string[] = []
  const fmt = (v: number) => {
    const t = Number(v.toFixed(3))
    return String(t)
  }
  const cell = (x: number, y: number, txt: string, bold: boolean) => '<text x="' + n1(x + cw / 2) + '" y="' + n1(y + rowH * 0.66) + '" font-size="' + fs + '" fill="' + ink + '" text-anchor="middle"' + (bold ? ' font-weight="bold"' : '') + '>' + txt + '</text>'
  const head = density ? ['分组', '频数', '频率', '频率/组距'] : ['分组', '频数', '频率']
  for (let c = 0; c <= cols; c++) L.push('<line x1="' + n1(x0 + cw * c) + '" y1="' + n1(4) + '" x2="' + n1(x0 + cw * c) + '" y2="' + n1(4 + rowH * (n + 2)) + '" stroke="' + ink + '" stroke-width="' + n1(sw * 0.8) + '"/>')
  for (let r = 0; r <= n + 2; r++) L.push('<line x1="' + n1(x0) + '" y1="' + n1(4 + rowH * r) + '" x2="' + n1(x0 + tw) + '" y2="' + n1(4 + rowH * r) + '" stroke="' + ink + '" stroke-width="' + n1(sw * 0.8) + '"/>')
  for (let c = 0; c < cols; c++) L.push(cell(x0 + cw * c, 4, head[c], true))
  for (let i = 0; i < n; i++) {
    const y = 4 + rowH * (i + 1)
    const a = start + i * bw, b = start + (i + 1) * bw
    L.push(cell(x0, y, '[' + fmt(a) + ', ' + fmt(b) + (i === n - 1 ? ']' : ')'), false))
    L.push(cell(x0 + cw, y, String(f[i]), false))
    L.push(cell(x0 + cw * 2, y, (f[i] / total).toFixed(3), false))
    if (density) L.push(cell(x0 + cw * 3, y, (f[i] / total / bw).toFixed(4), false))
  }
  const yt = 4 + rowH * (n + 1)
  L.push(cell(x0, yt, '合计', true))
  L.push(cell(x0 + cw, yt, String(total), true))
  L.push(cell(x0 + cw * 2, yt, '1.000', true))
  if (density) L.push(cell(x0 + cw * 3, yt, '', true))
  if (labels?.x) L.push('<text x="' + n1(x0 + tw / 2) + '" y="' + n1(4 + rowH * (n + 2) + fs * 1.2) + '" font-size="' + fs + '" fill="' + ink + '" text-anchor="middle">' + labels.x + '</text>')
  return L.join('')
}
/** 【M2.12】频率分布折线图：与直方图同一组分箱参数 ✓（可叠加直方图底稿 ✓） */
export function freqLineParams(): ParamSpec[] {
  const out = histogramParams().slice()
  out.push({ key: 'bars', label: '叠加直方图底稿', def: 1, min: 0, max: 1, step: 1, bool: true })
  return out
}
export function freqLineFigure(w: number, h: number, stroke: string, sw: number, params?: Record<string, number>, labels?: { x?: string; y?: string; bars?: string }): string {
  const p = withParams('freqLine', params)
  const n = Math.max(2, Math.min(HIST_MAX, Math.round(p.n || 8)))
  const bw = p.bw > 0 ? p.bw : 10
  const start = Number.isFinite(p.start) ? p.start : 0
  const vals: number[] = []
  for (let i = 0; i < n; i++) vals.push(Math.max(0, p['h' + (i + 1)] || 0))
  const mv = Math.max(0.0001, ...vals)
  const padL = 74, padR = 30, padT = 34, padB = 40
  const X = (v: number) => padL + ((v - start) / (n * bw)) * (w - padL - padR)
  const Y = (v: number) => h - padB - (v / ymaxOf(p, mv)) * (h - padT - padB)
  const ink = stroke || '#111'
  const fs = Math.max(10, Math.min(17, Math.round(w * 0.032)))
  const L: string[] = []
  const x0 = X(start), y0 = Y(0), yTop = Y(ymaxOf(p, mv))
  L.push(axisArrow(x0, y0 - 12, x0, yTop - 4, ink, sw))                       // 【M2.13】箭头 ✓
  L.push(axisArrow(x0, y0, X(start + n * bw) + 16, y0, ink, sw))
  const step = Number(p.ystep) > 0 ? Number(p.ystep) : niceStepOf(mv / 4)
  const ytop = ymaxOf(p, mv)
  for (let k = 1; step * k < ytop - step * 1e-6; k++) {
    const yy = Y(step * k)
    L.push('<line x1="' + n1(x0) + '" y1="' + n1(yy) + '" x2="' + n1(X(start + n * bw)) + '" y2="' + n1(yy) + '" stroke="#666" stroke-width="1" stroke-dasharray="5 4"/>')
    L.push('<text x="' + n1(x0 - 8) + '" y="' + n1(yy + fs * 0.35) + '" font-size="' + fs + '" fill="' + ink + '" text-anchor="end">' + numOf(step * k) + '</text>')
  }
  for (let i = 0; i <= n; i++) L.push('<text x="' + n1(X(start + i * bw)) + '" y="' + n1(y0 + fs * 1.35) + '" font-size="' + fs + '" fill="' + ink + '" text-anchor="middle">' + numOf(start + i * bw) + '</text>')
  // 直方图底稿（浅色 ✓）
  if (p.bars > 0.5) {
    for (let i = 0; i < n; i++) {
      const v = vals[i]; if (v <= 0) continue
      const xa = X(start + i * bw), xb = X(start + (i + 1) * bw), yv = Y(v)
      L.push('<rect x="' + n1(xa) + '" y="' + n1(yv) + '" width="' + n1(xb - xa) + '" height="' + n1(y0 - yv) + '" fill="#000" fill-opacity="0.05" stroke="' + ink + '" stroke-width="1" stroke-opacity="0.45"/>')
    }
  }
  // 折线：各组**中点**连起来 ✓（首尾落到 x 轴上 ✓ 书上就是这么画的 ✓）
  const pts: string[] = []
  pts.push(n1(X(start)) + ',' + n1(y0))
  for (let i = 0; i < n; i++) pts.push(n1(X(start + (i + 0.5) * bw)) + ',' + n1(Y(vals[i])))
  pts.push(n1(X(start + n * bw)) + ',' + n1(y0))
  L.push('<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + ink + '" stroke-width="' + n1(sw) + '"/>')
  for (let i = 0; i < n; i++) L.push('<circle cx="' + n1(X(start + (i + 0.5) * bw)) + '" cy="' + n1(Y(vals[i])) + '" r="' + n1(sw * 1.3) + '" fill="' + ink + '"/>')
  const yl2 = String(labels?.y || '')
  if (yl2) L.push('<text x="' + n1(fs * 1.35) + '" y="' + n1(yTop + fs * 0.4) + '" font-size="' + fs + '" fill="' + ink + '" text-anchor="middle">' + yl2 + '</text>')
  else {
    L.push('<text x="' + n1(fs * 1.35) + '" y="' + n1(yTop - fs * 0.15) + '" font-size="' + fs + '" fill="' + ink + '" text-anchor="middle">频率</text>')
    L.push('<text x="' + n1(fs * 1.35) + '" y="' + n1(yTop + fs * 1.05) + '" font-size="' + fs + '" fill="' + ink + '" text-anchor="middle">组距</text>')
  }
  L.push('<text x="' + n1(X(start + n * bw) + 12) + '" y="' + n1(y0 - fs * 0.35) + '" font-size="' + fs + '" fill="' + ink + '">' + String(labels?.x || '分组') + '</text>')
  return L.join('')
}
/** 【M2.12】散点图：x1..x12 / y1..y12 ✓（12 个点，够画一道题 ✓） */
export const SCATTER_MAX = 12
export function scatterParams(): ParamSpec[] {
  const out: ParamSpec[] = [{ key: 'grid', label: '画网格', def: 1, min: 0, max: 1, step: 1, bool: true }, { key: 'line', label: '连成折线', def: 0, min: 0, max: 1, step: 1, bool: true }, { key: 'n', label: '点数', def: 6, min: 1, max: SCATTER_MAX, step: 1 }]
  for (let i = 1; i <= SCATTER_MAX; i++) {
    out.push({ key: 'x' + i, label: '点 ' + i + ' 的 x', def: i, min: -1000, max: 1000, step: 0.5, showIf: (q: Record<string, number>) => Number(q.n || 6) >= i })
    out.push({ key: 'y' + i, label: '点 ' + i + ' 的 y', def: ((i * 7) % 5) + 1, min: -1000, max: 1000, step: 0.5, showIf: (q: Record<string, number>) => Number(q.n || 6) >= i })
  }
  return out
}
export function scatterFigure(w: number, h: number, stroke: string, sw: number, params?: Record<string, number>, labels?: { x?: string; y?: string; bars?: string }): string {
  const p = withParams('scatter', params)
  const n = Math.max(1, Math.min(SCATTER_MAX, Math.round(p.n || 6)))
  const pts: { x: number; y: number }[] = []
  for (let i = 1; i <= n; i++) pts.push({ x: p['x' + i] || 0, y: p['y' + i] || 0 })
  const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y)
  let xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys)
  const padX = (xmax - xmin || 1) * 0.35, padY = (ymax - ymin || 1) * 0.35
  xmin -= padX; xmax += padX; ymin -= padY; ymax += padY
  const padL = 40, padR = 24, padT = 22, padB = 34
  const X = (v: number) => padL + ((v - xmin) / (xmax - xmin)) * (w - padL - padR)
  const Y = (v: number) => h - padB - ((v - ymin) / (ymax - ymin)) * (h - padT - padB)
  const ink = stroke || '#111'
  const fs = Math.max(10, Math.min(16, Math.round(w * 0.03)))
  const L: string[] = []
  const xa = X(0) > padL ? X(0) : padL, ya = Y(0) < h - padB ? Y(0) : h - padB
  if (p.grid > 0.5) {
    for (let k = 1; k <= 4; k++) {
      const gx = padL + ((w - padL - padR) * k) / 5, gy = padT + ((h - padT - padB) * k) / 5
      L.push('<line x1="' + n1(gx) + '" y1="' + n1(padT) + '" x2="' + n1(gx) + '" y2="' + n1(h - padB) + '" stroke="#000" stroke-opacity="0.12" stroke-width="1"/>')
      L.push('<line x1="' + n1(padL) + '" y1="' + n1(gy) + '" x2="' + n1(w - padR) + '" y2="' + n1(gy) + '" stroke="#000" stroke-opacity="0.12" stroke-width="1"/>')
    }
  }
  L.push(axisArrow(padL, ya, w - padR, ya, ink, sw))     // 【M2.13】箭头 ✓
  L.push(axisArrow(xa, h - padB, xa, padT, ink, sw))
  L.push('<text x="' + n1(w - padR) + '" y="' + n1(ya + fs * 1.3) + '" font-size="' + fs + '" fill="' + ink + '" text-anchor="end">' + String(labels?.x || 'x') + '</text>')
  L.push('<text x="' + n1(xa + fs * 0.5) + '" y="' + n1(padT + fs) + '" font-size="' + fs + '" fill="' + ink + '">' + String(labels?.y || 'y') + '</text>')
  L.push('<text x="' + n1(xa - fs * 0.4) + '" y="' + n1(ya + fs * 1.1) + '" font-size="' + fs + '" fill="' + ink + '">O</text>')
  if (p.line > 0.5 && pts.length > 1) L.push('<polyline points="' + pts.map((q) => n1(X(q.x)) + ',' + n1(Y(q.y))).join(' ') + '" fill="none" stroke="' + ink + '" stroke-width="1" stroke-dasharray="4 3"/>')
  for (const q of pts) L.push('<circle cx="' + n1(X(q.x)) + '" cy="' + n1(Y(q.y)) + '" r="' + n1(Math.max(2.6, sw * 1.4)) + '" fill="' + ink + '"/>')
  return L.join('')
}
/** 频率折线图 / 散点图共用的两个小工具 ✓（与直方图同算法 ✓） */
function niceStepOf(raw: number): number {
  if (!(raw > 0)) return 1
  const e = Math.pow(10, Math.floor(Math.log10(raw)))
  const m = raw / e
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e
}
function numOf(v: number): string {
  if (!Number.isFinite(v)) return '0'
  const a = Math.abs(v)
  if (a >= 100) return String(Math.round(v))
  if (a >= 1) return String(Math.round(v * 1000) / 1000)
  if (a === 0) return '0'
  return String(Number(v.toFixed(4)))
}
function ymaxOf(p: Record<string, number>, mv: number): number {
  const step = Number(p.ystep) > 0 ? Number(p.ystep) : niceStepOf(mv / 4)
  const fix = Number(p.ymax) || 0
  if (fix > 0) return fix
  let y = Math.ceil(mv / step) * step
  if (y - mv < step * 0.2) y += step
  return y
}

/* ================= 【M2.14】集合图形（Venn 六种 + 数轴区间） ================= */
/** 圆的交点（两圆交点的两个 x/y）—— 画"交集那块透镜"用 ✓ */
function lensPath(cx1: number, cy: number, r: number, d: number): string {
  const a = r * r, h = Math.sqrt(Math.max(0, a - (d / 2) * (d / 2)))
  const x1 = cx1 + d / 2, y1 = cy - h, y2 = cy + h
  return 'M ' + n1(x1) + ' ' + n1(y1) + ' A ' + n1(r) + ' ' + n1(r) + ' 0 0 1 ' + n1(x1) + ' ' + n1(y2)
    + ' A ' + n1(r) + ' ' + n1(r) + ' 0 0 1 ' + n1(x1) + ' ' + n1(y1) + ' Z'
}
/**
 * 韦恩图（交集 / 并集 / 补集 / 子集 / 相离 / 三集合）✓
 *   mode: 0=交集 1=并集 2=补集 3=子集 4=相离 5=三集合 ✓（参数是数字 ✓ 面板能直接选 ✓）
 *   阴影用"白底抠洞"的稳妥办法 ✓（讲义/幻灯片都是白底 ✓ 不依赖 clip ✓）
 */
export function vennFigure(w: number, h: number, stroke: string, sw: number, params?: Record<string, number>, labels?: { x?: string; y?: string; fill?: string }): string {
  const p = withParams('vennFigure', params)
  const mode = Math.round(p.mode || 0)
  const shade = p.shade > 0.5
  const ink = stroke || '#111'
  const cy = h * 0.52
  // 【v1640】半径要跟间距联动：圆心距 = r*k，两圆总宽 = r*(k+2) + 边距 ——
  //   不联动的话间距一大，圆就戳出画布、全集矩形反而装不下 ✗（用户报"矩形有点儿小了"）
  const kGap = 0.2 + (Number.isFinite(p.gap) ? p.gap : 1) * 0.9
  const r = Math.min(h * 0.3, w * 0.2, (w * 0.94) / (kGap + 2.5), (h * 0.9) / 2.5)
  // 【M2.15】集合字母**按圆半径定字号**（原来按整幅宽算 ✗ 偏小 ✓）—— 老师要求：字母更大、位置接近圆心 ✓
  const fs = Math.max(13, Math.min(34, Math.round(r * 0.72)))
  // 【v1639】圆心距系数：以前是 r*(0.55+gap*0.25) → gap 拉到 3 也只有 1.3r，两个圆**永远重叠** ✗
  //   现在 0 → 0.2r（几乎重合）、1 → 1.1r、2.2 → 2.18r（刚好相离）、3 → 2.9r（离得很开）✓ 用户要能任意调 ✓
  const gap = r * (0.2 + (Number.isFinite(p.gap) ? p.gap : 1) * 0.9)
  const cx1 = w / 2 - gap / 2, cx2 = w / 2 + gap / 2
  const circle = (cx: number, fill: string) => '<circle cx="' + n1(cx) + '" cy="' + n1(cy) + '" r="' + n1(r) + '" fill="' + fill + '" stroke="' + ink + '" stroke-width="' + n1(sw) + '"/>'
  const lbl = (x: number, y: number, t: string) => '<text x="' + n1(x) + '" y="' + n1(y) + '" font-size="' + fs + '" fill="' + ink + '" text-anchor="middle">' + t + '</text>'
  const L: string[] = []
  const S = 'rgba(0,0,0,0.22)'
  // 【v1637】区域填充（用户要求：能对特定区域填充）——
  //   用**嵌套 clipPath** 精确切出每个区域：区域 = 属于 S 中每个圆、且不属于 T 中每个圆 ✓
  //   ├ 先铺要填的几何（U 矩形或最内层圆），再用白圆把不属于本区域的集合挖掉 ✓
  //   └ 填充层画在最前面，所以白色挖洞不会盖到后面的圆边与字母 ✓
  const rmask = Math.round(p.rmask || 0)
  const fillColor = String(labels?.fill || '') || S
  if (rmask > 0) {
    const uid = Math.random().toString(36).slice(2, 7)
    const three = mode === 5
    const rr = Math.min(h * 0.26, w * 0.17)
    const cs = three
      ? [{ x: w / 2 - rr * 0.7, y: cy - rr * 0.62 }, { x: w / 2 + rr * 0.7, y: cy - rr * 0.62 }, { x: w / 2, y: cy + rr * 0.66 }]
      : [{ x: cx1, y: cy }, { x: cx2, y: cy }]
    const rad = three ? rr : r
    // 【v1640】全集矩形按**圆的真实范围**算（用户报：矩形太小、相离时两圆戳出去了 ✗）——
    //   以前写死 86%×80%，间距一大圆就出框；现在取所有圆的包围盒 + 边距，再夹回画布内 ✓
    const pad = rad * 0.24
    const bx0 = Math.min(...cs.map((c) => c.x)) - rad - pad
    const bx1 = Math.max(...cs.map((c) => c.x)) + rad + pad
    const by0 = Math.min(...cs.map((c) => c.y)) - rad - pad
    const by1 = Math.max(...cs.map((c) => c.y)) + rad + pad
    const rect = {
      x: Math.max(w * 0.02, bx0),
      y: Math.max(h * 0.03, by0),
      rw: Math.min(w * 0.96, bx1) - Math.max(w * 0.02, bx0),
      rh: Math.min(h * 0.94, by1) - Math.max(h * 0.03, by0),
    }
    const cid = (i: number) => 'vc' + uid + i
    const defs = cs.map((c, i) => '<clipPath id="' + cid(i) + '"><circle cx="' + n1(c.x) + '" cy="' + n1(c.y) + '" r="' + n1(rad) + '"/></clipPath>').join('')
    const cs_ = (i: number, fill: string) => '<circle cx="' + n1(cs[i].x) + '" cy="' + n1(cs[i].y) + '" r="' + n1(rad) + '" fill="' + fill + '"/>'
    // 【v1637】区域语义按老师习惯来：**A 就代表整个圆 A**（含与别人重叠的部分）✓
    //   所以 A+B 一起选 = 并集（重叠处被两次填充，仍是同色 ✓）；A∩B 单独一档可再点 ✓
    //   「两圆外 / 三圆外」用 fill-rule=evenodd 的大路径挖掉所有圆 —— 不用白漆，避免把别的区域蹭花 ✓
    const rectPath = (extra: string) =>
      '<path fill-rule="evenodd" d="M' + n1(rect.x) + ' ' + n1(rect.y) + 'H' + n1(rect.x + rect.rw) + 'V' + n1(rect.y + rect.rh) + 'H' + n1(rect.x) + 'Z' + extra + '" fill="' + fillColor + '"/>'
    const circlePath = (i: number) =>
      'M' + n1(cs[i].x - rad) + ' ' + n1(cs[i].y) + 'a' + n1(rad) + ' ' + n1(rad) + ' 0 1 0 ' + n1(rad * 2) + ' 0a' + n1(rad) + ' ' + n1(rad) + ' 0 1 0 ' + n1(-rad * 2) + ' 0'
    const allCircles = cs.map((_, i) => circlePath(i)).join('')
    const one = (i: number) => cs_(i, fillColor)
    const both = (i: number, j: number) => '<g clip-path="url(#' + cid(i) + ')">' + cs_(j, fillColor) + '</g>'
    // ⚠ 必须写成函数：两集合时 cs 只有两个圆，直接求值会 cs[2] 越界 ✗（实测踩到）
    const triple = () => '<g clip-path="url(#' + cid(0) + ')"><g clip-path="url(#' + cid(1) + ')">' + cs_(2, fillColor) + '</g></g>'
    const outside = rectPath(allCircles)
    const regions = three
      ? [one(0), one(1), one(2), both(0, 1), both(0, 2), both(1, 2), triple(), outside]
      : [one(0), one(1), both(0, 1), rectPath(circlePath(0) + circlePath(1))]
    let fills = ''
    regions.forEach((svg, k) => { if (rmask & (1 << k)) fills += svg })
    if (fills) L.push('<defs>' + defs + '</defs>' + fills)
    if (rmask & (three ? 128 : 8)) L.push('<rect x="' + n1(rect.x) + '" y="' + n1(rect.y) + '" width="' + n1(rect.rw) + '" height="' + n1(rect.rh) + '" fill="none" stroke="' + ink + '" stroke-width="' + n1(sw) + '"/>')
  }        // 阴影色 ✓（浅灰 ✓ 黑白打印也看得见 ✓）
  if (mode === 0) {                   // A ∩ B
    if (shade) L.push('<path d="' + lensPath(cx1, cy, r, gap) + '" fill="' + S + '"/>')
    L.push(circle(cx1, 'none'), circle(cx2, 'none'))
    // 字母贴近各自圆心 ✓、只往外让开一点（别压到中间那块阴影 ✓）
    L.push(lbl(cx1 - r * 0.42, cy + fs * 0.35, 'A'), lbl(cx2 + r * 0.42, cy + fs * 0.35, 'B'))
    if (shade && !(p.rmask > 0)) L.push(lbl(w / 2, cy + r * 1.45, 'A∩B'))
  } else if (mode === 1) {            // A ∪ B
    if (shade) L.push('<g fill="' + S + '">' + circle(cx1, S) + circle(cx2, S) + '</g>')
    L.push(circle(cx1, 'none'), circle(cx2, 'none'))
    L.push(lbl(cx1 - r * 0.42, cy + fs * 0.35, 'A'), lbl(cx2 + r * 0.42, cy + fs * 0.35, 'B'))
  } else if (mode === 2) {            // ∁ᵤA
    const rw = w * 0.86, rh = h * 0.8, rx = w * 0.07, ry = h * 0.1
    L.push('<rect x="' + n1(rx) + '" y="' + n1(ry) + '" width="' + n1(rw) + '" height="' + n1(rh) + '" fill="' + (shade ? S : 'none') + '" stroke="' + ink + '" stroke-width="' + n1(sw) + '"/>')
    L.push(circle(cx1, '#fff'))
    L.push(lbl(rx + fs * 0.9, ry + fs * 1.1, 'U'))
    L.push(lbl(cx1, cy + fs * 0.35, 'A'))          // 补集：A 就在圆心 ✓
  } else if (mode === 3) {            // A ⊆ B
    const big = r * 1.5, small = r * 0.75
    if (shade) L.push(circle(cx2, small <= 0 ? 'none' : S))
    L.push('<circle cx="' + n1(cx2) + '" cy="' + n1(cy) + '" r="' + n1(big) + '" fill="none" stroke="' + ink + '" stroke-width="' + n1(sw) + '"/>')
    L.push('<circle cx="' + n1(cx2 - big * 0.35) + '" cy="' + n1(cy) + '" r="' + n1(small) + '" fill="none" stroke="' + ink + '" stroke-width="' + n1(sw) + '"/>')
    L.push(lbl(cx2 + big * 0.62, cy + fs * 0.35, 'B'), lbl(cx2 - big * 0.35, cy + fs * 0.35, 'A'))   // A 在小圆圆心附近 ✓
  } else if (mode === 4) {            // A ∩ B = ∅
    const d2 = r * 2.4
    L.push(circle(w / 2 - d2 / 2, 'none'), circle(w / 2 + d2 / 2, 'none'))
    L.push(lbl(w / 2 - d2 / 2, cy + fs * 0.35, 'A'), lbl(w / 2 + d2 / 2, cy + fs * 0.35, 'B'))   // 相离：各自圆心 ✓
    L.push(lbl(w / 2, cy + r * 1.6, 'A∩B = ∅'))
  } else {                            // 三集合
    const rr = Math.min(h * 0.26, w * 0.17)
    const fs3 = Math.max(12, Math.min(28, Math.round(rr * 0.66)))    // 【M2.15】三集合字母也按圆半径 ✓
    const c1 = { x: w / 2 - rr * 0.7, y: cy - rr * 0.62 }
    const c2 = { x: w / 2 + rr * 0.7, y: cy - rr * 0.62 }
    const c3 = { x: w / 2, y: cy + rr * 0.66 }
    for (const c of [c1, c2, c3]) L.push('<circle cx="' + n1(c.x) + '" cy="' + n1(c.y) + '" r="' + n1(rr) + '" fill="' + (shade ? 'rgba(0,0,0,0.10)' : 'none') + '" stroke="' + ink + '" stroke-width="' + n1(sw) + '"/>')
    const lbl3 = (x: number, y: number, t: string) => '<text x="' + n1(x) + '" y="' + n1(y) + '" font-size="' + fs3 + '" fill="' + ink + '" text-anchor="middle">' + t + '</text>'
    L.push(lbl3(c1.x - rr * 0.72, c1.y - rr * 0.1, 'A'), lbl3(c2.x + rr * 0.72, c2.y - rr * 0.1, 'B'), lbl3(c3.x, c3.y + rr * 0.92, 'C'))
  }
  return L.join('')
}
/** 数轴上的集合（区间）：实心 / 空心端点 + 区间 ✓ */
export function setNumberlineFigure(w: number, h: number, stroke: string, sw: number, params?: Record<string, number>): string {
  const p = withParams('setNumberline', params)
  const a = Number.isFinite(p.a) ? p.a : -1
  const b = Number.isFinite(p.b) ? p.b : 2
  const lo = Math.min(a, b) - 1.5, hi = Math.max(a, b) + 1.5
  const X = (v: number) => 34 + ((v - lo) / (hi - lo)) * (w - 60)
  const y = h * 0.55
  const ink = stroke || '#111'
  const fs = Math.max(11, Math.min(18, Math.round(w * 0.038)))
  const L: string[] = []
  L.push(axisArrow(24, y, w - 18, y, ink, sw))                       // 数轴（带箭头 ✓）
  L.push('<text x="' + n1(w - 14) + '" y="' + n1(y - fs * 0.5) + '" font-size="' + fs + '" fill="' + ink + '">x</text>')
  const openA = p.leftOpen > 0.5, openB = p.rightOpen > 0.5
  const dot = (v: number, open: boolean) => '<circle cx="' + n1(X(v)) + '" cy="' + n1(y) + '" r="' + n1(fs * 0.34) + '" fill="' + (open ? '#fff' : ink) + '" stroke="' + ink + '" stroke-width="' + n1(sw) + '"/>'
  if (p.shadeLine > 0.5) L.push('<line x1="' + n1(X(a)) + '" y1="' + n1(y) + '" x2="' + n1(X(b)) + '" y2="' + n1(y) + '" stroke="' + ink + '" stroke-width="' + n1(Math.max(3, sw * 2.2)) + '"/>')
  L.push(dot(a, openA), dot(b, openB))
  L.push('<text x="' + n1(X(a)) + '" y="' + n1(y + fs * 1.8) + '" font-size="' + fs + '" fill="' + ink + '" text-anchor="middle">' + numOf(a) + '</text>')
  L.push('<text x="' + n1(X(b)) + '" y="' + n1(y + fs * 1.8) + '" font-size="' + fs + '" fill="' + ink + '" text-anchor="middle">' + numOf(b) + '</text>')
  L.push('<text x="' + n1((X(a) + X(b)) / 2) + '" y="' + n1(y - fs * 1.1) + '" font-size="' + fs + '" fill="' + ink + '" text-anchor="middle">' + (openA ? '(' : '[') + numOf(a) + ', ' + numOf(b) + (openB ? ')' : ']') + '</text>')
  return L.join('')
}
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
/** ── 自定义分段函数 ──────────────────────────────────────────────
 *  与「自定义函数」同一套表达式解析（compileExpr），区别是**每段各自有区间与端点开闭**：
 *  取到的端点画**实心点**、取不到的画**空心点** —— 这正是分段函数图的标准画法。 */
export interface PiecewiseLine {
  expr: string
  /** 区间 [from, to] */
  from: number
  to: number
  /** 左 / 右端点是否**取到**（实心）；默认都取到 */
  lc?: boolean
  rc?: boolean
  /** 这一段的颜色 / 虚实 / 线宽（不填用元素自身的） */
  color?: string
  dash?: 'solid' | 'dash' | 'dot'
  width?: number
  visible?: boolean
}

export interface PiecewiseFn {
  lines: PiecewiseLine[]
  /** 取景框（x 就是显示的定义域，y 是显示的值域） */
  x0: number; x1: number; y0: number; y1: number
  grid?: boolean
  axes?: boolean
  /** 断点画实心 / 空心点（默认画） */
  dots?: boolean
  /** **区间端点**（整段函数的起、止）也画点。
   *  默认 false = **只在断点画**（教科书就这么画：人为给的区间端点不点圆点） */
  endDots?: boolean
}

/** 插入「自定义分段函数」时的默认内容：经典两段（x² 在 x<0，x+1 在 x≥0）。
 *  区间的端点写很大（如 ±50）就等于 ±∞ —— 贴边的端点不会画点。 */
export const DEFAULT_PIECEWISE: PiecewiseFn = {
  // 区间写 ±50 = ±∞：图形自然画到取景框边，**端点不画圆点**（只在断点画实心/空心）
  // —— 以前写的是 [-3,0] / [0,3.5]，右端会凭空多一个实心点，看着不像教科书
  lines: [
    { expr: 'x^2', from: -50, to: 0, lc: true, rc: false },
    { expr: 'x+1', from: 0, to: 50, lc: true, rc: true },
  ],
  // ⚠ 取景框的**宽高比要和插入时的元素框一致**（440×300 = 1.4667），否则图形会被水平压扁：
  //   8.8 宽 × 6 高 = 1.4667 ✓（元素 SVG 是 preserveAspectRatio="none"，比例不一致就变形）
  x0: -4.4, x1: 4.4, y0: -2, y1: 4,
  grid: false, axes: true, dots: true,
}

/** 分段函数图：网格 / 坐标轴 / 每段曲线 / 端点实心·空心点。
 *  全部表达式都解析不了 → 返回 null（调用方给红字提示），与 customFigure 一致。 */
export function piecewiseFigure(cfg: PiecewiseFn, w: number, h: number, stroke: string, sw: number): string | null {
  const lines = cfg.lines || []
  const view: View = { xmin: cfg.x0, xmax: cfg.x1, ymin: cfg.y0, ymax: cfg.y1 }
  const m = mapper(view, w, h)
  let s = cfg.grid ? gridSvg(view, w, h, m) : ''
  if (cfg.axes !== false) s += axesSvg(view, w, h, stroke, sw, true)
  const r = Math.max(3, Math.min(w, h) * 0.012)
  interface PwDot { x: number; y: number; closed: boolean; color: string }
  const dots: PwDot[] = []
  const addDot = (x: number, y: number, closed: boolean, color: string) => {
    // 只在**图形内部**的端点画点：贴住取景框边的（通常代表 ±∞）不画
    if (!(x > view.xmin + 1e-9 && x < view.xmax - 1e-9)) return
    if (!(y >= view.ymin - 1e-9 && y <= view.ymax + 1e-9)) return
    const hit = dots.find((d) => Math.abs(d.x - x) < 1e-9 && Math.abs(d.y - y) < 1e-9)
    if (hit) { if (closed) hit.closed = true; return }   // 同一点既空心又实心 → 以实心为准
    dots.push({ x, y, closed, color })
  }
  // **断点** = 两段共用的那个端点位（x 相同）。默认只在这些地方画实心/空心点，
  // 区间端点（整段函数的起、止，如 sin(x) 的 −3.14）不画 —— 那是我们人为给的边界，不是函数的断点。
  const ends: number[] = []
  for (const ln of lines) {
    if (ln.visible === false || !compileExpr(ln.expr || '')) continue
    ends.push(ln.from, ln.to)
  }
  const isJunction = (x: number) => ends.filter((e) => Math.abs(e - x) <= 1e-6 * (1 + Math.abs(x))).length >= 2
  let compiled = false
  let drawn = false
  for (const ln of lines) {
    if (ln.visible === false) continue
    const f = compileExpr(ln.expr || '')
    if (!f) continue
    compiled = true
    const col = ln.color || stroke
    const a = Math.max(ln.from, view.xmin)
    const b = Math.min(ln.to, view.xmax)
    if (b > a) {
      // 只采样**落在取景框内**的那截（各段端点各自取到，接缝处不断开）
      const d = plotFunction(f, view, w, h, 600, [a, b])
      if (d) {
        drawn = true
        s += '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' +
          n1(ln.width && ln.width > 0 ? ln.width : sw) + '"' + dashArrayOf(ln.dash) +
          ' stroke-linecap="round" stroke-linejoin="round"/>'
      }
    }
    if (cfg.dots !== false) {
      const yl = f(ln.from), yr = f(ln.to)
      if (Number.isFinite(yl) && (cfg.endDots === true || isJunction(ln.from))) addDot(ln.from, yl, ln.lc !== false, col)
      if (Number.isFinite(yr) && (cfg.endDots === true || isJunction(ln.to))) addDot(ln.to, yr, ln.rc !== false, col)
    }
  }
  if (!compiled && lines.length) return null
  for (const d of dots) {
    const px = m.X(d.x), py = m.Y(d.y)
    if (d.closed) s += dotSvg(px, py, r, d.color)
    else s += dotSvg(px, py, r, '#ffffff') +
      '<circle cx="' + n1(px) + '" cy="' + n1(py) + '" r="' + n1(r) + '" fill="none" stroke="' + d.color +
      '" stroke-width="' + n1(Math.max(1, sw * 0.8)) + '"/>'
  }
  void drawn
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
    // 分段：采样窗口给 [from,to]，像素映射仍是整幅 view（见 plotFunction 的 xRange 说明）
    for (const pc of def.pieces) s += curve(plotFunction((x) => pc.f(x, p), view, w, h, undefined, [pc.from, pc.to]))
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
      { key: 'a', label: 'a（半长轴）', short: 'a', def: 4, step: 0.5, min: 0.5, max: 20 },
      { key: 'b', label: 'b（半短轴）', short: 'b', def: 3, step: 0.5, min: 0.5, max: 20 },
      { key: 'ab', label: '显示 a、b 标注', short: '标注', def: 1, bool: true },
      // 【v1652】焦点标注可关：TikZ 译过来的图，原图没标焦点就不硬加 ✓（默认 1 → 老图元不变）
      { key: 'foci', label: '显示焦点 F₁、F₂', short: '焦点', def: 1, bool: true },
      // 准线默认**关**：自定义椭圆原来没有准线，默认开会让老图元突然多两条线
      { key: 'dline', label: '显示准线', short: '准线', def: 0, bool: true },
    ],
    viewOf: (p) => ellipseWindow(p.a || 1, p.b || 1),
  },
  conicCustomEllipseV: {
    label: '自定义椭圆（长轴在 y 轴）+ 直线/线段（可调 a、b 与多条线）',
    view: ellipseWindowV(4, 3),
    params: [
      { key: 'a', label: 'a（半长轴）', short: 'a', def: 4, step: 0.5, min: 0.5, max: 20 },
      { key: 'b', label: 'b（半短轴）', short: 'b', def: 3, step: 0.5, min: 0.5, max: 20 },
      { key: 'ab', label: '显示 a、b 标注', short: '标注', def: 1, bool: true },
      { key: 'foci', label: '显示焦点 F₁、F₂', short: '焦点', def: 1, bool: true },
      { key: 'dline', label: '显示准线', short: '准线', def: 0, bool: true },
    ],
    viewOf: (p) => ellipseWindowV(p.a || 1, p.b || 1),
  },
  conicCustomHyperbola: {
    label: '自定义双曲线 + 直线/线段（可调 a、b 与多条线）',
    view: { xmin: -6.5, xmax: 6.5, ymin: -4.9, ymax: 4.9 },
    params: [
      { key: 'a', label: 'a（实半轴）', short: 'a', def: 3, step: 0.5, min: 0.3, max: 20 },
      { key: 'b', label: 'b（虚半轴）', short: 'b', def: 2, step: 0.5, min: 0.3, max: 20 },
      // 【v1652】a= 标注可关（椭圆本来就有同名开关 ✓）—— 题图上一般不印参数值
      { key: 'ab', label: '显示 a、b 标注', short: '标注', def: 1, bool: true },
      { key: 'foci', label: '显示焦点 F₁、F₂', short: '焦点', def: 1, bool: true },
      { key: 'dline', label: '显示准线', short: '准线', def: 0, bool: true },
      { key: 'aline', label: '显示渐近线', short: '渐近线', def: 0, bool: true },
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
      { key: 'cx', label: '圆心 x', short: '圆心x', def: 0, step: 0.5, min: -20, max: 20 },
      { key: 'cy', label: '圆心 y', short: '圆心y', def: 0, step: 0.5, min: -20, max: 20 },
      { key: 'cr', label: '半径 r', short: 'r', def: 3, step: 0.5, min: 0.2, max: 20 },
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
      { key: 'p', label: 'p（焦准距）', short: 'p', def: 4, step: 0.5, min: 0.2, max: 20 },
      { key: 'dir', label: '开口：1右 2上 3左 4下', short: '开口', def: 1, step: 1, min: 1, max: 4 },
      { key: 'dline', label: '显示准线', short: '准线', def: 1, bool: true },
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
  // 「直线」这一组（条数 + 两个开关）也装进一个矩形框
  { key: 'n', label: '直线 / 线段条数', short: '条数', group: 'lset', groupTitle: '直线', def: 0, step: 1, min: 0, max: 4 },
  // 线段两端的圆点本来是"一眼区分线段 / 整条直线"用的；但教材图里常常不要，所以做成可选项。
  // 默认 1（显示）→ **老图元外观完全不变**。
  { key: 'ldot', label: '线段端点圆点', short: '端点', group: 'lset', def: 1, bool: true, showIf: (p) => (p.n || 0) >= 1 },
  { key: 'chord', label: '显示弦长', short: '弦长', group: 'lset', def: 0, bool: true, showIf: (p) => (p.n || 0) >= 1 },
  // 【极线 / 切点弦】定点关于曲线的极线 + 两个切点。用"第 1 条『过定点作切线』的定点"；
  // 没有那种线就用第 1 个标注点 ✓（少一个参数、少一次选点，行为也符合直觉）
  { key: 'polar', label: '画极线（切点弦）：定点的那条 + 两个切点', short: '极线', group: 'lset', def: 0, bool: true },
]
for (let i = 1; i <= 4; i++) {
  const on = (p: Record<string, number>) => (p.n || 0) >= i
  LINE_PARAMS.push(
    // k / m 一行、起 / 终 一行（用户要求：别一个参数占一整屏）
    // 一条线的**所有属性同一个 group** → 面板把它们装进**一个矩形框**、排成**一整行**
    // 起终点放到 ±50：线段要能伸出取景框，"整条直线"才不会显得被一个矩形框住
    { key: 'k' + i, label: '线' + i + ' 斜率 k（直线 y = kx + m）', short: 'k', group: 'ln' + i, def: i === 1 ? 0.6 : 0, step: 0.1, min: -10, max: 10, showIf: on },
    { key: 'm' + i, label: '线' + i + ' 截距 m', short: 'm', group: 'ln' + i, def: i === 1 ? -1 : 0, step: 0.5, min: -20, max: 20, showIf: on },
    { key: 's' + i, label: '线' + i + ' 起点 x（与终点相同 = 整条直线）', short: '起x', group: 'ln' + i, def: 0, step: 0.5, min: -50, max: 50, showIf: on },
    { key: 'e' + i, label: '线' + i + ' 终点 x（与起点相同 = 整条直线）', short: '终x', group: 'ln' + i, def: 0, step: 0.5, min: -50, max: 50, showIf: on },
    { key: 'd' + i, label: '线' + i + ' 用虚线', short: '虚线', group: 'ln' + i, def: 0, bool: true, showIf: on },
    // 【v1652】竖直直线 / 竖直弦：k 是无穷，斜率式存不下 —— 打开后 **m 就是 x**，起终点 s/e 解释成 **y** ✓
    { key: 'v' + i, label: '线' + i + ' 竖直（x = m，起终点填 y）', short: '竖直', group: 'ln' + i, def: 0, bool: true, showIf: on },
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
    // x / y / 大小 并成一行（用户要求）
    { key: 'px' + i, label: '点' + i + ' 横坐标 x', short: 'x', group: 'pt' + i, def: 0, step: 0.5, min: -50, max: 50, showIf: on },
    { key: 'py' + i, label: '点' + i + ' 纵坐标 y', short: 'y', group: 'pt' + i, def: 0, step: 0.5, min: -50, max: 50, showIf: on },
    { key: 'ps' + i, label: '点' + i + ' 圆点大小', short: '大小', group: 'pt' + i, def: 1, step: 0.1, min: 0.3, max: 3, showIf: on },
  )
}

/** 圆锥曲线自己的"外观"参数：曲线要不要虚线、坐标轴要不要虚线（颜色是字符串 → 存在元素的 axisColor 上） */
export const CONIC_LOOK_PARAMS: ParamSpec[] = [
  // 「曲线」框里的那个开关：本框标题就叫"曲线"，所以小标题只写"虚线"
  { key: 'cdash', label: '曲线用虚线', short: '虚线', group: 'cv', groupTitle: '曲线', def: 0, bool: true },
  // 坐标轴是**另一个东西** → 单独一个「坐标轴」框（一行：虚线 + 颜色）
  { key: 'axisd', label: '坐标轴用虚线', short: '虚线', group: 'ax', groupTitle: '坐标轴', def: 0, bool: true },
]

// 挂到所有自定义圆锥曲线上（挂在 conicFigure 之前，此时 CONICS 已完整定义）
for (const kk of ['conicCustomCircle', 'conicCustomEllipse', 'conicCustomEllipseV', 'conicCustomHyperbola', 'conicCustomParabola']) {
  const dd = CONICS[kk]
  if (!dd) continue
  // **曲线自己的参数**（形状 + 显示开关）同组 → 面板里装进一个「曲线」矩形框、一行放完
  // （用户要求：同一元素的所有属性放在一个矩形框内）
  for (const pr of dd.params || []) { pr.group = 'cv'; pr.groupTitle = '曲线' }
  dd.params = [...(dd.params || []), ...CONIC_LOOK_PARAMS, ...LINE_PARAMS, ...POINT_PARAMS]
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
function drawExtraLines(
  kind: string, pv: Record<string, number>, view: View, w: number, h: number, stroke: string, sw: number,
  colors?: (string | null)[], labels?: (string | null)[], links?: (PointLink | null)[],
): string {
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
    if (Math.round(pv['hide' + i] ?? 0)) continue                     // 绑定的切线解不出来（定点在曲线内）→ 这条线不画
    const col = colors && colors[i - 1] ? colors[i - 1]! : stroke     // 每条线可以有自己的颜色
    const lDash = Math.round(pv['d' + i] ?? 0) ? '7 5' : ''             // 每条线可以自己选虚实 → 虚线标交点、实线画图形都行
    // 【v1652】竖直直线：斜率式画不出 x = m（clipLine 对竖直只给得出一个点 ✗）→ 单开一条路，
    //   取景裁剪与线段截断都换成 **y** 方向 ✓
    const vert = Math.round(pv['v' + i] ?? 0) !== 0
    let lo = 0, hi = 0
    if (vert) {
      if (b2 < view.xmin - 1e-9 || b2 > view.xmax + 1e-9) continue      // 整条竖线在取景外
      lo = view.ymin; hi = view.ymax
    } else {
      const span = clipLine(k, b2, view)
      if (!span) continue
      lo = Math.min(span[0][0], span[1][0]); hi = Math.max(span[0][0], span[1][0])
    }
    if (seg) {
      lo = Math.max(lo, Math.min(sN, eN))
      hi = Math.min(hi, Math.max(sN, eN))
      if (hi - lo < 1e-9) continue
    }
    if (vert) {
      out += lineSvg(mm.X(b2), mm.Y(lo), mm.X(b2), mm.Y(hi), col, sw, lDash)
      if (seg && dots) out += dotSvg(mm.X(b2), mm.Y(lo), r, col) + dotSvg(mm.X(b2), mm.Y(hi), r, col)
    } else {
      out += lineSvg(mm.X(lo), mm.Y(k * lo + b2), mm.X(hi), mm.Y(k * hi + b2), col, sw, lDash)
      if (seg && dots) out += dotSvg(mm.X(lo), mm.Y(k * lo + b2), r, col) + dotSvg(mm.X(hi), mm.Y(k * hi + b2), r, col)
    }
    // 弦长：这条线与曲线的两个交点之间的距离，标在弦中点（默认关）
    if (Math.round(pv.chord ?? 0)) {
      const rs = conicLineRoots(kind, pv, i)
      if (rs.length >= 2) {
        const dd = Math.hypot(rs[0].x - rs[1].x, rs[0].y - rs[1].y)
        const fs2 = Math.max(11, Math.min(w, h) * 0.05)
        const mx = (rs[0].x + rs[1].x) / 2, my = (rs[0].y + rs[1].y) / 2
        // 弦的名字：两个端点各自是哪个**标注点**就叫什么 → |P₁P₂| = 8.00（认不出就退回"弦长"）
        out += textSvg(mm.X(mx) + fs2 * 0.35, mm.Y(my) - fs2 * 0.45,
          chordLabel(kind, pv, rs, { pointLabels: labels, pointLinks: links }) + ' = ' + dd.toFixed(2), fs2, stroke)
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
    // 【v1652】竖直直线 / 竖直弦：手柄落在 (m, y) 上（与 drawExtraLines 同一套裁剪）✓
    const vert = Math.round(pv['v' + i] ?? 0) !== 0
    let lo = 0, hi = 0
    if (vert) {
      if (b2 < view.xmin - 1e-9 || b2 > view.xmax + 1e-9) continue
      lo = view.ymin; hi = view.ymax
    } else {
      const span = clipLine(k, b2, view)
      if (!span) continue
      lo = Math.min(span[0][0], span[1][0]); hi = Math.max(span[0][0], span[1][0])
    }
    if (seg) {
      lo = Math.max(lo, Math.min(sN, eN))
      hi = Math.min(hi, Math.max(sN, eN))
      if (hi - lo < 1e-9) continue
    }
    if (vert) {
      out.push({ i, which: 0, x: mm.X(b2), y: mm.Y(lo) })
      out.push({ i, which: 1, x: mm.X(b2), y: mm.Y(hi) })
    } else {
      out.push({ i, which: 0, x: mm.X(lo), y: mm.Y(k * lo + b2) })
      out.push({ i, which: 1, x: mm.X(hi), y: mm.Y(k * hi + b2) })
    }
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
  // 【v1652】竖直直线 / 竖直弦：拖动改的是 **x**（存在 m{i} 里），线段的起终点改的是 **y** ✓
  if (Math.round(pv['v' + i] ?? 0)) {
    const patchV: Record<string, number> = {}
    patchV['m' + i] = +fx(px).toFixed(4)
    const sV = pv['s' + i] ?? 0, eV = pv['e' + i] ?? 0
    if (Math.abs(eV - sV) > 1e-6) {
      patchV['s' + i] = +Math.min(ay, by).toFixed(3)
      patchV['e' + i] = +Math.max(ay, by).toFixed(3)
    }
    return patchV
  }
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
function drawExtraPoints(kind: string, pv: Record<string, number>, view: View, w: number, h: number, stroke: string, labels?: (string | null)[], links?: (PointLink | null)[], colors?: (string | null)[]): string {
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
    const col = (colors && colors[i - 1]) || stroke                 // 每个点可以有自己的颜色
    const kk = Math.max(0.3, Math.min(3, pv['ps' + i] ?? 1))        // 每个点可以有自己的大小
    out += dotSvg(px, py, rr * 1.75 * kk, '#ffffff')
    out += dotSvg(px, py, rr * kk, col)
    const t = String((labels && labels[i - 1]) || ('P_' + i)).trim()
    if (t) out += textSvg(px + fs * 0.8, py - fs * 0.75, t, fs, col)
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
  // 【v1652】竖直直线 / 竖直弦：把 x = m 代进二次型 → B·y² + D·y + (A·m² + C·m + E) = 0
  //   （有了它，"弦与曲线的交点"这类绑定在竖直弦上也成立 ✓）
  if (Math.round(pv['v' + line] ?? 0)) {
    const A3 = q.B, B3 = q.D, C3 = q.A * m2 * m2 + q.C * m2 + q.E
    const ys: number[] = []
    if (Math.abs(A3) < 1e-12) {
      if (Math.abs(B3) > 1e-12) ys.push(-C3 / B3)
    } else {
      const disc3 = B3 * B3 - 4 * A3 * C3
      const tol3 = 1e-9 * (B3 * B3 + Math.abs(4 * A3 * C3) + 1e-12)
      if (disc3 >= -tol3) {
        const sq3 = Math.sqrt(Math.max(0, disc3))
        ys.push((-B3 + sq3) / (2 * A3), (-B3 - sq3) / (2 * A3))
      }
    }
    const ptsV = ys
      .filter((y) => isFinite(y) && !(seg && (y < lo - 1e-9 || y > hi + 1e-9)))
      .sort((a, b) => a - b)                        // 按 y 升序：which=0/1 才有稳定含义 ✓
      .map((y) => ({ x: m2, y }))
    if (ptsV.length === 2) {
      const epsV = 1e-3 * (1 + Math.abs(ptsV[0].x) + Math.abs(ptsV[0].y))
      if (Math.hypot(ptsV[0].x - ptsV[1].x, ptsV[0].y - ptsV[1].y) < epsV) return [ptsV[0]]
    }
    return ptsV
  }
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
export interface LineLink {
  /** 这条线是**某个标注点处的切线**（点序号）—— 动点一滑切线就跟着转 */
  tangentAt?: number
  /** 这条线是**过某个定点作的切线**（点序号）+ 取第几支（0/1）：定点在曲线外时有两条 */
  tangentFrom?: number
  which?: number
}

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

/** 【过定点作切线】从点 P(px,py) 向圆锥曲线作切线（最多两条）。
 *  做法：先求 **P 的极线**（就是两个切点的连线）—— 对二次型 F = Ax²+By²+Cx+Dy+E，
 *  极线为 A·px·x + B·py·y + C(x+px)/2 + D(y+py)/2 + E = 0；
 *  再把极线与曲线求交 → 两个**切点** T₁T₂；切线就是 P 与切点的连线（切点是切线的极限位置）✓。
 *  P 在曲线上 → 两条切线重合（返回 1 条）；P 在曲线内部 → 返回 []（作不出切线）。
 *  ⚠ 竖直切线沿用本项目约定：用很大的斜率近似（y = kx + m 表示不了竖直）。 */
/** 定点 P(px,py) 关于圆锥曲线的**极线**（= 两切点连线 = 切点弦）+ **两个切点**。
 *  极线：A·px·x + B·py·y + C(x+px)/2 + D(y+py)/2 + E = 0，整理成 y = kx + m。
 *  ⚠ 三种情形：① P 在曲线外 → 极线是实数线、切点是两个实数（就是切点）；
 *   ② P 在曲线**内部** → 极线仍是实数线，但**切点无实交点**（touches 为空）；
 *   ③ P 在曲线**中心** → 极线是**无穷远直线**（polar = null，画不出来）✓ */
export function conicPolar(
  kind: string, params: Record<string, number> | undefined, px: number, py: number,
): { polar: { k: number; m: number } | null; touches: { x: number; y: number }[] } {
  const q = conicQuadratic(kind, params)
  if (!q) return { polar: null, touches: [] }
  const A = q.A * px + q.C / 2
  const B = q.B * py + q.D / 2
  const K = (q.C * px) / 2 + (q.D * py) / 2 + q.E
  let kp = 0, mp = 0
  if (Math.abs(B) > 1e-12) { kp = -A / B; mp = -K / B }
  else if (Math.abs(A) > 1e-12) { kp = 1e4; mp = -1e4 * (-K / A) }   // 极线竖直（x = −K/A）
  else return { polar: null, touches: [] }                            // 无穷远（曲线中心）
  const A2 = q.A + q.B * kp * kp
  const B2 = 2 * q.B * kp * mp + q.C + q.D * kp
  const C2 = q.B * mp * mp + q.D * mp + q.E
  const xs: number[] = []
  if (Math.abs(A2) < 1e-12) {
    if (Math.abs(B2) > 1e-12) xs.push(-C2 / B2)
  } else {
    const disc = B2 * B2 - 4 * A2 * C2
    const tol = 1e-9 * (B2 * B2 + Math.abs(4 * A2 * C2) + 1e-12)
    if (disc >= -tol) {
      const sq = Math.sqrt(Math.max(0, disc))
      xs.push((-B2 + sq) / (2 * A2), (-B2 - sq) / (2 * A2))
    }
  }
  const touches: { x: number; y: number }[] = []
  for (const x of xs) if (isFinite(x)) { const y = kp * x + mp; if (!touches.some((t) => Math.abs(t.x - x) < 1e-9 && Math.abs(t.y - y) < 1e-9)) touches.push({ x, y }) }
  return { polar: { k: kp, m: mp }, touches }
}

export function conicTangentsFrom(
  kind: string, params: Record<string, number> | undefined, px: number, py: number,
): { k: number; m: number }[] {
  const q = conicQuadratic(kind, params)
  if (!q) return []
  // 极线 + 切点（= 切点弦的两端），切线就是"定点 ↔ 切点"的连线
  const { polar, touches } = conicPolar(kind, params, px, py)
  if (!polar) return []
  const out: { k: number; m: number }[] = []
  for (const t of touches) {
    const x = t.x, y = t.y
    // ⚠ P 自己在曲线上时，切点 T 与 P 重合 → "P 与 T 的连线"退化（dx=0 会被误判成竖直切线，
    //   椭圆的上下顶点就是这样：真正的切线是**水平的** y=b ✗）。这种情况直接用 P 处的切线 ✓
    if (Math.hypot(x - px, y - py) < 1e-7) {
      const t0 = conicTangentAt(kind, params, px, py)
      if (t0) out.push(t0)
      continue
    }
    const dx = x - px
    if (Math.abs(dx) < 1e-9) out.push({ k: 1e4, m: py - 1e4 * px })   // 竖直切线（过 P）
    else { const k = (y - py) / dx; out.push({ k, m: py - k * px }) }
  }
  if (out.length === 2) {
    // 两条几乎重合 = P 在曲线上 → 只留一条
    if (Math.abs(out[0].k - out[1].k) < 1e-6 && Math.abs(out[0].m - out[1].m) < 1e-6) return [out[0]]
  }
  return out
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
    // ① 过定点作切线（定点通常是个"自由点"）：现算两支切线，取 which 指定的一支
    if (lk.tangentFrom != null) {
      const P = conicPointPos(kind, pv, lk.tangentFrom, pointLinks)
      // ⚠ 解不出切线时（定点在曲线内 / 该点此刻不画）必须**标记隐藏**：
      //   否则会退回默认的 k=0、m=0，凭空画出一条过原点的假线 ✗（实测就这么冒出来过）
      if (!P) { pv['hide' + (i + 1)] = 1; continue }
      const ts = conicTangentsFrom(kind, pv, P.x, P.y)
      const t = ts[Math.max(0, Math.min(ts.length - 1, Math.round(lk.which ?? 0)))]
      if (t) { pv['k' + (i + 1)] = t.k; pv['m' + (i + 1)] = t.m }
      else pv['hide' + (i + 1)] = 1
      continue
    }
    // ② 某标注点处的切线
    if (lk.tangentAt == null) continue
    const pt = conicPointPos(kind, pv, lk.tangentAt, pointLinks)
    if (!pt) { pv['hide' + (i + 1)] = 1; continue }
    const km = conicTangentAt(kind, pv, pt.x, pt.y)
    // ⚠ **不要四舍五入** ✗ —— 舍入会让"严格相切"变成"差一点点"，判别式掉到负数，
    //   于是切线算出**0 个交点**（实测 t=0.8 的切线就是这样消失的）。全精度留着 ✓
    if (km) { pv['k' + (i + 1)] = km.k; pv['m' + (i + 1)] = km.m }
  }
  return pv
}

/** 弦的名字：这条线与曲线的两个交点分别落在哪个**标注点**上，就用那两个名字拼 `|P_1P_2|`
 *  （名字里的 `_1` 会渲染成下标 → 显示成 |P₁P₂|）。认不出（没标注点/名字空）就退回"弦长"。 */
function chordLabel(
  kind: string, pv: Record<string, number>,
  rs: { x: number; y: number }[],
  opt?: { pointLabels?: (string | null)[]; pointLinks?: (PointLink | null)[] },
): string {
  const labs = opt?.pointLabels || []
  const links = opt?.pointLinks || []
  const names: string[] = []
  for (const r of rs.slice(0, 2)) {
    let nm = ''
    // ⚠ 标注点是 **1 起**的（conicPointPos 内部取 links[i-1]）—— 这里 j 是数组下标，传 j+1 ✓
    for (let j = 0; j < labs.length; j++) {
      const p = conicPointPos(kind, pv, j + 1, links)
      if (p && Math.hypot(p.x - r.x, p.y - r.y) < 1e-6) { nm = String(labs[j] || '').trim(); break }
    }
    names.push(nm)
  }
  return names[0] && names[1] ? '|' + names[0] + names[1] + '|' : '弦长'
}

export function conicFigure(kind: string, w: number, h: number, baseStroke: string, sw: number, fill = 'none', params?: Record<string, number>, opt?: { conicStroke?: string; axisColor?: string; lineColors?: (string | null)[]; pointColors?: (string | null)[]; pointLabels?: (string | null)[]; pointLinks?: (PointLink | null)[]; lineLinks?: (LineLink | null)[] }): string {
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
      '" stroke-linecap="round" stroke-linejoin="round"' +
      (Math.round(pv.cdash ?? 0) ? ' stroke-dasharray="' + dash + '"' : '') + '/>'
    : ''
  let s = axesSvg(view, w, h, opt?.axisColor || baseStroke, sw, false, { dash: Math.round(pv.axisd ?? 0) ? dash : '' })
  // 「圆锥曲线 + 直线 / 线段」：在 s 的**最前面**加一次就够 —— 后面各分支只管往 s 上追加再 return s，
  // 所以不需要改动任何一个分支（改四个分支结尾容易漏、也容易错）。
  // 画在圆锥曲线**下面**，交点处线条不会互相压住。
  s += drawExtraLines(kind, pv, view, w, h, baseStroke, sw, opt?.lineColors, opt?.pointLabels, opt?.pointLinks)
  s += drawExtraPoints(kind, pv, view, w, h, baseStroke, opt?.pointLabels, opt?.pointLinks, opt?.pointColors)
  // 【极线 / 切点弦】定点关于曲线的极线（虚线）+ 两个切点（圆点）。
  // 定点取"第 1 条『过定点作切线』的定点"，没有那种线就用第 1 个标注点 ✓
  if (Math.round(pv.polar ?? 0)) {
    let pi2 = 1
    for (const lk of opt?.lineLinks || []) if (lk && lk.tangentFrom != null) { pi2 = lk.tangentFrom; break }
    const P = conicPointPos(kind, pv, Math.max(1, Math.round(pi2)), opt?.pointLinks)
    if (P) {
      const pr = conicPolar(kind, pv, P.x, P.y)
      if (pr.polar) {
        const span = clipLine(pr.polar.k, pr.polar.m, view)
        if (span) s += '<line x1="' + n1(X(span[0][0])) + '" y1="' + n1(Y(span[0][1])) +
          '" x2="' + n1(X(span[1][0])) + '" y2="' + n1(Y(span[1][1])) + '" stroke="' + stroke +
          '" stroke-width="' + n1(Math.max(1, sw * 0.8)) + '" stroke-dasharray="' + dash + '" stroke-linecap="round"/>'
      }
      for (const t of pr.touches) s += dotSvg(X(t.x), Y(t.y), r, stroke)
    }
  }
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
    if (Math.round(pv.foci ?? 1)) {                 // 【v1652】焦点可关（默认显示 → 老图元不变 ✓）
      s += dot(-c, 0) + dot(c, 0)
      s += label(-c, 0, 'F₁', 0, fs * 1.15) + label(c, 0, 'F₂', 0, fs * 1.15)
    }
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
    if (Math.round(pv.foci ?? 1)) {                 // 【v1652】焦点可关（默认显示 → 老图元不变 ✓）
      s += dot(0, -c) + dot(0, c)
      s += label(0, -c, 'F₁', fs * 1.25, 0) + label(0, c, 'F₂', fs * 1.25, 0)
    }
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
    if (Math.round(pv.foci ?? 1)) {                 // 【v1652】焦点可关（默认显示 → 老图元不变 ✓）
      s += dot(-c, 0) + dot(c, 0)
      s += label(-c, 0, 'F₁', 0, fs * 1.15) + label(c, 0, 'F₂', 0, fs * 1.15)
    }
    if (Math.round(pv.ab ?? 1)) s += label(a, 0, 'a=' + a, fs * 0.5, -fs * 0.6)   // 【v1652】可关；默认仍显示 → 老图元外观不变 ✓
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
  if (v) return (v.xmax - v.xmin) / (v.ymax - v.ymin)
  // 带控制点的平面图形（圆弧 / 指定半径圆）：给 6:5 的框 —— 圆与圆弧才不会被压成椭圆
  if (kind === 'histogram' || kind === 'freqLine') return 1.45 // 【M2.11/M2.12】统计图：略扁一点像书上 ✓
  if (kind === 'scatter') return 1.15
  if (kind === 'freqTable') return 1.5                         // 【M2.13】频率分布表：按行数定高更合适，这里先用表宽 ✓
  if (kind === 'vennFigure') return 1.5                        // 【M2.14】集合 ✓
  if (kind === 'setNumberline') return 2.4
  if (kind === 'arcAngle' || kind === 'arc3pt' || kind === 'circleR' || kind === 'ellipseArc' || kind === 'ellipseAB') return 1.2
  return null
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
