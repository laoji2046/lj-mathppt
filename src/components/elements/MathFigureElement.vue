<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { MathFigureElement, SlideElement } from '@/types'
import { lineDashCss } from '@/types'
import { shapeEdit } from '@/ui/shapeEditor'
import { SOLID_KINDS, SOLID_VCOUNT, renderSolid, solidVerts, meshEdges, meshFaces, decodeLabel, arcsSvg, vertexDotsSvg } from '@/composables/solid3d'
import { CONIC_KINDS, DEFAULT_PIECEWISE, FUNCTION_KINDS, conicFigure, conicLineDrag, conicLineHandles, conicPointDrag, conicPointHandles, customFigure, freqLineFigure, freqTableFigure, functionFigure, histogramFigure, piecewiseFigure, scatterFigure, setNumberlineFigure, vennFigure } from '@/composables/mathPlot'
import { isPlaneCtrlKind, planeDrag, planeHandles, planeSvg } from '@/composables/planeCtrl'
import { solidSel, selectSolidVertex, selectSolidEdge, selectSolidFace, clearSolidSel } from '@/composables/solidSel'

const props = defineProps<{ el: MathFigureElement; selected?: boolean; /** 预览用：等比缩放（contain）而不是拉伸（stretch） */ fit?: 'stretch' | 'contain' }>()
const emit = defineEmits<{ (e: 'update', patch: Partial<SlideElement>): void }>()

const box = ref<HTMLElement | null>(null)

/** 归一化顶点 → 默认形状 */
const DEF_POLY = [0.5, 0.08, 0.86, 0.29, 0.86, 0.71, 0.5, 0.92, 0.14, 0.71, 0.14, 0.29]
const DEF_BEZIER = [0.06, 0.75, 0.28, 0.08, 0.72, 0.92, 0.94, 0.25]

const editable = computed(() => props.el.kind === 'polygon' || props.el.kind === 'bezier' || (SOLID_KINDS as readonly string[]).includes(props.el.kind))
const showHandles = computed(() => editable.value && (!!props.selected || shapeEdit.value.id === props.el.id))

/** 当前顶点（归一化）；无存点用默认 */
const pts = computed(() => {
  const p = props.el.points
  if (props.el.kind === 'polygon') return p && p.length >= 6 ? p : DEF_POLY
  if (props.el.kind === 'bezier') return p && p.length >= 8 ? p : DEF_BEZIER
  const n = SOLID_VCOUNT[props.el.kind]
  if (n) {
    const ok = !!p && p.length >= 4 && p.length % 2 === 0 && (!!props.el.mesh || p.length === n * 2)
    return ok ? (p as number[]) : solidVerts(props.el.kind, props.el.w, props.el.h, props.el.depth)
  }
  return p ?? []
})

/** 弧 / 曲线图元 —— 单独一层画在图形之上，与导出共用 arcsSvg。
 *  **必须把元素的 points 传进去**：弦式曲线是"顶点下标 + 拱高"，没有顶点表就解不出几何，
 *  漏传的表现就是"弹窗里画得好好的，插入页面后弧不显示"（踩过）。 */
