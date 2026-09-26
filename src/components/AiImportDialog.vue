<script setup lang="ts">
/**
 * 【v1684】AI 导入试题对话框（用户口径 2026-09-26 ✓）
 *
 * 为什么是**大对话框**、入口挂在**试题库窗口**：批量改题卡要横向铺开，侧边栏太窄放不下 ✗（用户指出 ✓）。
 * 流程：贴原文 / 拖文件 →「AI 抽题」→ 题卡**就地改** → 一键**写待复核草稿**（正式库一个字不动 ✓）。
 *
 * 分层（纪律：界面里不写解析逻辑 ✗）：
 *   · 归一 / 提示词 / 调用 / 逐字段校验 → composables/aiImport.ts（纯函数，探针覆盖 ✓）
 *   · 落草稿 → useQuestionBank 的 importBegin / importAddDrafts（和「录入试题」同一条链路 ✓；
 *     落点是**草稿**，复核入库在「草稿箱」里做 ✓）
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { extractQuestions, firstBlockerOf, softenIssues, validateQuestion } from '@/composables/aiImport'
import type { AiQuestion, FieldIssue } from '@/composables/aiImport'
import { LEVELS, QTYPE_LABEL, SECTIONS, idemKeyOf, importAddDrafts, importBegin } from '@/composables/useQuestionBank'
import { invoke } from '@/composables/useTauri'
import { typesetMixed } from '@/composables/useMathJax'
import { escapeHtml } from '@/types'
import { licensed } from '@/composables/useLicense'

/** ⚠ 这里只**存草稿**，正式库一个字不动 —— 所以不喊「已入库」（那是草稿箱确认入库时才说的话 ✓）
 *  · openDrafts：存好后一键跳到「草稿箱」复核 ✓ */
const emit = defineEmits<{ (e: 'close'): void; (e: 'openDrafts'): void }>()

/** 一次最多送多少字给模型（一整份卷子约 1~2 万字；留余量，别把正文整本烧进去 ✓） */
const MAX_TEXT = 40000
/** 公式预览一次最多排几张卡（MathJax 一块一块排、慢 ✓；要看的卡先勾上「预览」自己排 ✓） */
const PREVIEW_MAX = 12

const text = ref('')
/** 连答案与解析一起抽（关掉 = 只要题干选项，答案留人工补 ✓） */
const withAnswer = ref(true)
const busy = ref(false)
const prog = ref('')
const msg = ref('')
/** 抽出来的题卡（就地编辑就是改这个数组里的字段 ✓） */
const items = ref<AiQuestion[]>([])
/** 每张卡勾没勾（不勾就不进草稿 ✓） */
const on = ref<boolean[]>([])
/** 知识点输入框的原文（逗号分隔；改一个字符就重排数组会跳光标 ✗，所以分开存 ✓） */
const kpDraft = ref<string[]>([])
const warnList = ref<string[]>([])
const skipped = ref(0)
const report = ref('')
/** 这次抽的题有没有存过草稿（关窗口前提醒用 ✓） */
const saved = ref(false)
/** 最近一次存进草稿箱的条数（0 = 还没存过 → 不显示「去草稿箱」✓） */
const savedCount = ref(0)
const previewOn = ref(false)
const dragOver = ref(false)
const fileName = ref('')
/** 试卷名 / 来源：一次填好，整批草稿都带上（不填也能存，只是入库后按来源不好找 ✓） */
const paperName = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const listBox = ref<HTMLElement | null>(null)

/* ---------------- 模型调用：跟 AI 助手同一条链路（Rust 侧发请求；网页端直连被 CORS 挡 ✓） ---------------- */

/** AI Key：名字不写死 —— 设置里存的是哪个键就用哪个（和 AI 助手保持一致，免得两边漂移 ✗） */
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

/** 抽题用的模型调用器（交给 extractQuestions 的 caller ✓；探针里换成假的就能测那一层 ✓） */
async function callModel(system: string, userText: string): Promise<string> {
  const r = await invoke<{ ok?: boolean; text?: string; content?: string; error?: string }>('ai_chat', {
    baseUrl: '', apiKey: aiKey(), model: 'deepseek-chat', system, userText,
  })
  if (r && r.ok === false) throw new Error(String(r.error || '调用失败'))
  return String((r && (r.text || r.content)) || '')
}

