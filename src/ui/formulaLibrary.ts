import { ref } from 'vue'
import { tableCellSink } from './tableCellSink'

/** 打开「预制公式库」的全局信号：TopToolbar 渲染，PropertyPanel/顶部工具栏触发。
 *  打开时若已选中一个公式元素，点卡片即替换其 LaTeX（保留位置/字号）。 */
export const formulaLib = ref<{ open: boolean }>({ open: false })

/**
 * "把选中的公式交给谁"。
 * 不设 sink（默认）＝老行为：填进公式面板自己的输入框。
 * 设了 sink ＝**单击公式卡片就把 LaTeX 交给它**（可连续点好几条），面板不关 ——
 * 表格单元格编辑时就是这么用的（跟 PDF 那边的 figPaletteSink 是同一个套路）。
 */
export const formulaLibSink = ref<((latex: string) => void) | null>(null)

export function openFormulaLibrary(sink?: (latex: string) => void) {
  // 没显式给 sink 时，若"某个表格单元格正在编辑"，就落到那个格子 ——
  // 这样工具栏那条路也不会再把公式插到表格外面去（用户实际混用两个入口）
  formulaLibSink.value = sink ?? tableCellSink.value ?? null
  formulaLib.value = { open: true }
}
export function closeFormulaLibrary() {
  formulaLibSink.value = null
  formulaLib.value = { open: false }
}
