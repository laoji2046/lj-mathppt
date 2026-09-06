<script setup lang="ts">
import { computed, ref } from 'vue'
import type { LineElement, SlideElement } from '@/types'
import { lineDashCss } from '@/types'
import { shapeEdit } from '@/ui/shapeEditor'

const props = defineProps<{ el: LineElement; selected?: boolean }>()
const emit = defineEmits<{ (e: 'update', p: Partial<SlideElement>): void }>()

const box = ref<HTMLElement | null>(null)
const showHandles = computed(() => !!props.selected || shapeEdit.value.id === props.el.id)
/** 两个归一化端点，默认左上->右下 */
const pts = computed(() => (props.el.points && props.el.points.length >= 4 ? props.el.points : [0, 0, 1, 1]))
const p0 = computed(() => ({ x: pts.value[0] * props.el.w, y: pts.value[1] * props.el.h }))
const p1 = computed(() => ({ x: pts.value[2] * props.el.w, y: pts.value[3] * props.el.h }))

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
  <div ref="box" class="line-el">
    <svg
      :viewBox="`0 0 ${el.w} ${el.h}`"
      width="100%"
      height="100%"
      preserveAspectRatio="none"
    >
      <line
        :x1="p0.x" :y1="p0.y" :x2="p1.x" :y2="p1.y"
        :stroke="el.stroke" :stroke-width="el.strokeWidth" :stroke-dasharray="lineDashCss(el.strokeDash)"
        stroke-linecap="round" vector-effect="non-scaling-stroke"
      />
    </svg>
    <template v-if="showHandles">
      <span class="ln-handle" :style="{ left: p0.x + 'px', top: p0.y + 'px' }" @pointerdown.stop="onDown($event, 0)" @pointermove="onMove($event, 0)" @pointerup="onUp"></span>
      <span class="ln-handle" :style="{ left: p1.x + 'px', top: p1.y + 'px' }" @pointerdown.stop="onDown($event, 1)" @pointermove="onMove($event, 1)" @pointerup="onUp"></span>
    </template>
  </div>
</template>

<style scoped>
.line-el { width: 100%; height: 100%; box-sizing: border-box; position: relative; }
.line-el svg { display: block; overflow: visible; }
.ln-handle {
  position: absolute; width: 12px; height: 12px; margin: -6px 0 0 -6px;
  background: #fff; border: 2px solid var(--brand); border-radius: 50%;
  cursor: move; box-shadow: 0 1px 4px rgba(0,0,0,0.3); z-index: 3; box-sizing: border-box;
}
.ln-handle:hover { background: var(--brand-soft); transform: scale(1.15); }
</style>
