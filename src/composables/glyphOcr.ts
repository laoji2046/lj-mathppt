/**
 * 字母识别：把线稿里被"挑出来"的字母块认成文本（A、B_1、O…）。
 *
 * 为什么不上 OCR 模型：这些图的字母是印刷体的数学斜体，字符集极小（大写字母 + 数字 + 下标），
 * 而且笔画干净、没有背景干扰 —— **拿同一字符渲染出来的模板去比对**就够了，还不用联网、不用体积。
 *
 * 做法：
 *   1. 把相邻的小块并成一个"标注"（主体 + 右下角的下标）；
 *   2. 每个小块裁到墨迹外框 → 按**高度**归一化到固定画布（同时保留宽高比，宽窄也成了特征）；
 *   3. 和预渲染的模板做**容差 IoU**：双方各膨胀 1px 再比，这样笔画粗细不同也不会崩；
 *   4. 上下标按"比主体小 + 位置偏下/偏上"判定，拼成 A_1 这种写法（正好是应用里 vlabels 的语法）。
 */
export interface GlyphBox {
  x0: number; y0: number; x1: number; y1: number
  pix: number[]
}
export interface LabelBox {
  text: string
  /** 0~1，模板 IoU；低于 0.45 基本可以当没认出来 */
  conf: number
  x0: number; y0: number; x1: number; y1: number
  cx: number; cy: number
}

const CW = 40          // 归一化画布宽
const CH = 36          // 归一化画布高
const GH = 26          // 字形归一化后的高度
const BASE = 30        // 基线所在行
/** 模板要渲染的字体：**每种都单独来一套**，比对时取最高分。
 *  原来是排成一个 font-stack 让 canvas 自己挑第一个装了的 —— 结果 Windows 上永远挑中 Cambria Math，
 *  可试卷插图用的是 Times 斜体，两者字形差得远：实测干净的 "D₁" 会被认成 "Z_1"。
 *  多字体模板的代价只是建一次表、每次比对多几倍计算，换来的是不再被"装了哪个字体"决定成败。 */
const FONT_FAMILIES = ['"Times New Roman"', '"Cambria Math"', 'Georgia', '"Nimbus Roman"', '"Liberation Serif"']

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const DIGITS = '0123456789'
const EXTRA = ["'", '′']
/** 候选字符：先大写与数字，再小写与撇（小写命中率低，放后面，只有分数接近时才可能反超） */
const CHARS = (LETTERS + DIGITS).split('').concat(EXTRA, LOWER.split(''))

interface Template { ch: string; m: Uint8Array; d: Uint8Array; n: number }

let TEMPLATES: Template[] | null = null

/** 把一块墨迹（归一化灰度 0/1）裁到外框、按高度缩放、摆到固定画布上 */
function normalizeMask(W: number, pix: number[], box: { x0: number; y0: number; x1: number; y1: number }) {
  const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1
  const set = new Set(pix)
  const out = new Uint8Array(CW * CH)
  const s = GH / bh
  const nw = Math.max(1, Math.round(bw * s))
  const ox = Math.round((CW - nw) / 2)
  const oy = BASE - GH
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < nw; x++) {
      const sx = box.x0 + Math.floor(x / s)
      const sy = box.y0 + Math.floor(y / s)
      if (sx > box.x1 || sy > box.y1) continue
      if (set.has(sy * W + sx)) out[(oy + y) * CW + (ox + x)] = 1
    }
  }
  return out
}

function dilate(m: Uint8Array) {
  const d = new Uint8Array(m.length)
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      if (!m[y * CW + x]) continue
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx
          if (yy < 0 || xx < 0 || yy >= CH || xx >= CW) continue
          d[yy * CW + xx] = 1
        }
      }
    }
  }
  return d
}

