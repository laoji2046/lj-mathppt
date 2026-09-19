<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import {
  listQuestions, addQuestion, updateQuestion, removeQuestion, touchQuestion,
  listQuestionTags, autoTitle, questionToText, filterQuestions,
  importParsedQuestions, proposeAnswers, parseQuestionsJson, exportQuestionsJson,
  pickByRules, ruleText, findDuplicates, groupPapers, paperGroupToText,
  buildPaperText, scoreOf, defaultScore, chaptersOf,
  scanJunk, scanDuplicates, removeQuestions,
  QTYPES, SECTIONS, LEVELS, levelOf, levelLabel, levelToDifficulty, qtypeLabel, withDefaults,
  reviewWarn, blueprintOf, healthOf,
} from '@/composables/useQuestionLibrary'
import type { QuestionEntry, QuestionMeta, QType, Level, PaperRule, RuleResult, PaperGroup, JunkItem } from '@/composables/useQuestionLibrary'
import { parseQuestionsWithInfo, PARSE_HELP, detectPaperInfo, setContentList } from '@/composables/parseQuestions'
import type { QuestionImage } from '@/composables/parseQuestions'
import { linkMineruImages, imagesForText, questionTextOf } from '@/composables/mineruImages'
import { saveTextFile, isTauri, listenTauri, mineruStagePdf, mineruParse } from '@/composables/useTauri'
import { useDeckStore } from '@/stores/deck'
import type { SlideElement } from '@/types'
import type { MineruProgress } from '@/composables/useTauri'

const props = defineProps<{
  /** **只管理、不插入**：从工具栏打开时用（那种入口背后没有"试卷正文"，插了就等于丢 ✗） */
  manageOnly?: boolean
}>()
const emit = defineEmits<{
  (e: 'close'): void
  /** id：单题 = 题库 id；整套 / 组卷 = 0（没有单题 id）；label：告诉调用方"插了什么" */
  (e: 'insert', text: string, id: number, label?: string, images?: QuestionImage[]): void
}>()

const list = ref<QuestionEntry[]>([])
const tags = ref<{ name: string; count: number }[]>([])
const loading = ref(true)
const msg = ref('')
const q = ref('')

/* ---- 批量导入（粘一整个文档，解析后一次性入库） ---- */
const batchOpen = ref(false)
const batchText = ref('')
const parsedInfo = computed(() => parseQuestionsWithInfo(batchText.value))
const parsed = computed(() => parsedInfo.value.list)
/**
 * 本批次（一次 MinerU 识别）的插图表：编号 N 对应正文里的 [图N]。
 * 整卷共用一个表，入库时再按题拆（imagesForText）—— 不能让第 3 题背上整卷的图。
 * 号是**整卷唯一**的，所以同一份卷子里不会有两道题都叫 [图1]。
 */
const batchImages = ref<QuestionImage[]>([])
/** 本批次统一套用的年份与试卷名（题内写了【年份】【试卷】则以题内为准） */
const batchYear = ref('')
const batchPaper = ref('')
/** 自动识别结果（粘进来就填，用户可以改） */
const detected = ref({ year: '', paperName: '', from: '' })
// 正文一变就重新识别：认出来就填进去，认不出就保持原样（不覆盖用户手填的内容）
watch(batchText, (v) => {
  const d = detectPaperInfo(v || '')
  detected.value = d
  // ⚠ 只在老师**还没手填**的时候自动带入 —— 原来是无条件覆盖（注释写着"不覆盖用户手填"，实际会覆盖 ✗）
  if (d.year && !batchYear.value.trim()) batchYear.value = d.year
  if (d.paperName && !batchPaper.value.trim()) batchPaper.value = d.paperName
})
/**
 * 把一组题里的 [图N] 按「这一次插入」重新编号，并给出配套的图片表。
 *
 * 为什么必须重编：两道来自不同卷子的题可能都写着 [图1]，直接拼在一起时，
 * 试卷那一侧只能按号替换 → 后插的图会把先插的顶掉（就是「指到同号错图」这类问题）。
 * 这里把整批的号拉通编成 1..k（只在本次插入内唯一），并把图片一起交给试卷侧注册。
 * 没有配图的 [图N]（手写的老题）**原样留着** —— 行为与改动前完全一致。
 */
function renumberForInsert(entries: QuestionEntry[]): { items: QuestionEntry[]; images: QuestionImage[] } {
  const all: QuestionImage[] = []
  let seq = 0
  const items = entries.map((e) => {
    const src = e.q.images || []
    if (!src.length) return e
    const map = new Map<number, QuestionImage>()
    const rewrite = (t: string) => String(t || '').replace(/\[图(\d+)((?::[^\[\]]*)?)\]/g, (m0, d: string, rest: string) => {
      const n = Number(d)
      const hit = src.find((x) => x.n === n)
      if (!hit) return m0
      let out = map.get(n)
      if (!out) { out = { n: ++seq, src: hit.src, caption: hit.caption }; map.set(n, out); all.push(out) }
      return '[图' + out.n + (rest || '') + ']'
    })
    return {
      ...e,
      q: {
        ...e.q,
        stem: rewrite(e.q.stem),
        options: e.q.options.map(rewrite),
        solution: rewrite(e.q.solution),
        images: Array.from(map.values()),
      },
    }
  })
  return { items, images: all }
}

/** 本批次里某一题引用到的插图数（预览用；入库时才真正按题拆） */
function imgCountOf(p: { stem?: string; options?: string[]; solution?: string }): number {
  return imagesForText(questionTextOf(p), batchImages.value).length
}

/** 一组题的卷面总分（题内分值优先，否则按题型默认） */
function paperTotal(arr: QuestionEntry[]): number {
  return arr.reduce((s, x) => s + scoreOf(x), 0)
}

/** 整套插入：按「年份 + 试卷名」归组的卷子列表 */
const paperGroups = computed(() => groupPapers(list.value))
function insertPaperGroup(g: PaperGroup, withSolution: boolean) {
  if (!g.items.length) { flash('这一套里没有题'); return }
  if (blockIfManageOnly()) return
  const name = (g.year ? g.year + ' ' : '') + (g.paperName || '未标试卷名的散题')
  // 整套插入是"一次灌一整卷"：先让老师看到 **N 道 / M 分** 再决定
  // （以前点一下就全灌进正文，散题组甚至会把整个"未归卷"都灌进来 ✗）
  const warn = g.paperName ? '' : '\n\n⚠ 这些题没有试卷名 —— 这是「未归卷」的散题合集，一次会把它们全部插入'
  if (!confirm('插入整套「' + name + '」？\n\n共 ' + g.count + ' 道，合计 ' + paperTotal(g.items) + ' 分' + warn)) return
  // 图片：整批拉通重编号后一起交给试卷侧（它再按自己的图号注册，保证不发生同号顶替）
  const pack = renumberForInsert(g.items)
  emit('insert', paperGroupToText({ ...g, items: pack.items }, withSolution), 0, '整套「' + name + '」共 ' + g.count + ' 道', pack.images)
  g.items.forEach((x) => void touchQuestion(x.id))
  flash('已整套插入「' + name + '」共 ' + g.count + ' 道')
}
async function doBatch() {
  if (!parsed.value.length) return
  // 批次级的年份 / 试卷名：题内没写就套用批次的
  // 图片：整卷一个表 → 按题挑出这一题真的引用到的（题干/选项/解析里出现 [图N]）
  const items = parsed.value.map((p) => ({
    ...p,
    yearExplicit: p.yearExplicit || batchYear.value.trim(),
    paperName: p.paperName || batchPaper.value.trim(),
    images: imagesForText(questionTextOf(p), batchImages.value),
  }))
  const imgCount = items.reduce((s, p) => s + (p.images?.length || 0), 0)
  const r = await importParsedQuestions(items)
  await load()
  batchOpen.value = false
  batchText.value = ''
  batchImages.value = []
  flash('已导入 ' + r.added + ' 道题' + (imgCount ? '（含 ' + imgCount + ' 张插图）' : '')
    + (r.skipped ? '，跳过 ' + r.skipped + ' 道（与库里已有的题干重复）' : ''))
}
/* ---- 规则组卷（双向细目表）+ 组卷查重 ---- */
const paperOpen = ref(false)
/** 组卷时优先挑没用过的题（默认开；关掉＝纯随机）*/
const preferUnused = ref(true)
const rules = ref<PaperRule[]>([{ id: 1, qtype: 'choice', section: '', chapter: '', level: '', count: 5 }])
let ruleSeq = 1
const paperResult = ref<{ picked: QuestionEntry[]; results: RuleResult[] } | null>(null)
const dupReport = ref<{ pairs: { a: QuestionEntry; b: QuestionEntry; same: boolean; sim: number }[]; skippedNear: boolean } | null>(null)