const arcSvg = computed(() => arcsSvg(props.el.arcs, props.el.w, props.el.h, props.el.stroke, props.el.strokeWidth, '6 5', props.el.points))
const innerHtml = computed(() => {
  const { w, h, stroke, strokeWidth, fill, kind, depth: dep } = props.el
  const s = strokeWidth || 2
  const dash = lineDashCss(props.el.strokeDash)
  const strokeAttrs = `stroke="${stroke}" stroke-width="${s}" stroke-linecap="round" stroke-linejoin="round"` + (dash ? ` stroke-dasharray="${dash}"` : '')
  const fillColor = fill && fill !== 'transparent' ? fill : 'none'
  const dashed = `stroke-dasharray="6 5"`
  const cx = w / 2, cy = h / 2, m = Math.min(w, h)

  function reg(n: number, rx: number, ry: number, rot = -Math.PI / 2) {
    const a: string[] = []
    for (let i = 0; i < n; i++) {
      const ang = rot + (i * 2 * Math.PI) / n
      a.push((cx + rx * Math.cos(ang)).toFixed(1) + ',' + (cy + ry * Math.sin(ang)).toFixed(1))
    }
    return a.join(' ')
  }
  function ptsStr(list: number[]) {
    const a: string[] = []
    for (let i = 0; i < list.length; i += 2) a.push((list[i] * w).toFixed(1) + ',' + (list[i + 1] * h).toFixed(1))
    return a.join(' ')
  }

  // 函数图像 / 圆锥曲线：走纯几何模块 mathPlot（真采样，非手工贝塞尔）
  // 自定义函数（空白）：表达式由用户给；解析不了就画一行红字提示（不静默空白）
  if (kind === 'custom') {
    const cfg = props.el.custom || { expr: 'x^2', x0: -4, x1: 4, y0: -2, y1: 6 }
    const svg = customFigure(cfg, w, h, stroke, s)
    if (svg === null) {
      const fs = Math.max(12, Math.min(w, h) * 0.05)
      return '<text x="' + w / 2 + '" y="' + h / 2 + '" text-anchor="middle" fill="#c0392b" font-size="' + fs.toFixed(1) + '">表达式无法解析</text>'
    }
    return svg
  }
  // 自定义分段函数：每段一个表达式 + 区间，端点实心/空心（与「自定义函数」同一套解析）
  if (kind === 'piecewiseFn') {
    const cfg = props.el.pw || DEFAULT_PIECEWISE
    const svg = piecewiseFigure(cfg, w, h, stroke, s)
    if (svg === null) {
      const fs2 = Math.max(12, Math.min(w, h) * 0.05)
      return '<text x="' + w / 2 + '" y="' + h / 2 + '" text-anchor="middle" fill="#c0392b" font-size="' + fs2.toFixed(1) + '">表达式无法解析</text>'
    }
    return svg
  }
  // 带控制点的平面图形：平行四边形（边长/夹角）、圆弧（圆心+圆心角 / 过三点）、指定半径的圆。
  // 没有 ctrl 时用默认控制点 —— 默认值与老版"平行四边形"的顶点**完全一致**，老图元外观不变。
  if (isPlaneCtrlKind(kind)) {
    return planeSvg(kind, w, h, props.el.ctrl, {
      stroke, sw: s, dash, fill: kind === 'parallelogram' || kind === 'circleR' ? fillColor : 'none',
    }, props.el.arcSweep)
  }
  // 【M2.11】频率分布直方图（统计图 ✓ 复刻真题里那种 ✓）
  if (kind === 'histogram') return histogramFigure(w, h, stroke, s, props.el.params, props.el.figLabels)
  if (kind === 'freqLine') return freqLineFigure(w, h, stroke, s, props.el.params, props.el.figLabels)   // 【M2.12】统计图 ✓
  if (kind === 'scatter') return scatterFigure(w, h, stroke, s, props.el.params, props.el.figLabels)
  if (kind === 'freqTable') return freqTableFigure(w, h, stroke, s, props.el.params, props.el.figLabels)  // 【M2.13】 ✓
  if (kind === 'vennFigure') return vennFigure(w, h, stroke, s, props.el.params)                        // 【M2.14】集合 ✓
  if (kind === 'setNumberline') return setNumberlineFigure(w, h, stroke, s, props.el.params)
  if (FUNCTION_KINDS.includes(kind)) return functionFigure(kind, w, h, stroke, s, props.el.params)
  if (CONIC_KINDS.includes(kind)) {
    return conicFigure(kind, w, h, stroke, s, fillColor, props.el.params,
      {
        conicStroke: props.el.conicStroke, axisColor: props.el.axisColor, lineColors: props.el.lineColors,
        pointLabels: props.el.pointLabels, pointLinks: props.el.pointLinks, lineLinks: props.el.lineLinks,
    pointColors: props.el.pointColors,
      })
  }

  // 三维多面体统一走顶点模型渲染（支持拖拽顶点编辑）
  if (SOLID_VCOUNT[kind]) {
    // 字母始终画；顶点圆点默认**不画**（只有勾了 showDots 才画，保持原来的观感）
    const solid = renderSolid(kind, pts.value, w, h, stroke, s, fillColor, dashed, props.el.vlabels, props.el.edgeStyles, solidSel.elementId === props.el.id ? (solidSel.vertex ?? undefined) : undefined, solidSel.elementId === props.el.id ? (solidSel.edge ?? undefined) : undefined, props.el.labelOffsets, props.el.faceStyles, solidSel.elementId === props.el.id ? (solidSel.face ?? undefined) : undefined, props.el.mesh)
    if (props.el.showDots !== true) return solid
    // 顶点小圆点：与三维弹窗预览共用 vertexDotsSvg（只此一份实现）
    return solid + vertexDotsSvg(pts.value, w, h, stroke)
  }

  switch (kind) {
    // 抛物线 / 正余弦 / 指数 / 对数：旧的手绘贝塞尔版本已删除，
    // 统一由本函数开头的 FUNCTION_KINDS 分支（mathPlot.functionFigure）真采样绘制。
    case 'coordinate': {
      const axis = `stroke="${stroke}" stroke-width="${s}"`
      let ticks = ''
      for (let i = 1; i < 4; i++) {
        const tx = (w * i) / 4, ty = (h * i) / 4
        ticks += `<line x1="${tx}" y1="${h - 10}" x2="${tx}" y2="${h + 10}" ${axis}/>` +
                 `<line x1="10" y1="${ty}" x2="-10" y2="${ty}" ${axis}/>`
      }
      return `<g>` +
        `<line x1="0" y1="${h}" x2="${w}" y2="${h}" ${axis}/>` +
        `<line x1="0" y1="${h}" x2="0" y2="0" ${axis}/>` +
        `<polygon points="${w},${h} ${w - 12},${h - 6} ${w - 12},${h + 6}" fill="${stroke}"/>` +
        `<polygon points="0,0 12,0 0,12" fill="${stroke}"/>` + ticks + '</g>'
    }
    case 'numberline': {
      const cy = h / 2
      const axis = `stroke="${stroke}" stroke-width="${s}"`
      let ticks = ''
      for (let i = 0; i <= 6; i++) { const tx = (w * i) / 6; ticks += `<line x1="${tx}" y1="${cy - 10}" x2="${tx}" y2="${cy + 10}" ${axis}/>` }
      return `<g>` +
        `<line x1="0" y1="${cy}" x2="${w}" y2="${cy}" ${axis}/>` +
        `<polygon points="0,${cy} 12,${cy - 6} 12,${cy + 6}" fill="${stroke}"/>` +
        `<polygon points="${w},${cy} ${w - 12},${cy - 6} ${w - 12},${cy + 6}" fill="${stroke}"/>` + ticks + '</g>'
    }
    case 'venn': {
      const r = m * 0.26
      return `<circle cx="${w * 0.36}" cy="${cy}" r="${r}" ${strokeAttrs} fill="${fillColor}"/>` +
             `<circle cx="${w * 0.64}" cy="${cy}" r="${r}" ${strokeAttrs} fill="${fillColor}"/>`
    }
    case 'righttriangle':
      return `<polygon points="0,${h} ${w},${h} ${w * 0.12},${h * 0.05}" ${strokeAttrs} fill="${fillColor}"/>`
    case 'angle': {
      const ox = w * 0.12, oy = h * 0.9, len = m * 0.8
      return `<g>` +
        `<line x1="${ox}" y1="${oy}" x2="${ox + len}" y2="${oy}" ${strokeAttrs}/>` +
        `<line x1="${ox}" y1="${oy}" x2="${ox}" y2="${oy - len}" ${strokeAttrs}/>` +
        `<path d="M ${ox + len * 0.25} ${oy} A ${len * 0.25} ${len * 0.25} 0 0 1 ${ox} ${oy - len * 0.25}" ${strokeAttrs} fill="none"/>` + '</g>'
    }
    case 'semicircle':
      return `<path d="M 0 ${h} A ${w / 2} ${h} 0 0 1 ${w} ${h}" ${strokeAttrs} fill="${fillColor}"/>`
    // ---- 常见平面几何 ----
    case 'triangle':
      return `<polygon points="0,${h} ${w},${h} ${w * 0.42},0" ${strokeAttrs} fill="${fillColor}"/>`
    case 'rectangle':
      return `<rect x="${w * 0.02}" y="${h * 0.02}" width="${w * 0.96}" height="${h * 0.96}" ${strokeAttrs} fill="${fillColor}"/>`
    case 'circle':
      return `<circle cx="${cx}" cy="${cy}" r="${m * 0.46}" ${strokeAttrs} fill="${fillColor}"/>`
    case 'pentagon':
      return `<polygon points="${reg(5, m * 0.44, m * 0.44)}" ${strokeAttrs} fill="${fillColor}"/>`
    case 'hexagon':
      return `<polygon points="${reg(6, m * 0.46, m * 0.46)}" ${strokeAttrs} fill="${fillColor}"/>`
    case 'rhombus':
      return `<polygon points="${cx},0 ${w}, ${cy} ${cx},${h} 0,${cy}" ${strokeAttrs} fill="${fillColor}"/>`
    // ⭐ 风筝形：上顶点 / 左右同高 / 下顶点 ✓（参考图里我们缺的那一个 ✓）
    case 'kite':
      return `<polygon points="${cx},0 ${w},${h * 0.38} ${cx},${h} 0,${h * 0.38}" ${strokeAttrs} fill="${fillColor}"/>`
    // ⭐ 斜矩形：把矩形整体斜一点 ✓（参考图里的 Angled Rectangle ✓）
    case 'angledrect':
      return `<polygon points="${w * 0.22},0 ${w * 0.98},${h * 0.14} ${w * 0.78},${h} ${w * 0.02},${h * 0.86}" ${strokeAttrs} fill="${fillColor}"/>`
    case 'parallelogram':
      return `<polygon points="${w * 0.22},0 ${w},0 ${w * 0.78},${h} 0,${h}" ${strokeAttrs} fill="${fillColor}"/>`
    case 'trapezoid':
      return `<polygon points="${w * 0.24},0 ${w * 0.76},0 ${w},${h} 0,${h}" ${strokeAttrs} fill="${fillColor}"/>`
    case 'star': {
      const pts: string[] = []
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI) / 5
        const r = i % 2 === 0 ? m * 0.46 : m * 0.2
        pts.push((cx + r * Math.cos(ang)).toFixed(1) + ',' + (cy + r * Math.sin(ang)).toFixed(1))
      }
      return `<polygon points="${pts.join(' ')}" ${strokeAttrs} fill="${fillColor}"/>`
    }
    case 'cube': case 'cuboid': {
      const d = (dep ?? 0.4) * m * 0.4, dx = d, dy = -d * 0.8
      const side = kind === 'cube' ? Math.min(w, h) * 0.62 : 0
      const fw = kind === 'cube' ? side : w * 0.78
      const fh = kind === 'cube' ? side : h * 0.64
      const fx = (w - fw) / 2, fy = h * 0.16
      const front = fx + ',' + (fy + fh) + ' ' + (fx + fw) + ',' + (fy + fh) + ' ' + (fx + fw) + ',' + fy + ' ' + fx + ',' + fy
      const top = fx + ',' + fy + ' ' + (fx + fw) + ',' + fy + ' ' + (fx + fw + dx) + ',' + (fy + dy) + ' ' + (fx + dx) + ',' + (fy + dy)
      const right = (fx + fw) + ',' + fy + ' ' + (fx + fw + dx) + ',' + (fy + dy) + ' ' + (fx + fw + dx) + ',' + (fy + fh + dy) + ' ' + (fx + fw) + ',' + (fy + fh)
      return '<g ' + strokeAttrs + ' fill="' + fillColor + '"><polygon points="' + top + '" opacity="0.8"/><polygon points="' + right + '" opacity="0.62"/><polygon points="' + front + '"/>' +
        '<line ' + dashed + ' x1="' + fx + '" y1="' + (fy + fh) + '" x2="' + (fx + dx) + '" y2="' + (fy + fh + dy) + '"/>' +
        '<line ' + dashed + ' x1="' + (fx + dx) + '" y1="' + (fy + fh + dy) + '" x2="' + (fx + fw + dx) + '" y2="' + (fy + fh + dy) + '"/>' +
        '<line ' + dashed + ' x1="' + (fx + dx) + '" y1="' + (fy + fh + dy) + '" x2="' + (fx + dx) + '" y2="' + (fy + dy) + '"/></g>'
    }
    case 'cylinder': {
      const rx = m * 0.36, ry = m * 0.12, cx = w / 2, topY = h * 0.2, botY = h * 0.78
      return '<g ' + strokeAttrs + ' fill="' + fillColor + '">' +
        '<line x1="' + (cx - rx) + '" y1="' + topY + '" x2="' + (cx - rx) + '" y2="' + botY + '"/>' +
        '<line x1="' + (cx + rx) + '" y1="' + topY + '" x2="' + (cx + rx) + '" y2="' + botY + '"/>' +
        '<path ' + dashed + ' d="M ' + (cx - rx) + ' ' + botY + ' A ' + rx + ' ' + ry + ' 0 0 1 ' + (cx + rx) + ' ' + botY + '"/>' +
        '<path d="M ' + (cx - rx) + ' ' + botY + ' A ' + rx + ' ' + ry + ' 0 0 0 ' + (cx + rx) + ' ' + botY + '"/>' +
        '<ellipse cx="' + cx + '" cy="' + topY + '" rx="' + rx + '" ry="' + ry + '"/></g>'
    }
    case 'cone': {
      const rx = m * 0.38, ry = m * 0.13, cx = w / 2, botY = h * 0.8, apexY = h * 0.12
      return '<g ' + strokeAttrs + ' fill="' + fillColor + '">' +
        '<path d="M ' + (cx - rx) + ' ' + botY + ' A ' + rx + ' ' + ry + ' 0 0 0 ' + (cx + rx) + ' ' + botY + ' L ' + cx + ' ' + apexY + ' Z"/>' +
        '<path ' + dashed + ' d="M ' + (cx - rx) + ' ' + botY + ' A ' + rx + ' ' + ry + ' 0 0 1 ' + (cx + rx) + ' ' + botY + '"/></g>'
    }
    case 'sphere': {
      const r = m * 0.42, cx = w / 2, cy = h / 2, ry = r * 0.34
      return '<g ' + strokeAttrs + ' fill="' + fillColor + '">' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '"/>' +
        '<path ' + dashed + ' d="M ' + (cx - r) + ' ' + cy + ' A ' + r + ' ' + ry + ' 0 0 1 ' + (cx + r) + ' ' + cy + '"/>' +
        '<path d="M ' + (cx - r) + ' ' + cy + ' A ' + r + ' ' + ry + ' 0 0 0 ' + (cx + r) + ' ' + cy + '"/>' +
        '<path ' + dashed + ' d="M ' + cx + ' ' + (cy - r) + ' A ' + (r * 0.34) + ' ' + r + ' 0 0 0 ' + cx + ' ' + (cy + r) + '"/>' +
        '<path d="M ' + cx + ' ' + (cy - r) + ' A ' + (r * 0.34) + ' ' + r + ' 0 0 1 ' + cx + ' ' + (cy + r) + '"/></g>'
    }
    case 'pyramid': {
      const d = (dep ?? 0.4) * m * 0.4, dx = d, dy = -d * 0.8
      const wb = m * 0.42, cx = w / 2, botY = h * 0.78, apexY = h * 0.12
      const b1 = (cx - wb) + ',' + (botY - dy), b2 = (cx + wb) + ',' + (botY - dy)
      const f1 = (cx - wb + dx) + ',' + botY, f2 = (cx + wb + dx) + ',' + botY
      const ap = cx + ',' + apexY
      return '<g ' + strokeAttrs + '>' +
        '<polygon points="' + b1 + ' ' + b2 + ' ' + f2 + ' ' + f1 + '" fill="' + fillColor + '" stroke="none" opacity="0.7"/>' +
        '<polygon points="' + ap + ' ' + f1 + ' ' + f2 + '" fill="' + fillColor + '" stroke="none" opacity="0.95"/>' +
        '<line x1="' + f1 + '" x2="' + f2 + '"/><line x1="' + ap + '" x2="' + f1 + '"/><line x1="' + ap + '" x2="' + f2 + '"/>' +
        '<line x1="' + f1 + '" x2="' + b1 + '"/><line x1="' + f2 + '" x2="' + b2 + '"/>' +
        '<line ' + dashed + ' x1="' + b1 + '" x2="' + b2 + '"/><line ' + dashed + ' x1="' + ap + '" x2="' + b1 + '"/><line ' + dashed + ' x1="' + ap + '" x2="' + b2 + '"/></g>'
    }
    case 'prism': {
      const d = (dep ?? 0.4) * m * 0.4, dx = d, dy = -d * 0.8
      const fx = w * 0.16, fy = h * 0.24, fw = w * 0.56, fh = h * 0.56
      const triF = fx + ',' + (fy + fh) + ' ' + (fx + fw) + ',' + (fy + fh) + ' ' + (fx + fw / 2) + ',' + fy
      const triB = (fx + dx) + ',' + (fy + fh + dy) + ' ' + (fx + fw + dx) + ',' + (fy + fh + dy) + ' ' + (fx + fw / 2 + dx) + ',' + (fy + dy)
      return '<g ' + strokeAttrs + '>' +
        '<polygon points="' + triB + '" fill="' + fillColor + '" stroke="none" opacity="0.5"/>' +
        '<polygon points="' + triB + '" fill="none" ' + dashed + '/>' +
        '<polygon points="' + triF + '" fill="' + fillColor + '" stroke="none" opacity="0.9"/>' +
        '<polygon points="' + triF + '" fill="none"/>' +
        '<line x1="' + fx + ',' + (fy + fh) + '" x2="' + (fx + dx) + ',' + (fy + fh + dy) + '"/><line x1="' + (fx + fw) + ',' + (fy + fh) + '" x2="' + (fx + fw + dx) + ',' + (fy + fh + dy) + '"/><line x1="' + (fx + fw / 2) + ',' + fy + '" x2="' + (fx + fw / 2 + dx) + ',' + (fy + dy) + '"/></g>'
    }
    case 'tetrahedron': {
      const cx = w / 2, cy = h / 2, base = m * 0.42
      const p0 = (cx - base * 0.7) + ',' + (cy + base * 0.4), p1 = (cx + base * 0.7) + ',' + (cy + base * 0.4)
      const p2 = cx + ',' + (cy - base * 0.4), p3 = cx + ',' + (cy - base * 0.9)
      return '<g ' + strokeAttrs + '>' +
        '<polygon points="' + p0 + ' ' + p1 + ' ' + p2 + '" fill="' + fillColor + '" stroke="none" opacity="0.4"/>' +
        '<polygon points="' + p3 + ' ' + p0 + ' ' + p2 + '" fill="' + fillColor + '" stroke="none" opacity="0.86"/>' +
        '<polygon points="' + p3 + ' ' + p1 + ' ' + p0 + '" fill="' + fillColor + '" stroke="none" opacity="0.76"/>' +
        '<polygon points="' + p3 + ' ' + p2 + ' ' + p1 + '" fill="' + fillColor + '" stroke="none" opacity="0.66"/>' +
        '<line x1="' + p0 + '" x2="' + p1 + '"/><line x1="' + p3 + '" x2="' + p0 + '"/><line x1="' + p3 + '" x2="' + p1 + '"/>' +
        '<line ' + dashed + ' x1="' + p0 + '" x2="' + p2 + '"/><line ' + dashed + ' x1="' + p1 + '" x2="' + p2 + '"/><line ' + dashed + ' x1="' + p3 + '" x2="' + p2 + '"/></g>'
    }
    case 'frustum': {
      const mm = Math.min(w, h), rB = mm * 0.4, rT = mm * 0.24, ryB = mm * 0.12, ryT = mm * 0.09, cx = w / 2, topY = h * 0.28, botY = h * 0.76
      const frB = 'M ' + (cx - rB) + ' ' + botY + ' A ' + rB + ' ' + ryB + ' 0 0 0 ' + (cx + rB) + ' ' + botY
      return '<g ' + strokeAttrs + ' fill="' + fillColor + '">' +
        '<line x1="' + (cx - rB) + '" y1="' + botY + '" x2="' + (cx - rT) + '" y2="' + topY + '"/>' +
        '<line x1="' + (cx + rB) + '" y1="' + botY + '" x2="' + (cx + rT) + '" y2="' + topY + '"/>' +
        '<path ' + dashed + ' d="M ' + (cx - rB) + ' ' + botY + ' A ' + rB + ' ' + ryB + ' 0 0 1 ' + (cx + rB) + ' ' + botY + '"/>' +
        '<path d="' + frB + '"/>' +
        '<ellipse cx="' + cx + '" cy="' + topY + '" rx="' + rT + '" ry="' + ryT + '"/></g>'
    }
    case 'pyraFrustum': {
      const mm = Math.min(w, h), d = (dep ?? 0.4) * mm * 0.4, dx = d, dy = -d * 0.8
      const wB = mm * 0.42, wT = mm * 0.26, cx = w / 2, botY = h * 0.74, topY = h * 0.26, bby = botY + dy, tby = topY + dy
      const bFL = (cx - wB) + ',' + botY, bFR = (cx + wB) + ',' + botY, bBL = (cx - wB + dx) + ',' + bby, bBR = (cx + wB + dx) + ',' + bby
      const tFL = (cx - wT) + ',' + topY, tFR = (cx + wT) + ',' + topY, tBL = (cx - wT + dx) + ',' + tby, tBR = (cx + wT + dx) + ',' + tby
      return '<g ' + strokeAttrs + '>' +
        '<polygon points="' + bFL + ' ' + bFR + ' ' + bBR + ' ' + bBL + '" fill="' + fillColor + '" stroke="none" opacity="0.6"/>' +
        '<polygon points="' + tFL + ' ' + tFR + ' ' + tBR + ' ' + tBL + '" fill="' + fillColor + '" stroke="none" opacity="0.9"/>' +
        '<line x1="' + bFL + '" x2="' + bFR + '"/><line x1="' + bFL + '" x2="' + bBL + '"/><line x1="' + bFR + '" x2="' + bBR + '"/>' +
        '<line x1="' + tFL + '" x2="' + tFR + '"/><line x1="' + tFL + '" x2="' + tBL + '"/><line x1="' + tFR + '" x2="' + tBR + '"/>' +
        '<line x1="' + bFL + '" x2="' + tFL + '"/><line x1="' + bFR + '" x2="' + tFR + '"/>' +
        '<line ' + dashed + ' x1="' + bBL + '" x2="' + bBR + '"/><line ' + dashed + ' x1="' + bBL + '" x2="' + tBL + '"/>' +
        '<line ' + dashed + ' x1="' + tBL + '" x2="' + tBR + '"/><line ' + dashed + ' x1="' + bBR + '" x2="' + tBR + '"/></g>'
    }
    case 'dihedral': {
      const mm = Math.min(w, h), d = (dep ?? 0.4) * mm * 0.5, cx = w / 2, hingeY = h * 0.5
      const p1 = '0,' + hingeY + ' ' + (cx) + ',' + hingeY + ' ' + cx + ',' + (hingeY - h * 0.3) + ' 0,' + (hingeY - h * 0.3)
      const p2 = cx + ',' + hingeY + ' ' + (cx + d) + ',' + (hingeY - d * 0.8) + ' ' + (cx + d) + ',' + (hingeY - d * 0.8 - h * 0.3) + ' ' + cx + ',' + (hingeY - h * 0.3)
      return '<g ' + strokeAttrs + ' fill="' + fillColor + '"><polygon points="' + p1 + '" opacity="0.9"/><polygon points="' + p2 + '" opacity="0.7"/><line x1="0" y1="' + hingeY + '" x2="' + w + '" y2="' + hingeY + '"/></g>'
    }
    case 'isoaxis': {
      const mm = Math.min(w, h), cx = w / 2, cy = h / 2, L = mm * 0.36
      return '<g ' + strokeAttrs + ' fill="none">' +
        '<line x1="' + cx + '" y1="' + cy + '" x2="' + cx + '" y2="' + (cy - L) + '"/>' +
        '<line x1="' + cx + '" y1="' + cy + '" x2="' + (cx + L * 0.87) + '" y2="' + (cy + L * 0.5) + '"/>' +
        '<line x1="' + cx + '" y1="' + cy + '" x2="' + (cx - L * 0.87) + '" y2="' + (cy + L * 0.5) + '"/>' +
        '<polygon points="' + cx + ',' + (cy - L) + ' ' + (cx - 7) + ',' + (cy - L + 12) + ' ' + (cx + 7) + ',' + (cy - L + 12) + '" fill="' + stroke + '"/></g>'
    }
    // ---- 辅助线 / 标注 ----
    case 'auxLine':
      return '<line x1="' + (w * 0.04) + '" y1="' + (h * 0.6) + '" x2="' + (w * 0.96) + '" y2="' + (h * 0.6) + '" ' + strokeAttrs + ' stroke-dasharray="7 5" fill="none"/>'
    case 'rightAngle': {
      const x0 = w * 0.18, y0 = h * 0.86, L = Math.min(w, h) * 0.72, t = Math.min(w, h) * 0.16
      return '<line x1="' + x0 + '" y1="' + y0 + '" x2="' + (x0 + L) + '" y2="' + y0 + '" ' + strokeAttrs + ' fill="none"/>' +
        '<line x1="' + x0 + '" y1="' + y0 + '" x2="' + x0 + '" y2="' + (y0 - L) + '" ' + strokeAttrs + ' fill="none"/>' +
        '<path d="M ' + (x0 + t) + ' ' + y0 + ' L ' + (x0 + t) + ' ' + (y0 - t) + ' L ' + x0 + ' ' + (y0 - t) + '" ' + strokeAttrs + ' fill="none"/>'
    }
    case 'equalMark': {
      const y = h * 0.5, x1 = w * 0.12, x2 = w * 0.88, tk = Math.min(w, h) * 0.2, g = Math.min(w, h) * 0.06
      return '<line x1="' + x1 + '" y1="' + y + '" x2="' + x2 + '" y2="' + y + '" ' + strokeAttrs + ' fill="none"/>' +
        '<line x1="' + (w * 0.5 - g) + '" y1="' + (y - tk) + '" x2="' + (w * 0.5 - g) + '" y2="' + (y + tk) + '" ' + strokeAttrs + ' fill="none"/>' +
        '<line x1="' + (w * 0.5 + g) + '" y1="' + (y - tk) + '" x2="' + (w * 0.5 + g) + '" y2="' + (y + tk) + '" ' + strokeAttrs + ' fill="none"/>'
    }
    case 'parallelMark': {
      const y = h * 0.5, tk = Math.min(w, h) * 0.22, g = Math.min(w, h) * 0.07
      return '<line x1="' + (w * 0.5 - g) + '" y1="' + (y + tk) + '" x2="' + (w * 0.5 - g) + '" y2="' + (y - tk) + '" ' + strokeAttrs + ' fill="none"/>' +
        '<line x1="' + (w * 0.5 + g) + '" y1="' + (y + tk) + '" x2="' + (w * 0.5 + g) + '" y2="' + (y - tk) + '" ' + strokeAttrs + ' fill="none"/>'
    }
    case 'angleArc': {
      const ox = w * 0.16, oy = h * 0.84, L = Math.min(w, h) * 0.72, r = Math.min(w, h) * 0.3, a2 = -Math.PI / 3
      const ex = ox + L * Math.cos(a2), ey = oy + L * Math.sin(a2)
      const ax = ox + r * Math.cos(a2), ay = oy + r * Math.sin(a2)
      return '<line x1="' + ox + '" y1="' + oy + '" x2="' + (ox + L) + '" y2="' + oy + '" ' + strokeAttrs + ' fill="none"/>' +
        '<line x1="' + ox + '" y1="' + oy + '" x2="' + ex + '" y2="' + ey + '" ' + strokeAttrs + ' fill="none"/>' +
        '<path d="M ' + (ox + r) + ' ' + oy + ' A ' + r + ' ' + r + ' 0 0 0 ' + ax + ' ' + ay + '" ' + strokeAttrs + ' fill="none"/>'
    }
    case 'section': {
      const pp = (w * 0.2) + ',' + (h * 0.36) + ' ' + (w * 0.8) + ',' + (h * 0.26) + ' ' + (w * 0.8) + ',' + (h * 0.72) + ' ' + (w * 0.2) + ',' + (h * 0.82)
      return '<polygon points="' + pp + '" ' + strokeAttrs + ' fill="' + fillColor + '" opacity="0.55"/>'
    }
    case 'polygon':
      return `<polygon points="${ptsStr(pts.value || DEF_POLY)}" ${strokeAttrs} fill="${fillColor}"/>`
    case 'bezier': {
      const b = pts.value || DEF_BEZIER
      return `<path d="M ${b[0] * w} ${b[1] * h} C ${b[2] * w} ${b[3] * h}, ${b[4] * w} ${b[5] * h}, ${b[6] * w} ${b[7] * h}" ${strokeAttrs} fill="none"/>`
    }
    default:
      return ''
  }
})

