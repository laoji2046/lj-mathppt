<script setup lang="ts">
/**
 * 【M1】数学讲义编辑器
 *
 * 版式：左「块列表」（加块 / 选中 / 上下移 / 删）· 中「A4 纸预览」· 右「块属性 + 讲义信息」
 * 顶部：**学生版 ⇄ 教师版** 一键切换 ✓（这是讲义相对试卷的关键能力 ✓）+ 打印/导出 PDF ✓
 *
 * 与试卷的关系：都走「A4 + window.print() + @media print」这条矢量打印链 ✓
 *（docs/数学讲义-研究.md §4 ✓）
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
// ⚠ 必须用 typesetHosts（只排版、不写内容 ✓）—— 页面 DOM 归 Vue 管 ✓
//   用 typesetMixed 会 host.innerHTML = … ✗ 把 Vue 的 DOM 抢掉 → 切版本时页面不再更新（实测踩过 ✓）
import { typesetHosts } from '@/composables/useMathJax'
import {
  HD_LABEL, HD_NUMBERED, handout, hdVersion, makeBlock, rendered, saveHandout, setHandout, handoutToText,
} from '@/composables/useHandout'
import type { HdBlock, HdBlockType, HdRender } from '@/composables/useHandout'

const emit = defineEmits<{ (e: 'close'): void }>()

const h = handout
const ver = hdVersion
const selIdx = ref(0)
const msg = ref('')
const pageHost = ref<HTMLElement | null>(null)

/** 加块按钮（常用顺序 ✓） */
const ADD: { t: HdBlockType; label: string }[] = [
  { t: 'h1', label: '章' }, { t: 'h2', label: '节' }, { t: 'para', label: '正文' }, { t: 'formula', label: '公式' },
  { t: 'goal', label: '目标' }, { t: 'knowledge', label: '知识' }, { t: 'example', label: '例题' }, { t: 'variant', label: '变式' },
  { t: 'exercise', label: '练习' }, { t: 'answer', label: '答案' }, { t: 'solution', label: '解析' },
  { t: 'summary', label: '小结' }, { t: 'note', label: '提示' }, { t: 'warn', label: '警示' },
  { t: 'blank', label: '留白' }, { t: 'pagebreak', label: '分页' },
]
const RENDER_LABEL: Record<HdRender, string> = { inline: '正常显示', hide: '不显示', blank: '留白', endnote: '排到文末' }

const sel = computed<HdBlock | null>(() => h.value.blocks[selIdx.value] || null)

function flash(t: string) { msg.value = t; window.setTimeout(() => { if (msg.value === t) msg.value = '' }, 2600) }

function addBlock(t: HdBlockType) {
  const b = makeBlock(t)
  const at = Math.min(selIdx.value + 1, h.value.blocks.length)
  h.value.blocks.splice(at, 0, b)
  selIdx.value = at
  void refresh()
  flash('已插入「' + HD_LABEL[t] + '」')
}
function delBlock(i: number) {
  h.value.blocks.splice(i, 1)
  selIdx.value = Math.max(0, Math.min(selIdx.value, h.value.blocks.length - 1))
  void refresh()
}
function move(i: number, d: number) {
  const j = i + d
  if (j < 0 || j >= h.value.blocks.length) return
  const [x] = h.value.blocks.splice(i, 1)
  h.value.blocks.splice(j, 0, x)
  selIdx.value = j
  void refresh()
}
function summary(b: HdBlock): string {
  const t = String(b.text || '').replace(/\s+/g, ' ').trim()
  if (b.type === 'blank') return '留白 ' + (b.blankCm || 4) + 'cm'
  return t ? t.slice(0, 24) : '（空）'
}
/** 这块在当前版本里会怎样（列表上一眼能看出来 ✓） */
function modeOf(b: HdBlock): string {
  const m = b.render[ver.value]
  return m === 'inline' ? '' : '·' + RENDER_LABEL[m]
}

/** MathJax 排版（每次渲染后重排一次 ✓） */
async function refresh() {
  saveHandout(h.value)
  await nextTick()
  const host = pageHost.value
  if (!host) return
  try { await typesetHosts([host]) } catch { /* 公式排版失败不影响用 ✓ */ }
}

