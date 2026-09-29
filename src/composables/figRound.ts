/**
 * 【v1738】复刻往返：**同一个图形，用三种来源各做一份"骨架"，再互相比对** ✓
 *
 * 为什么要有它：我们到昨天为止只会"报数"（边长比 / 角度 / 与题干对账 ✓），
 *   但**没有一个"像不像"的判据** ✗ —— 也就是 Math2GGB 每个例子都做的 **Rendered to Image** 那一步 ✓
 *
 * 三种骨架来源（覆盖我们两条复刻路径 ✓）：
 *   ① `skFromScan`  —— 题图识别结果（归一化 0~1 ✓）        【真图复刻：输入端】
 *   ② `skFromBoard` —— GeoGebra 板上的真身（已读出的坐标 + 命令串 ✓）【真图复刻：建完端 ✓】
 *   ③ `skFromSvg`   —— 我们自己的图形组件导出的 SVG 文本 ✓     【模板化复刻：渲染端 ✓】
 * 比对前统一**归一化**（按包围盒等比缩放到同尺度 ✓ 保长宽比 ✓ —— 这样"长宽比对不对"也能查出来 ✓）
 *
 * 纯函数 ✓（探针能盯 ✓；读板上坐标那一步在 ggbExec 里做 ✓）
 */

import type { ScanFig } from './figScan'

export interface SkPoint { name: string; x: number; y: number }
export interface SkEdge { a: string; b: string; dashed: boolean }
export interface SkCircle { cx: number; cy: number; r: number }
export interface Skeleton { points: SkPoint[]; edges: SkEdge[]; circles: SkCircle[] }

