import type { Rect } from '@/types'

/** 参考线：axis='x' 为竖线（按 x 坐标画），axis='y' 为横线 */
export interface Guide {
  pos: number
  axis: 'x' | 'y'
}

export interface SnapOptions {
  stage: { w: number; h: number }
  /** 参与吸附的静态矩形（未被拖拽的元素） */
  targets: Rect[]
  /** 吸附阈值，设计坐标系下的像素 */
  threshold: number
}

export interface SnapResult {
  dx: number
  dy: number
  guides: Guide[]
}

/**
 * 计算拖拽框相对静态元素/页面的吸附偏移。
 *
 * 规则：把拖拽框的 左/水平中/右 三条竖边 与 上/垂直中/下 三条横边，
 * 分别去对齐所有静态矩形的对应边，取「位移绝对值最小」的那一条。
 * 页面边界与页面中心也参与吸附。
 */
export function computeSnap(moving: Rect, opts: SnapOptions): SnapResult {
  const page: Rect = { x: 0, y: 0, w: opts.stage.w, h: opts.stage.h }
  const statics = [...opts.targets, page]

  const vLines: number[] = []
  const hLines: number[] = []
  for (const r of statics) {
    vLines.push(r.x, r.x + r.w / 2, r.x + r.w)
    hLines.push(r.y, r.y + r.h / 2, r.y + r.h)
  }

  const movingV = [moving.x, moving.x + moving.w / 2, moving.x + moving.w]
  const movingH = [moving.y, moving.y + moving.h / 2, moving.y + moving.h]

  const best = { dx: 0, dy: 0, hasX: false, hasY: false }

  for (const line of vLines) {
    for (const edge of movingV) {
      const d = line - edge
      if (Math.abs(d) <= opts.threshold) {
        if (!best.hasX || Math.abs(d) < Math.abs(best.dx)) {
          best.dx = d
          best.hasX = true
        }
      }
    }
  }
  for (const line of hLines) {
    for (const edge of movingH) {
      const d = line - edge
      if (Math.abs(d) <= opts.threshold) {
        if (!best.hasY || Math.abs(d) < Math.abs(best.dy)) {
          best.dy = d
          best.hasY = true
        }
      }
    }
  }

  // 吸附后，拖拽框上落在参考线位置的那些边
  const guides: Guide[] = []
  if (best.hasX) {
    const snapped = movingV.map((v) => v + best.dx)
    for (const line of vLines) {
      if (snapped.some((v) => Math.abs(v - line) < 0.5)) guides.push({ pos: line, axis: 'x' })
    }
  }
  if (best.hasY) {
    const snapped = movingH.map((v) => v + best.dy)
    for (const line of hLines) {
      if (snapped.some((v) => Math.abs(v - line) < 0.5)) guides.push({ pos: line, axis: 'y' })
    }
  }

  return { dx: best.hasX ? best.dx : 0, dy: best.hasY ? best.dy : 0, guides }
}
