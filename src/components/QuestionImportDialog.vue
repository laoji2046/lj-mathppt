<script setup lang="ts">
/**
 * 试题录入（M4）：**MD / JSON / PDF(MinerU) → 校对表 → 入库**
 *
 * 流程（每一步都能人工改 ✓）：
 *   ① 选来源：.md / .json / .pdf（PDF 走 MinerU 云端识别，仅桌面端）或直接粘贴
 *   ② 解析：MD/文本走 parseQuestions；JSON 走 parseQuestionsJson（容忍三种写法）
 *   ③ 校对：逐条改 题型 / 板块 / 难度 / 年份 / 试卷名 / 答案；可勾选、可删
 *   ④ 入库：lib_save_many（Rust 事务 + 按题干去重）+ 一份体检报告
 *
 * 纪律：
 *  - **不直接写库**：任何来源都先变成校对表，老师点「入库」才落库 ✓
 *  - 解析映射与默认值全在 useQuestionImport（纯函数），这里只做界面 ✓
 *  - MinerU token 只存本机 localStorage，**绝不写进源码/仓库** ✓
 */
import { computed, nextTick, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { isTauri, listenTauri, mineruParse, mineruStagePdf } from '@/composables/useTauri'
import type { MineruProgress } from '@/composables/useTauri'
import { assembleContentDoc, blockGeometry, imagePositions } from '@/composables/contentDoc'
import {
  attachOrphans,
  dispNoOf,
  figLabelOf,
  imagesForText,
  linkMineruImages,
  questionTextOf,
} from '@/composables/mineruImages'
import { assetSrc, loadAssets } from '@/composables/useAssets'
import { firstUserDir, writeTextFile } from '@/composables/useQuestionBank'
import type { MineruRawImage } from '@/composables/mineruImages'
import type { QuestionImage } from '@/composables/parseQuestions'
import { setContentList } from '@/composables/parseQuestions'
import type { ParsedQuestion } from '@/composables/parseQuestions'
import {
  importParsedQuestions, metaOfParsed, draftFromMeta,
  parseAnyMarkdown, parseAnyJson, parseVaultMarkdownMany, toVaultMarkdown,
} from '@/composables/useQuestionImport'
import { SECTIONS, QTYPE_LABEL, qFacets, stemPreviewText, importBegin, importAddDrafts, idemKeyOf, matchStems } from '@/composables/useQuestionBank'
import { typesetHosts } from '@/composables/useMathJax'
import { escapeHtml, normalizeMixed } from '@/types'

const emit = defineEmits<{ (e: 'close'): void; (e: 'imported', n: number): void }>()

interface Row { on: boolean; q: ParsedQuestion }

const text = ref('')
const rows = ref<Row[]>([])
const busy = ref(false)
const msg = ref('')
/** 【v1531】常驻提示：解析失败的原因要**留在屏幕上**（flash 只闪 3 秒，用户根本看不到 ✗）——
 *  用户报「json 导入后解析不出来」「不知道提示在哪里」都是这个原因 ✓ */
const note = ref('')
const report = ref('')
const detected = ref({ year: '', paperName: '', from: '' })
const batchYear = ref('')
const batchPaper = ref('')
const totalInBank = ref(0)

/** 本批次（一次 MinerU 识别）的插图表：编号 N 对应正文里的 [图N]，入库时**按题拆开** ✓ */
const pendingImages = ref<QuestionImage[]>([])
/** 【v1451】兜底归属要用：装配后的正文 + 每个图号在正文里的位置 ✓ */
const pendingText = ref('')
const pendingMarks = ref<Record<number, number>>({})
/** 【v1454】几何：图号 → {页, y}，以及正文块的几何序列（按位置归属图要用 ✓） */
const pendingGeo = ref<{ where: Record<number, { page: number; y: number }>; blocks: { head: string; page: number; y: number }[] } | null>(null)

const fileInput = ref<HTMLInputElement | null>(null)
const fileMode = ref<'md' | 'json' | 'pdf'>('md')

const MINERU_TOKEN_KEY = 'lj-mathslides:mineru-token'
const mineruToken = ref('')
try { mineruToken.value = localStorage.getItem(MINERU_TOKEN_KEY) || '' } catch { /* 隐私模式忽略 */ }
watch(mineruToken, (v) => {
  try {
    const t = (v || '').trim()
    if (t) localStorage.setItem(MINERU_TOKEN_KEY, t)
    else localStorage.removeItem(MINERU_TOKEN_KEY)
  } catch { /* 忽略 */ }
})
const mineruBusy = ref(false)
const mineruProg = ref('')
const isDesktop = isTauri()

const onCount = computed(() => rows.value.filter((r) => r.on).length)
const allOn = computed(() => rows.value.length > 0 && rows.value.every((r) => r.on))
const noSourceCount = computed(() => rows.value.filter((r) => r.on && !String(r.q.year || '').trim() && !String(r.q.paperName || '').trim()).length)
const noAnswerCount = computed(() => rows.value.filter((r) => r.on && !String(r.q.answer || '').trim()).length)
const noOptsCount = computed(() => rows.value.filter((r) => r.on && (r.q.qtype === 'choice' || r.q.qtype === 'multi') && !(r.q.options || []).length).length)

function flash(t: string, ms = 3200) {
  msg.value = t
  window.setTimeout(() => { if (msg.value === t) msg.value = '' }, ms)
}
/** 失败 / 需要用户知道的事：**常驻**在右侧面板，直到下一次成功解析 ✓ */
function fail(t: string) {
  note.value = t
  flash('✗ ' + t, 8000)
}
function errText(e: unknown): string {
  if (typeof e === 'string') return e
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message?: unknown }).message)
  return String(e)
}

