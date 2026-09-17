<script setup lang="ts">
/** 图片转图形：把图片里的线稿识别成可编辑的数学图形元素。
 *
 *  识别是自动的（composables/vectorize），但结果总会有几个"落在直线上的冗余顶点"，
 *  所以这个弹窗的重点不是"识别"，而是**改**：看一眼叠加图，删掉多余的点 / 线，填上顶点字母，
 *  再插进页面。字默认摆在被抹掉的原字母位置上，所以填完就跟原图一样。
 *
 *  编辑动作（删点 / 删线 / 补线 / 拖点 / 拖线 / 改字母）**都可撤销** —— 自动识别再准也总有要手改的地方，
 *  而"改错了只能整图重识别"会把手填的字母一起丢掉，所以这里配了独立的历史栈。
 *  重识别会换掉坐标系（box 变了），所以它是**历史清空点**，且动手前会先问一句。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { vectorizeSink } from '@/ui/vectorize'
import AppIcon from './AppIcon.vue'
import { useDeckStore } from '@/stores/deck'
import type { MathFigureElement, SlideElement, FigureArc } from '@/types'
import { loadImageElement, type VectorizeOpt, type VectorizeResult } from '@/composables/vectorize'
import { labelFontSize, labelGap, arcPolyline } from '@/composables/solid3d'

type VectorizeWorker = Worker & { __nextId?: number }
let vectorWorker: VectorizeWorker | null = null
let vectorRequestId = 0

function getVectorWorker() {
  if (!vectorWorker) {
    vectorWorker = new Worker(new URL('../workers/vectorize.worker.ts', import.meta.url), { type: 'module' }) as VectorizeWorker
  }
  return vectorWorker
}

function vectorizeInWorker(im: HTMLImageElement, opt: VectorizeOpt = {}): Promise<VectorizeResult> {
  const c = document.createElement('canvas')
  c.width = im.naturalWidth
  c.height = im.naturalHeight
  const g = c.getContext('2d', { willReadFrequently: true })
  if (!g) return Promise.reject(new Error('无法创建图片处理画布'))
  g.drawImage(im, 0, 0)
  const rgba = g.getImageData(0, 0, c.width, c.height)
  const worker = getVectorWorker()
  const id = ++vectorRequestId
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent<{ id: number; result?: VectorizeResult; error?: string }>) => {
      if (e.data.id !== id) return
      worker.removeEventListener('message', onMessage)
      if (e.data.error) reject(new Error(e.data.error))
      else if (e.data.result) resolve(e.data.result)
      else reject(new Error('识别没有返回结果'))
    }
    worker.addEventListener('message', onMessage)
    worker.postMessage({ id, buffer: rgba.data.buffer, width: c.width, height: c.height, opt }, [rgba.data.buffer])
  })
}

const props = defineProps<{
  src: string
  /** 从图片元素进来：可"替换这张图片" */
  replaceId?: string | null
  /** 从已转好的图形元素回来继续编辑（此时不跑识别，直接还原已有顶点/边/字母） */
  editId?: string | null
}>()
const emit = defineEmits<{ close: [] }>()
const store = useDeckStore()

/** 视口（滚动 + 缩放）与舞台（图片 + 叠加层） */
const VIEW_W = 560
const VIEW_H = 450

const img = ref<HTMLImageElement | null>(null)
/** 存进元素 vectorizeCtx 的那一份原图（降采样过）。
 *  deck 是**自动存 localStorage** 的，配额只有几 MB —— 直接把扫描件的完整 data URL 塞进去，
 *  转十张图就能把配额撑爆（超了是静默存不上）。弹窗里叠加显示、重新识别都用得到原图，
 *  但 1400px 足够，没必要留整张。 */
const storeSrc = ref('')
/** 存下来的副本相对原图的缩放系数（1 = 没缩） */
const storeK = ref(1)
const stage = ref<HTMLElement | null>(null)
const viewport = ref<HTMLElement | null>(null)
const busy = ref(false)
const err = ref('')

const res = ref<VectorizeResult | null>(null)
/** 识别结果的可编辑副本：pts 归一化顶点（相对识别框）、edges [起,止,虚线] */
const pts = ref<number[]>([])
const edges = ref<[number, number, number][]>([])
/** 拟合出来的椭圆弧：比七八段折线好拖好改（拖 rx/ry 就能调大小） */
const arcs = ref<FigureArc[]>([])
const labels = ref<string[]>([])
/** 每个顶点字母的识别置信度（0 = 没配上字母、是空着的） */
const lconf = ref<number[]>([])
/** 字母相对顶点的偏移（识别框归一化坐标）—— 默认取被抹掉的原字母位置 */
const offs = ref<{ dx: number; dy: number }[]>([])
/** 选中的顶点（可多选，最后一个为"主选中"） */
const selVs = ref<number[]>([])
const selV = computed(() => (selVs.value.length ? selVs.value[selVs.value.length - 1] : null))
const selE = ref<number | null>(null)
/** 补线模式：连着点两个顶点就连一条线；点空白处则先新建一个顶点 */
const linkMode = ref(false)
const pendingV = ref<number | null>(null)
/** 正在拖的东西：>=0 = 顶点下标，-1 = 拖整条线 */
const dragging = ref<number | null>(null)
/** 一次拖动里"跟着一起动"的点（拖动开始时记下各自的初始归一化坐标） */
const dragSet = ref<{ i: number; x: number; y: number }[]>([])
/** 按下时的归一化坐标，用来算拖动位移 */
const dragOrigin = ref<[number, number] | null>(null)

/** 缩放：baseScale 是"适屏"，zoom 是用户倍数 */
const baseScale = ref(1)
const zoom = ref(1)
const panMode = ref(false)
const panning = ref<{ sx: number; sy: number; sl: number; st: number } | null>(null)
const scale = computed(() => baseScale.value * zoom.value)
const viewW = computed(() => Math.round((img.value?.naturalWidth || 300) * scale.value))
const viewH = computed(() => Math.round((img.value?.naturalHeight || 200) * scale.value))
const nVerts = computed(() => pts.value.length / 2)
/** 字母是自动认出来的，低于 0.8 的挑出来让人复核 */
const unsureN = computed(() => lconf.value.filter((c, i) => c > 0 && c < 0.8 && (labels.value[i] || '').trim()).length)
/** 识别框的哪几条边切到了图形 —— 切掉一截会让线断开、字母只剩半个（实测 x 被切成了 V 形） */
const clipSides = computed(() => {
  const c = res.value?.stats.clipped
  if (!c) return ''
  const parts: string[] = []
  if (c.top) parts.push('上')
  if (c.bottom) parts.push('下')
  if (c.left) parts.push('左')
  if (c.right) parts.push('右')
  return parts.join(' / ')
})

// 裁剪：拖动框选识别范围
const cropping = ref(false)
const drag = ref<{ x: number; y: number; w: number; h: number } | null>(null)
const dragStart = ref<{ x: number; y: number } | null>(null)
// 框选顶点（舞台像素坐标）
const boxSel = ref<{ x0: number; y0: number; x1: number; y1: number } | null>(null)

// ---------------- 历史（撤销 / 重做） ----------------
interface Snap {
  pts: number[]
  edges: [number, number, number][]
  labels: string[]
  lconf: number[]
  offs: { dx: number; dy: number }[]
  arcs: FigureArc[]
}
const past = ref<Snap[]>([])
const future = ref<Snap[]>([])
const canUndo = computed(() => past.value.length > 0)
const canRedo = computed(() => future.value.length > 0)
/** 有没有"手工改过"—— 重识别前据此决定要不要提醒 */
const dirty = computed(() => past.value.length > 0)

function snap(): Snap {
  return {
    pts: pts.value.slice(),
    edges: edges.value.map((e) => [e[0], e[1], e[2]] as [number, number, number]),
    labels: labels.value.slice(),
    lconf: lconf.value.slice(),
    offs: offs.value.map((o) => ({ ...o })),
    arcs: arcs.value.map((a) => ({ ...a })),
  }
}
function applySnap(s: Snap) {
  pts.value = s.pts.slice()
  edges.value = s.edges.map((e) => [e[0], e[1], e[2]] as [number, number, number])
  labels.value = s.labels.slice()
  lconf.value = s.lconf.slice()
  offs.value = s.offs.map((o) => ({ ...o }))
  arcs.value = (s.arcs || []).map((a) => ({ ...a }))
  selVs.value = []
  selE.value = null
  selArc.value = null
}
/** 在**改动之前**调用，记下"改之前"的样子 */
function pushSnap(s: Snap) {
  past.value.push(s)
  if (past.value.length > 80) past.value.shift()
  future.value.length = 0
}
function pushUndo() {
  pushSnap(snap())
}
/** 拖动是"按下时先留一份快照，松开时确认真的动了才入栈" —— 单纯点一下选中不该占一格历史 */
const pendingSnap = ref<Snap | null>(null)
function commitDrag() {
  const s = pendingSnap.value
  pendingSnap.value = null
  if (!s) return
  if (s.pts.length === pts.value.length && s.pts.every((v, i) => v === pts.value[i])) return
  pushSnap(s)
}
function undo() {
  if (!past.value.length) return
  future.value.push(snap())
  applySnap(past.value.pop()!)
}
function redo() {
  if (!future.value.length) return
  past.value.push(snap())
  applySnap(future.value.pop()!)
}
/** 重识别会换坐标系，历史必须清空（否则撤销回去的顶点坐标对不上新框） */
function resetHistory() {
  past.value = []
  future.value = []
}

function toFull(i: number): [number, number] {
  const r = res.value
  if (!r) return [0, 0]
  const [bx, by, ex, ey] = r.box
  const cw = ex - bx, ch = ey - by
  return [(pts.value[i * 2] * cw + bx) / r.imgW, (pts.value[i * 2 + 1] * ch + by) / r.imgH]
}
function px(i: number) { return toFull(i)[0] * viewW.value }
function py(i: number) { return toFull(i)[1] * viewH.value }
function ex(i: number) { const e = edges.value[i]; return e ? [px(e[0]), py(e[0]), px(e[1]), py(e[1])] : [0, 0, 0, 0] }

/** 识别结果 → 可编辑副本；字母位置按"离得最近且没被占用的原字母"给 */
function adopt(r: VectorizeResult) {
  pts.value = r.points.slice()
  edges.value = r.edges.map((e) => [e[0], e[1], e[2]] as [number, number, number])
  arcs.value = (r.arcs || []).map((a) => ({ ...a }))     // 拟合出来的椭圆弧（球/圆台底、画弧的题）
  const n = pts.value.length / 2
  labels.value = new Array(n).fill('')
  lconf.value = new Array(n).fill(0)
  // 字母 → 顶点：**全局按距离贪心配对**（而不是每个顶点各找各的最近字母）——
  // 后者会让某个顶点把旁边另一个顶点真正的字母抢走
  const cand: { i: number; k: number; d: number }[] = []
  for (let i = 0; i < n; i++) {
    const vx = pts.value[i * 2], vy = pts.value[i * 2 + 1]
    for (let k = 0; k < r.anchors.length; k++) {
      const an = r.anchors[k]
      if (!an.text || an.conf < 0.7) continue         // 没认出来 / 认得很虚的不管
      const d = Math.hypot(an.x - vx, an.y - vy)
      if (d <= 0.16) cand.push({ i, k, d })
    }
  }
  cand.sort((a, b) => a.d - b.d)
  const vTake = new Array(n).fill(false)
  const aTake = new Array(r.anchors.length).fill(false)
  const out: { dx: number; dy: number }[] = new Array(n).fill(null).map(() => ({ dx: 0, dy: 0 }))
  for (const c of cand) {
    if (vTake[c.i] || aTake[c.k]) continue
    vTake[c.i] = true; aTake[c.k] = true
    const vx = pts.value[c.i * 2], vy = pts.value[c.i * 2 + 1]
    out[c.i] = { dx: r.anchors[c.k].x - vx, dy: r.anchors[c.k].y - vy }
    labels.value[c.i] = r.anchors[c.k].text
    lconf.value[c.i] = r.anchors[c.k].conf
  }
  // 没配上字母的顶点：字母按"从重心往外推"给个兜底位置
  let cx = 0, cy = 0
  for (let i = 0; i < n; i++) { cx += pts.value[i * 2]; cy += pts.value[i * 2 + 1] }
  cx /= n || 1; cy /= n || 1
  for (let i = 0; i < n; i++) {
    if (vTake[i]) continue
    const ux = pts.value[i * 2] - cx, uy = pts.value[i * 2 + 1] - cy
    const L = Math.hypot(ux, uy)
    if (L < 1e-6) continue
    out[i] = { dx: (ux / L) * 0.06 * (r.W / r.H > 1 ? 1 : 0.8), dy: (uy / L) * 0.06 }
  }
  offs.value = out
  // **X–X₁ 这类侧棱默认就连**（用户明确要求：C-C₁、B-B₁、A-A₁、D-D₁ 默认需要连线）。
  // 面的边那条规则更激进（要猜字母顺序 + 凸性），仍然只在点「按字母补线」时才跑。
  // 两端点之间已经有线的不重复连；字母认错导致位移对不上的，只提示不否决。
  inferCorrespondingEdges()
}

