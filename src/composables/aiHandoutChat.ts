/**
 * 【v1707】讲义编辑里的 **AI 助手**：口径 / 提示词 / 语法手册（纯函数 ✓ 探针覆盖 ✓）
 *
 * 用户口径：「为讲义引入 AI 面板 —— AI 要精通讲义的各种操作和功能」✓
 * 两条做法（与试卷 v1693 完全同一套 ✓）：
 *   ① 能力做成**工具**：加块 / 改块 / 教材定位 / 版本口径 / 插图 / 题库 / 同步 / 打印 / 导出 / 保存 ✓
 *   ② 功能做成**手册**（HANDOUT_HELP）：让模型按需 get_handout_help 查 ✓ 不塞进 system ✗（太长每轮烧 token ✗）
 *
 * 为什么单独一个模块：聊天那层要回答「给模型看什么 / 给它哪几个工具 / 什么算能发」——
 *   这些都是**能测的规则** ✓（界面与网络调用留在 AiHandoutChat.vue ✓）
 */
import type { AiToolCtx } from '@/composables/aiTools'

/** 一次最多带几张图（与试卷/侧栏口径一致 ✓） */
export const HANDOUT_CHAT_MAX_IMG = 4
export const HANDOUT_CHAT_MAX_BYTES = 4 * 1024 * 1024

/** 讲义块的**全部类型** —— 必须与 useHandout.HD_LABEL 的键一一对应 ✓（探针盯着不许漂 ✗） */
export const HANDOUT_BLOCK_TYPES = [
  'h1', 'h2', 'para', 'formula', 'figure', 'pagebreak', 'goal', 'knowledge',
  'example', 'variant', 'exercise', 'summary', 'note', 'warn', 'answer', 'solution', 'blank',
  'preview', 'explore', 'method', 'homework', 'reflect',
]
/** 类型 → 人话（与 HD_LABEL 同一套说法 ✓） */
export const HANDOUT_BLOCK_LABEL: Record<string, string> = {
  h1: '章标题', h2: '节标题', para: '正文', formula: '公式', figure: '图片', pagebreak: '分页',
  goal: '学习目标', knowledge: '知识梳理', example: '例题', variant: '变式', exercise: '当堂练习',
  summary: '归纳小结', note: '提示', warn: '易错警示', answer: '答案', solution: '解析', blank: '留白',
  preview: '课前预习', explore: '探究思考', method: '方法总结', homework: '课后作业', reflect: '学后反思',
}
/** 一个块在某一版里怎么显示 ✓（与 useHandout.HdRender 同一套 ✓） */
export const HANDOUT_RENDERS = ['inline', 'hide', 'blank', 'endnote']
/** 教材版本 / 册（与 HD_PRESSES / HD_BOOKS 同一套 ✓ 探针盯着 ✗） */
export const HANDOUT_PRESSES = ['人教版', '北师大版', '苏教版', '湘教版', '沪教版', '鄂教版', '其他']
export const HANDOUT_BOOKS = ['必修一', '必修二', '必修三', '选择性必修一', '选择性必修二', '选择性必修三']
/** 能改的教材定位 / 标题字段（与 HandoutMeta 的键一一对应 ✓） */
export const HANDOUT_META_KEYS = [
  'press', 'book', 'chapter', 'section', 'period', 'title', 'subtitle',
  'school', 'subject', 'grade', 'teacher', 'date', 'autoTitle',
]

/**
 * 讲义聊天**只给这些工具** ✓：
 *   · 幻灯片那套（add_slide / insert_text …）与试卷那套（[题] 块 / [分页] / 页眉页脚）
 *     在讲义里都用不上 ✗ —— 给了模型只会乱调，还会把话说岔（它以为在改试卷 ✗）。
 */
export const HANDOUT_TOOL_NAMES = [
  'get_handout_state', 'get_handout_help', 'get_handout_outline', 'add_handout_blocks',
  'build_handout_skeleton',
  'edit_handout_text', 'arrange_handout_block', 'set_handout_block_render', 'set_handout_meta',
  'set_handout_version', 'insert_bank_question_to_handout', 'draw_bank_questions_to_handout',
  'search_bank', 'insert_handout_figure', 'sync_handout_refs', 'print_handout',
  'export_handout_text', 'save_handout', 'import_handout_markdown',
]

