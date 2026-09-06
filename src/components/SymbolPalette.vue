<script setup lang="ts">
import { useDeckStore } from '@/stores/deck'
import { MATH_SYMBOLS } from '@/types'

const store = useDeckStore()
const emit = defineEmits<{ (e: 'close'): void }>()

function insert(s: string) {
  store.addElement('text', { text: s, fontSize: 44, w: 120, h: 84 } as any)
  emit('close')
}
</script>

<template>
  <div class="palette" @click.self="emit('close')">
    <div class="palette__box">
      <div class="palette__head">
        <span>数学符号</span>
        <button class="palette__close" @click="emit('close')">×</button>
      </div>
      <div class="palette__grid">
        <button v-for="s in MATH_SYMBOLS" :key="s" class="palette__sym" @click="insert(s)">{{ s }}</button>
      </div>
      <div class="palette__hint">点击插入为文本元素，可像普通文字一样改字体/颜色/大小</div>
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
  max-width: 520px;
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
  grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
  gap: 8px;
}
.palette__sym {
  height: 44px;
  font-size: 22px;
  border: 1px solid var(--border-strong);
  background: #fff;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: center;
}
.palette__sym:hover { background: var(--brand-soft); border-color: var(--brand); }
.palette__hint { margin-top: 12px; font-size: 12px; color: var(--muted); }
</style>