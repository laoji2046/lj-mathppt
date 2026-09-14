import type { Deck, Slide, SlideElement, TextElement } from '@/types'
import { createApp, h } from 'vue'
import MathFigureElement from '@/components/elements/MathFigureElement.vue'
import { animRevealClass, animTimingStyle, bulletMarker, fontStack, imageEffectCss, imageMaskCss, lineDashCss, normalizeMixed, paragraphLineStyle, shadowCss, slideBgCss, textEffectCss, textShadowCss } from '@/types'
import { SOLID_VCOUNT, renderSolid, solidVerts, arcsSvg, type EdgeStyle, type FaceStyle, type SolidMesh } from '@/composables/solid3d'

/**
 * 场景图 → Reveal.js 演示页。
 *
 * 这是「同一份场景图，多种渲染形态」的第二种形态：
 * 编辑器画布由 Vue 渲染，演示与导出走 Reveal.js。
 * 两者不共享 DOM，因此不存在虚拟 DOM 与 Reveal 争夺节点的问题。
 *
 * 资源模式：
 * - 'local'：应用内演示（blob URL 的相对路径解析到主应用 origin，命中内嵌资源），
 *   完全离线可用，Tauri 与浏览器 dev 都成立。
 * - 'cdn'：导出独立 HTML 文件用（文件不带资源，必须走 CDN）。
 */

