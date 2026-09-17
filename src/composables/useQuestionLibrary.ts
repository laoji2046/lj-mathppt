/**
 * 试题库 —— 第二期建立，第三期后扩充（日期/题型/板块/难度分级/答案自我完善）。
 *
 * 复用通用表（library_item，type='question'），结构化字段放 meta：
 *   { stem, options[], answer, solution, knowledge[],
 *     qtype, section, date, difficulty, year, region, answerFrom }
 *
 * 设计取舍：
 *  - 检索先用 LIKE + 分类过滤，够用；FTS5 留到需要时再评估（中文分词效果一般）。
 *  - 题目文本不拆分：题干/答案/解析各存一段纯文本，可写 LaTeX（$...$）与 [图N]。
 *  - **难度内部仍存 1-5**（兼容旧数据），界面按 易/中/难 三档呈现与筛选。
 */
import { libQuery, libSave, libRemove, libBump, libTags, libSaveMany } from './useLibrary'
import type { ParsedQuestion } from './parseQuestions'
import { judgeNonQuestion } from './parseQuestions'
import type { LibDraft, LibItem } from './useLibrary'

export type Difficulty = 1 | 2 | 3 | 4 | 5

/* ---------------- 题型 ---------------- */

export type QType = 'choice' | 'multi' | 'blank' | 'answer'
export const QTYPES: { v: QType; label: string }[] = [
  { v: 'choice', label: '单选' },
  { v: 'multi', label: '多选' },
  { v: 'blank', label: '填空' },
  { v: 'answer', label: '解答' },
]
export function qtypeLabel(t: QType | string): string {
  return QTYPES.find((x) => x.v === t)?.label || '未分'
}

/* ---------------- 板块 ---------------- */

export const SECTIONS = [
  '集合与逻辑',
  '函数与导数',
  '三角函数与向量',
  '解析几何',
  '立体几何',
  '概率与统计',
]

/** 板块关键词 → 板块（用于解析器/自动归类；命中多个取第一个） */
export const SECTION_HINTS: { section: string; words: string[] }[] = [
  { section: '集合与逻辑', words: ['集合', '子集', '交集', '并集', '补集', '充分', '必要', '充要', '命题', '量词', '逻辑'] },
  { section: '函数与导数', words: ['函数', '定义域', '值域', '单调', '奇偶', '周期', '指数', '对数', '幂函数', '导数', '切线', '极值', '最值', '零点'] },
  { section: '三角函数与向量', words: ['三角', '正弦', '余弦', '正切', '弧度', '解三角形', '向量', '数量积', '共线', '夹角'] },
  { section: '解析几何', words: ['直线', '圆', '椭圆', '双曲线', '抛物线', '焦点', '离心率', '准线', '渐近线', '斜率'] },
  { section: '立体几何', words: ['空间', '立体', '棱柱', '棱锥', '棱台', '圆柱', '圆锥', '球', '异面', '二面角', '体积', '表面积', '三视图'] },
  { section: '概率与统计', words: ['概率', '随机', '分布', '期望', '方差', '统计', '抽样', '回归', '独立性', '排列', '组合', '二项式'] },
]

/** 按关键词猜板块（题干 + 知识点一起看） */
export function guessSection(text: string, knowledge: string[] = []): string {
  const hay = (text + ' ' + knowledge.join(' ')).toLowerCase()
  for (const h of SECTION_HINTS) {
    for (const w of h.words) {
      if (hay.includes(w.toLowerCase())) return h.section
    }
  }
  return ''
}

/* ---------------- 第二级：章节（板块之下） ---------------- */

/**
 * 章节体系（按人教A版顺序整理，作为**下拉建议**；也允许自己填）。
 * 板块 → 章节列表。用途：逐级筛选 + 组卷时按章节挑题。
 */
