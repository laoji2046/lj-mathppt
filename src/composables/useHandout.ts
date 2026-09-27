/**
 * 【M1】数学讲义 · 数据模型与本地存储
 *
 * 与「试卷」的区别（这是讲义的核心）：
 *   试卷 = 只有题（考 ✓）
 *   讲义 = 知识梳理 + 例题精讲 + 变式 + 练习 + 答案/解析（讲 ✓），
 *          而且**同一份内容要出两个版本**：学生版（答案隐藏/留白/倒排到末尾）与教师版（答案内联 + 批注）✓
 *
 * 所以每个块都带 render.student / render.teacher ✓ —— 这是整份设计的支点 ✓
 * 详细调研见 docs/数学讲义-研究.md ✓
 */
import { ref, computed } from 'vue'
import { hdDocFromText, hdDocText, hdFileName, hdFolderDelete, hdFolderDir, hdFolderList, hdFolderRead, hdFolderWrite } from './useHandoutFolder'

export type HdVersion = 'student' | 'teacher'
/** 一个块在某个版本里怎么呈现 */
export type HdRender = 'inline' | 'hide' | 'blank' | 'endnote'

export type HdBlockType =
  | 'h1' | 'h2'              // 章 / 节
  | 'para' | 'formula' | 'figure' | 'pagebreak'
  | 'goal'                   // 学习目标
  | 'knowledge'              // 知识梳理（可做填空版 ✓）
  | 'example' | 'variant'    // 例题 / 变式
  | 'exercise'               // 当堂练习
  | 'summary'                // 归纳小结
  | 'note' | 'warn'          // 提示 / 易错警示
  | 'answer' | 'solution'    // 答案 / 解析（讲义与试卷最大的不同 ✓）
  | 'blank'                  // 学生留白（做笔记 / 写解答 ✓）
  | 'preview'                // 【v1712】课前预习（学案第一栏 ✓）
  | 'explore'                // 【v1712】探究思考（教材「观察 / 思考 / 探究 / 归纳」✓）
  | 'method'                 // 【v1712】方法总结（例题 / 变式后的解法提炼 ✓）
  | 'homework'               // 【v1712】课后作业（分层：A 基础 / B 提升 / C 拓展 ✓）
  | 'reflect'                // 【v1712】学后反思（我的疑问 / 学习反思 ✓）

export interface HdBlock {
  id: string
  type: HdBlockType
  /** 正文（支持 $…$ 公式 ✓ 与 [图N] ？M1 先只支持公式 ✓） */
  text: string
  /** 留白高度（cm），type === 'blank' 时生效 ✓ */
  blankCm?: number
  /** 编号：例题/变式/练习 默认自动编号 ✓ */
  number?: boolean
  /** 两个版本各自的呈现方式 ✓ */
  render: { student: HdRender; teacher: HdRender }
  /** 【M2】引用的题库题 id（0/无 = 手写的 ✓）—— 块列表里显示「题 #123」✓ */
  ref?: number
  /** 【M2】知识底座条目的标题（插进来时带的 ✓） */
  kbTitle?: string
  /** 【M2.5】插图（type = 'figure' 时用 ✓）—— 大图走内容库 assetId ✓（与题库同一套，省 localStorage ✓） */
  img?: {
    src?: string
    assetId?: number
    caption?: string
    /** 【M2.7】位置：居中 / 居左 / 居右 / 左浮动 / 右浮动 ✓（对齐「试卷编辑」那套写法 ✓） */
    layout?: 'center' | 'left' | 'right' | 'float-left' | 'float-right'
    /** 【M2.7】宽度（% ✓ 10–100）—— 浮动时建议 35–50 ✓ */
    width?: number
  }
}

export interface HandoutMeta {
  school: string
  subject: string
  title: string
  subtitle: string
  grade: string
  teacher: string
  date: string
  /* 【M1.1】教材定位：方便组织内容、便于查找 ✓ */
  /** 教材版本（默认人教版 ✓） */
  press: string
  /** 模块 / 册：必修一 … 选择性必修三 ✓ */
  book: string
  /** 第几章（填数字或整句都行 ✓） */
  chapter: string
  /** 第几节 ✓ */
  section: string
  /** 【v1476】第几课时（第 1 课时 / 第 2 课时 … ✓） */
  period: string
  /** 【v1476】标题是否按教材自动生成（默认 true ✓；手改过标题就自动关掉 ✓） */
  autoTitle?: boolean
}

export interface Handout {
  meta: HandoutMeta
  blocks: HdBlock[]
}

const KEY = 'lj-mathslides-vue:handout'

let seq = 0
export function hdId(): string { return 'h' + Date.now().toString(36) + (seq++).toString(36) }

/** 每种块的默认版本渲染：答案/解析默认「学生版倒排到末尾、教师版内联」✓ */
export const HD_DEFAULT_RENDER: Record<HdBlockType, { student: HdRender; teacher: HdRender }> = {
  h1: { student: 'inline', teacher: 'inline' },
  h2: { student: 'inline', teacher: 'inline' },
  para: { student: 'inline', teacher: 'inline' },
  formula: { student: 'inline', teacher: 'inline' },
  figure: { student: 'inline', teacher: 'inline' },
  pagebreak: { student: 'inline', teacher: 'inline' },
  goal: { student: 'inline', teacher: 'inline' },
  knowledge: { student: 'inline', teacher: 'inline' },
  example: { student: 'inline', teacher: 'inline' },
  variant: { student: 'inline', teacher: 'inline' },
  exercise: { student: 'inline', teacher: 'inline' },
  summary: { student: 'inline', teacher: 'inline' },
  note: { student: 'inline', teacher: 'inline' },
  warn: { student: 'inline', teacher: 'inline' },
  answer: { student: 'endnote', teacher: 'inline' },
  solution: { student: 'endnote', teacher: 'inline' },
  blank: { student: 'inline', teacher: 'inline' },
  preview: { student: 'inline', teacher: 'inline' },
  explore: { student: 'inline', teacher: 'inline' },
  method: { student: 'inline', teacher: 'inline' },
  homework: { student: 'inline', teacher: 'inline' },
  reflect: { student: 'inline', teacher: 'inline' },
}

export const HD_LABEL: Record<HdBlockType, string> = {
  h1: '章标题', h2: '节标题', para: '正文', formula: '公式', figure: '图片', pagebreak: '分页',
  goal: '学习目标', knowledge: '知识梳理', example: '例题', variant: '变式', exercise: '当堂练习',
  summary: '归纳小结', note: '提示', warn: '易错警示', answer: '答案', solution: '解析', blank: '留白',
  preview: '课前预习', explore: '探究思考', method: '方法总结', homework: '课后作业', reflect: '学后反思',
}

