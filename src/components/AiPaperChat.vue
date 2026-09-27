<script setup lang="ts">
/**
 * 【v1692】试卷编辑里的 **AI 聊天侧栏**（用户口径：介于输入框与预览之间、像侧边栏、支持导入图片、聊天改试卷 ✓）
 *
 * 与「AI 组卷 / 命题…」那个对话框分工：
 *   · 对话框：**一次成型**（按条件从题库组卷 / 让模型命一套题 ✓）
 *   · 这个侧栏：**边聊边改**（加一节、插一道、改题号、把照片里的题录进来 ✓），带工具循环，直接改左边源码 ✓
 *
 * 附件三种（【v1698】用户要求补齐 ✓）：
 *   · 「＋ 图」选图 / Ctrl+V 粘 / 拖进来 ✓（走视觉模型 ✓）
 *   · 「＋ 文档」.pdf / .pptx / .txt / .md —— 本地抽文本当**参考材料** ✓（不是卷面 ✗）
 *   · 「截图」复用应用那个截图弹窗（能选窗口 / 拖选区 ✓），attach 模式把图直接交回来当附件 ✓
 *
 * 工具见 aiPaperChat.paperToolsOf（12 个试卷专用 ✓）—— 幻灯片那套给了它只会乱调 ✗。
 * 带图时走视觉模型（设置里的「视觉模型」✓），没配就明说"可能读不了图" ✓（不糊弄 ✓）。
 */
import { nextTick, ref } from 'vue'
import { invoke } from '@/composables/useTauri'
import { licensed } from '@/composables/useLicense'
import { AI_TOOLS, aiToolGuide, runAiTool } from '@/composables/aiTools'
import type { AiToolCtx } from '@/composables/aiTools'
import { pickImages, qSearch, questionBlockOf, questionTextOf } from '@/composables/useQuestionBank'
import type { QItem } from '@/composables/useQuestionBank'
import { paperOpsSink, sendToPaper } from '@/ui/paper'
import {
  PAPER_OCR_PROMPT, buildPaperChatSystem, canAttachPaperChat, canSendPaperChat, chatUserContent, docCharsOf, paperToolsOf,
} from '@/composables/aiPaperChat'
import { typesetMixed } from '@/composables/useMathJax'
import { escapeHtml } from '@/types'
import ScreenshotCapture from './ScreenshotCapture.vue'
import FigureCropDialog from './FigureCropDialog.vue'
import { cropNoteText, cropPicsToPreviews, previewToPics, type CropPreview } from '@/composables/figCrop'

const props = defineProps<{
  /** 读试卷正文（PaperModal 传进来 ✓） */
  readText: () => string
  /** 追加到试卷末尾（PaperModal 传进来 ✓ —— 顺带 render + 存草稿 ✓） */
  append: (text: string, pageBreak: boolean) => void
  /** 把一张图插进试卷的图片库，返回 [图N] 标记 ✓ */
  insertImage: (dataUrl: string, name?: string) => Promise<string>
}>()

/** docs 只存文件名（气泡上显示 ✓）；正文在发送时一起拼进消息 ✓ */
interface Msg { role: 'user' | 'ai'; text: string; imgs?: string[]; docs?: string[]; did?: string[] }
const msgs = ref<Msg[]>([])
const draft = ref('')
const atts = ref<{ name: string; src: string }[]>([])
/** 【v1698】文档附件：抽好的纯文本（当参考材料发给模型 ✓） */
const docs = ref<{ name: string; chars: number; text: string }[]>([])
const busy = ref(false)
const note = ref('')
const listEl = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const docInput = ref<HTMLInputElement | null>(null)
/** 【v1698】截图弹窗（复用应用那个：选窗口 / 拖选区 / Esc 取消都现成 ✓） */
const shotOpen = ref(false)
/** 一次提问里最多让它改几步（防打转 ✓） */
const MAX_TURNS = 12   // 【v1699】用户要「少啰嗦、多办事」→ 6 提到 12 ✓

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
function visionModel(): string { try { return String(localStorage.getItem('lj-mathslides:vision-model') || '').trim() } catch { return '' } }
function visionBase(): string { try { return String(localStorage.getItem('lj-mathslides:vision-base') || '').trim() } catch { return '' } }

