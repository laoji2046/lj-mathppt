import { ref } from 'vue'
import type { MathFigureElement } from '@/types'

/** 「导出 Asymptote 代码」弹窗：拿到一个数学图形元素，展示它对应的 asy 源码 */
export const asyExportEl = ref<MathFigureElement | null>(null)

export function openAsyExport(el: MathFigureElement) {
  asyExportEl.value = el
}
export function closeAsyExport() {
  asyExportEl.value = null
}
