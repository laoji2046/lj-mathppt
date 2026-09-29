/**
 * 【v1751】立体几何的**斜二测投影**（原式抄自讲义绘图脚本 ✓）
 *
 * 出处：`高中数学讲义/scripts/plot_ch08_14.py` 第 72-100 行 ✓（老师让照它重绘 ✓）
 *   K = 0.5、α = 45°（教材 8.1 的斜二测：y 轴方向取一半长、与 z 轴成 45° ✓）
 *   proj(x, y, z) = (x + K·y·cosα, z + K·y·sinα)          ← 3D → 屏幕（2D）✓
 *   虚实判据：面法向 · 视线方向 W > 0 → 该面可见 ✓，其中 W = (K·cosα, −1, K·sinα) ✓
 *
 * 为什么把它搬进应用（而不是把脚本的**结果坐标**抄成死值 ✗）：
 *  · 源码里留 **3D 顶点 + 面表**（真值 ✓ 可读、可改、可核对 ✓）
 *  · 投影与虚实由**纯函数**现算 ✓ → 探针能逐条验 ✓（含"与讲义原式一致"✓）
 *  · 以后要换视角/换投影（正等测 ✓），只改这一个文件 ✓
 */

/** 斜二测的缩放系数（讲义 K = 0.5 ✓） */
export const OBLIQUE_K = 0.5
/** 斜二测的倾角（讲义 α = 45° ✓） */
export const OBLIQUE_A = Math.PI / 4

const C = OBLIQUE_K * Math.cos(OBLIQUE_A)
const S = OBLIQUE_K * Math.sin(OBLIQUE_A)

/** 视线方向（朝向观察者 ✓）：W = (K·cosα, −1, K·sinα) ✓ 与讲义一致 ✓ */
export const VIEW_W: [number, number, number] = [C, -1, S]

export type V3 = [number, number, number]
export type Face = number[]

/** 斜二测投影：3D → 2D 屏幕坐标 ✓（与讲义 `proj` 同一个式子 ✓） */
export function oblique(p: V3): [number, number] {
  return [p[0] + C * p[1], p[2] + S * p[1]]
}