export interface RenderOptions {
  /** 'local' = 应用内演示（默认）；'cdn' = 导出独立文件 */
  assets?: 'local' | 'cdn'
  /**
   * 打印模式（导出 PDF / PNG 用）：
   * - Reveal 以 view:'print' 初始化，全部幻灯片展开为 .pdf-page 分页堆叠（无 transform）
   * - ready 后对每一页执行 MathJax / GeoGebra / Desmos / pdf.js 挂载
   * - 所有引擎挂载完成后向宿主 postMessage({ type: 'fx-print-ready' })
   * 宿主（TopToolbar 导出）收到信号后即可 print() 或 html2canvas 截图。
   */
  print?: boolean
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 用**真正的图形组件**渲染出一段 SVG 标记。
 *
 * 为什么这么做：原来这里有一份**手写的 figureInner**，只覆盖了一部分 kind ✗ ——
 * 函数图像里 linear / cubic / abs … 一整批没实现，缺的那批就渲染成**空 SVG**，
 * 于是缩略图、应用内演示、导出的 HTML 里**全都看不见**（用户实测报障）。
 * 补 40 个 kind 只是把同一个漂移问题往后拖 ✗；改成直接挂载真组件、读它的 <svg>，
 * 从此**只有一份实现**，再也不会两边不一致。
 */
function renderFigureSvg(el: SlideElement): string {
  try {
    const host = document.createElement('div')
    const app = createApp({ render: () => h(MathFigureElement as never, { el } as never) })
    app.mount(host)
    const svg = host.querySelector('svg')
    const out = svg ? svg.outerHTML : ''
    app.unmount()
    return out
  } catch (err) {
    console.warn('[导出] 图形渲染失败，退回内置实现', err)
    return ''
  }
}

/** 数学图形的 SVG 内部标记（保留为兜底：万一真组件挂载失败） */
function figureInner(
  kind: string, w: number, h: number,
  stroke: string, strokeWidth: number, fill: string,
  points?: number[], strokeDash?: string, depth?: number,
  vlabels?: (string | null)[], edgeStyles?: (EdgeStyle | null)[],
  labelOffsets?: { dx: number; dy: number }[], faceStyles?: (FaceStyle | null)[], mesh?: SolidMesh | null,
): string {
  const s = strokeWidth || 2
  const dash = lineDashCss(strokeDash)
  const sa = `stroke="${stroke}" stroke-width="${s}" stroke-linecap="round" stroke-linejoin="round"` + (dash ? ` stroke-dasharray="${dash}"` : '')
  const fc = fill && fill !== 'transparent' ? fill : 'none'
  const dsh = 'stroke-dasharray="6 5"'
  const thin = Math.max(1, s * 0.55)
  function reg(n: number, cx: number, cy: number, rx: number, ry: number, rot = -Math.PI / 2) {
    const a: string[] = []
    for (let i = 0; i < n; i++) {
      const ang = rot + (i * 2 * Math.PI) / n
      a.push((cx + rx * Math.cos(ang)).toFixed(1) + ',' + (cy + ry * Math.sin(ang)).toFixed(1))
    }
    return a.join(' ')
  }
  if (SOLID_VCOUNT[kind]) {
    // 顶点数判定必须和画布（MathFigureElement.vue）一致：
    // **带 mesh 的图形顶点数是任意的**（「图片转图形」/复刻图都是），不能再要求等于该类型的默认顶点数 ——
    // 否则这里会退化成该类型的默认顶点，再去套那条有十几个下标的边表，直接越界（缩略图 / 演示 / 导出全中）。
    const need = SOLID_VCOUNT[kind] * 2
    const pv = points && points.length >= 4 && points.length % 2 === 0 && (mesh || points.length === need)
      ? points
      : solidVerts(kind, w, h, depth)
    return renderSolid(kind, pv, w, h, stroke, s, fc, dsh, vlabels, edgeStyles, undefined, undefined, labelOffsets, faceStyles, undefined, mesh)
  }
  switch (kind) {
    case 'parabola':
      return `<path d="M 0 ${h} Q ${w * 0.5} ${-h * 0.9} ${w} ${h}" ${sa} fill="none"/>` +
        `<line x1="0" y1="${h * 0.62}" x2="${w}" y2="${h * 0.62}" stroke="${stroke}" stroke-width="${thin}" stroke-dasharray="6 5"/>`
    case 'sine':
      return `<path d="M 0 ${h / 2} C ${w * 0.25} ${h * 0.1}, ${w * 0.25} ${h * 0.9}, ${w / 2} ${h / 2} S ${w * 0.75} ${h * 0.1}, ${w} ${h / 2}" ${sa} fill="none"/>`
    case 'cosine':
      return `<path d="M 0 ${h * 0.12} C ${w * 0.22} ${h * 0.12}, ${w * 0.22} ${h * 0.88}, ${w / 2} ${h * 0.88} S ${w * 0.78} ${h * 0.12}, ${w} ${h * 0.12}" ${sa} fill="none"/>`
    case 'exponential':
      return `<path d="M 0 ${h} C ${w * 0.5} ${h}, ${w * 0.7} ${h * 0.4}, ${w} ${h * 0.06}" ${sa} fill="none"/>`
    case 'logarithm':
      return `<path d="M ${w * 0.04} ${h * 0.06} C ${w * 0.3} ${h * 0.3}, ${w * 0.55} ${h * 0.7}, ${w} ${h}" ${sa} fill="none"/>`
    case 'coordinate': {
      const axis = `stroke="${stroke}" stroke-width="${s}"`
      let ticks = ''
      for (let i = 1; i < 4; i++) {
        const tx = (w * i) / 4
        const ty = (h * i) / 4
        ticks += `<line x1="${tx}" y1="${h - 10}" x2="${tx}" y2="${h + 10}" ${axis}/>` +
          `<line x1="10" y1="${ty}" x2="-10" y2="${ty}" ${axis}/>`
      }
      return `<line x1="0" y1="${h}" x2="${w}" y2="${h}" ${axis}/>` +
        `<line x1="0" y1="${h}" x2="0" y2="0" ${axis}/>` +
        `<polygon points="${w},${h} ${w - 12},${h - 6} ${w - 12},${h + 6}" fill="${stroke}"/>` +
        `<polygon points="0,0 12,0 0,12" fill="${stroke}"/>` + ticks
    }
    case 'numberline': {
      const cy = h / 2
      const axis = `stroke="${stroke}" stroke-width="${s}"`
      let ticks = ''
      for (let i = 0; i <= 6; i++) {
        const tx = (w * i) / 6
        ticks += `<line x1="${tx}" y1="${cy - 10}" x2="${tx}" y2="${cy + 10}" ${axis}/>`
      }
      return `<line x1="0" y1="${cy}" x2="${w}" y2="${cy}" ${axis}/>` +
        `<polygon points="0,${cy} 12,${cy - 6} 12,${cy + 6}" fill="${stroke}"/>` +
        `<polygon points="${w},${cy} ${w - 12},${cy - 6} ${w - 12},${cy + 6}" fill="${stroke}"/>` + ticks
    }
    case 'venn': {
      const r = Math.min(w, h) * 0.26
      return `<circle cx="${w * 0.36}" cy="${h * 0.5}" r="${r}" ${sa} fill="${fc}"/>` +
        `<circle cx="${w * 0.64}" cy="${h * 0.5}" r="${r}" ${sa} fill="${fc}"/>`
    }
    case 'righttriangle':
      return `<polygon points="0,${h} ${w},${h} ${w * 0.12},${h * 0.05}" ${sa} fill="${fc}"/>`
    case 'angle': {
      const ox = w * 0.12
      const oy = h * 0.9
      const len = Math.min(w, h) * 0.8
      return `<line x1="${ox}" y1="${oy}" x2="${ox + len}" y2="${oy}" ${sa}/>` +
        `<line x1="${ox}" y1="${oy}" x2="${ox}" y2="${oy - len}" ${sa}/>` +
        `<path d="M ${ox + len * 0.25} ${oy} A ${len * 0.25} ${len * 0.25} 0 0 1 ${ox} ${oy - len * 0.25}" ${sa} fill="none"/>`
    }
    case 'semicircle':
      return `<path d="M 0 ${h} A ${w / 2} ${h} 0 0 1 ${w} ${h}" ${sa} fill="${fc}"/>`
    case 'triangle':
      return `<polygon points="0,${h} ${w},${h} ${w * 0.42},0" ${sa} fill="${fc}"/>`
    case 'rectangle':
      return `<rect x="${w * 0.02}" y="${h * 0.02}" width="${w * 0.96}" height="${h * 0.96}" ${sa} fill="${fc}"/>`
    case 'circle':
      return `<circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) * 0.46}" ${sa} fill="${fc}"/>`
    case 'pentagon':
      return `<polygon points="${reg(5, w / 2, h / 2, Math.min(w, h) * 0.44, Math.min(w, h) * 0.44)}" ${sa} fill="${fc}"/>`
    case 'hexagon':
      return `<polygon points="${reg(6, w / 2, h / 2, Math.min(w, h) * 0.46, Math.min(w, h) * 0.46)}" ${sa} fill="${fc}"/>`
    case 'rhombus':
      return `<polygon points="${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}" ${sa} fill="${fc}"/>`
    case 'parallelogram':
      return `<polygon points="${w * 0.22},0 ${w},0 ${w * 0.78},${h} 0,${h}" ${sa} fill="${fc}"/>`
    case 'trapezoid':
      return `<polygon points="${w * 0.24},0 ${w * 0.76},0 ${w},${h} 0,${h}" ${sa} fill="${fc}"/>`
    case 'star': {
      const cx = w / 2, cy = h / 2, m = Math.min(w, h)
      const pts: string[] = []
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI) / 5
        const rr = i % 2 === 0 ? m * 0.46 : m * 0.2
        pts.push((cx + rr * Math.cos(ang)).toFixed(1) + ',' + (cy + rr * Math.sin(ang)).toFixed(1))
      }
      return `<polygon points="${pts.join(' ')}" ${sa} fill="${fc}"/>`
    }
    case 'cube': case 'cuboid': {
      const dep = (depth ?? 0.4) * Math.min(w, h) * 0.4, dx = dep, dy = -dep * 0.8
      const side = kind === 'cube' ? Math.min(w, h) * 0.62 : 0
      const fw = kind === 'cube' ? side : w * 0.78, fh = kind === 'cube' ? side : h * 0.64
      const fx = (w - fw) / 2, fy = h * 0.16
      const fc = fill && fill !== 'transparent' ? fill : 'none'
      const front = fx + ',' + (fy + fh) + ' ' + (fx + fw) + ',' + (fy + fh) + ' ' + (fx + fw) + ',' + fy + ' ' + fx + ',' + fy
      const top = fx + ',' + fy + ' ' + (fx + fw) + ',' + fy + ' ' + (fx + fw + dx) + ',' + (fy + dy) + ' ' + (fx + dx) + ',' + (fy + dy)
      const right = (fx + fw) + ',' + fy + ' ' + (fx + fw + dx) + ',' + (fy + dy) + ' ' + (fx + fw + dx) + ',' + (fy + fh + dy) + ' ' + (fx + fw) + ',' + (fy + fh)
      return '<g ' + sa + ' fill="' + fc + '"><polygon points="' + top + '" opacity="0.8"/><polygon points="' + right + '" opacity="0.62"/><polygon points="' + front + '"/>' +
        '<line ' + dsh + ' x1="' + fx + '" y1="' + (fy + fh) + '" x2="' + (fx + dx) + '" y2="' + (fy + fh + dy) + '"/>' +
        '<line ' + dsh + ' x1="' + (fx + dx) + '" y1="' + (fy + fh + dy) + '" x2="' + (fx + fw + dx) + '" y2="' + (fy + fh + dy) + '"/>' +
        '<line ' + dsh + ' x1="' + (fx + dx) + '" y1="' + (fy + fh + dy) + '" x2="' + (fx + dx) + '" y2="' + (fy + dy) + '"/></g>'
    }
    case 'cylinder': {
      const m = Math.min(w, h), rx = m * 0.36, ry = m * 0.12, cx = w / 2, topY = h * 0.2, botY = h * 0.78
      const fc = fill && fill !== 'transparent' ? fill : 'none'
      return '<g ' + sa + ' fill="' + fc + '">' +
        '<line x1="' + (cx - rx) + '" y1="' + topY + '" x2="' + (cx - rx) + '" y2="' + botY + '"/>' +
        '<line x1="' + (cx + rx) + '" y1="' + topY + '" x2="' + (cx + rx) + '" y2="' + botY + '"/>' +
        '<path ' + dsh + ' d="M ' + (cx - rx) + ' ' + botY + ' A ' + rx + ' ' + ry + ' 0 0 1 ' + (cx + rx) + ' ' + botY + '"/>' +
        '<path d="M ' + (cx - rx) + ' ' + botY + ' A ' + rx + ' ' + ry + ' 0 0 0 ' + (cx + rx) + ' ' + botY + '"/>' +
        '<ellipse cx="' + cx + '" cy="' + topY + '" rx="' + rx + '" ry="' + ry + '"/></g>'
    }
    case 'cone': {
      const m = Math.min(w, h), rx = m * 0.38, ry = m * 0.13, cx = w / 2, botY = h * 0.8, apexY = h * 0.12
      const fc = fill && fill !== 'transparent' ? fill : 'none'
      return '<g ' + sa + ' fill="' + fc + '"><path d="M ' + (cx - rx) + ' ' + botY + ' A ' + rx + ' ' + ry + ' 0 0 0 ' + (cx + rx) + ' ' + botY + ' L ' + cx + ' ' + apexY + ' Z"/>' +
        '<path ' + dsh + ' d="M ' + (cx - rx) + ' ' + botY + ' A ' + rx + ' ' + ry + ' 0 0 1 ' + (cx + rx) + ' ' + botY + '"/></g>'
    }
    case 'sphere': {
      const m = Math.min(w, h), r = m * 0.42, cx = w / 2, cy = h / 2, ry = r * 0.34
      const fc = fill && fill !== 'transparent' ? fill : 'none'
      return '<g ' + sa + ' fill="' + fc + '"><circle cx="' + cx + '" cy="' + cy + '" r="' + r + '"/>' +
        '<path ' + dsh + ' d="M ' + (cx - r) + ' ' + cy + ' A ' + r + ' ' + ry + ' 0 0 1 ' + (cx + r) + ' ' + cy + '"/>' +
        '<path d="M ' + (cx - r) + ' ' + cy + ' A ' + r + ' ' + ry + ' 0 0 0 ' + (cx + r) + ' ' + cy + '"/>' +
        '<path ' + dsh + ' d="M ' + cx + ' ' + (cy - r) + ' A ' + (r * 0.34) + ' ' + r + ' 0 0 0 ' + cx + ' ' + (cy + r) + '"/>' +
        '<path d="M ' + cx + ' ' + (cy - r) + ' A ' + (r * 0.34) + ' ' + r + ' 0 0 1 ' + cx + ' ' + (cy + r) + '"/></g>'
    }
    case 'pyramid': {
      const m = Math.min(w, h), dep = (depth ?? 0.4) * m * 0.4, dx = dep, dy = -dep * 0.8
      const wb = m * 0.42, cx = w / 2, botY = h * 0.78, apexY = h * 0.12
      const fc = fill && fill !== 'transparent' ? fill : 'none'
      const b1 = (cx - wb) + ',' + (botY - dy), b2 = (cx + wb) + ',' + (botY - dy)
      const f1 = (cx - wb + dx) + ',' + botY, f2 = (cx + wb + dx) + ',' + botY
      const ap = cx + ',' + apexY
      return '<g ' + sa + '>' +
        '<polygon points="' + b1 + ' ' + b2 + ' ' + f2 + ' ' + f1 + '" fill="' + fc + '" stroke="none" opacity="0.7"/>' +
        '<polygon points="' + ap + ' ' + f1 + ' ' + f2 + '" fill="' + fc + '" stroke="none" opacity="0.95"/>' +
        '<line x1="' + f1 + '" x2="' + f2 + '"/><line x1="' + ap + '" x2="' + f1 + '"/><line x1="' + ap + '" x2="' + f2 + '"/>' +
        '<line x1="' + f1 + '" x2="' + b1 + '"/><line x1="' + f2 + '" x2="' + b2 + '"/>' +
        '<line ' + dsh + ' x1="' + b1 + '" x2="' + b2 + '"/><line ' + dsh + ' x1="' + ap + '" x2="' + b1 + '"/><line ' + dsh + ' x1="' + ap + '" x2="' + b2 + '"/></g>'
    }
    case 'prism': {
      const m = Math.min(w, h), dep = (depth ?? 0.4) * m * 0.4, dx = dep, dy = -dep * 0.8
      const fx = w * 0.16, fy = h * 0.24, fw = w * 0.56, fh = h * 0.56
      const fc = fill && fill !== 'transparent' ? fill : 'none'
      const triF = fx + ',' + (fy + fh) + ' ' + (fx + fw) + ',' + (fy + fh) + ' ' + (fx + fw / 2) + ',' + fy
      const triB = (fx + dx) + ',' + (fy + fh + dy) + ' ' + (fx + fw + dx) + ',' + (fy + fh + dy) + ' ' + (fx + fw / 2 + dx) + ',' + (fy + dy)
      return '<g ' + sa + '>' +
        '<polygon points="' + triB + '" fill="' + fc + '" stroke="none" opacity="0.5"/>' +
        '<polygon points="' + triB + '" fill="none" ' + dsh + '/>' +
        '<polygon points="' + triF + '" fill="' + fc + '" stroke="none" opacity="0.9"/>' +
        '<polygon points="' + triF + '" fill="none"/>' +
        '<line x1="' + fx + ',' + (fy + fh) + '" x2="' + (fx + dx) + ',' + (fy + fh + dy) + '"/><line x1="' + (fx + fw) + ',' + (fy + fh) + '" x2="' + (fx + fw + dx) + ',' + (fy + fh + dy) + '"/><line x1="' + (fx + fw / 2) + ',' + fy + '" x2="' + (fx + fw / 2 + dx) + ',' + (fy + dy) + '"/></g>'
    }
    case 'tetrahedron': {
      const m = Math.min(w, h), cx = w / 2, cy = h / 2, base = m * 0.42
      const fc = fill && fill !== 'transparent' ? fill : 'none'
      const p0 = (cx - base * 0.7) + ',' + (cy + base * 0.4), p1 = (cx + base * 0.7) + ',' + (cy + base * 0.4), p2 = cx + ',' + (cy - base * 0.4), p3 = cx + ',' + (cy - base * 0.9)
      return '<g ' + sa + '>' +
        '<polygon points="' + p0 + ' ' + p1 + ' ' + p2 + '" fill="' + fc + '" stroke="none" opacity="0.4"/>' +
        '<polygon points="' + p3 + ' ' + p0 + ' ' + p2 + '" fill="' + fc + '" stroke="none" opacity="0.86"/>' +
        '<polygon points="' + p3 + ' ' + p1 + ' ' + p0 + '" fill="' + fc + '" stroke="none" opacity="0.76"/>' +
        '<polygon points="' + p3 + ' ' + p2 + ' ' + p1 + '" fill="' + fc + '" stroke="none" opacity="0.66"/>' +
        '<line x1="' + p0 + '" x2="' + p1 + '"/><line x1="' + p3 + '" x2="' + p0 + '"/><line x1="' + p3 + '" x2="' + p1 + '"/>' +
        '<line ' + dsh + ' x1="' + p0 + '" x2="' + p2 + '"/><line ' + dsh + ' x1="' + p1 + '" x2="' + p2 + '"/><line ' + dsh + ' x1="' + p3 + '" x2="' + p2 + '"/></g>'
    }
    case 'frustum': {
      const mm = Math.min(w, h), rB = mm * 0.4, rT = mm * 0.24, ryB = mm * 0.12, ryT = mm * 0.09, cx = w / 2, topY = h * 0.28, botY = h * 0.76
      const fcc = fill && fill !== 'transparent' ? fill : 'none'
      return '<g ' + sa + ' fill="' + fcc + '">' +
        '<line x1="' + (cx - rB) + '" y1="' + botY + '" x2="' + (cx - rT) + '" y2="' + topY + '"/><line x1="' + (cx + rB) + '" y1="' + botY + '" x2="' + (cx + rT) + '" y2="' + topY + '"/>' +
        '<path ' + dsh + ' d="M ' + (cx - rB) + ' ' + botY + ' A ' + rB + ' ' + ryB + ' 0 0 1 ' + (cx + rB) + ' ' + botY + '"/>' +
        '<path d="M ' + (cx - rB) + ' ' + botY + ' A ' + rB + ' ' + ryB + ' 0 0 0 ' + (cx + rB) + ' ' + botY + '"/>' +
        '<ellipse cx="' + cx + '" cy="' + topY + '" rx="' + rT + '" ry="' + ryT + '"/></g>'
    }
    case 'pyraFrustum': {
      const mm = Math.min(w, h), d = (depth ?? 0.4) * mm * 0.4, dx = d, dy = -d * 0.8
      const wB = mm * 0.42, wT = mm * 0.26, cx = w / 2, botY = h * 0.74, topY = h * 0.26, bby = botY + dy, tby = topY + dy
      const fcc = fill && fill !== 'transparent' ? fill : 'none'
      const bFL = (cx - wB) + ',' + botY, bFR = (cx + wB) + ',' + botY, bBL = (cx - wB + dx) + ',' + bby, bBR = (cx + wB + dx) + ',' + bby
      const tFL = (cx - wT) + ',' + topY, tFR = (cx + wT) + ',' + topY, tBL = (cx - wT + dx) + ',' + tby, tBR = (cx + wT + dx) + ',' + tby
      return '<g ' + sa + '>' +
        '<polygon points="' + bFL + ' ' + bFR + ' ' + bBR + ' ' + bBL + '" fill="' + fcc + '" stroke="none" opacity="0.6"/>' +
        '<polygon points="' + tFL + ' ' + tFR + ' ' + tBR + ' ' + tBL + '" fill="' + fcc + '" stroke="none" opacity="0.9"/>' +
        '<line x1="' + bFL + '" x2="' + bFR + '"/><line x1="' + bFL + '" x2="' + bBL + '"/><line x1="' + bFR + '" x2="' + bBR + '"/>' +
        '<line x1="' + tFL + '" x2="' + tFR + '"/><line x1="' + tFL + '" x2="' + tBL + '"/><line x1="' + tFR + '" x2="' + tBR + '"/>' +
        '<line x1="' + bFL + '" x2="' + tFL + '"/><line x1="' + bFR + '" x2="' + tFR + '"/>' +
        '<line ' + dsh + ' x1="' + bBL + '" x2="' + bBR + '"/><line ' + dsh + ' x1="' + bBL + '" x2="' + tBL + '"/>' +
        '<line ' + dsh + ' x1="' + tBL + '" x2="' + tBR + '"/><line ' + dsh + ' x1="' + bBR + '" x2="' + tBR + '"/></g>'
    }
    case 'dihedral': {
      const mm = Math.min(w, h), d = (depth ?? 0.4) * mm * 0.5, cx = w / 2, hingeY = h * 0.5
      const fcc = fill && fill !== 'transparent' ? fill : 'none'
      const p1 = '0,' + hingeY + ' ' + cx + ',' + hingeY + ' ' + cx + ',' + (hingeY - h * 0.3) + ' 0,' + (hingeY - h * 0.3)
      const p2 = cx + ',' + hingeY + ' ' + (cx + d) + ',' + (hingeY - d * 0.8) + ' ' + (cx + d) + ',' + (hingeY - d * 0.8 - h * 0.3) + ' ' + cx + ',' + (hingeY - h * 0.3)
      return '<g ' + sa + ' fill="' + fcc + '"><polygon points="' + p1 + '" opacity="0.9"/><polygon points="' + p2 + '" opacity="0.7"/><line x1="0" y1="' + hingeY + '" x2="' + w + '" y2="' + hingeY + '"/></g>'
    }
    case 'isoaxis': {
      const mm = Math.min(w, h), cx = w / 2, cy = h / 2, L = mm * 0.36
      return '<g ' + sa + ' fill="none"><line x1="' + cx + '" y1="' + cy + '" x2="' + cx + '" y2="' + (cy - L) + '"/><line x1="' + cx + '" y1="' + cy + '" x2="' + (cx + L * 0.87) + '" y2="' + (cy + L * 0.5) + '"/><line x1="' + cx + '" y1="' + cy + '" x2="' + (cx - L * 0.87) + '" y2="' + (cy + L * 0.5) + '"/><polygon points="' + cx + ',' + (cy - L) + ' ' + (cx - 7) + ',' + (cy - L + 12) + ' ' + (cx + 7) + ',' + (cy - L + 12) + '" fill="' + stroke + '"/></g>'
    }
    // ---- 辅助线 / 标注 ----
    case 'auxLine':
      return '<line x1="' + (w * 0.04) + '" y1="' + (h * 0.6) + '" x2="' + (w * 0.96) + '" y2="' + (h * 0.6) + '" ' + sa + ' stroke-dasharray="7 5" fill="none"/>'
    case 'rightAngle': {
      const x0 = w * 0.18, y0 = h * 0.86, L = Math.min(w, h) * 0.72, t = Math.min(w, h) * 0.16
      return '<line x1="' + x0 + '" y1="' + y0 + '" x2="' + (x0 + L) + '" y2="' + y0 + '" ' + sa + ' fill="none"/>' +
        '<line x1="' + x0 + '" y1="' + y0 + '" x2="' + x0 + '" y2="' + (y0 - L) + '" ' + sa + ' fill="none"/>' +
        '<path d="M ' + (x0 + t) + ' ' + y0 + ' L ' + (x0 + t) + ' ' + (y0 - t) + ' L ' + x0 + ' ' + (y0 - t) + '" ' + sa + ' fill="none"/>'
    }
    case 'equalMark': {
      const y = h * 0.5, x1 = w * 0.12, x2 = w * 0.88, tk = Math.min(w, h) * 0.2, g = Math.min(w, h) * 0.06
      return '<line x1="' + x1 + '" y1="' + y + '" x2="' + x2 + '" y2="' + y + '" ' + sa + ' fill="none"/>' +
        '<line x1="' + (w * 0.5 - g) + '" y1="' + (y - tk) + '" x2="' + (w * 0.5 - g) + '" y2="' + (y + tk) + '" ' + sa + ' fill="none"/>' +
        '<line x1="' + (w * 0.5 + g) + '" y1="' + (y - tk) + '" x2="' + (w * 0.5 + g) + '" y2="' + (y + tk) + '" ' + sa + ' fill="none"/>'
    }
    case 'parallelMark': {
      const y = h * 0.5, tk = Math.min(w, h) * 0.22, g = Math.min(w, h) * 0.07
      return '<line x1="' + (w * 0.5 - g) + '" y1="' + (y + tk) + '" x2="' + (w * 0.5 - g) + '" y2="' + (y - tk) + '" ' + sa + ' fill="none"/>' +
        '<line x1="' + (w * 0.5 + g) + '" y1="' + (y + tk) + '" x2="' + (w * 0.5 + g) + '" y2="' + (y - tk) + '" ' + sa + ' fill="none"/>'
    }
    case 'angleArc': {
      const ox = w * 0.16, oy = h * 0.84, L = Math.min(w, h) * 0.72, r = Math.min(w, h) * 0.3, a2 = -Math.PI / 3
      const ex = ox + L * Math.cos(a2), ey = oy + L * Math.sin(a2)
      const ax = ox + r * Math.cos(a2), ay = oy + r * Math.sin(a2)
      return '<line x1="' + ox + '" y1="' + oy + '" x2="' + (ox + L) + '" y2="' + oy + '" ' + sa + ' fill="none"/>' +
        '<line x1="' + ox + '" y1="' + oy + '" x2="' + ex + '" y2="' + ey + '" ' + sa + ' fill="none"/>' +
        '<path d="M ' + (ox + r) + ' ' + oy + ' A ' + r + ' ' + r + ' 0 0 0 ' + ax + ' ' + ay + '" ' + sa + ' fill="none"/>'
    }
    case 'section': {
      const pp = (w * 0.2) + ',' + (h * 0.36) + ' ' + (w * 0.8) + ',' + (h * 0.26) + ' ' + (w * 0.8) + ',' + (h * 0.72) + ' ' + (w * 0.2) + ',' + (h * 0.82)
      return '<polygon points="' + pp + '" ' + sa + ' fill="' + fc + '" opacity="0.55"/>'
    }
    case 'polygon': {
      const pp = points && points.length >= 6 ? points : [0.5,0.08,0.86,0.29,0.86,0.71,0.5,0.92,0.14,0.71,0.14,0.29]
      return `<polygon points="${pp.map((v, i) => (i % 2 === 0 ? v * w : v * h)).join(' ')}" ${sa} fill="${fc}"/>`
    }
    case 'bezier': {
      const b = points && points.length >= 8 ? points : [0.06,0.75,0.28,0.08,0.72,0.92,0.94,0.25]
      return `<path d="M ${b[0] * w} ${b[1] * h} C ${b[2] * w} ${b[3] * h}, ${b[4] * w} ${b[5] * h}, ${b[6] * w} ${b[7] * h}" ${sa} fill="none"/>`
    }
    default:
      return ''
  }
}

