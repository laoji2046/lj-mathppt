/**
 * OMML（Word 公式）→ LaTeX
 *
 * 为什么自己写：docx 里的公式是 OMML，Word 导出 HTML/RTF 会把它变成图片或丢结构；
 * 而 OMML 本身是结构化的 XML，映射到 LaTeX 是可靠的（而且不用装任何东西）。
 *
 * 约定：源码里不出现反斜杠 —— LaTeX 命令统一由 BS 拼出来（CMD 表），
 * 这样文件里既没有转义地狱，也能一眼看出都用到了哪些命令。
 */
import { kids } from './xml.mjs'

const BS = String.fromCharCode(92)

/** LaTeX 命令表（唯一出现命令名的地方） */
const CMD = {
  frac: 'frac', sqrt: 'sqrt', left: 'left', right: 'right', begin: 'begin', end: 'end',
  text: 'text', mathrm: 'mathrm', middle: 'middle',
  sum: 'sum', prod: 'prod', int: 'int', oint: 'oint', lim: 'lim',
  vec: 'vec', hat: 'hat', bar: 'bar', dot: 'dot', ddot: 'ddot', tilde: 'tilde',
  overline: 'overline', underline: 'underline', overbrace: 'overbrace', underbrace: 'underbrace',
}
/** 反斜杠 + 命令 */
const c = (name) => BS + CMD[name]

/** 单个字符 / 符号 → LaTeX（Word 里常直接写 Unicode 数学符号） */
const SYM = {
  '\u00d7': BS + 'times', '\u00f7': BS + 'div', '\u00b1': BS + 'pm', '\u2213': BS + 'mp',
  '\u2264': BS + 'le', '\u2265': BS + 'ge', '\u2260': BS + 'ne', '\u2248': BS + 'approx',
  '\u2261': BS + 'equiv', '\u221e': BS + 'infty', '\u2211': BS + 'sum', '\u220f': BS + 'prod',
  '\u222b': BS + 'int', '\u222e': BS + 'oint', '\u221a': BS + 'sqrt',
  '\u00b7': BS + 'cdot', '\u22c5': BS + 'cdot', '\u22ef': BS + 'cdots', '\u2026': BS + 'ldots',
  '\u2192': BS + 'to', '\u21d2': BS + 'Rightarrow', '\u21d4': BS + 'Leftrightarrow',
  '\u2208': BS + 'in', '\u2209': BS + 'notin', '\u2286': BS + 'subseteq', '\u2282': BS + 'subset',
  '\u222a': BS + 'cup', '\u2229': BS + 'cap', '\u2205': BS + 'varnothing',
  '\u22a5': BS + 'perp', '\u2225': BS + 'parallel', '\u2220': BS + 'angle', '\u25b3': BS + 'triangle',
  '\u2200': BS + 'forall', '\u2203': BS + 'exists', '\u221d': BS + 'propto',
  '\u03b1': BS + 'alpha', '\u03b2': BS + 'beta', '\u03b3': BS + 'gamma', '\u03b4': BS + 'delta',
  '\u03b8': BS + 'theta', '\u03bb': BS + 'lambda', '\u03bc': BS + 'mu', '\u03c0': BS + 'pi',
  '\u03c1': BS + 'rho', '\u03c3': BS + 'sigma', '\u03c6': BS + 'phi', '\u03c9': BS + 'omega',
  '\u0394': BS + 'Delta', '\u03a3': BS + 'Sigma', '\u03a9': BS + 'Omega', '\u03a6': BS + 'Phi',
  '\u2212': '-', '\u2013': '-', '\u2014': '-', '\u2018': "'", '\u2019': "'",
  // 中文标点：公式里出现就换成半角（区间 (0，π/4) 这种很常见）
  '\uff0c': ',', '\u3002': '.', '\u3001': ',', '\uff1b': ';', '\uff1a': ':',
  '\u201c': '"', '\u201d': '"',
}
/** LaTeX 里有特殊含义、必须转义的字符 */
const ESC = { '%': BS + '%', '&': BS + '&', '#': BS + '#', '_': BS + '_', '$': BS + '$', '{': BS + '{', '}': BS + '}' }

