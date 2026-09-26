/**
 * 【v1681】AI 抽题：把大模型返回的 JSON **归一成应用认得的题目结构**（纯函数 ✓ 探针直接测 ✓）
 *
 * 用户口径（2026-09-26）：AI 从试卷文字/截图里抽题 → 写成**导入草稿** → 老师在试题库里复核入库 ✓。
 * 这一层只负责"模型给的东西什么样都能收进同一个形状"：
 *  · 各种外壳：{questions:[…]} / […] / 单个对象 / 带 \`\`\`json 围栏的字符串 ✓；
 *  · 字段别名：模型爱写 stem/question/题干、answer/答案、analysis/解析… ✓；
 *  · 题型归一：choice / multi / blank / answer / proof（中英文、别名都认 ✓，认不出就看有没有选项 ✓）；
 *  · 选项归一：数组、{"A":"…"} 对象、带 "A. " 前缀 ✓；
 *  · **缺题干的一律丢掉**并计数 ✓（绝不往草稿里塞空题 ✗）；缺答案/知识点只**记警告** ✓（不静默 ✓）。
 */
export interface AiQuestion {
  stem: string
  options: string[]
  answer: string
  analysis: string
  /** choice / multi / blank / answer / proof */
  qtype: string
  section: string
  kp: string[]
  /** 基础 / 中档 / 拔高 */
  level: string
  /** 1~5，认不出给 3 ✓ */
  difficulty: number
}

export interface AiParseResult {
  items: AiQuestion[]
  /** 因为缺题干被丢掉的数量 ✓ */
  skipped: number
  /** 每一条都是"人话"的提醒（缺答案、题型认不出…）✓ */
  warn: string[]
}

const S = (v: unknown): string => {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}
const pick = (o: Record<string, unknown>, keys: string[]): string => {
  for (const k of keys) { const v = S(o[k]); if (v) return v }
  return ''
}
const arr = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map((x) => S(x)).filter(Boolean)
  const s = S(v)
  return s ? [s] : []
}

