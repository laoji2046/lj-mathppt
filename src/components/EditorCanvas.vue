<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { fitScale, pan, resetView, zoom, zoomBy } from '@/ui/canvasView'
import { useDeckStore } from '@/stores/deck'
import { useStageScale } from '@/composables/useStageScale'
import { useDragResize, type DragItem, type Handle } from '@/composables/useDragResize'
import type { Guide } from '@/composables/useSnap'
import { useContextMenu } from '@/composables/useContextMenu'
import type { Rect, SlideElement } from '@/types'
import { slideBgCss } from '@/types'
import ElementFrame from './ElementFrame.vue'
import { closeShapeEdit, shapeEdit } from '@/ui/shapeEditor'
import { openTemplateLibrary } from '@/ui/templateLibrary'

const store = useDeckStore()
const { openMenu } = useContextMenu()
defineProps<{ presenting?: boolean }>()

const viewport = ref<HTMLElement | null>(null)
const stage = ref<HTMLElement | null>(null)
const { scale: fitScaleRef } = useStageScale(viewport, store.deck.width, store.deck.height)
// 适屏比例回写到共享状态（底部状态栏要用它算真实百分比）
watch(fitScaleRef, (v) => { fitScale.value = v }, { immediate: true })
/** 真实比例 = 适屏比例 × 用户缩放（zoom / pan 都在 @/ui/canvasView，与状态栏共用同一份） */
const scale = computed(() => fitScaleRef.value * zoom.value)

// ---- 画布平移 ----
const spaceDown = ref(false)
let panOrigin: { x: number; y: number; px: number; py: number } | null = null

// ---- 吸附参考线 ----
const guides = ref<Guide[]>([])

// ---- 框选 ----
const marquee = ref<Rect | null>(null)
let marqueeStart: { x: number; y: number } | null = null

// ---- 绘制工具（线 / 箭头 / 笔）：空白处拖拽生成 ----
interface DrawState {
  tool: 'line' | 'arrow' | 'pen'
  start: { x: number; y: number }
  cur: { x: number; y: number }
  points: { x: number; y: number }[]
}
const draw = ref<DrawState | null>(null)

