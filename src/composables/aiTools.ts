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
import { MATH_FIGURE_OPTIONS, createElement } from '@/types'
import type { SlideElement } from '@/types'
import { CONICS, withParams } from '@/composables/mathPlot'
import { PAPER_HELP } from '@/composables/aiPaperChat'
import { HANDOUT_HELP, handoutMetaPatch } from '@/composables/aiHandoutChat'
import { guessAction, guessCourse, guessKind, guessRender, guessVersion, handoutBlockSpecsLoose } from '@/composables/aiHandoutTrain'

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
  /** 改/删之前先存一份撤销快照（store.updateElement/removeElement 自己**不存** ✗ —— 上一版说错了 ✓） */
  pushHistory?(): void
  /** 【v1691】试卷编辑：读 / 追加 / 插题（试卷没开时由 App 自动打开 ✓；不传也能跑 ✓） */
  paper?: {
    state: (maxChars: number) => { open: boolean; text: string }
    append: (text: string, pageBreak: boolean) => string
    insertQuestion: (id: number, withAnswer: boolean) => Promise<string>
    /** 【v1699】试卷大纲 + 按题号改 / 插（用户："它有点儿笨" → 让它按题号办事 ✓） */
    outline?: () => string
    replaceQuestion?: (no: number, text: string) => string
    insertQuestionAt?: (afterNo: number, text: string) => string
    /** 【v1694】就地改正文（字面替换 ✓） */
    edit?: (find: string, replace: string, all?: boolean) => string
    /** 【v1693】试卷编辑的**其余能力**（改设置 / 套模板 / 页眉预设 / 插数学图形 / 打印 ✓） */
    style?: () => Record<string, unknown>
    setStyle?: (patch: Record<string, unknown>) => string
    template?: (key: string) => string
    headerPreset?: (id: string) => string
    figure?: (kind: string, params: Record<string, unknown>) => Promise<string>
    print?: () => string
}
  /** 【v1707】讲义编辑：读 / 加块 / 改块 / 教材定位 / 版本口径 / 插图 / 题库 / 同步 / 打印 / 导出 / 保存 ✓
   *  （讲义没开时是 null → 每个工具都会说清"讲义没开着" ✗ 而不是静默失败 ✓） */
  handout?: {
    state: (maxChars: number) => Record<string, unknown>
    outline: () => string
    addBlocks: (specs: { type: string; text?: string; render?: { student?: string; teacher?: string }; blankCm?: number }[], where: string, afterNo: number) => string
    edit: (find: string, replace: string, all: boolean) => string
    block: (no: number, action: string) => string
    setRender: (no: number, render: string, version: string) => string
    meta: () => Record<string, unknown>
    setMeta: (patch: Record<string, unknown>) => string
    version: (v: string) => string
    insertQuestion: (q: unknown, kind: string, withAnswer: boolean) => string
    draw: (filter: Record<string, unknown>, n: number, pool: string) => Promise<string>
    figure: (kind: string, params: Record<string, unknown>, caption: string) => Promise<string>
    syncRefs: () => Promise<string>
    print: () => string
    exportText: () => string
    save: () => Promise<string>
    importMarkdown: (markdown: string, where: string, afterNo: number) => string
    skeleton: (kind: string, mode: string) => string
  }
  /** 题库（可缺：探针/没装库时不影响别的工具 ✓） */
  bank?: {
    search(query: string, limit: number): Promise<{ id: number; label: string }[]>
    textOf(id: number, withAnswer: boolean): Promise<string | null>
    /** 【v1691】这道题带的图（插到试卷时要一起带过去 ✓） */
    imgsOf?: (id: number) => Promise<{ n: number; src: string; caption?: string }[]>
  }
}

export interface AiToolResult { ok: boolean; result?: unknown; error?: string }

/** 允许 AI 改的字段白名单（其余一律忽略 ✗ —— id/type 改了就乱套 ✓） */
/** 允许 AI 改的字段白名单（其余一律忽略 ✗ —— id/type 改了就乱套 ✓）
 *  ⚠ 数学图形的**线条颜色**不叫 stroke ✗：它自己的字段是 conicStroke / axisColor / lineColors / pointColors ✓
 *    （用户实报「图形线条颜色不能通过对话改变」就是这么来的 ✓ —— 白名单里没有这几个字段 ✗） */
export const EDITABLE_FIELDS = [
  'x', 'y', 'w', 'h', 'rot', 'opacity',
  'fontSize', 'fontWeight', 'fontFamily', 'color', 'bgColor', 'align', 'text',
  'stroke', 'strokeWidth', 'fill',
  'conicStroke', 'axisColor', 'lineColors', 'pointColors', 'pointLabels',
] as const

/** 模型经常换名字（font_size / lineColor…）→ 常见别名一律翻译成应用真正的字段 ✓ */
export const FIELD_ALIASES: Record<string, string> = {
  font_size: 'fontSize', fontsize: 'fontSize', size: 'fontSize', textSize: 'fontSize', text_size: 'fontSize',
  fontSizePx: 'fontSize', font_size_px: 'fontSize',
  textColor: 'color', fontColor: 'color', font_color: 'color',
  lineColor: 'conicStroke', line_color: 'conicStroke', strokeColor: 'conicStroke', figureColor: 'conicStroke',
  curveColor: 'conicStroke', conic_color: 'conicStroke',
  axisLineColor: 'axisColor', axis_line_color: 'axisColor', axis_color: 'axisColor',
  line_colors: 'lineColors', point_colors: 'pointColors', pointLabel: 'pointLabels', point_labels: 'pointLabels',
  lineWidth: 'strokeWidth', line_width: 'strokeWidth', stroke_width: 'strokeWidth',
}


/**
 * 【v1696】图形库的**完整** kind 清单（74 种 ✓）
 *
 * ⚠ 以前这里用的是 figureKinds() —— 它只取 CONICS（**19 种圆锥曲线** ✗），
 *   于是 insert_math_figure / insert_paper_figure 会把 parabola、sine、cube 这些**合法**种类拒掉 ✗
 *   （用户实报「5题后插入数学图形 抛物线」连着四次失败 ✗；探针用例 35 也把这个错抓出来了 ✓）。
 *   真正的图形库在 types.MATH_FIGURE_OPTIONS（带中文名 ✓），一律以它为准 ✓。
 */
