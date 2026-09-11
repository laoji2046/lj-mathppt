<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Deck } from '@/types'
import { renderDeckToRevealHtml } from '@/reveal/renderer'
import { renderPdfInto } from '@/composables/usePdf'
import SlideThumb from './SlideThumb.vue'

/**
 * 应用内全屏演示覆盖层。
 * 底部控制条 + 激光笔 / 批注（画笔）叠加层。
 */

const props = defineProps<{ deck: Deck | null }>()
const emit = defineEmits<{ close: [] }>()

function close() { emit('close') }

const url = ref('')
const frameEl = ref<HTMLIFrameElement | null>(null)
let blobUrl: string | null = null

// ---- 控制条状态 ----
const currentIndex = ref(0)
const notesOpen = ref(false)
const speakerOpen = ref(false)
const speakerOpacity = ref(0.92)
const showControls = ref(true)
const barEl = ref<HTMLElement | null>(null)
let hideTimer: number | undefined
const speakerSec = ref(0)
let speakerTimer: number | undefined
const currentNotes = computed(() => props.deck?.slides[currentIndex.value]?.notes || '')
const prevSlide = computed(() => props.deck?.slides[currentIndex.value - 1])
const nextSlide = computed(() => props.deck?.slides[currentIndex.value + 1])
const speakerPaused = ref(false)
const laserOn = ref(false)
const drawOn = ref(false)
const drawColor = ref('#ff3b30')
const drawWidth = ref(5)
const drawWidths = [2, 5, 9, 14]
const laser = ref({ x: 0, y: 0 })
const laserColor = ref('#ff3b30')
const laserWidth = ref(5)
const laserWidths = [2, 5, 9, 14]
function hexToRgba(hex: string, a: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r},${g},${b},${a})`
}
const laserStyle = computed(() => ({
  left: laser.value.x + 'px',
  top: laser.value.y + 'px',
  background: hexToRgba(laserColor.value, 0.85),
  boxShadow: `0 0 12px 4px ${hexToRgba(laserColor.value, 0.5)}`,
}))

function postToFrame(msg: Record<string, unknown>) {
  frameEl.value?.contentWindow?.postMessage(JSON.stringify(msg), '*')
}
watch(laserOn, (on) => postToFrame({ type: 'fx-laser-on', on }))
watch(laserColor, (color) => postToFrame({ type: 'fx-laser-color', color }))

// ---- 激光笔书写（宿主画布，盖在 iframe 之上）----
// 参考 LJ-PPT：画布尺寸用视口值（window.innerWidth/Height），
// 不要用 reveal.getBoundingClientRect()（Reveal transform 会返回 0/偏移 → canvas 尺寸 0 → 鼠标点不到、画不出）。
const laserCanvas = ref<HTMLCanvasElement | null>(null)
let laserCtx2d: CanvasRenderingContext2D | null = null
let laserDown = false
let laserLast: { x: number; y: number } | null = null
let laserSeg: { x1: number; y1: number; x2: number; y2: number }[] = []
let laserFades: number[] = []
function initLaserCanvas() {
  const c = laserCanvas.value
  if (!c) return
  const w = window.innerWidth
  const h = window.innerHeight
  c.width = Math.max(1, w)
  c.height = Math.max(1, h)
  c.style.width = w + 'px'
  c.style.height = h + 'px'
  laserCtx2d = c.getContext('2d')
  c.onmousedown = (e) => { laserDown = true; laserLast = null; laserSeg = []; laserStroke(e) }
  c.onmousemove = (e) => { if (laserDown) laserStroke(e) }
  window.onmouseup = () => { laserDown = false; laserLast = null; endLaserStroke() }
}
function laserStroke(e: MouseEvent) {
  if (!laserOn.value) return
  const c = laserCtx2d
  const el = laserCanvas.value
  if (!c || !el) return
  const rect = el.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  c.strokeStyle = laserColor.value
  c.lineWidth = laserWidth.value
  c.lineCap = 'round'
  c.lineJoin = 'round'
  c.beginPath()
  if (laserLast) { c.moveTo(laserLast.x, laserLast.y); c.lineTo(x, y); c.stroke() }
  else { c.moveTo(x, y); c.lineTo(x, y); c.stroke() }
  laserSeg.push({ x1: laserLast ? laserLast.x : x, y1: laserLast ? laserLast.y : y, x2: x, y2: y })
  laserLast = { x, y }
}
/** 结束一笔：激光笔模式 800ms 后用 destination-out 淡出该笔画（参考 LJ-PPT） */
function endLaserStroke() {
  const seg = laserSeg.slice()
  laserSeg = []
  if (!seg.length) return
  const t = window.setTimeout(() => {
    const c = laserCtx2d
    if (c) {
      c.save()
      c.globalCompositeOperation = 'destination-out'
      c.strokeStyle = 'rgba(0,0,0,1)'
      c.lineWidth = laserWidth.value + 1
      c.lineCap = 'round'
      c.lineJoin = 'round'
      c.beginPath()
      seg.forEach((s) => { c.moveTo(s.x1, s.y1); c.lineTo(s.x2, s.y2) })
      c.stroke()
      c.restore()
    }
    laserFades = laserFades.filter((id) => id !== t)
  }, 800)
  laserFades.push(t)
}
function clearLaser() {
  const c = laserCanvas.value
  if (laserCtx2d && c) laserCtx2d.clearRect(0, 0, c.width, c.height)
  laserFades.forEach((t) => clearTimeout(t))
  laserFades = []
  laserSeg = []
}

// ---- 批注绘制 ----
const drawCanvas = ref<HTMLCanvasElement | null>(null)
let strokes: { pts: { x: number; y: number }[]; color: string; width: number }[] = []
let current: { pts: { x: number; y: number }[]; color: string; width: number } | null = null
function dpr() { return window.devicePixelRatio || 1 }
function ctx() { return drawCanvas.value?.getContext('2d') || null }
function resizeDraw() {
  const c = drawCanvas.value
  if (!c) return
  // 用视口尺寸；不要依赖 getBoundingClientRect（Reveal transform 会返回 0/偏移 → canvas 尺寸 0 → 点不到画不出）
  const d = dpr()
  c.width = Math.max(1, Math.round(window.innerWidth * d))
  c.height = Math.max(1, Math.round(window.innerHeight * d))
  c.style.width = window.innerWidth + 'px'
  c.style.height = window.innerHeight + 'px'
  c.getContext('2d')?.setTransform(d, 0, 0, d, 0, 0)
  repaint()
}
function drawStroke(s: { pts: { x: number; y: number }[]; color: string; width: number }) {
  const c = ctx()
  if (!c) return
  c.strokeStyle = s.color
  c.lineWidth = s.width || 3
  c.lineJoin = 'round'
  c.lineCap = 'round'
  c.beginPath()
  s.pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)))
  c.stroke()
}
function repaint() {
  const c = ctx()
  if (!c) return
  const d = dpr()
  c.setTransform(d, 0, 0, d, 0, 0)
  c.clearRect(0, 0, (drawCanvas.value?.width || 0) / d, (drawCanvas.value?.height || 0) / d)
  for (const s of strokes) drawStroke(s)
  if (current) drawStroke(current)
}
function onDrawDown(e: PointerEvent) {
  if (e.button !== 0 || !drawCanvas.value) return
  const r = drawCanvas.value.getBoundingClientRect()
  current = { pts: [{ x: e.clientX - r.left, y: e.clientY - r.top }], color: drawColor.value, width: drawWidth.value }
  drawCanvas.value.setPointerCapture(e.pointerId)
}
function onDrawMove(e: PointerEvent) {
  if (!current || !drawCanvas.value) return
  const r = drawCanvas.value.getBoundingClientRect()
  current.pts.push({ x: e.clientX - r.left, y: e.clientY - r.top })
  repaint()
}
function onDrawUp() {
  if (current) { strokes.push(current); current = null }
}
function clearDraw() { strokes = []; current = null; repaint() }
function undoDraw() { strokes.pop(); repaint() }
/**
 * 激光笔与批注（画笔）互斥：两者都是"覆盖在演示页之上、抢指针事件"的工具，
 * 同时打开会互相抢事件（画笔画不出、激光笔拖不动），所以开一个就自动关另一个。
 */
function setLaser(on: boolean) {
  laserOn.value = on
  if (on) drawOn.value = false
}
function setDraw(on: boolean) {
  drawOn.value = on
  if (on) {
    laserOn.value = false
    setTimeout(resizeDraw, 30)
  }
}
function toggleLaser() { setLaser(!laserOn.value) }
function toggleDraw() { setDraw(!drawOn.value) }

function reveal() {
  return (frameEl.value?.contentWindow as any)?.Reveal
}
function navPrev() { reveal()?.navigatePrev?.() }
function navNext() { reveal()?.navigateNext?.() }
function overview() { reveal()?.toggleOverview?.() }
function help() { reveal()?.toggleHelp?.() }
function fullscreen() {
  if (document.fullscreenElement) document.exitFullscreen()
  else document.querySelector('.present')?.requestFullscreen?.()
}

/** 演示页的 GeoGebra：在宿主正常页挂载（blob 演示页里 GGB 渲染受限），覆盖到对应位置 */
/** 演示页如果含 PDF 嵌入（.fx-doc），在宿主正常页里用 pdf.js 渲染并注入 iframe */
async function renderHostPdfs() {
  const doc = frameEl.value?.contentDocument
  if (!doc) return
  const hosts = (doc.querySelectorAll('.fx-doc') as unknown) as HTMLElement[]
  for (const el of Array.from(hosts)) {
    const b64 = el.getAttribute('data-pdf-b64')
    if (!b64) continue
    try { await renderPdfInto(el, b64) }
    catch (e) { el.textContent = 'PDF 渲染失败：' + (e instanceof Error ? e.message : String(e)) }
  }
}

function onFrameLoad() {
  renderHostPdfs()
  attachFrameMove()
  // 进入演示先显示 2.5s，随后自动隐藏；之后由 updateBarVisible 负责显隐
  showControls.value = true
  clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => { showControls.value = false }, 2500)
  postToFrame({ type: 'fx-laser-on', on: laserOn.value })
  postToFrame({ type: 'fx-laser-color', color: laserColor.value })
}

/** target 是否落在某个选择器内（来自 iframe 的事件其 target 属于另一个 realm，
 *  instanceof Element 会失效，所以用鸭子类型判 closest） */
function closestIn(target: EventTarget | null, sel: string): boolean {
  const el = target as (Element & { closest?: (s: string) => Element | null }) | null
  if (!el || typeof el.closest !== 'function') return false
  try { return !!el.closest(sel) } catch { return false }
}
/** 应用自己的面板（控制条本体 / 备注 / 演讲者视图，挂 .present__ui）：悬停时控制条保持显示 */
function overHostUI(target: EventTarget | null): boolean { return closestIn(target, '.present__ui') }
/** 画笔 / 激光属性条（挂 .present__propbar）：**中性区** —— 悬停它时不改变控制条显隐。
 *  它正好贴在控制条上方，如果按"自家 UI"处理就会一直把控制条唤出来，两条叠成一大坨挡住幻灯片。 */
function overPropBar(target: EventTarget | null): boolean { return closestIn(target, '.present__propbar') }

/**
 * 底部控制条感应带 = **屏幕最下方一条窄带**（不再跟着工具条的整体高度走）：
 *   纵向：屏幕底边往上 bandH，bandH = 控制条高度的 1/6（约 10px，最小 10px —— 必须与控制条 bottom 重叠）
 *   横向：居中，宽度 = 工具条宽度 ± 24px
 * 工具条隐藏时停在屏幕外，这条窄带就是"唤出区"；鼠标一旦离开窄带、又没有停在工具条本身上，
 * 就自动消隐。悬停工具条/备注/演讲者视图（.present__ui）时始终显示；
 * 悬停画笔/激光属性条（.present__propbar）则保持现状（不呼出控制条）。
 *
 * 注：数值取 offsetWidth/offsetHeight 并缓存（mousemove 每次读 getComputedStyle 会触发重排）。
 * 不能直接用 getBoundingClientRect()：工具条隐藏时带着 translate(-50%,120%)，rect 会跑到屏幕外。
 *
 * 必须同时监听两个来源：
 * - iframe 内部的 document —— 鼠标在幻灯片区域时（iframe 铺满全屏），事件只在 iframe 里；
 * - 宿主 window —— 打开激光笔/批注后，全屏画布（z-index 1001/1002）盖在 iframe 之上，事件到不了 iframe。
 * 只监听其中一个，就会出现"工具条唤不出来 / 关不掉激光笔"这类锁死。
 */
let barBox = { w: 520, h: 52, bottom: 20 }
function measureBar() {
  const el = barEl.value
  if (!el) return
  barBox = {
    w: el.offsetWidth,
    h: el.offsetHeight,
    bottom: parseFloat(getComputedStyle(el).bottom) || 0,
  }
}
function updateBarVisible(x: number, y: number, target: EventTarget | null) {
  if (overHostUI(target)) { showControls.value = true; return }
  // 悬停画笔/激光属性条：既不呼出也不收起控制条，保持现状
  if (overPropBar(target)) return
  const h = window.innerHeight
  const w = window.innerWidth
  // 唤出区 = 屏幕最下方一条窄带，高度为控制条高度的六分之一；保底 10px，
  // 保证与控制条的 bottom:6px 有重叠区（两者必须相接，否则鼠标"够不到"工具条）
  const bandH = Math.max(10, Math.round((barBox.h + 8) / 6))
  const inRow = y >= h - bandH
  const padX = 24
  const inCol = Math.abs(x - w / 2) < barBox.w / 2 + padX
  showControls.value = inCol && inRow
}
function onHostMove(e: MouseEvent) {
  updateBarVisible(e.clientX, e.clientY, e.target)
  if (laserOn.value) laser.value = { x: e.clientX, y: e.clientY }
}
function onFrameMove(e: MouseEvent) { updateBarVisible(e.clientX, e.clientY, e.target) }
/** iframe 每次重新加载都是新 document，这里挂监听并保证不重复挂 */
let frameDoc: Document | null = null
function attachFrameMove() {
  const doc = frameEl.value?.contentDocument
  if (!doc || doc === frameDoc) return
  frameDoc?.removeEventListener('mousemove', onFrameMove)
  doc.addEventListener('mousemove', onFrameMove)
  frameDoc = doc
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.preventDefault(); close(); return }
  // 兜底快捷键：万一控制条被藏住，也能开关激光笔 / 批注
  const k = e.key.toLowerCase()
  if (k === 'l') { e.preventDefault(); toggleLaser(); return }
  if (k === 'p') { e.preventDefault(); toggleDraw() }
}
function onMessage(e: MessageEvent) {
  if (e.data === 'fx-present-esc') { close() ; return }
  try {
    const m = JSON.parse(e.data)
    if (m && m.type === 'fx-index' && typeof m.index === 'number') {
      currentIndex.value = m.index
    } else if (m.type === 'fx-laser' && typeof m.x === 'number' && typeof m.y === 'number') {
      laser.value = { x: m.x, y: m.y }
    }
  } catch { /* 非本应用消息 */ }
}
// 打开备注 / 演讲者视图时把控制条显示出来，免得它正处在隐藏态、用户找不到
watch([notesOpen, speakerOpen], ([n, s]) => { if (n || s) showControls.value = true })

function toggleSpeaker() {
  speakerOpen.value = !speakerOpen.value
  if (speakerOpen.value) {
    speakerSec.value = 0
    speakerPaused.value = false
    clearInterval(speakerTimer)
    speakerTimer = setInterval(() => { if (!speakerPaused.value) speakerSec.value++ }, 1000) as unknown as number
  } else clearInterval(speakerTimer)
}
function fmt(sec: number) { const m = Math.floor(sec / 60), s = sec % 60; return (m < 10 ? '0' + m : '' + m) + ':' + (s < 10 ? '0' + s : '' + s) }


onMounted(() => {
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('message', onMessage)
  window.addEventListener('resize', initLaserCanvas)
  window.addEventListener('mousemove', onHostMove)
  window.addEventListener('resize', measureBar)
  nextTick(() => measureBar())
  initLaserCanvas()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('message', onMessage)
  window.removeEventListener('resize', initLaserCanvas)
  window.removeEventListener('mousemove', onHostMove)
  window.removeEventListener('resize', measureBar)
  frameDoc?.removeEventListener('mousemove', onFrameMove)
  frameDoc = null
  window.onmouseup = null
  laserFades.forEach((t) => clearTimeout(t)); laserFades = []
  if (blobUrl) URL.revokeObjectURL(blobUrl)
  blobUrl = null
  clearInterval(speakerTimer)
})

watch(
  () => props.deck,
  (deck) => {
    if (!deck) return
    const html = renderDeckToRevealHtml(deck, { assets: 'local' })
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    blobUrl = URL.createObjectURL(blob)
    url.value = blobUrl
    // .present 是 v-if="deck"：进入演示时才渲染，此时 laserCanvas 才可用，需在 DOM 更新后初始化
    nextTick(() => initLaserCanvas())
  },
)
</script>

<template>
  <div v-if="deck" class="present">
    <iframe ref="frameEl" class="present__frame" :src="url" allow="fullscreen" @load="onFrameLoad()" />

    <!-- 批注绘制图层（覆盖在展示页之上） -->
    <canvas
      v-if="drawOn"
      ref="drawCanvas"
      class="present__draw"
      @pointerdown="onDrawDown"
      @pointermove="onDrawMove"
      @pointerup="onDrawUp"
      @pointercancel="onDrawUp"
    ></canvas>

    <!-- 激光笔书写画布（盖在 iframe 之上，捕获拖动画线） -->
    <canvas
      ref="laserCanvas"
      class="present__laserDraw"
      :style="{ pointerEvents: laserOn ? 'auto' : 'none' }"
    ></canvas>

    <!-- 激光笔 -->
    <div v-if="laserOn" class="present__laser" :style="laserStyle"></div>

    <!-- 批注工具栏（绘制时浮在控制条上方） -->
    <div v-if="drawOn" class="present__drawbar present__propbar">
      <button v-for="c in ['#ff3b30', '#ffcc00', '#00d0ff', '#22c55e', '#ffffff']" :key="c" class="dw" :class="{ 'dw--on': drawColor === c }" :style="{ background: c }" @click="drawColor = c" title="笔色"></button>
      <span class="pc-sep"></span>
      <button v-for="w in drawWidths" :key="'d' + w" class="dw dw--txt" :class="{ 'dw--on': drawWidth === w }" @click="drawWidth = w" :title="'线宽 ' + w">
        <span class="dw-wline" :style="{ height: w + 'px' }"></span>
      </button>
      <span class="pc-sep"></span>
      <button class="dw dw--txt" @click="undoDraw" title="撤销">↩</button>
      <button class="dw dw--txt" @click="clearDraw" title="清空">🗑</button>
      <span class="pc-sep"></span>
      <button class="dw dw--txt dw--close" @click="setDraw(false)" title="退出批注（画笔）模式">✕</button>
    </div>

    <!-- 激光笔色板 -->
    <div v-if="laserOn" class="present__laserbar present__propbar">
      <button v-for="c in ['#ff3b30', '#ffcc00', '#00d0ff', '#22c55e', '#ffffff']" :key="c" class="dw" :class="{ 'dw--on': laserColor === c }" :style="{ background: c }" @click="laserColor = c" title="激光颜色"></button>
      <span class="pc-sep"></span>
      <button v-for="w in laserWidths" :key="'w' + w" class="dw dw--txt" :class="{ 'dw--on': laserWidth === w }" @click="laserWidth = w" :title="'线宽 ' + w">
        <span class="dw-wline" :style="{ height: w + 'px' }"></span>
      </button>
      <span class="pc-sep"></span>
      <button class="dw dw--txt" @click="clearLaser()" title="清空激光笔画迹">🗑</button>
      <span class="pc-sep"></span>
      <button class="dw dw--txt dw--close" @click="setLaser(false)" title="退出激光笔模式">✕</button>
    </div>

    <!-- 备注面板 -->
    <div v-if="notesOpen" class="present__notes present__ui">
      <div class="present__notes-head">备注 <button class="present__notes-x" @click="notesOpen = false">×</button></div>
      <div class="present__notes-body">{{ currentNotes || '（本页暂无备注）' }}</div>
    </div>

    <!-- 演讲者视图（备注 + 计时 + 上一张/下一张预览） -->
    <div v-if="speakerOpen" class="present__speaker present__ui" :style="{ opacity: speakerOpacity }">
      <header class="present__speaker-head">
        <span class="present__speaker-title">📝 演讲者备注</span>
        <span class="present__speaker-tools">
          <span class="sp-op"><input type="range" min="0.2" max="1" step="0.05" v-model.number="speakerOpacity" title="视图透明度" /><b>{{ Math.round(speakerOpacity * 100) }}%</b></span>
          <b class="present__speaker-timer">{{ fmt(speakerSec) }}</b>
          <button class="sp-tbtn" :title="speakerPaused ? '继续' : '暂停'" @click="speakerPaused = !speakerPaused">{{ speakerPaused ? '▶' : '⏸' }}</button>
          <button class="sp-tbtn" title="重置计时" @click="speakerSec = 0">↻</button>
        </span>
        <button class="present__speaker-x" title="关闭演讲者视图" @click="toggleSpeaker">✕</button>
      </header>
      <div class="present__speaker-body">
        <button class="sp-card" @click="navPrev" :disabled="!prevSlide">
          <span class="sp-card-label">上一张</span>
          <SlideThumb v-if="prevSlide" :slide="prevSlide" :width="228" :height="128" />
          <span v-else class="sp-empty">（已是首页）</span>
        </button>
        <button class="sp-card" @click="navNext" :disabled="!nextSlide">
          <span class="sp-card-label">下一张</span>
          <SlideThumb v-if="nextSlide" :slide="nextSlide" :width="228" :height="128" />
          <span v-else class="sp-empty">（已是末页）</span>
        </button>
      </div>
      <div class="present__speaker-note">{{ currentNotes || '本页没有备注 —— 在编辑器的「备注」区域添加。' }}</div>
    </div>

    <!-- 底部控制条 -->
    <div ref="barEl" class="present__controls present__ui" :class="{ 'present__controls--hide': !showControls }">
      <button class="pc" title="上一页 (←)" @click="navPrev"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6" /></svg></button>
      <button class="pc" title="下一页 (→)" @click="navNext"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6" /></svg></button>
      <span class="pc-sep"></span>
      <button class="pc" :class="{ 'pc--on': laserOn }" title="激光笔（打开时自动关闭批注）" @click="toggleLaser"><svg viewBox="0 0 24 24"><circle cx="6" cy="18" r="3"/><path d="M8.5 15.5L20 4"/></svg></button>
      <button class="pc" :class="{ 'pc--on': drawOn }" title="批注（画笔，打开时自动关闭激光笔）" @click="toggleDraw"><svg viewBox="0 0 24 24"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg></button>
      <button class="pc" title="总览（网格）" @click="overview"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></button>
      <button class="pc" title="全屏" @click="fullscreen"><svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg></button>
      <button class="pc" :class="{ 'pc--on': notesOpen }" title="备注" @click="notesOpen = !notesOpen"><svg viewBox="0 0 24 24"><path d="M4 6h16M4 10h16M4 14h10"/><path d="M15 18h6"/></svg></button>
      <button class="pc" :class="{ 'pc--on': speakerOpen }" title="演讲者视图（备注+计时）" @click="toggleSpeaker"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/></svg></button>
      <button class="pc" title="帮助 (?)" @click="help"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></button>
      <span class="pc-sep"></span>
      <button class="pc pc--danger" title="退出演示 (Esc)" @click="close"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
  </div>
</template>

<style scoped>
.present { position: fixed; inset: 0; z-index: 1000; background: #000; }
.present__frame { width: 100%; height: 100%; border: none; background: #000; }
.present__draw {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 1001;
  cursor: crosshair;
  touch-action: none;
}
.present__laserDraw {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 1002;
  cursor: crosshair;
  touch-action: none;
}
.present__laser {
  position: fixed;
  z-index: 1003;
  width: 20px;
  height: 20px;
  margin: -10px 0 0 -10px;
  border-radius: 50%;
  background: rgba(255, 60, 50, 0.85);
  box-shadow: 0 0 12px 4px rgba(255, 60, 50, 0.5);
  pointer-events: none;
}
.present__notes { position: fixed; right: 18px; bottom: 56px; z-index: 1005; width: 320px; background: rgba(24,24,28,0.92); border-radius: 12px; padding: 12px 14px; color: #f0ede4; box-shadow: 0 8px 28px rgba(0,0,0,0.5); }
.present__notes-head { display: flex; align-items: center; justify-content: space-between; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
.present__notes-x { border: 1px solid rgba(255,255,255,0.25); background: transparent; color: #f0ede4; border-radius: 5px; padding: 3px 8px; font-size: 12px; cursor: pointer; }
.present__notes-body { font-size: 13px; line-height: 1.6; white-space: pre-wrap; max-height: 40vh; overflow: auto; text-align: left; }
.present__speaker { position: fixed; left: 18px; bottom: 18px; z-index: 1005; width: 560px; max-width: 94vw; background: rgba(20,20,26,0.94); border-radius: 14px; padding: 12px 14px; color: #f0ede4; box-shadow: 0 10px 34px rgba(0,0,0,0.55); transition: opacity .2s; }
.present__speaker-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.present__speaker-title { font-size: 15px; font-weight: 600; }
.present__speaker-tools { display: flex; align-items: center; gap: 8px; }
.present__speaker-timer { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
.sp-op { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: #bbb; }
.sp-op input { accent-color: #4b6cf0; width: 72px; }
.sp-op b { font-size: 11px; color: #ddd; min-width: 34px; }
.sp-tbtn { width: 28px; height: 28px; border: 1px solid rgba(255,255,255,0.25); background: transparent; color: #f0ede4; border-radius: 6px; cursor: pointer; }
.sp-tbtn:hover { background: rgba(255,255,255,0.12); }
.present__speaker-x { border: 1px solid rgba(255,255,255,0.25); background: transparent; color: #f0ede4; border-radius: 6px; padding: 5px 10px; font-size: 13px; cursor: pointer; }
.present__speaker-x:hover { background: rgba(255,255,255,0.12); }
.present__speaker-body { display: flex; gap: 12px; margin-bottom: 10px; }
.sp-card { flex: 1; display: flex; flex-direction: column; gap: 6px; align-items: stretch; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; padding: 8px; cursor: pointer; color: #f0ede4; }
.sp-card:hover:not(:disabled) { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.3); }
.sp-card:disabled { opacity: 0.5; cursor: not-allowed; }
.sp-card-label { font-size: 13px; font-weight: 600; }
.sp-empty { display: flex; align-items: center; justify-content: center; min-height: 128px; font-size: 12px; color: rgba(240,237,228,0.6); }
.present__speaker-note { font-size: 13px; line-height: 1.6; white-space: pre-wrap; max-height: 30vh; overflow: auto; text-align: left; color: #d9d6cf; }
/* 批注/激光属性条：贴在控制条正上方（控制条 bottom:6px + 高约 40px = 顶边 46px，这里留 4px 缝）。
   属性条高度 = 按钮 22px + 上下 padding 8px = 30px（原来 26px 按钮 + 12px padding = 38px）。
   改控制条高度/位置时记得同步这里的 bottom。 */
.present__drawbar {
  position: fixed;
  left: 50%;
  bottom: 50px;
  transform: translateX(-50%);
  z-index: 1004;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(24, 24, 28, 0.85);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
}
.dw { width: 22px; height: 22px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.25); cursor: pointer; }
.dw--on { border-color: #fff; box-shadow: 0 0 0 2px rgba(255,255,255,0.5); }
.dw--txt { border-radius: 6px; color: #e8e6ee; background: transparent; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; }
.dw-wline { display: block; background: currentColor; border-radius: 2px; min-width: 14px; }
.dw--txt:hover { background: rgba(255,255,255,0.12); }
/* 属性条右端的关闭按钮：点它退出批注 / 激光笔模式（等价于再点一次控制条上的那个按钮） */
.dw--close { font-size: 13px; color: #ffb3b3; }
.dw--close:hover { background: rgba(255, 107, 107, 0.22); color: #ff6b6b; }
.present__laserbar {
  position: fixed;
  left: 50%;
  bottom: 50px;
  transform: translateX(-50%);
  z-index: 1004;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(24, 24, 28, 0.85);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
}
/* 控制条贴底 6px：必须与最下沿 10px 的"唤出带"重叠（见 updateBarVisible）。
   以前是 bottom:20px，鼠标从唤出带上移到工具条之间要穿过一段"既不在带内、也不在工具条上"的空白，
   工具条会在被抓住之前先滑走 —— 表现为"看得见但点不到"。 */
.present__controls {
  position: fixed;
  left: 50%;
  bottom: 6px;
  transform: translateX(-50%);
  z-index: 1002;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 5px 9px;
  border-radius: 999px;
  background: rgba(24, 24, 28, 0.82);
  transition: opacity .25s, transform .25s, visibility .25s;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(8px);
}
.present__controls--hide { opacity: 0; transform: translate(-50%, 120%); visibility: hidden; pointer-events: none; }
.pc {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #e8e6ee;
  cursor: pointer;
  transition: background 0.15s, transform 0.08s;
}
.pc:hover { background: rgba(255, 255, 255, 0.12); }
.pc:active { transform: scale(0.92); }
.pc--on { background: rgba(255, 255, 255, 0.18); color: #ffd479; }
.pc svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.pc-sep { width: 1px; height: 18px; margin: 0 3px; background: rgba(255, 255, 255, 0.18); }
.pc--danger { color: #ff6b6b; }
.pc--danger:hover { background: rgba(255, 90, 90, 0.22); }
</style>