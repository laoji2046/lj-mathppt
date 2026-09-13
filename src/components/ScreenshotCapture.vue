<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { useDeckStore } from '@/stores/deck'
import { captureScreens, captureWindow, isTauri, listWindows, setCaptureMode, type WinInfo } from '@/composables/useTauri'
import type { SlideElement } from '@/types'

const store = useDeckStore()
const emit = defineEmits<{ (e: 'close'): void }>()

const state = ref<'loading' | 'ready' | 'error'>('loading')
const err = ref('')
const fullUrl = ref('')
const imageRef = ref<HTMLImageElement | null>(null)
const stage = ref<HTMLElement | null>(null)
/** 正好包住图片的壳（position: relative）—— 选区坐标**天然相对图片**，
 *  不再有"stage 坐标系 ↔ 图片坐标系"的换算，从结构上消掉一类偏移 bug。 */
const wrap = ref<HTMLElement | null>(null)
let stream: MediaStream | null = null

// 选区矩形（相对 stage 的 CSS 像素）
const sel = ref<{ x: number; y: number; w: number; h: number } | null>(null)
const selStart = ref<{ x: number; y: number } | null>(null)
const natural = ref<{ w: number; h: number }>({ w: 0, h: 0 })
/** 拖拽时跟着走的尺寸提示（按**自然像素**显示，跟 Word 一样） */
const liveSize = computed(() => {
  const b = sel.value
  if (!b || !imageRef.value) return ''
  const r = imageRef.value.getBoundingClientRect()
  if (!r.width || !r.height) return ''
  const w = Math.round((b.w * natural.value.w) / r.width)
  const h = Math.round((b.h * natural.value.h) / r.height)
  return w + ' × ' + h
})

/** 桌面端：主窗口临时全屏置顶，把整张桌面截图铺满，用户直接在"桌面"上拖 —— 跟 Word/PPT 一个手感。
 *  关闭/完成时一定要还原，否则会把主窗口留在全屏。 */
const native = ref(false)
/** 桌面端抓图的诊断信息（几台显示器、桌面多大）—— 抓不全时一眼看出问题 */
const diag = ref('')
/** 桌面端：可截的窗口列表 + 原始的整桌面截图（"回到整个桌面"要用） */
const winList = ref<WinInfo[]>([])
const desktopUrl = ref('')
const desktopNatural = ref<{ w: number; h: number }>({ w: 0, h: 0 })

/** 选一个窗口截：按窗口内容截，**被别的窗口挡住也能截到它自己** —— 这是"想截别的窗口却被遮挡"的唯一解法 */
async function pickWindow(id: number) {
  const shot = await captureWindow(id)
  if (!shot) {
    diag.value = '这个窗口截不了（可能已关闭或最小化）'
    return
  }
  fullUrl.value = shot.dataUrl
  natural.value = { w: shot.w, h: shot.h }
  sel.value = null
  const w = winList.value.find((x) => x.id === id)
  diag.value = '窗口截图：' + (w ? (w.app || '') + ' ' + w.title : '') + ' · ' + shot.w + '×' + shot.h
}
/** 回到整张桌面 */
function backToDesktop() {
  if (!desktopUrl.value) return
  fullUrl.value = desktopUrl.value
  natural.value = { ...desktopNatural.value }
  sel.value = null
  diag.value = '整个桌面 · ' + desktopNatural.value.w + '×' + desktopNatural.value.h
}
async function finish() {
  if (native.value) {
    native.value = false
    await setCaptureMode(false)
  }
  emit('close')
}

