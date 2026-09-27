/**
 * 【v1692】试卷编辑里的 **AI 聊天侧栏**：口径与提示词（纯函数，探针覆盖 ✓）
 *
 * 用户口径（2026-09-27）：试卷窗口**满屏** ✓、AI 放在**输入框与预览之间**（像侧边栏 ✓）、
 *   **支持导入图片**（拍照/截图丢进来让 AI 看着改卷 ✓）、**通过聊天改试卷** ✓。
 *
 * 为什么单独一个模块：聊天那层要回答「给模型看什么 / 给它哪几个工具 / 什么算能发」——
 *   这些都是**能测的规则** ✓（界面与网络调用留在 AiPaperChat.vue ✓）。
 */
import type { AiToolCtx } from '@/composables/aiTools'
import { STYLE_CLOSER_RULE } from '@/composables/paperStyle'

/** 一次最多带几张图（与 AI 助手口径一致 ✓ 再多会超视觉模型的上下文 ✗） */
export const PAPER_CHAT_MAX_IMG = 4
/** 单张最大字节（4MB ✓ 与 AI 助手一致） */
export const PAPER_CHAT_MAX_BYTES = 4 * 1024 * 1024

/**
 * 试卷聊天**只给这四个工具** ✓：
 *   · 幻灯片那套（add_slide / insert_text / insert_math_figure …）在试卷里用不上 ——
 *     给了模型只会乱调，还会把话说岔（它以为在改幻灯片 ✗）。
 */
export const PAPER_TOOL_NAMES = [
  'get_paper_state', 'append_to_paper', 'insert_bank_question_to_paper', 'search_bank',
  'get_paper_help', 'get_paper_style', 'set_paper_style', 'apply_paper_template',
  'set_paper_header', 'insert_paper_figure', 'print_paper', 'edit_paper_text',
  'get_paper_outline', 'replace_paper_question', 'insert_paper_question',
]

/** 从完整工具表里只挑试卷用得上的（名字认不出就跳过，不炸 ✓） */
export function paperToolsOf(all: unknown[]): unknown[] {
  const keep = new Set(PAPER_TOOL_NAMES)
  const out: unknown[] = []
  for (const t of all || []) {
    const name = String(((t as { function?: { name?: unknown } })?.function?.name) || '')
    if (keep.has(name)) out.push(t)
  }
  return out
}

/**
 * 试卷助手的 system：**排版约定写死** ✓
 * 不写它就会用 Markdown 的 # 当标题、把题写成散文、自己编图号 ✗（试卷认不出来就只能重排 ✗）。
 */
export function buildPaperChatSystem(): string {
  return [
    '你是高中数学老师的**试卷编辑助手**。老师在「试卷编辑」窗口里编一份 A4 试卷（左边源码、右边实时预览）。',
    '你要**主动用工具**改这份试卷，不要只说"你可以…"。动手前先 get_paper_state 看现在的内容 ✓。',
    '老师可能带**附件**（截图 / 参考文档 ✓）：截图要照着读文字，文档是参考材料 —— 要不要落到试卷**由老师的话决定** ✓，别自作主张把整篇文档倒进卷子 ✗。',
    '试卷的排版约定（写错就排不出来 ✗）：',
    '· 以 # 开头是居中大标题；## 一、选择题 这种是**大题标题**（方块标题）；### 是小标题；',
    '· 题号写成 1. 题干…  （试卷会按 autoNum 自动重排 ✓）；小问写 (1) …；',
    '· 一道题建议写成**整块**（题干 / 选项 / 解析不会被分页拆开 ✓）：',
    '  [题] 换行  1. 题干…  换行  [选项] 换行  A. …　B. …　C. …　D. …  换行  [解析] 换行  【答案】…  换行  [/题]；',
    '· 公式一律 $…$（行内）或 $$…$$（独立行）；',
    '· 插图用 [图N]（N 是图片库里已有的号 ✓）或 Markdown 图片语法 ![图注](地址)；**不要凭空编图号** ✗；',
    '· [分页] 手动分页、[换页] 等价、[4cm] 空白高度、{c:red; b} 段落样式；',
    '· 页眉页脚是**设置项**，不要写进正文 ✗。',
    '要写具体语法（[题] 块、段落样式、图片写法、可改设置项）时先调 get_paper_help 查手册 ✓；改设置用 set_paper_style、页眉页脚用 set_paper_header、插数学图形用 insert_paper_figure、要 PDF 用 print_paper ✓。',
    PAPER_EDIT_RULE,
    '老师说「加一道…」就用 append_to_paper 追加；说「从题库找一道…」先 search_bank 再 insert_bank_question_to_paper；',
    '**老师说「第 N 题…」时先 get_paper_outline 拿题号与行号** ✓ → 再用 replace_paper_question / insert_paper_question（按题号最稳 ✓，别自己数、也别猜原文 ✗）。',
    '老师说「这道题选项排成两行 / 一行 / 四行」时：**改那一题** —— 在**那题题干行末尾**加 [两行] / [一行] / [四行] ✓（用 replace_paper_question 整题换掉最稳 ✓）；只有说「整卷都…」才用 set_paper_style 的 optLayout ✓。',
    '⚠ **回复要短**：老师只看卷面结果 ✓ —— 改完只回一句「改了哪几处」（30 字内 ✓），不要复述原文、不要讲步骤、不要列工具 ✗。',
    '看不到的图号 / 页码不要猜 ✓。',
  ].join('\n')
}