/** 工具做了什么（一句人话 ✓ —— 别把 JSON 倒给老师 ✗） */
function toolLine(name: string, args: Record<string, unknown>, res: { ok: boolean; error?: string }): string {
  const n = (v: unknown) => (typeof v === 'number' ? v : 0)
  const map: Record<string, string> = {
    get_paper_state: '读了一遍试卷',
    get_paper_help: '查了语法手册',
    get_paper_style: '读了当前设置',
    set_paper_style: '改了排版设置',
    set_paper_header: '改了页眉页脚',
    append_to_paper: '追加了 ' + String(args.text || '').length + ' 字' + (args.page_break ? '（先分页 ✓）' : ''),
    edit_paper_text: '就地改了正文',
    insert_bank_question_to_paper: '插入题库试题 #' + n(args.id) + (args.with_answer ? '（带答案）' : ''),
    search_bank: '在题库里搜「' + String(args.query || '') + '」',
    insert_paper_figure: '插了一张数学图形（' + String(args.kind || '') + '）',
    apply_paper_template: '套了模板 ' + String(args.key || ''),
    print_paper: '打开了打印 / 另存 PDF',
  }
  return (res.ok ? '已' : '没能') + (map[name] || name) + (res.ok ? '' : '（' + String(res.error || '') + '）')
}

/** 给工具用的「应用能力」：试卷全套 + 题库检索（幻灯片那几个填桩，反正也没给它 ✗） */
function ctxOf(): AiToolCtx {
  const found = new Map<number, QItem>()
  return {
    deck: { slides: [] },
    currentIndex: 0,
    addElements: () => null,
    addSlide: () => {},
    gotoSlide: () => {},
    updateElement: () => {},
    removeElement: () => {},
    undo: () => {},
    bank: {
      search: async (query, limit) => {
        const r = await qSearch({ q: query, limit })
        const items = (r && r.items) || []
        for (const it of items) found.set(Number(it.id), it)
        return items.map((it) => ({ id: Number(it.id), label: (it.code ? it.code + ' ' : '') + String(it.title || it.body || '').slice(0, 60) }))
      },
      textOf: async (id, withAnswer) => {
        const it = found.get(id)
        return it ? questionTextOf(it, withAnswer) : null
      },
      imgsOf: async (id) => {
        const it = found.get(id)
        if (!it) return []
        return (await pickImages(it)).map((im) => ({ n: im.n, src: im.src, caption: im.caption }))
      },
    },
    paper: {
      state: (maxChars) => {
        const t = String(props.readText() || '')
        return { open: true, text: t.length > maxChars ? t.slice(0, maxChars) + String.fromCharCode(10) + '…（已截断）' : t }
      },
      append: (t, pageBreak) => {
        props.append(t, pageBreak)
        return '已追加到试卷末尾 ✓'
      },
      insertQuestion: async (id, withAnswer) => {
        const it = found.get(id)
        if (!it) return ''
        const block = questionBlockOf(it, withAnswer, 0)
        if (!block) return ''
        const imgs = (await pickImages(it)).map((im) => ({ n: im.n, src: im.src, caption: im.caption }))
        sendToPaper({ text: block, id: 0, label: 'AI 插入试题 #' + id, imgs })
        return '已插进试卷 ✓' + (imgs.length ? '（配图 ' + imgs.length + ' 张 ✓）' : '')
      },
      // 【v1693】其余能力（读设置 / 改设置 / 模板 / 页眉 / 数学图形 / 打印）直接转给 PaperModal 登记的对象 ✓
      style: () => (paperOpsSink.value ? paperOpsSink.value.style() : {}),
      setStyle: (patch) => (paperOpsSink.value ? paperOpsSink.value.setStyle(patch) : '试卷没开着 ✗'),
      template: (key) => (paperOpsSink.value ? paperOpsSink.value.template(key) : '试卷没开着 ✗'),
      headerPreset: (id) => (paperOpsSink.value ? paperOpsSink.value.headerPreset(id) : '试卷没开着 ✗'),
      figure: async (kind, params) => (paperOpsSink.value ? await paperOpsSink.value.figure(kind, params) : ''),
      print: () => (paperOpsSink.value ? paperOpsSink.value.print() : '试卷没开着 ✗'),
      edit: (find, replace, all) => (paperOpsSink.value ? paperOpsSink.value.edit(find, replace, all) : '试卷没开着 ✗'),
      outline: () => (paperOpsSink.value ? paperOpsSink.value.outline() : ''),
      replaceQuestion: (no, text) => (paperOpsSink.value ? paperOpsSink.value.replaceQuestion(no, text) : '试卷没开着 ✗'),
      insertQuestionAt: (afterNo, text) => (paperOpsSink.value ? paperOpsSink.value.insertQuestionAt(afterNo, text) : '试卷没开着 ✗'),
    },
  }
}

