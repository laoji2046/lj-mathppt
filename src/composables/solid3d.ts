// 三维多面体：以“归一化顶点 + 边拓扑 + 面”统一建模。
// 顶点为 [0,1]×[0,1] 归一化平面坐标（斜投影）；边支持按拓扑默认虚实，也可逐边覆盖（线型/粗细/颜色）；
// 顶点可标注字母（_ 下标、^ 上标、' 撇），用于数学立体几何作图。
import type { MathFigureElement } from '@/types'

export const SOLID_KINDS = ['cube', 'cuboid', 'pyramid', 'prism', 'tetrahedron', 'pyraFrustum', 'octahedron', 'hexPrism', 'obliquePrism', 'triFrustum'] as const
export const SOLID_VCOUNT: Record<string, number> = {
  cube: 8, cuboid: 8, pyramid: 5, prism: 6, tetrahedron: 4, pyraFrustum: 8,
  octahedron: 6, hexPrism: 12, obliquePrism: 8, triFrustum: 6,
}

type Edge = [number, number, 0 | 1]
export type EdgeStyle = { dash?: 'solid' | 'dash' | 'dot'; width?: number; color?: string; /** 在该边终点画箭头（坐标轴用） */ arrow?: boolean }
export type FaceStyle = { fill?: string; opacity?: number; hidden?: boolean }
export type SolidMesh = { edges: [number, number, number][]; faces: number[][] }

const FACES: Record<string, number[][]> = {
  cube: [[0, 1, 5, 4], [1, 2, 6, 5], [0, 1, 2, 3]],       // top / right / front
  cuboid: [[0, 1, 5, 4], [1, 2, 6, 5], [0, 1, 2, 3]],
  pyramid: [[1, 2, 4, 3], [0, 1, 3], [0, 4, 2], [0, 3, 4]], // bottom / left / right / front
  prism: [[0, 1, 2], [3, 4, 5]],
  tetrahedron: [[0, 1, 2], [3, 0, 2], [3, 1, 0], [3, 2, 1]],
  pyraFrustum: [[0, 1, 2, 3], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5], [4, 5, 6, 7], [0, 1, 5, 4]], // bottom / back / left / right / top / front
  obliquePrism: [[0, 1, 5, 4], [1, 2, 6, 5], [0, 1, 2, 3]],
  // 正八面体：背面 4 面 → 正面 4 面
  octahedron: [[0, 3, 5], [0, 5, 2], [1, 3, 5], [1, 5, 2], [0, 2, 4], [0, 4, 3], [1, 2, 4], [1, 4, 3]],
  // 正六棱柱：底 / 后 / 左后 / 右后 / 左前 / 右前 / 前 / 顶
  hexPrism: [[6, 7, 8, 9, 10, 11], [4, 5, 11, 10], [3, 4, 10, 9], [5, 0, 6, 11], [0, 1, 7, 6], [2, 3, 9, 8], [1, 2, 8, 7], [0, 1, 2, 3, 4, 5]],
  // 正三棱台：底 / 左后侧 / 右后侧 / 前面 / 顶
  triFrustum: [[0, 1, 2], [0, 1, 4, 3], [2, 0, 3, 5], [1, 2, 5, 4], [3, 4, 5]],
}
const FOP: Record<string, number[]> = {
  cube: [0.8, 0.62, 1], cuboid: [0.8, 0.62, 1],
  pyramid: [0.4, 0.75, 0.75, 0.9],
  prism: [0.9, 0.5],
  tetrahedron: [0.4, 0.86, 0.76, 0.66],
  pyraFrustum: [0.4, 0.5, 0.75, 0.75, 0.9, 0.85],
  obliquePrism: [0.8, 0.62, 1],
  octahedron: [0.5, 0.5, 0.4, 0.4, 0.9, 0.9, 0.8, 0.8],
  hexPrism: [0.35, 0.5, 0.6, 0.6, 0.85, 0.85, 0.9, 0.9],
  triFrustum: [0.35, 0.7, 0.7, 0.9, 0.9],
}
/** 某立体的边表 [起,止,隐藏(1=图形中被遮挡)] —— 编辑器命中检测与渲染共用 */
export function solidEdges(kind: string): Edge[] { return EDGES[kind] || [] }
/** 某立体的面表（顶点索引环）—— 面命中检测与渲染共用 */
export function solidFaces(kind: string): number[][] { return FACES[kind] || [] }
/** 自由建模用的“完整面表”（含被遮挡的面），仅用于初始化 mesh；渲染仍按 mesh */
const MESH_FACES: Record<string, number[][]> = {
  // 顺序：远面先画、前面最后（半透明叠加更自然）
  cube: [[4, 5, 6, 7], [3, 2, 6, 7], [0, 3, 7, 4], [0, 1, 5, 4], [1, 2, 6, 5], [0, 1, 2, 3]],
  cuboid: [[4, 5, 6, 7], [3, 2, 6, 7], [0, 3, 7, 4], [0, 1, 5, 4], [1, 2, 6, 5], [0, 1, 2, 3]],
  obliquePrism: [[4, 5, 6, 7], [3, 2, 6, 7], [0, 3, 7, 4], [0, 1, 5, 4], [1, 2, 6, 5], [0, 1, 2, 3]],
  prism: [[3, 4, 5], [0, 1, 4, 3], [2, 0, 3, 5], [1, 2, 5, 4], [0, 1, 2]],
}
/** 完整面表（自由建模初始化用） */
export function solidFacesAll(kind: string): number[][] {
  return MESH_FACES[kind] || FACES[kind] || []
}

