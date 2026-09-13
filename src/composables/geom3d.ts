/**
 * 三维立体几何 → 二维投影。
 *
 * 为什么要有这个模块：现在的数学图形只存**二维**顶点 —— 一条棱该实线还是虚线，只能靠
 * 墨迹、虚线样式、凸包内外这些**启发式去猜**（实测为了"补出来的线该实该虚"来回试了三版，
 * 还试过两条会伤真值集的方案）。而立体几何里虚实是**算出来的**：
 * 凸多面体的一条棱，只要属于至少一个"正面朝向的面"就是可见的。
 * 有了三维模型 + 面表，"多余顶点、虚实判错、异面直线在投影上假交叉"这三类问题在架构上就不存在。
 *
 * 输出刻意做成跟 MathFigureElement 的 points / mesh / vlabels **同一套结构**，
 * 这样渲染、导出、拖点全部复用现有那条路，不需要新元素类型。
 *
 * 视角约定（对齐用户给的 replica-prompt.md）：x 向右、y 向里（深度）、z 向上；
 * azim / elev 单位度；正交投影（教材的图就是正交投影，不做透视）。
 */

export interface Geom3D {
  /** 顶点名 → 三维坐标 */
  vertices: Record<string, [number, number, number]>
  /** 面表：每个面按边界顺序列顶点名。**只有凸多面体**才有可靠的自动虚实 */
  faces?: string[][]
  /** 没有面表时的兜底：显式棱（全部实线） */
  edges?: [string, string][]
  /** 兜底：显式虚棱 */
  hiddenEdges?: [string, string][]
  /** 辅助线：solid 强制实线 / dashed 强制虚线 / auto 穿到体内算虚线（默认 auto） */
  auxiliary?: { from: string; to: string; style?: 'solid' | 'dashed' | 'auto' }[]
  /** 只标注列出的顶点；省略则全标。写 'A1' 会变成应用里的 A_1 */
  labels?: Record<string, string>
}

export interface Geom3DView {
  /** 方位角（度）：0 在 +x 侧、-90 在 -y 侧（正前）、±180 在 -x 侧 */
  azim: number
  /** 仰角（度）：>0 俯视（看得见上底面），教材多在 10~30 */
  elev: number
}

/** 顶点名 → 应用里的标注写法：A1 → A_1（应用里 _ 是下标） */
export function toLabelText(name: string): string {
  return name.replace(/^(.*?)(\d+)$/, '$1_$2')
}

const sub = (a: [number, number, number], b: [number, number, number]): [number, number, number] =>
  [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: [number, number, number], b: [number, number, number]): [number, number, number] =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: [number, number, number], b: [number, number, number]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: [number, number, number]): [number, number, number] => {
  const L = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / L, a[1] / L, a[2] / L]
}

/** 相机方向：从原点指向相机的单位向量（也就是"观察方向"的反向） */
function viewDir(azim: number, elev: number): [number, number, number] {
  const a = (azim * Math.PI) / 180, e = (elev * Math.PI) / 180
  return [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)]
}


/** 只做投影、不归一化也不判虚实 —— 给「截图描点对齐」解视角用。
 *  约定跟 projectGeom 一致：x 向右、y 向里、z 向上；返回屏幕坐标（y 向上，画面里再翻）。 */
export function projectRaw(m: Geom3D, azimDeg: number, elevDeg: number): Record<string, [number, number]> {
  const d = viewDir(azimDeg, elevDeg)
  const a = (azimDeg * Math.PI) / 180
  const right = norm([-Math.sin(a), Math.cos(a), 0])
  const up = cross(d, right)
  const out: Record<string, [number, number]> = {}
  for (const [n, p] of Object.entries(m.vertices)) {
    out[n] = [dot(p, right), dot(p, up)]
  }
  return out
}

/** 用"在截图上点了哪几个顶点"反解视角。
 *  正交投影下屏幕坐标 = (sx·x + tx, sy·y + ty)，给定视角后是**线性**的 —— 直接最小二乘解出四个参数，
 *  所以只要在视角网格上粗搜 + 局部细化就够了，不用迭代优化。
 *  返回 azim/elev 和归一化残差（残差 / 图形尺度，0 表示完全对上）。 */
