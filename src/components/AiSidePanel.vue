<script setup lang="ts">
/**
 * 【v1642】右侧 DeepSeek 助手（用户要求；按 Tauri 路线重做，不照搬那份 Electron 副本的 <webview> ✗）
 *
 * 为什么不嵌网页：webview 标签是 Electron 专有，Tauri/WebView2 里不存在 ✗；
 *   而 iframe 会被站点的 X-Frame-Options 挡掉 ✗。所以走**官方 API**：
 *   Rust 侧已有 ai_chat（网页端直连 api.deepseek.com 会被 CORS 挡，请求必须在 Rust 侧发 ✓）。
 *
 * 收起时只留一条 40px 竖条；Key 复用「设置 → AI Key」那一份 ✓
 */
import { computed, nextTick, ref } from 'vue'
import { invoke, isTauri } from '@/composables/useTauri'
import AppIcon from './AppIcon.vue'
import { pdfToMarkdown } from '@/pdf/pdfImport'
import { firstUserDir, writeTextFile } from '@/composables/useQuestionBank'
import { markdownToDeck } from '@/composables/mdDeck'
import { attachTikzFigures, tikzSolver } from '@/composables/figureRender'
import { tikzToPlaceholders, type TikzSpec } from '@/composables/tikzFigure'
import { useDeckStore } from '@/stores/deck'

const open = ref(false)
const input = ref('')
const busy = ref(false)
const err = ref('')
const listEl = ref<HTMLElement | null>(null)
const msgs = ref<{ role: 'user' | 'ai'; text: string }[]>([])
const keyTick = ref(0)

/** AI Key：名字不写死 —— 设置里存的是哪个键就用哪个（避免和设置面板漂移 ✗）✓ */
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
const hasKey = computed(() => { void keyTick.value; return !!aiKey() })

/* ---- 【v1645】附件：图片（多模态）+ 文档（本地抽文本，纯文本模型也能读）---- */
const attImgs = ref<string[]>([])
const attDocs = ref<{ name: string; chars: number; text: string }[]>([])
const attMsg = ref('')
const imgInput = ref<HTMLInputElement | null>(null)
const docInput = ref<HTMLInputElement | null>(null)
const MAX_IMG = 4
const MAX_BYTES = 4 * 1024 * 1024
const MAX_DOC_CHARS = 20000
function readAsDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result || "")); r.onerror = () => rej(new Error("读图失败")); r.readAsDataURL(f) })
}
async function onPickImg(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  attMsg.value = ''
  for (const f of files) {
    if (attImgs.value.length >= MAX_IMG) { attMsg.value = '最多带 ' + MAX_IMG + ' 张图'; break }
    if (f.size > MAX_BYTES) { attMsg.value = f.name + ' 超过 4MB，跳过'; continue }
    try { attImgs.value.push(await readAsDataUrl(f)) } catch { attMsg.value = f.name + " 读不出来" }
  }
}
async function onPickDoc(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  attMsg.value = ''
  for (const f of files) {
    try {
      let text = ''
      if (/\.pdf$/i.test(f.name)) {
        const r = await pdfToMarkdown(new Uint8Array(await f.arrayBuffer()), {})
        text = String((r as { markdown?: string })?.markdown || '')
      } else {
        text = await f.text()
      }
      text = text.trim()
      if (!text) { attMsg.value = f.name + ' 里没抽出文字（可能是扫描件；可以把它当图片发）'; continue }
      const cut = text.length > MAX_DOC_CHARS ? text.slice(0, MAX_DOC_CHARS) + '\n…（已截断）' : text
      attDocs.value.push({ name: f.name, chars: text.length, text: cut })
    } catch (err) { attMsg.value = f.name + " 解析失败：" + String((err as Error)?.message || err) }
  }
}
function dropAtt(kind: "img" | "doc", i: number) {
  if (kind === 'img') attImgs.value.splice(i, 1)
  else attDocs.value.splice(i, 1)
}

/** 【v1650】设置里的「视觉模型」——带图提问时用它 ✓ */
function visionModel(): string { try { return String(localStorage.getItem('lj-mathslides:vision-model') || '').trim() } catch { return '' } }
function visionBase(): string { try { return String(localStorage.getItem('lj-mathslides:vision-base') || '').trim() } catch { return '' } }