/** 可以自动编号的块 ✓（例题 / 变式 / 练习 各自独立编号 ✓） */
export const HD_NUMBERED: HdBlockType[] = ['example', 'variant', 'exercise']
export const HD_NUM_PREFIX: Partial<Record<HdBlockType, string>> = { example: '例', variant: '变式', exercise: '练习' }
/* ---------------- 【v1712】课型骨架（一键起一份讲义的栏目结构 ✓） ----------------
 * 研究依据：_stage/research/高中数学讲义-体例研究.md（v1712 调研 · 461 行 ✓）+ docs/数学讲义-研究.md（M1 ✓）
 *   新授：目标 → 预习 → 知识梳理（留空）→ 典例精讲 → 变式训练 → 方法归纳 → 当堂检测 → 课堂小结 → 课后作业（分层）✓
 *   学案：目标 → 预习 → 自主学习 → 合作探究 → 当堂检测 → 核心归纳 → 学习反思 → 课时作业 ✓
 *   一轮：课标与考情 → 知识清单 → 考点突破 → 变式 → 方法 → 易错 → 当堂检测 → 课时作业 A/B/C ✓
 *   二轮：真题导入 → 高考链接 → 考点整合 → 方法提炼 → 母题精讲 → 同源变式 → 当堂训练 → 专题检测 ✓
 *   习题课 / 讲评课：各按一线检查记录里的栏目链（基础训练 / 提升性练习 / 补充练习 / 自我诊断 / 错因归类 ✓）
 * 每一节 = 一个 h1 栏目名 + 一个**空块**（栏目框在预览里直接看得见，往里填就行 ✓）
 */
export interface HdSkeletonSec {
  /** 栏目名（h1 ✓） */
  h: string
  /** 栏目下的第一个块 ✓ */
  t: HdBlockType
  /** 该栏目末尾留白几厘米（学生写的地方 ✓ 不填就不留 ✓） */
  blankCm?: number
  /** 小节（h2 + 块 ✓ —— 照研究报告里那些 ### 小节 ✓） */
  subs?: { h: string; t: HdBlockType; blankCm?: number }[]
}

export interface HdSkeleton {
  id: string
  label: string
  note: string
  secs: HdSkeletonSec[]
}

/**
 * 【v1717】六套课型骨架 —— **照研究报告重排** ✓
 * 研究报告：docs/数学讲义-体例研究-v1712.md（§7 模板 A~E + §8 落地清单 ✓）
 *   · A 新授课：目标 → 知识链接 → 知识梳理（情境/思考/结论留空）→ 典例精讲 → 变式 → 方法归纳 → 当堂检测 → 课堂小结 → 课后作业（分层）
 *   · B 一轮复习：课标与考情 → 知识清单（思维导图/结论留空）→ 考点突破 → 当堂检测 → 课时作业（A/B/C）
 *   · C 二轮专题：真题导入 → 高考链接 → 必备知识与方法提炼 → 母题精讲 → 同源变式 → 当堂训练 → 课后作业（专题检测）
 *   · D 习题课：方法目标 → 题组呈现（基础再现 / 方法辨析）→ 一题多变 → 方法归纳 → 巩固练习 → 小结与作业
 *   · E 试卷讲评：考情概览 → 我的得失（自诊）→ 错因归类 → 典型错题精讲 → 当堂订正与补偿 → 总结反思 → 布置作业
 *   · F 学案（导学案）：目标 → 预习 → 自主学习 → 合作探究 → 当堂检测 → 核心归纳 → 学习反思 → 课时作业
 * 每节 = h1 栏目名 + 一个空块（+ 该栏的小节 h2 + 块 ✓ + 需要的地方留白 ✓）
 */
export const HD_SKELETONS: HdSkeleton[] = [
  {
    id: 'new', label: '新授课',
    note: '同步新授：目标（3~4 条、可检测动词）→ 知识链接 → 知识梳理（情境/思考/结论，结论留空）→ 典例精讲 → 变式训练 → 方法归纳 → 当堂检测 → 课堂小结（留空）→ 课后作业（A/B/C 分层、标 ★、不标分值）',
    secs: [
      { h: '一、学习目标', t: 'goal' },
      { h: '二、知识链接（课前小测 / 复习回顾）', t: 'preview', blankCm: 3 },
      {
        h: '三、知识梳理（新知生成）', t: 'knowledge',
        subs: [
          { h: '3.1 情境与观察', t: 'explore' },
          { h: '3.2 思考与探究', t: 'explore', blankCm: 5 },
          { h: '3.3 结论梳理（学生版留空）', t: 'knowledge', blankCm: 6 },
        ],
      },
      { h: '四、典例精讲', t: 'example', subs: [{ h: '例 1', t: 'example', blankCm: 8 }, { h: '例 2', t: 'example', blankCm: 8 }] },
      { h: '五、变式训练', t: 'variant', blankCm: 6 },
      { h: '六、方法归纳', t: 'method', blankCm: 4 },
      { h: '七、当堂检测（限时 __ 分钟）', t: 'exercise' },
      { h: '八、课堂小结', t: 'summary', blankCm: 5 },
      { h: '九、课后作业（分层）', t: 'homework' },
    ],
  },
  {
    id: 'learn', label: '学案',
    note: '导学案：目标 → 课前预习 → 自主学习 → 合作探究 → 当堂检测 → 核心归纳 → 学习反思 → 课时作业（留白最多，学生自己走流程）',
    secs: [
      { h: '一、学习目标', t: 'goal' },
      { h: '二、课前预习', t: 'preview', blankCm: 4 },
      { h: '三、自主学习', t: 'knowledge', blankCm: 5 },
      { h: '四、合作探究', t: 'explore', blankCm: 6 },
      { h: '五、当堂检测', t: 'exercise' },
      { h: '六、核心归纳', t: 'summary', blankCm: 4 },
      { h: '七、学习反思', t: 'reflect', blankCm: 4 },
      { h: '八、课时作业', t: 'homework' },
    ],
  },
  {
    id: 'review', label: '一轮复习',
    note: '高三一轮（按教材顺序）：课标要求与考情分析 → 知识清单（思维导图 / 结论留空）→ 考点突破（典例 + 变式 + 方法技巧 + 易错提醒）→ 当堂检测（按 8 单选 3 多选 3 填空）→ 课时作业 A/B/C',
    secs: [
      { h: '一、课标要求与考情分析', t: 'goal' },
      {
        h: '二、知识梳理（知识清单 / 知识网络）', t: 'knowledge',
        subs: [
          { h: '2.1 思维导图（留空框架，学生补全）', t: 'knowledge', blankCm: 6 },
          { h: '2.2 核心概念与结论（留空）', t: 'knowledge', blankCm: 6 },
        ],
      },
      { h: '三、考点突破', t: 'example', subs: [{ h: '考点 1', t: 'example', blankCm: 8 }, { h: '考点 2', t: 'example', blankCm: 8 }] },
      { h: '四、当堂检测（限时 __ 分钟）', t: 'exercise' },
      { h: '五、课时作业（分层）', t: 'homework' },
    ],
  },
  {
    id: 'topic', label: '二轮专题',
    note: '二轮微专题（打破教材顺序）：真题导入 → 高考链接（命题分析）→ 必备知识与方法提炼（留空补全）→ 母题精讲（思路/解答/一题多解/易错点）→ 同源变式 → 当堂训练 → 课后作业（专题检测 + 压轴分步得分）',
    secs: [
      { h: '一、真题导入 / 考题再现', t: 'example' },
      { h: '二、高考链接（命题分析）', t: 'goal' },
      { h: '三、必备知识 / 方法提炼', t: 'method', blankCm: 5 },
      { h: '四、母题精讲', t: 'example', subs: [{ h: '母题 1', t: 'example', blankCm: 10 }] },
      { h: '五、同源变式（变式拓展）', t: 'variant', blankCm: 6 },
      { h: '六、当堂训练（限时 __ 分钟）', t: 'exercise' },
      { h: '七、课后作业（专题检测）', t: 'homework' },
    ],
  },
  {
    id: 'drill', label: '习题课',
    note: '习题课（一题多解 / 一题多变 / 多题一法）：方法目标 → 题组呈现（基础再现 / 方法辨析）→ 一题多变与一题多解 → 方法归纳（含失效条件）→ 巩固练习 → 小结与作业（分层）',
    secs: [
      { h: '一、学习目标（方法目标）', t: 'goal' },
      {
        h: '二、题组呈现', t: 'exercise',
        subs: [
          { h: '题组一 基础再现', t: 'exercise', blankCm: 6 },
          { h: '题组二 方法辨析', t: 'example', blankCm: 6 },
        ],
      },
      { h: '三、一题多变 / 一题多解', t: 'variant', blankCm: 8 },
      { h: '四、方法归纳', t: 'method', blankCm: 5 },
      { h: '五、巩固练习（限时 __ 分钟）', t: 'exercise' },
      { h: '六、小结与作业', t: 'summary', blankCm: 4 },
      { h: '七、课后作业（分层）', t: 'homework' },
    ],
  },
  {
    id: 'comment', label: '试卷讲评',
    note: '讲评课（数据说话）：考情概览 → 我的得失（学生自诊表）→ 错因归类（知识/方法/审题/规范）→ 典型错题精讲（错例 → 错因 → 正确解答 + 评分点 → 同源变式）→ 当堂订正与补偿训练 → 总结反思 → 布置作业（错题本 + 针对性训练）',
    secs: [
      { h: '一、考情概览（数据说话）', t: 'goal' },
      { h: '二、我的得失（学生自诊）', t: 'reflect', blankCm: 6 },
      { h: '三、错因归类', t: 'warn', blankCm: 5 },
      { h: '四、典型错题精讲', t: 'example', subs: [{ h: '第 __ 题（错误率 __%）', t: 'example', blankCm: 10 }] },
      { h: '五、当堂订正与补偿训练（限时 __ 分钟）', t: 'exercise', blankCm: 6 },
      { h: '六、总结反思与提升', t: 'reflect', blankCm: 5 },
      { h: '七、布置作业', t: 'homework' },
    ],
  },
]

