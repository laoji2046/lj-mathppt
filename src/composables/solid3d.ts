// 三维多面体：以“归一化顶点 + 边拓扑 + 面”统一建模。
// 顶点为 [0,1]×[0,1] 归一化平面坐标（斜投影）；边支持按拓扑默认虚实，也可逐边覆盖（线型/粗细/颜色）；
// 顶点可标注字母（_ 下标、^ 上标、' 撇），用于数学立体几何作图。
import type { MathFigureElement, FigureArc } from '@/types'

/** 弦式曲线的控制点下标（兼容老的 i0/i1 写法） */
function arcIdx(a: FigureArc): number[] | null {
  if (a.pts && a.pts.length >= 2) return a.pts
  if (a.i0 !== undefined && a.i1 !== undefined) return [a.i0, a.i1]
  return null
}

function circleFromChord(A: [number, number], B: [number, number], bulge0: number) {
  const c = Math.hypot(B[0] - A[0], B[1] - A[1])
  if (c < 1) return null
  const bulge = Math.max(-0.5, Math.min(0.5, bulge0))
  const s = bulge * c
  if (Math.abs(s) < 0.5) return null
  const R = (c * c / 4 + s * s) / (2 * Math.abs(s))
  const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2
  const ux = (B[1] - A[1]) / c, uy = -(B[0] - A[0]) / c
  const sign = s > 0 ? 1 : -1
  const cx = mx - ux * (R - Math.abs(s)) * sign
  const cy = my - uy * (R - Math.abs(s)) * sign
  const want: [number, number] = [mx + ux * Math.abs(s) * sign, my + uy * Math.abs(s) * sign]
  return { cx, cy, r: R, want }
}

function circleFrom3(A: [number, number], B: [number, number], C: [number, number]) {
  const d = 2 * (A[0] * (B[1] - C[1]) + B[0] * (C[1] - A[1]) + C[0] * (A[1] - B[1]))
  if (Math.abs(d) < 1e-6) return null
  const a2 = A[0] * A[0] + A[1] * A[1], b2 = B[0] * B[0] + B[1] * B[1], c2 = C[0] * C[0] + C[1] * C[1]
  const cx = (a2 * (B[1] - C[1]) + b2 * (C[1] - A[1]) + c2 * (A[1] - B[1])) / d
  const cy = (a2 * (C[0] - B[0]) + b2 * (A[0] - C[0]) + c2 * (B[0] - A[0])) / d
  return { cx, cy, r: Math.hypot(A[0] - cx, A[1] - cy), want: B }
}

/** 沿圆从 A 走到 B，取**靠近 want 那一侧**的弧，采样成点列 */
function sampleCircle(c: { cx: number; cy: number; r: number; want: [number, number] }, A: [number, number], B: [number, number]): [number, number][] {
  const norm = (t: number) => { let v = t % (Math.PI * 2); if (v < 0) v += Math.PI * 2; return v }
  const a0 = Math.atan2(A[1] - c.cy, A[0] - c.cx)
  const a1 = Math.atan2(B[1] - c.cy, B[0] - c.cx)
  const span = norm(a1 - a0)
  const mk = (from: number, sweep: number) => {
    const N = Math.max(10, Math.min(72, Math.ceil(Math.abs(sweep) * c.r / 6)))
    const res: [number, number][] = []
    for (let k = 0; k <= N; k++) {
      const t = from + sweep * (k / N)
      res.push([c.cx + c.r * Math.cos(t), c.cy + c.r * Math.sin(t)])
    }
    return res
  }
  const A2 = mk(a0, span), B2 = mk(a0, span - Math.PI * 2)
  const dist = (list: [number, number][]) => {
    const mid = list[list.length >> 1]
    return Math.hypot(mid[0] - c.want[0], mid[1] - c.want[1])
  }
  return dist(A2) <= dist(B2) ? A2 : B2
}

/** Catmull-Rom：平滑通过所有控制点（4 个点以上时用） */
function catmullRom(P: [number, number][], per = 12): [number, number][] {
  const out: [number, number][] = [P[0]]
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] ?? P[i]
    const p1 = P[i], p2 = P[i + 1]
    const p3 = P[i + 2] ?? P[i + 1]
    for (let s = 1; s <= per; s++) {
      const t = s / per, t2 = t * t, t3 = t2 * t
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ])
    }
  }
  return out
}

/** 弦式曲线 → 采样点列（单位 = “点坐标 × 传进来的 w/h”）。
 *  2 个控制点用 bulge 的圆；**3 个控制点用过三点的圆**（往弧上加控制点时形状完全不变）；4 个以上用 Catmull-Rom。 */
export function arcPolyline(a: FigureArc, points: number[] | undefined, w: number, h: number): [number, number][] {
  const idx = arcIdx(a)
  // **自由式椭圆弧**（没有顶点下标，直接给 cx/cy/rx/ry/rot/a0/a1）—— 三维投影出来的底面圆走这条。
  // 漏了它的话，圆柱/圆锥的底面会整条不显示（踩过）。
  if (!idx) {
    if (a.cx === undefined || a.cy === undefined || a.rx === undefined || a.ry === undefined) return []
    const cx = a.cx * w, cy = a.cy * h, rx = a.rx * w, ry = a.ry * h
    const rot = a.rot || 0, cp = Math.cos(rot), sp = Math.sin(rot)
    const a0 = a.a0 ?? 0, a1 = a.a1 ?? Math.PI * 2
    const span = a1 - a0
    const N = Math.max(16, Math.min(140, Math.ceil(Math.abs(span) * Math.max(rx, ry) / 4)))
    const out: [number, number][] = []
    for (let k = 0; k <= N; k++) {
      const t = a0 + (span * k) / N
      const x = rx * Math.cos(t), y = ry * Math.sin(t)
      out.push([cx + x * cp - y * sp, cy + x * sp + y * cp])
    }
    return out
  }
  if (!points) return []
  const P: [number, number][] = []
  for (const k of idx) {
    if (k < 0 || k * 2 + 1 >= points.length) return []
    P.push([points[k * 2] * w, points[k * 2 + 1] * h])
  }
  if (P.length < 2) return []
  if (P.length === 2) {
    // 半椭圆：长半轴 = 弦长的一半，短半轴 = |拱高|，只画拱向那一侧的半圈。
    // 圆台/圆锥/圆柱的底面在斜二测里就是这种半椭圆。
    if (a.ellipse) {
      const c = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1])
      const bulge = Math.max(-0.5, Math.min(0.5, a.bulge ?? 0))
      if (c < 1 || Math.abs(bulge) < 0.02) return P
      const A2 = c / 2, B2 = Math.abs(bulge) * c, sign = bulge >= 0 ? 1 : -1
      const cx = (P[0][0] + P[1][0]) / 2, cy = (P[0][1] + P[1][1]) / 2
      const ux = (P[1][0] - P[0][0]) / c, uy = (P[1][1] - P[0][1]) / c
      const vx = uy, vy = -ux
      const N = 44
      const out: [number, number][] = []
      for (let k = 0; k <= N; k++) {
        const t = Math.PI * (k / N)
        out.push([cx + ux * A2 * Math.cos(t) + vx * B2 * sign * Math.sin(t), cy + uy * A2 * Math.cos(t) + vy * B2 * sign * Math.sin(t)])
      }
      return out
    }
    const c = circleFromChord(P[0], P[1], a.bulge ?? 0)
    return c ? sampleCircle(c, P[0], P[1]) : P
  }
  if (P.length === 3) {
    const c = circleFrom3(P[0], P[1], P[2])
    if (c) return sampleCircle(c, P[0], P[2])
  }
  return catmullRom(P)
}

