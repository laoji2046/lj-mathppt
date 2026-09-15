/**
 * OMML（Office Math Markup Language）→ LaTeX。
 *
 * 用途：PPT 导入时把 pptx 里的**原生公式**转成课件里的 \(...\) 公式。
 * 实测样张里 258 个公式全是 m:oMath ✓（那 61 个 WMF 只是 OLE 的预览图，不是内容）。
 *
 * 约定：
 * - **按局部名匹配**（m:oMath / oMath 都认）—— 不同生成器前缀可能不同；
 * - 只做**子集**：不认识的结构就退化成它的文字内容（不丢内容，只是排版降级）；
 * - 常见 Unicode 运算符映射成 LaTeX（样本里 ≥ ≤ ≠ × ÷ 这些是直接写成字符的）。
 */
import { parseXml, type XmlNode } from '@/docx/xml'

/** 去掉命名空间前缀：m:oMath → oMath */
function local(name: string): string {
  const i = name.indexOf(':')
  return i >= 0 ? name.slice(i + 1) : name
}

/** 直接子元素（按局部名筛） */
function kidsOf(n: XmlNode, name?: string): XmlNode[] {
  const out: XmlNode[] = []
  for (const k of n.kids) {
    if (typeof k === 'string') continue
    if (!name || local(k.name) === name) out.push(k)
  }
  return out
}
function kid(n: XmlNode, name: string): XmlNode | null {
  return kidsOf(n, name)[0] ?? null
}
/** 子树里的全部文字（m:t / a:t） */
function textOf(n: XmlNode): string {
  let s = ''
  for (const k of n.kids) {
    if (typeof k === 'string') { s += k; continue }
    const ln = local(k.name)
    if (ln === 't') s += k.kids.filter((x) => typeof x === 'string').join('')
    else s += textOf(k)
  }
  return s
}

/** Unicode 运算符/符号 → LaTeX（样本里这些是直接写成字符的） */
const CHAR_MAP: Record<string, string> = {
  '\u2264': '\\le ', '\u2265': '\\ge ', '\u2260': '\\ne ', '\u2248': '\\approx ',
  '\u00d7': '\\times ', '\u00f7': '\\div ', '\u22c5': '\\cdot ', '\u00b7': '\\cdot ',
  '\u2212': '-', '\u00b1': '\\pm ', '\u221e': '\\infty ', '\u221a': '\\sqrt ',
  '\u2208': '\\in ', '\u2209': '\\notin ', '\u2282': '\\subset ', '\u2286': '\\subseteq ',
  '\u222a': '\\cup ', '\u2229': '\\cap ', '\u2205': '\\varnothing ',
  '\u2192': '\\to ', '\u21d2': '\\Rightarrow ', '\u21d4': '\\Leftrightarrow ',
  '\u2234': '\\therefore ', '\u2235': '\\because ', '\u2200': '\\forall ', '\u2203': '\\exists ',
  '\u03b1': '\\alpha ', '\u03b2': '\\beta ', '\u03b3': '\\gamma ', '\u03b4': '\\delta ',
  '\u03b5': '\\varepsilon ', '\u03b8': '\\theta ', '\u03bb': '\\lambda ', '\u03bc': '\\mu ',
  '\u03c0': '\\pi ', '\u03c1': '\\rho ', '\u03c3': '\\sigma ', '\u03c6': '\\varphi ',
  '\u03c9': '\\omega ', '\u0394': '\\Delta ', '\u03a3': '\\Sigma ', '\u03a9': '\\Omega ',
}
/**
 * 数学字母数字符号 → ASCII。
 *
 * ⚠ OMML 里的字母常常是 **U+1D400 段的数学样式字符**（𝒂 = U+1D44E、𝟐 = U+1D7D0）✗ ——
 * MathJax **认不出这些码位**（会变成缺字方框）✓。所以统一压回 ASCII：
 * 样式（粗体/斜体/花体/双线…）由 LaTeX 自己表示，数学模式下本来就斜体 ✓，视觉上不丢。
 */
