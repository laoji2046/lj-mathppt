/**
 * MathJax 3（SVG 输出）的按需加载与渲染。
 *
 * 为什么用 SVG 而非 CHTML：SVG 把字形以路径内嵌，不需要额外 woff 字体文件，
 * 单个 tex-svg.js（约 2MB）即可离线工作，也便于整体缩放。
 */

import { normalizeMixed } from '@/types'

// public/mathjax/tex-svg.js（本地，离线可用）
const MATHJAX_SRC = 'mathjax/tex-svg.js'

let loader: Promise<any> | null = null

function configureOnce() {
  // 配置必须在脚本加载前写入 window.MathJax
  window.MathJax = {
    tex: {
      inlineMath: [['$', '$'], ['\\(', '\\)']],
      displayMath: [['$$', '$$'], ['\\[', '\\]']],
      processEscapes: true,
      macros: {
        R: '\\mathbb{R}',
        N: '\\mathbb{N}',
        Z: '\\mathbb{Z}',
        Q: '\\mathbb{Q}',
        C: '\\mathbb{C}',
        E: '\\mathbb{E}',
        // 排列组合：\comb{n}{k} 组合 C(n,k)；\perm{n}{k} 排列 A(n,k)
        comb: ['\\binom{#1}{#2}', 2],
        perm: ['\\frac{#1!}{(#1-#2)!}', 2],
        // 绝对值 / 范数 / 微分 / 欧拉数 / 虚数单位 / 1/2（公式宏一览）
        abs: ['\\left|#1\\right|', 1],
        norm: ['\\left\\|#1\\right\\|', 1],
        dd: '\\mathrm{d}',
        ee: '\\mathrm{e}',
        ii: '\\mathrm{i}',
        half: '\\frac{1}{2}',
      },
    },
    options: {
      skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
    },
    // 我们手动按需 typeset，不让 MathJax 自动整页排版
    startup: { typeset: false },
    // 关键：必须用 'none'（默认值），让每个公式 SVG 内联 <path> 字形。
    // 若用 'global'，MathJax 会把字形放进一个全局缓存 SVG 再用 <use> 引用，
    // 但 tex2svg() 这条直接调用路径不会把缓存插进文档，导致所有 <use> 悬空、
    // 字形全部不显示，只剩分数线/根号这类 <rect> 元素 —— 即「公式只剩两条横线」。
    svg: { fontCache: 'none' },
  }
}

export function loadMathJax(): Promise<any> {
  if (window.MathJax?.startup?.promise) return window.MathJax.startup.promise
  if (loader) return loader

  configureOnce()

  loader = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = MATHJAX_SRC
    s.async = true
    s.onload = () => {
      // 脚本就位后 startup.promise 才可用，轮询等待一下
      let tries = 0
      const tick = () => {
        const p = window.MathJax?.startup?.promise
        if (p) resolve(p)
        else if (tries++ > 100) reject(new Error('MathJax 初始化超时'))
        else setTimeout(tick, 50)
      }
      tick()
    }
    s.onerror = () => {
      loader = null
      reject(new Error('MathJax 加载失败：请确认 public/mathjax/tex-svg.js 存在'))
    }
    document.head.appendChild(s)
  })

  return loader
}

/** 元素内是否已有渲染结果 */
export function hasRendered(host: HTMLElement) {
  return !!host.querySelector('mjx-container')
}

/**
 * 把 LaTeX 渲染进宿主元素，并等比缩放以适配宿主尺寸。
 * MathJax 产出的是固定尺寸 SVG，改 font-size 无效，只能用 transform: scale()。
 */
