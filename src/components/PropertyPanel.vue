<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { saveFigureToLibrary } from '@/composables/useFigureLibrary'
import AppIcon from './AppIcon.vue'
import { useDeckStore } from '@/stores/deck'
import { addonState } from '@/addons/registry'
import type {
  ArrowElement, ChartElement, ChartType, DesmosElement, EmbedElement, EmbedKind, GeoGebraElement,
  GgbApp, IconElement, ImageElement, LineElement, MathElement, MathFigureElement,
  MathFigureKind, PenElement, RichTextElement, ShapeElement, SlideElement, TableElement, TextElement, WordArtPreset,
} from '@/types'
import type { AnimEm, AnimIn, AnimOut, BulletKind } from '@/types'
import { playAnimPreview } from '@/ui/animPreview'
import { openFigPalette } from '@/ui/figPalette'
import { ANIM_EMS, ANIM_INS, ANIM_OUTS, ARROW_HEADS, BULLETS, CHART_TYPE_OPTIONS, FONT_OPTIONS, GRAPHIC_TYPES, ICON_LIBRARY, IMAGE_RECOLORS, IMAGE_REFLECTIONS, IMAGE_ROT3D, IMAGE_SHADOWS, SHAPE_MASKS, LINE_STYLES, MATH_FIGURE_CATS, MATH_FIGURE_OPTIONS, SHADOW_OPTIONS, SLIDE_TRANSITIONS, WORDART_PRESETS } from '@/types'
import { captureDesmosState } from '@/composables/useDesmos'
import { layoutTable, mergeAt, unmergeAt } from '@/composables/tableLayout'
import { openGgbSuite } from '@/ui/ggbEditor'
import { openFormulaLibrary } from '@/ui/formulaLibrary'
import { openShapeEdit } from '@/ui/shapeEditor'
import { compileExpr, figureParams, withParams } from '@/composables/mathPlot'
import { SOLID_VCOUNT, solidEdges, solidFaces, solidFacesAll, solidVerts, type EdgeStyle, type FaceStyle } from '@/composables/solid3d'
import { solidSel } from '@/composables/solidSel'
import { openImageEditor } from '@/ui/imageEditor'
import { openVectorize } from '@/ui/vectorize'
import { openGeom3D } from '@/ui/geom3d'
import { openAsyExport } from '@/ui/asyExport'
import ColorSwatches from './ColorSwatches.vue'
import { saveTextFile } from '@/composables/useTauri'

const store = useDeckStore()
/** addon 开关（关掉后入口隐藏、代码不加载） */
function addonOn(id: string) { return addonState.enabled[id] !== false }
const activeTab = ref<'props' | 'layers'>('props')
const el = computed(() => store.selectedElement)

/** 属性面板的实时编辑不写入历史（避免每敲一个字就产生一条撤销记录） */
function patch(p: Partial<SlideElement>) {
  if (!el.value) return
  store.updateElement(el.value.id, p)
}
function num(v: string | number, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

/** 非破坏性裁剪：写某一边裁掉的比例（0~0.9） */
function setCrop(side: 'l' | 'r' | 't' | 'b', percent: number) {
  const cur = image.value?.crop || { l: 0, r: 0, t: 0, b: 0 }
  patch({ crop: { ...cur, [side]: Math.max(0, Math.min(90, percent)) / 100 } } as Partial<SlideElement>)
}
const cropPct = (v?: number) => Math.round((v || 0) * 100)
const hasCrop = computed(() => {
  const c = image.value?.crop
  return !!c && (c.l > 0 || c.r > 0 || c.t > 0 || c.b > 0)
})

/** 选阴影预设时把该预设的四个数字一并写进去（PPT 就是这个行为：预设会带出参数） */
function applyShadowPreset(v: string) {
  const p = IMAGE_SHADOWS.find((s) => s.v === v)
  patch({
    shadowPreset: v,
    ...(p ? { shadowAlpha: p.d[0], shadowSize: p.d[1], shadowBlur: p.d[2], shadowDist: p.d[3] } : {}),
  } as Partial<SlideElement>)
}

/** 柔化边缘预设（磅 → px，1 磅≈1.33px，这里取整到常用值） */
const SOFT_EDGE_PRESETS = [0, 2, 5, 10, 20, 40, 80]

const isText = computed(() => el.value?.type === 'text')
const isShape = computed(() => el.value?.type === 'shape')
const isImage = computed(() => el.value?.type === 'image')
const isMath = computed(() => el.value?.type === 'math')
const isGgb = computed(() => el.value?.type === 'geogebra')
const isDsm = computed(() => el.value?.type === 'desmos')
const isLine = computed(() => el.value?.type === 'line')
const isArrow = computed(() => el.value?.type === 'arrow')
const arrowEl = computed(() => el.value as ArrowElement | undefined)
const isPen = computed(() => el.value?.type === 'pen')
const isMathFig = computed(() => el.value?.type === 'mathfig')

/** 把当前图形（种类 + 参数 + 样式 + 尺寸）存进图形库 */
async function saveFigToLibrary() {
  const m = mathfig.value as unknown as Record<string, unknown> | undefined
  if (!m) return
  const kind = String(m.kind || '')
  const id = await saveFigureToLibrary(m, kind)
  figLibMsg.value = id ? '已存入图形库：' + kind : '存入失败 —— 内容库不可用？'
  window.setTimeout(() => { figLibMsg.value = '' }, 2400)
}
const figLibMsg = ref('')

/** 当前数学图形的可调参数（正弦型的 A/ω/φ、含参二次的 a…），无参数则为空 */
const figParams = computed(() => {
  const m = mathfig.value
  if (!m) return []
  const kind = String(m.kind || '')
  // showIf：只显示当前**用得上**的参数（例如"线3/线4"在条数设为 2 时先藏起来，
  // 否则圆锥曲线 + 4 条线会有近 20 个滑杆，面板没法看）
  const cur = withParams(kind, m.params)
  return figureParams(kind).filter((pr) => !pr.showIf || pr.showIf(cur))
})
function figParamVal(key: string, def: number) {
  const v = mathfig.value?.params?.[key]
  return typeof v === 'number' ? v : def
}
function setFigParam(key: string, v: number) {
  patch({ params: { ...(mathfig.value?.params || {}), [key]: v } } as Partial<SlideElement>)
}
/** 参数输入：**只在能解析成数字时才提交**。
 *  ⚠ 原来直接 num(...) 提交 —— type=number 里刚敲一个负号时 value 是空串，
 *  被判成"非法 → 用默认值"，再回写 :value，**负号当场被抹掉 → 压根输不了负数**（用户实报）。
 *  中间状态（空串 / 只有 "-" / "."）一律不提交、也不回写，让用户把数打完。 */
function setFigParamSoft(key: string, raw: string) {
  const t = String(raw).trim()
  if (t === '' || t === '-' || t === '.' || t === '-.' || t === '+') return
  const v = num(t, NaN)
  if (!Number.isFinite(v)) return
  setFigParam(key, v)
}
// ── 圆锥曲线 + 多条直线：**椭圆与每条线可以各自设颜色** ──
/** 有几条线（0 表示这个图元没开"多条线"，颜色行就都不显示） */
const lineN = computed(() => Math.max(0, Math.min(4, Math.round(figParamVal('n', 0)))))
const hasLineParams = computed(() => figParams.value.some((p) => p.key === 'n'))
const conicColorVal = computed(() => mathfig.value?.conicStroke || mathfig.value?.stroke || '#1a1a1a')
function lineColorVal(i: number) {
  return (mathfig.value?.lineColors || [])[i] || mathfig.value?.stroke || '#1a1a1a'
}
function setConicColor(v: string) { patch({ conicStroke: v } as Partial<SlideElement>) }
// ── 圆锥曲线的标注点：名称是字符串，所以存在元素的 pointLabels 里（点个数由 params.pn 控制）──
const pointN = computed(() => Math.max(0, Math.min(6, Math.round(figParamVal('pn', 0)))))
function pointLabelVal(i: number) { return (mathfig.value?.pointLabels || [])[i] || '' }
function setPointLabel(i: number, v: string) {
  const a: (string | null)[] = [...(mathfig.value?.pointLabels || [])]
  while (a.length <= i) a.push(null)
  a[i] = v.trim() ? v.trim() : null
  patch({ pointLabels: a } as Partial<SlideElement>)
}
function setLineColor(i: number, v: string) {
  const a: (string | null)[] = [...(mathfig.value?.lineColors || [])]
  while (a.length <= i) a.push(null)
  a[i] = v
  patch({ lineColors: a } as Partial<SlideElement>)
}
const isGraphic = computed(() => isShape.value || isLine.value || isArrow.value || isPen.value || isMathFig.value)
function isCurrentGraphic(g: { v: string; cat: string }) {
  const t = el.value
  if (!t) return false
  const any = t as any
  if (g.cat === 'shape') return t.type === 'shape' && any.shape === g.v
  if (g.cat === 'line' || g.cat === 'arrow') return t.type === g.cat
  return t.type === 'mathfig' && any.kind === g.v
}
const isChart = computed(() => el.value?.type === 'chart')
const isTable = computed(() => el.value?.type === 'table')
const isIcon = computed(() => el.value?.type === 'icon')
const isEmbed = computed(() => el.value?.type === 'embed')
const isRichtex = computed(() => el.value?.type === 'richtex')

const text = computed(() => el.value as TextElement | undefined)
const shape = computed(() => el.value as ShapeElement | undefined)
const image = computed(() => el.value as ImageElement | undefined)
const math = computed(() => el.value as MathElement | undefined)
const ggb = computed(() => el.value as GeoGebraElement | undefined)
const dsm = computed(() => el.value as DesmosElement | undefined)
const line = computed(() => el.value as LineElement | undefined)
const arrow = computed(() => el.value as ArrowElement | undefined)
const pen = computed(() => el.value as PenElement | undefined)
const mathfig = computed(() => el.value as MathFigureElement | undefined)
/** 是否有"顶点"概念（立体几何 / 复刻图形 / 可拖顶点图形）—— 有才显示「显示点」开关 */
const hasVertices = computed(() => {
  const k = mathfig.value?.kind
  if (!k) return false
  return !!(SOLID_VCOUNT[k as keyof typeof SOLID_VCOUNT] || mathfig.value?.points?.length)
})
const isEditableFig = computed(() => mathfig.value?.kind === 'polygon' || mathfig.value?.kind === 'bezier')
/** 「图片转图形」生成的元素：带着原图和识别框回到那个弹窗，继续改顶点 / 边 / 字母 */
function reopenVectorize() {
  const m = mathfig.value
  if (!m?.vectorizeCtx) return
  openVectorize(m.vectorizeCtx.src, null, m.id)
}

/** 自定义函数：当前所有曲线（新存档用 lines[]，旧存档回退到单条 expr） */
const customLines = computed(() => {
  const c = mathfig.value?.custom
  if (!c) return [] as { expr: string; color?: string; dash?: 'solid' | 'dash' | 'dot'; width?: number; visible?: boolean }[]
  if (c.lines && c.lines.length) return c.lines
  return [{ expr: c.expr || '' }]
})
/** 自定义函数：**只要有一条写错就提示**（写错的那条不画，其它条照画） */
const customBad = computed(() => {
  if (mathfig.value?.kind !== 'custom') return false
  return customLines.value.some((l) => l.visible !== false && compileExpr(l.expr || '') === null)
})
function setLines(next: { expr: string; color?: string; dash?: 'solid' | 'dash' | 'dot'; width?: number; visible?: boolean }[]) {
  setCustom({ lines: next, expr: undefined } as never)
}
/** 改第 i 条曲线的某一项 */
function setLine(i: number, patch: Record<string, unknown>) {
  const list = customLines.value.map((x) => ({ ...x }))
  if (!list[i]) return
  list[i] = { ...list[i], ...patch } as never
  setLines(list as never)
}
function addLine() {
  const list = customLines.value.map((x) => ({ ...x }))
  const palette = ['#1668e0', '#e0402f', '#0f9d58', '#8e44ad', '#e08b16', '#1a1a1a']
  list.push({ expr: '', color: palette[list.length % palette.length] })
  setLines(list as never)
}
function removeLine(i: number) {
  const list = customLines.value.filter((_, k) => k !== i).map((x) => ({ ...x }))
  setLines((list.length ? list : [{ expr: '' }]) as never)
}
/** 改自定义函数的某一项 */
function setCustom(p: Partial<NonNullable<MathFigureElement['custom']>>) {
  const cur = mathfig.value?.custom || { expr: 'x^2', x0: -4, x1: 4, y0: -2, y1: 6 }
  patch({ custom: { ...cur, ...p } } as Partial<SlideElement>)
}

/** 「三维立体图」生成的元素：带着源模型回到那个弹窗，继续改视角 / 改模型 */
function reopenGeom3D() {
  const m = mathfig.value
  if (!m?.geom3d) return
  openGeom3D(m.id)
}

/** 导出 Asymptote（二维）：代码在弹窗里给，可复制 / 存 .asy */
function openAsy() {
  const m = mathfig.value
  if (!m) return
  openAsyExport(m)
}

const isSolid = computed(() => !!mathfig.value && !!SOLID_VCOUNT[mathfig.value.kind])
const vertCount = computed(() => mathfig.value ? (SOLID_VCOUNT[mathfig.value.kind] || 0) : 0)
const edgeCount = computed(() => mathfig.value && isSolid.value ? solidEdges(mathfig.value.kind).length : 0)
function vLetter(i: number) { return String.fromCharCode(65 + i) }
function vLabelAt(i: number) { return (mathfig.value?.vlabels?.[i]) || '' }
function setVLabel(i: number, v: string) {
  const m = mathfig.value; if (!m) return
  const arr = [...(m.vlabels || [])]
  while (arr.length < vertCount.value) arr.push(null)
  arr[i] = v || null
  patch({ vlabels: arr } as Partial<SlideElement>)
}
function edgeStyleAt(i: number): EdgeStyle | null { return mathfig.value?.edgeStyles?.[i] || null }
function edgeDashAt(i: number): 'solid' | 'dash' | 'dot' {
  const d = edgeStyleAt(i)?.dash
  if (d) return d
  const l = mathfig.value ? solidEdges(mathfig.value.kind) : []
  return (l[i] && l[i][2] === 1) ? 'dash' : 'solid'
}
function setEdgePatch(i: number, patchObj: Partial<EdgeStyle>) {
  const m = mathfig.value; if (!m) return
  const arr = [...(m.edgeStyles || [])]
  while (arr.length < edgeCount.value) arr.push(null)
  arr[i] = { ...(arr[i] || {}), ...patchObj }
  patch({ edgeStyles: arr } as Partial<SlideElement>)
}
function setEdgeDash(i: number, v: string) { setEdgePatch(i, { dash: v as EdgeStyle['dash'] }) }
function setEdgeWidth(i: number, w: number) { setEdgePatch(i, { width: w }) }
function setEdgeColor(i: number, c: string) { setEdgePatch(i, { color: c }) }
function dashCn(v: string) { return v === 'dash' ? '虚线' : v === 'dot' ? '点线' : '实线' }

// ---- 面样式（填充色 / 透明度 / 隐藏）----
const faceCount = computed(() => (mathfig.value && isSolid.value) ? solidFaces(mathfig.value.kind).length : 0)
function faceStyleAt(i: number): FaceStyle | null { return mathfig.value?.faceStyles?.[i] || null }
function isFaceHidden(i: number) { return !!faceStyleAt(i)?.hidden }
function faceFillAt(i: number) { return faceStyleAt(i)?.fill || mathfig.value?.fill || '#c9d6ea' }
function faceOpacityAt(i: number) { const o = faceStyleAt(i)?.opacity; return typeof o === 'number' ? Math.round(o * 100) : 80 }
function setFacePatch(i: number, obj: Partial<FaceStyle>) {
  const m = mathfig.value; if (!m) return
  const arr = [...(m.faceStyles || [])]
  while (arr.length < faceCount.value) arr.push(null)
  arr[i] = { ...(arr[i] || {}), ...obj }
  patch({ faceStyles: arr } as Partial<SlideElement>)
}
function setFaceFill(i: number, c: string) { setFacePatch(i, { fill: c, hidden: false }) }
function setFaceOpacity(i: number, v: number) { setFacePatch(i, { opacity: Math.max(0, Math.min(1, v / 100)), hidden: false }) }
function toggleFaceHidden(i: number) { setFacePatch(i, { hidden: !isFaceHidden(i) }) }

// ---- 自由建模：增删点 / 连边 / 成面 ----
const meshOn = computed(() => !!mathfig.value?.mesh)
const meshPick = ref<number[]>([])
const vCount = computed(() => {
  const m = mathfig.value
  if (!m) return 0
  if (m.mesh && m.points && m.points.length >= 4) return Math.floor(m.points.length / 2)
  return SOLID_VCOUNT[m.kind] || 0
})
function isPicked(i: number) { return meshPick.value.includes(i) }
function togglePick(i: number) {
  const a = [...meshPick.value]
  const k = a.indexOf(i)
  if (k >= 0) a.splice(k, 1); else a.push(i)
  meshPick.value = a
}
function enableMesh() {
  const m = mathfig.value; if (!m) return
  const edges = solidEdges(m.kind).map(e => [e[0], e[1], e[2]] as [number, number, number])
  const faces = solidFacesAll(m.kind).map(f => [...f])
  const pts = (m.points && m.points.length >= 4) ? [...m.points] : solidVerts(m.kind, m.w, m.h, m.depth)
  meshPick.value = []
  patch({ mesh: { edges, faces }, points: pts } as Partial<SlideElement>)
}
function disableMesh() {
  meshPick.value = []
  patch({ mesh: undefined, edgeStyles: undefined, faceStyles: undefined } as Partial<SlideElement>)
}
function restoreMesh() {
  const m = mathfig.value; if (!m || !m.mesh) return
  const edges = solidEdges(m.kind).map(e => [e[0], e[1], e[2]] as [number, number, number])
  const faces = solidFaces(m.kind).map(f => [...f])
  meshPick.value = []
  patch({ mesh: { edges, faces } } as Partial<SlideElement>)
}
function addVertex() {
  const m = mathfig.value; if (!m || !m.mesh) return
  const pts = [...(m.points || [])]
  const n = Math.floor(pts.length / 2)
  let ax = 0.5, ay = 0.5
  if (n) { ax = 0; ay = 0; for (let i = 0; i < n; i++) { ax += pts[i * 2]; ay += pts[i * 2 + 1] } ax /= n; ay /= n }
  pts.push(Math.max(0.02, Math.min(0.98, ax + 0.1)), Math.max(0.02, Math.min(0.98, ay + 0.1)))
  patch({ points: pts } as Partial<SlideElement>)
}
function delPickedVertices() {
  const m = mathfig.value; if (!m || !m.mesh || !meshPick.value.length) return
  const picks = [...meshPick.value]
  const removed = new Set(picks)
  const pts = [...(m.points || [])]
  for (const i of [...picks].sort((a, b) => b - a)) pts.splice(i * 2, 2)
  const keep = (old: number) => { let s = 0; for (const i of picks) if (i < old) s++; return old - s }
  const edges = m.mesh.edges.filter(e => !removed.has(e[0]) && !removed.has(e[1])).map(e => [keep(e[0]), keep(e[1]), e[2]] as [number, number, number])
  const faces = m.mesh.faces.filter(f => f.every(v => !removed.has(v))).map(f => f.map(keep))
  meshPick.value = []
  patch({ points: pts, mesh: { edges, faces } } as Partial<SlideElement>)
}
function connectPicked() {
  const m = mathfig.value; if (!m || !m.mesh) return
  const pk = meshPick.value
  if (pk.length !== 2) return
  const a = pk[0], b = pk[1]
  if (m.mesh.edges.some(e => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a))) return
  patch({ mesh: { edges: [...m.mesh.edges, [a, b, 0]], faces: m.mesh.faces.map(f => [...f]) } } as Partial<SlideElement>)
  meshPick.value = []
}
function facePicked() {
  const m = mathfig.value; if (!m || !m.mesh) return
  const pk = [...meshPick.value]
  if (pk.length < 3) return
  patch({ mesh: { edges: m.mesh.edges.map(e => [...e] as [number, number, number]), faces: [...m.mesh.faces, pk] } } as Partial<SlideElement>)
  meshPick.value = []
}


