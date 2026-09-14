import { ref } from 'vue'
import type { AnimEm, AnimIn, AnimOut } from '@/types'

/**
 * 动画预览：面板点「预览」时，把"给哪个元素放什么动画"写在这里，ElementFrame 读到就挂对应的 CSS 类。
 * 纯 CSS 跑一遍，不动数据、不重排。
 *
 * 一次预览按「入场 → 强调 → 退场」三段走（跟导出的实际行为一致）：入场时长按用户设的
 * animDuration，强调和退场依次接上。写死时长会把长动画提前掐断（踩过）。
 */
export const animPreview = ref<{
  id: string; kind: AnimIn; em: AnimEm; out: AnimOut; phase: 'in' | 'em' | 'out'; n: number
} | null>(null)
const timers: number[] = []
function clearTimers() { while (timers.length) window.clearTimeout(timers.pop()!) }

export function playAnimPreview(id: string, kind: AnimIn, em: AnimEm = 'none', duration = 550, out: AnimOut = 'none') {
  if (!id) return
  const hasIn = !!kind && kind !== 'none'
  const hasEm = !!em && em !== 'none'
  const hasOut = !!out && out !== 'none'
  if (!hasIn && !hasEm && !hasOut) return
  clearTimers()
  animPreview.value = null
  const dur = Math.max(200, duration)
  // 先清空再下一帧挂上：连点同一个效果也能重新播（否则类名没变，动画不会重跑）
  requestAnimationFrame(() => {
    const base = (animPreview.value?.n ?? 0) + 1
    const showEm = () => {
      if (!hasEm) { showOut(); return }
      animPreview.value = { id, kind, em, out, phase: 'em', n: base + 1 }
      timers.push(window.setTimeout(showOut, dur + 80))
    }
    const showOut = () => {
      if (!hasOut) { animPreview.value = null; return }
      animPreview.value = { id, kind, em, out, phase: 'out', n: base + 2 }
      timers.push(window.setTimeout(() => { animPreview.value = null }, dur + 400))
    }
    if (hasIn) {
      animPreview.value = { id, kind, em, out, phase: 'in', n: base }
      timers.push(window.setTimeout(showEm, dur + 80))
    } else if (hasEm) { showEm() } else { showOut() }
  })
}
