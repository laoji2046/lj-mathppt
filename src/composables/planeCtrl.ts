/**
 * 平面图形的**控制点几何** —— 平行四边形（边长 / 夹角）、圆弧（圆心 + 圆心角）、
 * 过三点的弧、以及"以某点为圆心、指定半径的圆"。
 *
 * 约定：
 * - 控制点存元素的 `ctrl`，坐标是**归一化**的（0..1，随元素框缩放）；
 * - **长度 / 半径一律在像素里算**，这样圆和弧永远是正圆（不会因为元素框非等比被压成椭圆 ⭕→⬭）；
 * - 角度用**屏幕坐标**（x 向右、y 向下）：0° 指向右，**正角 = 屏幕上的顺时针**，
 *   与 SVG 的 `A` 命令 sweep-flag=1 同向，所以画弧时不用再翻符号。
 */
export interface Pt { x: number; y: number }
export type Ctrl = Pt[]

/** 支持控制点的平面图形 */
export const PLANE_CTRL_KINDS = ['parallelogram', 'arcAngle', 'arc3pt', 'circleR'] as const
export function isPlaneCtrlKind(kind: string): boolean {
  return (PLANE_CTRL_KINDS as readonly string[]).includes(kind)
}
/** 每种要几个控制点 */
function ctrlCount(kind: string): number {
  return kind === 'parallelogram' || kind === 'circleR' ? 2 : 3
}

const DEG = 180 / Math.PI
// 归一化坐标保留 4 位小数：半径/边长这类量在像素里读回来误差 < 0.05px（3 位时会出现"输入 123 → 显示 123.2"）
const R3 = (n: number) => Math.round(n * 10000) / 10000
const n1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '0')
const PX = (p: Pt, w: number, h: number): Pt => ({ x: p.x * w, y: p.y * h })
/** 像素位置 → 归一化控制点 */
const NORM = (x: number, y: number, w: number, h: number): Pt => ({ x: R3(x / w), y: R3(y / h) })
/** 以 c 为心、半径 r（像素）、角度 deg → 归一化点 */
function ptAt(c: Pt, r: number, w: number, h: number, deg: number): Pt {
  const a = deg / DEG
  return { x: R3(c.x + (r * Math.cos(a)) / w), y: R3(c.y + (r * Math.sin(a)) / h) }
}
/** 角差折到 (−180,180] */
function norm180(d: number): number {
  return (((d % 360) + 540) % 360) - 180
}

/** 各 kind 的默认控制点（按当前元素框算，保证半径/圆心角在像素里自洽） */
export function defaultPlaneCtrl(kind: string, w: number, h: number): Ctrl {
  const m = Math.min(w, h)
  if (kind === 'parallelogram') {
    // A 固定在版面左上角内侧，B / D 就是两个控制点
    return [{ x: 1, y: 0 }, { x: 0, y: 1 }]
  }
  if (kind === 'arcAngle') {
    const c = { x: 0.34, y: 0.62 }
    const r = m * 0.32
    return [c, ptAt(c, r, w, h, -120), ptAt(c, r, w, h, 20)]
  }
  if (kind === 'circleR') {
    const c = { x: 0.5, y: 0.5 }
    return [c, ptAt(c, m * 0.38, w, h, 0)]
  }
  // 过三点的弧：左端点、拱顶、右端点
  return [{ x: 0.2, y: 0.84 }, { x: 0.5, y: 0.2 }, { x: 0.8, y: 0.84 }]
}
/** 取有效控制点（存档里没有 / 数量不够 → 用默认值，**老图元外观与以前逐字相同**） */
export function planeCtrl(kind: string, w: number, h: number, ctrl?: Ctrl): Ctrl {
  const n = ctrlCount(kind)
  if (ctrl && ctrl.length >= n && ctrl.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))) return ctrl.slice(0, n)
  return defaultPlaneCtrl(kind, w, h)
}

/* ---------------- 平行四边形：两个控制点 = 两条邻边（边长 + 夹角） ---------------- */