async function capture() {
  // ① 桌面端优先走**原生截全屏**：省掉浏览器那次"选共享窗口"，也不用先授权一个源
  if (isTauri()) {
    const shot = await captureScreens()
    if (shot) {
      native.value = true
      fullUrl.value = shot.dataUrl
      natural.value = { w: shot.w, h: shot.h }
      const fmt = (m: { name?: string; x: number; y: number; w: number; h: number; scale?: number }) =>
        (m.name || '?') + ' ' + m.w + '×' + m.h + '@' + m.x + ',' + m.y + (m.scale ? ' ×' + m.scale : '')
      diag.value = '捕获 ' + (shot.monitors.length || 1) + ' 个显示器 · 桌面 ' + shot.w + '×' + shot.h +
        ' ｜ 系统报告 ' + (shot.osMonitors.length || 1) + ' 个' +
        (shot.monitors.length ? ' ｜ 抓到：' + shot.monitors.map(fmt).join('；') : '') +
        (shot.osMonitors.length ? ' ｜ 系统：' + shot.osMonitors.map(fmt).join('；') : '')
      desktopUrl.value = shot.dataUrl
      desktopNatural.value = { w: shot.w, h: shot.h }
      state.value = 'ready'
      await setCaptureMode(true)
      // 列可截的窗口（被遮挡的窗口只能按窗口截，所以这里列出来给用户挑）
      winList.value = await listWindows()
      bringToFront()
      return
    }
  }
  // ② 浏览器（或原生失败）回退到 getDisplayMedia
  try {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      throw new Error('当前环境不支持屏幕捕获（需 Chrome/Edge 等）')
    }
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false })
    const video = document.createElement('video')
    video.srcObject = stream
    await video.play()
    await new Promise<void>((r) => { if (video.videoWidth) r(); else video.onloadeddata = () => r() })
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')!.drawImage(video, 0, 0)
    fullUrl.value = canvas.toDataURL('image/png')
    natural.value = { w: video.videoWidth, h: video.videoHeight }
    state.value = 'ready'
    stopStream()
    // 抓完帧要把**本窗口拉到前台**：浏览器的共享选择器关掉后应用往往还在后面，
    // 用户得先点回来才能框选（实测此时 document.hasFocus() 是 false）。
    bringToFront()
  } catch (e) {
    err.value = e instanceof Error ? e.message : String(e)
    state.value = 'error'
  }
}
function stopStream() {
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null }
}

/** 把窗口拉到前台。window.focus() 有时会被浏览器忽略（尤其是刚关掉共享选择器时），
 *  所以隔一小会儿再试一次；仍然没焦点就显示一句提示兜底 —— 总比让用户莫名其妙强。 */
const needFocus = ref(false)
function tryFocus() {
  try { window.focus() } catch { /* 忽略 */ }
  needFocus.value = !document.hasFocus()
}
function bringToFront() {
  nextTick(() => {
    tryFocus()
    // 选择器完全关闭可能还要几十毫秒，再补一枪
    setTimeout(tryFocus, 150)
    setTimeout(tryFocus, 500)
  })
}

// 选区拖拽
function onDown(e: PointerEvent) {
  if (!wrap.value) return
  const p = localPoint(e)
  const b = imgBox()
  selStart.value = {
    x: Math.min(Math.max(p.x, 0), b.w),
    y: Math.min(Math.max(p.y, 0), b.h),
  }
  try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* 合成指针会抛，忽略 */ }
}
/** 选区坐标以**包住图片的壳**为基准（图片左上角 = 壳的 0,0）——
 *  这样框选和裁剪天生同源，不需要任何偏移换算。 */
function imgBox() {
  const w = wrap.value
  if (!w) return { x: 0, y: 0, w: 0, h: 0 }
  const r = w.getBoundingClientRect()
  return { x: 0, y: 0, w: r.width, h: r.height }
}
/** 相对壳的指针坐标 */
function localPoint(e: PointerEvent) {
  const w = wrap.value
  if (!w) return { x: 0, y: 0 }
  const r = w.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}
function onMove(e: PointerEvent) {
  if (!selStart.value) return
  const p = localPoint(e)
  const b = imgBox()
  const cur = {
    x: Math.min(Math.max(p.x, 0), b.w),
    y: Math.min(Math.max(p.y, 0), b.h),
  }
  const st = selStart.value
  sel.value = {
    x: Math.max(0, Math.min(st.x, cur.x)),
    y: Math.max(0, Math.min(st.y, cur.y)),
    w: Math.abs(cur.x - st.x),
    h: Math.abs(cur.y - st.y),
  }
}
/** 松手即裁 —— Word/PPT 就是"拖完就完事"，不该再多点一次确认 ✗。
 *  选区太小（相当于单击）就什么都不做，让用户接着拖或点「整屏插入」。 */
function onUp() {
  if (!selStart.value) return
  selStart.value = null
  const b = sel.value
  if (b && b.w >= 8 && b.h >= 8) confirmCrop()
}

function insertImage(url: string, nw: number, nh: number) {
  // 以合适尺寸插入（限制最大 900×620，保持比例）
  let w = nw || 640
  let h = nh || 400
  const f = Math.min(900 / w, 620 / h)
  if (f < 1) { w = Math.round(w * f); h = Math.round(h * f) }
  store.addElement('image', { src: url, w, h, fit: 'contain' } as Partial<SlideElement>)
  void finish()
}

