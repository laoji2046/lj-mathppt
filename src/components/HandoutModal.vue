<script setup lang="ts">
/**
 * 【M1】数学讲义编辑器（M1.1：教材定位 + 目录树 + 公式渲染修复）
 *
 * 版式：左「目录树 + 块列表」· 中「A4 纸预览」· 右「教材定位 + 讲义信息 + 块属性」
 * 顶部：**学生版 ⇄ 教师版** 一键切换 ✓ + 打印/导出 PDF ✓
 *
 * ⚠ 页面 DOM **不归 Vue 管** ✗：内容整块写成 HTML 字符串交给 typesetMixed ✓
 *   （MathJax 会改写 DOM；Vue 与它抢同一棵树时，新加的块公式不渲染、点一下才渲染 ✗ —— 老师实测 ✓）
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { typesetMixed } from '@/composables/useMathJax'
import {
  HD_BOOKS, HD_LABEL, HD_NUMBERED, HD_PRESSES, handout, hdVersion, makeBlock, outlineOf, pageHtmlOf,
  rendered, saveHandout, setHandout, handoutToText, handoutPathOf, syncAutoTitle, autoTitleOf,
  initHandoutLib, openHandout, newHandout, deleteHandout, handoutTree, lib, curId,
} from '@/composables/useHandout'
import { loadAssets, assetSrc, saveAsset } from '@/composables/useAssets'
/* 【M2.6】把「数学图形」打通进讲义 ✓ —— 与题库那双按钮同一套（v1466 ✓）：面板 sink 给 SVG → svgToPngUrl → 入库 */
import { openFigPalette } from '@/ui/figPalette'
import { geom3dOpen, geom3dSink, openGeom3D } from '@/ui/geom3d'
import { svgTextToPngUrl, svgToPngUrl } from '@/composables/svgPng'
import type { HdBlock, HdBlockType, HdRender } from '@/composables/useHandout'
import { qFacets } from '@/composables/useQuestionBank'
import type { QItem } from '@/composables/useQuestionBank'
import { blocksFromQuestion, drawQuestions, kbBlockOf, loadKb, refreshRefBlocks, saveKbCustom, stemTextOf } from '@/composables/useHandoutLibrary'
import type { KbItem } from '@/composables/useHandoutLibrary'

const emit = defineEmits<{ (e: 'close'): void }>()

const h = handout
const ver = hdVersion
const selIdx = ref(0)
const msg = ref('')
const pageHost = ref<HTMLElement | null>(null)
const outline = computed(() => outlineOf(h.value))
const path = computed(() => handoutPathOf(h.value))

const ADD: { t: HdBlockType; label: string }[] = [
  { t: 'h1', label: '章' }, { t: 'h2', label: '节' }, { t: 'para', label: '正文' }, { t: 'formula', label: '公式' },
  { t: 'goal', label: '目标' }, { t: 'knowledge', label: '知识' }, { t: 'example', label: '例题' }, { t: 'variant', label: '变式' },
  { t: 'exercise', label: '练习' }, { t: 'answer', label: '答案' }, { t: 'solution', label: '解析' },
  { t: 'summary', label: '小结' }, { t: 'note', label: '提示' }, { t: 'warn', label: '警示' },
  { t: 'figure', label: '插图' }, { t: 'blank', label: '留白' }, { t: 'pagebreak', label: '分页' },
]
const RENDER_LABEL: Record<HdRender, string> = { inline: '正常显示', hide: '不显示', blank: '留白', endnote: '排到文末' }

const sel = computed<HdBlock | null>(() => h.value.blocks[selIdx.value] || null)

function flash(t: string) { msg.value = t; window.setTimeout(() => { if (msg.value === t) msg.value = '' }, 2600) }

/* ---------------- 【M2】题库打通 + 知识底座 ---------------- */
const drawer = ref<'' | 'pick' | 'draw' | 'kb' | 'lib'>('')
/* ---------------- 【M2.5】讲义库（目录树）+ 插图 ---------------- */
const tree = computed(() => handoutTree())
/** 页面里的图：块 id → data URL ✓（大图走内容库 assetId，渲染前 hydrate 回来 ✓） */
const imgMap = ref<Record<string, string>>({})
async function buildImgMap() {
  const ids: number[] = []
  for (const b of h.value.blocks) if (b.img?.assetId) ids.push(Number(b.img.assetId))
  if (ids.length) { try { await loadAssets(ids) } catch { /* 取不到就空着 ✓ */ } }
  const map: Record<string, string> = {}
  for (const b of h.value.blocks) {
    const src = b.img?.src || (b.img?.assetId ? assetSrc(Number(b.img.assetId)) : '')
    if (src) map[b.id] = src
  }
  imgMap.value = map
}
/** 插图：文件 → data URL → 大图进内容库 ✓（与题库同一套，省 localStorage ✓） */
const MAX_INLINE = 150 * 1024

