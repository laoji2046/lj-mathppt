<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { useDeckStore } from '@/stores/deck'
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

async function capture() {
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
function onUp() {
  selStart.value = null
}

function insertImage(url: string, nw: number, nh: number) {
  // 以合适尺寸插入（限制最大 900×620，保持比例）
  let w = nw || 640
  let h = nh || 400
  const f = Math.min(900 / w, 620 / h)
  if (f < 1) { w = Math.round(w * f); h = Math.round(h * f) }
  store.addElement('image', { src: url, w, h, fit: 'contain' } as Partial<SlideElement>)
  emit('close')
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

onMounted(capture)
onBeforeUnmount(stopStream)
</script>

<template>
  <div class="shot" @click.self="emit('close')">
    <div class="shot__box">
      <header class="shot__head">
        <span>屏幕截图</span>
        <button class="shot__x" @click="emit('close')"><AppIcon name="close" :size="13" /></button>
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
          <div v-if="sel" class="shot__sel" :style="{ left: sel.x + 'px', top: sel.y + 'px', width: sel.w + 'px', height: sel.h + 'px' }"></div>
          </div>
        </div>
        <div v-if="needFocus" class="shot__focus" @click="tryFocus">
          浏览器没有自动把本窗口切到前台 —— 点一下本窗口（或点这里）就能框选了。
        </div>
        <div class="shot__bar">
          <span class="shot__hint">在画面上拖拽框选要截取的区域；不框选则整屏插入。</span>
          <div class="shot__actions">
            <button class="shot__btn" @click="emit('close')">取消</button>
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
.shot__bar { display: flex; align-items: center; gap: 10px; padding: 12px 16px 14px; }
.shot__hint { font-size: 12px; color: var(--muted); flex: 1; }
.shot__actions { display: flex; gap: 8px; }
.shot__btn { border: 1px solid var(--border-strong); background: #fff; color: var(--text); border-radius: 7px; padding: 7px 14px; cursor: pointer; font-size: 13px; }
.shot__btn:hover { background: var(--gray-50); }
.shot__btn--primary { background: var(--brand); border-color: var(--brand); color: #fff; }
.shot__btn--primary:hover { background: var(--brand-strong); }
</style>
