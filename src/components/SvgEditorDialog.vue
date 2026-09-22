<script setup lang="ts">
/**
 * 【绘制/形状 → SVG 编辑器】—— 一个**简单的矢量绘图**弹窗 ✓
 *
 * 定位：给老师补一套"画示意图"的手：直线 / 箭头 / 矩形 / 圆角矩形 / 圆 / 三角形 / 正多边形 /
 * 星形 / 折线 / 多边形 / 手绘 / 文字；选中可拖、可拉角缩放、可删、可改线色填充线宽线型、可撤销；
 * 画完**插进当前页** ✓；已经插进去的**双击就能回来接着改** ✓（模型存在元素上 ✓）。
 *
 * 四条设计（都是为了让结果"以后还能改"）：
 *  ① 画布 viewBox 就是 **1920×1080**（与幻灯片同尺寸 ✓）—— 画在哪就落在哪，所见即所得 ✓；
 *  ② 插进去的是**原生矢量元素**（shape / line / arrow / pen / text ✓）而**不是一张图** ✗ ——
 *     插完还能用属性面板改颜色、双击拖端点、跟着分组一起缩放 ✓（导出 PDF 也是矢量 ✓）；
 *  ③ 多笔自动**打成一个组合** ✓（挪一下就是整张图挪一下 ✓，要拆开点「解组」✓）；
 *  ④ 整张图的**模型挂在每个元素上**（svgDraw ✓）→ 双击任一元素回到这里接着改 ✓
 *     （应用时按 key **整张一次替换**，只留一步撤销 ✓）。
 *
 * ⚠ 拖拽一律用 **window 级监听**（不是画布上的 pointermove ✗）：
 *   鼠标拖出弹窗、甚至拖出窗口，也要接着画 / 接着缩放 ✓，松手一定收尾 ✓。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { ICONS as I } from '@/ui/icons'
import { useDeckStore } from '@/stores/deck'
import { LINE_STYLES, ARROW_HEADS, MATH_FIGURE_OPTIONS, lineDashCss } from '@/types'
import type { SlideElement, SvgItemData, SvgItemKind, SvgDrawing, MathFigureKind } from '@/types'
import { mathFigureElOfKind, renderFigureSvg } from '@/composables/figureRender'
import { svgEditorEditKey } from '@/ui/svgEditor'

const emit = defineEmits<{ (e: 'close'): void }>()
const store = useDeckStore()

/** 画布逻辑尺寸 = 幻灯片尺寸 ✓（所见即所得） */
const W = 1920
const H = 1080
const GRID = 60

type Tool = 'select' | SvgItemKind
interface Pt { x: number; y: number }
type Item = SvgItemData

const TOOLS: { v: Tool; label: string; icon: string; hint: string }[] = [
  { v: 'select', label: '选择', icon: 'draw', hint: '点一下选中，拖动挪位置，拉右下角小方块缩放；Delete 删除 ✓（拖到窗口外面也不会掉 ✓）' },
  { v: 'line', label: '直线', icon: 'line', hint: '在画布上按住拖一条直线 ✓' },
  { v: 'arrow', label: '箭头', icon: 'arrow', hint: '按住拖一个箭头 ✓（方向样式在右边选 ✓）' },
  { v: 'rect', label: '矩形', icon: 'rect', hint: '按住拖一个矩形 ✓' },
  { v: 'roundrect', label: '圆角矩形', icon: 'shape', hint: '按住拖一个圆角矩形 ✓（圆角大小在右边调 ✓）' },
  { v: 'ellipse', label: '圆 / 椭圆', icon: 'ellipse', hint: '按住拖一个椭圆（按住 Shift 是正圆 ✓）' },
  { v: 'triangle', label: '三角形', icon: 'symbol', hint: '按住拖一个三角形（底边在下、顶点在上 ✓）' },
  { v: 'parallelogram', label: '平行四边形', icon: 'shape', hint: '按住拖一个平行四边形（斜边自动 ✓ 顶点还能拖 ✓）' },
  { v: 'trapezoid', label: '梯形', icon: 'group', hint: '按住拖一个梯形（上底短、下底长、居中 ✓ 顶点还能拖 ✓）' },
  { v: 'ngon', label: '正多边形', icon: 'icon', hint: '按住拖一个正多边形（边数在右边调 3~12 ✓）' },
  { v: 'star', label: '星形', icon: 'plus', hint: '按住拖一个五角星 ✓' },
  { v: 'poly', label: '折线', icon: 'fig', hint: '一下一下点角点，回到起点（或双击）收尾 —— **不闭合** ✓' },
  { v: 'polygon', label: '多边形', icon: 'group', hint: '一下一下点角点，回到起点（或双击）收尾 —— **闭合** ✓ 可填色 ✓' },
  { v: 'pen', label: '手绘', icon: 'pen', hint: '按住随手画 ✓' },
  { v: 'text', label: '文字', icon: 'templates', hint: '先在右边写好字，再在画布上点一下放上去 ✓（选中后改右边输入框即改字 ✓）' },
]
const SWATCHES = ['#1a1a1a', '#534AB7', '#d92d20', '#2563eb', '#16a34a', '#d97706', '#64748b', '#ffffff']
const FILL_SWATCHES = ['none', '#534AB7', '#dbe4ff', '#ffe8cc', '#d3f9d8', '#ffe3e3', '#f1f3f5', '#ffffff']
const KIND_LABEL: Record<string, string> = {
  rect: '矩形', roundrect: '圆角矩形', ellipse: '圆', triangle: '三角形', ngon: '正多边形', star: '星形',
  parallelogram: '平行四边形', trapezoid: '梯形',
  line: '直线', arrow: '箭头', poly: '折线', polygon: '多边形', pen: '手绘', text: '文字', figure: '平面图形',
}
/** 【v1508】数学图形里的**平面图形**全搬进来（与图形库同一份清单 ✓ 不另起一套 ✗） */
const PLANE_FIGS = MATH_FIGURE_OPTIONS.filter((o) => o.cat === '平面图形')
const figLabel = (k?: string) => PLANE_FIGS.find((o) => o.v === k)?.label || String(k || '')

const editKey = ref(svgEditorEditKey.value)
const isEdit = computed(() => !!editKey.value)
const tool = ref<Tool>('select')
const items = ref<Item[]>([])
/** 【v1511】选中集（Shift 点选可多选 ✓）—— 复制/剪切/粘贴/删除都按它来 ✓ */
const selIds = ref<string[]>([])
/** 只选了一个时才是"那一笔"（样式回填 / 顶点编辑 / 数值微调都只对单个生效 ✓） */
const sel = computed(() => (selIds.value.length === 1 ? items.value.find((x) => x.id === selIds.value[0]) || null : null))
const isSel = (id: string) => selIds.value.indexOf(id) >= 0
function setSel(ids: string[]) { selIds.value = ids }
const draft = ref<Item | null>(null)
const polyPts = ref<Pt[]>([])
const polyCur = ref<Pt | null>(null)
const stroke = ref('#1a1a1a')
const fill = ref('none')
const strokeWidth = ref(3)
const dash = ref('solid')
const arrowHead = ref('triangle')
const sides = ref(5)
const cornerRadius = ref(18)
const textValue = ref('文字')
/** 【v1508】当前要放的平面图形（工具 'figure' 用它 ✓；选中一个平面图形时也可以用它"换图形" ✓） */
const figKind = ref<MathFigureKind>('triangle')
const msg = ref('')

/* ---------------- 拖拽（**window 级** ✓ 拖出窗口也不掉） ---------------- */
type Drag =
  | { mode: 'draw'; start: Pt }
  | { mode: 'move'; id: string; last: Pt; snapped?: boolean }
  | { mode: 'scale'; id: string; box: { x: number; y: number; w: number; h: number }; orig: Item }
  | null
let drag: Drag = null

const undoStack = ref<string[]>([])
function snapshot() { undoStack.value = [...undoStack.value.slice(-39), JSON.stringify(items.value)] }
function undo() {
  const last = undoStack.value[undoStack.value.length - 1]
  if (!last) { msg.value = '没有可撤销的了 ✓'; return }
  items.value = JSON.parse(last) as Item[]
  undoStack.value = undoStack.value.slice(0, -1)
  setSel([])
  msg.value = '已撤销一步 ✓'
}

const canvas = ref<SVGSVGElement | null>(null)

