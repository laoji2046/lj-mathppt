import { ref } from 'vue'

/** 图片转图形弹窗：把图片里的线稿识别成可编辑的数学图形元素。
 *  src 是图片地址；replaceId 有值时，弹窗里多一个"替换这张图片"的选项。 */
export const vectorizeOpen = ref(false)
export const vectorizeSrc = ref('')
export const vectorizeReplaceId = ref<string | null>(null)

export function openVectorize(src: string, replaceId: string | null = null) {
  vectorizeSrc.value = src
  vectorizeReplaceId.value = replaceId
  vectorizeOpen.value = true
}

export function closeVectorize() {
  vectorizeOpen.value = false
  vectorizeSrc.value = ''
  vectorizeReplaceId.value = null
}
