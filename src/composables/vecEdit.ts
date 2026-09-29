/**
 * 【v1744】手动编辑几何的小工具（纯函数 ✓ 探针盯着 ✓）
 *
 * 老师实报要两样：**线合并 / 点合并**（这两样弹窗里其实早有 ✓ 但只在"选中顶点"时才出现 ✗ 不好发现 ✓）
 * 与 **「＋ 补一个点」**（这个真没有 ✗ —— 只有"补线模式里点空白会新建点"那个半成品 ✓）
 *
 * 补点的规矩（按数学题的常见需求定 ✓）：
 *  · 点**空白处** → 加一个自由点（字母空着，右侧再填 ✓）
 *  · 点**贴着某条线** → 顺手把那条线**劈成两段**，新点落在线上 ✓（"点在线上"是几何题最需要的那一种 ✓）
 *  · 点**贴着已有顶点** → **不重复加** ✓ 返回那个顶点让调用方选中它 ✓（免得点出重影 ✗）
 */

export interface VecDraft { pts: number[]; edges: [number, number, number][] }

export type AddPointResult =
  | { kind: 'vertex'; at: number }
  | { kind: 'point'; at: number; pts: number[]; edges: [number, number, number][]; split: number; note: string; a?: number; b?: number; t?: number }

/** 【v1745】"在指定边上加点"**只会**成功成"点"（不会返回 vertex 变体 ✓）—— 单独给它一个窄类型 ✓
 *  （不然调用方拿到的是联合类型 ✗ 访问 .pts/.a/.t 都报 TS2339 ✗） */
export interface AddPointOnEdgeResult {
  kind: 'point'
  at: number
  pts: number[]
  edges: [number, number, number][]
  split: number
  note: string
  a: number
  b: number
  t: number
}

/** 【v1744】受约束的点：钉在一条边上（参数 t ∈ [0,1]，位置**每次现算** ✓） */
export interface Constr { a: number; b: number; t: number }

/** 点到线段的距离（归一化坐标下 ✓ 纯几何 ✓） */
export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const L2 = dx * dx + dy * dy
  if (L2 <= 1e-12) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / L2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * 【v1744】在 (x, y) 处补一个点 ✓（纯函数：不改入参 ✓ 返回新数组 ✓）
 *  @param nearV    判定"这是已有顶点"的半径（归一化，默认 0.012 ≈ 图上 1.2% ✓）
 *  @param nearEdge 判定"贴着这条线"的半径（默认 0.012 ✓）
 */
export function addPointAt(d: VecDraft, x: number, y: number, opt: { nearV?: number; nearEdge?: number } = {}): AddPointResult {
  const nearV = opt.nearV == null ? 0.012 : opt.nearV
  const nearEdge = opt.nearEdge == null ? 0.012 : opt.nearEdge
  const pts = (d && d.pts ? d.pts : []).slice()
  const edges = (d && d.edges ? d.edges : []).map((e) => [e[0], e[1], e[2]] as [number, number, number])
  const n = pts.length / 2
  /* ① 贴着已有顶点 → 不加，交给调用方选中它 ✓ */
  let bv = -1
  let bd = nearV
  for (let i = 0; i < n; i++) {
    const dd = Math.hypot(pts[i * 2] - x, pts[i * 2 + 1] - y)
    if (dd <= bd) { bd = dd; bv = i }
  }
  if (bv >= 0) return { kind: 'vertex', at: bv }
  /* ② 贴着某条边 → 记下来，待会儿把那一条劈成两段 ✓ */
  let be = -1
  let bde = nearEdge
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]
    const ax = pts[e[0] * 2]
    const ay = pts[e[0] * 2 + 1]
    const bx = pts[e[1] * 2]
    const by = pts[e[1] * 2 + 1]
    if (![ax, ay, bx, by].every((v) => Number.isFinite(v))) continue
    const dd = segDist(x, y, ax, ay, bx, by)
    if (dd <= bde) { bde = dd; be = i }
  }
  /* ③ 加点 ✓ */
  pts.push(x, y)
  const at = n
  let note = '已补一个自由点 #' + at + '（字母可以右侧填 ✓）'
  if (be >= 0) {
    const [a, b, dash] = edges[be]
    const ax = pts[a * 2]
    const ay = pts[a * 2 + 1]
    const bx = pts[b * 2]
    const by = pts[b * 2 + 1]
    const L2 = (bx - ax) * (bx - ax) + (by - ay) * (by - ay)
    const tt = L2 <= 1e-12 ? 0.5 : Math.max(0.02, Math.min(0.98, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2))
    edges.splice(be, 1)
    edges.push([a, at, dash], [at, b, dash])
    note = '已补一个点 #' + at + '，并把它**受约束**地落在选中的线 ' + a + '–' + b + ' 上（那条线拆成两段 ✓' + (dash ? ' 虚线也保持 ✓' : '') + '）'.replace('**', '').replace('**', '')
    return { kind: 'point', at, pts, edges, split: be, note, a, b, t: tt }
  }
  return { kind: 'point', at, pts, edges, split: be, note }
}

