<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { typesetMixed } from '@/composables/useMathJax'
import { escapeHtml, fontStack, shadowCss } from '@/types'
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
    // ⚠ 必须转义：(0<a<1) 里的 < 否则会被当标签（教材表的连续不等式就是这么坏的）
    const safe = escapeHtml(ln)
    return ls ? '<span' + st + '>' + safe + '</span>' : safe
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

/** 缩放上限：'fill'（默认，拖动外框无级放大，最多 4 倍）；'shrink' 只缩小不放大 */
const cap = computed(() => (props.el.fitMode === 'shrink' ? 1 : 4))

/**
 * 内容"真实占位"：布局尺寸与滚动尺寸取大。
 * 为什么不能只用 offsetWidth/Height：MathJax 的 SVG 经常**溢出父盒但不撑大父盒**，
 * 只看父盒尺寸会低估内容 —— 于是缩放比例偏大、内容被 overflow:hidden 裁掉。
 */
function extentOf(el: HTMLElement) {
  return {
    w: Math.max(el.offsetWidth, el.scrollWidth),
    h: Math.max(el.offsetHeight, el.scrollHeight),
  }
}

/** 内容实际绘制范围：自身矩形 + 所有公式节点的并集（含溢出到父盒之外的部分） */
function paintedRect(el: HTMLElement) {
  const r = el.getBoundingClientRect()
  let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom
  const kids = el.querySelectorAll('mjx-container, svg')
  for (let i = 0; i < kids.length; i++) {
    const b = kids[i].getBoundingClientRect()
    if (!b.width && !b.height) continue
    x0 = Math.min(x0, b.left); y0 = Math.min(y0, b.top)
    x1 = Math.max(x1, b.right); y1 = Math.max(y1, b.bottom)
  }
  return { width: x1 - x0, height: y1 - y0 }
}

/** 把 content 块（正文 + 内联公式）按真实占位缩放，填满宿主；像 math 元素那样无级缩放 */
function fitContent() {
  const box = host.value
  const inner = content.value
  if (!box || !inner) return
  const boxW = box.clientWidth
  const boxH = box.clientHeight
  inner.style.transform = ''
  const { w: nw, h: nh } = extentOf(inner)
  if (!(nw > 0 && nh > 0 && boxW > 0 && boxH > 0)) return
  // 新建元素（autoBox）：先把外框收成刚好包住内容，之后拖动外框即可自由缩放。
  // 用一次性标记：拖动过程中 ResizeObserver 会连发多次，不能反复改外框跟用户抢。
  if (props.el.autoBox && !autoBoxDone) { autoBoxDone = true; fitBoxToContent(nw, nh) }
  let f = Math.min(boxW / nw, boxH / nh, cap.value)
  // 关键：缩放原点必须与 flex 对齐方式一致！
  // 宿主是 justify-content: flex-start（左对齐），内容贴左边缘；若仍按 center 放大，
  // 放大后有一半会跑到左侧框外被 overflow:hidden 裁掉（右侧却没事）—— 这就是"拖动放大后公式被截断"的真凶。
  const ax = props.el.align === 'left' ? 'left' : props.el.align === 'right' ? 'right' : 'center'
  inner.style.transformOrigin = ax + ' center'
  inner.style.transform = 'scale(' + f + ')'
  // 兜底：按"真实绘制范围"（含溢出子节点）复核，超出宿主就按实际比例缩回去
  const hr = box.getBoundingClientRect()
  const ir = paintedRect(inner)
  if (hr.width > 0 && hr.height > 0 && ir.width > 0 && ir.height > 0 &&
      (ir.width > hr.width + 1 || ir.height > hr.height + 1)) {
    f = Math.max(0.02, f * Math.min(hr.width / ir.width, hr.height / ir.height))
    inner.style.transform = 'scale(' + f + ')'
  }
}

/** MathJax 落位是异步的：渲染完成后再补两次复核，防止"量早了" */
let refitTimers: number[] = []
function laterRefit() {
  refitTimers.forEach((t) => clearTimeout(t))
  refitTimers = [120, 420].map((ms) => window.setTimeout(() => fitContent(), ms) as unknown as number)
}

/** 新建元素：把外框调成刚好包住内容（随后清掉标记，不再自动改动） */
function fitBoxToContent(nw: number, nh: number) {
  const w = Math.max(60, Math.min(1800, Math.round(nw + 16)))
  const h = Math.max(32, Math.min(900, Math.round(nh + 12)))
  if (w === Math.round(props.el.w) && h === Math.round(props.el.h)) {
    emit('update', { autoBox: false } as Partial<RichTextElement>)
    return
  }
  emit('update', { w, h, autoBox: false } as Partial<RichTextElement>)
}

let autoBoxDone = false

function watchSize() {
  ro?.disconnect()
  const node = host.value
  if (!node || typeof ResizeObserver === 'undefined') return
  ro = new ResizeObserver(() => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => fitContent())
  })
  ro.observe(node)
  // 内容尺寸变化也要重算：MathJax 异步重排后内容会变大，光看宿主尺寸是发现不了的
  if (content.value) ro.observe(content.value)
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
        // 再等一帧：MathJax 的 SVG 布局是异步落位的，不等就量不准（会偏小 → 缩放偏大 → 被裁）
        await new Promise((r) => requestAnimationFrame(r))
        fitContent()
        laterRefit()
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
onBeforeUnmount(() => { clearTimeout(timer); refitTimers.forEach((t) => clearTimeout(t)); ro?.disconnect() })
watch(
  () => [props.el.text, props.el.fontSize, props.el.color, props.el.fontFamily, props.el.wrap, props.el.fitMode, props.el.autoBox, JSON.stringify(props.el.lineStyles || []), Math.round(props.el.w), Math.round(props.el.h)],
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
