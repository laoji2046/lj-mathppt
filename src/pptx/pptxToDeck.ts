/**
 * .pptx → 课件 JSON。
 *
 * 依据 docs/pptx-import-plan.md 的实测结论（样张 18 页 / 258 个公式对象）：
 * - 页面尺寸 12192000×6858000 EMU = **1280×720 px**，与画布一致 → 基本不用缩放；
 * - 文字/公式在 `p:sp/p:txBody` 里，公式是 **原生 OMML**（`a14:m/m:oMath`）→ 转 LaTeX；
 * - 图片在 `p:pic` + `ppt/media`（png/jpeg 可用 ✓，**wmf/emf 跳过** ✗ 那只是 OLE 预览）；
 * - 表格在 `p:graphicFrame` 的 `a:tbl`（含 gridSpan/rowSpan → 转成我们的 merges）。
 *
 * 复用的既有设施：docx/zip（zip 读取）、docx/xml（迷你 XML 解析）、types.createElement（默认值）。
 */
import { listEntries, readEntry, readText } from '@/docx/zip'
import { parseXml, type XmlNode } from '@/docx/xml'
import { ommlToLatex, setOmmlTheme } from './ommlToLatex'
import { createElement } from '@/types'

export interface PptxStats {
  slides: number
  texts: number
  images: number
  tables: number
  formulas: number
  /** 因为没有位置信息（占位符继承）而跳过的形状 */
  skippedNoPos: number
  /** 跳过的 WMF/EMF（OLE 预览，不是内容） */
  skippedVector: number
  /** 只有 OLE 壳、读不到原生公式的个数（WMF 预览浏览器渲染不了 → 明确报数，别留暗洞 ✗） */
  oleFormulas: number
  bytes: number
}

const local = (n: string): string => {
  const i = n.indexOf(':')
  return i >= 0 ? n.slice(i + 1) : n
}
function kidsOf(n: XmlNode | null, name?: string): XmlNode[] {
  if (!n) return []
  const out: XmlNode[] = []
  for (const k of n.kids) {
    if (typeof k === 'string') continue
    if (!name || local(k.name) === name) out.push(k)
  }
  return out
}
function kid(n: XmlNode | null, name: string): XmlNode | null {
  return kidsOf(n, name)[0] ?? null
}
/** 深层收集所有同名节点（rels 里 Relationship 嵌在 Relationships 下面 ✗，必须钻下去取） */
function allDeep(n: XmlNode | null, name: string, out: XmlNode[] = []): XmlNode[] {
  if (!n) return out
  for (const k of n.kids) {
    if (typeof k === 'string') continue
    if (local(k.name) === name) out.push(k)
    allDeep(k, name, out)
  }
  return out
}
/** 深层收集所有段落（段落可能被 mc:AlternateContent 包着） */
function allParagraphs(n: XmlNode | null): XmlNode[] {
  return allDeep(n, 'p').filter((p) => kidsOf(p).some((k) => local(k.name) === 'r' || local(k.name) === 'm' || local(k.name) === 'br'))
}

/** 广度找第一个（跨层级） */
function find(n: XmlNode | null, name: string): XmlNode | null {
  if (!n) return null
  for (const k of n.kids) {
    if (typeof k === 'string') continue
    if (local(k.name) === name) return k
    const d = find(k, name)
    if (d) return d
  }
  return null
}
/** 属性按"后缀"取，避免依赖命名空间前缀（r:embed / embed 都认） */
function attrEndsWith(n: XmlNode | null, suffix: string): string | null {
  if (!n) return null
  for (const [k, v] of Object.entries(n.attrs)) {
    if (k === suffix || k.endsWith(':' + suffix)) return v
  }
  return null
}
const num = (v: string | null | undefined, d = 0): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}
/** EMU → px（1 inch = 914400 EMU = 96 px） */
const emu2px = (v: number): number => Math.round((v / 914400) * 96)

