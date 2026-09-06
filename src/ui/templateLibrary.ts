import { ref } from 'vue'

/** 模板库弹窗打开模式：
 *  replace = 用模板替换当前页（顶部工具栏打开）
 *  add     = 用模板在当前页后新增一页（编辑器右侧 ＋）
 *  addSub  = 用模板在当前页后新增一个子页（编辑器底部 ＋）
 */
export type TplMode = 'replace' | 'add' | 'addSub'

export const tplOpen = ref(false)
export const tplMode = ref<TplMode>('replace')

export function openTemplateLibrary(mode: TplMode = 'replace') {
  tplMode.value = mode
  tplOpen.value = true
}
export function closeTemplateLibrary() {
  tplOpen.value = false
}
