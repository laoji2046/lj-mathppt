<script setup lang="ts">
/** 三维立体图：把一份「顶点 + 面表」的三维几何描述投影成可编辑的数学图形。
 *
 *  为什么要有这个入口：「图片转图形」是从像素**猜**几何（一条棱该实该虚只能靠墨迹、凸包内外这些启发式），
 *  而这里是**算**：凸多面体的一条棱属于至少一个正面朝向的面就可见，虚实是面表的推论。
 *  所以"多余顶点、虚实判错、异面直线在投影上假交叉"这三类问题在这条路上不存在。
 *
 *  两种确定视角的办法：
 *   ① 直接给 azim / elev（教材常用 -60~-10 / 10~30）；
 *   ② **截图描点对齐** —— 导入同一张截图，按提示依次点出各顶点，反解精确视角（正交投影是线性的，
 *      给定视角后缩放/平移用最小二乘一次解出，所以只要在视角网格上粗搜+细化即可）。
 */
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { useDeckStore } from '@/stores/deck'
import { buildSolid, projectGeom, resolveVertices, solveView, type Geom3D } from '@/composables/geom3d'
import { GEOM3D_PRESETS, GEOM3D_PROMPT } from '@/composables/geom3dPrompt'
import { renderSolid, arcsSvg } from '@/composables/solid3d'
import { closeGeom3D } from '@/ui/geom3d'
import type { MathFigureElement } from '@/types'

const props = defineProps<{ editId?: string | null }>()
const store = useDeckStore()
/** 在**当前页**里按 id 找元素（跟「图片转图形」同一套做法） */
const findEl = (id: string) => store.currentSlide?.elements.find((e) => e.id === id) as MathFigureElement | undefined
const H = 620
/** 左侧面板页签：一次只显示一类控件（控件太多，不分页就是一面墙） */
const tab = ref<'model' | 'draw' | 'list'>('model')
/** 当前投影（只算一次，预览 / 属性 / 命中测试共用） */
const proj = computed(() => (model.value ? projectGeom(model.value, { azim: azim.value, elev: elev.value }) : null))

// ---------------- 选择（点 / 线） ----------------
/** 选中的点（可多选 —— 连线和作平面都要多点）。存的是投影 points 的下标，
 *  跟 order 一一对应（resolveVertices 保证顺序一致）。 */
const selPoints = ref<number[]>([])

/** 选中的线：存 mesh.edges 的下标 */
const selEdge = ref<number | null>(null)
/** 当前选择类型：点可以多选，线单选 */
const selKind = ref<'point' | 'line' | null>(null)
/** 选中项的点名（点选择用） */
const selNames = computed(() => selPoints.value.map((i) => order.value[i]).filter(Boolean))
/** 选中点的当前标签（单选时用于输入框回显） */
const selLabel = computed(() => {
  const m = model.value
  const n = selNames.value[0]
  if (!m || !n) return ''
  const ov = (m.pointStyles || {})[n]
  if (ov && 'label' in ov) return ov.label == null ? '' : String(ov.label)
  return n
})
/** 选中线的当前样式（用于回显） */
const selEdgeStyle = computed(() => {
  const m = model.value
  const nm = selEdgeNames.value
  if (!m || !nm) return { color: '#1a1a1a', width: 2.6, dash: 0 }
  const o = (m.edgeStyles || {})[[...nm].sort().join('|')] || {}
  return { color: o.color || '#1a1a1a', width: o.width ?? 2.6, dash: o.dash ?? 0 }
})

/** 选中线的两端点名 */
const selEdgeNames = computed(() => {
  const p = proj.value
  if (!p || selEdge.value === null) return null
  const e = p.mesh.edges[selEdge.value]
  if (!e) return null
  const a = order.value[e[0]], b = order.value[e[1]]
  return a && b ? ([a, b] as [string, string]) : null
})
/** 元素框的宽按内容的宽高比给 —— 固定宽高会把投影拉变形（椭圆最明显）。
 *  这里从当前投影算，随视角变化（角度变了包围盒也变）。 */
const W = computed(() => {
  const p = proj.value
  return p ? Math.max(200, Math.min(900, Math.round(H * p.aspect))) : 560
})

/** 示例：正四棱柱 ABCD-A₁B₁C₁D₁（2×2×2），四条竖棱各一个中点，再从 C₂ 连四条辅助线 */
const SAMPLE = `{
  "solid": "prism4",
  "name": "正四棱柱 ABCD-A₁B₁C₁D₁",
  "vertices": {
    "A": [0, 0, 0], "B": [2, 0, 0], "C": [2, 2, 0], "D": [0, 2, 0],
    "A1": [0, 0, 2], "B1": [2, 0, 2], "C1": [2, 2, 2], "D1": [0, 2, 2],
    "A2": [0, 0, 0.7], "B2": [2, 0, 0.7], "C2": [2, 2, 0.7], "D2": [0, 2, 0.7]
  },
  "faces": [
    ["A", "B", "C", "D"],
    ["A1", "B1", "C1", "D1"],
    ["A", "B", "B1", "A1"],
    ["B", "C", "C1", "B1"],
    ["C", "D", "D1", "C1"],
    ["D", "A", "A1", "D1"]
  ],
  "auxiliary": [
    { "from": "C2", "to": "A2" },
    { "from": "C2", "to": "B2" },
    { "from": "C2", "to": "D2" }
  ],
  "view": { "azim": -35, "elev": 20 }
}`

const raw = ref(SAMPLE)
const azim = ref(-35)
const elev = ref(20)
const parseErr = ref('')
const alignImg = ref('')
const clicks = ref<[number, number][]>([])
const fitErr = ref<number | null>(null)
const alignBox = ref<HTMLElement | null>(null)

const model = ref<Geom3D | null>(null)
/** 可用的点名（按出现顺序）：模型顶点 + 定比分点解析出来的点。
 *  **跟投影共用 resolveVertices** —— 顺序必须严格一致，否则点选的会是另一个点。 */
const order = computed(() => (model.value ? Object.keys(resolveVertices(model.value)) : []))
const nextName = computed(() => order.value[clicks.value.length] || '')

function parse() {
  parseErr.value = ''
  try {
    const m = JSON.parse(raw.value) as Geom3D & { view?: { azim?: number; elev?: number } }
    // 圆柱 / 圆锥只用 primitive、没有 vertices，别把它们拒了
    const hasVerts = !!m.vertices && Object.keys(m.vertices).length > 0
    if (!m || typeof m !== 'object' || (!hasVerts && !m.primitive)) {
      parseErr.value = '缺少 vertices（或者给 primitive）'; model.value = null; return
    }
    model.value = m
    if (m.view) {
      if (typeof m.view.azim === 'number') azim.value = m.view.azim
      if (typeof m.view.elev === 'number') elev.value = m.view.elev
    }
  } catch (e) {
    parseErr.value = 'JSON 解析失败：' + (e as Error).message
    model.value = null
  }
}
parse()

// 从画布上的三维图形回来 → 还原模型和视角（继续改）
if (props.editId) {
  const el = findEl(props.editId)
  const g = el?.geom3d
  if (g?.model && Object.keys(g.model).length) {
    raw.value = JSON.stringify(g.model, null, 1)
    if (typeof g.azim === 'number') azim.value = g.azim
    if (typeof g.elev === 'number') elev.value = g.elev
    parse()
  }
}

/** 预览 / 插入用的 SVG（参数顺序：kind, pts, w, h, stroke, sw, fill, dsh, vlabels,
 *  edgeStyles, selVertex, selEdge, labelOffsets, faceStyles, selFace, mesh —— mesh 在最后一位） */
const svg = computed(() => {
  const p = proj.value
  if (!p) return ''
  const solid = renderSolid('cube', p.points, W.value, H, '#1a1a1a', 2.6, 'transparent', '6 5',
    p.vlabels, p.edgeStyles.some(Boolean) ? p.edgeStyles : undefined, undefined,
    selKind.value === 'line' && selEdge.value !== null ? selEdge.value : undefined,
    undefined, p.faceStyles.length ? p.faceStyles : undefined, undefined, p.mesh)
  // 圆柱 / 圆锥的底面是**弧图元**，renderSolid 不画它，单独叠一层（跟画布里的做法一致）
  let out = solid + arcsSvg(p.arcs, W.value, H, '#1a1a1a', 2.6)
  // 多选的点自己描一圈（renderSolid 只支持选中一个顶点）
  for (const i of selPoints.value) {
    const cx = p.points[i * 2] * W.value, cy = p.points[i * 2 + 1] * H
    out += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="7" fill="none" stroke="#1668e0" stroke-width="2"/>'
  }
  return out
})

