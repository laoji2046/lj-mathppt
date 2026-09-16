/**
 * 课件库 —— 第三期。
 *
 * 复用通用表（type='deck'），**body 存整份 deck 的 JSON**。
 *
 * ⭐ 这顺带解掉一个老问题：deck 里带 dataURL 图片时会很大，
 *   塞 localStorage 会触顶（5~10 MB）；进 SQLite 就没有这个限制了。
 */
import { libQuery, libSave, libRemove, libBump } from './useLibrary'
import type { LibItem } from './useLibrary'

export interface DeckEntry extends LibItem {
  slideCount: number
  /** 大致体积（字节），列表里显示用 */
  bytes: number
}

function toEntry(it: LibItem): DeckEntry {
  const m = (it.meta || {}) as Record<string, unknown>
  return {
    ...it,
    slideCount: Number(m.slideCount) || 0,
    bytes: Number(m.bytes) || it.body.length,
  }
}

export async function listDecks(): Promise<DeckEntry[]> {
  return (await libQuery('deck')).map(toEntry)
}

/**
 * 把当前课件存入课件库。
 * 传 id>0 则覆盖那一条（库里更新），否则新增。
 * 返回 id（失败 0）。
 */
export async function saveDeckToLibrary(
  deck: unknown,
  title: string,
  id = 0
): Promise<number> {
  const body = JSON.stringify(deck)
  const d = (deck || {}) as { slides?: unknown[] }
  return libSave({
    id: id > 0 ? id : undefined,
    type: 'deck',
    title: title.trim() || '未命名课件',
    body,
    meta: { slideCount: Array.isArray(d.slides) ? d.slides.length : 0, bytes: body.length },
    tags: '',
    source: '课件库',
    builtin: 0,
  })
}

/** 取一条课件的 deck 对象（解析失败返回 null） */
export function parseDeckBody(it: DeckEntry): unknown | null {
  try {
    const d = JSON.parse(it.body)
    return d && typeof d === 'object' ? d : null
  } catch {
    return null
  }
}

export async function removeDeck(id: number): Promise<boolean> {
  return libRemove(id)
}

export async function touchDeck(id: number): Promise<void> {
  await libBump(id)
}

export function filterDecks(list: DeckEntry[], q: string): DeckEntry[] {
  const k = q.trim().toLowerCase()
  if (!k) return list
  return list.filter((x) => x.title.toLowerCase().includes(k))
}

export function humanBytes(n: number): string {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(2) + ' MB'
}
