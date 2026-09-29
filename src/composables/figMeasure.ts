/**
 * 【v1738】测量工序（Math2GGB 的第一条硬规矩：**量原图，绝不目测** ✓）
 *
 * 我们在 v1737 只抄了它的一半：把实测尺寸**报给模型** ✓ 但没有"**量出来再换算成可直接用的坐标**"这一步 ✗
 * 本模块补上完整工序（纯函数 ✓ 探针盯着）：
 *   ① 选**基准**（题给里最长的那个已知长度 ✓ 精度最好）
 *   ② 定**原点**（基准那条边的"左下那个角" ✓）
 *   ③ 定**比例**（让基准长度正好等于题给的值 ✓ → 关键长度自然落在整齐的数上 ✓）
 *   ④ 换算所有顶点（**y 翻过来** ✓ 图像坐标是 y 向下的 ✗）
 *   ⑤ 报**残差**：其它题给长度换算后对不对得上 ✓（对不上 = 识别或题干有一处错 ✓）
 *   ⑥ `verifyBuilt`：**建完图再量一遍**，跟计划坐标比 ✓（前后都验 ✓）
 */

import { statedLengths, type ScanFig } from './figScan'

export interface RulerPick { a: string; b: string; stated: number; measured: number }

/** 归一化坐标下两点距离 ✓ */
function dist(f: ScanFig, a: string, b: string): number {
  const P = (f && f.points) || []
  const i = P.findIndex((p) => p.name === a)
  const j = P.findIndex((p) => p.name === b)
  if (i < 0 || j < 0) return NaN
  return Math.sqrt((P[i].x - P[j].x) * (P[i].x - P[j].x) + (P[i].y - P[j].y) * (P[i].y - P[j].y))
}

/**
 * 【v1738】选基准：题给长度里**最长的那条**，且它在识别结果里确实是一条边 ✓
 * 都没有 → 退回"最长的识别边"，题给值按 1 算 ✓（只给形状不给数也能换算 ✓）
 */
export function pickRuler(f: ScanFig, briefText?: string): RulerPick | null {
  const stated = statedLengths(briefText)
  const edges = (f && f.edges) || []
  const P = (f && f.points) || []
  const nameOf = (i: number) => (P[i] ? P[i].name : '')
  let best: RulerPick | null = null
  for (const st of stated) {
    const hit = edges.find((e) => (nameOf(e.a) === st.a && nameOf(e.b) === st.b) || (nameOf(e.a) === st.b && nameOf(e.b) === st.a))
    if (!hit) continue
    const m = dist(f, st.a, st.b)
    if (!Number.isFinite(m) || m <= 0.001) continue
    if (!best || st.v > best.stated) best = { a: st.a, b: st.b, stated: st.v, measured: m }
  }
  if (best) return best
  let longest = 0
  for (const e of edges) {
    const m = dist(f, nameOf(e.a), nameOf(e.b))
    if (Number.isFinite(m) && m > longest) {
      longest = m
      best = { a: nameOf(e.a), b: nameOf(e.b), stated: 1, measured: m }
    }
  }
  return best
}

/** 【v1738】原点取基准边的"左下那个角"（图像里 y 大、再 x 小 ✓）—— 换算后它正好在原点 ✓ */
export function anchorOf(f: ScanFig, r: RulerPick): string {
  const P = (f && f.points) || []
  const pa = P.find((p) => p.name === r.a)
  const pb = P.find((p) => p.name === r.b)
  if (!pa) return r.b
  if (!pb) return r.a
  if (Math.abs(pa.y - pb.y) > 1e-9) return pa.y > pb.y ? pa.name : pb.name
  return pa.x <= pb.x ? pa.name : pb.name
}

export interface MeasurePlan {
  ok: boolean
  ruler: RulerPick | null
  anchor: string
  /** 1 归一化长度 = 多少题目单位 ✓ */
  unit: number
  /** 换算后的顶点坐标（**数学方向**：y 已翻转 ✓ 单位是题目单位 ✓） */
  points: { name: string; x: number; y: number }[]
  /** 其它题给长度的残差 ✓ */
  residuals: { seg: string; want: number; got: number; errPct: number; ok: boolean }[]
  lines: string[]
  why?: string
}

