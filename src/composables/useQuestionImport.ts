/**
 * 试题录入（M4）—— **导入侧**数据层：MD / JSON / PDF(MinerU) → 校对表 → 入库
 *
 * 纪律（沿用 useQuestionBank）：
 *  - 解析 / 默认值 / 映射都是**纯函数**，好测；导出 JSON 与回读用**同一份格式** ✓
 *  - 入库只走 lib_save_many（Rust 侧事务 + 按 body 去重）✓
 *  - 大图转资源（assetId）：题库不存磁盘路径，换机器也不丢图 ✓
 *  - 板块/难度档与 useQuestionBank 同一套口径（**不另起一套**，否则筛选筛不到 ✗）
 */
import { parseQuestionsWithInfo, setContentList, detectPaperInfo } from './parseQuestions'
import type { ParsedQuestion, QuestionImage } from './parseQuestions'
import { libSaveMany } from './useLibrary'
import type { LibDraft } from './useLibrary'
import { saveAsset } from './useAssets'
import { SECTIONS } from './useQuestionBank'

export type QType = 'choice' | 'multi' | 'blank' | 'answer' | 'proof'

const QTYPES: QType[] = ['choice', 'multi', 'blank', 'answer', 'proof']

/**
 * 旧板块名 → 新板块名。老库/别处导出的 JSON 里存的是旧名，
 * 直接写进库会在筛选树里多出个**孤儿板块**（点它筛不到、也不能选）✗ —— 一律先归一化 ✓
 */
const SECTION_ALIAS: Record<string, string> = {
  '三角函数与解三角形': '三角函数与向量',
  '平面向量与复数': '三角函数与向量',
  '计数原理与概率统计': '概率与统计',
  '成对数据与统计案例': '概率与统计',
}

/** 板块名归一化：空 / 不认识 → ''（未归类，交给校对表让老师选）✓ */
export function normSection(s: string | undefined): string {
  const v = String(s || '').trim()
  if (!v) return ''
  if (SECTIONS.indexOf(v) >= 0) return v
  return SECTION_ALIAS[v] || ''
}

/** 与题库导出/导入共用的格式标记 */
export const QBANK_FORMAT = 'lj-mathslides-question-bank'

/** 1-5 难度 → 难度档（库里 meta.level 的口径：基础 / 中档 / 拔高） */
export function levelOfDifficulty(d: number): string {
  const n = Number(d) || 3
  if (n <= 2) return '基础'
  if (n >= 4) return '拔高'
  return '中档'
}

/* ---------------- 板块自动归类 ---------------- */

/**
 * 板块关键词 + **权重**（专有名词 5 > 结构词 3 > 泛词 1）。
 * 打分制：泛词只加分、不足以单独定类；最高分太低或并列 → 未分类（宁可不判，也不判错 ✓）。
 * ⚠ 板块名必须与 useQuestionBank.SECTIONS 一致（改一边要改另一边）。
 */
const SECTION_HINTS: { section: string; words: [string, number][] }[] = [
  { section: '集合与逻辑', words: [['集合', 5], ['子集', 4], ['交集', 4], ['并集', 4], ['补集', 4], ['充要', 5], ['充分', 3], ['必要', 3], ['量词', 4], ['命题', 2], ['逻辑', 3]] },
  { section: '不等式', words: [['基本不等式', 5], ['不等式', 5], ['恒成立', 3], ['取值范围', 1]] },
  { section: '函数与导数', words: [['导数', 5], ['\\log', 4], ['\\ln', 4], ['单调性', 3], ['单调', 3], ['奇偶', 4], ['周期', 3], ['定义域', 3], ['值域', 3], ['指数函数', 4], ['对数函数', 4], ['幂函数', 4], ['零点', 3], ['极值', 4], ['切线', 3], ['最值', 2], ['函数', 1]] },
  { section: '三角函数与向量', words: [['\\sin', 4], ['\\cos', 4], ['\\tan', 4], ['\\triangle', 3], ['三角函数', 5], ['解三角形', 5], ['正弦定理', 5], ['余弦定理', 5], ['三角恒等', 5], ['正弦', 4], ['余弦', 4], ['正切', 4], ['弧度', 3], ['向量', 5], ['\\vec', 5], ['数量积', 4], ['共线', 3], ['夹角', 2]] },
  { section: '数列', words: [['等差数列', 5], ['等比数列', 5], ['数列', 5], ['通项', 4], ['前n项和', 5], ['递推', 4]] },
  { section: '立体几何', words: [['二面角', 5], ['异面', 5], ['棱柱', 4], ['棱锥', 4], ['棱台', 4], ['圆柱', 4], ['圆锥', 4], ['三视图', 4], ['表面积', 3], ['立体', 4], ['体积', 2], ['空间', 2]] },
  { section: '解析几何', words: [['椭圆', 5], ['双曲线', 5], ['抛物线', 5], ['离心率', 5], ['渐近线', 5], ['准线', 4], ['焦点', 3], ['斜率', 2], ['圆', 2], ['直线', 1]] },
  { section: '复数', words: [['复数', 5], ['共轭', 4], ['虚部', 4], ['实部', 4], ['虚数', 4]] },
  { section: '计数原理', words: [['二项式', 5], ['排列', 4], ['组合', 4], ['计数', 4], ['项的系数', 4]] },
  { section: '概率与统计', words: [['分布列', 5], ['条件概率', 5], ['独立性检验', 5], ['相关系数', 5], ['成对数据', 5], ['回归', 5], ['概率', 5], ['期望', 4], ['方差', 4], ['抽样', 4], ['随机', 3], ['残差', 4], ['散点图', 4], ['列联表', 4]] },
]

