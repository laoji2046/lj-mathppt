/**
 * 场景图（Scene Graph）—— 整个应用的核心数据模型。
 *
 * 与原版的关键区别：幻灯片内容不再是 HTML 字符串，而是结构化对象。
 * 同一份场景图可渲染为三种形态：
 *   1. 编辑器画布（Vue 组件）
 *   2. 演示模式（Reveal.js）
 *   3. 导出 HTML
 */

export type ElementType = 'text' | 'shape' | 'image' | 'math' | 'geogebra' | 'desmos' | 'line' | 'arrow' | 'pen' | 'mathfig' | 'chart' | 'table' | 'icon' | 'embed' | 'richtex'

/** GeoGebra 套件类型 */
export type GgbApp = 'classic' | 'graphing' | 'geometry' | '3d' | 'cas'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface ElementBase extends Rect {
  id: string
  type: ElementType
  /** 旋转角度（度） */
  rot: number
  /**
   * 所属组合。同一 groupId 的元素视为一个整体：
   * 点选任一成员会选中整组，拖拽/对齐/图层操作也以整组为单位。
   */
  groupId?: string
  /** 演示模式下的渐显（fragment）：点击逐条出现；编辑器始终显示全部 */
  fragment?: boolean
  /** 渐显出现顺序/分组编号（越小越先；相同编号一起出现）。可控 data-fragment-index */
  fragmentIndex?: number
  /** 元素阴影（box-shadow）：开启后按 shadowColor 渲染色投影（颜色可选） */
  shadowOn?: boolean
  shadowColor?: string
  /** 阴影 X 偏移（px，决定水平方向） */
  shadowX?: number
  /** 阴影 Y 偏移（px，决定垂直方向） */
  shadowY?: number
  /** 阴影模糊（px） */
  shadowBlur?: number
  /** 描边线型（见 LINE_STYLES）：solid/dashed/dotted/长虚线/点划线 */
  strokeDash?: string
  /**
   * 公式 / 混排元素的缩放方式：
   * - 'fill'（默认）：等比缩放填满元素框 —— 拖动外框放大，内容跟着无级放大；
   * - 'shrink'：只缩小不放大（模板里版式经过校准，避免被撑大）。
   */
  fitMode?: 'fill' | 'shrink'
  /** 新建元素：渲染出自然尺寸后，把外框调整成刚好包住内容（随后自动清除此标记） */
  autoBox?: boolean
}

/** 对齐方式：相对选区（或单个元素时相对页面）的外接框 */
export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

/** 分布方向 */
export type DistributeAxis = 'h' | 'v'

/** 图层顺序操作 */
export type ZOrderAction = 'front' | 'back' | 'forward' | 'backward'

export interface TextElement extends ElementBase {
  type: 'text'
  text: string
  fontSize: number
  color: string
  fontWeight: number
  align: 'left' | 'center' | 'right'
  /** 字体族预设的 key（见 FONT_OPTIONS） */
  fontFamily: string
  /** 文字背景色，'transparent' 表示无背景 */
  bgColor: string
  /** 文字阴影预设的 key（见 SHADOW_OPTIONS） */
  shadow: string
  /** 渐变文字（Bento 风格）：角度 + 若干停靠点 */
  colorGradient?: { angle: number; stops: { at: number; color: string }[] }
  /** 文字描边（Bento Outline）：width+color；fill='none' 为空心字 */
  textStroke?: { width: number; color: string; fill?: 'none' }
  /** 字距（px） */
  letterSpacing?: number
  /** 行高（倍数） */
  lineHeight?: number
  /** 垂直对齐：top/middle/bottom */
  valign?: 'top' | 'middle' | 'bottom'
  /** 文字发光（PowerPoint 艺术字）：颜色 + 模糊半径 */
  glowColor?: string
  glowBlur?: number
}

/** 生成文本特效 CSS（渐变 / 描边 / 字距 / 行高；编辑器与 Reveal 共用） */
export function textEffectCss(
  el: Pick<TextElement, 'color' | 'colorGradient' | 'textStroke' | 'letterSpacing' | 'lineHeight'>,
): string {
  const css: string[] = []
  const g = el.colorGradient
  if (g && g.stops && g.stops.length) {
    const stops = g.stops.map((s) => s.color + ' ' + Math.round(s.at * 100) + '%').join(', ')
    css.push('background-image: linear-gradient(' + g.angle + 'deg, ' + stops + ')')
    css.push('-webkit-background-clip: text; background-clip: text; color: transparent')
  } else {
    css.push('color: ' + el.color)
  }
  const ts = el.textStroke
  if (ts && ts.width) {
    css.push('-webkit-text-stroke: ' + ts.width + 'px ' + ts.color)
    if (ts.fill === 'none') css.push('color: transparent')
  }
  if (el.letterSpacing) css.push('letter-spacing: ' + el.letterSpacing + 'px')
  if (el.lineHeight) css.push('line-height: ' + el.lineHeight)
  return css.join('; ')
}

/** 合并文字阴影预设 + 发光，生成 text-shadow（无效果返回 'none'） */
export function textShadowCss(el: Pick<TextElement, 'shadow' | 'glowColor' | 'glowBlur'>): string {
  const parts: string[] = []
  const s = shadowCss(el.shadow)
  if (s && s !== 'none') parts.push(s)
  if (el.glowBlur && el.glowColor) parts.push('0 0 ' + el.glowBlur + 'px ' + el.glowColor)
  return parts.length ? parts.join(', ') : 'none'
}

