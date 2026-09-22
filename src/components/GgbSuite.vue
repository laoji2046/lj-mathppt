<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import type { SlideElement } from '@/types'
import { useDeckStore } from '@/stores/deck'
import { hasLocalEngine, loadGeoGebra } from '@/composables/useGeoGebra'
import { describeToCommands } from '@/composables/ggbAI'
import { HELP_GROUPS, SAMPLES, SAMPLE_GROUPS, sampleIndexOf, type GgbHelpItem } from '@/composables/ggbPresets'

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
function runAI() { quietErrors(runAIInner) }
function runAIInner() {
  const a = liveApplet()
  if (!a || typeof a.evalCommand !== 'function') { toaster('作图器尚未就绪'); return }
  const cmds = describeToCommands(aiDesc.value)
  if (!cmds.length) { toaster('未识别到作图指令，可试试：作等边三角形 ABC / AB 中点 M / 过 M 作 BC 的垂线'); return }
  const beforeDefs = defSnapshot()   // 【v1515】AI 作图也一样：跑完清掉上一次留下的 ✓
  const prev = lastCreated.value.slice()
  let ok = 0
  for (const c of cmds) { try { a.evalCommand(c); ok++ } catch (e) { console.error(c, e) } }
  finishRun(beforeDefs, prev)
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

function runScript() { quietErrors(runScriptInner) }
function runScriptInner() {
  const a = liveApplet()
  if (!a || typeof a.evalCommand !== 'function') { toaster('作图器还在加载，稍等一下再运行 ✓'); return }
  const src = script.value.trim()
  if (!src) { toaster('先写点指令 ✓'); return }
  // 【v1515】跑完再收拾：清掉上一次留下的旧图（这次没碰过的），老师手画的不动 ✓
  const beforeDefs = defSnapshot()
  const prev = lastCreated.value.slice()
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
    finishRun(beforeDefs, prev)
    toaster('已执行 ' + ok + ' 条 GeoGebra 指令 ✓')
    return
  }
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('ggb', '"use strict";\n' + src)
    const ret = fn(a)
    finishRun(beforeDefs, prev)
    pushLog(true, 'JS 跑完了' + (ret === undefined ? '' : '，返回：' + String(ret)))
    toaster('JS 已执行 ✓（结果见日志）')
  } catch (e) {
    finishRun(beforeDefs, prev)
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

/** 例子：点一下填进编辑框（不自动跑 ✓ 老师可以先看一眼再运行）—— 例子库在 ggbPresets.ts（40 条，按分组 ✓） */
function loadSample(i: number) {
  const s = SAMPLES[i]
  if (!s) return
  jsMode.value = s.mode
  script.value = s.code
  jsOpen.value = true
  toaster(s.note ? '已填入例子 —— ' + s.note : '已填入例子，点「运行」试试 ✓')
}

/* ---------------- 【v1514】指令帮助面板（老师要的："添加指令帮助按钮" ✓） ----------------
 * 帮助内容是**纯数据**（ggbPresets.ts），这里只管：搜索 / 切分类 / 一键填入 ✓
 * 「填入」的去向按内容自动定：
 *   · GeoGebra 指令 → 指令模式原样插入；JS 模式自动包一层 ggb.evalCommand("…") ✓（免得模式不对跑挂 ✗）
 *   · JavaScript 片段 → 切到 JS 模式插入 ✓
 *   · AI 句型 → 填进上面的「AI 作图」框 ✓
 */
const helpOpen = ref(false)
const helpTab = ref('syntax')
const helpQuery = ref('')
const scriptRef = ref<HTMLTextAreaElement | null>(null)

/** 搜索时忽略当前分类，直接全局过滤 ✓（找不到就给个明确的空状态 ✗） */
const helpShown = computed(() => {
  const q = helpQuery.value.trim().toLowerCase()
  if (!q) {
    const g = HELP_GROUPS.find((x) => x.id === helpTab.value) || HELP_GROUPS[0]
    return [{ id: g.id, title: g.title, tip: g.tip, items: g.items }]
  }
  return HELP_GROUPS
    .map((g) => ({
      id: g.id,
      title: g.title,
      tip: g.tip,
      items: g.items.filter((it) => (it.code + ' ' + it.desc).toLowerCase().includes(q)),
    }))
    .filter((g) => g.items.length)
})
const helpHits = computed(() => helpShown.value.reduce((n, g) => n + g.items.length, 0))

function openHelp(tab?: string) {
  helpTab.value = tab || 'syntax'
  helpQuery.value = ''
  helpOpen.value = true
}
function closeHelp() { helpOpen.value = false }

/** 插到光标处（没光标就追加末尾 ✓）；插完光标落在新内容后面，能接着往下写 ✓ */
function insertAtCursor(text: string) {
  jsOpen.value = true
  nextTick(() => {
    const ta = scriptRef.value
    if (!ta) { script.value = script.value ? script.value + '\n' + text : text; return }
    const start = ta.selectionStart ?? script.value.length
    const end = ta.selectionEnd ?? start
    const before = script.value.slice(0, start)
    const after = script.value.slice(end)
    const pre = before && !before.endsWith('\n') ? '\n' : ''
    const post = after && !after.startsWith('\n') ? '\n' : ''
    script.value = before + pre + text + post + after
    const pos = (before + pre + text).length
    ta.focus()
    ta.setSelectionRange(pos, pos)
  })
}

function useHelpItem(it: GgbHelpItem) {
  if (it.kind === 'say') {
    aiDesc.value = aiDesc.value ? aiDesc.value + '\n' + it.code : it.code
    toaster('已填进「AI 作图」框，点「生成」试试 ✓')
    closeHelp()
    return
  }
  if (it.kind === 'js') {
    jsMode.value = 'js'
    insertAtCursor(it.code)
    toaster('已填进脚本（JavaScript 模式 ✓）')
    return
  }
  // GeoGebra 指令：当前是 JS 模式就包一层（引号用 JSON.stringify 生成，省得手工转义出错 ✗）
  if (jsMode.value === 'js') insertAtCursor('ggb.evalCommand(' + JSON.stringify(it.code) + ')')
  else insertAtCursor(it.code)
  toaster('已填进脚本（' + (jsMode.value === 'js' ? 'JavaScript 模式' : 'GeoGebra 指令模式') + ' ✓）')
}

/* ---------------- 【v1515】运行前清掉上一次画的图（老师反馈 ✓） ----------------
 * 老师原话：「点击执行时，如果指令栏有指令，就会出现图形重叠，所以点执行时要清空指令栏」✓
 * —— 上一次画的图还在板上，新指令又往上画 → 两张图叠在一起 ✗。
 * 做法：跑完之后，把**上一次运行画出来的、这次没碰过的**对象删掉 ✓（默认开，可关，选择会记住 ✓）。
 * 一路踩了两次才定下来（都是真机探针抓的 ✗）：
 *   · 第一版 newConstruction() 清空整块板 ✗ —— 老师手画的图被连累删掉 ✗；
 *   · 第二版"跑之前删上次 diff 出来的对象" ✗ —— 「读回作图信息」这种**只读脚本**也会把上一张图清光 ✗
 *     （老师想看看板上有啥，结果图没了 ✗）；
 *   · 现在：先跑、再收拾 —— 跑完才知道"这次到底画没画东西" ✓：只读脚本啥也没画 → 一个都不清 ✓；
 *     老师手画的对象从没进过名单 → 不动 ✓；被这次重定义过的名字（两次作图共用的 A、B、C）也不算旧图 ✓。
 */
const clearBefore = ref(true)
const CLEAR_PREF = 'lj-mathslides-vue:ggb-clear-before'
/** 上一次运行**画出来的**对象名 —— 只清这些 ✓（老师手画的、绘图板里别的东西都不动 ✓） */
const lastCreated = ref<string[]>([])
function persistClear() {
  try { localStorage.setItem(CLEAR_PREF, clearBefore.value ? '1' : '0') } catch { /* 忽略 */ }
}
/** 板上每个对象的"定义"快照 —— 用来分辨「这次运行新画/改动的」和「上次留下的」✓ */
function defSnapshot(): Record<string, string> {
  const a = liveApplet()
  const map: Record<string, string> = {}
  if (!a || typeof a.getAllObjectNames !== 'function') return map
  let names: string[] = []
  try { names = (a.getAllObjectNames() as string[]) || [] } catch { return map }
  names.forEach((n) => { try { map[n] = String(a.getDefinitionString(n) ?? '') } catch { map[n] = '' } })
  return map
}
/**
 * 跑完收尾：记下这次"新画出来 / 改过定义"的对象 ✓；
 * 再清掉**上一次**留下的那些（这次没碰过的）—— 这就是"新图不和旧图叠在一起" ✓。
 * 为什么放到**跑完**再清 ✗→✓：这样能先知道"这次到底画没画东西" ——
 * 只读脚本（读回信息）什么都没画 → **一个都不清** ✓（老师想看看板上有啥，结果图被清了才是最气人的 ✗）。
 */
let finishTimer: number | undefined
let runSeq = 0
function finishRun(beforeDefs: Record<string, string>, prev: string[]) {
  // ⚠ 等**一拍**再对账（250ms）：刚 evalCommand 完，绘图板可能还没把新对象都摆好 ✗
  // （踩过：立刻对账会漏记几个 → 它们下一轮就"没人管"地留在板上 ✗）
  // 只做**一次**对账 ✗：曾经加过"1.2 秒后再补一次账"，结果老师在这 1.2 秒里手画的东西
  // 被误记成"脚本画的"✗，下一轮就被清掉了 ✗（真机探针 ④ 抓的 ✓）→ 删掉。
  const seq = ++runSeq
  clearTimeout(finishTimer)
  finishTimer = window.setTimeout(() => { if (seq === runSeq) settleRun(beforeDefs, prev) }, 250)
}
function settleRun(beforeDefs: Record<string, string>, prev: string[]) {
  const a = liveApplet()
  const afterDefs = defSnapshot()
  const touched: Record<string, true> = {}
  const mine: string[] = []
  Object.keys(afterDefs).forEach((n) => {
    const isNew = !(n in beforeDefs)
    const changed = !isNew && afterDefs[n] !== beforeDefs[n]
    if (isNew || changed) { touched[n] = true; mine.push(n) }
  })
  lastCreated.value = mine
  if (!clearBefore.value || !mine.length) return   // 没画东西 → 不动板子 ✓
  const victims = prev.filter((n) => !touched[n] && n in afterDefs)
  if (!victims.length) return
  victims.forEach((n) => { try { a.deleteObject(n) } catch { /* 忽略 */ } })
  // 报数按"真的消失了几个上一次画的"算 ✓（删一个多边形会连带删掉它的边 ✗ → 按 victims.length 会少报 ✓）
  const nowDefs = defSnapshot()
  const gone = Object.keys(afterDefs).filter((n) => !(n in nowDefs) && prev.indexOf(n) >= 0)
  if (gone.length) pushLog(true, '已清掉上一次画的 ' + gone.length + ' 个对象 —— 想留着就把上面的「运行前清掉上一次的图」勾掉 ✓')
}

/** Esc 关帮助（帮助开着的时候先关帮助，别一下关到别处去 ✓） */
function onSuiteKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && helpOpen.value) { e.stopPropagation(); closeHelp() }
}