function addRule() {
  ruleSeq++
  rules.value = [...rules.value, { id: ruleSeq, qtype: '', section: '', chapter: '', level: '', count: 5 }]
}
function removeRule(id: number) {
  rules.value = rules.value.filter((r) => r.id !== id)
}
function resetRules() {
  rules.value = [{ id: ++ruleSeq, qtype: 'choice', section: '', chapter: '', level: '', count: 5 }]
  paperResult.value = null
  dupReport.value = null
}
/** 一键挑题：从**当前筛选结果**里按规则抽，并顺手做组卷查重 */
function doPick() {
  const pool = shown.value
  if (!pool.length) { flash('当前筛选结果里没有题 —— 先放宽筛选条件'); return }
  const active = rules.value.filter((r) => (Number(r.count) || 0) > 0)
  if (!active.length) { flash('至少填一条规则的题量'); return }
  const r = pickByRules(pool, active, { preferUnused: preferUnused.value })
  paperResult.value = r
  dupReport.value = findDuplicates(r.picked)
  const shortCnt = r.results.filter((x) => x.short).length
  flash('已挑出 ' + r.picked.length + ' 道' + (shortCnt ? '，有 ' + shortCnt + ' 条规则题量不够（已如实标注）' : ''))
}
/** 把挑好的卷子送进 PDF 生成（按 选择→填空→解答 排序） */
function sendPaper(withSolution: boolean) {
  const arr = paperResult.value ? paperResult.value.picked : []
  if (!arr.length) { flash('先点「一键挑题」'); return }
  if (blockIfManageOnly()) return
  const sig = 'rule:' + arr.map((x) => x.id).join(',') + ':' + (withSolution ? 1 : 0)
  if (!confirmRepeat(sig, '这套规则组卷')) return
  const pack = renumberForInsert(arr)
  emit('insert', buildPaperText(pack.items, { withSolution }), 0, '规则组卷 ' + arr.length + ' 道（' + paperTotal(arr) + ' 分）', pack.images)
  arr.forEach((x) => void touchQuestion(x.id))
  markSent(sig)
  flash('已把 ' + arr.length + ' 道题送进 PDF 生成（共 ' + paperTotal(arr) + ' 分）')
}

/* ---- 整库导入导出：导入 MD / 导入 JSON / 导出 JSON ---- */
const fileInput = ref<HTMLInputElement | null>(null)
const fileMode = ref<'md' | 'json' | 'pdf'>('md')
function pickFile(mode: 'md' | 'json' | 'pdf') {
  fileMode.value = mode
  const el = fileInput.value
  if (!el) return
  el.accept = mode === 'json' ? '.json,application/json'
    : mode === 'pdf' ? '.pdf,application/pdf'
    : '.md,.markdown,.txt,text/plain'
  el.value = ''
  el.click()
}
async function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files && input.files[0]
  if (!f) return
  // PDF 走 MinerU 云端识别，不能按文本读（二进制读成字符串既没意义又占内存）
  if (fileMode.value === 'pdf') {
    await importPdfToBatch(f)
    return
  }
  let text = ''
  try {
    text = await f.text()
  } catch {
    flash('读文件失败')
    return
  }
  if (fileMode.value === 'json') {
    const r = parseQuestionsJson(text)
    if (r.error) { flash('导入 JSON 失败：' + r.error); return }
    const res = await importParsedQuestions(r.list)
    await load()
    flash('已从 JSON 导入 ' + res.added + ' 道' + (res.skipped ? '，跳过重复 ' + res.skipped + ' 道' : ''))
  } else {
    // MD / 纯文本：填进批量面板，让你先核对识别结果再导入
    batchText.value = text
    batchOpen.value = true
    editing.value = false
    flash('已读入 ' + f.name + '（' + text.length + ' 字），请核对识别结果后再点导入')
  }
}
/* ---- 导入 PDF（MinerU）：HTTP 在 Rust 侧发（网页端直连被 CORS 挡） ----
 * token 只存本机 localStorage，绝不写进源码/仓库；不填 token 就走免登录轻量接口。
 * ------------------------------------------------------------------ */
const MINERU_TOKEN_KEY = 'lj-mathslides:mineru-token'
const mineruToken = ref('')
try { mineruToken.value = localStorage.getItem(MINERU_TOKEN_KEY) || '' } catch { /* 隐私模式等忽略 */ }
watch(mineruToken, (v) => {
  try {
    const t = (v || '').trim()
    if (t) localStorage.setItem(MINERU_TOKEN_KEY, t)
    else localStorage.removeItem(MINERU_TOKEN_KEY)
  } catch { /* 忽略 */ }
})
const mineruBusy = ref(false)
const mineruProg = ref('')

/** 把任意异常（Tauri 命令 Err 是字符串）转成一行可读文本 */
function errText(e: unknown): string {
  if (typeof e === 'string') return e
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message?: unknown }).message)
  return String(e)
}

/** 选中的 PDF → 交给 Rust 暂存成路径 → 云端识别 → 结果灌进批量导入面板 */
async function importPdfToBatch(f: File) {
  if (!isTauri()) { flash('导入 PDF（MinerU）只在桌面端可用'); return }
  if (mineruBusy.value) { flash('上一次识别还没结束，请稍候…'); return }
  mineruBusy.value = true
  mineruProg.value = '正在暂存 PDF…'
  try {
    const path = await mineruStagePdf(f)
    mineruProg.value = ''
    // ⚠ 必须先把 busy 放掉：runMineru 开头也有"忙就返回"的守卫，
    //   这里若不放，runMineru 会立刻 return（只 flash 一句"正在识别，请稍候…"），
    //   于是命令根本没发出去、界面永远停在"识别中…"、也不报错（实测就是这个）。
    mineruBusy.value = false
    await runMineru(path)
  } catch (e) {
    mineruBusy.value = false
    mineruProg.value = ''
    flash('暂存 PDF 失败：' + errText(e))
  }
}

/** 真正的识别流程：订阅进度事件 → 调 mineru_parse → 填进批量导入面板 */
async function runMineru(pdfPath: string) {
  if (mineruBusy.value) { flash('正在识别，请稍候…'); return }
  const token = mineruToken.value.trim()
  // 填了 token → 精准解析（md+json）；没填 → 免 token 轻量接口（只有 md）
  const mode: 'precise' | 'agent' = token ? 'precise' : 'agent'
  mineruBusy.value = true
  mineruProg.value = mode === 'precise' ? '正在上传 PDF（精准解析）…' : '正在上传 PDF（轻量接口）…'
  // 五个阶段：提交 → 上传 → 解析 → 下载 → 完成（Rust 侧按真实进度 emit，这里只做中文映射）
  const ZH: Record<string, string> = {
    submitting: '① 提交任务', waiting_file: '① 等待上传', uploading: '② 上传中',
    pending: '③ 排队中', running: '③ 解析中', parsing: '③ 解析中', converting: '③ 转换中',
    downloading: '④ 下载结果', extracting: '④ 解压中',
    done: '⑤ 完成', failed: '失败',
  }
  const unlisten = await listenTauri<MineruProgress>('mineru://progress', (p) => {
    if (!p || !p.state) return
    let line = 'MinerU ' + (ZH[p.state] || p.state)
    if (p.extractedPages != null) line += ' ' + p.extractedPages + '/' + (p.totalPages ?? '?') + ' 页'
    if (p.seconds != null) line += ' · 已 ' + p.seconds + 's'
    mineruProg.value = line
  })
  try {
    const r = await mineruParse(pdfPath, token, mode)
    const md = r?.mdText || ''
    if (!md.trim()) { throw new Error('MinerU 没有返回 Markdown 内容') }
    // 正文里的 ![](images/x.jpg) → [图N]，图本身（Rust 读成 base64）留在本批次表里，
    // 入库时按题拆开写进 meta.images —— 题库不存磁盘路径（产物目录会被清/换机就没了）。
    // v1428：优先用 **content_list 组装出来的正文**（一块一行 → 选项不会被 MD 那种合并吃掉 ✓、
    //   页眉页脚/页码已剔除 ✓）；而且它就是交给解析器的那份文本 → 「被吃掉的选项」能按题干末尾精确定位 ✓
    const doc = String(r?.contentText || '').trim() || md
    const linked = linkMineruImages(doc, r?.images)
    batchImages.value = linked.images
    setContentList(doc)
    batchText.value = linked.text
    batchOpen.value = true
    editing.value = false
    const tip = '识别完成：' + (r.seconds ?? '?') + 's / ' + (r.pages || '?') + ' 页；'
      + linked.images.length + ' 张插图已转成 [图N]'
      + (mode === 'precise'
        ? '；已存 md + json → ' + (r.mdPath || '') + (r.outDir ? '（产物目录：' + r.outDir + '）' : '')
        : '；轻量接口只出 Markdown（未存 json）')
      + ' —— 请核对下面识别结果，再点「识别并导入」'
    mineruProg.value = '✓ ' + tip
    flash('MinerU ' + tip)
  } catch (e) {
    const m = errText(e)
    mineruProg.value = '✗ ' + m
    flash('MinerU 识别失败：' + m)
  } finally {
    mineruBusy.value = false
    unlisten()
  }
}

/** 导出 JSON：默认只导**当前筛选出来的**（筛选结果为空时明确说一句，绝不偷偷导全库 ✗） */
/** 导出时是否把图片内嵌成 base64（默认否：只带 assetId，体积小）*/
const embedImages = ref(false)
async function exportJson(all = false) {
  const arr = all ? list.value : shown.value
  if (!arr.length) { flash(all ? '题库是空的，没有可导出的题' : '当前筛选结果为空 —— 想导整个题库请点「导出全部」'); return }
  const name = '题库' + (all ? '全部' : '筛选') + '-' + new Date().toISOString().slice(0, 10) + '.json'
  const path = await saveTextFile(name, exportQuestionsJson(arr, { embedImages: embedImages.value }))
  flash(path ? '已导出 ' + arr.length + ' 道题到：' + path : '已导出 ' + arr.length + ' 道题')
}

