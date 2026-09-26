/**
 * TikZ → 应用图形（v1652）
 *
 * 为什么单开一个文件：**纯解析 + 求值**，不引 Vue / 不碰 DOM —— 于是能 esbuild 打包到 node 里
 * 直接跑用例（见 .probe/_tikz1.cjs），不用开应用点鼠标（跟定理图 / 韦恩图同一套验收办法）。
 *
 * 覆盖范围（用户确认过的那张表）：
 *   \draw[->] (-5,0) -- (5,0) node[right]{$x$}   → 不落元素：应用画圆锥曲线时**自带**坐标轴（箭头 + x/y/O）
 *   \draw plot(...) / circle(...) / ellipse(...) → 参数化圆锥曲线（**不采样成折线**，走 a/b/p/cx/cy/cr 参数）
 *   \fill (x,y) circle (1.5pt) node{$F_1$}       → 标注点（带字母、可拖）
 *   \draw (a) -- (b) [-- (c) -- cycle]           → 直线 / 线段（认 dashed；**竖直的走 v 参数**，见 mathPlot）
 *   \node at (x,y) {$A$}                         → 单独的文字元素（曲线图元里没有"自由文字"这一项）
 *   认不出的（axis / asy / 自定义宏 / 非圆锥曲线…）一律**不猜** → 返回失败，调用方退回 v1651 的占位行
 *
 * 关键决定（见 2026-09-25 日志第二十四节）：
 *   · 曲线**不采样成折线**：从 TikZ 的参数式解出 a/b/p，交给应用已有的圆锥曲线参数去画 —— 数学上干净、能改方程；
 *   · 输出**一个 mathfig 元素**（曲线 + 轴 + 点 + 线同框）；
 *   · 应用自带焦点小圆点与 F₁/F₂ 字母 → TikZ 若在同位置标了同名点，**去重**（不然图上会出现两个 F₂）。
 */

/** 一条线 / 弦：与 mathPlot 的 LINE_PARAMS 一一对应（vertical = true 时 m 是 x，s/e 是 **y**） */
export interface TikzLineSpec {
  k: number
  m: number
  s: number
  e: number
  dashed: boolean
  vertical: boolean
}

export interface TikzPointSpec { x: number; y: number; label: string | null }
export interface TikzTextSpec { x: number; y: number; text: string }

export interface TikzSpec {
  /** 应用的图形种类：conicCustomHyperbola / conicCustomEllipse / conicCustomEllipseV / conicCustomCircle / conicCustomParabola */
  kind: string
  params: Record<string, number>
  points: TikzPointSpec[]
  lines: TikzLineSpec[]
  texts: TikzTextSpec[]
  /** 曲线的一句话描述（给"插入结果"提示用） */
  curve: string
  /** 降级 / 忽略的说明 —— 会拼进插入提示，绝不假装全都译出来了 */
  notes: string[]
}

export type TikzParseResult = { ok: true; spec: TikzSpec } | { ok: false; reason: string }

/** 点 / 线 / 文字的硬上限（应用自己的模型上限，见 LINE_PARAMS / POINT_PARAMS） */
export const MAX_LINES = 4
export const MAX_POINTS = 6
const MAX_TEXTS = 8

interface Pt { x: number; y: number }

/* ===========================================================================
 * 1) 表达式求值（只求值，不做符号推导）
 * =========================================================================*/

const FUNCS: Record<string, (v: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp,
  ln: Math.log, log: Math.log, lg: (v) => Math.log10(v),
}
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E }

/** LaTeX 小表达式 → 可词法的普通表达式；认不出返回 null（绝不瞎猜） */
function normExpr(src: string): string | null {
  let s = String(src || '')
  s = s.replace(/\$/g, '')
  // \frac{a}{b} → ((a)/(b))
  for (let g = 0; g < 6; g++) {
    const m = s.match(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/)
    if (!m) break
    s = s.slice(0, m.index!) + '((' + m[1] + ')/(' + m[2] + '))' + s.slice(m.index! + m[0].length)
  }
  if (/\\frac/.test(s)) return null
  if (/\\sqrt\s*\[/.test(s)) return null                       // n 次根：不做
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, 'sqrt($1)')
  s = s.replace(/\\(?:left|right|displaystyle|limits|nolimits)\b/g, '')
  s = s.replace(/\\(?:cdot|times)\b/g, '*').replace(/\\div\b/g, '/')
  s = s.replace(/\\pi\b/g, 'pi')
  s = s.replace(/\\(?:mathrm|text|operatorname)\s*\{([^{}]*)\}/g, '$1')
  s = s.replace(/\\[,;!]/g, '').replace(/\\ /g, '')
  s = s.replace(/\\x\b/g, 'x').replace(/\\t\b/g, 't').replace(/\\y\b/g, 'y')   // TikZ 的循环变量
  if (/\\[a-zA-Z]+/.test(s)) return null                        // 还有认不出的宏 → 不做
  s = s.replace(/[{}]/g, (c) => (c === '{' ? '(' : ')'))
  return s
}

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string }
type Fn = (t: number) => number

