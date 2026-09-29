/**
 * 【v1737】动画三件套：**配置 / 控制 / 检查** ✓
 *
 * 真引擎实测（v1737，真 GeoGebra 5.2）：
 *   · `Slider(0,10,0.1)` ✓、`StartAnimation(s, true/false)` ✓、`SetValue(s, v)` ✓
 *     —— ⚠ 全都**返回 false 但真的生效** ✗（第三次遇到同一个坑 ✓ 所以一律"看结果"✓）
 *   · **`isAnimationRunning(name)` 存在** ✓ → 这就是「检查」那件 ✓
 *   · `getAnimationSpeed` / `setAnimationType` / `SetAnimationType` **都不存在** ✗
 *     → 「调速」与「振荡（往返）」**没有 API** ✗
 * 所以四种模式只能这么落地（**如实分工，不假装引擎支持** ✓）：
 *   · `once`        引擎原生起播 + 我们定时停 ✓
 *   · `continuous`  引擎原生起播（跑到滑块自己的上界为止 ✓ 跑不出"振荡"✗）
 *   · `loop`        我们自己**按时间驱动**（定时 SetValue 循环 ✓）
 *   · `ping_pong`   我们自己**按时间驱动**（定时 SetValue 往返 ✓）
 *
 * 本文件纯函数 ✓（探针能盯 ✓）：解析用途说明 / 出台词本（指令序列）/ 算下一个值
 */

export const GGB_ANIM_MODES = ['once', 'continuous', 'loop', 'ping_pong'] as const
export type GgbAnimMode = (typeof GGB_ANIM_MODES)[number]

/** 【v1737】教学默认时长（秒 ✓ 参考 GeoChat v0.6.1 的 12–30 秒口径 ✓） */
export const ANIM_DEFAULT_SEC = 12

export interface GgbAnimSpec { target: string; mode: GgbAnimMode; seconds: number; from?: number; to?: number }

/** 模型的动画步：`目标|模式|时长秒|起点|终点`（后三个可省 ✓）—— 纯函数 ✓ */
export function animParseSpec(cmd: unknown): { ok: boolean; spec?: GgbAnimSpec; why?: string } {
  const parts = String(cmd == null ? '' : cmd).split('|').map((x) => x.trim())
  const target = parts[0] || ''
  if (!target) return { ok: false, why: '没写动画对象（格式：目标|模式|时长秒|起点|终点 ✓）' }
  const modeRaw = (parts[1] || 'once').toLowerCase()
  const mode = (GGB_ANIM_MODES as readonly string[]).indexOf(modeRaw) >= 0 ? (modeRaw as GgbAnimMode) : null
  if (!mode) return { ok: false, why: '认不出的模式「' + (parts[1] || '') + '」（只能是 ' + GGB_ANIM_MODES.join(' / ') + ' ✓）' }
  let seconds = parts[2] ? Number(parts[2]) : ANIM_DEFAULT_SEC
  if (!Number.isFinite(seconds) || seconds <= 0) seconds = ANIM_DEFAULT_SEC
  seconds = Math.max(1, Math.min(120, seconds))
  const from = parts[3] === undefined || parts[3] === '' ? undefined : Number(parts[3])
  const to = parts[4] === undefined || parts[4] === '' ? undefined : Number(parts[4])
  const f = Number.isFinite(from as number) ? (from as number) : undefined
  const t2 = Number.isFinite(to as number) ? (to as number) : undefined
  if ((mode === 'loop' || mode === 'ping_pong') && (f === undefined || t2 === undefined)) {
    return { ok: false, why: mode + ' 要写清起点与终点（格式：目标|' + mode + '|时长秒|起点|终点 ✓）—— 引擎没有振荡 API ✗ 我们得自己驱动 ✓' }
  }
  if (f !== undefined && t2 !== undefined && f === t2) return { ok: false, why: '起点和终点一样，动不起来 ✗' }
  return { ok: true, spec: { target, mode, seconds, from: f, to: t2 } }
}

