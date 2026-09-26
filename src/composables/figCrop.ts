/**
 * 【v1659】从"题目截图"里**只切出图形**（用户要求：切图只要图形部分，题目部分不切）✓
 *
 * 为什么自己做：老师截图常常是「一段题干文字 + 一个图」整块截下来的 —— 直接贴进幻灯片会把
 * 文字也带进去（重复且难看）✗。这里做一个**够用的版面启发式**，并且**认得不准就返回 null**
 * （调用方退回"整张图"，绝不乱裁）✓。
 *
 * 判据（v1659b 改用"墨迹带"，不再依赖"每个字是一个小连通域"）：
 *   ⚠ 教训：第一版按"小方块 = 字形"来认，真截图里**汉字粘连 / 抗锯齿**会把一行字连成长块 ✗
 *     → 整行认不出是文字 → 切出来还带着题目（用户实报"好像切的还有题目"）✗
 *   现在：
 *   1. 行投影 → **墨迹带**（1~2 行的空隙并进去：汉字上下结构/抗锯齿常留空行 ✓）；
 *   2. 行高 = 薄带高度的中位数；
 *   3. 每条带算：墨迹范围、最密那一行的**段数**（一行字十几段；图形的边线只有一两段 ✓）；
 *   4. 判"文字行" = 高度像一行 + 铺得不太窄 + 不是几乎空白，**再分两种**：
 *      · 段数够多（≥5）→ 直接算文字行 ✓
 *      · 段数少但**与邻带成组**（高度/宽度接近、间距规律）→ 也算文字行 ✓（粘连成一块也能认出来 ✓）
 *   5. 续行：紧挨文字行、高度也像一行、段数 ≥3 的短行（段落最后一行常常只有几个字 ✓）也去掉；
 *      ⚠ 但**薄**墨迹（< 半行高）不动它 —— 图里的虚线/长划线正是很薄的一带 ✗
 *   6. 剩下的墨迹（图形轮廓 + 图里的小字母）取 bbox = 图形区域 ✓；
 *   7. 兜底：太小（<2% 面积）或太大（>92%）→ 返回 null（不裁）。
 *
 * ⚠ 核心是**纯函数**（吃二值墨迹数组），所以能在 node 里用合成图直接测 ✓
 *   （教训：v1652~v1656 那个丢反斜杠的 bug 就是因为探针照抄了一份逻辑 ✗）
 */

export interface CropBox { x: number; y: number; w: number; h: number }

export interface CropOpt {
  /** 一行至少几段墨迹才算"文字行"（默认 5：图形边线通常只有 1~2 段 ✓） */
  minRuns?: number
  /** 文字行要占"最宽那一带"的比例（默认 0.5，内容自适应 ✓） */
  rowSpan?: number
  /** 文字行的高度上限 = 行高的几倍（默认 2.2） */
  lineMax?: number
  /** 图形区域面积占整图的下限 / 上限（默认 0.02 / 0.92） */
  minArea?: number
  maxArea?: number
  /** 裁完四周留的边距（占图形区域短边的比例，默认 0.04） */
  pad?: number
}

/** Otsu 阈值：给灰度直方图（256 桶）算一个"墨/纸"分界 ✓ */
export function otsuThreshold(hist: number[], total: number): number {
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0, wB = 0, best = 0, bestVar = -1
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const v = wB * wF * (mB - mF) * (mB - mF)
    if (v > bestVar) { bestVar = v; best = t }
  }
  return best
}

/** 某一行上"有几段墨迹"—— 一行字有十几段（每个字 2~4 段）；图形边线只有一两段 ✓ */
function runsAt(ink: Uint8Array, w: number, y: number): number {
  let runs = 0, prev = 0
  for (let x = 0; x < w; x++) {
    const v = ink[y * w + x] ? 1 : 0
    if (v && !prev) runs++
    prev = v
  }
  return runs
}

interface Band { y0: number; y1: number; x0: number; x1: number; bw: number; inkN: number; runs: number; hh: number }

/**
 * 二值墨迹图 → 图形区域。认不出（整张都是文字 / 剩下的太少太大）返回 null ✓
 * ink: 长度 w*h，非 0 表示"这里有墨" ✓
 */
