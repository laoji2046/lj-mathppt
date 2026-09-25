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
  /** 【v1453】原图所在页（MinerU 给的几何，用来把图按位置归属到题 ✓） */
  page?: number
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
  /** 【优化】题面上的**原始题号**（1..N；多卷时每卷各自从 1 开始）——
   *  卷尾答案区要靠它把答案配回来 ✓（以前这个号被切题时丢掉了） */
  no?: number
  /** 题干/选项里引用的插图（[图N] 对应的图）—— MinerU 导入时填，其余来源留空 */
  images?: QuestionImage[]
  warn?: string
}

const RE_NUM = /^\s*\d{1,3}\s*[.、．)）]\s*/
const RE_SEP = /^\s*-{3,}\s*$/
const RE_OPT = /^\s*[（(]?\s*[A-Ha-h]\s*[.、．)）]\s*(.*)$/
// 【v1531】答案 / 解析的标签要认**变体**：真实卷子写「【参考答案】」「【锤子数学解析】」「【答案与解析】」
//   （「锤子解析」这类教辅满篇都是 `【答案】C` + `【锤子数学解析】…`，旧正则只认【解析】✗）
const RE_ANSWER = /^\s*(?:【\s*参考答案\s*】|【\s*答案\s*】|答案\s*[:：]?)\s*(.*)$/
const RE_SOLUTION = /^\s*(?:【[^】]{0,12}(?:解析|详解|解答|分析)[^】]{0,6}】|【解析】|【详解】|解析\s*[:：]|解\s*[:：])\s*(.*)$/
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
/** 【v1613】题干**开头**的「（12分）」—— 也是这道题的分值 ✓（「4. （12分）已知…」这种最常见 ✓）
 *  ⚠ 必须限定**开头** ✗：小问里的「（5分）」是**小问**分值 ✓ 全文乱找会误取 ✓
 *    （用户实测：解答题分值抽不出来 ✓） */
const RE_LEAD_SCORE = /^\s*[（(]\s*(\d{1,3})\s*分\s*[)）]/
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
  /** 【v1531】是否在「注意事项 / 考生须知」块里：块内的编号条目**都不是题** ✓
   *  以前只认带关键词的行，`5. 保持卷面清洁，不折叠、不破损。` 就从这里漏出去变成「第 1 道题」✗ */
  let inNotes = false
  for (let i = 0; i < ls.length; i++) {
    const t = ls[i].trim()
    if (!t) continue
    if (RE_NOTE_HEAD.test(t) || /注意事项|考生须知|答题须知|考试说明|答题说明/.test(t)) { inNotes = true; continue }
    if (inNotes) {
      // 段落标题 = 须知块结束，正文从这一行开始 ✓
      if (isSegmentHead(t)) return ls.slice(i).join('\n')
      if (isNoteItem(t)) continue
      inNotes = false
    }
    // ⚠ 考生须知也长成 `1. 本卷满分…` 的样子 ✗ → 带须知词的先跳过（否则会把须知当成第一道题）
    if (noteHits(t) >= 1) continue
    if (/^\d{1,3}\s*[.、．)）]\s*\S/.test(t) || isSegmentHead(t) || /^[（(]\s*\d{1,3}\s*分/.test(t)) {
      return ls.slice(i).join('\n')
    }
  }
  return text
}
/** 【v1531】须知条目（卷首「注意事项」块里的条目）—— 编号 + 考场用语 ✓
 *  实测：`5. 保持卷面清洁，不折叠、不破损。` 一个须知关键词都没有（noteHits=0）→
 *  以前 stripLeadingMatter 从这里开始返回 → 它被当成**第 1 道题**，还占了题号 5 ✗
 *  （`3. 选择题答案使用 2B 铅笔填涂…` 同理） */
