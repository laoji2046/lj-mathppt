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
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { invoke, isTauri } from '@/composables/useTauri'
import AppIcon from './AppIcon.vue'
import { pdfToMarkdown } from '@/pdf/pdfImport'
import { deckToPlainText } from '@/composables/deckToText'
import { firstUserDir, writeTextFile, pickImages, qSearch, questionBlockOf, questionTextOf, type QItem } from '@/composables/useQuestionBank'
import { markdownToDeck } from '@/composables/mdDeck'
import { attachTikzFigures, flowDeckElements, picElementItems, tikzSolver, type PicInput } from '@/composables/figureRender'
import { cropToFigure, previewToPics, type CropPreview } from '@/composables/figCrop'
import ScreenshotCapture from './ScreenshotCapture.vue'
import FigureCropDialog from './FigureCropDialog.vue'
import { runAiTool, AI_TOOLS, aiToolGuide, type AiToolCtx } from '@/composables/aiTools'
import { tikzToPlaceholders, type TikzSpec } from '@/composables/tikzFigure'
import { useDeckStore } from '@/stores/deck'
import { useLicense } from '@/composables/useLicense'
import { paperAppendSink, paperTextSink, sendToPaper } from '@/ui/paper'

const open = ref(false)
const input = ref('')
const busy = ref(false)
const err = ref('')
const listEl = ref<HTMLElement | null>(null)
const msgs = ref<{ role: 'user' | 'ai'; text: string; imgs?: string[] }[]>([])
const keyTick = ref(0)
const taEl = ref<HTMLTextAreaElement | null>(null)

/* ---- 【v1663】截图：复用应用已有的桌面截图弹窗（能选窗口、能拖选区）✓ ---- */
const shotOpen = ref(false)
/** 截完的图直接当附件（不插幻灯片 ✓ 那是 SnippetCapture 的 attach 模式 ✓） */
function onShot(url: string) {
  shotOpen.value = false
  if (!url) return
  if (attImgs.value.length >= MAX_IMG) { attMsg.value = '最多带 ' + MAX_IMG + ' 张图'; return }
  attImgs.value.push(url)
  attMsg.value = ''
  saveMsg.value = '截图已贴进对话（第 ' + attImgs.value.length + ' 张）—— 直接发送提问，或点「切图 → 幻灯片」只把图形切进当前页'
}

/** 【v1663】Ctrl+V 粘图：提示里一直写着"可粘贴截图"，但之前其实**没接** ✗ —— 现在补上 ✓
 *  （老师习惯用 Snipaste 截图，粘一下最顺手 ✓） */
async function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData && e.clipboardData.items
  if (!items) return
  let added = 0
  for (const it of Array.from(items)) {
    if (!it.type || !it.type.startsWith('image/')) continue
    const f = it.getAsFile()
    if (!f) continue
    if (attImgs.value.length >= MAX_IMG) { attMsg.value = '最多带 ' + MAX_IMG + ' 张图'; break }
    try { attImgs.value.push(await readAsDataUrl(f)); added++ } catch { attMsg.value = '粘进来的图读不出来' }
  }
  if (added) {
    e.preventDefault()
    attMsg.value = ''
    saveMsg.value = '已粘进 ' + added + ' 张图——直接发送提问，或点「切图 → 幻灯片」只把图形切进当前页'
  }
}
onMounted(() => window.addEventListener('paste', onPaste))
onBeforeUnmount(() => window.removeEventListener('paste', onPaste))

/** 【v1659】"只切图形"开关（用户要求：切图只要图形部分，题目文字不切）—— 记住上次的选择 ✓ */
const ONLY_KEY = 'lj-mathslides:fig-only'
const onlyFigure = ref(true)
try { const v = localStorage.getItem(ONLY_KEY); if (v === '0') onlyFigure.value = false } catch { /* 忽略 */ }
function toggleOnly() {
  onlyFigure.value = !onlyFigure.value
  try { localStorage.setItem(ONLY_KEY, onlyFigure.value ? '1' : '0') } catch { /* 忽略 */ }
}

