/**
 * 数学图形 → Asymptote 代码。
 *
 * 导出的是**二维** Asymptote：复刻图本身就是三维立体的一个投影，我们手里只有这张投影上的
 * 二维坐标，没有任何三维信息（要"还原"出 A(0,0,0)、B(2,0,0) 这种坐标得靠人），所以按所见即所得
 * 输出成 pair，不假装能给你 import three 的三维代码。
 *
 * 几何口径与画布渲染（renderSolid）逐条对齐：同样的边表、同样的虚实、同样的字母落点与夹取规则，
 * 所以 asy 编出来的图和编辑器里看到的是同一张。
 */
import type { MathFigureElement } from '@/types'
import { meshEdges, meshFaces, solidVerts, labelFontSize, labelGap } from '@/composables/solid3d'

export interface AsyOptions {
  /** 最长边对应多少个 asy 单位（默认 10，配合 size(10cm)） */
  unit?: number
  /** 是否输出面的填充（默认 true；没有填充色时本来也不会输出） */
  faces?: boolean
  /** 文件头注释里的标题 */
  title?: string
}

const PT_PER_CM = 28.3465

/** #rgb / #rrggbb → Asymptote 的 rgb(r,g,b)，取值 0~1 */
function asyColor(hex: string | undefined | null): string | null {
  if (!hex) return null
  const s = hex.trim()
  if (!s || s === 'none' || s === 'transparent') return null
  const m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  return 'rgb(' + rgb.map((v) => v.toFixed(3)).join(', ') + ')'
}

