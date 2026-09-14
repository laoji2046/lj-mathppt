import { ref } from 'vue'

/** 打开「预制公式库」的全局信号：TopToolbar 渲染，PropertyPanel/顶部工具栏触发。
 *  打开时若已选中一个公式元素，点卡片即替换其 LaTeX（保留位置/字号）。 */
export const formulaLib = ref<{ open: boolean }>({ open: false })

export function openFormulaLibrary() {
  formulaLib.value = { open: true }
}
export function closeFormulaLibrary() {
  formulaLib.value = { open: false }
}
