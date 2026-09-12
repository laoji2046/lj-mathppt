<script setup lang="ts">
/** 图片转图形：把图片里的线稿识别成可编辑的数学图形元素。
 *
 *  识别是自动的（composables/vectorize），但结果总会有几个"落在直线上的冗余顶点"，
 *  所以这个弹窗的重点不是"识别"，而是**改**：看一眼叠加图，删掉多余的点 / 线，填上顶点字母，
 *  再插进页面。字默认摆在被抹掉的原字母位置上，所以填完就跟原图一样。 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { useDeckStore } from '@/stores/deck'
import type { SlideElement } from '@/types'
import { loadImageElement, vectorizeImage, type VectorizeResult } from '@/composables/vectorize'

const props = defineProps<{ src: string; replaceId?: string | null }>()
const emit = defineEmits<{ close: [] }>()
const store = useDeckStore()

const img = ref<HTMLImageElement | null>(null)
const stage = ref<HTMLElement | null>(null)
const busy = ref(false)
const err = ref('')

const res = ref<VectorizeResult | null>(null)
/** 识别结果的可编辑副本：pts 归一化顶点（相对识别框）、edges [起,止,虚线] */
const pts = ref<number[]>([])
const edges = ref<[number, number, number][]>([])
const labels = ref<string[]>([])
/** 字母相对顶点的偏移（识别框归一化坐标）—— 默认取被抹掉的原字母位置 */
const offs = ref<{ dx: number; dy: number }[]>([])
const selV = ref<number | null>(null)
const selE = ref<number | null>(null)

const scale = ref(1)
const viewW = computed(() => Math.round((img.value?.naturalWidth || 300) * scale.value))
const viewH = computed(() => Math.round((img.value?.naturalHeight || 200) * scale.value))
const nVerts = computed(() => pts.value.length / 2)

// 裁剪：拖动框选识别范围
const cropping = ref(false)
const drag = ref<{ x: number; y: number; w: number; h: number } | null>(null)
const dragStart = ref<{ x: number; y: number } | null>(null)

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
  const n = pts.value.length / 2
  labels.value = new Array(n).fill('')
  const taken = new Array(r.anchors.length).fill(false)
  const out: { dx: number; dy: number }[] = []
  // 先算出每个顶点的重心方向，作为"附近没有原字母"时的兜底
  let cx = 0, cy = 0
  for (let i = 0; i < n; i++) { cx += pts.value[i * 2]; cy += pts.value[i * 2 + 1] }
  cx /= n || 1; cy /= n || 1
  for (let i = 0; i < n; i++) {
    const vx = pts.value[i * 2], vy = pts.value[i * 2 + 1]
    let best = -1, bd = 0.16
    for (let k = 0; k < r.anchors.length; k++) {
      if (taken[k]) continue
      const d = Math.hypot(r.anchors[k].x - vx, r.anchors[k].y - vy)
      if (d < bd) { bd = d; best = k }
    }
    if (best >= 0) {
      taken[best] = true
      out.push({ dx: r.anchors[best].x - vx, dy: r.anchors[best].y - vy })
    } else {
      const ux = vx - cx, uy = vy - cy
      const L = Math.hypot(ux, uy)
      if (L < 1e-6) out.push({ dx: 0, dy: 0 })
      else out.push({ dx: (ux / L) * 0.06 * (r.W / r.H > 1 ? 1 : 0.8), dy: (uy / L) * 0.06 })
    }
  }
  offs.value = out
}

async function run(crop?: [number, number, number, number] | null) {
  const im = img.value
  if (!im) return
  busy.value = true
  err.value = ''
  await new Promise((r) => setTimeout(r, 30))   // 让"识别中"先画出来
  try {
    const r = vectorizeImage(im, crop ? { crop } : {})
    if (!r.stats.verts) throw new Error('没认出来东西 —— 可能不是线稿（灰度图 / 照片都不行）')
    res.value = r
    adopt(r)
    selV.value = null
    selE.value = null
  } catch (e) {
    err.value = (e as Error)?.message || String(e)
  } finally {
    busy.value = false
  }
}

function onDown(e: PointerEvent) {
  if (!cropping.value) return
  const r = stage.value?.getBoundingClientRect()
  if (!r) return
  dragStart.value = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  drag.value = { x: dragStart.value.x, y: dragStart.value.y, w: 0, h: 0 }
}
function onMove(e: PointerEvent) {
  if (!cropping.value || !dragStart.value) return
  const r = stage.value?.getBoundingClientRect()
  if (!r) return
  const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height
  drag.value = {
    x: Math.min(dragStart.value.x, x), y: Math.min(dragStart.value.y, y),
    w: Math.abs(x - dragStart.value.x), h: Math.abs(y - dragStart.value.y),
  }
}
function onUp() {
  if (!cropping.value || !drag.value) return
  const d = drag.value
  dragStart.value = null
  cropping.value = false
  if (d.w < 0.05 || d.h < 0.05 || !img.value) { drag.value = null; return }
  const iw = img.value.naturalWidth, ih = img.value.naturalHeight
  drag.value = null
  run([Math.round(d.x * iw), Math.round(d.y * ih), Math.round((d.x + d.w) * iw), Math.round((d.y + d.h) * ih)])
}