/** 顶点字母 → 合法变量名：A_1 → A1、B^2 → B2、A' → A；重名自动加序号 */
function varName(label: string | null | undefined, fallback: string, used: Set<string>): string {
  let base = (label || fallback).replace(/[_^'\s]/g, '').replace(/[^0-9A-Za-z]/g, '')
  if (!base) base = fallback
  if (/^[0-9]/.test(base)) base = 'P' + base
  let name = base
  let k = 2
  while (used.has(name)) name = base + k++
  used.add(name)
  return name
}

export function figureToAsy(el: MathFigureElement, opts: AsyOptions = {}): string {
  const unit = opts.unit ?? 10
  const w = el.w || 400
  const h = el.h || 300
  const kind = el.kind
  const pts = el.points && el.points.length >= 4
    ? el.points
    : solidVerts(kind, w, h, el.depth)
  const n = Math.floor(pts.length / 2)
  const S = unit / Math.max(w, h)                       // 像素 → asy 单位
  const toPt = (px: number) => +(px * S * PT_PER_CM).toFixed(2)
  const X = (i: number) => +(pts[i * 2] * w * S).toFixed(3)
  const Y = (i: number) => +((h - pts[i * 2 + 1] * h) * S).toFixed(3)   // asy 的 y 朝上

  const used = new Set<string>()
  const names: string[] = []
  for (let i = 0; i < n; i++) names.push(varName(el.vlabels?.[i], 'V' + (i + 1), used))

  const strokeCol = asyColor(el.stroke) || 'rgb(0, 0, 0)'
  const baseW = el.strokeWidth || 2.8
  const L: string[] = []
  L.push('/* ' + (opts.title || '数学图形') + '  ——  由 LJ-MathSlides 导出（二维 Asymptote）')
  L.push('   顶点字母 / 虚实 / 坐标与编辑器里所见一致。')
  L.push('   坐标单位是"最长边 = ' + unit + '"，要改整体大小请调 size(...)，别改坐标。')
  L.push('   注：顶点变量直接用了字母本身；若某个字母与 asy 内置常量同名（N / S / E / W / x / y / z），')
  L.push('   想用方位常量（如 label(..., N)）时把那个顶点变量改个名即可。 */')
  L.push('')
  L.push(w >= h ? 'size(' + unit + 'cm, 0);' : 'size(0, ' + unit + 'cm);')
  L.push('defaultpen(linewidth(' + toPt(baseW) + 'pt) + ' + strokeCol + ' + fontsize(' + toPt(labelFontSize(h)) + 'pt));')
  L.push('pen hidden = defaultpen + dashed;      // 被挡住的边')

  L.push('')
  L.push('// ---- 顶点 ----')
  for (let i = 0; i < n; i++) {
    const lab = el.vlabels?.[i]
    L.push('pair ' + names[i] + ' = (' + X(i) + ', ' + Y(i) + ');' + (lab ? '   // ' + lab : ''))
  }

  // 面：只有真的有填充色才输出
  if (opts.faces !== false) {
    const faces = meshFaces(kind, el.mesh)
    const fillBase = asyColor(el.fill)
    const rows: string[] = []
    faces.forEach((face, fi) => {
      const ov = el.faceStyles?.[fi]
      if (ov && ov.hidden) return
      const col = asyColor(ov && ov.fill) || fillBase
      if (!col || face.length < 3) return
      const op = ov && typeof ov.opacity === 'number' ? ov.opacity : 0.8
      rows.push('fill(' + face.map((i) => names[i]).join('--') + '--cycle, ' + col + ' + opacity(' + op.toFixed(2) + '));')
    })
    if (rows.length) { L.push(''); L.push('// ---- 面 ----'); L.push(...rows) }
  }

  // 边
  const edges = meshEdges(kind, el.mesh)
  const rows: string[] = []
  edges.forEach(([a, b, hid], ei) => {
    if (a >= n || b >= n || a === b) return
    const ov = el.edgeStyles?.[ei]
    const dash = ov && ov.dash ? ov.dash : (hid ? 'dash' : 'solid')
    const col = asyColor(ov && ov.color)
    const wd = ov && ov.width
    const parts: string[] = []
    if (wd && Math.abs(wd - baseW) > 0.01) parts.push('linewidth(' + toPt(wd) + 'pt)')
    if (col && col !== strokeCol) parts.push(col)
    if (dash === 'dot') parts.push('dotted')
    // 虚线：本来就觉得是虚的（hid）就直接用 hidden 那个 pen，省得每行都写 dashed
    const needDash = dash === 'dash'
    let pen = 'defaultpen'
    if (needDash && !parts.length) pen = 'hidden'
    else if (needDash) pen = parts.join(' + ') + ' + dashed'
    else if (parts.length) pen = parts.join(' + ')
    rows.push('draw(' + names[a] + '--' + names[b] + (pen === 'defaultpen' ? '' : ', ' + pen) + (ov && ov.arrow ? ', Arrow' : '') + ');')
  })
  if (rows.length) { L.push(''); L.push('// ---- 边 ----'); L.push(...rows) }

  // 顶点字母：落点按渲染器同一套规则（默认顶点上方 labelGap，再加拖拽偏移，最后夹在框内）
  const fs = labelFontSize(h)
  const gap = labelGap(fs)
  const labs: string[] = []
  for (let i = 0; i < n; i++) {
    const lab = el.vlabels?.[i]
    if (!lab) continue
    const off = el.labelOffsets?.[i]
    const half = Math.min(w / 2, fs * 0.36 * Math.max(1, lab.length))
    const lx = Math.max(half, Math.min(w - half, pts[i * 2] * w + (off ? off.dx : 0) * w))
    const ly = Math.max(fs * 0.85, Math.min(h - fs * 0.12, pts[i * 2 + 1] * h - gap + (off ? off.dy : 0) * h))
    // 渲染器把文本**基线**放在 ly；asy 的 label 锚在中心，往下补 0.35 个字高当视觉中心
    const x = +(lx * S).toFixed(3)
    const y = +((h - (ly - fs * 0.35)) * S).toFixed(3)
    labs.push('label("$' + lab + '$", (' + x + ', ' + y + '));')
  }
  if (labs.length) { L.push(''); L.push('// ---- 顶点字母 ----'); L.push(...labs) }
  L.push('')
  return L.join('\n')
}
