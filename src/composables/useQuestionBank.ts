/**
 * 题库（v2 设计 · M2）前端数据层 —— 只跟 Rust 的 lib_q_* 打交道 ✓
 *
 * 纪律（沿用 useLibrary 的）：
 *  - **库是空的也能跑**：任何调用失败都返回安全默认值，绝不让界面崩 ✓
 *  - 筛选/计数交给 SQL（lib_q_facets / lib_q_search）：题量上去也不会拖慢界面 ✓
 */
import { invoke } from './useTauri'
import { assetSrc, loadAssets } from './useAssets'
import type { QuestionImage } from './parseQuestions'
import { dispNoOf, figLabelOf, placeFigures } from './mineruImages'

export interface QFacets {
  ok?: boolean
  total: number
  bySection: Record<string, number>
  byQtype: Record<string, number>
  byLevel: Record<string, number>
  byYear: Record<string, number>
  byPaper: Record<string, number>
  byKp: Record<string, number>
  /** 【v4/P0b】生命周期状态分布（draft / needs_review / ready / approved / published / rejected） */
  byStatus: Record<string, number>
  /** 【v4/P0b】来源类别分布（六类规约 + 未知） */
  bySourceKind: Record<string, number>
  /** 【v4/P0b】带抽取告警的题数（warn 真列非空） */
  warned: number
  missing: { section: number; answer: number; kp: number; year: number; paper: number; code: number }
}

export interface QItem {
  id: number
  title: string
  body: string
  meta: string
  section: string
  qtype: string
  level: string
  difficulty: number
  year: number
  paper: string
  kp: string[]
  updatedAt: string
  /* ---- 【v4/P0b】四个 v4 真列：以前只躺在库里，界面上一个都看不到 ---- */
  /** 人可读稳定编号 P-2026-0001（老师能口头引用 ✓） */
  code: string
  /** 生命周期：draft / needs_review / ready / approved / published / rejected */
  status: string
  /** 来源类别（六类规约；paper 为空时也是空） */
  sourceKind: string
  /** 抽取告警（AI / OCR 的 warnings，随题走；空串 = 没告警） */
  warn: string
}

export interface QFilter {
  section?: string
  qtype?: string
  level?: string
  year?: number
  paper?: string
  kp?: string
  q?: string
  missingSection?: boolean
  missingAnswer?: boolean
  missingKp?: boolean
  missingYear?: boolean
  /** 【v4/P0b】按生命周期状态筛（"(空)" = 还没标过状态） */
  status?: string
  /** 【v4/P0b】按来源类别筛 */
  sourceKind?: string
  limit?: number
  offset?: number
  /** 【v1470】排序：不给 = 最新在前；'paper' = 按试卷 + 题内序号（meta.no）✓ */
  sort?: string
}

/** 11 个必修板块（沿用旧题库的口径）+ 未分类兜底 ✓ */
export const SECTIONS = ['集合与逻辑', '函数与导数', '三角函数与向量', '数列', '不等式', '立体几何', '解析几何', '概率与统计', '复数', '计数原理', '未分类']
export const QTYPE_LABEL: Record<string, string> = { choice: '选择题', multi: '多选题', blank: '填空题', answer: '解答题', proof: '证明题' }
export const LEVELS = ['基础', '中档', '拔高']

/* ---- 【v4/P0b】生命周期状态（方案 §5.1 状态机；只有 ready / approved / published 算「能进正式库」） ---- */
export const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  needs_review: '待复核',
  ready: '可用',
  approved: '已审',
  published: '已发布',
  rejected: '已弃',
}
/** 状态机顺序（下拉框按它排；不含 blocked —— 那是抽取过程的中间态，不落题） */
export const STATUS_ORDER = ['draft', 'needs_review', 'ready', 'approved', 'published', 'rejected']

/** 状态 → 中文；空串给「未标状态」，未知值原样显示（别把将来新加的状态吃掉 ✗） */
export function statusLabel(s: string): string {
  const k = String(s || '').trim()
  if (!k) return '未标状态'
  return STATUS_LABEL[k] || k
}

