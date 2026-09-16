<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import {
  listQuestions, addQuestion, updateQuestion, removeQuestion, touchQuestion,
  listQuestionTags, autoTitle, questionToText, filterQuestions,
} from '@/composables/useQuestionLibrary'
import { importParsedQuestions } from '@/composables/useQuestionLibrary'
import type { QuestionEntry, QuestionMeta } from '@/composables/useQuestionLibrary'
import { parseQuestions, PARSE_HELP } from '@/composables/parseQuestions'

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
async function doBatch() {
  if (!parsed.value.length) return
  const r = await importParsedQuestions(parsed.value)
  await load()
  batchOpen.value = false
  batchText.value = ''
  flash('已导入 ' + r.added + ' 道题' + (r.skipped ? '，跳过 ' + r.skipped + ' 道（与库里已有的题干重复）' : ''))
}
const pickedTags = ref<string[]>([])
const diff = ref<number | null>(null)
const selectedId = ref(0)

const emptyMeta = (): QuestionMeta => ({
  stem: '', options: [], answer: '', solution: '',
  knowledge: [], difficulty: 3, year: '', region: '',
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

const shown = computed(() => filterQuestions(list.value, { q: q.value, tags: pickedTags.value, difficulty: diff.value }))
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
  const meta: QuestionMeta = {
    ...form.value,
    stem,
    options: formOptions.value.split('\n').map((s) => s.trim()).filter(Boolean),
    knowledge: formKnowledge.value.split(/[，,、\s]+/).map((s) => s.trim()).filter(Boolean),
    difficulty: Number(form.value.difficulty) || 3,
  }
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
    <div class="qb" @mousedown.self="close">
      <div class="qb__box">
        <div class="qb__head">
          <div class="qb__title">试题库<em>（供 PDF 生成组卷：选定后插入题干，可带答案解析）</em></div>
          <div class="qb__tools">
            <button class="qb__btn" title="把整份试题粘贴进来，一次性识别并入库" @click="batchOpen = true; editing = false">批量导入</button>
            <button class="qb__btn qb__btn--pri" title="新建一道试题" @click="startNew">＋ 新建试题</button>
            <button class="qb__close" title="关闭" @click="close"><AppIcon name="close" :size="14" /></button>
          </div>
        </div>

        <div class="qb__bar">
          <input v-model="q" class="qb__search" type="text" placeholder="搜索题干 / 答案 / 解析 / 标签…" />
          <span class="qb__count">{{ shown.length }} / {{ list.length }}</span>
        </div>

        <div class="qb__tags" v-if="tags.length">
          <button
            v-for="t in tags" :key="t.name"
            class="qb__tag" :class="{ 'qb__tag--on': pickedTags.indexOf(t.name) >= 0 }"
            :title="'该标签下有 ' + t.count + ' 道题'"
            @click="toggleTag(t.name)">{{ t.name }}</button>
          <span class="qb__diff">
            难度
            <button v-for="d in [1,2,3,4,5]" :key="d"
              class="qb__d" :class="{ 'qb__d--on': diff === d }"
              @click="diff = (diff === d ? null : d)">{{ d }}</button>
          </span>
        </div>

        <div class="qb__body">
          <div class="qb__list">
            <div v-if="loading" class="qb__empty">正在读取试题库…</div>
            <div v-else-if="!shown.length" class="qb__empty">
              还没有试题。点右上角「＋ 新建试题」录入第一道。
            </div>
            <button
              v-for="x in shown" :key="x.id"
              class="qb__item" :class="{ 'qb__item--on': x.id === selectedId }"
              @click="selectedId = x.id">
              <span class="qb__it">{{ x.title }}</span>
              <span class="qb__im">难度 {{ x.q.difficulty }}<template v-if="x.q.knowledge.length"> · {{ x.q.knowledge.join('、') }}</template></span>
            </button>
          </div>

          <div class="qb__detail">
            <template v-if="batchOpen">
              <div class="qb__batch">
                <div class="qb__bhead">把整份试题粘贴到下面，点「识别并导入」</div>
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
                  <label>知识点（逗号分隔）<input v-model="formKnowledge" type="text" placeholder="基本不等式, 最值" /></label>
                  <label>难度<input v-model.number="form.difficulty" type="number" min="1" max="5" /></label>
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
                  难度 {{ selected.q.difficulty }}
                  <template v-if="selected.q.knowledge.length"> · 知识点 {{ selected.q.knowledge.join('、') }}</template>
                  <template v-if="selected.q.year"> · {{ selected.q.year }}</template>
                  <template v-if="selected.q.region"> · {{ selected.q.region }}</template>
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
.qb__tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 4px 16px 10px; }
.qb__tag { border: 1px solid #e0e0ea; background: #fafafd; border-radius: 999px; padding: 3px 10px; font-size: 12px; cursor: pointer; }
.qb__tag--on { background: #efeaff; border-color: #b9a9f0; color: #4b3fa8; }
.qb__diff { margin-left: auto; font-size: 12px; color: var(--muted, #888); display: flex; align-items: center; gap: 4px; }
.qb__d { width: 22px; height: 22px; border: 1px solid #e0e0ea; background: #fafafd; border-radius: 6px; font-size: 12px; cursor: pointer; }
.qb__d--on { background: #efeaff; border-color: #b9a9f0; color: #4b3fa8; }
.qb__body { flex: 1; display: flex; min-height: 0; border-top: 1px solid var(--border, #e8e8f0); }
.qb__list { width: 340px; flex: none; overflow: auto; border-right: 1px solid var(--border, #e8e8f0); padding: 8px; }
.qb__item { display: flex; flex-direction: column; gap: 3px; width: 100%; text-align: left; border: 1px solid transparent; background: none; padding: 8px 10px; border-radius: 8px; cursor: pointer; }
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