// ---- 顶点编辑拖拽（借鉴 Bento：双击顶点删除 / 双击边线插入顶点） ----
const dragging = ref(false)
let dragIdx = -1
let lastDown = { idx: -1, t: 0 }
let moved = false
let downPt: [number, number] | null = null
function normPt(e: { clientX: number; clientY: number }): [number, number] {
  const r = box.value?.getBoundingClientRect()
  if (!r || !r.width || !r.height) return [0, 0]
  return [
    Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
    Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
  ]
}
/** 双击同一句柄（进入顶点编辑后）→ 删除该顶点，多边形最少保留 3 个顶点 */
function onHandleDown(e: PointerEvent, i: number) {
  e.stopPropagation()
  if (props.el.kind === 'polygon' && shapeEdit.value.id === props.el.id && lastDown.idx === i && e.timeStamp - lastDown.t < 400) {
    lastDown.idx = -1
    const p = [...(pts.value || DEF_POLY)]
    if (p.length / 2 > 3) { p.splice(i * 2, 2); emit('update', { points: p }) }
    return
  }
  moved = false; downPt = [e.clientX, e.clientY]
  lastDown = { idx: i, t: e.timeStamp }
  const t = e.currentTarget as HTMLElement
  try { t.setPointerCapture(e.pointerId) } catch {}
  dragIdx = i
  dragging.value = true
}
function onHandleMove(e: PointerEvent, i: number) {
  if (!dragging.value || dragIdx < 0) return
  if (!moved && downPt && Math.hypot(e.clientX - downPt[0], e.clientY - downPt[1]) > 4) moved = true
  const [nx, ny] = normPt(e)
  const p = [...(pts.value || DEF_POLY)]
  if (i < 0 || i * 2 + 1 >= p.length) return      // 下标越界就什么都不写，别往 points 里塞 NaN
  p[i * 2] = nx; p[i * 2 + 1] = ny
  emit('update', { points: p } as Partial<SlideElement>)
}
function onHandleUp() {
  if (!moved && dragIdx >= 0 && SOLID_VCOUNT[props.el.kind]) {
    selectSolidVertex(props.el.id, dragIdx)
  }
  dragging.value = false; dragIdx = -1
}

