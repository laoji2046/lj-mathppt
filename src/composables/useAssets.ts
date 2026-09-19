/**
 * 题库的「大图」不进题目 JSON（SQLite 的 meta），而是存成**内容库资源**（type='asset'），
 * 题目里只留 assetId —— 这样列表加载、导出 JSON、跨机迁移都轻 ✓
 *
 * 取图走 Rust 的 `asset_get(ids)`（**按 id 精确取**）；非桌面端降级成 `ensureAssets()`（整库拉一次）。
 */
import { libQuery, libSave } from './useLibrary'
import { invoke, isTauri } from './useTauri'

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

/** 【按 id 精确取图】只取缓存里没有的；Rust 侧一条 SQL 就够（不再整库拉） */
export async function loadAssets(ids: number[]): Promise<void> {
  const need = Array.from(new Set((ids || []).map((x) => Number(x)).filter((x) => x > 0 && !cache.has(x))))
  if (!need.length) return
  if (!isTauri()) { await ensureAssets(); return }
  try {
    const r = await invoke<{ ok?: boolean; items?: { id: number; meta: string }[] }>('asset_get', { ids: need })
    for (const it of r?.items || []) {
      let src = ''
      try { src = String((JSON.parse(it.meta || '{}') as { src?: string }).src || '') } catch { src = '' }
      if (src) cache.set(Number(it.id), src)
    }
  } catch { /* 取不到 → 退化成「缺图」，但题还在 */ }
}

/** 整库拉一次（浏览器降级 / 老数据没有 assetId 时的兜底） */
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