/** 按关键词打分猜板块（题干 + 知识点一起看）；判不准返回空串（界面显示「未归类」） */
export function guessSection(text: string, knowledge: string[] = []): string {
  const hay = (String(text || '') + ' ' + (knowledge || []).join(' ')).toLowerCase()
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
  if (!rank.length || rank[0][1] < 4) return ''
  if (rank[1] && rank[1][1] === rank[0][1]) return ''
  return SECTIONS.indexOf(rank[0][0]) >= 0 ? rank[0][0] : ''
}

/* ---------------- 题型 / 答案推断 ---------------- */

/** 有选项 → 选择（答案多字母 = 多选）；有下划线/空括号 → 填空；题干说「证明」→ 证明；否则解答 */
export function inferQType(m: { options?: string[]; answer?: string; stem?: string }): QType {
  const opts = m.options || []
  const ans = (m.answer || '').toUpperCase().replace(/[^A-H]/g, '')
  if (opts.length >= 2) return ans.length > 1 ? 'multi' : 'choice'
  if (/_{2,}|＿{2,}|（\s*）|\(\s*\)|____/.test(m.stem || '')) return 'blank'
  if (/证明/.test(m.stem || '')) return 'proof'
  return 'answer'
}

/**
 * 从解析里反推答案。**只在明确表述上认**（故选B / 应选B / 正确答案是B / 选：B…），
 * 不做模糊猜测 —— 猜错比留空更糟（老师会直接信它 ✗）。
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
      if (options.length && letters.split('').some((c) => c.charCodeAt(0) - 65 >= options.length)) continue
      if (letters) return letters
    }
  }
  return ''
}

/* ---------------- 题目 meta（与 lib_sync_qcols 的键一致） ---------------- */

export interface QMeta {
  stem: string
  options: string[]
  answer: string
  solution: string
  knowledge: string[]
  /** 1-5 */
  difficulty: number
  /** 基础 / 中档 / 拔高（真列 level） */
  level: string
  /** choice / multi / blank / answer / proof（真列 qtype） */
  qtype: QType
  /** 板块（真列 section）；空 = 未归类 */
  section: string
  chapter: string
  /** YYYY-MM-DD */
  date: string
  /** 年份（真列 year，INTEGER） */
  year: number
  /** 试卷名 / 来源（真列 paper，键名必须是 paperName ✓） */
  paperName: string
  region: string
  score: number
  /** 【v1470】题内序号 = 卷面上的「第 N 题」（导入时从原文记下来 ✓；老数据没有 → 0 ✓） */
  no?: number
  answerFrom: '' | 'manual' | 'auto' | 'ai'
  images?: QuestionImage[]
  /** 识别时的告警（AI JSON 的 warnings，如「本题含 2 个空，分值未按空拆分」）✓ */
  warn?: string
}

const EMPTY_META: QMeta = {
  stem: '', options: [], answer: '', solution: '', knowledge: [], difficulty: 3, level: '',
  qtype: 'answer', section: '', chapter: '', date: '', year: 0, paperName: '', region: '',
  score: 0, no: 0, answerFrom: '', images: [], warn: '',
}

function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

/** 补默认：日期 / 题型 / 板块 / 难度档 都在这儿补齐（入库前只走这一条 ✓） */
export function withDefaults(meta: Partial<QMeta>): QMeta {
  const q: QMeta = { ...EMPTY_META, ...meta }
  if (!q.date) q.date = today()
  if (!q.qtype || QTYPES.indexOf(q.qtype) < 0) q.qtype = inferQType(q)
  q.section = normSection(q.section)
  if (!q.section) q.section = guessSection(q.stem, q.knowledge)
  if (!q.level) q.level = levelOfDifficulty(q.difficulty)
  if (!Array.isArray(q.images)) q.images = []
  if (q.answer && !q.answerFrom) q.answerFrom = 'manual'
  return q
}

/** 题干首行做标题 */
export function autoTitle(q: { stem?: string }): string {
  const first = (q.stem || '').split('\n').map((s) => s.trim()).filter(Boolean)[0] || '未命名试题'
  const t = first.replace(/\s+/g, ' ')
  return t.length > 16 ? t.slice(0, 16) + '…' : t
}

/** 超过这个长度的 data URL 才转资源（小图直接内联，省一次 IO） */
const BIG_IMAGE = 16384

/** 大图转资源（assetId）；失败就原样内联（**不丢图** ✓） */
async function leanImages(imgs?: QuestionImage[]): Promise<QuestionImage[]> {
  if (!imgs || !imgs.length) return []
  const out: QuestionImage[] = []
  for (const im of imgs) {
    if (im.src && im.src.length > BIG_IMAGE) {
      const id = im.assetId || await saveAsset(im.src)
      if (id) { out.push({ n: im.n, src: '', assetId: id, caption: im.caption }); continue }
    }
    out.push({ ...im })
  }
  return out
}

function draftOf(q: QMeta, title: string, id = 0): LibDraft {
  return {
    id: id > 0 ? id : undefined,
    type: 'question',
    title: (title || '').trim() || autoTitle(q),
    body: q.stem,
    meta: q as unknown as Record<string, unknown>,
    tags: [q.section, ...q.knowledge].filter(Boolean).join(','),
    source: q.region || (q.year ? String(q.year) : '') || q.date || '自建',
    builtin: 0,
  }
}