function chartInner(
  type: string, labels: string[], values: number[], color: string, w: number, h: number,
): string {
  const n = values.length || 1
  const max = Math.max(...values, 1)
  const pad = { t: 18, r: 16, b: 28, l: 36 }
  const cw = Math.max(1, w - pad.l - pad.r)
  const ch = Math.max(1, h - pad.t - pad.b)
  const tint = (hex: string, i: number) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex)
    if (!m) return hex
    const nv = parseInt(m[1], 16)
    const f = (c: number) => Math.min(255, Math.round(c + i * 16))
    const r = f((nv >> 16) & 255), g = f((nv >> 8) & 255), b = f(nv & 255)
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')
  }
  let out = ''
  if (type === 'bar') {
    const slot = cw / n
    const barW = slot * 0.6
    values.forEach((v, i) => {
      const bh = Math.max(0, (v / max) * ch)
      const bx = pad.l + i * slot + (slot - barW) / 2
      const by = pad.t + ch - bh
      out += `<rect x="${bx}" y="${by}" width="${barW}" height="${bh}" rx="2" fill="${color}"/>`
      out += `<text x="${pad.l + i * slot + slot / 2}" y="${h - 8}" font-size="12" text-anchor="middle" fill="#555">${esc(labels[i] ?? '')}</text>`
    })
    out += `<line x1="${pad.l}" y1="${pad.t + ch}" x2="${w - pad.r}" y2="${pad.t + ch}" stroke="#aaa" stroke-width="1"/>`
  } else if (type === 'line') {
    const pts = values.map((v, i) => {
      const x = pad.l + (n === 1 ? cw / 2 : (i * cw) / (n - 1))
      const y = pad.t + ch - (v / max) * ch
      return `${x},${y}`
    })
    out += `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`
    out += pts.map((p, i) => {
      const [x, y] = p.split(',').map(Number)
      return `<circle cx="${x}" cy="${y}" r="4" fill="${color}"/>` +
        `<text x="${x}" y="${y - 9}" font-size="11" text-anchor="middle" fill="#555">${esc(labels[i] ?? '')}</text>`
    }).join('')
  } else {
    const cx = cw / 2 + pad.l
    const cy = ch / 2 + pad.t
    const r = Math.max(6, Math.min(cw, ch) / 2 - 4)
    const total = values.reduce((s, v) => s + (v > 0 ? v : 0), 0) || 1
    let a = -Math.PI / 2
    values.forEach((v, i) => {
      if (v <= 0) return
      const a2 = a + (v / total) * Math.PI * 2
      const x1 = cx + r * Math.cos(a)
      const y1 = cy + r * Math.sin(a)
      const x2 = cx + r * Math.cos(a2)
      const y2 = cy + r * Math.sin(a2)
      const large = a2 - a > Math.PI ? 1 : 0
      out += `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z" fill="${tint(color, i)}"/>`
      const mid = (a + a2) / 2
      const lx = cx + r * 0.62 * Math.cos(mid)
      const ly = cy + r * 0.62 * Math.sin(mid)
      out += `<text x="${lx}" y="${ly}" font-size="12" text-anchor="middle" fill="#fff">${esc(labels[i] ?? '')}</text>`
      a = a2
    })
  }
  return out
}

