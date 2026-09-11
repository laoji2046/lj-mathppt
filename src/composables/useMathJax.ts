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
export async function renderLatex(host: HTMLElement, latex: string, fontSize: number, maxScale = 4) {
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
  } finally {
    probe.remove()
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
  target.dataset.scale = String(f)
}

/** 把「混排」文本（正文 + \(...\) 内联公式）排版进宿主；
 *  正文与公式都随宿主的 font-size / color / font-family。 */
export async function typesetMixed(host: HTMLElement, text: string) {
  await loadMathJax()
  const mj = window.MathJax
  host.innerHTML = normalizeMixed(text)
  if (mj && typeof mj.typesetPromise === 'function') {
    try { await mj.typesetPromise([host]) } catch { /* 忽略排版错误 */ }
  }
}
