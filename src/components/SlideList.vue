<script setup lang="ts">
import { ref } from 'vue'
import { useDeckStore } from '@/stores/deck'
import { useContextMenu, type MenuItem } from '@/composables/useContextMenu'
import { openLayoutGallery } from '@/ui/layoutGallery'
import SlideThumb from './SlideThumb.vue'
import AppIcon from './AppIcon.vue'

const store = useDeckStore()
const { openMenu } = useContextMenu()

const THUMB_W = 168

// ---- 拖拽排序 ----
const dragFrom = ref<number | null>(null)
const dragOver = ref<number | null>(null)
function onDragStart(i: number, e: DragEvent) {
  dragFrom.value = i
  dragOver.value = i
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(i))
  }
}
function onDragOver(i: number, e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  if (dragOver.value !== i) dragOver.value = i
}
function onDrop(i: number, e: DragEvent) {
  e.preventDefault()
  const from = dragFrom.value
  if (from !== null && from !== i) store.reorderSlide(from, i)
  resetDrag()
}
function onDragEnd() { resetDrag() }
function resetDrag() { dragFrom.value = null; dragOver.value = null }
function onSlideCtx(i: number, e: MouseEvent) {
  e.preventDefault()
  // 右键要同时把这一页选中（PPT 就是这个行为），后面的操作都作用在它身上
  store.gotoSlide(i)
  const s = store.deck.slides[i]
  const isSub = !!s?.parentId
  const hasClip = !!store.slideClip?.length
  const items: MenuItem[] = [
    { label: '剪切', hint: 'Ctrl+X', disabled: store.slideCount <= 1, onClick: () => store.cutSlideToClip(i) },
    { label: '复制', hint: 'Ctrl+C', onClick: () => store.copySlideToClip(i) },
    { label: '粘贴', hint: 'Ctrl+V', disabled: !hasClip, onClick: () => store.pasteSlideAt(i) },
    { sep: true, label: '', onClick: () => {} },
    { label: '新建幻灯片', onClick: () => { store.addSlide(); } },
    { label: '创建副本', onClick: () => store.copySlide(i) },
    { label: '删除幻灯片', danger: true, disabled: store.slideCount <= 1, onClick: () => store.removeSlide(i) },
    { sep: true, label: '', onClick: () => {} },
    {
      label: '版式…',
      hint: '版式库',
      // 鼠标一落上来就把版式库弹出来（贴在菜单右边），不用再点一下
      hover: (el) => openLayoutGallery(i, el),
      onClick: () => openLayoutGallery(i),
    },
    { label: '重设幻灯片（清空内容、恢复白底）', onClick: () => store.resetSlide(i) },
    { sep: true, label: '', onClick: () => {} },
    { label: s?.hidden ? '取消隐藏幻灯片' : '隐藏幻灯片', onClick: () => store.toggleSlideHidden(i) },
    { label: '上移', onClick: () => store.moveSlide(i, -1), disabled: i === 0 },
    { label: '下移', onClick: () => store.moveSlide(i, 1), disabled: i === store.slideCount - 1 },
  ]
  if (isSub) items.push({ label: '取消子页', onClick: () => store.setSlideSubpage(i, false) })
  else if (i > 0) items.push({ label: '设为子页', onClick: () => store.setSlideSubpage(i, true) })
  // （"删除此页"已并入上面的 PPT 分组，这里不再重复一项）
  openMenu(e.clientX, e.clientY, items)
}
</script>

<template>
  <div class="slides">
    <div
      v-for="(s, i) in store.deck.slides"
      :key="s.id"
      class="slide-item"
      :class="{
        'slide-item--active': i === store.currentIndex,
        'slide-item--dragover': dragOver === i && dragFrom !== null && dragFrom !== i,
        'slide-item--sub': !!s.parentId,
        'slide-item--hidden': !!s.hidden,
      }"
      draggable="true"
      @click="store.gotoSlide(i)"
      @contextmenu.prevent="onSlideCtx(i, $event)"
      @dragstart="onDragStart(i, $event)"
      @dragover="onDragOver(i, $event)"
      @drop="onDrop(i, $event)"
      @dragend="onDragEnd"
    >
      <span class="slide-num">{{ i + 1 }}</span>
      <span v-if="s.parentId" class="slide-sub">↳ 子页</span>
      <span v-if="s.hidden" class="slide-sub">隐藏</span>
      <div class="slide-thumb" style="width:100%;height:100%">
        <SlideThumb :slide="s" :width="THUMB_W" />
      </div>
      <div class="slide-tools">
        <button class="slide-tool" title="复制此页" @click.stop="store.copySlide(i)"><AppIcon name="copy" :size="13" /></button>
        <button class="slide-tool" title="上移" :disabled="i === 0" @click.stop="store.moveSlide(i, -1)"><AppIcon name="up" :size="13" /></button>
        <button class="slide-tool" title="下移" :disabled="i === store.slideCount - 1" @click.stop="store.moveSlide(i, 1)"><AppIcon name="down" :size="13" /></button>
        <button v-if="store.slideCount > 1" class="slide-tool slide-tool--del" title="删除此页" @click.stop="store.removeSlide(i)"><AppIcon name="trash" :size="13" /></button>
      </div>
    </div>

    <button class="add-slide" @click="store.addSlide()"><AppIcon name="plus" :size="14" /> 新页面</button>
  </div>
