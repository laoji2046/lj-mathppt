/**
 * 按内容识别页面角色 —— 为「按内容套用模板」服务 ✓。
 *
 * ⚠ 设计原则：**只认有明确证据的** ✗。
 *   命中关键词（定理/定义/例/练习/小结/思考…）才给角色 ✓；
 *   认不出就返回 null ✓ —— 调用方**保留原样** ✓（用户明确要求：能识别套用、不能识别保留 ✓）。
 *   宁可少认 ✓，不要认错 ✗（认错会毁掉一页的排版 ✓）。
 *
 * 识别是**纯本地**的：只看元素文字 ✓，不联网、不改内容 ✓。
 */
import type { Slide, SlideElement } from '@/types'

export type Role = 'cover' | 'theorem' | 'definition' | 'example' | 'practice' | 'summary' | 'think' | 'explore'

export interface Detected {
  role: Role
  /** 证据词（写进报告 ✓ 便于人工核对 ✓） */
  evidence: string
  /** 标题：字号最大、且靠上的那块文字 ✓ */
  title: string
  /** 其余段落，按 (上→下, 左→右) 排序 ✓ */
  body: string[]
}

/** 关键词 → 角色（顺序即优先级 ✓：越具体的越前 ✓） */
const RULES: { role: Role; re: RegExp; label: string }[] = [
  { role: 'theorem', re: /定理|性质定理|判定定理/, label: '定理' },
  { role: 'definition', re: /定义|概念/, label: '定义' },
  { role: 'example', re: /典例|例题|例\s*\d|例[一二三四五六七八九十]/, label: '例题' },
  { role: 'practice', re: /巩固练习|课堂练习|练一练|随堂|作业/, label: '练习' },
  { role: 'summary', re: /归纳小结|课堂小结|小结|总结/, label: '小结' },
  // ⚠ 「探究」与「思考」用户要求**分开** ✓（2026-09-15）：样张 P5 是探究 ✓、而不是思考 ✓
  { role: 'explore', re: /探究|发现|试一试/, label: '探究' },
  { role: 'think', re: /思考|想一想/, label: '思考' },
]

/** 取元素的纯文字（表格取格子 ✓，公式保留 marker ✓） */
function textOf(el: SlideElement): string {
  const e = el as any
  if (el.type === 'table' && Array.isArray(e.rows)) return e.rows.flat().join(' ')
  return String(e.text || '')
}

/** 是不是"正文类"元素（有文字、可当标题/段落 ✓） */
function isTextual(el: SlideElement): boolean {
  return el.type === 'text' || el.type === 'richtex' || el.type === 'table'
}

/**
 * 识别一页 ✓。返回 null = **认不出** ✓（调用方保留原样 ✓）。
 * @param index 页序号（0 起 ✓）—— 第 1 页按封面处理 ✓
 */