/** 从完整工具表里只挑讲义用得上的（名字认不出就跳过，不炸 ✓） */
export function handoutToolsOf(all: unknown[]): unknown[] {
  const keep = new Set(HANDOUT_TOOL_NAMES)
  const out: unknown[] = []
  for (const t of all || []) {
    const name = String(((t as { function?: { name?: unknown } })?.function?.name) || '')
    if (keep.has(name)) out.push(t)
  }
  return out
}

/** 讲义那套动作的口径（真实现在 HandoutModal.vue ✓；这里只给类型，方便对照 ✓） */
export type HandoutCtx = NonNullable<AiToolCtx['handout']>

export interface HandoutBlockSpecIn {
  type: string
  text: string
  render?: { student?: string; teacher?: string }
  blankCm?: number
}

/**
 * AI 给的 blocks → 能直接造的块规格 ✓（**纯函数**，探针能直接断言 ✓）
 * 认不出的类型 / 空正文 / 越界留白 → 不收，并且**说清为什么** ✗（模型看得懂才改得对 ✓）
 * 上限 60 块：一次塞半本书进讲义不是好事 ✗
 */
export function handoutBlockSpecs(raw: unknown): { specs: HandoutBlockSpecIn[]; errors: string[] } {
  const specs: HandoutBlockSpecIn[] = []
  const errors: string[] = []
  const list = Array.isArray(raw) ? raw : []
  if (!list.length) errors.push('blocks 是空的：至少给一块（type + text ✓）')
  for (let i = 0; i < list.length; i++) {
    if (specs.length >= 60) { errors.push('一次最多加 60 块（多的没收 ✓）'); break }
    const it = (list[i] && typeof list[i] === 'object' ? list[i] : {}) as Record<string, unknown>
    const type = String(it.type == null ? '' : it.type).trim()
    if (HANDOUT_BLOCK_TYPES.indexOf(type) < 0) {
      errors.push('第 ' + (i + 1) + ' 块的 type 认不出：' + (type || '（空）') + '；能用的类型见手册 ✓')
      continue
    }
    const text = String(it.text == null ? '' : it.text).slice(0, 4000)
    const mayBeEmpty = type === 'pagebreak' || type === 'blank' || type === 'figure'
    if (!text.trim() && !mayBeEmpty) {
      errors.push('第 ' + (i + 1) + ' 块（' + HANDOUT_BLOCK_LABEL[type] + '）没有正文 ✗（只有分页 / 留白 / 插图可以空着 ✓）')
      continue
    }
    const spec: HandoutBlockSpecIn = { type, text }
    const r = (it.render && typeof it.render === 'object' ? it.render : null) as Record<string, unknown> | null
    if (r) {
      const rr: { student?: string; teacher?: string } = {}
      for (const v of ['student', 'teacher']) {
        const val = String(r[v] == null ? '' : r[v]).trim()
        if (!val) continue
        if (HANDOUT_RENDERS.indexOf(val) < 0) {
          errors.push('第 ' + (i + 1) + ' 块的 render.' + v + ' 认不出：' + val + '；只能是 ' + HANDOUT_RENDERS.join(' / ') + ' ✓')
          continue
        }
        if (v === 'student') rr.student = val
        else rr.teacher = val
      }
      if (rr.student || rr.teacher) spec.render = rr
    }
    if (type === 'blank') {
      const cm = Math.round(Number(it.blankCm))
      spec.blankCm = Number.isFinite(cm) ? Math.max(1, Math.min(20, cm)) : 4
    }
    specs.push(spec)
  }
  return { specs, errors }
}

/** AI 给的 meta → 能写的补丁 ✓（纯函数 ✓）：认不出的键丢掉并说清 ✓，press/book 只认清单里的 ✓ */
export function handoutMetaPatch(raw: unknown): { patch: Record<string, unknown>; errors: string[] } {
  const patch: Record<string, unknown> = {}
  const errors: string[] = []
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  for (const k of Object.keys(src)) {
    if (HANDOUT_META_KEYS.indexOf(k) < 0) {
      errors.push('认不出的字段 ' + k + '（能改的是 ' + HANDOUT_META_KEYS.join('、') + ' ✓）')
      continue
    }
    if (k === 'autoTitle') { patch[k] = !!src[k]; continue }
    const v = String(src[k] == null ? '' : src[k]).trim().slice(0, 80)
    if (k === 'press' && v && HANDOUT_PRESSES.indexOf(v) < 0) { errors.push('press 只认：' + HANDOUT_PRESSES.join('、') + ' ✓'); continue }
    if (k === 'book' && v && HANDOUT_BOOKS.indexOf(v) < 0) { errors.push('book 只认：' + HANDOUT_BOOKS.join('、') + ' ✓'); continue }
    patch[k] = v
  }
  if (!Object.keys(patch).length && !errors.length) {
    errors.push('没有要改的字段：至少要给一个（' + HANDOUT_META_KEYS.join('、') + ' ✓）')
  }
  return { patch, errors }
}