const edgeStat = computed(() => {
  const p = proj.value
  if (!p) return ''
  const dash = p.mesh.edges.filter((e) => e[2]).length
  const arc = p.arcs.length ? '＋' + p.arcs.length + ' 段弧' : ''
  return p.mesh.edges.length + ' 条棱（' + dash + ' 虚线）' + arc
})

// ---------------- 点选 + 属性 ----------------
/** 点到线段的距离（命中测试用） */
function distToSeg(x: number, y: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1
  const L = dx * dx + dy * dy
  const t = L > 0 ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L)) : 0
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))
}
/** 命中测试：先找点（15px 内，点可以多选累加），再找线（9px 内，单选）。
 *  点优先 —— 点小、意图更明确。 */
function pickAt(cx: number, cy: number) {
  const p = proj.value
  if (!p) return
  const px = (i: number) => p.points[i * 2] * W.value
  const py = (i: number) => p.points[i * 2 + 1] * H
  const n = p.points.length / 2
  let bestP = -1, bestD = 15
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(px(i) - cx, py(i) - cy)
    if (d < bestD) { bestD = d; bestP = i }
  }
  if (bestP >= 0 && order.value[bestP]) {
    selKind.value = 'point'
    selEdge.value = null
    const cur = selPoints.value
    selPoints.value = cur.includes(bestP) ? cur.filter((k) => k !== bestP) : [...cur, bestP]
    return
  }
  let bestE = -1
  bestD = 9
  for (let k = 0; k < p.mesh.edges.length; k++) {
    const [a, b] = p.mesh.edges[k]
    const d = distToSeg(cx, cy, px(a), py(a), px(b), py(b))
    if (d < bestD) { bestD = d; bestE = k }
  }
  if (bestE >= 0) { selKind.value = 'line'; selEdge.value = bestE; selPoints.value = [] }
  else { selKind.value = null; selEdge.value = null; selPoints.value = [] }
}

/** 改选中点的标签（清空 = 不显示这个字母） */
function setPointLabel(v: string) {
  const m = model.value
  if (!m || !selNames.value.length) return
  const next = JSON.parse(raw.value) as Geom3D
  const ps = { ...(next.pointStyles || {}) }
  for (const nm of selNames.value) ps[nm] = { ...(ps[nm] || {}), label: v.trim() === '' ? null : v.trim() }
  next.pointStyles = ps
  raw.value = JSON.stringify(next, null, 1)
  parse()
}
/** 改选中线的样式（颜色 / 线宽 / 虚实） */
function setEdgeStyle(patch: { color?: string; width?: number; dash?: 0 | 1 }) {
  const nm = selEdgeNames.value
  if (!nm || !model.value) return
  const key = [...nm].sort().join('|')
  const next = JSON.parse(raw.value) as Geom3D
  const es = { ...(next.edgeStyles || {}) }
  es[key] = { ...(es[key] || {}), ...patch }
  next.edgeStyles = es
  raw.value = JSON.stringify(next, null, 1)
  parse()
}

// ---------------- 已加项（可选中 / 可删 / 可改） ----------------
/** 定比分点列表 */
const addedMarks = computed(() => (model.value?.marks || []).map((k, i) => ({ i, name: k.name, from: k.from, to: k.to, t: k.t })))
/** 辅助线列表 */
const addedAux = computed(() => (model.value?.auxiliary || []).map((a, i) => ({ i, from: a.from, to: a.to, style: a.style || 'auto' })))
/** 删掉一个定比分点 */
function delMark(i: number) {
  if (!model.value) return
  const next = JSON.parse(raw.value) as Geom3D
  next.marks?.splice(i, 1)
  raw.value = JSON.stringify(next, null, 1)
  parse()
}
/** 删掉一条辅助线 */
function delAux(i: number) {
  if (!model.value) return
  const next = JSON.parse(raw.value) as Geom3D
  next.auxiliary?.splice(i, 1)
  raw.value = JSON.stringify(next, null, 1)
  parse()
}
/** 改辅助线的虚实（auto = 按是否穿在体内自动判） */
function setAuxStyle(i: number, style: 'auto' | 'solid' | 'dashed') {
  if (!model.value) return
  const next = JSON.parse(raw.value) as Geom3D
  if (!next.auxiliary?.[i]) return
  next.auxiliary[i] = { ...next.auxiliary[i], style }
  raw.value = JSON.stringify(next, null, 1)
  parse()
}
// ---------------- 自由点（给坐标） ----------------
const fpName = ref('')
const fpX = ref(0)
const fpY = ref(0)
const fpZ = ref(0)
function addFreePoint() {
  if (!model.value) return
  const name = fpName.value.trim() || nextMarkName()
  const next = JSON.parse(raw.value) as Geom3D
  next.freePoints = [
    ...(next.freePoints || []).filter((x) => x.name !== name),
    { name, at: [+fpX.value, +fpY.value, +fpZ.value] as [number, number, number] },
  ]
  raw.value = JSON.stringify(next, null, 1)
  parse()
  fpName.value = ''
}
const addedFree = computed(() => (model.value?.freePoints || []).map((x, i) => ({ i, name: x.name, at: x.at })))
function delFreePoint(i: number) {
  if (!model.value) return
  const next = JSON.parse(raw.value) as Geom3D
  next.freePoints?.splice(i, 1)
  raw.value = JSON.stringify(next, null, 1)
  parse()
}

// ---------------- 点在平面上的投影 ----------------
const ppFrom = ref('')
const ppPlane = ref(-1)
const ppName = ref('')
const ppFoot = ref(true)
function addProject() {
  const pl = planes.value[ppPlane.value]
  if (!model.value || !pl || !ppFrom.value) return
  const name = ppName.value.trim() || nextMarkName()
  const next = JSON.parse(raw.value) as Geom3D
  next.projectPoints = [
    ...(next.projectPoints || []).filter((x) => x.name !== name),
    { name, from: ppFrom.value, plane: pl.pts.slice(), foot: ppFoot.value },
  ]
  raw.value = JSON.stringify(next, null, 1)
  parse()
  ppName.value = ''
}
const addedProjects = computed(() => (model.value?.projectPoints || []).map((x, i) => ({ i, name: x.name, from: x.from, plane: x.plane.join('-'), foot: !!x.foot })))
function delProject(i: number) {
  if (!model.value) return
  const next = JSON.parse(raw.value) as Geom3D
  next.projectPoints?.splice(i, 1)
  raw.value = JSON.stringify(next, null, 1)
  parse()
}

// ---------------- 两平面的交线 ----------------
const ilA = ref(-1)
const ilB = ref(-1)
function addIntersect() {
  const pa = planes.value[ilA.value]
  const pb = planes.value[ilB.value]
  if (!model.value || !pa || !pb || ilA.value === ilB.value || ilA.value < 0 || ilB.value < 0) return
  const next = JSON.parse(raw.value) as Geom3D
  next.intersectLines = [...(next.intersectLines || []), { a: pa.pts.slice(), b: pb.pts.slice() }]
  raw.value = JSON.stringify(next, null, 1)
  parse()
}
const addedIntersects = computed(() => (model.value?.intersectLines || []).map((x, i) => ({ i, a: x.a.join('-'), b: x.b.join('-') })))
function delIntersect(i: number) {
  if (!model.value) return
  const next = JSON.parse(raw.value) as Geom3D
  next.intersectLines?.splice(i, 1)
  raw.value = JSON.stringify(next, null, 1)
  parse()
}

// ---------------- 直线与平面的交点 ----------------
const meetA = ref('')
const meetB = ref('')
const meetPlane = ref(-1)
const meetName = ref('')
function addMeet() {
  const pl = planes.value[meetPlane.value]
  if (!model.value || !pl || !meetA.value || !meetB.value || meetA.value === meetB.value) return
  const name = meetName.value.trim() || nextMarkName()
  const next = JSON.parse(raw.value) as Geom3D
  next.meetPoints = [
    ...(next.meetPoints || []).filter((x) => x.name !== name),
    { name, line: [meetA.value, meetB.value] as [string, string], plane: pl.pts.slice() },
  ]
  raw.value = JSON.stringify(next, null, 1)
  parse()
  meetName.value = ''
}
/** 交点列表（可删） */
const addedMeets = computed(() => (model.value?.meetPoints || []).map((x, i) => ({ i, name: x.name, line: x.line, plane: x.plane.join('-') })))
function delMeet(i: number) {
  if (!model.value) return
  const next = JSON.parse(raw.value) as Geom3D
  next.meetPoints?.splice(i, 1)
  raw.value = JSON.stringify(next, null, 1)
  parse()
}

