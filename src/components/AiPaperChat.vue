<script setup lang="ts">
/**
 * 【v1692】试卷编辑里的 **AI 聊天侧栏**（用户口径：介于输入框与预览之间、像侧边栏、支持导入图片、聊天改试卷 ✓）
 *
 * 与「AI 组卷 / 命题…」那个对话框分工：
 *   · 对话框：**一次成型**（按条件从题库组卷 / 让模型命一套题 ✓）
 *   · 这个侧栏：**边聊边改**（加一节、插一道、改题号、把照片里的题录进来 ✓），带工具循环，直接改左边源码 ✓
 *
 * 工具只给试卷用得上的四个（见 aiPaperChat.paperToolsOf ✓）—— 幻灯片那套给了它只会乱调 ✗。
 * 带图时走视觉模型（设置里的「视觉模型」✓），没配就明说"可能读不了图" ✓（不糊弄 ✓）。
 */
import { nextTick, ref } from 'vue'
import { invoke } from '@/composables/useTauri'
import { licensed } from '@/composables/useLicense'
import { AI_TOOLS, aiToolGuide, runAiTool } from '@/composables/aiTools'
import type { AiToolCtx } from '@/composables/aiTools'
import { pickImages, qSearch, questionBlockOf, questionTextOf } from '@/composables/useQuestionBank'
import type { QItem } from '@/composables/useQuestionBank'
import { sendToPaper } from '@/ui/paper'
import {
  buildPaperChatSystem, canAttachPaperChat, canSendPaperChat, chatUserContent, paperToolsOf,
} from '@/composables/aiPaperChat'
import { typesetMixed } from '@/composables/useMathJax'
import { escapeHtml } from '@/types'

const props = defineProps<{
  /** 读试卷正文（PaperModal 传进来 ✓） */
  readText: () => string
  /** 追加到试卷末尾（PaperModal 传进来 ✓ —— 顺带 render + 存草稿 ✓） */
  append: (text: string, pageBreak: boolean) => void
  /** 把一张图插进试卷的图片库，返回 [图N] 标记 ✓ */
  insertImage: (dataUrl: string, name?: string) => Promise<string>
}>()

interface Msg { role: 'user' | 'ai'; text: string; imgs?: string[]; did?: string[] }
const msgs = ref<Msg[]>([])
const draft = ref('')
const atts = ref<{ name: string; src: string }[]>([])
const busy = ref(false)
const note = ref('')
const listEl = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
/** 一次提问里最多让它改几步（防打转 ✓） */
const MAX_TURNS = 6

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
    append_to_paper: '追加了 ' + String(args.text || '').length + ' 字' + (args.page_break ? '（先分页 ✓）' : ''),
    insert_bank_question_to_paper: '插入题库试题 #' + n(args.id) + (args.with_answer ? '（带答案）' : ''),
    search_bank: '在题库里搜「' + String(args.query || '') + '」',
  }
  return (res.ok ? '已' : '没能') + (map[name] || name) + (res.ok ? '' : '（' + String(res.error || '') + '）')
}

/** 给工具用的「应用能力」：试卷三件套 + 题库检索（幻灯片那几个填桩，反正也没给它 ✗） */
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
    },
  }
}