/** ParsedQuestion → 题目 meta（年份/分值/答案来源都按**显式字段优先** ✓） */
export function metaOfParsed(p: ParsedQuestion): QMeta {
  let answer = p.answer || ''
  // 【v1531】JSON 里写了 answerFrom（auto/ai/manual）就用它 —— 以前一律按「有答案 = manual」覆盖 ✗
  //   （结果是「自动提取」的标注在导出→导入后全变成「手动」）
  const afIn = String(p.answerFrom || '')
  let answerFrom: QMeta['answerFrom'] = (afIn === 'auto' || afIn === 'ai' || afIn === 'manual') ? afIn : (answer ? 'manual' : '')
  // 答案自我完善：没写答案但解析里说了「故选B」→ 提出来，并标 auto（界面按「自动提取」显示 ✓）
  if (!answer && p.solution) {
    const auto = extractAnswerFromSolution(p.solution, p.options)
    if (auto) { answer = auto; answerFrom = 'auto' }
  }
  return withDefaults({
    stem: p.stem,
    options: p.options || [],
    answer,
    solution: p.solution || '',
    knowledge: p.knowledge || [],
    difficulty: Number(p.difficulty) || 3,
    qtype: (p.qtype as QType) || undefined as unknown as QType,
    section: p.section || '',
    chapter: p.chapter || '',
    date: p.date || '',
    year: Number(p.yearExplicit || p.year) || 0,
    paperName: p.paperName || '',
    level: p.level || '',
    region: p.region || '',
    score: Number(p.scoreExplicit) || 0,
    no: Number(p.no) || 0,
    answerFrom,
    images: p.images || [],
    warn: p.warn || '',
  })
}

/** 批量入库：Rust 侧**事务 + 按题干去重**；大图先转资源 ✓ */
export async function importParsedQuestions(list: ParsedQuestion[]): Promise<{ added: number; skipped: number }> {
  if (!list.length) return { added: 0, skipped: 0 }
  const drafts: LibDraft[] = []
  for (const p of list) {
    const q = metaOfParsed(p)
    q.images = await leanImages(q.images)
    drafts.push(draftOf(q, p.title))
  }
  return libSaveMany(drafts)
}
/** 【v5 · P1b】QMeta → 草稿载荷（**只落草稿，不写正式库** ✓；确认入库由草稿箱做） */
export function draftFromMeta(q: QMeta, sourceLabel = '', sourceItemId = '') {
  return {
    sourceItemId,
    sourceLabel,
    stem: q.stem || '',
    options: q.options || [],
    answer: q.answer || '',
    solution: q.solution || '',
    qtype: String(q.qtype || ''),
    section: q.section || '',
    difficulty: Number(q.difficulty) || 0,
    knowledge: q.knowledge || [],
    year: Number(q.year) || 0,
    paper: q.paperName || '',
    warn: q.warn || '',
    images: q.images || [],
    // 【修 v1465】图必须进 extra 才存得下来：Rust 的 import_draft 表只有 extra 这一列能装图
    //   （顶层 images 只被闸门用来**数**张数，不落库 ✗ —— 结果草稿路线把图丢了）
    // 【v1470】题内序号（meta.no）也放 extra —— 同一个原因：draft 表没有 no 这一列 ✓
    extra: q.images && q.images.length
      ? JSON.stringify({ images: q.images, no: q.no || 0, from: 'MinerU' })
      : (q.no ? JSON.stringify({ no: q.no, from: 'MinerU' }) : ''),
  }
}


/* ---------------- 入口：MD / 文本 ---------------- */

/** Markdown / 纯文本 → 题目（先 setContentList，选项救回才找得到原文 ✓） */
export function parseFromMarkdown(text: string): { list: ParsedQuestion[]; skipped: number; detected: ReturnType<typeof detectPaperInfo> } {
  const raw = String(text || '')
  setContentList(raw)
  const r = parseQuestionsWithInfo(raw)
  return { list: r.list, skipped: r.skipped, detected: detectPaperInfo(raw) }
}

/* ---------------- 入口：JSON ---------------- */

/** 导出题库 JSON（与 parseQuestionsJson 同一份格式；默认只带 assetId，体积小 ✓） */
export function exportQuestionsJson(items: { title: string; meta: Record<string, unknown> }[], opt?: { embedImages?: boolean }): string {
  const embed = !!opt?.embedImages
  return JSON.stringify({
    type: QBANK_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    count: items.length,
    imagesEmbedded: embed,
    questions: items.map((x) => ({
      title: x.title,
      ...x.meta,
      images: ((x.meta.images as QuestionImage[] | undefined) || []).map((im) => (embed
        ? { n: im.n, src: im.src, caption: im.caption }
        : { n: im.n, ...(im.assetId ? { assetId: im.assetId } : { src: im.src }), caption: im.caption })),
    })),
  }, null, 2)
}

function readImages(v: unknown): QuestionImage[] {
  if (!Array.isArray(v)) return []
  const out: QuestionImage[] = []
  for (const it of v) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    const n = Number(o.n)
    const src = String(o.src || '')
    const assetId = Number(o.assetId) || 0
    if (!Number.isFinite(n) || n <= 0) continue
    if (!src && !assetId) continue
    out.push({ n, src, assetId: assetId || undefined, caption: o.caption ? String(o.caption) : undefined })
  }
  return out.sort((a, b) => a.n - b.n)
}

