<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { useDeckStore } from '@/stores/deck'
import { renderLatex, typesetMixed } from '@/composables/useMathJax'
import { FONT_OPTIONS } from '@/types'
import type { SlideElement } from '@/types'
import ColorSwatches from './ColorSwatches.vue'
import { FORMULA_LIBRARY, FORMULA_TAGS, formulaTags } from '@/templates/formulaLibrary'
import type { FormulaItem } from '@/templates/formulaLibrary'
import { MATH_SYMBOLS } from '@/templates/mathSymbols'
import type { MathSymbol } from '@/templates/mathSymbols'
import {
  ensureFormulaLibrary, listFormulaLibrary, addFormulaEntry, removeFormulaEntry,
} from '@/composables/useFormulaLibrary'

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

/** 色板补充：公式色在紧凑 8 色后追加 4 色（暗红 / 琥珀 / 深蓝 / 洋红） */
const MATH_COLORS = ['#d64545', '#f4a63a', '#1d4e89', '#b23f88']
/** 背景色追加 3 个浅色底（米黄 / 浅蓝灰 / 暖灰） */
const BG_COLORS = ['#fdf6e3', '#e8edf4', '#f4f2ec']

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

/* ---------- 预设组合：内置 + 用户自定义（localStorage 持久化） ---------- */
const PRESET_KEY = 'lj-mathslides-vue:formula-presets'
interface Preset { label: string; latex: string; id?: number }

/** 自动起名：取首行前 14 个字符 */
function presetName(raw: string) {
  const first = raw.split('\n').map((s) => s.trim()).filter(Boolean)[0] || raw
  const t = first.replace(/\s+/g, ' ')
  return t.length > 14 ? t.slice(0, 14) + '…' : t
}
function loadUserPresets(): Preset[] {
  try {
    const arr = JSON.parse(localStorage.getItem(PRESET_KEY) || '[]')
    if (!Array.isArray(arr)) return []
    return arr
      .filter((p) => p && typeof p.latex === 'string' && p.latex.trim())
      .map((p) => ({ label: String(p.label || '').trim() || presetName(String(p.latex)), latex: String(p.latex) }))
  } catch { return [] }
}
const userPresets = ref<Preset[]>(loadUserPresets())
function persistUserPresets() {
  try { localStorage.setItem(PRESET_KEY, JSON.stringify(userPresets.value)) } catch { /* 忽略 */ }
}
/** 操作反馈（2.2 秒后自动消失） */
const presetTip = ref('')
let presetTipTimer: number | undefined
function flashPresetTip(t: string) {
  presetTip.value = t
  clearTimeout(presetTipTimer)
  presetTipTimer = window.setTimeout(() => { presetTip.value = '' }, 2200) as unknown as number
}
/** 把当前输入框内容存成预设组合 */
function addToPresets() {
  const raw = latex.value.trim()
  if (!raw) { flashPresetTip('输入框还是空的 —— 先写一条或从右侧公式库点一条'); return }
  if (PRESETS.some((p) => p.latex === raw) || userPresets.value.some((p) => p.latex === raw)) {
    flashPresetTip('这条已经在预设组合里了')
    return
  }
  userPresets.value = [...userPresets.value, { label: presetName(raw), latex: raw }]
  persistUserPresets()
  // 第一期公式库：同步写进本地库（失败也不影响界面；下次挂载会从库刷新）
  void addFormulaEntry(presetName(raw), raw).then(() => refreshPresetsFromLibrary())
  flashPresetTip('已加入预设组合')
}
function removePreset(i: number) {
  const p = userPresets.value[i]
  userPresets.value = userPresets.value.filter((_, k) => k !== i)
  persistUserPresets()
  // 第一期公式库：同步从库里删（内置条目 Rust 侧会拒绝；失败不影响界面）
  if (p?.id) void removeFormulaEntry(p.id)
}
/** 从内容库刷新「我的预设」（第一期：公式库）；库里没有就不动，保持原有 localStorage 内容 */
async function refreshPresetsFromLibrary() {
  const list = await listFormulaLibrary()
  const mine = list.filter((x) => !x.builtin)
  if (!mine.length) return
  userPresets.value = mine.map((x) => ({ label: x.title, latex: x.body, id: x.id }))
}

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
  if (!text) { previewHost.value.innerHTML = '<span class="ph">粘贴标准 LaTeX 公式，或从右侧公式库点击挑选</span>'; return }
  try { await typesetMixed(previewHost.value, text) } catch { /* 忽略 */ }
}

