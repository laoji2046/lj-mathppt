<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { useDeckStore } from '@/stores/deck'
import { deckToMarkdown, markdownToDeck } from '@/composables/mdDeck'
import type { Deck } from '@/types'

const store = useDeckStore()
const emit = defineEmits<{ close: [] }>()
const src = ref('')
const status = ref('')

function exportFromDeck() {
  src.value = deckToMarkdown(store.deck)
  status.value = '已从当前课件导出 Markdown。'
}
function apply() {
  try {
    const d = markdownToDeck(src.value) as Deck
    store.replaceDeck({ title: d.title, width: d.width, height: d.height, slides: d.slides })
    status.value = '已应用，共 ' + d.slides.length + ' 页（含备注/子页）。'
  } catch (e) {
    status.value = '解析失败：' + ((e as Error)?.message || String(e))
  }
}
onMounted(exportFromDeck)
</script>

<template>
  <div class="md" @mousedown.self="emit('close')">
    <div class="md__box">
      <header class="md__head">
        <div class="md__title"><span class="md__badge">MD</span> Markdown 源码（Reveal 规范：--- 横向 / -- 垂直 / Note: 备注）</div>
        <button class="md__x" @click="emit('close')"><AppIcon name="close" :size="13" /></button>
      </header>
      <textarea v-model="src" class="md__area" spellcheck="false" placeholder="# 标题&#10;$$公式$$&#10;&#10;正文文本&#10;&#10;---&#10;## 子页&#10;--&#10;垂直子页&#10;&#10;Note: 备注"></textarea>
      <div class="md__foot">
        <span class="md__status">{{ status }}</span>
        <button class="md__btn" @click="exportFromDeck">从当前导出</button>
        <button class="md__btn" @click="src = ''">清空</button>
        <button class="md__btn" @click="emit('close')">取消</button>
        <button class="md__btn md__btn--primary" @click="apply">应用为课件</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.md { position: fixed; inset: 0; z-index: 2200; background: rgba(15,18,30,0.55); display: flex; align-items: center; justify-content: center; }
.md__box { width: min(900px, 94vw); height: 82vh; display: flex; flex-direction: column; background: #1e1e24; border-radius: 12px; overflow: hidden; box-shadow: 0 30px 80px rgba(0,0,0,0.5); color: #ddd; }
.md__head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: #26262e; border-bottom: 1px solid #33333c; }
.md__title { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #eee; }
.md__badge { background: linear-gradient(135deg,#26c6da,#4b6cf0); color: #fff; border-radius: 6px; font-size: 12px; font-weight: 700; padding: 2px 8px; }
.md__x { width: 28px; height: 28px; border-radius: 6px; border: 1px solid #444; background: transparent; color: #aaa; cursor: pointer; }
.md__x:hover { background: #33333c; }
.md__area { flex: 1; background: transparent; color: #e6e6ef; border: none; outline: none; padding: 16px; font-family: ui-monospace, Consolas, monospace; font-size: 14px; line-height: 1.7; resize: none; }
.md__foot { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-top: 1px solid #33333c; background: #26262e; }
.md__status { margin-right: auto; font-size: 12px; color: #8bd0ff; }
.md__btn { padding: 6px 12px; border: 1px solid #444; background: #2e2e36; color: #ddd; border-radius: 7px; cursor: pointer; font-size: 13px; }
.md__btn:hover { background: #383842; }
.md__btn--primary { background: #4b6cf0; border-color: #4b6cf0; color: #fff; font-weight: 600; }
.md__btn--primary:hover { background: #3a58d6; }
</style>
