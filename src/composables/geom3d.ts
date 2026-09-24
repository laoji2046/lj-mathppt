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
  /** **点样式**（按点名）：改标签文字（`null` = 不显示）、颜色、大小。
   *  编辑器里选中一个点就能改这些。 */
  pointStyles?: Record<string, { label?: string | null; color?: string; size?: number }>
  /** **两平面的交线**：a / b 各是定一个平面的三点（或更多）。
   *  算出交线后**截到多面体内部**（两面各自截面的公共部分），画成一条线。 */
  intersectLines?: { a: string[]; b: string[] }[]
  /** **两直线的交点**：a / b 各是直线上的两点。相交（或接近到容差内）才算得出点；
   *  异面或平行时解析不出（界面会提示"不相交"）。 */
  lineMeets?: { name: string; a: [string, string]; b: [string, string] }[]
  /** **点在平面上的投影（射影）**：from 是那个点，plane 是定平面的三点。
   *  `foot` 给 true 时同时画一条 from→投影点的垂线（教材里那条）。 */
  projectPoints?: { name: string; from: string; plane: string[]; foot?: boolean }[]
  /** **字母位置**：每个点可以指定字母相对顶点偏移多少像素（屏幕坐标，x 右 y 下）。
   *  统一用偏移向量表示 —— 八方位键盘和"距离"都是从它推出来的，拖曳直接写它。
   *  不写就用默认（从重心往外推的那套自动算法）。
   *  （早期版本写过 {dir, dist}，读的时候仍然兼容。） */
  labelPos?: Record<string, { dx?: number; dy?: number; dir?: LabelDir; dist?: number }>
  /** **隐藏**（编辑器里的"眼睛"）：键的写法
   *  - `p:A` 点名 —— 不显示这个字母（点仍在，别的线还能用它）
   *  - `e:A|B` 一条棱/线（两点名按字典序拼）
   *  - `aux:0` / `cut:0` / `plane:0` / `il:0` / `pp:0` —— 第 i 条辅助线 / 截面 / 平面 / 交线 / 射影垂线 */
  hidden?: string[]
  /** **自由点**（直接给坐标）：不在任何棱上、纯粹是作图位置，比如外接球球心、投影点。 */
  freePoints?: { name: string; at: [number, number, number] }[]
  /** 【v1571】**受约束点**：位置由"所在对象 + 一个参数"决定 ✓ 拖动时约束自动保持 ✓
   *  · `edge`   —— 棱上，`t ∈ [0,1]`（t=0 在 `a` 端）
   *  · `face`   —— 多面体的某个面上，面内局部坐标 `(u, v)`
   *  · `plane`  —— 任意三点定的平面上，面内局部坐标 `(u, v)`
   *  · `circle` —— 参数化体的圆上，角度 `th`（弧度）
   *    底面圆在 z=0、顶面圆在 z=h（仅圆柱有）、球的赤道在 z=0 ✓
   *  ⚠ 取值时**必须**把它算进"已用掉的点名"（见 `Geom3DDialog.vue` 的取名逻辑 ✗） */
  onPoints?: {
    name: string
    on:
      | { kind: 'edge'; a: string; b: string; t: number }
      | { kind: 'face'; face: string[]; u: number; v: number }
      | { kind: 'plane'; through: string[]; u: number; v: number }
      | { kind: 'circle'; which: 'base' | 'top' | 'equator'; th: number }
  }[]
  /** **直线与平面的交点**（构造点）：line 是直线上的两点、plane 是定平面的三点。
   *  解析时算出来当普通顶点用 —— 后续连线、定平面都能拿它当端点。 */
  meetPoints?: { name: string; line: [string, string]; plane: string[] }[]
  /** **线样式**：键是两端点名按字典序拼的 `A|B`（无序，A-B 和 B-A 同一条）。
   *  颜色 / 线宽 / 虚实 —— 编辑器里选中一条线就能改。 */
  edgeStyles?: Record<string, { color?: string; width?: number; dash?: 0 | 1 }>
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
  /** 画**轴截面**并着色（教材里圆锥那个"三角形 AOB"）：底面两个侧影点标成 A、B */
  axial?: 0 | 1 | boolean
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

/** 把模型的顶点 + **定比分点**解析成一张完整的顶点表（可传递：新点也能当端点）。
 *  **投影和界面必须共用这一个** —— 否则投影出来的点顺序跟界面里的点列表对不上，
 *  点选、连线就会错位。 */