watch([latex, fontSize, color, multiLine, autoWrap], () => {
  clearTimeout(timer)
  timer = setTimeout(updatePreview, 200) as unknown as number
})

/* ---------------------------------------------------------------------------
 * 右侧「预制公式库」：单击填入上方输入框（可连续点多个），双击直接插入当前页
 * ------------------------------------------------------------------------- */
const libKey = ref(FORMULA_LIBRARY[0].key)
const libQuery = ref('')
const libTag = ref('')
const libWrap = ref<HTMLElement | null>(null)
const libActive = computed(() => FORMULA_LIBRARY.find((c) => c.key === libKey.value) || FORMULA_LIBRARY[0])

/** 当前展示的公式：搜索时跨分类搜；选标签时跨分类筛；否则用当前分类 */
const libVisible = computed<FormulaItem[]>(() => {
  const q = libQuery.value.trim().toLowerCase()
  const cats = (q || libTag.value) ? FORMULA_LIBRARY : [libActive.value]
  const hits: FormulaItem[] = []
  for (const c of cats) {
    for (const f of c.formulas) {
      if (q && !(f.label.toLowerCase().includes(q) || f.latex.toLowerCase().includes(q))) continue
      if (libTag.value && !formulaTags(f).includes(libTag.value)) continue
      hits.push(f)
    }
  }
  return hits
})

/** 排版右侧列表里的全部公式预览（22px 基准、只缩不放，保证各条视觉大小一致） */
async function renderLib() {
  await nextTick()
  const box = libWrap.value
  if (!box) return
  const jobs: Promise<unknown>[] = []
  for (const node of Array.from(box.querySelectorAll<HTMLElement>('[data-latex]'))) {
    node.innerHTML = ''
    jobs.push(renderLatex(node, node.getAttribute('data-latex') || '', 20, 1).catch(() => {}))
  }
  await Promise.all(jobs)
}
watch([libKey, libQuery, libTag], renderLib)
onMounted(async () => {
  nextTick(updatePreview)
  renderLib()
  // 第一期公式库：首次运行把内置公式灌库、把本地预设迁进库；随后刷新预设列表
  try {
    const r = await ensureFormulaLibrary()
    if (!r.skipped && (r.seeded || r.migrated)) {
      flashPresetTip('公式库就绪：内置 ' + r.seeded + ' 条，迁入预设 ' + r.migrated + ' 条')
    }
    await refreshPresetsFromLibrary()
  } catch { /* 库不可用时保持原有 localStorage 行为 */ }
})

let clickTimer: number | undefined
let pendingKey = ''
let pendingAt = 0
let lastAppend = { text: '', at: 0 }
onBeforeUnmount(() => { clearTimeout(clickTimer); clearTimeout(presetTipTimer) })

function keyOf(f: FormulaItem) { return f.latex + '|' + f.label }

/** 单击：把公式追加进输入框（连续点多个就依次排成多行） */
function appendFormula(f: FormulaItem) {
  const cur = latex.value.replace(/\s+$/, '')
  const added = cur ? '\n' + f.latex : f.latex
  latex.value = cur + added
  lastAppend = { text: added, at: Date.now() }
  nextTick(() => {
    const ta = texRef.value
    if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length }
  })
}
/** 双击：直接把这条公式插到当前页面（与「预制公式库」面板一致：选中公式元素则替换其内容） */
function insertDirect(f: FormulaItem) {
  // 双击的第一下可能已经触发过"填入输入框"，这里撤掉，避免重复
  if (lastAppend.text && Date.now() - lastAppend.at < 800 && latex.value.endsWith(lastAppend.text)) {
    latex.value = latex.value.slice(0, latex.value.length - lastAppend.text.length)
    lastAppend = { text: '', at: 0 }
  }
  store.clearDrawTool()
  const sel = store.selectedElement
  if (sel && sel.type === 'math') {
    store.updateElement(sel.id, { latex: f.latex } as Partial<SlideElement>)
  } else {
    store.addElement('math', {
      latex: f.latex, w: 620, h: 168, color: color.value, fontSize: Math.max(24, fontSize.value + 14),
      autoBox: true,   // 渲染后外框自动贴合公式，之后拖动即无级放大
    } as Partial<SlideElement>)
  }
}
function onCardClick(f: FormulaItem) {
  const now = Date.now()
  // 300ms 内的同一条第二次点击 = 双击的第二下，交给 dblclick 处理
  if (pendingKey === keyOf(f) && now - pendingAt < 300) {
    clearTimeout(clickTimer); clickTimer = undefined; pendingKey = ''
    return
  }
  clearTimeout(clickTimer)
  pendingKey = keyOf(f); pendingAt = now
  clickTimer = window.setTimeout(() => {
    clickTimer = undefined; pendingKey = ''
    appendFormula(f)
  }, 260) as unknown as number
}
function onCardDblClick(f: FormulaItem) {
  clearTimeout(clickTimer); clickTimer = undefined; pendingKey = ''
  insertDirect(f)
}