/** 点列表里的某一行 → 在图上选中对应的线（编辑反馈） */
function selectAux(from: string, to: string) {
  const p = proj.value
  if (!p) return
  const ia = order.value.indexOf(from)
  const ib = order.value.indexOf(to)
  const k = p.mesh.edges.findIndex((e) => (e[0] === ia && e[1] === ib) || (e[0] === ib && e[1] === ia))
  if (k >= 0) { selKind.value = 'line'; selEdge.value = k; selPoints.value = [] }
}

/** 平面列表（手画的截面 + 三点定的平面），用于调填充 / 删除 */
const planes = computed(() => {
  const m = model.value
  type P = { kind: 'cut' | 'plane'; i: number; label: string; fill: string | null | undefined; pts: string[] }
  if (!m) return [] as P[]
  const out: P[] = []
  ;(m.cutPlanes || []).forEach((cp, i) => out.push({ kind: 'cut', i, label: (cp.points || []).join('-'), fill: cp.fill, pts: cp.points || [] }))
  ;(m.planeCuts || []).forEach((cp, i) => out.push({ kind: 'plane', i, label: (cp.through || []).join('-'), fill: cp.fill, pts: cp.through || [] }))
  return out
})
/** 改平面填充色（null = 只描边不填充） */
function setPlaneFill(kind: 'cut' | 'plane', idx: number, fill: string | null) {
  if (!model.value) return
  const next = JSON.parse(raw.value) as Geom3D
  const arr = kind === 'cut' ? next.cutPlanes : next.planeCuts
  if (!arr || !arr[idx]) return
  arr[idx] = { ...arr[idx], fill }
  raw.value = JSON.stringify(next, null, 1)
  parse()
}
function delPlane(kind: 'cut' | 'plane', idx: number) {
  if (!model.value) return
  const next = JSON.parse(raw.value) as Geom3D
  const arr = kind === 'cut' ? next.cutPlanes : next.planeCuts
  if (!arr) return
  arr.splice(idx, 1)
  raw.value = JSON.stringify(next, null, 1)
  parse()
}

/** 选两点 → 连成线（写成辅助线，虚实自动判） */
function connectSel() {
  if (selNames.value.length !== 2 || !model.value) return
  const [a, b] = selNames.value
  const next = JSON.parse(raw.value) as Geom3D
  const aux = next.auxiliary || []
  if (!aux.some((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a))) {
    next.auxiliary = [...aux, { from: a, to: b, style: 'auto' }]
    raw.value = JSON.stringify(next, null, 1)
    parse()
  }
}
/** 选三点及以上 → 过这些点作平面（算出它与多面体的截面；共面时就是那个多边形） */
function planeSel() {
  if (selNames.value.length < 3 || !model.value) return
  const next = JSON.parse(raw.value) as Geom3D
  next.planeCuts = [...(next.planeCuts || []), { through: selNames.value.slice(), fill: '#8ecae6' }]
  raw.value = JSON.stringify(next, null, 1)
  parse()
}

// ---------------- 拖拽转视角 ----------------
/** 按住图形区拖动 = 转视角（水平改方位角、垂直改仰角），松手即止。
 *  这是"三维编辑器"最基本的交互，也是后面点选/画线/画平面的地基。 */
const orbiting = ref(false)
let orbitLast: [number, number] = [0, 0]
/** 这次按下到底"拖"了还是"点"了 —— 拖动过就不当点击，免得转视角顺手改了选择 */
let orbitMoved = false
function onOrbitDown(e: PointerEvent) {
  orbiting.value = true
  orbitMoved = false
  orbitLast = [e.clientX, e.clientY]
  try { (e.currentTarget as Element).setPointerCapture(e.pointerId) } catch { /* 忽略 */ }
}
function onOrbitMove(e: PointerEvent) {
  if (!orbiting.value) return
  const dx = e.clientX - orbitLast[0]
  const dy = e.clientY - orbitLast[1]
  if (Math.abs(dx) + Math.abs(dy) > 2) orbitMoved = true
  orbitLast = [e.clientX, e.clientY]
  let a = azim.value - dx * 0.55
  while (a > 180) a -= 360
  while (a < -180) a += 360
  azim.value = Math.round(a)
  elev.value = Math.max(-80, Math.min(80, Math.round(elev.value + dy * 0.45)))
}
function onOrbitUp(e: PointerEvent) {
  const was = orbiting.value
  orbiting.value = false
  if (!was || orbitMoved) return
  // 是"点"不是"拖" → 命中测试（屏幕坐标 → 元素坐标，viewBox 用 none 所以是等比的）
  const box = (e.currentTarget as Element).getBoundingClientRect()
  pickAt(((e.clientX - box.left) / box.width) * W.value, ((e.clientY - box.top) / box.height) * H)
}

// ---------------- 截图描点对齐 ----------------
function pickImage() { const el = document.getElementById('g3-img') as HTMLInputElement | null; el?.click() }
function onPicked(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files && input.files[0]
  input.value = ''
  if (!f) return
  const r = new FileReader()
  r.onload = () => { alignImg.value = String(r.result || ''); clicks.value = []; fitErr.value = null }
  r.readAsDataURL(f)
}
function onClickImage(e: MouseEvent) {
  const box = alignBox.value
  if (!box || !model.value) return
  const r = box.getBoundingClientRect()
  clicks.value = [...clicks.value, [e.clientX - r.left, e.clientY - r.top]]
}
function solve() {
  if (!model.value || clicks.value.length < 3) { fitErr.value = null; return }
  const s = solveView(model.value, order.value, clicks.value)
  azim.value = Math.round(s.azim * 10) / 10
  elev.value = Math.round(s.elev * 10) / 10
  fitErr.value = s.err
}
/** 复制提示词：这份 JSON app 自己不会生成 —— 它由大模型按提示词把题目翻译出来。
 *  所以把提示词一键复制，跟题目（文字或题图）一起发给任意 AI 即可。 */
const copied = ref(false)
async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(GEOM3D_PROMPT)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1600)
  } catch {
    // 剪贴板不可用（无权限等）就退回"选中让用户自己复制"
    const ta = document.createElement('textarea')
    ta.value = GEOM3D_PROMPT
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1600)
  }
}
function usePreset(json: string) {
  raw.value = json
  parse()
}

// ---------------- 两直线的交点 ----------------
const lmP = ref(['', '', '', ''] as string[])
const lmName = ref('')
const lmMsg = ref('')
function addLineMeet() {
  if (!model.value || lmP.value.some((x) => !x) || lmP.value[0] === lmP.value[1] || lmP.value[2] === lmP.value[3]) return
  const name = lmName.value.trim() || nextMarkName()
  const next = JSON.parse(raw.value) as Geom3D
  next.lineMeets = [
    ...(next.lineMeets || []).filter((x) => x.name !== name),
    { name, a: [lmP.value[0], lmP.value[1]] as [string, string], b: [lmP.value[2], lmP.value[3]] as [string, string] },
  ]
  raw.value = JSON.stringify(next, null, 1)
  parse()
  // 算得出才算数 —— 异面/平行时给个明确反馈（否则"点了没反应"很迷惑）
  lmMsg.value = order.value.includes(name) ? '' : '这两条直线不相交（异面或平行），算不出交点'
  lmName.value = ''
}
const addedLineMeets = computed(() => (model.value?.lineMeets || []).map((x, i) => ({ i, name: x.name, a: x.a.join(''), b: x.b.join('') })))
function delLineMeet(i: number) {
  if (!model.value) return
  const next = JSON.parse(raw.value) as Geom3D
  next.lineMeets?.splice(i, 1)
  raw.value = JSON.stringify(next, null, 1)
  parse()
}

/** 一键清空"已加的"（保留模型本身）—— 加了一堆想重来时最省事 */
function clearAdded() {
  if (!model.value) return
  const next = JSON.parse(raw.value) as Geom3D
  for (const k of ['marks', 'freePoints', 'meetPoints', 'lineMeets', 'projectPoints', 'auxiliary', 'cutPlanes', 'planeCuts', 'intersectLines', 'hidden'] as const) {
    delete (next as unknown as Record<string, unknown>)[k]
  }
  raw.value = JSON.stringify(next, null, 1)
  parse()
  lmMsg.value = ''
}

