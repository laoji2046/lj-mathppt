<script setup lang="ts">
/**
 * 【v1691】试卷编辑里的 AI（用户要的三件事：组卷 / 原创出题 / 让 AI 直接操作试卷 ✓）
 *
 * 这个对话框负责前两件：说一句话 → 从**题库**组卷，或让模型**命制新题** → 按试卷排版插进去 ✓。
 * 第三件（AI 助手直接改试卷）在右侧 AI 助手里，走 aiTools 的试卷工具 ✓。
 *
 * 纪律：
 *  · 口径与提示词都在 composables/aiPaper.ts（纯函数，探针覆盖 ✓），这里只做界面与调用 ✓；
 *  · 插进试卷一律走 ui/paper.sendToPaper ✓ —— 图号重编、[分页]、题目块那些约定由试卷那边统一处理 ✓；
 *  · 模型生成的题**必须提示核对**（答案与解析可能错 ✗），不吹成"成品卷"✗。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { invoke } from '@/composables/useTauri'
import { licensed } from '@/composables/useLicense'
import { SECTIONS, pickImages, qSearch, questionBlockOf } from '@/composables/useQuestionBank'
import type { QItem } from '@/composables/useQuestionBank'
import { parseAiQuestions } from '@/composables/aiImport'
import {
  PAPER_QTYPES, aiQuestionBlockOf, buildMakePrompt, buildPlanPrompt,
  paperDocOf, parsePaperPlan, planGaps, planSummary, planTotal,
} from '@/composables/aiPaper'
import type { PaperPlan } from '@/composables/aiPaper'
import { sendToPaper } from '@/ui/paper'

const emit = defineEmits<{ (e: 'close'): void }>()

const want = ref('')
const plan = ref<PaperPlan | null>(null)
const busy = ref(false)
const prog = ref('')
const msg = ref('')
const report = ref('')
/** 组卷时每节实际找到几道（缺题报告要用 ✓） */
const found = ref<Record<string, number>>({})
/** AI 补出来的题（题库不够时用 ✓） */
const made = ref<{ qtype: string; block: string }[]>([])
const withAnswer = ref(false)

function aiKey(): string {
  try {
    for (const k of Object.keys(localStorage)) {
      if (!/ai[-_]?key/i.test(k)) continue
      const v = String(localStorage.getItem(k) || '').trim()
      if (v) return v
    }
  } catch { /* 隐私模式读不到就算了 */ }
  return ''
}

async function callModel(system: string, userText: string): Promise<string> {
  const r = await invoke<{ ok?: boolean; text?: string; content?: string; error?: string }>('ai_chat', {
    baseUrl: '', apiKey: aiKey(), model: 'deepseek-chat', system, userText,
  })
  if (r && r.ok === false) throw new Error(String(r.error || '调用失败'))
  return String((r && (r.text || r.content)) || '')
}

const summary = computed(() => (plan.value ? planSummary(plan.value) : ''))
const gaps = computed(() => (plan.value ? planGaps(plan.value, found.value) : []))

/** 前置检查：激活 + key + 说了一句话 ✓ */
function ready(): boolean {
  if (!want.value.trim()) { msg.value = '先说一句要什么，例如「高二解析几何，2 选择 1 填空 1 解答，中档」'; return false }
  if (!licensed('ai-assistant')) { msg.value = 'AI 组卷要先激活：工具栏「激活 / 序列号」'; return false }
  if (!aiKey()) { msg.value = '还没填 AI Key：设置 → AI 助手 里填一个（只存本机）'; return false }
  return true
}

/** ① 让模型把那句话翻成组卷条件（口径在 aiPaper.parsePaperPlan ✓） */
async function makePlan(): Promise<PaperPlan | null> {
  prog.value = '正在理解你这句话…'
  const p = buildPlanPrompt(want.value.trim(), { sections: SECTIONS.slice() })
  const raw = await callModel(p.system, p.user)
  const parsed = parsePaperPlan(raw, SECTIONS.slice())
  if (!planTotal(parsed)) {
    // 一个题型都没说清 —— 不硬猜 ✓，按「选择 5 + 填空 3 + 解答 3」这种默认也不合适 ✗
    msg.value = '没听懂题量（比如「2 选择 1 填空 1 解答」）—— 换句话再说一次'
    return null
  }
  parsed.withAnswer = withAnswer.value
  return parsed
}

