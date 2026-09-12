<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { useDeckStore } from '@/stores/deck'
import { FORMULA_LIBRARY, FORMULA_TAGS, formulaTags } from '@/templates/formulaLibrary'
import { renderLatex } from '@/composables/useMathJax'
import type { FormulaItem } from '@/templates/formulaLibrary'
import type { SlideElement } from '@/types'

const store = useDeckStore()
const emit = defineEmits<{ (e: 'close'): void }>()

const activeKey = ref(FORMULA_LIBRARY[0].key)
const query = ref('')
const previewWrap = ref<HTMLElement | null>(null)

const active = computed(() => FORMULA_LIBRARY.find((c) => c.key === activeKey.value) || FORMULA_LIBRARY[0])

/** 当前展示的公式列表：搜索时跨分类搜索；选标签时跨分类按标签筛；否则用当前分类 */
const visible = computed<FormulaItem[]>(() => {
  const q = query.value.trim().toLowerCase()
  const cats = (q || activeTag.value) ? FORMULA_LIBRARY : [active.value]
  const hits: FormulaItem[] = []
  for (const c of cats) {
    for (const f of c.formulas) {
      if (q && !(f.label.toLowerCase().includes(q) || f.latex.toLowerCase().includes(q))) continue
      if (activeTag.value && !formulaTags(f).includes(activeTag.value)) continue
      hits.push(f)
    }
  }
  return hits
})
const activeTag = ref('')

/** 渲染 current 列表的所有公式预览：清空后用 querySelector 定位每个宿主再排版 */
async function renderAll() {
  await nextTick()
  const box = previewWrap.value
  if (!box) return
  const nodes = box.querySelectorAll<HTMLElement>('[data-latex]')
  const jobs: Promise<unknown>[] = []
  for (const node of Array.from(nodes)) {
    const latex = node.getAttribute('data-latex') || ''
    node.innerHTML = ''
    jobs.push(renderLatex(node, latex, 22, 1).catch(() => {}))
  }
  await Promise.all(jobs)
}

watch([activeKey, query, activeTag], renderAll)
onMounted(renderAll)

/** 插入：若当前选中了单个公式元素则替换其 LaTeX，否则新建一个公式元素（保位置/尺寸） */
function insert(item: FormulaItem) {
  store.clearDrawTool()
  const sel = store.selectedElement
  if (sel && sel.type === 'math') {
    store.updateElement(sel.id, { latex: item.latex } as Partial<SlideElement>)
  } else {
    // autoBox：渲染后把外框收成刚好包住公式（之后拖动即无级放大）
    store.addElement('math', { latex: item.latex, w: 620, h: 168, autoBox: true } as Partial<SlideElement>)
  }
}
</script>