/** 画布坐标（**夹在画布里** ✓ —— 拖到窗口外面时，图形长到边就停，不会跑到 1920 之外 ✗） */
function pt(e: PointerEvent | MouseEvent): Pt {
  const r = canvas.value?.getBoundingClientRect()
  if (!r || !r.width || !r.height) return { x: 0, y: 0 }
  const x = ((e.clientX - r.left) / r.width) * W
  const y = ((e.clientY - r.top) / r.height) * H
  return { x: Math.max(0, Math.min(W, x)), y: Math.max(0, Math.min(H, y)) }
}
const r2 = (n: number) => Math.round(n)
const newId = () => 's' + Math.random().toString(36).slice(2, 8)

/** 一个元素的外框 —— line / poly 由**点**算 ✓
 *  ⚠ 口径统一：a/b 与 points 全是**绝对画布坐标** ✓（只有落盘成元素时才转相对 ✓） */
function boxOf(it: Item): { x: number; y: number; w: number; h: number } {
  if (it.kind === 'line' || it.kind === 'arrow') {
    const a = it.a || { x: 0, y: 0 }
    const b = it.b || { x: 0, y: 0 }
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
  }
  if (it.points && it.points.length) {
    const xs = it.points.map((p) => p.x)
    const ys = it.points.map((p) => p.y)
    const x0 = Math.min(...xs)
    const y0 = Math.min(...ys)
    return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 }
  }
  return { x: it.x, y: it.y, w: it.w, h: it.h }
}

/* ---------------- 图形 → 点（三角形 / 正多边形 / 星形共用一套 ✓ 预览与落盘同源 ✓） ---------------- */
function shapePoints(kind: SvgItemKind, x: number, y: number, w: number, h: number, n = 5): Pt[] {
  const cx = x + w / 2
  const cy = y + h / 2
  const rx = w / 2
  const ry = h / 2
  const out: Pt[] = []
  if (kind === 'triangle') return [{ x: cx, y }, { x: x + w, y: y + h }, { x, y: y + h }]
  // 【v1510】预置四边形：平行四边形（斜边 = 1/5 宽）与梯形（上底 = 3/5 宽，居中 ✓）
  if (kind === 'parallelogram') {
    const k = w * 0.22
    return [{ x: x + k, y }, { x: x + w, y }, { x: x + w - k, y: y + h }, { x, y: y + h }]
  }
  if (kind === 'trapezoid') {
    const k = w * 0.2
    return [{ x: x + k, y }, { x: x + w - k, y }, { x: x + w, y: y + h }, { x, y: y + h }]
  }
  if (kind === 'ngon' || kind === 'star') {
    const N = Math.max(3, Math.min(12, Math.round(n)))
    if (kind === 'ngon') {
      // 【v1510】朝向：整体转半格（π/N）—— 正六边形就有一条**水平的边** ✓，正方形也变成正的（不再是对角立着 ✗）
      for (let i = 0; i < N; i++) {
        const a = -Math.PI / 2 + Math.PI / N + (i * 2 * Math.PI) / N
        out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) })
      }
    } else {
      // 五角星（大小顶点交替 ✓）
      for (let i = 0; i < N * 2; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / N
        const k = i % 2 === 0 ? 1 : 0.42
        out.push({ x: cx + rx * k * Math.cos(a), y: cy + ry * k * Math.sin(a) })
      }
    }
    return out
  }
  return []
}
/** 这一笔要是"闭合多边形"（多边形 / 三角形 / 正多边形 / 星形 ✓）—— 点由 shapePoints 生成 ✓ */
function isPolyKind(k: SvgItemKind) {
  return k === 'polygon' || k === 'triangle' || k === 'ngon' || k === 'star' || k === 'parallelogram' || k === 'trapezoid'
}
/** 渲染 / 落盘共用的点串 ✓ */
function pointsOf(it: Item): Pt[] {
  if (it.points && it.points.length) return it.points
  if (isPolyKind(it.kind)) return shapePoints(it.kind, it.x, it.y, it.w, it.h, it.sides)
  return []
}
function pointsStr(it: Item, close = false): string {
  const ps = pointsOf(it)
  if (!ps.length) return ''
  const all = close && ps.length > 2 ? [...ps, ps[0]] : ps
  return all.map((p) => r2(p.x) + ',' + r2(p.y)).join(' ')
}
function lineEnds(it: Item): { p0: Pt; p1: Pt } {
  return { p0: it.a || { x: it.x, y: it.y }, p1: it.b || { x: it.x + it.w, y: it.y + it.h } }
}
const dashOf = (it: Item) => lineDashCss(it.dash) || undefined

/* ---------------- 【v1508】平面图形：用 **app 自己的渲染**（与画布 / 导出逐像素一致 ✓） ---------------- */
/** 按 (kind + 尺寸 + 颜色) 缓存 —— renderFigureSvg 每次都要挂一遍真组件，别在渲染里反复调 ✗ */
const figCache = new Map<string, string>()
function figureHtml(it: Item): string {
  const kind = it.figKind
  if (!kind) return ''
  const key = [kind, Math.round(it.w), Math.round(it.h), it.stroke, it.strokeWidth, it.fill, it.dash || ''].join('|')
  const hit = figCache.get(key)
  if (hit !== undefined) return hit
  let out = ''
  try {
    const el = mathFigureElOfKind(kind)
    Object.assign(el, {
      x: 0, y: 0, w: Math.max(8, Math.round(it.w)), h: Math.max(8, Math.round(it.h)),
      stroke: it.stroke, strokeWidth: it.strokeWidth,
      fill: it.fill && it.fill !== 'none' ? it.fill : 'transparent',
      ...(it.figExtra || {}),
    })
    out = renderFigureSvg(el as SlideElement).replace('<svg ', '<svg preserveAspectRatio="none" ')
  } catch { out = '' }
  figCache.set(key, out)
  if (figCache.size > 160) figCache.clear()
  return out
}

/* ---------------- 【v1508】编辑器内**再编辑**：顶点模式 + 数值微调 ✓ ---------------- */
/** 这一笔的"顶点"（绝对坐标 ✓）—— line/arrow 用两端点、poly/pen/polygon/三角形/正多边形/星形用点序列 */
function verticesOf(it: Item): Pt[] {
  if (it.kind === 'line' || it.kind === 'arrow') { const e = lineEnds(it); return [e.p0, e.p1] }
  return pointsOf(it)
}
/** 能拖顶点的那几类（平面图形 / 矩形 / 圆 / 文字都不走顶点模式 ✓ 它们直接改框 ✓） */
function canEditVertices(it: Item | null): boolean {
  if (!it) return false
  if (it.kind === 'line' || it.kind === 'arrow') return true
  if (it.points && it.points.length) return true
  return isPolyKind(it.kind)
}
let vDrag: { idx: number; snapped?: boolean } | null = null
/** 拖顶点前把"算出来的点"固化进 points ✓（自由多边形/折线/手绘本来就有 ✓） */
function bakePoints(it: Item) {
  if (!it.points || !it.points.length) it.points = pointsOf(it).map((p) => ({ ...p }))
}
/** 把 it 的点重新按 box 收一遍（改完点都要做 ✓） */
function rebox(it: Item) {
  const b = boxOf(it)
  it.x = b.x; it.y = b.y; it.w = b.w; it.h = b.h
}
const centerOf = (it: Item) => ({ x: it.x + it.w / 2, y: it.y + it.h / 2 })

/**
 * 【v1511】拖顶点时**守住形状约束** ✓ —— 老师要的：
 *   · 平行四边形：拖一个顶点 → **对角那个跟着走**，四条边依旧两两平行 ✓
 *   · 梯形：拖上底一个角 → 另一个上底角**对称跟**（保持等腰梯形 ✓）
 *   · 正多边形 / 星形：拖哪个顶点都**保持正**（半径与转角一起变，边长始终相等 ✓）
 *   · 三角形 / 自由多边形 / 折线 / 手绘：不约束（本来就随便拖 ✓）
 */
