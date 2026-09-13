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
    <template v-for="(it, i) in state.items" :key="i">
      <div v-if="it.sep" class="ctx-sep"></div>

      <div v-else-if="it.children && it.children.length" class="ctx-sub">
        <button class="ctx-item ctx-item--parent" :disabled="it.disabled">
          <span>{{ it.label }}</span>
          <span class="ctx-arrow">▸</span>
        </button>
        <div class="ctx-menu ctx-submenu">
          <template v-for="(c, j) in it.children" :key="j">
            <div v-if="c.sep" class="ctx-sep"></div>
            <button
              v-else
              class="ctx-item"
              :class="{ 'ctx-item--danger': c.danger }"
              :disabled="c.disabled"
              @click="c.onClick(); closeMenu()"
            ><span>{{ c.label }}</span><span v-if="c.hint" class="ctx-hint">{{ c.hint }}</span></button>
          </template>
        </div>
      </div>

      <button
        v-else
        class="ctx-item"
        :class="{ 'ctx-item--danger': it.danger }"
        :disabled="it.disabled"
        @mouseenter="it.hover && !it.disabled && it.hover($event.currentTarget as HTMLElement)"
        @click="it.onClick(); closeMenu()"
      ><span>{{ it.label }}</span><span v-if="it.hint" class="ctx-hint">{{ it.hint }}</span></button>
    </template>
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
/* 分隔线（PPT 菜单里那些分组横线） */
.ctx-sep { height: 1px; margin: 5px 6px; background: var(--border); }

/* 子菜单：悬停展开（「版式」这类二级项） */
.ctx-sub { position: relative; }
.ctx-item--parent { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.ctx-arrow { color: var(--muted); font-size: 11px; }
.ctx-submenu {
  display: none;
  position: absolute;
  left: 100%;
  top: -6px;
  margin-left: 2px;
  max-height: 60vh;
  overflow-y: auto;
}
.ctx-sub:hover > .ctx-submenu { display: block; }

.ctx-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
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
.ctx-hint { color: var(--muted); font-size: 11px; font-weight: 400; flex: 0 0 auto; }
</style>