// ---- 「圆锥曲线 + 多条线」的**端点拖拽** ----
// 手柄就是每条线在当前窗口里的两个可见端点（公式见 mathPlot 的 conicLineHandles）；
// 拖一个端点 = 另一端固定、反算 k/m（直线 2 个自由度，两点正好定死）。线段还要跟着改起终点 x。
const lineHandles = computed(() =>
  CONIC_KINDS.includes(props.el.kind) ? conicLineHandles(props.el.kind, props.el.w, props.el.h, props.el.params, props.el.pointLinks, props.el.lineLinks) : [])
const showLineHandles = computed(() => !!props.selected && lineHandles.value.length > 0)
let dragLine: { i: number; which: 0 | 1 } | null = null
/** 拖动过程中把被抓手柄钉在手指下面。
 *  ⚠ 整条直线的端点是由**窗口裁剪**算出来的：把端点拖到图形内部后，线会继续延伸到框边，
 *    手柄随即"跑掉"。所以拖动期间用实际指针位置画这个手柄，松手后再回到裁剪位置。 */
const dragPt = ref<{ x: number; y: number } | null>(null)
function lineHandlePos(h: { i: number; which: 0 | 1; x: number; y: number }) {
  if (dragPt.value && dragLine && dragLine.i === h.i && dragLine.which === h.which) return dragPt.value
  return { x: h.x, y: h.y }
}
function onLineHandleDown(e: PointerEvent, i: number, which: 0 | 1) {
  e.stopPropagation()
  const t = e.currentTarget as HTMLElement
  try { t.setPointerCapture(e.pointerId) } catch { /* 忽略 */ }
  dragLine = { i, which }
  dragPt.value = null
  dragging.value = true
}
function onLineHandleMove(e: PointerEvent) {
  if (!dragLine || !dragging.value) return
  const r = box.value?.getBoundingClientRect()
  if (!r || !r.width || !r.height) return
  // ⚠ **不夹在元素框内** —— 原来钳到 [0,1] ✗，于是端点只能停在框内、线看起来"被一个矩形框住"（用户实报 ✓）。
  //   允许拖到框外：线会一直延伸到框边（可见部分由 SVG 的 viewBox 裁掉 ✓，参数里记的是真实位置 ✓）。
  const px = ((e.clientX - r.left) / r.width) * props.el.w
  const py = ((e.clientY - r.top) / r.height) * props.el.h
  dragPt.value = { x: px, y: py }
  const patch = conicLineDrag(props.el.kind, props.el.w, props.el.h, props.el.params || {}, dragLine.i, dragLine.which, px, py)
  if (Object.keys(patch).length) {
    emit('update', { params: { ...(props.el.params || {}), ...patch } } as Partial<SlideElement>)
  }
}
function onLineHandleUp() { dragLine = null; dragPt.value = null; dragging.value = false }

