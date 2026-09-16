<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { useDeckStore } from '@/stores/deck'
import {
  listDecks, saveDeckToLibrary, parseDeckBody, removeDeck, touchDeck, filterDecks, humanBytes,
} from '@/composables/useDeckLibrary'
import type { DeckEntry } from '@/composables/useDeckLibrary'

const emit = defineEmits<{ (e: 'close'): void }>()
const store = useDeckStore()

const list = ref<DeckEntry[]>([])
const loading = ref(true)
const msg = ref('')
const q = ref('')
const selectedId = ref(0)

function flash(t: string) {
  msg.value = t
  window.setTimeout(() => { if (msg.value === t) msg.value = '' }, 2600)
}

async function load() {
  loading.value = true
  try {
    list.value = await listDecks()
  } finally {
    loading.value = false
  }
}
onMounted(load)

const shown = computed(() => filterDecks(list.value, q.value))
const selected = computed(() => list.value.find((x) => x.id === selectedId.value) || null)

/** 当前课件的标题（存库时作为默认名） */
const curTitle = computed(() => {
  const t = (store.deck as { title?: string }).title
  return typeof t === 'string' && t.trim() ? t : '未命名课件'
})

/** 把当前课件存入课件库（新增一条） */
async function saveCurrent() {
  const deck = JSON.parse(JSON.stringify(store.deck))
  const id = await saveDeckToLibrary(deck, curTitle.value)
  if (!id) { flash('存入失败 —— 内容库不可用？'); return }
  await load()
  selectedId.value = id
  flash('已存入课件库：' + curTitle.value)
}

/** 用当前课件覆盖选中的那一条 */
async function overwrite() {
  const x = selected.value
  if (!x) { flash('先选一条要覆盖的课件'); return }
  const deck = JSON.parse(JSON.stringify(store.deck))
  const id = await saveDeckToLibrary(deck, curTitle.value, x.id)
  if (!id) { flash('覆盖失败'); return }
  await load()
  flash('已用当前课件覆盖「' + x.title + '」')
}

/** 打开：替换当前课件（store.importDeck 会自动备份当前内容，可 Ctrl+Z 撤销） */
async function open(it: DeckEntry) {
  const deck = parseDeckBody(it)
  if (!deck) { flash('这条课件的 JSON 解析失败'); return }
  const ok = store.importDeck(deck)
  if (!ok) { flash('导入失败：不是有效的课件 JSON'); return }
  void touchDeck(it.id)
  flash('已打开「' + it.title + '」')
  emit('close')
}

async function del(it: DeckEntry) {
  const ok = await removeDeck(it.id)
  if (!ok) { flash('删除失败') ; return }
  if (selectedId.value === it.id) selectedId.value = 0
  await load()
  flash('已删除')
}

function close() { emit('close') }
</script>

<template>
  <Teleport to="body">
    <div class="dl" @mousedown.self="close">
      <div class="dl__box">
        <div class="dl__head">
          <div class="dl__title">课件库<em>（存过的整份课件；打开会替换当前内容，可用 Ctrl+Z 撤销）</em></div>
          <div class="dl__tools">
            <button class="dl__btn dl__btn--pri" title="把当前课件存入课件库" @click="saveCurrent">＋ 存入当前课件</button>
            <button class="dl__btn" title="用当前课件覆盖选中的那一条" @click="overwrite">覆盖选中</button>
            <button class="dl__close" title="关闭" @click="close"><AppIcon name="close" :size="14" /></button>
          </div>
        </div>
        <div class="dl__bar">
          <input v-model="q" class="dl__search" type="text" placeholder="按标题搜索课件…" />
          <span class="dl__count">{{ shown.length }} / {{ list.length }}</span>
        </div>
        <div class="dl__body">
          <div class="dl__list">
            <div v-if="loading" class="dl__empty">正在读取课件库…</div>
            <div v-else-if="!shown.length" class="dl__empty">还没有存过课件。点右上角「＋ 存入当前课件」。</div>
            <button v-for="x in shown" :key="x.id" class="dl__item" :class="{ 'dl__item--on': x.id === selectedId }" @click="selectedId = x.id" @dblclick="open(x)">
              <span class="dl__it">{{ x.title }}</span>
              <span class="dl__im">{{ x.slideCount }} 页 · {{ humanBytes(x.bytes) }}</span>
            </button>
          </div>
          <div class="dl__detail">
            <template v-if="selected">
              <div class="dl__vtitle">{{ selected.title }}</div>
              <div class="dl__vmeta">{{ selected.slideCount }} 页 · {{ humanBytes(selected.bytes) }} · 用过 {{ selected.usedCount }} 次</div>
              <div class="dl__actions">
                <button class="dl__btn dl__btn--pri" @click="open(selected)">打开（替换当前课件）</button>
                <button class="dl__btn" @click="overwrite">用当前课件覆盖</button>
                <button class="dl__btn dl__btn--danger" @click="del(selected)">删除</button>
              </div>
              <div class="dl__hint">双击左侧任意一条也能直接打开。</div>
            </template>
            <div v-else class="dl__empty">左侧选一份课件。</div>
          </div>
        </div>
        <div class="dl__foot">
          <span v-if="msg" class="dl__msg">{{ msg }}</span>
          <span v-else class="dl__fhint">课件存在本地内容库里（%APPDATA%\lj-mathslides\library.db），不受浏览器存储上限限制</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ⚠ 从工具栏打开，但工具栏之外还可能有试卷等弹层；给足层级更稳 */
