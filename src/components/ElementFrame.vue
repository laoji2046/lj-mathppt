<script setup lang="ts">
import { computed } from 'vue'
import type { SlideElement } from '@/types'
import { HANDLES, type Handle } from '@/composables/useDragResize'
import { openShapeEdit } from '@/ui/shapeEditor'
import { useDeckStore } from '@/stores/deck'
import { useContextMenu } from '@/composables/useContextMenu'
import TextElement from './elements/TextElement.vue'
import ShapeElement from './elements/ShapeElement.vue'
import ImageElement from './elements/ImageElement.vue'
import MathElement from './elements/MathElement.vue'
import GeoGebraElement from './elements/GeoGebraElement.vue'
import DesmosElement from './elements/DesmosElement.vue'
import LineElement from './elements/LineElement.vue'
import ArrowElement from './elements/ArrowElement.vue'
import PenElement from './elements/PenElement.vue'
import MathFigureElement from './elements/MathFigureElement.vue'
import ChartElement from './elements/ChartElement.vue'
import TableElement from './elements/TableElement.vue'
import IconElement from './elements/IconElement.vue'
import EmbedElement from './elements/EmbedElement.vue'
import RichTextElement from './elements/RichTextElement.vue'

/**
 * 元素外壳：只负责渲染、选中态与把手，
 * 拖拽/缩放逻辑统一由 EditorCanvas 掌管（它才知道整个选区）。
 */
const props = defineProps<{
  el: SlideElement
  selected: boolean
  /** 多选时隐藏缩放把手，只允许整体移动 */
  showHandles: boolean
  z: number
}>()

const emit = defineEmits<{
  (e: 'grab', payload: { ev: PointerEvent; mode: 'move' | 'resize'; handle: Handle }): void
  (e: 'update', id: string, patch: Partial<SlideElement>): void
}>()

const store = useDeckStore()
const { openMenu } = useContextMenu()
/** 把组合公式(richtex)按行拆成多个「公式」元素 */
function splitRichtexToMath() {
  const el = props.el as any
  const lines = String(el.text || '').split('\n').map((s: string) => s.trim()).filter(Boolean)
  if (!lines.length) return
  const H = 80
  lines.forEach((ln: string, i: number) => {
    const t = ln.replace(/^\$\$|\$\$$/g, '').replace(/^\\\[|\\\]$/g, '').replace(/^\\\(|\\\)$/g, '').trim()
    if (!t) return
    store.addElement('math', {
      latex: t, x: el.x, y: el.y + i * (H + 26), w: Math.max(300, el.w), h: H,
      fontSize: el.fontSize || 24, color: el.color || '#1a1a1a', align: 'left',
    } as Partial<SlideElement>)
  })
  store.removeElement(el.id)
}
function onElCtx(e: MouseEvent) {
  if (!store.isSelected(props.el.id)) store.selectElement(props.el.id, false)
  const items = [
    { label: '复制', onClick: () => store.copyElements() },
    { label: '剪切', onClick: () => store.cutElements() },
    { label: '粘贴', onClick: () => store.pasteElements(), disabled: !store.canPaste },
    { label: '删除', onClick: () => store.removeSelected(), danger: true },
  ]
  if (props.el.type === 'richtex') items.push({ label: '多公式元素（拆分为多个公式）', onClick: splitRichtexToMath })
  openMenu(e.clientX, e.clientY, items)
}

const isLineLike = computed(() => props.el.type === 'line' || props.el.type === 'arrow')
const frameStyle = computed(() => ({
  left: `${props.el.x}px`,
  top: `${props.el.y}px`,
  width: `${props.el.w}px`,
  height: `${props.el.h}px`,
  zIndex: String(props.z),
  transform: props.el.rot ? `rotate(${props.el.rot}deg)` : undefined,
  boxShadow: props.el.shadowOn ? `${props.el.shadowX ?? 0}px ${props.el.shadowY ?? 6}px ${props.el.shadowBlur ?? 18}px ${props.el.shadowColor || '#000000'}55` : undefined,
}))

