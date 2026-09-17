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

function autoTitle(stem: string): string {
  const first = (stem || '').split('\n').map((s) => s.trim()).filter(Boolean)[0] || '未命名试题'
  const t = first.replace(/\s+/g, ' ')
  return t.length > 20 ? t.slice(0, 20) + '…' : t
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

export function parseQuestions(raw: string): ParsedQuestion[] {
  const out: ParsedQuestion[] = []
  for (const block of splitBlocks(raw)) {
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
