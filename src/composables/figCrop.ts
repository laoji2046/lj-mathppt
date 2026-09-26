/**
 * 【v1659】从"题目截图"里**只切出图形**（用户要求：切图只要图形部分，题目部分不切）✓
 *
 * 为什么自己做：老师截图常常是「一段题干文字 + 一个图」整块截下来的 —— 直接贴进幻灯片会把
 * 文字也带进去（重复且难看）✗。这里做一个**够用的版面启发式**，并且**认得不准就返回 null**
 * （调用方退回"整张图"，绝不乱裁）✓。
 *
 * 判据（先找出"正文行"，剩下的墨迹就是图形）：
 *   1. 二值化（Otsu）→ 连通域 → 每个墨迹块的 bbox；
 *   2. 用小块高度的**中位数**估"一行字多高"，把高度接近它的小块当**字形块**；
 *   3. 字形块按 y 重叠聚成行；**又宽又多**的行（≥6 块且横向铺满 55%）判为正文行 → 整行去掉；
 *      紧挨着正文行、且铺得比较宽的续行也去掉（段落的最后一行常常只有几个字 ✓）；
 *   4. 剩下的墨迹（图形轮廓 + 图里的小字母）取 bbox = 图形区域 ✓；
 *   5. 兜底：图形区域太小（<2% 面积）或太大（>92%）→ 返回 null（不裁）。
 *
 * ⚠ 核心部分是**纯函数**（吃二值墨迹数组），所以能在 node 里用合成图直接测 ✓
 *   （教训：v1652~v1656 那个丢反斜杠的 bug 就是因为探针照抄了一份逻辑 ✗）
 */

export interface CropBox { x: number; y: number; w: number; h: number }

export interface CropOpt {
  /** 一行至少几个字形块才算"正文行"（默认 6） */
  minGlyphs?: number
  /** 正文行要占"最宽那一行"的比例（默认 0.6，内容自适应 ✓） */
  rowSpan?: number
  /** 字形块的高度上限 = 行高中位数的几倍（默认 2.2） */
  glyphH?: number
  /** 字形块的宽度上限 = 行高中位数的几倍（默认 8） */
  glyphW?: number
  /** 续行判据：紧邻正文行（几倍行高内）且铺满整图的比例（默认 0.22） */
  contSpan?: number
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

interface Blob { x0: number; y0: number; x1: number; y1: number; n: number }

/** 连通域（8 邻域，迭代式栈，避免大图递归爆栈） */
function blobs(ink: Uint8Array, w: number, h: number): Blob[] {
  const seen = new Uint8Array(w * h)
  const out: Blob[] = []
  const stack: number[] = []
  for (let i = 0; i < ink.length; i++) {
    if (!ink[i] || seen[i]) continue
    seen[i] = 1
    stack.length = 0
    stack.push(i)
    let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0
    while (stack.length) {
      const p = stack.pop()!
      const x = p % w, y = (p - x) / w
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      n++
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const q = ny * w + nx
          if (ink[q] && !seen[q]) { seen[q] = 1; stack.push(q) }
        }
      }
    }
    out.push({ x0, y0, x1, y1, n })
  }
  return out
}

/**
 * 二值墨迹图 → 图形区域。认不出（整张都是文字 / 剩下的太少太大）返回 null ✓
 * ink: 长度 w*h，非 0 表示"这里有墨" ✓
 */
