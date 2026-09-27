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
  const minArea = opt.minArea ?? 0.02
  const maxArea = opt.maxArea ?? 0.92
  const pad = opt.pad ?? 0.04
  if (w < 8 || h < 8) return null

  // ① 行投影 → 墨迹带（空隙 ≤2 行并进去 ✓）
  // ⚠ 阈值必须放到最低（有墨就算）：一根**竖直轴线**每行只有 1~2 个墨点，
  //   按"整图宽度的 0.4%"当门限会把轴的上半段整段当成空白 ✗ → 切出来的图被削掉一截（实测）
  const minRowInk = 1
  const prof = new Int32Array(h)
  for (let y = 0; y < h; y++) {
    let n = 0
    for (let x = 0; x < w; x++) if (ink[y * w + x]) n++
    prof[y] = n
  }
  // ⚠ **不合并空隙**：题目最后一行常常紧挨着图（只隔 1~2 行）—— 一并就把"文字 + 图"并成一条很高的带，
  //   高度不像一行 → 整条都留下 → 切出来还带题目 ✗（用户实报）。拆开判，之后**只在两边都像文字时**才合并 ✓
  const has = (y: number) => prof[y] >= minRowInk
  const bands: { y0: number; y1: number }[] = []
  for (let y = 0; y < h;) {
    if (!has(y)) { y++; continue }
    const y0 = y
    while (y + 1 < h && has(y + 1)) y++
    bands.push({ y0, y1: y })
    y++
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
  const center = (b: Band) => (b.y0 + b.y1) / 2
  // ⚠ 高度只做**宽松**上下限：真截图里
  //   · 带根号/分数的**公式行**可以高到 3~4 倍行高（用户真样本实测 h=92 / 行高 36 ✗ 老上限 2.2 倍会漏 ✗）
  //   · 有些**纯文字行**又只有 0.3~0.5 倍行高（h=16 ✗ 老下限 0.5 倍会漏 ✗）
  //   所以"是不是文字"主要看**段数 + 宽度**，高度只管把"很薄的一条（虚线/长划线）"和"很高的一条（图形）"排除 ✓
  //   下限 0.35 倍：真样本里那条薄文字行 h=16 / 行高 36 ✓ 收进来；图里的虚线 h=3 / 行高 10 ✗ 挡在外面
  const inLineHeight = (b: Band) => b.hh >= Math.max(4, lineH * 0.35) && b.hh <= lineH * 4
  // 宽度基准 = **行高像文字的带**里最宽的那条
  //   ⚠ 不能拿"所有带里最宽的"当基准：图比文字宽时，文字行反而不够宽 → 一条都不算文字 ✗（真截图常见）
  // "文字行"的宽度样本 = 段数够多、高度又在宽松范围内那些带（图形那些段数极少 ✓ 不会污染基准）
  const maxTextW = info.reduce((m, b) => (inLineHeight(b) && b.runs >= 8 ? Math.max(m, b.bw) : m), 0)
  const wideEnough = Math.max(maxTextW * 0.25, w * 0.1)
  const dense = (b: Band) => b.inkN / Math.max(1, b.hh * b.bw) >= 0.05
  // ④ "像一行字"的带：高度像一行 + 铺得不窄 + 不是几乎空白 + 段数够多
  /** 高度像一行 + 铺得不窄 + 不是几乎空白（"是不是文字"再看段数/成组 ✓） */
  const lineLike = info.map((b) => inLineHeight(b) && b.bw >= wideEnough && dense(b))
  /** 两条带"像同一个段落里的两行"：高矮接近、宽度接近、间距在一行高上下 */
  const looksStacked = (a: Band, c: Band) => {
    const dh = Math.abs(a.hh - c.hh) <= lineH * 0.8
    const dw = Math.abs(a.bw - c.bw) <= Math.max(a.bw, c.bw) * 0.4
    return dh && dw && Math.abs(center(a) - center(c)) <= lineH * 4
  }
  // ★ 还有一个很硬的特征：**文字是左对齐的** —— 各行的左边界落在同一条竖线上 ✓
  //   用它兜住"短行 / 窄行"（用户真样本：从中间截的图，末尾短行只有百来像素宽，
  //   老的"宽度 ≥ 最宽行 25%"直接把它判成非文字 ✗ → 切出来留着半截题目 ✗）
  const marginXs = info.filter((b, i) => lineLike[i] && b.runs >= minRuns).map((b) => b.x0).sort((a, b) => a - b)
  const margin = marginXs.length ? marginXs[Math.floor(marginXs.length / 2)] : -1
  const nearMargin = (b: Band) => margin >= 0 && Math.abs(b.x0 - margin) <= Math.max(10, lineH * 0.8)
  const isText = info.map((b, i) => {
    // 主判据：高度像一行 + 铺得不窄 + 段数够多（一行字十几段；图形边线只有一两段 ✓）
    if (lineLike[i] && b.runs >= minRuns) return true
    // 兜底一：整段汉字粘连成一条时段数会掉到 1~2 ✗ —— 看"是不是成段排下来的一行"✓
    if (lineLike[i] && ((i > 0 && lineLike[i - 1] && looksStacked(b, info[i - 1])) || (i + 1 < info.length && lineLike[i + 1] && looksStacked(b, info[i + 1])))) return true
    // 兜底二：**左边界跟正文对齐**的短行（窄但确实是那一行字）✓
    return inLineHeight(b) && dense(b) && b.runs >= 3 && nearMargin(b)
  })
  // 把"两边都像文字、而且挨得近"的相邻带并成一段（汉字被空行劈成上下两半的情形 ✓）
  const linkGap = Math.max(2, lineH * 0.9)
  const merged = isText.map((v) => v)
  for (let i = 1; i < info.length; i++) {
    if (!isText[i] || !isText[i - 1]) continue
    if (info[i].y0 - info[i - 1].y1 - 1 > linkGap) continue
    merged[i] = merged[i - 1] = true
  }
  const drop = merged.map((v, i) => {
    if (v) return true
    // 续行：紧挨文字行、高度也像一行、段数 ≥3 的短行（段落最后一行常常只有几个字 ✓）
    const b = info[i]
    if (!inLineHeight(b) || b.runs < 3) return false
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= info.length || !merged[j]) continue
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

/**
 * 【v1665】兜底：**连图形都认不出来**时，至少把四周的空白边去掉 ✓
 *  · 什么时候用得上：整张截图是"一大片白底 + 中间一块内容"，或图形区域判定失败退回整张 ——
 *    原样插进幻灯片会拖着一圈白边 ✗（用户说的"切图不干净"，一部分就是这个 ✓）
 *  · 只裁掉四周**完全空白**的行 / 列，里面一个像素都不动 ✓
 *  · 省不下多少（面积 < 8%）就返回 null —— 与其白折腾，不如老老实实整张插 ✓
 */
export function trimBoxFromInk(ink: Uint8Array, w: number, h: number, opt: CropOpt = {}): CropBox | null {
  const pad = opt.pad ?? 0.04
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!ink[y * w + x]) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (x1 < 0) return null                      // 整张空白
  const box = fitBox(x0, y0, x1, y1, w, h, 0.0005, 0.98, pad)
  if (!box) return null
  if (box.w >= w && box.h >= h) return null    // 一点都没省下
  return 1 - (box.w * box.h) / (w * h) >= 0.08 ? box : null
}

/* ---------------------------------------------------------------------------
 * 浏览器侧：读图 → 二值化 → 调上面的纯函数 → 按框裁出来（返回 dataURL）
 * -------------------------------------------------------------------------*/

export interface CropResult {
  src: string
  box: CropBox | null
  /** 真按"图形区域"裁了（只去掉白边时是 false ✓） */
  cropped: boolean
  /** 【v1665】这一张是怎么处理的：figure=认出图形并裁好 / trim=没认出图形、只去掉四周白边 / raw=原样 */
  mode: 'figure' | 'trim' | 'raw'
  why: string
  /** 【v1665】结果图的**原始像素尺寸** —— 调用方按它定幻灯片里的元素尺寸（不再一律 900×560 ✗） */
  w: number
  h: number
  /** 【v1666】**原图**的尺寸 —— 插入前预览要显示"原图 1835×790"，勾"用整张原图"时也按它排版 ✓ */
  ow: number
  oh: number
}

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
    if (!W || !H) return { src, box: null, cropped: false, mode: 'raw', why: '读不到尺寸', w: 0, h: 0, ow: 0, oh: 0 }
    const maxSide = opt.maxSide ?? 1400
    const s = Math.min(1, maxSide / Math.max(W, H))
    const w = Math.max(8, Math.round(W * s)), h = Math.max(8, Math.round(H * s))
    const cv = document.createElement('canvas')
    cv.width = w; cv.height = h
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    if (!ctx) return { src, box: null, cropped: false, mode: 'raw', why: '没有 canvas', w: W, h: H, ow: W, oh: H }
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
    // 【v1665】认不出单独的图形 → 退一步：**只把四周的白边去掉** ✓
    //   （整张截图是"大白底 + 中间一块内容"很常见；以前是原样整张插 ✗ → 白边一起拖进幻灯片 ✗）
    let mode: 'figure' | 'trim' = 'figure'
    let box = figureBoxFromInk(ink, w, h, opt)
    if (!box) {
      box = trimBoxFromInk(ink, w, h, opt)
      if (box) mode = 'trim'
    }
    if (!box) return { src, box: null, cropped: false, mode: 'raw', why: '这一张认不出单独的图形（整张都要）', w: W, h: H, ow: W, oh: H }
    const sx = box.x / s, sy = box.y / s, sw = box.w / s, sh = box.h / s
    const out = document.createElement('canvas')
    out.width = Math.max(8, Math.round(sw)); out.height = Math.max(8, Math.round(sh))
    const octx = out.getContext('2d')
    if (!octx) return { src, box: null, cropped: false, mode: 'raw', why: '没有 canvas', w: W, h: H, ow: W, oh: H }
    octx.fillStyle = '#ffffff'
    octx.fillRect(0, 0, out.width, out.height)
    octx.drawImage(im, sx, sy, sw, sh, 0, 0, out.width, out.height)
    return {
      src: out.toDataURL('image/png'), box, mode, cropped: mode === 'figure', w: out.width, h: out.height, ow: W, oh: H,
      why: mode === 'figure' ? '已按图形区域裁好' : '没认出单独的图形，只去掉了四周白边',
    }
  } catch (e) {
    return { src, box: null, cropped: false, mode: 'raw', why: String((e as Error)?.message || e), w: 0, h: 0, ow: 0, oh: 0 }
  }
}

