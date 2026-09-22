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
        // 【v1513】那段 JS 指令也存进元素 ✓（回来接着改；"指令模式"的还会存成 commands 自动执行 ✓）
        ...scriptPatch(),
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

/* ---------------- 【v1513】JS 指令：用 JavaScript 控制 GeoGebra 作图 ✓ ----------------
 *
 * 老师要的："添加 javascript 指令 控制 geogebra 作图功能" ✓
 * 做法：把 GeoGebra 的**原生 JS API** 直接交给脚本 —— 脚本里的 `ggb` 就是绘图板 ✓，于是
 *   ggb.evalCommand('Circle((0,0),2)')、ggb.setColor、ggb.startAnimation、ggb.getXML …
 *   官方文档里那些方法**全都能用** ✓（不另造一套小语言 ✗）。
 * 两种模式：
 *   · JavaScript（默认）：整段当函数体跑，能写变量 / 循环 / 读回调；
 *   · GeoGebra 指令：逐行 evalCommand（不会 JS 也能用 ✓，而且这段能存成 commands 随元素自动执行 ✓）。
 * 安全性：脚本在**本机自己的页面**里跑（桌面应用、老师自己写 ✓），但存在元素上的脚本**不自动执行** ✗。
 */
const jsOpen = ref(false)
const jsMode = ref<'js' | 'cmd'>('js')
const script = ref('')
const log = ref<{ ok: boolean; text: string }[]>([])
const ready = ref(false)
let readyTimer: number | undefined

function pushLog(ok: boolean, text: string) {
  log.value = [...log.value.slice(-199), { ok, text: String(text).slice(0, 500) }]
}
function clearLog() { log.value = [] }
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** 等绘图板就绪（GGB 是异步注入的 ✓）—— 面板上给个明确状态，免得点了"运行"没反应 ✗ */
function watchReady() {
  clearInterval(readyTimer)
  ready.value = false
  readyTimer = window.setInterval(() => {
    const a = liveApplet()
    if (a && typeof a.evalCommand === 'function') { ready.value = true; clearInterval(readyTimer) }
  }, 400)
}

function runScript() {
  const a = liveApplet()
  if (!a || typeof a.evalCommand !== 'function') { toaster('作图器还在加载，稍等一下再运行 ✓'); return }
  const src = script.value.trim()
  if (!src) { toaster('先写点指令 ✓'); return }
  if (jsMode.value === 'cmd') {
    let ok = 0
    for (const raw of src.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('//') || line.startsWith('#')) continue
      try {
        const r = a.evalCommand(line)
        pushLog(r !== false, line)
        if (r !== false) ok++
      } catch (e) { pushLog(false, line + ' → ' + errText(e)) }
    }
    toaster('已执行 ' + ok + ' 条 GeoGebra 指令 ✓')
    return
  }
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('ggb', '"use strict";\n' + src)
    const ret = fn(a)
    pushLog(true, 'JS 跑完了' + (ret === undefined ? '' : '，返回：' + String(ret)))
    toaster('JS 已执行 ✓（结果见日志）')
  } catch (e) {
    pushLog(false, 'JS 报错：' + errText(e))
    toaster('JS 报错 ✗（看日志）')
  }
}
function undoGgb() {
  const a = liveApplet()
  try {
    if (a && typeof a.undo === 'function') { a.undo(); pushLog(true, '已撤销一步（ggb.undo()）') }
    else pushLog(false, '这个绘图板没有 undo()')
  } catch (e) { pushLog(false, errText(e)) }
}
function redoGgb() {
  const a = liveApplet()
  try {
    if (a && typeof a.redo === 'function') { a.redo(); pushLog(true, '已重做一步（ggb.redo()）') }
    else pushLog(false, '这个绘图板没有 redo()')
  } catch (e) { pushLog(false, errText(e)) }
}