const MATH_BLOCKS: [number, number, number][] = [
  [0x1d400, 0x41, 26], [0x1d41a, 0x61, 26],   // 粗体
  [0x1d434, 0x41, 26], [0x1d44e, 0x61, 26],   // 斜体
  [0x1d468, 0x41, 26], [0x1d482, 0x61, 26],   // 粗斜体
  [0x1d49c, 0x41, 26], [0x1d4b6, 0x61, 26],   // 手写体
  [0x1d4d0, 0x41, 26], [0x1d4ea, 0x61, 26],   // 粗手写
  [0x1d504, 0x41, 26], [0x1d51e, 0x61, 26],   // 哥特
  [0x1d538, 0x41, 26], [0x1d552, 0x61, 26],   // 双线（黑板粗体）
  [0x1d56c, 0x41, 26], [0x1d586, 0x61, 26],   // 粗哥特
  [0x1d5a0, 0x41, 26], [0x1d5ba, 0x61, 26],   // 无衬线
  [0x1d5d4, 0x41, 26], [0x1d5ee, 0x61, 26],   // 粗无衬线
  [0x1d608, 0x41, 26], [0x1d622, 0x61, 26],   // 斜无衬线
  [0x1d63c, 0x41, 26], [0x1d656, 0x61, 26],   // 粗斜无衬线
  [0x1d670, 0x41, 26], [0x1d68a, 0x61, 26],   // 等宽
  [0x1d7ce, 0x30, 10], [0x1d7d8, 0x30, 10],   // 数字：粗体 / 双线
  [0x1d7e2, 0x30, 10], [0x1d7ec, 0x30, 10],   // 数字：无衬线 / 粗无衬线
  [0x1d7f6, 0x30, 10],                        // 数字：等宽
]
function normMathChar(cp: number): string | null {
  for (const [start, ascii, count] of MATH_BLOCKS) {
    if (cp >= start && cp < start + count) return String.fromCharCode(ascii + (cp - start))
  }
  return null
}
function normMathChars(s: string): string {
  let out = ''
  for (const ch of s) {
    const cp = ch.codePointAt(0)
    const rep = cp === undefined ? null : normMathChar(cp)
    out += rep ?? ch
  }
  return out
}

/** 转义 LaTeX 里会出事的字符（保留 \ 与 {} 这类结构字符不动） */
function esc(s: string): string {
  let out = ''
  for (const ch of normMathChars(s)) {
    if (CHAR_MAP[ch] !== undefined) { out += CHAR_MAP[ch]; continue }
    if (ch === '%' || ch === '#' || ch === '&') out += '\\' + ch
    else out += ch
  }
  return out
}

/** 花括号包一下（避免优先级问题） */
function wrap(s: string): string {
  return '{' + s + '}'
}

/**
 * 公式里的颜色：OMML 的 `m:r` 里可以带 `a:rPr/a:solidFill` ✗ ——
 * 实测样张公式内用了 **12 种颜色**（#1552D1 蓝×131、#FF0000 红×80 …），
 * 不还原的话整段公式会变成一色，跟原课件差很远 ✓。
 * 主题色板由调用方（pptxToDeck）在转换前塞进来（单线程，用模块级变量最省事 ✓）。
 */
let curTheme: Record<string, string> = {}
export function setOmmlTheme(t: Record<string, string>) { curTheme = t || {} }
/**
 * ⚠ 公式内颜色**暂缓（v1263 起默认关）**：
 * 实测样张公式内有 12 种颜色（#1552D1 蓝×131、#FF0000 红×80 …），本意是还原它们 ✓。
 * 但发到 MathJax 上两种写法都失败 ✗：
 *   \color{#ff0000}{…}      → "You can't use 'macro parameter character #' in math mode"
 *   \color[RGB]{255,0,0}{…} → 公式不渲染，原样显示 LaTeX 源码
 * 且给 tex 显式加 packages:[…,'color'] 也没解决 ✓。
 * 结论：本应用的 MathJax 环境里 \color 不可用，**保持关闭**，别让公式变坏 ✓。
 * 想再试的方向：(1) 查 useMathJax 的 MathJax 源是否裁剪过 color 扩展；
 *              (2) 改用 \textcolor / 自建宏；(3) 用 MathJax 的 CSS 变量方案。
 * 打开只需把 MATH_COLOR_ON 改成 true ✓（解析逻辑与主题色都已就绪 ✓）。
 */
