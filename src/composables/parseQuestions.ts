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

/**
 * 判断一段文本是不是「不是题目」的内容，并给出原因。
 * **清理已入库条目时复用同一套判据** —— 保证「导入时不收」和「清理时能认出来」一致。
 */
export function judgeNonQuestion(text: string): { bad: boolean; reason: string } {
  const t = (text || '').trim()
  if (!t) return { bad: false, reason: '' }
  const lines = t.split('\n').map((s) => s.trim()).filter(Boolean)
  // 整条都很短：用行级规则逐行判（全行都是非题目 → 整条判为非题目）
  if (t.length < 120 && lines.length <= 3) {
    let allBad = lines.length > 0
    let why = ''
    for (const l of lines) {
      if (RE_NOTE_HEAD.test(l)) { why = why || '说明小标题'; continue }
      if (noteHits(l) >= 2) { why = why || '考生须知'; continue }
      if (isShortNote(l)) { why = why || '收尾/说明句'; continue }
      if (isSegmentHead(l)) { why = why || '分段标题行'; continue }
      if (/^[（(]\s*\d{1,3}\s*分\s*[)）]\s*$/.test(l)) { why = why || '分值行'; continue }
      if (isMdHeadingLine(l)) { why = why || 'Markdown 标题'; continue }
      if (isPaperInfoLine(l)) { why = why || '卷头信息'; continue }
      if (isTitleLine(l)) { why = why || '试卷抬头'; continue }
      allBad = false
    }
    if (allBad) return { bad: true, reason: why || '非题目内容' }
  }
  // 单独一条就是分值行 / 分段标题
  if (/^[（(]\s*\d{1,3}\s*分\s*[)）]\s*$/.test(t)) return { bad: true, reason: '分值行' }
  if (isSegmentHead(t)) return { bad: true, reason: '分段标题行' }
  if (noteHits(t) >= 2) return { bad: true, reason: '考生须知' }
  if (isShortNote(t)) return { bad: true, reason: '收尾/说明句' }
  return { bad: false, reason: '' }
}

/** 上次解析时被判为「非题目」而跳过的**行数**（须知/抬头/注意事项），供界面提示用 */
export let skippedNonQuestion = 0

/** 带信息的解析：返回题目列表 + 跳过行数（界面提示用；parseQuestions 保持向后兼容） */
export function parseQuestionsWithInfo(raw: string): { list: ParsedQuestion[]; skipped: number } {
  const list = parseQuestions(raw)
  return { list, skipped: skippedNonQuestion }
}

/**
 * 题目插图（题库里的题**不存磁盘路径**，只存自包含的 data URL）。
 *  n    —— 题干里 [图N] 的编号（题目内唯一，插入试卷时会按试卷的图号重编）
 *  src  —— data:image/...;base64,...（为什么用 data URL 而不是文件路径：
 *          ① MinerU 产物目录是临时缓存（%APPDATA%\lj-mathslides\mineru\<时间戳>），
 *             清掉/换机器/导出 JSON 就全丢；② PaperModal 自己的图片库本来就是 data URL，
 *             同一套表示可以直接注册进去显示与导出 PDF。）
 *  caption —— 图注（MinerU 的 image_caption / Markdown 的 alt），可为空
 */
export interface QuestionImage {
  n: number
  /** 图（data URL）。**存库时大图会换成 assetId、这里留空**，加载时再 hydrate 回来 */
  src: string
  /** 内容库资源 id（大图走它；小图直接内联 src） */
  assetId?: number
  caption?: string
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
  /** 题干/选项里引用的插图（[图N] 对应的图）—— MinerU 导入时填，其余来源留空 */
  images?: QuestionImage[]
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
  '考试结束', '一并交回', '交回', '本试卷', '试卷上', '考试时间', '监考老师', '密封', '启封',
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
  return !hasQuestionFeature(t)
}

/** Markdown 标题行（`# 2027 届高三 8 月` / `## 数学`）—— MinerU 识别产物的卷头就是这种写法 */
function isMdHeadingLine(t: string): boolean {
  return /^\s*#{1,6}(?:\s|$)/.test(t)
}