const SYSTEM = '你是高中数学老师的备课助手。回答用中文，简洁、可直接放进讲义：公式用 $...$（行内）或 $$...$$（独立行），结论先说，步骤可省。'
  // 【v1651】当时幻灯片不认 TikZ/pgfplots/Asymptote（用户实报：AI 给的 tikzpicture 完全渲染不出来 ✗）
  //   → 提示词里干脆禁止它写图。
  // 【v1655】**反过来**：v1652~v1654 已经把常见 TikZ 真译成可编辑图形了，再禁止写就等于"永远没有图" ✗
  //   （用户实报：AI 回答里只剩一句「图形要素」，幻灯片上没图 ✗）
  //   现在要求它**按能译出来的子集写**：少写一种花活，就少一次"整张退回占位" ✓
  + '画图请用 TikZ（软件会把它译成**可编辑的数学图形**），并且只写下面这几种写法：'
  + '① 整段用 \\begin{tikzpicture}…\\end{tikzpicture} 包起来，**不要**再用三反引号的代码块把它包住；'
  + '② 坐标轴：\\draw[->] (-5,0) -- (5,0) node[below]{$x$}; 与 \\draw[->] (0,-3) -- (0,3) node[left]{$y$};（原点 O 不用写，软件自带）；'
  + '③ 曲线用参数式，一张图只画一条圆锥曲线（双曲线两支算一条，写两条 plot 即可）：'
  + '椭圆 plot ({3*cos(\\x)},{2*sin(\\x)})、双曲线 plot ({2*cosh(\\x)},{1.5*sinh(\\x)})（另一支前面加负号）、'
  + '抛物线 plot ({\\x*\\x/4},{\\x})，都要带 domain=…；'
  + '④ 点：\\fill (x,y) circle (1.5pt) node[right]{$A$};（焦点写成 F_1、F_2）；'
  + '⑤ 线段 / 弦：\\draw (x1,y1) -- (x2,y2);，虚线加 dashed；'
  + '⑥ 文字：\\node at (x,y) {$M$};。'
  + '点的坐标要**算准**（交点先解出来再写上去）；不要用 pgfplots 的 axis 环境 / Asymptote / \\foreach / \\def / \\clip / 旋转 / 相对坐标（+ 或 ++）—— 这些会让整张图退回一行占位。'
  + '万一这张图用上面几种写法表达不了，就用一句话说明图形要素，并提示老师用「数学图形」库插入。'

async function send() {
  const t = input.value.trim()
  if (!t || busy.value) return
  if (!isTauri()) { err.value = '浏览器预览里不能调用 AI（请求要由桌面端内核发，网页端会被 CORS 挡）'; return }
  const key = aiKey()
  if (!key) { err.value = '还没填 AI Key —— 打开「设置」填一个 DeepSeek Key 就能用 ✓'; keyTick.value++; return }
  err.value = ''
  const ctx = attDocs.value.length
    ? attDocs.value.map((d) => '【附件：' + d.name + '】\n' + d.text).join('\n\n') + '\n\n—— 以上是附件内容，请结合它回答 ——\n'
    : ''
  const userText = ctx + t
  const imgs = attImgs.value.slice()
  const tag = (attDocs.value.length ? '（附文档 ' + attDocs.value.length + ' 份' : '') + (imgs.length ? (attDocs.value.length ? '、图 ' : '（图 ') + imgs.length + ' 张' : '') + ((attDocs.value.length || imgs.length) ? '）' : '')
  msgs.value.push({ role: 'user', text: t + tag })
  input.value = ''
  busy.value = true
  await scrollDown()
  try {
    const r = await invoke<{ ok?: boolean; text?: string; content?: string; error?: string }>('ai_chat', {
      // 【v1650】带图且有「视觉模型」配置时自动切换（设置里填的，键名两边一致 ✓）
      baseUrl: imgs.length ? visionBase() : '',
      apiKey: key,
      model: imgs.length && visionModel() ? visionModel() : 'deepseek-chat',
      system: SYSTEM, userText, images: imgs.length ? imgs : null,
    })
    const text = String((r && (r.text || r.content)) || '').trim()
    if (r && r.ok === false) err.value = String(r.error || '调用失败')
    else if (!text) err.value = '模型没有返回内容'
    else msgs.value.push({ role: 'ai', text })
  } catch (e) { err.value = String((e as Error)?.message || e) }
  finally { busy.value = false; attImgs.value = []; attDocs.value = []; await scrollDown() }
}
async function scrollDown() {
  await nextTick()
  const el = listEl.value
  if (el) el.scrollTop = el.scrollHeight
}

