<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { useDeckStore } from '@/stores/deck'
import { renderDeckToRevealHtml } from '@/reveal/renderer'
import type { ElementType, EmbedKind, SlideElement } from '@/types'
import SymbolPalette from './SymbolPalette.vue'
import MathFigurePalette from './MathFigurePalette.vue'
import IconPalette from './IconPalette.vue'
import ImageLibrary from './ImageLibrary.vue'
import ScreenshotCapture from './ScreenshotCapture.vue'
import ThemePalette from './ThemePalette.vue'
import FormulaInserter from './FormulaInserter.vue'
import FormulaLibrary from './FormulaLibrary.vue'
import { formulaLib, openFormulaLibrary, closeFormulaLibrary } from '@/ui/formulaLibrary'
import VersionHistory from './VersionHistory.vue'
import SettingsPanel from './SettingsPanel.vue'

const store = useDeckStore()
const emit = defineEmits<{ (e: 'present'): void; (e: 'open-templates'): void; (e: 'open-paper'): void; (e: 'open-ggb-suite'): void }>()

const symbolOpen = ref(false)
const figOpen = ref(false)
const iconOpen = ref(false)
const imgLibOpen = ref(false)
const screenshotOpen = ref(false)
const imgMenuOpen = ref(false)
const shapeMenuOpen = ref(false)
const shapeWrap = ref<HTMLElement | null>(null)
const embedMenuOpen = ref(false)
const embedWrap = ref<HTMLElement | null>(null)
const embedFileInput = ref<HTMLInputElement | null>(null)
const imgWrap = ref<HTMLElement | null>(null)
const imgFileInput = ref<HTMLInputElement | null>(null)
const themeOpen = ref(false)
const versionOpen = ref(false)
const settingsOpen = ref(false)
const fileOpen = ref(false)
const fileWrap = ref<HTMLElement | null>(null)
const fileToast = ref('')
const drawOpen = ref(false)
const drawWrap = ref<HTMLElement | null>(null)
const moreOpen = ref(false)
const moreWrap = ref<HTMLElement | null>(null)
const formulaMenuOpen = ref(false)
const formulaWrap = ref<HTMLElement | null>(null)
const formulaModalOpen = ref(false)

