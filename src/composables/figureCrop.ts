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