export const CHAPTERS: Record<string, string[]> = {
  '集合与逻辑': ['集合及其运算', '常用逻辑用语', '不等式与基本不等式'],
  '函数与导数': ['函数及其表示', '函数的基本性质', '指数函数与对数函数', '幂函数', '函数的应用与零点', '导数及其应用'],
  '三角函数与向量': ['三角函数', '三角恒等变换', '解三角形', '平面向量', '复数'],
  '解析几何': ['直线与方程', '圆与方程', '椭圆', '双曲线', '抛物线', '直线与圆锥曲线'],
  '立体几何': ['空间几何体', '点线面的位置关系', '空间向量与立体几何'],
  '概率与统计': ['计数原理', '二项式定理', '概率', '随机变量及其分布', '统计与统计案例'],
}

/** 取某板块下的章节建议（板块为空则返回全部，去重） */
export function chaptersOf(section: string): string[] {
  if (section && CHAPTERS[section]) return CHAPTERS[section]
  const all: string[] = []
  for (const k of Object.keys(CHAPTERS)) for (const c of CHAPTERS[k]) if (all.indexOf(c) < 0) all.push(c)
  return all
}

/* ---------------- 难度分级（易 / 中 / 难） ---------------- */

export type Level = 'easy' | 'mid' | 'hard'
export const LEVELS: { v: Level; label: string; d: number }[] = [
  { v: 'easy', label: '易', d: 2 },
  { v: 'mid', label: '中', d: 3 },
  { v: 'hard', label: '难', d: 5 },
]
/** 1-5 → 易/中/难（1-2 易、3 中、4-5 难） */
export function levelOf(d: number): Level {
  const n = Number(d) || 3
  if (n <= 2) return 'easy'
  if (n === 3) return 'mid'
  return 'hard'
}
export function levelLabel(d: number): string {
  const v = levelOf(d)
  return LEVELS.find((x) => x.v === v)?.label || '中'
}
export function levelToDifficulty(v: Level): number {
  return LEVELS.find((x) => x.v === v)?.d ?? 3
}
/** 把 易/中/难 文字（含旧写法）统一成 1-5 */
export function parseDifficulty(raw: string): number {
  const s = (raw || '').trim()
  if (!s) return 3
  if (s.includes('易') || s.includes('简单') || s.includes('基础')) return 2
  if (s.includes('难') || s.includes('较难') || s.includes('压轴')) return 5
  if (s.includes('中') || s.includes('中等')) return 3
  const n = Number(s.match(/[1-5]/)?.[0])
  return n || 3
}

/* ---------------- 题型推断 ---------------- */

/** 有选项 + 答案多字母 → 多选；有选项 → 单选；无选项且题干有下划线 → 填空；否则解答 */
export function inferQType(m: { options?: string[]; answer?: string; stem?: string }): QType {
  const opts = m.options || []
  const ans = (m.answer || '').toUpperCase().replace(/[^A-H]/g, '')
  if (opts.length >= 2) return ans.length > 1 ? 'multi' : 'choice'
  if (/_{2,}|＿{2,}|（\s*）|\(\s*\)|____/.test(m.stem || '')) return 'blank'
  return 'answer'
}

/* ---------------- 数据结构 ---------------- */

export interface QuestionMeta {
  stem: string
  options: string[]
  answer: string
  solution: string
  knowledge: string[]
  /** 1-5；界面按 易/中/难 呈现 */
  difficulty: number
  /** 每题分值；0 或未设时按题型取默认（见 defaultScore） */
  score: number
  /** 题型 */
  qtype: QType
  /** 板块（见 SECTIONS）；空串表示未分类 */
  section: string
  /** 章节（第二级，见 CHAPTERS）；空串表示未细分 */
  chapter: string
  /** 录入/来源日期 YYYY-MM-DD */
  date: string
  /** 年份（如 2024）；整套插入时按它 + 试卷名归组 */
  year: string
  /** 试卷名（如 2024届某市一模）；整套插入时按它 + 年份归组 */
  paperName: string
  region: string
  /** 答案来源：manual 人工 / auto 从解析自动提取 / 空 未填 */
  answerFrom: '' | 'manual' | 'auto'
}

