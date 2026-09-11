/**
 * Tauri 桌面端能力的前端封装（浏览器 dev 环境下自动降级）。
 *
 * 只用到 withGlobalTauri 注入的 __TAURI_INTERNALS__.invoke，不引入 @tauri-apps/api，
 * 这样同一份代码在 `npm run dev`（纯浏览器）与打包后的 exe 里都能跑。
 */

interface TauriInternals {
  invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
}

function internals(): TauriInternals | undefined {
  const w = window as unknown as {
    __TAURI_INTERNALS__?: TauriInternals
    __TAURI__?: { core?: TauriInternals }
  }
  return w.__TAURI_INTERNALS__ ?? w.__TAURI__?.core
}

/** 是否运行在 Tauri 桌面端 */
export function isTauri(): boolean {
  return typeof internals()?.invoke === 'function'
}

export async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const i = internals()
  if (typeof i?.invoke !== 'function') throw new Error('当前不在桌面端环境')
  return (await i.invoke(cmd, args)) as T
}

/** 程序所在目录（导出文件默认落在这里） */
export async function appDir(): Promise<string> {
  const r = await invoke<{ dir?: string }>('app_dir')
  return r?.dir ?? ''
}

/**
 * 图片根目录（exe 所在目录，Rust 顺带确保默认 images/ 存在）。
 * 其下任意子目录（images/、pic/…）里的图都能在 Markdown 里以相对路径引用。
 */
export async function imagesDir(): Promise<string> {
  try {
    const r = await invoke<{ ok?: boolean; dir?: string }>('images_dir')
    return r?.dir ?? ''
  } catch {
    return ''
  }
}

/**
 * 按 exe 同级相对路径读取图片（如 `pic/3.jpg`、`images/9ti.jpg`；裸文件名回退 images/），
 * 返回可直接塞进 `<img src>` 的 data URL。
 * 打包后前端跑在内存页里、相对路径够不着磁盘，所以图片一律走这里转内嵌 base64
 * （顺带让导出 PDF/PNG 也不再受协议限制）。读不到返回空串，调用方负责回退。
 */
export async function readLocalImage(name: string): Promise<string> {
  try {
    const r = await invoke<{ ok?: boolean; dataBase64?: string; mime?: string }>('read_local_image', { name })
    if (!r?.ok || !r.dataBase64) return ''
    return 'data:' + (r.mime || 'image/jpeg') + ';base64,' + r.dataBase64
  } catch {
    return ''
  }
}

/** 写文本文件：桌面端走 Rust 的 export_json（能拿到真实路径），浏览器回退 blob 下载 */
export async function saveTextFile(name: string, text: string): Promise<string> {
  if (isTauri()) {
    // btoa 只吃 latin1，中文要过一遍 UTF-8 编码
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    const r = await invoke<{ ok?: boolean; path?: string; error?: string }>('export_json', {
      path: await appDir(),
      name,
      dataBase64: b64,
    })
    if (!r?.ok) throw new Error(r?.error || '保存失败')
    return r.path ?? ''
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
  return name
}

/** 分块 base64（大文件时 String.fromCharCode 展开会爆栈） */
function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(s)
}

export interface DirEntry { label: string; path: string }

/** 列目录（不传 path 时用程序所在目录），供"另存为"对话框浏览子文件夹 */
export async function listDir(path?: string): Promise<{ path: string; parent: string; dirs: string[] }> {
  const r = await invoke<{ ok?: boolean; path?: string; parent?: string | null; dirs?: string[] }>(
    'list_dir',
    path ? { path } : {},
  )
  return { path: r?.path ?? '', parent: r?.parent ?? '', dirs: r?.dirs ?? [] }
}

/** 常用目录（桌面/文档/下载/用户目录/程序目录）；老版本 exe 没有该命令时返回空数组 */
export async function userDirs(): Promise<DirEntry[]> {
  try {
    const r = await invoke<{ ok?: boolean; dirs?: DirEntry[] }>('user_dirs')
    return r?.dirs ?? []
  } catch {
    return []
  }
}

/** 把文本写到指定目录下的指定文件名（桌面端"另存为"用），返回完整路径 */
export async function saveTextToDir(dir: string, name: string, text: string): Promise<string> {
  const b64 = bytesToBase64(new TextEncoder().encode(text))
  const r = await invoke<{ ok?: boolean; path?: string; error?: string }>('export_json', {
    path: dir,
    name,
    dataBase64: b64,
  })
  if (!r?.ok) throw new Error(r?.error || '保存失败')
  return r.path ?? ''
}
