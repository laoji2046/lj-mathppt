/**
 * 公式库 —— 第一期落地层。
 *
 * 职责：
 *  1) **第一次运行**把内置公式库（FORMULA_LIBRARY）灌进本地库（builtin=1）
 *  2) **把 localStorage 里的用户预设迁移进库**
 *     ⚠ 迁移前**先备份到独立的 backup 键**，且**绝不删除原键** —— 这是方案里标红的风险点。
 *  3) 给界面提供 列表 / 新增 / 删除 / 记使用 四个动作
 */
import { FORMULA_LIBRARY } from '@/templates/formulaLibrary'
import {
  libMetaGet, libMetaSet, libSeed, libQuery, libSave, libRemove, libBump,
} from './useLibrary'
import type { LibDraft, LibItem } from './useLibrary'

export interface FormulaLibEntry extends LibItem {
  category: string
  categoryName: string
  icon: string
  accent: string
  note: string
}

const MIGRATE_KEY = 'migrate.formula.v1'
const LS_PRESETS = 'lj-mathslides-vue:formula-presets'
const LS_BACKUP = 'lj-mathslides-vue:formula-presets:backup-v1'

/** 自动起名：取首行前 14 个字符（与界面里原有规则一致） */
export function presetName(raw: string): string {
  const first = raw.split('\n').map((s) => s.trim()).filter(Boolean)[0] || raw
  const t = first.replace(/\s+/g, ' ')
  return t.length > 14 ? t.slice(0, 14) + '…' : t
}

function toEntry(it: LibItem): FormulaLibEntry {
  const m = (it.meta || {}) as Record<string, unknown>
  return {
    ...it,
    category: String(m.category || ''),
    categoryName: String(m.categoryName || ''),
    icon: String(m.icon || ''),
    accent: String(m.accent || ''),
    note: String(m.note || ''),
  }
}

/**
 * 第一次运行：灌内置 + 迁用户预设。
 * 幂等：靠 library_meta 里的 migrate.formula.v1 标记，重复调用直接跳过。
 */
export async function ensureFormulaLibrary(): Promise<{ seeded: number; migrated: number; skipped: boolean }> {
  const done = await libMetaGet(MIGRATE_KEY)
  if (done === 'done') return { seeded: 0, migrated: 0, skipped: true }

  // ① 内置公式灌库（Rust 侧按 type+title 判重，可重复调用）
  const drafts: LibDraft[] = []
  for (const cat of FORMULA_LIBRARY) {
    for (const f of cat.formulas) {
      drafts.push({
        type: 'formula',
        title: f.label,
        body: f.latex,
        meta: { note: f.note || '', category: cat.key, categoryName: cat.name, icon: cat.icon, accent: cat.accent },
        tags: cat.name,
        source: '内置公式库',
        builtin: 1,
      })
    }
  }
  const seeded = await libSeed(drafts)

  // ② 迁移用户预设 —— 先备份、只备份一次、绝不删原键
  let migrated = 0
  try {
    const raw = localStorage.getItem(LS_PRESETS)
    if (raw) {
      if (!localStorage.getItem(LS_BACKUP)) localStorage.setItem(LS_BACKUP, raw)
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        for (const p of arr) {
          if (!p || typeof p.latex !== 'string' || !p.latex.trim()) continue
          const id = await libSave({
            type: 'formula',
            title: String(p.label || '').trim() || presetName(p.latex),
            body: p.latex,
            meta: { category: 'mine', categoryName: '我的预设', icon: '★', accent: '#534AB7' },
            tags: '我的预设',
            source: '迁移自本地预设',
            builtin: 0,
          })
          if (id) migrated++
        }
      }
    }
  } catch { /* 迁移失败不影响启动，下次再试 */ }

  // 只有库真的可用（能写回标记）才记完成；写不进去就留待下次
  const ok = await libMetaSet(MIGRATE_KEY, 'done')
  return { seeded, migrated, skipped: !ok }
}

/** 列出公式库全部条目 */
export async function listFormulaLibrary(): Promise<FormulaLibEntry[]> {
  return (await libQuery('formula')).map(toEntry)
}

/** 新增一条用户公式 */
export async function addFormulaEntry(title: string, latex: string, tags = '我的预设'): Promise<number> {
  return libSave({
    type: 'formula',
    title: title.trim() || presetName(latex),
    body: latex,
    meta: { category: 'mine', categoryName: '我的预设', icon: '★', accent: '#534AB7' },
    tags,
    source: '自建',
    builtin: 0,
  })
}

/** 删除一条（内置会被 Rust 侧拒绝） */
export async function removeFormulaEntry(id: number): Promise<boolean> {
  return libRemove(id)
}

/** 记一次使用（仅影响排序） */
export async function touchFormulaEntry(id: number): Promise<void> {
  await libBump(id)
}

/** 简易检索：标题 / 正文 / 标签 / 备注 任一命中（大小写不敏感） */
export function filterFormulaEntries(list: FormulaLibEntry[], q: string): FormulaLibEntry[] {
  const k = q.trim().toLowerCase()
  if (!k) return list
  return list.filter((x) =>
    x.title.toLowerCase().includes(k) ||
    x.body.toLowerCase().includes(k) ||
    x.tags.toLowerCase().includes(k) ||
    x.note.toLowerCase().includes(k) ||
    x.categoryName.toLowerCase().includes(k)
  )
}