export function resolveVertices(m: Geom3D): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = { ...(m.vertices || {}) }
  let pend = (m.marks || []).filter((k) => k && k.name)
  for (let pass = 0; pass < 8 && pend.length; pass++) {
    const next: typeof pend = []
    let moved = false
    for (const mk of pend) {
      const A = out[mk.from], B = out[mk.to]
      if (!A || !B) { next.push(mk); continue }
      out[mk.name] = [
        +(A[0] + (B[0] - A[0]) * mk.t).toFixed(4),
        +(A[1] + (B[1] - A[1]) * mk.t).toFixed(4),
        +(A[2] + (B[2] - A[2]) * mk.t).toFixed(4),
      ]
      moved = true
    }
    pend = next
    if (!moved) break
  }
  // 两直线的交点：求两直线的最近点对，距离在容差内就当相交（取中点）
  for (const lm of m.lineMeets || []) {
    if (!lm?.name || out[lm.name]) continue
    const P1 = out[lm.a?.[0]], P2 = out[lm.a?.[1]]
    const P3v = out[lm.b?.[0]], P4 = out[lm.b?.[1]]
    if (!P1 || !P2 || !P3v || !P4) continue
    const d1 = sub(P2, P1)
    const d2 = sub(P4, P3v)
    const w = sub(P1, P3v)
    const aa = dot(d1, d1), bb = dot(d1, d2), cc = dot(d2, d2)
    const dd = dot(d1, w), ee = dot(d2, w)
    const den = aa * cc - bb * bb
    if (Math.abs(den) < 1e-12) continue                  // 平行（或重合）→ 没有唯一交点
    const s = (bb * ee - cc * dd) / den
    const tt = (aa * ee - bb * dd) / den
    const PA: [number, number, number] = [P1[0] + d1[0] * s, P1[1] + d1[1] * s, P1[2] + d1[2] * s]
    const PB: [number, number, number] = [P3v[0] + d2[0] * tt, P3v[1] + d2[1] * tt, P3v[2] + d2[2] * tt]
    // 异面直线：最近点对还有距离 → 不算相交
    if (Math.hypot(PA[0] - PB[0], PA[1] - PB[1], PA[2] - PB[2]) > 1e-3) continue
    out[lm.name] = [
      +((PA[0] + PB[0]) / 2).toFixed(4),
      +((PA[1] + PB[1]) / 2).toFixed(4),
      +((PA[2] + PB[2]) / 2).toFixed(4),
    ]
  }
  // 点在平面上的投影：P' = P − ((P−Q₀)·n / |n|²)·n
  for (const pp of m.projectPoints || []) {
    if (!pp?.name || out[pp.name]) continue
    const P0 = out[pp.from]
    const Q = (pp.plane || []).map((n) => out[n]).filter(Boolean) as [number, number, number][]
    if (!P0 || Q.length < 3) continue
    const nrm = cross(sub(Q[1], Q[0]), sub(Q[2], Q[0]))
    const nn = dot(nrm, nrm)
    if (nn < 1e-12) continue
    const d = dot(sub(P0, Q[0]), nrm) / nn
    out[pp.name] = [
      +(P0[0] - nrm[0] * d).toFixed(4),
      +(P0[1] - nrm[1] * d).toFixed(4),
      +(P0[2] - nrm[2] * d).toFixed(4),
    ]
  }
  // 自由点（直接给坐标）
  for (const fp of m.freePoints || []) {
    if (fp?.name && Array.isArray(fp.at) && fp.at.length === 3 && !out[fp.name]) {
      out[fp.name] = [+fp.at[0], +fp.at[1], +fp.at[2]]
    }
  }
  // 【v1571】受约束点：位置 = 所在对象 + 一个参数 ✓
  //   拖动的本质就是改这个参数 —— 约束**天然保持**（不需要每次重新投影纠偏 ✗）
  for (const op of m.onPoints || []) {
    if (!op?.name || out[op.name]) continue
    const p = resolveOnPoint(m, out, op.on)
    if (p) out[op.name] = p
  }
  // 直线与平面的交点（构造点）：跟定比分点一样，解析出来当普通顶点用
  for (const mp of m.meetPoints || []) {
    if (!mp?.name || out[mp.name]) continue
    const A = out[mp.line?.[0]], B = out[mp.line?.[1]]
    const Q = (mp.plane || []).map((n) => out[n]).filter(Boolean) as [number, number, number][]
    if (!A || !B || Q.length < 3) continue
    const d: [number, number, number] = [B[0] - A[0], B[1] - A[1], B[2] - A[2]]
    const e1v = sub(Q[1], Q[0])
    const e2v = sub(Q[2], Q[0])
    const nrm = cross(e1v, e2v)
    const den = d[0] * nrm[0] + d[1] * nrm[1] + d[2] * nrm[2]
    // 直线与平面平行（或在平面内）→ 没有唯一交点，跳过
    if (Math.abs(den) < 1e-9) continue
    const t = dot(sub(Q[0], A), nrm) / den
    out[mp.name] = [
      +(A[0] + d[0] * t).toFixed(4),
      +(A[1] + d[1] * t).toFixed(4),
      +(A[2] + d[2] * t).toFixed(4),
    ]
  }
  return out
}

/** 【v1571】过 `Q[0..2]` 的平面上的**面内正交基** ✓
 *  `e₁ = normalize(Q₁−Q₀)`、`n = e₁×(Q₂−Q₀)`、`e₂ = n×e₁` —— **必须正交** ✗：
 *  直接拿 `Q₁−Q₀`、`Q₂−Q₀` 当基的话它们不正交，点会沿斜方向漂 ✗
 *  三点共线 / 重合 → `null` ✓ */