export interface QuestionEntry extends LibItem {
  q: QuestionMeta
}

const EMPTY_META: QuestionMeta = {
  stem: '', options: [], answer: '', solution: '',
  knowledge: [], difficulty: 3, score: 0, qtype: 'choice', section: '', chapter: '', date: '',
  year: '', paperName: '', region: '', answerFrom: '',
}

function readMeta(raw: Record<string, unknown>): QuestionMeta {
  const m = (raw || {}) as Record<string, unknown>
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : [])
  const stem = String(m.stem || '')
  const options = arr(m.options)
  const answer = String(m.answer || '')
  const qtype = (m.qtype ? String(m.qtype) : inferQType({ options, answer, stem })) as QType
  return {
    stem,
    options,
    answer,
    solution: String(m.solution || ''),
    knowledge: arr(m.knowledge),
    difficulty: Number(m.difficulty) || 3,
    score: Number(m.score) || 0,
    qtype,
    section: String(m.section || ''),
    chapter: String(m.chapter || ''),
    date: String(m.date || ''),
    year: String(m.year || ''),
    paperName: String(m.paperName || ''),
    region: String(m.region || ''),
    answerFrom: (String(m.answerFrom || '') as QuestionMeta['answerFrom']) || (answer ? 'manual' : ''),
  }
}

function toEntry(it: LibItem): QuestionEntry {
  return { ...it, q: readMeta(it.meta as Record<string, unknown>) }
}

/* ---------------- 答案自我完善 ---------------- */

/**
 * 从解析里反推答案。**只在明确表述上认**，不做模糊猜测 ——
 * 猜错比留空更糟（老师会直接信它）。
 *
 * 认这些写法：故选B / 应选B / 答案为B / 正确答案是B / 选：B / 故选：B、C
 * 选择题只认 A-H 字母；填空题不猜（无法可靠从文字反推）。
 */
export function extractAnswerFromSolution(solution: string, options: string[] = []): string {
  const s = (solution || '').replace(/\s+/g, ' ')
  if (!s) return ''
  const pats = [
    /故\s*选\s*[:：]?\s*([A-H](?:\s*[,、，]?\s*[A-H]){0,3})/,
    /应\s*选\s*[:：]?\s*([A-H](?:\s*[,、，]?\s*[A-H]){0,3})/,
    /正确答案\s*(?:是|为)?\s*[:：]?\s*([A-H](?:\s*[,、，]?\s*[A-H]){0,3})/,
    /答案\s*(?:是|为)?\s*[:：]?\s*([A-H](?:\s*[,、，]?\s*[A-H]){0,3})/,
    /选\s*[:：]\s*([A-H](?:\s*[,、，]?\s*[A-H]){0,3})/,
  ]
  for (const p of pats) {
    const m = s.match(p)
    if (m) {
      const letters = (m[1].match(/[A-H]/g) || []).join('')
      // 有选项时，字母不能超出选项数（防止把「x=3 … 故选A」里的别的字母算进来）
      if (options.length && letters.split('').some((c) => c.charCodeAt(0) - 65 >= options.length)) continue
      if (letters) return letters
    }
  }
  return ''
}

/** 扫一遍库里缺答案但解析里能反推出的题，返回建议（不直接写库，先给用户过目） */
export function proposeAnswers(list: QuestionEntry[]): { id: number; title: string; proposed: string }[] {
  const out: { id: number; title: string; proposed: string }[] = []
  for (const x of list) {
    if (x.q.answer) continue
    const p = extractAnswerFromSolution(x.q.solution, x.q.options)
    if (p) out.push({ id: x.id, title: x.title, proposed: p })
  }
  return out
}

/** 列出缺答案的题 */
export function missingAnswer(list: QuestionEntry[]): QuestionEntry[] {
  return list.filter((x) => !x.q.answer.trim())
}

