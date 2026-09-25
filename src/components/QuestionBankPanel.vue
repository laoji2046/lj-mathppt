<script setup lang="ts">
/**
 * 试题库 · 新窗口（v2 设计 M2）
 *
 * 版式：左树（章节 / 知识点）+ 中间题卡列表 + 右边预览与就地编辑 ✓
 * 位置：工具栏「文件 → 试题库」打开（旧的 QuestionBankDialog 已在 v1439 整体移除）
 *
 * 纪律：
 *  - 这一屏**不碰画布**：只读写内容库（lib_q_*）✓
 *  - 筛选用 SQL 做（facets/search），界面不做全量过滤 ✓
 *  - 保存后**就地更新那一条 + 重算计数**，不整屏重载（免得滚动位置丢失 ✗）
 */
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { typesetMixed } from '@/composables/useMathJax'
import {
  SECTIONS, QTYPE_LABEL, LEVELS, STATUS_ORDER, statusLabel,
  qFacets, qSearch, qPatch, qBatch, metaOf, excerptOf, previewHtmlOf,
  questionTextOf, stripImageMarkers, pickImages, sourceReport, kpCatalog, sourcePlan, sourcePlanApply,
  firstUserDir, exportVault,
} from '@/composables/useQuestionBank'
import type { QFacets, QFilter, QItem, SourceReport, SourcePlan } from '@/composables/useQuestionBank'
import { applyAnswerBackfill, scanAnswerBackfill } from '@/composables/useAnswerBackfill'
import { aiReady, buildTagRow, fieldsOfPatch, patchOfTagRow, tagOne, type TagAi, type TagRow } from '@/composables/useAiTagging'
import { openFigPalette } from '@/ui/figPalette'
import { geom3dOpen, geom3dSink, openGeom3D } from '@/ui/geom3d'
import { svgTextToPngUrl, svgToPngUrl } from '@/composables/svgPng'
import type { QuestionImage } from '@/composables/parseQuestions'
import type { AnsScan } from '@/composables/useAnswerBackfill'

/** 试题录入（M4）：体量不小，按需加载 ✓ */
const QuestionImportDialog = defineAsyncComponent(() => import('./QuestionImportDialog.vue'))
/** 草稿箱（v5 · P1b）：AI / OCR 的产出先落这里，人工确认后才进正式库 ✓ */
const DraftBox = defineAsyncComponent(() => import('./DraftBox.vue'))
import { isTauri } from '@/composables/useTauri'
import { useDeckStore } from '@/stores/deck'
import { sendToPaper } from '@/ui/paper'
import type { SlideElement } from '@/types'

const emit = defineEmits<{ (e: 'close'): void }>()

/** 【v1530】浏览器预览里没有 SQLite 真库（题只落在 localStorage 的降级库）
 *  —— 面板上明说一句，别让人把预览库的数当真库的数 ✓ */
const isPreview = !isTauri()

const facets = ref<QFacets>({ total: 0, bySection: {}, byQtype: {}, byLevel: {}, byYear: {}, byPaper: {}, byKp: {}, byStatus: {}, bySourceKind: {}, warned: 0, missing: { section: 0, answer: 0, kp: 0, year: 0, paper: 0, code: 0 } })
const items = ref<QItem[]>([])
const total = ref(0)
const selId = ref(0)
const busy = ref(false)
const msg = ref('')
const previewHost = ref<HTMLElement | null>(null)
/** 录入窗口开没开（M4） */
const importOpen = ref(false)
/** 草稿箱开没开（v5 · P1b） */
const draftOpen = ref(false)
/** 最近一次批量删除前 Rust 侧留的整库备份路径（hover 可看全路径）✓ */
const lastBackup = ref('')

/* ---------------- 【P0b】来源报告 + 受控词表 ---------------- */
/** 来源报告开没开 / 报告内容（后端算好，前端只负责显示 ✓） */
const reportOpen = ref(false)
const report = ref<SourceReport | null>(null)
const reportBusy = ref(false)
/** 知识点输入建议（来自 kp_catalog，只取板块级 knowledge）✓ */
const kpOptions = ref<string[]>([])

async function openReport() {
  reportOpen.value = true
  reportBusy.value = true
  try {
    report.value = await sourceReport()
    await loadPlan()
  } finally {
    reportBusy.value = false
  }
}

/* ---------------- 【优化】补答案：从录入时的产物缓存重新拆（纯本地、只补不覆盖 ✓） ---------------- */
const ansOpen = ref(false)
const ansBusy = ref(false)
const ansMsg = ref('')
const ansScan = ref<AnsScan | null>(null)
const ansPicked = ref<Record<number, boolean>>({})

function ansPickedN(): number {
  return ansScan.value ? ansScan.value.candidates.filter((c) => ansPicked.value[c.id]).length : 0
}

async function openAnswerFill() {
  ansOpen.value = true
  ansBusy.value = true
  ansScan.value = null
  ansMsg.value = '正在扫描产物缓存…'
  try {
    const r = await scanAnswerBackfill((d, t) => { ansMsg.value = '正在扫描产物缓存… ' + d + '/' + t })
    ansScan.value = r
    const p: Record<number, boolean> = {}
    for (const c of r.candidates) p[c.id] = true
    ansPicked.value = p
    ansMsg.value =
      '扫了 ' + r.caches + ' 份产物缓存（' + r.cachesWithAns + ' 份含答案 · 共 ' + r.answers + ' 条），库里 ' +
      r.questions + ' 题、缺答案 ' + r.missing + ' 题 → 可补 ' + r.candidates.length + ' 题'
  } catch (e) {
    ansMsg.value = '扫描失败：' + String((e as Error)?.message || e)
  } finally {
    ansBusy.value = false
  }
}

function toggleAns(id: number) {
  ansPicked.value = { ...ansPicked.value, [id]: !ansPicked.value[id] }
}

async function doAnswerFill() {
  const list = (ansScan.value ? ansScan.value.candidates : []).filter((c) => ansPicked.value[c.id])
  if (!list.length) { ansMsg.value = '没勾选任何题'; return }
  ansBusy.value = true
  try {
    const r = await applyAnswerBackfill(list)
    ansMsg.value = r.ok
      ? '已补 ' + r.updated + ' 题（跳过 ' + r.skipped + ' 题：题里本来就有答案）· 备份 ' + String(r.backup || '').split('\\').pop()
      : '补失败：' + (r.error || '')
    if (r.ok) await reload()
  } finally {
    ansBusy.value = false
  }
}

/* ---------------- 【§49】AI 打标：批量打知识点 / 难度 / 板块 ---------------- */
/**
 * 规格见 docs/题库v4-方案.md §49。要点：
 *  - 对象 = **勾选的题**（一道没勾 = 当前筛选全部 ✓，即「按当前筛选全选」）；
 *  - 每次跑 **20 道**就停一下（可暂停 / 继续 ✓）—— 省 token，也方便中途看结果 ✓；
 *  - 结果先落**预览确认表**（题号 | 题干摘要 | 现有标签 | AI 建议 | 是否采纳），确认后才写库 ✓；
 *  - 写库走 lib_q_patch（每道一份 revision 快照，可回退 ✓），**只填空字段** ✓
 *    （老师手填过的一律不覆盖 ✗；导入时补的默认档 3/中档 由开关决定 ✓）；
 *  - 失败逐条列出、绝不静默跳过 ✗（接口错 / AI 没读懂分开写清楚 ✓）。
 */
const AI_KEY = 'lj-mathslides:ai-key'
const AI_BATCH = 20
const AI_SECTIONS = SECTIONS.filter((s) => s !== '未分类')
const aiOpen = ref(false)
const aiBusy = ref(false)
const aiMsg = ref('')
const aiItems = ref<QItem[]>([])
const aiRes = ref<Record<number, { ai: TagAi | null; err: string }>>({})
const aiRows = ref<TagRow[]>([])
const aiIdx = ref(0)
/** 暂停请求：跑完手上这一道就停 ✓（不做硬中断 ✗ —— 半路掐断会留下不明不白的结果） */
const aiStop = ref(false)
/** 覆盖「导入时补的默认难度（3 / 中档）」—— 关掉即退回严格「只填空字段」✓ */
const aiOverwrite = ref(true)
/** 老师逐条改过的值（重建表格时按 id 盖回去 ✓） */
const aiEdited = ref<Record<number, Partial<{ kpText: string; level: string; difficulty: number; section: string; adopt: boolean }>>>({})

function aiKeyOf(): string {
  try { return (localStorage.getItem(AI_KEY) || '').trim() } catch { return '' }
}
/** 打标对象：勾了用勾的；一道没勾 = 当前筛选全部 ✓ */
function aiTargets(): QItem[] { return pickedList.value.length ? pickedList.value : items.value }

/**
 * 老师说"改过了"的值 —— ⚠ **只能由交互事件记** ✓，绝不能用 watch 记 ✗：
 *   watch 会把「还没跑 AI 时的空值」也当成"老师改成了空"，一跑完就被盖回去
 *   （表现为：明明有建议，表里却全空、采纳也不勾 ✗ —— v5002 探针当场抓到 ✓）。
 */
function noteAiEdit(r: TagRow) {
  aiEdited.value = {
    ...aiEdited.value,
    [r.id]: { kpText: r.edit.kpText, level: r.edit.level, difficulty: r.edit.difficulty, section: r.edit.section, adopt: r.adopt },
  }
}
/** 这一道拿到**新结果**了 → 把旧的"老师改过值"清掉（以新建议为准 ✓） */
function clearAiEdit(id: number) {
  if (aiEdited.value[id] === undefined) return
  const m = { ...aiEdited.value }
  delete m[id]
  aiEdited.value = m
}

/** 用现有 AI 结果重建确认表（老师改过的值按 id 盖回来 ✓） */
function rebuildAiRows() {
  aiRows.value = aiItems.value.map((it) => {
    const row = buildTagRow(
      it,
      aiRes.value[Number(it.id)] || { ai: null, err: '' },
      { overwriteDefault: aiOverwrite.value, stem: excerptOf(it.body || it.title, 60) },
    )
    const e = aiEdited.value[Number(it.id)]
    if (e) {
      if (e.kpText !== undefined) row.edit.kpText = e.kpText
      if (e.level !== undefined) row.edit.level = e.level
      if (e.difficulty !== undefined) row.edit.difficulty = e.difficulty
      if (e.section !== undefined) row.edit.section = e.section
      if (e.adopt !== undefined) row.adopt = e.adopt
    }
    return row
  })
}

const aiStats = computed(() => {
  let ok = 0
  let bad = 0
  let writable = 0
  for (const r of aiRows.value) {
    if (r.err) { bad++; continue }
    ok++
    if (r.adopt && !r.written && patchOfTagRow(r)) writable++
  }
  return { total: aiItems.value.length, done: aiIdx.value, ok, bad, writable }
})

/** 这一行「哪些栏不写、为什么」——最多两条，别把表格塞满 ✓ */
function aiKeepHint(r: TagRow): string {
  const parts: string[] = []
  for (const k of ['kp', 'level', 'difficulty', 'section'] as const) if (r.keep[k]) parts.push(r.keep[k])
  return Array.from(new Set(parts)).slice(0, 2).join(' · ')
}
/** 这一行将写哪几栏（人话 ✓） */
function aiWill(r: TagRow): string { return fieldsOfPatch(patchOfTagRow(r)).join(' / ') }