export interface DetectOpts {
  /** 用户点名"先不管"的页号（**1 起** ✓，与界面上看到的页码一致 ✓） */
  skip?: number[]
}
export function detectRole(slide: Slide, index = -1, opts: DetectOpts = {}): Detected | null {
  if (opts.skip && opts.skip.includes(index + 1)) return null   // 用户点名跳过 ✓
  const textEls = (slide.elements || []).filter((e) => isTextual(e) && textOf(e).trim())
  if (!textEls.length) return null

  // ⚠ 保险一：这一页若含**版式装不下的东西**（表格/图片/图形/嵌入… ✓），一律不套 ✓。
  //   实测样张 P7 是"归纳小结 + 一张表格" ✓，只按关键词会认成小结 ✗ → 套用版式会把表格丢掉 ✗✗。
  //   宁可少套 ✓，不能丢内容 ✓（用户口径：能识别套用、不能识别保留 ✓）。
  const unsupported = (slide.elements || []).some((e) =>
    e.type === 'table' || e.type === 'image' || e.type === 'chart' || e.type === 'embed' ||
    e.type === 'mathfig' || e.type === 'geogebra' || e.type === 'desmos' || e.type === 'icon')
  if (unsupported) return null
  // ⚠ shape / line / arrow / pen **不算**拦路 ✓ —— 它们是装饰 ✓（分隔线、色块 ✓），
  //   版式函数本来就会自带装饰 ✓，重排时丢掉不影响内容 ✓。
  //   （一开始我把 shape 也列进去 ✓，结果样张 **0/18** 全被拦 ✗ —— 因为刚导入的分隔线到处都是 ✓。）
  const all = textEls.map((e) => textOf(e)).join('\n')

  // 封面：第一页，且文字不多（多则可能是内容页 ✓）
  if (index === 0 && textEls.length <= 6) {
    return null   // 封面暂不自动套（用户没点名 ✓；留后再说 ✓）—— 返回 null 即保留 ✓
  }

  let hit: { role: Role; label: string; word: string } | null = null
  for (const r of RULES) {
    const m = all.match(r.re)
    if (m) { hit = { role: r.role, label: r.label, word: m[0] }; break }
  }
  if (!hit) return null

  // 标题：字号最大的那块（同大小时取更靠上的 ✓）；明显小于第二大则仍取最大 ✓
  // ⚠ 保险二：标题不能只看"字号最大" ✗ —— 实测 P9 会把「①」当标题 ✓、P13/P14 会把「结论1」当标题 ✓。
  //   规则：字号大 ✓ + 文字**够长**（≥4 字 ✓，排除编号/符号 ✓）+ 更靠上 ✓。
  const looksLikeTitle = (s: string) => {
    const p = String(s).replace(/[\s\d①-⑳一二三四五六七八九十.、,:：;；"'"'()（）[\]【】]/g, '')
    return p.length >= 3
  }
  const sorted = [...textEls].sort((a, b) => {
    const fa = Number((a as any).fontSize) || 0
    const fb = Number((b as any).fontSize) || 0
    if (fb !== fa) return fb - fa
    return (a.y || 0) - (b.y || 0)
  })
  const titleEl = sorted.find((e) => looksLikeTitle(textOf(e))) || sorted[0]
  const title = textOf(titleEl).split('\n')[0].trim()

  // 其余按位置排序 ✓
  const body = textEls
    .filter((e) => e !== titleEl)
    .sort((a, b) => ((a.y || 0) - (b.y || 0)) || ((a.x || 0) - (b.x || 0)))
    .map((e) => textOf(e).trim())
    .filter((s) => s.length > 0)

  return { role: hit.role, evidence: hit.label + '：' + hit.word, title, body }
}
/**
 * 按识别结果**套用版式**（第二步 ✓）。
 *
 * ⚠ 三条铁律：
 *   1. **必须传 canvas** ✗ —— 版式函数默认按 1920×1080 排版 ✓，而 PPT 导入的文稿是 1280×720 ✓；
 *      不传就会整体 1.5 倍错位 ✓（这条是实测文档里写着的 ✓）。
 *   2. 只动**识别成功**的页 ✓；detectRole 返回 null 的页**原样保留** ✓（用户明确口径 ✓）。
 *   3. 页面背景/备注等**页级属性不动** ✓，只换 elements ✓。
 */
import type { Deck } from '@/types'
import { getTheme, type Theme } from './pptTheme'
import { definition, practice, steps, summary, theorem, think } from './pptLayouts'

/** 每个角色配一句页眉 ✓（写进版式的 eyebrow 槽位 ✓） */
const EYEBROW: Record<Role, string> = {
  cover: '封面',
  theorem: '定理',
  definition: '概念 · 定义',
  example: '例题 · 解析',
  practice: '练习 · 巩固',
  summary: '小结 · 归纳',
  think: '思考',
  explore: '探究 · 发现',
}

/** 用识别结果重建这一页的元素 ✓（失败则返回 null = 保留原样 ✓） */
function buildForRole(role: Role, d: Detected, t: Theme, canvas: { width: number; height: number }): SlideElement[] | null {
  const eyebrow = EYEBROW[role]
  const title = d.title || ''
  const body = d.body.length ? d.body : ['']
  switch (role) {
    case 'definition':
      return definition(t, { canvas, eyebrow, title, term: title, body })
    case 'theorem':
      return theorem(t, { canvas, eyebrow, title, name: title, statement: body })
    case 'example':
      return steps(t, { canvas, eyebrow, title, steps: body })
    case 'practice':
      return practice(t, { canvas, eyebrow, title: title || '巩固练习', items: body })
    case 'summary':
      return summary(t, { canvas, eyebrow, title: title || '课堂小结', points: body })
    case 'think':
    case 'explore':
      return think(t, { canvas, eyebrow, title, question: body })
    default:
      return null
  }
}

export interface AutoApplyReport { index: number; role: Role | null; evidence: string; title: string; changed: boolean }
export interface AutoApplyResult { applied: number; kept: number; report: AutoApplyReport[] }

/**
 * 对整份文稿按内容套用版式 ✓。
 * @param opts.skip 用户点名"先不管"的页号（**1 起** ✓）
 */
export function autoTemplateDeck(deck: Deck, themeId?: string, opts: DetectOpts = {}): AutoApplyResult {
  const base = getTheme(themeId || deck.theme || 'edumath')
  const canvas = { width: deck.width || 1920, height: deck.height || 1080 }
  // ⚠ 关键：主题 TypeScale（54/36/28…）是按 1920 宽定的绝对值 ✗ ——
  //   只传 canvas 只解决「坐标」 ✓；字号不缩的话正文块会算成 1014px 高（画布才 720）✗✗，整页溢出。
  //   所以按比例深拷贝出一份缩小的主题 ✓（不污染 getTheme 的单例 ✗）。
  const k = canvas.width / 1920
  const t: Theme = Math.abs(k - 1) < 0.01 ? base : JSON.parse(JSON.stringify(base))
  if (Math.abs(k - 1) >= 0.01) {
    for (const key of Object.keys(t.type)) (t.type as any)[key] = Math.max(8, Math.round((base.type as any)[key] * k))
    t.grid.margin = Math.round(base.grid.margin * k)
    t.grid.gutter = Math.round(base.grid.gutter * k)
    t.radius = Math.max(2, Math.round(base.radius * k))
  }
  const report: AutoApplyReport[] = []
  let applied = 0
  let kept = 0
  deck.slides.forEach((s: Slide, i: number) => {
    const d = detectRole(s, i, opts)
    if (!d) {
      kept++
      report.push({ index: i + 1, role: null, evidence: '—', title: '', changed: false })
      return
    }
    const built = buildForRole(d.role, d, t, canvas)
    if (!built) {
      kept++
      report.push({ index: i + 1, role: null, evidence: d.evidence, title: d.title, changed: false })
      return
    }
    s.elements = (built as unknown as SlideElement[][]).flat(2) as SlideElement[]
    applied++
    report.push({ index: i + 1, role: d.role, evidence: d.evidence, title: d.title, changed: true })
  })
  return { applied, kept, report }
}