function confirmCrop() {
  const img = imageRef.value
  if (!img || !sel.value || !fullUrl.value) return
  const selBox = sel.value
  if (selBox.w < 8 || selBox.h < 8) return
  // 选区坐标本来就以图片为基准（壳就是图片的盒子），直接换算成自然像素即可
  const r = img.getBoundingClientRect() // 显示尺寸
  const scaleX = natural.value.w / r.width
  const scaleY = natural.value.h / r.height
  const sx = Math.max(0, selBox.x * scaleX)
  const sy = Math.max(0, selBox.y * scaleY)
  const sw = selBox.w * scaleX
  const sh = selBox.h * scaleY
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  canvas.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
  insertImage(canvas.toDataURL('image/png'), sw, sh)
}

function insertFull() {
  if (!fullUrl.value) return
  insertImage(fullUrl.value, natural.value.w, natural.value.h)
}

/** 键盘：Esc 取消，Enter 确认选区（不框选时 = 整屏插入） */
function onKey(e: KeyboardEvent) {
  if (state.value !== 'ready') {
    if (e.key === 'Escape') void finish()
    return
  }
  if (e.key === 'Escape') { void finish(); return }
  if (e.key === 'Enter') {
    if (sel.value && sel.value.w >= 8 && sel.value.h >= 8) confirmCrop()
    else insertFull()
  }
}