function moveVertex(it: Item, idx: number, p: Pt) {
  if (it.kind === 'line' || it.kind === 'arrow') {
    if (idx === 0) it.a = p
    else it.b = p
    rebox(it)
    return
  }
  bakePoints(it)
  const ps = (it.points || []).map((q) => ({ ...q }))
  if (it.kind === 'parallelogram' && ps.length === 4) {
    // 对角点 = 两个邻点之和 − 自己（平行四边形 A+C = B+D ✓）
    ps[idx] = p
    const a = ps[(idx + 1) % 4]
    const b = ps[(idx + 3) % 4]
    ps[(idx + 2) % 4] = { x: a.x + b.x - p.x, y: a.y + b.y - p.y }
  } else if (it.kind === 'trapezoid' && ps.length === 4) {
    // 上底（0,1）与下底（3,2）：拖一个角 → 同底另一个角左右对称跟 ✓
    ps[idx] = p
    const pair = idx === 0 ? 1 : idx === 1 ? 0 : idx === 2 ? 3 : 2
    const other = ps[pair]
    const cx = (p.x + other.x) / 2
    const half = Math.abs(p.x - other.x) / 2
    const side = p.x <= other.x ? -1 : 1
    ps[idx] = { x: cx + side * half, y: p.y }
    ps[pair] = { x: cx - side * half, y: other.y }
  } else if ((it.kind === 'ngon' || it.kind === 'star') && ps.length >= 3) {
    // 保持"正"：以中心为心，半径 = 拖到哪儿的距离，转角让被拖的顶点正落在指针上 ✓
    const c = centerOf(it)
    const N = ps.length
    const r = Math.max(8, Math.hypot(p.x - c.x, p.y - c.y))
    const step = (Math.PI * 2) / N
    const ang = Math.atan2(p.y - c.y, p.x - c.x)
    const a0 = ang - idx * step
    for (let k = 0; k < N; k++) {
      // 星形：奇数号顶点在内圈（与 shapePoints 同口径 ✓）
      const rr = it.kind === 'star' && k % 2 === 1 ? r * 0.42 : r
      ps[k] = { x: c.x + rr * Math.cos(a0 + k * step), y: c.y + rr * Math.sin(a0 + k * step) }
    }
  } else {
    ps[idx] = p
  }
  it.points = ps
  rebox(it)
}
function onVertexDown(e: PointerEvent, it: Item, idx: number) {
  if (tool.value !== 'select') return
  e.stopPropagation()
  setSel([it.id])
  syncStyleFrom(it)
  vDrag = { idx }
  bindDrag()
}

/** 双击顶点 = 删掉它（闭合的最少留 3 个、折线/手绘最少留 2 个 ✓） */
function deleteVertex(it: Item, idx: number) {
  if (it.kind === 'line' || it.kind === 'arrow') return
  bakePoints(it)
  const n = (it.points || []).length
  const min = it.closed ? 3 : 2
  if (n <= min) { msg.value = '再删就不成形了（最少 ' + min + ' 个顶点 ✓）'; return }
  snapshot()
  it.points = (it.points || []).filter((_, i) => i !== idx)
  const b = boxOf(it)
  it.x = b.x; it.y = b.y; it.w = b.w; it.h = b.h
  msg.value = '删掉一个顶点（可撤销 ✓）'
}
/** 双击一条边 = 在**那一点**插一个顶点 ✓（与画布上的顶点编辑同一套手感 ✓） */
function insertVertexAt(it: Item, p: Pt) {
  if (it.kind === 'line' || it.kind === 'arrow') return
  bakePoints(it)
  const ps = it.points || []
  if (ps.length < 2) return
  let best = 0
  let bestD = Infinity
  const segs = it.closed ? ps.length : ps.length - 1
  for (let i = 0; i < segs; i++) {
    const a = ps[i]
    const b = ps[(i + 1) % ps.length]
    const vx = b.x - a.x
    const vy = b.y - a.y
    const L2 = vx * vx + vy * vy || 1
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2))
    const q = { x: a.x + vx * t, y: a.y + vy * t }
    const d = Math.hypot(p.x - q.x, p.y - q.y)
    if (d < bestD) { bestD = d; best = i }
  }
  snapshot()
  it.points = [...ps.slice(0, best + 1), { x: Math.round(p.x), y: Math.round(p.y) }, ...ps.slice(best + 1)]
  const b2 = boxOf(it)
  it.x = b2.x; it.y = b2.y; it.w = b2.w; it.h = b2.h
  msg.value = '加了一个顶点（拖它可以微调 ✓）'
}
/* ---------------- 【v1509】样式控件**既改选中的那一笔、也改"下一笔的默认"** ✓ ---------------- */
/** 把选中项的颜色/线宽/线型回填到控件上（选中谁，控件就显示谁 ✓ 不然改的时候一脸问号 ✗） */
function syncStyleFrom(it: Item) {
  stroke.value = it.stroke || '#1a1a1a'
  fill.value = it.fill ?? 'none'
  strokeWidth.value = it.strokeWidth ?? 3
  dash.value = it.dash || 'solid'
  if (it.sides) sides.value = it.sides
  if (it.cornerRadius !== undefined) cornerRadius.value = it.cornerRadius
  if (it.kind === 'arrow' && it.arrowHead) arrowHead.value = it.arrowHead
  if (it.kind === 'text') textValue.value = it.text || ''
  if (it.kind === 'figure' && it.figKind) figKind.value = it.figKind
}
/** 【v1511】样式改的是**所有选中项** ✓（没选中就只改"下一笔的默认" ✓） */
function selItems(): Item[] { return items.value.filter((x) => selIds.value.indexOf(x.id) >= 0) }
function applyStroke(v: string) { stroke.value = v; const l = selItems(); if (l.length) { snapshot(); l.forEach((it) => { it.stroke = v }) } }
function applyFill(v: string) { fill.value = v; const l = selItems(); if (l.length) { snapshot(); l.forEach((it) => { it.fill = v }) } }
function applyWidth(v: number) {
  const n = Math.max(1, Math.min(20, Number(v) || 3))
  strokeWidth.value = n
  const l = selItems()
  if (l.length) { snapshot(); l.forEach((it) => { it.strokeWidth = n }) }
}
function applyDash(v: string) { dash.value = v; const l = selItems(); if (l.length) { snapshot(); l.forEach((it) => { it.dash = v }) } }
function applySides(v: number) {
  const n = Math.max(3, Math.min(12, Math.round(Number(v) || 5)))
  sides.value = n
  const l = selItems().filter((it) => it.kind === 'ngon' || it.kind === 'star')
  if (l.length) {
    snapshot()
    l.forEach((it) => {
      it.sides = n
      it.points = undefined      // 拖过顶点的话按新边数重新生成（不然改了没反应 ✗）
      rebox(it)
    })
  }
}
function applyCorner(v: number) {
  const n = Math.max(0, Math.min(160, Math.round(Number(v) || 0)))
  cornerRadius.value = n
  const l = selItems().filter((it) => it.kind === 'roundrect')
  if (l.length) { snapshot(); l.forEach((it) => { it.cornerRadius = n }) }
}

/* ---------------- 【v1511】编辑器内的剪贴板：复制 / 剪切 / 粘贴 / 原地复制 ✓ ---------------- */
const clip = ref<Item[]>([])
/** 选中的这几笔复制一份（点往后错开一点 ✓ 免得叠在一起看不出来 ✓） */
function cloneItems(list: Item[], dx = 0, dy = 0): Item[] {
  return list.map((it) => {
    const c = JSON.parse(JSON.stringify(it)) as Item
    c.id = newId()
    translate(c, dx, dy)
    return c
  })
}
function copySel() {
  const l = selItems()
  if (!l.length) { msg.value = '先点一下要复制的那些笔 ✓'; return }
  clip.value = JSON.parse(JSON.stringify(l)) as Item[]
  msg.value = '已复制 ' + l.length + ' 笔（Ctrl+V 粘贴 ✓）'
}
function cutSel() {
  const l = selItems()
  if (!l.length) { msg.value = '先点一下要剪切的那些笔 ✓'; return }
  clip.value = JSON.parse(JSON.stringify(l)) as Item[]
  delSel()
  msg.value = '已剪切 ' + clip.value.length + ' 笔（Ctrl+V 粘贴 ✓）'
}
function pasteClip() {
  if (!clip.value.length) { msg.value = '剪贴板是空的（先 Ctrl+C 复制 ✓）'; return }
  snapshot()
  const add = cloneItems(clip.value, 40, 40)
  items.value = [...items.value, ...add]
  setSel(add.map((x) => x.id))
  msg.value = '已粘贴 ' + add.length + ' 笔 ✓'
}
/** 原地复制（Ctrl+D ✓） */
function duplicateSel() {
  const l = selItems()
  if (!l.length) { msg.value = '先点一下要复制的那些笔 ✓'; return }
  snapshot()
  const add = cloneItems(l, 40, 40)
  items.value = [...items.value, ...add]
  setSel(add.map((x) => x.id))
  msg.value = '已原地复制 ' + add.length + ' 笔 ✓'
}
function selectAll() {
  setSel(items.value.map((x) => x.id))
  msg.value = '已全选 ' + items.value.length + ' 笔 ✓'
}
/** 控件上显示的值：选中了就显示选中项的 ✓ */
const shownFill = computed(() => (sel.value ? (sel.value.fill ?? 'none') : fill.value))
const shownDash = computed(() => (sel.value ? (sel.value.dash || 'solid') : dash.value))
const shownWidth = computed(() => (sel.value ? sel.value.strokeWidth : strokeWidth.value))
const shownStroke = computed(() => (sel.value ? sel.value.stroke : stroke.value))