/** 把一张图挂到**当前块**上（自动把块变成 figure ✓）；大图进内容库 ✓ —— 上传 / 数学图形 / 三维图 共用这一条 ✓ */
async function applyFigureSrc(src: string, caption = '') {
  const b = h.value.blocks[selIdx.value]
  if (!b || !src) return
  b.type = 'figure'
  const cap = caption || String(b.img?.caption || '')
  if (src.length > MAX_INLINE) {
    const id = await saveAsset(src)
    b.img = id ? { assetId: id, caption: cap } : { src, caption: cap }
  } else {
    b.img = { src, caption: cap }
  }
  await buildImgMap()
  void nextTick(() => refreshNow())
}
/** 【M2.6】数学图形：打开图形面板，点哪张哪张就进讲义 ✓（面板的 sink 模式 ✓） */
function insertMathFigure() {
  if (!sel.value) { flash('先选一块（或先 +插图）✓'); return }
  if (sel.value.type !== 'figure') { sel.value.type = 'figure'; flash('已把这页改成「插图」块 ✓') }
  openFigPalette((svg, label) => {
    void (async () => {
      try { await applyFigureSrc(await svgToPngUrl(svg), label || ''); flash('已插入数学图形「' + (label || '') + '」✓') }
      catch (e) { flash('✗ 图形转图片失败：' + String((e as Error)?.message || e)) }
    })()
  })
  flash('在图形面板里点一张 → 它就进讲义 ✓')
}
/** 【M2.6】三维立体图：同样走 sink ✓ */
function insert3DFigure() {
  if (!sel.value) { flash('先选一块（或先 +插图）✓'); return }
  if (sel.value.type !== 'figure') { sel.value.type = 'figure' }
  geom3dSink.value = (svgText: string, label: string) => {
    geom3dSink.value = null
    void (async () => {
      try { await applyFigureSrc(await svgTextToPngUrl(svgText), label || '三维图'); flash('已插入三维图 ✓') }
      catch (e) { flash('✗ 三维图转图片失败：' + String((e as Error)?.message || e)) }
    })()
  }
  openGeom3D()
  if (!geom3dOpen.value) { geom3dSink.value = null; flash('三维立体图已在「功能管理」里关掉 ✓') } else flash('在三维窗口里调好 → 点「插入到当前页」就落到讲义 ✓')
}
async function pickFigure(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files && input.files[0]
  input.value = ''
  if (!f || !h.value.blocks[selIdx.value]) return
  if (f.type.indexOf('image/') !== 0) { flash('只收图片（png / jpg / webp / gif / svg）'); return }
  if (f.size > 8 * 1024 * 1024) { flash('这张太大（' + Math.round(f.size / 1024) + 'KB > 8MB），先压一下再传'); return }
  const src = await new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result || ''))
    r.onerror = () => rej(new Error('读文件失败'))
    r.readAsDataURL(f)
  })
  await applyFigureSrc(src, String(h.value.blocks[selIdx.value].img?.caption || ''))
  flash('已插图' + (h.value.blocks[selIdx.value].img?.assetId ? '（大图存进内容库 ✓）' : '') + ' —— 图注可在这里改 ✓')
}
function setFigCaption(v: string) {
  const b = sel.value
  if (!b) return
  b.img = { ...(b.img || {}), caption: v }
  void nextTick(() => refreshNow())
}
function setFigLayout(v: string) {
  const b = sel.value
  if (!b) return
  b.img = { ...(b.img || {}), layout: v as 'center' | 'left' | 'right' | 'float-left' | 'float-right' }
  if (v.indexOf('float') === 0 && !Number(b.img.width)) b.img = { ...b.img, width: 45 }
  void nextTick(() => refreshNow())
}
/** 【M2.8】宽度：打字时**只记草稿、不夹值** ✗ —— 以前 @input 里立刻 Math.max(10,…) ✓，
 *  打「4」就被夹成 10 ✓，于是"只能输入 10 和 100，其他得靠上下箭头"✗（老师实测 ✓）。改：@input 记草稿、@change 才落库 ✓ */
const wDraft = ref('')
watch(() => sel.value?.id, () => { wDraft.value = sel.value?.img?.width ? String(sel.value.img.width) : '' }, { immediate: true })
function onWidthInput(v: string) { wDraft.value = String(v).replace(/[^0-9]/g, '').slice(0, 3) }
function commitWidth() {
  const b = sel.value
  if (!b) return
  const raw = wDraft.value.trim()
  if (!raw) { b.img = { ...(b.img || {}), width: undefined }; wDraft.value = ''; void nextTick(() => refreshNow()); return }
  const n = Math.max(10, Math.min(100, Number(raw) || 0))
  b.img = { ...(b.img || {}), width: n }
  wDraft.value = String(n)
  void nextTick(() => refreshNow())
}
/** 【M2.8】「完成编辑」：把这一份**立刻落盘**并给个明确反馈 ✓（其实改动一直是即时自动保存的 ✓ 只是没有反馈 ✗） */
function finishFigure() {
  saveHandout(h.value)
  void refreshNow()
  flash('✓ 已保存（插图改动一直是即时生效、自动保存的 ✓）')
}
function clearFigure() {
  const b = sel.value
  if (!b) return
  delete b.img
  void nextTick(() => refreshNow())
  flash('已清掉这张插图 ✓')
}
/** 打开库里的另一份 ✓ */
function doOpen(id: string) {
  if (id === curId.value) return
  openHandout(id)
  selIdx.value = 0
  void buildImgMap().then(() => refreshNow())
  flash('已打开：' + (h.value.meta.title || '未命名讲义'))
}
function doNew() {
  newHandout()
  selIdx.value = 0
  imgMap.value = {}
  void refreshNow()
  flash('已新建一份讲义（沿用上次的教材定位 ✓）')
}
function doDelete(id: string) {
  const d = lib.value.find((x) => x.id === id)
  if (!d) return
  if (!window.confirm('删除讲义「' + (d.meta.title || '未命名讲义') + '」？（不可撤销 ✓）')) return
  deleteHandout(id)
  selIdx.value = 0
  void buildImgMap().then(() => refreshNow())
  flash('已删除 ✓')
}
const q = ref('')
const qList = ref<QItem[]>([])
const qTotal = ref(0)
const qBusy = ref(false)
const facets = ref<{ bySection: Record<string, number>; byKp: Record<string, number>; byLevel: Record<string, number> }>({ bySection: {}, byKp: {}, byLevel: {} })
/** 抽题条件 ✓ */
const draw = ref({ pool: 'example' as 'example' | 'exercise' | 'variant', section: '', level: '', n: 3 })
/** 知识底座 ✓ */
const kb = ref<KbItem[]>(loadKb())
const kbQ = ref('')
const customKb = ref<KbItem[]>([])

const kbFiltered = computed(() => {
  const k = kbQ.value.trim()
  const list = kb.value.filter((x) => !k || (x.title + x.text + x.book + x.chapter).indexOf(k) >= 0)
  // 按「册 + 章」聚一下 ✓（便于按教材找 ✓）
  return list.slice(0, 60)
})

/** 把几块插到「当前选中块」后面 ✓（与 +按钮同一套插入规则 ✓） */
function insertBlocks(list: HdBlock[], tip: string) {
  if (!list.length) return
  const at = Math.min(selIdx.value + 1, h.value.blocks.length)
  h.value.blocks.splice(at, 0, ...list)
  selIdx.value = at
  void nextTick(() => refreshNow())
  flash(tip)
}