const MATH_COLOR_ON = false
function mathColorOf(node: XmlNode | null): string | null {
  if (!node) return null
  const fill = (function f(n: XmlNode | null): XmlNode | null {
    if (!n) return null
    for (const k of n.kids) {
      if (typeof k === 'string') continue
      if (local(k.name) === 'solidFill') return k
      const d = f(k); if (d) return d
    }
    return null
  })(node)
  if (!fill) return null
  const srgb = (function g(n: XmlNode | null, name: string): XmlNode | null {
    if (!n) return null
    for (const k of n.kids) { if (typeof k === 'string') continue
      if (local(k.name) === name) return k; const d = g(k, name); if (d) return d }
    return null
  })
  const s = srgb(fill, 'srgbClr')
  if (s?.attrs['val']) return '#' + s.attrs['val'].toLowerCase()
  const sc = srgb(fill, 'schemeClr')
  if (sc?.attrs['val']) {
    const key = sc.attrs['val']
    const alias: Record<string, string> = { tx1: 'dk1', tx2: 'dk2', bg1: 'lt1', bg2: 'lt2' }
    return curTheme[key] || curTheme[alias[key]] || (key === 'tx1' ? '#000000' : null)
  }
  return null
}

/** 取某个子节点的 LaTeX（没有就空串） */
function sub(n: XmlNode | null): string {
  return n ? ommlNode(n) : ''
}

