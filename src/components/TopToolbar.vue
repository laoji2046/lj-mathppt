<script setup lang="ts">
import { defineAsyncComponent, computed, onBeforeUnmount, onMounted, ref, type Ref , shallowRef, type ComponentPublicInstance } from 'vue'
import { useDeckStore } from '@/stores/deck'
import { TABLE_TEMPLATES } from '@/templates/tableTemplates'
import { renderDeckToRevealHtml } from '@/reveal/renderer'
import type { ElementType, EmbedKind, SlideElement } from '@/types'
import SymbolPalette from './SymbolPalette.vue'
import MathFigurePalette from './MathFigurePalette.vue'
import LicenseDialog from './LicenseDialog.vue'
import { watch } from 'vue'
import { useLicense } from '@/composables/useLicense'
import { figPaletteOpen, openFigPalette } from '@/ui/figPalette'
import IconPalette from './IconPalette.vue'
import ImageLibrary from './ImageLibrary.vue'
import ScreenshotCapture from './ScreenshotCapture.vue'
import ThemePalette from './ThemePalette.vue'
import FormulaInserter from './FormulaInserter.vue'
import FormulaLibrary from './FormulaLibrary.vue'
import { formulaLib, openFormulaLibrary, closeFormulaLibrary } from '@/ui/formulaLibrary'
import { setViewMode, viewMode } from '@/ui/view'
import VersionHistory from './VersionHistory.vue'
import SaveAsDialog from './SaveAsDialog.vue'
import { isTauri } from '@/composables/useTauri'
import SettingsPanel from './SettingsPanel.vue'
import { ICONS as I } from '@/ui/icons'
import { openSvgEditor } from '@/ui/svgEditor'
import { pdfImportOpen, pdfImportFile, openPdfImport, closePdfImport } from '@/ui/pdfImport'
import { addonState, requireAddon } from '@/addons/registry'
import { openHelp as openHelpDialog } from '@/ui/help'
import { addonPanelOpen } from '@/ui/addonPanel'
import { imgMenuOpen, dsmMenuOpen, ggbMenuOpen, embedMenuOpen, settingsOpen, versionOpen, themeOpen, symbolOpen, iconOpen, formulaMenuOpen, drawOpen, tableMenuOpen } from '@/ui/menus'
const AddonManager = defineAsyncComponent(() => import('./AddonManager.vue'))
// —— 懒加载：三个导入器 + PDF 对话框都只在**点菜单/选文件**时才用 ✓ ——
//   静态导入会让 pptx(30KB)+docx(30KB)+pdf 全进启动包 ✗；改成动态导入后 Vite 各自分包 ✓
//   （PdfImportDialog 在模板里是 v-if 门控 ✓，可以安全异步化 ✓）
const PdfImportDialog = defineAsyncComponent(() => import('./PdfImportDialog.vue'))
/** 课件库（第三期）：从文件菜单打开 */
const DeckLibraryDialog = defineAsyncComponent(() => import('./DeckLibraryDialog.vue'))
/** 试题库 v2（v1441）：独立窗口，左树+筛选+题卡+预览就地编辑 —— 旧的 QuestionBankDialog 已在 v1439 移除 */
const QuestionBankPanel = defineAsyncComponent(() => import('./QuestionBankPanel.vue'))

const store = useDeckStore()
const emit = defineEmits<{ (e: 'present'): void; (e: 'open-templates'): void; (e: 'open-paper'): void; (e: 'open-handout'): void; (e: 'open-ggb-suite'): void }>()

// symbolOpen 已提到 @/ui/menus（?shot= 可直接打开）
// 图形面板的开关搬到 ui/figPalette 了 —— PDF 文档也要能打开它并接管"点卡片"的行为
// iconOpen 已提到 @/ui/menus（?shot= 可直接打开）
const imgLibOpen = ref(false)
const screenshotOpen = ref(false)
// imgMenuOpen 已提到 @/ui/menus（?shot= 外部入口可直接打开）
const shapeMenuOpen = ref(false)
const shapeWrap = ref<HTMLElement | null>(null)
// embedMenuOpen 已提到 @/ui/menus（?shot= 外部入口可直接打开）
const embedWrap = ref<HTMLElement | null>(null)
const embedFileInput = ref<HTMLInputElement | null>(null)
const imgWrap = ref<HTMLElement | null>(null)
const imgFileInput = ref<HTMLInputElement | null>(null)
// themeOpen 已提到 @/ui/menus（?shot= 可直接打开）
// versionOpen 已提到 @/ui/menus（?shot= 可直接打开）
// settingsOpen 已提到 @/ui/menus（?shot= 可直接打开）
const fileOpen = ref(false)
const fileWrap = ref<HTMLElement | null>(null)
// tableMenuOpen 已提到 @/ui/menus（?shot= 可直接打开）
/** ⚠ 这个 ref 用在 v-for 里 —— Vue 会把普通 ref 收集成**数组** ✗（外部点击检测会炸）。
 *  所以用**函数式 ref**：Vue 逐个元素调用它，我们只留最后一个。 */
const tableWrap = shallowRef<HTMLElement | null>(null)
function setTableWrap(el: Element | ComponentPublicInstance | null) {
  if (el instanceof HTMLElement) tableWrap.value = el
}
const fileToast = ref('')
/** 课件库弹窗开关（第三期）：从文件菜单打开 */
const deckLibOpen = ref(false)
/** 试题库 v2 开关（v1441） */
const qbOpen = ref(false)
const deckJsonInput = ref<HTMLInputElement | null>(null)
const saveAsOpen = ref(false)
const saveAsName = ref('演示.json')
const saveAsText = ref('')
function onDeckSaved(path: string) { fileToast.value = '已另存为：' + path; flashToast() }
function pickDeckJson() { fileOpen.value = false; deckJsonInput.value?.click() }
function onDeckJsonPicked(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const deck = JSON.parse(reader.result as string)
      const ok = store.importDeck(deck)
      if (!ok) throw new Error('不是有效的演示 JSON（已取消，未影响当前内容）')
      fileToast.value = '已导入演示：' + ((deck && deck.title) || '导入演示')
      flashToast()
    } catch (err) {
      fileToast.value = '导入失败：' + (err instanceof Error ? err.message : String(err))
      flashToast()
    }
  }
  reader.readAsText(file)
  input.value = ''
}
/** 导入 Word（.docx）：本地解析 → Markdown → 走应用自己的 Markdown 导入管线（图片内嵌成 data URL） */
const docxInput = ref<HTMLInputElement | null>(null)

