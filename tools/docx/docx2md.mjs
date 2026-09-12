/**
 * docx → Markdown（喂给本应用已有的 Markdown 导入管线：| 分隔页 / # 标题 / $...$ 混排 / $$...$$ 公式 / ![]() 图片）
 *
 * 设计取舍：
 * - 不引第三方库（离线可用）：zip 自己读、XML 自己解析、OMML 自己转 LaTeX
 * - 段落里的制表位当空格、手动换行当行内换行 —— 对应到幻灯片里都是「同一段文字里的换行」
 * - **长段落按中文句读断行**：应用里每个 Markdown 行 = 一个元素框，一整段塞一行会被压缩到看不清
 * - 表格转成「单元格用 | 连起来的一行行文字」：应用的行模型没有表格语法，这样至少内容不丢
 * - 图片抽到同目录 images/ 下并写相对路径
 */
import fs from 'node:fs'
import path from 'node:path'
import { listZip, readZipEntry, readText } from './zip.mjs'
import { parseXml } from './xml.mjs'
import { ommlToLatex } from './omml.mjs'

const TAB = '    '
/** 一行的容量（按「中文算 1、西文算 0.55」估算）——与应用 pptLayouts 的行数估算同一套口径 */
const LINE_UNITS = 42

function units(s) {
  let n = 0
  for (const ch of s) {
    if (/[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/.test(ch)) n += 1
    else n += 0.55
  }
  return n
}

/** 长段落断行：优先在中文句末断，其次在逗号后，最后硬切 */
/**
 * 把一行切成「文本段 / 数学段 / 图片段」。
 * 为什么要分段：断行时**公式必须整体保留** —— 按字符硬切会把 $...$ 从中间切开，
 * 两半各剩一个 $，应用就认不出公式了（会退化成纯文本里带 $ 的乱码）。
 */
function segments(line) {
  const out = []
  let i = 0
  let buf = ''
  const flush = () => { if (buf) { out.push({ math: false, v: buf }); buf = '' } }
  while (i < line.length) {
    if (line[i] === '$') {
      const end = line.indexOf('$', i + 1)
      if (end > i) { flush(); out.push({ math: true, v: line.slice(i, end + 1) }); i = end + 1; continue }
      buf += line[i]; i++; continue
    }
    if (line[i] === '!' && line[i + 1] === '[') {
      const close = line.indexOf(')', i)
      if (close > i) { flush(); out.push({ math: true, v: line.slice(i, close + 1) }); i = close + 1; continue }
    }
    buf += line[i]; i++
  }
  flush()
  return out
}

/** 长段落断行：优先在中文句末断，其次在逗号后，最后硬切；**公式与图片整体不拆** */
function wrapLine(text, limit = LINE_UNITS) {
  const out = []
  let buf = ''
  let used = 0
  const flush = () => { const t = buf.trim(); if (t) out.push(t); buf = ''; used = 0 }
  for (const seg of segments(text)) {
    if (seg.math) {
      const w = Math.max(3, seg.v.length * 0.6)   // 公式/图片按源码长度打六折估算
      if (used + w > limit * 1.3 && buf.trim()) flush()
      buf += seg.v
      used += w
      continue
    }
    for (const ch of seg.v) {
      buf += ch
      used += units(ch)
      const strong = '。！？；'.includes(ch)
      const weak = '，、：'.includes(ch)
      if (used >= limit && strong) flush()
      else if (used >= limit * 1.25 && weak) flush()
      else if (used >= limit * 1.6) flush()
    }
  }
  flush()
  return out.length ? out : ['']
}
export function convertDocx(file, opts = {}) {
  const buf = fs.readFileSync(file)
  const entries = listZip(buf)
  const relsXml = readText(buf, 'word/_rels/document.xml.rels')
  const docXml = readText(buf, 'word/document.xml')
  if (!docXml) throw new Error('不是 docx：缺少 word/document.xml')

  // rId -> word/media/xxx
  const rels = {}
  if (relsXml) {
    for (const m of relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      const t = m[2].replace(/^\.\//, '')
      rels[m[1]] = t.startsWith('media/') ? 'word/' + t : t
    }
  }

  const doc = parseXml(docXml)
  const body = findDeep(doc, 'w:body')   // 注意：body 在 w:document 里面，不是 root 的直接子节点
  if (!body) throw new Error('document.xml 里没有 w:body')

  const stats = { para: 0, formulas: 0, images: 0, tables: 0, symbols: 0, pageBreaks: 0 }
  const mediaOut = []
  const imgDir = path.join(opts.outDir || path.dirname(file), 'images')

  const out = []
  const blocks = body.kids.filter((k) => typeof k !== 'string')

  for (const b of blocks) {
    if (b.name === 'w:p') {
      const r = paragraph(b, { rels, stats, mediaOut, imgDir, entries, buf, wrap: opts.wrap === true, wrapUnits: opts.wrapUnits })
      if (r === null) continue
      if (r.pageBreak) { out.push('---'); stats.pageBreaks++ }
      for (const line of r.lines) out.push(line)
    } else if (b.name === 'w:tbl') {
      stats.tables++
      out.push(...table(b, stats))
    } else if (b.name === 'w:sectPr') {
      // 分节：当成一页结束
      out.push('---')
      stats.pageBreaks++
    }
  }

  // 抽图片
  for (const m of mediaOut) {
    const e = entries.find((x) => x.name === m.zipPath)
    if (!e) continue
    fs.mkdirSync(imgDir, { recursive: true })
    fs.writeFileSync(path.join(imgDir, m.fileName), readZipEntry(buf, e))
    stats.images++
  }

  // 收尾清理：连续空行压成一个、首尾空行去掉
  const cleaned = []
  for (const line of out) {
    if (line === '' && cleaned[cleaned.length - 1] === '') continue
    cleaned.push(line)
  }
  while (cleaned.length && cleaned[0] === '') cleaned.shift()
  while (cleaned.length && cleaned[cleaned.length - 1] === '') cleaned.pop()

  // 分页：应用的 Markdown 模型是「一行 = 一个元素框、自上而下堆」，
  // 一页塞太多行会堆到画布外（一页按 1080px 高、每行约 90px 算，9 行左右就到头了）。
  // 规则：满 perSlide 行断页；遇到标题且已攒到半页也断（标题尽量起新页）。
  const paged = paginate(cleaned, { budgetPx: opts.pagePx ?? 900, group: opts.group ?? 'auto' })
  return { markdown: paged.join('\n'), stats }
}

/**
 * 分页（--- 就是应用里的横向分页符）。
 *
 * **按像素预算切，不按行数**：应用里每行会变成一个元素框，间距也不同 ——
 * 普通文本行高 70 + 20 间隙 = 90px，含 $...$ 的混排行高 120 → 140px，图片行高 520 → 540px。
 * 按行数切会让"公式多的页"堆出画布（1080px）。所以这里按权重累加，超过预算就断页。
 */
/**
 * 分页（--- 就是应用里的横向分页符）。
 *
 * 两条规则：
 * 1. **按像素预算**：应用里每行会变成一个元素框 —— 普通文本行 70+20=90px、含 $...$ 的混排行 120+20=140px、
 *    图片行 520+20=540px。画布只有 1080px 高，所以必须按权重累加，超了断页（按行数切会让公式多的页堆出画布）。
 * 2. **按内容分组**：试卷以「题」为一页、讲义以「标题」为一页更符合教学使用 ——
 *    一行一页会切出几百页（一篇解析版 3000 行 → 500 页，没法用）。
 */
/**
 * 一行的占位高度 —— **必须与应用的估算口径一致**（src/types/index.ts 的 estimateTextHeight + mdDeck 的框高），
 * 否则分页会估少：实测按「每行 140px」粗估时，长段落实际能到 250px+，一页就堆出画布（t18 越界 3 个元素）。
 * 口径：中文（含全角）算 1 字宽、西文 0.55、$...$ 公式按源码长度一半折算。
 */
function textHeight(text, fontSize, lineHeight = 1.55) {
  const perLine = Math.max(8, 1620 / fontSize)
  const marked = text.replace(/\$[^$]*\$/g, (m) => '\u0001'.repeat(Math.max(2, Math.round((m.length - 2) * 0.5))))
  let units = 0
  let lines = 1
  for (const ch of marked) {
    const w = ch === '\u0001' ? 1 : /[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/.test(ch) ? 1 : 0.55
    units += w
    if (units > perLine) { lines++; units = w }
  }
  return Math.round(lines * fontSize * lineHeight) + 12
}
function lineWeight(line) {
  const t = line.trim()
  if (!t) return 0
  if (/^!\[/.test(t)) return 540                       // 图片元素固定 900×520
  if (/^\$\$/.test(t)) return 160                     // 显示公式：应用里是固定 140px 的框                       // 图片元素固定 900×520
  const h = /^#{1,6} /.test(t)
    ? (() => { const lv = t.match(/^#+/)[0].length; const fs = lv === 1 ? 48 : lv === 2 ? 40 : 32; return textHeight(t.replace(/^#+ /, ''), fs, 1.3) })()
    : textHeight(t, 26)
  return h + 20                                          // 框高 + 20px 间隙（与应用的行距一致）
}/** 题号开头：1. / 12． / 3、 */
function isQuestionStart(line) {
  return /^[0-9]{1,3}\s*[.、．]/.test(line.trim())
}
function isHeading(line) {
  return /^#{1,6} /.test(line)
}
function paginate(lines, opts = {}) {
  const budgetPx = opts.budgetPx ?? 900
  const group = opts.group ?? 'auto'   // auto | question | heading | line
  if (!budgetPx || budgetPx <= 0) return lines
  const startsGroup = (l) => {
    if (group === 'line') return false
    if (group === 'question') return isQuestionStart(l)
    if (group === 'heading') return isHeading(l)
    return isHeading(l) || isQuestionStart(l)
  }
  const out = []
  let used = 0
  let has = false
  for (const line of lines) {
    if (line === '---') { out.push(line); used = 0; has = false; continue }
    const w = lineWeight(line)
    if (has && (used + w > budgetPx || startsGroup(line))) { out.push('---'); used = 0; has = false }
    out.push(line)
    used += w
    has = true
  }
  return out
}
/** 一个段落 → 若干 Markdown 行；返回 null 表示整段跳过 */
function paragraph(p, ctx) {
  const stats = ctx.stats   // 统计对象在 ctx 里，直接引用会 ReferenceError
  const runs = p.kids.filter((k) => typeof k !== 'string' && k.name === 'w:r')
  // 段落级属性：样式 / 大纲 / 加粗 / 字号
  const pPr = p.kids.find((k) => typeof k !== 'string' && k.name === 'w:pPr')
  let style = '', outline = '', jc = ''
  if (pPr) {
    const ps = pPr.kids.find((k) => typeof k !== 'string' && k.name === 'w:pStyle')
    if (ps) style = ps.attrs['w:val'] || ''
    const ol = pPr.kids.find((k) => typeof k !== 'string' && k.name === 'w:outlineLvl')
    if (ol) outline = ol.attrs['w:val'] || ''
    const j = pPr.kids.find((k) => typeof k !== 'string' && k.name === 'w:jc')
    if (j) jc = j.attrs['w:val'] || ''
  }

  let text = ''
  let mathOnly = true
  let bold = runs.length > 0
  let maxSz = 0
  let pageBreak = false
  const inlines = []

  const eat = (node) => {
    for (const k of node.kids) {
      if (typeof k === 'string') continue
      if (k.name === 'w:r') { eatRun(k) }
      else if (k.name === 'm:oMath') {
        const latex = ommlToLatex(k)
        if (latex) { stats.formulas++; inlines.push({ t: 'math', v: latex }); mathOnly = mathOnly && false }
      } else if (k.name === 'm:oMathPara') {
        const latex = ommlToLatex(k)
        if (latex) { stats.formulas++; inlines.push({ t: 'math', v: latex, disp: true }) }
      } else if (k.name === 'w:hyperlink' || k.name === 'w:ins' || k.name === 'w:smartTag' || k.name === 'w:sdt' || k.name === 'w:sdtContent') {
        eat(k)
      }
    }
  }
  const eatRun = (r) => {
    const rPr = r.kids.find((k) => typeof k !== 'string' && k.name === 'w:rPr')
    let rBold = false, sz = 0, vert = ''
    if (rPr) {
      const va = rPr.kids.find((k) => typeof k !== 'string' && k.name === 'w:vertAlign')
      if (va) vert = va.attrs['w:val'] || ''
      rBold = rPr.kids.some((k) => typeof k !== 'string' && (k.name === 'w:b' || k.name === 'w:bCs'))
      const s = rPr.kids.find((k) => typeof k !== 'string' && k.name === 'w:sz')
      if (s) sz = parseInt(s.attrs['w:val'] || '0', 10) / 2   // 半磅 → 磅
    }
    if (!rBold) bold = false
    maxSz = Math.max(maxSz, sz)
    for (const k of r.kids) {
      if (typeof k === 'string') continue
      if (k.name === 'w:t') {
        const s = rawText(k)
        if (s.trim()) mathOnly = false
        inlines.push({ t: 'text', v: s, vert })
      } else if (k.name === 'w:tab') {
        inlines.push({ t: 'text', v: TAB })
      } else if (k.name === 'w:br') {
        if (k.attrs['w:type'] === 'page') pageBreak = true
        else inlines.push({ t: 'text', v: '\n' })
      } else if (k.name === 'w:drawing' || k.name === 'w:pict') {
        const blip = findDeep(k, 'a:blip')
        const rid = blip && (blip.attrs['r:embed'] || blip.attrs['r:link'])
        const target = rid ? ctx.rels[rid] : null
        if (target) {
          const fileName = path.basename(target)
          ctx.mediaOut.push({ zipPath: target, fileName })
          inlines.push({ t: 'img', v: 'images/' + fileName })
          mathOnly = false
        }
      } else if (k.name === 'w:sym') {
        stats.symbols++
      } else if (k.name === 'w:noBreakHyphen') {
        inlines.push({ t: 'text', v: '-' })
      }
    }
  }
  eat(p)

  // 上下标 run 合并：Word 里 x² 常常只是「上标格式的 run」而不是 OMML 公式，
  // 这里把「前一个字符 + 上标」合成 $x^{2}$，否则会变成 x2 这种读不出来的形式。
  const merged = []
  for (const it of inlines) {
    if (it.t === 'text' && it.vert) {
      const mark = it.vert === 'superscript' ? '^' : '_'
      const val = it.v.trim()
      if (!val) continue
      const prev = merged[merged.length - 1]
      if (prev && prev.t === 'text' && prev.v.length) {
        const base = prev.v.slice(-1)
        prev.v = prev.v.slice(0, -1)
        merged.push({ t: 'math', v: base + mark + '{' + val + '}' })
      } else if (prev && prev.t === 'math') {
        merged.pop()
        merged.push({ t: 'math', v: '{' + prev.v + '}' + mark + '{' + val + '}' })
      } else {
        merged.push({ t: 'math', v: mark + '{' + val + '}' })
      }
      continue
    }
    merged.push(it)
  }

  // 拼行内内容：文字与公式交替，公式一律转成 $...$（应用会认成混排）
  // 图片必须独占一行：应用只认行首的 ![]()，夹在文字中间会被当字面文本显示出来
  // 显示公式（m:oMathPara）只有在**整段都是公式**时才用 $$…$$ 独占一行；
  // 段落里还有正文时按行内 $…$ 处理 —— 否则像「B.B₁C₁⊥平面AA₁D」这种选项会被拆成一堆大元素，顺序也会乱。
  const onlyMath = merged.length > 0 && merged.every((it) => it.t === 'math')
  const textLines = []
  const lines = []
  if (onlyMath) {
    for (const it of merged) lines.push('$$' + it.v + '$$')
  } else {
    // 相邻公式必须合并成一个 $…$：Word 里 A₁、B₁ 常是分开的 OMML，直接拼会得到 $A_{1}$B_{1}$，
    // 其中 $ 会被应用的显示公式规则命中 —— 这一行剩下的文字**整段被丢掉**（实测真题第 40 页就是这么丢的）。
    const squashed = []
    for (const it of merged) {
      // Word 常在相邻公式之间插一个空 run，它会把「相邻」切断 —— 空文本直接丢掉（保留纯换行项）
      if (it.t === 'text' && it.v.trim() === '' && it.v.indexOf('\n') < 0) continue
      const prev = squashed[squashed.length - 1]
      if (it.t === 'math' && prev && prev.t === 'math') { prev.v += it.v; continue }
      squashed.push({ ...it })
    }
    let cur = ''
    for (const it of squashed) {
      if (it.t === 'text') cur += it.v
      else if (it.t === 'math') cur += '$' + it.v + '$'
      else if (it.t === 'img') {
        if (cur.trim()) textLines.push(cur.trim())
        cur = ''
        textLines.push('![](' + it.v + ')')
      }
    }
    if (cur.trim()) textLines.push(cur.trim())
    if (textLines.length) {
      const first = textLines.find((l) => !l.startsWith('![')) || textLines[0]
      const lvl = headingLevel({ style, outline, bold, maxSz, text: first })
      for (const b of textLines) {
        if (b.startsWith('![')) { lines.push(b); continue }
        const head = lvl ? '#'.repeat(lvl) + ' ' : ''
        if (ctx.wrap) for (const w of wrapLine(b, ctx.wrapUnits || LINE_UNITS)) lines.push(head + w)
        else lines.push(head + b)
      }
    }
  }
  if (!lines.length && !pageBreak) return null
  stats.para++
  return { lines, pageBreak }
}
var opts_alt = ''

/** 标题判定：显式样式 → 大纲级别 → 「一、」「（一）」这类编号 → 整段加粗且更大 */
function headingLevel({ style, outline, bold, maxSz, text }) {
  const s = (style || '').toLowerCase()
  const m = s.match(/heading\s*([1-6])/) || s.match(/^(?:\u6807\u9898|title)\s*([1-6])?/)
  if (m && m[1]) return Math.min(3, parseInt(m[1], 10))
  if (outline !== '' && outline !== undefined) {
    const lv = parseInt(String(outline), 10)
    if (Number.isFinite(lv) && lv <= 2) return lv + 1
  }
  const t = text.trim()
  if (/^[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341]+\u3001/.test(t) && units(t) < 30) return 2
  if (/^[\uff08(][\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341]+[\uff09)]/.test(t) && units(t) < 30 && bold) return 3
  if (bold && maxSz >= 16 && units(t) < 34) return 2
  return 0
}

function table(tbl, stats) {
  const rows = []
  for (const tr of tbl.kids) {
    if (typeof tr === 'string' || tr.name !== 'w:tr') continue
    const cells = []
    for (const tc of tr.kids) {
      if (typeof tc === 'string' || tc.name !== 'w:tc') continue
      const parts = []
      for (const p of tc.kids) {
        if (typeof p === 'string' || p.name !== 'w:p') continue
        let s = ''
        for (const k of p.kids) if (typeof k !== 'string' && k.name === 'w:r') s += runPlain(k)
        if (s.trim()) parts.push(s.trim())
      }
      cells.push(parts.join(' '))
    }
    if (cells.some((c) => c)) rows.push(cells.join(' | '))
  }
  return rows
}

function runPlain(r) {
  let s = ''
  for (const k of r.kids) {
    if (typeof k === 'string') continue
    if (k.name === 'w:t') s += rawText(k)
    else if (k.name === 'w:tab') s += TAB
  }
  return s
}
function rawText(n) {
  let s = ''
  for (const k of n.kids) s += typeof k === 'string' ? k : rawText(k)
  return s
}
function findDeep(n, name) {
  for (const k of n.kids) {
    if (typeof k === 'string') continue
    if (k.name === name) return k
    const d = findDeep(k, name)
    if (d) return d
  }
  return null
}

// ---- CLI ----
if (process.argv[1] && process.argv[1].endsWith('docx2md.mjs')) {
  const args = process.argv.slice(2)
  const input = args.find((a) => !a.startsWith('-'))
  if (!input) {
    console.log('用法: node tools/docx/docx2md.mjs <文件.docx> [-o 输出.md]')
    process.exit(1)
  }
  const oi = args.indexOf('-o')
  const outFile = oi >= 0 ? args[oi + 1] : input.replace(/\.docx$/i, '') + '.md'
  const pi = args.indexOf('--page-px')
  const pagePx = pi >= 0 ? parseInt(args[pi + 1], 10) : 900
  const t0 = Date.now()
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  const { markdown, stats } = convertDocx(input, { outDir: path.dirname(outFile), pagePx })
  fs.writeFileSync(outFile, markdown, 'utf8')
  const linesArr = markdown.split('\n')
  console.log('转换完成：' + outFile)
  console.log('  段落 ' + stats.para + ' · 公式 ' + stats.formulas + ' · 表格 ' + stats.tables + ' · 图片 ' + stats.images + ' · 分页 ' + stats.pageBreaks + ' · 未识别符号 ' + stats.symbols)
  const pages = linesArr.filter((l) => l === '---').length + 1
  console.log('  输出 ' + linesArr.length + ' 行 → 约 ' + pages + ' 页（每页预算 ' + pagePx + 'px），' + Math.round(markdown.length / 1024) + ' KB，用时 ' + (Date.now() - t0) + 'ms')
}