const EMPTY_FACETS: QFacets = {
  total: 0, bySection: {}, byQtype: {}, byLevel: {}, byYear: {}, byPaper: {}, byKp: {},
  byStatus: {}, bySourceKind: {}, warned: 0,
  missing: { section: 0, answer: 0, kp: 0, year: 0, paper: 0, code: 0 },
}

export async function qFacets(): Promise<QFacets> {
  try {
    const r = await invoke<QFacets>('lib_q_facets', {})
    if (r && r.ok !== false) return { ...EMPTY_FACETS, ...r, missing: { ...EMPTY_FACETS.missing, ...(r.missing || {}) } }
  } catch { /* 空库/浏览器降级都走默认值 ✓ */ }
  return EMPTY_FACETS
}

/* ---- 【v4/P0b】来源合规报告 + 受控词表：P0 只做了 Rust 命令，界面压根看不到 ---- */

export interface SourceReportRow { id: number; title: string; paper: string; kind: string }

export interface SourceReport {
  ok: boolean
  total: number
  /** paper 为空的题数（P0 实测老库 129/169 —— 如实显示，不粉饰 ✓） */
  empty: number
  /** 有 paper 且符合六类模板的题数 */
  canonical: number
  /** 来源覆盖率 %（有来源 / 总数） */
  fillRate: number
  /** 成型率 %（成型 / 有来源的）—— 规约真正的验收指标，空值不算分子 ✓ */
  canonicalRate: number
  byKind: { kind: string; count: number }[]
  needsWork: SourceReportRow[]
  error?: string
}

const EMPTY_REPORT: SourceReport = {
  ok: false, total: 0, empty: 0, canonical: 0,
  fillRate: 0, canonicalRate: 0, byKind: [], needsWork: [],
}

export async function sourceReport(): Promise<SourceReport> {
  try {
    const r = await invoke<Partial<SourceReport>>('lib_source_report', {})
    if (r && r.ok !== false) return { ...EMPTY_REPORT, ...r, ok: true }
    return { ...EMPTY_REPORT, error: (r && r.error) || '读不到报告' }
  } catch (e) {
    return { ...EMPTY_REPORT, error: String((e as Error)?.message || e) }
  }
}

export interface KpCatalogItem { kp: string; kind: string; aliases: string; parent: string }

/** 受控词表（板块级）：kind = 'knowledge'（板块）/ 'method'（方法） */
export async function kpCatalog(): Promise<KpCatalogItem[]> {
  try {
    const r = await invoke<{ ok?: boolean; items?: KpCatalogItem[] }>('lib_kp_catalog', {})
    if (r && r.ok !== false) return r.items || []
  } catch { /* 空库也能跑 ✓ */ }
  return []
}

export async function qSearch(f: QFilter): Promise<{ total: number; items: QItem[] }> {
  try {
    const r = await invoke<{ ok?: boolean; total?: number; items?: QItem[] }>('lib_q_search', { filter: f })
    if (r && r.ok !== false) return { total: r.total || 0, items: r.items || [] }
  } catch { /* 同上 */ }
  return { total: 0, items: [] }
}

export async function qPatch(id: number, patch: Record<string, unknown>): Promise<{ ok: boolean; row?: Partial<QItem>; error?: string }> {
  try {
    const r = await invoke<{ ok?: boolean; row?: Partial<QItem>; error?: string }>('lib_q_patch', { id, patch })
    if (r && r.ok) return { ok: true, row: r.row }
    return { ok: false, error: (r && r.error) || '保存失败' }
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) }
  }
}

/** 题目的 meta（JSON 字符串）→ 对象；坏了给空对象，绝不让界面崩 ✓ */
export function metaOf(it: { meta?: string } | null | undefined): Record<string, unknown> {
  try { return JSON.parse((it && it.meta) || '{}') as Record<string, unknown> } catch { return {} }
}