/** 用户这条消息的内容：带图就是多模态数组 ✓（不带图就是纯字符串 ✓） */
/** 用户这条消息的内容：带图就是多模态数组 ✓（不带图就是纯字符串 ✓）；文档拼进 text ✓ */
export function chatUserContent(text: string, imgs: string[], docs?: PaperDoc[]): unknown {
  const t = String(text || '')
  const list = (imgs || []).filter(Boolean).slice(0, PAPER_CHAT_MAX_IMG)
  const docBlock = paperDocBlock(docs)
  const full = docBlock ? (t ? t + String.fromCharCode(10, 10) + docBlock : docBlock) : t
  if (!list.length) return full
  return [{ type: 'text', text: full }, ...list.map((u) => ({ type: 'image_url', image_url: { url: u } }))]
}

/** 能不能发（不忙、有内容或有图 ✓）；不能发就说清为什么 ✓ */
export function canSendPaperChat(text: string, busy: boolean, imgCount = 0): { ok: boolean; why: string } {
  if (busy) return { ok: false, why: '上一条还在处理…' }
  if (!String(text || '').trim() && !imgCount) return { ok: false, why: '先说一句要改什么（也可以只丢一张图 ✓）' }
  return { ok: true, why: '' }
}

/** 附件能不能收（数量与体积两道闸 ✓） */
export function canAttachPaperChat(nowCount: number, bytes: number): { ok: boolean; why: string } {
  if (nowCount >= PAPER_CHAT_MAX_IMG) return { ok: false, why: '最多带 ' + PAPER_CHAT_MAX_IMG + ' 张图' }
  if (bytes > PAPER_CHAT_MAX_BYTES) return { ok: false, why: '这张图超过 4MB，先压一下再发' }
  return { ok: true, why: '' }
}

/** 聊天列表上的句子摘要 ✓ */
export function chatTitleOf(text: string, n = 24): string {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  if (!s) return '（图片）'
  return s.length > n ? s.slice(0, n) + '…' : s
}

/** 试卷那三个动作的口径（真实现在 AiPaperChat.vue ✓；这里只给类型，方便对照 ✓） */
export type PaperCtx = NonNullable<AiToolCtx['paper']>

/* ---------------- 【v1693】试卷语法手册（给模型**按需查** ✓，不是塞进 system ✗） ---------------- */

/**
 * 试卷编辑认的全部语法与设置项 —— 做成一个工具（get_paper_help）让模型自己查 ✓
 * 为什么不塞进 system：太长会每轮都烧 token ✗；模型只在真需要细节时才查 ✓。
 * ⚠ 这份手册必须与 PaperModal 的解析保持一致 ✓（改语法时两处一起改 ✗ 否则 AI 会写出排不出来的东西 ✗）
 */
