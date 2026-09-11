<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDeckStore } from '@/stores/deck'
import { mathTemplates } from '@/templates/mathTemplates'
import { mathBundles } from '@/templates/mathBundles'
import { proTemplates, proBundles } from '@/templates/proTemplates'
import { mathAppletTemplates } from '@/templates/mathAppletTemplates'

const store = useDeckStore()
const props = defineProps<{ mode?: 'replace' | 'add' | 'addSub' }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const library = ref<'common' | 'math' | 'mathApplet' | 'pro'>('common')

/** 打开方式不同，说明文字不同：replace=替换当前页 / add=后面新增一页 / addSub=新增子页 */
const modeHint = computed(() => {
  const m = props.mode ?? 'replace'
  if (m === 'add') return '点击卡片：在当前页后新增一页（整套模板插入多页；「空白模板」= 新增空白页）'
  if (m === 'addSub') return '点击卡片：为当前页新增一个子页（演示时向下展开；「空白模板」= 新增空白子页）'
  return '点击单页模板替换当前页；点击整套替换整个演示'
})

type Entry =
  | { kind: 'bundle'; id: string; name: string; cat: '整套'; desc: string; pages: number }
  | { kind: 'single'; id: string; name: string; cat: string; desc: string }

// ---- 高中数学讲义模板（原有） ----
const mathCats = ['全部', '整套', '封面', '目录', '章节', '知识', '公式', '例题', '动画', '方法', '易错', '高考', '导图', '练习', '小结']
const activeMathCat = ref('全部')
const filtered = computed<Entry[]>(() => {
  if (activeMathCat.value === '整套') return []
  if (activeMathCat.value === '全部') {
    return [
      ...mathBundles.map<Entry>((b) => ({ kind: 'bundle', id: b.id, name: b.name, cat: '整套', desc: b.description, pages: b.slides.length })),
      ...mathTemplates.map<Entry>((t) => ({ kind: 'single', id: t.id, name: t.name, cat: t.cat, desc: '' })),
    ]
  }
  return mathTemplates.filter((t) => t.cat === activeMathCat.value).map<Entry>((t) => ({ kind: 'single', id: t.id, name: t.name, cat: t.cat, desc: '' }))
})
const filteredBundles = computed(() => activeMathCat.value === '整套' ? mathBundles : [])

// ---- 常用模板 tab：精选（数学常用页 + 整套 + 专业常用页） ----
const commonMathIds = ['cover', 'toc', 'section', 'knowledge', 'formula', 'example', 'method', 'practice', 'summary', 'math-summary']
const commonProIds = ['ppt-cover', 'ppt-section', 'ppt-list', 'ppt-two']
const filteredCommon = computed<Entry[]>(() => [
  { kind: 'single', id: 'blank', name: '空白模板', cat: '常用', desc: '' },
  ...mathBundles.map<Entry>((b) => ({ kind: 'bundle', id: b.id, name: b.name, cat: '整套', desc: b.description, pages: b.slides.length })),
  ...mathTemplates.filter((t) => commonMathIds.includes(t.id)).map<Entry>((t) => ({ kind: 'single', id: t.id, name: t.name, cat: t.cat, desc: '' })),
  ...proTemplates.filter((t) => commonProIds.includes(t.id)).map<Entry>((t) => ({ kind: 'single', id: t.id, name: t.name, cat: t.cat, desc: '' })),
  ...mathAppletTemplates.filter((t) => ['ex-formula-quadratic', 'ex-ggb-quad', 'ex-desmos-func', 'ex-html-prob'].includes(t.id)).map<Entry>((t) => ({ kind: 'single', id: t.id, name: t.name, cat: t.cat, desc: t.desc })),
])

// ---- 专业模板（PPT 风） ----
const proCats = computed(() => Array.from(new Set(proTemplates.map((t) => t.cat))))
const activeProCat = ref('全部')
const proCatsAll = computed(() => ['全部', ...proCats.value])
const proFiltered = computed(() => activeProCat.value === '全部' ? proTemplates : proTemplates.filter((t) => t.cat === activeProCat.value))

