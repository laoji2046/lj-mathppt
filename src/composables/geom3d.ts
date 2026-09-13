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
  /** 圆柱 / 圆锥 / 球：顶点表留空也行，形状由这里产生（底面圆 → 投影成椭圆弧） */
  primitive?: GeomPrimitive
  /** 截面 / 辅助面：按顺序列顶点名；fill 给颜色字符串表示填充，null 只描边 */
  cutPlanes?: { points: string[]; fill?: string | null }[]
  /** **定比分点**：P = from + t·(to − from)。t=0.5 中点、1/3 三等分点、任意比都行。
   *  解析出来的点会作为一个新顶点加进模型，后续连辅助线 / 定截面都能用它。
   *  （原来只有一个写死的"竖棱中点"，这是它的推广。） */
  marks?: { name: string; from: string; to: string; t: number }[]
  /** **多点确定平面 → 自动求截面**：给 3 个（或更多）顶点，算出这个平面与该多面体的**真实截面多边形**
   *  （逐面求交再接环）。跟 cutPlanes 的分工：那个是"你给的多边形直接画"，这个是"算出平面切在哪儿"。
   *  凸多面体成立；三点不共线即可。 */
  planeCuts?: { through: string[]; fill?: string | null }[]
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




/** 圆柱 / 圆锥：圆形底在投影里是椭圆，用**弧图元**表达（不是折线）。
 *  n 是采样数，只影响"看起来圆不圆"，60 够用。 */
export interface GeomPrimitive {
  /** sphere 用 r，忽略 h */
  type: 'cylinder' | 'cone' | 'sphere'
  /** 底面半径 */
  r: number
  /** 高 */
  h: number
}

/** 由两个**共轭半直径**向量还原椭圆：半轴 rx/ry + 旋转角 rot。
 *  （圆在仿射映射下的像一定是椭圆，所以只要知道圆的两个轴向量的投影就够了，
 *   不必去采样点再拟合。） */
function ellipseFromConjugate(ux: number, uy: number, vx: number, vy: number) {
  // 椭圆的点 = M·(单位圆)，M = [U V]。半轴和朝向就是 M 的奇异值 / 左奇异向量，
  // 也就是 **MMᵀ 的特征值 / 特征向量**（对称 2×2 有闭式）。
  //
  // **别用"共轭直径夹角"那套公式算朝向**：半轴长度两边都对，朝向会错 ——
  // 实测球的赤道（共轭直径在 xy 上协方差是对角的，朝向本该是 0°）被算成 55°，
  // 椭圆整个画歪。这正是踩过的坑。
  const a11 = ux * ux + vx * vx
  const a12 = ux * uy + vx * vy
  const a22 = uy * uy + vy * vy
  const tr = a11 + a22
  const det = a11 * a22 - a12 * a12
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det))
  const l1 = tr / 2 + disc, l2 = tr / 2 - disc
  const rx = Math.sqrt(Math.max(1e-12, l1))
  const ry = Math.sqrt(Math.max(1e-12, l2))
  const rot = 0.5 * Math.atan2(2 * a12, a11 - a22)
  return { rx, ry, rot }
}


/** 平面与多面体的**截面多边形**：逐面求交得到若干线段，再首尾相接成环。
 *  只对凸多面体成立 —— 教材里的截面题都是凸的。
 *  返回三维点列（逆序无所谓，渲染只关心多边形）。 */
