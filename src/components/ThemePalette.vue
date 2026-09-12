<script setup lang="ts">
import { useDeckStore } from '@/stores/deck'
import AppIcon from './AppIcon.vue'
import { THEMES } from '@/types'

const store = useDeckStore()
const emit = defineEmits<{ (e: 'close'): void }>()

function apply(id: string) {
  store.applyTheme(id)
  emit('close')
}
</script>

<template>
  <div class="palette" @click.self="emit('close')">
    <div class="palette__box">
      <div class="palette__head">
        <span>主题</span>
        <button class="palette__close" @click="emit('close')"><AppIcon name="close" :size="13" /></button>
      </div>
      <div class="thm-grid">
        <button
          v-for="t in THEMES"
          :key="t.id"
          class="thm"
          :class="{ 'thm--on': store.deck.theme === t.id }"
          @click="apply(t.id)"
        >
          <span class="thm__swatch" :style="{ background: t.bg }">
            <span class="thm__accent" :style="{ background: t.accent }"></span>
          </span>
          <span class="thm__name">{{ t.name }}</span>
        </button>
      </div>
      <div class="palette__hint">应用主题会把所有页面的背景色改成主题配色（不覆盖元素内容）。</div>
    </div>
  </div>
</template>

<style scoped>
.palette { position: fixed; inset: 0; z-index: 400; background: rgba(20, 24, 34, 0.55); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; }
.palette__box { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); padding: 14px 16px; max-width: 440px; width: 90vw; max-height: 80vh; overflow: auto;}
.palette__head { display: flex; align-items: center; justify-content: space-between; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; color: var(--text); margin-bottom: 14px; }
.palette__close { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; flex: none; cursor: pointer; font-size: 15px; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--gray-600); transition: background var(--dur-1) var(--ease), color var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease); }
.palette__close:hover { background: var(--danger-soft); border-color: var(--danger-border); color: var(--danger); }
.thm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 10px; }
.thm { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 6px; border: 1px solid var(--border-strong); border-radius: 6px; background: #fff; cursor: pointer; }
.thm:hover { border-color: var(--brand); background: var(--brand-soft); }
.thm--on { border-color: var(--brand); background: var(--brand-soft); box-shadow: 0 0 0 1px var(--brand) inset; }
.thm__swatch { width: 100%; height: 40px; border-radius: 4px; border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; }
.thm__accent { width: 14px; height: 14px; border-radius: 3px; }
.thm__name { font-size: 12px; color: var(--text); }
.palette__hint { margin-top: 12px; font-size: 12px; color: var(--muted); }
</style>