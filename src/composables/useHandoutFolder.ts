/**
 * 【M4】讲义库目录：exe 同级的 `LJ-讲义` 文件夹（一份讲义一个 .json）
 *
 * 老师要的是「**库跟着 exe 走**，但别打进 exe」✓ —— 拷一个文件夹过去就有全套讲义，
 * 而且这些文件能直接改、能备份、能进 git（打进二进制的改不了 ✗）。
 * 与 images/ 同一套路：Rust 侧按 **exe 所在目录** 运行时读盘（换机器不用重新打包 ✓）。
 *
 * 分工（重要，别混）：
 *   - **库目录 = 真身**（能带走的、老师会看到的那份 ✓）：打开讲义时读回来、保存/自动落盘时写回去 ✓；
 *   - **localStorage = 工作副本**（边改边存、断电也不丢 ✓，见 useHandout.ts 的 lib ✓）。
 *
 * 这一层只管"跟 Rust 说话"（纯 IO，不碰界面模型 ✓），合并/对账在 useHandout.ts 里 ✓。
 */
import { invoke } from './useTauri'

export interface HdFileInfo {
  /** 文件名（带 .json ✓）—— 它就是这一份在库里的身份 ✓ */
  name: string
  bytes: number
  /** 修改时间（毫秒时间戳 ✓） */
  mtime: number
}

/** UTF-8 文本 → base64（分块，免爆栈 ✓） */
function b64OfText(t: string): string {
  const bytes = new TextEncoder().encode(t)
  let s = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)) as number[])
  }
  return btoa(s)
}

/** 与 Rust 的 hd_safe_name() **同口径**：一层文件名、去掉 Windows 非法字符、限长 60 ✓ */
export function hdFileName(title: string): string {
  let out = ''
  for (const ch of String(title || '').trim()) {
    out += /[\\/:*?"<>|]/.test(ch) || ch.charCodeAt(0) < 32 ? '_' : ch
    if (out.length >= 60) break
  }
  out = out.trim()
  return out || '讲义'
}

/** 一份讲义 → 落盘文本（与老「保存讲义」同一个包装 ✓，老文件能原样读回来 ✓） */
export function hdDocText(doc: unknown): string {
  return JSON.stringify({ app: 'LJ-MathSlides', kind: 'handout', savedAt: new Date().toISOString(), doc }, null, 1)
}

/** 落盘文本 → 一份讲义（兼容裸 doc / 老文件 ✓）；认不出给 null ✓ */
export function hdDocFromText(text: string): Record<string, unknown> | null {
  try {
    const j = JSON.parse(String(text || ''))
    const d = j && j.doc ? j.doc : j
    if (!d || typeof d !== 'object') return null
    if (!('meta' in d) || !Array.isArray((d as { blocks?: unknown }).blocks)) return null
    return d as Record<string, unknown>
  } catch { return null }
}

/** 库目录（不存在时 Rust 会建 ✓） */
export async function hdFolderDir(): Promise<string> {
  try {
    const r = await invoke<{ ok?: boolean; dir?: string }>('hd_dir')
    return String((r && r.dir) || '')
  } catch { return '' }
}

/** 库里有哪些文件 ✓ */
export async function hdFolderList(): Promise<HdFileInfo[]> {
  try {
    const r = await invoke<{ ok?: boolean; items?: HdFileInfo[] }>('hd_list')
    return (r && r.items) || []
  } catch { return [] }
}

export async function hdFolderRead(name: string): Promise<string> {
  try {
    const r = await invoke<{ ok?: boolean; text?: string }>('hd_read', { name })
    return String((r && r.text) || '')
  } catch { return '' }
}

export interface HdWriteResult { ok: boolean; name?: string; path?: string; error?: string }

export async function hdFolderWrite(name: string, text: string): Promise<HdWriteResult> {
  try {
    const r = await invoke<{ ok?: boolean; name?: string; path?: string; error?: string }>('hd_write', {
      name, dataBase64: b64OfText(text),
    })
    if (r && r.ok) return { ok: true, name: String(r.name || ''), path: String(r.path || '') }
    return { ok: false, error: (r && r.error) || '写入失败' }
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) }
  }
}

/** 删 = 挪进 `LJ-讲义\.deleted\`（手滑能捞回来 ✓，不是真删 ✓） */
export async function hdFolderDelete(name: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await invoke<{ ok?: boolean; error?: string }>('hd_delete', { name })
    return r && r.ok ? { ok: true } : { ok: false, error: (r && r.error) || '删除失败' }
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) }
  }
}

/** 把一个目录（如 `文档\LJ讲义`）里的 .json **复制**进库 ✓ 同名跳过（不覆盖 ✓） */
export async function hdFolderImportDir(from: string): Promise<{ ok: boolean; copied: number; skipped: number; failed: number; dir?: string; error?: string }> {
  try {
    const r = await invoke<{ ok?: boolean; copied?: number; skipped?: number; failed?: number; dir?: string; error?: string }>('hd_import_dir', { from })
    if (r && r.ok) return { ok: true, copied: r.copied || 0, skipped: r.skipped || 0, failed: r.failed || 0, dir: String(r.dir || '') }
    return { ok: false, copied: 0, skipped: 0, failed: 0, error: (r && r.error) || '导入失败' }
  } catch (e) {
    return { ok: false, copied: 0, skipped: 0, failed: 0, error: String((e as Error)?.message || e) }
  }
}

/** 资源管理器打开库目录 ✓ */
export async function hdFolderOpen(): Promise<boolean> {
  try {
    const r = await invoke<{ ok?: boolean }>('hd_open_dir')
    return !!(r && r.ok)
  } catch { return false }
}