/** ② 从题库组卷：按题型分节检索 → 排成题目块 ✓ */
async function doBuild(keepPlan = false) {
  msg.value = ''
  report.value = ''
  made.value = []
  if (!keepPlan) {
    if (!ready()) return
  } else if (!plan.value) return
  busy.value = true
  try {
    const p = keepPlan && plan.value ? plan.value : await makePlan()
    if (!p) return
    p.withAnswer = withAnswer.value
    plan.value = p
    prog.value = '正在题库里挑题…'
    const parts: { heading: string; blocks: string[] }[] = []
    const imgs: { n: number; src: string; caption?: string }[] = []
    const got: Record<string, number> = {}
    let no = 0
    let total = 0
    for (const t of PAPER_QTYPES) {
      const n = p.counts[t.key] || 0
      if (!n) continue
      const r = await qSearch({
        section: p.section || undefined,
        level: p.level || undefined,
        q: p.kp || undefined,
        qtype: t.key,
        limit: n,
      })
      const list: QItem[] = (r && r.items) || []
      got[t.key] = list.length
      const blocks: string[] = []
      for (const it of list) {
        const b = questionBlockOf(it, p.withAnswer, ++no)
        if (!b) { no--; continue }
        blocks.push(b)
        for (const im of await pickImages(it)) imgs.push({ n: im.n, src: im.src, caption: im.caption })
      }
      total += blocks.length
      parts.push({ heading: t.heading, blocks })
    }
    found.value = got
    if (!total) {
      msg.value = '题库里按这个条件一道都没找到 —— 换个章节/关键词，或点「让 AI 出题」'
      report.value = '条件：' + planSummary(p) + '\n' + (planGaps(p, got).join('\n') || '（没找到题）')
      return
    }
    const doc = paperDocOf(p.title, parts)
    sendToPaper({ text: doc, id: 0, label: 'AI 组卷 ' + total + ' 道', imgs })
    const miss = planGaps(p, got)
    report.value = [
      '条件：' + planSummary(p),
      '插入 ' + total + ' 道' + (imgs.length ? '（配图 ' + imgs.length + ' 张）' : ''),
      miss.length ? '题库里缺：' + miss.join('；') + ' —— 可以点「缺的让 AI 补」✓' : '按条件齐了 ✓',
      p.withAnswer ? '卷面带了答案与解析（打印时会展开 ✓）' : '卷面不带答案（要答案就勾上「带答案解析」重来 ✓）',
      '插进的是**题目块**：解析默认收起、题干与解析不会被分页拆开 ✓',
    ].join('\n')
    msg.value = '已插进试卷 ' + total + ' 道 ✓ —— 关掉本窗口看排版'
  } catch (e) {
    msg.value = '组卷失败：' + String((e as Error)?.message || e)
  } finally {
    busy.value = false
    prog.value = ''
  }
}