/**
 * 导入时的**字号系数** —— PPT 的 18pt 换算过来是 24px/1280 版面 ✓，
 * 但整体观感偏大 ✓（用户反馈"适当缩小"），这里统一缩一档。
 * ⚠ 只缩字号不缩框：框高由 estimateLines 按字号重算 ✓，所以会**自动跟着变矮** ✓，
 *   宽不变 → 一行能放更多字 → 反而更不容易被裁 ✓。
 */
const FONT_SCALE = 0.9

/** 元素基础矩形（pt→px：sz 是 1/100 磅） */
const sz2px = (sz: number): number => Math.max(8, Math.round((sz / 100) * (96 / 72)))

/**
 * 估算文字在给定字号下的"自然尺寸"。
 *
 * 为什么需要 ✗：PPT 里 112 个文本框是 **spAutoFit（框随字长）**、51 个是 **wrap="none"（不换行）**，
 * 存的 cy 只是"设计高度" ✗；应用这边文本框是固定宽高 + overflow:hidden ✓，
 * 直接照搬就会**折行并裁掉后半截**（用户实测：拉长一点就正常 ✓）。
 * 这里按"中日韩 1 个字宽、西文 0.55"估算，宁可略大（用户可以往里收 ✓，裁掉就救不回来 ✗）。
 */
function textUnits(s: string): number {
  let u = 0
  for (const ch of s) u += ch.codePointAt(0)! > 0x2e80 ? 1 : 0.55
  return u
}
/** 需要的行数（按框宽折行估算） */
function estimateLines(text: string, fontSize: number, boxW: number): number {
  const perLine = Math.max(1, boxW / Math.max(1, fontSize))
  let lines = 0
  for (const para of text.split('\n')) lines += Math.max(1, Math.ceil(textUnits(para) / perLine))
  return Math.max(1, lines)
}
/** 自然宽度（一行放完要多宽） */
function naturalWidth(text: string, fontSize: number): number {
  const widest = text.split('\n').reduce((m, p) => Math.max(m, textUnits(p)), 0)
  return Math.ceil(widest * fontSize + fontSize * 0.6)
}