/** 题干摘要：LaTeX / markdown / 图号都去掉，只留人眼能扫的字 ✓ */
export function excerptOf(raw: string, n = 80): string {
  let s = String(raw || '')
  // ⚠ 顺序要紧：**块级 $$…$$ 必须先剥** —— 否则 \$[^$]*\$ 会把 $$ 两两吃掉，
  //   公式内部的 \left \frac 等命令留下来变成 "\; \\" 这种噪声（实测：卡片上只剩反斜杠 ✗）
  s = s.replace(/\$\$[\s\S]*?\$\$/g, ' ')
  s = s.replace(/\$[^$\n]*\$/g, ' ')
  s = s.replace(/\\\[[\s\S]*?\\\]/g, ' ')
  s = s.replace(/\\\([\s\S]*?\\\)/g, ' ')
  s = s.replace(/\\[a-zA-Z]+\s*/g, ' ')
  s = s.replace(/\[图\d+(?::[^\]]*)?\]/g, ' ')
  s = s.replace(/[#*>`_]/g, ' ')
  s = s.replace(/\\[^a-zA-Z\s]/g, ' ')   // 残留的 \; \, \\ \[ \] 之类（一个反斜杠 + 非字母）
  s = s.replace(/[{}]/g, ' ')            // 残留花括号
  s = s.replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n) + '…' : s
}

/**
 * 【校对表 / 题卡用】题干摘要 —— **保留公式**（不剥 $…$），只折叠空白 + 截断 ✓
 * 为什么另开一个：校对的时候公式**正是要核对的内容**，剥掉等于让人没法校对 ✗
 * （excerptOf 是给列表「扫一眼」用的，两者用途不同，别混）
 */
export function stemPreviewText(raw: string, n = 260): string {
  const s = String(raw || '').replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n) + '…' : s
}

/** 【v1455/v1457】题图 → HTML：题干里的 @@FIG:i@@ 占位换成真图，图号用**题内**号 ✓ */
export function figHtmlOf(im: QuestionImage, disp?: number, label?: string): string {
  const src = String((im && im.src) || '')
  if (!src) return ''
  const e = (t: unknown) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const d = disp || Number((im && im.n) || 0)
  const lab = label || figLabelOf(im, d)
  return (
    '<figure class="qb__fig"><img src="' + e(src) + '" alt="' + e(lab) + '" title="点击放大" loading="lazy" />' +
    '<figcaption>' + e(lab) + '</figcaption></figure>'
  )
}
/** 预览用的 HTML：题干 + 选项 + 答案 + 解析（走 typesetMixed，公式按编辑器同一套渲染 ✓） */
export function previewHtmlOf(it: QItem, imgs?: QuestionImage[]): string {
  const m = metaOf(it)
  const esc = (t: string) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const stem = String(m.stem || it.body || it.title || '')
  // 【v1455】题图：题干里的图位**就地换成真图**（以前这里完全不渲染图 → 图存进去了也看不见 ✗）
  // 【v1457】图号改用**题内**号（图注写了「图一/(图2)」就照图注），落点由 placeFigures 统一决定 ✓
  const list = imgs || []
  const stemHtml = esc(placeFigures(stem, list)).replace(/@@FIG:(\d+)@@/g, (whole: string, i: string) => {
    const im = list[Number(i)]
    return im ? figHtmlOf(im, dispNoOf(im, Number(i))) : whole
  })
  let out = '<div class="qb__sec">' + stemHtml + '</div>'
  const opts = Array.isArray(m.options) ? (m.options as unknown[]).map((x) => String(x)) : []
  if (opts.length) {
    out += '<div class="qb__sec">' + opts.map((o, i) => '<div>' + 'ABCDEFGH'[i] + '．' + esc(o) + '</div>').join('') + '</div>'
  }
  const ans = String(m.answer || '').trim()
  out += '<div class="qb__sec qb__sec--ans">答案：' + (ans ? esc(ans) : '<span class="qb__miss">（原卷没有 / 尚未录入）</span>') + '</div>'
  const sol = String(m.solution || '').trim()
  if (sol) out += '<div class="qb__sec">解析：' + esc(sol) + '</div>'
  return out
}


/* ---------------- M3：批量改 / 插入（幻灯片 · 试卷） ---------------- */

export interface QBatchOp { id: number; patch?: Record<string, unknown>; delete?: boolean }

/** 批量改题：**一个事务**（改章节/打知识点/删除），中途失败全部回滚 ✓ */
export interface QBatchResult { ok: boolean; updated: number; deleted: number; /** 批量删除时 Rust 侧自动留下的整库备份路径 ✓ */ backup: string; rows: Record<string, unknown>[]; error?: string }

