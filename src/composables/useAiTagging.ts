/**
 * 【§49】AI 打标 —— 题库里选中的题 → 自动打「知识点 / 难度档 / 难度 / 板块」。
 *
 * 规格：docs/题库v4-方案.md §49（老师 2026-09-21 选定方向 ①：抽题 / 组卷 / 讲义全卡在标签上）。
 *
 * 四条纪律（都是查过线上库才定的，别改 ✗）：
 *  ① **只填空字段** —— 老师手填过的 kp / level / difficulty / section 一律不覆盖 ✗（§49.3 ②）；
 *  ② 但「导入时补的默认档」**不算老师手填** ✓：withDefaults() 给的是 difficulty=3 + level=中档，
 *     实测线上 156 道**全是** 3/中档 —— 若把默认当"已有"，难度永远打不上，这功能就只剩知识点 ✗。
 *     所以给一个**显式开关**（默认允许覆盖 ✓），关掉即退回严格"只填空字段" ✓；
 *  ③ 难度档只认 App 的受控词表 **基础 / 中档 / 拔高** ✓ —— AI 说"压轴"要归一成"拔高"，
 *     否则难度筛选下拉（LEVELS）里会多出一个点不到的孤儿档 ✗；
 *  ④ 板块同理只认 **SECTIONS 那 11 个** ✓ —— AI 给"第一章 集合与常用逻辑用语"这类章节名时，
 *     走 guessSection 关键词兜底映射 ✓；映不出来就**留空**（宁可未归类，也不写孤儿板块 ✗）。
 *
 * 分工：这一层是**纯函数 + 单题请求**（能无头断言 ✓）；
 *      批量 / 每次 20 道 / 暂停继续 / 预览确认表 / 写库都在 QuestionBankPanel.vue 里 ✓。
 */
import { aiChat, isTauri } from './useTauri'
import { metaOf, stemWithOptions, SECTIONS, type QItem } from './useQuestionBank'
import { guessSection, levelOfDifficulty, normSection } from './useQuestionImport'

/** §49.2 的 system 提示词（**板块 / 难度档换成 App 的受控词表** ✓，其余照原规格 ✓） */
export const AI_TAG_SYSTEM = [
  '你是高中数学教研员。给你一道题，只输出一段 JSON（不要解释、不要代码块）：',
  '{ "kp": ["知识点1"], "level": "基础|中档|拔高", "difficulty": 1-5, "section": "板块" }',
  'kp 用教材术语，2~4 个；level 与 difficulty 要一致（基础≈1-2 / 中档≈3 / 拔高≈4-5，「压轴」一律写「拔高」）；',
  'section 必须从这 11 个板块里选一个：' + SECTIONS.join(' / ') + '；',
  '拿不准的字段留空（kp 给 []、level 给 ""、difficulty 给 0、section 给 ""），不要瞎给。',
].join('\n')

export interface TagAi { kp: string[]; level: string; difficulty: number; section: string }
export interface TagCur { kp: string[]; level: string; difficulty: number; section: string }

/** 难度档的别名 → 受控词表（AI 爱写"压轴 / 中等 / 容易" ✗） */
const LEVEL_ALIAS: Record<string, string> = {
  基础: '基础', 容易: '基础', 简单: '基础', 较易: '基础', 低: '基础', 低档: '基础',
  中档: '中档', 中等: '中档', 中: '中档', 一般: '中档', 中难度: '中档',
  拔高: '拔高', 压轴: '拔高', 难: '拔高', 难题: '拔高', 较难: '拔高', 高: '拔高', 高档: '拔高',
}

/** 档 → 难度（**levelOfDifficulty 的逆** ✓；只在 AI 只给了档、没给难度时用 ✓） */
export function difficultyOfLevel(level: string): number {
  if (level === '基础') return 2
  if (level === '拔高') return 4
  if (level === '中档') return 3
  return 0
}

/** 难度归一：只认 1~5 的整数 ✓（0 / 空 / 说胡话 = 这一栏留空 ✓） */
export function normDifficulty(raw: unknown): number {
  const s = String(raw == null ? '' : raw).replace(/[^\d.]/g, '')
  const n = Math.round(Number(s))
  if (!s || !isFinite(n) || n <= 0) return 0
  return Math.min(5, Math.max(1, n))
}

/** 档归一：别名表 → 受控词表；认不出但有难度 → 按难度推档（两者必须一致 ✓） */
export function normLevel(raw: unknown, difficulty: number): string {
  const k = String(raw == null ? '' : raw).trim()
  if (k) {
    if (LEVEL_ALIAS[k]) return LEVEL_ALIAS[k]
    for (const key of Object.keys(LEVEL_ALIAS)) if (k.indexOf(key) >= 0) return LEVEL_ALIAS[key]
  }
  return difficulty > 0 ? levelOfDifficulty(difficulty) : ''
}

