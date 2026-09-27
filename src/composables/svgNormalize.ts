/**
 * 【v1697】把**任意来源的 SVG**（组件渲出来的 / 对话框给的片段 / 手写的）整成一个**可栅格化**的文档 ✓
 *
 * 为什么必须规范化（用户实报「插图形失败（转成 PNG）：图形转图片失败」✗）：
 *  · PaperModal 原来那段字符串处理是 \`replace(/<svg\\b/, '<svg width=… height=…')\` ✗ ——
 *    组件渲出来的 svg **本来就带 width/height** ✓ → 变成**重复属性** ✗ → XML 解析失败 ✗ → 图片加载 onerror ✗；
 *  · 而且它只在 \`indexOf('xmlns') < 0\` 时才补 xmlns ✓；Vue 在 HTML 文档里渲出来的 svg **序列化后通常没有 xmlns** ✗ →
 *    data URL 按 image/svg+xml 解析时就不是合法 SVG ✗ → 同样 onerror ✗。
 *
 * 这里的做法：**丢掉原来的尺寸属性、自己重写外层开标签** ✓（重复属性从根上不可能出现 ✓），
 *   viewBox 优先用原有的 ✓、没有就用传入的 w/h 造一个 ✓。纯函数 → 探针直接测 ✓
 */

export interface NormalizedSvg {
  svg: string
  /** 画布宽（viewBox 宽 ✓） */
  w: number
  /** 画布高 ✓ */
  h: number
  /** 倍率（外框像素 = w×k ✓） */
  k: number
}

const ATTR = (tag: string, name: string): string | null => {
  const m = new RegExp(name + '\\s*=\\s*"([^"]*)"').exec(tag) || new RegExp(name + "\\s*=\\s*'([^']*)'").exec(tag)
  return m ? m[1] : null
}

/** 从 viewBox 里读宽高（读不到、或不是正数 → null ✓） */
export function viewBoxSize(text: string): { w: number; h: number } | null {
  const open = /<svg\b[^>]*>/i.exec(String(text || ''))
  const raw = open ? ATTR(open[0], 'viewBox') : null
  if (!raw) return null
  const n = raw.trim().split(/[\s,]+/).map(Number)
  if (n.length !== 4 || !isFinite(n[2]) || !isFinite(n[3]) || n[2] <= 0 || n[3] <= 0) return null
  return { w: n[2], h: n[3] }
}

/**
 * 规范化 ✓
 * @param text 原始 SVG（完整文档 **或** 片段 ✓）
 * @param opt  w/h：没有 viewBox 时用它造一个 ✓；k：倍率（不给就按目标像素宽算 ✓）；pxW：目标像素宽（默认 1200 ✓）
 */
export function normalizeSvgForRaster(text: string, opt: { w?: number; h?: number; k?: number; pxW?: number } = {}): NormalizedSvg {
  const src = String(text == null ? '' : text).trim()
  const pxW = opt.pxW && opt.pxW > 0 ? opt.pxW : 1200
  const open = /<svg\b[^>]*>/i.exec(src)
  const vb = viewBoxSize(src)
  const w = (vb ? vb.w : (opt.w && opt.w > 0 ? opt.w : 480))
  const h = (vb ? vb.h : (opt.h && opt.h > 0 ? opt.h : 320))
  const k = opt.k && opt.k > 0 ? opt.k : Math.max(2, pxW / w)
  const W = Math.round(w * k)
  const H = Math.round(h * k)
  // 统一的外层开标签：xmlns + viewBox + width/height **各一份** ✓（原来的尺寸属性一律丢掉 ✓）
  const head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + W + '" height="' + H + '">'
  if (!open) {
    // 片段（对话框给的就是这种 ✓）：自己包一层 ✓
    return { svg: head + src + '</svg>', w, h, k }
  }
  // 完整文档：把**整段开标签**换成我们的 head ✓（里面原有的 width/height/viewBox/xmlns 全被覆盖 ✓）
  const at = src.indexOf(open[0])
  const body = src.slice(at + open[0].length)
  return { svg: head + body, w, h, k }
}
