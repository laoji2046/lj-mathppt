/**
 * 【v1735】执行层：把「一串作图步骤 / 读数步骤 / 删除步骤」真的跑进绘图板 ✓
 *
 * 为什么单独成文件：以前这些函数埋在 `GgbSuite.vue` 里 ✗
 *   → **探针根本拿不到它**，只能测纯函数 ✓ 引擎侧一行都没测过 ✗
 * 现在：只要给一个「像 GeoGebra 的对象」（真 applet / 探针里的假 applet ✓），就能跑 ✓
 *   —— 探针既能喂假 applet 做快速回归 ✓，也能把它塞进真 GeoGebra 里断言 ✓
 *
 * 依赖倒置：本文件**不认识 Vue**，也不 import 任何组件 ✓
 *   日志通过 `log(line)` 回调出来 ✓ 等待时长可配（探针传 0 → 秒过 ✓）
 */
import {
  GGB_QUERY_TMP,
  ggbDeleteClosure,
  ggbDeleteTargets,
  ggbPlanGraph,
  ggbQueryCmd,
  ggbReadPlan,
  ggbToolOf,
  type GgbReadout,
  type GgbSolveStep,
} from './ggbSolve'
import { buildTrack, type TrackItem } from './canvasTrack'
import { ggbCmdName } from './ggbNorm'
import { checkExprs, dragMoveCmd, freeDrivers, judgeDrag, residualChecks, type DragVerdict } from './ggbDrag'

/** 我们用到的那部分 GeoGebra Apps API（**可选方法都写成可选** ✓ 拿不到就走兜底 ✓） */
export interface GgbAppletLike {
  evalCommand(cmd: string): unknown
  getValue?(name: string): unknown
  getAllObjectNames?(): string[]
  getDefinitionString?(name: string): string
  /** 【v1735】命令串（如 `线段(A, B)` ✓）—— 依赖关系必须用它抠 ✓ 见 defsOf 注释 */
  getCommandString?(name: string): string
  deleteObject?(name: string): unknown
  getDependentObjects?(name: string): string[]
  setMode?(mode: number): unknown
  getXML?(): string
  setXML?(x: string): unknown
  getColor?(name: string): string
  getLineThickness?(name: string): number
  getVisible?(name: string): boolean
}

export type ExecLog = (line: string) => void
export interface ExecWait { mode?: number; step?: number }

/** 画布现在的对象名 ✓（拿不到就空数组 → 调用方各自兜底 ✓） */
export function liveObjects(a: GgbAppletLike | null | undefined): string[] {
  try { return a && typeof a.getAllObjectNames === 'function' ? (a.getAllObjectNames() as string[]) : [] } catch { return [] }
}

/** 板上的「名字 → 定义字符串」快照 ✓（来源判定 / 依赖图都要用它 ✓） */
export function defsOf(a: GgbAppletLike | null | undefined): Record<string, string> {
  const map: Record<string, string> = {}
  if (!a || typeof a.getAllObjectNames !== 'function') return map
  const names = liveObjects(a)
  for (const n of names) {
    try {
      // 【v1735】真引擎实测：`getDefinitionString` 是**给人看的本地化描述**（线段 AB → "线段AB" ✗
      //   拿它抠依赖会抠出 ["AB"] 这种假名字 ✗）→ **优先 `getCommandString`**（"线段(A, B)" ✓ 抠出 A、B ✓）
      const cmd = a.getCommandString ? String(a.getCommandString(n) ?? '') : ''
      map[n] = cmd || String(a.getDefinitionString ? (a.getDefinitionString(n) ?? '') : '')
    } catch { map[n] = '' }
  }
  return map
}

/** 样式摘要（颜色 / 粗细 / 是否隐藏 ✓ 拿不到就不写 ✗ 绝不因此报错 ✓） */
export function styleOf(a: GgbAppletLike, n: string): string | undefined {
  const bits: string[] = []
  try {
    if (typeof a.getColor === 'function') { const c = a.getColor(n); if (c) bits.push(String(c)) }
    if (typeof a.getLineThickness === 'function') { const w = Number(a.getLineThickness(n)); if (Number.isFinite(w) && w > 0) bits.push(w + 'px') }
    if (typeof a.getVisible === 'function' && a.getVisible(n) === false) bits.push('已隐藏')
  } catch { /* 拿不到就算了 ✓ */ }
  return bits.length ? bits.join(' ') : undefined
}