function openAiTag() {
  const list = aiTargets()
  if (!list.length) { flash('先勾选题目，或先筛出一批（一道没勾 = 按当前筛选全选 ✓）'); return }
  if (!aiReady()) { flash('AI 打标只在桌面端可用（网页端直连大模型会被 CORS 挡 ✗）'); return }
  if (!aiKeyOf()) { flash('没填 AI Key —— 去「设置 → AI 助手」填一个（只存本机 ✓）'); return }
  aiItems.value = list.slice()
  aiRes.value = {}
  aiEdited.value = {}
  aiIdx.value = 0
  aiStop.value = false
  aiMsg.value = pickedList.value.length
    ? '对象：勾选的 ' + list.length + ' 道（一次 ' + AI_BATCH + ' 道，可暂停 ✓）'
    : '对象：当前筛选的全部 ' + list.length + ' 道（一道没勾 = 按筛选全选 ✓）'
  rebuildAiRows()
  aiOpen.value = true
}

/** 跑一批（默认 20 道）：跑满一批 / 点了暂停就停 ✓ */
async function runAiTag(batch: number) {
  if (aiBusy.value) return
  const key = aiKeyOf()
  if (!key) { aiMsg.value = '没填 AI Key —— 去「设置 → AI 助手」填一个（只存本机 ✓）'; return }
  const list = aiItems.value
  if (aiIdx.value >= list.length) { aiMsg.value = '这批已经跑完了 ✓'; return }
  aiBusy.value = true
  aiStop.value = false
  const end = Math.min(list.length, aiIdx.value + batch)
  try {
    while (aiIdx.value < end) {
      if (aiStop.value) break
      const it = list[aiIdx.value]
      aiMsg.value = 'AI 正在判第 ' + (aiIdx.value + 1) + '/' + list.length + ' 道…（逐题判，慢是正常的 ✓）'
      const r = await tagOne(it, key)
      clearAiEdit(Number(it.id))
      aiRes.value = { ...aiRes.value, [Number(it.id)]: r }
      aiIdx.value++
      rebuildAiRows()
    }
    const st = aiStats.value
    if (aiStop.value) aiMsg.value = '已暂停：跑了 ' + st.done + '/' + st.total + ' 道 —— 点「继续」接着跑 ✓'
    else if (st.done < st.total) aiMsg.value = '本批 ' + batch + ' 道跑完（' + st.done + '/' + st.total + '）—— 点「继续」跑下一批 ✓'
    else aiMsg.value = '全部跑完 ✓ 有建议 ' + st.ok + ' 道 · 没读懂/失败 ' + st.bad + ' 道 —— 确认表里改好后点「写库」✓'
  } finally {
    aiBusy.value = false
  }
}

function pauseAiTag() { if (aiBusy.value) { aiStop.value = true; aiMsg.value = '正在暂停（跑完手上这一道就停 ✓）…' } }

/** 失败的（接口错 / AI 没读懂）单独重试一遍 ✓（§49.3 ④）仍失败就人工处理 ✓ */
async function retryAiFailed() {
  if (aiBusy.value) return
  const key = aiKeyOf()
  if (!key) { aiMsg.value = '没填 AI Key'; return }
  const ids = aiRows.value.filter((r) => !!r.err).map((r) => r.id)
  if (!ids.length) { aiMsg.value = '没有失败的了 ✓'; return }
  aiBusy.value = true
  try {
    let fixed = 0
    for (const id of ids) {
      const it = aiItems.value.find((x) => Number(x.id) === id)
      if (!it) continue
      aiMsg.value = '重试 ' + (fixed + 1) + '/' + ids.length + ' 道…'
      const r = await tagOne(it, key)
      if (!r.err) fixed++
      clearAiEdit(id)
      aiRes.value = { ...aiRes.value, [id]: r }
      rebuildAiRows()
    }
    aiMsg.value = '重试完：修好 ' + fixed + '/' + ids.length + ' 道' + (fixed < ids.length ? '（剩下的只能人工填 ✗）' : ' ✓')
  } finally { aiBusy.value = false }
}

/** 写库：只写勾了采纳的 ✓ 走 lib_q_patch（每道一份 revision 快照，可回退 ✓） */
async function applyAiTag() {
  const rows = aiRows.value.filter((r) => r.adopt && !r.err && !r.written && patchOfTagRow(r))
  if (!rows.length) { aiMsg.value = '没有可写的（要勾选采纳 + 至少有一栏有内容 ✓）'; return }
  busy.value = true
  aiBusy.value = true
  let ok = 0
  const fail: string[] = []
  try {
    for (const r of rows) {
      const patch = patchOfTagRow(r)
      if (!patch) continue
      const res = await qPatch(r.id, patch)
      if (res.ok) { ok++; r.written = true }
      else fail.push((r.code || '#' + r.id) + '：' + (res.error || '写库失败'))
    }
    aiMsg.value = '✓ 已写库 ' + ok + '/' + rows.length + ' 道'
      + (fail.length ? ' · 失败 ' + fail.length + '：' + fail.slice(0, 3).join('；') : '（每道都留了 revision 快照，可回退 ✓）')
    await reload()
    if (selId.value) await renderPreview()
  } finally {
    busy.value = false
    aiBusy.value = false
  }
}

/* ---------------- 【P1c】来源归一建议 ---------------- */
const plan = ref<SourcePlan | null>(null)
const planBusy = ref(false)
/** 有建议的（空建议 = 认不出，生成草稿也没用 ✓） */
const actionable = computed(() => (plan.value?.items || []).filter((i) => i.suggest))
/** 报告里 plan.error 直接写在 v-else-if 里会被 TS 收窄成 never → 用 computed 兜一下 ✓ */
const planError = computed(() => String(plan.value?.error || ''))

async function loadPlan() {
  planBusy.value = true
  try {
    plan.value = await sourcePlan()
  } finally {
    planBusy.value = false
  }
}

/** 生成归一草稿：**只写草稿**，正式库要等草稿箱确认才动 ✓ */
async function makeSourceDrafts() {
  const ids = actionable.value.map((i) => i.id)
  if (!ids.length) { flash('没有可自动生成草稿的建议（认不出的只能人工填）'); return }
  busy.value = true
  try {
    const r = await sourcePlanApply(ids)
    if (!r.ok) { flash('✗ ' + (r.error || '生成草稿失败')); return }
    flash((r.reused ? '✓ 命中已有批次（幂等，没重复建）：' : '✓ 已生成 ') + r.added + ' 条归一草稿' + (r.needManual ? '（' + r.needManual + ' 条有「？」要补全）' : '') + ' —— 去「草稿箱」确认')
    await loadPlan()
    report.value = await sourceReport()
  } finally {
    busy.value = false
  }
}

/* ---------------- 【P2a】导出为 Markdown 题库 ---------------- */

/** 导出成「一道题一个 .md」（Obsidian 可开、可 git，**而且能再导入回来** ✓） */
async function exportVaultMd() {
  const base = await firstUserDir('文档')
  const stamp = new Date().toISOString().slice(0, 10)
  const def = (base ? base + '\\' : '') + 'LJ题库-' + stamp
  const dir = window.prompt('导出到哪个目录？（一道题一个 .md；这个目录能直接再导入回来）', def)
  if (!dir || !String(dir).trim()) return
  busy.value = true
  try {
    const r = await exportVault(String(dir).trim())
    if (!r.ok) { flash('✗ ' + (r.error || '导出失败')); return }
    flash('✓ 已导出 ' + r.count + '/' + r.total + ' 道到 ' + r.dir + '（index.md 是目录）')
  } finally {
    busy.value = false
  }
}

async function loadKpCatalog() {
  try {
    kpOptions.value = (await kpCatalog()).filter((x) => x.kind === 'knowledge').map((x) => x.kp)
  } catch { /* 空库也能跑 ✓ */ }
}

/** 报告里点一道 → 关报告并跳过去（不在当前筛选里就先清筛选 ✓） */
async function jumpTo(id: number) {
  reportOpen.value = false
  if (!items.value.some((x) => x.id === id)) {
    f.value = {}
    await reload()
  }
  const it = items.value.find((x) => x.id === id)
  if (it) select(it)
}

/** 【v1470】默认「最新在前」= 老行为 ✓；换成 'paper' 就按「试卷 + 题内序号」排 ✓ */
const f = ref<QFilter>({ sort: 'id' })
const sel = computed(() => items.value.find((x) => x.id === selId.value) || null)
const kpKeys = computed(() => Object.keys(facets.value.byKp || {}))
const yearKeys = computed(() => Object.keys(facets.value.byYear || {}).filter((k) => k !== '(空)'))

/** 就地表单（保存时按字段 patch 回 meta ✓） */
/** 【v1467】再加三个**正文**字段 —— 以前只能改元数据（章节/题型/年份…）+ 答案 ✗，
 *  题干 / 选项 / 解析看着是"能编辑"的（就在预览下面 ✗），其实**没有输入框** ✗ →「再编辑」等于做不到 ✗ */
const form = ref({ section: '', qtype: '', level: '', year: 0, paperName: '', stem: '', optionsText: '', answer: '', solution: '', kpText: '', status: '' })

/* ---------------- M3：多选 + 批量 + 插入 ---------------- */
const store = useDeckStore()
/** 勾选的题 id（批量操作的对象；一道都没勾就用右边预览的这道 ✓） */
const picked = ref<number[]>([])
/** 插入带不带答案/解析（默认不带：讲题时先不给答案 ✓） */
const withAnswer = ref(false)
const batchSection = ref('')
const batchKp = ref('')
const pickedList = computed(() => items.value.filter((x) => picked.value.includes(x.id)))
const allPicked = computed(() => items.value.length > 0 && items.value.every((x) => picked.value.includes(x.id)))
/** 到底对哪几道下手：勾了就用勾的，没勾就用当前预览的这道 ✓ */
const targets = computed<QItem[]>(() => (pickedList.value.length ? pickedList.value : sel.value ? [sel.value] : []))

function flash(t: string, ms = 2600) {
  msg.value = t
  window.setTimeout(() => { if (msg.value === t) msg.value = '' }, ms)
}

async function reload() {
  busy.value = true
  try {
    const [fc, res] = await Promise.all([qFacets(), qSearch({ ...f.value, limit: 300 })])
    facets.value = fc
    items.value = res.items
    total.value = res.total
    if (selId.value && !res.items.some((x) => x.id === selId.value)) selId.value = 0
  } finally {
    busy.value = false
  }
}
onMounted(() => { void reload(); void loadKpCatalog() })
/* ---------------- 【v1466】题图编辑：上传 / 粘贴 / 数学图形 / 三维图 ---------------- */
/** 单张图上限（超过先压一下再传 —— 库是自包含的，图直接进 meta ✓） */
const MAX_FIG_BYTES = 4 * 1024 * 1024
const figBusy = ref(false)
const figMsg = ref('')

/** 这道题已有的图（meta.images：{ n, src, caption }） */
function figsOf(it: QItem | null): QuestionImage[] {
  if (!it) return []
  const raw = metaOf(it).images
  return Array.isArray(raw) ? (raw as QuestionImage[]).filter((x) => x && x.src) : []
}

async function saveFig(patch: Record<string, unknown>, okMsg: string) {
  const it = sel.value
  if (!it) return
  figBusy.value = true
  try {
    const r = await qPatch(Number(it.id), patch)
    if (r && r.ok) {
      figMsg.value = '✓ ' + okMsg
      await reload()
      await nextTick(renderPreview)
    } else figMsg.value = '✗ ' + ((r && r.error) || '保存失败')
  } finally {
    figBusy.value = false
  }
}

