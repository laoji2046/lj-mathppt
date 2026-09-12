<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import type { SlideElement } from '@/types'
import { useDeckStore } from '@/stores/deck'
import { hasLocalEngine, loadGeoGebra } from '@/composables/useGeoGebra'
import { describeToCommands } from '@/composables/ggbAI'

const store = useDeckStore()
const emit = defineEmits<{ close: [] }>()
const props = defineProps<{ editId?: string }>()

function findGgbEl(id: string) {
  const sl = (store as unknown as { currentSlide?: { elements: SlideElement[] } }).currentSlide
  return sl?.elements.find((e) => e.id === id)
}

const app = ref('classic')
const showToolBar = ref(true)
const showMenuBar = ref(true)
const showAlgebraInput = ref(true)
const enableShiftDragZoom = ref(true)
const aiDesc = ref('')

const host = ref<HTMLElement | null>(null)
const notice = ref('')
const error = ref('')
let applet: any = null
let ggbId = ''
let noticeTimer: number | undefined
const GGB_CODEBASE = 'geogebra/5.0/web3d/'

function toaster(msg: string) {
  notice.value = msg
  clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => { notice.value = '' }, 2500)
}

/** 真正可调用的实例：getBase64/setBase64 只存在于注入后的 window[ggbId] 上 */
function liveApplet(): any {
  const w = window as any
  return (ggbId && w[ggbId]) ? w[ggbId] : applet
}