export const PAPER_HELP = [
  '【标题与结构】',
  '# 大标题（居中）  ## 一、选择题（方块大题标题）  ### 小标题',
  '【题目】',
  '1. 题干…（题号，试卷按 autoNum 自动重排）  (1) 小问…',
  '整块（题干/选项/解析不被分页拆开、解析默认收起、打印自动展开）：',
  '[题]',
  '1. 已知…（公式写 $x^2$ 或 $$…$$）',
  '[选项]',
  'A. …　B. …　C. …　D. …',
  '[解析]',
  '【答案】…',
  '…解析文字…',
  '[/题]',
  '【图片】',
  'Markdown：![图注](地址)　![图:center](地址)　![图2:floatleft:50%](地址)',
  '[图N] 传统写法：　[图1]　[图2:center]　[图3:60%]（宽度%）　[图4:45]（旋转角）　[图5:图注文字]',
  '对齐/浮动：center、left、right、float（右浮）、floatleft（左浮）；不要凭空编图号 ✗',
  '【空白与分页】[分页]　[换页]　[4cm]　[10mm]',
  '【段落样式】{c:red; s:16; f:楷体; b; i} 这段内容　（颜色支持 red、#ff0000、rgb()）',
  '⚠ ' + STYLE_CLOSER_RULE,
  '【多选/填空】多选题节里的题会自动加「多选」标签；填空节里 =____ 会自动变答题横线',
  '【选项排布（一行/两行/四行）】⚠ 两种写法别搞混 ✗：',
  '  · **某一道题**：在**那一题题干行的末尾**加 [一行] / [两行] / [四行]（也认 [1行]/[2行]/[4行]）—— 例：1. 已知…（　）[两行] ✓；',
  '  · **整卷统一**：用 set_paper_style 的 optLayout（auto 自动 / one 一行一个 / two 一行两个 / four 一行四个）✓；',
  '  老师说「这道题排两行」就改那一题 ✓；说「整卷都两行」才动 optLayout ✓。标记必须紧挨题干末尾（同一行 ✓），另起一行不生效 ✗',
  '【页眉页脚】是**设置项**（不进正文 ✓）：页眉/页脚文字支持 [图N] 与 {page} {total} 变量',
  '【可改的设置项（set_paper_style 的键）】template 模板、fontFamily 字体、fontSize 字号(pt)、fontColor 字色、',
  'lineHeight 行高、para 段距、indent 首行缩进、h2size 一级小标题字号、numStyle 题号(arabic 阿拉伯数字 / cn 中文)、',
  'optLayout 选项排布(auto 自动 / one 一行一个 / two 一行两个 / four 一行四个)、autoNum 自动编号(true/false)、',
  'bodyCols 正文分栏(1~3)、headerText 页眉、footerText 页脚、pdfName 导出文件名、gapQ 题间距、headerGap 页眉距、footerGap 页脚距',
  '【其它】套模板 apply_paper_template：handout 讲义 / exam 试卷 / exam19 十九题卷 / blank 空白；',
  '打印或导出 PDF 用 print_paper（矢量输出 ✓ 浏览器打印对话框里选「另存为 PDF」）',
].join(String.fromCharCode(10))
/* ---------------- 【v1694】就地改正文（用户实报：说「把解答题改成蓝色」→ AI 把解答题**抄了一遍**改蓝 ✗） ---------------- */

/**
 * 在正文里做一次**字面替换**（不做正则 ✗ —— 老师卷子里的 $、[、] 都是普通字符 ✓）。
 * 为什么要这个纯函数：模型只被给了 append（追加），没有"改现有的"能力 ✗，
 *   于是「把解答题改成蓝色」被它实现成"复制一份并染蓝" ✗（用户实报 ✓）。这里把口径与边界测清楚 ✓。
 *
 * @returns { text: 新正文（没命中就是原样 ✓）, hits: 命中几处 }
 */
export function paperEdit(text: string, find: string, replace: string, all = false): { text: string; hits: number } {
  const src = String(text || '')
  const f = String(find == null ? '' : find)
  if (!f) return { text: src, hits: 0 }
  const r = String(replace == null ? '' : replace)
  let hits = 0
  let out = ''
  let i = 0
  for (;;) {
    const at = src.indexOf(f, i)
    if (at < 0) { out += src.slice(i); break }
    hits++
    out += src.slice(i, at) + r
    i = at + f.length
    if (!all) { out += src.slice(i); break }
  }
  return { text: out, hits }
}

