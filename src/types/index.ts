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
  /** 入场动画（配合上面的 fragment：勾选渐显才会"点击后出现"） */
  animIn?: AnimIn
  /** 强调动画：入场之后自动接着播一次 */
  animEm?: AnimEm
  /** 退场动画（由"退出触发点"决定时机） */
  animOut?: AnimOut
  /** 退场触发点的出现序号（与 fragmentIndex 同一套编号，越小越先） */
  animOutIndex?: number
  /** 动画时长 / 延迟（ms） */
  animDuration?: number
  animDelay?: number
  /** **锁定位置**：锁定后不能在画布上拖动/缩放（仍然可以选中、编辑属性） */
  locked?: boolean
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

  /** 项目符号：none=无；dot•/circle○/square▪/dash–；number=1. alpha=a) roman=i */
  bullet?: BulletKind
  /** 项目符号的悬挂缩进（px）：符号占的位置，正文从这里开始 */
  bulletIndent?: number
  /** 整段左缩进（px） */
  indent?: number
  /** 段前 / 段后间距（px）—— 这里"段"指一行（元素是按行排的） */
  paraBefore?: number
  paraAfter?: number
  /** 垂直对齐：top/middle/bottom */
  valign?: 'top' | 'middle' | 'bottom'
  /** 文字发光（PowerPoint 艺术字）：颜色 + 模糊半径 */
  glowColor?: string
  glowBlur?: number
}

/** 项目符号种类 */
export type BulletKind = 'none' | 'dot' | 'circle' | 'square' | 'dash' | 'number' | 'alpha' | 'roman'

/** 项目符号预设（下拉用） */
export const BULLETS: { v: BulletKind; label: string }[] = [
  { v: 'none', label: '无' },
  { v: 'dot', label: '● 实心圆点' },
  { v: 'circle', label: '○ 空心圆点' },
  { v: 'square', label: '▪ 方块' },
  { v: 'dash', label: '– 短横' },
  { v: 'number', label: '1. 阿拉伯数字' },
  { v: 'alpha', label: 'a) 小写字母' },
  { v: 'roman', label: 'i. 罗马数字' },
]

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii']

/** 取第 i 行的项目符号文本（编辑器与 Reveal 导出共用，保证两端一致） */
export function bulletMarker(kind: BulletKind | undefined, i: number): string {
  switch (kind) {
    case 'dot': return '●'
    case 'circle': return '○'
    case 'square': return '▪'
    case 'dash': return '–'
    case 'number': return i + 1 + '.'
    case 'alpha': return String.fromCharCode(97 + (i % 26)) + ')'
    case 'roman': return (ROMAN[i] || String(i + 1)) + '.'
    default: return ''
  }
}

