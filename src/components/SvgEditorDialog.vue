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
import { LINE_STYLES, ARROW_HEADS, lineDashCss } from '@/types'
import type { SlideElement, SvgItemData, SvgItemKind, SvgDrawing } from '@/types'
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
  line: '直线', arrow: '箭头', poly: '折线', polygon: '多边形', pen: '手绘', text: '文字',
}

const editKey = ref(svgEditorEditKey.value)
const isEdit = computed(() => !!editKey.value)
const tool = ref<Tool>('select')
const items = ref<Item[]>([])
const selId = ref('')
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
  selId.value = ''
  msg.value = '已撤销一步 ✓'
}

const sel = computed(() => items.value.find((x) => x.id === selId.value) || null)
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
  if (kind === 'ngon' || kind === 'star') {
    const N = Math.max(3, Math.min(12, Math.round(n)))
    if (kind === 'ngon') {
      for (let i = 0; i < N; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / N
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
function isPolyKind(k: SvgItemKind) { return k === 'polygon' || k === 'triangle' || k === 'ngon' || k === 'star' }
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
  if (tool.value === 'select') { selId.value = ''; return }
  if (tool.value === 'text') {
    snapshot()
    const it: Item = {
      id: newId(), kind: 'text', x: p.x, y: p.y, w: Math.max(60, textValue.value.length * 42), h: 60,
      text: textValue.value || '文字', stroke: stroke.value, strokeWidth: strokeWidth.value, fill: 'none',
    }
    items.value = [...items.value, it]
    selId.value = it.id
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
  draft.value = base
  drag = { mode: 'draw', start: p }
  bindDrag()
}

function handleMove(e: PointerEvent) {
  const p = pt(e)
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
    const target = items.value.find((x) => x.id === g.id)
    if (!target) return
    const dx = p.x - g.last.x
    const dy = p.y - g.last.y
    if (!g.snapped && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)) { snapshot(); g.snapped = true }
    translate(target, dx, dy)
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
  unbindDrag()
}

function commitDraft() {
  const d = draft.value
  draft.value = null
  if (!d) return
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
  selId.value = d.id
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
  selId.value = it.id
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
  selId.value = it.id
  if (it.kind === 'text') textValue.value = it.text || ''
  drag = { mode: 'move', id: it.id, last: pt(e) }
  bindDrag()
}
function onHandleDown(e: PointerEvent, it: Item) {
  if (tool.value !== 'select') return
  e.stopPropagation()
  selId.value = it.id
  snapshot()
  drag = { mode: 'scale', id: it.id, box: boxOf(it), orig: JSON.parse(JSON.stringify(it)) as Item }
  bindDrag()
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
  if (!selId.value) { msg.value = '先点一下要删的那一笔 ✓'; return }
  snapshot()
  items.value = items.value.filter((x) => x.id !== selId.value)
  selId.value = ''
}
function clearAll() {
  if (!items.value.length) return
  snapshot()
  items.value = []
  selId.value = ''
  polyPts.value = []
  msg.value = '画布已清空（可撤销 ✓）'
}

/* ---------------- 落盘：一笔 → 一个原生矢量元素 ✓ ---------------- */
function toElement(it: Item): { type: 'shape' | 'line' | 'arrow' | 'pen' | 'text'; overrides: Partial<SlideElement> } {
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
    if (selId.value) { selId.value = ''; return }
    emit('close'); return
  }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); delSel(); return }
  if (e.key === 'Enter' && polyPts.value.length >= 2) { e.preventDefault(); commitPoly(tool.value === 'polygon'); return }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo() }
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
    <div class="svgx" @click.self="emit('close')">
      <div class="svgx__box">
        <header class="svgx__head">
          <span class="svgx__title">{{ isEdit ? 'SVG 编辑器 · 改这张图' : 'SVG 编辑器' }}</span>
          <span class="svgx__sub">画矢量图 → {{ isEdit ? '**整张替换**当前页那一张' : '插进当前页' }}（插进去是**原生矢量元素**，双击还能回来改 ✓）</span>
          <button class="svgx__x" title="关闭 (Esc)" @click="emit('close')"><AppIcon name="close" :size="13" /></button>
        </header>

        <div class="svgx__bar">
          <button
            v-for="t in TOOLS" :key="t.v" class="svgx__tool" :class="{ 'svgx__tool--on': tool === t.v }"
            :title="t.hint" @click="tool = t.v; polyPts = []"
          >
            <span class="svgx__ticon"><svg viewBox="0 0 24 24" class="svgx__svg" v-html="(I as Record<string, string>)[t.icon]"></svg></span>{{ t.label }}
          </button>
          <span class="svgx__sep"></span>
          <label class="svgx__lab">线色
            <input v-model="stroke" type="color" class="svgx__color" />
          </label>
          <span class="svgx__swatches">
            <button v-for="c in SWATCHES" :key="c" class="svgx__sw" :style="{ background: c }" :title="'线色 ' + c" @click="stroke = c" />
          </span>
          <label class="svgx__lab">线宽
            <input v-model.number="strokeWidth" type="number" min="1" max="20" class="svgx__num" />
          </label>
          <label class="svgx__lab">线型
            <select v-model="dash" class="svgx__sel">
              <option v-for="s in LINE_STYLES" :key="s.v" :value="s.v">{{ s.label }}</option>
            </select>
          </label>
          <span class="svgx__sep"></span>
          <label class="svgx__lab">填充
            <span class="svgx__swatches">
              <button
                v-for="c in FILL_SWATCHES" :key="c" class="svgx__sw" :class="{ 'svgx__sw--on': fill === c, 'svgx__sw--none': c === 'none' }"
                :style="c === 'none' ? {} : { background: c }" :title="c === 'none' ? '不填充（只描边 ✓）' : ('填充 ' + c)" @click="fill = c"
              >{{ c === 'none' ? '无' : '' }}</button>
            </span>
          </label>
          <input v-model="fill" type="color" class="svgx__color" title="自定义填充色" />
          <span class="svgx__sep"></span>
          <label v-if="tool === 'arrow' || (sel && sel.kind === 'arrow')" class="svgx__lab">箭头
            <select v-model="arrowHead" class="svgx__sel" @change="sel && sel.kind === 'arrow' && (sel.arrowHead = arrowHead)">
              <option v-for="a in ARROW_HEADS" :key="a.v" :value="a.v">{{ a.label }}</option>
            </select>
          </label>
          <label v-if="tool === 'ngon' || (sel && (sel.kind === 'ngon' || sel.kind === 'star'))" class="svgx__lab">边数
            <input v-model.number="sides" type="number" min="3" max="12" class="svgx__num" />
          </label>
          <label v-if="tool === 'roundrect' || (sel && sel.kind === 'roundrect')" class="svgx__lab">圆角
            <input v-model.number="cornerRadius" type="number" min="0" max="120" class="svgx__num" />
          </label>
          <label v-if="tool === 'text' || (sel && sel.kind === 'text')" class="svgx__lab">文字
            <input v-model="textValue" class="svgx__txt" placeholder="图上的字" @input="onTextInput" />
          </label>
          <span class="svgx__sep"></span>
          <button class="svgx__mini" title="撤销（Ctrl+Z ✓）" @click="undo">撤销</button>
          <button class="svgx__mini" title="删掉选中的那一笔（Delete ✓）" @click="delSel">删除</button>
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
              <text v-else-if="it.kind === 'text'" :x="it.x + it.w / 2" :y="it.y + it.h / 2" :fill="it.stroke" :font-size="Math.max(14, Math.round(Math.min(it.h, it.w) * 0.7))" text-anchor="middle" dominant-baseline="middle" @pointerdown="onItemDown($event, it)" @dblclick="onItemDbl($event, it)">{{ it.text }}</text>
              <polygon v-else-if="it.closed || (it.kind === 'polygon' || it.kind === 'triangle' || it.kind === 'ngon' || it.kind === 'star')" :points="pointsStr(it)" :fill="it.fill === 'none' ? 'transparent' : it.fill" :stroke="it.stroke" :stroke-width="it.strokeWidth" :stroke-dasharray="dashOf(it)" stroke-linejoin="round" @pointerdown="onItemDown($event, it)" />
              <polyline v-else :points="pointsStr(it)" :fill="it.fill === 'none' ? 'none' : it.fill" :stroke="it.stroke" :stroke-width="it.strokeWidth" :stroke-dasharray="dashOf(it)" stroke-linecap="round" stroke-linejoin="round" @pointerdown="onItemDown($event, it)" />
              <template v-if="it.id === selId">
                <rect :x="boxOf(it).x - 6" :y="boxOf(it).y - 6" :width="boxOf(it).w + 12" :height="boxOf(it).h + 12" fill="none" stroke="#534AB7" stroke-width="2" stroke-dasharray="8 6" pointer-events="none" />
                <rect :x="boxOf(it).x + boxOf(it).w - 3" :y="boxOf(it).y + boxOf(it).h - 3" width="20" height="20" fill="#fff" stroke="#534AB7" stroke-width="3" class="svgx__handle" @pointerdown="onHandleDown($event, it)" />
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
          <span class="svgx__hint">{{ (TOOLS.find((t) => t.v === tool) || TOOLS[0]).hint }}</span>
          <span v-if="sel" class="svgx__n">已选：{{ KIND_LABEL[sel.kind] || sel.kind }} {{ Math.round(boxOf(sel).w) }}×{{ Math.round(boxOf(sel).h) }}</span>
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
.svgx__foot { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-top: 1px solid var(--border); }
.svgx__hint { font-size: 12px; color: var(--muted); }
.svgx__n { margin-left: auto; font-size: 12px; color: var(--muted); }
.svgx__n + .svgx__n { margin-left: 8px; }
.svgx__btn { height: 28px; padding: 0 12px; border: 1px solid var(--border); border-radius: 6px; background: #fff; color: var(--text); font-size: 12.5px; cursor: pointer; }
.svgx__btn--main { background: var(--brand-600, #534AB7); border-color: var(--brand-600, #534AB7); color: #fff; }
.svgx__btn:disabled { opacity: .6; cursor: default; }
</style>
