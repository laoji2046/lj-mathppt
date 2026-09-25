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
): { text: string; images: QuestionImage[]; marks: Record<number, number>; paths: Record<number, string> } {
  const text0 = String(md || '')
  const byPath = new Map<string, MineruRawImage>()
  /** 【v1531】再按**文件名**兜一层：老师手动「导入 .md」时选中的是图片文件本身，
   *  拿不到 `images/xxx.jpg` 这种相对路径（浏览器只给 File.name / webkitRelativePath）✓ */
  const byBase = new Map<string, MineruRawImage>()
  for (const r of raw || []) {
    const k = normPath(r && r.path)
    if (k && r && r.dataBase64) byPath.set(k, r)
    const b = k.split('/').pop() || ''
    if (b && r && r.dataBase64 && !byBase.has(b)) byBase.set(b, r)
  }
  if (!byPath.size) return { text: text0, images: [], marks: {}, paths: {} }

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
  /** 图号 → 它在正文里的字符位置（【v1451】兜底归属时要用：图落在哪道题之后，就挂给哪道题 ✓） */
  const marks: Record<number, number> = {}
  /** 【v1454】图号 → 原路径：几何（页 + y）是从路径查出来的，所以要有这张反查表 ✓ */
  const paths: Record<number, string> = {}
  const numOf = new Map<string, number>() // 地址 → 已编的号
  const text = text0.replace(MD_IMG, (whole: string, cap: string, url: string, offset: number) => {
    const key = normPath(url)
    const hit = byPath.get(key) || byBase.get(key.split('/').pop() || '')
    if (!hit) return whole
    let n = numOf.get(key)
    if (!n) {
      n = alloc()
      numOf.set(key, n)
      marks[n] = offset
      paths[n] = key
      images.push({ n, src: toDataUrl(hit), caption: (cap || '').trim() || undefined })
    }
    return '[图' + n + ']'
  })
  images.sort((a, b) => a.n - b.n)
  return { text, images, marks, paths }
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
/**
 * 【v1451 / v1454】没被任何题引用的图 → 兜底挂到**它前面最近的那道题**，并在这道题上标 warn。
 *
 * 为什么需要：MinerU 把图形判成 table、把公式裁成图时，图的引用可能落在**卷头 / 题与题之间**，
 * 于是 imagesForText 谁都不认领，图就静默消失了（实测 15 张只收到 4 张 ✗）。
 *
 * 归属优先级（【v1454】借 gaokao-math-questions「文件名带几何」的思路，改从 content_list 取）：
 *   ① **几何**：图的 (页, y) 落在哪道题的 (页, y) 之后 → 挂那道题（同页 + y 最近，最稳 ✓）
 *   ② 退回**字符偏移**：图号在正文里的位置落在哪道题之后
 * 纪律：**不许悄悄丢** —— 挂错也比丢了强，但要**标出来让人核对** ✓
 */
export function attachOrphans(
  text: string,
  list: { stem?: string; options?: string[]; solution?: string; images?: QuestionImage[]; warn?: string }[],
  all: QuestionImage[],
  marks: Record<number, number>,
  geo?: { where: Record<number, { page: number; y: number }>; blocks: { head: string; page: number; y: number }[] },
): { attached: number; orphans: number[] } {
  if (!list.length || !all.length) return { attached: 0, orphans: [] }
  const used = new Set<number>()
  for (const q of list) for (const im of imagesForText(questionTextOf(q), all)) used.add(im.n)
  const left = all.filter((im) => !used.has(im.n))
  if (!left.length) return { attached: 0, orphans: [] }
  // 每道题在正文里的起点（拿题干头 12 个字去找；找不到记 -1）
  const at = list.map((q) => {
    const head = String(q.stem || q.solution || '').trim().slice(0, 12)
    return head ? String(text || '').indexOf(head) : -1
  })
  // 【v1454】每道题落在哪个正文块上（按字符起点找）—— 有几何时用它拿「题在哪一页 / y」
  const G = geo && geo.blocks && geo.blocks.length ? geo : null
  const qAt: number[] = G
    ? at.map((off) => {
        if (off < 0) return -1
        let best = -1
        for (let j = 0; j < G.blocks.length; j++) {
          const o = String(text || '').indexOf(G.blocks[j].head)
          if (o >= 0 && o <= off) best = j
        }
        return best
      })
    : []
  const yx = (p: { page: number; y: number }) => p.page * 100000 + p.y
  let attached = 0
  for (const im of left) {
    const off = marks[im.n] ?? -1
    let pick = 0
    let byGeo = false
    const w = G && G.where ? G.where[im.n] : null
    if (w && G && qAt.length) {
      let bestY = -1
      for (let i = 0; i < list.length; i++) {
        const j = qAt[i]
        if (j < 0) continue
        const g = G.blocks[j]
        if (yx(g) <= yx(w) && yx(g) > bestY) {
          bestY = yx(g)
          pick = i
          byGeo = true
        }
      }
    }
    if (!byGeo && off >= 0) {
      for (let i = 0; i < list.length; i++) if (at[i] >= 0 && at[i] <= off) pick = i
    }
    const q = list[pick]
    q.images = [...(q.images || []), { n: im.n, src: im.src, caption: im.caption }]
    q.warn = [q.warn, '第 ' + im.n + ' 张图没找到所属题，已按' + (byGeo ? '原图页/位置' : '正文位置') + '挂到这里，请核对'].filter(Boolean).join('；')
    attached++
  }
  return { attached, orphans: left.map((x) => x.n) }
}

/** 题干 + 选项 + 解析（判断一道题引用了哪些图时的检索范围） */
export function questionTextOf(q: { stem?: string; options?: string[]; solution?: string }): string {
  return [q.stem || '', (q.options || []).join('\n'), q.solution || ''].join('\n')
}

/* ------------------------------------------------------------------ *
 * 【v1457】题内图号 + 图落点
 *   —— 预览 / 校对表 / 导出 Markdown 三处**共用这一套规则**（Rust 侧 lib_fig_plan 是同一套）
 *   为什么：录入时的图号是**全卷**的（第 3、4 张），而正文里写的是**本题**的「如图1」「如图2」——
 *     导出后读者看见「图3/图4」，跟正文对不上 ✗
 * ------------------------------------------------------------------ */

/** 中文数字 → 阿拉伯（一…二十三；认不出返回 0 = 不猜 ✓） */
export function cnNum(s: string): number {
  const t = String(s || '')
  if (!t) return 0
  const one = (c: string) => ('一二三四五六七八九'.indexOf(c) + 1)
  if (t[0] === '十') return t.length === 1 ? 10 : t.length === 2 ? 10 + one(t[1]) : 0
  const v = one(t[0])
  if (!v) return 0
  if (t.length === 1) return v
  if (t[1] === '十') return t.length === 2 ? v * 10 : t.length === 3 ? v * 10 + one(t[2]) : 0
  return 0
}

/** 1..=20 → 中文数字（正文里写「图二」也能找到落点 ✓；超出范围回空串） */
export function cnStr(n: number): string {
  const D = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  if (n >= 1 && n <= 9) return D[n]
  if (n === 10) return '十'
  if (n >= 11 && n <= 19) return '十' + D[n - 10]
  if (n === 20) return '二十'
  return ''
}

/** 图注里的图号：「图1 / 图一 / (图二)」→ 数字；认不出返回 0（不猜 ✓） */
export function captionFigNo(cap: string): number {
  const m = String(cap || '').match(/图\s*([0-9]{1,2}|[一二三四五六七八九十]{1,3})/)
  if (!m) return 0
  const n = /^[0-9]/.test(m[1]) ? Number(m[1]) : cnNum(m[1])
  return n >= 1 && n <= 60 ? n : 0
}

/** 题内图号：图注写了就用图注的，否则按顺序 1..k ✓ */
export function dispNoOf(im: QuestionImage | undefined, idx: number): number {
  const n = captionFigNo(String((im && im.caption) || ''))
  return n || idx + 1
}

/** 图的显示标签：图注本身就是「图N」时只留图注（不再啰嗦成「图3 · 图1」✓） */
export function figLabelOf(im: QuestionImage | undefined, disp: number): string {
  const cap = String((im && im.caption) || '').trim()
  if (captionFigNo(cap)) return cap
  return '图' + disp + (cap ? ' · ' + cap : '')
}

/** 正文里找「图N / 图X」引用：后面紧跟数字/中文数字的不算（图1 不能切走 图12 ✓） */
function findRef(line: string, keys: string[]): number {
  for (const k of keys) {
    if (!k) continue
    let from = 0
    for (;;) {
      const i = line.indexOf(k, from)
      if (i < 0) break
      const nx = line.slice(i + k.length, i + k.length + 1)
      if (!/[0-9一二三四五六七八九十]/.test(nx)) return i
      from = i + k.length
    }
  }
  return -1
}


/** 【v1457】只含 [图N] 标记和空白？—— 「末尾标记」的判据 ✓ */
function onlyMarks(s: string): boolean {
  let t = String(s || '')
  for (;;) {
    const p = t.indexOf('[图')
    if (p < 0) break
    const rel = t.slice(p).indexOf(']')
    if (rel < 0) return false
    t = t.slice(0, p) + t.slice(p + rel + 1)
  }
  return !t.trim()
}

/**
 * 把题干里的图位统一成 @@FIG:<i>@@（i = 图数组下标）——渲染方只需认识这一个占位符 ✓
 *   ① 题干里已有的 [图N] 标记 → 就地换（N 先试录入号、再试题内号）
 *   ② 没标记的：图在哪一行被提到 → 插在那行后面（同一行多图按顺序排）
 *   ③ 一行都没提到 → 排到题干末尾（**一张都不丢** ✓）
 */
export function placeFigures(text: string, imgs: QuestionImage[] | undefined): string {
  let out = String(text == null ? '' : text)
  const list = imgs || []
  if (!out || !list.length) return out
  const pend: number[] = []
  for (let i = 0; i < list.length; i++) {
    const orig = Number(list[i].n) || 0
    const disp = dispNoOf(list[i], i)
    let done = false
    for (const n of [orig, disp]) {
      if (n <= 0) continue
      const re = new RegExp('\\[图\\s*' + n + '(?::[^\\]]*)?\\]')
      const m = out.match(re)
      if (!m || m.index == null) continue
      const at = m.index
      // 【v1457】位于**题干末尾**的图标记 → 不就地，交给「按题内图号排」的末尾
      //   （否则图按录入顺序排，图2 会跑到图1 前面 ✗）
      if (onlyMarks(out.slice(at + m[0].length))) {
        out = out.slice(0, at) + out.slice(at + m[0].length)
        break
      }
      out = out.slice(0, at) + '\n@@FIG:' + i + '@@\n' + out.slice(at + m[0].length)
      done = true
      break
    }
    if (!done) pend.push(i)
  }
  // 【v1457】按**题内图号**排（图1 在图2 前面）—— 图的采集顺序未必等于文档顺序 ✓
  pend.sort((a, b) => dispNoOf(list[a], a) - dispNoOf(list[b], b))
  if (!pend.length) return out
  const lines = out.split('\n')
  const extra: number[][] = lines.map(() => [])
  const rest: number[] = []
  for (const i of pend) {
    const disp = dispNoOf(list[i], i)
    const keys = ['图' + disp, '图' + cnStr(disp)]
    let hit = -1
    for (let L = 0; L < lines.length; L++) if (findRef(lines[L], keys) >= 0) hit = L
    if (hit < 0) rest.push(i)
    else extra[hit].push(i)
  }
  const outLines: string[] = []
  lines.forEach((L, k) => {
    outLines.push(L)
    for (const i of extra[k]) outLines.push('@@FIG:' + i + '@@')
  })
  for (const i of rest) outLines.push('@@FIG:' + i + '@@')
  return outLines.join('\n')
}

