<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { useDeckStore } from '@/stores/deck'
import { mathTemplates } from '@/templates/mathTemplates'
import { mathBundles } from '@/templates/mathBundles'
import { proTemplates, proBundles } from '@/templates/proTemplates'
import { mathAppletTemplates } from '@/templates/mathAppletTemplates'
import { aiChat, isTauri } from '@/composables/useTauri'
import { parseScene3d, SCENE3D_SYSTEM } from '@/composables/aiScene3d'
import { applet3dElement } from '@/composables/applet3d'

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
const mathCats = ['全部', '整套', '封面', '目录', '章节', '定义', '定理', '思考', '知识', '公式', '例题', '方法', '易错', '练习', '小结']
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
/** 带「逐条渐显」的模板 id：注册预览时顺手记下来，卡片右上角给个标记 */
const animatedIds = new Set<string>()
function regPreview(id: string, els: any[]) {
  previewMap.set(id, blocksOf(els))
  if (els.some((e) => e && e.fragment)) animatedIds.add(id)
}
/** 整套：缩略图取第一页，但「是否带动画」要看整套所有页（封面从不带动画，动画在讲解页） */
function regBundlePreview(id: string, slides: any[]) {
  regPreview(id, slides[0]?.elements ?? [])
  if (slides.some((s) => (s.elements ?? []).some((e: any) => e && e.fragment))) animatedIds.add(id)
}
for (const t of mathTemplates) { try { regPreview(t.id, (t.build() as any[]).flat()) } catch {} }
for (const t of proTemplates) { try { regPreview(t.id, (t.build() as any[]).flat()) } catch {} }
for (const b of mathBundles) { try { regBundlePreview(b.id, b.slides as any[]) } catch {} }
for (const b of proBundles) { try { regBundlePreview(b.id, b.slides as any[]) } catch {} }
for (const t of mathAppletTemplates) { try { regPreview(t.id, (t.build() as any[]).flat()) } catch {} }
function previewOf(id: string) { return previewMap.get(id) ?? [] }
function animatedOf(id: string) { return animatedIds.has(id) }