/** 板块归一：受控词表原名（含旧名别名）→ 关键词兜底猜 → 认不出给空串（不猜 ✗） */
export function normSectionAi(raw: unknown, kp: string[] = [], stem = ''): string {
  const v = String(raw == null ? '' : raw).trim()
  if (!v || v === '未分类' || v === '无' || v === '空') return ''
  const direct = normSection(v)
  if (direct && direct !== '未分类') return direct
  // ⚠ 分两趟：**先只看板块那一栏本身** ✓ —— AI 常给"第一章 集合与常用逻辑用语"这种章节名，
  //   若一上来就把知识点/题干拼进来，题干里的"导数"会把分数盖过章节名里的"集合"（实测踩过 ✗）
  const bySelf = guessSection(v)
  if (bySelf) return bySelf
  return guessSection(v + ' ' + (kp || []).join(' ') + ' ' + stem)
}

/** 知识点拆条（中英文逗号 / 顿号 / 分号 / 竖线都当分隔符 ✓）+ 去重 + 单条限长 40（Rust 侧也是 40 ✓） */
export function splitKp(text: string): string[] {
  return Array.from(new Set(
    String(text || '').split(/[，,、;；|]/).map((s) => s.trim()).filter(Boolean).map((s) => (s.length > 40 ? s.slice(0, 40) : s)),
  ))
}

/** 解析模型那一段文本（可能带 ```json 围栏 / 前后废话 ✓）→ 建议；读不懂给原因 ✓ */
export function parseTagJson(raw: string): { tag: TagAi | null; error: string } {
  let s = String(raw || '').trim()
  if (!s) return { tag: null, error: 'AI 回了空内容' }
  s = s.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim()
  const a = s.indexOf('{')
  const b = s.lastIndexOf('}')
  if (a >= 0 && b > a) s = s.slice(a, b + 1)
  let o: Record<string, unknown>
  try { o = JSON.parse(s) as Record<string, unknown> } catch { return { tag: null, error: 'AI 没读懂：回的不是 JSON' } }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { tag: null, error: 'AI 没读懂：JSON 不是对象' }
  const kpRaw = o.kp !== undefined && o.kp !== null ? o.kp : o.knowledge
  const kp = splitKp(Array.isArray(kpRaw) ? kpRaw.map((x) => String(x == null ? '' : x)).join('、') : String(kpRaw == null ? '' : kpRaw)).slice(0, 4)
  let difficulty = normDifficulty(o.difficulty)
  const level = normLevel(o.level, difficulty)
  // 只给了档没给难度 → 按档补（否则库里会出现「档=拔高、难度=3」这种自相矛盾 ✗）
  if (!difficulty && level) difficulty = difficultyOfLevel(level)
  const section = normSectionAi(o.section, kp)
  if (!kp.length && !level && !difficulty && !section) return { tag: null, error: 'AI 没读懂：四个字段全空' }
  return { tag: { kp, level, difficulty, section }, error: '' }
}

/** 导入时补的默认档（withDefaults：difficulty=3 + level=中档 / 空）—— **不是老师手填的** ✓ */
export function isImportDefault(cur: TagCur): boolean {
  const d = Number(cur.difficulty) || 0
  const lv = String(cur.level || '').trim()
  return (d === 0 || d === 3) && (!lv || lv === '中档')
}

export type TagField = 'kp' | 'level' | 'difficulty' | 'section'
export interface TagRow {
  id: number
  code: string
  /** 题干摘要（列表里扫一眼用 ✓ 不带公式噪声） */
  stem: string
  cur: TagCur
  ai: TagAi | null
  /** 非空 = 这一道没成功（接口失败 / AI 没读懂），确认表里要逐条列出来 ✓ */
  err: string
  /** 这一栏要不要写（只填空字段 + 默认档开关 ✓） */
  fill: Record<TagField, boolean>
  /** 不写的理由（界面原样显示，别让老师猜 ✓） */
  keep: Record<TagField, string>
  adopt: boolean
  /** 可逐条改的最终值（空 = 这一栏不写 ✓） */
  edit: { kpText: string; level: string; difficulty: number; section: string }
  /** 已经写进库了（避免重复写 ✓） */
  written?: boolean
}

/**

 * 现有值 + AI 建议 → 确认表的一行（**只填空字段** 的判定全在这里 ✓，界面上不再判一遍 ✓）
 */
