<script setup lang="ts">
/**
 * 【绘制/形状 → SVG 编辑器】—— 一个**简单的矢量绘图**弹窗 ✓
 *
 * 定位：给老师补一套"画个示意图"的手：直线 / 箭头 / 矩形 / 圆 / 折线 / 手绘；
 * 选中可拖、可拉角缩放、可删、可改线色/填充/线宽、可撤销；画完**插进当前页** ✓。
 *
 * 三条设计（都是为了让结果"以后还能改"）：
 *  ① 画布 viewBox 就是 **1920×1080**（与幻灯片同尺寸 ✓）—— 画在哪就落在哪，所见即所得 ✓；
 *  ② 插进去的是**原生矢量元素**（shape / line / arrow / pen ✓）而**不是一张图** ✗ ——
 *     插完还能用属性面板改颜色、双击拖端点、跟着分组一起缩放 ✓（导出 PDF 也是矢量 ✓）；
 *  ③ 多笔自动**打成一个组合** ✓（挪一下就是整张图挪一下 ✓，要拆开点「解组」✓）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { ICONS as I } from '@/ui/icons'
import { useDeckStore } from '@/stores/deck'
import type { SlideElement } from '@/types'

const emit = defineEmits<{ (e: 'close'): void }>()
const store = useDeckStore()

/** 画布逻辑尺寸 = 幻灯片尺寸 ✓（所见即所得） */
const W = 1920
const H = 1080

type Tool = 'select' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'poly' | 'pen'
type Kind = 'line' | 'arrow' | 'rect' | 'ellipse' | 'poly' | 'pen'

interface Pt { x: number; y: number }
interface Item {
  id: string
  kind: Kind
  /** rect / ellipse 用 */
  x: number
  y: number
  w: number
  h: number
  /** line / arrow 用（绝对坐标 ✓ 拖动最省事） */
  a?: Pt
  b?: Pt
  /** poly / pen 用（相对 x,y 的点序列 ✓ 与 PenElement.points 同口径） */
  points?: Pt[]
  /** 折线是否闭合（闭合就首尾相连 ✓） */
  closed?: boolean
  stroke: string
  strokeWidth: number
  fill: string
}

const TOOLS: { v: Tool; label: string; icon: string; hint: string }[] = [
  { v: 'select', label: '选择', icon: 'draw', hint: '点一下选中，拖动挪位置，拉右下角小方块缩放；Delete 删除 ✓' },
  { v: 'line', label: '直线', icon: 'line', hint: '在画布上按住拖一条直线 ✓' },
  { v: 'arrow', label: '箭头', icon: 'arrow', hint: '在画布上按住拖一个箭头 ✓' },
  { v: 'rect', label: '矩形', icon: 'rect', hint: '按住拖一个矩形 ✓' },
  { v: 'ellipse', label: '圆 / 椭圆', icon: 'ellipse', hint: '按住拖一个椭圆（按住 Shift 是正圆 ✓）' },
  { v: 'poly', label: '折线', icon: 'fig', hint: '一下一下点角点，回到起点（或双击）收尾 ✓' },
  { v: 'pen', label: '手绘', icon: 'pen', hint: '按住随手画 ✓' },
]
const SWATCHES = ['#1a1a1a', '#534AB7', '#d92d20', '#2563eb', '#16a34a', '#d97706', '#64748b', '#ffffff']
/** 选中项在底部显示的名字（别把内部的 kind 直接甩给老师看 ✗） */
const KIND_LABEL: Record<string, string> = { rect: '矩形', ellipse: '圆', line: '直线', arrow: '箭头', poly: '折线', pen: '手绘' }

const tool = ref<Tool>('select')
const items = ref<Item[]>([])
const selId = ref('')
/** 正在拖出来的那一笔（还没落进 items ✓） */
const draft = ref<Item | null>(null)
/** 折线正在点的那一笔 */
const polyPts = ref<Pt[]>([])
const polyCur = ref<Pt | null>(null)
const stroke = ref('#1a1a1a')
const fill = ref('none')
const strokeWidth = ref(3)
const msg = ref('')

let drag:
  | { mode: 'draw'; start: Pt }
  /** snapped：**真的动了**才记撤销（只点一下不该留一步空撤销 ✓） */
  | { mode: 'move'; id: string; last: Pt; snapped?: boolean }
  /** ⚠ 缩放必须拿**起手那一刻的快照**重算 ✗ 否则每动一下都在上一次结果上再缩，几下就缩没了 ✓ */
  | { mode: 'scale'; id: string; box: { x: number; y: number; w: number; h: number }; orig: Item }
  | null = null