/** 加一张题图；题干里没有 [图N] 就补一个（预览/导出都靠这个标记就地插图 ✓） */
async function addQuestionFigure(src: string, caption = '') {
  const it = sel.value
  if (!it || !src) return
  const list = figsOf(it).slice()
  const n = list.length + 1
  list.push({ n, src, caption: caption || '' })
  const m = metaOf(it)
  const stem = String(m.stem || it.body || '')
  const has = new RegExp('\\[图\\s*' + n + '\\s*\\]').test(stem)
  const stem2 = has ? stem : stem + (stem.trim() ? '\n\n' : '') + '[图' + n + ']'
  await saveFig({ images: list, stem: stem2 }, '已加第 ' + n + ' 张题图')
}

async function removeQuestionFigure(n: number) {
  const it = sel.value
  if (!it) return
  const list = figsOf(it)
    .filter((x) => Number(x.n) !== Number(n))
    .map((x, i) => ({ ...x, n: i + 1 }))
  await saveFig({ images: list }, '已删除该图（其余图号自动重排）')
}

/** 【v1466】改图注（就地编辑 ✓ —— 提示里承诺「可换图注」，此前没有能改的地方 ✗） */
async function setFigCaption(n: number, e: Event) {
  const input = e.target as HTMLInputElement
  const cap = input.value.trim()
  const cur = figsOf(sel.value)
  const one = cur.filter((x) => Number(x.n) === Number(n))[0]
  if (!one || String(one.caption || '') === cap) return
  const list = cur.map((x) => (Number(x.n) === Number(n) ? { ...x, caption: cap } : x))
  await saveFig({ images: list }, '已更新图注')
}

function fileToDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result || ''))
    r.onerror = () => rej(new Error('读文件失败'))
    r.readAsDataURL(f)
  })
}

async function addFigFiles(files: File[]) {
  let ok = 0
  for (const f of files) {
    if (!/^image\//.test(f.type)) { figMsg.value = '只收图片（png / jpg / webp / gif / svg）'; continue }
    if (f.size > MAX_FIG_BYTES) { figMsg.value = '这张太大（' + Math.round(f.size / 1024) + 'KB > 4MB），先压一下再传'; continue }
    await addQuestionFigure(await fileToDataUrl(f), '')
    ok++
  }
  if (ok) figMsg.value = '✓ 已加 ' + ok + ' 张（可删、可换图注）'
}

function onPickFigFile(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files ? (Array.prototype.slice.call(input.files) as File[]) : []
  input.value = ''
  if (files.length) void addFigFiles(files)
}

/** 面板开着时 Ctrl+V 直接贴图 ✓（只认剪贴板里的图片） */
function onPanelPaste(e: ClipboardEvent) {
  if (!sel.value) return
  const dt = e.clipboardData
  if (!dt) return
  const files: File[] = []
  const items = Array.prototype.slice.call(dt.items || []) as DataTransferItem[]
  for (const it of items) {
    if (it.kind === 'file' && /^image\//.test(it.type)) {
      const f = it.getAsFile()
      if (f) files.push(f)
    }
  }
  if (!files.length) return
  e.preventDefault()
  void addFigFiles(files)
}

/** 直接用**我们的数学图形**：打开图形面板，点哪张哪张就成为题图（面板的 sink 模式 ✓） */
function pickMathFigure() {
  if (!sel.value) { figMsg.value = '先选一道题'; return }
  openFigPalette((svg, label) => {
    void (async () => {
      try { await addQuestionFigure(await svgToPngUrl(svg), label || '') }
      catch (e) { figMsg.value = '✗ 图形转图片失败：' + String((e as Error)?.message || e) }
    })()
  })
  figMsg.value = '在图形面板里点一张 → 它就成为本题的题图 ✓'
}

/** 三维立体图：靠 geom3dSink 接收（用完立刻清掉，免得影响画布 ✓） */
function pickGeom3DFigure() {
  if (!sel.value) { figMsg.value = '先选一道题'; return }
  geom3dSink.value = (svgText: string, label: string) => {
    geom3dSink.value = null
    void (async () => {
      try { await addQuestionFigure(await svgTextToPngUrl(svgText), label || '三维图') }
      catch (e) { figMsg.value = '✗ 三维图转图片失败：' + String((e as Error)?.message || e) }
    })()
  }
  openGeom3D()
  // 【v1466】插件被关掉时 openGeom3D() 是**空操作** ✓ —— 提示不能还喊"去三维窗口里点插入" ✗
  //   （requireAddon 会弹 3.2 秒的全局提示 ✓，这里再在题图区说明一次 ✓）
  if (geom3dOpen.value) {
    figMsg.value = '在三维窗口里调好 → 点「插入到当前页」就落到本题 ✓'
  } else {
    geom3dSink.value = null
    figMsg.value = '三维立体图已在「功能管理」里关掉 —— 打开它才能用'
  }
}




/**
 * 【修】Esc 关面板 —— 关闭按钮的 title 一直写着「关闭 (Esc)」，但以前**没有实现** ✗
 *   ⚠ 子浮层（录入/草稿箱/来源报告/补答案/AI 打标）开着时不抢 Esc：先关它们、别把整屏面板一起关掉 ✓
 */
function onPanelKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (importOpen.value || draftOpen.value || reportOpen.value || ansOpen.value || aiOpen.value) return
  emit('close')
}
onMounted(() => {
  // 【v1472】恢复上次摆的位置与收起状态 ✓
  try {
    const w = JSON.parse(localStorage.getItem(WIN_KEY) || 'null')
    if (w && typeof w.x === 'number' && typeof w.y === 'number') {
      dragOff.value = { x: w.x, y: w.y }
      collapsed.value = !!w.mini
      dockRight.value = !!w.dock
    }
    // 【v1502】⚠ 老师实测：点「全屏」/改窗口大小之后 **面板显示不完整** ✗
    //   真因：位置是按**像素**记住的 ✓ —— 窗口变大变小后那对坐标就把面板顶到屏幕外了 ✗（右边/下边被切 ✓）
    //   修：每次打开面板（以及窗口尺寸变化时）把偏移**夹回可见范围** ✓ + CSS 再兜一层 max-width/height ✓
    requestAnimationFrame(() => clampWin())
    window.addEventListener('resize', clampWin)
  } catch { /* 坏数据就当没存过 ✓ */ }
  document.addEventListener('keydown', onPanelKey)
  // 【v1466】面板开着时 Ctrl+V 直接贴图（只认剪贴板里的图片 ✓）
  document.addEventListener('paste', onPanelPaste)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onPanelKey)
  document.removeEventListener('paste', onPanelPaste)
  // 【v1472】拖动的两个监听挂在 window 上 → 关面板时一定要摘掉 ✓
  window.removeEventListener('mousemove', onHeadMove)
  window.removeEventListener('mouseup', onHeadUp)
  window.removeEventListener('resize', clampWin)
})

/* ---------------- 【v1472】浮窗：拖动 / 收起 / 记住位置 ---------------- */
const WIN_KEY = 'lj-mathslides:qbwin'
const collapsed = ref(false)
/** 【v1473】靠右停靠（右侧半屏，左边留给画布 ✓）—— 老师要的「题库和画布能来回用」✓ */
const dockRight = ref(false)
const dragOff = ref({ x: 0, y: 0 })
let dragFrom: { mx: number; my: number; ox: number; oy: number } | null = null
/** 【v1502】把浮窗偏移夹回可见范围 ✓
 *  ⚠ 第一版按"固定余量"算 ✗ → 探针实测仍然出屏（面板本身宽 1280 ✓，允许 ±590 就把右边顶到 1950 > 1440 ✗）。
 *  正解：按**面板实际尺寸**算 ✓ —— 居中布局下，偏移的极限就是 (窗口 − 面板)/2 ✓。*/
function clampWin() {
  const box = document.querySelector('.qb__box') as HTMLElement | null
  const bw = box ? box.getBoundingClientRect().width : 320
  const bh = box ? box.getBoundingClientRect().height : 200
  const mx = Math.max(0, (window.innerWidth - bw) / 2)
  const my = Math.max(0, (window.innerHeight - bh) / 2)
  const nx = Math.max(-mx, Math.min(mx, dragOff.value.x))
  const ny = Math.max(-my, Math.min(my, dragOff.value.y))
  if (nx !== dragOff.value.x || ny !== dragOff.value.y) {
    dragOff.value = { x: nx, y: ny }
    saveWin()
  }
}
function saveWin() {
  try { localStorage.setItem(WIN_KEY, JSON.stringify({ x: dragOff.value.x, y: dragOff.value.y, mini: collapsed.value, dock: dockRight.value })) } catch { /* 存不上不影响用 */ }
}
function onHeadDown(e: MouseEvent) {
  const t = e.target as HTMLElement | null
  if (t && t.closest('button, input, select, textarea, a')) return   // 别抢按钮/输入框的点击 ✓
  dragFrom = { mx: e.clientX, my: e.clientY, ox: dragOff.value.x, oy: dragOff.value.y }
  window.addEventListener('mousemove', onHeadMove)
  window.addEventListener('mouseup', onHeadUp)
}
function onHeadMove(e: MouseEvent) {
  if (!dragFrom) return
  dragOff.value = { x: dragFrom.ox + (e.clientX - dragFrom.mx), y: dragFrom.oy + (e.clientY - dragFrom.my) }
}
function onHeadUp() {
  if (!dragFrom) return
  dragFrom = null
  saveWin()
  window.removeEventListener('mousemove', onHeadMove)
  window.removeEventListener('mouseup', onHeadUp)
}
function toggleMini() { collapsed.value = !collapsed.value; saveWin() }
function toggleDock() {
  dockRight.value = !dockRight.value
  collapsed.value = false
  saveWin()
  flash(dockRight.value ? '已靠右停靠 —— 左边就是画布与缩略图，点一下就能切过去 ✓' : '已回到整屏模式 ✓')
}
function resetWin() { dragOff.value = { x: 0, y: 0 }; collapsed.value = false; saveWin(); flash('已复位（居中、展开）') }

function pickSection(s: string) {
  f.value.section = f.value.section === s ? undefined : s
  void reload()
}
function pickKp(k: string) {
  f.value.kp = f.value.kp === k ? undefined : k
  void reload()
}
function clearFilters() {
  f.value = {}
  void reload()
}

function select(it: QItem) {
  selId.value = it.id
  const m = metaOf(it)
  form.value = {
    section: it.section || '',
    qtype: it.qtype || '',
    level: it.level || '',
    year: it.year || 0,
    paperName: String(m.paperName || it.paper || ''),
    stem: String(m.stem || ''),
    // 选项在 meta 里是**数组** ✓，编辑框里一行一个（拆/合都在 optionsOf 与这里 ✓）
    optionsText: (Array.isArray(m.options) ? (m.options as unknown[]) : []).map((x) => String(x ?? '')).join('\n'),
    answer: String(m.answer || ''),
    solution: String(m.solution || ''),
    kpText: (it.kp || []).join('、'),
    status: it.status || '',
  }
  void nextTick(renderPreview)
}

async function renderPreview() {
  const host = previewHost.value
  const it = sel.value
  if (!host || !it) return
  try {
    // 【v1455】先把题图水合出来（assetId → data URL）再渲染，否则预览里永远看不到图 ✗
    const imgs = await pickImages(it)
    await typesetMixed(host, previewHtmlOf(it, imgs))
  } catch {
    host.textContent = previewHtmlOf(it).replace(/<[^>]+>/g, ' ')
  }
}
watch(selId, () => { void nextTick(renderPreview) })

