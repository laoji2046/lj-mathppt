import { computed, ref } from 'vue'

/**
 * 画布视图状态（用户缩放倍数 + 平移量）—— 放在共享模块里，让画布和底部状态栏用同一份。
 *
 * 三个量分清楚：
 * - `fitScale`：**适屏比例**，由 useStageScale 按窗口尺寸算出（画布挂载后持续写回）
 * - `zoom`：**用户**再乘上去的倍数，1 = 适屏。所以「复位」回到的是「适屏 + 原点」，不是 1920px 原尺寸
 * - `pan`：屏幕像素位移，对应 transform: translate(...) scale(...) 里的 translate
 *
 * 舞台 CSS 是 `transform-origin: center center` + 视口 flex 居中，所以**绕中心缩放不用调平移**。
 */
export const fitScale = ref(1)
export const zoom = ref(1)
export const pan = ref({ x: 0, y: 0 })

export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 4

/** 画布上真实显示的比例 —— 状态栏那个百分比就是它 */
export const effectiveScale = computed(() => fitScale.value * zoom.value)

/** 按倍率缩放（夹在 25%~400%） */
export function zoomBy(factor: number) {
  const next = zoom.value * factor
  zoom.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(next * 1000) / 1000))
}

/** 复位：回到「适屏 + 平移归零」 */
export function resetView() {
  zoom.value = 1
  pan.value = { x: 0, y: 0 }
}

/** 是否已在默认视图（状态栏用它决定「复位」是否可点） */
export function isDefaultView() {
  return zoom.value === 1 && pan.value.x === 0 && pan.value.y === 0
}