export async function qBatch(ops: QBatchOp[]): Promise<QBatchResult> {
  try {
    const r = await invoke<{ ok?: boolean; updated?: number; deleted?: number; backup?: string; rows?: Record<string, unknown>[]; error?: string }>('lib_q_batch', { ops })
    if (r && r.ok) return { ok: true, updated: r.updated || 0, deleted: r.deleted || 0, backup: r.backup || '', rows: r.rows || [] }
    return { ok: false, updated: 0, deleted: 0, backup: '', rows: [], error: (r && r.error) || '批量保存失败' }
  } catch (e) {
    return { ok: false, updated: 0, deleted: 0, backup: '', rows: [], error: String((e as Error)?.message || e) }
  }
}

/** 题干 + 选项（选项数组为空 = 选项本来就写在题干里了，不要再拼一遍 ✓） */
export function stemWithOptions(it: QItem): string {
  const m = metaOf(it)
  let stem = String(m.stem || it.body || it.title || '')
  const opts = Array.isArray(m.options) ? (m.options as unknown[]).map((x) => String(x)) : []
  if (opts.length) stem += '\n' + opts.map((o, i) => 'ABCDEFGH'[i] + '．' + o).join('\n')
  return stem
}

/** 题干 + 选项 [+ 答案/解析] —— 幻灯片与试卷共用这一份排版 ✓ */
export function questionTextOf(it: QItem, withAnswer: boolean): string {
  const m = metaOf(it)
  const lines = [stemWithOptions(it)]
  if (withAnswer) {
    const ans = String(m.answer || '').trim()
    const sol = String(m.solution || '').trim()
    if (ans) lines.push('【答案】' + ans)
    if (sol) lines.push('【解析】' + sol)
  }
  return lines.join('\n')
}

/** Markdown 图片语法（老数据正文里写的就是这个） */
const MD_IMG = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)[^)]*\)/g
/** [图N] / [图N:参数]（试卷正文的图号约定） */
const IMG_TAG = /\[图\s*(\d+)(?::[^\]]*)?\]/g

/**
 * 把正文里的图片标记摘成空并报数 —— 混排元素放不下图，图要另做成 image 元素 ✓
 * 返回 dropped = 摘掉了几处（用来提示"有几张图得手动补"）。
 */
export function stripImageMarkers(text: string): { text: string; dropped: number } {
  let dropped = 0
  let out = String(text || '').replace(MD_IMG, () => { dropped++; return '' })
  out = out.replace(IMG_TAG, () => { dropped++; return '' })
  out = out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return { text: out, dropped }
}

/** 题目自带的图（meta.images）；assetId 走资源库 hydrate 回 data URL ✓ */
export async function pickImages(it: QItem): Promise<QuestionImage[]> {
  const m = metaOf(it)
  const raw = Array.isArray(m.images) ? (m.images as QuestionImage[]) : []
  if (!raw.length) return []
  const ids = raw.map((x) => Number(x.assetId)).filter((n) => n > 0)
  if (ids.length) await loadAssets(ids)
  const out: QuestionImage[] = []
  for (const x of raw) {
    const src = x.src || assetSrc(Number(x.assetId))
    if (src) out.push({ n: Number(x.n) || out.length + 1, src, caption: x.caption })
  }
  return out
}
/* ================= 【v5 · P1b】草稿箱：批次 / 草稿 / 确认入库 ================= */

export interface ImportBatch {
  id: string
  sourceType: string
  sourceLabel: string
  status: string
  questionCount: number
  idemKey: string
  createdAt: string
  finishedAt?: string | null
}

export interface ImportDraft {
  id: string
  sourceItemId: string
  sourceLabel: string
  /** 原图页码 / 坐标（MinerU 已经给了，别再丢） */
  page?: number | null
  bbox?: string
  confidence?: number | null
  /** 1 = 被闸门拦下，需要人工看 */
  needsReview: number
  stem: string
  /** JSON 数组字符串（Rust 侧列存的是 TEXT） */
  options: string
  answer: string
  solution: string
  qtype: string
  section: string
  difficulty: number
  /** JSON 数组字符串 */
  knowledge: string
  year: number
  paper: string
  sourceKind: string
  /** 版面解析原文（人工修的底稿） */
  rawText: string
  /** 闸门给的告警：为什么被拦下 */
  warn: string
  status: string
  /** 已入库的题 id（0 = 还没入） */
  targetQid: number
}

