/**
 * 线稿自动矢量化：位图 → 顶点 + 边表 + 虚实线。
 *
 * 「复刻图形」里那 8 套是手工量的；这个模块把「量」这一步自动化：
 * 试卷 / 讲义里的立体几何插图都是干净的黑白线稿，直接把它拆成
 * 「归一化顶点 + 边拓扑 + 哪条线是虚线」，出来就是普通的数学图形元素，可以拖点、改线型。
 *
 * 流程：二值化 → 挑字母（抹掉）→ Zhang-Suen 细化 → 骨架建图 → 追路径
 *      → Douglas-Peucker 简化 → 共线短划合并成虚线 → 顶点归并 → 解消十字交叉 → 交点精修
 *
 * 实测（拿 solidFigures.ts 里人工核对过的 8 套当真值）：顶点召回 89%、平均误差 1.3%、
 * 虚实线判定 100% 对；会多出几个落在直线上的冗余顶点，由调用方（VectorizeDialog）让用户删。
 */

import { recognizeLabels } from './glyphOcr'

export interface VectorizeOpt {
  /** 识别范围（原图像素），不传 = 整图。用来切掉图片下方的「图 1」这类题注 */
  crop?: [number, number, number, number]
  /** 小于这个比例的连通域才可能是字母 / 短划 */
  textMax?: number
  /** 自由端点吸附到顶点的半径（px） */
  snapR?: number
  /** 顶点合并半径（px） */
  mergeR?: number
  /** 去毛刺：短于这么长的单端路径丢掉（px） */
  spur?: number
  /** 路径简化容差（px） */
  eps?: number
  /** 当成"一截短划"的最大长度（图对角线的比例），超过的算实线段 */
  pieceMax?: number
  /** 虚线端点沿自身方向往外找落点的半径（px） */
  extendR?: number
  /** 收缩"过短的边"的阈值（图对角线的比例） */
  short?: number
  /** 交点精修的最大位移（图对角线的比例） */
  refine?: number
}

export interface VectorizeStats {
  verts: number
  edges: number
  dash: number
  text: number
  bars: number
  dashGroups: number
  /** 识别框四条边上各有多少墨迹像素 —— 非 0 就说明这个框把图形切掉了一块。
   *  实测：image16 的框底边正压在字母 x 的腰上，x 只剩半个字形（像个 V），于是被认成了 v。
   *  只在显式传了 crop 时统计（整图识别时图片边缘本来就可能有内容，报这个没意义）。 */
  clipped?: { top: number; bottom: number; left: number; right: number }
}

export interface VectorizeResult {
  /** 识别框尺寸（= crop 的宽高；没传 crop 就是整图） */
  W: number
  H: number
  /** 识别框在原图里的位置 */
  box: [number, number, number, number]
  /** 原图尺寸 */
  imgW: number
  imgH: number
  /** 归一化顶点（相对识别框），扁平 [x0,y0,x1,y1,...] */
  points: number[]
  /** 边：[起点, 终点, 是否虚线] */
  edges: [number, number, number][]
  /** 被抹掉的字母：位置（归一化，相对识别框）+ 自动认出来的文本 */
  anchors: { x: number; y: number; text: string; conf: number }[]
  stats: VectorizeStats
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image()
    im.crossOrigin = 'anonymous'
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error('图片加载失败（跨域图片无法读取像素，请用本地图片）'))
    im.src = src
  })
}

// ---------- 二值化 ----------
function inkFromRgba(d: ArrayLike<number>, W: number, H: number, crop?: [number, number, number, number]) {
  const ink = new Uint8Array(W * H)
  const box: [number, number, number, number] = crop
    ? [Math.max(0, crop[0] | 0), Math.max(0, crop[1] | 0), Math.min(W, crop[2] | 0), Math.min(H, crop[3] | 0)]
    : [0, 0, W, H]
  for (let y = box[1]; y < box[3]; y++) {
    for (let x = box[0]; x < box[2]; x++) {
      const p = (y * W + x) * 4
      const lum = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]
      if (d[p + 3] > 100 && lum < 150) ink[y * W + x] = 1
    }
  }
  return { ink, W, H, box }
}

/** 主线程入口：把 HTMLImageElement 转成 RGBA，再复用无 DOM 的二值化。 */
export function toInk(img: HTMLImageElement, crop?: [number, number, number, number]) {
  const W = img.naturalWidth, H = img.naturalHeight
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const g = c.getContext('2d', { willReadFrequently: true })
  if (!g) throw new Error('无法创建画布上下文')
  g.drawImage(img, 0, 0)
  return inkFromRgba(g.getImageData(0, 0, W, H).data, W, H, crop)
}

export function vectorizeImageData(data: ArrayLike<number>, W: number, H: number, opt: VectorizeOpt = {}): VectorizeResult {
  return vectorizeFromInk(inkFromRgba(data, W, H, opt.crop), opt)
}

