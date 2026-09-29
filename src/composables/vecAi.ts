/**
 * 【v1741】「自图片重建」的 **AI 读图**：让视觉模型把线稿读成**几何描述** ✓
 *
 * 为什么要它：现在的重建走**纯算法**（阈值 / 轮廓 / 拟合 ✓），试卷里的图（有标注、有辅助线、
 * 线粗细不均、还有印刷噪点）它常常认不全 ✗ —— 而"这是哪类图、哪条是棱、哪个字母配哪个点"
 * 正是**视觉模型擅长、算法不擅长**的部分 ✓（我们自己定的分工：AI 管看不懂的，算法管算得准的 ✓）
 *
 * 与 3D 那边同一条纪律：**模型只回 JSON 数据** ✓（不比代码 ✗）+ **白名单过滤 + 夹取** ✓ +
 *   **归一化坐标**（0~1，原点左上、y 向下 —— 与编辑器内部**同一套** ✓ 免得到处换坐标 ✗）
 * 纯函数 ✓（探针盯着 ✓）；拿回来的草稿**先留快照**再替换 → 老师一键 Ctrl+Z 能撤回 ✓
 */

import { extractJsonObject } from './geom3dCheck'

/** 给视觉模型的系统提示：**只输出 JSON**，坐标是归一化 0~1（左上为原点、y 向下 ✓） */
export const VEC_AI_SYSTEM = [
  '你是高中数学几何图形的**读图器**。只输出一个 JSON 对象：不要解释、不要 markdown 代码块、不要注释。',
  'JSON 结构：{"points":[{"name":"A","x":0.12,"y":0.34}],"lines":[["A","B",0]],"circles":[{"x":0.5,"y":0.5,"r":0.2}],"note":"一句话"}',
  '硬性要求：',
  '1. 坐标一律**归一化**：图片左上角 = (0,0)，右下角 = (1,1)；y 轴**向下**（和图片一致）✓；',
  '2. points：只读**图里真实存在**的顶点/标注点（带字母的优先 ✓ 名字照抄原图字母，如 A、B、C、A1、O）；没有字母的点 name 留空字符串；',
  '3. lines：`["A","B",0]` 两点连一条线；第三个数字 1 = **虚线**（被遮挡的棱 / 辅助虚线 ✓），0 = 实线；两端必须是 points 里的 name ✓；',
  '4. circles：圆心 (x,y) + 半径 r（都按归一化 ✓）；椭圆用 rx/ry 代替 r（可省 ✓）；',
  '5. **看不见的不许编** ✗（认不出的线宁可不写 ✓）；线条数量控制在 60 条以内；',
  '6. note：一句话说明你认出来这是什么图（如「正方体 ABCD-A₁B₁C₁D₁ 与体对角线 AC₁」）；',
  '别的字段一律不要；坐标写数字，不要写百分比字符串。',
].join(String.fromCharCode(10))

export interface VecAiDraft {
  /** 归一化顶点（扁平 x,y ✓ 与编辑器一致 ✓） */
  pts: number[]
  /** [a, b, dash] ✓ dash: 0 实线 / 1 虚线 ✓ */
  edges: [number, number, number][]
  /** 与 pts 一一对应的字母（没有就空串 ✓） */
  labels: string[]
  /** 与 pts 一一对应的标注偏移（AI 不给就 0,0 ✓ 老师随后自己拖 ✓） */
  offs: { dx: number; dy: number }[]
  /** 圆 / 弧（归一化 ✓） */
  arcs: { cx: number; cy: number; rx: number; ry: number }[]
  note: string
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(String(v).replace('%', '')) : NaN
  if (!Number.isFinite(n)) return null
  // 允许模型给百分比（12 表示 12% ✓）—— 大于 1 就按 0~100 折算 ✓ 再夹到 0~1 ✓
  const x = Math.abs(n) > 1.5 ? n / 100 : n
  return Math.min(1, Math.max(0, x))
}

/**
 * 【v1741】模型文本 → 草稿（纯函数 ✓ 探针盯着）
 *  · 抠 JSON（剥围栏 / 前后废话 ✓）· 坐标夹到 0~1 ✓ · 顶点上限 120 ✓
 *  · 线：按名字找点 ✓ 找不到的**丢掉** ✓（宁缺勿错 ✗）· 去重 ✓
 *  · 圆：半径非正的丢掉 ✓ · note 截断 200 ✓
 */