// ---------------- 图元显隐 ----------------
/** 切换一条图元的隐藏状态（键的写法见 Geom3D.hidden 的注释） */
function toggleHidden(key: string) {
  if (!model.value) return
  const next = JSON.parse(raw.value) as Geom3D
  const hs = new Set(next.hidden || [])
  if (hs.has(key)) hs.delete(key)
  else hs.add(key)
  next.hidden = [...hs]
  raw.value = JSON.stringify(next, null, 1)
  parse()
}
const isHidden = (key: string) => (model.value?.hidden || []).includes(key)

// ---------------- 顶点坐标（可直接改） ----------------
/** 一张可编辑的顶点表：模型自带顶点 + 自由点可以改坐标；
 *  定比分点 / 交点 / 截面点这些是**算出来的**，只读展示（灰掉）。 */
const vertexRows = computed(() => {
  const m = model.value
  if (!m) return [] as { name: string; at: [number, number, number]; kind: 'base' | 'free' | 'derived'; i: number }[]
  const rows: { name: string; at: [number, number, number]; kind: 'base' | 'free' | 'derived'; i: number }[] = []
  Object.entries(m.vertices || {}).forEach(([n, at]) => rows.push({ name: n, at, kind: 'base', i: -1 }))
  ;(m.freePoints || []).forEach((fp, i) => { if (!rows.some((r) => r.name === fp.name)) rows.push({ name: fp.name, at: fp.at, kind: 'free', i }) })
  const known = new Set(rows.map((r) => r.name))
  for (const r of order.value) if (!known.has(r)) rows.push({ name: r, at: [0, 0, 0], kind: 'derived', i: -1 })
  return rows
})
/** 改一个顶点的坐标（只对 base / free 有效） */
function setVertexAt(row: { name: string; kind: string; i: number }, k: number, v: number) {
  if (!model.value || row.kind === 'derived' || !isFinite(v)) return
  const next = JSON.parse(raw.value) as Geom3D
  if (row.kind === 'base') {
    const cur = next.vertices[row.name]
    if (!cur) return
    next.vertices[row.name] = [cur[0], cur[1], cur[2]]
    next.vertices[row.name][k] = +v
  } else if (row.kind === 'free' && next.freePoints?.[row.i]) {
    const cur = next.freePoints[row.i].at
    next.freePoints[row.i].at = [cur[0], cur[1], cur[2]]
    next.freePoints[row.i].at[k] = +v
  }
  raw.value = JSON.stringify(next, null, 1)
  parse()
}

// ---------------- 我的预设（存本地） ----------------
const MY_KEY = 'lj-mathslides-geom3d-presets'
function loadMy(): { name: string; json: string }[] {
  try { return (JSON.parse(localStorage.getItem(MY_KEY) || '[]') || []) as { name: string; json: string }[] } catch { return [] }
}
const myPresets = ref<{ name: string; json: string }[]>(loadMy())
const myName = ref('')
/** 把当前模型（连视角）存成一个常用预设 —— 常画的图形不用每次重搭 */
function saveMy() {
  const m = model.value
  if (!m) return
  const name = myName.value.trim() || '未命名图形'
  const json = JSON.stringify({ ...m, view: { azim: azim.value, elev: elev.value } }, null, 1)
  myPresets.value = [...myPresets.value.filter((p) => p.name !== name), { name, json }]
  try { localStorage.setItem(MY_KEY, JSON.stringify(myPresets.value)) } catch { /* 存不下就算了 */ }
  myName.value = ''
}
function delMy(name: string) {
  myPresets.value = myPresets.value.filter((p) => p.name !== name)
  try { localStorage.setItem(MY_KEY, JSON.stringify(myPresets.value)) } catch { /* 忽略 */ }
}

// ---------------- 搭模型（不依赖 AI） ----------------
const bType = ref<'cube' | 'box' | 'prism' | 'pyramid' | 'cylinder' | 'cone'>('prism')
const bN = ref(4)
const bA = ref(2)
const bB = ref(1.4)
const bH = ref(2)
/** 参数化生成 → 写回 JSON 文本框（文本框始终是唯一数据源，手改也行） */
const bAxial = ref(false)
function build() {
  const m = buildSolid({ type: bType.value, n: bN.value, a: bA.value, b: bB.value, h: bH.value })
  // 圆柱 / 圆锥可以勾"轴截面"（教材里那个着色的三角形 / 矩形）
  if (m.primitive && bAxial.value) m.primitive.axial = 1
  const view = { azim: azim.value, elev: elev.value }
  raw.value = JSON.stringify({ ...m, view }, null, 1)
  parse()
}

/** 在当前模型上加一条辅助线（选 from/to + 线型）。高 PO、体对角线 AC₁ 都这么加。 */
const auxFrom = ref('')
const auxTo = ref('')
const auxStyle = ref<'auto' | 'solid' | 'dashed'>('auto')
function addAux() {
  const m = model.value
  if (!m || !auxFrom.value || !auxTo.value || auxFrom.value === auxTo.value) return
  const next = JSON.parse(raw.value) as Geom3D
  next.auxiliary = [...(next.auxiliary || []), { from: auxFrom.value, to: auxTo.value, style: auxStyle.value }]
  raw.value = JSON.stringify(next, null, 1)
  parse()
}

// ---------------- 定比分点 ----------------
/** 定比分点：P = A + t·(B−A)。中点 t=0.5、三等分点 t=1/3，任意比都行。 */
const mkFrom = ref('')
const mkTo = ref('')
const mkT = ref(0.5)
const mkName = ref('')
/** **所有已占用的点名**（顶点 + 各种"算出来的点"）。
 *  必须把 marks / freePoints / meetPoints / lineMeets / projectPoints 全算上 ——
 *  只看 vertices 会导致新点重名，而按名字去重会把**旧点悄悄顶掉**（测试抓到的真 bug）。 */
const usedNames = computed(() => {
  const m = model.value
  const s = new Set<string>()
  if (!m) return s
  for (const n of Object.keys(m.vertices || {})) s.add(n)
  for (const k of m.marks || []) if (k?.name) s.add(k.name)
  for (const k of m.freePoints || []) if (k?.name) s.add(k.name)
  for (const k of m.meetPoints || []) if (k?.name) s.add(k.name)
  for (const k of m.lineMeets || []) if (k?.name) s.add(k.name)
  for (const k of m.projectPoints || []) if (k?.name) s.add(k.name)
  return s
})
/** 默认给还没用过的字母（M、N、E、F…）—— 教材里中点常叫 M / N / E */
function nextMarkName(): string {
  const used = usedNames.value
  for (const c of ['M', 'N', 'E', 'F', 'G', 'H', 'K', 'Q', 'R', 'S', 'T']) {
    if (!used.has(c)) return c
  }
  return 'M'
}
function addMark() {
  const m = model.value
  if (!m || !mkFrom.value || !mkTo.value || mkFrom.value === mkTo.value) return
  const name = mkName.value.trim() || nextMarkName()
  const next = JSON.parse(raw.value) as Geom3D
  // 同一个字母重复定义会乱：先把旧的同名那条去掉
  next.marks = [...(next.marks || []).filter((x) => x.name !== name), { name, from: mkFrom.value, to: mkTo.value, t: mkT.value }]
  raw.value = JSON.stringify(next, null, 1)
  parse()
  mkName.value = ''
}

/** 加截面 / 辅助面：输入一串顶点名（空格或逗号分隔），按这个顺序围成多边形。
 *  例题里的"截面 A-C-B₁"就是这三个字。填充色浅黄，只描边就留空颜色。 */
const cutText = ref('')
const cutFill = ref(true)
function addCut() {
  const m = model.value
  if (!m) return
  const ids = cutText.value.split(/[\s,，]+/).map((s) => s.trim()).filter(Boolean)
  if (ids.length < 3) return
  const bad = ids.filter((n) => !(n in m.vertices))
  if (bad.length) { parseErr.value = '截面里有不存在的顶点：' + bad.join('、'); return }
  const next = JSON.parse(raw.value) as Geom3D
  next.cutPlanes = [...(next.cutPlanes || []), { points: ids, fill: cutFill.value ? '#f0c674' : null }]
  raw.value = JSON.stringify(next, null, 1)
  parse()
  cutText.value = ''
}

