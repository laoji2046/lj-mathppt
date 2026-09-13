import { ref } from 'vue'

/** 版式选择器是否打开 */
export const layoutGalleryOpen = ref(false)
/** 要套用版式的页码 */
export const layoutGalleryIndex = ref(0)

export function openLayoutGallery(index: number) {
  layoutGalleryIndex.value = index
  layoutGalleryOpen.value = true
}
export function closeLayoutGallery() {
  layoutGalleryOpen.value = false
}
