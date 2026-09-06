<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { typesetMixed } from '@/composables/useMathJax'
import { fontStack, shadowCss } from '@/types'
import type { RichTextElement } from '@/types'

const props = defineProps<{ el: RichTextElement }>()

const host = ref<HTMLElement | null>(null)
const content = ref<HTMLElement | null>(null)
const error = ref('')
let timer: number | undefined
let rendering = false
let pending = false
let ro: ResizeObserver | null = null
let raf = 0

/** 行属性：按 text 的 \n 分行，每行包一个 <span>（行内联样式） */
const mixed = computed(() => {
  const lines = String(props.el.text || '').split('\n')
  return lines.map((ln, i) => {
    const ls = props.el.lineStyles?.[i]
    let st = ''
    if (ls) {
      st = ' style="'
      if (ls.color) st += 'color:' + ls.color + ';'
      if (ls.fontFamily) st += 'font-family:' + fontStack(ls.fontFamily) + ';'
      st += '"'
    }
    return ls ? '<span' + st + '>' + ln + '</span>' : ln
  }).join('\n')
})

const hasBg = () => !!props.el.bgColor && props.el.bgColor !== 'transparent'

const bgStyle = computed(() => ({
  background: hasBg() ? props.el.bgColor : 'transparent',
  padding: hasBg() ? '6px 12px' : '0',
  borderRadius: hasBg() ? '6px' : '0',
}))
const contentStyle = computed(() => ({
  fontSize: props.el.fontSize + 'px',
  fontWeight: String(props.el.fontWeight),
  textAlign: props.el.align,
  fontFamily: fontStack(props.el.fontFamily),
  color: props.el.color,
  textShadow: shadowCss(props.el.shadow),
  whiteSpace: props.el.wrap === false ? 'pre' : 'pre-wrap',
}))

/** 把 content 块（正文 + 内联公式）按自然尺寸缩放，填满宿主；像 math 元素那样无级缩放 */
function fitContent() {
  const box = host.value
  const inner = content.value
  if (!box || !inner) return
  const boxW = box.clientWidth
  const boxH = box.clientHeight
  inner.style.transform = ''
  const nw = inner.offsetWidth
  const nh = inner.offsetHeight
  if (!(nw > 0 && nh > 0 && boxW > 0 && boxH > 0)) return
  const f = Math.min(boxW / nw, boxH / nh, 4)
  inner.style.transformOrigin = 'center center'
  inner.style.transform = 'scale(' + f + ')'
}

function watchSize() {
  ro?.disconnect()
  const node = host.value
  if (!node || typeof ResizeObserver === 'undefined') return
  ro = new ResizeObserver(() => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => fitContent())
  })
  ro.observe(node)
}

async function run() {
  if (rendering) { pending = true; return }
  rendering = true
  try {
    do {
      pending = false
      const node = content.value
      if (!node) continue
      error.value = ''
      await nextTick()
      try {
        await typesetMixed(node, mixed.value)
        await nextTick()
        fitContent()
      } catch (e) {
        error.value = e instanceof Error ? e.message : String(e)
      }
    } while (pending)
  } finally {
    rendering = false
  }
}

function schedule(delay = 160) {
  clearTimeout(timer)
  timer = setTimeout(run, delay) as unknown as number
}

onMounted(() => { watchSize(); run() })
onBeforeUnmount(() => { clearTimeout(timer); ro?.disconnect() })
watch(
  () => [props.el.text, props.el.fontSize, props.el.color, props.el.fontFamily, props.el.wrap, JSON.stringify(props.el.lineStyles || []), Math.round(props.el.w), Math.round(props.el.h)],
  () => schedule(),
)
</script>

<template>
  <div class="richtex-el">
    <div ref="host" class="richtex-el__host" :style="bgStyle">
      <div ref="content" class="richtex-el__content" :style="contentStyle">{{ el.text }}</div>
    </div>
    <div v-if="error" class="richtex-el__err">公式渲染失败：{{ error }}</div>
  </div>
</template>

<style scoped>
.richtex-el {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
  box-sizing: border-box;
}
.richtex-el__host {
  width: 100%;
  height: 100%;
  overflow: hidden;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
}
.richtex-el__content {
  width: fit-content;
  max-width: 100%;
  word-break: break-word;
  white-space: pre-wrap;
  line-height: 1.5;
  transform-origin: center center;
  will-change: transform;
}
.richtex-el__content :deep(mjx-container) {
  font-size: inherit;
  max-width: 100%;
  overflow: visible;
}
.richtex-el__content :deep(mjx-container svg) {
  vertical-align: -0.18em;
}
.richtex-el__err {
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
  color: var(--danger);
  background: var(--danger-soft);
}
</style>