/** 选中项改一个数值（X / Y / 宽 / 高 ✓） */
function setNum(key: 'x' | 'y' | 'w' | 'h', v: string) {
  const it = sel.value
  if (!it) return
  const n = Number(v)
  if (!isFinite(n)) return
  snapshot()
  if (key === 'x' || key === 'y') translate(it, key === 'x' ? n - it.x : 0, key === 'y' ? n - it.y : 0)
  else if (key === 'w') scaleTo(it, boxOf(it), Math.max(0.05, n / Math.max(1, it.w)), 1)
  else scaleTo(it, boxOf(it), 1, Math.max(0.05, n / Math.max(1, it.h)))
  msg.value = '已调整 ✓'
}
/** 换平面图形（选中的那一笔是平面图形时 ✓） */
function changeFigKind(k: MathFigureKind) {
  figKind.value = k
  const it = sel.value
  if (!it || it.kind !== 'figure') return
  const def = mathFigureElOfKind(k)
  snapshot()
  it.figKind = k
  it.figExtra = undefined
  // 尺寸按新图形的默认比例走（不然换完会拉变形 ✗）
  if (def.w && def.h) { it.w = Math.max(80, Math.round(it.w)); it.h = Math.round(it.w * (def.h / def.w)) }
  msg.value = '换成「' + figLabel(k) + '」✓'
}

/* ---------------- 交互（window 级 ✓） ---------------- */
function onWinMove(e: PointerEvent) { handleMove(e) }
function onWinUp() { handleUp() }
function bindDrag() {
  window.addEventListener('pointermove', onWinMove)
  window.addEventListener('pointerup', onWinUp)
  window.addEventListener('pointercancel', onWinUp)
}
function unbindDrag() {
  window.removeEventListener('pointermove', onWinMove)
  window.removeEventListener('pointerup', onWinUp)
  window.removeEventListener('pointercancel', onWinUp)
}

function onCanvasDown(e: PointerEvent) {
  if (e.button !== 0) return
  const p = pt(e)
  if (tool.value === 'poly' || tool.value === 'polygon') {
    if (polyPts.value.length >= 3 && Math.hypot(p.x - polyPts.value[0].x, p.y - polyPts.value[0].y) < 18) { commitPoly(true); return }
    polyPts.value = [...polyPts.value, p]
    polyCur.value = p
    bindDrag()             // 鼠标移到窗口外也要跟着预览 ✓
    return
  }
  if (tool.value === 'select') { setSel([]); return }
  if (tool.value === 'text') {
    snapshot()
    const it: Item = {
      id: newId(), kind: 'text', x: p.x, y: p.y, w: Math.max(60, textValue.value.length * 42), h: 60,
      text: textValue.value || '文字', stroke: stroke.value, strokeWidth: strokeWidth.value, fill: 'none',
    }
    items.value = [...items.value, it]
    setSel([it.id])
    tool.value = 'select'
    return
  }
  const base: Item = {
    id: newId(), kind: tool.value as SvgItemKind,
    x: p.x, y: p.y, w: 0, h: 0,
    stroke: stroke.value, strokeWidth: strokeWidth.value, fill: fill.value,
    dash: dash.value, arrowHead: arrowHead.value, sides: sides.value, cornerRadius: cornerRadius.value,
  }
  if (tool.value === 'line' || tool.value === 'arrow') { base.a = p; base.b = p } else if (tool.value === 'pen') { base.points = [p] }
  // 【v1508】平面图形：把 app 那套默认参数（顶点/刻度/标签…）一起带上 ✓ —— 落盘就是同一个 mathfig ✓
  if (tool.value === 'figure') {
    base.figKind = figKind.value
    const def = mathFigureElOfKind(figKind.value) as unknown as Record<string, unknown>
    const skip = new Set(['id', 'type', 'x', 'y', 'w', 'h', 'rot', 'kind', 'stroke', 'strokeWidth', 'fill', 'strokeDash'])
    const extra: Record<string, unknown> = {}
    for (const k of Object.keys(def)) if (!skip.has(k) && def[k] !== undefined) extra[k] = def[k]
    base.figExtra = extra
    base.h = 0
    base.w = 0
  }
  draft.value = base
  drag = { mode: 'draw', start: p }
  bindDrag()
}

function handleMove(e: PointerEvent) {
  const p = pt(e)
  // 【v1508】拽顶点（编辑器内再编辑 ✓）
  if (vDrag) {
    const it = sel.value
    if (it) moveVertex(it, vDrag.idx, p)
    return
  }
  if ((tool.value === 'poly' || tool.value === 'polygon') && polyPts.value.length) { polyCur.value = p; return }
  const d = draft.value
  if (d && drag && drag.mode === 'draw') {
    if (d.kind === 'line' || d.kind === 'arrow') d.b = e.shiftKey ? { x: p.x, y: drag.start.y } : p
    else if (d.kind === 'pen') {
      const last = d.points?.[d.points.length - 1]
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 4) d.points = [...(d.points || []), p]
    } else {
      const w = Math.abs(p.x - drag.start.x)
      const h = Math.abs(p.y - drag.start.y)
      const s = e.shiftKey ? Math.min(w, h) : 0
      d.x = s ? Math.min(drag.start.x, drag.start.x + (p.x < drag.start.x ? -s : s)) : Math.min(drag.start.x, p.x)
      d.y = s ? Math.min(drag.start.y, drag.start.y + (p.y < drag.start.y ? -s : s)) : Math.min(drag.start.y, p.y)
      d.w = s || w
      d.h = s || h
    }
    return
  }
  if (drag && drag.mode === 'move') {
    const g = drag
    const dx = p.x - g.last.x
    const dy = p.y - g.last.y
    if (!g.snapped && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)) { snapshot(); g.snapped = true }
    // 【v1511】选中的**一起挪** ✓
    for (const id of selIds.value) {
      const t = items.value.find((x) => x.id === id)
      if (t) translate(t, dx, dy)
    }
    g.last = p
    return
  }
  if (drag && drag.mode === 'scale') {
    const g = drag
    const idx = items.value.findIndex((x) => x.id === g.id)
    if (idx < 0) return
    const sx = g.box.w > 4 ? Math.max(0.05, (p.x - g.box.x) / g.box.w) : 1
    const sy = g.box.h > 4 ? Math.max(0.05, (p.y - g.box.y) / g.box.h) : 1
    const next = JSON.parse(JSON.stringify(g.orig)) as Item   // 从起手快照重算（否则会累积漂移 ✗）
    scaleTo(next, g.box, sx, sy)
    items.value = items.value.map((x, i) => (i === idx ? next : x))
  }
}

function handleUp() {
  if (draft.value) commitDraft()
  drag = null
  vDrag = null
  unbindDrag()
}

function commitDraft() {
  const d = draft.value
  draft.value = null
  if (!d) return
  if (d.kind === 'figure' && (d.w < 12 || d.h < 12)) {
    // 在画布上"点一下"放图 → 用这个图形的默认尺寸（居中在点击处 ✓）
    const def = mathFigureElOfKind(d.figKind || 'triangle')
    const w = Math.max(120, Math.round(def.w || 320))
    const h = Math.max(90, Math.round(def.h || 220))
    d.x = Math.max(0, Math.min(W - w, Math.round(d.x - w / 2)))
    d.y = Math.max(0, Math.min(H - h, Math.round(d.y - h / 2)))
    d.w = w
    d.h = h
  }
  if (d.kind === 'line' || d.kind === 'arrow') {
    const { p0, p1 } = lineEnds(d)
    if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < 8) return
  } else if (d.kind === 'pen') {
    if ((d.points || []).length < 2) return
    const b = boxOf(d)
    d.x = b.x; d.y = b.y; d.w = b.w; d.h = b.h
  } else if (d.w < 6 && d.h < 6) return
  snapshot()
  items.value = [...items.value, d]
  setSel([d.id])
  tool.value = 'select'
}