// ---- 圆锥曲线「标注点」的拖拽（与直线端点同一套做法） ----
const pointHandles = computed(() =>
  CONIC_KINDS.includes(props.el.kind) ? conicPointHandles(props.el.kind, props.el.w, props.el.h, props.el.params, props.el.pointLinks, props.el.lineLinks) : [])
const showPointHandles = computed(() => !!props.selected && pointHandles.value.length > 0)
let dragPointIdx = -1
const dragPointPos = ref<{ x: number; y: number } | null>(null)
function pointHandlePos(h: { i: number; x: number; y: number }) {
  // ⚠ 不把标注点手柄钉在指针上：它的位置本来就是**现算的真实位置**（动点在曲线上、交点在锥线上），
  //   钉住反而会让手柄离开曲线 ✗（直线端点那次需要钉住，是因为裁剪端点会"跑掉"，情况不同）
  return { x: h.x, y: h.y }
}
function onPointHandleDown(e: PointerEvent, i: number) {
  e.stopPropagation()
  const t = e.currentTarget as HTMLElement
  try { t.setPointerCapture(e.pointerId) } catch { /* 忽略 */ }
  dragPointIdx = i
  dragPointPos.value = null
  dragging.value = true
}
function onPointHandleMove(e: PointerEvent) {
  if (dragPointIdx < 0 || !dragging.value) return
  const r = box.value?.getBoundingClientRect()
  if (!r || !r.width || !r.height) return
  const px = ((e.clientX - r.left) / r.width) * props.el.w
  const py = ((e.clientY - r.top) / r.height) * props.el.h
  dragPointPos.value = { x: px, y: py }
  // 返回的是**元素补丁**：普通点写 params，动点改 pointLinks（曲线参数 t）
  const patch = conicPointDrag(props.el.kind, props.el.w, props.el.h, props.el.params || {}, dragPointIdx, px, py, props.el.pointLinks, props.el.lineLinks)
  const out: Record<string, unknown> = {}
  if (patch.params) out.params = { ...(props.el.params || {}), ...patch.params }
  if (patch.pointLinks) out.pointLinks = patch.pointLinks
  if (out.params || out.pointLinks) emit('update', out as Partial<SlideElement>)
}
function onPointHandleUp() { dragPointIdx = -1; dragPointPos.value = null; dragging.value = false }