/* ---------------- 【v1531 · JSON 导入容错】真实世界里的 JSON 长得五花八门 ----------------
 * 用户报「json 导入后解析不出来」：实测这些写法以前**全部 0 道** ✗
 *   · 中文键：{ 试卷: "…", 题目: [{ 题干, 选项, 答案, 解析, 知识点, 难度, 题型, 年份 }] }
 *   · content / question 当题干；选项写成字典 { A: "…" } 或一整行字符串
 *   · 单题对象（不是数组）；嵌套 paper.questions；data.list；试卷/试题 这些中文容器键
 * 现在统一按「别名表 + 递归找数组」处理，并且**报错要说清看到了什么键**（别只说解析不出来）✓
 */
const STEM_KEYS = ['stem', 'body', 'text', 'content', 'question', '题干', '题目', '内容', '问题', 'title']
const ANS_KEYS = ['answer', '答案', 'ans', 'key', '参考答案', 'correct']
const SOL_KEYS = ['solution', 'analysis', '解析', '解答', '分析', '详解', 'explain', 'explanation']
const OPT_KEYS = ['options', '选项', 'choices', 'choice', '备选项', 'option']
const KP_KEYS = ['knowledge', 'tags', '知识点', 'kp', '考点', 'knowledgePoints']
const TYPE_KEYS = ['qtype', 'questionType', 'type', '题型', '类型']
const SEC_KEYS = ['section', '板块', 'module', '部分']
const PAPER_KEYS = ['paperName', 'paper', '试卷', '试卷名', '来源试卷', 'examName']
const YEAR_KEYS = ['year', '年份', '学年']
const DIFF_KEYS = ['difficulty', '难度', 'level']
const SCORE_KEYS = ['score', '分值', 'points', 'fullScore']
const NO_KEYS = ['no', 'num', 'number', '题号', 'index']

/** 从对象里按别名表取第一个非空值 ✓ */
function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = o[k]
    if (v === undefined || v === null) continue
    if (typeof v === 'string' && !v.trim()) continue
    return v
  }
  return undefined
}

/** 选项归一：字符串 / 字典 / [{label|key|text|content}] / 字符串数组 都能吃 ✓ */
function normOptions(v: unknown): string[] {
  if (v === undefined || v === null) return []
  if (typeof v === 'string') return parseOptionLines(v)
  if (Array.isArray(v)) {
    return v.map((x) => (x && typeof x === 'object'
      ? String((x as Record<string, unknown>).text ?? (x as Record<string, unknown>).content ?? (x as Record<string, unknown>).label ?? (x as Record<string, unknown>).key ?? '')
      : String(x))).map((s) => s.trim()).filter(Boolean)
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    return Object.keys(o).sort().map((k) => String(o[k] ?? '').trim()).filter(Boolean)
  }
  return []
}

/** 递归找题目数组（兼容 questions / items / list / data / 题目 / 试题 与 paper.questions 这类嵌套）✓ */
const ARR_KEYS = ['questions', 'items', 'list', 'data', '题目', '试题', '问题', 'questionList', 'question_list', 'results']
function findQuestionArray(v: unknown, depth = 0): unknown[] | null {
  if (Array.isArray(v)) return v
  if (!v || typeof v !== 'object' || depth > 4) return null
  const o = v as Record<string, unknown>
  for (const k of ARR_KEYS) if (Array.isArray(o[k])) return o[k] as unknown[]
  for (const k of Object.keys(o)) {
    const hit = findQuestionArray(o[k], depth + 1)
    if (hit && hit.length) return hit
  }
  return null
}

/** 顶层键摘要（报错时告诉用户「你到底给了什么」）✓ */
function keyHint(v: unknown): string {
  if (!v || typeof v !== 'object') return typeof v
  const ks = Object.keys(v as Record<string, unknown>)
  return ks.length ? ks.slice(0, 8).join(' / ') : '(空对象)'
}

/** * 解析题库 JSON。**容忍三种写法**（都是别的工具/我们自己导出时常见的）：
 *   ① { questions: [...] }（本项目导出的）  ② { items: [...] }  ③ 直接一个数组 [...]
 * 每条只要有题干（stem / body / text 任一）即可，其余缺了就补默认 ✓
 */