/** PowerPoint 艺术字 · 一键预设样式（渐变 / 描边 / 发光 / 阴影 组合） */
export interface WordArtPreset {
  label: string
  color?: string
  colorGradient?: { angle: number; stops: { at: number; color: string }[] }
  stroke?: { width: number; color: string; fill?: 'none' }
  glow?: { color: string; blur: number }
  shadow?: string
}
export const WORDART_PRESETS: WordArtPreset[] = [
  { label: '渐变金', colorGradient: { angle: 90, stops: [{ at: 0, color: '#FFD66B' }, { at: 1, color: '#F9A825' }] }, stroke: { width: 0.5, color: '#B8860B' }, glow: { color: 'rgba(255,200,80,0.5)', blur: 14 }, shadow: 'md' },
  { label: '蓝紫', colorGradient: { angle: 90, stops: [{ at: 0, color: '#54C7FF' }, { at: 1, color: '#7B5CFF' }] }, stroke: { width: 0.5, color: '#2846C4' }, glow: { color: 'rgba(84,199,255,0.5)', blur: 14 }, shadow: 'md' },
  { label: '日落', colorGradient: { angle: 90, stops: [{ at: 0, color: '#FF9D6B' }, { at: 1, color: '#FF5F7E' }] }, stroke: { width: 0.5, color: '#C43A5C' }, glow: { color: 'rgba(255,120,90,0.5)', blur: 16 }, shadow: 'md' },
  { label: '翠绿', colorGradient: { angle: 90, stops: [{ at: 0, color: '#7CE495' }, { at: 1, color: '#17A06B' }] }, stroke: { width: 0.5, color: '#0B7A4E' }, glow: { color: 'rgba(100,220,140,0.5)', blur: 14 }, shadow: 'md' },
  { label: '金属银', colorGradient: { angle: 90, stops: [{ at: 0, color: '#FBFCFF' }, { at: 1, color: '#9AA6B8' }] }, stroke: { width: 0.8, color: '#5A6B82' }, glow: { color: 'rgba(255,255,255,0.55)', blur: 12 }, shadow: 'md' },
  { label: '彩虹', colorGradient: { angle: 90, stops: [{ at: 0, color: '#FF5A5F' }, { at: 0.25, color: '#FFB35A' }, { at: 0.5, color: '#3ED66B' }, { at: 0.75, color: '#3FA9F5' }, { at: 1, color: '#8B5CF6' }] }, stroke: { width: 0.5, color: '#3b3b3b' }, glow: { color: 'rgba(180,180,255,0.45)', blur: 16 }, shadow: 'md' },
  { label: '霓虹', color: '#67E8F9', stroke: { width: 1.2, color: '#22D3EE' }, glow: { color: 'rgba(103,232,249,0.85)', blur: 18 }, shadow: 'none' },
  { label: '空心', color: '#FFFFFF', stroke: { width: 2, color: '#FF5F7E', fill: 'none' }, glow: { color: 'rgba(255,95,126,0.5)', blur: 12 }, shadow: 'none' },
  { label: '黑金', colorGradient: { angle: 120, stops: [{ at: 0, color: '#F8E9A1' }, { at: 0.5, color: '#C8A24B' }, { at: 1, color: '#F8E9A1' }] }, stroke: { width: 0.6, color: '#A07B2A' }, glow: { color: 'rgba(232,196,109,0.5)', blur: 12 }, shadow: 'none' },
]

/** 字体族预设：value 为 CSS font-stack（编辑器与导出共用，保证两端一致） */
export const FONT_OPTIONS: { v: string; label: string; stack: string }[] = [
  { v: 'default', label: '系统默认', stack: 'inherit' },
  { v: 'sans', label: '无衬线（黑体/雅黑）', stack: '"PingFang SC","Microsoft YaHei","Hiragino Sans GB","Source Han Sans SC","Noto Sans CJK SC",sans-serif' },
  { v: 'serif', label: '衬线（宋体/思源宋体）', stack: '"Songti SC","SimSun","Source Han Serif SC","Noto Serif CJK SC",serif' },
  { v: 'kai', label: '楷体', stack: '"Kaiti SC","KaiTi","STKaiti",serif' },
  { v: 'hei-bold', label: '粗黑（标题用）', stack: '"Source Han Sans SC","Microsoft YaHei","PingFang SC",sans-serif' },
  { v: 'rounded', label: '圆体', stack: '"Yuanti SC","YouYuan","Hiragino Maru Gothic ProN",sans-serif' },
  { v: 'mono', label: '等宽（代码/公式）', stack: 'ui-monospace,Consolas,"Courier New",monospace' },
  { v: 'latin-serif', label: '英文衬线', stack: 'Georgia,"Times New Roman",serif' },
  { v: 'latin-sans', label: '英文无衬线', stack: 'Helvetica,Arial,sans-serif' },
]

/** 文字阴影预设：value 为 CSS text-shadow */
export const SHADOW_OPTIONS: { v: string; label: string; css: string }[] = [
  { v: 'none', label: '无', css: 'none' },
  { v: 'sm', label: '轻微', css: '0 1px 2px rgba(0,0,0,0.30)' },
  { v: 'md', label: '中等', css: '0 2px 5px rgba(0,0,0,0.40)' },
  { v: 'lg', label: '强烈', css: '0 4px 10px rgba(0,0,0,0.50)' },
]

/** 按 key 取 CSS font-stack（未匹配时回退系统默认） */
export function fontStack(key: string | undefined): string {
  return FONT_OPTIONS.find((f) => f.v === key)?.stack ?? FONT_OPTIONS[0].stack
}

/** 箭头端样式 */
export const ARROW_HEADS: { v: string; label: string }[] = [
  { v: 'triangle', label: '实心三角' },
  { v: 'open', label: '开口 V' },
  { v: 'stealth', label: '燕尾' },
  { v: 'double', label: '双向' },
  { v: 'none', label: '无箭头' },
]

