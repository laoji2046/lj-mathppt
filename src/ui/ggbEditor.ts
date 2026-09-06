import { ref } from 'vue'

/** 打开 GeoGebra 套件（作图器）的全局信号：App.vue 监听渲染，PropertyPanel/ContextMenu 触发 */
export const ggbEdit = ref<{ open: boolean; editId?: string }>({ open: false, editId: undefined })

export function openGgbSuite(editId?: string) {
  ggbEdit.value = { open: true, editId }
}
export function closeGgbSuite() {
  ggbEdit.value = { open: false, editId: undefined }
}
