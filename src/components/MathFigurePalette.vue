<script setup lang="ts">
/** 数学图形面板：分类页签 + 卡片缩略图（缩略图直接用元素组件渲染，所见即所得） */
import { computed, ref } from 'vue'
import { useDeckStore } from '@/stores/deck'
import type { MathFigureCat, MathFigureKind } from '@/types'
import { MATH_FIGURE_CATS, MATH_FIGURE_OPTIONS } from '@/types'
import { figureBox, viewAspect } from '@/composables/mathPlot'
import FigurePreview from './elements/MathFigureElement.vue'

const store = useDeckStore()
const emit = defineEmits<{ (e: 'close'): void }>()

const groups = computed(() => MATH_FIGURE_CATS.map((c) => ({
  cat: c,
  list: MATH_FIGURE_OPTIONS.filter((f) => f.cat === c),
})).filter((g) => g.list.length))

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

/** 插入尺寸：函数 / 圆锥曲线按视图宽高比给（圆才会是圆），其余用元素默认值 */
function insert(kind: MathFigureKind) {
  const box = figureBox(kind)
  store.addElement('mathfig', box ? { kind, ...box } : { kind } as any)
  emit('close')
}
</script>

<template>
  <div class="palette" @click.self="emit('close')">
    <div class="palette__box">
      <div class="palette__head">
        <span>数学图形 <em>{{ MATH_FIGURE_OPTIONS.length }} 种</em></span>
        <button class="palette__close" @click="emit('close')">×</button>
      </div>

      <div class="palette__tabs">
        <button
          v-for="g in groups"
          :key="g.cat"
          class="tab"
          :class="{ 'tab--on': current && current.cat === g.cat }"
          @click="cat = g.cat"
        >
          {{ g.cat }}<em>{{ g.list.length }}</em>
        </button>
      </div>

      <div class="palette__grid">
        <button
          v-for="f in current?.list ?? []"
          :key="f.v"
          class="card"
          :title="f.label"
          @click="insert(f.v)"
        >
          <span class="card__thumb">
            <FigurePreview :el="previewEl(f.v)" :fit="previewFit(f.v)" />
          </span>
          <span class="card__name">{{ f.label }}</span>
        </button>
      </div>

      <div class="palette__hint">点击插入；插入后可在画布拖动缩放到合适大小，属性面板可改颜色 / 线宽 / 填充</div>
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