/** 草稿状态 → 中文（方案 §5.1 状态机） */
export const DRAFT_STATUS_LABEL: Record<string, string> = {
  needs_review: '待复核',
  ready: '可用',
  approved: '已确认',
  published: '已入库',
  rejected: '已弃用',
}
export function draftStatusLabel(s: string): string {
  const k = String(s || '').trim()
  if (!k) return '未标状态'
  return DRAFT_STATUS_LABEL[k] || k
}
/** 够格进正式库的状态（**与 Rust 的 lib_draft_ok_for_commit 保持一致** ✓） */
export function draftCanCommit(s: string): boolean {
  return s === 'ready' || s === 'approved' || s === 'published'
}
/** 草稿的 options / knowledge 是 JSON 数组字符串 → 数组（坏了给空表，界面不崩 ✓） */
export function draftArr(s: string): string[] {
  try {
    const v = JSON.parse(String(s || '[]'))
    return Array.isArray(v) ? v.map((x) => String(x)) : []
  } catch { return [] }
}
/** 草稿列表「扫一眼」用的摘要（**保留公式**；要渲染公式的那套用 stemPreviewText） */
export function draftExcerpt(d: ImportDraft, n = 90): string {
  return excerptOf(d.stem || d.rawText || '', n)
}

/** 前端往草稿里灌的一条（字段名与 Rust 的 lib_import_add_drafts 对齐 ✓） */
export interface DraftIn {
  sourceItemId?: string
  /** 【v1452】指向已有题（补图 / 归一都用它）—— 0 = 新建 ✓ */
  targetQid?: number
  sourceLabel?: string
  page?: number
  bbox?: string
  confidence?: number
  stem: string
  options: string[]
  answer?: string
  solution?: string
  qtype?: string
  section?: string
  difficulty?: number
  knowledge?: string[]
  year?: number
  paper?: string
  sourceKind?: string
  rawText?: string
  warn?: string
  /** 只用来数「有几处图片标记没落地」，不进库 ✓ */
  images?: unknown[]
  extra?: string
}

export async function importBegin(p: { sourceType: string; sourcePath?: string; sourceLabel?: string; idemKey?: string; extra?: string }): Promise<{ ok: boolean; reused: boolean; code: string; batch?: ImportBatch; error?: string }> {
  try {
    const r = await invoke<{ ok?: boolean; reused?: boolean; code?: string; batch?: ImportBatch; error?: string }>('lib_import_begin', { payload: p })
    if (r && r.ok) return { ok: true, reused: !!r.reused, code: r.code || '', batch: r.batch }
    return { ok: false, reused: false, code: '', error: (r && r.error) || '开批次失败' }
  } catch (e) {
    return { ok: false, reused: false, code: '', error: String((e as Error)?.message || e) }
  }
}

export async function importAddDrafts(batchId: string, drafts: DraftIn[], expectedCount = -1): Promise<{ ok: boolean; added: number; needReview: number; ids: string[]; error?: string }> {
  try {
    const r = await invoke<{ ok?: boolean; added?: number; needReview?: number; ids?: string[]; error?: string }>('lib_import_add_drafts', { payload: { batchId, drafts, expectedCount } })
    if (r && r.ok) return { ok: true, added: r.added || 0, needReview: r.needReview || 0, ids: r.ids || [] }
    return { ok: false, added: 0, needReview: 0, ids: [], error: (r && r.error) || '存草稿失败' }
  } catch (e) {
    return { ok: false, added: 0, needReview: 0, ids: [], error: String((e as Error)?.message || e) }
  }
}

export async function importDrafts(batch: string): Promise<ImportDraft[]> {
  try {
    const r = await invoke<{ ok?: boolean; items?: ImportDraft[] }>('lib_import_drafts', { batch })
    if (r && r.ok !== false) return r.items || []
  } catch { /* 空库也能跑 ✓ */ }
  return []
}