function elementToHtml(el: SlideElement): string {
  // 动画时长/延迟走 CSS 变量（--anim-dur / --anim-delay），编辑器与导出一致
  const animTiming = (el.animIn && el.animIn !== 'none') || (el.animEm && el.animEm !== 'none')
    ? ';' + animTimingStyle(el)
    : ''
  const box = `position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;` + animTiming +
    (el.shadowOn ? `box-shadow:${el.shadowX ?? 0}px ${el.shadowY ?? 6}px ${el.shadowBlur ?? 18}px ${el.shadowColor || '#000000'}55;` : '')
  const rot = el.rot ? `transform:rotate(${el.rot}deg);` : ''
  // 入场动画：拼上 Reveal **内置**的 fragment 类（fade-up / zoom-in / grow …），不自己写 JS
  const animCls = el.fragment ? animRevealClass(el.animIn) : ''
  const cls = el.fragment ? ' class="fragment' + (animCls ? ' ' + animCls : '') + '"' : ''
  const fragIdx = (el.fragment && typeof el.fragmentIndex === 'number' ? ' data-fragment-index="' + el.fragmentIndex + '"' : '') + +
    (el.animEm && el.animEm !== 'none' ? ' data-anim-em="' + el.animEm + '"' : '')

  if (el.type === 'text') {
    const t = el as TextElement
    const hasBg = !!t.bgColor && t.bgColor !== 'transparent'
    const fx = textEffectCss(t)
    const ai = t.valign === 'top' ? 'flex-start' : t.valign === 'bottom' ? 'flex-end' : 'center'
    const inner = `display:flex;align-items:${ai};height:100%;` +
      `padding:${hasBg ? '6px 12px' : '4px'};box-sizing:border-box;` +
      `color:${t.color};font-size:${t.fontSize}px;font-weight:${t.fontWeight};` +
      `font-family:${esc(fontStack(t.fontFamily))};` +
      `text-shadow:${esc(textShadowCss(t))};` +
      `background:${hasBg ? esc(t.bgColor) : 'transparent'};` +
      `border-radius:${hasBg ? '6px' : '0'};` +
      `text-align:${t.align};line-height:1.4;white-space:pre-wrap;word-break:break-word;overflow:hidden;` +
      `justify-content:${t.align === 'left' ? 'flex-start' : t.align === 'right' ? 'flex-end' : 'center'};` +
      (fx ? fx : '')
    // 逐行渲染 + 项目符号（与编辑器同一套工具函数，保证两端一致）
    const lines = String(t.text ?? '').split('\n')
    const body = lines.map((ln, i) => {
      const mk = bulletMarker(t.bullet, i)
      const mkHtml = mk ? `<span style="display:inline-block;min-width:1.1em;margin-right:.35em">${esc(mk)}</span>` : ''
      return `<div style="${paragraphLineStyle(t, i, lines.length)}">${mkHtml}${esc(ln)}</div>`
    }).join('')
    return `<div style="${box}${rot}"${cls}${fragIdx}><div style="${inner}"><div style="width:100%;white-space:pre-wrap">${body}</div></div></div>`
  }

  if (el.type === 'shape') {
    const inner = `width:100%;height:100%;box-sizing:border-box;background:${el.fill};` +
      `border-radius:${el.shape === 'ellipse' ? '50%' : (el.cornerRadius ?? 4) + 'px'};` +
      (el.strokeWidth > 0 ? `border:${el.strokeWidth}px solid ${el.stroke};` : '')
    return `<div style="${box}${rot}"${cls}${fragIdx}><div style="${inner}"></div></div>`
  }

  if (el.type === 'math') {
    // 交给 MathJax 排版；用 \[ ... \]（display）包裹 —— 与画布侧 MathElement 的
    // tex2svg(latex, { display: true }) 保持一致。若用 \( ... \) 内联包裹，导出/放映时
    // \frac、\sum 的上下限会按 textstyle 排版，比画布上小一圈
    const inner = `width:100%;height:100%;display:flex;align-items:center;justify-content:center;` +
      `overflow:hidden;color:${el.color};font-size:${el.fontSize}px;`
    return `<div style="${box}${rot}"${cls}${fragIdx}><div class="fx-math" data-cap="${el.fitMode === 'shrink' ? 1 : 4}" style="${inner}">\\[${esc(el.latex)}\\]</div></div>`
  }

  if (el.type === 'geogebra') {
    const attrs = [
      `data-ggb-app="${esc(el.app)}"`,
      `data-ggb-toolbar="${el.showToolbar ? 1 : 0}"`,
      `data-ggb-algebra="${el.showAlgebraInput ? 1 : 0}"`,
      `data-ggb-algview="${el.showAlgebra ? 1 : 0}"`,
      `data-ggb-menubar="${el.showMenuBar ? 1 : 0}"`,
      `data-ggb-reset="${el.showResetIcon ? 1 : 0}"`,
      `data-ggb-zoom="${el.enableShiftDragZoom ? 1 : 0}"`,
      `data-ggb-axis="${el.showAxis ? 1 : 0}"`,
      `data-ggb-grid="${el.showGrid ? 1 : 0}"`,
      el.ggbBase64 ? `data-ggb-b64="${esc(el.ggbBase64)}"` : '',
    ].filter(Boolean).join(' ')
    return `<div style="${box}${rot}"${cls}${fragIdx}>` +
      `<div class="fx-ggb" ${attrs} style="width:100%;height:100%;background:#fff;border:1px solid #e3dfd5;border-radius:4px;overflow:hidden">` +
      `<div class="ggb-host" style="width:100%;height:100%"></div></div></div>`
  }

  if (el.type === 'desmos') {
    // 状态用 base64 包一层：避免 JSON 里的引号/换行污染属性解析，
    // 同时复用属性转义（esc() 只处理 4 个字符，base64 是字母数字+=/，无 escape 压力）。
    let stateAttr = ''
    if (el.state) {
      try { stateAttr = ' data-dsm-state="' + esc(btoa(unescape(encodeURIComponent(el.state)))) + '"' } catch {}
    }
    return `<div style="${box}${rot}"${cls}${fragIdx}>` +
      `<div class="fx-dsm"${stateAttr} data-dsm-panel="${el.showPanel ? 1 : 0}"` +
      ` data-dsm-toolbar="${el.showToolbar ? 1 : 0}"` +
      ` data-dsm-zoom="${el.showZoomButtons ? 1 : 0}"` +
      ` data-dsm-color="${esc(el.color)}"` +
      ` style="width:100%;height:100%;background:#fff;border:1px solid #e3dfd5;border-radius:4px;overflow:hidden">` +
      `<div class="dsm-host" style="width:100%;height:100%"></div></div></div>`
  }

  if (el.type === 'line') {
    const ptsN = el.points && el.points.length >= 4 ? el.points : [0,0,1,1]
    return `<div style="${box}${rot}"${cls}${fragIdx}><svg width="100%" height="100%" viewBox="0 0 ${el.w} ${el.h}" preserveAspectRatio="none" style="overflow:visible"><line x1="${ptsN[0]*el.w}" y1="${ptsN[1]*el.h}" x2="${ptsN[2]*el.w}" y2="${ptsN[3]*el.h}" stroke="${esc(el.stroke)}" stroke-width="${el.strokeWidth}" stroke-dasharray="${lineDashCss(el.strokeDash)}" vector-effect="non-scaling-stroke"/></svg></div>`
  }

  if (el.type === 'arrow') {
    const w = el.w, h = el.h
    const ptsN = el.points && el.points.length >= 4 ? el.points : [0.08,0.5,0.92,0.5]
    const ax = ptsN[0]*w, ay = ptsN[1]*h, tx = ptsN[2]*w, ty = ptsN[3]*h
    const style = el.arrowHead || 'triangle'
    const st = el.strokeWidth || 3
    const c = esc(el.stroke)
    const dx = tx - ax, dy = ty - ay
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len, uy = dy / len
    const size = Math.max(8, st * 3.2)
    let sx1 = ax, sy1 = ay, sx2 = tx, sy2 = ty
    let headPoly = '', headPath = '', head2Poly = ''
    if (style !== 'none') {
      sx2 = tx - ux * size * 0.4; sy2 = ty - uy * size * 0.4
      if (style === 'double') { sx1 = ax + ux * size * 0.4; sy1 = ay + uy * size * 0.4 }
    }
    const wings = (tipX: number, tipY: number, dX: number, dY: number) =>
      `${tipX - dX * size + (-dY) * size * 0.55},${tipY - dY * size + dX * size * 0.55} ${tipX - dX * size - (-dY) * size * 0.55},${tipY - dY * size - dX * size * 0.55}`
    if (style === 'triangle') headPoly = `${tx},${ty} ${wings(tx, ty, ux, uy)}`
    else if (style === 'stealth') headPoly = `${tx},${ty} ${wings(tx, ty, ux, uy)} ${tx - ux * size * 0.65},${ty - uy * size * 0.65}`
    else if (style === 'open') { const wg = wings(tx, ty, ux, uy).split(' '); headPath = `M ${tx} ${ty} L ${wg[0]} M ${tx} ${ty} L ${wg[1]}` }
    else if (style === 'double') { headPoly = `${tx},${ty} ${wings(tx, ty, ux, uy)}`; head2Poly = `${ax},${ay} ${wings(ax, ay, -ux, -uy)}` }
    const dash = lineDashCss(el.strokeDash)
    const lineTag = `<line x1="${sx1}" y1="${sy1}" x2="${sx2}" y2="${sy2}" stroke="${c}" stroke-width="${st}"${dash ? ` stroke-dasharray="${dash}"` : ''} vector-effect="non-scaling-stroke"/>`
    const headTags = (headPoly ? `<polygon points="${headPoly}" fill="${c}"/>` : '') + (headPath ? `<path d="${headPath}" stroke="${c}" stroke-width="${Math.max(2, st * 0.9)}" fill="none" stroke-linecap="round"/>` : '') + (head2Poly ? `<polygon points="${head2Poly}" fill="${c}"/>` : '')
    return `<div style="${box}${rot}"${cls}${fragIdx}><svg width="100%" height="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="overflow:visible">${lineTag}${headTags}</svg></div>`
  }

  if (el.type === 'pen') {
    const pts = (el.points ?? []).map((p) => `${p.x},${p.y}`).join(' ')
    return `<div style="${box}${rot}"${cls}${fragIdx}><svg width="100%" height="100%" viewBox="0 0 ${el.w} ${el.h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${esc(el.stroke)}" stroke-width="${el.strokeWidth}" vector-effect="non-scaling-stroke"/></svg></div>`
  }

  if (el.type === 'mathfig') {
    // 优先用**真组件**渲染（与画布逐像素一致）；失败才退回内置实现
    const real = renderFigureSvg(el)
    if (real) {
      const fitted = real.replace('<svg ', '<svg width="100%" height="100%" preserveAspectRatio="none" ')
      return `<div style="${box}${rot}"${cls}${fragIdx}>${fitted}</div>`
    }
    return `<div style="${box}${rot}"${cls}${fragIdx}><svg width="100%" height="100%" viewBox="0 0 ${el.w} ${el.h}" preserveAspectRatio="none">${figureInner(el.kind, el.w, el.h, el.stroke, el.strokeWidth, el.fill, el.points, el.strokeDash, el.depth, el.vlabels, el.edgeStyles, el.labelOffsets, el.faceStyles, el.mesh)}${arcsSvg(el.arcs, el.w, el.h, el.stroke, el.strokeWidth, '6 5', el.points)}</svg></div>`
  }

  if (el.type === 'chart') {
    return `<div style="${box}${rot}"${cls}${fragIdx}><svg width="100%" height="100%" viewBox="0 0 ${el.w} ${el.h}" preserveAspectRatio="none">${chartInner(el.chartType, el.labels, el.values, el.color, el.w, el.h)}</svg></div>`
  }

  if (el.type === 'table') {
    const cols = (el.rows[0] && el.rows[0].length) || 1
    const pad = el.cellPad ?? 6
    const align = el.cellAlign || 'center'
    const flat = el.rows.flat()
    const cellHtml = flat.map((cv, idx) => {
      const isH = idx < (el.rows[0]?.length || 0)
      const rowIdx = Math.floor(idx / cols)
      const bg = isH ? el.headerColor : (el.altRowColor && rowIdx % 2 === 0 ? el.altRowColor : '#ffffff')
      const col = isH ? (el.headerTextColor || '#ffffff') : (el.cellColor || '#111111')
      return '<div style="background:' + esc(bg) + ';color:' + esc(col) + ';font-weight:' + (isH ? 700 : 400) + ';padding:' + pad + 'px ' + (pad + 2) + 'px;text-align:' + align + ';overflow:hidden;word-break:break-word;box-sizing:border-box;line-height:1.4">' + esc(cv ?? '') + '</div>'
    }).join('')
    return `<div style="${box}${rot}"${cls}${fragIdx}><div style="display:grid;grid-template-columns:repeat(${cols},1fr);grid-auto-rows:auto;gap:1px;background:${esc(el.borderColor)};font-size:${el.fontSize}px">${cellHtml}</div></div>`
  }

  if (el.type === 'icon') {
    const size = Math.round(Math.min(el.w, el.h) * 0.72)
    return `<div style="${box}${rot}"${cls}${fragIdx}><div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;line-height:1;font-size:${size}px;color:${esc(el.color)}">${esc(el.icon)}</div></div>`
  }

  if (el.type === 'embed') {
    // 本地图片用 img；pdf/html/链接用 iframe（pdf 在导出页仍走 iframe，最佳努力）
    if (el.kind === 'image') {
      const src = el.dataBase64 ? `data:${esc(el.mime || 'image/png')};base64,${el.dataBase64}` : esc(el.url || '')
      return `<div style="${box}${rot}"${cls}${fragIdx}>` +
        (src ? `<img src="${src}" style="width:100%;height:100%;object-fit:contain;display:block" />` : `<div style="width:100%;height:100%;background:#f1efe8;border-radius:4px"></div>`) +
        `</div>`
    }
    if (el.kind === 'pdf') {
      return `<div style="${box}${rot}"${cls}${fragIdx}><div class="fx-doc" data-pdf-b64="${esc(el.dataBase64)}" style="width:100%;height:100%;background:#f3f1ee;border:1px solid #e3dfd5;border-radius:4px;overflow:auto"></div></div>`
    }
    const src = el.dataBase64
      ? `data:${esc(el.mime || 'text/html')};base64,${el.dataBase64}`
      : esc(el.url || '')
    return `<div style="${box}${rot}"${cls}${fragIdx}><div style="position:relative;width:100%;height:100%">` +
      (src ? `<iframe src="${src}" style="width:100%;height:100%;border:1px solid #e3dfd5;border-radius:4px" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerpolicy="no-referrer"></iframe>` : `<div style="width:100%;height:100%;background:#f1efe8;border-radius:4px"></div>`) +
      (el.kind === 'url' && el.url ? `<a href="${esc(el.url)}" target="_blank" rel="noopener" style="position:absolute;left:6px;bottom:6px;font-size:11px;color:#fff;background:rgba(20,24,34,0.72);padding:3px 8px;border-radius:6px;text-decoration:none;z-index:2;max-width:calc(100% - 12px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">↗ 打开链接</a>` : '') +
      `</div></div>`
  }

  if (el.type === 'richtex') {
    const hasBg = !!el.bgColor && el.bgColor !== 'transparent'
    const wrap = el.wrap === false ? 'pre' : 'pre-wrap'
    const jc = el.align === 'left' ? 'flex-start' : el.align === 'right' ? 'flex-end' : 'center'
    const inner = `width:100%;height:100%;box-sizing:border-box;overflow:hidden;word-break:break-word;white-space:${wrap};line-height:1.5;display:flex;align-items:center;justify-content:${jc};` +
      `color:${esc(el.color)};font-size:${el.fontSize}px;font-weight:${el.fontWeight};` +
      `font-family:${esc(fontStack(el.fontFamily))};` +
      `text-shadow:${esc(shadowCss(el.shadow))};` +
      `background:${hasBg ? esc(el.bgColor) : 'transparent'};` +
      `padding:${hasBg ? '6px 12px' : '0'};border-radius:${hasBg ? '6px' : '0'};`
    // 行属性：按 \n 分行，每行可单独设颜色/字体
    const richLines = String(el.text || '').split('\n')
    const lineHtml = richLines.map((ln, i) => {
      const ls = (el.lineStyles && el.lineStyles[i]) || null
      const mk = bulletMarker(el.bullet, i)
      const mkHtml = mk ? '<span style="display:inline-block;min-width:1.1em;margin-right:.35em">' + esc(mk) + '</span>' : ''
      const wrapStart = '<div style="' + paragraphLineStyle(el, i, richLines.length) + '">' + mkHtml
      let st = ''
      if (ls) { st = ' style="'; if (ls.color) st += 'color:' + esc(ls.color) + ';'; if (ls.fontFamily) st += 'font-family:' + esc(fontStack(ls.fontFamily)) + ';'; st += '"' }
      const bodyHtml = ls ? '<span' + st + '>' + esc(normalizeMixed(ln)) + '</span>' : esc(normalizeMixed(ln))
      return wrapStart + bodyHtml + '</div>'
    }).join('')
    return `<div style="${box}${rot}"${cls}${fragIdx}><div class="fx-mixed" data-cap="${el.fitMode === 'shrink' ? 1 : 4}" data-align="${el.align}" style="${inner}"><div class="fx-mixed-inner" style="width:fit-content;max-width:100%;transform-origin:${el.align === 'left' ? 'left' : el.align === 'right' ? 'right' : 'center'} center;text-align:${el.align};">${lineHtml}</div></div></div>`
  }

  // image
  const fx = imageEffectCss(el as any)
  // 裁剪为形状 / 非破坏性裁剪都要一个"裁剪框"层，跟编辑器里的结构保持一致
  const clip = 'width:100%;height:100%;' + imageMaskCss(el as any)
  const inner = `width:100%;height:100%;object-fit:${el.fit};display:block;border-radius:4px;` + (fx ? `;` + fx : ``)
  const fallback = `width:100%;height:100%;background:#f1efe8;`
  return `<div style="${box}${rot}"${cls}${fragIdx}>` +
    (el.src ? `<div style="${clip}"><img src="${esc(el.src)}" alt="" style="${inner}" /></div>` : `<div style="${fallback}"></div>`) +
    `</div>`
}

