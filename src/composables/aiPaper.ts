/**
 * 【v1691】试卷编辑里的 AI：**一句话 → 组卷 / 出题** → 排成试卷 Markdown ✓
 *
 * 分工（与 aiImport.ts 同一条纪律：**逻辑进纯函数，界面只管调** ✓）：
 *   · 组卷条件解析：老师写「高二解析几何，2 选择 1 填空 1 解答，中档」→ 结构化条件 ✓（模型出的 JSON 容错收下 ✓）
 *   · 原创出题：条件 → 出题提示词 → 模型回 JSON → 交给 aiImport.parseAiQuestions 归一 ✓（同一种题目形状 ✓）
 *   · 排版：按试卷编辑认的约定输出 —— \`## 一、选择题\` 分大题、\`1.\` 题号（试卷自带自动编号 ✓）、
 *     \`[题]…[选项]…[解析]…[/题]\` 整块（题干/选项/解析**永不被分页拆开** ✓）
 *   · 缺题报告：题库里不够就**说清差几道** ✗（不假装组齐了 ✓）
 *
 * 纯函数、不碰 Tauri / 不碰 DOM → 探针直接测 ✓（模型调用由 caller 注入 ✓）
 */
import { normLevel } from '@/composables/aiImport'
import { stripOptionLabel } from '@/composables/optionLabel'
import type { AiQuestion } from '@/composables/aiImport'

export interface PaperPlan {
  /** 试卷标题（可空 → 不写 # 行 ✓） */
  title: string
  /** 章节（题库 SECTIONS 里的一个；空 = 不限 ✓） */
  section: string
  /** 知识点 / 关键词（题库检索用；空 = 不限 ✓） */
  kp: string
  /** 基础 / 中档 / 拔高（空 = 不限 ✓） */
  level: string
  /** 各题型要几道 ✓ */
  counts: Record<string, number>
  /** 卷面是否带答案解析（**默认 false**：考卷通常不带，答案另出一份 ✓） */
  withAnswer: boolean
}

/** 题型 → 试卷里的大题名（顺序就是卷面顺序 ✓ —— 高考卷就是这个次序 ✓） */
export const PAPER_QTYPES: { key: string; label: string; heading: string }[] = [
  { key: 'choice', label: '选择题', heading: '一、选择题' },
  { key: 'multi', label: '多选题', heading: '二、多选题' },
  { key: 'blank', label: '填空题', heading: '三、填空题' },
  { key: 'answer', label: '解答题', heading: '四、解答题' },
  { key: 'proof', label: '证明题', heading: '五、证明题' },
]

export function emptyPlan(): PaperPlan {
  const counts: Record<string, number> = {}
  for (const t of PAPER_QTYPES) counts[t.key] = 0
  return { title: '', section: '', kp: '', level: '', counts, withAnswer: false }
}

const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')
const N = (v: unknown): number => {
  const n = Math.round(Number(v))
  return isFinite(n) && n > 0 ? Math.min(n, 50) : 0     // 一次最多 50 道，别让模型写出个 999 ✗
}