function commitPoly(closed = false) {
  const ps = polyPts.value
  polyPts.value = []
  polyCur.value = null
  unbindDrag()
  if (ps.length < 2) return
  snapshot()
  const xs = ps.map((p) => p.x)
  const ys = ps.map((p) => p.y)
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  const wantPoly = tool.value === 'polygon'
  const it: Item = {
    id: newId(), kind: wantPoly ? 'polygon' : 'poly',
    x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0,
    points: ps.map((p) => ({ x: p.x, y: p.y })),      // 绝对坐标 ✓
    closed: closed || wantPoly,
    stroke: stroke.value, strokeWidth: strokeWidth.value, fill: fill.value, dash: dash.value,
  }
  items.value = [...items.value, it]
  setSel([it.id])
  tool.value = 'select'
}

function translate(it: Item, dx: number, dy: number) {
  if (it.kind === 'line' || it.kind === 'arrow') {
    it.a = { x: (it.a as Pt).x + dx, y: (it.a as Pt).y + dy }
    it.b = { x: (it.b as Pt).x + dx, y: (it.b as Pt).y + dy }
  } else if (it.points && it.points.length) {
    it.points = it.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
  } else {
    it.x += dx
    it.y += dy
    return
  }
  const b = boxOf(it)
  it.x = b.x; it.y = b.y; it.w = b.w; it.h = b.h
}
function scaleTo(it: Item, box: { x: number; y: number; w: number; h: number }, sx: number, sy: number) {
  const f = (p: Pt): Pt => ({ x: box.x + (p.x - box.x) * sx, y: box.y + (p.y - box.y) * sy })
  if (it.kind === 'line' || it.kind === 'arrow') { it.a = f(it.a as Pt); it.b = f(it.b as Pt) }
  else if (it.points && it.points.length) { it.points = it.points.map(f) }
  else { it.w = Math.max(8, it.w * sx); it.h = Math.max(8, it.h * sy); it.x = box.x; it.y = box.y }
  const b = boxOf(it)
  it.x = b.x; it.y = b.y; it.w = b.w; it.h = b.h
}

function onItemDown(e: PointerEvent, it: Item) {
  if (tool.value !== 'select') return
  e.stopPropagation()
  // 【v1511】Shift 点 = 加选/减选 ✓（多选后能一起挪、一起改色、一起复制删除 ✓）
  if (e.shiftKey) {
    setSel(isSel(it.id) ? selIds.value.filter((x) => x !== it.id) : [...selIds.value, it.id])
  } else if (!isSel(it.id)) {
    setSel([it.id])
  }
  syncStyleFrom(it)
  drag = { mode: 'move', id: it.id, last: pt(e) }
  bindDrag()
}
function onHandleDown(e: PointerEvent, it: Item) {
  if (tool.value !== 'select') return
  e.stopPropagation()
  setSel([it.id])
  snapshot()
  drag = { mode: 'scale', id: it.id, box: boxOf(it), orig: JSON.parse(JSON.stringify(it)) as Item }
  bindDrag()
}
/** 事件坐标 → 画布坐标（顶点插点用 ✓） */
function ptOfEvent(e: MouseEvent | PointerEvent): Pt { return pt(e) }
/**
 * 【v1510】挑工具 = **开始画** → 顺手取消选中 ✓
 * ⚠ 不取消会出这种坑：上一笔还选着，改「边数」就把**它**改了 ✗
 *   （真机探针里"正六边形"被后一步的边数=4 悄悄改成了正方形 ✓ 抓到）
 *   要改已有的某一笔，用「选择」工具点它 —— 那时控件改的才是它 ✓
 */
function pickTool(t: Tool) {
  tool.value = t
  polyPts.value = []
  polyCur.value = null
  // ⚠ 只有**绘制工具**才取消选中 ✓：「选择」保留（不然"选中一笔 → 点选择 → 改色"就断了 ✗）；
  //   平面图形下拉也保留（"换成这个"那颗按钮要靠选中态才出来 ✓）
  if (t !== 'select') setSel([])
}

/**
 * 下拉里挑了一个平面图形 —— **一律是"准备放一个"** ✓
 * ⚠ 原来写成"选中项是平面图形就换图形" ✗ —— 刚放下的那个还是选中态，于是连着放第二个就变成改第一个了 ✗
 *   （真机探针当场抓到 ✓）现在"换图形"走旁边那颗明确的按钮 ✓
 */
function onFigPick(k: string) {
  const kind = k as MathFigureKind
  figKind.value = kind
  tool.value = 'figure'
  polyPts.value = []
  msg.value = '在画布上拖一个「' + figLabel(kind) + '」出来（点一下 = 默认大小 ✓）'
}
function onItemDbl(e: MouseEvent, it: Item) {
  if (it.kind !== 'text') return
  e.stopPropagation()
  const next = window.prompt('改文字：', it.text || '')
  if (next == null) return
  snapshot()
  it.text = next
  textValue.value = next
  it.w = Math.max(60, next.length * 42)
}
/** 选中文字时，右边输入框直接改它 ✓ */
function onTextInput() {
  const it = sel.value
  if (!it || it.kind !== 'text') return
  it.text = textValue.value
  it.w = Math.max(60, textValue.value.length * 42)
}

function delSel() {
  if (!selIds.value.length) { msg.value = '先点一下要删的那一笔 ✓'; return }
  snapshot()
  const gone = new Set(selIds.value)
  items.value = items.value.filter((x) => !gone.has(x.id))
  msg.value = gone.size > 1 ? '删掉 ' + gone.size + ' 笔（可撤销 ✓）' : ''
  setSel([])
}
function clearAll() {
  if (!items.value.length) return
  snapshot()
  items.value = []
  setSel([])
  polyPts.value = []
  msg.value = '画布已清空（可撤销 ✓）'
}

/* ---------------- 落盘：一笔 → 一个原生矢量元素 ✓ ---------------- */
function toElement(it: Item): { type: 'shape' | 'line' | 'arrow' | 'pen' | 'text' | 'mathfig'; overrides: Partial<SlideElement> } {
  // 【v1508】平面图形 → **原生 mathfig 元素** ✓（插完照样能在属性面板改参数 / 双击编辑顶点 ✓）
  if (it.kind === 'figure' && it.figKind) {
    const b0 = boxOf(it)
    return {
      type: 'mathfig',
      overrides: {
        kind: it.figKind,
        x: r2(b0.x), y: r2(b0.y), w: Math.max(20, r2(b0.w)), h: Math.max(20, r2(b0.h)),
        stroke: it.stroke, strokeWidth: it.strokeWidth,
        fill: it.fill && it.fill !== 'none' ? it.fill : 'transparent',
        strokeDash: it.dash && it.dash !== 'solid' ? it.dash : undefined,
        ...(it.figExtra || {}),
      } as Partial<SlideElement>,
    }
  }
  const b = boxOf(it)
  const common = { stroke: it.stroke, strokeWidth: it.strokeWidth, strokeDash: it.dash && it.dash !== 'solid' ? it.dash : undefined }
  if (it.kind === 'rect' || it.kind === 'roundrect' || it.kind === 'ellipse') {
    return {
      type: 'shape',
      overrides: {
        x: r2(it.x), y: r2(it.y), w: Math.max(4, r2(it.w)), h: Math.max(4, r2(it.h)),
        shape: it.kind === 'ellipse' ? 'ellipse' : 'rect',
        fill: it.fill, stroke: it.stroke, strokeWidth: it.strokeWidth,
        cornerRadius: it.kind === 'roundrect' ? (it.cornerRadius ?? 18) : 0,
        strokeDash: common.strokeDash,
      } as Partial<SlideElement>,
    }
  }
  if (it.kind === 'line' || it.kind === 'arrow') {
    const { p0, p1 } = lineEnds(it)
    const x = Math.min(p0.x, p1.x)
    const y = Math.min(p0.y, p1.y)
    const w = Math.max(4, Math.abs(p1.x - p0.x))
    const h = Math.max(4, Math.abs(p1.y - p0.y))
    const pts = [(p0.x - x) / w, (p0.y - y) / h, (p1.x - x) / w, (p1.y - y) / h]
    const t = it.kind === 'line' ? 'line' : 'arrow'
    return {
      type: t,
      overrides: {
        x: r2(x), y: r2(y), w: r2(w), h: r2(h), ...common, points: pts,
        ...(it.kind === 'arrow' ? { arrowHead: it.arrowHead || 'triangle' } : {}),
      } as Partial<SlideElement>,
    }
  }
  if (it.kind === 'text') {
    return {
      type: 'text',
      overrides: {
        x: r2(it.x), y: r2(it.y), w: Math.max(40, r2(it.w)), h: Math.max(24, r2(it.h)),
        text: it.text || '文字', fontSize: Math.max(14, Math.round(Math.min(it.h, it.w) * 0.7)),
        color: it.stroke, align: 'center', valign: 'middle',
      } as Partial<SlideElement>,
    }
  }
  // poly / polygon / triangle / ngon / star / pen → pen 元素（点转"相对框" ✓ 与 PenElement 同口径 ✓）
  const ps = pointsOf(it).map((p) => ({ x: r2(p.x - b.x), y: r2(p.y - b.y) }))
  return {
    type: 'pen',
    overrides: {
      x: r2(b.x), y: r2(b.y), w: Math.max(4, r2(b.w)), h: Math.max(4, r2(b.h)),
      ...common,
      fill: it.fill && it.fill !== 'none' ? it.fill : undefined,
      closed: !!(it.closed || isPolyKind(it.kind)) || undefined,
      points: ps,
    } as Partial<SlideElement>,
  }
}

