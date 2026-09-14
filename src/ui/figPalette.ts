import { ref } from 'vue'

/**
 * 数学图形面板的共享开关与"接收方"。
 *
 * 平时点卡片 = 插入到画布；如果设置了 sink（比如 PDF 文档打开着），
 * 就改成把卡片**自己那张 SVG** 交给 sink —— 面板里的缩略图本来就是实时渲染的图形，
 * 所以可以直接栅格化插进文档，**不用先放到画布上**。
 */
export const figPaletteOpen = ref(false)
export const figPaletteSink = ref<null | ((svg: SVGSVGElement, label: string) => void)>(null)

export function openFigPalette(sink?: (svg: SVGSVGElement, label: string) => void) {
  figPaletteSink.value = sink ?? null
  figPaletteOpen.value = true
}
export function closeFigPalette() {
  figPaletteOpen.value = false
  figPaletteSink.value = null
}