/** 段落相关的行内样式（缩进 / 段间距），编辑器与导出共用 */
export function paragraphLineStyle(el: {
  bullet?: BulletKind; bulletIndent?: number; indent?: number; paraBefore?: number; paraAfter?: number
} | null | undefined, i: number, total: number): string {
  if (!el) return ''
  const ind = el.indent || 0
  const bul = el.bullet && el.bullet !== 'none' ? (el.bulletIndent ?? 22) : 0
  const parts = ['padding-left:' + (ind + bul) + 'px']
  if (i > 0 && el.paraBefore) parts.push('margin-top:' + el.paraBefore + 'px')
  if (i < total - 1 && el.paraAfter) parts.push('margin-bottom:' + el.paraAfter + 'px')
  if (bul) {
    parts.push('text-indent:-' + bul + 'px') // 符号悬挂到左边
  }
  return parts.join(';')
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
/**
 * 转义 HTML —— 凡是把**用户文本**塞进 innerHTML / v-html 的地方，都必须先过这一道。
 * 不转义的后果：`$0<a<1$` 里的 `<` 会被浏览器当成标签开头，整段烂掉
 *（教材表里"连续不等式"就是这么坏的）。
 * ⚠ 顺序：**先转义、再插入图形标记/SVG** —— 反了会把 SVG 也转义掉。
 */
export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

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
  | 'custom'
  | 'linear' | 'parabola' | 'cubic' | 'absolute' | 'sqrt' | 'reciprocal' | 'hook'
  | 'tangent' | 'sine' | 'cosine' | 'sinusoid' | 'exponential' | 'expDecay' | 'logarithm' | 'normal'
  | 'piecewise' | 'paramQuadratic' | 'paramAbs' | 'piecewiseFn'
  // ---- 圆锥曲线 ----
  | 'conicCircle' | 'ellipse' | 'hyperbola' | 'conicParabola' | 'conicFocusDir'
  | 'ellipseV' | 'hyperbolaV' | 'conicParabolaV' | 'conicCircleY'
  | 'ellipseDirectrix' | 'hyperbolaDirectrix' | 'ellipseFamily' | 'hyperbolaFamily' | 'eccAnim'
  | 'conicCustomCircle' | 'conicCustomEllipse' | 'conicCustomEllipseV' | 'conicCustomHyperbola' | 'conicCustomParabola'
  // ---- 平面图形 ----
  | 'coordinate' | 'numberline' | 'venn' | 'righttriangle' | 'angle' | 'semicircle'
  | 'triangle' | 'rectangle' | 'circle' | 'pentagon' | 'hexagon' | 'rhombus' | 'kite' | 'angledrect'
  | 'parallelogram' | 'trapezoid' | 'star' | 'bezier' | 'polygon'
  | 'arcAngle' | 'arc3pt' | 'circleR' | 'ellipseArc' | 'ellipseAB'
  // ---- 3D 立体几何 ----
  | 'cube' | 'cubeOblique' | 'cuboid' | 'cuboidOblique' | 'cylinder' | 'cone' | 'sphere'
  | 'pyramid' | 'pyramidOblique' | 'prism' | 'prismOblique' | 'tetrahedron'
  | 'frustum' | 'pyraFrustum' | 'dihedral' | 'isoaxis'
  | 'octahedron' | 'hexPrism' | 'hexPrismOblique' | 'obliquePrism' | 'triFrustum'
  // ---- 必修二 立体几何定理图形 ----
  | 'thmLinePlanePara' | 'thmLinePlaneProp' | 'thmPlanePlanePerp' | 'thmPlanePlaneProp'
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
  { v: 'piecewiseFn', label: '自定义分段函数（每段自己写）', cat: '函数图像' },
  { v: 'paramQuadratic', label: '含参二次 y=x²−2ax+1（可调 a）', cat: '函数图像' },
  { v: 'paramAbs', label: '含参绝对值 y=|x−a|（可调 a）', cat: '函数图像' },
  { v: 'custom', label: '自定义函数（空白）', cat: '函数图像' },
  { v: 'tangent', label: '正切 y=tan x', cat: '函数图像' },
  { v: 'exponential', label: '指数 y=2ˣ', cat: '函数图像' },
  { v: 'expDecay', label: '指数 y=(1/2)ˣ', cat: '函数图像' },
  { v: 'normal', label: '正态密度曲线', cat: '函数图像' },
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
  // ⚠ 调色板卡片用的是**这里**的 label ✗，不是 CONICS[kind].label ✓ ——
  //   上一轮只改了 mathPlot 里的标签，卡片上没变，所以用户找不到"能加直线"这件事（实测）。
  { v: 'conicCustomEllipse', label: '自定义椭圆 + 直线/线段（可调 a、b）', cat: '圆锥曲线' },
  { v: 'conicCustomEllipseV', label: '自定义椭圆·长轴在 y 轴 + 直线/线段（可调 a、b）', cat: '圆锥曲线' },
  { v: 'conicCustomCircle', label: '自定义圆 + 直线/线段（可调圆心、半径）', cat: '圆锥曲线' },
  { v: 'conicCustomHyperbola', label: '自定义双曲线 + 直线/线段（可调 a、b）', cat: '圆锥曲线' },
  { v: 'conicCustomParabola', label: '自定义抛物线 + 直线/线段（可调 p、方向）', cat: '圆锥曲线' },
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
  { v: 'parallelogram', label: '平行四边形（可拖边长/夹角）', cat: '平面图形' },
  { v: 'arcAngle', label: '圆弧（圆心 + 圆心角）', cat: '平面图形' },
  { v: 'arc3pt', label: '圆弧（过三点）', cat: '平面图形' },
  { v: 'circleR', label: '圆（圆心 + 指定半径）', cat: '平面图形' },
  { v: 'ellipseArc', label: '椭圆弧（a、b、起始角 + 圆心角）', cat: '平面图形' },
  { v: 'ellipseAB', label: '椭圆（a、b 可拖）', cat: '平面图形' },
  { v: 'trapezoid', label: '梯形', cat: '平面图形' },
  { v: 'star', label: '五角星', cat: '平面图形' },
  { v: 'bezier', label: '贝塞尔曲线', cat: '平面图形' },
  { v: 'polygon', label: '自定义多边形', cat: '平面图形' },
  // ---- 立体几何 ----
  { v: 'cube', label: '立方体', cat: '立体几何' },
  { v: 'cubeOblique', label: '正方体（斜二测画法·顶点可拖）', cat: '立体几何' },
  { v: 'pyramidOblique', label: '四棱锥（斜二测画法·顶点可拖）', cat: '立体几何' },
  { v: 'prismOblique', label: '三棱柱（斜二测画法·顶点可拖）', cat: '立体几何' },
  { v: 'hexPrismOblique', label: '正六棱柱（斜二测画法·顶点可拖）', cat: '立体几何' },
  { v: 'thmLinePlanePara', label: '线面平行判定（a∥b，b⊂α → a∥α）', cat: '立体几何' },
  { v: 'thmLinePlaneProp', label: '线面平行性质（a∥α，a⊂β，α∩β=b → a∥b）', cat: '立体几何' },
  { v: 'thmPlanePlanePerp', label: '面面垂直判定（l⊥α，l⊂β → β⊥α）', cat: '立体几何' },
  { v: 'thmPlanePlaneProp', label: '面面垂直性质（α⊥β，a⊂β，a⊥m → a⊥α）', cat: '立体几何' },
  { v: 'cuboid', label: '长方体', cat: '立体几何' },
  { v: 'cuboidOblique', label: '长方体（斜二测画法·顶点可拖）', cat: '立体几何' },
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
  // ⭐ 圆角矩形：**形状仍是 rect** ✓ 只是带一个大的 cornerRadius ✓ —— 这样渲染器不用改 ✓
  { v: 'roundrect', label: '圆角矩形', cat: 'shape' },
  { v: 'ellipse', label: '椭圆', cat: 'shape' },
  { v: 'line', label: '直线', cat: 'line' },
  { v: 'arrow', label: '箭头', cat: 'arrow' },
  { v: 'triangle', label: '三角形', cat: 'mathfig' },
  { v: 'circle', label: '圆', cat: 'mathfig' },
  { v: 'righttriangle', label: '直角Δ', cat: 'mathfig' },
  { v: 'pentagon', label: '五边形', cat: 'mathfig' },
  { v: 'hexagon', label: '六边形', cat: 'mathfig' },
  { v: 'rhombus', label: '菱形', cat: 'mathfig' },
  { v: 'kite', label: '风筝形', cat: 'mathfig' },
  { v: 'angledrect', label: '斜矩形', cat: 'mathfig' },
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

/** 一段弧。两种写法：
 *  - **弦式**（手工画的弧）：只记「两个顶点 + 拱高」，**拖顶点时弧会自动跟着走**；
 *  - **自由式**（识别拟合出来的弧）：记绝对几何，带椭圆长短轴和旋转。
 *  用 i0/i1 是否存在区分。 */
export interface FigureArc {
  /** 【弦式曲线的控制点】顶点下标表（首尾是端点，中间是控制点）。
   *  2 个点：用 bulge 决定的圆；**3 个点：过三点的圆**（往弧上加点时形状完全不变）；
   *  4 个点以上：Catmull-Rom 平滑通过所有点。整条曲线始终是**一个图元**，不会被拆成几条。 */
  pts?: number[]
  /** 【旧写法，兼容】两端在 points 里的下标 */
  i0?: number
  i1?: number
  /** 【弦式】拱高 ÷ 弦长（正负决定鼓向哪一侧；只在 2 个控制点时有意义） */
  bulge?: number
  /** 1 = 这段弦式弧是**半椭圆**（不是圆弧）：长轴 = 两点连线，短半轴 = |bulge| × 弦长。
   *  圆台 / 圆锥 / 圆柱的底面在斜二测里就是这种半椭圆（近半实线、远半虚线）。 */
  ellipse?: 1
  /** 【自由式】圆心（归一化 0~1，相对元素宽高） */
  cx?: number
  cy?: number
  /** 【自由式】长短半轴（归一化） */
  rx?: number
  ry?: number
  /** 【自由式】椭圆旋转，弧度 */
  rot?: number
  /** 【自由式】起止角（弧度，椭圆参数角） */
  a0?: number
  a1?: number
  /** 1 = 虚线（被挡住的那半） */
  dash?: 0 | 1
}

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
  /**
   * 是否在顶点画**小圆点**。默认**不画** —— 也就是"只有字母、没有圆点"，跟原来的观感一致。
   * 勾上才画圆点（教材风）。字母不受它影响。复刻图形 / 立体几何 / 可拖顶点图形都适用。
   */
  showDots?: boolean
  vlabels?: (string | null)[]
  /** 每条边的样式覆盖（实线/虚线/点线、粗细、颜色），索引与立体边表一致 */
  edgeStyles?: ({ dash?: 'solid' | 'dash' | 'dot'; width?: number; color?: string; arrow?: boolean } | null)[]
  /** 圆锥曲线**自己的颜色**（不填 = 用元素主色）—— 让"椭圆一个色、每条线另一个色"成为可能 */
  conicStroke?: string
  /** **坐标轴**的颜色（不填 = 用元素主色）；虚实由 params.axisd 控制 */
  axisColor?: string
  /** 「圆锥曲线 + 多条直线/线段」里每条线的颜色覆盖，索引 = 第几条线 − 1 */
  lineColors?: (string | null)[]
  /** 「圆锥曲线的标注点」的名字（点个数由 params.pn 控制）；名字是字符串，所以放这里而不是 params */
  pointLabels?: (string | null)[]
  /** 每个标注点的颜色覆盖（索引 = 点序号 − 1）；大小走 params.ps{i} */
  pointColors?: (string | null)[]
  /** 把某个标注点**钉在"直线与曲线的交点"上**（line = 第几条线，which = 两个交点里的哪一个）。
   *  绑上之后该点的位置每次**现算**，所以直线一动它就跟着动 ✓；null = 普通点（用 px/py）。 */
  pointLinks?: ({ line: number; which: 0 | 1 } | { on: 'curve'; t: number; br?: 0 | 1 } | null)[]
  /** 把某条线**绑成"某个标注点处的切线"**（tangentAt = 点序号）。k/m 每次现算，动点一滑切线就转 ✓ */
  lineLinks?: ({ tangentAt: number } | null)[]
  /** 每个顶点字母相对默认位置(顶点上方)的拖拽偏移(归一化)，用于避免遮挡 */
  labelOffsets?: { dx: number; dy: number }[]
  /** 每个面的样式覆盖（填充色/透明度/隐藏该面），索引与面表一致 */
  faceStyles?: ({ fill?: string; opacity?: number; hidden?: boolean } | null)[]
  /** 自由建模：自定义拓扑（顶点用 points），启用后覆盖该类型默认的边/面 */
  mesh?: { edges: [number, number, number][]; faces: number[][] }
  /** 圆弧 / 椭圆弧图元（球、圆锥、圆台、圆柱的底面、画弧的题）。
   *  数学图形原本只有"顶点 + 直边"，一条圆底弧得用七八段折线近似；存成弧之后是一条真曲线，
   *  拖 rx/ry 就能改大小。坐标与 points 同一套：cx/cy/rx/ry 归一化到 0~1，角度用弧度。 */
  arcs?: FigureArc[]
  /** 由「图片转图形」生成时的识别上下文 —— 只用来「回到识别弹窗继续编辑」：
   *  顶点 / 边 / 字母本来就在本元素上（points / mesh.edges / vlabels / labelOffsets），这里不重复存。
   *  老存档没有这个字段，属性面板会据此隐藏「继续编辑」入口。 */
  vectorizeCtx?: {
    /** 原图（data URL 或相对路径） */
    src: string
    imgW: number
    imgH: number
    /** 识别框在原图里的位置（像素） */
    box: [number, number, number, number]
  }
  /** 自定义函数（空白）：表达式 + 定义域/值域 + 网格/坐标轴开关。
   *  表达式语法见 mathPlot.compileExpr（+ − * / ^、括号、pi/e、sin/cos/ln/sqrt…，支持 2x 这种隐式乘法） */
  custom?: {
    /** 单条表达式（旧存档） */
    expr?: string
    /** 多条函数：每条可单独设颜色 / 虚实 / 粗细（新） */
    lines?: import('@/composables/mathPlot').CustomFnLine[]
    /** 定义域 */
    x0: number
    x1: number
    /** 值域（也就是显示窗口的 y 范围） */
    y0: number
    y1: number
    grid?: boolean
    axes?: boolean
  }
  /** **平面图形的控制点**（归一化 0..1，随元素框缩放）：
   *  平行四边形 = [B, D]（A 固定，两条邻边 → 边长与夹角）；
   *  圆弧（圆心+圆心角）= [圆心, 起点, 终点]；过三点的弧 = [A, B, C]；
   *  指定半径的圆 = [圆心, 圆上一点]。半径/长度一律在**像素**里算，圆不会被压扁。
   *  不填 → 用 planeCtrl 里那套默认值（老图元外观与以前逐字相同）。 */
  ctrl?: { x: number; y: number }[]
  /** 圆弧的**圆心角**（度，带符号，可到 ±360）：两个端点定不出"长弧还是短弧"，所以单独存一个数。
   *  不填 → 按 (−180,180] 的短弧解释。 */
  arcSweep?: number
  /** 自定义分段函数：每段一个表达式 + 一个区间，端点取到画实心点、取不到画空心点。
   *  表达式语法同 custom（见 mathPlot.compileExpr） */
  pw?: import('@/composables/mathPlot').PiecewiseFn
  /** 由「三维立体图」生成时的模型上下文 —— 用来「回到弹窗继续改视角 / 改模型」。
   *  投影结果（points / mesh / vlabels）本来就在本元素上，这里存的是**源模型**。 */
  geom3d?: {
    /** 三维模型（Geom3D 的 JSON），弹窗里原样还原 */
    model: Record<string, unknown>
    azim: number
    elev: number
  }
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

/** 合并单元格：锚点在 (r,c)，向右 cs 列、向下 rs 行（被覆盖的格子照旧留在 rows 里，但不渲染） */
export interface TableMerge { r: number; c: number; rs: number; cs: number }

export interface TableElement extends ElementBase {
  type: 'table'
  /** rows[0] 为表头 */
  rows: string[][]
  /** 合并单元格（教材表格必需：左列跨行、标题跨列）。不写 = 不合并，老存档照旧 ✓ */
  merges?: TableMerge[]
  /** 表标题，如「表 4-1」：居中显示在表格上方，跨全宽 */
  caption?: string
  /** 格内 {{fig:kind}} 图形的默认高度(px)；不写用内置默认。标记里写 :数字 仍优先 */
  figHeight?: number
  /** 边框画法：all=全网格（默认）；three=**三线表**（只画顶/表头下/底三条，教材常用） */
  borderMode?: 'all' | 'three'
  /** 各列宽度（px）—— PPT 导入时来自表格的 gridCol ✓；不写=等分（老存档照旧 ✓） */
  colWidths?: number[]
  /** 逐格文字色：键 "行-列"（如 "0-2"）→ 颜色 ✓。用键而不是数组，是为了**对合并单元格安全** ✓ */
  cellColors?: Record<string, string>
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
  // ---- 段落 / 项目符号（与 TextElement 同一套，混排也能用）----
  bullet?: BulletKind
  bulletIndent?: number
  indent?: number
  paraBefore?: number
  paraAfter?: number
}

export interface ImageElement extends ElementBase {
  type: 'image'
  src: string
  /** fill=拉伸填满（可变形，配合拖边单向拉伸）；contain=完整显示（留白）；cover=裁切填满 */
  fit: 'cover' | 'contain' | 'fill'
  /** 发光（PowerPoint 图片特效）：颜色 + 强度(px，drop-shadow 模糊半径) */
  glowColor?: string
  glowSize?: number
  /** 映像（PowerPoint 图片特效）：none=无 tight=紧 medium=中 loose=松 */
  reflection?: 'none' | 'tight' | 'medium' | 'loose'
  /** 柔化边缘（px，值越大边缘越淡出） */
  softEdge?: number

  // ---- 图片调整（PowerPoint「图片格式 → 校正 / 颜色」那一套，全部走 CSS filter，非破坏性）----
  // 默认值：亮度/对比度/饱和度 100，色调 0，其余 0/无 —— 不设或等于默认值时不产生任何滤镜
  /** 亮度 %（100 = 原图） */
  brightness?: number
  /** 对比度 %（100 = 原图） */
  contrast?: number
  /** 饱和度 %（100 = 原图，0 = 灰度） */
  saturate?: number
  /** 色调旋转（度，-180~180） */
  hue?: number
  /** 重新着色 */
  recolor?: 'none' | 'gray' | 'sepia' | 'invert' | 'wash'
  /** 虚化（px） */
  blur?: number
  /** 水平翻转 */
  flipH?: boolean
  /** 垂直翻转 */
  flipV?: boolean
  /** 圆角（px，默认 4） */
  radius?: number

  // ---- 阴影（PowerPoint「图片格式 → 阴影」：预设 + 六个参数）----
  /** 阴影预设 */
  shadowPreset?: 'none' | 'outer' | 'outerStrong' | 'inner'
  /** 阴影颜色（默认 #000000） */
  shadowColor?: string
  /** 阴影透明度 0~1（默认 0.4） */
  shadowAlpha?: number
  /** 阴影大小 px（外阴影=扩散，内阴影=扩展） */
  shadowSize?: number
  /** 阴影模糊 px */
  shadowBlur?: number
  /** 阴影角度（度，0=向右、90=向下） */
  shadowAngle?: number
  /** 阴影距离 px */
  shadowDist?: number

  // ---- 映像详细参数（预设仍用 reflection）----
  /** 映像透明度 0~1 */
  reflAlpha?: number
  /** 映像距离 px（与图片的间隙） */
  reflDist?: number

  // ---- 发光透明度 ----
  /** 发光透明度 0~1 */
  glowAlpha?: number

  // ---- 三维旋转（预设）----
  /** 三维旋转预设 */
  rot3d?: 'none' | 'perspective' | 'isometric' | 'tiltUp' | 'tiltDown' | 'tiltLeft' | 'tiltRight'

  /** 裁剪为形状（PowerPoint「裁剪 → 裁剪为形状」）：none=原样 */
  shapeMask?: ShapeMaskId
  /**
   * 非破坏性裁剪（PowerPoint「裁剪」）：四边各裁掉多少，比例 0~0.9。
   * **不重编码图片** —— 随时可以改回来，这是跟「图片编辑器」里那种把结果烤进数据的裁剪的区别。
   */
  crop?: { l: number; r: number; t: number; b: number }
}

/** 裁剪为形状的形状清单 */
export type ShapeMaskId =
  | 'none' | 'rounded' | 'circle' | 'ellipse' | 'triangle' | 'diamond'
  | 'pentagon' | 'hexagon' | 'star' | 'arrow' | 'heart' | 'parallelogram'

/** 形状的 CSS：圆/椭圆用 border-radius（边缘更平滑），其余用 clip-path */
export const SHAPE_MASKS: { v: ShapeMaskId; label: string; css: string }[] = [
  { v: 'none', label: '原图（不裁剪）', css: '' },
  { v: 'rounded', label: '圆角矩形', css: 'border-radius:14px' },
  { v: 'circle', label: '圆形', css: 'border-radius:50%' },
  { v: 'ellipse', label: '椭圆', css: 'border-radius:50%' },
  { v: 'triangle', label: '三角形', css: 'clip-path:polygon(50% 2%, 98% 98%, 2% 98%)' },
  { v: 'diamond', label: '菱形', css: 'clip-path:polygon(50% 1%, 99% 50%, 50% 99%, 1% 50%)' },
  { v: 'pentagon', label: '五边形', css: 'clip-path:polygon(50% 1%, 99% 37%, 81% 98%, 19% 98%, 1% 37%)' },
  { v: 'hexagon', label: '六边形', css: 'clip-path:polygon(25% 2%, 75% 2%, 99% 50%, 75% 98%, 25% 98%, 1% 50%)' },
  { v: 'star', label: '五角星', css: 'clip-path:polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)' },
  { v: 'arrow', label: '箭头', css: 'clip-path:polygon(0% 28%, 62% 28%, 62% 4%, 100% 50%, 62% 96%, 62% 72%, 0% 72%)' },
  { v: 'heart', label: '心形', css: 'clip-path:polygon(50% 100%, 8% 58%, 2% 30%, 12% 10%, 32% 6%, 50% 22%, 68% 6%, 88% 10%, 98% 30%, 92% 58%)' },
  { v: 'parallelogram', label: '平行四边形', css: 'clip-path:polygon(22% 2%, 100% 2%, 78% 98%, 0% 98%)' },
]

/** 阴影预设 */
export const IMAGE_SHADOWS: { v: NonNullable<ImageElement['shadowPreset']>; label: string; d: [number, number, number, number] }[] = [
  //                                  颜色, 透明度, 大小, 模糊, 角度, 距离   —— d = [alpha, size, blur, dist]
  { v: 'none', label: '无阴影', d: [0, 0, 0, 0] },
  { v: 'outer', label: '外部·中', d: [0.4, 0, 10, 5] },
  { v: 'outerStrong', label: '外部·强', d: [0.6, 0, 20, 8] },
  { v: 'inner', label: '内部', d: [0.45, 0, 10, 5] },
]

/** 三维旋转预设：perspective(px) + rotateX/rotateY/rotateZ(deg) */
export const IMAGE_ROT3D: { v: NonNullable<ImageElement['rot3d']>; label: string; css: string }[] = [
  { v: 'none', label: '无旋转', css: '' },
  { v: 'perspective', label: '透视', css: 'perspective(900px) rotateY(-22deg)' },
  { v: 'isometric', label: '等轴测', css: 'perspective(900px) rotateX(18deg) rotateY(-24deg)' },
  { v: 'tiltUp', label: '上倾斜', css: 'perspective(900px) rotateX(24deg)' },
  { v: 'tiltDown', label: '下倾斜', css: 'perspective(900px) rotateX(-24deg)' },
  { v: 'tiltLeft', label: '左倾斜', css: 'perspective(900px) rotateY(-24deg)' },
  { v: 'tiltRight', label: '右倾斜', css: 'perspective(900px) rotateY(24deg)' },
]

/** 重新着色预设（PowerPoint「颜色 → 重新着色」） */
export const IMAGE_RECOLORS: { v: NonNullable<ImageElement['recolor']>; label: string }[] = [
  { v: 'none', label: '不重新着色' },
  { v: 'gray', label: '灰度' },
  { v: 'wash', label: '冲蚀（淡彩）' },
  { v: 'sepia', label: '棕褐（怀旧）' },
  { v: 'invert', label: '反色' },
]

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

/**
 * 裁剪为形状的 CSS —— **必须加在"裁剪框"那层**，不能加在 <img> 上：
 * 非破坏性裁剪会把图片放大到 100% 以上，蒙版的百分比如果按放大后的图算就对不上了。
 */
export function imageMaskCss(el: Pick<ImageElement, 'shapeMask' | 'radius'>): string {
  const mask = SHAPE_MASKS.find((m) => m.v === el.shapeMask)
  if (mask && mask.css) return mask.css + '; overflow:hidden'
  if (el.radius != null && el.radius !== 4) return 'border-radius:' + el.radius + 'px; overflow:hidden'
  return 'overflow:hidden'
}

/** 给颜色叠一个透明度：把 #rgb / #rrggbb 转成 rgba()，其它写法原样返回 */
export function withAlpha(color: string, a: number): string {
  const c = (color || '').trim()
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c)
  if (!m) return c || 'rgba(0,0,0,' + a + ')'
  let hex = m[1]
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'
}