/* ---------------- ① 来源：贴原文 / 拖文件 ---------------- */

/** 拖进来 / 选进来的文件 → 纯文本（.txt .md .json 直接读；.pdf .pptx 复用应用自己的解析器 ✓） */
async function fileToText(f: File): Promise<string> {
  if (/\.pdf$/i.test(f.name)) {
    const { pdfToMarkdown } = await import('@/pdf/pdfImport')
    const r = await pdfToMarkdown(new Uint8Array(await f.arrayBuffer()), {})
    return String((r as { markdown?: string })?.markdown || '')
  }
  if (/\.pptx$/i.test(f.name)) {
    const { pptxToDeck } = await import('@/pptx/pptxToDeck')
    const { deckToPlainText } = await import('@/composables/deckToText')
    const { deck } = await pptxToDeck(new Uint8Array(await f.arrayBuffer()))
    return deckToPlainText(deck)
  }
  if (/\.docx?$/i.test(f.name)) {
    throw new Error('Word 文件先在 Word 里全选复制，再贴到左边的框里（.docx 的排版与公式解析不了）')
  }
  return f.text()
}

async function takeFiles(files: File[]) {
  msg.value = ''
  for (const f of files) {
    try {
      const t = String(await fileToText(f)).trim()
      if (!t) { msg.value = f.name + ' 里没读到文字（可能是扫描件 / 纯图片）'; continue }
      fileName.value = f.name
      text.value = t
      msg.value = '已读入 ' + f.name + '（' + t.length + ' 字）—— 点「AI 抽题」开始'
      return
    } catch (e) {
      msg.value = '读 ' + f.name + ' 失败：' + String((e as Error)?.message || e)
    }
  }
}

async function onPickFile(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  await takeFiles(files)
}

function onDrop(e: DragEvent) {
  dragOver.value = false
  const files = Array.from((e.dataTransfer && e.dataTransfer.files) || [])
  if (!files.length) {
    const t = String((e.dataTransfer && e.dataTransfer.getData('text')) || '').trim()
    if (t) { text.value = t; msg.value = '已接收拖过来的文字（' + t.length + ' 字）' }
    return
  }
  void takeFiles(files)
}

/* ---------------- ② 抽题（提示词 / 归一 / 调用都在 aiImport.ts ✓） ---------------- */

async function doExtract() {
  msg.value = ''
  report.value = ''
  const raw = text.value.trim()
  if (!raw) { msg.value = '先把试卷原文贴进来（或把文件拖进来）'; return }
  if (!licensed('ai-assistant')) { msg.value = 'AI 抽题要先激活：工具栏「激活 / 序列号」，把本机机器码发我换一个号'; return }
  if (!aiKey()) { msg.value = '还没填 AI Key：设置 → AI 助手 里填一个（只存本机，不进仓库 ✓）'; return }
  busy.value = true
  prog.value = '正在让模型抽题…（一整份卷子约 10~30 秒，别关窗口）'
  try {
    const r = await extractQuestions(callModel, raw.slice(0, MAX_TEXT), {
      sections: SECTIONS.slice(),
      withAnswer: withAnswer.value,
    })
    items.value = r.items
    on.value = r.items.map(() => true)
    kpDraft.value = r.items.map((q) => (q.kp || []).join('，'))
    warnList.value = r.warn
    skipped.value = r.skipped
    saved.value = false
    report.value = r.items.length
      ? [
        '抽出 ' + r.items.length + ' 道' + (r.skipped ? '（另有 ' + r.skipped + ' 条没题干，已丢掉）' : ''),
        '逐张卡看一眼：红字是必须补的（题干 / 选项 / 答案），黄字是建议补的（章节 / 知识点 / 难度 / 解析）',
        '改完点右下「存 N 道草稿」→ 到「草稿箱」逐条复核 → 确认入库 ✓（正式库在这之前一个字不动）',
      ].join('\n')
      : ''
    if (!r.items.length) msg.value = r.warn[0] || '模型没抽出题目：原文贴全一点（题干 + 选项 + 答案）再试'
    else if (r.items.length > 40) msg.value = '抽了 ' + r.items.length + ' 道，建议分批发（一次 10~20 道改起来清楚）'
  } finally {
    busy.value = false
    prog.value = ''
  }
  void renderPreview()
}