// ---------------- 补出来的线判虚实 ----------------
/** 原图像素（判"这条补出来的线在原图上是什么线型"用）。onMounted 里准备好，失败就退回几何判据 */
const srcPix = ref<{ data: Uint8ClampedArray; w: number; h: number } | null>(null)
function prepareSrcPix(im: HTMLImageElement) {
  try {
    const c = document.createElement('canvas')
    c.width = im.naturalWidth
    c.height = im.naturalHeight
    const g = c.getContext('2d', { willReadFrequently: true })
    if (!g) { srcPix.value = null; return }
    g.drawImage(im, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height)
    srcPix.value = { data: d.data, w: c.width, h: c.height }
  } catch { srcPix.value = null }
}
/** 整图像素坐标处是不是墨迹（跟矢量化用同一个阈值 150） */
function inkAtFull(x: number, y: number): boolean {
  const s = srcPix.value
  if (!s) return false
  const xi = Math.round(x), yi = Math.round(y)
  if (xi < 0 || yi < 0 || xi >= s.w || yi >= s.h) return false
  const k = (yi * s.w + xi) * 4
  return (s.data[k] * 0.299 + s.data[k + 1] * 0.587 + s.data[k + 2] * 0.114) < 150
}
/** 顶点 i 在**整图**里的像素坐标（pts 是"相对识别框"归一化的，要经 toFull 换算） */
function fullPx(i: number): [number, number] {
  const im = img.value
  const f = toFull(i)
  return im ? [f[0] * im.naturalWidth, f[1] * im.naturalHeight] : [0, 0]
}
/** 顶点集的凸包（Andrew 单调链）—— 用来判"这条线是不是藏在图形内部" */
function convexHull(P: [number, number][]): [number, number][] {
  const a = P.slice().sort((p, q) => (p[0] - q[0]) || (p[1] - q[1]))
  if (a.length < 3) return a
  const cr = (o: [number, number], p: [number, number], q: [number, number]) =>
    (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
  const lo: [number, number][] = []
  for (const p of a) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p) }
  const up: [number, number][] = []
  for (let i = a.length - 1; i >= 0; i--) { const p = a[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p) }
  lo.pop(); up.pop()
  return lo.concat(up)
}
/** 点是不是**明显在凸包内部**（离边界 margin 像素以上才算）—— 边界上的点算"在轮廓上" */
function insideHull(hull: [number, number][], x: number, y: number, margin = 4): boolean {
  const n = hull.length
  if (n < 3) return false
  let minD = 1e9
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = hull[j], b = hull[i]
    // 射线法
    if ((b[1] > y) !== (a[1] > y) && x < ((a[0] - b[0]) * (y - b[1])) / (a[1] - b[1] || 1e-9) + b[0]) inside = !inside
    // 到边界的距离
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const L2 = dx * dx + dy * dy || 1e-9
    let t = ((x - a[0]) * dx + (y - a[1]) * dy) / L2
    t = Math.max(0, Math.min(1, t))
    minD = Math.min(minD, Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy)))
  }
  return inside && minD > margin
}
/** 补出来的线该画实线还是虚线：
 *  ① 先看**原图**这条线上有没有墨 —— 几乎连续 → 实线；断续 → 虚线（隐藏线本来就是虚线画法）；
 *  ② 一个墨点都没有（整条漏了，多半是细虚线没认出来）→ 按几何判：
 *     中点藏在顶点凸包**内部** = 被挡住的棱 → 虚线；在轮廓上 → 实线。 */
function inferDashFor(a: number, b: number, hull: [number, number][]): 0 | 1 {
  const [ax, ay] = fullPx(a), [bx, by] = fullPx(b)
  const L = Math.hypot(bx - ax, by - ay)
  if (srcPix.value && L > 4) {
    const N = Math.max(8, Math.min(240, Math.round(L / 2)))
    let hit = 0
    for (let k = 0; k <= N; k++) {
      const t = k / N
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t
      let ok = false
      // 取样窗口只开 3×3：原来是 5×5，**太宽** —— 虚线的小空隙被旁边的墨盖住，
      // 于是虚线被判成实线（实测 C–C₁ 那条虚线补出来是实线）。线宽本身只有 2px 左右，
      // 3×3 足够容忍识别出来的端点偏差，又能看见虚线断口。
      for (let dy = -1; dy <= 1 && !ok; dy++) {
        for (let dx = -1; dx <= 1; dx++) if (inkAtFull(x + dx, y + dy)) { ok = true; break }
      }
      if (ok) hit++
    }
    const cov = hit / (N + 1)
    if (cov >= 0.85) return 0
    if (cov >= 0.25) return 1
  }
  return insideHull(hull, (ax + bx) / 2, (ay + by) / 2) ? 1 : 0
}
/** a–b 这条直线是不是**已经被现有的线覆盖**了（覆盖它的可能是几段共线的边 ——
 *  比如 D₁–D₂–D，中间那个点 D₂ 就在 D₁D 上）。用户说"两端点之间有线就不再连线"，
 *  这是那句话的几何版判据：只查"有没有这条边"会漏掉上面那种情况，连出来就是叠着的多余线。 */
function segmentCovered(a: number, b: number): boolean {
  const ax = px(a), ay = py(a), bx = px(b), by = py(b)
  const L = Math.hypot(bx - ax, by - ay)
  if (L < 2) return true
  const N = Math.max(4, Math.min(60, Math.round(L / 3)))
  for (let k = 0; k <= N; k++) {
    const t = k / N
    const x = ax + (bx - ax) * t, y = ay + (by - ay) * t
    let ok = false
    for (const e of edges.value) {
      const x0 = px(e[0]), y0 = py(e[0]), x1 = px(e[1]), y1 = py(e[1])
      const dx = x1 - x0, dy = y1 - y0
      const L2 = dx * dx + dy * dy || 1e-9
      let tt = ((x - x0) * dx + (y - y0) * dy) / L2
      tt = Math.max(0, Math.min(1, tt))
      // 容差 6px：识别出来的中间点常偏离直线几个像素（实测 A₁–A₂–A 里的 A₂ 偏 4px 左右），
      // 卡太紧会把"其实已经有线"判成没有，于是叠着画出一条多余的。
      if (Math.hypot(x - (x0 + tt * dx), y - (y0 + tt * dy)) < 6) { ok = true; break }
    }
    if (!ok) return false
  }
  return true
}

/** 当前所有顶点的凸包（整图像素） */
function vertHull(): [number, number][] {
  const P: [number, number][] = []
  for (let i = 0; i < nVerts.value; i++) P.push(fullPx(i))
  return convexHull(P)
}

/** 「按字母补线」按钮：侧棱 + 面的边两条一起跑，提示合并成一条。
 *  先把 note 清掉 —— 否则第二次点（没有可补的）会留着上一次的"补了 N 条"，看着像又补了一次。 */
function refillByLetters() {
  note.value = ''
  const parts: string[] = []
  inferCorrespondingEdges()
  if (note.value) parts.push(note.value)
  note.value = ''
  inferFacePolygons()
  if (note.value) parts.push(note.value)
  note.value = parts.length ? parts.join('；') : '没有需要补的线（字母齐了，或者位置关系对不上）'
}

/** 按字母补线：图上只要有 **X 和 X_1**（同底字母 + 下标 1，下标用 _1 或 ^1 都认）这种一对，
 *  它们之间就一定有一条线（立体图里的侧棱，C–C₁、B–B₁…），识别漏了要补上 —— 用户明确说"这条线必画"。
 *  重名只取第一个；已经连了的跳过；补出来的默认实线，不对的话在图上点一下就能改虚实。
 *  返回补了几条。 */
function inferCorrespondingEdges(): number {
  const byLabel = new Map<string, number>()
  labels.value.forEach((t, i) => {
    const s = (t || '').trim()
    if (s && !byLabel.has(s)) byLabel.set(s, i)
  })
  // 先收集候选配对，再**用"相对位置一致"校验一遍**：
  // 棱柱/棱台就是把下底面 A-B-C-D 平移上去成 A₁-B₁-C₁-D₁ ——
  // 所以每个对应点的**位移向量应该几乎相同**。偏离共识的那一对，说明字母认错了，不补。
  const cand: { i: number; j: number; dx: number; dy: number; name: string }[] = []
  for (const [txt, i] of byLabel) {
    const m = /^([A-Za-z])[_^]1$/.exec(txt)
    if (!m) continue
    const j = byLabel.get(m[1])
    if (j === undefined || j === i) continue
    const [ax, ay] = fullPx(i), [bx, by] = fullPx(j)
    cand.push({ i, j, dx: ax - bx, dy: ay - by, name: m[1] + '–' + txt })
  }
  if (!cand.length) return 0
  // 位移向量只用来**提示可疑**，不再拿来否决 —— 用户明确说"C–C₁、B–B₁ 等必有线"，
  // 而且识别出来的顶点本身有抖动，硬卡位移会把真线也挡掉。
  const mx = cand.reduce((s, c) => s + c.dx, 0) / cand.length
  const my = cand.reduce((s, c) => s + c.dy, 0) / cand.length
  const tol = Math.max(8, 0.2 * Math.hypot(mx, my))
  let added = 0, dashed = 0, odd = 0
  const names: string[] = []
  const hull = vertHull()
  for (const c of cand) {
    if (Math.hypot(c.dx - mx, c.dy - my) > tol) odd++
    if (edges.value.some((e) => (e[0] === c.i && e[1] === c.j) || (e[0] === c.j && e[1] === c.i))) continue
    // 两点之间已经有线了就不再连 —— 这里用**几何版**判据：
    // 直线上可能中间还有个点（图里的 D₁–D₂–D，D₂ 就在 D₁D 上），
    // 只查"有没有这条边"会漏掉那种情况，连出来的线就叠在已有的两段上，成了多余的一条。
    if (segmentCovered(c.i, c.j)) continue
    const d = inferDashFor(c.j, c.i, hull)
    edges.value.push([c.j, c.i, d])
    added++
    names.push(c.name)
    if (d) dashed++
  }
  if (added || odd) {
    note.value = '按字母补了 ' + added + ' 条侧棱' + (names.length ? '（' + names.slice(0, 6).join('、') + '）' : '') + (dashed ? '，其中 ' + dashed + ' 条虚线' : '') +
      (odd ? '；其中 ' + odd + ' 对位移不一致，字母可能认错，请核对' : '')
  }
  return added
}

/** 按顺序连出来的多边形是不是"凸"（叉积同号）—— 投影不变凸，所以底面画出来一定是凸的。
 *  不是凸的就说明**字母顺序不是多边形顺序**（典型：底面标签里混进了 M、N、h 这种），宁可不补。 */