function isNoteItem(t: string): boolean {
  if (!/^\s*[(（]?\s*\d{1,3}\s*[.、．)）]/.test(t)) return false
  if (hasQuestionFeature(t)) return false
  return /卷面|答题卡|答题纸|答题区|考生|监考|准考证|条形码|铅笔|签字笔|中性笔|涂改|违纪|开考|交卷|无效|姓名|填涂|作答|考试|满分|分钟|页/.test(t)
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

/**
 * 【优化】卷名行 → 卷名（认不出返回空串）
 *   真实场景：**一个 PDF 里拼了好几份卷**（实测一份 4 卷 / 118 题），卷名写成
 *   「2025年全国I卷」「2025 年北京卷」「2025年上海卷(春)」「北京市丰台区 2027 届高三开学练习卷」。
 *   这些行其实一直在正文里（content_list 的 text_level 块），只是被压成普通行、没人认 →
 *   每道题的 paperName 都是空 → 库里「未归档」一大片 ✗
 *   只认**短、没有题目特征**的行，免得把题干里提到的卷名当真 ✓
 */
function paperNameOf(line: string): string {
  const s = stripMark(line).trim()
  if (!s || s.length > 40) return ''
  // ⚠ 考生须知/答题卡那句也含「试卷」二字（「考生务必将答案答在答题卡上，在试卷上作答无效」）——
  //   实测它是**最大的误报源**，必须先挡掉 ✗
  if (RE_NOTE_HEAD.test(s) || isScoreOnlyLine(s) || isPaperInfoLine(s) || noteHits(s) >= 1 || isShortNote(s)) return ''
  // ⚠ 实测误报（21 套真题抓出来的）：「第I卷 / 第Ⅱ卷」是**卷次**不是卷名；
  //   「数学试卷 / 数学试题卷」这种通用名没区分度；「本卷命题范围…」是说明行 ✓
  if (/^第\s*[ⅠⅡⅢⅣⅤIVX一二三四五]+\s*卷/.test(s)) return ''
  if (/^[数学语文英语物理化学生物政治历史地理]{2,4}(试题|试卷|试题卷)$/.test(s)) return ''
  if (/命题范围|考试范围|注意事项/.test(s)) return ''
  // 【v1468】「第X套 / 套X」是**分套标题** ✓ —— 一份 PDF 拼好几套练习时最常见的写法（「第一套」「第2套」✗）
  //   以前不认 → 那几套全落「未归档」✗，而且标题行还会被**上一题的解析吞掉** ✗（合成用例 C 实测 ✓）。
  //   ⚠ 只认「第…套」这种明确分套的写法 ✓：不碰「第I卷」（卷次，上一行已挡 ✗），
  //     也不认「练习一 / 专题一」（正文里出现太多，容易撞车 ✗）。
  if (/^第\s*[0-9一二三四五六七八九十百]+\s*套/.test(s)) return s
  if (/^套\s*[0-9一二三四五六七八九十百]+\s*$/.test(s)) return s
  // ⚠ 「数学参考答案、提示及评分细则」「完卷时间：120 分钟；满分：150 分」也不是卷名（实测误报源）✓
  if (/答案|解析|评分细则|评分标准/.test(s)) return ''
  if (/完卷时间|考试时间|答题时间|满分|分钟/.test(s)) return ''
  if (isSegmentHead(s)) return ''                          // 「一、单选题」是小节标题，不是卷名
  if (RE_NUM.test(s) || /^[(（]\s*\d/.test(s)) return ''  // 「1. 已知…」「(17) (本小题 13 分)」
  if (/[？?]\s*$/.test(s) || /_{3,}/.test(s)) return ''    // 问句 / 填空线 → 是题干
  if (hasQuestionFeature(s)) return ''
  const hasJuan = /(卷|高考|真题)/.test(s)
  const hasYear = /((?:19|20)\d{2})/.test(s)
  const hasWord = RE_TITLE_WORD.test(s)
  if (!(hasJuan || (hasYear && hasWord))) return ''
  return s
}

/** 「XX卷」里的年份（认不出返回空串） */
function yearInPaper(s: string): string {
  const m = s.match(/((?:19|20)\d{2})/)
  return m ? m[1] : ''
}

/**
 * 【优化】在**原始文本**上按「卷名行」切段，并数出每段里有几个题号
 *   —— 用来把**卷名按顺序发给题**（与 segmentTypesOf 回填题型是同一套思路：**不动切题主流程** ✓）
 *   ⚠ 到「参考答案」就停（答案区里也可能出现卷名样的行）
 *   ⚠ head = 第一份卷名**之前**的题号数（那些题不属于任何一份卷）
 *   ⚠ 同一份卷的标题常连着两行（「XX区2027届…卷」+「数学试卷」）→ 取**最具体**的那行
 *     （有年份优先，其次更长的那行）✓
 */
function paperSegmentsOf(raw: string): { head: number; segs: { paper: string; year: string; nums: number }[] } {
  const segs: { paper: string; year: string; nums: number }[] = []
  let run: { s: string; y: string }[] = []
  let cur: { paper: string; year: string; nums: number } | null = null
  let head = 0
  const norm = (x: string) => x.replace(/\s+/g, '')
  const flush = () => {
    if (!run.length) return
    const best = run
      .slice()
      .sort((a, b) => (b.y ? 1 : 0) - (a.y ? 1 : 0) || b.s.length - a.s.length)[0]
    // ⚠ 同一份卷换个写法又出现（实测「2025年天津卷」与「2025 年天津卷」被拆成两份）→
    //   忽略空白后同名就**不新开段**，继续数同一份卷 ✓
    const last = segs.length ? segs[segs.length - 1] : null
    if (last && norm(last.paper) === norm(best.s)) {
      cur = last
      run = []
      return
    }
    cur = { paper: best.s, year: best.y, nums: 0 }
    segs.push(cur)
    run = []
  }
  for (const line of raw.replace(/\r\n?/g, '\n').split('\n')) {
    const t = line.trim()
    if (isAnswerSectionHead(t)) break
    const p = paperNameOf(t)
    if (p) { flush(); run.push({ s: p, y: yearInPaper(p) }); continue }
    if (!t) continue                                        // 空行不断开候选串（标题之间常有空行）
    flush()
    if (segs.length === 0) {
      if (RE_NUM.test(t)) head++
    } else {
      const c = cur as { paper: string; year: string; nums: number } | null
      if (c && RE_NUM.test(t)) c.nums++
    }
  }
  flush()
  return { head, segs }
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

/** 行首题号（`12.` / `12、` / `12)`）；不是题号返回 0 ✓ */
function lineNoOf(l: string): number {
  const m = l.match(/^\s*(\d{1,3})\s*[.、．)）]/)
  return m ? Number(m[1]) : 0
}

/**
 * 把一段文本切成若干题块。
 *
 * 【v1531】加「解析区里的编号不算新题」的判据 —— 教辅式卷子（解析紧跟每题）以前会被切坏：
 *   题干 → 【答案】C → 【锤子数学解析】… 里面写着「1、单调性…2、支撑线…」——
 *   这些 `1、2、` 被当成了新题，19 题的卷切出 37/47/35 题 ✗（实测南京/南通/金陵中学那几份）。
 * 判据：一旦本块里出现过【答案】/【解析】这类标记，后面的编号只有**大于当前题号**才算新题 ✓
 *   （真实卷的题号是往大走的；解答里的列表总是从 1 重新数 ✓）
 * 例外：小节标题（一、选择题）之后的第一条编号一律算新题 —— 有的卷按小节重新编号 ✓
 */
function splitBlocks(text: string): string[] {
  const ls = text.replace(/\r\n?/g, '\n').split('\n')
  const hasSep = ls.some((l) => RE_SEP.test(l))
  const blocks: string[] = []
  let cur: string[] = []
  /** 当前题块的题号 / 是否已进入解析 / 是否刚过小节标题 ✓ */
  let lastNo = 0
  let inSolution = false
  let afterHead = false
  const flush = () => {
    if (cur.some((x) => x.trim())) blocks.push(cur.join('\n'))
    cur = []
  }
  for (const l of ls) {
    if (hasSep) {
      if (RE_SEP.test(l)) {
        flush()
        lastNo = 0
        inSolution = false
        afterHead = false
      } else {
        cur.push(l)
        if (RE_ANSWER.test(l) || RE_SOLUTION.test(l)) inSolution = true
      }
      continue
    }
    // 小节标题（一、选择题）也是分块边界：它必须成为**新块的第一行** ——
    // 这样块内循环先读到它、把 qtype 定好，再处理这道题 ✓（顺序错了题型就会张冠李戴）
    if (isSegmentHead(l)) {
      flush()
      cur = [l]
      afterHead = true
      inSolution = false
      continue
    }
    const n = lineNoOf(l)
    const isNewQ = n > 0 && cur.some((x) => x.trim()) && (!inSolution || afterHead || n > lastNo)
    if (isNewQ) {
      flush()
      cur = [l]
      lastNo = n
      inSolution = false
      afterHead = false
      continue
    }
    cur.push(l)
    if (n > 0 && cur.length === 1) { lastNo = n; afterHead = false }
    if (RE_ANSWER.test(l) || RE_SOLUTION.test(l)) inSolution = true
  }
  flush()
  return blocks.map((b) => b.trim()).filter(Boolean)
}

function t_all(block: string): string {
  return block.split('\n').join(' ')
}

/**
 * 【优化】**拆答案**：答案区标题（「数学参考答案」「参考答案及评分标准」「答案与解析」…）
 *   实测 17 份 MinerU 缓存里 **8 份带答案区**，而我们以前是**整段截断扔掉**的 ✗
 */
function isAnswerHead(t: string): boolean {
  const s = t.replace(/^#{1,6}\s*/, '').trim()
  // 【修】实测有卷的答案区标题很长（「…第一次月考·数学参考答案、提示及评分细则」≈ 40 字）——
  //   卡在 30 字会**不认**，于是整段答案区被当题目切（那套从 ~19 题变 39 题 ✗）
  if (!s || s.length > 60) return false
  if (hasQuestionFeature(s)) return false
  if (/参考\s*答案|答案与解析|答案及评分|答案和解析/.test(s)) return true
  return /^答\s*案$/.test(s)
}

/** 【优化】整篇 → 「题目区 / 答案区」（答案区不再丢，交给 applyAnswers 按题号配回去 ✓） */
function splitAnswerRegion(raw: string): { body: string; ans: string } {
  const ls = raw.replace(/\r\n?/g, '\n').split('\n')
  for (let i = 0; i < ls.length; i++) {
    if (isAnswerHead(ls[i])) return { body: ls.slice(0, i).join('\n'), ans: ls.slice(i).join('\n') }
    // 【修】有的卷**没有「参考答案」标题**，答案区直接就是一张「题号/答案」表（实测 2 套）——
    //   也把它当答案区起点，否则表后面那堆答案会被当题目切 ✗
    //   ⚠ 只在**后半篇**找，免得把题干里的「题号/答案」统计表也当答案区 ✓
    //   ⚠ 不按位置卡（实测一套的答案表在 28% 处）—— 判据改成**表内特征**：
    //     同一张表里既有「题号」行又有「答案」行，且有 ≥4 个编号格 ✓
    if (ls[i].indexOf('<table') >= 0) {
      const win = ls.slice(i, i + 4).join(' ')
      const nums = (win.match(/<td>\s*\d{1,3}\s*<\/td>/g) || []).length
      if (/题号/.test(win) && /答案/.test(win) && nums >= 4) {
        return { body: ls.slice(0, i).join('\n'), ans: ls.slice(i).join('\n') }
      }
    }
  }
  return { body: raw, ans: '' }
}

interface AnsEntry { answer: string; solution: string }

/** 答案表（MinerU 把「题号/答案」表给成 <table>）：题号行 + 答案行 → 题号 → 答案 ✓ */
function answersFromTable(html: string, into: Map<number, AnsEntry>): void {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || []
  const cells = (r: string) =>
    (r.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map((c) =>
      c.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(),
    )
  let nums: number[] = []
  for (const r of rows) {
    const cs = cells(r)
    if (!cs.length) continue
    const head = cs[0].replace(/\s/g, '')
    if (/题号/.test(head)) { nums = cs.slice(1).map((x) => Number((x.match(/\d{1,3}/) || ['0'])[0])); continue }
    if (/答案/.test(head)) {
      cs.slice(1).forEach((v, i) => {
        const no = nums[i]
        // 题干本来就带答案的（【答案】A）不覆盖 ✓
        if (no && v && !into.has(no)) into.set(no, { answer: v.replace(/\s+/g, ''), solution: '' })
      })
    }
  }
}

/** 【v1531】答案区里的小节标题（`一、选择题` `二、填空题：…`）—— 先剥掉再解析 ✓
 *  真实写法：`一、选择题1--4CDCA 5--8BDBC`（标题和答案串**粘在一行**）✗ 老规则整行不认 */
const RE_ANS_SECHEAD = /^[\s（(]*[一二三四五六七八九十]+\s*[、.．)）]?\s*(选择题|多选题|单选题|填空题|解答题|判断题|计算题|证明题|应用题)[^0-9A-Ha-h]*/

/** 紧凑答案行：剥掉小节标题后**只剩题号 / 字母 / 分隔符** ✓
 *  真实写法：`1--4CDCA 5--8BDBC`、`9.ABC 10. AC 11. ACD.`、`1-5 ACBDA`
 *  ⚠ 判据必须严：`2B 铅笔`、`故选 A.` 这类正文不能当答案串 ✗（所以要求整行只有题号+字母+分隔符） */
function compactAnswerGroups(line: string): { no: number; letters: string }[] {
  const s = line.replace(RE_ANS_SECHEAD, '').trim()
  if (!s || !/\d/.test(s)) return []
  if (!/^[0-9A-Ha-h\s.、．,，:：;；()（）\-~—–－]+$/.test(s)) return []
  const out: { no: number; letters: string }[] = []
  const re = /(\d{1,3})\s*(?:[-~—–－]{1,2}\s*(\d{1,3}))?\s*[.、．)）:：]?\s*([A-H]{1,8})(?![A-Za-z0-9])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    const a = Number(m[1])
    const b = m[2] ? Number(m[2]) : a
    const letters = m[3]
    if (b > a) {
      // 区间写法（`1--4CDCA`）：字母数必须正好等于题数，否则**不猜** ✓
      if (letters.length !== b - a + 1) continue
      for (let i = 0; i < letters.length; i++) out.push({ no: a + i, letters: letters[i] })
    } else {
      out.push({ no: a, letters })
    }
  }
  return out
}

/** 【v1531】一行里有多个「题号 + 内容」条目 → 拆开分别处理 ✓
 *  真实写法：`12. 2 13. $\frac{\sqrt{3}}{2}$ 14. 240`（填空答案挤在一行）✗ 老规则只认第一个 */
function splitNumberedLine(line: string): string[] {
  if (line.length > 200) return [line]
  const ms = Array.from(line.matchAll(/(?:^|[\s；;，,])(\d{1,3})\s*[.、．)）]\s+\S/g))
  if (ms.length < 2) return [line]
  // 题号必须**连号**（12、13、14…）：只判「递增」不够 ——
  //   实测踩坑：正文里「中位数为 4. 故选 B.」的 4. 被当成第二个条目，硬拆成两段 → 答案/解析全错位 ✗
  const nums = ms.map((m) => Number(m[1]))
  for (let i = 1; i < nums.length; i++) if (nums[i] !== nums[i - 1] + 1) return [line]
  const cuts = ms.map((m) => m.index! + (m[0].length - m[0].replace(/^[\s；;，,]*/, '').length))
  const parts: string[] = []
  if (cuts[0] > 0) parts.push(line.slice(0, cuts[0]))
  for (let i = 0; i < cuts.length; i++) parts.push(line.slice(cuts[i], i + 1 < cuts.length ? cuts[i + 1] : undefined))
  const clean = parts.map((p) => p.trim()).filter(Boolean)
  // 每一条都要**短**（填空答案那种）；段落长句里的编号不该走这条路 ✓
  if (clean.some((p) => p.length > 80)) return [line]
  return clean
}

/** 【v1531】没写题号的解答块头（`解：(1)…` / `证明：…`）—— 解答题在答案区常这么排 ✓
 *  ⚠ 必须排除「有题号的」（`15、解：`）：那种走常规的按题号配 ✓ */
function isSolBlockHead(line: string): boolean {
  if (!/^[(（]?\s*\d{1,3}\s*[)）.、．]/.test(line)) return false
  return /^(?:解|证明|分析|解答)\s*[:：]/.test(line)
}

/** 逐题 / 串式答案 —— 真实写法：`1. B 将样本数据…故选B.`、`1-5 ACBDA`、`【答案】…【解析】…` ✓ */
function answersFromLines(ans: string, into: Map<number, AnsEntry>, blocks: string[]): void {
  const ls = ans.replace(/<table[\s\S]*?<\/table>/gi, '').split('\n')
  let curNo = 0
  /** 【v1531】正在累积的「没写题号的解答块」（`解：(1)…`）—— 见 isSolBlockHead ✓ */
  let curBlock: string[] | null = null
  /** 收尾：把正在累积的解答块推进 blocks[] ✓ */
  const flushBlock = () => { if (curBlock && curBlock.length) blocks.push(curBlock.join('\n')); curBlock = null }
  /** 处理一行（返回 true = 这行已经消费掉了）。拆行后要对每一段都跑一遍 ✓ */
  const consume = (line: string): boolean => {
    // ① 答案串：`1-5 ACBDA` / `9~10：BC`
    const mRun = line.match(/^[(（]?\s*(\d{1,3})\s*[-~—]\s*(\d{1,3})\s*[)）]?\s*[:：.、]?\s*([A-H]{2,})\s*$/)
    if (mRun) {
      const a = Number(mRun[1])
      mRun[3].split('').forEach((v, i) => { const no = a + i; if (!into.has(no)) into.set(no, { answer: v, solution: '' }) })
      return true
    }
    // ② 一行多组：`1.A 2.B 3.C`
    const pairs = Array.from(line.matchAll(/(\d{1,3})\s*[.、．)）]\s*([A-H])(?![A-Za-z0-9])/g))
    if (pairs.length >= 2) {
      for (const p of pairs) { const no = Number(p[1]); if (!into.has(no)) into.set(no, { answer: p[2], solution: '' }) }
      return true
    }
    const m = line.match(/^[(（]?\s*(\d{1,3})\s*[)）.、．]\s*([\s\S]*)$/)
    if (m) {
      curNo = Number(m[1])
      let rest = m[2].trim()
      // 【v1531】答案区里解答题常写成 `18.（17分）解：(1)…` —— 分值**不是答案**，先剥掉 ✓
      //   （实测：「（17 分）」被当成答案填进了题库 ✗）
      const mScore = rest.match(/^[(（]\s*\d{1,3}\s*分\s*[)）]\s*/)
      if (mScore) rest = rest.slice(mScore[0].length)
      const tagged = rest.match(/^【答案】\s*([\s\S]*?)(?:【解析】|【详解】|$)([\s\S]*)$/)
      const coloned = rest.match(/^答案\s*[:：]\s*([\s\S]*?)(?:解析\s*[:：]|$)([\s\S]*)$/)
      const g = tagged || coloned
      if (g) {
        // 解析正文里别再带「【解析】」标签（存进库的应该是纯解析 ✓）
        const sol = String(g[2] || '').replace(/^\s*(【解析】|【详解】|解析\s*[:：])\s*/, '').trim()
        if (!into.has(curNo)) into.set(curNo, { answer: g[1].trim(), solution: sol })
        return true
      }
      const mA = rest.match(/^([A-H])(?:\s|$|[.、．)）])([\s\S]*)$/)
      if (mA) { if (!into.has(curNo)) into.set(curNo, { answer: mA[1], solution: mA[2].trim() }); return true }
      // 填空/解答：第一句短、**且不像解释**才当答案；否则整段当解析（不硬塞 ✓）
      //   ⚠ 实测坑：答案区写成「Q7 这是说明文字」时，整句被当成答案 → 答案字段塞进一段话 ✗
      const first = (rest.split(/[。．.;；]/)[0] || '').trim()
      // 【v1531】`解：` 全角冒号也要算「这是解析不是答案」—— 解答题答案区写的就是 `15.（13分）解：…`
      //   （旧正则只写了半角 `解:` → 整段被当答案塞进 answer ✗）
      const explain = /因为|所以|故选|由题|解得|可得|证明|析|解\s*[:：]/.test(first)
      const short = first.length > 0 && first.length <= 24 && !explain && !/^[(（]\s*[1-9]\s*[)）]/.test(first)
      if (!into.has(curNo)) into.set(curNo, short ? { answer: first, solution: rest.slice(first.length).trim() } : { answer: '', solution: rest })
      return true
    }
    return false
  }
  for (const rawLine of ls) {
    const line = rawLine.trim()
    if (!line || isAnswerHead(line)) continue
    // ⓪ 【v1531】紧凑答案行：`一、选择题1--4CDCA 5--8BDBC`（区间）/ `9.ABC 10. AC 11. ACD.`（多组字母）
    const groups = compactAnswerGroups(line)
    if (groups.length) {
      flushBlock()
      for (const g of groups) if (!into.has(g.no)) into.set(g.no, { answer: g.letters, solution: '' })
      // ⚠ 必须把 curNo 停在最后一个题号上：真实写法是「`1. C` 一行、`【解析】…` 下一行」——
      //   不设 curNo 的话，下一行的解析就挂不上去了 ✗（实测：11 份样本的解析会整段丢）
      curNo = groups[groups.length - 1].no
      continue
    }
    // ⓪b 【v1531】一行多条目：`12. 2 13. $\frac{\sqrt{3}}{2}$ 14. 240` → 拆开逐条吃 ✓
    const parts = splitNumberedLine(line)
    if (parts.length > 1) { flushBlock(); for (const p of parts) consume(p); continue }
    // ⓪c 【v1531】没写题号的解答块：`解：(1)…`（表格给完 1~11，后面 15~19 直接写「解：」）✓
    if (isSolBlockHead(line)) { flushBlock(); curBlock = [line]; curNo = 0; continue }
    if (curBlock) { curBlock.push(line); continue }
    if (consume(line)) continue
    // ③ 续行 → 挂到当前题号的解析上
    if (curNo && into.has(curNo)) {
      const e = into.get(curNo) as AnsEntry
      e.solution = (e.solution ? e.solution + '\n' : '') + line
    }
  }
  flushBlock()
}

