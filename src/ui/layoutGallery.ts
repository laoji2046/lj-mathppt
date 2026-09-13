import { ref } from 'vue'

/** 版式选择器是否打开 */
export const layoutGalleryOpen = ref(false)
/** 要套用版式的页码 */
export const layoutGalleryIndex = ref(0)
/** 浮层锚点：给出时贴着这个元素弹（鼠标悬停菜单项时用），给不出就居中显示 */
export const layoutGalleryAnchor = ref<{ x: number; y: number; h: number } | null>(null)

export function openLayoutGallery(index: number, anchorEl?: HTMLElement | null) {
  layoutGalleryIndex.value = index
  if (anchorEl) {
    const r = anchorEl.getBoundingClientRect()
    layoutGalleryAnchor.value = { x: r.right + 6, y: r.top, h: r.height }
  } else {
    layoutGalleryAnchor.value = null
  }
  layoutGalleryOpen.value = true
}
export function closeLayoutGallery() {
  layoutGalleryOpen.value = false
}