export function figureBoxFromInk(ink: Uint8Array, w: number, h: number, opt: CropOpt = {}): CropBox | null {
  const minRuns = opt.minRuns ?? 5
  const rowSpan = opt.rowSpan ?? 0.5
  const lineMax = opt.lineMax ?? 2.2
  const minArea = opt.minArea ?? 0.02
  const maxArea = opt.maxArea ?? 0.92
  const pad = opt.pad ?? 0.04
  if (w < 8 || h < 8) return null

  // ① 行投影 → 墨迹带（空隙 ≤2 行并进去 ✓）
  const minRowInk = Math.max(1, Math.round(w * 0.004))
  const prof = new Int32Array(h)
  for (let y = 0; y < h; y++) {
    let n = 0
    for (let x = 0; x < w; x++) if (ink[y * w + x]) n++
    prof[y] = n
  }
  const has = (y: number) => prof[y] >= minRowInk
  const bands: { y0: number; y1: number }[] = []
  for (let y = 0; y < h;) {
    if (!has(y)) { y++; continue }
    const y0 = y
    let last = y
    while (y < h) {
      if (has(y)) { last = y; y++; continue }
      let yy = y
      while (yy < h && !has(yy) && yy - y <= 2) yy++
      if (yy < h && has(yy) && yy - y <= 2) { y = yy; continue }
      break
    }
    bands.push({ y0, y1: last })
    y = last + 1
  }
  if (!bands.length) return null

  // ② 行高：薄带高度的中位数（厚带多半是图形 ✓）
  const thin = bands.map((b) => b.y1 - b.y0 + 1).filter((v) => v <= h * 0.1).sort((a, b) => a - b)
  const lineH = thin.length ? thin[Math.floor(thin.length / 2)] : 0
  if (!lineH) return fitBox(0, 0, w - 1, h - 1, w, h, minArea, maxArea, pad)

  // ③ 每条带：墨迹范围 + 最密那一行的段数
  const info: Band[] = bands.map((b) => {
    let x0 = w, x1 = -1, inkN = 0, bestY = b.y0, bestInk = -1
    for (let y = b.y0; y <= b.y1; y++) {
      let n = 0
      for (let x = 0; x < w; x++) if (ink[y * w + x]) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x }
      inkN += n
      if (n > bestInk) { bestInk = n; bestY = y }
    }
    const bw = x1 >= x0 ? x1 - x0 + 1 : 0
    return { y0: b.y0, y1: b.y1, x0, x1, bw, inkN, runs: runsAt(ink, w, bestY), hh: b.y1 - b.y0 + 1 }
  })
  const maxBw = info.reduce((m, b) => Math.max(m, b.bw), 1)
  const wideEnough = Math.max(maxBw * rowSpan, w * 0.25)

  // ④ "像一行字"的带（高度像、铺得不太窄、不是几乎空白）
  const lineLike = info.map((b) => b.hh >= lineH * 0.5 && b.hh <= lineH * lineMax && b.bw >= wideEnough && b.inkN / Math.max(1, b.hh * b.bw) >= 0.05)
  const center = (b: Band) => (b.y0 + b.y1) / 2
  // 段数够多 → 文字行；段数少但**与邻带成组**（高度/宽度接近、间距规律）→ 也是文字行 ✓
  //   （真截图里汉字粘连会把一行连成长块，段数掉到 1~2 ✗ —— 靠"成组"认出来 ✓）
  const isText = info.map((b, i) => {
    if (!lineLike[i]) return false
    if (b.runs >= minRuns) return true
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= info.length || !lineLike[j]) continue
      const c = info[j]
      const dh = Math.abs(b.hh - c.hh) <= lineH * 0.6
      const dw = Math.abs(b.bw - c.bw) <= Math.max(b.bw, c.bw) * 0.35
      if (dh && dw && Math.abs(center(b) - center(c)) <= lineH * 4) return true
    }
    return false
  })
  // 续行：紧挨文字行、高度也像一行、段数 ≥3 的短行（段落最后一行常常只有几个字 ✓）
  const drop = info.map((b, i) => {
    if (isText[i]) return true
    if (b.hh < lineH * 0.5 || b.hh > lineH * lineMax) return false      // 太薄（虚线/长划线）→ 不动 ✓
    if (b.runs < 3) return false
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= info.length || !isText[j]) continue
      if (Math.abs(center(b) - center(info[j])) <= lineH * 2.6) return true
    }
    return false
  })

  // ⑤ 剩下的墨迹 = 图形（含图里的小字母 ✓）
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  info.forEach((b, i) => {
    if (drop[i]) return
    x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0)
    x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1)
  })
  if (x1 < 0) return null                       // 整张都是文字 → 不裁
  return fitBox(x0, y0, x1, y1, w, h, minArea, maxArea, pad)
}