const selVertex = computed(() => (mathfig.value && solidSel.elementId === mathfig.value.id) ? solidSel.vertex : null)
const selEdge = computed(() => (mathfig.value && solidSel.elementId === mathfig.value.id) ? solidSel.edge : null)
const selFace = computed(() => (mathfig.value && solidSel.elementId === mathfig.value.id) ? solidSel.face : null)
const selLabel = computed(() => {
  if (selVertex.value != null) return '顶点 ' + vLetter(selVertex.value)
  if (selEdge.value != null) return '边 ' + (selEdge.value + 1)
  if (selFace.value != null) return '面 ' + (selFace.value + 1)
  return ''
})
const vInputs = ref<HTMLInputElement[]>([])
function setVRef(i: number, el: unknown) { (vInputs.value[i] = (el as HTMLInputElement) || (null as any)) }
watch(() => [solidSel.elementId, solidSel.vertex] as const, async () => {
  if (!mathfig.value) return
  if (solidSel.elementId !== mathfig.value.id || solidSel.vertex == null) return
  await nextTick()
  ;(vInputs.value[solidSel.vertex] as HTMLInputElement | undefined)?.focus()
});

/** 当某条边被选中时，通用 线条颜色/线宽 只应用到该边 */
const edgeTarget = computed(() => (mathfig.value && selEdge.value != null) ? selEdge.value : null)
const strokeColorVal = computed(() => edgeTarget.value != null ? (edgeStyleAt(edgeTarget.value)?.color || mathfig.value?.stroke || '') : (mathfig.value?.stroke || ''))
const strokeWidthVal = computed(() => edgeTarget.value != null ? (edgeStyleAt(edgeTarget.value)?.width || mathfig.value?.strokeWidth || 2) : (mathfig.value?.strokeWidth || 2))
function onStrokeColor(v: string) {
  if (edgeTarget.value != null) setEdgeColor(edgeTarget.value, v)
  else patch({ stroke: v } as Partial<SlideElement>)
}
function onStrokeWidth(v: number) {
  if (edgeTarget.value != null) setEdgeWidth(edgeTarget.value, v)
  else patch({ strokeWidth: v } as Partial<SlideElement>)
}



const chart = computed(() => el.value as ChartElement | undefined)
const tableEl = computed(() => el.value as TableElement | undefined)
const iconEl = computed(() => el.value as IconElement | undefined)
const embed = computed(() => el.value as EmbedElement | undefined)
const richtex = computed(() => el.value as RichTextElement | undefined)
/** 设置某一行(lineStyles[i]) 的颜色 / 字体 */
function setLineStyle(i: number, key: 'color' | 'fontFamily', val: string) {
  if (!richtex.value) return
  const ls = Array.isArray(richtex.value.lineStyles) ? richtex.value.lineStyles.map((x) => ({ ...x })) : []
  const cur = ls[i] || (ls[i] = {})
  ;(cur as Record<string, string>)[key] = val
  patch({ lineStyles: ls } as Partial<SlideElement>)
}
// ---- 文本特效（Bento 风格：渐变 / 描边 / 字距 / 行高 / 垂直对齐）辅助 ----
const textGrad = computed(() => text.value?.colorGradient)
function toggleTextFill(mode: 'solid' | 'gradient') {
  if (mode === 'gradient' && !text.value?.colorGradient) {
    const c = text.value?.color || '#1E2A3A'
    patch({ colorGradient: { angle: 90, stops: [{ at: 0, color: c }, { at: 1, color: '#5B8DEF' }] } } as Partial<SlideElement>)
  } else if (mode === 'solid') {
    patch({ colorGradient: undefined } as Partial<SlideElement>)
  }
}
function setGradAngle(v: number) {
  const g = text.value?.colorGradient; if (!g) return
  patch({ colorGradient: { ...g, angle: v } } as Partial<SlideElement>)
}
function setGradStopColor(i: number, c: string) {
  const g = text.value?.colorGradient; if (!g) return
  patch({ colorGradient: { ...g, stops: g.stops.map((s, j) => (j === i ? { ...s, color: c } : s)) } } as Partial<SlideElement>)
}
function setGradStopAt(i: number, at: number) {
  const g = text.value?.colorGradient; if (!g) return
  patch({ colorGradient: { ...g, stops: g.stops.map((s, j) => (j === i ? { ...s, at: Math.min(1, Math.max(0, at)) } : s)) } } as Partial<SlideElement>)
}
function addGradStop() {
  const g = text.value?.colorGradient; if (!g) return
  const mid = g.stops[Math.floor(g.stops.length / 2)]
  const stops = [...g.stops, { at: 0.5, color: mid?.color ?? '#808080' }].sort((a, b) => a.at - b.at)
  patch({ colorGradient: { ...g, stops } } as Partial<SlideElement>)
}
function removeGradStop(i: number) {
  const g = text.value?.colorGradient; if (!g || g.stops.length <= 2) return
  patch({ colorGradient: { ...g, stops: g.stops.filter((_, j) => j !== i) } } as Partial<SlideElement>)
}
function setTextStrokeWidth(w: number) {
  if (w > 0) {
    const ts = text.value?.textStroke
    patch({ textStroke: { color: ts?.color || '#1E2A3A', width: w } } as Partial<SlideElement>)
  } else {
    patch({ textStroke: undefined } as Partial<SlideElement>)
  }
}
function setTextStrokeColor(c: string) {
  const ts = text.value?.textStroke; if (!ts) return
  patch({ textStroke: { ...ts, color: c } } as Partial<SlideElement>)
}
function setTextStrokeFill(fill?: 'none') {
  const ts = text.value?.textStroke; if (!ts) return
  patch({ textStroke: { ...ts, fill } } as Partial<SlideElement>)
}
/** 应用 PowerPoint 艺术字预设：渐变/描边/发光/阴影一键组合 */
function applyWordArt(p: WordArtPreset) {
  patch({
    colorGradient: p.colorGradient ? { angle: p.colorGradient.angle, stops: p.colorGradient.stops.map((s) => ({ ...s })) } : undefined,
    color: p.color ?? '#1a1a1a',
    textStroke: p.stroke ? { ...p.stroke } : undefined,
    glowColor: p.glow?.color,
    glowBlur: p.glow?.blur,
    shadow: p.shadow ?? 'none',
  } as Partial<SlideElement>)
}

/** 图表：把文本行（逗号/换行分隔）解析为字符串数组 */
function parseLabels(s: string): string[] {
  return s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean)
}
function parseNums(s: string): number[] {
  return s.split(/[\n,，]/).map((x) => parseFloat(x)).filter((n) => Number.isFinite(n))
}
/** 表格单元格写入 */
function setCell(i: number, j: number, v: string) {
  if (!tableEl.value) return
  const rows = tableEl.value.rows.map((r) => [...r])
  while (rows.length <= i) rows.push([])
  while (rows[i].length <= j) rows[i].push('')
  rows[i][j] = v
  patch({ rows } as Partial<SlideElement>)
}
function addRow() {
  if (!tableEl.value) return
  const n = tableEl.value.rows[0]?.length ?? 1
  patch({ rows: [...tableEl.value.rows, Array(n).fill('')] } as Partial<SlideElement>)
}
function addCol() {
  if (!tableEl.value) return
  patch({ rows: tableEl.value.rows.map((r) => [...r, '']) } as Partial<SlideElement>)
}
function delRow(i: number) {
  if (!tableEl.value) return
  patch({ rows: tableEl.value.rows.filter((_, idx) => idx !== i) } as Partial<SlideElement>)
}
/** 合并操作作用的"当前格"：在面板的单元格网格里点一下即选定（会高亮） */
const curCell = ref<{ r: number; c: number } | null>(null)
/** 这个格子是不是被别的合并格盖住了（灰掉、别编辑它） */
function isCovered(r: number, c: number) {
  return layoutTable(tableEl.value?.rows || [], tableEl.value?.merges).grid.every((line) => !line.some((x) => x.r === r && x.c === c))
}
function doMerge(dir: 'right' | 'down') {
  if (!tableEl.value || !curCell.value) return
  patch({ merges: mergeAt(tableEl.value.rows, tableEl.value.merges, curCell.value.r, curCell.value.c, dir) } as Partial<SlideElement>)
}
/** 把图形标记写进"当前格"（图形库里点一张卡片就调这里） */
function insertFigMark(key: string) {
  const cc = curCell.value
  if (!cc || !tableEl.value) return
  const cur = String(tableEl.value.rows[cc.r]?.[cc.c] ?? '')
  setCell(cc.r, cc.c, (cur ? cur + ' ' : '') + '{{fig:' + key + '}}')
}
/** 打开图形库；选了哪张就插到当前格 */
function pickFig() {
  if (!curCell.value) return
  openFigPalette((_svg, _label, key) => insertFigMark(key))
}
function doUnmerge() {
  if (!tableEl.value || !curCell.value) return
  patch({ merges: unmergeAt(tableEl.value.merges, curCell.value.r, curCell.value.c) } as Partial<SlideElement>)
}
function delCol(j: number) {
  if (!tableEl.value) return
  patch({ rows: tableEl.value.rows.map((r) => r.filter((_, idx) => idx !== j)) } as Partial<SlideElement>)
}
/** 图标库：插入为当前选中 icon 的取值（供一键换图标） */