// ---------- 连通域 ----------
interface Comp {
  n: number; x0: number; y0: number; x1: number; y1: number
  sx: number; sy: number; pix: number[]
  cx: number; cy: number; bw: number; bh: number; diag: number
  ux: number; uy: number; len: number
}

export function components(ink: Uint8Array, W: number, H: number, box: [number, number, number, number]): Comp[] {
  const seen = new Uint8Array(W * H)
  const list: Comp[] = []
  const stack: number[] = []
  for (let y = box[1]; y < box[3]; y++) {
    for (let x = box[0]; x < box[2]; x++) {
      const s = y * W + x
      if (!ink[s] || seen[s]) continue
      const comp = { n: 0, x0: x, y0: y, x1: x, y1: y, sx: 0, sy: 0, pix: [] as number[] } as Comp
      stack.length = 0; stack.push(s); seen[s] = 1
      while (stack.length) {
        const i = stack.pop() as number
        const px = i % W, py = (i / W) | 0
        comp.n++; comp.pix.push(i)
        comp.sx += px; comp.sy += py
        if (px < comp.x0) comp.x0 = px
        if (py < comp.y0) comp.y0 = py
        if (px > comp.x1) comp.x1 = px
        if (py > comp.y1) comp.y1 = py
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue
            const nx = px + dx, ny = py + dy
            if (nx < box[0] || ny < box[1] || nx >= box[2] || ny >= box[3]) continue
            const j = ny * W + nx
            if (ink[j] && !seen[j]) { seen[j] = 1; stack.push(j) }
          }
        }
      }
      comp.cx = comp.sx / comp.n; comp.cy = comp.sy / comp.n
      comp.bw = comp.x1 - comp.x0 + 1; comp.bh = comp.y1 - comp.y0 + 1
      comp.diag = Math.hypot(comp.bw, comp.bh)
      comp.ux = 0; comp.uy = 0; comp.len = 0
      list.push(comp)
    }
  }
  return list
}

/** 用二阶矩求细长块的主轴方向与长度（对角短划也必须算对，不能只看 bbox 长短边） */
function axisOf(c: Comp, W: number) {
  let mxx = 0, mxy = 0, myy = 0
  for (let k = 0; k < c.pix.length; k++) {
    const x = c.pix[k] % W, y = (c.pix[k] / W) | 0
    const dx = x - c.cx, dy = y - c.cy
    mxx += dx * dx; mxy += dx * dy; myy += dy * dy
  }
  mxx /= c.n; mxy /= c.n; myy /= c.n
  const th = 0.5 * Math.atan2(2 * mxy, mxx - myy)
  const ux = Math.cos(th), uy = Math.sin(th)
  let minT = 1e9, maxT = -1e9
  for (let k = 0; k < c.pix.length; k++) {
    const x = c.pix[k] % W, y = (c.pix[k] / W) | 0
    const t = (x - c.cx) * ux + (y - c.cy) * uy
    if (t < minT) minT = t
    if (t > maxT) maxT = t
  }
  return { ux, uy, len: maxT - minT }
}

/**
 * 挑字母：小连通域里，几个"共线且首尾相接"的细长块 = 一条虚线的短划，留下；
 * 其余小块 = 字母，抹掉。
 * 注意不能用"实心度（墨迹占 bbox 比例）"来分：对角短划的 bbox 接近正方形，实心度很低，
 * 会被当成字母一起抹掉，整条虚线就没了。
 */
export function stripText(comp: Comp[], W: number, diag: number, ink: Uint8Array, opt: VectorizeOpt) {
  const smallMax = opt.textMax ?? 0.16
  const bars: Comp[] = []
  for (const c of comp) {
    if (c.diag >= smallMax * diag) continue      // 大块 = 线网本体，留下
    const ax = axisOf(c, W)
    c.ux = ax.ux; c.uy = ax.uy; c.len = ax.len
    bars.push(c)
  }
  const used = new Array(bars.length).fill(false)
  const groups: Comp[][] = []
  const texts: Comp[] = []
  for (let a = 0; a < bars.length; a++) {
    if (used[a]) continue
    const grp = [bars[a]]
    used[a] = true
    let grow = true
    while (grow) {
      grow = false
      for (let k = 0; k < bars.length; k++) {
        if (used[k]) continue
        const B = bars[k]
        for (const A of grp) {
          if (Math.abs(A.ux * B.ux + A.uy * B.uy) < 0.985) continue
          const vx = B.cx - A.cx, vy = B.cy - A.cy
          const d = Math.hypot(vx, vy)
          if (d > 8 + 6 * Math.max(A.len, B.len)) continue
          if (Math.abs(vx * -A.uy + vy * A.ux) > 4) continue      // 到 A 所在直线的垂距
          const tB = vx * A.ux + vy * A.uy
          if (Math.abs(tB) > 0.5 * (A.len + B.len) + 14) continue  // 沿轴方向的间距
          grp.push(B); used[k] = true; grow = true; break
        }
        if (grow) break
      }
    }
    if (grp.length >= 3) groups.push(grp)
    else for (const c of grp) texts.push(c)
  }
  const out = ink.slice()
  for (const c of texts) for (const p of c.pix) out[p] = 0
  const anchors = texts.map((c) => ({ x: c.cx, y: c.cy, pix: c.pix, x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 }))
  return { ink: out, anchors, dashGroups: groups.length, barCount: bars.length, textCount: texts.length }
}