function insert() {
  const raw = latex.value.trim()
  if (!raw) return
  const t = buildText()
  if (!t) return
  store.clearDrawTool()
  store.addElement('richtex', {
    text: t, fontSize: fontSize.value, color: color.value,
    fontFamily: fontFamily.value, bgColor: bgColor.value, w: 640, h: 160, align: 'left',
    autoBox: true,   // 外框自动收成刚好包住内容，之后拖动即无级放大
  } as Partial<SlideElement>)
  emit('close')
}
function clearAll() { latex.value = '' }
/** 【v1749】符号面板：当前分类（借 AxMath 的页签分组 ✓） */
const symGroup = ref(MATH_SYMBOLS[0].key)
const symList = computed(() => (MATH_SYMBOLS.find((g) => g.key === symGroup.value) || MATH_SYMBOLS[0]).syms)
/**
 * 【v1749】点符号 → **插到光标处** ✓（与「硬换行」同一套 ✓）
 * · 普通符号：插完光标在符号**后面** ✓ 接着敲 ✓
 * · 结构模板（分式 / 根式 / 矩阵 / 方程组）：`in` 给了偏移 ✓ 光标直接**落进第一个 {} 里** ✓
 */
function insertSym(sym: MathSymbol) {
  const ta = texRef.value
  const cur = ta ? ta.selectionStart : latex.value.length
  const end = ta ? ta.selectionEnd : latex.value.length
  latex.value = latex.value.slice(0, cur) + sym.tex + latex.value.slice(end)
  const pos = cur + (sym.in == null ? sym.tex.length : sym.in)
  if (ta) nextTick(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = pos })
}
/** 在光标处插入一个硬换行（混排文本里显示为换行；若在 aligned/cases 里需换行用 \\） */
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
        <span class="panel__sub">左边写 / 贴 LaTeX，右边点选预制公式</span>
        <button class="panel__close" @click="emit('close')"><AppIcon name="close" :size="13" /></button>
      </header>

      <div class="panel__main">
        <!-- 左栏：原有布局保持不变 -->
        <div class="panel__body">
          <div class="lbl lbl--row">
            <span>公式内容 <em>（支持复制粘贴多段 LaTeX）</em></span>
            <span class="lbl__tools">
              <button class="chip chip--xs" title="在光标处插入硬换行（回车）" @click="insertHardBreak">⏎ 硬换行</button>
              <label class="chk"><input type="checkbox" v-model="multiLine" /> 多行显示</label>
              <label class="chk"><input type="checkbox" v-model="autoWrap" /> 自动换行</label>
            </span>
          </div>
          <!-- 【v1749】符号面板（借 AxMath 的分类页签 ✓）：点一下就插到光标处 ✓ -->
          <div class="sym">
            <div class="sym__tabs">
              <button v-for="g in MATH_SYMBOLS" :key="g.key" class="sym__tab" :class="{ 'sym__tab--on': g.key === symGroup }"
                :title="g.name" @click="symGroup = g.key">{{ g.icon }}<span class="sym__tabname">{{ g.name }}</span></button>
            </div>
            <div class="sym__grid">
              <button v-for="(sy, si) in symList" :key="si" class="sym__btn" :title="sy.tex" @click="insertSym(sy)">{{ sy.show }}</button>
            </div>
          </div>
          <textarea ref="texRef" class="latex" v-model="latex" rows="4" placeholder="粘贴标准 LaTeX 公式，或点击右侧公式库自动填入（可连点多个，逐行排列）。"></textarea>

          <div class="lbl">实时预览 <em>（与原式同色 / 同字号）</em></div>
          <div ref="previewHost" class="prev" :style="previewStyle"></div>

          <div class="ctrls">
            <div class="ctrl"><span class="ctrl__lbl">颜色</span><ColorSwatches compact :extra="MATH_COLORS" :model-value="color" @update:model-value="(v) => color = v" /></div>
            <div class="ctrl"><span class="ctrl__lbl">背景</span><ColorSwatches compact allow-transparent :extra="BG_COLORS" :model-value="bgColor" @update:model-value="(v) => bgColor = v" /></div>
            <div class="ctrl ctrl--inline"><span class="ctrl__lbl">字号</span>
              <div class="size"><input type="number" v-model.number="fontSize" min="8" max="60" /><em>px</em></div>
              <span class="ctrl__lbl ctrl__lbl--sub">字体</span>
              <select v-model="fontFamily" class="fontsel"><option v-for="f in FONT_OPTIONS" :key="f.v" :value="f.v">{{ f.label }}</option></select>
            </div>
          </div>

          <div class="lbl lbl--row">
            <span>预设组合 <em>（点击填入上方输入框{{ userPresets.length ? '；带 × 的是你自己存的' : '' }}）</em></span>
            <span class="lbl__tools">
              <span v-if="presetTip" class="chip-tip">{{ presetTip }}</span>
              <button class="chip chip--xs chip--add" title="把上方输入框里的内容存为预设组合，之后一点即填" @click="addToPresets"><AppIcon name="plus" :size="12" /> 加入预设组合</button>
            </span>
          </div>
          <div class="chips">
            <button v-for="p in PRESETS" :key="p.label" class="chip" :title="p.latex" @click="latex = p.latex">{{ p.label }}</button>
            <span
              v-for="(p, i) in userPresets"
              :key="'u' + i"
              class="chip chip--mine"
              :title="p.latex + '\n单击填入输入框 · 点右侧 × 删除'"
            >
              <span class="chip__t" @click="latex = p.latex">{{ p.label }}</span>
              <button class="chip__x" title="从预设组合里删除这一条" @click.stop="removePreset(i)"><AppIcon name="close" :size="13" /></button>
            </span>
          </div>
        </div>

        <!-- 右栏：预制公式库（带滚动条） -->
        <aside class="panel__lib">
          <div class="lib__head">
            <span class="lib__title">预制公式库 <em>{{ libVisible.length }} 条</em></span>
          </div>
          <div class="lib__search">
            <svg viewBox="0 0 24 24" width="14" height="14" class="lib__search-icon"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            <input v-model="libQuery" class="lib__search-input" placeholder="搜索：正弦 / 方差 / 集合…" />
            <button v-if="libQuery" class="lib__search-clear" @click="libQuery = ''"><AppIcon name="close" :size="12" /></button>
          </div>
          <select v-model="libKey" class="lib__cat" :disabled="!!libQuery || !!libTag">
            <option v-for="c in FORMULA_LIBRARY" :key="c.key" :value="c.key">{{ c.icon }} {{ c.name }}（{{ c.formulas.length }}）</option>
          </select>
          <div class="lib__tags">
            <button class="libtag" :class="{ 'libtag--on': libTag === '' }" @click="libTag = ''">全部</button>
            <button v-for="t in FORMULA_TAGS" :key="t" class="libtag" :class="{ 'libtag--on': libTag === t }" @click="libTag = (libTag === t ? '' : t)">{{ t }}</button>
          </div>

          <div ref="libWrap" class="lib__list">
            <button
              v-for="f in libVisible"
              :key="libKey + f.latex"
              class="lcard"
              :title="(f.note ? f.label + ' —— ' + f.note : f.label) + '\n单击：填入左侧输入框　双击：直接插入当前页'"
              @click="onCardClick(f)"
              @dblclick="onCardDblClick(f)"
            >
              <span class="lcard__pv" :data-latex="f.latex"></span>
              <span class="lcard__label">{{ f.label }}</span>
            </button>
            <div v-if="!libVisible.length" class="lib__empty">没有匹配的公式，换个关键词试试</div>
          </div>

          <div class="lib__hint">单击 = 填入左侧输入框（可连点多个）· 双击 = 直接插入当前页</div>
        </aside>
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
.panel { width: min(1120px, 96vw); max-height: 92vh; display: flex; flex-direction: column; background: #fff; border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); overflow: hidden; }
.panel__head { display: flex; align-items: center; gap: 10px; padding: 13px 18px; border-bottom: 1px solid var(--border); font-size: 15px; color: var(--text); }
.panel__sub { flex: 1; font-size: 12px; font-weight: 400; color: var(--muted); }
.panel__close { width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--border); background: #fff; color: var(--muted); font-size: 15px; cursor: pointer; flex: none; }
.panel__close:hover { background: var(--gray-50); color: var(--text); }

/* 左右两栏；各自滚动 */
.panel__main { display: flex; flex: 1; min-height: 0; }
.panel__body { flex: 1; min-width: 0; overflow-y: auto; padding: 14px 18px 6px; }

.lbl { font-size: 12px; color: var(--muted); margin: 12px 0 6px; font-weight: 600; }
.lbl em { font-weight: 400; color: #aaa; }
/* 标签行右侧放"硬换行 + 两个选项"，省掉独立的一行，输入框紧贴预览 */
.lbl--row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.lbl__tools { display: inline-flex; align-items: center; gap: 12px; font-weight: 400; }
.lbl__tools .chk { font-size: 11.5px; }
.latex { width: 100%; box-sizing: border-box; padding: 9px 11px; border: 1px solid #dcdce6; border-radius: 8px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; line-height: 1.6; resize: vertical; background: #fafafd; }
.latex:focus { outline: none; border-color: #7c5cd6; background: #fff; }
.opts { display: flex; gap: 18px; margin: 10px 0 2px; }
.chk { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--muted); cursor: pointer; }
.chk input { accent-color: var(--brand-600); }
.brk { display: flex; align-items: center; margin: 6px 0 4px; }
/* 颜色 / 背景两行紧凑排布，字号与字体合并到一行 */
.ctrl__lbl--sub { margin-left: 8px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 4px; }
.chip { padding: 4px 10px; border: 1px solid #d7d3e6; background: #fff; border-radius: 6px; font-size: 12px; color: #5a5770; cursor: pointer; transition: background .12s, border-color .12s, color .12s; }
.chip:hover { background: #f1eeff; border-color: #b9a9f0; color: var(--brand-700); }
.chip--xs { padding: 2px 8px; font-size: 11px; }
.chip--add { border-color: var(--brand-400); color: var(--brand-700); }
.chip--add:hover { background: var(--brand-soft); border-color: var(--brand-500); }
.chip-tip { font-size: 11.5px; color: var(--brand-700); margin-right: 4px; }
/* 用户自己存下来的预设：浅紫底 + 右侧 × 删除 */
.chip--mine { display: inline-flex; align-items: center; gap: 1px; padding: 0 4px 0 10px; border-color: var(--brand-300, #c4b5fd); background: #f7f5ff; color: var(--brand-800, #5b21b6); }
.chip--mine:hover { background: var(--brand-soft); }
.chip__t { cursor: pointer; padding: 4px 0; }
.chip__x { border: none; background: transparent; color: #a99ecb; cursor: pointer; font-size: 13px; line-height: 1; padding: 2px 4px; border-radius: 5px; }
.chip__x:hover { background: #fee4e2; color: var(--danger, #d92d20); }
.ctrls { display: flex; flex-direction: column; gap: 6px; margin: 8px 0 4px; }
.ctrl { display: flex; align-items: flex-start; gap: 10px; }
.ctrl__lbl { flex: none; font-size: 12px; color: var(--muted); line-height: 24px; min-width: 30px; }
.ctrl--inline { align-items: center; gap: 12px; }
.size { display: flex; align-items: center; gap: 5px; }
.size input { width: 62px; padding: 5px 7px; border: 1px solid #dcdce6; border-radius: 6px; font-size: 13px; }
.size em { font-style: normal; font-size: 12px; color: var(--muted); }
.fontsel { padding: 5px 8px; border: 1px solid #dcdce6; border-radius: 6px; font-size: 13px; }
.prev { border: 1px solid #e8e8f0; border-radius: 10px; padding: 14px 16px; min-height: 78px; line-height: 1.7; word-break: break-word; overflow: visible; background: linear-gradient(#fbfbfe, #f7f7fd); box-shadow: inset 0 1px 2px rgba(20, 24, 34, 0.04); }
.prev .ph { color: #bbb; font-size: 13px; }

/* ---- 右侧预制公式库 ---- */
.panel__lib {
  width: 396px; flex: none; min-height: 0;
  display: flex; flex-direction: column;
  border-left: 1px solid var(--border);
  background: linear-gradient(#fcfcff, #fafafd);
}
.lib__head { padding: 12px 14px 6px; }
.lib__title { font-size: 13px; font-weight: 600; color: var(--text); }
.lib__title em { font-style: normal; font-weight: 400; font-size: 11.5px; color: var(--muted); margin-left: 4px; }
.lib__search { display: flex; align-items: center; gap: 7px; margin: 0 14px 6px; padding: 6px 10px; border: 1px solid #e7e7ef; border-radius: 9px; background: #fff; }
.lib__search-icon { color: #9a9aa4; flex: none; }
.lib__search-input { flex: 1; min-width: 0; border: none; background: transparent; font-size: 12.5px; color: var(--text); outline: none; }
.lib__search-input::placeholder { color: #b4b4be; }
.lib__search-clear { border: none; background: #ececf3; color: #6b6b78; width: 18px; height: 18px; border-radius: 50%; cursor: pointer; font-size: 12px; line-height: 1; flex: none; }
.lib__cat { margin: 0 14px 6px; padding: 5px 8px; border: 1px solid #e7e7ef; border-radius: 8px; font-size: 12.5px; color: var(--text); background: #fff; }
.lib__cat:disabled { opacity: 0.55; }
.lib__tags { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 14px 8px; }
.libtag { padding: 2px 9px; border: 1px solid #e2dff0; background: #fff; border-radius: 999px; font-size: 11px; color: #6b6880; cursor: pointer; }
.libtag:hover { background: var(--brand-soft); border-color: var(--brand-300); }
.libtag--on { background: var(--brand-600); border-color: var(--brand-600); color: #fff; }

.lib__list { flex: 1; min-height: 0; overflow-y: auto; padding: 2px 12px 8px; display: flex; flex-direction: column; gap: 5px; }
.lcard {
  display: flex; align-items: center; gap: 9px; width: 100%;
  padding: 5px 8px 5px 6px; border: 1px solid #eeeef5; border-radius: 9px; background: #fff;
  cursor: pointer; text-align: left;
  transition: border-color .12s, box-shadow .12s, background .12s, transform .12s;
}
.lcard:hover { border-color: var(--brand-300); background: #fbfaff; box-shadow: 0 4px 12px rgba(124, 58, 237, 0.09); transform: translateX(-1px); }
.lcard:active { transform: scale(0.995); }
.lcard__pv {
  flex: none; width: 168px; height: 46px; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  border-radius: 7px; background: #fbfbfd; font-size: 20px;
}
.lcard__pv :deep(mjx-container) { display: inline-flex !important; }
.lcard__label { flex: 1; min-width: 0; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lib__empty { padding: 24px 8px; text-align: center; font-size: 12px; color: #a6a6b0; }
.lib__hint { padding: 8px 14px; border-top: 1px solid #f0f0f4; font-size: 11.5px; color: var(--muted); }

.panel__foot { display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--border); padding: 11px 18px; background: #fff; }
.foot { padding: 7px 16px; border: 1px solid #dcdce6; background: #fff; border-radius: 7px; font-size: 13px; color: var(--muted); cursor: pointer; transition: background .12s; }
.foot:hover { background: var(--gray-50); }
.foot--primary { background: var(--brand-600); border-color: var(--brand-600); color: #fff; font-weight: 600; }
.foot--primary:hover { background: var(--brand-700); border-color: var(--brand-700); }

/* 窄屏：先保证左栏可用 */
@media (max-width: 900px) {
  .panel__lib { width: 320px; }
  .lcard__pv { width: 120px; }
}
  /* 【v1749】符号面板（借 AxMath 的分类页签 ✓）：页签横向可滚 ✓ 网格紧凑 ✓ 结构模板长按看 tip ✓ */
  .sym { border: 1px solid #dcdce6; border-radius: 8px; background: #fbfbfd; margin: 6px 0 8px; overflow: hidden; }
  .sym__tabs { display: flex; gap: 2px; overflow-x: auto; padding: 4px 4px 0; background: #f2f2f7; }
  .sym__tab { display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border: 1px solid transparent;
    border-bottom: none; border-radius: 6px 6px 0 0; background: transparent; color: #5b5b6b; font-size: 13px; cursor: pointer; white-space: nowrap; }
  .sym__tab:hover { background: #e7e7f0; }
  .sym__tab--on { background: #fff; border-color: #dcdce6; color: var(--brand-600); font-weight: 600; }
  .sym__tabname { font-size: 12px; }
  .sym__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(42px, 1fr)); gap: 2px; padding: 6px;
    max-height: 170px; overflow-y: auto; background: #fff; }
  .sym__btn { height: 34px; border: 1px solid #e6e6ef; border-radius: 6px; background: #fff; color: #1f1f2e;
    font-size: 16px; line-height: 1; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sym__btn:hover { background: var(--brand-50, #eef2ff); border-color: var(--brand-300, #b9c4f5); }
  .sym__btn:active { transform: translateY(1px); }
  @media (max-width: 900px) { .sym__tabname { display: none; } }
</style>