/** 卷头信息行：「满分150分，时间120分钟。」—— 同时含「满分…分」与「时间…分钟」 */
function isPaperInfoLine(t: string): boolean {
  return /满分\s*\d{1,3}\s*分/.test(t) && /时间\s*\d{1,3}\s*分钟/.test(t)
}

/**
 * 「参考答案」小标题 —— MinerU 会把整份答案附在正文之后，
 * 从这里开始（含）后面的逐题答案/详解都不是题目，必须整段截断。
 */
function isAnswerSectionHead(t: string): boolean {
  const s = t.replace(/^\s*#{1,6}\s*/, '').trim()
  return s.length <= 20 && /参考\s*答案/.test(s)
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
  /** 是否已进入「参考答案」区（MinerU 把逐题答案/详解附在正文之后） */
  let inAnswerSection = false
  lines.forEach((l, i) => {
    const t = l.trim()
    if (!t) { out.push(l); return }
    // 参考答案区一旦开始，后面所有行都不是题目
    if (inAnswerSection) { skipped++; return }
    if (isAnswerSectionHead(t)) { inAnswerSection = true; skipped++; return }
    // Markdown 标题行（# 2027 届高三 8 月 / ## 数学）—— 卷头，不是题目
    if (isMdHeadingLine(t)) { skipped++; return }
    // 卷头信息行（满分150分，时间120分钟。）
    if (isPaperInfoLine(t)) { skipped++; return }
    if (noteHits(t) >= 2) { skipped++; return }
    if (isShortNote(t)) { skipped++; return }
    if (RE_NOTE_HEAD.test(t)) { skipped++; return }
    // 分段标题行（一、选择题）—— 不是题目，但**不能直接丢**：它是"题型"的唯一可靠来源，
    //   所以要**带个标记留在文本里**（），交给 splitBySegmentHeads 用；题目文本里不含这个字符。
    // 小节标题行（一、选择题）**不在这里丢**：它决定后面那道题的题型，交给 splitBlocks + 块内循环处理
    if (/^[（(]\s*\d{1,3}\s*分\s*[)）]\s*$/.test(t)) { skipped++; return }
    if (i < 8 && isTitleLine(t)) { skipped++; return }
    out.push(l)
  })
  return { text: out.join('\n'), skipped }
}

/** 剥掉行首的 Markdown 记号与空白（试卷常以 ## 形式给出） */
function stripMark(t: string): string {
  return t.replace(/^[#>*\-\s]+/, '').replace(/^\d+[.、．)）]\s*/, '').trim()
}

/**
 * 分段标题行：「一、选择题:本题共8小题,每小题5分,共40分.…」——
 * **剥掉 Markdown 前缀后按开头匹配，且不限长度**（真实试卷里这行常常是一整句说明）。
 */
function isSegmentHead(t: string): boolean {
  const s = stripMark(t)
  return /^[一二三四五六七八九十]{1,3}\s*[、.．]\s*(选择题|填空题|解答题|多选题|单选题|判断题|计算题|证明题|应用题|选做题|必做题)/.test(s)
}

/** 「一、选择题：本题共 8 小题…」这行告诉我们**这一段的题型** —— 这是试卷里最可靠的题型信号
 *  （比"看有没有选项"稳：解答题里也会出现选项字母；而选择题可能一个选项都没切出来）。
 *  返回 '' = 认不出（那就退回结构推断）。 */
/** 【救回被吃掉的选项】MinerU 的 full.md 偶尔把 A 选项并进公式 —— 实测同一次识别的块原文是
 *  `… 则 $P = A$ 。1 B. 2 C. 4 D. 8`（MD 里丢了那个 `1` ✗），也就是 **content_list.json 里还留着**。
 *  于是：题干里出现“= A$”这种可疑痕迹、且切出来的选项从 B 开始 → 把“题干与 B. 之间”的碎片捞回来当 A 选项 ✓
 *  ⚠ 宁可不救也不许救错：只有“可疑痕迹 + 明确的首个选项标记 + 短碎片（≤8 字）”三条同时成立才动手。
 *  @param letters 已经切出来的选项字母（如 ['B','C','D']）
 *  @param options 已经切出来的选项文本（顺序同 letters）
 *  @param content 该题在 content_list 里的原文（没有就原样返回）
 */
export function recoverLeadingOption(content: string | undefined, letters: string[], options: string[], stemTail?: string): string[] {
  if (!content || !options.length || options.length >= 4) return options
  // ⚠ 先把范围**缩到这道题**：content 是整篇的块文本，直接 search 会找到别的题的 "B." ✗
  //   用题干末尾 24 字（唯一性最强的一段）定位 → 只在它后面 400 字里找选项标记 ✓
  let scope = content
  const tail = String(stemTail || '').replace(/\s+/g, ' ').trim().slice(-24)
  if (tail) { const k = content.indexOf(tail); if (k >= 0) scope = content.slice(k, k + 400) }
  const found = Array.from(new Set(letters)).filter((L) => 'ABCD'.indexOf(L) >= 0).sort()
  if (!found.length || found.indexOf('A') >= 0) return options      // A 在，不用救
  const first = found[0]                                            // 通常 'B'
  const re = new RegExp('[（(]?\\s*' + first + '\\s*[.、．)）]')
  const i = scope.search(re)
  if (i <= 0) return options
  const head = scope.slice(0, i)
  if (!/\$[^$]*=\s*[A-D]\s*\$/.test(head)) return options          // 没有“= A$”痕迹 → 别乱救
  const m = head.match(/[。．.,，]\s*([^。．.,，]{1,8})\s*$/)
  if (!m) return options
  const frag = m[1].replace(/\$/g, '').trim()
  if (!frag || /^[A-D]$/.test(frag)) return options
  const out = options.slice()
  out.unshift(frag)
  return out
}
/// 【当前这批导入的 content_list 原文】由导入侧（MinerU）设置 → 解析器用它救回被 MD 吃掉的选项 ✓
let currentContentList = ''
export function setContentList(text: string) { currentContentList = text || '' }
export function getContentListLen(): number { return currentContentList.length }

/** 【去掉卷首"抬头"】结构化正文（content_list 一块一行）的开头常混进试卷标题/卷次（如
 *  `Z20+ 名校联盟…2027 届高三第一次学情诊断 第I卷`）—— 老的关键词规则认不出"联盟/诊断"这类写法 ✗。
 *  这里改成**结构判断**：一直跳到第一个"像题开始"的行（题号行 或 小节标题行）为止 ✓ */
export function stripLeadingMatter(text: string): string {
  const ls = text.split('\n')
  for (let i = 0; i < ls.length; i++) {
    const t = ls[i].trim()
    if (!t) continue
    // ⚠ 考生须知也长成 `1. 本卷满分…` 的样子 ✗ → 带须知词的先跳过（否则会把须知当成第一道题）
    if (noteHits(t) >= 1) continue
    if (/^\d{1,3}\s*[.、．)）]\s*\S/.test(t) || isSegmentHead(t) || /^[（(]\s*\d{1,3}\s*分/.test(t)) {
      return ls.slice(i).join('\n')
    }
  }
  return text
}

export function typeOfSegmentHead(t: string): string {
  const s = t.replace(/[#*`_\s]/g, '')
  if (/多选|多项选择|有多项符合/.test(s)) return 'multi'
  // ⚠ 「单选题」「单项选择题」也要认（实测真卷写的是「单选题：…只有一项是符合题目要求的」——
  //   原来只写了"选择题/只有一项符合题目要求"，一个都对不上 ✗）
  if (/单选|单项选择|选择题|只有一项/.test(s)) return 'choice'
  if (/填空/.test(s)) return 'blank'
  if (/解答|证明题|计算题|应用题|必做题|选做题/.test(s)) return 'answer'
  return ''
}

/** 按「小节标题」把整篇切成若干段，每段带上题型（标题行本身不再进题面） */
export function splitBySegmentHeads(text: string): { text: string; qtype: string }[] {
  const out: { text: string; qtype: string }[] = []
  let cur: string[] = []
  let curType = ''
  // eslint-disable-next-line prefer-const
  for (const line of text.split('\n')) {
    //  开头 = 上面"非题目行剥离"阶段特意留下来的小节标题（原始行）
    if (line.charAt(0) === '' || isSegmentHead(line)) {
      if (cur.join('\n').trim()) out.push({ text: cur.join('\n'), qtype: curType })
      cur = []
      curType = typeOfSegmentHead(line)
      continue
    }
    cur.push(line)
  }
  if (cur.join('\n').trim()) out.push({ text: cur.join('\n'), qtype: curType })
  return out.length ? out : [{ text, qtype: '' }]
}

/** 这一段有没有「题目特征」（选项/答案/解析/数学符号/填空括号/下划线） */
function hasQuestionFeature(t: string): boolean {
  return (
    RE_OPT.test(t) || RE_ANSWER.test(t) || RE_SOLUTION.test(t) ||
    /[=＋+≥≤<>＜＞√∑∫π²³]|_\{2,}|＿|（\s*）|\(\s*\)/.test(t)
  )
}

/**
 * 短说明句：**短、提到试卷/答题卡、且没有任何题目特征** → 判为非题目。
 * （「考试结束后, 将本试卷和答题卡一并交回.」只含一个须知词，靠这条兜住）
 */
function isShortNote(t: string): boolean {
  if (t.length >= 45) return false
  if (!/(试卷|答题卡|答题纸|考生|监考)/.test(t)) return false
  return !hasQuestionFeature(t)
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
  // 整个块只是「Markdown 标题 / 卷头信息 / 分段标题」—— 不是题目
  if (lines.length && lines.every((l) => isMdHeadingLine(l) || isPaperInfoLine(l) || isSegmentHead(l))) return true
  if (lines.length === 1) {
    const l = lines[0]
    const hasQuestionMark =
      RE_OPT.test(l) || RE_ANSWER.test(l) || RE_SOLUTION.test(l) ||
      /[=＋+≥≤<>＜＞√∑∫π²³]|_\{2,}|＿|（\s*）|\(\s*\)/.test(l)
    if (!hasQuestionMark && l.length < 40 && RE_TITLE_WORD2.test(l)) return true
  }
  return false
}

/** MinerU 偶尔把**表格**原样吐成 HTML（<table><tr><td>x</td>…</table>）——
 *  老师看到的题面里不该有标签 ✗。这里把表格转成可读文本：
 *  单元格用 ' | ' 连、行与行之间用 ' ；' 连（数据表就成了 `x | 1 | 2 | 4 | 5 | 8 ；y | 11 | 15 | …`）。
 *  顺带：<sup>a</sup> → ^{a}、<sub>b</sub> → _{b}，其余标签一律去掉，常见实体解码。 */
function stripHtml(t: string): string {
  let s = t
  // 整张表：逐行抽单元格文本
  s = s.replace(/<table[\s\S]*?<\/table>/gi, (blk) => {
    const rows = blk.match(/<tr[\s\S]*?<\/tr>/gi) || []
    const lines = rows.map((r) => {
      const cells = (r.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || [])
        .map((c) => c.replace(/<[^>]*>/g, '').trim())
      return cells.join(' | ')
    }).filter((x) => x.trim())
    if (!lines.length) return ' '
    // 输出 **Markdown 表格**（首行当表头 + 分隔行）—— 既好读，Markdown 视图还能直接渲染 ✓
    const cells0 = lines[0].split(' | ')
    const sep = '| ' + cells0.map(() => '---').join(' | ') + ' |'
    return '\n' + ['| ' + lines[0] + ' |', sep, ...lines.slice(1).map((l) => '| ' + l + ' |')].join('\n') + '\n'
  })
  s = s.replace(/<sup[^>]*>([\s\S]*?)<\/sup>/gi, '^{$1}').replace(/<sub[^>]*>([\s\S]*?)<\/sub>/gi, '_{$1}')
  s = s.replace(/<[^>]{1,80}>/g, '')                 // 其余标签一律去掉
  s = s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  return s.replace(/[ \t]{2,}/g, ' ').trim()
}

/** 去掉 Markdown 记号（行首 `#`、成对的 `**`）与 HTML 残留 —— LaTeX 的 `$` 与反斜杠原样保留 */
function stripMd(t: string): string {
  return stripHtml(t)
    .replace(/^\s*#{1,6}(?:\s+|$)/, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .trim()
}

/**
 * 题干行里内嵌的选项标记（「…$x+y=(\quad)$ A. -5」这种把首个选项排在题干同一行的排版）。
 * 只认明确的大写选项号（A. / A． / A、 / （A）），并把数学里的 `P(a)`、`f(x)`、`A(x)` 排除在外。
 */
const RE_OPT_INLINE = /(?<![\w$\\])(?:[A-H]\s*[.、．]|（\s*[A-H]\s*）)\s*\S/

/** 找到题干行里内嵌选项标记的位置；找不到（或整行本来就是选项行）返回 -1 */
function findInlineOptionMark(line: string): number {
  const i = line.search(RE_OPT_INLINE)
  return i > 0 ? i : -1
}

/* ------------------------------------------------------------------ *
 * 以下两个函数**借鉴自参考实现** 参考/试卷/exam-import-app/src/core/examParser.ts
 * （与 `参考/试卷/mineru-poc/exam_parser.py` 行为一致，两边可交叉验证）——
 * 它们正好治我们的两个老毛病：① 选项被吞进公式 ② 题干里的杂字母把选项切乱 ✓
 * ------------------------------------------------------------------ */

/** 【公式边界修复】MinerU 常把紧跟公式的选项标签吸进公式，例如 `$|z| = A.1$`
 *  实际应为 `$|z| =$ A.1` —— 把闭 `$` 挪到选项标记前面，后面照常切选项 ✓ */
export function fixFormulaBoundary(text: string): { text: string; fixed: string[] } {
  const fixed: string[] = []
  const out = text.replace(/\$([^$]*)\$/g, (whole, inner: string) => {
    const m = /\s+([A-D][.．、][\s\S]*)$/.exec(inner)
    if (m) {
      const head = inner.slice(0, m.index).replace(/\s+$/, '')
      if (head) {
        fixed.push(inner)
        return '$' + head + '$ ' + m[1]
      }
    }
    return whole
  })
  return { text: out, fixed }
}

/** 【最长有序选项序列】题干里常有"如图 B. 点…"这种杂字母 → 只保留最长的 A→B→C→D 有序序列 ✓
 *  （参考实现同名函数；我们的 splitOptionsLine 以前是"见到标记就切"，容易被杂字母带偏 ✗） */
function longestOrderedRun<T extends { label: string }>(marks: T[]): T[] {
  let best: T[] = []
  for (let i = 0; i < marks.length; i++) {
    const seq = [marks[i]]
    let nxt = String.fromCharCode(marks[i].label.charCodeAt(0) + 1)
    for (let j = i + 1; j < marks.length; j++) {
      if (marks[j].label === nxt) {
        seq.push(marks[j])
        nxt = String.fromCharCode(nxt.charCodeAt(0) + 1)
        if (nxt > 'H') break
      }
    }
    if (seq.length > best.length) best = seq
  }
  return best
}

/** 一行里出现的**选项字母**（A/B/C/D…）—— 用来发现"缺了 A"这种结构问题。
 *  ⚠ 用"字母后面紧跟分隔符"来判：`$P = A$ 。 B. 2 C. 4 D. 8` 里那个 A 后面是 `$` → **不算** ✓ */
function optionLetters(line: string): string[] {
  const out: string[] = []
  const re = /(?<![A-Za-z$\\])([A-Ha-h])\s*[.、．)）:：]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) out.push(m[1].toUpperCase())
  return out
}

/** 一行里可能有多个选项：A．1　B．2　C．3 —— 拆成数组 */
function splitOptionsLine(line: string): string[] {
  const parts = line.split(/(?=[（(]?\s*[A-Ha-h]\s*[.、．)）]\s*)/g)
  const all: { label: string; text: string }[] = []
  for (const p of parts) {
    const m = p.match(RE_OPT)
    if (m && m[1] !== undefined) all.push({ label: (p.match(/[A-Ha-h]/) || [''])[0].toUpperCase(), text: m[1].trim() })
  }
  // ⭐ 只取**最长的有序序列**（借鉴参考实现）：题干里的杂字母（如图中 B 点）不会再把选项切乱 ✓
  const seq = longestOrderedRun(all)
  return (seq.length > 1 ? seq : all).map((x) => x.text)
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
    // 小节标题（一、选择题）也是分块边界：它必须成为**新块的第一行** ——
    // 这样块内循环先读到它、把 qtype 定好，再处理这道题 ✓（顺序错了题型就会张冠李戴）
    if (isSegmentHead(l)) {
      if (cur.some((x) => x.trim())) blocks.push(cur.join('\n'))
      cur = [l]
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
  // ⚠⚠ 顺序很关键：**先整篇剥掉"非题目行"（其中「参考答案」要整段截断），再按小节切段**。
  //   反过来（先切段再剥）会踩一个大坑：答案区里也有「## 四、解答题」这种小节标题 →
  //   它被当成新一段的开始，而这一段的文本里已经没有「参考答案」那行标题了 →
  //   **答案被当成好几道题** ✗（实测真卷 19 题变 24 题，多出来的 5 条正是填空/解答答案）
  // 结构化正文（content_list）开头常有抬头 → 先按结构跳到第一道题 ✓
  const body = stripLeadingMatter(raw)
  const stripped = stripNonQuestionLines(body)
  skippedNonQuestion = stripped.skipped
  // 小节标题（一、选择题…）由 splitBlocks 当成分块边界、在块内循环里被识别成题型 ✓
  const out = parseSegment(stripped.text, '')
  // ⭐ 再用"**区段题号计数**"回填一次题型：在**原始文本**上数每个小节里有几个题号，
  //   按顺序把该段的题型发给对应的题。这条不依赖"标题有没有被当成分块边界"，
  //   所以标题行怎么被剥、被合块都不影响结果 ✓（实测原来 multi/blank 一个都出不来）
  let qi = 0
  for (const seg of segmentTypesOf(raw)) {
    for (let k = 0; k < seg.nums && qi < out.length; k++, qi++) {
      if (seg.type) out[qi].qtype = seg.type
    }
  }
  return out
}

/** 在**原始文本**上按小节标题切区段，并数出每段里有几个「题号行」——用来把题型按顺序发给题。
 *  ⚠ 到「参考答案」就停（答案区里也有小节标题和"13. 24"这种行，会把计数搞乱 ✗） */
function segmentTypesOf(raw: string): { type: string; nums: number }[] {
  const out: { type: string; nums: number }[] = []
  let cur: { type: string; nums: number } | null = null
  for (const line of raw.replace(/\r\n?/g, '\n').split('\n')) {
    const t = line.trim()
    if (isAnswerSectionHead(t)) break
    if (isSegmentHead(t)) { cur = { type: typeOfSegmentHead(t), nums: 0 }; out.push(cur); continue }
    if (cur && RE_NUM.test(t)) cur.nums++
  }
  return out
}

/** 一段（一个小节）内部的切题 + 逐题解析 */
function parseSegment(raw: string, segType: string): ParsedQuestion[] {
  // 剥"非题目行"已在 parseQuestions 里对整篇做过一次（顺序原因见那里的注释）
  const out: ParsedQuestion[] = []
  for (const block of splitBlocks(raw)) {
    // ⚠ 考生须知 / 抬头 / 注意事项**不是题目** —— 它们也常以 1. 2. 编号，会被切题规则误切
    if (isNonQuestionBlock(block)) { skippedNonQuestion += 1; continue }
    // 先把"被吞进公式的选项标记"吐出来（参考实现的 fixFormulaBoundary）→ 后面照常切选项 ✓
    const ls = fixFormulaBoundary(block).text.split('\n')
    const stemParts: string[] = []
    const options: string[] = []
    const optLetters: string[] = []          // 选项字母（结构体检用：判断"是不是缺了 A"）
    let answer = ''
    let solution = ''
    let knowledge: string[] = []
    let difficulty = 3
    let year = ''
    let region = ''
    let qtype = segType                  // 小节标题给的题型（兜底见下面 hasQuestionFeature 之后）
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
      // 小节标题行（块的第一行）：定这一段所有题的题型，本身不进题面
      if (isSegmentHead(line)) { if (!qtype) qtype = typeOfSegmentHead(line); continue }
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
          optLetters.push(...optionLetters(line))
          const many = splitOptionsLine(line)
          if (many.length > 1) options.push(...many.map(stripMd))
          else options.push(stripMd(mo[1]))
          continue
        }
        // 首个选项跟题干排在同一行（MinerU 混排）—— 从标记处切开：前半当题干，后半拆成选项
        const mi = findInlineOptionMark(line)
        if (mi > 0) {
          const head = stripMd(line.slice(0, mi))
          if (head) stemParts.push(head)
          optLetters.push(...optionLetters(line.slice(mi)))
          options.push(...splitOptionsLine(line.slice(mi)).map(stripMd))
          continue
        }
        stemParts.push(stripMd(line))
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
    // 题型兜底：小节标题没给 → 按结构猜（有选项 = 选择；有下划线空 = 填空；否则解答）
    if (!qtype) {
      const all = stem + ' ' + options.join(' ')
      qtype = options.length >= 1 ? 'choice'
        // MinerU 的空是**转义下划线** ____ → 别忘了带反斜杠那种
        : /_{3,}|＿{3,}|\\_{2,}/.test(all) ? 'blank' : 'answer'
    }
    // 【救回被吃掉的选项】v1428 起**正文与 content_list 是同一份文本**（一块一行）→
    //   按"题干末尾 24 字"定位一定命中 ✓ 所以这里可以放心接上了 ✓
    if ((qtype === 'choice' || qtype === 'multi') && options.length >= 1 && options.length < 4) {
      const rec = recoverLeadingOption(currentContentList, optLetters, options, stemParts.join(' '))
      if (rec !== options && rec.length > options.length) { options.length = 0; options.push(...rec) }
    }
    // 【结构修复】选择题/多选题却只切出 1~3 个选项 → 按**字母**把缺的位置补成"（识别缺失，请补）"。
    //   ⚠ 必须放在"题型兜底"**之后**：块内不一定有小节标题，兜底之前 qtype 还可能是空的 ✗
    //   实测：MinerU 有时把 A 选项并进公式（`$P = A$` 吃掉了 `A. 1`），只剩 B/C/D →
    //   补回 4 个位置，老师在列表里一眼看到**缺的是哪一个**（而不是一道"三选项选择题"）
    if ((qtype === 'choice' || qtype === 'multi') && options.length >= 1 && options.length < 4) {
      const found = Array.from(new Set(optLetters)).filter((L) => 'ABCD'.indexOf(L) >= 0)
      if (found.length && found.length < 4) {
        const padded: string[] = []
        let fi = 0
        for (const L of ['A', 'B', 'C', 'D']) {
          if (found.indexOf(L) < 0) padded.push('（识别缺失，请补）')
          else { padded.push(options[fi] !== undefined ? options[fi] : '（识别缺失，请补）'); fi++ }
        }
        options.length = 0
        options.push(...padded)
      }
    }
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
      warn: !answer && !options.length ? '没有识别到答案'
        // 选择题/多选题却切不出 4 个选项 → 大概率是 MinerU 把某个选项吃进公式/版式里了
        // （实测：某题 A 选项被并进 $P = A$，只剩 B/C/D 三个）→ **标出来让人核对**，不要假装没事
        : (qtype === 'choice' || qtype === 'multi') && options.length < 4
          ? '选择题但只切出 ' + options.length + ' 个选项，请核对（可能是识别时选项被并进公式）'
          : undefined,
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