export function mathFigureKindList(): string[] {
  try {
    return (MATH_FIGURE_OPTIONS || [])
      .map((o) => String((o as { v?: unknown }).v || ''))
      .filter(Boolean)
  } catch { return [] }
}

/** kind → 中文名（给模型的清单带上名字更好认 ✓） */
export function mathFigureLabel(kind: string): string {
  try {
    const hit = (MATH_FIGURE_OPTIONS || []).find((o) => String((o as { v?: unknown }).v || '') === kind)
    return hit ? String((hit as { label?: unknown }).label || '') : ''
  } catch { return '' }
}

/** 拼一段「可选种类」提示（带中文名 ✓；太长就截断，别把上下文塞满 ✗） */
export function figureKindHint(limit = 20): string {
  const list = mathFigureKindList()
  if (!list.length) return ''
  const parts = list.slice(0, limit).map((k) => {
    const lab = mathFigureLabel(k)
    return lab ? k + ' ' + lab : k
  })
  return '可选（共 ' + list.length + ' 种' + (list.length > limit ? '，前 ' + limit + ' 个' : '') + '）：' + parts.join('、')
}

/** 常见图形速查（模型最爱问的那几个 ✓） */
export const FIGURE_COMMON = '常用：parabola 抛物线、ellipse 椭圆、hyperbola 双曲线、sine 正弦曲线、linear 一次函数、cube 正方体 ✓'/** 旧的窄口径（只 19 种圆锥曲线 ✗）—— 留着给别处兼容用，**校验不要再用它** ✗ */
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
      name: 'get_paper_outline',
      description: '取**试卷大纲**：每个大节下有哪些题号、每题在第几行、题干开头是什么 ✓。'
        + '老师说「第 5 题…」时**先调它**（别通读原文、更别自己数题号 ✗），拿到题号再用 replace_paper_question / insert_paper_question 办事 ✓',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replace_paper_question',
      description: '**按题号**把一道题整块换掉（推荐 ✗ 不要用 edit_paper_text 去猜原文 ✓）。'
        + 'text 给完整的新题（含题号、选项、[题] 块等都行 ✓），题号由试卷自动重排 ✓；找不到该题号会**一个字都不改**并回报现有题号 ✓',
      parameters: {
        type: 'object',
        properties: {
          no: { type: 'integer', description: '题号（卷面上写的那个 ✓，先用 get_paper_outline 确认 ✓）' },
          text: { type: 'string', description: '新的整道题（可多行 ✓）' },
        },
        required: ['no', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'insert_paper_question',
      description: '**按题号**在它后面插一道新题（老师说「第 5 题后加一道」就用它 ✓）。新题给完整块 ✓，题号由试卷自动重排 ✓',
      parameters: {
        type: 'object',
        properties: {
          after_no: { type: 'integer', description: '插在这一题之后（题号 ✓）' },
          text: { type: 'string', description: '新的整道题（可多行 ✓）' },
        },
        required: ['after_no', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_paper_text',
      description: '**改试卷里已有的文字**（字面替换 ✓，find 可以是多行原文）。老师说「把…改成…」「…变成蓝色」「删掉…」'
        + '时**必须**用它 ✓ —— 不要用 append_to_paper 复制一份改造过的内容 ✗（那会把卷子变成两份，用户实测报过 ✗）。'
        + '改之前先 get_paper_state 拿准确原文 ✓；给现有段落上样式就在那段行首加 {c:blue} / {b} / {s:14} ✓',
      parameters: {
        type: 'object',
        properties: {
          find: { type: 'string', description: '要替换掉的原文（照抄 get_paper_state 里的写法，可多行 ✓）' },
          replace: { type: 'string', description: '换成什么（留空 = 删掉这段 ✓）' },
          all: { type: 'boolean', description: 'true = 替换所有出现的地方；默认只改第一处 ✓' },
        },
        required: ['find', 'replace'],
      },
    },
  },
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
          kind: { type: 'string', description: '图形种类，例如 ' + mathFigureKindList().slice(0, 8).join(' / ') + ' …（共 ' + mathFigureKindList().length + ' 种 ✓）' },
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
      name: 'set_figure_style',
      description: '改数学图形/线条的**颜色**（不用记字段名）：曲线颜色、坐标轴颜色、逐条线颜色、各个点颜色、线宽。',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' }, description: '要改的图形元素 id（get_deck_state 里拿）' },
          curveColor: { type: 'string', description: '曲线/图形线条颜色，如 #c0392b' },
          axisColor: { type: 'string', description: '坐标轴颜色' },
          lineColors: { type: 'array', items: { type: 'string' }, description: '逐条直线的颜色（按第 1、2…条的次序）' },
          pointColors: { type: 'array', items: { type: 'string' }, description: '各个点的颜色（按点 1、2…的次序）' },
          lineWidth: { type: 'number', description: '线宽，如 3' },
        },
        required: ['ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_elements',
      description: '改当前页上已有元素（先用 get_deck_state 拿 id）。可用字段：' +
        'x/y/w/h（位置大小）、fontSize（**字号**，如 36）、color（文字颜色）、align、text（改文字）、' +
        'bgColor、opacity、rot；数学图形的线条颜色用 conicStroke（曲线）、axisColor（坐标轴）、' +
        'lineColors（逐条线的颜色数组）、pointColors（各个点的颜色数组）。',
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
  {
    type: 'function',
    function: {
      name: 'get_paper_state',
      description: '读「试卷编辑」里的正文（A4 试卷的文字）。要改试卷前先调它 ✓；试卷没开时 opened 是 false ✓',
      parameters: {
        type: 'object',
        properties: { max_chars: { type: 'integer', description: '最多回多少字，默认 3000' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'append_to_paper',
      description: '把一段文字**追加到「试卷编辑」正文末尾**（试卷没开会自动打开）。⚠ 只用于**新增**（加一节 / 加一道题 ✓）—— 改已有内容请用 edit_paper_text ✗ 不要复制一份 ✗。写题请按试卷的排版约定：'
        + '## 一、选择题 分大题、1. 题号（试卷会按 autoNum 重新编号 ✓）、[题]…[选项]…[解析]…[/题] 整块、$公式$、[图N] 插图、[分页] 手动分页 ✓',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要追加的正文（Markdown 风格 ✓）' },
          page_break: { type: 'boolean', description: 'true = 先分页再追加（新的一套卷子各自起一页 ✓）' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'insert_bank_question_to_paper',
      description: '把题库里的题插进「试卷编辑」末尾，按试卷的**题目块**排版（解析默认收起、不会被分页拆开 ✓）。先 search_bank 拿 id ✓',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'search_bank 返回的 id' },
          with_answer: { type: 'boolean', description: '是否带答案解析，默认 false（考卷通常不带 ✓）' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_paper_help',
      description: '取「试卷编辑」的**语法手册**（标题/题号/[题]块/图片/[分页]/段落样式/可改设置项 …）。要写试卷正文前不确定语法就查它 ✓',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_paper_style',
      description: '读试卷当前的**样式与页面设置**（字体/字号/行高/段距/题号样式/选项排布/分栏/页眉页脚/导出文件名…）✓ 改设置前先读一次 ✓',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_paper_style',
      description: '改试卷的样式与页面设置（只改传进来的键 ✓）。可用键：fontFamily 字体、fontSize 字号(pt)、fontColor 字色、'
        + 'lineHeight 行高、para 段距、indent 首行缩进、h2size 小标题字号、numStyle 题号(arabic/cn)、'
        + 'optLayout 选项排布(auto/one/two/four)、autoNum 自动编号(true/false)、bodyCols 正文分栏(1~3)、'
        + 'gapQ 题间距、headerGap 页眉距、footerGap 页脚距 ✓',
      parameters: {
        type: 'object',
        properties: {
          patch: {
            type: 'object',
            description: '要改的键值，例如 {"fontSize":12,"numStyle":"cn","optLayout":"two"}',
          },
        },
        required: ['patch'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_paper_template',
      description: '给试卷套模板（会**替换正文** ✗）：handout 讲义 / exam 试卷 / exam19 十九题卷 / blank 空白 ✓',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string', description: 'handout | exam | exam19 | blank' } },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_paper_header',
      description: '设页眉页脚与导出文件名（页眉页脚**不进正文** ✓，支持 [图N] 与 {page} {total} 变量）✓',
      parameters: {
        type: 'object',
        properties: {
          header: { type: 'string', description: '页眉文字，例如 某中学高三期末试卷' },
          footer: { type: 'string', description: '页脚文字，例如 第 {page} 页 / 共 {total} 页' },
          pdf_name: { type: 'string', description: '导出 PDF 的文件名（留空 = 用页眉文字）' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'insert_paper_figure',
      description: '往试卷里插一张**数学图形**（按 kind + params 现场生成，落进图片库并给一个 [图N] ✓）——'
        + ('2D 图形种类与参数同 insert_math_figure ✓；' + FIGURE_COMMON + '（种类写错会回完整可选清单 ✓）'),
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: '图形种类，例如 parabola / ellipse / function …（见图形库 ✓）' },
          params: { type: 'object', description: '图形参数（a、b、p、dir、cx、cy 等）；认不出的参数会失败并给清单 ✓' },
        },
        required: ['kind'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'print_paper',
      description: '打印 / 另存 PDF（走浏览器打印，矢量文字可搜 ✓；用户会看到打印对话框 ✓）',
      parameters: { type: 'object', properties: {} },
    },
  },
{
    type: 'function',
    function: {
      name: 'get_handout_state',
      description: '读当前讲义：当前版本的正文（纯文本）+ 教材定位 + 标题 + 块数（改之前先读 ✓）',
      parameters: { type: 'object', properties: { maxChars: { type: 'number', description: '正文最多给多少字（默认 4000 ✓）' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_handout_help',
      description: '查讲义手册：全部块类型（22 种）、教材定位字段、学生版/教师版显示口径、题库打通、插图、导出（写细节前先查 ✓）',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_handout_outline',
      description: '讲义大纲：目录（章 → 节）+ 每个块的**块号** / 类型 / 摘要（老师说"第 N 块"时先调它拿号 ✓）',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_handout_blocks',
      description: '给讲义**加块**（最常用 ✓）：type 见手册（h1 章 / h2 节 / para 正文 / formula 公式 / goal 学习目标 / '
        + 'knowledge 知识梳理 / example 例题 / variant 变式 / exercise 练习 / summary 小结 / note 提示 / warn 易错 / '
        + 'answer 答案 / solution 解析 / blank 留白 / pagebreak 分页；preview 课前预习 / explore 探究思考 / method 方法总结 / homework 课后作业 / reflect 学后反思 ✓）；公式写行内 $…$ ✓',
      parameters: {
        type: 'object',
        properties: {
          blocks: {
            type: 'array',
            description: '要加的块（按顺序 ✓）',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', description: '块类型（见手册 ✓）' },
                text: { type: 'string', description: '正文（$…$ 公式 ✓；分页/留白/插图可以空着 ✓）' },
                render: { type: 'object', description: '显示口径 {student, teacher}：inline / hide / blank / endnote（不传用默认 ✓）' },
                blankCm: { type: 'number', description: 'type=blank 时的留白高度（cm ✓ 1–20）' },
              },
              required: ['type'],
            },
          },
          where: { type: 'string', description: 'end 末尾（默认）| after 第 after_no 块之后 | cursor 当前选中块之后' },
          after_no: { type: 'number', description: 'where=after 时的块号（先 get_handout_outline ✓）' },
        },
        required: ['blocks'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'build_handout_skeleton',
      description: '按**课型**一次生成讲义栏目骨架（新授课 / 学案 / 一轮复习 / 二轮专题 / 习题课 / 试卷讲评 ✓）：'
        + '每个栏目 = 一个 h1 栏目名 + 一个空块（老师再往里填 ✓）；mode = append 追加到末尾（默认 ✓）/ replace 重建（会清空现有块 ✗ 只有老师说「重来一份」才用 ✓）',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: '课型：新授课 / 学案 / 一轮复习 / 二轮专题 / 习题课 / 试卷讲评（也认 new / learn / review / topic / drill / comment ✓）' },
          mode: { type: 'string', description: 'append 追加到末尾（默认 ✓）| replace 重建（清空现有块 ✗）' },
        },
        required: ['kind'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_handout_text',
      description: '**就地改**讲义里已有的文字：字面替换（find 必须是原文里的片段，可跨行 ✓；all=true 改所有处 ✓）'
        + '—— 改现有内容用它，别用 add_handout_blocks 再抄一遍 ✗',
      parameters: {
        type: 'object',
        properties: {
          find: { type: 'string', description: '原文里的片段（先 get_handout_state 看原文 ✓）' },
          replace: { type: 'string', description: '换成什么（空串 = 删掉 ✓）' },
          all: { type: 'boolean', description: 'true = 改所有处（默认只改第一处 ✓）' },
        },
        required: ['find', 'replace'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'arrange_handout_block',
      description: '块的删 / 移 / 选：action = remove 删掉 | up 上移 | down 下移 | select 选中（之后 where=cursor 就插在它后面 ✓）',
      parameters: {
        type: 'object',
        properties: {
          no: { type: 'number', description: '块号（1 起，先 get_handout_outline ✓）' },
          action: { type: 'string', description: 'remove | up | down | select' },
        },
        required: ['no', 'action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_handout_block_render',
      description: '改某个块在**学生版 / 教师版**里的显示口径：inline 正常 | hide 不显示 | blank 留白 | endnote 排到文末 ✓'
        + '（老师说"学生版别给答案"就用它 ✗ 别删答案 ✓）',
      parameters: {
        type: 'object',
        properties: {
          no: { type: 'number', description: '块号（1 起 ✓）' },
          render: { type: 'string', description: 'inline | hide | blank | endnote' },
          version: { type: 'string', description: 'student 学生版 | teacher 教师版（不传 = 当前正在看的那版 ✓）' },
        },
        required: ['no', 'render'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_handout_meta',
      description: '改教材定位与标题：press 教材版本 / book 册 / chapter 章 / section 节 / period 课时 / title 标题 / '
        + 'subtitle 副标题 / school / subject / grade / teacher / date / autoTitle（认不出的键会被挡下并说明 ✓）',
      parameters: {
        type: 'object',
        properties: {
          press: { type: 'string', description: '人教版 / 北师大版 / 苏教版 / 湘教版 / 沪教版 / 鄂教版 / 其他' },
          book: { type: 'string', description: '必修一 / 必修二 / 必修三 / 选择性必修一 / 选择性必修二 / 选择性必修三' },
          chapter: { type: 'string', description: '第几章（填数字或整句都行 ✓）' },
          section: { type: 'string', description: '第几节 ✓' },
          period: { type: 'string', description: '第几课时 ✓' },
          title: { type: 'string', description: '讲义标题（写了就切成手动标题 ✓）' },
          subtitle: { type: 'string', description: '副标题 ✓' },
          autoTitle: { type: 'boolean', description: 'true = 标题按教材自动生成 ✓' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_handout_version',
      description: '切学生版 / 教师版（只看不改内容 ✓；要改某块在两版里的显示用 set_handout_block_render ✓）',
      parameters: { type: 'object', properties: { version: { type: 'string', description: 'student | teacher' } }, required: ['version'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'insert_bank_question_to_handout',
      description: '从题库插一道题进讲义（会插成「题干 + 解析 + 答案」三块 ✓，答案在学生版默认排到文末 ✓）'
        + '—— id 必须是**先 search_bank 查到的** ✓ 别猜 ✗',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: '题目 id（先 search_bank ✓）' },
          kind: { type: 'string', description: 'example 例题（默认）| exercise 练习 | variant 变式' },
          with_answer: { type: 'boolean', description: '要不要带答案（默认 true ✓）' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'draw_bank_questions_to_handout',
      description: '按条件从题库**抽 N 道**插成例题池 / 练习池（条件：section 章节 / kp 知识点 / level 难度 ✓）',
      parameters: {
        type: 'object',
        properties: {
          section: { type: 'string', description: '章节（可空 ✓）' },
          kp: { type: 'string', description: '知识点 / 关键词（可空 ✓）' },
          level: { type: 'string', description: '基础 | 中档 | 拔高（可空 ✓）' },
          n: { type: 'number', description: '抽几道（默认 3 ✓ 最多 20）' },
          pool: { type: 'string', description: 'example 例题（默认）| exercise 练习 | variant 变式' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'insert_handout_figure',
      description: '给讲义插一张**数学图形**（按 kind + params 现场生成 ✓ 插成插图块 ✓）—— 不要用文字或 ASCII 画图 ✗',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: '图形种类，例如 parabola / ellipse / hyperbola / function …（见图形库 ✓）' },
          params: { type: 'object', description: '图形参数（a、b、p、dir、cx、cy 等 ✓）' },
          caption: { type: 'string', description: '图注（可空 ✓）' },
        },
        required: ['kind'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sync_handout_refs',
      description: '讲义里引用了题库的块，按题库最新内容刷新（题在题库里改过之后用 ✓）',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'print_handout',
      description: '打印 / 另存 PDF（走浏览器打印，矢量文字可搜 ✓；老师会看到打印对话框 ✓）',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'export_handout_text',
      description: '导出纯文本（当前版本 ✓ 会下载一个 .txt ✓）',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_handout',
      description: '把讲义存进库目录（exe 同级的 LJ-讲义\<标题>.json ✓；平时改动会自动落盘，这个是"马上存一次" ✓）',
      parameters: { type: 'object', properties: {} },
    },
  },  {
    type: 'function',
    function: {
      name: 'import_handout_markdown',
      description: '把一段 **Markdown** 导成讲义块（章节 / 学习目标 / 例题 / 变式 / 练习 / 小结 / 定义… 自动认 ✓；'
        + '$…$ 变成公式块 ✓；图片路径读不到会换成一行【图：…】✗）—— 老师给你一整份 md 时用它 ✓',
      parameters: {
        type: 'object',
        properties: {
          markdown: { type: 'string', description: '要导入的 Markdown 原文（整份 ✓）' },
          where: { type: 'string', description: 'end 末尾（默认）| after 第 after_no 块之后 | cursor 当前选中块之后' },
          after_no: { type: 'number', description: 'where=after 时的块号（先 get_handout_outline ✓）' },
        },
        required: ['markdown'],
      },
    },
  },
]

/** 给 system 提示词追加的说明（告诉模型怎么用这些功能 ✓） */
export function aiToolGuide(): string {
  return [
    '【能用应用的功能】你可以调用工具**直接操作这个幻灯片应用**，不要只说"你可以插入…"。',
    '常用流程：先 get_deck_state 看当前页有什么 → 再 insert_math_figure / insert_text / add_slide 动手；',
    '要引用老师题库里的题：先 search_bank 拿 id，再 insert_bank_question。',
    '老师说「第 5 题…」时：**先 get_paper_outline 拿题号** → 再用 replace_paper_question / insert_paper_question 办事 ✓（按题号最稳，别自己数题号 ✗，也别拿 edit_paper_text 去猜原文 ✗）。',
    '试卷编辑还能改**设置**（字体/字号/题号样式/选项排布/分栏/页眉页脚 ✓ set_paper_style 与 set_paper_header）、套模板（apply_paper_template）、插数学图形（insert_paper_figure）、导出（print_paper ✓）；语法细节先查 get_paper_help ✓。',
    '要动「试卷编辑」里的 A4 试卷：先 get_paper_state 看正文，再用 append_to_paper 追加（按试卷排版：## 分大题、1. 题号、[题]…[/题] 整块 ✓）；单题也可以用 insert_bank_question_to_paper ✓。',
    '改已有元素前也先 get_deck_state 拿 id；改完/插完用一句中文说明你做了什么，别把工具的 JSON 原样倒给老师。',
    '数学图形一律用 insert_math_figure（kind + params），不要用 TikZ 画图、也不要只给 LaTeX 让老师自己画。',
'要动「数学讲义」里的讲义：先 get_handout_state 看有什么，再用 add_handout_blocks 加块（type + text ✓ 讲义是**块**结构，不认 [题] / [分页] / {c:red} 那些试卷语法 ✗）；',
    '老师说「第 N 块 / 第几节」时先 get_handout_outline 拿块号 ✓ → 再 arrange_handout_block / set_handout_block_render / edit_handout_text ✓；',
    '讲义还能改教材定位（set_handout_meta）、切学生版/教师版（set_handout_version）、插数学图形（insert_handout_figure）、从题库取题（insert_bank_question_to_handout / draw_bank_questions_to_handout）、打印导出（print_handout / export_handout_text / save_handout ✓）；块类型与字段先查 get_handout_help ✓；老师给你一整份 Markdown 时用 import_handout_markdown（章节 / 目标 / 例题 / 练习 / 小结会自动认 ✓）；说「起一份新授课 / 一轮复习讲义」就用 build_handout_skeleton（按课型一次生成栏目骨架 ✓）。',
    '老师说「字太小、放大一点」就用 update_elements 传 fontSize（例如 {"fontSize":36}）；',
    '说「图形线条换个颜色、坐标轴变灰」就用 set_figure_style（curveColor / axisColor / lineColors / pointColors）。',
  ].join('\n')
}

/** 插图形：认不出的 kind / 参数报错要能让人看懂 ✓ */
function buildFigure(args: Record<string, unknown>): AiToolResult {
  const kind = str(args.kind).trim()
  const kinds = mathFigureKindList()
  if (!kind) return { ok: false, error: '缺 kind；' + FIGURE_COMMON }
  if (kinds.length && kinds.indexOf(kind) < 0) {
    return { ok: false, error: '不认识的图形种类 ' + kind + '；' + figureKindHint() + '；' + FIGURE_COMMON }
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

const STR_FIELDS = ['text', 'color', 'bgColor', 'align', 'fontFamily', 'stroke', 'fill', 'conicStroke', 'axisColor']
const ARR_FIELDS = ['lineColors', 'pointColors', 'pointLabels']

/** 白名单过滤 + 别名翻译：只留允许改的字段，数字转数字、颜色转字符串、颜色数组按数组收 ✓
 *  别名表见 FIELD_ALIASES —— 模型写 font_size / lineColor 这类也认 ✓
 *  （用户实报「字号改不动」就是字段名对不上 ✗ + 「图形线条色改不动」是白名单缺字段 ✗，两边一起修 ✓） */
export function sanitizePatch(raw: unknown): Partial<SlideElement> {
  const out: Record<string, unknown> = {}
  if (!raw || typeof raw !== 'object') return out as Partial<SlideElement>
  const src: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const real = FIELD_ALIASES[k] || k
    if (!(EDITABLE_FIELDS as readonly string[]).includes(real)) continue
    if (!(real in src)) src[real] = v          // 真名优先：别名只在缺真名时顶上 ✓
  }
  for (const [k, v] of Object.entries(src)) {
    if (ARR_FIELDS.includes(k)) {
      if (Array.isArray(v)) {
        const arr = v.map((x) => (x === null || x === undefined ? null : String(x)))
        if (arr.length) out[k] = arr
      }
      continue
    }
    if (STR_FIELDS.includes(k)) { if (typeof v === 'string') out[k] = v; continue }
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
      case 'set_figure_style': {
        const ids = Array.isArray(a.ids) ? a.ids.map((x) => str(x)).filter(Boolean) : []
        if (!ids.length) return { ok: false, error: '缺 ids（先用 get_deck_state 拿）' }
        const patch = sanitizePatch({
          conicStroke: a.curveColor !== undefined ? a.curveColor : a.conicStroke,
          axisColor: a.axisColor, lineColors: a.lineColors, pointColors: a.pointColors,
          strokeWidth: a.lineWidth !== undefined ? a.lineWidth : a.strokeWidth,
        })
        if (!Object.keys(patch).length) return { ok: false, error: '没给要改的颜色（curveColor / axisColor / lineColors / pointColors / lineWidth）' }
        if (ctx.pushHistory) ctx.pushHistory()
        for (const id of ids) ctx.updateElement(id, patch)
        return { ok: true, result: { 改了: ids.length + ' 个图形的颜色', 字段: Object.keys(patch) } }
      }
      case 'update_elements': {
        const ids = Array.isArray(a.ids) ? a.ids.map((x) => str(x)).filter(Boolean) : []
        if (!ids.length) return { ok: false, error: '缺 ids（先用 get_deck_state 拿）' }
        const patch = sanitizePatch(a.patch)
        if (!Object.keys(patch).length) return { ok: false, error: 'patch 里没有可改的字段（只认：' + EDITABLE_FIELDS.join('、') + '）' }
        // 一次批量只存一份快照 ✓（store.updateElement 自己不存 ✗ → 不补的话老师 Ctrl+Z 回不来 ✓）
        if (ctx.pushHistory) ctx.pushHistory()
        for (const id of ids) ctx.updateElement(id, patch)
        return { ok: true, result: { 改了: ids.length + ' 个元素', 字段: Object.keys(patch) } }
      }
      case 'delete_elements': {
        const ids = Array.isArray(a.ids) ? a.ids.map((x) => str(x)).filter(Boolean) : []
        if (!ids.length) return { ok: false, error: '缺 ids' }
        if (ctx.pushHistory) ctx.pushHistory()
        for (const id of ids) ctx.removeElement(id)
        return { ok: true, result: { 删了: ids.length + ' 个元素（可以撤销）' } }
      }
      case 'undo': {
        ctx.undo()
        return { ok: true, result: { 已撤销一步: true } }
      }
      case 'get_paper_state': {
      const p = ctx.paper
      if (!p) return { ok: false, error: '这个版本没有试卷接口' }
      const want = num(args.max_chars) || 0
      const max = want > 0 ? Math.min(want, 8000) : 3000
      const st = p.state(max)
      if (!st.open) return { ok: true, result: { opened: false, note: '试卷编辑没开着 —— 调 append_to_paper 会自动打开它 ✓' } }
      return { ok: true, result: { opened: true, chars: st.text.length, text: st.text } }
    }
    case 'append_to_paper': {
      const p = ctx.paper
      if (!p) return { ok: false, error: '这个版本没有试卷接口' }
      const txt = str(args.text).trim()
      if (!txt) return { ok: false, error: '缺 text' }
      return { ok: true, result: { note: p.append(txt, !!args.page_break) } }
    }
    case 'insert_bank_question_to_paper': {
      const p = ctx.paper
      if (!p) return { ok: false, error: '这个版本没有试卷接口' }
      const qid = num(args.id)
      if (!qid) return { ok: false, error: '缺 id（先用 search_bank 搜题 ✓）' }
      const note = await p.insertQuestion(qid, args.with_answer === undefined ? false : !!args.with_answer)
      if (!note) return { ok: false, error: '题库里没有 id=' + qid + ' 这道题（先用 search_bank 搜一次 ✓）' }
      return { ok: true, result: { note } }
    }    case 'get_paper_help': {
      return { ok: true, result: { help: PAPER_HELP } }
    }
    case 'get_paper_style': {
      const p = ctx.paper
      if (!p || !p.style) return { ok: false, error: '这个版本没有试卷设置接口' }
      return { ok: true, result: p.style() }
    }
    case 'set_paper_style': {
      const p = ctx.paper
      if (!p || !p.setStyle) return { ok: false, error: '这个版本没有试卷设置接口' }
      const patch = args.patch && typeof args.patch === 'object' ? (args.patch as Record<string, unknown>) : null
      if (!patch) return { ok: false, error: '缺 patch（要改的键值 ✓）' }
      return { ok: true, result: { note: p.setStyle(patch) } }
    }
    case 'apply_paper_template': {
      const p = ctx.paper
      if (!p || !p.template) return { ok: false, error: '这个版本没有试卷模板接口' }
      const key = str(args.key).trim()
      if (!key) return { ok: false, error: '缺 key（handout | exam | exam19 | blank ✓）' }
      return { ok: true, result: { note: p.template(key) } }
    }
    case 'set_paper_header': {
      const p = ctx.paper
      if (!p || !p.setStyle) return { ok: false, error: '这个版本没有试卷设置接口' }
      const patch: Record<string, unknown> = {}
      if (args.header !== undefined) patch.headerText = String(args.header)
      if (args.footer !== undefined) patch.footerText = String(args.footer)
      if (args.pdf_name !== undefined) patch.pdfName = String(args.pdf_name)
      if (!Object.keys(patch).length) return { ok: false, error: '至少给 header / footer / pdf_name 之一 ✓' }
      return { ok: true, result: { note: p.setStyle(patch) } }
    }
    case 'insert_paper_figure': {
      const p = ctx.paper
      if (!p || !p.figure) return { ok: false, error: '这个版本没有试卷插图接口' }
      const kind = str(args.kind).trim()
      if (!kind) return { ok: false, error: '缺 kind；' + FIGURE_COMMON }
      // 【v1696】按**完整图形库**校验（以前错用 figureKinds() 只认 19 种圆锥曲线 ✗ → 抛物线被拒 ✗）
      const kinds = mathFigureKindList()
      if (kinds.length && kinds.indexOf(kind) < 0) {
        return { ok: false, error: '不认识的图形种类 ' + kind + '；' + figureKindHint() + '；' + FIGURE_COMMON }
      }
      const params = args.params && typeof args.params === 'object' ? (args.params as Record<string, unknown>) : {}
      const tag = await p.figure(kind, params)
      // 返回的不是 [图N] 就是**失败原因**（PaperModal 那边把每一步都说清楚了 ✓）—— 原样转给模型 ✓
      if (!tag || tag.charAt(0) !== '[') return { ok: false, error: tag || '图形没插进去（没有更多信息）' }
      return { ok: true, result: { note: '已插入数学图形 ' + kind + (mathFigureLabel(kind) ? '（' + mathFigureLabel(kind) + '）' : '') + ' → ' + tag } }
    }
    case 'print_paper': {
      const p = ctx.paper
      if (!p || !p.print) return { ok: false, error: '这个版本没有试卷打印接口' }
      return { ok: true, result: { note: p.print() } }
}
    case 'edit_paper_text': {
      const p = ctx.paper
      if (!p || !p.edit) return { ok: false, error: '这个版本没有试卷编辑接口' }
      const find = str(args.find)
      if (!find) return { ok: false, error: '缺 find（要替换的原文，可多行 ✓）' }
      const replace = args.replace === undefined ? '' : String(args.replace)
      return { ok: true, result: { note: p.edit(find, replace, !!args.all) } }
    }
    case 'get_paper_outline': {
      const p = ctx.paper
      if (!p || !p.outline) return { ok: false, error: '这个版本没有试卷大纲接口' }
      return { ok: true, result: { outline: p.outline() } }
    }
    case 'replace_paper_question': {
      const p = ctx.paper
      if (!p || !p.replaceQuestion) return { ok: false, error: '这个版本没有按题号改的接口' }
      const no = num(args.no)
      const text = str(args.text)
      if (!no) return { ok: false, error: '缺 no（题号 ✓ 先用 get_paper_outline 看）' }
      if (!text.trim()) return { ok: false, error: '缺 text（新的整道题 ✓）' }
      const note = p.replaceQuestion(Math.round(no), text)
      if (!note) return { ok: false, error: '没换成（原因不明）' }
      if (note.indexOf('已换掉') < 0) return { ok: false, error: note }
      return { ok: true, result: { note } }
    }
    case 'insert_paper_question': {
      const p = ctx.paper
      if (!p || !p.insertQuestionAt) return { ok: false, error: '这个版本没有按题号插的接口' }
      const afterNo = num(args.after_no)
      const text = str(args.text)
      if (!afterNo) return { ok: false, error: '缺 after_no（插在哪个题号之后 ✓）' }
      if (!text.trim()) return { ok: false, error: '缺 text（新的整道题 ✓）' }
      const note = p.insertQuestionAt(Math.round(afterNo), text)
      if (!note) return { ok: false, error: '没插进去（原因不明）' }
      if (note.indexOf('已在第') < 0) return { ok: false, error: note }
      return { ok: true, result: { note } }
    }
case 'get_handout_state': {
      const h = ctx.handout
      if (!h) return { ok: false, error: '讲义没开着：先让老师打开「数学讲义」窗口 ✓' }
      return { ok: true, result: h.state(Math.max(500, Math.round(num(args.maxChars) ?? 4000))) }
    }
    case 'get_handout_help': {
      return { ok: true, result: { help: HANDOUT_HELP } }
    }
    case 'get_handout_outline': {
      const h = ctx.handout
      if (!h) return { ok: false, error: '讲义没开着：先让老师打开「数学讲义」窗口 ✓' }
      return { ok: true, result: { outline: h.outline() } }
    }
    case 'add_handout_blocks': {
      const h = ctx.handout
      if (!h || !h.addBlocks) return { ok: false, error: '讲义没开着：先让老师打开「数学讲义」窗口 ✓' }
      // 【v1708】先用**宽松**校验把模型爱写的样子捋顺（中文块名 / 单对象 / content / Markdown # ✓）
      const parsed = handoutBlockSpecsLoose(args.blocks)
      if (!parsed.specs.length) {
        return { ok: false, error: '没有能加的块：' + (parsed.errors.join('；') || '（blocks 给空了 ✓）') }
      }
      const where = ['end', 'after', 'cursor'].indexOf(str(args.where)) >= 0 ? str(args.where) : 'end'
      const note = h.addBlocks(parsed.specs, where, Math.round(num(args.after_no) ?? 0))
      const warn = parsed.errors.concat(parsed.fixed)
      return {
        ok: true,
        result: warn.length
          ? { note, added: parsed.specs.length, warnings: warn }
          : { note, added: parsed.specs.length },
      }
    }
    case 'build_handout_skeleton': {
      const h = ctx.handout
      if (!h || !h.skeleton) return { ok: false, error: '讲义没开着：先让老师打开「数学讲义」窗口 ✓' }
      const kind = guessCourse(args.kind)
      if (!kind) {
        return { ok: false, error: '认不出这个课型「' + str(args.kind) + '」：只能填 新授课 / 学案 / 一轮复习 / 二轮专题 / 习题课 / 试卷讲评 ✓' }
      }
      const mode = str(args.mode).trim() === 'replace' ? 'replace' : 'append'
      const note = h.skeleton(kind, mode)
      if (!note) return { ok: false, error: '没生成（原因不明）' }
      if (note.indexOf('认不出') >= 0) return { ok: false, error: note }
      return { ok: true, result: { note } }
    }
    case 'edit_handout_text': {
      const h = ctx.handout
      if (!h || !h.edit) return { ok: false, error: '讲义没开着：先让老师打开「数学讲义」窗口 ✓' }
      const find = str(args.find)
      if (!find) return { ok: false, error: '缺 find（要改的原文片段 ✓）' }
      const note = h.edit(find, str(args.replace), args.all === true)
      if (!note) return { ok: false, error: '没改到（原因不明）' }
      if (note.indexOf('没找到') >= 0) return { ok: false, error: note }
      return { ok: true, result: { note } }
    }
    case 'arrange_handout_block': {
      const h = ctx.handout
      if (!h || !h.block) return { ok: false, error: '讲义没开着：先让老师打开「数学讲义」窗口 ✓' }
      const no = num(args.no)
      if (!no) return { ok: false, error: '缺 no（第几块，1 起 ✓ 先 get_handout_outline ✓）' }
      const act = guessAction(args.action)
      if (['remove', 'up', 'down', 'select'].indexOf(act) < 0) return { ok: false, error: 'action 只能是 remove / up / down / select ✓' }
      const note = h.block(Math.round(no), act)
      if (!note) return { ok: false, error: '没动成（原因不明）' }
      if (note.indexOf('没有第') >= 0 || note.indexOf('认不出') >= 0) return { ok: false, error: note }
      return { ok: true, result: { note } }
    }
    case 'set_handout_block_render': {
      const h = ctx.handout
      if (!h || !h.setRender) return { ok: false, error: '讲义没开着：先让老师打开「数学讲义」窗口 ✓' }
      const no = num(args.no)
      if (!no) return { ok: false, error: '缺 no（第几块，1 起 ✓）' }
      const note = h.setRender(Math.round(no), guessRender(args.render), guessVersion(args.version))
      if (!note) return { ok: false, error: '没改到（原因不明）' }
      if (note.indexOf('没有第') >= 0 || note.indexOf('认不出') >= 0) return { ok: false, error: note }
      return { ok: true, result: { note } }
    }
    case 'set_handout_meta': {
      const h = ctx.handout
      if (!h || !h.setMeta) return { ok: false, error: '讲义没开着：先让老师打开「数学讲义」窗口 ✓' }
      const parsed = handoutMetaPatch(args)
      const keys = Object.keys(parsed.patch)
      if (!keys.length) return { ok: false, error: '没有能改的字段：' + parsed.errors.join('；') }
      const note = h.setMeta(parsed.patch)
      return { ok: true, result: parsed.errors.length ? { note, warnings: parsed.errors } : { note } }
    }
    case 'set_handout_version': {
      const h = ctx.handout
      if (!h || !h.version) return { ok: false, error: '讲义没开着：先让老师打开「数学讲义」窗口 ✓' }
      const v = guessVersion(args.version)
      if (v !== 'student' && v !== 'teacher') return { ok: false, error: 'version 只能是 student 或 teacher ✓' }
      return { ok: true, result: { note: h.version(v) } }
    }
    case 'insert_bank_question_to_handout': {
      const h = ctx.handout
      if (!h || !h.insertQuestion) return { ok: false, error: '讲义没开着：先让老师打开「数学讲义」窗口 ✓' }
      if (!args.q) return { ok: false, error: '这道题还没查到：先 search_bank 搜一次拿到 id，再插 ✓' }
      const gk = guessKind(args.kind)
      const kind = ['example', 'exercise', 'variant'].indexOf(gk) >= 0 ? gk : 'example'
      const note = h.insertQuestion(args.q, kind, args.with_answer !== false)
      if (!note) return { ok: false, error: '没插进去（题库里没有这道题？先 search_bank ✓）' }
      return { ok: true, result: { note } }
    }
    case 'draw_bank_questions_to_handout': {
      const h = ctx.handout
      if (!h || !h.draw) return { ok: false, error: '讲义没开着：先让老师打开「数学讲义」窗口 ✓' }
      const filter: Record<string, unknown> = {}
      for (const k of ['section', 'kp', 'level']) if (str(args[k]).trim()) filter[k] = str(args[k]).trim()
      const n = Math.max(1, Math.min(20, Math.round(num(args.n) ?? 3)))
      const pool = guessKind(args.pool)
      const note = await h.draw(filter, n, pool)
      if (!note) return { ok: false, error: '没抽到（原因不明）' }
      if (note.indexOf('没有题') >= 0) return { ok: false, error: note }
      return { ok: true, result: { note } }
    }
    case 'insert_handout_figure': {
      const h = ctx.handout
      if (!h || !h.figure) return { ok: false, error: '讲义没开着：先让老师打开「数学讲义」窗口 ✓' }
      const kind = str(args.kind).trim()
      const kinds = mathFigureKindList()
      if (!kind) return { ok: false, error: '缺 kind；' + FIGURE_COMMON }
      if (kinds.length && kinds.indexOf(kind) < 0) {
        return { ok: false, error: '不认识的图形种类 ' + kind + '；' + figureKindHint() + '；' + FIGURE_COMMON }
      }
      const params = (args.params && typeof args.params === 'object' ? args.params : {}) as Record<string, unknown>
      const note = await h.figure(kind, params, str(args.caption))
      if (!note) return { ok: false, error: '没插进去（原因不明）' }
      if (note.indexOf('失败') >= 0 || note.indexOf('不认识的图形种类') >= 0 || note.indexOf('没渲染出') >= 0) {
        return { ok: false, error: note }
      }
      return { ok: true, result: { note } }
    }
    case 'sync_handout_refs': {
      const h = ctx.handout
      if (!h || !h.syncRefs) return { ok: false, error: '讲义没开着：先让老师打开「数学讲义」窗口 ✓' }
      return { ok: true, result: { note: await h.syncRefs() } }
    }
    case 'print_handout': {
      const h = ctx.handout
      if (!h || !h.print) return { ok: false, error: '讲义没开着：先让老师打开「数学讲义」窗口 ✓' }
      return { ok: true, result: { note: h.print() } }
    }
    case 'export_handout_text': {
      const h = ctx.handout
      if (!h || !h.exportText) return { ok: false, error: '讲义没开着：先让老师打开「数学讲义」窗口 ✓' }
      return { ok: true, result: { note: h.exportText() } }
    }
    case 'save_handout': {
      const h = ctx.handout
      if (!h || !h.save) return { ok: false, error: '讲义没开着：先让老师打开「数学讲义」窗口 ✓' }
      return { ok: true, result: { note: await h.save() } }
    }
    case 'import_handout_markdown': {
      const h = ctx.handout
      if (!h || !h.importMarkdown) return { ok: false, error: '讲义没开着：先让老师打开「数学讲义」窗口 ✓' }
      const md = str(args.markdown)
      if (!md.trim()) return { ok: false, error: '缺 markdown（要导入的原文 ✓）' }
      const where = ['end', 'after', 'cursor'].indexOf(str(args.where)) >= 0 ? str(args.where) : 'end'
      const note = h.importMarkdown(md, where, Math.round(num(args.after_no) ?? 0))
      if (!note) return { ok: false, error: '没导进去（原因不明）' }
      if (note.indexOf('没解析出内容') >= 0) return { ok: false, error: note }
      return { ok: true, result: { note } }
    }
    default:
        return { ok: false, error: '没有这个功能：' + name }
    }
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) }
  }
}
