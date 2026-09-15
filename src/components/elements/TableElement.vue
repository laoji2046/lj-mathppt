<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { escapeHtml, normalizeMixed } from '@/types'
import { typesetHosts } from '@/composables/useMathJax'
import { inlineFiguresInText } from '@/composables/figureRender'
import { layoutTable, type TableCell } from '@/composables/tableLayout'
import type { CSSProperties } from 'vue'
import type { TableElement } from '@/types'
import type { SlideElement } from '@/types'
import { useDeckStore } from '@/stores/deck'

const props = defineProps<{ el: TableElement }>()
const store = useDeckStore()

/** 双击进入内联编辑：单元格变 contenteditable，失焦写回，Esc 退出 */
const editing = ref(false)
const gridEl = ref<HTMLElement | null>(null)

/** 排版：rows + merges → 要渲染的格子（跨行跨列算法与导出一份，见 tableLayout.ts） */
/** 单元格/表标题的显示 HTML：图形替换 + $..$ 归一化。**纯函数**，由 Vue 用 v-html 渲染 */
function cellHtml(t: string) {
  // 先转义用户文本（否则 $0<a<1$ 的 < 会被当标签），再插图形（SVG 必须保持原样）
  return normalizeMixed(inlineFiguresInText(escapeHtml(t || ''), props.el.figHeight))
}
const layout = computed(() => layoutTable(props.el.rows, props.el.merges))

/**
 * 单元格渲染：支持 \(LaTeX\) / $…$ 行内公式，以及 {{fig:kind}} 行内图形。
 * ⚠ 编辑时必须显示**原文** —— MathJax 排完之后 DOM 里是渲染结果，
 *   直接读 innerText 会把公式读成一片乱字符（混排公式元素踩过同一个坑）。
 */