export function parseQuestionsJson(text: string): { list: ParsedQuestion[]; error?: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { list: [], error: '不是合法的 JSON（可能选错了文件）' }
  }
  // 【v1531】容器兼容：数组 / {questions|items|list|data|题目|试题} / paper.questions / 单题对象 ✓
  // 【v1531】单题对象（不是数组）也算一种写法：`{ "题干": "…", "答案": "A" }` ✓
  let arr = findQuestionArray(raw)
  if (!arr && raw && typeof raw === 'object' && pick(raw as Record<string, unknown>, STEM_KEYS) !== undefined) arr = [raw]
  if (!arr) return { list: [], error: '没找到题目数组 —— 顶层键是：' + keyHint(raw) + '（支持 questions / items / list / data / 题目 / 试题，也支持 paper.questions 这种嵌套）' }
  const arrOf = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (x && typeof x === 'object'
    ? String((x as { text?: unknown; label?: unknown }).text ?? (x as { label?: unknown }).label ?? '')
    : String(x))) : [])
  const list: ParsedQuestion[] = []
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    // 【v1531】题干 / 答案 / 解析 / 选项 / 知识点 全按别名表取（含中文键）✓
    const stemRaw = pick(o, STEM_KEYS)
    const stem = String(stemRaw === undefined ? '' : stemRaw).trim()
    if (!stem) continue
    const title = String(pick(o, ['title', '标题', 'name']) || '').trim()
    const p: ParsedQuestion = {
      title: title || (stem.length > 20 ? stem.slice(0, 20) + '…' : stem),
      stem,
      options: normOptions(pick(o, OPT_KEYS)),
      answer: String(pick(o, ANS_KEYS) ?? '').trim(),
      solution: String(pick(o, SOL_KEYS) ?? '').trim(),
      knowledge: arrOf(pick(o, KP_KEYS)),
      difficulty: Number(pick(o, DIFF_KEYS)) || 3,
      qtype: String(pick(o, TYPE_KEYS) ?? '') || undefined,
      section: String(pick(o, SEC_KEYS) ?? '') || undefined,
      chapter: String(pick(o, ['chapter', '章节']) ?? '') || undefined,
      date: o.date ? String(o.date) : undefined,
      year: String(pick(o, YEAR_KEYS) ?? ''),
      yearExplicit: pick(o, YEAR_KEYS) ? String(pick(o, YEAR_KEYS)) : undefined,
      // 【v1531】`paper` 也是常见写法（AI Schema 用的就是 paper）✓
      paperName: pick(o, PAPER_KEYS) ? String(pick(o, PAPER_KEYS)) : undefined,
      region: String(pick(o, ['region', 'source', '来源', '地区']) ?? ''),
      // 【v1531】这四项以前**导入 JSON 时会丢**（题内序号 / 难度档 / 告警）：
      //   题内序号丢了，按试卷排序和「卷尾答案区按题号配」就没有锚 ✓
      no: Number(pick(o, NO_KEYS)) || undefined,
      level: typeof o.level === 'string' ? o.level : undefined,
      warn: o.warn ? String(o.warn) : (Array.isArray(o.warnings) ? arrOf(o.warnings).join('；') : (o.告警 ? String(o.告警) : undefined)),
    }
    // 【v1531】卷尾「answers: { "1": "A", "2": "B" }」这种题号 → 答案的表，按题号补 ✓
    if (!p.answer && o.answers && typeof o.answers === 'object' && p.no) {
      const m = (o.answers as Record<string, unknown>)[String(p.no)]
      if (m !== undefined) p.answer = String(m).trim()
    }
    const imgs = readImages(pick(o, ['images', '图', 'figures']))
    if (imgs.length) p.images = imgs
    const sc = Number(pick(o, SCORE_KEYS))
    if (Number.isFinite(sc) && sc > 0) p.scoreExplicit = sc
    const af = String(o.answerFrom || '')
    if (af === 'auto' || af === 'manual' || af === 'ai') p.answerFrom = af
    list.push(p)
  }
  if (!list.length) {
    const first = arr[0]
    const hint = first && typeof first === 'object' ? keyHint(first) : String(first)
    return { list: [], error: '解析出 0 道 —— 每条至少要有一个题干字段（stem / content / 题干 / 题目）。看到的第一条键是：' + hint }
  }
  return { list }
}

/* =================================================================== *
 * 借鉴 math-atlas（参考/math-atlas-master.zip）的两种真实格式：
 *   ① **vault Markdown**：一道题一个 .md，YAML front-matter + ## 题目/选项/答案/解析
 *   ② **AI JSON**：参考/高中数学试题录入解析提示词.md 定义的 Schema
 *      （{ paper, questions:[{ questionType, stem, options:[{key,text}], subQuestions, answer, analysis }] }）
 * 两者都直接映射到题库 v3 的 meta（qtype / section / level / difficulty / year / paperName / knowledge）✓
 * =================================================================== */

/** 题型名（中文/英文/枚举）→ 我们的 qtype */
const TYPE_MAP: Record<string, QType> = {
  单选题: 'choice', 选择题: 'choice', 单选: 'choice',
  多选题: 'multi', 多选: 'multi', 多项选择题: 'multi',
  填空题: 'blank', 填空: 'blank',
  解答题: 'answer', 解答: 'answer', 应用题: 'answer', 作图题: 'answer', 其他: 'answer',
  证明题: 'proof',
  choice: 'choice', multi: 'multi', blank: 'blank', answer: 'answer', proof: 'proof',
}
export function qtypeOf(raw: string): QType | undefined {
  return TYPE_MAP[String(raw || '').trim()]
}

/**
 * 难度系数（0-1，越高越容易）→ 1-5 难度档。
 * math-atlas 存的是系数（0.94 / 0.85…），我们的真列是 1-5（基础/中档/拔高）。
 */
export function difficultyFromCoefficient(c: number): number {
  const n = Number(c)
  if (!Number.isFinite(n) || n <= 0) return 3
  if (n >= 0.9) return 1
  if (n >= 0.75) return 2
  if (n >= 0.55) return 3
  if (n >= 0.35) return 4
  return 5
}

/** 从来源串里抠年份：「25全国1」→ 2025 · 「2024届某市一模」→ 2024 */
export function yearFromSource(s: string): number {
  const t = String(s || '')
  const m4 = t.match(/(19|20)\d{2}/)
  if (m4) return Number(m4[0])
  const m2 = t.match(/(^|[^\d])(\d{2})(?=\D|$)/)
  if (m2) {
    const y = 2000 + Number(m2[2])
    if (y >= 2000 && y <= 2099) return y
  }
  return 0
}

/* ---------------- vault Markdown（front-matter + ## 分节） ---------------- */

