import { ref } from 'vue'

/**
 * 就地编辑请求：文本元素的双击可能被元素框的指针捕获（拖拽）吃掉，
 * 因此统一在 ElementFrame 层捕获双击，再通过这里通知对应子元素进入编辑。
 */
export const inlineEditReq = ref<{ id: string; n: number }>({ id: '', n: 0 })

export function requestInlineEdit(id: string) {
  inlineEditReq.value = { id, n: inlineEditReq.value.n + 1 }
}
