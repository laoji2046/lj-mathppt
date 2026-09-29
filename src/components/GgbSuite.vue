<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import type { SlideElement } from '@/types'
import { useDeckStore } from '@/stores/deck'
import { hasLocalEngine, loadGeoGebra } from '@/composables/useGeoGebra'
import { describeToCommands } from '@/composables/ggbAI'
import { GGB_QUERY_TMP, ggbAutoQueries, ggbBriefText, ggbCheckResult, ggbCheckSystem, ggbCheckUser, ggbDeleteClosure, ggbDeleteTargets, ggbPlanGraph, ggbQueryCmd, ggbReadBrief, ggbReadPlan, ggbReadSystem, ggbRepairSystem, ggbRepairUser, ggbSolvePlan, ggbSolveSystem, ggbSolveUser, ggbToolOf, ggbValidatePlan, ggbVisionGuard, type GgbReadout, type GgbSolveStep } from '@/composables/ggbSolve'
import { settingsOpen } from '@/ui/menus'
import { loadImg, prepImageEl } from '@/composables/imgPrep'
import { scanFromResult, scanToBrief } from '@/composables/figScan'
import { vectorizeInWorker } from '@/composables/figScanRun'
import { licensed } from '@/composables/useLicense'
import { invoke } from '@/composables/useTauri'
import ScreenshotCapture from './ScreenshotCapture.vue'
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
const GGB_CODEBASE = import.meta.env.BASE_URL + 'geogebra/5.0/web3d/'

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

/* ---------------- 【v1711】贴图解题作图：题目图 → 解题过程 + 自动切工具作图 ----------------
 *
 * 老师口径：导入图片或截图 → 自动生成求解过程 → 在绘图套件里画出来 → 自动切换套件中的工具。
 * 分工：模型只负责「想」（给 solution + steps 的 JSON），这里负责**执行**（setMode → evalCommand）。
 */
const solveImgs = ref<string[]>([])
const solveSay = ref("")
const solving = ref(false)
const solution = ref("")
const solveLog = ref<string[]>([])
const solveShot = ref(false)
const solveFile = ref<HTMLInputElement | null>(null)
const MAX_SOLVE_IMG = 3

/* ---------------- 【v1732】删除与回滚：画错了能撤、撤得干净 ----------------
 * ① 删一步：先算出「连带会掉哪些依赖」→ 执行 → 日志里报出来 ✓
 *    优先问绘图板自己的 getDependentObjects ✓（权威 ✓），拿不到就用 plan 依赖图兜底 ✓
 * ② 回滚：跑之前存一份**整块画布**快照（getXML ✓ 含视图），一键 setXML 回到作图前 ✓
 *    —— 比「清掉上一次画的对象」更彻底：连**被改过定义/样式**的对象也能恢复 ✓
 */
const runSnap = ref("")

/** 【v1732】整块画布快照（含视图 ✓）—— 回滚用 ✓ */
function snapXml(a: any): string {
  try { return typeof a.getXML === "function" ? String(a.getXML()) : "" } catch { return "" }
}

/** 【v1732】问绘图板：这些对象各自依赖了谁（拿不到就返回空 → 调用方用 plan 图兜底 ✓） */
function depsOfApi(a: any, names: string[]): string[] {
  const out: string[] = []
  try {
    if (typeof a.getDependentObjects !== "function") return out
    for (const n of names) {
      const ds = a.getDependentObjects(n) as string[] | undefined
      for (const d of ds || []) if (d && out.indexOf(d) < 0) out.push(d)
    }
  } catch { /* 拿不到就算了 ✓ */ }
  return out
}

/** 【v1732】一键回滚到「本次作图前」✓（整块画布 + 视图一起恢复 ✗ 这之后手改的也会没 ✓ 提示里写清 ✓） */
function rollbackRunInner() {
  const a = liveApplet()
  if (!a || typeof a.setXML !== "function") { toaster("这个绘图板不支持 setXML，撤不回去 ✗"); return }
  if (!runSnap.value) { toaster("还没有快照：先跑一次「③ 解题并作图」✓"); return }
  try {
    a.setXML(runSnap.value)
    lastCreated.value = []
    checkNote.value = ""
    solveLog.value.push("· ↩ 已回滚到本次作图前（整块画布 + 视图 ✓）")
    toaster("已回到本次作图前的画布 ✓")
  } catch (e) {
    toaster("回滚失败：" + String((e as Error)?.message || e))
  }
}
function rollbackRun() { quietErrors(rollbackRunInner) }
/* ---------------- 【v1731】读数（query）：把画布上的**精确值**交回模型 ----------------
 * 依据（Draw2Think, arXiv:2605.20743）：最值钱的一层是 **query 读回** ——
 *   "readout is part of reasoning"：把引擎的精确状态变成可回答的证据 ✓
 *   ① 模型可以主动插只读步骤（tool: query）问「AB 多长 / 这个角多少度」✓
 *   ② 跑完**自动量一批**（点坐标 / 线段长 / 半径 / 面积）→ 交给模型自查「解题与图形是否自洽」✓
 * 实现：临时对象量一下 → 立刻删掉 ✓ 画布不留垃圾 ✓
 */
const checkNote = ref("")
const checkOn = ref(true)