function unquote(s: string): string {
  const t = String(s || '').trim()
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) return t.slice(1, -1)
  return t
}

/** 极简 YAML front-matter（只要标量 + 短横线列表，够用且零依赖 ✓） */
export function parseFrontMatter(raw: string): { data: Record<string, unknown>; body: string } | null {
  const m = String(raw || '').replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return null
  const data: Record<string, unknown> = {}
  let cur = ''
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim()) continue
    const li = line.match(/^\s*-\s+(.*)$/)
    if (li && cur) {
      const arr = Array.isArray(data[cur]) ? (data[cur] as unknown[]) : []
      const v = unquote(li[1])
      if (v) arr.push(v)
      data[cur] = arr
      continue
    }
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (!kv) continue
    cur = kv[1]
    const v = kv[2].trim()
    data[cur] = v === '' || v === '[]' ? [] : (v === 'null' ? '' : unquote(v))
  }
  return { data, body: m[2] }
}

/** ## 题目 / ## 选项 / ## 答案 / ## 解析 … */
export function parseMdSections(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const block of String(body || '').replace(/\r\n/g, '\n').split(/\n(?=## )/)) {
    const m = block.match(/^##\s+(.+?)\n([\s\S]*)$/)
    if (!m) continue
    const title = m[1].trim()
    if (title === '备注') continue
    out[title] = m[2].trim()
  }
  return out
}

/** 选项区：一行一个（也兼容全挤在一行） */
export function parseOptionLines(text: string): string[] {
  const t = String(text || '')
  let lines = t.split(/\n/).map((s) => s.trim()).filter(Boolean)
  if (lines.length < 2 && /[A-H]\s*[．.、)）]/.test(t)) {
    lines = t.split(/(?=[A-H]\s*[．.、)）])/).map((s) => s.trim()).filter(Boolean)
  }
  return lines.map((s) => s.replace(/^[A-H]\s*[．.、)）]\s*/, '').trim()).filter(Boolean)
}

/** 去掉题库里用不到的占位标记：[选] 是选项位置（删）；[填] 是填空位置（换成下划线，题型判定要用 ✓） */
function cleanStemMarkers(s: string): string {
  return String(s || '').replace(/\[填\]/g, '____').replace(/\[选\]/g, '').trim()
}

/** 一个 vault .md（front-matter + ## 分节）→ ParsedQuestion */
export function parseVaultMarkdown(raw: string): ParsedQuestion | null {
  const fm = parseFrontMatter(raw)
  if (!fm) return null
  const sec = parseMdSections(fm.body)
  const stem = cleanStemMarkers(sec['题目'] || sec['题干'] || '')
  if (!stem) return null
  const d = fm.data
  const arrOf = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : (v ? [String(v)] : []))
  const source = String(d.source || d.paper || '')
  const number = String(d.number || '')
  const typeRaw = String(d.type || '')
  const coef = Number(d.difficulty)
  // year 键优先（导出会写），否则才从来源串里抠 ✓
  const yKey = Number(d.year)
  const yNum = yKey >= 1900 && yKey <= 2100 ? yKey : yearFromSource(source)
  const yStr = yNum ? String(yNum) : ''
  const p: ParsedQuestion = {
    title: [source, number].filter(Boolean).join('-') || (stem.length > 20 ? stem.slice(0, 20) + '…' : stem),
    stem,
    options: parseOptionLines(sec['选项'] || ''),
    answer: String(sec['答案'] || '').trim(),
    solution: String(sec['解析'] || sec['详解'] || '').trim(),
    knowledge: [...arrOf(d.knowledge), ...arrOf(d.tags), ...arrOf(d.ai_tags)].filter(Boolean),
    difficulty: Number.isFinite(coef) && coef > 0 ? difficultyFromCoefficient(coef) : (Number(d.difficulty) >= 1 && Number(d.difficulty) <= 5 ? Number(d.difficulty) : 3),
    qtype: qtypeOf(typeRaw) as string | undefined,
    // 「题库导出」会带 section / year —— 有就用它（回灌时章节不丢、年份不被来源串带偏 ✓）
    section: String(d.section || '').trim() || undefined,
    year: yStr,
    yearExplicit: yStr || undefined,
    paperName: source || undefined,
    region: String(d.grade || d.semester || ''),
    // 【规范】把 number 也读回 no：这样「规范化 → 再规范化」题号不漂 ✓（v1459 起 no 是题内图号/答案配对的依据）
    no: Number(String(d.number || '').replace(/[^0-9]/g, '')) || undefined,
  }
  return p
}

/** 一次读多个 vault .md（题库目录里一道题一个文件，批量选文件就靠它 ✓） */
export function parseVaultMarkdownMany(texts: string[]): { list: ParsedQuestion[]; failed: number } {
  const list: ParsedQuestion[] = []
  let failed = 0
  for (const t of texts) {
    // 一个文件里可能粘了多道（front-matter 开头切）
    const chunks = String(t || '').split(/(?=^---\r?\n(?:qid|source|number)\s*:)/m).filter((s) => s.trim())
    let any = false
    for (const c of chunks) {
      const p = parseVaultMarkdown(c)
      if (p) { list.push(p); any = true }
    }
    if (!any) failed++
  }
  return { list, failed }
}

/* ---------------- AI JSON（参考/高中数学试题录入解析提示词.md 的 Schema） ---------------- */