/** 改完给模型/老师的一句话回执（没命中要说清"没找到"，别装作改好了 ✗） */
export function paperEditNote(find: string, hits: number, all: boolean): string {
  if (!hits) {
    const brief = String(find || '').replace(/\s+/g, ' ').trim().slice(0, 30)
    return '没找到这段原文' + (brief ? '（' + brief + '…）' : '') + '：先用 get_paper_state 看准确写法 ✓ 别自己猜 ✗，一个字都没改'
  }
  return '已改 ' + hits + ' 处' + (all ? '（全部出现的地方 ✓）' : '（只改了第一处；要全改就把 all 设为 true ✓）')
}

/**
 * 一句话教模型：老师的"改成 X"是**改现有的**，不是复制一份 ✗
 * （写进 system ✓ —— 这类误会光靠工具说明拦不住 ✓）
 */
export const PAPER_EDIT_RULE = [
  '【改 vs 加 —— 别搞混 ✗】老师说「把…改成…」「…变成蓝色」「删掉…」「题号重排」时，是**改已有的内容**：',
  '先 get_paper_state 读到准确原文 → 用 edit_paper_text 做替换（原文可多行 ✓）→ 再报一句改了几处 ✓。',
  '**不要**用 append_to_paper 复制一份改造过的内容 ✗（那会把卷子变成两份，用户实测报过这个错 ✗）。',
  'append_to_paper 只用于**新增**（加一节、加一道题 ✓）。',
  '要给现有段落上样式（颜色、加粗、字号），就在那段文字**行首**加 {c:blue} / {b} / {s:14} ✓（见 get_paper_help ✓）。',
  STYLE_CLOSER_RULE,
].join(String.fromCharCode(10))
/* ---------------- 【v1698】附件文档（用户要求：试卷侧栏加「+文档」「截图」✓） ---------------- */

/** 老师拖进来的参考文档（.pdf / .pptx / .txt / .md … 已抽成纯文本 ✓） */
export interface PaperDoc { name: string; chars: number; text: string }

/** 文档里的**可读字数**（只有空白 = 空文档，不收 ✓ 与图片那边的口径一致 ✓） */
export function docCharsOf(text: string): number {
  return String(text || '').replace(/\s+/g, '').length
}

/**
 * 把文档拼成一段**参考材料**（每份截断到 maxChars ✓ —— 整本书塞进去会把上下文烧光 ✗）
 * ⚠ 必须说清"这是附件、不是试卷正文" ✗ —— 否则模型会把文档内容当卷面去改 ✗（用户最怕这个 ✓）
 */
export function paperDocBlock(docs: PaperDoc[] | undefined, maxChars = 20000): string {
  const list = (docs || []).filter((d) => d && String(d.text || '').trim())
  if (!list.length) return ''
  const NL = String.fromCharCode(10)
  const parts = list.map((d) => {
    const body = String(d.text || '').trim()
    const cut = body.length > maxChars ? body.slice(0, maxChars) + '…（已截断）' : body
    return '【附件文档：' + String(d.name || '未命名') + '】' + NL + cut
  })
  return '（下面是老师给你的**参考文档**，不是试卷正文 —— 要不要落到试卷由老师的话决定 ✓）' + NL + parts.join(NL + NL)
}
/* ---------------- 【v1699】试卷大纲：让 AI「按题号办事」（用户：它现在只看到一大段文字 ✗） ---------------- */

export interface PaperOutlineItem {
  /** 题号（卷面上写的那个 ✓） */
  no: number
  /** 题干开头（去标记 ✓，给模型认题用） */
  head: string
  /** 起止行号（0 基，含两端 ✓）—— 替换 / 插入就靠它 ✓ */
  startLine: number
  endLine: number
  /** 属于哪个大节（## 一、选择题 …；没有就空串 ✓） */
  section: string
  /** 【v1700】这题当前的**选项排布标记**：'' | '一行' | '两行' | '四行'（老师问「这题几行」要能答 ✓） */
  opt: string
}
export interface PaperOutline {
  sections: { title: string; line: number }[]
  items: PaperOutlineItem[]
  total: number
}