/** 描边线型：value 为 stroke-dasharray（'' = 实线） */
export const LINE_STYLES: { v: string; label: string; dash: string }[] = [
  { v: 'solid', label: '实线', dash: '' },
  { v: 'dashed', label: '虚线', dash: '6 4' },
  { v: 'dotted', label: '点线', dash: '2 3' },
  { v: 'longdash', label: '长虚线', dash: '12 6' },
  { v: 'dashdot', label: '点划线', dash: '8 4 2 4' },
]
/** 按 key 取 stroke-dasharray */
export function lineDashCss(key: string | undefined): string {
  return LINE_STYLES.find((s) => s.v === key)?.dash ?? ''
}

/** 按 key 取 CSS text-shadow */
export function shadowCss(key: string | undefined): string {
  return SHADOW_OPTIONS.find((s) => s.v === key)?.css ?? SHADOW_OPTIONS[0].css
}

/**
 * 估算一段文字在给定宽度 / 字号下需要的高度（Markdown 导入时给元素框定高用）。
 * 口径与模板层一致：中文（含全角）算 1 字宽、西文 0.55、`$...$` 公式按源码长度的一半折算。
 * 为什么要按内容算：导入器原本把框高写死 120px —— 稍长的一段话塞进 120px 会被 shrink 缩到看不清，
 * 而短句又白占 120px。按内容定高后，长段落自然不会「半句话就翻页」。
 */
export function estimateTextHeight(text: string, fontSize: number, width: number, lineHeight = 1.55): number {
  const perLine = Math.max(8, width / fontSize)
  const marked = String(text).replace(/\$[^$]*\$/g, (m) => '\u0001'.repeat(Math.max(2, Math.round((m.length - 2) * 0.5))))
  let units = 0
  let lines = 1
  for (const ch of marked) {
    if (ch === '\n') { lines++; units = 0; continue }
    const w = ch === '\u0001' ? 1 : /[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/.test(ch) ? 1 : 0.55
    units += w
    if (units > perLine) { lines++; units = w }
  }
  return Math.round(lines * fontSize * lineHeight) + 12
}

/**
 * 把文本里常见的 $...$ / $$...$$ 数学定界归一化成无歧义的 \(...\) / \[...\]。
 * 规避 MathJax 对「$ 与数字相邻」时的跳过规则（例如 \frac{\sqrt6}{2}$ 的结尾 $ 紧挨数字，
 * 会被当作普通字符，导致配对错乱、$ 原样显示）。
 */
export function normalizeMixed(text: string): string {
  return String(text)
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, inner: string) => '\\[' + inner + '\\]')
    .replace(/\$([^$\n]+?)\$/g, (_m, inner: string) => '\\(' + inner + '\\)')
}

export interface ShapeElement extends ElementBase {
  type: 'shape'
  shape: 'rect' | 'ellipse'
  fill: string
  stroke: string
  strokeWidth: number
  /** 圆角半径（px，仅矩形有效；bento 卡片风） */
  cornerRadius?: number
}

/** 直线 / 箭头：在矩形框内沿对角线绘制，可用 rot 调整角度 */
export interface LineElement extends ElementBase {
  type: 'line'
  stroke: string
  strokeWidth: number
  /** 两端点（归一化 [x0,y0,x1,y1]），可双击拖端调整方向 */
  points?: number[]
}

export interface ArrowElement extends ElementBase {
  type: 'arrow'
  stroke: string
  strokeWidth: number
  /** 两端点（归一化 [x0,y0,x1,y1]），可双击拖端调整方向 */
  points?: number[]
  /** 箭头端样式（见 ARROW_HEADS） */
  arrowHead?: string
}

/** 手绘笔迹：points 为相对元素原点 (0,0) 的坐标序列 */
export interface PenElement extends ElementBase {
  type: 'pen'
  stroke: string
  strokeWidth: number
  points: { x: number; y: number }[]
}

/** 数学图形种类 */
export type MathFigureKind =
  // ---- 函数图像（含新增：一次 / 三次 / 绝对值 / 根式 / 反比例 / 双钩 / 正切 / 正弦型 / 指数递减） ----
  | 'linear' | 'parabola' | 'cubic' | 'absolute' | 'sqrt' | 'reciprocal' | 'hook'
  | 'tangent' | 'sine' | 'cosine' | 'sinusoid' | 'exponential' | 'expDecay' | 'logarithm'
  | 'piecewise' | 'paramQuadratic' | 'paramAbs'
  // ---- 圆锥曲线 ----
  | 'conicCircle' | 'ellipse' | 'hyperbola' | 'conicParabola' | 'conicFocusDir'
  | 'ellipseV' | 'hyperbolaV' | 'conicParabolaV' | 'conicCircleY'
  | 'ellipseDirectrix' | 'hyperbolaDirectrix' | 'ellipseFamily' | 'hyperbolaFamily' | 'eccAnim'
  // ---- 平面图形 ----
  | 'coordinate' | 'numberline' | 'venn' | 'righttriangle' | 'angle' | 'semicircle'
  | 'triangle' | 'rectangle' | 'circle' | 'pentagon' | 'hexagon' | 'rhombus'
  | 'parallelogram' | 'trapezoid' | 'star' | 'bezier' | 'polygon'
  // ---- 3D 立体几何 ----
  | 'cube' | 'cuboid' | 'cylinder' | 'cone' | 'sphere' | 'pyramid' | 'prism' | 'tetrahedron'
  | 'frustum' | 'pyraFrustum' | 'dihedral' | 'isoaxis'
  | 'octahedron' | 'hexPrism' | 'obliquePrism' | 'triFrustum'
  // ---- 辅助线 / 标注 ----
  | 'auxLine' | 'rightAngle' | 'equalMark' | 'parallelMark' | 'angleArc' | 'section'

/** 数学图形分类（面板按这个分组显示） */
export type MathFigureCat = '平面图形' | '立体几何' | '复刻图形' | '函数图像' | '圆锥曲线' | '辅助标注'
export const MATH_FIGURE_CATS: MathFigureCat[] = ['平面图形', '立体几何', '复刻图形', '函数图像', '圆锥曲线', '辅助标注']

