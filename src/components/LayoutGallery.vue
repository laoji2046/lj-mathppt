<script setup lang="ts">
/**
 * 版式选择器：照 PowerPoint「Office 主题」那套做的缩略图网格。
 *
 * 说明：PPT 的版式能"保留内容重新排版"，本编辑器的元素是绝对定位的 ✗，做不到，
 * 所以套用版式会**替换该页内容**（弹窗里也写明了）。
 */
import { useDeckStore } from '@/stores/deck'
import { nextTick, ref, watch } from 'vue'
import { closeLayoutGallery, layoutGalleryAnchor, layoutGalleryIndex, layoutGalleryOpen } from '@/ui/layoutGallery'
import { placeInViewport } from '@/ui/popover'
import { SLIDE_LAYOUTS, type LayoutSlot } from '@/templates/slideLayouts'
import AppIcon from './AppIcon.vue'

const store = useDeckStore()

/**
 * 浮动时的位置：同样要**夹进视口**（缩略图靠下时整块浮窗会跑出屏幕 —— 用户实测）。
 * 锚点在"缩略图右侧"，所以先按锚点摆，再量尺寸回收。
 */
const boxEl = ref<HTMLElement | null>(null)
const floatPos = ref({ x: 0, y: 0 })
watch(
  () => [layoutGalleryOpen.value, layoutGalleryAnchor.value] as const,
  async () => {
    const a = layoutGalleryAnchor.value
    if (!layoutGalleryOpen.value || !a) return
    floatPos.value = { x: a.x, y: a.y }
    await nextTick()
    if (boxEl.value) floatPos.value = placeInViewport(boxEl.value, a.x, a.y)
  },
  { immediate: true },
)

function apply(id: string) {
  store.applyLayoutToSlide(layoutGalleryIndex.value, id)
  closeLayoutGallery()
}
/** 版式预览里色块的样式（标题深、正文浅、图片带斜线） */
function slotStyle(s: LayoutSlot) {
  return {
    left: s.x * 100 + '%',
    top: s.y * 100 + '%',
    width: s.w * 100 + '%',
    height: s.h * 100 + '%',
  }
}
</script>

<template>
  <div v-if="layoutGalleryOpen" class="lg" :class="{ 'lg--float': !!layoutGalleryAnchor }" @click.self="closeLayoutGallery()">
    <div
      class="lg__box"
      ref="boxEl"
      :style="layoutGalleryAnchor ? { position: 'fixed', left: floatPos.x + 'px', top: floatPos.y + 'px', width: 'min(680px, 92vw)', maxHeight: 'calc(100vh - ' + (layoutGalleryAnchor.y + 14) + 'px)' } : undefined"
    >
      <header class="lg__head">
        <span>版式（套用会替换本页内容）</span>
        <button class="lg__x" @click="closeLayoutGallery()"><AppIcon name="close" :size="13" /></button>
      </header>
      <div class="lg__grid">
        <button
          v-for="l in SLIDE_LAYOUTS" :key="l.id"
          class="lg__card" :title="l.label"
          @click="apply(l.id)"
        >
          <div class="lg__prev">
            <div
              v-for="(s, i) in l.slots" :key="i"
              class="lg__slot" :class="'lg__slot--' + s.kind"
              :style="slotStyle(s)"
            >
              <span v-if="s.kind === 'image'" class="lg__pic">▨</span>
            </div>
          </div>
          <span class="lg__label">{{ l.label }}</span>
        </button>
      </div>
      <p class="lg__hint">套用后本页会变成该版式的框架（标题/正文/图片为占位元素），可直接在画布上改。</p>
    </div>
  </div>
</template>

<style scoped>
.lg { position: fixed; inset: 0; z-index: 470; background: rgba(20, 24, 34, 0.55); display: flex; align-items: center; justify-content: center; }
/* 悬停菜单项弹出时：不压暗背景、贴着菜单项出现（PowerPoint 的版式浮层就是这个感觉） */
.lg--float { background: transparent; display: block; }
.lg__box { background: var(--panel); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: min(920px, 94vw); max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; }
.lg--float .lg__box { border-radius: var(--radius); width: min(680px, 92vw); }
.lg__head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); font-size: 14px; font-weight: 600; }
.lg__x { border: none; background: transparent; font-size: 18px; cursor: pointer; color: var(--muted); }
.lg__grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; padding: 16px; overflow-y: auto; }
.lg__card { border: 1px solid var(--border); background: var(--panel); border-radius: var(--radius); padding: 8px; cursor: pointer; display: flex; flex-direction: column; gap: 6px; transition: border-color var(--dur-1) var(--ease), background var(--dur-1) var(--ease); }
.lg__card:hover { border-color: var(--brand); background: var(--brand-50); }
.lg__prev { position: relative; width: 100%; aspect-ratio: 16 / 9; background: #fff; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
.lg__slot { position: absolute; border-radius: 2px; }
.lg__slot--title { background: #b9c2d0; }
.lg__slot--subtitle { background: #d5dbe4; }
.lg__slot--text { background: #e6eaf0; }
.lg__slot--image { background: #eef1f5; border: 1px dashed #b9c2d0; display: flex; align-items: center; justify-content: center; }
.lg__pic { color: #97a3b4; font-size: 16px; }
.lg__label { font-size: 12px; color: var(--text); text-align: center; }
.lg__hint { margin: 0; padding: 0 16px 14px; font-size: 11.5px; color: var(--muted); }
</style>