/* ---------------- 增删改查 ---------------- */

export async function listQuestions(): Promise<QuestionEntry[]> {
  return (await libQuery('question')).map(toEntry)
}

function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

/** 补默认值（新增时自动填日期、题型、板块） */
export function withDefaults(meta: Partial<QuestionMeta>): QuestionMeta {
  const q: QuestionMeta = { ...EMPTY_META, ...meta }
  if (!q.date) q.date = today()
  if (!q.year) {
    const y = (q.region || '').match(/(19|20)\d{2}/)
    if (y) q.year = y[0]
  }
  if (!q.qtype) q.qtype = inferQType(q)
  if (!q.section) q.section = guessSection(q.stem, q.knowledge)
  if (q.answer && !q.answerFrom) q.answerFrom = 'manual'
  return q
}

function draftOf(q: QuestionMeta, title: string, id = 0): LibDraft {
  return {
    id: id > 0 ? id : undefined,
    type: 'question',
    title: title.trim() || autoTitle(q),
    body: q.stem,
    meta: q as unknown as Record<string, unknown>,
    tags: [q.section, ...q.knowledge].filter(Boolean).join(','),
    source: q.region || q.year || q.date || '自建',
    builtin: 0,
  }
}

export async function addQuestion(meta: Partial<QuestionMeta>, title?: string): Promise<number> {
  return libSave(draftOf(withDefaults(meta), title || ''))
}

export async function updateQuestion(id: number, meta: Partial<QuestionMeta>, title?: string): Promise<number> {
  return libSave(draftOf(withDefaults(meta), title || '', id))
}

export async function removeQuestion(id: number): Promise<boolean> {
  return libRemove(id)
}

export async function touchQuestion(id: number): Promise<void> {
  await libBump(id)
}

export async function listQuestionTags(): Promise<{ name: string; count: number }[]> {
  return libTags('question')
}

/** 批量导入：Rust 侧走事务 + 按 body 去重 */
export async function importParsedQuestions(list: ParsedQuestion[]): Promise<{ added: number; skipped: number }> {
  if (!list.length) return { added: 0, skipped: 0 }
  const drafts: LibDraft[] = list.map((p) => {
    // ⭐ 答案自我完善：没写答案但解析里说了「故选B」这类，就从解析里提出来 ✓
    let answer = p.answer
    let answerFrom: QuestionMeta['answerFrom'] = answer ? 'manual' : ''
    if (!answer && p.solution) {
      const auto = extractAnswerFromSolution(p.solution, p.options)
      if (auto) { answer = auto; answerFrom = 'auto' }
    }
    const q = withDefaults({
      stem: p.stem, options: p.options, answer, solution: p.solution,
      knowledge: p.knowledge, difficulty: p.difficulty,
      // ⚠ 年份有两个来源：【年份】标记（yearExplicit）与【来源】里抠出来的（year）—— 前者优先
      year: (p as { yearExplicit?: string }).yearExplicit || p.year, region: p.region,
      qtype: (p as { qtype?: QType }).qtype,
      section: (p as { section?: string }).section,
      // ⭐ 题面上写了「本小题满分 15 分」就自动填分值
      score: (p as { scoreExplicit?: number }).scoreExplicit || 0,
      chapter: (p as { chapter?: string }).chapter,
      date: (p as { date?: string }).date,
      paperName: (p as { paperName?: string }).paperName,
      answerFrom,
    })
    return draftOf(q, p.title)
  })
  return libSaveMany(drafts)
}

/* ---------------- 规则组卷（双向细目表）+ 组卷查重 ---------------- */

/** 一条组卷规则（细目表的一行）：条件 + 题量；条件留空表示不限 */
export interface PaperRule {
  id: number
  qtype: QType | ''
  section: string
  chapter: string
  level: Level | ''
  count: number
}

