/**
 * 【v1708】讲义 AI 的「训练材料」：**容错 + 示例 + 评分**（全部纯函数 ✓ 探针覆盖 ✓）
 *
 * 用户口径：「你自己开始训练讲义AI吧」—— 但 AI Key 只在你本机 ✗（我这边调不了真模型 ✓），
 *   所以把「训练」拆成三件**能离线做实、且能在有 key 时直接评分**的事 ✓：
 *   ① 容错：模型爱写的样子（中文块名 / 单对象 / content 字段 / Markdown # / 试卷语法）都捋成讲义认的样子 ✓
 *   ② 示例：把「老师怎么说 → 调哪个工具、传什么」写成 few-shot 塞进 system（模型照抄最省事 ✓）
 *   ③ 评分：24 条真实口吻的用例 + 打分器 —— 有 key 时用 .probe/_hdtrain.cjs 跑一遍就知道几分 ✓
 */
import { HANDOUT_BLOCK_TYPES, handoutBlockSpecs, type HandoutBlockSpecIn } from '@/composables/aiHandoutChat'

/* ---------------- ① 容错：别名表 ---------------- */

/** 中文 / 别名 → 块类型（模型常直接写「例题」而不是 example ✗） */
export const HANDOUT_TYPE_ALIAS: Record<string, string> = {
  '章': 'h1', '章标题': 'h1', '一级标题': 'h1', '大标题': 'h1',
  '节': 'h2', '节标题': 'h2', '二级标题': 'h2', '小标题': 'h2',
  '正文': 'para', '段落': 'para', '文字': 'para',
  '公式': 'formula', '公式块': 'formula',
  '插图': 'figure', '图片': 'figure', '图': 'figure', '数学图形': 'figure',
  '分页': 'pagebreak', '换页': 'pagebreak', '另起一页': 'pagebreak',
  '目标': 'goal', '学习目标': 'goal', '教学目标': 'goal',
  '知识': 'knowledge', '知识梳理': 'knowledge', '知识点': 'knowledge',
  '例题': 'example', '例': 'example',
  '变式': 'variant', '变式题': 'variant',
  '练习': 'exercise', '当堂练习': 'exercise', '习题': 'exercise',
  '小结': 'summary', '归纳小结': 'summary', '总结': 'summary',
  '提示': 'note', '注意': 'note', '说明': 'note',
  '警示': 'warn', '易错': 'warn', '易错警示': 'warn', '警告': 'warn',
  '答案': 'answer', '参考答案': 'answer',
  '解析': 'solution', '解答': 'solution',
  '留白': 'blank', '空白': 'blank', '做笔记': 'blank',
}
/** 显示口径别名 ✓ */
export const HANDOUT_RENDER_ALIAS: Record<string, string> = {
  '显示': 'inline', '正常': 'inline', '正常显示': 'inline',
  '隐藏': 'hide', '不显示': 'hide', '藏起来': 'hide',
  '留白': 'blank', '空白': 'blank',
  '文末': 'endnote', '排到文末': 'endnote', '末尾': 'endnote', '最后': 'endnote',
}
/** 学生版 / 教师版别名 ✓ */
export const HANDOUT_VERSION_ALIAS: Record<string, string> = {
  '学生版': 'student', '学生': 'student', 'student': 'student',
  '教师版': 'teacher', '教师': 'teacher', 'teacher': 'teacher',
}
/** 插题的口径别名（example / exercise / variant ✓） */
export const HANDOUT_KIND_ALIAS: Record<string, string> = {
  '例题': 'example', '例': 'example', 'example': 'example',
  '练习': 'exercise', '当堂练习': 'exercise', '习题': 'exercise', 'exercise': 'exercise',
  '变式': 'variant', '变式题': 'variant', 'variant': 'variant',
}
/** 块操作别名 ✓ */
export const HANDOUT_ACTION_ALIAS: Record<string, string> = {
  '删': 'remove', '删除': 'remove', '删掉': 'remove', '去掉': 'remove', '移除': 'remove', '拿掉': 'remove', 'remove': 'remove',
  '上移': 'up', '往上': 'up', '前移': 'up', '挪到前面': 'up', '提到前面': 'up', 'up': 'up',
  '下移': 'down', '往后': 'down', '后移': 'down', '挪到后面': 'down', 'down': 'down',
  '选中': 'select', '选定': 'select', 'select': 'select',
}