async function loadQ() {
  qBusy.value = true
  try {
    const { qSearch } = await import('@/composables/useQuestionBank')
    const r = await qSearch({ q: q.value.trim(), limit: 30 })
    qList.value = r.items || []
    qTotal.value = r.total || 0
  } finally { qBusy.value = false }
}
/** 插一道（题干 → 解析 → 答案 ✓） */
function pickQuestion(it: QItem, kind: 'example' | 'exercise' | 'variant') {
  insertBlocks(blocksFromQuestion(it, kind, true, true), '已插入「' + (kind === 'example' ? '例题' : kind === 'exercise' ? '练习' : '变式') + '」（题干+解析+答案，答案默认排到学生版文末 ✓）')
}
/** 按规则抽 N 道 ✓ */
async function doDraw() {
  qBusy.value = true
  try {
    const f: Record<string, unknown> = {}
    if (draw.value.section) f.section = draw.value.section
    if (draw.value.level) f.level = draw.value.level
    const { items, total } = await drawQuestions(f, Number(draw.value.n) || 3)
    if (!items.length) { flash('这个条件下库里没有题 ✗（先去题库录几道 ✓）'); return }
    const out: HdBlock[] = []
    for (const it of items) out.push(...blocksFromQuestion(it, draw.value.pool, true, true))
    insertBlocks(out, '已抽题并插入 ' + items.length + ' 道（候选 ' + total + ' 道 ✓）')
  } finally { qBusy.value = false }
}
/** 插一条知识底座 ✓ */
function pickKb(item: KbItem) {
  insertBlocks([kbBlockOf(item)], '已插入「' + item.title + '」→ ' + (item.kind === 'knowledge' ? '知识梳理' : item.kind === 'note' ? '提示' : '易错警示') + '块 ✓')
}
/** 把当前块存进知识底座（自定义 ✓） */
function saveKbFromBlock() {
  const b = sel.value
  if (!b || !String(b.text || '').trim()) { flash('先选一块有内容的块 ✓'); return }
  const item: KbItem = {
    id: 'c' + Date.now().toString(36), book: h.value.meta.book, chapter: h.value.meta.chapter,
    kind: b.type === 'note' ? 'note' : b.type === 'warn' ? 'warn' : 'knowledge',
    title: (b.kbTitle || String(b.text).replace(/[s$]/g, '').slice(0, 10) || '自定义条目'), text: b.text, custom: true,
  }
  customKb.value = [...customKb.value, item]
  saveKbCustom(customKb.value)
  kb.value = loadKb()
  flash('已存进知识底座（自定义 ✓ 下次还能用 ✓）')
}
/** 【M2】按题库最新内容刷新引用的块 ✓ */
async function syncRefs() {
  const n = await refreshRefBlocks(h.value.blocks)
  void refreshNow()
  flash(n ? '已按题库刷新 ' + n + ' 块 ✓' : '引用的题没有变化 ✓')
}
async function openDrawer(which: 'pick' | 'draw' | 'kb' | 'lib') {
  drawer.value = drawer.value === which ? '' : which
  if (which === 'pick' && !qList.value.length) void loadQ()
  if (which === 'pick' && !Object.keys(facets.value.bySection).length) {
    const fc = await qFacets()
    facets.value = { bySection: fc.bySection || {}, byKp: fc.byKp || {}, byLevel: fc.byLevel || {} }
  }
}
onMounted(() => { try { customKb.value = loadKb().filter((x) => x.custom) } catch { /* 忽略 */ } })

/** 整块重写 A4 页 + 交给 MathJax 排版 ✓（内容一变就重排 → 「加完块公式就渲染」✓） */
let timer: number | undefined
async function refreshNow() {
  saveHandout(h.value)
  await nextTick()
  const host = pageHost.value
  if (!host) return
  try { await typesetMixed(host, pageHtmlOf(h.value, ver.value, imgMap.value)) } catch { /* 排版失败不影响用 ✓ */ }
}
function refresh() {
  if (timer) window.clearTimeout(timer)
  timer = window.setTimeout(() => { void refreshNow() }, 300)   // 打字时别每键都重排 ✓
}
/** 目录树点击 → 在 A4 里跳到那块 ✓（页面里的块带 id="hd-b-<bid>" ✓） */
function jumpTo(bid: string) {
  const el = pageHost.value?.querySelector('#hd-b-' + bid) as HTMLElement | null
  if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  const i = h.value.blocks.findIndex((b) => b.id === bid)
  if (i >= 0) selIdx.value = i
}