/** 渲染幻灯片，支持 Reveal 垂直堆叠：带子页（parentId）的父页包成上下滚动的嵌套 section */
function renderSlidesStack(slides: Slide[]): string {
  // 隐藏幻灯片：演示 / 导出时整页跳过（连同它的子页一起）——
  // 编辑器里还看得到（列表变暗），只是不参与放映。
  const hidden = new Set(slides.filter((s) => s.hidden).map((s) => s.id))
  const shown = slides.filter((s) => !s.hidden && !(s.parentId && hidden.has(s.parentId)))
  slides = shown
  const valid = new Set(slides.map((s) => s.id))
  const byParent = new Map<string, Slide[]>()
  for (const s of slides) {
    if (!s.parentId || !valid.has(s.parentId)) continue
    const a = byParent.get(s.parentId) ?? []
    a.push(s)
    byParent.set(s.parentId, a)
  }
  const out: string[] = []
  for (const s of slides) {
    if (s.parentId && valid.has(s.parentId)) continue
    const kids = byParent.get(s.id) ?? []
    const inner = [s, ...kids].map(slideToHtml).join('')
    out.push(kids.length ? '<section>' + inner + '</section>' : slideToHtml(s))
  }
  return out.join('')
}

export function slideToHtml(s: Slide): string {
  const body = s.elements.map(elementToHtml).join('\n')
  const notes = s.notes ? `<aside class="notes">${esc(s.notes)}</aside>` : ''
  const trans = s.transition ? ' data-transition="' + esc(s.transition) + '"' : ''
  const bgAttr = (s.bgImage || (s.bgGradient && s.bgGradient.stops && s.bgGradient.stops.length))
    ? ' style="background:' + esc(slideBgCss(s)) + '"'
    : ' data-background-color="' + esc(s.bg) + '"'
  return '<section data-slide-id="' + esc(s.id) + '"' + trans + bgAttr + '>' + body + notes + '</section>'
}
/** 生成完整的独立演示页 HTML */
export function renderDeckToRevealHtml(deck: Deck, opts: RenderOptions = {}): string {
  const local = (opts.assets ?? 'local') === 'local'
  const slides = renderSlidesStack(deck.slides)
  const hasMath = deck.slides.some((s) => s.elements.some((e) => e.type === 'math' || e.type === 'richtex'))
  const hasGgb = deck.slides.some((s) => s.elements.some((e) => e.type === 'geogebra'))
  const hasDesmos = deck.slides.some((s) => s.elements.some((e) => e.type === 'desmos'))
  const hasPdf = deck.slides.some((s) => s.elements.some((e) => e.type === 'embed' && (e as any).kind === 'pdf'))

  // 资源地址：
  // - local：blob URL 页面无法解析相对路径（blob 不是层级 URL），必须用主应用 origin 的绝对路径；
  //   Tauri(asset://) / dev(http://localhost) / 静态部署下 location.origin 都指向内嵌资源根。
  // - cdn：导出独立 HTML 文件用（文件不带资源，必须走 CDN）。
  const O = local ? `${window.location.origin}/` : ''
  const revTheme = deck.revealTheme || 'white'
  const R = local
    ? { revealCss: `${O}revealjs/reveal.css`, themeCss: `${O}revealjs/theme/${revTheme}.css`, revealJs: `${O}revealjs/reveal.js` }
    : {
        revealCss: 'https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.css',
        themeCss: `https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/${revTheme}.css`,
        revealJs: 'https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.js',
      }
  const mathSrc = local ? `${O}mathjax/tex-svg.js` : 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js'
  const ggbSrc = local ? `${O}geogebra/deployggb.js` : 'https://www.geogebra.org/apps/deployggb.js'
  const ggbEngine = local ? `${O}geogebra/5.0/web3d/` : 'https://www.geogebra.org/apps/latest/web3d/'
  const dsmSrc = local ? `${O}desmos/index.js` : 'https://www.desmos.com/api/v1.13/calculator.js?apiKey=dcb31709b452b1cf9dc26972add0fda6'
  const pdfSrc = local ? `${O}pdfjs/pdf.min.js` : 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js'
  const pdfWorker = local ? `${O}pdfjs/pdf.worker.min.js` : 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(deck.title)}</title>
