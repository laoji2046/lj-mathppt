/**
 * 浮层定位：把浮层**夹进视口**，不让它被屏幕边缘裁掉。
 *
 * 为什么需要：右键菜单 / 版式浮窗原来直接按"鼠标坐标"或"贴着缩略图右边"定位 ✗，
 * 缩略图靠下时菜单下半截就跑到屏幕外了（用户实测）。
 * 规则：默认仍从给定点开始；右边/下边放不下就**往回收**（收到留白 8px 为止）。
 * 两处共用这一份 —— 免得各自修各自的 ✓。
 */
export interface PopoverBox { x: number; y: number }

export function placeInViewport(el: HTMLElement, x: number, y: number, gap = 8): PopoverBox {
  const r = el.getBoundingClientRect()
  const vw = window.innerWidth || document.documentElement.clientWidth
  const vh = window.innerHeight || document.documentElement.clientHeight
  let nx = x
  let ny = y
  if (nx + r.width + gap > vw) nx = Math.max(gap, vw - r.width - gap)
  if (ny + r.height + gap > vh) ny = Math.max(gap, vh - r.height - gap)
  return { x: Math.round(nx), y: Math.round(ny) }
}