function finishRemove(i: number) {
  pts.value.splice(i * 2, 2)
  labels.value.splice(i, 1)
  offs.value.splice(i, 1)
  selV.value = null
  selE.value = null
}
/** 删掉第 i 个顶点并重编号 */
function delVertex(i: number) {
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
      finishRemove(i)
      return
    }
  }
  edges.value = keep(edges.value)
  finishRemove(i)
}
function delEdge(i: number) {
  edges.value.splice(i, 1)
  selE.value = null
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { emit('close'); return }
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selV.value !== null) { e.preventDefault(); delVertex(selV.value) }
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
  const labelOffsets = offs.value.map((o) => ({
    dx: +((o.dx * cw) / iw).toFixed(4),
    dy: +((o.dy * ch) / ih + 12 / h).toFixed(4),
  }))
  return {
    w, h,
    kind: iw / ih > 1.05 ? 'pyramid' : 'cube',
    points: full,
    mesh: { edges: edges.value.map((e) => [e[0], e[1], e[2]] as [number, number, number]), faces: [] },
    vlabels: labels.value.map((s) => (s.trim() ? s.trim() : null)),
    labelOffsets,
    fill: 'transparent',
    stroke: '#1a1a1a',
    strokeWidth: 2.8,
  } as Partial<SlideElement>
}

