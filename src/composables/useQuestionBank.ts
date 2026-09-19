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

/** 预览用的 HTML：题干 + 选项 + 答案 + 解析（走 typesetMixed，公式按编辑器同一套渲染 ✓） */
export function previewHtmlOf(it: QItem): string {
  const m = metaOf(it)
  const esc = (t: string) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const stem = String(m.stem || it.body || it.title || '')
  let out = '<div class="qb__sec">' + esc(stem) + '</div>'
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