/** **多点确定平面 → 求截面**：给三个（或更多）点，算出平面与该多面体的真实截面多边形。 */
const planeText = ref('')
function addPlaneCut() {
  const m = model.value
  if (!m) return
  const ids = planeText.value.split(/[\s,，]+/).map((s) => s.trim()).filter(Boolean)
  if (ids.length < 3) { parseErr.value = '至少要三个点才能确定平面'; return }
  const markNames = new Set((m.marks || []).map((x) => x.name))
  const bad = ids.filter((n) => !(n in (m.vertices || {})) && !markNames.has(n))
  if (bad.length) { parseErr.value = '平面里有不存在的点：' + bad.join('、'); return }
  const next = JSON.parse(raw.value) as Geom3D
  next.planeCuts = [...(next.planeCuts || []), { through: ids, fill: '#8ecae6' }]
  raw.value = JSON.stringify(next, null, 1)
  parse()
  planeText.value = ''
}

/** 棱柱：给每条竖棱加一个中点（A2 / B2 / …）—— 教材里那排"中点"一点就齐。 */
function addMidpoints() {
  const m = model.value
  if (!m) return
  const next = JSON.parse(raw.value) as Geom3D
  const add: Record<string, [number, number, number]> = {}
  for (const n of Object.keys(next.vertices)) {
    const base = n.replace(/\d+$/, '')
    const top = base + '1'
    if (!n.endsWith('1') || !next.vertices[top] || !next.vertices[base]) continue
    const lo = next.vertices[base], hi = next.vertices[top]
    add[base + '2'] = [lo[0], lo[1], +((lo[2] + hi[2]) / 2).toFixed(4)]
  }
  if (!Object.keys(add).length) return
  next.vertices = { ...next.vertices, ...add }
  raw.value = JSON.stringify(next, null, 1)
  parse()
}

function insert() {
  const m = model.value
  if (!m) return
  const p = projectGeom(m, { azim: azim.value, elev: elev.value })
  const patch = {
    kind: 'cube', points: p.points, mesh: p.mesh, vlabels: p.vlabels,
    arcs: p.arcs.length ? p.arcs : undefined,
    faceStyles: p.faceStyles.length ? p.faceStyles : undefined,
    edgeStyles: p.edgeStyles.some(Boolean) ? p.edgeStyles : undefined,
    // **把源模型存进元素** —— 否则插进画布就"死"了，改不了视角也改不了模型
    geom3d: { model: m as unknown as Record<string, unknown>, azim: azim.value, elev: elev.value },
  }
  const el = props.editId ? findEl(props.editId) : undefined
  if (el) {
    // 继续编辑：保留原来的位置和尺寸（用户可能已经拖过、缩过）
    store.updateElement(el.id, { ...patch, x: el.x, y: el.y, w: el.w, h: el.h } as never)
  } else {
    store.addElement('mathfig', { ...patch, w: W.value, h: H, fill: 'transparent', stroke: '#1a1a1a', strokeWidth: 2.6 } as never)
  }
  closeGeom3D()
}
</script>

