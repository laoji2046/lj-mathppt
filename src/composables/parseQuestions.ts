/**
 * 试题批量导入的文本解析器（纯函数，便于单独验证）。
 *
 * 面向中文试卷的常见写法，容忍度优先于严格性：能认出来就认，认不出的原样留在题干里。
 *
 * 识别规则：
 *  题与题之间 —— 一行只有 3 个及以上短横线（---）时以其分隔；
 *                 否则按行首数字加 . 、 ． ) ）开头的行切分。
 *  选项       —— 行首 A-H（可带括号或顿号或点），同一行多个选项也能拆。
 *  答案       —— 【答案】 或 答案： 或 答案
 *  解析       —— 【解析】 或 解析： 或 解：（其后续行并入解析，直到下一个标记）
 *  知识点     —— 【知识点】 或 知识点：，或题干里的 #标签
 *  难度       —— 【难度】 或 难度： 后跟 1-5，或直接写 易 / 中 / 难
 *  题型       —— 【题型】 或 题型： 后跟 单选/多选/填空/解答（认不出会自动推断）
 *  板块       —— 【板块】 或 板块： 后跟六大板块名（认不出会自动归类）
 *  日期       —— 【日期】 或 日期： 后跟 2024-05-20 或 2024.5.20
 *  来源       —— 【来源】 或 来源：（顺带识别其中的年份）
 */

/** 上次解析时被判为「非题目」而跳过的**行数**（须知/抬头/注意事项），供界面提示用 */
export let skippedNonQuestion = 0

/** 带信息的解析：返回题目列表 + 跳过行数（界面提示用；parseQuestions 保持向后兼容） */
export function parseQuestionsWithInfo(raw: string): { list: ParsedQuestion[]; skipped: number } {
  const list = parseQuestions(raw)
  return { list, skipped: skippedNonQuestion }
}

export interface ParsedQuestion {
  title: string
  stem: string
  options: string[]
  answer: string
  solution: string
  knowledge: string[]
  difficulty: number
  /** 显式题型（【题型】单选/多选/填空/解答）；没写就留空，由库层推断 */
  qtype?: string
  /** 显式板块（【板块】六大板块之一）；没写就留空，由库层归类 */
  section?: string
  /** 显式章节（【章节】第二级）；没写留空 */
  chapter?: string
  /** 题面上写明的分值（如「本小题满分 15 分」）；没写为 0 */
  scoreExplicit?: number
  /** 日期 YYYY-MM-DD */
  date?: string
  /** 年份（如 2024） */
  yearExplicit?: string
  /** 试卷名（如 2024届某市一模） */
  paperName?: string
  year: string
  region: string
  warn?: string
}

const RE_NUM = /^\s*\d{1,3}\s*[.、．)）]\s*/
const RE_SEP = /^\s*-{3,}\s*$/
const RE_OPT = /^\s*[（(]?\s*[A-Ha-h]\s*[.、．)）]\s*(.*)$/
const RE_ANSWER = /^\s*(?:【答案】|答案\s*[:：]?)\s*(.*)$/
const RE_SOLUTION = /^\s*(?:【解析】|【详解】|解析\s*[:：]|解\s*[:：])\s*(.*)$/
const RE_KNOW = /^\s*(?:【知识点】|知识点\s*[:：])\s*(.*)$/
const RE_DIFF = /^\s*(?:【难度】|难度\s*[:：])\s*(.+?)\s*$/
const RE_SOURCE = /^\s*(?:【来源】|来源\s*[:：])\s*(.*)$/
const RE_QTYPE = /^\s*(?:【题型】|题型\s*[:：])\s*(.+?)\s*$/
const RE_SECTION = /^\s*(?:【板块】|板块\s*[:：])\s*(.+?)\s*$/
const RE_DATE = /^\s*(?:【日期】|日期\s*[:：])\s*(.+?)\s*$/
const RE_YEAR = /^\s*(?:【年份】|年份\s*[:：])\s*(.+?)\s*$/
const RE_CHAPTER = /^\s*(?:【章节】|章节\s*[:：])\s*(.+?)\s*$/
/** 「（本小题满分 15 分）」这类 —— 既是说明，也是**这道题的分值** */
const RE_FULL_SCORE = /[（(]\s*本小题满分\s*(\d{1,3})\s*分\s*[)）]/
const RE_PAPER = /^\s*(?:【试卷】|【试卷名】|试卷\s*[:：]|试卷名\s*[:：])\s*(.+?)\s*$/

