<script setup lang="ts">
import { computed } from 'vue'
import { ICONS as ICON } from '@/ui/icons'
import { useDeckStore } from '@/stores/deck'
import type { AlignMode, DistributeAxis, ZOrderAction } from '@/types'

const store = useDeckStore()

const n = computed(() => store.selectionCount)
const has = computed(() => n.value > 0)
/** 对齐：1 个以上即可（单个时相对页面对齐） */
const canAlign = computed(() => n.value >= 1)
/** 分布：至少 3 个才有意义 */
const canDistribute = computed(() => n.value >= 3)
const canGroup = computed(() => n.value >= 2)
const canUngroup = computed(() => store.selectedElements.some((e) => !!e.groupId))


const aligns: { mode: AlignMode; icon: string; tip: string }[] = [
  { mode: 'left',    icon: ICON.alignLeft,    tip: '左对齐' },
  { mode: 'hcenter', icon: ICON.alignHCenter, tip: '水平居中' },
  { mode: 'right',   icon: ICON.alignRight,   tip: '右对齐' },
  { mode: 'top',     icon: ICON.alignTop,     tip: '顶对齐' },
  { mode: 'vcenter', icon: ICON.alignVCenter, tip: '垂直居中' },
  { mode: 'bottom',  icon: ICON.alignBottom,  tip: '底对齐' },
]
const distributes: { axis: DistributeAxis; icon: string; tip: string }[] = [
  { axis: 'h', icon: ICON.distH, tip: '水平等距分布' },
  { axis: 'v', icon: ICON.distV, tip: '垂直等距分布' },
]
const zorders: { action: ZOrderAction; icon: string; tip: string }[] = [
  { action: 'front',    icon: ICON.toFront,  tip: '置于顶层' },
  { action: 'forward',  icon: ICON.forward,  tip: '上移一层' },
  { action: 'backward', icon: ICON.backward, tip: '下移一层' },
  { action: 'back',     icon: ICON.toBack,   tip: '置于底层' },
]
</script>

<template>
  <div class="editbar">
    <span class="chip" :class="{ 'chip--on': has }">
      已选 <b>{{ n }}</b>
    </span>

    <span class="sep"></span>

    <div class="group">
      <button class="ib ib--text" :disabled="!canGroup" title="组合 (Ctrl+G)" @click="store.groupSelection()">
        <svg viewBox="0 0 24 24" class="ib__svg" v-html="ICON.group"></svg>组合
      </button>
      <button class="ib ib--text" :disabled="!canUngroup" title="解组 (Ctrl+Shift+G)" @click="store.ungroup()">
        <svg viewBox="0 0 24 24" class="ib__svg" v-html="ICON.ungroup"></svg>解组
      </button>
    </div>

    <span class="sep"></span>

    <div class="group">
      <button
        v-for="a in aligns"
        :key="a.mode"
        class="ib"
        :disabled="!canAlign"
        :title="a.tip"
        :aria-label="a.tip"
        @click="store.alignSelection(a.mode)"
      ><svg viewBox="0 0 24 24" class="ib__svg" v-html="a.icon"></svg></button>
    </div>

    <span class="sep"></span>

    <div class="group">
      <button
        v-for="d in distributes"
        :key="d.axis"
        class="ib"
        :disabled="!canDistribute"
        :title="d.tip"
        :aria-label="d.tip"
        @click="store.distributeSelection(d.axis)"
      ><svg viewBox="0 0 24 24" class="ib__svg" v-html="d.icon"></svg></button>
    </div>

    <span class="sep"></span>

    <div class="group">
      <button
        v-for="z in zorders"
        :key="z.action"
        class="ib"
        :disabled="!has"
        :title="z.tip"
        :aria-label="z.tip"
        @click="store.reorderZ(z.action)"
      ><svg viewBox="0 0 24 24" class="ib__svg" v-html="z.icon"></svg></button>
    </div>
  </div>
</template>

<style scoped>
.editbar {
  height: 44px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  overflow-x: auto;
  scrollbar-width: none;
}
.editbar::-webkit-scrollbar { height: 0; }

/* 选中数量：胶囊指示 */
.chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: none;
  height: 24px;
  padding: 0 10px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border);
  background: var(--gray-50);
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
  transition: background var(--dur-1) var(--ease), color var(--dur-1) var(--ease),
              border-color var(--dur-1) var(--ease);
}
.chip b { font-weight: 600; font-size: 12.5px; }
.chip--on {
  background: var(--brand-50);
  border-color: var(--brand-100);
  color: var(--brand-800);
}

.sep {
  width: 1px;
  height: 18px;
  background: var(--border-strong);
  flex: none;
}
.group { display: flex; gap: 4px; flex: none; }

.ib {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  height: 28px;
  min-width: 28px;
  padding: 0 5px;
  border: 1px solid var(--border-strong);
  background: var(--panel);
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--gray-600);
  transition: background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease),
              color var(--dur-1) var(--ease), transform var(--dur-1) var(--ease),
              box-shadow var(--dur-1) var(--ease);
}
.ib--text { padding: 0 9px; gap: 5px; font-size: 12.5px; font-weight: 500; color: var(--text); }
.ib:hover:not(:disabled) {
  background: var(--brand-50);
  border-color: var(--brand-200);
  color: var(--brand-700);
  transform: translateY(-1px);
  box-shadow: var(--shadow-xs);
}
.ib:active:not(:disabled) { transform: translateY(0); box-shadow: none; }
.ib:disabled { opacity: 0.34; cursor: not-allowed; }
.ib__svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
  display: inline-block;
}
</style>
