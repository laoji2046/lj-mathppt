<script setup lang="ts">
/**
 * 【v1707】讲义编辑里的 **AI 助手**（用户口径：讲义要引入 AI 面板，且 AI 要精通讲义的各种操作和功能 ✓）
 *
 * 与「试卷编辑」里那个 AI 侧栏是**同一套做法** ✓：
 *   · 工具（讲义专用 17 个，见 aiHandoutChat.HANDOUT_TOOL_NAMES ✓）+ 手册（get_handout_help ✓）
 *   · 能带附件：截图 / 传图（走视觉模型 ✓）、文档（本地抽文本当参考材料 ✓）
 *
 * 与试卷那个的区别：讲义的"正文"是**块**（不是 Markdown 源码 ✗）—— 加内容一律走
 *   add_handout_blocks（type + text ✓），所以这里没有"源码"可给模型看，只有 get_handout_state 的回执 ✓。
 */
import { nextTick, ref } from 'vue'
import { invoke } from '@/composables/useTauri'
import { licensed } from '@/composables/useLicense'
import { AI_TOOLS, aiToolGuide, runAiTool } from '@/composables/aiTools'
import type { AiToolCtx } from '@/composables/aiTools'
import { qSearch, questionTextOf } from '@/composables/useQuestionBank'
import type { QItem } from '@/composables/useQuestionBank'
import { handoutOpsSink } from '@/ui/handout'
import {
  buildHandoutChatSystem, canAttachHandoutChat, canSendHandoutChat, handoutToolsOf,
} from '@/composables/aiHandoutChat'
import { typesetMixed } from '@/composables/useMathJax'
import { escapeHtml } from '@/types'
import ScreenshotCapture from './ScreenshotCapture.vue'

const props = defineProps<{
  /** 把一张图插成讲义里的**插图块**（HandoutModal 的 applyFigureSrc ✓ 大图自动进内容库 ✓） */
  insertImage: (dataUrl: string, caption?: string) => Promise<string>
}>()

interface Msg { role: 'user' | 'ai'; text: string; imgs?: string[]; docs?: string[]; did?: string[] }
const msgs = ref<Msg[]>([])
const draft = ref('')
const atts = ref<{ name: string; src: string }[]>([])
const docs = ref<{ name: string; chars: number; text: string }[]>([])
const busy = ref(false)
const note = ref('')
const listEl = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const docInput = ref<HTMLInputElement | null>(null)
const shotOpen = ref(false)
/** 一次提问里最多让它改几步（防打转 ✓） */
const MAX_TURNS = 12

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
    get_handout_state: '读了一遍讲义',
    get_handout_help: '查了讲义手册',
    get_handout_outline: '看了块号大纲',
    add_handout_blocks: '加了 ' + (Array.isArray(args.blocks) ? args.blocks.length : 0) + ' 块',
    edit_handout_text: '就地改了正文',
    arrange_handout_block: '动了第 ' + n(args.no) + ' 块（' + String(args.action || '') + '）',
    set_handout_block_render: '改了第 ' + n(args.no) + ' 块的显示口径',
    set_handout_meta: '改了教材定位 / 标题',
    set_handout_version: '切到' + (String(args.version || '') === 'student' ? '学生版' : '教师版'),
    insert_bank_question_to_handout: '从题库插了题 #' + n(args.id),
    draw_bank_questions_to_handout: '按条件抽了 ' + n(args.n) + ' 道',
    search_bank: '在题库里搜「' + String(args.query || '') + '」',
    insert_handout_figure: '插了一张数学图形（' + String(args.kind || '') + '）',
    sync_handout_refs: '按题库刷新了引用的块',
    print_handout: '打开了打印 / 另存 PDF',
    export_handout_text: '导出了纯文本',
    save_handout: '把讲义存进了库目录',
  }
  return (res.ok ? '已' : '没能') + (map[name] || name) + (res.ok ? '' : '（' + String(res.error || '') + '）')
}