/** 预渲染模板：斜体与正体各来一份，比对时取分高的那个 */
function templates(): Template[] {
  if (TEMPLATES) return TEMPLATES
  const out: Template[] = []
  const c: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(220, 160)
    : document.createElement('canvas')
  c.width = 220; c.height = 160
  const g = c.getContext('2d', { willReadFrequently: true })
  if (!g) return (TEMPLATES = [])
  // 同一套模板只留一份：某个字体没装时 canvas 会退回默认字体，渲染出来的东西和别的一样，
  // 直接按掩码去重，省掉重复的比对开销。
  const seen = new Set<string>()
  for (const fam of FONT_FAMILIES) {
    for (const style of ['italic ', '']) {
      for (const ch of CHARS) {
        g.clearRect(0, 0, c.width, c.height)
        g.fillStyle = '#000'
        g.font = style + '110px ' + fam
        g.textBaseline = 'alphabetic'
        g.fillText(ch, 60, 120)
        const d = g.getImageData(0, 0, c.width, c.height).data
        const pix: number[] = []
        let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
        for (let y = 0; y < c.height; y++) {
          for (let x = 0; x < c.width; x++) {
            if (d[(y * c.width + x) * 4 + 3] < 128) continue
            pix.push(y * c.width + x)
            if (x < x0) x0 = x
            if (y < y0) y0 = y
            if (x > x1) x1 = x
            if (y > y1) y1 = y
          }
        }
        if (!pix.length) continue
        const m = normalizeMask(c.width, pix, { x0, y0, x1, y1 })
        const key = m.join('')
        if (seen.has(key)) continue
        seen.add(key)
        let n = 0
        for (let i = 0; i < m.length; i++) n += m[i]
        out.push({ ch, m, d: dilate(m), n })
      }
    }
  }
  TEMPLATES = out
  return out
}

/** 候选字符集：主体字按"这块字有多大、处在什么位置"先缩一圈。
 *  只有两档：主体字（base）与下标（sub）。**主体字不再分大小写** ——
 *  归一化之后大写 C 和小写 c 几乎一样，硬分档只会把"高度接近大写字母的小写字母"
 *  （斜体 y 就是，高度 48 与大写字母齐平）推进错误的档位、匹配到数字 7 或大写 I；
 *  而评分侧 `norm()` 本来就会统一成大写，大小写认混在结果上是无害的。 */
const SUB_CHARS = '0123456789ijknlm'
type Kind = 'base' | 'sub'

function matchGlyph(m: Uint8Array, srcN: number, kind: Kind) {
  const srcD = dilate(m)
  let best = '', bs = -1
  for (const t of templates()) {
    if (kind === 'sub') { if (SUB_CHARS.indexOf(t.ch) < 0) continue }
    // 主体字是字母（大小写都收），不会是数字 —— 数字只出现在下标里。
    else { if (DIGITS.indexOf(t.ch) >= 0) continue }
    let inter = 0
    for (let i = 0; i < m.length; i++) if (m[i] && t.d[i]) inter++
    let inter2 = 0
    for (let i = 0; i < m.length; i++) if (t.m[i] && srcD[i]) inter2++
    let s = (inter + inter2) / (srcN + t.n)
    // 下标里的 1 和 l / I 归一化之后几乎一模一样；下标基本都是数字，给字母一点惩罚压下去
    if (kind === 'sub' && DIGITS.indexOf(t.ch) < 0) s *= 0.88
    // 大小写不参与评分（norm 会统一），但**显示**上要跟原图一致：顶点标注绝大多数是大写，
    // 而 C/c、O/o、S/s 归一化后几乎一模一样、分数咬得很紧，所以给大写一丝加成来定胜负。
    // 坐标轴的小写 x/y/z 与 X/Y/Z 形状差别明显，不会被这条影响。
    if (t.ch >= 'A' && t.ch <= 'Z') s *= 1.01
    if (s > bs) { bs = s; best = t.ch }
  }
  return { ch: best, score: bs }
}