/** 按 id / 中文名取课型骨架 ✓（认不出返回 null ✗） */
export function skeletonById(id: string): HdSkeleton | null {
  const s = String(id == null ? '' : id).trim()
  if (!s) return null
  for (const k of HD_SKELETONS) if (k.id === s || k.label === s) return k
  return null
}

/** 课型 → 一串块（每节 = h1 栏目名 + 空块；小节 = h2 + 空块；该留白的地方插 blank ✓） */
export function skeletonBlocks(id: string): HdBlock[] {
  const sk = skeletonById(id)
  if (!sk) return []
  const out: HdBlock[] = []
  const pushBlank = (cm?: number) => {
    if (!cm) return
    const b = makeBlock('blank', '')
    b.blankCm = cm
    out.push(b)
  }
  for (const sec of sk.secs) {
    out.push(makeBlock('h1', sec.h))
    out.push(makeBlock(sec.t, ''))
    pushBlank(sec.blankCm)
    for (const sub of sec.subs || []) {
      out.push(makeBlock('h2', sub.h))
      out.push(makeBlock(sub.t, ''))
      pushBlank(sub.blankCm)
    }
  }
  return out
}


/* ---------------- 【v1712】挖空（填空版 ✓） ----------------
 * 老师最常用的一招：知识梳理 / 必备知识做成**填空版** —— 学生版关键处是空线、教师版给原词 ✓
 * （一线检查记录里的原话：微专题「必备知识」要留白给学生自己归纳 ✓）
 * 写法：把要挖的地方用两个花括号包起来 —— 椭圆的定义：到两定点距离之{{和}}为常数 ✓
 *   · 学生版 → 下划线空（学生边听边填 ✓）
 *   · 教师版 → 原词 ✓（老师照着讲 ✓）
 */
export function hdFillOut(escaped: string, v: HdVersion): string {
  const re = /\{\{([^}]*)\}\}/g
  if (v === 'student') return escaped.replace(re, '<span class="hd-fill"></span>')
  return escaped.replace(re, '$1')
}

/** 导出纯文本时的挖空（学生版印成空线 ✓） */
export function hdFillText(s: unknown, v: HdVersion): string {
  return String(s == null ? '' : s).replace(/\{\{([^}]*)\}\}/g, (_m, k: string) => (v === 'student' ? '＿＿＿＿' : k))
}

/** 去掉挖空标记（列表摘要 / 目录这种地方显示用 ✓） */
export function hdPlain(s: unknown): string {
  return String(s == null ? '' : s).replace(/\{\{([^}]*)\}\}/g, '$1')
}

/* ---------------- 【v1713】正文里的 Markdown 残留：图片与表格 ----------------
 * 那批真实讲义（D:\vue-app\高中数学讲义 · 必修二 15 讲）里：
 *   · 图是 `![图注](data:image/png;base64,…)`（内嵌自包含 ✓）或 `![图注](images/图注.png)` ✓
 *   · 表格是标准竖线表（15 份里共 655 行 ✓）
 * 以前一律当纯文本印出来 ✗（80 张图看不见、表格成了「| … |」）→ 这一层把它们认出来 ✓
 *   ⚠ 输入必须是**已经 hdEsc 过的正文** ✓（这里只做结构替换，不再转义 ✓）
 */
const HD_IMG_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

/** 一行里残留的 `![图注](地址)` → `<figure><img>`（base64 / images/x.png / http 都原样塞 src ✓） */
export function hdInlineFigures(line: string): string {
  return String(line == null ? '' : line).replace(HD_IMG_RE, (_m, alt: string, url: string) => {
    const cap = String(alt || '').trim()
    return '<figure class="hd-fig hd-fig--inline"><img src="' + url + '" alt="' + cap + '" />'
      + (cap ? '<figcaption>' + cap + '</figcaption>' : '') + '</figure>'
  })
}