/** 弦式弧（两个顶点 + 拱高）→ 自由式的圆心/半径/角度。
 *  拱高 s = bulge × 弦长 c，半径 R = (c²/4 + s²) / (2s)，圆心在中点沿垂线偏 (R − s) 处。
 *  bulge 的正负决定鼓向哪一边；bulge ≈ 0 时退化成直线，这时候不画（返回 null）。 */
export function resolveArc(a: FigureArc, points: number[] | undefined, w: number, h: number): Required<Pick<FigureArc, 'cx' | 'cy' | 'rx' | 'ry'>> & { rot: number; a0: number; a1: number; dash?: 0 | 1 } | null {
  if (a.i0 === undefined || a.i1 === undefined) {
    if (a.cx === undefined || a.cy === undefined || a.rx === undefined || a.ry === undefined) return null
    return { cx: a.cx, cy: a.cy, rx: a.rx, ry: a.ry, rot: a.rot || 0, a0: a.a0 || 0, a1: a.a1 === undefined ? Math.PI * 2 : a.a1, dash: a.dash }
  }
  if (!points || a.i0 * 2 + 1 >= points.length || a.i1 * 2 + 1 >= points.length) return null
  // 用元素尺寸还原成像素坐标来算（几何要在真实比例下做，不然归一化后不是圆）
  const ax = points[a.i0 * 2] * w, ay = points[a.i0 * 2 + 1] * h
  const bx = points[a.i1 * 2] * w, by = points[a.i1 * 2 + 1] * h
  const c = Math.hypot(bx - ax, by - ay)
  if (c < 1) return null
  // 拱高夹在 ±0.5（= 半圆）以内：再大弧就变优弧，几何会翻到另一侧，
  // 而且界面上的"拱高"控制本来也不会需要超过半圆
  const bulge = Math.max(-0.5, Math.min(0.5, a.bulge ?? 0))
  const s = bulge * c
  if (Math.abs(s) < 0.5) return null                       // 拱高太小 = 直线，不画
  const R = (c * c / 4 + s * s) / (2 * Math.abs(s))
  const mx = (ax + bx) / 2, my = (ay + by) / 2
  // 垂线单位向量：约定**正拱高朝"上"**（弦从左到右时往上鼓），跟界面里拖控制点的手感一致
  const ux = (by - ay) / c, uy = -(bx - ax) / c
  const sign = s > 0 ? 1 : -1
  // 拱顶在 mid + u·s 处，圆心在**拱顶再往外退一个半径**的地方 → mid − u·(R−|s|)·sign
  const cx = mx - ux * (R - Math.abs(s)) * sign
  const cy = my - uy * (R - Math.abs(s)) * sign
  const a0 = Math.atan2(ay - cy, ax - cx)
  const a1 = Math.atan2(by - cy, bx - cx)
  // 画"拱起那一侧"的短弧：把两个方向的中点都比一下，哪个离拱顶近就用哪个
  const want: [number, number] = [mx + ux * Math.abs(s) * sign, my + uy * Math.abs(s) * sign]
  const norm = (t: number) => { let v = t % (Math.PI * 2); if (v < 0) v += Math.PI * 2; return v }
  const span = norm(a1 - a0)
  const pA: [number, number] = [cx + R * Math.cos(a0 + span / 2), cy + R * Math.sin(a0 + span / 2)]
  const pB: [number, number] = [cx + R * Math.cos(a0 + (span - Math.PI * 2) / 2), cy + R * Math.sin(a0 + (span - Math.PI * 2) / 2)]
  const dA = Math.hypot(pA[0] - want[0], pA[1] - want[1])
  const dB = Math.hypot(pB[0] - want[0], pB[1] - want[1])
  const from = dA <= dB ? a0 : a1
  const to = dA <= dB ? a1 : a0
  return { cx: cx / w, cy: cy / h, rx: R / w, ry: R / h, rot: 0, a0: from, a1: to, dash: a.dash }
}

/** 弧 / 曲线 → SVG path（采样成折线，够密就看不出折角）。
 *  归一化坐标，跟顶点同一套；**画布与导出都调这里**，别再各写一份。
 *  2/3 个控制点会还原成精确的圆，4 个以上按 Catmull-Rom 平滑通过所有点。 */