/** 嵌入：读取本地文件为 base64，并按类型推断 kind */
async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}
function inferEmbedKind(file: File): EmbedKind {
  const t = (file.type || '').toLowerCase()
  if (t.startsWith('image/')) return 'image'
  if (t === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf'
  if (t === 'text/html' || /\.html?$/i.test(file.name)) return 'html'
  return 'doc'
}
async function onEmbedFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const dataBase64 = await fileToBase64(file)
    const kind = inferEmbedKind(file)
    const mime = file.type || (kind === 'pdf' ? 'application/pdf' : kind === 'html' ? 'text/html' : 'application/octet-stream')
    patch({ kind, dataBase64, mime, url: '' } as Partial<SlideElement>)
  } catch (err) {
    window.alert('读取文件失败：' + (err instanceof Error ? err.message : String(err)))
  } finally {
    input.value = ''
  }
}
function embedKindLabel(k: EmbedKind) {
  return { url: '网页 / 外部链接', image: '本地图片', pdf: '本地 PDF', html: '本地网页', doc: '其它文档' }[k] ?? k
}

/** GeoGebra 套件选项 */
const ggbApps: { v: GgbApp; label: string }[] = [
  { v: 'classic', label: '经典（全功能）' },
  { v: 'graphing', label: '函数绘图' },
  { v: 'geometry', label: '几何' },
  { v: '3d', label: '3D 绘图' },
  { v: 'cas', label: 'CAS 计算' },
]

/** 当前选中元素在本页的图层位置（单选时有效） */
const elementIndex = computed(() => {
  if (!el.value) return 0
  return store.currentSlide?.elements.findIndex((e) => e.id === el.value!.id) ?? 0
})
const elementCount = computed(() => store.currentSlide?.elements.length ?? 0)
function onIndexChange(v: string) {
  if (!el.value) return
  store.setElementIndex(el.value.id, num(v))
}

/** 背景色取色器的显示值（transparent 时给个中性色） */
const bgColorValue = computed(() =>
  text.value?.bgColor && text.value.bgColor !== 'transparent' ? text.value.bgColor : '#ffffff',
)
// ---- 页面背景（纯色/渐变/图片）与过渡动画 ----
const slideBgKind = computed<'solid' | 'gradient' | 'image'>(() => {
  const s = store.currentSlide
  if (s?.bgImage) return 'image'
  if (s?.bgGradient && s.bgGradient.stops?.length) return 'gradient'
  return 'solid'
})
function setSlideBgKind(k: 'solid' | 'gradient' | 'image') {
  const s = store.currentSlide
  if (!s) return
  if (k === 'solid') { store.setSlideBgGradient(undefined); store.setSlideBgImage('') }
  else if (k === 'gradient') { store.setSlideBgImage(''); if (!s.bgGradient) store.setSlideBgGradient({ angle: 180, stops: [{ at: 0, color: s.bg || '#ffffff' }, { at: 1, color: '#8A2BE2' }] }) }
  else { store.setSlideBgGradient(undefined) }
}
function setBgGradAngle(v: number) {
  const g = store.currentSlide?.bgGradient; if (!g) return
  store.setSlideBgGradient({ ...g, angle: v })
}
function setBgGradStop(i: number, k: 'at' | 'c', v: number | string) {
  const g = store.currentSlide?.bgGradient; if (!g) return
  const stops = g.stops.map((s, j) => (j === i ? { at: k === 'at' ? Math.min(1, Math.max(0, v as number)) : s.at, color: k === 'c' ? (v as string) : s.color } : s))
  store.setSlideBgGradient({ ...g, stops })
}
function addBgGradStop() {
  const g = store.currentSlide?.bgGradient; if (!g) return
  const mid = g.stops[Math.floor(g.stops.length / 2)]
  store.setSlideBgGradient({ ...g, stops: [...g.stops, { at: 0.5, color: mid?.color ?? '#808080' }].sort((a, b) => a.at - b.at) })
}
function removeBgGradStop(i: number) {
  const g = store.currentSlide?.bgGradient; if (!g || g.stops.length <= 2) return
  store.setSlideBgGradient({ ...g, stops: g.stops.filter((_, j) => j !== i) })
}

/** 颜色取色器的显示值（color 为空时给个中性格色，方便用户点开就有颜色） */
const dsmColorValue = computed(() => dsm.value?.color || '#534ab7')

/** 把画布上当前选中的 Desmos 计算器内容写回场景图 */
function onDsmSave() {
  if (!el.value) return
  const s = captureDesmosState(el.value.id)
  if (!s) {
    window.alert('画布上没有该 Desmos 实例，或内容为空')
    return
  }
  store.updateElement(el.value.id, { state: s } as Partial<SlideElement>)
}

/** 导出当前 Desmos 状态到程序目录下的 JSON 文件 */
async function onDsmExport() {
  const cur = dsm.value
  if (!cur) return
  try {
    const path = await saveTextFile(`desmos-${cur.id}.json`, cur.state || '{}')
    window.alert('已保存到：\n' + path)
  } catch (err) {
    window.alert('导出失败：' + (err instanceof Error ? err.message : String(err)))
  }
}

/** 导入 .ggb 文件 → base64 */
async function onGgbFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const buf = await file.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  patch({ ggbBase64: btoa(binary) } as Partial<SlideElement>)
  input.value = ''
}
function layerTypeLabel(type: string) {
  const m: Record<string, string> = { text: '文本', shape: '形状', image: '图片', math: '公式', geogebra: 'GeoGebra', desmos: 'Desmos', line: '直线', arrow: '箭头', pen: '画笔', mathfig: '数学图形', chart: '图表', table: '表格', icon: '图标', embed: '嵌入', richtex: '组合公式' }
  return m[type] ?? type
}
</script>