/** 把一段 OMML 转成 LaTeX */
function ommlNode(n: XmlNode): string {
  const nm = local(n.name)
  switch (nm) {
    // ---- 容器 ----
    case 'oMath': case 'oMathPara': case 'e': case 'num': case 'den':
    case 'sub': case 'sup': case 'fName': case 'lim':
    case 'box': case 'borderBox': case 'phant': case 'deg':
      return kidsOf(n).map(ommlNode).join('')
    case 'oMathParaPr': case 'ctrlPr': case 'rPr': case 'sSupPr': case 'sSubPr':
    case 'fPr': case 'radPr': case 'dPr': case 'naryPr': case 'funcPr':
    case 'accPr': case 'barPr': case 'groupChrPr': case 'mPr': case 'mrPr':
    case 'limLowPr': case 'limUppPr': case 'eqArrPr': case 'sSubSupPr':
    case 'sPrePr': case 'boxPr': case 'borderBoxPr': case 'phantPr':
      return ''   // 属性节点不产出内容

    // ---- 文字（带颜色时包一层 `\color{}` ✓）----
    case 'r': {
      const txt = esc(textOf(n))
      if (!txt) return ''
      const col = MATH_COLOR_ON ? mathColorOf(n) : null
      if (!col) return txt
      // ⚠ MathJax 的 \color **不认 CSS 的 #rrggbb** ✗（数学模式里 # 是宏参数符，
      //   会直接报 "macro parameter character #"。应用配置里还自定义了 \comb 这类带 #1 的宏 ✓）。
      //   必须用 color 扩展的 [RGB]{r,g,b} 写法 ✓。
      const m = /^#([0-9a-fA-F]{6})$/.exec(col)
      const spec = m
        ? '[RGB]{' + [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).join(',') + '}'
        : '{' + col + '}'
      return '\\color' + spec + '{' + txt + '}'
    }
    case 't': return esc(textOf(n))
    case 'br': return '\\\\ '   // 手动换行

    // ---- 分数 ----
    case 'f': return '\\frac' + wrap(sub(kid(n, 'num'))) + wrap(sub(kid(n, 'den')))

    // ---- 上下标 ----
    case 'sSup': return wrap(sub(kid(n, 'e'))) + '^' + wrap(sub(kid(n, 'sup')))
    case 'sSub': return wrap(sub(kid(n, 'e'))) + '_' + wrap(sub(kid(n, 'sub')))
    case 'sSubSup':
      return wrap(sub(kid(n, 'e'))) + '_' + wrap(sub(kid(n, 'sub'))) + '^' + wrap(sub(kid(n, 'sup')))
    case 'sPre':
      return wrap('') + '_' + wrap(sub(kid(n, 'sub'))) + '^' + wrap(sub(kid(n, 'sup'))) + wrap(sub(kid(n, 'e')))

    // ---- 根号 ----
    case 'rad': {
      const d = sub(kid(n, 'deg'))
      const e = sub(kid(n, 'e'))
      return d ? '\\sqrt[' + d + ']' + wrap(e) : '\\sqrt' + wrap(e)
    }

    // ---- 括号 ----
    case 'd': {
      const pr = kid(n, 'dPr')
      const beg = pr?.attrs['m:begChr'] ?? pr?.attrs['begChr'] ?? '('
      const end = pr?.attrs['m:endChr'] ?? pr?.attrs['endChr'] ?? ')'
      const inner = kidsOf(n, 'e').map(ommlNode).join('')
      const left = beg === '' ? '.' : beg
      const right = end === '' ? '.' : end
      return '\\left' + left + ' ' + inner + ' \\right' + right
    }

    // ---- 求和 / 积分 / 连乘 ----
    case 'nary': {
      const pr = kid(n, 'naryPr')
      const chr = pr?.attrs['m:chr'] ?? pr?.attrs['chr'] ?? '\u2211'
      const op = chr === '\u222b' ? '\\int' : chr === '\u220f' ? '\\prod' : chr === '\u222e' ? '\\oint' : '\\sum'
      const lo = sub(kid(n, 'sub'))
      const hi = sub(kid(n, 'sup'))
      const body = sub(kid(n, 'e'))
      return op + (lo ? '_' + wrap(lo) : '') + (hi ? '^' + wrap(hi) : '') + (body ? ' ' + body : '')
    }

    // ---- 函数名（sin / cos / ln …）----
    case 'func': {
      const name = esc(textOf(kid(n, 'fName') ?? n).trim())
      const arg = sub(kid(n, 'e'))
      const known = /^(sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|log|ln|lg|exp|max|min|lim|det|gcd)$/
      const head = known.test(name) ? '\\' + name + ' ' : esc(name)
      return head + arg
    }

    // ---- 上/下极限（lim 之类）----
    // 上下极限：lim/max/min 这类要写成 LaTeX 算符（lim 是正体，{lim} 会是斜体 ✗）
    case 'limLow': case 'limUpp': {
      const base = sub(kid(n, 'e')).trim()
      const opName = base.replace(/^\\/, '')
      const isOp = /^(lim|max|min|sup|inf|det|gcd|lg|ln|log)$/.test(opName)
      const head = isOp ? '\\' + opName : wrap(base)
      const mark = nm === 'limLow' ? '_' : '^'
      return head + mark + wrap(sub(kid(n, 'lim')))
    }

    // ---- 重音 / 上划线 ----
    case 'acc': {
      const pr = kid(n, 'accPr')
      const chr = pr?.attrs['m:chr'] ?? pr?.attrs['chr'] ?? '\u0302'
      const cmd = chr === '\u0304' ? '\\bar' : chr === '\u0307' ? '\\dot' : chr === '\u20d7' ? '\\vec' : '\\hat'
      return cmd + wrap(sub(kid(n, 'e')))
    }
    case 'bar': return '\\overline' + wrap(sub(kid(n, 'e')))
    case 'groupChr': {
      const pr = kid(n, 'groupChrPr')
      const pos = pr?.attrs['m:pos'] ?? pr?.attrs['pos'] ?? 'bot'
      return (pos === 'top' ? '\\overbrace' : '\\underbrace') + wrap(sub(kid(n, 'e')))
    }

    // ---- 矩阵 / 多行对齐 ----
    case 'm': {
      const rows = kidsOf(n, 'mr').map((r) => kidsOf(r, 'e').map(ommlNode).join(' & '))
      return '\\begin{matrix}' + rows.join(' \\\\ ') + '\\end{matrix}'
    }
    case 'eqArr': {
      const rows = kidsOf(n, 'e').map(ommlNode)
      return '\\begin{aligned}' + rows.join(' \\\\ ') + '\\end{aligned}'
    }

    default:
      // 不认识的结构：退化成它的文字/子内容（不丢内容，只是可能没排版）
      return kidsOf(n).length ? kidsOf(n).map(ommlNode).join('') : esc(textOf(n))
  }
}

/** 从一段 XML 里把所有 m:oMath / m:oMathPara 转成 LaTeX */
export function ommlToLatex(node: XmlNode): string {
  return ommlNode(node).replace(/\s+/g, ' ').trim()
}

/** 便捷入口：直接给 XML 文本 + 节点 */
export function ommlXmlToLatex(xml: string): string {
  const root = parseXml(xml)
  return ommlToLatex(root)
}