const pickedTags = ref<string[]>([])
const selectedId = ref(0)
/* ---- 新增筛选维度（题型 / 板块 / 难度分级 / 只看缺答案） ---- */
const pickedType = ref<QType | ''>('')
const pickedSection = ref('')
const pickedChapter = ref('')
// 换了板块就把章节清掉 —— 否则会残留一个不属于新板块的章节，筛出来是空的
watch(pickedSection, () => { pickedChapter.value = '' })
const pickedLevel = ref<Level | ''>('')
/**
 * 难度细筛：1-5（这个字段以前只被 filterQuestions 读、模板里从来不写，是个死筛选）。
 * 与上面的 易/中/难 是**同一字段的两种粒度**：粗档看整体，细值看具体第几级，两者可叠加。
 * null = 不限。
 */
const pickedDiff = ref<number | null>(null)
const onlyMissing = ref(false)
/** 只看"待核对"的题（v1411 P1）：选项不全 / 没答案 / 题干过短 —— 按字段现算，改完自动消失 */
const onlyReview = ref(false)
/** 只看带插图的题（健康度"含图"那一栏旁边也能看到）*/
const onlyImage = ref(false)
/* ---- 多选出卷 ---- */
const pickedIds = ref<number[]>([])
function togglePick(id: number) {
  const i = pickedIds.value.indexOf(id)
  if (i >= 0) pickedIds.value = pickedIds.value.filter((x) => x !== id)
  else pickedIds.value = [...pickedIds.value, id]
}
const pickedEntries = computed(() => list.value.filter((x) => pickedIds.value.indexOf(x.id) >= 0))
/** 把已选的题按 选择→填空→解答 排序，合成一份试卷文本交给 PDF 生成 */
function insertPicked(withSolution: boolean) {
  const arr = pickedEntries.value
  if (!arr.length) { flash('先在左边勾选要出卷的题'); return }
  if (blockIfManageOnly()) return
  const total = paperTotal(arr)
  // 勾多了先问一声；同一批插过一次再插也问一声（以前点两下就重复灌两份 ✗）
  if (arr.length >= 10 && !confirm('把已勾选的 ' + arr.length + ' 道题（共 ' + total + ' 分）插进试卷正文？')) return
  const sig = 'pick:' + arr.map((x) => x.id).join(',') + ':' + (withSolution ? 1 : 0)
  if (!confirmRepeat(sig, '这批 ' + arr.length + ' 道题')) return
  // 统一走 buildPaperText：按题型分段 + 每题（x分）+ 卷面总分 —— 与整套插入排版一致
  const pack = renumberForInsert(arr)
  emit('insert', buildPaperText(pack.items, { withSolution }), 0, '已勾选 ' + arr.length + ' 道（共 ' + total + ' 分）', pack.images)
  arr.forEach((x) => void touchQuestion(x.id))
  markSent(sig)
  flash('已把 ' + arr.length + ' 道题送进 PDF 生成（共 ' + total + ' 分）')
}
/** 同一批题插过一次就记下来：再插同一批会先确认一下 */
const sentSigs = ref<Record<string, boolean>>({})
function confirmRepeat(sig: string, what: string): boolean {
  return !sentSigs.value[sig] || confirm(what + '刚才已经插过一次了，再插一遍？')
}
function markSent(sig: string) { sentSigs.value = { ...sentSigs.value, [sig]: true } }
/* ---- 答案自我完善：扫出「缺答案但解析里能反推」的题 ---- */
const proposals = computed(() => proposeAnswers(list.value))
async function doComplete() {
  const ps = proposals.value
  if (!ps.length) { flash('没有可自动补全的（需要解析里写了「故选B」这类明确表述）'); return }
  let n = 0
  for (const p of ps) {
    const x = list.value.find((e) => e.id === p.id)
    if (!x) continue
    const ok = await updateQuestion(x.id, { ...x.q, answer: p.proposed, answerFrom: 'auto' }, x.title)
    if (ok) n++
  }
  await load()
  flash('已自动补全 ' + n + ' 道题的答案（标记为「自动提取」，建议抽查）')
}

const emptyMeta = (): QuestionMeta => ({
  stem: '', options: [], answer: '', solution: '',
  knowledge: [], difficulty: 3, score: 0, qtype: 'choice', section: '', chapter: '', date: '',
  year: '', paperName: '', region: '', answerFrom: '',
})
const editing = ref(false)
const editingId = ref(0)
const form = ref<QuestionMeta>(emptyMeta())
const formTitle = ref('')
const formOptions = ref('')      // 一行一个选项，省得加数组控件
const formKnowledge = ref('')    // 逗号分隔

function flash(t: string) {
  msg.value = t
  window.setTimeout(() => { if (msg.value === t) msg.value = '' }, 2400)
}
/** 只能管理时，插入按钮点了要说清为什么没反应
 *  （以前这里照样弹"已送进 PDF 生成"，内容其实进了 /dev/null ✗ —— 用户实报的"假成功"） */
function blockIfManageOnly(): boolean {
  if (!props.manageOnly) return false
  flash('这个入口只能管理题库 —— 要把题插进试卷，请从「PDF 生成 → 试题库」打开')
  return true
}

async function load() {
  loading.value = true
  try {
    list.value = await listQuestions()
    tags.value = await listQuestionTags()
  } finally {
    loading.value = false
  }
}
onMounted(load)

const shown = computed(() => filterQuestions(list.value, {
  q: q.value,
  tags: pickedTags.value,
  qtype: pickedType.value,
  section: pickedSection.value,
  chapter: pickedChapter.value,
  level: pickedLevel.value,
  difficulty: pickedDiff.value,
  onlyMissingAnswer: onlyMissing.value,
    onlyImage: onlyImage.value,
    review: onlyReview.value,
}))
/** 清空全部筛选（健康度那一排按钮先调它 —— 否则残留筛选会叠加出空列表 ✗） */
function clearFilters() {
  q.value = ''
  pickedTags.value = []
  pickedType.value = ''
  pickedSection.value = ''
  pickedChapter.value = ''
  pickedLevel.value = ''
  pickedDiff.value = null
  onlyMissing.value = false
  onlyReview.value = false
  onlyImage.value = false
}

const selected = computed(() => list.value.find((x) => x.id === selectedId.value) || null)

/** 「待核对」的题数 + 每道的原因（v1411 P1）—— 按字段现算，老师改完自动消失 ✓ */
const reviewCount = computed(() => list.value.filter((x) => reviewWarn(x.q)).length)
/** 题库健康度（总量/未分类/缺答案/待核对/含图）—— 打开题库一眼看到"库怎么样" */
const health = computed(() => healthOf(list.value))
/** 双向细目表：对"一键挑题"的结果算 板块×难度 的题数/分值（组卷时看覆盖情况） */
const bp = computed(() => (paperResult.value ? blueprintOf(paperResult.value.picked) : null))
function warnOf(e: { q: { stem?: string; options?: string[]; answer?: string; qtype?: string } }): string { return reviewWarn(e.q) }
/** 【结构修复·人工】把这一题**并到上一题**：残块/被切碎的常见修法（老师点头才做，不动别的题） */
async function mergePrev() {
  const arr = shown.value
  const i = arr.findIndex((x) => x.id === selectedId.value)
  if (i < 0) { flash('先在左边选一道题'); return }
  if (i === 0) { flash('这已经是当前列表的第一道了，没有上一题可并'); return }
  const prev = arr[i - 1], cur = arr[i]
  if (!window.confirm('把 #' + cur.id + ' 并到上一题 #' + prev.id + '？\n\n会追加到上一题题干末尾：\n' + cur.q.stem.slice(0, 160) + '\n\n（本题随后删除，原卷面顺序不变）')) return
  const merged = {
    ...prev.q,
    stem: (prev.q.stem + '\n' + cur.q.stem).trim(),
    options: [...(prev.q.options || []), ...(cur.q.options || [])],
    images: [...(prev.q.images || []), ...(cur.q.images || [])],
  }
  const ok = await updateQuestion(prev.id, merged, prev.title)
  if (!ok) { flash('合并失败：上一题没写进去'); return }
  await removeQuestion(cur.id)
  await load()
  selectedId.value = prev.id
  flash('已合并：# ' + cur.id + ' → # ' + prev.id + '（图与选项一并带过去）')
}

/** 跳到下一道待核对（没有就绕回第一道） */
function nextReview() {
  const arr = shown.value
  if (!arr.length) return
  const cur = arr.findIndex((x) => x.id === selectedId.value)
  for (let i = 1; i <= arr.length; i++) {
    const x = arr[(cur + i + arr.length) % arr.length]
    if (x && reviewWarn(x.q)) { selectedId.value = x.id; return }
  }
  flash('这个筛选结果里没有待核对的题了 ✓')
}

/* ---------- 插入到**当前幻灯片**（v1406） ----------
 * 题库原来只能插进「PDF 生成的试卷正文」；幻灯片是另一套（没有 [图N] 那套图号约定），
 * 所以这里：题干+选项 → 一个**文本元素**；题目里的图 → 各自的**图片元素**（按顺序，拖一下位置即可）。 */