function isConvexRing(P: [number, number][]): boolean {
  const n = P.length
  if (n < 3) return false
  let sign = 0
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n], c = P[(i + 2) % n]
    const ux = b[0] - a[0], uy = b[1] - a[1]
    const vx = c[0] - b[0], vy = c[1] - b[1]
    const cr = ux * vy - uy * vx
    const scale = Math.hypot(ux, uy) * Math.hypot(vx, vy)
    if (scale < 1e-6) return false
    if (Math.abs(cr) < 0.02 * scale) continue          // 近似共线：放过（真实图会有这种）
    const s2 = cr > 0 ? 1 : -1
    if (sign === 0) sign = s2
    else if (s2 !== sign) return false
  }
  return sign !== 0
}

/** 按字母补**面的闭合多边形**：同一个下标的一组顶点应该首尾相连 ——
 *  A-B-C-D-A、A₁-B₁-C₁-D₁-A₁（用户明确说"都应该有直线连接"）。
 *  组内按字母顺序连；**只在至少 3 个点、且这个顺序连出来是凸多边形时**才补。 */
function inferFacePolygons(): number {
  const groups = new Map<string, { i: number; base: string }[]>()
  labels.value.forEach((t, i) => {
    const s = (t || '').trim()
    const m = /^([A-Za-z])([_^]?[0-9]*)$/.exec(s)       // 基字母 + 下标（_1 / ^1 / 空）
    if (!m) return
    const key = m[2] || ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push({ i, base: m[1].toUpperCase() })
  })
  let added = 0, dashed = 0
  for (const arr of groups.values()) {
    if (arr.length < 3) continue
    arr.sort((a, b) => (a.base < b.base ? -1 : a.base > b.base ? 1 : 0))
    // **只认"一串连续的字母"**（A、B、C、D… 不跳号、不重复）——
    // 字母认错（比如 C_2_6 / B_m_8_7）或底面混进了 M、N、h 这种，一律不补。
    // 这一条是"补了太多无用的线"的直接修法：宁可漏，不可乱加。
    let runOK = true
    for (let k = 0; k < arr.length; k++) {
      if (arr[k].base !== String.fromCharCode(65 + k)) { runOK = false; break }
      if (k + 1 < arr.length && arr[k + 1].base === arr[k].base) { runOK = false; break }
    }
    if (!runOK) continue
    const P = arr.map((x) => [px(x.i), py(x.i)] as [number, number])
    if (!isConvexRing(P)) continue
    const hull = vertHull()
    for (let k = 0; k < arr.length; k++) {
      const a = arr[k].i, b = arr[(k + 1) % arr.length].i
      if (edges.value.some((e) => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a))) continue
      const d = inferDashFor(a, b, hull)
      edges.value.push([a, b, d])
      added++
      if (d) dashed++
    }
  }
  if (added) note.value = '按字母补了 ' + added + ' 条面的边（A-B-C-D-A 这种闭合）' + (dashed ? '，其中 ' + dashed + ' 条虚线' : '')
  return added
}

/** 已转好的图形元素 → 可编辑副本（"继续编辑"入口；顶点/边/字母本来就在元素上，不重跑识别） */
function restoreFromElement(el: MathFigureElement): boolean {
  const ctx = el.vectorizeCtx
  if (!ctx || !el.points || !el.mesh) return false
  const [bx, by, ex2, ey2] = ctx.box
  const cw = ex2 - bx, ch = ey2 - by
  if (!(cw > 0) || !(ch > 0) || !(ctx.imgW > 0) || !(ctx.imgH > 0)) return false
  res.value = {
    W: cw, H: ch, box: ctx.box, imgW: ctx.imgW, imgH: ctx.imgH,
    points: [], edges: [], anchors: [],
    stats: { verts: 0, edges: 0, dash: 0, text: 0, bars: 0, dashGroups: 0 },
  }
  const n = Math.floor(el.points.length / 2)
  const p: number[] = []
  for (let i = 0; i < n; i++) {
    p.push(+(((el.points[i * 2] * ctx.imgW - bx) / cw).toFixed(4)),
           +(((el.points[i * 2 + 1] * ctx.imgH - by) / ch).toFixed(4)))
  }
  pts.value = p
  edges.value = (el.mesh.edges || []).map((e) => [e[0], e[1], e[2]] as [number, number, number])
  labels.value = new Array(n).fill('').map((_, i) => el.vlabels?.[i] || '')
  // 已经人工确认过的结果，不再标"不确定"
  lconf.value = new Array(n).fill(0)
  const hh = el.h || 1
  offs.value = new Array(n).fill(null).map((_, i) => {
    const lo = el.labelOffsets?.[i]
    if (!lo) return { dx: 0, dy: 0 }
    return {
      dx: +((lo.dx * ctx.imgW) / cw).toFixed(4),
      // 元素里 labelOffsets 的零点是"顶点上方 labelGap 像素"（见 buildPatch），弹窗里是"顶点本身"，差这一项
      dy: +(((lo.dy - labelGap(labelFontSize(hh)) / hh) * ctx.imgH) / ch).toFixed(4),
    }
  })
  // 弧也要恢复 —— 弦式弧（手工画的）本来就是相对识别框归一化的，直接搬；
  // 自由式弧（绝对几何）也同一套坐标，一并带回来
  arcs.value = (el.arcs || []).map((a) => ({ ...a }))
  return true
}

async function run(crop?: [number, number, number, number] | null) {
  const im = img.value
  if (!im) return
  busy.value = true
  err.value = ''
  await new Promise((r) => setTimeout(r, 30))   // 让"识别中"先画出来
  try {
    const r = await vectorizeInWorker(im, { ...advOpt(), ...(crop ? { crop } : {}) })
    if (!r.stats.verts) throw new Error('没认出来东西 —— 可能不是线稿（灰度图 / 照片都不行）')
    res.value = r
    adopt(r)
    selVs.value = []
    selE.value = null
    resetHistory()
    zoom.value = 1
    await nextTick()
    if (viewport.value) { viewport.value.scrollLeft = 0; viewport.value.scrollTop = 0 }
  } catch (e) {
    err.value = (e as Error)?.message || String(e)
  } finally {
    busy.value = false
  }
}

/** 重识别（会丢掉本次手工修改，先问一句） */
function rerun(crop?: [number, number, number, number] | null) {
  if (dirty.value && !confirm('重新识别会丢掉这次的顶点 / 边 / 字母修改（可以用撤销找回，但只在重识别之前有效）。\n\n确定重新识别？')) return
  void run(crop)
}

// ---------------- 阈值细调（滑杆） ----------------
/** 识别算法里那些"一调就好、但每调一次都得我重发一版 exe"的阈值。
 *  用户实测反馈：多出来的点 / 多出来的线段、以及虚线漏边，靠这几个阈值就能掰到位 —— 所以直接给他滑杆。
 *  只把**被改过**的项传给算法（见 advOpt），没改的继续吃算法默认值。 */
const ADV_GROUPS = [
  {
    title: '杂点 / 多余的点与线段',
    items: [
      { k: 'dashMinPiece', label: '最小短划', min: 0, max: 20, step: 1, def: 4, hint: '主轴短于此长度的小墨团直接当噪点抹掉（px）' },
      { k: 'dashMinTotal', label: '最小短划堆', min: 0, max: 60, step: 1, def: 16, hint: '一堆短划的总长不足此值就整堆抹掉（px）；两个 7px 杂点凑的假虚线是 14px' },
      { k: 'dashMinEdge', label: '孤立虚线边', min: 0, max: 200, step: 5, def: 80, hint: '两头都没搭上顶点的虚线边，短于此值整条丢掉（px）' },
      { k: 'collinearCos', label: '共线判据', min: 0.9, max: 1, step: 0.005, def: 0.995, hint: '度 2 顶点两侧"接近直线"的程度（1 = 完全直）。调大更容易把直线上的多余点并掉' },
    ],
  },
  {
    title: '虚线合并（漏边 / 虚线整条消失）',
    items: [
      { k: 'dashCos', label: '方向对齐', min: 0.8, max: 0.99, step: 0.005, def: 0.94, hint: '调小 = 更松，虚线更容易并起来；太松会把别的线的短划也并进来' },
      { k: 'dashPerp', label: '垂距', min: 2, max: 40, step: 1, def: 16, hint: '短划相对理想直线的垂距上限（px）' },
      { k: 'dashGap', label: '间距', min: 0, max: 60, step: 1, def: 20, hint: '短划沿轴方向的间距余量（px），碎片化严重时调大' },
    ],
  },
  {
    title: '吸附（顶点位置不对）',
    items: [
      { k: 'snapDash', label: '虚线链吸附', min: 0, max: 120, step: 5, def: 60, hint: '虚线链端点吸到顶点的半径（px）。源码注释说这是"多出点"最主要的来源 —— 调小更干净，太小会吸不上、虚线变悬空' },
      { k: 'snapPerp', label: '链吸附垂距', min: 0, max: 60, step: 2, def: 18, hint: '链端点吸附时允许偏离链所在直线的距离（px）' },
      { k: 'mergeR', label: '顶点合并', min: 0, max: 24, step: 1, def: 8, hint: '相距小于此值的两个顶点合并成一个（px）' },
    ],
  },
] as const

const advOpen = ref(false)
const ADV_KEY = 'lj-mathslides-vue:vec-adv'
const adv = reactive<Record<string, number>>({})
function advReset() {
  for (const g of ADV_GROUPS) for (const d of g.items) adv[d.k] = d.def
}
advReset()
try {
  const raw = localStorage.getItem(ADV_KEY)
  if (raw) {
    const o = JSON.parse(raw) as Record<string, number>
    for (const g of ADV_GROUPS) for (const d of g.items) if (typeof o[d.k] === 'number') adv[d.k] = o[d.k]
  }
} catch { /* 坏数据就当没存过 */ }
watch(adv, () => {
  try { localStorage.setItem(ADV_KEY, JSON.stringify(adv)) } catch { /* 存不下就算了 */ }
})
/** 只传**改过**的项：没改的继续吃算法默认值，以后我改默认值你这边仍然生效 */
function advOpt(): VectorizeOpt {
  const o: Record<string, number> = {}
  for (const g of ADV_GROUPS) for (const d of g.items) {
    const v = adv[d.k]
    if (typeof v === 'number' && v !== d.def) o[d.k] = v
  }
  return o as VectorizeOpt
}
/** 有没有偏离默认值（面板头上显示一个「已改」） */
const advDirty = computed(() => {
  for (const g of ADV_GROUPS) for (const d of g.items) if (adv[d.k] !== d.def) return true
  return false
})

// ---------------- 坐标换算 ----------------
/** 屏幕坐标 → 识别框归一化坐标（顶点坐标用的是这一套） */
function toCropNorm(e: { clientX: number; clientY: number }): [number, number] | null {
  const r = stage.value?.getBoundingClientRect()
  const rs = res.value
  if (!r || !rs || !r.width || !r.height) return null
  const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height
  const [bx, by, ex2, ey2] = rs.box
  return [(fx * rs.imgW - bx) / (ex2 - bx), (fy * rs.imgH - by) / (ey2 - by)]
}
/** 屏幕坐标 → 舞台像素坐标（框选用） */
function toStagePx(e: { clientX: number; clientY: number }): { x: number; y: number } | null {
  const r = stage.value?.getBoundingClientRect()
  if (!r) return null
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

// ---------------- 视口：缩放 / 平移 ----------------
function zoomAt(f: number, mx: number, my: number) {
  const vp = viewport.value
  if (!vp) return
  const old = zoom.value
  const next = Math.max(0.5, Math.min(6, old * f))
  if (Math.abs(next - old) < 1e-4) return
  zoom.value = next
  nextTick(() => {
    const k = next / old
    vp.scrollLeft = (vp.scrollLeft + mx) * k - mx
    vp.scrollTop = (vp.scrollTop + my) * k - my
  })
}
function onWheel(e: WheelEvent) {
  const vp = viewport.value
  if (!vp) return
  const r = vp.getBoundingClientRect()
  zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top)
}
function zoomCenter(f: number) {
  const vp = viewport.value
  if (!vp) return
  zoomAt(f, vp.clientWidth / 2, vp.clientHeight / 2)
}
function resetZoom() {
  zoom.value = 1
  nextTick(() => {
    const vp = viewport.value
    if (vp) { vp.scrollLeft = 0; vp.scrollTop = 0 }
  })
}
function onVpDown(e: PointerEvent) {
  const vp = viewport.value
  if (!vp) return
  if (!panMode.value && e.button !== 1) return
  e.preventDefault()
  panning.value = { sx: e.clientX, sy: e.clientY, sl: vp.scrollLeft, st: vp.scrollTop }
  try { vp.setPointerCapture(e.pointerId) } catch { /* 忽略 */ }
}
function onVpMove(e: PointerEvent) {
  const p = panning.value, vp = viewport.value
  if (!p || !vp) return
  vp.scrollLeft = p.sl - (e.clientX - p.sx)
  vp.scrollTop = p.st - (e.clientY - p.sy)
}
function onVpUp() { panning.value = null }

