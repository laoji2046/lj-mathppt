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
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { typesetMixed } from '@/composables/useMathJax'
import {
  SECTIONS, QTYPE_LABEL, LEVELS,
  qFacets, qSearch, qPatch, metaOf, excerptOf, previewHtmlOf,
} from '@/composables/useQuestionBank'
import type { QFacets, QFilter, QItem } from '@/composables/useQuestionBank'

const emit = defineEmits<{ (e: 'close'): void }>()

const facets = ref<QFacets>({ total: 0, bySection: {}, byQtype: {}, byLevel: {}, byYear: {}, byPaper: {}, byKp: {}, missing: { section: 0, answer: 0, kp: 0, year: 0, paper: 0 } })
const items = ref<QItem[]>([])
const total = ref(0)
const selId = ref(0)
const busy = ref(false)
const msg = ref('')
const previewHost = ref<HTMLElement | null>(null)

const f = ref<QFilter>({})
const sel = computed(() => items.value.find((x) => x.id === selId.value) || null)
const kpKeys = computed(() => Object.keys(facets.value.byKp || {}))
const yearKeys = computed(() => Object.keys(facets.value.byYear || {}).filter((k) => k !== '(空)'))

/** 就地表单（保存时按字段 patch 回 meta ✓） */
const form = ref({ section: '', qtype: '', level: '', year: 0, paperName: '', answer: '', kpText: '' })

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
onMounted(reload)

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
</script>

<template>
  <div class="qb" @click.self="emit('close')">
    <div class="qb__box">
      <header class="qb__head">
        <span class="qb__title">试题库</span>
        <span class="qb__sub">共 {{ facets.total }} 道 · 当前筛出 {{ total }} 道</span>
        <span v-if="msg" class="qb__msg">{{ msg }}</span>
        <button class="qb__close" title="关闭 (Esc)" @click="emit('close')"><AppIcon name="close" :size="13" /></button>
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
          <button
            v-for="it in items" :key="it.id" class="qb__card"
            :class="{ 'qb__card--on': it.id === selId }" @click="select(it)"
          >
            <div class="qb__chips">
              <span class="qb__chip" :class="{ 'qb__chip--warn': !it.section }">{{ it.section || '未归类' }}</span>
              <span class="qb__chip">{{ QTYPE_LABEL[it.qtype] || '未判题型' }}</span>
              <span v-if="it.level" class="qb__chip">{{ it.level }}</span>
              <span class="qb__chip" :class="{ 'qb__chip--warn': !it.year }">{{ it.year ? it.year + ' 年' : '无年份' }}</span>
              <span v-if="!metaOf(it).answer" class="qb__chip qb__chip--warn">缺答案</span>
            </div>
            <div class="qb__stem">{{ excerptOf(it.body || it.title) }}</div>
            <div v-if="it.kp.length" class="qb__kps">{{ it.kp.join(' · ') }}</div>
          </button>
        </main>

        <aside class="qb__view">
          <div v-if="!sel" class="qb__empty">左边点一道题 → 这里看题干 / 选项 / 答案，并能就地补全</div>
          <template v-else>
            <div class="qb__chips qb__chips--top">
              <span class="qb__chip">#{{ sel.id }}</span>
              <span class="qb__chip" :class="{ 'qb__chip--warn': !sel.paper }">{{ sel.paper || '来源未填' }}</span>
              <span class="qb__chip">{{ sel.difficulty ? '难度 ' + sel.difficulty : '难度未填' }}</span>
            </div>
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
              <label class="qb__full">试卷名 / 来源
                <input v-model="form.paperName" placeholder="例如：2026届高三年级数学学科试卷" />
              </label>
              <label class="qb__full">答案
                <textarea v-model="form.answer" rows="2" placeholder="原卷没有就留空 ✓（不要自己解题）"></textarea>
              </label>
              <label class="qb__full">知识点（逗号/顿号分隔）
                <input v-model="form.kpText" placeholder="例如：导数、单调性" />
              </label>
              <div class="qb__actions">
                <button class="qb__btn qb__btn--main" :disabled="busy" @click="save">保存这一道</button>
              </div>
            </div>
          </template>
        </aside>
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
.qb__close { margin-left: auto; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; cursor: pointer; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--gray-600); }
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
</style>