export function figureBoxFromInk(ink: Uint8Array, w: number, h: number, opt: CropOpt = {}): CropBox | null {
  const minGlyphs = opt.minGlyphs ?? 6
  const rowSpan = opt.rowSpan ?? 0.6
  const glyphH = opt.glyphH ?? 2.2
  const glyphW = opt.glyphW ?? 8
  const contSpan = opt.contSpan ?? 0.22
  const minArea = opt.minArea ?? 0.02
  const maxArea = opt.maxArea ?? 0.92
  const pad = opt.pad ?? 0.04
  if (w < 8 || h < 8) return null

  const bs = blobs(ink, w, h)
  if (!bs.length) return null

  // 行高中位数：只统计"小块"（大块是图形轮廓，会把中位数拉飞 ✗）
  const small = bs.filter((b) => (b.y1 - b.y0 + 1) <= h * 0.08 && b.n <= w * h * 0.002).map((b) => b.y1 - b.y0 + 1)
  let lineH = 0
  if (small.length >= 4) {
    small.sort((a, b) => a - b)
    lineH = small[Math.floor(small.length / 2)]
  }
  // 估不出行高（例如整张就是一幅线稿）→ 整幅当图形 ✓
  if (!lineH) return fitBox(0, 0, w - 1, h - 1, w, h, minArea, maxArea, pad)

  const isGlyph = (b: Blob) => (b.y1 - b.y0 + 1) <= lineH * glyphH && (b.x1 - b.x0 + 1) <= lineH * glyphW
  const glyphs = bs.filter(isGlyph)
  if (glyphs.length < minGlyphs) return fitBox(0, 0, w - 1, h - 1, w, h, minArea, maxArea, pad)

  // 按 y 中心聚行（同一行的字形块中心差不超过半个行高 ✓）
  glyphs.sort((a, b) => ((a.y0 + a.y1) / 2) - ((b.y0 + b.y1) / 2))
  interface Row { y0: number; y1: number; x0: number; x1: number; n: number; members: Blob[] }
  const rows: Row[] = []
  for (const g of glyphs) {
    const cy = (g.y0 + g.y1) / 2
    const r = rows[rows.length - 1]
    if (r && Math.abs(cy - (r.y0 + r.y1) / 2) <= lineH * 0.7) {
      r.y0 = Math.min(r.y0, g.y0); r.y1 = Math.max(r.y1, g.y1)
      r.x0 = Math.min(r.x0, g.x0); r.x1 = Math.max(r.x1, g.x1)
      r.n++; r.members.push(g)
    } else {
      rows.push({ y0: g.y0, y1: g.y1, x0: g.x0, x1: g.x1, n: 1, members: [g] })
    }
  }
  // 正文行：块多 + **铺得比别的行宽**（用内容自适应的行宽 ✓）
  //   ⚠ 别写死"占整图 55%"：截图里文字往往只占半幅宽（实测合成图 26 字一行才 52% ✗）→ 会一行都认不出
  const maxSpan = rows.reduce((m, r) => Math.max(m, r.x1 - r.x0 + 1), 1)
  const bodySpan = Math.max(maxSpan * rowSpan, w * 0.25)
  const cand = rows.map((r) => r.n >= minGlyphs && (r.x1 - r.x0 + 1) >= bodySpan)
  // ⚠ 只删**成段**的正文（≥2 行相邻）：孤零零一行宽墨迹更可能是图里的**虚线/长划线** ✗
  //   （实测风险：虚线的短划也是"小方块"，会被当成一行字 → 整条虚线被切掉 ✗）
  // 相邻判据也**自适应**：用各行间距的中位数（写死 3 倍行高时，行距大一点的文本会一行都不算 ✗）
  const centers = rows.map((r) => (r.y0 + r.y1) / 2)
  const gaps = centers.slice(1).map((c, i) => c - centers[i]).filter((g) => g > 0).sort((a, b) => a - b)
  // 用**最紧的那档行距**（= 正文自己的行距）：中位数会被"正文到图"那一段大间距带偏 ✗
  //   （实测：3 行组成的图里，中位间距 226px → 虚线行被当成"紧挨着正文"→ 被切掉 ✗）
  const baseGap = gaps.length ? gaps[0] : lineH * 2
  const nearGap = Math.max(lineH * 2.5, baseGap * 1.6)
  const isBody = cand.map((v, i) => {
    if (!v) return false
    const near = (j: number) => j >= 0 && j < rows.length && cand[j] && Math.abs(centers[j] - centers[i]) <= nearGap
    return near(i - 1) || near(i + 1)
  })
  const drop = rows.map((r, i) => {
    if (isBody[i]) return true
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= rows.length || !isBody[j]) continue
      const gap = Math.abs((rows[j].y0 + rows[j].y1) / 2 - (r.y0 + r.y1) / 2)
      if (gap <= lineH * 2.2 && (r.x1 - r.x0 + 1) >= Math.max(maxSpan * contSpan, w * 0.08)) return true
    }
    return false
  })
  const dropped = new Set<Blob>()
  rows.forEach((r, i) => { if (drop[i]) for (const m of r.members) dropped.add(m) })

  // 剩下的墨迹 = 图形（含图里的小字母 ✓）
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (const b of bs) {
    if (dropped.has(b)) continue
    x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0)
    x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1)
  }
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
    // 按（放大回原图坐标的）框裁出来
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
