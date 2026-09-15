/** 帮助弹窗的全局开关（App.vue 监听渲染，工具栏/其他入口触发） */
import { ref } from 'vue'
export const helpOpen = ref(false)
export function openHelp() { helpOpen.value = true }
export function closeHelp() { helpOpen.value = false }