/** 细长条：墨迹量 ÷ 主轴长度 ≈ 笔画宽度，很小就说明是一根线（虚线的短划），不是字 */
export function isBarLike(p: GlyphBox, W: number) {
  const n = p.pix.length
  if (!n) return false
  const cx = (p.x0 + p.x1) / 2, cy = (p.y0 + p.y1) / 2
  let mxx = 0, mxy = 0, myy = 0
  for (const i of p.pix) {
    const dx = (i % W) - cx, dy = ((i / W) | 0) - cy
    mxx += dx * dx; mxy += dx * dy; myy += dy * dy
  }
  mxx /= n; mxy /= n; myy /= n
  const th = 0.5 * Math.atan2(2 * mxy, mxx - myy)
  const ux = Math.cos(th), uy = Math.sin(th)
  let minT = 1e9, maxT = -1e9
  for (const i of p.pix) {
    const t = ((i % W) - cx) * ux + (((i / W) | 0) - cy) * uy
    if (t < minT) minT = t
    if (t > maxT) maxT = t
  }
  const len = maxT - minT
  if (!(len > 6 && n / len < 7)) return false
  // 只看"墨迹量 ÷ 主轴长度"不够稳：瘦高的字母（斜体 y）算出来 6.9，正好卡在阈值下面，
  // 会被当成"一根线"整块丢掉 —— 实测 y 就是这么漏掉的。再看**垂直主轴方向的跨度**：
  // 真正的细长条（虚线短划）宽度就是笔画宽（几像素），而字母再瘦也有十几像素。
  let perp = 0
  for (const i of p.pix) {
    const t = ((i % W) - cx) * -uy + (((i / W) | 0) - cy) * ux
    const a = Math.abs(t)
    if (a > perp) perp = a
  }
  return perp <= Math.max(5, 0.16 * len)
}

/** 相邻的小块并成一条标注 */
function groupBoxes(boxes: GlyphBox[]) {
  const n = boxes.length
  const parent = boxes.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const h = (b: GlyphBox) => b.y1 - b.y0 + 1
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = boxes[i], b = boxes[j]
      const H = Math.max(h(a), h(b))
      const gap = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1)
      if (gap > 0.5 * H) continue
      const cyA = (a.y0 + a.y1) / 2, cyB = (b.y0 + b.y1) / 2
      if (Math.abs(cyA - cyB) > 0.75 * H) continue
      parent[find(i)] = find(j)
    }
  }
  const map = new Map<number, GlyphBox[]>()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    if (!map.has(r)) map.set(r, [])
    ;(map.get(r) as GlyphBox[]).push(boxes[i])
  }
  return [...map.values()]
}

/** 大小写纠正表：扫描件小、字形糊的时候，有些大写字母会被认成小写。
 *  实测 **C** 最容易中招（用户反馈：见 c 就 C，见 c_1 就 C_1）。
 *  **只改基字母，下标原样保留**（c_1 → C_1）；表里没有的字母一律不动 ——
 *  像 h、m 这些小写在这些图里本来就是对的，一起大写化反而错。
 *  以后遇到别的"总被认错大小写"的字母，往这张表里加一条就行。 */
const CASE_FIX: Record<string, string> = { c: 'C' }

/** 把识别出来的标注做一次大小写纠正（c → C，c_1 → C_1） */
export function fixLabelCase(s: string): string {
  const m = /^([A-Za-z])([\s\S]*)$/.exec(s)
  if (!m) return s
  return (CASE_FIX[m[1].toLowerCase()] ?? m[1]) + m[2]
}

/** 下标按"整张图的词汇表"归一：识别出来的下标常被笔画碎片污染（C_2_6、B_m_8_2）。
 *  用户给的思路 —— **看图里干净的那几个**（有 A_1、D_2、A_2，说明合法下标就是 1、2），
 *  脏标签的下标只保留下标词汇表里有的那个数字。
 *  没有词汇表（整张图都脏）就退化成"取第一个数字"；一个数字都没有就原样留着让你手改。 */
