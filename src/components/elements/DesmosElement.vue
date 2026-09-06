<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DesmosElement } from '@/types'
import {
  applyDesmosColor, destroyDesmos, injectDesmos, registerDesmos, unregisterDesmos,
} from '@/composables/useDesmos'

const props = defineProps<{ el: DesmosElement; selected?: boolean }>()

const host = ref<HTMLElement | null>(null)
const error = ref('')
const loading = ref(true)
let injected = false
let calculator: unknown = null

async function mountCalc() {
  const node = host.value
  // 已注入则跳过，避免 Vue 重渲染导致重复注入
  if (!node || injected) return
  loading.value = true
  error.value = ''
  try {
    calculator = await injectDesmos(node, {
      state: props.el.state,
      showPanel: props.el.showPanel,
      showToolbar: props.el.showToolbar,
      showZoomButtons: props.el.showZoomButtons,
      color: props.el.color,
    })
    injected = true
    // 注册到全局表：属性面板与「演示前自动保存」靠它回读计算器内容
    registerDesmos(props.el.id, calculator)
    if (props.el.color) applyDesmosColor(calculator, props.el.color)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function teardown() {
  destroyDesmos(calculator)
  unregisterDesmos(props.el.id)
  injected = false
  calculator = null
  if (host.value) host.value.innerHTML = ''
}

onMounted(mountCalc)
onBeforeUnmount(teardown)

// 注意：尺寸变化**不**重新注入（会丢计算器交互状态），交给 Desmos 自适应。
//
// 属性变化分两组：
// - 「影响计算器形态」的属性（面板/工具栏）→ 销毁重建；
// - 外来内容（state 被属性面板清空/导入、撤销重做）→ 直接 setState，不重建，
//   否则每次自动保存都会把计算器重置一遍。
watch(
  () => [props.el.showPanel, props.el.showToolbar, props.el.showZoomButtons],
  () => { teardown(); mountCalc() },
)

// 颜色：不重建计算器，直接改写表达式（保住用户已输入的内容与视图）
watch(
  () => props.el.color,
  (next, prev) => {
    if (!injected || !calculator) return
    applyDesmosColor(calculator, next || '', prev || '')
  },
)

watch(
  () => props.el.state,
  () => {
    if (!injected || !calculator) return
    try {
      const c = calculator as { setState?: (s: unknown) => void }
      c.setState?.(JSON.parse(props.el.state || '{}'))
      if (props.el.color) applyDesmosColor(calculator, props.el.color)
    } catch { /* 忽略非法 state */ }
  },
)
</script>

<template>
  <div class="dsm-el">
    <div v-if="el.showTitlebar" class="dsm-el__bar" :style="{ pointerEvents: props.selected ? 'auto' : 'none' }">
      <span class="dsm-el__grip">⠿</span><span>Desmos</span>
    </div>
    <div v-show="!error" ref="host" class="dsm-el__host" :style="{ pointerEvents: props.selected ? 'auto' : 'none' }" @pointerdown.stop></div>

    <div v-if="error" class="dsm-el__msg dsm-el__msg--err">
      Desmos 加载失败：{{ error }}
      <small>离线引擎已随应用内嵌，一般不会失败；若持续报错请重启应用。</small>
    </div>
    <div v-else-if="loading" class="dsm-el__msg">正在加载 Desmos…</div>
  </div>
</template>

<style scoped>
.dsm-el {
  width: 100%;
  height: 100%;
  position: relative;
  background: #ffffff;
  border: 1px solid #e3dfd5;
  border-radius: 4px;
  overflow: hidden;
}
.dsm-el__host {
  width: 100%;
  height: 100%;
}
.dsm-el__bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 24px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  background: rgba(240, 239, 234, 0.92);
  border-bottom: 1px solid #d3d1c7;
  color: #5f5e5a;
  font-size: 12px;
  z-index: 5;
  cursor: move;
  user-select: none;
}
.dsm-el__grip { font-size: 10px; color: #8b8a95; }
.dsm-el__msg {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px;
  box-sizing: border-box;
  text-align: center;
  font-size: 13px;
  line-height: 1.6;
  color: #5f5e5a;
  background: #faf9f7;
}
.dsm-el__msg--err { color: #a32d2d; background: #fcebeb; }
.dsm-el__msg small {
  font-size: 11px;
  opacity: 0.8;
}
</style>