<template>
  <aside class="panel">
    <!-- 属性 / 图层 双 tab -->
    <div class="panel-tabs">
      <button class="panel-tab" :class="{ 'panel-tab--on': activeTab === 'props' }" @click="activeTab = 'props'">属性</button>
      <button class="panel-tab" :class="{ 'panel-tab--on': activeTab === 'layers' }" @click="activeTab = 'layers'">图层</button>
    </div>

    <div v-if="activeTab === 'props'">
    <!-- 未选中：页面属性 -->
    <div v-if="store.selectionCount === 0" class="panel__section">
      <h3 class="panel__title">页面</h3>
      <label class="field"><span>背景</span>
        <div class="seg">
          <button class="seg__btn" :class="{ 'seg__btn--on': slideBgKind === 'solid' }" @click="setSlideBgKind('solid')">纯色</button>
          <button class="seg__btn" :class="{ 'seg__btn--on': slideBgKind === 'gradient' }" @click="setSlideBgKind('gradient')">渐变</button>
          <button class="seg__btn" :class="{ 'seg__btn--on': slideBgKind === 'image' }" @click="setSlideBgKind('image')">图片</button>
        </div>
      </label>
      <label v-if="slideBgKind === 'solid'" class="field"><span>背景色</span>
        <input type="color" :value="store.currentSlide?.bg ?? '#ffffff'" @input="store.setSlideBg(($event.target as HTMLInputElement).value)" />
      </label>
      <template v-if="slideBgKind === 'gradient'">
        <label class="field"><span>渐变角度</span>
          <input type="number" :value="store.currentSlide?.bgGradient?.angle ?? 180" @input="setBgGradAngle(num(($event.target as HTMLInputElement).value, 180))" />
        </label>
        <label v-for="(st, i) in (store.currentSlide?.bgGradient?.stops ?? [])" :key="i" class="field">
          <span>停靠 {{ i + 1 }}</span>
          <div class="field__row">
            <input type="number" :value="Math.round(st.at * 100)" @input="setBgGradStop(i, 'at', num(($event.target as HTMLInputElement).value, 0) / 100)" />
            <ColorSwatches :model-value="st.color" @update:model-value="(v) => setBgGradStop(i, 'c', v)" />
            <button v-if="(store.currentSlide?.bgGradient?.stops.length ?? 0) > 2" class="panel__mini" @click="removeBgGradStop(i)"><AppIcon name="minus" :size="13" /></button>
          </div>
        </label>
        <button class="quick__btn" style="width:100%;margin-top:4px" @click="addBgGradStop"><AppIcon name="plus" :size="13" /> 加渐变停靠点</button>
      </template>
      <label v-if="slideBgKind === 'image'" class="field"><span>背景图地址</span>
        <input type="text" :value="store.currentSlide?.bgImage || ''" placeholder="https://… 或 dataURL" @input="store.setSlideBgImage(($event.target as HTMLInputElement).value)" />
      </label>
      <label class="field" style="margin-top:8px"><span>过渡动画</span>
        <select :value="store.currentSlide?.transition || ''" @change="store.setSlideTransition(($event.target as HTMLSelectElement).value)">
          <option v-for="t in SLIDE_TRANSITIONS" :key="t.v" :value="t.v">{{ t.label }}</option>
        </select>
      </label>
      <label class="field" style="margin-top:6px"><span>演讲者备注</span>
        <textarea class="prop-textarea" rows="3"
          :value="store.currentSlide?.notes || ''"
          placeholder="本页演讲时想说的话（演示时『备注』按钮可见）"
          @input="store.setSlideNotes(($event.target as HTMLTextAreaElement).value)"></textarea>
      </label>
      <p class="panel__hint">选中画布上的元素可编辑其属性。按住 Ctrl 点击可加选，空白处拖动可框选。</p>
    </div>

    <!-- 多选：选区整体 -->
    <div v-else-if="store.selectionCount > 1" class="panel__section">
      <h3 class="panel__title">
        已选 {{ store.selectionCount }} 个元素
        <button class="panel__del" @click="store.removeSelected()">删除</button>
      </h3>
      <template v-if="store.selectionBounds">
        <div class="grid2">
          <label class="field"><span>选区 X</span>
            <input type="number" disabled :value="Math.round(store.selectionBounds.x)" />
          </label>
          <label class="field"><span>选区 Y</span>
            <input type="number" disabled :value="Math.round(store.selectionBounds.y)" />
          </label>
          <label class="field"><span>选区宽</span>
            <input type="number" disabled :value="Math.round(store.selectionBounds.w)" />
          </label>
          <label class="field"><span>选区高</span>
            <input type="number" disabled :value="Math.round(store.selectionBounds.h)" />
          </label>
        </div>
      </template>
      <div class="quick">
        <button class="quick__btn" @click="store.groupSelection()">组合</button>
        <button class="quick__btn" @click="store.ungroup()">解组</button>
      </div>
      <p class="panel__hint">多选状态下可整体拖动；对齐、分布、图层操作请用上方工具栏。</p>
    </div>

    <!-- 单选：元素属性 -->
    <template v-else-if="el">
      <div class="panel__section">
        <h3 class="panel__title">
          位置与尺寸
          <button class="panel__del" @click="store.removeSelected()">删除</button>
        </h3>
        <div class="grid2">
          <label class="field"><span>X</span>
            <input type="number" :value="Math.round(el.x)" @input="patch({ x: num(($event.target as HTMLInputElement).value) })" />
          </label>
          <label class="field"><span>Y</span>
            <input type="number" :value="Math.round(el.y)" @input="patch({ y: num(($event.target as HTMLInputElement).value) })" />
          </label>
          <label class="field"><span>宽</span>
            <input type="number" :value="Math.round(el.w)" @input="patch({ w: num(($event.target as HTMLInputElement).value, 16) })" />
          </label>
          <label class="field"><span>高</span>
            <input type="number" :value="Math.round(el.h)" @input="patch({ h: num(($event.target as HTMLInputElement).value, 16) })" />
          </label>
          <label class="field"><span>旋转（度）</span>
            <input type="number" :value="Math.round(el.rot)" @input="patch({ rot: num(($event.target as HTMLInputElement).value) })" />
          </label>
          <label class="field"><span>图层 index</span>
            <input
              type="number"
              :value="elementIndex"
              :min="0"
              :max="Math.max(0, elementCount - 1)"
              @change="onIndexChange(($event.target as HTMLInputElement).value)"
            />
          </label>
        </div>
        <p class="panel__hint">
          index 0 为最底层，{{ Math.max(0, elementCount - 1) }} 为最顶层；也可用上方工具栏的图层按钮。
        </p>
        <label class="prop-check" style="margin-top:6px">
          <input
            type="checkbox"
            :checked="el.fragment"
            @change="patch({ fragment: ($event.target as HTMLInputElement).checked } as Partial<SlideElement>)"
          />
          <span>渐显动画（演示时逐条出现）</span>
        </label>
        <label v-if="el.fragment" class="field" style="margin-top:6px">
          <span>出现顺序编号（越小越先，相同编号一起出现）</span>
          <input type="number" :value="el.fragmentIndex ?? ''"
            @input="patch({ fragmentIndex: num(($event.target as HTMLInputElement).value) } as Partial<SlideElement>)" />
        </label>
        <label class="field" style="margin-top:6px">
          <span>入场动画</span>
          <select :value="el.animIn || 'none'"
            @change="patch({ animIn: ($event.target as HTMLSelectElement).value as AnimIn } as Partial<SlideElement>)">
            <option v-for="a in ANIM_INS" :key="a.v" :value="a.v">{{ a.label }}</option>
          </select>
        </label>
        <label class="field" style="margin-top:6px">
          <span>强调动画（入场后自动播一次）</span>
          <select :value="el.animEm || 'none'"
            @change="patch({ animEm: ($event.target as HTMLSelectElement).value as AnimEm } as Partial<SlideElement>)">
            <option v-for="a in ANIM_EMS" :key="a.v" :value="a.v">{{ a.label }}</option>
          </select>
        </label>
        <div style="display:flex;gap:6px;margin-top:6px">
          <label class="field" style="flex:1"><span>时长 (ms)</span>
            <input type="number" :value="el.animDuration ?? 550" min="100" max="4000" step="50"
              @input="patch({ animDuration: num(($event.target as HTMLInputElement).value, 550) } as Partial<SlideElement>)" />
          </label>
          <label class="field" style="flex:1"><span>延迟 (ms)</span>
            <input type="number" :value="el.animDelay ?? 0" min="0" max="4000" step="50"
              @input="patch({ animDelay: num(($event.target as HTMLInputElement).value, 0) } as Partial<SlideElement>)" />
          </label>
        </div>
        <label class="field" style="margin-top:6px">
          <span>退场动画（由"退出触发点"决定时机）</span>
          <select :value="el.animOut || 'none'"
            @change="patch({ animOut: ($event.target as HTMLSelectElement).value as AnimOut } as Partial<SlideElement>)">
            <option v-for="a in ANIM_OUTS" :key="a.v" :value="a.v">{{ a.label }}</option>
          </select>
        </label>
        <label v-if="el.animOut && el.animOut !== 'none'" class="field" style="margin-top:6px">
          <span>退场顺序编号（与渐显同一套编号，越小越先）</span>
          <input type="number" :value="el.animOutIndex ?? ''"
            @input="patch({ animOutIndex: num(($event.target as HTMLInputElement).value) } as Partial<SlideElement>)" />
        </label>
        <div v-if="(el.animIn && el.animIn !== 'none') || (el.animEm && el.animEm !== 'none') || (el.animOut && el.animOut !== 'none')" style="display:flex;gap:6px;margin-top:6px">
          <button class="quick__btn" style="flex:1" @click="playAnimPreview(el.id, (el.animIn || 'none') as AnimIn, (el.animEm || 'none') as AnimEm, el.animDuration ?? 550, (el.animOut || 'none') as AnimOut)">▶ 预览动画</button>
        </div>
        <p v-if="el.animIn && el.animIn !== 'none'" class="panel__hint">
          勾选上面的「渐显动画」= 演示时<strong>点击后</strong>才出现；不勾 = 随本页一起出现（动画照跑）。
          导出用 Reveal 内置的 fragment 类，不用自己写脚本。
        </p>
        <label class="prop-check" style="margin-top:8px">
          <input type="checkbox" :checked="!!el.shadowOn" @change="patch({ shadowOn: ($event.target as HTMLInputElement).checked } as Partial<SlideElement>)" />
          <span>元素阴影（投影，颜色可选）</span>
        </label>
        <label v-if="el.shadowOn" class="field" style="margin-top:6px">
          <span>阴影颜色</span>
          <ColorSwatches :model-value="el.shadowColor || '#000000'" @update:model-value="(v) => patch({ shadowColor: v } as Partial<SlideElement>)" />
        </label>
        <div v-if="el.shadowOn" class="grid2">
          <label class="field"><span>X 偏移</span>
            <input type="number" :value="el.shadowX ?? 0" @input="patch({ shadowX: num(($event.target as HTMLInputElement).value) } as Partial<SlideElement>)" />
          </label>
          <label class="field"><span>Y 偏移</span>
            <input type="number" :value="el.shadowY ?? 6" @input="patch({ shadowY: num(($event.target as HTMLInputElement).value) } as Partial<SlideElement>)" />
          </label>
          <label class="field"><span>模糊</span>
            <input type="number" min="0" :value="el.shadowBlur ?? 18" @input="patch({ shadowBlur: num(($event.target as HTMLInputElement).value, 0) } as Partial<SlideElement>)" />
          </label>
        </div>
      </div>

      <div v-if="isGraphic" class="panel__section">
        <h3 class="panel__title">图形类型</h3>
        <div class="graphic-grid">
          <button v-for="g in GRAPHIC_TYPES" :key="g.v" class="graphic-chip"
            :class="{ 'graphic-chip--on': isCurrentGraphic(g) }" @click="store.switchGraphic(el, g.v)">{{ g.label }}</button>
        </div>
        <p class="panel__hint">点击可自由切换图形类型（保留位置尺寸）</p>
        <label v-if="isLine || isArrow || isShape || isMathFig" class="field" style="margin-top:8px"><span>线型</span>
          <select :value="el.strokeDash || 'solid'" @change="patch({ strokeDash: ($event.target as HTMLSelectElement).value } as Partial<SlideElement>)">
            <option v-for="s in LINE_STYLES" :key="s.v" :value="s.v">{{ s.label }}</option>
          </select>
        </label>
        <label v-if="isArrow" class="field" style="margin-top:8px"><span>箭头样式</span>
          <select :value="arrowEl?.arrowHead || 'triangle'" @change="patch({ arrowHead: ($event.target as HTMLSelectElement).value } as Partial<SlideElement>)">
            <option v-for="s in ARROW_HEADS" :key="s.v" :value="s.v">{{ s.label }}</option>
          </select>
        </label>
      </div>

      <!-- 段落 / 项目符号（对齐 PowerPoint「开始 → 段落」）：文字与混排共用 -->
      <div v-if="isText || isRichtex" class="panel__section">
        <h3 class="panel__title">段落</h3>
        <label class="field"><span>项目符号</span>
          <select :value="(isText ? text?.bullet : richtex?.bullet) || 'none'"
            @change="patch({ bullet: ($event.target as HTMLSelectElement).value as BulletKind } as Partial<SlideElement>)">
            <option v-for="b in BULLETS" :key="b.v" :value="b.v">{{ b.label }}</option>
          </select>
        </label>
        <label class="field"><span>符号缩进 (px)</span>
          <input type="number" :value="(isText ? text?.bulletIndent : richtex?.bulletIndent) ?? 22" min="0" max="120"
            @input="patch({ bulletIndent: num(($event.target as HTMLInputElement).value, 22) } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>左缩进 (px)</span>
          <input type="number" :value="(isText ? text?.indent : richtex?.indent) || 0" min="0" max="400"
            @input="patch({ indent: num(($event.target as HTMLInputElement).value, 0) } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>段前 (px)</span>
          <input type="number" :value="(isText ? text?.paraBefore : richtex?.paraBefore) || 0" min="0" max="80"
            @input="patch({ paraBefore: num(($event.target as HTMLInputElement).value, 0) } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>段后 (px)</span>
          <input type="number" :value="(isText ? text?.paraAfter : richtex?.paraAfter) || 0" min="0" max="80"
            @input="patch({ paraAfter: num(($event.target as HTMLInputElement).value, 0) } as Partial<SlideElement>)" />
        </label>
        <p class="panel__hint">元素是**按行**排的：每一行就是一个"段"，所以段前/段后作用在行与行之间。项目符号会把符号挂在左边、正文右移。</p>
      </div>

      <div v-if="isText" class="panel__section">
        <h3 class="panel__title">文字</h3>
        <label class="field"><span>字体</span>
          <select :value="text?.fontFamily" @change="patch({ fontFamily: ($event.target as HTMLSelectElement).value } as Partial<SlideElement>)">
            <option v-for="f in FONT_OPTIONS" :key="f.v" :value="f.v">{{ f.label }}</option>
          </select>
        </label>
        <label class="field"><span>字号</span>
          <input type="number" :value="text?.fontSize" @input="patch({ fontSize: num(($event.target as HTMLInputElement).value, 32) } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>字重</span>
          <select :value="text?.fontWeight" @change="patch({ fontWeight: num(($event.target as HTMLSelectElement).value, 400) } as Partial<SlideElement>)">
            <option :value="300">细体 300</option>
            <option :value="400">常规 400</option>
            <option :value="500">中等 500</option>
            <option :value="700">加粗 700</option>
          </select>
        </label>
        <label class="field"><span>颜色</span>
          <ColorSwatches :model-value="text?.color" @update:model-value="(v) => patch({ color: v } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>背景色</span>
          <div class="field__row">
            <input type="color" :value="bgColorValue" @input="patch({ bgColor: ($event.target as HTMLInputElement).value } as Partial<SlideElement>)" />
            <button class="panel__mini" @click="patch({ bgColor: 'transparent' } as Partial<SlideElement>)">无背景</button>
          </div>
        </label>
        <label class="field"><span>阴影</span>
          <select :value="text?.shadow" @change="patch({ shadow: ($event.target as HTMLSelectElement).value } as Partial<SlideElement>)">
            <option v-for="s in SHADOW_OPTIONS" :key="s.v" :value="s.v">{{ s.label }}</option>
          </select>
        </label>
        <label class="field"><span>艺术字样式</span>
          <div class="wordart-grid">
            <button v-for="p in WORDART_PRESETS" :key="p.label" class="wordart-chip" :title="p.label" @click="applyWordArt(p)">{{ p.label }}</button>
          </div>
        </label>
        <label class="field"><span>对齐</span>
          <select :value="text?.align" @change="patch({ align: ($event.target as HTMLSelectElement).value as TextElement['align'] } as Partial<SlideElement>)">
            <option value="left">左对齐</option>
            <option value="center">居中</option>
            <option value="right">右对齐</option>
          </select>
        </label>
        <label class="field"><span>垂直对齐</span>
          <select :value="text?.valign || 'middle'" @change="patch({ valign: ($event.target as HTMLSelectElement).value as TextElement['valign'] } as Partial<SlideElement>)">
            <option value="top">顶部</option>
            <option value="middle">居中</option>
            <option value="bottom">底部</option>
          </select>
        </label>
        <label class="field"><span>字距 (px)</span>
          <input type="number" :value="text?.letterSpacing || 0" @input="patch({ letterSpacing: num(($event.target as HTMLInputElement).value, 0) } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>行高</span>
          <input type="number" step="0.05" :value="text?.lineHeight || 1.4" @input="patch({ lineHeight: Math.max(num(($event.target as HTMLInputElement).value, 1.4), 0.5) } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>文字填充</span>
          <select :value="textGrad ? 'gradient' : 'solid'" @change="toggleTextFill(($event.target as HTMLSelectElement).value as 'solid' | 'gradient')">
            <option value="solid">纯色</option>
            <option value="gradient">渐变</option>
          </select>
        </label>
        <template v-if="textGrad">
          <label class="field"><span>渐变角度</span>
            <input type="number" :value="textGrad.angle" @input="setGradAngle(num(($event.target as HTMLInputElement).value, 90))" />
          </label>
          <p class="panel__hint" style="margin:2px 0 0">停靠点位置（%）：</p>
          <label v-for="(s, i) in textGrad.stops" :key="i" class="field">
            <span>停靠 {{ i + 1 }}</span>
            <div class="field__row">
              <input type="number" :value="Math.round(s.at * 100)" @input="setGradStopAt(i, num(($event.target as HTMLInputElement).value, 0) / 100)" />
              <ColorSwatches :model-value="s.color" @update:model-value="(v) => setGradStopColor(i, v)" />
              <button v-if="textGrad.stops.length > 2" class="panel__mini" @click="removeGradStop(i)"><AppIcon name="minus" :size="13" /></button>
            </div>
          </label>
          <button class="quick__btn" style="width:100%;margin-top:4px" @click="addGradStop"><AppIcon name="plus" :size="13" /> 加渐变停靠点</button>
        </template>
        <label class="field"><span>描边宽 (px)</span>
          <input type="number" :value="text?.textStroke?.width || 0" @input="setTextStrokeWidth(num(($event.target as HTMLInputElement).value, 0))" />
        </label>
        <template v-if="text?.textStroke?.width">
          <label class="field"><span>描边颜色</span>
            <ColorSwatches :model-value="text.textStroke.color" @update:model-value="(v) => setTextStrokeColor(v)" />
          </label>
          <label class="field"><span>内部</span>
            <select :value="text.textStroke.fill === 'none' ? 'hollow' : 'filled'" @change="setTextStrokeFill(($event.target as HTMLSelectElement).value === 'hollow' ? 'none' : undefined)">
              <option value="filled">实心</option>
              <option value="hollow">空心</option>
            </select>
          </label>
        </template>
        <label class="field"><span>发光颜色</span>
          <ColorSwatches :model-value="text?.glowColor || ''" allow-transparent @update:model-value="(v) => patch({ glowColor: v } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>发光强度 (px)</span>
          <input type="number" :value="text?.glowBlur || 0" min="0" max="40" @input="patch({ glowBlur: num(($event.target as HTMLInputElement).value, 0) } as Partial<SlideElement>)" />
        </label>
        <p class="panel__hint">渐变文字 / 描边 / 发光 / 字距 / 行高等为 Bento 与 PowerPoint 艺术字特效；上方「背景色」与「阴影」仍可用。</p>
      </div>

      <div v-if="isShape" class="panel__section">
        <h3 class="panel__title">形状</h3>
        <label class="field"><span>类型</span>
          <div class="seg">
            <button class="seg__btn" :class="{ 'seg__btn--on': shape?.shape === 'rect' }" @click="patch({ shape: 'rect' } as Partial<SlideElement>)">矩形</button>
            <button class="seg__btn" :class="{ 'seg__btn--on': shape?.shape === 'ellipse' }" @click="patch({ shape: 'ellipse' } as Partial<SlideElement>)">椭圆</button>
          </div>
        </label>
        <label class="field"><span>填充</span>
          <ColorSwatches :model-value="shape?.fill" allow-transparent @update:model-value="(v) => patch({ fill: v } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>描边</span>
          <ColorSwatches :model-value="shape?.stroke" @update:model-value="(v) => patch({ stroke: v } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>描边宽</span>
          <input type="number" :value="shape?.strokeWidth" @input="patch({ strokeWidth: num(($event.target as HTMLInputElement).value) } as Partial<SlideElement>)" />
        </label>
        <label v-if="shape?.shape === 'rect'" class="field"><span>圆角（bento 卡片风）</span>
          <input type="number" min="0" :value="shape?.cornerRadius ?? 4" @input="patch({ cornerRadius: num(($event.target as HTMLInputElement).value, 0) } as Partial<SlideElement>)" />
        </label>
      </div>

      <div v-if="isLine || isArrow || isPen" class="panel__section">
        <h3 class="panel__title">线条</h3>
        <label class="field"><span>颜色</span>
          <ColorSwatches :model-value="line?.stroke ?? arrow?.stroke ?? pen?.stroke ?? '#1a1a1a'" @update:model-value="(v) => patch({ stroke: v } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>线宽</span>
          <input
            type="number"
            :value="line?.strokeWidth ?? arrow?.strokeWidth ?? pen?.strokeWidth ?? 3"
            @input="patch({ strokeWidth: num(($event.target as HTMLInputElement).value, 3) } as Partial<SlideElement>)"
          />
        </label>
        <p v-if="isPen" class="panel__hint">重新绘制：先在顶部点「笔」，再在画布空白处拖拽画出新笔迹。</p>
      </div>

      <div v-if="isMathFig" class="panel__section">
        <h3 class="panel__title">数学图形</h3>
        <label class="field"><span>图形</span>
          <select
            :value="mathfig?.kind"
            @change="patch({ kind: ($event.target as HTMLSelectElement).value as MathFigureKind } as Partial<SlideElement>)"
          >
            <optgroup v-for="c in MATH_FIGURE_CATS" :key="c" :label="c">
              <option v-for="f in MATH_FIGURE_OPTIONS.filter((x) => x.cat === c)" :key="f.v" :value="f.v">{{ f.label }}</option>
            </optgroup>
          </select>
        </label>
        <!-- 顶点圆点：默认不画（只有字母，跟原来一致）；勾上才是教材风的小圆点 -->
        <label v-if="hasVertices" class="prop-check" style="margin-top:6px">
          <input
            type="checkbox"
            :checked="mathfig?.showDots === true"
            @change="patch({ showDots: ($event.target as HTMLInputElement).checked } as Partial<SlideElement>)"
          />
          <span>显示顶点圆点（默认只有字母）</span>
        </label>

        <!-- 自定义函数（空白）：表达式 / 定义域 / 值域 / 网格 / 坐标轴 -->
        <template v-if="mathfig?.kind === 'custom'">
          <div class="cfn__lines">
            <div v-for="(ln, i) in customLines" :key="i" class="cfn__line">
              <input
                class="cfn__expr"
                :value="ln.expr"
                placeholder="如 x^2-2x+1、2sin(x)、1/x"
                @change="setLine(i, { expr: ($event.target as HTMLInputElement).value })"
              />
              <input
                class="cfn__color" type="color" :value="ln.color || mathfig?.stroke || '#1a1a1a'"
                title="这条曲线的颜色"
                @input="setLine(i, { color: ($event.target as HTMLInputElement).value })"
              />
              <select class="cfn__dash" :value="ln.dash || 'solid'" title="虚实"
                @change="setLine(i, { dash: ($event.target as HTMLSelectElement).value })">
                <option value="solid">实线</option>
                <option value="dash">虚线</option>
                <option value="dot">点线</option>
              </select>
              <input
                class="cfn__w" type="number" min="0" max="12" step="0.5" :value="ln.width ?? 0"
                title="线宽（0 = 跟随元素）"
                @input="setLine(i, { width: num(($event.target as HTMLInputElement).value, 0) })"
              />
              <button class="cfn__del" title="删掉这条" @click="removeLine(i)">×</button>
            </div>
            <button class="quick__btn cfn__add" @click="addLine()">＋ 加一条函数</button>
          </div>
          <p v-if="customBad" class="cfn__err">有一条表达式看不懂（那条不画，其它照画）—— 支持 + − * / ^、括号、pi/e、sin/cos/tan/ln/sqrt/abs/exp…（2x 这种写法也认）</p>
          <label class="field"><span>定义域</span>
            <span class="cfn__pair">
              x ∈ [<input type="number" step="0.5" :value="mathfig.custom?.x0 ?? -4" @change="setCustom({ x0: num(($event.target as HTMLInputElement).value, -4) })" />,
              <input type="number" step="0.5" :value="mathfig.custom?.x1 ?? 4" @change="setCustom({ x1: num(($event.target as HTMLInputElement).value, 4) })" />]
            </span>
          </label>
          <label class="field"><span>值域</span>
            <span class="cfn__pair">
              y ∈ [<input type="number" step="0.5" :value="mathfig.custom?.y0 ?? -2" @change="setCustom({ y0: num(($event.target as HTMLInputElement).value, -2) })" />,
              <input type="number" step="0.5" :value="mathfig.custom?.y1 ?? 6" @change="setCustom({ y1: num(($event.target as HTMLInputElement).value, 6) })" />]
            </span>
          </label>
          <label class="field field--row"><input type="checkbox" :checked="mathfig.custom?.grid !== false" @change="setCustom({ grid: ($event.target as HTMLInputElement).checked })"> <span>网格</span></label>
          <label class="field field--row"><input type="checkbox" :checked="mathfig.custom?.axes !== false" @change="setCustom({ axes: ($event.target as HTMLInputElement).checked })"> <span>坐标轴</span></label>
          <p class="cfn__hint">值域就是显示窗口的 y 范围；改完在画布上直接拖缩放即可调整大小。</p>
        </template>
        <!-- 可调参数（正弦型 A/ω/φ、含参二次的 a…） -->
        <button class="figlib__btn" title="把这个图形的种类与参数存进图形库，之后在「数学图形」面板里一键插回" @click="saveFigToLibrary">存入图形库</button>
        <p v-if="figLibMsg" class="panel__hint">{{ figLibMsg }}</p>
        <label v-for="pr in figParams" :key="pr.key" class="field" :class="{ 'field--row': pr.bool }">
          <span>{{ pr.label }}</span>
          <input
            v-if="pr.bool"
            type="checkbox"
            :checked="figParamVal(pr.key, pr.def) >= 0.5"
            @change="setFigParam(pr.key, ($event.target as HTMLInputElement).checked ? 1 : 0)"
          />
          <input
            v-else
            type="number"
            :step="pr.step ?? 0.1"
            :min="pr.min"
            :max="pr.max"
            :value="figParamVal(pr.key, pr.def)"
            @input="setFigParamSoft(pr.key, ($event.target as HTMLInputElement).value)"
          />
        </label>
        <p v-if="figParams.length" class="panel__hint">改参数后图形立即重绘（适合讲"图象变换 / 含参讨论"）。</p>
        <template v-if="pointN > 0">
          <label v-for="i in pointN" :key="'pl' + i" class="field">
            <span>点{{ i }} 名称</span>
            <input type="text" :value="pointLabelVal(i - 1)" placeholder="如 P_1 / 留空则不标" @change="setPointLabel(i - 1, ($event.target as HTMLInputElement).value)">
          </label>
        </template>
        <template v-if="hasLineParams">
          <label class="field"><span>椭圆（曲线）颜色</span>
            <ColorSwatches :model-value="conicColorVal" @update:model-value="(v) => setConicColor(v as string)" />
          </label>
          <label v-for="i in lineN" :key="'lc' + i" class="field">
            <span>线{{ i }} 颜色</span>
            <ColorSwatches :model-value="lineColorVal(i - 1)" @update:model-value="(v) => setLineColor(i - 1, v as string)" />
          </label>
        </template>
        <label class="field"><span>线条颜色<span v-if="edgeTarget != null" class="panel__tag">▶ 边{{ edgeTarget + 1 }}</span></span>
          <ColorSwatches :model-value="strokeColorVal" @update:model-value="(v) => onStrokeColor(v as string)" />
        </label>
        <label class="field"><span>线宽<span v-if="edgeTarget != null" class="panel__tag">▶ 边{{ edgeTarget + 1 }}</span></span>
          <input type="number" :value="strokeWidthVal" @input="onStrokeWidth(num(($event.target as HTMLInputElement).value, 3))" />
        </label>
        <p v-if="edgeTarget != null" class="panel__hint">当前选中了该立体的一条边：线条颜色/线宽只作用于这条边；点空白取消选中后即作用于整个图形。</p>
        <label class="field"><span>深度 (3D)</span>
          <input type="number" :value="mathfig?.depth ?? 0.4" min="0" max="1" step="0.05" @input="patch({ depth: num(($event.target as HTMLInputElement).value, 0.4) } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>填充（透明=无）</span>
          <ColorSwatches :model-value="mathfig?.fill" allow-transparent @update:model-value="(v) => patch({ fill: v } as Partial<SlideElement>)" />
        </label>
        <button class="quick__btn" style="width:100%;margin-top:4px" @click="patch({ fill: 'transparent' } as Partial<SlideElement>)">无填充</button>
        <button v-if="isEditableFig" class="quick__btn" style="width:100%;margin-top:4px;background:#ede9fb;border-color:#c9b8f0;color:#5b43ad" @click="openShapeEdit(el.id)">✎ 编辑顶点（也可双击图形）</button>
        <button v-if="addonOn('vectorize') && mathfig?.vectorizeCtx" class="quick__btn" style="width:100%;margin-top:4px;background:#e6f0fb;border-color:#b9d3f0;color:#2b5b9c" @click="reopenVectorize">✎ 回到识别弹窗继续编辑（顶点 / 边 / 字母）</button>
        <button v-if="addonOn('geom3d') && mathfig?.geom3d" class="quick__btn" style="width:100%;margin-top:4px;background:#e6f0fb;border-color:#b9d3f0;color:#2b5b9c" @click="reopenGeom3D">⬢ 编辑三维模型（视角 / 点 / 线 / 面）</button>
        <button class="quick__btn" style="width:100%;margin-top:4px;background:#eef7ee;border-color:#bfe0bf;color:#2f6b34" @click="openAsy">⌘ 导出 Asymptote 代码</button>
        <p v-if="mathfig?.kind === 'polygon'" style="margin:6px 0 0;font-size:11px;color:#8a8aa0;line-height:1.55">顶点编辑：拖动顶点即可调整；<b>双击顶点删除</b>；<b>双击边线插入顶点</b>（最少保留 3 个顶点）</p>
        <template v-if="isSolid">
          <div class="solid-prop">
            <div v-if="selLabel" class="solid-prop__sel">已选中：{{ selLabel }} —— 在画布点选顶点/边，这里直接改</div>
            <div class="solid-prop__title">顶点字母 <span class="solid-prop__sub">（_ 下标 、^ 上标、' 撇）</span></div>
            <div class="solid-prop__grid">
              <label v-for="i in vertCount" :key="i" class="solid-prop__cell" :class="{ 'solid-prop__cell--sel': selVertex === i - 1 }">
                <span class="solid-prop__name">{{ vLetter(i - 1) }}</span>
                <input class="solid-prop__in" :ref="(el) => setVRef(i - 1, el)" :value="vLabelAt(i - 1)" @input="setVLabel(i - 1, ($event.target as HTMLInputElement).value)" :placeholder="vLetter(i - 1)" />
              </label>
            </div>
            <div class="solid-prop__title">边线样式 <span class="solid-prop__sub">（线型 / 粗细 / 颜色）</span></div>
            <div v-for="i in edgeCount" :key="'e' + i" class="solid-prop__edge" :class="{ 'solid-prop__edge--sel': selEdge === i - 1 }">
              <span class="solid-prop__ename">边{{ i }}</span>
              <span class="solid-prop__dash">
                <button v-for="dv in ['solid','dash','dot']" :key="dv" class="seg__btn" :class="{ 'seg__btn--on': edgeDashAt(i - 1) === dv }" @click="setEdgeDash(i - 1, dv)">{{ dashCn(dv) }}</button>
              </span>
              <input type="number" min="1" max="12" class="solid-prop__w" :value="edgeStyleAt(i - 1)?.width || 2" @input="setEdgeWidth(i - 1, num(($event.target as HTMLInputElement).value, 2))" />
              <input type="color" :value="edgeStyleAt(i - 1)?.color || '#333333'" @input="setEdgeColor(i - 1, ($event.target as HTMLInputElement).value)" />
            </div>
            <template v-if="faceCount">
              <div class="solid-prop__title">面样式 <span class="solid-prop__sub">（填充 / 透明度 / 隐藏该面看内部）</span></div>
              <div v-for="i in faceCount" :key="'f' + i" class="solid-prop__face" :class="{ 'solid-prop__edge--sel': selFace === i - 1 }">
                <span class="solid-prop__ename">面{{ i }}</span>
                <input type="color" :value="faceFillAt(i - 1)" @input="setFaceFill(i - 1, ($event.target as HTMLInputElement).value)" />
                <input type="range" min="0" max="100" step="5" class="solid-prop__op" :value="faceOpacityAt(i - 1)" @input="setFaceOpacity(i - 1, num(($event.target as HTMLInputElement).value, 80))" />
                <span class="solid-prop__num">{{ faceOpacityAt(i - 1) }}%</span>
                <button class="seg__btn" :class="{ 'seg__btn--on': isFaceHidden(i - 1) }" @click="toggleFaceHidden(i - 1)">{{ isFaceHidden(i - 1) ? '显示' : '隐藏' }}</button>
              </div>
            </template>
            <template v-if="isSolid">
              <div class="solid-prop__title">自由建模 <span class="solid-prop__sub">（增删点 / 连边 / 成面）</span></div>
              <button v-if="!meshOn" class="quick__btn" style="width:100%" @click="enableMesh">✎ 启用自由建模（可自由加点 / 连边 / 成面）</button>
              <template v-else>
                <div class="solid-prop__picks">
                  <label v-for="i in vCount" :key="'p' + i" class="solid-prop__pick" :class="{ on: isPicked(i - 1) }">
                    <input type="checkbox" :checked="isPicked(i - 1)" @change="togglePick(i - 1)" />{{ vLetter(i - 1) }}
                  </label>
                </div>
                <div class="solid-prop__row2">
                  <button class="quick__btn" @click="addVertex"><AppIcon name="plus" :size="13" /> 加点</button>
                  <button class="quick__btn" :disabled="!meshPick.length" @click="delPickedVertices">－ 删点</button>
                  <button class="quick__btn" :disabled="meshPick.length !== 2" @click="connectPicked">连边</button>
                  <button class="quick__btn" :disabled="meshPick.length < 3" @click="facePicked">成面</button>
                </div>
                <div class="solid-prop__row2">
                  <button class="quick__btn" @click="restoreMesh">恢复默认拓扑</button>
                  <button class="quick__btn" @click="disableMesh">退出自由建模</button>
                </div>
                <p class="solid-prop__hint" style="margin-top:4px">勾选顶点后：选 <b>2 个</b>→连边；选 <b>3 个及以上</b>→成面（按勾选顺序）。加点后拖动画布上的顶点圆点定位。</p>
              </template>
            </template>
            <p class="solid-prop__hint">提示：画布上可点选<b>顶点</b>（标字母）、<b>边</b>（线型/粗细/颜色）、<b>面</b>（点面内部）分别编辑；拖动顶点圆点可改形。</p>
          </div>
        </template>
      </div>

      <div v-if="isChart" class="panel__section">
        <h3 class="panel__title">图表</h3>
        <label class="field"><span>类型</span>
          <select :value="chart?.chartType" @change="patch({ chartType: ($event.target as HTMLSelectElement).value as ChartType } as Partial<SlideElement>)">
            <option v-for="c in CHART_TYPE_OPTIONS" :key="c.v" :value="c.v">{{ c.label }}</option>
          </select>
        </label>
        <label class="field"><span>颜色</span>
          <input type="color" :value="chart?.color" @input="patch({ color: ($event.target as HTMLInputElement).value } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>数据标签（逗号/换行分隔）</span>
          <textarea class="prop-textarea" rows="2"
            :value="(chart?.labels ?? []).join(', ')"
            @input="patch({ labels: parseLabels(($event.target as HTMLTextAreaElement).value) } as Partial<SlideElement>)"></textarea>
        </label>
        <label class="field"><span>数值（逗号/换行分隔）</span>
          <textarea class="prop-textarea" rows="2"
            :value="(chart?.values ?? []).join(', ')"
            @input="patch({ values: parseNums(($event.target as HTMLTextAreaElement).value) } as Partial<SlideElement>)"></textarea>
        </label>
      </div>

      <div v-if="isTable" class="panel__section">
        <h3 class="panel__title">表格
          <span style="display:flex;gap:4px">
            <button class="panel__mini" @click="addRow"><AppIcon name="plus" :size="12" />行</button>
            <button class="panel__mini" @click="addCol"><AppIcon name="plus" :size="12" />列</button>
          </span>
        </h3>
        <div class="tbl">
          <div v-for="(row, i) in tableEl?.rows ?? []" :key="i" class="tbl__row">
            <input
              v-for="(c, j) in row"
              :key="j"
              class="tbl__cell"
              :class="{ 'tbl__cell--cur': curCell && curCell.r === i && curCell.c === j, 'tbl__cell--cov': isCovered(i, j) }"
              :value="c ?? ''"
              @focus="curCell = { r: i, c: j }"
              @input="setCell(i, j, ($event.target as HTMLInputElement).value)"
            />
            <button class="tbl__del" title="删除第 {{ i + 1 }} 行" @click="delRow(i)"><AppIcon name="trash" :size="12" /></button>
          </div>
        </div>
        <div class="tbl__cols">
          <button
            v-for="(c, j) in tableEl?.rows[0] ?? []"
            :key="j"
            class="tbl__del"
            :title="'删除第 ' + (j + 1) + ' 列「' + (c ?? '') + '」'"
            @click="delCol(j)"
          >删列{{ j + 1 }}</button>
        </div>
        <label class="field" style="margin-top:8px"><span>表标题</span>
          <input
            :value="tableEl?.caption ?? ''"
            placeholder="如 表 4-1（留空则不显示）"
            @input="patch({ caption: ($event.target as HTMLInputElement).value } as Partial<SlideElement>)"
          />
        </label>
        <label class="field" style="margin-top:8px"><span>图形高度 (px)</span>
          <input
            type="number" min="0" max="800" step="4" placeholder="留空用默认（整格单图约 128）"
            :value="tableEl?.figHeight ?? ''"
            @input="patch({ figHeight: num(($event.target as HTMLInputElement).value, 0) || undefined } as Partial<SlideElement>)"
          />
        </label>
        <button class="panel__mini" :disabled="!curCell" style="margin-top:6px;width:100%" @click="pickFig">插入图形到当前格…</button>
        <div class="tbl__merge">
          <button class="panel__mini" :disabled="!curCell" @click="doMerge('right')">向右合并</button>
          <button class="panel__mini" :disabled="!curCell" @click="doMerge('down')">向下合并</button>
          <button class="panel__mini" :disabled="!curCell" @click="doUnmerge()">取消合并</button>
        </div>
        <p class="panel__hint">先在上面的格子里点一下（会高亮），再点合并 —— 每点一次扩一格；灰掉的格子是被合并盖住的。</p>
        <label class="field" style="margin-top:8px"><span>表头色</span>
          <ColorSwatches :model-value="tableEl?.headerColor" @update:model-value="(v) => patch({ headerColor: v } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>表头文字色</span>
          <ColorSwatches :model-value="tableEl?.headerTextColor || '#ffffff'" @update:model-value="(v) => patch({ headerTextColor: v } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>边框色</span>
          <ColorSwatches :model-value="tableEl?.borderColor" @update:model-value="(v) => patch({ borderColor: v } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>正文文字色</span>
          <ColorSwatches :model-value="tableEl?.cellColor || '#1a1a1a'" @update:model-value="(v) => patch({ cellColor: v } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>隔行条纹（斑马纹）</span>
          <ColorSwatches :model-value="tableEl?.altRowColor || ''" allow-transparent @update:model-value="(v) => patch({ altRowColor: v && v !== 'transparent' ? v : undefined } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>字号</span>
          <input type="number" :value="tableEl?.fontSize" @input="patch({ fontSize: num(($event.target as HTMLInputElement).value, 16) } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>内边距 (px)</span>
          <input type="number" :value="tableEl?.cellPad || 6" min="0" max="20" @input="patch({ cellPad: num(($event.target as HTMLInputElement).value, 6) } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>文字对齐</span>
          <select :value="tableEl?.cellAlign || 'center'" @change="patch({ cellAlign: ($event.target as HTMLSelectElement).value as TableElement['cellAlign'] } as Partial<SlideElement>)">
            <option value="left">左对齐</option>
            <option value="center">居中</option>
            <option value="right">右对齐</option>
          </select>
        </label>
      </div>

      <div v-if="isIcon" class="panel__section">
        <h3 class="panel__title">图标</h3>
        <label class="field"><span>图标</span>
          <input type="text" :value="iconEl?.icon" @input="patch({ icon: ($event.target as HTMLInputElement).value } as Partial<SlideElement>)" />
        </label>
        <div class="icon-quick">
          <button
            v-for="ic in ICON_LIBRARY"
            :key="ic"
            class="icon-quick__btn"
            title="点击换成此图标"
            @click="patch({ icon: ic } as Partial<SlideElement>)"
          >{{ ic }}</button>
        </div>
        <label class="field" style="margin-top:8px"><span>颜色</span>
          <input type="color" :value="iconEl?.color" @input="patch({ color: ($event.target as HTMLInputElement).value } as Partial<SlideElement>)" />
        </label>
      </div>

      <div v-if="isEmbed" class="panel__section">
        <h3 class="panel__title">嵌入</h3>
        <label class="field"><span>类型</span>
          <select :value="embed?.kind" @change="patch({ kind: ($event.target as HTMLSelectElement).value as EmbedKind } as Partial<SlideElement>)">
            <option value="url">网页 / 外部链接</option>
            <option value="image">本地图片</option>
            <option value="pdf">本地 PDF</option>
            <option value="html">本地网页</option>
            <option value="doc">其它文档</option>
          </select>
        </label>

        <label v-if="embed?.kind === 'url'" class="field"><span>网址（URL / PDF）</span>
          <input type="text" :value="embed?.url" placeholder="https://…" @input="patch({ url: ($event.target as HTMLInputElement).value } as Partial<SlideElement>)" />
        </label>

        <div class="embed-file">
          <label class="embed-file__btn">
            打开本地文件
            <input type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.svg,.bmp,.pdf,.html,.htm,.doc,.docx,.txt,.ppt,.pptx,.xls,.xlsx" style="display:none" @change="onEmbedFile" />
          </label>
          <span v-if="embed?.kind && embed.kind !== 'url'" class="embed-file__info">
            已内嵌：{{ embedKindLabel(embed.kind) }}{{ embed.mime ? ' · ' + embed.mime : '' }}
          </span>
        </div>
        <button v-if="embed?.dataBase64" class="quick__btn" style="width:100%;margin-top:6px" @click="patch({ dataBase64: '', kind: 'url', mime: '' } as Partial<SlideElement>)">清除已嵌入文件</button>
        <p class="panel__hint">支持图片 / PDF / HTML 内部预览；其它文档（Word/PPT/Excel 等）请用外部程序打开。本地文件以 base64 内嵌在场景图里，跨刷新仍在。</p>
      </div>

      <div v-if="isRichtex" class="panel__section">
        <h3 class="panel__title">组合公式（文字 + 内联公式混排）</h3>
        <label class="field"><span>混排正文（LaTeX 用 \\( ... \\) 包裹）</span>
          <textarea class="prop-textarea" rows="4"
            :value="richtex?.text"
            placeholder="求方程 \\(x^2+1=0\\) 的解，其中\\(x\\)为实数。"
            @input="patch({ text: ($event.target as HTMLTextAreaElement).value } as Partial<SlideElement>)"></textarea>
        </label>
        <label class="field"><span>字体</span>
          <select :value="richtex?.fontFamily" @change="patch({ fontFamily: ($event.target as HTMLSelectElement).value } as Partial<SlideElement>)">
            <option v-for="f in FONT_OPTIONS" :key="f.v" :value="f.v">{{ f.label }}</option>
          </select>
        </label>
        <label class="field"><span>字号</span>
          <input type="number" :value="richtex?.fontSize" @input="patch({ fontSize: num(($event.target as HTMLInputElement).value, 28) } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>字重</span>
          <select :value="richtex?.fontWeight" @change="patch({ fontWeight: num(($event.target as HTMLSelectElement).value, 400) } as Partial<SlideElement>)">
            <option :value="300">细体 300</option>
            <option :value="400">常规 400</option>
            <option :value="500">中等 500</option>
            <option :value="700">加粗 700</option>
          </select>
        </label>
        <label class="prop-check"><input type="checkbox" :checked="(richtex?.fitMode ?? 'fill') === 'fill'"
          @change="patch({ fitMode: ($event.target as HTMLInputElement).checked ? 'fill' : 'shrink' } as Partial<SlideElement>)"><span>充满外框（拖动外框时整块跟着无级放大）</span></label>
        <label class="field"><span>颜色</span>
          <input type="color" :value="richtex?.color" @input="patch({ color: ($event.target as HTMLInputElement).value } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>换行</span>
          <label class="chk"><input type="checkbox" :checked="richtex?.wrap !== false" @change="patch({ wrap: ($event.target as HTMLInputElement).checked } as Partial<SlideElement>)" /> 自动换行</label>
        </label>
        <div class="field"><span>行属性（颜色 / 字体）</span>
          <div style="display:flex;flex-direction:column;gap:4px;width:100%">
            <div v-for="(_, i) in (richtex?.text || '').split('\n')" :key="i" style="display:flex;align-items:center;gap:6px">
              <span style="width:16px;font-size:11px;color:#999;flex:none">{{ i + 1 }}</span>
              <input type="color" style="width:26px;height:26px;border:none;padding:0;background:none;flex:none" :value="richtex?.lineStyles?.[i]?.color || '#1a1a1a'" @input="setLineStyle(i, 'color', ($event.target as HTMLInputElement).value)" />
              <select style="flex:1" :value="richtex?.lineStyles?.[i]?.fontFamily || 'default'" @change="setLineStyle(i, 'fontFamily', ($event.target as HTMLSelectElement).value)">
                <option v-for="f in FONT_OPTIONS" :key="f.v" :value="f.v">{{ f.label }}</option>
              </select>
            </div>
          </div>
        </div>
        <label class="field"><span>背景色</span>
          <div class="field__row">
            <input type="color" :value="richtex?.bgColor && richtex.bgColor !== 'transparent' ? richtex.bgColor : '#ffffff'" @input="patch({ bgColor: ($event.target as HTMLInputElement).value } as Partial<SlideElement>)" />
            <button class="panel__mini" @click="patch({ bgColor: 'transparent' } as Partial<SlideElement>)">无背景</button>
          </div>
        </label>
        <label class="field"><span>阴影</span>
          <select :value="richtex?.shadow" @change="patch({ shadow: ($event.target as HTMLSelectElement).value } as Partial<SlideElement>)">
            <option v-for="s in SHADOW_OPTIONS" :key="s.v" :value="s.v">{{ s.label }}</option>
          </select>
        </label>
        <label class="field"><span>对齐</span>
          <select :value="richtex?.align" @change="patch({ align: ($event.target as HTMLSelectElement).value as RichTextElement['align'] } as Partial<SlideElement>)">
            <option value="left">左对齐</option>
            <option value="center">居中</option>
            <option value="right">右对齐</option>
          </select>
        </label>
        <p class="panel__hint">在正文里用 \\( ... \\) 包住 LaTeX 即可内联显示公式；字体/字号/颜色/背景一并作用于正文与公式。</p>
      </div>

      <div v-if="isImage" class="panel__section">
        <h3 class="panel__title">图片</h3>
        <label class="field"><span>地址</span>
          <input type="text" :value="image?.src" placeholder="https://… 或相对路径"
            @input="patch({ src: ($event.target as HTMLInputElement).value } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>填充</span>
          <select :value="image?.fit" @change="patch({ fit: ($event.target as HTMLSelectElement).value as ImageElement['fit'] } as Partial<SlideElement>)">
            <option value="cover">裁切填满</option>
            <option value="contain">完整显示</option>
            <option value="fill">拉伸填满（可变形）</option>
          </select>
        </label>
        <button v-if="addonOn('image-editor')" class="quick__btn" style="width:100%;margin-top:4px;background:#ede9fb;border-color:#c9b8f0;color:#5b43ad" @click="openImageEditor(el.id)">✂ 图片编辑器（裁剪 / 旋转 / 翻转 / 滤镜）</button>
        <button v-if="addonOn('vectorize')" class="quick__btn" style="width:100%;margin-top:4px;background:#e6f0fb;border-color:#b9d3f0;color:#2b5b9c" @click="openVectorize(image?.src || '', el.id)">✎ 转成矢量图形（几何插图 → 可拖顶点）</button>
        <p class="panel__hint">线稿类插图（几何图、函数图）可以识别成数学图形元素：顶点能拖、线能改虚实粗细、字母能改。</p>
        <h3 class="panel__title">裁剪</h3>
        <label class="field"><span>裁剪为形状</span>
          <select :value="image?.shapeMask || 'none'"
            @change="patch({ shapeMask: ($event.target as HTMLSelectElement).value as NonNullable<ImageElement['shapeMask']> } as Partial<SlideElement>)">
            <option v-for="m in SHAPE_MASKS" :key="m.v" :value="m.v">{{ m.label }}</option>
          </select>
        </label>
        <label class="field"><span>左 {{ cropPct(image?.crop?.l) }}%</span>
          <input type="range" :value="cropPct(image?.crop?.l)" min="0" max="90" step="1"
            @input="setCrop('l', num(($event.target as HTMLInputElement).value, 0))" />
        </label>
        <label class="field"><span>右 {{ cropPct(image?.crop?.r) }}%</span>
          <input type="range" :value="cropPct(image?.crop?.r)" min="0" max="90" step="1"
            @input="setCrop('r', num(($event.target as HTMLInputElement).value, 0))" />
        </label>
        <label class="field"><span>上 {{ cropPct(image?.crop?.t) }}%</span>
          <input type="range" :value="cropPct(image?.crop?.t)" min="0" max="90" step="1"
            @input="setCrop('t', num(($event.target as HTMLInputElement).value, 0))" />
        </label>
        <label class="field"><span>下 {{ cropPct(image?.crop?.b) }}%</span>
          <input type="range" :value="cropPct(image?.crop?.b)" min="0" max="90" step="1"
            @input="setCrop('b', num(($event.target as HTMLInputElement).value, 0))" />
        </label>
        <button v-if="hasCrop" class="quick__btn" style="width:100%;margin-top:4px"
          @click="patch({ crop: undefined } as Partial<SlideElement>)">重置裁剪</button>
        <p class="panel__hint">裁剪是**非破坏性**的：只记比例、不重编码图片，随时能改回来。（「图片编辑器」里那种裁剪会把结果烤进图片数据，两者用途不同。）</p>

        <h3 class="panel__title">图片特效（PowerPoint 风格）</h3>

        <!-- 阴影：预设 + 颜色 / 透明度 / 大小 / 模糊 / 角度 / 距离（对齐 PPT「图片格式 → 阴影」） -->
        <label class="field"><span>阴影预设</span>
          <select :value="image?.shadowPreset || 'none'" @change="applyShadowPreset(($event.target as HTMLSelectElement).value)">
            <option v-for="s in IMAGE_SHADOWS" :key="s.v" :value="s.v">{{ s.label }}</option>
          </select>
        </label>
        <template v-if="(image?.shadowPreset || 'none') !== 'none'">
          <label class="field"><span>阴影颜色</span>
            <input type="color" :value="image?.shadowColor || '#000000'"
              @input="patch({ shadowColor: ($event.target as HTMLInputElement).value } as Partial<SlideElement>)" />
          </label>
          <label class="field"><span>透明度 {{ Math.round((image?.shadowAlpha ?? 0.4) * 100) }}%</span>
            <input type="range" :value="image?.shadowAlpha ?? 0.4" min="0" max="1" step="0.05"
              @input="patch({ shadowAlpha: num(($event.target as HTMLInputElement).value, 0.4) } as Partial<SlideElement>)" />
          </label>
          <label class="field"><span>大小 {{ image?.shadowSize ?? 0 }}</span>
            <input type="range" :value="image?.shadowSize ?? 0" min="0" max="40" step="1"
              @input="patch({ shadowSize: num(($event.target as HTMLInputElement).value, 0) } as Partial<SlideElement>)" />
          </label>
          <label class="field"><span>模糊 {{ image?.shadowBlur ?? 10 }}</span>
            <input type="range" :value="image?.shadowBlur ?? 10" min="0" max="80" step="1"
              @input="patch({ shadowBlur: num(($event.target as HTMLInputElement).value, 10) } as Partial<SlideElement>)" />
          </label>
          <label class="field"><span>角度 {{ image?.shadowAngle ?? 90 }}°</span>
            <input type="range" :value="image?.shadowAngle ?? 90" min="0" max="360" step="5"
              @input="patch({ shadowAngle: num(($event.target as HTMLInputElement).value, 90) } as Partial<SlideElement>)" />
          </label>
          <label class="field"><span>距离 {{ image?.shadowDist ?? 5 }}</span>
            <input type="range" :value="image?.shadowDist ?? 5" min="0" max="40" step="1"
              @input="patch({ shadowDist: num(($event.target as HTMLInputElement).value, 5) } as Partial<SlideElement>)" />
          </label>
        </template>

        <label class="field"><span>发光颜色</span>
          <ColorSwatches :model-value="image?.glowColor || ''" allow-transparent @update:model-value="(v) => patch({ glowColor: v } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>发光强度 (px)</span>
          <input type="number" :value="image?.glowSize || 0" min="0" max="60"
            @input="patch({ glowSize: num(($event.target as HTMLInputElement).value, 0) } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>发光透明度 {{ Math.round((image?.glowAlpha ?? 1) * 100) }}%</span>
          <input type="range" :value="image?.glowAlpha ?? 1" min="0" max="1" step="0.05"
            @input="patch({ glowAlpha: num(($event.target as HTMLInputElement).value, 1) } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>映像</span>
          <select :value="image?.reflection || 'none'" @change="patch({ reflection: ($event.target as HTMLSelectElement).value as ImageElement['reflection'] } as Partial<SlideElement>)">
            <option v-for="r in IMAGE_REFLECTIONS" :key="r.v" :value="r.v">{{ r.label }}</option>
          </select>
        </label>
        <template v-if="image?.reflection && image.reflection !== 'none'">
          <label class="field"><span>映像透明度 {{ Math.round((image?.reflAlpha ?? 0.4) * 100) }}%</span>
            <input type="range" :value="image?.reflAlpha ?? 0.4" min="0" max="1" step="0.05"
              @input="patch({ reflAlpha: num(($event.target as HTMLInputElement).value, 0.4) } as Partial<SlideElement>)" />
          </label>
          <label class="field"><span>映像距离 {{ image?.reflDist ?? 0 }}</span>
            <input type="range" :value="image?.reflDist ?? 0" min="0" max="40" step="1"
              @input="patch({ reflDist: num(($event.target as HTMLInputElement).value, 0) } as Partial<SlideElement>)" />
          </label>
          <p class="panel__hint">映像的「大小 / 模糊」浏览器不支持（-webkit-box-reflect 只有间隙和渐变），只做了透明度与距离。</p>
        </template>
        <label class="field"><span>柔化边缘预设</span>
          <select :value="String(image?.softEdge ?? 0)"
            @change="patch({ softEdge: num(($event.target as HTMLSelectElement).value, 0) } as Partial<SlideElement>)">
            <option v-for="n in SOFT_EDGE_PRESETS" :key="n" :value="String(n)">{{ n === 0 ? '无' : n + ' 磅' }}</option>
          </select>
        </label>
        <label class="field"><span>三维旋转</span>
          <select :value="image?.rot3d || 'none'"
            @change="patch({ rot3d: ($event.target as HTMLSelectElement).value as NonNullable<ImageElement['rot3d']> } as Partial<SlideElement>)">
            <option v-for="r in IMAGE_ROT3D" :key="r.v" :value="r.v">{{ r.label }}</option>
          </select>
        </label>
        <label class="field"><span>柔化边缘 (px)</span>
          <input type="number" :value="image?.softEdge || 0" min="0" max="80"
            @input="patch({ softEdge: num(($event.target as HTMLInputElement).value, 0) } as Partial<SlideElement>)" />
        </label>
        <p class="panel__hint">阴影请用下方「阴影」区设置；发光为贴合透明形状的 drop-shadow；映像在 Chromium / WebView2 生效。</p>

        <h3 class="panel__title">图片调整（校正 / 颜色）</h3>
        <label class="field"><span>亮度 {{ image?.brightness ?? 100 }}%</span>
          <input type="range" :value="image?.brightness ?? 100" min="0" max="200" step="1"
            @input="patch({ brightness: num(($event.target as HTMLInputElement).value, 100) } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>对比度 {{ image?.contrast ?? 100 }}%</span>
          <input type="range" :value="image?.contrast ?? 100" min="0" max="200" step="1"
            @input="patch({ contrast: num(($event.target as HTMLInputElement).value, 100) } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>饱和度 {{ image?.saturate ?? 100 }}%</span>
          <input type="range" :value="image?.saturate ?? 100" min="0" max="200" step="1"
            @input="patch({ saturate: num(($event.target as HTMLInputElement).value, 100) } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>色调 {{ image?.hue ?? 0 }}°</span>
          <input type="range" :value="image?.hue ?? 0" min="-180" max="180" step="1"
            @input="patch({ hue: num(($event.target as HTMLInputElement).value, 0) } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>重新着色</span>
          <select :value="image?.recolor || 'none'"
            @change="patch({ recolor: ($event.target as HTMLSelectElement).value as NonNullable<ImageElement['recolor']> } as Partial<SlideElement>)">
            <option v-for="r in IMAGE_RECOLORS" :key="r.v" :value="r.v">{{ r.label }}</option>
          </select>
        </label>
        <label class="field"><span>虚化 (px)</span>
          <input type="number" :value="image?.blur || 0" min="0" max="30"
            @input="patch({ blur: num(($event.target as HTMLInputElement).value, 0) } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>圆角 (px)</span>
          <input type="number" :value="image?.radius ?? 4" min="0" max="200"
            @input="patch({ radius: num(($event.target as HTMLInputElement).value, 4) } as Partial<SlideElement>)" />
        </label>
        <div class="field--row" style="display:flex;gap:6px;margin-top:6px">
          <button class="quick__btn" style="flex:1"
            :style="image?.flipH ? 'background:#e6f0fb;border-color:#b9d3f0;color:#1668e0' : ''"
            @click="patch({ flipH: !image?.flipH } as Partial<SlideElement>)">水平翻转</button>
          <button class="quick__btn" style="flex:1"
            :style="image?.flipV ? 'background:#e6f0fb;border-color:#b9d3f0;color:#1668e0' : ''"
            @click="patch({ flipV: !image?.flipV } as Partial<SlideElement>)">垂直翻转</button>
        </div>
        <button class="quick__btn" style="width:100%;margin-top:6px"
          @click="patch({ brightness: 100, contrast: 100, saturate: 100, hue: 0, recolor: 'none', blur: 0, flipH: false, flipV: false, radius: 4 } as Partial<SlideElement>)">
          重设图片调整
        </button>
        <p class="panel__hint">这些调整走 CSS 滤镜，**不重编码图片**（原图不动，导出/放映都按同一套渲染）。</p>
      </div>

      <div v-if="isMath" class="panel__section">
        <h3 class="panel__title">公式（LaTeX）</h3>
        <label class="field">
          <span>源码（不含 $ 定界符）</span>
          <textarea
            class="prop-textarea"
            rows="4"
            :value="math?.latex"
            placeholder="\frac{-b\pm\sqrt{b^2-4ac}}{2a}"
            @input="patch({ latex: ($event.target as HTMLTextAreaElement).value } as Partial<SlideElement>)"
          ></textarea>
        </label>
        <label class="field"><span>字号</span>
          <input type="number" :value="math?.fontSize"
            @input="patch({ fontSize: num(($event.target as HTMLInputElement).value, 40) } as Partial<SlideElement>)" />
        </label>
        <label class="field"><span>颜色</span>
          <input type="color" :value="math?.color"
            @input="patch({ color: ($event.target as HTMLInputElement).value } as Partial<SlideElement>)" />
        </label>
        <label class="prop-check"><input type="checkbox" :checked="(math?.fitMode ?? 'fill') === 'fill'"
          @change="patch({ fitMode: ($event.target as HTMLInputElement).checked ? 'fill' : 'shrink' } as Partial<SlideElement>)"><span>充满外框（拖动外框时公式跟着无级放大）</span></label>
        <button class="quick__btn" style="width:100%;margin-top:6px" @click="openFormulaLibrary()"><AppIcon name="formula" :size="13" /> 预制公式库（点击卡片替换当前公式）</button>
        <p class="panel__hint">
          已内置宏：<code>\R \N \Z \Q \C \E</code>（数集）、<code>\abs{x}</code> 绝对值、<code>\norm{x}</code> 范数、<code>\dd</code> 微分、<code>\ee</code> 自然常数、<code>\ii</code> 虚数单位、<code>\comb{n}{k}</code> 组合、<code>\perm{n}{k}</code> 排列、<code>\half</code> ½。勾选「充满外框」时拖动外框即可无级缩放公式；取消勾选则按「字号」显示、只在装不下时缩小。
        </p>
      </div>

      <div v-if="isGgb" class="panel__section">
        <h3 class="panel__title">GeoGebra</h3>
        <label class="field"><span>套件</span>
          <select :value="ggb?.app"
            @change="patch({ app: ($event.target as HTMLSelectElement).value as GgbApp } as Partial<SlideElement>)">
            <option v-for="a in ggbApps" :key="a.v" :value="a.v">{{ a.label }}</option>
          </select>
        </label>
        <label class="prop-check"><input type="checkbox" :checked="ggb?.showToolbar"
          @change="patch({ showToolbar: ($event.target as HTMLInputElement).checked } as Partial<SlideElement>)"><span>显示工具栏</span></label>
        <label class="prop-check"><input type="checkbox" :checked="ggb?.showAlgebraInput"
          @change="patch({ showAlgebraInput: ($event.target as HTMLInputElement).checked } as Partial<SlideElement>)"><span>显示代数输入栏</span></label>
        <label class="prop-check"><input type="checkbox" :checked="ggb?.showAlgebra"
          @change="patch({ showAlgebra: ($event.target as HTMLInputElement).checked } as Partial<SlideElement>)"><span>显示代数区（视图）</span></label>
        <label class="prop-check"><input type="checkbox" :checked="ggb?.showMenuBar"
          @change="patch({ showMenuBar: ($event.target as HTMLInputElement).checked } as Partial<SlideElement>)"><span>显示菜单栏</span></label>
        <label class="prop-check"><input type="checkbox" :checked="ggb?.showResetIcon"
          @change="patch({ showResetIcon: ($event.target as HTMLInputElement).checked } as Partial<SlideElement>)"><span>显示重置按钮</span></label>
        <label class="prop-check"><input type="checkbox" :checked="ggb?.enableShiftDragZoom"
          @change="patch({ enableShiftDragZoom: ($event.target as HTMLInputElement).checked } as Partial<SlideElement>)"><span>Shift 拖拽缩放</span></label>
        <label class="prop-check"><input type="checkbox" :checked="ggb?.showAxis"
          @change="patch({ showAxis: ($event.target as HTMLInputElement).checked } as Partial<SlideElement>)"><span>显示坐标轴</span></label>
        <label class="prop-check"><input type="checkbox" :checked="ggb?.showGrid"
          @change="patch({ showGrid: ($event.target as HTMLInputElement).checked } as Partial<SlideElement>)"><span>显示网格</span></label>
        <label class="prop-check"><input type="checkbox" :checked="ggb?.showTitlebar"
          @change="patch({ showTitlebar: ($event.target as HTMLInputElement).checked } as Partial<SlideElement>)"><span>显示标题栏（拖动移动元素）</span></label>

        <button class="quick__btn" style="width:100%;margin-top:10px" @click="openGgbSuite(el.id)">✎ 编辑作图（套件）</button>

        <label class="field" style="margin-top:10px">
          <span>打开本地 .ggb 文件</span>
          <input type="file" accept=".ggb" @change="onGgbFile" />
        </label>
        <button v-if="ggb?.ggbBase64" class="quick__btn" style="width:100%"
          @click="patch({ ggbBase64: '' } as Partial<SlideElement>)">清除已导入文件</button>
        <p class="panel__hint">
          导入后内容以 base64 内嵌在场景图里，不依赖外部文件；导入与显示选项变化会自动重载小程序。
        </p>
      </div>

      <div v-if="isDsm" class="panel__section">
        <h3 class="panel__title">Desmos</h3>
        <label class="prop-check"><input type="checkbox" :checked="dsm?.showPanel"
          @change="patch({ showPanel: ($event.target as HTMLInputElement).checked } as Partial<SlideElement>)"><span>显示表达式面板</span></label>
        <label class="prop-check"><input type="checkbox" :checked="dsm?.showToolbar"
          @change="patch({ showToolbar: ($event.target as HTMLInputElement).checked } as Partial<SlideElement>)"><span>显示工具栏 / 设置菜单</span></label>
        <label class="prop-check"><input type="checkbox" :checked="dsm?.showZoomButtons"
          @change="patch({ showZoomButtons: ($event.target as HTMLInputElement).checked } as Partial<SlideElement>)"><span>显示缩放按钮(+/−/首页)</span></label>
        <label class="prop-check"><input type="checkbox" :checked="dsm?.showTitlebar"
          @change="patch({ showTitlebar: ($event.target as HTMLInputElement).checked } as Partial<SlideElement>)"><span>显示标题栏（拖动移动元素）</span></label>

        <label class="field" style="margin-top:10px">
          <span>表达式颜色（留空 = Desmos 自动配色）</span>
          <div style="display:flex;gap:6px;align-items:center">
            <input type="color" :value="dsmColorValue"
              @input="patch({ color: ($event.target as HTMLInputElement).value } as Partial<SlideElement>)" />
            <button class="quick__btn" @click="patch({ color: '' } as Partial<SlideElement>)">自动</button>
          </div>
        </label>

        <div style="display:grid;gap:6px;margin-top:10px">
          <button class="quick__btn" style="width:100%" @click="onDsmSave"><AppIcon name="save" :size="13" /> 保存当前内容</button>
          <button class="quick__btn" style="width:100%" :disabled="!dsm?.state" @click="onDsmExport">
            <AppIcon name="down" :size="13" /> 导出状态 JSON
          </button>
          <button class="quick__btn quick__btn--danger" style="width:100%"
            @click="patch({ state: '' } as Partial<SlideElement>)">清空内容</button>
        </div>
        <p class="panel__hint">
          在画布的计算器里输入表达式后，点击画布空白处会自动保存，也可以按上面的按钮手动保存。
          内容以状态 JSON 存在场景图里，不依赖外部文件；桌面端导出会写到程序目录。
        </p>
      </div>
    </template>
    </div>

    <!-- 图层 tab -->
    <div v-else class="layers">
      <p class="panel__hint">点选某层 = 选中元素；↑↓ 调整层序（index 越大越靠顶层）。</p>
      <div v-for="(el, i) in (store.currentSlide?.elements ?? [])" :key="el.id" class="layer" :class="{ 'layer--on': store.isSelected(el.id) }" @click="store.setSelection([el.id])">
        <span class="layer__idx">{{ i }}</span>
        <span class="layer__type">{{ layerTypeLabel(el.type) }}</span>
        <span class="layer__menu">
          <button class="layer__btn" @click.stop="store.setElementIndex(el.id, i - 1)" :disabled="i === 0"><AppIcon name="up" :size="12" /></button>
          <button class="layer__btn" @click.stop="store.setElementIndex(el.id, i + 1)" :disabled="i === (store.currentSlide?.elements.length ?? 0) - 1"><AppIcon name="down" :size="12" /></button>
          <button class="layer__btn layer__btn--del" @click.stop="store.removeSelected()" v-if="store.isSelected(el.id)"><AppIcon name="trash" :size="12" /></button>
        </span>
      </div>
      <p class="panel__hint">当前页 {{ (store.currentSlide?.elements.length ?? 0) }} 个元素</p>
    </div>
  </aside>