export function arcsSvg(arcs: FigureArc[] | undefined, w: number, h: number, stroke: string, strokeWidth: number, dash = '6 5', points?: number[]): string {
  if (!arcs || !arcs.length) return ''
  const sw = strokeWidth || 2
  let out = ''
  for (const a of arcs) {
    const list = arcPolyline(a, points, w, h)
    if (list.length < 2) continue
    let d = ''
    for (let k = 0; k < list.length; k++) d += (k ? ' L ' : 'M ') + list[k][0].toFixed(1) + ' ' + list[k][1].toFixed(1)
    // **平头（butt），不要圆头**：弧的两端正好落在母线上，圆头端帽会往外多出半个线宽，
    // 看着就是"圆弧冒到母线外面一小截"（用户报过）。教材里的虚线也是平头的。
    out += '<path d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="' + sw + '" stroke-linecap="butt"' + (a.dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>'
  }
  return out
}

export const SOLID_KINDS = ['cube', 'cubeOblique', 'cuboid', 'cuboidOblique', 'pyramid', 'pyramidOblique', 'prism', 'prismOblique', 'tetrahedron', 'pyraFrustum', 'octahedron', 'hexPrism', 'obliquePrism', 'triFrustum', 'hexPrismOblique',
  // 必修二 立体几何定理图形（线面平行判定/性质、面面垂直判定/性质）
  'thmLinePlanePara', 'thmLinePlaneProp', 'thmPlanePlanePerp', 'thmPlanePlaneProp'] as const
export const SOLID_VCOUNT: Record<string, number> = {
  cube: 8, cubeOblique: 8, cuboid: 8, cuboidOblique: 8, pyramid: 5, pyramidOblique: 5, prism: 6, prismOblique: 6,
  tetrahedron: 4, pyraFrustum: 8,
  octahedron: 6, hexPrism: 12, hexPrismOblique: 12, obliquePrism: 8, triFrustum: 6,
  thmLinePlanePara: 8, thmLinePlaneProp: 10, thmPlanePlanePerp: 8, thmPlanePlaneProp: 12,
}

type Edge = [number, number, 0 | 1]
export type EdgeStyle = { dash?: 'solid' | 'dash' | 'dot'; width?: number; color?: string; /** 在该边终点画箭头（坐标轴用） */ arrow?: boolean }
export type FaceStyle = { fill?: string; opacity?: number; hidden?: boolean }
export type SolidMesh = { edges: [number, number, number][]; faces: number[][] }

const FACES: Record<string, number[][]> = {
  cube: [[0, 1, 5, 4], [1, 2, 6, 5], [0, 1, 2, 3]],       // top / right / front
  cubeOblique: [[0, 1, 5, 4], [1, 2, 6, 5], [0, 1, 2, 3]],
  cuboid: [[0, 1, 5, 4], [1, 2, 6, 5], [0, 1, 2, 3]],
  cuboidOblique: [[0, 1, 5, 4], [1, 2, 6, 5], [0, 1, 2, 3]],
  pyramid: [[1, 2, 4, 3], [0, 1, 3], [0, 4, 2], [0, 3, 4]], // bottom / left / right / front
  pyramidOblique: [[1, 2, 4, 3], [0, 1, 3], [0, 4, 2], [0, 3, 4]],
  prism: [[0, 1, 2], [3, 4, 5]],
  prismOblique: [[0, 1, 2], [3, 4, 5]],
  tetrahedron: [[0, 1, 2], [3, 0, 2], [3, 1, 0], [3, 2, 1]],
  pyraFrustum: [[0, 1, 2, 3], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5], [4, 5, 6, 7], [0, 1, 5, 4]], // bottom / back / left / right / top / front
  obliquePrism: [[0, 1, 5, 4], [1, 2, 6, 5], [0, 1, 2, 3]],
  // 正八面体：背面 4 面 → 正面 4 面
  octahedron: [[0, 3, 5], [0, 5, 2], [1, 3, 5], [1, 5, 2], [0, 2, 4], [0, 4, 3], [1, 2, 4], [1, 4, 3]],
  // 正六棱柱：底 / 后 / 左后 / 右后 / 左前 / 右前 / 前 / 顶
  hexPrism: [[6, 7, 8, 9, 10, 11], [4, 5, 11, 10], [3, 4, 10, 9], [5, 0, 6, 11], [0, 1, 7, 6], [2, 3, 9, 8], [1, 2, 8, 7], [0, 1, 2, 3, 4, 5]],
  // 正三棱台：底 / 左后侧 / 右后侧 / 前面 / 顶
  triFrustum: [[0, 1, 2], [0, 1, 4, 3], [2, 0, 3, 5], [1, 2, 5, 4], [3, 4, 5]],
  // 斜二测正六棱柱：0-5 顶环、6-11 底环；可见面 = 顶面 + 三个"朝前"的侧面
  hexPrismOblique: [[0, 1, 2, 3, 4, 5], [3, 4, 10, 9], [4, 5, 11, 10], [5, 0, 6, 11]],
  // 定理图形：把"平面 α / 平面 β"作为可填充的四边形（其余是线，见 EDGES）
  thmLinePlanePara: [[0, 1, 2, 3]],
  thmLinePlaneProp: [[0, 1, 2, 3], [4, 5, 6, 7]],
  thmPlanePlanePerp: [[0, 1, 2, 3], [4, 6, 7, 5]],
  thmPlanePlaneProp: [[0, 1, 2, 3], [4, 5, 6, 7]],
}
const FOP: Record<string, number[]> = {
  cube: [0.8, 0.62, 1], cubeOblique: [0.8, 0.62, 1], cuboid: [0.8, 0.62, 1], cuboidOblique: [0.8, 0.62, 1],
  pyramid: [0.4, 0.75, 0.75, 0.9],
  pyramidOblique: [0.4, 0.75, 0.75, 0.9],
  prism: [0.9, 0.5],
  prismOblique: [0.9, 0.5],
  tetrahedron: [0.4, 0.86, 0.76, 0.66],
  pyraFrustum: [0.4, 0.5, 0.75, 0.75, 0.9, 0.85],
  obliquePrism: [0.8, 0.62, 1],
  octahedron: [0.5, 0.5, 0.4, 0.4, 0.9, 0.9, 0.8, 0.8],
  hexPrism: [0.35, 0.5, 0.6, 0.6, 0.85, 0.85, 0.9, 0.9],
  triFrustum: [0.35, 0.7, 0.7, 0.9, 0.9],
  hexPrismOblique: [1, 0.62, 0.8, 0.9],
  thmLinePlanePara: [0.22],
  thmLinePlaneProp: [0.22, 0.16],
  thmPlanePlanePerp: [0.22, 0.16],
  thmPlanePlaneProp: [0.22, 0.16],
}
/** 某立体的边表 [起,止,隐藏(1=图形中被遮挡)] —— 编辑器命中检测与渲染共用 */
export function solidEdges(kind: string): Edge[] { return EDGES[kind] || [] }
/** 某立体的面表（顶点索引环）—— 面命中检测与渲染共用 */
export function solidFaces(kind: string): number[][] { return FACES[kind] || [] }
/** 自由建模用的“完整面表”（含被遮挡的面），仅用于初始化 mesh；渲染仍按 mesh */
const MESH_FACES: Record<string, number[][]> = {
  // 顺序：远面先画、前面最后（半透明叠加更自然）
  cube: [[4, 5, 6, 7], [3, 2, 6, 7], [0, 3, 7, 4], [0, 1, 5, 4], [1, 2, 6, 5], [0, 1, 2, 3]],
  cubeOblique: [[4, 5, 6, 7], [3, 2, 6, 7], [0, 3, 7, 4], [0, 1, 5, 4], [1, 2, 6, 5], [0, 1, 2, 3]],
  cuboid: [[4, 5, 6, 7], [3, 2, 6, 7], [0, 3, 7, 4], [0, 1, 5, 4], [1, 2, 6, 5], [0, 1, 2, 3]],
  cuboidOblique: [[4, 5, 6, 7], [3, 2, 6, 7], [0, 3, 7, 4], [0, 1, 5, 4], [1, 2, 6, 5], [0, 1, 2, 3]],
  obliquePrism: [[4, 5, 6, 7], [3, 2, 6, 7], [0, 3, 7, 4], [0, 1, 5, 4], [1, 2, 6, 5], [0, 1, 2, 3]],
  prism: [[3, 4, 5], [0, 1, 4, 3], [2, 0, 3, 5], [1, 2, 5, 4], [0, 1, 2]],
  prismOblique: [[3, 4, 5], [0, 1, 4, 3], [2, 0, 3, 5], [1, 2, 5, 4], [0, 1, 2]],
  // 斜二测正六棱柱：底 / 六个侧面 / 顶（自由建模用；远面先画）
  hexPrismOblique: [[6, 7, 8, 9, 10, 11], [2, 3, 9, 8], [1, 2, 8, 7], [3, 4, 10, 9], [0, 1, 7, 6], [4, 5, 11, 10], [5, 0, 6, 11], [0, 1, 2, 3, 4, 5]],
}
/** 完整面表（自由建模初始化用） */
export function solidFacesAll(kind: string): number[][] {
  return MESH_FACES[kind] || FACES[kind] || []
}

