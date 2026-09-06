<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ArrowElement, SlideElement } from '@/types'
import { lineDashCss } from '@/types'
import { shapeEdit } from '@/ui/shapeEditor'

const props = defineProps<{ el: ArrowElement; selected?: boolean }>()
const emit = defineEmits<{ (e: 'update', p: Partial<SlideElement>): void }>()

const box = ref<HTMLElement | null>(null)
const showHandles = computed(() => !!props.selected || shapeEdit.value.id === props.el.id)
const pts = computed(() => (props.el.points && props.el.points.length >= 4 ? props.el.points : [0.08, 0.5, 0.92, 0.5]))
const p0 = computed(() => ({ x: pts.value[0] * props.el.w, y: pts.value[1] * props.el.h }))
const p1 = computed(() => ({ x: pts.value[2] * props.el.w, y: pts.value[3] * props.el.h }))

const arrow = computed(() => {
  const st = props.el.strokeWidth || 3
  const ax = p0.value.x, ay = p0.value.y, tx = p1.value.x, ty = p1.value.y
  const dx = tx - ax, dy = ty - ay
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len, uy = dy / len
  const size = Math.max(8, st * 3.2)
  const style = props.el.arrowHead || 'triangle'

  const wings = (tipX: number, tipY: number, dirX: number, dirY: number) => {
    const w1x = tipX - dirX * size + (-dirY) * size * 0.55
    const w1y = tipY - dirY * size + dirX * size * 0.55
    const w2x = tipX - dirX * size - (-dirY) * size * 0.55
    const w2y = tipY - dirY * size - dirX * size * 0.55
    return { w1x, w1y, w2x, w2y }
  }
  let sx1 = ax, sy1 = ay, sx2 = tx, sy2 = ty
  let headPoly = '', headPath = '', head2Poly = ''
  if (style !== 'none') {
    sx2 = tx - ux * size * 0.4; sy2 = ty - uy * size * 0.4
    if (style === 'double') { sx1 = ax + ux * size * 0.4; sy1 = ay + uy * size * 0.4 }
  }
  if (style === 'triangle') {
    const w = wings(tx, ty, ux, uy)
    headPoly = [tx + ',' + ty, w.w1x + ',' + w.w1y, w.w2x + ',' + w.w2y].join(' ')
  } else if (style === 'stealth') {
    const w = wings(tx, ty, ux, uy)
    headPoly = [tx + ',' + ty, w.w1x + ',' + w.w1y, (tx - ux * size * 0.65) + ',' + (ty - uy * size * 0.65), w.w2x + ',' + w.w2y].join(' ')
  } else if (style === 'open') {
    const w = wings(tx, ty, ux, uy)
    headPath = 'M ' + tx + ' ' + ty + ' L ' + w.w1x + ' ' + w.w1y + ' M ' + tx + ' ' + ty + ' L ' + w.w2x + ' ' + w.w2y
  } else if (style === 'double') {
    const w1 = wings(tx, ty, ux, uy)
    headPoly = [tx + ',' + ty, w1.w1x + ',' + w1.w1y, w1.w2x + ',' + w1.w2y].join(' ')
    const w0 = wings(ax, ay, -ux, -uy)
    head2Poly = [ax + ',' + ay, w0.w1x + ',' + w0.w1y, w0.w2x + ',' + w0.w2y].join(' ')
  }
  return { line: { x1: sx1, y1: sy1, x2: sx2, y2: sy2 }, headPoly, headPath, head2Poly }
})

let dragIdx = -1
function onDown(e: PointerEvent, i: number) {
  e.stopPropagation()
  try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch {}
  dragIdx = i
}
function onMove(e: PointerEvent, i: number) {
  if (dragIdx < 0) return
  const r = box.value?.getBoundingClientRect()
  if (!r || !r.width || !r.height) return
  const nx = (e.clientX - r.left) / r.width
  const ny = (e.clientY - r.top) / r.height
  const p = [...pts.value]
  p[i * 2] = nx; p[i * 2 + 1] = ny
  emit('update', { points: p, rot: 0 } as Partial<SlideElement>)
}
function onUp() { dragIdx = -1 }
</script>

<template>
  <div ref="box" class="arrow-el">
    <svg :viewBox="`0 0 ${el.w} ${el.h}`" width="100%" height="100%" preserveAspectRatio="none">
      <line :x1="arrow.line.x1" :y1="arrow.line.y1" :x2="arrow.line.x2" :y2="arrow.line.y2"
        :stroke="el.stroke" :stroke-width="el.strokeWidth" :stroke-dasharray="lineDashCss(el.strokeDash)"
        stroke-linecap="round" vector-effect="non-scaling-stroke" />
      <polygon v-if="arrow.headPoly" :points="arrow.headPoly" :fill="el.stroke" />
      <path v-if="arrow.headPath" :d="arrow.headPath" :stroke="el.stroke" :stroke-width="Math.max(2, el.strokeWidth * 0.9)" fill="none" stroke-linecap="round" />
      <polygon v-if="arrow.head2Poly" :points="arrow.head2Poly" :fill="el.stroke" />
    </svg>
    <template v-if="showHandles">
      <span class="ar-handle" :style="{ left: p0.x + 'px', top: p0.y + 'px' }" @pointerdown.stop="onDown($event, 0)" @pointermove="onMove($event, 0)" @pointerup="onUp"></span>
      <span class="ar-handle" :style="{ left: p1.x + 'px', top: p1.y + 'px' }" @pointerdown.stop="onDown($event, 1)" @pointermove="onMove($event, 1)" @pointerup="onUp"></span>
    </template>
  </div>
</template>

<style scoped>
.arrow-el { width: 100%; height: 100%; box-sizing: border-box; position: relative; }
.arrow-el svg { display: block; overflow: visible; }
.ar-handle {
  position: absolute; width: 12px; height: 12px; margin: -6px 0 0 -6px;
  background: #fff; border: 2px solid var(--brand); border-radius: 50%;
  cursor: move; box-shadow: 0 1px 4px rgba(0,0,0,0.3); z-index: 3; box-sizing: border-box;
}
.ar-handle:hover { background: var(--brand-soft); transform: scale(1.15); }
</style>
