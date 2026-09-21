/**
 * 【M2】讲义 ↔ 题库打通 + 知识底座
 *
 * 三件事：
 *   ① 插单题：库里挑一道 → 变成「例题/练习 + 解析 + 答案」三块 ✓（版本渲染沿用 M1 的默认 ✓）
 *   ② 抽题组讲义：按 知识点 / 难度 / 章节 洗牌抽 N 道 ✓（例题池与练习池分开 ✓）
 *   ③ 知识底座：常用公式 / 模型 / 易错点按「册 + 章」存着 ✓ 一键插成「知识梳理 / 提示 / 易错警示」块 ✓
 *
 * 题目**引用**库里的 id（block.ref ✓）而不是复制成死文本 ✗ —— 以后题改了能一键同步 ✓
 */
import { metaOf, qSearch } from '@/composables/useQuestionBank'
import type { QFilter, QItem } from '@/composables/useQuestionBank'
import { makeBlock } from '@/composables/useHandout'
import type { HdBlock } from '@/composables/useHandout'

/* ---------------- ① 题目 → 块 ---------------- */

/** 题干 + 选项（选项一行一个 ✓）—— 讲义里就是"题目正文" ✓ */
export function stemTextOf(it: QItem): string {
  const m = metaOf(it)
  const stem = String(m.stem || it.body || it.title || '').trim()
  const raw = (m as { options?: unknown }).options
  const opts = Array.isArray(raw) ? raw.map((x) => String(x == null ? '' : x)).filter(Boolean) : []
  return opts.length ? stem + '\n' + opts.join('\n') : stem
}

export type QBlockKind = 'example' | 'exercise' | 'variant'

/**
 * 一道题 → 几块 ✓
 *   kind 块（题干+选项）→ 解析块 → 答案块（有才加 ✓）
 *   每块都记 ref = 题目 id ✓（块列表里会显示「题 #123」✓）
 */
export function blocksFromQuestion(it: QItem, kind: QBlockKind = 'example', withSolution = true, withAnswer = true): HdBlock[] {
  const m = metaOf(it)
  const out: HdBlock[] = []
  const q = makeBlock(kind, stemTextOf(it))
  q.ref = Number(it.id)
  out.push(q)
  const sol = String((m as { solution?: string }).solution || '').trim()
  const ans = String((m as { answer?: string }).answer || '').trim()
  if (withSolution && sol) { const b = makeBlock('solution', sol); b.ref = Number(it.id); out.push(b) }
  if (withAnswer && ans) { const b = makeBlock('answer', ans); b.ref = Number(it.id); out.push(b) }
  return out
}

/* ---------------- ② 抽题 ---------------- */

/** Fisher–Yates 洗牌 ✓（抽题要"每次不一样" ✓） */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t
  }
  return arr
}

/** 按筛选取一批候选（比 n 多取一些再洗牌 ✓） */
export async function drawQuestions(f: QFilter, n: number): Promise<{ items: QItem[]; total: number }> {
  const take = Math.max(n * 4, 60)
  const r = await qSearch({ ...f, limit: Math.min(take, 500) })
  const items = shuffle((r.items || []).slice()).slice(0, Math.max(1, n))
  return { items, total: r.total || items.length }
}

/** 【M2】一键"同步题库"：把引用了题库的块按库里最新内容刷新 ✓（改过题再回讲义点一下 ✓） */
export async function refreshRefBlocks(blocks: HdBlock[]): Promise<number> {
  const ids = Array.from(new Set(blocks.map((b) => Number(b.ref || 0)).filter((x) => x > 0)))
  if (!ids.length) return 0
  const r = await qSearch({ limit: 500 })
  const byId = new Map((r.items || []).map((it) => [Number(it.id), it]))
  let n = 0
  for (const b of blocks) {
    const it = byId.get(Number(b.ref || 0))
    if (!it) continue
    const m = metaOf(it)
    if (b.type === 'solution') { const v = String((m as { solution?: string }).solution || '').trim(); if (v && v !== b.text) { b.text = v; n++ } }
    else if (b.type === 'answer') { const v = String((m as { answer?: string }).answer || '').trim(); if (v && v !== b.text) { b.text = v; n++ } }
    else { const v = stemTextOf(it); if (v && v !== b.text) { b.text = v; n++ } }
  }
  return n
}

/* ---------------- ③ 知识底座 ---------------- */

export interface KbItem {
  id: string
  /** 模块 / 册 ✓ */
  book: string
  /** 章（自由填 ✓） */
  chapter: string
  /** 插进去会变成哪种块 ✓ */
  kind: 'knowledge' | 'note' | 'warn'
  title: string
  text: string
  /** 自定义条目（可删 ✓；内置的不可删 ✓） */
  custom?: boolean
}

