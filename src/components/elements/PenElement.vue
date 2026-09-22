<script setup lang="ts">
import { computed } from 'vue'
import type { PenElement } from '@/types'
import { lineDashCss } from '@/types'

const props = defineProps<{ el: PenElement }>()

const pointsStr = computed(() =>
  (props.el.points ?? []).map((p) => `${p.x},${p.y}`).join(' '),
)
/** 【v1507】闭合 = 多边形（首尾相连 ✓）+ 可填充；不闭合 = 折线/笔迹 ✓ */
const closed = computed(() => !!props.el.closed)
const fill = computed(() => {
  const f = String(props.el.fill || '').trim()
  return f && f !== 'none' ? f : 'none'
})
</script>

<template>
  <div class="pen-el">
    <svg
      :viewBox="`0 0 ${el.w} ${el.h}`"
      width="100%"
      height="100%"
      preserveAspectRatio="none"
    >
      <polygon
        v-if="closed"
        :points="pointsStr"
        :fill="fill"
        :stroke="el.stroke"
        :stroke-width="el.strokeWidth"
        :stroke-dasharray="lineDashCss(el.strokeDash)"
        stroke-linecap="round"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      />
      <polyline
        v-else
        :points="pointsStr"
        :fill="fill"
        :stroke="el.stroke"
        :stroke-width="el.strokeWidth"
        :stroke-dasharray="lineDashCss(el.strokeDash)"
        stroke-linecap="round"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      />
    </svg>
  </div>
</template>

<style scoped>
.pen-el {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}
.pen-el svg {
  display: block;
  overflow: visible;
}
</style>