function clearAll() {
  items.value = []
  on.value = []
  kpDraft.value = []
  warnList.value = []
  report.value = ''
  skipped.value = 0
  saved.value = false
  savedCount.value = 0
  msg.value = ''
}

/* ---------------- ③ 就地编辑：改的就是 items 里的字段 ✓ ---------------- */

/** 勾上的卡（按题卡顺序 ✓） */
function pickedIndexes(): number[] {
  const out: number[] = []
  items.value.forEach((_, i) => { if (on.value[i]) out.push(i) })
  return out
}
const picked = computed(() => pickedIndexes())
const allOn = computed(() => items.value.length > 0 && picked.value.length === items.value.length)

function toggleAll() {
  const v = !allOn.value
  on.value = items.value.map(() => v)
}

function removeItem(i: number) {
  items.value.splice(i, 1)
  on.value.splice(i, 1)
  kpDraft.value.splice(i, 1)
  schedulePreview()
}

function addItem() {
  items.value.push({ stem: '', options: [], answer: '', analysis: '', qtype: 'answer', section: '', kp: [], level: '中档', difficulty: 3 })
  on.value.push(true)
  kpDraft.value.push('')
  void nextTick(() => {
    const box = listBox.value
    const last = box && box.querySelector('.aiq__card:last-child')
    if (last && last.scrollIntoView) last.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })
}

function addOption(i: number) {
  const q = items.value[i]
  if (!q) return
  if (!Array.isArray(q.options)) q.options = []
  q.options.push('')
  if (q.qtype !== 'choice' && q.qtype !== 'multi') q.qtype = 'choice'
  schedulePreview()
}

function delOption(i: number, j: number) {
  const q = items.value[i]
  if (!q || !Array.isArray(q.options)) return
  q.options.splice(j, 1)
  schedulePreview()
}

/** 知识点输入（从事件里取 value —— 模板里不做类型断言，省得构建器版本一变就报错 ✓） */
function onKpInput(i: number, e: Event) {
  kpInput(i, String((e.target as HTMLInputElement).value || ''))
}

/** 知识点：输入框是「逗号分隔的一行」，落到 q.kp 是数组 ✓ */
function kpInput(i: number, v: string) {
  kpDraft.value[i] = v
  const q = items.value[i]
  if (q) q.kp = v.split(/[,，、;；]+/).map((x) => x.trim()).filter(Boolean)
}

/** 批量：给勾上的卡套同一个章节 / 层次（老师一次改一片，比逐张点快 ✓） */
const batchSection = ref('')
const batchLevel = ref('')
function applyBatchSection() {
  if (!batchSection.value) return
  for (const i of pickedIndexes()) { const q = items.value[i]; if (q) q.section = batchSection.value }
  schedulePreview()
}
function applyBatchLevel() {
  if (!batchLevel.value) return
  for (const i of pickedIndexes()) { const q = items.value[i]; if (q) q.level = batchLevel.value }
}

/* ---------------- 逐字段校验：卡片旁边提示 + 提交前定位 ---------------- */

/** 这道题现在还差什么（口径在 aiImport.softenIssues：不抽答案时「缺答案」只算提醒 ✓） */
function issuesOf(i: number): FieldIssue[] {
  const q = items.value[i]
  return q ? softenIssues(validateQuestion(q), withAnswer.value) : []
}
const errOf = (i: number) => issuesOf(i).filter((x) => x.level === 'error')
const warnOf = (i: number) => issuesOf(i).filter((x) => x.level === 'warn')

/** 提交前定位第一处拦路问题（勾选子集 → firstBlockerOf，探针覆盖 ✓）
 *  ⚠ 返回的 index 要换算回**题卡序号**（勾选子集里的第 n 个 ≠ 第 n 张卡 ✓） */
function firstBlocker(): { index: number; issue: FieldIssue } | null {
  const list = pickedIndexes()
  const hit = firstBlockerOf(list.map((i) => items.value[i]), withAnswer.value)
  return hit ? { index: list[hit.index], issue: hit.issue } : null
}

/** 底部那行小字：勾上的题里有多少处缺口（老师扫一眼就知道还得补多少 ✓） */
const gaps = computed(() => {
  let noAnswer = 0, noSection = 0, noKp = 0, bad = 0
  for (const i of pickedIndexes()) {
    const q = items.value[i]
    if (!q) continue
    if (!String(q.answer || '').trim()) noAnswer++
    if (!String(q.section || '').trim()) noSection++
    if (!(q.kp || []).length) noKp++
    if (errOf(i).length) bad++
  }
  return { noAnswer, noSection, noKp, bad }
})

