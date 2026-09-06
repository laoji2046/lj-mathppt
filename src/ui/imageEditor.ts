import { ref } from 'vue'

/** 图片编辑器弹窗：编辑选中的图片元素（裁剪/旋转/翻转/滤镜），应用后写回 src */
export const imageEditOpen = ref(false)
export const imageEditId = ref<string | null>(null)

export function openImageEditor(id: string) {
  imageEditId.value = id
  imageEditOpen.value = true
}
export function closeImageEditor() {
  imageEditOpen.value = false
  imageEditId.value = null
}
