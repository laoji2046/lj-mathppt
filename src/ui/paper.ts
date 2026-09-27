/**
 * 试卷接收口（照 ui/geom3d.ts 的 sink 规矩）—— 试题库「加入试卷」（M3）用 ✓
 *
 * 为什么不用事件逐层往上抛：试题库面板挂在 TopToolbar 里，而**试卷本体挂在 App.vue**，
 * 中间隔着组件层级；接收口 + 待办是这套代码里已有的做法（geom3dSink / vectorizeSink）✓
 *
 * 用法：题库调 sendToPaper(payload)
 *  - 试卷开着 → 直接交给它（paperInsertSink）
 *  - 试卷没开 → 挂成 paperPending，App 看到就把试卷打开，PaperModal 挂载时自己消费掉 ✓
 */
import { ref } from 'vue'

/** 题图：n = 题目内的 [图N] 编号（插进试卷时会按试卷的图号重编 ✓） */
export interface PaperInsertImage { n: number; src: string; caption?: string }

export interface PaperInsertPayload {
  /** 要插入的正文（题干 + 选项 [+ 答案/解析]） */
  text: string
  /** 单题 = 题目 id；整套/组卷 = 0（用来决定要不要先 [分页]） */
  id?: number
  label?: string
  imgs?: PaperInsertImage[]
}

/** PaperModal 打开时登记的接收口 */
export const paperInsertSink = ref<null | ((p: PaperInsertPayload) => void)>(null)
/** 没人接收时的待办：App 看到就打开试卷 ✓ */
export const paperPending = ref<PaperInsertPayload | null>(null)

/** 试题库调这个：有人接就交出去，没人接就等 App 打开试卷 ✓ */
export function sendToPaper(p: PaperInsertPayload) {
  const sink = paperInsertSink.value
  if (sink) { sink(p); return }
  paperPending.value = p
}

/** 【v1691】AI 助手要用：PaperModal 打开时登记「读试卷正文」与「追加一段」 ✓
 *  （试卷没开时这两个是 null → AI 助手的工具会说清"先把试卷编辑打开" ✓） */
export const paperTextSink = ref<null | (() => string)>(null)
export const paperAppendSink = ref<null | ((text: string, pageBreak?: boolean) => void)>(null)

/* ---------------- 【v1693】把试卷编辑的**全部能力**曝光给 AI 工具 ----------------
 * 用户问「如何让 AI 能用试卷编辑中的所有功能」✓ —— 答案不是把提示词写长 ✗，而是两条：
 *   ① **能力做成工具**（读设置 / 改设置 / 套模板 / 页眉页脚 / 插数学图形 / 打印 ✓ 下面这块）；
 *   ② **语法做成手册**（纯文本能力如 [题] 块、{c:red} 段落样式、[分页]，让模型按需查 ✓ 见 aiPaperChat.PAPER_HELP）。
 * 这里集中成一个对象：零散加口子会越加越乱 ✗，而且 AI 侧要能一眼看出"总共有哪些能力" ✓。
 */
export interface PaperOps {
  /** 【v1694】就地改正文：字面替换（find 可多行 ✓，all=false 只改第一处 ✓）—— 返回一句人话回执 ✓
   *  为什么必须补：只有 append 时，「把解答题改成蓝色」被模型实现成"复制一份并染蓝" ✗（用户实报 ✓） */
  edit: (find: string, replace: string, all?: boolean) => string  /** 读正文 ✓ */
  text: () => string
  /** 追加正文（pageBreak = 先 [分页] ✓） */
  append: (text: string, pageBreak: boolean) => void
  /** 当前样式 / 页面设置快照（字体 字号 颜色 行高 段距 缩进 题号 选项排布 分栏 页眉页脚 文件名 … ✓） */
  style: () => Record<string, unknown>
  /** 改设置（只改传进来的键 ✓，认不出的键忽略并说明 ✓，越界值会夹取 ✓） */
  setStyle: (patch: Record<string, unknown>) => string
  /** 套模板：handout（讲义）| exam（试卷）| exam19（19 题卷）| blank（空白）✓ */
  template: (key: string) => string
  /** 页眉页脚预设（id 见 PaperModal 的 HEADER_PRESETS ✓） */
  headerPreset: (id: string) => string
  /** 数学图形：kind + params → 栅格化后进图片库，返回 [图N] ✓ */
  figure: (kind: string, params: Record<string, unknown>) => Promise<string>
  /** 打印 / 另存 PDF（走浏览器打印，矢量 ✓） */
  print: () => string
}
/** PaperModal 打开时登记；关掉时清掉 ✓（AI 工具据此判断"试卷开着没有" ✓） */
export const paperOpsSink = ref<null | PaperOps>(null)