const canApply = computed(() => items.value.length > 0)

/* ---------------- 应用：新插 / 整张替换 ✓ ---------------- */
function apply() {
  if (polyPts.value.length >= 2) commitPoly(tool.value === 'polygon')
  const list = items.value
  if (!list.length) { msg.value = '先画点什么再插 ✓'; return }
  if (!store.currentSlide) { msg.value = '当前没有页面'; return }
  const key = editKey.value || 'draw_' + Math.random().toString(36).slice(2, 9)
  const model: SvgDrawing = { key, items: JSON.parse(JSON.stringify(list)) as SvgItemData[] }
  const els = list.map((it) => {
    const e = toElement(it)
    return { type: e.type, overrides: { ...e.overrides, svgDraw: model } as Partial<SlideElement> }
  })
  if (isEdit.value) {
    store.replaceDrawing(key, els)          // 整张一次替换，只留一步撤销 ✓
  } else {
    const ids = store.addElements(els)      // 一次快照 + 一次选中 ✓
    if (ids.length > 1) store.groupSelection()
  }
  emit('close')
}

function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (e.key === 'Escape') {
    if (polyPts.value.length) { polyPts.value = []; polyCur.value = null; msg.value = '这一笔不要了 ✓'; return }
    if (selIds.value.length) { setSel([]); return }
    emit('close'); return
  }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); delSel(); return }
  if (e.key === 'Enter' && polyPts.value.length >= 2) { e.preventDefault(); commitPoly(tool.value === 'polygon'); return }
  const mod = e.ctrlKey || e.metaKey
  const k = e.key.toLowerCase()
  if (mod && k === 'z') { e.preventDefault(); undo(); return }
  if (mod && k === 'c') { e.preventDefault(); copySel(); return }
  if (mod && k === 'x') { e.preventDefault(); cutSel(); return }
  if (mod && k === 'v') { e.preventDefault(); pasteClip(); return }
  if (mod && k === 'd') { e.preventDefault(); duplicateSel(); return }
  if (mod && k === 'a') { e.preventDefault(); selectAll(); return }
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  if (isEdit.value) {
    const els = (store.currentSlide?.elements || []).filter((e) => e.svgDraw && e.svgDraw.key === editKey.value)
    const model = els.find((e) => e.svgDraw && e.svgDraw.items && e.svgDraw.items.length)?.svgDraw
    if (model) {
      items.value = JSON.parse(JSON.stringify(model.items)) as Item[]
      msg.value = '正在改这张图（' + items.value.length + ' 笔）—— 改完点「应用到当前页」✓'
    } else {
      msg.value = '这张图的模型没找到（可能是旧版本插的 ✗）—— 可以把现在这些元素删掉重画'
    }
  } else {
    msg.value = '挑一个工具，在画布上画 ✓（画布就是幻灯片，画在哪就落在哪 ✓；拖出窗口也不会掉 ✓）'
  }
})
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); unbindDrag() })
</script>