/** A 固定在这里（与老版平行四边形的左上顶点一致） */
export const PARA_A: Pt = { x: 0.22, y: 0 }
export function paraPts(w: number, h: number, ctrl?: Ctrl) {
  const c = planeCtrl('parallelogram', w, h, ctrl)
  const B = c[0], D = c[1]
  const C = { x: B.x + D.x - PARA_A.x, y: B.y + D.y - PARA_A.y }
  return { A: PARA_A, B, C, D }
}
/** 边长（像素）与夹角（度，0..180） */
export function paraInfo(w: number, h: number, ctrl?: Ctrl) {
  const { A, B, D } = paraPts(w, h, ctrl)
  const a = PX(A, w, h), b = PX(B, w, h), d = PX(D, w, h)
  const u = { x: b.x - a.x, y: b.y - a.y }
  const v = { x: d.x - a.x, y: d.y - a.y }
  const lu = Math.hypot(u.x, u.y) || 1e-9
  const lv = Math.hypot(v.x, v.y) || 1e-9
  const cos = Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / (lu * lv)))
  return { ab: lu, ad: lv, angle: Math.acos(cos) * DEG, side: Math.sign(u.x * v.y - u.y * v.x) || 1 }
}

/* ---------------- 圆弧：圆心 + 起点 + 终点（圆心角 = 起点到终点） ---------------- */

export interface ArcInfo { C: Pt; S: Pt; E: Pt; r: number; a0: number; a1: number; sweep: number }
/**
 * 圆弧几何。
 * ⚠ `sweepDeg`（元素上的 arcSweep）：**两个端点定不出"走长弧还是短弧"** ——
 *   270° 与 −90° 的起终点完全一样。所以"圆心角"必须单独存一个数；
 *   给了它就以它为准（终点由 a0+sweep 算出来），没给就按 (−180,180] 的短弧。
 */
export function arcInfo(w: number, h: number, ctrl?: Ctrl, sweepDeg?: number): ArcInfo {
  const c = planeCtrl('arcAngle', w, h, ctrl)
  const C = PX(c[0], w, h), S = PX(c[1], w, h)
  const r = Math.hypot(S.x - C.x, S.y - C.y) || 1e-9
  const a0 = Math.atan2(S.y - C.y, S.x - C.x) * DEG
  if (Number.isFinite(sweepDeg as number)) {
    const sweep = Math.max(-360, Math.min(360, sweepDeg as number))
    const En = ptAt(NORM(C.x, C.y, w, h), r, w, h, a0 + sweep)
    const E = PX(En, w, h)
    return { C, S, E, r, a0, a1: a0 + sweep, sweep }
  }
  const E = PX(c[2], w, h)
  const a1 = Math.atan2(E.y - C.y, E.x - C.x) * DEG
  return { C, S, E, r, a0, a1, sweep: norm180(a1 - a0) }
}
/** 指定半径的圆 */
export function circleInfo(w: number, h: number, ctrl?: Ctrl) {
  const c = planeCtrl('circleR', w, h, ctrl)
  const C = PX(c[0], w, h), X = PX(c[1], w, h)
  return { C, X, r: Math.hypot(X.x - C.x, X.y - C.y) || 1e-9 }
}
/** 过三点的弧：先定圆（外心 + 半径），再从 A 走到 C 且**经过 B** */
export function arc3Info(w: number, h: number, ctrl?: Ctrl) {
  const c = planeCtrl('arc3pt', w, h, ctrl)
  const A = PX(c[0], w, h), B = PX(c[1], w, h), C = PX(c[2], w, h)
  const d = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y))
  if (Math.abs(d) < 1e-6) return { ok: false, A, B, C, O: A, r: 0, a0: 0, sweep: 0 }
  const a2 = A.x * A.x + A.y * A.y, b2 = B.x * B.x + B.y * B.y, c2 = C.x * C.x + C.y * C.y
  const O = {
    x: (a2 * (B.y - C.y) + b2 * (C.y - A.y) + c2 * (A.y - B.y)) / d,
    y: (a2 * (C.x - B.x) + b2 * (A.x - C.x) + c2 * (B.x - A.x)) / d,
  }
  const ang = (p: Pt) => Math.atan2(p.y - O.y, p.x - O.x) * DEG
  const aA = ang(A), aB = ang(B), aC = ang(C)
  const cwAC = ((aC - aA) % 360 + 360) % 360
  const cwAB = ((aB - aA) % 360 + 360) % 360
  const sweep = cwAB <= cwAC ? cwAC : -(360 - cwAC)
  return { ok: true, A, B, C, O, r: Math.hypot(A.x - O.x, A.y - O.y), a0: aA, sweep }
}