/** 画布现在的对象名（读数要拿它自查"这个名字认不认" ✓） */
function liveObjects(a: any): string[] {
  try { return typeof a.getAllObjectNames === "function" ? (a.getAllObjectNames() as string[]) : [] } catch { return [] }
}

/** 【v1731】量一组只读表达式 → 读数表 ✓（临时对象 + 立刻删除 ✓ 单条失败不影响其它 ✓） */
async function runQueryExprs(a: any, exprs: string[], say: string): Promise<GgbReadout[]> {
  const out: GgbReadout[] = []
  for (const raw of exprs) {
    const q = ggbReadPlan(raw, liveObjects(a))
    if (!q.ok) {
      out.push({ expr: String(raw || ""), value: "", ok: false, err: q.why })
      solveLog.value.push("读数 ✗ " + String(raw || "") + "（" + (q.why || "不合法") + "）")
      continue
    }
    try {
      a.evalCommand(ggbQueryCmd(q.expr))
      const v = typeof a.getValue === "function" ? Number(a.getValue(GGB_QUERY_TMP)) : NaN
      const val = Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : ""
      out.push({ expr: q.expr, value: val, ok: !!val })
      solveLog.value.push("读数 " + q.expr + " = " + (val || "（取不到）") + (say ? "　// " + say : ""))
    } catch (e) {
      const msg = String((e as Error)?.message || e)
      out.push({ expr: q.expr, value: "", ok: false, err: msg })
      solveLog.value.push("读数 ✗ " + q.expr + "：" + msg)
    } finally {
      try { if (typeof a.deleteObject === "function") a.deleteObject(GGB_QUERY_TMP) } catch { /* 删不掉也无所谓：下次同名覆盖 ✓ */ }
    }
  }
  return out
}
/* ---------------- 【v1729】识图解题三段式：① 读图（只转写）→ ② 校对（可编辑）→ ③ 解题作图（校验 + 自愈）-------
 * 为什么拆：原来一步里让模型同时「读图 + 推理 + 写 GeoGebra 语法」✗ —— 三件事捆一起，
 *   看错了 / 算错了 / 写错了根本分不清 ✓ 现在：读图只转写（不猜、不解题 ✓）→ 老师校对文字（最便宜的纠错点 ✓）
 *   → 文本模型解题作图（不带图 ✓ 便宜又准 ✓）→ 执行前静态校验 → 报错的步骤回灌修一轮 ✓
 */
const solveBrief = ref("")
const reading = ref(false)
const repairOn = ref(true)

/** 【v1729】带图但没配视觉模型 → 面板上一直挂着这句（原来会**静默**把图发给纯文本模型 ✗） */
const solveVisionWarn = computed(() => ggbVisionGuard(solveImgs.value.length > 0, solveVisionModel()))
function openAiSettings() { settingsOpen.value = true }

/** 【v1729】调模型（读图 / 解题 / 修错共用 ✓）—— 失败把原话抛出来，别吞 ✗ */
async function solveChat(opts: { system: string; content: unknown; model: string; baseUrl: string }): Promise<string> {
  const key = solveAiKey()
  if (!key) throw new Error("还没填 AI Key：设置 → AI 助手")
  const r = await invoke<{ ok?: boolean; json?: unknown; error?: string }>("ai_chat_raw", {
    baseUrl: opts.baseUrl, apiKey: key,
    body: { model: opts.model, temperature: 0, messages: [{ role: "system", content: opts.system }, { role: "user", content: opts.content }] },
  })
  if (!r || r.ok === false) throw new Error(String((r && r.error) || "工具通道调用失败"))
  const j = (r.json || {}) as { choices?: { message?: { content?: string } }[] }
  const text = String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "")
  if (!text.trim()) throw new Error("模型返回了空内容（端点或模型名可能不对）")
  return text
}

/** 【v1729】① 读图：把题图**转写成文字**（不许解题 ✓ 不许猜 ✓），结果放进可编辑的校对框 ✓ */
async function readProblemInner() {
  if (!licensed("ai-assistant")) { toaster("AI 助手要先激活：工具栏「激活 / 序列号」"); return }
  const raw = solveImgs.value.slice(0, MAX_SOLVE_IMG)
  if (raw.length && solveVisionWarn.value) { toaster("带图要先配视觉模型：设置 → AI 助手 → 视觉模型"); return }
  const imgs = raw.length ? await prepSolveImages() : raw   // 【v1730】先预处理：去白边 + 放大 ✓ 视觉模型看得更清 ✓
  reading.value = true
  solveLog.value = []
  try {
    if (imgs.length) {
      const ask = "请转写这张题图。" + (solveSay.value.trim() ? String.fromCharCode(10) + "补充：" + solveSay.value.trim() : "")
      const text = await solveChat({
        system: ggbReadSystem(),
        content: [{ type: "text", text: ask }, ...imgs.map((u) => ({ type: "image_url", image_url: { url: u } }))],
        model: solveVisionModel(), baseUrl: solveVisionBase(),
      })
      const b = ggbReadBrief(text)
      solveBrief.value = ggbBriefText(b)
      solveLog.value.push("已读图：题干 " + b.text.length + " 字、已知 " + b.given.length + " 条、图形要素 " + b.figure.length + " 条")
      for (const u of b.unsure) solveLog.value.push("· ⚠ 待确认：" + u)
      toaster(b.unsure.length
        ? "读好了 —— 有 " + b.unsure.length + " 处拿不准，改完再点「③ 解题并作图」✓"
        : "读好了 ✓ 核对一下校对框里的文字，再点「③ 解题并作图」✓")
    } else {
      const t = solveSay.value.trim()
      if (!t) { toaster("先贴一张题目图（点「＋ 题目图 / 截图」），或直接写一句题干 ✓"); return }
      solveBrief.value = "【题干】" + t
      toaster("没贴图：把写的题干放进校对框了，直接点「③ 解题并作图」✓")
    }
  } finally { reading.value = false }
}
function readProblem() { quietErrors(readProblemInner) }