/**
 * 【v1744】把**受约束的点**按它所在边的两个端点重算位置（纯函数 ✓）——
 * 端点一动它就自己留在线上 ✓；那条边**没了**（或端点被删）就**解除约束**（点本身保留 ✓ 不静默删人东西 ✓）
 * ⚠ 约束点**不能是它自己那条边的端点**（那样是自环 ✗）→ 遇到就解除 ✓
 */
export function resolveConstrained(
  pts: number[],
  cons: (Constr | null)[],
  _edges?: [number, number, number][],
): { pts: number[]; cons: (Constr | null)[] } {
  const P = (pts || []).slice()
  const C = (cons || []).slice()
  const n = P.length / 2
  const okRef = (a: number, b: number): boolean => a >= 0 && b >= 0 && a !== b && a < n && b < n
  // ⚠ 这里**不查「那条边还在不在」** ✗ —— 劈开之后原边就没了（变成两段 ✓），查存在会把约束误杀 ✗
  //   失效清理交给 `pruneCons` ✓
  for (let i = 0; i < n; i++) {
    const c = C[i]
    if (!c) continue
    if (i === c.a || i === c.b || !okRef(c.a, c.b)) { C[i] = null; continue }
    const ax = P[c.a * 2]
    const ay = P[c.a * 2 + 1]
    const bx = P[c.b * 2]
    const by = P[c.b * 2 + 1]
    if (![ax, ay, bx, by].every((v) => Number.isFinite(v))) { C[i] = null; continue }
    const t = Math.max(0, Math.min(1, c.t))
    P[i * 2] = +(ax + t * (bx - ax)).toFixed(4)
    P[i * 2 + 1] = +(ay + t * (by - ay)).toFixed(4)
  }
  return { pts: P, cons: C }
}

/**
 * 【v1744】约束的**失效清理**（纯函数 ✓）：受约束的点必须还挂在它的两个宿主端点之一上 ✓
 *  · 劈成两段（a–i、i–b 都在）→ **留着** ✓
 *  · 用户把这条线删了（两条半边都没了）→ **解除约束**（点本身保留 ✓）
 */
export function pruneCons(cons: (Constr | null)[], edges: [number, number, number][]): (Constr | null)[] {
  const has = (u: number, v: number) => (edges || []).some((e) => (e[0] === u && e[1] === v) || (e[0] === v && e[1] === u))
  return (cons || []).map((c, i) => {
    if (!c) return null
    const a = c.a
    const b = c.b
    if (a < 0 || b < 0 || a === b) return null
    return has(a, i) || has(i, b) ? c : null
  })
}

/**
 * 【v1744】**选中线段后在线段上加点**（老师口径 ✓）：把点落在**指定的那条边**上（按点击位置投影 ✓）
 *  · 投影位置夹在 [tMin, 1-tMin] 之间 ✓ —— 免得新点跟端点重合成一个"看起来没劈开"的边 ✗
 *  · 劈成两段时保留原边的虚实 ✓
 *  · 边号不合法 / 端点缺坐标 → 返回 null（调用方退回"自由点"那条路 ✓）
 */
export function addPointOnEdge(
  d: VecDraft,
  edgeIndex: number,
  x: number,
  y: number,
  opt: { tMin?: number } = {},
): AddPointOnEdgeResult | null {
  const tMin = opt.tMin == null ? 0.08 : opt.tMin
  const pts = (d && d.pts ? d.pts : []).slice()
  const edges = (d && d.edges ? d.edges : []).map((e) => [e[0], e[1], e[2]] as [number, number, number])
  const e = edges[edgeIndex]
  if (!e) return null
  const ax = pts[e[0] * 2]
  const ay = pts[e[0] * 2 + 1]
  const bx = pts[e[1] * 2]
  const by = pts[e[1] * 2 + 1]
  if (![ax, ay, bx, by].every((v) => Number.isFinite(v))) return null
  const dx = bx - ax
  const dy = by - ay
  const L2 = dx * dx + dy * dy
  let t = L2 <= 1e-12 ? 0.5 : ((x - ax) * dx + (y - ay) * dy) / L2
  t = Math.max(tMin, Math.min(1 - tMin, t))
  const nx = +(ax + t * dx).toFixed(4)
  const ny = +(ay + t * dy).toFixed(4)
  const at = pts.length / 2
  pts.push(nx, ny)
  const [a, b, dash] = e
  edges.splice(edgeIndex, 1)
  edges.push([a, at, dash], [at, b, dash])
  return {
    kind: 'point',
    at,
    pts,
    edges,
    a,
    b,
    t,
    split: edgeIndex,
    note: '已在选中的那条线 ' + a + '–' + b + ' 上补了点 #' + at + '（那条线拆成两段 ✓' + (dash ? ' 虚线保持 ✓' : '') + '）',
  }
}
