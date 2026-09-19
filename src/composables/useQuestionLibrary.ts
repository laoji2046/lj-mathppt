/**
 * 试题库 —— 第二期建立，第三期后扩充（日期/题型/板块/难度分级/答案自我完善）。
 *
 * 复用通用表（library_item，type='question'），结构化字段放 meta：
 *   { stem, options[], answer, solution, knowledge[],
 *     qtype, section, date, difficulty, year, region, answerFrom, images[] }
 *
 * images：题干里 [图N] 对应的插图（自包含 data URL）。MinerU 导入 PDF 时才有；
 * 老数据没有这个字段，readImages 一律容错成空数组。
 *
 * 设计取舍：
 *  - 检索先用 LIKE + 分类过滤，够用；FTS5 留到需要时再评估（中文分词效果一般）。
 *  - 题目文本不拆分：题干/答案/解析各存一段纯文本，可写 LaTeX（$...$）与 [图N]。
 *  - **难度内部仍存 1-5**（兼容旧数据），界面按 易/中/难 三档呈现与筛选。
 */
import { libQuery, libSave, libRemove, libBump, libTags, libSaveMany } from './useLibrary'
import type { ParsedQuestion, QuestionImage } from './parseQuestions'
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
  '不等式',
  '函数与导数',
  '三角函数与解三角形',
  '平面向量与复数',
  '数列',
  '立体几何',
  '解析几何',
  '计数原理与概率统计',
  '成对数据与统计案例',
  '未分类',          // ⚠ 必须有这一项：猜不出板块的题也得**看得见**（否则点了任何板块都看不到它 ✗）
]

/** 旧板块名 → 新板块名（老库里存的是旧名，筛选/展示时归一化，免得老题"消失"） */
export const SECTION_ALIAS: Record<string, string> = {
  '三角函数与向量': '三角函数与解三角形',
  '概率与统计': '计数原理与概率统计',
}

/** 板块名归一化：空 → '未分类'；旧名 → 新名；不认识的名字 → '未分类' */
export function normSection(s: string | undefined): string {
  const v = (s || '').trim()
  if (!v) return '未分类'
  if (SECTIONS.indexOf(v) >= 0) return v
  return SECTION_ALIAS[v] || '未分类'
}

/** 板块关键词 + **权重**（用于自动归类）。
 *  ⚠ 老做法是"命中即返回、看顺序" → 「已知函数 f(x)=sin2x−√3cos2x…」命中"函数"就被判成
 *    **函数与导数** ✗（实测真卷就这样）。改成**打分**：专有名词(5) > 结构词(3) > 泛词(1)，
 *    泛词只加分、不足以单独定类；最高分太低或并列 → **未分类**（宁可不判，也不判错）。 */
export const SECTION_HINTS: { section: string; words: [string, number][] }[] = [
  { section: '集合与逻辑', words: [['集合', 5], ['子集', 4], ['交集', 4], ['并集', 4], ['补集', 4], ['充要', 5], ['充分', 3], ['必要', 3], ['量词', 4], ['命题', 2], ['逻辑', 3]] },
  { section: '不等式', words: [['基本不等式', 5], ['不等式', 5], ['恒成立', 3], ['取值范围', 1]] },
  { section: '函数与导数', words: [['导数', 5], ['\\log', 4], ['\\ln', 4], ['\\sqrt', 1], ['展开式', 4], ['项的系数', 4], ['二项', 5], ['单调性', 3], ['单调', 3], ['奇偶', 4], ['周期', 3], ['定义域', 3], ['值域', 3], ['指数函数', 4], ['对数函数', 4], ['幂函数', 4], ['零点', 3], ['极值', 4], ['切线', 3], ['最值', 2], ['函数', 1]] },
  { section: '三角函数与解三角形', words: [['\\sin', 4], ['\\cos', 4], ['\\tan', 4], ['\\triangle', 3], ['三角函数', 5], ['解三角形', 5], ['正弦定理', 5], ['余弦定理', 5], ['三角恒等', 5], ['正弦', 4], ['余弦', 4], ['正切', 4], ['弧度', 3], ['图像变换', 3]] },
  { section: '平面向量与复数', words: [['overrightarrow', 5], ['\\vec', 5], ['向量', 5], ['数量积', 4], ['共线', 3], ['夹角', 2], ['复数', 5], ['共轭', 4], ['虚部', 4], ['实部', 4]] },
  { section: '数列', words: [['等差数列', 5], ['等比数列', 5], ['数列', 5], ['通项', 4], ['前n项和', 5], ['递推', 4]] },
  { section: '立体几何', words: [['二面角', 5], ['异面', 5], ['棱柱', 4], ['棱锥', 4], ['棱台', 4], ['圆柱', 4], ['圆锥', 4], ['三视图', 4], ['表面积', 3], ['立体', 4], ['体积', 2], ['空间', 2]] },
  { section: '解析几何', words: [['椭圆', 5], ['双曲线', 5], ['抛物线', 5], ['离心率', 5], ['渐近线', 5], ['准线', 4], ['焦点', 3], ['斜率', 2], ['圆', 2], ['直线', 1]] },
  { section: '计数原理与概率统计', words: [['分布列', 5], ['二项式', 5], ['条件概率', 5], ['独立性检验', 5], ['概率', 5], ['期望', 4], ['方差', 4], ['抽样', 4], ['随机', 3], ['排列', 3], ['组合', 3]] },
  { section: '成对数据与统计案例', words: [['相关系数', 5], ['成对数据', 5], ['回归', 5], ['残差', 4], ['散点图', 4], ['列联表', 4]] },
]