function sectionPolygon(
  P3: [number, number, number][],
  faces: number[][],
  p0: [number, number, number],
  nrm: [number, number, number],
): [number, number, number][] {
  const segs: [number, number, number][][] = []
  const same = (a: [number, number, number], b: [number, number, number]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6
  for (const f of faces) {
    const dist = f.map((i) => dot(sub(P3[i], p0), nrm))
    const hit: [number, number, number][] = []
    for (let k = 0; k < f.length; k++) {
      const i0 = f[k], i1 = f[(k + 1) % f.length]
      const d0 = dist[k], d1 = dist[(k + 1) % f.length]
      if (Math.abs(d0) < 1e-9) { hit.push(P3[i0]); continue }
      if (d0 * d1 < 0) {
        const t = d0 / (d0 - d1)
        hit.push([
          P3[i0][0] + (P3[i1][0] - P3[i0][0]) * t,
          P3[i0][1] + (P3[i1][1] - P3[i0][1]) * t,
          P3[i0][2] + (P3[i1][2] - P3[i0][2]) * t,
        ])
      }
    }
    // 同一个点可能被相邻两条边各算一次 → 去重
    const uniq: [number, number, number][] = []
    for (const q of hit) if (!uniq.some((z) => same(z, q))) uniq.push(q)
    if (uniq.length >= 2) segs.push(uniq)
  }
  if (!segs.length) return []
  const ring: [number, number, number][] = [segs[0][0], segs[0][1]]
  const used = new Set([0])
  for (let guard = 0; guard < 400; guard++) {
    const tail = ring[ring.length - 1]
    let found = -1
    let next: [number, number, number] | null = null
    for (let i = 0; i < segs.length; i++) {
      if (used.has(i)) continue
      if (same(segs[i][0], tail)) { found = i; next = segs[i][1]; break }
      if (same(segs[i][1], tail)) { found = i; next = segs[i][0]; break }
    }
    if (found < 0 || !next) break
    used.add(found)
    if (same(next, ring[0])) break
    ring.push(next)
  }
  return ring.length >= 3 ? ring : []
}

/** 参数化生成常见几何体 —— 不依赖任何 AI，选类型 + 填参数就出模型。
 *  顶点命名按教材习惯：底面 A、B、C…，上底 A1、B1、C1…，锥顶 P，底面中心 O。 */
export interface BuildOpts {
  /** 'cube' 正方体 | 'box' 长方体 | 'prism' 正 n 棱柱 | 'pyramid' 正 n 棱锥 | 'cylinder' 圆柱 | 'cone' 圆锥 | 'sphere' 球 */
  type: 'cube' | 'box' | 'prism' | 'pyramid' | 'cylinder' | 'cone' | 'sphere'
  /** 底面边数（棱柱 / 棱锥用） */
  n?: number
  /** 底面边长（正方体忽略，用 size） */
  a?: number
  /** 长方体的长 / 宽 */
  b?: number
  /** 高 */
  h?: number
  /** 正方体边长 */
  size?: number
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function buildSolid(o: BuildOpts): Geom3D {
  const verts: Record<string, [number, number, number]> = {}
  const faces: string[][] = []
  // 圆柱 / 圆锥：交给 primitive —— 底面圆投影成椭圆弧，不是折线
  if (o.type === 'cylinder' || o.type === 'cone' || o.type === 'sphere') {
    return { vertices: {}, primitive: { type: o.type, r: o.a ?? 1.2, h: o.h ?? 2.4 } }
  }
  if (o.type === 'cube' || o.type === 'box') {
    const w = o.type === 'cube' ? (o.size ?? 2) : (o.a ?? 2)
    const d = o.type === 'cube' ? (o.size ?? 2) : (o.b ?? 1.4)
    const h = o.type === 'cube' ? (o.size ?? 2) : (o.h ?? 1.6)
    Object.assign(verts, {
      A: [0, 0, 0], B: [w, 0, 0], C: [w, d, 0], D: [0, d, 0],
      A1: [0, 0, h], B1: [w, 0, h], C1: [w, d, h], D1: [0, d, h],
    })
    faces.push(['A', 'B', 'C', 'D'], ['A1', 'B1', 'C1', 'D1'],
      ['A', 'B', 'B1', 'A1'], ['B', 'C', 'C1', 'B1'], ['C', 'D', 'D1', 'C1'], ['D', 'A', 'A1', 'D1'])
    return { vertices: verts, faces }
  }
  const n = Math.max(3, Math.min(26, Math.round(o.n ?? 4)))
  const a = o.a ?? 2
  const h = o.h ?? 2
  const R = a / (2 * Math.sin(Math.PI / n))              // 正 n 边形的外接圆半径
  const base: string[] = []
  for (let i = 0; i < n; i++) {
    const t = (i * 2 * Math.PI) / n
    // 底面按"从 -y 侧起、逆时针"摆，跟教材一致（正视图里 A 在左下）
    base.push(LETTERS[i])
    verts[LETTERS[i]] = [+(R * Math.sin(t)).toFixed(4), +(R * Math.cos(t)).toFixed(4), 0]
  }
  if (o.type === 'prism') {
    for (let i = 0; i < n; i++) {
      verts[LETTERS[i] + '1'] = [verts[LETTERS[i]][0], verts[LETTERS[i]][1], h]
    }
    faces.push(base.slice())
    faces.push(base.map((s) => s + '1'))
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      faces.push([LETTERS[i], LETTERS[j], LETTERS[j] + '1', LETTERS[i] + '1'])
    }
    return { vertices: verts, faces }
  }
  verts.P = [0, 0, h]
  faces.push(base.slice())
  for (let i = 0; i < n; i++) faces.push(['P', LETTERS[i], LETTERS[(i + 1) % n]])
  return { vertices: verts, faces }
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
  arcs: { cx: number; cy: number; rx: number; ry: number; rot: number; a0: number; a1: number; dash: 0 | 1 }[]
  /** 内容宽高比（宽/高）—— 元素框要按它给，否则投影会被拉变形（椭圆尤其明显） */
  aspect: number
  /** 与 mesh.faces 一一对应的面样式（截面用得到填充） */
  faceStyles: ({ fill?: string; opacity?: number } | null)[]
} {
  const d = viewDir(view.azim, view.elev)
  const aDeg = (view.azim * Math.PI) / 180
  const right = norm([-Math.sin(aDeg), Math.cos(aDeg), 0])
  const up = cross(d, right)
  // 屏幕坐标：x 向右、y 向下（所以 up 取负）
  const sc = (p: [number, number, number]): [number, number] => [dot(p, right), -dot(p, up)]

  // ---------------- primitive：圆柱 / 圆锥 ----------------
  if (m.primitive) {
    const { type, r, h: hh } = m.primitive
    const h = type === 'sphere' ? 0 : hh
    const names: string[] = []
    const P3: [number, number, number][] = []
    const vlabels: (string | null)[] = []
    const push = (name: string | null, p: [number, number, number]) => {
      names.push(name || ('_' + names.length))
      P3.push(p)
      vlabels.push(name ? toLabelText(name) : null)
      return names.length - 1
    }
    // 侧影母线的落点：圆上**法向与视线垂直**的两点 —— cos t·d₀ + sin t·d₁ = 0。
    // （不是深度极值点！那两个点是"最近/最远"，跟投影椭圆的左右端点是两回事 —— 踩过，
    //   写错的话两条母线会挤到圆中间去，圆柱看着就只剩一根竖线。）
    const t0 = Math.atan2(-d[0], d[1])
    const tang: [number, number, number][] = [0, Math.PI].map((k) => {
      const t = t0 + k
      return [+(r * Math.cos(t)).toFixed(4), +(r * Math.sin(t)).toFixed(4), 0]
    })
    const nearPlus = (Math.cos(t0 + Math.PI / 2) * d[0] + Math.sin(t0 + Math.PI / 2) * d[1]) > 0
    const edges: [number, number, number][] = []
    let apex = -1, iA = -1, iB = -1
    if (type === 'sphere') {
      // 球：侧影是个**正圆**（正交投影下），另加一条赤道椭圆。
      // 赤道用上面那套共轭直径法；侧影圆直接给 rx = ry = r（视线方向是单位向量，屏幕半径就等于 r）。
      push('O', [0, 0, 0])
      const c0 = sc([0, 0, 0])
      const eq = ellipseFromConjugate(r * (right[0] - 0), -(r * up[0]), r * right[1], -(r * up[1]))
      // 赤道可见半圈：跟底面圆同一套判据（法向与视线垂直的两点切开）
      const t0s = Math.atan2(-d[0], d[1])
      const nearPlusS = (Math.cos(t0s + Math.PI / 2) * d[0] + Math.sin(t0s + Math.PI / 2) * d[1]) > 0
      const halfS = nearPlusS ? t0s + Math.PI : t0s + 2 * Math.PI
      const arcsS: { cx: number; cy: number; rx: number; ry: number; rot: number; a0: number; a1: number; dash: 0 | 1 }[] = [
        { cx: c0[0], cy: c0[1], rx: r, ry: r, rot: 0, a0: 0, a1: Math.PI * 2, dash: 0 },      // 侧影圆
        { cx: c0[0] + 0, cy: c0[1] + 0, ...eq, a0: t0s, a1: halfS, dash: 0 },                  // 赤道近半
        { cx: c0[0], cy: c0[1], ...eq, a0: halfS, a1: t0s + Math.PI * 2, dash: 1 },            // 赤道远半
      ]
      const xs2 = [c0[0] - r, c0[0] + r]
      const ys2 = [c0[1] - r, c0[1] + r]
      const bx0 = Math.min(...xs2), bx1 = Math.max(...xs2), by0 = Math.min(...ys2), by1 = Math.max(...ys2)
      const bw2 = Math.max(1e-6, bx1 - bx0), bh2 = Math.max(1e-6, by1 - by0)
      const s2 = 0.84 / Math.max(bw2, bh2)
      const ox2 = (1 - bw2 * s2) / 2, oy2 = (1 - bh2 * s2) / 2
      const pts2: number[] = []
      for (const p of P3) {
        const q = sc(p)
        pts2.push(+(ox2 + (q[0] - bx0) * s2).toFixed(4), +(oy2 + (q[1] - by0) * s2).toFixed(4))
      }
      const arcs2 = arcsS.map((a) => ({
        cx: +(ox2 + (a.cx - bx0) * s2).toFixed(4), cy: +(oy2 + (a.cy - by0) * s2).toFixed(4),
        rx: +(a.rx * s2).toFixed(4), ry: +(a.ry * s2).toFixed(4),
        rot: +a.rot.toFixed(4), a0: +a.a0.toFixed(4), a1: +a.a1.toFixed(4), dash: a.dash,
      }))
      return { points: pts2, mesh: { edges: [], faces: [] }, vlabels, arcs: arcs2, aspect: bw2 / bh2, faceStyles: [] }
    }
    if (type === 'cone') {
      apex = push('P', [0, 0, h])
      push('O', [0, 0, 0])
      iA = push(null, tang[0])
      iB = push(null, tang[1])
      edges.push([apex, iA, 0], [apex, iB, 0])
    } else {
      push('O', [0, 0, 0])
      push('O1', [0, 0, h])
      iA = push(null, tang[0])
      iB = push(null, tang[1])
      const iA1 = push(null, [tang[0][0], tang[0][1], h])
      const iB1 = push(null, [tang[1][0], tang[1][1], h])
      edges.push([iA, iA1, 0], [iB, iB1, 0])
    }
    // 圆的投影椭圆：底在 z=0、轴向 e1=(1,0,0)、e2=(0,1,0)
    const circ = (z: number) => {
      const c = sc([0, 0, z])
      const U = sc([r, 0, z]), V = sc([0, r, z])
      const e = ellipseFromConjugate(U[0] - c[0], U[1] - c[1], V[0] - c[0], V[1] - c[1])
      return { cx: c[0], cy: c[1], ...e }
    }
    const arcs: { cx: number; cy: number; rx: number; ry: number; rot: number; a0: number; a1: number; dash: 0 | 1 }[] = []
    // 底面：近半可见（实线）、远半被挡（虚线）—— 这就是教材里圆柱/圆锥底的那条画法
    const eb = circ(0)
    const half = nearPlus ? t0 + Math.PI : t0 + 2 * Math.PI
    arcs.push({ ...eb, a0: t0, a1: half, dash: 0 })
    arcs.push({ ...eb, a0: half, a1: t0 + 2 * Math.PI, dash: 1 })
    if (type === 'cylinder') {
      // 顶面：从上方看整圈都可见（实线）
      const et = circ(h)
      arcs.push({ ...et, a0: 0, a1: Math.PI * 2, dash: 0 })
    }
    // 归一化：把顶点和椭圆包围盒一起算进去，整体居中
    const xs = P3.map((p) => sc(p)[0])
    const ys = P3.map((p) => sc(p)[1])
    const rm = Math.max(eb.rx, eb.ry)
    xs.push(eb.cx - rm, eb.cx + rm)
    ys.push(eb.cy - rm, eb.cy + rm)
    if (type === 'cylinder') {
      const et = circ(h)
      const r2 = Math.max(et.rx, et.ry)
      xs.push(et.cx - r2, et.cx + r2)
      ys.push(et.cy - r2, et.cy + r2)
    }
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
    const bw = Math.max(1e-6, x1 - x0), bh = Math.max(1e-6, y1 - y0)
    const s = 0.84 / Math.max(bw, bh)
    const ox = (1 - bw * s) / 2, oy = (1 - bh * s) / 2
    const points: number[] = []
    for (const p of P3) {
      const q = sc(p)
      points.push(+(ox + (q[0] - x0) * s).toFixed(4), +(oy + (q[1] - y0) * s).toFixed(4))
    }
    const arcsOut = arcs.map((a) => ({
      cx: +(ox + (a.cx - x0) * s).toFixed(4),
      cy: +(oy + (a.cy - y0) * s).toFixed(4),
      rx: +(a.rx * s).toFixed(4),
      ry: +(a.ry * s).toFixed(4),
      rot: +a.rot.toFixed(4),
      a0: +a.a0.toFixed(4),
      a1: +a.a1.toFixed(4),
      dash: a.dash,
    }))
    return { points, mesh: { edges, faces: [] }, vlabels, arcs: arcsOut, aspect: bw / bh, faceStyles: [] }
  }

  // ---------------- 多面体（走面表） ----------------
  // 先把**定比分点**解析出来，并进顶点表（后面的连线 / 定截面都能用它）
  const vertsAll: Record<string, [number, number, number]> = { ...m.vertices }
  for (const mk of m.marks || []) {
    const A = vertsAll[mk.from], B = vertsAll[mk.to]
    if (!A || !B || !mk.name) continue
    vertsAll[mk.name] = [
      +(A[0] + (B[0] - A[0]) * mk.t).toFixed(4),
      +(A[1] + (B[1] - A[1]) * mk.t).toFixed(4),
      +(A[2] + (B[2] - A[2]) * mk.t).toFixed(4),
    ]
  }
  const names = Object.keys(vertsAll)
  const idx: Record<string, number> = {}
  names.forEach((n, i) => { idx[n] = i })
  const P3 = names.map((n) => vertsAll[n]) as [number, number, number][]
  if (!P3.length) return { points: [], mesh: { edges: [], faces: [] }, vlabels: [], arcs: [], aspect: 1, faceStyles: [] }

  const faces = (m.faces || []).map((f) => f.map((n) => idx[n]).filter((k) => k !== undefined))
  // **多点确定平面 → 求截面**：三个点定出平面，再逐面求交得到真正的截面多边形。
  // （必须在归一化之前算，截面的顶点也要进包围盒，否则图会偏。）
  const sections: { ring: [number, number, number][]; fill?: string | null }[] = []
  for (const pc of m.planeCuts || []) {
    const ids = (pc.through || []).map((n) => idx[n]).filter((k) => k !== undefined)
    if (ids.length < 3) continue
    const p0 = P3[ids[0]]
    const nrm = norm(cross(sub(P3[ids[1]], p0), sub(P3[ids[2]], p0)))
    if (!isFinite(nrm[0]) || Math.hypot(nrm[0], nrm[1], nrm[2]) < 1e-9) continue
    const ring = sectionPolygon(P3, faces, p0, nrm)
    if (ring.length >= 3) sections.push({ ring, fill: pc.fill })
  }

  const raw = P3.map((p) => [dot(p, right), dot(p, up), dot(p, d)] as [number, number, number])
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const r of raw) {
    if (r[0] < x0) x0 = r[0]; if (r[0] > x1) x1 = r[0]
    if (-r[1] < y0) y0 = -r[1]; if (-r[1] > y1) y1 = -r[1]
  }
  for (const sec of sections) {
    for (const p of sec.ring) {
      const sx = dot(p, right), sy = -dot(p, up)
      if (sx < x0) x0 = sx; if (sx > x1) x1 = sx
      if (sy < y0) y0 = sy; if (sy > y1) y1 = sy
    }
  }
  const bw = Math.max(1e-6, x1 - x0), bh = Math.max(1e-6, y1 - y0)
  const s = 0.84 / Math.max(bw, bh)
  const ox = (1 - bw * s) / 2, oy = (1 - bh * s) / 2
  const points: number[] = []
  for (const r of raw) points.push(+(ox + (r[0] - x0) * s).toFixed(4), +(oy + (-r[1] - y0) * s).toFixed(4))
  // 截面的顶点是**新点**（不是模型顶点）：追加到 points 末尾，没有字母
  const secStart: number[] = []
  const secIdx: number[][] = []
  for (const sec of sections) {
    const ids: number[] = []
    for (const p of sec.ring) {
      const sx = dot(p, right), sy = -dot(p, up)
      ids.push(points.length / 2)
      points.push(+(ox + (sx - x0) * s).toFixed(4), +(oy + (sy - y0) * s).toFixed(4))
    }
    secStart.push(0)
    secIdx.push(ids)
  }

  const c: [number, number, number] = [0, 0, 0]
  for (const p of P3) { c[0] += p[0] / P3.length; c[1] += p[1] / P3.length; c[2] += p[2] / P3.length }

  const frontFacing: boolean[] = []
  const faceNormal: [number, number, number][] = []
  faces.forEach((f) => {
    const A = P3[f[0]], B = P3[f[1]], C = P3[f[2]]
    let n = norm(cross(sub(B, A), sub(C, B)))
    const fc: [number, number, number] = [0, 0, 0]
    for (const k of f) { fc[0] += P3[k][0] / f.length; fc[1] += P3[k][1] / f.length; fc[2] += P3[k][2] / f.length }
    if (dot(n, sub(fc, c)) < 0) n = [-n[0], -n[1], -n[2]]
    faceNormal.push(n)
    frontFacing.push(dot(n, d) > 1e-6)
  })

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
  // 截面 / 辅助面：作为**面**加进去（可填充），它的边也画出来。
  // 边是实是虚按这个多边形自己朝向定 —— 截面通常是题目的主角，朝向相机就画实线。
  // 注意：要在上面那套可见性算完之后再加，免得它参与"棱属于哪个面"的判断。
  const cutStyles: { fill?: string; opacity?: number }[] = []
  for (const cp of m.cutPlanes || []) {
    const ids = (cp.points || []).map((n) => idx[n]).filter((k) => k !== undefined)
    if (ids.length < 3) continue
    const A = P3[ids[0]], B = P3[ids[1]], C = P3[ids[2]]
    const n2 = norm(cross(sub(B, A), sub(C, B)))
    const front = dot(n2, d) > 0
    for (let k = 0; k < ids.length; k++) {
      const a = ids[k], b = ids[(k + 1) % ids.length]
      if (edges.some((e) => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a))) continue
      edges.push([a, b, front ? 0 : 1])
    }
    faces.push(ids)
    cutStyles.push({ fill: cp.fill || '#f0c674', opacity: 0.28 })
  }
  // 平面截出来的截面：边 + 填充面（跟手写 cutPlanes 用不同色调，一眼能分清）
  for (let si = 0; si < secIdx.length; si++) {
    const ids = secIdx[si]
    const ring = sections[si].ring
    const nrm2 = norm(cross(sub(ring[1], ring[0]), sub(ring[2], ring[1])))
    const front = dot(nrm2, d) > 0
    for (let k = 0; k < ids.length; k++) {
      const a = ids[k], b = ids[(k + 1) % ids.length]
      if (edges.some((e) => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a))) continue
      edges.push([a, b, front ? 0 : 1])
    }
    faces.push(ids)
    cutStyles.push({ fill: sections[si].fill === null ? undefined : (sections[si].fill || '#8ecae6'), opacity: 0.3 })
  }
  const vlabels = names.map((n) => (m.labels && !(n in m.labels) ? null : toLabelText(m.labels?.[n] || n)))
  if (secIdx.length) vlabels.push(...secIdx.map((ids) => ids.map(() => null)).flat())
  const faceStyles = faces.map((_, i) => cutStyles[i - (faces.length - cutStyles.length)] || null)
  return { points, mesh: { edges, faces }, vlabels, arcs: [], aspect: bw / bh, faceStyles }
}
