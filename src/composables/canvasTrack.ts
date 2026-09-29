/**
 * 【v1734】CanvasTracker：绘图板上"有什么、谁画的、依赖谁、长什么样" ✓
 *
 * 依据 Draw2Think 的 L4（Memory）：画布状态 + 轨迹 —— **对象 / 依赖图 / 样式** ✓
 *   · 没有它，就答不了这两个老师一定会问的问题：
 *     ① 「删掉这个会连带掉什么？」✗（只能靠猜 ✓）
 *     ② 「这块是谁画的？」（这次 AI 画的 / 上次 AI 画的 / 我自己画的 ✓）
 *
 * 设计：**纯函数**（探针能盯 ✓）—— 输入是「对象名 + 定义字符串 + 已知来源」，
 *   不碰浏览器、不碰 GeoGebra ✓（样式由调用方通过 styleOf 传进来 ✓）。
 * 依赖关系复用 `ggbRefsOf` 那套判据（函数名不算引用 ✓ 定义名不算引用 ✓）。
 */
import { ggbRefsOf } from './ggbSolve'

/** 来源：这次 AI 画的 / 上次 AI 画的 / 老师手画的 */
export type TrackOrigin = 'ai' | 'ai-prev' | 'user'

export interface TrackItem {
  name: string
  origin: TrackOrigin
  /** 定义字符串（GeoGebra 的 getDefinitionString ✓） */
  def: string
  /** 依赖（父）：这个对象用到了谁 ✓ */
  refs: string[]
  /** 被依赖（子）：谁用到了它 ✓ */
  deps: string[]
  /** 样式摘要（颜色 / 粗细 / 是否隐藏 ✓ 拿不到就不写 ✓） */
  style?: string
}

/** 【v1734】判定一个对象的来源（纯函数 ✓）：
 *  · 传了**运行前快照** beforeDefs 时：新出现的 / 定义被改过的 → 这次 AI 画的 ✓
 *  · 快照为空（比如"只是想看看板上有啥"）：只能按上次 AI 名单分 → 上次 AI / 手画 ✓
 */
export function trackOrigin(
  name: string,
  beforeDefs: Record<string, string> = {},
  prevAi: string[] = [],
  nowDefs: Record<string, string> = {},
): TrackOrigin {
  const inPrev = (prevAi || []).indexOf(name) >= 0
  if (!beforeDefs || !Object.keys(beforeDefs).length) return inPrev ? 'ai-prev' : 'user'
  if (!(name in beforeDefs)) return 'ai'                 // 新出现的
  if (String(beforeDefs[name] ?? '') !== String(nowDefs[name] ?? '')) return 'ai'   // 定义被改过
  return inPrev ? 'ai-prev' : 'user'
}

/**
 * 【v1734】建"板上有啥"的清单（纯函数 ✓）：
 *  · refs 由定义字符串抠出来 ✓（`c=Circle(A,B)` → 依赖 A、B ✓）
 *  · deps 反向补全 ✓（A 的被依赖 = c、D …）—— 这就是**依赖图** ✓
 *  · 顺带记来源与样式摘要 ✓
 */
export function buildTrack(
  names: string[],
  defs: Record<string, string> = {},
  prevAi: string[] = [],
  beforeDefs: Record<string, string> = {},
  styleOf?: (name: string) => string | undefined,
): TrackItem[] {
  const items: TrackItem[] = []
  const seen: Record<string, true> = {}
  for (const raw of names || []) {
    const name = String(raw == null ? '' : raw).trim()
    if (!name || seen[name]) continue
    seen[name] = true
    const def = String(defs[name] ?? '')
    items.push({
      name,
      origin: trackOrigin(name, beforeDefs, prevAi, defs),
      def,
      refs: ggbRefsOf(def),
      deps: [],
      style: styleOf ? styleOf(name) : undefined,
    })
  }
  // 反向补 deps ✓（只连板上真有的对象 ✓ 免得引用到不存在的名字 ✗）
  const byName: Record<string, TrackItem> = {}
  for (const it of items) byName[it.name] = it
  for (const it of items) {
    for (const r of it.refs) {
      const parent = byName[r]
      if (parent && parent.deps.indexOf(it.name) < 0) parent.deps.push(it.name)
    }
  }
  return items
}

/** 【v1734】一行摘要：几个对象、几条依赖边、各来源几个 ✓ */
export function trackSummary(items: TrackItem[]): string {
  const list = items || []
  const ai = list.filter((x) => x.origin === 'ai').length
  const prev = list.filter((x) => x.origin === 'ai-prev').length
  const user = list.filter((x) => x.origin === 'user').length
  const edges = list.reduce((n, x) => n + (x.refs || []).length, 0)
  return '板上 ' + list.length + ' 个对象（依赖边 ' + edges + ' 条）：这次 AI 画的 ' + ai +
    ' · 上次 AI 画的 ' + prev + ' · 你手画的 ' + user
}

/** 【v1734】给老师看的一行行（纯函数 ✓ 有上限 ✓ 对象多也不刷屏 ✗） */
export function trackLines(items: TrackItem[], max = 40): string[] {
  const list = (items || []).slice(0, Math.max(1, max))
  const out: string[] = [trackSummary(items || [])]
  for (const it of list) {
    const tag = it.origin === 'ai' ? '这次AI' : it.origin === 'ai-prev' ? '上次AI' : '你手画'
    const refs = it.refs.length ? '　← 依赖 ' + it.refs.slice(0, 6).join('、') : ''
    const st = it.style ? '　（' + it.style + '）' : ''
    out.push('· [' + tag + '] ' + it.name + ' = ' + (it.def || '（无定义）') + refs + st)
  }
  if ((items || []).length > list.length) out.push('… 还有 ' + (items.length - list.length) + ' 个没列出来（板上太挤 ✓）')
  return out
}

/** 【v1734】这块是谁画的（给别的功能用 ✓） */
export function trackWho(items: TrackItem[], name: string): TrackOrigin | '' {
  const it = (items || []).find((x) => x.name === name)
  return it ? it.origin : ''
}

/** 【v1734】一个对象在板上被谁依赖（直接子级 ✓ 要传递闭包就用 ggbDeleteClosure ✓） */
export function trackDependents(items: TrackItem[], name: string): string[] {
  const it = (items || []).find((x) => x.name === name)
  return it ? it.deps.slice() : []
}
