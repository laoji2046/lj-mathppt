<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDeckStore } from '@/stores/deck'
import type { SlideElement } from '@/types'

const store = useDeckStore()
const emit = defineEmits<{ close: [] }>()
const props = defineProps<{ id: string }>()

const canvas = ref<HTMLCanvasElement | null>(null)
const box = ref<HTMLElement | null>(null)
const img = ref<HTMLImageElement | null>(null)
const loadErr = ref('')

const angle = ref(0)
const flipH = ref(false)
const flipV = ref(false)
const bright = ref(1)
const contrast = ref(1)
const saturate = ref(1)
const blurV = ref(0)
const gray = ref(0)
const cropping = ref(false)
const crop = ref<{ x: number; y: number; w: number; h: number } | null>(null)
const cropStart = ref<{ x: number; y: number } | null>(null)

const imageEl = computed(() => {
  const el = store.currentSlide?.elements.find((e) => e.id === props.id)
  return el && el.type === 'image' ? (el as any) : undefined
})

const swap = computed(() => (angle.value % 180) !== 0)
const outW = computed(() => { const w = img.value?.naturalWidth || 1, h = img.value?.naturalHeight || 1; return swap.value ? h : w })
const outH = computed(() => { const w = img.value?.naturalWidth || 1, h = img.value?.naturalHeight || 1; return swap.value ? w : h })

function filterStr() {
  let f = 'brightness(' + bright.value + ') contrast(' + contrast.value + ') saturate(' + saturate.value + ')'
  if (blurV.value) f += ' blur(' + blurV.value + 'px)'
  if (gray.value) f += ' grayscale(' + gray.value + ')'
  return f
}

function render() {
  const cv = canvas.value, im = img.value
  if (!cv || !im) return
  const w = outW.value, h = outH.value
  cv.width = w; cv.height = h
  const ctx = cv.getContext('2d')
  if (!ctx) return
  ctx.save()
  ctx.filter = filterStr()
  ctx.translate(w / 2, h / 2)
  ctx.rotate((angle.value * Math.PI) / 180)
  ctx.scale(flipH.value ? -1 : 1, flipV.value ? -1 : 1)
  ctx.drawImage(im, -im.naturalWidth / 2, -im.naturalHeight / 2)
  ctx.restore()
}

function load() {
  const src = imageEl.value?.src
  if (!src) { loadErr.value = '未找到图片地址'; return }
  const im = new Image()
  im.crossOrigin = 'anonymous'
  im.onload = () => { img.value = im; nextTick(render) }
  im.onerror = () => { loadErr.value = '图片加载失败（可能是跨域，请用本地图片）' }
  im.src = src
}

function rot90(d: number) { angle.value = ((angle.value + d) % 360 + 360) % 360; render() }
function onFlip(mode: 'h' | 'v') { if (mode === 'h') flipH.value = !flipH.value; else flipV.value = !flipV.value; render() }

function onBoxDown(e: PointerEvent) {
  if (!cropping.value) return
  const r = canvas.value?.getBoundingClientRect()
  if (!r) return
  cropStart.value = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
}
function onBoxMove(e: PointerEvent) {
  if (!cropping.value || !cropStart.value) return
  const r = canvas.value?.getBoundingClientRect()
  if (!r) return
  const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height
  crop.value = { x: Math.min(cropStart.value.x, x), y: Math.min(cropStart.value.y, y), w: Math.abs(x - cropStart.value.x), h: Math.abs(y - cropStart.value.y) }
}
function onBoxUp() { cropStart.value = null }

watch([angle, flipH, flipV, bright, contrast, saturate, blurV, gray], render)

function reset() {
  angle.value = 0; flipH.value = false; flipV.value = false
  bright.value = 1; contrast.value = 1; saturate.value = 1; blurV.value = 0; gray.value = 0
  crop.value = null; cropping.value = false
}

function apply() {
  const im = img.value, cv = canvas.value
  if (!im || !cv || !imageEl.value) return
  let out: HTMLCanvasElement = cv
  try {
    if (crop.value && crop.value.w > 0.01 && crop.value.h > 0.01) {
      out = document.createElement('canvas')
      const sx = crop.value.x * cv.width, sy = crop.value.y * cv.height
      const sw = crop.value.w * cv.width, sh = crop.value.h * cv.height
      out.width = Math.max(1, Math.round(sw)); out.height = Math.max(1, Math.round(sh))
      const c = out.getContext('2d')
      if (!c) return
      c.drawImage(cv, sx, sy, sw, sh, 0, 0, out.width, out.height)
    }
    const url = out.toDataURL('image/png')
    store.updateElement(imageEl.value.id, { src: url } as Partial<SlideElement>)
    emit('close')
  } catch (e) {
    loadErr.value = '导出失败：' + ((e as Error)?.message || String(e)) + '（跨域图片无法导出，请用本地图片）'
  }
}