/** 按开关把附件图裁成"只有图形"（认不出就原样返回 ✓），并回报每张的**结果与尺寸**（预览要用 ✓） */
async function cutFigures(pics: string[]): Promise<{ items: CropPreview[]; cropped: number; trimmed: number; kept: number }> {
  if (!onlyFigure.value || !pics.length) {
    return {
      items: pics.map((src) => ({ cut: src, cw: 0, ch: 0, raw: src, rw: 0, rh: 0, mode: 'raw' as const, why: '整张可用' })),
      cropped: 0, trimmed: 0, kept: pics.length,
    }
  }
  const items: CropPreview[] = []
  let cropped = 0, trimmed = 0
  for (const p of pics) {
    const r = await cropToFigure(p)
    // 【v1665】只去掉白边（mode=trim）也算处理过了 → 尺寸按结果图走 ✓（图片比例排版要用它 ✓）
    const useCut = r.cropped || r.mode === 'trim'
    items.push({
      cut: useCut ? r.src : p, cw: useCut ? r.w : r.ow, ch: useCut ? r.h : r.oh,
      raw: p, rw: r.ow, rh: r.oh, mode: r.mode, why: r.why,
    })
    if (r.cropped) cropped++
    else if (r.mode === 'trim') trimmed++
  }
  return { items, cropped, trimmed, kept: items.length - cropped - trimmed }
}

/** 【v1666】插入前先看一眼（用户要求）：把切好的结果摆出来，确认了才插 ✓
 *  · 不想每次都看 → 对话框里勾"以后不再问"，记住设置 ✓
 *  · 返回 null = 用户点了取消（那就什么都不插 ✓） */
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

/** 【v1658】预制对话（用户要求）：一点就把提示词填进输入框（已有内容则接在后面），附件照旧自己带 ✓ */
const PRESETS: { id: string; label: string; hint: string; text: string }[] = [
  { id: 'tex', label: '转成 LaTeX', hint: '行内 $…$、独立 $$…$$；只给结果，不要解释',
    text: '把下面的内容转成 LaTeX：行内公式用 $...$，独立公式用 $$...$$；中文、题号、选项保持原样；只给结果，不要解释。\n\n' },
  { id: 'md', label: '转成 Markdown', hint: '题干 / 选项 / 答案 / 解析分段，公式用 $…$',
    text: '把下面的内容整理成 Markdown：题干、选项、答案、解析分段，公式用 $...$；只给结果，不要解释。\n\n' },
  { id: 'fig', label: '切图插入幻灯片', hint: '只用附件原图，不让 AI 重画图形（AI 重画的常常不像）',
    text: '把附件图里的题目转成 Markdown（公式用 $...$）；图形不要用 TikZ 重画，我直接用原图插入幻灯片。\n\n' },
]
function usePreset(p: { label: string; text: string }) {
  const cur = input.value.replace(/\s+$/, '')
  input.value = cur ? cur + '\n\n' + p.text : p.text
  saveMsg.value = attImgs.value.length
    ? '已填入「' + p.label + '」：这条问题带的 ' + attImgs.value.length + ' 张图会跟着一起插进幻灯片'
    : '已填入「' + p.label + '」：把要处理的文字贴在提示词后面，或加个附件图'
  nextTick(() => { const el = taEl.value; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) } })
}

/** 【v1658】「图 → 幻灯片」：**不调 AI**，直接把当前附件图插到当前页（用户："切出图形插入幻灯片"）
 *  【v1665】按**图片自己的比例**定尺寸、在当前页的**空位上纵向排开** ——
 *    原来一律 900×560、每张只挪 24px ✗：竖长的图被框得又小又空，多张图几乎叠在同一处 ✗
 *  【v1666】插之前先弹预览让老师确认（用户要求 ✓）；取消就什么都不插 ✓
 *  【v1667】排版+成元素交给 figureRender.picElementItems（可被探针直接断言"几张就是几张" ✓） */
async function picsToSlide() {
  const pics = attImgs.value.slice(0, MAX_IMG)
  if (!pics.length) { saveMsg.value = '先在下面点「＋图」选一张（或 Ctrl+V 粘一张），再点这个'; return }
  busy.value = true
  try {
    const cut = await cutFigures(pics)
    const chosen = await askPreview(cut.items)
    if (!chosen) { saveMsg.value = '已取消，什么都没插'; return }
    const out = previewToPics(chosen)
    const items = picElementItems(out, freeArea(), 20, 'center')
    store.addElements(items)
    saveMsg.value = '已把 ' + items.length + ' 张图插到当前页' + cutNote(cut) + sizeNote(items.map((it) => it.overrides)) +
      (input.value.trim() ? '（想连题目文字一起，就用回答下面的「插入幻灯片」）' : '')
  } catch (e) { saveMsg.value = '插入失败：' + String((e as Error)?.message || e) } finally { busy.value = false }
}