/** 难度文字 → 1-5（易=2 / 中=3 / 难=5；也认 1-5 与「较难」这类说法） */
function parseDiff(raw: string): number {
  const s = (raw || '').trim()
  if (s.includes('易') || s.includes('简单') || s.includes('基础')) return 2
  if (s.includes('较难') || s.includes('难') || s.includes('压轴')) return 5
  if (s.includes('中')) return 3
  const n = Number((s.match(/[1-5]/) || [])[0])
  return n || 3
}

/** 题型文字 → 内部值 */
function parseQType(raw: string): string {
  const s = (raw || '').trim()
  if (s.includes('多选') || s.includes('多 选') || s.includes('多项')) return 'multi'
  if (s.includes('单选') || s.includes('单项') || s.includes('选择')) return 'choice'
  if (s.includes('填空')) return 'blank'
  if (s.includes('解答') || s.includes('计算') || s.includes('证明') || s.includes('应用')) return 'answer'
  return ''
}

/** 日期文字 → YYYY-MM-DD（认 2024-05-20 / 2024.5.20 / 2024年5月20日） */
function parseDate(raw: string): string {
  const s = (raw || '').trim()
  const m = s.match(/(\d{4})\s*[-.年/]\s*(\d{1,2})\s*[-.月/]\s*(\d{1,2})/)
  if (m) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0')
  const y = s.match(/(19|20)\d{2}/)
  return y ? y[0] + '-01-01' : ''
}