/* ---------------- ① 选来源 ---------------- */

/** File → 纯 base64（去掉 data URL 前缀）—— 给「.md + 图」那条路用 ✓ */
function fileB64(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => rej(new Error('读图失败'))
    r.readAsDataURL(f)
  })
}

function pickFile(mode: 'md' | 'json' | 'pdf') {
  if (mode === 'pdf' && !isDesktop) { flash('PDF 识别要桌面端内核（MinerU 接口 + 落盘）：请打开桌面端 LJ-MathSlides'); return }
  fileMode.value = mode
  const el = fileInput.value
  if (!el) return
  el.accept = mode === 'json' ? '.json,application/json'
    : mode === 'pdf' ? '.pdf,application/pdf'
    : '.md,.markdown,.txt,text/plain'
  el.multiple = mode !== 'pdf'   // 题库目录是一道题一个 .md → 允许一次选一批 ✓
  el.value = ''
  el.click()
}

async function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files ? (Array.prototype.slice.call(input.files) as File[]) : []
  if (!files.length) return
  if (fileMode.value === 'pdf') { await importPdfToBatch(files[0]); return }
  pendingImages.value = []   // 选文件/粘贴：不带上一批 MinerU 的图
  // 【v1531】MinerU 导出的是一份 .md + 同级 images/ 目录 —— 两种选法要分清：
  //   ① 只选 .md            → 图带不进来（要**明说**，别留一堆 ![](images/…) 在题干里 ✗）
  //   ② .md + images 里的图 → 走 MinerU 那条同一套「图号」机制，图能绑到题上 ✓
  const IMG_RE = /\.(jpe?g|png|webp|gif|bmp)$/i
  const imgFiles = files.filter((f) => IMG_RE.test(f.name))
  const docFiles = files.filter((f) => !IMG_RE.test(f.name))
  if (fileMode.value === 'md' && imgFiles.length) {
    const raw: MineruRawImage[] = []
    for (const f of imgFiles) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
      try { raw.push({ path: rel, mime: f.type || undefined, dataBase64: await fileB64(f) }) } catch { /* 单张读失败不影响其它 */ }
    }
    const texts: string[] = []
    for (const f of docFiles) { try { texts.push(await f.text()) } catch { /* 同上 */ } }
    const linked = linkMineruImages(texts.join('\n\n'), raw)
    pendingImages.value = linked.images
    pendingMarks.value = linked.marks
    pendingText.value = linked.text
    if (!linked.text.trim()) { flash('这批文件里没有能读的 .md'); return }
    parseMd(linked.text, '已读入 ' + docFiles.length + ' 个 .md + ' + raw.length + ' 张图（认领 ' + linked.images.length + ' 处引用）')
    return
  }
  // 一次选了一批 .md（题库目录：一道题一个文件）→ 逐个解析后合并 ✓
  if (fileMode.value === 'md' && docFiles.length > 1) {
    const texts: string[] = []
    for (const f of docFiles) { try { texts.push(await f.text()) } catch { /* 单个读失败不影响其它 */ } }
    text.value = texts.join('\n\n')
    const r = parseVaultMarkdownMany(texts)
    if (!r.list.length) { flash('这 ' + docFiles.length + ' 个文件里没解析出题目（需要 YAML front-matter + ## 题目）'); return }
    loadRows(r.list, '已读入 ' + docFiles.length + ' 个 .md 文件' + (r.failed ? '（' + r.failed + ' 个没认出来）' : ''))
    return
  }
  let t = ''
  try { t = await files[0].text() } catch { flash('读文件失败'); return }
  text.value = t
  if (fileMode.value === 'json') parseJson(t, '已读入 ' + files[0].name + '（JSON）')
  else {
    parseMd(t, '已读入 ' + files[0].name + '（' + t.length + ' 字）')
    // 【v1531】只有 .md、没带图：明说缺了几处图（把 images 里的图一起选中就能进来）✓
    const miss = (t.match(/!\[[^\]]*\]\(/g) || []).length
    if (miss) setTimeout(() => flash('提示：正文里还有 ' + miss + ' 处图片引用没带图 —— 把同级 images 文件夹里的图**一起选中**再导入即可'), 80)
  }
}

/* ---------------- ② 解析 ---------------- */

async function loadRows(list: ParsedQuestion[], tip: string) {
  // 【v1531】JSON 里的图常常只有 assetId（题库导出的就是这种）→ 先 hydrate 成 data URL，
  //   否则校对表上「图绑上了却显示不出来」✗（这一条是「JSON 试卷导入」要补的）
  const ids = new Set<number>()
  for (const q of list) for (const im of q.images || []) if (!im.src && im.assetId) ids.add(im.assetId)
  if (ids.size) {
    try { await loadAssets(Array.from(ids)) } catch { /* 读不到就空着，不挡导入 */ }
    for (const q of list) for (const im of q.images || []) if (!im.src && im.assetId) im.src = assetSrc(im.assetId)
  }
  // MinerU 的插图：整卷共用一个表，**按题拆**（不能让第 3 题背上整卷的图 ✗）
  let orphans: number[] = []
  if (pendingImages.value.length) {
    for (const q of list) {
      const imgs = imagesForText(questionTextOf(q), pendingImages.value)
      if (imgs.length) q.images = imgs
    }
    // 【v1451 修】没被任何题引用的图 → 按位置兜底挂到最近的一道题并标 warn，**不许静默丢** ✓
    orphans = attachOrphans(pendingText.value, list, pendingImages.value, pendingMarks.value, pendingGeo.value || undefined).orphans
  }
  rows.value = list.map((q) => ({ on: true, q }))
  report.value = ''
  note.value = ''   // 【v1531】解析成功 → 常驻提示清掉 ✓
  const bound = list.filter((q) => (q.images || []).length).length
  const imgNote = pendingImages.value.length
    ? '，图 ' + pendingImages.value.length + ' 张（绑到 ' + bound + ' 道' + (orphans.length ? '，其中 ' + orphans.length + ' 张没找到所属题、已按位置兜底请核对' : '') + '）'
    : ''
  flash(tip + '：识别出 ' + list.length + ' 道' + imgNote + ' —— 请核对后点「入库」')
  void renderCardStems()
  void renderCardFigures()
}

