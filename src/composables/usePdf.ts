/**
 * 底层：把 base64 的 PDF 用 pdf.js 渲染到指定宿主（canvas 多页）。
 * 放这里供编辑器（EmbedElement）与演示宿主（PresentationOverlay）共用。
 */
let loader: Promise<any> | null = null

export function loadPdfJs(): Promise<any> {
  const w = window as any
  if (w.pdfjsLib) return Promise.resolve(w.pdfjsLib)
  if (loader) return loader
  loader = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'pdfjs/pdf.min.js'
    s.async = true
    s.onload = () => {
      const lib = w.pdfjsLib
      if (lib) {
        lib.GlobalWorkerOptions.workerSrc = 'pdfjs/pdf.worker.min.js'
        resolve(lib)
      } else { loader = null; reject(new Error('pdf.js 加载失败')) }
    }
    s.onerror = () => { loader = null; reject(new Error('pdf.js 加载失败')) }
    document.head.appendChild(s)
  })
  return loader
}

/** 把 base64 PDF 渲染为多页 canvas 追加进 host */
export async function renderPdfInto(host: HTMLElement, base64: string) {
  const lib = await loadPdfJs()
  const bin = atob(base64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  host.innerHTML = ''
  const doc = await lib.getDocument({ data: arr }).promise
  const W = host.clientWidth || 480
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const v1 = page.getViewport({ scale: 1 })
    const dpr = window.devicePixelRatio || 1
    // 按设备像素比渲染（高分屏才清晰；CSS 宽度仍为 100%）
    const scale = Math.max(0.2, (W / v1.width) * dpr)
    const vp = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = vp.width
    canvas.height = vp.height
    canvas.style.width = '100%'
    canvas.style.display = 'block'
    canvas.style.marginBottom = '8px'
    const ctx = canvas.getContext('2d')!
    await page.render({ canvasContext: ctx, viewport: vp }).promise
    host.appendChild(canvas)
  }
  doc.destroy()
}
