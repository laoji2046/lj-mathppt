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