/* 【v1674】序列号：没激活时锁住 数学图形 / AI 助手 / 讲义 / 试卷编辑（用户指定） */
const lic = useLicense()
const licOpen = ref(false)
void lic.initLicense()
/** 能用就返回 true；不能用就弹激活框（四个闸门都走它 ✓） */
function needLic(f: string): boolean {
  if (lic.licensed(f)) return true
  licOpen.value = true
  return false
}
// 图形库的入口在别处（菜单里点一下就置位）→ 盯住这个开关：没激活就拦下来弹激活框 ✓
watch(figPaletteOpen, (v) => { if (v && !lic.licensed('math-figure')) { figPaletteOpen.value = false; licOpen.value = true } })
function pickDocx() { if (!requireAddon('docx-import')) return fileOpen.value = false; docxInput.value?.click() }
const pptxInput = ref<HTMLInputElement | null>(null)
function pickPptx() { if (!requireAddon('pptx-import')) return fileOpen.value = false; pptxInput.value?.click() }
/** 导入 PDF：先弹窗探测（有没有文本层）再决定怎么导 */
const pdfInput = ref<HTMLInputElement | null>(null)
function pickPdf() { if (!requireAddon('pdf-import')) return fileOpen.value = false; pdfInput.value?.click() }
function onPdfPicked(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) openPdfImport(file)
}
function onPdfDone(msg: string) { fileToast.value = msg; flashToast() }

/** 导入 PPT(.pptx)：解包 → 逐页读形状 → 生成课件 JSON（文字/公式/图片/表格） */
async function onPptxPicked(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  fileToast.value = '正在解析 PPT…'
  flashToast()
  try {
    const buf = new Uint8Array(await file.arrayBuffer())
    const { pptxToDeck } = await import('@/pptx/pptxToDeck')
    const { deck, stats } = await pptxToDeck(buf)
    const ok2 = store.importDeck(deck)
    if (!ok2) throw new Error('生成的演示无效（已取消，未影响当前内容）')
    const warn = stats.skippedVector > 0
      ? ' · 跳过 ' + stats.skippedVector + ' 个 WMF/EMF 矢量图（浏览器不能渲染）'
      : ''
    // ⚠ 只有 OLE 壳的公式：读不到内容 ✗，必须**明说**（与 Word 导入对 MathType 的处理一致 ✓）
    const oleWarn2 = stats.oleFormulas > 0
      ? ' · 注意：另有 ' + stats.oleFormulas + ' 个公式是 OLE 对象（读不到内容）—— 请在 PowerPoint 里把它们改成「插入 → 公式」的原生公式，再导一次'
      : ''
    // ⚠ 几何自检报数：位置/尺寸没取到、或跑到画布外 ✗（这类问题代码不报错 ✓，必须显式说出来 ✓）
    const geoWarn = stats.geomSuspect > 0
      ? ' · ⚠ ' + stats.geomSuspect + ' 个元素位置/尺寸异常（可能没取到写入位置）—— 请把出问题那一页截图给我'
      : ''
    // 【v1672】导入后**自动统一风格**（用户要求：只统一字体/配色，**不动版式** ✓；风格跟当前主题走 ✓）
    //   applyHouseStyle → restyleDeck 的承诺：只改样式、绝不碰内容 ✓
    //   （字号吸附到主题档位、换主题字体、背景换主题底色、文字色**保色相**只夹对比度 ✓）
    //   slides === 0 表示「统一风格」这个插件被关掉了（requireAddon 挡下）→ 如实说出来，别假装改了 ✗
    const rs = store.applyHouseStyle()
    const styleNote = rs.slides === 0
      ? ' · 风格没动：「统一风格」在插件里被关掉了（设置 → 插件）'
      : (rs.changed ? ' · 已统一风格：' + rs.changed + ' 个元素对齐主题（字体/配色，版式没动）' : ' · 风格本来就和主题一致')
    fileToast.value = 'PPT 导入完成：' + deck.slides.length + ' 页 · 公式 ' + stats.formulas +
      ' · 图片 ' + stats.images + ' · 表格 ' + stats.tables + warn + oleWarn2 + geoWarn + styleNote
  } catch (err) {
    fileToast.value = 'PPT 导入失败：' + (err instanceof Error ? err.message : String(err))
  }
  flashToast()
}

async function onDocxPicked(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  fileToast.value = '正在解析 Word 文档…'
  flashToast()
  try {
    const buf = new Uint8Array(await file.arrayBuffer())
    const { docxToMarkdown } = await import('@/docx/docxToMarkdown')
    const { markdown, stats } = await docxToMarkdown(buf)
    const { markdownToDeck } = await import('@/composables/mdDeck')
    const deck = markdownToDeck(markdown)
    const ok2 = store.importDeck(deck)
    if (!ok2) throw new Error('生成的演示无效（已取消，未影响当前内容）')
    const oleWarn = stats.oleFormulas > 0
      ? ' · 注意：另有 ' + stats.oleFormulas + ' 个公式是 MathType 对象，读不到内容 —— 请先在该文档里「MathType → 转换公式 → Office Math」转成 Word 原生公式再导入'
      : ''
    fileToast.value = 'Word 导入完成：' + deck.slides.length + ' 页 · 公式 ' + stats.formulas + ' · 图片 ' + stats.images + oleWarn
  } catch (err) {
    fileToast.value = 'Word 导入失败：' + (err instanceof Error ? err.message : String(err))
  }
  flashToast()
}

// drawOpen 已提到 @/ui/menus（?shot= 可直接打开）
const drawWrap = ref<HTMLElement | null>(null)

// formulaMenuOpen 已提到 @/ui/menus（?shot= 可直接打开）
const formulaWrap = ref<HTMLElement | null>(null)
const formulaModalOpen = ref(false)

/** 顶部插入类的按钮：先退出绘制工具，再插入默认元素 */
function addFromToolbar(type: ElementType) {
  store.clearDrawTool()
  store.addElement(type)
}
/** 表格：从模板插一张整表（三线表 / 对比表 / 表 4-1 式 …） */
function applyTableTemplate(t: (typeof TABLE_TEMPLATES)[number]) {
  tableMenuOpen.value = false
  store.clearDrawTool()
  store.addElement('table', {
    rows: t.rows.map((r) => [...r]),
    merges: t.merges ? t.merges.map((m) => ({ ...m })) : undefined,
    caption: t.caption,
    figHeight: t.figHeight,
    borderMode: t.borderMode,
    w: t.w ?? 560,
    h: t.h ?? 240,
  } as never)
}
function toggleTableMenu() { toggleShown(tableMenuOpen) }