/** 取边表：有自由建模 mesh 时用 mesh，否则用类型默认 */
export function meshEdges(kind: string, mesh?: SolidMesh | null): Edge[] {
  return (mesh && Array.isArray(mesh.edges)) ? (mesh.edges as Edge[]) : (EDGES[kind] || [])
}
/** 取面表：有自由建模 mesh 时用 mesh，否则用类型默认 */
export function meshFaces(kind: string, mesh?: SolidMesh | null): number[][] {
  return (mesh && Array.isArray(mesh.faces)) ? mesh.faces : (FACES[kind] || [])
}

const EDGES: Record<string, Edge[]> = {
  cube: [[0, 1, 0], [1, 2, 0], [2, 3, 0], [3, 0, 0], [0, 4, 0], [4, 5, 0], [1, 5, 0], [5, 6, 0], [6, 2, 0], [3, 7, 1], [7, 6, 1], [7, 4, 1]],
  cuboid: [[0, 1, 0], [1, 2, 0], [2, 3, 0], [3, 0, 0], [0, 4, 0], [4, 5, 0], [1, 5, 0], [5, 6, 0], [6, 2, 0], [3, 7, 1], [7, 6, 1], [7, 4, 1]],
  pyramid: [[0, 3, 0], [0, 4, 0], [3, 4, 0], [3, 1, 0], [4, 2, 0], [1, 2, 1], [0, 1, 1], [0, 2, 1]],
  prism: [[0, 1, 0], [1, 2, 0], [2, 0, 0], [0, 3, 0], [1, 4, 0], [2, 5, 0], [3, 4, 1], [4, 5, 1], [5, 3, 1]],
  tetrahedron: [[0, 1, 0], [3, 0, 0], [3, 1, 0], [0, 2, 1], [1, 2, 1], [3, 2, 1]],
  pyraFrustum: [[0, 1, 0], [1, 2, 0], [3, 0, 0], [4, 5, 0], [5, 6, 0], [7, 4, 0], [0, 4, 0], [1, 5, 0], [2, 3, 1], [6, 7, 1], [3, 7, 1], [2, 6, 1]],
  obliquePrism: [[0, 1, 0], [1, 2, 0], [2, 3, 0], [3, 0, 0], [0, 4, 0], [4, 5, 0], [1, 5, 0], [5, 6, 0], [6, 2, 0], [3, 7, 1], [7, 6, 1], [7, 4, 1]],
  // 正八面体：到后顶点 5 的 4 条边 + 后方两条赤道边（0=T 1=B 2=L 3=R 4=F 5=K后）
  octahedron: [[0, 2, 0], [0, 3, 0], [0, 4, 0], [1, 2, 0], [1, 3, 0], [1, 4, 0], [2, 4, 0], [4, 3, 0], [0, 5, 1], [1, 5, 1], [5, 2, 1], [5, 3, 1]],
  // 正六棱柱：后两条竖棱 + 底面后半 3 条（0-5 上，6-11 下）
  hexPrism: [[0, 1, 0], [1, 2, 0], [2, 3, 0], [3, 4, 0], [4, 5, 0], [5, 0, 0], [6, 7, 0], [7, 8, 0], [8, 9, 0], [0, 6, 0], [1, 7, 0], [2, 8, 0], [3, 9, 0], [4, 10, 1], [5, 11, 1], [9, 10, 1], [10, 11, 1], [11, 6, 1]],
  // 正三棱台：底面后两条 + 后棱（0,1,2 底；3,4,5 顶）
  triFrustum: [[1, 2, 0], [3, 4, 0], [4, 5, 0], [5, 3, 0], [1, 4, 0], [2, 5, 0], [0, 1, 1], [2, 0, 1], [0, 3, 1]],
}