function lex(s: string): Tok[] | null {
  const out: Tok[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue }
    if ((c >= '0' && c <= '9') || c === '.') {
      let j = i
      while (j < s.length && ((s[j] >= '0' && s[j] <= '9') || s[j] === '.')) j++
      const v = Number(s.slice(i, j))
      if (!isFinite(v)) return null
      out.push({ t: 'num', v }); i = j; continue
    }
    if (/[a-zA-Z]/.test(c)) {
      let j = i
      while (j < s.length && /[a-zA-Z]/.test(s[j])) j++
      out.push({ t: 'id', v: s.slice(i, j) }); i = j; continue
    }
    if ('+-*/^()'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue }
    return null
  }
  return out
}

/** \x、x、t 都当作**同名参数变量**（TikZ 里 plot 的循环变量就这几种写法） */
function compileFn(src: string, varName: string): Fn | null {
  const n1 = normExpr(src)
  if (n1 == null) return null
  const toks = lex(n1)
  if (!toks || !toks.length) return null
  let p = 0
  const peek = () => toks[p]
  const eat = (v: string) => { const t = toks[p]; if (t && t.t === 'op' && t.v === v) { p++; return true } return false }
  const startsAtom = () => { const t = toks[p]; if (!t) return false; return t.t === 'num' || t.t === 'id' || (t.t === 'op' && t.v === '(') }

  function parseSum(): Fn | null {
    const first = parseProduct()
    if (!first) return null
    let left: Fn = first
    for (;;) {
      if (eat('+')) { const r = parseProduct(); if (!r) return null; const l = left; left = (t: number) => l(t) + r(t) }
      else if (eat('-')) { const r = parseProduct(); if (!r) return null; const l = left; left = (t: number) => l(t) - r(t) }
      else return left
    }
  }
  function parseProduct(): Fn | null {
    const first = parseUnary()
    if (!first) return null
    let left: Fn = first
    for (;;) {
      if (eat('*')) { const r = parseUnary(); if (!r) return null; const l = left; left = (t: number) => l(t) * r(t) }
      else if (eat('/')) { const r = parseUnary(); if (!r) return null; const l = left; left = (t: number) => l(t) / r(t) }
      else if (startsAtom()) {                       // 隐式乘法：2x、3\cosh(x)、2(x+1)
        const r = parseUnary(); if (!r) return null; const l = left; left = (t: number) => l(t) * r(t)
      } else return left
    }
  }
  function parseUnary(): Fn | null {
    if (eat('-')) { const r = parseUnary(); return r ? (t) => -r(t) : null }
    if (eat('+')) return parseUnary()
    return parsePower()
  }
  function parsePower(): Fn | null {
    const base = parseAtom()
    if (!base) return null
    if (eat('^')) { const e = parseUnary(); if (!e) return null; const b: Fn = base; return (t: number) => Math.pow(b(t), e(t)) }
    return base
  }
  function parseAtom(): Fn | null {
    const t = peek()
    if (!t) return null
    if (t.t === 'num') { p++; const v = t.v; return () => v }
    if (t.t === 'id') {
      p++
      const name = t.v
      if (FUNCS[name]) {
        if (!eat('(')) return null
        const a = parseSum()
        if (!a || !eat(')')) return null
        const f = FUNCS[name]
        return (x) => f(a(x))
      }
      if (name === varName) return (x) => x
      if (name in CONSTS) { const v = CONSTS[name]; return () => v }
      return null                                     // 未知字母（参数 a、b…）：不做
    }
    if (eat('(')) { const a = parseSum(); if (!a || !eat(')')) return null; return a }
    return null
  }
  const fn = parseSum()
  if (!fn || p !== toks.length) return null
  return fn
}

/* ===========================================================================
 * 2) TikZ 命令切分 / 词法小工具
 * =========================================================================*/

/** 去掉 % 注释（\% 不算注释） */
function stripComments(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && i + 1 < s.length) { out += c + s[i + 1]; i++; continue }
    if (c === '%') { while (i < s.length && s[i] !== '\n') i++; out += '\n'; continue }
    out += c
  }
  return out
}

/** 按顶层 ';' 切命令（{}、[]、() 里的分号不算） */
function splitCommands(body: string): string[] {
  const out: string[] = []
  let cur = ''
  let dep = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '\\' && i + 1 < body.length) { cur += c + body[i + 1]; i++; continue }
    if (c === '{' || c === '[' || c === '(') dep++
    else if (c === '}' || c === ']' || c === ')') dep--
    if (c === ';' && dep <= 0) { out.push(cur); cur = ''; continue }
    cur += c
  }
  if (cur.trim()) out.push(cur)
  return out.map((s) => s.trim()).filter(Boolean)
}

