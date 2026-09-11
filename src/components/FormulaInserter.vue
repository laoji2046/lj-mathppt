<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useDeckStore } from '@/stores/deck'
import { typesetMixed } from '@/composables/useMathJax'
import { FONT_OPTIONS } from '@/types'
import type { SlideElement } from '@/types'
import ColorSwatches from './ColorSwatches.vue'

const store = useDeckStore()
const emit = defineEmits<{ (e: 'close'): void }>()

const latex = ref('')
const multiLine = ref(false)
const autoWrap = ref(false)
const fontFamily = ref('default')
const fontSize = ref(18)
const color = ref('#1a1a1a')
const bgColor = ref('transparent')

const previewHost = ref<HTMLElement | null>(null)
const texRef = ref<HTMLTextAreaElement | null>(null)
let timer: number | undefined

/** 预设组合（点击填入） */
const PRESETS: { label: string; latex: string }[] = [
  { label: '方程组', latex: '\\begin{cases} x+y=3 \\\\ x-y=1 \\end{cases}' },
  { label: '联立方程组', latex: '\\begin{cases} 2x+3y=1 \\\\ x-y=2 \\end{cases}' },
  { label: '多行推导', latex: '$$a^2+b^2=c^2$$\n$$\\Rightarrow c=\\sqrt{a^2+b^2}$$' },
  { label: '分式链', latex: '\\frac{a}{b}=\\frac{c}{d}=\\frac{e}{f}' },
  { label: '分段函数', latex: 'f(x)=\\begin{cases} x+1, & x\\ge0 \\\\ x^2, & x<0 \\end{cases}' },
  { label: '积分公式', latex: '\\int_a^b f(x)\\,dx=F(b)-F(a)' },
  { label: '一元二次', latex: 'x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}' },
  { label: '不等式链', latex: 'a \\le b \\le c' },
  { label: '不等式链带名', latex: 'a \\le b \\le c \\quad(\\text{传递性})' },
  { label: '对数平均链', latex: '\\sqrt{ab}\\le \\frac{a+b}{2}' },
  { label: '指数平均链', latex: '\\mu\\le\\sigma' },
]

function fontStackLabel(k: string) {
  return FONT_OPTIONS.find((f) => f.v === k)?.stack ?? 'inherit'
}

const previewStyle = computed(() => ({
  color: color.value,
  fontSize: fontSize.value + 'px',
  fontFamily: fontStackLabel(fontFamily.value),
  background: bgColor.value && bgColor.value !== 'transparent' ? bgColor.value : 'transparent',
  padding: bgColor.value && bgColor.value !== 'transparent' ? '6px 12px' : '0',
  borderRadius: bgColor.value && bgColor.value !== 'transparent' ? '6px' : '0',
  whiteSpace: autoWrap.value ? 'pre-wrap' : 'normal',
}))

function hasDelim(l: string) {
  return /^\$\$[\s\S]*\$\$$/.test(l) || /^\\\[[\s\S]*\\\]$/.test(l) || /^\\\([\s\S]*\\\)$/.test(l)
}
/** 把公式内容组装成混排文本：多行显示=每行一个 \[...\] 块；否则合并为内联 */
function buildText() {
  const raw = latex.value.trim()
  if (!raw) return ''
  // 含中文的混排正文：去掉 MathJax 不支持的列表环境，保留 $...$ 行内公式；不整体包成显示公式
  if (/[\u4e00-\u9fa5]/.test(raw)) {
    return raw
      .replace(/\\begin\{(itemize|enumerate|description)\}/g, '')
      .replace(/\\end\{(itemize|enumerate|description)\}/g, '')
      .replace(/\\item\b/g, '')
      .trim()
  }
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  if (lines.length <= 1) {
    const l = lines[0] || raw
    return hasDelim(l) ? l : '\\[' + l + '\\]'
  }
  if (multiLine.value) return lines.map((l) => (hasDelim(l) ? l : '\\[' + l + '\\]')).join('\n')
  return lines.map((l) => (hasDelim(l) ? l : '\\(' + l + '\\)')).join('\n')
}

async function updatePreview() {
  if (!previewHost.value) return
  const text = buildText()
  if (!text) { previewHost.value.innerHTML = '<span class="ph">粘贴标准 LaTeX 公式，此处实时预览组合结果</span>'; return }
  try { await typesetMixed(previewHost.value, text) } catch { /* 忽略 */ }
}

watch([latex, fontSize, color, multiLine, autoWrap], () => {
  clearTimeout(timer)
  timer = setTimeout(updatePreview, 200) as unknown as number
})
onMounted(() => { nextTick(updatePreview) })

function insert() {
  const raw = latex.value.trim()
  if (!raw) return
  const t = buildText()
  if (!t) return
  store.clearDrawTool()
  store.addElement('richtex', {
    text: t, fontSize: fontSize.value, color: color.value,
    fontFamily: fontFamily.value, bgColor: bgColor.value, w: 640, h: 160, align: 'left',
  } as Partial<SlideElement>)
  emit('close')
}
function clearAll() { latex.value = '' }
/** 在光标处插入一个硬换行\n（混排文本里显示为换行；若在 aligned/cases 里需换行用 \\） */
function insertHardBreak() {
  const ta = texRef.value
  const cur = ta ? ta.selectionStart : latex.value.length
  const end = ta ? ta.selectionEnd : latex.value.length
  const ch = '\n'
  latex.value = latex.value.slice(0, cur) + ch + latex.value.slice(end)
  if (ta) nextTick(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = cur + ch.length })
}
</script>