/** 绘制工具（线/箭头/笔/多边形）：再点同类型退出 */
function toggleDraw(t: 'line' | 'arrow' | 'pen' | 'poly') {
  store.setDrawTool(store.drawTool === t ? null : t)
}
function openSymbol() {
  store.clearDrawTool()
  symbolOpen.value = true
}
function openFig() {
  store.clearDrawTool()
  openFigPalette()
}
function toggleShapeMenu() { toggleShown(shapeMenuOpen) }
function addRect() { shapeMenuOpen.value = false; store.clearDrawTool(); store.addElement('shape', { shape: 'rect' } as Partial<SlideElement>) }
function addEllipse() { shapeMenuOpen.value = false; store.clearDrawTool(); store.addElement('shape', { shape: 'ellipse' } as Partial<SlideElement>) }
/** 关闭所有下拉菜单（互斥：打开一个时关闭其它，避免叠在一起）——同样走登记表 */
function closeAllDropdowns() {
  for (const d of DROPDOWNS) d.open.value = false
}
function toggleShown(openRef: Ref<boolean>) {
  if (openRef.value) { openRef.value = false; return }
  closeAllDropdowns()
  openRef.value = true
}
function toggleEmbedMenu() { toggleShown(embedMenuOpen) }
function addEmbedUrl() { embedMenuOpen.value = false; store.clearDrawTool(); store.addElement('embed', { kind: 'url', w: 640, h: 420 } as Partial<SlideElement>) }
function pickEmbedFile() { embedMenuOpen.value = false; embedFileInput.value?.click() }
async function onEmbedFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const dataUrl = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(new Error('读取文件失败')); fr.readAsDataURL(file) })
    const dataBase64 = dataUrl.split(',')[1] || ''
    const t = (file.type || '').toLowerCase()
    const kind: EmbedKind = t.startsWith('image/') ? 'image' : t === 'application/pdf' || /\.pdf$/i.test(file.name) ? 'pdf' : t === 'text/html' || /\.html?$/i.test(file.name) ? 'html' : 'doc'
    const mime = file.type || (kind === 'pdf' ? 'application/pdf' : kind === 'html' ? 'text/html' : 'application/octet-stream')
    store.clearDrawTool()
    store.addElement('embed', { kind, dataBase64, mime, url: '', w: kind === 'pdf' ? 600 : 640, h: kind === 'pdf' ? 800 : 400 } as Partial<SlideElement>)
  } catch (err) { fileToast.value = '读取文件失败：' + (err instanceof Error ? err.message : String(err)); flashToast() }
}
function openIcon() {
  store.clearDrawTool()
  iconOpen.value = true
}
function openImgLib() {
  store.clearDrawTool()
  imgLibOpen.value = true
}
function toggleImgMenu() { toggleShown(imgMenuOpen) }
function pickImg() { imgMenuOpen.value = false; imgFileInput.value?.click() }
function openScreenshot() { imgMenuOpen.value = false; store.clearDrawTool(); screenshotOpen.value = true }
async function onImgPicked(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const ok = /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml|avif)$/i.test(file.type)
  if (!ok) { fileToast.value = '不支持的图片格式：' + file.type; flashToast(); return }
  try {
    const dataUrl = await new Promise<string>((res, rej) => {
      const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(new Error('读取文件失败')); fr.readAsDataURL(file)
    })
    const meta = await new Promise<{ w: number; h: number }>((res) => {
      const img = new Image(); img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight }); img.onerror = () => res({ w: 0, h: 0 }); img.src = dataUrl
    })
    let w = meta.w || 640, h = meta.h || 400
    const f = Math.min(900 / w, 620 / h)
    if (f < 1 && f > 0) { w = Math.round(w * f); h = Math.round(h * f) }
    store.clearDrawTool()
    store.addElement('image', { src: dataUrl, w, h, fit: 'contain' } as Partial<SlideElement>)
    fileToast.value = '已插入本地图片'; flashToast()
  } catch (e) { fileToast.value = e instanceof Error ? e.message : String(e); flashToast() }
}
function openTheme() {
  store.clearDrawTool()
  themeOpen.value = true
}
function openVersion() {
  store.clearDrawTool()
  versionOpen.value = true
}
function openSettings() {
  store.clearDrawTool()
  settingsOpen.value = true
}
function toggleFileMenu() { toggleShown(fileOpen) }
function newDeck() {
  fileOpen.value = false
  if (window.confirm('新建演示？当前内容将被清空（可 Ctrl+Z 撤销）')) { store.resetDeck(); fileToast.value = '已新建'; flashToast() }
}
function saveDeck() {
  fileOpen.value = false
  const ok = store.saveNow()
  fileToast.value = ok ? '已保存到本地' : '保存失败'
  flashToast()
}
/* ---------- 另存为：把演示写成 JSON 文件，用户可自选目录 ---------- */
function deckFileName() {
  const t = String(store.deck.title || '演示').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60)
  return (t || '演示') + '.json'
}
function deckJsonText() { return JSON.stringify(JSON.parse(JSON.stringify(store.deck)), null, 2) }
async function saveDeckAs() {
  fileOpen.value = false
  const name = deckFileName()
  const text = deckJsonText()
  // 桌面端（exe/WebView2）弹自带的目录选择框；浏览器用原生"另存为"
  if (isTauri()) {
    saveAsName.value = name
    saveAsText.value = text
    saveAsOpen.value = true
    return
  }
  const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<any> }
  if (typeof w.showSaveFilePicker === 'function') {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'LJ-MathSlides 演示 JSON', accept: { 'application/json': ['.json'] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(new Blob([text], { type: 'application/json;charset=utf-8' }))
      await writable.close()
      fileToast.value = '已另存为：' + (handle.name || name)
      flashToast()
      return
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return // 用户点了取消
      // 其它情况（浏览器不支持该能力）走下面的下载回退
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
  fileToast.value = '已另存为：' + name + '（保存到浏览器下载目录）'
  flashToast()
}
function exportHtml() {
  fileOpen.value = false
  const html = renderDeckToRevealHtml(store.deck, { assets: 'cdn' })
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = (store.deck.title || '演示') + '.html'
  a.click()
  URL.revokeObjectURL(url)
  fileToast.value = '已导出 HTML（需联网加载第三方资源）'
  flashToast()
}
/* ---------- 导出 PDF / PNG：共用 print 模式渲染 iframe ----------
 * renderer 的 print 模式把全部幻灯片展开为 .pdf-page 堆叠（Reveal view:'print'），
 * 并在 MathJax / GeoGebra / Desmos / pdf.js 全部挂载完成后 postMessage 'fx-print-ready'。
 * - PDF：调 iframe 的 print()，走系统打印对话框（选「另存为 PDF」，矢量文字质量最好）
 * - PNG：html2canvas 截当前页的 .pdf-page（2 倍分辨率）
 */
interface PrintFrame { frame: HTMLIFrameElement; doc: Document; url: string }
function openPrintFrame(): Promise<PrintFrame> {
  return new Promise((resolve, reject) => {
    const html = renderDeckToRevealHtml(store.deck, { assets: 'local', print: true })
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const frame = document.createElement('iframe')
    // 离屏但保持可见性（visibility/opacity 会连累内部元素的计算样式，导致截图空白）
    frame.style.cssText = 'position:fixed;left:-32000px;top:0;width:' + store.deck.width + 'px;height:' + store.deck.height + 'px;border:0;'
    let settled = false
    const finish = (ok: boolean, err?: string) => {
      if (settled) return
      settled = true
      window.removeEventListener('message', onMsg)
      clearTimeout(guard)
      if (ok) resolve({ frame, doc: frame.contentDocument!, url })
      else { frame.remove(); URL.revokeObjectURL(url); reject(new Error(err || '渲染失败')) }
    }
    const onMsg = (e: MessageEvent) => {
      try {
        const m = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
        if (m && m.type === 'fx-print-ready') finish(true)
      } catch { /* 非本应用消息 */ }
    }
    // 兜底：45s 放行（GGB 引擎挂载超时时尽力输出）
    const guard = setTimeout(() => finish(true), 45000)
    window.addEventListener('message', onMsg)
    frame.onerror = () => finish(false, '渲染页加载失败')
    document.body.appendChild(frame)
    frame.src = url
  })
}
/** 延迟回收：打印对话框关闭前内容需保持存活 */
function disposePrintFrame(f: PrintFrame, delay = 8000) {
  setTimeout(() => { f.frame.remove(); URL.revokeObjectURL(f.url) }, delay)
}
/** 统一为本应用风格：只改样式、不碰内容 ✓（store 里已 pushHistory，可撤销 ✓）*/
/** 按内容套用模板 ✓：先问「跳过哪些页」 ✓（留空=全部处理 ✓，取消=什么都不做 ✓） */
function autoTemplate() {
  fileOpen.value = false
  const promptText = '按内容套用模板（能识别的页套用版式，其余保留原样，可 Ctrl+Z 撤销）' + String.fromCharCode(10, 10) + '要跳过哪些页？填页码、逗号分隔；留空 = 全部处理'
  const ans = window.prompt(promptText, '')
  if (ans === null) return
  const skip = String(ans).split(/[,，、\s]+/).map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n) && n > 0)
  const r = store.applyAutoTemplate({ skip })
  fileToast.value = '按内容套用模板：套用 ' + r.applied + ' 页 / 保留 ' + r.kept + ' 页' + (skip.length ? '（已跳过 ' + skip.join('、') + '）' : '') + ' —— 可 Ctrl+Z 撤销'
  flashToast()
}