/** 取命令名 + 紧跟的第一个 [...] 选项串 */
function headOf(cmd: string): { name: string; opts: string; rest: string } {
  const m = cmd.match(/^\s*\\([a-zA-Z]+)/)
  if (!m) return { name: '', opts: '', rest: cmd }
  let rest = cmd.slice(m[0].length)
  let opts = ''
  const t = rest.trimStart()
  const lead = rest.length - t.length
  if (t.startsWith('[')) {
    let dep = 0, j = 0
    for (; j < t.length; j++) {
      if (t[j] === '[') dep++
      else if (t[j] === ']') { dep--; if (!dep) { j++; break } }
    }
    opts = t.slice(1, j - 1)
    rest = rest.slice(0, lead) + t.slice(j)
  }
  return { name: m[1], opts, rest }
}

/** 取出一段平衡的 {...} 内容（i0 指向 '{'） */
function braceAt(s: string, i0: number): { inner: string; end: number } | null {
  if (s[i0] !== '{') return null
  let dep = 0
  for (let i = i0; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue }
    if (s[i] === '{') dep++
    else if (s[i] === '}') { dep--; if (!dep) return { inner: s.slice(i0 + 1, i), end: i + 1 } }
  }
  return null
}

/** 顶层切分（sep 是单个字符或整个词） */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = []
  let cur = '', dep = 0, i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '\\') { cur += c + (s[i + 1] || ''); i += 2; continue }
    if (c === '{' || c === '[' || c === '(') dep++
    else if (c === '}' || c === ']' || c === ')') dep--
    if (dep <= 0 && s.startsWith(sep, i)) { out.push(cur); cur = ''; i += sep.length; continue }
    cur += c; i++
  }
  out.push(cur)
  return out
}

function num(s: string): number | null {
  const t = String(s).trim().replace(/(cm|mm|pt|ex|em)$/, '')
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return null
  const v = Number(t)
  return isFinite(v) ? v : null
}

/** "(1.5,-2)" → 坐标；"(A)" → 具名坐标；不是坐标写法 → undefined */
function parseCoordTok(s: string, names: Map<string, Pt>): Pt | null | undefined {
  const t = String(s || '').trim()
  if (!t.startsWith('(') || !t.endsWith(')')) return undefined
  const inner = t.slice(1, -1)
  if (inner.includes('(')) return undefined
  const parts = splitTop(inner, ',')
  if (parts.length === 2) {
    const x = num(parts[0]), y = num(parts[1])
    if (x != null && y != null) return { x, y }
    return undefined
  }
  if (parts.length === 1) {
    const nm = inner.trim()
    if (names.has(nm)) return names.get(nm)!
  }
  return undefined
}

/* ===========================================================================
 * 3) 曲线：采样 → 拟合（最小二乘 + 残差校验）
 * =========================================================================*/

interface Cand { pts: Pt[]; label: string }