/** 题号行：1. / 2、/ 3． 开头 ✓（与 PaperModal 认的一致 ✓） */
const Q_LINE = /^\s*(\d{1,3})\s*[.、．]\s*(.*)$/
/** 大题（方块标题）✓ */
const SEC_LINE = /^\s*##\s+(.*)$/

/**
 * 把试卷源码拆成「大节 + 题号 + 行号」✓
 * 为什么需要：AI 现在拿到的是**一大段文字** ✗ —— 说「第 5 题」它得自己数，数错就改错地方 ✗（用户感受就是"笨"✓）。
 * 纪律：**只认卷面写法**（[题] 块与 1. 题号 ✓），认不出就不算题 ✗（绝不瞎猜 ✓）。
 */
export function paperOutline(text: string): PaperOutline {
  const NL = String.fromCharCode(10)
  const lines = String(text == null ? '' : text).split(NL)
  const sections: { title: string; line: number }[] = []
  let curSec = ''
  lines.forEach((l, i) => {
    const s = SEC_LINE.exec(String(l))
    if (s) { curSec = String(s[1]).trim(); sections.push({ title: curSec, line: i }) }
  })
  const starts: { line: number; no: number }[] = []
  let inBlock = false
  let blockStart = -1
  lines.forEach((l, i) => {
    const t = String(l)
    if (/^\s*\[题\]/.test(t)) { inBlock = true; blockStart = i; return }
    if (/^\s*\[\/题\]/.test(t)) { inBlock = false; return }
    const m = Q_LINE.exec(t)
    if (!m) return
    // 块内的**第一个**题号行算这题的号 ✓；块里后续的 1. 2. 小问不算新题 ✓
    if (inBlock && blockStart >= 0 && starts.length && starts[starts.length - 1].line === blockStart) return
    starts.push({ line: inBlock && blockStart >= 0 ? blockStart : i, no: Number(m[1]) || 0 })
  })
  const items: PaperOutlineItem[] = []
  starts.forEach((st, k) => {
    const end = k + 1 < starts.length ? starts[k + 1].line - 1 : lines.length - 1
    let stop = end
    for (let j = st.line + 1; j <= end; j++) {
      if (SEC_LINE.test(String(lines[j]))) { stop = j - 1; break }
    }
    const sec = sections.filter((x) => x.line <= st.line).pop()
    const qLine = String(lines[st.line] || '')
    const from = /^\s*\[题\]/.test(qLine) ? st.line + 1 : st.line
    const stemLine = String(lines[from] || '')
    // 【v1700】顺带报出这题当前的**选项排布标记**（[两行] 之类 ✓）—— 老师问「这题几行」时要能答 ✓
    const optMk = stemLine.match(/\[([0-9一二两四]+)\s*行\]\s*$/)
    const opt = optMk
      ? ((optMk[1] === '1' || optMk[1] === '一') ? '一行' : (optMk[1] === '2' || optMk[1] === '两' || optMk[1] === '二') ? '两行' : '四行')
      : ''
    // 题干里把排布标记去掉 ✓（排布已单列成 opt ✓ 别重复带 → 省 token 也更清楚 ✓）
    const head = stemLine.replace(Q_LINE, '$2').replace(/\[([0-9一二两四]+)\s*行\]\s*$/, '').replace(/\s+/g, ' ').trim().slice(0, 30)
    items.push({ no: st.no, head, startLine: st.line, endLine: Math.max(st.line, stop), section: sec ? sec.title : '', opt })
  })
  return { sections, items, total: items.length }
}

/** 大纲 → 给模型看的一小段文字（**省 token** ✓ 别把整篇原文再塞一遍 ✗） */
export function outlineText(o: PaperOutline, maxItems = 60): string {
  const NL = String.fromCharCode(10)
  if (!o.items.length) return '（这份试卷里还没认出题目：题号写成 1. 题干… 或整块 [题]…[/题] ✓）'
  let sec = ''
  const out: string[] = []
  for (const it of o.items.slice(0, maxItems)) {
    if (it.section !== sec) { sec = it.section; if (sec) out.push('## ' + sec) }
    out.push('  第 ' + it.no + ' 题（第 ' + (it.startLine + 1) + '-' + (it.endLine + 1) + ' 行' + (it.opt ? '，选项' + it.opt : '') + '）：' + it.head)
  }
  if (o.items.length > maxItems) out.push('  …（还有 ' + (o.items.length - maxItems) + ' 道 ✓）')
  return out.join(NL)
}