interface AiQuestion {
  index?: number
  originalNo?: string
  questionType?: string
  score?: number | null
  stem?: string
  options?: unknown
  subQuestions?: { no?: string; stem?: string; score?: number | null; answer?: string | null; analysis?: string | null }[]
  answer?: string | null
  analysis?: string | null
  knowledge?: unknown
  tags?: unknown
  warnings?: string[]
}

/** 形如 { paper, questions:[{questionType|subQuestions|sectionIndex}] } 的 AI 输出 */
export function looksLikeAiJson(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  const o = raw as Record<string, unknown>
  if (o.paper) return true
  const arr: unknown[] = Array.isArray(raw) ? (raw as unknown[])
    : Array.isArray(o.questions) ? (o.questions as unknown[])
      : Array.isArray(o.items) ? (o.items as unknown[]) : []
  const q = arr[0] as AiQuestion | undefined
  if (!q || typeof q !== 'object') return false
  if ('questionType' in q || 'subQuestions' in q || 'sectionIndex' in q) return true
  const op = (q.options as unknown[])
  return Array.isArray(op) && !!op[0] && typeof op[0] === 'object'
}

function aiStemOf(q: AiQuestion): string {
  let s = String(q.stem || '').trim()
  const subs = Array.isArray(q.subQuestions) ? q.subQuestions : []
  for (const sq of subs) {
    const no = String(sq.no || '').trim()
    const t = String(sq.stem || '').trim()
    if (t) s += '\n' + (no ? no + ' ' : '') + t
  }
  return cleanStemMarkers(s)
}

function aiAnswerOf(q: AiQuestion): string {
  const parts: string[] = []
  if (String(q.answer || '').trim()) parts.push(String(q.answer).trim())
  for (const sq of Array.isArray(q.subQuestions) ? q.subQuestions : []) {
    const a = String(sq.answer || '').trim()
    if (a) parts.push((sq.no ? String(sq.no).trim() + ' ' : '') + a)
  }
  return parts.join('\n')
}

function aiSolutionOf(q: AiQuestion): string {
  const parts: string[] = []
  if (String(q.analysis || '').trim()) parts.push(String(q.analysis).trim())
  for (const sq of Array.isArray(q.subQuestions) ? q.subQuestions : []) {
    const a = String(sq.analysis || '').trim()
    if (a) parts.push((sq.no ? String(sq.no).trim() + ' ' : '') + a)
  }
  return parts.join('\n')
}

/** AI JSON → ParsedQuestion[]（paper.title 当作试卷名；年份从标题里抠） */
export function parseAiJson(raw: string): { list: ParsedQuestion[]; error?: string } {
  let v: unknown
  try { v = JSON.parse(raw) } catch { return { list: [], error: '不是合法的 JSON（可能选错了文件）' } }
  if (!looksLikeAiJson(v)) return { list: [], error: '不像提示词约定的 AI JSON（缺 paper / questionType / subQuestions）' }
  const o = v as { paper?: { title?: string; grade?: string }; questions?: unknown[]; items?: unknown[] }
  const arr = (Array.isArray(v) ? (v as unknown[]) : (o.questions || o.items || [])) as AiQuestion[]
  const paperTitle = String(o.paper?.title || '').trim()
  const year = yearFromSource(paperTitle)
  const arrOf = (x: unknown): string[] => (Array.isArray(x) ? x.map((s) => String(s)) : (x ? [String(x)] : []))
  const list: ParsedQuestion[] = []
  for (const q of arr) {
    if (!q || typeof q !== 'object') continue
    const stem = aiStemOf(q)
    if (!stem) continue
    const opts = Array.isArray(q.options)
      ? q.options.map((x) => (x && typeof x === 'object' ? String((x as { text?: unknown }).text ?? '') : String(x))).filter(Boolean)
      : []
    const no = String(q.originalNo || q.index || '').trim()
    const p: ParsedQuestion = {
      title: [paperTitle, no ? '第' + no + '题' : ''].filter(Boolean).join(' ') || (stem.length > 20 ? stem.slice(0, 20) + '…' : stem),
      stem,
      options: opts,
      answer: aiAnswerOf(q),
      solution: aiSolutionOf(q),
      knowledge: [...arrOf(q.knowledge), ...arrOf(q.tags)].filter(Boolean),
      difficulty: 3,
      qtype: qtypeOf(String(q.questionType || '')) as string | undefined,
      year: year ? String(year) : '',
      yearExplicit: year ? String(year) : undefined,
      paperName: paperTitle || undefined,
      region: String(o.paper?.grade || ''),
    }
    const sc = Number(q.score)
    if (Number.isFinite(sc) && sc > 0) p.scoreExplicit = sc
    const warn = Array.isArray(q.warnings) ? q.warnings.filter(Boolean).join('；') : ''
    if (warn) p.warn = warn
    list.push(p)
  }
  if (!list.length) return { list: [], error: '没有解析出任何试题（每条至少要有题干）' }
  return { list }
}

/* ---------------- 自动识别入口（界面只需要这两个） ---------------- */

/**
 * Markdown 入口：**先认 vault 格式**（front-matter / ## 题目），认不出再退回通用「1. 2. 3.」切题 ✓
 * 这样老师无论是贴 math-atlas 的题库文件，还是贴一整卷原文，都能录进来。
 */