// ---- 平面图形的**控制点**拖拽（平行四边形 / 圆弧 / 指定半径的圆） ----
const ctrlHandles = computed(() =>
  isPlaneCtrlKind(props.el.kind) ? planeHandles(props.el.kind, props.el.w, props.el.h, props.el.ctrl, props.el.arcSweep) : [])
const showCtrlHandles = computed(() => !!props.selected && ctrlHandles.value.length > 0)
let dragCtrlIdx = -1
function onCtrlHandleDown(e: PointerEvent, i: number) {
  e.stopPropagation()
  const t = e.currentTarget as HTMLElement
  try { t.setPointerCapture(e.pointerId) } catch { /* 忽略 */ }
  dragCtrlIdx = i
  dragging.value = true
}
function onCtrlHandleMove(e: PointerEvent) {
  if (dragCtrlIdx < 0 || !dragging.value) return
  const r = box.value?.getBoundingClientRect()
  if (!r || !r.width || !r.height) return
  // 不夹在元素框内：控制点拖出去也行（形状会跟到框外，与圆锥曲线的端点一致）
  const px = ((e.clientX - r.left) / r.width) * props.el.w
  const py = ((e.clientY - r.top) / r.height) * props.el.h
  const p = planeDrag(props.el.kind, props.el.w, props.el.h, props.el.ctrl, dragCtrlIdx, px, py, props.el.arcSweep)
  const patch: Partial<SlideElement> = { ctrl: p.ctrl }
  if (p.arcSweep !== undefined) patch.arcSweep = p.arcSweep
  emit('update', patch)
}
function onCtrlHandleUp() { dragCtrlIdx = -1; dragging.value = false }