<template>
  <Teleport to="body">
    <!-- ⚠ 只认 ✕ / 取消 / Esc 关闭 ✗ —— 原来写 @click.self 是"点弹窗外面任何地方就关"，
         画到一半点到旁边那条缝就把整张图丢了 ✗（题库浮窗 v1502 踩过同一个坑 ✓ 这里照那条纪律改 ✓） -->
    <div class="svgx">
      <div class="svgx__box">
        <header class="svgx__head">
          <span class="svgx__title">{{ isEdit ? 'SVG 编辑器 · 改这张图' : 'SVG 编辑器' }}</span>
          <span class="svgx__sub">画矢量图 → {{ isEdit ? '**整张替换**当前页那一张' : '插进当前页' }}（插进去是**原生矢量元素**，双击还能回来改 ✓）</span>
          <button class="svgx__x" title="关闭 (Esc)" @click="emit('close')"><AppIcon name="close" :size="13" /></button>
        </header>

        <div class="svgx__bar">
          <button
            v-for="t in TOOLS" :key="t.v" class="svgx__tool" :class="{ 'svgx__tool--on': tool === t.v }"
            :title="t.hint" @click="pickTool(t.v)"
          >
            <span class="svgx__ticon"><svg viewBox="0 0 24 24" class="svgx__svg" v-html="(I as Record<string, string>)[t.icon]"></svg></span>{{ t.label }}
          </button>
          <span class="svgx__sep"></span>
          <label class="svgx__lab">线色
            <input :value="shownStroke" type="color" class="svgx__color" @input="applyStroke(($event.target as HTMLInputElement).value)" />
          </label>
          <span class="svgx__swatches">
            <button v-for="c in SWATCHES" :key="c" class="svgx__sw" :class="{ 'svgx__sw--on': shownStroke === c }" :style="{ background: c }" :title="'线色 ' + c" @click="applyStroke(c)" />
          </span>
          <label class="svgx__lab">线宽
            <input :value="shownWidth" type="number" min="1" max="20" class="svgx__num" @change="applyWidth(Number(($event.target as HTMLInputElement).value))" />
          </label>
          <label class="svgx__lab">线型
            <select :value="shownDash" class="svgx__sel" @change="applyDash(($event.target as HTMLSelectElement).value)">
              <option v-for="s in LINE_STYLES" :key="s.v" :value="s.v">{{ s.label }}</option>
            </select>
          </label>
          <span class="svgx__sep"></span>
          <label class="svgx__lab">填充
            <span class="svgx__swatches">
              <button
                v-for="c in FILL_SWATCHES" :key="c" class="svgx__sw" :class="{ 'svgx__sw--on': shownFill === c, 'svgx__sw--none': c === 'none' }"
                :style="c === 'none' ? {} : { background: c }" :title="c === 'none' ? '不填充（只描边 ✓）' : ('填充 ' + c)" @click="applyFill(c)"
              >{{ c === 'none' ? '无' : '' }}</button>
            </span>
          </label>
          <input :value="shownFill === 'none' ? '#ffffff' : shownFill" type="color" class="svgx__color" title="自定义填充色" @input="applyFill(($event.target as HTMLInputElement).value)" />
          <span class="svgx__sep"></span>
          <label v-if="tool === 'arrow' || (sel && sel.kind === 'arrow')" class="svgx__lab">箭头
            <select v-model="arrowHead" class="svgx__sel" @change="sel && sel.kind === 'arrow' && (snapshot(), sel.arrowHead = arrowHead)">
              <option v-for="a in ARROW_HEADS" :key="a.v" :value="a.v">{{ a.label }}</option>
            </select>
          </label>
          <label v-if="tool === 'ngon' || (sel && (sel.kind === 'ngon' || sel.kind === 'star'))" class="svgx__lab">边数
            <input :value="sides" type="number" min="3" max="12" class="svgx__num" @change="applySides(Number(($event.target as HTMLInputElement).value))" />
          </label>
          <label v-if="tool === 'roundrect' || (sel && sel.kind === 'roundrect')" class="svgx__lab">圆角
            <input :value="cornerRadius" type="number" min="0" max="120" class="svgx__num" @change="applyCorner(Number(($event.target as HTMLInputElement).value))" />
          </label>
          <label v-if="tool === 'text' || (sel && sel.kind === 'text')" class="svgx__lab">文字
            <input v-model="textValue" class="svgx__txt" placeholder="图上的字" @input="onTextInput" />
          </label>
          <!-- 【v1508】数学图形里的**平面图形**：选中即切到"放图形"工具；已选中平面图形时 = 换图形 ✓ -->
          <label class="svgx__lab">平面图形
            <select class="svgx__sel" :value="sel && sel.kind === 'figure' ? sel.figKind : figKind" @change="onFigPick(($event.target as HTMLSelectElement).value)">
              <option v-for="o in PLANE_FIGS" :key="o.v" :value="o.v">{{ o.label }}</option>
            </select>
          </label>
          <button
            v-if="sel && sel.kind === 'figure'" class="svgx__mini" title="把选中的这张平面图形换成下拉里选的那种（尺寸按新图形的比例走 ✓）"
            @click="changeFigKind(figKind)"
          >⇄ 换成这个</button>
          <span class="svgx__sep"></span>
          <button class="svgx__mini" title="撤销（Ctrl+Z ✓）" @click="undo">撤销</button>
          <button class="svgx__mini" :disabled="!selIds.length" title="复制选中的（Ctrl+C ✓）—— 粘贴时往后错开一点 ✓" @click="copySel">复制</button>
          <button class="svgx__mini" :disabled="!selIds.length" title="剪切选中的（Ctrl+X ✓）" @click="cutSel">剪切</button>
          <button class="svgx__mini" :disabled="!clip.length" title="粘贴（Ctrl+V ✓）" @click="pasteClip">粘贴</button>
          <button class="svgx__mini" :disabled="!selIds.length" title="原地复制一份（Ctrl+D ✓）" @click="duplicateSel">复制一份</button>
          <button class="svgx__mini" :disabled="!selIds.length" title="删掉选中的（Delete ✓）" @click="delSel">删除</button>
          <button class="svgx__mini" title="清空画布（可撤销 ✓）" @click="clearAll">清空</button>
          <span class="svgx__msg">{{ msg }}</span>
        </div>

        <div class="svgx__stage" :class="{ 'svgx__stage--draw': tool !== 'select' }">
          <svg
            ref="canvas" :viewBox="'0 0 ' + W + ' ' + H" class="svgx__canvas"
            @pointerdown="onCanvasDown"
            @dblclick="(polyPts.length >= 2) && commitPoly(tool === 'polygon')"
          >
            <defs>
              <pattern id="svgx-grid" :width="GRID" :height="GRID" patternUnits="userSpaceOnUse">
                <path :d="'M' + GRID + ' 0H0V' + GRID" fill="none" stroke="#e8e6f2" stroke-width="1" />
              </pattern>
              <marker id="svgx-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" :fill="stroke" />
              </marker>
            </defs>
            <rect :width="W" :height="H" fill="#fff" />
            <rect :width="W" :height="H" fill="url(#svgx-grid)" />

            <g v-for="it in items" :key="it.id">
              <rect v-if="it.kind === 'rect' || it.kind === 'roundrect'" :x="it.x" :y="it.y" :width="it.w" :height="it.h" :rx="it.kind === 'roundrect' ? (it.cornerRadius ?? 18) : 0" :fill="it.fill === 'none' ? 'transparent' : it.fill" :stroke="it.stroke" :stroke-width="it.strokeWidth" :stroke-dasharray="dashOf(it)" @pointerdown="onItemDown($event, it)" @dblclick="onItemDbl($event, it)" />
              <ellipse v-else-if="it.kind === 'ellipse'" :cx="it.x + it.w / 2" :cy="it.y + it.h / 2" :rx="it.w / 2" :ry="it.h / 2" :fill="it.fill === 'none' ? 'transparent' : it.fill" :stroke="it.stroke" :stroke-width="it.strokeWidth" :stroke-dasharray="dashOf(it)" @pointerdown="onItemDown($event, it)" />
              <line v-else-if="it.kind === 'line' || it.kind === 'arrow'" :x1="lineEnds(it).p0.x" :y1="lineEnds(it).p0.y" :x2="lineEnds(it).p1.x" :y2="lineEnds(it).p1.y" :stroke="it.stroke" :stroke-width="it.strokeWidth" :stroke-dasharray="dashOf(it)" stroke-linecap="round" :marker-end="it.kind === 'arrow' ? 'url(#svgx-arrow)' : undefined" :marker-start="it.kind === 'arrow' && it.arrowHead === 'double' ? 'url(#svgx-arrow)' : undefined" @pointerdown="onItemDown($event, it)" />
              <!-- 【v1508】平面图形：用 app 自己的渲染（与画布 / 导出同一份 ✓） -->
              <svg
                v-else-if="it.kind === 'figure'" :x="it.x" :y="it.y" :width="it.w" :height="it.h"
                class="svgx__fig" v-html="figureHtml(it)" @pointerdown="onItemDown($event, it)"
              ></svg>
              <text v-else-if="it.kind === 'text'" :x="it.x + it.w / 2" :y="it.y + it.h / 2" :fill="it.stroke" :font-size="Math.max(14, Math.round(Math.min(it.h, it.w) * 0.7))" text-anchor="middle" dominant-baseline="middle" @pointerdown="onItemDown($event, it)" @dblclick="onItemDbl($event, it)">{{ it.text }}</text>
              <polygon v-else-if="it.closed || isPolyKind(it.kind)" :points="pointsStr(it)" :fill="it.fill === 'none' ? 'transparent' : it.fill" :stroke="it.stroke" :stroke-width="it.strokeWidth" :stroke-dasharray="dashOf(it)" stroke-linejoin="round" @pointerdown="onItemDown($event, it)" />
              <polyline v-else :points="pointsStr(it)" :fill="it.fill === 'none' ? 'none' : it.fill" :stroke="it.stroke" :stroke-width="it.strokeWidth" :stroke-dasharray="dashOf(it)" stroke-linecap="round" stroke-linejoin="round" @pointerdown="onItemDown($event, it)" />
              <template v-if="isSel(it.id)">
                <rect :x="boxOf(it).x - 6" :y="boxOf(it).y - 6" :width="boxOf(it).w + 12" :height="boxOf(it).h + 12" fill="none" stroke="#534AB7" stroke-width="2" stroke-dasharray="8 6" pointer-events="none" />
                <!-- 缩放手柄只在**单选**时给（多选时各自挪动 / 改样式 ✓） -->
                <rect v-if="sel && sel.id === it.id" :x="boxOf(it).x + boxOf(it).w - 3" :y="boxOf(it).y + boxOf(it).h - 3" width="20" height="20" fill="#fff" stroke="#534AB7" stroke-width="3" class="svgx__handle" @pointerdown="onHandleDown($event, it)" />
                <!-- 【v1508】顶点模式：拖顶点改形状 / 双击顶点删 / 双击边加点 ✓（与画布上的顶点编辑同一套手感 ✓） -->
                <template v-if="sel && sel.id === it.id && canEditVertices(it)">
                  <polyline :points="verticesOf(it).map((q) => q.x + ',' + q.y).join(' ')" fill="none" stroke="transparent" stroke-width="18" class="svgx__edgehit" @dblclick.stop="insertVertexAt(it, ptOfEvent($event))" />
                  <circle
                    v-for="(q, vi) in verticesOf(it)" :key="'v' + vi" :cx="q.x" :cy="q.y" r="9"
                    class="svgx__vtx" @pointerdown="onVertexDown($event, it, vi)" @dblclick.stop="deleteVertex(it, vi)"
                  />
                </template>
              </template>
            </g>

            <!-- 正在拖的那一笔 ✓ -->
            <g v-if="draft" pointer-events="none">
              <rect v-if="draft.kind === 'rect' || draft.kind === 'roundrect'" :x="draft.x" :y="draft.y" :width="draft.w" :height="draft.h" :rx="draft.kind === 'roundrect' ? (draft.cornerRadius ?? 18) : 0" :fill="draft.fill === 'none' ? 'transparent' : draft.fill" :stroke="draft.stroke" :stroke-width="draft.strokeWidth" />
              <ellipse v-else-if="draft.kind === 'ellipse'" :cx="draft.x + draft.w / 2" :cy="draft.y + draft.h / 2" :rx="draft.w / 2" :ry="draft.h / 2" :fill="draft.fill === 'none' ? 'transparent' : draft.fill" :stroke="draft.stroke" :stroke-width="draft.strokeWidth" />
              <line v-else-if="draft.kind === 'line' || draft.kind === 'arrow'" :x1="(draft.a as Pt).x" :y1="(draft.a as Pt).y" :x2="(draft.b as Pt).x" :y2="(draft.b as Pt).y" :stroke="draft.stroke" :stroke-width="draft.strokeWidth" stroke-linecap="round" :marker-end="draft.kind === 'arrow' ? 'url(#svgx-arrow)' : undefined" />
              <polygon v-else-if="isPolyKind(draft.kind)" :points="pointsStr(draft)" :fill="draft.fill === 'none' ? 'transparent' : draft.fill" :stroke="draft.stroke" :stroke-width="draft.strokeWidth" />
              <!-- 手绘 draft.points 是**绝对坐标** ✓（别再 + draft.x，加了就整体偏移 ✗） -->
              <polyline v-else :points="(draft.points || []).map((p) => p.x + ',' + p.y).join(' ')" fill="none" :stroke="draft.stroke" :stroke-width="draft.strokeWidth" stroke-linecap="round" stroke-linejoin="round" />
            </g>
            <!-- 折线 / 多边形正在点的那一笔 ✓ -->
            <g v-if="polyPts.length" pointer-events="none">
              <polyline :points="polyPts.map((p) => p.x + ',' + p.y).join(' ') + (polyCur ? ' ' + polyCur.x + ',' + polyCur.y : '')" :fill="tool === 'polygon' && fill !== 'none' ? fill : 'none'" :stroke="stroke" :stroke-width="strokeWidth" stroke-linecap="round" stroke-linejoin="round" />
              <circle v-for="(p, i) in polyPts" :key="i" :cx="p.x" :cy="p.y" r="6" :fill="i === 0 ? '#534AB7' : '#fff'" stroke="#534AB7" stroke-width="2" />
            </g>
          </svg>
        </div>

        <footer class="svgx__foot">
          <span class="svgx__hint">{{ selIds.length
            ? '选中了：拖动挪位置、拉右下角缩放；拖小圆点改形状（平行四边形/正多边形会**保持形状** ✓）、双击顶点删、双击边上加点；样式控件改的就是选中的这些 ✓；Ctrl+C/X/V/D、Delete ✓'
            : (TOOLS.find((t) => t.v === tool) || TOOLS[0]).hint }}</span>
          <span v-if="selIds.length > 1" class="svgx__n">已选 {{ selIds.length }} 笔（Shift 点选加减 ✓ 可一起挪 / 改样式 / 复制）</span>
          <span v-else-if="sel" class="svgx__n">已选：{{ sel.kind === 'figure' ? figLabel(sel.figKind) : (KIND_LABEL[sel.kind] || sel.kind) }}</span>
          <!-- 【v1508】数值微调（选中后可直接改 ✓） -->
          <span v-if="sel" class="svgx__nums">
            <label>X<input type="number" :value="Math.round(boxOf(sel).x)" @change="setNum('x', ($event.target as HTMLInputElement).value)" /></label>
            <label>Y<input type="number" :value="Math.round(boxOf(sel).y)" @change="setNum('y', ($event.target as HTMLInputElement).value)" /></label>
            <label>宽<input type="number" :value="Math.round(boxOf(sel).w)" @change="setNum('w', ($event.target as HTMLInputElement).value)" /></label>
            <label>高<input type="number" :value="Math.round(boxOf(sel).h)" @change="setNum('h', ($event.target as HTMLInputElement).value)" /></label>
          </span>
          <span class="svgx__n">已画 {{ items.length }} 笔</span>
          <button class="svgx__btn" @click="emit('close')">取消</button>
          <button class="svgx__btn svgx__btn--main" :disabled="!canApply" :title="isEdit ? '把改动应用回那一张（整张替换，只留一步撤销 ✓）' : '把画好的插到当前页（多笔自动打成一个组合 ✓）'" @click="apply">
            {{ isEdit ? '应用到当前页' : '插入到当前页' }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.svgx { position: fixed; inset: 0; z-index: 2400; background: rgba(20, 24, 34, 0.45); display: flex; align-items: center; justify-content: center; }
.svgx__box { width: min(1280px, 97vw); max-height: 95vh; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); display: flex; flex-direction: column; overflow: hidden; }
.svgx__head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.svgx__title { font-size: 15px; font-weight: 700; }
.svgx__sub { font-size: 12px; color: var(--muted); }
.svgx__x { margin-left: auto; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--gray-600); }
.svgx__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 16px; border-bottom: 1px solid var(--border); font-size: 12px; }
.svgx__tool { display: inline-flex; align-items: center; gap: 5px; height: 29px; padding: 0 10px; border: 1px solid var(--border); border-radius: 6px; background: #fff; color: var(--text); font-size: 13px; cursor: pointer; }
.svgx__tool--on { background: var(--brand-600, #534AB7); border-color: var(--brand-600, #534AB7); color: #fff; }
.svgx__ticon { display: inline-flex; width: 15px; height: 15px; }
.svgx__svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
.svgx__sep { width: 1px; height: 22px; background: var(--border-strong, #d6d3e4); margin: 0 6px; flex: none; }
.svgx__lab { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); }
.svgx__color { width: 30px; height: 24px; padding: 0; border: 1px solid var(--border); border-radius: 6px; background: #fff; }
.svgx__swatches { display: inline-flex; gap: 3px; }
.svgx__sw { width: 20px; height: 20px; border: 1px solid var(--border-strong); border-radius: 5px; cursor: pointer; font-size: 10px; line-height: 1; color: var(--muted); background: #fff; }
.svgx__sw--on { outline: 2px solid var(--brand-600, #534AB7); outline-offset: 1px; }
.svgx__sw--none { background: repeating-linear-gradient(45deg, #fff 0 4px, #eceaf5 4px 8px); }
.svgx__num { width: 52px; height: 24px; padding: 0 4px; border: 1px solid var(--border); border-radius: 6px; font-size: 12px; }
.svgx__sel { height: 24px; border: 1px solid var(--border); border-radius: 6px; font-size: 12px; background: #fff; color: var(--text); }
.svgx__txt { width: 120px; height: 24px; padding: 0 6px; border: 1px solid var(--border); border-radius: 6px; font-size: 12px; }
.svgx__mini { height: 24px; padding: 0 8px; border: 1px solid var(--border); border-radius: 6px; background: #fff; color: var(--text); font-size: 12px; cursor: pointer; }
.svgx__msg { color: var(--brand-600, #534AB7); font-size: 12px; }
.svgx__stage { padding: 12px 16px; background: var(--panel-2, #faf9f6); overflow: auto; }
.svgx__stage--draw { cursor: crosshair; }
.svgx__canvas { display: block; width: 100%; aspect-ratio: 16 / 9; background: #fff; border: 1px solid var(--border); border-radius: 8px; touch-action: none; }
.svgx__handle { cursor: nwse-resize; }
/* 【v1508】顶点模式 + 平面图形 + 数值微调 */
.svgx__vtx { fill: #fff; stroke: #534AB7; stroke-width: 3; cursor: move; }
.svgx__vtx:hover { fill: #ede9fb; r: 11; }
.svgx__edgehit { cursor: copy; }
.svgx__fig { overflow: visible; }
.svgx__nums { display: inline-flex; align-items: center; gap: 6px; }
.svgx__nums label { display: inline-flex; align-items: center; gap: 3px; color: var(--muted); font-size: 11.5px; }
.svgx__nums input { width: 58px; height: 24px; padding: 0 4px; border: 1px solid var(--border); border-radius: 6px; font-size: 12px; }
.svgx__foot { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-top: 1px solid var(--border); }
.svgx__hint { font-size: 12px; color: var(--muted); }
.svgx__n { margin-left: auto; font-size: 12px; color: var(--muted); }
.svgx__n + .svgx__n { margin-left: 8px; }
.svgx__btn { height: 28px; padding: 0 12px; border: 1px solid var(--border); border-radius: 6px; background: #fff; color: var(--text); font-size: 12.5px; cursor: pointer; }
.svgx__btn--main { background: var(--brand-600, #534AB7); border-color: var(--brand-600, #534AB7); color: #fff; }
.svgx__btn:disabled { opacity: .6; cursor: default; }
</style>
