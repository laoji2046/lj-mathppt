/**
 * 极简 XML 解析器：只服务 OOXML（格式良好、属性用双引号、允许自闭合）。
 * 不引第三方库 —— 产出 { name, attrs, kids } 树，文本节点直接是 string。
 * 刻意不用正则扫描标签（属性值里可能有 > ），全部按字符走。
 */
export function parseXml(src) {
  const root = { name: '#root', attrs: {}, kids: [] }
  const stack = [root]
  const put = (node) => stack[stack.length - 1].kids.push(node)
  let i = 0
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    // 文本节点也要解实体（&gt; &amp; 之类），否则会原样带进正文
    if (lt < 0) { pushText(stack[stack.length - 1], decodeEntities(src.slice(i))); break }
    if (lt > i) pushText(stack[stack.length - 1], decodeEntities(src.slice(i, lt)))
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt); i = e < 0 ? src.length : e + 3; continue }
    if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt); pushText(stack[stack.length - 1], src.slice(lt + 9, e < 0 ? src.length : e)); i = e < 0 ? src.length : e + 3; continue }
    if (src.startsWith('<?', lt)) { const e = src.indexOf('?>', lt); i = e < 0 ? src.length : e + 2; continue }
    if (src.startsWith('<!', lt)) { const e = src.indexOf('>', lt); i = e < 0 ? src.length : e + 1; continue }
    const tag = scanTag(src, lt)
    if (!tag) { pushText(stack[stack.length - 1], src.slice(lt, lt + 1)); i = lt + 1; continue }
    if (tag.close) {
      // 闭合标签：弹栈（容忍不配对的情况）
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === tag.name) { stack.length = k; break }
      }
    } else {
      const node = { name: tag.name, attrs: tag.attrs, kids: [] }
      put(node)
      if (!tag.selfClose) stack.push(node)
    }
    i = tag.end
  }
  return root
}

function pushText(parent, text) {
  if (!text) return
  const last = parent.kids[parent.kids.length - 1]
  if (typeof last === 'string') parent.kids[parent.kids.length - 1] = last + text
  else parent.kids.push(text)
}

/** 扫描一个标签：返回 { name, attrs, selfClose, close, end }（end 指向 > 之后） */
function scanTag(src, lt) {
  let i = lt + 1
  let close = false
  if (src[i] === '/') { close = true; i++ }
  const nameStart = i
  while (i < src.length) {
    const c = src[i]
    if (c === '>' || c === '/' || c === ' ' || c === '\t' || c === '\n' || c === '\r') break
    i++
  }
  const name = src.slice(nameStart, i)
  if (!name) return null
  const attrs = {}
  while (i < src.length) {
    while (i < src.length && /[ \t\n\r]/.test(src[i])) i++
    if (src[i] === '>') { i++; return { name, attrs, selfClose: false, close, end: i } }
    if (src[i] === '/') { i++; if (src[i] === '>') i++; return { name, attrs, selfClose: true, close, end: i } }
    const keyStart = i
    while (i < src.length && src[i] !== '=' && src[i] !== '>' && !/[ \t\n\r]/.test(src[i])) i++
    const key = src.slice(keyStart, i)
    while (i < src.length && /[ \t\n\r]/.test(src[i])) i++
    if (src[i] === '=') {
      i++
      while (i < src.length && /[ \t\n\r]/.test(src[i])) i++
      const q = src[i]
      if (q === '"' || q === "'") {
        const e = src.indexOf(q, i + 1)
        attrs[key] = decodeEntities(src.slice(i + 1, e < 0 ? src.length : e))
        i = e < 0 ? src.length : e + 1
      } else {
        const s0 = i
        while (i < src.length && !/[ \t\n\r>]/.test(src[i])) i++
        attrs[key] = decodeEntities(src.slice(s0, i))
      }
    } else if (key) attrs[key] = ''
  }
  return { name, attrs, selfClose: false, close, end: i }
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
function decodeEntities(s) {
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

/** 取某节点的直接子元素（可过滤名字） */
export function kids(node, name) {
  const list = node.kids.filter((k) => typeof k !== 'string')
  return name ? list.filter((k) => k.name === name) : list
}
/** 取第一个匹配名字的后代 */
export function first(node, name) {
  for (const k of node.kids) {
    if (typeof k === 'string') continue
    if (k.name === name) return k
    const deep = first(k, name)
    if (deep) return deep
  }
  return null
}
/** 取节点下所有文本 */
export function textOf(node) {
  let out = ''
  for (const k of node.kids) out += typeof k === 'string' ? k : textOf(k)
  return out
}