/** 去掉 \`\`\`json 围栏、抠出第一个 { 到最后一个 } ✓（模型总爱多写几句解释 ✗） */
export function stripJson(raw: unknown): string {
  let t = String(raw == null ? '' : raw).trim()
  t = t.replace(/^[\s\S]*?\`\`\`(?:json|JSON)?/, '').replace(/\`\`\`[\s\S]*$/, '')
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  return a >= 0 && b > a ? t.slice(a, b + 1) : t
}

/** 题型别名 → 内部 key（中文、英文、单复数都认 ✓） */
const QTYPE_ALIAS: [RegExp, string][] = [
  [/多选|multi/i, 'multi'],
  [/单选|选择|choice/i, 'choice'],
  [/填空|blank|fill/i, 'blank'],
  [/证明|proof/i, 'proof'],
  [/解答|计算|大题|answer|solve/i, 'answer'],
]
export function normQtypeKey(raw: string): string {
  const t = S(raw)
  for (const [re, k] of QTYPE_ALIAS) if (re.test(t)) return k
  return ''
}

/**
 * 模型回的组卷条件 → PaperPlan（**容错收下**：字段别名、counts 写成数组、中文键、缺字段都认 ✓）
 * 认不出的东西一律**留空/归零**，绝不编 ✗（老师看得见条件回显，能立刻发现不对 ✓）
 */
export function parsePaperPlan(raw: unknown, sections: string[] = []): PaperPlan {
  const plan = emptyPlan()
  let data: unknown = raw
  if (typeof raw === 'string') {
    try { data = JSON.parse(stripJson(raw)) } catch { return plan }
  }
  if (!data || typeof data !== 'object') return plan
  const o = data as Record<string, unknown>
  plan.title = S(o.title !== undefined ? o.title : o['标题'])
  plan.kp = S(o.kp !== undefined ? o.kp : (o.knowledge !== undefined ? o.knowledge : (o['知识点'] !== undefined ? o['知识点'] : o.keywords)))
  if (Array.isArray(o.kp)) plan.kp = (o.kp as unknown[]).map(S).filter(Boolean).join(' ')
  plan.level = normLevel(S(o.level !== undefined ? o.level : o['难度']))
  if (!S(o.level !== undefined ? o.level : o['难度'])) plan.level = ''   // 没提难度 → 不限 ✓（别默认成中档 ✗）
  // 章节：只认题库里真有的（模型爱自由发挥 ✗）；认不出就留空 = 不限 ✓
  const sec = S(o.section !== undefined ? o.section : (o['章节'] !== undefined ? o['章节'] : o.module))
  if (sec && sections.indexOf(sec) >= 0) plan.section = sec
  else if (sec) plan.kp = [plan.kp, sec].filter(Boolean).join(' ')
  const wa = o.withAnswer !== undefined ? o.withAnswer : (o.with_answer !== undefined ? o.with_answer : o['带答案'])
  if (typeof wa === 'boolean') plan.withAnswer = wa

  // counts：{choice:2} / {"选择题":2} / [{type:'choice',count:2}] / [{题型:'选择题',数量:2}] 都认 ✓
  let src: unknown = o.counts !== undefined ? o.counts : (o['题型数量'] !== undefined ? o['题型数量'] : o.qtypes)
  if (Array.isArray(src)) {
    const obj: Record<string, unknown> = {}
    for (const it of src) {
      if (!it || typeof it !== 'object') continue
      const r = it as Record<string, unknown>
      const k = normQtypeKey(S(r.type !== undefined ? r.type : (r.qtype !== undefined ? r.qtype : (r['题型'] || ''))))
      const n = N(r.count !== undefined ? r.count : (r['数量'] !== undefined ? r['数量'] : r.n))
      if (k && n) obj[k] = n
    }
    src = obj
  }
  if (src && typeof src === 'object') {
    for (const k of Object.keys(src as Record<string, unknown>)) {
      const key = normQtypeKey(k) || (PAPER_QTYPES.some((t) => t.key === k) ? k : '')
      if (key) plan.counts[key] = N((src as Record<string, unknown>)[k])
    }
  }
  return plan
}

/** 条件回显：让老师一眼看出「AI 到底按什么去挑的」✓（不对就改说法重来 ✓） */
export function planSummary(p: PaperPlan): string {
  const bits: string[] = []
  if (p.section) bits.push('章节 ' + p.section)
  if (p.kp) bits.push('关键词 ' + p.kp)
  if (p.level) bits.push('难度 ' + p.level)
  const qs = PAPER_QTYPES.filter((t) => (p.counts[t.key] || 0) > 0).map((t) => t.label + ' ' + p.counts[t.key] + ' 道')
  bits.push(qs.length ? qs.join(' · ') : '题量未指定')
  bits.push(p.withAnswer ? '卷面带答案解析' : '卷面不带答案')
  return bits.join('；')
}

/** 计划里一共要几道题 ✓ */
export function planTotal(p: PaperPlan): number {
  return PAPER_QTYPES.reduce((n, t) => n + (p.counts[t.key] || 0), 0)
}

/** 题库里不够时差几道（人话 ✓）—— 不假装组齐了 ✗ */
export function planGaps(p: PaperPlan, found: Record<string, number>): string[] {
  const out: string[] = []
  for (const t of PAPER_QTYPES) {
    const want = p.counts[t.key] || 0
    if (!want) continue
    const got = found[t.key] || 0
    if (got < want) out.push(t.label + '要 ' + want + ' 道，题库里只找到 ' + got + ' 道')
  }
  return out
}

/* ---------------- 提示词（两个都写死 schema ✓ 省得模型自由发挥 ✗） ---------------- */

/** ① 一句话 → 组卷条件 JSON ✓ */
export function buildPlanPrompt(text: string, opt: { sections: string[] } = { sections: [] }): { system: string; user: string } {
  const secs = (opt.sections || []).filter(Boolean)
  const system = [
    '你是高中数学组卷助手。把老师那句话翻译成**组卷条件 JSON**，只输出 JSON，不要解释、不要 Markdown 代码块。',
    '格式：{"title":"试卷标题(可空)","section":"章节(可空)","kp":"知识点或关键词(可空)","level":"基础|中档|拔高(可空)",',
    '"counts":{"choice":几道选择题,"multi":几道多选题,"blank":几道填空题,"answer":几道解答题,"proof":几道证明题},',
    '"withAnswer":false}',
    secs.length ? 'section 只能从这些里选，套不上就留空：' + secs.join('、') : 'section 留空即可。',
    'counts 里没提到的题型一律写 0；老师没说难度就留空字符串（不要自己定成中档 ✗）。',
    '老师没说"带答案"时 withAnswer 写 false（考卷通常不带答案 ✓）。',
  ].join('\n')
  return { system, user: String(text || '') }
}

/** ② 条件 → 原创出题提示词 ✓（题目形状与 aiImport.parseAiQuestions 完全一致 ✓） */
export function buildMakePrompt(plan: PaperPlan, count: number): { system: string; user: string } {
  const n = Math.max(1, Math.min(20, Math.round(count) || 1))
  const system = [
    '你是高中数学命题老师。按下面的条件命制 ' + n + ' 道**新题**，只输出 JSON，不要解释、不要用 Markdown 代码块包起来。',
    '输出格式：{"questions": [ ... ]}，每题的字段：',
    '- stem：题干（公式用 $...$）',
    '- options：选项数组，如 ["A. 1", "B. 2"]；非选择题给空数组',
    '- answer：答案；analysis：解析（**必须有**，老师要照着核对 ✓）',
    '- qtype：choice / multi / blank / answer / proof 之一',
    '- kp：知识点数组；level：基础 / 中档 / 拔高；difficulty：1~5 的整数',
    '要求：题干完整、条件充分、答案唯一；不要出需要配图的题（这里插不了图 ✗）；不要抄现成的成题。',
  ].join('\n')
  const bits = [
    plan.section ? '章节：' + plan.section : '',
    plan.kp ? '知识点 / 关键词：' + plan.kp : '',
    plan.level ? '难度：' + plan.level : '',
  ].filter(Boolean).join('；')
  return { system, user: (bits ? bits + '\n' : '') + '请出 ' + n + ' 道题。' }
}

/* ---------------- 排版（试卷编辑认的约定 ✓） ---------------- */

/** 一道题 → 试卷「题目块」（与题库的 questionBlockOf **同一套格式** ✓） */
export function aiQuestionBlockOf(q: AiQuestion, no = 0): string {
  const stem = String((q && q.stem) || '').trim()
  if (!stem) return ''
  const lines = ['[题]', (no ? no + '. ' : '') + stem]
  const opts = (q.options || []).map((x) => String(x)).filter(Boolean)
  // 【v1702】选项去重编号 ✓（模型给的选项常自带 "A. " 前缀 ✗ 再加一次就成了 "A. A. …" ✗）
  if (opts.length) lines.push('[选项]', opts.map((o, i) => 'ABCDEFGH'[i] + '．' + stripOptionLabel(o, i)).join('\n'))
  const ans = String((q && q.answer) || '').trim()
  const sol = String((q && q.analysis) || '').trim()
  const body = [ans ? '【答案】' + ans : '', sol].filter(Boolean).join('\n')
  if (body) lines.push('[解析]', body)
  lines.push('[/题]')
  return lines.join('\n')
}

/**
 * 把分好大题的题目块拼成一份试卷 Markdown ✓
 * · 大题按 PAPER_QTYPES 的固定次序 ✓；只输出**真有题**的大题 ✓（空节不写 ✗）
 * · 题号交给试卷自己的自动编号（autoNum 默认开 ✓）—— 这里仍然写 1. 2. 3.，
 *   关掉自动编号时也对得上 ✓
 */
export function paperDocOf(title: string, sections: { heading: string; blocks: string[] }[]): string {
  const out: string[] = []
  if (String(title || '').trim()) out.push('# ' + String(title).trim())
  for (const s of sections) {
    const blocks = (s.blocks || []).filter(Boolean)
    if (!blocks.length) continue
    out.push('## ' + s.heading)
    out.push(blocks.join('\n\n'))
  }
  return out.join('\n\n') + '\n'
}