/** ③ 缺的让 AI 出（用户要的第 2 件事 ✓） */
async function doFillByAi() {
  msg.value = ''
  if (!plan.value) { msg.value = '先点一次「从题库组卷」，让我知道要什么'; return }
  const miss = gaps.value
  if (!miss.length) { msg.value = '题库里已经够了，不需要补'; return }
  const need = PAPER_QTYPES.filter((t) => (plan.value as PaperPlan).counts[t.key] > (found.value[t.key] || 0))
  const count = need.reduce((n, t) => n + ((plan.value as PaperPlan).counts[t.key] - (found.value[t.key] || 0)), 0)
  busy.value = true
  try {
    prog.value = '正在命题（' + count + ' 道）…'
    const p = buildMakePrompt(plan.value, count)
    const raw = await callModel(p.system, p.user)
    const parsed = parseAiQuestions(raw)
    if (!parsed.items.length) {
      msg.value = parsed.warn[0] || '模型没给出题目，换个说法再试'
      return
    }
    // 只补**缺的那些题型**（多出来的丢掉 ✓，免得卷面题型错乱 ✗）
    const left: Record<string, number> = {}
    for (const t of need) left[t.key] = plan.value.counts[t.key] - (found.value[t.key] || 0)
    const blocks: { heading: string; blocks: string[] }[] = []
    const pushed: { qtype: string; block: string }[] = []
    for (const t of PAPER_QTYPES) {
      const room = left[t.key] || 0
      if (!room) continue
      const list = parsed.items.filter((q) => q.qtype === t.key).slice(0, room)
      const bs = list.map((q, i) => aiQuestionBlockOf(q, i + 1)).filter(Boolean)
      for (const b of bs) pushed.push({ qtype: t.key, block: b })
      if (bs.length) blocks.push({ heading: t.heading, blocks: bs })
    }
    if (!pushed.length) {
      msg.value = '模型给的题型和缺的对不上（缺的是：' + need.map((t) => t.label).join('、') + '）—— 再点一次试试'
      return
    }
    made.value = pushed
    const doc = paperDocOf('', blocks)
    sendToPaper({ text: doc, id: 0, label: 'AI 补题 ' + pushed.length + ' 道', imgs: [] })
    report.value = [
      'AI 补了 ' + pushed.length + ' 道（' + need.map((t) => t.label).join('、') + '）',
      '⚠ 这些是模型命制的题：**答案与解析请务必核对**再进卷子 ✗',
      parsed.skipped ? '（另有 ' + parsed.skipped + ' 条没题干，已丢掉）' : '',
      '插进试卷后可以直接在左边文字里改 —— 想撤掉用 Ctrl+Z ✓',
    ].filter(Boolean).join('\n')
    msg.value = '已补 ' + pushed.length + ' 道 ✓ —— 记得核对答案'
  } catch (e) {
    msg.value = '补题失败：' + String((e as Error)?.message || e)
  } finally {
    busy.value = false
    prog.value = ''
  }
}

/** ④ 整卷都让 AI 出（题库里没合适的 ✓） */
async function doMakeAll() {
  msg.value = ''
  if (!ready()) return
  busy.value = true
  try {
    const p = plan.value && planTotal(plan.value) ? plan.value : await makePlan()
    if (!p) return
    plan.value = p
    p.withAnswer = true      // 原创题必须带答案（老师要照着核对 ✓）
    const count = Math.max(1, Math.min(20, planTotal(p) || 5))
    prog.value = '正在命题（' + count + ' 道）…'
    const pr = buildMakePrompt(p, count)
    const raw = await callModel(pr.system, pr.user)
    const parsed = parseAiQuestions(raw)
    if (!parsed.items.length) { msg.value = parsed.warn[0] || '模型没给出题目'; return }
    let no = 0
    const parts: { heading: string; blocks: string[] }[] = []
    for (const t of PAPER_QTYPES) {
      const list = parsed.items.filter((q) => q.qtype === t.key)
      if (!list.length) continue
      parts.push({ heading: t.heading, blocks: list.map((q) => aiQuestionBlockOf(q, ++no)).filter(Boolean) })
    }
    const total = parts.reduce((n, s) => n + s.blocks.length, 0)
    if (!total) { msg.value = '模型给的题都没题干，已丢掉'; return }
    sendToPaper({ text: paperDocOf(p.title, parts), id: 0, label: 'AI 命题 ' + total + ' 道', imgs: [] })
    report.value = [
      '条件：' + planSummary(p),
      'AI 命制 ' + total + ' 道（带答案解析 ✓）',
      '⚠ 模型出的题**答案与解析务必核对**：它可能算错、也可能出成成题 ✗',
      '要改就在左边文字里改；想撤掉用 Ctrl+Z ✓',
    ].join('\n')
    msg.value = '已插进试卷 ' + total + ' 道 ✓'
  } catch (e) {
    msg.value = '命题失败：' + String((e as Error)?.message || e)
  } finally {
    busy.value = false
    prog.value = ''
  }
}

function closeMe() { emit('close') }
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { e.stopPropagation(); closeMe() } }
onMounted(() => document.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey, true))
</script>

