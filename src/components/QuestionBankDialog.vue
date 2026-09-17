<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import {
  listQuestions, addQuestion, updateQuestion, removeQuestion, touchQuestion,
  listQuestionTags, autoTitle, questionToText, filterQuestions,
  importParsedQuestions, proposeAnswers, parseQuestionsJson, exportQuestionsJson,
  pickByRules, ruleText, findDuplicates, groupPapers, paperGroupToText,
  buildPaperText, scoreOf, defaultScore,
  QTYPES, SECTIONS, LEVELS, levelOf, levelLabel, levelToDifficulty, qtypeLabel, withDefaults,
} from '@/composables/useQuestionLibrary'
import type { QuestionEntry, QuestionMeta, QType, Level, PaperRule, RuleResult, PaperGroup } from '@/composables/useQuestionLibrary'
import { parseQuestions, PARSE_HELP, detectPaperInfo } from '@/composables/parseQuestions'
import { saveTextFile } from '@/composables/useTauri'

const emit = defineEmits<{ (e: 'close'): void; (e: 'insert', text: string, id: number): void }>()

const list = ref<QuestionEntry[]>([])
const tags = ref<{ name: string; count: number }[]>([])
const loading = ref(true)
const msg = ref('')
const q = ref('')

/* ---- 批量导入（粘一整个文档，解析后一次性入库） ---- */
const batchOpen = ref(false)
const batchText = ref('')
const parsed = computed(() => parseQuestions(batchText.value))
/** 本批次统一套用的年份与试卷名（题内写了【年份】【试卷】则以题内为准） */
const batchYear = ref('')
const batchPaper = ref('')
/** 自动识别结果（粘进来就填，用户可以改） */
const detected = ref({ year: '', paperName: '', from: '' })
// 正文一变就重新识别：认出来就填进去，认不出就保持原样（不覆盖用户手填的内容）
watch(batchText, (v) => {
  const d = detectPaperInfo(v || '')
  detected.value = d
  if (d.year) batchYear.value = d.year
  if (d.paperName) batchPaper.value = d.paperName
})
/** 一组题的卷面总分（题内分值优先，否则按题型默认） */
function paperTotal(arr: QuestionEntry[]): number {
  return arr.reduce((s, x) => s + scoreOf(x), 0)
}

/** 整套插入：按「年份 + 试卷名」归组的卷子列表 */
const paperGroups = computed(() => groupPapers(list.value))
function insertPaperGroup(g: PaperGroup, withSolution: boolean) {
  if (!g.items.length) { flash('这一套里没有题'); return }
  emit('insert', paperGroupToText(g, withSolution), 0)
  g.items.forEach((x) => void touchQuestion(x.id))
  flash('已整套插入「' + (g.year ? g.year + ' ' : '') + (g.paperName || '未命名试卷') + '」共 ' + g.count + ' 道')
}
async function doBatch() {
  if (!parsed.value.length) return
  // 批次级的年份 / 试卷名：题内没写就套用批次的
  const items = parsed.value.map((p) => ({
    ...p,
    yearExplicit: p.yearExplicit || batchYear.value.trim(),
    paperName: p.paperName || batchPaper.value.trim(),
  }))
  const r = await importParsedQuestions(items)
  await load()
  batchOpen.value = false
  batchText.value = ''
  flash('已导入 ' + r.added + ' 道题' + (r.skipped ? '，跳过 ' + r.skipped + ' 道（与库里已有的题干重复）' : ''))
}
/* ---- 规则组卷（双向细目表）+ 组卷查重 ---- */
const paperOpen = ref(false)
const rules = ref<PaperRule[]>([{ id: 1, qtype: 'choice', section: '', level: '', count: 5 }])
let ruleSeq = 1
const paperResult = ref<{ picked: QuestionEntry[]; results: RuleResult[] } | null>(null)
const dupReport = ref<{ pairs: { a: QuestionEntry; b: QuestionEntry; same: boolean; sim: number }[]; skippedNear: boolean } | null>(null)