/** 当前页还剩的空位（现有元素下方 → 页面底部）；已经排满就回到上面，别插到页面外看不见 ✗ */
function freeArea() {
  const d = store.deck as unknown as { width?: number; height?: number }
  const W = Number(d && d.width) || 1280, H = Number(d && d.height) || 720
  const cur = store.currentSlide as unknown as { elements?: { y?: number; h?: number }[] } | undefined
  const els = (cur && cur.elements) || []
  let y = 80
  for (const e of els) y = Math.max(y, (Number(e.y) || 0) + (Number(e.h) || 0) + 16)
  if (H - y - 24 < 240) y = 80
  return { x: 60, y, w: Math.max(320, W - 120), h: Math.max(240, H - y - 24), pageW: W, pageH: H }
}
/** 切图结果的说明（只留图形 / 只去白边 / 认不出图形整张插）✓ */
function cutNote(cut: { cropped: number; trimmed: number; kept: number }): string {
  const bits: string[] = []
  if (cut.cropped) bits.push(cut.cropped + ' 张只留了图形部分')
  if (cut.trimmed) bits.push(cut.trimmed + ' 张只去掉了白边')
  if (cut.kept) bits.push(cut.kept + ' 张认不出图形，整张插了')
  return bits.length ? '（' + bits.join('；') + '）' : ''
}
/** 插进去的实际尺寸（老师一眼就能看出图和版面配不配 ✓） */
function sizeNote(rects: { w?: number; h?: number }[]): string {
  const bits = rects.map((r) => (Number(r.w) || 0) + '×' + (Number(r.h) || 0))
  return bits.length ? '，尺寸 ' + bits.join('、') : ''
}

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
      } else if (/\.pptx$/i.test(f.name)) {
        // 【v1671】PPT：直接复用应用自己的解析器（「导入 PPT」那个功能用的就是它 ✓）
        //   动态 import：解析器不小，别拖进启动包 ✗（TopToolbar 里也是这么懒加载的 ✓）
        const { pptxToDeck } = await import('@/pptx/pptxToDeck')
        const { deck } = await pptxToDeck(new Uint8Array(await f.arrayBuffer()))
        text = deckToPlainText(deck)
      } else if (/\.ppt$/i.test(f.name)) {
        attMsg.value = f.name + ' 是老版 .ppt 格式，打不开；请在 PowerPoint 里另存为 .pptx 再发'
        continue
      } else {
        text = await f.text()
      }
      text = text.trim()
      if (!text) { attMsg.value = f.name + ' 里没抽出文字（可能是扫描件 / 纯图片的 PPT；可以把它当图片发）'; continue }
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
  // 【v1657】把这条问题的**附件原图**记在消息上 —— 插入幻灯片时要跟题目一起贴进去 ✓
  //   （用户要求：题目本来就有图，就别去重建数学图形了，直接把原图切出来一起插 ✓）
  msgs.value.push({ role: 'user', text: t + tag, imgs: imgs.slice() })
  input.value = ''
  busy.value = true
  await scrollDown()
  try {
    // 【v1669】换成"能调应用功能"的通道（通道不可用会自动退回原来的一问一答 ✓）
    const got = await askOnce(SYSTEM, userText, imgs, key)
    const text = got.text
    if (!text) err.value = '模型没有返回内容'
    else msgs.value.push({ role: 'ai', text: (got.did.length ? '（我调用了：' + got.did.join('、') + '）\n' : '') + text })
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
/** 【v1674】AI 助手属于需要序列号的功能（用户指定） */
const lic = useLicense()

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
 *  【v1652】在此之前先把 AI 顺口写的 TikZ **真译成图形**（译不出的才退回一行占位）✓
 *  【v1668】用户要求：插进**当前页**、不新建页 ✓ —— 元素摊平排到当前页已有内容下面（页面数量不变 ✓） */
async function insertToSlides(t: string, pics: string[] = []) {
  try {
    // 【v1659】先按"只切图形"把附件图裁好（用户要求：题目文字不切）✓
    const cut = pics.length ? await cutFigures(pics) : { items: [] as CropPreview[], cropped: 0, trimmed: 0, kept: 0 }
    // 【v1666】插之前先让老师看一眼切好的图形（用户要求）✓ 确认完才继续做幻灯片 ✓
    let picList: PicInput[] = []
    if (cut.items.length) {
      const chosen = await askPreview(cut.items)
      if (!chosen) { saveMsg.value = '已取消，没有插入（图形还没确认）'; return }
      picList = previewToPics(chosen)
    }
    const pre = tikzToPlaceholders(t, tikzSolver)
    // 【v1657】题目**本来就有图**（附件原图）时：直接贴原图，**不再把 TikZ 重建为数学图形** ✓
    //   （用户明确：重建出来的效果比较差；AI 那段 tikz 用原图替掉即可）
    const md = picList.length ? pre.md.replace(/^!\[\]\(tikz:\d+\)[ \t]*$/gm, '') : pre.md
    const deck = markdownToDeck(mdClean(md))
    if (!deck || !deck.slides || !deck.slides.length) { saveMsg.value = '这段内容里没有能成页的文字'; return }
    const got = attachTikzFigures(deck, picList.length ? [] : pre.specs)
    // 【v1668】★ 用户要求：插进**当前页**、不新建页 ✓（v1667 的"接在新页后面"用户不要 ✗）
    //   做法：还是走应用自己的 markdownToDeck（公式/标题/字号口径与「导入 PDF」一致 ✓），
    //   但把元素**摊平**排到当前页已有内容的下面 ✓（与题库「插入幻灯片」同一套手感 ✓）
    const area = freeArea()
    const els = flowDeckElements(deck, area, 16, area.pageW)
    // 题图接在文字元素后面（同一页 ✓ 一次选中 ✓）
    if (picList.length) {
      let y = area.y
      for (const it of els) y = Math.max(y, (Number(it.overrides.y) || 0) + (Number(it.overrides.h) || 0) + 16)
      els.push(...picElementItems(picList, { x: area.x, y, w: area.w, h: Math.max(200, area.y + area.h - y) }, 20, 'center'))
    }
    if (!els.length) { saveMsg.value = '这段内容里没有能插进去的文字'; return }
    store.addElements(els)   // 一次快照、一次选中 ✓（页面数量不变 ✓）
    saveMsg.value = '已把 ' + els.length + ' 个元素插到当前页（页面数量不变）' +
      (picList.length ? '，题图 ' + picList.length + ' 张' + cutNote(cut) + '，没再重建数学图形' : '') +
      tikzSummary(got, pre.specs, pre.fails)
  } catch (e) { saveMsg.value = '插入失败：' + String((e as Error)?.message || e) }
}
/* ---------------- 【v1669】让 AI 用上应用自己的功能 ---------------- */

/** 这一轮调过哪些功能（给老师看的一行记录 ✓） */
const toolLog = ref<string[]>([])
/** 一次提问最多来回几轮（防止模型来回调个没完 ✗） */
const MAX_TOOL_TURNS = 6

/** 工具名的中文说明（记录里显示人话，不显示 JSON ✓） */
function toolLabel(name: string, args: Record<string, unknown>): string {
  const m: Record<string, string> = {
    get_deck_state: '读课件', add_slide: '加一页', goto_slide: '翻到第 ' + String(args.page ?? '?') + ' 页',
    insert_math_figure: '插入数学图形' + (args.kind ? '（' + String(args.kind) + '）' : ''),
    insert_text: '插入文字', search_bank: '搜题库（' + String(args.query || '') + '）',
    insert_bank_question: '插入题库第 ' + String(args.id ?? '?') + ' 题',
    update_elements: '修改 ' + (Array.isArray(args.ids) ? args.ids.length : 0) + ' 个元素',
    delete_elements: '删除 ' + (Array.isArray(args.ids) ? args.ids.length : 0) + ' 个元素', undo: '撤销一步',
  }
  return m[name] || name
}

/** 给工具用的「应用能力」适配器（工具模块不认识 Pinia，全靠这里对接 ✓） */
function aiCtx(): AiToolCtx {
  const found = new Map<number, QItem>()
  return {
    deck: store.deck as unknown as AiToolCtx['deck'],
    currentIndex: store.currentIndex,
    addElements: (items) => store.addElements(items as never),
    addSlide: () => store.addSlide(),
    gotoSlide: (i) => store.gotoSlide(i),
    updateElement: (id, patch) => store.updateElement(id, patch as never),
    removeElement: (id) => store.removeElement(id),
    undo: () => store.undo(),
    // 改/删前先存撤销快照（store.updateElement / removeElement 自己不存 ✗）
    pushHistory: () => store.pushHistory(),
    bank: {
      // 搜到的题记在闭包里：insert_bank_question 直接用，不再多查一次库 ✓
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
      // 【v1691】这道题带的图（AI 把题插到试卷时要一起带过去 ✓）
      imgsOf: async (id) => {
        const it = found.get(id)
        if (!it) return []
        return (await pickImages(it)).map((im) => ({ n: im.n, src: im.src, caption: im.caption }))
      },
    },
    // 【v1691】试卷编辑：读 / 追加 / 插题（PaperModal 开着时登记的接入口 ✓；没开也能用，App 会自动打开 ✓）
    paper: {
      state: (maxChars) => {
        const readFn = paperTextSink.value
        if (!readFn) return { open: false, text: '' }
        const t = String(readFn() || '')
        return { open: true, text: t.length > maxChars ? t.slice(0, maxChars) + String.fromCharCode(10) + '…（已截断）' : t }
      },
      append: (text, pageBreak) => {
        const w = paperAppendSink.value
        if (!w) {
          sendToPaper({ text: (pageBreak ? '[分页]' + String.fromCharCode(10) : '') + text, id: 0, label: 'AI 追加' })
          return '试卷没开着，已把内容交给它（App 会自动打开试卷 ✓）'
        }
        w(text, pageBreak)
        return '已追加到试卷末尾 ✓'
      },
      insertQuestion: async (id, withAnswer) => {
        const it = found.get(id)
        if (!it) return ''
        const text = questionBlockOf(it, withAnswer, 0)
        if (!text) return ''
        const imgs = (await pickImages(it)).map((im) => ({ n: im.n, src: im.src, caption: im.caption }))
        sendToPaper({ text, id: 0, label: 'AI 插入试题 #' + id, imgs })
        return '已插进试卷 ✓' + (imgs.length ? '（配图 ' + imgs.length + ' 张 ✓）' : '')
      },
    },
  }
}

/** 带工具的对话循环：模型说要调功能 → 应用里真的执行 → 把结果还给它 → 直到它给正文 ✓ */
async function askWithTools(system: string, userText: string, imgs: string[], model: string, baseUrl: string, key: string): Promise<string> {
  const userContent: unknown = imgs.length
    ? [{ type: 'text', text: userText }, ...imgs.map((u) => ({ type: 'image_url', image_url: { url: u } }))]
    : userText
  const messages: unknown[] = [{ role: 'system', content: system + '\n\n' + aiToolGuide() }, { role: 'user', content: userContent }]
  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const r = await invoke<{ ok?: boolean; json?: unknown; error?: string }>('ai_chat_raw', {
      baseUrl, apiKey: key, body: { model, temperature: 0, messages, tools: AI_TOOLS, tool_choice: 'auto' },
    })
    if (!r || r.ok === false) throw new Error(String((r && r.error) || '工具通道调用失败'))
    const j = (r.json || {}) as { choices?: { message?: { content?: string; tool_calls?: unknown[] } }[] }
    const msg = (j.choices && j.choices[0] && j.choices[0].message) || {}
    const calls = (msg.tool_calls || []) as { id?: string; function?: { name?: string; arguments?: string } }[]
    if (!calls.length) return String(msg.content || '').trim()
    messages.push(msg)
    for (const c of calls) {
      const name = String((c.function && c.function.name) || '')
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(String((c.function && c.function.arguments) || '{}')) as Record<string, unknown> } catch { args = {} }
      const res = await runAiTool(name, args, aiCtx())
      toolLog.value.push((res.ok ? '已' : '没能') + toolLabel(name, args) + (res.ok ? '' : '（' + String(res.error) + '）'))
      messages.push({ role: 'tool', tool_call_id: c.id || '', content: JSON.stringify(res.ok ? res.result : { error: res.error }) })
    }
  }
  return '（一次提问里调用的功能太多，先停在这里；你可以再让我接着做）'
}