/** 给工具用的「讲义能力」+ 题库检索（幻灯片那几个填桩，反正也没给它 ✗） */
function ctxOf(): AiToolCtx {
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
        for (const it of items) ctxOfFound.set(Number(it.id), it)
        return items.map((it) => ({ id: Number(it.id), label: (it.code ? it.code + ' ' : '') + String(it.title || it.body || '').slice(0, 60) }))
      },
      textOf: async (id, withAnswer) => {
        const it = ctxOfFound.get(Number(id))
        return it ? questionTextOf(it, withAnswer) : null
      },
    },
    /** 讲义那 17 个工具全部转给 HandoutModal 登记的 handoutOps ✓（讲义没开时是 null → 工具会说清 ✓） */
    handout: {
      state: (maxChars) => (handoutOpsSink.value ? handoutOpsSink.value.state(maxChars) : { open: false }),
      outline: () => (handoutOpsSink.value ? handoutOpsSink.value.outline() : ''),
      addBlocks: (specs, where, afterNo) => (handoutOpsSink.value ? handoutOpsSink.value.addBlocks(specs, where, afterNo) : '讲义没开着 ✗'),
      edit: (find, replace, all) => (handoutOpsSink.value ? handoutOpsSink.value.edit(find, replace, all) : '讲义没开着 ✗'),
      block: (no, action) => (handoutOpsSink.value ? handoutOpsSink.value.block(no, action) : '讲义没开着 ✗'),
      setRender: (no, render, version) => (handoutOpsSink.value ? handoutOpsSink.value.setRender(no, render, version) : '讲义没开着 ✗'),
      meta: () => (handoutOpsSink.value ? handoutOpsSink.value.meta() : {}),
      setMeta: (patch) => (handoutOpsSink.value ? handoutOpsSink.value.setMeta(patch) : '讲义没开着 ✗'),
      version: (v) => (handoutOpsSink.value ? handoutOpsSink.value.version(v) : '讲义没开着 ✗'),
      insertQuestion: (q, kind, withAnswer) => (handoutOpsSink.value ? handoutOpsSink.value.insertQuestion(q, kind, withAnswer) : '讲义没开着 ✗'),
      draw: async (filter, n, pool) => (handoutOpsSink.value ? await handoutOpsSink.value.draw(filter, n, pool) : '讲义没开着 ✗'),
      figure: async (kind, params, caption) => (handoutOpsSink.value ? await handoutOpsSink.value.figure(kind, params, caption) : ''),
      syncRefs: async () => (handoutOpsSink.value ? await handoutOpsSink.value.syncRefs() : '讲义没开着 ✗'),
      print: () => (handoutOpsSink.value ? handoutOpsSink.value.print() : '讲义没开着 ✗'),
      exportText: () => (handoutOpsSink.value ? handoutOpsSink.value.exportText() : '讲义没开着 ✗'),
      save: async () => (handoutOpsSink.value ? await handoutOpsSink.value.save() : '讲义没开着 ✗'),
    },
  }
}