/* ---------------- 手柄（像素坐标） ---------------- */

export interface PlaneHandle { i: number; x: number; y: number }
export function planeHandles(kind: string, w: number, h: number, ctrl?: Ctrl, sweepDeg?: number): PlaneHandle[] {
  if (kind === 'parallelogram') {
    const { B, D } = paraPts(w, h, ctrl)
    return [{ i: 0, ...PX(B, w, h) }, { i: 1, ...PX(D, w, h) }]
  }
  if (kind === 'arc3pt') {
    const a = arc3Info(w, h, ctrl)
    return [{ i: 0, ...a.A }, { i: 1, ...a.B }, { i: 2, ...a.C }]
  }
  if (kind === 'circleR') {
    const c = circleInfo(w, h, ctrl)
    return [{ i: 0, ...c.C }, { i: 1, ...c.X }]
  }
  const a = arcInfo(w, h, ctrl, sweepDeg)
  return [{ i: 0, ...a.C }, { i: 1, ...a.S }, { i: 2, ...a.E }]
}

/** 拖动第 i 个控制点到 (px,py) → 新的控制点（圆弧还会带回 arcSweep） */
export interface PlanePatch { ctrl: Ctrl; arcSweep?: number }
export function planeDrag(
  kind: string, w: number, h: number, ctrl: Ctrl | undefined, i: number, px: number, py: number, sweepDeg?: number,
): PlanePatch {
  const cur = planeCtrl(kind, w, h, ctrl)
  if (kind === 'parallelogram' || kind === 'arc3pt') {
    const next = cur.map((p) => ({ ...p }))
    if (!next[i]) return { ctrl: cur }
    next[i] = NORM(px, py, w, h)
    return { ctrl: next }
  }
  if (kind === 'circleR') {
    const { C } = circleInfo(w, h, cur)
    if (i === 0) {
      // 拖圆心 = 整体平移（手柄跟着走）
      const dx = px - C.x, dy = py - C.y
      return { ctrl: cur.map((p) => ({ x: R3(p.x + dx / w), y: R3(p.y + dy / h) })) }
    }
    const r2 = Math.max(2, Math.hypot(px - C.x, py - C.y))
    const a = Math.atan2(py - C.y, px - C.x) * DEG
    return { ctrl: [NORM(C.x, C.y, w, h), ptAt(NORM(C.x, C.y, w, h), r2, w, h, a)] }
  }
  // arcAngle
  const info = arcInfo(w, h, cur, sweepDeg)
  if (i === 0) {
    const dx = px - info.C.x, dy = py - info.C.y
    return { ctrl: cur.map((p) => ({ x: R3(p.x + dx / w), y: R3(p.y + dy / h) })), arcSweep: info.sweep }
  }
  const C = NORM(info.C.x, info.C.y, w, h)
  if (i === 1) {
    const r2 = Math.max(2, Math.hypot(px - info.C.x, py - info.C.y))
    const a0 = Math.atan2(py - info.C.y, px - info.C.x) * DEG
    return { ctrl: [C, ptAt(C, r2, w, h, a0), ptAt(C, r2, w, h, a0 + info.sweep)], arcSweep: info.sweep }
  }
  const a1 = Math.atan2(py - info.C.y, px - info.C.x) * DEG
  const sweep = norm180(a1 - info.a0)
  return { ctrl: [C, ptAt(C, info.r, w, h, info.a0), ptAt(C, info.r, w, h, info.a0 + sweep)], arcSweep: sweep }
}