// ---------------- 舞台交互 ----------------
function onDown(e: PointerEvent) {
  if (panMode.value) return
  if (cropping.value) {
    const p = toStagePx(e)
    if (!p) return
    const r = stage.value!.getBoundingClientRect()
    dragStart.value = { x: p.x / r.width, y: p.y / r.height }
    drag.value = { x: dragStart.value.x, y: dragStart.value.y, w: 0, h: 0 }
    return
  }
  // 补线模式下点空白处 = 新建一个顶点
  if (linkMode.value) {
    const p = toCropNorm(e)
    if (!p || p[0] < 0 || p[0] > 1 || p[1] < 0 || p[1] > 1) return
    pushUndo()
    pts.value.push(+p[0].toFixed(4), +p[1].toFixed(4))
    labels.value.push('')
    lconf.value.push(0)
    offs.value.push({ dx: 0, dy: 0 })
    pickForLink(nVerts.value - 1)
    return
  }
  // 默认模式：空白处拖动 = 框选顶点
  const p = toStagePx(e)
  if (!p) return
  if (!e.shiftKey) { selVs.value = []; selE.value = null }
  boxSel.value = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }
}

function onMove(e: PointerEvent) {
  if (arcDrag >= 0) {
    // 拖拱高手柄（只有 2 个控制点的曲线才有）：
    // 用跟顶点拖动同一套坐标换算（toCropNorm），别再自己减 rect（舞台有缩放，会差一个比例）
    const p = toCropNorm(e)
    const a = arcs.value[arcDrag]
    const idx = a ? arcIdxOf(a) : null
    if (!p || !a || !idx || idx.length !== 2) return
    const ax = pts.value[idx[0] * 2], ay = pts.value[idx[0] * 2 + 1]
    const bx = pts.value[idx[1] * 2], by = pts.value[idx[1] * 2 + 1]
    const dx = bx - ax, dy = by - ay
    const c = Math.hypot(dx, dy) || 1
    const ux = dy / c, uy = -dx / c
    const along = ((p[0] - (ax + bx) / 2) * ux + (p[1] - (ay + by) / 2) * uy) / c
    a.bulge = +Math.max(-0.5, Math.min(0.5, along)).toFixed(4)
    return
  }
  if (dragging.value !== null) {
    const p = toCropNorm(e)
    if (!p || !dragOrigin.value) return
    const dx = p[0] - dragOrigin.value[0], dy = p[1] - dragOrigin.value[1]
    for (const d of dragSet.value) {
      pts.value[d.i * 2] = +clamp01(d.x + dx).toFixed(4)
      pts.value[d.i * 2 + 1] = +clamp01(d.y + dy).toFixed(4)
    }
    return
  }
  if (boxSel.value) {
    const p = toStagePx(e)
    if (!p) return
    boxSel.value = { ...boxSel.value, x1: p.x, y1: p.y }
    return
  }
  if (!cropping.value || !dragStart.value || !stage.value) return
  const p = toStagePx(e)
  if (!p) return
  const r = stage.value.getBoundingClientRect()
  const x = p.x / r.width, y = p.y / r.height
  drag.value = {
    x: Math.min(dragStart.value.x, x), y: Math.min(dragStart.value.y, y),
    w: Math.abs(x - dragStart.value.x), h: Math.abs(y - dragStart.value.y),
  }
}
function onUpStage() {
  if (arcDrag >= 0) { const i = arcDrag; arcDrag = -1; absorbForArc(i); onUp(); return }
  if (dragging.value !== null) {
    dragging.value = null
    dragSet.value = []
    dragOrigin.value = null
    commitDrag()
  }
  if (boxSel.value) { finishBoxSel(); return }
  onUp()
}

/** 框选结束：把框内的顶点选中（按住 Shift 是追加） */
function finishBoxSel() {
  const b = boxSel.value
  boxSel.value = null
  if (!b || !stage.value) return
  const r = stage.value.getBoundingClientRect()
  if (!r.width || !r.height) return
  const kx = viewW.value / r.width, ky = viewH.value / r.height   // rect 是 CSS 像素，顶点坐标是舞台像素
  const x0 = Math.min(b.x0, b.x1) * kx, x1 = Math.max(b.x0, b.x1) * kx
  const y0 = Math.min(b.y0, b.y1) * ky, y1 = Math.max(b.y0, b.y1) * ky
  if (x1 - x0 < 4 && y1 - y0 < 4) return    // 只是点了一下空白
  const hit: number[] = []
  for (let i = 0; i < nVerts.value; i++) {
    const x = px(i), y = py(i)
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) hit.push(i)
  }
  if (!hit.length) return
  const merged = new Set(selVs.value)
  for (const i of hit) merged.add(i)
  selVs.value = [...merged].sort((a, b) => a - b)
  selE.value = null
}

/** 顶点按下：补线模式下选点，否则选中并开始拖 */
function onVertexDown(e: PointerEvent, i: number) {
  e.stopPropagation()
  if (panMode.value) return
  if (linkMode.value) { pickForLink(i); return }
  if (arcMode.value) { pickForArc(i); return }
  if (ellipseMode.value) { pickForEllipseArc(i); return }
  if (e.shiftKey && selV.value !== null && selV.value !== i) {
    const s = snap()
    if (connect(selV.value, i)) pushSnap(s)
    selVs.value = [i]
    selE.value = null
    return
  }
  // 点在已多选的点上 → 整组一起拖；否则只选它
  if (!selVs.value.includes(i)) selVs.value = [i]
  selE.value = null
  pendingSnap.value = snap()
  dragOrigin.value = toCropNorm(e)
  dragSet.value = selVs.value.map((k) => ({ i: k, x: pts.value[k * 2], y: pts.value[k * 2 + 1] }))
  dragging.value = i
  try { (e.currentTarget as Element).setPointerCapture(e.pointerId) } catch { /* 忽略 */ }
}

/** 边的命中线按下：拖动整条线（两端点同步平移） */
function onEdgeDown(e: PointerEvent, i: number) {
  e.stopPropagation()
  if (panMode.value || linkMode.value || cropping.value) return
  const ed = edges.value[i]
  if (!ed) return
  selE.value = i
  selVs.value = []
  pendingSnap.value = snap()
  dragOrigin.value = toCropNorm(e)
  dragSet.value = [
    { i: ed[0], x: pts.value[ed[0] * 2], y: pts.value[ed[0] * 2 + 1] },
    { i: ed[1], x: pts.value[ed[1] * 2], y: pts.value[ed[1] * 2 + 1] },
  ]
  dragging.value = -1
  try { (e.currentTarget as Element).setPointerCapture(e.pointerId) } catch { /* 忽略 */ }
}

/** 补线：第一次点记下起点，第二次点连线 */
function pickForLink(i: number) {
  if (pendingV.value === null) { pendingV.value = i; selVs.value = [i]; selE.value = null; return }
  if (pendingV.value === i) { pendingV.value = null; return }
  const s = snap()
  if (connect(pendingV.value, i)) pushSnap(s)
  pendingV.value = null
  selVs.value = [i]
  selE.value = null
}
function connect(a: number, b: number, dash: 0 | 1 = 0): boolean {
  if (a === b || a < 0 || b < 0) return false
  if (edges.value.some((e) => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a))) return false
  edges.value.push([a, b, dash])
  return true
}
function toggleLink() {
  linkMode.value = !linkMode.value
  pendingV.value = null
  if (linkMode.value) { panMode.value = false; cropping.value = false; arcMode.value = false }
}

// ---------------- 画弧 / 曲线 ----------------
/** 弧（曲线）是"弦式"的：只记**一串控制点的顶点下标**（2 个点时另加拱高）。
 *  几何由 arcPolyline 现算（画布、导出、弹窗共用这一份）。
 *  关键：**双击加控制点只是往 pts 里插一个下标，曲线始终是一条**，不会被拆成几段。 */
const arcMode = ref(false)
/** 画椭圆弧（圆台 / 圆锥 / 圆柱的底面就是这种"半椭圆"） */
const ellipseMode = ref(false)
const selArc = ref<number | null>(null)
function toggleArc() {
  arcMode.value = !arcMode.value
  ellipseMode.value = false
  pendingV.value = null
  if (arcMode.value) { linkMode.value = false; panMode.value = false; cropping.value = false }
}
function toggleEllipseArc() {
  ellipseMode.value = !ellipseMode.value
  arcMode.value = false
  pendingV.value = null
  if (ellipseMode.value) { linkMode.value = false; panMode.value = false; cropping.value = false }
}
/** 画椭圆弧：点两个顶点（= 椭圆长轴的两端），出来就是一条半椭圆。
 *  默认扁平度 0.2（短半轴 = 0.4 × 长半轴）—— 立体几何插图的底面差不多就这么扁。 */
function pickForEllipseArc(i: number) {
  if (pendingV.value === null) { pendingV.value = i; selVs.value = [i]; selE.value = null; selArc.value = null; return }
  if (pendingV.value === i) { pendingV.value = null; return }
  createArc(pendingV.value, i, true)
}
/** 把选中的弧翻面（开口方向反过来） */
function flipArc(i: number) {
  const a = arcs.value[i]
  if (!a) return
  const s = snap()
  a.bulge = +(-(a.bulge ?? 0)).toFixed(4)
  pushSnap(s)
}
/** 这条弧是不是半椭圆 */
function isEllipseArc(i: number): boolean {
  return !!arcs.value[i]?.ellipse
}
/** 这条弧的控制点下标表（兼容旧的 i0/i1 写法） */
function arcIdxOf(a: FigureArc): number[] | null {
  if (a.pts && a.pts.length >= 2) return a.pts
  if (a.i0 !== undefined && a.i1 !== undefined) return [a.i0, a.i1]
  return null
}
/** 曲线在 overlay 里的采样点：几何算在"元素像素"空间（viewW/imgW = 显示比例），再整体平移 */
function arcSamples(i: number): [number, number][] {
  const a = arcs.value[i], r = res.value
  if (!a || !r) return []
  const sc = viewW.value / r.imgW
  const list = arcPolyline(a, pts.value, sc * r.W, sc * r.H)
  const ox = sc * r.box[0], oy = sc * r.box[1]
  return list.map(([x, y]) => [x + ox, y + oy] as [number, number])
}
function arcPath(i: number): string {
  const list = arcSamples(i)
  if (list.length < 2) return ''
  let out = ''
  for (let k = 0; k < list.length; k++) out += (k ? ' L ' : 'M ') + list[k][0].toFixed(1) + ' ' + list[k][1].toFixed(1)
  return out
}
/** 拱顶（只有 2 个控制点时才有的曲率手柄）：取采样折线的中点 */
function arcApex(i: number): [number, number] {
  const list = arcSamples(i)
  return list.length ? list[list.length >> 1] : [0, 0]
}
/** 3 个控制点以上时，控制点本身就是可拖的顶点，不需要额外的拱高手柄 */
function needsBulgeHandle(i: number): boolean {
  const a = arcs.value[i]
  const idx = a ? arcIdxOf(a) : null
  return !!idx && idx.length === 2
}
/** 画一条曲线，并**顺手把底下被盖住的折线吃掉**。
 *  识别出来的椭圆本来就是一串折线，再手画一条椭圆弧就会两层重叠 ——
 *  不这么做，用户得一条条删那些折线，很烦。
 *  判据保守：一条边取 3 个采样点，**全都**落在新曲线 7px 内才吃；被吃得孤立的顶点也一起清掉。 */