async function renderCells() {
  await nextTick()
  const host = gridEl.value
  if (!host) return
  // 单元格与表标题都带 data-raw（标题里也可能有公式）
  const cells = Array.from(host.querySelectorAll<HTMLElement>('[data-mixed]'))
  // ⚠ 编辑态**什么都不做**：单元格由 Vue 通过 :key 重建（内容天然是原文），
  //   在这里重写 innerText 会把节点换掉 → 光标/焦点丢失 → 表现为"双击不能编辑"（踩过）
  if (editing.value) return
  // 内容由 Vue 渲染（v-html），这里**只负责排版** —— 两边都写 innerHTML 会互相覆盖
  await typesetHosts(cells.filter((c) => /\\\(|\$/.test(c.getAttribute('data-raw') || '')))
}
onMounted(() => { renderCells() })
// ⚠ 改动表格的任何"影响渲染"的字段都要进这个列表 —— 漏一个就会出现"改了没反应"
//   （figHeight 就漏过一次：图形高度改了但没重绘）
watch(
  () => [props.el.rows, props.el.merges, props.el.caption, props.el.figHeight, editing.value],
  renderCells,
  { deep: true },
)

/** 表格整体样式：真 <table>，边框用 border-collapse 画（原来靠 grid gap 的假边框换掉了） */
/**
 * 整表的重建键。
 * ⚠ 为什么必须这样：MathJax 排版会**改写 v-html 出来的子节点** ✗，之后 Vue 若按旧锚点去 patch
 *   同一棵树，就会撞到"找不到节点"（insertBefore on null ✓ 踩过）。
 *   所以：**内容一变就整表重建**，Vue 永远只往"全新的树"里 patch。
 *   表格不大，这点重建开销换来的是"再也不会出诡异错位"。
 */
const contentKey = computed(() => JSON.stringify([
  props.el.rows, props.el.merges, props.el.caption, props.el.figHeight, props.el.borderMode,
]))

const tableStyle = computed(() => ({
  width: '100%',
  borderCollapse: 'collapse' as const,
  tableLayout: 'fixed' as const,
  fontSize: props.el.fontSize + 'px',
}))
function cellStyle(cell: TableCell): CSSProperties {
  const isH = cell.r === 0
  const pad = props.el.cellPad ?? 6
  // 边框：all=全网格；three=**三线表**（顶线 / 表头下线 / 底线，教材常用）
  const line = '1px solid ' + props.el.borderColor
  const three = (props.el.borderMode || 'all') === 'three'
  const lastRow = layout.value.rows - 1
  const rEnd = cell.r + cell.rs - 1
  const bd = three
    ? {
        borderTop: cell.r === 0 ? line : 'none',
        borderBottom: cell.r === 0 || rEnd === lastRow ? line : 'none',
        borderLeft: 'none',
        borderRight: 'none',
      }
    : { borderTop: line, borderBottom: line, borderLeft: line, borderRight: line }
  const bg = isH ? props.el.headerColor : (props.el.altRowColor && cell.r % 2 === 0 ? props.el.altRowColor : '#ffffff')
  return {
    background: bg,
    // ② 逐格文字色优先（PPT 导入 ✓），否则用表头/正文的全局色 ✓
    color: (props.el.cellColors && props.el.cellColors[cell.r + '-' + cell.c])
      || (isH ? (props.el.headerTextColor || '#ffffff') : (props.el.cellColor || '#1a1a1a')),
    fontWeight: isH ? 700 : 400,
    padding: pad + 'px ' + (pad + 2) + 'px',
    textAlign: props.el.cellAlign || 'center',
    overflow: 'hidden',
    wordBreak: 'break-word',
    boxSizing: 'border-box',
    lineHeight: 1.4,
    outline: 'none',
    verticalAlign: 'middle',
    ...bd,
    cursor: editing.value ? 'text' : 'default',
  }
}
function startEdit(e?: MouseEvent) {
  // 记住双击落在哪个格子（点空白区域就退回第一格）
  const hit = (e && e.target instanceof HTMLElement ? e.target.closest('[data-cell]') : null) as HTMLElement | null
  editing.value = true
  // ⚠ 必须**显式聚焦并落光标** —— 表格用 :key 重建过，浏览器那套"点到哪就是哪"的自动聚焦不作数
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
    <table ref="gridEl" class="table-grid" :key="editing ? 'edit' : 'view:' + contentKey" :style="tableStyle">
      <!-- 列宽（PPT 导入还原）：有 colWidths 就按它排，否则等分 ✓ -->
      <colgroup v-if="el.colWidths && el.colWidths.length">
        <col v-for="(cw, ci) in el.colWidths" :key="ci" :style="{ width: cw + 'px' }" />
      </colgroup>
      <caption v-if="el.caption" class="table-cap" :data-raw="el.caption" :contenteditable="editing ? 'plaintext-only' : 'false'">
        <template v-if="editing">{{ el.caption }}</template>
        <!-- ⚠ key 用文本本身：MathJax 会把 v-html 的子节点换掉，Vue 若按旧锚点 patch 会报
             insertBefore on null。key 一变就整体重建，patch 只发生在"新节点"上 ✓ -->
        <span v-else :key="el.caption" data-mixed :data-raw="el.caption" v-html="cellHtml(el.caption)"></span>
      </caption>
      <tbody>
        <tr v-for="(line, ri) in layout.grid" :key="ri">
          <td
            v-for="cell in line"
            :key="cell.r + '-' + cell.c"
            :data-cell="cell.r + '-' + cell.c"
            :data-raw="cell.text"
            :rowspan="cell.rs > 1 ? cell.rs : undefined"
            :colspan="cell.cs > 1 ? cell.cs : undefined"
            :style="cellStyle(cell)"
            :contenteditable="editing ? 'plaintext-only' : 'false'"
            @blur="onCellBlur(cell, $event)"
            @keydown.esc="onEsc"
          >
            <template v-if="editing">{{ cell.text }}</template>
            <span v-else :key="cell.text" data-mixed :data-raw="cell.text" v-html="cellHtml(cell.text)"></span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.table-el { width: 100%; height: 100%; overflow: auto; box-sizing: border-box; position: relative; }
.table-grid { width: 100%; table-layout: fixed; }
.table-cap { caption-side: top; text-align: center; font-weight: 700; padding: 0 0 4px; outline: none; }
.table-el--edit .table-grid > tbody > tr > td { border: 1px dashed var(--brand) !important; min-height: 28px; }
.table-el--edit .table-cap { border: 1px dashed var(--brand); }
</style>