/** 圆锥曲线的标准型拟合（都以原点为中心）：残差最低且"像"的那个才算认出来 */
function fitConic(pts: Pt[]): { kind: string; params: Record<string, number>; curve: string; res: number } | null {
  if (pts.length < 5) return null
  const scale = Math.max(1e-6, ...pts.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))))
  const ls2 = (f: (p: Pt) => [number, number]) => {
    let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0
    for (const p of pts) {
      const [u, v] = f(p)
      a11 += u * u; a12 += u * v; a22 += v * v; b1 += u; b2 += v
    }
    const det = a11 * a22 - a12 * a12
    if (Math.abs(det) < 1e-12) return null
    return { u: (b1 * a22 - b2 * a12) / det, v: (a11 * b2 - a12 * b1) / det }
  }
  const ls1 = (f: (p: Pt) => [number, number]) => {
    let suu = 0, suv = 0
    for (const p of pts) { const [u, v] = f(p); suu += u * u; suv += u * v }
    if (suu < 1e-12) return null
    return suv / suu
  }
  const maxRes = (g: (p: Pt) => number) => Math.max(...pts.map((p) => Math.abs(g(p))))
  const out: { kind: string; params: Record<string, number>; curve: string; res: number }[] = []

  // ① 椭圆（含圆）：x²u + y²v = 1
  const el = ls2((p) => [p.x * p.x, p.y * p.y])
  if (el && el.u > 0 && el.v > 0) {
    const A = 1 / Math.sqrt(el.u), B = 1 / Math.sqrt(el.v)
    const res = maxRes((p) => p.x * p.x * el.u + p.y * p.y * el.v - 1)
    if (Math.abs(A - B) < 1e-3 * Math.max(A, B)) {
      const r0 = +((A + B) / 2).toFixed(4)
      out.push({ kind: 'conicCustomCircle', params: { cx: 0, cy: 0, cr: r0 }, curve: '圆 r=' + r0, res })
    } else if (A >= B) {
      out.push({ kind: 'conicCustomEllipse', params: { a: +A.toFixed(4), b: +B.toFixed(4) }, curve: '椭圆 a=' + A.toFixed(3) + ' b=' + B.toFixed(3), res })
    } else {
      out.push({ kind: 'conicCustomEllipseV', params: { a: +B.toFixed(4), b: +A.toFixed(4) }, curve: '椭圆（长轴在 y 轴）a=' + B.toFixed(3) + ' b=' + A.toFixed(3), res })
    }
  }
  // ② 双曲线 x²u − y²v = 1（实轴在 x）
  const hx = ls2((p) => [p.x * p.x, -p.y * p.y])
  if (hx && hx.u > 0 && hx.v > 0) {
    const a = 1 / Math.sqrt(hx.u), b = 1 / Math.sqrt(hx.v)
    out.push({ kind: 'conicCustomHyperbola', params: { a: +a.toFixed(4), b: +b.toFixed(4) }, curve: '双曲线 a=' + a.toFixed(3) + ' b=' + b.toFixed(3), res: maxRes((p) => p.x * p.x * hx.u - p.y * p.y * hx.v - 1) })
  }
  // ③ 双曲线 y²u − x²v = 1（实轴在 y）
  const hy = ls2((p) => [p.y * p.y, -p.x * p.x])
  if (hy && hy.u > 0 && hy.v > 0) {
    const a = 1 / Math.sqrt(hy.u), b = 1 / Math.sqrt(hy.v)
    out.push({ kind: 'conicCustomHyperbola', params: { a: +a.toFixed(4), b: +b.toFixed(4) }, curve: '双曲线（实轴在 y 轴）a=' + a.toFixed(3) + ' b=' + b.toFixed(3), res: maxRes((p) => p.y * p.y * hy.u - p.x * p.x * hy.v - 1) })
  }
  // ④ 抛物线：x = w·y²（左右）或 y = w·x²（上下）
  const wR = ls1((p) => [p.y * p.y, p.x])
  if (wR != null && Math.abs(wR) > 1e-9) {
    const p2 = 1 / (2 * Math.abs(wR)), dir = wR > 0 ? 1 : 3
    out.push({ kind: 'conicCustomParabola', params: { p: +p2.toFixed(4), dir }, curve: '抛物线（开口' + (dir === 1 ? '右' : '左') + '）p=' + p2.toFixed(3), res: maxRes((p) => p.x - wR * p.y * p.y) })
  }
  const wU = ls1((p) => [p.x * p.x, p.y])
  if (wU != null && Math.abs(wU) > 1e-9) {
    const p2 = 1 / (2 * Math.abs(wU)), dir = wU > 0 ? 2 : 4
    out.push({ kind: 'conicCustomParabola', params: { p: +p2.toFixed(4), dir }, curve: '抛物线（开口' + (dir === 2 ? '上' : '下') + '）p=' + p2.toFixed(3), res: maxRes((p) => p.y - wU * p.x * p.x) })
  }
  const ok = out.filter((c) => c.res < 5e-3 * scale * scale)
  if (!ok.length) return null
  ok.sort((m, n) => m.res - n.res)
  return ok[0]
}

/* ===========================================================================
 * 4) 主解析
 * =========================================================================*/