function createArc(a: number, b: number, ellipse: boolean) {
  const r = res.value
  const bulge = defaultBulge(a, b, ellipse ? 0.2 : 0.25)
  const s0 = snap()
  const del: number[] = []
  let gone = 0
  if (r) {
    const sc = viewW.value / r.imgW
    const list = arcPolyline({ pts: [a, b], bulge, ellipse: ellipse ? 1 : undefined }, pts.value, sc * r.W, sc * r.H)
    if (list.length >= 2) {
      const ox = sc * r.box[0], oy = sc * r.box[1]
      const cur = list.map(([x, y]) => [x + ox, y + oy] as [number, number])
      const res2 = absorbCurve(cur, a, b, false)
      gone = res2.gone
      del.push(...res2.del)
    }
  }
  // 删过点之后下标会移位，新的两个端点要跟着挪
  const shift = (k: number) => k - del.filter((d) => d < k).length
  const na = shift(a), nb = shift(b)
  arcs.value.push({ pts: [na, nb], bulge, ellipse: ellipse ? 1 : undefined, dash: 0 })
  selArc.value = arcs.value.length - 1
  if (gone || del.length) pushSnap(s0)
  note.value = gone ? ('已吃掉 ' + gone + ' 条重合的线' + (del.length ? ' 、' + del.length + ' 个多余的点' : '')) : ''
  pendingV.value = null
  selVs.value = [nb]
  selE.value = null
}
const note = ref('')

/** 点到采样折线的距离（overlay 像素） */
function distToCurve(x: number, y: number, cur: [number, number][]) {
  let best = 1e9
  for (let i = 1; i < cur.length; i++) {
    const x0 = cur[i - 1][0], y0 = cur[i - 1][1]
    const dx = cur[i][0] - x0, dy = cur[i][1] - y0
    const L2 = dx * dx + dy * dy || 1e-9
    let t = ((x - x0) * dx + (y - y0) * dy) / L2
    t = Math.max(0, Math.min(1, t))
    const d = Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy))
    if (d < best) best = d
  }
  return best
}

/** 按**顶点链**找出"这两点之间那串折线" —— 比按距离容差猜确定得多。
 *  做法：先挑出"整条都落在这条新曲线附近"的边，**再在这个子图里找 a→b 的路径**。
 *  （不能直接取图上最短路径：实测两端之间常常直接有一条边，而真正要换掉的是另一条更长的链。）
 *  候选边还要满足：至少两段、每段都是碎线段（< 弦长 × 0.35，长直边被这条挡住）、
 *  整串点明显偏离弦（> 弦长 × 5%，说明它本来就在凑曲线）。 */
function absorbChain(a: number, b: number, cur: [number, number][], chord: number): number[] | null {
  const tol = Math.max(20, chord * 0.09)
  const nearEdge = (ei: number) => {
    const e = edges.value[ei]
    if (Math.hypot(px(e[1]) - px(e[0]), py(e[1]) - py(e[0])) > chord * 0.35) return false
    for (const t of [0.25, 0.5, 0.75]) {
      const x = px(e[0]) + (px(e[1]) - px(e[0])) * t
      const y = py(e[0]) + (py(e[1]) - py(e[0])) * t
      if (distToCurve(x, y, cur) > tol) return false
    }
    return true
  }
  const ok = new Set<number>()
  edges.value.forEach((e, i) => { void e; if (nearEdge(i)) ok.add(i) })
  if (!ok.size) return null
  // 在 ok 子图里 BFS 找 a→b
  const adj = new Map<number, number[]>()
  for (const ei of ok) {
    const e = edges.value[ei]
    if (!adj.has(e[0])) adj.set(e[0], [])
    if (!adj.has(e[1])) adj.set(e[1], [])
    adj.get(e[0])!.push(ei)
    adj.get(e[1])!.push(ei)
  }
  const prevE = new Map<number, number>()
  const seen = new Set<number>([a])
  const q = [a]
  while (q.length) {
    const v = q.shift() as number
    for (const ei of adj.get(v) || []) {
      const e = edges.value[ei]
      const nx = e[0] === v ? e[1] : e[0]
      if (seen.has(nx)) continue
      seen.add(nx)
      prevE.set(nx, ei)
      if (nx === b) { q.length = 0; break }
      q.push(nx)
    }
  }
  if (!prevE.has(b)) return null
  const path: number[] = []
  let v = b
  while (v !== a) {
    const ei = prevE.get(v)
    if (ei === undefined) return null
    path.push(ei)
    const e = edges.value[ei]
    v = e[0] === v ? e[1] : e[0]
  }
  path.reverse()
  if (path.length < 2) return null
  // 整串点要明显偏离弦（否则它本来就是直的，不该当成"曲线近似"）
  const ax = px(a), ay = py(a), bx = px(b), by = py(b)
  const ux = (bx - ax) / (chord || 1), uy = (by - ay) / (chord || 1)
  let maxPerp = 0
  for (const ei of path) {
    const e = edges.value[ei]
    const mx = (px(e[0]) + px(e[1])) / 2, my = (py(e[0]) + py(e[1])) / 2
    maxPerp = Math.max(maxPerp, Math.abs((mx - ax) * -uy + (my - ay) * ux))
  }
  if (maxPerp < chord * 0.05) return null
  return path
}

/** 把"已经被这条曲线盖住"的折线吃掉（识别出来的椭圆是一串折线，手画椭圆弧会两层重叠）。
 *  **先按顶点链找**（确定），再按距离补那些没被链覆盖到的碎线段。
 *  返回被吃掉的边数和"因此变孤立"的点；点用倒序删，调用方负责 pushSnap。 */
function absorbCurve(cur: [number, number][], a: number, b: number, quiet: boolean) {
  const chord = Math.hypot(px(b) - px(a), py(b) - py(a))
  const chain = absorbChain(a, b, cur, chord)
  const drop: number[] = chain ? chain.slice() : []
  // 按距离补漏：手画的椭圆弧和识别出来的椭圆总有十几像素差（实测最近一条差 10.3px），
  // 门槛太紧就吃不着、太松又会误伤结构线 —— 所以配合**长度限制**一起用。
  const TOL = 32
  const maxEdge = chord * 0.25
  edges.value.forEach((e, i) => {
    if (drop.includes(i)) return
    if (Math.hypot(px(e[1]) - px(e[0]), py(e[1]) - py(e[0])) > maxEdge) return
    for (const t of [0.2, 0.5, 0.8]) {
      const x = px(e[0]) + (px(e[1]) - px(e[0])) * t
      const y = py(e[0]) + (py(e[1]) - py(e[0])) * t
      if (distToCurve(x, y, cur) > TOL) return
    }
    drop.push(i)
  })
  if (!drop.length) return { gone: 0, del: [] as number[] }
  const keep = edges.value.filter((_, i) => !drop.includes(i))
  const used = new Set<number>()
  keep.forEach((e) => { used.add(e[0]); used.add(e[1]) })
  const del: number[] = []
  for (let i = 0; i < nVerts.value; i++) {
    if (i === a || i === b || used.has(i)) continue
    if (edges.value.some((e) => e[0] === i || e[1] === i)) del.push(i)
  }
  edges.value = keep
  del.sort((x, y) => y - x).forEach((i) => finishRemove(i))
  if (!quiet) {
    note.value = '已吃掉 ' + drop.length + ' 条重合的线' + (chain ? '（按顶点链）' : '') +
      (del.length ? ' 、' + del.length + ' 个多余的点' : '')
  }
  return { gone: drop.length, del }
}

/** 拖完拱高手柄（形状对齐了）再吃一次 —— 手画时拱高是默认值，跟识别出来的椭圆对不齐，吃不着。 */
function absorbForArc(i: number) {
  const a = arcs.value[i]
  const idx = a ? arcIdxOf(a) : null
  const r = res.value
  if (!a || !idx || idx.length !== 2 || !r) return
  const cur = arcSamples(i)
  if (cur.length < 2) return
  const s0 = snap()
  const out = absorbCurve(cur, idx[0], idx[1], false)
  if (out.gone || out.del.length) {
    pushSnap(s0)
    // 点被删掉后这条曲线自己的下标也要跟着挪
    const shift = (k: number) => k - out.del.filter((d) => d < k).length
    a.pts = [shift(idx[0]), shift(idx[1])]
    selVs.value = []
  }
}

/** 画弧：第一次点记起点，第二次点成弧。默认拱高 0.25，且**朝图形外侧鼓**（免得弧切进图形里） */
function pickForArc(i: number) {
  if (pendingV.value === null) { pendingV.value = i; selVs.value = [i]; selE.value = null; selArc.value = null; return }
  if (pendingV.value === i) { pendingV.value = null; return }
  createArc(pendingV.value, i, false)
}
/** 默认拱向：让拱顶落在"图形重心"的反面，弧就不会切进图形内部 */
function defaultBulge(i0: number, i1: number, mag = 0.25): number {
  const n = pts.value.length / 2
  if (!n) return 0.25
  let cx = 0, cy = 0
  for (let k = 0; k < n; k++) { cx += pts.value[k * 2]; cy += pts.value[k * 2 + 1] }
  cx /= n; cy /= n
  const ax = pts.value[i0 * 2], ay = pts.value[i0 * 2 + 1]
  const bx = pts.value[i1 * 2], by = pts.value[i1 * 2 + 1]
  const dx = bx - ax, dy = by - ay
  const c2 = Math.hypot(dx, dy) || 1
  const ux = dy / c2, uy = -dx / c2                 // 正拱高朝这一侧
  const mx = (ax + bx) / 2 - cx, my = (ay + by) / 2 - cy
  return mx * ux + my * uy > 0 ? -mag : mag         // 重心在正侧就反过来鼓
}
/** 拖拱高手柄（只有 2 个控制点时有）：把指针位置投影到弦的垂线上 */
let arcDrag = -1
function onArcCtrlDown(e: PointerEvent, i: number) {
  e.stopPropagation()
  pushUndo()
  arcDrag = i
  selArc.value = i
  selVs.value = []
  selE.value = null
  try { (e.currentTarget as Element).setPointerCapture(e.pointerId) } catch { /* 忽略 */ }
}

/** 被曲线用到的顶点（= 曲线的控制点）—— 在图上画成绿色，跟图形本身的顶点区分开，
 *  免得用户看着像个"莫名多出来的点"，也一眼能看出哪几个点可以拖来改曲线 */
const arcEnds = computed(() => {
  const s = new Set<number>()
  for (const a of arcs.value) {
    const idx = arcIdxOf(a)
    if (idx) for (const k of idx) s.add(k)
  }
  return s
})

/** 双击曲线上：在那一点**加一个控制点**。曲线始终是一条，只是多一个可拖的点 ——
 *  3 个控制点时正好是"过三点的圆"，所以点在弧上时不加控制点形状也完全不变。 */
