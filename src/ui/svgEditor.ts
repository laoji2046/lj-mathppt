import { ref } from 'vue'

/** 【绘制/形状 → SVG 编辑器】弹窗开关 ✓
 *  与 vectorizeOpen 同一套模式：状态放 ui/*.ts，App.vue 用 v-if 挂载 ✓ */
export const svgEditorOpen = ref(false)

/** 【v1507】要**再编辑**哪一张手绘图（元素的 svgDraw.key ✓）；空 = 新画一张 ✓ */
export const svgEditorEditKey = ref('')

export function openSvgEditor(editKey = '') {
  svgEditorEditKey.value = editKey
  svgEditorOpen.value = true
}

export function closeSvgEditor() {
  svgEditorOpen.value = false
  svgEditorEditKey.value = ''
}