/** 带工具的对话循环（与 AI 助手同一套通道 ✓；这里只给试卷那 12 个工具 ✓） */
async function askWithTools(
  text: string,
  imgs: string[],
  docList: { name: string; chars: number; text: string }[],
  key: string,
  ai: Msg,
): Promise<string> {
  const system = buildPaperChatSystem() + String.fromCharCode(10, 10) + aiToolGuide()
  const messages: unknown[] = [
    { role: 'system', content: system },
    { role: 'user', content: chatUserContent(text, imgs, docList) },
  ]
  const tools = paperToolsOf(AI_TOOLS)
  const baseUrl = imgs.length ? visionBase() : ''
  const model = imgs.length && visionModel() ? visionModel() : 'deepseek-chat'
  const ctx = ctxOf()
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const r = await invoke<{ ok?: boolean; json?: unknown; error?: string }>('ai_chat_raw', {
      baseUrl, apiKey: key, body: { model, temperature: 0, messages, tools, tool_choice: 'auto' },
    })
    if (!r || r.ok === false) throw new Error(String((r && r.error) || '工具通道调用失败'))
    const j = (r.json || {}) as { choices?: { message?: { content?: string; tool_calls?: unknown[] } }[] }
    const m = (j.choices && j.choices[0] && j.choices[0].message) || {}
    const calls = (m.tool_calls || []) as { id?: string; function?: { name?: string; arguments?: string } }[]
    if (!calls.length) return String(m.content || '').trim()
    messages.push(m)
    for (const c of calls) {
      const name = String((c.function && c.function.name) || '')
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(String((c.function && c.function.arguments) || '{}')) as Record<string, unknown> } catch { args = {} }
      const res = await runAiTool(name, args, ctx)
      if (!ai.did) ai.did = []
      ai.did.push(toolLine(name, args, res))
      messages.push({ role: 'tool', tool_call_id: c.id || '', content: JSON.stringify(res.ok ? res.result : { error: res.error }) })
      await renderAll()
      scrollSoon()
    }
  }
  return '（一次改的步骤太多了，先停在这里；你再说一句我接着改 ✓）'
}

/** 把 AI 回复里的 $公式$ 排出来（写 innerHTML 的手法与其它浮层一致 ✓：宿主是空 div，模板不绑内容 ✓） */
async function renderAll() {
  await nextTick()
  const hosts = Array.from(document.querySelectorAll<HTMLElement>('.apc__body'))
  for (const h of hosts) {
    const i = Number(h.dataset.i)
    const m = msgs.value[i]
    if (!m) continue
    const want = escapeHtml(m.text || '')
    if (h.dataset.txt === want) continue          // 内容没变就别重排（MathJax 慢 ✓）
    h.dataset.txt = want
    try { await typesetMixed(h, want) } catch { h.textContent = m.text || '' }
  }
}
function scrollSoon() {
  void nextTick(() => { const el = listEl.value; if (el) el.scrollTop = el.scrollHeight })
}

