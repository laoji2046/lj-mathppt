/**
 * 【v1736】拖动测试（drag test）：**把驱动点挪开，看约束还成不成立** ✓
 *
 * 为什么值得做：Math2GGB 把"**拖一下**"当作构造正确性的**判据** ✓
 *   —— 看起来在圆上的点，可能是**手打坐标凑出来的** ✗（拖动前残差 0 ✓ 拖动后立刻露馅 ✗）
 *   我们已有的两样东西正好凑齐：③ CanvasTracker 的**依赖图** + ① 的**读数**（临时对象量完就删 ✓）
 *
 * 判据（**残差**，不是"值本身"）：
 *   · `D=描点(c)`（点在圆上）  → |Distance(Center(c), D) − Radius(c)| ≈ 0 ✓
 *   · `M=中点(A, B)`           → |Distance(A, M) − Distance(M, B)| ≈ 0 ✓
 *   · `X=交点(c, l, 1)`        → X 得还在 c 上 / l 上 ✓
 *   · `R=旋转(A, 60°, O)`      → |Distance(O, R) − Distance(O, A)| ≈ 0 ✓
 *   · `R=轴对称(A, l)`         → A 与 R 到 l 的距离相等 ✓
 *   认不出的定义（轨迹 / 自定义 / 位似…）**不查** ✓ 宁缺勿错 ✗
 *
 * 本文件只做纯函数 ✓（探针能盯 ✓）：数驱动点、推残差表达式、判定"真约束 / 假约束 / 本来就坏"
 */
import { ggbCmdArgs, ggbCmdName, ggbFreePointXY } from './ggbNorm'
import type { TrackItem } from './canvasTrack'

export interface DragDriver { name: string; x: number; y: number }

/** 自由点（driver ✓）：定义就是一对坐标 ✓ */
export function freeDrivers(track: TrackItem[]): DragDriver[] {
  const out: DragDriver[] = []
  for (const it of track || []) {
    const xy = ggbFreePointXY(it.def)
    if (xy) out.push({ name: it.name, x: xy.x, y: xy.y })
  }
  return out
}

/** 拖动一个点的指令（GeoGebra 的 SetCoords ✓；⚠ 真引擎实测它**返回 false 但真的拖动成功** ✗ 所以要看结果 ✓） */
export function dragMoveCmd(name: string, x: number, y: number): string {
  const n = (v: number) => String(Math.round(v * 1e6) / 1e6)
  return 'SetCoords(' + String(name || '').trim() + ', ' + n(x) + ', ' + n(y) + ')'
}

export interface DragCheck {
  /** 受检的派生对象 ✓ */
  name: string
  /** 它的定义（原样，给老师看 ✓） */
  def: string
  /** 残差表达式（**约等于 0 = 关系成立** ✓ 只读 ✓） */
  exprs: string[]
  /** 一句话说明这条在查什么 ✓ */
  label: string
}

/** 一个对象在别人眼里是什么（用来决定"点在圆上"还是"点在线段上" ✓） */
function kindOf(track: TrackItem[], name: string): 'circle' | 'line' | 'other' {
  const n = String(name || '').trim()
  for (const it of track || []) {
    if (it.name !== n) continue
    const k = ggbCmdName(it.def)
    if (k === 'Circle' || k === 'Arc' || k === 'Semicircle') return 'circle'
    if (k === 'Line' || k === 'Segment' || k === 'Ray' || k === 'Vector' || k === 'Polyline') return 'line'
    return 'other'
  }
  return 'other'
}

/**
 * 从**板上真实定义**推出残差检查（纯函数 ✓ 探针盯着）
 *  —— 只对**认得准**的几种定义出手 ✓（描点/中点/交点/旋转/反射 ✓）
 */