/** 问绘图板：这些对象各自依赖了谁（拿不到就空 → 调用方用别的兜底 ✓） */
export function depsOfApi(a: GgbAppletLike, names: string[]): string[] {
  const out: string[] = []
  try {
    if (typeof a.getDependentObjects !== 'function') return out
    for (const n of names) {
      const ds = a.getDependentObjects(n) as string[] | undefined
      for (const d of ds || []) if (d && out.indexOf(d) < 0) out.push(d)
    }
  } catch { /* 拿不到就算了 ✓ */ }
  return out
}

/** 建「板上有啥」清单（来源 / 依赖 / 样式 ✓ 纯逻辑在 canvasTrack 里 ✓） */
export function readTrack(a: GgbAppletLike, beforeDefs: Record<string, string> = {}, prevAi: string[] = []): TrackItem[] {
  if (!a || typeof a.getAllObjectNames !== 'function') return []
  try {
    return buildTrack(liveObjects(a), defsOf(a), prevAi, beforeDefs, (n) => styleOf(a, n))
  } catch { return [] }
}

/**
 * 【v1735】量一组只读表达式 → 读数表 ✓
 *  · 临时对象量一下 → 立刻删掉 ✓ 画布不留垃圾 ✓
 *  · 单条失败不影响其它 ✓ 失败也**记进日志**（不静默吞 ✗）
 */
export async function execQueryExprs(
  a: GgbAppletLike,
  exprs: string[],
  say: string,
  log: ExecLog = () => {},
): Promise<GgbReadout[]> {
  const out: GgbReadout[] = []
  for (const raw of exprs) {
    const q = ggbReadPlan(raw, liveObjects(a))
    if (!q.ok) {
      out.push({ expr: String(raw || ''), value: '', ok: false, err: q.why })
      log('读数 ✗ ' + String(raw || '') + '（' + (q.why || '不合法') + '）')
      continue
    }
    try {
      // 【v1735】真引擎实测：失败**不抛异常、只返回 false** ✓ 所以必须看返回值 ✗ 只看 try/catch 会把失败算成功 ✗
      if (a.evalCommand(ggbQueryCmd(q.expr)) === false) throw new Error('GeoGebra 没接受这条读数')
      const v = typeof a.getValue === 'function' ? Number(a.getValue(GGB_QUERY_TMP)) : NaN
      const val = Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : ''
      out.push({ expr: q.expr, value: val, ok: !!val })
      log('读数 ' + q.expr + ' = ' + (val || '（取不到）') + (say ? '　// ' + say : ''))
    } catch (e) {
      const msg = String((e as Error)?.message || e)
      out.push({ expr: q.expr, value: '', ok: false, err: msg })
      log('读数 ✗ ' + q.expr + '：' + msg)
    } finally {
      try { if (typeof a.deleteObject === 'function') a.deleteObject(GGB_QUERY_TMP) } catch { /* 删不掉也无所谓：下次同名覆盖 ✓ */ }
    }
  }
  return out
}

/**
 * 【v1735】跑一串步骤：读数 / 删除 / 作图 分开处理 ✓
 *  · 读数：走临时对象，量完删 ✓
 *  · 删除：先算出「连带会掉哪些依赖」（绘图板 API → 板上真实定义图 → plan 图 ✓ 三档）再执行 ✓
 *  · 作图：切工具 + evalCommand ✓ 失败收进 fails ✓
 * 返回成功条数 ✓（fails / readouts 由调用方传进来收集 ✓ 便于原地保留））
 */