const deck = useDeckStore()
const slideWithAnswer = ref(false)
function insertToSlide() {
  const q = selected.value
  if (!q) { flash('先在左边选一道题'); return }
  let text = questionToText(q, slideWithAnswer.value).trim()
  const imgs = q.q?.images || []     // ⚠ 图挂在 meta（entry.q.images）上，不在 entry 上
  // [图N] 是试卷正文的约定，幻灯片不认 → 去掉标记，改用真图（顺序一致）
  text = text.replace(/\[图\s*\d+\]/g, '').replace(/\n{3,}/g, '\n\n').trim()
  if (!text) { flash('这道题没有可插入的文字'); return }
  deck.addElement('text', {
    text, fontSize: 22, w: 1100, h: Math.min(620, 140 + text.split('\n').length * 30),
  } as Partial<SlideElement>)
  for (const im of imgs) {
    deck.addElement('image', { src: im.src, w: 520, h: 320, fit: 'contain' } as Partial<SlideElement>)
  }
  flash('已插入幻灯片：题面' + (slideWithAnswer.value ? '（含答案/解析）' : '（不含答案）')
    + (imgs.length ? '；另有 ' + imgs.length + ' 张图（图片元素，拖到合适位置）' : ''))
}

function toggleTag(t: string) {
  const i = pickedTags.value.indexOf(t)
  if (i >= 0) pickedTags.value = pickedTags.value.filter((x) => x !== t)
  else pickedTags.value = [...pickedTags.value, t]
}

function startNew() {
  editingId.value = 0
  editing.value = true
  form.value = emptyMeta()
  formTitle.value = ''
  formOptions.value = ''
  formKnowledge.value = ''
}
function startEdit(x: QuestionEntry) {
  editingId.value = x.id
  editing.value = true
  form.value = { ...x.q }
  formTitle.value = x.title
  formOptions.value = x.q.options.join('\n')
  formKnowledge.value = x.q.knowledge.join('，')
}
function cancelEdit() {
  editing.value = false
  editingId.value = 0
}

async function save() {
  const stem = form.value.stem.trim()
  if (!stem) { flash('题干不能为空'); return }
  const meta: QuestionMeta = withDefaults({
    ...form.value,
    stem,
    options: formOptions.value.split('\n').map((s) => s.trim()).filter(Boolean),
    knowledge: formKnowledge.value.split(/[，,、\s]+/).map((s) => s.trim()).filter(Boolean),
    difficulty: Number(form.value.difficulty) || 3,
    answer: form.value.answer.trim(),
    answerFrom: form.value.answer.trim() ? (form.value.answerFrom || 'manual') : '',
  })
  const wasEdit = editingId.value > 0
  const id = wasEdit
    ? await updateQuestion(editingId.value, meta, formTitle.value)
    : await addQuestion(meta, formTitle.value)
  if (!id) { flash('保存失败 —— 内容库不可用？'); return }
  await load()
  selectedId.value = id
  editing.value = false
  editingId.value = 0
  // ⚠ 这里原来判的是 editingId.value（上面刚被清成 0）→ 永远显示"已存入"，改了题也这么说 ✗
  flash(wasEdit ? '已更新（#' + id + '）' : '已存入试题库（#' + id + '）')
}

async function del(x: QuestionEntry) {
  const ok = await removeQuestion(x.id)
  if (!ok) { flash('删除失败（内置条目不能删）'); return }
  if (selectedId.value === x.id) selectedId.value = 0
  await load()
  flash('已删除')
}

async function insertOne(withSolution: boolean) {
  const x = selected.value
  if (!x) { flash('先在右边选一道题'); return }
  if (blockIfManageOnly()) return
  const pack = renumberForInsert([x])
  emit('insert', questionToText(pack.items[0], withSolution), x.id, '试题 #' + x.id, pack.images)
  void touchQuestion(x.id)
}
/* ---- 清理与批量删除 ---- */
const cleanOpen = ref(false)
const junkList = ref<JunkItem[]>([])
const junkPicked = ref<number[]>([])
const scanned = ref(false)
const confirmDelPicked = ref(false)   // 「删除选中」的两步确认

function toggleJunk(id: number) {
  const i = junkPicked.value.indexOf(id)
  if (i >= 0) junkPicked.value = junkPicked.value.filter((x) => x !== id)
  else junkPicked.value = [...junkPicked.value, id]
}
/** 扫描：kind = junk（非题目）| dup（重复）| all（两者） */
function doScan(kind: 'junk' | 'dup' | 'all') {
  const j = kind === 'dup' ? [] : scanJunk(list.value)
  const d = kind === 'junk' ? [] : scanDuplicates(list.value)
  const seen = new Set<number>()
  const merged: JunkItem[] = []
  for (const it of [...j, ...d]) {
    if (seen.has(it.entry.id)) continue
    seen.add(it.entry.id)
    merged.push(it)
  }
  junkList.value = merged
  junkPicked.value = merged.map((x) => x.entry.id)   // 默认全选，用户可取消
  scanned.value = true
  flash(merged.length ? '扫描完成：找到 ' + merged.length + ' 条可疑（已默认全选，请核对）' : '扫描完成：没有发现可疑条目')
}
async function deleteJunk() {
  const ids = junkPicked.value.slice()
  if (!ids.length) { flash('没有勾选任何条目'); return }
  const n = await removeQuestions(ids)
  await load()
  junkList.value = []
  junkPicked.value = []
  scanned.value = false
  flash('已删除 ' + n + ' 条')
}
/** 删除列表里勾选的题（多选用于出卷，这里也用来批量删） */
async function deletePicked() {
  const ids = pickedIds.value.slice()
  if (!ids.length) { flash('先在列表里勾选'); return }
  if (!confirmDelPicked.value) { confirmDelPicked.value = true; flash('再点一次确认删除 ' + ids.length + ' 条'); return }
  const n = await removeQuestions(ids)
  pickedIds.value = []
  confirmDelPicked.value = false
  if (selectedId.value && ids.indexOf(selectedId.value) >= 0) selectedId.value = 0
  await load()
  flash('已删除 ' + n + ' 条')
}

function close() { emit('close') }
</script>

