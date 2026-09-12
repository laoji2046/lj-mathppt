<script setup lang="ts">
import { ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { useDeckStore } from '@/stores/deck'

const store = useDeckStore()
const emit = defineEmits<{ (e: 'close'): void }>()

const label = ref('')
function save() {
  store.saveVersion(label.value)
  label.value = ''
}
function fmt(t: number) {
  return new Date(t).toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <div class="palette" @click.self="emit('close')">
    <div class="palette__box">
      <div class="palette__head">
        <span>版本历史</span>
        <button class="palette__close" @click="emit('close')"><AppIcon name="close" :size="13" /></button>
      </div>
      <div class="ver-save">
        <input v-model="label" class="ver-input" placeholder="给当前版本起个名字（可选）" @keydown.enter="save" />
        <button class="ver-btn" @click="save">保存当前版本</button>
      </div>

      <div v-if="store.versions.length" class="ver-list">
        <div v-for="v in store.versions" :key="v.id" class="ver-item">
          <div class="ver-info">
            <span class="ver-label">{{ v.label }}</span>
            <span class="ver-time">{{ fmt(v.time) }} · {{ v.deck.slides.length }} 页</span>
          </div>
          <div class="ver-actions">
            <button class="ver-btn" @click="store.restoreVersion(v.id)">恢复</button>
            <button class="ver-btn ver-btn--del" @click="store.deleteVersion(v.id)">删除</button>
          </div>
        </div>
      </div>
      <div v-else class="palette__hint">
        还没有版本快照。编辑时可随时点「保存当前版本」留档，之后可恢复或删除；最多保留 20 个。
      </div>
    </div>
  </div>
</template>

<style scoped>
.palette { position: fixed; inset: 0; z-index: 400; background: rgba(20, 24, 34, 0.55); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; }
.palette__box { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); padding: 14px 16px; max-width: 480px; width: 90vw; max-height: 80vh; overflow: auto;}
.palette__head { display: flex; align-items: center; justify-content: space-between; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; color: var(--text); margin-bottom: 14px; }
.palette__close { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; flex: none; cursor: pointer; font-size: 15px; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--gray-600); transition: background var(--dur-1) var(--ease), color var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease); }
.palette__close:hover { background: var(--danger-soft); border-color: var(--danger-border); color: var(--danger); }
.ver-save { display: flex; gap: 6px; margin-bottom: 12px; }
.ver-input { flex: 1; box-sizing: border-box; padding: 6px 8px; border: 1px solid var(--border-strong); border-radius: 5px; font-size: 13px; }
.ver-btn { padding: 6px 12px; border: 1px solid var(--border-strong); background: #fff; border-radius: 5px; cursor: pointer; font-size: 13px; flex: none; }
.ver-btn:hover { background: var(--brand-soft); }
.ver-btn--del { color: var(--danger); }
.ver-btn--del:hover { background: var(--danger-soft); }
.ver-list { display: flex; flex-direction: column; gap: 8px; }
.ver-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--panel-2); }
.ver-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ver-label { font-size: 14px; color: var(--text); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ver-time { font-size: 11px; color: var(--muted); }
.ver-actions { display: flex; gap: 6px; flex: none; }
.palette__hint { font-size: 12px; color: var(--muted); line-height: 1.6; }
</style>