export async function execSolveSteps(
  a: GgbAppletLike,
  steps: GgbSolveStep[],
  fails: { cmd: string; err: string }[],
  readouts: GgbReadout[] | undefined,
  log: ExecLog = () => {},
  wait: ExecWait = {},
): Promise<number> {
  const wMode = wait.mode == null ? 140 : wait.mode
  const wStep = wait.step == null ? 90 : wait.step
  const sleep = (ms: number) => (ms > 0 ? new Promise((res) => window.setTimeout(res, ms)) : Promise.resolve())
  let ok = 0
  for (const s of steps) {
    // 读一步：量一下（临时对象 → 立刻删 ✓ 不留垃圾 ✓ 不切工具 ✓）
    if (s.query) {
      const rs = await execQueryExprs(a, [s.cmd], s.say, log)
      if (readouts) for (const r of rs) readouts.push(r)
      continue
    }
    // 删一步：先算出「连带会掉哪些依赖」→ 执行 → 日志里报出来 ✓
    if (s.tool === 'delete') {
      const tg = ggbDeleteTargets(s.cmd)
      // 依赖来源分三档：绘图板自己的 getDependentObjects（权威 ✓）→ 板上真实定义的依赖图（✓）→ plan 图（兜底 ✓）
      const graph = ggbPlanGraph(steps)
      const planDep: string[] = []
      for (const t of tg) for (const n of ggbDeleteClosure(t, graph)) if (n !== t && planDep.indexOf(n) < 0) planDep.push(n)
      const liveEdges = buildTrack(liveObjects(a), defsOf(a), [], {}).map((it) => ({ name: it.name, refs: it.refs }))
      const liveDep: string[] = []
      for (const t of tg) {
        if (!liveEdges.some((e) => e.name === t)) continue
        for (const n of ggbDeleteClosure(t, liveEdges)) if (n !== t && liveDep.indexOf(n) < 0) liveDep.push(n)
      }
      const apiDep = depsOfApi(a, tg)
      const extra = (apiDep.length ? apiDep : (liveDep.length ? liveDep : planDep)).filter((n) => tg.indexOf(n) < 0)
      try {
        const r = a.evalCommand(s.cmd)
        // 【v1735】真引擎实测：`Delete(A)` **真的删掉了、却返回 false** ✗
        //   → 删除这一步不看返回值，**看结果**：目标真没了就算成功 ✓ 还在才算失败 ✓
        if (r === false) {
          const left = liveObjects(a)
          const still = tg.filter((n) => left.indexOf(n) >= 0)
          if (still.length) throw new Error('GeoGebra 没删掉：' + still.join('、'))
          log('（真引擎对 Delete 返回 false，但对象确实没了 → 按成功算 ✓）')
        }
        ok++
        log('删 ' + (tg.join('、') || s.cmd) + (extra.length ? '（连带依赖 ' + extra.slice(0, 8).join('、') + (extra.length > 8 ? ' …' : '') + '）' : '') + (s.say ? '　// ' + s.say : '') + ' ✓')
      } catch (err) {
        const msg = String((err as Error)?.message || err)
        fails.push({ cmd: s.cmd, err: msg })
        log(s.cmd + ' ✗ ' + msg)
      }
      continue
    }
    if (s.tool) {
      try { if (typeof a.setMode === 'function') a.setMode(s.mode); log('切换工具：' + (ggbToolOf(s.tool)?.label || s.tool)) } catch { /* 切不动就跳过 ✓ */ }
      await sleep(wMode)
    }
    try {
      // 【v1735】真引擎实测：失败不抛异常、只返回 false ✓（非法指令 / 语法错 / 引用不存在都是 ✓）
      if (a.evalCommand(s.cmd) === false) throw new Error('GeoGebra 没接受这条指令（返回 false ✓）')
      ok++
      log(s.cmd + (s.say ? '　// ' + s.say : '') + ' ✓')
    } catch (err) {
      const msg = String((err as Error)?.message || err)
      fails.push({ cmd: s.cmd, err: msg })
      log(s.cmd + ' ✗ ' + msg)
    }
    await sleep(wStep)
  }
  return ok
}

