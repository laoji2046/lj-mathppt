<script setup lang="ts">
import { computed } from 'vue'
import type { IconElement } from '@/types'

const props = defineProps<{ el: IconElement }>()
const fontSize = computed(() => Math.round(Math.min(props.el.w, props.el.h) * 0.72))
</script>

<template>
  <div class="icon-el" :style="{ color: el.color, fontSize: fontSize + 'px' }">{{ el.icon }}</div>
</template>

<style scoped>
.icon-el { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; line-height: 1; overflow: hidden; }
</style>
