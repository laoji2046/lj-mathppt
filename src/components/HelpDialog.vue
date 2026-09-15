<script setup lang='ts'>
/**
 * 使用帮助弹窗：左侧目录（含搜索）+ 右侧正文。
 *
 * 正文来自 src/help/topics.ts 的结构化块 ✓ —— 这里只用 v-for / v-if 渲染 ✓，
 * **不用 v-html** ✗（既没有转义/注入问题 ✓，写内容时也不必手写标签 ✓）。
 */
import { computed, onMounted, ref } from 'vue'
import { HELP_TOPICS, type HelpBlock, type HelpTopic } from '@/help/topics'
import AppIcon from './AppIcon.vue'

const emit = defineEmits<{ (e: 'close'): void }>()
const q = ref('')
const activeId = ref(HELP_TOPICS[0].id)

function blockText(b: HelpBlock): string {
  if (b.t === 'img') return b.caption || ''
  if (b.t === 'ul' || b.t === 'ol' || b.t === 'keys') return b.v.join(' ')
  return b.v
}
function topicText(t: HelpTopic): string {
  return (t.section + ' ' + t.title + ' ' + t.tags.join(' ') + ' ' + t.body.map(blockText).join(' ')).toLowerCase()
}

const filtered = computed(() => {
  const k = q.value.trim().toLowerCase()
  if (!k) return HELP_TOPICS
  return HELP_TOPICS.filter((t) => topicText(t).includes(k))
})
/** 按章节分组（保持原顺序 ✓） */
const groups = computed(() => {
  const m = new Map<string, HelpTopic[]>()
  for (const t of filtered.value) {
    if (!m.has(t.section)) m.set(t.section, [])
    m.get(t.section)!.push(t)
  }
  return [...m.entries()]
})
const active = computed<HelpTopic>(() => {
  const a = HELP_TOPICS.find((t) => t.id === activeId.value)
  if (a && filtered.value.includes(a)) return a
  return filtered.value[0] || HELP_TOPICS[0]
})
function pick(id: string) { activeId.value = id }
/** 截图地址：走 BASE_URL ✓（dev 与打包后都能找到 public/help 下的文件 ✓） */
function imgUrl(name: string) { return import.meta.env.BASE_URL + 'help/' + name + '.png' }
function close() { emit('close') }
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close() }
onMounted(() => document.addEventListener('keydown', onKey))
</script>

<template>
  <div class='hp' @mousedown.self='close'>
    <div class='hp__box'>
      <header class='hp__head'>
        <div class='hp__title'><AppIcon name='info' :size='15' /> 使用帮助</div>
        <input v-model='q' class='hp__search' placeholder='搜索：公式 / 导出 / 快捷键 / 导入…' />
        <button class='hp__x' @click='close'>×</button>
      </header>
      <div class='hp__body'>
        <nav class='hp__nav'>
          <template v-for='[sec, list] in groups' :key='sec'>
            <div class='hp__sec'>{{ sec }}</div>
            <button
              v-for='t in list'
              :key='t.id'
              class='hp__item'
              :class="{ 'hp__item--on': t.id === active.id }"
              @click='pick(t.id)'
            >{{ t.title }}</button>
          </template>
          <div v-if='!filtered.length' class='hp__empty'>没有匹配的条目，换个词试试</div>
        </nav>
        <article class='hp__main'>
          <div class='hp__crumb'>{{ active.section }}</div>
          <h2 class='hp__h2'>{{ active.title }}</h2>
          <template v-for='(b, i) in active.body' :key='i'>
            <p v-if="b.t === 'p'" class='hp__p'>{{ b.v }}</p>
            <h3 v-else-if="b.t === 'h'" class='hp__h3'>{{ b.v }}</h3>
            <ul v-else-if="b.t === 'ul'" class='hp__ul'>
              <li v-for='(x, j) in b.v' :key='j'>{{ x }}</li>
            </ul>
            <ol v-else-if="b.t === 'ol'" class='hp__ul hp__ol'>
              <li v-for='(x, j) in b.v' :key='j'>{{ x }}</li>
            </ol>
            <div v-else-if="b.t === 'keys'" class='hp__keys'>
              <kbd class='hp__kbd'>{{ b.v[0] }}</kbd>
              <span v-if='b.v[1]'>{{ b.v[1] }}</span>
            </div>
            <div v-else-if="b.t === 'note'" class='hp__note'>{{ b.v }}</div>
            <div v-else-if="b.t === 'warn'" class='hp__warn'>{{ b.v }}</div>
            <figure v-else-if="b.t === 'img'" class='hp__fig'>
              <img :src='imgUrl(b.v)' :alt='b.caption || b.v' loading='lazy' />
              <figcaption v-if='b.caption'>{{ b.caption }}</figcaption>
            </figure>
          </template>
        </article>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hp { position: fixed; inset: 0; z-index: 600; background: rgba(20, 24, 34, 0.55); display: flex; align-items: center; justify-content: center; }
