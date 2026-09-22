import { ref } from 'vue'

/** 【绘制/形状 → SVG 编辑器】弹窗开关 ✓
 *  与 vectorizeOpen 同一套模式：状态放 ui/*.ts，App.vue 用 v-if 挂载 ✓ */
export const svgEditorOpen = ref(false)

export function openSvgEditor() { svgEditorOpen.value = true }
export function closeSvgEditor() { svgEditorOpen.value = false }
