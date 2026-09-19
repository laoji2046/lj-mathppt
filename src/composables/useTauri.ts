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

export interface ScreenShot {
  /** 可直接塞进 <img src> 的 data URL */
  dataUrl: string
  w: number
  h: number
  /** 诊断：xcap 抓到几台显示器、各自的位置尺寸 */
  monitors: { name?: string; x: number; y: number; w: number; h: number }[]
  /** 诊断：系统（Tauri/winit）自己报告的显示器 —— 两者不一致就说明是枚举/DPI 问题 */
  osMonitors: { name?: string; x: number; y: number; w: number; h: number; scale?: number }[]
}

/** 原生截**整个桌面**（多显示器拼接）。只有桌面端能做，浏览器返回 null。 */
export async function captureScreens(): Promise<ScreenShot | null> {
  if (!isTauri()) return null
  try {
    const r = await invoke<{
      ok?: boolean
      dataBase64?: string
      w?: number
      h?: number
      monitors?: { name?: string; x: number; y: number; w: number; h: number }[]
      osMonitors?: { name?: string; x: number; y: number; w: number; h: number; scale?: number }[]
    }>('capture_screens')
    if (!r?.ok || !r.dataBase64) return null
    return {
      dataUrl: 'data:image/png;base64,' + r.dataBase64,
      w: r.w || 0,
      h: r.h || 0,
      monitors: r.monitors || [],
      osMonitors: r.osMonitors || [],
    }
  } catch {
    return null
  }
}

export interface WinInfo {
  id: number
  title: string
  app: string
  w: number
  h: number
}

/** 列出可截图的窗口（有标题、未最小化）。用来"截某个被别的窗口挡住的窗口"。 */
export async function listWindows(): Promise<WinInfo[]> {
  if (!isTauri()) return []
  try {
    const r = await invoke<{ ok?: boolean; windows?: WinInfo[] }>('list_windows')
    return r?.ok ? (r.windows || []) : []
  } catch {
    return []
  }
}

/** 截取指定窗口 —— 按窗口内容截，**被别的窗口挡住也能截到**。 */
export async function captureWindow(id: number): Promise<ScreenShot | null> {
  if (!isTauri()) return null
  try {
    const r = await invoke<{ ok?: boolean; dataBase64?: string; w?: number; h?: number }>('capture_window', { id })
    if (!r?.ok || !r.dataBase64) return null
    return {
      dataUrl: 'data:image/png;base64,' + r.dataBase64,
      w: r.w || 0,
      h: r.h || 0,
      monitors: [],
      osMonitors: [],
    }
  } catch {
    return null
  }
}

/** 进/出"截屏覆盖"模式：主窗口临时全屏置顶（桌面端才有效） */
export async function setCaptureMode(on: boolean): Promise<void> {
  if (!isTauri()) return
  try {
    await invoke('set_capture_mode', { on })
  } catch {
    /* 忽略：拿不到就算了，最多是手感差一点 */
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


/* ------------------------------------------------------------------ *
 * MinerU（导入 PDF 识别试题）：HTTP 只能在 Rust 侧发 —— 网页端直接
 * fetch mineru.net 会被 CORS 挡（webview 里 Failed to fetch）。
 * 这里只负责：暂存 PDF、调命令、订阅进度事件。
 * ------------------------------------------------------------------ */

/** MinerU 识别进度（Rust 侧 emit 的 "mineru://progress"） */
export interface MineruProgress {
  state: string
  extractedPages?: number
  totalPages?: number
  seconds?: number
}

export interface MineruResult {
  ok?: boolean
  /** full.md 落盘路径（%APPDATA%\lj-mathslides\mineru\<时间戳>\full.md） */
  mdPath?: string
  /** content_list.json 落盘路径；轻量接口为空串 */
  jsonPath?: string
  /** Markdown 正文 —— 直接灌进批量导入面板 */
  mdText?: string
  pages?: number
  seconds?: number
  mode?: string
  outDir?: string
  /** 正文引用到的插图（Rust 读成 base64）：前端转成 data URL 随题入库，见 mineruImages.ts */
  images?: { path: string; mime?: string; bytes?: number; dataBase64: string }[]
}

/**
 * 订阅 Tauri 事件。
 * 不引 @tauri-apps/api：withGlobalTauri 已经把 event 命名空间注入到 window.__TAURI__，
 * 与本项目 useTauri.ts 的一贯做法保持一致（浏览器 dev 下静默降级成空函数）。
 */
export async function listenTauri<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  const w = window as unknown as {
    __TAURI__?: {
      event?: {
        listen?: (e: string, cb: (ev: { payload: T }) => void) => Promise<() => void>
      }
    }
  }
  const listen = w.__TAURI__?.event?.listen
  if (typeof listen !== 'function') return () => {}
  try {
    return await listen(event, (ev) => handler(ev?.payload))
  } catch {
    return () => {}
  }
}

/**
 * 暂存用户选中的 PDF，返回磁盘路径。
 * WebView2 的 <input type="file"> 拿不到磁盘路径（File.path 实测 undefined），
 * 所以把字节交给 Rust 落到临时目录，再交给 mineru_parse。
 */
export async function mineruStagePdf(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer())
  const path = await invoke<string>('mineru_stage_pdf', {
    dataBase64: bytesToBase64(buf),
    fileName: file.name || 'upload.pdf',
  })
  if (!path) throw new Error('暂存 PDF 失败')
  return path
}

/** 调 Rust 侧的 MinerU 解析；mode = precise（需 token）| agent（免 token 轻量接口）。 */
export async function mineruParse(
  pdfPath: string,
  token: string,
  mode: 'precise' | 'agent',
): Promise<MineruResult> {
  return invoke<MineruResult>('mineru_parse', { pdfPath, token, mode })
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