function onPointerDown(e: PointerEvent) {
  emit('grab', { ev: e, mode: 'move', handle: 'se' })
}
function onHandleDown(e: PointerEvent, handle: Handle) {
  emit('grab', { ev: e, mode: 'resize', handle })
}
function onDblClick() {
  const t = props.el
  if (t.type === 'mathfig' && (t.kind === 'polygon' || t.kind === 'bezier')) openShapeEdit(t.id)
  else if (t.type === 'line' || t.type === 'arrow') openShapeEdit(t.id)
}
</script>

<template>
  <div
    class="el-frame"
    :data-el-id="el.id"
    :class="{ 'el-frame--selected': selected && !isLineLike }"
    :style="frameStyle"
    @pointerdown.stop="onPointerDown"
    @dblclick.stop="onDblClick"
    @contextmenu.stop.prevent="onElCtx"
  >
    <TextElement
      v-if="el.type === 'text'"
      :el="el"
      @update="(p) => emit('update', el.id, p)"
    />
    <ShapeElement v-else-if="el.type === 'shape'" :el="el" />
    <ImageElement v-else-if="el.type === 'image'" :el="el" />
    <MathElement v-else-if="el.type === 'math'" :el="el" />
    <GeoGebraElement v-else-if="el.type === 'geogebra'" :el="el" :selected="selected" />
    <DesmosElement v-else-if="el.type === 'desmos'" :el="el" :selected="selected" />
    <LineElement v-else-if="el.type === 'line'" :el="el" :selected="selected" @update="(p) => emit('update', el.id, p)" />
    <ArrowElement v-else-if="el.type === 'arrow'" :el="el" :selected="selected" @update="(p) => emit('update', el.id, p)" />
    <PenElement v-else-if="el.type === 'pen'" :el="el" />
    <MathFigureElement v-else-if="el.type === 'mathfig'" :el="el" :selected="selected" @update="(p) => emit('update', el.id, p)" />
    <ChartElement v-else-if="el.type === 'chart'" :el="el" />
    <TableElement v-else-if="el.type === 'table'" :el="el" />
    <IconElement v-else-if="el.type === 'icon'" :el="el" />
    <EmbedElement v-else-if="el.type === 'embed'" :el="el" :selected="selected" />
    <RichTextElement v-else-if="el.type === 'richtex'" :el="el" />

    <template v-if="selected && showHandles && !isLineLike">
      <span
        v-for="h in HANDLES"
        :key="h"
        class="handle"
        :class="`handle--${h}`"
        @pointerdown.stop="onHandleDown($event, h)"
      ></span>
    </template>
  </div>
</template>

<style scoped>
.el-frame {
  position: absolute;
  box-sizing: border-box;
  cursor: move;
  transition: none;
}
.el-frame--selected {
  outline: 2px solid var(--brand-600);
  outline-offset: 0;
  border-radius: 2px;
}
.handle {
  position: absolute;
  width: 10px;
  height: 10px;
  background: #ffffff;
  border: 2px solid var(--brand-600);
  border-radius: 3px;
  box-sizing: border-box;
  box-shadow: 0 1px 3px rgba(24, 18, 46, 0.30);
  transition: background 0.12s var(--ease), transform 0.1s var(--ease);
}
.handle:hover { background: var(--brand-100); transform: scale(1.18); }
.handle--nw { left: -5px;  top: -5px;    cursor: nwse-resize; }
.handle--n  { left: 50%;   top: -5px;    margin-left: -5px; cursor: ns-resize; }
.handle--ne { right: -5px; top: -5px;    cursor: nesw-resize; }
.handle--e  { right: -5px; top: 50%;     margin-top: -5px; cursor: ew-resize; }
.handle--se { right: -5px; bottom: -5px; cursor: nwse-resize; }
.handle--s  { left: 50%;   bottom: -5px; margin-left: -5px; cursor: ns-resize; }
.handle--sw { left: -5px;  bottom: -5px; cursor: nesw-resize; }
.handle--w  { left: -5px;  top: 50%;     margin-top: -5px; cursor: ew-resize; }
</style>