/* ---------------- 附件①图 ---------------- */

async function addFiles(files: File[]) {
  for (const f of files) {
    const c = canAttachPaperChat(atts.value.length, f.size)
    if (!c.ok) { note.value = c.why; continue }
    try {
      const src = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(String(r.result))
        r.onerror = () => rej(new Error('读图失败'))
        r.readAsDataURL(f)
      })
      atts.value.push({ name: f.name || '截图', src })
      if (!visionModel()) note.value = '还没配「视觉模型」—— 带图提问可能读不出图（设置 → AI 助手 ✓）'
    } catch { note.value = '这张图读不出来' }
  }
}
async function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  await addFiles(files)
}
async function onPaste(e: ClipboardEvent) {
  const items = Array.from((e.clipboardData && e.clipboardData.items) || [])
  const files: File[] = []
  for (const it of items) {
    if (it.kind !== 'file') continue
    const f = it.getAsFile()
    if (f) files.push(f)
  }
  if (files.length) { e.preventDefault(); await addFiles(files) }
}
function onDrop(e: DragEvent) {
  const files = Array.from((e.dataTransfer && e.dataTransfer.files) || [])
  if (files.length) void addFiles(files)
}
async function insertAtt(i: number) {
  const a = atts.value[i]
  if (!a) return
  try {
    const tag = await props.insertImage(a.src, a.name)
    note.value = '已插进试卷 ' + (tag || '') + ' ✓'
  } catch (err) {
    note.value = '插进试卷失败：' + String((err as Error)?.message || err)
  }
}

/* ---------------- 附件②文档 ---------------- */

/** 【v1698】「＋ 文档」：本地抽文本（.pdf / .pptx 走应用自己的解析器 ✓，其余按纯文本读 ✓） */
async function addDocs(files: File[]) {
  for (const f of files) {
    try {
      let text = ''
      if (/\.pdf$/i.test(f.name)) {
        const { pdfToMarkdown } = await import('@/pdf/pdfImport')
        const r = await pdfToMarkdown(new Uint8Array(await f.arrayBuffer()), {})
        text = String((r as { markdown?: string })?.markdown || '')
      } else if (/\.pptx$/i.test(f.name)) {
        const { pptxToDeck } = await import('@/pptx/pptxToDeck')
        const { deckToPlainText } = await import('@/composables/deckToText')
        const { deck } = await pptxToDeck(new Uint8Array(await f.arrayBuffer()))
        text = deckToPlainText(deck)
      } else if (/\.docx?$/i.test(f.name)) {
        note.value = f.name + '：Word 请先在 Word 里全选复制、粘到下面的输入框里（.docx 的排版读不出 ✓）'
        continue
      } else {
        text = await f.text()
      }
      const chars = docCharsOf(text)
      if (chars < 10) {
        note.value = f.name + ' 里没读出文字（可能是扫描件 / 纯图片）—— 当图片发我看看 ✓'
        continue
      }
      docs.value.push({ name: f.name, chars, text })
      note.value = '已加文档 ' + f.name + '（' + chars + ' 个可读字符 ✓，发送时当参考材料）'
    } catch (e) {
      note.value = '读 ' + f.name + ' 失败：' + String((e as Error)?.message || e)
    }
  }
}
async function onPickDoc(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  await addDocs(files)
}

/* ---------------- 附件③截图 ---------------- */

/** 【v1698】截图弹窗（attach 模式）交回来的图，直接当附件 ✓ */
function onShot(dataUrl: string) {
  shotOpen.value = false
  if (!dataUrl) return
  atts.value.push({ name: '截图', src: dataUrl })
  note.value = visionModel()
    ? '截图已当附件 ✓ 直接说要对它做什么就行'
    : '截图已当附件，但还没配「视觉模型」—— 可能读不出图（设置 → AI 助手 ✓）'
}