/** 带工具的对话循环（与试卷 AI 同一套通道 ✓；这里只给讲义那 17 个工具 ✓） */
async function askWithTools(
  text: string,
  imgs: string[],
  docList: { name: string; chars: number; text: string }[],
  key: string,
  ai: Msg,
): Promise<string> {
  const system = buildHandoutChatSystem() + String.fromCharCode(10, 10) + aiToolGuide()
  const messages: unknown[] = [
    { role: 'system', content: system },
    { role: 'user', content: userContent(text, imgs, docList) },
  ]
  const tools = handoutToolsOf(AI_TOOLS)
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
      // 【v1707】insert_bank_question_to_handout 的 id 要换回**题目对象**（讲义那边才好造块 ✓）
      if (name === 'insert_bank_question_to_handout') {
        const it = args.id === undefined ? undefined : (ctxOfFound.get(Number(args.id)))
        if (it) args.q = it
      }
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
/** search_bank 查到的题（按 id 找回来 ✓）—— 由 ctxOf 填、askWithTools 读 ✓ */
const ctxOfFound = new Map<number, QItem>()

/** 用户这条消息的内容：带图就是多模态数组 ✓；文档拼进 text ✓ */
function userContent(text: string, imgs: string[], docList: { name: string; chars: number; text: string }[]): unknown {
  const t = String(text || '')
  const list = (imgs || []).filter(Boolean).slice(0, 4)
  const blocks = (docList || []).map((d) => '【参考材料：' + d.name + '】' + String.fromCharCode(10) + String(d.text || '').slice(0, 20000))
  const full = blocks.length ? (t ? t + String.fromCharCode(10, 10) + blocks.join(String.fromCharCode(10, 10)) : blocks.join(String.fromCharCode(10, 10))) : t
  if (!list.length) return full
  return [{ type: 'text', text: full }, ...list.map((u) => ({ type: 'image_url', image_url: { url: u } }))]
}

/** 把 AI 回复里的 $公式$ 排出来（写 innerHTML 的手法与其它浮层一致 ✓：宿主是空 div，模板不绑内容 ✓） */
async function renderAll() {
  await nextTick()
  const hosts = Array.from(document.querySelectorAll<HTMLElement>('.ahc__body'))
  for (const h of hosts) {
    const i = Number(h.dataset.i)
    const m = msgs.value[i]
    if (!m) continue
    const want = escapeHtml(m.text || '')
    if (h.dataset.txt === want) continue
    h.dataset.txt = want
    try { await typesetMixed(h, want) } catch { h.textContent = m.text || '' }
  }
}
function scrollSoon() {
  void nextTick(() => { const el = listEl.value; if (el) el.scrollTop = el.scrollHeight })
}

/* ---------------- 附件：图（截图 / 传图 / 粘贴 / 拖入 ✓）与文档 ---------------- */

async function addFiles(files: File[]) {
  for (const f of files) {
    const c = canAttachHandoutChat(atts.value.length, f.size)
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
/** 把这张附件插成讲义的**插图块**（走 HandoutModal 的 applyFigureSrc ✓ 大图自动进内容库 ✓） */
async function insertAtt(i: number) {
  const a = atts.value[i]
  if (!a) return
  try {
    note.value = (await props.insertImage(a.src, a.name)) || '已插成插图 ✓'
  } catch (err) {
    note.value = '插成插图失败：' + String((err as Error)?.message || err)
  }
}
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
      const chars = text.replace(/\s/g, '').length
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
/** 截图弹窗（attach 模式）交回来的图，直接当附件 ✓ */
function onShot(dataUrl: string) {
  shotOpen.value = false
  if (!dataUrl) return
  atts.value.push({ name: '截图', src: dataUrl })
  note.value = visionModel()
    ? '截图已当附件 ✓ 直接说要对它做什么就行'
    : '截图已当附件，但还没配「视觉模型」—— 可能读不出图（设置 → AI 助手 ✓）'
}

/* ---------------- 发送 ---------------- */

async function send() {
  const c = canSendHandoutChat(draft.value, busy.value, atts.value.length + docs.value.length)
  if (!c.ok) { note.value = c.why; return }
  if (!licensed('ai-assistant')) { note.value = 'AI 助手要先激活：工具栏「激活 / 序列号」'; return }
  const key = aiKey()
  if (!key) { note.value = '还没填 AI Key：设置 → AI 助手 里填一个（只存本机 ✓）'; return }
  const text = draft.value.trim()
  const imgs = atts.value.map((a) => a.src)
  const docList = docs.value.slice()
  msgs.value.push({ role: 'user', text, imgs: imgs.slice(), docs: docList.map((d) => d.name) })
  draft.value = ''
  atts.value = []
  docs.value = []
  note.value = ''
  busy.value = true
  const ai: Msg = { role: 'ai', text: '（正在看讲义…）', did: [] }
  msgs.value.push(ai)
  await renderAll()
  scrollSoon()
  try {
    ctxOfFound.clear()
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
</script>

<template>
  <div class="ahc" @dragover.prevent @drop.prevent="onDrop">
    <header class="ahc__head">
      <span class="ahc__title">AI 助手</span>
      <span class="ahc__sub">说一句就改这份讲义（可带图 / 文档 / 截图）</span>
    </header>

    <div ref="listEl" class="ahc__list">
      <div v-if="!msgs.length" class="ahc__empty">
        可以直接说：<br />
        · 加一节「二、椭圆的定义」，再写个学习目标<br />
        · 从题库找一道椭圆的题，插成例题<br />
        · 这道例题的解析改一下（先看正文再改）<br />
        · 学生版把答案藏起来（排到文末，不要删）<br />
        · 插一张抛物线（数学图形）<br />
        · 打印 / 导出 PDF，或帮我存一下
      </div>
      <div v-for="(m, i) in msgs" :key="i" class="ahc__msg" :class="'ahc__msg--' + m.role">
        <template v-if="m.role === 'user'">
          <div v-if="m.text" class="ahc__utext">{{ m.text }}</div>
          <div v-if="m.imgs && m.imgs.length" class="ahc__uimgs">
            <img v-for="(u, k) in m.imgs" :key="k" :src="u" alt="附件" />
          </div>
          <div v-if="m.docs && m.docs.length" class="ahc__udocs">
            <span v-for="(d, k) in m.docs" :key="k">📄 {{ d }}</span>
          </div>
        </template>
        <template v-else>
          <div class="ahc__body" :data-i="i"></div>
          <!-- 用户口径：不看它说它做了啥，我只看结果 ✓ → 默认**折叠**（想看再点开 ✓） -->
          <details v-if="m.did && m.did.length" class="ahc__didwrap">
            <summary>做了什么（{{ m.did.length }} 步）</summary>
            <ul class="ahc__did">
              <li v-for="(d, k) in m.did" :key="k">{{ d }}</li>
            </ul>
          </details>
        </template>
      </div>
    </div>

    <div v-if="atts.length || docs.length" class="ahc__atts">
      <div v-for="(a, i) in atts" :key="'i' + i" class="ahc__att">
        <img :src="a.src" :title="a.name" alt="附件" />
        <button title="把这张图插成讲义里的插图块（大图自动进内容库 ✓）" @click="insertAtt(i)">插成插图</button>
        <button title="移除" @click="atts.splice(i, 1)">✕</button>
      </div>
      <div v-for="(d, i) in docs" :key="'d' + i" class="ahc__doc">
        <span :title="d.name">📄 {{ d.name }}（{{ d.chars }} 字）</span>
        <button title="移除" @click="docs.splice(i, 1)">✕</button>
      </div>
    </div>

    <div class="ahc__foot">
      <textarea
        v-model="draft" class="ahc__ta" rows="3" spellcheck="false"
        placeholder="说一句要改什么…（Ctrl+V 可以直接粘图）" @paste="onPaste"
        @keydown.enter.exact.prevent="send"
      ></textarea>
      <div class="ahc__bar">
        <button class="ahc__btn" title="加图（也可以直接粘进来 / 拖进来）" @click="fileInput && fileInput.click()">＋ 图</button>
        <button class="ahc__btn" title="加文档：.pdf / .pptx / .txt / .md —— 本地抽文本当参考材料（不会自动写进讲义 ✓）" @click="docInput && docInput.click()">＋ 文档</button>
        <button class="ahc__btn" title="截图：截完直接当附件（能选窗口 / 拖选区；也可以 Ctrl+V 粘 Snipaste 的图）" @click="shotOpen = true">截图</button>
        <span v-if="note" class="ahc__note">{{ note }}</span>
        <button class="ahc__btn ahc__btn--main" :disabled="busy" @click="send">{{ busy ? '处理中…' : '发送' }}</button>
      </div>
    </div>

    <input ref="fileInput" class="ahc__file" type="file" accept="image/*" multiple @change="onPick" />
    <input ref="docInput" class="ahc__file" type="file" accept=".pdf,.pptx,.txt,.md,.json,.csv" multiple @change="onPickDoc" />
    <ScreenshotCapture v-if="shotOpen" attach @close="shotOpen = false" @done="onShot" />
  </div>
</template>

<style scoped>
.ahc { display: flex; flex-direction: column; min-height: 0; height: 100%; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.ahc__head { display: flex; align-items: baseline; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--border); }
.ahc__title { font-size: 13px; font-weight: 700; color: var(--text); }
.ahc__sub { font-size: 11px; color: var(--muted); }
.ahc__list { flex: 1; min-height: 0; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.ahc__empty { font-size: 11.5px; line-height: 1.8; color: var(--muted); }
.ahc__msg { display: flex; flex-direction: column; gap: 4px; }
.ahc__msg--user { align-items: flex-end; }
.ahc__utext { max-width: 92%; background: var(--brand-50, #f2f0ff); border: 1px solid var(--brand-100, #ded9fb); color: var(--text); border-radius: 10px; padding: 6px 9px; font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.ahc__uimgs { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
.ahc__uimgs img { max-height: 68px; max-width: 110px; border: 1px solid var(--border); border-radius: 6px; }
.ahc__udocs { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; font-size: 11px; color: var(--muted); }
.ahc__body { font-size: 12.5px; line-height: 1.75; color: var(--text); background: var(--gray-50); border: 1px solid var(--border); border-radius: 10px; padding: 7px 9px; word-break: break-word; }
.ahc__didwrap { font-size: 11px; color: var(--muted); }
.ahc__didwrap summary { cursor: pointer; color: var(--muted); }
.ahc__did { margin: 4px 0 0; padding-left: 16px; font-size: 11px; color: #2f6b45; line-height: 1.7; }
.ahc__atts { display: flex; gap: 6px; flex-wrap: wrap; padding: 6px 8px; border-top: 1px dashed var(--border); }
.ahc__att { display: flex; align-items: center; gap: 4px; }
.ahc__att img { max-height: 40px; max-width: 60px; border: 1px solid var(--border); border-radius: 4px; }
.ahc__att button { font-size: 11px; border: 1px solid var(--border); background: #fff; border-radius: 5px; padding: 2px 6px; cursor: pointer; color: var(--text); }
.ahc__doc { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; color: var(--text); background: var(--gray-50); border: 1px solid var(--border); border-radius: 6px; padding: 2px 6px; }
.ahc__doc button { border: none; background: transparent; cursor: pointer; color: var(--gray-600); }
.ahc__foot { border-top: 1px solid var(--border); padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.ahc__ta { width: 100%; box-sizing: border-box; resize: vertical; font: inherit; font-size: 12.5px; line-height: 1.6; padding: 6px 8px; border: 1px solid var(--border); border-radius: 8px; color: var(--text); }
.ahc__bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ahc__btn { height: 26px; padding: 0 9px; border: 1px solid var(--border); border-radius: 6px; background: #fff; font-size: 12px; cursor: pointer; color: var(--text); }
.ahc__btn--main { margin-left: auto; background: var(--brand-600, #534AB7); border-color: var(--brand-600, #534AB7); color: #fff; }
.ahc__btn:disabled { opacity: .5; cursor: not-allowed; }
.ahc__note { font-size: 11px; color: var(--muted); flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.ahc__file { display: none; }
</style>
