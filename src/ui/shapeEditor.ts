import { ref } from 'vue'

/** 正在编辑顶点的图形元素 id（贝塞尔曲线 / 自定义多边形）。
 *  双击元素进入顶点编辑；点击其它元素/空白或按 Esc 退出。 */
export const shapeEdit = ref<{ id?: string }>({ id: undefined })

export function openShapeEdit(id: string) {
  shapeEdit.value = { id }
}
export function closeShapeEdit() {
  shapeEdit.value = { id: undefined }
}