function clearAll() { msgs.value = []; err.value = '' }
async function copyOne(t: string) { try { await navigator.clipboard.writeText(t) } catch { /* 忽略 */ } }

/* ---- 【v1646】把 AI 回答存成 .md（用户要求：能下载下来）----
 *   桌面端写到「文档」目录（复用导出用的 firstUserDir / writeTextFile ✓ 比浏览器下载稳）；
 *   浏览器预览里退回 Blob 下载 ✓。存出来的 .md 能直接走「导入 .md 文件」核对入库 ✓
 */
const saveMsg = ref('')
const store = useDeckStore()

/** 插入结果的补充说明：译了几张图、哪几处没认出来（绝不假装都译出来了 ✓） */
function tikzSummary(got: { figures: number; texts: number; orphans: number }, specs: TikzSpec[], fails: string[]): string {
  const parts: string[] = []
  if (got.orphans) parts.push(got.orphans + ' 张 TikZ 图形没能落到幻灯片上（已换成一行说明，请把这条回答发我看看）')
  if (got.figures) {
    // 曲线是什么 + 解析时的降级/绑定说明（"哪几个点被钉到交点上"就在 notes 里）✓
    const notes = specs.flatMap((s) => s.notes).slice(0, 2)
    parts.push('TikZ 已译成 ' + got.figures + ' 张可编辑图形（' + specs.map((s) => s.curve).join('；') +
      (notes.length ? '；' + notes.join('；') : '') + '）')
  }
  if (fails.length) parts.push(fails.length + ' 处没认出来，已按一行占位（' + fails[0] + '）')
  return parts.length ? '，' + parts.join('；') : ''
}

/** 【v1647】一键插入幻灯片（用户要求）：AI 回答是 Markdown → 走应用自己的 markdownToDeck ✓
 *   （与「导入 PDF → 抽取文字」同一条链路，公式/标题/段落都按应用的口径成页 ✓）
 *  【v1652】在此之前先把 AI 顺口写的 TikZ **真译成图形**（译不出的才退回一行占位）✓ */
