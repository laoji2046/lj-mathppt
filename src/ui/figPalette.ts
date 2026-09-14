import { ref } from 'vue'

/**
 * 数学图形面板的共享开关与"接收方"。
 *
 * 平时点卡片 = 插入到画布；如果设置了 sink，就把卡片对应的**标记 key**（kind 或 preset 名）
 * 和它那张实时 SVG 一起交给 sink：
 *   - PDF 文档：用 svg 栅格化插进文档（不用先放到画布上）
 *   - 表格单元格：用 key 往当前格里写 {{fig:key}}
 * 第三个参数是可选的，老调用方（只收 svg+label）不受影响。
 */
export const figPaletteOpen = ref(false)
export const figPaletteSink = ref<null | ((svg: SVGSVGElement, label: string, key: string) => void)>(null)

export function openFigPalette(sink?: (svg: SVGSVGElement, label: string, key: string) => void) {
  figPaletteSink.value = sink ?? null
  figPaletteOpen.value = true
}
export function closeFigPalette() {
  figPaletteOpen.value = false
  figPaletteSink.value = null
}
