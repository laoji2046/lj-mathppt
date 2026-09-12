<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CSSProperties } from 'vue'
import type { TableElement } from '@/types'
import type { SlideElement } from '@/types'
import { useDeckStore } from '@/stores/deck'

const props = defineProps<{ el: TableElement }>()
const store = useDeckStore()

/** 双击进入内联编辑：单元格变 contenteditable，失焦写回，Esc 退出 */
const editing = ref(false)

const cols = computed(() => props.el.rows[0]?.length || 1)
const flat = computed(() => {
  const out: { v: string; r: number; c: number }[] = []
  props.el.rows.forEach((row, r) => row.forEach((cv, c) => out.push({ v: cv ?? '', r, c })))
  return out
})

/** 网格：列 1fr 等宽铺满宽；行 auto 按内容自适应；gap=1px+背景=边框色 成网格线 */
const gridStyle = computed(() => ({
  display: 'grid',
  gridTemplateColumns: 'repeat(' + cols.value + ', 1fr)',
  gridAutoRows: 'auto',
  gap: '1px',
  background: props.el.borderColor,
  fontSize: props.el.fontSize + 'px',
  width: '100%',
}))
function cellStyle(item: { r: number }): CSSProperties {
  const isH = item.r === 0
  const pad = props.el.cellPad ?? 6
  const bg = isH ? props.el.headerColor : (props.el.altRowColor && item.r % 2 === 0 ? props.el.altRowColor : '#ffffff')
  return {
    background: bg,
    color: isH ? (props.el.headerTextColor || '#ffffff') : (props.el.cellColor || '#1a1a1a'),
    fontWeight: isH ? 700 : 400,
    padding: pad + 'px ' + (pad + 2) + 'px',
    textAlign: props.el.cellAlign || 'center',
    overflow: 'hidden',
    wordBreak: 'break-word',
    boxSizing: 'border-box',
    lineHeight: 1.4,
    outline: 'none',
    cursor: editing.value ? 'text' : 'default',
  }
}
function startEdit() {
  editing.value = true
  requestAnimationFrame(() => { const c = document.activeElement as HTMLElement; if (c && c.isContentEditable) c.focus() })
}
function onCellBlur(item: { r: number; c: number }, e: FocusEvent) {
  const node = e.target as HTMLElement
  const v = node.innerText
  const rows = props.el.rows.map((row) => [...row])
  if (rows[item.r] && rows[item.r][item.c] !== v) {
    rows[item.r][item.c] = v
    store.updateElement(props.el.id, { rows } as Partial<SlideElement>)
  }
  editing.value = false
}
function onEsc(e: KeyboardEvent) {
  editing.value = false
  ;(e.target as HTMLElement).blur()
}
</script>

<template>
  <div class="table-el" :class="{ 'table-el--edit': editing }" @dblclick.stop.prevent="startEdit">
    <div class="table-grid" :style="gridStyle">
      <div
        v-for="(item, idx) in flat"
        :key="idx"
        :style="cellStyle(item)"
        :contenteditable="editing ? 'plaintext-only' : 'false'"
        @blur="onCellBlur(item, $event)"
        @keydown.esc="onEsc"
      >{{ item.v }}</div>
    </div>
    <div v-if="!editing" class="table-el__hint">双击编辑数据 / 表头</div>
  </div>
</template>

<style scoped>
.table-el { width: 100%; height: 100%; overflow: auto; box-sizing: border-box; position: relative; }
.table-grid { width: 100%; }
.table-el--edit .table-grid > div { border: 1px dashed var(--brand); min-height: 28px; }
.table-el__hint { position: absolute; top: -1px; right: 2px; font-size: 11px; color: #fff; background: rgba(106,82,200,0.85); border-radius: 4px; padding: 1px 6px; pointer-events: none; opacity: 0; transition: opacity .12s; }
.table-el:hover .table-el__hint { opacity: 1; }
</style>