/** 例子：点一下填进编辑框（不自动跑 ✓ 老师可以先看一眼再运行） */
const SAMPLES: { label: string; mode: 'js' | 'cmd'; code: string }[] = [
  { label: '例：画圆并上色（JS）', mode: 'js', code: [
    "// ggb 就是绘图板，GeoGebra 的 JS API 全都能用",
    "ggb.evalCommand('c: Circle((0,0),2)')",
    "ggb.setColor('c', 200, 60, 60)",
    "ggb.setLineThickness('c', 5)",
    "return ggb.getAllObjectNames().join(', ')",
  ].join('\n') },
  { label: '例：滑动条 + 抛物线动画（JS）', mode: 'js', code: [
    "ggb.evalCommand('a=Slider(-3,3,0.1)')",
    "ggb.evalCommand('f(x)=a x^2')",
    "ggb.setColor('f', 40, 90, 200)",
    "ggb.startAnimation('a')      // 让 a 自己动起来 ✓",
    "return 'a 已在动：' + ggb.getValue('a')",
  ].join('\n') },
  { label: '例：读回作图信息（JS）', mode: 'js', code: [
    "const names = ggb.getAllObjectNames()",
    "const rows = names.map((n) => n + '=' + ggb.getValueString(n))",
    "return names.length + ' 个对象：' + rows.join(' | ')",
  ].join('\n') },
  { label: '例：导出 XML 片段（JS）', mode: 'js', code: [
    "// getXML() 拿到整份作图（可存起来 / 发给别人 ✓）",
    "return ggb.getXML().slice(0, 240) + '…'",
  ].join('\n') },
  { label: '例：三角形 + 中线（指令模式）', mode: 'cmd', code: [
    "A=(0,0)",
    "B=(4,0)",
    "C=(2,3)",
    "poly1=Polygon(A,B,C)",
    "M=Midpoint(A,B)",
    "s=Segment(C,M)",
  ].join('\n') },
]
function loadSample(i: number) {
  const s = SAMPLES[i]
  if (!s) return
  jsMode.value = s.mode
  script.value = s.code
  jsOpen.value = true
  toaster('已填入例子，点「运行」试试 ✓')
}

/** 应用时把脚本一起存到元素上（回来还能接着改 ✓） */
function scriptPatch(): Record<string, unknown> {
  const s = script.value.trim()
  if (!s) return { ggbScript: '', ggbScriptMode: '' }
  const p: Record<string, unknown> = { ggbScript: s, ggbScriptMode: jsMode.value }
  // 「指令模式」的脚本顺手存成 commands ✓ —— 元素打开时自动执行一遍，图形不丢 ✓
  if (jsMode.value === 'cmd') {
    p.commands = s.split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith('//') && !x.startsWith('#'))
  }
  return p
}