function addArcPoint(i: number, e: MouseEvent) {
  const a = arcs.value[i]
  const idx = a ? arcIdxOf(a) : null
  const r = res.value
  if (!a || !idx || !r) return
  const p = toCropNorm(e)
  if (!p) return
  const list = arcSamples(i)
  if (list.length < 2) return
  const mx = p[0] * viewW.value, my = p[1] * viewH.value
  let bk = 0, bd = 1e9
  for (let k = 0; k < list.length; k++) {
    const dd = Math.hypot(list[k][0] - mx, list[k][1] - my)
    if (dd < bd) { bd = dd; bk = k }
  }
  if (bd > 26) return                                   // 离曲线太远，当误点
  // 每个控制点在采样序列里的位置，用来判断新点插在哪一段
  const anchors = idx.map((k) => {
    const vx = px(k), vy = py(k)
    let best = 0, bdd = 1e9
    for (let j = 0; j < list.length; j++) {
      const dd = Math.hypot(list[j][0] - vx, list[j][1] - vy)
      if (dd < bdd) { bdd = dd; best = j }
    }
    return best
  })
  let seg = 0
  for (let j = 0; j + 1 < anchors.length; j++) if (bk >= anchors[j]) seg = j
  const s = snap()
  const newIdx = nVerts.value
  const sc = viewW.value / r.imgW
  pts.value.push(+((list[bk][0] - sc * r.box[0]) / (sc * r.W)).toFixed(4), +((list[bk][1] - sc * r.box[1]) / (sc * r.H)).toFixed(4))
  labels.value.push('')
  lconf.value.push(0)
  offs.value.push({ dx: 0, dy: 0 })
  const next = idx.slice()
  next.splice(seg + 1, 0, newIdx)
  a.pts = next
  if (next.length > 2) delete a.bulge                    // 拱高只对 2 个控制点有意义
  delete a.i0
  delete a.i1
  pushSnap(s)
  selArc.value = i
  selVs.value = [newIdx]
  selE.value = null
}

function toggleArcDash(i: number) {
  const a = arcs.value[i]
  if (!a) return
  const s = snap()
  a.dash = a.dash ? 0 : 1
  pushSnap(s)
}
/** 删掉选中的整条曲线 */
function delArc(i: number) {
  const s = snap()
  arcs.value.splice(i, 1)
  if (selArc.value === i) selArc.value = null
  pushSnap(s)
}

function togglePan() {
  panMode.value = !panMode.value
  if (panMode.value) { linkMode.value = false; cropping.value = false }
}
function toggleCrop() {
  cropping.value = !cropping.value
  if (cropping.value) { linkMode.value = false; panMode.value = false }
}
/** 顶点坐标微调（按识别框的百分比给，用 change 而不是 input —— 连续敲数字只记一次历史） */
function onCoord(i: number, axis: 0 | 1, e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(v)) return
  const next = +clamp01(v / 100).toFixed(4)
  if (pts.value[i * 2 + axis] === next) return
  pushUndo()
  pts.value[i * 2 + axis] = next
}
function toggleDash() {
  const i = selE.value
  if (i === null) return
  const e = edges.value[i]
  if (!e) return
  pushUndo()
  e[2] = e[2] ? 0 : 1
}
function onUp() {
  if (!cropping.value || !drag.value || !img.value) return
  const d = drag.value
  dragStart.value = null
  cropping.value = false
  if (d.w < 0.05 || d.h < 0.05) { drag.value = null; return }
  const iw = img.value.naturalWidth, ih = img.value.naturalHeight
  drag.value = null
  rerun([Math.round(d.x * iw), Math.round(d.y * ih), Math.round((d.x + d.w) * iw), Math.round((d.y + d.h) * ih)])
}

/** 删掉第 i 个顶点后的收尾（顶点/字母/偏移/弧的下标一起挪）。
 *  **弧是按下标引用顶点的**：漏掉这一步，删一个顶点之后所有弧的 i0/i1 就全错位 ——
 *  弧会接到别的顶点上、看着像"断成两截、再也编辑不了"（实测踩过）。
 *  mergedInto：这个顶点是被"并到"某个点上（只连一条边的情况），传进来弧就改指过去，而不是作废。 */
function finishRemove(i: number, mergedInto: number | null = null) {
  pts.value.splice(i * 2, 2)
  labels.value.splice(i, 1)
  lconf.value.splice(i, 1)
  offs.value.splice(i, 1)
  const fix = (k: number): number | null => (k === i ? mergedInto : (k > i ? k - 1 : k))
  arcs.value = arcs.value.flatMap((a) => {
    const idx = arcIdxOf(a)
    if (!idx) return [a]
    const fixed = idx.map(fix)
    if (fixed.some((k) => k === null)) return []                // 控制点没了 → 这条曲线作废
    const uniq: number[] = []
    for (const k of fixed as number[]) if (uniq[uniq.length - 1] !== k) uniq.push(k)
    if (uniq.length < 2) return []
    return [{ ...a, pts: uniq, i0: undefined, i1: undefined }]
  })
  selArc.value = null
  selVs.value = []
  selE.value = null
}
/** 删掉第 i 个顶点并重编号（不记历史，由调用方决定） */
function delVertexRaw(i: number) {
  const keep = (list: [number, number, number][]) =>
    list
      .filter((e) => e[0] !== i && e[1] !== i)
      .map((e) => [(e[0] > i ? e[0] - 1 : e[0]), (e[1] > i ? e[1] - 1 : e[1]), e[2]] as [number, number, number])

  const inc = edges.value.filter((e) => e[0] === i || e[1] === i)
  // 只连一条线的顶点（多半是识别多出来的端点）：**并到最近的点上**，别把那条线一起删了 ——
  // 自动识别常把一条虚线画到离交点十几个像素的地方，删点时必须把线接过去。
  if (inc.length === 1 && nVerts.value > 2) {
    const vx = pts.value[i * 2], vy = pts.value[i * 2 + 1]
    let best = -1, bd = 0.2
    for (let k = 0; k < nVerts.value; k++) {
      if (k === i) continue
      const d = Math.hypot(pts.value[k * 2] - vx, pts.value[k * 2 + 1] - vy)
      if (d < bd) { bd = d; best = k }
    }
    if (best >= 0) {
      const e = inc[0]
      const other = e[0] === i ? e[1] : e[0]
      const rest = edges.value.filter((x) => x !== e)
      edges.value = keep([...rest, [other, best, e[2]] as [number, number, number]])
      finishRemove(i, best)
      return
    }
  }
  edges.value = keep(edges.value)
  finishRemove(i)
}
function delVertex(i: number) {
  pushUndo()
  delVertexRaw(i)
}
/** 批量删掉选中的顶点（倒序删，索引才不会错位） */
function delSelectedVertices() {
  if (!selVs.value.length) return
  pushUndo()
  const ids = selVs.value.slice().sort((a, b) => b - a)
  for (const i of ids) delVertexRaw(i)
}
function delEdge(i: number) {
  pushUndo()
  edges.value.splice(i, 1)
  selE.value = null
}

/** 改字母：一次连续输入只记一次历史 */
const labelEditing = ref(false)
function onLabelInput() {
  if (!labelEditing.value) { pushUndo(); labelEditing.value = true }
}
function onLabelBlur() { labelEditing.value = false }

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { emit('close'); return }
  const t = e.target as HTMLElement | null
  const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')
  const mod = e.ctrlKey || e.metaKey
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    if (e.shiftKey) redo(); else undo()
    return
  }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return }
  if (typing) return
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selVs.value.length) { e.preventDefault(); delSelectedVertices() }
    else if (selArc.value !== null) { e.preventDefault(); delArc(selArc.value) }
    else if (selE.value !== null) { e.preventDefault(); delEdge(selE.value) }
  }
}

/** 组一个 mathfig 元素（坐标换算回整图，尺寸保持原图宽高比） */
function buildPatch(): Partial<SlideElement> | null {
  const im = img.value, r = res.value
  if (!im || !r) return null
  const iw = r.imgW, ih = r.imgH
  const [bx, by, ex2, ey2] = r.box
  const cw = ex2 - bx, ch = ey2 - by
  const n = pts.value.length / 2
  const full: number[] = []
  for (let i = 0; i < n; i++) {
    full.push(+((pts.value[i * 2] * cw + bx) / iw).toFixed(4), +((pts.value[i * 2 + 1] * ch + by) / ih).toFixed(4))
  }
  const sc = Math.min(440 / iw, 470 / ih)
  const w = Math.max(90, Math.round(iw * sc)), h = Math.max(70, Math.round(ih * sc))
  // offs 是"字母相对顶点"的偏移；渲染时字母默认还要再往上抬 labelGap，这里把那一段补回去
  const gapRatio = labelGap(labelFontSize(h)) / h
  const labelOffsets = offs.value.map((o) => ({
    dx: +((o.dx * cw) / iw).toFixed(4),
    dy: +((o.dy * ch) / ih + gapRatio).toFixed(4),
  }))
  return {
    w, h,
    kind: iw / ih > 1.05 ? 'pyramid' : 'cube',
    points: full,
    mesh: { edges: edges.value.map((e) => [e[0], e[1], e[2]] as [number, number, number]), faces: [] },
    // 弧图元：坐标本来就是"相对识别框归一化"，跟 points 同一套，直接搬过去
    arcs: arcs.value.length ? arcs.value.map((a) => ({ ...a })) : undefined,
    vlabels: labels.value.map((s) => (s.trim() ? s.trim() : null)),
    labelOffsets,
    fill: 'transparent',
    stroke: '#1a1a1a',
    strokeWidth: 2.8,
    // 留一份识别上下文，之后还能回到这个弹窗继续改
    // 注意：这份 ctx 要跟"存下来的那张图"对得上，所以尺寸 / 识别框都乘上同一个 k
    vectorizeCtx: {
      src: storeSrc.value || props.src,
      imgW: Math.round(iw * storeK.value),
      imgH: Math.round(ih * storeK.value),
      box: [Math.round(bx * storeK.value), Math.round(by * storeK.value), Math.round(ex2 * storeK.value), Math.round(ey2 * storeK.value)] as [number, number, number, number],
    },
  } as Partial<SlideElement>
}

const findEl = (id: string) => store.currentSlide?.elements.find((e) => e.id === id)

/**
 * 给**试卷 / 讲义**用的 SVG ✓（纯新增 ✓ 不影响原路径 ✓）。
 *
 * 试卷只认图片 ✗，所以这里从顶点/边**直接拼一段 SVG** ✓，
 * 再交给试卷栅格化成 [图N] ✓（试卷已有 svgStringToPng ✓）。
 * 只画边（虚实用 stroke-dasharray ✓）—— 顶点圆点和字母标注暂不带 ✓，
 * 但线稿的几何信息是完整的 ✓。
 */
function buildSinkSvg(): string {
  const w = 800
  const h = 600
  const px = (i: number) => ((pts.value[i * 2] ?? 0) * w).toFixed(1)
  const py = (i: number) => ((pts.value[i * 2 + 1] ?? 0) * h).toFixed(1)
  let out = ''
  for (const e of edges.value) {
    out +=
      '<line x1="' + px(e[0]) + '" y1="' + py(e[0]) + '" x2="' + px(e[1]) + '" y2="' + py(e[1]) +
      '" stroke="#1a1a1a" stroke-width="2.6"' + (e[2] ? ' stroke-dasharray="7 5"' : '') + '/>'
  }
  // ⚠ 必须返回**完整 SVG（带 viewBox）** ✗ —— 只给片段的话，试卷侧读不到尺寸 ✓
  //   会按 480×320 兜底 ✓ 而这里是 800×600 ✓ → **图被裁** ✗（三维那边刚踩过同一个坑 ✓）。
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '">' + out + '</svg>'
}

/** 插入一个新图形（不动原图） */
function insertNew() {
  // ⭐ 试卷登记了接收口 → 把描摹结果当图片交给它 ✓（用户要求 ✓）
  if (vectorizeSink.value) {
    vectorizeSink.value(buildSinkSvg(), '矢量描摹图')
    vectorizeSink.value = null
    emit('close')
    return
  }
  const patch = buildPatch()
  if (!patch) return
  store.addElement('mathfig', patch)
  emit('close')
}

/** 替换掉那张图片：位置原地不动，尺寸沿用原元素的（保持用户当时缩放的大小） */
function insertReplace() {
  const patch = buildPatch()
  if (!patch) return
  const src = props.replaceId ? findEl(props.replaceId) : undefined
  if (!src) { insertNew(); return }
  store.addElement('mathfig', { ...patch, x: src.x, y: src.y, w: src.w, h: src.h } as Partial<SlideElement>)
  store.removeElement(src.id)
  emit('close')
}
/** 继续编辑：把改好的结果写回原元素（保留 id / 位置 / 尺寸） */
function saveEdit() {
  const patch = buildPatch()
  const el = props.editId ? findEl(props.editId) : undefined
  if (!patch) { emit('close'); return }
  if (!el) { insertNew(); return }
  store.pushHistory()
  store.updateElement(el.id, { ...patch, x: el.x, y: el.y, w: el.w, h: el.h } as Partial<SlideElement>)
  emit('close')
}
function insert() {
  if (props.editId) saveEdit()
  else insertReplace()
}