</template>

<style scoped>
.slides {
  width: 216px;
  flex: none;
  border-right: 1px solid var(--border);
  background: var(--panel-2);
  overflow-y: auto;
  padding: 12px;
}

/* ---------- 单页卡片 ---------- */
.slide-item {
  position: relative;
  margin-bottom: 12px;
  cursor: pointer;
  border-radius: var(--radius);
  transition: transform var(--dur-1) var(--ease);
}
.slide-item--drag { opacity: 0.55; }
.slide-item--sub { margin-left: 12px; }
/* 隐藏幻灯片：编辑器里仍在（能右键取消隐藏），只是变暗提示不参与放映 */
.slide-item--hidden { opacity: 0.45; }
.slide-item--hidden .slide-thumb { filter: grayscale(0.7); }

.slide-thumb {
  position: relative;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  overflow: hidden;
  box-sizing: border-box;
  background: #fff;
  box-shadow: var(--shadow-xs);
  transition: box-shadow var(--dur-2) var(--ease), border-color var(--dur-2) var(--ease),
              transform var(--dur-2) var(--ease);
}
.slide-item:hover .slide-thumb {
  transform: translateY(-1px);
  box-shadow: var(--shadow);
  border-color: var(--gray-400);
}
.slide-item--dragover .slide-thumb {
  border-color: var(--brand-400);
  box-shadow: 0 0 0 2px var(--brand-100), var(--shadow-sm);
}
.slide-item--active .slide-thumb {
  border-color: transparent;
  box-shadow: 0 0 0 2px var(--brand-600), var(--shadow);
}

/* ---------- 覆盖徽标 ---------- */
.slide-num {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 2;
  min-width: 20px;
  height: 19px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  background: rgba(34, 34, 42, 0.74);
  color: #fff;
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.slide-item--active .slide-num { background: var(--brand-600); }
.slide-sub {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  height: 19px;
  padding: 0 7px;
  display: inline-flex;
  align-items: center;
  border-radius: var(--radius-full);
  background: var(--brand-600);
  color: #fff;
  font-size: 10px;
  font-weight: 500;
  line-height: 1;
}

/* ---------- 悬浮操作 ---------- */
.slide-tools {
  position: absolute;
  right: 6px;
  bottom: 6px;
  z-index: 2;
  display: flex;
  gap: 3px;
  opacity: 0;
  transform: translateY(2px);
  transition: opacity var(--dur-1) var(--ease), transform var(--dur-1) var(--ease);
}
.slide-item:hover .slide-tools,
.slide-item:focus-within .slide-tools { opacity: 1; transform: translateY(0); }
.slide-tool {
  width: 22px;
  height: 22px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.96);
  border-radius: var(--radius-sm);
  color: var(--gray-700);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
  box-shadow: var(--shadow-xs);
  transition: background var(--dur-1) var(--ease), color var(--dur-1) var(--ease),
              border-color var(--dur-1) var(--ease), transform var(--dur-1) var(--ease);
}
.slide-tool:hover:not(:disabled) {
  background: var(--brand-50);
  border-color: var(--brand-200);
  color: var(--brand-700);
  transform: translateY(-1px);
}
.slide-tool:disabled { opacity: 0.32; cursor: not-allowed; }
.slide-tool--del { color: var(--danger); }
.slide-tool--del:hover:not(:disabled) {
  background: var(--danger-soft);
  border-color: var(--danger-border);
  color: var(--danger);
}

/* ---------- 新建页 ---------- */
.add-slide {
  width: 100%;
  height: 38px;
  padding: 0;
  border: 1.5px dashed var(--border-strong);
  background: var(--panel);
  border-radius: var(--radius);
  cursor: pointer;
  color: var(--muted);
  font-size: 13px;
  font-weight: 500;
  transition: background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease),
              color var(--dur-1) var(--ease);
}
.add-slide:hover {
  background: var(--brand-50);
  border-color: var(--brand-300);
  border-style: solid;
  color: var(--brand-700);
}
</style>