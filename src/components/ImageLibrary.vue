<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { useDeckStore } from '@/stores/deck'
import type { SlideElement } from '@/types'

const store = useDeckStore()
const emit = defineEmits<{ (e: 'close'): void }>()

const keyword = ref('')
const cats = ['背景', '几何', '数学', '图表', '自然', '科技', '校园', '人物', '城市', '食物', '运动', '抽象', '动物', '色彩']
const COUNT = 12

interface Thumb { id: string; url: string; full: string; ok: boolean; failed: boolean }
const thumbs = ref<Thumb[]>([])
const batch = ref('')
const preview = ref<string | null>(null)

function confirmPreview() { if (preview.value) insertUrl(preview.value); preview.value = null }

/** 用 picsum.seed 生成一批缩略图（稳定、快；换一批刷新）。prefix 关联关键词/分类以增加变化。 */
function regenerate(prefix: string) {
  batch.value = Math.floor(Math.random() * 1e9).toString(36)
  const arr: Thumb[] = []
  for (let i = 0; i < COUNT; i++) {
    const seed = (prefix + '-' + batch.value + '-' + i).replace(/[\s/?#]/g, '')
    arr.push({
      id: batch.value + '-' + i,
      url: 'https://picsum.photos/seed/' + seed + '/400/300',
      full: 'https://picsum.photos/seed/' + seed + '/1200/900',
      ok: true,
      failed: false,
    })
  }
  thumbs.value = arr
}
function loadRandom() { regenerate('mix') }
function byCat(c: string) { regenerate('cat-' + encodeURIComponent(c)) }
function doSearch() {
  if (!keyword.value.trim()) return
  regenerate('kw-' + encodeURIComponent(keyword.value.trim()))
}
function onErr(t: Thumb) { t.failed = true; t.ok = false }

function insertUrl(full: string) {
  const img = new Image()
  let w = 0, h = 0
  img.onload = () => { w = img.naturalWidth; h = img.naturalHeight; place(full, w, h) }
  img.onerror = () => place(full, 900, 600)
  img.src = full
}
function place(full: string, w: number, h: number) {
  let W = w || 640, H = h || 420
  const f = Math.min(900 / W, 620 / H)
  if (f < 1 && f > 0) { W = Math.round(W * f); H = Math.round(H * f) }
  store.clearDrawTool()
  store.addElement('image', { src: full, w: W, h: H, fit: 'contain' } as Partial<SlideElement>)
  emit('close')
}

onMounted(loadRandom)
</script>

<template>
  <div class="palette" @click.self="emit('close')">
    <div class="palette__box">
      <div class="palette__head">
        <span>在线图片库</span>
        <button class="palette__close" @click="emit('close')"><AppIcon name="close" :size="13" /></button>
      </div>

      <div class="lib-search">
        <input v-model="keyword" class="lib-input" placeholder="关键词，如：函数图像 / 几何 / 背景"
          @keydown.enter="doSearch" />
        <button class="lib-btn" :disabled="!keyword.trim()" @click="doSearch">搜索</button>
        <button class="lib-btn" @click="loadRandom" title="换一批">🎲 随机</button>
      </div>

      <div class="lib-cats">
        <button v-for="c in cats" :key="c" class="lib-cat" @click="byCat(c)">{{ c }}</button>
      </div>

      <div class="lib-grid">
        <button v-for="t in thumbs" :key="t.id" class="thumb" :class="{ 'thumb--fail': t.failed }" @click="t.ok && (preview = t.full)">
          <img v-if="t.ok" :src="t.url" class="thumb__img" loading="lazy" alt="" draggable="false" @error="onErr(t)" />
          <div v-else class="thumb__ph">加载失败</div>
          <span class="thumb__add"><AppIcon name="plus" :size="22" /></span>
        </button>
      </div>

      <div class="palette__hint">点击缩略图预览大图再插入；「随机/分类/搜索」会换一批。图源：picsum.photos（需联网）。</div>
    </div>

    <!-- 大图预览灯箱 -->
    <div v-if="preview" class="lb" @click.self="preview = null">
      <div class="lb__box">
        <img :src="preview" class="lb__img" alt="预览" draggable="false" />
        <div class="lb__bar">
          <span class="lb__hint">预览大图，点击「插入」放入幻灯片</span>
          <div class="lb__actions">
            <button class="lb__btn" @click="preview = null">取消</button>
            <button class="lb__btn lb__btn--primary" @click="confirmPreview">插入此图</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.palette { position: fixed; inset: 0; z-index: 400; background: rgba(20, 24, 34, 0.55); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; }
.palette__box { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); padding: 14px 16px; max-width: 620px; width: 92vw; max-height: 82vh; display: flex; flex-direction: column; overflow: hidden;}
.palette__head { display: flex; align-items: center; justify-content: space-between; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; color: var(--text); margin-bottom: 14px; }
.palette__close { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; flex: none; cursor: pointer; font-size: 15px; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--gray-600); transition: background var(--dur-1) var(--ease), color var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease); }
.palette__close:hover { background: var(--danger-soft); border-color: var(--danger-border); color: var(--danger); }
.lib-search { display: flex; gap: 6px; margin-bottom: 10px; }
.lib-input { flex: 1; box-sizing: border-box; padding: 6px 8px; border: 1px solid var(--border-strong); border-radius: 5px; font-size: 13px; }
.lib-btn { padding: 6px 10px; border: 1px solid var(--border-strong); background: #fff; border-radius: 5px; cursor: pointer; font-size: 13px; white-space: nowrap; }
.lib-btn:hover:not(:disabled) { background: var(--brand-soft); }
.lib-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.lib-cats { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.lib-cat { padding: 4px 12px; border: 1px solid var(--border-strong); background: #fff; border-radius: 14px; font-size: 13px; cursor: pointer; }
.lib-cat:hover { background: var(--brand-soft); border-color: var(--brand); }

.lib-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  overflow-y: auto;
  padding: 2px 2px 4px;
}
.thumb {
  position: relative;
  aspect-ratio: 4 / 3;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: #f3f2ee;
  overflow: hidden;
  cursor: pointer;
  padding: 0;
  transition: transform 0.14s ease, box-shadow 0.14s ease, border-color 0.14s ease;
}
.thumb:hover { transform: translateY(-2px); border-color: var(--brand); box-shadow: 0 8px 18px rgba(0, 0, 0, 0.16); }
.thumb__img { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumb__add {
  position: absolute; right: 6px; bottom: 6px;
  width: 22px; height: 22px; border-radius: 50%;
  background: rgba(138, 43, 226, 0.9); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 15px; opacity: 0; transition: opacity 0.14s;
  pointer-events: none;
}
.thumb:hover .thumb__add { opacity: 1; }
.thumb__ph {
  width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
  color: #999; font-size: 12px; background: #f0efec;
}
.palette__hint { margin-top: 10px; font-size: 12px; color: var(--muted); }
.lb { position: fixed; inset: 0; z-index: 50; background: rgba(10, 14, 22, 0.72); display: flex; align-items: center; justify-content: center; }
.lb__box { background: #fff; border-radius: 12px; box-shadow: 0 24px 70px rgba(0,0,0,0.45); max-width: 78vw; max-height: 84vh; display: flex; flex-direction: column; overflow: hidden; }
.lb__img { display: block; max-width: 78vw; max-height: 68vh; object-fit: contain; }
.lb__bar { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-top: 1px solid #eee; }
.lb__hint { font-size: 12px; color: #999; flex: 1; }
.lb__actions { display: flex; gap: 8px; }
.lb__btn { border: 1px solid #ddd; background: #fff; color: #333; border-radius: 7px; padding: 7px 16px; cursor: pointer; font-size: 13px; }
.lb__btn:hover { background: #f5f5f7; }
.lb__btn--primary { background: #8a2be2; border-color: #8a2be2; color: #fff; }
.lb__btn--primary:hover { background: #7a25c9; }
</style>