/** 大纲的一行（HandoutModal 造好、这里只管排版 ✓ 纯函数 ✓） */
export interface HandoutOutlineRow { no: number; type: string; text: string }

/** 大纲 → 给模型看的清单（#块号 [类型] 摘要 ✓ —— 「第 N 块」都按这个号 ✓） */
export function handoutOutlineText(rows: HandoutOutlineRow[]): string {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return '讲义还是空的（一块都还没有 ✓）'
  return list.map((r) => {
    const label = HANDOUT_BLOCK_LABEL[r.type] || r.type
    const t = String(r.text == null ? '' : r.text).replace(/\s+/g, ' ').trim()
    return '#' + r.no + ' [' + label + '] ' + (t ? (t.length > 28 ? t.slice(0, 28) + '…' : t) : '（空）')
  }).join(String.fromCharCode(10))
}

/** 能不能发（不忙、有内容或有附件 ✓）；不能发就说清为什么 ✓ */
export function canSendHandoutChat(text: string, busy: boolean, attCount = 0): { ok: boolean; why: string } {
  if (busy) return { ok: false, why: '上一条还在处理…' }
  if (!String(text || '').trim() && !attCount) return { ok: false, why: '先说一句要改什么（也可以只丢一张图 ✓）' }
  return { ok: true, why: '' }
}

/** 附件能不能收（数量与体积两道闸 ✓） */
export function canAttachHandoutChat(nowCount: number, bytes: number): { ok: boolean; why: string } {
  if (nowCount >= HANDOUT_CHAT_MAX_IMG) return { ok: false, why: '最多带 ' + HANDOUT_CHAT_MAX_IMG + ' 张图' }
  if (bytes > HANDOUT_CHAT_MAX_BYTES) return { ok: false, why: '这张图超过 4MB，先压一下再发' }
  return { ok: true, why: '' }
}

/**
 * 讲义助手的 system：**讲义的块结构与两个版本写死** ✓
 * 不写它就会：用 Markdown 的 # 当标题 ✗、把例题写成散文 ✗、拿试卷语法（[题] / [分页] / {c:red}）硬套 ✗。
 */
export function buildHandoutChatSystem(): string {
  return [
    '你是高中数学老师的**讲义编辑助手**。老师在「数学讲义」窗口里编一份 A4 讲义（左：目录+块列表；中：A4 预览；右：教材定位+块属性）。',
    '讲义是**给学生看的**（不是试卷 ✗）：有学习目标、知识梳理、例题、变式、当堂练习、归纳小结；答案与解析按**学生版 / 教师版**分开显示 ✓。',
    '讲义由**块**串成（22 种类型 ✓）。加内容一律用 add_handout_blocks（type + text ✓），不要输出 Markdown 源码让老师自己贴 ✗。',
    '要**主动用工具**改这份讲义，不要只说"你可以…"。动手前先 get_handout_state 看现在有什么 ✓。',
    '老师说「第 N 块 / 第几节」时：**先 get_handout_outline 拿块号** ✓ → 再用 arrange_handout_block / set_handout_block_render / edit_handout_text 办事（按块号最稳，别自己数 ✗）。',
    '公式一律行内 $…$（独立成行就单独放一个 formula 块 ✓）；不要写试卷语法（[题] / [选项] / [分页] / {c:red} —— 讲义都不认 ✗）。',
    '老师说「学生版不要出现答案」→ 用 set_handout_block_render 改显示口径（endnote 排到文末 / hide 不显示 ✓），**别把答案删掉** ✗（教师版还要用 ✓）。',
    '图形不要用文字或 ASCII 画 ✗ —— 用 insert_handout_figure（kind + params ✓）；认不出的种类它会报错，别硬猜 ✗。',
    '从题库取题：先 search_bank 拿 id ✓ → insert_bank_question_to_handout（kind = example 例题 / exercise 练习 / variant 变式 ✓）→ 会插成「题干 + 解析 + 答案」三块 ✓。',
    '要写具体块类型 / 教材定位 / 版本口径 / 显示方式时，先查 get_handout_help ✓（手册里有全部类型与字段 ✓）。',
    '⚠ **回复要短**：老师只看讲义结果 ✓ —— 改完只回一句「改了哪几块」（30 字内 ✓），不要复述正文、不要讲步骤、不要列工具 ✗。',
'看不到的东西（块号 / 题号 / 图号）不要猜 ✓ 先查。',
    ...HANDOUT_FEWSHOT,
  ].join(String.fromCharCode(10))
}