/** 取边表：有自由建模 mesh 时用 mesh，否则用类型默认 */
export function meshEdges(kind: string, mesh?: SolidMesh | null): Edge[] {
  return (mesh && Array.isArray(mesh.edges)) ? (mesh.edges as Edge[]) : (EDGES[kind] || [])
}
/** 取面表：有自由建模 mesh 时用 mesh，否则用类型默认 */
export function meshFaces(kind: string, mesh?: SolidMesh | null): number[][] {
  return (mesh && Array.isArray(mesh.faces)) ? mesh.faces : (FACES[kind] || [])
}

const EDGES: Record<string, Edge[]> = {
  cube: [[0, 1, 0], [1, 2, 0], [2, 3, 0], [3, 0, 0], [0, 4, 0], [4, 5, 0], [1, 5, 0], [5, 6, 0], [6, 2, 0], [3, 7, 1], [7, 6, 1], [7, 4, 1]],
  cubeOblique: [[0, 1, 0], [1, 2, 0], [2, 3, 0], [3, 0, 0], [0, 4, 0], [4, 5, 0], [1, 5, 0], [5, 6, 0], [6, 2, 0], [3, 7, 1], [7, 6, 1], [7, 4, 1]],
  cuboid: [[0, 1, 0], [1, 2, 0], [2, 3, 0], [3, 0, 0], [0, 4, 0], [4, 5, 0], [1, 5, 0], [5, 6, 0], [6, 2, 0], [3, 7, 1], [7, 6, 1], [7, 4, 1]],
  cuboidOblique: [[0, 1, 0], [1, 2, 0], [2, 3, 0], [3, 0, 0], [0, 4, 0], [4, 5, 0], [1, 5, 0], [5, 6, 0], [6, 2, 0], [3, 7, 1], [7, 6, 1], [7, 4, 1]],
  pyramid: [[0, 3, 0], [0, 4, 0], [3, 4, 0], [3, 1, 0], [4, 2, 0], [1, 2, 1], [0, 1, 1], [0, 2, 1]],
  // 斜二测四棱锥：1、2 是靠里的两个底角 → 它们那三条棱（含后底边）画虚线
  pyramidOblique: [[0, 3, 0], [0, 4, 0], [3, 4, 0], [3, 1, 0], [4, 2, 0], [1, 2, 1], [0, 1, 1], [0, 2, 1]],
  prism: [[0, 1, 0], [1, 2, 0], [2, 0, 0], [0, 3, 0], [1, 4, 0], [2, 5, 0], [3, 4, 1], [4, 5, 1], [5, 3, 1]],
  // 斜二测三棱柱：底在后（2 是后排那个顶点）→ 两条后底边 + 那条后竖棱画虚线；顶面完全可见
  prismOblique: [[0, 1, 0], [1, 2, 1], [2, 0, 1], [0, 3, 0], [1, 4, 0], [2, 5, 1], [3, 4, 0], [4, 5, 0], [5, 3, 0]],
  tetrahedron: [[0, 1, 0], [3, 0, 0], [3, 1, 0], [0, 2, 1], [1, 2, 1], [3, 2, 1]],
  pyraFrustum: [[0, 1, 0], [1, 2, 0], [3, 0, 0], [4, 5, 0], [5, 6, 0], [7, 4, 0], [0, 4, 0], [1, 5, 0], [2, 3, 1], [6, 7, 1], [3, 7, 1], [2, 6, 1]],
  obliquePrism: [[0, 1, 0], [1, 2, 0], [2, 3, 0], [3, 0, 0], [0, 4, 0], [4, 5, 0], [1, 5, 0], [5, 6, 0], [6, 2, 0], [3, 7, 1], [7, 6, 1], [7, 4, 1]],
  // 正八面体：到后顶点 5 的 4 条边 + 后方两条赤道边（0=T 1=B 2=L 3=R 4=F 5=K后）
  octahedron: [[0, 2, 0], [0, 3, 0], [0, 4, 0], [1, 2, 0], [1, 3, 0], [1, 4, 0], [2, 4, 0], [4, 3, 0], [0, 5, 1], [1, 5, 1], [5, 2, 1], [5, 3, 1]],
  // 正六棱柱：后两条竖棱 + 底面后半 3 条（0-5 上，6-11 下）
  hexPrism: [[0, 1, 0], [1, 2, 0], [2, 3, 0], [3, 4, 0], [4, 5, 0], [5, 0, 0], [6, 7, 0], [7, 8, 0], [8, 9, 0], [0, 6, 0], [1, 7, 0], [2, 8, 0], [3, 9, 0], [4, 10, 1], [5, 11, 1], [9, 10, 1], [10, 11, 1], [11, 6, 1]],
  // 正三棱台：底面后两条 + 后棱（0,1,2 底；3,4,5 顶）
  triFrustum: [[1, 2, 0], [3, 4, 0], [4, 5, 0], [5, 3, 0], [1, 4, 0], [2, 5, 0], [0, 1, 1], [2, 0, 1], [0, 3, 1]],
  // 斜二测正六棱柱（0-5 顶、6-11 底）：靠里的两条底边 + 两条后竖棱画虚线；顶面 6 条全可见
  hexPrismOblique: [
    [0, 1, 0], [1, 2, 0], [2, 3, 0], [3, 4, 0], [4, 5, 0], [5, 0, 0],
    [0, 6, 0], [1, 7, 1], [2, 8, 1], [3, 9, 0], [4, 10, 0], [5, 11, 0],
    [6, 7, 1], [7, 8, 1], [8, 9, 1], [9, 10, 0], [10, 11, 0], [11, 6, 0],
  ],
  // ① 线面平行判定：平面 α(0-3) + α 内的直线 a(4,5) + α 外的直线 b(6,7)，a ∥ b ∥ AB
  thmLinePlanePara: [[0, 1, 0], [1, 2, 0], [2, 3, 0], [3, 0, 0], [4, 5, 0], [6, 7, 0]],
  // ② 线面平行性质：平面 α(0-3)、交线 b(4,5)、过 b 的平面 β(4,5,6,7)、β 内与 b 平行的 a(8,9)
  thmLinePlaneProp: [[0, 1, 0], [1, 2, 0], [2, 3, 0], [3, 0, 0], [4, 5, 0], [5, 6, 0], [6, 7, 0], [7, 4, 0], [8, 9, 0]],
  // ③ 面面垂直判定：平面 α(0-3)、α 的垂线 l(4-5)、过 l 的平面 β(4,6,7,5)
  thmPlanePlanePerp: [[0, 1, 0], [1, 2, 0], [2, 3, 0], [3, 0, 0], [4, 5, 0], [4, 6, 0], [6, 7, 0], [7, 5, 0]],
  // ④ 面面垂直性质：平面 α(0-3)、交线 m(4-5)、平面 β(4,5,6,7)、β 内垂直 m 的 a(8,9) + 直角记号(10,11)
  thmPlanePlaneProp: [
    [0, 1, 0], [1, 2, 0], [2, 3, 0], [3, 0, 0], [4, 5, 0], [5, 6, 0], [6, 7, 0], [7, 4, 0],
    [8, 9, 0], [8, 10, 0], [10, 11, 0],
  ],
}