/* ---------------- 【v1703】切图 → 试卷（从右侧「AI 助手」侧栏移植过来 ✓） ---------------- */

/** 「只切图形」开关 —— 与侧栏**共用同一个 localStorage 键**：在哪边关的，两边都关 ✓ */
const ONLY_KEY = 'lj-mathslides:fig-only'
const onlyFigure = ref(true)
try { const v = localStorage.getItem(ONLY_KEY); if (v === '0') onlyFigure.value = false } catch { /* 忽略 */ }
function toggleOnly() {
  onlyFigure.value = !onlyFigure.value
  try { localStorage.setItem(ONLY_KEY, onlyFigure.value ? '1' : '0') } catch { /* 忽略 */ }
}

/** 插入前先看一眼（与侧栏共用"以后不再问"这个设置 ✓）；返回 null = 老师点了取消 → 什么都不插 ✓ */
const PREVIEW_KEY = 'lj-mathslides:fig-preview'
const previewOpen = ref(false)
const previewItems = ref<CropPreview[]>([])
let previewDone: ((v: CropPreview[] | null) => void) | null = null
function previewWanted(): boolean {
  try { return localStorage.getItem(PREVIEW_KEY) !== '0' } catch { return true }
}
function askPreview(items: CropPreview[]): Promise<CropPreview[] | null> {
  if (!items.length || !previewWanted()) return Promise.resolve(items)
  previewItems.value = items.map((it) => ({ ...it, useRaw: false }))
  previewOpen.value = true
  return new Promise((res) => { previewDone = res })
}
function onPreviewDone(sel: CropPreview[] | null, noMore: boolean) {
  previewOpen.value = false
  if (noMore) { try { localStorage.setItem(PREVIEW_KEY, '0') } catch { /* 忽略 */ } }
  const fn = previewDone
  previewDone = null
  if (fn) fn(sel)
}

/**
 * 【v1703】「切图 → 试卷」：**不调 AI**，把附件图切出图形部分、插进试卷（用户要求：从侧栏移植 ✓）
 *   与侧栏「切图 → 幻灯片」同一套口径：切 → 预览确认（哪张不满意就单张改成"用整张原图"）→ 插；取消就什么都不插 ✓
 *   附件**继续留着**：原图还有用 —— 接着可以直接说「把图里的题目也录进试卷」✓
 */
async function cutToPaper() {
  const pics = atts.value.map((a) => a.src)
  if (!pics.length) { note.value = '先在下面点「＋ 图」选一张（或「截图」/ Ctrl+V 粘一张），再点这个'; return }
  busy.value = true
  try {
    const cut = await cropPicsToPreviews(pics, onlyFigure.value)
    const chosen = await askPreview(cut.items)
    if (!chosen) { note.value = '已取消，什么都没插'; return }
    const out = previewToPics(chosen)
    if (!out.length) { note.value = '这些图读不出尺寸，没插（换一张再试 ✓）'; return }
    const tags: string[] = []
    for (const p of out) {
      const tag = await props.insertImage(p.src, '切图.png')
      if (tag) tags.push(tag)
    }
    note.value = '已把 ' + tags.length + ' 张图插进试卷' +
      (tags.length ? '（' + tags.join('、') + '，排在正文末尾，想挪位置就把这个 [图N] 标记剪到别处 ✓）' : '') + cropNoteText(cut) +
      '；附件还留着，可以接着说「把图里的题目也录进来」'
  } catch (e) {
    note.value = '切图插入失败：' + String((e as Error)?.message || e)
  } finally { busy.value = false }
}

/* ---------------- 发送 ---------------- */

async function send() {
  const c = canSendPaperChat(draft.value, busy.value, atts.value.length + docs.value.length)
  if (!c.ok) { note.value = c.why; return }
  const text = draft.value.trim()
  draft.value = ''
  await sendAs(text)
}

/** 【v1704】真正发出去的那一步（从 send 里拆出来 —— 「录入试题」走**同一条路** ✓）
 *  · bubble：气泡上显示的人话（留空 = 就把发出的原文显示出来 ✓） */
