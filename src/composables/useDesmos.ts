/**
 * Desmos 的按需加载与注入（照 GeoGebra 的 useGeoGebra 模式）。
 *
 * 两个关键点：
 * 1. 必须在宿主有实际尺寸后再注入 —— 0×0 容器里 Desmos 会渲染异常。
 * 2. 本地球以本地引擎优先（public/desmos/index.js 已随应用打包，离线可用），CDN 兜底。
 */

// 【v1615】绝对路径 ✗ —— Tauri 加载 `app/index.html` ✓ 相对路径会变 `/app/desmos/...` ✓ 404 ✓
const DESMOS_LOCAL = import.meta.env.BASE_URL + 'desmos/index.js'
const DESMOS_CDN = 'https://www.desmos.com/api/v1.13/calculator.js?apiKey=dcb31709b452b1cf9dc26972add0fda6'

export interface DesmosApi {
  GraphingCalculator: new (host: HTMLElement, options?: Record<string, unknown>) => any
}

declare global {
  interface Window {
    Desmos?: DesmosApi
  }
}

let loader: Promise<DesmosApi> | null = null

/** 按需加载 Desmos API（本地引擎优先，CDN 兜底），只加载一次 */
export function loadDesmos(): Promise<DesmosApi> {
  if (window.Desmos && window.Desmos.GraphingCalculator) {
    return Promise.resolve(window.Desmos as DesmosApi)
  }
  if (loader) return loader

  loader = new Promise((resolve, reject) => {
    const urls = [DESMOS_LOCAL, DESMOS_CDN]
    let i = 0
    const next = () => {
      if (i >= urls.length) {
        loader = null
        reject(new Error('Desmos API 加载失败（本地与 CDN 均不可用）'))
        return
      }
      const s = document.createElement('script')
      s.src = urls[i++]
      s.async = true
      s.onload = () => {
        if (window.Desmos && window.Desmos.GraphingCalculator) resolve(window.Desmos as DesmosApi)
        else next()
      }
      s.onerror = () => {
        s.remove()
        next()
      }
      document.head.appendChild(s)
    }
    next()
  })

  return loader
}

/** 等待宿主有实际尺寸，避免注入到尚未完成布局的容器 */
export function waitForSize(host: HTMLElement, timeout = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const check = () => {
      const r = host.getBoundingClientRect()
      if (r.width > 8 && r.height > 8) return resolve(true)
      if (Date.now() - t0 > timeout) return resolve(false)
      requestAnimationFrame(check)
    }
    check()
  })
}

export interface DesmosInjectOptions {
  state: string
  showPanel: boolean
  showToolbar: boolean
  showZoomButtons: boolean
  color: string
}

/** 注入一个 Desmos 计算器到宿主元素，返回 calculator 实例 */
export async function injectDesmos(host: HTMLElement, opts: DesmosInjectOptions) {
  const Desmos = await loadDesmos()
  const ready = await waitForSize(host)
  if (!ready) throw new Error('宿主尺寸异常，无法注入 Desmos')

  const calculator = new Desmos.GraphingCalculator(host, {
    expressions: opts.showPanel,
    keypad: opts.showPanel,
    settingsMenu: opts.showToolbar,
    expressionsTopbar: opts.showPanel,
    zoomButtons: opts.showZoomButtons,
    graphpaper: true,
    // 不显示表达式滑块注释等，保持简洁
  })
  if (opts.state) {
    try { calculator.setState(JSON.parse(opts.state)) } catch { /* 忽略非法 state */ }
  }
  return calculator
}

/** 读取计算器状态（用于保存到场景图） */
export function desmosState(calculator: unknown): string {
  const c = calculator as { getState?: () => unknown } | null
  try { return JSON.stringify(c?.getState?.() ?? {}) } catch { return '' }
}

/**
 * 把「表达式颜色」套用到**未显式指定颜色**的表达式上。
 *
 * Desmos 默认按调色板自动给每条表达式配色，所以这里只在用户明确选了颜色时才生效，
 * 且不会覆盖用户在计算器内部手改的颜色。color 为空 = 保持 Desmos 自动配色。
 */
export function applyDesmosColor(calculator: unknown, color: string, previous?: string) {
  const c = calculator as {
    getState?: () => any
    setState?: (s: unknown) => void
  } | null
  if (!c?.getState || !c?.setState) return
  if (!color && !previous) return
  try {
    const st = c.getState()
    const list = st?.expressions?.list
    if (!Array.isArray(list)) return
    let changed = false
    for (const ex of list) {
      if (!ex || typeof ex !== 'object') continue
      // 只动「未指定颜色」或「上一次由本功能设的颜色」，保住用户手改的配色
      if (!ex.color || (previous && ex.color === previous)) {
        if (color) ex.color = color
        else delete ex.color
        changed = true
      }
    }
    if (changed) c.setState(st)
  } catch { /* 忽略 */ }
}

/**
 * 元素 id → calculator 实例注册表。
 *
 * 为什么需要它：用户在画布上的计算器里输入表达式，这些内容只存在于 Desmos 实例内部。
 * 演示与导出读的是场景图，所以必须在「取消选中 / 演示前」把 getState() 回写进场景图，
 * 否则幻灯片里只会看到一个空计算器。
 */
const instances = new Map<string, unknown>()

export function registerDesmos(id: string, calculator: unknown) {
  instances.set(id, calculator)
}
export function unregisterDesmos(id: string) {
  instances.delete(id)
}
/** 取回某个元素当前的计算器内容；未挂载时返回 null */
export function captureDesmosState(id: string): string | null {
  const calc = instances.get(id)
  if (!calc) return null
  const s = desmosState(calc)
  return s || null
}

/**
 * 卸载计算器。必须调用 Desmos 自己的 destroy() 释放事件监听与 Web Worker，
 * 只清空 innerHTML 会留下僵尸实例（切换面板开关时不断累积）。
 */
export function destroyDesmos(calculator: unknown | null) {
  const c = calculator as { destroy?: () => void } | null
  try { c?.destroy?.() } catch { /* 忽略 */ }
}