function startDraw(e: PointerEvent) {
  const tool = store.drawTool
  // poly 由画布上的 poly-overlay 单独处理（点击放角点），不走这里的拖拽态
  if (!tool || tool === 'poly') return
  const p = toStage(e.clientX, e.clientY)
  draw.value = { tool, start: p, cur: p, points: [p] }
  bindDraw()
}
function bindDraw() {
  const onMove = (ev: PointerEvent) => {
    if (!draw.value) return
    const p = toStage(ev.clientX, ev.clientY)
    draw.value.cur = p
    if (draw.value.tool === 'pen') draw.value.points.push(p)
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    commitDraw()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  document.body.classList.add('is-drawing')
}
function commitDraw() {
  const d = draw.value
  draw.value = null
  document.body.classList.remove('is-drawing')
  if (!d) return
  const { tool, start, cur, points } = d
  const x = Math.min(start.x, cur.x)
  const y = Math.min(start.y, cur.y)
  const w = Math.max(16, Math.abs(cur.x - start.x))
  const h = Math.max(16, Math.abs(cur.y - start.y))

  // ⚠ 直线 / 箭头：**只在画布上点一下**（没拖动）时，给一段默认长度的线段 ✓
  //   （用户要求：选中直线后点一下 → 自动画出一条 **20mm** 的线段 ✓ 并默认选中 ✓）
  //   原来点击只会得到 w=16 h=16 的一小点 ✗（commitDraw 用拖拽矩形算尺寸 ✓）。
  //   20mm 的换算见 src/types/index.ts 的 LINE_DEFAULT_W（151px，按 192px/英寸 ✓）。
  //   ⚠ 位置以**点击点为中心** ✓ —— 水平向右展开，视觉上就在你点的地方 ✓。
  const isClick = Math.abs(cur.x - start.x) < 8 && Math.abs(cur.y - start.y) < 8
  if (isClick && (tool === 'line' || tool === 'arrow')) {
    const L = 151
    store.addElement(tool, { x: Math.round(start.x - L / 2), y: Math.round(start.y), w: L, h: 2 } as Partial<SlideElement>)
    store.clearDrawTool()
    return
  }

  if (tool === 'pen') {
    const norm = points.map((p) => ({ x: p.x - x, y: p.y - y }))
    store.addElement('pen', { x, y, w, h, points: norm, strokeWidth: 4 } as Partial<SlideElement>)
  } else {
    store.addElement(tool, { x, y, w, h } as Partial<SlideElement>)
  }
  store.clearDrawTool()
}

const drawRect = computed<{ x: number; y: number; w: number; h: number } | null>(() => {
  if (!draw.value) return null
  const { start, cur } = draw.value
  return {
    x: Math.min(start.x, cur.x),
    y: Math.min(start.y, cur.y),
    w: Math.max(16, Math.abs(cur.x - start.x)),
    h: Math.max(16, Math.abs(cur.y - start.y)),
  }
})
const drawNormPoints = computed(() => {
  if (!draw.value || draw.value.tool !== 'pen') return ''
  const r = drawRect.value!
  return draw.value.points.map((p) => `${p.x - r.x},${p.y - r.y}`).join(' ')
})

// ---- 画多边形（Bento 式：点击放角点，双击 / 点首点闭合） ----
const polyDraw = ref<{ points: { x: number; y: number }[]; cur: { x: number; y: number } | null } | null>(null)
const polyActive = computed(() => store.drawTool === 'poly')
let polyLast = { t: 0, x: 0, y: 0 }

watch(() => store.drawTool, (t) => {
  if (t !== 'poly') cancelPoly()
})
function cancelPoly() {
  if (!polyDraw.value) return
  polyDraw.value = null
  document.body.classList.remove('is-drawing')
}
function closeThreshold() { return 14 / Math.max(1, scale.value) }
function onPolyDown(e: MouseEvent) {
  if (e.button !== 0) return
  e.preventDefault(); e.stopPropagation()
  if (!polyDraw.value) {
    polyDraw.value = { points: [], cur: null }
    document.body.classList.add('is-drawing')
  }
  const d = polyDraw.value
  if (!d) return
  const p = toStage(e.clientX, e.clientY)
  if (e.timeStamp - polyLast.t < 400 && Math.hypot(p.x - polyLast.x, p.y - polyLast.y) < closeThreshold()) {
    polyLast = { t: 0, x: 0, y: 0 }
    commitPoly()
    return
  }
  polyLast = { t: e.timeStamp, x: p.x, y: p.y }
  if (d.points.length >= 3 && Math.hypot(p.x - d.points[0].x, p.y - d.points[0].y) < closeThreshold()) {
    commitPoly()
    return
  }
  d.points.push(p)
  d.cur = p
}
function onPolyMove(e: MouseEvent) {
  if (!polyDraw.value) return
  polyDraw.value.cur = toStage(e.clientX, e.clientY)
}
function onPolyDbl(e: MouseEvent) {
  e.preventDefault(); e.stopPropagation()
  commitPoly()
}
function commitPoly() {
  const d = polyDraw.value
  cancelPoly()
  if (!d || d.points.length < 3) { store.clearDrawTool(); return }
  const xs = d.points.map((p) => p.x)
  const ys = d.points.map((p) => p.y)
  const x0 = Math.min(...xs), y0 = Math.min(...ys)
  const x1 = Math.max(...xs), y1 = Math.max(...ys)
  const w = Math.max(16, x1 - x0), h = Math.max(16, y1 - y0)
  const points = d.points.flatMap((p) => [(p.x - x0) / w, (p.y - y0) / h])
  store.addElement('mathfig', {
    x: x0, y: y0, w, h,
    kind: 'polygon',
    fill: 'transparent',
    stroke: '#1a1a1a',
    strokeWidth: 3,
    points: points as number[],
  } as Partial<SlideElement>)
  store.clearDrawTool()
}
const polyPreviewPoints = computed(() => {
  const d = polyDraw.value
  if (!d) return ''
  const arr = d.points.map((p) => `${p.x},${p.y}`)
  if (d.cur) arr.push(`${d.cur.x},${d.cur.y}`)
  return arr.join(' ')
})

// ---- 拖拽 ----
let dragMode: 'move' | 'resize' = 'move'
let resizeId: string | null = null
/** 按下时元素已在选区中且按了 Ctrl：松手时若没拖动，则切换其选中态 */
let pendingToggle: string | null = null
let grabStart = { x: 0, y: 0 }

const stageSize = computed(() => ({ w: store.deck.width, h: store.deck.height }))

/** 未被选中的元素矩形，作为吸附目标 */
const snapTargets = computed<Rect[]>(() => {
  if (!store.currentSlide) return []
  const picked = new Set(store.selectedIds)
  return store.currentSlide.elements
    .filter((e) => !picked.has(e.id))
    .map((e) => ({ x: e.x, y: e.y, w: e.w, h: e.h }))
})

/** move 时拖整个选区，resize 时只拖被抓的那个元素 */
function currentItems(): DragItem[] {
  if (dragMode === 'resize' && resizeId) {
    const el = store.currentSlide?.elements.find((e) => e.id === resizeId)
    return el ? [{ id: el.id, rect: { x: el.x, y: el.y, w: el.w, h: el.h } }] : []
  }
  return store.selectedElements.map((e) => ({ id: e.id, rect: { x: e.x, y: e.y, w: e.w, h: e.h } }))
}

const { start: startDrag } = useDragResize({
  stage,
  getItems: currentItems,
  getBounds: () => (dragMode === 'resize' && resizeId ? null : store.selectionBounds),
  getTargets: () => snapTargets.value,
  getStageSize: () => stageSize.value,
  getScale: () => scale.value,
  getSnapThreshold: () => 6,
  onCommit: (changes) => store.commitElements(changes),
  /**
   * 缩放时锁比例：**图片锁它自己的原始宽高比**。
   * 这样拖出来的矩形永远等于图片的比例 —— contain 正好铺满，既不留白也不裁剪，
   * 也就是"图片尺寸和拖拽矩形尺寸同步"。按住 Alt 可自由拉伸。
   * 比例直接从渲染出来的 <img> 读（naturalWidth/naturalHeight），不用另存字段，老存档也管用。
   */
  getAspect: () => {
    if (dragMode !== 'resize' || !resizeId) return null
    const el = store.currentSlide?.elements.find((e) => e.id === resizeId)
    if (!el || (el as { type?: string }).type !== 'image') return null
    const img = document.querySelector<HTMLImageElement>('[data-el-id="' + resizeId + '"] img')
    const nw = img?.naturalWidth || 0
    const nh = img?.naturalHeight || 0
    return nw > 0 && nh > 0 ? nw / nh : null
  },
  onGuides: (g) => { guides.value = g },
})

/** 屏幕坐标 → 舞台设计坐标（自动含缩放与平移） */
function toStage(clientX: number, clientY: number) {
  const el = stage.value
  if (!el) return { x: 0, y: 0 }
  const r = el.getBoundingClientRect()
  return { x: (clientX - r.left) / scale.value, y: (clientY - r.top) / scale.value }
}

function onGrab(payload: { ev: PointerEvent; mode: 'move' | 'resize'; handle: Handle }, id: string) {
  if (shapeEdit.value.id && shapeEdit.value.id !== id) closeShapeEdit()
  const ev = payload.ev
  const additive = ev.ctrlKey || ev.metaKey

  // 拖**边**手柄 = 竖直/水平单向拉伸。但图片若是 contain/cover，拉伸的只是框、图片本身没变 ✗，
  // 所以这里顺手切成 fill（拉伸填满），拖的时候就能立刻看到被拉长/压扁。
  // 只动图片元素，且只从"留在框内"的两种切过来。
  if (payload.mode === 'resize' && ['n', 's', 'e', 'w'].includes(payload.handle)) {
    const el = store.currentSlide?.elements.find((e) => e.id === id)
    const img = el as { type?: string; fit?: string } | undefined
    if (img?.type === 'image' && img.fit !== 'fill') {
      store.updateElement(id, { fit: 'fill' } as Partial<SlideElement>)
    }
  }

  if (payload.mode === 'move') {
    if (!store.isSelected(id)) {
      store.selectElement(id, additive)
    } else if (additive) {
      pendingToggle = id
    }
  } else {
    // 缩放时确保操作对象是被选中的
    if (!store.isSelected(id)) store.selectElement(id, false)
    resizeId = id
  }

  dragMode = payload.mode
  grabStart = { x: ev.clientX, y: ev.clientY }
  startDrag(ev, payload.mode, payload.handle)

  // 若按下后几乎没有移动，则视为「点击」，此时处理 Ctrl 反选
  const onUp = (e: PointerEvent) => {
    window.removeEventListener('pointerup', onUp)
    const moved = Math.abs(e.clientX - grabStart.x) + Math.abs(e.clientY - grabStart.y)
    if (moved < 3 && pendingToggle) {
      store.selectElement(pendingToggle, true)
    }
    if (moved < 3 && payload.mode === 'resize') resizeId = null
    pendingToggle = null
  }
  window.addEventListener('pointerup', onUp)
}

// ---- 画布背景：平移 / 框选 ----
function onCanvasCtx(e: MouseEvent) {
  const t = e.target as HTMLElement
  const isBg = t === viewport.value || t === stage.value
  if (!isBg) return
  e.preventDefault()
  const sel = store.selectionCount > 0
  openMenu(e.clientX, e.clientY, [
    { label: '复制', onClick: () => store.copyElements(), disabled: !sel },
    { label: '剪切', onClick: () => store.cutElements(), disabled: !sel },
    { label: '粘贴', onClick: () => store.pasteElements(), disabled: !store.canPaste },
    { label: '删除', onClick: () => store.removeSelected(), danger: true, disabled: !sel },
    { label: '全选', onClick: () => store.setSelection((store.currentSlide?.elements ?? []).map((el) => el.id)) },
    { label: '取消选择', onClick: () => store.clearSelection() },
    { label: '添加新页面', onClick: () => store.addSlide() },
  ])
}

function onViewportDown(e: PointerEvent) {
  const isBg = e.target === viewport.value || e.target === stage.value
  if (!isBg) return

  // 绘制工具激活：空白处按下即开始绘制
  if (store.drawTool) {
    if (e.button !== 0) return
    e.preventDefault()
    if (store.drawTool === 'poly') return // 多边形由 poly-overlay 处理（画布外点击忽略）
    startDraw(e)
    return
  }

  if (e.button === 1 || spaceDown.value) {
    // 中键或按住空格 → 平移
    panOrigin = { x: e.clientX, y: e.clientY, px: pan.value.x, py: pan.value.y }
    e.preventDefault()
    bindPan()
    return
  }
  if (e.button !== 0) return

  // 左键点空白 → 清空选择并开始框选
  store.clearSelection()
  closeShapeEdit()
  marqueeStart = toStage(e.clientX, e.clientY)
  marquee.value = { x: marqueeStart.x, y: marqueeStart.y, w: 0, h: 0 }
  bindMarquee()
}

function bindPan() {
  const onMove = (ev: PointerEvent) => {
    if (!panOrigin) return
    pan.value = {
      x: panOrigin.px + (ev.clientX - panOrigin.x),
      y: panOrigin.py + (ev.clientY - panOrigin.y),
    }
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    panOrigin = null
    document.body.classList.remove('is-panning')
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  document.body.classList.add('is-panning')
}

function bindMarquee() {
  const onMove = (ev: PointerEvent) => {
    if (!marqueeStart) return
    const p = toStage(ev.clientX, ev.clientY)
    marquee.value = {
      x: Math.min(marqueeStart.x, p.x),
      y: Math.min(marqueeStart.y, p.y),
      w: Math.abs(p.x - marqueeStart.x),
      h: Math.abs(p.y - marqueeStart.y),
    }
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    const m = marquee.value
    if (m && (m.w > 3 || m.h > 3) && store.currentSlide) {
      const hits = store.currentSlide.elements
        .filter((e) => e.x < m.x + m.w && e.x + e.w > m.x && e.y < m.y + m.h && e.y + e.h > m.y)
        .map((e) => e.id)
      store.setSelection(hits)
    }
    marquee.value = null
    marqueeStart = null
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

/** Ctrl/⌘ + 滚轮缩放。舞台是 transform-origin:center + 视口 flex 居中，绕中心缩放不用调平移 */
function onWheel(e: WheelEvent) {
  if (!e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12)
}

// ---- 空格键平移 ----
function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeShapeEdit()
  // 绘制工具激活时，Esc 取消并退出
  if (e.key === 'Escape' && (store.drawTool || draw.value || polyDraw.value)) {
    store.clearDrawTool()
    draw.value = null
    cancelPoly()
    document.body.classList.remove('is-drawing')
    return
  }
  if (e.code === 'Space' && !spaceDown.value) {
    const t = e.target as HTMLElement | null
    if (t?.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t?.tagName ?? '')) return
    spaceDown.value = true
    e.preventDefault()
  }
}
function onKeyUp(e: KeyboardEvent) {
  if (e.code === 'Space') spaceDown.value = false
}
onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
})