function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }
onMounted(() => { load(); window.addEventListener('keydown', onKey) })
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="ie" @mousedown.self="emit('close')">
    <div class="ie__box">
      <header class="ie__head">
        <div class="ie__title"><span class="ie__badge">✂</span> 图片编辑器</div>
        <button class="ie__close" @click="emit('close')">✕</button>
      </header>
      <div class="ie__body">
        <div class="ie__left">
          <div ref="box" class="ie__canvaswrap" :class="{ 'ie__canvaswrap--crop': cropping }">
            <canvas ref="canvas" class="ie__canvas" @pointerdown="onBoxDown" @pointermove="onBoxMove" @pointerup="onBoxUp"></canvas>
            <div v-if="crop" class="ie__cropbox" :style="{ left: (crop.x * 100) + '%', top: (crop.y * 100) + '%', width: (crop.w * 100) + '%', height: (crop.h * 100) + '%' }"></div>
            <div v-if="loadErr" class="ie__err">{{ loadErr }}</div>
          </div>
          <p class="ie__hint">{{ cropping ? '拖动裁剪区域，松开确定；点「应用」裁切' : '画布实时预览；右下角可缩放？用「应用」保存修改' }}</p>
        </div>
        <div class="ie__right">
          <div class="ie__group">
            <div class="ie__label">旋转 / 翻转</div>
            <div class="ie__row">
              <button class="ie__btn" @click="rot90(-90)">⟲ 左转90°</button>
              <button class="ie__btn" @click="rot90(90)">⟳ 右转90°</button>
              <button class="ie__btn" :class="{ 'ie__btn--on': flipH }" @click="onFlip('h')">⇆ 水平翻转</button>
              <button class="ie__btn" :class="{ 'ie__btn--on': flipV }" @click="onFlip('v')">⇅ 垂直翻转</button>
            </div>
          </div>
          <div class="ie__group">
            <div class="ie__label">裁剪</div>
            <div class="ie__row">
              <button class="ie__btn" :class="{ 'ie__btn--on': cropping }" @click="cropping = !cropping">{{ cropping ? '裁剪中…（拖动预览区域）' : '开启裁剪' }}</button>
              <button class="ie__btn" :disabled="!crop" @click="crop = null">清除裁剪</button>
            </div>
          </div>
          <div class="ie__group">
            <div class="ie__label">滤镜</div>
            <label class="ie__slider"><span>亮度</span><input type="range" min="0" max="2" step="0.05" v-model.number="bright" /><b>{{ Math.round(bright * 100) }}%</b></label>
            <label class="ie__slider"><span>对比度</span><input type="range" min="0" max="2" step="0.05" v-model.number="contrast" /><b>{{ Math.round(contrast * 100) }}%</b></label>
            <label class="ie__slider"><span>饱和度</span><input type="range" min="0" max="2" step="0.05" v-model.number="saturate" /><b>{{ Math.round(saturate * 100) }}%</b></label>
            <label class="ie__slider"><span>模糊</span><input type="range" min="0" max="12" step="0.5" v-model.number="blurV" /><b>{{ blurV }}px</b></label>
            <label class="ie__slider"><span>灰度</span><input type="range" min="0" max="1" step="0.05" v-model.number="gray" /><b>{{ Math.round(gray * 100) }}%</b></label>
          </div>
          <button class="ie__reset" @click="reset">重置全部</button>
        </div>
      </div>
      <footer class="ie__foot">
        <button class="ie__btn" @click="emit('close')">取消</button>
        <button class="ie__apply" @click="apply">应用并替换图片</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.ie { position: fixed; inset: 0; z-index: 2100; background: rgba(20, 24, 34, 0.55); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; }
.ie__box { width: min(880px, 95vw); max-height: 92vh; display: flex; flex-direction: column; background: #fff; border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); overflow: hidden; }
.ie__head { display: flex; align-items: center; justify-content: space-between; padding: 13px 18px; border-bottom: 1px solid var(--border); font-size: 15px; color: var(--text); }
.ie__title { display: flex; align-items: center; gap: 8px; }
.ie__badge { width: 28px; height: 28px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; background: linear-gradient(135deg,var(--brand),#4b6cf0); color: #fff; }
.ie__close { width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--border); background: #fff; cursor: pointer; color: var(--muted); }
.ie__close:hover { background: var(--gray-50); }
.ie__body { flex: 1; min-height: 0; display: flex; gap: 14px; padding: 14px 18px; overflow: auto; }
.ie__left { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.ie__canvaswrap { position: relative; flex: 1; min-height: 260px; background: #1b1b22; border-radius: 10px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.ie__canvaswrap--crop { cursor: crosshair; }
.ie__canvas { max-width: 100%; max-height: 100%; }
.ie__cropbox { position: absolute; border: 1.5px dashed var(--brand-600); background: rgba(106,82,200,0.15); box-sizing: border-box; pointer-events: none; }
.ie__err { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 12px; text-align: center; color: #ffd9d9; background: rgba(60,10,10,0.5); font-size: 13px; }
.ie__hint { font-size: 12px; color: var(--muted); margin: 0; }
.ie__right { flex: 0 0 320px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto; }
.ie__group { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; }
.ie__label { font-size: 12px; color: var(--muted); font-weight: 600; margin-bottom: 8px; }
.ie__row { display: flex; flex-wrap: wrap; gap: 6px; }
.ie__btn { padding: 6px 10px; border: 1px solid var(--border-strong); background: #fff; border-radius: 7px; font-size: 12px; color: var(--muted); cursor: pointer; transition: background .12s; }
.ie__btn:hover { background: var(--gray-50); }
.ie__btn--on { background: var(--brand-600); border-color: var(--brand-600); color: #fff; }
.ie__btn:disabled { opacity: .4; cursor: not-allowed; }
.ie__slider { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 12px; color: var(--muted); }
.ie__slider span { width: 52px; }
.ie__slider input { flex: 1; accent-color: var(--brand-600); }
.ie__slider b { width: 42px; text-align: right; font-weight: 600; }
.ie__reset { padding: 6px 10px; border: 1px solid var(--border-strong); background: #fff; border-radius: 7px; font-size: 12px; color: var(--muted); cursor: pointer; }
.ie__foot { display: flex; justify-content: flex-end; align-items: center; gap: 8px; border-top: 1px solid var(--border); padding: 11px 18px; }
.ie__apply { padding: 8px 18px; border: none; border-radius: 8px; background: var(--brand-600); color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; }
.ie__apply:hover { background: var(--brand-700); }
</style>