</template>

<style scoped>
.figlib__btn { margin: 2px 0 6px; border: 1px solid #dcdce6; background: #fff; border-radius: 8px; padding: 5px 12px; font-size: 12.5px; cursor: pointer; }
.figlib__btn:hover { background: #efeaff; border-color: #b9a9f0; }
.panel {
  width: 276px;
  flex: none;
  border-left: 1px solid var(--border);
  background: var(--panel);
  overflow-y: auto;
  padding: 12px 14px 40px;
}

/* 分区之间用一条细线分隔，长表单不糊成一片 */
.panel__section { margin-bottom: 16px; }
.panel__section + .panel__section {
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
.panel__title {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--muted);
  margin: 0 0 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.panel__del {
  font-size: 11px;
  font-weight: 500;
  color: var(--danger);
  border: 1px solid var(--danger-border);
  background: var(--panel);
  border-radius: var(--radius-sm);
  height: 22px;
  padding: 0 8px;
  cursor: pointer;
  transition: background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease);
}
.panel__del:hover { background: var(--danger-soft); border-color: var(--danger); }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 8px; }

/* ---------- 分段控件 ---------- */
.seg { display: flex; gap: 4px; }
.seg__btn {
  flex: 1;
  height: 30px;
  padding: 0 6px;
  border: 1px solid var(--border-strong);
  background: var(--panel);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 12.5px;
  color: var(--text);
  transition: background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease),
              color var(--dur-1) var(--ease);
}
.seg__btn:hover { background: var(--gray-50); border-color: var(--gray-400); }
.seg__btn--on {
  background: var(--brand-50);
  border-color: var(--brand-300);
  color: var(--brand-800);
  font-weight: 600;
}