// ---------- Zhang-Suen 细化 ----------
export function thin(src: Uint8Array, W: number, H: number) {
  const w = W + 2, h = H + 2
  const img = new Uint8Array(w * h)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) img[(y + 1) * w + (x + 1)] = src[y * W + x]
  let changed = true, guard = 0
  while (changed && guard++ < 60) {
    changed = false
    for (let step = 0; step < 2; step++) {
      const del: number[] = []
      for (let yy = 1; yy < h - 1; yy++) {
        for (let xx = 1; xx < w - 1; xx++) {
          const i = yy * w + xx
          if (!img[i]) continue
          const p2 = img[i - w], p3 = img[i - w + 1], p4 = img[i + 1], p5 = img[i + w + 1],
                p6 = img[i + w], p7 = img[i + w - 1], p8 = img[i - 1], p9 = img[i - w - 1]
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (B < 2 || B > 6) continue
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
          let A = 0
          for (let q = 0; q < 8; q++) if (seq[q] === 0 && seq[q + 1] === 1) A++
          if (A !== 1) continue
          if (step === 0) { if (p2 * p4 * p6 || p4 * p6 * p8) continue }
          else { if (p2 * p4 * p8 || p2 * p6 * p8) continue }
          del.push(i)
        }
      }
      if (del.length) { changed = true; for (const i of del) img[i] = 0 }
    }
  }
  const out = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + x] = img[(y + 1) * w + (x + 1)]
  return out
}

// ---------- 骨架 → 节点 + 路径 ----------
/** 岔路判定用"交叉数"：8 邻域绕一圈 0→1 的次数，路径点恒为 2、端点 1、三岔 3。
 *  不能用"邻域分组数"——斜线的台阶点（W 与 S 互为 8 邻）会被算成 1 组，于是整条斜线
 *  每个台阶都成了岔路口，一条直线被切成十几段。 */
function crossNum(sk: Uint8Array, p: number, W: number, H: number) {
  const x = p % W, y = (p / W) | 0
  const s = [0, 0, 0, 0, 0, 0, 0, 0]
  const dxs = [0, 1, 1, 1, 0, -1, -1, -1], dys = [-1, -1, 0, 1, 1, 1, 0, -1]
  for (let q = 0; q < 8; q++) {
    const xx = x + dxs[q], yy = y + dys[q]
    if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
    if (sk[yy * W + xx]) s[q] = 1
  }
  let a = 0
  for (let q = 0; q < 8; q++) if (s[q] === 0 && s[(q + 1) % 8] === 1) a++
  return a
}

interface SkGraph { nodes: { cx: number; cy: number }[]; paths: { pts: [number, number][]; aId: number; bId: number }[]; stubs: Int32Array }