function insertToSlides(t: string) {
  try {
    const pre = tikzToPlaceholders(t, tikzSolver)
    const deck = markdownToDeck(mdClean(pre.md))
    if (!deck || !deck.slides || !deck.slides.length) { saveMsg.value = '这段内容里没有能成页的文字'; return }
    const got = attachTikzFigures(deck, pre.specs)
    const ok = store.importDeck(deck)
    saveMsg.value = ok
      ? ('已插入 ' + deck.slides.length + ' 页幻灯片' + tikzSummary(got, pre.specs, pre.fails))
      : '生成的内容无效（已取消，未影响当前内容）'
  } catch (e) { saveMsg.value = '插入失败：' + String((e as Error)?.message || e) }
}
function mdClean(t: string): string {
  let s = String(t || '').trim()
  // 去掉模型爱加的整段围栏（```markdown … ``` / ``` … ```），否则再导入会多出一堆噪声 ✗
  // 去围栏：整段包着的情况，以及"只包了前面/后面"的情况都要处理 ✓
  //  （用户实报：AI 回答以 ```latex 开头，整段没被识别成围栏，于是 \textbf 原样插进幻灯片 ✗）
  s = s.replace(/^\s*```[a-zA-Z]*\s*\n/, "").replace(/\n```\s*$/, "")
  const m = s.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/)
  if (m) s = m[1].trim()
  // `\textbf{1.}` 这类宏在幻灯片里只会原样显示 ✗ → 还原成里面的文字 ✓
  s = s.replace(/\\textbf\{([^{}]*)\}/g, '$1').replace(/\\mathrm\{([^{}]*)\}/g, '$1')
  // 【v1651】TikZ / pgfplots 绘图环境：幻灯片不认 ✗ —— 换一行占位，而不是把几十行代码贴上去 ✓
  s = s.replace(/\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/g, '（此处原为 TikZ 绘图，幻灯片不支持；建议用「数学图形」库插一张对应的图）')
  s = s.replace(/\\begin\{axis\}[\s\S]*?\\end\{axis\}/g, '（此处原为 pgfplots 图，幻灯片不支持；建议用「数学图形」库插一张）')
  s = s.replace(/\\begin\{asy\}[\s\S]*?\\end\{asy\}/g, '（此处原为 Asymptote 图，幻灯片不支持；建议用「数学图形」库插一张）')
  // 【v1652】纯排版外壳（\begin{center}…\end{center}）：幻灯片不认，**去掉外壳、内容留下** ✓
  //   （用户原文那道双曲线题就包在 center 里；旧写法只认"空的一对"，于是 \begin{center} 会当正文显示出来 ✗）
  s = s.replace(/\\begin\{(center|flushleft|flushright)\}\[ \t]*\n?/g, '').replace(/\\end\{(center|flushleft|flushright)\}[ \t]*\n?/g, '')
  return s + '\n'
}
function stampName(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return 'AI回答-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + '.md'
}
async function saveAnswer(t: string) {
  const md = mdClean(t)
  const name = stampName()
  saveMsg.value = ''
  if (isTauri()) {
    try {
      const dir = await firstUserDir('文档')
      if (!dir) { saveMsg.value = '没选目录，已取消'; return }
      const r = await writeTextFile(dir, name, md)
      saveMsg.value = r && r.ok ? ('已存到 ' + r.path) : ('保存失败：' + String((r && r.error) || ''))
    } catch (e) { saveMsg.value = '保存失败：' + String((e as Error)?.message || e) }
    return
  }
  try {
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 3000)
    saveMsg.value = '已下载：' + name
  } catch (e) { saveMsg.value = '下载失败：' + String((e as Error)?.message || e) }
}
</script>

<template>
  <div class="ds">
    <button class="ds__bar" :title="open ? '收起 DeepSeek 助手' : '展开 DeepSeek 助手（用设置里的 AI Key 调官方 API）'" @click="open = !open">
      <AppIcon name="ai" :size="14" />
      <span class="ds__barTxt">DeepSeek</span>
    </button>
    <section v-if="open" class="ds__body">
      <header class="ds__head">
        <span class="ds__title">DeepSeek 助手</span>
        <span class="ds__sub">{{ hasKey ? '已接 AI Key' : '未填 Key' }}</span>
        <button class="ds__btn" title="清空对话" @click="clearAll">清空</button>
        <button class="ds__btn" title="收起" @click="open = false">✕</button>
      </header>
      <div ref="listEl" class="ds__list">
        <div v-if="!msgs.length" class="ds__empty">
          问点什么试试：<br />
          「给一道考查线面平行的例题，附解析」<br />
          「把这段话改成适合板书的短句」
        </div>
        <div v-for="(m, i) in msgs" :key="i" class="ds__msg" :class="'ds__msg--' + m.role">
          <div class="ds__who">{{ m.role === 'user' ? '我' : 'AI' }}</div>
          <div class="ds__text">{{ m.text }}</div>
          <span v-if="m.role === 'ai'" class="ds__acts">
            <button class="ds__mini" title="复制这条回答" @click="copyOne(m.text)">复制</button>
            <button class="ds__mini" title="把这条回答按 Markdown 直接变成幻灯片，插到当前演示后面（公式按应用的排版口径渲染）" @click="insertToSlides(m.text)">插入幻灯片</button>
            <button class="ds__mini" title="存成 .md（桌面端存到「文档」目录，可以直接用「导入 .md 文件」核对入库）" @click="saveAnswer(m.text)">存为 .md</button>
          </span>
        </div>
        <div v-if="busy" class="ds__msg ds__msg--ai"><div class="ds__who">AI</div><div class="ds__text">正在思考…</div></div>
        <div v-if="err" class="ds__err">{{ err }}</div>
        <div v-if="saveMsg" class="ds__saved">{{ saveMsg }}</div>
      </div>
      <footer class="ds__foot">
        <div class="ds__att">
          <button class="ds__mini" title="带图片（需要端点/模型支持视觉，否则会明确报错）" @click="imgInput?.click()">＋图</button>
          <button class="ds__mini" title="带文档：PDF 在本机抽文字，MD/TXT/JSON 直接读（纯文本模型也能用）" @click="docInput?.click()">＋文档</button>
          <span v-for="(_, i) in attImgs" :key="'i' + i" class="ds__chip">图{{ i + 1 }}<em @click="dropAtt('img', i)">×</em></span>
          <span v-for="(d, i) in attDocs" :key="'d' + i" class="ds__chip" :title="d.chars + ' 字'">{{ d.name }}<em @click="dropAtt('doc', i)">×</em></span>
          <span v-if="attMsg" class="ds__hintwarn">{{ attMsg }}</span>
        </div>
        <input ref="imgInput" type="file" accept="image/*" multiple style="display:none" @change="onPickImg" />
        <input ref="docInput" type="file" accept=".pdf,.md,.markdown,.txt,.json,.csv" multiple style="display:none" @change="onPickDoc" />
        <textarea v-model="input" class="ds__ta" rows="3" placeholder="输入问题（Enter 发送，Shift+Enter 换行）" @keydown.enter.exact.prevent="send" />
        <button class="ds__send" :disabled="busy || !input.trim()" @click="send">发送</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.ds { display: flex; align-items: stretch; flex: 0 0 auto; border-left: 1px solid var(--border); background: var(--panel); }