<template>
  <div class="aip">
    <div class="aip__box">
      <header class="aip__head">
        <span class="aip__title">AI 组卷</span>
        <span class="aip__sub">说一句要什么 → 从题库挑题，或让 AI 命新题 → 按试卷排版插进去</span>
        <span v-if="msg" class="aip__msg">{{ msg }}</span>
        <button class="aip__close" title="关闭" @click="closeMe"><AppIcon name="close" :size="13" /></button>
      </header>

      <div class="aip__body">
        <textarea
          v-model="want" class="aip__ta" rows="3" spellcheck="false"
          placeholder="例如：高二解析几何，2 选择 1 填空 1 解答，中档（也可以写「三角函数 5 道选择题」）"
        ></textarea>

        <div class="aip__row">
          <label class="aip__chk" title="考卷通常不带答案；勾上会把答案与解析放进 [解析] 段（打印时自动展开）">
            <input v-model="withAnswer" type="checkbox" />卷面带答案解析
          </label>
          <span class="aip__hint2">题号、分页、[题] 块由试卷自己处理 ✓</span>
        </div>

        <div class="aip__row">
          <button class="aip__btn aip__btn--main" :disabled="busy" @click="doBuild()">从题库组卷</button>
          <button class="aip__btn" :disabled="busy || !gaps.length" title="题库里缺的那几道，让模型现命（答案要核对 ✓）" @click="doFillByAi">缺的让 AI 补</button>
          <button class="aip__btn" :disabled="busy" title="不用题库，整套都让模型命制（答案与解析务必核对 ✓）" @click="doMakeAll">整套让 AI 出</button>
        </div>

        <div v-if="prog" class="aip__prog">{{ prog }}</div>
        <div v-if="summary" class="aip__plan">条件：{{ summary }}</div>
        <pre v-if="report" class="aip__report">{{ report }}</pre>

        <div class="aip__hint">
          · **组卷**是把题库里已有的题按题型分大题排好（题图会一起带过来 ✓）；<br />
          · **AI 命题**是模型现写的题 —— 答案与解析请你务必过一遍 ✗（模型会算错）；<br />
          · 想要「帮我改这份卷子」这类操作，用右侧的 AI 助手，它能直接读/改试卷 ✓。
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.aip { position: fixed; inset: 0; z-index: 3400; background: rgba(20, 24, 34, 0.5); display: flex; align-items: center; justify-content: center; }
.aip__box { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: min(680px, 94vw); display: flex; flex-direction: column; overflow: hidden; }
.aip__head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.aip__title { font-size: 15px; font-weight: 700; color: var(--text); }
.aip__sub { font-size: 12px; color: var(--muted); }
.aip__msg { font-size: 12px; color: var(--brand-600, #534AB7); }
.aip__close { margin-left: auto; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; cursor: pointer; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--gray-600); }
.aip__body { padding: 12px 16px 14px; display: flex; flex-direction: column; gap: 8px; }
.aip__ta { width: 100%; box-sizing: border-box; resize: vertical; font: inherit; font-size: 13px; line-height: 1.6; padding: 8px; border: 1px solid var(--border); border-radius: 8px; color: var(--text); }
.aip__row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.aip__chk { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; color: var(--text); }
.aip__hint2 { font-size: 11.5px; color: var(--muted); }
.aip__btn { height: 30px; padding: 0 12px; border: 1px solid var(--border); border-radius: 6px; background: #fff; font-size: 12.5px; cursor: pointer; color: var(--text); }
.aip__btn:disabled { opacity: .5; cursor: not-allowed; }
.aip__btn--main { background: var(--brand-600, #534AB7); border-color: var(--brand-600, #534AB7); color: #fff; }
.aip__prog { font-size: 12px; color: var(--brand-600, #534AB7); }
.aip__plan { font-size: 12px; color: var(--text); background: var(--gray-50); border: 1px solid var(--border); border-radius: 6px; padding: 5px 8px; }
.aip__report { margin: 0; white-space: pre-wrap; font-size: 11.5px; line-height: 1.7; color: var(--gray-700); background: var(--gray-50); border: 1px solid var(--border); border-radius: 6px; padding: 8px; }
.aip__hint { font-size: 11.5px; line-height: 1.7; color: var(--muted); border-top: 1px dashed var(--border); padding-top: 6px; }
</style>