/** 按关键词**打分**猜板块（题干 + 知识点一起看）；判不准返回 '未分类' */
export function guessSection(text: string, knowledge: string[] = []): string {
  const hay = (text + ' ' + knowledge.join(' ')).toLowerCase()
  const score: Record<string, number> = {}
  for (const h of SECTION_HINTS) {
    for (const [w, wt] of h.words) {
      const key = w.toLowerCase()
      let idx = hay.indexOf(key)
      let n = 0
      while (idx >= 0 && n < 5) { n++; idx = hay.indexOf(key, idx + key.length) }
      if (n) score[h.section] = (score[h.section] || 0) + wt * Math.min(n, 3)
    }
  }
  const rank = Object.entries(score).sort((a, b) => b[1] - a[1])
  if (!rank.length || rank[0][1] < 4) return '未分类'            // 只命中泛词 → 不判
  if (rank[1] && rank[1][1] === rank[0][1]) return '未分类'       // 并列第一 → 不判
  return rank[0][0]
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
  '不等式': ['一元二次不等式', '基本不等式', '恒成立问题'],
  '平面向量与复数': ['平面向量', '复数'],
  '数列': ['等差数列', '等比数列', '数列求和', '递推数列'],
  '计数原理与概率统计': ['计数原理', '二项式定理', '概率', '随机变量及其分布', '统计'],
  '成对数据与统计案例': ['成对数据的统计分析', '回归分析', '独立性检验'],
  '三角函数与解三角形': ['三角函数', '三角恒等变换', '解三角形', '三角函数的图像与性质'],
  '未分类': [],
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
  /**
   * 题干里 [图N] 对应的插图（**自包含 data URL**，见 parseQuestions.ts 的 QuestionImage）。
   * 可选 —— 老题没有这个字段，读出来一律容错成空数组；只有 MinerU 导入的题才有。
   */
  images?: QuestionImage[]
}

export interface QuestionEntry extends LibItem {
  q: QuestionMeta
}

const EMPTY_META: QuestionMeta = {
  stem: '', options: [], answer: '', solution: '',
  knowledge: [], difficulty: 3, score: 0, qtype: 'choice', section: '', chapter: '', date: '',
  year: '', paperName: '', region: '', answerFrom: '', images: [],
}

/**
 * 读插图数组：**老数据没有 images 字段**，一律容错成空数组 ——
 * 这次改动不能让库里已有的题读不出来（每条都要能过）。
 */
function readImages(v: unknown): QuestionImage[] {
  if (!Array.isArray(v)) return []
  const out: QuestionImage[] = []
  for (const it of v) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    const n = Number(o.n)
    const src = String(o.src || '')
    if (!Number.isFinite(n) || n <= 0 || !src) continue
    out.push({ n, src, caption: o.caption ? String(o.caption) : undefined })
  }
  return out.sort((a, b) => a.n - b.n)
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
    images: readImages(m.images),
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
  // images 一定要是数组：{ ...EMPTY_META, ...meta } 会把 undefined 也盖上去（老调用方没传）
  if (!Array.isArray(q.images)) q.images = []
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
    const keptFrom = (p as { answerFrom?: QuestionMeta['answerFrom'] }).answerFrom
    let answerFrom: QuestionMeta['answerFrom'] = keptFrom || (answer ? 'manual' : '')
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
      images: (p as { images?: QuestionImage[] }).images,
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
    // ⚠ 以前只回读题干/选项/答案/解析/知识点/难度/题型/板块/日期/年份/来源 ——
    //    **试卷名 / 章节 / 分值 / 答案来源全丢了**：换台机器导入后，整套归组、章节筛选、
    //    分值合计全错（用户实报"导出的再导入就不对了"）。这里按导出格式逐字回读。
    const p: ParsedQuestion = {
      title: title || (stem.length > 20 ? stem.slice(0, 20) + '…' : stem),
      stem,
      options: arrOf(o.options),
      answer: String(o.answer || '').trim(),
      solution: String(o.solution || o.analysis || '').trim(),
      knowledge: arrOf(o.knowledge || o.tags),
      difficulty: Number(o.difficulty) || 3,
      qtype: o.qtype ? String(o.qtype) : undefined,
      section: o.section ? String(o.section) : undefined,
      chapter: o.chapter ? String(o.chapter) : undefined,
      date: o.date ? String(o.date) : undefined,
      year: String(o.year || ''),
      yearExplicit: o.year ? String(o.year) : undefined,
      paperName: o.paperName ? String(o.paperName) : undefined,
      region: String(o.region || o.source || ''),
    }
    const imgs = readImages(o.images)
    if (imgs.length) p.images = imgs
    const sc = Number(o.score)
    if (Number.isFinite(sc) && sc > 0) p.scoreExplicit = sc
    // 「答案从哪来」也要保住：否则自动提取（auto）的题导入后会被当成手填
    const af = String(o.answerFrom || '')
    if (af === 'auto' || af === 'manual' || af === 'bank') (p as { answerFrom?: string }).answerFrom = af
    list.push(p)
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