/** 执行后校验：`X=…` 的对象是否真建出来了（拿不到对象表就不下结论 ✓ 免得误报 ✗） */
export function missingObjects(a: GgbAppletLike, steps: GgbSolveStep[]): string[] {
  const names: string[] = []
  for (const s of steps) {
    const m = /^\s*([A-Za-z][A-Za-z0-9_']*)\s*(?:\([^)]*\))?\s*=/.exec(s.cmd)
    if (m) names.push(m[1])
  }
  if (!names.length) return []
  if (typeof a.getAllObjectNames !== 'function') return []
  const list = liveObjects(a)
  if (!list.length) return []
  return names.filter((n) => list.indexOf(n) < 0)
}
/* ---------------- 【v1736】拖动测试：把驱动点挪开，看约束还成不成立 ----------------
 * 判据来自 Math2GGB：**拖一下**才算验证过 ✓ —— 手打坐标凑出来的关系，拖动前残差 0 ✓ 拖动后立刻露馅 ✓
 * 本函数**自己负责还原**（getXML → 拖 → 读数 → setXML ✓）：老师的图一根毛都不动 ✓
 * ⚠ 诚实边界：它只能验**定义里写明的派生关系**（描点/中点/交点/旋转/反射 ✓）
 *    —— "本该在圆上、却被写成自由点"这种**意图错误**它查不出来 ✗（那要靠人核对 ✓ 所以本函数会如实报"没查的" ✓）
 */

/** 读一组只读表达式的数值（静默 ✓ 用临时对象 ✓ 量完就删 ✓ 取不到给 NaN ✓） */
async function readNumbers(a: GgbAppletLike, exprs: string[]): Promise<number[]> {
  const out: number[] = []
  for (const raw of exprs) {
    const q = ggbReadPlan(raw, liveObjects(a))
    if (!q.ok) { out.push(NaN); continue }
    try {
      if (a.evalCommand(ggbQueryCmd(q.expr)) === false) { out.push(NaN); continue }
      const v = typeof a.getValue === 'function' ? Number(a.getValue(GGB_QUERY_TMP)) : NaN
      out.push(Number.isFinite(v) ? v : NaN)
    } catch { out.push(NaN) } finally {
      try { if (typeof a.deleteObject === 'function') a.deleteObject(GGB_QUERY_TMP) } catch { /* 忽略 */ }
    }
  }
  return out
}

/** 读一个点的坐标（"到底拖没拖动"就看它 ✓ —— SetCoords 返回值不可信 ✗） */
async function readPointXY(a: GgbAppletLike, name: string): Promise<[number, number] | null> {
  const v = await readNumbers(a, ['x(' + name + ')', 'y(' + name + ')'])
  return Number.isFinite(v[0]) && Number.isFinite(v[1]) ? [v[0], v[1]] : null
}

export interface DragTestResult extends DragVerdict { drivers: string[]; checks: number; restored: boolean }

/**
 * 【v1736】拖动测试 ✓
 *  · 驱动点 = 板上**自由点**（定义就是一对坐标 ✓）
 *  · 逐个挪开：`SetCoords(点, x, y)` ⚠ 真引擎实测**返回 false 但真的会动** ✗ → **看位置有没有变** ✓
 *  · 每挪一次读一遍残差 ✓ 取**最坏值**当"拖动后" ✓
 *  · 跑完 `setXML` 整块还原 ✓（失败也不报错，只在结果里说清 ✓）
 */
export async function runDragTest(
  a: GgbAppletLike,
  log: ExecLog = () => {},
  wait: ExecWait = {},
  opt: { maxDrivers?: number; dx?: number; dy?: number; tol?: number } = {},
): Promise<DragTestResult> {
  const maxDrivers = opt.maxDrivers == null ? 3 : opt.maxDrivers
  const dx = opt.dx == null ? 0.7 : opt.dx
  const dy = opt.dy == null ? 0.45 : opt.dy
  const tol = opt.tol == null ? 0.02 : opt.tol
  const wStep = wait.step == null ? 90 : wait.step
  const sleep = (ms: number) => (ms > 0 ? new Promise((res) => window.setTimeout(res, ms)) : Promise.resolve())
  const xml = a.getXML ? String(a.getXML() || '') : ''
  const track = readTrack(a, {}, [])
  const drivers = freeDrivers(track).slice(0, maxDrivers)
  const checks = residualChecks(track)
  const unchecked = track.filter((it) => ggbCmdName(it.def) !== '' && !checks.some((c) => c.name === it.name)).map((it) => it.name)
  const exprs = checkExprs(checks)
  const restore = (): boolean => {
    if (!xml || typeof a.setXML !== 'function') return false
    try { a.setXML(xml); return true } catch { return false }
  }
  if (!drivers.length || !checks.length) {
    log('拖动测试：' + (drivers.length ? '没有认得准的关系可查（定义认不出 ✓）' : '板上没有自由点（都用约束定义 ✓）'))
    return { ...judgeDrag(checks, [], [], tol, unchecked), drivers: drivers.map((d) => d.name), checks: checks.length, restored: restore() }
  }
  const before = await readNumbers(a, exprs)
  const perDriver: number[][] = []
  const moved: string[] = []
  for (const d of drivers) {
    const r = a.evalCommand(dragMoveCmd(d.name, d.x + dx, d.y + dy))
    await sleep(wStep)
    const xy = await readPointXY(a, d.name)
    if (!xy) { log('拖动测试：' + d.name + ' 拖不动（可能是固定点 ✓ 跳过）'); continue }
    moved.push(d.name)
    perDriver.push(await readNumbers(a, exprs))
    log('拖动测试：把 ' + d.name + ' 从 (' + d.x + ', ' + d.y + ') 挪到 (' + (d.x + dx) + ', ' + (d.y + dy) + ')'
      + (r === false ? '（引擎返回 false，但位置确实变了 → 按成功算 ✓）' : '') + '，读数第 ' + perDriver.length + ' 组')
  }
  if (!moved.length) log('拖动测试：一个都没拖动（都是固定点？✓）')
  const after = exprs.map((_, i) => {
    let worst = 0
    for (const row of perDriver) {
      const v = row[i]
      if (!Number.isFinite(v)) { worst = Infinity; break }
      if (v > worst) worst = v
    }
    return worst
  })
  const restored = restore()
  const verdict = judgeDrag(checks, before, after, tol, unchecked)
  for (const l of verdict.lines) log('· ' + l)
  if (restored) log('· 画布已还原（拖动只是测试 ✓ 你的图没动 ✓）')
  return { ...verdict, drivers: moved, checks: checks.length, restored }
}