/** 【v1729】跑一串步骤：切工具 → evalCommand；失败收进 fails ✓ 返回成功条数 */
async function runSolveSteps(a: any, steps: GgbSolveStep[], fails: { cmd: string; err: string }[], readouts?: GgbReadout[]): Promise<number> {
  let ok = 0
  for (const s of steps) {
    // 【v1731】读一步：量一下（临时对象 → 立刻删 ✓ 不留垃圾 ✓ 不切工具 ✓）
    if (s.query) {
      const rs = await runQueryExprs(a, [s.cmd], s.say)
      if (readouts) for (const r of rs) readouts.push(r)
      continue
    }
    // 【v1732】删一步：先算出「连带会掉哪些依赖」→ 执行 → 日志里报出来 ✓
    if (s.tool === "delete") {
      const tg = ggbDeleteTargets(s.cmd)
      const graph = ggbPlanGraph(steps)
      const planDep: string[] = []
      for (const t of tg) for (const n of ggbDeleteClosure(t, graph)) if (n !== t && planDep.indexOf(n) < 0) planDep.push(n)
      const apiDep = depsOfApi(a, tg)
      const extra = (apiDep.length ? apiDep : planDep).filter((n) => tg.indexOf(n) < 0)
      try {
        a.evalCommand(s.cmd)
        ok++
        solveLog.value.push("删 " + (tg.join("、") || s.cmd) + (extra.length ? "（连带依赖 " + extra.slice(0, 8).join("、") + (extra.length > 8 ? " …" : "") + "）" : "") + (s.say ? "　// " + s.say : "") + " ✓")
      } catch (err) {
        const msg = String((err as Error)?.message || err)
        fails.push({ cmd: s.cmd, err: msg })
        solveLog.value.push(s.cmd + " ✗ " + msg)
      }
      continue
    }
    if (s.tool) {
      try { a.setMode(s.mode); solveLog.value.push("切换工具：" + (ggbToolOf(s.tool)?.label || s.tool)) } catch { /* 切不动就跳过 ✓ */ }
      await new Promise((res) => window.setTimeout(res, 140))
    }
    try {
      a.evalCommand(s.cmd)
      ok++
      solveLog.value.push(s.cmd + (s.say ? "　// " + s.say : "") + " ✓")
    } catch (err) {
      const msg = String((err as Error)?.message || err)
      fails.push({ cmd: s.cmd, err: msg })
      solveLog.value.push(s.cmd + " ✗ " + msg)
    }
    await new Promise((res) => window.setTimeout(res, 90))
  }
  return ok
}