// ---- 迷你版式缩略图：把 build() 的元素画成真实骨架 ----
interface PBlock { x: number; y: number; w: number; h: number; c: string; o: number }
function blocksOf(els: any[]): PBlock[] {
  const out: PBlock[] = []
  for (const e of els) {
    if (e.type === 'table') continue
    const fill = e.fill && e.fill !== 'transparent'
      ? e.fill
      : e.color || (e.stroke && e.stroke !== 'transparent' ? e.stroke : '')
    let o = 1
    if (e.type === 'text' || e.type === 'richtex' || e.type === 'math') o = 0.42
    else if (e.type === 'line' || e.type === 'arrow') o = 0.66
    else if (e.type === 'image' || e.type === 'embed') o = 0.78
    out.push({ x: +e.x || 0, y: +e.y || 0, w: Math.max(3, +e.w || 0), h: Math.max(3, +e.h || 0), c: fill || '#d8d5cb', o })
  }
  return out
}
const previewMap = new Map<string, PBlock[]>()
function regPreview(id: string, els: any[]) { previewMap.set(id, blocksOf(els)) }
for (const t of mathTemplates) { try { regPreview(t.id, (t.build() as any[]).flat()) } catch {} }
for (const t of proTemplates) { try { regPreview(t.id, (t.build() as any[]).flat()) } catch {} }
for (const b of mathBundles) { try { regPreview(b.id, (b.slides[0] as any)?.elements ?? []) } catch {} }
for (const b of proBundles) { try { regPreview(b.id, (b.slides[0] as any)?.elements ?? []) } catch {} }
for (const t of mathAppletTemplates) { try { regPreview(t.id, (t.build() as any[]).flat()) } catch {} }
function previewOf(id: string) { return previewMap.get(id) ?? [] }

function apply(id: string) {
  const m = props.mode ?? 'replace'
  if (id === 'blank') {
    if (m === 'replace') store.applyBlank()
    else store.addBlankPage(m === 'addSub')
    emit('close')
    return
  }
  if (m === 'replace') store.applyTemplate(id)
  else store.addPageWithTemplate(id, m === 'addSub')
  emit('close')
}
function applyBundle(id: string) {
  const m = props.mode ?? 'replace'
  if (m === 'replace') store.applyBundle(id)
  else store.addBundlePages(id, m === 'addSub')
  emit('close')
}
</script>