export const MATH_FIGURE_OPTIONS: { v: MathFigureKind; label: string; cat: MathFigureCat }[] = [
  // ---- 函数图像 ----
  { v: 'linear', label: '一次函数 y=x+1', cat: '函数图像' },
  { v: 'parabola', label: '二次函数 y=x²', cat: '函数图像' },
  { v: 'cubic', label: '三次函数 y=x³', cat: '函数图像' },
  { v: 'absolute', label: '绝对值 y=|x|', cat: '函数图像' },
  { v: 'sqrt', label: '根式 y=√x', cat: '函数图像' },
  { v: 'reciprocal', label: '反比例 y=1/x', cat: '函数图像' },
  { v: 'hook', label: '双钩 y=x+1/x', cat: '函数图像' },
  { v: 'sine', label: '正弦 y=sin x', cat: '函数图像' },
  { v: 'cosine', label: '余弦 y=cos x', cat: '函数图像' },
  { v: 'sinusoid', label: '正弦型 y=Asin(ωx+φ)（可调参数）', cat: '函数图像' },
  { v: 'piecewise', label: '分段函数（实心/空心点）', cat: '函数图像' },
  { v: 'paramQuadratic', label: '含参二次 y=x²−2ax+1（可调 a）', cat: '函数图像' },
  { v: 'paramAbs', label: '含参绝对值 y=|x−a|（可调 a）', cat: '函数图像' },
  { v: 'tangent', label: '正切 y=tan x', cat: '函数图像' },
  { v: 'exponential', label: '指数 y=2ˣ', cat: '函数图像' },
  { v: 'expDecay', label: '指数 y=(1/2)ˣ', cat: '函数图像' },
  { v: 'logarithm', label: '对数 y=log₂x', cat: '函数图像' },
  // ---- 圆锥曲线 ----
  { v: 'conicCircle', label: '圆 x²+y²=r²', cat: '圆锥曲线' },
  { v: 'conicCircleY', label: '圆（圆心在 y 轴）', cat: '圆锥曲线' },
  { v: 'ellipse', label: '椭圆（焦点在 x 轴）', cat: '圆锥曲线' },
  { v: 'ellipseV', label: '椭圆（焦点在 y 轴）', cat: '圆锥曲线' },
  { v: 'hyperbola', label: '双曲线（焦点在 x 轴）', cat: '圆锥曲线' },
  { v: 'hyperbolaV', label: '双曲线（焦点在 y 轴）', cat: '圆锥曲线' },
  { v: 'conicParabola', label: '抛物线 y²=2px（焦点在 x 轴）', cat: '圆锥曲线' },
  { v: 'conicParabolaV', label: '抛物线 x²=2py（焦点在 y 轴）', cat: '圆锥曲线' },
  { v: 'conicFocusDir', label: '圆锥曲线统一定义（焦点·准线）', cat: '圆锥曲线' },
  { v: 'ellipseDirectrix', label: '椭圆（焦点·准线）', cat: '圆锥曲线' },
  { v: 'hyperbolaDirectrix', label: '双曲线（焦点·准线）', cat: '圆锥曲线' },
  { v: 'ellipseFamily', label: '椭圆族（离心率 e 变化）', cat: '圆锥曲线' },
  { v: 'hyperbolaFamily', label: '双曲线族（离心率 e 变化）', cat: '圆锥曲线' },
  { v: 'eccAnim', label: '椭圆离心率变化（动画）', cat: '圆锥曲线' },
  // ---- 平面图形 ----
  { v: 'coordinate', label: '坐标系', cat: '平面图形' },
  { v: 'numberline', label: '数轴', cat: '平面图形' },
  { v: 'venn', label: 'Venn 图', cat: '平面图形' },
  { v: 'righttriangle', label: '直角三角形', cat: '平面图形' },
  { v: 'angle', label: '角', cat: '平面图形' },
  { v: 'semicircle', label: '半圆', cat: '平面图形' },
  { v: 'triangle', label: '三角形', cat: '平面图形' },
  { v: 'rectangle', label: '矩形', cat: '平面图形' },
  { v: 'circle', label: '圆', cat: '平面图形' },
  { v: 'pentagon', label: '五边形', cat: '平面图形' },
  { v: 'hexagon', label: '正六边形', cat: '平面图形' },
  { v: 'rhombus', label: '菱形', cat: '平面图形' },
  { v: 'parallelogram', label: '平行四边形', cat: '平面图形' },
  { v: 'trapezoid', label: '梯形', cat: '平面图形' },
  { v: 'star', label: '五角星', cat: '平面图形' },
  { v: 'bezier', label: '贝塞尔曲线', cat: '平面图形' },
  { v: 'polygon', label: '自定义多边形', cat: '平面图形' },
  // ---- 立体几何 ----
  { v: 'cube', label: '立方体', cat: '立体几何' },
  { v: 'cuboid', label: '长方体', cat: '立体几何' },
  { v: 'cylinder', label: '圆柱', cat: '立体几何' },
  { v: 'cone', label: '圆锥', cat: '立体几何' },
  { v: 'sphere', label: '球', cat: '立体几何' },
  { v: 'pyramid', label: '四棱锥', cat: '立体几何' },
  { v: 'prism', label: '棱柱', cat: '立体几何' },
  { v: 'tetrahedron', label: '四面体', cat: '立体几何' },
  { v: 'frustum', label: '圆台', cat: '立体几何' },
  { v: 'pyraFrustum', label: '棱台', cat: '立体几何' },
  { v: 'triFrustum', label: '正三棱台', cat: '立体几何' },
  { v: 'hexPrism', label: '正六棱柱', cat: '立体几何' },
  { v: 'obliquePrism', label: '斜棱柱', cat: '立体几何' },
  { v: 'octahedron', label: '正八面体', cat: '立体几何' },
  { v: 'dihedral', label: '二面角', cat: '立体几何' },
  { v: 'isoaxis', label: '等距轴', cat: '立体几何' },
  // ---- 辅助线 / 标注 ----
  { v: 'auxLine', label: '辅助虚线', cat: '辅助标注' },
  { v: 'rightAngle', label: '直角符号', cat: '辅助标注' },
  { v: 'equalMark', label: '等长标记', cat: '辅助标注' },
  { v: 'parallelMark', label: '平行标记', cat: '辅助标注' },
  { v: 'angleArc', label: '角标记', cat: '辅助标注' },
  { v: 'section', label: '截面', cat: '辅助标注' },
]