async function sendAs(sendText: string, bubble = '') {
  if (busy.value) return
  if (!licensed('ai-assistant')) { note.value = 'AI 助手要先激活：工具栏「激活 / 序列号」'; return }
  const key = aiKey()
  if (!key) { note.value = '还没填 AI Key：设置 → AI 助手 里填一个（只存本机 ✓）'; return }
  const text = String(sendText || '').trim()
  const imgs = atts.value.map((a) => a.src)
  const docList = docs.value.slice()
  msgs.value.push({ role: 'user', text: bubble || text, imgs: imgs.slice(), docs: docList.map((d) => d.name) })
  atts.value = []
  docs.value = []
  note.value = ''
  busy.value = true
  const ai: Msg = { role: 'ai', text: '（正在看试卷…）', did: [] }
  msgs.value.push(ai)
  await renderAll()
  scrollSoon()
  try {
    const out = await askWithTools(text, imgs, docList, key, ai)
    ai.text = out || '（模型没有返回内容）'
  } catch (e) {
    ai.text = '出错了：' + String((e as Error)?.message || e)
  } finally {
    busy.value = false
    await renderAll()
    scrollSoon()
  }
}
/* ---------------- 【v1704】录入试题：把当前图里的题目录进试卷 ---------------- */

/**
 * 点一下就把**当前附件图**里的题目录进试卷（题干 / 选项 / 答案 / 解析 ✓）
 *  与侧栏那几个预制对话同一套思路：不额外发明通道，直接走 sendAs（发送那条路 ✓）
 *  ⚠ 必须配了「视觉模型」才让它看图 —— 否则纯文本模型会**照着图名瞎编** ✗（宁可拦住 ✓）
 */
async function ocrToPaper() {
  const pics = atts.value.map((a) => a.src)
  if (!pics.length) { note.value = '先在下面点「＋ 图」选一张（或「截图」/ Ctrl+V 粘一张），再点这个'; return }
  if (!visionModel()) { note.value = '录入试题要让 AI 看图：先在「设置 → AI 助手」里配好「视觉模型」✓'; return }
  if (busy.value) return
  await sendAs(PAPER_OCR_PROMPT, '录入试题：把图里的题目（题干 / 选项 / 答案 / 解析）录进试卷')
}
</script>

<template>
  <div class="apc" @dragover.prevent @drop.prevent="onDrop">
    <header class="apc__head">
      <span class="apc__title">AI 助手</span>
      <span class="apc__sub">说一句就改这份卷子（可带图 / 文档 / 截图；截图后能「切图 → 试卷」）</span>
    </header>

    <div ref="listEl" class="apc__list">
      <div v-if="!msgs.length" class="apc__empty">
        可以直接说：<br />
        · 加一节「二、填空题」，放 3 道中档题<br />
        · 从题库找一道椭圆的解答题插到末尾<br />
        · 把解答题改成墨绿色（改现有的，不会多出一份）<br />
        · 这道题（粘图 / 截图）帮我录进试卷<br />
        · 这个文档里的题（＋文档）挑几道进试卷
