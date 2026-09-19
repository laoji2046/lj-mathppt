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
import { computed, defineAsyncComponent, nextTick, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { typesetMixed } from '@/composables/useMathJax'
import {
  SECTIONS, QTYPE_LABEL, LEVELS, STATUS_ORDER, statusLabel,
  qFacets, qSearch, qPatch, qBatch, metaOf, excerptOf, previewHtmlOf,
  questionTextOf, stripImageMarkers, pickImages, sourceReport, kpCatalog,
} from '@/composables/useQuestionBank'
import type { QFacets, QFilter, QItem, SourceReport } from '@/composables/useQuestionBank'

/** 试题录入（M4）：体量不小，按需加载 ✓ */
const QuestionImportDialog = defineAsyncComponent(() => import('./QuestionImportDialog.vue'))
/** 草稿箱（v5 · P1b）：AI / OCR 的产出先落这里，人工确认后才进正式库 ✓ */
const DraftBox = defineAsyncComponent(() => import('./DraftBox.vue'))
import { useDeckStore } from '@/stores/deck'
import { sendToPaper } from '@/ui/paper'
import type { SlideElement } from '@/types'

const emit = defineEmits<{ (e: 'close'): void }>()

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
  } finally {
    reportBusy.value = false
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

const f = ref<QFilter>({})
const sel = computed(() => items.value.find((x) => x.id === selId.value) || null)
const kpKeys = computed(() => Object.keys(facets.value.byKp || {}))
const yearKeys = computed(() => Object.keys(facets.value.byYear || {}).filter((k) => k !== '(空)'))

/** 就地表单（保存时按字段 patch 回 meta ✓） */
const form = ref({ section: '', qtype: '', level: '', year: 0, paperName: '', answer: '', kpText: '', status: '' })

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
    answer: String(m.answer || ''),
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
    await typesetMixed(host, previewHtmlOf(it))
  } catch {
    host.textContent = previewHtmlOf(it).replace(/<[^>]+>/g, ' ')
  }
}
watch(selId, () => { void nextTick(renderPreview) })

/** 知识点输入：中英文逗号/顿号/分号都当分隔符 ✓（老师怎么写都能拆对） */
function kpListOf(text: string): string[] {
  return Array.from(new Set(String(text || '').split(/[，,、;；]/).map((s) => s.trim()).filter(Boolean)))
}

async function save() {
  const it = sel.value
  if (!it) return
  busy.value = true
  try {
    const patch = {
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
    emit('close')
    flash('✓ 已插入 ' + list.length + ' 道到幻灯片'
      + (placed ? '，配图 ' + placed + ' 张' : '')
      + (missing ? '（有 ' + missing + ' 处图片标记未落地，需手动补图）' : ''))
  } finally {
    busy.value = false
  }
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
      const text = questionTextOf(it, withAnswer.value).trim()
      if (!text) continue
      parts.push(list.length > 1 ? no++ + '. ' + text : text)
      for (const im of await pickImages(it)) imgs.push({ n: im.n, src: im.src, caption: im.caption })
    }
    if (!parts.length) { flash('这几道题没有可插入的文字'); return }
    sendToPaper({ text: parts.join('\n\n'), id: list.length === 1 ? list[0].id : 0, label: '试题 ' + list.length + ' 道', imgs })
    flash('✓ 已加入试卷' + (imgs.length ? '（配图 ' + imgs.length + ' 张）' : '') + '，可继续选下一道')
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
  <div class="qb" @click.self="emit('close')">
    <div class="qb__box">
      <header class="qb__head">
        <span class="qb__title">试题库</span>
        <span class="qb__sub">共 {{ facets.total }} 道 · 当前筛出 {{ total }} 道</span>
        <span v-if="msg" class="qb__msg">{{ msg }}</span>
        <span class="qb__headrt">
          <button class="qb__btn" title="AI / OCR 的产出先落草稿，人工确认后才进正式库" @click="draftOpen = true">草稿箱</button>
          <button class="qb__btn" title="来源合规报告：多少题有来源 / 有多少已成模板 / 哪几道要处理" @click="openReport">来源报告</button>
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
              <span class="qb__chip qb__chip--code" :class="{ 'qb__chip--warn': !sel.code }">{{ sel.code || '无编号' }}</span>
              <span class="qb__chip qb__chip--st" :class="'qb__chip--st-' + (sel.status || 'none')">{{ statusLabel(sel.status) }}</span>
              <span class="qb__chip" :class="{ 'qb__chip--warn': !sel.paper }">{{ sel.paper || '来源未填' }}</span>
              <span v-if="sel.sourceKind" class="qb__chip qb__chip--src">{{ sel.sourceKind }}</span>
              <span class="qb__chip">{{ sel.difficulty ? '难度 ' + sel.difficulty : '难度未填' }}</span>
            </div>
            <div v-if="sel.warn" class="qb__warnbox">⚠ {{ sel.warn }}</div>
            <div ref="previewHost" class="qb__preview"></div>
            <div class="qb__form">
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
.qb { position: fixed; inset: 0; z-index: 400; background: rgba(20, 24, 34, 0.55); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; }
.qb__box { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: 96vw; max-width: 1280px; height: 88vh; display: flex; flex-direction: column; overflow: hidden; }
.qb__head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.qb__title { font-size: 15px; font-weight: 700; color: var(--text); }
.qb__sub { font-size: 12px; color: var(--muted); }
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
.qb__rpttitle { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>