<template>
  <div class="picker" @click.self="$emit('close')">
    <div class="panel">
      <header class="panel__head">
        <div class="panel__title">模板库</div>
        <span class="panel__hint">{{ modeHint }}</span>
        <button class="panel__close" title="关闭 (Esc)" @click="$emit('close')">✕</button>
      </header>

      <div class="panel__tabs">
        <button class="panel__tab" :class="{ 'panel__tab--active': library === 'common' }" @click="library = 'common'">常用模板</button>
        <button class="panel__tab" :class="{ 'panel__tab--active': library === 'math' }" @click="library = 'math'">数学讲义模板</button>
        <button class="panel__tab" :class="{ 'panel__tab--active': library === 'mathApplet' }" @click="library = 'mathApplet'">高中数学例题</button>
        <button class="panel__tab" :class="{ 'panel__tab--active': library === 'pro' }" @click="library = 'pro'">专业模板</button>
      </div>

      <template v-if="library === 'common'">
        <div class="panel__body">
          <div class="panel__grid">
            <button v-for="t in filteredCommon" :key="t.kind + ':' + t.id" class="card" :class="{ 'card--bundle': t.kind === 'bundle' }" :title="t.name" @click="t.kind === 'bundle' ? applyBundle(t.id) : apply(t.id)">
              <div class="card__thumb">
                <svg v-if="previewOf(t.id).length" viewBox="0 0 1920 1080" preserveAspectRatio="none"><rect v-for="(bl, i) in previewOf(t.id)" :key="i" :x="bl.x" :y="bl.y" :width="bl.w" :height="bl.h" :fill="bl.c" :opacity="bl.o" rx="10" /></svg>
                <div v-else-if="t.id === 'blank'" class="card__thumb-blank"></div>
                <div v-else class="card__thumb-none"></div>
                <span v-if="t.kind === 'bundle'" class="card__tag">整套</span>
              </div>
              <div class="card__info">
                <span class="card__badge">{{ t.cat }}<span v-if="t.kind === 'bundle'"> · {{ t.pages }} 页</span></span>
                <span class="card__name">{{ t.name }}</span>
                <span v-if="t.kind === 'bundle' || t.desc" class="card__desc">{{ t.desc }}</span>
              </div>
            </button>
          </div>
        </div>
      </template>

      <template v-else-if="library === 'math'">
        <div class="panel__cats">
          <button v-for="c in mathCats" :key="c" class="panel__cat" :class="{ 'panel__cat--active': activeMathCat === c }" @click="activeMathCat = c">{{ c }}</button>
        </div>
        <div class="panel__body">
          <div v-if="activeMathCat === '整套'" class="panel__grid panel__grid--bundle">
            <button v-for="b in filteredBundles" :key="b.id" class="card card--bundle" :title="b.description" @click="applyBundle(b.id)">
              <div class="card__thumb">
                <svg v-if="previewOf(b.id).length" viewBox="0 0 1920 1080" preserveAspectRatio="none"><rect v-for="(bl, i) in previewOf(b.id)" :key="i" :x="bl.x" :y="bl.y" :width="bl.w" :height="bl.h" :fill="bl.c" :opacity="bl.o" rx="10" /></svg>
                <div v-else class="card__thumb-none"></div>
                <span class="card__tag">整套</span>
              </div>
              <div class="card__info">
                <span class="card__badge">整套 · {{ b.slides.length }} 页</span>
                <span class="card__name">{{ b.name }}</span>
                <span class="card__desc">{{ b.description }}</span>
              </div>
            </button>
          </div>
          <div v-else class="panel__grid">
            <div v-if="!filtered.length" style="padding:24px;color:#8a8aa0;font-size:14px">模板库已清空（如需恢复模板，告诉我）</div>
            <button v-for="t in filtered" :key="t.kind + ':' + t.id" class="card" :class="{ 'card--bundle': t.kind === 'bundle' }" :title="t.name" @click="t.kind === 'bundle' ? applyBundle(t.id) : apply(t.id)">
              <div class="card__thumb">
                <svg v-if="previewOf(t.id).length" viewBox="0 0 1920 1080" preserveAspectRatio="none"><rect v-for="(bl, i) in previewOf(t.id)" :key="i" :x="bl.x" :y="bl.y" :width="bl.w" :height="bl.h" :fill="bl.c" :opacity="bl.o" rx="10" /></svg>
                <div v-else class="card__thumb-none"></div>
                <span v-if="t.kind === 'bundle'" class="card__tag">整套</span>
              </div>
              <div class="card__info">
                <span class="card__badge">{{ t.cat }}<span v-if="t.kind === 'bundle'"> · {{ t.pages }} 页</span></span>
                <span class="card__name">{{ t.name }}</span>
                <span v-if="t.kind === 'bundle' || t.desc" class="card__desc">{{ t.desc }}</span>
              </div>
            </button>
          </div>
        </div>
      </template>
      <template v-else-if="library === 'mathApplet'">
        <div class="panel__body">
          <div class="panel__grid">
            <button v-for="t in mathAppletTemplates" :key="t.id" class="card" :title="t.desc" @click="apply(t.id)">
              <div class="card__thumb">
                <svg v-if="previewOf(t.id).length" viewBox="0 0 1920 1080" preserveAspectRatio="none"><rect v-for="(bl, i) in previewOf(t.id)" :key="i" :x="bl.x" :y="bl.y" :width="bl.w" :height="bl.h" :fill="bl.c" :opacity="bl.o" rx="10" /></svg>
                <div v-else class="card__thumb-none"></div>
              </div>
              <div class="card__info">
                <span class="card__badge">{{ t.tag }}</span>
                <span class="card__name">{{ t.name }}</span>
                <span class="card__desc">{{ t.desc }}</span>
              </div>
            </button>
          </div>
        </div>
      </template>
      <template v-else>
        <div class="panel__cats">
          <button v-for="c in proCatsAll" :key="c" class="panel__cat" :class="{ 'panel__cat--active': activeProCat === c }" @click="activeProCat = c">{{ c }}</button>
        </div>
        <div class="panel__body">
          <div class="panel__grid">
            <div v-if="!proFiltered.length && !proBundles.length" style="padding:24px;color:#8a8aa0;font-size:14px">模板库已清空（如需恢复模板，告诉我）</div>
            <button v-for="t in proFiltered" :key="t.id" class="card" :title="t.name" @click="apply(t.id)">
              <div class="card__thumb">
                <svg v-if="previewOf(t.id).length" viewBox="0 0 1920 1080" preserveAspectRatio="none"><rect v-for="(bl, i) in previewOf(t.id)" :key="i" :x="bl.x" :y="bl.y" :width="bl.w" :height="bl.h" :fill="bl.c" :opacity="bl.o" rx="10" /></svg>
                <div v-else class="card__thumb-none"></div>
              </div>
              <div class="card__info">
                <span class="card__badge">{{ t.cat }}</span>
                <span class="card__name">{{ t.name }}</span>
              </div>
            </button>
            <button v-for="b in proBundles" :key="b.id" class="card card--bundle" :title="b.description" @click="applyBundle(b.id)">
              <div class="card__thumb">
                <svg v-if="previewOf(b.id).length" viewBox="0 0 1920 1080" preserveAspectRatio="none"><rect v-for="(bl, i) in previewOf(b.id)" :key="i" :x="bl.x" :y="bl.y" :width="bl.w" :height="bl.h" :fill="bl.c" :opacity="bl.o" rx="10" /></svg>
                <div v-else class="card__thumb-none"></div>
                <span class="card__tag">整套</span>
              </div>
              <div class="card__info">
                <span class="card__badge">整套 · {{ b.slides.length }} 页</span>
                <span class="card__name">{{ b.name }}</span>
                <span class="card__desc">{{ b.description }}</span>
              </div>
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.picker { position: fixed; inset: 0; z-index: 300; background: rgba(15, 18, 30, 0.5); display: flex; align-items: center; justify-content: center; }
.panel { width: min(1040px, 94vw); max-height: 88vh; display: flex; flex-direction: column; background: #fff; border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); overflow: hidden; }
.panel__head { display: flex; align-items: center; gap: 12px; padding: 18px 22px 12px; border-bottom: 1px solid var(--border); }
.panel__title { font-size: 19px; font-weight: 700; color: var(--text); letter-spacing: 0.5px; }
.panel__hint { font-size: 12px; color: var(--muted); flex: 1; }
.panel__close { width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--border-strong); background: #fff; color: var(--muted); font-size: 16px; line-height: 1; cursor: pointer; transition: background .12s, color .12s; }
.panel__close:hover { background: var(--brand-soft); color: var(--brand); }
.panel__tabs { display: flex; gap: 8px; padding: 12px 22px 0; }
.panel__tab { padding: 7px 18px; border: 1px solid var(--border-strong); border-radius: 9px; background: #fff; font-size: 14px; font-weight: 600; cursor: pointer; color: var(--text); }
.panel__tab--active { background: var(--brand); border-color: var(--brand); color: #fff; }
.panel__cats { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 22px; }
.panel__cat { padding: 5px 12px; border: 1px solid var(--border-strong); background: #fff; border-radius: var(--radius-xl); font-size: 13px; cursor: pointer; color: var(--text); }
.panel__cat--active { background: var(--brand); border-color: var(--brand); color: #fff; }
.panel__body { flex: 1; overflow-y: auto; padding: 2px 22px 22px; }
.panel__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(212px, 1fr)); gap: 16px; }
.panel__grid--bundle { grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); }
.card { display: flex; flex-direction: column; padding: 0; border: 1px solid var(--border); border-radius: var(--radius-xl); background: #fff; text-align: left; cursor: pointer; overflow: hidden; transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease; }
.card:hover { border-color: var(--brand); transform: translateY(-3px); box-shadow: 0 14px 34px rgba(83, 74, 183, 0.18); }
.card--bundle { border-color: var(--brand-soft-2); }
.card--bundle:hover { box-shadow: 0 14px 34px rgba(83, 74, 183, 0.24); }
.card__thumb { position: relative; width: 100%; aspect-ratio: 16 / 9; background: #faf9f5; border-bottom: 1px solid var(--border); overflow: hidden; }
.card__thumb svg { display: block; width: 100%; height: 100%; }
.card__thumb-none { width: 100%; height: 100%; background: repeating-linear-gradient(45deg, #eceadf, #eceadf 10px, #f4f2ea 10px, #f4f2ea 20px); }
.card__thumb-blank { width: 100%; height: 100%; background: #fff; }
.card__thumb-blank::after { content: ''; position: absolute; inset: 0; margin: auto; width: 34px; height: 34px; border: 2px dashed #cfcbd8; border-radius: 6px; }
.card__tag { position: absolute; top: 8px; left: 8px; font-size: 10px; font-weight: 600; color: #fff; background: rgba(83, 74, 183, 0.85); border-radius: 6px; padding: 2px 7px; }
.card__info { display: flex; flex-direction: column; gap: 6px; padding: 11px 13px 13px; }
.card__badge { font-size: 10px; color: var(--brand); border: 1px solid var(--brand-soft-2); border-radius: 4px; padding: 1px 6px; align-self: flex-start; }
.card__name { font-size: 14px; color: var(--text); line-height: 1.4; font-weight: 600; }
.card__desc { font-size: 12px; color: var(--muted); line-height: 1.5; margin-top: 2px; }
</style>
