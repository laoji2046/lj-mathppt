<script setup lang="ts">
import { computed } from 'vue'
import type { ImageElement } from '@/types'
import { imageEffectCss, imageMaskCss } from '@/types'

const props = defineProps<{ el: ImageElement }>()
// 单一字符串 style：闭包 objectFit + 图片特效（Vue 数组 style 会丢弃字符串项）
const imgStyle = computed(() => {
  const fx = imageEffectCss(props.el)
  return 'object-fit:' + props.el.fit + (fx ? ';' + fx : '')
})
/** 裁剪为形状加在"裁剪框"这层（图片可能被非破坏性裁剪放大，蒙版按元素框算才对） */
const clipStyle = computed(() => imageMaskCss(props.el))
</script>

<template>
  <div class="image-el">
    <!-- 裁剪框：非破坏性裁剪靠它把放大的图裁回来；形状蒙版也挂在这一层 -->
    <div v-if="el.src" class="image-el__clip" :style="clipStyle">
      <img :src="el.src" :style="imgStyle" alt="" draggable="false" />
    </div>
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
.image-el__clip { width: 100%; height: 100%; overflow: hidden; border-radius: 4px; }
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
