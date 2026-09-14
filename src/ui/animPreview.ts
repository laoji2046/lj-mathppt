import { ref } from 'vue'
import type { AnimEm, AnimIn } from '@/types'

/**
 * 动画预览：面板点「预览」时，把"给哪个元素放什么动画"写在这里，ElementFrame 读到就挂对应的 CSS 类。
 * 纯 CSS 跑一遍，不动数据、不重排。
 *
 * 一次预览按"入场 → 强调"两段走（跟导出的行为一致）：先播入场，入场时长过后切到强调，最后清掉。
 */
export const animPreview = ref<{ id: string; kind: AnimIn; em: AnimEm; phase: 'in' | 'em'; n: number } | null>(null)
let t1: number | undefined
let t2: number | undefined

export function playAnimPreview(id: string, kind: AnimIn, em: AnimEm = 'none') {
  if (!id) return
  const hasIn = kind && kind !== 'none'
  const hasEm = em && em !== 'none'
  if (!hasIn && !hasEm) return
  window.clearTimeout(t1)
  window.clearTimeout(t2)
  animPreview.value = null
  // 先清空再下一帧挂上：连点同一个效果也能重新播（否则类名没变，动画不会重跑）
  requestAnimationFrame(() => {
    const n = (animPreview.value?.n ?? 0) + 1
    if (hasIn) {
      animPreview.value = { id, kind, em, phase: 'in', n }
      t1 = window.setTimeout(() => showEm(), 620)
    } else {
      showEm()
    }
  })
  function showEm() {
    if (!hasEm) {
      animPreview.value = null
      return
    }
    animPreview.value = { id, kind, em, phase: 'em', n: (animPreview.value?.n ?? 0) + 1 }
    t2 = window.setTimeout(() => { animPreview.value = null }, 1600)
  }
}
