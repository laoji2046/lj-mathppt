/**
 * 【v1669】让 AI 用上应用自己的功能（用户要求：把 AI 和应用集成）
 *
 * 怎么工作：模型看到的是**工具清单**（JSON Schema ✓），它想调哪个就回 \`tool_calls\`；
 * 面板执行完把结果当 \`role:"tool"\` 的消息还给它，它再决定继续说还是继续调（见 AiSidePanel 的 askWithTools ✓）。
 *
 * 为什么执行器放在这个模块、而不是直接写进面板：
 *  1. 面板已经很大了 ✗；
 *  2. 这里**不 import Pinia / Vue**，只吃一个 \`AiToolCtx\`（应用能力的小适配器 ✓）——
 *     于是探针能拿**假 ctx** 直接跑一遍所有工具，断言"参数校验对不对、到底改了什么" ✓
 *     （上一轮"探针照抄逻辑"的教训：要让探针跑真代码 ✓）。
 *
 * 安全口径（用户选了 C「能改现有元素」，所以更要把闸门做在参数上 ✓）：
 *  · 改元素只认**白名单字段**（x/y/w/h/字号/颜色/文字…）✓，\`id\`/\`type\` 一律丢掉 ✗；
 *  · 认不出来的工具名 / kind / 缺必填参数 → 返回 ok:false + 人话原因（模型会自己改 ✓），不静默乱来 ✗；
 *  · 每次写操作都走 store 自己的 API（含 pushHistory ✓），老师随时 Ctrl+Z 兜得住 ✓。
 */
import { createElement } from '@/types'
import type { SlideElement } from '@/types'
import { CONICS, withParams } from '@/composables/mathPlot'

/** 面板传进来的「应用能力」适配器（探针里可以用假的 ✓） */
export interface AiToolCtx {
  deck: { width?: number; height?: number; title?: string; slides: { id: string; elements: SlideElement[] }[] }
  currentIndex: number
  addElements(items: { type: string; overrides?: Partial<SlideElement> }[]): unknown
  addSlide(): void
  gotoSlide(index: number): void
  updateElement(id: string, patch: Partial<SlideElement>): void
  removeElement(id: string): void
  undo(): void
  /** 题库（可缺：探针/没装库时不影响别的工具 ✓） */
  bank?: {
    search(query: string, limit: number): Promise<{ id: number; label: string }[]>
    textOf(id: number, withAnswer: boolean): Promise<string | null>
  }
}

export interface AiToolResult { ok: boolean; result?: unknown; error?: string }

/** 允许 AI 改的字段白名单（其余一律忽略 ✗ —— id/type 改了就乱套 ✓） */
export const EDITABLE_FIELDS = [
  'x', 'y', 'w', 'h', 'rot', 'opacity',
  'fontSize', 'fontWeight', 'fontFamily', 'color', 'bgColor', 'align', 'text',
  'stroke', 'strokeWidth', 'fill',
] as const

