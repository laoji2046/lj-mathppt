/**
 * 数学图形库 —— 第三期。
 *
 * 存的是**图形的配置**（kind + 几何 + 样式 + 尺寸），不是图片：
 *   body   = 图形种类 kind
 *   meta   = { params, points, mesh, vlabels, ctrl, pw, fill, stroke, ... }
 * 插入时用这份配置重建一个 mathfig 元素，所以插进去仍然**可调参数 / 可继续拖顶点**。
 */
import { libQuery, libSave, libRemove, libBump } from './useLibrary'
import type { LibItem } from './useLibrary'

/**
 * 需要保留下来的图形配置字段（其余如 x/y 不存 —— 插入位置由当时决定）。
 *
 * ⚠ 这里原来**只存参数和样式、不存几何** → 拖过顶点的立体图形"存入图形库"再插出来
 *   会**变回默认形状** ✗（顶点表 points、自由建模 mesh、字母偏移、每条棱/面的样式全丢了）。
 *   现在把几何与各图形自己的配置一起存，于是"自己搭的立体图形"能存成复刻条目、一键插回。 */
const KEEP = [
  // 样式与尺寸
  'params', 'fill', 'stroke', 'strokeWidth', 'w', 'h', 'depth', 'showDots', 'vlabels',
  // 几何：顶点表 / 自由建模网格 / 字母偏移 / 每条棱、每个面的样式 / 弦式弧
  'points', 'mesh', 'labelOffsets', 'edgeStyles', 'faceStyles', 'arcs',
  // 各图形自己的配置：自定义函数、分段函数、平面图形控制点、圆锥曲线的颜色与标注
  'custom', 'pw', 'ctrl', 'arcSweep',
  'conicStroke', 'axisColor', 'lineColors', 'pointColors', 'pointLabels', 'pointLinks', 'lineLinks',
] as const

export interface FigureEntry extends LibItem {
  kind: string
  cfg: Record<string, unknown>
}

function toEntry(it: LibItem): FigureEntry {
  return { ...it, kind: it.body, cfg: (it.meta || {}) as Record<string, unknown> }
}

export async function listFigures(): Promise<FigureEntry[]> {
  return (await libQuery('figure')).map(toEntry)
}

/** 从一个 mathfig 元素里抽出可复用的配置 */
export function extractFigureConfig(el: Record<string, unknown>): { kind: string; cfg: Record<string, unknown> } {
  const kind = String(el.kind || '')
  const cfg: Record<string, unknown> = {}
  for (const k of KEEP) {
    if (el[k] !== undefined) cfg[k] = el[k]
  }
  return { kind, cfg }
}

/** 把当前选中的图形存入图形库 */
export async function saveFigureToLibrary(
  el: Record<string, unknown>,
  title: string
): Promise<number> {
  const { kind, cfg } = extractFigureConfig(el)
  if (!kind) return 0
  return libSave({
    type: 'figure',
    title: title.trim() || kind,
    body: kind,
    meta: cfg,
    tags: '我的图形',
    source: '自建',
    builtin: 0,
  })
}

export async function removeFigure(id: number): Promise<boolean> {
  return libRemove(id)
}

export async function touchFigure(id: number): Promise<void> {
  await libBump(id)
}

export function filterFigures(list: FigureEntry[], q: string): FigureEntry[] {
  const k = q.trim().toLowerCase()
  if (!k) return list
  return list.filter((x) => x.title.toLowerCase().includes(k) || x.kind.toLowerCase().includes(k))
}