export interface GgbAnimDrive { target: string; mode: 'loop' | 'ping_pong'; seconds: number; from: number; to: number }
export interface GgbAnimPlan {
  ok: boolean
  /** 交给引擎的指令（配置 + 起播 ✓） */
  cmds: string[]
  /** 要**我们自己**按时间驱动的（引擎没有振荡 API ✓） */
  drive?: GgbAnimDrive
  /** 原生起播后多久自动停（once ✓ 毫秒） */
  stopAfterMs?: number
  notes: string[]
  why?: string
}

const num = (v: number) => String(Math.round(v * 1e6) / 1e6)

/** 【v1737】动画规格 → 台词本（指令序列 + 驱动说明 ✓）—— 纯函数 ✓ 探针盯着 */
export function animPlan(spec: GgbAnimSpec, objects: string[] = []): GgbAnimPlan {
  const notes: string[] = []
  const target = String(spec && spec.target ? spec.target : '').trim()
  if (!target) return { ok: false, cmds: [], notes, why: '没写动画对象' }
  if ((objects || []).length && (objects || []).indexOf(target) < 0) {
    return { ok: false, cmds: [], notes, why: '板上没有「' + target + '」这个对象（先建它 ✓）' }
  }
  const cmds: string[] = []
  if (spec.mode === 'once' || spec.mode === 'continuous') {
    if (spec.mode === 'once' && spec.from !== undefined) cmds.push('SetValue(' + target + ', ' + num(spec.from) + ')')
    cmds.push('StartAnimation(' + target + ', true)')
    notes.push(spec.mode === 'once'
      ? '引擎原生起播 ✓ ' + spec.seconds + ' 秒后自动停 ✓（实测：StartAnimation 返回 false 但真会动 ✗ 所以不看返回值 ✓）'
      : '引擎原生起播 ✓ 会一直跑到滑块自己的上界为止 ✓（⚠ 引擎没有调速/振荡 API ✗ 实测 ✓ 所以「continuous」做不到无限往复 ✓）')
    return { ok: true, cmds, stopAfterMs: spec.mode === 'once' ? Math.round(spec.seconds * 1000) : undefined, notes }
  }
  // loop / ping_pong：引擎没有振荡 API ✗ → 我们自己驱动 ✓
  const from = spec.from as number
  const to = spec.to as number
  cmds.push('SetValue(' + target + ', ' + num(from) + ')')
  cmds.push('StartAnimation(' + target + ', false)')   // 先确保它不是引擎在跑（不然两边抢 ✓）
  notes.push('引擎没有振荡/调速 API（实测 ✗）→ 我们按时间驱动：' + spec.seconds + ' 秒内 ' +
    (spec.mode === 'loop' ? '从 ' + num(from) + ' 到 ' + num(to) + ' 循环' : '在 ' + num(from) + ' 与 ' + num(to) + ' 之间往返') + ' ✓')
  return { ok: true, cmds, drive: { target, mode: spec.mode, seconds: spec.seconds, from, to }, notes }
}

/** 【v1737】驱动一步：算下一个值（纯函数 ✓ 探针盯着）—— loop 到顶回起点；ping_pong 到端回头 ✓ */
export function animNextValue(
  cur: number,
  dir: 1 | -1,
  from: number,
  to: number,
  step: number,
  mode: 'loop' | 'ping_pong' = 'loop',
): { value: number; dir: 1 | -1 } {
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  const s = Math.abs(Number(step)) || 0.05
  let v = cur + dir * s
  let d: 1 | -1 = dir
  if (v >= hi) {
    if (mode === 'ping_pong') { v = hi - (v - hi); d = -1 }
    else { v = lo + (v - hi) }
  } else if (v <= lo) {
    if (mode === 'ping_pong') { v = lo + (lo - v); d = 1 }
    else { v = hi - (lo - v) }
  }
  return { value: Math.max(lo, Math.min(hi, v)), dir: d }
}

/** 【v1737】给老师看的说明（纯函数 ✓） */
export function animDescribe(plan: GgbAnimPlan): string[] {
  const out: string[] = []
  for (const c of plan.cmds || []) out.push('动画指令：' + c)
  for (const n of plan.notes || []) out.push('· ' + n)
  return out
}
