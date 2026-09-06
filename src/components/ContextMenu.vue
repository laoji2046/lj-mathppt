<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useContextMenu } from '@/composables/useContextMenu'

const { state, closeMenu } = useContextMenu()

function onDown(e: Event) {
  if (!(e.target as HTMLElement).closest('.ctx-menu')) closeMenu()
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') closeMenu()
}
onMounted(() => {
  window.addEventListener('pointerdown', onDown, true)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onDown, true)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div
    v-if="state.open"
    class="ctx-menu"
    :style="{ left: state.x + 'px', top: state.y + 'px' }"
    @contextmenu.prevent
  >
    <button
      v-for="(it, i) in state.items"
      :key="i"
      class="ctx-item"
      :class="{ 'ctx-item--danger': it.danger }"
      :disabled="it.disabled"
      @click="it.onClick(); closeMenu()"
    >{{ it.label }}</button>
  </div>
</template>

<style scoped>
.ctx-menu {
  position: fixed;
  z-index: 2000;
  min-width: 168px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 5px;
  animation: fx-pop var(--dur-1) var(--ease);
}
.ctx-item {
  display: block;
  width: 100%;
  text-align: left;
  min-height: 32px;
  padding: 6px 10px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  border: none;
  background: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--dur-1) var(--ease), color var(--dur-1) var(--ease);
}
.ctx-item:hover:not(:disabled) { background: var(--brand-50); color: var(--brand-800); }
.ctx-item:disabled { opacity: 0.4; cursor: not-allowed; }
.ctx-item--danger { color: var(--danger); }
.ctx-item--danger:hover:not(:disabled) { background: var(--danger-soft); color: var(--danger); }
</style>