/** 一次提问：先走能调功能的新通道；通道不可用（老 exe / 接口不支持）就退回原来的一问一答 ✓ */
async function askOnce(system: string, userText: string, imgs: string[], key: string): Promise<{ text: string; did: string[] }> {
  // 【v1674】AI 助手属于需要序列号的功能（用户指定）→ 没激活就明确说清楚，别让它报一个看不懂的网络错 ✗
  if (!lic.licensed('ai-assistant')) throw new Error('AI 助手需要序列号才能用：点工具栏「激活 / 序列号」，把本机机器码发给我换一个号')
  toolLog.value = []
  const baseUrl = imgs.length ? visionBase() : ''
  const model = imgs.length && visionModel() ? visionModel() : 'deepseek-chat'
  try {
    const text = await askWithTools(system, userText, imgs, model, baseUrl, key)
    return { text, did: toolLog.value.slice() }
  } catch {
    const r = await invoke<{ ok?: boolean; text?: string; content?: string; error?: string }>('ai_chat', {
      baseUrl, apiKey: key, model, system, userText, images: imgs.length ? imgs : null,
    })
    if (r && r.ok === false) throw new Error(String(r.error || '调用失败'))
    return { text: String((r && (r.text || r.content)) || '').trim(), did: [] }
  }
}