/** 数学图形的合法 kind（从应用自己的 CONICS 里取，别手抄一份 ✗） */
export function figureKinds(): string[] {
  try { return Object.keys(CONICS || {}) } catch { return [] }
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && isFinite(n) ? n : undefined
}
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** 工具清单（给模型的 JSON Schema ✓；描述用中文，模型看得懂 ✓） */
export const AI_TOOLS: unknown[] = [
  {
    type: 'function',
    function: {
      name: 'get_deck_state',
      description: '读当前课件：共几页、现在在第几页、页面尺寸，以及某一页上的元素（类型/位置/文字开头）。想让 AI 先看懂课件再动手时用它。',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'integer', description: '页码，从 1 开始；不给就是当前页' },
          all_pages: { type: 'boolean', description: 'true = 每页只给一句摘要（页数多时用）' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_slide',
      description: '在当前页后面新增一页幻灯片；给了标题就在新页上写一行标题文字。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '新页标题（可省）' },
          fontSize: { type: 'integer', description: '标题字号，默认 40' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'goto_slide',
      description: '切换到第 N 页（从 1 开始）。',
      parameters: { type: 'object', properties: { page: { type: 'integer' } }, required: ['page'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'insert_math_figure',
      description: '在当前页插入一个**可编辑的数学图形**（圆锥曲线/函数图等）。比画图片好：老师可以接着拖手柄、改参数。',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: '图形种类，例如 ' + figureKinds().slice(0, 6).join(' / ') },
          params: { type: 'object', description: '图形参数（如 a、b、p、dir、cx、cy 等）；不认识的 kind 会失败并给出可选清单' },
          x: { type: 'number' }, y: { type: 'number' },
          w: { type: 'number', description: '宽，默认 640' }, h: { type: 'number', description: '高，默认 420' },
        },
        required: ['kind'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'insert_text',
      description: '在当前页插入一段文字（走应用的混排元素，$...$ 里的公式会按应用口径渲染）。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string' }, fontSize: { type: 'integer', description: '默认 28' },
          x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number', description: '默认 1100' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_bank',
      description: '在老师的题库里搜题（按关键词/知识点）。返回候选的 id、编号与题干开头；拿到 id 后用 insert_bank_question 插入。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '关键词（知识点、题干片段、试卷名等）' },
          limit: { type: 'integer', description: '最多几条，默认 8' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'insert_bank_question',
      description: '把题库里的一道题（先 search_bank 拿到 id）插到当前页：题干+选项+答案做成混排元素。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'search_bank 返回的 id' },
          with_answer: { type: 'boolean', description: '是否连答案解析一起插，默认 true' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_elements',
      description: '改当前页上已有元素（用 get_deck_state 拿 id）：移动、改大小、改字号/颜色/文字等。只认白名单字段。',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' }, description: '元素 id 列表' },
          patch: { type: 'object', description: '要改的字段，例如 {"x":200,"fontSize":36,"color":"#c0392b"}' },
        },
        required: ['ids', 'patch'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_elements',
      description: '删除当前页上的元素（用 get_deck_state 拿 id）。删错了老师可以用撤销恢复。',
      parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'undo',
      description: '撤销上一步操作（万一改坏了，老师说一声就能回退）。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
]

/** 给 system 提示词追加的说明（告诉模型怎么用这些功能 ✓） */
export function aiToolGuide(): string {
  return [
    '【能用应用的功能】你可以调用工具**直接操作这个幻灯片应用**，不要只说"你可以插入…"。',
    '常用流程：先 get_deck_state 看当前页有什么 → 再 insert_math_figure / insert_text / add_slide 动手；',
    '要引用老师题库里的题：先 search_bank 拿 id，再 insert_bank_question。',
    '改已有元素前也先 get_deck_state 拿 id；改完/插完用一句中文说明你做了什么，别把工具的 JSON 原样倒给老师。',
    '数学图形一律用 insert_math_figure（kind + params），不要用 TikZ 画图、也不要只给 LaTeX 让老师自己画。',
  ].join('\n')
}

/** 插图形：认不出的 kind / 参数报错要能让人看懂 ✓ */
function buildFigure(args: Record<string, unknown>): AiToolResult {
  const kind = str(args.kind).trim()
  const kinds = figureKinds()
  if (!kind) return { ok: false, error: '缺 kind' }
  if (kinds.length && kinds.indexOf(kind) < 0) {
    return { ok: false, error: '不认识的图形种类 ' + kind + '；可选：' + kinds.join('、') }
  }
  let params: unknown = (args.params && typeof args.params === 'object') ? args.params : {}
  try { params = withParams(kind as never, params as never) } catch { /* 参数补齐失败就原样用 ✓ */ }
  const el = createElement('mathfig', {
    x: num(args.x) ?? 120, y: num(args.y) ?? 120,
    w: num(args.w) ?? 640, h: num(args.h) ?? 420,
  })
  Object.assign(el, { kind, params })
  return { ok: true, result: el }
}

function buildText(args: Record<string, unknown>): AiToolResult {
  const text = str(args.text)
  if (!text.trim()) return { ok: false, error: '缺 text' }
  const el = createElement('richtex', {
    x: num(args.x) ?? 120, y: num(args.y) ?? 120,
    w: num(args.w) ?? 1100, h: num(args.h) ?? 200,
  })
  Object.assign(el, { text, fontSize: num(args.fontSize) ?? 28, align: 'left', color: '#1a1a1a' })
  return { ok: true, result: el }
}

/** 白名单过滤：只留允许改的字段，顺便把数字型字段转成数字 ✓ */
export function sanitizePatch(raw: unknown): Partial<SlideElement> {
  const out: Record<string, unknown> = {}
  if (!raw || typeof raw !== 'object') return out as Partial<SlideElement>
  for (const k of EDITABLE_FIELDS) {
    if (!(k in (raw as Record<string, unknown>))) continue
    const v = (raw as Record<string, unknown>)[k]
    if (k === 'text' || k === 'color' || k === 'bgColor' || k === 'align' || k === 'fontFamily' || k === 'stroke' || k === 'fill') {
      if (typeof v === 'string') out[k] = v
      continue
    }
    const n = num(v)
    if (n !== undefined) out[k] = n
  }
  return out as Partial<SlideElement>
}

function pageOf(deck: AiToolCtx['deck'], idx: number) {
  const slides = (deck && deck.slides) || []
  return slides[idx]
}

function elementBrief(e: SlideElement, i: number): Record<string, unknown> {
  const anyE = e as unknown as Record<string, unknown>
  const brief: Record<string, unknown> = {
    n: i + 1, id: String(anyE.id || ''), type: String(anyE.type || ''),
    x: num(anyE.x), y: num(anyE.y), w: num(anyE.w), h: num(anyE.h),
  }
  const t = str(anyE.text)
  if (t) brief.text = t.length > 40 ? t.slice(0, 40) + '…' : t
  if (anyE.kind) brief.kind = String(anyE.kind)
  return brief
}

/** 执行一个工具调用 ✓ */
export async function runAiTool(name: string, args: Record<string, unknown>, ctx: AiToolCtx): Promise<AiToolResult> {
  const a = args && typeof args === 'object' ? args : {}
  try {
    switch (name) {
      case 'get_deck_state': {
        const slides = ctx.deck.slides || []
        const idx = num(a.page) ? Math.max(0, Math.min(slides.length - 1, (num(a.page) as number) - 1)) : ctx.currentIndex
        const cur = pageOf(ctx.deck, idx)
        const out: Record<string, unknown> = {
          pages: slides.length, current: idx + 1,
          pageW: num(ctx.deck.width) ?? 1920, pageH: num(ctx.deck.height) ?? 1080,
          title: str(ctx.deck.title),
        }
        if (a.all_pages) {
          out.pageSummary = slides.map((s, i) => ({
            page: i + 1, elements: (s.elements || []).length,
            firstText: (s.elements || []).map((e) => str((e as unknown as Record<string, unknown>).text)).filter(Boolean)[0]?.slice(0, 30) || '',
          }))
        } else {
          out.elements = (cur?.elements || []).map(elementBrief)
        }
        return { ok: true, result: out }
      }
      case 'add_slide': {
        ctx.addSlide()
        const title = str(a.title)
        if (title.trim()) {
          const el = createElement('richtex', { x: 120, y: 90, w: 1100, h: 120 })
          Object.assign(el, { text: title, fontSize: num(a.fontSize) ?? 40, align: 'left', color: '#1a1a1a' })
          ctx.addElements([{ type: 'richtex', overrides: el }])
        }
        return { ok: true, result: { 新页: (ctx.currentIndex ?? 0) + 1, 标题: title || null } }
      }
      case 'goto_slide': {
        const p = num(a.page)
        const slides = ctx.deck.slides || []
        if (!p || p < 1 || p > slides.length) return { ok: false, error: '页码要在 1~' + slides.length + ' 之间' }
        ctx.gotoSlide(Math.round(p) - 1)
        return { ok: true, result: { 已切到: Math.round(p) } }
      }
      case 'insert_math_figure': {
        const r = buildFigure(a)
        if (!r.ok) return r
        ctx.addElements([{ type: 'mathfig', overrides: r.result as Partial<SlideElement> }])
        const el = r.result as Record<string, unknown>
        return { ok: true, result: { 已插入图形: String(el.kind), 位置: { x: el.x, y: el.y }, 尺寸: { w: el.w, h: el.h } } }
      }
      case 'insert_text': {
        const r = buildText(a)
        if (!r.ok) return r
        ctx.addElements([{ type: 'richtex', overrides: r.result as Partial<SlideElement> }])
        return { ok: true, result: { 已插入文字: str(a.text).slice(0, 40) } }
      }
      case 'search_bank': {
        if (!ctx.bank) return { ok: false, error: '这个环境没有连题库' }
        const q = str(a.query).trim()
        if (!q) return { ok: false, error: '缺 query' }
        const limit = Math.max(1, Math.min(20, num(a.limit) ?? 8))
        const items = await ctx.bank.search(q, limit)
        return { ok: true, result: { 命中: items.length, 题目: items } }
      }
      case 'insert_bank_question': {
        if (!ctx.bank) return { ok: false, error: '这个环境没有连题库' }
        const id = num(a.id)
        if (!id) return { ok: false, error: '缺 id（先用 search_bank 搜一次）' }
        const withAnswer = a.with_answer === undefined ? true : !!a.with_answer
        const text = await ctx.bank.textOf(Math.round(id), withAnswer)
        if (!text) return { ok: false, error: '题库里找不到 id=' + Math.round(id) + ' 这道题（先 search_bank 拿 id）' }
        const el = createElement('richtex', { x: 60, y: 120, w: 1160, h: Math.max(120, Math.min(680, text.split('\n').length * 34 + 40)) })
        Object.assign(el, { text, fontSize: 24, align: 'left', color: '#1a1a1a', autoBox: true })
        ctx.addElements([{ type: 'richtex', overrides: el }])
        return { ok: true, result: { 已插入题: Math.round(id), 带答案: withAnswer, 字数: text.length } }
      }
      case 'update_elements': {
        const ids = Array.isArray(a.ids) ? a.ids.map((x) => str(x)).filter(Boolean) : []
        if (!ids.length) return { ok: false, error: '缺 ids（先用 get_deck_state 拿）' }
        const patch = sanitizePatch(a.patch)
        if (!Object.keys(patch).length) return { ok: false, error: 'patch 里没有可改的字段（只认：' + EDITABLE_FIELDS.join('、') + '）' }
        for (const id of ids) ctx.updateElement(id, patch)
        return { ok: true, result: { 改了: ids.length + ' 个元素', 字段: Object.keys(patch) } }
      }
      case 'delete_elements': {
        const ids = Array.isArray(a.ids) ? a.ids.map((x) => str(x)).filter(Boolean) : []
        if (!ids.length) return { ok: false, error: '缺 ids' }
        for (const id of ids) ctx.removeElement(id)
        return { ok: true, result: { 删了: ids.length + ' 个元素（可以撤销）' } }
      }
      case 'undo': {
        ctx.undo()
        return { ok: true, result: { 已撤销一步: true } }
      }
      default:
        return { ok: false, error: '没有这个功能：' + name }
    }
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) }
  }
}