const stageStyle = computed(() => ({
  width: `${store.deck.width}px`,
  height: `${store.deck.height}px`,
  transform: `translate(${pan.value.x}px, ${pan.value.y}px) scale(${scale.value})`,
  background: store.currentSlide ? slideBgCss(store.currentSlide) : '#ffffff',
}))

const showHandles = computed(() => store.selectionCount === 1)

function onUpdate(id: string, p: Partial<SlideElement>) {
  store.updateElement(id, p)
}

defineExpose({ resetView })
</script>

<template>
  <div
    ref="viewport"
    class="canvas-viewport"
    :class="{ 'canvas-viewport--pan': spaceDown }"
    @pointerdown="onViewportDown"
    @wheel="onWheel"
    @contextmenu.prevent="onCanvasCtx"
  >
    <div ref="stage" class="canvas-stage" :style="stageStyle">
      <ElementFrame
        v-for="(el, i) in store.currentSlide?.elements ?? []"
        :key="el.id"
        :el="el"
        :z="i + 1"
        :selected="store.isSelected(el.id)"
        :show-handles="showHandles"
        @grab="(p) => onGrab(p, el.id)"
        @update="onUpdate"
      />

      <!-- 绘制工具预览（线/箭头/笔） -->
      <div
        v-if="drawRect"
        class="draw-preview"
        :style="{ left: drawRect.x + 'px', top: drawRect.y + 'px', width: drawRect.w + 'px', height: drawRect.h + 'px' }"
      >
        <svg
          v-if="draw && (draw.tool === 'line' || draw.tool === 'arrow')"
          :viewBox="`0 0 ${drawRect.w} ${drawRect.h}`"
          width="100%"
          height="100%"
          preserveAspectRatio="none"
        >
          <line x1="0" y1="0" :x2="drawRect.w" :y2="drawRect.h" stroke="#7c3aed" stroke-width="2" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" />
        </svg>
        <svg
          v-else-if="draw && draw.tool === 'pen'"
          :viewBox="`0 0 ${drawRect.w} ${drawRect.h}`"
          width="100%"
          height="100%"
          preserveAspectRatio="none"
        >
          <polyline :points="drawNormPoints" fill="none" stroke="#7c3aed" stroke-width="2" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" />
        </svg>
      </div>

      <!-- 画多边形预览（点击放角点，双击 / 点首点闭合） -->
      <div
        v-if="polyActive"
        class="poly-overlay"
        @mousedown="onPolyDown"
        @mousemove="onPolyMove"
        @dblclick="onPolyDbl"
        @contextmenu.prevent
      >
        <svg
          v-if="polyDraw && polyDraw.points.length"
          class="poly-overlay__svg"
          :viewBox="`0 0 ${store.deck.width} ${store.deck.height}`"
          width="100%"
          height="100%"
          preserveAspectRatio="none"
        >
          <polyline :points="polyPreviewPoints" fill="rgba(124,58,237,0.12)" stroke="#7c3aed" stroke-width="2" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" />
          <circle v-for="(p, i) in polyDraw.points" :key="i" :cx="p.x" :cy="p.y" r="5" fill="#7c3aed" />
        </svg>
      </div>

      <!-- 多选时的整体外接框 -->
      <div
        v-if="store.selectionCount > 1 && store.selectionBounds"
        class="sel-box"
        :style="{
          left: store.selectionBounds.x + 'px',
          top: store.selectionBounds.y + 'px',
          width: store.selectionBounds.w + 'px',
          height: store.selectionBounds.h + 'px',
        }"
      ></div>

      <!-- 框选矩形 -->
      <div
        v-if="marquee"
        class="marquee"
        :style="{
          left: marquee.x + 'px', top: marquee.y + 'px',
          width: marquee.w + 'px', height: marquee.h + 'px',
        }"
      ></div>

      <!-- 吸附参考线 -->
      <template v-for="g in guides" :key="g.axis + ':' + g.pos">
        <div
          class="guide"
          :class="g.axis === 'x' ? 'guide--v' : 'guide--h'"
          :style="g.axis === 'x'
            ? { left: g.pos + 'px' }
            : { top: g.pos + 'px' }"
        ></div>
      </template>
    </div>

    <div v-if="store.editingGroupId" class="grp-tip">
      <span class="grp-tip__dot"></span>
      正在编辑组合内部（只影响当前选中元素）
      <button class="grp-tip__btn" @click="store.exitGroup()">退出组合编辑</button>
    </div>

    <!-- 快捷加页：右侧=在当前页后新增一页，底部=在当前页后新增子页；点击打开模板库选模板（「空白模板」= 空白页） -->
    <template v-if="!presenting">
      <button class="add-page-btn add-page-btn--right" title="新增页：打开模板库（含空白页）" @click="openTemplateLibrary('add')"><AppIcon name="plus" :size="20" /></button>
      <button class="add-page-btn add-page-btn--bottom" title="新增子页：打开模板库（含空白子页）" @click="openTemplateLibrary('addSub')"><AppIcon name="plus" :size="20" /></button>
    </template>
  </div>