/** 斜二测投影系数：水平面里"往里"1 个单位，画成 45° 朝右上、长度减半 */
const OBLIQ = 0.5 * Math.SQRT1_2
/** 斜二测放置器：把"平面坐标 (x 横、y 进深) + 高度 z"映射到元素框里（自动缩放 + 居中）。
 *  ⚠ 与"正面是真实大小的正方形/矩形"那套（cubeOblique）配合使用：这里管**水平面内的底板**，
 *  竖直方向永远是**真实长度**（z 直接减 k）。 */
function obliqPlacer(plane: [number, number][], hh: number, w: number, h: number) {
  const sx = plane.map(([x, y]) => x + y * OBLIQ)
  const sy = plane.map(([, y]) => -y * OBLIQ)
  const minX = Math.min(...sx), maxX = Math.max(...sx)
  const ys = [...sy, ...sy.map((v) => v - hh)]
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const k = Math.min((w * 0.92) / Math.max(1e-6, maxX - minX), (h * 0.92) / Math.max(1e-6, maxY - minY))
  const ox = (w - (maxX - minX) * k) / 2 - minX * k
  const oy = (h - (maxY - minY) * k) / 2 - minY * k
  return (x: number, y: number, z = 0): [number, number] => [x * k + y * OBLIQ * k + ox, oy - y * OBLIQ * k - z * k]
}

/** 定理图形里的"平面"：一个平行四边形（俯视平面）。x0,y0 = 前左下角；w2 宽；d2 进深（朝右上 45°） */
function planeQuad(x0: number, y0: number, w2: number, d2: number): [number, number][] {
  const dx = d2 * Math.SQRT1_2, dy = -d2 * Math.SQRT1_2
  return [[x0, y0], [x0 + w2, y0], [x0 + w2 + dx, y0 + dy], [x0 + dx, y0 + dy]]
}

/** 必修二立体几何**定理图形的默认字母**（插进来就带着，可再改）。
 *  索引 = 顶点序号；null = 不标。α / β 标在平面角上，a / b / l / m 标在直线的端点。 */
export const THM_LABELS: Record<string, (string | null)[]> = {
  // ① 线面平行判定：α(2)、a(5)、b(7)
  thmLinePlanePara: [null, null, 'α', null, null, 'a', null, 'b'],
  // ② 线面平行性质：α(2)、b(5)、β(6)、a(9)
  thmLinePlaneProp: [null, null, 'α', null, null, 'b', 'β', null, null, 'a'],
  // ③ 面面垂直判定：α(2)、O(4)、l(5)、β(7)
  thmPlanePlanePerp: [null, null, 'α', null, 'O', 'l', null, 'β'],
  // ④ 面面垂直性质：α(2)、m(5)、β(6)、a(9)
  thmPlanePlaneProp: [null, null, 'α', null, null, 'm', 'β', null, null, 'a', null, null],
}

