/**
 * 试题批量导入的文本解析器（纯函数，便于单独验证）。
 *
 * 面向中文试卷的常见写法，容忍度优先于严格性：能认出来就认，认不出的原样留在题干里。
 *
 * 识别规则：
 *  题与题之间 —— 一行只有 3 个及以上短横线（---）时以其分隔；
 *                 否则按行首数字加 . 、 ． ) ）开头的行切分。
 *  选项       —— 行首 A-H（可带括号或顿号或点），同一行多个选项也能拆。
 *  答案       —— 【答案】 或 答案： 或 答案
 *  解析       —— 【解析】 或 解析： 或 解：（其后续行并入解析，直到下一个标记）
 *  知识点     —— 【知识点】 或 知识点：，或题干里的 #标签
 *  难度       —— 【难度】 或 难度： 后跟 1-5
 *  来源       —— 【来源】 或 来源：（顺带识别其中的年份）
 */

export interface ParsedQuestion {
  title: string
  stem: string
  options: string[]
  answer: string
  solution: string
  knowledge: string[]
  difficulty: number
  year: string
  region: string
  warn?: string
}

const RE_NUM = /^\s*\d{1,3}\s*[.、．)）]\s*/
const RE_SEP = /^\s*-{3,}\s*$/
const RE_OPT = /^\s*[（(]?\s*[A-Ha-h]\s*[.、．)）]\s*(.*)$/
const RE_ANSWER = /^\s*(?:【答案】|答案\s*[:：]?)\s*(.*)$/
const RE_SOLUTION = /^\s*(?:【解析】|【详解】|解析\s*[:：]|解\s*[:：])\s*(.*)$/
const RE_KNOW = /^\s*(?:【知识点】|知识点\s*[:：])\s*(.*)$/
const RE_DIFF = /^\s*(?:【难度】|难度\s*[:：])\s*([1-5])\s*$/
const RE_SOURCE = /^\s*(?:【来源】|来源\s*[:：])\s*(.*)$/

function splitTags(s: string): string[] {
  // 把 # 也当分隔符 —— 知识点行里可能混着 #标签（如「基本不等式 #和定积最大」）
  return s.split(/[，,、;；\s#]+/).map((x) => x.trim()).filter(Boolean)
}

function autoTitle(stem: string): string {
  const first = (stem || '').split('\n').map((s) => s.trim()).filter(Boolean)[0] || '未命名试题'
  const t = first.replace(/\s+/g, ' ')
  return t.length > 20 ? t.slice(0, 20) + '…' : t
}

/** 一行里可能有多个选项：A．1　B．2　C．3 —— 拆成数组 */
function splitOptionsLine(line: string): string[] {
  const parts = line.split(/(?=[（(]?\s*[A-Ha-h]\s*[.、．)）]\s*)/g)
  const out: string[] = []
  for (const p of parts) {
    const m = p.match(RE_OPT)
    if (m && m[1] !== undefined) out.push(m[1].trim())
  }
  return out
}

/** 把一段文本切成若干题块 */
function splitBlocks(text: string): string[] {
  const ls = text.replace(/\r\n?/g, '\n').split('\n')
  const hasSep = ls.some((l) => RE_SEP.test(l))
  const blocks: string[] = []
  let cur: string[] = []
  for (const l of ls) {
    if (hasSep) {
      if (RE_SEP.test(l)) {
        if (cur.some((x) => x.trim())) blocks.push(cur.join('\n'))
        cur = []
      } else {
        cur.push(l)
      }
      continue
    }
    if (RE_NUM.test(l) && cur.some((x) => x.trim())) {
      blocks.push(cur.join('\n'))
      cur = [l]
    } else {
      cur.push(l)
    }
  }
  if (cur.some((x) => x.trim())) blocks.push(cur.join('\n'))
  return blocks.map((b) => b.trim()).filter(Boolean)
}

export function parseQuestions(raw: string): ParsedQuestion[] {
  const out: ParsedQuestion[] = []
  for (const block of splitBlocks(raw)) {
    const ls = block.split('\n')
    const stemParts: string[] = []
    const options: string[] = []
    let answer = ''
    let solution = ''
    let knowledge: string[] = []
    let difficulty = 3
    let year = ''
    let region = ''
    let mode = 'stem'

    for (const line of ls) {
      if (!line.trim()) {
        if (mode === 'solution') solution += '\n'
        continue
      }
      let m = line.match(RE_DIFF)
      if (m) { difficulty = Number(m[1]) || 3; continue }
      m = line.match(RE_KNOW)
      if (m) { knowledge = knowledge.concat(splitTags(m[1])); continue }
      m = line.match(RE_SOURCE)
      if (m) {
        const s = m[1].trim()
        region = s
        const y = s.match(/(19|20)\d{2}/)
        if (y) year = y[0]
        continue
      }
      m = line.match(RE_ANSWER)
      if (m) { answer = m[1].trim(); mode = 'answer'; continue }
      m = line.match(RE_SOLUTION)
      if (m) { solution += (solution ? '\n' : '') + m[1].trim(); mode = 'solution'; continue }

      if (mode === 'stem') {
        const mo = line.match(RE_OPT)
        if (mo) {
          const many = splitOptionsLine(line)
          if (many.length > 1) options.push(...many)
          else options.push(mo[1].trim())
          continue
        }
        stemParts.push(line)
        continue
      }
      if (mode === 'solution') solution += '\n' + line.trim()
      else answer += '\n' + line.trim()
    }

    let stem = stemParts.join('\n').trim()
    const first = stem.split('\n')[0] || ''
    if (RE_NUM.test(first)) stem = stem.replace(RE_NUM, '').trim()
    const inline = stem.match(/#[^\s#]{1,16}/g)
    if (inline) {
      knowledge = knowledge.concat(inline.map((s) => s.slice(1)))
      stem = stem.replace(/#[^\s#]{1,16}/g, '').replace(/\s{2,}/g, ' ').trim()
    }
    knowledge = Array.from(new Set(knowledge.filter(Boolean)))

    if (!stem && !options.length) continue
    out.push({
      title: autoTitle(stem),
      stem,
      options,
      answer: answer.trim(),
      solution: solution.trim(),
      knowledge,
      difficulty,
      year,
      region,
      warn: !answer && !options.length ? '没有识别到答案' : undefined,
    })
  }
  return out
}

/** 界面上的格式说明 */
export const PARSE_HELP: string[] = [
  '题与题之间用一行 --- 分隔；也可以不写，每道题以 1. 2. 3. 开头即可。',
  '选项一行一个（A. …），写在同一个行里也能拆开。',
  '答案写 【答案】D 或 答案：D。',
  '解析写 【解析】……（可多行，直到下一个标记）。',
  '知识点写 【知识点】基本不等式, 最值，或直接在题干里写 #基本不等式。',
  '难度写 【难度】3（1-5）；来源写 【来源】课本 P46 或 2024 某市模拟。',
]