/** 卡片题数上限：超过就不跑 MathJax（纯文本已保留公式，不至于卡） */
const STEM_MATH_MAX = 120

/**
 * 【v1455】把校对表每张卡**该题的图**画出来 —— 核对阶段就要能看见图（归属对不对一眼便知 ✓）
 * ⚠ 图此时还是 data URL（入库前没转资源），直接塞 src 即可；
 *   放在**独立容器** .qi__figs 里，MathJax 那一遍（会重写 .qi__stem）不会把它冲掉 ✓
 */
/** 【v1458】校对卡片上的图也能点开放大（卡片窄，默认只给缩略图 ✓） */
function onFigClick(e: MouseEvent) {
  const t = e.target as HTMLElement | null
  if (!t || t.tagName !== 'IMG') return
  const fig = t.closest('.qi__fig')
  if (fig) fig.classList.toggle('qi__fig--zoom')
}

async function renderCardFigures() {
  // 【v1531】必须等 Vue 把卡片渲染出来 —— 少了这一行，`loadRows` 紧接着调用时
  //   `.qi__figs` 还一个都不存在 → 图**绑上了却不显示**（实测：提示写着「图 11 张（绑到 9 道）」，
  //   卡片里却一张也看不见 ✗）。renderCardStems 一直有 nextTick，这里以前漏了。
  await nextTick()
  const hosts = Array.from(document.querySelectorAll<HTMLElement>('.qi__figs'))
  const list = rows.value
  const e = (t: unknown) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  hosts.forEach((h, i) => {
    const q = i < list.length ? list[i].q : null
    const imgs = (q && q.images) || []
    h.innerHTML = imgs
      .map((im, k) => {
        const src = String(im.src || '')
        if (!src) return ''
        // 【v1457】题内图号：图注写了「图一/(图2)」就照图注 ✓
        const label = figLabelOf(im, dispNoOf(im, k))
        return '<figure class="qi__fig"><img src="' + e(src) + '" alt="' + e(label) + '" /><figcaption>' + e(label) + '</figcaption></figure>'
      })
      .join('')
  })
}
/**
 * 把校对表每张卡的题干渲染出来 —— **必须保留公式** ✓
 *   ① 先落纯文本（$…$ 原样可见）→ 即使 MathJax 失败也不是空白；
 *   ② 再统一交给 MathJax（typesetHosts 只排版、不写内容，一次排一批 ✓）
 * ⚠ 内容由本函数写，模板里不要再绑 {{ }} —— 否则任意响应式变化都会把渲染结果冲掉 ✗
 */
async function renderCardStems() {
  await nextTick()
  const hosts = Array.from(document.querySelectorAll<HTMLElement>('.qi__stem'))
  const list = rows.value
  hosts.forEach((h, i) => {
    h.textContent = i < list.length ? stemPreviewText(list[i].q.stem) : ''
  })
  if (!hosts.length || hosts.length > STEM_MATH_MAX) return
  hosts.forEach((h, i) => {
    const stem = i < list.length ? String(list[i].q.stem || '') : ''
    h.innerHTML = normalizeMixed(escapeHtml(stemPreviewText(stem)))
    h.classList.add('fx-mixed-host')
  })
  try {
    await typesetHosts(hosts)
  } catch {
    /* 渲染失败就保留上面已写好的纯文本（公式原样可见），不影响校对 ✓ */
  }
}

/** 删一行：行数变了，索引要按 DOM 顺序重排（渲染是「DOM 顺序 ↔ rows」对齐的 ✓） */
function removeRow(i: number) {
  rows.value.splice(i, 1)
  void renderCardStems()
  void renderCardFigures()
}

function parseMd(raw: string, prefix = '') {
  if (!raw.trim()) { flash('没有可解析的内容'); return }
  busy.value = true
  try {
    const r = parseAnyMarkdown(raw)
    detected.value = r.detected
    if (!r.list.length) { fail('没切出题目 —— 通用格式要「1. 2. 3.」题号；题库单题格式要有 YAML front-matter + ## 题目'); return }
    if (r.detected.year || r.detected.paperName) {
      batchYear.value = r.detected.year || ''
      // 【优化】多卷合一的 PDF：每题已经带了自己那份卷的卷名 →
      //   **不要**拿第一份的名字去预填「批量填来源」，否则用户一点就把 4 份卷盖成一份 ✗
      const papers = new Set(r.list.map((q) => String(q.paperName || '').trim()).filter(Boolean))
      batchPaper.value = papers.size > 1 ? '' : (r.detected.paperName || '')
    }
    const how = r.mode === 'vault' ? '题库单题格式' : '通用切题'
    loadRows(r.list, (prefix ? prefix + '；' : '') + how + '解析完成' + (r.mode === 'text' && r.skipped ? '（过滤说明行 ' + r.skipped + '）' : ''))
  } finally {
    busy.value = false
  }
}