/** 数学符号面板：点击插入为文本元素 */
export const MATH_SYMBOLS: string[] = [
  '∈', '∉', '⊂', '⊆', '∪', '∩', '∅', '∀', '∃', '⇒', '⇔', '∵', '∴',
  '√', '∞', '∑', '∫', '∂', 'π', '±', '×', '÷', '≤', '≥', '≠', '≈',
  '≡', '⊥', '∥', '∠', '△', '∘', 'α', 'β', 'γ', 'θ', 'λ', 'μ', 'σ', 'ω',
  '→', '↔', '↑', '↓', '①', '②', '③', '④', '½', '⅓', '¼', '⅔', '¾', '°', '′', '″',
]

/** 可统一切换的「图形」类型：rect/ellipse 为形状，line/arrow 为线条，其余为数学图形 */
export const GRAPHIC_TYPES: { v: string; label: string; cat: 'shape' | 'line' | 'arrow' | 'mathfig' }[] = [
  { v: 'rect', label: '矩形', cat: 'shape' },
  { v: 'ellipse', label: '椭圆', cat: 'shape' },
  { v: 'line', label: '直线', cat: 'line' },
  { v: 'arrow', label: '箭头', cat: 'arrow' },
  { v: 'triangle', label: '三角形', cat: 'mathfig' },
  { v: 'circle', label: '圆', cat: 'mathfig' },
  { v: 'righttriangle', label: '直角Δ', cat: 'mathfig' },
  { v: 'pentagon', label: '五边形', cat: 'mathfig' },
  { v: 'hexagon', label: '六边形', cat: 'mathfig' },
  { v: 'rhombus', label: '菱形', cat: 'mathfig' },
  { v: 'parallelogram', label: '平行四边形', cat: 'mathfig' },
  { v: 'trapezoid', label: '梯形', cat: 'mathfig' },
  { v: 'star', label: '五角星', cat: 'mathfig' },
  { v: 'bezier', label: '贝塞尔', cat: 'mathfig' },
  { v: 'polygon', label: '多边形', cat: 'mathfig' },
  { v: 'venn', label: '交集图', cat: 'mathfig' },
  { v: 'angle', label: '角', cat: 'mathfig' },
  { v: 'semicircle', label: '半圆', cat: 'mathfig' },
  { v: 'parabola', label: '抛物线', cat: 'mathfig' },
  { v: 'coordinate', label: '坐标系', cat: 'mathfig' },
]

export interface MathFigureElement extends ElementBase {
  type: 'mathfig'
  kind: MathFigureKind
  fill: string
  stroke: string
  strokeWidth: number
  /** 可编辑图形（贝塞尔/自定义多边形）的归一化顶点，扁平 [x0,y0,x1,y1,...]，0~1 */
  points?: number[]
  /** 可调参数（如 y=Asin(ωx+φ) 的 A/ω/φ、含参二次的 a），属性面板可改 */
  params?: Record<string, number>
  /** 3D 立体的投影深度(0~1) */
  depth?: number
  /** 每个顶点的字母标注（下标/上标用 _ 和 ^，如 "A_1" "B^2"、\' 加撇），长度与顶点数一致 */
  vlabels?: (string | null)[]
  /** 每条边的样式覆盖（实线/虚线/点线、粗细、颜色），索引与立体边表一致 */
  edgeStyles?: ({ dash?: 'solid' | 'dash' | 'dot'; width?: number; color?: string; arrow?: boolean } | null)[]
  /** 每个顶点字母相对默认位置(顶点上方)的拖拽偏移(归一化)，用于避免遮挡 */
  labelOffsets?: { dx: number; dy: number }[]
  /** 每个面的样式覆盖（填充色/透明度/隐藏该面），索引与面表一致 */
  faceStyles?: ({ fill?: string; opacity?: number; hidden?: boolean } | null)[]
  /** 自由建模：自定义拓扑（顶点用 points），启用后覆盖该类型默认的边/面 */
  mesh?: { edges: [number, number, number][]; faces: number[][] }
}

/** 图表类型 */
export type ChartType = 'bar' | 'line' | 'pie'

export const CHART_TYPE_OPTIONS: { v: ChartType; label: string }[] = [
  { v: 'bar', label: '柱状图' },
  { v: 'line', label: '折线图' },
  { v: 'pie', label: '饼图' },
]

export interface ChartElement extends ElementBase {
  type: 'chart'
  chartType: ChartType
  labels: string[]
  values: number[]
  color: string
}

export interface TableElement extends ElementBase {
  type: 'table'
  /** rows[0] 为表头 */
  rows: string[][]
  headerColor: string
  borderColor: string
  fontSize: number
  /** 表头文字色（默认 #fff） */
  headerTextColor?: string
  /** 隔行条纹色（斑马纹；不设置则纯白） */
  altRowColor?: string
  /** 单元格内边距(px) */
  cellPad?: number
  /** 单元格文字对齐 */
  cellAlign?: 'left' | 'center' | 'right'
  /** 正文文字色（表体；表头用 headerTextColor） */
  cellColor?: string
}