/** 每条规则的命中情况（题量不够时要明确告诉用户，不能悄悄少给） */
export interface RuleResult {
  rule: PaperRule
  got: number
  want: number
  short: boolean
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = a[i]; a[i] = a[j]; a[j] = t
  }
  return a
}

/**
 * 按规则抽题。要点：
 *  - **同一道题只会被抽中一次**（后面规则自动跳过前面已选的）—— 这是查重的第一层；
 *  - 默认**优先抽用得少的**（避免每份卷子都是同样那几道），可切换随机；
 *  - **题量不够时如实回报**（short），不凑数、不重复。
 */
export function pickByRules(
  pool: QuestionEntry[],
  rules: PaperRule[]
): { picked: QuestionEntry[]; results: RuleResult[] } {
  const used = new Set<number>()
  const picked: QuestionEntry[] = []
  const results: RuleResult[] = []
  for (const r of rules) {
    const want = Math.max(0, Math.floor(Number(r.count) || 0))
    if (!want) { results.push({ rule: r, got: 0, want: 0, short: false }); continue }
    let cands = pool.filter((x) =>
      !used.has(x.id) &&
      (!r.qtype || x.q.qtype === r.qtype) &&
      (!r.section || x.q.section === r.section) &&
      (!r.chapter || x.q.chapter === r.chapter) &&
      (!r.level || levelOf(x.q.difficulty) === r.level)
    )
    // 不按「引用次数」排序（用户明确不要这个属性）—— 默认随机，保证每次抽出的卷子不一样
    cands = shuffle(cands)
    const take = cands.slice(0, want)
    for (const x of take) { used.add(x.id); picked.push(x) }
    results.push({ rule: r, got: take.length, want, short: take.length < want })
  }
  return { picked, results }
}

/** 规则的可读描述（用于回报与提示） */
export function ruleText(r: PaperRule): string {
  const parts: string[] = []
  parts.push(r.qtype ? qtypeLabel(r.qtype) : '不限题型')
  parts.push(r.section ? r.section + (r.chapter ? ' / ' + r.chapter : '') : '不限板块')
  parts.push(r.level ? LEVELS.find((l) => l.v === r.level)?.label || '' : '不限难度')
  return parts.join(' · ') + ' × ' + (r.count || 0)
}

/** 归一化题干：去空白、标点、LaTeX 命令与符号 —— 只留正文字符 */
export function normalizeStem(s: string): string {
  return (s || '')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/\s+/g, '')
    .replace(/[，。、；：？！,.;:?!()\[\]（）【】{}《》"'`~·—－-]/g, '')
    .replace(/[{}^_$\\]/g, '')
    .toLowerCase()
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i + 1 < s.length; i++) out.add(s.slice(i, i + 2))
  if (s.length === 1) out.add(s)
  return out
}

/** 字符二元组 Jaccard 相似度（0~1）。中文短文本上比编辑距离稳。 */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const A = bigrams(a), B = bigrams(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const g of A) if (B.has(g)) inter++
  return inter / (A.size + B.size - inter)
}

export interface DupPair {
  a: QuestionEntry
  b: QuestionEntry
  /** 归一化后完全相同 */
  same: boolean
  sim: number
}

/**
 * 在一份卷子里找重复题。两层：
 *  ① **归一化后完全相同** —— 一定是重复；
 *  ② **相似度 ≥ threshold**（默认 0.9）—— 高度相似，多半是同一道题的两次录入。
 * 为避免卡界面，题目超过 400 道时只做第 ① 层（并回报该情况）。
 */