function insert() {
  const patch = buildPatch()
  if (!patch) return
  const src = props.replaceId ? store.currentSlide?.elements.find((e) => e.id === props.replaceId) : undefined
  if (src) {
    store.addElement('mathfig', { ...patch, x: src.x, y: src.y } as Partial<SlideElement>)
    store.removeElement(src.id)
  } else {
    store.addElement('mathfig', patch)
  }
  emit('close')
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  try {
    const im = await loadImageElement(props.src)
    img.value = im
    scale.value = Math.min(560 / im.naturalWidth, 450 / im.naturalHeight, 2)
    await nextTick()
    await run(null)
  } catch (e) {
    err.value = (e as Error)?.message || String(e)
  }
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="vd" @mousedown.self="emit('close')">
    <div class="vd__box">
      <header class="vd__head">
        <div class="vd__title"><span class="vd__badge">✎</span> 图片转图形</div>
        <button class="vd__close" @click="emit('close')"><AppIcon name="close" :size="13" /></button>
      </header>

      <div class="vd__body">
        <div class="vd__left">
          <div
            ref="stage"
            class="vd__stage"
            :class="{ 'vd__stage--crop': cropping }"
            :style="{ width: viewW + 'px', height: viewH + 'px' }"
            @pointerdown="onDown"
            @pointermove="onMove"
            @pointerup="onUp"
          >
            <img class="vd__img" :src="props.src" :width="viewW" :height="viewH" draggable="false" alt="">
            <svg class="vd__ov" :width="viewW" :height="viewH">
              <g v-for="(e, i) in edges" :key="'e' + i">
                <line
                  :x1="ex(i)[0]" :y1="ex(i)[1]" :x2="ex(i)[2]" :y2="ex(i)[3]"
                  stroke="transparent" stroke-width="11" style="cursor:pointer"
                  @click="selE = i; selV = null"
                />
                <line
                  :x1="ex(i)[0]" :y1="ex(i)[1]" :x2="ex(i)[2]" :y2="ex(i)[3]"
                  :stroke="selE === i ? '#ff8f1f' : '#1668e0'"
                  :stroke-width="selE === i ? 3.6 : 2.2"
                  :stroke-dasharray="e[2] ? '6 5' : ''"
                  stroke-linecap="round"
                />
              </g>
              <g v-for="i in nVerts" :key="'v' + (i - 1)">
                <circle
                  :cx="px(i - 1)" :cy="py(i - 1)" r="9" fill="transparent" style="cursor:pointer"
                  @click="selV = i - 1; selE = null"
                />
                <circle
                  :cx="px(i - 1)" :cy="py(i - 1)" r="4.5"
                  :fill="selV === i - 1 ? '#ff8f1f' : '#e02020'" stroke="#fff" stroke-width="1.2"
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
            <div v-if="busy" class="vd__busy">识别中…</div>
          </div>
          <p class="vd__hint">
            {{ cropping
              ? '在图上拖一个框，松开后按这个范围重新识别（用来切掉下方的「图 1」这类题注）'
              : '点顶点选中 → Delete 删掉；只连一条线的点会**并到最近的顶点**上（线不会丢）；点线选中 → Delete 删掉多余的线' }}
          </p>
        </div>

        <div class="vd__right">
          <div v-if="err" class="vd__err">{{ err }}</div>
          <template v-else-if="res">
            <div class="vd__stat">
              顶点 <b>{{ nVerts }}</b> · 边 <b>{{ edges.length }}</b> · 虚线 <b>{{ edges.filter((e) => e[2]).length }}</b>
            </div>
            <div class="vd__row">
              <button class="vd__btn" :class="{ 'vd__btn--on': cropping }" @click="cropping = !cropping">框选识别范围</button>
              <button class="vd__btn" :disabled="busy" @click="run(null)">整图重识别</button>
            </div>
            <div class="vd__label">顶点字母（{{ selV !== null ? '已选 ' + selV : '点画布上的点选中' }}）</div>
            <div class="vd__list">
              <div v-for="i in nVerts" :key="'l' + (i - 1)" class="vd__item" :class="{ 'vd__item--on': selV === i - 1 }">
                <span class="vd__idx" @click="selV = i - 1; selE = null">{{ i - 1 }}</span>
                <input v-model="labels[i - 1]" class="vd__input" placeholder="如 A / A_1" @focus="selV = i - 1; selE = null">
                <button class="vd__del" title="删掉这个顶点（只连一条线的点会并到最近的顶点上，线不会丢）" @click="delVertex(i - 1)">
                  <AppIcon name="trash" :size="13" />
                </button>
              </div>
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
        <button v-if="props.replaceId" class="vd__btn" :disabled="!res || busy" @click="insert()">插入为新图形</button>
        <button class="vd__btn vd__btn--primary" :disabled="!res || busy" @click="insert()">
          {{ props.replaceId ? '替换这张图片' : '插入当前页' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.vd { position: fixed; inset: 0; z-index: 500; background: rgba(20, 24, 34, 0.55); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; }
.vd__box { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: 92vw; max-width: 1000px; max-height: 92vh; display: flex; flex-direction: column; overflow: hidden; }
.vd__head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--border); }
.vd__title { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: var(--text); }
.vd__badge { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: var(--radius-sm); background: var(--brand-soft); color: var(--brand-800); font-size: 13px; }
.vd__close { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; cursor: pointer; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--gray-600); }
.vd__close:hover { background: var(--danger-soft); border-color: var(--danger-border); color: var(--danger); }
.vd__body { display: flex; gap: 14px; padding: 14px; overflow: auto; }
.vd__left { flex: none; }
.vd__stage { position: relative; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); overflow: hidden; background: #fff; touch-action: none; }
.vd__stage--crop { cursor: crosshair; }
.vd__img { display: block; user-select: none; }
.vd__ov { position: absolute; left: 0; top: 0; }
.vd__drag { position: absolute; border: 1px dashed var(--brand-600); background: rgba(90, 120, 240, 0.12); pointer-events: none; }
.vd__busy { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(255, 255, 255, 0.72); font-size: 13px; color: var(--muted); }
.vd__hint { margin: 8px 0 0; font-size: 12px; color: var(--muted); max-width: 560px; line-height: 1.5; }
.vd__right { flex: 1; min-width: 260px; display: flex; flex-direction: column; gap: 8px; }
.vd__stat { font-size: 13px; color: var(--muted); }
.vd__stat b { color: var(--text); }
.vd__row { display: flex; gap: 6px; flex-wrap: wrap; }
.vd__btn { padding: 6px 12px; font-size: 13px; cursor: pointer; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--gray-700); transition: background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease); }
.vd__btn:hover:not(:disabled) { background: var(--brand-soft); border-color: var(--brand-400); color: var(--brand-800); }
.vd__btn:disabled { opacity: 0.45; cursor: not-allowed; }
.vd__btn--on { background: var(--brand-600); border-color: var(--brand-600); color: #fff; }
.vd__btn--primary { background: var(--brand-600); border-color: var(--brand-600); color: #fff; font-weight: 600; }
.vd__btn--danger { border-color: var(--danger-border); color: var(--danger); }
.vd__label { font-size: 12px; color: var(--muted); margin-top: 2px; }
.vd__list { flex: 1; min-height: 90px; max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; padding-right: 4px; }
.vd__item { display: flex; align-items: center; gap: 6px; padding: 2px 4px; border-radius: var(--radius-sm); border: 1px solid transparent; }
.vd__item--on { background: var(--brand-soft); border-color: var(--brand-400); }
.vd__idx { width: 22px; text-align: center; font-size: 12px; color: var(--muted); cursor: pointer; flex: none; }
.vd__input { flex: 1; min-width: 0; padding: 4px 7px; font-size: 13px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: #fff; color: var(--text); }
.vd__input:focus { outline: none; border-color: var(--brand-400); box-shadow: 0 0 0 2px var(--brand-soft); }
.vd__del { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; flex: none; padding: 0; cursor: pointer; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--gray-600); }
.vd__del:hover { background: var(--danger-soft); border-color: var(--danger-border); color: var(--danger); }
.vd__tip { margin: 0; font-size: 12px; color: var(--gray-500); line-height: 1.5; }
.vd__err { font-size: 13px; color: var(--danger); background: var(--danger-soft); border: 1px solid var(--danger-border); border-radius: var(--radius-sm); padding: 8px 10px; line-height: 1.5; }
.vd__foot { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--border); background: var(--panel-2, #fafafd); }
</style>