/** 图标：用 emoji / 符号，离线可用 */
export interface IconElement extends ElementBase {
  type: 'icon'
  icon: string
  color: string
}

export const ICON_LIBRARY: string[] = [
  '★', '☆', '✓', '✗', '⚠', '♥', '⚙', '📐', '📏', '✏', '📊', '📈', '📉', '🔢', '🧮',
  '➗', '×', '÷', '☑', '➤', '🔍', '🔖', '📌', '🧭', '📚', '🎓', '💡', '🔑', '⏱', '📝',
]

/** 嵌入类型：url=外部链接；image/pdf/html=内嵌本地文件；doc=不支持内部预览的文档，给出提示 */
export type EmbedKind = 'url' | 'image' | 'pdf' | 'html' | 'doc'

export interface EmbedElement extends ElementBase {
  type: 'embed'
  /** 外部链接（kind=url 时用） */
  url: string
  kind: EmbedKind
  /** 本地文件内容（base64），配合 mime 重建 src */
  dataBase64: string
  mime: string
}

/** 富混排：正文 + 用 \( ... \) 包裹的 LaTeX 内联公式混排 */
export interface RichTextElement extends ElementBase {
  type: 'richtex'
  /** 混排内容：普通文字 + \(latex\) 内联公式 */
  text: string
  fontSize: number
  color: string
  fontWeight: number
  fontFamily: string
  align: 'left' | 'center' | 'right'
  bgColor: string
  shadow: string
  /** 换行：true=自动换行+保留换行符(pre-wrap)；false=不自动换行、仅保留换行符(pre) */
  wrap?: boolean
  /** 行属性：按 text 的 \n 分行，每行可单独设颜色 / 字体 */
  lineStyles?: { color?: string; fontFamily?: string }[]
}

export interface ImageElement extends ElementBase {
  type: 'image'
  src: string
  fit: 'cover' | 'contain'
  /** 发光（PowerPoint 图片特效）：颜色 + 强度(px，drop-shadow 模糊半径) */
  glowColor?: string
  glowSize?: number
  /** 映像（PowerPoint 图片特效）：none=无 tight=紧 medium=中 loose=松 */
  reflection?: 'none' | 'tight' | 'medium' | 'loose'
  /** 柔化边缘（px，值越大边缘越淡出） */
  softEdge?: number
}

/** 图片特效预设下拉（PowerPoint 风格）*/
export const IMAGE_REFLECTIONS: { v: NonNullable<ImageElement['reflection']>; label: string }[] = [
  { v: 'none', label: '无' },
  { v: 'tight', label: '紧' },
  { v: 'medium', label: '中' },
  { v: 'loose', label: '松' },
]

/** 映像预设：间隙(px) + 淡出遮罩色 */
const REFLECT_PRESETS: Record<Exclude<ImageElement['reflection'], undefined | 'none'>, [number, string]> = {
  tight: [2, 'rgba(0,0,0,0.32)'],
  medium: [5, 'rgba(0,0,0,0.42)'],
  loose: [10, 'rgba(0,0,0,0.52)'],
}

/** 生成图片特效 CSS（编辑器画布与 Reveal 导出共用，保证两端一致）。
 *  发光=drop-shadow 贴合透明形状；映像=-webkit-box-reflect（Firefox 优雅降级为无反射）；
 *  柔化边缘=双侧 mask 渐隐，保留矩形轮廓。 */
export function imageEffectCss(el: Pick<ImageElement, 'glowColor' | 'glowSize' | 'reflection' | 'softEdge'>): string {
  const css: string[] = []
  if (el.glowSize && el.glowColor) css.push('filter: drop-shadow(0 0 ' + el.glowSize + 'px ' + el.glowColor + ')')
  if (el.reflection && el.reflection !== 'none') {
    const g = REFLECT_PRESETS[el.reflection] ?? [0, 'rgba(0,0,0,0.4)']
    css.push('-webkit-box-reflect: below ' + g[0] + 'px linear-gradient(to bottom, ' + g[1] + ', transparent)')
  }
  if (el.softEdge) {
    const n = el.softEdge
    const mg = 'linear-gradient(to right, transparent, #000 ' + n + 'px, #000 calc(100% - ' + n + 'px), transparent), linear-gradient(to bottom, transparent, #000 ' + n + 'px, #000 calc(100% - ' + n + 'px), transparent)'
    css.push('-webkit-mask-image: ' + mg + '; -webkit-mask-composite: source-in; mask-image: ' + mg + '; mask-composite: intersect')
  }
  return css.join('; ')
}


export interface MathElement extends ElementBase {
  type: 'math'
  /** LaTeX 源码，不含 $ 定界符 */
  latex: string
  color: string
  /** 基准字号（设计像素），渲染后 SVG 会等比缩放以适配元素框 */
  fontSize: number
  /** 水平对齐：影响公式在元素框内的位置 */
  align?: 'left' | 'center' | 'right'
}

export interface GeoGebraElement extends ElementBase {
  type: 'geogebra'
  app: GgbApp
  /** base64 编码的 .ggb 文件内容（可选，为空则打开空白计算器） */
  ggbBase64: string
  showToolbar: boolean
  showAlgebraInput: boolean
  /** 是否显示代数区（左侧代数视图） */
  showAlgebra: boolean
  /** 是否显示标题栏（拖动移动元素） */
  showTitlebar: boolean
  showMenuBar: boolean
  showResetIcon: boolean
  enableShiftDragZoom: boolean
  /** 显示坐标轴 */
  showAxis: boolean
  /** 显示网格 */
  showGrid: boolean
  /** 打开后自动执行的 GeoGebra 命令（预设动态图，如 "f(x)=x^2"、"A=(1,1)"） */
  commands?: string[]
}