.graphic-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.graphic-chip {
  height: 30px;
  padding: 0 4px;
  border: 1px solid var(--border-strong);
  background: var(--panel);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 12px;
  color: var(--text);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease),
              color var(--dur-1) var(--ease);
}
.graphic-chip:hover { background: var(--brand-50); border-color: var(--brand-300); color: var(--brand-800); }
.graphic-chip--on {
  background: var(--brand-100);
  border-color: var(--brand-300);
  color: var(--brand-800);
  font-weight: 600;
}

/* ---------- 表单字段 ---------- */
.field { display: block; margin-bottom: 8px; font-size: 11.5px; color: var(--muted); }
/* 自定义函数（空白）的小表单 */
.field--row { display: flex; align-items: center; gap: 6px; }
.field--row > span { display: inline; margin: 0; }
/* 多函数列表：每行 = 表达式 + 颜色 + 虚实 + 线宽 + 删除 */
.cfn__lines { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.cfn__line { display: flex; align-items: center; gap: 6px; }
.cfn__line .cfn__expr { flex: 1; min-width: 0; }
.cfn__color { width: 30px; height: 26px; padding: 0; border: 1px solid var(--border, #e2e2e8); border-radius: 6px; background: none; cursor: pointer; }
.cfn__dash { width: 62px; }
.cfn__w { width: 52px; }
.cfn__del { width: 24px; height: 24px; border: 1px solid var(--border, #e2e2e8); border-radius: 6px; background: #fff; color: #8a8a94; cursor: pointer; line-height: 1; }
.cfn__del:hover { color: #e0402f; border-color: #e0402f; }
.cfn__add { margin-top: 2px; }
.cfn__pair { display: flex; align-items: center; gap: 4px; }
.cfn__pair input { width: 62px !important; }
.cfn__err { margin: 4px 0 8px; font-size: 11px; color: #c0392b; line-height: 1.5; }
.cfn__hint { margin: 2px 0 0; font-size: 11px; color: #8a8aa0; line-height: 1.55; }
.field > span { display: block; margin-bottom: 4px; }
.field input[type="number"],
.field input[type="text"],
.field select {
  width: 100%;
  box-sizing: border-box;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-family: inherit;
  color: var(--text);
  background: var(--panel);
  transition: border-color var(--dur-1) var(--ease), box-shadow var(--dur-1) var(--ease);
}
.field input:hover,
.field select:hover { border-color: var(--gray-400); }
.field input:focus,
.field select:focus {
  outline: none;
  border-color: var(--brand-400);
  box-shadow: var(--ring-brand);
}
.field select {
  appearance: none;
  -webkit-appearance: none;
  padding-right: 26px;
  cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236e6e7e' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 6px center;
}
.field input[type="color"] {
  width: 100%;
  height: 30px;
  padding: 2px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--panel);
  cursor: pointer;
}
.field input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
.field input[type="color"]::-webkit-color-swatch { border: none; border-radius: 4px; }

/* 说明文字：浅底卡片，弱化但不至于看不清 */
.panel__hint {
  font-size: 11.5px;
  color: var(--muted);
  line-height: 1.7;
  background: var(--gray-50);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  margin: 8px 0 0;
}
.panel__tag { color: #b26a00; background: #fff3e0; border-radius: 4px; padding: 1px 5px; font-size: 11px; margin-left: 5px; }
.wordart-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.wordart-chip {
  font-size: 12px;
  height: 32px;
  padding: 0 4px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--panel);
  cursor: pointer;
  line-height: 1.2;
  color: var(--text);
  transition: background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease),
              transform var(--dur-1) var(--ease);
}
.wordart-chip:hover {
  background: var(--brand-50);
  border-color: var(--brand-300);
  transform: translateY(-1px);
}
.panel__hint code {
  background: var(--brand-50);
  color: var(--brand-800);
  border-radius: 4px;
  padding: 0 4px;
  font-size: 11px;
  font-family: var(--mono);
}
.prop-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 8px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text);
  background: var(--panel);
  resize: vertical;
  transition: border-color var(--dur-1) var(--ease), box-shadow var(--dur-1) var(--ease);
}
.prop-textarea:focus {
  outline: none;
  border-color: var(--brand-400);
  box-shadow: var(--ring-brand);
}
.prop-check {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  color: var(--text);
  margin-bottom: 7px;
  cursor: pointer;
  user-select: none;
}
.prop-check input[type="checkbox"],
.chk input[type="checkbox"] {
  accent-color: var(--brand-600);
  width: 15px;
  height: 15px;
  cursor: pointer;
  flex: none;
  margin: 0;
}
.field input[type="file"] {
  width: 100%;
  font-size: 11px;
}
.field__row { display: flex; align-items: center; gap: 6px; }
.field__row input[type="color"] { flex: 1; height: 30px; }
.panel__mini {
  flex: none;
  height: 30px;
  padding: 0 9px;
  font-size: 11.5px;
  font-weight: 500;
  border: 1px solid var(--border-strong);
  background: var(--panel);
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text);
  transition: background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease),
              color var(--dur-1) var(--ease);
}
.panel__mini:hover { background: var(--brand-50); border-color: var(--brand-300); color: var(--brand-800); }

/* ---------- 快捷操作按钮 ---------- */
.quick { display: flex; gap: 6px; margin-top: 10px; }
.quick__btn {
  flex: 1;
  min-height: 30px;
  padding: 6px 8px;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.3;
  border: 1px solid var(--border-strong);
  background: var(--panel);
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text);
  transition: background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease),
              color var(--dur-1) var(--ease), box-shadow var(--dur-1) var(--ease);
}
.quick__btn:hover:not(:disabled) {
  background: var(--brand-50);
  border-color: var(--brand-300);
  color: var(--brand-800);
}
.quick__btn:disabled { opacity: 0.42; cursor: not-allowed; }
.quick__btn--danger { color: var(--danger); }
.quick__btn--danger:hover:not(:disabled) {
  background: var(--danger-soft);
  border-color: var(--danger-border);
  color: var(--danger);
}