<template>
  <Teleport to="body">
    <!-- 整库导入用的隐藏文件选择器（accept 在 pickFile 里按模式设置） -->
    <input ref="fileInput" class="qb__file" type="file" style="display:none" @change="onFilePicked" />
    <div class="qb" @mousedown.self="close">
      <div class="qb__box">
        <div class="qb__head">
          <div class="qb__title">试题库<em v-if="!manageOnly">（供 PDF 生成组卷：选定后插入题干，可带答案解析）</em><em v-else>（管理：录入 / 导入 / 编辑 / 导出；插题请从「PDF 生成 → 试题库」打开）</em></div>
          <div class="qb__tools">
            <button class="qb__btn" title="把整份试题粘贴进来，一次性识别并入库" @click="batchOpen = true; editing = false">批量导入</button>
            <button class="qb__btn" title="重新从内容库读取（外部改动后点它刷新列表）" @click="load()">刷新</button>
            <button class="qb__btn qb__btn--danger" title="清理试题库：扫描「非题目」与「重复题」，确认后删除" @click="cleanOpen = true; editing = false; batchOpen = false; paperOpen = false">清理</button>
            <button class="qb__btn" title="按规则挑题（双向细目表）：设题型/板块/难度/题量，一键抽出整卷" @click="paperOpen = true; editing = false; batchOpen = false">规则组卷</button>
            <button class="qb__btn" title="导入 Markdown / 纯文本：读进来后先给你看识别结果，确认再入库" @click="pickFile('md')">导入 MD</button>
            <button class="qb__btn" title="导入题库 JSON（我们自己导出的、或 {questions:[…]} / 数组 都认）" @click="pickFile('json')">导入 JSON</button>
            <button class="qb__btn" :disabled="mineruBusy" title="导入 PDF：调 MinerU 云端识别成 Markdown（HTTP 在 Rust 侧发，绕开网页 CORS；识别结果先灌进「批量导入」面板，核对后再入库）" @click="pickFile('pdf')">{{ mineruBusy ? '识别中…' : '导入 PDF（MinerU）' }}</button>
            <button class="qb__btn" title="把**当前筛选出的**题导出成 JSON（筛选为空时会提示，不会偷偷导全库）" @click="exportJson()">导出筛选结果</button>
          <button class="qb__btn" title="把整个题库导出成 JSON" @click="exportJson(true)">导出全部</button>
          <label class="qb__chk" title="把图片以 base64 一起写进 JSON —— 换机器/发给别人也能看到图（文件会大）"><input v-model="embedImages" type="checkbox" /> 内嵌图片</label>
            <button class="qb__btn" :title="'从解析里反推答案（认「故选B」这类明确写法），可补 ' + proposals.length + ' 道'" @click="doComplete">完善答案<template v-if="proposals.length">（{{ proposals.length }}）</template></button>
            <button class="qb__btn qb__btn--pri" title="新建一道试题" @click="startNew">＋ 新建试题</button>
            <button class="qb__btn qb__btn--pdf" :disabled="manageOnly || !pickedIds.length" :title="manageOnly ? '从工具栏打开时只能管理题库；插题请从「PDF 生成 → 试题库」打开' : '把左边勾选的题按 选择→填空→解答 排序，一起送进 PDF 生成'" @click="insertPicked(false)">生成 PDF（已选 {{ pickedIds.length }}）</button>
            <button class="qb__btn qb__btn--danger" :disabled="!pickedIds.length" :title="confirmDelPicked ? '再点一次确认删除' : '删除左边勾选的题'" @click="deletePicked">{{ confirmDelPicked ? '确认删除 ' + pickedIds.length + ' 条' : '删除选中（' + pickedIds.length + '）' }}</button>
            <button class="qb__close" title="关闭" @click="close"><AppIcon name="close" :size="14" /></button>
          </div>
        </div>

        <!-- MinerU：token 只存本机 localStorage（不填就走免登录轻量接口）；进度由 Rust 的 mineru://progress 事件推来 -->
        <div class="qb__mineru">
          <span class="qb__mlabel">MinerU token</span>
          <input v-model="mineruToken" class="qb__minput" type="password" autocomplete="off" spellcheck="false"
            placeholder="留空＝免 token 轻量接口（≤10MB / ≤20 页，只出 Markdown）" />
          <span class="qb__mhint" :class="{ 'qb__mhint--on': !!mineruToken.trim() }">
            <template v-if="mineruToken.trim()">精准解析：≤200MB / ≤600 页，出 md + content_list.json（token 只存本机，不会写进源码）。
        <b>不填 token 只能走免登录的轻量接口（≤10MB / ≤20 页，只出 Markdown）—— 实测公式会乱、不能用于数学卷，
        请务必填 token。</b></template>
            <template v-else>没填 token：走 mineru.net 免登录轻量接口，≤10MB / ≤20 页，只出 Markdown</template>
          </span>
          <a class="qb__mlink" href="https://mineru.net/apiManage/token" target="_blank" rel="noreferrer">申请 token</a>
          <span v-if="mineruProg" class="qb__mprog" :class="{ 'qb__mprog--err': mineruProg.charAt(0) === '✗' }">{{ mineruProg }}</span>
        </div>

        <div class="qb__bar">
          <input v-model="q" class="qb__search" type="text" placeholder="搜索题干 / 答案 / 解析 / 标签…" />
          <span class="qb__count">{{ shown.length }} / {{ list.length }}</span>
        </div>

        <!-- 筛选：题型 / 难度分级 / 板块 / 只看缺答案 -->
        <!-- 题库健康度（v1414 P3）：一眼看到"库怎么样"，点数字旁边的筛选就知道该补哪里 -->
        <div class="qb__health">
          <button class="qb__hbtn" title="点它清空所有筛选（回到全部）" @click="clearFilters">共 <b>{{ health.total }}</b> 道</button>
          <button class="qb__hbtn" :class="{ 'qb__h--warn': health.unclassified > 0 }" title="点它只看没有板块的题" @click="clearFilters(); pickedSection = '未分类'">未分类 {{ health.unclassified }}</button>
          <button class="qb__hbtn" :class="{ 'qb__h--warn': health.noAnswer > 0 }" title="点它只看没答案的题（可用「自动补答案」或手工补）" @click="clearFilters(); onlyMissing = true">缺答案 {{ health.noAnswer }}</button>
          <button class="qb__hbtn" :class="{ 'qb__h--warn': health.todo > 0 }" title="点它只看待核对的题（选项不全/没答案/题干过短）" @click="clearFilters(); onlyReview = true">待核对 {{ health.todo }}</button>
          <button class="qb__hbtn" title="点它只看带插图的题" @click="clearFilters(); onlyImage = true">含图 {{ health.withImage }}</button>
        </div>
        <div class="qb__filters">
          <span class="qb__fg" v-if="pickedSection || pickedChapter">章节
            <button class="qb__f" :class="{ 'qb__f--on': pickedChapter === '' }" @click="pickedChapter = ''">全部</button>
            <button v-for="c in chaptersOf(pickedSection)" :key="c" class="qb__f" :class="{ 'qb__f--on': pickedChapter === c }"
              @click="pickedChapter = (pickedChapter === c ? '' : c)">{{ c }}</button>
          </span>
          <span class="qb__fg">题型
            <button v-for="t in QTYPES" :key="t.v" class="qb__f" :class="{ 'qb__f--on': pickedType === t.v }"
              @click="pickedType = (pickedType === t.v ? '' : t.v)">{{ t.label }}</button>
          </span>
          <span class="qb__fg">难度
            <button v-for="l in LEVELS" :key="l.v" class="qb__f" :class="{ 'qb__f--on': pickedLevel === l.v }"
              @click="pickedLevel = (pickedLevel === l.v ? '' : l.v)">{{ l.label }}</button>
          </span>
          <!-- 1-5 细筛：以前 pickDiff 只被 filterQuestions 读、界面上根本没有入口（死筛选） -->
          <span class="qb__fg">难度值
            <button class="qb__f" :class="{ 'qb__f--on': pickedDiff === null }" title="不按 1-5 细分（只看上面的 易/中/难）"
              @click="pickedDiff = null">不限</button>
            <button v-for="d in [1, 2, 3, 4, 5]" :key="d" class="qb__f" :class="{ 'qb__f--on': pickedDiff === d }"
              :title="'只要难度值 = ' + d + '（与 易/中/难 是同一字段的两种粒度，可叠加）'"
              @click="pickedDiff = (pickedDiff === d ? null : d)">{{ d }}</button>
          </span>
          <span class="qb__fg">板块
            <button class="qb__f" :class="{ 'qb__f--on': pickedSection === '' }" @click="pickedSection = ''">全部</button>
            <button v-for="s in SECTIONS" :key="s" class="qb__f" :class="{ 'qb__f--on': pickedSection === s }"
              @click="pickedSection = (pickedSection === s ? '' : s)">{{ s }}</button>
          </span>
          <span class="qb__fg">
            <button class="qb__f" :class="{ 'qb__f--on': onlyMissing }" title="只显示还没填答案的题"
              @click="onlyMissing = !onlyMissing">只看缺答案</button>
            <button class="qb__f" :class="{ 'qb__f--on': onlyImage }" title="只显示题面里带插图的题（[图N]）"
              @click="onlyImage = !onlyImage">只看有图（{{ health.withImage }}）</button>
            <button class="qb__f" :class="{ 'qb__f--on': onlyReview }" title="只显示需要人核对的题：选项不足 4 个 / 没答案 / 题干过短"
              @click="onlyReview = !onlyReview">只看待核对（{{ reviewCount }}）</button>
          </span>
        </div>

        <div class="qb__tags" v-if="tags.length">
          <button
            v-for="t in tags" :key="t.name"
            class="qb__tag" :class="{ 'qb__tag--on': pickedTags.indexOf(t.name) >= 0 }"
            :title="'该标签下有 ' + t.count + ' 道题'"
            @click="toggleTag(t.name)">{{ t.name }}</button>
        </div>

        <div class="qb__body">
          <div class="qb__list">
            <div v-if="loading" class="qb__empty">正在读取试题库…</div>
            <div v-else-if="!shown.length" class="qb__empty">
              还没有试题。点右上角「＋ 新建试题」录入第一道。
            </div>
            <div
              v-for="x in shown" :key="x.id"
              class="qb__item" :class="{ 'qb__item--on': x.id === selectedId }"
              @click="selectedId = x.id">
              <span class="qb__pick" title="勾选后可批量生成 PDF" @click.stop="togglePick(x.id)">
                <input type="checkbox" :checked="pickedIds.indexOf(x.id) >= 0" />
              </span>
              <span class="qb__it">{{ x.title }}</span>
              <span class="qb__im">
                {{ qtypeLabel(x.q.qtype) }} · {{ levelLabel(x.q.difficulty) }}
                <b v-if="warnOf(x)" class="qb__warn" :title="warnOf(x)">⚠ 待核对</b>
                <template v-if="x.q.section"> · {{ x.q.section }}</template>
                <template v-if="!x.q.answer.trim()"> · <b class="qb__noans">缺答案</b></template>
                <template v-else-if="x.q.answerFrom === 'auto'"> · <b class="qb__auto">自动</b></template>
                <template v-if="(x.q.images || []).length"> · 图{{ (x.q.images || []).length }}</template>
              </span>
            </div>
          </div>

          <div class="qb__detail">
            <div v-if="selected && !cleanOpen" class="qb__slide">
              <button class="qb__btn qb__btn--pri" @click="insertToSlide">插入当前幻灯片</button>
              <button class="qb__btn" title="这一题如果是被切碎的残块，可以并到上一题（题干/选项/图一起带过去）" @click="mergePrev">合并到上一题</button>
              <button class="qb__btn" :title="warnOf(selected) || '这一道看着没问题，点它会跳到下一道待核对的题'"
                @click="nextReview">下一道待核对（{{ reviewCount }}）</button>
              <span v-if="warnOf(selected)" class="qb__warnbox">⚠ {{ warnOf(selected) }}</span>
              <label class="qb__slideck">
                <input v-model="slideWithAnswer" type="checkbox" /> 连答案/解析一起
              </label>
              <span class="qb__slidehint">题干+选项作为一个文本元素；题里的图作为图片元素插进去（拖一下位置即可）</span>
            </div>
            <template v-if="cleanOpen">
              <div class="qb__clean">
                <div class="qb__bhead">清理试题库 —— 用「导入时的同一套判据」扫描；只给建议，点删除才真删</div>
                <div class="qb__actions">
                  <button class="qb__btn qb__btn--pri" @click="doScan('all')">一次全扫（非题目 + 重复题）</button>
                  <button class="qb__btn" @click="doScan('junk')">只扫非题目</button>
                  <button class="qb__btn" @click="doScan('dup')">只扫重复题</button>
                  <button class="qb__btn" @click="cleanOpen = false; junkList = []; scanned = false">返回列表</button>
                </div>
                <div v-if="junkList.length" class="qb__junk">
                  <div class="qb__bptitle">找到 {{ junkList.length }} 条可疑（已默认全选，请核对后再删）</div>
                  <div v-for="(j, i) in junkList" :key="i" class="qb__jrow" @click="toggleJunk(j.entry.id)">
                    <input type="checkbox" :checked="junkPicked.indexOf(j.entry.id) >= 0" @click.stop="toggleJunk(j.entry.id)" />
                    <span class="qb__jid">#{{ j.entry.id }}</span>
                    <span class="qb__jtitle">{{ j.entry.title }}</span>
                    <span class="qb__jreason">{{ j.reason }}</span>
                  </div>
                  <div class="qb__actions">
                    <button class="qb__btn qb__btn--danger" @click="deleteJunk">删除勾选的 {{ junkPicked.length }} 条</button>
                    <button class="qb__btn" @click="junkPicked = []">全不选</button>
                    <button class="qb__btn" @click="junkPicked = junkList.map((x) => x.entry.id)">全选</button>
                  </div>
                </div>
                <div v-else-if="scanned" class="qb__empty">没有发现可疑条目。</div>
                <div v-else class="qb__empty">先点上面的按钮扫描。</div>
              </div>
            </template>

            <template v-if="paperOpen">
              <div class="qb__paper">
                <div class="qb__bhead">按规则挑题 —— 从「当前筛选结果」里抽；同一道题不会被抽两次</div>
                <div v-for="r in rules" :key="r.id" class="qb__rule">
                  <select v-model="r.qtype" class="qb__rsel" title="题型">
                    <option value="">不限题型</option>
                    <option v-for="t in QTYPES" :key="t.v" :value="t.v">{{ t.label }}</option>
                  </select>
                  <select v-model="r.section" class="qb__rsel" title="板块">
                    <option value="">不限板块</option>
                    <option v-for="s in SECTIONS" :key="s" :value="s">{{ s }}</option>
                  </select>
                  <select v-model="r.chapter" class="qb__rsel" title="章节（第二级）">
                    <option value="">不限章节</option>
                    <option v-for="c in chaptersOf(r.section)" :key="c" :value="c">{{ c }}</option>
                  </select>
                  <select v-model="r.level" class="qb__rsel" title="难度">
                    <option value="">不限难度</option>
                    <option v-for="l in LEVELS" :key="l.v" :value="l.v">{{ l.label }}</option>
                  </select>
                  <input v-model.number="r.count" type="number" min="0" max="99" class="qb__rcount" title="题量" />
                  <button class="qb__btn qb__btn--tiny" title="删除这条规则" @click="removeRule(r.id)">×</button>
                </div>
                <div class="qb__actions">
                  <button class="qb__btn" @click="addRule">＋ 添加规则</button>
                  <span class="qb__chk">抽题是随机的 —— 同样的规则每次抽出的卷子不一样</span>
                  <label class="qb__chk" title="默认优先挑从来没出过的题；关掉就纯随机"><input v-model="preferUnused" type="checkbox" /> 优先挑没出过的题</label>
                </div>
                <div class="qb__actions">
                  <button class="qb__btn qb__btn--pri" @click="doPick">一键挑题</button>
          <!-- 双向细目表：行=板块、列=难度 1..5，格=题数/分值（"—" = 这一格没覆盖） -->
          <div v-if="bp && bp.count" class="qb__bp">
            <div class="qb__bptitle2">双向细目表：<b>{{ bp.count }}</b> 道 / <b>{{ bp.score }}</b> 分</div>
            <table class="qb__bptable">
              <thead>
                <tr><th>板块 \ 难度</th><th v-for="d in bp.cols" :key="d">{{ d }}</th><th>合计</th></tr>
              </thead>
              <tbody>
                <tr v-for="r in bp.rows" :key="r.section">
                  <td class="qb__bps">{{ r.section }}</td>
                  <td v-for="(c, i) in r.cells" :key="i" :class="{ 'qb__bp0': !c.count }">{{ c.count ? c.count + ' / ' + c.score : '—' }}</td>
                  <td><b>{{ r.count }} / {{ r.score }}</b></td>
                </tr>
              </tbody>
            </table>
          </div>
                  <button class="qb__btn" :disabled="manageOnly || !paperResult || !paperResult.picked.length" @click="sendPaper(false)">送进 PDF（仅题干）</button>
                  <button class="qb__btn" :disabled="manageOnly || !paperResult || !paperResult.picked.length" @click="sendPaper(true)">送进 PDF（含答案）</button>
                  <button class="qb__btn" @click="resetRules">清空规则</button>
                </div>

                <div class="qb__papers">
                  <div class="qb__bptitle">或按试卷整套插入（按「年份 + 试卷名」归组）</div>
                  <div v-if="!paperGroups.length" class="qb__empty">题库里还没有带年份/试卷名的题 —— 批量导入时填「年份」「试卷名」，或在题里写【年份】【试卷】。</div>
                  <div v-for="(gp, i) in paperGroups" :key="i" class="qb__prow qb__prow--paper">
                    <span class="qb__ptitle">{{ gp.year || '未标年份' }} · {{ gp.paperName || '未标试卷名' }}<b v-if="!gp.paperName" class="qb__warn" title="这些题没有试卷名 —— 是『未归卷』的散题，整套插入会把它们全部插进正文">⚠ 散题合集</b></span>
                    <span class="qb__pcount">{{ gp.count }} 道 · 满分 {{ paperTotal(gp.items) }} 分</span>
                    <button class="qb__btn qb__btn--tiny" :disabled="manageOnly" @click="insertPaperGroup(gp, false)">插入整套</button>
                    <button class="qb__btn qb__btn--tiny" @click="insertPaperGroup(gp, true)">含答案整套</button>
                  </div>
                  <button class="qb__btn" @click="paperOpen = false">返回列表</button>
                </div>

                <div v-if="paperResult" class="qb__pres">
                  <div class="qb__bptitle">挑题结果：共 {{ paperResult.picked.length }} 道 · 预计满分 {{ paperTotal(paperResult.picked) }} 分</div>
                  <div v-for="(x, i) in paperResult.results" :key="i" class="qb__prow" :class="{ 'qb__prow--short': x.short }">
                    {{ ruleText(x.rule) }} —— 命中 {{ x.got }} / {{ x.want }}
                    <b v-if="x.short">（库里只有这么多，少了 {{ x.want - x.got }} 道）</b>
                  </div>
                </div>

                <div v-if="dupReport" class="qb__dups">
                  <div class="qb__bptitle">
                    组卷查重：
                    <template v-if="!dupReport.pairs.length">未发现重复</template>
                    <template v-else>发现 <b class="qb__noans">{{ dupReport.pairs.length }}</b> 组疑似重复</template>
                  </div>
                  <div v-for="(p, i) in dupReport.pairs.slice(0, 8)" :key="i" class="qb__dup">
                    <span class="qb__dupk">{{ p.same ? '完全相同' : '相似 ' + (p.sim * 100).toFixed(0) + '%' }}</span>
                    <b>#{{ p.a.id }} {{ p.a.title }}</b>
                    <span class="qb__dupvs">↔</span>
                    <b>#{{ p.b.id }} {{ p.b.title }}</b>
                  </div>
                  <div class="qb__dupnote">近重复只认「文字高度接近」的（错字、空格、标点）；语义相同的改写认不出来，需要人工核对。</div>
                </div>
              </div>
            </template>

            <template v-if="batchOpen">
              <div class="qb__batch">
                <div class="qb__bhead">把整份试题粘贴到下面，点「识别并导入」</div>
                <div class="qb__batchtop">
                  <label class="qb__byl">年份<input v-model="batchYear" class="qb__byi" type="text" placeholder="2024（本批全部套用）" /></label>
                  <label class="qb__byl">试卷名<input v-model="batchPaper" class="qb__byi" type="text" placeholder="2024届某市一模（本批全部套用）" /></label>
                  <span v-if="detected.year || detected.paperName" class="qb__autod">
                    已自动识别：<b>{{ detected.year || '年份未认出' }}</b> · <b>{{ detected.paperName || '试卷名未认出' }}</b>
                    <em>（{{ detected.from }}；可直接改）</em>
                  </span>
                  <span v-else-if="batchText" class="qb__autod qb__autod--none">没能从正文认出年份与试卷名 —— 请手填下面两项</span>
                </div>
                <textarea v-model="batchText" class="qb__btext" rows="15" placeholder="示例：
