<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { MathElement } from '@/types'
import { fitCap } from '@/types'
import { fitMath, renderLatex } from '@/composables/useMathJax'
import { inlineEditReq } from '@/ui/inlineEdit'
import InlineEditor from '../InlineEditor.vue'

const props = defineProps<{ el: MathElement }>()
const emit = defineEmits<{ (e: 'update', patch: Partial<MathElement>): void }>()

const host = ref<HTMLElement | null>(null)
const editing = ref(false)
const error = ref('')
let timer: number | undefined
/** 渲染串行化：避免输入时多次 renderLatex 并发、把多个 mjx-container 叠进同一个宿主 */
let rendering = false
let pending = false
let ro: ResizeObserver | null = null
let raf = 0

/** 拖动外框缩放时（useDragResize 直写 DOM 尺寸、不更新 store），
 *  宿主实际尺寸变化即重新缩放公式，实现“拖动中实时放大/缩小”。 */
/** 缩放上限（见 types 的 fitCap）：'fill' 最多放大到 4 倍；'shrink' 只缩小不放大 */
const cap = computed(() => fitCap(props.el))

function watchSize() {
  ro?.disconnect()
  const node = host.value
  if (!node || typeof ResizeObserver === 'undefined') return
  ro = new ResizeObserver(() => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => { if (host.value) fitMath(host.value, cap.value) })
  })
  ro.observe(node)
  // 公式 SVG 自身的尺寸变化也要监听：MathJax 是异步排版的，宿主尺寸没变但内容可能变大，
  // 那样就发现不了（结果就是 transform 后溢出、被 overflow:hidden 裁掉）
  const inner = node.firstElementChild
  if (inner) ro.observe(inner)
}

/** 新建元素（autoBox）：把外框收成刚好包住公式，之后拖动外框即可自由缩放 */
function fitBoxToContent(nw: number, nh: number) {
  if (autoBoxDone || !props.el.autoBox || !(nw > 0 && nh > 0)) return
  autoBoxDone = true
  const w = Math.max(60, Math.min(1800, Math.round(nw + 24)))
  const h = Math.max(40, Math.min(900, Math.round(nh + 20)))
  if (w === Math.round(props.el.w) && h === Math.round(props.el.h)) {
    emit('update', { autoBox: false } as Partial<MathElement>)
    return
  }
  emit('update', { w, h, autoBox: false } as Partial<MathElement>)
}

/** autoBox 只做一次：拖动时 ResizeObserver 会连发多次，反复改外框会跟用户抢 */
let autoBoxDone = false
/** 延迟复核用的定时器（MathJax 异步落位） */
let refitTimers: number[] = []

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
        const { nw, nh } = await renderLatex(node, latex, props.el.fontSize, cap.value)
        fitBoxToContent(nw, nh)
        watchSize()   // 新渲染出的 SVG 也纳入观察（异步重排 → 重算缩放）
        // 再补两次延迟复核：MathJax 落位是异步的，量早了比例会算错
        refitTimers.forEach((t) => clearTimeout(t))
        refitTimers = [120, 420].map((ms) => window.setTimeout(() => { if (host.value) fitMath(host.value, cap.value) }, ms) as unknown as number)
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
onBeforeUnmount(() => { clearTimeout(timer); refitTimers.forEach((t) => clearTimeout(t)); ro?.disconnect() })

// ---- 双击编辑 LaTeX：大弹窗（编辑区 + 实时预览）----
function beginEdit() { editing.value = true }
function onCommit(t: string) {
  editing.value = false
  if (t !== props.el.latex) emit('update', { latex: t })
}
watch(inlineEditReq, (v) => { if (v && v.id === props.el.id && !editing.value) beginEdit() })

watch(
  () => [
    props.el.latex,
    props.el.fontSize,
    props.el.color,
    props.el.fitMode,
    props.el.autoBox,
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
    <!-- 【v1748】公式 + 编号**一行 flex** ✓：编号占右侧固定宽度、公式宿主让位 ✓
         （原来编号绝对定位钉在右边缘 ✗ 实测会压在公式尾巴上 −15px ✗ —— 探针冒烟量出来的 ✓） -->
    <div class="math-el__row">
      <div ref="host" class="math-el__host"></div>
      <div
        v-if="el.eqLabel"
        class="math-el__eq"
        :style="{ fontSize: Math.max(10, Math.round((el.fontSize || 32) * 0.62)) + 'px' }"
      >{{ el.eqLabel }}</div>
    </div>
    <InlineEditor
      v-if="editing"
      title="编辑公式（LaTeX）"
      kind="math"
      :initial="el.latex || ''"
      @commit="onCommit"
      @cancel="editing = false"
    />
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
  flex: 1 1 auto;
  min-width: 0;            /* flex 子项默认 min-width:auto ✗ 会不肯变窄 ✓ 必须显式放开 ✓ */
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
/* 【v1748】公式 + 编号的一行布局 ✓ */
.math-el__row {
  display: flex;
  align-items: center;
  width: 100%;
  height: 100%;
}
.math-el__host :deep(mjx-container) {
  display: inline-flex !important;
  max-width: none;
}
/* 【v1748】公式编号：右侧固定宽度 ✓（flex:0 0 auto ✓ 不参与压缩 ✓）
   · 视觉居中靠 `.math-el__row` 的 align-items:center ✓（实测中心差 0px ✓）
   · 字号随公式基准缩放 ✓（模板里按 el.fontSize 算 ✓）
   · 不吃点击 ✓（不挡选中/拖动 ✓） */
.math-el__eq {
  flex: 0 0 auto;
  align-self: center;
  padding: 0 0.4em 0 0.5em;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  opacity: 0.85;
  pointer-events: none;
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