/* ---------------- 公式预览（就地编辑时看得见渲染结果 ✓） ---------------- */

let pvTimer: number | undefined
/** 打字时不要每敲一下就排一次 MathJax（卡 ✓）—— 停 400ms 再排 ✓ */
function schedulePreview() {
  if (!previewOn.value) return
  if (pvTimer) window.clearTimeout(pvTimer)
  pvTimer = window.setTimeout(() => { void renderPreview() }, 400)
}

/**
 * 把开着的预览块排一遍
 * ⚠ 预览块是**空 div**、内容由本函数写（typesetMixed 会写 innerHTML）——模板里绝不给它绑内容 ✓，
 *   否则 MathJax 改写完 DOM 再被 Vue patch 回去，内容会来回跳（v1252 踩过 ✓）。
 */
async function renderPreview() {
  if (!previewOn.value) return
  await nextTick()
  const hosts = Array.from(document.querySelectorAll<HTMLElement>('.aiq__pv'))
  for (const h of hosts) {
    const i = Number(h.dataset.ai)
    const q = items.value[i]
    if (!q) { h.innerHTML = ''; continue }
    const html = ['<div class="aiq__pvs">' + escapeHtml(q.stem || '（还没写题干）') + '</div>']
      .concat((q.options || []).map((o, j) => '<div class="aiq__pvo">' + 'ABCDEFGH'[j] + '．' + escapeHtml(o) + '</div>'))
      .concat(q.answer ? ['<div class="aiq__pva">答案：' + escapeHtml(q.answer) + '</div>'] : [])
      .join('')
    try {
      await typesetMixed(h, html)
    } catch {
      // 引擎没起来也别给空白：纯文本先顶上（公式原样可见 ✓）
      h.textContent = [q.stem, ...(q.options || [])].join('　')
    }
  }
}

function togglePreview() {
  previewOn.value = !previewOn.value
  if (previewOn.value) void renderPreview()
}

/* ---------------- ④ 落草稿（正式库一个字不动 ✓） ---------------- */

async function doSaveDrafts() {
  msg.value = ''
  const list = pickedIndexes()
  if (!list.length) { msg.value = '先勾选要存的题（左边小方框）'; return }
  const bad = firstBlocker()
  if (bad) {
    msg.value = '第 ' + (bad.index + 1) + ' 题还要补：' + bad.issue.msg
    const el = listBox.value && listBox.value.querySelector('.aiq__card[data-i="' + bad.index + '"]')
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    return
  }
  busy.value = true
  try {
    const paper = paperName.value.trim()
    const key = idemKeyOf('ai_extract', text.value.trim().slice(0, 4000) + '|' + list.length)
    const b = await importBegin({
      sourceType: 'ai_extract',
      sourceLabel: (paper ? paper + '（' : '') + 'AI 抽题 ' + list.length + ' 道' + (paper ? '）' : ''),
      idemKey: key,
    })
    if (!b.ok || !b.batch) { msg.value = b.error || '开批次失败'; return }
    const drafts = list.map((i, n) => {
      const q = items.value[i]
      return {
        sourceItemId: 'ai' + (n + 1),
        sourceLabel: '第 ' + (i + 1) + ' 题（AI 抽取）',
        stem: String(q.stem || '').trim(),
        options: (q.options || []).map((x) => String(x)),
        answer: String(q.answer || ''),
        solution: String(q.analysis || ''),
        qtype: q.qtype,
        section: q.section,
        difficulty: Number(q.difficulty) || 3,
        knowledge: (q.kp || []).map((x) => String(x)),
        paper,
        // ⚠ 这里**不能**把整份原文当 rawText 传：Rust 的质量闸门会拿它算「内容守恒」
        //   （保留原文 35%~160%），整卷 1 万字里挑出一道 200 字的题 → 每题都被误判「内容偏少」✗
        //   「录入试题」那条路（draftFromMeta）同样不传 rawText ✓
      }
    })
    const r = await importAddDrafts(b.batch.id, drafts, drafts.length)
    if (!r.ok) { msg.value = r.error || '存草稿失败'; return }
    saved.value = true
    report.value = [
      (b.reused ? '命中已有批次（幂等，没重复建）' : '新批次') + '：' + b.batch.id,
      '存草稿 ' + r.added + ' 条，其中 ' + r.needReview + ' 条被质量闸门拦下（待复核）',
      '接下来：试题库 →「草稿箱」逐条看告警、改好、确认入库 ✓（正式库在这之前一个字不动）',
    ].join('\n')
    savedCount.value = r.added
    msg.value = '已存 ' + r.added + ' 条草稿' + (r.needReview ? '（' + r.needReview + ' 条待复核）' : '') + ' —— 去草稿箱确认'
  } finally {
    busy.value = false
  }
}

