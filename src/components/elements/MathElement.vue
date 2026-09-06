<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { MathElement } from '@/types'
import { fitMath, renderLatex } from '@/composables/useMathJax'

const props = defineProps<{ el: MathElement }>()

const host = ref<HTMLElement | null>(null)
const error = ref('')
let timer: number | undefined
/** 渲染串行化：避免输入时多次 renderLatex 并发、把多个 mjx-container 叠进同一个宿主 */
let rendering = false
let pending = false
let ro: ResizeObserver | null = null
let raf = 0

/** 拖动外框缩放时（useDragResize 直写 DOM 尺寸、不更新 store），
 *  宿主实际尺寸变化即重新缩放公式，实现“拖动中实时放大/缩小”。 */
function watchSize() {
  ro?.disconnect()
  const node = host.value
  if (!node || typeof ResizeObserver === 'undefined') return
  ro = new ResizeObserver(() => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => { if (host.value) fitMath(host.value) })
  })
  ro.observe(node)
}

async function run() {
  if (rendering) {
    pending = true
    return
  }
  rendering = true
  try {
    do {
      pending = false
      const node = host.value
      if (!node) continue
      const latex = (props.el.latex || '').trim()
      error.value = ''
      if (!latex) {
        node.innerHTML = ''
        continue
      }
      // 等一帧确保宿主节点已挂载（元素宿主绝不能 v-if 卸载）
      await nextTick()
      try {
        await renderLatex(node, latex, props.el.fontSize)
      } catch (e) {
        error.value = e instanceof Error ? e.message : String(e)
      }
    } while (pending)
  } finally {
    rendering = false
  }
}

/** 输入与尺寸变化都防抖：MathJax 排版有成本，不能每帧都跑 */
function schedule(delay = 160) {
  clearTimeout(timer)
  timer = setTimeout(run, delay) as unknown as number
}

onMounted(() => { watchSize(); run() })
onBeforeUnmount(() => { clearTimeout(timer); ro?.disconnect() })

watch(
  () => [
    props.el.latex,
    props.el.fontSize,
    props.el.color,
    Math.round(props.el.w),
    Math.round(props.el.h),
  ],
  () => schedule(),
)
</script>

<!--
  注意：宿主 div 绝不能用 v-if / v-else 条件卸载。
  一旦被卸载，ref 会变 null，而 Vue 的 DOM 更新是异步的，
  后续重渲染读到的 host 仍是 null，导致再也恢复不了。
  错误提示改为覆盖在上面，宿主始终挂载。
-->
<template>
  <div class="math-el" :style="{ color: el.color }">
    <div ref="host" class="math-el__host"></div>
    <div v-if="error" class="math-el__err">公式渲染失败：{{ error }}</div>
  </div>
</template>

<style scoped>
.math-el {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
}
.math-el__host {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.math-el__host :deep(mjx-container) {
  display: inline-flex !important;
  max-width: none;
}
.math-el__err {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  box-sizing: border-box;
  text-align: center;
  font-size: 13px;
  line-height: 1.5;
  color: #a32d2d;
  background: #fcebeb;
}
</style>