.hp__box { background: var(--panel); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: min(1020px, 95vw); height: min(760px, 86vh); display: flex; flex-direction: column; overflow: hidden; }
.hp__head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--border); }
.hp__title { font-weight: 700; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.hp__search { flex: 1 1 auto; height: 30px; padding: 0 10px; font-size: 13px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); }
.hp__x { border: none; background: transparent; font-size: 18px; cursor: pointer; color: var(--muted); }
.hp__body { flex: 1 1 auto; min-height: 0; display: flex; }
.hp__nav { width: 236px; flex: 0 0 236px; overflow-y: auto; border-right: 1px solid var(--border); padding: 8px 6px 16px; }
.hp__sec { font-size: 12px; font-weight: 700; color: var(--brand); margin: 10px 0 4px 6px; }
.hp__item { display: block; width: 100%; text-align: left; border: none; background: transparent; padding: 6px 8px; border-radius: var(--radius); font-size: 13px; cursor: pointer; color: var(--text); }
.hp__item:hover { background: var(--brand-50); }
.hp__item--on { background: var(--brand-50); color: var(--brand); font-weight: 600; }
.hp__empty { font-size: 12px; color: var(--muted); padding: 10px; }
.hp__main { flex: 1 1 auto; min-width: 0; overflow-y: auto; padding: 16px 22px 40px; }
.hp__crumb { font-size: 12px; color: var(--muted); }
.hp__h2 { font-size: 19px; margin: 4px 0 12px; }
.hp__h3 { font-size: 14px; margin: 16px 0 6px; color: var(--text); }
.hp__p { font-size: 13.5px; line-height: 1.85; margin: 8px 0; color: var(--text-2); }
.hp__ul { font-size: 13.5px; line-height: 1.85; margin: 6px 0 10px; padding-left: 20px; color: var(--text-2); }
.hp__ol { list-style: decimal; }
.hp__keys { display: flex; align-items: center; gap: 10px; font-size: 13px; padding: 4px 0; color: var(--text-2); }
.hp__kbd { font-family: var(--font-mono); font-size: 12px; background: var(--bg); border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 6px; padding: 2px 7px; white-space: nowrap; }
.hp__note { font-size: 13px; line-height: 1.8; margin: 10px 0; padding: 9px 12px; border-radius: var(--radius); background: #eff5ff; border-left: 3px solid #1668e0; color: #1c3d6e; }
.hp__fig { margin: 14px 0; }
.hp__fig img { max-width: 100%; border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-sm); display: block; }
.hp__fig figcaption { font-size: 12px; color: var(--muted); margin-top: 6px; text-align: center; }
.hp__warn { font-size: 13px; line-height: 1.8; margin: 10px 0; padding: 9px 12px; border-radius: var(--radius); background: #fff6ec; border-left: 3px solid #e8871e; color: #7a4a10; }
</style>