/** 已知函数名（Word 用 m:func 包着，但有时只在文本里） */
const FNS = ['arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'log', 'ln', 'lg', 'lim', 'max', 'min', 'gcd']

function escText(s) {
  let out = ''
  for (const ch of s) {
    if (ch in SYM) out += SYM[ch] + ' '
    else if (ch in ESC) out += ESC[ch]
    else if (ch === '~' || ch === '^') out += BS + ch
    else out += ch
  }
  return out
}

/** 把一段纯文本按函数名/普通文本处理（函数名要直立） */
function normRun(text) {
  const t = text.trim()
  if (!t) return ''
  if (FNS.includes(t)) return BS + t + ' '
  return escText(text)
}

/** 主入口：把一个 m:oMath / m:oMathPara 节点转成 LaTeX */
export function ommlToLatex(node) {
  return walk(node).replace(/ +/g, ' ').trim()
}

const SKIP = new Set(['m:rPr', 'm:ctrlPr', 'm:argPr', 'm:degHide', 'm:brk', 'm:aln', 'm:alnScr', 'm:sepChr'])

function walk(node) {
  const n = node.name
  if (SKIP.has(n)) return ''
  if (!n.startsWith('m:')) return ''            // w:* 样式一律忽略
  switch (n) {
    case 'm:oMath': case 'm:oMathPara':
      return kids(node).map(walk).join('')
    case 'm:r':
      return normRun(runText(node))
    case 'm:t':
      return escText(rawText(node))
    case 'm:f': {
      const num = slot(node, 'm:num'), den = slot(node, 'm:den')
      return c('frac') + '{' + num + '}{' + den + '}'
    }
    case 'm:rad': {
      const degNode = kids(node, 'm:deg')[0]
      const e = slot(node, 'm:e')
      const hide = firstDeep(node, 'm:degHide')
      const deg = degNode ? walk(degNode).trim() : ''
      const hidden = hide && hide.attrs['m:val'] !== '0' && hide.attrs['m:val'] !== 'false'
      return (deg && !hidden ? c('sqrt') + '[' + deg + ']' : c('sqrt')) + '{' + e + '}'
    }
    case 'm:sSup': return brace(slot(node, 'm:e')) + '^{' + slot(node, 'm:sup') + '}'
    case 'm:sSub': return brace(slot(node, 'm:e')) + '_{' + slot(node, 'm:sub') + '}'
    case 'm:sSubSup': return brace(slot(node, 'm:e')) + '_{' + slot(node, 'm:sub') + '}^{' + slot(node, 'm:sup') + '}'
    case 'm:sPre': return '_{' + slot(node, 'm:sub') + '}^{' + slot(node, 'm:sup') + '}' + brace(slot(node, 'm:e'))
    case 'm:d': return delim(node)
    case 'm:nary': return nary(node)
    case 'm:func': {
      const name = slot(node, 'm:fName')
      const arg = slot(node, 'm:e')
      return name + arg
    }
    case 'm:acc': return accent(node)
    case 'm:bar': {
      const pos = firstDeep(node, 'm:pos')
      const under = pos && pos.attrs['m:val'] === 'bot'
      return c(under ? 'underline' : 'overline') + '{' + slot(node, 'm:e') + '}'
    }
    case 'm:limLow': return brace(slot(node, 'm:e')) + '_{' + slot(node, 'm:lim') + '}'
    case 'm:limUpp': return brace(slot(node, 'm:e')) + '^{' + slot(node, 'm:lim') + '}'
    case 'm:m': return matrix(node)
    case 'm:eqArr': return eqArr(node)
    case 'm:groupChr': return slot(node, 'm:e')
    case 'm:box': case 'm:borderBox': case 'm:phant': return slot(node, 'm:e')
    default:
      // 未知容器：递归下去，别丢内容
      return kids(node).map(walk).join('')
  }
}

/** 取一个 m:r 里的文字：只认 m:t，且必须连文本节点一起取（kids() 会把文本过滤掉） */
function runText(node) {
  let out = ''
  for (const k of node.kids) {
    if (typeof k === 'string') continue
    if (k.name === 'm:t') out += rawText(k)
  }
  return out
}
/** 递归拼接节点下的所有文本 */
function rawText(node) {
  let out = ''
  for (const k of node.kids) out += typeof k === 'string' ? k : rawText(k)
  return out
}

/** 取某个槽位（m:e / m:num ...）的内容；没有就空串 */
function slot(node, name) {
  const k = kids(node, name)[0]
  if (!k) return ''
  return kids(k).map(walk).join('').trim()
}
/** 基数需要加花括号的情况（单个字符就不用） */
function brace(s) {
  if (!s) return '{}'
  if (s.length === 1) return s
  return '{' + s + '}'
}
function firstDeep(node, name) {
  for (const k of node.kids) {
    if (typeof k === 'string') continue
    if (k.name === name) return k
    const d = firstDeep(k, name)
    if (d) return d
  }
  return null
}

const DELIM = { '(': '(', ')': ')', '[': '[', ']': ']', '{': BS + '{', '}': BS + '}', '|': '|', '\u2016': BS + '|', '\u2308': BS + 'lceil', '\u2309': BS + 'rceil', '\u230a': BS + 'lfloor', '\u230b': BS + 'rfloor', '\u27e8': BS + 'langle', '\u27e9': BS + 'rangle' }
function delim(node) {
  const beg = kids(node, 'm:begChr')[0]
  const end = kids(node, 'm:endChr')[0]
  const sep = kids(node, 'm:sepChr')[0]
  const b = (beg && beg.attrs['m:val']) || '('
  const e = (end && end.attrs['m:val']) || ')'
  const s = (sep && sep.attrs['m:val']) || ''
  const parts = kids(node, 'm:e').map((k) => kids(k).map(walk).join('').trim())
  const join = s ? ' ' + s + ' ' : ', '
  const body = parts.join(join)
  return c('left') + (DELIM[b] || b) + ' ' + body + ' ' + c('right') + (DELIM[e] || e)
}

const NARY = { '\u2211': 'sum', '\u220f': 'prod', '\u222b': 'int', '\u222e': 'oint', '\u222d': 'int' }
function nary(node) {
  const chr = kids(node, 'm:chr')[0]
  const ch = (chr && chr.attrs['m:val']) || '\u2211'
  const name = NARY[ch] || 'sum'
  const sub = slot(node, 'm:sub'), sup = slot(node, 'm:sup'), e = slot(node, 'm:e')
  let out = BS + name
  if (sub) out += '_{' + sub + '}'
  if (sup) out += '^{' + sup + '}'
  return out + ' ' + e
}

/** 组合重音（Word 用组合字符表示） */
const ACC = { '\u0302': 'hat', '\u0303': 'tilde', '\u0304': 'bar', '\u0305': 'bar', '\u0307': 'dot', '\u0308': 'ddot', '\u20d7': 'vec', '\u20d6': 'vec', '\u030c': 'check', '\u0300': 'grave', '\u0301': 'acute' }
function accent(node) {
  const chr = kids(node, 'm:chr')[0]
  const ch = (chr && chr.attrs['m:val']) || '\u0302'
  const cmd = ACC[ch] || 'hat'
  return BS + cmd + '{' + slot(node, 'm:e') + '}'
}

function matrix(node) {
  const rows = kids(node, 'm:mr').map((r) => kids(r, 'm:e').map((cell) => kids(cell).map(walk).join('').trim()).join(' & '))
  return c('begin') + '{matrix}' + rows.join(' ' + BS + BS + ' ') + c('end') + '{matrix}'
}
function eqArr(node) {
  const rows = kids(node, 'm:e').map((r) => kids(r).map(walk).join('').trim())
  return c('begin') + '{aligned}' + rows.join(' ' + BS + BS + ' ') + c('end') + '{aligned}'
}

/** 校验：花括号/环境是否配平（给测试用） */
export function balanced(latex) {
  let depth = 0
  for (const ch of latex) {
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth < 0) return false }
  }
  return depth === 0
}