/** addon 开关：关掉后入口隐藏、代码永不加载（先把「试卷编辑」接上做样板） */
function openAddonMgr() { fileOpen.value = false; addonMgrOpen.value = true }

function addonOn(id: string) { return addonState.enabled[id] !== false }

function houseStyle(mode: 'soft' | 'strong') {
  fileOpen.value = false
  const r = store.applyHouseStyle(undefined, mode)
  const what = mode === 'strong' ? '字体 + 配色已按 60-30-10 重映射' : '字号/字体/背景已对齐'
  fileToast.value = '已统一为「' + r.theme.name + '」（' + (mode === 'strong' ? '彻底' : '轻度') + '：' + what + '）：' +
    r.slides + ' 页背景、' + r.changed + ' 个元素（内容未改动，可 Ctrl+Z 撤销）'
  flashToast()
}

async function exportPdf() {
  fileOpen.value = false
  fileToast.value = '正在渲染全部页面（公式 / 画布挂载中）…'
  flashToast()
  try {
    const f = await openPrintFrame()
    fileToast.value = '已打开打印：请选「另存为 PDF」'
    flashToast()
    setTimeout(() => {
      try {
        f.frame.contentWindow?.focus()
        f.frame.contentWindow?.print()
      } catch { window.print() }
      disposePrintFrame(f, 6000)
    }, 250)
  } catch (e) {
    fileToast.value = '导出 PDF 失败：' + (e instanceof Error ? e.message : String(e))
    flashToast()
  }
}
async function exportPng() {
  fileOpen.value = false
  fileToast.value = '正在截图当前页…'
  flashToast()
  try {
    const f = await openPrintFrame()
    // 加载截图库（与试卷模块共用 public/pdf/html2canvas.min.js）
    const w = window as any
    if (!w.html2canvas) {
      await new Promise<void>((res, rej) => {
        const s = document.createElement('script')
        s.src = window.location.origin + '/pdf/html2canvas.min.js'
        s.onload = () => res()
        s.onerror = () => rej(new Error('截图组件加载失败'))
        document.head.appendChild(s)
      })
    }
    // 当前页：通过 data-slide-id 精确定位（带子页的父页在打印视图展开为多个 .pdf-page）
    const cur = store.deck.slides[store.currentIndex]
    const pages = Array.from(f.doc.querySelectorAll('.reveal .slides .pdf-page')) as HTMLElement[]
    if (!pages.length) throw new Error('未找到页面元素')
    let page: HTMLElement | undefined
    if (cur) {
      const mark = f.doc.querySelector('.pdf-page [data-slide-id="' + cur.id + '"]')
      page = (mark?.closest('.pdf-page') as HTMLElement) || undefined
    }
    page = page || pages[Math.min(store.currentIndex, pages.length - 1)]
    const canvas = await w.html2canvas(page, { scale: 2, useCORS: true, backgroundColor: '#ffffff' })
    const name = ((store.deck.title || '幻灯片') + '-' + String(store.currentIndex + 1).padStart(2, '0')).replace(/[\\/:*?"<>|]/g, '_')
    canvas.toBlob((b: Blob | null) => {
      if (!b) return
      const u = URL.createObjectURL(b)
      const a = document.createElement('a')
      a.href = u
      a.download = name + '.png'
      a.click()
      setTimeout(() => URL.revokeObjectURL(u), 4000)
    }, 'image/png')
    fileToast.value = '已导出 PNG：第 ' + (store.currentIndex + 1) + ' 页（2 倍分辨率）'
    flashToast()
    disposePrintFrame(f, 3000)
  } catch (e) {
    fileToast.value = '导出 PNG 失败：' + (e instanceof Error ? e.message : String(e))
    flashToast()
  }
}
let toastTimer: number | undefined
function flashToast() {
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { fileToast.value = '' }, 2500) as unknown as number
}
function toggleFormulaMenu() { toggleShown(formulaMenuOpen) }
function openFormulaModal() { formulaMenuOpen.value = false; store.clearDrawTool(); formulaModalOpen.value = true }
function openFormulaLib() { formulaMenuOpen.value = false; store.clearDrawTool(); openFormulaLibrary() }
function addBlankMath() { formulaMenuOpen.value = false; store.clearDrawTool(); store.addElement('math') }
function openTemplates() {
  store.clearDrawTool()
  emit('open-templates')
}
function present() {
  store.clearDrawTool()
  emit('present')
}
function openPaper() { if (!requireAddon('pdf-gen')) return
  store.clearDrawTool()
  emit('open-paper')
}

/** 当前页所有元素是否均已标记「逐条出现」 */
const allFragments = computed(() => {
  const s = store.currentSlide
  return !!s && s.elements.length > 0 && s.elements.every((el) => !!el.fragment)
})
function toggleAllFragments() {
  store.clearDrawTool()
  store.setAllFragments(!allFragments.value)
}

const drawButtons: { type: 'line' | 'arrow' | 'pen' | 'poly'; label: string; svg: string; title?: string }[] = [
  { type: 'line', label: '直线', svg: '<path d="M4 20L20 4"/>' },
  { type: 'arrow', label: '箭头', svg: '<path d="M4 20L18 6M13 5h6v6"/>' },
  { type: 'pen', label: '笔', svg: '<path d="M3 21l1.5-4.5L17 4l3 3L7.5 19.5 3 21zM15 6l3 3"/>' },
  { type: 'poly', label: '多边形', svg: '<polygon points="12 3 21 10 17 20 7 20 3 10"/>', title: '在画布上点击放置角点；双击或点击首点闭合' },
]

const addButtons: { type: ElementType; label: string; icon: string; svg: string }[] = [
  { type: 'text', label: '文字', icon: '', svg: '<path d="M4 7V5h16v2M9 20h6M12 5v15"/>' },
  { type: 'chart', label: '图表', icon: '', svg: '<path d="M18 20V10M12 20V4M6 20v-6"/>' },
  { type: 'table', label: '表格', icon: '', svg: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>' },
]

/** 打开本地 .ggb：一步创建已加载内容的 GeoGebra 元素 */
const ggbFileInput = ref<HTMLInputElement | null>(null)
function pickGgb() {
  ggbMenuOpen.value = false
  ggbFileInput.value?.click()
}
async function onGgbPicked(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const buf = await file.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buf)
    // 分块转换，避免大文件时 String.fromCharCode 爆栈
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    const ggbBase64 = btoa(binary)
    store.addElement('geogebra', { ggbBase64, w: 720, h: 480 } as Partial<SlideElement>)
  } finally {
    input.value = ''
  }
}