/** 主按钮文案 */
const primaryText = computed(() => {
  if (props.editId) return '保存修改'
  if (props.replaceId) return '替换这张图片'
  return '插入当前页'
})

/** 原图降采样成一份小的 data URL（本来就不大就原样返回）。
 *  返回的 k 是缩放系数 —— 存进元素的那份是缩过的，所以 **box / imgW / imgH 必须一起乘 k**，
 *  否则「回到弹窗继续编辑」时会拿原图尺寸去解释一张缩小了的图，叠加图整整错位一个比例。
 *  跨域图导出会失败，失败就原样返回（k=1）。 */
function shrinkSrc(im: HTMLImageElement, maxSide = 1400): { url: string; k: number } {
  try {
    const k = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight))
    if (k >= 1) return { url: props.src, k: 1 }
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(im.naturalWidth * k))
    c.height = Math.max(1, Math.round(im.naturalHeight * k))
    const g = c.getContext('2d')
    if (!g) return { url: props.src, k: 1 }
    g.drawImage(im, 0, 0, c.width, c.height)
    return { url: c.toDataURL('image/png'), k }
  } catch {
    return { url: props.src, k: 1 }
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  try {
    const im = await loadImageElement(props.src)
    img.value = im
    prepareSrcPix(im)
    const shrunk = shrinkSrc(im)
    storeSrc.value = shrunk.url
    storeK.value = shrunk.k
    baseScale.value = Math.min(VIEW_W / im.naturalWidth, VIEW_H / im.naturalHeight, 2)
    await nextTick()
    const el = props.editId ? (findEl(props.editId) as MathFigureElement | undefined) : undefined
    if (el && restoreFromElement(el)) return
    await run(null)
  } catch (e) {
    err.value = (e as Error)?.message || String(e)
  }
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <!-- ⚠ 必须 Teleport 到 body —— 与三维窗口同一个坑：App.vue 里的弹窗困在 .app 的层叠上下文内，
       而试卷 PaperModal 是 Teleport 到 body 的，所以 z-index 再高也压不过它。
       （用户实测：点「矢量描摹」像没反应一样。） -->
  <Teleport to="body">
  <div class="vd" @mousedown.self="emit('close')">
    <div class="vd__box">
      <header class="vd__head">
        <div class="vd__title">
          <span class="vd__badge">✎</span>
          {{ props.editId ? '编辑矢量图形' : '图片转图形' }}
        </div>
        <button class="vd__close" @click="emit('close')"><AppIcon name="close" :size="13" /></button>
      </header>

      <div class="vd__body">
        <div class="vd__left">
          <div
            ref="viewport"
            class="vd__viewport"
            :class="{ 'vd__vp--pan': panMode, 'vd__vp--crop': cropping, 'vd__vp--link': linkMode }"
            @wheel.prevent="onWheel"
            @pointerdown="onVpDown"
            @pointermove="onVpMove"
            @pointerup="onVpUp"
            @pointerleave="onVpUp"
          >
            <div
              ref="stage"
              class="vd__stage"
              :style="{ width: viewW + 'px', height: viewH + 'px' }"
              @pointerdown="onDown"
              @pointermove="onMove"
              @pointerup="onUpStage"
              @pointerleave="onUpStage"
            >
              <img class="vd__img" :src="props.src" :width="viewW" :height="viewH" draggable="false" alt="">
              <svg class="vd__ov" :width="viewW" :height="viewH">
                <g v-for="(e, i) in edges" :key="'e' + i">
                  <line
                    :x1="ex(i)[0]" :y1="ex(i)[1]" :x2="ex(i)[2]" :y2="ex(i)[3]"
                    stroke="transparent" stroke-width="11" style="cursor:move"
                    @pointerdown="onEdgeDown($event, i)"
                    @click="selE = i; selVs = []"
                  />
                  <line
                    :x1="ex(i)[0]" :y1="ex(i)[1]" :x2="ex(i)[2]" :y2="ex(i)[3]"
                    :stroke="selE === i ? '#ff8f1f' : '#1668e0'"
                    :stroke-width="selE === i ? 3.6 : 2.2"
                    :stroke-dasharray="e[2] ? '6 5' : ''"
                    stroke-linecap="round"
                    style="pointer-events:none"
                  />
                </g>
                <g v-for="(a, i) in arcs" :key="'arc' + i">
                  <path
                    :d="arcPath(i)" fill="none" stroke="transparent" stroke-width="14"
                    style="cursor:pointer"
                    @click="selArc = i; selVs = []; selE = null"
                    @dblclick.stop="addArcPoint(i, $event)"
                  />
                  <path
                    :d="arcPath(i)" fill="none"
                    :stroke="selArc === i ? '#ff8f1f' : '#1668e0'"
                    :stroke-width="selArc === i ? 3.6 : 2.2"
                    :stroke-dasharray="a.dash ? '6 5' : ''" stroke-linecap="round"
                    style="pointer-events:none"
                  />
                  <circle
                    v-if="selArc === i && needsBulgeHandle(i)"
                    :cx="arcApex(i)[0]" :cy="arcApex(i)[1]" r="9" fill="transparent" style="cursor:grab"
                    @pointerdown="onArcCtrlDown($event, i)"
                  />
                  <circle
                    v-if="selArc === i && needsBulgeHandle(i)"
                    :cx="arcApex(i)[0]" :cy="arcApex(i)[1]" r="5.5" fill="#12b76a" stroke="#fff" stroke-width="1.5"
                    style="pointer-events:none"
                  />
                </g>
                <g v-for="i in nVerts" :key="'v' + (i - 1)">
                  <circle
                    :cx="px(i - 1)" :cy="py(i - 1)" r="10" fill="transparent" style="cursor:pointer"
                    @pointerdown="onVertexDown($event, i - 1)"
                  />
                  <circle
                    :cx="px(i - 1)" :cy="py(i - 1)" :r="pendingV === i - 1 ? 6.5 : 4.5"
                    :fill="pendingV === i - 1 ? '#12b76a' : (selVs.includes(i - 1) ? '#ff8f1f' : (arcEnds.has(i - 1) ? '#12b76a' : '#e02020'))"
                    stroke="#fff" stroke-width="1.2"
                    style="pointer-events:none"
                  />
                  <text
                    :x="px(i - 1) + 7" :y="py(i - 1) - 6" font-size="13" font-weight="700"
                    fill="#c02020" stroke="#fff" stroke-width="3" paint-order="stroke"
                    style="pointer-events:none"
                  >{{ i - 1 }}</text>
                </g>
              </svg>
              <div
                v-if="drag" class="vd__drag"
                :style="{ left: (drag.x * 100) + '%', top: (drag.y * 100) + '%', width: (drag.w * 100) + '%', height: (drag.h * 100) + '%' }"
              ></div>
              <div
                v-if="boxSel" class="vd__selbox"
                :style="{
                  left: Math.min(boxSel.x0, boxSel.x1) + 'px',
                  top: Math.min(boxSel.y0, boxSel.y1) + 'px',
                  width: Math.abs(boxSel.x1 - boxSel.x0) + 'px',
                  height: Math.abs(boxSel.y1 - boxSel.y0) + 'px',
                }"
              ></div>
              <div v-if="busy" class="vd__busy">识别中…</div>
            </div>
          </div>

          <div class="vd__viewbar">
            <button class="vd__ico" title="缩小" @click="zoomCenter(1 / 1.25)"><AppIcon name="minus" :size="12" /></button>
            <span class="vd__pct">{{ Math.round(zoom * 100) }}%</span>
            <button class="vd__ico" title="放大" @click="zoomCenter(1.25)"><AppIcon name="plus" :size="12" /></button>
            <button class="vd__btn vd__btn--sm" @click="resetZoom">适屏</button>
            <button class="vd__btn vd__btn--sm" :class="{ 'vd__btn--on': panMode }" @click="togglePan">抓手</button>
            <span class="vd__viewtip">滚轮缩放 · 中键或抓手拖动平移</span>
          </div>

          <p class="vd__hint">
            {{ cropping
              ? '在图上拖一个框，松开后按这个范围重新识别（用来切掉下方的「图 1」这类题注）'
              : '顶点可以按住拖动（框选多个可整组拖）；点顶点选中 → Delete 删掉（只连一条线的点会并到最近的顶点上，线不会丢）；' +
                '点线可以拖动整条线、选中后 Delete 删掉 / 切换虚实；少了一条线就用右边的「＋ 补一条线」。' }}
          </p>
        </div>

        <div class="vd__right">
          <div v-if="err" class="vd__err">{{ err }}</div>
          <template v-else-if="res">
            <div class="vd__stat">
              顶点 <b>{{ nVerts }}</b> · 边 <b>{{ edges.length }}</b> · 虚线 <b>{{ edges.filter((e) => e[2]).length }}</b>
            </div>
            <div v-if="clipSides" class="vd__clip">
              识别框的<b>{{ clipSides }}</b>边切到了图形 —— 框里的线会断开、字母可能只剩半个。
              点「框选识别范围」把框放宽一点再识别。
            </div>
            <div class="vd__row">
              <button class="vd__ico" :disabled="!canUndo" title="撤销 (Ctrl+Z)" @click="undo"><AppIcon name="undo" :size="12" /></button>
              <button class="vd__ico" :disabled="!canRedo" title="重做 (Ctrl+Shift+Z)" @click="redo"><AppIcon name="redo" :size="12" /></button>
              <button class="vd__btn" :class="{ 'vd__btn--on': cropping }" @click="toggleCrop">框选识别范围</button>
              <button class="vd__btn" :disabled="busy" @click="rerun(null)">整图重识别</button>
            </div>
            <div class="vd__adv">
              <button class="vd__advhead" @click="advOpen = !advOpen">
                <span class="vd__advcaret">{{ advOpen ? '▾' : '▸' }}</span>
                细调阈值
                <b v-if="advDirty" class="vd__advdot" title="已改过阈值（不是默认值）">已改</b>
                <span class="vd__advsub">调完点下面「按新阈值重新识别」</span>
              </button>
              <div v-if="advOpen" class="vd__advbody">
                <div v-for="g in ADV_GROUPS" :key="g.title" class="vd__advgrp">
                  <div class="vd__advgt">{{ g.title }}</div>
                  <label v-for="d in g.items" :key="d.k" class="vd__advrow" :title="d.hint + '（默认 ' + d.def + '）'">
                    <span class="vd__advlab">{{ d.label }}</span>
                    <input v-model.number="adv[d.k]" type="range" :min="d.min" :max="d.max" :step="d.step">
                    <span class="vd__advval">{{ adv[d.k] }}</span>
                  </label>
                </div>
                <div class="vd__row">
                  <button class="vd__btn vd__btn--sm" :disabled="busy" @click="rerun(null)">按新阈值重新识别</button>
                  <button class="vd__btn vd__btn--sm" :disabled="!advDirty" @click="advReset()">恢复默认</button>
                </div>
                <p class="vd__tip">只影响「重新识别」。数值会记住，重开应用还在。</p>
              </div>
            </div>


            <div v-if="selVs.length === 1" class="vd__coord">
              <span class="vd__coordlab">顶点 #{{ selVs[0] }} 位置</span>
              <label>x <input :value="Math.round(pts[selVs[0] * 2] * 100)" type="number" min="0" max="100" @change="onCoord(selVs[0], 0, $event)"></label>
              <label>y <input :value="Math.round(pts[selVs[0] * 2 + 1] * 100)" type="number" min="0" max="100" @change="onCoord(selVs[0], 1, $event)"></label>
              <span class="vd__coordtip">%</span>
            </div>

            <div v-if="selVs.length > 1" class="vd__row vd__row--sel">
              <span class="vd__selnum">已选中 {{ selVs.length }} 个顶点</span>
              <button class="vd__btn vd__btn--danger" @click="delSelectedVertices">全部删掉</button>
              <button class="vd__btn" @click="selVs = []">取消选择</button>
            </div>

            <div class="vd__label">
              顶点字母 —— 已自动填 <b>{{ labels.filter((s) => s.trim()).length }}</b> 个<template v-if="unsureN">，其中 <b class="vd__warn">{{ unsureN }}</b> 个不太确定，请对一眼</template>
            </div>
            <div class="vd__list">
              <div v-for="i in nVerts" :key="'l' + (i - 1)" class="vd__item" :class="{ 'vd__item--on': selVs.includes(i - 1) }">
                <span class="vd__idx" @click="selVs = [i - 1]; selE = null">{{ i - 1 }}</span>
                <input
                  v-model="labels[i - 1]" class="vd__input"
                  :class="{ 'vd__input--unsure': lconf[i - 1] > 0 && lconf[i - 1] < 0.8 }"
                  :title="lconf[i - 1] > 0 ? ('识别置信度 ' + Math.round(lconf[i - 1] * 100) + '%') : '没配上字母，手动填或留空'"
                  placeholder="如 A / A_1"
                  @input="onLabelInput" @blur="onLabelBlur"
                  @focus="selVs = [i - 1]; selE = null"
                >
                <button class="vd__del" title="删掉这个顶点（只连一条线的点会并到最近的顶点上，线不会丢）" @click="delVertex(i - 1)">
                  <AppIcon name="trash" :size="13" />
                </button>
              </div>
            </div>
            <div class="vd__row">
              <button class="vd__btn" :class="{ 'vd__btn--on': linkMode }" @click="toggleLink">
                {{ linkMode ? '结束补线' : '＋ 补一条线' }}
              </button>
              <button class="vd__btn" :class="{ 'vd__btn--on': arcMode }" @click="toggleArc">
                {{ arcMode ? '结束画弧' : '＋ 画一段弧' }}
              </button>
              <button class="vd__btn" :class="{ 'vd__btn--on': ellipseMode }" @click="toggleEllipseArc">
                {{ ellipseMode ? '结束画椭圆弧' : '＋ 画椭圆弧' }}
              </button>
              <button class="vd__btn" title="同底字母配下标 1 的一对（C 和 C₁）之间一定有线，识别漏了就补上"
                @click="refillByLetters()">按字母补线（侧棱 + 面的边）</button>
              <button v-if="selE !== null" class="vd__btn" @click="toggleDash">实线 / 虚线 切换</button>
            </div>
            <p v-if="linkMode" class="vd__tip vd__tip--on">
              {{ pendingV === null
                ? '补线中：点一个顶点作为起点；点空白处会新建一个顶点'
                : '已选起点 #' + pendingV + ' —— 再点另一个顶点就连上了（点同一个点取消）' }}
            </p>
            <p v-if="arcMode" class="vd__tip vd__tip--on">
              {{ pendingV === null
                ? '画弧中：点一个顶点作为弧的起点'
                : '起点 #' + pendingV + ' —— 再点一个顶点就画出这段弧（点同一个点取消）' }}
            </p>
            <p v-if="note" class="vd__tip vd__tip--on">{{ note }}</p>
            <p v-if="ellipseMode" class="vd__tip vd__tip--on">
              {{ pendingV === null
                ? '画椭圆弧中：点一个顶点作为长轴的一端（圆台底面就点左右两端）'
                : '起点 #' + pendingV + ' —— 再点另一个顶点，画出半椭圆（点同一个点取消）' }}
            </p>
            <div v-if="selArc !== null" class="vd__row">
              <span class="vd__selnum">{{ isEllipseArc(selArc) ? '椭圆弧' : '曲线' }} #{{ selArc }}：拖绿点{{ isEllipseArc(selArc) ? '（绿点=半椭圆高低，翻面按钮改开口方向）' : '（弧上任意位置双击可加控制点）' }}</span>
              <button v-if="isEllipseArc(selArc)" class="vd__btn" @click="flipArc(selArc)">翻面（开口反向）</button>
              <button class="vd__btn" @click="toggleArcDash(selArc)">{{ arcs[selArc]?.dash ? '改成实线' : '改成虚线' }}</button>
              <button class="vd__btn vd__btn--danger" @click="delArc(selArc)">删掉这段弧</button>
            </div>
            <div v-if="selE !== null" class="vd__row">
              <button class="vd__btn vd__btn--danger" @click="delEdge(selE)">删掉选中的这条线（#{{ selE }}）</button>
            </div>
            <p class="vd__tip">字母默认摆在被抹掉的原字母位置上；不填就不标。</p>
          </template>
          <div v-else-if="!busy" class="vd__err">没有结果</div>
        </div>
      </div>

      <footer class="vd__foot">
        <button class="vd__btn" @click="emit('close')">取消</button>
        <button v-if="props.replaceId && !props.editId" class="vd__btn" :disabled="!res || busy" @click="insertNew()">插入为新图形</button>
        <button class="vd__btn vd__btn--primary" :disabled="!res || busy" @click="insert()">
          {{ primaryText }}
        </button>
      </footer>
    </div>
  </div>
  </Teleport>