/** 竖线表行 → `<table>`（第二行必须是 `| --- |` 分隔行 ✓ 否则返回空串，调用方原样输出 ✓） */
export function hdTableHtml(rows: string[]): string {
  const cells = (r: string) => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
  const isSep = (cs: string[]) => cs.length > 0 && cs.every((c) => /^:?-{2,}:?$/.test(c))
  const list = (rows || []).map(cells)
  if (list.length < 2 || !isSep(list[1])) return ''
  const head = list[0].map((c) => '<th>' + c + '</th>').join('')
  const rest = list.slice(2).map((cs) => '<tr>' + cs.map((c) => '<td>' + c + '</td>').join('') + '</tr>').join('')
  return '<table class="hd-tbl"><thead><tr>' + head + '</tr></thead><tbody>' + rest + '</tbody></table>'
}

/** 正文（已转义）→ HTML：连续竖线表成表格、其余行里的图片变图 ✓ */
export function hdRichHtml(escaped: string): string {
  const NL = String.fromCharCode(10)
  const lines = String(escaped == null ? '' : escaped).split(NL)
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    if (lines[i].trim().charAt(0) === '|') {
      const rows: string[] = []
      while (i < lines.length && lines[i].trim().charAt(0) === '|') { rows.push(lines[i]); i++ }
      const tbl = hdTableHtml(rows)
      if (tbl) { out.push(tbl); continue }
      for (const r of rows) out.push(hdInlineFigures(r))
      continue
    }
    out.push(hdInlineFigures(lines[i]))
    i++
  }
  return out.join(NL)
}

export function makeBlock(type: HdBlockType, text = ''): HdBlock {
  const b: HdBlock = {
    id: hdId(), type, text,
    render: { ...HD_DEFAULT_RENDER[type] },
    number: HD_NUMBERED.includes(type),
  }
  if (type === 'blank') b.blankCm = 4
  return b
}

/** 首次打开时的**范例讲义**（结构照国内讲义骨架 ✓ 也当"长什么样"的说明书 ✓） */
export function sampleHandout(): Handout {
  const mk = (t: HdBlockType, s: string) => makeBlock(t, s)
  return {
    meta: {
      school: '示例中学', subject: '数学', title: '椭圆外点切线的轨迹',
      subtitle: '一轮复习 · 圆锥曲线专题（一）', grade: '高三', teacher: '', date: new Date().toISOString().slice(0, 10),
      press: '人教版', book: '选择性必修一', chapter: '3', section: '1', period: '1', autoTitle: false,
    },
    blocks: [
      mk('h1', '一、知识梳理'),
      mk('goal', '1. 会用切线长与半径垂直的关系处理切线问题；\n2. 会把「两条切线互相垂直」翻译成 $|OP|^{2}=a^{2}+b^{2}$。'),
      mk('knowledge', '椭圆 $\\dfrac{x^{2}}{a^{2}}+\\dfrac{y^{2}}{b^{2}}=1$ 外一点 $P$ 作两条切线，切点为 $A$、$B$：\n① $OA\\perp PA$，$OB\\perp PB$；\n② 两切线垂直 $\\iff \\angle APB=90^{\\circ}\\iff |OP|^{2}=a^{2}+b^{2}$。'),
      mk('warn', '易错：把「两切线垂直」直接当成「$P$ 在准线上」—— 两者没有关系，不要混。'),
      mk('h1', '二、例题精讲'),
      mk('example', '已知椭圆 $C:\\dfrac{x^{2}}{9}+\\dfrac{y^{2}}{4}=1$，$P$ 为 $C$ 外一点，过 $P$ 作 $C$ 的两条切线互相垂直，求点 $P$ 的轨迹。'),
      mk('solution', '设两切点为 $A$、$B$，连 $OA$、$OB$。由切线性质 $OA\\perp PA$、$OB\\perp PB$，\n又 $\\angle APB=90^{\\circ}$，故四边形 $OAPB$ 是矩形，$|OP|^{2}=|OA|^{2}+|AP|^{2}=a^{2}+b^{2}=13$。'),
      mk('answer', '轨迹是圆 $x^{2}+y^{2}=13$。'),
      mk('variant', '若把椭圆换成双曲线 $\\dfrac{x^{2}}{9}-\\dfrac{y^{2}}{4}=1$，两切线仍互相垂直，$P$ 的轨迹是什么？'),
      mk('h1', '三、当堂练习'),
      mk('exercise', '（1）椭圆 $\\dfrac{x^{2}}{25}+\\dfrac{y^{2}}{16}=1$ 的两条互相垂直的切线的交点轨迹是＿＿＿＿。'),
      mk('exercise', '（2）求证：上述轨迹与原椭圆同心。'),
      mk('blank', ''),
      mk('h1', '四、归纳小结'),
      mk('summary', '切线问题三步：连半径得直角 → 找矩形/直角三角形 → 用 $a^{2}+b^{2}$ 定型。'),
    ],
  }
}

/** 【v1716】一份**空白**讲义（不是那份示例讲义 ✗）—— 库里被清空时用 ✓
 *  ⚠ 以前这里用的是 sampleHandout() ✗：那是一份**完整的示例讲义**（标题「椭圆外点切线的轨迹」✓ 高三 /
 *    选择性必修一 / 第 3 章 / 第 1 节 ✓ 内容也是真的 ✓）—— 于是老师点了「清空讲义库」之后，
 *    列表里**还是**站着一份「椭圆外点切线的轨迹」✗，看着就像"清不掉"✓（用户实报 ✓）
 */
export function blankHandout(): Handout {
  return {
    meta: {
      school: '', subject: '数学', title: '未命名讲义', subtitle: '', grade: '', teacher: '',
      date: new Date().toISOString().slice(0, 10),
      press: '人教版', book: '必修一', chapter: '', section: '', period: '', autoTitle: true,
    },
    blocks: [],
  }
}

function normalize(h: unknown): Handout {
  const o = (h || {}) as Partial<Handout>
  const meta: HandoutMeta = {
    school: '', subject: '数学', title: '未命名讲义', subtitle: '', grade: '', teacher: '',
    date: new Date().toISOString().slice(0, 10),
    press: '人教版', book: '必修一', chapter: '', section: '', period: '',
    autoTitle: true,
    ...(o.meta || {}),
  }
  const blocks: HdBlock[] = Array.isArray(o.blocks)
    ? o.blocks.filter(Boolean).map((b) => {
        const t = (b.type || 'para') as HdBlockType
        return {
          id: b.id || hdId(),
          type: t,
          text: String(b.text || ''),
          blankCm: Number(b.blankCm) || undefined,
          number: b.number !== undefined ? !!b.number : HD_NUMBERED.includes(t),
          render: { ...HD_DEFAULT_RENDER[t], ...(b.render || {}) },
          ref: Number(b.ref) || undefined,
          kbTitle: b.kbTitle ? String(b.kbTitle) : undefined,
          img: b.img && (b.img.src || b.img.assetId) ? {
            src: b.img.src ? String(b.img.src) : undefined,
            assetId: Number(b.img.assetId) || undefined,
            caption: b.img.caption ? String(b.img.caption) : undefined,
            layout: (b.img.layout as HdBlock['img'] extends undefined ? never : 'center' | 'left' | 'right' | 'float-left' | 'float-right') || undefined,
            width: Number(b.img.width) || undefined,
          } : undefined,
        } as HdBlock
      })
    : []
  return { meta, blocks }
}

