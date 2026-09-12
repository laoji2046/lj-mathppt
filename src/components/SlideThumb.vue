<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { slideToHtml } from '@/reveal/renderer'
import { typesetMixed } from '@/composables/useMathJax'
import { slideBgCss } from '@/types'

const props = defineProps<{ slide: any; width?: number }>()
const host = ref<HTMLElement | null>(null)
const k = computed(() => (props.width || 160) / 1920)
const bgCss = ref('')
let seq = 0

async function refresh() {
  const s = props.slide
  const my = ++seq
  bgCss.value = s ? slideBgCss(s) : ''
  await nextTick()
  if (my !== seq || !host.value) return
  try {
    let h = s ? slideToHtml(s) : ''
    // 缩略图中把 GeoGebra / PDF 引擎占位换成可识别徽标（缩略图无法运行引擎）
    h = h.replace(/<div class="ggb-host"[^>]*><\/div>/, '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#6a52c8;font-size:14px;font-weight:700">GeoGebra</div>')
    h = h.replace(/<div class="fx-doc"[^>]*><\/div>/, '<div class="fx-doc" style="width:100%;height:100%;background:#f3f1ee;border:1px solid #e3dfd5;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#a33;font-size:14px;font-weight:700">PDF</div>')
    // typesetMixed 设置 innerHTML 并触发 MathJax 排版（对 \(...\) 公式可靠，与编辑器一致）
    await typesetMixed(host.value, h)
  } catch (err) { console.warn('[缩略图] 渲染失败', err) }
}
onMounted(refresh)
// 换页 / 换对象：立刻重画
watch(() => props.slide, refresh)
// 内容变化也要重画：store 里的改动绝大多数是「原地改」——
// applyTemplate 直接换 elements 数组、addElement 原地 push、updateElement 原地 Object.assign，
// 幻灯片对象身份不变，只监听对象引用会漏 → 缩略图会停在挂载时那一版（应用模板后表现为一直空白）。
// 用 deep 监听内容签名，并做 110ms 防抖：属性面板连续微调时不必每一帧都重排。
let debounceTimer: number | undefined
watch(
  () => props.slide && { id: props.slide.id, bg: props.slide.bg, els: props.slide.elements },
  () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = window.setTimeout(refresh, 110)
  },
  { deep: true }
)
onUnmounted(() => { if (debounceTimer) clearTimeout(debounceTimer) })
</script>

<template>
  <div class="slthumb" :style="{ width: '100%', aspectRatio: '16 / 9' }">
    <div ref="host" class="slthumb-inner" :style="{ width: '1920px', height: '1080px', transform: 'scale(' + k + ')', background: bgCss }"></div>
  </div>
</template>

<style scoped>
.slthumb { position: relative; overflow: hidden; border-radius: 4px; background: #fff; }
.slthumb-inner { position: absolute; top: 0; left: 0; transform-origin: top left; }
/* 缩略图内数学块：改为块级显示，避免 flex 让 mjx 尺寸为 0 */
.slthumb-inner :deep(.fx-math) { display: block !important; }
.slthumb-inner :deep(.fx-math mjx-container) { display: block; }
.slthumb-inner :deep(mjx-container) { max-width: 100%; }
.slthumb-inner :deep(mjx-container svg) { width: auto !important; height: auto !important; }
</style>
