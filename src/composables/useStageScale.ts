import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/**
 * 固定舞台缩放：内容始终按 1920×1080 设计，整体 transform: scale() 适配容器，
 * 允许留边（letterbox），绝不按设备重排内容。
 */
export function useStageScale(
  container: Ref<HTMLElement | null>,
  stageW: number,
  stageH: number,
  padding = 48,
) {
  const scale = ref(1)
  let observer: ResizeObserver | null = null

  function compute() {
    const el = container.value
    if (!el) return
    const r = el.getBoundingClientRect()
    const availW = Math.max(1, r.width - padding * 2)
    const availH = Math.max(1, r.height - padding * 2)
    scale.value = Math.min(availW / stageW, availH / stageH)
  }

  onMounted(() => {
    compute()
    if (typeof ResizeObserver !== 'undefined' && container.value) {
      observer = new ResizeObserver(compute)
      observer.observe(container.value)
    }
    window.addEventListener('resize', compute)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    window.removeEventListener('resize', compute)
  })

  return { scale, recompute: compute }
}