<link rel="stylesheet" href="${R.revealCss}">
<link rel="stylesheet" href="${R.themeCss}">
<style>
  .reveal .slides section { width: ${deck.width}px; height: ${deck.height}px; }
  ${deck.font ? `.reveal { font-family: "${esc(deck.font)}", sans-serif !important; }` : ''}
  .fx-math mjx-container { max-width: 100%; margin: 0 !important; }
  /* 混排里的「显示公式」：收掉 MathJax 默认的 display:block + margin:1em 0（理由见 src/styles/main.css，
     那边是画布侧的同一条规则 —— 改一处务必改两处，导出/放映是独立文档） */
  .fx-mixed mjx-container[display="true"] { display: inline-flex !important; margin: 0 !important; }
  .fx-ggb .ggb-host { position: relative; }
  .fx-dsm .dsm-host { position: relative; }
  #fx-boot { position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
    background:#ffffff; color:#888780; font:14px/1.6 system-ui, sans-serif; z-index:99; }
  #fx-boot.hide { display:none; }
  /* 飞入 / 缩放的幅度：Reveal 内置只有 20px，投影后几乎看不出位移 ✗；
     这里按“从画面外进来”给百分比（相对元素自身大小），并用 :not(.visible) 提高优先级覆盖，
     不需要 !important。数值与编辑器 styles/anim.css 保持一致。 */
  .reveal .fragment.fade-up:not(.visible) { transform: translate(0, 110%); }
  .reveal .fragment.fade-down:not(.visible) { transform: translate(0, -110%); }
  .reveal .fragment.fade-left:not(.visible) { transform: translate(-130%, 0); }
  .reveal .fragment.fade-right:not(.visible) { transform: translate(130%, 0); }
  .reveal .fragment.zoom-in:not(.visible) { transform: scale(1.6); }
  .reveal .fragment.grow:not(.visible) { transform: scale(0.25); }
  .reveal .fragment.shrink:not(.visible) { transform: scale(1.9); }
  /* 强调动画（与编辑器 styles/anim.css 同一套 keyframes，时长/延迟走 --anim-dur/--anim-delay） */
  @keyframes anim-em-pulse { 0% { scale: 1 } 40% { scale: 1.18 } 70% { scale: .96 } 100% { scale: 1 } }
  @keyframes anim-em-bounce { 0%,100% { translate: 0 0 } 30% { translate: 0 -14px } 55% { translate: 0 0 } 75% { translate: 0 -6px } }
  @keyframes anim-em-shake { 0%,100% { translate: 0 0 } 20% { translate: -8px 0 } 40% { translate: 8px 0 } 60% { translate: -6px 0 } 80% { translate: 6px 0 } }
  @keyframes anim-em-spin { from { rotate: 0deg } to { rotate: 360deg } }
  @keyframes anim-em-grow { from { scale: 1 } to { scale: 1.25 } }
  @keyframes anim-em-shrink { from { scale: 1 } to { scale: .78 } }
  @keyframes anim-em-flash { 0%,100% { opacity: 1 } 25%,75% { opacity: .25 } 50% { opacity: 1 } }
  .anim-em-pulse { animation: anim-em-pulse var(--anim-dur, .6s) ease-in-out var(--anim-delay, 0s) both; }
  .anim-em-bounce { animation: anim-em-bounce var(--anim-dur, .6s) ease-in-out var(--anim-delay, 0s) both; }
  .anim-em-shake { animation: anim-em-shake var(--anim-dur, .6s) ease-in-out var(--anim-delay, 0s) both; }
  .anim-em-spin { animation: anim-em-spin var(--anim-dur, .6s) linear var(--anim-delay, 0s) both; }
  .anim-em-grow { animation: anim-em-grow var(--anim-dur, .6s) ease-in-out var(--anim-delay, 0s) both; }
  .anim-em-shrink { animation: anim-em-shrink var(--anim-dur, .6s) ease-in-out var(--anim-delay, 0s) both; }
  .anim-em-flash { animation: anim-em-flash var(--anim-dur, .6s) ease-in-out var(--anim-delay, 0s) both; }
  #fx-laser-canvas { position:fixed; inset:0; left:0; top:0; z-index:999; cursor:crosshair; touch-action:none; pointer-events:none; display:none; }
</style>
${hasMath ? `<script>
  window.MathJax = {
    tex: { inlineMath: [['\\\\(','\\\\)']], displayMath: [['$$','$$'], ['\\\\[','\\\\]']],
           macros: { R:'\\\\mathbb{R}', N:'\\\\mathbb{N}', Z:'\\\\mathbb{Z}', Q:'\\\\mathbb{Q}', C:'\\\\mathbb{C}', E:'\\\\mathbb{E}', comb:'\\\\binom{#1}{#2}', perm:'\\\\frac{#1!}{(#1-#2)!}', abs:'\\\\left|#1\\\\right|', norm:'\\\\left\\\\|#1\\\\right\\\\|', dd:'\\\\mathrm{d}', ee:'\\\\mathrm{e}', ii:'\\\\mathrm{i}', half:'\\\\frac{1}{2}' } },
    startup: { typeset: false }, svg: { fontCache: 'none' }
  };
<\/script>
<script src="${mathSrc}" async><\/script>` : ''}
${hasGgb ? `<script src="${ggbSrc}" async><\/script>` : ''}
${hasDesmos ? `<script src="${dsmSrc}" async><\/script>` : ''}
${hasPdf ? `<script>window.PDFJS_WORKER = ${JSON.stringify(pdfWorker)};<\/script>
<script src="${pdfSrc}" async><\/script>` : ''}

