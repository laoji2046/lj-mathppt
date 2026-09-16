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
/**
 * **三维图接收口** —— 让「试卷 / 讲义」也能插入三维立体图。
 *
 * 背景：Geom3DDialog.insert() 默认是**直接写进当前幻灯片**；
 * 它挂在 App.vue，试卷也在 App.vue，两边拿不到彼此的产物。
 *
 * 做法照 MathFigurePalette 的 figPaletteSink：谁要接收就先登记一个回调，
 * 对话框插入时**优先走接收口**，没人登记才走原来的「插到当前页」。
 * 这样**对话框的原有行为一字未改**。
 */
export const geom3dSink = ref<null | ((svg: string, label: string) => void)>(null)
