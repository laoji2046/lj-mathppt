import { createApp, h } from 'vue'
import MathFigureElement from '@/components/elements/MathFigureElement.vue'
import { createElement } from '@/types'
import type { MathFigureElement as MFigEl, MathFigureKind, SlideElement } from '@/types'
import { CONICS, DEFAULT_PIECEWISE, conicLineRoots, figureBox, mapper, withParams } from '@/composables/mathPlot'
import { THM_LABELS } from '@/composables/solid3d'
import { SOLID_FIGURE_PRESETS } from '@/templates/solidFigures'
import type { TikzGeomSolver, TikzSpec } from '@/composables/tikzFigure'
import type { Deck } from '@/types'
import type { View } from '@/composables/mathPlot'

/**
 * 数学图形的"共用渲染"。
 *
 * v1229 的教训：曾经 renderer 里另写了一份手绘实现（figureInner ✗），只覆盖一部分 kind，
 * 缺的那批渲染成空 SVG —— 缩略图/演示/导出里全空白。改成**挂载真组件读它的 <svg>**，
 * 从此只有一份实现。现在画布格子插图（表格）也走这里，**同一个函数**。
 */

/** 按"真正插入时"的参数造一个 mathfig 元素（图形库、表格标记共用同一套默认值） */
export function mathFigureElOfKind(kind: MathFigureKind): MFigEl {
  const thm = THM_LABELS[kind as string]
  const extra = kind === 'custom'
    ? { custom: { expr: 'x^2-2x+1', x0: -2, x1: 4, y0: -2, y1: 6, grid: true, axes: true }, w: 420, h: 300 }
    : kind === 'piecewiseFn'
      ? { pw: { ...DEFAULT_PIECEWISE, lines: DEFAULT_PIECEWISE.lines.map((l) => ({ ...l })) }, w: 440, h: 300 }
      : thm
        ? { vlabels: [...thm], w: 420, h: 260 }
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

/**
 * 单元格里的图形标记：{{fig:cube}}
 * 取值可以是：
 *   ① 图形库的 kind 代号（cube / linear / sine / circle / parabola / cylinder …，共 74 种）
 *   ② **图形重建**那批 preset 的**名字**（如 {{fig:正方体 ABCD-A₁B₁C₁D₁（含三棱锥）}}）—— 它们不是 kind，
 *      但用户常用的四棱锥/正方体都在那里，所以按名字也认一遍。
 * 名字里可能有空格/中文，所以这里不限制字符集，只到第一个 }} 为止。
 */
export const FIG_MARK_RE = /\{\{fig:([^{}:]+)(?::(\d+))?\}\}/g

/** 按名字找图形重建 preset */
function presetByName(name: string) {
  const n = name.trim()
  return SOLID_FIGURE_PRESETS.find((p) => p.name === n || p.name.split(/[（(]/)[0].trim() === n)
}

/** 把一个 preset 变成 mathfig 元素（与图形库插入时同一套参数） */
function elOfPreset(p: (typeof SOLID_FIGURE_PRESETS)[number]): SlideElement {
  const el = createElement('mathfig', { x: 0, y: 0 })
  Object.assign(el, { ...p.el, w: p.w, h: p.h, fill: 'transparent', stroke: '#1a1a1a', strokeWidth: 2.8 })
  return el
}

/* ===========================================================================
 * 【v1652】TikZ → 图形：把解析结果落成真元素
 * =========================================================================*/

/** 某类图形"当前参数下"的取景（与 MathFigureElement 里用的是同一个函数 ✓） */
function viewOfSpec(kind: string, params: Record<string, number>): View {
  const def = CONICS[kind]
  if (!def) return { xmin: -6, xmax: 6, ymin: -4.5, ymax: 4.5 }
  const pv = withParams(kind, params)
  return def.viewOf ? def.viewOf(pv) : def.view
}

/** 交给 TikZ 解析器的"应用自己的几何"：弦与曲线的交点、当前取景 —— 解析器里**不重写一份** ✓ */
export const tikzSolver: TikzGeomSolver = {
  lineRoots: (kind, params, line) => conicLineRoots(kind, params, line),
  view: (kind, params) => viewOfSpec(kind, params),
}

/** 把一份 TikZ 解析结果变成 mathfig 元素（尺寸与图形库插入时同一套口径 ✓） */
export function tikzSpecToElement(spec: TikzSpec): MFigEl {
  const el = mathFigureElOfKind(spec.kind as MathFigureKind)
  const box = figureBox(spec.kind) || { w: 520, h: 400 }
  Object.assign(el, {
    w: box.w,
    h: box.h,
    params: { ...(el.params || {}), ...spec.params },
    pointLabels: spec.points.map((p) => p.label),
    pointLinks: spec.links.slice(),                 // 【v1654】钉在"弦与曲线交点"上的点（null = 自由点）
  })
  return el as MFigEl
}

/**
 * 把 markdown 导入留下的图片占位 ![](tikz:N) **就地**换成真图形元素（位置不动）。
 *
 * 另外：TikZ 的 \node at (x,y){$A$} 这类**自由文字**，曲线图元里没有对应项
 * （它只有"标注点 + 字母"），所以单独落成**文字元素**叠在图上 —— 位置按图形自己的取景换算，
 * 学生看是一张图，老师想改就单独拖那个文字框 ✓
 */
export function attachTikzFigures(deck: Deck, specs: TikzSpec[]): { figures: number; texts: number; orphans: number } {
  let figures = 0, texts = 0, orphans = 0
  for (const slide of deck.slides) {
    const next: typeof slide.elements = []
    for (const item of slide.elements) {
      const src = item.type === 'image' ? String((item as { src?: string }).src || '') : ''
      // ⚠ 这个反斜杠丢过一次（写成 /^tikz:(d+)$/，只认字面量 "d"）→ 占位永远匹配不上，
      //   幻灯片上就留一个**破图框** ✗（用户实报）。当时探针是"照抄一份替换逻辑"跑的，
      //   没调到这个函数，所以没抓住 —— 现在探针直接调真函数 ✓
      const mm = /^tikz:(\d+)$/.exec(src)
      const spec = mm ? specs[Number(mm[1])] : undefined
      if (!spec) {
        // 【v1656】认得出是"我们的 TikZ 占位"却找不到对应图形 → **绝不能留破图框**：换成一行说明 ✓
        if (mm) {
          const note = createElement('text', { x: item.x, y: item.y, w: Math.max(600, item.w || 900), h: 60 })
          Object.assign(note, { text: '（此处原为 TikZ 图形，没能落到幻灯片上）', fontSize: 22, align: 'left', color: '#b42318' })
          next.push(note)
          orphans++
          continue
        }
        next.push(item); continue
      }
      const fig = tikzSpecToElement(spec)
      fig.x = Math.max(0, Math.round(((deck.width || 1920) - fig.w) / 2))
      fig.y = item.y
      next.push(fig)
      figures++
      const view = viewOfSpec(spec.kind, spec.params)
      const mp = mapper(view, fig.w, fig.h)
      const fs = Math.max(12, Math.round(Math.min(fig.w, fig.h) * 0.055 * 0.85))
      for (const t of spec.texts) {
        const w = Math.max(60, fs * 3)
        const txt = createElement('text', { x: fig.x + mp.X(t.x) - w / 2, y: fig.y + mp.Y(t.y) - fs, w, h: fs * 2 })
        Object.assign(txt, { text: t.text, fontSize: fs, align: 'center', color: '#1a1a1a' })
        next.push(txt)
        texts++
      }
    }
    slide.elements = next
  }
  return { figures, texts, orphans }
}

/**
 * 【v1657】把"这条问题带的**附件原图**"贴进幻灯片（用户要求：题目本来就有图，就别重建数学图形了 ✓）
 * 放在第一页文字的**下面**，与题库「插入幻灯片」同一套排版（图片元素 + contain，不裁不拉 ✓）。
 * 放在这个文件（而不是面板里）是为了**能被探针直接测到** ✓ —— 上一轮"探针照抄逻辑"的教训。
 */
export function attachPics(deck: Deck, pics: string[], opt: { x?: number; w?: number; h?: number } = {}): number {
  const s0 = deck.slides && deck.slides[0]
  if (!s0 || !pics.length) return 0
  const els = s0.elements as { y?: number; h?: number }[]
  let y = 40
  for (const e of els) y = Math.max(y, (Number(e.y) || 0) + (Number(e.h) || 0) + 16)
  const x = opt.x ?? 48, w = opt.w ?? 900, h = opt.h ?? 560
  let n = 0
  for (const src of pics.slice(0, 4)) {
    if (!src) continue
    const el = createElement('image', { x, y: Math.round(y), w, h })
    Object.assign(el, { src, fit: 'contain' })
    s0.elements.push(el)
    y += h + 16
    n++
  }
  return n
}

/**
 * 把文本里的 {{fig:kind}} 换成**行内 SVG**（高度跟随字号，1.35em）。
 * 用在表格单元格、以及导出的单元格正文里 —— 两边共用，保证一致。
 */
export function inlineFiguresInText(text: string, defaultPx?: number): string {
  if (!text || text.indexOf('{{fig:') < 0) return text
  // 整段就一个图形标记（教材"图像"格那种）→ 当成块级大图居中，默认 7.5em（≈128px，占大半格）
  const solo = text.trim().match(/^\{\{fig:([^{}:]+)(?::(\d+))?\}\}$/)
  return text.replace(FIG_MARK_RE, (whole, name: string, px?: string) => {
    const preset = presetByName(name)
    const el = preset ? elOfPreset(preset) : mathFigureElOfKind(name.trim() as MathFigureKind)
    const svg = renderFigureSvg(el)
    // 认不出来的 kind / 名字 → **原样留着**，别让它悄悄消失（打错字要看得出来）
    if (!svg || !/[<(](path|line|polygon|polyline|circle|ellipse|rect)\b/.test(svg)) return whole
    // 组件给的 svg 带 width/height="100%"，这里用 style 覆盖（CSS 优先于表现属性）
    // 高度：带 :数字 就用它（px，图独占一格时用），不带则跟随字号。
    // ⚠ 宽度必须按**元素自身的宽高比显式算出来** —— 只写 width:auto 的话，
    //   inline-block 的宽度又指望里面的 svg，两头互等 → 算成 0 宽 ✗（DOM 里有、画出来看不见）
    const ratio = (el.w && el.h) ? el.w / el.h : 1.6
    const soloHere = !!solo && solo[1] === name.trim()
    // 优先级：标记里的 :数字 > 表格设定的 figHeight > 内置默认
    // 注意 Number()：表格的 figHeight 可能以字符串传进来（输入框），不转就会走成非法长度
    const pxNum = px ? Number(px) : (defaultPx && Number(defaultPx) > 0 ? Number(defaultPx) : 0)
    const em = soloHere ? 7.5 : 1.6
    const h = pxNum ? pxNum + 'px' : em + 'em'
    const w = pxNum ? Math.round(pxNum * ratio) + 'px' : (em * ratio).toFixed(2) + 'em'
    const fitted = svg.replace('<svg ', '<svg style="width:100%;height:100%;display:block" ')
    const box = soloHere && !pxNum
      ? 'display:block;margin:3px auto;height:' + h + ';width:' + w + ';max-width:100%'
      : 'display:inline-block;height:' + h + ';width:' + w + ';max-width:100%;vertical-align:' + (pxNum ? 'middle' : '-0.32em')
    return '<span class="tbl-fig" style="' + box + '">' + fitted + '</span>'
  })
}
