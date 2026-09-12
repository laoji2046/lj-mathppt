<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDeckStore } from '@/stores/deck'
import { deckToMarkdown, markdownToDeck } from '@/composables/mdDeck'
import { slideToSourceHtml, sourceHtmlToSlide } from '@/composables/deckHtml'
import { viewMode, setViewMode } from '@/ui/view'
import CodeEditor from './CodeEditor.vue'

const store = useDeckStore()
const src = ref('')
const srcHtml = ref('')
const sourceMode = ref<'md' | 'html'>('md')
let applying = false
let pendingMd = ''
let suppressUntil = 0
let timer: number | undefined

const curIdx = computed(() => store.currentIndex)
const curSlide = computed(() => store.deck.slides[curIdx.value])

function regenMd() { pendingMd = deckToMarkdown(store.deck); src.value = pendingMd }
function regenHtml() { srcHtml.value = curSlide.value ? slideToSourceHtml(curSlide.value) : '' }
function regen() { if (sourceMode.value === 'md') regenMd(); else regenHtml() }

function applyMd() {
  try {
    const keep = store.currentIndex
    const d = markdownToDeck(src.value)
    applying = true; suppressUntil = Date.now() + 300
    store.replaceDeck({ title: d.title || store.deck.title, width: d.width, height: d.height, slides: d.slides }, { snapshot: false })
    // replaceDeck 会把 currentIndex 重置为 0，这里恢复到编辑前所在的一页，避免"自动跳到第一张幻灯片"
    if (keep > 0) store.gotoSlide(Math.min(keep, store.deck.slides.length - 1))
    applying = false
    // 注意：这里不回写 src —— 保留用户正在输入的原文本，
    // 否则每敲一下都会按解析结果重排源码，光标乱跳、公式看着像"丢失"
  } catch (e) { applying = false; (e as Error) && console.error(e) }
}
function applyHtml() {
  const s = curSlide.value
  if (!s) return
  const els = sourceHtmlToSlide(srcHtml.value)
  applying = true; suppressUntil = Date.now() + 300
  store.replaceDeck({ title: store.deck.title, width: store.deck.width, height: store.deck.height, slides: store.deck.slides.map((sl) => (sl.id === s.id ? { ...sl, elements: els } : sl)) }, { snapshot: false })
  // replaceDeck 会把 currentIndex 重置为 0，这里恢复到当前页
  const ni = store.deck.slides.findIndex((sl) => sl.id === s.id)
  if (ni >= 0) store.gotoSlide(ni)
  applying = false
}
function onMdInput() { if (applying || src.value === pendingMd) return; clearTimeout(timer); timer = window.setTimeout(applyMd, 200) }
function onHtmlInput() { if (applying) return; clearTimeout(timer); timer = window.setTimeout(applyHtml, 250) }

onMounted(() => { regen() })
onBeforeUnmount(() => clearTimeout(timer))

watch(() => JSON.stringify(store.deck.slides), () => {
  if (applying || Date.now() < suppressUntil) return
  regen()
})
watch(sourceMode, () => { clearTimeout(timer); regen() })
watch(curIdx, () => { if (sourceMode.value === 'html') srcHtml.value = curSlide.value ? slideToSourceHtml(curSlide.value) : '' })
</script>

<template>
  <section class="mds" :class="{ 'mds--full': viewMode === 'source' }">
    <header class="mds__head">
      <span class="mds__title">源码 <small>MD：--- / -- / Note:；HTML：data-type 可编辑回写</small></span>
      <span class="mds__modes">
        <button class="mds__mode" :class="{ 'mds__mode--on': sourceMode === 'md' }" @click="sourceMode = 'md'">Markdown</button>
        <button class="mds__mode" :class="{ 'mds__mode--on': sourceMode === 'html' }" @click="sourceMode = 'html'">本页HTML</button>
        <button class="mds__mode" :class="{ 'mds__mode--on': viewMode === 'canvas' }" @click="setViewMode('canvas')">画布</button>
        <button class="mds__mode" :class="{ 'mds__mode--on': viewMode === 'split' }" @click="setViewMode('split')">分屏</button>
        <button class="mds__mode" :class="{ 'mds__mode--on': viewMode === 'source' }" @click="setViewMode('source')">源码</button>
      </span>
    </header>

    <template v-if="sourceMode === 'md'">
      <textarea v-model="src" class="mds__area" spellcheck="false" @input="onMdInput" placeholder="# 标题&#10;$$公式$$&#10;&#10;正文&#10;&#10;---&#10;## 子页&#10;--&#10;垂直子页&#10;&#10;Note: 备注"></textarea>
      <footer class="mds__foot">
        <span class="mds__status">🎧 编辑实时更新画布</span>
        <button class="mds__btn" @click="regenMd">从当前导出</button>
        <button class="mds__btn mds__btn--primary" @click="applyMd">应用</button>
      </footer>
    </template>

    <template v-else>
      <CodeEditor :model-value="srcHtml" lang="html" @update:model-value="(v) => { srcHtml = v; onHtmlInput() }" class="mds__code" />
      <footer class="mds__foot">
        <span class="mds__status">第 {{ curIdx + 1 }} 页 · HTML 可编辑回写</span>
        <button class="mds__btn" @click="regenHtml">从当前页导出</button>
        <button class="mds__btn mds__btn--primary" @click="applyHtml">应用回写</button>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.mds { display: flex; flex-direction: column; min-width: 0; flex: 0 0 38%; background: #1b1b21; color: #ddd; border-left: 1px solid #33333c; }
.mds--full { flex: 1; }
.mds__head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #232329; border-bottom: 1px solid #33333c; flex-wrap: wrap; }
.mds__title { font-size: 13px; color: #eee; font-weight: 600; }
.mds__title small { color: #8b8a95; font-weight: 400; }
.mds__modes { display: flex; gap: 4px; margin-left: auto; flex-wrap: wrap; }
.mds__mode { padding: 3px 10px; border: 1px solid #444; background: #2e2e36; color: #ccc; border-radius: 6px; cursor: pointer; font-size: 12px; }
.mds__mode--on { background: #4b6cf0; border-color: #4b6cf0; color: #fff; }
.mds__btn { padding: 3px 10px; border: 1px solid #444; background: #2e2e36; color: #ddd; border-radius: 6px; cursor: pointer; font-size: 12px; }
.mds__btn--primary { background: #4b6cf0; border-color: #4b6cf0; color: #fff; }
.mds__area { flex: 1; background: transparent; color: #e6e6ef; border: none; outline: none; padding: 12px 16px; font-family: ui-monospace, Consolas, monospace; font-size: 13px; line-height: 1.7; resize: none; width: 100%; }
.mds__code { flex: 1; min-height: 0; display: flex; }
.mds__foot { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid #33333c; background: #232329; }
.mds__status { font-size: 12px; color: #8bd0ff; }
</style>