/* ---------------- 【v1707】讲义语法与功能手册（给模型**按需查** ✓，不塞进 system ✗） ---------------- */

/**
 * 讲义编辑认的全部类型 / 字段 / 做法 —— 做成一个工具（get_handout_help）让模型自己查 ✓
 * ⚠ 这份手册必须与 HandoutModal / useHandout 保持一致 ✓（改块类型或 meta 字段时两处一起改 ✗
 *   否则 AI 会写出讲义里根本没有的块 ✗）
 */
export const HANDOUT_HELP = [
  '【讲义是什么】高中**数学讲义**（不是试卷 ✗）：由**块**串成，A4 版式，可切学生版 / 教师版，可打印成矢量 PDF。',
  '【块类型（22 种，就是 add_handout_blocks 的 type ✓）】',
  '  h1 章标题（目录一级）　h2 节标题（目录二级）',
  '  para 正文　formula 公式块　figure 插图　pagebreak 分页',
  '  goal 学习目标　knowledge 知识梳理　summary 归纳小结　note 提示　warn 易错警示',
  '  example 例题　variant 变式　exercise 当堂练习（这三种**自动编号**：例1 / 变式1 / 练习1 ✓）',
  '  answer 答案　solution 解析（默认：教师版内联、学生版排到文末 ✓）',
  '  blank 学生留白（blankCm 高度，1–20 cm ✓ 不给就 4cm ✓）',
  '  preview 课前预习　explore 探究思考　method 方法总结　homework 课后作业　reflect 学后反思（v1712 新增 ✓ 对应讲义里的常见栏目 ✓）',
  '【课型骨架（build_handout_skeleton ✓）】老师说「起一份新授课讲义 / 一轮复习讲义 / 学案 / 习题课 / 二轮专题 / 试卷讲评」时用它一次生成栏目骨架 ✓',
  '  kind 只能填：新授课 / 学案 / 一轮复习 / 二轮专题 / 习题课 / 试卷讲评 ✓（也认 new / learn / review / topic / drill / comment ✓ 认不出会报错 ✓）',
  '  mode = append 追加到末尾（默认 ✓）；replace 是**重建**（会清掉现有块 ✗ 只有老师说「重新起一份 / 这份不要了」才用 ✓）',
  '【挖空（填空版 ✓）】正文里把要挖的地方用两个花括号包起来（如 距离之{{和}}为常数 ✓）：学生版印成空线（学生边听边填 ✓）、教师版印成原词 ✓；',
  '  别写成下划线或「____」✗（那样两版都一样，学生版就没得填了 ✗）；知识梳理 / 必备知识 / 定义 / 定理最适合挖空 ✓',
  '【学生版抬头】学生版 A4 抬头自带「姓名 / 班级 / 学号」填写行 ✓（老师不用自己加 ✓）',
  '【栏目怎么选】预习任务 → preview；课堂探究 / 思考 / 观察 → explore；例题讲完的解法提炼 → method；作业（含分层）→ homework；课末反思 / 我的疑问 / 自我诊断 → reflect ✓',
  '  讲义里常用「一、学习目标 / 二、知识梳理 …」这种**章级栏目名**（h1 ✓），栏目下面再放对应的块 ✓（骨架工具就是按这个规矩生成的 ✓）',
  '【一线硬规矩（学校检查要求 ✓ 写讲义时照做 ✓）】① 分层用 ★ 标注（★ 基础 / ★★ 提升 / ★★★ 拓展 ✓）别只写「A 组 B 组」✗；',
  '  ② 课后作业的题号后面**不标分值** ✗；③ 序号标点全场统一（要么都用 1. 要么都用（1）✗ 不能 1、和 1. 混用 ✗）；④ 题号必须连续 ✗ 不许跳号；⑤ 知识梳理 / 必备知识要留白给学生自己归纳 ✓',
  '【新高考题型（新课标卷 19 题 ✓）】单选 8×5=40、多选 3×6=18（**部分给分**：两选项只选 1 个得 3 分；三选项选 1 个得 2 分、选 2 个得 4 分 ✓）、填空 3×5=15、解答 5 题（13 / 15 / 15 / 17 / 17 = 77 分 ✓ 压轴 17 分、三问递进 ✓）；',
  '  出检测 / 限时训练时按这个梯度排（选填 73 分 + 解答 77 分 = 150 ✓），压轴题留给「分步得分 / 新定义题」练 ✓',
  '【版式（可照抄 ✓）】正文宋体五号、1.5 倍行距、**无首行缩进**、两端对齐 ✓；小标题黑体五号左对齐 ✓；讲义 A4 单栏、纸张疏排留白（试卷才密排分栏 ✗）✓',
  '【正文怎么写】公式行内 $…$ ✓；一块里可以有多个自然段（用换行 ✓）；例题 / 练习要把条件写全（是给学生做的 ✓）；',
  '  不要写 [题] / [选项] / [分页] / {c:red} 这些**试卷语法** ✗（讲义不认，会原样印出来 ✗）。',
  '【教材定位（set_handout_meta ✓）】press 教材版本 / book 册 / chapter 章 / section 节 / period 课时 /',
  '  title 标题 / subtitle 副标题 / school 学校 / subject 学科 / grade 年级 / teacher 教师 / date 日期 / autoTitle 标题自动生成 ✓',
  '  · press 只能填：' + HANDOUT_PRESSES.join('、') + ' ✓',
  '  · book 只能填：' + HANDOUT_BOOKS.join('、') + ' ✓',
  '  · autoTitle = true 时标题按「册 / 章 / 节 / 课时」自动生成 ✓（老师手改过标题就会自动关掉 ✓）',
  '【两个版本 student / teacher（set_handout_version ✓）】每个块**各自**有显示口径（set_handout_block_render ✓）：',
  '  inline 正常显示　hide 不显示　blank 留白（学生手写 ✓）　endnote 排到文末 ✓',
  '  典型：答案 / 解析 → 学生版 endnote（学生先做，答案统一排最后 ✓）、教师版 inline ✓；知识梳理要学生填空 → 学生版 blank ✓',
  '【加块的位置（add_handout_blocks 的 where ✓）】end 追加到末尾（默认 ✓）｜ after 插在第 afterNo 块之后（先 get_handout_outline 拿号 ✓）｜ cursor 插在**当前选中块**之后 ✓',
  '【就地改（edit_handout_text ✓）】字面替换：先 get_handout_state 看原文 ✗ 别凭印象写 find ✓；find 可以跨行 ✓；all=true 改所有处 ✓',
  '【块操作（arrange_handout_block ✓）】action = remove 删掉｜up 上移｜down 下移｜select 选中（之后 add 的块会插在它后面 ✓）',
  '【题库打通】search_bank（拿 id ✓）→ insert_bank_question_to_handout（kind = example / exercise / variant ✓，会插成题干+解析+答案 ✓）；',
  '  draw_bank_questions_to_handout：按 section / kp / level 抽 n 道插成池 ✓；引用的题在题库里改过之后用 sync_handout_refs 刷新 ✓',
  '【知识底座】老师平时攒的公式 / 模型 / 易错点（按教材存 ✓）—— 这里没有直接插底座条目的工具 ✗：',
  '  要写就用 add_handout_blocks 造 knowledge / note / warn 块 ✓；想用老师攒的条目，请他点工具栏「知识底座」✓',
  '【插图】insert_handout_figure（kind + params ✓）—— 会插成 figure 块，注释可选 ✓；',
  '  老师自己传的图：请他点「上传图片」或在「块属性」里改注释 / 位置 / 宽度 ✓；',
  '  图形种类与参数：kind 见 insert_handout_figure 的报错提示 ✓（抛物线 parabola、椭圆 ellipse、双曲线 hyperbola、函数图像 function … ✓）',
  '【导入 Markdown（import_handout_markdown ✓）】把一整份 md 导成块：',
  '  # 标题 → 讲义标题 ✓　## 本节目标 → 学习目标 ✓　## 例题精讲 / 变式 / 当堂练习 / 本章小结 → 对应块 ✓',
  '  ### 2.1 … → 节标题 ✓　**定义：**… → 知识梳理 ✓　> 引用 → 提示 ✓　$…$ → 公式块 ✓',
  '  ⚠ 图片路径读不到 → 换成一行【图：…】（图请在讲义里重新插 ✓）；表格按原样进正文 ✗（讲义不渲染表格 ✓）',
  '【文件与导出】讲义按 册 → 章 → 节 → 课时 存进 exe 同级的 LJ-讲义 目录（改动会自动落盘 ✓）：',
  '  save_handout 马上存一次 ✓　print_handout 打印 / 另存 PDF（矢量文字 ✓）✓　export_handout_text 导出纯文本（当前版本 ✓）✓',
  '【常见说法 → 用哪个工具】',
  '  · 「加一节二、椭圆」→ add_handout_blocks [{type:h1, text:二、椭圆}] ✓',
  '  · 「写个学习目标 / 知识梳理 / 小结」→ add_handout_blocks 对应 type ✓',
  '  · 「再来一道例题」→ search_bank → insert_bank_question_to_handout ✓（手写也行：add_handout_blocks example ✓）',
  '  · 「这道例题的解析改一下」→ edit_handout_text ✓（先看原文 ✓）',
  '  · 「第 5 块删了 / 挪到前面」→ get_handout_outline → arrange_handout_block ✓',
  '  · 「学生版把答案藏起来」→ set_handout_block_render（render: endnote 或 hide，version: student ✓）',
  '  · 「定位到必修一第 3 章第 1 节」→ set_handout_meta ✓',
  '  · 「插一张抛物线」→ insert_handout_figure（kind: parabola，params: {p: 2} ✓）',
  '  · 「打印 / 导出 PDF」→ print_handout ✓　「存一下」→ save_handout ✓',
].join(String.fromCharCode(10))
/* ---------------- 【v1708】few-shot 示例（写进 system ✓ 模型照抄最省事 ✓） ---------------- */

