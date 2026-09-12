/**
 * 极简 XML 解析器（只服务 OOXML：格式良好、属性用双引号、允许自闭合）。
 * 不引第三方库；刻意不用正则扫标签（属性值里可能有 >），全部按字符走。
 * 产出 { name, attrs, kids } 树，文本节点就是 string。
 */

export interface XmlNode { name: string; attrs: Record<string, string>; kids: (XmlNode | string)[] }

const SP = ' ' + String.fromCharCode(9, 10, 13)
const isSp = (ch: string) => SP.indexOf(ch) >= 0

export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, kids: [] }
  const stack: XmlNode[] = [root]
  const put = (node: XmlNode) => stack[stack.length - 1].kids.push(node)
  let i = 0
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt < 0) { pushText(stack[stack.length - 1], decodeEntities(src.slice(i))); break }
    if (lt > i) pushText(stack[stack.length - 1], decodeEntities(src.slice(i, lt)))
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt); i = e < 0 ? src.length : e + 3; continue }
    if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt); pushText(stack[stack.length - 1], src.slice(lt + 9, e < 0 ? src.length : e)); i = e < 0 ? src.length : e + 3; continue }
    if (src.startsWith('<?', lt)) { const e = src.indexOf('?>', lt); i = e < 0 ? src.length : e + 2; continue }
    if (src.startsWith('<!', lt)) { const e = src.indexOf('>', lt); i = e < 0 ? src.length : e + 1; continue }
    const tag = scanTag(src, lt)
    if (!tag) { pushText(stack[stack.length - 1], src.slice(lt, lt + 1)); i = lt + 1; continue }
    if (tag.close) {
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].name === tag.name) { stack.length = k; break }
    } else {
      const node: XmlNode = { name: tag.name, attrs: tag.attrs, kids: [] }
      put(node)
      if (!tag.selfClose) stack.push(node)
    }
    i = tag.end
  }
  return root
}

function pushText(parent: XmlNode, text: string) {
  if (!text) return
  const last = parent.kids[parent.kids.length - 1]
  if (typeof last === 'string') parent.kids[parent.kids.length - 1] = last + text
  else parent.kids.push(text)
}

function scanTag(src: string, lt: number) {
  let i = lt + 1
  let close = false
  if (src[i] === '/') { close = true; i++ }
  const nameStart = i
  while (i < src.length && !isSp(src[i]) && src[i] !== '>' && src[i] !== '/') i++
  const name = src.slice(nameStart, i)
  if (!name) return null
  const attrs: Record<string, string> = {}
  while (i < src.length) {
    while (i < src.length && isSp(src[i])) i++
    if (src[i] === '>') { i++; return { name, attrs, selfClose: false, close, end: i } }
    if (src[i] === '/') { i++; if (src[i] === '>') i++; return { name, attrs, selfClose: true, close, end: i } }
    const keyStart = i
    while (i < src.length && src[i] !== '=' && src[i] !== '>' && !isSp(src[i])) i++
    const key = src.slice(keyStart, i)
    while (i < src.length && isSp(src[i])) i++
    if (src[i] === '=') {
      i++
      while (i < src.length && isSp(src[i])) i++
      const q = src[i]
      if (q === '"' || q === "'") {
        const e = src.indexOf(q, i + 1)
        attrs[key] = decodeEntities(src.slice(i + 1, e < 0 ? src.length : e))
        i = e < 0 ? src.length : e + 1
      } else {
        const s0 = i
        while (i < src.length && !isSp(src[i]) && src[i] !== '>') i++
        attrs[key] = decodeEntities(src.slice(s0, i))
      }
    } else if (key) attrs[key] = ''
  }
  return { name, attrs, selfClose: false, close, end: i }
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
export function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s
  let out = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '&') { out += s[i]; continue }
    const e = s.indexOf(';', i)
    if (e < 0 || e - i > 10) { out += s[i]; continue }
    const body = s.slice(i + 1, e)
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      out += Number.isFinite(code) ? String.fromCodePoint(code) : s.slice(i, e + 1)
    } else if (body in ENT) out += ENT[body]
    else out += s.slice(i, e + 1)
    i = e
  }
  return out
}

export function kids(node: XmlNode, name?: string): XmlNode[] {
  const list = node.kids.filter((k): k is XmlNode => typeof k !== 'string')
  return name ? list.filter((k) => k.name === name) : list
}
export function first(node: XmlNode, name: string): XmlNode | null {
  for (const k of node.kids) {
    if (typeof k === 'string') continue
    if (k.name === name) return k
    const deep = first(k, name)
    if (deep) return deep
  }
  return null
}
export function textOf(node: XmlNode): string {
  let out = ''
  for (const k of node.kids) out += typeof k === 'string' ? k : textOf(k)
  return out
}