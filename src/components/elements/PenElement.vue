<script setup lang="ts">
import { computed } from 'vue'
import type { PenElement } from '@/types'

const props = defineProps<{ el: PenElement }>()

const pointsStr = computed(() =>
  (props.el.points ?? []).map((p) => `${p.x},${p.y}`).join(' '),
)
</script>

<template>
  <div class="pen-el">
    <svg
      :viewBox="`0 0 ${el.w} ${el.h}`"
      width="100%"
      height="100%"
      preserveAspectRatio="none"
    >
      <polyline
        :points="pointsStr"
        fill="none"
        :stroke="el.stroke"
        :stroke-width="el.strokeWidth"
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