function addBlock(t: HdBlockType) {
  const b = makeBlock(t)
  const at = Math.min(selIdx.value + 1, h.value.blocks.length)
  h.value.blocks.splice(at, 0, b)
  selIdx.value = at
  void nextTick(() => refreshNow())
  flash('已插入「' + HD_LABEL[t] + '」' + (t === 'h1' || t === 'h2' ? ' —— 目录树里会出现 ✓' : ''))
}
function delBlock(i: number) {
  h.value.blocks.splice(i, 1)
  selIdx.value = Math.max(0, Math.min(selIdx.value, h.value.blocks.length - 1))
  void nextTick(() => refreshNow())
}
function move(i: number, d: number) {
  const j = i + d
  if (j < 0 || j >= h.value.blocks.length) return
  const [x] = h.value.blocks.splice(i, 1)
  h.value.blocks.splice(j, 0, x)
  selIdx.value = j
  void nextTick(() => refreshNow())
}
function summary(b: HdBlock): string {
  const t = String(b.text || '').replace(/\s+/g, ' ').trim()
  if (b.type === 'blank') return '留白 ' + (b.blankCm || 4) + 'cm'
  return t ? t.slice(0, 22) : '（空）'
}
function modeOf(b: HdBlock): string {
  const m = b.render[ver.value]
  return m === 'inline' ? '' : '·' + RENDER_LABEL[m]
}
function setVer(v: 'student' | 'teacher') { ver.value = v; void refreshNow() }
function printPdf() { window.print() }
function exportText() {
  const blob = new Blob([handoutToText(h.value, ver.value)], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = (h.value.meta.title || '讲义') + '-' + (ver.value === 'student' ? '学生版' : '教师版') + '.txt'
  a.click(); URL.revokeObjectURL(a.href)
  flash('已导出纯文本（' + (ver.value === 'student' ? '学生版' : '教师版') + '）')
}
function exportJson() {
  const blob = new Blob([JSON.stringify(h.value, null, 1)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = (h.value.meta.title || '讲义') + '.json'
  a.click(); URL.revokeObjectURL(a.href)
  flash('已导出讲义 JSON（可再导入 ✓）')
}
function importJson(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files && input.files[0]
  input.value = ''
  if (!f) return
  const r = new FileReader()
  r.onload = () => {
    try { setHandout(JSON.parse(String(r.result || ''))); selIdx.value = 0; void refreshNow(); flash('已导入讲义 ✓') }
    catch { flash('✗ 这个文件不是讲义 JSON') }
  }
  r.readAsText(f)
}
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }
onMounted(() => {
  document.addEventListener('keydown', onKey)
  initHandoutLib()                       // 【M2.5】载入讲义库（首次会把单份讲义迁进来 ✓）
  void buildImgMap().then(() => refreshNow())
})
onBeforeUnmount(() => { document.removeEventListener('keydown', onKey); if (timer) window.clearTimeout(timer) })
/** 【v1476】教材定位一变，标题跟着自动生成 ✓（自动标题关掉后就不再覆盖老师手写的 ✓） */
watch(() => [h.value.meta.press, h.value.meta.book, h.value.meta.chapter, h.value.meta.section, h.value.meta.period], () => {
  syncAutoTitle(h.value)
  void nextTick(() => refreshNow())
})
function regenTitle() { h.value.meta.autoTitle = true; syncAutoTitle(h.value); void refreshNow(); flash('标题已按教材重新生成 ✓') }
function onTitleInput() { h.value.meta.autoTitle = false; void refresh() }   // 手改标题 → 自动模式关掉 ✓

/** 内容一变就重排（深度监听 ✓）—— 加的块、改的公式都会立刻渲染 ✓ */
watch(() => h.value, () => refresh(), { deep: true })
watch(ver, () => { void refreshNow() })
</script>

<template>
  <Teleport to="body">
    <div class="hd">
      <div class="hd__box">
        <header class="hd__head">
          <span class="hd__title">数学讲义</span>
          <span class="hd__sub">{{ h.blocks.length }} 块 · {{ rendered.main.length }} 块在本版显示<template v-if="rendered.notes.length"> · {{ rendered.notes.length }} 条排到文末</template></span>
          <span v-if="msg" class="hd__msg">{{ msg }}</span>
          <span class="hd__rt">
            <button class="hd__btn" :class="{ 'hd__btn--on': ver === 'student' }" title="学生版：答案按各块设置隐藏 / 留白 / 排到文末" @click="setVer('student')">学生版</button>
            <button class="hd__btn" :class="{ 'hd__btn--on': ver === 'teacher' }" title="教师版：答案与解析内联显示" @click="setVer('teacher')">教师版</button>
            <!-- 【M2.5】讲义库（目录树）+ 新建 ✓ -->
            <button class="hd__btn" :class="{ 'hd__btn--on': drawer === 'lib' }" title="讲义库：按 册 → 章 → 节 → 课时 的目录树找以前保存过的讲义 ✓" @click="openDrawer('lib')">讲义库</button>
            <button class="hd__btn" title="新建一份讲义（沿用上次的教材定位 ✓）" @click="doNew">新建</button>
            <!-- 【M2】题库打通 + 知识底座 ✓ -->
            <button class="hd__btn" :class="{ 'hd__btn--on': drawer === 'pick' }" title="从题库插题：挑一道 → 例题/练习 + 解析 + 答案三块 ✓" @click="openDrawer('pick')">插题</button>
            <button class="hd__btn" :class="{ 'hd__btn--on': drawer === 'draw' }" title="按 册/章节/难度 抽 N 道，插成例题池或练习池 ✓" @click="openDrawer('draw')">抽题</button>
            <button class="hd__btn" :class="{ 'hd__btn--on': drawer === 'kb' }" title="知识底座：常用公式 / 模型 / 易错点，按教材存着，一键插成知识梳理块 ✓" @click="openDrawer('kb')">知识底座</button>
            <button class="hd__btn hd__btn--main" title="打印 / 另存为 PDF（矢量文字 ✓）" @click="printPdf">打印 / PDF</button>
            <button class="hd__btn" title="导出纯文本（当前版本）" @click="exportText">导出文本</button>
            <button class="hd__btn" title="导出讲义 JSON（可再导入 ✓）" @click="exportJson">导出 JSON</button>
            <label class="hd__btn" title="导入讲义 JSON">
              导入<input type="file" accept="application/json,.json" style="display:none" @change="importJson" />
            </label>
            <button class="hd__close" title="关闭 (Esc)" @click="emit('close')"><AppIcon name="close" :size="13" /></button>
          </span>
        </header>

        <div class="hd__body" :class="{ 'hd__body--drawer': !!drawer }">
          <aside class="hd__left">
            <div class="hd__toc">
              <div class="hd__t1">目录</div>
              <div class="hd__path" :title="path">{{ path || '（未填教材定位）' }}</div>
              <div v-if="!outline.length" class="hd__hint">加「+章 / +节」块，这里就长出目录 ✓</div>
              <template v-for="n in outline" :key="n.bid">
                <div class="hd__toc1" @click="jumpTo(n.bid)">{{ n.title }}</div>
                <div v-for="k in n.kids" :key="k.bid" class="hd__toc2" @click="jumpTo(k.bid)">{{ k.title }}</div>
              </template>
            </div>
            <div class="hd__add">
              <button v-for="a in ADD" :key="a.t" class="hd__addbtn" :title="'插入一块：' + HD_LABEL[a.t]" @click="addBlock(a.t)">+{{ a.label }}</button>
            </div>
            <div class="hd__list">
              <div
                v-for="(b, i) in h.blocks" :key="b.id" class="hd__blk"
                :class="{ 'hd__blk--on': i === selIdx }" @click="selIdx = i"
              >
                <span class="hd__badge" :class="'hd__badge--' + b.type">{{ HD_LABEL[b.type] }}</span>
                <span class="hd__sum">{{ summary(b) }}<em v-if="modeOf(b)" class="hd__mode">{{ modeOf(b) }}</em></span>
                <span class="hd__ops">
                  <button title="上移" @click.stop="move(i, -1)">↑</button>
                  <button title="下移" @click.stop="move(i, 1)">↓</button>
                  <button title="删除这块" @click.stop="delBlock(i)">✕</button>
                </span>
              </div>
              <div v-if="!h.blocks.length" class="hd__hint">点上面的「+知识 / +例题 …」开始写讲义 ✓</div>
            </div>
          </aside>

          <main class="hd__mid">
            <div ref="pageHost" class="hd__page"></div>
          </main>

          <aside class="hd__right">
            <div class="hd__t1">教材定位</div>
            <div class="hd__row2">
              <label>教材版本
                <select v-model="h.meta.press"><option v-for="p in HD_PRESSES" :key="p" :value="p">{{ p }}</option></select>
              </label>
              <label>模块 / 册
                <select v-model="h.meta.book"><option v-for="bk in HD_BOOKS" :key="bk" :value="bk">{{ bk }}</option></select>
              </label>
            </div>
            <div class="hd__row2">
              <label>第几章<input v-model="h.meta.chapter" placeholder="3" /></label>
              <label>第几节<input v-model="h.meta.section" placeholder="1" /></label>
            </div>
            <div class="hd__row2">
              <label>第几课时<input v-model="h.meta.period" placeholder="2" /></label>
              <label class="hd__chk hd__chk--t"><input v-model="h.meta.autoTitle" type="checkbox" @change="h.meta.autoTitle && regenTitle()" /> 标题自动生成</label>
            </div>
            <div class="hd__hint2">抬头显示：{{ path || '（未填）' }} ✓ 目录树按章 / 节块自动长 ✓</div>

            <div class="hd__t1">讲义信息</div>
            <label>标题
              <span class="hd__titleline">
                <input v-model="h.meta.title" :readonly="h.meta.autoTitle !== false" :title="h.meta.autoTitle !== false ? '按教材自动生成中（改这里会切成手动 ✓）' : '手动标题 ✓'" @input="onTitleInput" />
                <button class="hd__mini" title="按教材重新生成标题" @click="regenTitle">↻</button>
              </span>
            </label>
            <div v-if="h.meta.autoTitle !== false" class="hd__hint2">自动生成中：{{ autoTitleOf(h) || '（把教材定位填上就会生成 ✓）' }}</div>
            <label>副标题<input v-model="h.meta.subtitle" /></label>
            <div class="hd__row2">
              <label>学校<input v-model="h.meta.school" /></label>
              <label>科目<input v-model="h.meta.subject" /></label>
            </div>
            <div class="hd__row2">
              <label>年级<input v-model="h.meta.grade" /></label>
              <label>教师<input v-model="h.meta.teacher" /></label>
            </div>
            <label>日期<input v-model="h.meta.date" /></label>

            <div class="hd__t1">本块（{{ sel ? HD_LABEL[sel.type] : '未选中' }}）</div>
            <template v-if="sel">
              <!-- 【M2.5】插图块 ✓ -->
              <template v-if="sel.type === 'figure'">
                <div class="hd__figbox">
                  <img v-if="sel.img && (sel.img.src || (sel.img.assetId && imgMap[sel.id]))" :src="sel.img.src || imgMap[sel.id]" alt="插图" />
                  <div v-else class="hd__figempty">还没有图片</div>
                </div>
                <label class="hd__btn hd__btn--file" title="上传图片（png / jpg / webp / gif / svg；大图自动存进内容库 ✓）">
                  {{ sel.img ? '换一张图' : '上传图片' }}
                  <input type="file" accept="image/*" style="display:none" @change="pickFigure" />
                </label>
                <!-- 【M2.6】直接用我们的数学图形 / 三维图 ✓（与题库题图同一套 ✓） -->
                <div class="hd__figsrc">
                  <button class="hd__btn" title="打开「数学图形」面板：点哪张哪张就进讲义（函数图像 / 圆锥曲线 / 平面几何 / 立体几何 …）✓" @click="insertMathFigure">数学图形</button>
                  <button class="hd__btn" title="三维立体图：在三维窗口里调好后点「插入到当前页」即落到讲义 ✓" @click="insert3DFigure">三维图</button>
                </div>
                <label>图注<input :value="sel.img?.caption || ''" placeholder="例如：图 1 椭圆与两条切线" @input="setFigCaption(($event.target as HTMLInputElement).value)" /></label>
                <!-- 【M2.7】位置与宽度：与「PDF 生成」那套一致（居中/居左/居右/左浮/右浮 + 宽度% ✓） -->
                <div class="hd__row2">
                  <label>位置
                    <select :value="sel.img?.layout || 'center'" @change="setFigLayout(($event.target as HTMLSelectElement).value)">
                      <option value="center">居中</option>
                      <option value="left">居左</option>
                      <option value="right">居右</option>
                      <option value="float-left">左浮动（文字绕排）</option>
                      <option value="float-right">右浮动（文字绕排）</option>
                    </select>
                  </label>
                  <label>宽度 %
                    <input
                      :value="wDraft" type="text" inputmode="numeric" maxlength="3"
                      :placeholder="(sel.img?.layout || '').indexOf('float') === 0 ? '45（浮动默认）' : '留空 = 撑满版心'"
                      @input="onWidthInput(($event.target as HTMLInputElement).value)"
                      @change="commitWidth()" @keydown.enter="commitWidth()" @blur="commitWidth()"
                    />
                  </label>
                </div>
                <div class="hd__savebar">
                  <button class="hd__btn hd__btn--main" title="插图改动一直是即时生效、自动保存的 ✓ 点这里再确认一次" @click="finishFigure">✓ 完成编辑</button>
                  <span class="hd__hint2">边改边生效、自动保存 ✓（宽度打完按回车或点别处生效 ✓）</span>
                </div>
                <button v-if="sel.img" class="hd__btn hd__btn--wide" @click="clearFigure">清掉这张插图</button>
                <div class="hd__hint2">插图会跟着两个版本一起显示 ✓；大图存进内容库（与题库同一套 ✓），讲义 JSON 不会变胖 ✓</div>
              </template>
              <label v-else-if="sel.type !== 'pagebreak' && sel.type !== 'blank'">内容<textarea v-model="sel.text" rows="7" placeholder="支持 $…$ 公式；换行直接回车 ✓"></textarea></label>
              <label v-if="sel.type === 'blank'">留白高度（cm）<input v-model.number="sel.blankCm" type="number" min="1" max="20" step="0.5" /></label>
              <label v-if="HD_NUMBERED.includes(sel.type)" class="hd__chk"><input v-model="sel.number" type="checkbox" /> 自动编号</label>
              <div class="hd__rnd">
                <div class="hd__rndrow"><span>学生版</span>
                  <select v-model="sel.render.student"><option v-for="(l, k) in RENDER_LABEL" :key="k" :value="k">{{ l }}</option></select>
                </div>
                <div class="hd__rndrow"><span>教师版</span>
                  <select v-model="sel.render.teacher"><option v-for="(l, k) in RENDER_LABEL" :key="k" :value="k">{{ l }}</option></select>
                </div>
                <div class="hd__hint2">答案 / 解析默认「学生版排到文末、教师版内联」✓</div>
              </div>
            </template>
            <div v-else class="hd__hint">在左边点一块，这里就能改它 ✓</div>
          </aside>
          <!-- 【M2】抽屉：插题 / 抽题 / 知识底座 ✓（在 .hd__body 里当第 4 列 ✓ 不覆盖 A4 ✓） -->
        <div v-if="drawer" class="hd__drawer">
          <div class="hd__dhead">
            <b>{{ drawer === 'pick' ? '从题库插题' : drawer === 'draw' ? '按规则抽题' : '知识底座' }}</b>
            <button class="hd__mini" title="关闭" @click="drawer = ''">✕</button>
          </div>

          <template v-if="drawer === 'lib'">
            <div class="hd__dhint">当前：<b>{{ h.meta.title || '未命名讲义' }}</b>（{{ curId ? curId.slice(0, 6) : '—' }}）· 共 {{ lib.length }} 份</div>
            <div class="hd__dlist">
              <template v-for="bk in tree" :key="bk.key">
                <div class="hd__lb1">{{ bk.label }}</div>
                <template v-for="ch in bk.kids" :key="ch.key">
                  <div class="hd__lb2">{{ ch.label }}</div>
                  <template v-for="se in ch.kids" :key="se.key">
                    <div class="hd__lb3">{{ se.label }}</div>
                    <div
                      v-for="d in se.docs" :key="d.id" class="hd__ldoc"
                      :class="{ 'hd__ldoc--on': d.id === curId }" @click="doOpen(d.id)"
                    >
                      <span class="hd__ldocname">{{ d.meta.period ? '第 ' + d.meta.period + ' 课时' : '（未填课时）' }} · {{ d.meta.title || '未命名讲义' }}</span>
                      <span class="hd__ldocdel" title="删除这份讲义" @click.stop="doDelete(d.id)">✕</span>
                    </div>
                  </template>
                </template>
              </template>
            </div>
            <div class="hd__dhint">点一条即打开 ✓（会自动把当前这份存好 ✓）；课时、章、节在右边「教材定位」里填 ✓</div>
          </template>

          <template v-else-if="drawer === 'pick'">
            <div class="hd__drow">
              <input v-model="q" class="hd__dinput" placeholder="搜题干 / 标题…（回车）" @keydown.enter="loadQ" />
              <button class="hd__mini hd__mini--w" :disabled="qBusy" @click="loadQ">搜</button>
            </div>
            <div class="hd__dhint">库里有 {{ qTotal }} 道匹配<template v-if="qList.length"> · 显示前 {{ qList.length }} 道</template></div>
            <div class="hd__dlist">
              <div v-for="it in qList" :key="it.id" class="hd__ditem">
                <div class="hd__dtitle">{{ it.code || ('#' + it.id) }} · {{ it.section || '未归类' }} · {{ it.level || '未填' }}<span v-if="it.kp && it.kp.length"> · {{ it.kp.join('/') }}</span></div>
                <div class="hd__dstem">{{ stemTextOf(it).slice(0, 70) }}</div>
                <div class="hd__dbtns">
                  <button @click="pickQuestion(it, 'example')">插为例题</button>
                  <button @click="pickQuestion(it, 'exercise')">插为练习</button>
                  <button @click="pickQuestion(it, 'variant')">插为变式</button>
                </div>
              </div>
              <div v-if="!qList.length" class="hd__dhint">{{ qBusy ? '查询中…' : '点「搜」或直接回车看看题库里有什么 ✓' }}</div>
            </div>
          </template>

          <template v-else-if="drawer === 'draw'">
            <div class="hd__drow"><span class="hd__dlab">池子</span>
              <select v-model="draw.pool"><option value="example">例题</option><option value="exercise">练习</option><option value="variant">变式</option></select>
            </div>
            <div class="hd__drow"><span class="hd__dlab">章节</span>
              <select v-model="draw.section"><option value="">全部</option><option v-for="(c, s) in facets.bySection" :key="s" :value="s">{{ s }}（{{ c }}）</option></select>
            </div>
            <div class="hd__drow"><span class="hd__dlab">难度</span>
              <select v-model="draw.level"><option value="">全部</option><option v-for="(c, s) in facets.byLevel" :key="s" :value="s">{{ s }}（{{ c }}）</option></select>
            </div>
            <div class="hd__drow"><span class="hd__dlab">数量</span>
              <input v-model.number="draw.n" type="number" min="1" max="20" class="hd__dnum" />
            </div>
            <button class="hd__dgo" :disabled="qBusy" @click="doDraw">{{ qBusy ? '抽题中…' : '抽题并插入 ✓' }}</button>
            <div class="hd__dhint">抽题是**洗牌后随机**取 ✓ 每次不一样；插进来的是「题干 + 解析 + 答案」三块一组 ✓</div>
          </template>

          <template v-else>
            <div class="hd__drow">
              <input v-model="kbQ" class="hd__dinput" placeholder="搜公式 / 模型 / 易错点…" />
              <button class="hd__mini hd__mini--w" title="把当前选中的块存进知识底座（自定义 ✓）" @click="saveKbFromBlock">+存</button>
            </div>
            <div class="hd__dlist">
              <div v-for="item in kbFiltered" :key="item.id" class="hd__ditem hd__ditem--kb" @click="pickKb(item)">
                <div class="hd__dtitle">{{ item.book }}<template v-if="item.chapter"> 第 {{ item.chapter }} 章</template> · {{ item.kind === 'knowledge' ? '知识' : item.kind === 'note' ? '提示' : '易错' }}<span v-if="item.custom"> · 自定义</span></div>
                <div class="hd__dstem"><b>{{ item.title }}</b> —— {{ item.text.replace(/\$/g, '').slice(0, 46) }}</div>
              </div>
              <div v-if="!kbFiltered.length" class="hd__dhint">没搜到 ✓ 换个词，或把讲义里的块「+存」进去 ✓</div>
            </div>
          </template>
        </div>
        </div>

        <footer class="hd__foot">
          <button class="hd__btn" title="把引用了题库的块按库里最新内容刷新（题改过之后点一下 ✓）" @click="syncRefs">↻ 同步题库</button>
          <span class="hd__dhint">题目是**引用**（块上显示 题 #id ✓），改题不必重插 ✓</span>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 【M2.7】z-index 从 2600 降到 **2100** ✓ —— 2600 会把**从讲义里打开的**图形面板(2200)/三维窗口(3200) 盖住 ✗
   （老师实测：图形弹窗被讲义遮挡 ✓）。现在：**高于试卷(2000)** ✓、**低于图形面板(2200)与三维(3200)** ✓ */
.hd { position: fixed; inset: 0; z-index: 2100; background: rgba(20, 24, 34, 0.45); display: flex; align-items: center; justify-content: center; }
.hd__box { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: 97vw; max-width: 1500px; height: 92vh; display: flex; flex-direction: column; overflow: hidden; }
.hd__head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--border); }
.hd__title { font-size: 15px; font-weight: 700; }
.hd__sub, .hd__hint, .hd__hint2 { font-size: 11.5px; color: var(--muted); }
.hd__msg { font-size: 12px; color: var(--brand-600, #534AB7); }
.hd__rt { margin-left: auto; display: flex; align-items: center; gap: 6px; }
.hd__btn { height: 28px; padding: 0 10px; border: 1px solid var(--border); border-radius: 6px; background: #fff; font-size: 12.5px; color: var(--text); cursor: pointer; }
.hd__btn--on { background: var(--brand-600, #534AB7); border-color: var(--brand-600, #534AB7); color: #fff; }
.hd__btn--main { background: #1f6b3a; border-color: #1f6b3a; color: #fff; }
.hd__close { width: 28px; height: 28px; border: 1px solid var(--border); border-radius: 6px; background: #fff; cursor: pointer; }
.hd__body { flex: 1; min-height: 0; display: grid; grid-template-columns: 260px 1fr 300px; }
/* 【v1478】抽屉打开时**多占一列** ✓ —— 以前是绝对定位浮在上面，把 A4 盖住 ✗（老师截图反馈 ✓） */
.hd__body--drawer { grid-template-columns: 260px 1fr 300px 340px; }
.hd__left { border-right: 1px solid var(--border); display: flex; flex-direction: column; min-height: 0; }
.hd__toc { border-bottom: 1px solid var(--border); padding: 8px; max-height: 32%; overflow-y: auto; }
.hd__path { font-size: 11px; color: var(--brand-600, #534AB7); margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hd__toc1 { font-size: 12px; font-weight: 700; padding: 2px 4px; border-radius: 4px; cursor: pointer; }
.hd__toc2 { font-size: 11.5px; color: var(--muted); padding: 1px 4px 1px 18px; border-radius: 4px; cursor: pointer; }
.hd__toc1:hover, .hd__toc2:hover { background: var(--brand-soft, #f2f0fb); }
.hd__add { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px; border-bottom: 1px solid var(--border); }
.hd__addbtn { height: 24px; padding: 0 7px; border: 1px solid var(--border); border-radius: 6px; background: #fff; font-size: 11.5px; cursor: pointer; }
.hd__addbtn:hover { background: var(--brand-soft, #f2f0fb); border-color: var(--brand-400, #b9b2ec); }
.hd__list { flex: 1; overflow-y: auto; padding: 8px; }
.hd__blk { display: flex; align-items: baseline; gap: 6px; padding: 5px 6px; border: 1px solid transparent; border-radius: 6px; cursor: pointer; font-size: 12px; }
.hd__blk:hover { background: var(--panel-2, #f6f5f1); }
.hd__blk--on { background: #f2f0fb; border-color: var(--brand-400, #b9b2ec); }
.hd__badge { flex: none; font-size: 10.5px; padding: 1px 5px; border-radius: 4px; background: #eef1f6; color: #3a4252; }
.hd__badge--knowledge { background: #eaf3ec; color: #2f6b45; }
.hd__badge--example { background: #eef4ff; color: #1d4e89; }
.hd__badge--answer, .hd__badge--solution { background: #fdf3e3; color: #9a6212; }
.hd__badge--blank { background: #f1f1f1; color: #6b6b6b; }
.hd__sum { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.hd__mode { font-style: normal; color: #9a6212; margin-left: 4px; }
.hd__ops { flex: none; display: none; gap: 2px; }
.hd__blk:hover .hd__ops { display: inline-flex; }
.hd__ops button { width: 18px; height: 18px; border: 1px solid var(--border); border-radius: 4px; background: #fff; font-size: 10px; cursor: pointer; }
.hd__mid { overflow: auto; background: #f2f1ec; padding: 14px; }
.hd__right { border-left: 1px solid var(--border); overflow-y: auto; padding: 10px; }
.hd__t1 { font-size: 12px; font-weight: 700; color: var(--text); margin: 8px 0 6px; }
.hd__right label { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; color: var(--muted); margin-bottom: 6px; }
.hd__right input, .hd__right select, .hd__right textarea { padding: 5px 6px; border: 1px solid var(--border); border-radius: 6px; font-size: 12.5px; font-family: inherit; color: var(--text); background: #fff; }
.hd__row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.hd__chk { flex-direction: row; align-items: center; gap: 6px; }
.hd__chk--t { justify-content: flex-start; padding-top: 14px; }
.hd__titleline { display: flex; gap: 4px; align-items: center; }
.hd__titleline input { flex: 1; }
.hd__titleline input[readonly] { background: #f6f5f1; color: #555; }
.hd__mini { width: 26px; height: 26px; border: 1px solid var(--border); border-radius: 6px; background: #fff; cursor: pointer; }
.hd__rnd { border-top: 1px dashed var(--border); padding-top: 8px; margin-top: 4px; }
.hd__rndrow { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--muted); margin-bottom: 5px; }
.hd__rndrow select { flex: 1; }
.hd__page { width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12); padding: 16mm 15mm; box-sizing: border-box; }
/* 【M2】抽屉 */
.hd__drawer { min-width: 0; border-left: 1px solid var(--border); background: var(--panel-2, #faf9f6); display: flex; flex-direction: column; overflow: hidden; }
.hd__dhead { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 13px; }
.hd__drow { display: flex; align-items: center; gap: 6px; padding: 6px 10px; }
.hd__dlab { flex: none; width: 34px; font-size: 11.5px; color: var(--muted); }
.hd__drow select, .hd__dinput, .hd__dnum { flex: 1; min-width: 0; padding: 5px 6px; border: 1px solid var(--border); border-radius: 6px; font-size: 12.5px; font-family: inherit; }
.hd__dnum { flex: none; width: 64px; }
.hd__mini--w { width: auto; padding: 0 8px; }
.hd__dgo { margin: 4px 10px 8px; height: 30px; border: 0; border-radius: 6px; background: var(--brand-600, #534AB7); color: #fff; font-size: 13px; cursor: pointer; }
.hd__dhint { padding: 4px 10px; font-size: 11px; color: var(--muted); line-height: 1.5; }
.hd__dlist { flex: 1; overflow-y: auto; padding: 4px 6px 8px; }
.hd__ditem { border: 1px solid var(--border); border-radius: 8px; padding: 6px 8px; margin-bottom: 6px; font-size: 12px; }
.hd__ditem--kb { cursor: pointer; }
.hd__ditem--kb:hover { background: var(--brand-soft, #f2f0fb); border-color: var(--brand-400, #b9b2ec); }
.hd__dtitle { font-size: 11px; color: var(--brand-600, #534AB7); margin-bottom: 3px; }
.hd__dstem { color: var(--text); line-height: 1.5; margin-bottom: 5px; }
.hd__dbtns { display: flex; gap: 4px; }
.hd__dbtns button { flex: 1; height: 24px; border: 1px solid var(--border); border-radius: 6px; background: #fff; font-size: 11.5px; cursor: pointer; }
.hd__dbtns button:hover { background: var(--brand-soft, #f2f0fb); }
.hd__foot { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-top: 1px solid var(--border); }
/* 讲义库目录树 */
.hd__lb1 { font-size: 12.5px; font-weight: 700; padding: 4px 4px 2px; color: var(--text); }
.hd__lb2 { font-size: 12px; padding: 3px 4px 2px 14px; color: var(--text); }
.hd__lb3 { font-size: 11.5px; padding: 2px 4px 2px 26px; color: var(--muted); }
.hd__ldoc { display: flex; align-items: baseline; gap: 6px; margin: 2px 0 2px 36px; padding: 4px 6px; border: 1px solid var(--border); border-radius: 6px; font-size: 12px; cursor: pointer; }
.hd__ldoc:hover { background: var(--brand-soft, #f2f0fb); }
.hd__ldoc--on { background: #f2f0fb; border-color: var(--brand-400, #b9b2ec); font-weight: 700; }
.hd__ldocname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hd__ldocdel { flex: none; color: var(--muted); font-size: 11px; }
.hd__ldocdel:hover { color: #b42318; }
/* 插图 */
.hd__figbox { border: 1px solid var(--border); border-radius: 8px; padding: 6px; margin-bottom: 6px; text-align: center; background: #fff; }
.hd__figbox img { max-width: 100%; max-height: 180px; object-fit: contain; }
.hd__figempty { color: var(--muted); font-size: 11.5px; padding: 16px 0; }
.hd__btn--file { display: block; text-align: center; line-height: 28px; margin-bottom: 6px; cursor: pointer; }
.hd__figsrc { display: flex; gap: 6px; margin-bottom: 6px; }
.hd__figsrc .hd__btn { flex: 1; }
.hd__btn--wide { display: block; width: 100%; margin-top: 4px; }
/* 抽屉要压在右栏之上 ✓ */
.hd__box { position: relative; }

/* ⚠ 打印样式**不能放在 scoped 里** ✗ —— scoped 会给选择器补 [data-v-xxx] ✓，
   而 body / .app 这些元素上没有那个属性 ✗ → 规则永不命中 ✗ → 打印出来还是整个应用（老师实测 ✓）。
   → 全部挪到下面那个**非 scoped** 的 <style> 块里 ✓（与试卷 PaperModal 同一做法 ✓） */
</style>

<!-- ⚠ A4 页面的样式**不能 scoped** ✗ —— 内容是 typesetMixed 注入的 HTML，拿不到 scoped 的 data-v 属性 ✓
     （与 v1458「题图样式一直没生效」是同一个坑 ✓） -->
<style>
.hd__page { color: #111; font-size: 12pt; line-height: 1.7; }
.hd-ptitle { font-size: 19pt; font-weight: 700; text-align: center; }
.hd-psub { text-align: center; color: #444; margin-top: 2px; }
.hd-pmeta { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; font-size: 9.5pt; color: #666; border-bottom: 1px solid #ddd; padding-bottom: 6px; margin: 6px 0 12px; }
.hd-h1 { font-size: 14pt; font-weight: 700; margin: 14px 0 6px; }
.hd-h1--end { border-top: 1px dashed #bbb; padding-top: 10px; }
.hd-h2 { font-size: 12.5pt; font-weight: 700; margin: 10px 0 4px; }
.hd-para { margin: 4px 0; white-space: pre-wrap; }
.hd-formula { text-align: center; margin: 8px 0; }
.hd-bx { border: 1px solid #d8d5cc; border-left: 3px solid #b9b2ec; border-radius: 4px; padding: 6px 9px; margin: 8px 0; background: #fbfaff; }
.hd-bx--goal { background: #f7f9fc; border-left-color: #6f9ad6; }
.hd-bx--know { background: #f6faf6; border-left-color: #7ab98a; }
.hd-bx--note { background: #fdfaf3; border-left-color: #d9b45e; }
.hd-bx--warn { background: #fdf4f3; border-left-color: #cf7b6d; }
.hd-bx--sum { background: #f8f8f6; border-left-color: #8b8a95; }
.hd-bx b { font-size: 10.5pt; color: #444; margin-right: 6px; }
.hd-txt { white-space: pre-wrap; }
.hd-q { display: flex; gap: 8px; margin: 8px 0; }
.hd-qnum { flex: none; font-weight: 700; }
.hd-qtext { white-space: pre-wrap; }
.hd-ans { margin: 4px 0 4px 18px; }
.hd-sol { margin: 4px 0 4px 18px; color: #333; }
.hd-ans b, .hd-sol b { font-size: 10.5pt; color: #9a6212; margin-right: 6px; }
.hd-endnote { display: flex; gap: 8px; margin: 6px 0; }
.hd-blank { border: 1px dashed #c9c6bd; border-radius: 4px; margin: 8px 0; color: #bdbab2; font-size: 9.5pt; padding: 4px 6px; box-sizing: border-box; }
.hd-fig { margin: 10px 0; text-align: center; }
.hd-fig img { max-width: 100%; max-height: 90mm; }
/* 非浮动时：盒子已用 margin auto 摆好 ✓，图在盒内居中 ✓、图注跟着盒子对齐 ✓ */
.hd-fig--left { text-align: left; }
.hd-fig--right { text-align: right; }
.hd-fig--center img { display: block; margin: 0 auto; }
.hd-fig--float-left { float: left; margin: 4px 10px 6px 0; }
.hd-fig--float-right { float: right; margin: 4px 0 6px 10px; }
/* 带底色的块自成一体 ✓（否则浮动图会被块底色压住 ✗）；正文段落仍可绕排 ✓ */
.hd-bx { clear: both; }
.hd-fig figcaption { font-size: 9.5pt; color: #666; margin-top: 3px; }
.hd-fig--empty { border: 1px dashed #c9c6bd; border-radius: 4px; color: #bdbab2; font-size: 9.5pt; padding: 6px; }
.hd-pagebreak { border-top: 1px dashed #bbb; text-align: center; color: #999; font-size: 9.5pt; margin: 12px 0; }
/* 【v1479】打印：只留讲义 A4 纸 ✓（与试卷同一套做法：藏 .app + 纸张静态化 + 自己定页边距 ✓） */
@media print {
  @page { size: A4; margin: 0; }   /* 边距由 .hd__page 的 padding 负责 ✓（打印对话框边距=无 也不贴边 ✓） */
  .app { display: none !important; }   /* ✅ 关键：藏掉整个编辑器（scoped 里写这条是无效的 ✗） */
  .hd { position: static !important; background: #fff !important; display: block !important; }
  .hd__box { width: auto !important; height: auto !important; max-width: none !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; overflow: visible !important; }
  .hd__head, .hd__left, .hd__right, .hd__drawer, .hd__foot { display: none !important; }
  .hd__body { display: block !important; }
  .hd__mid { overflow: visible !important; background: #fff !important; padding: 0 !important; }
  .hd__page { width: auto !important; min-height: 0 !important; height: auto !important; margin: 0 !important; box-shadow: none !important; padding: 16mm 15mm !important; }
  .hd-pagebreak { break-after: page; page-break-after: always; border: 0; color: transparent; }
  .hd-blank { border-color: #ddd; }
}
</style>
