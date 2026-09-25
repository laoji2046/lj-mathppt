/**
 * GeoGebra 的按需加载与注入。
 *
 * 两个关键坑（从原版应用踩过的经验搬过来）：
 * 1. 必须在宿主有实际尺寸后再 inject —— 在 0×0 容器里 GeoGebra 会渲染成一片空白。
 * 2. 离线引擎要先探测再启用 —— 本地没有 web3d 运行时时不能强设 codebase，否则加载失败。
 */

// 【v1615】绝对路径 ✗ —— Tauri 加载 `app/index.html` ✓ 相对路径会变 `/app/geogebra/...` ✓ 404 ✓
const GGB_LOCAL = import.meta.env.BASE_URL + 'geogebra/deployggb.js'
const GGB_CDN = 'https://www.geogebra.org/apps/deployggb.js'
/** 引擎运行时目录；把原应用的 dist/geogebra/5.0 拷到 public/geogebra/5.0 即可离线 */
const GGB_CODEBASE = import.meta.env.BASE_URL + 'geogebra/5.0/web3d/'

type GgbConstructor = new (params: Record<string, unknown>, html5?: boolean) => any

let loader: Promise<GgbConstructor> | null = null
let codebaseOk: boolean | null = null

/** 本地是否存在 GeoGebra 运行时（存在则离线可用） */
export async function hasLocalEngine(): Promise<boolean> {
  if (codebaseOk !== null) return codebaseOk
  try {
    const r = await fetch(`${GGB_CODEBASE}web3d.nocache.js`, { method: 'HEAD' })
    codebaseOk = r.ok
  } catch {
    codebaseOk = false
  }
  return codebaseOk
}