/** 等比归一化：缩放到"最长边 = 1"并让包围盒贴原点 ✓（**保长宽比** ✓ 不拉伸 ✗） */
export function skNormalize(s: Skeleton): Skeleton {
  const P = (s && s.points) || []
  if (P.length < 1) return { points: P.slice(), edges: (s && s.edges) || [], circles: (s && s.circles) || [] }
  const xs = P.map((p) => p.x)
  const ys = P.map((p) => p.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const w = Math.max(...xs) - minX
  const h = Math.max(...ys) - minY
  const k = 1 / Math.max(w, h, 1e-6)
  return {
    points: P.map((p) => ({ name: p.name, x: (p.x - minX) * k, y: (p.y - minY) * k })),
    edges: ((s && s.edges) || []).map((e) => ({ a: e.a, b: e.b, dashed: !!e.dashed })),
    circles: ((s && s.circles) || []).map((c) => ({ cx: (c.cx - minX) * k, cy: (c.cy - minY) * k, r: c.r * k })),
  }
}

/** ① 识别结果 → 骨架 ✓ */
export function skFromScan(f: ScanFig, opt: { flipY?: boolean } = {}): Skeleton {
  // 【v1738】识别坐标是**图像方向**（y 向下 ✗）→ 默认翻成数学方向 ✓（不然跟绘图板永远上下镜像 ✗）
  const flip = opt.flipY !== false
  const P = (f && f.points) || []
  return {
    points: P.map((p) => ({ name: p.name, x: p.x, y: flip ? -p.y : p.y })),
    edges: ((f && f.edges) || []).map((e) => ({ a: (P[e.a] ? P[e.a].name : String(e.a)), b: (P[e.b] ? P[e.b].name : String(e.b)), dashed: !!e.dashed })),
    circles: ((f && f.circles) || []).map((c) => ({ cx: c.cx, cy: flip ? -c.cy : c.cy, r: (c.rx + c.ry) / 2 })),
  }
}

/**
 * ② 板上真身 → 骨架 ✓（坐标与命令串由调用方读好 ✓ 纯函数 ✓）
 *  · 有坐标的当点 ✓
 *  · 命令串认得出 `Segment/Line/Ray` 的当边 ✓（参数里的对象名就是端点 ✓）
 *  · `Circle/Line` 之类没有"两个端点"的，按圆处理（半径认不出就跳过 ✓ 宁缺勿错 ✗）
 */
export function skFromBoard(items: { name: string; x?: number; y?: number; def?: string; kind?: string; r?: number }[]): Skeleton {
  const points: SkPoint[] = []
  const edges: SkEdge[] = []
  const circles: SkCircle[] = []
  const byName: Record<string, SkPoint> = {}
  for (const it of items || []) {
    if (!it || !it.name) continue
    if (Number.isFinite(it.x as number) && Number.isFinite(it.y as number)) {
      const p = { name: it.name, x: it.x as number, y: it.y as number }
      points.push(p)
      byName[it.name] = p
    }
  }
  for (const it of items || []) {
    const k = String((it && it.kind) || '')
    const def = String((it && it.def) || '')
    if (k === 'Segment' || k === 'Line' || k === 'Ray' || k === 'Vector') {
      const inner = def.slice(def.indexOf('(') + 1, def.lastIndexOf(')'))
      const args = inner.split(',').map((x) => x.trim())
      if (args.length >= 2 && byName[args[0]] && byName[args[1]]) edges.push({ a: args[0], b: args[1], dashed: false })
    } else if (k === 'Circle' && Number.isFinite(it.r as number)) {
      const c = byName[it.name]
      if (c) circles.push({ cx: c.x, cy: c.y, r: it.r as number })
    }
  }
  return { points, edges, circles }
}

/** ③ SVG 文本 → 骨架 ✓（认 circle / line / polyline / polygon / rect / path 的 M-L 折线 ✓ 够我们用 ✓） */
export function skFromSvg(svg: unknown, opt: { flipY?: boolean } = {}): Skeleton {
  // 【v1738】SVG 也是 y 向下 ✗ → 同样默认翻成数学方向 ✓
  const flipSvg = opt.flipY !== false
  const src = String(svg == null ? '' : svg)
  const points: SkPoint[] = []
  const edges: SkEdge[] = []
  const circles: SkCircle[] = []
  const num = (s: string, k: string): number => {
    const m = new RegExp('\\b' + k + '\\s*=\\s*"([-\\d.eE+]+)"').exec(s)
    return m ? Number(m[1]) : NaN
  }
  const pushPt = (x: number, y: number): number => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return -1
    points.push({ name: 'P' + (points.length + 1), x, y: flipSvg ? -y : y })
    return points.length - 1
  }
  const tags = src.match(/<(circle|line|polyline|polygon|rect|path)\b[^>]*>/gi) || []
  for (const tag of tags) {
    const name = (/^<(\w+)/.exec(tag) || [])[1] || ''
    const low = name.toLowerCase()
    if (low === 'circle') {
      const cx = num(tag, 'cx')
      const cy = num(tag, 'cy')
      const r = num(tag, 'r')
      if (Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(r)) circles.push({ cx, cy: flipSvg ? -cy : cy, r })
      continue
    }
    if (low === 'line') {
      const i = pushPt(num(tag, 'x1'), num(tag, 'y1'))
      const j = pushPt(num(tag, 'x2'), num(tag, 'y2'))
      if (i >= 0 && j >= 0) edges.push({ a: 'P' + (i + 1), b: 'P' + (j + 1), dashed: /stroke-dasharray/i.test(tag) })
      continue
    }
    if (low === 'rect') {
      const x = num(tag, 'x')
      const y = num(tag, 'y')
      const w = num(tag, 'width')
      const h = num(tag, 'height')
      if ([x, y, w, h].every((v) => Number.isFinite(v))) {
        const a = pushPt(x, y)
        const b = pushPt(x + w, y)
        const c = pushPt(x + w, y + h)
        const d = pushPt(x, y + h)
        if ([a, b, c, d].every((i) => i >= 0)) {
          const n = (i: number) => 'P' + (i + 1)
          edges.push({ a: n(a), b: n(b), dashed: false }, { a: n(b), b: n(c), dashed: false }, { a: n(c), b: n(d), dashed: false }, { a: n(d), b: n(a), dashed: false })
        }
      }
      continue
    }
    /* polyline / polygon：points="x1,y1 x2,y2 …" ✓ */
    const pts = (/points\s*=\s*"([^"]*)"/i.exec(tag) || [])[1]
    if (pts) {
      const nums = pts.split(/[\s,]+/).map(Number).filter((v) => Number.isFinite(v))
      const idx: number[] = []
      for (let i = 0; i + 1 < nums.length; i += 2) idx.push(pushPt(nums[i], nums[i + 1]))
      for (let i = 0; i + 1 < idx.length; i++) if (idx[i] >= 0 && idx[i + 1] >= 0) edges.push({ a: 'P' + (idx[i] + 1), b: 'P' + (idx[i + 1] + 1), dashed: /stroke-dasharray/i.test(tag) })
      if (low === 'polygon' && idx.length > 2 && idx[0] >= 0 && idx[idx.length - 1] >= 0) {
        edges.push({ a: 'P' + (idx[idx.length - 1] + 1), b: 'P' + (idx[0] + 1), dashed: /stroke-dasharray/i.test(tag) })
      }
      continue
    }
    /* path：只认 M/L 的折线（贝塞尔曲线交给"顶点对得上"那一档 ✓ 不硬凑 ✗） */
    const d = (/d\s*=\s*"([^"]*)"/i.exec(tag) || [])[1]
    if (!d) continue
    const idx: number[] = []
    const re = /([ML])\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(d))) idx.push(pushPt(Number(m[2]), Number(m[3])))
    for (let i = 0; i + 1 < idx.length; i++) if (idx[i] >= 0 && idx[i + 1] >= 0) edges.push({ a: 'P' + (idx[i] + 1), b: 'P' + (idx[i + 1] + 1), dashed: /stroke-dasharray/i.test(tag) })
  }
  return { points, edges, circles }
}