/** 认块类型：英文键 / 中文标签 / 别名都认 ✓（认不出返回空串 ✗） */
export function guessBlockType(v: unknown): string {
  const s = String(v == null ? '' : v).trim()
  if (!s) return ''
  if (HANDOUT_BLOCK_TYPES.indexOf(s) >= 0) return s
  const low = s.toLowerCase()
  if (HANDOUT_BLOCK_TYPES.indexOf(low) >= 0) return low
  if (HANDOUT_TYPE_ALIAS[s]) return HANDOUT_TYPE_ALIAS[s]
  const head = s.replace(/[（(].*$/, '').trim()
  return HANDOUT_TYPE_ALIAS[head] || ''
}
/** 认显示口径 / 版本 / 口径 / 动作 ✓（表里查不到就原样返回 ✓ 交给下游校验 ✗） */
export function guessRender(v: unknown): string {
  const s = String(v == null ? '' : v).trim()
  if (!s) return ''
  if (s === 'inline' || s === 'hide' || s === 'blank' || s === 'endnote') return s
  return HANDOUT_RENDER_ALIAS[s] || s
}
export function guessVersion(v: unknown): string {
  const s = String(v == null ? '' : v).trim()
  return HANDOUT_VERSION_ALIAS[s] || s
}
export function guessKind(v: unknown): string {
  const s = String(v == null ? '' : v).trim()
  return HANDOUT_KIND_ALIAS[s] || (s || 'example')
}
export function guessAction(v: unknown): string {
  const s = String(v == null ? '' : v).trim()
  return HANDOUT_ACTION_ALIAS[s] || s
}

/* ---------------- ② 把「模型爱写的正文」拆成块 ---------------- */

/** 试卷语法 / 段落样式的标记（讲义不认 ✗ —— 认出来要**去掉并说明** ✓，别原样印到讲义上 ✗） */
export const PAPER_SYNTAX_MARKS = ['[题]', '[/题]', '[选项]', '[解析]']

/**
 * 一段「模型写的正文」→ 讲义块 ✓（纯函数 ✓）
 * 认这几种：`# 章` / `## 节` / `[分页]` / 试卷标记 / `{c:red}` 段落样式 ✓
 * 返回的 blocks 全是**合法类型** ✓，清掉的东西都写进 notes ✓（模型看得到就改得对 ✓）
 */
export function splitHandoutText(text: string): { blocks: { type: string; text: string }[]; notes: string[] } {
  const blocks: { type: string; text: string }[] = []
  const notes: string[] = []
  let t = String(text == null ? '' : text).replace(/\r\n/g, String.fromCharCode(10))
  const hadPaper = PAPER_SYNTAX_MARKS.filter((m) => t.indexOf(m) >= 0)
  if (hadPaper.length) {
    notes.push('讲义不认试卷语法：已去掉 ' + hadPaper.join(' ') + ' ✗（讲义用**块**组织内容 ✓）')
    for (const m of hadPaper) t = t.split(m).join(String.fromCharCode(10))
  }
  if (/\{\s*[a-z]\s*:/.test(t)) {
    const before = t.length
    t = t.replace(/\{\s*[a-z]\s*:[^}]*\}/gi, '').replace(/\{\s*\/[^}]*\}/gi, '')
    if (t.length !== before) notes.push('讲义不支持 {c:red} 这类段落样式：已去掉 ✗（要强调就单独放一个 note / warn 块 ✓）')
  }
  const lines = t.split(String.fromCharCode(10))
  let buf: string[] = []
  const flush = (type: string) => {
    const body = buf.join(String.fromCharCode(10)).trim()
    buf = []
    if (body) blocks.push({ type, text: body })
  }
  for (const line of lines) {
    const s = line.trim()
    if (!s) { buf.push(''); continue }
    if (s === '[分页]' || s === '[换页]' || s === '---' || s === '***') { flush('para'); blocks.push({ type: 'pagebreak', text: '' }); continue }
    const h = /^(#{1,3})\s+(.*)$/.exec(s)
    if (h) {
      flush('para')
      blocks.push({ type: h[1].length === 1 ? 'h1' : 'h2', text: h[2].trim() })
      continue
    }
    buf.push(line)
  }
  flush('para')
  if (hadPaper.length && blocks.length === 1 && blocks[0].type === 'para') {
    notes.push('（这本来是道题？讲义里请用 example 例题 / exercise 练习块 ✓）')
  }
  return { blocks, notes }
}

/**
 * 【v1708】宽松版块规格：模型给的样子**先捋顺**，再交给严格校验 ✓
 *  · 单个对象（不是数组）也收 ✓　· 纯字符串当正文 ✓
 *  · type 用中文标签也认 ✓　· 正文写成 content / body / 正文 也认 ✓
 *  · render 写成 "隐藏" / 单个字符串 也认 ✓
 *  · 正文里混了 Markdown # 或试卷语法 → **拆成多块**并说明 ✓
 */
export function handoutBlockSpecsLoose(raw: unknown): { specs: HandoutBlockSpecIn[]; errors: string[]; fixed: string[] } {
  const fixed: string[] = []
  const list0 = raw == null ? [] : (Array.isArray(raw) ? raw : [raw])
  if (raw != null && !Array.isArray(raw)) fixed.push('blocks 给的不是数组 → 当成一块收下 ✓')
  const norm: Record<string, unknown>[] = []
  for (const it of list0) {
    if (typeof it === 'string') { norm.push({ type: 'para', text: it }); fixed.push('纯字符串当成正文块 ✓'); continue }
    if (!it || typeof it !== 'object') { norm.push({}); continue }
    const o = { ...(it as Record<string, unknown>) }
    const t = guessBlockType(o.type)
    if (t && t !== o.type) { fixed.push('块类型「' + String(o.type) + '」按 ' + t + ' 认 ✓'); o.type = t }
    if (o.text === undefined) {
      for (const k of ['content', 'body', '正文', 'md', 'markdown', 'value']) {
        if (o[k] !== undefined) { o.text = o[k]; fixed.push('正文取了「' + k + '」字段 ✓'); break }
      }
    }
    if (typeof o.render === 'string') {
      const g = guessRender(o.render)
      if (g) { o.render = { student: g, teacher: g }; fixed.push('显示口径「' + String(o.render) + '」→ 两版都设 ' + g + ' ✓') }
    } else if (o.render && typeof o.render === 'object') {
      const r = { ...(o.render as Record<string, unknown>) }
      for (const v of ['student', 'teacher']) { if (r[v] !== undefined) r[v] = guessRender(r[v]) }
      o.render = r
    }
    norm.push(o)
  }
  // 正文里混了 Markdown / 试卷语法 → 拆成多块 ✓
  const flat: Record<string, unknown>[] = []
  for (const o of norm) {
    const t = String(o.type || '')
    const text = String(o.text == null ? '' : o.text)
    const messy = (t === 'para' || t === 'formula' || t === '') && (
      /(^|\n)\s*#{1,3}\s/.test(text) || text.indexOf('[分页]') >= 0 || text.indexOf('[换页]') >= 0
      || text.indexOf('[题]') >= 0 || /\{\s*[a-z]\s*:/.test(text)
    )
    if (!messy) { flat.push(o); continue }
    const sp = splitHandoutText(text)
    if (sp.notes.length) fixed.push(...sp.notes)
    if (sp.blocks.length > 1) fixed.push('这一段里的标题 / 分页拆成了 ' + sp.blocks.length + ' 块 ✓')
    for (const b of sp.blocks) flat.push({ ...o, type: b.type, text: b.text })
    if (!sp.blocks.length) fixed.push('这一块清完是空的 → 没收 ✓')
  }
  const strict = handoutBlockSpecs(flat)
  return { specs: strict.specs, errors: strict.errors, fixed }
}

/* ---------------- ③ 训练用例 + 打分器（有 key 时用 .probe/_hdtrain.cjs 跑 ✓） ---------------- */

export interface HandoutTrainCase {
  id: string
  /** 老师的原话（口语 ✓ 就是真机上会说的那种 ✓） */
  ask: string
  /** 期望它调的工具 ✓ */
  tool: string
  /** 期望参数里的要点（只比这些键 ✓） */
  args?: Record<string, unknown>
  /** 这些工具**不该**被调 ✗（比如「藏答案」不该删块 ✓） */
  forbid?: string[]
  why: string
}

/** 24 条：覆盖 17 个工具，且每条都是「老师真会这么说」的口吻 ✓ */
export const HANDOUT_TRAIN_CASES: HandoutTrainCase[] = [
  { id: 'c01', ask: '加一节「二、椭圆的定义」', tool: 'add_handout_blocks', args: { blocks: ['h2'] }, why: '章节标题走 add_handout_blocks（h2 节 ✓）' },
  { id: 'c02', ask: '写个学习目标，三条', tool: 'add_handout_blocks', args: { blocks: ['goal'] }, why: '学习目标 = goal 块 ✓' },
  { id: 'c03', ask: '加一段知识梳理：椭圆的定义…', tool: 'add_handout_blocks', args: { blocks: ['knowledge'] }, why: '知识梳理 = knowledge ✓' },
  { id: 'c04', ask: '再来一道例题，随便出一道椭圆的', tool: 'add_handout_blocks', args: { blocks: ['example'] }, why: '手写例题 = example 块 ✓' },
  { id: 'c05', ask: '最后放个归纳小结', tool: 'add_handout_blocks', args: { blocks: ['summary'] }, why: '小结 = summary ✓' },
  { id: 'c06', ask: '这题太绕了，加个易错警示', tool: 'add_handout_blocks', args: { blocks: ['warn'] }, why: '易错警示 = warn ✓' },
  { id: 'c07', ask: '给我留 6 厘米让学生写解答', tool: 'add_handout_blocks', args: { blocks: ['blank'] }, why: '留白 = blank + blankCm ✓' },
  { id: 'c08', ask: '这段后面另起一页', tool: 'add_handout_blocks', args: { blocks: ['pagebreak'] }, why: '分页 = pagebreak 块 ✓（不是 [分页] ✗）' },
  { id: 'c09', ask: '这道例题的条件里加上 a=3', tool: 'edit_handout_text', args: { find: '' }, why: '改现有内容 = 就地改 ✓（不该再加一块 ✗）', forbid: ['add_handout_blocks'] },
  { id: 'c10', ask: '第 4 块删掉', tool: 'arrange_handout_block', args: { no: 4, action: 'remove' }, why: '先看大纲拿块号 ✓ 再按块号删 ✓' },
  { id: 'c11', ask: '把第 7 块往上挪一格', tool: 'arrange_handout_block', args: { no: 7, action: 'up' }, why: '按块号上移 ✓' },
  { id: 'c12', ask: '学生版把答案藏起来', tool: 'set_handout_block_render', args: { render: 'endnote' }, why: '改显示口径 ✓（排到文末）✗ 绝不能删块 ✗', forbid: ['arrange_handout_block'] },
  { id: 'c13', ask: '教师版里解析直接显示出来', tool: 'set_handout_block_render', args: { render: 'inline', version: 'teacher' }, why: '两版口径分开设 ✓' },
  { id: 'c14', ask: '这一节的知识梳理在学生版做成填空', tool: 'set_handout_block_render', args: { render: 'blank', version: 'student' }, why: '留白 = blank 口径 ✓' },
  { id: 'c15', ask: '切到学生版看看', tool: 'set_handout_version', args: { version: 'student' }, why: '只是切版本 ✓ 不改内容 ✓', forbid: ['set_handout_block_render'] },
  { id: 'c16', ask: '定位到人教必修一第 3 章第 1 节', tool: 'set_handout_meta', args: { press: '人教版', book: '必修一' }, why: '教材定位走 meta ✓（press/book 只认清单里的 ✓）' },
  { id: 'c17', ask: '标题改成「椭圆的切线问题」', tool: 'set_handout_meta', args: { title: '' }, why: '标题也是 meta ✓（手改后自动标题关闭 ✓）' },
  { id: 'c18', ask: '从题库找一道椭圆的题插成例题', tool: 'insert_bank_question_to_handout', args: { kind: 'example' }, why: '先 search_bank 拿 id ✓ 再插 ✓' },
  { id: 'c19', ask: '抽 5 道中档的圆锥曲线当堂练习', tool: 'draw_bank_questions_to_handout', args: { n: 5, pool: 'exercise' }, why: '抽题成池 ✓ pool=exercise ✓' },
  { id: 'c20', ask: '题库里搜一下「双曲线 渐近线」', tool: 'search_bank', args: { query: '' }, why: '先在题库里搜 ✓' },
  { id: 'c21', ask: '插一张抛物线', tool: 'insert_handout_figure', args: { kind: 'parabola' }, why: '数学图形走 insert_handout_figure ✓（不许用文字画 ✗）' },
  { id: 'c22', ask: '我刚在题库里把第 12 题改了，讲义里也跟着更新', tool: 'sync_handout_refs', why: '引用的块按题库刷新 ✓' },
  { id: 'c23', ask: '打印出来，顺便存成 PDF', tool: 'print_handout', why: '打印 / 另存 PDF ✓' },
  { id: 'c24', ask: '这份讲义存一下，别丢了', tool: 'save_handout', why: '马上存一次 ✓' },
  { id: 'c25', ask: '现在讲义里都有什么？', tool: 'get_handout_state', why: '动手前先读一遍 ✓' },
  { id: 'c26', ask: '讲义都支持哪些块类型？', tool: 'get_handout_help', why: '写细节前先查手册 ✓' },
  { id: 'c27', ask: '第 3 块是什么内容？', tool: 'get_handout_outline', args: {}, why: '按块号办事先看大纲 ✓' },
  { id: 'c28', ask: '导出一份纯文本给我', tool: 'export_handout_text', why: '导出纯文本 ✓' },
]

export interface HandoutTrainCall { name: string; args?: Record<string, unknown> }

/** 期望参数里的一个值算不算对上（数字按 1 起、字符串去空白、数组只看元素个数与首元素 ✓） */
function argHit(want: unknown, got: unknown): boolean {
  if (Array.isArray(want)) {
    if (!Array.isArray(got)) return false
    if (got.length !== want.length) return false
    return want.every((w, i) => argHit(w, got[i]))
  }
  if (typeof want === 'number') {
    const g = Number(got)
    return Number.isFinite(g) && Math.round(g) === Math.round(want)
  }
  const w = String(want == null ? '' : want).trim()
  const g = String(got == null ? '' : got).trim()
  if (!w) return g.length > 0                 // 空串 = "随便给个非空值就行" ✓
  return g === w || g.indexOf(w) >= 0
}

/**
 * 给一次模型回答打分 ✓（纯函数 ✓ 探针能直接验「喂对的调用得 1 分、喂错的得 0 分" ✓）
 *  · 该调的工具没调 → 0 分
 *  · 调了明令不该调的（比如「藏答案」却去删块 ✗）→ 0.5 分以下
 *  · 参数要点对不上 → 每条扣 0.2 ✓
 */
export function scoreHandoutCase(c: HandoutTrainCase, calls: HandoutTrainCall[]): { ok: boolean; score: number; why: string } {
  const list = Array.isArray(calls) ? calls : []
  const hit = list.find((x) => x && x.name === c.tool)
  if (!hit) {
    const names = list.map((x) => (x ? x.name : '')).filter(Boolean)
    return { ok: false, score: 0, why: '没调 ' + c.tool + (names.length ? '（调的是 ' + names.join('、') + '）' : '（一个工具都没调）') }
  }
  const bad = (c.forbid || []).filter((f) => list.some((x) => x && x.name === f))
  const argsWanted = Object.keys(c.args || {})
  const missed = argsWanted.filter((k) => !argHit((c.args || {})[k], (hit.args || {})[k]))
  let score = 1
  if (missed.length) score -= Math.min(0.6, 0.2 * missed.length)
  if (bad.length) score -= 0.5
  score = Math.max(0, Math.round(score * 100) / 100)
  const why = [
    '调了 ' + c.tool + ' ✓',
    missed.length ? '参数要点没对上：' + missed.join('、') + ' ✗' : '参数要点齐 ✓',
    bad.length ? '不该调的也调了：' + bad.join('、') + ' ✗' : '',
  ].filter(Boolean).join('；')
  return { ok: score >= 0.8 && !bad.length, score, why }
}

/** 一组回答的总分（0–100 ✓） */
export function scoreHandoutRun(cases: HandoutTrainCase[], picks: (HandoutTrainCall[] | null)[]): { total: number; passed: number; rows: { id: string; score: number; why: string }[] } {
  const rows = (cases || []).map((c, i) => {
    const r = scoreHandoutCase(c, picks && picks[i] ? picks[i] as HandoutTrainCall[] : [])
    return { id: c.id, score: r.score, why: r.why }
  })
  const passed = rows.filter((r) => r.score >= 0.8).length
  const total = rows.length ? Math.round((rows.reduce((s, r) => s + r.score, 0) / rows.length) * 100) : 0
  return { total, passed, rows }
}
/** 【v1708b】"标准答案"调用：把期望里的空串（表示"随便给个非空值"）换成占位样本 ✓
 *  —— 探针 / 训练脚本自查"喂对的调用该满分"时用它 ✓（直接喂 c.args 会因为空串判不过 ✗） */
const ARG_PLACEHOLDER: Record<string, string> = {
  find: '（先看原文再改）', replace: '（改后的内容）', query: '椭圆', title: '椭圆的切线问题', text: '（正文内容）',
}
export function standardCall(c: HandoutTrainCase): HandoutTrainCall {
  const args: Record<string, unknown> = {}
  const want = c.args || {}
  for (const k of Object.keys(want)) {
    const v = want[k]
    if (typeof v === 'number' || Array.isArray(v)) { args[k] = v; continue }
    const s = String(v == null ? '' : v).trim()
    args[k] = s || ARG_PLACEHOLDER[k] || '示例值'
  }
  return { name: c.tool, args }
}

/** 一份「人看的」训练报告（有 key 跑完 .probe/_hdtrain.cjs 会写出 ✓） */
export function handoutTrainReport(run: { total: number; passed: number; rows: { id: string; score: number; why: string }[] }, cases: HandoutTrainCase[]): string {
  const NL2 = String.fromCharCode(10)
  const head = '讲义 AI 训练报告：' + run.passed + '/' + (cases || []).length + ' 题达标，总分 ' + run.total + ' 分'
  const rows = (run.rows || []).map((r) => {
    const c = (cases || []).find((x) => x.id === r.id)
    return '· ' + r.id + '（' + ((c && c.ask) || '') + '）' + (r.score >= 0.8 ? ' ✓ ' : ' ✗ ') + r.score + ' —— ' + r.why
  })
  return [head, '', ...rows].join(NL2)
}