/* ---------- 表格编辑 ---------- */
.tbl { display: flex; flex-direction: column; gap: 5px; }
.tbl__row { display: flex; align-items: center; gap: 5px; }
.tbl__cell {
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  height: 30px;
  padding: 0 7px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  font-size: 12.5px;
  font-family: inherit;
  color: var(--text);
  background: var(--panel);
  transition: border-color var(--dur-1) var(--ease), box-shadow var(--dur-1) var(--ease);
}
.tbl__cell:focus { outline: none; border-color: var(--brand-400); box-shadow: var(--ring-brand); }
.tbl__del {
  flex: none;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  line-height: 1;
  color: var(--danger);
  background: var(--panel);
  border: 1px solid var(--danger-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  padding: 0;
  transition: background var(--dur-1) var(--ease);
}
.tbl__del:hover { background: var(--danger-soft); }
.tbl__cols { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }

/* ---------- 图标速选 ---------- */
.icon-quick { display: flex; flex-wrap: wrap; gap: 5px; }
.icon-quick__btn {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  border: 1px solid var(--border-strong);
  background: var(--panel);
  border-radius: var(--radius-sm);
  cursor: pointer;
  line-height: 1;
  transition: background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease),
              transform var(--dur-1) var(--ease);
}
.icon-quick__btn:hover {
  background: var(--brand-50);
  border-color: var(--brand-300);
  transform: translateY(-1px);
}

