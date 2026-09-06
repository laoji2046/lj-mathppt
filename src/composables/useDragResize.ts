import type { Ref } from 'vue'
import type { Rect } from '@/types'
import { computeSnap, type Guide } from './useSnap'

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
type Mode = 'move' | 'resize'

const MIN_SIZE = 16

export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export interface DragItem {
  id: string
  rect: Rect
}

interface Options {
  /** 舞台根节点，用于按 data-el-id 查到真实 DOM 节点 */
  stage: Ref<HTMLElement | null>
  /** 被拖拽的元素及其起始矩形（move 时为整个选区） */
  getItems: () => DragItem[]
  /** 选区外接框，吸附判定用它 */
  getBounds: () => Rect | null
  /** 参与吸附的静态元素矩形（未选中元素） */
  getTargets: () => Rect[]
  getStageSize: () => { w: number; h: number }
  getScale: () => number
  /** 吸附阈值（屏幕像素） */
  getSnapThreshold: () => number
  onCommit: (changes: { id: string; rect: Rect }[]) => void
  /** 吸附参考线变化（拖拽结束会收到空数组） */
  onGuides?: (guides: Guide[]) => void
}

export function useDragResize(opts: Options) {
  let cleanup: (() => void) | null = null

  function start(e: PointerEvent, mode: Mode, handle: Handle = 'se') {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()

    const items0 = opts.getItems().map((it) => ({ id: it.id, rect: { ...it.rect } }))
    if (!items0.length) return

    const startX = e.clientX
    const startY = e.clientY
    const scale = opts.getScale() || 1
    const bounds0 = opts.getBounds() ? { ...opts.getBounds()! } : null
    const targets = opts.getTargets()

    // 缓存 DOM 节点，避免每帧 querySelector
    const nodes = new Map<string, HTMLElement>()
    const stageEl = opts.stage.value
    if (stageEl) {
      stageEl.querySelectorAll<HTMLElement>('[data-el-id]').forEach((n) => {
        const id = n.dataset.elId
        if (id) nodes.set(id, n)
      })
    }

    let latest: DragItem[] = items0.map((it) => ({ id: it.id, rect: { ...it.rect } }))

    const onMove = (ev: PointerEvent) => {
      let dx = (ev.clientX - startX) / scale
      let dy = (ev.clientY - startY) / scale

      if (mode === 'move') {
        // 整体移动：先算原始位移，再对「选区外接框」做吸附修正
        let snapDx = 0
        let snapDy = 0
        let guides: Guide[] = []

        if (bounds0) {
          const moved: Rect = { ...bounds0, x: bounds0.x + dx, y: bounds0.y + dy }
          const snap = computeSnap(moved, {
            stage: opts.getStageSize(),
            targets,
            threshold: opts.getSnapThreshold() / scale,
          })
          snapDx = snap.dx
          snapDy = snap.dy
          guides = snap.guides
        }
        opts.onGuides?.(guides)

        dx += snapDx
        dy += snapDy

        latest = items0.map((it) => ({
          id: it.id,
          rect: {
            x: Math.round(it.rect.x + dx),
            y: Math.round(it.rect.y + dy),
            w: it.rect.w,
            h: it.rect.h,
          },
        }))
      } else {
        // 缩放：只作用于单个元素
        const r0 = items0[0].rect
        let { x, y, w, h } = r0
        if (handle.includes('e')) w = r0.w + dx
        if (handle.includes('s')) h = r0.h + dy
        if (handle.includes('w')) { w = r0.w - dx; x = r0.x + dx }
        if (handle.includes('n')) { h = r0.h - dy; y = r0.y + dy }
        if (w < MIN_SIZE) {
          if (handle.includes('w')) x = r0.x + r0.w - MIN_SIZE
          w = MIN_SIZE
        }
        if (h < MIN_SIZE) {
          if (handle.includes('n')) y = r0.y + r0.h - MIN_SIZE
          h = MIN_SIZE
        }
        latest = [{
          id: items0[0].id,
          rect: { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) },
        }]
      }

      // 拖拽期间直接写 DOM，不触发 Vue 重渲染
      for (const it of latest) {
        const node = nodes.get(it.id)
        if (!node) continue
        node.style.left = `${it.rect.x}px`
        node.style.top = `${it.rect.y}px`
        node.style.width = `${it.rect.w}px`
        node.style.height = `${it.rect.h}px`
      }
    }

    const onUp = () => {
      detach()
      opts.onGuides?.([])
      const changed = latest.filter((l) => {
        const o = items0.find((i) => i.id === l.id)
        if (!o) return false
        return o.rect.x !== l.rect.x || o.rect.y !== l.rect.y ||
               o.rect.w !== l.rect.w || o.rect.h !== l.rect.h
      })
      if (changed.length) opts.onCommit(changed)
    }

    function detach() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      cleanup = null
      document.body.classList.remove('is-dragging')
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    document.body.classList.add('is-dragging')
    cleanup = detach
  }

  return { start, dispose: () => cleanup?.() }
}
