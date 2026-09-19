/**
 * 内容库（公式 / 数学图形 / 试题 / 课件）的前端封装。
 *
 * 存储：Tauri 下走 Rust 的 SQLite（%APPDATA%\\lj-mathslides\\library.db）；
 *      浏览器 dev 下自动降级到 localStorage —— 同一套接口，方便开发与预览。
 *
 * 设计原则（按方案文档）：
 *  - **库是空的也能跑**：任何调用失败都返回安全默认值，绝不让界面崩。
 *  - **迁移前先备份**：localStorage 的原键**绝不删除**，另存一份 backup 键。
 */
import { isTauri, invoke } from './useTauri'

export type LibKind = 'formula' | 'figure' | 'question' | 'deck'

export interface LibItem {
  /** 仅浏览器降级数据带（Rust 侧按 type 分表查询，不返回该列） */
  type?: string
  id: number
  title: string
  body: string
  meta: Record<string, unknown>
  tags: string
  source: string
  builtin: number
  updatedAt: string
  usedCount: number
}

/** 存库时的入参（id 为 0 或缺省即新增） */
export interface LibDraft {
  id?: number
  type: LibKind
  title: string
  body?: string
  meta?: Record<string, unknown>
  tags?: string
  source?: string
  builtin?: number
}

const LS_KEY = 'lj-mathslides-vue:library-fallback'
const LS_META = 'lj-mathslides-vue:library-meta'

/* ---------------- 浏览器降级：全部落在 localStorage ---------------- */

interface FallbackShape { items: LibItem[]; nextId: number }

function fbLoad(): FallbackShape {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return { items: [], nextId: 1 }
    const d = JSON.parse(raw)
    if (!d || !Array.isArray(d.items)) return { items: [], nextId: 1 }
    return { items: d.items, nextId: typeof d.nextId === 'number' ? d.nextId : d.items.length + 1 }
  } catch {
    return { items: [], nextId: 1 }
  }
}
function fbSave(d: FallbackShape) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(d)) } catch { /* 容量满就放弃，不打断使用 */ }
}

/* ---------------- 统一接口 ---------------- */

/** 库信息（路径 + 条目数）；浏览器降级时不报错，只说明来源 */
export async function libInfo(): Promise<{ path: string; count: number; backend: string }> {
  if (!isTauri()) {
    const d = fbLoad()
    return { path: 'localStorage（浏览器）', count: d.items.length, backend: 'localStorage' }
  }
  try {
    const r = await invoke<{ ok?: boolean; path?: string; count?: number }>('lib_info')
    return { path: r?.path ?? '', count: r?.count ?? 0, backend: 'sqlite' }
  } catch (e) {
    return { path: '', count: 0, backend: 'error:' + String(e) }
  }
}

/** 取某一类全部条目（按 id 降序 = 新录入的在前） */
export async function libQuery(kind: LibKind): Promise<LibItem[]> {
  if (!isTauri()) {
    // 降级数据里每条都带 type（见 libSave 的降级分支）
    return fbLoad()
      .items.filter((x) => (x as { type?: string }).type === kind)
      // 与 Rust 的 lib_query 一致：按 id 降序（新录入的在最上面），不再按引用次数
      .sort((a, b) => b.id - a.id)
  }
  try {
    const r = await invoke<{ ok?: boolean; items?: LibItem[] }>('lib_query', { kind })
    if (!r?.ok || !Array.isArray(r.items)) return []
    return r.items.map(normalizeItem)
  } catch {
    return []
  }
}

/** 把 Rust 回来的原始条目规整成前端形状（meta 从字符串解析成对象） */
function normalizeItem(raw: unknown): LibItem {
  const r = (raw || {}) as Record<string, unknown>
  let meta: Record<string, unknown> = {}
  try {
    const m = r.meta
    if (typeof m === 'string' && m.trim()) meta = JSON.parse(m)
    else if (m && typeof m === 'object') meta = m as Record<string, unknown>
  } catch { meta = {} }
  return {
    id: Number(r.id) || 0,
    title: String(r.title || ''),
    body: String(r.body || ''),
    meta,
    tags: String(r.tags || ''),
    source: String(r.source || ''),
    builtin: Number(r.builtin) || 0,
    updatedAt: String(r.updatedAt || ''),
    usedCount: Number(r.usedCount) || 0,
  }
}

/** 存一条（id 为 0 即新增），返回 id（失败返回 0） */
export async function libSave(draft: LibDraft): Promise<number> {
  const metaStr = JSON.stringify(draft.meta || {})
  if (!isTauri()) {
    const d = fbLoad()
    const id = draft.id && draft.id > 0 ? draft.id : d.nextId++
    const item: LibItem & { type: string } = {
      id, title: draft.title, body: draft.body || '', meta: draft.meta || {},
      tags: draft.tags || '', source: draft.source || '', builtin: draft.builtin || 0,
      updatedAt: String(Math.floor(Date.now() / 1000)), usedCount: 0, type: draft.type,
    }
    const i = d.items.findIndex((x) => x.id === id)
    if (i >= 0) d.items[i] = { ...d.items[i], ...item }
    else d.items.push(item)
    fbSave(d)
    return id
  }
  try {
    const r = await invoke<{ ok?: boolean; id?: number; error?: string }>('lib_save', {
      item: {
        id: draft.id || 0,
        type: draft.type,
        title: draft.title,
        body: draft.body || '',
        meta: metaStr,
        tags: draft.tags || '',
        source: draft.source || '',
        builtin: draft.builtin || 0,
      },
    })
    return r?.ok && r.id ? r.id : 0
  } catch {
    return 0
  }
}