/** 去掉 \`\`\`json 围栏、取第一个 { 或 [ 到最后一个 } 或 ] ✓（模型总爱多写几句解释 ✗） */
export function stripJsonFence(text: string): string {
  let t = String(text || '').trim()
  t = t.replace(/^[\s\S]*?(\`\`\`(?:json|JSON)?)/, (m) => m.replace(/[\s\S]*\`\`\`(?:json|JSON)?/, ''))
  t = t.replace(/\`\`\`[\s\S]*$/, '')
  const i1 = t.indexOf('{'), i2 = t.indexOf('[')
  const start = i1 < 0 ? i2 : (i2 < 0 ? i1 : Math.min(i1, i2))
  if (start < 0) return t.trim()
  const endC = t.lastIndexOf('}'), endB = t.lastIndexOf(']')
  const end = Math.max(endC, endB)
  return end > start ? t.slice(start, end + 1).trim() : t.trim()
}

const QTYPE: [RegExp, string][] = [
  [/多选|多选型|multi/i, 'multi'],
  [/选择|单选|choice/i, 'choice'],
  [/填空|blank|fill/i, 'blank'],
  [/证明|proof/i, 'proof'],
  [/解答|计算|answer|solve/i, 'answer'],
]
const LEVEL: [RegExp, string][] = [
  [/基础|容易|简单|易|easy/i, '基础'],
  [/拔高|难|困难|hard/i, '拔高'],
  [/中档|中等|一般|medium|mid/i, '中档'],
]

export function normQtype(raw: string, optionCount: number): string {
  const t = S(raw)
  for (const [re, v] of QTYPE) if (re.test(t)) return v
  // 认不出就看选项：两个以上当选择题 ✓，否则当解答题 ✓
  return optionCount >= 2 ? 'choice' : 'answer'
}
export function normLevel(raw: string): string {
  const t = S(raw)
  for (const [re, v] of LEVEL) if (re.test(t)) return v
  return '中档'
}
export function normDifficulty(v: unknown): number {
  const s = S(v)
  const cn: Record<string, number> = { 易: 1, 容易: 1, 简单: 1, 基础: 2, 中: 3, 中等: 3, 中档: 3, 难: 4, 较难: 4, 困难: 5, 拔高: 5 }
  if (cn[s]) return cn[s]
  const n = Number(s.replace(/[^\d.]/g, ''))
  if (!isFinite(n) || n <= 0) return 3
  return Math.max(1, Math.min(5, Math.round(n)))
}
/** 选项归一：数组 / 对象 / 带 "A. " 前缀 → 干净的字符串数组 ✓ */
export function normOptions(v: unknown): string[] {
  let list: string[] = []
  if (Array.isArray(v)) list = v.map((x) => S(x))
  else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    list = Object.keys(o).sort().map((k) => {
      const s = S(o[k])
      return s ? (/^[A-Za-z][.、)]/.test(s) ? s : k + '. ' + s) : ''
    })
  } else {
    const s = S(v)
    if (s) list = s.split(/\s*[|｜]\s*|\n+/).map((x) => x.trim())
  }
  return list.map((x) => x.trim()).filter(Boolean)
}

function one(raw: unknown, warn: string[], idx: number): AiQuestion | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const stem = pick(o, ['stem', 'question', 'title', 'body', '题干', '题目', 'content'])
  const options = normOptions(o.options !== undefined ? o.options : (o.choices !== undefined ? o.choices : o['选项']))
  if (!stem) { warn.push('第 ' + idx + ' 条没有题干，已丢掉'); return null }
  const answer = pick(o, ['answer', '答案', 'solution', 'result'])
  const analysis = pick(o, ['analysis', 'explain', 'explanation', '解析', '解答', '解答过程'])
  if (!answer) warn.push('第 ' + idx + ' 条没有答案（入库前后请补）')
  const kp = arr(o.kp !== undefined ? o.kp : (o.knowledge !== undefined ? o.knowledge : o['知识点']))
  if (!kp.length) warn.push('第 ' + idx + ' 条没给知识点')
  return {
    stem, options, answer, analysis,
    qtype: normQtype(pick(o, ['qtype', 'type', '题型', 'kind']), options.length),
    section: pick(o, ['section', 'chapter', 'module', '章节', '模块', '板块']),
    kp,
    level: normLevel(pick(o, ['level', 'difficulty_level', '难度层次', '层次'])),
    difficulty: normDifficulty(o.difficulty !== undefined ? o.difficulty : o['难度']),
  }
}

/** 主入口：模型返回的任何东西 → 干净的题目数组 + 提醒 ✓ */
export function parseAiQuestions(raw: unknown): AiParseResult {
  const warn: string[] = []
  let data: unknown = raw
  if (typeof raw === 'string') {
    const t = stripJsonFence(raw)
    try { data = JSON.parse(t) } catch { return { items: [], skipped: 0, warn: ['模型返回的不是 JSON，没法抽题'] } }
  }
  let list: unknown[] = []
  if (Array.isArray(data)) list = data
  else if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>
    const inner = o.questions !== undefined ? o.questions : (o.items !== undefined ? o.items : o['题目'])
    if (Array.isArray(inner)) list = inner
    else if (inner && typeof inner === 'object') list = [inner]
    else list = [data]      // 单个题目对象 ✓
  }
  const items: AiQuestion[] = []
  let skipped = 0
  list.forEach((x, i) => {
    const q = one(x, warn, i + 1)
    if (q) items.push(q); else skipped++
  })
  if (!items.length && !skipped) warn.push('没找到题目')
  return { items, skipped, warn }
}

/* ---------------- 【v1682】抽题的提示词与调用（对话框下一步就用它 ✓） ---------------- */

export interface ExtractOpt {
  /** 只要题干+选项（不要答案与解析）✓ */
  withAnswer?: boolean
  /** 章节候选（把题库的 SECTIONS 传进来 ✓，让模型从里面挑而不是自由发挥 ✗） */
  sections?: string[]
}

/** 抽题提示词：schema 写死 ✓，省得模型自由发挥 ✗ */
export function buildExtractPrompt(text: string, opt: ExtractOpt = {}): { system: string; user: string } {
  const secs = (opt.sections || []).filter(Boolean)
  const system = [
    '你是高中数学试卷结构化助手。把老师给的试卷正文抽成题目数组。',
    '只输出 JSON，不要解释、不要用 Markdown 代码块包起来。',
    '输出格式：{"questions": [ ... ]}，每题的字段：',
    '- stem：题干（必填；公式用 $...$）',
    '- options：选项数组，如 ["A. 1", "B. 2"]；非选择题给空数组',
    '- answer：答案；analysis：解析',
    '- qtype：choice / multi / blank / answer / proof 之一',
    secs.length ? '- section：从这些章节里选一个：' + secs.join('、') + '；都套不上就留空' : '- section：章节，认不出就留空',
    '- kp：知识点数组；level：基础 / 中档 / 拔高；difficulty：1~5 的整数',
    '原文里没有的字段留空字符串或空数组，**不要编造**；题干缺失的条目直接不要输出。',
  ].join('\n')
  const head = opt.withAnswer === false ? '（只要题干与选项，不要答案、不要解析）\n\n' : ''
  return { system, user: head + String(text || '') }
}

/**
 * 抽题：调模型 → 交给 parseAiQuestions 归一 ✓
 * 模型调用这一步由 caller 注入（面板里走 ai_chat 那条链路 ✓；探针里塞一个假的 ✓ —— 这样这一层测得动 ✓）。
 */
export async function extractQuestions(
  caller: (system: string, user: string) => Promise<string>,
  text: string,
  opt: ExtractOpt = {},
): Promise<AiParseResult> {
  const p = buildExtractPrompt(text, opt)
  let raw = ''
  try {
    raw = await caller(p.system, p.user)
  } catch (e) {
    return { items: [], skipped: 0, warn: ['调用模型失败：' + String((e as Error)?.message || e)] }
  }
  const r = parseAiQuestions(raw)
  if (!r.items.length && !r.warn.length) r.warn.push('模型没抽出题目')
  return r
}

/* ---------------- 【v1683】逐字段校验（就地编辑时每个字段旁边提示用 ✓） ---------------- */

export interface FieldIssue {
  /** 哪个字段：stem / options / answer / kp / section / difficulty / analysis ✓ */
  field: string
  /** error = 不补就不该入库 ✗；warn = 能入库但最好看一眼 ✓ */
  level: 'error' | 'warn'
  msg: string
}

/**
 * 一道题能不能入库、还有哪些地方要老师补 ✓
 * 口径（用户要求"就地编辑"✓）：编辑时**逐字段**提示 ✓，不是整题一个"不合格" ✗ ——
 * 老师看着提示改，改完提示自己消失 ✓。
 */
export function validateQuestion(q: AiQuestion): FieldIssue[] {
  const out: FieldIssue[] = []
  const stem = String(q && q.stem || '').trim()
  const answer = String(q && q.answer || '').trim()
  const options = (q && q.options) || []
  const kp = (q && q.kp) || []
  if (!stem) out.push({ field: 'stem', level: 'error', msg: '题干是空的，必填' })
  if (options.length === 1) out.push({ field: 'options', level: 'error', msg: '选择题至少要有两个选项' })
  if (!answer) out.push({ field: 'answer', level: 'error', msg: '还没有答案，入库前请补上' })
  if ((q.qtype === 'choice' || q.qtype === 'multi') && options.length < 2) {
    out.push({ field: 'options', level: 'error', msg: '题型是选择题，但没有选项' })
  }
  if (options.length >= 2 && q.qtype !== 'choice' && q.qtype !== 'multi') {
    out.push({ field: 'options', level: 'warn', msg: '有选项但题型不是选择题，确认一下题型' })
  }
  if (!kp.length) out.push({ field: 'kp', level: 'warn', msg: '还没标知识点' })
  if (!String(q.section || '').trim()) out.push({ field: 'section', level: 'warn', msg: '还没归章节' })
  if (!String(q.analysis || '').trim() && q.qtype !== 'choice' && q.qtype !== 'multi') {
    out.push({ field: 'analysis', level: 'warn', msg: '解答题建议补上解析' })
  }
  if (Number(q.difficulty) === 3) out.push({ field: 'difficulty', level: 'warn', msg: '难度是按默认中档填的，确认一下' })
  return out
}

/** 这一批里能不能提交（有 error 就不让提交 ✓ 提示到具体是第几题 ✓） */
export function firstBlocking(items: AiQuestion[]): { index: number; issue: FieldIssue } | null {
  const list = items || []
  for (let i = 0; i < list.length; i++) {
    const bad = validateQuestion(list[i]).filter((x) => x.level === 'error')
    if (bad.length) return { index: i, issue: bad[0] }
  }
  return null
}

/* ---------------- 【v1684】对话框提交前的口径：没抽答案时「缺答案」不拦提交 ✓ ---------------- */

/**
 * 按「这批有没有让 AI 抽答案」把逐字段结果过一遍：
 *   没抽答案时，缺答案是**老师自己选的** → 降到 warn，不拦提交 ✓（其余一律照旧，绝不顺手放过 ✗）。
 */
export function softenIssues(issues: FieldIssue[], withAnswer: boolean): FieldIssue[] {
  const list = issues || []
  if (withAnswer) return list
  return list.map((x) => (x.field === 'answer' && x.level === 'error'
    ? { field: x.field, level: 'warn' as const, msg: '这次没让 AI 抽答案，入库前人工补' }
    : x))
}

/** 批量提交前定位第一处拦路问题（口径同 softenIssues ✓）；下标是**传进来这批**里的位置 ✓ */
export function firstBlockerOf(items: AiQuestion[], withAnswer: boolean): { index: number; issue: FieldIssue } | null {
  const list = items || []
  if (withAnswer) return firstBlocking(list)
  for (let i = 0; i < list.length; i++) {
    const bad = softenIssues(validateQuestion(list[i]), false).filter((x) => x.level === 'error')
    if (bad.length) return { index: i, issue: bad[0] }
  }
  return null
}