/** 带工具的对话循环（与 AI 助手同一套通道 ✓；这里只给试卷那四个工具 ✓） */
async function askWithTools(text: string, imgs: string[], key: string, ai: Msg): Promise<string> {
  const system = buildPaperChatSystem() + String.fromCharCode(10, 10) + aiToolGuide()
  const messages: unknown[] = [
    { role: 'system', content: system },
    { role: 'user', content: chatUserContent(text, imgs) },
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
  return '（这一轮改的步骤有点多，先停在这里；你可以再让我接着改 ✓）'
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

async function send() {
  const c = canSendPaperChat(draft.value, busy.value, atts.value.length)
  if (!c.ok) { note.value = c.why; return }
  if (!licensed('ai-assistant')) { note.value = 'AI 助手要先激活：工具栏「激活 / 序列号」'; return }
  const key = aiKey()
  if (!key) { note.value = '还没填 AI Key：设置 → AI 助手 里填一个（只存本机 ✓）'; return }
  const text = draft.value.trim()
  const imgs = atts.value.map((a) => a.src)
  msgs.value.push({ role: 'user', text, imgs: imgs.slice() })
  draft.value = ''
  atts.value = []
  note.value = ''
  busy.value = true
  const ai: Msg = { role: 'ai', text: '（正在看试卷…）', did: [] }
  msgs.value.push(ai)
  await renderAll()
  scrollSoon()
  try {
    const out = await askWithTools(text, imgs, key, ai)
    ai.text = out || '（模型没有返回内容）'
  } catch (e) {
    ai.text = '出错了：' + String((e as Error)?.message || e)
  } finally {
    busy.value = false
    await renderAll()
    scrollSoon()
  }
}
</script>

<template>
  <div class="apc" @dragover.prevent @drop.prevent="onDrop">
    <header class="apc__head">
      <span class="apc__title">AI 助手</span>
      <span class="apc__sub">说一句就改这份卷子（可带图）</span>
    </header>

    <div ref="listEl" class="apc__list">
      <div v-if="!msgs.length" class="apc__empty">
        可以直接说：<br />
        · 加一节「二、填空题」，放 3 道中档题<br />
        · 从题库找一道椭圆的解答题插到末尾<br />
        · 帮我把题号重排、选项对齐<br />
        · 这道题（粘一张照片）帮我录进试卷
      </div>
      <div v-for="(m, i) in msgs" :key="i" class="apc__msg" :class="'apc__msg--' + m.role">
        <template v-if="m.role === 'user'">
          <div v-if="m.text" class="apc__utext">{{ m.text }}</div>
          <div v-if="m.imgs && m.imgs.length" class="apc__uimgs">
            <img v-for="(u, k) in m.imgs" :key="k" :src="u" alt="附件" />
          </div>
        </template>
        <template v-else>
          <div class="apc__body" :data-i="i"></div>
          <ul v-if="m.did && m.did.length" class="apc__did">
            <li v-for="(d, k) in m.did" :key="k">{{ d }}</li>
          </ul>
        </template>
      </div>
    </div>

    <div v-if="atts.length" class="apc__atts">
      <div v-for="(a, i) in atts" :key="i" class="apc__att">
        <img :src="a.src" :title="a.name" alt="附件" />
        <button title="把这张图插进试卷（进图片库并给一个 [图N]）" @click="insertAtt(i)">插进试卷</button>
        <button title="移除" @click="atts.splice(i, 1)">✕</button>
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
        <span v-if="note" class="apc__note">{{ note }}</span>
        <button class="apc__btn apc__btn--main" :disabled="busy" @click="send">{{ busy ? '处理中…' : '发送' }}</button>
      </div>
    </div>

    <input ref="fileInput" class="apc__file" type="file" accept="image/*" multiple @change="onPick" />
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
.apc__body { font-size: 12.5px; line-height: 1.75; color: var(--text); background: var(--gray-50); border: 1px solid var(--border); border-radius: 10px; padding: 7px 9px; word-break: break-word; }
.apc__did { margin: 0; padding-left: 16px; font-size: 11px; color: #2f6b45; line-height: 1.7; }
.apc__atts { display: flex; gap: 6px; flex-wrap: wrap; padding: 6px 8px; border-top: 1px dashed var(--border); }
.apc__att { display: flex; align-items: center; gap: 4px; }
.apc__att img { max-height: 40px; max-width: 60px; border: 1px solid var(--border); border-radius: 4px; }
.apc__att button { font-size: 11px; border: 1px solid var(--border); background: #fff; border-radius: 5px; padding: 2px 6px; cursor: pointer; color: var(--text); }
.apc__foot { border-top: 1px solid var(--border); padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.apc__ta { width: 100%; box-sizing: border-box; resize: vertical; font: inherit; font-size: 12.5px; line-height: 1.6; padding: 6px 8px; border: 1px solid var(--border); border-radius: 8px; color: var(--text); }
.apc__bar { display: flex; align-items: center; gap: 6px; }
.apc__btn { height: 26px; padding: 0 9px; border: 1px solid var(--border); border-radius: 6px; background: #fff; font-size: 12px; cursor: pointer; color: var(--text); }
.apc__btn--main { margin-left: auto; background: var(--brand-600, #534AB7); border-color: var(--brand-600, #534AB7); color: #fff; }
.apc__btn:disabled { opacity: .5; cursor: not-allowed; }
.apc__note { font-size: 11px; color: var(--muted); }
.apc__file { display: none; }
</style>