</template>

<style scoped>
.canvas-viewport {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background-color: var(--bg-deep);
  background-image: radial-gradient(circle, rgba(110, 110, 126, 0.22) 1px, transparent 1.5px);
  background-size: 22px 22px;
  position: relative;
}
.canvas-viewport--pan { cursor: grab; }
.canvas-viewport--pan:active { cursor: grabbing; }

/* 舞台：一张「纸」，靠投影浮起来 */
.canvas-stage {
  position: relative;
  transform-origin: center center;
  border-radius: var(--radius);
  border: 1px solid rgba(24, 18, 46, 0.06);
  box-shadow: var(--shadow-stage);
  flex: none;
}
.sel-box {
  position: absolute;
  border: 1px dashed var(--brand-500);
  background: rgba(124, 58, 237, 0.04);
  pointer-events: none;
  z-index: 9998;
}
.draw-preview {
  position: absolute;
  border: 1px dashed var(--brand-500);
  pointer-events: none;
  z-index: 9997;
}
.poly-overlay {
  position: absolute;
  inset: 0;
  cursor: crosshair;
  z-index: 10001;
}
.poly-overlay__svg { display: block; overflow: visible; pointer-events: none; }
.marquee {
  position: absolute;
  border: 1px solid var(--brand-500);
  background: rgba(124, 58, 237, 0.10);
  pointer-events: none;
  z-index: 9999;
}
.guide {
  position: absolute;
  background: var(--danger);
  pointer-events: none;
  z-index: 10000;
}
.guide--v { top: 0; bottom: 0; width: 1px; }
.guide--h { left: 0; right: 0; height: 1px; }