export function faceBasis(Q: [number, number, number][]): {
  o: [number, number, number]
  e1: [number, number, number]
  e2: [number, number, number]
} | null {
  if (!Q || Q.length < 3) return null
  const d1 = sub(Q[1], Q[0])
  const l1 = Math.hypot(d1[0], d1[1], d1[2])
  if (l1 < 1e-9) return null
  const e1: [number, number, number] = [d1[0] / l1, d1[1] / l1, d1[2] / l1]
  const nr = cross(e1, sub(Q[2], Q[0]))
  const ln = Math.hypot(nr[0], nr[1], nr[2])
  if (ln < 1e-9) return null
  const n1: [number, number, number] = [nr[0] / ln, nr[1] / ln, nr[2] / ln]
  return { o: Q[0], e1, e2: cross(n1, e1) }
}

/** 【v1571】把三维点 `X` **投影到平面上**并给出面内坐标 `(u,v)` ✓
 *  与 `resolveOnPoint` 的 `face`/`plane` 用**同一套基** —— 拖动时用它才不会跳 ✓ */
export function faceUV(Q: [number, number, number][], X: [number, number, number]): { u: number; v: number } | null {
  const B = faceBasis(Q)
  if (!B) return null
  const w = sub(X, B.o)
  // 先投影到平面（消掉法向分量 ✗），再取面内两个分量 ✓
  const nrm = cross(B.e1, B.e2)
  const dn = dot(w, nrm)
  const wp: [number, number, number] = [w[0] - nrm[0] * dn, w[1] - nrm[1] * dn, w[2] - nrm[2] * dn]
  return { u: dot(wp, B.e1), v: dot(wp, B.e2) }
}

/** 【v1571】把「受约束点」的约束解析成三维坐标 ✓
 *  · `edge`   —— `A + t·(B−A)`，t 夹到 [0,1]
 *  · `face` / `plane` —— `P₀ + u·e₁ + v·e₂`，`e₁/e₂` 是**面内的正交基** ✓
 *    （不能直接拿 `P₁−P₀`、`P₂−P₀` 当基 ✗：它们不正交，点会沿斜方向漂 ✗）
 *  · `circle` —— `(r·cos θ, r·sin θ, z)`，z 由 `which` 定（底面 0 / 顶面 h / 赤道 0）✓
 *  解析不出来（引用的点还没算出来 / 三点共线 / 圆锥要顶面圆 …）→ `null` ✓ */
export function resolveOnPoint(
  m: Geom3D,
  out: Record<string, [number, number, number]>,
  on: NonNullable<Geom3D['onPoints']>[number]['on'],
): [number, number, number] | null {
  if (!on) return null
  const r4 = (v: number) => +v.toFixed(4)
  if (on.kind === 'edge') {
    const A = out[on.a], B = out[on.b]
    if (!A || !B) return null
    const t = Math.max(0, Math.min(1, on.t))
    return [r4(A[0] + (B[0] - A[0]) * t), r4(A[1] + (B[1] - A[1]) * t), r4(A[2] + (B[2] - A[2]) * t)]
  }
  if (on.kind === 'face' || on.kind === 'plane') {
    const names = (on.kind === 'face' ? on.face : on.through) || []
    const P = names.map((n) => out[n]).filter(Boolean) as [number, number, number][]
    const B = faceBasis(P)
    if (!B) return null                 // 点不够 / 三点共线 → 定不出平面 ✓
    return [
      r4(B.o[0] + B.e1[0] * on.u + B.e2[0] * on.v),
      r4(B.o[1] + B.e1[1] * on.u + B.e2[1] * on.v),
      r4(B.o[2] + B.e1[2] * on.u + B.e2[2] * on.v),
    ]
  }
  if (on.kind === 'circle') {
    const pr = m.primitive
    if (!pr) return null
    if (on.which === 'equator' && pr.type !== 'sphere') return null
    if (on.which === 'top' && pr.type !== 'cylinder') return null   // 圆锥没有顶面圆 ✓
    const z = on.which === 'top' ? pr.h : 0
    return [r4(pr.r * Math.cos(on.th)), r4(pr.r * Math.sin(on.th)), r4(z)]
  }
  return null
}

/** 直线（o + t·dir）在共面多边形环内的参数区间（环是这个平面截多面体得到的截面）。
 *  没有交点或整条线在环外 → null。 */