/** GeoGebra 下拉菜单 */
// ggbMenuOpen 已提到 @/ui/menus（?shot= 外部入口可直接打开）
const ggbWrap = ref<HTMLElement | null>(null)
function toggleGgbMenu() {
  toggleShown(ggbMenuOpen)
}
function addBlankGgb() { if (!requireAddon('geogebra')) return
  ggbMenuOpen.value = false
  store.addElement('geogebra')
}
function openGgbSuite() {
  ggbMenuOpen.value = false
  store.clearDrawTool()
  emit('open-ggb-suite')
}
/** Desmos 下拉菜单：空白计算器 / 导入状态 JSON */
// dsmMenuOpen 已提到 @/ui/menus（?shot= 外部入口可直接打开）
const dsmWrap = ref<HTMLElement | null>(null)
const dsmFileInput = ref<HTMLInputElement | null>(null)
function toggleDsmMenu() {
  toggleShown(dsmMenuOpen)
}
function addBlankDsm() { if (!requireAddon('desmos')) return
  dsmMenuOpen.value = false
  store.addElement('desmos')
}
function pickDsm() {
  dsmMenuOpen.value = false
  dsmFileInput.value?.click()
}
/** 导入 Desmos 状态 JSON（属性面板「导出状态」产出的文件） */
async function onDsmPicked(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    JSON.parse(text)   // 先校验，避免把非 JSON 塞进场景图
    store.addElement('desmos', { state: text } as Partial<SlideElement>)
  } catch (err) {
    window.alert('不是有效的 Desmos 状态 JSON 文件：' + (err instanceof Error ? err.message : String(err)))
  } finally {
    input.value = ''
  }
}

/**
 * 所有下拉菜单的登记表：一处登记，外部点击统一处理。
 *
 * 原来是一个个手写 if ✗ —— 结果漏了「绘制/形状」「图片」「嵌入」三个，
 * 表现就是"点开菜单后不选项就没法关掉"。这类漏洞靠"记得补"是治不住的，改成表驱动。
 */
const addonMgrOpen = addonPanelOpen   // 已提到 @/ui/addonPanel（?shot=addon 等外部入口可直接开）
const helpMenuOpen = ref(false)   // 帮助菜单
const helpWrap = ref<HTMLElement | null>(null)
function toggleHelpMenu() { toggleShown(helpMenuOpen) }
function gotoHelp() { helpMenuOpen.value = false; openHelpDialog() }
const DROPDOWNS: { open: Ref<boolean>; wrap: Ref<HTMLElement | null> }[] = [
  { open: fileOpen, wrap: fileWrap },
  { open: shapeMenuOpen, wrap: shapeWrap },
  { open: imgMenuOpen, wrap: imgWrap },
  { open: embedMenuOpen, wrap: embedWrap },
  { open: formulaMenuOpen, wrap: formulaWrap },
  { open: drawOpen, wrap: drawWrap },
  { open: ggbMenuOpen, wrap: ggbWrap },
  { open: dsmMenuOpen, wrap: dsmWrap },
  { open: tableMenuOpen, wrap: tableWrap },
  { open: helpMenuOpen, wrap: helpWrap },
]

function onDocClick(e: MouseEvent) {
  const t = e.target as Node
  for (const d of DROPDOWNS) {
    if (d.open.value && d.wrap.value && !d.wrap.value.contains(t)) d.open.value = false
  }
}
/** Esc 也关下拉（跟右键菜单的 Esc 行为保持一致） */
function onDocKey(e: KeyboardEvent) {
  if (e.key === 'Escape') closeAllDropdowns()
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onDocKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onDocKey)
})
</script>

<template>
  <header class="toolbar">
    <span class="brand">
      <span class="brand__mark">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 19c3.4 0 3.4-15 7-15s3.6 15 7 15 3.4-7 6-7"/></svg>
      </span>
      <span class="brand__text">LJ-MathSlides</span>
    </span>

    <!-- 撤销 / 重做 / 逐条：整条工具栏最显眼的位置（logo 之后、文件之前），自成一组 -->
    <div class="group group--undo">
      <button class="btn" :disabled="!store.canUndo" title="撤销 (Ctrl+Z)" @click="store.undo()"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.undo"></svg>撤销</button>
      <button class="btn" :disabled="!store.canRedo" title="重做 (Ctrl+Y)" @click="store.redo()"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.redo"></svg>重做</button>
      <button class="btn" :class="{ 'btn--open': allFragments }" title="本页所有元素逐条出现（演示时点击渐显）" @click="toggleAllFragments">
        <svg viewBox="0 0 24 24" class="btn__svg" v-html="I.fragment"></svg>逐条
      </button>
    </div>

    <div class="group">
      <div ref="fileWrap" class="dropdown">
        <button class="btn" :class="{ 'btn--open': fileOpen }" title="文件" @click="toggleFileMenu">
          <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.file"></svg></span>文件<span class="caret">▾</span>
        </button>
        <div v-if="fileOpen" class="dropdown__menu">
          <div class="dropdown__group">文件</div>
          <button class="dropdown__item" @click="newDeck"><span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.new"></svg></span>新建演示</button>
          <button class="dropdown__item" @click="saveDeck"><span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.save"></svg></span>保存</button>
              <button class="dropdown__item" title="把当前演示另存为 JSON 文件（可自选目录、自定义文件名；用「导入演示 JSON」可再次打开）" @click="saveDeckAs"><span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.save"></svg></span>另存为…（JSON）</button>
          <div class="dropdown__group">导出</div>
          <button class="dropdown__item" title="导出独立 HTML" @click="exportHtml"><span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.html"></svg></span>导出 HTML</button>
          <button class="dropdown__item" title="全部页面 → 打印对话框 → 另存为 PDF（矢量文字）" @click="exportPdf"><span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.pdf"></svg></span>导出 PDF</button>
          <!-- 【v1675】激活入口：开发期默认不锁功能，但这里随时能点开看机器码 / 测试激活 ✓ -->
