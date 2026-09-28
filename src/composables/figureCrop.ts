/**
 * 【v1725】数学图形的「裁剪显示 / 打印时隐藏」—— 纯函数 ✓ 画布与探针共用 ✓
 *
 * 裁剪显示：只露中间那块（四边各裁掉百分之几 ✓）用 CSS clip-path: inset(上 右 下 左) ✓
 *   —— 不碰源数据 ✓ 随时改回完整图形 ✓（和图片的「非破坏性裁剪」一个思路 ✓）
 * 打印时隐藏：元素加 data-noprint，main.css 的 @media print 里 display:none ✓
 *   —— 讲课时用遮罩块盖着，打印讲义时干净 ✓
 */

export interface FigCrop { l: number; r: number; t: number; b: number }

/** 四边比例（0~0.9）→ clip-path 的 inset 写法 ✓ 没裁就返回空串 ✓ */
export function cropInsetCss(c?: FigCrop | null): string {
  if (!c) return ''
  const p = (v: number) => Math.round(Math.max(0, Math.min(0.9, Number(v) || 0)) * 1000) / 10
  const l = p(c.l), r = p(c.r), t = p(c.t), b = p(c.b)
  if (!l && !r && !t && !b) return ''
  return 'inset(' + t + '% ' + r + '% ' + b + '% ' + l + '%' + ')'
}

/** 从元素上取裁剪 → clip-path 值 ✓（模板里直接 figCropCss(el) 就能用 ✓） */
export function figCropCss(el: unknown): string {
  const c = (el as { crop?: FigCrop } | null | undefined)?.crop
  return cropInsetCss(c)
}

/** 这个元素是不是「打印/导出时隐藏」✓ */
export function figNoPrint(el: unknown): boolean {
  return !!(el as { noPrint?: boolean } | null | undefined)?.noPrint
}
/** 遮罩可选形状 ✓（只显示形状内的部分，外面全隐藏 ✓ —— 跟「裁剪」相反：裁剪是减法、遮罩是只留窗口 ✓） */
export const MASK_SHAPES: { v: string; label: string }[] = [
  { v: 'none', label: '不遮罩（默认）' },
  { v: 'circle', label: '圆形窗口' },
  { v: 'ellipse', label: '椭圆窗口' },
  { v: 'round', label: '圆角矩形窗口' },
  { v: 'self', label: '用它自己的形状（多边形图形 ✓）' },
]

/**
 * 【v1727】遮罩 → CSS clip-path ✓
 *   circle / ellipse / round：按元素外框算 ✓
 *   self：用元素自己的归一化顶点（points ✓ 扁平 0~1）拼 polygon ✓ —— 落在轮廓外的部分整块消失 ✓
 * 返回空串 = 不遮罩 ✓
 */
export function maskClipCss(mask?: { shape?: string } | null, points?: number[] | null): string {
  const sh = String((mask && mask.shape) || '')
  if (!sh || sh === 'none') return ''
  if (sh === 'circle') return 'circle(50% at 50% 50%)'
  if (sh === 'ellipse') return 'ellipse(50% 50% at 50% 50%)'
  if (sh === 'round') return 'inset(0 round 14%)'
  if (sh === 'self') {
    const p = points || []
    if (p.length < 6) return 'circle(50% at 50% 50%)'   // 没有顶点 → 退回圆形，别把图形整块藏没了 ✓
    const out: string[] = []
    for (let i = 0; i + 1 < p.length; i += 2) out.push((p[i] * 100).toFixed(2) + '% ' + (p[i + 1] * 100).toFixed(2) + '%')
    return 'polygon(' + out.join(', ') + ')'
  }
  return ''
}

/** 从元素上取遮罩 → clip-path 值 ✓（模板里 figMaskCss(el) 直接用 ✓） */
export function figMaskCss(el: unknown): string {
  const e = el as { mask?: { shape?: string }; points?: number[] } | null | undefined
  return maskClipCss(e?.mask, e?.points)
}
