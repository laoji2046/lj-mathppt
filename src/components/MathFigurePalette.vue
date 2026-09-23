<script setup lang="ts">
/** 数学图形面板：分类页签 + 卡片缩略图（缩略图直接用元素组件渲染，所见即所得） */
import { computed, nextTick, onMounted, ref } from 'vue'
import { listFigures, removeFigure, touchFigure } from '@/composables/useFigureLibrary'
import type { FigureEntry } from '@/composables/useFigureLibrary'
import AppIcon from './AppIcon.vue'
import { useDeckStore } from '@/stores/deck'
import type { MathFigureCat, MathFigureElement, MathFigureKind, SlideElement } from '@/types'
import { createElement, MATH_FIGURE_CATS, MATH_FIGURE_OPTIONS } from '@/types'
import { DEFAULT_PIECEWISE, figureBox, viewAspect } from '@/composables/mathPlot'
import { THM_LABELS } from '@/composables/solid3d'
import { SOLID_FIGURE_PRESETS } from '@/templates/solidFigures'
import { openVectorize } from '@/ui/vectorize'
import { openGeom3D } from '@/ui/geom3d'
import { closeFigPalette, figPaletteSink } from '@/ui/figPalette'
import FigurePreview from './elements/MathFigureElement.vue'

const store = useDeckStore()
const emit = defineEmits<{ (e: 'close'): void }>()

/** 图形重建：从原图逐个描下来的立体几何图，插入后仍是可编辑的矢量图形 */
const RECAST = '图形重建' as MathFigureCat

const groups = computed(() => MATH_FIGURE_CATS.map((c) => ({
  cat: c,
  list: MATH_FIGURE_OPTIONS.filter((f) => f.cat === c),
})).filter((g) => g.list.length || g.cat === RECAST))

/** 默认停在「函数图像」：备课里用得最多 */
const cat = ref<MathFigureCat>('函数图像')
const current = computed(() => groups.value.find((g) => g.cat === cat.value) ?? groups.value[0])

/**
 * 缩略图用的"假元素"：
 * - 有数学视图（函数 / 圆锥曲线）的，按视图宽高比给框，配合 fit="contain" 等比缩放起来不歪；
 * - 平面 / 立体 / 标注类本来就是按框自适应画的，直接用 140×80 + 默认拉伸。
 */
const PV_H = 80
function previewEl(kind: MathFigureKind) {
  const a = viewAspect(kind)
  return {
    id: 'pv_' + kind, type: 'mathfig', x: 0, y: 0, rot: 0,
    w: a ? Math.round(PV_H * a) : 140, h: PV_H,
    kind, fill: 'transparent', stroke: '#3b3b46', strokeWidth: 2.6,
  } as any
}
function previewFit(kind: MathFigureKind): 'stretch' | 'contain' {
  return viewAspect(kind) ? 'contain' : 'stretch'
}

/** 插入（或按"真元素"渲染供 PDF 用）时每个 kind 要带的**额外字段**。
 *  ⚠ 以前这份默认值在这里写了两遍（insert 与 realElOfKind 各一份）——
 *     加了新 kind 只改一处，画布插入的元素就**少了配置**（面板靠兜底默认值才没露馅）✗。
 *     现在两个入口共用这一份。 */
function extraOfKind(kind: MathFigureKind): Record<string, unknown> {
  if (kind === 'custom') {
    return { custom: { expr: 'x^2-2x+1', x0: -2, x1: 4, y0: -2, y1: 6, grid: true, axes: true }, w: 420, h: 300 }
  }
  if (kind === 'piecewiseFn') {
    // 分段函数：默认给"经典两段"（x² 在 x<0、x+1 在 x≥0），线条数据要**深拷一份**，
    // 否则改一个元素的段会顺手改掉 DEFAULT_PIECEWISE，后面插入的都跟着变 ✗
    return { pw: { ...DEFAULT_PIECEWISE, lines: DEFAULT_PIECEWISE.lines.map((l) => ({ ...l })) }, w: 440, h: 300 }
  }
  if (kind === 'normal') return { w: 460, h: 300 }
  // 必修二定理图形：插进来就带默认字母（α、β、a、b、l、m），并且给个宽一点的框
  const thm = THM_LABELS[kind as string]
  if (thm) return { vlabels: [...thm], w: 420, h: 260 }
  return {}
}

