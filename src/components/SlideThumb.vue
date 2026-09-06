<script setup lang="ts">
import type { Slide, SlideElement } from '@/types'

const props = defineProps<{ slide: Slide; width: number; height: number }>()

function style(el: SlideElement) {
  const k = props.width / 1920
  const base = {
    position: 'absolute' as const,
    left: el.x * k + 'px',
    top: el.y * k + 'px',
    width: el.w * k + 'px',
    height: el.h * k + 'px',
    overflow: 'hidden' as const,
  }
  if (el.type === 'text') return { ...base, color: el.color, fontSize: Math.max(3, el.fontSize * k) + 'px' }
  if (el.type === 'shape') return { ...base, background: el.fill, borderRadius: el.shape === 'ellipse' ? '50%' : '1px' }
  if (el.type === 'math') return { ...base, background: 'repeating-linear-gradient(45deg,#e8e4f0,#e8e4f0 3px,#f2effa 3px,#f2effa 6px)', color: '#534ab7' }
  if (el.type === 'geogebra') return { ...base, background: '#ffffff', border: '1px solid #cfcbd8' }
  if (el.type === 'desmos') return { ...base, background: '#f2fbf6', border: '1px solid #bcd9c8' }
  if (el.type === 'image') return { ...base, background: el.src ? `url(${el.src}) center/cover` : '#f1efe8' }
  return base
}
</script>

<template>
  <div class="slide-thumb" :style="{ background: slide.bg, width: width + 'px', height: height + 'px' }">
    <div v-for="el in slide.elements" :key="el.id" :style="style(el)">
      <template v-if="el.type === 'text'">{{ (el as any).text }}</template>
      <template v-if="el.type === 'richtex'">{{ (el as any).text }}</template>
    </div>
  </div>
</template>

<style scoped>
.slide-thumb {
  position: relative;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
  box-sizing: border-box;
}
</style>