export function buildTagRow(
  it: QItem,
  res: { ai: TagAi | null; err: string },
  opt: { overwriteDefault: boolean; stem?: string },
): TagRow {
  const cur: TagCur = {
    kp: Array.isArray(it.kp) ? it.kp.filter(Boolean) : [],
    level: String(it.level || '').trim(),
    difficulty: Number(it.difficulty) || 0,
    section: String(it.section || '').trim(),
  }
  const ai = res.ai
  const fill: Record<TagField, boolean> = { kp: false, level: false, difficulty: false, section: false }
  const keep: Record<TagField, string> = { kp: '', level: '', difficulty: '', section: '' }
  if (ai) {
    // ① 知识点：有就一律不覆盖 ✓
    if (cur.kp.length) keep.kp = '已有知识点，不覆盖'
    else if (ai.kp.length) fill.kp = true
    else keep.kp = 'AI 没给'
    // ② 板块：有就一律不覆盖 ✓
    if (cur.section) keep.section = '已有板块，不覆盖'
    else if (ai.section) fill.section = true
    else keep.section = 'AI 没给（或不是这 11 个板块）'
    // ③ 难度 / 难度档：老师填过的一律不动 ✗；导入默认档看开关 ✓
    const teacherSet = !isImportDefault(cur)
    const onlyDefault = isImportDefault(cur) && (cur.difficulty > 0 || !!cur.level)
    if (teacherSet) {
      keep.difficulty = '老师填过，不覆盖'
      keep.level = '老师填过，不覆盖'
    } else if (onlyDefault && !opt.overwriteDefault) {
      keep.difficulty = '导入默认档 3 / 中档（没开覆盖）'
      keep.level = keep.difficulty
    } else {
      if (ai.difficulty) fill.difficulty = true
      else keep.difficulty = 'AI 没给'
      if (ai.level) fill.level = true
      else keep.level = 'AI 没给'
    }
  }
  const row: TagRow = {
    id: Number(it.id),
    code: String(it.code || ''),
    stem: String(opt.stem || ''),
    cur,
    ai,
    err: String(res.err || ''),
    fill,
    keep,
    adopt: !!ai && !res.err,
    edit: {
      kpText: fill.kp && ai ? ai.kp.join('、') : '',
      level: fill.level && ai ? ai.level : '',
      difficulty: fill.difficulty && ai ? ai.difficulty : 0,
      section: fill.section && ai ? ai.section : '',
    },
  }
  return row
}

/** 采纳的这一行 → lib_q_patch 的 patch；返回 null = 没有可写的 ✓ */
export function patchOfTagRow(r: TagRow): Record<string, unknown> | null {
  const p: Record<string, unknown> = {}
  const kp = splitKp(r.edit.kpText)
  if (kp.length) p.knowledge = kp
  const lv = String(r.edit.level || '').trim()
  if (lv) p.level = lv
  const d = normDifficulty(r.edit.difficulty)
  if (d) p.difficulty = d
  const sec = normSectionAi(r.edit.section, kp, r.stem)
  if (sec) p.section = sec
  return Object.keys(p).length ? p : null
}

/** 这一行打算写的字段（界面显示「将写：知识点 / 难度」用 ✓） */
export function fieldsOfPatch(p: Record<string, unknown> | null): string[] {
  if (!p) return []
  const label: Record<string, string> = { knowledge: '知识点', level: '难度档', difficulty: '难度', section: '板块' }
  return Object.keys(p).map((k) => label[k] || k)
}

/** 一道题交给模型的正文（题干 + 选项 [+ 答案]）；**限长**省 token ✓ */
export function userTextOf(it: QItem): string {
  const m = metaOf(it)
  // ⚠ 截断要先截题干、**后拼答案** ✓ —— 反过来写，长题干的答案永远被切掉 ✗（答案对判难度有用 ✓）
  const full = stemWithOptions(it)
  let t = full.length > 1300 ? full.slice(0, 1300) + '…（已截断）' : full
  const ans = String(m.answer || '').trim()
  if (ans) t += '\n答案：' + ans
  if (t.length > 1500) t = t.slice(0, 1500)
  return t
}

/** 桌面端才有 AI（网页端直连会被 CORS 挡 ✗，与 3D 生成同一条理由 ✓） */
export function aiReady(): boolean {
  return isTauri()
}

export interface TagOneResult { ai: TagAi | null; err: string }

/**
 * 一道题 → 建议。**解析失败自动重试一次** ✓（§49.3 ④）；
 * 接口失败（Key 不对 / 网络）不重试 —— 重试还是同一个错，白花钱 ✓
 */
export async function tagOne(it: QItem, apiKey: string): Promise<TagOneResult> {
  const userText = userTextOf(it)
  let err = ''
  for (let attempt = 1; attempt <= 2; attempt++) {
    let r
    try {
      r = await aiChat({ apiKey, system: AI_TAG_SYSTEM, userText })
    } catch (e) {
      return { ai: null, err: '接口失败：' + String((e as Error)?.message || e) }
    }
    if (!r || !r.ok) return { ai: null, err: '接口失败：' + String((r && r.error) || '未知错误') }
    const ps = parseTagJson(String(r.content || ''))
    if (ps.tag) return { ai: ps.tag, err: '' }
    err = ps.error
  }
  return { ai: null, err: err + '（自动重试一次仍没读懂）' }
}