/* ---------- 嵌入文件 ---------- */
.embed-file { display: flex; align-items: center; gap: 8px; }
.embed-file__btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 12px;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--border-strong);
  background: var(--panel);
  border-radius: var(--radius-sm);
  color: var(--text);
  transition: background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease),
              color var(--dur-1) var(--ease);
}
.embed-file__btn:hover {
  background: var(--brand-50);
  border-color: var(--brand-300);
  color: var(--brand-800);
}
.embed-file__info { font-size: 11.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---------- 属性 / 图层 分段 tab ---------- */
.panel-tabs {
  display: flex;
  gap: 3px;
  position: sticky;
  top: -12px;
  z-index: 10;
  margin: -12px -14px 14px;
  padding: 10px 14px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
}
.panel-tab {
  flex: 1;
  height: 28px;
  padding: 0 6px;
  font-size: 12.5px;
  color: var(--muted);
  font-weight: 500;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  cursor: pointer;
  transition: background var(--dur-1) var(--ease), color var(--dur-1) var(--ease),
              box-shadow var(--dur-1) var(--ease);
}
.panel-tab:hover { color: var(--text); background: var(--gray-50); }
.panel-tab--on {
  color: var(--brand-800);
  background: var(--brand-50);
  box-shadow: inset 0 0 0 1px var(--brand-100);
  font-weight: 600;
}

/* ---------- 图层列表 ---------- */
.layers { display: flex; flex-direction: column; gap: 5px; }
.layer {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 12.5px;
  background: var(--panel);
  transition: background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease);
}
.layer:hover { background: var(--gray-50); border-color: var(--border-strong); }
.layer--on { border-color: var(--brand-300); background: var(--brand-50); }
.layer__idx {
  width: 18px;
  text-align: center;
  color: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.layer__type { flex: 1; color: var(--text); }
.layer__menu { display: flex; gap: 3px; }
.layer__btn {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  line-height: 1;
  border: 1px solid var(--border);
  background: var(--panel);
  border-radius: 5px;
  cursor: pointer;
  color: var(--gray-600);
  padding: 0;
  transition: background var(--dur-1) var(--ease), color var(--dur-1) var(--ease),
              border-color var(--dur-1) var(--ease);
}
.layer__btn:hover:not(:disabled) {
  background: var(--brand-50);
  border-color: var(--brand-200);
  color: var(--brand-700);
}
.layer__btn:disabled { opacity: 0.3; cursor: not-allowed; }
.layer__btn--del { color: var(--danger); }
.layer__btn--del:hover:not(:disabled) { background: var(--danger-soft); border-color: var(--danger-border); color: var(--danger); }

.solid-prop { margin-top: 8px; border-top: 1px dashed #ddd; padding-top: 8px; }
.solid-prop__title { font-size: 12px; font-weight: 600; color: #333; margin: 8px 0 6px; }
.solid-prop__sub { font-weight: 400; color: #999; }
.solid-prop__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 6px; }
.solid-prop__cell { display: flex; flex-direction: column; gap: 3px; }
.solid-prop__name { font-size: 12px; font-weight: 600; color: #5b43ad; }
.solid-prop__in { width: 100%; box-sizing: border-box; border: 1px solid #ddd; border-radius: 6px; padding: 4px 6px; font-size: 13px; }
.solid-prop__edge { display: flex; align-items: center; gap: 6px; margin-top: 5px; }
.solid-prop__ename { min-width: 34px; font-size: 12px; color: #666; }
.solid-prop__dash { display: inline-flex; gap: 3px; }
.solid-prop__dash .seg__btn { flex: 1; white-space: nowrap; }
.solid-prop__w { width: 52px; border: 1px solid #ddd; border-radius: 6px; padding: 3px 4px; font-size: 12px; }
.solid-prop__edge input[type=color] { width: 26px; height: 22px; border: none; padding: 0; cursor: pointer; }
.solid-prop__hint { margin: 8px 0 0; font-size: 11px; color: #8a8aa0; line-height: 1.55; }
.solid-prop__sel { background: #fff8ec; border: 1px solid #ffd9a0; color: #b26a00; border-radius: 6px; padding: 5px 8px; font-size: 12px; margin-bottom: 6px; }
.solid-prop__cell--sel { outline: 2px solid #ff8f1f; outline-offset: 1px; border-radius: 6px; }
.solid-prop__edge--sel { background: #fff8ec; border: 1px solid #ffd9a0; border-radius: 6px; padding: 3px 5px; }
.solid-prop__face { display: flex; align-items: center; gap: 6px; margin-top: 5px; }
.solid-prop__face input[type=color] { width: 26px; height: 22px; border: none; padding: 0; cursor: pointer; }
.solid-prop__op { flex: 1; min-width: 40px; }
.solid-prop__num { min-width: 30px; font-size: 11px; color: #666; }
.solid-prop__picks { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0; }
.solid-prop__pick { display: inline-flex; align-items: center; gap: 3px; font-size: 12px; border: 1px solid #ddd; border-radius: 6px; padding: 2px 6px; cursor: pointer; }
.solid-prop__pick.on { border-color: #ff8f1f; background: #fff8ec; }
.solid-prop__row2 { display: flex; gap: 6px; margin-top: 5px; }
.solid-prop__row2 .quick__btn { flex: 1; }

</style>