/** 【v1729】执行后校验：`X=…` 的对象是否真建出来了（拿不到对象表就不下结论 ✓ 免得误报 ✗） */
function missingObjects(a: any, steps: GgbSolveStep[]): string[] {
  const names: string[] = []
  for (const s of steps) {
    const m = /^\s*([A-Za-z][A-Za-z0-9_']*)\s*(?:\([^)]*\))?\s*=/.exec(s.cmd)
    if (m) names.push(m[1])
  }
  if (!names.length) return []
  let list: string[] | null = null
  try { if (typeof a.getAllObjectNames === "function") list = a.getAllObjectNames() as string[] } catch { list = null }
  if (!list) return []
  return names.filter((n) => list.indexOf(n) < 0)
}
/* ---------------- 【v1730】第 4 层：题图预处理 + 复用「矢量识别」认图形 ----------------
 * ① 读图前先把题图**预处理**一遍（去白边 / 放大 / 灰度对比 ✓）→ 视觉模型看得更清 ✓
 * ② 「认图形」把同一张图交给**已有的矢量识别**（点 / 线段 / 圆 + 字母标注 ✓）
 *   → 结构描述写进校对框 ✓ —— 让模型看图"估坐标"是最不准的一环 ✗ 认出来的真点真线稳得多 ✓
 */
const scanning = ref(false)
const scanNote = ref("")

/** 【v1730】把贴的题图逐张预处理（失败就用原图 ✓ 不拦流程 ✓） */
async function prepSolveImages(): Promise<string[]> {
  const raw = solveImgs.value.slice(0, MAX_SOLVE_IMG)
  const out: string[] = []
  for (const u of raw) {
    try {
      const el = await loadImg(u)
      const r = await prepImageEl(el, { target: 900, maxScale: 3 })
      out.push(r.dataUrl)
      solveLog.value.push("· 预处理：去白边 " + r.info.before[0] + "×" + r.info.before[1] + " → " + r.info.after[0] + "×" + r.info.after[1] + "（缩放 " + r.info.scale.toFixed(2) + "×）")
    } catch (e) {
      solveLog.value.push("· 预处理没成（就用原图）：" + String((e as Error)?.message || e))
      out.push(u)
    }
  }
  return out.length ? out : raw
}

/** 【v1730】② 认图形：矢量识别 → 几何要素 → 结构描述写进校对框 ✓（可选，但很值 ✓） */
async function scanFigureInner() {
  if (!licensed("ai-assistant")) { toaster("AI 助手要先激活：工具栏「激活 / 序列号」"); return }
  const src = solveImgs.value[0] || ""
  if (!src) { toaster("先贴一张题目图（点「＋ 题目图 / 截图」）✓"); return }
  scanning.value = true
  try {
    const raw = await loadImg(src)
    const pr = await prepImageEl(raw, { target: 900, maxScale: 3 })
    const el = await loadImg(pr.dataUrl)
    const res = await vectorizeInWorker(el, {})
    const fig = scanFromResult(res)
    scanNote.value = "认出 " + fig.points.length + " 个顶点（带字母标注 " + fig.labelled + " 个）、" + fig.edges.length + " 条线段、" + fig.circles.length + " 个圆/弧"
    solveLog.value.push("· ② 认图形：" + scanNote.value)
    // 上一次自动识别的那一段换掉（别越堆越多 ✓）
    const at = solveBrief.value.indexOf("【图形（自动识别")
    if (at >= 0) solveBrief.value = solveBrief.value.slice(0, at).replace(/\s+$/, "")
    solveBrief.value = (solveBrief.value ? solveBrief.value + String.fromCharCode(10, 10) : "") + scanToBrief(fig)
    if (fig.points.length < 2) {
      solveLog.value.push("· ⚠ 认出来的顶点太少 —— 这张图可能不是线稿（照片 / 阴影 / 手写），或者图形太小；按题干自己判断就行 ✓")
      toaster("没认出多少图形元素（见日志）—— 不影响照常解题 ✓")
    } else toaster("认出来了：" + scanNote.value + " ✓ 结构已写进校对框")
  } finally { scanning.value = false }
}
function scanFigure() { quietErrors(scanFigureInner) }
/** AI Key / 视觉模型：与其它 AI 面板同一口径（键名不写死，设置里存的哪个就用哪个） */
function solveAiKey(): string {
  try {
    for (const k of Object.keys(localStorage)) {
      if (!/ai[-_]?key/i.test(k)) continue
      const v = String(localStorage.getItem(k) || "").trim()
      if (v) return v
    }
  } catch { /* 隐私模式读不到就算了 */ }
  return ""
}
function solveVisionModel(): string { try { return String(localStorage.getItem("lj-mathslides:vision-model") || "").trim() } catch { return "" } }
function solveVisionBase(): string { try { return String(localStorage.getItem("lj-mathslides:vision-base") || "").trim() } catch { return "" } }

function readAsDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result || ""))
    r.onerror = () => rej(new Error("读图失败"))
    r.readAsDataURL(f)
  })
}
async function addSolveFiles(files: File[]) {
  for (const f of files) {
    if (solveImgs.value.length >= MAX_SOLVE_IMG) { toaster("最多贴 " + MAX_SOLVE_IMG + " 张题目图"); break }
    if (!f.type || f.type.indexOf("image/") !== 0) continue
    if (f.size > 4 * 1024 * 1024) { toaster(f.name + " 超过 4MB，先压一下"); continue }
    try { solveImgs.value.push(await readAsDataUrl(f)) } catch { toaster(f.name + " 读不出来") }
  }
}
async function onSolvePick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ""
  await addSolveFiles(files)
}
async function onSolvePaste(e: ClipboardEvent) {
  const items = Array.from((e.clipboardData && e.clipboardData.items) || [])
  const files: File[] = []
  for (const it of items) { if (it.kind === "file") { const f = it.getAsFile(); if (f) files.push(f) } }
  if (files.length) { e.preventDefault(); await addSolveFiles(files); toaster("已贴进 " + solveImgs.value.length + " 张题目图 ✓ 点「解题并作图」") }
}
function onSolveShot(url: string) {
  solveShot.value = false
  if (!url) return
  if (solveImgs.value.length >= MAX_SOLVE_IMG) { toaster("最多贴 " + MAX_SOLVE_IMG + " 张题目图"); return }
  solveImgs.value.push(url)
  toaster("截图已当题目图 ✓ 点「解题并作图」")
}