· 截图 / 粘图后点「切图 → 试卷」，只把图形部分插进卷子（题目文字不切）
        · 拍照/截图 → 点「录入试题」，把图里的题目录进卷子（题干 / 选项 / 答案 / 解析）
      </div>
      <div v-for="(m, i) in msgs" :key="i" class="apc__msg" :class="'apc__msg--' + m.role">
        <template v-if="m.role === 'user'">
          <div v-if="m.text" class="apc__utext">{{ m.text }}</div>
          <div v-if="m.imgs && m.imgs.length" class="apc__uimgs">
            <img v-for="(u, k) in m.imgs" :key="k" :src="u" alt="附件" />
          </div>
          <div v-if="m.docs && m.docs.length" class="apc__udocs">
            <span v-for="(d, k) in m.docs" :key="k">📄 {{ d }}</span>
          </div>
        </template>
        <template v-else>
          <div class="apc__body" :data-i="i"></div>
          <!-- 【v1699】用户："不看它说它做了啥，我只看结果" ✓ → 默认**折叠**（想看再点开 ✓） -->
          <details v-if="m.did && m.did.length" class="apc__didwrap">
            <summary>做了什么（{{ m.did.length }} 步）</summary>
            <ul class="apc__did">
              <li v-for="(d, k) in m.did" :key="k">{{ d }}</li>
            </ul>
          </details>
        </template>
      </div>
    </div>

    <div v-if="atts.length || docs.length" class="apc__atts">
      <div v-for="(a, i) in atts" :key="'i' + i" class="apc__att">
        <img :src="a.src" :title="a.name" alt="附件" />
        <button title="把这张图插进试卷（进图片库并给一个 [图N]）" @click="insertAtt(i)">插进试卷</button>
        <button title="移除" @click="atts.splice(i, 1)">✕</button>
      </div>
      <div v-for="(d, i) in docs" :key="'d' + i" class="apc__doc">
        <span :title="d.name">📄 {{ d.name }}（{{ d.chars }} 字）</span>
        <button title="移除" @click="docs.splice(i, 1)">✕</button>
      </div>
    </div>

    <div class="apc__foot">
      <textarea
        v-model="draft" class="apc__ta" rows="3" spellcheck="false"
        placeholder="说一句要改什么…（Ctrl+V 可以直接粘图）" @paste="onPaste"
        @keydown.enter.exact.prevent="send"
      ></textarea>
      <div class="apc__bar">
        <button class="apc__btn" title="加图（也可以直接粘进来 / 拖进来）" @click="fileInput && fileInput.click()">＋ 图</button>
        <button class="apc__btn" title="加文档：.pdf / .pptx / .txt / .md —— 本地抽文本当参考材料（不会自动写进卷子 ✓）" @click="docInput && docInput.click()">＋ 文档</button>
        <button class="apc__btn" title="截图：截完直接当附件（能选窗口 / 拖选区；也可以 Ctrl+V 粘 Snipaste 的图）" @click="shotOpen = true">截图</button>
<span class="apc__brk" />
        <button class="apc__btn apc__btn--cut" :disabled="busy" title="不调 AI：把上面的附件图切出图形部分（只留图形，题目文字不切），确认后插进试卷" @click="cutToPaper">切图 → 试卷</button>
        <button class="apc__btn apc__btn--chip" :class="{ 'apc__btn--on': onlyFigure }" :title="onlyFigure ? '当前：只切图形部分（题目文字不切）—— 点一下改成整张图' : '当前：整张图都插——点一下改成只切图形'" @click="toggleOnly">{{ onlyFigure ? '只切图形' : '整张图' }}</button>
<button class="apc__btn apc__btn--ocr" :disabled="busy" title="让 AI 看图，把图里的题目（题干/选项/答案/解析）录进试卷；图形不重画，用「切图 → 试卷」自己插原图" @click="ocrToPaper">录入试题</button>
        <span v-if="note" class="apc__note">{{ note }}</span>
        <button class="apc__btn apc__btn--main" :disabled="busy" @click="send">{{ busy ? '处理中…' : '发送' }}</button>
      </div>
    </div>

    <input ref="fileInput" class="apc__file" type="file" accept="image/*" multiple @change="onPick" />
    <input ref="docInput" class="apc__file" type="file" accept=".pdf,.pptx,.txt,.md,.json,.csv" multiple @change="onPickDoc" />
    <ScreenshotCapture v-if="shotOpen" attach @close="shotOpen = false" @done="onShot" />
<!-- 【v1703】插入前的切图预览（与侧栏同一个对话框 ✓） -->
    <FigureCropDialog v-if="previewOpen" :items="previewItems" @done="onPreviewDone" />
  </div>
</template>

