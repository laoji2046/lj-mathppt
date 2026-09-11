<script setup lang="ts">
/** 数学图形面板：按分类（平面 / 立体 / 函数 / 圆锥曲线 / 辅助标注）分页浏览与插入 */
import { computed, ref } from 'vue'
import { useDeckStore } from '@/stores/deck'
import type { MathFigureCat, MathFigureKind } from '@/types'
import { MATH_FIGURE_CATS, MATH_FIGURE_OPTIONS } from '@/types'

const store = useDeckStore()
const emit = defineEmits<{ (e: 'close'): void }>()

const groups = computed(() => MATH_FIGURE_CATS.map((c) => ({
  cat: c,
  list: MATH_FIGURE_OPTIONS.filter((f) => f.cat === c),
})).filter((g) => g.list.length))

/** 默认停在「函数图像」：备课里用得最多 */
const cat = ref<MathFigureCat>('函数图像')
const current = computed(() => groups.value.find((g) => g.cat === cat.value) ?? groups.value[0])

/** 函数图像 / 圆锥曲线插入时给一个宽一点的框（坐标系 + 曲线需要横向空间） */
const SIZE: Partial<Record<MathFigureCat, { w: number; h: number }>> = {
  函数图像: { w: 520, h: 360 },
  圆锥曲线: { w: 520, h: 340 },
}

function insert(kind: MathFigureKind) {
  const size = SIZE[current.value?.cat ?? '平面图形'] ?? {}
  store.addElement('mathfig', { kind, ...size } as any)
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

      <div class="palette__grid palette__grid--fig">
        <button
          v-for="f in current?.list ?? []"
          :key="f.v"
          class="palette__fig"
          :title="f.label"
          @click="insert(f.v)"
        >
          <span class="palette__figname">{{ f.label }}</span>
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
  max-width: 760px;
  width: 92vw;
  max-height: 84vh;
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
  grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  gap: 8px;
  overflow-y: auto;
  padding-right: 2px;
}
.palette__fig {
  padding: 12px 8px;
  border: 1px solid var(--border-strong);
  background: #fff;
  border-radius: 8px;
  cursor: pointer;
  color: var(--text);
  text-align: center;
  line-height: 1.35;
  transition: background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease), transform var(--dur-1) var(--ease);
}
.palette__fig:hover { background: var(--brand-soft); border-color: var(--brand-400); transform: translateY(-1px); }
.palette__figname { font-size: 12.5px; }
.palette__hint { margin-top: 12px; font-size: 12px; color: var(--muted); }
</style>