function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const abx = bx - ax, aby = by - ay, l2 = abx * abx + aby * aby
  let t = l2 ? ((px - ax) * abx + (py - ay) * aby) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * abx), py - (ay + t * aby))
}
function pointInPoly(px: number, py: number, poly: [number, number][]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1]
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}
function onSvgClick(e: MouseEvent) {
  if (!SOLID_VCOUNT[props.el.kind]) return
  const [nx, ny] = normPt(e)
  const px = nx * props.el.w, py = ny * props.el.h
  const p = pts.value || []
  const P: [number, number][] = []
  for (let i = 0; i < p.length; i += 2) P.push([p[i] * props.el.w, p[i + 1] * props.el.h])
  const list = meshEdges(props.el.kind, props.el.mesh)
  let best = Infinity, bestE = -1
  for (let i = 0; i < list.length; i++) {
    const a = list[i][0], b = list[i][1]
    if (!P[a] || !P[b]) continue
    const d = segDist(px, py, P[a][0], P[a][1], P[b][0], P[b][1])
    if (d < best) { best = d; bestE = i }
  }
  if (best < 10) { selectSolidEdge(props.el.id, bestE); return }
  const polys = meshFaces(props.el.kind, props.el.mesh)
  let hitFace = -1
  for (let i = 0; i < polys.length; i++) {
    const poly = polys[i].map(vi => P[vi]).filter(Boolean) as [number, number][]
    if (poly.length >= 3 && pointInPoly(px, py, poly)) hitFace = i
  }
  if (hitFace >= 0) selectSolidFace(props.el.id, hitFace)
  else clearSolidSel()
}
watch(showHandles, (v) => { if (!v && solidSel.elementId === props.el.id) clearSolidSel() })

