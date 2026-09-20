/**
 * 【v1466】SVG → PNG data URL。
 *
 * 为什么需要：题库「题图」要能**直接用我们的数学图形**（那些都是向量 SVG）—— 但入库/导出/打印用位图更稳
 * （PNG 各处都认；SVG 在部分阅读器/打印链里会丢字体或样式 ✗）。
 *
 * ⚠ 这段与 PaperModal 里的 svgToPng 同源（那边先有的，给试卷用）；这里做成题库用的独立模块，
 *   将来统一到本文件即可（**暂时不动 PaperModal 那份**，避免连带改动 ✓）。
 */

/** 目标像素宽度：太小的图放大就糊，统一按这个宽度出图（线宽是 user 单位，跟着一起放大 ✓） */
export const FIG_PX_W = 1200

/** 把页面上的 <svg> 栅格化成 PNG data URL（白底，打印干净 ✓） */
export async function svgToPngUrl(svg: SVGSVGElement, scale?: number): Promise<string> {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const vb = svg.viewBox && svg.viewBox.baseVal
  const w = (vb && vb.width) || svg.clientWidth || 400
  const h = (vb && vb.height) || svg.clientHeight || 300
  const k = scale || Math.max(2, FIG_PX_W / w)
  clone.setAttribute('width', String(Math.round(w * k)))
  clone.setAttribute('height', String(Math.round(h * k)))
  const text = new XMLSerializer().serializeToString(clone)
  return await svgTextToPngUrl(text, w, h, k)
}

/** 从 SVG 文本里读 viewBox 的宽高（读不到给 null ✓） */
export function viewBoxOf(text: string): { w: number; h: number } | null {
  const m = /viewBox\s*=\s*["']\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)\s*["']/.exec(text)
  if (!m) return null
  const w = Number(m[3])
  const h = Number(m[4])
  if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return null
  return { w, h }
}

/**
 * SVG **字符串** → PNG data URL（三维图的接收口给的就是字符串 ✓）。
 *
 * ⚠ 尺寸不给就**按它自己的 viewBox 出图** —— 以前写死 520×380 ✓：
 *   三维图那个 viewBox 是 480×320（3:2）✓，硬画进 520×380（1.37:1）→ **纵向被拉长 ~14%** ✗
 *   （用户看不出"错"，但圆会变成椭圆 ✓）。现在按 viewBox 定框、按 FIG_PX_W 定倍率 ✓ 又不糊又不变形 ✓。
 */
export async function svgTextToPngUrl(text: string, w = 0, h = 0, k = 0): Promise<string> {
  const vb = viewBoxOf(text)
  const ww = w > 0 ? w : vb ? vb.w : 520
  const hh = h > 0 ? h : vb ? vb.h : 380
  const kk = k > 0 ? k : Math.max(2, FIG_PX_W / ww)
  return await rasterize(text, ww, hh, kk)
}

async function rasterize(text: string, w: number, h: number, k: number): Promise<string> {
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text)
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image()
    im.onload = () => res(im)
    im.onerror = () => rej(new Error('图形转图片失败'))
    im.src = url
  })
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, Math.round(w * k))
  cv.height = Math.max(1, Math.round(h * k))
  const ctx = cv.getContext('2d')
  if (!ctx) throw new Error('拿不到画布上下文')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, cv.width, cv.height)
  ctx.drawImage(img, 0, 0, cv.width, cv.height)
  return cv.toDataURL('image/png')
}