/** 面板里每张卡片自己的图形名（给"插入到 PDF 文档"当图注用） */
function labelOf(kind: MathFigureKind): string {
  return MATH_FIGURE_OPTIONS.find((o) => o.v === kind)?.label || String(kind)
}
/**
 * 点卡片：设了 sink（PDF 文档正开着）就把**卡片自己那张 SVG** 交出去，
 * 由调用方栅格化插进文档 —— 不用先放到画布上；否则按老规矩插到画布。
 */
/**
 * 交给 sink 之前，**用"真正插入时会创建的那个元素"在屏幕外渲染一份**，抓它的 SVG。
 *
 * 为什么不直接抓卡片那张 ✗：卡片是**预览版**——viewBox 只有几十宽、线宽也另设（2.6），
 * 而真正插进画布的元素的 viewBox 是 520/824 这种真实尺寸、线宽 3.0。
 * 两者不是一套参数，靠比例去"缩线宽"永远对不上（用户来回反馈了三次）。
 * 直接按真元素渲染，就和"从页面插入"**完全同源**了 —— 那条路用户说很美观。
 */
const hiddenEl = ref<MathFigureElement | null>(null)
const hiddenBox = ref({ w: 0, h: 0 })
const hiddenRef = ref<HTMLElement | null>(null)

async function grabByRealRender(e: SlideElement): Promise<SVGSVGElement | null> {
  hiddenEl.value = e as MathFigureElement
  hiddenBox.value = { w: e.w, h: e.h }
  await nextTick()
  // 再等一帧：图形组件里有 computed 尺寸，确保 svg 已就位
  await new Promise((r) => requestAnimationFrame(() => r(null)))
  const svg = hiddenRef.value?.querySelector('svg') as SVGSVGElement | null
  const copy = svg ? (svg.cloneNode(true) as SVGSVGElement) : null
  hiddenEl.value = null
  return copy
}

/** 按"真正插入"的参数造元素（kind 与复刻图各一条） */
function realElOfKind(kind: MathFigureKind): SlideElement {
  const extra = extraOfKind(kind)
  const el = createElement('mathfig', { x: 0, y: 0 })
  Object.assign(el, { kind, ...(figureBox(kind) || {}), ...extra })
  return el
}
function realElOfPreset(p: (typeof SOLID_FIGURE_PRESETS)[number]): SlideElement {
  const el = createElement('mathfig', { x: 0, y: 0 })
  Object.assign(el, { ...p.el, w: p.w, h: p.h, fill: 'transparent', stroke: '#1a1a1a', strokeWidth: 2.8 })
  return el
}

async function onPick(kind: MathFigureKind) {
  const sink = figPaletteSink.value
  if (!sink) {
    insert(kind)
    return
  }
  const svg = await grabByRealRender(realElOfKind(kind))
  if (svg) sink(svg, labelOf(kind), kind)
  else insert(kind)
  closeFigPalette()
  emit('close')
}

/** 插入尺寸：函数 / 圆锥曲线按视图宽高比给（圆才会是圆），其余用元素默认值 */
function insert(kind: MathFigureKind) {
  const box = figureBox(kind)
  // C 方案：正态密度曲线给固定框 460x300 ✓（照 custom 的先例 ✓）
  //   它的视图宽高比约 5:0.5 ✓ → figureBox 被 minH 顶成极宽极矮的元素 ✗
  //   曲线忠实画进去就显扁 ✓。固定后竖直方向略作夸张 ✓ 接近教科书示意 ✓。
  const extra = extraOfKind(kind)
  store.addElement('mathfig', { kind, ...(box || {}), ...extra } as any)
  emit('close')
}

/** 复刻图：连同顶点 / 边拓扑 / 字母一起插入，并按原图宽高比给尺寸 */
/** 图形重建的卡片走同一条"交给 sink"的路（原来只会在画布上插入 ✗ —— 文档里点它没反应） */
async function onPickPreset(p: (typeof SOLID_FIGURE_PRESETS)[number]) {
  const sink = figPaletteSink.value
  if (!sink) {
    insertPreset(p)
    return
  }
  const svg = await grabByRealRender(realElOfPreset(p))
  if (svg) sink(svg, p.name, p.name)
  else insertPreset(p)
  closeFigPalette()
  emit('close')
}

function insertPreset(p: (typeof SOLID_FIGURE_PRESETS)[number]) {
  store.addElement('mathfig', {
    ...p.el,
    w: p.w,
    h: p.h,
    fill: 'transparent',
    stroke: '#1a1a1a',
    strokeWidth: 2.8,
  } as any)
  emit('close')
}