/** 生成某立体在当前 w/h/depth 下的默认归一化顶点（与原几何一致） */
export function solidVerts(kind: string, w: number, h: number, depth?: number): number[] {
  let c: number[][] = []
  if (kind === 'cube' || kind === 'cuboid') {
    const d = (depth ?? 0.4) * Math.min(w, h) * 0.4, dx = d, dy = -d * 0.8
    const side = kind === 'cube' ? Math.min(w, h) * 0.62 : 0
    const fw = kind === 'cube' ? side : w * 0.78, fh = kind === 'cube' ? side : h * 0.64
    const fx = (w - fw) / 2, fy = h * 0.16
    c = [[fx, fy], [fx + fw, fy], [fx + fw, fy + fh], [fx, fy + fh], [fx + dx, fy + dy], [fx + fw + dx, fy + dy], [fx + fw + dx, fy + fh + dy], [fx + dx, fy + fh + dy]]
  } else if (kind === 'pyramid') {
    const d = (depth ?? 0.4) * Math.min(w, h) * 0.4, dx = d, dy = -d * 0.8
    const wb = Math.min(w, h) * 0.42, cx = w / 2, botY = h * 0.78, apexY = h * 0.12
    c = [[cx, apexY], [cx - wb, botY - dy], [cx + wb, botY - dy], [cx - wb + dx, botY], [cx + wb + dx, botY]]
  } else if (kind === 'prism') {
    const d = (depth ?? 0.4) * Math.min(w, h) * 0.4, dx = d, dy = -d * 0.8
    const fx = w * 0.16, fy = h * 0.24, fw = w * 0.56, fh = h * 0.56
    c = [[fx, fy + fh], [fx + fw, fy + fh], [fx + fw / 2, fy], [fx + dx, fy + fh + dy], [fx + fw + dx, fy + fh + dy], [fx + fw / 2 + dx, fy + dy]]
  } else if (kind === 'tetrahedron') {
    const base = Math.min(w, h) * 0.42, cx = w / 2, cy = h / 2
    c = [[cx - base * 0.7, cy + base * 0.4], [cx + base * 0.7, cy + base * 0.4], [cx, cy - base * 0.4], [cx, cy - base * 0.9]]
  } else if (kind === 'pyraFrustum') {
    const mm = Math.min(w, h), d = (depth ?? 0.4) * mm * 0.4, dx = d, dy = -d * 0.8
    const wB = mm * 0.42, wT = mm * 0.26, cx = w / 2, botY = h * 0.74, topY = h * 0.26, bby = botY + dy, tby = topY + dy
    c = [[cx - wB, botY], [cx + wB, botY], [cx + wB + dx, bby], [cx - wB + dx, bby], [cx - wT, topY], [cx + wT, topY], [cx + wT + dx, tby], [cx - wT + dx, tby]]
  } else if (kind === 'octahedron') {
    const m = Math.min(w, h), cx = w / 2, cy = h / 2, rh = m * 0.34, rv = m * 0.40, e = m * 0.15
    c = [[cx, cy - rv], [cx, cy + rv], [cx - rh, cy], [cx + rh, cy], [cx, cy + e], [cx, cy - e]]
  } else if (kind === 'hexPrism') {
    const m = Math.min(w, h), cx = w / 2, rx = m * 0.30, ry = m * 0.13, topY = h * 0.24, botY = h * 0.78
    const hex = (cy: number) => {
      const a: number[][] = []
      for (let i = 0; i < 6; i++) {
        const ang = (i * Math.PI) / 3
        a.push([cx + rx * Math.cos(ang), cy + ry * Math.sin(ang)])
      }
      return a
    }
    c = [...hex(topY), ...hex(botY)]
  } else if (kind === 'obliquePrism') {
    const d = (depth ?? 0.4) * Math.min(w, h) * 0.4, dx = d * 1.7, dy = -d * 1.0
    const fx = w * 0.16, fy = h * 0.32, fw = w * 0.44, fh = h * 0.46
    c = [[fx, fy], [fx + fw, fy], [fx + fw, fy + fh], [fx, fy + fh], [fx + dx, fy + dy], [fx + fw + dx, fy + dy], [fx + fw + dx, fy + fh + dy], [fx + dx, fy + fh + dy]]
  } else if (kind === 'triFrustum') {
    const m = Math.min(w, h), cx = w / 2, rb = m * 0.40, rt = m * 0.24, topY = h * 0.26, botY = h * 0.76
    const tri = (cy: number, r: number) => {
      const a: number[][] = []
      for (let i = 0; i < 3; i++) {
        const ang = -Math.PI / 2 + (i * 2 * Math.PI) / 3
        a.push([cx + r * Math.cos(ang), cy + r * 0.5 * Math.sin(ang)])
      }
      return a
    }
    c = [...tri(botY, rb), ...tri(topY, rt)]
  }
  const out: number[] = []
  for (const p of c) out.push(p[0] / w, p[1] / h)
  return out
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
export function decodeLabel(s: string): { base: string; sub?: string; sup?: string } {
  const m = s.match(/^([^_^]*?)(?:_([^_^]*?))?(?:\^([^_^]*?))?$/)
  return m ? { base: m[1] || '', sub: m[2], sup: m[3] } : { base: s }
}
/** 顶点字母用的字体：教材 / 试卷上的数学字母是**衬线斜体**。
 *  不指定字体的话会落到界面默认的无衬线体上，看着像 UI 文字而不是数学标注，跟图形完全不搭。 */
export const LABEL_FONT = "'Times New Roman','Nimbus Roman','Liberation Serif',Cambria,Georgia,serif"

/** 顶点字母字号：跟着元素高度走 —— 原图里字母大多是图高的 7%~10%。
 *  固定 22px 在小图形上大得离谱、在大图形上又小得像注释。 */
export function labelFontSize(h: number) {
  return Math.max(11, Math.min(34, Math.round(h * 0.085)))
}
/** 字母默认压在顶点上方这么多像素（跟字号成比例，不然字号一大就贴到线上了） */
export function labelGap(fs: number) {
  return Math.round(fs * 0.62)
}
/** 一条标注大致占多宽（用来把它夹在框内，别被框裁掉） */
function labelHalfWidth(lab: string, fs: number, w: number) {
  return Math.min(w / 2, fs * 0.36 * Math.max(1, lab.length))
}

/** 顶点字母标注：A、A_1（下标）、B^2（上标）、A'…… 用 SVG tspan 排版 */
function labelSvg(s: string, x: number, y: number, color: string, fs: number): string {
  const { base, sub, sup } = decodeLabel(s)
  // 白色描边当垫底（paint-order: stroke = 先描边后填字），压在线上也读得清 ——
  // 原图里 A 就是直接压在 AB / AD 那两条虚线上的
  const halo = ' font-family="' + LABEL_FONT + '" stroke="#fff" stroke-width="' + (fs * 0.14).toFixed(1) + '" stroke-linejoin="round" paint-order="stroke"'
  let t = '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" font-size="' + fs + '" font-style="italic" fill="' + color + '" text-anchor="middle"' + halo + '>' + esc(base)
  if (sub) t += '<tspan dy="' + (fs * 0.4).toFixed(1) + '" font-size="' + (fs * 0.72).toFixed(1) + '">' + esc(sub) + '</tspan>'
  if (sup) t += '<tspan dy="' + (sub ? (-1 * fs).toFixed(1) : (-fs * 0.42).toFixed(1)) + '" font-size="' + (fs * 0.72).toFixed(1) + '">' + esc(sup) + '</tspan>'
  t += '</text>'
  return t
}

/** 依据归一化顶点渲染该立体。可见边实线、隐藏边虚线；支持逐边覆盖与顶点字母。 */
export function renderSolid(kind: string, pts: number[], w: number, h: number, stroke: string, strokeWidth: number, fillColor: string, _dsh: string, vlabels?: (string | null)[], edgeStyles?: (EdgeStyle | null)[], selVertex?: number, selEdge?: number, labelOffsets?: { dx: number; dy: number }[], faceStyles?: (FaceStyle | null)[], selFace?: number, mesh?: SolidMesh | null): string {
  const n = Math.floor(pts.length / 2)
  const s = strokeWidth || 2
  const P: [number, number][] = []
  for (let i = 0; i < n; i++) P.push([pts[i * 2] * w, pts[i * 2 + 1] * h])
  const fc = fillColor && fillColor !== 'transparent' ? fillColor : 'none'
  const baseFaces = FACES[kind] || []
  const faces = meshFaces(kind, mesh)
  const fop = (faces === baseFaces) ? (FOP[kind] || []) : faces.map(() => 0.8)
  const edges = meshEdges(kind, mesh)
  let out = '<g>'
  faces.forEach((face, fi) => {
    const ov = faceStyles ? faceStyles[fi] : null
    if (ov && ov.hidden) return
    const pp = face.map(i => P[i][0].toFixed(1) + ',' + P[i][1].toFixed(1)).join(' ')
    const col = (ov && ov.fill) || fc
    if (!col || col === 'none' || col === 'transparent') return
    const op = (ov && typeof ov.opacity === 'number') ? ov.opacity : (fop[fi] ?? 0.8)
    out += '<polygon points="' + pp + '" fill="' + col + '" stroke="none" opacity="' + op + '"/>'
  })
  if (selFace != null && selFace >= 0 && selFace < faces.length) {
    const pp = faces[selFace].map(i => P[i][0].toFixed(1) + ',' + P[i][1].toFixed(1)).join(' ')
    out += '<polygon points="' + pp + '" fill="#ff8f1f" fill-opacity="0.18" stroke="#ff8f1f" stroke-width="2"/>'
  }
  edges.forEach(([a, b, hid], ei) => {
    const ov = edgeStyles ? edgeStyles[ei] : null
    const col = (ov && ov.color) || stroke
    const wd = (ov && ov.width) || s
    let da = ''
    if (ov && ov.dash) da = ov.dash === 'dash' ? '6 5' : ov.dash === 'dot' ? '2 3' : ''
    else if (hid) da = '6 5'
    const x1 = P[a][0], y1 = P[a][1], x2 = P[b][0], y2 = P[b][1]
    // 箭头：线画到箭头根部，再补一个实心三角，箭头尖正好落在终点顶点上
    const arrow = !!(ov && ov.arrow) && (x1 !== x2 || y1 !== y2)
    const ang = arrow ? Math.atan2(y2 - y1, x2 - x1) : 0
    const al = arrow ? Math.max(9, wd * 3.4) : 0
    const ex = arrow ? x2 - al * Math.cos(ang) : x2
    const ey = arrow ? y2 - al * Math.sin(ang) : y2
    let attrs = 'stroke="' + col + '" stroke-width="' + wd + '" stroke-linecap="round" stroke-linejoin="round"'
    if (da) attrs += ' stroke-dasharray="' + da + '"'
    out += '<line ' + attrs + ' x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + ex.toFixed(1) + '" y2="' + ey.toFixed(1) + '"/>'
    if (arrow) {
      const aw = al * 0.42
      const px = (sign: number) => [
        x2 - al * Math.cos(ang) + sign * aw * Math.sin(ang),
        y2 - al * Math.sin(ang) - sign * aw * Math.cos(ang),
      ]
      const a1 = px(1), a2 = px(-1)
      out += '<polygon points="' + x2.toFixed(1) + ',' + y2.toFixed(1) + ' ' + a1[0].toFixed(1) + ',' + a1[1].toFixed(1) + ' ' + a2[0].toFixed(1) + ',' + a2[1].toFixed(1) + '" fill="' + col + '" stroke="none"/>'
    }
  })
  if (vlabels) {
    const fs = labelFontSize(h)
    const gap = labelGap(fs)
    for (let i = 0; i < vlabels.length && i < n; i++) {
      if (selVertex === i) continue
      const lab = vlabels[i]
      if (!lab) continue
      const off = labelOffsets && labelOffsets[i]
      // 夹在元素框内：原图里字母本来就在图内，但"从重心往外推"的默认偏移会把边上的字母推出去，
      // 推出去就被 SVG 裁掉（预设里 P 就是这么整块消失的）
      const half = labelHalfWidth(lab, fs, w)
      const lx = Math.max(half, Math.min(w - half, P[i][0] + ((off && off.dx) || 0) * w))
      const ly = Math.max(fs * 0.85, Math.min(h - fs * 0.12, P[i][1] - gap + ((off && off.dy) || 0) * h))
      out += labelSvg(lab, lx, ly, stroke, fs)
    }
  }
  if (selEdge != null && selEdge >= 0 && selEdge < edges.length) {
    const a = edges[selEdge][0], b = edges[selEdge][1]
    out += '<line x1="' + P[a][0].toFixed(1) + '" y1="' + P[a][1].toFixed(1) + '" x2="' + P[b][0].toFixed(1) + '" y2="' + P[b][1].toFixed(1) + '" stroke="#4f6ef5" stroke-width="8" stroke-linecap="round" opacity="0.3"/>'
  }
  if (selVertex != null && selVertex >= 0 && selVertex < n) {
    out += '<circle cx="' + P[selVertex][0].toFixed(1) + '" cy="' + P[selVertex][1].toFixed(1) + '" r="9" fill="none" stroke="#ff8f1f" stroke-width="3"/>'
  }
  out += '</g>'
  return out
}

export type { MathFigureElement }