export async function renderLatex(host: HTMLElement, latex: string, fontSize: number, maxScale = 4): Promise<{ nw: number; nh: number }> {
  await loadMathJax()
  const mj = window.MathJax
  if (!mj?.tex2svg) throw new Error('MathJax 未就绪')

  host.innerHTML = ''

  // 用一个离屏容器按目标字号渲染，避免直接写进宿主产生闪烁
  const probe = document.createElement('div')
  probe.style.position = 'absolute'
  probe.style.left = '-99999px'
  probe.style.top = '0'
  probe.style.fontSize = `${fontSize}px`
  document.body.appendChild(probe)

  let svg: HTMLElement
  try {
    svg = mj.tex2svg(latex, { display: true, em: 16, ex: 8 })
    probe.appendChild(svg)
    // 等一帧让 SVG 完成布局
    await new Promise((r) => requestAnimationFrame(r))

    const container = probe.querySelector('mjx-container') as HTMLElement | null
    const naturalW = container?.offsetWidth || svg.getBoundingClientRect().width
    const naturalH = container?.offsetHeight || svg.getBoundingClientRect().height

    // 关键：只注入裸 <svg>（克隆，脱离 mjx-container 外壳）。否则 MathJax 会在
    // 容器挂载后异步重排一次，同一公式被渲染成两份（一份 displaystyle、一份 textstyle）。
    // 显式给 svg 设 font-size，使 SVG 的 width="Nex" 用同一个 ex 基准，与测得尺寸一致。
    // 注意优先级：必须先把「容器内查到的 <svg>」或「tex2svg 本身即 <svg>」取到裸节点，
    // 再克隆。若写成 (A || B) ? C : null，会把 A 当条件、返回 tex2svg 的容器（mjx-container），
    // 克隆容器仍可能被 MathJax 追踪而重排成双份。这里显式拆开，保证克隆的是裸 <svg>。
    let rawSvg: SVGSVGElement | null = null
    const innerSvg = container?.querySelector('svg') as SVGSVGElement | null
    if (innerSvg) rawSvg = innerSvg
    else if ((svg as HTMLElement).tagName.toLowerCase() === 'svg') rawSvg = svg as unknown as SVGSVGElement
    const target = (rawSvg ? (rawSvg.cloneNode(true) as SVGSVGElement) : (container || svg)) as HTMLElement
    try {
      target.style.fontSize = fontSize + 'px'
      target.style.maxWidth = 'none'
    } catch { /* 非 svg/不允许 inline 时忽略 */ }
    host.innerHTML = ''
    host.appendChild(target)

    if (naturalW > 0 && naturalH > 0) {
      target.dataset.nw = String(naturalW)
      target.dataset.nh = String(naturalH)
    }
    fitMath(host, maxScale)
    // 把自然尺寸回传：新建元素据此把外框收成刚好包住公式
    return { nw: naturalW, nh: naturalH }
  } finally {
    probe.remove()
  }
}

/**
 * 兜底：按"实际渲染出来的矩形"复核一次缩放。
 * 为什么需要：缩放比例是拿"量到的自然尺寸"算的，而 MathJax 排版是**异步**的 ——
 * 量完之后公式还可能再排一次版，实际占位变大，transform 后就会溢出宿主，
 * 被 overflow:hidden 裁掉（表现就是"拖动放大后公式被截断"）。
 * 这里用含 transform 的 getBoundingClientRect 复核，超了就按实际比例缩回去。
 */
function clampIntoBox(host: HTMLElement, target: HTMLElement, f: number) {
  target.dataset.scale = String(f)
  const hr = host.getBoundingClientRect()
  const tr = target.getBoundingClientRect()
  if (!(hr.width > 0 && hr.height > 0 && tr.width > 0 && tr.height > 0)) return
  if (tr.width > hr.width + 1 || tr.height > hr.height + 1) {
    const k = Math.min(hr.width / tr.width, hr.height / tr.height)
    const nf = Math.max(0.02, f * k)
    target.style.transform = `scale(${nf})`
    target.dataset.scale = String(nf)
  }
}

