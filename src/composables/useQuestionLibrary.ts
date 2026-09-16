/**
 * 试题库 —— 第二期。
 *
 * 复用第一期的通用表（library_item，type='question'），结构化字段放 meta：
 *   { stem, options[], answer, solution, knowledge[], difficulty, year, region }
 *
 * 设计取舍（按方案）：
 *  - **检索先用 LIKE + 标签过滤**，够用；FTS5 留到需要时再评估（中文分词效果一般）。
 *  - **题目文本不拆分**：题干/答案/解析各存一段纯文本，里面可以写 LaTeX（$...$）与 [图N]。
 */
import { libQuery, libSave, libRemove, libBump, libTags } from './useLibrary'
import type { LibDraft, LibItem } from './useLibrary'

export type Difficulty = 1 | 2 | 3 | 4 | 5

export interface QuestionMeta {
  stem: string
  options: string[]
  answer: string
  solution: string
  knowledge: string[]
  difficulty: number
  year: string
  region: string
}

export interface QuestionEntry extends LibItem {
  q: QuestionMeta
}

const EMPTY_META: QuestionMeta = {
  stem: '', options: [], answer: '', solution: '',
  knowledge: [], difficulty: 3, year: '', region: '',
}

function readMeta(raw: Record<string, unknown>): QuestionMeta {
  const m = (raw || {}) as Record<string, unknown>
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : [])
  return {
    stem: String(m.stem || ''),
    options: arr(m.options),
    answer: String(m.answer || ''),
    solution: String(m.solution || ''),
    knowledge: arr(m.knowledge),
    difficulty: Number(m.difficulty) || 3,
    year: String(m.year || ''),
    region: String(m.region || ''),
  }
}

function toEntry(it: LibItem): QuestionEntry {
  return { ...it, q: readMeta(it.meta as Record<string, unknown>) }
}

/** 列出试题库全部条目 */
export async function listQuestions(): Promise<QuestionEntry[]> {
  return (await libQuery('question')).map(toEntry)
}

/** 新增一条试题，返回 id（失败 0） */
export async function addQuestion(meta: Partial<QuestionMeta>, title?: string): Promise<number> {
  const q: QuestionMeta = { ...EMPTY_META, ...meta }
  const t = (title || '').trim() || autoTitle(q)
  const draft: LibDraft = {
    type: 'question',
    title: t,
    body: q.stem,
    meta: q as unknown as Record<string, unknown>,
    tags: q.knowledge.join(','),
    source: q.region || q.year || '自建',
    builtin: 0,
  }
  return libSave(draft)
}

/** 更新一条试题 */
export async function updateQuestion(id: number, meta: Partial<QuestionMeta>, title?: string): Promise<number> {
  const q: QuestionMeta = { ...EMPTY_META, ...meta }
  const t = (title || '').trim() || autoTitle(q)
  return libSave({
    id,
    type: 'question',
    title: t,
    body: q.stem,
    meta: q as unknown as Record<string, unknown>,
    tags: q.knowledge.join(','),
    source: q.region || q.year || '自建',
    builtin: 0,
  })
}

/** 删除一条试题 */
export async function removeQuestion(id: number): Promise<boolean> {
  return libRemove(id)
}

/** 记一次使用 */
export async function touchQuestion(id: number): Promise<void> {
  await libBump(id)
}

/** 标签汇总（供筛选界面） */
export async function listQuestionTags(): Promise<{ name: string; count: number }[]> {
  return libTags('question')
}

/** 自动起名：题干首行前 16 字 */
export function autoTitle(q: QuestionMeta): string {
  const first = (q.stem || '').split('\n').map((s) => s.trim()).filter(Boolean)[0] || '未命名试题'
  const t = first.replace(/\s+/g, ' ')
  return t.length > 16 ? t.slice(0, 16) + '…' : t
}

/** 组卷用文本：题干（+ 可选的答案与解析） */
export function questionToText(q: QuestionEntry, withSolution = false): string {
  const lines: string[] = []
  let stem = q.q.stem || q.body
  if (q.q.options.length) {
    stem += '\n' + q.q.options.map((o, i) => String.fromCharCode(65 + i) + '. ' + o).join('　　')
  }
  lines.push(stem)
  if (withSolution) {
    if (q.q.answer) lines.push('【答案】' + q.q.answer)
    if (q.q.solution) lines.push('【解析】' + q.q.solution)
  }
  return lines.join('\n')
}

/** 按条件筛选：关键词（题干/答案/解析/标签）+ 标签 + 难度 */
export function filterQuestions(
  list: QuestionEntry[],
  opt: { q?: string; tags?: string[]; difficulty?: number | null }
): QuestionEntry[] {
  const k = (opt.q || '').trim().toLowerCase()
  const tags = opt.tags || []
  return list.filter((x) => {
    if (opt.difficulty && x.q.difficulty !== opt.difficulty) return false
    if (tags.length && !tags.every((t) => x.q.knowledge.indexOf(t) >= 0 || x.tags.indexOf(t) >= 0)) return false
    if (!k) return true
    return (
      x.title.toLowerCase().includes(k) ||
      x.q.stem.toLowerCase().includes(k) ||
      x.q.answer.toLowerCase().includes(k) ||
      x.q.solution.toLowerCase().includes(k) ||
      x.tags.toLowerCase().includes(k)
    )
  })
}
