import { ref } from 'vue'
import { requireAddon } from '@/addons/registry'

/** 三维立体图弹窗：把「顶点 + 面表」的三维几何描述投影成可编辑的数学图形。
 *  跟「图片转图形」互补 —— 那条路是像素级识别（只有一张图时用），这条路是几何算：
 *  虚实由面表算出来，不靠猜。 */
export const geom3dOpen = ref(false)
/** 要「继续编辑」的元素 id（从画布上那个三维图形回来时带） */
export const geom3dEditId = ref<string | null>(null)

export function openGeom3D(editId: string | null = null) {
  if (!requireAddon('geom3d')) return
  geom3dEditId.value = editId
  geom3dOpen.value = true
}
export function closeGeom3D() {
  geom3dOpen.value = false
  geom3dEditId.value = null
}