<button class="dropdown__item" title="序列号：显示本机机器码、激活或取消激活（开发期默认不锁功能）" @click="licOpen = true">激活 / 序列号…</button>
<button class="dropdown__item" title="当前页截图为 PNG（2 倍分辨率）" @click="exportPng"><span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.png"></svg></span>导出 PNG（当前页）</button>
          <button class="dropdown__item" title="Markdown 源码：导出或导入（--- 横向 / -- 垂直 / Note: 备注）" @click="setViewMode('split')"><span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.md"></svg></span>MD 源码（导出/导入 Markdown）</button>
          <div class="dropdown__group">导入与库</div>
          <button class="dropdown__item" title="导入之前导出的演示 JSON（.json）" @click="pickDeckJson"><span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.folder"></svg></span>导入演示 JSON</button>
                            <button v-if="addonOn('pptx-import')" class="dropdown__item" title="导入 PPT（.pptx）：本地解析，文字 / 公式 / 图片 / 表格一并搬过来" @click="pickPptx">
          <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.file"></svg></span>导入 PPT(.pptx)
        </button>
        <button v-if="addonOn('docx-import')" class="dropdown__item" title="导入 Word 文档（.docx）：本地解析、图片内嵌，一题一页" @click="pickDocx"><span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.md"></svg></span>导入 Word 文档（.docx）</button>
        <button v-if="addonOn('pdf-import')" class="dropdown__item" title="导入 PDF（.pdf）：自动判断有没有文本层 —— 有就抽成可编辑文字，没有就每页一张图" @click="pickPdf"><span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.pdf"></svg></span>导入 PDF（.pdf）</button>
          <div class="dropdown__group">样式与管理</div>
          <button v-if="addonOn('house-style')" class="dropdown__item" title="轻度：字号吸附 TypeScale 档位、字体换主题字体、背景换主题底色、文字色只做可读性夹取（保留原课件配色语义）——只改样式，不碰内容，可 Ctrl+Z 撤销" @click="houseStyle('soft')">
            <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.theme"></svg></span>统一风格（轻度）
          </button>
          <button v-if="addonOn('house-style')" class="dropdown__item" title="彻底：在轻度基础上，把原课件的配色按 60-30-10 重映射到主题的 primary/accent（变化明显，但会丢掉原课件的配色语义）——可 Ctrl+Z 撤销" @click="houseStyle('strong')">
            <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.theme"></svg></span>统一风格（彻底·明显）
          </button>
          <button v-if="addonOn('auto-template')" class="dropdown__item" title="按内容识别页面角色（例题/定理/定义/练习/小结/探究），套用对应版式；含表格/图片的页、内容装不下的页一律保留原样 —— 可 Ctrl+Z 撤销" @click="autoTemplate">
            <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.theme"></svg></span>按内容套用模板…
          </button>
        </div>
      </div>
    </div>

    <!-- 【v1679】用户要求：课件库 / 试题库 从「文件」菜单挪到工具条（「文件」右侧）✓ -->