async function render() {
  if (host.value) host.value.innerHTML = ''
  applet = null
  error.value = ''
  const editEl = props.editId ? findGgbEl(props.editId) : null
  try {
    const GGBApplet = await loadGeoGebra()
    const id = 'ggb_suite_' + Date.now().toString(36)
    ggbId = id
    const opts: Record<string, unknown> = {
      id,
      appName: app.value,
      showToolBar: showToolBar.value,
      showMenuBar: showMenuBar.value,
      showAlgebraInput: showAlgebraInput.value,
      enableShiftDragZoom: enableShiftDragZoom.value,
      showResetIcon: true,
      borderColor: 'var(--border-strong)',
      width: Math.max(320, host.value?.clientWidth || 640),
      height: Math.max(240, host.value?.clientHeight || 480),
      appletOnLoad: () => {},
    }
    if (editEl && (editEl as unknown as { ggbBase64?: string }).ggbBase64) {
      opts.ggbBase64 = (editEl as unknown as { ggbBase64?: string }).ggbBase64
    }
    applet = new (GGBApplet as any)(opts, true)
    if (typeof applet.setHTML5Codebase === 'function' && (await hasLocalEngine())) {
      applet.setHTML5Codebase(GGB_CODEBASE, true)
    }
    applet.inject(host.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

/** 选项改变时重载：先保存作图(getBase64)→重建→恢复(setBase64)，既不丢内容又应用新选项 */
function reloadKeepContent() {
  const a = liveApplet()
  if (!a || typeof a.getBase64 !== 'function') { render(); return }
  a.getBase64((b64: string) => {
    render()
    const tryRestore = (tries: number) => {
      const live = liveApplet()
      if (live && typeof live.setBase64 === 'function') {
        try { live.setBase64(b64) } catch { /* 忽略 */ }
        return
      }
      if (tries < 25) setTimeout(() => tryRestore(tries + 1), 150)
    }
    tryRestore(0)
  })
}

function onOptionChange(kind: string) {
  if (kind === 'app') render()
  else reloadKeepContent()
}

function bytesDownload(b64: string, name: string, mime: string) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const blob = new Blob([bytes], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function save() {
  const a = liveApplet()
  if (!a || typeof a.getBase64 !== 'function') { toaster('作图器尚未就绪，无法导出'); return }
  try {
    a.getBase64((b64: string) => {
      if (!b64) { toaster('导出失败：未获取到内容'); return }
      bytesDownload(b64, 'ggb-construction.ggb', 'application/zip')
      toaster('已保存为 .ggb（可分享或重新插入）')
    })
  } catch (e) {
    toaster('导出失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

function apply() {
  const a = liveApplet()
  if (!a || typeof a.getBase64 !== 'function') { toaster('作图器尚未就绪，无法应用'); return }
  try {
    a.getBase64((b64: string) => {
      if (!b64) { toaster('应用失败：未获取到内容'); return }
      const patch = {
        ggbBase64: b64,
        app: app.value,
        showToolbar: true,          // 插入/更新一律全功能显示
        showAlgebraInput: true,
        showMenuBar: true,
        enableShiftDragZoom: true,
      } as Partial<SlideElement>
      if (props.editId) store.updateElement(props.editId, patch)
      else store.addElement('geogebra', { ...patch, w: 720, h: 480 } as Partial<SlideElement>)
      emit('close')
    })
  } catch (e) {
    toaster('应用失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

/** AI 作图：把中文描述解析成 GeoGebra 命令并逐个执行 */
function runAI() {
  const a = liveApplet()
  if (!a || typeof a.evalCommand !== 'function') { toaster('作图器尚未就绪'); return }
  const cmds = describeToCommands(aiDesc.value)
  if (!cmds.length) { toaster('未识别到作图指令，可试试：作等边三角形 ABC / AB 中点 M / 过 M 作 BC 的垂线'); return }
  let ok = 0
  for (const c of cmds) { try { a.evalCommand(c); ok++ } catch (e) { console.error(c, e) } }
  toaster('🤖 AI 已执行 ' + ok + '/' + cmds.length + ' 条命令')
}

onMounted(() => {
  if (props.editId) {
    const el = findGgbEl(props.editId)
    if (el && el.type === 'geogebra') {
      app.value = el.app
      // 选项默认全部显示：不再读取元素的选项
      showToolBar.value = true
      showMenuBar.value = true
      showAlgebraInput.value = true
      enableShiftDragZoom.value = true
    }
  }
  render()
})
onBeforeUnmount(() => { if (host.value) host.value.innerHTML = ''; clearTimeout(noticeTimer) })
</script>

<template>
  <Teleport to="body">
    <div class="ggbs">
      <div class="ggbs__backdrop" @click="emit('close')"></div>
      <div class="ggbs__box">
        <header class="ggbs__head">
          <span>GeoGebra 套件 · 作图器</span>
          <button class="ggbs__x" @click="emit('close')" title="关闭"><AppIcon name="close" :size="13" /></button>
        </header>
        <div class="ggbs__body">
          <div class="ggbs__bar">
            <select v-model="app" class="ggbs__sel" @change="onOptionChange('app')">
              <option value="classic">🧩 经典套件（全功能）</option>
              <option value="graphing">图形计算器</option>
              <option value="geometry">几何</option>
              <option value="scientific">科学计算器</option>
              <option value="3d">🧊 3D 计算器</option>
            </select>

          </div>
          <div class="ggbs__ai">
            <span class="ggbs__aiicon">🤖</span>
            <textarea v-model="aiDesc" class="ggbs__aiinput" rows="2" wrap="soft" placeholder="AI 作图（每行一句，回车执行）：
作等边三角形 ABC
M 是 AB 的中点
过 M 作 BC 的垂线
椭圆 F1 F2 3
函数 f(x)=x^2-2x" @keydown.enter.exact.prevent="runAI"></textarea>
            <button class="ggbs__btn ggbs__btn--ai" @click="runAI">生成</button>
          </div>
          <div class="ggbs__canvas"><div ref="host" class="ggbs__host"></div></div>
          <p v-if="error" class="ggbs__err">{{ error }}</p>
        </div>
        <footer class="ggbs__foot">
          <span v-if="notice" class="ggbs__notice">{{ notice }}</span>
          <button class="ggbs__btn" @click="emit('close')">关闭</button>
          <button class="ggbs__btn" @click="save"><AppIcon name="save" :size="14" /> 保存为 .ggb</button>
          <button class="ggbs__btn ggbs__btn--primary" @click="apply">{{ props.editId ? '更新当前页' : '插入当前页' }}</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style>
.ggbs { position: fixed; inset: 0; z-index: 2500; }
.ggbs__backdrop { position: fixed; inset: 0; background: rgba(20, 24, 34, 0.55); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
.ggbs__box {
  position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: min(900px, 92vw); max-height: 92vh; display: flex; flex-direction: column;
  background: #fff; border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); overflow: hidden;
}
.ggbs__head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); font-weight: 700; color: var(--text); font-size: 15px; }
.ggbs__x { border: none; background: transparent; font-size: 18px; cursor: pointer; color: var(--muted); }
.ggbs__x:hover { color: var(--text); }
.ggbs__body { padding: 12px 14px; overflow: auto; }
.ggbs__bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; font-size: 13px; color: var(--muted); }
.ggbs__sel { border: 1px solid var(--border-strong); border-radius: 6px; padding: 3px 8px; font-size: 13px; }
.ggbs__check { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.ggbs__canvas { border: 1px solid var(--border-strong); border-radius: 8px; overflow: hidden; background: #fff; }
.ggbs__host { width: 100%; height: 62vh; min-height: 320px; }
.ggbs__err { color: var(--danger); font-size: 13px; margin: 8px 0 0; }
.ggbs__ai { display: flex; align-items: flex-start; gap: 8px; margin: 4px 0 12px; padding: 8px 10px; background: var(--brand-50); border: 1px solid var(--brand-100); border-radius: 8px; }
.ggbs__aiicon { font-size: 18px; line-height: 24px; }
.ggbs__aiinput { flex: 1; min-height: 48px; height: auto; border: 1px solid var(--border-strong); border-radius: 7px; padding: 6px 10px; font-size: 13px; background: #fff; font-family: inherit; line-height: 1.5; resize: vertical; }
.ggbs__aiinput:focus { outline: none; border-color: var(--brand-600); }
.ggbs__btn--ai { background: var(--brand-600); border-color: var(--brand-600); color: #fff; font-weight: 600; }
.ggbs__btn--ai:hover { background: var(--brand-700); border-color: var(--brand-700); }
.ggbs__foot { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--border); }
.ggbs__notice { color: var(--ok); font-size: 13px; margin-right: auto; }
.ggbs__btn { border: 1px solid var(--border-strong); background: var(--panel-2); color: var(--text); border-radius: 6px; padding: 5px 12px; cursor: pointer; font-size: 13px; }
.ggbs__btn:hover { background: var(--gray-50); }
.ggbs__btn--primary { background: var(--brand); border-color: var(--brand); color: #fff; }
.ggbs__btn--primary:hover { background: var(--brand-strong); }
</style>