/** 复刻图缩略图用的"假元素"（按卡片等比缩放，不拉变形） */
function presetPreview(p: (typeof SOLID_FIGURE_PRESETS)[number]) {
  return {
    id: 'pv_' + p.id, type: 'mathfig', x: 0, y: 0, rot: 0,
    ...p.el,
    w: p.w, h: p.h,
    fill: 'transparent', stroke: '#3b3b46', strokeWidth: 2.6,
  } as any
}
/** ---- 我的图形（第三期图形库）：存下的「种类 + 参数」，一键插回；插进去仍然可调参数 ---- */
const myFigures = ref<FigureEntry[]>([])
async function loadMyFigures() {
  try { myFigures.value = await listFigures() } catch { myFigures.value = [] }
}
onMounted(loadMyFigures)
/** 用存下来的配置重建一个 mathfig 元素 */
function insertSaved(f: FigureEntry) {
  store.addElement('mathfig', { kind: f.kind, ...f.cfg } as any)
  void touchFigure(f.id)
  emit('close')
}
async function delSaved(f: FigureEntry) {
  await removeFigure(f.id)
  await loadMyFigures()
}

const THUMB_W = 108
const THUMB_H = 108

/** 从图片复刻：选一张线稿，转到「图片转图形」弹窗里识别 + 改 */
const fileInput = ref<HTMLInputElement | null>(null)
function pickImage() { fileInput.value?.click() }
function onPicked(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files && input.files[0]
  input.value = ''
  if (!f) return
  const r = new FileReader()
  r.onload = () => { openVectorize(String(r.result || '')); emit('close') }
  r.readAsDataURL(f)
}
/** 缩略图里把原始尺寸等比缩到卡片内 */
function recastScale(p: (typeof SOLID_FIGURE_PRESETS)[number]) {
  return Math.min(THUMB_W / p.w, THUMB_H / p.h)
}
</script>

<template>
  <div class="palette" @click.self="emit('close')">
    <div class="palette__box">
      <div class="palette__head">
        <span>数学图形 <em>{{ MATH_FIGURE_OPTIONS.length }} 种</em></span>
        <button class="palette__close" @click="emit('close')"><AppIcon name="close" :size="13" /></button>
      </div>

      <div class="palette__tabs">
        <button
          v-for="g in groups"
          :key="g.cat"
          class="tab"
          :class="{ 'tab--on': current && current.cat === g.cat }"
          @click="cat = g.cat"
        >
          {{ g.cat }}<em>{{ g.cat === RECAST ? SOLID_FIGURE_PRESETS.length : g.list.length }}</em>
        </button>
      </div>

      <div v-if="myFigures.length" class="palette__mine">
        <span class="palette__minet">我的图形</span>
        <button v-for="f in myFigures" :key="f.id" class="mine" :title="'插入：' + f.title" @click="insertSaved(f)">
          {{ f.title }}<em class="mine__x" title="从图形库删除" @click.stop="delSaved(f)">×</em>
        </button>
      </div>

      <div class="palette__grid">
        <template v-if="current && current.cat === RECAST">
          <button class="card card--recast card--pick" title="选一张线稿（几何插图 / 函数图），自动识别成可拖顶点的数学图形" @click="pickImage">
            <span class="card__thumb"><span class="recast__plus">＋</span></span>
            <span class="card__name">从图片复刻…</span>
          </button>
          <button
            class="card card--recast card--pick"
            title="给一份「顶点 + 面表」的三维几何描述（JSON），投影成图形 —— 虚实由面表算出来，不靠猜；还能导入截图描点反解视角"
            @click="openGeom3D(); emit('close')"
          >
            <span class="card__thumb"><span class="recast__plus">⬢</span></span>
            <span class="card__name">三维立体图…</span>
          </button>
          <button
            v-for="p in SOLID_FIGURE_PRESETS"
            :key="p.id"
            class="card card--recast"
            :title="p.note ? p.name + ' ｜ ' + p.note : p.name"
            @click="onPickPreset(p)"
          >
            <span class="card__thumb">
              <span
                class="recast"
                :style="{ width: p.w + 'px', height: p.h + 'px', transform: 'translate(-50%, -50%) scale(' + recastScale(p) + ')' }"
              >
                <FigurePreview :el="presetPreview(p)" fit="stretch" />
              </span>
            </span>
            <span class="card__name">{{ p.name }}</span>
          </button>
        </template>
        <button
          v-for="f in (current && current.cat === RECAST ? [] : current?.list ?? [])"
          :key="f.v"
          class="card"
          :title="f.label"
          @click="onPick(f.v)"
        >
          <span class="card__thumb">
            <FigurePreview :el="previewEl(f.v)" :fit="previewFit(f.v)" />
          </span>
          <span class="card__name">{{ f.label }}</span>
        </button>
      </div>

      <div class="palette__hint">
        <template v-if="figPaletteSink">点哪张就把哪张插进 PDF 文档（不用先放到画布上，插入后仍可移走）</template>
        <template v-else>点击插入；插入后可在画布拖动缩放到合适大小，属性面板可改颜色 / 线宽 / 填充</template>
      </div>
      <input ref="fileInput" type="file" accept="image/*" style="display:none" @change="onPicked">

      <!-- 屏幕外渲染：插入 PDF 文档时，用"真正会插入的那个元素"在这里渲染一份再抓 SVG，
           这样出图和"从页面插入"完全同源（卡片那张是预览版，参数不一样 ✗） -->
      <div
        ref="hiddenRef" class="palette__hidden" aria-hidden="true"
        :style="{ width: hiddenBox.w + 'px', height: hiddenBox.h + 'px' }"
      >
        <FigurePreview v-if="hiddenEl" :el="hiddenEl" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.palette__mine { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 14px 2px; }