/* ---------------- 关窗口：这批没存过就先问一句（题卡是手工改过的，别一键丢 ✗） ---------------- */

function closeMe() {
  if (items.value.length && !saved.value) {
    const ok = window.confirm('这 ' + items.value.length + ' 道题卡还没存草稿，关掉就没了。确定关掉吗？')
    if (!ok) return
  }
  emit('close')
}

/** Esc 关本对话框：capture 阶段抢在题库面板那层之前处理，并掐断冒泡
 *  （否则面板也会收到 Esc —— 它只是「子浮层开着就不关面板」，先后顺序很容易踩空 ✓） */
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  e.stopPropagation()
  closeMe()
}
onMounted(() => document.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey, true)
  if (pvTimer) window.clearTimeout(pvTimer)
})
</script>

<template>
  <div class="aiq">
    <div class="aiq__box">
      <header class="aiq__head">
        <span class="aiq__title">AI 导入试题</span>
        <span class="aiq__sub">贴原文 / 拖文件 → AI 抽成题卡 → 就地改 → 存草稿（复核后才入库）</span>
        <span v-if="msg" class="aiq__msg">{{ msg }}</span>
        <button class="aiq__close" title="关闭" @click="closeMe"><AppIcon name="close" :size="13" /></button>
      </header>

      <div class="aiq__body">
        <!-- ① 来源 -->
        <section class="aiq__src">
          <div
            class="aiq__drop" :class="{ 'aiq__drop--over': dragOver }"
            @dragover.prevent="dragOver = true" @dragleave="dragOver = false" @drop.prevent="onDrop"
          >
            <b>把文件拖到这里</b>
            <span>.txt / .md / .json / .pdf / .pptx 都行（Word 请先在 Word 里复制正文）</span>
            <button class="aiq__btn" @click="fileInput && fileInput.click()">选文件…</button>
            <span v-if="fileName" class="aiq__fname">{{ fileName }}</span>
          </div>

          <textarea
            v-model="text" class="aiq__ta" rows="14" spellcheck="false"
            placeholder="或直接把试卷正文贴进来：题干、选项、答案、解析，有多少贴多少（公式用 $...$）"
          ></textarea>

          <div class="aiq__row">
            <label class="aiq__chk" title="关掉就只抽题干与选项，答案留着自己补（不会拦着存草稿）">
              <input v-model="withAnswer" type="checkbox" />连答案与解析一起抽
            </label>
            <span class="aiq__chars">{{ text.length }} 字</span>
          </div>

          <label class="aiq__lab aiq__lab--wide">试卷名 / 来源
            <input v-model="paperName" class="aiq__inp" placeholder="如：2023 乙卷理数（整批草稿都带上，不填也行）" />
          </label>

          <div class="aiq__row">
            <button class="aiq__btn aiq__btn--main" :disabled="busy || !text.trim()" @click="doExtract">AI 抽题</button>
            <button class="aiq__btn" :disabled="busy" @click="text = ''; fileName = ''; msg = ''">清空原文</button>
          </div>
          <div v-if="prog" class="aiq__prog">{{ prog }}</div>

          <div v-if="warnList.length" class="aiq__warns">
            <div class="aiq__t1">抽题时的提醒（{{ warnList.length }}）</div>
            <div v-for="(w, i) in warnList" :key="i" class="aiq__warn">{{ w }}</div>
          </div>
          <div v-if="skipped" class="aiq__warn">有条目没题干，已丢掉 {{ skipped }} 条（空题绝不进草稿 ✓）</div>

          <div class="aiq__hint">
            抽出来只是<b>草稿</b>：正式库一个字不动，到「草稿箱」复核后才入库。<br />
            模型只读文字：扫描件 / 截图里的题，先用「AI 助手」带图提问，或把文字打出来。<br />
            抽题用的 key 与「AI 助手」是同一个（设置 → AI 助手）。
          </div>
        </section>

        <!-- ② 题卡：就地编辑 -->
        <section class="aiq__list-wrap">
          <div class="aiq__bar">
            <label class="aiq__chk"><input type="checkbox" :checked="allOn" @change="toggleAll" />全选</label>
            <span class="aiq__count">已勾 {{ picked.length }} / {{ items.length }} 道</span>
            <select v-model="batchSection" class="aiq__mini" @change="applyBatchSection">
              <option value="">批量：章节…</option>
              <option v-for="s in SECTIONS" :key="s" :value="s">{{ s }}</option>
            </select>
            <select v-model="batchLevel" class="aiq__mini" @change="applyBatchLevel">
              <option value="">批量：层次…</option>
              <option v-for="l in LEVELS" :key="l" :value="l">{{ l }}</option>
            </select>
            <button class="aiq__btn" :disabled="!items.length" @click="togglePreview">{{ previewOn ? '关掉公式预览' : '公式预览' }}</button>
            <button class="aiq__btn" @click="addItem">手动加一题</button>
            <button class="aiq__btn" :disabled="!items.length" @click="clearAll">清空题卡</button>
          </div>

          <div ref="listBox" class="aiq__list">
            <div v-if="!items.length" class="aiq__empty">左边贴原文 → 点「AI 抽题」→ 题卡出现在这里（也可以「手动加一题」）</div>

            <div v-for="(q, i) in items" :key="i" class="aiq__card" :class="{ 'aiq__card--off': !on[i] }" :data-i="i">
              <div class="aiq__cardhead">
                <label class="aiq__chk" title="勾上才进草稿">
                  <input v-model="on[i]" type="checkbox" />第 {{ i + 1 }} 题
                </label>
                <select v-model="q.qtype" class="aiq__mini">
                  <option v-for="(t, k) in QTYPE_LABEL" :key="k" :value="k">{{ t }}</option>
                </select>
                <select v-model="q.section" class="aiq__mini">
                  <option value="">未归类</option>
                  <option v-for="s in SECTIONS" :key="s" :value="s">{{ s }}</option>
                </select>
                <select v-model="q.level" class="aiq__mini">
                  <option v-for="l in LEVELS" :key="l" :value="l">{{ l }}</option>
                </select>
                <label class="aiq__chk" title="难度 1~5">难度
                  <input v-model.number="q.difficulty" class="aiq__mini aiq__mini--n" type="number" min="1" max="5" />
                </label>
                <span v-if="errOf(i).length" class="aiq__bad">要补 {{ errOf(i).length }} 处</span>
                <span v-else-if="warnOf(i).length" class="aiq__ok">可用（{{ warnOf(i).length }} 处建议）</span>
                <span v-else class="aiq__ok">齐了</span>
                <button class="aiq__x" title="删掉这道（不进草稿）" @click="removeItem(i)">✕</button>
              </div>

              <textarea
                v-model="q.stem" class="aiq__stem" rows="3" spellcheck="false"
                placeholder="题干（公式用 $...$）" @input="schedulePreview"
              ></textarea>
              <div v-if="previewOn && i < PREVIEW_MAX" class="aiq__pv" :data-ai="i"></div>

              <div class="aiq__opts">
                <!-- 只用下标：v-model 必须落在数组元素上（v-for 的别名是副本，写不回去 ✗） -->
                <div v-for="j in q.options.length" :key="j" class="aiq__opt">
                  <span class="aiq__ol">{{ 'ABCDEFGH'[j - 1] || j }}</span>
                  <input v-model="q.options[j - 1]" class="aiq__inp" placeholder="选项内容" @input="schedulePreview" />
                  <button class="aiq__x" title="删这个选项" @click="delOption(i, j - 1)">✕</button>
                </div>
                <button class="aiq__btn aiq__btn--mini" @click="addOption(i)">＋ 选项</button>
              </div>

              <div class="aiq__fields">
                <label class="aiq__lab">答案
                  <input v-model="q.answer" class="aiq__inp" placeholder="答案（填空题写空里的值）" @input="schedulePreview" />
                </label>
                <label class="aiq__lab aiq__lab--wide">知识点
                  <input
                    :value="kpDraft[i]" class="aiq__inp" placeholder="逗号分隔，如：导数，单调性"
                    @input="onKpInput(i, $event)"
                  />
                </label>
              </div>
              <label class="aiq__lab aiq__col">解析
                <textarea v-model="q.analysis" class="aiq__ta aiq__ta--sm" rows="2" spellcheck="false" placeholder="解析（解答题建议写）"></textarea>
              </label>

              <div v-if="issuesOf(i).length" class="aiq__issues">
                <span v-for="(f, k) in issuesOf(i)" :key="k" class="aiq__issue" :class="f.level === 'error' ? 'aiq__issue--err' : 'aiq__issue--warn'">
                  {{ f.msg }}
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <footer class="aiq__foot">
        <span class="aiq__count">已勾 {{ picked.length }} / {{ items.length }} 道</span>
        <span v-if="picked.length" class="aiq__gaps">
          缺答案 {{ gaps.noAnswer }} · 未归类 {{ gaps.noSection }} · 缺知识点 {{ gaps.noKp }}
          <b v-if="gaps.bad">· {{ gaps.bad }} 道还不能交</b>
        </span>
        <button
          v-if="savedCount" class="aiq__btn aiq__btn--go"
          title="关掉本对话框，打开「草稿箱」逐条复核 → 确认入库" @click="emit('openDrafts')"
        >去草稿箱复核（{{ savedCount }} 条）</button>
        <button
          class="aiq__btn aiq__btn--main" :class="{ 'aiq__btn--go': !savedCount }" :disabled="busy || !picked.length"
          title="写进待复核草稿：正式库一个字不动，到草稿箱复核后才入库 ✓" @click="doSaveDrafts"
        >存 {{ picked.length }} 道草稿</button>
        <pre v-if="report" class="aiq__report">{{ report }}</pre>
      </footer>

      <input
        ref="fileInput" class="aiq__fileinput" type="file" accept=".txt,.md,.markdown,.json,.pdf,.pptx"
        @change="onPickFile"
      />
    </div>
  </div>