/** 点「解题并作图」：模型想 → 按步骤切工具 + 作图 ✓ */
function solveAndDraw() { quietErrors(solveAndDrawInner) }
async function solveAndDrawInner() {
  const a = liveApplet()
  if (!a || typeof a.evalCommand !== "function") { toaster("作图器尚未就绪"); return }
  const brief = solveBrief.value.trim()
  if (!brief && !solveImgs.value.length && !solveSay.value.trim()) { toaster("先贴一张题目图（点「① 读图」），或直接写一句题干 ✓"); return }
  if (!brief) { toaster(solveImgs.value.length ? "先点「① 读图」把题图转成文字、核对一遍，再解题 ✓" : "先写一句题干，或点「① 读图」✓"); return }
  if (!licensed("ai-assistant")) { toaster("AI 助手要先激活：工具栏「激活 / 序列号」"); return }
  if (!solveAiKey()) { toaster("还没填 AI Key：设置 → AI 助手 ✓"); return }
  runSnap.value = snapXml(a)   // 【v1732】跑之前先存整块画布快照 ✓ 跑砸了一键回滚 ✓
  solving.value = true
  solveLog.value = []
  solution.value = ""
  try {
    // 【v1729】解题这一步**只用文本**（题干已读成文字、老师也校对过 ✓）—— 便宜、且不再依赖视觉模型 ✓
    const text = await solveChat({ system: ggbSolveSystem(), content: ggbSolveUser(brief, solveSay.value.trim()), model: "deepseek-chat", baseUrl: "" })
    const plan = ggbSolvePlan(text)
    solution.value = plan.solution
    for (const n of plan.notes) solveLog.value.push("· " + n)
    if (!plan.steps.length) { toaster("它没给出作图步骤 —— 解题过程放在下面了 ✓"); return }
    // 【v1729】执行前静态校验：全角标点 / 一行多条 / 括号配平 / 依赖顺序（纯函数 ✓）
    const chk = ggbValidatePlan(plan.steps, liveObjects(a))   // 【v1731】画布上已有的对象一起传进去 ✓ 不再误报依赖顺序 ✓
    if (chk.fixes.length) solveLog.value.push("· 执行前自动修正 " + chk.fixes.length + " 处：" + chk.fixes.slice(0, 4).join("；"))
    for (const it of chk.issues) solveLog.value.push("· ⚠ " + it)
    const beforeDefs = defSnapshot()
    const prev = lastCreated.value.slice()
    const fails: { cmd: string; err: string }[] = []
    const readouts: GgbReadout[] = []   // 【v1731】读数（模型主动问的 + 跑完自动量的 ✓）
    const ok = await runSolveSteps(a, chk.steps, fails, readouts)
    // 【v1729】自愈：只把**报错的那几步**回灌给模型改一轮 ✓（默认勾上 ✓）
    let fixed = 0
    if (fails.length && repairOn.value) {
      try {
        const objs = liveObjects(a).slice(0, 80)
        const rt = await solveChat({ system: ggbRepairSystem(), content: ggbRepairUser(fails, objs, brief), model: "deepseek-chat", baseUrl: "" })
        const rp = ggbValidatePlan(ggbSolvePlan(rt).steps, objs)
        if (rp.steps.length) {
          solveLog.value.push("· 自愈：模型给了 " + rp.steps.length + " 步修正，重跑一遍 ✓")
          fixed = await runSolveSteps(a, rp.steps, [], readouts)
        } else solveLog.value.push("· 自愈：模型没给出可用的修正步骤")
      } catch (e) { solveLog.value.push("· 自愈没跑成：" + String((e as Error)?.message || e)) }
    }
    finishRun(beforeDefs, prev)
    const miss = missingObjects(a, chk.steps)
    if (miss.length) solveLog.value.push("· ⚠ 有 " + miss.length + " 个对象没建出来：" + miss.slice(0, 6).join("、"))
    // 【v1731】自动读数 + 核对轮：把**画布上的精确值**交回模型自查（读数本身就是证据 ✓）
    checkNote.value = ""
    const autoQ = ggbAutoQueries(chk.steps)
    if (autoQ.length) {
      const ar = await runQueryExprs(a, autoQ, "自动读数")
      for (const r of ar) readouts.push(r)
    }
    if (readouts.length) solveLog.value.push("· 读数 " + readouts.length + " 条（" + readouts.filter((r) => r.ok).length + " 条取到值）")
    if (checkOn.value && readouts.length) {
      try {
        const ctext = await solveChat({ system: ggbCheckSystem(), content: ggbCheckUser(brief, solution.value, chk.steps.map((x) => x.cmd), readouts), model: "deepseek-chat", baseUrl: "" })
        const ck = ggbCheckResult(ctext, liveObjects(a))
        checkNote.value = (ck.verdict === "mismatch" ? "⚠ 不一致：" : ck.verdict === "ok" ? "✓ 自洽：" : "？ 拿不准：") + (ck.note || "（没写说明）")
        solveLog.value.push("· 核对：" + checkNote.value)
        if (ck.verdict === "mismatch" && ck.steps.length && repairOn.value) {
          const b2 = defSnapshot()
          const p2 = lastCreated.value.slice()
          const f2: { cmd: string; err: string }[] = []
          const ok2 = await runSolveSteps(a, ck.steps, f2, [])
          finishRun(b2, p2)
          solveLog.value.push("· 核对后改了 " + ok2 + "/" + ck.steps.length + " 步" + (f2.length ? "（失败 " + f2.length + " 步）" : "") + " ✓")
        }
      } catch (e) { solveLog.value.push("· 核对没跑成：" + String((e as Error)?.message || e)) }
    }
    toaster("🤖 已解题并作图：" + ok + "/" + chk.steps.length + " 条" + (readouts.length ? "，读数 " + readouts.length + " 条" : "") + (fails.length ? "，失败 " + fails.length + " 步" : "") + (fixed ? "，自愈修好 " + fixed + " 步" : "") + (checkNote.value ? "，已核对" : "") + " ✓")
  } finally {
    solving.value = false
  }
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
const jsOpen = ref(true)   // 【v1517】右栏默认就把脚本框摊开 ✓（面板挪到绘图板右边之后，收起反而多余）

/**
 * 【v1517】AutoClose 虚拟键盘。
 * 这台机器（以及很多老师笔记本）是**触摸屏**，WebView2 如实上报 navigator.maxTouchPoints > 0 ✗ →
 * GeoGebra 自作主张把**虚拟键盘**摊在板子下面 ✗，一做就是 221px（板面的三分之一 ✗）；
 * 而且它内部按"键盘在"扣掉那块高度 ✗ —— 光用 CSS 藏只会留一条空白 ✗（实测 ✗）。
 * 正确做法：**点它自己的关闭按钮**（.closeTabbedKeyboardButton ✓）→ GeoGebra 真收起 + 重排 ✓；
 * 老师想用键盘时，点输入框那个 ⌨ 图标它还会回来 ✓（GeoGebra 原生行为，我们不抢 ✓）。
 */
const kbdReserve = ref(0)          // 键盘那一条的高度（GWT 会一直留着它 ✗ → 得自己补回来 ✓）
let kbdObs: MutationObserver | undefined

/** 把键盘收起来（display:none ✓ —— 点它自己的 ✕ 那一招**在真机上没用** ✗，实测 ✓） */
function hideVirtualKeyboard(tries = 0) {
  const h = host.value
  if (!h) return
  const kbd = h.querySelector('.KeyBoard') as HTMLElement | null
  if (!kbd) { if (tries < 20) window.setTimeout(() => hideVirtualKeyboard(tries + 1), 300); return }
  if (getComputedStyle(kbd).display !== 'none') {
    const kh = Math.round(kbd.getBoundingClientRect().height)
    if (kh > 40) kbdReserve.value = kh
    kbd.style.display = 'none'
    window.setTimeout(resizeApplet, 150)
  }
  // 老师要是自己把键盘点出来（样式变了），立刻重排一次 —— 让键盘待在板子里面 ✓ 而不是被裁掉 ✗
  if (!kbdObs) {
    kbdObs = new MutationObserver(() => resizeApplet())
    kbdObs.observe(kbd, { attributes: true, attributeFilter: ['style', 'class'] })
  }
}

/**
 * 藏掉键盘之后要**逼 GeoGebra 重排一次** ✗→✓：
 * 它内部是 GWT 的 SplitLayoutPanel（绝对定位），把键盘 display:none 只是让它不画 ✓，
 * 但**那块地方不会被让出来** ✗（截图里板子下面空了一大条 ✗）→ setSize() 一下，视图就重新铺满了 ✓。
 */
function resizeApplet() {
  const a = liveApplet()
  const h = host.value
  if (!a || !h) return
  const w = Math.max(320, h.clientWidth || 640)
  const ht = Math.max(240, h.clientHeight || 480)
  const kbd = h.querySelector('.KeyBoard') as HTMLElement | null
  const kbdVisible = !!kbd && getComputedStyle(kbd).display !== 'none'
  if (kbdVisible) { const kh = Math.round(kbd!.getBoundingClientRect().height); if (kh > 40) kbdReserve.value = kh }
  // 键盘收着时，GWT 仍然把它那一条留着 ✗（板子下面空一大条 ✗）→ 把 applet 高度**多加**那一条，
  // 多出来的部分正好被我们的 .ggbs__canvas{overflow:hidden} 裁掉 ✓，视图就拿满整个容器 ✓
  const extra = kbdVisible ? 0 : kbdReserve.value
  try {
    if (typeof a.setSize === 'function') a.setSize(w, ht + extra)
    else {
      if (typeof a.setWidth === 'function') a.setWidth(w)
      if (typeof a.setHeight === 'function') a.setHeight(ht + extra)
    }
  } catch { /* 忽略 */ }
}
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
    if (a && typeof a.evalCommand === 'function') {
      ready.value = true
      clearInterval(readyTimer)
      window.setTimeout(hideVirtualKeyboard, 300)   // 【v1517】收起触摸屏虚拟键盘（它占 221px ✗）
      window.setTimeout(resizeApplet, 700)
    }
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
onBeforeUnmount(() => { if (kbdObs) { kbdObs.disconnect(); kbdObs = undefined } window.removeEventListener('keydown', onSuiteKey); clearTimeout(finishTimer); if (host.value) host.value.innerHTML = ''; clearTimeout(noticeTimer); clearInterval(readyTimer) })
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
            <label class="ggbs__check" title="点「▶ 运行」或「🤖 生成」时，自动清掉上一次运行画出来的对象 —— 免得新图跟上一次的图叠在一起 ✗。你手画的图形、绘图板里别的东西都不动 ✓；只读脚本（读回信息）什么都没画，也不会清 ✓；想让两次作图叠着看就把它勾掉 ✓（选择会记住）">
              <input v-model="clearBefore" type="checkbox" @change="persistClear" /> 运行前清掉上一次的图
            </label>
          </div>
          <div class="ggbs__main">
            <div class="ggbs__left">
              <div class="ggbs__canvas"><div ref="host" class="ggbs__host"></div></div>
            </div>
            <div class="ggbs__side">
<!-- 【v1711】贴图解题作图：题目图 → 解题过程 + 自动切工具作图 ✓ -->
            <div class="ggbs__solve">
              <div class="ggbs__solvehead">
                <span class="ggbs__aiicon">🧠</span>
                <span class="ggbs__solvet">贴图解题作图</span>
                <span class="ggbs__solves">① 读图转文字（可校对）→ ② 认图形（可选）→ ③ 解题并作图（自动切工具 ✓ 读数核对 ✓ 报错自动修一轮 ✓）</span>
              </div>
              <div class="ggbs__solverow">
                <button class="ggbs__btn ggbs__btn--tiny" title="导入题目图片（也可以 Ctrl+V 粘贴 / 直接拖进来）" @click="solveFile && solveFile.click()">＋ 题目图</button>
                <button class="ggbs__btn ggbs__btn--tiny" title="截图：截完直接当题目图（能选窗口 / 拖选区）" @click="solveShot = true">截图</button>
                <button v-if="solveImgs.length" class="ggbs__btn ggbs__btn--tiny" title="清掉题目图" @click="solveImgs = []">清空图</button>
                <span v-if="solveImgs.length" class="ggbs__solveimgs">
                  <img v-for="(u, i) in solveImgs" :key="i" :src="u" alt="题目图" title="点一下去掉这张" @click="solveImgs.splice(i, 1)" />
                </span>
              </div>
              <textarea v-model="solveSay" class="ggbs__solveinput" rows="1" wrap="soft" placeholder="补充一句（可空）：比如「只画第一问」「用参数方程」" @paste="onSolvePaste"></textarea>
              <div v-if="solveVisionWarn" class="ggbs__solverow">
                <span class="ggbs__solvewarn">⚠ {{ solveVisionWarn }}</span>
                <button class="ggbs__btn ggbs__btn--tiny" @click="openAiSettings">去设置</button>
              </div>
              <textarea v-if="solveBrief" v-model="solveBrief" class="ggbs__solveinput" rows="6" wrap="soft"
                title="① 读图的结果 —— 就在这里改（看不清的地方看【待确认】）✓ 改完点「③ 解题并作图」✓"
                placeholder="① 读图的结果会出现在这里，可直接改…"></textarea>
              <div class="ggbs__solverow">
                <button class="ggbs__btn ggbs__btn--tiny" :disabled="reading" @click="readProblem">{{ reading ? "读图中…" : "① 读图（转成文字）" }}</button>
                <button class="ggbs__btn ggbs__btn--tiny" :disabled="scanning" @click="scanFigure" title="把题图里的几何图形认出来（复用「矢量识别」那套：点 / 线段 / 圆 + 字母标注 ✓）→ 结构写进校对框。线稿 / 截图效果最好；照片可能认不出多少 ✓">{{ scanning ? "认图形中…" : "② 认图形（可选）" }}</button>
                <button class="ggbs__btn ggbs__btn--ai" :disabled="solving" @click="solveAndDraw">{{ solving ? "解题作图中…" : "③ 解题并作图" }}</button>
                <label class="ggbs__check" title="作图时有命令报错，就把报错的那几步回灌给模型改一轮（只改错的，不动没报错的 ✓）"><input v-model="repairOn" type="checkbox" /> 失败自动修一轮</label>
                <label class="ggbs__check" title="跑完把画布上的精确读数（点坐标 / 线段长 / 半径 / 面积）交给模型核对：解题过程与图形自不自洽 ✓ 不一致就给出修正步骤 ✓"><input v-model="checkOn" type="checkbox" /> 跑完自动核对</label>
                <button class="ggbs__btn ggbs__btn--tiny" :disabled="!runSnap" @click="rollbackRun" title="把画布恢复到你点「③ 解题并作图」之前的样子（整块画布 + 视图一起恢复 ✓ 这一步之后手画、手改的也会没 ✗）">↩ 回滚到作图前</button>
              </div>
              <div v-if="solution" class="ggbs__solution">
                <div class="ggbs__solvet">解题过程</div>
                <div class="ggbs__soltext">{{ solution }}</div>
              </div>
              <div v-if="checkNote" class="ggbs__solution">
                <div class="ggbs__solvet">核对（用画布精确读数自查）</div>
                <div class="ggbs__soltext">{{ checkNote }}</div>
              </div>
              <div v-if="solveLog.length" class="ggbs__solvelog">
                <div v-for="(l, i) in solveLog" :key="i">{{ l }}</div>
              </div>
            </div>
            <input ref="solveFile" type="file" accept="image/*" multiple style="display:none" @change="onSolvePick" />
            <ScreenshotCapture v-if="solveShot" attach @close="solveShot = false" @done="onSolveShot" />
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
            </div>
          </div>
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
  width: min(1240px, 96vw); max-height: 94vh; display: flex; flex-direction: column;
  background: #fff; border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); overflow: hidden;
}
.ggbs__head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); font-weight: 700; color: var(--text); font-size: 15px; }
.ggbs__x { border: none; background: transparent; font-size: 18px; cursor: pointer; color: var(--muted); }
.ggbs__x:hover { color: var(--text); }
/* 【v1517】布局：上面一行工具条，下面**左边绘图板 + 右边操作栏**（AI 作图 / JS 指令）✓ */
.ggbs__body { padding: 10px 14px 12px; overflow: hidden; display: flex; flex-direction: column; gap: 8px; }
.ggbs__main { display: flex; align-items: stretch; gap: 10px; height: min(72vh, 660px); min-height: 360px; }
.ggbs__left { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.ggbs__side { flex: 0 0 400px; max-width: 44%; min-width: 300px; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; padding-right: 2px; }
.ggbs__bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 13px; color: var(--muted); }
.ggbs__sel { border: 1px solid var(--border-strong); border-radius: 6px; padding: 3px 8px; font-size: 13px; }
.ggbs__check { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
/* 【v1513】JS 指令面板 */
.ggbs__js { border: 1px solid var(--border-strong); border-radius: 8px; background: var(--panel-2); overflow: hidden; }
.ggbs__jshead { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border: 0; background: none; cursor: pointer; text-align: left; font-size: 12.5px; color: var(--text); }
.ggbs__jscaret { color: var(--muted); font-size: 11px; width: 10px; }
/* 【v1517】右栏只有 400px：状态靠右就够 ✓，那行长提示去掉（脚本框占位符里已经说了 ✓） */
.ggbs__jsstate { margin-left: auto; font-size: 11px; color: var(--ok, #16a34a); white-space: nowrap; }
.ggbs__jsstate--off { color: var(--muted); }
.ggbs__jsbody { padding: 0 10px 10px; display: flex; flex-direction: column; gap: 6px; }
.ggbs__jsbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.ggbs__jsinput { width: 100%; box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; line-height: 1.55; padding: 8px; border: 1px solid var(--border-strong); border-radius: 7px; background: #fff; color: var(--text); resize: vertical; white-space: pre; }
.ggbs__jsinput:focus { outline: none; border-color: var(--brand-600); }
.ggbs__log { max-height: 170px; overflow-y: auto; border: 1px dashed var(--border-strong); border-radius: 7px; background: #fff; padding: 6px 8px; font-size: 11.5px; line-height: 1.6; }
.ggbs__logline { color: #2f6b45; white-space: pre-wrap; word-break: break-all; }
.ggbs__logline--err { color: #b42318; }
.ggbs__loghint { color: var(--muted); }
.ggbs__canvas { flex: 1 1 auto; min-height: 0; border: 1px solid var(--border-strong); border-radius: 8px; overflow: hidden; background: #fff; }
.ggbs__host { width: 100%; height: 100%; min-height: 300px; }
/* 【v1517】虚拟键盘不在这里用 CSS 藏 ✗（GWT 仍按"键盘在"扣高度 → 板子下面留一大条空白 ✗，实测 ✗）；
   改成启动后点它自己的 ✕（见 closeVirtualKeyboard() ✓），GeoGebra 会真收起并重排 ✓。 */
.ggbs__err { color: var(--danger); font-size: 13px; margin: 8px 0 0; }
.ggbs__ai { display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; background: var(--brand-50); border: 1px solid var(--brand-100); border-radius: 8px; }
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
.ggbs__help { position: absolute; top: 46px; right: 0; bottom: 52px; width: min(560px, 58%); display: flex; flex-direction: column; background: #fff; border-left: 1px solid var(--border-strong); box-shadow: -10px 0 26px rgba(15, 23, 42, 0.14); z-index: 5; }
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
/* 窄屏（小笔记本）退回上下排 ✓ */
@media (max-width: 1040px) {
  .ggbs__main { flex-direction: column; height: auto; }
  .ggbs__side { flex: 1 1 auto; max-width: none; min-width: 0; overflow: visible; }
  .ggbs__host { height: 52vh; }
}
.ggbs__helpempty { color: var(--danger); font-size: 12.5px; }
.ggbs__helphint { margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--border-strong); font-size: 11.5px; color: var(--muted); line-height: 1.7; }
.ggbs__helphint code { font-family: ui-monospace, Menlo, Consolas, monospace; background: var(--panel-2); border: 1px solid var(--border); border-radius: 4px; padding: 1px 4px; }

/* 【v1711】贴图解题作图 ✓ */
.ggbs__solve { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; background: var(--brand-50); border: 1px solid var(--brand-100); border-radius: 8px; }
.ggbs__solvehead { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.ggbs__solvet { font-size: 12.5px; font-weight: 700; color: var(--text); }
.ggbs__solves { font-size: 11px; color: var(--muted); }
.ggbs__solvewarn { flex: 1 1 100%; font-size: 11.5px; line-height: 1.6; color: #b45309; }
.ggbs__solverow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ggbs__solveimgs { display: inline-flex; gap: 4px; flex-wrap: wrap; }
.ggbs__solveimgs img { max-height: 44px; max-width: 68px; border: 1px solid var(--border-strong); border-radius: 5px; cursor: pointer; }
.ggbs__solveinput { width: 100%; box-sizing: border-box; border: 1px solid var(--border-strong); border-radius: 7px; padding: 5px 8px; font: inherit; font-size: 12px; resize: vertical; }
.ggbs__solvehint { font-size: 11px; color: var(--muted); flex: 1 1 120px; min-width: 0; }
.ggbs__solution { background: #fff; border: 1px solid var(--border); border-radius: 7px; padding: 6px 8px; max-height: 220px; overflow: auto; }
.ggbs__soltext { font-size: 12px; line-height: 1.7; color: var(--text); white-space: pre-wrap; word-break: break-word; user-select: text; }
.ggbs__solvelog { font-size: 11px; line-height: 1.6; color: #2f6b45; max-height: 120px; overflow: auto; }

</style>