export interface SkDiff {
  /** 对得上的点 ✓ */
  matched: string[]
  /** 位置偏了的点（归一化距离 > 容差 ✓） */
  moved: { name: string; d: number }[]
  /** 原图有、板上没有 ✗ */
  missing: string[]
  /** 板上多出来的 ✓（不一定是错 ✓ 如辅助线 ✓） */
  extra: string[]
  /** 边对不上（缺边 / 虚实不符 ✓） */
  edgeBad: string[]
  /** 圆的个数对不对 ✓ */
  circleBad: string
  /** 0~1 的总分（点 + 边 + 圆 ✓） */
  score: number
}

/** 【v1738】两份骨架比对（都先归一化 ✓ 保长宽比 ✓）—— 纯函数 ✓ 探针盯着 */
export function skDiff(want: Skeleton, got: Skeleton, tol = 0.06): SkDiff {
  const W = skNormalize(want)
  const G = skNormalize(got)
  const gm: Record<string, SkPoint> = {}
  for (const p of G.points) gm[p.name] = p
  const matched: string[] = []
  const moved: { name: string; d: number }[] = []
  const missing: string[] = []
  for (const p of W.points) {
    const g = gm[p.name]
    if (!g) { missing.push(p.name); continue }
    const d = Math.sqrt((g.x - p.x) * (g.x - p.x) + (g.y - p.y) * (g.y - p.y))
    if (Number.isFinite(d) && d <= tol) matched.push(p.name)
    else moved.push({ name: p.name, d: Math.round(d * 1000) / 1000 })
  }
  const extra = G.points.filter((p) => !W.points.some((q) => q.name === p.name)).map((p) => p.name)
  const key = (a: string, b: string) => (a < b ? a + '|' + b : b + '|' + a)
  const wantEdges: Record<string, boolean> = {}
  for (const e of W.edges) wantEdges[key(e.a, e.b)] = !!e.dashed
  const gotEdges: Record<string, boolean> = {}
  for (const e of G.edges) gotEdges[key(e.a, e.b)] = !!e.dashed
  const edgeBad: string[] = []
  for (const k in wantEdges) {
    if (!(k in gotEdges)) { edgeBad.push(k.replace('|', '') + ' 缺边'); continue }
    if (wantEdges[k] !== gotEdges[k]) edgeBad.push(k.replace('|', '') + ' 虚实不符')
  }
  let circleBad = ''
  if (W.circles.length || G.circles.length) {
    if (W.circles.length !== G.circles.length) circleBad = '圆个数：原图 ' + W.circles.length + ' / 板上 ' + G.circles.length + ' ✗'
    else {
      const wr = W.circles.map((c) => c.r).sort((a, b) => a - b)
      const gr = G.circles.map((c) => c.r).sort((a, b) => a - b)
      const off = wr.filter((r, i) => Math.abs(gr[i] - r) > tol)
      if (off.length) circleBad = '有 ' + off.length + ' 个圆半径对不上 ✗'
    }
  }
  const tot = W.points.length + W.edges.length + (W.circles.length ? 1 : 0)
  const good = matched.length + (W.edges.length - edgeBad.length) + (W.circles.length && !circleBad ? 1 : 0)
  const score = tot > 0 ? Math.max(0, Math.min(1, Math.round((good / tot) * 1000) / 1000)) : 0
  return { matched, moved, missing, extra, edgeBad, circleBad, score }
}

/** 【v1738】给老师看的一段话 ✓ */
export function skLines(d: SkDiff): string[] {
  const out: string[] = []
  out.push('复刻往返：对得上 ' + d.score.toFixed(3) + '（1 = 完全一致 ✓）—— 点 ' + d.matched.length + ' 个 ✓' +
    (d.moved.length ? ' · 偏了 ' + d.moved.length + ' 个 ✗' : '') +
    (d.missing.length ? ' · 缺 ' + d.missing.length + ' 个 ✗' : '') +
    (d.edgeBad.length ? ' · 边不对 ' + d.edgeBad.length + ' 条 ✗' : '') +
    (d.circleBad ? ' · ' + d.circleBad : ''))
  if (d.moved.length) out.push('· 位置偏了：' + d.moved.map((m) => m.name + '（差 ' + m.d + '）').join('、') + ' ✗')
  if (d.missing.length) out.push('· 板上没有：' + d.missing.join('、') + ' ✗')
  if (d.edgeBad.length) out.push('· 边：' + d.edgeBad.join('；') + ' ✗')
  if (d.extra.length) out.push('· 板上多出来的：' + d.extra.slice(0, 12).join('、') + (d.extra.length > 12 ? ' …' : '') + ' ✓（多出来的不一定是错 ✓ 辅助线也算 ✓）')
  return out
}