function addRule() {
  ruleSeq++
  rules.value = [...rules.value, { id: ruleSeq, qtype: '', section: '', level: '', count: 5 }]
}
function removeRule(id: number) {
  rules.value = rules.value.filter((r) => r.id !== id)
}
function resetRules() {
  rules.value = [{ id: ++ruleSeq, qtype: 'choice', section: '', level: '', count: 5 }]
  paperResult.value = null
  dupReport.value = null
}
/** 一键挑题：从**当前筛选结果**里按规则抽，并顺手做组卷查重 */
function doPick() {
  const pool = shown.value
  if (!pool.length) { flash('当前筛选结果里没有题 —— 先放宽筛选条件'); return }
  const active = rules.value.filter((r) => (Number(r.count) || 0) > 0)
  if (!active.length) { flash('至少填一条规则的题量'); return }
  const r = pickByRules(pool, active)
  paperResult.value = r
  dupReport.value = findDuplicates(r.picked)
  const shortCnt = r.results.filter((x) => x.short).length
  flash('已挑出 ' + r.picked.length + ' 道' + (shortCnt ? '，有 ' + shortCnt + ' 条规则题量不够（已如实标注）' : ''))
}
/** 把挑好的卷子送进 PDF 生成（按 选择→填空→解答 排序） */
function sendPaper(withSolution: boolean) {
  const arr = paperResult.value ? paperResult.value.picked : []
  if (!arr.length) { flash('先点「一键挑题」'); return }
  emit('insert', buildPaperText(arr, { withSolution }), 0)
  arr.forEach((x) => void touchQuestion(x.id))
  flash('已把 ' + arr.length + ' 道题送进 PDF 生成（共 ' + paperTotal(arr) + ' 分）')
}

/* ---- 整库导入导出：导入 MD / 导入 JSON / 导出 JSON ---- */
const fileInput = ref<HTMLInputElement | null>(null)
const fileMode = ref<'md' | 'json'>('md')
function pickFile(mode: 'md' | 'json') {
  fileMode.value = mode
  const el = fileInput.value
  if (!el) return
  el.accept = mode === 'json' ? '.json,application/json' : '.md,.markdown,.txt,text/plain'
  el.value = ''
  el.click()
}
async function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files && input.files[0]
  if (!f) return
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
async function exportJson() {
  const arr = shown.value.length ? shown.value : list.value
  if (!arr.length) { flash('题库是空的，没有可导出的题'); return }
  const name = '题库导出-' + new Date().toISOString().slice(0, 10) + '.json'
  const path = await saveTextFile(name, exportQuestionsJson(arr))
  flash(path ? '已导出 ' + arr.length + ' 道题到：' + path : '已导出 ' + arr.length + ' 道题')
}

const pickedTags = ref<string[]>([])
const diff = ref<number | null>(null)
const selectedId = ref(0)
/* ---- 新增筛选维度（题型 / 板块 / 难度分级 / 只看缺答案） ---- */
const pickedType = ref<QType | ''>('')
const pickedSection = ref('')
const pickedLevel = ref<Level | ''>('')
const onlyMissing = ref(false)
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
  // 统一走 buildPaperText：按题型分段 + 每题（x分）+ 卷面总分 —— 与整套插入排版一致
  emit('insert', buildPaperText(arr, { withSolution }), 0)
  arr.forEach((x) => void touchQuestion(x.id))
  flash('已把 ' + arr.length + ' 道题送进 PDF 生成（共 ' + paperTotal(arr) + ' 分）')
}
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
  knowledge: [], difficulty: 3, score: 0, qtype: 'choice', section: '', date: '',
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
  difficulty: diff.value,
  qtype: pickedType.value,
  section: pickedSection.value,
  level: pickedLevel.value,
  onlyMissingAnswer: onlyMissing.value,
}))
const selected = computed(() => list.value.find((x) => x.id === selectedId.value) || null)

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
  const id = editingId.value > 0
    ? await updateQuestion(editingId.value, meta, formTitle.value)
    : await addQuestion(meta, formTitle.value)
  if (!id) { flash('保存失败 —— 内容库不可用？'); return }
  await load()
  selectedId.value = id
  editing.value = false
  editingId.value = 0
  flash(editingId.value ? '已更新' : '已存入试题库')
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
  emit('insert', questionToText(x, withSolution), x.id)
  void touchQuestion(x.id)
}
function close() { emit('close') }
</script>