export function loadGeoGebra(): Promise<GgbConstructor> {
  if (window.GGBApplet) return Promise.resolve(window.GGBApplet as GgbConstructor)
  if (loader) return loader

  loader = new Promise((resolve, reject) => {
    const urls = [GGB_LOCAL, GGB_CDN]
    let i = 0
    const next = () => {
      if (i >= urls.length) {
        loader = null
        reject(new Error('deployggb.js 加载失败（本地与 CDN 均不可用）'))
        return
      }
      const s = document.createElement('script')
      s.src = urls[i++]
      s.async = true
      s.onload = () => {
        if (window.GGBApplet) resolve(window.GGBApplet as GgbConstructor)
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

export interface GgbInjectOptions {
  app: string
  ggbBase64: string
  showToolbar: boolean
  showAlgebraInput: boolean
  showAlgebra: boolean
  showMenuBar: boolean
  showResetIcon: boolean
  enableShiftDragZoom: boolean
  showAxis: boolean
  showGrid: boolean
  /** 打开后自动执行的 GeoGebra 命令（用于“预设好的动态图”，如 f(x)=x^2、A=(1,1)） */
  commands?: string[]
}

/** 注入一个 GeoGebra 小程序到宿主元素，返回 applet 实例 */
export async function injectGeoGebra(host: HTMLElement, opts: GgbInjectOptions) {
  const GGBApplet = await loadGeoGebra()

  const ready = await waitForSize(host)
  if (!ready) throw new Error('宿主尺寸异常，无法注入 GeoGebra')

  const id = `ggb_${Math.random().toString(36).slice(2, 10)}`
  const params: Record<string, unknown> = {
    id,
    appName: opts.app,
    width: Math.round(host.clientWidth),
    height: Math.round(host.clientHeight),
    showToolBar: opts.showToolbar,
    showAlgebraInput: opts.showAlgebraInput,
    showMenuBar: opts.showMenuBar,
    showResetIcon: opts.showResetIcon,
    enableShiftDragZoom: opts.enableShiftDragZoom,
    // 让小程序随容器缩放（只缩小，不放大超出预设尺寸）
    scaleContainerClass: 'ggb-fit',
    allowUpscale: false,
    borderColor: '#e3dfd5',
  }
  if (opts.ggbBase64) params.ggbBase64 = opts.ggbBase64

  // 注意：不能把 showAxis/showGrid 当构造参数 —— .ggb 文件内部自带视图设置，
  // 加载时会覆盖构造参数。必须在 applet 就绪后用运行时 API 强制生效。
  // 方法名以 Apps API 实测为准：坐标轴是 setAxesVisible(x, y)（复数、双参数），
  // 不存在 setAxisVisible（单数）；网格是 setGridVisible(bool)。
  params.appletOnLoad = (api: Record<string, unknown>) => {
    try {
      if (typeof api.setAxesVisible === 'function') api.setAxesVisible(opts.showAxis, opts.showAxis)
      else if (typeof api.setAxisVisible === 'function') api.setAxisVisible(opts.showAxis)
      if (typeof api.setGridVisible === 'function') api.setGridVisible(opts.showGrid)
      // 代数区（视图）：本 5.0 web3d 引擎无 showView，必须用 setPerspective 切视角
      applyAlgebraView(api, opts.app, opts.showAlgebra)
    } catch { /* 3D/CAS 等套件可能不支持，忽略 */ }
    // 预设命令：模板里的“开箱即用动态图”
    for (const cmd of opts.commands ?? []) {
      try { if (cmd && typeof api.evalCommand === 'function') api.evalCommand(cmd) } catch { /* ignore */ }
    }
    // 把 api 引用挂到实例上，供后续运行时切换使用
    try { (applet as Record<string, unknown>).__ggbApi = api } catch { /* ignore */ }
  }

  const applet = new GGBApplet(params, true)

  // 只有在本地确实存在运行时时才切到离线 codebase
  if (typeof applet.setHTML5Codebase === 'function' && (await hasLocalEngine())) {
    applet.setHTML5Codebase(GGB_CODEBASE, true)
  }

  host.innerHTML = ''
  applet.inject(host)
  return applet
}

/** 就绪后直接切换坐标轴/网格显隐（不重建小程序，不丢作图内容） */
export function applyViewOptions(
  applet: unknown,
  opts: { showAxis: boolean; showGrid: boolean },
) {
  const holder = applet as Record<string, unknown> | null
  if (!holder) return
  // 优先用 appletOnLoad 保存的真实 api 对象，其次退回 GGBApplet 实例代理
  const api = (holder.__ggbApi ?? holder) as Record<string, unknown>
  try {
    // Apps API 实测：坐标轴是 setAxesVisible(x, y)，不存在单数的 setAxisVisible
    if (typeof api.setAxesVisible === 'function') api.setAxesVisible(opts.showAxis, opts.showAxis)
    else if (typeof api.setAxisVisible === 'function') api.setAxisVisible(opts.showAxis)
    if (typeof api.setGridVisible === 'function') api.setGridVisible(opts.showGrid)
  } catch { /* 忽略不支持视图 API 的套件 */ }
}

/** 根据 app 与「是否显示代数区」推导 setPerspective 视角字符串。
 *
 * 关键（从 5.0 web3d 引擎源码 & 运行时 API 实测得出）：
 * - 本引擎运行时**没有** showView / setView / setActiveView —— 过去用 showView(1,show)
 *   切换代数区是无效的（typeof 守卫直接吞掉）。唯一能切视角的是 setPerspective。
 * - setPerspective 接受**字母位串**：A=代数(+2) G=2D图形(+1) T=CAS(+512) S=表格(+4) 等，
 *   见引擎 ekg 表；也接受**命名视角 id**（如 Perspective.3DGraphics），满足「能弹出 3D 视图」。
 * - 字母表里没有 3D 字母，所以 3D 视角必须用命名 id。
 */
export function ggbPerspective(app: string, showAlgebra: boolean): string {
  if (app === '3d') return 'Perspective.3DGraphics'
  if (app === 'cas') return showAlgebra ? 'AT' : 'T'
  // classic / graphing / geometry / scientific / suite 等：默认代数+2D图形
  return showAlgebra ? 'AG' : 'G'
}

/** 在视角 XML 中切换代数视图(<view id="2">) 的可见性，其余视图（含 3D）保持不动。
 *  这是本引擎（无 showView）切换代数区最可靠的方式：读当前视角 → 只改代数视图 → 回写。 */
function setAlgebraInPerspective(xml: string, show: boolean): string {
  const re = /(<view id="2"\s[^>]*?visible=")(?:true|false)(")/g
  if (re.test(xml)) {
    return xml.replace(re, (_m, a, c) => a + String(show) + c)
  }
  // 视角里没有单独的代数视图节点 → 追加一个（放在 </views> 前）
  const ins = '<view id="2" visible="' + String(show) + '" inframe="true" stylebar="false" location="1,1,1,1" size="400" window="100,100,250,400" />\n\t'
  if (xml.indexOf('</views>') !== -1) {
    return xml.replace('</views>', ins + '</views>')
  }
  return xml
}

/** 代数区（视图）显隐：本 5.0 web3d 引擎无 showView/setView，唯一可控的是 setPerspective。
 *  用 getPerspectiveXML → 改代数视图(2) → setPerspective，可同时适配 2D/3D 且保留 3D 视图。
 *  @param show 是否显示代数区视图 */
export function applyAlgebraView(api: Record<string, unknown> | undefined, appName: string, show: boolean) {
  if (!api) return
  try {
    if (typeof api.setPerspective === 'function') {
      // 优先用视角 XML 精确切换代数视图（保 3D / 保其他视图）
      if (typeof api.getPerspectiveXML === 'function') {
        const xml = api.getPerspectiveXML()
        if (typeof xml === 'string' && xml) {
          api.setPerspective(setAlgebraInPerspective(xml, show))
          return
        }
      }
      // 兜底：字母位串 / 命名视角
      api.setPerspective(ggbPerspective(appName, show))
    } else if (typeof api.showView === 'function') {
      // 其他引擎兜底
      api.showView(1, show)
    }
  } catch { /* 忽略 */ }
}

/** 卸载：GeoGebra 没有完善的销毁 API，清空宿主是最可靠的做法 */
export function destroyGeoGebra(host: HTMLElement | null) {
  if (host) host.innerHTML = ''
}