const RE_TIKZ = /\\begin\{tikzpicture\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{tikzpicture\}/g

const SUB: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎' }
const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ' }

/** 把 TikZ 的标签（$F_1$）变成应用里能直接显示的文字（F₁） */
export function tikzLabelToText(raw: string): string {
  let s = String(raw || '')
  s = s.replace(/\$/g, '')
  s = s.replace(/\\(?:mathrm|text|mathit|mathbf|boldsymbol)\s*\{([^{}]*)\}/g, '$1')
  s = s.replace(/\\(?:left|right)\b/g, '')
  s = s.replace(/\\prime/g, '′').replace(/\\circ/g, '°')
  s = s.replace(/\\alpha/g, 'α').replace(/\\beta/g, 'β').replace(/\\gamma/g, 'γ').replace(/\\theta/g, 'θ')
  s = s.replace(/\\([a-zA-Z]+)/g, '$1')                       // 其余宏：退化成它的名字（宁可显示出来也不吞掉）
  s = s.replace(/_\{([^{}]*)\}/g, (_, g: string) => [...g].map((c) => SUB[c] ?? c).join(''))
  s = s.replace(/_(\S)/g, (_, c: string) => SUB[c] ?? c)
  s = s.replace(/\^\{([^{}]*)\}/g, (_, g: string) => [...g].map((c) => SUP[c] ?? c).join(''))
  s = s.replace(/\^(\S)/g, (_, c: string) => SUP[c] ?? c)
  return s.replace(/\s+/g, ' ').trim()
}

/** 两个标签是不是"同一个"（F_1 / F1 / F₁ 都算） */
function sameLabel(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const n = (s: string) => tikzLabelToText(s).replace(/[\s_^{}]/g, '').toUpperCase()
  return n(a) === n(b)
}

/** 应用画某类曲线时**自带**的点与字母（TikZ 在同位置标了同名点就去重） */
function builtinMarks(kind: string, p: Record<string, number>): { x: number; y: number; label: string }[] {
  const out: { x: number; y: number; label: string }[] = []
  if (kind === 'conicCustomHyperbola' || kind === 'conicCustomEllipse') {
    const a = p.a || 3, b = p.b || 2
    const c = Math.sqrt(kind === 'conicCustomHyperbola' ? a * a + b * b : Math.max(0, a * a - b * b))
    out.push({ x: -c, y: 0, label: 'F₁' }, { x: c, y: 0, label: 'F₂' })
  } else if (kind === 'conicCustomEllipseV') {
    const a = p.a || 4, b = p.b || 3
    const c = Math.sqrt(Math.max(0, a * a - b * b))
    out.push({ x: 0, y: -c, label: 'F₁' }, { x: 0, y: c, label: 'F₂' })
  } else if (kind === 'conicCustomCircle') {
    out.push({ x: p.cx || 0, y: p.cy || 0, label: '' })
  } else if (kind === 'conicCustomParabola') {
    const pp = p.p || 4, dir = Math.round(p.dir || 1)
    const map = (x: number, y: number): Pt => (dir === 2 ? { x: y, y: x } : dir === 3 ? { x: -x, y } : dir === 4 ? { x: y, y: -x } : { x, y })
    const f = map(pp / 2, 0)
    out.push({ x: f.x, y: f.y, label: 'F' })
  }
  return out
}

export function parseTikzPicture(src: string): TikzParseResult {
  const raw = String(src || '')
  const m = raw.match(/\\begin\{tikzpicture\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{tikzpicture\}/)
  const body = stripComments(m ? m[1] : raw.replace(/\\begin\{tikzpicture\}(\[[^\]]*\])?/, '').replace(/\\end\{tikzpicture\}/, ''))
  if (!body.trim()) return { ok: false, reason: '图里是空的' }
  if (/\\begin\{(axis|asy|semilogyaxis|loglogaxis)\}/.test(body)) return { ok: false, reason: 'pgfplots / Asymptote 环境不支持' }
  if (/\\foreach|\\def\b|\\newcommand|\\tikzset|\\clip|\\shade\b|\\path\s+let\b|pattern\s*=/.test(body)) {
    return { ok: false, reason: '用到了宏定义 / 循环 / 裁剪等高级写法，认不准就不猜' }
  }
  if (/rotate\s*=/.test(body)) return { ok: false, reason: '图形带旋转，应用里的圆锥曲线只能正放' }

  const names = new Map<string, Pt>()
  const cands: Cand[] = []
  const pts: TikzPointSpec[] = []
  const lines: TikzLineSpec[] = []
  const texts: TikzTextSpec[] = []
  const notes: string[] = []
  let circleDirect: { cx: number; cy: number; r: number } | null = null

  const segOf = (A: Pt, B: Pt, dashed: boolean): TikzLineSpec => {
    if (Math.abs(A.x - B.x) < 1e-9) return { k: 0, m: A.x, s: Math.min(A.y, B.y), e: Math.max(A.y, B.y), dashed, vertical: true }
    const k = (B.y - A.y) / (B.x - A.x)
    return { k: +k.toFixed(6), m: +(A.y - k * A.x).toFixed(6), s: +Math.min(A.x, B.x).toFixed(4), e: +Math.max(A.x, B.x).toFixed(4), dashed, vertical: false }
  }

  for (const cmd of splitCommands(body)) {
    const { name, opts, rest } = headOf(cmd)
    if (!name) continue
    const restT = rest.trim()

    if (name === 'coordinate' || name === 'path') {
      const mm = restT.match(/^\(([^()]*)\)\s*(?:at|coordinate)\s*(\([^()]*\))/)
      if (!mm) return { ok: false, reason: '认不出的 \\' + name + ' 写法：' + restT.slice(0, 30) }
      const c = parseCoordTok(mm[2], names)
      if (!c) return { ok: false, reason: '坐标 ' + mm[2] + ' 认不出（可能是算式坐标）' }
      if (name === 'coordinate') names.set(mm[1].trim(), c)
      else names.set(mm[2].slice(1, -1).trim(), c)
      continue
    }

    if (name === 'node') {
      let nodeName: string | null = null
      let body2 = restT
      const nm = restT.match(/^\(([^()]*)\)\s*(?:\[[^\]]*\]\s*)?at\b/)
      if (nm) { nodeName = nm[1].trim(); body2 = restT.slice(nm[0].length) }
      body2 = body2.replace(/^\s*at\b/, '')                 // \node at (x,y) [选项] {文字} 这种写法
      const at = body2.match(/^\s*(\([^()]*\))/)
      if (!at) { notes.push('忽略了一个没有坐标的 \\node'); continue }
      const c = parseCoordTok(at[1], names)
      if (!c) return { ok: false, reason: '\\node 的坐标 ' + at[1] + ' 认不出' }
      const bra = restT.indexOf('{')
      const txt = bra >= 0 ? (braceAt(restT, bra)?.inner ?? '') : ''
      if (nodeName) names.set(nodeName, c)
      const isDot = /(^|,)\s*circle\s*(,|$)/.test(opts) && /fill|ball color/.test(opts)
      const label = tikzLabelToText(txt)
      if (isDot) pts.push({ x: c.x, y: c.y, label: label || null })
      else texts.push({ x: c.x, y: c.y, text: label })
      continue
    }

    if (name === 'draw' || name === 'fill' || name === 'filldraw') {
      const dashed = /(^|,)\s*(dashed|densely dashed|loosely dashed|dotted|densely dotted|dash pattern\s*=)/.test(opts)
      const arrowed = /(->|<-|<->|-latex|-stealth|latex-|stealth-|-triangle 45)/.test(opts)
      const dotLike = name === 'fill' || name === 'filldraw' || /(^|,)\s*fill\s*=/.test(opts)

      // ① plot：参数式 / 函数式曲线
      if (/\bplot\b/.test(restT)) {
        const o2 = restT.match(/plot\s*\[([^\]]*)\]/)
        const all = [opts, o2 ? o2[1] : ''].join(',')
        const dm = all.match(/domain\s*=\s*([^,\]]+)/)
        let t0 = -5, t1 = 5
        if (dm) {
          const parts = dm[1].split(':')
          const a = num(parts[0]), b = num(parts[1] ?? '')
          if (a == null || b == null) return { ok: false, reason: 'plot 的 domain 认不出：' + dm[1] }
          t0 = a; t1 = b
        }
        const pi0 = restT.indexOf('plot')
        const par = restT.indexOf('(', pi0)
        if (par < 0) return { ok: false, reason: 'plot 后面没有参数式（只认 plot (x(t),y(t))）' }
        let dep = 0, end = -1
        for (let i = par; i < restT.length; i++) {
          if (restT[i] === '(') dep++
          else if (restT[i] === ')') { dep--; if (!dep) { end = i; break } }
        }
        if (end < 0) return { ok: false, reason: 'plot 的参数式括号不配对' }
        const inner = restT.slice(par + 1, end)
        const two = splitTop(inner, ',')
        if (two.length !== 2) return { ok: false, reason: 'plot 只认 (x(t),y(t)) 两段式' }
        const both = two[0] + ',' + two[1]
        const varName = /\\x\b|\\x[^a-zA-Z]/.test(both) || /(^|[^a-zA-Z])x([^a-zA-Z]|$)/.test(both) ? 'x'
          : /\\t\b|\\t[^a-zA-Z]/.test(both) || /(^|[^a-zA-Z])t([^a-zA-Z]|$)/.test(both) ? 't' : null
        if (!varName) return { ok: false, reason: 'plot 的循环变量认不出（只认 \\x / x / t）' }
        const fx = compileFn(two[0], varName), fy = compileFn(two[1], varName)
        if (!fx || !fy) return { ok: false, reason: 'plot 的表达式里有认不出的符号：' + inner.trim().slice(0, 40) }
        const samples: Pt[] = []
        const N = 81
        for (let i = 0; i <= N; i++) {
          const t = t0 + ((t1 - t0) * i) / N
          const x = fx(t), y = fy(t)
          if (isFinite(x) && isFinite(y)) samples.push({ x, y })
        }
        if (samples.length < 5) return { ok: false, reason: 'plot 采不到有效点' }
        cands.push({ pts: samples, label: 'plot' })
        continue
      }

      // ② circle / ellipse（半径带单位 = 那是"点"，不是圆）
      const cir = restT.match(/^\s*(\([^()]*\))\s*circle\s*\(\s*([^()]*)\)/)
      if (cir) {
        const c = parseCoordTok(cir[1], names)
        if (!c) return { ok: false, reason: 'circle 的圆心认不出' }
        const unit = /(cm|mm|pt|ex|em)\s*$/.test(cir[2].trim())
        const rr = num(cir[2])
        if (rr == null) return { ok: false, reason: 'circle 的半径认不出：' + cir[2] }
        if (unit) {
          const lbl = restT.match(/node\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/)
          pts.push({ x: c.x, y: c.y, label: lbl ? (tikzLabelToText(lbl[1]) || null) : null })
          continue
        }
        if (rr <= 0) return { ok: false, reason: 'circle 的半径不是正数' }
        if (circleDirect) return { ok: false, reason: '图里有不止一个整圆（应用的一张图只画一条圆锥曲线）' }
        circleDirect = { cx: c.x, cy: c.y, r: rr }
        continue
      }
      const ell = restT.match(/^\s*(\([^()]*\))\s*ellipse\s*\(\s*([^()]*)\)/)
      if (ell) {
        const c = parseCoordTok(ell[1], names)
        if (!c) return { ok: false, reason: 'ellipse 的圆心认不出' }
        const ab = splitTop(ell[2], 'and').map((s) => num(s))
        if (ab.length !== 2 || ab[0] == null || ab[1] == null) return { ok: false, reason: 'ellipse 的 (a and b) 认不出' }
        if (Math.abs(c.x) > 1e-9 || Math.abs(c.y) > 1e-9) return { ok: false, reason: '椭圆圆心不在原点（应用里的圆锥曲线只画居中的）' }
        const samples: Pt[] = []
        for (let i = 0; i < 64; i++) {
          const t = (Math.PI * 2 * i) / 64
          samples.push({ x: ab[0]! * Math.cos(t), y: ab[1]! * Math.sin(t) })
        }
        cands.push({ pts: samples, label: 'ellipse' })
        continue
      }

      // ③ 线段 / 折线： (a) -- (b) [-- (c) -- cycle]
      if (/\+\+\s*\(|(^|[^+\d.])\+\s*\(/.test(restT)) return { ok: false, reason: '用了相对坐标（+ / ++），应用里的图形是绝对坐标' }
      const segs = splitTop(restT, '--')
      const nodesP: (Pt | null)[] = []
      let sawCycle = false
      let lineNote = false
      for (const sgm of segs) {
        const t = sgm.trim()
        if (/^cycle\b/.test(t)) { sawCycle = true; continue }
        const mt = t.match(/^\s*(\([^()]*\))/)
        if (!mt) {
          if (/\bnode\b/.test(t)) { lineNote = true; continue }
          if (!t) continue
          return { ok: false, reason: '路径里的坐标认不出：' + t.slice(0, 24) }
        }
        const c = parseCoordTok(mt[1], names)
        if (!c) return { ok: false, reason: '坐标 ' + mt[1] + ' 认不出（可能是算式坐标或未定义的具名点）' }
        if (/\bnode\b/.test(t.slice(mt[1].length))) lineNote = true
        nodesP.push(c)
      }
      const clean = nodesP.filter((p): p is Pt => !!p)
      if (clean.length >= 2 || (clean.length === 1 && sawCycle)) {
        if (arrowed && clean.length === 2) {
          const [A, B] = clean
          const horiz = Math.abs(A.y) < 1e-9 && Math.abs(B.y) < 1e-9
          const vert = Math.abs(A.x) < 1e-9 && Math.abs(B.x) < 1e-9
          if (horiz || vert) continue                        // 坐标轴：应用自带，不落元素
        }
        if (lineNote) notes.push('线段上的文字标注没能带进来')
        for (let i = 1; i < clean.length; i++) lines.push(segOf(clean[i - 1], clean[i], dashed))
        if (sawCycle && clean.length >= 2) lines.push(segOf(clean[clean.length - 1], clean[0], dashed))
        continue
      }
      return { ok: false, reason: '认不出的' + (dotLike ? '填充' : '绘图') + '命令：' + cmd.slice(0, 40) }
    }
    return { ok: false, reason: '不认识的命令 \\' + name }
  }

  /* ---- 定曲线 ---- */
  let kind = ''
  let params: Record<string, number> = {}
  let curve = ''
  if (circleDirect && !cands.length) {
    kind = 'conicCustomCircle'
    params = { cx: +circleDirect.cx.toFixed(4), cy: +circleDirect.cy.toFixed(4), cr: +circleDirect.r.toFixed(4) }
    curve = '圆 r=' + circleDirect.r.toFixed(3)
  } else {
    const fit = fitConic(cands.flatMap((c) => c.pts))
    if (!fit) return { ok: false, reason: '没认出圆锥曲线（只认椭圆 / 圆 / 双曲线 / 抛物线的标准参数式）' }
    kind = fit.kind; params = fit.params; curve = fit.curve
  }

  /* ---- 去重：应用自带的焦点 / 圆心点 ---- */
  const builtin = builtinMarks(kind, params)
  const keptPts: TikzPointSpec[] = []
  let dedup = 0
  for (const p of pts) {
    // 位置对得上 **且**（TikZ 这个点没字母，或字母跟自带的一致）→ 才算重复
    const hit = builtin.find((b) => Math.hypot(b.x - p.x, b.y - p.y) < 1e-3 * (1 + Math.abs(b.x) + Math.abs(b.y)))
    const dup = !!hit && (!p.label || (!!hit.label && sameLabel(hit.label, p.label)))
    if (dup) { dedup++; continue }
    keptPts.push(p)
  }
  if (dedup) notes.push('图里自带的 ' + dedup + ' 个焦点/圆心点按图形自带标记画了（没重复画）')
  // 应用画椭圆 / 双曲线时**自带**焦点标注：TikZ 标了就用自带的（已去重），没标就别硬加（foci=0）✓
  if (kind === 'conicCustomEllipse' || kind === 'conicCustomEllipseV' || kind === 'conicCustomHyperbola') {
    params.foci = dedup > 0 ? 1 : 0
  }

  /* ---- 渐近线 / 准线 / 轴：并进图形自带的参数，别占"线"的名额 ---- */
  const keptLines: TikzLineSpec[] = []
  for (const L of lines) {
    if (kind === 'conicCustomHyperbola') {
      if (!L.vertical && Math.abs(L.m) < 1e-6) {
        const b2a = (params.b || 0) / (params.a || 1)
        if (Math.abs(Math.abs(L.k) - b2a) < 1e-4 * (1 + b2a)) { params.aline = 1; continue }     // 渐近线
      }
      const a0 = params.a || 0, b0 = params.b || 0
      const c0 = Math.sqrt(a0 * a0 + b0 * b0)
      const dx0 = c0 > 1e-9 ? (a0 * a0) / c0 : 0
      if (L.vertical && Math.abs(Math.abs(L.m) - dx0) < 1e-4 * (1 + dx0)) { params.dline = 1; continue }  // 准线
    }
    if ((kind === 'conicCustomEllipse' || kind === 'conicCustomEllipseV' || kind === 'conicCustomCircle') && !L.vertical && Math.abs(L.m) < 1e-6 && Math.abs(L.k) < 1e-6) {
      continue                                                  // 长轴：椭圆图元自己画
    }
    if (kind === 'conicCustomParabola') {
      const pp = params.p || 4, dir = Math.round(params.dir || 1)
      const dx = pp / 2
      if (dir === 1 || dir === 3) { if (L.vertical && Math.abs(L.m + (dir === 1 ? dx : -dx)) < 1e-6 * (1 + dx)) { params.dline = 1; continue } }
      else if (!L.vertical && Math.abs(L.k) < 1e-6 && Math.abs(L.m + (dir === 2 ? dx : -dx)) < 1e-6 * (1 + dx)) { params.dline = 1; continue }
    }
    keptLines.push(L)
  }
  if (kind === 'conicCustomParabola' && params.dline == null) params.dline = 0   // 没画准线就别自作主张加上
  if (params.aline) notes.push('渐近线按图形自带的参数画（可在属性面板关掉）')
  if (params.dline) notes.push('准线按图形自带的参数画（可在属性面板关掉）')

  if (keptLines.length > MAX_LINES) { notes.push('线太多，只带了前 ' + MAX_LINES + ' 条'); keptLines.length = MAX_LINES }
  if (keptPts.length > MAX_POINTS) { notes.push('标注点太多，只带了前 ' + MAX_POINTS + ' 个'); keptPts.length = MAX_POINTS }
  const keptTexts = texts.filter((t) => t.text && !/^[xyO]$/.test(t.text.trim()))
  if (keptTexts.length > MAX_TEXTS) { notes.push('文字太多，只带了前 ' + MAX_TEXTS + ' 条'); keptTexts.length = MAX_TEXTS }

  for (let i = 0; i < keptLines.length; i++) {
    const L = keptLines[i]
    params['k' + (i + 1)] = L.k
    params['m' + (i + 1)] = L.m
    params['s' + (i + 1)] = L.s
    params['e' + (i + 1)] = L.e
    params['d' + (i + 1)] = L.dashed ? 1 : 0
    params['v' + (i + 1)] = L.vertical ? 1 : 0
  }
  params.n = keptLines.length
  for (let i = 0; i < keptPts.length; i++) {
    params['px' + (i + 1)] = +keptPts[i].x.toFixed(4)
    params['py' + (i + 1)] = +keptPts[i].y.toFixed(4)
    params['ps' + (i + 1)] = 1
  }
  params.pn = keptPts.length
  // 曲线自带的 a=/b= 标注：题图上一般不印 → 关掉（椭圆本来就有这开关，双曲线的同名开关是本轮加的）
  if (kind !== 'conicCustomCircle' && kind !== 'conicCustomParabola') params.ab = 0

  return { ok: true, spec: { kind, params, points: keptPts, lines: keptLines, texts: keptTexts, curve, notes } }
}