/** 找题号在 items 里的下标（找不到 -1 ✓） */
export function findQuestion(o: PaperOutline, no: number): number {
  const n = Number(no)
  for (let i = 0; i < o.items.length; i++) if (o.items[i].no === n) return i
  return -1
}

/** 按题号把一道题整块换掉 ✓（找不到就原样返回并说清现有题号 ✓，绝不改错地方 ✗） */
export function replacePaperQuestion(text: string, no: number, newText: string): { text: string; ok: boolean; note: string } {
  const NL = String.fromCharCode(10)
  const src = String(text == null ? '' : text)
  const o = paperOutline(src)
  const i = findQuestion(o, no)
  if (i < 0) {
    const have = o.items.map((x) => x.no).join('、') || '（一道都没认出来）'
    return { text: src, ok: false, note: '试卷里没有第 ' + no + ' 题（现有题号：' + have + '）—— 先用 get_paper_outline 看一遍 ✓ 一个字都没改' }
  }
  const it = o.items[i]
  const lines = src.split(NL)
  const body = String(newText == null ? '' : newText).replace(/\s+$/, '').split(NL)
  lines.splice(it.startLine, it.endLine - it.startLine + 1, ...body)
  return { text: lines.join(NL), ok: true, note: '已换掉第 ' + no + ' 题（原第 ' + (it.startLine + 1) + '-' + (it.endLine + 1) + ' 行）✓' }
}

/** 按题号在它后面插一道 ✓（新题写成完整块 ✓；题号由试卷自动重排 ✓） */
export function insertPaperQuestion(text: string, afterNo: number, newText: string): { text: string; ok: boolean; note: string } {
  const NL = String.fromCharCode(10)
  const src = String(text == null ? '' : text)
  const o = paperOutline(src)
  const i = findQuestion(o, afterNo)
  if (i < 0) {
    const have = o.items.map((x) => x.no).join('、') || '（一道都没认出来）'
    return { text: src, ok: false, note: '试卷里没有第 ' + afterNo + ' 题（现有题号：' + have + '）—— 先看一遍大纲 ✓ 一个字都没改' }
  }
  const it = o.items[i]
  const lines = src.split(NL)
  const body = String(newText == null ? '' : newText).replace(/\s+$/, '').split(NL)
  lines.splice(it.endLine + 1, 0, ...body)
  return { text: lines.join(NL), ok: true, note: '已在第 ' + afterNo + ' 题之后插入 ✓（题号由试卷自动重排 ✓）' }
}
/* ---------------------------------------------------------------------------
 * 【v1704】「录入试题」：把**当前图片**里的题目录进试卷（用户要求 ✓）
 *   写死在模块里而不是散在界面中 —— 探针能直接断言「该说清的都说了」✓
 *   ⚠ 每一条都对应一次真实的翻车 ✓
 * -------------------------------------------------------------------------*/
export const PAPER_OCR_PROMPT = [
  '把附件图里的题目录进这份试卷：题干、选项、答案、解析都要（图里没有的**别编** ✗，宁可缺着 ✓）。',
  '公式写成行内 $...$（试卷认这种写法 ✓）；上下标、分数线要写对 ✓。',
  '选择题四个选项**每个占一行**，写成 A．…（全角点 ✓），不要挤成一行 ✗。',
  '图里的**图形不要重画** ✗ —— 我会用「切图 → 试卷」把原图自己插进去 ✓，你只录文字 ✓。',
  '看不清的字符（下标、符号）用「?」标出来 ✗ 别猜 ✓。',
  '**直接用工具写进试卷**：追加到末尾用 append_to_paper ✓、按题号插用 insert_paper_question ✓；',
  '写之前先调 get_paper_outline 看一眼现有题号 ✓，别在对话里贴一遍就完事 ✗。',
].join(String.fromCharCode(10))