export function loadHandout(): Handout {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return sampleHandout()
    return normalize(JSON.parse(raw))
  } catch { return sampleHandout() }
}

export function saveHandout(h: Handout) {
  try { localStorage.setItem(KEY, JSON.stringify(h)) } catch { /* 存不上也不影响用 ✓ */ }
  // 【M2.5】顺手写回讲义库（多份讲义 ✓）—— 库还没初始化时是空操作 ✓
  try { saveHandoutLibrary() } catch { /* 忽略 */ }
}

/** 一份全局讲义（编辑器与导出共用 ✓） */
export const handout = ref<Handout>(loadHandout())
export function setHandout(h: Handout) { handout.value = normalize(h); saveHandout(handout.value) }

/** 当前预览/打印的版本 ✓（默认教师版：老师先看到全貌 ✓） */
export const hdVersion = ref<HdVersion>('teacher')

export interface HdRendered {
  b: HdBlock
  /** 自动编号文本（「例 1」）；没编号就是空串 ✓ */
  num: string
  /** 这一版真正用来显示的文本（blank 用占位 ✓ hide 不出现 ✓） */
  show: string
  /** 倒排到末尾的答案/解析 ✓ */
  endnote: boolean
}

/**
 * 按版本算出「这一版要显示什么」✓ —— 学生版与教师版**只差这一个函数** ✓
 *   inline → 正常显示 ✓
 *   hide   → 这一版不出现 ✓
 *   blank  → 显示成留白（答案不给 ✓ 位置留着 ✓）
 *   endnote→ 收到文末「参考答案」区 ✓
 */
export function renderFor(h: Handout, v: HdVersion) {
  const main: HdRendered[] = []
  const notes: HdRendered[] = []
  const counters: Record<string, number> = {}
  const childOf: Record<string, number> = { variant: 0 }
  let lastExample = 0
  for (const b of h.blocks) {
    const mode = b.render[v] || 'inline'
    if (mode === 'hide') continue
    let num = ''
    if (b.number && HD_NUMBERED.includes(b.type)) {
      if (b.type === 'variant') { num = '变式 ' + lastExample + '-' + (++childOf.variant) }
      else {
        counters[b.type] = (counters[b.type] || 0) + 1
        num = (HD_NUM_PREFIX[b.type] || '') + ' ' + counters[b.type]
        if (b.type === 'example') { lastExample = counters[b.type]; childOf.variant = 0 }
      }
    }
    const item: HdRendered = { b, num, show: mode === 'blank' ? '' : b.text, endnote: mode === 'endnote' }
    if (item.endnote) notes.push(item)
    else main.push(item)
  }
  return { main, notes }
}

export const rendered = computed(() => renderFor(handout.value, hdVersion.value))

/** 导出用：整份讲义 → 纯文本（给打印/复制/自查 ✓） */
export function handoutToText(h: Handout, v: HdVersion): string {
  const { main, notes } = renderFor(h, v)
  const head = [h.meta.school, h.meta.subject, h.meta.title, h.meta.subtitle, h.meta.grade, h.meta.teacher, h.meta.date]
    .filter(Boolean).join(' · ')
  const lines = [head, '']
  for (const it of main) {
    const label = HD_LABEL[it.b.type]
    const txt = it.show ? hdFillText(it.show, v) : (it.b.type === 'blank' ? '（留白 ' + (it.b.blankCm || 4) + 'cm）' : '')
    lines.push((it.num ? it.num + '．' : label + '：') + txt)
  }
  if (notes.length) {
    lines.push('', '参考答案')
    notes.forEach((it, i) => lines.push((i + 1) + '．' + (HD_LABEL[it.b.type]) + '：' + hdFillText(it.show, v)))
  }
  return lines.join('\n')
}

/* ---------------- 【M1.1】教材版本 / 册 / 章 / 节 + 目录树 + A4 页面 HTML ---------------- */

/** 教材版本（默认人教版 ✓） */
export const HD_PRESSES = ['人教版', '北师大版', '苏教版', '湘教版', '沪教版', '鄂教版', '其他']
/** 六个模块 ✓（高一到高二的顺序 ✓） */
export const HD_BOOKS = ['必修一', '必修二', '必修三', '选择性必修一', '选择性必修二', '选择性必修三']