/** 清掉一条具体的告警（配到答案后「没有识别到答案」就不该再挂着 ✓） */
function clearWarn(q: ParsedQuestion, kw: string): void {
  const w = String(q.warn || '')
  if (!w) return
  const left = w.split('；').filter((x) => x.trim() && x.indexOf(kw) < 0).join('；')
  q.warn = left || undefined
}

/**
 * 【优化】把卷尾答案区配到题上。规则（**能对上的才配，对不上就留空 + 说明**）：
 *   ① 优先按**题号**配（题目自带 no，答案区也按题号列）；
 *   ② 题号一个都没配到、但答案条数正好等于题数 → 按顺序配，并挂 warn 提醒核对；
 *   ③ **多卷合一**的卷先不自动配（答案区通常只列一份卷的题号，配错比不配更糟 ✗）→ 留空 + 说明。
 */
function applyAnswers(out: ParsedQuestion[], ans: string): void {
  if (!out.length || !ans.trim()) return
  const map = new Map<number, AnsEntry>()
  /** 【v1531】答案区里**没写题号**的解答块（`解：(1)…`），按出现顺序收着 —— 见下面第 ④ 条 ✓ */
  const blocks: string[] = []
  answersFromTable(ans, map)
  answersFromLines(ans, map, blocks)
  if (!map.size && !blocks.length) return
  // 多卷合一：答案区**紧跟在最后一份卷的题目后面** → 只配「最后一份卷」的题
  //   （这是排版上的确定事实，不是猜 ✓；实测 3 套真题因为「假卷名」触发了旧的全禁规则，答案白丢）
  const order: string[] = []
  for (const q of out) {
    const p = String(q.paperName || '').trim()
    if (p && order.indexOf(p) < 0) order.push(p)
  }
  const multi = order.length > 1
  const lastPaper = multi ? order[order.length - 1] : ''
  const mine = (q: ParsedQuestion) => !multi || String(q.paperName || '').trim() === lastPaper
  const put = (q: ParsedQuestion, e: AnsEntry | undefined, note?: string) => {
    if (!e) return false
    let did = false
    // 【v1531】只由标点组成的「解析」是噪声（实测解答块会收进孤零零的 `。`）→ 不写库 ✓
    const solid = (x: string) => !!x && !/^[\s。．.，,；;：:、·\-—…（）()【】\[\]]*$/.test(x)
    if (!q.answer && solid(e.answer)) { q.answer = e.answer; did = true }
    if (!q.solution && solid(e.solution)) { q.solution = e.solution; did = true }
    if (did) {
      clearWarn(q, '没有识别到答案')
      if (note) q.warn = [q.warn, note].filter(Boolean).join('；')
    }
    return did
  }
  let hit = 0
  const withNo = out.filter((q) => q.no).length
  const note = multi ? '多卷合一：答案按「紧跟在答案区前面的最后一份卷」配（' + lastPaper + '），请核对' : ''
  if (withNo >= Math.ceil(out.length * 0.6)) {
    for (const q of out) {
      if (!mine(q)) continue
      if (put(q, q.no ? map.get(q.no) : undefined, note)) hit++
    }
  }
  if (!hit && !multi && map.size === out.length) {
    const keys = Array.from(map.keys())
    out.forEach((q, i) => { if (put(q, map.get(keys[i]), '答案按**顺序**从卷尾答案区配来（题号对不上），请核对')) hit++ })
  }
  // ④ 【v1531】答案区里没写题号的解答块：**只配「答案和解析都还是空」的那几道**，
  //    且块数与这些题的条数**完全相等**才配（能对上才配，对不上就留空 + 说明 ✓）
  if (!multi && blocks.length) {
    const need = out.filter((q) => mine(q) && !(q.answer || '').trim() && !(q.solution || '').trim())
    if (need.length === blocks.length) {
      need.forEach((q, i) => {
        q.solution = blocks[i]
        clearWarn(q, '没有识别到答案')
        q.warn = [q.warn, '卷尾答案区里这道题没写题号，解析按**顺序**配来，请核对'].filter(Boolean).join('；')
        hit++
      })
    }
  }
  if (multi && hit) {
    // 别的卷说明一句（它们没被配，别让人以为漏了 ✓）
    out.forEach((q) => {
      if (!mine(q)) q.warn = [q.warn, '多卷合一：卷尾答案区属于最后一份卷（' + lastPaper + '），本卷未自动配答案'].filter(Boolean).join('；')
    })
  }
  if (hit) {
    out.forEach((q) => { if (!q.answer && !q.solution) q.warn = [q.warn, '卷尾答案区里没找到这道题的答案'].filter(Boolean).join('；') })
  }
}