/** 内置起步集：人教版必修一/二、选择性必修一/二 最常见的公式与模型 ✓（可自己再加 ✓） */
export const KB_BUILTIN: KbItem[] = [
  { id: 'k1', book: '必修一', chapter: '1', kind: 'knowledge', title: '集合的运算律', text: '$A\\cap B=A\\iff A\\subseteq B$；$A\\cup B=B\\iff A\\subseteq B$；$\\complement_U(A\\cap B)=(\\complement_U A)\\cup(\\complement_U B)$。' },
  { id: 'k2', book: '必修一', chapter: '1', kind: 'knowledge', title: '充分条件与必要条件', text: '$p\\Rightarrow q$ 则 $p$ 是 $q$ 的**充分**条件、$q$ 是 $p$ 的**必要**条件；$p\\iff q$ 则互为充要条件。判断口诀：**小范围推大范围**。' },
  { id: 'k3', book: '必修一', chapter: '2', kind: 'knowledge', title: '基本不等式', text: '$a>0,b>0$ 时 $\\dfrac{a+b}{2}\\geq\\sqrt{ab}$（当且仅当 $a=b$ 取等）；常用变形 $a+b\\geq 2\\sqrt{ab}$、$ab\\leq\\left(\\dfrac{a+b}{2}\\right)^{2}$。' },
  { id: 'k4', book: '必修一', chapter: '2', kind: 'knowledge', title: '一元二次不等式解法', text: '看 $a$ 定开口 → 求 $\\Delta$ → 求根 $x_1,x_2$ → 「大于取两边、小于取中间」；$\\Delta<0$ 时结合开口直接判。' },
  { id: 'k5', book: '必修一', chapter: '3', kind: 'knowledge', title: '函数单调性判定', text: '定义法：设 $x_1<x_2$，判 $f(x_1)-f(x_2)$ 的符号；导数法：$f\'(x)>0$ 单增、$f\'(x)<0$ 单减。' },
  { id: 'k6', book: '必修一', chapter: '4', kind: 'knowledge', title: '指数与对数运算', text: '$a^{m}a^{n}=a^{m+n}$、$(a^{m})^{n}=a^{mn}$；$\\log_a(MN)=\\log_a M+\\log_a N$、$\\log_a\\dfrac{M}{N}=\\log_a M-\\log_a N$、$\\log_a M^{n}=n\\log_a M$；换底 $\\log_a b=\\dfrac{\\log_c b}{\\log_c a}$。' },
  { id: 'k7', book: '必修一', chapter: '4', kind: 'warn', title: '对数定义域', text: '真数必须 $>0$、底数 $>0$ 且 $\\neq 1$ —— 求值域/解不等式时**先写定义域**，别急着变形。' },
  { id: 'k8', book: '必修一', chapter: '4', kind: 'knowledge', title: '零点存在定理', text: '$f(x)$ 在 $[a,b]$ 上连续且 $f(a)f(b)<0$，则 $(a,b)$ 内至少有一个零点；**反之不成立**（有零点不一定异号）。' },
  { id: 'k9', book: '必修二', chapter: '1', kind: 'knowledge', title: '三角函数诱导公式', text: '口诀「**奇变偶不变，符号看象限**」：$\\dfrac{\\pi}{2}$ 的奇数倍要变名（sin↔cos），符号按原函数在对应象限的正负。' },
  { id: 'k10', book: '必修二', chapter: '2', kind: 'knowledge', title: '正弦定理与余弦定理', text: '$\\dfrac{a}{\\sin A}=\\dfrac{b}{\\sin B}=\\dfrac{c}{\\sin C}=2R$；$a^{2}=b^{2}+c^{2}-2bc\\cos A$；面积 $S=\\dfrac{1}{2}ab\\sin C$。' },
  { id: 'k11', book: '必修二', chapter: '3', kind: 'knowledge', title: '平面向量数量积', text: '$\\vec a\\cdot\\vec b=|\\vec a||\\vec b|\\cos\\theta=x_1x_2+y_1y_2$；垂直 $\\iff \\vec a\\cdot\\vec b=0$；夹角 $\\cos\\theta=\\dfrac{\\vec a\\cdot\\vec b}{|\\vec a||\\vec b|}$。' },
  { id: 'k12', book: '必修二', chapter: '4', kind: 'knowledge', title: '复数的模与共轭', text: '$|z|=\\sqrt{a^{2}+b^{2}}$、$z\\bar z=|z|^{2}$；$|z_1z_2|=|z_1||z_2|$、$\\left|\\dfrac{z_1}{z_2}\\right|=\\dfrac{|z_1|}{|z_2|}$。' },
  { id: 'k13', book: '选择性必修一', chapter: '1', kind: 'knowledge', title: '直线的五种方程', text: '点斜式 $y-y_0=k(x-x_0)$、斜截式 $y=kx+b$、两点式、截距式 $\\dfrac{x}{a}+\\dfrac{y}{b}=1$、一般式 $Ax+By+C=0$；**斜率不存在时要单独讨论**。' },
  { id: 'k14', book: '选择性必修一', chapter: '1', kind: 'knowledge', title: '点到直线的距离', text: '点 $(x_0,y_0)$ 到 $Ax+By+C=0$ 的距离 $d=\\dfrac{|Ax_0+By_0+C|}{\\sqrt{A^{2}+B^{2}}}$；两平行线间距离同式（先化成同系数）。' },
  { id: 'k15', book: '选择性必修一', chapter: '2', kind: 'knowledge', title: '圆的方程与位置关系', text: '标准式 $(x-a)^{2}+(y-b)^{2}=r^{2}$；判断直线与圆：比较圆心到直线距离 $d$ 与 $r$（$d<r$ 相交、$d=r$ 相切、$d>r$ 相离）。' },
  { id: 'k16', book: '选择性必修一', chapter: '3', kind: 'knowledge', title: '椭圆的定义与基本量', text: '$|PF_1|+|PF_2|=2a>2c$；$b^{2}=a^{2}-c^{2}$；离心率 $e=\\dfrac{c}{a}\\in(0,1)$，$e$ 越大越**扁**。' },
  { id: 'k17', book: '选择性必修一', chapter: '3', kind: 'knowledge', title: '双曲线的渐近线', text: '$\\dfrac{x^{2}}{a^{2}}-\\dfrac{y^{2}}{b^{2}}=1$ 的渐近线 $y=\\pm\\dfrac{b}{a}x$；$c^{2}=a^{2}+b^{2}$、$e=\\dfrac{c}{a}>1$。' },
  { id: 'k18', book: '选择性必修一', chapter: '3', kind: 'knowledge', title: '抛物线的焦点弦', text: '$y^{2}=2px$ 焦点 $\\left(\\dfrac{p}{2},0\\right)$、准线 $x=-\\dfrac{p}{2}$；焦点弦 $x_1+x_2+p$；通径 $2p$。' },
  { id: 'k19', book: '选择性必修一', chapter: '3', kind: 'warn', title: '联立后别忘判别式', text: '直线与圆锥曲线联立得一元二次方程后，**必须先写 $\\Delta>0$**（或对交点个数分类讨论），否则答案会多出"虚交"的情况。' },
  { id: 'k20', book: '选择性必修一', chapter: '1', kind: 'note', title: '设直线的小技巧', text: '过定点 $(x_0,y_0)$ 的直线：斜率存在时设 $y-y_0=k(x-x_0)$，**斜率不存在时单独验证**；或统一设 $x=my+x_0$ 免去讨论。' },
  { id: 'k21', book: '选择性必修二', chapter: '4', kind: 'knowledge', title: '等差与等比数列', text: '等差：$a_n=a_1+(n-1)d$、$S_n=\\dfrac{n(a_1+a_n)}{2}$；等比：$a_n=a_1q^{n-1}$、$S_n=\\dfrac{a_1(1-q^{n})}{1-q}\\,(q\\neq 1)$。' },
  { id: 'k22', book: '选择性必修二', chapter: '4', kind: 'knowledge', title: '裂项相消', text: '$\\dfrac{1}{n(n+1)}=\\dfrac{1}{n}-\\dfrac{1}{n+1}$；$\\dfrac{1}{\\sqrt{n}+\\sqrt{n+1}}=\\sqrt{n+1}-\\sqrt{n}$ —— 求和时中间项成对消掉 ✓。' },
  { id: 'k23', book: '选择性必修二', chapter: '5', kind: 'knowledge', title: '导数的几何意义', text: '$f\'(x_0)$ = 曲线在 $x_0$ 处切线斜率 ✓；切线方程 $y-f(x_0)=f\'(x_0)(x-x_0)$；**「在点处」与「过点」是两回事** ✗。' },
  { id: 'k24', book: '选择性必修二', chapter: '5', kind: 'knowledge', title: '导数与单调性、极值', text: '$f\'(x)>0$ 单增、$<0$ 单减；极值点处 $f\'(x)=0$ **且左右变号**；求最值要比较**极值点与端点**。' },
]

const KB_KEY = 'lj-mathslides-vue:handout-kb'

export function loadKb(): KbItem[] {
  let custom: KbItem[] = []
  try {
    const raw = localStorage.getItem(KB_KEY)
    if (raw) custom = (JSON.parse(raw) as KbItem[]).filter((x) => x && x.title)
  } catch { custom = [] }
  return [...KB_BUILTIN, ...custom]
}
export function saveKbCustom(list: KbItem[]) {
  try { localStorage.setItem(KB_KEY, JSON.stringify(list.filter((x) => x.custom))) } catch { /* 存不上不影响用 ✓ */ }
}
export function kbBlockOf(item: KbItem): HdBlock {
  const b = makeBlock(item.kind, item.text)
  b.kbTitle = item.title
  return b
}
