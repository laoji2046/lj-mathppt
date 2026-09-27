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
    '看不到的图号 / 页码不要猜 ✓；改完用一句中文说明你做了什么，别把工具返回的 JSON 倒给老师 ✗。',
  ].join('\n')
}

/** 用户这条消息的内容：带图就是多模态数组 ✓（不带图就是纯字符串 ✓） */
export function chatUserContent(text: string, imgs: string[]): unknown {
  const t = String(text || '')
  const list = (imgs || []).filter(Boolean).slice(0, PAPER_CHAT_MAX_IMG)
  if (!list.length) return t
  return [{ type: 'text', text: t }, ...list.map((u) => ({ type: 'image_url', image_url: { url: u } }))]
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
  '【多选/填空】多选题节里的题会自动加「多选」标签；填空节里 =____ 会自动变答题横线',
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
  '要给现有段落上样式（颜色/加粗/字号），就在那段文字**行首**加 {c:blue} / {b} / {s:14} ✓（见 get_paper_help ✓）。',
].join(String.fromCharCode(10))