<template>
  <div class="palette" @click.self="emit('close')">
    <div class="palette__box">
      <header class="palette__head">
        <div class="palette__title">
          <span class="palette__badge">∑</span>
          <div>
            <strong>预制公式库</strong>
            <small>按高中数学章节分类 · 点击插入当前页</small>
          </div>
        </div>
        <button class="palette__close" @click="emit('close')"><AppIcon name="close" :size="13" /></button>
      </header>

      <div class="cats">
        <button
          v-for="c in FORMULA_LIBRARY"
          :key="c.key"
          class="cat"
          :class="{ 'cat--on': c.key === activeKey && !query }"
          :style="{ '--accent': c.accent }"
          @click="activeKey = c.key"
        >
          <span class="cat__icon">{{ c.icon }}</span>
          <span class="cat__name">{{ c.name }}</span>
          <span class="cat__count">{{ c.formulas.length }}</span>
        </button>
      </div>

      <div class="tags">
        <button class="tag" :class="{ 'tag--on': activeTag === '' }" @click="activeTag = ''">全部</button>
        <button v-for="t in FORMULA_TAGS" :key="t" class="tag" :class="{ 'tag--on': activeTag === t }" @click="activeTag = t">{{ t }}</button>
      </div>

      <div class="search">
        <svg viewBox="0 0 24 24" width="16" height="16" class="search__icon"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <input v-model="query" class="search__input" placeholder="搜索公式，如：正弦、方差、集合…" />
        <button v-if="query" class="search__clear" @click="query = ''"><AppIcon name="close" :size="12" /></button>
      </div>

      <div v-if="query" class="search__meta">找到 {{ visible.length }} 条「{{ query }}」相关公式</div>

      <div ref="previewWrap" class="grid">
        <button
          v-for="(f, i) in visible"
          :key="activeKey + f.latex"
          class="fcard"
          :style="{ '--accent': active.accent, transitionDelay: (i * 15) + 'ms' }"
          :title="f.note ? f.label + ' —— ' + f.note : f.label"
          @click="insert(f)"
        >
          <div class="fcard__preview" :data-latex="f.latex"></div>
          <div class="fcard__label">{{ f.label }}</div>
        </button>
        <div v-if="!visible.length" class="empty">没有匹配的公式，换个关键词试试</div>
      </div>

      <footer class="palette__foot">
        <span class="palette__hint">
          {{ store.selectedElement && store.selectedElement.type === 'math'
            ? '当前选中了一个公式元素：点击卡片会替换它的内容（位置/字号保留）'
            : '点击卡片插入为「公式」元素，可再拖拽缩放 / 改颜色字号' }}
        </span>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.palette {
  position: fixed;
  inset: 0;
  z-index: 420;
  background: rgba(20, 24, 34, 0.55);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.palette__box { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: min(1080px, 94vw);
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;}
.palette__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid #eee;
  background: linear-gradient(180deg, #fbfaff, #fff);
}
.palette__title { display: flex; align-items: center; gap: 12px; }
.palette__badge {
  width: 40px; height: 40px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; color: #fff; background: linear-gradient(135deg, #8a2be2, #4b6cf0);
  box-shadow: 0 6px 16px rgba(108, 76, 224, 0.35);
}
.palette__title strong { display: block; font-size: 17px; color: #2a2a33; letter-spacing: 0.3px; }
.palette__title small { font-size: 12px; color: #8a8a94; }
.palette__close { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; flex: none; cursor: pointer; font-size: 15px; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--gray-600); transition: background var(--dur-1) var(--ease), color var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease); }
.palette__close:hover { background: #f2f2f6; color: #2a2a33; }

.cats { display: flex; gap: 8px; flex-wrap: wrap; padding: 14px 18px 6px; }
.cat {
  border: 1px solid #e7e7ef;
  background: #fff;
  color: #5b5b66;
  border-radius: 999px;
  padding: 6px 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 13px;
  transition: 0.15s;
}
.cat:hover { border-color: var(--accent); color: var(--accent); }
.cat--on {
  color: #fff;
  background: var(--accent);
  border-color: var(--accent);
  box-shadow: 0 6px 16px color-mix(in srgb, var(--accent) 40%, transparent);
}
.cat__icon { font-size: 15px; }
.cat__name { font-weight: 600; }
.cat__count {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}
.cat--on .cat__count { background: rgba(255, 255, 255, 0.24); color: #fff; }

.tags { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 18px 0; }
.tag { padding: 4px 12px; border: 1px solid #dcd9ee; background: #fff; border-radius: 14px; font-size: 12px; color: #5a5770; cursor: pointer; transition: background .12s, color .12s, border-color .12s; }
.tag:hover { background: #f1f0fb; }
.tag--on { background: #5b43ad; border-color: #5b43ad; color: #fff; }
.search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 18px;
  padding: 7px 11px;
  border: 1px solid #e7e7ef;
  border-radius: 10px;
  background: #fbfbfd;
}
.search__icon { color: #9a9aa4; flex: none; }
.search__input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 13px;
  color: #2a2a33;
  outline: none;
}
.search__input::placeholder { color: #b0b0ba; }
.search__clear {
  border: none; background: #ececf3; color: #6b6b78;
  width: 20px; height: 20px; border-radius: 50%; cursor: pointer; font-size: 13px; line-height: 1;
}
.search__meta { margin: 0 18px 4px; font-size: 12px; color: #8a8a94; }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  padding: 12px 18px 16px;
  overflow-y: auto;
}
.fcard {
  border: 1px solid #ececf3;
  border-radius: 12px;
  background: #fff;
  padding: 8px 10px;
  cursor: pointer;
  text-align: center;
  transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease, opacity 0.16s;
}
.fcard:hover {
  transform: translateY(-2px);
  border-color: var(--accent);
  box-shadow: 0 10px 24px color-mix(in srgb, var(--accent) 16%, transparent);
}
.fcard__preview {
  height: 86px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 8px;
  background: #fbfbfd;
  font-size: 22px;
}
.fcard__preview :deep(mjx-container) { display: inline-flex !important; }
.fcard__label {
  margin-top: 6px;
  font-size: 12px;
  color: #6b6b78;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.empty { grid-column: 1 / -1; text-align: center; color: #9a9aa4; font-size: 13px; padding: 28px 0; }
.palette__foot { padding: 8px 18px 14px; border-top: 1px solid #f0f0f4; }
.palette__hint { font-size: 12px; color: #9a9aa4; }
</style>
