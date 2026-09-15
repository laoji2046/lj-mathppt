<script setup lang='ts'>
/**
 * 功能管理 —— addon 的开关面板。
 *
 * 数据全部来自 src/addons 的清单（体积是实测值，不是估算）
 * 关掉一个 addon = 入口隐藏 + 代码永不加载；随时可开回来。
 * 开关存在 localStorage（app 级设置），不进文稿 JSON。
 */
import { computed } from 'vue'
import { addonState, listAddons, setEnabled } from '@/addons/registry'
import AppIcon from './AppIcon.vue'

const emit = defineEmits<{ (e: 'close'): void }>()
function close() { emit('close') }

/** 按分类分组 */
const groups = computed(() => {
  const m = new Map<string, ReturnType<typeof listAddons>>()
  for (const a of listAddons()) {
    if (!m.has(a.category)) m.set(a.category, [])
    m.get(a.category)!.push(a)
  }
  return [...m.entries()]
})

/** 体积合计：内置代码 KB + 运行时 MB（后者才是大头） */
const totals = computed(() => {
  let kb = 0
  let mb = 0
  for (const a of listAddons()) { kb += a.sizeHint || 0; if (a.runtime) mb += a.runtime.mb }
  return { kb, mb: Math.round(mb * 10) / 10 }
})

function on(id: string) { return addonState.enabled[id] !== false }
function toggle(id: string) { setEnabled(id, !on(id)) }
</script>

<template>
  <div class='am' @mousedown.self='close'>
    <div class='am__box'>
      <header class='am__head'>
        <div class='am__title'><AppIcon name='theme' :size='15' /> 功能管理（Addon）</div>
        <button class='am__x' @click='close'>×</button>
      </header>
      <div class='am__hint'>
        关掉后该功能的<b>入口隐藏、代码不加载</b>；已安装的东西不会丢，随时可以开回来。
        体积为实测：内置代码合计 <b>{{ totals.kb }} KB</b>，外部运行时合计 <b>{{ totals.mb }} MB</b>（大头在运行时）。
      </div>
      <div class='am__body'>
        <section v-for='[cat, list] in groups' :key='cat' class='am__sec'>
          <div class='am__cat'>{{ cat }}</div>
          <label v-for='a in list' :key='a.id' class='am__row' :class="{ 'am__row--off': !on(a.id) }">
            <input type='checkbox' :checked='on(a.id)' @change='toggle(a.id)' />
            <AppIcon :name='a.icon' :size='14' />
            <span class='am__name'>{{ a.name }}</span>
            <span class='am__size' v-if='a.sizeHint'>{{ a.sizeHint }} KB</span>
            <span class='am__size am__size--rt' v-if='a.runtime'>+ {{ a.runtime.mb }} MB</span>
            <span class='am__desc'>{{ a.desc }}</span>
            <span class='am__rt' v-if='a.runtime'>{{ a.runtime.note }}</span>
          </label>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.am { position: fixed; inset: 0; z-index: 500; background: rgba(20, 24, 34, 0.55); display: flex; align-items: center; justify-content: center; }
.am__box { background: var(--panel); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: min(760px, 94vw); max-height: min(78vh, 640px); display: flex; flex-direction: column; }
.am__head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.am__title { font-weight: 700; display: flex; align-items: center; gap: 6px; }
.am__x { border: none; background: transparent; font-size: 18px; cursor: pointer; color: var(--muted); }
.am__hint { padding: 10px 16px; font-size: 12px; line-height: 1.6; color: var(--muted); border-bottom: 1px solid var(--border); }
.am__body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 8px 16px 16px; }
.am__cat { font-size: 12px; font-weight: 700; color: var(--brand); margin: 10px 0 4px; }
.am__row { display: grid; grid-template-columns: 18px 18px 120px 62px 74px 1fr; align-items: center; gap: 6px; padding: 6px 8px; border-radius: var(--radius); cursor: pointer; }
.am__row:hover { background: var(--brand-50); }
.am__row--off { opacity: 0.45; }
.am__name { font-weight: 600; }
.am__size { font-size: 11px; color: var(--muted); text-align: right; }
.am__size--rt { color: #b45309; }
.am__desc { font-size: 12px; color: var(--muted); }
.am__rt { grid-column: 6; font-size: 11px; color: #b45309; }
</style>