/** 生成图片特效 CSS（编辑器画布与 Reveal 导出共用，保证两端一致）。
 *  发光=drop-shadow 贴合透明形状；映像=-webkit-box-reflect（Firefox 优雅降级为无反射）；
 *  柔化边缘=双侧 mask 渐隐，保留矩形轮廓。 */
export function imageEffectCss(
  el: Pick<
    ImageElement,
    | 'glowColor' | 'glowSize' | 'reflection' | 'softEdge'
    | 'brightness' | 'contrast' | 'saturate' | 'hue' | 'recolor' | 'blur'
    | 'flipH' | 'flipV' | 'radius'
    | 'shadowPreset' | 'shadowColor' | 'shadowAlpha' | 'shadowSize' | 'shadowBlur' | 'shadowAngle' | 'shadowDist'
    | 'reflAlpha' | 'reflDist' | 'glowAlpha' | 'rot3d'
    | 'shapeMask' | 'crop'
  >,
): string {
  const css: string[] = []
  // ⚠ 所有 filter 必须**合成一条** —— 写成两条会互相覆盖（原来发光那条是单独写的）
  const filters: string[] = []
  if (el.glowSize && el.glowColor) {
    filters.push('drop-shadow(0 0 ' + el.glowSize + 'px ' + withAlpha(el.glowColor, el.glowAlpha ?? 1) + ')')
  }
  if (el.brightness != null && el.brightness !== 100) filters.push('brightness(' + el.brightness + '%)')
  if (el.contrast != null && el.contrast !== 100) filters.push('contrast(' + el.contrast + '%)')
  if (el.saturate != null && el.saturate !== 100) filters.push('saturate(' + el.saturate + '%)')
  if (el.hue) filters.push('hue-rotate(' + el.hue + 'deg)')
  if (el.blur) filters.push('blur(' + el.blur + 'px)')
  if (el.recolor === 'gray') filters.push('grayscale(1)')
  else if (el.recolor === 'sepia') filters.push('sepia(1)')
  else if (el.recolor === 'invert') filters.push('invert(1)')
  else if (el.recolor === 'wash') filters.push('saturate(0.4) brightness(1.1)')
  if (filters.length) css.push('filter: ' + filters.join(' '))

  // ⚠ transform 同样只能写一条 —— 翻转和三维旋转必须**合并**，否则后写的覆盖先写的
  const tx: string[] = []
  const rot = IMAGE_ROT3D.find((r) => r.v === el.rot3d)
  if (rot && rot.css) tx.push(rot.css)
  if (el.flipH || el.flipV) tx.push('scale(' + (el.flipH ? -1 : 1) + ',' + (el.flipV ? -1 : 1) + ')')
  if (tx.length) css.push('transform: ' + tx.join(' '))

  if (el.radius != null && el.radius !== 4) css.push('border-radius: ' + el.radius + 'px')

  // 非破坏性裁剪：把裁剩下的那块放大到填满元素框（配合外层 overflow:hidden）。
  // w/h 用百分比、偏移用负 margin —— 纯 CSS，不碰原图数据。
  const cr = el.crop
  if (cr) {
    const cw = Math.max(0.1, 1 - (cr.l || 0) - (cr.r || 0))
    const ch = Math.max(0.1, 1 - (cr.t || 0) - (cr.b || 0))
    if (cw < 0.999 || ch < 0.999) {
      css.push('width:' + (100 / cw).toFixed(3) + '%')
      css.push('height:' + (100 / ch).toFixed(3) + '%')
      css.push('margin-left:' + (-((cr.l || 0) / cw) * 100).toFixed(3) + '%')
      css.push('margin-top:' + (-((cr.t || 0) / ch) * 100).toFixed(3) + '%')
      css.push('object-fit:fill') // 裁剪框要对准像素，必须让图正好铺满
    }
  }

  // 阴影（PowerPoint 那六项）：角度 + 距离 → 偏移；大小 → 扩散；内外由 inset 区分。
  // 用 box-shadow 而不是 drop-shadow，是为了拿到"大小(扩散)"和"内部"这两项。
  if (el.shadowPreset && el.shadowPreset !== 'none') {
    const inner = el.shadowPreset === 'inner'
    const a = el.shadowAlpha ?? (inner ? 0.45 : 0.4)
    const size = el.shadowSize ?? 0
    const blur = el.shadowBlur ?? 10
    const ang = ((el.shadowAngle ?? 90) * Math.PI) / 180
    const dist = el.shadowDist ?? 5
    const dx = Math.round(Math.cos(ang) * dist)
    const dy = Math.round(Math.sin(ang) * dist)
    css.push('box-shadow: ' + (inner ? 'inset ' : '') + dx + 'px ' + dy + 'px ' + blur + 'px ' + size + 'px ' +
      withAlpha(el.shadowColor || '#000000', a))
  }

  if (el.reflection && el.reflection !== 'none') {
    const g = REFLECT_PRESETS[el.reflection] ?? [0, 'rgba(0,0,0,0.4)']
    const dist = el.reflDist ?? g[0]
    const alpha = el.reflAlpha ?? 0.4
    // -webkit-box-reflect 只支持"间隙 + 渐变遮罩"，所以透明度/距离可调，大小/模糊没有对应参数
    css.push('-webkit-box-reflect: below ' + dist + 'px linear-gradient(to bottom, rgba(0,0,0,' + alpha + '), transparent)')
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

/** 入场动画（PowerPoint「动画 → 进入」那一组） */
export type AnimIn = 'none' | 'fade' | 'left' | 'right' | 'top' | 'bottom' | 'zoom' | 'grow' | 'shrink' | 'rotate'

/**
 * 入场效果表。
 * - `reveal` 是 Reveal **内置**的 fragment 类名，导出时直接拼上去（不自己写 JS ✗）。
 *   注意 Reveal 的语义是按"位移方向"命名的：fade-up = 从下方进来、fade-down = 从上方、
 *   fade-left = 从左侧进来、fade-right = 从右侧进来（对着它的 transform 核过 ✓）。
 * - `cls` 是编辑器预览用的 CSS 类（定义在 styles/anim.css），两边观感保持一致。
 */
export const ANIM_INS: { v: AnimIn; label: string; reveal: string; cls: string }[] = [
  { v: 'none', label: '无', reveal: '', cls: '' },
  { v: 'fade', label: '淡入', reveal: '', cls: 'anim-in-fade' },
  { v: 'left', label: '从左飞入', reveal: 'fade-left', cls: 'anim-in-left' },
  { v: 'right', label: '从右飞入', reveal: 'fade-right', cls: 'anim-in-right' },
  { v: 'top', label: '从上方掉入', reveal: 'fade-down', cls: 'anim-in-top' },
  { v: 'bottom', label: '从下方升起', reveal: 'fade-up', cls: 'anim-in-bottom' },
  { v: 'zoom', label: '放大进入', reveal: 'zoom-in', cls: 'anim-in-zoom' },
  { v: 'grow', label: '由小变大', reveal: 'grow', cls: 'anim-in-grow' },
  { v: 'shrink', label: '由大变小', reveal: 'shrink', cls: 'anim-in-shrink' },
  { v: 'rotate', label: '旋转进入', reveal: 'fade-up', cls: 'anim-in-rotate' },
]

/** 强调动画（PowerPoint「动画 → 强调」那一组）—— 入场之后自动接着播一次 */
export type AnimEm = 'none' | 'pulse' | 'shake' | 'spin' | 'grow' | 'shrink' | 'flash' | 'bounce'

export const ANIM_EMS: { v: AnimEm; label: string; cls: string }[] = [
  { v: 'none', label: '无', cls: '' },
  { v: 'pulse', label: '脉冲（放大回弹）', cls: 'anim-em-pulse' },
  { v: 'bounce', label: '弹跳', cls: 'anim-em-bounce' },
  { v: 'shake', label: '抖动', cls: 'anim-em-shake' },
  { v: 'spin', label: '旋转一圈', cls: 'anim-em-spin' },
  { v: 'grow', label: '放大', cls: 'anim-em-grow' },
  { v: 'shrink', label: '缩小', cls: 'anim-em-shrink' },
  { v: 'flash', label: '闪烁', cls: 'anim-em-flash' },
]

export function animEmphasisClass(kind: AnimEm | undefined): string {
  return ANIM_EMS.find((a) => a.v === kind)?.cls ?? ''
}
/** 时长/延迟：写在元素上，编辑器与导出用同一组 CSS 变量 */
export function animTimingStyle(el: { animDuration?: number; animDelay?: number }): string {
  const d = el.animDuration && el.animDuration > 0 ? el.animDuration : 550
  const l = el.animDelay && el.animDelay > 0 ? el.animDelay : 0
  return '--anim-dur:' + d + 'ms;--anim-delay:' + l + 'ms'
}

/** 退场动画（PPT「动画 → 退出」）—— 由"退出触发点"决定时机：导出里是一个零尺寸 fragment，点一下它才退场 */
export type AnimOut = 'none' | 'fade' | 'left' | 'right' | 'top' | 'bottom' | 'zoom' | 'shrink'

export const ANIM_OUTS: { v: AnimOut; label: string; cls: string }[] = [
  { v: 'none', label: '无', cls: '' },
  { v: 'fade', label: '淡出', cls: 'anim-out-fade' },
  { v: 'left', label: '向左飞出', cls: 'anim-out-left' },
  { v: 'right', label: '向右飞出', cls: 'anim-out-right' },
  { v: 'top', label: '向上飞出', cls: 'anim-out-top' },
  { v: 'bottom', label: '向下飞出', cls: 'anim-out-bottom' },
  { v: 'zoom', label: '放大消失', cls: 'anim-out-zoom' },
  { v: 'shrink', label: '缩小消失', cls: 'anim-out-shrink' },
]

export function animOutClass(kind: AnimOut | undefined): string {
  return ANIM_OUTS.find((a) => a.v === kind)?.cls ?? ''
}

/** 取 Reveal 导出要拼的 fragment 类名（空串表示用默认淡入） */
export function animRevealClass(kind: AnimIn | undefined): string {
  return ANIM_INS.find((a) => a.v === kind)?.reveal ?? ''
}
/** 取编辑器预览用的 CSS 类名 */
export function animEditorClass(kind: AnimIn | undefined): string {
  return ANIM_INS.find((a) => a.v === kind)?.cls ?? ''
}

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
  /** 隐藏幻灯片：列表里变暗，演示 / 导出时跳过（PowerPoint 同名功能） */
  hidden?: boolean
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
/**
 * 直线 / 箭头的**默认长度** ✓（用户要求 20mm ✓）。
 *
 * 换算 ✓：画布 1920×1080 = 10in × 5.625in（16:9）→ **192 px/英寸** ✓ → 1mm = 7.559px ✓
 * → 20mm = **151px** ✓（原先写死 200px ≈ 26.5mm ✗，偏长 ✓）。
 */
const LINE_DEFAULT_W = Math.round((20 * 192) / 25.4)

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
        w: rect.w ?? LINE_DEFAULT_W,
        h: rect.h ?? 2,
        stroke: '#1a1a1a',
        strokeWidth: 3,
      }
    case 'arrow':
      return {
        ...base, id, rot, type: 'arrow',
        w: rect.w ?? LINE_DEFAULT_W,
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
