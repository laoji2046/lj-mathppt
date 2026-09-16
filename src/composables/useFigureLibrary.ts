/**
 * 数学图形库 —— 第三期。
 *
 * 存的是**图形的配置**（kind + params + 样式 + 尺寸），不是图片：
 *   body   = 图形种类 kind
 *   meta   = { params, fill, stroke, strokeWidth, w, h, depth, ... }
 * 插入时用这份配置重建一个 mathfig 元素，所以插进去仍然**可调参数**。
 */
import { libQuery, libSave, libRemove, libBump } from './useLibrary'
import type { LibItem } from './useLibrary'

/** 需要保留下来的图形配置字段（其余如坐标不存 —— 插入位置由当时决定） */
const KEEP = ['params', 'fill', 'stroke', 'strokeWidth', 'w', 'h', 'depth', 'showDots', 'vlabels'] as const

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
