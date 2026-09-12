<script setup lang="ts">
/**
 * 主界面图标：统一从 @/ui/icons 取路径，样式也统一在这里，避免各组件各写一份 svg 属性。
 * 用法：<AppIcon name="close" /> / <AppIcon name="trash" :size="13" />
 */
import { computed } from 'vue'
import { ICONS } from '@/ui/icons'

const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 16 })
const markup = computed(() => ICONS[props.name] ?? '')
</script>

<template>
  <svg class="app-icon" :width="size" :height="size" viewBox="0 0 24 24" aria-hidden="true" v-html="markup" />
</template>

<style scoped>
.app-icon {
  display: inline-block;
  vertical-align: -0.16em;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
  pointer-events: none;
}
</style>