export function buildGraph(sk: Uint8Array, W: number, H: number): SkGraph {
  const nbrs = (i: number) => {
    const x = i % W, y = (i / W) | 0, a: number[] = []
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const j = ny * W + nx
      if (sk[j]) a.push(j)
    }
    return a
  }
  const pix: number[] = []
  for (let i = 0; i < W * H; i++) if (sk[i]) pix.push(i)
  const isNode = new Uint8Array(W * H)
  for (const p of pix) if (crossNum(sk, p, W, H) !== 2) isNode[p] = 1
  const nodeId = new Int32Array(W * H).fill(-1)
  const nodes: { cx: number; cy: number }[] = []
  for (const s of pix) {
    if (!isNode[s] || nodeId[s] >= 0) continue
    const id = nodes.length
    const stack = [s], members: number[] = []
    nodeId[s] = id
    while (stack.length) {
      const j = stack.pop() as number
      members.push(j)
      for (const k of nbrs(j)) if (isNode[k] && nodeId[k] < 0) { nodeId[k] = id; stack.push(k) }
    }
    let sx = 0, sy = 0
    for (const m of members) { sx += m % W; sy += (m / W) | 0 }
    nodes.push({ cx: sx / members.length, cy: sy / members.length })
  }
  const usedPix = new Uint8Array(W * H)
  /** 邻域按"彼此 8 相邻"分组；优先走别的一组，实在没有才在 prev 那组里继续（骨架局部 2px 宽） */
  const groupNeighbors = (N: number[]) => {
    const n = N.length, seen = new Array(n).fill(false), out: number[][] = []
    for (let i = 0; i < n; i++) {
      if (seen[i]) continue
      const stack = [i], grp: number[] = []
      seen[i] = true
      while (stack.length) {
        const k = stack.pop() as number
        grp.push(N[k])
        const ax = N[k] % W, ay = (N[k] / W) | 0
        for (let j = 0; j < n; j++) {
          if (seen[j]) continue
          const bx = N[j] % W, by = (N[j] / W) | 0
          if (Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1) { seen[j] = true; stack.push(j) }
        }
      }
      out.push(grp)
    }
    return out
  }
  const nextPixel = (cur: number, prev: number) => {
    const gs = groupNeighbors(nbrs(cur))
    let gi = -1
    for (let i = 0; i < gs.length; i++) for (const q of gs[i]) if (q === prev) gi = i
    for (let i = 0; i < gs.length; i++) {
      if (i === gi) continue
      for (const q of gs[i]) if (!usedPix[q]) return q
    }
    if (gi >= 0) for (const q of gs[gi]) if (q !== prev && !usedPix[q]) return q
    return -1
  }
  const paths: SkGraph['paths'] = []
  for (const start of pix) {
    if (!isNode[start]) continue
    for (const grp of groupNeighbors(nbrs(start))) {
      let first = -1
      for (const q of grp) if (!usedPix[q]) { first = q; break }
      if (first < 0 || isNode[first]) continue
      const pts: [number, number][] = [[start % W, (start / W) | 0]]
      let prev = start, cur = first, guard = 0
      usedPix[first] = 1
      while (guard++ < 500000) {
        pts.push([cur % W, (cur / W) | 0])
        if (isNode[cur]) break
        const nx = nextPixel(cur, prev)
        if (nx < 0) break
        usedPix[nx] = 1; prev = cur; cur = nx
      }
      const last = pts[pts.length - 1]
      const lastPix = last[1] * W + last[0]
      paths.push({ pts, aId: nodeId[start], bId: isNode[lastPix] ? nodeId[lastPix] : -1 })
    }
  }
  // 只有"引出 >= 2 条路径"的节点才算顶点；度 1 的节点是自由端（短划的端头、线的断头）
  const stubs = new Int32Array(nodes.length)
  for (const p of paths) { stubs[p.aId]++; if (p.bId >= 0) stubs[p.bId]++ }
  for (const p of paths) {
    if (p.aId >= 0 && stubs[p.aId] < 2) p.aId = -1
    if (p.bId >= 0 && stubs[p.bId] < 2) p.bId = -1
  }
  return { nodes, paths, stubs }
}

// ---------- Douglas-Peucker ----------
export function rdp(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length < 3) return pts.slice()
  const dist = (p: [number, number], a: [number, number], b: [number, number]) => {
    const vx = b[0] - a[0], vy = b[1] - a[1]
    const len2 = vx * vx + vy * vy
    if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
    let t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy))
  }
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [i0, i1] = stack.pop() as [number, number]
    let best = -1, bd = eps
    for (let i = i0 + 1; i < i1; i++) {
      const dd = dist(pts[i], pts[i0], pts[i1])
      if (dd > bd) { bd = dd; best = i }
    }
    if (best > 0) { keep[best] = 1; stack.push([i0, best]); stack.push([best, i1]) }
  }
  const out: [number, number][] = []
  for (let j = 0; j < pts.length; j++) if (keep[j]) out.push(pts[j])
  return out
}

