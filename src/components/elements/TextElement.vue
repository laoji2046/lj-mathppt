<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { TextElement } from '@/types'
import { bulletMarker, fontStack, paragraphLineStyle, textEffectCss, textShadowCss } from '@/types'
import { inlineEditReq } from '@/ui/inlineEdit'

const props = defineProps<{ el: TextElement }>()
const emit = defineEmits<{ (e: 'update', patch: Partial<TextElement>): void }>()

const editing = ref(false)
const editorRef = ref<HTMLElement | null>(null)

const hasBg = computed(() => !!props.el.bgColor && props.el.bgColor !== 'transparent')
const alignItem = computed(() => props.el.valign === 'top' ? 'flex-start' : props.el.valign === 'bottom' ? 'flex-end' : 'center')
const justify = computed(() => props.el.align === 'left' ? 'flex-start' : props.el.align === 'right' ? 'flex-end' : 'center')

/** 容器：布局（含垂直对齐）+ 基础字体/颜色/阴影/背景 */
const containerStyle = computed(() => ({
  alignItems: alignItem.value,
  justifyContent: justify.value,
  color: props.el.color,
  fontSize: props.el.fontSize + 'px',
  fontWeight: String(props.el.fontWeight),
  fontFamily: fontStack(props.el.fontFamily),
  textAlign: props.el.align,
  textShadow: textShadowCss(props.el),
  background: hasBg.value ? props.el.bgColor : 'transparent',
  padding: hasBg.value ? '6px 12px' : '0',
  borderRadius: hasBg.value ? '6px' : '0',
}))

/** 文本内层：渐变/描边/字距/行高；编辑时用纯色，便于输入 */
const textStyle = computed(() => {
  if (editing.value) return 'color:' + props.el.color
  const base: string[] = []
  if (props.el.letterSpacing) base.push('letter-spacing:' + props.el.letterSpacing + 'px')
  if (props.el.lineHeight) base.push('line-height:' + props.el.lineHeight)
  const fx = textEffectCss(props.el)
  return (base.length ? base.join(';') + ';' : '') + fx
})

// ---- 段落 / 项目符号：按行拆开渲染（原来整段一个文本节点 ✗，没法逐行加符号）----
const lines = computed(() => String(props.el.text ?? '').split('\n'))
const markerOf = (i: number) => bulletMarker(props.el.bullet, i)
const lineStyleOf = (i: number) => paragraphLineStyle(props.el, i, lines.value.length)

async function beginEdit() {
  editing.value = true
  await nextTick()
  const node = editorRef.value
  if (!node) return
  node.focus()
  const range = document.createRange()
  range.selectNodeContents(node)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

function endEdit() {
  if (!editing.value) return
  editing.value = false
  const text = editorRef.value?.innerText ?? props.el.text
  if (text !== props.el.text) emit('update', { text })
}
// 帧层捕获的双击 → 进入就地编辑
watch(inlineEditReq, (v) => { if (v && v.id === props.el.id && !editing.value) beginEdit() })
</script>

<template>
  <div class="text-el" :style="containerStyle">
    <div
      v-if="editing"
      ref="editorRef"
      class="text-el__editor"
      :style="textStyle"
      contenteditable="true"
      @pointerdown.stop
      @click.stop
      @dblclick.stop
      @blur="endEdit"
      @keydown.esc.prevent="endEdit"
      @keydown.enter.ctrl.prevent="endEdit"
    >{{ el.text }}</div>
    <div v-else class="text-el__body" :style="textStyle" @dblclick.stop="beginEdit">
      <div v-for="(ln, i) in lines" :key="i" class="text-el__line" :style="lineStyleOf(i)">
        <span v-if="markerOf(i)" class="text-el__mk">{{ markerOf(i) }}</span>{{ ln }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.text-el {
  width: 100%;
  height: 100%;
  display: flex;
  overflow: hidden;
  word-break: break-word;
  white-space: pre-wrap;
  line-height: 1.4;
  /* 有背景色且文字换行时，每个行片段都单独上色 */
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
/* 逐行容器：保留原先行首空格，行为与之前的 pre-wrap 一致 */
.text-el__body { white-space: pre-wrap; width: 100%; }
.text-el__line { white-space: pre-wrap; }
.text-el__mk { display: inline-block; min-width: 1.1em; margin-right: 0.35em; }
.text-el__editor {
  width: 100%;
  outline: 2px solid #534ab7;
  outline-offset: 2px;
  cursor: text;
}
</style>
