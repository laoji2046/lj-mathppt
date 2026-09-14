<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { normalizeMixed } from '@/types'
import { typesetMixed } from '@/composables/useMathJax'
import type { CSSProperties } from 'vue'
import type { TableElement } from '@/types'
import type { SlideElement } from '@/types'
import { useDeckStore } from '@/stores/deck'
import { openFormulaLibrary } from '@/ui/formulaLibrary'

const props = defineProps<{ el: TableElement }>()
const store = useDeckStore()

/** 双击进入内联编辑：单元格变 contenteditable，失焦写回，Esc 退出 */
const editing = ref(false)
const gridEl = ref<HTMLElement | null>(null)

/**
 * 单元格渲染：支持 \(LaTeX\) 行内公式（跟「混排公式」元素同一套 MathJax 排版）。
 * ⚠ 编辑时必须显示**原文** —— MathJax 排完之后 DOM 里是渲染结果，
 *   直接读 innerText 会把公式读成一片乱字符（混排公式元素踩过同一个坑）。
 */
let renderSeq = 0
async function renderCells() {
  const my = ++renderSeq
  await nextTick()
  const host = gridEl.value
  if (!host) return
  const cells = Array.from(host.querySelectorAll<HTMLElement>('[data-cell]'))
  // ⚠ 编辑态**什么都不做**：单元格由 Vue 通过 :key 重建（内容天然是原文），
  //   在这里重写 innerText 会把节点换掉 → 光标/焦点丢失 → 表现为"双击不能编辑"（踩过）
  if (editing.value) return
  for (const c of cells) {
    const raw = c.getAttribute('data-raw') || ''
    if (raw.indexOf('\\(') < 0) { if (c.innerText !== raw) c.innerText = raw; continue }
    await typesetMixed(c, normalizeMixed(raw))
    if (my !== renderSeq) return
  }
}
onMounted(() => {
  renderCells()
  document.addEventListener('selectionchange', rememberSelection)
})
onBeforeUnmount(() => document.removeEventListener('selectionchange', rememberSelection))

/**
 * 记住"编辑中那个单元格里的光标位置"。
 * ⚠ 点「插入公式」按钮会让单元格失焦、选区丢失 —— 所以必须**先把 Range 存下来**，
 *   等公式库选好后再 restore 回去插到原来的位置。
 */
let savedRange: Range | null = null
function rememberSelection() {
  if (!editing.value) return
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return
  const r = sel.getRangeAt(0)
  if (gridEl.value && gridEl.value.contains(r.commonAncestorContainer)) savedRange = r.cloneRange()
}
/** 从公式库选中的 LaTeX → 以行内公式的形式插到光标处 */
function insertFormulaAtCaret(latex: string) {
  const host = gridEl.value
  if (!host) return
  let range = savedRange
  if (!range || !host.contains(range.commonAncestorContainer)) {
    const first = host.querySelector<HTMLElement>('[data-cell]')
    if (!first) return
    range = document.createRange()
    range.selectNodeContents(first)
    range.collapse(false)
  }
  const text = document.createTextNode('\\(' + latex + '\\)')
  range.deleteContents()
  range.insertNode(text)
  range.setStartAfter(text)
  range.collapse(true)
  savedRange = range.cloneRange()
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}
function openLib() { openFormulaLibrary(insertFormulaAtCaret) }
watch(() => [props.el.rows, editing.value], renderCells, { deep: true })

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
function startEdit(e?: MouseEvent) {
  // 记住双击落在哪个格子（点空白区域就退回第一格）
  const hit = (e && e.target instanceof HTMLElement ? e.target.closest('[data-cell]') : null) as HTMLElement | null
  editing.value = true
  // ⚠ 必须**显式聚焦并落光标** —— 网格用 :key 重建过，浏览器那套"点到哪就是哪"的自动聚焦不作数 ✗
  requestAnimationFrame(() => {
    const host = gridEl.value
    if (!host) return
    const cell = (hit && host.contains(hit) ? hit : host.querySelector<HTMLElement>('[data-cell]'))
    if (!cell) return
    cell.focus()
    const r = document.createRange()
    r.selectNodeContents(cell)
    r.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
    savedRange = r.cloneRange()
  })
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
    <div ref="gridEl" class="table-grid" :key="editing ? 'edit' : 'view'" :style="gridStyle">
      <div
        v-for="(item, idx) in flat"
        :key="idx"
        :data-cell="item.r + '-' + item.c"
        :data-raw="item.v"
        :style="cellStyle(item)"
        :contenteditable="editing ? 'plaintext-only' : 'false'"
        @blur="onCellBlur(item, $event)"
        @keydown.esc="onEsc"
      >{{ item.v }}</div>
    </div>
    <div v-if="editing" class="table-el__tools">
      <button class="table-el__btn" title="从预制公式库选一条，插到当前单元格的光标处（可连续选）" @click.stop="openLib">∑ 插入公式</button>
    </div>
    <div v-if="!editing" class="table-el__hint">双击编辑数据 / 表头；单元格里写 \(x^2\) 就是公式</div>
  </div>
</template>

<style scoped>
.table-el { width: 100%; height: 100%; overflow: auto; box-sizing: border-box; position: relative; }
.table-grid { width: 100%; }
.table-el--edit .table-grid > div { border: 1px dashed var(--brand); min-height: 28px; }
/* 编辑态的悬浮小工具条（插公式等） */
/* ⚠ 必须放在表格**框内** —— .table-el 有 overflow:auto，放外面（top:-30px）会被整块裁掉，
   用户根本看不见（今天就栽在这个"只验 DOM 存在、没验可见"上） */
.table-el__tools { position: absolute; top: 3px; right: 3px; display: flex; gap: 6px; z-index: 6; }
.table-el__btn { border: 1px solid var(--brand, #1668e0); background: rgba(255,255,255,.96); color: var(--brand, #1668e0);
  border-radius: 6px; padding: 3px 9px; font-size: 12px; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
.table-el__btn:hover { background: var(--brand, #1668e0); color: #fff; }
.table-el__hint { position: absolute; top: -1px; right: 2px; font-size: 11px; color: #fff; background: rgba(106,82,200,0.85); border-radius: 4px; padding: 1px 6px; pointer-events: none; opacity: 0; transition: opacity .12s; }
.table-el:hover .table-el__hint { opacity: 1; }
</style>
