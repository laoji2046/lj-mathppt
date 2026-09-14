<script setup lang="ts">
/** 颜色面板：预设色板 + 自定义取色 + 可选「透明」 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ColorPickerPopup from './ColorPickerPopup.vue'

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

/** 颜色按钮上显示的色值 */
const hexLabel = computed(() => {
  const v = props.modelValue
  if (!v) return '默认'
  return v === 'transparent' ? '透明' : v.toUpperCase()
})
const chipTitle = computed(() =>
  '当前颜色 ' + (props.modelValue || '默认') + ' —— 点击打开主题色面板（含取色器）',
)
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
// （原来的内联「自定义」取色器已被取色面板里的「其他颜色(M)…」取代）
function isOn(c: string) { return props.modelValue === c }

// ---- 更多颜色：打开 PPT 风格的取色面板（主题色 / 标准色 / 其他颜色 / 取色器）----
const popupOpen = ref(false)
const triggerRef = ref<HTMLElement | null>(null)
const popPos = ref({ x: 0, y: 0 })
function openPopup() {
  const r = triggerRef.value?.getBoundingClientRect()
  if (r) {
    // 贴住触发点，并保证不跑出视口
    popPos.value = {
      x: Math.max(8, Math.min(r.left, window.innerWidth - 252)),
      y: Math.max(8, Math.min(r.bottom + 6, window.innerHeight - 430)),
    }
  }
  popupOpen.value = true
}
function closePopup() { popupOpen.value = false }
function onDocDown(e: MouseEvent) {
  if (!popupOpen.value) return
  const t = e.target as HTMLElement
  if (t.closest('.cp') || t.closest('.sw__more')) return
  popupOpen.value = false
}
function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') popupOpen.value = false }
onMounted(() => {
  document.addEventListener('pointerdown', onDocDown, true)
  document.addEventListener('keydown', onEsc)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocDown, true)
  document.removeEventListener('keydown', onEsc)
})
</script>

<template>
  <div class="sw" :class="{ 'sw--compact': compact }" :style="swStyle">
    <!-- 紧凑模式（窄面板，如公式行）：保留一排常用色 + 彩虹入口，点一下就换色 -->
    <template v-if="compact">
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
    </template>

    <!-- 常规模式：跟 PowerPoint 一样只给**一个颜色按钮**（点开主题色/标准色/取色器面板），
         原来那一大片内联色块不放了 —— 占了半屏还显得乱 -->
    <template v-else>
      <button ref="triggerRef" class="sw__chip" type="button" :title="chipTitle" @click.stop="openPopup">
        <span class="sw__dot" :class="{ 'sw__dot--trans': modelValue === 'transparent' }" :style="modelValue && modelValue !== 'transparent' ? { background: modelValue } : undefined"></span>
        <span class="sw__hex">{{ hexLabel }}</span>
        <span class="sw__caret">▾</span>
      </button>
      <button
        v-if="allowTransparent"
        class="sw__chip sw__chip--icon"
        :class="{ 'sw__chip--on': isOn('transparent') }"
        type="button" title="无填充（透明）" @click="pick('transparent')"
      >⊘</button>
    </template>

    <button
      v-if="compact"
      ref="triggerRef" class="sw__more" type="button"
      title="更多颜色：主题色 / 标准色 / 其他颜色 / 取色器（跟 PowerPoint 一样）"
      @click.stop="openPopup"
    ></button>

    <ColorPickerPopup
      v-if="popupOpen"
      :style="{ position: 'fixed', left: popPos.x + 'px', top: popPos.y + 'px', zIndex: 500 }"
      :model-value="modelValue"
      :allow-transparent="allowTransparent"
      @update:model-value="pick"
      @close="closePopup"
    />
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
/* 「更多颜色」入口：用一块小彩虹最自解释（点开是 PPT 那个主题色面板） */
.sw__more { width: var(--sw-size, 24px); height: var(--sw-size, 24px); border: 1px solid var(--border-strong); border-radius: 4px; cursor: pointer; padding: 0; flex: 0 0 auto;
  background: conic-gradient(from 0deg, #e53935, #e8871e, #f4d03f, #2f9e63, #2d7dd2, #7c4bb8, #e53935); }
.sw__more:hover { outline: 2px solid var(--brand); outline-offset: 1px; }
/* 常规模式的颜色按钮：色点 + 色值 + 下拉箭头（一眼看出当前色，也省地方） */
.sw__chip { display: inline-flex; align-items: center; gap: 7px; height: 28px; padding: 0 8px; border: 1px solid var(--border-strong); border-radius: 7px; background: #fff; cursor: pointer; font: inherit; }
.sw__chip:hover { border-color: var(--brand); background: var(--brand-50); }
.sw__chip--icon { width: 30px; justify-content: center; padding: 0; font-size: 14px; color: var(--muted); }
.sw__chip--on { border-color: var(--brand); background: var(--brand-50); color: var(--brand-800); }
.sw__dot { width: 16px; height: 16px; border-radius: 4px; border: 1px solid rgba(0, 0, 0, 0.18); flex: 0 0 auto; }
.sw__dot--trans { background: repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50% / 8px 8px; }
.sw__hex { font-size: 11.5px; color: var(--muted); font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }
.sw__caret { font-size: 9px; color: var(--muted); }
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