export function solveView(
  m: Geom3D,
  order: string[],
  clicks: [number, number][],
): { azim: number; elev: number; err: number } {
  const n = Math.min(order.length, clicks.length)
  if (n < 3) return { azim: 0, elev: 0, err: Infinity }
  const cs = clicks.slice(0, n)
  // 点集的尺度：用来把残差归一化，跟图像大小无关
  let cx = 0, cy = 0
  cs.forEach((c) => { cx += c[0] / n; cy += c[1] / n })
  let sc = 0
  cs.forEach((c) => { sc = Math.max(sc, Math.hypot(c[0] - cx, c[1] - cy)) })
  sc = sc || 1

  const fitAt = (azim: number, elev: number) => {
    const raw = projectRaw(m, azim, elev)
    let sxx = 0, sx = 0, sxc = 0, syy = 0, sy = 0, syc = 0
    for (let i = 0; i < n; i++) {
      const r = raw[order[i]]
      if (!r) return { err: Infinity }
      // 屏幕 y 向下，投影的 y 向上 → 这里先把符号并进 sy
      sxx += r[0] * r[0]; sx += r[0]; sxc += r[0] * cs[i][0]
      syy += r[1] * r[1]; sy += r[1]; syc += r[1] * cs[i][1]
    }
    const detx = n * sxx - sx * sx
    const dety = n * syy - sy * sy
    if (Math.abs(detx) < 1e-9 || Math.abs(dety) < 1e-9) return { err: Infinity }
    // **缩放符号要夹住**：屏幕 x 必为正、屏幕 y 必为负（画布 y 向下）。
    // 不夹的话 (azim, elev) 和 (azim+180, -elev) 的投影只差一个点镜像、残差一样小，
    // 求解器会随机挑到镜像解 —— 形状看着对，**虚实却整个反了**。
    let bx = (n * sxc - sx * sumC(cs, 0)) / detx
    let by = (n * syc - sy * sumC(cs, 1)) / dety
    bx = Math.abs(bx)
    by = -Math.abs(by)
    const tx = (sumC(cs, 0) - bx * sx) / n
    const ty = (sumC(cs, 1) - by * sy) / n
    let e = 0
    for (let i = 0; i < n; i++) {
      const r = raw[order[i]]
      const dx = bx * r[0] + tx - cs[i][0]
      const dy = by * r[1] + ty - cs[i][1]
      e += (dx * dx + dy * dy) / n
    }
    return { err: Math.sqrt(e) / sc }
  }
  const sumC = (arr: [number, number][], k: 0 | 1) => arr.slice(0, n).reduce((s, c) => s + c[k], 0)

  let best = { azim: 0, elev: 0, err: Infinity }
  const scan = (a0: number, a1: number, da: number, e0: number, e1: number, de: number) => {
    for (let az = a0; az <= a1; az += da) {
      for (let el = e0; el <= e1; el += de) {
        if (el <= -89 || el >= 89) continue
        const r = fitAt(az, el)
        if (r.err < best.err) best = { azim: az, elev: el, err: r.err }
      }
    }
  }
  scan(-180, 175, 5, -75, 75, 5)
  // 局部细化两轮
  for (const step of [1, 0.2]) {
    const a0 = best.azim, e0 = best.elev
    scan(a0 - 4, a0 + 4, step, e0 - 4, e0 + 4, step)
  }
  return best
}

