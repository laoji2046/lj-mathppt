/**
 * 【v1730】题图预处理：去白边 → 放大（欠采样）→ 灰度 + 轻对比 ✓
 *
 * 为什么：老师贴的题目图常常是「拍屏 / 截图 / 扫描」—— 四周一大片白、线细、字小 ✗
 *   · 视觉模型看不清 → 读图阶段就开始错 ✓
 *   · 矢量识别（复用「矢量识别」那套）也要图够大才认得出线 ✗
 * 所以读图前先过一遍这里 ✓
 *
 * 设计：**纯函数**（Otsu 阈值 / 墨迹包围盒 / 留白 / 缩放计划）单独拿出来 → 探针能盯 ✓
 *   画布部分（prepImageEl / loadImg）在浏览器里跑 ✓ 不碰模块顶层（node 里 require 也不炸 ✓）
 */

/** 灰度直方图（256 桶）→ Otsu 阈值 ✓ 纯函数（空直方图给 200：偏"白纸"的保守值 ✓） */
export function otsuLevel(hist: number[]): number {
  let total = 0, sum = 0
  for (let i = 0; i < 256; i++) { const h = hist[i] || 0; total += h; sum += i * h }
  if (!total) return 200
  let sumB = 0, wB = 0, best = 200, bestVar = -1
  for (let t = 0; t < 256; t++) {
    wB += hist[t] || 0
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * (hist[t] || 0)
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const v = wB * wF * (mB - mF) * (mB - mF)
    if (v > bestVar) { bestVar = v; best = t }
  }
  return best
}

/** 墨迹包围盒：比阈值**暗**的算墨迹 ✓ 返回 [x0,y0,x1,y1)（右/下开区间 ✓）；整张没有墨迹就返回整幅 ✓ 纯函数 */
export function inkBox(gray: ArrayLike<number>, W: number, H: number, level: number): [number, number, number, number] {
  let x0 = W, y0 = H, x1 = -1, y1 = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (gray[y * W + x] <= level) {
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return [0, 0, W, H]
  return [x0, y0, x1 + 1, y1 + 1]
}

/** 给包围盒留白边（题图四周留一点，别把贴着边的笔画切掉）并夹进原图 ✓ 纯函数 */
export function padBox(box: [number, number, number, number], pad: number, W: number, H: number): [number, number, number, number] {
  return [
    Math.max(0, box[0] - pad),
    Math.max(0, box[1] - pad),
    Math.min(W, box[2] + pad),
    Math.min(H, box[3] + pad),
  ]
}

/**
 * 缩放计划：短边不足 target 就**放大**（最多 maxScale 倍 ✓）；长边超过 maxSide 就缩回去 ✓
 *   —— 绝不为了"省 token"把本来就不大的图缩小 ✗（线细字小正是识别不准的主因 ✓）
 * 纯函数 ✓ 探针盯着
 */
export function fitPlan(W: number, H: number, target: number, maxScale: number, maxSide = 2400): { scale: number; outW: number; outH: number } {
  const side = Math.min(W, H)
  let scale = 1
  if (side > 0 && target > 0 && side < target) scale = Math.min(maxScale, target / side)
  const big = Math.max(W, H) * scale
  if (maxSide > 0 && big > maxSide) scale = scale * (maxSide / big)
  return { scale, outW: Math.max(1, Math.round(W * scale)), outH: Math.max(1, Math.round(H * scale)) }
}

/** 读图（data URL / 文件 URL 都行 ✓）；失败给出可读原因 ✓ */
export function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error("图读不出来（格式不支持？）"))
    im.src = src
  })
}

export interface PrepInfo {
  before: [number, number]
  after: [number, number]
  scale: number
  box: [number, number, number, number]
  level: number
}

/**
 * 预处理一张已经加载好的图 ✓
 *  ① 灰度 + Otsu 阈值；② 去白边（留 2% 白边）；③ 按 fitPlan 放大 / 限幅；
 *  ④ 灰度 + 轻对比（把泛黄的纸面拉白 ✓ **不二值化** —— 二值化会把细线切碎 ✗）
 */
export async function prepImageEl(
  img: HTMLImageElement,
  opt: { target?: number; maxScale?: number; pad?: number; maxSide?: number } = {},
): Promise<{ dataUrl: string; info: PrepInfo }> {
  const target = opt.target ?? 900
  const maxScale = opt.maxScale ?? 3
  const W = img.naturalWidth || img.width
  const H = img.naturalHeight || img.height
  if (!W || !H) throw new Error("图尺寸拿不到")
  const cv = document.createElement("canvas")
  cv.width = W
  cv.height = H
  const ctx = cv.getContext("2d")
  if (!ctx) throw new Error("画布不可用")
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, W, H).data
  const gray = new Uint8Array(W * H)
  const hist: number[] = new Array(256).fill(0)
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const g = (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) | 0
    gray[i] = g
    hist[g]++
  }
  const level = otsuLevel(hist)
  const box = padBox(inkBox(gray, W, H, level), Math.round(Math.min(W, H) * (opt.pad ?? 0.02)), W, H)
  const bw = Math.max(1, box[2] - box[0])
  const bh = Math.max(1, box[3] - box[1])
  const plan = fitPlan(bw, bh, target, maxScale, opt.maxSide ?? 2400)
  const out = document.createElement("canvas")
  out.width = plan.outW
  out.height = plan.outH
  const octx = out.getContext("2d")
  if (!octx) throw new Error("画布不可用")
  octx.imageSmoothingEnabled = true
  octx.imageSmoothingQuality = "high"
  octx.drawImage(cv, box[0], box[1], bw, bh, 0, 0, plan.outW, plan.outH)
  // 灰度 + 轻对比（拉白纸面 ✓ 细线不切碎 ✓）
  const id = octx.getImageData(0, 0, plan.outW, plan.outH)
  const px = id.data
  for (let i = 0; i < px.length; i += 4) {
    const g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0
    const v = Math.max(0, Math.min(255, Math.round((g - 128) * 1.25 + 146)))
    px[i] = v
    px[i + 1] = v
    px[i + 2] = v
    px[i + 3] = 255
  }
  octx.putImageData(id, 0, 0)
  return {
    dataUrl: out.toDataURL("image/png"),
    info: { before: [W, H], after: [plan.outW, plan.outH], scale: plan.scale, box, level },
  }
}