/** 主题色板（theme1.xml 的 clrScheme）—— schemeClr 要查这张表才能变成具体颜色 */
type Theme = Record<string, string>
async function loadTheme(buf: Uint8Array, byName: Map<string, any>): Promise<Theme> {
  const theme: Theme = {}
  const names = ['theme1.xml']
  for (const e of byName.keys()) if (/^ppt\/theme\/theme\d+\.xml$/.test(e) && !names.includes(e.split('/').pop()!)) names.push(e.split('/').pop()!)
  const xml = await readText(buf, 'ppt/theme/theme1.xml')
  if (!xml) return theme
  const t = parseXml(xml)
  for (const c of allDeep(t, 'clrScheme')) {
    for (const slot of kidsOf(c)) {
      const nm = local(slot.name)
      const v = kid(slot, 'srgbClr')?.attrs['val'] ?? kid(slot, 'sysClr')?.attrs['lastClr']
        ?? kid(slot, 'sysClr')?.attrs['val']
      if (v) theme[nm] = '#' + v.replace(/^#/, '').toLowerCase()
    }
  }
  // sysClr 的 val 是 "windowText"/"window" 这类系统名，换成实际色
  for (const [k, v] of Object.entries({ ...theme })) {
    if (v === '#windowtext') theme[k] = theme['dk1'] && theme['dk1'].startsWith('#') ? theme['dk1'] : '#000000'
    else if (v === '#window') theme[k] = '#ffffff'
  }
  if (theme['dk1'] && !theme['dk1'].startsWith('#')) theme['dk1'] = '#000000'
  if (theme['lt1'] && !theme['lt1'].startsWith('#')) theme['lt1'] = '#ffffff'
  return theme
}
/** 解析一个颜色容器（solidFill / rPr 等）里的颜色 → #rrggbb */
function colorOf(node: XmlNode | null, theme: Theme): string | null {
  if (!node) return null
  const fill = find(node, 'solidFill') ?? (local(node.name) === 'solidFill' ? node : null)
  if (!fill) return null
  const srgb = find(fill, 'srgbClr')
  if (srgb?.attrs['val']) return '#' + srgb.attrs['val'].toLowerCase()
  const sch = find(fill, 'schemeClr')
  if (sch?.attrs['val']) {
    const key = sch.attrs['val']
    const v = theme[key]
    if (v) return v
    // 常见别名
    const alias: Record<string, string> = { tx1: 'dk1', tx2: 'dk2', bg1: 'lt1', bg2: 'lt2' }
    const a = alias[key]
    if (a && theme[a]) return theme[a]
    return key === 'tx1' || key === 'dk1' ? '#000000' : key === 'lt1' || key === 'bg1' ? '#ffffff' : '#000000'
  }
  const sys = find(fill, 'sysClr')
  if (sys) {
    const lc = sys.attrs['lastClr']
    if (lc) return '#' + lc.toLowerCase()
    return sys.attrs['val'] === 'window' ? '#ffffff' : '#000000'
  }
  return null
}
/** 段落属性 → 我们的 align / bullet */
function paraStyle(p: XmlNode | null): { align: 'left' | 'center' | 'right'; bullet: string; bulletIndent?: number } {
  const pPr = p ? (kid(p, 'pPr') ?? null) : null
  const algn = pPr?.attrs['algn']
  const align = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : 'left'
  let bullet = 'none'
  let bulletIndent: number | undefined
  if (pPr) {
    if (kid(pPr, 'buNone')) bullet = 'none'
    else if (kid(pPr, 'buAutoNum')) bullet = 'number'
    else {
      const bu = kid(pPr, 'buChar')
      const ch = bu?.attrs['char'] ?? ''
      if (ch === '•' || ch === '●' || ch === '·' || ch === 'o') bullet = 'dot'
      else if (ch === '–' || ch === '-' || ch === '—') bullet = 'dash'
      else if (ch === '▪' || ch === '■') bullet = 'square'
      else if (ch === '○' || ch === '◦') bullet = 'circle'
      else if (ch) bullet = 'dot'     // » n 之类：统一用小圆点（不丢"这是列表"这个信息 ✓）
    }
    if (bullet !== 'none' && pPr.attrs['marL']) bulletIndent = emu2px(num(pPr.attrs['marL'], 0))
  }
  return { align, bullet, bulletIndent }
}

/** 从一段 XML 里抽 OMML 公式 → LaTeX（按出现顺序，去重连续重复） */
function collectLatex(node: XmlNode, count: { n: number }): string {
  // by = a:p 里的一个段落：可能混杂文字与公式
  const parts: string[] = []
  const para = (p: XmlNode) => {
    let s = ''
    for (const k of p.kids) {
      if (typeof k === 'string') continue
      const ln = local(k.name)
      if (ln === 'r') s += kidsOf(k, 't').map((t) => t.kids.filter((x) => typeof x === 'string').join('')).join('')
      else if (ln === 'm') {
        const math = find(k, 'oMath')
        if (math) { s += '\\(' + ommlToLatex(math) + '\\)'; count.n++ }
      } else if (ln === 'br') s += '\n'
      else if (ln === 'fld') s += kidsOf(k, 't').map((t) => t.kids.filter((x) => typeof x === 'string').join('')).join('')
    }
    return s
  }
  const paras = allParagraphs(node)
  if (paras.length) { parts.push(...paras.map(para)) }
  return parts.join('\n').trim()
}

export async function pptxToDeck(
  buf: Uint8Array,
  opts: { onProgress?: (i: number, total: number) => void } = {},
): Promise<{ deck: any; stats: PptxStats }> {
  const stats: PptxStats = { slides: 0, texts: 0, images: 0, tables: 0, formulas: 0, skippedNoPos: 0, skippedVector: 0, oleFormulas: 0, bytes: 0 }
  const entries = listEntries(buf)
  const byName = new Map(entries.map((e) => [e.name, e]))
  const text = async (name: string) => (byName.has(name) ? readText(buf, name) : null)

  // 1) 页面尺寸（EMU）
  const presXml = await text('ppt/presentation.xml')
  let deckW = 1280, deckH = 720
  if (presXml) {
    const pres = parseXml(presXml)
    const sz = find(pres, 'sldSz')
    const cx = num(sz?.attrs['cx'], 0)
    const cy = num(sz?.attrs['cy'], 0)
    if (cx > 0 && cy > 0) {
      deckW = emu2px(cx)
      deckH = emu2px(cy)
    }
  }

  // 1.5) 主题色板（schemeClr 要用它解析；公式里的颜色也用它 ✓）
  const theme = await loadTheme(buf, byName)
  setOmmlTheme(theme)

  // 2) 幻灯片顺序：presentation.xml 的 sldIdLst + rels 映射（不能只按 slideN 数字排 ✗）
  let order: string[] = []
  const relsXml = await text('ppt/_rels/presentation.xml.rels')
  if (presXml && relsXml) {
    const rels = parseXml(relsXml)
    const map = new Map<string, string>()
    for (const r of allDeep(rels, 'Relationship')) {
      const id = r.attrs['Id']
      const tgt = r.attrs['Target']
      if (id && tgt) map.set(id, tgt.replace(/^\.\//, '').replace(/^\//, ''))
    }
    const pres = parseXml(presXml)
    for (const s of kidsOf(find(pres, 'sldIdLst'), 'sldId')) {
      const rid = attrEndsWith(s, 'id')
      const t = rid ? map.get(rid) : null
      if (t) order.push(t.startsWith('ppt/') ? t : 'ppt/' + t)
    }
  }
  if (!order.length) {
    order = entries.map((e) => e.name).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10))
  }

  const slides: any[] = []
  for (let i = 0; i < order.length; i++) {
    const name = order[i]
    const xml = await readText(buf, name)
    if (!xml) continue
    const nSlide = name.replace(/[^0-9]/g, '')
    const relsSlide = await text('ppt/slides/_rels/slide' + nSlide + '.xml.rels')
    const relMap = new Map<string, string>()
    if (relsSlide) {
      for (const r of allDeep(parseXml(relsSlide), 'Relationship')) {
        const id = r.attrs['Id']
        const tgt = r.attrs['Target']
        if (id && tgt) relMap.set(id, tgt)
      }
    }

    const tree = parseXml(xml)
    const spTree = find(tree, 'spTree')
    const elements: any[] = []
    const counter = { n: 0 }

    /** 组合（grpSp）的坐标变换：子坐标 = (child - chOff) * (ext/chExt) + off ✓
     *  ⚠ 不能假设"组合偏移很小" ✗ —— 偏移非零时子元素会**整体错位**（实测两段文字叠在一起 ✓）。 */
    const addShape = async (shape: XmlNode, baseX = 0, baseY = 0, scX = 1, scY = 1) => {
      const ln = local(shape.name)
      // 兼容包装：真内容在 mc:Choice 里，mc:Fallback 是老的 VML/WMF 版（跳过 ✗）
      if (ln === 'AlternateContent') {
        for (const ch of kidsOf(shape, 'Choice')) {
          for (const c of kidsOf(ch)) {
            // ⚠ 只有 OLE 壳、里面没有原生 OMML 的公式：**明确报数** ✗
            //   （WMF 预览浏览器渲染不了 ✓，静默跳过会在课件里留个洞 ✓）
            if (local(c.name) === 'oleObj' && !allDeep(c, 'oMath').length) stats.oleFormulas++
            await addShape(c, baseX, baseY)
          }
        }
        return
      }
      if (ln === 'grpSp') {
        const gxf = find(kid(shape, 'grpSpPr') ?? shape, 'xfrm')
        const goff = kid(gxf, 'off'), gext = kid(gxf, 'ext')
        const gchOff = kid(gxf, 'chOff'), gchExt = kid(gxf, 'chExt')
        const gx = emu2px(num(goff?.attrs['x'], 0))
        const gy = emu2px(num(goff?.attrs['y'], 0))
        const gw = num(gext?.attrs['cx'], 0), gh = num(gext?.attrs['cy'], 0)
        const cw = num(gchExt?.attrs['cx'], 0), chh = num(gchExt?.attrs['cy'], 0)
        // ⚠⚠ chExt 的"单位"不可信 ✗：实测样张里 off=429260(EMU) 而 chExt=4183，
        //    直接相除得到 635 倍 ✗ —— 会把整个组合炸飞 ✓（这种生成器写出的 chExt 是废数 ✓）。
        //    所以缩放**只接受合理范围**（0.2~5 倍 ✓），越界就当 1（只用 off 位移 ✓）。
        let rx = cw > 0 && gw > 0 ? gw / cw : 1
        let ry = chh > 0 && gh > 0 ? gh / chh : 1
        if (!(rx > 0.2 && rx < 5)) rx = 1
        if (!(ry > 0.2 && ry < 5)) ry = 1
        // chOff 同理：越界就当 0（它只是"组合内原点" ✓，多为小值 ✓）
        const cxRaw = emu2px(num(gchOff?.attrs['x'], 0))
        const cyRaw = emu2px(num(gchOff?.attrs['y'], 0))
        const cx = Math.abs(cxRaw) < 200 ? cxRaw : 0
        const cy = Math.abs(cyRaw) < 200 ? cyRaw : 0
        // 子坐标为"组合内坐标系"，先减 chOff、乘缩放、加 off（再叠加外层的 base/scale ✓）
        const nx = baseX + (gx - cx * scX) * scX
        const ny = baseY + (gy - cy * scY) * scY
        for (const c of kidsOf(shape)) {
          if (local(c.name) === 'grpSpPr' || local(c.name) === 'nvGrpSpPr') continue
          await addShape(c, nx, ny, scX * rx, scY * ry)
        }
        return
      }
      // 位置：spPr/a:xfrm 或 xfrm
      const spPr = kid(shape, 'spPr') ?? kid(shape, 'grpSpPr')
      const xfrm = find(spPr, 'xfrm')
      const off = kid(xfrm, 'off')
      const ext = kid(xfrm, 'ext')
      const hasPos = !!(off && ext)
      const x = Math.round(emu2px(num(off?.attrs['x'], 0)) * scX + baseX)
      const y = Math.round(emu2px(num(off?.attrs['y'], 0)) * scY + baseY)
      const w = Math.round(emu2px(num(ext?.attrs['cx'], 0)) * scX)
      const h = Math.round(emu2px(num(ext?.attrs['cy'], 0)) * scY)

      if (ln === 'pic') {
        const blip = find(shape, 'blip')
        const rid = attrEndsWith(blip, 'embed')
        const tgt = rid ? relMap.get(rid) : null
        if (!tgt) { stats.skippedNoPos++; return }
        const media = tgt.startsWith('..') ? tgt.replace(/^\.\.\//, 'ppt/') : 'ppt/slides/' + tgt
        const norm = media.replace(/\/\//g, '/')
        const ext2 = (norm.split('.').pop() || '').toLowerCase()
        if (ext2 === 'wmf' || ext2 === 'emf') { stats.skippedVector++; return }
        if (!byName.has(norm)) { stats.skippedNoPos++; return }
        const bytes = await readEntry(buf, byName.get(norm)!)
        const mime = ext2 === 'png' ? 'image/png' : ext2 === 'jpg' || ext2 === 'jpeg' ? 'image/jpeg'
          : ext2 === 'gif' ? 'image/gif' : ext2 === 'svg' ? 'image/svg+xml' : ''
        if (!mime) { stats.skippedVector++; return }
        let bin = ''
        for (let k = 0; k < bytes.length; k++) bin += String.fromCharCode(bytes[k])
        const url = 'data:' + mime + ';base64,' + btoa(bin)
        stats.bytes += bytes.length
        const el = createElement('image')
        Object.assign(el, { x, y, w: w || 200, h: h || 150, src: url, fit: 'contain' })
        elements.push(el)
        stats.images++
        return
      }

      if (ln === 'graphicFrame') {
        const tbl = find(shape, 'tbl')
        if (!tbl) {
          // ⚠ 图表/OLE 等非表格：**不能直接 return** ✗ ——
          //   实测 OLE 公式藏在 graphicFrame > graphicData > mc:AlternateContent 里 ✓，
          //   直接返回会"统计不到、也捞不到里面的原生公式" ✓（oleFormulas 一直是 0 ✗ 就是这么来的 ✓）
          for (const ac of allDeep(shape, 'AlternateContent')) await addShape(ac, baseX, baseY, scX, scY)
          return
        }
        const rows: string[][] = []
        const merges: { r: number; c: number; rs: number; cs: number }[] = []
        const trs = kidsOf(tbl, 'tr')
        for (let r = 0; r < trs.length; r++) {
          const cells = kidsOf(trs[r], 'tc')
          const line: string[] = []
          let c = 0
          for (const tc of cells) {
            const t = collectLatex(find(tc, 'txBody') ?? tc, counter)
            const tcPr = kid(tc, 'tcPr')
            const gs = Math.max(1, num(tcPr?.attrs['gridSpan'], 1))
            const rs2 = Math.max(1, num(tcPr?.attrs['rowSpan'], 1))
            line.push(t || '')
            if (gs > 1 || rs2 > 1) merges.push({ r, c, rs: rs2, cs: gs })
            for (let k = 1; k < gs; k++) line.push('')
            c += gs
          }
          rows.push(line)
        }
        if (!rows.length) return
        const el = createElement('table')
        Object.assign(el, {
          x, y, w: w || deckW * 0.6, h: h || deckH * 0.4,
          rows, merges: merges.length ? merges : undefined, fontSize: 20,
        })
        elements.push(el)
        stats.tables++
        return
      }

      if (ln === 'sp') {
        const txBody = kid(shape, 'txBody')
        if (!txBody) return
        const txt = collectLatex(txBody, counter)
        if (!txt.trim()) return
        const hasMath = txt.indexOf('\\(') >= 0
        // 字号：段落默认 → 单次运行
        let sz = 1800
        const dRPr = find(txBody, 'defRPr')
        if (dRPr?.attrs['sz']) sz = num(dRPr.attrs['sz'], 1800)
        else {
          const rPr = find(txBody, 'rPr')
          if (rPr?.attrs['sz']) sz = num(rPr.attrs['sz'], 1800)
        }
        if (!hasPos) {
          stats.skippedNoPos++
          return
        }
        // 形状底色 → 文字元素的 bgColor（PPT 里"白字 + 彩色底"很常见 ✗，
        // 只导文字不导底色 → 白字落在白底上就看不见了 ✓；应用的文字元素自带 bgColor ✓）
        const spPr = kid(shape, 'spPr')
        const fillNode = spPr ? kidsOf(spPr).find((k) => local(k.name) === 'solidFill') ?? null : null
        const bg = fillNode ? colorOf(fillNode, theme) : null

        // 样式：段落对齐/项目符号 + 首个有颜色的运行 + 首个加粗运行（应用的元素是"整块一个样式"）
        const paras = allParagraphs(txBody)
        const st = paraStyle(paras[0] ?? null)
        // —— 尺寸修正（见 estimateLines 的注释）——
        const bodyPr = find(txBody, 'bodyPr')
        const noWrap = bodyPr?.attrs['wrap'] === 'none'
        const anchor = bodyPr?.attrs['anchor']
        const fpx = Math.max(10, Math.round(sz2px(sz) * FONT_SCALE))
        let fw = w || 400
        let fh = h || 60
        let fy = y
        if (noWrap) {
          // 不换行：把框加宽到能一行放完（恢复 PPT 的样子 ✓）
          const nw = naturalWidth(txt, fpx)
          if (nw > fw) fw = Math.min(nw, deckW - x - 8)
        }
        // 行距 / 段间距（实测样张 lnSpc 从 50% 到 150% 都有 ✗，不还原会挤在一起或散开 ✓）
        const pPr0 = paras[0] ? kid(paras[0], 'pPr') : null
        const lnPct = pPr0 ? (find(pPr0, 'lnSpc') ? num(find(find(pPr0, 'lnSpc')!, 'spcPct')?.attrs['val'], 0) : 0) : 0
        // val=0 在 PPT 里等于"单倍" ✗，不能当 0 用
        const lineHeight = lnPct > 0 ? Math.min(3, Math.max(0.6, lnPct / 100000)) : 1
        const pct = (node: XmlNode | null) => {
          const v = node ? num(find(node, 'spcPct')?.attrs['val'], 0) : 0
          return v > 0 ? (v / 100000) * fpx : 0
        }
        const paraBefore = Math.round(pct(pPr0 ? kid(pPr0, 'spcBef') : null) * FONT_SCALE)
        const paraAfter = Math.round(pct(pPr0 ? kid(pPr0, 'spcAft') : null) * FONT_SCALE)
        // 框随字长（spAutoFit）：高度至少放得下按折行估算出的行数（用真实行距 ✓）
        const need = estimateLines(txt, fpx, fw) * fpx * lineHeight + fpx * 0.35 + paraBefore + paraAfter
        const grown = need > fh ? Math.ceil(need) - fh : 0
        if (grown > 0) {
          // ⚠ 撑高会把"框"变大：anchor=ctr 的文字会往下跑 half、anchor=b 会往下跑 whole ✗
          //   所以按 anchor 反向补 y，让**文字**停在原来的位置 ✓（否则会和旁边的框错位 ✓）
          fh = fh + grown
          if (anchor === 'ctr') fy -= grown / 2
          else if (anchor === 'b') fy -= grown
        }
        let color: string | null = null
        for (const rPr of allDeep(txBody, 'rPr')) { const c = colorOf(rPr, theme); if (c) { color = c; break } }
        if (!color) color = colorOf(find(txBody, 'defRPr'), theme)
        let bold = false
        for (const rPr of allDeep(txBody, 'rPr')) if (rPr.attrs['b'] === '1') { bold = true; break }
        const el = hasMath ? createElement('richtex') : createElement('text')
        Object.assign(el, {
          x, y: Math.round(fy), w: Math.round(fw), h: Math.round(fh),
          text: txt, fontSize: fpx,
          align: st.align,
          ...(color ? { color } : {}),
          ...(bold ? { fontWeight: 700 } : {}),
          ...(st.bullet !== 'none'
            ? { bullet: st.bullet, bulletIndent: Math.round((st.bulletIndent ?? 24) * FONT_SCALE) }
            : {}),
          ...(bg ? { bgColor: bg } : {}),
          ...(lineHeight !== 1 ? { lineHeight } : {}),
          ...(paraBefore ? { paraBefore } : {}),
          ...(paraAfter ? { paraAfter } : {}),
          // 垂直对齐跟 PPT 的 anchor：t=顶端 / ctr=居中 / b=底端
          valign: anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top',
        })
        elements.push(el)
        stats.texts++
      }
    }

    for (const s of kidsOf(spTree)) await addShape(s)
    stats.formulas += counter.n
    slides.push({ id: 'pptx-' + (i + 1), bg: '#ffffff', elements })
    stats.slides++
    opts.onProgress?.(i + 1, order.length)
  }

  return {
    deck: { title: '由 PPT 导入', width: deckW, height: deckH, slides },
    stats,
  }
}