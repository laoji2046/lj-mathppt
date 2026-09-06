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
