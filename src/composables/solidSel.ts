// 立体图形子选中：当前选中了哪个元素的哪个顶点 / 边 / 面（编辑器与右侧属性面板共享）
import { reactive } from 'vue'

export const solidSel = reactive<{ elementId: string | null; vertex: number | null; edge: number | null; face: number | null }>({
  elementId: null, vertex: null, edge: null, face: null,
})
export function selectSolidVertex(elementId: string, idx: number) {
  solidSel.elementId = elementId; solidSel.vertex = idx; solidSel.edge = null; solidSel.face = null
}
export function selectSolidEdge(elementId: string, idx: number) {
  solidSel.elementId = elementId; solidSel.vertex = null; solidSel.edge = idx; solidSel.face = null
}
export function selectSolidFace(elementId: string, idx: number) {
  solidSel.elementId = elementId; solidSel.vertex = null; solidSel.edge = null; solidSel.face = idx
}
export function clearSolidSel() {
  solidSel.elementId = null; solidSel.vertex = null; solidSel.edge = null; solidSel.face = null
}