/** 按宿主当前尺寸重新缩放公式（用 renderLatex 记录的自然尺寸，只改 transform，不重排）。
 *  maxScale 限制放大倍数：maxScale=1 表示只缩小、不放大（列表预览用，保证各条公式视觉大小统一）。 */
export function fitMath(host: HTMLElement, maxScale = 4) {
  const target = (host.querySelector('mjx-container') as HTMLElement | null) || (host.querySelector('svg') as HTMLElement | null)
  if (!target) return
  const nw = parseFloat(target.dataset.nw || '0')
  const nh = parseFloat(target.dataset.nh || '0')
  const boxW = host.clientWidth
  const boxH = host.clientHeight
  if (!(nw > 0 && nh > 0 && boxW > 0 && boxH > 0)) return
  const f = Math.min(boxW / nw, boxH / nh, maxScale)
  target.style.transformOrigin = 'center center'
  target.style.transform = `scale(${f})`
  clampIntoBox(host, target, f)
}

/** 把「混排」文本（正文 + \(...\) 内联公式）排版进宿主；
 *  正文与公式都随宿主的 font-size / color / font-family。 */
/**
 * MathJax 排版队列：**必须串行**。
 * MathJax 3 的 typesetPromise 内部是「document.options.elements = e → document.reset() → render()」，
 * 既不排队也不串行化；并发调用会互相清掉对方待排版的项（表现为公式不渲染 / 重复 / 错位）。
 * 画布元素、缩略图、面板预览都走这里，所以在这一层统一排队。
 * （导出/放映是另一份文档，同样的串行化写在 reveal/renderer.ts 的引导脚本里：改一处务必改两处。）
 */
let mjChain: Promise<unknown> = Promise.resolve()
function typesetSerial(hosts: HTMLElement[]): Promise<unknown> {
  const run = () => {
    const mj = window.MathJax
    if (!mj || typeof mj.typesetPromise !== 'function') return Promise.resolve()
    return mj.typesetPromise(hosts).catch(() => { /* 忽略单次排版错误，别卡住队列 */ })
  }
  mjChain = mjChain.then(run, run)
  return mjChain
}

/** 把「混排」文本（正文 + \(...\) 内联公式）排版进宿主；
 *  正文与公式都随宿主的 font-size / color / font-family。 */
/**
 * **只排版、不写内容** —— 宿主的 innerHTML 由框架（Vue 的 v-html）负责时用这个。
 * 与 typesetMixed 的区别：那个会先 host.innerHTML = …，两套并行就会"抢文本节点"，
 * 表现是内容偶尔回退成原文（表格单元格踩过）。同一块内容**只能有一个主** ✓。
 */
export async function typesetHosts(hosts: HTMLElement[]) {
  if (!hosts.length) return
  await loadMathJax()
  await typesetSerial(hosts)
}

/** ⚠ 下面这个函数会**写 innerHTML**，与"框架负责内容"不能同时用（二选一）。 */
export async function typesetMixed(host: HTMLElement, text: string) {
  // ⚠ 这个函数会**写 innerHTML**。同一块内容请只用一个"主"：
  //   要么它负责内容（此时别让框架也渲染），要么框架负责内容（那就用 typesetHosts 只排版）。
  //   两套并行会抢文本节点 → 内容偶尔回退成原文（表格单元格踩过）。
  // 先落内容再等引擎：内容不该依赖 MathJax 是否就绪/成功，
  // 否则引擎一慢或一失败，宿主就整块空白（缩略图踩过这个坑）。
  host.innerHTML = normalizeMixed(text)
  // 标记类：混排里 \[...\] 的 display 公式要收掉 MathJax 默认的 1em 上下外边距（规则在 styles/main.css）。
  // 所有走本函数的宿主 —— 画布 richtex、混排面板预览、编辑弹窗、缩略图 —— 自动获得，不必逐处配 CSS。
  host.classList.add('fx-mixed-host')
  await loadMathJax()
  await typesetSerial([host])
}