<template>
  <div class="g3" @mousedown.self="closeGeom3D()">
    <div class="g3__box">
      <header class="g3__head">
        <span class="g3__title">{{ props.editId ? '编辑三维模型' : '三维立体图' }} —— 由模型算出虚实</span>
        <button class="g3__close" @click="closeGeom3D()"><AppIcon name="close" :size="13" /></button>
      </header>

      <div class="g3__body">
        <div class="g3__left" :data-tab="tab">
          <div class="g3__tabs">
            <button :class="{ 'g3__tab--on': tab === 'model' }" @click="tab = 'model'">① 模型</button>
            <button :class="{ 'g3__tab--on': tab === 'draw' }" @click="tab = 'draw'">② 作图</button>
            <button :class="{ 'g3__tab--on': tab === 'list' }" @click="tab = 'list'">③ 图元</button>
          </div>
          <div class="g3__sec g3__sec--model g3__lab">几何描述（JSON：vertices 必填，faces 决定虚实）</div>
          <div class="g3__sec g3__sec--model g3__row g3__row--top">
            <select class="g3__sel" @change="usePreset(($event.target as HTMLSelectElement).value)">
              <option value="">常用几何体…</option>
              <option v-for="p in GEOM3D_PRESETS" :key="p.name" :value="p.json">{{ p.name }}</option>
              <optgroup v-if="myPresets.length" label="我的预设">
                <option v-for="p in myPresets" :key="'my' + p.name" :value="p.json">{{ p.name }}</option>
              </optgroup>
            </select>
            <input v-model="myName" class="g3__inp g3__inp--sm" placeholder="预设名" title="给当前模型起个名字，存成常用预设">
            <button class="g3__btn" title="把当前模型（连视角）存成常用预设" @click="saveMy()">存为常用</button>
            <button class="g3__btn" title="想把题目交给 AI 翻译成 JSON 时用：复制提示词，连同题目一起发出去" @click="copyPrompt()">
              {{ copied ? '已复制 ✓' : '复制提示词（可选）' }}
            </button>
          </div>

          <div class="g3__sec g3__sec--model g3__build">
            <div class="g3__lab">搭一个（不用 AI）</div>
            <div class="g3__row g3__row--top">
              <select v-model="bType" class="g3__sel">
                <option value="prism">正 n 棱柱</option>
                <option value="pyramid">正 n 棱锥</option>
                <option value="cube">正方体</option>
                <option value="box">长方体</option>
                <option value="cylinder">圆柱</option>
                <option value="cone">圆锥</option>
                <option value="sphere">球</option>
              </select>
              <label v-if="bType === 'prism' || bType === 'pyramid'" class="g3__num">n <input v-model.number="bN" type="number" min="3" max="12"></label>
              <label class="g3__num">{{ bType === 'cube' ? '棱长' : (bType === 'cylinder' || bType === 'cone' ? '底半径' : '长/底边') }} <input v-model.number="bA" type="number" step="0.1"></label>
              <label v-if="bType === 'box'" class="g3__num">宽 <input v-model.number="bB" type="number" step="0.1"></label>
              <label class="g3__num">高 <input v-model.number="bH" type="number" step="0.1"></label>
              <label v-if="bType === 'cylinder' || bType === 'cone'" class="g3__num" title="教材里那种着色的轴截面（圆锥=三角形 AOB）">
                <input v-model="bAxial" type="checkbox"> 轴截面
              </label>
              <button class="g3__btn" @click="build()">生成</button>
              <button class="g3__btn" title="给每条竖棱加中点（A2 / B2 / …）" @click="addMidpoints()">＋竖棱中点</button>
            </div>
            <div class="g3__row g3__row--top">
              <span class="g3__tip g3__tip--inline">加辅助线（高 PO、体对角线 AC₁ 这类）：</span>
              <select v-model="auxFrom" class="g3__sel g3__sel--sm">
                <option value="">从…</option>
                <option v-for="n in order" :key="'af' + n" :value="n">{{ n }}</option>
              </select>
              <select v-model="auxTo" class="g3__sel g3__sel--sm">
                <option value="">到…</option>
                <option v-for="n in order" :key="'at' + n" :value="n">{{ n }}</option>
              </select>
              <select v-model="auxStyle" class="g3__sel g3__sel--sm">
                <option value="auto">自动判</option>
                <option value="solid">实线</option>
                <option value="dashed">虚线</option>
              </select>
              <button class="g3__btn" @click="addAux()">添加</button>
            </div>
          </div>
            <div v-if="addedMarks.length || addedAux.length || addedFree.length || planes.length" class="g3__sec g3__sec--list g3__row g3__row--top">
              <button class="g3__btn" title="清空所有后加的图元（点/线/面），保留模型本身" @click="clearAdded()">清空已加的图元</button>
            </div>
            <div v-if="vertexRows.length" class="g3__sec g3__sec--model g3__verts">
              <div class="g3__lab">顶点坐标 <span class="g3__vsub">（白底可改；灰的是算出来的，只读）</span></div>
              <div class="g3__vlist">
                <div v-for="r in vertexRows" :key="'v' + r.name" class="g3__vrow">
                  <b :class="{ 'g3__vname--derived': r.kind === 'derived' }">{{ r.name }}</b>
                  <input
                    v-for="k in 3" :key="'k' + k" type="number" step="0.1"
                    :class="{ 'g3__vinp--ro': r.kind === 'derived' }"
                    :readonly="r.kind === 'derived'"
                    :value="r.kind === 'derived' ? '' : r.at[k - 1]"
                    :placeholder="r.kind === 'derived' ? '算' : ''"
                    @change="setVertexAt(r, k - 1, +($event.target as HTMLInputElement).value)"
                  >
                  <span class="g3__vtag">{{ r.kind === 'base' ? '模型' : r.kind === 'free' ? '自由' : '算' }}</span>
                </div>
              </div>
            </div>
            <div v-if="myPresets.length" class="g3__sec g3__sec--model g3__row g3__row--top">
              <span class="g3__tip g3__tip--inline">我的预设：</span>
              <span v-for="p in myPresets" :key="'myp' + p.name" class="g3__plane">
                <b class="g3__link" title="载入这个预设" @click="usePreset(p.json)">{{ p.name }}</b>
                <button class="g3__btn g3__btn--tiny" title="删掉这个预设" @click="delMy(p.name)">×</button>
              </span>
            </div>
            <div class="g3__sec g3__sec--draw g3__row g3__row--top">
              <span class="g3__tip g3__tip--inline">自由点（给坐标）：</span>
              <input v-model="fpName" class="g3__inp g3__inp--sm" :placeholder="nextMarkName()">
              <label class="g3__num">x <input v-model.number="fpX" type="number" step="0.1"></label>
              <label class="g3__num">y <input v-model.number="fpY" type="number" step="0.1"></label>
              <label class="g3__num">z <input v-model.number="fpZ" type="number" step="0.1"></label>
              <button class="g3__btn" @click="addFreePoint()">加自由点</button>
            </div>
            <div class="g3__sec g3__sec--draw g3__row g3__row--top">
              <span class="g3__tip g3__tip--inline">定比分点 P = A + t(B−A)：</span>
              <select v-model="mkFrom" class="g3__sel g3__sel--sm">
                <option value="">从…</option>
                <option v-for="n in order" :key="'mf' + n" :value="n">{{ n }}</option>
              </select>
              <select v-model="mkTo" class="g3__sel g3__sel--sm">
                <option value="">到…</option>
                <option v-for="n in order" :key="'mt' + n" :value="n">{{ n }}</option>
              </select>
              <label class="g3__num">t <input v-model.number="mkT" type="number" step="0.05" min="0" max="1"></label>
              <button class="g3__btn g3__btn--tiny" @click="mkT = 0.5">1/2</button>
              <button class="g3__btn g3__btn--tiny" @click="mkT = +(1 / 3).toFixed(4)">1/3</button>
              <input v-model="mkName" class="g3__inp g3__inp--sm" :placeholder="nextMarkName()">
              <button class="g3__btn" @click="addMark()">加定比分点</button>
            </div>
            <div v-if="addedMarks.length || addedAux.length || addedFree.length" class="g3__sec g3__sec--list g3__row g3__row--top g3__row--stack">
              <span class="g3__tip g3__tip--inline">已加的（可删）：</span>
              <span
                v-for="mk in addedMarks" :key="'mk' + mk.i" class="g3__plane"
                :title="'定比分点 ' + mk.name + ' = ' + mk.from + ' + ' + mk.t + '×(' + mk.to + ' − ' + mk.from + ')'"
              >
                <b :class="{ 'g3__off': isHidden('p:' + mk.name) }">点 {{ mk.name }}</b>
                <button class="g3__btn g3__btn--tiny" :title="isHidden('p:' + mk.name) ? '显示字母' : '隐藏字母'" @click="toggleHidden('p:' + mk.name)">{{ isHidden('p:' + mk.name) ? '○' : '●' }}</button>
                <button class="g3__btn g3__btn--tiny" title="删掉这个点" @click="delMark(mk.i)">×</button>
              </span>
              <span v-for="fp in addedFree" :key="'fp' + fp.i" class="g3__plane" :title="'自由点 (' + fp.at.join(', ') + ')'">
                <b :class="{ 'g3__off': isHidden('p:' + fp.name) }">点 {{ fp.name }}</b><span class="g3__meet">{{ fp.at.join(',') }}</span>
                <button class="g3__btn g3__btn--tiny" :title="isHidden('p:' + fp.name) ? '显示' : '隐藏'" @click="toggleHidden('p:' + fp.name)">{{ isHidden('p:' + fp.name) ? '○' : '●' }}</button>
                <button class="g3__btn g3__btn--tiny" @click="delFreePoint(fp.i)">×</button>
              </span>
              <span v-for="ax in addedAux" :key="'ax' + ax.i" class="g3__plane">
                <b class="g3__link" title="在图上选中这条线" @click="selectAux(ax.from, ax.to)">线 {{ ax.from }}–{{ ax.to }}</b>
                <button class="g3__btn g3__btn--tiny" :title="isHidden('aux:' + ax.i) ? '显示这条线' : '隐藏这条线'" @click="toggleHidden('aux:' + ax.i)">{{ isHidden('aux:' + ax.i) ? '○' : '●' }}</button>
                <button class="g3__btn g3__btn--tiny" :class="{ 'g3__btn--on': ax.style === 'auto' }" @click="setAuxStyle(ax.i, 'auto')">自动</button>
                <button class="g3__btn g3__btn--tiny" :class="{ 'g3__btn--on': ax.style === 'solid' }" @click="setAuxStyle(ax.i, 'solid')">实</button>
                <button class="g3__btn g3__btn--tiny" :class="{ 'g3__btn--on': ax.style === 'dashed' }" @click="setAuxStyle(ax.i, 'dashed')">虚</button>
                <button class="g3__btn g3__btn--tiny" title="删掉这条辅助线" @click="delAux(ax.i)">×</button>
              </span>
            </div>
            <div class="g3__sec g3__sec--draw g3__row g3__row--top">
              <span class="g3__tip g3__tip--inline">两直线的交点：</span>
              <select v-for="(_, k) in 4" :key="'lm' + k" v-model="lmP[k]" class="g3__sel g3__sel--sm">
                <option value="">{{ k % 2 === 0 ? '线' + (k < 2 ? 1 : 2) + '点1' : '点2' }}</option>
                <option v-for="n in order" :key="'lmo' + k + n" :value="n">{{ n }}</option>
              </select>
              <input v-model="lmName" class="g3__inp g3__inp--sm" :placeholder="nextMarkName()">
              <button class="g3__btn" @click="addLineMeet()">求交点</button>
            </div>
            <div v-if="lmMsg || addedLineMeets.length" class="g3__sec g3__sec--draw g3__row g3__row--top">
              <span v-if="lmMsg" class="g3__warn">{{ lmMsg }}</span>
              <span v-for="lm in addedLineMeets" :key="'lmj' + lm.i" class="g3__plane">
                <b>{{ lm.name }}</b><span class="g3__meet">{{ lm.a }} ∩ {{ lm.b }}</span>
                <button class="g3__btn g3__btn--tiny" @click="delLineMeet(lm.i)">×</button>
              </span>
            </div>
            <div v-if="planes.length" class="g3__sec g3__sec--draw g3__row g3__row--top">
              <span class="g3__tip g3__tip--inline">点在平面上的投影（射影）：</span>
              <select v-model="ppFrom" class="g3__sel g3__sel--sm">
                <option value="">点…</option>
                <option v-for="n in order" :key="'ppf' + n" :value="n">{{ n }}</option>
              </select>
              <select v-model.number="ppPlane" class="g3__sel g3__sel--sm" style="min-width:100px">
                <option :value="-1">投到平面…</option>
                <option v-for="(pl, k) in planes" :key="'ppp' + k" :value="k">{{ pl.label }}</option>
              </select>
              <label class="g3__num" title="同时画一条从该点到射影的垂线"><input v-model="ppFoot" type="checkbox"> 连垂线</label>
              <input v-model="ppName" class="g3__inp g3__inp--sm" :placeholder="nextMarkName()">
              <button class="g3__btn" @click="addProject()">求投影</button>
            </div>
            <div v-if="addedProjects.length" class="g3__sec g3__sec--draw g3__row g3__row--top">
              <span class="g3__tip g3__tip--inline">射影：</span>
              <span v-for="pp in addedProjects" :key="'ppj' + pp.i" class="g3__plane">
                <b>{{ pp.name }}</b><span class="g3__meet">{{ pp.from }} → {{ pp.plane }}{{ pp.foot ? ' ·垂线' : '' }}</span>
                <button class="g3__btn g3__btn--tiny" @click="delProject(pp.i)">×</button>
              </span>
            </div>
            <div v-if="planes.length >= 2" class="g3__sec g3__sec--draw g3__row g3__row--top">
              <span class="g3__tip g3__tip--inline">两平面的交线：</span>
              <select v-model.number="ilA" class="g3__sel g3__sel--sm" style="min-width:100px">
                <option :value="-1">平面 A…</option>
                <option v-for="(pl, k) in planes" :key="'ila' + k" :value="k">{{ pl.label }}</option>
              </select>
              <select v-model.number="ilB" class="g3__sel g3__sel--sm" style="min-width:100px">
                <option :value="-1">平面 B…</option>
                <option v-for="(pl, k) in planes" :key="'ilb' + k" :value="k">{{ pl.label }}</option>
              </select>
              <button class="g3__btn" @click="addIntersect()">求交线</button>
            </div>
            <div v-if="addedIntersects.length" class="g3__sec g3__sec--draw g3__row g3__row--top">
              <span class="g3__tip g3__tip--inline">交线：</span>
              <span v-for="il in addedIntersects" :key="'il' + il.i" class="g3__plane">
                <b>{{ il.a }}</b><span class="g3__meet">∩ {{ il.b }}</span>
                <button class="g3__btn g3__btn--tiny" @click="delIntersect(il.i)">×</button>
              </span>
            </div>
            <div v-if="planes.length" class="g3__sec g3__sec--draw g3__row g3__row--top">
              <span class="g3__tip g3__tip--inline">直线与平面的交点（如 A₁C 与平面 AB₁D₁）：</span>
              <select v-model="meetA" class="g3__sel g3__sel--sm">
                <option value="">点1</option>
                <option v-for="n in order" :key="'ma' + n" :value="n">{{ n }}</option>
              </select>
              <select v-model="meetB" class="g3__sel g3__sel--sm">
                <option value="">点2</option>
                <option v-for="n in order" :key="'mb' + n" :value="n">{{ n }}</option>
              </select>
              <span class="g3__tip g3__tip--inline">与平面</span>
              <select v-model.number="meetPlane" class="g3__sel g3__sel--sm" style="min-width:100px">
                <option :value="-1">选平面…</option>
                <option v-for="(pl, k) in planes" :key="'mp' + k" :value="k">{{ pl.label }}</option>
              </select>
              <input v-model="meetName" class="g3__inp g3__inp--sm" :placeholder="nextMarkName()">
              <button class="g3__btn" @click="addMeet()">求交点</button>
            </div>
            <div v-if="addedMeets.length" class="g3__sec g3__sec--draw g3__row g3__row--top">
              <span class="g3__tip g3__tip--inline">交点：</span>
              <span v-for="mp in addedMeets" :key="'mp' + mp.i" class="g3__plane">
                <b>{{ mp.name }}</b><span class="g3__meet">{{ mp.line.join('') }} ∩ {{ mp.plane }}</span>
                <button class="g3__btn g3__btn--tiny" @click="delMeet(mp.i)">×</button>
              </span>
            </div>
            <div v-if="planes.length" class="g3__sec g3__sec--list g3__row g3__row--top">
              <span class="g3__tip g3__tip--inline">平面属性：</span>
              <span v-for="pl in planes" :key="pl.kind + pl.i" class="g3__plane">
                <b :class="{ 'g3__off': isHidden((pl.kind === 'cut' ? 'cut:' : 'plane:') + pl.i) }">{{ pl.label }}</b>
                <button class="g3__btn g3__btn--tiny" :title="isHidden((pl.kind === 'cut' ? 'cut:' : 'plane:') + pl.i) ? '显示这个平面' : '隐藏这个平面'" @click="toggleHidden((pl.kind === 'cut' ? 'cut:' : 'plane:') + pl.i)">{{ isHidden((pl.kind === 'cut' ? 'cut:' : 'plane:') + pl.i) ? '○' : '●' }}</button>
                <input
                  type="color" class="g3__col" :value="pl.fill || '#f0c674'"
                  title="填充色"
                  @input="setPlaneFill(pl.kind, pl.i, ($event.target as HTMLInputElement).value)"
                >
                <button class="g3__btn g3__btn--tiny" title="只描边，不填充" @click="setPlaneFill(pl.kind, pl.i, null)">不填充</button>
                <button class="g3__btn g3__btn--tiny" title="删掉这个平面" @click="delPlane(pl.kind, pl.i)">×</button>
              </span>
            </div>
            <div class="g3__sec g3__sec--draw g3__row g3__row--top">
              <span class="g3__tip g3__tip--inline">多点定平面 → 求截面：</span>
              <input v-model="planeText" class="g3__inp" placeholder="如 A C B1">
              <button class="g3__btn" @click="addPlaneCut()">求截面</button>
            </div>
            <div class="g3__sec g3__sec--draw g3__row g3__row--top">
              <span class="g3__tip g3__tip--inline">加截面 / 辅助面（顶点名，空格分隔）：</span>
              <input v-model="cutText" class="g3__inp" placeholder="如 A C B1">
              <label class="g3__num"><input v-model="cutFill" type="checkbox"> 填充</label>
              <button class="g3__btn" @click="addCut()">添加截面</button>
            </div>
          <textarea v-model="raw" class="g3__sec g3__sec--model g3__ta" spellcheck="false" @blur="parse" @input="parseErr = ''" />
          <p v-if="parseErr" class="g3__sec g3__sec--model g3__err">{{ parseErr }}</p>
          <div class="g3__sec g3__sec--model g3__row">
            <label class="g3__f">方位角 azim <b>{{ azim }}°</b>
              <input v-model.number="azim" type="range" min="-180" max="180" step="1">
            </label>
            <label class="g3__f">仰角 elev <b>{{ elev }}°</b>
              <input v-model.number="elev" type="range" min="-80" max="80" step="1">
            </label>
          </div>
          <p class="g3__sec g3__sec--model g3__tip">教材常用：方位角 −60~−10°，仰角 10~30°（正值是俯视，看得见上底面）。</p>

          <div class="g3__sec g3__sec--model g3__lab g3__lab--mt">截图描点对齐（可选，但最准）</div>
          <button class="g3__sec g3__sec--model g3__btn" @click="pickImage()">{{ alignImg ? '换一张截图' : '导入同一张截图…' }}</button>
          <input class="g3__sec g3__sec--model" id="g3-img" type="file" accept="image/*" style="display:none" @change="onPicked">
          <template class="g3__sec g3__sec--model" v-if="alignImg">
            <p class="g3__tip">
              按提示**依次点出**每个顶点：
              <b>{{ clicks.length }}/{{ order.length }}</b>
              <template v-if="nextName"> —— 下一个点 <b>{{ nextName }}</b></template>
              <template v-else> —— 点完了，点「反解视角」</template>
              （至少 4 个，且要跨上下两层，否则解不准）
            </p>
            <div ref="alignBox" class="g3__sec g3__sec--model g3__imgbox" @click="onClickImage">
              <img :src="alignImg" alt="" draggable="false">
              <span
                v-for="(c, i) in clicks" :key="'c' + i" class="g3__dot"
                :style="{ left: c[0] + 'px', top: c[1] + 'px' }"
              >{{ order[i] }}</span>
            </div>
            <div class="g3__sec g3__sec--model g3__row">
              <button class="g3__btn" :disabled="clicks.length < 3" @click="solve()">反解视角</button>
              <button class="g3__btn" @click="clicks = []; fitErr = null">重点</button>
              <span v-if="fitErr !== null" class="g3__fit">
                残差 {{ (fitErr * 100).toFixed(2) }}%
                <b :class="{ 'g3__fit--bad': fitErr > 0.02 }">{{ fitErr <= 0.02 ? '（对得很准）' : '（还差，检查点的顺序）' }}</b>
              </span>
            </div>
          </template>
        </div>

        <div class="g3__right">
          <div
            class="g3__view"
            :class="{ 'g3__view--drag': orbiting }"
            title="按住拖动转视角；点一下选点/选线"
            @pointerdown="onOrbitDown"
            @pointermove="onOrbitMove"
            @pointerup="onOrbitUp"
            @pointerleave="onOrbitUp"
          >
            <svg :viewBox="`0 0 ${W} ${H}`" width="100%" height="100%" preserveAspectRatio="none" v-html="svg" />
          </div>

          <div class="g3__props">
            <template v-if="selKind === 'point' && selNames.length">
              <span class="g3__propslab">点 <b>{{ selNames.join('、') }}</b></span>
              <label class="g3__num">字母 <input
                class="g3__inp g3__inp--sm"
                :value="selLabel"
                @change="setPointLabel(($event.target as HTMLInputElement).value)"
              ></label>
              <button class="g3__btn" @click="setPointLabel('')">不显示字母</button>
              <button class="g3__btn" :disabled="selNames.length !== 2" title="选两个点连成一条线" @click="connectSel()">连线</button>
              <button class="g3__btn" :disabled="selNames.length < 3" title="选三个点定一个平面（算出与多面体的截面）" @click="planeSel()">作平面</button>
              <button class="g3__btn" @click="selPoints = []; selKind = null">清空</button>
            </template>
            <template v-else-if="selKind === 'line' && selEdgeNames">
              <span class="g3__propslab">线 <b>{{ selEdgeNames[0] }}–{{ selEdgeNames[1] }}</b></span>
              <label class="g3__num">颜色 <input
                type="color" class="g3__col"
                :value="selEdgeStyle.color"
                @input="setEdgeStyle({ color: ($event.target as HTMLInputElement).value })"
              ></label>
              <label class="g3__num">线宽 <input
                type="range" min="1" max="6" step="0.5" style="width:80px"
                :value="selEdgeStyle.width"
                @input="setEdgeStyle({ width: +($event.target as HTMLInputElement).value })"
              ></label>
              <button class="g3__btn" :class="{ 'g3__btn--on': selEdgeStyle.dash === 0 }" @click="setEdgeStyle({ dash: 0 })">实线</button>
              <button class="g3__btn" :class="{ 'g3__btn--on': selEdgeStyle.dash === 1 }" @click="setEdgeStyle({ dash: 1 })">虚线</button>
              <button class="g3__btn" @click="selEdge = null; selKind = null">取消</button>
            </template>
            <span v-else class="g3__tip g3__tip--inline">
              点一下图形里的点或线就能改属性；点可多选 —— 选 2 个点「连线」、选 3 个点「作平面」
            </span>
          </div>
        </div>
      </div>

      <footer class="g3__foot">
        <span class="g3__stat">{{ edgeStat }}</span>
        <button class="g3__btn" @click="closeGeom3D()">取消</button>
        <button class="g3__btn g3__btn--primary" :disabled="!model" @click="insert()">
          {{ props.editId ? '保存修改' : '插入到当前页' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.g3 { position: fixed; inset: 0; background: rgba(20, 20, 28, .42); display: flex; align-items: center; justify-content: center; z-index: 60; }
.g3__box { width: 1000px; max-width: 94vw; height: 88vh; background: var(--surface, #fff); border-radius: 8px; box-shadow: 0 18px 48px rgba(0,0,0,.28); display: flex; flex-direction: column; overflow: hidden; }
.g3__head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--border, #e6e6ea); font-size: 13px; }
.g3__title { font-weight: 700; }
.g3__close { border: 0; background: none; cursor: pointer; color: var(--muted, #888); }
.g3__body { flex: 1; display: flex; min-height: 0; }
.g3__left { width: 420px; padding: 12px 14px; overflow: auto; border-right: 1px solid var(--border, #e6e6ea); }
.g3__right { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.g3__view { flex: 1; padding: 8px; display: flex; align-items: center; justify-content: center; background: #fff; cursor: grab; user-select: none; touch-action: none; min-height: 0; }
.g3__view--drag { cursor: grabbing; }
.g3__view svg { pointer-events: none; }
.g3__props { border-top: 1px solid var(--border, #e6e6ea); padding: 8px 12px; min-height: 40px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; background: #fbfbfd; }
.g3__propslab { font-size: 12px; color: #444; }
.g3__propslab b { color: #1668e0; }
.g3__btn--on { background: #1668e0; border-color: #1668e0; color: #fff; }
.g3__col { width: 30px; height: 20px; padding: 0; border: 1px solid var(--border, #ddd); border-radius: 4px; background: none; }
.g3__plane { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: #555; border: 1px solid var(--border, #ddd); border-radius: 6px; padding: 2px 4px; background: #fff; }
.g3__plane b { color: #1668e0; font-weight: 600; }
.g3__off { text-decoration: line-through; opacity: .45; }
.g3__warn { font-size: 11px; color: #c0392b; }
.g3__row--stack { align-items: flex-start; }
.g3__verts { margin-top: 12px; }
.g3__vsub { font-weight: 400; color: #8a8aa0; font-size: 11px; }
.g3__vlist { max-height: 190px; overflow: auto; border: 1px solid var(--border, #ddd); border-radius: 6px; background: #fff; }
.g3__vrow { display: flex; align-items: center; gap: 4px; padding: 3px 6px; border-bottom: 1px solid #f0f0f4; }
.g3__vrow:last-child { border-bottom: 0; }
.g3__vrow b { width: 34px; font-size: 12px; color: #1668e0; }
.g3__vname--derived { color: #a0a0b0; }
.g3__vrow input { width: 52px; border: 1px solid var(--border, #ddd); border-radius: 4px; padding: 2px 4px; font-size: 11px; background: #fff; }
.g3__vinp--ro { background: #f5f5f8; color: #a0a0b0; }
.g3__vtag { font-size: 10px; color: #9a9aa8; width: 26px; }
.g3__meet { color: #777; font-size: 10px; }
.g3__link { cursor: pointer; text-decoration: underline dotted; }
.g3__link:hover { color: #0b4ea8; }
.g3__tabs { display: flex; gap: 6px; margin-bottom: 12px; }
.g3__tabs button { flex: 1; border: 1px solid var(--border, #e2e2e8); background: #f5f5f9; border-radius: 8px; padding: 7px 0; font-size: 12.5px; cursor: pointer; color: #5a5a68; transition: background .12s, color .12s; }
.g3__tabs button:hover { background: #ececf3; }
.g3__tabs button.g3__tab--on { background: #1668e0; border-color: #1668e0; color: #fff; font-weight: 700; }
.g3__left[data-tab="model"] .g3__sec:not(.g3__sec--model),
.g3__left[data-tab="draw"] .g3__sec:not(.g3__sec--draw),
.g3__left[data-tab="list"] .g3__sec:not(.g3__sec--list) { display: none; }
.g3__lab { font-size: 12px; font-weight: 700; color: #444; margin-bottom: 6px; }
.g3__lab--mt { margin-top: 14px; }
.g3__ta { width: 100%; height: 220px; font: 12px/1.5 Consolas, Menlo, monospace; border: 1px solid var(--border, #ddd); border-radius: 6px; padding: 8px; resize: vertical; box-sizing: border-box; }
.g3__err { color: #c0392b; font-size: 12px; margin: 6px 0 0; }
.g3__row { display: flex; align-items: center; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
.g3__row--top { margin-top: 0; margin-bottom: 8px; }
.g3__sel { flex: 1; min-width: 150px; border: 1px solid var(--border, #ddd); border-radius: 6px; padding: 5px 8px; font-size: 12px; background: #fff; }
.g3__sel--sm { flex: 0 0 auto; min-width: 68px; }
.g3__num { font-size: 12px; color: #555; display: flex; align-items: center; gap: 4px; }
.g3__num input { width: 58px; border: 1px solid var(--border, #ddd); border-radius: 5px; padding: 4px 6px; font-size: 12px; }
.g3__build { margin-top: 12px; padding: 8px 10px; border: 1px dashed var(--border, #ddd); border-radius: 6px; background: #fafafc; }
.g3__tip--inline { margin: 0; }
.g3__inp { flex: 1; min-width: 110px; border: 1px solid var(--border, #ddd); border-radius: 6px; padding: 5px 8px; font-size: 12px; }
.g3__inp--sm { flex: 0 0 auto; width: 52px; min-width: 0; text-align: center; }
.g3__btn--tiny { padding: 3px 6px; font-size: 11px; }
.g3__f { font-size: 12px; color: #555; flex: 1; min-width: 170px; }
.g3__f input { width: 100%; }
.g3__tip { font-size: 12px; color: #6b6b76; line-height: 1.6; margin: 8px 0 0; }
.g3__btn { border: 1px solid var(--border, #ddd); background: #f7f7f9; border-radius: 6px; padding: 5px 10px; font-size: 12px; cursor: pointer; }
.g3__btn:disabled { opacity: .5; cursor: default; }
.g3__btn--primary { background: #1668e0; border-color: #1668e0; color: #fff; font-weight: 700; }
.g3__imgbox { position: relative; margin-top: 8px; border: 1px solid var(--border, #ddd); border-radius: 6px; overflow: hidden; cursor: crosshair; }
.g3__imgbox img { display: block; width: 100%; }
.g3__dot { position: absolute; transform: translate(-50%, -50%); background: #ff8f1f; color: #fff; font-size: 10px; font-weight: 700; border-radius: 9px; padding: 1px 5px; pointer-events: none; }
.g3__fit { font-size: 12px; color: #555; }
.g3__fit--bad { color: #c0392b; }
.g3__foot { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 10px 14px; border-top: 1px solid var(--border, #e6e6ea); }
.g3__stat { margin-right: auto; font-size: 12px; color: #6b6b76; }
</style>