/** 脚本批量跑的时候，先把绘图板自己的报错弹窗关掉 ✓ ——
 *  错误照样进我们日志（✗ 一行），但不会弹 GeoGebra 那个 Modal 把面板挡住 ✗；
 *  老师自己手打指令时的原生报错**照旧**（跑完 1.2 秒恢复 ✓）。 */
function quietErrors<T>(fn: () => T): T {
  const a = liveApplet()
  let restore = false
  try {
    if (a && typeof a.setErrorDialogsActive === 'function') { a.setErrorDialogsActive(false); restore = true }
  } catch { /* 忽略 */ }
  try { return fn() } finally {
    if (restore) window.setTimeout(() => { try { a.setErrorDialogsActive(true) } catch { /* 忽略 */ } }, 1200)
  }
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
  // 【v1515】老师上次把「运行前清空绘图板」关掉过，就记住（别每次都要再关一遍 ✗）
  try {
    const v = localStorage.getItem(CLEAR_PREF)
    if (v === '0') clearBefore.value = false
    else if (v === '1') clearBefore.value = true
  } catch { /* 忽略 */ }
  window.addEventListener('keydown', onSuiteKey)
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
onBeforeUnmount(() => { window.removeEventListener('keydown', onSuiteKey); clearTimeout(finishTimer); if (host.value) host.value.innerHTML = ''; clearTimeout(noticeTimer); clearInterval(readyTimer) })
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
            <button class="ggbs__btn ggbs__btn--help" title="指令帮助：GeoGebra 指令速查 / JavaScript API / AI 句型；点「填入」直接进编辑框 ✓" @click="openHelp('syntax')">📖 指令帮助</button>
            <label class="ggbs__check" title="点「▶ 运行」或「🤖 生成」时，自动清掉**上一次运行画出来的**对象 —— 免得新图跟上一次的图叠在一起 ✗。你手画的图形、绘图板里别的东西都不动 ✓；只读脚本（读回信息）什么都没画，也不会清 ✓；想让两次作图叠着看就把它勾掉 ✓（选择会记住）">
              <input v-model="clearBefore" type="checkbox" @change="persistClear" /> 运行前清掉上一次的图
            </label>
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
                <select class="ggbs__sel ggbs__sel--sm" title="例子：点一下填进编辑框（不自动跑 ✓）；按分组挑，共 {{ SAMPLES.length }} 条" @change="loadSample(Number(($event.target as HTMLSelectElement).value)); ($event.target as HTMLSelectElement).value = ''">
                  <option value="">插入例子…（{{ SAMPLES.length }} 条）</option>
                  <optgroup v-for="g in SAMPLE_GROUPS" :key="g" :label="g">
                    <option v-for="i in sampleIndexOf(g)" :key="i" :value="i">{{ SAMPLES[i].label }}</option>
                  </optgroup>
                </select>
                <button class="ggbs__btn ggbs__btn--primary" :disabled="!ready" title="运行（Ctrl+Enter ✓）" @click="runScript">▶ 运行</button>
                <button class="ggbs__btn" title="撤销一步（ggb.undo()）" @click="undoGgb">撤销</button>
                <button class="ggbs__btn" title="重做一步（ggb.redo()）" @click="redoGgb">重做</button>
                <button class="ggbs__btn" title="清空下面的日志" @click="clearLog">清日志</button>
                <button class="ggbs__btn ggbs__btn--help" title="JavaScript API 一览：点「填入」直接进脚本 ✓" @click="openHelp('js')">📖 帮助</button>
              </div>
              <textarea
                ref="scriptRef" v-model="script" class="ggbs__jsinput" rows="6" spellcheck="false" wrap="off"
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
        <!-- 【v1514】指令帮助面板：搜索 / 分类 / 一键填入 ✓（覆盖在弹窗内容上，不遮标题栏和底部按钮） -->
        <div v-if="helpOpen" class="ggbs__help">
          <div class="ggbs__helphead">
            <span class="ggbs__helptitle">📖 指令帮助</span>
            <input v-model="helpQuery" class="ggbs__helpsearch" type="text" placeholder="搜指令或关键词：切线、中点、动画、颜色、统计、Slider…（留空 = 按分类看）" />
            <span class="ggbs__helphits">{{ helpHits }} 条</span>
            <button class="ggbs__x" title="关闭帮助（Esc ✓）" @click="closeHelp"><AppIcon name="close" :size="13" /></button>
          </div>
          <div class="ggbs__helptabs">
            <button
              v-for="g in HELP_GROUPS" :key="g.id" class="ggbs__helptab"
              :class="{ 'ggbs__helptab--on': !helpQuery.trim() && helpTab === g.id }"
              @click="helpTab = g.id; helpQuery = ''"
            >{{ g.title }}</button>
          </div>
          <div class="ggbs__helpbody">
            <div v-for="g in helpShown" :key="g.id" class="ggbs__helpgroup">
              <div class="ggbs__helpgtitle">{{ g.title }}</div>
              <p v-if="g.tip" class="ggbs__helptip">{{ g.tip }}</p>
              <div v-for="(it, i) in g.items" :key="i" class="ggbs__helprow">
                <code class="ggbs__helpcode">{{ it.code }}</code>
                <span class="ggbs__helpdesc">{{ it.desc }}</span>
                <button class="ggbs__btn ggbs__btn--tiny" @click="useHelpItem(it)">{{ it.kind === 'say' ? '填入 AI 框' : '填入' }}</button>
              </div>
            </div>
            <p v-if="!helpHits" class="ggbs__helpempty">没找到「{{ helpQuery }}」—— 换个词试试：切线、中点、动画、颜色、统计、Slider ✗</p>
            <p class="ggbs__helphint">提示：点「填入」会插到脚本框的光标处 —— 指令模式下是原样一条 GeoGebra 指令，JavaScript 模式下自动包成 <code>ggb.evalCommand("…")</code> ✓</p>
          </div>
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
/* 【v1514】指令帮助面板 + 例子分组 */
.ggbs__btn--help { background: var(--brand-50); border-color: var(--brand-100); color: var(--brand-700); font-weight: 600; }
.ggbs__btn--help:hover { background: var(--brand-100); }
.ggbs__btn--tiny { padding: 2px 8px; font-size: 11.5px; border-radius: 5px; flex: 0 0 auto; }
/* 右侧抽屉：左边留着脚本框/画布 —— 点「填入」能当场看见东西进到脚本里 ✓（铺满整屏就看不见了 ✗） */
.ggbs__help { position: absolute; top: 46px; right: 0; bottom: 52px; width: min(580px, 64%); display: flex; flex-direction: column; background: #fff; border-left: 1px solid var(--border-strong); box-shadow: -10px 0 26px rgba(15, 23, 42, 0.14); z-index: 5; }
.ggbs__helphead { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--border); background: var(--panel-2); }
.ggbs__helptitle { font-weight: 700; font-size: 13px; color: var(--text); white-space: nowrap; }
.ggbs__helpsearch { flex: 1; border: 1px solid var(--border-strong); border-radius: 7px; padding: 5px 9px; font-size: 12.5px; }
.ggbs__helpsearch:focus { outline: none; border-color: var(--brand-600); }
.ggbs__helphits { font-size: 11.5px; color: var(--muted); white-space: nowrap; }
.ggbs__helptabs { display: flex; flex-wrap: wrap; gap: 5px; padding: 7px 14px; border-bottom: 1px dashed var(--border-strong); }
.ggbs__helptab { border: 1px solid var(--border-strong); background: #fff; color: var(--text); border-radius: 999px; padding: 3px 10px; font-size: 12px; cursor: pointer; }
.ggbs__helptab:hover { background: var(--gray-50); }
.ggbs__helptab--on { background: var(--brand); border-color: var(--brand); color: #fff; font-weight: 600; }
.ggbs__helpbody { flex: 1; overflow: auto; padding: 8px 14px 14px; }
.ggbs__helpgtitle { font-size: 12.5px; font-weight: 700; color: var(--brand-700); margin: 8px 0 4px; }
.ggbs__helptip { font-size: 12px; color: var(--muted); margin: 0 0 6px; line-height: 1.6; }
.ggbs__helprow { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 6px; }
.ggbs__helprow:hover { background: var(--brand-50); }
.ggbs__helpcode { flex: 0 0 auto; max-width: 46%; overflow-x: auto; white-space: pre; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: #0b4a8f; background: var(--panel-2); border: 1px solid var(--border); border-radius: 5px; padding: 2px 6px; }
.ggbs__helpdesc { flex: 1; font-size: 12px; color: var(--text); line-height: 1.5; }
.ggbs__helpempty { color: var(--danger); font-size: 12.5px; }
.ggbs__helphint { margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--border-strong); font-size: 11.5px; color: var(--muted); line-height: 1.7; }
.ggbs__helphint code { font-family: ui-monospace, Menlo, Consolas, monospace; background: var(--panel-2); border: 1px solid var(--border); border-radius: 4px; padding: 1px 4px; }

</style>
