<script setup lang="ts">
/**
 * 颜色选择弹层 —— 对齐 PowerPoint 的「主题颜色 / 标准色」面板：
 * 主题色 10 基色 + 5 档浓淡、标准色 10 色、其他颜色…、取色器。
 *
 * 「取色器」用的是浏览器原生的 EyeDropper API（Chromium / WebView2 有，其它环境自动隐藏）。
 */
import { computed, ref } from 'vue'
import { useDeckStore } from '@/stores/deck'
import { getTheme } from '@/templates/pptTheme'
import { STANDARD_COLORS, themeBaseColors, themeGrid } from '@/ui/colorPalette'

defineProps<{ modelValue?: string; allowTransparent?: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void; (e: 'close'): void }>()

const store = useDeckStore()
const theme = computed(() => getTheme(store.deck.theme || 'edumath'))
const bases = computed(() => themeBaseColors(theme.value))
const grid = computed(() => themeGrid(theme.value))
const customRef = ref<HTMLInputElement | null>(null)

function pick(c: string) {
  emit('update:modelValue', c)
  emit('close')
}
function openCustom() {
  customRef.value?.click()
}
function onCustom(e: Event) {
  pick((e.target as HTMLInputElement).value)
}
/** 取色器：从屏幕任意位置取色（Chromium 系支持） */
const hasDropper = typeof (window as unknown as { EyeDropper?: unknown }).EyeDropper === 'function'
async function dropper() {
  try {
    const Ctor = (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper
    const r = await new Ctor().open()
    if (r?.sRGBHex) pick(r.sRGBHex)
  } catch {
    /* 用户取消，忽略 */
  }
}
</script>

<template>
  <div class="cp" @click.stop>
    <div class="cp__title">主题颜色</div>

    <!-- 基色一排（当前色带外框） -->
    <div class="cp__row">
      <button
        v-for="(b, i) in bases" :key="'b' + i"
        class="cp__c cp__c--base" :class="{ 'cp__c--on': modelValue === b }"
        :style="{ background: b }" :title="b" @click="pick(b)"
      ></button>
    </div>

    <!-- 浓淡 5 档 × 10 列 -->
    <div class="cp__grid">
      <template v-for="(col, ci) in grid" :key="'g' + ci">
        <button
          v-for="(c, ri) in col" :key="ci + '-' + ri"
          class="cp__c" :class="{ 'cp__c--on': modelValue === c }"
          :style="{ background: c }" :title="c" @click="pick(c)"
        ></button>
      </template>
    </div>

    <div class="cp__sep"></div>
    <div class="cp__title">标准色</div>
    <div class="cp__row">
      <button
        v-for="c in STANDARD_COLORS" :key="c"
        class="cp__c" :class="{ 'cp__c--on': modelValue === c }"
        :style="{ background: c }" :title="c" @click="pick(c)"
      ></button>
    </div>

    <div v-if="allowTransparent" class="cp__sep"></div>
    <button v-if="allowTransparent" class="cp__item" :class="{ 'cp__item--on': modelValue === 'transparent' }" @click="pick('transparent')">
      <span class="cp__none"></span>无颜色（透明）
    </button>

    <div class="cp__sep"></div>
    <button class="cp__item" @click="openCustom">
      <span class="cp__ico">🎨</span>其他颜色(M)…
    </button>
    <button v-if="hasDropper" class="cp__item" @click="dropper">
      <span class="cp__ico">💧</span>取色器(E)
    </button>
    <input ref="customRef" class="cp__input" type="color" :value="modelValue || '#000000'" @input="onCustom" />
  </div>
</template>

<style scoped>
.cp { width: 236px; padding: 10px; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-lg); }
.cp__title { font-size: 12px; font-weight: 600; color: var(--text); margin: 2px 0 6px; }
.cp__row { display: grid; grid-template-columns: repeat(10, 1fr); gap: 2px; }
.cp__grid { display: grid; grid-template-columns: repeat(10, 1fr); gap: 2px; margin-top: 2px; }
.cp__c { width: 100%; aspect-ratio: 1; border: 1px solid rgba(0, 0, 0, 0.12); border-radius: 2px; cursor: pointer; padding: 0; }
.cp__c--base { height: 18px; }
.cp__c:hover { outline: 2px solid var(--brand); outline-offset: 0; }
.cp__c--on { box-shadow: 0 0 0 2px var(--panel), 0 0 0 3px var(--brand); }
.cp__sep { height: 1px; margin: 9px 0; background: var(--border); }
.cp__item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 4px; border: none; background: none; text-align: left; font-size: 13px; color: var(--text); border-radius: var(--radius-sm); cursor: pointer; }
.cp__item:hover { background: var(--brand-50); color: var(--brand-800); }
.cp__item--on { background: var(--brand-50); }
.cp__ico { font-size: 14px; }
.cp__none { width: 15px; height: 15px; border: 1px solid var(--border-strong); border-radius: 2px; background: linear-gradient(135deg, transparent 45%, var(--danger) 45%, var(--danger) 55%, transparent 55%); }
.cp__input { position: absolute; width: 0; height: 0; opacity: 0; pointer-events: none; }
</style>