/** 撤销栈（**整份快照**，简单可靠 ✓） */
const undoStack = ref<string[]>([])
function snapshot() {
  undoStack.value = [...undoStack.value.slice(-39), JSON.stringify(items.value)]
}
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

function pt(e: PointerEvent | MouseEvent): Pt {
  const r = canvas.value?.getBoundingClientRect()
  if (!r || !r.width || !r.height) return { x: 0, y: 0 }
  return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }
}
const r2 = (n: number) => Math.round(n)

/** 一个元素的外框 —— line / poly / pen 都由**点**算 ✓
 *  ⚠ 口径统一：line/arrow 的 a/b 与 poly/pen 的 points 全是**绝对画布坐标** ✓
 *    （只有落盘成 PenElement 时才转成"相对框"的点 ✓ —— 两处口径混着用必错，踩过 ✓） */
function boxOf(it: Item): { x: number; y: number; w: number; h: number } {
  if (it.kind === 'line' || it.kind === 'arrow') {
    const a = it.a || { x: 0, y: 0 }
    const b = it.b || { x: 0, y: 0 }
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
  }
  if (it.kind === 'poly' || it.kind === 'pen') {
    const ps = it.points || []
    if (!ps.length) return { x: it.x, y: it.y, w: it.w, h: it.h }
    // points 是绝对坐标 ✓（见上面的口径说明）
    const xs = ps.map((p) => p.x)
    const ys = ps.map((p) => p.y)
    const x0 = Math.min(...xs)
    const y0 = Math.min(...ys)
    return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 }
  }
  return { x: it.x, y: it.y, w: it.w, h: it.h }
}

/** 【原封不动】这一笔画到画布上（line/arrow/poly 的点在 items 里存的是**绝对坐标** ✓
 *  只有 pen 的 points 存相对点 ✓ —— 渲染时按各自方式换算） */
function linePts(it: Item): { p0: Pt; p1: Pt } {
  const a = it.a || { x: it.x, y: it.y }
  const b = it.b || { x: it.x + it.w, y: it.y + it.h }
  return { p0: a, p1: b }
}
function polyStr(it: Item, close = false): string {
  const ps = (it.points || []).map((p) => ({ x: p.x, y: p.y }))
  if (!ps.length) return ''
  const all = close && ps.length > 2 ? [...ps, ps[0]] : ps
  return all.map((p) => r2(p.x) + ',' + r2(p.y)).join(' ')
}

/* ---------------- 交互 ---------------- */

function commitDraft() {
  const d = draft.value
  draft.value = null
  if (!d) return
  // 太小的忽略（误点 ✓）
  if (d.kind === 'line' || d.kind === 'arrow') {
    const a = d.a as Pt
    const b = d.b as Pt
    if (Math.hypot(b.x - a.x, b.y - a.y) < 8) return
  } else if (d.kind === 'pen') {
    if ((d.points || []).length < 2) return
  } else if (d.w < 6 && d.h < 6) return
  // 一笔落下前，把框统一按点算一遍（pen / poly 的 x/y/w/h 都从点来 ✓）
  if (d.kind === 'pen') {
    const b = boxOf(d)
    d.x = b.x; d.y = b.y; d.w = b.w; d.h = b.h
  }
  snapshot()
  items.value = [...items.value, d]
  selId.value = d.id
  tool.value = 'select'
}

function onCanvasDown(e: PointerEvent) {
  if (e.button !== 0) return
  const p = pt(e)
  if (tool.value === 'poly') {
    // 回到起点附近 → 收尾（闭合 ✓）
    if (polyPts.value.length >= 3 && Math.hypot(p.x - polyPts.value[0].x, p.y - polyPts.value[0].y) < 16) { commitPoly(true); return }
    polyPts.value = [...polyPts.value, p]
    polyCur.value = p
    return
  }
  if (tool.value === 'select') {
    selId.value = ''
    return
  }
  // 画一笔
  const base: Item = {
    id: 's' + Math.random().toString(36).slice(2, 8), kind: tool.value as Kind,
    x: p.x, y: p.y, w: 0, h: 0, stroke: stroke.value, strokeWidth: strokeWidth.value, fill: fill.value,
  }
  if (tool.value === 'line' || tool.value === 'arrow') { base.a = p; base.b = p } else if (tool.value === 'pen') { base.points = [p] }
  draft.value = base
  drag = { mode: 'draw', start: p }
  try { (e.currentTarget as Element).setPointerCapture(e.pointerId) } catch { /* 忽略 */ }
}

