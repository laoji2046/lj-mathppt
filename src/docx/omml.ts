/**
 * OMML（Word 公式）→ LaTeX。
 * Word 导出 HTML/RTF 会把公式变成图片或丢结构，而 OMML 本身是结构化 XML，映射到 LaTeX 可靠。
 * 约定：源码里不出现反斜杠 —— LaTeX 命令统一由 BS 拼出来，避免转义地狱，也一眼看得出用到哪些命令。
 */
import { kids, type XmlNode } from './xml'

const BS = String.fromCharCode(92)
const CMD: Record<string, string> = { frac: 'frac', sqrt: 'sqrt', left: 'left', right: 'right', begin: 'begin', end: 'end', sum: 'sum', prod: 'prod', int: 'int', oint: 'oint' }
const c = (name: string) => BS + CMD[name]
const SYM: Record<string, string> = {
  ['\u00d7']: BS + 'times', ['\u00f7']: BS + 'div', ['\u00b1']: BS + 'pm', ['\u2213']: BS + 'mp',
  ['\u2264']: BS + 'le', ['\u2265']: BS + 'ge', ['\u2260']: BS + 'ne', ['\u2248']: BS + 'approx',
  ['\u2261']: BS + 'equiv', ['\u221e']: BS + 'infty', ['\u2211']: BS + 'sum', ['\u220f']: BS + 'prod',
  ['\u222b']: BS + 'int', ['\u222e']: BS + 'oint', ['\u221a']: BS + 'sqrt',
  ['\u00b7']: BS + 'cdot', ['\u22c5']: BS + 'cdot', ['\u22ef']: BS + 'cdots', ['\u2026']: BS + 'ldots',
  ['\u2192']: BS + 'to', ['\u21d2']: BS + 'Rightarrow', ['\u21d4']: BS + 'Leftrightarrow',
  ['\u2208']: BS + 'in', ['\u2209']: BS + 'notin', ['\u2286']: BS + 'subseteq', ['\u2282']: BS + 'subset',
  ['\u222a']: BS + 'cup', ['\u2229']: BS + 'cap', ['\u2205']: BS + 'varnothing',
  ['\u22a5']: BS + 'perp', ['\u2225']: BS + 'parallel', ['\u2220']: BS + 'angle', ['\u25b3']: BS + 'triangle',
  ['\u2200']: BS + 'forall', ['\u2203']: BS + 'exists', ['\u221d']: BS + 'propto',
  ['\u03b1']: BS + 'alpha', ['\u03b2']: BS + 'beta', ['\u03b3']: BS + 'gamma', ['\u03b4']: BS + 'delta',
  ['\u03b8']: BS + 'theta', ['\u03bb']: BS + 'lambda', ['\u03bc']: BS + 'mu', ['\u03c0']: BS + 'pi',
  ['\u03c1']: BS + 'rho', ['\u03c3']: BS + 'sigma', ['\u03c6']: BS + 'phi', ['\u03c9']: BS + 'omega',
  ['\u0394']: BS + 'Delta', ['\u03a3']: BS + 'Sigma', ['\u03a9']: BS + 'Omega', ['\u03a6']: BS + 'Phi',
  ['\u2212']: '-', ['\u2013']: '-', ['\u2014']: '-',
  ['\uff0c']: ',', ['\u3002']: '.', ['\u3001']: ',', ['\uff1b']: ';', ['\uff1a']: ':',
}
const ESC: Record<string, string> = { '%': BS + '%', '&': BS + '&', '#': BS + '#', _: BS + '_', $: BS + '$', '{': BS + '{', '}': BS + '}' }
const FNS = ['arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'log', 'ln', 'lg', 'lim', 'max', 'min', 'gcd']
const SKIP = new Set(['m:rPr', 'm:ctrlPr', 'm:argPr', 'm:degHide', 'm:brk', 'm:aln', 'm:alnScr', 'm:sepChr'])

function escText(s: string): string {
  let out = ''
  for (const ch of s) {
    if (ch in SYM) out += SYM[ch] + ' '
    else if (ch in ESC) out += ESC[ch]
    else if (ch === '~' || ch === '^') out += BS + ch
    else out += ch
  }
  return out
}
function normRun(text: string): string {
  const t = text.trim()
  if (!t) return ''
  return FNS.includes(t) ? BS + t + ' ' : escText(text)
}
function rawText(node: XmlNode): string {
  let out = ''
  for (const k of node.kids) out += typeof k === 'string' ? k : rawText(k)
  return out
}
/** 取一个 m:r 的文字：只认 m:t，且必须连文本节点一起取（kids() 会把文本过滤掉） */
function runText(node: XmlNode): string {
  let out = ''
  for (const k of node.kids) {
    if (typeof k === 'string') continue
    if (k.name === 'm:t') out += rawText(k)
  }
  return out
}
function slot(node: XmlNode, name: string): string {
  const k = kids(node, name)[0]
  return k ? kids(k).map(walk).join('').trim() : ''
}
function brace(s: string): string {
  if (!s) return '{}'
  return s.length === 1 ? s : '{' + s + '}'
}
function firstDeep(node: XmlNode, name: string): XmlNode | null {
  for (const k of node.kids) {
    if (typeof k === 'string') continue
    if (k.name === name) return k
    const d = firstDeep(k, name)
    if (d) return d
  }
  return null
}
const DELIM: Record<string, string> = { '(': '(', ')': ')', '[': '[', ']': ']', '{': BS + '{', '}': BS + '}', '|': '|', ['\u2016']: BS + '|', ['\u2308']: BS + 'lceil', ['\u2309']: BS + 'rceil', ['\u230a']: BS + 'lfloor', ['\u230b']: BS + 'rfloor', ['\u27e8']: BS + 'langle', ['\u27e9']: BS + 'rangle' }
const NARY: Record<string, string> = { ['\u2211']: 'sum', ['\u220f']: 'prod', ['\u222b']: 'int', ['\u222e']: 'oint' }
const ACC: Record<string, string> = { ['\u0302']: 'hat', ['\u0303']: 'tilde', ['\u0304']: 'bar', ['\u0305']: 'bar', ['\u0307']: 'dot', ['\u0308']: 'ddot', ['\u20d7']: 'vec', ['\u20d6']: 'vec', ['\u030c']: 'check', ['\u0300']: 'grave', ['\u0301']: 'acute' }

function delim(node: XmlNode): string {
  const beg = kids(node, 'm:begChr')[0]
  const end = kids(node, 'm:endChr')[0]
  const sep = kids(node, 'm:sepChr')[0]
  const b = (beg && beg.attrs['m:val']) || '('
  const e = (end && end.attrs['m:val']) || ')'
  const s = (sep && sep.attrs['m:val']) || ''
  const parts = kids(node, 'm:e').map((k) => kids(k).map(walk).join('').trim())
  return c('left') + (DELIM[b] || b) + ' ' + parts.join(s ? ' ' + s + ' ' : ', ') + ' ' + c('right') + (DELIM[e] || e)
}
function nary(node: XmlNode): string {
  const chr = kids(node, 'm:chr')[0]
  const ch = (chr && chr.attrs['m:val']) || '\u2211'
  let out = BS + (NARY[ch] || 'sum')
  const sub = slot(node, 'm:sub'), sup = slot(node, 'm:sup')
  if (sub) out += '_{' + sub + '}'
  if (sup) out += '^{' + sup + '}'
  return out + ' ' + slot(node, 'm:e')
}
function matrix(node: XmlNode): string {
  const rows = kids(node, 'm:mr').map((r) => kids(r, 'm:e').map((cell) => kids(cell).map(walk).join('').trim()).join(' & '))
  return c('begin') + '{matrix}' + rows.join(' ' + BS + BS + ' ') + c('end') + '{matrix}'
}
function eqArr(node: XmlNode): string {
  const rows = kids(node, 'm:e').map((r) => kids(r).map(walk).join('').trim())
  return c('begin') + '{aligned}' + rows.join(' ' + BS + BS + ' ') + c('end') + '{aligned}'
}

function walk(node: XmlNode): string {
  const n = node.name
  if (SKIP.has(n) || !n.startsWith('m:')) return ''
  switch (n) {
    case 'm:oMath':
    case 'm:oMathPara':
      return kids(node).map(walk).join('')
    case 'm:r':
      return normRun(runText(node))
    case 'm:t':
      return escText(rawText(node))
    case 'm:f':
      return c('frac') + '{' + slot(node, 'm:num') + '}{' + slot(node, 'm:den') + '}'
    case 'm:rad': {
      const hide = firstDeep(node, 'm:degHide')
      const deg = slot(node, 'm:deg')
      const hidden = !!hide && hide.attrs['m:val'] !== '0' && hide.attrs['m:val'] !== 'false'
      return (deg && !hidden ? c('sqrt') + '[' + deg + ']' : c('sqrt')) + '{' + slot(node, 'm:e') + '}'
    }
    case 'm:sSup': return brace(slot(node, 'm:e')) + '^{' + slot(node, 'm:sup') + '}'
    case 'm:sSub': return brace(slot(node, 'm:e')) + '_{' + slot(node, 'm:sub') + '}'
    case 'm:sSubSup': return brace(slot(node, 'm:e')) + '_{' + slot(node, 'm:sub') + '}^{' + slot(node, 'm:sup') + '}'
    case 'm:sPre': return '_{' + slot(node, 'm:sub') + '}^{' + slot(node, 'm:sup') + '}' + brace(slot(node, 'm:e'))
    case 'm:d': return delim(node)
    case 'm:nary': return nary(node)
    case 'm:func': return slot(node, 'm:fName') + slot(node, 'm:e')
    case 'm:acc': {
      const chr = kids(node, 'm:chr')[0]
      const ch = (chr && chr.attrs['m:val']) || '\u0302'
      return BS + (ACC[ch] || 'hat') + '{' + slot(node, 'm:e') + '}'
    }
    case 'm:bar': {
      const pos = firstDeep(node, 'm:pos')
      const under = !!pos && pos.attrs['m:val'] === 'bot'
      return BS + (under ? 'underline' : 'overline') + '{' + slot(node, 'm:e') + '}'
    }
    case 'm:limLow': return brace(slot(node, 'm:e')) + '_{' + slot(node, 'm:lim') + '}'
    case 'm:limUpp': return brace(slot(node, 'm:e')) + '^{' + slot(node, 'm:lim') + '}'
    case 'm:m': return matrix(node)
    case 'm:eqArr': return eqArr(node)
    case 'm:groupChr':
    case 'm:box':
    case 'm:borderBox':
    case 'm:phant': return slot(node, 'm:e')
    default: return kids(node).map(walk).join('')
  }
}

export function ommlToLatex(node: XmlNode): string {
  return walk(node).replace(/ +/g, ' ').trim()
}
/** 花括号是否配平（测试用） */
export function balanced(latex: string): boolean {
  let depth = 0
  for (const ch of latex) {
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth < 0) return false }
  }
  return depth === 0
}