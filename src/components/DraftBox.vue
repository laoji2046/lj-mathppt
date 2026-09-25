<script setup lang="ts">
/**
 * 草稿箱（题库 v4 · P1b，v5 数据层的前端入口）
 *
 * 干什么：AI / OCR 的输出**先落这里**，人工看一眼闸门给出的 warn、就地改、**确认后**才进正式库 ✓
 *
 * 纪律：
 *  - 这一屏**不直接写 library_item**：只有「确认入库」走 lib_import_commit，而它是 **fail-closed**
 *    （一条没确认，整批都不入）✓
 *  - 每条草稿都显示 warn（哪条闸门拦下的），**不猜、不自动改内容** ✓
 *  - 「从历史重建」只复制草稿，**不重调 OCR / LLM**（省钱）✓
 */
import { computed, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import {
  SECTIONS, QTYPE_LABEL,
  importBatches, importDrafts, importDraftPatch, importCommit, importDiscard, importRebuild,
  draftArr, draftStatusLabel, draftCanCommit, draftExcerpt,
} from '@/composables/useQuestionBank'
import type { ImportBatch, ImportDraft } from '@/composables/useQuestionBank'

const emit = defineEmits<{ (e: 'close'): void; (e: 'committed', n: number): void }>()

const batches = ref<ImportBatch[]>([])
const curBatch = ref('')
const drafts = ref<ImportDraft[]>([])
const picked = ref<string[]>([])
const selId = ref('')
const busy = ref(false)
const msg = ref('')

const sel = computed(() => drafts.value.find((d) => d.id === selId.value) || null)
const allPicked = computed(() => drafts.value.length > 0 && drafts.value.every((d) => picked.value.includes(d.id)))
/** 选中的里面有几条**够格**入库（其余是 needs_review，点了也白点，先提示 ✓） */
const readyCount = computed(() => drafts.value.filter((d) => picked.value.includes(d.id) && draftCanCommit(d.status)).length)

const form = ref({ stem: '', answer: '', section: '', qtype: '', kpText: '', paper: '' })

function flash(t: string, ms = 3200) {
  msg.value = t
  window.setTimeout(() => { if (msg.value === t) msg.value = '' }, ms)
}

function kpListOf(text: string): string[] {
  return Array.from(new Set(String(text || '').split(/[，,、;；]/).map((s) => s.trim()).filter(Boolean)))
}

async function loadBatches() {
  busy.value = true
  try {
    batches.value = await importBatches(80)
    if (!batches.value.length) { curBatch.value = ''; drafts.value = []; return }
    // 「刷新」要连当前批次的草稿一起刷（否则别处新增的草稿看不到 ✗）
    const still = batches.value.some((b) => b.id === curBatch.value)
    await openBatch(still ? curBatch.value : batches.value[0].id)
  } finally {
    busy.value = false
  }
}

async function openBatch(id: string) {
  curBatch.value = id
  picked.value = []
  selId.value = ''
  drafts.value = await importDrafts(id)
  if (drafts.value.length) select(drafts.value[0])
}

/** 重新拉当前批次。⚠ **默认保留勾选** —— 不然「全部确认 → 确认入库」中间一刷新就把勾选清了 ✗（v1449 踩过） */
function refresh(keepId = '', keepPicked = true) {
  const keep = picked.value.slice()
  return openBatch(curBatch.value).then(() => {
    if (keepPicked) picked.value = drafts.value.filter((d) => keep.includes(d.id)).map((d) => d.id)
    if (keepId) {
      const d = drafts.value.find((x) => x.id === keepId)
      if (d) select(d)
    }
  })
}

function select(d: ImportDraft) {
  selId.value = d.id
  form.value = {
    stem: d.stem,
    answer: d.answer,
    section: d.section,
    qtype: d.qtype,
    kpText: draftArr(d.knowledge).join('、'),
    paper: d.paper,
  }
}

function togglePick(d: ImportDraft) {
  picked.value = picked.value.includes(d.id) ? picked.value.filter((x) => x !== d.id) : [...picked.value, d.id]
}
function toggleAll() {
  picked.value = allPicked.value ? [] : drafts.value.map((d) => d.id)
}

function patchOf() {
  return {
    stem: form.value.stem,
    answer: form.value.answer,
    section: form.value.section,
    qtype: form.value.qtype,
    paper: form.value.paper,
    knowledge: kpListOf(form.value.kpText),
  }
}

/** 保存草稿**内容**（不动状态；状态要人显式「确认」才改 ✓） */
async function saveDraft() {
  const d = sel.value
  if (!d) return
  busy.value = true
  try {
    const r = await importDraftPatch([d.id], patchOf())
    if (!r.ok) { flash('✗ ' + (r.error || '保存失败')); return }
    flash('✓ 已保存草稿 ' + d.id)
    await refresh(d.id)
  } finally {
    busy.value = false
  }
}

/** 确认：改内容 + 置 approved（approved 是能入库的状态之一） */
async function approve(ids: string[], label: string) {
  if (!ids.length) { flash('先勾选或点开一条草稿'); return }
  busy.value = true
  try {
    const patch: Record<string, unknown> = { status: 'approved' }
    if (ids.length === 1 && sel.value && sel.value.id === ids[0]) Object.assign(patch, patchOf())
    const r = await importDraftPatch(ids, patch)
    if (!r.ok) { flash('✗ ' + (r.error || '确认失败')); return }
    flash('✓ 已确认 ' + r.updated + ' 条' + label)
    await refresh(selId.value)
  } finally {
    busy.value = false
  }
}

async function discardPicked() {
  const ids = picked.value.slice()
  if (!ids.length) { flash('先勾选要弃用的草稿'); return }
  if (!window.confirm('弃用选中的 ' + ids.length + ' 条草稿？它们**不会**进正式库（状态变 rejected，记录保留）')) return
  busy.value = true
  try {
    const r = await importDiscard(ids)
    if (!r.ok) { flash('✗ ' + (r.error || '弃用失败')); return }
    flash('✓ 已弃用 ' + r.rejected + ' 条')
    await refresh('', false)
  } finally {
    busy.value = false
  }
}

/** 确认入库：只提交「够格」的那几条；Rust 侧仍会 fail-closed 兜底 ✓ */
async function commitPicked() {
  const ready = drafts.value.filter((d) => picked.value.includes(d.id) && draftCanCommit(d.status))
  if (!ready.length) {
    const total = picked.value.length
    flash(total ? '选中的 ' + total + ' 条都还没「确认」—— 先点「全部确认」' : '先勾选要入库的草稿')
    return
  }
  busy.value = true
  try {
    const r = await importCommit(ready.map((d) => d.id))
    if (!r.ok) {
      const blocked = r.blocked && r.blocked.length ? '（' + r.blocked.length + ' 条没确认）' : ''
      flash('✗ ' + (r.error || '入库失败') + blocked)
      await refresh()
      return
    }
    flash('✓ 已入库 ' + r.created + ' 道到正式题库')
    emit('committed', r.created)
    await refresh()
  } finally {
    busy.value = false
  }
}

/** 从识别历史重建：只复制草稿，**不重调 OCR / LLM** ✓ */
async function rebuildCurrent() {
  if (!curBatch.value) return
  busy.value = true
  try {
    const r = await importRebuild(curBatch.value)
    if (!r.ok) { flash('✗ ' + (r.error || '重建失败')); return }
    flash('✓ 已重建 ' + r.copied + ' 条草稿（OCR 调用 ' + r.ocrCalls + ' 次）')
    await loadBatches()
    await openBatch(r.batch)
  } finally {
    busy.value = false
  }
}

onMounted(loadBatches)
</script>

<template>
  <div class="dbx" @click.self="emit('close')">
    <div class="dbx__box">
      <header class="dbx__head">
        <span class="dbx__title">草稿箱</span>
        <span class="dbx__sub">AI / OCR 的输出先落这里 —— 确认后才进正式库</span>
        <span v-if="msg" class="dbx__msg">{{ msg }}</span>
        <span class="dbx__headrt">
          <button class="dbx__btn" :disabled="busy" @click="loadBatches">刷新</button>
          <button class="dbx__close" title="关闭 (Esc)" @click="emit('close')"><AppIcon name="close" :size="13" /></button>
        </span>
      </header>

      <div class="dbx__body">
        <aside class="dbx__batches">
          <div class="dbx__t1">批次 / 识别历史</div>
          <div v-if="!batches.length" class="dbx__hint">还没有导入批次 —— 到「录入试题」里点「先存草稿」就会长出来 ✓</div>
          <button
            v-for="b in batches" :key="b.id" class="dbx__b"
            :class="{ 'dbx__b--on': b.id === curBatch }" @click="openBatch(b.id)"
          >
            <span class="dbx__bl">{{ b.sourceLabel || b.sourceType || b.id }}</span>
            <span class="dbx__bm">
              <span class="dbx__chip" :class="'dbx__chip--bs-' + b.status">{{ b.status }}</span>
              <span class="dbx__chip">{{ b.questionCount }} 道已入库</span>
              <span v-if="b.idemKey" class="dbx__chip dbx__chip--idem" :title="'幂等键：' + b.idemKey">幂等</span>
            </span>
          </button>
        </aside>

        <main class="dbx__list">
          <div class="dbx__listbar">
            <label class="dbx__chk"><input type="checkbox" :checked="allPicked" @change="toggleAll" />全选（{{ drafts.length }}）</label>
            <span v-if="picked.length" class="dbx__hint2">已勾 {{ picked.length }} 条 · 其中够格入库 {{ readyCount }} 条</span>
          </div>
          <div v-if="!drafts.length" class="dbx__empty">这一批没有草稿</div>
          <div
            v-for="d in drafts" :key="d.id" class="dbx__card"
            :class="{ 'dbx__card--on': d.id === selId, 'dbx__card--pick': picked.includes(d.id) }" @click="select(d)"
          >
            <label class="dbx__pick" title="勾选（批量确认 / 弃用）" @click.stop>
              <input type="checkbox" :checked="picked.includes(d.id)" @change="togglePick(d)" />
            </label>
            <div class="dbx__chips">
              <span class="dbx__chip" :class="'dbx__chip--st-' + d.status">{{ draftStatusLabel(d.status) }}</span>
              <span v-if="d.page" class="dbx__chip">第 {{ d.page }} 页</span>
              <span v-if="d.confidence" class="dbx__chip">置信 {{ Math.round(Number(d.confidence) * 100) }}%</span>
              <span v-if="d.sourceItemId" class="dbx__chip">{{ d.sourceItemId }}</span>
            </div>
            <div class="dbx__stem">{{ draftExcerpt(d) }}</div>
            <div v-if="d.warn" class="dbx__warn">⚠ {{ d.warn }}</div>
          </div>
        </main>

        <aside class="dbx__view">
          <div v-if="!sel" class="dbx__empty">左边点一条草稿 → 这里看闸门告警、就地改，改好「确认这条」再入库</div>
          <template v-else>
            <div class="dbx__chips dbx__chips--top">
              <span class="dbx__chip">{{ sel.id }}</span>
              <span class="dbx__chip" :class="'dbx__chip--st-' + sel.status">{{ draftStatusLabel(sel.status) }}</span>
              <span v-if="sel.targetQid" class="dbx__chip dbx__chip--ok">已入库 #{{ sel.targetQid }}</span>
              <span v-if="sel.bbox" class="dbx__chip" :title="'原图坐标（MinerU 给的）：' + sel.bbox">有坐标</span>
            </div>
            <div v-if="sel.warn" class="dbx__warnbox">⚠ {{ sel.warn }}</div>
            <div class="dbx__form">
              <label class="dbx__full">题干
                <textarea v-model="form.stem" rows="4"></textarea>
              </label>
              <label class="dbx__full">答案
                <input v-model="form.answer" placeholder="原卷没有就留空 ✓（不要自己解题）" />
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
              <label class="dbx__full">试卷名 / 来源
                <input v-model="form.paper" />
              </label>
              <label class="dbx__full">知识点（逗号 / 顿号分隔）
                <input v-model="form.kpText" />
              </label>
              <div class="dbx__actions">
                <button class="dbx__btn" :disabled="busy" @click="saveDraft">保存草稿</button>
                <button class="dbx__btn dbx__btn--main" :disabled="busy" @click="approve([sel.id], '（当前这条）')">确认这条</button>
              </div>
              <div v-if="sel.rawText" class="dbx__raw">
                <div class="dbx__t1">版面解析原文（人工修的底稿）</div>
                <pre>{{ sel.rawText }}</pre>
              </div>
            </div>
          </template>
        </aside>
      </div>

      <footer class="dbx__foot">
        <span class="dbx__picked">已勾 {{ picked.length }} 条</span>
        <button class="dbx__btn" :disabled="busy || !picked.length" @click="approve(picked, '')">全部确认</button>
        <span class="dbx__sep"></span>
        <button class="dbx__btn dbx__btn--main" :disabled="busy || !picked.length" title="只提交「已确认」的草稿；Rust 侧 fail-closed 兜底" @click="commitPicked">确认入库 {{ readyCount }} 条</button>
        <button class="dbx__btn dbx__btn--danger" :disabled="busy || !picked.length" @click="discardPicked">弃用</button>
        <span class="dbx__sep"></span>
        <button class="dbx__btn" :disabled="busy || !curBatch" title="从识别历史重建这批草稿：只复制草稿，不重调 OCR / LLM" @click="rebuildCurrent">从历史重建</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
/* ★ v1616：与 QuestionImportDialog 同一个坑 —— 草稿箱也是题库浮窗 .qb 的**直接子元素**（QuestionBankPanel.vue:1201 ✗），
   会继承 .qb 的 `pointer-events: none`（v1472 为"不挡画布"加的 ✗）→ 整个窗口点不动 ✗。模态窗明确写回 auto ✓。 */
.dbx { pointer-events: auto; position: fixed; inset: 0; z-index: 420; background: rgba(20, 24, 34, 0.55); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; }
.dbx__box { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: 96vw; max-width: 1320px; height: 88vh; display: flex; flex-direction: column; overflow: hidden; }
.dbx__head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.dbx__title { font-size: 15px; font-weight: 700; color: var(--text); }
.dbx__sub { font-size: 12px; color: var(--muted); }
.dbx__msg { font-size: 12px; color: var(--brand-600, #534AB7); }
.dbx__headrt { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.dbx__close { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; cursor: pointer; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--gray-600); }
.dbx__body { flex: 1; min-height: 0; display: grid; grid-template-columns: 250px 1fr 380px; }
.dbx__batches { border-right: 1px solid var(--border); overflow-y: auto; padding: 8px 6px; }
.dbx__t1 { font-size: 11px; font-weight: 700; color: var(--muted); padding: 8px 6px 4px; letter-spacing: .04em; }
.dbx__b { display: flex; flex-direction: column; gap: 3px; width: 100%; padding: 6px 8px; margin-bottom: 3px; border: 1px solid transparent; background: transparent; border-radius: 6px; text-align: left; cursor: pointer; }
.dbx__b:hover { background: var(--panel-2, #f4f3ef); }
.dbx__b--on { background: var(--brand-600, #534AB7); }
.dbx__b--on .dbx__bl, .dbx__b--on .dbx__bm { color: #fff; }
.dbx__b--on .dbx__chip { background: rgba(255, 255, 255, .22); color: #fff; }
.dbx__bl { font-size: 12.5px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dbx__bm { display: flex; flex-wrap: wrap; gap: 4px; }
.dbx__list { overflow-y: auto; padding: 8px; }
.dbx__listbar { display: flex; align-items: center; gap: 8px; padding: 2px 4px 8px; }
.dbx__card { position: relative; padding: 8px 32px 8px 10px; margin-bottom: 6px; border: 1px solid var(--border); border-radius: 8px; background: #fff; cursor: pointer; }
.dbx__card:hover { border-color: var(--border-strong); }
.dbx__card--on { border-color: var(--brand-600, #534AB7); box-shadow: 0 0 0 1px var(--brand-600, #534AB7) inset; }
.dbx__card--pick { background: #f6f4ff; }
.dbx__pick { position: absolute; top: 9px; right: 9px; display: inline-flex; }
.dbx__chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
.dbx__chips--top { margin: 0 0 6px; }
.dbx__chip { font-size: 10.5px; padding: 1px 6px; border-radius: 999px; background: var(--panel-2, #f4f3ef); color: var(--muted); white-space: nowrap; }
.dbx__chip--idem { background: #e8effa; color: #2a4f8f; }
.dbx__chip--ok { background: #e6f4ea; color: #1f6b3a; }
.dbx__chip--st-needs_review { background: #fdf3e3; color: #9a6212; }
.dbx__chip--st-ready, .dbx__chip--st-approved { background: #e8effa; color: #2a4f8f; }
.dbx__chip--st-published { background: #e6f4ea; color: #1f6b3a; }
.dbx__chip--st-rejected { background: #f6e7e6; color: #9a2b22; text-decoration: line-through; }
.dbx__chip--bs-running { background: #fdf3e3; color: #9a6212; }
.dbx__chip--bs-partial { background: #fdf3e3; color: #9a6212; }
.dbx__chip--bs-done { background: #e6f4ea; color: #1f6b3a; }
.dbx__chip--bs-failed { background: #f6e7e6; color: #9a2b22; }
.dbx__stem { font-size: 12.5px; color: var(--text); line-height: 1.55; }
.dbx__warn { margin-top: 4px; font-size: 11.5px; color: #a02016; line-height: 1.5; }
.dbx__warnbox { margin: 0 0 8px; padding: 6px 8px; border: 1px solid #f3d3ce; border-radius: 6px; background: #fdf3f2; color: #8f2a1b; font-size: 12px; line-height: 1.6; }
.dbx__view { border-left: 1px solid var(--border); overflow-y: auto; padding: 10px 12px; }
.dbx__form { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.dbx__form label { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; color: var(--muted); }
.dbx__full { grid-column: 1 / -1; }
.dbx__form input, .dbx__form select, .dbx__form textarea { height: 28px; padding: 0 6px; border: 1px solid var(--border); border-radius: 6px; font-size: 12.5px; background: #fff; color: var(--text); font-family: inherit; }
.dbx__form textarea { height: auto; padding: 5px 6px; line-height: 1.5; resize: vertical; }
.dbx__actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 6px; }
.dbx__raw { grid-column: 1 / -1; }
.dbx__raw pre { max-height: 140px; overflow: auto; margin: 0; padding: 6px; background: var(--panel-2, #faf9f6); border: 1px solid var(--border); border-radius: 6px; font-size: 11.5px; white-space: pre-wrap; }
.dbx__btn { height: 28px; padding: 0 10px; border: 1px solid var(--border); border-radius: 6px; background: #fff; font-size: 12.5px; cursor: pointer; color: var(--text); }
.dbx__btn--main { background: var(--brand-600, #534AB7); border-color: var(--brand-600, #534AB7); color: #fff; }
.dbx__btn:disabled { opacity: .6; cursor: default; }
.dbx__btn--danger { color: #b42318; border-color: #f0c9c4; }
.dbx__btn--danger:disabled { color: var(--muted); border-color: var(--border); }
.dbx__chk { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); white-space: nowrap; font-size: 12px; }
.dbx__empty { padding: 20px 10px; color: var(--muted); font-size: 12.5px; line-height: 1.7; }
.dbx__hint { padding: 4px 8px; font-size: 11.5px; color: var(--muted); line-height: 1.6; }
.dbx__hint2 { font-size: 11px; color: var(--brand-600, #534AB7); }
.dbx__picked { color: var(--muted); font-size: 12px; }
.dbx__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 9px 16px; border-top: 1px solid var(--border); background: var(--panel-2, #faf9f6); font-size: 12px; }
.dbx__sep { width: 1px; height: 18px; background: var(--border); }
</style>