export function parseAnyMarkdown(raw: string): { list: ParsedQuestion[]; skipped: number; detected: ReturnType<typeof detectPaperInfo>; mode: 'vault' | 'text' } {
  const t = String(raw || '')
  const isVault = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---/.test(t) || /\n##\s*题目\s*\n/.test(t)
  if (isVault) {
    const r = parseVaultMarkdownMany([t])
    if (r.list.length) {
      const first = r.list[0]
      return { list: r.list, skipped: r.failed, detected: { year: String(first.year || ''), paperName: first.paperName || '', from: 'vault' } as ReturnType<typeof detectPaperInfo>, mode: 'vault' }
    }
  }
  const r = parseFromMarkdown(t)
  return { ...r, mode: 'text' }
}

/** JSON 入口：**先认 AI Schema**，再退回题库导出格式 / {items} / 裸数组 ✓ */
export function parseAnyJson(raw: string): { list: ParsedQuestion[]; error?: string; mode: 'ai' | 'bank' } {
  let v: unknown
  try { v = JSON.parse(raw) } catch { return { list: [], error: '不是合法的 JSON（可能选错了文件）', mode: 'bank' } }
  if (looksLikeAiJson(v)) {
    const r = parseAiJson(raw)
    if (r.list.length) return { ...r, mode: 'ai' }
    // 【v1531】AI 那条路认不出来时**退回题库解析**再试一次 ——
    //   实测 `{ paper: { questions: [...] } }` 会被误判成 AI JSON，然后 0 道 ✗
    const rb = parseQuestionsJson(raw)
    if (rb.list.length) return { ...rb, mode: 'bank' }
    return { ...r, mode: 'ai' }
  }
  const r = parseQuestionsJson(raw)
  return { ...r, mode: 'bank' }
}

/* ---------------- 【规范】把题目写成「题库单题格式」的 Markdown ---------------- */

/** YAML 标量（与 Rust 的 lib_yaml_scalar 同一套规则 ✓） */
function vaultScalar(v: unknown): string {
  const s = String(v == null ? '' : v).replace(/[\n\r]/g, ' ').trim()
  const need = !s || /[:#'"]/.test(s) || /^[-[{]/.test(s)
  return need ? '"' + s.replace(/"/g, "'") + '"' : s
}

/** 难度档 1-5 → 系数（与 Rust lib_diff_coef 逐档一致 ✓） */
function vaultCoef(d: number): string {
  const n = Number(d)
  if (n <= 1) return '0.94'
  if (n === 2) return '0.80'
  if (n === 3) return '0.65'
  if (n === 4) return '0.45'
  return '0.20'
}

/** 难度档 1-5 → 中文档（与 Rust lib_diff_level 一致 ✓） */
function vaultLevel(d: number): string {
  const n = Number(d)
  if (n <= 2) return '基础'
  if (n === 3) return '中档'
  return '拔高'
}

/**
 * 【规范】题目数组 → 「题库单题格式」的 Markdown。
 *
 *   **与 Rust 导出（lib_export_vault）逐字段对齐** —— 所以「导出 → 改 → 再导入」不丢东西 ✓
 *   一个文件可以放多道：导入侧 "parseVaultMarkdownMany" 按 front-matter 开头切块 ✓
 *
 * 用途：老师手上任意来源的 md（AI 给的 / 别人发的 / 旧的 / 从 PDF 里抠的）先在校对表里核一遍，
 * 再**一键落成这个格式** → 以后所有题都长一样，导入结果可预期 ✓
 */
export function toVaultMarkdown(list: ParsedQuestion[], opt?: { paper?: string; now?: number }): string {
  const now = opt && opt.now ? opt.now : Math.floor(Date.now() / 1000)
  const blocks: string[] = []
  ;(list || []).forEach((q, i) => {
    const paper = String(q.paperName || (opt && opt.paper) || q.region || '').trim()
    const no = Number(q.no) > 0 ? Number(q.no) : i + 1
    const y = Number(q.yearExplicit || q.year) || 0
    const L: string[] = []
    L.push('---')
    // ⚠ 第一行要是 qid / source / number 之一（导入侧的切块正则靠它 ✓）
    L.push('qid: ' + (i + 1))                       // 占位：导入时按新编号分配 ✓
    L.push('source: ' + vaultScalar(paper || '未知'))
    L.push("number: '" + no + "'")
    if (q.qtype) L.push('type: ' + vaultScalar(q.qtype))
    if (q.section) L.push('section: ' + vaultScalar(q.section))
    L.push('year: ' + y)
    L.push('level: ' + vaultLevel(q.difficulty))
    L.push('difficulty: ' + vaultCoef(q.difficulty))
    L.push("updatedAt: '" + now + "'")
    const ks = (q.knowledge || []).map((x) => String(x).trim()).filter(Boolean)
    if (!ks.length) L.push('knowledge: []')
    else {
      L.push('knowledge:')
      for (const k of ks) L.push('- ' + vaultScalar(k))
    }
    L.push('---')
    L.push('')
    L.push('## 题目')
    L.push('')
    L.push(String(q.stem || '').trim())
    const opts = (q.options || []).map((o) => String(o).trim()).filter(Boolean)
    if (opts.length) {
      L.push('')
      L.push('## 选项')
      L.push('')
      opts.forEach((o, k) => L.push(String.fromCharCode(65 + (k % 26)) + '．' + o))
    }
    const ans = String(q.answer || '').trim()
    if (ans) {
      L.push('')
      L.push('## 答案')
      L.push('')
      L.push(ans)
    }
    const sol = String(q.solution || '').trim()
    if (sol) {
      L.push('')
      L.push('## 解析')
      L.push('')
      L.push(sol)
    }
    blocks.push(L.join('\n'))
  })
  return blocks.join('\n\n') + '\n'
}