/**
 * 【v1666】插入前预览里的一项（对话框里显示、老师勾选）
 *  · cut/cw/ch：切好的结果图与它的尺寸
 *  · raw/rw/rh：原图与它的尺寸（勾"用整张原图"时用这一组 ✓）
 *  · mode：figure=认出图形并裁好 / trim=只去掉四周白边 / raw=原样
 */
export interface CropPreview {
  cut: string
  cw: number
  ch: number
  raw: string
  rw: number
  rh: number
  mode: 'figure' | 'trim' | 'raw'
  why: string
  /** 老师在对话框里勾了"用整张原图"（只对这一张生效 ✓） */
  useRaw?: boolean
}

/**
 * 【v1666】预览里的选择 → 真正要插的图（带尺寸，交给 layoutPics / attachPics 排版 ✓）
 * 抽成纯函数是为了能在探针里直接断言 —— "勾了就用原图、尺寸跟着换"这种事不该只靠肉眼 ✓
 */
export function previewToPics(items: CropPreview[] | null | undefined): { src: string; w: number; h: number }[] {
  const out: { src: string; w: number; h: number }[] = []
  for (const it of items || []) {
    if (!it) continue
    if (it.useRaw && it.raw) out.push({ src: it.raw, w: it.rw, h: it.rh })
    else if (it.cut) out.push({ src: it.cut, w: it.cw, h: it.ch })
    else if (it.raw) out.push({ src: it.raw, w: it.rw, h: it.rh })
  }
  return out
}