<template>
  <div class="palette" @mousedown.self="emit('close')">
    <div class="panel">
      <header class="panel__head">
        <strong>组合公式</strong>
        <button class="panel__close" @click="emit('close')">✕</button>
      </header>

      <div class="panel__body">
        <div class="lbl">公式内容 <em>（支持复制粘贴多段 LaTeX）</em></div>
        <div class="brk"><button class="chip" title="在光标处插入硬换行（回车）" @click="insertHardBreak">⏎ 硬换行</button></div>
        <textarea ref="texRef" class="latex" v-model="latex" rows="4" placeholder="粘贴标准 LaTeX 公式，如 \frac{x^2}{a^2}+\frac{y^2}{b^2}=1 或带定界符的 $$...$$ / \[...\]：组合成一个公式块。"></textarea>

        <div class="opts">
          <label class="chk"><input type="checkbox" v-model="multiLine" /> 多行显示（每行一段）</label>
          <label class="chk"><input type="checkbox" v-model="autoWrap" /> 自动换行</label>
        </div>

        <div class="lbl">预设组合 <em>（点击填入）</em></div>
        <div class="chips">
          <button v-for="p in PRESETS" :key="p.label" class="chip" @click="latex = p.latex">{{ p.label }}</button>
        </div>

        <div class="ctrls">
          <div class="ctrl"><span class="ctrl__lbl">颜色</span><ColorSwatches :model-value="color" @update:model-value="(v) => color = v" /></div>
          <div class="ctrl ctrl--inline"><span class="ctrl__lbl">字号</span>
            <div class="size"><input type="number" v-model.number="fontSize" min="8" max="60" /><em>px</em></div>
          </div>
          <div class="ctrl ctrl--inline"><span class="ctrl__lbl">字体</span>
            <select v-model="fontFamily" class="fontsel"><option v-for="f in FONT_OPTIONS" :key="f.v" :value="f.v">{{ f.label }}</option></select>
          </div>
          <div class="ctrl"><span class="ctrl__lbl">背景</span><ColorSwatches :model-value="bgColor" allow-transparent @update:model-value="(v) => bgColor = v" /></div>
        </div>

        <div class="lbl">实时预览</div>
        <div ref="previewHost" class="prev" :style="previewStyle"></div>

      </div>

      <footer class="panel__foot">
        <button class="foot" @click="clearAll">清空</button>
        <button class="foot" @click="emit('close')">取消</button>
        <button class="foot foot--primary" @click="insert">插入公式</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.palette { position: fixed; inset: 0; z-index: 410; background: rgba(15,18,30,0.5); display: flex; align-items: center; justify-content: center; }
.panel { width: min(640px, 94vw); max-height: 92vh; display: flex; flex-direction: column; background: #fff; border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); overflow: hidden; }
.panel__head { display: flex; align-items: center; justify-content: space-between; padding: 13px 18px; border-bottom: 1px solid var(--border); font-size: 15px; color: var(--text); }
.panel__close { width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--border); background: #fff; color: var(--muted); font-size: 15px; cursor: pointer; }
.panel__close:hover { background: var(--gray-50); color: var(--text); }
.panel__body { flex: 1; overflow-y: auto; padding: 14px 18px 6px; }
.lbl { font-size: 12px; color: var(--muted); margin: 12px 0 6px; font-weight: 600; }
.lbl em { font-weight: 400; color: #aaa; }
.latex { width: 100%; box-sizing: border-box; padding: 9px 11px; border: 1px solid #dcdce6; border-radius: 8px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; line-height: 1.6; resize: vertical; background: #fafafd; }
.latex:focus { outline: none; border-color: #7c5cd6; background: #fff; }
.opts { display: flex; gap: 18px; margin: 10px 0 2px; }
.chk { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--muted); cursor: pointer; }
.chk input { accent-color: var(--brand-600); }
.brk { display: flex; align-items: center; margin: 6px 0 4px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 4px; }
.chip { padding: 4px 10px; border: 1px solid #d7d3e6; background: #fff; border-radius: 6px; font-size: 12px; color: #5a5770; cursor: pointer; transition: background .12s, border-color .12s, color .12s; }
.chip:hover { background: #f1eeff; border-color: #b9a9f0; color: var(--brand-700); }
.ctrls { display: flex; flex-direction: column; gap: 8px; margin: 6px 0; }
.ctrl { display: flex; align-items: flex-start; gap: 10px; }
.ctrl__lbl { flex: none; font-size: 12px; color: var(--muted); line-height: 28px; min-width: 30px; }
.ctrl--inline { align-items: center; gap: 12px; }
.size { display: flex; align-items: center; gap: 5px; }
.size input { width: 62px; padding: 5px 7px; border: 1px solid #dcdce6; border-radius: 6px; font-size: 13px; }
.size em { font-style: normal; font-size: 12px; color: var(--muted); }
.fontsel { padding: 5px 8px; border: 1px solid #dcdce6; border-radius: 6px; font-size: 13px; }
.prev { border: 1px solid #e8e8f0; border-radius: 10px; padding: 14px; min-height: 80px; line-height: 1.7; word-break: break-word; overflow: visible; background: #fbfbfe; }
.prev .ph { color: #bbb; font-size: 13px; }
.panel__foot { display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--border); padding: 11px 18px; background: #fff; }
.foot { padding: 7px 16px; border: 1px solid #dcdce6; background: #fff; border-radius: 7px; font-size: 13px; color: var(--muted); cursor: pointer; transition: background .12s; }
.foot:hover { background: var(--gray-50); }
.foot--primary { background: var(--brand-600); border-color: var(--brand-600); color: #fff; font-weight: 600; }
.foot--primary:hover { background: var(--brand-700); border-color: var(--brand-700); }
</style>
