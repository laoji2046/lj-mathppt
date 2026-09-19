/**
 * 题库（v2 设计 · M2）前端数据层 —— 只跟 Rust 的 lib_q_* 打交道 ✓
 *
 * 纪律（沿用 useLibrary 的）：
 *  - **库是空的也能跑**：任何调用失败都返回安全默认值，绝不让界面崩 ✓
 *  - 筛选/计数交给 SQL（lib_q_facets / lib_q_search）：题量上去也不会拖慢界面 ✓
 */
import { invoke } from './useTauri'

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
export const QTYPE_LABEL: Record<string, string> = { choice: '选择题', blank: '填空题', answer: '解答题', proof: '证明题' }
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