function onCanvasMove(e: PointerEvent) {
  const p = pt(e)
  if (tool.value === 'poly' && polyPts.value.length) { polyCur.value = p; return }
  const d = draft.value
  if (d && drag && drag.mode === 'draw') {
    if (d.kind === 'line' || d.kind === 'arrow') { d.b = e.shiftKey ? { x: p.x, y: drag.start.y } : p }
    else if (d.kind === 'pen') {
      const last = d.points?.[d.points.length - 1]
      // 采点抽稀：离上一个点 4px 以上才记（点太密白占体积 ✓）—— 一律存**绝对坐标** ✓
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
    const d = drag
    const target = items.value.find((x) => x.id === d.id)
    if (target) {
      const dx = p.x - d.last.x
      const dy = p.y - d.last.y
      if (!d.snapped && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)) { snapshot(); d.snapped = true }
      translate(target, dx, dy)
      d.last = p
    }
    return
  }
  if (drag && drag.mode === 'scale') {
    const d = drag
    const idx = items.value.findIndex((x) => x.id === d.id)
    if (idx < 0) return
    const sx = d.box.w > 4 ? Math.max(0.05, (p.x - d.box.x) / d.box.w) : 1
    const sy = d.box.h > 4 ? Math.max(0.05, (p.y - d.box.y) / d.box.h) : 1
    const next = JSON.parse(JSON.stringify(d.orig)) as Item   // 从起手快照重算 ✓
    scaleTo(next, d.box, sx, sy)
    items.value = items.value.map((x, i) => (i === idx ? next : x))
    return
  }
}

function onCanvasUp() {
  if (draft.value) commitDraft()
  drag = null
}

function commitPoly(closed = false) {
  const ps = polyPts.value
  polyPts.value = []
  polyCur.value = null
  if (ps.length < 2) return
  snapshot()
  const xs = ps.map((p) => p.x)
  const ys = ps.map((p) => p.y)
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  const it: Item = {
    id: 's' + Math.random().toString(36).slice(2, 8), kind: 'poly',
    x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0,
    points: ps.map((p) => ({ x: p.x, y: p.y })),      // 绝对坐标 ✓
    closed, stroke: stroke.value, strokeWidth: strokeWidth.value, fill: fill.value,
  }
  items.value = [...items.value, it]
  selId.value = it.id
  tool.value = 'select'
}

function translate(it: Item, dx: number, dy: number) {
  if (it.kind === 'poly' || it.kind === 'pen') {
    it.points = (it.points || []).map((p) => ({ x: p.x + dx, y: p.y + dy }))
    const b = boxOf(it)
    it.x = b.x; it.y = b.y; it.w = b.w; it.h = b.h
    return
  }
  if (it.kind === 'line' || it.kind === 'arrow') {
    it.a = { x: (it.a as Pt).x + dx, y: (it.a as Pt).y + dy }
    it.b = { x: (it.b as Pt).x + dx, y: (it.b as Pt).y + dy }
    const b = boxOf(it)
    it.x = b.x; it.y = b.y; it.w = b.w; it.h = b.h
  } else { it.x += dx; it.y += dy }
}
function scaleTo(it: Item, box: { x: number; y: number; w: number; h: number }, sx: number, sy: number) {
  const f = (p: Pt): Pt => ({ x: box.x + (p.x - box.x) * sx, y: box.y + (p.y - box.y) * sy })
  if (it.kind === 'line' || it.kind === 'arrow') {
    it.a = f(it.a as Pt); it.b = f(it.b as Pt)
  } else if (it.kind === 'poly' || it.kind === 'pen') {
    it.points = (it.points || []).map(f)
  }
  const b = boxOf(it)
  it.x = b.x; it.y = b.y; it.w = b.w; it.h = b.h
}

function onItemDown(e: PointerEvent, it: Item) {
  if (tool.value !== 'select') return
  e.stopPropagation()
  selId.value = it.id
  drag = { mode: 'move', id: it.id, last: pt(e) }   // 撤销在**真的动了**那一刻记 ✓
  try { (e.currentTarget as Element).setPointerCapture(e.pointerId) } catch { /* 忽略 */ }
}