/** 【v1738】完整测量计划（纯函数 ✓ 探针盯着） */
export function cleanPlan(f: ScanFig, briefText?: string, opt: { tolPct?: number; dp?: number } = {}): MeasurePlan {
  const tolPct = opt.tolPct == null ? 6 : opt.tolPct
  const dp = opt.dp == null ? 2 : opt.dp
  const P = (f && f.points) || []
  const empty: MeasurePlan = { ok: false, ruler: null, anchor: '', unit: 1, points: [], residuals: [], lines: [], why: '' }
  if (P.length < 2) return { ...empty, why: '顶点太少（先识别出图形 ✓）' }
  const ruler = pickRuler(f, briefText)
  if (!ruler) return { ...empty, why: '没找到可用作基准的边（识别结果里没有边 ✓）' }
  const anchor = anchorOf(f, ruler)
  const A = P.find((p) => p.name === anchor)
  if (!A) return { ...empty, ruler, anchor, why: '原点那个点不在识别结果里' }
  const unit = ruler.stated / ruler.measured
  const round = (v: number) => Math.round(v * Math.pow(10, dp)) / Math.pow(10, dp)
  const points = P.map((p) => ({ name: p.name, x: round((p.x - A.x) * unit), y: round((A.y - p.y) * unit) }))
  const residuals: MeasurePlan['residuals'] = []
  for (const st of statedLengths(briefText)) {
    const m = dist(f, st.a, st.b)
    if (!Number.isFinite(m) || m <= 0.001) continue
    const got = m * unit
    const errPct = Math.abs(got / st.v - 1) * 100
    residuals.push({ seg: st.a + st.b, want: st.v, got: Math.round(got * 1000) / 1000, errPct: Math.round(errPct * 10) / 10, ok: errPct <= tolPct })
  }
  const lines: string[] = []
  lines.push('【测量换算】（基准 = 题给的 ' + ruler.a + ruler.b + ' = ' + ruler.stated + ' ✓ 换算成可直接用的坐标 ✓）')
  lines.push('- 基准：' + ruler.a + ruler.b + ' 题给 ' + ruler.stated + '，实测（归一化）' + ruler.measured.toFixed(3) +
    ' → 1 归一化长度 = ' + unit.toFixed(3) + ' 题目单位 ✓')
  lines.push('- 原点取在 ' + anchor + '（基准边的左下那个角 ✓），y 已按数学方向翻转 ✓')
  lines.push('- 换算后顶点坐标（可直接拿来作图 ✓）：' + points.map((p) => p.name + '(' + p.x + ', ' + p.y + ')').join('、'))
  if (residuals.length) {
    const bad = residuals.filter((r) => !r.ok)
    lines.push('- 其它题给长度核对：' + residuals.map((r) => r.seg + ' 题给 ' + r.want + ' / 换算 ' + r.got + (r.ok ? ' ✓' : ' ✗')).join('；'))
    if (bad.length) lines.push('- ⚠ 有 ' + bad.length + ' 条对不上（超过 ' + tolPct + '%）：识别或题干必有一处错 ✓ 请核对后再作图 ✓')
  }
  return { ok: true, ruler, anchor, unit, points, residuals, lines }
}

/** 【v1738】建完图再量一遍：板上实际坐标 vs 计划坐标（前后都验 ✓ 纯函数 ✓） */
export function verifyBuilt(
  plan: MeasurePlan,
  actual: { name: string; x: number; y: number }[],
  tolPct = 2,
): { ok: boolean; bad: string[]; lines: string[] } {
  const bad: string[] = []
  const lines: string[] = []
  if (!plan || !plan.ok) return { ok: false, bad, lines: ['没有测量计划可比（先识别并换算 ✓）'] }
  const xs = plan.points.map((p) => p.x)
  const ys = plan.points.map((p) => p.y)
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 0.001)
  const tol = (tolPct / 100) * size
  const byName: Record<string, { x: number; y: number }> = {}
  for (const a of actual || []) byName[a.name] = { x: a.x, y: a.y }
  for (const p of plan.points) {
    const g = byName[p.name]
    if (!g) { bad.push(p.name + ' 板上没有'); continue }
    const d = Math.sqrt((g.x - p.x) * (g.x - p.x) + (g.y - p.y) * (g.y - p.y))
    if (!Number.isFinite(d) || d > tol) {
      bad.push(p.name + ' 计划(' + p.x + ', ' + p.y + ') 实际(' + round3(g.x) + ', ' + round3(g.y) + ') 差了 ' + round3(d))
    }
  }
  const extra = (actual || []).filter((a) => !plan.points.some((p) => p.name === a.name)).map((a) => a.name)
  for (const l of plan.lines) lines.push(l)
  lines.push(bad.length
    ? '复刻核对：' + bad.length + ' 个点对不上（容差 ' + tolPct + '% = ' + round3(tol) + '）✗ ' + bad.join('；')
    : '复刻核对：' + plan.points.length + ' 个点全部落在计划位置上 ✓（' + (extra.length ? '多出 ' + extra.join('、') + ' ✓' : '不多不少 ✓') + '）')
  return { ok: bad.length === 0, bad, lines }
}

function round3(v: number): number { return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : NaN }