/** 顶部插入类的按钮：先退出绘制工具，再插入默认元素 */
function addFromToolbar(type: ElementType) {
  store.clearDrawTool()
  store.addElement(type)
}
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
  figOpen.value = true
}
function toggleShapeMenu() { toggleShown(shapeMenuOpen) }
function addRect() { shapeMenuOpen.value = false; store.clearDrawTool(); store.addElement('shape', { shape: 'rect' } as Partial<SlideElement>) }
function addEllipse() { shapeMenuOpen.value = false; store.clearDrawTool(); store.addElement('shape', { shape: 'ellipse' } as Partial<SlideElement>) }
function addLine() { shapeMenuOpen.value = false; store.clearDrawTool(); store.addElement('line', { stroke: '#1a1a1a', strokeWidth: 3, w: 360, h: 200, rot: 0, points: [0.08, 0.5, 0.92, 0.5] } as Partial<SlideElement>) }
function addArrow() { shapeMenuOpen.value = false; store.clearDrawTool(); store.addElement('arrow', { stroke: '#1a1a1a', strokeWidth: 3, w: 360, h: 200, rot: 0, points: [0.08, 0.5, 0.92, 0.5] } as Partial<SlideElement>) }
/** 关闭所有下拉菜单（互斥：打开一个时关闭其它，避免叠在一起） */
function closeAllDropdowns() {
  fileOpen.value = false
  shapeMenuOpen.value = false
  embedMenuOpen.value = false
  imgMenuOpen.value = false
  formulaMenuOpen.value = false
  drawOpen.value = false
  moreOpen.value = false
  ggbMenuOpen.value = false
  dsmMenuOpen.value = false
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
let toastTimer: number | undefined
function flashToast() {
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { fileToast.value = '' }, 2500) as unknown as number
}
function toggleDrawMenu() { toggleShown(drawOpen) }
function toggleMoreMenu() { toggleShown(moreOpen) }
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
function openPaper() {
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

/** 工具栏/下拉 SVG 图标（统一样式：描边、无填充、圆头） */
const I: Record<string, string> = {
  file: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  templates: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  formula: '<path d="M18 6H7l5 6-5 6h11"/>',
  draw: '<path d="M3 21l1.5-4.5L17 4l3 3L7.5 19.5 3 21zM15 6l3 3"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  theme: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><circle cx="17" cy="17" r="4"/>',
  version: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
  ggb: '<path d="M4 20h16M20 4v16"/><circle cx="8" cy="15" r="1"/><circle cx="15" cy="8" r="1"/>',
  desmos: '<path d="M4 16c2-7 5-11 8-11s6 4 8 11"/>',
  new: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 14v6M9 17h6"/>',
  save: '<path d="M12 3v10M7 9l5 4 5-4M5 19h14"/>',
  html: '<path d="M4 5h16v13H4zM8 9l-2 2 2 2M16 9l2 2-2 2"/>',
  paste: '<path d="M8 3h8l1 3H7zM5 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2"/><path d="M8 11h8M8 15h8"/>',
  blankMath: '<path d="M8 4v16M16 4v16M8 12l8-4M8 12l8 4"/>',
  library: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/>',
  symbol: '<path d="M18 6H7l5 6-5 6h11"/>',
  fig: '<rect x="3" y="3" width="18" height="18" rx="2"/>',
  icon: '<path d="M12 3l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9 6.7 19.2l1-5.8L3.5 9.3l5.9-.9z"/>',
  img: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/>',
  shape: '<rect x="3" y="3" width="18" height="18" rx="2"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
  line: '<path d="M4 20L20 4"/>',
  arrow: '<path d="M4 20L18 6M13 5h6v6"/>',
  capture: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 8h8v8H8z"/><circle cx="12" cy="12" r="1.4"/>',
  pen: '<path d="M3 21l1.5-4.5L17 4l3 3L7.5 19.5 3 21zM15 6l3 3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  embed: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 11l-2 2 2 2M16 11l2 2-2 2M13 9l-2 6"/>',
  undo: '<path d="M4 7v5h5M4 12a8 8 0 1 0 2-5.3L4 9"/>',
  redo: '<path d="M20 7v5h-5M20 12a8 8 0 1 1-2-5.3l2 2.3"/>',
  fragment: '<path d="M8 5v14l10-7z"/>',
  paper: '<path d="M6 2h8l4 4v16H6zM14 2v5h4M9 13h6M9 17h6"/>',
  play: '<path d="M8 5l12 7-12 7z"/>',
}

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
const ggbMenuOpen = ref(false)
const ggbWrap = ref<HTMLElement | null>(null)
function toggleGgbMenu() {
  toggleShown(ggbMenuOpen)
}
function addBlankGgb() {
  ggbMenuOpen.value = false
  store.addElement('geogebra')
}
function openGgbSuite() {
  ggbMenuOpen.value = false
  store.clearDrawTool()
  emit('open-ggb-suite')
}
/** Desmos 下拉菜单：空白计算器 / 导入状态 JSON */
const dsmMenuOpen = ref(false)
const dsmWrap = ref<HTMLElement | null>(null)
const dsmFileInput = ref<HTMLInputElement | null>(null)
function toggleDsmMenu() {
  toggleShown(dsmMenuOpen)
}
function addBlankDsm() {
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

function onDocClick(e: MouseEvent) {
  if (ggbMenuOpen.value && ggbWrap.value && !ggbWrap.value.contains(e.target as Node)) {
    ggbMenuOpen.value = false
  }
  if (dsmMenuOpen.value && dsmWrap.value && !dsmWrap.value.contains(e.target as Node)) {
    dsmMenuOpen.value = false
  }
  if (drawOpen.value && drawWrap.value && !drawWrap.value.contains(e.target as Node)) {
    drawOpen.value = false
  }
  if (moreOpen.value && moreWrap.value && !moreWrap.value.contains(e.target as Node)) {
    moreOpen.value = false
  }
  if (formulaMenuOpen.value && formulaWrap.value && !formulaWrap.value.contains(e.target as Node)) {
    formulaMenuOpen.value = false
  }
  if (fileOpen.value && fileWrap.value && !fileWrap.value.contains(e.target as Node)) {
    fileOpen.value = false
  }
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <header class="toolbar">
    <span class="brand">
      <span class="brand__mark">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 19c3.4 0 3.4-15 7-15s3.6 15 7 15 3.4-7 6-7"/></svg>
      </span>
      <span class="brand__text">LJ-MathSlides <small>Vue</small></span>
    </span>

    <div class="group">
      <div ref="fileWrap" class="dropdown">
        <button class="btn" :class="{ 'btn--open': fileOpen }" title="文件" @click="toggleFileMenu">
          <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.file"></svg></span>文件<span class="caret">▾</span>
        </button>
        <div v-if="fileOpen" class="dropdown__menu">
          <button class="dropdown__item" @click="newDeck"><span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.new"></svg></span>新建演示</button>
          <button class="dropdown__item" @click="saveDeck"><span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.save"></svg></span>保存</button>
          <button class="dropdown__item" title="导出独立 HTML" @click="exportHtml"><span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.html"></svg></span>导出 HTML</button>
        </div>
      </div>
    </div>

    <div class="group">
      <button v-for="b in addButtons" :key="b.type" class="btn" @click="addFromToolbar(b.type)">
        <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="b.svg"></svg></span>{{ b.label }}
      </button>

      <!-- 形状下拉：矩形 / 椭圆 / 数学图形 -->
      <div ref="shapeWrap" class="dropdown">
        <button class="btn" :class="{ 'btn--open': shapeMenuOpen }" title="插入形状 / 数学图形" @click="toggleShapeMenu">
          <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.shape"></svg></span>形状<span class="caret">▾</span>
        </button>
        <div v-if="shapeMenuOpen" class="dropdown__menu">
          <button class="dropdown__item" @click="addRect">
            <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.rect"></svg></span>矩形
          </button>
          <button class="dropdown__item" @click="addEllipse">
            <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.ellipse"></svg></span>椭圆
          </button>
          <button class="dropdown__item" @click="addLine">
            <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.line"></svg></span>直线
          </button>
          <button class="dropdown__item" @click="addArrow">
            <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.arrow"></svg></span>箭头
          </button>
          <button class="dropdown__item" title="数学图形：抛物线 / 三角形 / 贝塞尔 / 自定义多边形等" @click="openFig(); shapeMenuOpen = false">
            <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.fig"></svg></span>数学图形…
          </button>
        </div>
      </div>

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

      <!-- 绘制下拉：直线 / 箭头 / 笔 -->
      <div ref="drawWrap" class="dropdown">
        <button
          class="btn"
          :class="{ 'btn--open': drawOpen || !!store.drawTool }"
          title="在画布空白处拖拽绘制"
          @click="toggleDrawMenu"
        >
          <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.draw"></svg></span>绘制<span class="caret">▾</span>
        </button>
        <div v-if="drawOpen" class="dropdown__menu">
          <button
            v-for="d in drawButtons"
            :key="d.type"
            class="dropdown__item"
            :class="{ 'dropdown__item--on': store.drawTool === d.type }"
            :title="d.title || ('在画布空白处拖拽绘制 ' + d.label)"
            @click="toggleDraw(d.type); drawOpen = false"
          >
            <span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="d.svg"></svg></span>{{ d.label }}
          </button>
        </div>
      </div>

      <!-- 插入下拉：符号 / 图形 / 图标 / 图片库 -->
      <div ref="moreWrap" class="dropdown">
        <button
          class="btn"
          :class="{ 'btn--open': moreOpen }"
          title="更多插入：数学符号 / 图形 / 图标"
          @click="toggleMoreMenu"
        >
          <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.more"></svg></span>更多<span class="caret">▾</span>
        </button>
        <div v-if="moreOpen" class="dropdown__menu">
          <button class="dropdown__item" @click="openSymbol(); moreOpen = false"><span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.symbol"></svg></span>数学符号</button>
          <button class="dropdown__item" @click="openIcon(); moreOpen = false"><span class="dropdown__icon"><svg viewBox="0 0 24 24" class="dd__svg" v-html="I.icon"></svg></span>图标库</button>
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
          <button class="dropdown__item" title="打开 GeoGebra 作图套件：现场作图，可保存 .ggb 或插入当前页" @click="openGgbSuite">
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
        <button
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

    <div class="group">
      <button class="btn" :disabled="!store.canUndo" title="撤销 (Ctrl+Z)" @click="store.undo()"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.undo"></svg>撤销</button>
      <button class="btn" :disabled="!store.canRedo" title="重做 (Ctrl+Y)" @click="store.redo()"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.redo"></svg>重做</button>
      <button class="btn" :class="{ 'btn--open': allFragments }" title="本页所有元素逐条出现（演示时点击渐显）" @click="toggleAllFragments">
        <svg viewBox="0 0 24 24" class="btn__svg" v-html="I.fragment"></svg>逐条
      </button>
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
      <button class="btn" title="模板库：高中数学讲义模板 / 专业模板" @click="openTemplates">
        <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.templates"></svg></span>模板库
      </button>
      <button class="btn" title="试卷/讲义模式（A4）" @click="openPaper">
        <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.paper"></svg></span>试卷/讲义
      </button>
      <button class="btn btn--primary" @click="present">
        <span class="btn__icon"><svg viewBox="0 0 24 24" class="btn__svg" v-html="I.play"></svg></span>演示
      </button>
    </div>
  </header>

  <SymbolPalette v-if="symbolOpen" @close="symbolOpen = false" />
  <MathFigurePalette v-if="figOpen" @close="figOpen = false" />
  <IconPalette v-if="iconOpen" @close="iconOpen = false" />
  <ImageLibrary v-if="imgLibOpen" @close="imgLibOpen = false" />
  <ScreenshotCapture v-if="screenshotOpen" @close="screenshotOpen = false" />
  <ThemePalette v-if="themeOpen" @close="themeOpen = false" />
  <VersionHistory v-if="versionOpen" @close="versionOpen = false" />
  <SettingsPanel v-if="settingsOpen" @close="settingsOpen = false" />
  <FormulaInserter v-if="formulaModalOpen" @close="formulaModalOpen = false" />
  <FormulaLibrary v-if="formulaLib.open" @close="closeFormulaLibrary()" />
  <div v-if="fileToast" class="file-toast">{{ fileToast }}</div>
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
.brand small {
  font-size: 10px;
  font-weight: 500;
  color: var(--brand-700);
  background: var(--brand-50);
  border: 1px solid var(--brand-100);
  border-radius: var(--radius-full);
  padding: 1px 6px;
  margin-left: 5px;
  vertical-align: 1px;
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