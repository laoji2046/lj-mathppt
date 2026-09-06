<script setup lang="ts">
import { computed, ref } from 'vue'
import type { MathFigureElement, SlideElement } from '@/types'
import { lineDashCss } from '@/types'
import { shapeEdit } from '@/ui/shapeEditor'

const props = defineProps<{ el: MathFigureElement; selected?: boolean }>()
const emit = defineEmits<{ (e: 'update', patch: Partial<SlideElement>): void }>()

const box = ref<HTMLElement | null>(null)

/** 归一化顶点 → 默认形状 */
const DEF_POLY = [0.5, 0.08, 0.86, 0.29, 0.86, 0.71, 0.5, 0.92, 0.14, 0.71, 0.14, 0.29]
const DEF_BEZIER = [0.06, 0.75, 0.28, 0.08, 0.72, 0.92, 0.94, 0.25]

const editable = computed(() => props.el.kind === 'polygon' || props.el.kind === 'bezier')
const showHandles = computed(() => editable.value && (!!props.selected || shapeEdit.value.id === props.el.id))

/** 当前顶点（归一化）；无存点用默认 */
const pts = computed(() => {
  const p = props.el.points
  if (props.el.kind === 'polygon') return p && p.length >= 6 ? p : DEF_POLY
  if (props.el.kind === 'bezier') return p && p.length >= 8 ? p : DEF_BEZIER
  return p
})