<button class="btn" title="课件库：管理存过的整份课件（打开会替换当前内容，可用 Ctrl+Z 撤销）" @click="deckLibOpen = true"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.folder"></svg>课件库</button>
<button class="btn" title="试题库：按章节/知识点/题型/难度/年份筛选，看题干与答案，并能就地补全（新）" @click="qbOpen = true"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.folder"></svg>试题库</button>
<button class="btn" :class="{ 'btn--open': viewMode !== 'canvas' }" title="MD 源码：分屏实时预览"> @click="setViewMode(viewMode === 'canvas' ? 'split' : 'canvas')">
      <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.md"></svg></span>MD 源码
    </button>
    <div class="group">
      <template v-for="b in addButtons" :key="b.type">
        <!-- 表格：下拉选模板（三线表 / 对比表 / 表 4-1 式 …） -->
        <div v-if="b.type === 'table'" :ref="setTableWrap" class="dropdown">
          <button class="btn" :class="{ 'btn--open': tableMenuOpen }" title="插入表格：可选模板（含教材三线表）" @click="toggleTableMenu()">
            <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="b.svg"></svg></span>{{ b.label }}<span class="btn__caret">▾</span>
          </button>
          <div v-if="tableMenuOpen" class="dropdown__menu">
            <button
              v-for="t in TABLE_TEMPLATES" :key="t.id" class="dropdown__item"
              :title="t.hint || t.name" @click="applyTableTemplate(t)"
            >
              <span class="dropdown__icon">▦</span>{{ t.name }}
            </button>
          </div>
        </div>
        <button v-else class="btn" @click="addFromToolbar(b.type)">
          <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="b.svg"></svg></span>{{ b.label }}
        </button>
      </template>

      <!-- 形状下拉：矩形 / 椭圆 / 数学图形 -->
      <div ref="shapeWrap" class="dropdown">
        <button class="btn" :class="{ 'btn--open': shapeMenuOpen }" title="插入形状 / 数学图形" @click="toggleShapeMenu">
          <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.shape"></svg></span>绘制/形状<span class="caret">▾</span>
        </button>
        <div v-if="shapeMenuOpen" class="dropdown__menu">
          <button class="dropdown__item" @click="addRect">
            <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.rect"></svg></span>矩形
          </button>
          <button class="dropdown__item" @click="addEllipse">
            <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.ellipse"></svg></span>椭圆
          </button>
          <button v-for="d in drawButtons" :key="d.type" class="dropdown__item" :class="{ 'dropdown__item--on': store.drawTool === d.type }" :title="d.title || ('在画布空白处拖拽绘制 ' + d.label)" @click="toggleDraw(d.type); shapeMenuOpen = false">
            <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="d.svg"></svg></span>{{ d.label }}
          </button>
          <button class="dropdown__item" title="SVG 编辑器：画简单的矢量图（直线 / 箭头 / 矩形 / 圆 / 折线 / 手绘）→ 插进当前页，插进去的还是矢量元素、还能接着改" @click="openSvgEditor(); shapeMenuOpen = false">
            <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.pen"></svg></span>SVG 编辑器
          </button>
          <button class="dropdown__item" @click="openSymbol(); shapeMenuOpen = false"><span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.symbol"></svg></span>数学符号</button>
          <button class="dropdown__item" @click="openIcon(); shapeMenuOpen = false"><span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.icon"></svg></span>图标库</button>

        </div>
      </div>

      <!-- 数学图形：单独成一项（用得最多，不藏在「绘制/形状」下拉里） -->
      <button class="btn" title="数学图形：抛物线 / 三角形 / 贝塞尔 / 自定义多边形 / 三维立体图 / 自图片重建" @click="openFig()">
        <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.fig"></svg></span>数学图形
      </button>

      <!-- 嵌入下拉：网页/网址(URL) / 本地文件 -->
      <div ref="embedWrap" class="dropdown">
        <button class="btn" :class="{ 'btn--open': embedMenuOpen }" title="插入嵌入元素" @click="toggleEmbedMenu">
          <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.embed"></svg></span>嵌入<span class="caret">▾</span>
        </button>
        <div v-if="embedMenuOpen" class="dropdown__menu">
          <button class="dropdown__item" title="内嵌网页 / 外部链接（URL）" @click="addEmbedUrl">
            <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.web"></svg></span>网页 / 网址（URL）
          </button>
          <button class="dropdown__item" title="选择本地图片 / PDF / 网页 / 其它文档，自动嵌入" @click="pickEmbedFile">
            <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.folder"></svg></span>本地文件
          </button>
        </div>
      </div>
      <input ref="embedFileInput" type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.svg,.bmp,.pdf,.html,.htm,.doc,.docx,.txt,.ppt,.pptx,.xls,.xlsx" style="display:none" @change="onEmbedFilePicked" />

      <!-- 图片下拉：本地图片 / 在线图库 / 屏幕截图 -->
      <div ref="imgWrap" class="dropdown">
        <button class="btn" :class="{ 'btn--open': imgMenuOpen }" title="插入图片" @click="toggleImgMenu">
          <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.img"></svg></span>图片<span class="caret">▾</span>
        </button>
        <div v-if="imgMenuOpen" class="dropdown__menu">
          <button class="dropdown__item" title="选择本地图片文件（PNG/JPG/GIF/WebP/AVIF/SVG 等）" @click="pickImg">
            <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.folder"></svg></span>本地图片
          </button>
          <button class="dropdown__item" title="在线图片库：搜索 / 分类 / 随机（需联网）" @click="openImgLib(); imgMenuOpen = false">
            <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.img"></svg></span>在线图片库
          </button>
          <button class="dropdown__item" title="屏幕截图：框选屏幕 / 窗口区域插入" @click="openScreenshot">
            <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.capture"></svg></span>屏幕截图
          </button>
        </div>
      </div>
      <input ref="imgFileInput" type="file" accept="image/*" style="display:none" @change="onImgPicked" />
      <input ref="deckJsonInput" type="file" accept=".json,application/json" style="display:none" @change="onDeckJsonPicked" />
    <input ref="docxInput" type="file" accept=".docx" style="display:none" @change="onDocxPicked" />
    <input ref="pdfInput" type="file" accept=".pdf,application/pdf" style="display:none" @change="onPdfPicked" />
    <input ref="pptxInput" type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" style="display:none" @change="onPptxPicked" />

      <!-- 公式下拉：混排公式（粘贴 LaTeX）/ 空白公式 -->
      <div ref="formulaWrap" class="dropdown">
        <button class="btn" :class="{ 'btn--open': formulaMenuOpen }" title="插入公式" @click="toggleFormulaMenu">
          <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.formula"></svg></span>公式<span class="caret">▾</span>
        </button>
        <div v-if="formulaMenuOpen" class="dropdown__menu">
          <button class="dropdown__item" title="粘贴 LaTeX，实时预览，点击插入当前页" @click="openFormulaModal">
            <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.paste"></svg></span>混排公式（粘贴 LaTeX）
          </button>
          <button class="dropdown__item" title="插入一个空白公式元素" @click="addBlankMath">
            <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.blankMath"></svg></span>空白公式
          </button>
          <button class="dropdown__item" title="按章节分类的典型数学公式，点击插入当前页" @click="openFormulaLib">
            <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.library"></svg></span>预制公式库
          </button>
        </div>
      </div>


      <!-- GeoGebra 下拉：空白小程序 / 打开本地 .ggb -->
      <div ref="ggbWrap" class="dropdown">
        <button
          class="btn"
          :class="{ 'btn--open': ggbMenuOpen }"
          title="插入 GeoGebra 小程序"
          @click="toggleGgbMenu"
        >
          <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.ggb"></svg></span>GeoGebra<span class="caret">▾</span>
        </button>
        <div v-if="ggbMenuOpen" class="dropdown__menu">
          <button class="dropdown__item" @click="addBlankGgb">
            <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.plus"></svg></span>空白小程序
          </button>
          <button class="dropdown__item" title="选择本地 .ggb 文件，一步创建并加载" @click="pickGgb">
            <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.folder"></svg></span>打开本地 .ggb
          </button>
          <button v-if="addonOn('geogebra')" class="dropdown__item" title="打开 GeoGebra 作图套件：现场作图，可保存 .ggb 或插入当前页" @click="openGgbSuite">
            <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.fig"></svg></span>作图套件
          </button>
        </div>
      </div>
      <input
        ref="ggbFileInput"
        type="file"
        accept=".ggb"
        style="display: none"
        @change="onGgbPicked"
      />

      <!-- Desmos 下拉：空白计算器 / 导入状态 JSON -->
      <div ref="dsmWrap" class="dropdown">
        <button v-if="addonOn('desmos')"
          class="btn"
          :class="{ 'btn--open': dsmMenuOpen }"
          title="插入 Desmos 图形计算器"
          @click="toggleDsmMenu"
        >
          <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.desmos"></svg></span>Desmos<span class="caret">▾</span>
        </button>
        <div v-if="dsmMenuOpen" class="dropdown__menu">
          <button class="dropdown__item" @click="addBlankDsm">
            <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.plus"></svg></span>空白计算器
          </button>
          <button class="dropdown__item" title="导入之前导出的 Desmos 状态 JSON" @click="pickDsm">
            <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.folder"></svg></span>导入状态 JSON
          </button>
        </div>
      </div>
      <input
        ref="dsmFileInput"
        type="file"
        accept=".json,application/json"
        style="display: none"
        @change="onDsmPicked"
      />
    </div>

    <div class="group group--end">
      <button class="btn" title="切换整套配色主题" @click="openTheme">
        <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.theme"></svg></span>主题
      </button>
      <button class="btn" title="版本历史 / 错误恢复" @click="openVersion">
        <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.version"></svg></span>版本
      </button>
      <button class="btn" title="文稿 / 主题 / 过渡设置" @click="openSettings">
        <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.settings"></svg></span>设置
      </button>
      <button class="btn" title="模板库：幻灯片·数学风 / 高中数学例题 / 专业模板" @click="openTemplates">
        <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.templates"></svg></span>模板库
      </button>
    <div class="group">
      <div ref="helpWrap" class="dropdown">
        <button class="btn" :class="{ 'btn--open': helpMenuOpen }" title="帮助" @click="toggleHelpMenu">
          <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.theme"></svg></span>帮助
        </button>
        <div v-if="helpMenuOpen" class="dropdown__menu">
          <button class="dropdown__item" title="使用帮助：按章节浏览与搜索" @click="gotoHelp">使用帮助…</button>
          <button class="dropdown__item" title="解锁 addon：关掉的功能入口隐藏、代码不加载" @click="openAddonMgr">解锁功能…</button>
        </div>
      </div>
    </div>
      <!-- 【M1】数学讲义：知识梳理 + 例题精讲 + 练习；一份内容出**学生版 / 教师版** ✓ -->
      <button class="btn" title="数学讲义：写讲义（知识梳理 / 例题精讲 / 变式 / 练习），一键切学生版与教师版，打印导出 PDF" @click="needLic('handout') && emit('open-handout')">
        <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.paper"></svg></span>讲义
      </button>
      <button v-if="addonOn('pdf-gen')" class="btn" title="试卷编辑：把 Markdown / 试卷写成 A4 文档并导出 PDF" @click="needLic('paper-edit') && openPaper()">
        <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.paper"></svg></span>试卷编辑
      </button>
      <button class="btn btn--primary" @click="present">
        <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.play"></svg></span>演示
      </button>
    </div>
  </header>

  <PdfImportDialog v-if="pdfImportOpen && pdfImportFile" :file="pdfImportFile" @close="closePdfImport()" @done="onPdfDone" />
  <SymbolPalette v-if="symbolOpen" @close="symbolOpen = false" />
  <MathFigurePalette v-if="figPaletteOpen" @close="figPaletteOpen = false" />
    <!-- 【v1674】序列号对话框（机器码 / 粘贴或选 .ljsn / 激活） -->
    <LicenseDialog v-if="licOpen" @close="licOpen = false" />
  <IconPalette v-if="iconOpen" @close="iconOpen = false" />
  <ImageLibrary v-if="imgLibOpen" @close="imgLibOpen = false" />
  <ScreenshotCapture v-if="screenshotOpen" @close="screenshotOpen = false" />
  <ThemePalette v-if="themeOpen" @close="themeOpen = false" />
  <VersionHistory v-if="versionOpen" @close="versionOpen = false" />
    <SaveAsDialog v-if="saveAsOpen" :name="saveAsName" :text="saveAsText" @close="saveAsOpen = false" @saved="onDeckSaved" />
  <DeckLibraryDialog v-if="deckLibOpen" @close="deckLibOpen = false" />
  <QuestionBankPanel v-if="qbOpen" @close="qbOpen = false" />
  <SettingsPanel v-if="settingsOpen" @close="settingsOpen = false" />
  <FormulaInserter v-if="formulaModalOpen" @close="formulaModalOpen = false" />
  <FormulaLibrary v-if="formulaLib.open" @close="closeFormulaLibrary()" />
  <div v-if="fileToast" class="file-toast">{{ fileToast }}</div>
  <AddonManager v-if='addonMgrOpen' @close='addonMgrOpen = false' />
