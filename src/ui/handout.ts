/**
 * 【v1707】讲义接收口（与 ui/paper.ts 同一套 sink 规矩 ✓）—— 讲义 AI 助手用
 *
 * 为什么集中成一个对象：AI 侧要能一眼看出「讲义总共有哪些能力」✓；
 *   零散加口子会越加越乱 ✗（试卷那边 v1693 已经验证过这个做法 ✓）。
 * 用法：HandoutModal 打开时 handoutOpsSink.value = {…}，关掉时清成 null ✓
 *   （AI 工具据此判断「讲义开着没有」→ 没开就说清 ✗ 而不是静默失败 ✓）
 */
import { ref } from 'vue'

/** 一个块的规格（AI 给的类型 + 正文 ✓；校验在 aiHandoutChat.handoutBlockSpecs 里做 ✓） */
export interface HandoutBlockSpec {
  /** h1/h2/para/formula/figure/pagebreak/goal/knowledge/example/variant/exercise/summary/note/warn/answer/solution/blank ✓ */
  type: string
  text?: string
  /** 学生版 / 教师版各自怎么显示（inline/hide/blank/endnote ✓ 不传就用该类型默认 ✓） */
  render?: { student?: string; teacher?: string }
  /** type = blank 时的留白高度（cm ✓ 1–20） */
  blankCm?: number
}

/** 【v1707】讲义编辑器的**全部能力**（用户口径：AI 要精通讲义的各种操作和功能 ✓） */
export interface HandoutOps {
  /** 读当前讲义：当前版本正文（截断）+ 教材定位 + 标题 + 块数 / 版本 ✓ */
  state: (maxChars: number) => Record<string, unknown>
  /** 目录（章 → 节）+ 每块的序号 / 类型 / 摘要（按块号办事的前提 ✓） */
  outline: () => string
  /** 加块：where = end 末尾 | after 第 afterNo 块之后 | cursor 当前选中块之后 ✓ */
  addBlocks: (specs: HandoutBlockSpec[], where: string, afterNo: number) => string
  /** 就地改正文（字面替换 ✓ 与试卷 edit_paper_text 同一套口径 ✓） */
  edit: (find: string, replace: string, all: boolean) => string
  /** 块的删 / 移 / 选：action = remove | up | down | select ✓ */
  block: (no: number, action: string) => string
  /** 块在某一版的显示口径：render = inline | hide | blank | endnote；version = student | teacher ✓ */
  setRender: (no: number, render: string, version: string) => string
  /** 教材定位 + 标题（读了才知道现在定位在哪 ✓） */
  meta: () => Record<string, unknown>
  /** 改教材定位 / 标题（只改传进来的键 ✓ 认不出的键由 AI 侧先挡掉 ✓） */
  setMeta: (patch: Record<string, unknown>) => string
  /** 切学生版 / 教师版 ✓ */
  version: (v: string) => string
  /** 从题库插一道（q 是 AI 侧 search_bank 查到的题目对象 ✓）：kind = example | exercise | variant ✓ */
  insertQuestion: (q: unknown, kind: string, withAnswer: boolean) => string
  /** 按条件抽 N 道插成池（filter: section / kp / level ✓；pool = example | exercise | variant ✓） */
  draw: (filter: Record<string, unknown>, n: number, pool: string) => Promise<string>
  /** 数学图形：kind + params → 栅格化 → 插成插图块（继承当前块的注释 ✓） */
  figure: (kind: string, params: Record<string, unknown>, caption: string) => Promise<string>
  /** 引用了题库的块按库里最新内容刷新 ✓ */
  syncRefs: () => Promise<string>
  /** 打印 / 另存 PDF（浏览器打印，矢量文字 ✓） */
  print: () => string
  /** 导出纯文本（当前版本 ✓） */
  exportText: () => string
  /** 保存进库目录（exe 同级的 LJ-讲义 ✓） */
  save: () => Promise<string>
  /** 【v1710】把一段 Markdown 导成讲义块（与工具栏「导入 MD」**同一个解析器** ✓） */
  importMarkdown: (markdown: string, where: string, afterNo: number) => string
}

/** HandoutModal 打开时登记；关掉时清掉 ✓ */
export const handoutOpsSink = ref<null | HandoutOps>(null)
