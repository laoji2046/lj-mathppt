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
export const PAPER_TOOL_NAMES = ['get_paper_state', 'append_to_paper', 'insert_bank_question_to_paper', 'search_bank']

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