/* ---------------------------------------------------------------------------
 * 【v1703】「切图」的批量口径 —— 右侧「AI 助手」侧栏与试卷编辑侧栏**共用一份** ✓
 *   为什么抽出来：同一个功能搬到第二处时，最怕"两处各写一遍、以后只改一处" ✗
 *   （本项目真实教训：题库与试卷两套选项格式化各写一遍 → 一处修好了另一处照旧出错 ✗）
 * -------------------------------------------------------------------------*/

export interface CropBatch {
  items: CropPreview[]
  /** 真按"图形区域"裁好的张数 */
  cropped: number
  /** 只去掉了四周白边的张数 */
  trimmed: number
  /** 认不出图形、原样保留的张数 */
  kept: number
}

/**
 * 一批图按"只切图形"开关裁好，**每张都给一份预览条目**（尺寸/原因齐全，直接交给预览对话框 ✓）
 *  · onlyFigure=false（老师选了"整张图"）→ 全给原图，条目照样给全，调用方不用写分支 ✓
 *  · 认不出图形的单张 → mode='raw' + 原图原样（绝不乱裁 ✓）
 */
export async function cropPicsToPreviews(pics: string[], onlyFigure = true): Promise<CropBatch> {
  const list = pics || []
  if (!onlyFigure || !list.length) {
    return {
      items: list.map((src) => ({ cut: src, cw: 0, ch: 0, raw: src, rw: 0, rh: 0, mode: 'raw' as const, why: '整张可用' })),
      cropped: 0, trimmed: 0, kept: list.length,
    }
  }
  const items: CropPreview[] = []
  let cropped = 0, trimmed = 0
  for (const p of list) {
    const r = await cropToFigure(p)
    // 【v1665】只去掉白边（mode=trim）也算处理过了 → 尺寸按结果图走 ✓（图片比例排版要用它 ✓）
    const useCut = r.cropped || r.mode === 'trim'
    items.push({
      cut: useCut ? r.src : p, cw: useCut ? r.w : r.ow, ch: useCut ? r.h : r.oh,
      raw: p, rw: r.ow, rh: r.oh, mode: r.mode, why: r.why,
    })
    if (r.cropped) cropped++
    else if (r.mode === 'trim') trimmed++
  }
  return { items, cropped, trimmed, kept: items.length - cropped - trimmed }
}

/** 切图结果的一句话说明（"2 张只留了图形部分；1 张只去掉了白边；3 张认不出图形，整张插了" ✓）
 *  什么都没切 / 没传 → 空串（不印一对空括号 ✗） */
export function cropNoteText(cut: { cropped?: number; trimmed?: number; kept?: number } | null | undefined): string {
  const c = cut || {}
  const bits: string[] = []
  if (c.cropped) bits.push(c.cropped + ' 张只留了图形部分')
  if (c.trimmed) bits.push(c.trimmed + ' 张只去掉了白边')
  if (c.kept) bits.push(c.kept + ' 张认不出图形，整张插了')
  return bits.length ? '（' + bits.join('；') + '）' : ''
}