export interface DesmosElement extends ElementBase {
  type: 'desmos'
  /** Desmos 计算器状态（JSON 字符串），保存表达式/视图/颜色等 */
  state: string
  /** 是否显示函数面板（左侧表达式列表） */
  showPanel: boolean
  /** 是否显示工具栏（右侧） */
  showToolbar: boolean
  /** 是否显示缩放按钮（右下角 +/−/首页） */
  showZoomButtons: boolean
  /** 是否显示标题栏（用于拖动移动元素） */
  showTitlebar: boolean
  /** 表达式颜色；留空 = 由 Desmos 自动配色 */
  color: string
}

export type SlideElement =
  | TextElement
  | ShapeElement
  | ImageElement
  | MathElement
  | GeoGebraElement
  | DesmosElement
  | LineElement
  | ArrowElement
  | PenElement
  | MathFigureElement
  | ChartElement
  | TableElement
  | IconElement
  | EmbedElement
  | RichTextElement

export interface Slide {
  id: string
  /** 背景色 */
  bg: string
  elements: SlideElement[]
  /** 演讲者备注（演示时展示） */
  notes?: string
  /** 所属父页 id（子页）：在 Reveal 中作为父页的垂直堆叠，上下滚动；无则为一页独立水平幻灯片 */
  parentId?: string
  /** 背景渐变（叠加在纯色 bg 上）：angle + 停靠点 */
  bgGradient?: { angle: number; stops: { at: number; color: string }[] }
  /** 背景图（URL / dataURL，覆盖纯色与渐变） */
  bgImage?: string
  /** Reveal 本页过渡动画（none/fade/slide/zoom/...；留空用文稿默认） */
  transition?: string
}


/** 页面过渡动画选项（Reveal） */
export const SLIDE_TRANSITIONS: { v: string; label: string }[] = [
  { v: '', label: '默认（文稿）' },
  { v: 'none', label: '无' },
  { v: 'fade', label: '淡入' },
  { v: 'slide', label: '滑动' },
  { v: 'convex', label: '凸出' },
  { v: 'concave', label: '凹进' },
  { v: 'zoom', label: '缩放' },
]

/** 生成页面背景 CSS（bg 纯色 + 可选渐变/图片叠加；编辑器与 Reveal 共用） */
export function slideBgCss(s: Pick<Slide, 'bg' | 'bgGradient' | 'bgImage'>): string {
  const base = s.bg || '#ffffff'
  if (s.bgImage) return "url('" + s.bgImage + "') center/cover no-repeat, " + base
  const g = s.bgGradient
  if (g && g.stops && g.stops.length) {
    const parts = g.stops.map((x) => x.color + ' ' + Math.round(x.at * 100) + '%').join(', ')
    return 'linear-gradient(' + (g.angle ?? 180) + 'deg, ' + parts + '), ' + base
  }
  return base
}

/** 主题：切换整套配色（背景 / 强调 / 文字），应用于全部页面 */
export interface Theme {
  id: string
  name: string
  bg: string
  accent: string
  ink: string
}

export const THEMES: Theme[] = [
  // 基准
  { id: 'white', name: '默认白', bg: '#ffffff', accent: '#8a2be2', ink: '#1a1a1a' },
  { id: 'light', name: '浅灰', bg: '#f5f5f2', accent: '#c0392b', ink: '#2c2c2a' },
  { id: 'cream', name: '米黄', bg: '#fdf6e3', accent: '#c9a227', ink: '#3b3b3b' },
  { id: 'blue', name: '淡蓝', bg: '#eaf2ff', accent: '#1f5fd6', ink: '#18263a' },
  { id: 'green', name: '淡绿', bg: '#eaf7ef', accent: '#1f8a4c', ink: '#173a26' },
  // curated —— 源自 frontend-slides 风格预设（浅色/粉彩为主，深色主题默认文字也偏亮）
  { id: 'lavender', name: '淡藕紫', bg: '#f4edfd', accent: '#8a2be2', ink: '#3b2a55' },
  { id: 'notebook', name: '速记纸', bg: '#f8f6f1', accent: '#7c6aad', ink: '#1a1a1a' },
  { id: 'pastel', name: '柔和粉彩', bg: '#e7eef5', accent: '#5a7c6a', ink: '#1a1a1a' },
  { id: 'vintage', name: '复古编辑', bg: '#f5f3ee', accent: '#c41e3a', ink: '#2b2b2b' },
  { id: 'split', name: '双拼', bg: '#f2e9e4', accent: '#8f7bc0', ink: '#2b2b2b' },
  { id: 'bold', name: '大胆信号', bg: '#24222b', accent: '#ff5722', ink: '#ffffff' },
  { id: 'botanical', name: '暗夜植物', bg: '#101015', accent: '#d4a574', ink: '#e8e4df' },
  { id: 'bento', name: 'Bento 卡片', bg: '#F0EBE0', accent: '#FF9E8A', ink: '#16273E' },
]