.palette__minet { font-size: 12px; color: var(--muted, #888); margin-right: 2px; }
.mine { display: inline-flex; align-items: center; gap: 4px; border: 1px solid #e0e0ea; background: #fafafd; border-radius: 999px; padding: 3px 8px 3px 10px; font-size: 12px; cursor: pointer; }
.mine:hover { background: #efeaff; border-color: #b9a9f0; }
.mine__x { font-style: normal; color: #a99ecb; }
.mine__x:hover { color: #d92d20; }
.palette {
  position: fixed;
  inset: 0;
  /* 必须**压得住 A4 文档弹窗**（.pm 是 2000）—— 图形库可以从文档里打开，
     低于它就会"弹了但被盖住"，看着像点了没反应 ✗。 */
  z-index: 2200;
  background: rgba(20, 24, 34, 0.55); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.palette__box { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); padding: 14px 16px;
  max-width: 800px;
  width: 92vw;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;}
.palette__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 10px;
}
.palette__head em { font-style: normal; font-weight: 400; font-size: 12px; color: var(--muted); margin-left: 6px; }
.palette__close { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; flex: none; cursor: pointer; font-size: 15px; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--gray-600); transition: background var(--dur-1) var(--ease), color var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease); }
.palette__close:hover { background: var(--danger-soft); border-color: var(--danger-border); color: var(--danger); }

/* 分类页签 */
.palette__tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.tab {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 12px; font-size: 13px; cursor: pointer;
  border: 1px solid var(--border-strong); background: var(--panel-2, #fafafd);
  border-radius: 999px; color: var(--muted);
  transition: background var(--dur-1) var(--ease), color var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease);
}
.tab em { font-style: normal; font-size: 11px; color: var(--gray-500); }
.tab:hover { background: var(--brand-soft); color: var(--brand-800); border-color: var(--brand-400); }
.tab--on { background: var(--brand-600); border-color: var(--brand-600); color: #fff; font-weight: 600; }
.tab--on em { color: rgba(255, 255, 255, 0.8); }

.palette__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 10px;
  overflow-y: auto;
  padding: 2px 4px 2px 2px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 7px;
  border: 1px solid var(--border-strong);
  background: #fff;
  border-radius: 9px;
  cursor: pointer;
  text-align: center;
  transition: background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease), transform var(--dur-1) var(--ease), box-shadow var(--dur-1) var(--ease);
}
.card:hover { background: var(--brand-soft); border-color: var(--brand-400); transform: translateY(-1px); box-shadow: var(--shadow-sm); }
/* 复刻图：原始尺寸的图形整体等比缩到卡片里 */
.recast { position: absolute; left: 50%; top: 50%; transform-origin: center center; display: block; }
.card--recast .card__thumb { aspect-ratio: 1 / 1; }
.card--pick { border-style: dashed; }
.recast__plus { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-size: 30px; font-weight: 300; color: var(--brand-600); }
.card__thumb {
  position: relative;
  display: block;
  aspect-ratio: 7 / 4;
  overflow: hidden;
  border-radius: 6px;
  background: #fff;
  pointer-events: none;
}
.card__name { font-size: 12px; color: var(--text); line-height: 1.35; }
/* 屏幕外渲染容器：只为"抓一份真元素的 SVG"，不参与显示 */
.palette__hidden { position: fixed; left: -99999px; top: 0; pointer-events: none; opacity: 0; }
.palette__hint { margin-top: 12px; font-size: 12px; color: var(--muted); }
</style>