/** 面的法向（前三个顶点定一个平面 ✓ 与讲义 `_normal` 一致 ✓） */
export function faceNormal(verts: V3[], f: Face): V3 {
  const a = verts[f[0]]
  const b = verts[f[1]]
  const c = verts[f[2]]
  return [
    (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
    (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
  ]
}

/**
 * 面的**外法向** ✓（与绕向无关 ✓）
 * ⚠ 讲义 plot_ch08_14.py 直接用 `cross(b−a, c−a)` 点乘视线 ✗ —— 那只在各面**绕向统一**时才对 ✓；
 *   它自己另一份 cabinet.py 用的是 `face_normal(verts, f, center)` ✓（拿重心把法向拨向外 ✓）。
 *   实测：`plot_ch08_15.py` 那张长方体面表绕向不统一 ✗ → 底面会被判成「可见」✗（探针逮到的 ✓）。
 *   这里统一走**重心法** ✓（更稳 ✓ 也更贴讲义里更细的那份 ✓）。
 */
export function faceNormalOut(verts: V3[], f: Face, center?: V3): V3 {
  const n = faceNormal(verts, f)
  const c = center || centroid(verts)
  const a = verts[f[0]]
  const inward = n[0] * (c[0] - a[0]) + n[1] * (c[1] - a[1]) + n[2] * (c[2] - a[2]) > 0
  return inward ? [-n[0], -n[1], -n[2]] : n
}

/** 顶点重心（判外法向用 ✓） */
export function centroid(verts: V3[]): V3 {
  const n = Math.max(1, verts.length)
  let x = 0, y = 0, z = 0
  for (const v of verts) { x += v[0]; y += v[1]; z += v[2] }
  return [x / n, y / n, z / n]
}

/** 这个面朝向观察者吗 ✓（外法向 · W > 1e-9 ✓ 与绕向无关 ✓） */
export function faceVisible(verts: V3[], f: Face): boolean {
  const n = faceNormalOut(verts, f)
  return n[0] * VIEW_W[0] + n[1] * VIEW_W[1] + n[2] * VIEW_W[2] > 1e-9
}

export interface Solid2d {
  /** 归一化到 [0,1] 的 2D 顶点（扁平 x,y ✓ 与 MathFigureElement.points 同一套 ✓） */
  points: number[]
  /** 边： [起点, 终点, 是否虚线] ✓ */
  edges: [number, number, 0 | 1][]
  /** 投影后未归一化的屏幕坐标（调试/探针用 ✓） */
  raw: [number, number][]
}

/**
 * 3D 顶点 + 面表 → 我们图元要的「归一化 2D 点 + 边（带虚实）」✓
 *
 * 边从**面表**里收（每个面的相邻顶点 ✓ 去重 ✓）：
 *   · 该边的**所有面都不可见** → 虚线（1 ✓）
 *   · 只要有**一个面可见** → 实线（0 ✓）
 * 这与讲义 `draw_solid` 的"可见面实线、其余虚线"是同一套 ✓（讲义还按面填色 ✓ 我们不需要 ✓）
 *
 * @param pad 归一化时四周留的空白比例（默认 0.05 ✓ 给顶点字母留地方 ✓）
 */
export function solidTo2d(verts: V3[], faces: Face[], pad = 0.05): Solid2d {
  const raw: [number, number][] = verts.map(oblique)
  const xs = raw.map((p) => p[0])
  const ys = raw.map((p) => p[1])
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const w = Math.max(1e-6, x1 - x0)
  const h = Math.max(1e-6, y1 - y0)
  const inner = 1 - pad * 2
  const points: number[] = []
  for (const p of raw) {
    /* ⚠ y 要**翻一次** ✗：讲义是 matplotlib（y 向上 ✓），我们是 SVG（y 向下 ✓）——
       不翻的话 z（朝上）会被画成朝下 ✗（四棱锥的顶点会跑到下面 ✓ 棱台顶面跑到下面 ✓ 探针逮到的 ✓） */
    const fy = 1 - (p[1] - y0) / h
    points.push(
      +(pad + ((p[0] - x0) / w) * inner).toFixed(4),
      +(pad + fy * inner).toFixed(4),
    )
  }
  /* 收集边并判虚实 ✓ */
  const vis = faces.map((f) => faceVisible(verts, f))
  const dashed = new Map<string, boolean>()      // key "a-b" → 是否**已经确定可见**（有一条可见面就算实线 ✓）
  for (let fi = 0; fi < faces.length; fi++) {
    const f = faces[fi]
    for (let i = 0; i < f.length; i++) {
      const a = f[i]
      const b = f[(i + 1) % f.length]
      const k = a < b ? a + '-' + b : b + '-' + a
      const prev = dashed.get(k)
      const nowVisible = vis[fi]
      if (prev === undefined) dashed.set(k, nowVisible)
      else dashed.set(k, prev || nowVisible)
    }
  }
  const edges: [number, number, 0 | 1][] = []
  const seen = new Set<string>()
  for (let fi = 0; fi < faces.length; fi++) {
    const f = faces[fi]
    for (let i = 0; i < f.length; i++) {
      const a = f[i]
      const b = f[(i + 1) % f.length]
      const k = a < b ? a + '-' + b : b + '-' + a
      if (seen.has(k)) continue
      seen.add(k)
      edges.push([a, b, dashed.get(k) ? 0 : 1])
    }
  }
  return { points, edges, raw }
}

/* ═══════════════════════════════════════════════════════════════════════════
   【v1754】旋转体：**正等测**与椭圆比例（照讲义 `cabinet.py` ✓）

   讲义约定（`高中数学讲义/scripts/cabinet.py` ✓）：
     正等测：`iproj(p) = (K(x−y), z − 0.5(x+y))` ✓ `K = √3/2` ✓
     水平圆 → 屏幕椭圆，**长:短 = √3 : 1** ✓（讲义注释原话 ✓
       我按公式又独立推了一遍：x 方向半轴 = K·√2·r ✓ z 方向半轴 = (√2/2)·r ✓ ⇒ 比值 = √3 ✓）

   ⚠ 应用里原来的旋转体椭圆是**手写比例** ✗：圆柱 0.36/0.12 ≈ 3 ✓、圆锥 0.38/0.13 ≈ 2.9 ✓、球赤道 0.34 ≈ 2.9 ✓
     —— 都比 √3 ≈ 1.732 **扁** ✗，看着不像正等测 ✓ ⇒ 统一改成 `ry = rx / ISO_RATIO` ✓（两处渲染器各一行 ✓）
   ═══════════════════════════════════════════════════════════════════════════ */

/** 正等测的比例系数 ✓ K = √3/2 ✓（讲义 `ISO_K` ✓） */
export const ISO_K = Math.sqrt(3) / 2
/** 水平圆（半径 r）→ 椭圆半长轴 = ISO_RX · r ✓（= K·√2 ✓） */
export const ISO_RX = ISO_K * Math.SQRT2
/** 水平圆（半径 r）→ 椭圆半短轴 = ISO_RY · r ✓（= √2/2 ✓） */
export const ISO_RY = Math.SQRT2 / 2
/** 椭圆的长:短 ✓ 恰好 = √3 ✓（讲义注释里那个比值 ✓ 探针会核 ✓） */
export const ISO_RATIO = ISO_RX / ISO_RY

/** 正等测投影：3D → 2D 屏幕坐标 ✓（与讲义 `iproj` 同式 ✓） */
export function isometric(p: V3): [number, number] {
  return [ISO_K * (p[0] - p[1]), p[2] - 0.5 * (p[0] + p[1])]
}

/** 水平圆（半径 r）投影后的椭圆半轴 ✓（旋转体的底面 / 顶面圆都用它 ✓） */
export function isoCircle(r: number): { rx: number; ry: number } {
  return { rx: ISO_RX * r, ry: ISO_RY * r }
}

/* ═══════════════════════════════════════════════════════════════════════════
   【v1759】圆锥（圆台）的**母线切点** —— 用户实报「圆锥还不太对」✓

   症状：底面椭圆在两侧**露出一小截** ✗（把母线画到了长轴两端 ✗）
   原因：圆锥的轮廓母线是**从顶点到底面椭圆的切线** ✓ 切点**不是**长轴两端 ✗
     设椭圆 x²/rx² + y²/ry² = 1 ✓ 顶点在椭圆中心正上方距离 D 处 ✓
     极线（切点连线）：y·(−D)/ry² = 1 ⇒ 切点纵坐标 = **−ry²/D** ✓（朝顶点那侧 ✓）
     切点横坐标 = ±rx·√(1 − (ry/D)²) ✓
   量过的实例（用户截图 ✓）：rx=238、ry=142、D=422 ⇒ 切点 y=47.8、x=±224 ✓
     —— 而按长轴端点 (±238, 0) 画出来的母线 ✗ 自然会把椭圆两侧露在外面 ✗
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 从椭圆（半轴 rx、ry）**外部正上方距离 dist 处的点**看过去的切点 ✓（纯函数 ✓）
 * @returns `{ tx, ty }`：切点相对椭圆中心的坐标 ✓ **ty 朝外部的那个点为正** ✓（调用方自己按屏幕朝向摆 ✓）
 *          `tx < rx` 且 `ty > 0` ✓（切线只会切在"朝顶点那一侧"，不可能落在长轴端点上 ✗）
 */
export function ellipseTangentFrom(rx: number, ry: number, dist: number): { tx: number; ty: number } {
  if (!(rx > 0) || !(ry > 0) || !(dist > ry)) return { tx: rx, ty: 0 }   // 退化：够不着就退回长轴端点 ✓
  const ty = (ry * ry) / dist
  const k = Math.max(0, 1 - (ty / ry) * (ty / ry))
  return { tx: rx * Math.sqrt(k), ty }
}

/**
 * 圆锥 / 圆台轮廓母线的切点（屏幕坐标 ✓）
 * @param cx 椭圆中心 x ✓ @param cy 椭圆中心 y（屏幕坐标 ✓ 向下为正 ✓）
 * @param apexY 顶点（或虚拟顶点）的屏幕 y ✓（在椭圆上方 ⇒ apexY < cy ✓）
 */
export function coneTangentSides(cx: number, cy: number, rx: number, ry: number, apexY: number): { x: number; y: number }[] {
  const t = ellipseTangentFrom(rx, ry, cy - apexY)
  return [{ x: cx - t.tx, y: cy - t.ty }, { x: cx + t.tx, y: cy - t.ty }]
}

/** 圆台的**虚拟顶点**到两个底面中心的距离 ✓（两个椭圆是同一个锥被截出来的 ✓）
 *  D_bottom = H·r_bottom/(r_bottom − r_top) ✓ */
export function frustumApex(botY: number, topY: number, rBot: number, rTop: number): number {
  if (!(rBot > rTop)) return botY - (botY - topY) * 4     // 退化：接近圆柱就放很远 ✓
  return (botY - topY) * (rBot / (rBot - rTop))
}

/* ═══════════════════════════════════════════════════════════════════════════
   【v1761】圆台（frustum）的轮廓 —— 同样是**从虚拟顶点引切线** ✓

   原来两个渲染器都是把母线直接连到"两边椭圆的端点"✗（(cx±rB, botY) → (cx±rT, topY)）
   ⇒ 底面椭圆两侧会**露出来** ✗ 而且是斜的、不贴着曲面 ✗（与圆锥 v1759/v1760 是同一个 bug 家族 ✓）

   正确做法：两个底面椭圆是同一个圆锥被截出来的 ✓ ⇒ 母线是**同一个虚拟顶点**引出的切线 ✓
     · 虚拟顶点：`D = H·rB/(rB − rT)` ✓（`frustumApex` 已给 ✓）
     · 两个椭圆上各自的切点：`coneTangentSides(...)` ✓（同一条切线同时切两个椭圆 ✓）
     · 两切点与顶点**共线** ✓（探针会核这条 ✓）
   ⚠ 端点一离开长轴两端 ⇒ 下弧的 `large-arc-flag` 必须改成 **1** ✓（v1760 踩过 ✓）
   ═══════════════════════════════════════════════════════════════════════════ */

/** 圆台渲染要用的全部几何（纯函数 ✓ 两个渲染器共用 ✓ 免得又"改一处忘一处" ✗） */
export function frustumGeom(
  w: number,
  h: number,
  /** 默认比例与原来一致 ✓（rB = 0.4·min、rT = 0.24·min ✓ 上下底中心 h·0.76 / h·0.28 ✓）*/
  k = { rB: 0.4, rT: 0.24, topY: 0.28, botY: 0.76 },
) {
  const mm = Math.min(w, h)
  const rB = mm * k.rB
  const rT = mm * k.rT
  const ryB = rB / ISO_RATIO
  const ryT = rT / ISO_RATIO
  const cx = w / 2
  const topY = h * k.topY
  const botY = h * k.botY
  const apexY = botY - frustumApex(botY, topY, rB, rT)
  const tb = coneTangentSides(cx, botY, rB, ryB, apexY)
  const tt = coneTangentSides(cx, topY, rT, ryT, apexY)
  return {
    cx, topY, botY, rB, rT, ryB, ryT, apexY,
    LB: tb[0], RB: tb[1], LT: tt[0], RT: tt[1],
  }
}