/**
 * 【v1458】点题图放大 / 缩小
 *   为什么：预览列只有 ~320px 宽，原尺寸的题图会占满整屏（用户反馈「导入的图片尺寸过大」）——
 *   所以默认收小，想看细节点一下 ✓（缩放态只加一个 class，不动数据）
 */
function onPreviewClick(e: MouseEvent) {
  const t = e.target as HTMLElement | null
  if (!t || t.tagName !== 'IMG') return
  const fig = t.closest('.qb__fig')
  if (!fig) return
  fig.classList.toggle('qb__fig--zoom')
  t.setAttribute('title', fig.classList.contains('qb__fig--zoom') ? '点击缩小' : '点击放大')
}

/** 知识点输入：中英文逗号/顿号/分号都当分隔符 ✓（老师怎么写都能拆对） */
function kpListOf(text: string): string[] {
  return Array.from(new Set(String(text || '').split(/[，,、;；]/).map((s) => s.trim()).filter(Boolean)))
}

/**
 * 【v1470】这道题在原卷里是第几题 ✓
 *   优先用 `meta.no`（导入时从卷面记下来的题号 ✓）；老数据没有 → **按同一套里 id 升序数位置** ✓
 *   （同一批导入的 id 是顺序的 → 数出来的就是卷面顺序 ✓，**不用重导一遍** ✓）
 *   ⚠ 列表被分页/筛选时兜底序号可能对不上（只按当前加载到的题数 ✓）—— 有 meta.no 的题不受影响 ✓
 */
const paperPos = computed(() => {
  const byPaper = new Map<string, QItem[]>()
  for (const it of items.value) {
    const p = String(metaOf(it).paperName || it.paper || '').trim()
    if (!p) continue
    const arr = byPaper.get(p) || []
    arr.push(it)
    byPaper.set(p, arr)
  }
  const out = new Map<number, number>()
  for (const arr of byPaper.values()) {
    arr.sort((a, b) => Number(a.id) - Number(b.id))
    arr.forEach((it, i) => out.set(Number(it.id), i + 1))
  }
  return out
})
function noOf(it: QItem | null): number {
  if (!it) return 0
  const n = Number(metaOf(it).no || 0)
  return n > 0 ? n : (paperPos.value.get(Number(it.id)) || 0)
}

