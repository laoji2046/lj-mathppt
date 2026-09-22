/**
 * 【v1519 · C】把识别结果**吸成标准立体图**（模板匹配）
 *
 * 「复刻图形」里那 8 套是人工核对过的标准图 —— 只要认出「这张图就是它」，就换成那一套。
 *
 * 安全（比收益重要）：
 *   1. **只在拓扑完全同构时才吸**：顶点数 / 边数 / 虚线数 / 度数谱 / 每条边在映射下逐条对上（含虚实）
 *      → 一条边都不会增删；
 *   2. 配准 = **闭式相似变换**（归一化 → PCA 主轴 → 4 种摆法：正向/反向 × 镜像），贪心最近点配双射；
 *      ⚠ 输出**只用相似变换**把标准图摆回原位（位置/大小/朝向跟原图，形状是标准的）；
 *      仿射拟合**不参与输出**（它会把输入的畸变又贴回去 —— 实测那样残差永远等于输入自身畸变，见诊断文档）；
 *   3. 图里有弧（圆/椭圆）时不匹配；残差超 figTol（默认 0.08）不吸；可关：VectorizeOpt.figMatch = 0。
 */
import { SOLID_FIGURE_PRESETS } from '@/templates/solidFigures'

export interface FigMatchResult {
  id: string
  name: string
  /** 配准残差（占图对角线的比例） */
  rms: number
  /** 模板顶点映射回**输入坐标系**的位置（扁平 x,y，下标与输入顶点一一对应） */
  points: number[]
  /** 对应关系：模板第 j 个顶点 ↔ 输入第 map[j] 个顶点（验证 / 单测要用） */
  map: number[]
}

interface Cand { id: string; name: string; pts: [number, number][]; edges: [number, number, number][]; deg: number[] }

let CANDS: Cand[] | null = null
function candidates(): Cand[] {
  if (CANDS) return CANDS
  const out: Cand[] = []
  for (const p of SOLID_FIGURE_PRESETS) {
    const raw = p.el?.points
    if (!raw || !p.el?.mesh) continue
    const pts: [number, number][] = []
    for (let i = 0; i < raw.length; i += 2) pts.push([raw[i], raw[i + 1]])
    const edges = p.el.mesh.edges.map((e) => [e[0], e[1], e[2] ? 1 : 0] as [number, number, number])
    const deg = new Array(pts.length).fill(0)
    for (const e of edges) { deg[e[0]]++; deg[e[1]]++ }
    out.push({ id: p.id, name: p.name, pts, edges, deg })
  }
  CANDS = out
  return out
}

const ekey = (a: number, b: number) => Math.min(a, b) + ':' + Math.max(a, b)

function norm(P: [number, number][]) {
  let cx = 0, cy = 0
  for (const p of P) { cx += p[0]; cy += p[1] }
  cx /= P.length; cy /= P.length
  let s = 0
  for (const p of P) s += (p[0] - cx) ** 2 + (p[1] - cy) ** 2
  const rms = Math.sqrt(s / P.length) || 1
  return { pts: P.map((p) => [(p[0] - cx) / rms, (p[1] - cy) / rms] as [number, number]), cx, cy, rms }
}
function pcaAngle(P: [number, number][]) {
  let sxx = 0, sxy = 0, syy = 0
  for (const [x, y] of P) { sxx += x * x; sxy += x * y; syy += y * y }
  return 0.5 * Math.atan2(2 * sxy, sxx - syy)
}
const rot = ([x, y]: [number, number], a: number): [number, number] => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]

export function matchFigure(
  pts: number[],
  edges: [number, number, number][],
  opt: { tol?: number; hasArcs?: boolean } = {},
): FigMatchResult | null {
  if (opt.hasArcs) return null
  const V = pts.length / 2
  if (V < 4 || V > 16) return null
  const tol = opt.tol ?? 0.08
  const IN: [number, number][] = []
  for (let i = 0; i < V; i++) IN.push([pts[2 * i], pts[2 * i + 1]])
  const inDeg = new Array(V).fill(0)
  const inSet = new Map<string, number>()
  let inDash = 0
  for (const e of edges) {
    if (e[0] === e[1]) continue
    inDeg[e[0]]++; inDeg[e[1]]++
    inSet.set(ekey(e[0], e[1]), e[2] ? 1 : 0)
    if (e[2]) inDash++
  }
  const inKey = inDeg.slice().sort((a, b) => a - b).join(',')
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
  for (const [x, y] of IN) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  const diag = Math.max(1e-6, Math.hypot(x1 - x0, y1 - y0))
  const A = norm(IN)
  const aAng = pcaAngle(A.pts)
  let best: FigMatchResult | null = null
  for (const c of candidates()) {
    if (c.pts.length !== V || c.edges.length !== edges.length) continue
    if (c.edges.reduce((s, e) => s + e[2], 0) !== inDash) continue
    if (c.deg.slice().sort((a, b) => a - b).join(',') !== inKey) continue
    const B = norm(c.pts)
    const bAng = pcaAngle(B.pts)
    for (const flip of [0, 1]) {
      const Bp = flip ? B.pts.map(([x, y]) => [x, -y] as [number, number]) : B.pts
      for (const extra of [0, Math.PI]) {
        const d = aAng - (flip ? -bAng : bAng) + extra
        const mapped: [number, number][] = Bp.map((p) => { const q = rot(p, d); return [A.cx + q[0] * A.rms, A.cy + q[1] * A.rms] })
        const pairs: { i: number; j: number; d: number }[] = []
        for (let i = 0; i < V; i++) for (let j = 0; j < V; j++) {
          pairs.push({ i, j, d: Math.hypot(IN[i][0] - mapped[j][0], IN[i][1] - mapped[j][1]) })
        }
        pairs.sort((p, q) => p.d - q.d)
        const ui = new Set<number>(), uj = new Set<number>(), t2i = new Array(V).fill(-1)
        for (const q of pairs) {
          if (ui.has(q.i) || uj.has(q.j)) continue
          ui.add(q.i); uj.add(q.j); t2i[q.j] = q.i
        }
        if (ui.size !== V) continue
        const seen = new Set<string>()
        let ok = true
        for (const e of c.edges) {
          const a = t2i[e[0]], b = t2i[e[1]]
          if (a < 0 || b < 0) { ok = false; break }
          const d2 = inSet.get(ekey(a, b))
          if (d2 === undefined || d2 !== e[2]) { ok = false; break }
          seen.add(ekey(a, b))
        }
        if (!ok || seen.size !== inSet.size) continue
        let s = 0
        for (let j = 0; j < V; j++) {
          const i = t2i[j]
          s += (IN[i][0] - mapped[j][0]) ** 2 + (IN[i][1] - mapped[j][1]) ** 2
        }
        const rms = Math.sqrt(s / V) / diag
        if (rms > tol) continue
        if (!best || rms < best.rms) {
          const out = new Array(V * 2).fill(0)
          // ⚠ 不能 toFixed(2) ✗：归一化坐标下 0.005 的量化误差在短边上就是 1~3.4° 的角度误差 ✓（单测量出来的 ✓）
          for (let j = 0; j < V; j++) { out[2 * t2i[j]] = mapped[j][0]; out[2 * t2i[j] + 1] = mapped[j][1] }
          best = { id: c.id, name: c.name, rms, points: out, map: t2i.slice() }
        }
      }
    }
  }
  return best
}