/** 8 组「老师说的话 → 调什么工具、传什么」——放进 system ✓（探针盯着每条都提到真工具 ✓） */
export const HANDOUT_FEWSHOT: string[] = [
  '【照着这些例子做】',
  '· 老师：「加一节二、椭圆的定义」→ add_handout_blocks {blocks:[{type:"h2", text:"二、椭圆的定义"}]} ✓',
  '· 老师：「写个学习目标」→ add_handout_blocks {blocks:[{type:"goal", text:"1. …；2. …"}]} ✓',
  '· 老师：「这道例题的条件里加上 a=3」→ 先 get_handout_state 看原文 → edit_handout_text {find:"…", replace:"…"} ✓（**不要**再加一块 ✗）',
  '· 老师：「第 4 块删掉」→ 先 get_handout_outline 拿块号 → arrange_handout_block {no:4, action:"remove"} ✓',
  '· 老师：「学生版把答案藏起来」→ set_handout_block_render {no:12, render:"endnote", version:"student"} ✓（**绝不删块** ✗）',
  '· 老师：「这节定位到必修一第 3 章第 1 节」→ set_handout_meta {book:"必修一", chapter:"3", section:"1"} ✓',
  '· 老师：「从题库找一道椭圆的题插成例题」→ search_bank {query:"椭圆"} → insert_bank_question_to_handout {id:123, kind:"example"} ✓',
  '· 老师：「插一张抛物线」→ insert_handout_figure {kind:"parabola", params:{p:2}} ✓（别用文字画 ✗）',
  '· 老师：「打印 / 导出 PDF」→ print_handout ✓；「存一下」→ save_handout ✓',
  '· 老师贴来一整份 Markdown → import_handout_markdown（别一块一块手抄 ✗）✓',
  '· 老师：「起一份新授课讲义 / 一轮复习讲义」→ build_handout_skeleton {kind:"新授课"} ✓（别一块一块手搭 ✗）',
  '· 老师：「加课后作业，分 A、B 两层」→ add_handout_blocks {blocks:[{type:"homework", text:"A 组（基础）…；B 组（提升）…"}]} ✓',
  '· 老师：「知识梳理做成填空版 / 学生版挖空」→ 把关键词用两个花括号包起来（现成段落用 edit_handout_text 就地改 ✓ 别删内容 ✗）✓',
  '· 老师：「加个课前预习 / 探究思考 / 方法总结 / 学后反思」→ preview / explore / method / reflect 块 ✓',
]

/** 示例拼成一段（system 里用 ✓） */
export function handoutFewshotText(): string {
  return HANDOUT_FEWSHOT.join(String.fromCharCode(10))
}