onMounted(() => {
  capture()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  stopStream()
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="shot" :class="{ 'shot--full': native }" @click.self="finish()">
    <div class="shot__box">
      <header class="shot__head">
        <span>屏幕截图</span>
        <button class="shot__x" @click="finish()"><AppIcon name="close" :size="13" /></button>
      </header>

      <div v-if="state === 'loading'" class="shot__state">
        正在等待选择要捕获的屏幕/窗口…
        <div class="shot__err-sub">选好之后如果本窗口没有自动到前面，点一下本窗口即可继续。</div>
      </div>
      <div v-else-if="state === 'error'" class="shot__state shot__state--err">
        {{ err }}
        <div class="shot__err-sub">若浏览器拦截，请点击地址栏的「共享屏幕」/允许权限后重试。</div>
      </div>

      <template v-else>
        <div class="shot__stage" ref="stage" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp">
          <div ref="wrap" class="shot__wrap">
          <img ref="imageRef" :src="fullUrl" class="shot__img" draggable="false" alt="截图预览" />
          <div v-if="sel" class="shot__sel" :style="{ left: sel.x + 'px', top: sel.y + 'px', width: sel.w + 'px', height: sel.h + 'px' }">
            <span v-if="liveSize" class="shot__size">{{ liveSize }}</span>
          </div>
          </div>
        </div>
        <div v-if="native && (winList.length || desktopUrl)" class="shot__wins">
          <button class="shot__win" :class="{ 'shot__win--on': fullUrl === desktopUrl }" @click="backToDesktop()">
            <b>整个桌面</b><span>{{ desktopNatural.w }}×{{ desktopNatural.h }}</span>
          </button>
          <button
            v-for="w in winList" :key="w.id" class="shot__win"
            :class="{ 'shot__win--on': fullUrl !== desktopUrl && diag.includes(w.title) }"
            :title="w.title"
            @click="pickWindow(w.id)"
          >
            <b>{{ w.app || '窗口' }}</b><span>{{ w.title }} · {{ w.w }}×{{ w.h }}</span>
          </button>
        </div>
        <div v-if="needFocus" class="shot__focus" @click="tryFocus">
          浏览器没有自动把本窗口切到前台 —— 点一下本窗口（或点这里）就能框选了。
        </div>
        <div class="shot__bar">
          <span class="shot__hint">在画面上拖一下即完成截取；Enter 整屏插入，Esc 取消。<em v-if="diag" class="shot__diag">{{ diag }}</em></span>
          <div class="shot__actions">
            <button class="shot__btn" @click="finish()">取消</button>
            <button class="shot__btn" @click="insertFull">整屏插入</button>
            <button class="shot__btn shot__btn--primary" @click="confirmCrop">截取选区</button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.shot { position: fixed; inset: 0; z-index: 450; background: rgba(20, 24, 34, 0.6); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; }
.shot__box { background: #fff; border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: min(1000px, 94vw); max-height: 92vh; display: flex; flex-direction: column; overflow: hidden; }
.shot__head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); font-size: 15px; font-weight: 700; color: var(--text); }
.shot__x { border: none; background: transparent; font-size: 20px; cursor: pointer; color: var(--muted); }
.shot__x:hover { color: var(--text); }
.shot__state { padding: 48px 20px; text-align: center; color: var(--muted); font-size: 14px; }
.shot__state--err { color: var(--danger); }
.shot__err-sub { font-size: 12px; color: var(--muted); margin-top: 8px; }
.shot__stage {
  position: relative;
  margin: 12px 16px 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--gray-50);
  cursor: crosshair;
  user-select: none;
  display: flex;
  justify-content: center;
}
.shot__wrap { position: relative; display: inline-block; line-height: 0; }   /* 选区以它为基准 = 图片的盒子 */
.shot__img { display: block; max-width: 100%; max-height: 64vh; user-select: none; }
.shot__sel {
  position: absolute;
  border: 2px solid var(--brand);
  background: rgba(138, 43, 226, 0.16);
  box-shadow: 0 0 0 1px rgba(255,255,255,0.7) inset;
  pointer-events: none;
}
.shot__focus { margin: 8px 16px 0; padding: 8px 12px; border-radius: 7px; background: #fff6e5; border: 1px solid #f0d9a8; color: #8a6116; font-size: 12px; cursor: pointer; }
/* 桌面端"截屏覆盖"模式：铺满全屏、去掉窗口化的装饰，像 Word/PPT 那样直接在"桌面"上拖 */
.shot--full { background: #0b0d12; }
.shot--full .shot__box { width: 100vw; height: 100vh; max-width: none; border-radius: 0; box-shadow: none; display: flex; flex-direction: column; overflow: hidden; }
.shot--full .shot__head { display: none; }
.shot--full .shot__stage { flex: 1; margin: 0; border: 0; border-radius: 0; min-height: 0; }
.shot--full .shot__img { max-width: 100%; max-height: 100%; }
/* 全屏模式下这排按钮**不能浮在画面上** —— 否则画面最下面一条既被挡住、又点不到（框选不到）✗。
   改成占位：stage 用 flex:1 占满剩余高度，bar 自己占一行。 */
.shot--full .shot__bar { background: #141a24; border-top: 1px solid #232a36; box-shadow: none; padding: 10px 16px; }
.shot--full .shot__hint { color: #d7dbe6; }
.shot--full .shot__state { color: #cbd2e0; }
.shot--full .shot__focus { display: none; }
/* 可截窗口列表：被别的窗口挡住的窗口只能按窗口截，所以列出来让用户挑 */
.shot__wins { display: flex; gap: 6px; overflow-x: auto; padding: 6px 10px; background: #141a24; border-bottom: 1px solid #232a36; flex: 0 0 auto; }
.shot__win { flex: 0 0 auto; max-width: 240px; text-align: left; border: 1px solid #2c3542; background: #1b222d; color: #cbd3e0; border-radius: 6px; padding: 4px 8px; font-size: 11px; cursor: pointer; }
.shot__win:hover { background: #232c39; }
.shot__win--on { border-color: #1668e0; background: #17304f; color: #fff; }
.shot__win b { display: block; font-size: 10.5px; color: #8fa3c0; font-weight: 600; }
.shot__win span { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.shot__diag { display: block; margin-top: 2px; font-size: 10.5px; color: #9aa3b5; font-style: normal; }
.shot__size { position: absolute; right: 0; bottom: -20px; padding: 1px 6px; border-radius: 4px; background: rgba(20,24,34,.82); color: #fff; font-size: 11px; line-height: 1.5; white-space: nowrap; pointer-events: none; }
.shot__bar { display: flex; align-items: center; gap: 10px; padding: 12px 16px 14px; }
.shot__hint { font-size: 12px; color: var(--muted); flex: 1; }
.shot__actions { display: flex; gap: 8px; }
.shot__btn { border: 1px solid var(--border-strong); background: #fff; color: var(--text); border-radius: 7px; padding: 7px 14px; cursor: pointer; font-size: 13px; }
.shot__btn:hover { background: var(--gray-50); }
.shot__btn--primary { background: var(--brand); border-color: var(--brand); color: #fff; }
.shot__btn--primary:hover { background: var(--brand-strong); }
</style>