<style scoped>
.apc { display: flex; flex-direction: column; min-height: 0; height: 100%; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.apc__head { display: flex; align-items: baseline; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--border); }
.apc__title { font-size: 13px; font-weight: 700; color: var(--text); }
.apc__sub { font-size: 11px; color: var(--muted); }
.apc__list { flex: 1; min-height: 0; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.apc__empty { font-size: 11.5px; line-height: 1.8; color: var(--muted); }
.apc__msg { display: flex; flex-direction: column; gap: 4px; }
.apc__msg--user { align-items: flex-end; }
.apc__utext { max-width: 92%; background: var(--brand-50, #f2f0ff); border: 1px solid var(--brand-100, #ded9fb); color: var(--text); border-radius: 10px; padding: 6px 9px; font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.apc__uimgs { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
.apc__uimgs img { max-height: 68px; max-width: 110px; border: 1px solid var(--border); border-radius: 6px; }
.apc__udocs { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; font-size: 11px; color: var(--muted); }
.apc__body { font-size: 12.5px; line-height: 1.75; color: var(--text); background: var(--gray-50); border: 1px solid var(--border); border-radius: 10px; padding: 7px 9px; word-break: break-word; }
.apc__didwrap { font-size: 11px; color: var(--muted); }
.apc__didwrap summary { cursor: pointer; color: var(--muted); }
.apc__did { margin: 4px 0 0; padding-left: 16px; font-size: 11px; color: #2f6b45; line-height: 1.7; }
.apc__atts { display: flex; gap: 6px; flex-wrap: wrap; padding: 6px 8px; border-top: 1px dashed var(--border); }
.apc__att { display: flex; align-items: center; gap: 4px; }
.apc__att img { max-height: 40px; max-width: 60px; border: 1px solid var(--border); border-radius: 4px; }
.apc__att button { font-size: 11px; border: 1px solid var(--border); background: #fff; border-radius: 5px; padding: 2px 6px; cursor: pointer; color: var(--text); }
.apc__doc { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; color: var(--text); background: var(--gray-50); border: 1px solid var(--border); border-radius: 6px; padding: 2px 6px; }
.apc__doc button { border: none; background: transparent; cursor: pointer; color: var(--gray-600); }
.apc__foot { border-top: 1px solid var(--border); padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.apc__ta { width: 100%; box-sizing: border-box; resize: vertical; font: inherit; font-size: 12.5px; line-height: 1.6; padding: 6px 8px; border: 1px solid var(--border); border-radius: 8px; color: var(--text); }
.apc__bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.apc__btn { height: 26px; padding: 0 9px; border: 1px solid var(--border); border-radius: 6px; background: #fff; font-size: 12px; cursor: pointer; color: var(--text); }
.apc__btn--main { margin-left: auto; background: var(--brand-600, #534AB7); border-color: var(--brand-600, #534AB7); color: #fff; }
.apc__btn:disabled { opacity: .5; cursor: not-allowed; }
.apc__note { font-size: 11px; color: var(--muted); }
.apc__file { display: none; }
/* 【v1703】切图那两枚按钮 + 强制换行（从侧栏那套搬过来：先"怎么给图"，再"切图动作" ✓） */
.apc__brk { flex: 1 0 100%; height: 0; }
.apc__btn--cut { border-color: #ded7ff; background: #f4f2ff; color: #4a3b8f; font-weight: 600; }
.apc__btn--cut:hover:not(:disabled) { background: #ece7ff; }
.apc__btn--chip { height: 24px; padding: 0 8px; font-size: 11.5px; }
.apc__btn--chip.apc__btn--on { border-color: #bfe6cf; background: #eefaf3; color: #2f7d5b; }
.apc__note { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
/* 【v1704】「录入试题」按钮（与「切图」同排：都是对上面那几张图做的事 ✓） */
.apc__btn--ocr { border-color: #cfe3ff; background: #f1f7ff; color: #1f5aa8; font-weight: 600; }
.apc__btn--ocr:hover:not(:disabled) { background: #e5f0ff; }
</style>