export function normalizeSubscripts(labels: LabelBox[]) {
  const vocab = new Set<string>()
  for (const L of labels) {
    const m = /^[A-Za-z][_^]([0-9])$/.exec(L.text)
    if (m) vocab.add(m[1])
  }
  for (const L of labels) {
    const m = /^([A-Za-z])([_^])(.+)$/.exec(L.text)
    if (!m) continue
    const parts = m[3].split(/[_^]/)
    if (parts.length < 2) continue                    // 干净的单段下标不动（保住 A_12 这种两位数写法）
    const digits = m[3].match(/[0-9]/g) || []
    if (!digits.length) continue                      // 连数字都没有：原样留着，别乱改
    const pick = digits.find((d) => vocab.has(d)) ?? digits[0]
    L.text = m[1] + m[2] + pick
  }
}

/** 入口：把"被挑出来的字母块"认成文本 */
export function recognizeLabels(W: number, boxes: GlyphBox[]): LabelBox[] {
  if (!boxes.length) return []
  const groups = groupBoxes(boxes)
  const out: LabelBox[] = []
  const baseOf = (g: GlyphBox[]) => {
    let base = g[0]
    for (const p of g) if (p.y1 - p.y0 > base.y1 - base.y0) base = p
    return base
  }
  for (const g of groups) {
    const parts = g.slice().sort((a, b) => a.x0 - b.x0)
    const base = baseOf(g)
    const bh = base.y1 - base.y0 + 1
    const bcy = (base.y0 + base.y1) / 2
    let text = ''
    let confSum = 0
    let confN = 0
    const emit = (p: GlyphBox, role: 'base' | 'sub' | 'sup') => {
      const m = normalizeMask(W, p.pix, p)
      let cnt = 0
      for (let i = 0; i < m.length; i++) cnt += m[i]
      if (cnt < 8) return
      const kind: Kind = role !== 'base' ? 'sub' : 'base'
      const r = matchGlyph(m, cnt, kind)
      confSum += r.score; confN++
      if (role === 'base') text += r.ch
      else if (role === 'sub') text += '_' + r.ch
      else text += '^' + r.ch
    }
    // 一条标注只允许有一个主体字：并进来的其它同尺寸块多半是图形碎块，直接丢掉 ——
    // 不然会拼出 "Dk" "Cx" 这种（真字母和碎块的形状本来就分不开）
    if (!(parts.length === 1 && isBarLike(base, W))) emit(base, 'base')
    for (const p of parts) {
      if (p === base) continue
      const ph = p.y1 - p.y0 + 1
      const pcy = (p.y0 + p.y1) / 2
      if (p.x0 < base.x0) continue                            // 主体左边的块不管
      // 整个落在主体外框里、而且很小的块 = 主体自己的碎片（衬线断开、笔画缺口之类），不是下标。
      // 实测：字母 C 右下角的衬线碎块被当成下标，拼出了 "c_2"。
      if (p.x0 >= base.x0 && p.x1 <= base.x1 && p.y0 >= base.y0 && p.y1 <= base.y1 &&
        p.pix.length < 0.25 * base.pix.length) continue
      if (ph < 0.8 * bh && pcy > bcy + 0.12 * bh) emit(p, 'sub')
      else if (ph < 0.8 * bh && pcy < bcy - 0.12 * bh) emit(p, 'sup')
    }
    if (!text) continue
    const x0 = Math.min(...g.map((b) => b.x0)), x1 = Math.max(...g.map((b) => b.x1))
    const y0 = Math.min(...g.map((b) => b.y0)), y1 = Math.max(...g.map((b) => b.y1))
    out.push({ text: fixLabelCase(text), conf: confN ? confSum / confN : 0, x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 })
  }
  normalizeSubscripts(out)
  return out
}