/** 夹到图内 + 面积兜底 + 留边距 */
function fitBox(x0: number, y0: number, x1: number, y1: number, w: number, h: number, minArea: number, maxArea: number, pad: number): CropBox | null {
  let bw = x1 - x0 + 1, bh = y1 - y0 + 1
  const area = (bw * bh) / (w * h)
  if (area < minArea || area > maxArea) return null
  const p = Math.round(Math.min(bw, bh) * pad)
  const nx = Math.max(0, x0 - p), ny = Math.max(0, y0 - p)
  const nx1 = Math.min(w - 1, x1 + p), ny1 = Math.min(h - 1, y1 + p)
  bw = nx1 - nx + 1; bh = ny1 - ny + 1
  if (bw < 8 || bh < 8) return null
  return { x: nx, y: ny, w: bw, h: bh }
}

/* ---------------------------------------------------------------------------
 * 浏览器侧：读图 → 二值化 → 调上面的纯函数 → 按框裁出来（返回 dataURL）
 * -------------------------------------------------------------------------*/

export interface CropResult { src: string; box: CropBox | null; cropped: boolean; why: string }

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image()
    im.onload = () => res(im)
    im.onerror = () => rej(new Error('图片读不出来'))
    im.src = src
  })
}

/** 把一张图**只保留图形部分**；认不出就原样返回（cropped=false）✓ */
export async function cropToFigure(src: string, opt: CropOpt & { maxSide?: number } = {}): Promise<CropResult> {
  try {
    const im = await loadImg(src)
    const W = im.naturalWidth || im.width, H = im.naturalHeight || im.height
    if (!W || !H) return { src, box: null, cropped: false, why: '读不到尺寸' }
    const maxSide = opt.maxSide ?? 1400
    const s = Math.min(1, maxSide / Math.max(W, H))
    const w = Math.max(8, Math.round(W * s)), h = Math.max(8, Math.round(H * s))
    const cv = document.createElement('canvas')
    cv.width = w; cv.height = h
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    if (!ctx) return { src, box: null, cropped: false, why: '没有 canvas' }
    ctx.drawImage(im, 0, 0, w, h)
    const d = ctx.getImageData(0, 0, w, h).data
    const gray = new Uint8Array(w * h)
    const hist = new Array(256).fill(0)
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const a = d[i + 3]
      // 透明当白纸；否则按亮度（0.299/0.587/0.114）
      const g = a < 8 ? 255 : Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
      gray[p] = g
      hist[g]++
    }
    const th = otsuThreshold(hist, w * h)
    const ink = new Uint8Array(w * h)
    for (let p = 0; p < gray.length; p++) ink[p] = gray[p] <= th ? 1 : 0
    const box = figureBoxFromInk(ink, w, h, opt)
    if (!box) return { src, box: null, cropped: false, why: '这一张认不出单独的图形（整张都要）' }
    const sx = box.x / s, sy = box.y / s, sw = box.w / s, sh = box.h / s
    const out = document.createElement('canvas')
    out.width = Math.max(8, Math.round(sw)); out.height = Math.max(8, Math.round(sh))
    const octx = out.getContext('2d')
    if (!octx) return { src, box: null, cropped: false, why: '没有 canvas' }
    octx.fillStyle = '#ffffff'
    octx.fillRect(0, 0, out.width, out.height)
    octx.drawImage(im, sx, sy, sw, sh, 0, 0, out.width, out.height)
    return { src: out.toDataURL('image/png'), box, cropped: true, why: '已按图形区域裁好' }
  } catch (e) {
    return { src, box: null, cropped: false, why: String((e as Error)?.message || e) }
  }
}