export function findDuplicates(list: QuestionEntry[], threshold = 0.85): { pairs: DupPair[]; skippedNear: boolean } {
  const pairs: DupPair[] = []
  const norm = list.map((x) => normalizeStem(x.q.stem || x.body))
  const groups = new Map<string, number[]>()
  norm.forEach((n, i) => {
    if (!n) return
    const gr = groups.get(n)
    if (gr) gr.push(i)
    else groups.set(n, [i])
  })
  const seen = new Set<string>()
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue
    for (let i = 0; i < idxs.length; i++) {
      for (let j = i + 1; j < idxs.length; j++) {
        const k = idxs[i] + '-' + idxs[j]
        if (seen.has(k)) continue
        seen.add(k)
        pairs.push({ a: list[idxs[i]], b: list[idxs[j]], same: true, sim: 1 })
      }
    }
  }
  const skippedNear = list.length > 400
  if (!skippedNear) {
    for (let i = 0; i < list.length; i++) {
      if (!norm[i]) continue
      for (let j = i + 1; j < list.length; j++) {
        if (!norm[j]) continue
        if (norm[i] === norm[j]) continue
        const k = i + '-' + j
        if (seen.has(k)) continue
        const s = similarity(norm[i], norm[j])
        if (s >= threshold) {
          seen.add(k)
          pairs.push({ a: list[i], b: list[j], same: false, sim: s })
        }
      }
    }
  }
  return { pairs, skippedNear }
}
/* ---------------- 整套（按年份 + 试卷名） ---------------- */

export interface PaperGroup {
  year: string
  paperName: string
  count: number
  items: QuestionEntry[]
}

/** 键：年份 + 试卷名。任缺其一用占位，保证也能成组。 */
export function paperKey(year: string, paperName: string): string {
  return (year || '未标年份') + '||' + (paperName || '未标试卷名')
}

/** 把题库按「年份 + 试卷名」归组，供整套插入用（组内按 id 保持录入顺序） */
export function groupPapers(list: QuestionEntry[]): PaperGroup[] {
  const map = new Map<string, PaperGroup>()
  for (const x of list) {
    const k = paperKey(x.q.year, x.q.paperName)
    const g = map.get(k)
    if (g) { g.items.push(x); g.count++ }
    else map.set(k, { year: x.q.year, paperName: x.q.paperName, count: 1, items: [x] })
  }
  const arr = Array.from(map.values())
  arr.forEach((g) => g.items.sort((a, b) => a.id - b.id))
  arr.sort((a, b) => (b.year || '').localeCompare(a.year || '') || (a.paperName || '').localeCompare(b.paperName || ''))
  return arr
}

/** 整套卷子的文本：抬头 + 按 选择→填空→解答 排序的题目 */
export function paperGroupToText(g: PaperGroup, withSolution = false, startNo = 1): string {
  const head = (g.year ? g.year + ' 年 ' : '') + (g.paperName || '未命名试卷')
  return buildPaperText(g.items, { withSolution, title: head, startNo })
}

/* ---------------- 清理与批量删除 ---------------- */

export interface JunkItem {
  entry: QuestionEntry
  reason: string
}

/**
 * 扫描全库，找出**疑似不是题目**的条目（复用导入时的同一套判据）。
 * 只给出建议，**不自动删** —— 由用户勾选确认。
 */
export function scanJunk(list: QuestionEntry[]): JunkItem[] {
  const out: JunkItem[] = []
  for (const x of list) {
    const j = judgeNonQuestion(x.q.stem || x.body)
    if (j.bad) { out.push({ entry: x, reason: j.reason }); continue }
    if (!(x.q.stem || x.body || '').trim()) out.push({ entry: x, reason: '题干为空' })
  }
  return out
}

/** 扫描全库，找出**重复题**（归一化后相同或高度相似） */
export function scanDuplicates(list: QuestionEntry[]): JunkItem[] {
  const { pairs } = findDuplicates(list)
  const seen = new Set<number>()
  const out: JunkItem[] = []
  for (const p of pairs) {
    // 一对重复里**保留一条**（id 小的留着），另一条建议删
    const del = p.a.id < p.b.id ? p.b : p.a
    if (seen.has(del.id)) continue
    seen.add(del.id)
    out.push({ entry: del, reason: p.same ? '与 #' + (del.id === p.a.id ? p.b.id : p.a.id) + ' 完全相同' : '与 #' + (del.id === p.a.id ? p.b.id : p.a.id) + ' 相似 ' + Math.round(p.sim * 100) + '%' })
  }
  return out
}