</head>
<body>
<div id="fx-boot">正在加载演示…</div>
<div class="reveal"><div class="slides">
${slides}
</div></div>
<canvas id="fx-laser-canvas"></canvas>
<script src="${R.revealJs}"><\/script>
<script src="${O}revealjs/plugin/notes.js"><\/script>
<script>
(function(){
  var GGB_ENGINE = ${JSON.stringify(ggbEngine)};
  // MathJax 是 async 加载的：Reveal ready 时可能尚未就绪，排队轮询直到可排版
  var mathQueue = [];
  // 串行化标志：MathJax 3 的 typesetPromise 内部是「先 document.reset() 再重排」，**不做串行化**。
  // 并发对同一个宿主调用会把「还没渲染完的那几行」再渲染一遍 —— 打印/导出 PDF 时公式行重复、
  // 溢出元素框就是这么来的（画布侧 MathElement.vue 早有同样的串行化保护，导出这条路径之前漏了）。
  var mathBusy = false;
  // 正在排版的那一批：只查 mathQueue 不够 —— 某一页可能已经被取走正在排，
  // 这时再把它入队就会在同一轮或下一轮被排第二遍（测试就是这么抓出来的）。
  var mathInFlight = [];
  // 排版完成后把每个公式等比缩放到它的元素框内（与编辑器行为一致）
  function fitMath(root){
    if (!root) return;
    var boxes = root.querySelectorAll('.fx-math');
    Array.prototype.forEach.call(boxes, function(box){
      var mjx = box.querySelector('mjx-container');
      if (!mjx) return;
      var nw = mjx.offsetWidth, nh = mjx.offsetHeight;
      if (!nw || !nh) return;
      // 缩放上限由元素的 data-cap 决定（fill=4 拖动放大 / shrink=1 只缩小），与编辑器画布一致
      var cap = parseFloat(box.getAttribute('data-cap') || '4') || 4;
      var f = Math.min(box.clientWidth / nw, box.clientHeight / nh, cap);
      if (!(f > 0)) return;
      mjx.style.transformOrigin = 'center center';
      mjx.style.transform = 'scale(' + f + ')';
      // 兜底：MathJax 异步重排后实际占位可能变大，按实际矩形复核，超了就缩回去（否则被裁）
      var hr = box.getBoundingClientRect(), tr = mjx.getBoundingClientRect();
      if (hr.width > 0 && hr.height > 0 && tr.width > 0 && tr.height > 0 && (tr.width > hr.width + 1 || tr.height > hr.height + 1)) {
        mjx.style.transform = 'scale(' + Math.max(0.02, f * Math.min(hr.width / tr.width, hr.height / tr.height)) + ')';
      }
    });
  }
  function fitMixed(root){
    if (!root || !root.querySelectorAll) return;
    var boxes = root.querySelectorAll('.fx-mixed');
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i], inner = box.querySelector('.fx-mixed-inner');
      if (!inner) continue;
      inner.style.transform = '';
      var bw = box.clientWidth, bh = box.clientHeight;
      var nw = inner.offsetWidth, nh = inner.offsetHeight;
      if (!(nw > 0 && nh > 0 && bw > 0 && bh > 0)) continue;
      var cap = parseFloat(box.getAttribute('data-cap') || '4') || 4;   // 与编辑器画布一致
      var f = Math.min(bw / nw, bh / nh, cap);
      // 原点必须与 flex 对齐一致：左对齐的内容贴左边缘，按 center 放大会有一半跑到框外被裁
      var al = box.getAttribute('data-align') || 'center';
      inner.style.transformOrigin = (al === 'left' ? 'left' : al === 'right' ? 'right' : 'center') + ' center';
      inner.style.transform = 'scale(' + f + ')';
      // 兜底：MathJax 异步重排后内容可能变大，按实际矩形复核，超了就缩回去
      var hr2 = box.getBoundingClientRect(), ir2 = inner.getBoundingClientRect();
      if (hr2.width > 0 && hr2.height > 0 && ir2.width > 0 && ir2.height > 0 && (ir2.width > hr2.width + 1 || ir2.height > hr2.height + 1)) {
        inner.style.transform = 'scale(' + Math.max(0.02, f * Math.min(hr2.width / ir2.width, hr2.height / ir2.height)) + ')';
      }
    }
  }
  /** 排一轮队：忙的时候只入队，等这一轮收尾后再接着排（全局唯一一处 typesetPromise 调用） */
  function pumpMath(){
    if (mathBusy) return true;                                            // 正在排版：等它结束
    if (!window.MathJax || !window.MathJax.typesetPromise) return false;  // 引擎还没就绪
    if (!mathQueue.length) return true;                                   // 没活干
    mathBusy = true;
    var items = mathQueue; mathQueue = [];
    mathInFlight = items;
    // 只排明确入队的宿主：不再用 undefined（那会重排整篇文档，正是最危险的一次 reset）
    window.MathJax.typesetPromise(items)
      .then(function(){ items.forEach(fitMath); items.forEach(fitMixed); })
      .catch(function(){})
      .then(function(){ mathBusy = false; mathInFlight = []; pumpMath(); });  // 收尾后接着排剩下的
    return true;
  }
  function typeset(root){
    // 同一个宿主只排一次：打印模式会对当前页 prepare 两次（ready 一次 + prepareAllForPrint 一次），
    // 排队中的和正在排的都要查，否则这一页会被排第二遍。
    if (root && mathQueue.indexOf(root) < 0 && mathInFlight.indexOf(root) < 0) mathQueue.push(root);
    return pumpMath();
  }
  var mathPoll = null, mathN = 0;
  function flushMath(){
    if (mathPoll) return;
    mathN = 0;
    mathPoll = setInterval(function(){
      if (typeset()) { clearInterval(mathPoll); mathPoll = null; }
      else if (++mathN > 120) { clearInterval(mathPoll); mathPoll = null; }   // 30s 超时
    }, 250);
  }
  // ---------- GeoGebra：轮询挂载，修复「ready 只触发一次而 deployggb 还没加载完」的时序 bug ----------
  // 按「元素」去重：同一个 ggb（相同内容 app+b64）在多个位置出现时，每个位置都要挂着实例。
  // 过去按内容键去重，导致同一 ggb 第二次出现时被直接跳过而空白。
  function tryMountOne(el){
    if (el.getAttribute('data-mounted') === '1') return true;
    if (!window.GGBApplet) return false;               // 引擎未就绪，等待下一轮
    var host = el.querySelector('.ggb-host');
    if (!host || !host.clientWidth || !host.clientHeight) return false;  // 布局未完成，等待下一轮
    el.setAttribute('data-mounted', '1');
    var params = {
      id: 'ggb_' + Math.random().toString(36).slice(2,10),
      appName: el.getAttribute('data-ggb-app') || 'classic',
      width: Math.round(host.clientWidth), height: Math.round(host.clientHeight),
      showToolBar: el.getAttribute('data-ggb-toolbar') === '1',
      showAlgebraInput: el.getAttribute('data-ggb-algebra') === '1',
      showMenuBar: el.getAttribute('data-ggb-menubar') === '1',
      showResetIcon: el.getAttribute('data-ggb-reset') === '1',
      enableShiftDragZoom: el.getAttribute('data-ggb-zoom') === '1',
      showAxis: el.getAttribute('data-ggb-axis') !== '0',
      showGrid: el.getAttribute('data-ggb-grid') === '1',
      borderColor: '#e3dfd5',
      // 让小程序随容器缩放（只缩小不放大），与编辑器 injectGeoGebra 一致，保证多个相同 applet 尺寸正确
      scaleContainerClass: 'ggb-fit',
      allowUpscale: false
    };
      var b64 = el.getAttribute('data-ggb-b64');
      if (b64) params.ggbBase64 = b64;
      // showAxis/showGrid 不能走构造参数 —— .ggb 文件自带视图设置会覆盖它们。
      // 必须在 appletOnLoad（引擎初始化完成）后用运行时 API 强制生效。
      // Apps API 实测：坐标轴是 setAxesVisible(x, y)，不存在单数的 setAxisVisible。
      var wantAxis = el.getAttribute('data-ggb-axis') !== '0';
      var wantGrid = el.getAttribute('data-ggb-grid') === '1';
      var wantAlgView = el.getAttribute('data-ggb-algview') !== '0';
      var wantApp = el.getAttribute('data-ggb-app') || 'classic';
      // 视角切换：本 5.0 web3d 引擎运行时无 showView/setView，唯一可控的是 setPerspective。
      // 优先用 getPerspectiveXML → 改代数视图(id=2) → setPerspective，保 3D/其他视图。
      function setAlgebraInPerspective(xml, show){
        var re = /(<view id="2"\\s[^>]*?visible=")(?:true|false)(")/g;
        if (re.test(xml)) return xml.replace(re, function(m,a,c){ return a + String(show) + c; });
        var ins = '<view id="2" visible="' + String(show) + '" inframe="true" stylebar="false" location="1,1,1,1" size="400" window="100,100,250,400" />';
        if (xml.indexOf('</views>') !== -1) return xml.replace('</views>', ins + '</views>');
        return xml;
      }
      function setPerspectiveForApp(api, app, showAlg){
        if (typeof api.setPerspective !== 'function') {
          if (typeof api.showView === 'function') api.showView(1, showAlg);
          return;
        }
        if (typeof api.getPerspectiveXML === 'function') {
          var xml = api.getPerspectiveXML();
          if (typeof xml === 'string' && xml) { api.setPerspective(setAlgebraInPerspective(xml, showAlg)); return; }
        }
        // 兜底：字母位串 A=代数 G=2D图形 T=CAS；3D 用命名视角 id
        if (app === '3d') api.setPerspective("Perspective.3DGraphics");
        else if (app === 'cas') api.setPerspective(showAlg ? 'AT' : 'T');
        else api.setPerspective(showAlg ? 'AG' : 'G');
      }
      params.appletOnLoad = function(api){
        try {
          if (typeof api.setAxesVisible === 'function') api.setAxesVisible(wantAxis, wantAxis);
          else if (typeof api.setAxisVisible === 'function') api.setAxisVisible(wantAxis);
          if (typeof api.setGridVisible === 'function') api.setGridVisible(wantGrid);
          setPerspectiveForApp(api, wantApp, wantAlgView);
        } catch(e) {}
      };
      try {
      var applet = new window.GGBApplet(params, true);
      // 先同步切到指定 codebase，再注入。之前用 fetch(HEAD).then 异步切 codebase，
      // 两个相同 applet 会竞态：第二个可能抢在切 codebase 前注入，用错 codebase 渲染成小尺寸/走样。
      if (typeof applet.setHTML5Codebase === 'function') {
        try { applet.setHTML5Codebase(GGB_ENGINE, true); } catch(e) {}
      }
      try { applet.inject(host); } catch(e) {}
      return true;
    } catch(e) { return false; }
  }
  var pendingGgb = [];
  function mountGgb(root){
    var els = (root || document).querySelectorAll('.fx-ggb');
    Array.prototype.forEach.call(els, function(el){ pendingGgb.push(el); });
    pollGgb();
  }
  var ggbPollTimer = null, ggbPollCount = 0;
  function pollGgb(){
    if (ggbPollTimer) return;
    ggbPollCount = 0;
    ggbPollTimer = setInterval(function(){
      pendingGgb = pendingGgb.filter(function(el){ return !tryMountOne(el); });
      ggbPollCount++;
      if (pendingGgb.length === 0 || ggbPollCount > 120) {   // 30 秒超时
        clearInterval(ggbPollTimer);
        ggbPollTimer = null;
      }
    }, 250);
  }
  // ---------- Desmos：轮询挂载（引擎 async 加载，ready 时可能尚未就绪） ----------
  var dsmDone = {};
  function tryMountDesmos(el){
    if (dsmDone[el]) return true;
    if (!window.Desmos || !window.Desmos.GraphingCalculator) return false;   // 引擎未就绪
    var host = el.querySelector('.dsm-host');
    if (!host || !host.clientWidth || !host.clientHeight) return false;      // 布局未完成
    dsmDone[el] = true;
    try {
      var calc = new window.Desmos.GraphingCalculator(host, {
        expressions: el.getAttribute('data-dsm-panel') !== '0',
        keypad: el.getAttribute('data-dsm-panel') !== '0',
        settingsMenu: el.getAttribute('data-dsm-toolbar') !== '0',
        expressionsTopbar: el.getAttribute('data-dsm-panel') !== '0',
        zoomButtons: el.getAttribute('data-dsm-zoom') !== '0',
        graphpaper: true
      });
      var st = el.getAttribute('data-dsm-state');
      if (st) {
        try { calc.setState(JSON.parse(decodeURIComponent(escape(atob(st))))); } catch(e) {}
      }
      return true;
    } catch(e) { return false; }
  }
  var pendingDsm = [];
  function mountDesmos(root){
    var els = (root || document).querySelectorAll('.fx-dsm');
    Array.prototype.forEach.call(els, function(el){ pendingDsm.push(el); });
    if (!window.__dsmPoll) {
      window.__dsmPoll = setInterval(function(){
        pendingDsm = pendingDsm.filter(function(el){ return !tryMountDesmos(el); });
        if (pendingDsm.length === 0) { clearInterval(window.__dsmPoll); window.__dsmPoll = null; }
      }, 250);
    }
  }
  function hideBoot(){
    var b = document.getElementById('fx-boot');
    if (b) b.classList.add('hide');
  }
  // ---------- PDF：轮询挂载（pdf.js async 加载后渲染 data-pdf-b64）----------
  var pendingPdf = [], pdfTimer = null, pdfN = 0;
  function renderPdfBox(box){
    if (!box.clientWidth) return;   // 布局未完成，下一轮再试
    var b64 = box.getAttribute('data-pdf-b64');
    if (!b64) { box.setAttribute('data-pdf-mounted','1'); return; }
    box.setAttribute('data-pdf-mounted','1');
    try {
      var bytes = atob(b64);
      var arr = new Uint8Array(bytes.length);
      for (var i=0;i<bytes.length;i++) arr[i] = bytes.charCodeAt(i);
      box.innerHTML = '';
      window.pdfjsLib.getDocument({ data: arr }).promise.then(function(doc){
        var W = box.clientWidth || 480;
        var chain = Promise.resolve();
        for (var pi=1; pi<=doc.numPages; pi++){
          (function(pgnum){
            chain = chain.then(function(){ return doc.getPage(pgnum); }).then(function(page){
              var v1 = page.getViewport({ scale: 1 });
              var dpr = window.devicePixelRatio || 1;
              var scale = Math.max(0.2, (W / v1.width) * dpr);   // 按设备像素比渲染，高分屏不模糊
              var viewport = page.getViewport({ scale: scale });
              var canvas = document.createElement('canvas');
              canvas.width = viewport.width; canvas.height = viewport.height;
              canvas.style.width = '100%'; canvas.style.display = 'block'; canvas.style.marginBottom = '8px';
              return page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise.then(function(){ box.appendChild(canvas); });
            });
          })(pi);
        }
        chain.then(function(){ try { doc.destroy(); } catch(e){} });
      }).catch(function(){ box.innerHTML = '<div style="padding:12px;color:#a33;font-size:13px">PDF 渲染失败</div>'; });
    } catch(e) { box.innerHTML = '<div style="padding:12px;color:#a33;font-size:13px">PDF 渲染失败</div>'; }
  }
  function mountPdf(root){
    var els = (root || document).querySelectorAll('.fx-doc[data-pdf-b64]');
    Array.prototype.forEach.call(els, function(box){ pendingPdf.push(box); });
    if (pendingPdf.length && !pdfTimer) { pdfN = 0; pdfTimer = setInterval(pdfTick, 250); }
  }
  function pdfTick(){
    if (!window.pdfjsLib) { if (++pdfN > 120) { clearInterval(pdfTimer); pdfTimer = null; } return; }
    try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = window.PDFJS_WORKER; } catch(e) {}
    var remain = [];
    Array.prototype.forEach.call(pendingPdf, function(box){
      if (!box.getAttribute('data-pdf-mounted')) renderPdfBox(box);
      if (!box.getAttribute('data-pdf-mounted')) remain.push(box);
    });
    pendingPdf = remain;
    if (pendingPdf.length === 0) { clearInterval(pdfTimer); pdfTimer = null; }
  }
  function prepare(slide){
    if (!slide) return;
    if (!typeset(slide)) flushMath();   // MathJax 未就绪时启动轮询
    (function(){ var fc = 0; var fk = function(){ fitMixed(slide); if (++fc < 5) requestAnimationFrame(fk); }; requestAnimationFrame(fk); })();
    setTimeout(function(){ mountGgb(slide); }, 120);
    mountDesmos(slide);
    setTimeout(function(){ mountPdf(slide); }, 120);
  }
  if (window.Reveal) {
    var PRINT_MODE = ${JSON.stringify(!!opts.print)};
    Reveal.initialize({
      width: ${deck.width}, height: ${deck.height}, margin: 0,
      center: true, hash: false, controls: !PRINT_MODE, progress: !PRINT_MODE,
      transition: ${JSON.stringify(deck.transition || 'slide')},
      transitionSpeed: ${JSON.stringify(deck.transitionSpeed || 'default')},
      view: PRINT_MODE ? 'print' : null,
      plugins: window.RevealNotes ? [window.RevealNotes] : []
    });
    function tellHost(){ try { parent.postMessage(JSON.stringify({ type: 'fx-index', index: Reveal.getIndices().h }), '*'); } catch(err){} }
    Reveal.on('ready', function(e){
      hideBoot();
      prepare(e && e.currentSlide);
      setTimeout(tellHost, 120);
      if (PRINT_MODE) prepareAllForPrint();
    });
    Reveal.on('slidechanged', function(e){
      prepare(e && e.currentSlide);
      tellHost();
    });
    // 强调动画：元素出现后再播一次（去类→强制回流→加回，保证连点也能重播）
    Reveal.on('fragmentshown', function(e){
      var f = e && e.fragment;
      if (!f || !f.getAttribute) return;
      var em = f.getAttribute('data-anim-em');
      if (!em) return;
      var c = 'anim-em-' + em;
      f.classList.remove(c);
      void f.offsetWidth;
      f.classList.add(c);
    });
    // ---------- 打印模式：全部页面挂载 + 就绪通知 ----------
    // view:'print' 下 Reveal 把每页包成 .pdf-page 堆叠展示（无 transform），
    // ready 只给 currentSlide，必须手动对每一页做 MathJax/GGB/Desmos/pdf 挂载。
    function prepareAllForPrint(){
      var pages = document.querySelectorAll('.reveal .slides section');
      Array.prototype.forEach.call(pages, function(pg){ prepare(pg); });
      var calm = 0, ticks = 0;
      var pollReady = setInterval(function(){
        // 挂载队列全部排空才算就绪；连续两轮安静 + 400ms 缓冲，保证 MathJax 缩放收尾
        var busy = !!(mathBusy || mathQueue.length || mathPoll || ggbPollTimer || pendingGgb.length || pendingDsm.length || pendingPdf.length);
        calm = busy ? 0 : calm + 1;
        if (calm >= 2 || ++ticks > 160) {   // 最长 ~40s 放弃等待，尽力输出
          clearInterval(pollReady);
          setTimeout(notifyPrintReady, 400);
        }
      }, 250);
      // 兜底：pdf-ready 后 6s 强制通知（GGB 引擎 30s 超时太久，别让用户干等）
      Reveal.on('pdf-ready', function(){
        setTimeout(notifyPrintReady, 6000);
      });
    }
    var printNotified = false;
    function notifyPrintReady(){
      if (printNotified) return;
      printNotified = true;
      try { parent.postMessage(JSON.stringify({ type: 'fx-print-ready' }), '*'); } catch(err) {}
    }
  } else {
    hideBoot();
  }
  // 演示页运行在 iframe 里：跨文档按键不会冒泡到父窗口，
  // ESC 退出必须在这里捕获并 postMessage 通知宿主（PresentationOverlay 监听 message）
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape') { try { parent.postMessage('fx-present-esc', '*'); } catch(err) {} }
  });
  // 激光笔坐标：iframe 内的鼠标事件不会冒泡到父窗口，
  // 这里把鼠标坐标转发给宿主（rAF 节流，与 ESC 一样走 postMessage）。
  // iframe 铺满 .present(inset:0)，所以 iframe 视口坐标 == 宿主视口坐标，可直接定位 fixed 激光点。
  var __laserPend = false, __laserX = 0, __laserY = 0;
  document.addEventListener('mousemove', function(e){
    __laserX = e.clientX; __laserY = e.clientY;
    if (__laserPend) return;
    __laserPend = true;
    window.requestAnimationFrame(function(){
      __laserPend = false;
      try { parent.postMessage(JSON.stringify({ type: 'fx-laser', x: __laserX, y: __laserY }), '*'); } catch(err) {}
    });
  });
  // ---------- 激光笔书写：让画布自己捕获指针（pointer-events:auto + 置顶 + setPointerCapture），
  // 按下即画、松手即停；画布在最上层，不会穿透到幻灯片文字而选中。 ----------
  var fxLaserCanvas = document.getElementById('fx-laser-canvas');
  var fxLaserCtx = fxLaserCanvas ? fxLaserCanvas.getContext('2d') : null;
  var fxLaserOn = false, fxLaserColor = '#ff3b30', fxLaserDown = false;
  function fxResizeLaser(){
    if (!fxLaserCanvas) return;
    var d = window.devicePixelRatio || 1;
    fxLaserCanvas.width = Math.floor(window.innerWidth * d);
    fxLaserCanvas.height = Math.floor(window.innerHeight * d);
    if (fxLaserCtx) fxLaserCtx.setTransform(d, 0, 0, d, 0, 0);
  }
  fxResizeLaser();
  window.addEventListener('resize', fxResizeLaser);
  window.addEventListener('message', function(ev){
    var d = ev.data;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch(err) { return; } }
    if (!d || typeof d !== 'object') return;
    if (d.type === 'fx-laser-on') {
      fxLaserOn = !!d.on;
      if (fxLaserCanvas) {
        fxLaserCanvas.style.display = fxLaserOn ? 'block' : 'none';
        fxLaserCanvas.style.pointerEvents = fxLaserOn ? 'auto' : 'none';
      }
      document.body.style.userSelect = fxLaserOn ? 'none' : '';
    } else if (d.type === 'fx-laser-color') {
      fxLaserColor = typeof d.color === 'string' ? d.color : fxLaserColor;
    } else if (d.type === 'fx-laser-clear') {
      if (fxLaserCtx) fxLaserCtx.clearRect(0, 0, fxLaserCanvas.width, fxLaserCanvas.height);
    }
  });
  if (fxLaserCanvas) {
    fxLaserCanvas.addEventListener('pointerdown', function(e){
      if (!fxLaserOn || e.button !== 0) return;
      fxLaserDown = true;
      if (fxLaserCtx) {
        fxLaserCtx.strokeStyle = fxLaserColor;
        fxLaserCtx.lineWidth = 3;
        fxLaserCtx.lineCap = 'round';
        fxLaserCtx.lineJoin = 'round';
        fxLaserCtx.beginPath();
        fxLaserCtx.moveTo(e.clientX, e.clientY);
      }
    });
    fxLaserCanvas.addEventListener('pointermove', function(e){
      if (!fxLaserOn || !fxLaserDown) return;
      if (fxLaserCtx) { fxLaserCtx.lineTo(e.clientX, e.clientY); fxLaserCtx.stroke(); }
    });
    fxLaserCanvas.addEventListener('pointerup', function(){ fxLaserDown = false; });
    fxLaserCanvas.addEventListener('pointercancel', function(){ fxLaserDown = false; });
  }
})();
<\/script>
</body>
</html>`
}