</template>

<style scoped>
.vd { position: fixed; inset: 0; z-index: 3200; /* 必须高于试卷弹层(.pm 是 2000) —— 与三维窗口一致 */ background: rgba(20, 24, 34, 0.55); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; }
.vd__box { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: 92vw; max-width: 1000px; max-height: 92vh; display: flex; flex-direction: column; overflow: hidden; }
.vd__head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--border); }
.vd__title { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: var(--text); }
.vd__badge { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: var(--radius-sm); background: var(--brand-soft); color: var(--brand-800); font-size: 13px; }
.vd__close { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; cursor: pointer; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--gray-600); }
.vd__close:hover { background: var(--danger-soft); border-color: var(--danger-border); color: var(--danger); }
.vd__body { display: flex; gap: 14px; padding: 14px; overflow: auto; }
.vd__left { flex: none; }
.vd__viewport { width: 560px; height: 450px; overflow: auto; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: #fff; touch-action: none; }
.vd__vp--crop { cursor: crosshair; }
.vd__vp--link { cursor: copy; }
.vd__vp--pan { cursor: grab; }
.vd__stage { position: relative; margin: 0 auto; background: #fff; touch-action: none; }
.vd__img { display: block; user-select: none; }
.vd__ov { position: absolute; left: 0; top: 0; }
.vd__drag { position: absolute; border: 1px dashed var(--brand-600); background: rgba(90, 120, 240, 0.12); pointer-events: none; }
.vd__selbox { position: absolute; border: 1px dashed #1668e0; background: rgba(22, 104, 224, 0.1); pointer-events: none; }
.vd__busy { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(255, 255, 255, 0.72); font-size: 13px; color: var(--muted); }
.vd__viewbar { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.vd__pct { min-width: 42px; text-align: center; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.vd__viewtip { font-size: 12px; color: var(--gray-500); }
.vd__hint { margin: 8px 0 0; font-size: 12px; color: var(--muted); max-width: 560px; line-height: 1.5; }
.vd__right { flex: 1; min-width: 260px; display: flex; flex-direction: column; gap: 8px; }
.vd__stat { font-size: 13px; color: var(--muted); }
.vd__stat b { color: var(--text); }
.vd__clip { font-size: 12px; line-height: 1.55; color: #8a5a00; background: #fff7e6; border: 1px solid #e8c07a; border-radius: var(--radius-sm); padding: 6px 8px; }
.vd__clip b { color: #b25b00; }
.vd__row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.vd__row--sel { background: var(--brand-soft); border: 1px solid var(--brand-400); border-radius: var(--radius-sm); padding: 5px 7px; }
.vd__selnum { font-size: 12px; color: var(--brand-800); }
.vd__btn { padding: 6px 12px; font-size: 13px; cursor: pointer; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--gray-700); transition: background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease); }
.vd__btn--sm { padding: 4px 9px; font-size: 12px; }
.vd__btn:hover:not(:disabled) { background: var(--brand-soft); border-color: var(--brand-400); color: var(--brand-800); }
.vd__btn:disabled { opacity: 0.45; cursor: not-allowed; }
.vd__btn--on { background: var(--brand-600); border-color: var(--brand-600); color: #fff; }
.vd__btn--primary { background: var(--brand-600); border-color: var(--brand-600); color: #fff; font-weight: 600; }
.vd__btn--danger { border-color: var(--danger-border); color: var(--danger); }
.vd__ico { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; cursor: pointer; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--gray-700); }
.vd__ico:hover:not(:disabled) { background: var(--brand-soft); border-color: var(--brand-400); color: var(--brand-800); }
.vd__ico:disabled { opacity: 0.4; cursor: not-allowed; }
.vd__coord { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
.vd__coordlab { color: var(--gray-600); }
.vd__coord label { display: inline-flex; align-items: center; gap: 3px; }
.vd__coord input { width: 54px; padding: 3px 5px; font-size: 12px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: #fff; color: var(--text); }
.vd__coord input:focus { outline: none; border-color: var(--brand-400); box-shadow: 0 0 0 2px var(--brand-soft); }
.vd__coordtip { color: var(--gray-500); }
.vd__label { font-size: 12px; color: var(--muted); margin-top: 2px; }
.vd__list { flex: 1; min-height: 90px; max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; padding-right: 4px; }
.vd__item { display: flex; align-items: center; gap: 6px; padding: 2px 4px; border-radius: var(--radius-sm); border: 1px solid transparent; }
.vd__item--on { background: var(--brand-soft); border-color: var(--brand-400); }
.vd__idx { width: 22px; text-align: center; font-size: 12px; color: var(--muted); cursor: pointer; flex: none; }
.vd__input { flex: 1; min-width: 0; padding: 4px 7px; font-size: 13px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: #fff; color: var(--text); }
.vd__input:focus { outline: none; border-color: var(--brand-400); box-shadow: 0 0 0 2px var(--brand-soft); }
.vd__input--unsure { border-color: #e8a33d; background: #fffaf0; }
.vd__warn { color: #c77700; }
.vd__del { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; flex: none; padding: 0; cursor: pointer; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--gray-600); }
.vd__del:hover { background: var(--danger-soft); border-color: var(--danger-border); color: var(--danger); }
.vd__tip { margin: 0; font-size: 12px; color: var(--gray-500); line-height: 1.5; }
.vd__tip--on { color: var(--brand-800); background: var(--brand-soft); border: 1px solid var(--brand-400); border-radius: var(--radius-sm); padding: 5px 8px; font-size: 12px; line-height: 1.5; }
.vd__err { font-size: 13px; color: var(--danger); background: var(--danger-soft); border: 1px solid var(--danger-border); border-radius: var(--radius-sm); padding: 8px 10px; line-height: 1.5; }
.vd__foot { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--border); background: var(--panel-2, #fafafd); }
.vd__adv { border-top: 1px solid var(--border); padding-top: 6px; }
.vd__advhead { display: flex; align-items: center; gap: 6px; width: 100%; padding: 4px 0; background: none; border: 0; cursor: pointer; font-size: 12px; color: var(--gray-700); text-align: left; }
.vd__advhead:hover { color: var(--brand-800); }
.vd__advcaret { color: var(--gray-500); }
.vd__advdot { color: var(--brand-800); background: var(--brand-soft); border: 1px solid var(--brand-400); border-radius: var(--radius-sm); padding: 0 4px; font-weight: 500; }
.vd__advsub { margin-left: auto; color: var(--gray-500); }
.vd__advbody { display: flex; flex-direction: column; gap: 7px; padding: 6px 0 2px; }
.vd__advgt { font-size: 12px; font-weight: 600; color: var(--gray-600); }
.vd__advrow { display: grid; grid-template-columns: 70px 1fr 42px; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); cursor: help; }
.vd__advlab { color: var(--gray-600); }
.vd__advrow input[type='range'] { width: 100%; min-width: 0; accent-color: var(--brand-600); }
.vd__advval { text-align: right; color: var(--text); font-variant-numeric: tabular-nums; }
</style>
