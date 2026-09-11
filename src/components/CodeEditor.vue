<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { html } from '@codemirror/lang-html'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { autocompletion, completeFromList, type CompletionContext } from '@codemirror/autocomplete'

const props = defineProps<{ modelValue: string; lang?: 'html' | 'markdown' }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const host = ref<HTMLElement | null>(null)
let view: EditorView | null = null

const DATA_TYPES = ['text', 'math', 'richtex', 'image', 'shape', 'table', 'chart', 'icon', 'embed', 'mathfig', 'line', 'arrow', 'pen', 'geogebra', 'desmos']
const COMPLETIONS = [
  { label: 'div', type: 'tag', boost: 2 }, { label: 'img', type: 'tag', boost: 2 },
  { label: 'style', type: 'attribute', boost: 2 },
  { label: 'data-type', type: 'attribute', boost: 3 }, { label: 'data-latex', type: 'attribute', boost: 3 },
  { label: 'data-src', type: 'attribute', boost: 3 }, { label: 'data-json', type: 'attribute', boost: 3 },
  { label: 'data-fontsize', type: 'attribute' }, { label: 'data-color', type: 'attribute' },
  { label: 'data-font', type: 'attribute' }, { label: 'data-fontweight', type: 'attribute' },
  { label: 'data-align', type: 'attribute' }, { label: 'data-fit', type: 'attribute' },
  ...DATA_TYPES.map((t) => ({ label: t, type: 'constant', boost: 1 })),
]
function myCompletion(ctx: CompletionContext) {
  return completeFromList(COMPLETIONS)(ctx)
}

function darkTheme() {
  return EditorView.theme({
    '&': { color: '#e6e6ef', backgroundColor: 'transparent', height: '100%' },
    '.cm-content': { caretColor: '#7ee08a', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '13px', lineHeight: '1.7', paddingBottom: '12px' },
    '.cm-gutters': { backgroundColor: 'transparent', color: '#5a5a66', border: 'none' },
    '&.cm-focused': { outline: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgba(120,140,255,0.06)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },
    '.cm-lineNumbers .cm-gutterElement': { minWidth: '34px' },
    '.cm-tooltip': { backgroundColor: '#26262e', border: '1px solid #444', borderRadius: '8px', color: '#ddd', overflow: 'hidden' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: '#4b6cf0', color: '#fff' },
    '.cm-tooltip-autocomplete ul li': { padding: '2px 8px' },
  }, { dark: true })
}

onMounted(() => {
  if (!host.value) return
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        darkTheme(),
        html(),
        lineNumbers(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        autocompletion({ override: [myCompletion], activateOnTyping: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) emit('update:modelValue', u.state.doc.toString())
        }),
      ],
    }),
  })
})
onBeforeUnmount(() => { view?.destroy(); view = null })

watch(() => props.modelValue, (v) => {
  if (!view || v === view.state.doc.toString()) return
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } })
})
defineExpose({ focus: () => view?.focus() })
</script>

<template>
  <div ref="host" class="code-el"></div>
</template>

<style scoped>
.code-el { flex: 1; min-height: 0; overflow: hidden; }
.code-el :deep(.cm-editor) { height: 100%; }
</style>