const innerHtml = computed(() => {
  const { w, h, stroke, strokeWidth, fill, kind } = props.el
  const s = strokeWidth || 2
  const dash = lineDashCss(props.el.strokeDash)
  const strokeAttrs = `stroke="${stroke}" stroke-width="${s}" stroke-linecap="round" stroke-linejoin="round"` + (dash ? ` stroke-dasharray="${dash}"` : '')
  const fillColor = fill && fill !== 'transparent' ? fill : 'none'
  const thin = Math.max(1, s * 0.55)
  const dashed = `stroke-dasharray="6 5"`
  const cx = w / 2, cy = h / 2, m = Math.min(w, h)

  function reg(n: number, rx: number, ry: number, rot = -Math.PI / 2) {
    const a: string[] = []
    for (let i = 0; i < n; i++) {
      const ang = rot + (i * 2 * Math.PI) / n
      a.push((cx + rx * Math.cos(ang)).toFixed(1) + ',' + (cy + ry * Math.sin(ang)).toFixed(1))
    }
    return a.join(' ')
  }
  function ptsStr(list: number[]) {
    const a: string[] = []
    for (let i = 0; i < list.length; i += 2) a.push((list[i] * w).toFixed(1) + ',' + (list[i + 1] * h).toFixed(1))
    return a.join(' ')
  }

  switch (kind) {
    case 'parabola':
      return `<path d="M 0 ${h} Q ${w * 0.5} ${-h * 0.9} ${w} ${h}" ${strokeAttrs} fill="none"/>` +
             `<line x1="0" y1="${h * 0.62}" x2="${w}" y2="${h * 0.62}" stroke="${stroke}" stroke-width="${thin}" ${dashed}/>`
    case 'sine':
      return `<path d="M 0 ${h / 2} C ${w * 0.25} ${h * 0.1}, ${w * 0.25} ${h * 0.9}, ${w / 2} ${h / 2} S ${w * 0.75} ${h * 0.1}, ${w} ${h / 2}" ${strokeAttrs} fill="none"/>`
    case 'cosine':
      return `<path d="M 0 ${h * 0.12} C ${w * 0.22} ${h * 0.12}, ${w * 0.22} ${h * 0.88}, ${w / 2} ${h * 0.88} S ${w * 0.78} ${h * 0.12}, ${w} ${h * 0.12}" ${strokeAttrs} fill="none"/>`
    case 'exponential':
      return `<path d="M 0 ${h} C ${w * 0.5} ${h}, ${w * 0.7} ${h * 0.4}, ${w} ${h * 0.06}" ${strokeAttrs} fill="none"/>`
    case 'logarithm':
      return `<path d="M ${w * 0.04} ${h * 0.06} C ${w * 0.3} ${h * 0.3}, ${w * 0.55} ${h * 0.7}, ${w} ${h}" ${strokeAttrs} fill="none"/>`
    case 'coordinate': {
      const axis = `stroke="${stroke}" stroke-width="${s}"`
      let ticks = ''
      for (let i = 1; i < 4; i++) {
        const tx = (w * i) / 4, ty = (h * i) / 4
        ticks += `<line x1="${tx}" y1="${h - 10}" x2="${tx}" y2="${h + 10}" ${axis}/>` +
                 `<line x1="10" y1="${ty}" x2="-10" y2="${ty}" ${axis}/>`
      }
      return `<g>` +
        `<line x1="0" y1="${h}" x2="${w}" y2="${h}" ${axis}/>` +
        `<line x1="0" y1="${h}" x2="0" y2="0" ${axis}/>` +
        `<polygon points="${w},${h} ${w - 12},${h - 6} ${w - 12},${h + 6}" fill="${stroke}"/>` +
        `<polygon points="0,0 12,0 0,12" fill="${stroke}"/>` + ticks + '</g>'
    }
    case 'numberline': {
      const cy = h / 2
      const axis = `stroke="${stroke}" stroke-width="${s}"`
      let ticks = ''
      for (let i = 0; i <= 6; i++) { const tx = (w * i) / 6; ticks += `<line x1="${tx}" y1="${cy - 10}" x2="${tx}" y2="${cy + 10}" ${axis}/>` }
      return `<g>` +
        `<line x1="0" y1="${cy}" x2="${w}" y2="${cy}" ${axis}/>` +
        `<polygon points="0,${cy} 12,${cy - 6} 12,${cy + 6}" fill="${stroke}"/>` +
        `<polygon points="${w},${cy} ${w - 12},${cy - 6} ${w - 12},${cy + 6}" fill="${stroke}"/>` + ticks + '</g>'
    }
    case 'venn': {
      const r = m * 0.26
      return `<circle cx="${w * 0.36}" cy="${cy}" r="${r}" ${strokeAttrs} fill="${fillColor}"/>` +
             `<circle cx="${w * 0.64}" cy="${cy}" r="${r}" ${strokeAttrs} fill="${fillColor}"/>`
    }
    case 'righttriangle':
      return `<polygon points="0,${h} ${w},${h} ${w * 0.12},${h * 0.05}" ${strokeAttrs} fill="${fillColor}"/>`
    case 'angle': {
      const ox = w * 0.12, oy = h * 0.9, len = m * 0.8
      return `<g>` +
        `<line x1="${ox}" y1="${oy}" x2="${ox + len}" y2="${oy}" ${strokeAttrs}/>` +
        `<line x1="${ox}" y1="${oy}" x2="${ox}" y2="${oy - len}" ${strokeAttrs}/>` +
        `<path d="M ${ox + len * 0.25} ${oy} A ${len * 0.25} ${len * 0.25} 0 0 1 ${ox} ${oy - len * 0.25}" ${strokeAttrs} fill="none"/>` + '</g>'
    }
    case 'semicircle':
      return `<path d="M 0 ${h} A ${w / 2} ${h} 0 0 1 ${w} ${h}" ${strokeAttrs} fill="${fillColor}"/>`
    // ---- 常见平面几何 ----
    case 'triangle':
      return `<polygon points="0,${h} ${w},${h} ${w * 0.42},0" ${strokeAttrs} fill="${fillColor}"/>`
    case 'rectangle':
      return `<rect x="${w * 0.02}" y="${h * 0.02}" width="${w * 0.96}" height="${h * 0.96}" ${strokeAttrs} fill="${fillColor}"/>`
    case 'circle':
      return `<circle cx="${cx}" cy="${cy}" r="${m * 0.46}" ${strokeAttrs} fill="${fillColor}"/>`
    case 'pentagon':
      return `<polygon points="${reg(5, m * 0.44, m * 0.44)}" ${strokeAttrs} fill="${fillColor}"/>`
    case 'hexagon':
      return `<polygon points="${reg(6, m * 0.46, m * 0.46)}" ${strokeAttrs} fill="${fillColor}"/>`
    case 'rhombus':
      return `<polygon points="${cx},0 ${w}, ${cy} ${cx},${h} 0,${cy}" ${strokeAttrs} fill="${fillColor}"/>`
    case 'parallelogram':
      return `<polygon points="${w * 0.22},0 ${w},0 ${w * 0.78},${h} 0,${h}" ${strokeAttrs} fill="${fillColor}"/>`
    case 'trapezoid':
      return `<polygon points="${w * 0.24},0 ${w * 0.76},0 ${w},${h} 0,${h}" ${strokeAttrs} fill="${fillColor}"/>`
    case 'star': {
      const pts: string[] = []
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI) / 5
        const r = i % 2 === 0 ? m * 0.46 : m * 0.2
        pts.push((cx + r * Math.cos(ang)).toFixed(1) + ',' + (cy + r * Math.sin(ang)).toFixed(1))
      }
      return `<polygon points="${pts.join(' ')}" ${strokeAttrs} fill="${fillColor}"/>`
    }
    case 'polygon':
      return `<polygon points="${ptsStr(pts.value || DEF_POLY)}" ${strokeAttrs} fill="${fillColor}"/>`
    case 'bezier': {
      const b = pts.value || DEF_BEZIER
      return `<path d="M ${b[0] * w} ${b[1] * h} C ${b[2] * w} ${b[3] * h}, ${b[4] * w} ${b[5] * h}, ${b[6] * w} ${b[7] * h}" ${strokeAttrs} fill="none"/>`
    }
    default:
      return ''
  }
})