/** 批量删除（逐条调 Rust；返回成功条数） */
export async function removeQuestions(ids: number[]): Promise<number> {
  let n = 0
  for (const id of ids) {
    try {
      if (await libRemove(id)) n++
    } catch { /* 单条失败不影响其余 */ }
  }
  return n
}

/* ---------------- 整库导入导出（JSON） ---------------- */

/** 导出文件的格式标记（导入时用它判断是不是我们的题库文件） */
export const QBANK_FORMAT = 'lj-mathslides-question-bank'

/** 把题库导出成 JSON 文本（含全部结构化字段，可在别的机器导入） */
export function exportQuestionsJson(list: QuestionEntry[]): string {
  return JSON.stringify({
    type: QBANK_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    count: list.length,
    questions: list.map((x) => ({ title: x.title, ...x.q })),
  }, null, 2)
}

/**
 * 解析题库 JSON。**容忍三种写法**：
 *   ① { questions: [...] }（我们自己导出的）
 *   ② { items: [...] }（别的工具常见写法）
 *   ③ 直接一个数组 [...]
 * 每条只需有题干（stem / body / text 任一）即可，其余缺了就补默认。
 */
export function parseQuestionsJson(text: string): { list: ParsedQuestion[]; error?: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { list: [], error: '不是合法的 JSON（可能选错了文件）' }
  }
  let arr: unknown[] = []
  if (Array.isArray(raw)) {
    arr = raw
  } else if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    if (Array.isArray(o.questions)) arr = o.questions
    else if (Array.isArray(o.items)) arr = o.items
    else return { list: [], error: 'JSON 里找不到 questions 或 items 数组' }
  } else {
    return { list: [], error: 'JSON 结构不认识（既不是数组也不是对象）' }
  }
  const arrOf = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : [])
  const list: ParsedQuestion[] = []
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    const stem = String(o.stem || o.body || o.text || '').trim()
    if (!stem) continue
    const title = String(o.title || '').trim()
    list.push({
      title: title || (stem.length > 20 ? stem.slice(0, 20) + '…' : stem),
      stem,
      options: arrOf(o.options),
      answer: String(o.answer || '').trim(),
      solution: String(o.solution || o.analysis || '').trim(),
      knowledge: arrOf(o.knowledge || o.tags),
      difficulty: Number(o.difficulty) || 3,
      qtype: o.qtype ? String(o.qtype) : undefined,
      section: o.section ? String(o.section) : undefined,
      date: o.date ? String(o.date) : undefined,
      year: String(o.year || ''),
      region: String(o.region || o.source || ''),
    })
  }
  if (!list.length) return { list: [], error: '没有解析出任何试题（每条至少要有题干）' }
  return { list }
}

/* ---------------- 展示与筛选 ---------------- */

export function autoTitle(q: QuestionMeta): string {
  const first = (q.stem || '').split('\n').map((s) => s.trim()).filter(Boolean)[0] || '未命名试题'
  const t = first.replace(/\s+/g, ' ')
  return t.length > 16 ? t.slice(0, 16) + '…' : t
}

/** 组卷用文本（答案与解析可选）。选择题单独编号，解答题留作答空间 */
/**
 * 各题型的默认分值（按新高考常见配比）：单选/多选 5 分、填空 5 分、解答 12 分。
 * 题目自己填了 score 就用它，没填才用默认。
 */
export const DEFAULT_SCORE: Record<QType, number> = { choice: 5, multi: 5, blank: 5, answer: 12 }

export function defaultScore(t: QType | string): number {
  return DEFAULT_SCORE[t as QType] ?? 5
}

/** 取某题的实际分值（题内优先，否则按题型默认） */
export function scoreOf(x: QuestionEntry): number {
  const n = Number(x.q.score)
  return n > 0 ? n : defaultScore(x.q.qtype)
}