function parseJson(raw: string, prefix = '') {
  if (!raw.trim()) { fail('没有可解析的内容'); return }
  pendingImages.value = []
  // 【v1531】先自己判一次「这到底是不是完整 JSON」——用户看到的提示要能指路 ✓
  const head = raw.trim().slice(0, 40).replace(/\s+/g, ' ')
  let parsed: unknown = null
  try { parsed = JSON.parse(raw) } catch {
    const cut = !/^\s*[[{]/.test(raw)
    fail(cut
      ? '这段不是完整的 JSON —— 看着像是从中间截出来的（开头是「' + head + '…」）。请粘贴完整内容，或用「导入 .json 文件」直接选文件。'
      : '这段不是合法的 JSON（开头是「' + head + '…」）—— 检查括号是否配对，或用「导入 .json 文件」直接选文件。')
    return
  }
  // OCR 版面数据（PaddleOCR / PP-Structure 之类）：type + lines/bbox，里面没有题干/答案字段 ✗
  const isLayout = (v: unknown): boolean => {
    const arr = Array.isArray(v) ? v : (v && typeof v === 'object' ? [v] : [])
    if (!arr.length) return false
    const o = arr[0] as Record<string, unknown>
    return !!o && typeof o === 'object' && (Array.isArray(o.lines) || Array.isArray(o.bbox) || (typeof o.type === 'string' && (o.angle !== undefined || o.lines !== undefined)))
  }
  if (isLayout(parsed)) {
    fail('这是 OCR 的版面数据（type / lines / bbox），里面只有坐标和文字块，没有题干/答案字段 —— 要先转成题目 JSON（可以让 AI 按「高中数学试题录入解析提示词」转），或者直接用「导入 .pdf（MinerU）」识别 PDF。')
    return
  }
  const r = parseAnyJson(raw)
  if (r.error) { fail('导入 JSON 失败：' + r.error); return }
  const first = r.list[0]
  detected.value = { year: String(first.year || ''), paperName: first.paperName || '', from: r.mode }
  loadRows(r.list, (prefix ? prefix + '；' : '') + (r.mode === 'ai' ? 'AI 结构化 JSON' : '题库 JSON') + '解析完成')
}

// 记下这次的来源类型：存草稿时写进批次 sourceType，幂等键也跟着它变 ✓
function doParseMd() { fileMode.value = 'md'; pendingImages.value = []; parseMd(text.value) }
function doParseJson() { fileMode.value = 'json'; parseJson(text.value) }

/* ---------------- ③ 校对 ---------------- */

function toggleAll() { const v = !allOn.value; rows.value.forEach((r) => { r.on = v }) }
/**
 * 【规范】把校对过的题导出成**规范 MD**（一道题一个 front-matter 块，可直接再导入 ✓）
 *   老师手上任意来源的 md 都能先核一遍再落成这个格式 —— 以后所有题都长一样，导入结果可预期 ✓
 */
async function doExportNormMd() {
  const list = rows.value.filter((r) => r.on).map((r) => r.q)
  if (!list.length) { flash('先勾选要导出的题'); return }
  const paper = batchPaper.value.trim() || detected.value.paperName || ''
  const text = toVaultMarkdown(list, { paper })
  const dir = await firstUserDir('导出规范 MD')
  if (!dir) { flash('没选目录（已取消）'); return }
  const w = await writeTextFile(dir, (paper || '题库规范') + '（规范）.md', text)
  flash(w.ok ? '✓ 规范 MD 已写出：' + w.path : '✗ ' + (w.error || '写入失败'))
}

function applyBatchSource() {
  const y = batchYear.value.trim()
  const p = batchPaper.value.trim()
  if (!y && !p) return
  rows.value.forEach((r) => {
    if (y) r.q.year = y
    if (p) r.q.paperName = p
  })
  flash('已把来源套到 ' + rows.value.length + ' 道（年份 ' + (y || '-') + ' · 试卷名 ' + (p || '-') + '）')
}

/* ---------------- ④ 入库 ---------------- */

async function doImport() {
  const picked = rows.value.filter((r) => r.on).map((r) => r.q)
  if (!picked.length) { flash('先勾选要入库的题'); return }
  if (noSourceCount.value > 0) {
    const ok = window.confirm('有 ' + noSourceCount.value + ' 道没有年份/试卷名（来源）—— 以后按来源就找不回来。仍要入库吗？')
    if (!ok) return
  }
  busy.value = true
  try {
    const res = await importParsedQuestions(picked)
    let noAns = 0
    let noOpts = 0
    let noSec = 0
    let noYear = 0
    for (const p of picked) {
      const m = metaOfParsed(p)
      if (!m.answer) noAns++
      if ((m.qtype === 'choice' || m.qtype === 'multi') && !m.options.length) noOpts++
      if (!m.section) noSec++
      if (!m.year) noYear++
    }
    const fc = await qFacets()
    totalInBank.value = fc.total
    report.value = [
      '入库 ' + res.added + ' 道' + (res.skipped ? '，跳过重复 ' + res.skipped + ' 道' : ''),
      '本次缺口：缺答案 ' + noAns + ' · 0 选项 ' + noOpts + ' · 未归类 ' + noSec + ' · 无年份 ' + noYear,
      '库内合计：' + fc.total + ' 道（缺答案 ' + fc.missing.answer + ' · 缺知识点 ' + fc.missing.kp + ' · 未归类 ' + fc.missing.section + '）',
    ].join('\n')
    flash('✓ 已入库 ' + res.added + ' 道' + (res.skipped ? '（跳过重复 ' + res.skipped + '）' : ''))
    emit('imported', res.added)
    if (res.added) rows.value = []
  } finally {
    busy.value = false
  }
}

/* ---------------- ④b 先存草稿（v5 · P1b）：**不写正式库**，等草稿箱人工确认 ✓ ---------------- */

async function doSaveDrafts() {
  const picked = rows.value.filter((r) => r.on).map((r) => r.q)
  if (!picked.length) { flash('先勾选要存草稿的题'); return }
  busy.value = true
  try {
    // 批次名：优先用「批量填来源」里填的，其次取第一道题自己的试卷名 ✓
    let label = batchPaper.value.trim()
    if (!label) {
      for (const p of picked) {
        const m = metaOfParsed(p)
        if (m.paperName) { label = m.paperName; break }
      }
    }
    if (!label) label = '未命名来源'
    // 幂等键：同一份文本 + 同一解析方式 → 同一个键（重复点不会重复建批次 ✓）
    const key = idemKeyOf(fileMode.value === 'json' ? 'json' : 'md', text.value)
    const b = await importBegin({ sourceType: fileMode.value, sourceLabel: label, idemKey: key })
    if (!b.ok || !b.batch) { flash('✗ ' + (b.error || '开批次失败')); return }
    const drafts = picked.map((p, i) => draftFromMeta(metaOfParsed(p), '第 ' + (i + 1) + ' 题', 'q' + (i + 1)))
    const r = await importAddDrafts(b.batch.id, drafts, drafts.length)
    if (!r.ok) { flash('✗ ' + (r.error || '存草稿失败')); return }
    report.value = [
      (b.reused ? '命中已有批次（幂等，没重复建）' : '新批次') + '：' + b.batch.id,
      '存草稿 ' + r.added + ' 条，其中 ' + r.needReview + ' 条被质量闸门拦下（待复核）',
      '到「试题库 → 草稿箱」逐条看告警、改好、确认后再入库 ✓',
    ].join('\n')
    flash('✓ 已存 ' + r.added + ' 条草稿' + (r.needReview ? '（' + r.needReview + ' 条待复核）' : ''))
  } finally {
    busy.value = false
  }
}

/* ---------------- 【v1452】给已有题补图（不新建题，只 patch images） ---------------- */

/** 把这些图补到**已有的题**上：按题干找对应题 → targetQid → 只 patch images（正式库题数不变 ✓） */
async function doPatchImages() {
  const withImg = rows.value.filter((r) => r.on && (r.q.images || []).length > 0)
  if (!withImg.length) { flash('勾选的行里没有带图的 —— 补图只对「有图」的行有意义'); return }
  busy.value = true
  try {
    const m = await matchStems(withImg.map((r) => String(r.q.stem || '')))
    const hit = m.filter((x) => x.qid > 0)
    if (!hit.length) { flash('这 ' + withImg.length + ' 道带图的题在库里没找到对应题（可能还没入库过）'); return }
    const key = idemKeyOf('patchimg', hit.map((x) => x.qid).join(',') + '|' + withImg.length)
    const b = await importBegin({ sourceType: 'patch_images', sourceLabel: '给已有题补图 ' + hit.length + ' 道', idemKey: key })
    if (!b.ok || !b.batch) { flash('✗ ' + (b.error || '开批次失败')); return }
    const drafts = hit.map((x) => {
      const q = metaOfParsed(withImg[x.index].q)
      return {
        sourceItemId: 'q' + x.qid,
        sourceLabel: '已有 #' + (x.code || x.qid) + '（' + (x.how === 'exact' ? '题干一致' : '题干前段一致') + '）',
        targetQid: x.qid,
        stem: q.stem,
        options: q.options,
        answer: q.answer,
        solution: q.solution,
        paper: q.paperName,
        extra: JSON.stringify({ patch: ['images'], images: q.images, from: 'MinerU 补图' }),
      }
    })
    const r = await importAddDrafts(b.batch.id, drafts, drafts.length)
    if (!r.ok) { flash('✗ ' + (r.error || '存补图草稿失败')); return }
    const exact = hit.filter((x) => x.how === 'exact').length
    report.value = [
      (b.reused ? '命中已有批次（幂等）' : '新批次') + '：' + b.batch.id,
      '带图 ' + withImg.length + ' 道 → 找到已有题 ' + hit.length + ' 道（题干一致 ' + exact + ' / 前段一致 ' + (hit.length - exact) + '）',
      '去「试题库 → 草稿箱」确认 → 「确认入库」：只改图，**题数不变** ✓',
    ].join('\n')
    flash('✓ 已存 ' + r.added + ' 条补图草稿 —— 去「草稿箱」确认')
  } finally {
    busy.value = false
  }
}
/* ---------------- PDF：MinerU（HTTP 在 Rust 侧发；网页端直连被 CORS 挡） ---------------- */

async function importPdfToBatch(f: File) {
  if (!isDesktop) { flash('PDF 识别要桌面端内核（MinerU 接口 + 落盘）：请打开桌面端 LJ-MathSlides'); return }
  if (mineruBusy.value) { flash('上一次识别还没结束，请稍候…'); return }
  mineruBusy.value = true
  mineruProg.value = '正在暂存 PDF…'
  try {
    const path = await mineruStagePdf(f)
    mineruProg.value = ''
    // ⚠ 必须先把 busy 放掉：runMineru 开头也有「忙就返回」的守卫
    mineruBusy.value = false
    await runMineru(path)
  } catch (e) {
    mineruBusy.value = false
    mineruProg.value = ''
    flash('暂存 PDF 失败：' + errText(e))
  }
}

async function runMineru(pdfPath: string) {
  if (mineruBusy.value) { flash('正在识别，请稍候…'); return }
  const token = mineruToken.value.trim()
  const mode: 'precise' | 'agent' = token ? 'precise' : 'agent'
  mineruBusy.value = true
  mineruProg.value = mode === 'precise' ? '正在上传 PDF（精准解析）…' : '正在上传 PDF（轻量接口）…'
  const ZH: Record<string, string> = {
    submitting: '① 提交任务', waiting_file: '① 等待上传', uploading: '② 上传中',
    pending: '③ 排队中', running: '③ 解析中', parsing: '③ 解析中', converting: '③ 转换中',
    downloading: '④ 下载结果', extracting: '④ 解压中', done: '⑤ 完成', failed: '失败',
  }
  const unlisten = await listenTauri<MineruProgress>('mineru://progress', (p) => {
    if (!p || !p.state) return
    let line = 'MinerU ' + (ZH[p.state] || p.state)
    if (p.extractedPages != null) line += ' ' + p.extractedPages + '/' + (p.totalPages ?? '?') + ' 页'
    if (p.seconds != null) line += ' · 已 ' + p.seconds + 's'
    mineruProg.value = line
  })
  try {
    const r = await mineruParse(pdfPath, token, mode)
    const md = r?.mdText || ''
    if (!md.trim()) throw new Error('MinerU 没有返回 Markdown 内容')
    // 正文里的 ![](images/x.jpg) → [图N]；图（Rust 读成 base64）随题入库（题库不存磁盘路径 ✓）
    // 优先用 content_list + bbox 列检测装配的正文（双栏卷会重排成「先左后右」✓），退回 contentText，再退回 md
    const doc = (r?.contentJson ? assembleContentDoc(String(r.contentJson)) : '').trim()
      || String(r?.contentText || '').trim() || md
    const linked = linkMineruImages(doc, r?.images)
    setContentList(doc)
    pendingImages.value = linked.images
    pendingMarks.value = linked.marks
    pendingText.value = linked.text
    // 【v1454】从 content_list 取几何：图号 → 该图所在 (页, y)；以及正文块的几何序列 ✓
    const cj = String(r?.contentJson || '')
    const pos = imagePositions(cj)
    const where: Record<number, { page: number; y: number }> = {}
    for (const k of Object.keys(linked.paths || {})) {
      const p = pos[linked.paths[Number(k)]]
      if (p) where[Number(k)] = p
    }
    pendingGeo.value = { where, blocks: blockGeometry(cj) }
    text.value = linked.text
    // 【v1457】契约告警要说给用户听（4.0 新契约 / 只有 V2 / 轻量接口没有图）—— 不静默 ✓
    const cw = String(r?.contract?.warn || '')
    parseMd(
      linked.text,
      'MinerU 识别完成（' + (r.seconds ?? '?') + 's / ' + (r.pages || '?') + ' 页，插图 ' + linked.images.length + ' 张）' + (cw ? ' ⚠ ' + cw : ''),
    )
    mineruProg.value = '✓ ' + (mode === 'precise' ? '精准解析' : '轻量接口') + ' 完成，已填进校对表'
  } catch (e) {
    const m = errText(e)
    mineruProg.value = '✗ ' + m
    flash('MinerU 识别失败：' + m)
  } finally {
    mineruBusy.value = false
    unlisten()
  }
}

function optsText(o: string[]): string {
  return o.map((s, i) => 'ABCDEFGH'[i] + '．' + String(s).slice(0, 40)).join('   ')
}
</script>

<template>
  <div class="qi" @click.self="emit('close')">
    <div class="qi__box">
      <header class="qi__head">
        <span class="qi__title">试题录入</span>
        <span class="qi__sub">MD / JSON / PDF → 先核对，再入库</span>
        <span v-if="msg" class="qi__msg">{{ msg }}</span>
        <button class="qi__close" title="关闭 (Esc)" @click="emit('close')"><AppIcon name="close" :size="13" /></button>
      </header>

      <!-- 【v1531】浏览器预览的边界，一次说清：PDF 识别 / 草稿箱 / 真实题库三样都要桌面端内核 -->
      <div v-if="!isDesktop" class="qi__preview">
        <b>浏览器预览</b>：PDF 识别走的是桌面端内核里的 MinerU 接口（网页端直连被 CORS 挡），草稿箱、真实题库同样要内核 ——
        所以这三样在预览里是灰的。这里入库的题只进浏览器<b>预览库</b>（localStorage，刷新还在，清缓存 / 换浏览器就没了）。
        要试完整功能请打开桌面端 <b>LJ-MathSlides</b>；预览里可以用「粘贴 MD / JSON」，解析逻辑跟桌面端是同一份代码。
      </div>

      <div class="qi__body">
        <section class="qi__src">
          <div class="qi__t1">① 选来源</div>
          <div class="qi__btnrow">
            <button class="qi__btn qi__btn--main" @click="pickFile('md')">导入 .md 文件</button>
            <button class="qi__btn" @click="pickFile('json')">导入 .json 文件</button>
            <button
              class="qi__btn" :disabled="!isDesktop"
              :title="isDesktop ? '选一个 PDF，走 MinerU 识别成 Markdown + 图，再核对入库' : 'PDF 识别要桌面端内核（MinerU 接口在 Rust 侧发，网页端直连会被 CORS 挡）—— 请打开桌面端 LJ-MathSlides；预览里可以粘贴 MD / JSON'"
              @click="pickFile('pdf')"
            >{{ isDesktop ? '导入 .pdf（MinerU）' : '导入 .pdf（需桌面端）' }}</button>
          </div>
          <label class="qi__lab">MinerU token（可选，只存本机）
            <input v-model="mineruToken" class="qi__inp" type="password" autocomplete="off" spellcheck="false" placeholder="不填 → 免登录轻量接口（只出 Markdown）" />
          </label>
          <div v-if="mineruProg" class="qi__prog">{{ mineruProg }}</div>

          <div class="qi__t1">或直接粘贴</div>
          <textarea v-model="text" class="qi__ta" rows="7" placeholder="粘贴 Markdown / 纯文本（题干、选项、答案、解析…），或粘贴 JSON"></textarea>
          <div class="qi__btnrow">
            <button class="qi__btn qi__btn--main" :disabled="busy || !text.trim()" @click="doParseMd">按 Markdown 解析</button>
            <button class="qi__btn" :disabled="busy || !text.trim()" @click="doParseJson">按 JSON 解析</button>
            <button class="qi__btn" :disabled="!text" @click="text = ''">清空</button>
          </div>
          <div class="qi__hint">
            三种写法都认：<br />
            ① <b>通用切题</b>：<b>1.</b> / <b>2、</b> 开头；【答案】【解析】【知识点】【题型】【年份】【试卷】自动读入<br />
            ② <b>题库单题格式</b>：YAML front-matter + <b>## 题目 / ## 选项 / ## 答案 / ## 解析</b>（可一次选一批 .md）<br />
            ③ <b>AI 结构化 JSON</b>：<b>{ paper, questions:[…] }</b>（「高中数学试题录入解析提示词」的输出格式）
          </div>
        </section>

        <section class="qi__review">
          <div class="qi__t1">② 核对（可直接改题型 / 板块 / 年份 / 试卷名 / 答案）</div>
          <div v-if="note" class="qi__note">{{ note }}</div>
          <div v-if="!rows.length" class="qi__empty">左边导入或粘贴 → 识别结果出现在这里</div>
          <template v-else>
            <div class="qi__bar">
              <label class="qi__chk"><input type="checkbox" :checked="allOn" @change="toggleAll" />全选（{{ rows.length }} 道）</label>
              <span class="qi__picked">已勾 {{ onCount }} 道</span>
              <input v-model="batchYear" class="qi__mini" placeholder="年份" />
              <input v-model="batchPaper" class="qi__mini qi__mini--wide" placeholder="试卷名 / 来源" />
              <button class="qi__btn" :disabled="!batchYear.trim() && !batchPaper.trim()" @click="applyBatchSource">批量填来源</button>
              <button class="qi__btn" title="把勾选的题导出成**规范格式**的 Markdown（一道题一个 front-matter 块，可再导入、可当模板）" @click="doExportNormMd">导出规范 MD</button>
            </div>
            <div v-if="detected.year || detected.paperName" class="qi__hint">原文里认出：{{ detected.year }} {{ detected.paperName }}（点「批量填来源」套用）</div>
            <div class="qi__list">
              <div v-for="(r, i) in rows" :key="i" class="qi__card" :class="{ 'qi__card--on': r.on }">
                <label class="qi__pick" title="勾选（不勾就不入库）" @click.stop><input v-model="r.on" type="checkbox" /></label>
                <div class="qi__stem" :data-qi="i"></div>
            <div class="qi__figs" :data-qi="i" @click="onFigClick"></div>
                <div class="qi__fields">
                  <select v-model="r.q.qtype" class="qi__mini">
                    <option value="">未判</option>
                    <option v-for="(t, k) in QTYPE_LABEL" :key="k" :value="k">{{ t }}</option>
                  </select>
                  <select v-model="r.q.section" class="qi__mini">
                    <option value="">未归类</option>
                    <option v-for="s in SECTIONS" :key="s" :value="s">{{ s }}</option>
                  </select>
                  <input v-model.number="r.q.difficulty" class="qi__mini qi__mini--n" type="number" min="1" max="5" title="难度 1-5" />
                  <input v-model="r.q.year" class="qi__mini qi__mini--n" placeholder="年份" />
                  <input v-model="r.q.paperName" class="qi__mini qi__mini--wide" placeholder="试卷名" />
                  <input v-model="r.q.answer" class="qi__mini qi__mini--wide" placeholder="答案（原卷没有就留空）" />
                  <button class="qi__btn qi__btn--danger" @click="removeRow(i)">删</button>
                </div>
                <div v-if="(r.q.options || []).length" class="qi__opts">{{ optsText(r.q.options || []) }}</div>
                <div v-if="r.q.warn" class="qi__warn">{{ r.q.warn }}</div>
              </div>
            </div>
          </template>
        </section>
      </div>

      <footer class="qi__foot">
        <span class="qi__picked">已勾 {{ onCount }} / {{ rows.length }} 道</span>
        <span v-if="onCount" class="qi__hint2">无来源 {{ noSourceCount }} · 缺答案 {{ noAnswerCount }} · 0 选项 {{ noOptsCount }}</span>
        <button class="qi__btn" :disabled="busy || !onCount" title="先把这批落成草稿（不写正式库），到「草稿箱」逐条确认后再入库" @click="doSaveDrafts">先存草稿 {{ onCount }} 道</button>
        <button class="qb__btn qi__btn" :disabled="busy || !onCount" title="把这些图补到**已有的题**上（按题干找对应题；只改图，不新建题）" @click="doPatchImages">补到已有题 {{ onCount }} 道</button>
        <button class="qi__btn qi__btn--main qi__btn--go" :disabled="busy || !onCount" @click="doImport">入库 {{ onCount }} 道</button>
        <pre v-if="report" class="qi__report">{{ report }}</pre>
      </footer>

      <input ref="fileInput" class="qi__file" type="file" @change="onFilePicked" />
    </div>
  </div>
</template>

<style scoped>
/* ★ v1616 修：**整个弹窗点不动**（用户报「导入 md/json/pdf 都无反应」✗）。
   根因：本弹窗是题库浮窗 .qb 的**直接子元素**（QuestionBankPanel.vue:1200 ✓），而 .qb 从 v1472 起是
   `pointer-events: none`（为了"不挡画布"✓）—— 这个属性**会被子元素继承** ✗，而这里从没写回 auto ✗
   → 弹窗里所有按钮/输入框都点不到 ✗（真机实测：elementFromPoint 落在背后的 .qb__filters 上 ✓，
   而 JS 的 element.click() 能触发、真鼠标点不到 ✓ —— 所以只有"真人点"才复现 ✓）。
   本弹窗带全屏遮罩、本来就是**模态** ✓ → 明确吃掉点击 ✓（顺带：打开时也不会误点到底下的画布 ✓）。 */
.qi { pointer-events: auto; position: fixed; inset: 0; z-index: 420; background: rgba(20, 24, 34, 0.55); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; }
.qi__box { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: 96vw; max-width: 1320px; height: 90vh; display: flex; flex-direction: column; overflow: hidden; }
.qi__head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.qi__title { font-size: 15px; font-weight: 700; color: var(--text); }
.qi__sub { font-size: 12px; color: var(--muted); }
.qi__msg { font-size: 12px; color: var(--brand-600, #534AB7); }
.qi__close { margin-left: auto; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; cursor: pointer; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--gray-600); }
.qi__body { flex: 1; min-height: 0; display: grid; grid-template-columns: 400px 1fr; }
.qi__preview { font-size: 12px; line-height: 1.7; color: #8a6a12; background: #fdf6e3; border-bottom: 1px solid #e0cf9a; padding: 7px 16px; }
.qi__preview b { color: #6d5309; }
.qi__src { border-right: 1px solid var(--border); padding: 10px 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.qi__review { padding: 10px 12px; overflow-y: auto; }
.qi__t1 { font-size: 11px; font-weight: 700; color: var(--muted); letter-spacing: .04em; margin: 4px 0 2px; }
.qi__btnrow { display: flex; flex-wrap: wrap; gap: 6px; }
.qi__btn { height: 28px; padding: 0 10px; border: 1px solid var(--border); border-radius: 6px; background: #fff; font-size: 12.5px; cursor: pointer; color: var(--text); }
.qi__btn--main { background: var(--brand-600, #534AB7); border-color: var(--brand-600, #534AB7); color: #fff; }
.qi__btn--danger { color: #b42318; border-color: #f0c9c4; }
.qi__btn--go { margin-left: auto; }
.qi__btn:disabled { opacity: .55; cursor: default; }
.qi__lab { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; color: var(--muted); }
.qi__inp, .qi__ta, .qi__mini { border: 1px solid var(--border); border-radius: 6px; font-size: 12.5px; background: #fff; color: var(--text); padding: 0 6px; height: 28px; }
.qi__ta { height: auto; padding: 6px; line-height: 1.5; resize: vertical; font-family: ui-monospace, Consolas, monospace; }
.qi__mini { width: auto; min-width: 84px; }
.qi__mini--n { width: 64px; min-width: 64px; }
.qi__mini--wide { min-width: 150px; }
.qi__prog { font-size: 12px; color: var(--brand-600, #534AB7); word-break: break-all; }
.qi__hint { font-size: 11.5px; color: var(--muted); line-height: 1.6; }
.qi__hint--warn { color: #8a6a12; background: #fdf6e3; border: 1px solid #e0cf9a; border-radius: 6px; padding: 6px 8px; }
.qi__hint b { color: var(--text); }
.qi__empty { padding: 24px 10px; color: var(--muted); font-size: 12.5px; }
/* 【v1531】解析失败 / 需要用户知道的说明：常驻（别只闪 3 秒）✓ */
.qi__note { margin: 8px 0 10px; padding: 9px 11px; border: 1px solid #e6b980; background: #fff7e8; color: #8a5a12; border-radius: 8px; font-size: 12.5px; line-height: 1.7; white-space: pre-wrap; }
.qi__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 2px 0 8px; }
.qi__chk { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted); }
.qi__picked { font-size: 12px; color: var(--muted); }
.qi__hint2 { font-size: 11.5px; color: #b3541e; }
.qi__list { display: flex; flex-direction: column; gap: 6px; }
.qi__card { position: relative; border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px 8px 30px; background: #fff; }
.qi__card--on { border-color: var(--brand-600, #534AB7); }
.qi__pick { position: absolute; left: 8px; top: 10px; }
.qi__stem { font-size: 12.5px; color: var(--text); line-height: 1.7; margin-bottom: 6px; overflow-x: auto; }
/* 【v1455】校对表里的题图（入库前是 data URL，直接显示） */
/* 【v1455/v1458】校对卡片题图 —— 同样必须 :deep()（figure 是 innerHTML 注入的）✓ */
.qi__figs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.qi__figs :deep(.qi__fig) { margin: 0; display: flex; flex-direction: column; gap: 2px; }
.qi__figs :deep(.qi__fig img) { max-width: 150px; max-height: 110px; object-fit: contain; cursor: zoom-in; border: 1px solid var(--border); border-radius: 6px; background: #fff; }
.qi__figs :deep(.qi__fig--zoom img) { max-width: 100%; max-height: none; cursor: zoom-out; }
.qi__figs :deep(.qi__fig figcaption) { font-size: 10.5px; color: var(--muted); }
.qi__stem :deep(mjx-container) { font-size: inherit; max-width: 100%; }
.qi__stem :deep(mjx-container[display="true"]) { margin: 2px 0; }
.qi__fields { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.qi__fields select { height: 28px; border: 1px solid var(--border); border-radius: 6px; font-size: 12.5px; background: #fff; color: var(--text); }
.qi__opts { margin-top: 5px; font-size: 11.5px; color: var(--muted); line-height: 1.6; }
.qi__warn { margin-top: 4px; font-size: 11.5px; color: #b3541e; }
.qi__foot { display: flex; align-items: center; gap: 10px; padding: 9px 16px; border-top: 1px solid var(--border); background: var(--panel-2, #faf9f6); }
.qi__report { margin: 0; font-size: 11.5px; color: var(--text); white-space: pre-wrap; line-height: 1.5; }
.qi__file { display: none; }
</style>