/* ---------------- 面板数字（可读，多数可改） ---------------- */

export interface PlaneNum {
  key: 'ab' | 'ad' | 'angle' | 'r' | 'a0' | 'sweep'
  label: string
  value: number
  unit: string
  step: number
  editable: boolean
  round?: number
}
export function planeNumbers(kind: string, w: number, h: number, ctrl?: Ctrl, sweepDeg?: number): PlaneNum[] {
  const r0 = (n: number) => Math.round(n * 10) / 10
  if (kind === 'parallelogram') {
    const i = paraInfo(w, h, ctrl)
    return [
      { key: 'ab', label: '边长 AB', value: r0(i.ab), unit: 'px', step: 5, editable: true },
      { key: 'ad', label: '边长 AD', value: r0(i.ad), unit: 'px', step: 5, editable: true },
      { key: 'angle', label: '夹角 ∠DAB', value: r0(i.angle), unit: '°', step: 1, editable: true },
    ]
  }
  if (kind === 'circleR') {
    const c = circleInfo(w, h, ctrl)
    return [{ key: 'r', label: '半径 r', value: r0(c.r), unit: 'px', step: 5, editable: true }]
  }
  if (kind === 'arc3pt') {
    const a = arc3Info(w, h, ctrl)
    return [{ key: 'r', label: '半径 R', value: r0(a.r), unit: 'px', step: 5, editable: false }]
  }
  const a = arcInfo(w, h, ctrl, sweepDeg)
  return [
    { key: 'r', label: '半径 r', value: r0(a.r), unit: 'px', step: 5, editable: true },
    { key: 'a0', label: '起始角', value: r0(a.a0), unit: '°', step: 5, editable: true },
    { key: 'sweep', label: '圆心角', value: r0(a.sweep), unit: '°', step: 5, editable: true },
  ]
}

/** 面板里改一个数字 → 新的控制点（圆弧的圆心角会额外带回 arcSweep） */
export function setPlaneNumber(
  kind: string, w: number, h: number, ctrl: Ctrl | undefined, key: PlaneNum['key'], val: number, sweepDeg?: number,
): PlanePatch {
  const cur = planeCtrl(kind, w, h, ctrl)
  const v = Number.isFinite(val) ? val : 0
  if (kind === 'parallelogram') {
    const info = paraInfo(w, h, cur)
    const A = PX(PARA_A, w, h)
    const B = PX(cur[0], w, h), D = PX(cur[1], w, h)
    if (key === 'ab') {
      const L = Math.hypot(B.x - A.x, B.y - A.y) || 1e-9
      const k = Math.max(1, v) / L
      return { ctrl: [NORM(A.x + (B.x - A.x) * k, A.y + (B.y - A.y) * k, w, h), cur[1]] }
    }
    if (key === 'ad') {
      const L = Math.hypot(D.x - A.x, D.y - A.y) || 1e-9
      const k = Math.max(1, v) / L
      return { ctrl: [cur[0], NORM(A.x + (D.x - A.x) * k, A.y + (D.y - A.y) * k, w, h)] }
    }
    // 夹角：保持 AD 长度，绕 A 转到目标角度（保留原来朝哪一侧）
    const lenAD = Math.hypot(D.x - A.x, D.y - A.y) || 1e-9
    const aAB = Math.atan2(B.y - A.y, B.x - A.x)
    const want = Math.max(0, Math.min(180, v)) / DEG
    const aAD = aAB + info.side * want
    const D2 = { x: A.x + lenAD * Math.cos(aAD), y: A.y + lenAD * Math.sin(aAD) }
    return { ctrl: [cur[0], NORM(D2.x, D2.y, w, h)] }
  }
  if (kind === 'circleR') {
    const c = circleInfo(w, h, cur)
    const a = Math.atan2(c.X.y - c.C.y, c.X.x - c.C.x) * DEG
    const C = NORM(c.C.x, c.C.y, w, h)
    return { ctrl: [C, ptAt(C, Math.max(2, v), w, h, a)] }
  }
  if (kind === 'arc3pt') return { ctrl: cur }   // 三点弧的半径是算出来的，改不了
  const info = arcInfo(w, h, cur, sweepDeg)
  const C = NORM(info.C.x, info.C.y, w, h)
  if (key === 'r') {
    return { ctrl: [C, ptAt(C, Math.max(2, v), w, h, info.a0), ptAt(C, Math.max(2, v), w, h, info.a0 + info.sweep)], arcSweep: info.sweep }
  }
  if (key === 'a0') {
    return { ctrl: [C, ptAt(C, info.r, w, h, v), ptAt(C, info.r, w, h, v + info.sweep)], arcSweep: info.sweep }
  }
  // 圆心角：起点不动，终点按新角度摆；**这个数单独存**（±270 这种长弧靠它区分）
  const sweep = Math.max(-360, Math.min(360, v))
  return { ctrl: [C, ptAt(C, info.r, w, h, info.a0), ptAt(C, info.r, w, h, info.a0 + sweep)], arcSweep: sweep }
}

