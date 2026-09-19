/**
 * MinerU 产物里的**题目插图** → 题库里的 [图N]。
 *
 * 背景：MinerU 的 full.md 里，题目插图写的是标准 Markdown 图片语法
 *   ![](images/9328c5...jpg)
 * 图片实体在产物目录的 images/ 下。题库**不存磁盘路径**（产物目录是临时缓存，清掉、
 * 换机器、导出 JSON 就全丢），而是由 Rust 侧把正文引用到的图读成 base64 一起回传，
 * 这里换成 [图N] 并把图跟题目一起写进 meta.images。
 *
 * 本文件全是**纯字符串/纯数据变换**（不碰 IO、不碰 Vue），
 * 所以可以直接 bundle 到 Node 里拿真卷数据复算（.probe 里就是这么验的）。
 */
import type { QuestionImage } from './parseQuestions'

/** Rust mineru_parse 回的原始图（base64；对应 lib.rs 的 mineru_collect_images） */
export interface MineruRawImage {
  /** 与 full.md 里引用一致的相对路径，如 images/xxx.jpg */
  path: string
  mime?: string
  bytes?: number
  dataBase64: string
}

/** Markdown 图片语法：![图注](地址 "可选标题")；地址也允许 <...> 包裹 */
const MD_IMG = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)[^)]*\)/g
/** 题干里已有的 [图N]（可能带 :参数）—— 用来避免新编的号跟它撞车 */
const IMG_TAG = /\[图(\d+)/g

function normPath(p: string): string {
  return String(p || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
}

/** data URL（顺带把 mime 补全；Rust 侧已经给了 mime，这里只兜底） */
function toDataUrl(raw: MineruRawImage): string {
  const mime = (raw.mime || '').trim() || 'image/jpeg'
  return 'data:' + mime + ';base64,' + String(raw.dataBase64 || '')
}

/**
 * 把 Markdown 正文里**有实体图**的图片引用换成 [图N]，返回新正文与 N → 图 的映射。
 *
 * 编号规则（三条都要满足，否则会"插进去显示成别的图"）：
 *  ① N 从 1 开始、按出现顺序递增；
 *  ② **跳过正文里本来就写着的 [图N]**（老师手写的、或别的工具给的）—— 不抢号；
 *  ③ 同一个地址只编一个号（同一张图被引用两次时复用）。
 *
 * 找不到实体图的引用**原样留着**（不编空号）—— 老流程的行为不变。
 */
export function linkMineruImages(
  md: string,
  raw: MineruRawImage[] | undefined,
): { text: string; images: QuestionImage[] } {
  const text0 = String(md || '')
  const byPath = new Map<string, MineruRawImage>()
  for (const r of raw || []) {
    const k = normPath(r && r.path)
    if (k && r && r.dataBase64) byPath.set(k, r)
  }
  if (!byPath.size) return { text: text0, images: [] }

  // 正文里已有的 [图N] 全部占位，避免新号撞上去
  const taken = new Set<number>()
  for (const m of text0.matchAll(IMG_TAG)) taken.add(Number(m[1]))
  let next = 0
  const alloc = (): number => {
    do { next++ } while (taken.has(next))
    taken.add(next)
    return next
  }

  const images: QuestionImage[] = []
  const numOf = new Map<string, number>() // 地址 → 已编的号
  const text = text0.replace(MD_IMG, (whole: string, cap: string, url: string) => {
    const key = normPath(url)
    const hit = byPath.get(key)
    if (!hit) return whole
    let n = numOf.get(key)
    if (!n) {
      n = alloc()
      numOf.set(key, n)
      images.push({ n, src: toDataUrl(hit), caption: (cap || '').trim() || undefined })
    }
    return '[图' + n + ']'
  })
  images.sort((a, b) => a.n - b.n)
  return { text, images }
}

/** 文本里引用到的图号 */
export function imageRefsIn(text: string): number[] {
  const out: number[] = []
  for (const m of String(text || '').matchAll(/\[图(\d+)/g)) {
    const n = Number(m[1])
    if (!out.includes(n)) out.push(n)
  }
  return out
}

/**
 * 取一段文本（题干 + 选项 + 解析）真的引用到的图。
 * 用途：一次 MinerU 识别是**整卷共用一个图片表**，入库时要按题拆开 ——
 * 不能让第 3 题背上整卷 12 张图（列表/导出都会白白变大）。
 */
export function imagesForText(text: string, images: QuestionImage[] | undefined): QuestionImage[] {
  const refs = imageRefsIn(text)
  if (!refs.length || !images || !images.length) return []
  const by = new Map(images.map((im) => [im.n, im]))
  const out: QuestionImage[] = []
  for (const n of refs) {
    const hit = by.get(n)
    if (hit) out.push({ n: hit.n, src: hit.src, caption: hit.caption })
  }
  return out
}

/** 题干 + 选项 + 解析（判断一道题引用了哪些图时的检索范围） */
export function questionTextOf(q: { stem?: string; options?: string[]; solution?: string }): string {
  return [q.stem || '', (q.options || []).join('\n'), q.solution || ''].join('\n')
}
