import { createApp, h } from 'vue'
import MathFigureElement from '@/components/elements/MathFigureElement.vue'
import { createElement } from '@/types'
import type { MathFigureElement as MFigEl, MathFigureKind, SlideElement } from '@/types'
import { figureBox } from '@/composables/mathPlot'

/**
 * 数学图形的"共用渲染"。
 *
 * v1229 的教训：曾经 renderer 里另写了一份手绘实现（figureInner ✗），只覆盖一部分 kind，
 * 缺的那批渲染成空 SVG —— 缩略图/演示/导出里全空白。改成**挂载真组件读它的 <svg>**，
 * 从此只有一份实现。现在画布格子插图（表格）也走这里，**同一个函数**。
 */

/** 按"真正插入时"的参数造一个 mathfig 元素（图形库、表格标记共用同一套默认值） */
export function mathFigureElOfKind(kind: MathFigureKind): MFigEl {
  const extra = kind === 'custom'
    ? { custom: { expr: 'x^2-2x+1', x0: -2, x1: 4, y0: -2, y1: 6, grid: true, axes: true }, w: 420, h: 300 }
    : {}
  const el = createElement('mathfig', { x: 0, y: 0 })
  Object.assign(el, { kind, ...(figureBox(kind) || {}), ...extra })
  return el as MFigEl
}

/** 用**真正的图形组件**渲染出一段 SVG 标记；失败返回空串（调用方自行兜底） */
export function renderFigureSvg(el: SlideElement): string {
  try {
    const host = document.createElement('div')
    const app = createApp({ render: () => h(MathFigureElement as never, { el } as never) })
    app.mount(host)
    const svg = host.querySelector('svg')
    const out = svg ? svg.outerHTML : ''
    app.unmount()
    return out
  } catch (err) {
    console.warn('[图形] 渲染失败', err)
    return ''
  }
}

/** 单元格里的图形标记：{{fig:cube}} —— 也可写 {{fig:cube}} 之外什么都不加 */
export const FIG_MARK_RE = /\{\{fig:([A-Za-z0-9_]+)\}\}/g

/**
 * 把文本里的 {{fig:kind}} 换成**行内 SVG**（高度跟随字号，1.35em）。
 * 用在表格单元格、以及导出的单元格正文里 —— 两边共用，保证一致。
 */
export function inlineFiguresInText(text: string): string {
  if (!text || text.indexOf('{{fig:') < 0) return text
  return text.replace(FIG_MARK_RE, (whole, kind: string) => {
    const el = mathFigureElOfKind(kind as MathFigureKind)
    const svg = renderFigureSvg(el)
    if (!svg) return whole
    // 组件给的 svg 带 width/height="100%"，这里用 style 覆盖（CSS 优先于表现属性）
    const fitted = svg.replace('<svg ', '<svg style="height:100%;width:auto;vertical-align:middle" ')
    return '<span class="tbl-fig" style="display:inline-block;height:1.35em;vertical-align:-0.32em">' + fitted + '</span>'
  })
}