/* ---------------- 画图形 ---------------- */

export interface PlaneStyle { stroke: string; sw: number; dash: string; fill: string }
/** 弧的 path d（屏幕角度 → SVG A 命令） */
export function arcPathD(S: Pt, E: Pt, r: number, sweep: number): string {
  const large = Math.abs(sweep) > 180 ? 1 : 0
  const sw = sweep >= 0 ? 1 : 0
  return 'M ' + n1(S.x) + ' ' + n1(S.y) + ' A ' + n1(r) + ' ' + n1(r) + ' 0 ' + large + ' ' + sw + ' ' + n1(E.x) + ' ' + n1(E.y)
}
export function planeSvg(kind: string, w: number, h: number, ctrl: Ctrl | undefined, st: PlaneStyle, sweepDeg?: number): string {
  const s = (extra = '') =>
    'stroke="' + st.stroke + '" stroke-width="' + n1(st.sw) + '" fill="' + st.fill + '" stroke-linecap="round" stroke-linejoin="round"' + (st.dash ? ' stroke-dasharray="' + st.dash + '"' : '') + extra
  const line = 'stroke="' + st.stroke + '" stroke-width="' + n1(st.sw) + '" fill="none" stroke-linecap="round"'
  const dot = (p: Pt, r: number) => '<circle cx="' + n1(p.x) + '" cy="' + n1(p.y) + '" r="' + n1(r) + '" fill="' + st.stroke + '"/>'
  if (kind === 'parallelogram') {
    const p = paraPts(w, h, ctrl)
    const A = PX(p.A, w, h), B = PX(p.B, w, h), C = PX(p.C, w, h), D = PX(p.D, w, h)
    const pts = [A, B, C, D].map((q) => n1(q.x) + ',' + n1(q.y)).join(' ')
    return '<polygon points="' + pts + '" ' + s() + '/>'
  }
  if (kind === 'circleR') {
    const c = circleInfo(w, h, ctrl)
    return '<circle cx="' + n1(c.C.x) + '" cy="' + n1(c.C.y) + '" r="' + n1(c.r) + '" ' + s() + '/>' + dot(c.C, Math.max(1.6, st.sw * 0.9))
  }
  if (kind === 'arc3pt') {
    const a = arc3Info(w, h, ctrl)
    if (!a.ok) {
      // 三点共线：画不出来（如实画一条虚线，面板会提示）
      return '<line x1="' + n1(a.A.x) + '" y1="' + n1(a.A.y) + '" x2="' + n1(a.C.x) + '" y2="' + n1(a.C.y) + '" ' + line + ' stroke-dasharray="6 5"/>'
    }
    return '<path d="' + arcPathD(a.A, a.C, a.r, a.sweep) + '" ' + line + '/>'
  }
  // arcAngle
  const a = arcInfo(w, h, ctrl, sweepDeg)
  return '<path d="' + arcPathD(a.S, a.E, a.r, a.sweep) + '" ' + line + '/>' + dot(a.C, Math.max(1.6, st.sw * 0.9))
}