/** 删除（内置条目 Rust 侧会拒绝，这里返回 false） */
export async function libRemove(id: number): Promise<boolean> {
  if (!isTauri()) {
    const d = fbLoad()
    const before = d.items.length
    d.items = d.items.filter((x) => !(x.id === id && !x.builtin))
    fbSave(d)
    return d.items.length < before
  }
  try {
    const r = await invoke<{ ok?: boolean; removed?: number }>('lib_remove', { id })
    return !!r?.ok && (r.removed ?? 0) > 0
  } catch {
    return false
  }
}

/** 记一次使用（失败无所谓，仅影响排序） */
export async function libBump(id: number): Promise<void> {
  if (!isTauri()) return
  try { await invoke('lib_bump', { id }) } catch { /* 忽略 */ }
}

/** 批量灌入内置条目，返回新增条数 */
export async function libSeed(items: LibDraft[]): Promise<number> {
  if (!isTauri()) {
    let n = 0
    for (const it of items) {
      const d = fbLoad()
      const exists = d.items.some((x) => x.builtin && x.title === it.title)
      if (exists) continue
      await libSave({ ...it, builtin: 1 })
      n++
    }
    return n
  }
  try {
    const payload = items.map((it) => ({
      type: it.type, title: it.title, body: it.body || '',
      meta: JSON.stringify(it.meta || {}), tags: it.tags || '', source: it.source || '',
    }))
    const r = await invoke<{ ok?: boolean; added?: number }>('lib_seed', { items: payload })
    return r?.ok ? (r.added ?? 0) : 0
  } catch {
    return 0
  }
}

/** 批量导入：返回 { added, skipped }（Rust 侧走事务并按 body 去重） */
export async function libSaveMany(items: LibDraft[]): Promise<{ added: number; skipped: number }> {
  if (!items.length) return { added: 0, skipped: 0 }
  if (!isTauri()) {
    let added = 0
    let skipped = 0
    for (const it of items) {
      const d = fbLoad()
      if (it.body && d.items.some((x) => x.body === it.body)) { skipped++; continue }
      const id = await libSave(it)
      if (id) added++; else skipped++
    }
    return { added, skipped }
  }
  try {
    const payload = items.map((it) => ({
      type: it.type, title: it.title, body: it.body || '',
      meta: JSON.stringify(it.meta || {}), tags: it.tags || '', source: it.source || '',
    }))
    const r = await invoke<{ ok?: boolean; added?: number; skipped?: number }>('lib_save_many', { items: payload })
    return r?.ok ? { added: r.added ?? 0, skipped: r.skipped ?? 0 } : { added: 0, skipped: items.length }
  } catch {
    return { added: 0, skipped: items.length }
  }
}

/** 列出某一类下的标签及条数（筛选界面用） */
export async function libTags(kind: LibKind): Promise<{ name: string; count: number }[]> {
  if (!isTauri()) {
    const map = new Map<string, number>()
    for (const it of fbLoad().items) {
      if ((it as { type?: string }).type !== kind) continue
      for (const t of String(it.tags || '').split(',')) {
        const k = t.trim()
        if (k) map.set(k, (map.get(k) || 0) + 1)
      }
    }
    return Array.from(map.entries()).map(([name, count]) => ({ name, count }))
  }
  try {
    const r = await invoke<{ ok?: boolean; tags?: { name: string; count: number }[] }>('lib_tags', { kind })
    return r?.ok && Array.isArray(r.tags) ? r.tags : []
  } catch {
    return []
  }
}

/** 读迁移标记等键值 */
export async function libMetaGet(k: string): Promise<string | null> {
  if (!isTauri()) {
    try {
      const d = JSON.parse(localStorage.getItem(LS_META) || '{}')
      return typeof d[k] === 'string' ? d[k] : null
    } catch { return null }
  }
  try {
    const r = await invoke<{ ok?: boolean; value?: string | null }>('lib_meta_get', { k })
    return r?.ok ? (r.value ?? null) : null
  } catch {
    return null
  }
}

/** 写迁移标记等键值 */
export async function libMetaSet(k: string, v: string): Promise<boolean> {
  if (!isTauri()) {
    try {
      const d = JSON.parse(localStorage.getItem(LS_META) || '{}')
      d[k] = v
      localStorage.setItem(LS_META, JSON.stringify(d))
      return true
    } catch { return false }
  }
  try {
    const r = await invoke<{ ok?: boolean }>('lib_meta_set', { k, v })
    return !!r?.ok
  } catch {
    return false
  }
}