/** 归一化题干：只留「字」（用于判重）—— 去空白、标点、$ 与 LaTeX 括号 ✓ */
function normStem(s: string | undefined): string {
  return String(s || '')
    .replace(/[\s\u3000]/g, '')
    .replace(/[，,。.、；;：:！!？?（）()【】\[\]{}<>《》"'“”‘’·\-—_/\\|~^]/g, '')
    .replace(/\$/g, '')
}

/**
 * 【v1531】同一份卷里题面出现两遍 → 合并成一道。
 *
 * 实测：「试卷 + 解析版」合在一个 PDF 里时，19 题的卷会被切成 37 题 ✗
 *   （第 20~37 题是同一批题的第二份题面，几乎逐字相同）。
 * 判据（两条都要满足，**宁可不合** ✗）：
 *   ① 归一化后**前 60 字**完全相同（越短越容易误合，宁可不合）；
 *   ② 两边归一化长度相差 ≤ 25%（防「开头一样、其实不同题」被误合）。
 * 合并方向：保留**先出现**的那道，缺的答案/解析/图从后一道补过来，并在题上说明 ✓
 */
function mergeDuplicates(list: ParsedQuestion[]): ParsedQuestion[] {
  const out: ParsedQuestion[] = []
  const seen = new Map<string, ParsedQuestion>()
  for (const q of list) {
    const key = normStem(q.stem)
    const k = key.slice(0, 60)
    const hit = k.length >= 12 ? seen.get(k) : undefined
    if (hit) {
      const a = normStem(hit.stem).length
      const b = key.length
      if (a > 0 && b > 0 && Math.abs(a - b) / Math.max(a, b) <= 0.25) {
        if (!hit.answer && q.answer) hit.answer = q.answer
        if (!hit.solution && q.solution) hit.solution = q.solution
        if ((!hit.images || !hit.images.length) && q.images && q.images.length) hit.images = q.images
        if (!hit.no && q.no) hit.no = q.no
        hit.warn = [hit.warn, '这份卷里这道题出现了两遍（试卷 + 解析版），已合并成一道'].filter(Boolean).join('；')
        continue
      }
    }
    if (k.length >= 12 && !seen.has(k)) seen.set(k, q)
    out.push(q)
  }
  return out
}

export function parseQuestions(raw: string): ParsedQuestion[] {
  // ⚠⚠ 顺序很关键：**先整篇剥掉"非题目行"（其中「参考答案」要整段截断），再按小节切段**。
  //   反过来（先切段再剥）会踩一个大坑：答案区里也有「## 四、解答题」这种小节标题 →
  //   它被当成新一段的开始，而这一段的文本里已经没有「参考答案」那行标题了 →
  //   **答案被当成好几道题** ✗（实测真卷 19 题变 24 题，多出来的 5 条正是填空/解答答案）
  // 结构化正文（content_list）开头常有抬头 → 先按结构跳到第一道题 ✓
  // 【优化】答案区**不再整段丢弃**：先拆出来（body 走原来的路；ans 交给 applyAnswers）✓
  const { body: rawMain, ans: rawAns } = splitAnswerRegion(raw)
  const body = stripLeadingMatter(rawMain)
  const stripped = stripNonQuestionLines(body)
  skippedNonQuestion = stripped.skipped
  // 小节标题（一、选择题…）由 splitBlocks 当成分块边界、在块内循环里被识别成题型 ✓
  const out = parseSegment(stripped.text, '')
  // ⭐ 再用"**区段题号计数**"回填一次题型：在**原始文本**上数每个小节里有几个题号，
  //   按顺序把该段的题型发给对应的题。这条不依赖"标题有没有被当成分块边界"，
  //   所以标题行怎么被剥、被合块都不影响结果 ✓（实测原来 multi/blank 一个都出不来）
  let qi = 0
  for (const seg of segmentTypesOf(rawMain)) {
    for (let k = 0; k < seg.nums && qi < out.length; k++, qi++) {
      if (seg.type) out[qi].qtype = seg.type
    }
  }
  // ⭐⭐ 【优化】卷名回填（同一套「区段计数」思路，**不动切题主流程**）：
  //   一个 PDF 里拼了好几份卷时（实测一份 4 卷 / 118 题），每道题该带上**自己那份卷**的卷名 ——
  //   以前全是空 → 库里「未归档」一大片；而卷名一直就在正文里，只是被压成普通行、没人认 ✗
  const pseg = paperSegmentsOf(rawMain)
  let pi = pseg.head
  for (const seg of pseg.segs) {
    for (let k = 0; k < seg.nums && pi < out.length; k++, pi++) {
      out[pi].paperName = seg.paper
      if (seg.year && !out[pi].yearExplicit) out[pi].year = seg.year
    }
  }
  // ⭐⭐ 【优化】拆答案：卷尾答案区 → 按题号配到题上（配不上留空 + 说明，**不猜** ✓）
  if (rawAns) applyAnswers(out, rawAns)
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
    // 【优化】块的第一行就是题号行（splitBlocks 就是按题号行切块的）→ 记下这道题的原始题号 ✓
    let no = 0
    {
      const firstLine = ls.find((x) => x.trim() && !isSegmentHead(x)) || ''
      const mn = firstLine.match(/^\s*[(（]?\s*(\d{1,3})\s*[.、．)）]/)
      if (mn) no = Number(mn[1])
    }
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
      // 【v1468】卷名行**不该进任何题的正文** ✗
      //   一份 PDF 里拼好几套时，**下一套的标题行会落进上一题的块里**（splitBlocks 只按题号/小节标题切 ✗），
      //   于是被当成"解析/答案的续行"吞掉 ✗（实测：上一题的解析尾巴上多一行「2025年北京市西城区高三一模」✗）。
      //   卷名归属由 paperSegmentsOf 在整篇上单独回填 ✓，这里直接丢掉这行 ✓。
      //   ⚠ 只在**已经过了题干**之后丢（mode !== 'stem'）：万一某行的题干本身像卷名，也不至于把题干吃掉 ✗
      if (mode !== 'stem' && paperNameOf(line)) continue
      m = line.match(RE_ANSWER)
      if (m) { answer = m[1].trim(); mode = 'answer'; continue }
      m = line.match(RE_SOLUTION)
      if (m) { solution += (solution ? '\n' : '') + m[1].trim(); mode = 'solution'; continue }

      if (mode === 'stem') {
        // 【v1469】选项字母常被 MinerU 包进**加粗 / LaTeX** ✗ —— 实测（老师的 2025年.pdf）：
        //   `\$\mathbf{A}\$ . \{x…\}`（选项都在同一行）与 `\mathbf {C}. y > x > z`（选项各占一个 `$$` 块）
        //   这种写法**一个选项都切不出来** ✗（两道题被判「选择题但 0 个选项」✗）→ 先还原成普通 `A.` ✓
        const norm = line
          .replace(/\$?\s*\\mathbf\s*\{?\s*([A-H])\s*\}?\s*\$?\s*[.．、)）]/g, '$1.')
          .replace(/\*\*\s*([A-H])\s*[.．、)）]\s*\*\*/g, '$1.')
        if (/^\s*\$\$\s*$/.test(norm)) continue      // 纯公式围栏行不留进题面 ✓
        const mo = norm.match(RE_OPT)
        if (mo) {
          optLetters.push(...optionLetters(norm))
          const many = splitOptionsLine(norm)
          if (many.length > 1) options.push(...many.map(stripMd))
          else options.push(stripMd(mo[1]))
          continue
        }
        // 首个选项跟题干排在同一行（MinerU 混排）—— 从标记处切开：前半当题干，后半拆成选项
        const mi = findInlineOptionMark(norm)
        if (mi > 0) {
          const head = stripMd(norm.slice(0, mi))
          if (head) stemParts.push(head)
          optLetters.push(...optionLetters(norm.slice(mi)))
          options.push(...splitOptionsLine(norm.slice(mi)).map(stripMd))
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

    // 【v1613】分值两个来源 ✓：① 题干**开头**的「（12分）」✓ ② 块内任意处的「（本小题满分 N 分）」✓
    //   —— 原来只认 ② ✗ → 解答题的「（12分）」抽不出来 ✓（用户实测 ✓）
    const leadScore = stem.trim().match(RE_LEAD_SCORE)
    const ms = t_all(block).match(RE_FULL_SCORE)
    const scoreExplicit = leadScore ? Number(leadScore[1]) || 0 : ms ? Number(ms[1]) || 0 : 0

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
      no,
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
  // 【v1531】同一份卷里题面出现两遍 → 合并（见 mergeDuplicates）✓
  return mergeDuplicates(out)
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