function setVer(v: 'student' | 'teacher') { ver.value = v; void refresh() }
function printPdf() { window.print() }
function exportText() {
  const txt = handoutToText(h.value, ver.value)
  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = (h.value.meta.title || '讲义') + '-' + (ver.value === 'student' ? '学生版' : '教师版') + '.txt'
  a.click()
  URL.revokeObjectURL(a.href)
  flash('已导出纯文本（' + (ver.value === 'student' ? '学生版' : '教师版') + '）')
}
function exportJson() {
  const blob = new Blob([JSON.stringify(h.value, null, 1)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = (h.value.meta.title || '讲义') + '.json'
  a.click()
  URL.revokeObjectURL(a.href)
  flash('已导出讲义 JSON（可再导入 ✓）')
}
function importJson(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files && input.files[0]
  input.value = ''
  if (!f) return
  const r = new FileReader()
  r.onload = () => {
    try { setHandout(JSON.parse(String(r.result || ''))); selIdx.value = 0; void refresh(); flash('已导入讲义 ✓') }
    catch { flash('✗ 这个文件不是讲义 JSON') }
  }
  r.readAsText(f)
}
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }
onMounted(() => { document.addEventListener('keydown', onKey); void refresh() })
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
watch(() => [h.value.blocks.length, h.value.meta.title], () => { void refresh() })
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
            <!-- 学生版 / 教师版：讲义的核心 ✓ -->
            <button class="hd__btn" :class="{ 'hd__btn--on': ver === 'student' }" title="学生版：答案按各块设置隐藏 / 留白 / 排到文末" @click="setVer('student')">学生版</button>
            <button class="hd__btn" :class="{ 'hd__btn--on': ver === 'teacher' }" title="教师版：答案与解析内联显示" @click="setVer('teacher')">教师版</button>
            <button class="hd__btn hd__btn--main" title="打印 / 另存为 PDF（矢量文字 ✓）" @click="printPdf">打印 / PDF</button>
            <button class="hd__btn" title="导出纯文本（当前版本）" @click="exportText">导出文本</button>
            <button class="hd__btn" title="导出讲义 JSON（可再导入 ✓）" @click="exportJson">导出 JSON</button>
            <label class="hd__btn" title="导入讲义 JSON">
              导入<input type="file" accept="application/json,.json" style="display:none" @change="importJson" />
            </label>
            <button class="hd__close" title="关闭 (Esc)" @click="emit('close')"><AppIcon name="close" :size="13" /></button>
          </span>
        </header>

        <div class="hd__body">
          <!-- 左：块列表 -->
          <aside class="hd__left">
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
              <div v-if="!h.blocks.length" class="hd__hint">左边点「+知识 / +例题 …」开始写讲义 ✓</div>
            </div>
          </aside>

          <!-- 中：A4 预览（打印的就是这一块 ✓） -->
          <main class="hd__mid">
            <div ref="pageHost" class="hd__page">
              <div class="hd__ptitle">{{ h.meta.title }}</div>
              <div v-if="h.meta.subtitle" class="hd__psub">{{ h.meta.subtitle }}</div>
              <div class="hd__pmeta">
                <span v-if="h.meta.school">{{ h.meta.school }}</span>
                <span v-if="h.meta.subject">{{ h.meta.subject }}</span>
                <span v-if="h.meta.grade">{{ h.meta.grade }}</span>
                <span v-if="h.meta.teacher">教师：{{ h.meta.teacher }}</span>
                <span v-if="h.meta.date">{{ h.meta.date }}</span>
                <span class="hd__pv">{{ ver === 'student' ? '学生版' : '教师版' }}</span>
              </div>

              <template v-for="it in rendered.main" :key="it.b.id">
                <div v-if="it.b.type === 'pagebreak'" class="hd__pagebreak">— 分页 —</div>
                <div v-else-if="it.b.type === 'blank'" class="hd__blank" :style="{ height: (it.b.blankCm || 4) + 'cm' }">（留白）</div>
                <h1 v-else-if="it.b.type === 'h1'" class="hd__h1">{{ it.show }}</h1>
                <h2 v-else-if="it.b.type === 'h2'" class="hd__h2">{{ it.show }}</h2>
                <div v-else-if="it.b.type === 'formula'" class="hd__formula">{{ it.show }}</div>
                <div v-else-if="it.b.type === 'goal'" class="hd__bx hd__bx--goal"><b>学习目标</b><div class="hd__txt">{{ it.show }}</div></div>
                <div v-else-if="it.b.type === 'knowledge'" class="hd__bx hd__bx--know"><b>知识梳理</b><div class="hd__txt">{{ it.show }}</div></div>
                <div v-else-if="it.b.type === 'note'" class="hd__bx hd__bx--note"><b>提示</b><div class="hd__txt">{{ it.show }}</div></div>
                <div v-else-if="it.b.type === 'warn'" class="hd__bx hd__bx--warn"><b>易错警示</b><div class="hd__txt">{{ it.show }}</div></div>
                <div v-else-if="it.b.type === 'summary'" class="hd__bx hd__bx--sum"><b>归纳小结</b><div class="hd__txt">{{ it.show }}</div></div>
                <div v-else-if="it.b.type === 'example' || it.b.type === 'variant' || it.b.type === 'exercise'" class="hd__q">
                  <span class="hd__qnum">{{ it.num }}</span>
                  <span class="hd__qtext">{{ it.show }}</span>
                </div>
                <div v-else-if="it.b.type === 'answer'" class="hd__ans"><b>答案</b>{{ it.show }}</div>
                <div v-else-if="it.b.type === 'solution'" class="hd__sol"><b>解析</b>{{ it.show }}</div>
                <div v-else class="hd__para">{{ it.show }}</div>
              </template>

              <!-- 学生版：排到文末的参考答案 ✓ -->
              <template v-if="rendered.notes.length">
                <h1 class="hd__h1 hd__h1--end">参考答案</h1>
                <div v-for="(it, i) in rendered.notes" :key="'n' + it.b.id" class="hd__endnote">
                  <span class="hd__qnum">{{ i + 1 }}</span>
                  <span class="hd__qtext"><b>{{ HD_LABEL[it.b.type] }}</b>{{ it.show }}</span>
                </div>
              </template>
            </div>
          </main>

          <!-- 右：块属性 + 讲义信息 -->
          <aside class="hd__right">
            <div class="hd__t1">讲义信息</div>
            <label>标题<input v-model="h.meta.title" /></label>
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
              <label v-if="sel.type !== 'pagebreak' && sel.type !== 'blank'">内容<textarea v-model="sel.text" rows="7" placeholder="支持 $…$ 公式；换行直接回车 ✓"></textarea></label>
              <label v-if="sel.type === 'blank'">留白高度（cm）<input v-model.number="sel.blankCm" type="number" min="1" max="20" step="0.5" /></label>
              <label v-if="HD_NUMBERED.includes(sel.type)" class="hd__chk"><input v-model="sel.number" type="checkbox" /> 自动编号</label>
              <div class="hd__rnd">
                <div class="hd__rndrow"><span>学生版</span>
                  <select v-model="sel.render.student"><option v-for="(l, k) in RENDER_LABEL" :key="k" :value="k">{{ l }}</option></select>
                </div>
                <div class="hd__rndrow"><span>教师版</span>
                  <select v-model="sel.render.teacher"><option v-for="(l, k) in RENDER_LABEL" :key="k" :value="k">{{ l }}</option></select>
                </div>
                <div class="hd__hint2">答案/解析默认「学生版排到文末、教师版内联」✓ —— 这就是一份内容两个版本的关键 ✓</div>
              </div>
            </template>
            <div v-else class="hd__hint">在左边点一块题，这里就能改它 ✓</div>
          </aside>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.hd { position: fixed; inset: 0; z-index: 2600; background: rgba(20, 24, 34, 0.45); display: flex; align-items: center; justify-content: center; }
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
.hd__left { border-right: 1px solid var(--border); display: flex; flex-direction: column; min-height: 0; }
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
.hd__page { width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12); padding: 16mm 15mm; box-sizing: border-box; color: #111; font-size: 12pt; line-height: 1.7; }
.hd__ptitle { font-size: 19pt; font-weight: 700; text-align: center; }
.hd__psub { text-align: center; color: #444; margin-top: 2px; }
.hd__pmeta { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; font-size: 9.5pt; color: #666; border-bottom: 1px solid #ddd; padding-bottom: 6px; margin: 6px 0 12px; }
.hd__pv { font-weight: 700; color: #1d4e89; }
.hd__h1 { font-size: 14pt; font-weight: 700; margin: 14px 0 6px; }
.hd__h1--end { border-top: 1px dashed #bbb; padding-top: 10px; }
.hd__h2 { font-size: 12.5pt; font-weight: 700; margin: 10px 0 4px; }
.hd__para { margin: 4px 0; white-space: pre-wrap; }
.hd__formula { text-align: center; margin: 8px 0; }
.hd__bx { border: 1px solid #d8d5cc; border-left: 3px solid #b9b2ec; border-radius: 4px; padding: 6px 9px; margin: 8px 0; background: #fbfaff; }
.hd__bx--goal { background: #f7f9fc; border-left-color: #6f9ad6; }
.hd__bx--know { background: #f6faf6; border-left-color: #7ab98a; }
.hd__bx--note { background: #fdfaf3; border-left-color: #d9b45e; }
.hd__bx--warn { background: #fdf4f3; border-left-color: #cf7b6d; }
.hd__bx--sum { background: #f8f8f6; border-left-color: #8b8a95; }
.hd__bx b { font-size: 10.5pt; color: #444; margin-right: 6px; }
.hd__txt { white-space: pre-wrap; }
.hd__q { display: flex; gap: 8px; margin: 8px 0; }
.hd__qnum { flex: none; font-weight: 700; }
.hd__qtext { white-space: pre-wrap; }
.hd__ans { margin: 4px 0 4px 18px; }
.hd__sol { margin: 4px 0 4px 18px; color: #333; }
.hd__ans b, .hd__sol b { font-size: 10.5pt; color: #9a6212; margin-right: 6px; }
.hd__endnote { display: flex; gap: 8px; margin: 6px 0; }
.hd__blank { border: 1px dashed #c9c6bd; border-radius: 4px; margin: 8px 0; color: #bdbab2; font-size: 9.5pt; padding: 4px 6px; box-sizing: border-box; }
.hd__pagebreak { border-top: 1px dashed #bbb; text-align: center; color: #999; font-size: 9.5pt; margin: 12px 0; }
.hd__right { border-left: 1px solid var(--border); overflow-y: auto; padding: 10px; }
.hd__t1 { font-size: 12px; font-weight: 700; color: var(--text); margin: 8px 0 6px; }
.hd__right label { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; color: var(--muted); margin-bottom: 6px; }
.hd__right input, .hd__right select, .hd__right textarea { padding: 5px 6px; border: 1px solid var(--border); border-radius: 6px; font-size: 12.5px; font-family: inherit; color: var(--text); background: #fff; }
.hd__row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.hd__chk { flex-direction: row; align-items: center; gap: 6px; }
.hd__rnd { border-top: 1px dashed var(--border); padding-top: 8px; margin-top: 4px; }
.hd__rndrow { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--muted); margin-bottom: 5px; }
.hd__rndrow select { flex: 1; }

/* 打印：只留 A4 纸 ✓（与试卷同一条思路 ✓） */
@media print {
  body > *:not(.hd) { display: none !important; }
  .hd { position: static; background: #fff; display: block; }
  .hd__box { width: auto; height: auto; max-width: none; border: 0; border-radius: 0; box-shadow: none; }
  .hd__head, .hd__left, .hd__right { display: none !important; }
  .hd__body { display: block; }
  .hd__mid { overflow: visible; background: #fff; padding: 0; }
  .hd__page { width: auto; min-height: 0; margin: 0; box-shadow: none; padding: 0; }
  .hd__pagebreak { break-after: page; page-break-after: always; border: 0; color: transparent; }
  .hd__blank { border-color: #ddd; }
}
</style>
