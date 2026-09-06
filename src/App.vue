<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDeckStore } from '@/stores/deck'
import { captureDesmosState } from '@/composables/useDesmos'
import type { DesmosElement, SlideElement } from '@/types'
import TopToolbar from '@/components/TopToolbar.vue'
import EditToolbar from '@/components/EditToolbar.vue'
import SlideList from '@/components/SlideList.vue'
import EditorCanvas from '@/components/EditorCanvas.vue'
import PropertyPanel from '@/components/PropertyPanel.vue'
import PresentationOverlay from '@/components/PresentationOverlay.vue'
import PaperModal from '@/components/PaperModal.vue'
import GgbSuite from '@/components/GgbSuite.vue'
import TemplatePicker from '@/components/TemplatePicker.vue'
import { ggbEdit, openGgbSuite, closeGgbSuite } from '@/ui/ggbEditor'
import ImageEditorModal from '@/components/ImageEditorModal.vue'
import { imageEditOpen, imageEditId, closeImageEditor } from '@/ui/imageEditor'
import { tplOpen, tplMode, openTemplateLibrary, closeTemplateLibrary } from '@/ui/templateLibrary'
import ContextMenu from '@/components/ContextMenu.vue'

const store = useDeckStore()
const presenting = ref(false)
const paperOpen = ref(false)

function onKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null
  const typing = target?.isContentEditable ||
    target?.tagName === 'INPUT' ||
    target?.tagName === 'SELECT' ||
    target?.tagName === 'TEXTAREA'
  if (typing) return

  const mod = e.ctrlKey || e.metaKey
  const k = e.key.toLowerCase()

  if (mod && k === 'z') {
    e.preventDefault()
    if (e.shiftKey) store.redo()
    else store.undo()
    return
  }
  if (mod && k === 'y') {
    e.preventDefault()
    store.redo()
    return
  }
  if (mod && k === 'a') {
    e.preventDefault()
    store.setSelection((store.currentSlide?.elements ?? []).map((el) => el.id))
    return
  }
  if (mod && e.shiftKey && k === 'n') {
    e.preventDefault()
    store.addSlide()
    return
  }
  if (mod && k === 'g') {
    e.preventDefault()
    if (e.shiftKey) store.ungroup()
    else store.groupSelection()
    return
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && store.selectionCount > 0) {
    e.preventDefault()
    store.removeSelected()
    return
  }
  if (e.key === 'Escape') {
    store.clearSelection()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

/**
 * 把画布上 Desmos 计算器里的当前内容写回场景图。
 *
 * 用户在计算器里输入的表达式只存在 Desmos 实例内部，而演示/导出读的是场景图，
 * 不回写的话幻灯片里只会剩一个空计算器。
 *
 * @param onlyIds 只回写这些元素（用于「取消选中即保存」），不传则回写当前页全部
 */
function flushDesmos(onlyIds?: string[]) {
  const els = (store.currentSlide?.elements ?? []).filter(
    (e): e is DesmosElement => e.type === 'desmos',
  )
  for (const e of els) {
    if (onlyIds && !onlyIds.includes(e.id)) continue
    const s = captureDesmosState(e.id)
    if (s && s !== e.state) store.updateElement(e.id, { state: s } as Partial<SlideElement>)
  }
}

// 选中项变化：把刚失去选中的 Desmos 元素存起来（点画布空白处即可保存）
watch(
  () => store.selectedIds.map((i) => i).join(','),
  (_next, prev) => flushDesmos(prev ? prev.split(',') : []),
)

function onPresent() {
  // 演示前兜底保存一次，避免「刚输完公式没点别处就演示」丢内容
  flushDesmos()
  // 应用内全屏演示：不再 window.open（Tauri 不允许新开窗口）
  presenting.value = true
}
</script>

<template>
  <div class="app">
    <TopToolbar @present="onPresent" @open-templates="openTemplateLibrary('replace')" @open-paper="paperOpen = true" @open-ggb-suite="openGgbSuite()" />
    <EditToolbar />
    <div class="app__body">
      <SlideList />
      <EditorCanvas :presenting="presenting" />
      <PropertyPanel />
    </div>
    <PresentationOverlay
      :deck="presenting ? store.deck : null"
      @close="presenting = false"
    />
    <TemplatePicker v-if="tplOpen" :mode="tplMode" @close="closeTemplateLibrary()" />
    <PaperModal v-if="paperOpen" @close="paperOpen = false" />
    <GgbSuite v-if="ggbEdit.open" :edit-id="ggbEdit.editId" @close="closeGgbSuite()" />
    <ImageEditorModal v-if="imageEditOpen && imageEditId" :id="imageEditId" @close="closeImageEditor()" />
    <ContextMenu />
  </div>
</template>

<style scoped>
.app {
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  background: var(--bg);
}
/* 顶部品牌渐变细条：紫 → 靛 → 暖橙点缀，压到 2px，不抢工具栏视觉 */
.app::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  z-index: 20;
  background: linear-gradient(90deg,
    var(--brand-600) 0%,
    var(--brand-400) 28%,
    #6366f1 52%,
    var(--brand-500) 76%,
    #f59e0b 100%);
}
.app__body {
  flex: 1;
  display: flex;
  min-height: 0;
}
</style>