export function residualChecks(track: TrackItem[]): DragCheck[] {
  const out: DragCheck[] = []
  for (const it of track || []) {
    const name = it.name
    const kind = ggbCmdName(it.def)
    if (!kind) continue                      // 自由点 / 认不出的：不查 ✓
    const args = ggbCmdArgs(it.def)
    if (kind === 'Point' && args.length >= 1) {
      const host = args[0]
      const hk = kindOf(track, host)
      if (hk === 'circle') out.push({ name, def: it.def, exprs: ['abs(Distance(Center(' + host + '), ' + name + ') - Radius(' + host + '))'], label: name + ' 还在 ' + host + ' 上（点在圆上 ✓）' })
      else if (hk === 'line') out.push({ name, def: it.def, exprs: ['abs(Distance(' + name + ', ' + host + '))'], label: name + ' 还在 ' + host + ' 上（点在线上 ✓）' })
      continue
    }
    if (kind === 'Midpoint' && args.length >= 2) {
      out.push({ name, def: it.def, exprs: ['abs(Distance(' + args[0] + ', ' + name + ') - Distance(' + name + ', ' + args[1] + '))'], label: name + ' 还是 ' + args[0] + args[1] + ' 的中点 ✓' })
      continue
    }
    if (kind === 'Intersect' && args.length >= 2) {
      const exprs: string[] = []
      const labels: string[] = []
      for (const host of [args[0], args[1]]) {
        const hk = kindOf(track, host)
        if (hk === 'circle') { exprs.push('abs(Distance(Center(' + host + '), ' + name + ') - Radius(' + host + '))'); labels.push(host + ' 上') }
        else if (hk === 'line') { exprs.push('abs(Distance(' + name + ', ' + host + '))'); labels.push(host + ' 上') }
      }
      if (exprs.length) out.push({ name, def: it.def, exprs, label: name + ' 还是交点（还在 ' + labels.join('、') + ' ✓）' })
      continue
    }
    if (kind === 'Rotate' && args.length >= 3) {
      const O = args[args.length - 1]
      out.push({ name, def: it.def, exprs: ['abs(Distance(' + O + ', ' + name + ') - Distance(' + O + ', ' + args[0] + '))'], label: name + ' 绕 ' + O + ' 旋转 → 到 ' + O + ' 的距离不变 ✓' })
      continue
    }
    if (kind === 'Reflect' && args.length >= 2) {
      out.push({ name, def: it.def, exprs: ['abs(Distance(' + args[0] + ', ' + args[1] + ') - Distance(' + name + ', ' + args[1] + '))'], label: name + ' 是 ' + args[0] + ' 关于 ' + args[1] + ' 的对称点（到对称轴距离相等 ✓）' })
      continue
    }
  }
  return out
}

export interface DragOutcome { driver: string; moved: boolean; checkIndexes: number[] }

/** 一次拖动测试的结果（给老师看的一段话 ✓） */
export interface DragVerdict {
  /** 被拖坏的（拖动前成立、拖动后不成立）—— 这就是**假约束** ✗ 最该报的 ✓ */
  broken: string[]
  /** 本来就不成立的（拖动前就已经对不上 ✗ 说明图本来就是错的 ✓） */
  alreadyBad: string[]
  /** 认不出、没查的派生对象 ✓（如实说明"没查"✗ 别假装全查了 ✗） */
  unchecked: string[]
  lines: string[]
}

/**
 * 判定（纯函数 ✓）：`before/after` 是每条检查表达式在**拖动前 / 拖动后**的读数（应≈0 ✓）
 *  · 拖动前就 > tol → 本来就坏 ✓
 *  · 拖动前 ≈0、拖动后 > tol → **被拖坏 = 假约束** ✓
 */
export function judgeDrag(checks: DragCheck[], before: number[], after: number[], tol = 0.02, unchecked: string[] = []): DragVerdict {
  const broken: string[] = []
  const alreadyBad: string[] = []
  const lines: string[] = []
  checks.forEach((c, i) => {
    c.exprs.forEach((e, k) => {
      const idx = exprIndexOf(checks, i, k)
      const b = before[idx]
      const a = after[idx]
      const bad = (v: number) => !Number.isFinite(v) || v > tol
      if (bad(b)) { if (alreadyBad.indexOf(c.label) < 0) alreadyBad.push(c.label); return }
      if (bad(a)) {
        if (broken.indexOf(c.label) < 0) broken.push(c.label)
        lines.push('✗ 拖坏了：' + c.label + '（' + e + '：' + fmt(b) + ' → ' + fmt(a) + '）')
      }
    })
  })
  const okCount = checks.length - broken.length - alreadyBad.length
  lines.unshift('拖动测试：查了 ' + checks.length + ' 条关系 ✓ 真成立 ' + Math.max(0, okCount) + ' 条'
    + (broken.length ? ' · 拖坏了 ' + broken.length + ' 条' : '')
    + (alreadyBad.length ? ' · 本来就不成立 ' + alreadyBad.length + ' 条' : '')
    + (unchecked.length ? ' · 没查 ' + unchecked.length + ' 个（定义认不出 ✓）' : ''))
  if (alreadyBad.length) lines.push('· 本来就不成立（不是拖动造成的）：' + alreadyBad.join('；'))
  if (unchecked.length) lines.push('· 没查的：' + unchecked.slice(0, 8).join('、') + (unchecked.length > 8 ? ' …' : ''))
  return { broken, alreadyBad, unchecked, lines }
}

/** 表达式在"扁平列表"里的下标（before/after 是扁平数组 ✓） */
export function exprIndexOf(checks: DragCheck[], i: number, k: number): number {
  let n = 0
  for (let x = 0; x < i; x++) n += checks[x].exprs.length
  return n + k
}

/** 把检查摊平成表达式清单（读数按这个顺序来 ✓） */
export function checkExprs(checks: DragCheck[]): string[] {
  const out: string[] = []
  for (const c of checks || []) for (const e of c.exprs) out.push(e)
  return out
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return '取不到'
  return String(Math.round(v * 1e6) / 1e6)
}
