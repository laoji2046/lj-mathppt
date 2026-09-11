<!--
  就地编辑弹窗：公式（LaTeX）/ 混排（正文+$公式$）通用。
  - Teleport 到 body，避免被画布缩放/变换裁剪，始终屏幕居中。
  - 尺寸按类型给默认值（公式小、混排大），可拖动右下角拉伸，并记住用户尺寸。
-->
<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { fitMath, renderLatex, typesetMixed } from '@/composables/useMathJax'

const props = defineProps<{ title: string; kind: 'math' | 'mixed'; initial: string }>()
const emit = defineEmits<{ (e: 'commit', text: string): void; (e: 'cancel'): void }>()

const DEFAULTS: Record<'math' | 'mixed', { w: number; h: number }> = {
  math: { w: 620, h: 330 },   // 单个公式：紧凑
  mixed: { w: 880, h: 600 },  // 混排：大一些
}
const SIZE_KEY = 'lj-inline-editor-size:' + props.kind

const draft = ref(props.initial || '')
const taRef = ref<HTMLTextAreaElement | null>(null)
const pvRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const size = ref<{ w: number; h: number }>(loadSize())
let timer: number | undefined
let ro: ResizeObserver | null = null
let saveTimer: number | undefined

function loadSize() {
  try {
    const raw = localStorage.getItem(SIZE_KEY)
    if (raw) {
      const o = JSON.parse(raw)
      if (o && o.w >= 320 && o.h >= 200) return { w: o.w, h: o.h }
    }
  } catch { /* ignore */ }
  return { ...DEFAULTS[props.kind] }
}

async function renderPreview() {
  clearTimeout(timer)
  timer = setTimeout(async () => {
    const n = pvRef.value
    if (!n) return
    const src = draft.value || ''
    try {
      if (props.kind === 'math') {
        if (!src.trim()) { n.innerHTML = ''; return }
        await renderLatex(n, src.trim(), 40)
        fitMath(n)
      } else {
        await typesetMixed(n, src)
      }
    } catch (e) {
      n.innerHTML = '<span style="color:#a32d2d;font-size:14px">公式有误：' + (e instanceof Error ? e.message : String(e)) + '</span>'
    }
  }, 180) as unknown as number
}

onMounted(async () => {
  await nextTick()
  taRef.value?.focus()
  taRef.value?.select()
  renderPreview()
  // 记住用户拖拽后的尺寸
  const node = panelRef.value
  if (node && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        const w = node.offsetWidth, h = node.offsetHeight
        if (w >= 320 && h >= 200) {
          size.value = { w, h }
          try { localStorage.setItem(SIZE_KEY, JSON.stringify({ w, h })) } catch { /* ignore */ }
        }
      }, 400) as unknown as number
    })
    ro.observe(node)
  }
})
onBeforeUnmount(() => { clearTimeout(timer); clearTimeout(saveTimer); ro?.disconnect() })

function commit() { emit('commit', draft.value) }
function cancel() { emit('cancel') }
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.preventDefault(); cancel() }
  else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit() }
}
watch(draft, () => renderPreview())
</script>

<template>
  <Teleport to="body">
    <div class="ie-mask" @click.self="commit">
      <div
        ref="panelRef"
        class="ie-panel"
        :class="{ 'ie-panel--math': kind === 'math' }"
        :style="{ '--ie-w': size.w + 'px', '--ie-h': size.h + 'px' }"
        @click.stop
      >
        <div class="ie-head">
          <span class="ie-title">{{ title }}</span>
          <span class="ie-hint">Ctrl+Enter 完成 · Esc 取消 · 可拖右下角调整大小</span>
        </div>
        <textarea
          ref="taRef"
          v-model="draft"
          class="ie-ta"
          spellcheck="false"
          :placeholder="kind === 'math' ? '输入 LaTeX 源码，例如 x^2 + y^2 = 1' : '正文直接写中文；公式用 $...$ 包起来'"
          @keydown="onKey"
        ></textarea>
        <div class="ie-pv-lbl">实时预览</div>
        <div ref="pvRef" class="ie-pv" :class="{ 'ie-pv--math': kind === 'math' }"></div>
        <div class="ie-foot">
          <button class="ie-btn" @click="cancel">取消</button>
          <button class="ie-btn ie-btn--primary" @click="commit">完成</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ie-mask {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(15, 15, 25, 0.36);
  display: flex; align-items: center; justify-content: center;
}
.ie-panel {
  width: min(var(--ie-w, 760px), 94vw);
  height: min(var(--ie-h, 460px), 92vh);
  min-width: 320px; min-height: 200px;
  max-width: 96vw; max-height: 94vh;
  resize: both; overflow: hidden;
  background: #fff; border-radius: 14px;
  box-shadow: 0 20px 70px rgba(0, 0, 0, 0.32);
  display: flex; flex-direction: column; gap: 8px;
  padding: 14px 16px 12px; box-sizing: border-box;
}
.ie-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.ie-title { font-size: 15px; font-weight: 600; color: #1a1a1a; white-space: nowrap; }
.ie-hint { font-size: 12px; color: #999; text-align: right; }
.ie-ta {
  flex: 1; min-height: 64px; resize: none; outline: none;
  box-sizing: border-box;
  border: 1px solid #ddd; border-radius: 10px; padding: 10px 12px;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 18px; line-height: 1.65; color: #1a1a1a; background: #fbfbfd;
}
.ie-panel--math .ie-ta { flex: 0 0 auto; height: 86px; }
.ie-ta:focus { border-color: var(--brand, #7c3aed); box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.13); }
.ie-pv-lbl { font-size: 12px; color: #999; }
.ie-pv {
  flex: 1; min-height: 0; overflow: auto;
  border: 1px dashed #ddd; border-radius: 10px; padding: 10px 12px;
  box-sizing: border-box; font-size: 22px; line-height: 1.6; color: #1a1a1a;
  white-space: pre-wrap; word-break: break-word;
}
.ie-pv--math { display: flex; align-items: center; justify-content: center; }
.ie-pv :deep(mjx-container) { font-size: inherit; max-width: 100%; }
.ie-foot { display: flex; justify-content: flex-end; gap: 10px; }
.ie-btn {
  height: 34px; padding: 0 18px; border-radius: 9px; cursor: pointer;
  border: 1px solid #ddd; background: #fff; color: #333; font-size: 14px;
}
.ie-btn:hover { background: #f6f4ff; }
.ie-btn--primary { background: var(--brand, #7c3aed); border-color: var(--brand, #7c3aed); color: #fff; }
.ie-btn--primary:hover { filter: brightness(1.07); }
</style>