function onHandleDown(e: PointerEvent, it: Item) {
  if (tool.value !== 'select') return
  e.stopPropagation()
  selId.value = it.id
  snapshot()                       // 缩放 = 一步可撤销 ✓
  drag = { mode: 'scale', id: it.id, box: boxOf(it), orig: JSON.parse(JSON.stringify(it)) as Item }
  try { (e.currentTarget as Element).setPointerCapture(e.pointerId) } catch { /* 忽略 */ }
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

/* ---------------- 插入当前页 ---------------- */
/** 一笔 → 一个**原生矢量元素** ✓（shape / line / arrow / pen，与画布上那些是同一批 ✓） */
function toElement(it: Item): { type: 'shape' | 'line' | 'arrow' | 'pen'; overrides: Partial<SlideElement> } {
  const b = boxOf(it)
  const common = { stroke: it.stroke, strokeWidth: it.strokeWidth }
  if (it.kind === 'rect' || it.kind === 'ellipse') {
    return {
      type: 'shape',
      overrides: {
        x: r2(it.x), y: r2(it.y), w: Math.max(4, r2(it.w)), h: Math.max(4, r2(it.h)),
        shape: it.kind, fill: it.fill, stroke: it.stroke, strokeWidth: it.strokeWidth, cornerRadius: 0,
      } as Partial<SlideElement>,
    }
  }
  if (it.kind === 'line' || it.kind === 'arrow') {
    const { p0, p1 } = linePts(it)
    const x = Math.min(p0.x, p1.x)
    const y = Math.min(p0.y, p1.y)
    const w = Math.max(4, Math.abs(p1.x - p0.x))
    const h = Math.max(4, Math.abs(p1.y - p0.y))
    const pts = [(p0.x - x) / w, (p0.y - y) / h, (p1.x - x) / w, (p1.y - y) / h]
    const t = it.kind === 'line' ? 'line' : 'arrow'
    return { type: t, overrides: { x: r2(x), y: r2(y), w: r2(w), h: r2(h), ...common, points: pts } as Partial<SlideElement> }
  }
  // poly / pen → pen 元素（**落盘这一刻**才把绝对点转成"相对框"的点 ✓ 与 PenElement 同口径 ✓）
  const ps = (it.points || []).map((p) => ({ x: p.x - b.x, y: p.y - b.y }))
  if (it.closed && ps.length > 2) ps.push({ ...ps[0] })
  return {
    type: 'pen',
    overrides: {
      x: r2(b.x), y: r2(b.y), w: Math.max(4, r2(b.w)), h: Math.max(4, r2(b.h)),
      ...common, points: ps.map((p) => ({ x: r2(p.x), y: r2(p.y) })),
    } as Partial<SlideElement>,
  }
}

function insert() {
  // 折线还没收尾的先收掉 ✓（免得老师点了插入、手上那笔没了 ✗）
  if (polyPts.value.length >= 2) commitPoly(false)
  const list = items.value
  if (!list.length) { msg.value = '先画点什么再插入 ✓'; return }
  if (!store.currentSlide) { msg.value = '当前没有页面'; return }
  const els = list.map(toElement)
  const ids = store.addElements(els)          // 一次快照 + 一次选中 ✓
  if (ids.length > 1) store.groupSelection()  // 多笔 → 打成一个组合 ✓（挪一下整张图一起动 ✓）
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
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo() }
}
onMounted(() => { window.addEventListener('keydown', onKey); msg.value = '挑一个工具，在画布上画 ✓（画布就是幻灯片，画在哪就落在哪 ✓）' })
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="svgx" @click.self="emit('close')">
      <div class="svgx__box">
        <header class="svgx__head">
          <span class="svgx__title">SVG 编辑器</span>
          <span class="svgx__sub">画简单的矢量图 → 插进当前页（插进去是**原生矢量元素**，还能接着改 ✓）</span>
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
          <label class="svgx__lab">填充
            <input v-model="fill" type="color" class="svgx__color" />
          </label>
          <button class="svgx__mini" :class="{ 'svgx__mini--on': fill === 'none' }" title="不填充（只描边 ✓）" @click="fill = 'none'">填充：无</button>
          <span class="svgx__sep"></span>
          <button class="svgx__mini" title="撤销（Ctrl+Z ✓）" @click="undo">撤销</button>
          <button class="svgx__mini" title="删掉选中的那一笔（Delete ✓）" @click="delSel">删除</button>
          <button class="svgx__mini" title="清空画布（可撤销 ✓）" @click="clearAll">清空</button>
          <span class="svgx__msg">{{ msg }}</span>
        </div>

        <div class="svgx__stage" :class="{ 'svgx__stage--draw': tool !== 'select' }">
          <svg
            ref="canvas" :viewBox="'0 0 ' + W + ' ' + H" class="svgx__canvas"
            @pointerdown="onCanvasDown" @pointermove="onCanvasMove" @pointerup="onCanvasUp" @pointercancel="onCanvasUp"
            @dblclick="polyPts.length >= 2 && commitPoly(false)"
          >
            <defs>
              <pattern id="svgx-grid" width="60" height="60" patternUnits="userSpaceOnUse">
                <path d="M60 0H0V60" fill="none" stroke="#e8e6f2" stroke-width="1" />
              </pattern>
              <marker id="svgx-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" fill="#1a1a1a" />
              </marker>
            </defs>
            <rect :width="W" :height="H" fill="#fff" />
            <rect :width="W" :height="H" fill="url(#svgx-grid)" />

            <!-- 已落下的每一笔 ✓ -->
            <g v-for="it in items" :key="it.id">
              <template v-if="it.kind === 'rect'">
                <rect :x="it.x" :y="it.y" :width="it.w" :height="it.h" :fill="it.fill === 'none' ? 'transparent' : it.fill" :stroke="it.stroke" :stroke-width="it.strokeWidth" @pointerdown="onItemDown($event, it)" />
              </template>
              <template v-else-if="it.kind === 'ellipse'">
                <ellipse :cx="it.x + it.w / 2" :cy="it.y + it.h / 2" :rx="it.w / 2" :ry="it.h / 2" :fill="it.fill === 'none' ? 'transparent' : it.fill" :stroke="it.stroke" :stroke-width="it.strokeWidth" @pointerdown="onItemDown($event, it)" />
              </template>
              <template v-else-if="it.kind === 'line' || it.kind === 'arrow'">
                <line
                  :x1="linePts(it).p0.x" :y1="linePts(it).p0.y" :x2="linePts(it).p1.x" :y2="linePts(it).p1.y"
                  :stroke="it.stroke" :stroke-width="it.strokeWidth" stroke-linecap="round"
                  :marker-end="it.kind === 'arrow' ? 'url(#svgx-arrow)' : undefined"
                  @pointerdown="onItemDown($event, it)"
                />
              </template>
              <template v-else>
                <polyline
                  :points="polyStr(it, it.closed)" :fill="it.fill === 'none' ? 'none' : it.fill"
                  :stroke="it.stroke" :stroke-width="it.strokeWidth" stroke-linecap="round" stroke-linejoin="round"
                  @pointerdown="onItemDown($event, it)"
                />
              </template>
              <!-- 选中框 + 右下角缩放手柄 ✓ -->
              <template v-if="it.id === selId">
                <rect :x="boxOf(it).x - 4" :y="boxOf(it).y - 4" :width="boxOf(it).w + 8" :height="boxOf(it).h + 8" fill="none" stroke="#534AB7" stroke-width="2" stroke-dasharray="8 6" pointer-events="none" />
                <rect
                  :x="boxOf(it).x + boxOf(it).w - 9" :y="boxOf(it).y + boxOf(it).h - 9" width="18" height="18"
                  fill="#fff" stroke="#534AB7" stroke-width="3" class="svgx__handle"
                  @pointerdown="onHandleDown($event, it)"
                />
              </template>
            </g>

            <!-- 正在拖的那一笔 ✓ -->
            <g v-if="draft" pointer-events="none">
              <rect v-if="draft.kind === 'rect'" :x="draft.x" :y="draft.y" :width="draft.w" :height="draft.h" :fill="draft.fill === 'none' ? 'transparent' : draft.fill" :stroke="draft.stroke" :stroke-width="draft.strokeWidth" />
              <ellipse v-else-if="draft.kind === 'ellipse'" :cx="draft.x + draft.w / 2" :cy="draft.y + draft.h / 2" :rx="draft.w / 2" :ry="draft.h / 2" :fill="draft.fill === 'none' ? 'transparent' : draft.fill" :stroke="draft.stroke" :stroke-width="draft.strokeWidth" />
              <line v-else-if="draft.kind === 'line' || draft.kind === 'arrow'" :x1="(draft.a as Pt).x" :y1="(draft.a as Pt).y" :x2="(draft.b as Pt).x" :y2="(draft.b as Pt).y" :stroke="draft.stroke" :stroke-width="draft.strokeWidth" stroke-linecap="round" :marker-end="draft.kind === 'arrow' ? 'url(#svgx-arrow)' : undefined" />
              <!-- ⚠ 手绘的 draft.points 是**绝对坐标** ✓（别再 + draft.x，加了就整体偏移 ✗） -->
              <polyline v-else :points="(draft.points || []).map((p) => p.x + ',' + p.y).join(' ')" fill="none" :stroke="draft.stroke" :stroke-width="draft.strokeWidth" stroke-linecap="round" stroke-linejoin="round" />
            </g>
            <!-- 折线正在点的那一笔 ✓ -->
            <g v-if="polyPts.length" pointer-events="none">
              <polyline :points="polyPts.map((p) => p.x + ',' + p.y).join(' ') + (polyCur ? ' ' + polyCur.x + ',' + polyCur.y : '')" fill="none" :stroke="stroke" :stroke-width="strokeWidth" stroke-linecap="round" stroke-linejoin="round" />
              <circle v-for="(p, i) in polyPts" :key="i" :cx="p.x" :cy="p.y" r="5" :fill="i === 0 ? '#534AB7' : '#fff'" stroke="#534AB7" stroke-width="2" />
            </g>
          </svg>
        </div>

        <footer class="svgx__foot">
          <span class="svgx__hint">{{ (TOOLS.find((t) => t.v === tool) || TOOLS[0]).hint }}</span>
          <span v-if="sel" class="svgx__n">已选：{{ KIND_LABEL[sel.kind] || sel.kind }} {{ Math.round(boxOf(sel).w) }}×{{ Math.round(boxOf(sel).h) }}</span>
          <span class="svgx__n">已画 {{ items.length }} 笔</span>
          <button class="svgx__btn" @click="emit('close')">取消</button>
          <button class="svgx__btn svgx__btn--main" :disabled="!items.length" title="把画好的插到当前页（多笔自动打成一个组合 ✓ 插进去还能改 ✓）" @click="insert">插入到当前页</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.svgx { position: fixed; inset: 0; z-index: 2400; background: rgba(20, 24, 34, 0.45); display: flex; align-items: center; justify-content: center; }
