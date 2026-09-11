<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { GeoGebraElement } from '@/types'
import { applyAlgebraView, applyViewOptions, destroyGeoGebra, injectGeoGebra } from '@/composables/useGeoGebra'

const props = defineProps<{ el: GeoGebraElement; selected?: boolean }>()

const host = ref<HTMLElement | null>(null)
const error = ref('')
const loading = ref(true)
let injected = false
let applet: unknown = null

async function mountApplet() {
  const node = host.value
  // 已注入则跳过，避免 Vue 重渲染导致重复注入
  if (!node || injected) return
  loading.value = true
  error.value = ''
  try {
    applet = await injectGeoGebra(node, {
      app: props.el.app,
      ggbBase64: props.el.ggbBase64,
      showToolbar: props.el.showToolbar,
      showAlgebraInput: props.el.showAlgebraInput,
      showAlgebra: props.el.showAlgebra,
      showMenuBar: props.el.showMenuBar,
      showResetIcon: props.el.showResetIcon,
      enableShiftDragZoom: props.el.enableShiftDragZoom,
      showAxis: props.el.showAxis,
      showGrid: props.el.showGrid,
      commands: props.el.commands,
    })
    injected = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(mountApplet)

onBeforeUnmount(() => {
  destroyGeoGebra(host.value)
  injected = false
  applet = null
})

// 注意：尺寸变化**不**重新注入（会丢失作图内容），
// 交给 GeoGebra 自己的 scaleContainerClass 自适应。
//
// 属性变化分两组处理：
// - 「影响小程序形态」的属性（套件/文件/工具栏等）→ 销毁重建；
// - 视图显示（坐标轴/网格）→ 直接调 setAxisVisible/setGridVisible，
//   不重建。.ggb 文件自带视图设置会覆盖构造参数，只有运行时 API 能强制生效。
watch(
  () => [
    props.el.app,
    props.el.ggbBase64,
    props.el.showToolbar,
    props.el.showAlgebraInput,
    props.el.showMenuBar,
    props.el.showResetIcon,
    props.el.enableShiftDragZoom,
    JSON.stringify(props.el.commands || []),
  ],
  () => {
    destroyGeoGebra(host.value)
    injected = false
    applet = null
    mountApplet()
  },
)

watch(
  () => [props.el.showAxis, props.el.showGrid],
  ([axis, grid]) => {
    if (injected && applet) applyViewOptions(applet, { showAxis: axis, showGrid: grid })
  },
)

// 代数区（视图）：不重建，直接用运行时 API 切换，保住已有作图
watch(
  () => props.el.showAlgebra,
  (next) => {
    if (!injected || !applet) return
    const api = (applet as Record<string, unknown>).__ggbApi as Record<string, unknown> | undefined
    applyAlgebraView(api, props.el.app, next)
  },
)
</script>

<template>
  <div class="ggb-el">
    <div v-if="el.showTitlebar" class="ggb-el__bar">
      <span class="ggb-el__grip">⠿</span><span>GeoGebra</span>
    </div>
    <div v-show="!error" ref="host" class="ggb-el__host" :style="{ pointerEvents: props.selected ? 'auto' : 'none' }" @pointerdown.stop></div>

    <div v-if="error" class="ggb-el__msg ggb-el__msg--err">
      GeoGebra 加载失败：{{ error }}
      <small>请检查网络连接；离线引擎已随应用内嵌，一般无需联网。</small>
    </div>
    <div v-else-if="loading" class="ggb-el__msg">正在加载 GeoGebra…</div>
  </div>
</template>

<style scoped>
.ggb-el {
  width: 100%;
  height: 100%;
  position: relative;
  background: #ffffff;
  border: 1px solid #e3dfd5;
  border-radius: 4px;
  overflow: hidden;
}
.ggb-el__host {
  width: 100%;
  height: 100%;
}
.ggb-el__bar {
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
  z-index: 6;
  cursor: move;
  user-select: none;
}
.ggb-el__grip { font-size: 10px; color: #8b8a95; }
.ggb-el__msg {
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
.ggb-el__msg--err {
  color: #a32d2d;
  background: #fcebeb;
}
.ggb-el__msg small {
  font-size: 11px;
  opacity: 0.8;
}
</style>