export function parseVecAi(text: unknown): { draft?: VecAiDraft; lines: string[]; error?: string } {
  const json = extractJsonObject(String(text == null ? '' : text))
  if (!json) return { lines: [], error: '模型没回 JSON（原文开头：' + String(text || '').trim().slice(0, 80) + '）' }
  let obj: Record<string, unknown>
  try {
    const p = JSON.parse(json)
    if (!p || typeof p !== 'object' || Array.isArray(p)) return { lines: [], error: '回来的不是 JSON 对象' }
    obj = p as Record<string, unknown>
  } catch (e) {
    return { lines: [], error: 'JSON 解析失败：' + String((e as Error)?.message || e).slice(0, 80) }
  }
  const rawPts = Array.isArray(obj.points) ? obj.points : []
  const pts: number[] = []
  const labels: string[] = []
  const offs: { dx: number; dy: number }[] = []
  const byName: Record<string, number> = {}
  for (const raw of rawPts.slice(0, 120)) {
    const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const x = num(o.x)
    const y = num(o.y)
    if (x === null || y === null) continue
    const name = String(o.name == null ? '' : o.name).trim().slice(0, 6)
    pts.push(x, y)
    labels.push(name)
    offs.push({ dx: 0, dy: 0 })
    if (name && byName[name] === undefined) byName[name] = pts.length / 2 - 1
  }
  const idx = (v: unknown): number => {
    if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v) >= 0 && Math.round(v) < pts.length / 2 ? Math.round(v) : -1
    const n = String(v == null ? '' : v).trim()
    return byName[n] === undefined ? -1 : byName[n]
  }
  const edges: [number, number, number][] = []
  const seen = new Set<string>()
  for (const raw of (Array.isArray(obj.lines) ? obj.lines : []).slice(0, 200)) {
    const arr = Array.isArray(raw) ? raw : ((raw && typeof raw === 'object' ? [(raw as Record<string, unknown>).a, (raw as Record<string, unknown>).b, (raw as Record<string, unknown>).dash] : []) as unknown[])
    const a = idx(arr[0])
    const b = idx(arr[1])
    if (a < 0 || b < 0 || a === b) continue
    const dash = String(arr[2] == null ? '0' : arr[2]) === '1' || String(arr[2]).toLowerCase() === 'true' ? 1 : 0
    const key = (a < b ? a + '_' + b : b + '_' + a) + '_' + dash
    if (seen.has(key)) continue
    seen.add(key)
    edges.push([a, b, dash])
  }
  const arcs: VecAiDraft['arcs'] = []
  for (const raw of (Array.isArray(obj.circles) ? obj.circles : []).slice(0, 40)) {
    const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const cx = num(o.x ?? o.cx)
    const cy = num(o.y ?? o.cy)
    const r = num(o.r)
    const rx = num(o.rx ?? o.r)
    const ry = num(o.ry ?? o.r)
    if (cx === null || cy === null) continue
    const a = rx === null ? null : rx
    const b2 = ry === null ? null : ry
    if ((a === null || a <= 0) && (b2 === null || b2 <= 0)) continue
    if (r !== null && r <= 0) continue
    arcs.push({ cx, cy, rx: (a || b2 || 0.2) as number, ry: (b2 || a || 0.2) as number })
  }
  const note = String(obj.note == null ? '' : obj.note).trim().slice(0, 200)
  if (!pts.length) return { lines: [], error: 'JSON 里没有可用顶点（points 空或坐标不是数字 ✗）' }
  const droppedPts = Math.max(0, Math.min(rawPts.length, 120) - pts.length)
  const droppedLines = Math.max(0, (Array.isArray(obj.lines) ? obj.lines.length : 0) - edges.length)
  const lines: string[] = []
  lines.push('AI 读图结果：顶点 ' + pts.length + ' 个（带字母 ' + labels.filter((x) => x).length + ' 个）、线 ' + edges.length + ' 条、圆 ' + arcs.length + ' 个 ✓')
  if (droppedPts) lines.push('· 丢掉 ' + droppedPts + ' 个坐标不合法/超上限的顶点 ✗')
  if (droppedLines) lines.push('· 丢掉 ' + droppedLines + ' 条指向不存在顶点的线 ✗')
  if (labels.filter((x) => x).length) lines.push('· 字母：' + labels.filter((x) => x).slice(0, 16).join('、') + (labels.filter((x) => x).length > 16 ? ' …' : ''))
  if (note) lines.push('· 它认出来这是：' + note)
  return { draft: { pts, edges, labels, offs, arcs, note }, lines }
}

/** 一句话摘要（给提示条用 ✓） */
export function vecAiSummary(d: VecAiDraft): string {
  return d.pts.length / 2 + ' 个点 · ' + d.edges.length + ' 条线' + (d.arcs.length ? ' · ' + d.arcs.length + ' 个圆' : '')
}
