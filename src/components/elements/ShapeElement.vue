<script setup lang="ts">
import { computed } from 'vue'
import type { ShapeElement } from '@/types'

const props = defineProps<{ el: ShapeElement }>()

const style = computed(() => {
  const e = props.el
  const dash = e.strokeDash || 'solid'
  const bs = dash === 'dotted' ? 'dotted' : dash === 'solid' ? 'solid' : 'dashed'
  return {
    background: e.fill,
    border: e.strokeWidth > 0 ? `${e.strokeWidth}px ${bs} ${e.stroke}` : 'none',
    borderRadius: e.shape === 'ellipse' ? '50%' : (e.cornerRadius ?? 4) + 'px',
  }
})
</script>

<template>
  <div class="shape-el" :style="style"></div>
</template>

<style scoped>
.shape-el {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}
</style>
