<script setup lang="ts">
/** 数学图形面板：分类页签 + 卡片缩略图（缩略图直接用元素组件渲染，所见即所得） */
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { useDeckStore } from '@/stores/deck'
import type { MathFigureCat, MathFigureKind } from '@/types'
import { MATH_FIGURE_CATS, MATH_FIGURE_OPTIONS } from '@/types'
import { figureBox, viewAspect } from '@/composables/mathPlot'
import { SOLID_FIGURE_PRESETS } from '@/templates/solidFigures'
import { openVectorize } from '@/ui/vectorize'
import { openGeom3D } from '@/ui/geom3d'
import { closeFigPalette, figPaletteSink } from '@/ui/figPalette'
import FigurePreview from './elements/MathFigureElement.vue'

const store = useDeckStore()
const emit = defineEmits<{ (e: 'close'): void }>()

/** 复刻图形：从原图逐个描下来的立体几何图，插入后仍是可编辑的矢量图形 */
const RECAST = '复刻图形' as MathFigureCat

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

/** 面板里每张卡片自己的图形名（给"插入到 PDF 文档"当图注用） */
function labelOf(kind: MathFigureKind): string {
  return MATH_FIGURE_OPTIONS.find((o) => o.v === kind)?.label || String(kind)
}
/**
 * 点卡片：设了 sink（PDF 文档正开着）就把**卡片自己那张 SVG** 交出去，
 * 由调用方栅格化插进文档 —— 不用先放到画布上；否则按老规矩插到画布。
 */
function onPick(kind: MathFigureKind, e: MouseEvent) {
  const sink = figPaletteSink.value
  if (!sink) {
    insert(kind)
    return
  }
  const svg = (e.currentTarget as HTMLElement)?.querySelector('svg')
  if (!svg) {
    insert(kind)
    return
  }
  sink(svg as SVGSVGElement, labelOf(kind))
  closeFigPalette()
  emit('close')
}

/** 插入尺寸：函数 / 圆锥曲线按视图宽高比给（圆才会是圆），其余用元素默认值 */
function insert(kind: MathFigureKind) {
  const box = figureBox(kind)
  // 自定义函数（空白）：给一份能直接改的默认配置，别让元素缺字段
  const extra = kind === 'custom'
    ? { custom: { expr: 'x^2-2x+1', x0: -2, x1: 4, y0: -2, y1: 6, grid: true, axes: true }, w: 420, h: 300 }
    : {}
  store.addElement('mathfig', { kind, ...(box || {}), ...extra } as any)
  emit('close')
}

/** 复刻图：连同顶点 / 边拓扑 / 字母一起插入，并按原图宽高比给尺寸 */
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
            @click="insertPreset(p)"
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
          @click="onPick(f.v, $event)"
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
    </div>
  </div>
</template>

<style scoped>
.palette {
  position: fixed;
  inset: 0;
  z-index: 400;
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
.palette__hint { margin-top: 12px; font-size: 12px; color: var(--muted); }
</style>
