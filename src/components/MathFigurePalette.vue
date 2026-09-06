<script setup lang="ts">
import { useDeckStore } from '@/stores/deck'
import type { MathFigureKind } from '@/types'
import { MATH_FIGURE_OPTIONS } from '@/types'

const store = useDeckStore()
const emit = defineEmits<{ (e: 'close'): void }>()

function insert(kind: MathFigureKind) {
  store.addElement('mathfig', { kind } as any)
  emit('close')
}
</script>

<template>
  <div class="palette" @click.self="emit('close')">
    <div class="palette__box">
      <div class="palette__head">
        <span>数学图形</span>
        <button class="palette__close" @click="emit('close')">×</button>
      </div>
      <div class="palette__grid palette__grid--fig">
        <button
          v-for="f in MATH_FIGURE_OPTIONS"
          :key="f.v"
          class="palette__fig"
          @click="insert(f.v)"
        >
          <span class="palette__figname">{{ f.label }}</span>
        </button>
      </div>
      <div class="palette__hint">点击插入，插好后可在画布拖动缩放到合适大小，属性面板可改颜色/线宽/填充</div>
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
  max-width: 560px;
  width: 90vw;
  max-height: 80vh;
  overflow: auto;}
.palette__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 12px;
}
.palette__close { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; flex: none; cursor: pointer; font-size: 15px; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--gray-600); transition: background var(--dur-1) var(--ease), color var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease); }
.palette__close:hover { background: var(--danger-soft); border-color: var(--danger-border); color: var(--danger); }
.palette__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
}
.palette__fig {
  padding: 14px 10px;
  border: 1px solid var(--border-strong);
  background: #fff;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text);
  text-align: center;
}
.palette__fig:hover { background: var(--brand-soft); border-color: var(--brand); }
.palette__figname { font-size: 13px; }
.palette__hint { margin-top: 12px; font-size: 12px; color: var(--muted); }
</style>