1. 已知 x&gt;0，求 x+1/x 的最小值。
A. 1
B. 2
【答案】B
【解析】由基本不等式 x+1/x ≥ 2√(x·1/x) = 2。
【知识点】基本不等式, 最值
【难度】2
---
2. 下一道题……"></textarea>
                <div class="qb__binfo">
                  <b>识别到 {{ parsed.length }} 道题</b>
                  <span v-if="parsed.length" class="qb__bwarn">
                    <template v-if="parsed.filter((p) => p.warn).length">—— {{ parsed.length }} 道里 {{ parsed.filter((p) => p.warn).length }} 道需要核对（选项不全 / 没答案 / 题干过短）；入库后点「只看待核对」逐题处理；若是整卷选项都缺，换「全图 OCR」重跑一次更稳</template>
                    <template v-if="parsedInfo.skipped">；已跳过 {{ parsedInfo.skipped }} 行考生须知／抬头</template>
                    <span v-if="batchImages.length" class="qb__bimg">；本批次 {{ batchImages.length }} 张插图（已转成 [图N]，随题入库）</span>
                  </span>
                </div>
                <details class="qb__bhelp">
                  <summary>格式说明（点开）</summary>
                  <ul><li v-for="(h, i) in PARSE_HELP" :key="i">{{ h }}</li></ul>
                </details>
                <div class="qb__actions">
                  <button class="qb__btn qb__btn--pri" :disabled="!parsed.length" @click="doBatch">识别并导入</button>
                  <button class="qb__btn" @click="batchOpen = false">返回列表</button>
                  <button class="qb__btn" @click="batchText = ''; batchImages = []">清空</button>
                </div>
                <div v-if="parsed.length" class="qb__bprev">
                  <div class="qb__bptitle">预览（前 5 道）</div>
                  <div v-for="(p, i) in parsed.slice(0, 5)" :key="i" class="qb__bpitem">
                    <b>{{ p.title }}</b>
                    <span>选项 {{ p.options.length }} · 答案 {{ p.answer || '—' }} · 难度 {{ p.difficulty }}<template v-if="imgCountOf(p)"> · 图 {{ imgCountOf(p) }}</template><template v-if="p.knowledge.length"> · {{ p.knowledge.join('、') }}</template></span>
                  </div>
                </div>
              </div>
            </template>

            <template v-if="!batchOpen && editing">
              <div class="qb__form">
                <label>标题<input v-model="formTitle" type="text" :placeholder="autoTitle(form)" /></label>
                <label>题干<textarea v-model="form.stem" rows="4" placeholder="支持 LaTeX：$x^2+y^2=1$；也可写 [图N] 引用试卷里的图"></textarea></label>
                <label>选项（一行一个，可留空）<textarea v-model="formOptions" rows="3" placeholder="每个选项一行，不要写 A. 前缀"></textarea></label>
                <label>答案<input v-model="form.answer" type="text" placeholder="如 D" /></label>
                <label>解析<textarea v-model="form.solution" rows="4" placeholder="支持 LaTeX 与多行"></textarea></label>
                <div class="qb__row">
                  <label>题型<select v-model="form.qtype"><option v-for="t in QTYPES" :key="t.v" :value="t.v">{{ t.label }}</option></select></label>
                  <label>板块<select v-model="form.section"><option value="">（按关键词自动归类）</option><option v-for="s in SECTIONS" :key="s" :value="s">{{ s }}</option></select></label>
                  <label>章节<select v-model="form.chapter"><option value="">（未细分）</option><option v-for="c in chaptersOf(form.section)" :key="c" :value="c">{{ c }}</option></select></label>
                  <label>分值<input v-model.number="form.score" type="number" min="0" max="50" :placeholder="'默认 ' + defaultScore(form.qtype) + ' 分'" /></label>
                  <label>难度<select :value="levelOf(form.difficulty)" @change="form.difficulty = levelToDifficulty(($event.target as HTMLSelectElement).value as Level)"><option v-for="l in LEVELS" :key="l.v" :value="l.v">{{ l.label }}</option></select></label>
                </div>
                <div class="qb__row">
                  <label>知识点（逗号分隔）<input v-model="formKnowledge" type="text" placeholder="基本不等式, 最值" /></label>
                  <label>日期<input v-model="form.date" type="date" /></label>
                </div>
                <div class="qb__row">
                  <label>年份<input v-model="form.year" type="text" placeholder="2024" /></label>
                  <label>来源<input v-model="form.region" type="text" placeholder="课本 P46 / 某市模拟" /></label>
                </div>
                <div class="qb__row">
                  <label>试卷名<input v-model="form.paperName" type="text" placeholder="如 2024届某市一模（整套插入按它归组）" /></label>
                </div>
                <div class="qb__actions">
                  <button class="qb__btn qb__btn--pri" @click="save">保存</button>
                  <button class="qb__btn" @click="cancelEdit">取消</button>
                </div>
              </div>
            </template>

            <template v-else-if="selected">
              <div class="qb__view">
                <div class="qb__vtitle">{{ selected.title }}</div>
                <div class="qb__vsec"><b>题干</b><pre>{{ selected.q.stem }}</pre></div>
                <div v-if="selected.q.options.length" class="qb__vsec"><b>选项</b><pre>{{ selected.q.options.map((o, i) => String.fromCharCode(65 + i) + '. ' + o).join('\n') }}</pre></div>
                <div v-if="selected.q.answer" class="qb__vsec"><b>答案</b><pre>{{ selected.q.answer }}</pre></div>
                <div v-if="selected.q.solution" class="qb__vsec"><b>解析</b><pre>{{ selected.q.solution }}</pre></div>
                <div v-if="(selected.q.images || []).length" class="qb__vsec">
                  <b>插图（{{ (selected.q.images || []).length }} 张，随题入库；插入试卷时自动配号）</b>
                  <div class="qb__vfigs">
                    <figure v-for="im in (selected.q.images || [])" :key="im.n">
                      <img :src="im.src" :alt="'图' + im.n" />
                      <figcaption>[图{{ im.n }}]<template v-if="im.caption"> {{ im.caption }}</template></figcaption>
                    </figure>
                  </div>
                </div>
                <div class="qb__vmeta">
                  {{ qtypeLabel(selected.q.qtype) }} · 难度 {{ levelLabel(selected.q.difficulty) }}
                  <template v-if="selected.q.section"> · 板块 {{ selected.q.section }}</template>
                  <template v-if="selected.q.date"> · 录入 {{ selected.q.date }}</template>
                  <template v-if="selected.q.knowledge.length"> · 知识点 {{ selected.q.knowledge.join('、') }}</template>
                  <template v-if="selected.q.year"> · {{ selected.q.year }}</template>
                  <template v-if="selected.q.region"> · {{ selected.q.region }}</template>
                  <template v-if="selected.q.answerFrom === 'auto'"> · <b class="qb__auto">答案由解析自动提取，请核对</b></template>
                  <template v-if="!selected.q.answer.trim()"> · <b class="qb__noans">缺答案</b></template>
                </div>
                <div class="qb__actions">
                  <button class="qb__btn qb__btn--pri" :disabled="manageOnly" @click="insertOne(false)">插入题干</button>
                  <button class="qb__btn" :disabled="manageOnly" @click="insertOne(true)">插入题干+答案+解析</button>
                  <button class="qb__btn" @click="startEdit(selected)">编辑</button>
                  <button class="qb__btn qb__btn--danger" @click="del(selected)">删除</button>
                </div>
              </div>
            </template>

            <div v-else class="qb__empty">左侧选一道题，这里显示题干与答案解析。</div>
          </div>
        </div>

        <div class="qb__foot">
          <span v-if="msg" class="qb__msg">{{ msg }}</span>
          <span v-else-if="manageOnly" class="qb__hint">这里只管理题库 —— 要把题插进试卷，请关掉本窗口，从「PDF 生成 → 试题库」打开</span>
          <span v-else class="qb__hint">插入位置＝试卷正文末尾；插入后可在正文里继续编辑</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.qb__paper { display: flex; flex-direction: column; gap: 8px; }