export async function importDraftPatch(ids: string[], patch: Record<string, unknown>): Promise<{ ok: boolean; updated: number; error?: string }> {
  try {
    const r = await invoke<{ ok?: boolean; updated?: number; error?: string }>('lib_import_draft_patch', { ids, patch })
    if (r && r.ok) return { ok: true, updated: r.updated || 0 }
    return { ok: false, updated: 0, error: (r && r.error) || '改草稿失败' }
  } catch (e) {
    return { ok: false, updated: 0, error: String((e as Error)?.message || e) }
  }
}

export async function importCommit(ids: string[]): Promise<{ ok: boolean; created: number; code: string; blocked: { id: string; status: string; warn: string }[]; error?: string }> {
  try {
    const r = await invoke<{ ok?: boolean; created?: number; code?: string; blocked?: { id: string; status: string; warn: string }[]; error?: string }>('lib_import_commit', { ids })
    if (r && r.ok) return { ok: true, created: r.created || 0, code: '', blocked: [] }
    return { ok: false, created: 0, code: (r && r.code) || '', blocked: (r && r.blocked) || [], error: (r && r.error) || '入库失败' }
  } catch (e) {
    return { ok: false, created: 0, code: '', blocked: [], error: String((e as Error)?.message || e) }
  }
}

export async function importDiscard(ids: string[]): Promise<{ ok: boolean; rejected: number; error?: string }> {
  try {
    const r = await invoke<{ ok?: boolean; rejected?: number; error?: string }>('lib_import_discard', { ids })
    if (r && r.ok) return { ok: true, rejected: r.rejected || 0 }
    return { ok: false, rejected: 0, error: (r && r.error) || '弃用失败' }
  } catch (e) {
    return { ok: false, rejected: 0, error: String((e as Error)?.message || e) }
  }
}

export async function importBatches(limit = 50): Promise<ImportBatch[]> {
  try {
    const r = await invoke<{ ok?: boolean; items?: ImportBatch[] }>('lib_import_batches', { limit })
    if (r && r.ok !== false) return r.items || []
  } catch { /* 空库也能跑 ✓ */ }
  return []
}

/** 从识别历史重建：只复制草稿，**不重调 OCR / LLM** ✓ */
export async function importRebuild(batch: string): Promise<{ ok: boolean; batch: string; copied: number; ocrCalls: number; error?: string }> {
  try {
    const r = await invoke<{ ok?: boolean; batch?: string; copied?: number; ocrCalls?: number; error?: string }>('lib_import_rebuild', { batch })
    if (r && r.ok) return { ok: true, batch: r.batch || '', copied: r.copied || 0, ocrCalls: r.ocrCalls || 0 }
    return { ok: false, batch: '', copied: 0, ocrCalls: 0, error: (r && r.error) || '重建失败' }
  } catch (e) {
    return { ok: false, batch: '', copied: 0, ocrCalls: 0, error: String((e as Error)?.message || e) }
  }
}

/** 幂等键：同一份输入 + 同一解析方式 → 同一个键（重复点不会重复建批次、不重复计费 ✓） */
export function idemKeyOf(sourceType: string, payload: string): string {
  let h = 5381
  const s = sourceType + '|' + payload
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return sourceType + '-' + h.toString(16) + '-' + s.length
}

/* ---- 【v5 · P1c】来源归一建议 ---- */

export interface SourcePlanItem {
  id: number
  code: string
  paper: string
  /** 归一前的类别（未知 / 模拟 / 校内 …） */
  kind: string
  /** 建议的规范名；空串 = 认不出，只能人工填 */
  suggest: string
  /** alias / rule / template / none */
  how: string
  /** 建议里还有「？」→ 要人补全 */
  needManual: boolean
}

export interface SourcePlan {
  ok: boolean
  total: number
  /** 来源已经成型的题数 */
  canonical: number
  /** 有来源的题数（canonicalRate 的分母） */
  filled: number
  alias: number
  rule: number
  template: number
  none: number
  /** 来源空着的题数（不猜，人工填） */
  noPaper: number
  /** 库外别名表 source_canonical_map.json 读到了没有 */
  aliasTableLoaded: boolean
  items: SourcePlanItem[]
  noPaperItems: { id: number; code: string; title: string }[]
  error?: string
}

export const HOW_LABEL: Record<string, string> = {
  alias: '别名表',
  rule: '规则可整',
  template: '模板半成品',
  none: '认不出',
}
export function howLabel(h: string): string {
  return HOW_LABEL[h] || h
}