function plen(pts: [number, number][]) {
  let L = 0
  for (let i = 0; i + 1 < pts.length; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
  return L
}

// ---------- 主流程 ----------

/** 识别框的四条边上有没有墨迹（用抹掉字母之后的墨迹量，字母贴边不算问题，线条被切断才是） */
function clippedEdges(ink: Uint8Array, W: number, box: [number, number, number, number]) {
  const [x0, y0, x1, y1] = box
  let top = 0, bottom = 0, left = 0, right = 0
  for (let x = x0; x < x1; x++) {
    if (ink[y0 * W + x]) top++
    if (ink[(y1 - 1) * W + x]) bottom++
  }
  for (let y = y0; y < y1; y++) {
    if (ink[y * W + x0]) left++
    if (ink[y * W + x1 - 1]) right++
  }
  return { top, bottom, left, right }
}

function vectorizeFromInk(m: { ink: Uint8Array; W: number; H: number; box: [number, number, number, number] }, opt: VectorizeOpt = {}): VectorizeResult {
  const W = m.W, H = m.H, box = m.box
  const diag = Math.hypot(box[2] - box[0], box[3] - box[1])
  const comp = components(m.ink, W, H, box)
  const st = stripText(comp, W, diag, m.ink, opt)
  const clipped = opt.crop ? clippedEdges(st.ink, W, box) : undefined
  // 被抹掉的那些小块其实是字母 —— 顺手认一下（模板匹配，见 glyphOcr.ts）
  const labels = recognizeLabels(W, st.anchors)
  const sk = thin(st.ink, W, H)
  const G = buildGraph(sk, W, H)

  const freeA = (p: SkGraph['paths'][number]) => p.aId < 0 && p.bId < 0
  const spur = opt.spur ?? 6
  const paths = G.paths.filter((P) => freeA(P) || (P.aId >= 0 && P.bId >= 0) || plen(P.pts) > spur)

  interface Seg { a: [number, number]; b: [number, number]; len: number; aId: number; bId: number }
  const segs: Seg[] = []
  for (const P of paths) {
    if (P.pts.length < 2) continue
    const poly = rdp(P.pts, opt.eps ?? 2.2)
    for (let k = 0; k < poly.length - 1; k++) {
      const a = poly[k], b = poly[k + 1]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (len < 2) continue
      segs.push({ a, b, len, aId: k === 0 ? P.aId : -1, bId: k === poly.length - 2 ? P.bId : -1 })
    }
  }

  // 虚线：两端悬空的短段按共线连成链
  const maxPiece = (opt.pieceMax ?? 0.115) * diag
  const linkOK = (A: Seg, B: Seg) => {
    let ux = A.b[0] - A.a[0], uy = A.b[1] - A.a[1]
    const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul
    let vx = B.b[0] - B.a[0], vy = B.b[1] - B.a[1]
    const vl = Math.hypot(vx, vy) || 1; vx /= vl; vy /= vl
    if (Math.abs(ux * vx + uy * vy) < 0.985) return false
    const perp = (p: [number, number]) => Math.abs((p[0] - A.a[0]) * -uy + (p[1] - A.a[1]) * ux)
    if (perp(B.a) > 4 || perp(B.b) > 4) return false
    const along = (p: [number, number]) => (p[0] - A.a[0]) * ux + (p[1] - A.a[1]) * uy
    const b0 = along(B.a), b1 = along(B.b)
    const lo = Math.min(b0, b1), hi = Math.max(b0, b1)
    const gap = Math.max(0 - hi, lo - ul)
    return gap <= Math.max(20, 3.5 * Math.max(ul, vl))
  }
  const freeSegs: Seg[] = [], fixedSegs: Seg[] = []
  for (const s of segs) {
    if (s.aId < 0 && s.bId < 0 && s.len <= maxPiece) freeSegs.push(s)
    else fixedSegs.push(s)
  }
  const usedS = new Array(freeSegs.length).fill(false)
  const chains: Seg[][] = [], leftover: Seg[] = []
  for (let f = 0; f < freeSegs.length; f++) {
    if (usedS[f]) continue
    const chain = [freeSegs[f]]
    usedS[f] = true
    let grow = true
    while (grow) {
      grow = false
      for (let g = 0; g < freeSegs.length; g++) {
        if (usedS[g]) continue
        const B = freeSegs[g]
        if (chain.some((A) => linkOK(A, B) || linkOK(B, A))) { chain.push(B); usedS[g] = true; grow = true; break }
      }
    }
    if (chain.length >= 2) chains.push(chain)
    else leftover.push(chain[0])
  }

  interface Edge { aId: number; bId: number; a: [number, number]; b: [number, number]; dash: 0 | 1 }
  const edges: Edge[] = []
  for (const s of fixedSegs) edges.push({ aId: s.aId, bId: s.bId, a: s.a, b: s.b, dash: 0 })
  for (const s of leftover) edges.push({ aId: -1, bId: -1, a: s.a, b: s.b, dash: 0 })
  for (const C of chains) {
    let ux = C[0].b[0] - C[0].a[0], uy = C[0].b[1] - C[0].a[1]
    const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul
    const base = C[0].a
    let best0 = C[0].a, best1 = C[0].b, minT = 1e9, maxT = -1e9
    for (const e of C) {
      for (const q of [e.a, e.b]) {
        const t = (q[0] - base[0]) * ux + (q[1] - base[1]) * uy
        if (t < minT) { minT = t; best0 = q }
        if (t > maxT) { maxT = t; best1 = q }
      }
    }
    edges.push({ aId: -1, bId: -1, a: best0, b: best1, dash: 1 })
  }

  // 顶点
  const verts: { x: number; y: number }[] = []
  const nodeVert = new Int32Array(G.nodes.length).fill(-1)
  for (let i = 0; i < G.nodes.length; i++) {
    if (G.stubs[i] < 2) continue
    nodeVert[i] = verts.length
    verts.push({ x: G.nodes[i].cx, y: G.nodes[i].cy })
  }
  const snapR = opt.snapR ?? 14
  const nearest = (x: number, y: number, r: number) => {
    let bi = -1, bd = r
    for (let i = 0; i < verts.length; i++) {
      const d = Math.hypot(verts[i].x - x, verts[i].y - y)
      if (d < bd) { bd = d; bi = i }
    }
    return bi
  }
  const addV = (x: number, y: number) => { verts.push({ x, y }); return verts.length - 1 }
  let outEdges: [number, number, number][] = []
  for (const E of edges) {
    let ai = E.aId >= 0 ? nodeVert[E.aId] : nearest(E.a[0], E.a[1], snapR)
    if (ai < 0) ai = addV(E.a[0], E.a[1])
    let bi = E.bId >= 0 ? nodeVert[E.bId] : nearest(E.b[0], E.b[1], snapR)
    if (bi < 0) bi = addV(E.b[0], E.b[1])
    if (ai === bi) continue
    if (Math.hypot(verts[ai].x - verts[bi].x, verts[ai].y - verts[bi].y) < 4) continue
    outEdges.push([ai, bi, E.dash])
  }

  const mergeVerts = (r: number) => {
    let again = true
    while (again) {
      again = false
      outer:
      for (let i = 0; i < verts.length; i++) {
        for (let j = i + 1; j < verts.length; j++) {
          if (Math.hypot(verts[i].x - verts[j].x, verts[i].y - verts[j].y) >= r) continue
          verts[i].x = (verts[i].x + verts[j].x) / 2
          verts[i].y = (verts[i].y + verts[j].y) / 2
          for (const e of outEdges) {
            if (e[0] === j) e[0] = i
            if (e[1] === j) e[1] = i
          }
          verts.splice(j, 1)
          // 删掉一个顶点后，比它大的下标全要前移，否则边会指到不存在的顶点上
          for (const e of outEdges) {
            if (e[0] > j) e[0]--
            if (e[1] > j) e[1]--
          }
          again = true
          break outer
        }
      }
    }
  }
  const dedupe = () => {
    const seenE: Record<string, number> = {}
    const out: [number, number, number][] = []
    for (const E of outEdges) {
      if (E[0] === E[1]) continue
      const key = Math.min(E[0], E[1]) + '_' + Math.max(E[0], E[1])
      if (seenE[key] !== undefined) { if (E[2] === 0) out[seenE[key]][2] = 0; continue }
      seenE[key] = out.length
      out.push(E)
    }
    outEdges = out
  }
  mergeVerts(opt.mergeR ?? 8)
  dedupe()

  // 解消十字交叉：度为 4 且两两反向共线 = 两条线交叉，不是顶点
  for (let guard = 0; guard < 200; guard++) {
    const inc: number[][] = verts.map(() => [])
    outEdges.forEach((e, i) => { inc[e[0]].push(i); inc[e[1]].push(i) })
    let acted = false
    for (let v = 0; v < verts.length; v++) {
      if (inc[v].length !== 4) continue
      const dirs = inc[v].map((ei) => {
        const E = outEdges[ei]
        const o = E[0] === v ? E[1] : E[0]
        const dx = verts[o].x - verts[v].x, dy = verts[o].y - verts[v].y
        const L = Math.hypot(dx, dy) || 1
        return { ei, o, dx: dx / L, dy: dy / L }
      })
      const pairs: { ei: number; o: number }[][] = []
      const used2 = [false, false, false, false]
      let okAll = true
      for (let a = 0; a < 4; a++) {
        if (used2[a]) continue
        let found = -1
        for (let b = a + 1; b < 4; b++) {
          if (used2[b]) continue
          if (dirs[a].dx * dirs[b].dx + dirs[a].dy * dirs[b].dy < -0.97) { found = b; break }
        }
        if (found < 0) { okAll = false; break }
        used2[a] = used2[found] = true
        pairs.push([dirs[a], dirs[found]])
      }
      if (!okAll) continue
      const dropSet: Record<number, number> = {}
      const add: [number, number, number][] = []
      for (const [p1, p2] of pairs) {
        dropSet[p1.ei] = 1; dropSet[p2.ei] = 1
        add.push([p1.o, p2.o, (outEdges[p1.ei][2] || outEdges[p2.ei][2]) ? 1 : 0])
      }
      const kept = outEdges.filter((_, i) => !dropSet[i]).map((e) => e.slice() as [number, number, number])
      outEdges = kept.concat(add)
      verts.splice(v, 1)
      for (const e of outEdges) {
        if (e[0] > v) e[0]--
        if (e[1] > v) e[1]--
      }
      acted = true
      break
    }
    if (!acted) break
  }
  dedupe()
  mergeVerts(opt.mergeR ?? 8)
  dedupe()

  // 虚线的短划天然够不到交点（差着一两个划的间距），沿自身方向往外延长，吸附到近旁的顶点上
  const findAlong = (p: { x: number; y: number }, dx: number, dy: number) => {
    const r = opt.extendR ?? 72
    const deg = new Array(verts.length).fill(0)
    for (const e of outEdges) { deg[e[0]]++; deg[e[1]]++ }
    let best = -1, bestJ = -1, bd = 1e9, bdJ = 1e9
    for (let i = 0; i < verts.length; i++) {
      const vx = verts[i].x - p.x, vy = verts[i].y - p.y
      const d = Math.hypot(vx, vy)
      if (d < 3 || d > r) continue
      if ((vx / d) * dx + (vy / d) * dy < 0.9) continue          // 偏离方向 25° 以上不要
      // 岔路口（度 >= 2）比"上一条短划的断头"更可能是这条虚线真正的落点
      if (deg[i] >= 2) { if (d < bdJ) { bdJ = d; bestJ = i } }
      else if (d < bd) { bd = d; best = i }
    }
    return bestJ >= 0 ? bestJ : best
  }
  const extendDashed = () => {
    for (const E of outEdges) {
      if (!E[2]) continue
      const A = verts[E[0]], B = verts[E[1]]
      let dx = B.x - A.x, dy = B.y - A.y
      const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L
      const na = findAlong(A, -dx, -dy), nb = findAlong(B, dx, dy)
      if (na >= 0 && na !== E[1]) E[0] = na
      if (nb >= 0 && nb !== E[0]) E[1] = nb
    }
    outEdges = outEdges.filter((e) => e[0] !== e[1])
  }

  // 度 2 且几乎在一条直线上的顶点 = 直线被切出来的假顶点
  const collinearSimplify = () => {
    for (let guard = 0; guard < 500; guard++) {
      const inc: number[][] = verts.map(() => [])
      outEdges.forEach((e, i) => { inc[e[0]].push(i); inc[e[1]].push(i) })
      let acted = false
      for (let v = 0; v < verts.length; v++) {
        if (inc[v].length !== 2) continue
        const e1 = outEdges[inc[v][0]], e2 = outEdges[inc[v][1]]
        const a = e1[0] === v ? e1[1] : e1[0]
        const b = e2[0] === v ? e2[1] : e2[0]
        if (a === b) continue
        const ux = verts[v].x - verts[a].x, uy = verts[v].y - verts[a].y
        const wx = verts[b].x - verts[v].x, wy = verts[b].y - verts[v].y
        const lu = Math.hypot(ux, uy) || 1, lw = Math.hypot(wx, wy) || 1
        if ((ux / lu) * (wx / lw) + (uy / lu) * (wy / lw) < 0.995) continue   // 真有转折，保留
        const dash = (e1[2] && e2[2]) ? 1 : 0
        const kept = outEdges.filter((_, i) => i !== inc[v][0] && i !== inc[v][1]).map((e) => e.slice() as [number, number, number])
        kept.push([a, b, dash])
        outEdges = kept
        verts.splice(v, 1)
        for (const e of outEdges) {
          if (e[0] > v) e[0]--
          if (e[1] > v) e[1]--
        }
        acted = true
        break
      }
      if (!acted) break
    }
  }

  // 过短的边：两端其实是一个点
  const contractShort = (maxLen: number) => {
    for (let guard = 0; guard < 300; guard++) {
      let acted = false
      for (const E of outEdges) {
        const A2 = verts[E[0]], B2 = verts[E[1]]
        if (Math.hypot(A2.x - B2.x, A2.y - B2.y) > maxLen) continue
        A2.x = (A2.x + B2.x) / 2; A2.y = (A2.y + B2.y) / 2
        const j = E[1], k = E[0]
        for (const e of outEdges) {
          if (e[0] === j) e[0] = k
          if (e[1] === j) e[1] = k
        }
        verts.splice(j, 1)
        for (const e of outEdges) {
          if (e[0] > j) e[0]--
          if (e[1] > j) e[1]--
        }
        dedupe()
        acted = true
        break
      }
      if (!acted) break
    }
  }
  const dropIsolated = () => {
    const used = new Array(verts.length).fill(false)
    for (const e of outEdges) { used[e[0]] = true; used[e[1]] = true }
    for (let v = verts.length - 1; v >= 0; v--) {
      if (used[v]) continue
      verts.splice(v, 1)
      for (const e of outEdges) {
        if (e[0] > v) e[0]--
        if (e[1] > v) e[1]--
      }
    }
  }

  // 把 (x,y) 吸附到最近的骨架像素，用来取"边上真正的点"
  const snapSkel = (x: number, y: number): [number, number] | null => {
    let bx = x, by = y, bd = 1e9
    const x0 = Math.max(0, Math.round(x) - 7), x1 = Math.min(W - 1, Math.round(x) + 7)
    const y0 = Math.max(0, Math.round(y) - 7), y1 = Math.min(H - 1, Math.round(y) + 7)
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        if (!sk[yy * W + xx]) continue
        const d = (xx - x) * (xx - x) + (yy - y) * (yy - y)
        if (d < bd) { bd = d; bx = xx; by = yy }
      }
    }
    return bd < 64 ? [bx, by] : null
  }
  /** 交点精修：粗线在拐角处细化后骨架的"角"会往里缩一圈（实测偏 2%~3%）。
   *  用交于该点的各条边的直线做最小二乘求交，把顶点推回真正的角上。
   *  边的方向必须取"边上两个真实骨架点"——拿两个顶点算方向是白算的
   *  （那样的直线必然过当前顶点，解出来还是原位）。 */
  const refineCorners = (maxMove: number) => {
    for (let it = 0; it < 4; it++) {
      const inc: number[][] = verts.map(() => [])
      for (const e of outEdges) { inc[e[0]].push(e[1]); inc[e[1]].push(e[0]) }
      let moved = false
      for (let v = 0; v < verts.length; v++) {
        if (inc[v].length < 2) continue
        let a = 0, bb = 0, c = 0, rx = 0, ry = 0, used = 0
        for (const o of inc[v]) {
          const dx = verts[o].x - verts[v].x, dy = verts[o].y - verts[v].y
          const L = Math.hypot(dx, dy)
          if (L < 10) continue
          const p1 = snapSkel(verts[v].x + dx * 0.35, verts[v].y + dy * 0.35)
          const p2 = snapSkel(verts[v].x + dx * 0.7, verts[v].y + dy * 0.7)
          let ux: number, uy: number, px: number, py: number
          if (p1 && p2 && Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) > 3) {
            ux = p2[0] - p1[0]; uy = p2[1] - p1[1]
            const ul = Math.hypot(ux, uy); ux /= ul; uy /= ul
            px = p1[0]; py = p1[1]
          } else {
            ux = dx / L; uy = dy / L; px = verts[o].x; py = verts[o].y
          }
          const nx = -uy, ny = ux                       // 边的法向
          a += nx * nx; bb += nx * ny; c += ny * ny
          const dot = nx * px + ny * py
          rx += nx * dot; ry += ny * dot
          used++
        }
        if (used < 2) continue
        const det = a * c - bb * bb
        // 病态保护：两条入射边接近平行时，最小二乘的交点会跑到很远的地方，
        // 实测会把一个顶点甩到另一个顶点身上（相距 3px），手柄直接叠死、那个点就再也点不到了。
        // 用行列式相对量级判断条件数，太病态就干脆不动这个顶点。
        const scale = a + c
        if (Math.abs(det) < 1e-9 || Math.abs(det) < 0.02 * scale * scale) continue
        const X = (c * rx - bb * ry) / det
        const Y = (a * ry - bb * rx) / det
        let ddx = X - verts[v].x, ddy = Y - verts[v].y
        const dd = Math.hypot(ddx, ddy)
        if (dd < 0.4) continue
        if (dd > maxMove) { ddx *= maxMove / dd; ddy *= maxMove / dd }
        verts[v].x += ddx; verts[v].y += ddy
        moved = true
      }
      if (!moved) break
    }
  }

  extendDashed()
  collinearSimplify()
  contractShort((opt.short ?? 0.035) * diag)
  mergeVerts(opt.mergeR ?? 8)
  dropIsolated()
  dedupe()
  refineCorners((opt.refine ?? 0.03) * diag)
  // 精修会把顶点挪位置，**挪完必须再合并一次** —— 否则可能留下两个几乎重合的顶点，
  // 它们的手柄叠在一起，用户会有一个点点不到也拖不动
  mergeVerts(opt.mergeR ?? 8)
  dropIsolated()
  dedupe()

  const bw = box[2] - box[0], bh = box[3] - box[1]
  const points: number[] = []
  for (const v of verts) {
    points.push(+((v.x - box[0]) / bw).toFixed(4), +((v.y - box[1]) / bh).toFixed(4))
  }
  let dashN = 0
  for (const e of outEdges) if (e[2]) dashN++
  return {
    W: bw, H: bh, box, imgW: W, imgH: H,
    points,
    edges: outEdges,
    anchors: labels.map((L) => ({
      x: +((L.cx - box[0]) / bw).toFixed(4),
      y: +((L.cy - box[1]) / bh).toFixed(4),
      text: L.text,
      conf: +L.conf.toFixed(3),
    })),
    stats: { verts: verts.length, edges: outEdges.length, dash: dashN, text: st.textCount, bars: st.barCount, dashGroups: st.dashGroups, clipped },
  }
}

/** 保留原有同步 API，供模板工具与旧调用方使用；编辑弹窗优先走后台 Worker。 */
export function vectorizeImage(img: HTMLImageElement, opt: VectorizeOpt = {}): VectorizeResult {
  return vectorizeFromInk(toInk(img, opt.crop), opt)
}