/* ===========================================================================
 * 5) 批量替换：AI 回答里的 tikzpicture → 图片占位（随后换成真图形元素）
 * =========================================================================*/

/** 认不出的占位行（与 v1651 同一条口径） */
export function tikzPlaceholderText(reason: string): string {
  return '（此处 AI 给的 TikZ 图没能译成图形：' + reason + '；建议用「数学图形」库插一张对应的图，或截图后走「图片转图形」）'
}

export interface TikzSplit {
  /** 替换后的 markdown：认得出的写成 ![](tikz:N)，认不出的写成一行占位文字 */
  md: string
  specs: TikzSpec[]
  fails: string[]
}

/**
 * 把 markdown 里的每个 tikzpicture 环境换掉：
 *   译得出 → 独占一行的图片占位（应用自己的 markdown 导入会把它落成一个图片元素，
 *             随后由 attachTikzFigures 换成真正的图形元素，位置就落在同一处）
 *   译不出 → 一行占位文字（不硬猜）
 */
export function tikzToPlaceholders(md: string): TikzSplit {
  const specs: TikzSpec[] = []
  const fails: string[] = []
  const out = String(md || '').replace(RE_TIKZ, (whole) => {
    const r = parseTikzPicture(whole)
    if (r.ok) { specs.push(r.spec); return '\n![](tikz:' + (specs.length - 1) + ')\n' }
    fails.push(r.reason)
    return '\n' + tikzPlaceholderText(r.reason) + '\n'
  })
  return { md: out, specs, fails }
}
