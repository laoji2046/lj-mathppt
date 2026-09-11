<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { typesetMixed } from '@/composables/useMathJax'
import { fontStack, shadowCss } from '@/types'
import type { RichTextElement } from '@/types'
import { inlineEditReq } from '@/ui/inlineEdit'
import InlineEditor from '../InlineEditor.vue'

const props = defineProps<{ el: RichTextElement }>()
const emit = defineEmits<{ (e: 'update', patch: Partial<RichTextElement>): void }>()

const host = ref<HTMLElement | null>(null)
const editing = ref(false)
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
  // 水平位置跟随「对齐」属性：内容块是 fit-content，不指定就会永远居中，
  // 左对齐的正文块（例题/解答）看起来像被缩进了。
  justifyContent: props.el.align === 'left' ? 'flex-start' : props.el.align === 'right' ? 'flex-end' : 'center',
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
  // maxScale=1：只缩小不放大（与公式元素一致）。混排文字大小由「字号」决定，
  // 元素框变大不再把文字撑大，否则宽框里的短句会被放大到 4 倍。
  const f = Math.min(boxW / nw, boxH / nh, 1)
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

// ---- 双击就地编辑（编辑混排源码：正文 + $公式$；提交后自动重新排版）----
// ---- 双击编辑：大弹窗（源码 + 实时预览）----
function beginEdit() { editing.value = true }
function onCommit(t: string) {
  editing.value = false
  if (t !== props.el.text) emit('update', { text: t })
}
watch(inlineEditReq, (v) => { if (v && v.id === props.el.id && !editing.value) beginEdit() })
</script>

<template>
  <div class="richtex-el">
    <div ref="host" class="richtex-el__host" :style="bgStyle">
      <div ref="content" class="richtex-el__content" :style="contentStyle">{{ el.text }}</div>
    </div>
    <InlineEditor
      v-if="editing"
      title="编辑文本 / 公式（正文用中文，公式用 $...$）"
      kind="mixed"
      :initial="el.text || ''"
      @commit="onCommit"
      @cancel="editing = false"
    />
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
.richtex-el__edit {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-sizing: border-box;
  border: 2px solid var(--brand, #7c3aed);
  border-radius: 6px;
  background: #fff;
  padding: 8px 10px;
}
.richtex-el__ta {
  flex: 1;
  min-height: 40px;
  resize: none;
  outline: none;
  box-sizing: border-box;
  border: 1px solid var(--line, #ddd);
  border-radius: 6px;
  padding: 6px 8px;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 15px;
  line-height: 1.6;
  color: #1a1a1a;
  background: #fbfbfd;
}
.richtex-el__pv {
  flex: 1;
  min-height: 0;
  border-top: 1px dashed #ddd;
  display: flex;
  flex-direction: column;
}
.richtex-el__pvlbl { font-size: 11px; color: #999; margin: 4px 0 2px; }
.richtex-el__pvh {
  flex: 1;
  min-height: 0;
  overflow: auto;
  color: #1a1a1a;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.richtex-el__pvh :deep(mjx-container) { font-size: inherit; max-width: 100%; }
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