/** 生成某立体在当前 w/h/depth 下的默认归一化顶点（与原几何一致） */
export function solidVerts(kind: string, w: number, h: number, depth?: number): number[] {
  let c: number[][] = []
  if (kind === 'cubeOblique') {
    // **斜二测画法**：正面画成**真实边长**的正方形；深度方向严格 **45°**、长度取边长的**一半**
    //   （人教版直观图画法）。depth 默认 0.4 就是标准斜二测；面板里调"深度"会按比例加长/缩短。
    const k = ((depth ?? 0.4) / 0.4) * 0.5            // 深度 = 边长 × k（默认 0.5 = 一半）
    const s = (Math.min(w, h) / (1 + k * Math.SQRT1_2)) * 0.92
    const dx = s * k * Math.SQRT1_2
    const dy = -dx                                     // 45° 朝右上
    const fx = (w - (s + dx)) / 2
    const fy = (h - (s + Math.abs(dy))) / 2 + Math.abs(dy)
    c = [
      [fx, fy], [fx + s, fy], [fx + s, fy + s], [fx, fy + s],
      [fx + dx, fy + dy], [fx + s + dx, fy + dy], [fx + s + dx, fy + s + dy], [fx + dx, fy + s + dy],
    ]
  } else if (kind === 'cuboidOblique') {
    // 斜二测长方体：正面是**真实大小**的矩形 A×C，进深 D（真实）画成 45°、长度取一半
    const A = 1.5, C = 1, D = (depth ?? 0.4) / 0.4
    const k = Math.min((w * 0.92) / (A + D * OBLIQ), (h * 0.92) / (C + D * OBLIQ))
    const aw = A * k, ch = C * k, dd = D * k
    const dx = dd * OBLIQ, dy = -dx
    const fx = (w - (aw + dx)) / 2, fy = (h - (ch + Math.abs(dy))) / 2 + Math.abs(dy)
    c = [[fx, fy], [fx + aw, fy], [fx + aw, fy + ch], [fx, fy + ch],
      [fx + dx, fy + dy], [fx + aw + dx, fy + dy], [fx + aw + dx, fy + ch + dy], [fx + dx, fy + ch + dy]]
  } else if (kind === 'pyramidOblique') {
    // 斜二测四棱锥：底面在水平面里（进深 45°、减半），顶点在底面中心正上方、高度真实
    const A = 1, B = 0.9, H2 = 0.95 * ((depth ?? 0.4) / 0.4)   // 深度参数 = 高矮
    const at = obliqPlacer([[-A / 2, B], [A / 2, B], [-A / 2, 0], [A / 2, 0]], H2, w, h)
    c = [at(0, B / 2, H2), at(-A / 2, B), at(A / 2, B), at(-A / 2, 0), at(A / 2, 0)]
  } else if (kind === 'prismOblique') {
    // 斜二测三棱柱：底面三角形在水平面里，三条竖棱真实长度（2 是后排那个底角）
    const S = 1, H2 = 0.95 * ((depth ?? 0.4) / 0.4)          // 深度参数 = 高矮
    const at = obliqPlacer([[-S / 2, 0], [S / 2, 0], [0, S * 0.85]], H2, w, h)
    c = [at(-S / 2, 0), at(S / 2, 0), at(0, S * 0.85),
      at(-S / 2, 0, H2), at(S / 2, 0, H2), at(0, S * 0.85, H2)]
  } else if (kind === 'hexPrismOblique') {
    // 斜二测正六棱柱：底面正六边形（上下两条边水平）在水平面里按斜二测压（45°、减半），
    //   六条侧棱竖直且长度真实。0-5 = 顶环、6-11 = 底环（与老 hexPrism 同一套编号）
    const R = 1
    const HH = 1.5 * ((depth ?? 0.4) / 0.4)                    // 深度参数 = 高矮
    const plane: [number, number][] = []
    for (let i = 0; i < 6; i++) {
      const a2 = (i * Math.PI) / 3
      plane.push([R * Math.cos(a2), R * Math.sin(a2)])
    }
    const at = obliqPlacer(plane, HH, w, h)
    c = [...plane.map(([x, y]) => at(x, y, HH)), ...plane.map(([x, y]) => at(x, y))]
  } else if (kind === 'thmLinePlanePara') {
    // ① 线面平行判定：平面 α(0-3)、α 内的直线 a(4,5)、α 外的直线 b(6,7)；a ∥ b ∥ AB
    const q = planeQuad(w * 0.06, h * 0.84, w * 0.60, h * 0.34)
    c = [...q, [w * 0.24, h * 0.70], [w * 0.56, h * 0.70], [w * 0.30, h * 0.24], [w * 0.62, h * 0.24]]
  } else if (kind === 'thmLinePlaneProp') {
    // ② 线面平行性质：α(0-3)、交线 b(4,5)、过 b 的平面 β(4,5,6,7)、β 内与 b 平行的 a(8,9)
    const q = planeQuad(w * 0.04, h * 0.86, w * 0.60, h * 0.30)
    const bx0 = w * 0.34, bx1 = w * 0.66, by = h * 0.70, ty = h * 0.18
    // a 与 b **同向平行**、整条落在 β 内（平行四边形的上边与下边等长，所以 a 只能比 b 略短）
    c = [...q, [bx0, by], [bx1, by], [bx1, ty], [bx0, ty], [bx0 + w * 0.05, h * 0.34], [bx1 - w * 0.05, h * 0.34]]
  } else if (kind === 'thmPlanePlanePerp') {
    // ③ 面面垂直判定：α(0-3)、α 的垂线 l(4→5)、过 l 的平面 β(4,6,7,5)
    const q = planeQuad(w * 0.04, h * 0.86, w * 0.58, h * 0.30)
    const ox = w * 0.38, oy = h * 0.72, rx = w * 0.64, uy = h * 0.62
    const ly = h * 0.16
    c = [...q, [ox, oy], [ox, ly], [rx, uy], [rx, uy - (oy - ly)]]
  } else if (kind === 'thmPlanePlaneProp') {
    // ④ 面面垂直性质：α(0-3)、交线 m(4,5)、平面 β(4,5,6,7)、β 内垂直 m 的 a(8,9)、直角记号(10,11)
    const q = planeQuad(w * 0.04, h * 0.88, w * 0.56, h * 0.28)
    const mx0 = w * 0.32, mx1 = w * 0.62, my = h * 0.72, ty = h * 0.16
    const ax = w * 0.44
    c = [...q, [mx0, my], [mx1, my], [mx1, ty], [mx0, ty],
      [ax, my], [ax, h * 0.30],
      [ax + w * 0.03, my], [ax + w * 0.03, my - h * 0.04]]
  } else if (kind === 'cube' || kind === 'cuboid') {
    const d = (depth ?? 0.4) * Math.min(w, h) * 0.4, dx = d, dy = -d * 0.8
    const side = kind === 'cube' ? Math.min(w, h) * 0.62 : 0
    const fw = kind === 'cube' ? side : w * 0.78, fh = kind === 'cube' ? side : h * 0.64
    const fx = (w - fw) / 2, fy = h * 0.16
    c = [[fx, fy], [fx + fw, fy], [fx + fw, fy + fh], [fx, fy + fh], [fx + dx, fy + dy], [fx + fw + dx, fy + dy], [fx + fw + dx, fy + fh + dy], [fx + dx, fy + fh + dy]]
  } else if (kind === 'pyramid') {
    const d = (depth ?? 0.4) * Math.min(w, h) * 0.4, dx = d, dy = -d * 0.8
    const wb = Math.min(w, h) * 0.42, cx = w / 2, botY = h * 0.78, apexY = h * 0.12
    c = [[cx, apexY], [cx - wb, botY - dy], [cx + wb, botY - dy], [cx - wb + dx, botY], [cx + wb + dx, botY]]
  } else if (kind === 'prism') {
    const d = (depth ?? 0.4) * Math.min(w, h) * 0.4, dx = d, dy = -d * 0.8
    const fx = w * 0.16, fy = h * 0.24, fw = w * 0.56, fh = h * 0.56
    c = [[fx, fy + fh], [fx + fw, fy + fh], [fx + fw / 2, fy], [fx + dx, fy + fh + dy], [fx + fw + dx, fy + fh + dy], [fx + fw / 2 + dx, fy + dy]]
  } else if (kind === 'tetrahedron') {
    const base = Math.min(w, h) * 0.42, cx = w / 2, cy = h / 2
    c = [[cx - base * 0.7, cy + base * 0.4], [cx + base * 0.7, cy + base * 0.4], [cx, cy - base * 0.4], [cx, cy - base * 0.9]]
  } else if (kind === 'pyraFrustum') {
    const mm = Math.min(w, h), d = (depth ?? 0.4) * mm * 0.4, dx = d, dy = -d * 0.8
    const wB = mm * 0.42, wT = mm * 0.26, cx = w / 2, botY = h * 0.74, topY = h * 0.26, bby = botY + dy, tby = topY + dy
    c = [[cx - wB, botY], [cx + wB, botY], [cx + wB + dx, bby], [cx - wB + dx, bby], [cx - wT, topY], [cx + wT, topY], [cx + wT + dx, tby], [cx - wT + dx, tby]]
  } else if (kind === 'octahedron') {
    const m = Math.min(w, h), cx = w / 2, cy = h / 2, rh = m * 0.34, rv = m * 0.40, e = m * 0.15
    c = [[cx, cy - rv], [cx, cy + rv], [cx - rh, cy], [cx + rh, cy], [cx, cy + e], [cx, cy - e]]
  } else if (kind === 'hexPrism') {
    const m = Math.min(w, h), cx = w / 2, rx = m * 0.30, ry = m * 0.13, topY = h * 0.24, botY = h * 0.78
    const hex = (cy: number) => {
      const a: number[][] = []
      for (let i = 0; i < 6; i++) {
        const ang = (i * Math.PI) / 3
        a.push([cx + rx * Math.cos(ang), cy + ry * Math.sin(ang)])
      }
      return a
    }
    c = [...hex(topY), ...hex(botY)]
  } else if (kind === 'obliquePrism') {
    const d = (depth ?? 0.4) * Math.min(w, h) * 0.4, dx = d * 1.7, dy = -d * 1.0
    const fx = w * 0.16, fy = h * 0.32, fw = w * 0.44, fh = h * 0.46
    c = [[fx, fy], [fx + fw, fy], [fx + fw, fy + fh], [fx, fy + fh], [fx + dx, fy + dy], [fx + fw + dx, fy + dy], [fx + fw + dx, fy + fh + dy], [fx + dx, fy + fh + dy]]
  } else if (kind === 'triFrustum') {
    const m = Math.min(w, h), cx = w / 2, rb = m * 0.40, rt = m * 0.24, topY = h * 0.26, botY = h * 0.76
    const tri = (cy: number, r: number) => {
      const a: number[][] = []
      for (let i = 0; i < 3; i++) {
        const ang = -Math.PI / 2 + (i * 2 * Math.PI) / 3
        a.push([cx + r * Math.cos(ang), cy + r * 0.5 * Math.sin(ang)])
      }
      return a
    }
    c = [...tri(botY, rb), ...tri(topY, rt)]
  }
  const out: number[] = []
  for (const p of c) out.push(p[0] / w, p[1] / h)
  return out
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
export function decodeLabel(s: string): { base: string; sub?: string; sup?: string } {
  const m = s.match(/^([^_^]*?)(?:_([^_^]*?))?(?:\^([^_^]*?))?$/)
  return m ? { base: m[1] || '', sub: m[2], sup: m[3] } : { base: s }
}
/** 顶点字母用的字体：教材 / 试卷上的数学字母是**衬线斜体**。
 *  不指定字体的话会落到界面默认的无衬线体上，看着像 UI 文字而不是数学标注，跟图形完全不搭。 */
export const LABEL_FONT = "'Times New Roman','Nimbus Roman','Liberation Serif',Cambria,Georgia,serif"

/** 顶点字母字号：跟着元素高度走 —— 原图里字母大多是图高的 7%~10%。
 *  固定 22px 在小图形上大得离谱、在大图形上又小得像注释。 */
export function labelFontSize(h: number) {
  return Math.max(11, Math.min(34, Math.round(h * 0.085)))
}
/** 字母默认压在顶点上方这么多像素（跟字号成比例，不然字号一大就贴到线上了） */
export function labelGap(fs: number) {
  return Math.round(fs * 0.62)
}
/** 一条标注大致占多宽（用来把它夹在框内，别被框裁掉） */
function labelHalfWidth(lab: string, fs: number, w: number) {
  return Math.min(w / 2, fs * 0.36 * Math.max(1, lab.length))
}

/** 顶点字母标注：A、A_1（下标）、B^2（上标）、A'…… 用 SVG tspan 排版 */
export function labelSvg(s: string, x: number, y: number, color: string, fs: number): string {
  const { base, sub, sup } = decodeLabel(s)
  // 白色描边当垫底（paint-order: stroke = 先描边后填字），压在线上也读得清 ——
  // 原图里 A 就是直接压在 AB / AD 那两条虚线上的
  const halo = ' font-family="' + LABEL_FONT + '" stroke="#fff" stroke-width="' + (fs * 0.14).toFixed(1) + '" stroke-linejoin="round" paint-order="stroke"'
  let t = '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" font-size="' + fs + '" font-style="italic" fill="' + color + '" text-anchor="middle"' + halo + '>' + esc(base)
  if (sub) t += '<tspan dy="' + (fs * 0.4).toFixed(1) + '" font-size="' + (fs * 0.72).toFixed(1) + '">' + esc(sub) + '</tspan>'
  if (sup) t += '<tspan dy="' + (sub ? (-1 * fs).toFixed(1) : (-fs * 0.42).toFixed(1)) + '" font-size="' + (fs * 0.72).toFixed(1) + '">' + esc(sup) + '</tspan>'
  t += '</text>'
  return t
}

/** 依据归一化顶点渲染该立体。可见边实线、隐藏边虚线；支持逐边覆盖与顶点字母。 */
/**
 * 顶点小圆点（教材风）。**编辑器画布、缩略图、导出、三维弹窗预览共用这一个函数** ——
 * 别各写一份：今天刚修过"两份实现迟早漂移"（数学图形在缩略图/演示里空白就是这么来的）。
 * 半径跟元素尺寸挂钩，缩放/改尺寸时比例不变。
 */
/** 【v1606】点的样式 ✓（照 `EdgeStyle` 的模式 ✓）
 *  `shape` 默认 `dot`（**实心圆** ✓）—— 不设就是原来的观感 ✓
 *  `size` 是**倍数** ✓（1 = 默认半径 ✓ 0.6 = 小 ✓ 1.8 = 特大 ✓）
 *    —— 存倍数而不是像素 ✗：元素被缩放后仍协调 ✓（存像素就会失调 ✓）
 *  `color` 空则跟随整体 `stroke` ✓ */
export type PointStyle = {
  shape?: 'dot' | 'ring' | 'square' | 'squareRing' | 'triangle' | 'diamond'
  size?: number
  color?: string
}
/** 单个点 → SVG ✓（6 种形状 ✓） */
function dotSvg(cx: number, cy: number, r: number, color: string, shape: string): string {
  const X = cx.toFixed(1)
  const Y = cy.toFixed(1)
  const R = r.toFixed(1)
  const sw = Math.max(1, r * 0.45).toFixed(1)
  switch (shape) {
    case 'ring':
      return '<circle cx="' + X + '" cy="' + Y + '" r="' + R + '" fill="none" stroke="' + color + '" stroke-width="' + sw + '"/>'
    case 'square':
      return '<rect x="' + (cx - r).toFixed(1) + '" y="' + (cy - r).toFixed(1) + '" width="' + (r * 2).toFixed(1) + '" height="' + (r * 2).toFixed(1) + '" fill="' + color + '"/>'
    case 'squareRing':
      return '<rect x="' + (cx - r).toFixed(1) + '" y="' + (cy - r).toFixed(1) + '" width="' + (r * 2).toFixed(1) + '" height="' + (r * 2).toFixed(1) + '" fill="none" stroke="' + color + '" stroke-width="' + sw + '"/>'
    case 'triangle':
      return '<polygon points="' + X + ',' + (cy - r).toFixed(1) + ' ' + (cx + r * 0.92).toFixed(1) + ',' + (cy + r * 0.7).toFixed(1) + ' ' + (cx - r * 0.92).toFixed(1) + ',' + (cy + r * 0.7).toFixed(1) + '" fill="' + color + '"/>'
    case 'diamond':
      return '<polygon points="' + X + ',' + (cy - r).toFixed(1) + ' ' + (cx + r).toFixed(1) + ',' + Y + ' ' + X + ',' + (cy + r).toFixed(1) + ' ' + (cx - r).toFixed(1) + ',' + Y + '" fill="' + color + '"/>'
    default:
      return '<circle cx="' + X + '" cy="' + Y + '" r="' + R + '" fill="' + color + '"/>'
  }
}
/** 【v1606】`styles` 是**逐点样式** ✓（可选 ✗ —— 不传就是老行为 ✓ 向后兼容 ✓） */
export function vertexDotsSvg(pts: number[], w: number, h: number, stroke: string, scale = 0.013, styles?: (PointStyle | null)[]): string {
  if (!pts || pts.length < 2) return ''
  const baseR = Math.max(2, Math.min(w, h) * scale)
  let out = ''
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const st = styles?.[i / 2] || null
    const r = st?.size ? baseR * st.size : baseR
    out += dotSvg(pts[i] * w, pts[i + 1] * h, r, st?.color || stroke, st?.shape || 'dot')
  }
  return out
}