</template>

<style scoped>
.toolbar {
  min-height: 52px;
  flex: none;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  column-gap: 10px;
  row-gap: 6px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  box-shadow: var(--shadow-xs);
  position: relative;
  z-index: 20;
}

/* ---------- 品牌锁标 ---------- */
.brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding-right: 4px;
  user-select: none;
}
.brand__mark {
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(140deg, var(--brand-500), var(--brand-700));
  box-shadow: 0 2px 6px rgba(124, 58, 237, 0.32);
}
.brand__mark svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: #fff;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.brand__text {
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
  white-space: nowrap;
}
/* ---------- 分组与分隔 ---------- */
.group { display: flex; gap: 6px; align-items: center; }
.group + .group { position: relative; }
.group + .group::before {
  content: '';
  position: absolute;
  left: -6px;
  top: 50%;
  transform: translateY(-50%);
  width: 1px;
  height: 20px;
  background: var(--border-strong);
}
/* 撤销 / 重做 / 逐条：放在最左边（logo 之后），用分隔线自成一组、图标略大，好找 */
.group--undo { gap: 4px; margin-right: 10px; padding-right: 10px; border-right: 1px solid var(--border); }
.group--undo .btn { padding: 5px 9px; }
.group--undo .btn__svg { width: 17px; height: 17px; }
.group--end { margin-left: auto; }
.spacer { flex: 1; }

/* ---------- 按钮 ---------- */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: none;
  white-space: nowrap;
  height: 32px;
  padding: 0 11px;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid var(--border-strong);
  background: var(--panel);
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text);
  transition: background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease),
              box-shadow var(--dur-1) var(--ease), transform var(--dur-1) var(--ease),
              color var(--dur-1) var(--ease);
}
.btn:hover:not(:disabled) {
  background: var(--gray-50);
  border-color: var(--gray-400);
  transform: translateY(-1px);
  box-shadow: var(--shadow-xs);
}
.btn:active:not(:disabled) { transform: translateY(0); box-shadow: none; }
.btn:disabled { opacity: 0.42; cursor: not-allowed; }
.btn--open {
  background: var(--brand-50);
  border-color: var(--brand-200);
  color: var(--brand-800);
}
.btn--open:hover:not(:disabled) { background: var(--brand-100); border-color: var(--brand-300); }
.btn--primary {
  background: linear-gradient(135deg, var(--brand-500), var(--brand-700));
  border-color: transparent;
  color: #fff;
  padding: 0 14px;
  box-shadow: 0 2px 8px rgba(124, 58, 237, 0.34);
}
.btn--primary:hover:not(:disabled) {
  background: linear-gradient(135deg, var(--brand-600), var(--brand-800));
  border-color: transparent;
  box-shadow: 0 6px 16px rgba(124, 58, 237, 0.40);
}
.btn__icon { font-size: 14px; line-height: 1; display: inline-flex; align-items: center; }
.btn__svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
  display: inline-block;
}
.caret {
  font-size: 8px;
  color: var(--gray-500);
  margin-left: 1px;
  transition: transform var(--dur-1) var(--ease);
  display: inline-block;
}
.btn--open .caret { transform: rotate(180deg); color: var(--brand-600); }

/* ---------- 下拉菜单 ---------- */
.dropdown { position: relative; }
.dropdown__menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  min-width: 196px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 5px;
  z-index: 100;
  animation: fx-pop var(--dur-1) var(--ease);
}
/* 【v1568】文件菜单的分组标题 —— 只用「插入」加 4 行，不动原行 ✓ */
.dropdown__group {
  padding: 6px 9px 3px;
  font-size: 11px;
  line-height: 1;
  letter-spacing: .04em;
  color: var(--muted);
  user-select: none;
}
.dropdown__item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  box-sizing: border-box;
  min-height: 34px;
  padding: 7px 9px;
  font-size: 13px;
  border: none;
  background: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text);
  text-align: left;
  transition: background var(--dur-1) var(--ease), color var(--dur-1) var(--ease);
}
.dropdown__item:hover { background: var(--brand-50); color: var(--brand-800); }
.dropdown__item--on { background: var(--brand-100); color: var(--brand-800); font-weight: 600; }
.dropdown__item--on .dropdown__icon { color: var(--brand-600); }
.dropdown__icon {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  color: var(--gray-500);
  transition: color var(--dur-1) var(--ease);
}
.dropdown__item:hover .dropdown__icon { color: var(--brand-600); }
.dd__svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
  display: inline-block;
}

/* ---------- 轻提示 ---------- */
.file-toast {
  position: fixed;
  left: 50%;
  bottom: 26px;
  transform: translateX(-50%);
  z-index: 3000;
  background: rgba(34, 34, 42, 0.94);
  color: #fff;
  padding: 9px 18px;
  border-radius: var(--radius-full);
  font-size: 13px;
  font-weight: 500;
  box-shadow: var(--shadow-lg);
  animation: fx-pop var(--dur-2) var(--ease);
}
</style>