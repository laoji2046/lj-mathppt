<script setup lang="ts">
/**
 * 底部状态栏（footbar）：贴窗口最底部，横跨整宽。
 * 左边是画布视图状态（缩放 / 放大缩小 / 复位 / 操作提示），右边是版权信息。
 * 「演示」时不渲染整个栏（App.vue 里 v-if）—— 演示是给学生看的内容，不该出现软件的操作条与署名。
 */
import { computed } from 'vue'
import { useDeckStore } from '@/stores/deck'
import AppIcon from './AppIcon.vue'
import { COPYRIGHT } from '@/ui/appInfo'
import { effectiveScale, isDefaultView, resetView, zoomBy } from '@/ui/canvasView'

const store = useDeckStore()

const pct = computed(() => Math.round(effectiveScale.value * 100))
const atDefault = computed(() => isDefaultView())
const drawLabel = computed(() => (store.drawTool === 'line' ? '绘制直线' : store.drawTool === 'arrow' ? '绘制箭头' : store.drawTool === 'pen' ? '画笔' : '画多边形'))
const drawTip = computed(() => (store.drawTool === 'poly' ? '点击放角点，双击或点首点闭合，Esc 取消' : '在画布空白处拖拽，Esc 取消'))
</script>

<template>
  <footer class="statusbar">
    <div class="statusbar__side">
      <span class="statusbar__zoom">缩放 {{ pct }}%</span>
      <button class="statusbar__icon" title="缩小（Ctrl/⌘ + 滚轮）" @click="zoomBy(1 / 1.15)"><AppIcon name="minus" :size="12" /></button>
      <button class="statusbar__icon" title="放大（Ctrl/⌘ + 滚轮）" @click="zoomBy(1.15)"><AppIcon name="plus" :size="12" /></button>
      <button class="statusbar__btn" :disabled="atDefault" title="回到适屏（缩放 100% + 平移归零）" @click="resetView()">复位</button>

      <span v-if="store.drawTool" class="statusbar__tip statusbar__tip--draw">{{ drawLabel }}：{{ drawTip }}</span>
      <span v-else class="statusbar__tip">Ctrl/⌘ + 滚轮缩放 · 空格 / 中键拖动平移</span>
    </div>

    <div class="statusbar__copy">{{ COPYRIGHT }}</div>
  </footer>
</template>

<style scoped>
.statusbar {
  flex: none;
  height: 30px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 14px;
  border-top: 1px solid var(--border);
  background: var(--panel);
  color: var(--muted);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  user-select: none;
}
.statusbar__side { display: flex; align-items: center; gap: 8px; min-width: 0; }
.statusbar__zoom { color: var(--gray-700); font-weight: 500; }
.statusbar__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--panel);
  color: var(--gray-600);
  cursor: pointer;
  transition: background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease);
}
.statusbar__icon:hover { background: var(--brand-50); border-color: var(--brand-200); color: var(--brand-700); }
.statusbar__btn {
  height: 20px;
  padding: 0 9px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--panel);
  color: var(--gray-700);
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease);
}
.statusbar__btn:hover:not(:disabled) { background: var(--brand-50); border-color: var(--brand-200); color: var(--brand-700); }
.statusbar__btn:disabled { opacity: 0.45; cursor: default; }
.statusbar__tip { margin-left: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.statusbar__tip--draw { color: var(--brand-700); font-weight: 600; }
.statusbar__copy { flex: none; opacity: 0.9; white-space: nowrap; }
</style>
