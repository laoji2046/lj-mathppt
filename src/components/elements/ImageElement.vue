<script setup lang="ts">
import { computed } from 'vue'
import type { ImageElement } from '@/types'
import { imageEffectCss } from '@/types'

const props = defineProps<{ el: ImageElement }>()
// 单一字符串 style：闭包 objectFit + 图片特效（Vue 数组 style 会丢弃字符串项）
const imgStyle = computed(() => {
  const fx = imageEffectCss(props.el)
  return 'object-fit:' + props.el.fit + (fx ? ';' + fx : '')
})
</script>

<template>
  <div class="image-el">
    <img v-if="el.src" :src="el.src" :style="imgStyle" alt="" draggable="false" />
    <div v-else class="image-el__empty">未选择图片<br /><small>在右侧属性面板填入地址</small></div>
  </div>
</template>

<style scoped>
.image-el {
  width: 100%;
  height: 100%;
  overflow: visible; /* 让发光/映像等特效溢出到元素外 */
  border-radius: 4px;
}
.image-el img {
  width: 100%;
  height: 100%;
  display: block;
  user-select: none;
  border-radius: 4px;
}
.image-el__empty {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #f1efe8;
  color: #888780;
  font-size: 14px;
  text-align: center;
  line-height: 1.6;
}
</style>