const EMPTY_PLAN: SourcePlan = {
  ok: false, total: 0, canonical: 0, filled: 0, alias: 0, rule: 0, template: 0,
  none: 0, noPaper: 0, aliasTableLoaded: false, items: [], noPaperItems: [],
}

/** 来源归一建议（**只读**：Rust 侧一个字都不写库 ✓） */
export async function sourcePlan(): Promise<SourcePlan> {
  try {
    const r = await invoke<Partial<SourcePlan>>('lib_source_plan', {})
    if (r && r.ok !== false) return { ...EMPTY_PLAN, ...r, ok: true }
    return { ...EMPTY_PLAN, error: (r && r.error) || '读不到建议' }
  } catch (e) {
    return { ...EMPTY_PLAN, error: String((e as Error)?.message || e) }
  }
}

/** 把建议生成**草稿**（正式库一个字不改；去草稿箱确认后才生效 ✓） */
export async function sourcePlanApply(ids: number[]): Promise<{ ok: boolean; batch: string; added: number; needManual: number; reused: boolean; error?: string }> {
  try {
    const r = await invoke<{ ok?: boolean; batch?: string; added?: number; needManual?: number; reused?: boolean; error?: string }>('lib_source_plan_apply', { ids })
    if (r && r.ok) return { ok: true, batch: r.batch || '', added: r.added || 0, needManual: r.needManual || 0, reused: !!r.reused }
    return { ok: false, batch: '', added: 0, needManual: 0, reused: false, error: (r && r.error) || '生成草稿失败' }
  } catch (e) {
    return { ok: false, batch: '', added: 0, needManual: 0, reused: false, error: String((e as Error)?.message || e) }
  }
}

/* ---- 【v5 · P2a】导出为 Markdown 题库 ---- */

/** 【v1452】按题干给「给已有题补图」找库里的对应题 ✓ */
export interface StemMatch { index: number; qid: number; code: string; how: string }
export async function matchStems(stems: string[]): Promise<StemMatch[]> {
  try {
    const r = await invoke<{ ok?: boolean; items?: StemMatch[] }>('lib_q_match_stems', { stems })
    if (r && r.ok !== false) return r.items || []
  } catch { /* 空库也能跑 ✓ */ }
  return []
}

/** 桌面端常用目录（导出时给个合理默认值；拿不到就返回空串 ✓） */
export async function firstUserDir(label = '文档'): Promise<string> {
  try {
    const r = await invoke<{ ok?: boolean; dirs?: { label: string; path: string }[] }>('user_dirs')
    const dirs = (r && r.dirs) || []
    const hit = dirs.filter((d) => d.label === label)[0]
    return (hit || dirs[0] || { path: '' }).path || ''
  } catch { return '' }
}

/** 把整个题库导出成「一道题一个 .md」的 Markdown 题库（**能再导入回来** ✓） */
export async function exportVault(dir: string): Promise<{ ok: boolean; dir: string; count: number; total: number; index: string; error?: string }> {
  try {
    const r = await invoke<{ ok?: boolean; dir?: string; count?: number; total?: number; index?: string; error?: string }>('lib_export_vault', { dir })
    if (r && r.ok) return { ok: true, dir: r.dir || dir, count: r.count || 0, total: r.total || 0, index: r.index || '' }
    return { ok: false, dir, count: 0, total: 0, index: '', error: (r && r.error) || '导出失败' }
  } catch (e) {
    return { ok: false, dir, count: 0, total: 0, index: '', error: String((e as Error)?.message || e) }
  }
}

/** 【规范】写一个文本文件到老师选的目录（录入窗口「导出规范 MD」用 ✓） */
export async function writeTextFile(dir: string, name: string, text: string): Promise<{ ok: boolean; path: string; error?: string }> {
  try {
    const r = await invoke<{ ok?: boolean; path?: string; error?: string }>('lib_write_text_file', { dir, name, text })
    if (r && r.ok) return { ok: true, path: String(r.path || '') }
    return { ok: false, path: '', error: (r && r.error) || '写入失败' }
  } catch (e) {
    return { ok: false, path: '', error: String((e as Error)?.message || e) }
  }
}