.dl { position: fixed; inset: 0; z-index: 3400; background: rgba(20, 20, 28, .42); display: flex; align-items: center; justify-content: center; }
.dl__box { width: 900px; max-width: 94vw; height: 78vh; background: var(--surface, #fff); border-radius: 12px; box-shadow: 0 18px 60px rgba(0,0,0,.28); display: flex; flex-direction: column; overflow: hidden; }
.dl__head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border, #e8e8f0); }
.dl__title { font-weight: 700; }
.dl__title em { font-style: normal; font-weight: 400; font-size: 12px; color: var(--muted, #888); margin-left: 8px; }
.dl__tools { display: flex; align-items: center; gap: 8px; }
.dl__close { border: 0; background: none; cursor: pointer; color: var(--muted, #888); }
.dl__bar { display: flex; align-items: center; gap: 10px; padding: 10px 16px 8px; }
.dl__search { flex: 1; padding: 7px 10px; border: 1px solid #dcdce6; border-radius: 8px; font-size: 13px; }
.dl__count { font-size: 12px; color: var(--muted, #888); }
.dl__body { flex: 1; display: flex; min-height: 0; border-top: 1px solid var(--border, #e8e8f0); }
.dl__list { width: 320px; flex: none; overflow: auto; border-right: 1px solid var(--border, #e8e8f0); padding: 8px; }
.dl__item { display: flex; flex-direction: column; gap: 3px; width: 100%; text-align: left; border: 1px solid transparent; background: none; padding: 8px 10px; border-radius: 8px; cursor: pointer; }
.dl__item:hover { background: #f6f6fb; }
.dl__item--on { background: #efeaff; border-color: #b9a9f0; }
.dl__it { font-size: 13px; font-weight: 600; }
.dl__im { font-size: 11.5px; color: var(--muted, #888); }
.dl__detail { flex: 1; min-width: 0; overflow: auto; padding: 14px 16px; }
.dl__empty { color: var(--muted, #888); font-size: 13px; padding: 16px; }
.dl__vtitle { font-weight: 700; margin-bottom: 6px; }
.dl__vmeta { font-size: 12px; color: var(--muted, #888); margin-bottom: 12px; }
.dl__actions { display: flex; flex-wrap: wrap; gap: 8px; }
.dl__btn { border: 1px solid #dcdce6; background: #fff; border-radius: 8px; padding: 6px 12px; font-size: 13px; cursor: pointer; }
.dl__btn--pri { background: var(--brand-600, #534ab7); border-color: var(--brand-600, #534ab7); color: #fff; }
.dl__btn--danger { color: #d92d20; border-color: #f4c9c5; }
.dl__hint { font-size: 12px; color: var(--muted, #999); margin-top: 10px; }
.dl__foot { padding: 8px 16px; border-top: 1px solid var(--border, #e8e8f0); font-size: 12px; min-height: 18px; }
.dl__msg { color: var(--brand-700, #4b3fa8); }
.dl__fhint { color: var(--muted, #999); }
</style>
