/**
 * 题库的「大图」不进题目 JSON（SQLite 的 meta），而是存成**内容库资源**（type='asset'），
 * 题目里只留 assetId —— 这样列表加载、导出 JSON、跨机迁移都轻 ✓
 *
 * ⚠ 现状：按「整库 asset 拉一次 + 会话内缓存」实现（Rust 侧还没有按 id 取的命令）。
 *   资源多时首次加载会慢 —— 后续加 `asset_get(ids)` 优化（见 docs/试题库-重设计.md）。
 */
import { libQuery, libSave } from './useLibrary'

const cache = new Map<number, string>()
let loadedAll = false

/** 把一张 data URL 存成资源，返回它的 id（0 = 存失败，调用方回退成内联） */
export async function saveAsset(src: string): Promise<number> {
  try {
    const id = Number(await libSave({
      type: 'asset', title: '题库插图', body: '',
      meta: { src } as unknown as Record<string, unknown>,
      tags: 'asset', source: '题库', builtin: 0,
    })) || 0
    if (id) cache.set(id, src)
    return id
  } catch { return 0 }
}

/** 把所有资源读进缓存（一次；读不到就算了 —— 图会缺，但题还在 ✓） */
export async function ensureAssets(): Promise<void> {
  if (loadedAll) return
  try {
    for (const it of await libQuery('asset')) {
      const src = (it.meta as { src?: string } | undefined)?.src
      if (src) cache.set(Number(it.id), String(src))
    }
    loadedAll = true
  } catch { /* 忽略 */ }
}

/** 按 id 取图（没加载过/没有 → 空串，界面自然显示「缺图」而不是崩） */
export function assetSrc(id: number): string { return cache.get(Number(id)) || '' }
export function assetCount(): number { return cache.size }