/* ---------------- 组卷排版（按题型分段 + 分值 + 总分） ---------------- */

/** 分段：选择（单选与多选合并）/ 填空 / 解答 */
const SEGMENTS: { label: string; types: QType[] }[] = [
  { label: '选择题', types: ['choice', 'multi'] },
  { label: '填空题', types: ['blank'] },
  { label: '解答题', types: ['answer'] },
]
const CN_NUM = ['一', '二', '三', '四', '五', '六']

/**
 * 把一组题排成一份卷子：抬头 +（共 N 题，满分 M 分）+ 按题型分段 + 每题带（x分）。
 * 规则组卷与整套插入**共用这一个函数**，保证两处排版完全一致。
 */
export function buildPaperText(
  entries: QuestionEntry[],
  opt: { withSolution?: boolean; title?: string; startNo?: number } = {}
): string {
  const arr = [...entries]
  if (!arr.length) return ''
  const total = arr.reduce((s, x) => s + scoreOf(x), 0)
  const out: string[] = []
  if (opt.title) out.push(opt.title, '')
  out.push('（共 ' + arr.length + ' 题，满分 ' + total + ' 分）', '')
  let no = opt.startNo ?? 1
  let seg = 0
  for (const sg of SEGMENTS) {
    const items = arr.filter((x) => sg.types.indexOf(x.q.qtype) >= 0)
    if (!items.length) continue
    const segTotal = items.reduce((s, x) => s + scoreOf(x), 0)
    const per = Array.from(new Set(items.map((x) => scoreOf(x))))
    const perTxt = per.length === 1 ? '每题 ' + per[0] + ' 分，' : ''
    out.push(CN_NUM[seg] + '、' + sg.label + '（' + perTxt + '共 ' + segTotal + ' 分）', '')
    seg++
    for (const x of items) {
      const body = questionToText(x, opt.withSolution).replace(/^\s*\d{1,3}\s*[.、．)）]\s*/, '')
      out.push(no + '.（' + scoreOf(x) + '分）' + body, '')
      no++
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

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

export interface FilterOpt {
  q?: string
  tags?: string[]
  difficulty?: number | null
  qtype?: QType | ''
  section?: string | ''
  chapter?: string | ''
  level?: Level | ''
  onlyMissingAnswer?: boolean
  year?: string
  paperName?: string
}

export function filterQuestions(list: QuestionEntry[], opt: FilterOpt): QuestionEntry[] {
  const k = (opt.q || '').trim().toLowerCase()
  const tags = opt.tags || []
  return list.filter((x) => {
    if (opt.difficulty && x.q.difficulty !== opt.difficulty) return false
    if (opt.qtype && x.q.qtype !== opt.qtype) return false
    if (opt.section && x.q.section !== opt.section) return false
    if (opt.chapter && x.q.chapter !== opt.chapter) return false
    if (opt.level && levelOf(x.q.difficulty) !== opt.level) return false
    if (opt.onlyMissingAnswer && x.q.answer.trim()) return false
    if (opt.year && x.q.year !== opt.year) return false
    if (opt.paperName && x.q.paperName !== opt.paperName) return false
    if (tags.length && !tags.every((t) => x.q.knowledge.indexOf(t) >= 0 || x.tags.indexOf(t) >= 0)) return false
    if (!k) return true
    return (
      x.title.toLowerCase().includes(k) ||
      x.q.stem.toLowerCase().includes(k) ||
      x.q.answer.toLowerCase().includes(k) ||
      x.q.solution.toLowerCase().includes(k) ||
      x.tags.toLowerCase().includes(k) ||
      x.q.section.toLowerCase().includes(k) ||
      x.q.year.toLowerCase().includes(k) ||
      x.q.paperName.toLowerCase().includes(k) ||
      x.q.chapter.toLowerCase().includes(k)
    )
  })
}