<template>
  <Teleport to="body">
    <!-- 整库导入用的隐藏文件选择器（accept 在 pickFile 里按模式设置） -->
    <input ref="fileInput" type="file" style="display:none" @change="onFilePicked" />
    <div class="qb" @mousedown.self="close">
      <div class="qb__box">
        <div class="qb__head">
          <div class="qb__title">试题库<em>（供 PDF 生成组卷：选定后插入题干，可带答案解析）</em></div>
          <div class="qb__tools">
            <button class="qb__btn" title="把整份试题粘贴进来，一次性识别并入库" @click="batchOpen = true; editing = false">批量导入</button>
            <button class="qb__btn" title="重新从内容库读取（外部改动后点它刷新列表）" @click="load()">刷新</button>
            <button class="qb__btn" title="按规则挑题（双向细目表）：设题型/板块/难度/题量，一键抽出整卷" @click="paperOpen = true; editing = false; batchOpen = false">规则组卷</button>
            <button class="qb__btn" title="导入 Markdown / 纯文本：读进来后先给你看识别结果，确认再入库" @click="pickFile('md')">导入 MD</button>
            <button class="qb__btn" title="导入题库 JSON（我们自己导出的、或 {questions:[…]} / 数组 都认）" @click="pickFile('json')">导入 JSON</button>
            <button class="qb__btn" title="把当前筛选出的题导出成 JSON（题库为空时导出全部）" @click="exportJson">导出 JSON</button>
            <button class="qb__btn" :title="'从解析里反推答案（认「故选B」这类明确写法），可补 ' + proposals.length + ' 道'" @click="doComplete">完善答案<template v-if="proposals.length">（{{ proposals.length }}）</template></button>
            <button class="qb__btn qb__btn--pri" title="新建一道试题" @click="startNew">＋ 新建试题</button>
            <button class="qb__btn qb__btn--pdf" :disabled="!pickedIds.length" title="把左边勾选的题按 选择→填空→解答 排序，一起送进 PDF 生成" @click="insertPicked(false)">生成 PDF（已选 {{ pickedIds.length }}）</button>
            <button class="qb__close" title="关闭" @click="close"><AppIcon name="close" :size="14" /></button>
          </div>
        </div>

        <div class="qb__bar">
          <input v-model="q" class="qb__search" type="text" placeholder="搜索题干 / 答案 / 解析 / 标签…" />
          <span class="qb__count">{{ shown.length }} / {{ list.length }}</span>
        </div>

        <!-- 筛选：题型 / 难度分级 / 板块 / 只看缺答案 -->
        <div class="qb__filters">
          <span class="qb__fg">题型
            <button v-for="t in QTYPES" :key="t.v" class="qb__f" :class="{ 'qb__f--on': pickedType === t.v }"
              @click="pickedType = (pickedType === t.v ? '' : t.v)">{{ t.label }}</button>
          </span>
          <span class="qb__fg">难度
            <button v-for="l in LEVELS" :key="l.v" class="qb__f" :class="{ 'qb__f--on': pickedLevel === l.v }"
              @click="pickedLevel = (pickedLevel === l.v ? '' : l.v)">{{ l.label }}</button>
          </span>
          <span class="qb__fg">板块
            <button class="qb__f" :class="{ 'qb__f--on': pickedSection === '' }" @click="pickedSection = ''">全部</button>
            <button v-for="s in SECTIONS" :key="s" class="qb__f" :class="{ 'qb__f--on': pickedSection === s }"
              @click="pickedSection = (pickedSection === s ? '' : s)">{{ s }}</button>
          </span>
          <span class="qb__fg">
            <button class="qb__f" :class="{ 'qb__f--on': onlyMissing }" title="只显示还没填答案的题"
              @click="onlyMissing = !onlyMissing">只看缺答案</button>
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
                <template v-if="x.q.section"> · {{ x.q.section }}</template>
                <template v-if="!x.q.answer.trim()"> · <b class="qb__noans">缺答案</b></template>
                <template v-else-if="x.q.answerFrom === 'auto'"> · <b class="qb__auto">自动</b></template>
              </span>
            </div>
          </div>

          <div class="qb__detail">
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
                </div>
                <div class="qb__actions">
                  <button class="qb__btn qb__btn--pri" @click="doPick">一键挑题</button>
                  <button class="qb__btn" :disabled="!paperResult || !paperResult.picked.length" @click="sendPaper(false)">送进 PDF（仅题干）</button>
                  <button class="qb__btn" :disabled="!paperResult || !paperResult.picked.length" @click="sendPaper(true)">送进 PDF（含答案）</button>
                  <button class="qb__btn" @click="resetRules">清空规则</button>
                </div>

                <div class="qb__papers">
                  <div class="qb__bptitle">或按试卷整套插入（按「年份 + 试卷名」归组）</div>
                  <div v-if="!paperGroups.length" class="qb__empty">题库里还没有带年份/试卷名的题 —— 批量导入时填「年份」「试卷名」，或在题里写【年份】【试卷】。</div>
                  <div v-for="(gp, i) in paperGroups" :key="i" class="qb__prow qb__prow--paper">
                    <span class="qb__ptitle">{{ gp.year || '未标年份' }} · {{ gp.paperName || '未标试卷名' }}</span>
                    <span class="qb__pcount">{{ gp.count }} 道 · 满分 {{ paperTotal(gp.items) }} 分</span>
                    <button class="qb__btn qb__btn--tiny" @click="insertPaperGroup(gp, false)">插入整套</button>
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
                    <template v-if="parsed.filter((p) => p.warn).length">其中 {{ parsed.filter((p) => p.warn).length }} 道没识别到答案</template>
                  </span>
                </div>
                <details class="qb__bhelp">
                  <summary>格式说明（点开）</summary>
                  <ul><li v-for="(h, i) in PARSE_HELP" :key="i">{{ h }}</li></ul>
                </details>
                <div class="qb__actions">
                  <button class="qb__btn qb__btn--pri" :disabled="!parsed.length" @click="doBatch">识别并导入</button>
                  <button class="qb__btn" @click="batchOpen = false">返回列表</button>
                  <button class="qb__btn" @click="batchText = ''">清空</button>
                </div>
                <div v-if="parsed.length" class="qb__bprev">
                  <div class="qb__bptitle">预览（前 5 道）</div>
                  <div v-for="(p, i) in parsed.slice(0, 5)" :key="i" class="qb__bpitem">
                    <b>{{ p.title }}</b>
                    <span>选项 {{ p.options.length }} · 答案 {{ p.answer || '—' }} · 难度 {{ p.difficulty }}<template v-if="p.knowledge.length"> · {{ p.knowledge.join('、') }}</template></span>
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
                  <button class="qb__btn qb__btn--pri" @click="insertOne(false)">插入题干</button>
                  <button class="qb__btn" @click="insertOne(true)">插入题干+答案+解析</button>
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
.qb__papers { border-top: 1px dashed #e4e4ee; padding-top: 8px; }
.qb__prow--paper { display: flex; align-items: center; gap: 8px; }
.qb__ptitle { flex: 1; min-width: 0; font-weight: 600; }
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
.qb__diff { margin-left: auto; font-size: 12px; color: var(--muted, #888); display: flex; align-items: center; gap: 4px; }
.qb__d { width: 22px; height: 22px; border: 1px solid #e0e0ea; background: #fafafd; border-radius: 6px; font-size: 12px; cursor: pointer; }
.qb__d--on { background: #efeaff; border-color: #b9a9f0; color: #4b3fa8; }
.qb__body { flex: 1; display: flex; min-height: 0; border-top: 1px solid var(--border, #e8e8f0); }
.qb__list { width: 340px; flex: none; overflow: auto; border-right: 1px solid var(--border, #e8e8f0); padding: 8px; }
.qb__item { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; text-align: left; border: 1px solid transparent; background: none; padding: 8px 10px; border-radius: 8px; cursor: pointer; }
.qb__item:hover { background: #f6f6fb; }
.qb__item--on { background: #efeaff; border-color: #b9a9f0; }
.qb__it { font-size: 13px; font-weight: 600; }
.qb__im { font-size: 11.5px; color: var(--muted, #888); }
.qb__detail { flex: 1; min-width: 0; overflow: auto; padding: 12px 16px; }
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