onMounted(() => {
  watchReady()
  if (props.editId) {
    const el = findGgbEl(props.editId)
    if (el && el.type === 'geogebra') {
      app.value = el.app
      // 选项默认全部显示：不再读取元素的选项
      showToolBar.value = true
      showMenuBar.value = true
      showAlgebraInput.value = true
      enableShiftDragZoom.value = true
      // 之前写过的脚本，回来接着改 ✓
      const g = el as unknown as { ggbScript?: string; ggbScriptMode?: string }
      if (g.ggbScript) {
        script.value = g.ggbScript
        jsMode.value = g.ggbScriptMode === 'cmd' ? 'cmd' : 'js'
        jsOpen.value = true
      }
    }
  }
  render()
  watchReady()
})
onBeforeUnmount(() => { if (host.value) host.value.innerHTML = ''; clearTimeout(noticeTimer); clearInterval(readyTimer) })
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
          <!-- 【v1513】JS 指令：用 JavaScript 控制作图 ✓ -->
          <div class="ggbs__js" :class="{ 'ggbs__js--open': jsOpen }">
            <button class="ggbs__jshead" @click="jsOpen = !jsOpen">
              <span class="ggbs__jscaret">{{ jsOpen ? '▾' : '▸' }}</span>
              <span>JS 指令（用 JavaScript 控制作图）</span>
              <span class="ggbs__jsstate" :class="{ 'ggbs__jsstate--off': !ready }">{{ ready ? '● 绘图板已就绪' : '○ 正在加载…' }}</span>
              <span class="ggbs__jshint">脚本里 <b>ggb</b> 就是绘图板，GeoGebra 的 JS API 直接可用</span>
            </button>
            <div v-if="jsOpen" class="ggbs__jsbody">
              <div class="ggbs__jsbar">
                <select v-model="jsMode" class="ggbs__sel ggbs__sel--sm" title="JavaScript：整段当函数体跑（能写变量/循环）；GeoGebra 指令：逐行执行（不会 JS 也能用）">
                  <option value="js">JavaScript</option>
                  <option value="cmd">GeoGebra 指令（逐行）</option>
                </select>
                <select class="ggbs__sel ggbs__sel--sm" title="例子：点一下填进编辑框（不自动跑 ✓）" @change="loadSample(Number(($event.target as HTMLSelectElement).value)); ($event.target as HTMLSelectElement).value = ''">
                  <option value="">插入例子…</option>
                  <option v-for="(s, i) in SAMPLES" :key="i" :value="i">{{ s.label }}</option>
                </select>
                <button class="ggbs__btn ggbs__btn--primary" :disabled="!ready" title="运行（Ctrl+Enter ✓）" @click="runScript">▶ 运行</button>
                <button class="ggbs__btn" title="撤销一步（ggb.undo()）" @click="undoGgb">撤销</button>
                <button class="ggbs__btn" title="重做一步（ggb.redo()）" @click="redoGgb">重做</button>
                <button class="ggbs__btn" title="清空下面的日志" @click="clearLog">清日志</button>
              </div>
              <textarea
                v-model="script" class="ggbs__jsinput" rows="6" spellcheck="false" wrap="off"
                :placeholder="jsMode === 'js'
                  ? 'ggb 就是绘图板，例如：\nggb.evalCommand(\'Circle((0,0),2)\')  // 画个圆\nggb.setColor(\'c\', 200, 60, 60)        // 改成红色\nreturn ggb.getAllObjectNames().join(\', \')'
                  : '一行一条 GeoGebra 指令，例如：\nA=(0,0)\nB=(4,0)\nPolygon(A,B,C)'"
                @keydown.ctrl.enter.prevent="runScript"
              ></textarea>
              <div class="ggbs__log">
                <div v-for="(l, i) in log" :key="i" class="ggbs__logline" :class="{ 'ggbs__logline--err': !l.ok }">{{ l.ok ? '✓' : '✗' }} {{ l.text }}</div>
                <div v-if="!log.length" class="ggbs__loghint">运行结果在这儿一行一条 ✓（接口一览：evalCommand / setColor / setCoords / setValue / startAnimation / getValue / getAllObjectNames / getXML / setXML / deleteObject / undo / redo …）</div>
              </div>
            </div>
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
/* 【v1513】JS 指令面板 */
.ggbs__js { border: 1px solid var(--border-strong); border-radius: 8px; background: var(--panel-2); overflow: hidden; }
.ggbs__jshead { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border: 0; background: none; cursor: pointer; text-align: left; font-size: 12.5px; color: var(--text); }
.ggbs__jscaret { color: var(--muted); font-size: 11px; width: 10px; }
.ggbs__jsstate { font-size: 11px; color: var(--ok, #16a34a); }
.ggbs__jsstate--off { color: var(--muted); }
.ggbs__jshint { margin-left: auto; font-size: 11px; color: var(--muted); }
.ggbs__jsbody { padding: 0 10px 10px; display: flex; flex-direction: column; gap: 6px; }
.ggbs__jsbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.ggbs__jsinput { width: 100%; box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; line-height: 1.55; padding: 8px; border: 1px solid var(--border-strong); border-radius: 7px; background: #fff; color: var(--text); resize: vertical; white-space: pre; }
.ggbs__jsinput:focus { outline: none; border-color: var(--brand-600); }
.ggbs__log { max-height: 132px; overflow-y: auto; border: 1px dashed var(--border-strong); border-radius: 7px; background: #fff; padding: 6px 8px; font-size: 11.5px; line-height: 1.6; }
.ggbs__logline { color: #2f6b45; white-space: pre-wrap; word-break: break-all; }
.ggbs__logline--err { color: #b42318; }
.ggbs__loghint { color: var(--muted); }
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
