<script setup lang="ts">
/** 颜色面板：预设色板 + 自定义取色 + 可选「透明」 */
import { computed } from 'vue'

const props = defineProps<{
  modelValue?: string
  allowTransparent?: boolean
  /** 色块边长（px），默认 24 */
  size?: number
  /** 紧凑模式：精简色板（一行常用色）+ 加长的自定义色条（窄面板用，如混排公式面板） */
  compact?: boolean
  /** 在预设色板后面追加的颜色（各入口按需补充，如公式色 +4、背景色 +3） */
  extra?: string[]
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const PRESET_FULL = [
  '#000000', '#1a1a1a', '#333333', '#666666', '#999999', '#cccccc', '#ffffff',
  '#e53935', '#d64545', '#e8871e', '#f4a63a', '#2d7dd2', '#1d4e89', '#2f9e63', '#1f8a4c',
  '#7c4bb8', '#b23f88', '#3c9bb0', '#b08d44', '#fdf6e3', '#f4f2ec',
  // bento 卡片配色（参考 Bento_Slides）
  '#16273E', '#0D1B2E', '#1C2C44', '#5E7699', '#FF9E8A', '#FFBCA8', '#F0EBE0', '#E8EDF4', '#F2F0EA',
]
/** 精简色板：一行 8 色，覆盖数学讲义最常用的黑 / 强调红 / 暖色 / 绿 / 蓝 / 紫 / 灰 / 白 */
const PRESET_COMPACT = ['#1a1a1a', '#e53935', '#e8871e', '#2f9e63', '#2d7dd2', '#7c4bb8', '#999999', '#ffffff']

const presets = computed(() => {
  const base = props.compact ? PRESET_COMPACT : PRESET_FULL
  return props.extra?.length ? [...base, ...props.extra] : base
})
const swStyle = computed(() => {
  const box = props.size ?? (props.compact ? 18 : 24)
  return {
    '--sw-size': box + 'px',
    // 紧凑模式把自定义色条拉长，方便拖色/取色
    '--sw-bar-w': (props.compact ? 104 : 26) + 'px',
    '--sw-bar-h': (props.compact ? box : 22) + 'px',
  }
})

function pick(c: string) { emit('update:modelValue', c) }
function onCustom(e: Event) { emit('update:modelValue', (e.target as HTMLInputElement).value) }
function isOn(c: string) { return props.modelValue === c }
</script>

<template>
  <div class="sw" :class="{ 'sw--compact': compact }" :style="swStyle">
    <button
      v-for="c in presets"
      :key="c"
      class="sw__c"
      :class="{ 'sw__c--on': isOn(c) }"
      :style="{ background: c }"
      :title="c"
      @click="pick(c)"
    ></button>
    <button v-if="allowTransparent" class="sw__c sw__c--trans" :class="{ 'sw__c--on': isOn('transparent') }" title="透明" @click="pick('transparent')">⊘</button>
    <label class="sw__custom" title="自定义颜色">
      <input type="color" :value="modelValue || '#000000'" @input="onCustom" />
      <span>自定义</span>
    </label>
  </div>
</template>

<style scoped>
.sw {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
  margin-top: 4px;
}
.sw--compact { gap: 4px; margin-top: 0; }
.sw__c {
  width: var(--sw-size, 24px);
  height: var(--sw-size, 24px);
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  cursor: pointer;
  padding: 0;
  position: relative;
  transition: transform 0.1s;
}
.sw--compact .sw__c { border-radius: 5px; }
.sw__c:hover { transform: scale(1.12); }
.sw__c--on { outline: 2px solid var(--brand); outline-offset: 1px; }
.sw__c--trans {
  background: repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50% / 10px 10px;
  color: #999;
  font-size: 14px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sw--compact .sw__c--trans { font-size: 12px; }
.sw__custom {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  padding: 3px 7px 3px 4px;
  font-size: 11px;
  color: var(--muted);
  cursor: pointer;
  background: #fff;
}
.sw--compact .sw__custom { padding: 2px 6px 2px 3px; gap: 6px; }
.sw__custom input[type="color"] {
  width: var(--sw-bar-w, 26px);
  height: var(--sw-bar-h, 22px);
  border: none;
  padding: 0;
  background: transparent;
  cursor: pointer;
}
</style>
