<script setup lang="ts">
import { computed } from 'vue'
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

/** 图标路径（24×24，描边式，与顶部工具栏同源风格） */
const ICON = {
  group: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><path d="M14 10.5h4.5V6"/>',
  ungroup: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><path d="M14 10.5h4.5V6"/><path d="M4 20L20 4"/>',
  alignLeft: '<path d="M3 3v18"/><rect x="6" y="6" width="12" height="4" rx="1"/><rect x="6" y="14" width="8" height="4" rx="1"/>',
  alignHCenter: '<path d="M12 2v20"/><rect x="4" y="6" width="16" height="4" rx="1"/><rect x="7" y="14" width="10" height="4" rx="1"/>',
  alignRight: '<path d="M21 3v18"/><rect x="6" y="6" width="12" height="4" rx="1"/><rect x="10" y="14" width="8" height="4" rx="1"/>',
  alignTop: '<path d="M3 3h18"/><rect x="6" y="6" width="4" height="12" rx="1"/><rect x="14" y="6" width="4" height="8" rx="1"/>',
  alignVCenter: '<path d="M2 12h20"/><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="7" width="4" height="10" rx="1"/>',
  alignBottom: '<path d="M3 21h18"/><rect x="6" y="6" width="4" height="12" rx="1"/><rect x="14" y="10" width="4" height="8" rx="1"/>',
  distH: '<path d="M2 4v16M22 4v16"/><rect x="7" y="7" width="4" height="10" rx="1"/><rect x="15" y="7" width="4" height="10" rx="1"/>',
  distV: '<path d="M4 2h16M4 22h16"/><rect x="7" y="7" width="10" height="4" rx="1"/><rect x="7" y="15" width="10" height="4" rx="1"/>',
  toFront: '<rect x="3" y="3" width="12" height="12" rx="2"/><path d="M9 21h10a2 2 0 0 0 2-2V9"/>',
  toBack: '<path d="M3 9v10a2 2 0 0 0 2 2h10"/><rect x="9" y="3" width="12" height="12" rx="2"/>',
  forward: '<path d="M12 4v9M8 8l4-4 4 4"/><rect x="3" y="15" width="18" height="5" rx="1.5"/>',
  backward: '<path d="M12 20v-9M8 16l4 4 4-4"/><rect x="3" y="4" width="18" height="5" rx="1.5"/>',
}

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