.qb__rule { display: flex; align-items: center; gap: 6px; }
.qb__rsel { flex: 1; min-width: 0; padding: 5px 8px; border: 1px solid #dcdce6; border-radius: 8px; font-size: 12.5px; }
.qb__rcount { width: 68px; padding: 5px 8px; border: 1px solid #dcdce6; border-radius: 8px; font-size: 12.5px; }
.qb__btn--tiny { padding: 3px 9px; font-size: 14px; line-height: 1; }
.qb__chk { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--muted, #888); }
.qb__clean { display: flex; flex-direction: column; gap: 8px; }
.qb__junk { border-top: 1px dashed #e4e4ee; padding-top: 8px; }
.qb__jrow { display: flex; align-items: center; gap: 8px; font-size: 12.5px; padding: 4px 8px; background: #fff7e6; border-radius: 6px; margin-bottom: 4px; cursor: pointer; }
.qb__jid { color: var(--muted, #999); flex: none; }
.qb__jtitle { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.qb__jreason { flex: none; color: #b25f00; }
.qb__papers { border-top: 1px dashed #e4e4ee; padding-top: 8px; }
.qb__prow--paper { display: flex; align-items: center; gap: 8px; }
.qb__ptitle { flex: 1; min-width: 0; font-weight: 600; }
.qb__warn { margin-left: 6px; font-weight: 400; font-size: 11.5px; color: #b25f00; }
.qb__hbtn { padding: 1px 6px; border: 1px solid transparent; border-radius: 6px; background: transparent; font: inherit; font-size: 12.5px; color: #475569; cursor: pointer; }
.qb__hbtn:hover { background: #eef2f7; border-color: #dbe6f1; }
.qb__health { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; padding: 6px 12px; margin: 0 0 6px; background: #f8fafc; border: 1px solid #eef2f7; border-radius: 8px; font-size: 12.5px; color: #475569; }
.qb__health b { color: #1e293b; }
.qb__h--warn { color: #b25f00; font-weight: 600; }
.qb__bp { margin: 8px 0; padding: 8px 10px; border: 1px solid #e6eef8; border-radius: 8px; background: #fbfdff; overflow: auto; }
.qb__bptitle2 { font-size: 12.5px; color: #475569; margin-bottom: 6px; }
.qb__bptable { border-collapse: collapse; font-size: 12px; }
.qb__bptable th, .qb__bptable td { border: 1px solid #e6eef8; padding: 3px 8px; text-align: center; white-space: nowrap; }
.qb__bptable th { background: #f1f5f9; color: #334155; font-weight: 600; }
.qb__bps { text-align: left; color: #334155; }
.qb__bp0 { color: #cbd5e1; }
.qb__warnbox { display: inline-block; margin-left: 8px; padding: 2px 8px; border-radius: 6px; background: #fff7e6; border: 1px solid #ffd591; color: #ad6800; font-size: 12px; }
.qb__pcount { font-size: 11.5px; color: var(--muted, #888); }
.qb__batchtop { display: flex; gap: 12px; flex-wrap: wrap; }
.qb__byl { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--muted, #777); flex: 1; min-width: 160px; }
.qb__byi { padding: 6px 9px; border: 1px solid #dcdce6; border-radius: 8px; font-size: 13px; }
.qb__autod { font-size: 12px; color: #0f766e; align-self: flex-end; padding-bottom: 4px; }
.qb__autod em { font-style: normal; color: var(--muted, #999); }
.qb__autod--none { color: #b25f00; }
.qb__pres { border-top: 1px dashed #e4e4ee; padding-top: 8px; }
.qb__prow { font-size: 12.5px; padding: 4px 8px; border-radius: 6px; background: #fafafd; margin-bottom: 4px; }
.qb__prow--short { background: #fff7e6; }
.qb__prow--short b { color: #b25f00; }
.qb__dups { border-top: 1px dashed #e4e4ee; padding-top: 8px; }
.qb__dup { font-size: 12.5px; padding: 4px 8px; background: #fff7e6; border-radius: 6px; margin-bottom: 4px; }
.qb__dupk { display: inline-block; min-width: 64px; color: #b25f00; }
.qb__dupvs { margin: 0 6px; color: var(--muted, #999); }
.qb__dupnote { font-size: 11.5px; color: var(--muted, #999); margin-top: 4px; }
/* ⚠ z-index 要高于试卷弹层（.pm 是 2000、.pm__help 是 3000）—— 本弹窗是从试卷里打开的 */
.qb { position: fixed; inset: 0; z-index: 3400; background: rgba(20, 20, 28, .42); display: flex; align-items: center; justify-content: center; }
.qb__box { width: 1080px; max-width: 95vw; height: 86vh; background: var(--surface, #fff); border-radius: 12px; box-shadow: 0 18px 60px rgba(0,0,0,.28); display: flex; flex-direction: column; overflow: hidden; }
.qb__head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border, #e8e8f0); }
.qb__title { font-weight: 700; }
.qb__title em { font-style: normal; font-weight: 400; font-size: 12px; color: var(--muted, #888); margin-left: 8px; }
.qb__tools { display: flex; align-items: center; gap: 8px; }
.qb__close { border: 0; background: none; cursor: pointer; color: var(--muted, #888); }
.qb__bar { display: flex; align-items: center; gap: 10px; padding: 10px 16px 6px; }
/* MinerU：token 输入 + 模式说明 + 进度 */
.qb__mineru { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 16px; background: #f7f5ff; border-bottom: 1px solid var(--border, #e8e8f0); font-size: 12px; }
.qb__mlabel { color: #4b3fa8; font-weight: 600; }
.qb__minput { width: 230px; padding: 5px 9px; border: 1px solid #d8d2f0; border-radius: 8px; font-size: 12.5px; background: #fff; }
.qb__mhint { color: var(--muted, #888); flex: 1; min-width: 220px; }
.qb__mhint--on { color: #0f766e; }
.qb__mlink { color: #4b3fa8; text-decoration: none; border-bottom: 1px dashed #b9a9f0; }
.qb__mprog { color: #0f766e; font-weight: 600; max-width: 100%; word-break: break-all; }
.qb__mprog--err { color: #c0392b; }
.qb__search { flex: 1; padding: 7px 10px; border: 1px solid #dcdce6; border-radius: 8px; font-size: 13px; }
.qb__count { font-size: 12px; color: var(--muted, #888); }
.qb__filters { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; padding: 6px 16px 2px; }
.qb__fg { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted, #888); }
.qb__f { border: 1px solid #e0e0ea; background: #fafafd; border-radius: 999px; padding: 3px 10px; font-size: 12px; cursor: pointer; }
.qb__f:hover { background: #f1eeff; border-color: #b9a9f0; }
.qb__f--on { background: #efeaff; border-color: #b9a9f0; color: #4b3fa8; font-weight: 600; }
.qb__pdf { background: #0f766e; border-color: #0f766e; color: #fff; }
.qb__pdf:disabled { opacity: .45; cursor: not-allowed; }
.qb__pick { grid-row: span 2; align-self: start; padding-top: 2px; }
.qb__pick input { cursor: pointer; }
.qb__noans { color: #b25f00; }
.qb__auto { color: #0f766e; }
.qb__tags { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 16px 10px; }
.qb__tag { border: 1px solid #e0e0ea; background: #fafafd; border-radius: 999px; padding: 3px 10px; font-size: 12px; cursor: pointer; }
.qb__tag--on { background: #efeaff; border-color: #b9a9f0; color: #4b3fa8; }
.qb__body { flex: 1; display: flex; min-height: 0; border-top: 1px solid var(--border, #e8e8f0); }
.qb__list { width: 340px; flex: none; overflow: auto; border-right: 1px solid var(--border, #e8e8f0); padding: 8px; }
.qb__item { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; text-align: left; border: 1px solid transparent; background: none; padding: 8px 10px; border-radius: 8px; cursor: pointer; }
.qb__item:hover { background: #f6f6fb; }
.qb__item--on { background: #efeaff; border-color: #b9a9f0; }
.qb__it { font-size: 13px; font-weight: 600; }
.qb__im { font-size: 11.5px; color: var(--muted, #888); }
.qb__detail { flex: 1; min-width: 0; overflow: auto; padding: 12px 16px; }
.qb__slide { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px dashed #e2e8f0; }
.qb__slideck { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: #475569; }
.qb__slidehint { font-size: 12px; color: #94a3b8; }
.qb__empty { color: var(--muted, #888); font-size: 13px; padding: 18px; }
.qb__vtitle { font-weight: 700; margin-bottom: 8px; }
.qb__vsec { margin-bottom: 10px; }
.qb__vsec b { font-size: 12px; color: var(--brand-700, #4b3fa8); }
.qb__vsec pre { margin: 4px 0 0; white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 13px; line-height: 1.7; background: #fafafd; border: 1px solid #eeeef6; border-radius: 8px; padding: 8px 10px; }
.qb__vmeta { font-size: 12px; color: var(--muted, #888); margin: 6px 0 10px; }
.qb__batch { display: flex; flex-direction: column; gap: 10px; }
.qb__bhead { font-size: 13px; color: var(--muted, #777); }
.qb__btext { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #dcdce6; border-radius: 8px; font-size: 13px; font-family: inherit; line-height: 1.7; resize: vertical; }
.qb__binfo { font-size: 13px; }
.qb__bwarn { color: #b25f00; margin-left: 8px; font-size: 12px; }
.qb__bhelp { font-size: 12px; color: var(--muted, #777); }
.qb__bhelp summary { cursor: pointer; }
.qb__bhelp ul { margin: 6px 0 0 18px; padding: 0; line-height: 1.9; }
.qb__bprev { border-top: 1px dashed #e4e4ee; padding-top: 8px; }
.qb__bimg { color: #0f766e; margin-left: 8px; font-size: 12px; }
/* 题目插图缩略图（题库详情）：让老师入库后能当场看到图，不用等插进试卷 */
.qb__vfigs { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; }
.qb__vfigs figure { margin: 0; border: 1px solid #eeeef6; border-radius: 8px; padding: 6px; background: #fff; max-width: 250px; }
.qb__vfigs img { display: block; max-width: 230px; max-height: 190px; }
.qb__vfigs figcaption { font-size: 11.5px; color: var(--muted, #888); margin-top: 4px; text-align: center; }
.qb__bptitle { font-size: 12px; color: var(--muted, #888); margin-bottom: 6px; }
.qb__bpitem { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; border-radius: 6px; background: #fafafd; margin-bottom: 4px; }
.qb__bpitem b { font-size: 12.5px; }
.qb__bpitem span { font-size: 11.5px; color: var(--muted, #888); }
.qb__btn:disabled { opacity: .5; cursor: not-allowed; }
.qb__form { display: flex; flex-direction: column; gap: 9px; }
.qb__form label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--muted, #777); }
.qb__form input, .qb__form textarea { padding: 6px 9px; border: 1px solid #dcdce6; border-radius: 8px; font-size: 13px; font-family: inherit; }
.qb__row { display: flex; gap: 10px; }
.qb__row label { flex: 1; }
.qb__actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.qb__btn { border: 1px solid #dcdce6; background: #fff; border-radius: 8px; padding: 6px 12px; font-size: 13px; cursor: pointer; }
.qb__btn--pri { background: var(--brand-600, #534ab7); border-color: var(--brand-600, #534ab7); color: #fff; }
.qb__btn--danger { color: #d92d20; border-color: #f4c9c5; }
.qb__foot { padding: 8px 16px; border-top: 1px solid var(--border, #e8e8f0); font-size: 12px; min-height: 18px; }
.qb__msg { color: var(--brand-700, #4b3fa8); }
.qb__hint { color: var(--muted, #999); }
</style>
