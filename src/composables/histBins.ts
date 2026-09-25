/**
 * 【v1631】频率分布直方图的**自动分箱**（用户要求：粘数据后自动算最大值/最小值/极差，
 *   并按数据个数给出左边界与组距，让图看着舒服）。
 *
 * 为什么单独成模块：这套规则（组数怎么定、组距怎么取整、左边界怎么对齐）是**纯计算**，
 *   放在组件里既难测也容易和渲染参数漂移 —— 这里定死，面板只管把结果写进 params ✓
 *
 * 规则（教材口径 + 好看优先）：
 *   ① 组数 k：k = ceil(√n)，夹在 5~10 之间（10 是这张图的格子数上限 ✓）；
 *   ② 组距 d：取 ≥ 极差/k 的**最小「整」数**（1/2/2.5/5 ×10^m —— 0.5、1、2、5、10…）✓；
 *   ③ 左边界：向下对齐到 d 的整数倍（刻度就落在整齐的数上 ✓）；
 *      若这样超过 10 组，就把 d 提到下一个「整」数重算（**自动解决**，不再报「需要 N 组」✗）✓；
 *   ④ 分箱左闭右开，最后一组右闭（教材写法）✓
 */
export interface HistPlan {
  ok: boolean
  count: number
  min: number
  max: number
  range: number
  bins: number
  width: number
  start: number
  counts: number[]
  msg: string
  error?: string
}

/** 比 x 大的最小「整」步长（1 / 2 / 2.5 / 5 × 10^m）✓ */
function niceCeil(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 1
  const m = Math.pow(10, Math.floor(Math.log10(x)))
  const r = x / m
  const mult = r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10
  return Number((mult * m).toPrecision(12))
}
/** 下一个更粗的「整」步长 ✓ */
function niceNext(x: number): number {
  const m = Math.pow(10, Math.floor(Math.log10(x)))
  const r = x / m
  const mult = r < 2 ? 2 : r < 2.5 ? 2.5 : r < 5 ? 5 : 10
  return Number((mult * m).toPrecision(12))
}
const MAX_BINS = 10
function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v)
  const r = Number(v.toPrecision(10))
  return String(r)
}

/**
 * 【v1631】按**指定的**组距与左边界重算频数（用户手改组距 / 起始边界时用）✓
 *   返回 null = 参数不可用（组距非正、左边界比最小值还大）—— 调用方据此给提示，别硬算 ✓
 *   组数上限仍是 10（图只有 10 个格子）；超出就把组数截到 10 并如实返回，让调用方提示 ✓
 */
export function binFixed(xs: number[], start: number, width: number): { bins: number; width: number; start: number; counts: number[]; clipped: boolean } | null {
  const data = (xs || []).filter((x) => Number.isFinite(x))
  if (data.length < 2 || !Number.isFinite(start) || !Number.isFinite(width) || width <= 0) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  if (start > min) return null
  const need = Math.ceil(Number(((max - start) / width).toPrecision(12)))
  const clipped = need > MAX_BINS
  const bins = Math.max(1, Math.min(MAX_BINS, need))
  const counts = new Array(bins).fill(0)
  for (const v of data) {
    let i = Math.floor(Number(((v - start) / width).toPrecision(12)))
    if (i < 0) i = 0
    if (i > bins - 1) i = bins - 1
    counts[i]++
  }
  return { bins, width, start, counts, clipped }
}

export function planHistogram(xs: number[]): HistPlan {
  const data = (xs || []).filter((x) => Number.isFinite(x))
  const empty: HistPlan = { ok: false, count: data.length, min: 0, max: 0, range: 0, bins: 0, width: 0, start: 0, counts: [], msg: "", error: "没解析出数据（粘贴一列数就行）" }
  if (data.length < 2) return empty
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min
  // 全等数据：给一个 1 宽的区间把它框住（否则极差 0 会让组距算不出来）
  if (range === 0) {
    const width = niceCeil(Math.max(Math.abs(min) * 0.2, 1))
    const start = Number((min - width / 2).toPrecision(12))
    return { ok: true, count: data.length, min, max, range: 0, bins: 1, width, start, counts: [data.length], msg: data.length + " 个数据全是 " + fmt(min) + "（极差 0）→ 1 组，组距 " + fmt(width) + "，左边界 " + fmt(start) }
  }
  const k = Math.min(MAX_BINS, Math.max(5, Math.ceil(Math.sqrt(data.length))))
  let width = niceCeil(range / k)
  let start = Number((Math.floor(min / width) * width).toPrecision(12))
  for (let guard = 0; guard < 30 && (max - start) / width > MAX_BINS; guard++) {
    width = niceNext(width)
    start = Number((Math.floor(min / width) * width).toPrecision(12))
  }
  const bins = Math.max(1, Math.min(MAX_BINS, Math.ceil(Number(((max - start) / width).toPrecision(12)))))
  const counts = new Array(bins).fill(0)
  for (const v of data) {
    let i = Math.floor(Number(((v - start) / width).toPrecision(12)))
    if (i < 0) i = 0
    if (i > bins - 1) i = bins - 1
    counts[i]++
  }
  return {
    ok: true, count: data.length, min, max, range, bins, width, start, counts,
    msg: data.length + " 个数据 · 最小 " + fmt(min) + " · 最大 " + fmt(max) + " · 极差 " + fmt(range) +
      " → " + bins + " 组（组距 " + fmt(width) + "，左边界 " + fmt(start) + "，" +
      " 区间 [" + fmt(start) + ", " + fmt(start + bins * width) + "]）",
  }
}