/** HTML 转义（公式的 $…$ 原样留着 ✓） */
export function hdEsc(s: unknown): string {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 目录树：章（h1 块）→ 节（h2 块）✓ —— 左侧「目录」用它 ✓ */
export interface HdOutlineNode { title: string; bid: string; kids: HdOutlineNode[] }
export function outlineOf(h: Handout): HdOutlineNode[] {
  const roots: HdOutlineNode[] = []
  let chap: HdOutlineNode | null = null
  for (const b of h.blocks) {
    if (b.type === 'h1') { chap = { title: b.text || '（未命名章）', bid: b.id, kids: [] }; roots.push(chap) }
    else if (b.type === 'h2') {
      const node: HdOutlineNode = { title: b.text || '（未命名节）', bid: b.id, kids: [] }
      if (chap) chap.kids.push(node); else roots.push(node)
    }
  }
  return roots
}

/**
 * 【v1476】按教材**自动生成讲义标题** ✓
 *   例：人教版·选择性必修一 第 3 章 第 1 节（第 2 课时）✓
 *   —— 章/节/课时缺哪个就省哪个 ✓；全空就回退到「未命名讲义」✓
 */
export function autoTitleOf(h: Handout): string {
  const m = h.meta
  const head = [m.press, m.book].filter(Boolean).join('·')
  const num = (v: string, unit: string) => {
    const s = String(v || '').trim()
    if (!s) return ''
    if (s.charAt(0) === '第') return s
    return '第 ' + s + ' ' + unit
  }
  const parts = [num(m.chapter, '章'), num(m.section, '节')].filter(Boolean).join(' ')
  const per = String(m.period || '').trim() ? '（第 ' + String(m.period).replace(/^第\s*/, '') + ' 课时）' : ''
  const body = [head, parts].filter(Boolean).join(' ')
  if (!body) return ''
  return body + per
}

/** 自动标题开着时，把标题同步成生成值 ✓（改教材定位 → 标题跟着变 ✓） */

/* ---------------- 【M2.5】讲义库（多份）+ 图片块 ---------------- */

/** 一份讲义 = 内容 + id + 时间 ✓ */
export interface HdDoc extends Handout {
  id: string
  updatedAt: string
  /** 【M2.9】上次"保存到文件"的时间与路径 ✓（localStorage 只是工作副本 ✓，文件才是能带走的 ✓） */
  savedAt?: string
  savedPath?: string
  /** 【M4】这一份在库目录（exe 同级 LJ-讲义）里的文件名 ✓
   *  有它 = 已在库里（能跟着 exe 走 ✓）；没有 = 还没落盘的"未保存"份 ✓ */
  file?: string
}

const LIB_KEY = 'lj-mathslides-vue:handout-lib'
const CUR_KEY = 'lj-mathslides-vue:handout-cur'

/** 讲义库（全部讲义 ✓） */
export const lib = ref<HdDoc[]>([])
/** 当前打开的是哪一份 ✓ */
export const curId = ref('')

function readLib(): HdDoc[] | null {
  try {
    const raw = localStorage.getItem(LIB_KEY)
    if (!raw) return null
    const arr = JSON.parse(raw) as HdDoc[]
    if (!Array.isArray(arr) || !arr.length) return null
    return arr.map((d) => ({ ...normalize(d), id: String(d.id || hdId()), updatedAt: String(d.updatedAt || nowStamp()) }))
  } catch { return null }
}
function writeLib() {
  try { localStorage.setItem(LIB_KEY, JSON.stringify(lib.value)) } catch { /* 存不上不影响用 ✓ */ }
}
function nowStamp(): string { return new Date().toISOString().slice(0, 16).replace('T', ' ') }

/** 库里的当前那份（没有就建一份 ✓） */
function ensureCurrent(): HdDoc {
  if (curId.value) {
    const d = lib.value.find((x) => x.id === curId.value)
    if (d) return d
  }
  // ① 老版本只存了一份（lj-mathslides-vue:handout ✓）→ 迁进来 ✓
  const legacy = (() => { try { return localStorage.getItem(KEY) } catch { return null } })()
  const first: HdDoc = legacy
    ? { ...normalize(JSON.parse(legacy)), id: hdId(), updatedAt: nowStamp() }
    : { ...sampleHandout(), id: hdId(), updatedAt: nowStamp() }
  lib.value = [first, ...lib.value]
  curId.value = first.id
  writeLib()
  return first
}

/** 载入讲义库（应用启动/首次打开讲义时调一次 ✓） */
export function initHandoutLib() {
  if (!lib.value.length) lib.value = readLib() || []
  try { curId.value = localStorage.getItem(CUR_KEY) || '' } catch { curId.value = '' }
  const d = ensureCurrent()
  handout.value = { meta: d.meta, blocks: d.blocks }
  saveHandout(handout.value)
}

/** 把当前内容写回库里（每次改动都会调 ✓） */
export function saveHandoutLibrary() {
  const d = lib.value.find((x) => x.id === curId.value)
  if (!d) return
  d.meta = handout.value.meta
  d.blocks = handout.value.blocks
  d.updatedAt = nowStamp()
  writeLib()
  try { localStorage.setItem(CUR_KEY, curId.value) } catch { /* 忽略 */ }
  scheduleFolderWrite()      // 【M4】改过就自动落盘（2.5 秒防抖 ✓，真身是库目录里的文件 ✓）
}

/** 【M2.9】记下"已保存到文件" ✓ */
export function markSaved(path: string) {
  const d = lib.value.find((x) => x.id === curId.value)
  if (d) { d.savedAt = nowStamp(); d.savedPath = path; writeLib() }
}

/** 当前这份的保存信息（footer 显示 ✓） */
export function currentSaved(): { savedAt?: string; savedPath?: string } {
  const d = lib.value.find((x) => x.id === curId.value)
  return { savedAt: d?.savedAt, savedPath: d?.savedPath }
}

/* ---------------- 【M4】库目录（exe 同级 LJ-讲义）：**真身** ✓ ---------------- */

/** 库目录路径（Rust 给的 ✓；空 = 还没读到 / 不在桌面端 ✓） */
export const folderDir = ref('')
/** 库里现有哪些文件（名字带 .json ✓）—— 界面用它显示「已落盘 / 未保存」✓ */
export const folderFiles = ref<string[]>([])
/** 库目录读写出错的原因（**写不进去必须明说** ✗ 不能让老师以为存上了 ✓） */
export const folderError = ref('')
/** 写失败一次就不再反复试（免得每 2.5 秒弹一次错 ✓） */
let folderWritable = true
let folderTimer: number | undefined

/** 自动落盘（2.5 秒防抖 ✓）—— 只有**已经在库里**的那份才自动写 ✓
 *  （新建的那份要老师点一次「保存讲义」：免得库里堆一堆"未命名讲义"文件 ✗） */
function scheduleFolderWrite() {
  if (!folderWritable || typeof window === 'undefined') return
  if (folderTimer) window.clearTimeout(folderTimer)
  folderTimer = window.setTimeout(() => {
    folderTimer = undefined
    const d = lib.value.find((x) => x.id === curId.value)
    if (d && d.file) void saveDocToFolder(d.id)
  }, 2500)
}

/** 把一份讲义写进库目录 ✓（标题改了 = 写新名字 + 把旧文件挪进 .deleted ✓） */
export async function saveDocToFolder(id: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  const d = lib.value.find((x) => x.id === id)
  if (!d) return { ok: false, error: '这一份不在库里' }
  const want = hdFileName(d.meta.title || '未命名讲义') + '.json'
  const r = await hdFolderWrite(want, hdDocText({ id: d.id, updatedAt: d.updatedAt, meta: d.meta, blocks: d.blocks }))
  if (!r.ok) {
    folderWritable = false
    folderError.value = r.error || '写入库目录失败'
    return { ok: false, error: r.error }
  }
  folderError.value = ''
  const old = d.file
  d.file = r.name || want
  d.savedAt = nowStamp()
  d.savedPath = r.path
  writeLib()
  if (old && old !== d.file) void hdFolderDelete(old)      // 改名 → 旧文件挪走（不真删 ✓）
  const set = new Set(folderFiles.value)
  if (old) set.delete(old)
  set.add(d.file)
  folderFiles.value = Array.from(set)
  if (!folderDir.value) folderDir.value = await hdFolderDir()
  return { ok: true, path: r.path }
}

/**
 * 从库目录读回全部讲义，和 localStorage 工作副本**对账** ✓（打开讲义时调一次 ✓）
 * 对账规则：先按文件名认，再按标题认（第一次搬家时 file 还没写上 ✓）；
 * 同一份两边都有 → **谁新用谁**（工作副本通常更新 ✓，文件那份是"上次保存的"✓）。
 */
export async function syncHandoutFolder(): Promise<{ files: number; added: number; kept: number }> {
  const dir = await hdFolderDir()
  if (!dir) return { files: 0, added: 0, kept: 0 }
  folderDir.value = dir
  const files = await hdFolderList()
  folderFiles.value = files.map((x) => x.name)
  let added = 0
  let kept = 0
  for (const f of files) {
    const raw = hdDocFromText(await hdFolderRead(f.name))
    if (!raw) continue
    const norm = normalize({ meta: raw.meta, blocks: raw.blocks })
    const doc: HdDoc = {
      meta: norm.meta,
      blocks: norm.blocks,
      id: String((raw as { id?: unknown }).id || hdId()),
      updatedAt: String((raw as { updatedAt?: unknown }).updatedAt || nowStamp()),
      file: f.name,
    }
    const hit = lib.value.find((x) => x.file === f.name)
      || lib.value.find((x) => !x.file && (x.meta.title || '') === (doc.meta.title || ''))
    if (!hit) { lib.value = [...lib.value, doc]; added++; continue }
    kept++
    if (String(hit.updatedAt || '') >= String(doc.updatedAt || '')) { hit.file = f.name; continue }
    hit.meta = doc.meta
    hit.blocks = doc.blocks
    hit.updatedAt = doc.updatedAt
    hit.file = f.name
  }
  writeLib()
  return { files: files.length, added, kept }
}

/** 库目录里是否有这个文件（界面判断"未保存"用 ✓） */
export function inFolder(name?: string): boolean {
  return !!name && folderFiles.value.indexOf(name) >= 0
}


/** 打开另一份 ✓（会先把当前这份存好 ✓） */
export function openHandout(id: string) {
  if (id === curId.value) return
  saveHandoutLibrary()
  const d = lib.value.find((x) => x.id === id)
  if (!d) return
  curId.value = id
  handout.value = { meta: d.meta, blocks: d.blocks }
  try { localStorage.setItem(CUR_KEY, id) } catch { /* 忽略 */ }
}

/** 新建一份 ✓（沿用上一次的教材定位/学校信息，省得每次重填 ✓） */
export function newHandout(): void {
  saveHandoutLibrary()
  const prev = handout.value.meta
  const doc: HdDoc = {
    id: hdId(), updatedAt: nowStamp(),
    meta: {
      ...prev, title: '未命名讲义', subtitle: '', period: '', chapter: '', section: '',
      autoTitle: true,
      date: new Date().toISOString().slice(0, 10),
    },
    blocks: [makeBlock('h1', '一、知识梳理')],
  }
  syncAutoTitle(doc)
  lib.value = [doc, ...lib.value]
  curId.value = doc.id
  handout.value = { meta: doc.meta, blocks: doc.blocks }
  writeLib()
  try { localStorage.setItem(CUR_KEY, doc.id) } catch { /* 忽略 */ }
}

/** 【M4】删除一份 —— 库目录里的文件**挪进 `.deleted\`**（不是真删 ✓ 手滑能捞回来 ✓） */
export function deleteHandout(id: string) {
  const d = lib.value.find((x) => x.id === id)
  if (!d) return
  if (d.file) {
    void hdFolderDelete(d.file).then((r) => {
      if (r.ok) folderFiles.value = folderFiles.value.filter((n) => n !== d.file)
    })
  }
  lib.value = lib.value.filter((x) => x.id !== id)
  if (!lib.value.length) {
    // 全删光了 → 自动给一份空白（界面不能没有"当前这份" ✓）
    lib.value = [{ ...blankHandout(), id: hdId(), updatedAt: nowStamp() }]   // 【v1716】空白 ✓（以前给的是示例讲义 ✗）
  }
  writeLib()
  if (curId.value === id) {
    const first = lib.value[0]
    curId.value = first.id
    handout.value = { meta: first.meta, blocks: first.blocks }
    saveHandout(handout.value)   // 【v1716】连单份那份（KEY）也写掉 ✓ 否则老内容下次启动会被「迁回来」✗
    try { localStorage.setItem(CUR_KEY, curId.value) } catch { /* 忽略 */ }
  }
}

/** 讲义库目录树：册 → 章 → 节 → 课时（讲义）✓ —— 左侧「讲义库」用它 ✓ */
export interface HdLibNode { key: string; label: string; docs: HdDoc[]; kids: HdLibNode[] }
export function handoutTree(): HdLibNode[] {
  const books = new Map<string, Map<string, Map<string, HdDoc[]>>>()
  for (const d of lib.value) {
    const bk = String(d.meta.book || '未分册')
    const cp = String(d.meta.chapter || '').trim() || '未分章'
    const sc = String(d.meta.section || '').trim() || '未分节'
    if (!books.has(bk)) books.set(bk, new Map())
    const ch = books.get(bk) as Map<string, Map<string, HdDoc[]>>
    if (!ch.has(cp)) ch.set(cp, new Map())
    const se = ch.get(cp) as Map<string, HdDoc[]>
    if (!se.has(sc)) se.set(sc, [])
    ;(se.get(sc) as HdDoc[]).push(d)
  }
  const out: HdLibNode[] = []
  for (const [bk, chs] of books) {
    const kids: HdLibNode[] = []
    for (const [cp, secs] of chs) {
      const skids: HdLibNode[] = []
      for (const [sc, docs] of secs) {
        skids.push({ key: bk + '/' + cp + '/' + sc, label: sc === '未分节' ? sc : '第 ' + sc + ' 节', docs: docs.slice().sort((a, b) => (a.meta.period || '').localeCompare(b.meta.period || '')), kids: [] })
      }
      kids.push({ key: bk + '/' + cp, label: cp === '未分章' ? cp : '第 ' + cp + ' 章', docs: [], kids: skids })
    }
    out.push({ key: bk, label: bk, docs: [], kids })
  }
  return out
}

export function syncAutoTitle(h: Handout): void {
  if (h.meta.autoTitle === false) return
  const t = autoTitleOf(h)
  if (t) h.meta.title = t
}

/** 抬头那一行：教材版本 · 册 · 第几章 · 第几节 ✓（有才显示 ✓） */
export function handoutPathOf(h: Handout): string {
  const m = h.meta
  const chap = String(m.chapter || '').trim()
  const sec = String(m.section || '').trim()
  const ch = chap ? (chap.charAt(0) === '第' || chap.charAt(0) === '（' ? chap : '第 ' + chap + ' 章') : ''
  const se = sec ? (sec.charAt(0) === '第' || sec.charAt(0) === '（' ? sec : '第 ' + sec + ' 节') : ''
  return [m.press, m.book, ch, se].filter(Boolean).join(' · ')
}

/**
 * A4 页面 → **HTML 字符串** ✓
 *
 * ⚠ 为什么改成字符串而不是 Vue 模板 ✗：MathJax 排版要**改写 DOM** ✓，而 Vue 也在管同一棵 DOM ✗ →
 *   两边打架：**新加的块公式不渲染、点一下才渲染** ✗（老师实测 ✓）。
 *   改成「Vue 只给一个空容器 + 内容变了整块重写 + typesetMixed 排版」✓ ——
 *   与题库预览 / 试卷同一条路 ✓（那两处一直没这毛病 ✓）。
 */
export function pageHtmlOf(h: Handout, v: HdVersion, imgMap: Record<string, string> = {}): string {
  const { main, notes } = renderFor(h, v)
  const m = h.meta
  const L: string[] = []
  L.push('<div class="hd-ptitle">' + hdEsc(m.title || '未命名讲义') + '</div>')
  if (m.subtitle) L.push('<div class="hd-psub">' + hdEsc(m.subtitle) + '</div>')
  const metaBits = [m.school, m.subject, m.grade, m.teacher ? '教师：' + m.teacher : '', m.date, handoutPathOf(h), m.period ? '第 ' + String(m.period).replace(/^第\s*/, '') + ' 课时' : '', v === 'student' ? '学生版' : '教师版']
    .filter(Boolean).map((x) => '<span>' + hdEsc(x) + '</span>').join('')
  L.push('<div class="hd-pmeta">' + metaBits + '</div>')
  /** 【v1712】学生版抬头加「姓名 / 班级 / 学号」填写行 ✓（国内学生版讲义都有 ✓ 教师版不加 ✗） */
  if (v === 'student') L.push('<div class="hd-pname"><span>姓名：<i class="hd-line"></i></span><span>班级：<i class="hd-line"></i></span><span>学号：<i class="hd-line"></i></span></div>')

  for (const it of main) {
    const t = it.b.type
    const body = hdRichHtml(hdFillOut(hdEsc(it.show), v))   // 【v1712】挖空 + 【v1713】表格 / 图片 ✓
    const id = ' id="hd-b-' + it.b.id + '"'
    /** 知识底座插进来的条目**带上标题** ✓（「知识梳理 · 基本不等式」✓ 不然只剩公式，学生不知道这是哪一条 ✓） */
    const lab = (base: string) => hdEsc(base + (it.b.kbTitle ? ' · ' + it.b.kbTitle : ''))
    if (t === 'pagebreak') { L.push('<div class="hd-pagebreak"' + id + '>— 分页 —</div>'); continue }
    if (t === 'blank') { L.push('<div class="hd-blank"' + id + ' style="height:' + (it.b.blankCm || 4) + 'cm">（留白）</div>'); continue }
    if (t === 'h1') { L.push('<h1 class="hd-h1"' + id + '>' + body + '</h1>'); continue }
    if (t === 'h2') { L.push('<h2 class="hd-h2"' + id + '>' + body + '</h2>'); continue }
    if (t === 'formula') { L.push('<div class="hd-formula"' + id + '>' + body + '</div>'); continue }
    if (t === 'figure') {
      const src = imgMap[it.b.id] || it.b.img?.src || ''
      if (src) {
        const lay = it.b.img?.layout || 'center'
        const w = Number(it.b.img?.width) || 0
        const wpct = w > 0 ? Math.max(10, Math.min(100, w)) : (lay.indexOf('float') === 0 ? 45 : 0)
        // ⚠ 非浮动布局要**对齐盒子本身**（margin auto）✗ —— 只写 text-align 的话，
        //   动的是图注（短）而图（占满盒宽）看着没动 ✗（老师实测：「改的是图注的左中右」✓）
        const align = lay === 'left' ? 'margin:10px auto 10px 0;' : lay === 'right' ? 'margin:10px 0 10px auto;' : 'margin:10px auto;'
        const style = (lay.indexOf('float') === 0
          ? 'float:' + (lay === 'float-left' ? 'left' : 'right') + ';' + (wpct ? 'width:' + wpct + '%;' : '')
          : align + (wpct ? 'width:' + wpct + '%;' : ''))
        L.push('<figure class="hd-fig hd-fig--' + lay + '"' + id + (style ? ' style="' + style + '"' : '') + '><img src="' + hdEsc(src) + '" alt="' + hdEsc(it.b.img?.caption || '插图') + '" />'
          + (it.b.img?.caption ? '<figcaption>' + hdEsc(it.b.img.caption) + '</figcaption>' : '') + '</figure>')
      } else {
        L.push('<div class="hd-fig hd-fig--empty"' + id + '>（插图：还没选图片）</div>')
      }
      continue
    }
    if (t === 'goal') { L.push('<div class="hd-bx hd-bx--goal"' + id + '><b>' + lab('学习目标') + '</b><div class="hd-txt">' + body + '</div></div>'); continue }
    if (t === 'knowledge') { L.push('<div class="hd-bx hd-bx--know"' + id + '><b>' + lab('知识梳理') + '</b><div class="hd-txt">' + body + '</div></div>'); continue }
    if (t === 'note') { L.push('<div class="hd-bx hd-bx--note"' + id + '><b>' + lab('提示') + '</b><div class="hd-txt">' + body + '</div></div>'); continue }
    if (t === 'warn') { L.push('<div class="hd-bx hd-bx--warn"' + id + '><b>' + lab('易错警示') + '</b><div class="hd-txt">' + body + '</div></div>'); continue }
    if (t === 'summary') { L.push('<div class="hd-bx hd-bx--sum"' + id + '><b>' + lab('归纳小结') + '</b><div class="hd-txt">' + body + '</div></div>'); continue }
    if (t === 'preview') { L.push('<div class="hd-bx hd-bx--pre"' + id + '><b>' + lab('课前预习') + '</b><div class="hd-txt">' + body + '</div></div>'); continue }
    if (t === 'explore') { L.push('<div class="hd-bx hd-bx--exp"' + id + '><b>' + lab('探究思考') + '</b><div class="hd-txt">' + body + '</div></div>'); continue }
    if (t === 'method') { L.push('<div class="hd-bx hd-bx--met"' + id + '><b>' + lab('方法总结') + '</b><div class="hd-txt">' + body + '</div></div>'); continue }
    if (t === 'homework') { L.push('<div class="hd-bx hd-bx--hw"' + id + '><b>' + lab('课后作业') + '</b><div class="hd-txt">' + body + '</div></div>'); continue }
    if (t === 'reflect') { L.push('<div class="hd-bx hd-bx--ref"' + id + '><b>' + lab('学后反思') + '</b><div class="hd-txt">' + body + '</div></div>'); continue }
    if (t === 'example' || t === 'variant' || t === 'exercise') {
      L.push('<div class="hd-q"' + id + '><span class="hd-qnum">' + hdEsc(it.num) + '</span><span class="hd-qtext">' + body + '</span></div>'); continue
    }
    if (t === 'answer') { L.push('<div class="hd-ans"' + id + '><b>答案</b>' + body + '</div>'); continue }
    if (t === 'solution') { L.push('<div class="hd-sol"' + id + '><b>解析</b>' + body + '</div>'); continue }
    L.push('<div class="hd-para"' + id + '>' + body + '</div>')
  }
  if (notes.length) {
    L.push('<h1 class="hd-h1 hd-h1--end">参考答案</h1>')
    notes.forEach((it, i) => {
      L.push('<div class="hd-endnote"><span class="hd-qnum">' + (i + 1) + '</span><span class="hd-qtext"><b>' + hdEsc(HD_LABEL[it.b.type]) + '</b>' + hdRichHtml(hdFillOut(hdEsc(it.show), v)) + '</span></div>')
    })
  }
  return L.join('\n')
}

