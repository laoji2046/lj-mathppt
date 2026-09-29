/**
 * 【v1736】GeoGebra 命令名规范化：中文别名 → 英文 ✓
 *
 * 为什么需要：**真引擎实测**（v1736，真 GeoGebra 5.2 中文界面）——
 *   `getCommandString('s')` 给的是 **`线段(A, B)`** ✗、圆是 **`圆周(A, B)`** ✗、
 *   点在路径上是 **`描点(c)`** ✗、交点是 **`交点(c, l, 1)`** ✗
 *   → 依赖分析 / 拖动测试只要按英文名匹配（`/^Circle/`）就**全部认不出** ✗
 *
 * 顺带解决另一件事：模型也常写中文别名（Geogebra-WebChat 就是靠一层 normalize 处理它 ✓）
 *   —— 这层归一之后，**读命令串**与**认模型输入**用的是同一张表 ✓
 */
export const GGB_CMD_ALIASES: Record<string, string> = {
  线段: 'Segment', 直线: 'Line', 射线: 'Ray', 向量: 'Vector', 折线: 'Polyline',
  圆周: 'Circle', 圆: 'Circle', 圆弧: 'Arc', 半圆: 'Semicircle',
  描点: 'Point', 点: 'Point', 中点: 'Midpoint', 交点: 'Intersect', 交点坐标: 'Intersect',
  垂线: 'PerpendicularLine', 平行线: 'ParallelLine', 中垂线: 'PerpendicularBisector',
  垂直平分线: 'PerpendicularBisector', 角平分线: 'AngleBisector', 切线: 'Tangent',
  多边形: 'Polygon', 三角形: 'Polygon', 四边形: 'Polygon', 角度: 'Angle', 角: 'Angle',
  距离: 'Distance', 长度: 'Length', 半径: 'Radius', 周长: 'Circumference', 面积: 'Area',
  中心: 'Center', 圆心: 'Center', 斜率: 'Slope', 轨迹: 'Locus',
  旋转: 'Rotate', 轴对称: 'Reflect', 中心对称: 'Reflect', 平移: 'Translate', 位似: 'Dilate',
  函数: 'Function', 垂足: 'Intersect', 极点: 'Extremum', 零点: 'Root',
}

/**
 * 把一条命令 / 定义串里的**命令名**换成英文 ✓
 *  · 只换**函数位**（后面紧跟 `(` 的那个词 ✓）—— 对象名不动 ✗
 *  · 中文命令名（`线段` / `圆周` / `描点` …）与英文命令名都过一遍 ✓
 *  · 认不出的保持原样 ✓（宁可原样返回，也不要瞎改 ✗）
 */
export function ggbNormalizeNames(cmd: unknown): string {
  let s = String(cmd == null ? '' : cmd)
  // ① 中文命令名：一段汉字 + 紧跟 (
  s = s.replace(/([\u4e00-\u9fa5]{1,8})\s*(?=\()/g, (m0, cn: string) => GGB_CMD_ALIASES[cn] ? GGB_CMD_ALIASES[cn] : m0)
  // ② 英文命令名：只把少数几个常见别名补上（大小写不敏感 ✓）
  s = s.replace(/(^|[^A-Za-z0-9_'])([A-Za-z][A-Za-z0-9_']*)\s*(?=\()/g, (m0, pre: string, en: string) => {
    const hit = EN_ALIASES[en.toLowerCase()]
    return hit ? pre + hit : m0
  })
  return s
}

/** 英文里常见的几种写法 → 我们的规范名（只列**确定等价**的 ✓ 不猜 ✗） */
const EN_ALIASES: Record<string, string> = {
  segment: 'Segment', line: 'Line', ray: 'Ray', circle: 'Circle', arc: 'Arc',
  point: 'Point', midpoint: 'Midpoint', intersect: 'Intersect', intersection: 'Intersect',
  perpendicularline: 'PerpendicularLine', parallelline: 'ParallelLine',
  anglebisector: 'AngleBisector', perpendicularbisector: 'PerpendicularBisector',
  tangent: 'Tangent', polygon: 'Polygon', angle: 'Angle', distance: 'Distance',
  length: 'Length', radius: 'Radius', center: 'Center', centre: 'Center', slope: 'Slope',
  rotate: 'Rotate', reflect: 'Reflect', translate: 'Translate', dilate: 'Dilate', locus: 'Locus',
}

/**
 * 取命令名（**归一后的英文名** ✓）：`线段(A, B)` → `Segment` ✓；
 * 自由点的定义 `(0, 0)` → 空串 ✓（它没有命令名 ✓ 这正是"自由点"的判据 ✓）
 */
export function ggbCmdName(cmd: unknown): string {
  const s = ggbNormalizeNames(cmd).trim()
  const m = /^([A-Za-z][A-Za-z0-9_']*)\s*\(/.exec(s)
  return m ? m[1] : ''
}

/** 按**顶层逗号**切参数 ✓（跳过括号里的逗号 ✓）：`Intersect(c, l, 1)` → [c, l, 1] ✓ */
export function ggbCmdArgs(cmd: unknown): string[] {
  const s = ggbNormalizeNames(cmd).trim()
  const i = s.indexOf('(')
  if (i < 0 || s.charAt(s.length - 1) !== ')') return []
  const body = s.slice(i + 1, -1)
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of body) {
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** 是不是"自由点"（定义就是一对坐标 ✓ —— 真几何自由度 ✓ Math2GGB 说的 driver ✓） */
export function ggbFreePointXY(cmd: unknown): { x: number; y: number } | null {
  const m = /^\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/.exec(String(cmd == null ? '' : cmd).trim())
  if (!m) return null
  const x = Number(m[1])
  const y = Number(m[2])
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}
