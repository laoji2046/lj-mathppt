/**
 * 【v1730】图 → 几何要素：把「矢量识别」的结果（点 / 边 / 字母 / 弧）变成**模型能用的结构描述** ✓
 *
 * 为什么：让视觉模型看着照片"估坐标"是最不准的一环 ✗
 *   项目里已经有一整套「线稿 → 图元 + 字母识别」（src/composables/vectorize.ts + glyphOcr.ts ✓）
 *   —— 把它认出来的**真点、真线段、真圆**喂给解题，比让模型看图猜位置稳得多 ✓
 *
 * 本文件**只做纯函数**（不 import vectorize 的实现，只 import 它的类型 ✓ 探针里能单独 require ✓）
 */
import type { VectorizeResult } from './vectorize'

export interface ScanPoint { name: string; x: number; y: number }
export interface ScanEdge { a: number; b: number; dashed: boolean }
export interface ScanCircle { cx: number; cy: number; rx: number; ry: number }
export interface ScanFig { points: ScanPoint[]; edges: ScanEdge[]; circles: ScanCircle[]; labelled: number }

/** 【v1730】矢量识别结果 → 几何要素（坐标是**相对识别框**归一化的 0~1 ✓）—— 纯函数 ✓ 探针能盯 */
export function scanFromResult(res: VectorizeResult | null | undefined): ScanFig {
  const raw = (res && res.points) || []
  const points: ScanPoint[] = []
  for (let i = 0; i + 1 < raw.length; i += 2) {
    points.push({ name: "P" + (points.length + 1), x: Number(raw[i]) || 0, y: Number(raw[i + 1]) || 0 })
  }
  // 字母标注 → 贴到最近的顶点上（6% 框内才算 ✓ 太远的不硬贴 ✗）
  const anchors = (res && res.anchors) || []
  let labelled = 0
  for (const a of anchors) {
    const t = String((a && a.text) || "").trim()
    if (!t) continue
    let best = -1
    let bestD = 0.06
    points.forEach((p, i) => {
      const d = Math.sqrt((p.x - a.x) * (p.x - a.x) + (p.y - a.y) * (p.y - a.y))
      if (d < bestD) { bestD = d; best = i }
    })
    if (best >= 0 && /^P[0-9]+$/.test(points[best].name)) {
      points[best].name = t.slice(0, 4)
      labelled++
    }
  }
  const edges: ScanEdge[] = ((res && res.edges) || [])
    .filter((e) => points[e[0]] && points[e[1]])
    .map((e) => ({ a: e[0], b: e[1], dashed: !!e[2] }))
  const circles: ScanCircle[] = []
  for (const a of ((res && res.arcs) || []) as unknown as Record<string, number | undefined>[]) {
    const cx = Number(a && a.cx)
    const cy = Number(a && a.cy)
    const rx = Number(a && (a.rx ?? a.r))
    const ry = Number(a && (a.ry ?? a.r ?? a.rx))
    if (Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(rx) && rx > 0) {
      circles.push({ cx, cy, rx, ry: Number.isFinite(ry) && ry > 0 ? ry : rx })
    }
  }
  return { points, edges, circles, labelled }
}

/** 两点之间的距离（归一化坐标 ✓） */
function dist(f: ScanFig, a: number, b: number): number {
  const p = f.points[a], q = f.points[b]
  return Math.sqrt((p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y))
}

/** 边的方向角（度，0~180 ✓） */
function angleDeg(f: ScanFig, e: ScanEdge): number {
  const p = f.points[e.a], q = f.points[e.b]
  const a = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI
  return ((a % 180) + 180) % 180
}

/** 边的名字（用顶点名 ✓ 虚线标出来 ✓） */
function edgeName(f: ScanFig, e: ScanEdge): string {
  return f.points[e.a].name + f.points[e.b].name + (e.dashed ? "（虚线）" : "")
}

function shared(_f: ScanFig, x: ScanEdge, y: ScanEdge): boolean {
  return x.a === y.a || x.a === y.b || x.b === y.a || x.b === y.b
}

/**
 * 【v1730】几何要素 → 人话结构描述（顶点坐标 + 线段 + 圆/弧 + 关系 ✓）—— 纯函数 ✓ 探针盯着
 *  关系只写**有把握**的（阈值宽 ✓ 宁缺勿错 ✗）：水平 / 竖直 / 垂直 / 等长 / 点在圆上
 */
export function describeScan(f: ScanFig): string[] {
  const out: string[] = []
  const P = (f && f.points) || []
  if (!P.length) return ["（没认出图形元素）"]
  out.push("顶点（坐标已归一化到 0~1）：" + P.map((p) => p.name + "(" + p.x.toFixed(2) + "," + p.y.toFixed(2) + ")").join("、"))
  if (f.edges.length) out.push("线段：" + f.edges.map((e) => edgeName(f, e)).join("、"))
  for (const c of f.circles) {
    const round = Math.abs(c.rx - c.ry) / Math.max(c.rx, c.ry) < 0.15
    out.push(
      (round ? "圆：" : "椭圆弧：") + "圆心(" + c.cx.toFixed(2) + "," + c.cy.toFixed(2) + ")" +
      (round ? " 半径 " + c.rx.toFixed(2) : " 半轴 " + c.rx.toFixed(2) + "×" + c.ry.toFixed(2)),
    )
  }
  const rel: string[] = []
  for (const e of f.edges) {
    const ang = angleDeg(f, e)
    const rad = (ang * Math.PI) / 180
    if (Math.abs(Math.sin(rad)) < 0.05) rel.push(edgeName(f, e) + " 水平")
    else if (Math.abs(Math.cos(rad)) < 0.05) rel.push(edgeName(f, e) + " 竖直")
  }
  for (let i = 0; i < f.edges.length; i++) {
    for (let j = i + 1; j < f.edges.length; j++) {
      const x = f.edges[i], y = f.edges[j]
      if (!shared(f, x, y)) continue
      const d = Math.abs(angleDeg(f, x) - angleDeg(f, y))
      if (Math.abs(d - 90) <= 6) rel.push(edgeName(f, x) + " ⊥ " + edgeName(f, y))
      const lx = dist(f, x.a, x.b), ly = dist(f, y.a, y.b)
      if (lx > 0.02 && ly > 0.02 && Math.abs(lx / ly - 1) <= 0.05) rel.push(edgeName(f, x) + " = " + edgeName(f, y))
    }
  }
  for (const c of f.circles) {
    const round = Math.abs(c.rx - c.ry) / Math.max(c.rx, c.ry) < 0.15
    if (!round) continue
    for (let i = 0; i < P.length; i++) {
      const d = Math.sqrt((P[i].x - c.cx) * (P[i].x - c.cx) + (P[i].y - c.cy) * (P[i].y - c.cy))
      if (c.rx > 0.02 && Math.abs(d / c.rx - 1) <= 0.06) rel.push(P[i].name + " 在圆上")
    }
  }
  if (rel.length) out.push("关系（按识别结果推算，有容差 ✓）：" + rel.slice(0, 14).join("；"))
  return out
}

/** 【v1730】结构描述 → 写进校对框的那一段（**先说清是自动识别的、与题干冲突以题干为准** ✓） */
export function scanToBrief(f: ScanFig): string {
  const NL2 = String.fromCharCode(10)
  return "【图形（自动识别，可能有个别偏差 —— 与题干冲突时以**题干**为准）】" + NL2 +
    describeScan(f).map((x) => "- " + x).join(NL2)
}
