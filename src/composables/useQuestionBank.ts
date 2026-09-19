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
  missing: { section: number; answer: number; kp: number; year: number; paper: number }
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
  limit?: number
  offset?: number
}

/** 11 个必修板块（沿用旧题库的口径）+ 未分类兜底 ✓ */
export const SECTIONS = ['集合与逻辑', '函数与导数', '三角函数与向量', '数列', '不等式', '立体几何', '解析几何', '概率与统计', '复数', '计数原理', '未分类']
export const QTYPE_LABEL: Record<string, string> = { choice: '选择题', multi: '多选题', blank: '填空题', answer: '解答题', proof: '证明题' }
export const LEVELS = ['基础', '中档', '拔高']

const EMPTY_FACETS: QFacets = {
  total: 0, bySection: {}, byQtype: {}, byLevel: {}, byYear: {}, byPaper: {}, byKp: {},
  missing: { section: 0, answer: 0, kp: 0, year: 0, paper: 0 },
}

export async function qFacets(): Promise<QFacets> {
  try {
    const r = await invoke<QFacets>('lib_q_facets', {})
    if (r && r.ok !== false) return { ...EMPTY_FACETS, ...r, missing: { ...EMPTY_FACETS.missing, ...(r.missing || {}) } }
  } catch { /* 空库/浏览器降级都走默认值 ✓ */ }
  return EMPTY_FACETS
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
  s = s.replace(/\$[^$]*\$/g, ' ')
  s = s.replace(/\\[a-zA-Z]+\s*/g, ' ')
  s = s.replace(/\[图\d+(?::[^\]]*)?\]/g, ' ')
  s = s.replace(/[#*>`_]/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
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