</template>

<style scoped>
/* ★ 同 QuestionImportDialog：本弹窗是题库浮窗 .qb 的子元素，而 .qb 是 pointer-events: none
   （为了不挡画布 ✓）——该属性会被子元素继承 ✗，所以这里必须写回 auto，
   否则整屏按钮/输入框**真鼠标点不动**（v1616 真机踩过 ✓）。本弹窗是模态，明确吃掉点击 ✓ */
.aiq { pointer-events: auto; position: fixed; inset: 0; z-index: 430; background: rgba(20, 24, 34, 0.55); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; }
.aiq__box { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: 96vw; max-width: 1420px; height: 90vh; display: flex; flex-direction: column; overflow: hidden; }
.aiq__head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.aiq__title { font-size: 15px; font-weight: 700; color: var(--text); }
.aiq__sub { font-size: 12px; color: var(--muted); }
.aiq__msg { font-size: 12px; color: var(--brand-600, #534AB7); }
.aiq__close { margin-left: auto; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; cursor: pointer; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--gray-600); }
.aiq__body { flex: 1; min-height: 0; display: grid; grid-template-columns: 420px 1fr; }
.aiq__src { border-right: 1px solid var(--border); padding: 10px 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.aiq__list-wrap { display: flex; flex-direction: column; min-height: 0; padding: 10px 12px; }
.aiq__drop { display: flex; flex-direction: column; gap: 4px; padding: 10px; border: 1px dashed var(--border-strong); border-radius: var(--radius); font-size: 12px; color: var(--muted); background: var(--gray-50); }
.aiq__drop--over { border-color: var(--brand-600, #534AB7); background: #f2f0ff; }
.aiq__drop b { font-size: 12.5px; color: var(--text); }
.aiq__fname { color: var(--brand-600, #534AB7); word-break: break-all; }
.aiq__ta { width: 100%; box-sizing: border-box; resize: vertical; font: inherit; font-size: 12.5px; line-height: 1.6; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; color: var(--text); background: #fff; }
.aiq__ta--sm { font-size: 12.5px; }
.aiq__row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.aiq__chk { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; color: var(--text); }
.aiq__chars { margin-left: auto; font-size: 11.5px; color: var(--muted); }
.aiq__btn { height: 28px; padding: 0 10px; border: 1px solid var(--border); border-radius: 6px; background: #fff; font-size: 12.5px; cursor: pointer; color: var(--text); }
.aiq__btn:disabled { opacity: .5; cursor: not-allowed; }
.aiq__btn--main { background: var(--brand-600, #534AB7); border-color: var(--brand-600, #534AB7); color: #fff; }
.aiq__btn--mini { height: 24px; padding: 0 8px; font-size: 12px; align-self: flex-start; }
.aiq__btn--go { margin-left: auto; }
.aiq__prog { font-size: 12px; color: var(--brand-600, #534AB7); }
.aiq__t1 { font-size: 11px; font-weight: 700; color: var(--muted); letter-spacing: .04em; margin: 4px 0 2px; }
.aiq__warns { display: flex; flex-direction: column; gap: 2px; }
.aiq__warn { font-size: 12px; color: #8a6a12; background: #fdf6e3; border: 1px solid #e0cf9a; border-radius: 6px; padding: 4px 6px; }
.aiq__hint { font-size: 11.5px; line-height: 1.7; color: var(--muted); border-top: 1px dashed var(--border); padding-top: 6px; }
.aiq__bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
.aiq__count { font-size: 12px; color: var(--muted); }
.aiq__mini { height: 26px; padding: 0 6px; border: 1px solid var(--border); border-radius: 6px; background: #fff; font-size: 12px; color: var(--text); }
.aiq__mini--n { width: 52px; }
.aiq__list { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 2px 12px; display: flex; flex-direction: column; gap: 10px; }
.aiq__empty { font-size: 12.5px; color: var(--muted); padding: 24px 4px; }
.aiq__card { border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; background: #fff; }
.aiq__card--off { opacity: .55; }
.aiq__cardhead { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.aiq__bad { font-size: 11.5px; color: var(--danger); background: var(--danger-soft); border: 1px solid var(--danger-border); border-radius: 999px; padding: 1px 8px; }
.aiq__ok { font-size: 11.5px; color: var(--ok); background: var(--ok-soft); border: 1px solid #b6e0c6; border-radius: 999px; padding: 1px 8px; }
.aiq__x { margin-left: auto; border: none; background: transparent; color: var(--gray-600); cursor: pointer; font-size: 12px; }
.aiq__stem { width: 100%; box-sizing: border-box; resize: vertical; font: inherit; font-size: 13px; line-height: 1.7; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; color: var(--text); }
.aiq__pv { border: 1px dashed var(--border); border-radius: 6px; padding: 6px 8px; font-size: 13px; line-height: 1.8; background: var(--gray-50); }
.aiq__pvs { margin-bottom: 4px; }
.aiq__pvo { margin-left: 8px; }
.aiq__pva { margin-top: 4px; color: var(--ok); }
.aiq__opts { display: flex; flex-direction: column; gap: 4px; }
.aiq__opt { display: flex; align-items: center; gap: 6px; }
.aiq__ol { width: 16px; font-size: 12px; color: var(--muted); }
.aiq__opt .aiq__x { margin-left: 0; }
.aiq__fields { display: flex; gap: 8px; flex-wrap: wrap; }
.aiq__lab { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
.aiq__lab--wide { flex: 1; min-width: 260px; }
.aiq__lab--wide .aiq__inp { flex: 1; }
.aiq__col { flex-direction: column; align-items: stretch; gap: 4px; }
.aiq__inp { height: 26px; box-sizing: border-box; padding: 0 8px; border: 1px solid var(--border); border-radius: 6px; font: inherit; font-size: 12.5px; color: var(--text); background: #fff; }
.aiq__opt .aiq__inp { flex: 1; }
.aiq__issues { display: flex; gap: 6px; flex-wrap: wrap; }
.aiq__issue { font-size: 11.5px; border-radius: 6px; padding: 2px 6px; }
.aiq__issue--err { color: var(--danger); background: var(--danger-soft); border: 1px solid var(--danger-border); }
.aiq__issue--warn { color: #8a6a12; background: #fdf6e3; border: 1px solid #e0cf9a; }
.aiq__foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 16px; border-top: 1px solid var(--border); }
.aiq__gaps { font-size: 12px; color: var(--muted); }
.aiq__gaps b { color: var(--danger); }
.aiq__report { margin: 0; width: 100%; white-space: pre-wrap; font-size: 11.5px; line-height: 1.6; color: var(--gray-600); background: var(--gray-50); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; }
.aiq__fileinput { display: none; }
</style>
