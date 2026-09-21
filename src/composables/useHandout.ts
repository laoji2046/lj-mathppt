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
}

export const HD_LABEL: Record<HdBlockType, string> = {
  h1: '章标题', h2: '节标题', para: '正文', formula: '公式', figure: '图片', pagebreak: '分页',
  goal: '学习目标', knowledge: '知识梳理', example: '例题', variant: '变式', exercise: '当堂练习',
  summary: '归纳小结', note: '提示', warn: '易错警示', answer: '答案', solution: '解析', blank: '留白',
}

/** 可以自动编号的块 ✓（例题 / 变式 / 练习 各自独立编号 ✓） */
export const HD_NUMBERED: HdBlockType[] = ['example', 'variant', 'exercise']
export const HD_NUM_PREFIX: Partial<Record<HdBlockType, string>> = { example: '例', variant: '变式', exercise: '练习' }

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
      press: '人教版', book: '选择性必修一', chapter: '3', section: '1',
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

function normalize(h: unknown): Handout {
  const o = (h || {}) as Partial<Handout>
  const meta: HandoutMeta = {
    school: '', subject: '数学', title: '未命名讲义', subtitle: '', grade: '', teacher: '',
    date: new Date().toISOString().slice(0, 10),
    press: '人教版', book: '必修一', chapter: '', section: '',
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
    const txt = it.show || (it.b.type === 'blank' ? '（留白 ' + (it.b.blankCm || 4) + 'cm）' : '')
    lines.push((it.num ? it.num + '．' : label + '：') + txt)
  }
  if (notes.length) {
    lines.push('', '参考答案')
    notes.forEach((it, i) => lines.push((i + 1) + '．' + (HD_LABEL[it.b.type]) + '：' + it.show))
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
export function pageHtmlOf(h: Handout, v: HdVersion): string {
  const { main, notes } = renderFor(h, v)
  const m = h.meta
  const L: string[] = []
  L.push('<div class="hd-ptitle">' + hdEsc(m.title || '未命名讲义') + '</div>')
  if (m.subtitle) L.push('<div class="hd-psub">' + hdEsc(m.subtitle) + '</div>')
  const metaBits = [m.school, m.subject, m.grade, m.teacher ? '教师：' + m.teacher : '', m.date, handoutPathOf(h), v === 'student' ? '学生版' : '教师版']
    .filter(Boolean).map((x) => '<span>' + hdEsc(x) + '</span>').join('')
  L.push('<div class="hd-pmeta">' + metaBits + '</div>')

  for (const it of main) {
    const t = it.b.type
    const body = hdEsc(it.show)
    const id = ' id="hd-b-' + it.b.id + '"'
    if (t === 'pagebreak') { L.push('<div class="hd-pagebreak"' + id + '>— 分页 —</div>'); continue }
    if (t === 'blank') { L.push('<div class="hd-blank"' + id + ' style="height:' + (it.b.blankCm || 4) + 'cm">（留白）</div>'); continue }
    if (t === 'h1') { L.push('<h1 class="hd-h1"' + id + '>' + body + '</h1>'); continue }
    if (t === 'h2') { L.push('<h2 class="hd-h2"' + id + '>' + body + '</h2>'); continue }
    if (t === 'formula') { L.push('<div class="hd-formula"' + id + '>' + body + '</div>'); continue }
    if (t === 'goal') { L.push('<div class="hd-bx hd-bx--goal"' + id + '><b>学习目标</b><div class="hd-txt">' + body + '</div></div>'); continue }
    if (t === 'knowledge') { L.push('<div class="hd-bx hd-bx--know"' + id + '><b>知识梳理</b><div class="hd-txt">' + body + '</div></div>'); continue }
    if (t === 'note') { L.push('<div class="hd-bx hd-bx--note"' + id + '><b>提示</b><div class="hd-txt">' + body + '</div></div>'); continue }
    if (t === 'warn') { L.push('<div class="hd-bx hd-bx--warn"' + id + '><b>易错警示</b><div class="hd-txt">' + body + '</div></div>'); continue }
    if (t === 'summary') { L.push('<div class="hd-bx hd-bx--sum"' + id + '><b>归纳小结</b><div class="hd-txt">' + body + '</div></div>'); continue }
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
      L.push('<div class="hd-endnote"><span class="hd-qnum">' + (i + 1) + '</span><span class="hd-qtext"><b>' + hdEsc(HD_LABEL[it.b.type]) + '</b>' + hdEsc(it.show) + '</span></div>')
    })
  }
  return L.join('\n')
}