.ds__bar { width: 40px; border: none; background: var(--panel-2, #faf9f6); color: var(--muted); cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 6px; padding-top: 12px; font-size: 11px; }
.ds__bar:hover { color: var(--brand-600, #534AB7); }
.ds__barTxt { writing-mode: vertical-rl; letter-spacing: .12em; }
.ds__body { width: 340px; display: flex; flex-direction: column; min-width: 0; }
.ds__head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--border); }
.ds__title { font-size: 13px; font-weight: 600; color: var(--text); }
.ds__sub { font-size: 11px; color: var(--muted); }
.ds__btn { margin-left: auto; height: 24px; padding: 0 8px; border: 1px solid var(--border); border-radius: 6px; background: #fff; font-size: 12px; cursor: pointer; }
.ds__btn + .ds__btn { margin-left: 4px; }
.ds__list { flex: 1; min-height: 0; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 10px; }
.ds__empty { color: var(--muted); font-size: 12px; line-height: 1.9; }
.ds__msg { display: flex; flex-direction: column; gap: 3px; }
.ds__who { font-size: 11px; color: var(--muted); }
.ds__text { font-size: 12.5px; line-height: 1.75; color: var(--text); white-space: pre-wrap; background: var(--panel-2, #faf9f6); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; }
.ds__msg--user .ds__text { background: #f1efff; border-color: #ded7ff; }
.ds__mini { align-self: flex-end; height: 22px; padding: 0 8px; border: 1px solid var(--border); border-radius: 6px; background: #fff; font-size: 11px; cursor: pointer; }
.ds__err { font-size: 12px; color: #b42318; background: #fff2f0; border: 1px solid #f0c9c4; border-radius: 8px; padding: 8px 10px; }
.ds__foot { border-top: 1px solid var(--border); padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.ds__ta { width: 100%; box-sizing: border-box; border: 1px solid var(--border); border-radius: 8px; padding: 6px 8px; font-size: 12.5px; font-family: inherit; resize: vertical; }
.ds__send { align-self: flex-end; height: 28px; padding: 0 14px; border: 1px solid var(--brand-600, #534AB7); background: var(--brand-600, #534AB7); color: #fff; border-radius: 8px; font-size: 12.5px; cursor: pointer; }
.ds__send:disabled { opacity: .5; cursor: default; }
.ds__att { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.ds__chip { display: inline-flex; align-items: center; gap: 4px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: #4a3b8f; background: #f1efff; border: 1px solid #ded7ff; border-radius: 999px; padding: 2px 8px; }
.ds__chip em { cursor: pointer; font-style: normal; color: #8a7fd0; }
.ds__hintwarn { font-size: 11px; color: #b3541e; }
.ds__acts { display: flex; gap: 6px; align-self: flex-end; }
.ds__saved { font-size: 11px; color: #2f9e63; word-break: break-all; }
</style>