function spanInRing(
  o: [number, number, number],
  dir: [number, number, number],
  ring: [number, number, number][],
): [number, number] | null {
  const ts: number[] = []
  for (let k = 0; k < ring.length; k++) {
    const A = ring[k]
    const B = ring[(k + 1) % ring.length]
    const e = sub(B, A)
    const w0 = sub(o, A)
    const n = cross(dir, e)
    const nn = dot(n, n)
    if (nn < 1e-12) continue
    const t = dot(cross(w0, e), n) / nn
    // s 要取负 —— 直接套 t 的写法会把符号带错（踩过：t 对、s 反，结果全被 s∈[0,1] 滤掉，
    // 交线一条都出不来，但看起来"公式没问题"）
    const s = -dot(cross(w0, dir), n) / nn
    if (s >= -1e-6 && s <= 1 + 1e-6) ts.push(t)
  }
  if (!ts.length) return null
  return [Math.min(...ts), Math.max(...ts)]
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

/** 字母的八个方位（罗盘方向；屏幕坐标系，N = 上） */
export type LabelDir = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW'

/** 八方位 → 单位方向（屏幕坐标：x 向右、y 向下，所以 N 是 −1） */
export const LABEL_DIR_VEC: Record<LabelDir, [number, number]> = {
  N: [0, -1], NE: [0.7071, -0.7071], E: [1, 0], SE: [0.7071, 0.7071],
  S: [0, 1], SW: [-0.7071, 0.7071], W: [-1, 0], NW: [-0.7071, -0.7071],
}

/** 把"方位 + 距离(px)"换算成渲染器要的 labelOffsets（dx/dy 是占元素宽高的比例）。
 *  w / h 是元素（或预览）的像素尺寸 —— 换算是按它来的，所以缩放元素时比例不变、
 *  视觉距离会跟着缩放（跟应用里拖字母的行为一致）。 */
export function labelOffsetsFrom(
  m: Geom3D | null | undefined,
  names: string[],
  w: number,
  h: number,
): ({ dx: number; dy: number } | null)[] | undefined {
  const lp = m?.labelPos
  if (!lp || !Object.keys(lp).length || w <= 0 || h <= 0) return undefined
  const out = names.map((n) => {
    const p = lp[n]
    if (!p) return null
    let ox = 0, oy = 0
    if (typeof p.dx === 'number' || typeof p.dy === 'number') {
      ox = p.dx || 0
      oy = p.dy || 0
    } else if (p.dir && LABEL_DIR_VEC[p.dir]) {
      const d = p.dist || 0
      ox = LABEL_DIR_VEC[p.dir][0] * d
      oy = LABEL_DIR_VEC[p.dir][1] * d
    } else return null
    return { dx: ox / w, dy: oy / h }
  })
  return out.some(Boolean) ? out : undefined
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
  /** 与 mesh.edges 一一对应的线样式（颜色/线宽/虚实），编辑器改属性用 */
  edgeStyles: ({ color?: string; width?: number; dash?: 'solid' | 'dash' | 'dot' } | null)[]
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
    /** 空间点 → 屏幕坐标（未归一化） */
    const scr3 = (x: number, y: number, z: number): [number, number] =>
      [x * right[0] + y * right[1] + z * right[2], -(x * up[0] + y * up[1] + z * up[2])]
    /** 屏幕上一点 → 该**水平面**内的 (x, y)：2×2 线性映射求逆 */
    const planeXY = (sx: number, sy: number): [number, number] => {
      const a11 = right[0], a12 = right[1], a21 = -up[0], a22 = -up[1]
      const det = a11 * a22 - a12 * a21
      if (Math.abs(det) < 1e-12) return [0, 0]
      return [(sx * a22 - a12 * sy) / det, (a11 * sy - sx * a21) / det]
    }
    /** 水平面内、圆心 (0,0,z)、半径 r 的圆 → 投影椭圆 + **可见半圈的椭圆参数区间**。
     *  要点：**3D 圆的参数 t 和投影椭圆的参数 θ 不是一回事**（差一个仿射变换）——
     *  直接把 t 当 θ 用，虚实会整个反过来、母线也接不上椭圆（用户报过这个）。
     *  做法：切点先在 3D 算，投影到 2D 后换算成椭圆参数；哪半可见由"该点深度是否为正"定。 */
    const circleSplit = (z: number) => {
      const c2 = scr3(0, 0, z)
      const U = scr3(r, 0, z), V = scr3(0, r, z)
      const e = ellipseFromConjugate(U[0] - c2[0], U[1] - c2[1], V[0] - c2[0], V[1] - c2[1])
      const at = (th: number): [number, number] => {
        const x = e.rx * Math.cos(th), y = e.ry * Math.sin(th)
        const cp = Math.cos(e.rot), sp = Math.sin(e.rot)
        return [c2[0] + x * cp - y * sp, c2[1] + x * sp + y * cp]
      }
      const paramOf = (sx: number, sy: number): number => {
        const ux = sx - c2[0], uy = sy - c2[1]
        const cp = Math.cos(-e.rot), sp = Math.sin(-e.rot)
        const x = ux * cp - uy * sp, y = ux * sp + uy * cp
        return Math.atan2(y / e.ry, x / e.rx)
      }
      const depthAt = (th: number): number => {
        const s = at(th)
        const q = planeXY(s[0], s[1])
        return q[0] * d[0] + q[1] * d[1]
      }
      const t1 = [r * Math.cos(t0), r * Math.sin(t0), z] as [number, number, number]
      const t2 = [-r * Math.cos(t0), -r * Math.sin(t0), z] as [number, number, number]
      const th1 = paramOf(...scr3(t1[0], t1[1], t1[2]))
      const th2 = paramOf(...scr3(t2[0], t2[1], t2[2]))
      const norm2 = (v: number) => { let x = v % (Math.PI * 2); if (x < 0) x += Math.PI * 2; return x }
      const fwd = norm2(th2 - th1)
      const vis = depthAt(norm2(th1 + fwd / 2)) > 0
      // **区间要用"沿正向走 fwd"来表达**：直接写 [th1, th2] 会踩坑 ——
      // th2 可能算出来是 −π（反向），那样画出来的是另一半，虚实正好反（用户报过）。
      const from = vis ? th1 : th2
      const to = vis ? th1 + fwd : th2 + (Math.PI * 2 - fwd)
      return { c2, e, from, to, paramOf, at, depthAt }
    }
    /** 从椭圆外一点 P2 向椭圆作切线，返回两个切点（屏幕坐标）。
     *  **圆锥的母线落点用的是这个**，不是椭圆的左右端点 —— 那只对圆柱成立。
     *  （用户拿教材图对比指出：母线该是切线，不能穿过底面椭圆。） */
    const tangentFromPoint = (
      e: { rx: number; ry: number; rot: number },
      c2: [number, number],
      P2: [number, number],
    ): [number, number][] | null => {
      const cp = Math.cos(-e.rot), sp = Math.sin(-e.rot)
      const dx = P2[0] - c2[0], dy = P2[1] - c2[1]
      const ux = (dx * cp - dy * sp) / e.rx
      const uy = (dx * sp + dy * cp) / e.ry
      const d2 = ux * ux + uy * uy
      if (d2 <= 1.0001) return null
      const k = 1 / d2, m = Math.sqrt(d2 - 1) / d2
      const back = (tx: number, ty: number): [number, number] => {
        const x = tx * e.rx, y = ty * e.ry
        const c2r = Math.cos(e.rot), s2r = Math.sin(e.rot)
        return [c2[0] + x * c2r - y * s2r, c2[1] + x * s2r + y * c2r]
      }
      return [back(k * ux - m * uy, k * uy + m * ux), back(k * ux + m * uy, k * uy - m * ux)]
    }
    const edges: [number, number, number][] = []
    let apex = -1, iA = -1, iB = -1
    if (type === 'sphere') {
      // 球：侧影是个**正圆**（正交投影下），另加一条赤道椭圆。
      // 赤道用上面那套共轭直径法；侧影圆直接给 rx = ry = r（视线方向是单位向量，屏幕半径就等于 r）。
      push('O', [0, 0, 0])
      const c0 = sc([0, 0, 0])
      // 赤道用跟底面圆**同一套**切点/虚实算法（3D 参数 ≠ 椭圆参数，别自己算一遍）
      const eqS = circleSplit(0)
      const arcsS: { cx: number; cy: number; rx: number; ry: number; rot: number; a0: number; a1: number; dash: 0 | 1 }[] = [
        { cx: c0[0], cy: c0[1], rx: r, ry: r, rot: 0, a0: 0, a1: Math.PI * 2, dash: 0 },               // 侧影圆（整圈实线）
        { cx: eqS.c2[0], cy: eqS.c2[1], ...eqS.e, a0: eqS.from, a1: eqS.to, dash: 0 },                  // 赤道近半
        { cx: eqS.c2[0], cy: eqS.c2[1], ...eqS.e, a0: eqS.to, a1: eqS.from + Math.PI * 2, dash: 1 },    // 赤道远半
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
      return { points: pts2, mesh: { edges: [], faces: [] }, vlabels, arcs: arcs2, aspect: bw2 / bh2, faceStyles: [], edgeStyles: [] }
    }
    const axial = !!m.primitive.axial
    const iO = (): number => names.findIndex((n) => n === 'O')
    /** 圆锥：母线落点 = **从顶点投影向底面椭圆作的切线的切点**（不是椭圆的左右端点）。
     *  左右端点那条只对圆柱成立 —— 用户拿教材图对比指出过：母线必须是切线，不能穿进底面。 */
    let coneSplit: { from: number; to: number } | null = null
    if (type === 'cone') {
      const cs = circleSplit(0)
      let pA: [number, number, number] = tang[0]
      let pB: [number, number, number] = tang[1]
      const tps = tangentFromPoint(cs.e, cs.c2, scr3(0, 0, h))
      if (tps) {
        const back = (s: [number, number]): [number, number, number] => {
          const q = planeXY(s[0], s[1])
          return [+q[0].toFixed(4), +q[1].toFixed(4), 0]
        }
        pA = back(tps[0]); pB = back(tps[1])
        const thA = cs.paramOf(tps[0][0], tps[0][1])
        const thB = cs.paramOf(tps[1][0], tps[1][1])
        const nrm2 = (v: number) => { let x = v % (Math.PI * 2); if (x < 0) x += Math.PI * 2; return x }
        const fw = nrm2(thB - thA)
        const visHalf = cs.depthAt(nrm2(thA + fw / 2)) > 0
        coneSplit = visHalf ? { from: thA, to: thA + fw } : { from: thB, to: thB + (Math.PI * 2 - fw) }
      }
      apex = push('P', [0, 0, h])
      push('O', [0, 0, 0])
      iA = push(axial ? 'A' : null, pA)
      iB = push(axial ? 'B' : null, pB)
      edges.push([apex, iA, 0], [apex, iB, 0])
      if (axial) {
        // 轴截面：A–O、O–B 在锥体内部 → 虚线；三角形整体着色（教材的画法）
        edges.push([iA, iO(), 1], [iO(), iB, 1])
      }
    } else {
      push('O', [0, 0, 0])
      push('O1', [0, 0, h])
      iA = push(axial ? 'A' : null, tang[0])
      iB = push(axial ? 'B' : null, tang[1])
      const iA1 = push(axial ? 'A1' : null, [tang[0][0], tang[0][1], h])
      const iB1 = push(axial ? 'B1' : null, [tang[1][0], tang[1][1], h])
      edges.push([iA, iA1, 0], [iB, iB1, 0])
      if (axial) {
        edges.push([iA, iB, 1], [iA1, iB1, 0])     // 底面的直径在体内（虚线）、顶面的直径看得见（实线）
      }
    }
    const arcs: { cx: number; cy: number; rx: number; ry: number; rot: number; a0: number; a1: number; dash: 0 | 1 }[] = []
    // 底面：近半可见（实线）、远半被挡（虚线）—— 这就是教材里圆柱/圆锥底的那条画法
    const eb = circleSplit(0)
    // 圆锥的切分点用切线切点（跟母线落点一致），圆柱用椭圆的左右端点
    const bf = coneSplit ? coneSplit.from : eb.from
    const bt = coneSplit ? coneSplit.to : eb.to
    arcs.push({ cx: eb.c2[0], cy: eb.c2[1], ...eb.e, a0: bf, a1: bt, dash: 0 })
    arcs.push({ cx: eb.c2[0], cy: eb.c2[1], ...eb.e, a0: bt, a1: bf + Math.PI * 2, dash: 1 })
    if (type === 'cylinder') {
      // 顶面：从上方看整圈都可见（实线）
      const et = circleSplit(h)
      arcs.push({ cx: et.c2[0], cy: et.c2[1], ...et.e, a0: 0, a1: Math.PI * 2, dash: 0 })
    }
    // 归一化：把顶点和椭圆包围盒一起算进去，整体居中
    const xs = P3.map((p) => sc(p)[0])
    const ys = P3.map((p) => sc(p)[1])
    const rm = Math.max(eb.e.rx, eb.e.ry)
    xs.push(eb.c2[0] - rm, eb.c2[0] + rm)
    ys.push(eb.c2[1] - rm, eb.c2[1] + rm)
    if (type === 'cylinder') {
      const et = circleSplit(h)
      const r2 = Math.max(et.e.rx, et.e.ry)
      xs.push(et.c2[0] - r2, et.c2[0] + r2)
      ys.push(et.c2[1] - r2, et.c2[1] + r2)
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
    // 轴截面着色（一个面）：圆锥是三角形 P-A-B，圆柱是矩形 A-B-B1-A1
    const axFace: number[][] = []
    if (axial) {
      if (type === 'cone') axFace.push([apex, iA, iB])
      else axFace.push([iA, iB, names.findIndex((n) => n === 'B1'), names.findIndex((n) => n === 'A1')])
    }
    const axStyles = axFace.map(() => ({ fill: '#c9c9c9', opacity: 0.4 }))
    // 曲面体的线样式：按两端点名查（母线、直径这些都能改颜色/线宽/虚实）
    const esF = m.edgeStyles || {}
    const ekeyF = (i: number, j: number) => [names[i], names[j]].sort().join('|')
    const edgeStylesF = edges.map(([i, j]) => {
      const o = esF[ekeyF(i, j)]
      if (!o) return null
      return { color: o.color, width: o.width, dash: o.dash === 1 ? 'dash' as const : o.dash === 0 ? 'solid' as const : undefined }
    })
    return {
      points, mesh: { edges, faces: axFace }, vlabels, arcs: arcsOut, aspect: bw / bh,
      faceStyles: axStyles as ({ fill?: string; opacity?: number } | null)[],
      edgeStyles: edgeStylesF,
    }
  }

  // ---------------- 多面体（走面表） ----------------
  // 顶点 + 定比分点（跟界面共用同一个解析，保证顺序一致）
  const vertsAll = resolveVertices(m)
  const names = Object.keys(vertsAll)
  const idx: Record<string, number> = {}
  names.forEach((n, i) => { idx[n] = i })
  const P3 = names.map((n) => vertsAll[n]) as [number, number, number][]
  if (!P3.length) return { points: [], mesh: { edges: [], faces: [] }, vlabels: [], arcs: [], aspect: 1, faceStyles: [], edgeStyles: [] }

  const faces = (m.faces || []).map((f) => f.map((n) => idx[n]).filter((k) => k !== undefined))
  // **多点确定平面 → 求截面**：三个点定出平面，再逐面求交得到真正的截面多边形。
  // （必须在归一化之前算，截面的顶点也要进包围盒，否则图会偏。）
  const hid = new Set(m.hidden || [])
  const sections: { ring: [number, number, number][]; fill?: string | null }[] = []
  for (let pi = 0; pi < (m.planeCuts || []).length; pi++) {
    const pc = (m.planeCuts || [])[pi]
    if (hid.has('plane:' + pi)) continue
    const ids = (pc.through || []).map((n) => idx[n]).filter((k) => k !== undefined)
    if (ids.length < 3) continue
    const p0 = P3[ids[0]]
    const nrm = norm(cross(sub(P3[ids[1]], p0), sub(P3[ids[2]], p0)))
    if (!isFinite(nrm[0]) || Math.hypot(nrm[0], nrm[1], nrm[2]) < 1e-9) continue
    // **平面与某个面重合**（用同一个面的三点作平面时就会）→ 直接拿那个面当截面。
    // 不特判的话，求交会得到"整面重合"的退化段，接不成环，截面就悄没声地没了。
    const coFace = faces.find(
      (f) => f.length >= 3 && f.every((i) => Math.abs(dot(sub(P3[i], p0), nrm)) < 1e-6),
    )
    const ring = coFace ? coFace.map((i) => P3[i]) : sectionPolygon(P3, faces, p0, nrm)
    if (ring.length >= 3) sections.push({ ring, fill: pc.fill })
  }

  // **两平面的交线**：nA × nB 是方向；线上一点解 [nA; nB; dir]·P = [cA; cB; 0]（Cramer，det = |dir|²）。
  // 再分别截到两个平面各自的截面环里，取公共区间。
  const meetLines: [number, number, number][][] = []
  for (let li = 0; li < (m.intersectLines || []).length; li++) {
    const il = (m.intersectLines || [])[li]
    if (hid.has('il:' + li)) continue
    const pa = (il.a || []).map((n) => idx[n]).filter((k) => k !== undefined)
    const pb = (il.b || []).map((n) => idx[n]).filter((k) => k !== undefined)
    if (pa.length < 3 || pb.length < 3) continue
    const nA = norm(cross(sub(P3[pa[1]], P3[pa[0]]), sub(P3[pa[2]], P3[pa[0]])))
    const nB = norm(cross(sub(P3[pb[1]], P3[pb[0]]), sub(P3[pb[2]], P3[pb[0]])))
    const dir = cross(nA, nB)
    const dd = dot(dir, dir)
    if (dd < 1e-10) continue                       // 两平面平行（或重合）→ 没有唯一交线
    const cA = dot(nA, P3[pa[0]])
    const cB = dot(nB, P3[pb[0]])
    // Cramer：系数矩阵的行是 [nA; nB; dir]，所以它的**列**是下面三个 ——
    // 行列式要按"列"给（det(a,b,c) = a·(b×c)）。踩过的坑：按行传会把位置解错，
    // 交线整个跑到别处，而公式看上去"没毛病"。
    const detC = (a: [number, number, number], b2: [number, number, number], c2: [number, number, number]) =>
      a[0] * (b2[1] * c2[2] - b2[2] * c2[1]) + a[1] * (b2[2] * c2[0] - b2[0] * c2[2]) + a[2] * (b2[0] * c2[1] - b2[1] * c2[0])
    const cx: [number, number, number] = [nA[0], nB[0], dir[0]]
    const cy: [number, number, number] = [nA[1], nB[1], dir[1]]
    const cz: [number, number, number] = [nA[2], nB[2], dir[2]]
    const det = detC(cx, cy, cz)
    if (Math.abs(det) < 1e-10) continue
    const rhs: [number, number, number] = [cA, cB, 0]
    const onLine: [number, number, number] = [
      detC(rhs, cy, cz) / det,
      detC(cx, rhs, cz) / det,
      detC(cx, cy, rhs) / det,
    ]
    // 截到多面体内部：两个平面的截面环各自给出一个参数区间，取交集
    const ringA = sectionPolygon(P3, faces, P3[pa[0]], nA)
    const ringB = sectionPolygon(P3, faces, P3[pb[0]], nB)
    const sA = ringA.length >= 3 ? spanInRing(onLine, dir, ringA) : null
    const sB = ringB.length >= 3 ? spanInRing(onLine, dir, ringB) : null
    if (!sA || !sB) continue
    const lo = Math.max(sA[0], sB[0])
    const hi = Math.min(sA[1], sB[1])
    if (hi - lo < 1e-6) continue
    const pt = (t: number): [number, number, number] => [
      +(onLine[0] + dir[0] * t).toFixed(4),
      +(onLine[1] + dir[1] * t).toFixed(4),
      +(onLine[2] + dir[2] * t).toFixed(4),
    ]
    meetLines.push([pt(lo), pt(hi)])
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
  for (const seg of meetLines) {
    for (const p of seg) {
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

  // 交线的两个端点也是**新点**，追加到 points 末尾（无字母）
  const meetIdx: number[][] = []
  for (const seg of meetLines) {
    const ids: number[] = []
    for (const p of seg) {
      const sx = dot(p, right), sy = -dot(p, up)
      ids.push(points.length / 2)
      points.push(+(ox + (sx - x0) * s).toFixed(4), +(oy + (sy - y0) * s).toFixed(4))
    }
    meetIdx.push(ids)
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
      // 防护：截面/交线会往 faces 里加"只存在于 points 里的点"，它们的下标索引不到 P3
      if (!A || !faceNormal[fi]) continue
      if (dot(faceNormal[fi], sub(p, A)) > 1e-6) return false
    }
    return true
  }
  const auxVisible: { i: number; j: number; dash: 0 | 1 }[] = []
  for (let ai = 0; ai < (m.auxiliary || []).length; ai++) {
    const a = (m.auxiliary || [])[ai]
    if (hid.has('aux:' + ai)) continue
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

  // 投影点：勾了"连垂线"就画 from→投影点（穿在体内画虚线，跟辅助线同一套规矩）。
  // **必须在截面/交线往 faces 里塞新点之前做** —— 那些点的下标只存在于 points 里，
  // inside() 遍历 faces 时会拿它们去索引 P3，直接崩（踩过）。
  const footEdges: [number, number, number][] = []
  for (let qi = 0; qi < (m.projectPoints || []).length; qi++) {
    const pp = (m.projectPoints || [])[qi]
    if (!pp?.foot || hid.has('pp:' + qi)) continue
    const i = idx[pp.from], j = idx[pp.name]
    if (i === undefined || j === undefined) continue
    const mid: [number, number, number] = [
      (P3[i][0] + P3[j][0]) / 2,
      (P3[i][1] + P3[j][1]) / 2,
      (P3[i][2] + P3[j][2]) / 2,
    ]
    footEdges.push([i, j, inside(mid) ? 1 : 0])
  }
  const edges: [number, number, number][] = [...edgeMap.values()].map((e) => [e.i, e.j, e.front ? 0 : 1])
  for (const fe of footEdges) {
    if (!edges.some((e) => (e[0] === fe[0] && e[1] === fe[1]) || (e[0] === fe[1] && e[1] === fe[0]))) edges.push(fe)
  }
  for (const a of auxVisible) {
    const dup = edges.some((e) => (e[0] === a.i && e[1] === a.j) || (e[0] === a.j && e[1] === a.i))
    if (!dup) edges.push([a.i, a.j, a.dash])
  }
  // 截面 / 辅助面：作为**面**加进去（可填充），它的边也画出来。
  // 边是实是虚按这个多边形自己朝向定 —— 截面通常是题目的主角，朝向相机就画实线。
  // 注意：要在上面那套可见性算完之后再加，免得它参与"棱属于哪个面"的判断。
  const cutStyles: { fill?: string; opacity?: number }[] = []
  for (let ci = 0; ci < (m.cutPlanes || []).length; ci++) {
    const cp = (m.cutPlanes || [])[ci]
    if (hid.has('cut:' + ci)) continue
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
  // 点样式：编辑器里改过的标签优先（label 为 null 表示不显示这个字母）
  const ps = m.pointStyles || {}
  // 交线：画成一条线（实线 —— 它是题目的结论，不该被虚实规则藏起来）
  for (const ids of meetIdx) {
    if (ids.length >= 2) edges.push([ids[0], ids[1], 0])
  }
  const vlabels = names.map((n) => {
    if (hid.has('p:' + n)) return null            // 点了"隐藏"的点不显示字母（点还在，别的线仍可用）
    const ov = ps[n]
    if (ov && 'label' in ov) return ov.label == null ? null : toLabelText(ov.label)
    if (m.labels && !(n in m.labels)) return null
    return toLabelText(m.labels?.[n] || n)
  })
  if (secIdx.length) vlabels.push(...secIdx.map((ids) => ids.map(() => null)).flat())
  if (meetIdx.length) vlabels.push(...meetIdx.map((ids) => ids.map(() => null)).flat())
  const faceStyles = faces.map((_, i) => cutStyles[i - (faces.length - cutStyles.length)] || null)
  // 线样式（编辑器改的属性）：按两端点名查，与 mesh.edges 一一对应
  const es = m.edgeStyles || {}
  const ekey = (i: number, j: number) => {
    const a = names[i], b = names[j]
    return a === undefined || b === undefined ? '' : [a, b].sort().join('|')
  }
  // 隐藏的线（e:A|B，两端点名按字典序）—— 要在算 edgeStyles 之前过滤，保持一一对应
  const edgesOut = edges.filter(([i, j]) => {
    const a = names[i], b = names[j]
    return !(a !== undefined && b !== undefined && hid.has('e:' + [a, b].sort().join('|')))
  })
  const edgeStylesOut = edgesOut.map(([i, j]) => {
    const o = es[ekey(i, j)]
    if (!o) return null
    return { color: o.color, width: o.width, dash: o.dash === 1 ? 'dash' as const : o.dash === 0 ? 'solid' as const : undefined }
  })
  return { points, mesh: { edges: edgesOut, faces }, vlabels, arcs: [], aspect: bw / bh, faceStyles, edgeStyles: edgeStylesOut }
}