// ---- 顶点编辑拖拽（借鉴 Bento：双击顶点删除 / 双击边线插入顶点） ----
const dragging = ref(false)
let dragIdx = -1
let lastDown = { idx: -1, t: 0 }
function normPt(e: { clientX: number; clientY: number }): [number, number] {
  const r = box.value?.getBoundingClientRect()
  if (!r || !r.width || !r.height) return [0, 0]
  return [
    Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
    Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
  ]
}
/** 双击同一句柄（进入顶点编辑后）→ 删除该顶点，多边形最少保留 3 个顶点 */
function onHandleDown(e: PointerEvent, i: number) {
  e.stopPropagation()
  if (props.el.kind === 'polygon' && shapeEdit.value.id === props.el.id && lastDown.idx === i && e.timeStamp - lastDown.t < 400) {
    lastDown.idx = -1
    const p = [...(pts.value || DEF_POLY)]
    if (p.length / 2 > 3) { p.splice(i * 2, 2); emit('update', { points: p }) }
    return
  }
  lastDown = { idx: i, t: e.timeStamp }
  const t = e.currentTarget as HTMLElement
  try { t.setPointerCapture(e.pointerId) } catch {}
  dragIdx = i
  dragging.value = true
}
function onHandleMove(e: PointerEvent, i: number) {
  if (!dragging.value || dragIdx < 0) return
  const [nx, ny] = normPt(e)
  const p = [...(pts.value || DEF_POLY)]
  p[i * 2] = nx; p[i * 2 + 1] = ny
  emit('update', { points: p } as Partial<SlideElement>)
}
function onHandleUp() { dragging.value = false; dragIdx = -1 }
/** 双击多边形边线（进入顶点编辑后）→ 在最近的边上插入一个新顶点 */
function onSvgDbl(e: MouseEvent) {
  if (props.el.kind !== 'polygon' || shapeEdit.value.id !== props.el.id) return
  const p = normPt(e)
  const list = pts.value || DEF_POLY
  const n = list.length / 2
  if (n < 3) return
  let best = Infinity, bestSeg = -1, bestPt: [number, number] = [0, 0]
  for (let i = 0; i < n; i++) {
    const ax = list[i * 2], ay = list[i * 2 + 1]
    const bx = list[((i + 1) % n) * 2], by = list[((i + 1) % n) * 2 + 1]
    const abx = bx - ax, aby = by - ay
    const len2 = abx * abx + aby * aby
    let t = len2 ? ((p[0] - ax) * abx + (p[1] - ay) * aby) / len2 : 0
    t = Math.max(0, Math.min(1, t))
    const px = ax + t * abx, py = ay + t * aby
    const d = (p[0] - px) ** 2 + (p[1] - py) ** 2
    if (d < best) { best = d; bestSeg = i; bestPt = [px, py] }
  }
  if (best > 0.06) return
  const next = [...list.slice(0, (bestSeg + 1) * 2), bestPt[0], bestPt[1], ...list.slice((bestSeg + 1) * 2)]
  emit('update', { points: next } as Partial<SlideElement>)
}
</script>

<template>
  <div ref="box" class="mathfig-el">
    <svg :viewBox="`0 0 ${props.el.w} ${props.el.h}`" width="100%" height="100%" preserveAspectRatio="none" v-html="innerHtml" @dblclick="onSvgDbl"></svg>
    <template v-if="showHandles">
      <span
        v-for="v in (pts ? Math.floor(pts.length / 2) : 0)"
        :key="v"
        class="mf-handle"
        :style="{ left: ((pts ? pts[v * 2] : 0) * props.el.w) + 'px', top: ((pts ? pts[v * 2 + 1] : 0) * props.el.h) + 'px' }"
        @pointerdown.stop="onHandleDown($event, v)"
        @pointermove="onHandleMove($event, v)"
        @pointerup="onHandleUp"
      ></span>
    </template>
  </div>
</template>

<style scoped>
.mathfig-el { width: 100%; height: 100%; box-sizing: border-box; position: relative; }
.mathfig-el svg { display: block; overflow: visible; }
.mf-handle {
  position: absolute;
  width: 12px; height: 12px;
  margin: -6px 0 0 -6px;
  background: #fff;
  border: 2px solid var(--brand);
  border-radius: 50%;
  cursor: move;
  box-shadow: 0 1px 4px rgba(0,0,0,0.3);
  z-index: 3;
  box-sizing: border-box;
}
.mf-handle:hover { background: var(--brand-soft); transform: scale(1.15); }
</style>
