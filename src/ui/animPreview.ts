import { ref } from 'vue'
import type { AnimIn } from '@/types'

/**
 * 动画预览：面板点「预览」时，把"给哪个元素放哪种入场动画"写在这里，
 * ElementFrame 读到就给内层挂上对应的 CSS 类 —— 纯 CSS 跑一遍，不动数据、不重排。
 * 播完自动清掉，方便反复点。
 */
export const animPreview = ref<{ id: string; kind: AnimIn; n: number } | null>(null)
let timer: number | undefined

export function playAnimPreview(id: string, kind: AnimIn) {
  if (!id || kind === 'none') return
  animPreview.value = null
  // 先清空再下一帧挂上，这样连点同一个效果也能重新播（否则类名没变化，动画不会重跑）
  requestAnimationFrame(() => {
    animPreview.value = { id, kind, n: (animPreview.value?.n ?? 0) + 1 }
    window.clearTimeout(timer)
    timer = window.setTimeout(() => { animPreview.value = null }, 1400)
  })
}