/* ---------- 画布上的浮层 ---------- */
/* 组内编辑提示条：顶部居中浮出，明确「现在改的是组内单个元素」 */
.grp-tip {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10003;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px 6px 12px;
  font-size: 12px;
  color: var(--brand-700, #5b21b6);
  background: var(--brand-50, #f5f3ff);
  border: 1px solid var(--brand-200, #ddd6fe);
  border-radius: 999px;
  box-shadow: var(--shadow-sm);
  animation: grp-tip-in 0.18s var(--ease, ease);
}
.grp-tip__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--brand-600, #7c3aed);
}
.grp-tip__btn {
  font-size: 11px;
  padding: 3px 9px;
  color: var(--brand-700, #5b21b6);
  background: #fff;
  border: 1px solid var(--brand-200, #ddd6fe);
  border-radius: 999px;
  cursor: pointer;
  transition: background var(--dur-1, 0.12s) var(--ease, ease);
}
.grp-tip__btn:hover { background: var(--brand-100, #ede9fe); }
@keyframes grp-tip-in {
  from { opacity: 0; transform: translate(-50%, -6px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}
/* 底部状态栏见 components/StatusBar.vue（原来是画布右下角浮着的一颗胶囊，已改成贴底的 footbar） */
.hud__tip--draw { color: var(--brand-700); font-weight: 600; }

/* ---------- 快捷加页 ---------- */
.add-page-btn {
  position: absolute;
  z-index: 100;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 2px solid #fff;
  color: #fff;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform var(--dur-1) var(--ease), box-shadow var(--dur-1) var(--ease);
}
.add-page-btn--right {
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  background: linear-gradient(135deg, var(--brand-500), var(--brand-700));
  box-shadow: 0 4px 14px rgba(124, 58, 237, 0.42);
}
.add-page-btn--right:hover {
  transform: translateY(-50%) scale(1.08);
  box-shadow: 0 8px 22px rgba(124, 58, 237, 0.50);
}
.add-page-btn--bottom {
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  background: linear-gradient(135deg, var(--brand-300), var(--brand-500));
  box-shadow: 0 4px 14px rgba(124, 58, 237, 0.32);
}
.add-page-btn--bottom:hover {
  transform: translateX(-50%) scale(1.08);
  box-shadow: 0 8px 22px rgba(124, 58, 237, 0.42);
}
</style>