// ---- 一句话生成 3D 场景（v1438）：AI 只回 Scene3D **数据**，白名单过滤后插进当前页 ----
const AI_KEY = 'lj-mathslides:ai-key'
const ai3dText = ref('')
const ai3dBusy = ref(false)
const ai3dMsg = ref('')
function aiKeyOf(): string {
  try { return (localStorage.getItem(AI_KEY) || '').trim() } catch { return '' }
}
async function gen3d() {
  if (ai3dBusy.value) return
  if (!isTauri()) { ai3dMsg.value = 'AI 生成只在桌面端可用（离线时可用下面现成的 3D 模板 ✓）'; return }
  const key = aiKeyOf()
  if (!key) { ai3dMsg.value = '先在「试题库 → 批量导入」里填一次 AI API Key（只存本机、不写进源码）'; return }
  const ask = ai3dText.value.trim()
  if (!ask) { ai3dMsg.value = '先写一句话，例如：正方体 ABCD-A₁B₁C₁D₁，画出体对角线 AC₁'; return }
  ai3dBusy.value = true
  ai3dMsg.value = 'AI 正在设计场景…（约 10~20 秒）'
  try {
    const r = await aiChat({ apiKey: key, system: SCENE3D_SYSTEM, userText: ask })
    if (!r || !r.ok) throw new Error(r && r.error ? String(r.error) : '未知错误')
    const ps = parseScene3d(String(r.content || ''))
    if (ps.error || !ps.scene) throw new Error(ps.error || '没解析出场景')
    const scene = ps.scene
    // 连着生成多个时错开一点，别叠在同一处（第 2 个起往右下挪 28px）✓
    const k = (store.currentSlide?.elements.length || 0) % 5
    store.addElement('embed', Object.assign(applet3dElement(scene), { x: 560 + k * 28, y: 250 + k * 28 }))
    const n = scene.objects.length
    const pts = scene.objects.filter((o) => o.kind === 'point' && (o as { label?: string }).label).length
    ai3dMsg.value = '✓ 已插入当前页：' + (scene.title || ask) + '（' + n + ' 个对象' + (pts ? '、' + pts + ' 个标注点' : '') + '）—— 拖一下就能转'
    setTimeout(() => emit('close'), 700)
  } catch (e) {
    ai3dMsg.value = '✗ ' + String((e as Error)?.message || e)
  } finally {
    ai3dBusy.value = false
  }
}

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
        <button class="panel__close" title="关闭 (Esc)" @click="$emit('close')"><AppIcon name="close" :size="13" /></button>
      </header>

      <div class="panel__tabs">
        <button class="panel__tab" :class="{ 'panel__tab--active': library === 'common' }" @click="library = 'common'">常用模板</button>
        <button class="panel__tab" :class="{ 'panel__tab--active': library === 'math' }" @click="library = 'math'">幻灯片 · 数学风</button>
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
                <span v-if="animatedOf(t.id)" class="card__tag card__tag--anim" title="演示时点一下出一条">渐显</span>
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
                <span v-if="animatedOf(b.id)" class="card__tag card__tag--anim" title="演示时点一下出一条">渐显</span>
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
                <span v-if="animatedOf(t.id)" class="card__tag card__tag--anim" title="演示时点一下出一条">渐显</span>
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
        <div class="panel__ai3d">
          <input
            v-model="ai3dText"
            class="panel__ai3d-input"
            placeholder="一句话描述图形，例如：正方体 ABCD-A₁B₁C₁D₁，画出体对角线 AC₁（回车或点右侧按钮）"
            :disabled="ai3dBusy"
            @keydown.enter="gen3d"
          />
          <button class="panel__ai3d-btn" :disabled="ai3dBusy" :title="'用 AI（DeepSeek）把一句话变成可旋转的 3D 场景，插到当前页'" @click="gen3d">
            {{ ai3dBusy ? '生成中…' : '✦ 一句话生成 3D' }}
          </button>
        </div>
        <div v-if="ai3dMsg" class="panel__ai3d-msg">{{ ai3dMsg }}</div>
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
                <span v-if="animatedOf(t.id)" class="card__tag card__tag--anim" title="演示时点一下出一条">渐显</span>
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
                <span v-if="animatedOf(b.id)" class="card__tag card__tag--anim" title="演示时点一下出一条">渐显</span>
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
/* 一句话生成 3D（v1438）：输入框 + 生成按钮 + 状态行 */
.panel__ai3d { display: flex; gap: 8px; padding: 12px 22px 0; }
.panel__ai3d-input { flex: 1; min-width: 0; height: 34px; padding: 0 10px; border: 1px solid #d8d5cb; border-radius: 8px; font-size: 13px; background: #fff; color: #1a1a1a; }
.panel__ai3d-input:disabled { background: #f7f6f2; color: #8a8aa0; }
.panel__ai3d-btn { height: 34px; padding: 0 14px; border: 1px solid #534ab7; border-radius: 8px; background: #534ab7; color: #fff; font-size: 13px; cursor: pointer; white-space: nowrap; }
.panel__ai3d-btn:disabled { opacity: .55; cursor: default; }
.panel__ai3d-msg { padding: 8px 22px 0; font-size: 12.5px; line-height: 1.5; color: #5f5e5a; word-break: break-all; }
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
/* 「渐显」标记放右上，避免和左上的「整套」叠在一起 */
.card__tag--anim { left: auto; right: 8px; background: rgba(232, 135, 30, 0.92); }
.card__info { display: flex; flex-direction: column; gap: 6px; padding: 11px 13px 13px; }
.card__badge { font-size: 10px; color: var(--brand); border: 1px solid var(--brand-soft-2); border-radius: 4px; padding: 1px 6px; align-self: flex-start; }
.card__name { font-size: 14px; color: var(--text); line-height: 1.4; font-weight: 600; }
.card__desc { font-size: 12px; color: var(--muted); line-height: 1.5; margin-top: 2px; }
</style>