export function renderSolid(kind: string, pts: number[], w: number, h: number, stroke: string, strokeWidth: number, fillColor: string, _dsh: string, vlabels?: (string | null)[], edgeStyles?: (EdgeStyle | null)[], selVertex?: number, selEdge?: number, labelOffsets?: { dx: number; dy: number }[], faceStyles?: (FaceStyle | null)[], selFace?: number, mesh?: SolidMesh | null): string {
  const n = Math.floor(pts.length / 2)
  const s = strokeWidth || 2
  const P: [number, number][] = []
  for (let i = 0; i < n; i++) P.push([pts[i * 2] * w, pts[i * 2 + 1] * h])
  const fc = fillColor && fillColor !== 'transparent' ? fillColor : 'none'
  const baseFaces = FACES[kind] || []
  const faces = meshFaces(kind, mesh)
  const fop = (faces === baseFaces) ? (FOP[kind] || []) : faces.map(() => 0.8)
  const edges = meshEdges(kind, mesh)
  let out = '<g>'
  faces.forEach((face, fi) => {
    const ov = faceStyles ? faceStyles[fi] : null
    if (ov && ov.hidden) return
    const pp = face.map(i => P[i][0].toFixed(1) + ',' + P[i][1].toFixed(1)).join(' ')
    const col = (ov && ov.fill) || fc
    if (!col || col === 'none' || col === 'transparent') return
    const op = (ov && typeof ov.opacity === 'number') ? ov.opacity : (fop[fi] ?? 0.8)
    out += '<polygon points="' + pp + '" fill="' + col + '" stroke="none" opacity="' + op + '"/>'
  })
  if (selFace != null && selFace >= 0 && selFace < faces.length) {
    const pp = faces[selFace].map(i => P[i][0].toFixed(1) + ',' + P[i][1].toFixed(1)).join(' ')
    out += '<polygon points="' + pp + '" fill="#ff8f1f" fill-opacity="0.18" stroke="#ff8f1f" stroke-width="2"/>'
  }
  edges.forEach(([a, b, hid], ei) => {
    const ov = edgeStyles ? edgeStyles[ei] : null
    const col = (ov && ov.color) || stroke
    const wd = (ov && ov.width) || s
    let da = ''
    if (ov && ov.dash) da = ov.dash === 'dash' ? '6 5' : ov.dash === 'dot' ? '2 3' : ''
    else if (hid) da = '6 5'
    const x1 = P[a][0], y1 = P[a][1], x2 = P[b][0], y2 = P[b][1]
    // 箭头：线画到箭头根部，再补一个实心三角，箭头尖正好落在终点顶点上
    const arrow = !!(ov && ov.arrow) && (x1 !== x2 || y1 !== y2)
    const ang = arrow ? Math.atan2(y2 - y1, x2 - x1) : 0
    const al = arrow ? Math.max(9, wd * 3.4) : 0
    const ex = arrow ? x2 - al * Math.cos(ang) : x2
    const ey = arrow ? y2 - al * Math.sin(ang) : y2
    let attrs = 'stroke="' + col + '" stroke-width="' + wd + '" stroke-linecap="round" stroke-linejoin="round"'
    if (da) attrs += ' stroke-dasharray="' + da + '"'
    out += '<line ' + attrs + ' x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + ex.toFixed(1) + '" y2="' + ey.toFixed(1) + '"/>'
    if (arrow) {
      const aw = al * 0.42
      const px = (sign: number) => [
        x2 - al * Math.cos(ang) + sign * aw * Math.sin(ang),
        y2 - al * Math.sin(ang) - sign * aw * Math.cos(ang),
      ]
      const a1 = px(1), a2 = px(-1)
      out += '<polygon points="' + x2.toFixed(1) + ',' + y2.toFixed(1) + ' ' + a1[0].toFixed(1) + ',' + a1[1].toFixed(1) + ' ' + a2[0].toFixed(1) + ',' + a2[1].toFixed(1) + '" fill="' + col + '" stroke="none"/>'
    }
  })
  if (vlabels) {
    const fs = labelFontSize(h)
    const gap = labelGap(fs)
    for (let i = 0; i < vlabels.length && i < n; i++) {
      if (selVertex === i) continue
      const lab = vlabels[i]
      if (!lab) continue
      const off = labelOffsets && labelOffsets[i]
      // 夹在元素框内：原图里字母本来就在图内，但"从重心往外推"的默认偏移会把边上的字母推出去，
      // 推出去就被 SVG 裁掉（预设里 P 就是这么整块消失的）
      const half = labelHalfWidth(lab, fs, w)
      const lx = Math.max(half, Math.min(w - half, P[i][0] + ((off && off.dx) || 0) * w))
      const ly = Math.max(fs * 0.85, Math.min(h - fs * 0.12, P[i][1] - gap + ((off && off.dy) || 0) * h))
      out += labelSvg(lab, lx, ly, stroke, fs)
    }
  }
  if (selEdge != null && selEdge >= 0 && selEdge < edges.length) {
    const a = edges[selEdge][0], b = edges[selEdge][1]
    out += '<line x1="' + P[a][0].toFixed(1) + '" y1="' + P[a][1].toFixed(1) + '" x2="' + P[b][0].toFixed(1) + '" y2="' + P[b][1].toFixed(1) + '" stroke="#4f6ef5" stroke-width="8" stroke-linecap="round" opacity="0.3"/>'
  }
  if (selVertex != null && selVertex >= 0 && selVertex < n) {
    out += '<circle cx="' + P[selVertex][0].toFixed(1) + '" cy="' + P[selVertex][1].toFixed(1) + '" r="9" fill="none" stroke="#ff8f1f" stroke-width="3"/>'
  }
  out += '</g>'
  return out
}

export type { MathFigureElement }