function splitTags(s: string): string[] {
  // 把 # 也当分隔符 —— 知识点行里可能混着 #标签（如「基本不等式 #和定积最大」）
  return s.split(/[，,、;；\s#]+/).map((x) => x.trim()).filter(Boolean)
}

/** 只由分值说明组成的行（如「（本小题满分 15 分）」）—— 不作为标题 */
function isScoreOnlyLine(s: string): boolean {
  return /^[（(]?\s*(?:本小题)?\s*满分\s*\d{1,3}\s*分\s*[)）]?\s*$/.test(s.trim())
}

function autoTitle(stem: string): string {
  const first = (stem || '').split('\n').map((s) => s.trim()).filter((s) => s && !isScoreOnlyLine(s))[0] || '未命名试题'
  const t = first.replace(/\s+/g, ' ')
  return t.length > 20 ? t.slice(0, 20) + '…' : t
}

/* ---------------- 过滤「不是题目」的内容 ---------------- */

/**
 * 考生须知 / 答题说明类词汇。**真实数学题几乎不会同时出现两个**，所以命中 ≥2 个就判为须知。
 * （这些内容在试卷里常常也以 1. 2. 3. 编号，会被切题规则误切成题目 —— 必须单独滤掉）
 */
const NOTE_WORDS = [
  '答题卡', '条形码', '准考证', '监考', '考生', '2B铅笔', '铅笔', '签字笔', '橡皮擦', '橡皮',
  '填涂', '答题区域', '超出答题区域', '草稿纸', '注意事项', '考生须知', '姓名', '学校', '毫米', '无效',
]
/** 这些开头直接判为说明段 */
const RE_NOTE_HEAD = /^\s*(?:注意事项|考生须知|答题说明|说明|考试须知)\s*[:：]?\s*$/
/** 标题类词（与 detectPaperInfo 用的是同一套思路） */
const RE_TITLE_WORD2 = /(试卷|试题|考试|模拟|联考|一模|二模|三模|高考|期末|期中|月考|调研|统考|质检|适应性|诊断|真题)/

/**
 * 判断一段文本**不是题目**。三种情况：
 *  ① 命中 ≥2 个须知类词（如同时出现「答题卡」「签字笔」）；
 *  ② 就是「注意事项」这类小标题本身；
 *  ③ **单行标题**：只有一行、长度 < 40、含标题类词，且**没有任何题目特征**（选项/答案/解析/数学符号/下划线）。
 */
/** 单行标题判断（只在正文开头的几行里用，避免误伤正文中间的题） */
function isTitleLine(t: string): boolean {
  if (t.length >= 40) return false
  if (!RE_TITLE_WORD2.test(t)) return false
  const hasQuestionMark =
    RE_OPT.test(t) || RE_ANSWER.test(t) || RE_SOLUTION.test(t) ||
    /[=＋+≥≤<>＜＞√∑∫π²³]|_\{2,}|＿|（\s*）|\(\s*\)/.test(t)
  return !hasQuestionMark
}

/** 一行里须知类词的命中数 */
function noteHits(t: string): number {
  let n = 0
  for (const w of NOTE_WORDS) if (t.indexOf(w) >= 0) n++
  return n
}

/**
 * **按行**剔除「不是题目」的内容，返回清理后的文本与被丢掉的行数。
 *
 * ⚠ 必须按行做，不能按块做 —— 因为切块的 `---` 只分开题目，
 * 一旦须知和第一道题落在同一个块里，按块过滤会把真题一起丢掉（实测踩过）。
 *
 * 规则：
 *  ① 一行命中 **≥2 个须知类词** → 丢掉（须知段落）；
 *  ② 「注意事项」「考生须知」这类小标题本身 → 丢掉；
 *  ③ **只在正文开头 8 行内**，把单行标题（含试卷类词、无题目特征）丢掉。
 */
function stripNonQuestionLines(text: string): { text: string; skipped: number } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let skipped = 0
  lines.forEach((l, i) => {
    const t = l.trim()
    if (!t) { out.push(l); return }
    if (noteHits(t) >= 2) { skipped++; return }
    if (RE_NOTE_HEAD.test(t)) { skipped++; return }
    // 分段标题行（一、选择题）与「(12 分)」这种分值行 —— 都不是题目
    if (/^[一二三四五六七八九十]+\s*[、.．]\s*\S{0,6}$/.test(t) && t.length < 20) { skipped++; return }
    if (/^[（(]\s*\d{1,3}\s*分\s*[)）]\s*$/.test(t)) { skipped++; return }
    if (i < 8 && isTitleLine(t)) { skipped++; return }
    out.push(l)
  })
  return { text: out.join('\n'), skipped }
}

function isNonQuestionBlock(block: string): boolean {
  const t = block.trim()
  if (!t) return true
  if (RE_NOTE_HEAD.test(t)) return true
  let hits = 0
  for (const w of NOTE_WORDS) if (t.indexOf(w) >= 0) hits++
  if (hits >= 2) return true
  // 分段标题行：「一、选择题」「二、填空题」「三、解答题」这类 —— 也不是题目
  if (/^\s*[一二三四五六七八九十]+\s*[、.．]\s*(选择题|填空题|解答题|多选题|单选题|判断题|计算题|证明题|应用题)\s*$/.test(t)) return true
  const lines = t.split('\n').map((s) => s.trim()).filter(Boolean)
  if (lines.length === 1) {
    const l = lines[0]
    const hasQuestionMark =
      RE_OPT.test(l) || RE_ANSWER.test(l) || RE_SOLUTION.test(l) ||
      /[=＋+≥≤<>＜＞√∑∫π²³]|_\{2,}|＿|（\s*）|\(\s*\)/.test(l)
    if (!hasQuestionMark && l.length < 40 && RE_TITLE_WORD2.test(l)) return true
  }
  return false
}

/** 一行里可能有多个选项：A．1　B．2　C．3 —— 拆成数组 */
function splitOptionsLine(line: string): string[] {
  const parts = line.split(/(?=[（(]?\s*[A-Ha-h]\s*[.、．)）]\s*)/g)
  const out: string[] = []
  for (const p of parts) {
    const m = p.match(RE_OPT)
    if (m && m[1] !== undefined) out.push(m[1].trim())
  }
  return out
}

/** 把一段文本切成若干题块 */
function splitBlocks(text: string): string[] {
  const ls = text.replace(/\r\n?/g, '\n').split('\n')
  const hasSep = ls.some((l) => RE_SEP.test(l))
  const blocks: string[] = []
  let cur: string[] = []
  for (const l of ls) {
    if (hasSep) {
      if (RE_SEP.test(l)) {
        if (cur.some((x) => x.trim())) blocks.push(cur.join('\n'))
        cur = []
      } else {
        cur.push(l)
      }
      continue
    }
    if (RE_NUM.test(l) && cur.some((x) => x.trim())) {
      blocks.push(cur.join('\n'))
      cur = [l]
    } else {
      cur.push(l)
    }
  }
  if (cur.some((x) => x.trim())) blocks.push(cur.join('\n'))
  return blocks.map((b) => b.trim()).filter(Boolean)
}

function t_all(block: string): string {
  return block.split('\n').join(' ')
}

export function parseQuestions(raw: string): ParsedQuestion[] {
  const stripped = stripNonQuestionLines(raw)
  skippedNonQuestion = stripped.skipped
  const out: ParsedQuestion[] = []
  for (const block of splitBlocks(stripped.text)) {
    // ⚠ 考生须知 / 抬头 / 注意事项**不是题目** —— 它们也常以 1. 2. 编号，会被切题规则误切
    if (isNonQuestionBlock(block)) { skippedNonQuestion += 1; continue }
    const ls = block.split('\n')
    const stemParts: string[] = []
    const options: string[] = []
    let answer = ''
    let solution = ''
    let knowledge: string[] = []
    let difficulty = 3
    let year = ''
    let region = ''
    let qtype = ''
    let section = ''
    let chapter = ''
    let date = ''
    let yearExplicit = ''
    let paperName = ''
    let mode = 'stem'

    for (const line of ls) {
      if (!line.trim()) {
        if (mode === 'solution') solution += '\n'
        continue
      }
      let m = line.match(RE_DIFF)
      if (m) { difficulty = parseDiff(m[1]); continue }
      m = line.match(RE_QTYPE)
      if (m) { const q = parseQType(m[1]); if (q) qtype = q; continue }
      m = line.match(RE_SECTION)
      if (m) { section = m[1].trim(); continue }
      m = line.match(RE_DATE)
      if (m) { date = parseDate(m[1]); continue }
      m = line.match(RE_CHAPTER)
      if (m) { chapter = m[1].trim(); continue }
      m = line.match(RE_YEAR)
      if (m) { const y = (m[1].match(/(19|20)\d{2}/) || [])[0]; if (y) yearExplicit = y; continue }
      m = line.match(RE_PAPER)
      if (m) { paperName = m[1].trim(); continue }
      m = line.match(RE_KNOW)
      if (m) { knowledge = knowledge.concat(splitTags(m[1])); continue }
      m = line.match(RE_SOURCE)
      if (m) {
        const s = m[1].trim()
        region = s
        const y = s.match(/(19|20)\d{2}/)
        if (y) year = y[0]
        continue
      }
      m = line.match(RE_ANSWER)
      if (m) { answer = m[1].trim(); mode = 'answer'; continue }
      m = line.match(RE_SOLUTION)
      if (m) { solution += (solution ? '\n' : '') + m[1].trim(); mode = 'solution'; continue }

      if (mode === 'stem') {
        const mo = line.match(RE_OPT)
        if (mo) {
          const many = splitOptionsLine(line)
          if (many.length > 1) options.push(...many)
          else options.push(mo[1].trim())
          continue
        }
        stemParts.push(line)
        continue
      }
      if (mode === 'solution') solution += '\n' + line.trim()
      else answer += '\n' + line.trim()
    }

    let stem = stemParts.join('\n').trim()
    const first = stem.split('\n')[0] || ''
    if (RE_NUM.test(first)) stem = stem.replace(RE_NUM, '').trim()
    const inline = stem.match(/#[^\s#]{1,16}/g)
    if (inline) {
      knowledge = knowledge.concat(inline.map((s) => s.slice(1)))
      stem = stem.replace(/#[^\s#]{1,16}/g, '').replace(/\s{2,}/g, ' ').trim()
    }
    knowledge = Array.from(new Set(knowledge.filter(Boolean)))

    const ms = t_all(block).match(RE_FULL_SCORE)
    const scoreExplicit = ms ? Number(ms[1]) || 0 : 0

    if (!stem && !options.length) continue
    out.push({
      title: autoTitle(stem),
      stem,
      options,
      answer: answer.trim(),
      solution: solution.trim(),
      knowledge,
      difficulty,
      qtype,
      section,
      scoreExplicit,
      chapter,
      date,
      yearExplicit,
      paperName,
      year,
      region,
      warn: !answer && !options.length ? '没有识别到答案' : undefined,
    })
  }
  return out
}

/* ---------------- 从试卷正文里自动识别「年份」与「试卷名」 ---------------- */

export interface DetectedPaper {
  year: string
  paperName: string
  /** 识别依据（给用户看，让他知道为什么是这个名字） */
  from: string
}

/** 标题里常见的词 —— 命中才认为这一行可能是试卷名 */
const RE_TITLE_WORD = /(试卷|试题|考试|模拟|联考|一模|二模|三模|四模|五模|高考|学考|选考|期末|期中|月考|调研|统考|质检|质量检测|适应性|诊断|押题|真题|单元测试|章节测试)/
/** 年份的强写法：2024年 / 2024届 */
const RE_YEAR_STRONG = /((?:19|20)\d{2})\s*(?:年|届)/
const RE_YEAR_ANY = /(?:19|20)\d{2}/

/**
 * 从试卷正文里尽量认出「年份」与「试卷名」。规则：
 *
 *  年份 —— 优先「20XX年 / 20XX届」这种强写法；否则全文第一个 19xx/20xx。
 *  试卷名 —— 在**前 8 个非空行**里找最像标题的一行：
 *            · 长度 6~60；
 *            · 不以题号开头（避免把第一道题当标题）；
 *            · 以问号结尾的不算；
 *            · **必须命中试卷类关键词**（试卷/模拟/联考/一模/高考/期末…）—— 宁可不认，不要认错。
 *
 * 认不出就返回空串，由用户手填（**不瞎猜**）。
 */
export function detectPaperInfo(text: string): DetectedPaper {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((s) => s.trim()).filter(Boolean)
  let year = ''
  const ms = text.match(RE_YEAR_STRONG)
  if (ms) year = ms[1]

  let paperName = ''
  for (const raw of lines.slice(0, 8)) {
    const t = raw.replace(/^[#>*\-\s]+/, '').replace(/[*_`]/g, '').trim()
    if (t.length < 6 || t.length > 60) continue
    if (RE_NUM.test(t)) continue
    if (/[?？]$/.test(t)) continue
    if (!RE_TITLE_WORD.test(t)) continue
    paperName = t
    break
  }

  if (!year) {
    const src = paperName || text
    const m = src.match(RE_YEAR_ANY)
    if (m) year = m[0]
  }
  const from = paperName ? '正文开头找到疑似标题' : (year ? '全文里找到年份' : '没认出来')
  return { year, paperName, from }
}

/** 界面上的格式说明 */
export const PARSE_HELP: string[] = [
  '题与题之间用一行 --- 分隔；也可以不写，每道题以 1. 2. 3. 开头即可。',
  '选项一行一个（A. …），写在同一个行里也能拆开。',
  '答案写 【答案】D 或 答案：D。',
  '解析写 【解析】……（可多行，直到下一个标记）。',
  '知识点写 【知识点】基本不等式, 最值，或直接在题干里写 #基本不等式。',
  '难度写 【难度】易 / 中 / 难（也认 1-5）；来源写 【来源】课本 P46 或 2024 某市模拟。',
  '题型写 【题型】单选 / 多选 / 填空 / 解答；不写会自动推断（有选项→选择，有下划线→填空）。',
  '章节写 【章节】导数及其应用（板块之下第二级）。',
  '板块写 【板块】集合与逻辑 / 函数与导数 / 三角函数与向量 / 解析几何 / 立体几何 / 概率与统计；不写会按关键词自动归类。',
  '日期写 【日期】2024-05-20（也认 2024.5.20 / 2024年5月20日）。',
  '年份写 【年份】2024；试卷名写 【试卷】2024届某市一模 —— 这两项是「整套插入」的归组依据。',
]