/** 「这题还要人核对吗」——**按字段现算**，不额外存状态（老师改完就自动消失 ✓）。
 *  顺序按"最好改"排：选项不全 → 没答案 → 题干过短（像残块）。返回 '' = 没问题。 */
export function reviewWarn(q: { stem?: string; options?: string[]; answer?: string; qtype?: string }): string {
  const opts = q.options || []
  if (opts.some((o) => !o.trim() || o.indexOf('识别缺失') >= 0)) return '选项里有空位（识别缺失），请补上'
  if ((q.qtype === 'choice' || q.qtype === 'multi') && opts.length < 4) {
    return '选择题但只有 ' + opts.length + ' 个选项，请核对（可能是识别时被并进公式了）'
  }
  if (!(q.answer || '').trim()) return '没有答案，请补充或从解析里提取'
  if ((q.stem || '').trim().length < 8) return '题干过短，可能是被切碎的残块'
  return ''
}

/** 双向细目表：行 = 板块（含"未分类"）、列 = 难度 1..5；每格 = 题数 / 分值。
 *  组卷时一眼看出"哪些板块/难度还没覆盖"——这是老师说的"双向细目表"。 */
export function blueprintOf(items: QuestionEntry[]): {
  rows: { section: string; cells: { count: number; score: number }[]; count: number; score: number }[]
  cols: number[]
  count: number
  score: number
} {
  const cols = [1, 2, 3, 4, 5]
  const map = new Map<string, { count: number; score: number }[]>()
  let count = 0, score = 0
  for (const it of items) {
    const sec = normSection(it.q.section)
    if (!map.has(sec)) map.set(sec, cols.map(() => ({ count: 0, score: 0 })))
    const d = Math.max(1, Math.min(5, Math.round(it.q.difficulty || 3)))
    const sc = scoreOf(it)
    const cell = map.get(sec)![d - 1]
    cell.count += 1
    cell.score += sc
    count += 1
    score += sc
  }
  // 行序跟着 SECTIONS 走（未分类放最后），这样和筛选条的顺序一致
  const order = SECTIONS.slice()
  const rows = Array.from(map.entries())
    .sort((a, b) => (order.indexOf(a[0]) + 100) % 1000 - (order.indexOf(b[0]) + 100) % 1000)
    .map(([section, cells]) => ({
      section, cells,
      count: cells.reduce((n, c) => n + c.count, 0),
      score: cells.reduce((n, c) => n + c.score, 0),
    }))
  return { rows, cols, count, score }
}

/** 题库健康度（一眼看到"库怎么样"）：总量 / 未分类 / 缺答案 / 待核对 / 含图 */
export function healthOf(items: QuestionEntry[]): { total: number; unclassified: number; noAnswer: number; todo: number; withImage: number } {
  let unclassified = 0, noAnswer = 0, todo = 0, withImage = 0
  for (const it of items) {
    if (normSection(it.q.section) === '未分类') unclassified += 1
    if (!(it.q.answer || '').trim()) noAnswer += 1
    if (reviewWarn(it.q)) todo += 1
    if ((it.q.images || []).length) withImage += 1
  }
  return { total: items.length, unclassified, noAnswer, todo, withImage }
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
  /** 只看"待核对"的题（选项不全 / 没答案 / 题干过短）—— 见 reviewWarn() */
  review?: boolean
  /** 只看**带图**的题（题干里有 [图N]） */
  onlyImage?: boolean
  year?: string
  paperName?: string
}

export function filterQuestions(list: QuestionEntry[], opt: FilterOpt): QuestionEntry[] {
  const k = (opt.q || '').trim().toLowerCase()
  const tags = opt.tags || []
  return list.filter((x) => {
    if (opt.difficulty && x.q.difficulty !== opt.difficulty) return false
    if (opt.qtype && x.q.qtype !== opt.qtype) return false
    // ⚠ 老题库里存的是旧板块名 / 空 → 这里**归一化**再比，否则老题在"新分类"下永远筛不到 ✗
    if (opt.section && normSection(x.q.section) !== opt.section) return false
    if (opt.chapter && x.q.chapter !== opt.chapter) return false
    if (opt.level && levelOf(x.q.difficulty) !== opt.level) return false
    if (opt.onlyMissingAnswer && x.q.answer.trim()) return false
    if (opt.review && !reviewWarn(x.q)) return false          // 只看"待核对"的（选项不全/没答案/题干过短）
    if (opt.onlyImage && !(x.q.images || []).length) return false
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