/** 把三维模型投影成二维图形（归一化到 0~1，留 8% 边距），并**算出每条棱的虚实**。 */
export function projectGeom(m: Geom3D, view: Geom3DView): {
  points: number[]
  mesh: { edges: [number, number, number][]; faces: number[][] }
  vlabels: (string | null)[]
} {
  const names = Object.keys(m.vertices)
  const idx: Record<string, number> = {}
  names.forEach((n, i) => { idx[n] = i })
  const P3 = names.map((n) => m.vertices[n]) as [number, number, number][]
  if (!P3.length) return { points: [], mesh: { edges: [], faces: [] }, vlabels: [] }

  const d = viewDir(view.azim, view.elev)                       // 指向相机
  const right = norm([-Math.sin((view.azim * Math.PI) / 180), Math.cos((view.azim * Math.PI) / 180), 0])
  const up = cross(d, right)                                    // 屏幕上方

  // 正交投影：屏幕坐标 = (p·right, p·up)，深度 = p·d（越大越靠近相机）
  const raw = P3.map((p) => [dot(p, right), dot(p, up), dot(p, d)] as [number, number, number])
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const r of raw) {
    if (r[0] < x0) x0 = r[0]; if (r[0] > x1) x1 = r[0]
    if (-r[1] < y0) y0 = -r[1]; if (-r[1] > y1) y1 = -r[1]     // 屏幕 y 向下 → 取负
  }
  const bw = Math.max(1e-6, x1 - x0), bh = Math.max(1e-6, y1 - y0)
  const s = 0.84 / Math.max(bw, bh)
  const ox = (1 - bw * s) / 2, oy = (1 - bh * s) / 2
  const points: number[] = []
  for (const r of raw) points.push(+(ox + (r[0] - x0) * s).toFixed(4), +(oy + (-r[1] - y0) * s).toFixed(4))

  // 体心（用来把面法向校正为朝外）
  const c: [number, number, number] = [0, 0, 0]
  for (const p of P3) { c[0] += p[0] / P3.length; c[1] += p[1] / P3.length; c[2] += p[2] / P3.length }

  const faces = (m.faces || []).map((f) => f.map((n) => idx[n]).filter((k) => k !== undefined))
  // 每个面：算朝外法向，判断是否正面朝向相机
  const frontFacing: boolean[] = []
  const faceNormal: [number, number, number][] = []
  faces.forEach((f) => {
    const A = P3[f[0]], B = P3[f[1]], C = P3[f[2]]
    let n = norm(cross(sub(B, A), sub(C, B)))
    const fc: [number, number, number] = [0, 0, 0]
    for (const k of f) { fc[0] += P3[k][0] / f.length; fc[1] += P3[k][1] / f.length; fc[2] += P3[k][2] / f.length }
    if (dot(n, sub(fc, c)) < 0) n = [-n[0], -n[1], -n[2]]          // 校正为朝外
    faceNormal.push(n)
    frontFacing.push(dot(n, d) > 1e-6)
  })

  // 棱：面表里出现的每一对相邻顶点；**属于至少一个正面朝向的面就可见**（凸体成立）
  const edgeMap = new Map<string, { i: number; j: number; front: boolean }>()
  const addEdge = (i: number, j: number, kind: 'front' | 'back') => {
    const key = Math.min(i, j) + '_' + Math.max(i, j)
    const e = edgeMap.get(key) || { i: Math.min(i, j), j: Math.max(i, j), front: false }
    if (kind === 'front') e.front = true
    edgeMap.set(key, e)
  }
  faces.forEach((f, fi) => {
    for (let k = 0; k < f.length; k++) addEdge(f[k], f[(k + 1) % f.length], frontFacing[fi] ? 'front' : 'back')
  })
  for (const [a, b] of m.edges || []) if (idx[a] !== undefined && idx[b] !== undefined) addEdge(idx[a], idx[b], 'front')
  // 辅助线：穿到体内算虚线。凸体判"点在体内"= 在每个面的内侧（用朝外法向）
  const inside = (p: [number, number, number]) => {
    if (!faces.length) return false
    for (let fi = 0; fi < faces.length; fi++) {
      const A = P3[faces[fi][0]]
      if (dot(faceNormal[fi], sub(p, A)) > 1e-6) return false
    }
    return true
  }
  const auxVisible: { i: number; j: number; dash: 0 | 1 }[] = []
  for (const a of m.auxiliary || []) {
    const i = idx[a.from], j = idx[a.to]
    if (i === undefined || j === undefined) continue
    let dash: 0 | 1 = 0
    if (a.style === 'dashed') dash = 1
    else if (a.style === 'solid') dash = 0
    else {
      // auto：取中点（靠两端一点，避免正好落在面上）判断是否在体内
      const t = 0.25, p: [number, number, number] = [
        P3[i][0] + (P3[j][0] - P3[i][0]) * t,
        P3[i][1] + (P3[j][1] - P3[i][1]) * t,
        P3[i][2] + (P3[j][2] - P3[i][2]) * t,
      ]
      dash = inside(p) ? 1 : 0
    }
    auxVisible.push({ i, j, dash })
  }

  const edges: [number, number, number][] = [...edgeMap.values()].map((e) => [e.i, e.j, e.front ? 0 : 1])
  for (const a of auxVisible) {
    const dup = edges.some((e) => (e[0] === a.i && e[1] === a.j) || (e[0] === a.j && e[1] === a.i))
    if (!dup) edges.push([a.i, a.j, a.dash])
  }
  const vlabels = names.map((n) => (m.labels && !(n in m.labels) ? null : toLabelText(m.labels?.[n] || n)))
  return { points, mesh: { edges, faces }, vlabels }
}