/** 【v1467】选项编辑框：一行一个（空行自动去掉 ✓；全空 = 这道题没有选项 ✓） */
function optionsOf(text: string): string[] {
  return String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

async function save() {
  const it = sel.value
  if (!it) return
  busy.value = true
  try {
    // 题干决不允许存空 ✗（存空了这道题在库里就成了空壳，导出/组卷全跟着坏 ✓）
    const stem = String(form.value.stem || '').trim()
    if (!stem) { flash('✗ 题干不能为空'); return }
    const patch = {
      stem,
      options: optionsOf(form.value.optionsText),
      solution: String(form.value.solution || '').trim(),
      section: form.value.section || '',
      qtype: form.value.qtype || '',
      level: form.value.level || '',
      year: Number(form.value.year) || 0,
      paperName: form.value.paperName || '',
      answer: form.value.answer || '',
      knowledge: kpListOf(form.value.kpText),
      // 【P0b】空串 = 保持原状态（Rust 侧 CASE WHEN '' THEN status）✓
      status: form.value.status || '',
    }
    const r = await qPatch(it.id, patch)
    if (!r.ok) { flash('✗ ' + (r.error || '保存失败')); return }
    // 就地更新那一条（列表位置不动 ✓）+ 重算计数
    const row = r.row || {}
    const idx = items.value.findIndex((x) => x.id === it.id)
    if (idx >= 0) {
      const next = { ...items.value[idx], ...row, kp: patch.knowledge } as QItem
      next.meta = JSON.stringify({ ...metaOf(items.value[idx]), ...patch })
      items.value[idx] = next
    }
    facets.value = await qFacets()
    flash('✓ 已保存 #' + it.id)
    await renderPreview()
  } finally {
    busy.value = false
  }
}

/* ---------------- M3：多选 / 批量 / 插入 ---------------- */

/** 录入完成后：提示 + 重算计数（新题马上能在左树/筛选里看到 ✓） */
function onImported(n: number) {
  flash('✓ 已入库 ' + n + ' 道')
  void reload()
}

function togglePick(it: QItem) {
  picked.value = picked.value.includes(it.id) ? picked.value.filter((x) => x !== it.id) : [...picked.value, it.id]
}
function toggleAll() {
  picked.value = allPicked.value ? [] : items.value.map((x) => x.id)
}

/** 插入幻灯片：每题一个**混排**元素（公式写 $…$，不用 math 元素 ✓），题图另做图片元素 ✓ */
async function insertToSlide() {
  const list = targets.value
  if (!list.length) { flash('先勾选题目（或点右边预览一道）'); return }
  busy.value = true
  try {
    const els: { type: 'richtex' | 'image'; overrides: Partial<SlideElement> }[] = []
    let y = 40
    let placed = 0
    let missing = 0
    for (const it of list) {
      const imgs = await pickImages(it)
      const cut = stripImageMarkers(questionTextOf(it, withAnswer.value))
      if (!cut.text) continue
      const lines = cut.text.split('\n').length
      const h = Math.max(80, Math.min(680, lines * 38 + 28))
      els.push({
        type: 'richtex',
        overrides: {
          text: cut.text, fontSize: 24, align: 'left', color: '#1a1a1a',
          w: 1180, h, x: 48, y, autoBox: true,
        } as Partial<SlideElement>,
      })
      y += h + 16
      for (const im of imgs) {
        els.push({ type: 'image', overrides: { src: im.src, fit: 'contain', x: 48, y, w: 520, h: 320 } as Partial<SlideElement> })
        y += 336
      }
      placed += imgs.length
      missing += Math.max(0, cut.dropped - imgs.length)
    }
    if (!els.length) { flash('这几道题没有可插入的文字'); return }
    store.addElements(els)   // 一次快照、一次选中新元素 ✓
    // 【v1471】插完**不再把题库关掉** ✗ —— 老师的用法是「挑一道 → 插 → 再挑下一道」✓，
    //   以前这里 emit('close') ✗ → 每插一道都要重新点菜单进题库 ✗（用户实测反馈 ✓）。
    //   同时把**勾选清空** ✓：不清的话，下一次点「插入」还是插上一批（targets 优先取勾选 ✓）→ 会重复插 ✗
    picked.value = []
    flash('✓ 已插入 ' + list.length + ' 道到幻灯片（勾选已清空，继续挑下一道即可 ✓）'
      + (placed ? '，配图 ' + placed + ' 张' : '')
      + (missing ? '（有 ' + missing + ' 处图片标记未落地，需手动补图）' : ''))
  } finally {
    busy.value = false
  }
}

/** 【v1612】把一道题包成**题目块** ✓（试卷的 `[题]…[选项]…[解析]…[/题]` 语法 ✓）
 *
 *  ⚠ 为什么**不**在 `questionTextOf` 里做 ✗：那个是**幻灯片与试卷共用**的纯文本排版 ✓
 *    （幻灯片放不下"折叠解析"这种结构 ✓）⇒ 只在「加入试卷」这一处包装 ✓
 *
 *  ★ 好处 ✓：① 解析**默认收起** ✓ 点一下展开 ✓
 *    ② 整块**不会被分页拆开** ✓（题干/选项/解析永远同页 ✓）
 *    ③ **打印时解析自动展开** ✓（否则答案印不出来 ✓）
 *    ④ 答案与解析都进 `[解析]` 段 ✓（试卷没有单独的"答案"段 ✓）
 */
function questionBlockOf(it: QItem, withAnswer: boolean, no = 0): string {
  const m = metaOf(it)
  const stem = String(m.stem || it.body || it.title || '').trim()
  if (!stem) return ''
  const opts = Array.isArray(m.options) ? (m.options as unknown[]).map((x) => String(x)) : []
  const lines = ['[题]', (no ? no + '. ' : '') + stem]
  if (opts.length) lines.push('[选项]', opts.map((o, i) => 'ABCDEFGH'[i] + '．' + o).join('\n'))
  if (withAnswer) {
    const ans = String(m.answer || '').trim()
    const sol = String(m.solution || '').trim()
    const body = [ans ? '【答案】' + ans : '', sol].filter(Boolean).join('\n')
    if (body) lines.push('[解析]', body)
  }
  lines.push('[/题]')
  return lines.join('\n')
}

/** 加入试卷：交给接收口（试卷没开 → App 会把它打开，PaperModal 挂载时消费 ✓） */
async function addToPaper() {
  const list = targets.value
  if (!list.length) { flash('先勾选题目（或点右边预览一道）'); return }
  busy.value = true
  try {
    const parts: string[] = []
    const imgs: { n: number; src: string; caption?: string }[] = []
    let no = 1
    for (const it of list) {
      // 【v1612】改成**题目块** ✓ —— 原来走 `questionTextOf`（纯文本 ✓ 而试卷**不认** `【答案】`/`【解析】` ✗）
      //   后果曾是：插进去的不是题目块 ✓ → 没有解析折叠 ✓ 可能被分页拆开 ✓
      const text = questionBlockOf(it, withAnswer.value, list.length > 1 ? no : 0)
      if (!text) continue
      if (list.length > 1) no++
      parts.push(text)
      for (const im of await pickImages(it)) imgs.push({ n: im.n, src: im.src, caption: im.caption })
    }
    if (!parts.length) { flash('这几道题没有可插入的文字'); return }
    sendToPaper({ text: parts.join('\n\n'), id: list.length === 1 ? list[0].id : 0, label: '试题 ' + list.length + ' 道', imgs })
    // 【v1472】交给试卷后**自动收起** ✓ —— 不然题库盖着试卷，看不到插进去的效果 ✗
    //   （要展开点标题栏那颗「▣ 展开」✓；位置与收起状态会记住 ✓）
    collapsed.value = true
    saveWin()
    flash('✓ 已加入试卷' + (imgs.length ? '（配图 ' + imgs.length + ' 张）' : '') + ' —— 题库已收起，看完点标题栏「▣ 展开」继续挑 ✓')
  } finally {
    busy.value = false
  }
}

/** 批量：**一个事务**改多道（失败不留半份 ✓） */
async function batchApply(key: 'section' | 'knowledge', value: unknown, label: string) {
  const ids = picked.value.slice()
  if (!ids.length) { flash('先勾选题目'); return }
  busy.value = true
  try {
    const r = await qBatch(ids.map((id) => ({ id, patch: { [key]: value } })))
    if (!r.ok) { flash('✗ ' + (r.error || '批量保存失败')); return }
    picked.value = []
    flash('✓ 已批量' + label + ' ' + r.updated + ' 道')
    await reload()
    if (selId.value) await renderPreview()
  } finally {
    busy.value = false
  }
}
function batchPatchSection() { if (batchSection.value) void batchApply('section', batchSection.value, '改章节') }
function batchPatchKp() {
  const kp = kpListOf(batchKp.value)
  if (!kp.length) { flash('知识点是空的'); return }
  void batchApply('knowledge', kp, '打知识点')
}
/**
 * 批量删除 ✗ 危险动作，两道闸门：
 *   ① 超过 20 道要**手输题数**才执行（确认框点快了也拦得住）；
 *   ② Rust 侧删除前**自动整库备份** library.db.bak-qdel-<时间戳> ✓
 *   （v1443 实测教训：一个「全选 → 删除」就把线上 169 道清空了。）
 */
async function batchDelete() {
  const ids = picked.value.slice()
  if (!ids.length) { flash('先勾选题目'); return }
  if (ids.length > 20) {
    const typed = window.prompt('⚠ 即将删除 ' + ids.length + ' 道题（不可撤销，只在筛选结果上）。\n请输入题数 ' + ids.length + ' 确认：', '')
    if (String(typed == null ? '' : typed).trim() !== String(ids.length)) { flash('已取消（没输对题数）'); return }
  } else if (!window.confirm('删除选中的 ' + ids.length + ' 道题？不可撤销（会连带清掉它们的知识点）')) {
    return
  }
  busy.value = true
  try {
    const r = await qBatch(ids.map((id) => ({ id, delete: true })))
    if (!r.ok) { flash('✗ ' + (r.error || '批量删除失败')); return }
    picked.value = []
    selId.value = 0
    flash('✓ 已删除 ' + r.deleted + ' 道' + (r.backup ? '；删除前已整库备份' : ''))
    lastBackup.value = r.backup || ''
    await reload()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <!-- 【修】以前是 @click.self="emit('close')"：点面板**外面任何地方**就关 ——
       而面板是 96vw×88vh，外面那圈很窄，鼠标移出去后只要有一次点击（含从别的窗口点回来重新聚焦）就丢了 ✗
       现在只认 ✕ 和 Esc（Esc 以前只在 title 里写着，其实没实现 ✓） -->
  <div class="qb" :class="{ 'qb--dock': dockRight && !collapsed }">
    <div
      class="qb__box" :class="{ 'qb__box--mini': collapsed }"
      :style="{ transform: dockRight ? 'none' : 'translate(' + dragOff.x + 'px, ' + dragOff.y + 'px)' }"
    >
      <header class="qb__head" title="按住标题栏可以拖动这个窗口（位置会记住 ✓）" @mousedown="onHeadDown">
        <button class="qb__btn qb__btn--mini" :title="collapsed ? '展开（看题、挑题）' : '收起成一条标题栏 —— 收起后能看清幻灯片 / 试卷，点这里再展开 ✓'" @click="toggleMini">{{ collapsed ? '▣ 展开' : '— 收起' }}</button>
        <button class="qb__btn qb__btn--mini" :title="dockRight ? '取消靠右停靠，回到整屏模式' : '靠右停靠：题库只占右半屏，左边留给画布和缩略图（两边都能点 ✓）'" @click="toggleDock">{{ dockRight ? '⛶ 整屏' : '⇥ 靠右' }}</button>
        <button class="qb__btn qb__btn--mini" title="位置复位到屏幕中央并展开" @click="resetWin">⟳</button>
        <span class="qb__title">试题库</span>
        <span class="qb__sub">共 {{ facets.total }} 道 · 当前筛出 {{ total }} 道</span>
        <span
          v-if="isPreview" class="qb__badge"
          title="浏览器预览库：题存在浏览器 localStorage 里（桌面端才有 %APPDATA%\lj-mathslides\library.db 那份真库）。清缓存 / 换浏览器就没了 ✓"
        >浏览器预览库</span>
        <span v-if="msg" class="qb__msg">{{ msg }}</span>
        <span class="qb__headrt">
          <button class="qb__btn" title="导出成一道题一个 .md 的 Markdown 题库（Obsidian 可开、能再导入回来）" @click="exportVaultMd">导出 Markdown</button>
          <button class="qb__btn" title="AI / OCR 的产出先落草稿，人工确认后才进正式库" @click="draftOpen = true">草稿箱</button>
          <button class="qb__btn" title="来源合规报告：多少题有来源 / 有多少已成模板 / 哪几道要处理" @click="openReport">来源报告</button>
          <button class="qb__btn" title="从录入时的 MinerU 产物缓存重新拆答案补给缺答案的题（纯本地、只补不覆盖）" @click="openAnswerFill">补答案</button>
          <button class="qb__btn" title="给勾选的题（一道没勾 = 当前筛选全部）自动打知识点 / 难度 / 板块 —— 结果先进确认表，勾选后才写库（只填空字段、可回退）" @click="openAiTag">AI 打标</button>
          <button class="qb__btn qb__btn--main" title="从 Markdown / JSON / PDF 批量录入试题" @click="importOpen = true">录入试题</button>
          <button class="qb__close" title="关闭 (Esc)" @click="emit('close')"><AppIcon name="close" :size="13" /></button>
        </span>
      </header>

      <div class="qb__filters">
        <input v-model="f.q" class="qb__search" placeholder="搜索题干 / 标题…（回车）" @keydown.enter="reload" />
        <select v-model="f.qtype" @change="reload">
          <option value="">题型：全部</option>
          <option v-for="(t, k) in QTYPE_LABEL" :key="k" :value="k">{{ t }}（{{ facets.byQtype[k] || 0 }}）</option>
        </select>
        <select v-model="f.level" @change="reload">
          <option value="">难度：全部</option>
          <option v-for="l in LEVELS" :key="l" :value="l">{{ l }}（{{ facets.byLevel[l] || 0 }}）</option>
        </select>
        <select v-model.number="f.year" @change="reload">
          <option :value="0">年份：全部</option>
          <option v-for="y in yearKeys" :key="y" :value="Number(y)">{{ y }}（{{ facets.byYear[y] }}）</option>
        </select>
        <!-- 【v1470】排序：批量导入后每套在默认排序里是**倒的** ✗ → 这里可以切「按试卷 + 题号」✓ -->
        <select v-model="f.sort" title="列表排序：默认最新在前；「按试卷 + 题号」会把同一套排在一起、按卷面题号升序" @change="reload">
          <option value="id">排序：最新在前</option>
          <option value="paper">排序：按试卷 + 题号</option>
        </select>
        <select v-model="f.status" @change="reload">
          <option value="">状态：全部</option>
          <option v-for="s in STATUS_ORDER" :key="s" :value="s">{{ statusLabel(s) }}（{{ facets.byStatus[s] || 0 }}）</option>
        </select>
        <select v-model="f.sourceKind" @change="reload">
          <option value="">来源类别：全部</option>
          <option v-for="(c, k) in facets.bySourceKind" :key="k" :value="k">{{ k }}（{{ c }}）</option>
        </select>
        <label class="qb__chk"><input v-model="f.missingAnswer" type="checkbox" @change="reload" />缺答案 {{ facets.missing.answer }}</label>
        <label class="qb__chk"><input v-model="f.missingKp" type="checkbox" @change="reload" />缺知识点 {{ facets.missing.kp }}</label>
        <label class="qb__chk"><input v-model="f.missingSection" type="checkbox" @change="reload" />未归类 {{ facets.missing.section }}</label>
        <button class="qb__btn" @click="clearFilters">清空筛选</button>
      </div>

      <div class="qb__body">
        <aside class="qb__tree">
          <div class="qb__t1">章节</div>
          <button
            v-for="(c, s) in facets.bySection" :key="s" class="qb__node"
            :class="{ 'qb__node--on': f.section === s }" @click="pickSection(s)"
          >{{ s }}<span class="qb__n">{{ c }}</span></button>
          <div class="qb__t1">知识点（{{ kpKeys.length }}）</div>
          <div v-if="!kpKeys.length" class="qb__hint">还没有知识点标签 —— 在右边给题打上，这里就会长出来 ✓</div>
          <button
            v-for="(c, k) in facets.byKp" :key="k" class="qb__node"
            :class="{ 'qb__node--on': f.kp === k }" @click="pickKp(k)"
          >{{ k }}<span class="qb__n">{{ c }}</span></button>
        </aside>

        <main class="qb__list">
          <div v-if="!items.length" class="qb__empty">没有符合条件的题</div>
          <div class="qb__listbar">
            <label class="qb__chk"><input type="checkbox" :checked="allPicked" @change="toggleAll" />全选（当前 {{ items.length }} 道）</label>
            <span v-if="picked.length" class="qb__hint2">已勾 {{ picked.length }} 道</span>
          </div>
          <div
            v-for="it in items" :key="it.id" class="qb__card"
            :class="{ 'qb__card--on': it.id === selId, 'qb__card--pick': picked.includes(it.id) }" @click="select(it)"
          >
            <label class="qb__pick" title="勾选（批量操作）" @click.stop>
              <input type="checkbox" :checked="picked.includes(it.id)" @change="togglePick(it)" />
            </label>
            <div class="qb__chips">
              <span class="qb__chip qb__chip--code" :class="{ 'qb__chip--warn': !it.code }" :title="it.code || '没有编号（写库漏了 lib_prepare_qmeta）'">{{ it.code || '无编号' }}</span>
              <!-- 【v1470】这道题在原卷里是第几题 ✓（老师要的：一眼看出顺序 ✓） -->
              <span v-if="noOf(it)" class="qb__chip qb__chip--no" :title="'这道题在原卷里是第 ' + noOf(it) + ' 题'">第{{ noOf(it) }}题</span>
              <span class="qb__chip" :class="{ 'qb__chip--warn': !it.section }">{{ it.section || '未归类' }}</span>
              <span class="qb__chip">{{ QTYPE_LABEL[it.qtype] || '未判题型' }}</span>
              <span v-if="it.level" class="qb__chip">{{ it.level }}</span>
              <span class="qb__chip" :class="{ 'qb__chip--warn': !it.year }">{{ it.year ? it.year + ' 年' : '无年份' }}</span>
              <span class="qb__chip qb__chip--st" :class="'qb__chip--st-' + (it.status || 'none')">{{ statusLabel(it.status) }}</span>
              <span v-if="it.sourceKind" class="qb__chip qb__chip--src">{{ it.sourceKind }}</span>
              <span v-if="!metaOf(it).answer" class="qb__chip qb__chip--warn">缺答案</span>
              <span v-if="it.warn" class="qb__chip qb__chip--alert" :title="it.warn">⚠ 告警</span>
            </div>
            <div class="qb__stem">{{ excerptOf(it.body || it.title) }}</div>
            <div v-if="it.kp.length" class="qb__kps">{{ it.kp.join(' · ') }}</div>
          </div>
        </main>

        <aside class="qb__view">
          <div v-if="!sel" class="qb__empty">左边点一道题 → 这里看题干 / 选项 / 答案，并能就地补全</div>
          <template v-else>
            <div class="qb__chips qb__chips--top">
              <span class="qb__chip">#{{ sel.id }}</span>
              <span v-if="noOf(sel)" class="qb__chip qb__chip--no" :title="'这道题在原卷（' + (sel.paper || '未填试卷名') + '）里是第 ' + noOf(sel) + ' 题'">第{{ noOf(sel) }}题</span>
              <span class="qb__chip qb__chip--code" :class="{ 'qb__chip--warn': !sel.code }">{{ sel.code || '无编号' }}</span>
              <span class="qb__chip qb__chip--st" :class="'qb__chip--st-' + (sel.status || 'none')">{{ statusLabel(sel.status) }}</span>
              <span class="qb__chip" :class="{ 'qb__chip--warn': !sel.paper }">{{ sel.paper || '来源未填' }}</span>
              <span v-if="sel.sourceKind" class="qb__chip qb__chip--src">{{ sel.sourceKind }}</span>
              <span class="qb__chip">{{ sel.difficulty ? '难度 ' + sel.difficulty : '难度未填' }}</span>
            </div>
            <div v-if="sel.warn" class="qb__warnbox">⚠ {{ sel.warn }}</div>
            <div ref="previewHost" class="qb__preview" @click="onPreviewClick"></div>
            <!-- 【v1466】题图：上传 / Ctrl+V 粘贴 / 直接用我们的数学图形 —— 存进 meta.images，题干自动补 [图N] ✓ -->
            <div class="qb__figs">
              <div class="qb__t1">
                题图
                <span class="qb__hint2">{{ figMsg || '可上传、可直接 Ctrl+V 粘贴，也能用「数学图形」现画一张 ✓' }}</span>
              </div>
              <div v-if="figsOf(sel).length" class="qb__figrow">
                <div v-for="im in figsOf(sel)" :key="im.n" class="qb__figitem">
                  <img :src="im.src" :alt="im.caption || ('图' + im.n)" />
                  <span class="qb__figcap">图{{ im.n }}</span>
                  <!-- 【v1466】图注就地改 —— 提示里写着「可换图注」，可之前根本没有能改的地方 ✗ -->
                  <input
                    class="qb__figcapin"
                    :value="im.caption || ''"
                    :title="'图' + im.n + ' 的图注（改完回车或点开别处即存 ✓）'"
                    placeholder="图注…"
                    @change="setFigCaption(Number(im.n), $event)"
                  />
                  <button class="qb__figdel" title="删除这张图（其余图号自动重排）" @click="removeQuestionFigure(Number(im.n))">✕</button>
                </div>
              </div>
              <div v-else class="qb__hint">这道题还没有图</div>
              <div class="qb__figbtns">
                <label class="qb__btn" :title="'上传图片（png / jpg / webp / gif / svg，单张 ≤ 4MB）'">
                  上传图片<input type="file" accept="image/*" multiple style="display:none" @change="onPickFigFile" />
                </label>
                <button class="qb__btn" :disabled="figBusy" title="打开数学图形面板：点哪张，哪张就成为本题的题图（函数图像 / 圆锥曲线 / 平面几何 / 立体几何 …）" @click="pickMathFigure">数学图形</button>
                <button class="qb__btn" :disabled="figBusy" title="三维立体图：在三维窗口里调好后插到本题" @click="pickGeom3DFigure">三维图</button>
              </div>
            </div>


            <div class="qb__form">
              <!-- 【v1467】再编辑：正文三件（题干 / 选项 / 解析）——
                   以前这里只有元数据 + 答案 ✗，「再编辑」其实改不了题面 ✗ -->
              <label class="qb__full">题干（公式写 $…$，图片位置用 [图N] 占位）
                <textarea v-model="form.stem" rows="5" placeholder="题干正文…"></textarea>
              </label>
              <label class="qb__full">选项（一行一个；非选择题留空）
                <textarea v-model="form.optionsText" rows="3" placeholder="A. …&#10;B. …"></textarea>
              </label>
              <label>章节
                <select v-model="form.section">
                  <option value="">未归类</option>
                  <option v-for="s in SECTIONS" :key="s" :value="s">{{ s }}</option>
                </select>
              </label>
              <label>题型
                <select v-model="form.qtype">
                  <option value="">未判</option>
                  <option v-for="(t, k) in QTYPE_LABEL" :key="k" :value="k">{{ t }}</option>
                </select>
              </label>
              <label>难度档
                <select v-model="form.level">
                  <option value="">未填</option>
                  <option v-for="l in LEVELS" :key="l" :value="l">{{ l }}</option>
                </select>
              </label>
              <label>年份
                <input v-model.number="form.year" type="number" min="1900" max="2100" />
              </label>
              <label>状态
                <select v-model="form.status">
                  <option value="">（保持原状态）</option>
                  <option v-for="s in STATUS_ORDER" :key="s" :value="s">{{ statusLabel(s) }}</option>
                </select>
              </label>
              <label class="qb__full">试卷名 / 来源
                <input v-model="form.paperName" placeholder="例如：2026届高三年级数学学科试卷" />
              </label>
              <label class="qb__full">答案
                <textarea v-model="form.answer" rows="2" placeholder="原卷没有就留空 ✓（不要自己解题）"></textarea>
              </label>
              <label class="qb__full">解析（可选；公式同样写 $…$）
                <textarea v-model="form.solution" rows="3" placeholder="原卷没有就留空 ✓（不要自己解题）"></textarea>
              </label>
              <label class="qb__full">知识点（逗号/顿号分隔）
                <input v-model="form.kpText" list="qb-kp" placeholder="例如：导数、单调性（可点开词表挑 ✓）" />
              </label>
              <div class="qb__actions">
                <button class="qb__btn qb__btn--main" :disabled="busy" @click="save">保存这一道</button>
              </div>
            </div>
          </template>
        </aside>
      </div>

      <footer class="qb__foot">
        <span class="qb__picked">已勾 {{ picked.length }} 道<template v-if="!picked.length && sel">（未勾 → 用当前这道）</template></span>
        <label class="qb__chk"><input v-model="withAnswer" type="checkbox" />插入带答案/解析</label>
        <span class="qb__sep"></span>
        <button class="qb__btn qb__btn--main" :disabled="busy" title="题干+选项做成混排元素插入当前页（公式按 $…$ 渲染）" @click="insertToSlide">插入幻灯片</button>
        <button class="qb__btn" :disabled="busy" title="把题干+选项交到试卷正文末尾（试卷没开就打开它）" @click="addToPaper">加入试卷</button>
        <span class="qb__sep"></span>
        <select v-model="batchSection" class="qb__mini" :disabled="!picked.length">
          <option value="">批量改章节…</option>
          <option v-for="s in SECTIONS" :key="s" :value="s">{{ s }}</option>
        </select>
        <button class="qb__btn" :disabled="busy || !picked.length || !batchSection" @click="batchPatchSection">应用</button>
        <input v-model="batchKp" class="qb__mini qb__mini--wide" placeholder="批量打知识点（逗号分隔）" :disabled="!picked.length" />
        <button class="qb__btn" :disabled="busy || !picked.length || !batchKp.trim()" @click="batchPatchKp">应用</button>
        <button class="qb__btn qb__btn--danger" :disabled="busy || !picked.length" @click="batchDelete">删除</button>
        <span v-if="lastBackup" class="qb__bak" :title="lastBackup">删除前已自动备份整库</span>
      </footer>
    </div>

    <QuestionImportDialog v-if="importOpen" @close="importOpen = false" @imported="onImported" />
    <DraftBox v-if="draftOpen" @close="draftOpen = false" @committed="onImported" />

    <!-- 【P0b】知识点建议：来自受控词表 kp_catalog（kind=knowledge 的板块级词）✓ -->
    <datalist id="qb-kp"><option v-for="k in kpOptions" :key="k" :value="k"></option></datalist>

    <!-- 【优化】补答案：从产物缓存重新拆（对不上不动、只补不覆盖 ✓） -->
    <div v-if="ansOpen" class="qb__rpt" @click.self="ansOpen = false">
      <div class="qb__rptbox">
        <header class="qb__rpthead">
          <span class="qb__title">补答案</span>
          <span class="qb__sub">从录入时的产物缓存重新拆 · 纯本地 · <b>只补不覆盖</b></span>
          <button class="qb__close" title="关闭" @click="ansOpen = false"><AppIcon name="close" :size="13" /></button>
        </header>
        <div class="qb__rptbody">
          <div class="qb__hint">{{ ansMsg }}</div>
          <div v-if="ansBusy" class="qb__empty">正在跑…</div>
          <template v-else-if="ansScan">
            <div class="qb__rptcards">
              <div class="qb__rptcard"><b>{{ ansScan.caches }}</b><span>产物缓存</span></div>
              <div class="qb__rptcard"><b>{{ ansScan.cachesWithAns }}</b><span>含答案的缓存</span></div>
              <div class="qb__rptcard"><b>{{ ansScan.answers }}</b><span>缓存里的答案</span></div>
              <div class="qb__rptcard"><b>{{ ansScan.missing }}</b><span>库里缺答案</span></div>
              <div class="qb__rptcard" :class="{ 'qb__rptcard--warn': ansScan.candidates.length > 0 }"><b>{{ ansScan.candidates.length }}</b><span>可补</span></div>
            </div>
            <div v-if="!ansScan.candidates.length" class="qb__hint2">这批卷的产物缓存里没有答案区（或题干对不上）→ 没有可补的 ✓</div>
            <template v-else>
              <div class="qb__rptrow qb__rptrow--head">
                <span class="qb__rptcode">编号</span>
                <span class="qb__rptpaper">题干</span>
                <span class="qb__rptarrow">配</span>
                <span class="qb__rptnew">拆到的答案</span>
              </div>
              <div v-for="c in ansScan.candidates" :key="c.id" class="qb__rptrow">
                <label class="qb__rptcode"><input type="checkbox" :checked="!!ansPicked[c.id]" @change="toggleAns(c.id)" /> {{ c.code }}</label>
                <span class="qb__rptpaper">{{ c.stem }}</span>
                <span class="qb__rptarrow" :title="c.match === 'exact' ? '题干整篇一致' : '前 30 字一致（识别差异），请重点核对'">{{ c.match === 'exact' ? '=' : '≈' }}</span>
                <span class="qb__rptnew">{{ c.answer || '（只有解析）' }}</span>
              </div>
              <div style="margin-top: 8px">
                <button class="qb__btn qb__btn--main" :disabled="ansBusy || !ansPickedN()" @click="doAnswerFill">补到勾选的 {{ ansPickedN() }} 道</button>
              </div>
            </template>
          </template>
        </div>
      </div>
    </div>

        <!-- 【§49】AI 打标：批量打知识点 / 难度 / 板块 —— 结果先进确认表，勾选后才写库 ✓ -->
    <div v-if="aiOpen" class="qb__rpt" @click.self="aiOpen = false">
      <div class="qb__rptbox qb__rptbox--wide">
        <header class="qb__rpthead">
          <span class="qb__title">AI 打标</span>
          <span class="qb__sub">知识点 / 难度 / 板块 · <b>只填空字段</b> · 一次 {{ AI_BATCH }} 道（可暂停）· 写库前逐条确认 ✓</span>
          <button class="qb__close" title="关闭" @click="aiOpen = false"><AppIcon name="close" :size="13" /></button>
        </header>
        <div class="qb__rptbody">
          <div class="qb__hint">{{ aiMsg }}</div>

          <div class="qb__rptcards">
            <div class="qb__rptcard"><b>{{ aiStats.total }}</b><span>本次对象</span></div>
            <div class="qb__rptcard"><b>{{ aiStats.done }}</b><span>已问过 AI</span></div>
            <div class="qb__rptcard"><b>{{ aiStats.ok }}</b><span>有建议</span></div>
            <div class="qb__rptcard" :class="{ 'qb__rptcard--warn': aiStats.bad > 0 }"><b>{{ aiStats.bad }}</b><span>没读懂 / 失败</span></div>
            <div class="qb__rptcard" :class="{ 'qb__rptcard--warn': aiStats.writable > 0 }"><b>{{ aiStats.writable }}</b><span>可写库</span></div>
          </div>

          <div class="qb__aibar">
            <button class="qb__btn qb__btn--main" :disabled="aiBusy || aiStats.done >= aiStats.total" @click="runAiTag(AI_BATCH)">
              {{ aiStats.done ? '继续（再跑 ' + AI_BATCH + ' 道）' : '开始打标' }}
            </button>
            <button class="qb__btn" :disabled="!aiBusy" @click="pauseAiTag">暂停</button>
            <button class="qb__btn" :disabled="aiBusy || !aiStats.bad" @click="retryAiFailed">重试失败的 {{ aiStats.bad }} 道</button>
            <label class="qb__chk" title="导入时补的默认难度是 difficulty=3 + level=中档（线上 156 道全是它）—— 那不是老师手填的，默认允许 AI 覆盖 ✓；关掉就退回严格「只填空字段」✓">
              <input type="checkbox" v-model="aiOverwrite" @change="rebuildAiRows" />覆盖导入默认难度（3 / 中档）
            </label>
            <span class="qb__sep"></span>
            <button class="qb__btn qb__btn--main" :disabled="aiBusy || !aiStats.writable" @click="applyAiTag">写库（{{ aiStats.writable }} 道）</button>
          </div>

          <div v-if="!aiStats.done" class="qb__hint2">
            点「开始打标」：AI 一道一道判，每 {{ AI_BATCH }} 道停一下（省 token，也方便中途看结果 ✓）。
            没读懂 / 接口失败的会<b>逐条列出来</b>，不会静默跳过 ✓。
          </div>
          <template v-else>
            <div class="qb__airow qb__airow--head">
              <span class="qb__aichk">采纳</span>
              <span class="qb__aicode">题号</span>
              <span class="qb__aistem">题干摘要</span>
              <span class="qb__aicur">现有标签</span>
              <span class="qb__aiai">AI 建议（可逐条改 ✓）</span>
            </div>
            <div
              v-for="r in aiRows" :key="r.id" class="qb__airow"
              :class="{ 'qb__airow--bad': !!r.err, 'qb__airow--done': r.written }"
            >
              <label class="qb__aichk"><input type="checkbox" v-model="r.adopt" :disabled="!!r.err || r.written" @change="noteAiEdit(r)" /></label>
              <span class="qb__aicode">{{ r.code || ('#' + r.id) }}</span>
              <span class="qb__aistem" :title="r.stem">{{ r.stem || '（题干为空）' }}</span>
              <span class="qb__aicur" :title="'现有：' + (r.cur.kp.join('、') || '无知识点') + ' · ' + (r.cur.section || '未归类') + ' · ' + (r.cur.difficulty ? '难度 ' + r.cur.difficulty : '难度未填')">
                <span :class="{ 'qb__miss': !r.cur.kp.length }">{{ r.cur.kp.length ? r.cur.kp.join('、') : '无知识点' }}</span>
                <span class="qb__aidot">·</span>
                <span :class="{ 'qb__miss': !r.cur.section }">{{ r.cur.section || '未归类' }}</span>
                <span class="qb__aidot">·</span>
                <span :class="{ 'qb__miss': !r.cur.difficulty }">{{ r.cur.difficulty ? '难度 ' + r.cur.difficulty : '难度未填' }}{{ r.cur.level ? ' ' + r.cur.level : '' }}</span>
              </span>
              <span class="qb__aiai">
                <template v-if="r.err"><span class="qb__aiwarn">{{ r.err }}</span></template>
                <template v-else>
                  <input v-model="r.edit.kpText" class="qb__aiin" :disabled="!r.adopt || r.written" :placeholder="r.keep.kp || '知识点（、分隔）'" @input="noteAiEdit(r)" />
                  <select v-model="r.edit.level" class="qb__aisel" :disabled="!r.adopt || r.written" :title="r.keep.level || '难度档'" @change="noteAiEdit(r)">
                    <option value="">档：不写</option>
                    <option v-for="l in LEVELS" :key="l" :value="l">{{ l }}</option>
                  </select>
                  <input v-model.number="r.edit.difficulty" class="qb__ainum" type="number" min="1" max="5" :disabled="!r.adopt || r.written" :title="r.keep.difficulty || '难度 1-5'" placeholder="难度" @input="noteAiEdit(r)" />
                  <select v-model="r.edit.section" class="qb__aisel qb__aisel--wide" :disabled="!r.adopt || r.written" :title="r.keep.section || '板块'" @change="noteAiEdit(r)">
                    <option value="">板块：不写</option>
                    <option v-for="s in AI_SECTIONS" :key="s" :value="s">{{ s }}</option>
                  </select>
                  <span v-if="aiKeepHint(r)" class="qb__aihint">{{ aiKeepHint(r) }}</span>
                  <span v-if="r.written" class="qb__aidone">✓ 已写库</span>
                  <span v-else-if="aiWill(r)" class="qb__aiwill">将写：{{ aiWill(r) }}</span>
                </template>
              </span>
            </div>
          </template>
          <div class="qb__hint2">写完可回退：每道题都留了 revision 快照（lib_q_patch ✓）；打完标就能在左边按知识点 / 难度筛出来了 ✓</div>
        </div>
      </div>
    </div>
    <!-- 【P0b】来源报告：把 lib_source_report 的数字摊开（覆盖率 ≠ 成型率，两个都摆出来 ✓） -->
    <div v-if="reportOpen" class="qb__rpt" @click.self="reportOpen = false">
      <div class="qb__rptbox">
        <header class="qb__rpthead">
          <span class="qb__title">来源报告</span>
          <span class="qb__sub">「有来源」≠「来源成型」—— 两个数分开看 ✓</span>
          <button class="qb__close" title="关闭" @click="reportOpen = false"><AppIcon name="close" :size="13" /></button>
        </header>
        <div v-if="reportBusy" class="qb__empty">正在统计…</div>
        <div v-else-if="!report" class="qb__empty">读不到报告</div>
        <div v-else class="qb__rptbody">
          <div v-if="report.error" class="qb__warnbox">{{ report.error }}</div>
          <div class="qb__rptcards">
            <div class="qb__rptcard"><b>{{ report.total }}</b><span>题目总数</span></div>
            <div class="qb__rptcard"><b>{{ report.empty }}</b><span>没有来源</span></div>
            <div class="qb__rptcard"><b>{{ report.canonical }}</b><span>来源成型</span></div>
            <div class="qb__rptcard" :class="{ 'qb__rptcard--warn': report.fillRate !== 100 }"><b>{{ report.fillRate }}%</b><span>来源覆盖率</span></div>
            <div class="qb__rptcard" :class="{ 'qb__rptcard--warn': report.canonicalRate !== 100 }"><b>{{ report.canonicalRate }}%</b><span>成型率（有来源的里面）</span></div>
          </div>
          <div class="qb__t1">
            来源归一建议
            <span v-if="plan && plan.aliasTableLoaded" class="qb__hint2">（已读库外别名表）</span>
          </div>
          <div v-if="planBusy" class="qb__hint">正在算建议…</div>
          <template v-else-if="plan">
            <div class="qb__rptcards">
              <div class="qb__rptcard"><b>{{ plan.canonical }}</b><span>来源已成型</span></div>
              <div class="qb__rptcard"><b>{{ plan.alias }}</b><span>别名表命中</span></div>
              <div class="qb__rptcard"><b>{{ plan.rule }}</b><span>规则可整</span></div>
              <div class="qb__rptcard"><b>{{ plan.template }}</b><span>模板半成品</span></div>
              <div class="qb__rptcard" :class="{ 'qb__rptcard--warn': plan.none + plan.noPaper > 0 }"><b>{{ plan.none + plan.noPaper }}</b><span>只能人工填</span></div>
            </div>
            <div class="qb__rptrow qb__rptrow--head">
              <span class="qb__rptcode">编号</span>
              <span class="qb__rptpaper">现在</span>
              <span class="qb__rptarrow"></span>
              <span class="qb__rptnew">建议</span>
            </div>
            <div v-for="it in plan.items.slice(0, 60)" :key="it.id" class="qb__rptrow">
              <span class="qb__rptcode">{{ it.code || ('#' + it.id) }}</span>
              <span class="qb__rptpaper">{{ it.paper }}</span>
              <span class="qb__rptarrow">→</span>
              <span class="qb__rptnew" :class="{ 'qb__rptnew--warn': it.needManual }">{{ it.suggest || '（认不出，要人工填）' }}</span>
            </div>
            <div v-if="plan.items.length > 60" class="qb__hint">只显示前 60 条（共 {{ plan.items.length }} 条）</div>
            <div v-if="plan.noPaper > 0" class="qb__hint">另有 {{ plan.noPaper }} 道来源空着（不猜，只能人工填）</div>
            <div class="qb__rptactions">
              <button class="qb__btn qb__btn--main" :disabled="busy || !actionable.length" title="只生成草稿：正式库一个字不改，去草稿箱确认后才生效" @click="makeSourceDrafts">生成 {{ actionable.length }} 条归一草稿</button>
            </div>
          </template>
          <div v-else-if="planError" class="qb__warnbox">{{ planError }}</div>
          <div class="qb__t1">按来源类别</div>
          <div v-if="!report.byKind.length" class="qb__hint">还没有题目 ✓</div>
          <div class="qb__chips">
            <span v-for="r in report.byKind" :key="r.kind" class="qb__chip">{{ r.kind }} {{ r.count }}</span>
          </div>
          <div class="qb__t1">需要处理（{{ report.needsWork.length }}）</div>
          <div v-if="!report.needsWork.length" class="qb__hint">来源都成型了 ✓</div>
          <div v-for="r in report.needsWork.slice(0, 200)" :key="r.id" class="qb__rptrow" @click="jumpTo(r.id)">
            <span class="qb__rptcode">#{{ r.id }}</span>
            <span class="qb__rptpaper">{{ r.paper }}</span>
            <span class="qb__rpttitle">{{ r.title }}</span>
          </div>
          <div v-if="report.needsWork.length > 200" class="qb__hint">只显示前 200 条（共 {{ report.needsWork.length }} 条）</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 【v1472】题库从「全屏模态」改成**浮窗** ✓ —— 老师要的是「题库 / 试卷 / 幻灯片 自由切换」：
   ① 遮罩去掉 + 外层 pointer-events:none → **点得到后面的画布/试卷** ✓（以前整屏都点不动 ✗）；
   ② z-index 2050：**浮在试卷(2000)之上** ✓、仍在图形面板(2200)/三维(3200)之下 ✓（那些是从这里打开的 ✓）；
   ③ 可拖动 + 可收起（标题栏右侧「收起」✓）—— 收起后只剩一条标题栏，看幻灯片/试卷不挡 ✓。
   位置与收起状态记在 localStorage ✓，下次打开还是你摆的样子 ✓。 */
.qb { position: fixed; inset: 0; z-index: 2050; background: transparent; display: flex; align-items: center; justify-content: center; pointer-events: none; }
.qb__box { pointer-events: auto; max-width: calc(100vw - 12px); max-height: calc(100vh - 12px); background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: 96vw; max-width: 1280px; height: 88vh; display: flex; flex-direction: column; overflow: hidden; }
.qb__box--mini { width: auto; max-width: 96vw; height: auto; }
.qb__box--mini .qb__filters, .qb__box--mini .qb__body, .qb__box--mini .qb__foot, .qb__box--mini .qb__rpt { display: none; }
.qb__head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border); cursor: move; user-select: none; }
.qb__box--mini .qb__head { border-bottom: 0; }
.qb__btn--mini { height: 24px; padding: 0 8px; font-size: 12px; }
.qb__title { font-size: 15px; font-weight: 700; color: var(--text); }
.qb__sub { font-size: 12px; color: var(--muted); }
.qb__badge { font-size: 11px; line-height: 16px; padding: 0 7px; border-radius: 999px; border: 1px solid #e0cf9a; background: #fdf6e3; color: #8a6a12; white-space: nowrap; }
.qb__msg { font-size: 12px; color: var(--brand-600, #534AB7); }
.qb__headrt { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.qb__close { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; cursor: pointer; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--gray-600); }
.qb__filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 16px; border-bottom: 1px solid var(--border); font-size: 12px; }
.qb__search { flex: 1; min-width: 160px; height: 28px; padding: 0 8px; border: 1px solid var(--border); border-radius: 6px; font-size: 12.5px; }
.qb__filters select, .qb__form select, .qb__form input, .qb__form textarea { height: 28px; padding: 0 6px; border: 1px solid var(--border); border-radius: 6px; font-size: 12.5px; background: #fff; color: var(--text); }
.qb__form textarea { height: auto; padding: 5px 6px; line-height: 1.5; resize: vertical; font-family: inherit; }
.qb__chk { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); white-space: nowrap; }
.qb__btn { height: 28px; padding: 0 10px; border: 1px solid var(--border); border-radius: 6px; background: #fff; font-size: 12.5px; cursor: pointer; color: var(--text); }
.qb__btn--main { background: var(--brand-600, #534AB7); border-color: var(--brand-600, #534AB7); color: #fff; }
.qb__btn:disabled { opacity: .6; cursor: default; }
/* 【v1473】靠右停靠：题库只占右侧 ~46vw，**左边整块留给画布与缩略图列表** ✓
   —— 实测（v2900 探针）：整屏浮窗虽然不拦点击 ✓，但它盖住 78% 的面积 ✗（缩略图列表 x≈108 正好被压住 ✗），
   真鼠标点第 2 页**没反应** ✗ —— 老师说的「题库和画布不能切换」就是这个 ✗。 */
.qb--dock { justify-content: flex-end; align-items: center; padding-right: 8px; }
.qb--dock .qb__box { width: 46vw; max-width: 920px; height: 92vh; }
.qb--dock .qb__tree { display: none; }                                   /* 左树藏掉（省 200px，章节筛选仍可从筛选条/整屏模式用 ✓） */
.qb--dock .qb__body { grid-template-columns: 1fr 380px; }
.qb__body { flex: 1; min-height: 0; display: grid; grid-template-columns: 200px 1fr 400px; }
.qb__tree { border-right: 1px solid var(--border); overflow-y: auto; padding: 8px 6px; }
.qb__t1 { font-size: 11px; font-weight: 700; color: var(--muted); padding: 8px 6px 4px; letter-spacing: .04em; }
.qb__node { display: flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%; padding: 5px 8px; border: 0; background: transparent; border-radius: 6px; font-size: 12.5px; color: var(--text); text-align: left; cursor: pointer; }
.qb__node:hover { background: var(--panel-2, #f4f3ef); }
.qb__node--on { background: var(--brand-600, #534AB7); color: #fff; }
.qb__n { font-size: 11px; color: var(--muted); }
.qb__node--on .qb__n { color: #fff; opacity: .85; }
.qb__hint { padding: 4px 8px; font-size: 11.5px; color: var(--muted); line-height: 1.6; }
.qb__list { overflow-y: auto; padding: 8px; }
.qb__card { display: block; width: 100%; text-align: left; padding: 8px 10px; margin-bottom: 6px; border: 1px solid var(--border); border-radius: 8px; background: #fff; cursor: pointer; }
.qb__card:hover { border-color: var(--border-strong); }
.qb__card--on { border-color: var(--brand-600, #534AB7); box-shadow: 0 0 0 1px var(--brand-600, #534AB7) inset; }
.qb__chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
.qb__chips--top { margin: 0 0 6px; }
.qb__chip { font-size: 10.5px; padding: 1px 6px; border-radius: 999px; background: var(--panel-2, #f4f3ef); color: var(--muted); white-space: nowrap; }
.qb__chip--warn { background: #fdf0e6; color: #b3541e; }
.qb__stem { font-size: 12.5px; color: var(--text); line-height: 1.55; }
.qb__kps { margin-top: 3px; font-size: 11px; color: var(--brand-600, #534AB7); }
.qb__view { border-left: 1px solid var(--border); overflow-y: auto; padding: 10px 12px; }
.qb__preview { font-size: 13px; line-height: 1.7; color: var(--text); margin-bottom: 10px; }
/* 【v1455】题图 */
/* 【v1455/v1458】题图 —— ⚠ 必须用 :deep()：figure 是 innerHTML 注入的，
   拿不到 scoped 的 data-v 属性（v1455 的样式**一直没生效**，图按原尺寸撑满整屏 ✗ 现已修 ✓） */
.qb__preview :deep(.qb__fig) { margin: 6px 0; display: flex; flex-direction: column; gap: 2px; align-items: flex-start; }
.qb__preview :deep(.qb__fig img) { max-width: min(100%, 320px); max-height: 150px; object-fit: contain; cursor: zoom-in; border: 1px solid var(--border); border-radius: 6px; background: #fff; }
.qb__preview :deep(.qb__fig--zoom img) { max-width: 100%; max-height: none; cursor: zoom-out; }
.qb__preview :deep(.qb__fig figcaption) { font-size: 11px; color: var(--muted); }

/* 【v1466】题图编辑区（上传 / 粘贴 / 数学图形 / 三维图） */
.qb__figs { border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; }
.qb__figrow { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0; }
.qb__figitem { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.qb__figitem img { max-width: 120px; max-height: 90px; object-fit: contain; border: 1px solid var(--border); border-radius: 6px; background: #fff; }
.qb__figcap { font-size: 10.5px; color: var(--muted); }
.qb__figcapin { width: 112px; padding: 1px 3px; border: 1px solid transparent; border-radius: 4px; background: transparent; font-size: 10.5px; color: var(--text); text-align: center; }
.qb__figcapin:hover, .qb__figcapin:focus { border-color: var(--border); background: #fff; outline: none; }
.qb__figdel { position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; line-height: 16px; text-align: center; border-radius: 50%; border: 1px solid var(--border-strong); background: #fff; color: var(--gray-600); cursor: pointer; font-size: 11px; }
.qb__figdel:hover { color: #b42318; border-color: #b42318; }
.qb__figbtns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.qb__figbtns .qb__btn { cursor: pointer; }

.qb__form { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; border-top: 1px solid var(--border); padding-top: 10px; }
.qb__form label { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; color: var(--muted); }
.qb__full { grid-column: 1 / -1; }
.qb__actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; }
.qb__empty { padding: 20px 10px; color: var(--muted); font-size: 12.5px; line-height: 1.7; }
.qb__miss { color: #b3541e; }
/* ---- M3：多选 / 批量 / 插入 ---- */
.qb__listbar { display: flex; align-items: center; gap: 8px; padding: 2px 4px 8px; }
.qb__hint2 { font-size: 11px; color: var(--brand-600, #534AB7); }
.qb__card { position: relative; padding-right: 32px; }
.qb__card--pick { background: #f6f4ff; border-color: var(--brand-600, #534AB7); }
.qb__pick { position: absolute; top: 9px; right: 9px; display: inline-flex; }
.qb__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 9px 16px; border-top: 1px solid var(--border); background: var(--panel-2, #faf9f6); font-size: 12px; }
.qb__picked { color: var(--muted); font-size: 12px; }
.qb__sep { width: 1px; height: 18px; background: var(--border); }
.qb__mini { height: 28px; padding: 0 6px; border: 1px solid var(--border); border-radius: 6px; font-size: 12.5px; background: #fff; color: var(--text); }
.qb__mini--wide { width: 200px; }
.qb__btn--danger { color: #b42318; border-color: #f0c9c4; }
.qb__btn--danger:disabled { color: var(--muted); border-color: var(--border); }
.qb__bak { font-size: 11px; color: var(--muted); }
/* ---- 【P0b】编号 / 状态 / 来源类别 / 告警 ---- */
.qb__chip--code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #eef1f6; color: #3a4252; }
.qb__chip--src { background: #eaf3ec; color: #2f6b45; }
.qb__chip--no { background: #eef4ff; color: #1d4e89; font-variant-numeric: tabular-nums; }
.qb__chip--st { background: #eef1f6; color: #3a4252; }
.qb__chip--st-published { background: #e6f4ea; color: #1f6b3a; }
.qb__chip--st-ready, .qb__chip--st-approved { background: #e8effa; color: #2a4f8f; }
.qb__chip--st-draft, .qb__chip--st-needs_review { background: #fdf3e3; color: #9a6212; }
.qb__chip--st-rejected { background: #f6e7e6; color: #9a2b22; }
.qb__chip--st-none { background: #f1f1f1; }
.qb__chip--alert { background: #fdeceb; color: #a02016; font-weight: 600; }
.qb__warnbox { margin: 0 0 8px; padding: 6px 8px; border: 1px solid #f3d3ce; border-radius: 6px; background: #fdf3f2; color: #8f2a1b; font-size: 12px; line-height: 1.6; }
.qb__rpt { position: absolute; inset: 0; z-index: 12; background: rgba(20, 24, 34, 0.45); display: flex; align-items: center; justify-content: center; }
.qb__rptbox { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: min(880px, 92%); max-height: 84%; display: flex; flex-direction: column; overflow: hidden; }
.qb__rpthead { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.qb__rpthead .qb__close { margin-left: auto; }
.qb__rptbody { overflow-y: auto; padding: 12px 16px; }
.qb__rptcards { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; }
.qb__rptcard { flex: 1 1 130px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel-2, #faf9f6); display: flex; flex-direction: column; gap: 2px; }
.qb__rptcard b { font-size: 17px; color: var(--text); }
.qb__rptcard span { font-size: 11px; color: var(--muted); }
.qb__rptcard--warn b { color: #b3541e; }
.qb__rptrow { display: flex; align-items: baseline; gap: 8px; padding: 4px 2px; border-bottom: 1px dashed var(--border); font-size: 12px; cursor: pointer; }
.qb__rptrow:hover { background: var(--panel-2, #f4f3ef); }
.qb__rptcode { color: var(--muted); font-family: ui-monospace, monospace; }
.qb__rptpaper { color: #8f2a1b; max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qb__rptrow--head { color: var(--muted); font-size: 11px; }
.qb__rptrow--head:hover { background: transparent; }
.qb__rptarrow { color: var(--muted); }
.qb__rptnew { color: #2f6b45; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qb__rptnew--warn { color: #9a6212; }
.qb__rptactions { display: flex; justify-content: flex-end; margin: 8px 0 4px; }
.qb__rpttitle { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 【§49】AI 打标：确认表比「补答案」那张宽（5 栏 + 可编辑输入 ✓） */
.qb__rptbox--wide { width: min(1180px, 96vw); }
.qb__aibar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 8px 0; }
.qb__airow { display: grid; grid-template-columns: 40px 84px 1fr 210px 400px; gap: 8px; align-items: center; padding: 4px 2px; border-bottom: 1px dashed var(--border); font-size: 12px; }
.qb__airow--head { color: var(--muted); font-size: 11px; border-bottom-style: solid; }
.qb__airow--bad { background: #fdf3f2; }
.qb__airow--done { opacity: 0.55; }
.qb__aichk { display: inline-flex; align-items: center; }
.qb__aicode { color: var(--muted); font-family: ui-monospace, monospace; }
.qb__aistem { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qb__aicur { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qb__aidot { margin: 0 4px; }
.qb__aiai { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.qb__aiin { flex: 1 1 150px; min-width: 90px; height: 24px; padding: 0 6px; border: 1px solid var(--border); border-radius: 6px; font-size: 12px; }
.qb__aisel { height: 24px; border: 1px solid var(--border); border-radius: 6px; font-size: 12px; background: #fff; color: var(--text); }
.qb__aisel--wide { max-width: 132px; }
.qb__ainum { width: 58px; height: 24px; padding: 0 4px; border: 1px solid var(--border); border-radius: 6px; font-size: 12px; }
.qb__aihint { flex: 1 1 100%; color: #9a6212; font-size: 11px; }
.qb__aiwarn { color: #b3261e; }
.qb__aidone { color: #2f6b45; }
.qb__aiwill { flex: 1 1 100%; color: #2f6b45; font-size: 11px; }
</style>