/** 这条 AI 回答对应的问题带了哪些附件原图（往上找最近一条 user 消息 ✓） */
function picsOf(aiIndex: number): string[] {
  for (let i = aiIndex - 1; i >= 0; i--) {
    const m = msgs.value[i]
    if (m && m.role === 'user') return m.imgs || []
  }
  return []
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
        <span class="ds__dot" :class="{ 'ds__dot--off': !hasKey }" />
        <span class="ds__title">DeepSeek 助手</span>
        <span class="ds__pill" :class="{ 'ds__pill--warn': !hasKey }">{{ hasKey ? '已接 Key' : '未填 Key' }}</span>
        <button class="ds__ico" title="清空对话（不动幻灯片）" @click="clearAll">清空</button>
        <button class="ds__ico" title="收起" @click="open = false">✕</button>
      </header>

      <!-- 【v1658】预制对话：一点填进输入框（用户要求）✓ -->
      <div class="ds__presets">
        <button v-for="p in PRESETS" :key="p.id" class="ds__preset" :title="p.hint" @click="usePreset(p)">{{ p.label }}</button>
      </div>
      <div ref="listEl" class="ds__list">
        <div v-if="!msgs.length" class="ds__empty">
          <div class="ds__emptyT">问点什么，或点上面那三个预制对话</div>
          <ul class="ds__emptyL">
            <li>「给一道考查线面平行的例题，附解析」</li>
            <li>「把这段话改成适合板书的短句」</li>
            <li>「＋图」传一张题目截图 → 点「切图插入幻灯片」</li>
          </ul>
        </div>
        <div v-for="(m, i) in msgs" :key="i" class="ds__row" :class="'ds__row--' + m.role">
          <div class="ds__bubble">
            <div class="ds__text">{{ m.text }}</div>
            <div v-if="m.role === 'user' && (m.imgs || []).length" class="ds__pics">
              <img v-for="(s, k) in m.imgs" :key="k" :src="s" alt="附件图" />
            </div>
            <span v-if="m.role === 'ai'" class="ds__acts">
              <button class="ds__mini" title="复制这条回答" @click="copyOne(m.text)">复制</button>
              <button class="ds__mini ds__mini--main" :title="'把这条回答插到当前页' + (picsOf(i).length ? '（连上面那条问题带的 ' + picsOf(i).length + ' 张原图一起贴进去，不再重建数学图形）' : '（文字/公式按应用口径渲染，接在当前页已有内容下面）')" @click="insertToSlides(m.text, picsOf(i))">插入幻灯片</button>
              <button class="ds__mini" title="存成 .md（桌面端存到「文档」目录，可以直接用「导入 .md 文件」核对入库）" @click="saveAnswer(m.text)">存为 .md</button>
            </span>
          </div>
        </div>
        <div v-if="busy" class="ds__row ds__row--ai">
          <div class="ds__bubble ds__typing"><i /><i /><i /></div>
        </div>
        <div v-if="err" class="ds__err">{{ err }}</div>
        <div v-if="saveMsg" class="ds__saved">{{ saveMsg }}</div>
      </div>
      <footer class="ds__foot">
        <div class="ds__tools">
          <button class="ds__tool ds__tool--main" title="截屏：截完直接当附件（能选窗口 / 拖选区；也可以 Ctrl+V 粘 Snipaste 的图）" @click="shotOpen = true">截图</button>
          <button class="ds__tool" title="从文件里选图：会和题目一起插进幻灯片；也可以直接 Ctrl+V 粘贴" @click="imgInput?.click()">＋图</button>
          <button class="ds__tool" title="带文档：PDF 在本机抽文字，MD/TXT/JSON 直接读（纯文本模型也能用）" @click="docInput?.click()">＋文档</button>
          <span class="ds__toolBreak" />
          <button class="ds__tool ds__tool--main" title="不调 AI：把上面选的图切出来（只留图形），插之前先让你看一眼，再插到当前页" @click="picsToSlide">切图 → 幻灯片</button>
          <button class="ds__tool" :class="{ 'ds__tool--on': onlyFigure }"
            :title="onlyFigure ? '当前：只切图形部分（题目文字不切）—— 点一下改成整张图' : '当前：整张图都插——点一下改成只切图形'"
            @click="toggleOnly">{{ onlyFigure ? '✓ 只切图形' : '整张图' }}</button>
        </div>
        <div v-if="attImgs.length || attDocs.length || attMsg" class="ds__att">
          <span v-for="(_, i) in attImgs" :key="'i' + i" class="ds__thumb" :title="'图' + (i + 1) + '（点右上角 × 去掉）'">
            <img :src="attImgs[i]" alt="" /><em @click="dropAtt('img', i)">×</em>
          </span>
          <span v-for="(d, i) in attDocs" :key="'d' + i" class="ds__chip" :title="d.chars + ' 字'">{{ d.name }}<em @click="dropAtt('doc', i)">×</em></span>
          <span v-if="attMsg" class="ds__hintwarn">{{ attMsg }}</span>
        </div>
        <input ref="imgInput" type="file" accept="image/*" multiple style="display:none" @change="onPickImg" />
        <input ref="docInput" type="file" accept=".pdf,.pptx,.md,.markdown,.txt,.json,.csv" multiple style="display:none" @change="onPickDoc" />
        <textarea ref="taEl" v-model="input" class="ds__ta" rows="3" placeholder="输入问题…（Enter 发送，Shift+Enter 换行）" @keydown.enter.exact.prevent="send" />
        <div class="ds__footRow">
          <span class="ds__hint" title="Ctrl+V 可以直接粘贴题目截图；点「切图 → 幻灯片」只把图形切进当前页">可粘贴截图 · 「切图」只留图形部分</span>
          <button class="ds__send" :disabled="busy || !input.trim()" @click="send">{{ busy ? '发送中…' : '发送' }}</button>
        </div>
      </footer>
    </section>
    <!-- 【v1663】截图弹窗（复用应用已有的那个：桌面/窗口切换、拖选区、Esc 取消都现成 ✓） -->
    <ScreenshotCapture v-if="shotOpen" attach @close="shotOpen = false" @done="onShot" />
    <!-- 【v1666】插入前的切图预览（用户要求：切完先看一眼再插 ✓） -->
    <FigureCropDialog v-if="previewOpen" :items="previewItems" @done="onPreviewDone" />
  </div>
</template>

<style scoped>
/* 【v1658】DeepSeek 面板美化（用户要求）：气泡对话 + 预制对话条 + 附件缩略图 + 动效 ✓ */
.ds { display: flex; align-items: stretch; flex: 0 0 auto; border-left: 1px solid var(--border); background: var(--panel); }
.ds__bar { width: 40px; border: none; background: linear-gradient(180deg, #f4f2ff, var(--panel-2, #faf9f6)); color: var(--muted); cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 8px; padding-top: 14px; font-size: 11px; }
.ds__bar:hover { color: var(--brand-600, #534AB7); background: #efecff; }
.ds__barTxt { writing-mode: vertical-rl; letter-spacing: .14em; font-weight: 600; }
.ds__body { width: 356px; display: flex; flex-direction: column; min-width: 0; background: #fff; }
.ds__head { display: flex; align-items: center; gap: 7px; padding: 10px 12px; border-bottom: 1px solid var(--border); background: linear-gradient(180deg, #faf9ff, #fff); }
.ds__dot { width: 8px; height: 8px; border-radius: 50%; background: #2f9e63; box-shadow: 0 0 0 3px rgba(47, 158, 99, .14); }
.ds__dot--off { background: #d0cec6; box-shadow: 0 0 0 3px rgba(0, 0, 0, .05); }
.ds__title { font-size: 13px; font-weight: 700; color: var(--text); }
.ds__pill { font-size: 10.5px; color: #2f7d5b; background: #eafaf1; border: 1px solid #cdeedd; border-radius: 999px; padding: 1px 7px; }
.ds__pill--warn { color: #b3541e; background: #fff6ec; border-color: #f2dcc4; }
.ds__ico { margin-left: auto; height: 24px; padding: 0 8px; border: 1px solid var(--border); border-radius: 7px; background: #fff; color: var(--muted); font-size: 11.5px; cursor: pointer; }
.ds__ico + .ds__ico { margin-left: 0; }
.ds__ico:hover { color: var(--brand-600, #534AB7); border-color: #ded7ff; background: #f7f5ff; }
.ds__presets { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--border); background: #fcfcff; }
.ds__preset { height: 25px; padding: 0 10px; border: 1px solid #ded7ff; border-radius: 999px; background: #f6f4ff; color: #4a3b8f; font-size: 11.5px; cursor: pointer; }
.ds__preset:hover { background: #ece7ff; border-color: #c9bfff; }
.ds__list { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 10px; display: flex; flex-direction: column; gap: 12px; }
.ds__list::-webkit-scrollbar { width: 8px; }
.ds__list::-webkit-scrollbar-thumb { background: #e6e4dd; border-radius: 8px; }
.ds__list::-webkit-scrollbar-thumb:hover { background: #d2cfc5; }
.ds__empty { color: var(--muted); font-size: 12px; }
.ds__emptyT { font-weight: 600; color: #6b6a63; margin-bottom: 6px; }
.ds__emptyL { margin: 0; padding-left: 16px; line-height: 1.95; }
.ds__row { display: flex; }
.ds__row--user { justify-content: flex-end; }
.ds__bubble { max-width: 93%; border-radius: 12px; padding: 8px 11px; border: 1px solid var(--border); background: var(--panel-2, #faf9f6); box-shadow: 0 1px 2px rgba(20, 16, 60, .04); }
.ds__row--user .ds__bubble { background: #f1efff; border-color: #ded7ff; border-bottom-right-radius: 4px; }
.ds__row--ai .ds__bubble { border-bottom-left-radius: 4px; }
.ds__text { font-size: 12.5px; line-height: 1.78; color: var(--text); white-space: pre-wrap; word-break: break-word; }
.ds__pics { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.ds__pics img { width: 56px; height: 56px; object-fit: cover; border-radius: 6px; border: 1px solid #ded7ff; }
.ds__acts { display: flex; gap: 6px; margin-top: 7px; }
.ds__mini { height: 23px; padding: 0 9px; border: 1px solid var(--border); border-radius: 7px; background: #fff; color: #55534d; font-size: 11.5px; cursor: pointer; }
.ds__mini:hover { border-color: #ded7ff; background: #f7f5ff; color: var(--brand-600, #534AB7); }
.ds__mini--main { border-color: var(--brand-600, #534AB7); background: var(--brand-600, #534AB7); color: #fff; }
.ds__mini--main:hover { background: #463d9e; color: #fff; }
.ds__typing { display: inline-flex; gap: 4px; align-items: center; padding: 11px; }
.ds__typing i { width: 6px; height: 6px; border-radius: 50%; background: #b9b4e8; animation: dsBlink 1.1s infinite ease-in-out; }
.ds__typing i:nth-child(2) { animation-delay: .18s; }
.ds__typing i:nth-child(3) { animation-delay: .36s; }
@keyframes dsBlink { 0%, 80%, 100% { opacity: .35; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-2px); } }
.ds__err { font-size: 12px; color: #b42318; background: #fff2f0; border: 1px solid #f0c9c4; border-radius: 9px; padding: 8px 10px; }
.ds__saved { font-size: 11px; color: #2f9e63; word-break: break-all; }
.ds__foot { border-top: 1px solid var(--border); padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 7px; background: #fff; }
/* 【v1659】底部工具栏：三枚小工具 + "只切图形"开关（用户要求：美化按钮与布局）✓ */
.ds__tools { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
/* 工具栏刻意分两行：上行"怎么给图"（截图/选图/文档），下行"切图动作" ✓ —— 挤成一行会折得很难看 ✗ */
.ds__toolBreak { flex: 1 0 100%; height: 0; }
.ds__tool { height: 26px; padding: 0 10px; border: 1px solid #e6e4dd; border-radius: 8px; background: #fbfbfa; color: #55534d; font-size: 11.5px; line-height: 1; cursor: pointer; }
.ds__tool:hover { background: #fff; border-color: #ded7ff; color: var(--brand-600, #534AB7); }
.ds__tool--main { border-color: #ded7ff; background: #f4f2ff; color: #4a3b8f; font-weight: 600; }
.ds__tool--main:hover { background: #ece7ff; }
.ds__tool--on { border-color: #bfe6cf; background: #eefaf3; color: #2f7d5b; }
.ds__tool--on:hover { border-color: #9fd9b6; color: #256a4c; }
.ds__att { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.ds__thumb { position: relative; display: inline-flex; }
.ds__thumb img { width: 42px; height: 42px; object-fit: cover; border-radius: 7px; border: 1px solid #ded7ff; }
.ds__thumb em { position: absolute; right: -5px; top: -5px; width: 15px; height: 15px; line-height: 14px; text-align: center; border-radius: 50%; background: #6b5ce0; color: #fff; font-style: normal; font-size: 11px; cursor: pointer; }
.ds__chip { display: inline-flex; align-items: center; gap: 4px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: #4a3b8f; background: #f1efff; border: 1px solid #ded7ff; border-radius: 999px; padding: 2px 8px; }
.ds__chip em { cursor: pointer; font-style: normal; color: #8a7fd0; }
.ds__hintwarn { font-size: 11px; color: #b3541e; }
.ds__ta { width: 100%; box-sizing: border-box; border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; font-size: 12.5px; font-family: inherit; resize: vertical; line-height: 1.7; background: #fdfdfd; min-height: 58px; max-height: 240px; }
.ds__ta::placeholder { color: #a9a79f; }
.ds__ta:focus { outline: none; border-color: #c9bfff; box-shadow: 0 0 0 3px rgba(83, 74, 183, .10); background: #fff; }
.ds__footRow { display: flex; align-items: center; gap: 8px; }
.ds__hint { flex: 1 1 auto; min-width: 0; font-size: 10.5px; color: var(--muted); line-height: 1.4; }
.ds__send { flex: 0 0 auto; white-space: nowrap; margin-left: auto; height: 30px; padding: 0 16px; border: 1px solid var(--brand-600, #534AB7); background: var(--brand-600, #534AB7); color: #fff; border-radius: 9px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
.ds__send:hover:not(:disabled) { background: #463d9e; }
.ds__send:disabled { opacity: .5; cursor: default; }
</style>