.svgx__box { width: min(1180px, 96vw); max-height: 94vh; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); display: flex; flex-direction: column; overflow: hidden; }
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
.svgx__sw { width: 20px; height: 20px; border: 1px solid var(--border-strong); border-radius: 5px; cursor: pointer; box-shadow: 0 0 0 1px rgba(0,0,0,.04) inset; }
.svgx__sw:hover { transform: scale(1.1); }
.svgx__num { width: 52px; height: 24px; padding: 0 4px; border: 1px solid var(--border); border-radius: 6px; font-size: 12px; }
.svgx__mini { height: 24px; padding: 0 8px; border: 1px solid var(--border); border-radius: 6px; background: #fff; color: var(--text); font-size: 12px; cursor: pointer; }
.svgx__mini--on { background: var(--panel-2, #f4f3ef); font-weight: 700; }
.svgx__msg { color: var(--brand-600, #534AB7); font-size: 12px; }
.svgx__stage { padding: 12px 16px; background: var(--panel-2, #faf9f6); }
.svgx__stage--draw { cursor: crosshair; }
.svgx__canvas { display: block; width: 100%; aspect-ratio: 16 / 9; background: #fff; border: 1px solid var(--border); border-radius: 8px; touch-action: none; }
.svgx__handle { cursor: nwse-resize; }
.svgx__foot { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-top: 1px solid var(--border); }
.svgx__hint { font-size: 12px; color: var(--muted); }
.svgx__n { margin-left: auto; font-size: 11.5px; color: var(--muted); }
.svgx__btn { height: 28px; padding: 0 12px; border: 1px solid var(--border); border-radius: 6px; background: #fff; color: var(--text); font-size: 12.5px; cursor: pointer; }
.svgx__btn--main { background: var(--brand-600, #534AB7); border-color: var(--brand-600, #534AB7); color: #fff; }
.svgx__btn:disabled { opacity: .6; cursor: default; }
</style>