// ---- 顶点字母拖拽定位（避免遮挡） ----
function escHtml(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
function labelHtml(s: string): string {
  const d = decodeLabel(s || '')
  return escHtml(d.base || '(字母)') + (d.sub ? '<sub>' + escHtml(d.sub) + '</sub>' : '') + (d.sup ? '<sup>' + escHtml(d.sup) + '</sup>' : '')
}
function labelOffAt(i: number) { const o = props.el.labelOffsets && props.el.labelOffsets[i]; return o || { dx: 0, dy: 0 } }
function setLabelOff(i: number, off: { dx: number; dy: number }) {
  const arr = [...(props.el.labelOffsets || [])]
  const n = Math.floor((pts.value || []).length / 2) || (SOLID_VCOUNT[props.el.kind] || 0)
  while (arr.length < n) arr.push({ dx: 0, dy: 0 })
  arr[i] = off
  emit('update', { labelOffsets: arr } as Partial<SlideElement>)
}
const labelDrag = ref(false)
let lIdx = -1
function onLabelDown(e: PointerEvent, i: number) {
  e.stopPropagation()
  lIdx = i
  labelDrag.value = true
  const t = e.currentTarget as HTMLElement
  try { t.setPointerCapture(e.pointerId) } catch {}
}
function onLabelMove(e: PointerEvent, i: number) {
  if (!labelDrag.value || lIdx !== i) return
  const [nx, ny] = normPt(e)
  const p = pts.value || []
  const vx = (p[i * 2] ?? 0.5) * props.el.w, vy = (p[i * 2 + 1] ?? 0.5) * props.el.h
  const R = Math.min(props.el.w, props.el.h) * 0.45
  let cdx = nx * props.el.w - vx
  let cdy = ny * props.el.h - (vy - 12)
  cdx = Math.max(-R, Math.min(R, cdx))
  cdy = Math.max(-R, Math.min(R, cdy))
  setLabelOff(i, { dx: cdx / props.el.w, dy: cdy / props.el.h })
}
function onLabelUp() { labelDrag.value = false; lIdx = -1 }
const selLabelPos = computed(() => {
  if (solidSel.elementId !== props.el.id || solidSel.vertex == null) return null
  const i = solidSel.vertex, p = pts.value || []
  const vx = (p[i * 2] ?? 0.5) * props.el.w, vy = (p[i * 2 + 1] ?? 0.5) * props.el.h
  const off = labelOffAt(i)
  return { left: (vx + off.dx * props.el.w) + 'px', top: (vy - 12 + off.dy * props.el.h) + 'px', idx: i }
})
const selLabelText = computed(() => selLabelPos.value ? (props.el.vlabels?.[selLabelPos.value.idx] || '') : '')



/** 双击多边形边线（进入顶点编辑后）→ 在最近的边上插入一个新顶点 */
function onSvgDbl(e: MouseEvent) {
  if (props.el.kind !== 'polygon' || shapeEdit.value.id !== props.el.id) return
  const p = normPt(e)
  const list = pts.value || DEF_POLY
  const n = list.length / 2
  if (n < 3) return
  let best = Infinity, bestSeg = -1, bestPt: [number, number] = [0, 0]
  for (let i = 0; i < n; i++) {
    const ax = list[i * 2], ay = list[i * 2 + 1]
    const bx = list[((i + 1) % n) * 2], by = list[((i + 1) % n) * 2 + 1]
    const abx = bx - ax, aby = by - ay
    const len2 = abx * abx + aby * aby
    let t = len2 ? ((p[0] - ax) * abx + (p[1] - ay) * aby) / len2 : 0
    t = Math.max(0, Math.min(1, t))
    const px = ax + t * abx, py = ay + t * aby
    const d = (p[0] - px) ** 2 + (p[1] - py) ** 2
    if (d < best) { best = d; bestSeg = i; bestPt = [px, py] }
  }
  if (best > 0.06) return
  const next = [...list.slice(0, (bestSeg + 1) * 2), bestPt[0], bestPt[1], ...list.slice((bestSeg + 1) * 2)]
  emit('update', { points: next } as Partial<SlideElement>)
}
</script>

<template>
  <div ref="box" class="mathfig-el">
    <svg :viewBox="`0 0 ${props.el.w} ${props.el.h}`" width="100%" height="100%" :preserveAspectRatio="fit === 'contain' ? 'xMidYMid meet' : 'none'" v-html="innerHtml + arcSvg" @click="onSvgClick" @dblclick="onSvgDbl"></svg>
    <template v-if="showHandles">
      <!-- 注意：v-for 循环数字时给的是 (值, 下标)，值是 1..n —— 顶点下标必须用 vi（0..n-1）。
           之前用的是 v，于是**第 0 个顶点没有手柄**、末尾还多出一个下标越界的幽灵手柄（拖它会往 points 里写 NaN）。 -->
      <span
        v-for="(_v, vi) in (pts ? Math.floor(pts.length / 2) : 0)"
        :key="vi"
        class="mf-handle"
        :class="{ sel: solidSel.elementId === props.el.id && solidSel.vertex === vi }"
        :style="{ left: ((pts ? pts[vi * 2] : 0) * props.el.w) + 'px', top: ((pts ? pts[vi * 2 + 1] : 0) * props.el.h) + 'px' }"
        @pointerdown.stop="onHandleDown($event, vi)"
        @pointermove="onHandleMove($event, vi)"
        @pointerup="onHandleUp"
      ></span>
    </template>
    <template v-if="showLineHandles">
      <span
        v-for="(h, hi) in lineHandles"
        :key="'lh' + hi"
        class="mf-handle mf-handle--line"
        :style="{ left: lineHandlePos(h).x + 'px', top: lineHandlePos(h).y + 'px' }"
        @pointerdown.stop="onLineHandleDown($event, h.i, h.which)"
        @pointermove="onLineHandleMove"
        @pointerup="onLineHandleUp"
        @pointercancel="onLineHandleUp"
      ></span>
    </template>
    <template v-if="showCtrlHandles">
      <span
        v-for="(h, hi) in ctrlHandles"
        :key="'ch' + hi"
        class="mf-handle mf-handle--ctrl"
        :style="{ left: h.x + 'px', top: h.y + 'px' }"
        :title="'拖动控制点 ' + (hi + 1)"
        @pointerdown.stop="onCtrlHandleDown($event, h.i)"
        @pointermove="onCtrlHandleMove"
        @pointerup="onCtrlHandleUp"
        @pointercancel="onCtrlHandleUp"
      ></span>
    </template>
    <template v-if="showPointHandles">
      <span
        v-for="(h, hi) in pointHandles"
        :key="'ph' + hi"
        class="mf-handle mf-handle--pt"
        :style="{ left: pointHandlePos(h).x + 'px', top: pointHandlePos(h).y + 'px' }"
        :title="'拖动标注点 ' + h.i"
        @pointerdown.stop="onPointHandleDown($event, h.i)"
        @pointermove="onPointHandleMove"
        @pointerup="onPointHandleUp"
        @pointercancel="onPointHandleUp"
      ></span>
    </template>
    <span v-if="showHandles && selLabelPos" class="mf-vlabel" :style="{ left: selLabelPos.left, top: selLabelPos.top }" @pointerdown.stop="onLabelDown($event, selLabelPos.idx)" @pointermove="onLabelMove($event, selLabelPos.idx)" @pointerup="onLabelUp" v-html="labelHtml(selLabelText)"></span>
  </div>
</template>

<style scoped>
.mathfig-el { width: 100%; height: 100%; box-sizing: border-box; position: relative; }
.mathfig-el svg { display: block; overflow: visible; }
.mf-handle {
  position: absolute;
  width: 12px; height: 12px;
  margin: -6px 0 0 -6px;
  background: #fff;
  border: 2px solid var(--brand);
  border-radius: 50%;
  cursor: move;
  box-shadow: 0 1px 4px rgba(0,0,0,0.3);
  z-index: 3;
  box-sizing: border-box;
}
.mf-handle:hover { background: var(--brand-soft); transform: scale(1.15); }
.mf-handle.sel { border-color: #ff8f1f; box-shadow: 0 0 0 4px rgba(255,143,31,0.28); }
/* 「圆锥曲线 + 多条线」的端点手柄：方形 + 绿色，跟圆形顶点手柄一眼区分 */
.mf-handle--line { border-radius: 3px; border-color: #12b76a; cursor: grab; }
.mf-handle--line:hover { background: #e8f8f0; }
/* 「标注点」的手柄：橙色实心，跟绿方（线端点）、蓝圆（顶点）区分 */
.mf-handle--pt { background: #ff8f1f; border-color: #fff; cursor: grab; }
/* 平面图形的控制点：蓝色，与圆锥曲线的橙色标注点区分开 */
.mf-handle--ctrl { background: #1668e0; border-color: #fff; cursor: grab; }
.mf-handle--ctrl:hover { background: #3a86ff; transform: scale(1.18); }
.mf-handle--pt:hover { background: #ffab52; transform: scale(1.15); }
.mf-vlabel {
  position: absolute; z-index: 5;
  transform: translate(-50%, -50%);
  padding: 0 3px; border-radius: 4px;
  border: 1px dashed #ff8f1f; background: rgba(255,255,255,0.72);
  color: #333; font-size: 20px; font-style: italic;
  line-height: 1.2; cursor: move; white-space: nowrap; box-sizing: border-box;
}
.mf-vlabel:hover { background: #fff; }
</style>