export function findTheme(id?: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

export interface Deck {
  title: string
  /** 演示描述（设置面板） */
  description?: string
  /** 设计画布尺寸，固定 16:9 */
  width: number
  height: number
  slides: Slide[]
  /** 当前页面背景主题 id（可选，curated THEMES） */
  theme?: string
  /** Reveal 演示主题：black/white/league/... */
  revealTheme?: string
  /** 演示字体（如 Montserrat / 思源黑体） */
  font?: string
  /** 页面切换动画：slide/none/fade/convex/concave/zoom */
  transition?: string
  /** 切换速度：default/fast/slow */
  transitionSpeed?: string
}

export const REVEAL_THEMES: { v: string; label: string }[] = [
  { v: 'white', label: 'White 白' },
  { v: 'black', label: 'Black 黑（深底白字）' },
  { v: 'league', label: 'League 联盟' },
  { v: 'beige', label: 'Beige 米色' },
  { v: 'sky', label: 'Sky 天蓝' },
  { v: 'night', label: 'Night 夜空' },
  { v: 'serif', label: 'Serif 衬线' },
  { v: 'simple', label: 'Simple 简洁' },
  { v: 'solarized', label: 'Solarized' },
  { v: 'blood', label: 'Blood 血红' },
  { v: 'moon', label: 'Moon 月' },
  { v: 'dracula', label: 'Dracula 吸血鬼' },
]
export const REVEAL_TRANSITIONS = ['slide', 'none', 'fade', 'convex', 'concave', 'zoom']
export const REVEAL_SPEEDS = ['default', 'fast', 'slow']

/** 创建新元素时的默认属性 */
export function createElement(type: ElementType, rect: Partial<Rect> = {}): SlideElement {
  const base: Rect = {
    x: rect.x ?? 200,
    y: rect.y ?? 200,
    w: rect.w ?? 320,
    h: rect.h ?? 120,
  }
  const id = `el_${Math.random().toString(36).slice(2, 10)}`
  const rot = 0

  switch (type) {
    case 'text':
      return {
        ...base, id, rot, type: 'text',
        text: '双击编辑文字',
        fontSize: 32,
        color: '#1a1a1a',
        fontWeight: 400,
        align: 'center',
        fontFamily: 'sans',
        bgColor: 'transparent',
        shadow: 'none',
        letterSpacing: 0,
        valign: 'middle',
      }
    case 'shape':
      return {
        ...base, id, rot, type: 'shape',
        shape: 'rect',
        fill: '#534AB7',
        stroke: 'transparent',
        strokeWidth: 0,
      }
    case 'image':
      return {
        ...base, id, rot, type: 'image',
        src: '',
        fit: 'cover',
        glowColor: '',
        glowSize: 0,
        reflection: 'none',
        softEdge: 0,
      }
    case 'math':
      return {
        ...base, id, rot, type: 'math',
        w: rect.w ?? 420,
        h: rect.h ?? 140,
        latex: 'x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}',
        color: '#1a1a1a',
        fontSize: 40,
        // 插入后自动把外框收成刚好包住公式：立即看到的字号就是 40px，
        // 之后拖动外框即按 fitMode='fill' 无级放大
        autoBox: true,
      }
    case 'geogebra':
      return {
        ...base, id, rot, type: 'geogebra',
        w: rect.w ?? 640,
        h: rect.h ?? 420,
        app: 'classic',
        ggbBase64: '',
        showToolbar: true,
        showAlgebraInput: true,
        showAlgebra: true,
        showTitlebar: true,
        showMenuBar: false,
        showResetIcon: true,
        enableShiftDragZoom: true,
        showAxis: true,
        showGrid: false,
      }
    case 'desmos':
      return {
        ...base, id, rot, type: 'desmos',
        w: rect.w ?? 640,
        h: rect.h ?? 420,
        state: '',
        showPanel: true,
        showToolbar: true,
        showZoomButtons: true,
        showTitlebar: true,
        color: '',
      }
    case 'line':
      return {
        ...base, id, rot, type: 'line',
        w: rect.w ?? 200,
        h: rect.h ?? 2,
        stroke: '#1a1a1a',
        strokeWidth: 3,
      }
    case 'arrow':
      return {
        ...base, id, rot, type: 'arrow',
        w: rect.w ?? 200,
        h: rect.h ?? 2,
        stroke: '#1a1a1a',
        strokeWidth: 3,
      }
    case 'pen':
      return {
        ...base, id, rot, type: 'pen',
        w: rect.w ?? 240,
        h: rect.h ?? 120,
        stroke: '#1a1a1a',
        strokeWidth: 4,
        points: [
          { x: 20, y: 80 }, { x: 60, y: 40 }, { x: 110, y: 70 },
          { x: 160, y: 30 }, { x: 210, y: 60 },
        ],
      }
    case 'mathfig':
      return {
        ...base, id, rot, type: 'mathfig',
        w: rect.w ?? 320,
        h: rect.h ?? 200,
        kind: 'parabola',
        fill: 'transparent',
        stroke: '#1a1a1a',
        strokeWidth: 3,
      }
    case 'chart':
      return {
        ...base, id, rot, type: 'chart',
        w: rect.w ?? 360,
        h: rect.h ?? 240,
        chartType: 'bar',
        labels: ['A', 'B', 'C', 'D'],
        values: [30, 55, 40, 70],
        color: '#534ab7',
      }
    case 'table':
      return {
        ...base, id, rot, type: 'table',
        w: rect.w ?? 420,
        h: rect.h ?? 160,
        rows: [
          ['项目', '数值'],
          ['甲', '80'],
          ['乙', '60'],
        ],
        headerColor: '#534ab7',
        borderColor: '#d3d1c7',
        fontSize: 16,
      }
    case 'icon':
      return {
        ...base, id, rot, type: 'icon',
        w: rect.w ?? 64,
        h: rect.h ?? 64,
        icon: '★',
        color: '#1a1a1a',
      }
    case 'embed':
      return {
        ...base, id, rot, type: 'embed',
        w: rect.w ?? 480,
        h: rect.h ?? 300,
        url: '',
        kind: 'url',
        dataBase64: '',
        mime: '',
      }
    case 'richtex':
      return {
        ...base, id, rot, type: 'richtex',
        w: rect.w ?? 520,
        h: rect.h ?? 90,
        text: '输入文字与内联公式，如 \\(x^2+1=0\\)，求实数解。',
        fontSize: 28,
        color: '#1a1a1a',
        fontWeight: 400,
        fontFamily: 'sans',
        align: 'left',
        bgColor: 'transparent',
        shadow: 'none',
      }
  }
}
