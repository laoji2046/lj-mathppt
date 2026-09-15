import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type {
  AlignMode, Deck, DistributeAxis, ElementType, Rect, Slide, SlideElement, ZOrderAction,
} from '@/types'
import { createElement, findTheme, GRAPHIC_TYPES } from '@/types'
import { findTemplate } from '@/templates/mathTemplates'
import { findSlideLayout, type LayoutSlot } from '@/templates/slideLayouts'
import { getTheme } from '@/templates/pptTheme'
import { findBundle } from '@/templates/mathBundles'
import { findProTemplate, findProBundle } from '@/templates/proTemplates'
import { findMathAppletTemplate } from '@/templates/mathAppletTemplates'
import { restyleDeck } from '@/templates/restyle'
import { requireAddon } from '@/addons/registry'
import { autoTemplateDeck, type AutoApplyResult } from '@/templates/autoTemplate'

const STORAGE_KEY = 'lj-mathslides-vue:deck'
const VERSIONS_KEY = 'lj-mathslides-vue:versions'
const HISTORY_LIMIT = 100
const VERSIONS_LIMIT = 20

/** 版本历史快照 */
interface Version {
  id: string
  label: string
  time: number
  deck: Deck
}

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function emptySlide(): Slide {
  return { id: uid('slide'), bg: '#ffffff', elements: [] }
}

function initialDeck(): Deck {
  return { title: '未命名演示', width: 1920, height: 1080, slides: [emptySlide()] }
}

/** 校验并补齐旧版本字段（防止旧 JSON 导入后因缺字段而崩溃）；结构非法返回 null */
function normalizeDeck(raw: unknown): Deck | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as Deck).slides)) return null
  const deck = raw as Deck
  if (typeof deck.title !== 'string') deck.title = '导入演示'
  if (typeof deck.width !== 'number' || !deck.width) deck.width = 1920
  if (typeof deck.height !== 'number' || !deck.height) deck.height = 1080
  if (typeof deck.theme !== 'string' || !deck.theme) deck.theme = 'white'
  deck.slides = deck.slides.map((s) => {
    if (!s || typeof s !== 'object') s = { id: uid('slide'), bg: '#ffffff', elements: [] } as unknown as Slide
    if (typeof s.id !== 'string' || !s.id) s.id = uid('slide')
    if (typeof s.bg !== 'string' || !s.bg) s.bg = '#ffffff'
    if (!Array.isArray(s.elements)) s.elements = []
    s.elements = s.elements.filter((el) => el && typeof el === 'object')
    for (const el of s.elements) {
      const any = el as any
      if (typeof any.id !== 'string' || !any.id) any.id = uid('el')
      if (typeof any.type !== 'string' || !any.type) any.type = 'text'
      if (typeof any.x !== 'number') any.x = 0
      if (typeof any.y !== 'number') any.y = 0
      if (typeof any.w !== 'number') any.w = 400
      if (typeof any.h !== 'number') any.h = 280
      if (typeof any.rot !== 'number') any.rot = 0
      if (typeof any.fragment !== 'boolean') any.fragment = false
      if (any.type === 'text' || any.type === 'richtex') {
        if (typeof any.fontFamily !== 'string' || !any.fontFamily) any.fontFamily = 'sans'
        if (typeof any.bgColor !== 'string' || !any.bgColor) any.bgColor = 'transparent'
        if (typeof any.shadow !== 'string' || !any.shadow) any.shadow = 'none'
        if (typeof any.fontSize !== 'number') any.fontSize = 26
        if (typeof any.fontWeight !== 'number') any.fontWeight = 400
        if (typeof any.align !== 'string') any.align = 'left'
        if (typeof any.color !== 'string' || !any.color) any.color = '#1a1a1a'
      }
      if (any.type === 'math') {
        if (typeof any.fontSize !== 'number') any.fontSize = 32
        if (typeof any.align !== 'string') any.align = 'center'
        if (typeof any.color !== 'string' || !any.color) any.color = '#1a1a1a'
      }
      if (any.type === 'shape') {
        if (!any.shape) any.shape = 'rect'
        if (typeof any.strokeWidth !== 'number') any.strokeWidth = 0
        if (typeof any.stroke !== 'string' || !any.stroke) any.stroke = '#1a1a1a'
        if (typeof any.fill !== 'string') any.fill = 'transparent'
      }
      if (any.type === 'image') { if (typeof any.fit !== 'string') any.fit = 'contain' }
      if (any.type === 'geogebra') { if (typeof any.showAxis !== 'boolean') any.showAxis = true; if (typeof any.showGrid !== 'boolean') any.showGrid = false }
      if (any.type === 'desmos') { if (typeof any.state !== 'string' || any.state == null) any.state = ''; if (typeof any.showPanel !== 'boolean') any.showPanel = true; if (typeof any.showToolbar !== 'boolean') any.showToolbar = true; if (typeof any.color !== 'string' || !any.color) any.color = '#4a4a4a' }
      if (any.type === 'embed') { if (typeof any.kind !== 'string' || !any.kind) any.kind = 'url'; if (typeof any.dataBase64 !== 'string') any.dataBase64 = ''; if (typeof any.mime !== 'string') any.mime = '' }
    }
    return s
  })
  return deck
}

function loadDeck(): Deck {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return initialDeck()
    const parsed = JSON.parse(raw)
    const n = normalizeDeck(parsed)
    return n || initialDeck()
  } catch {
    return initialDeck()
  }
}

/** 若干矩形的外接矩形 */
function union(rects: Rect[]): Rect | null {
  if (!rects.length) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const r of rects) {
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y)
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** 参与对齐/分布的最小单位：同一组合视为一个整体 */
interface Unit {
  key: string
  els: SlideElement[]
  bounds: Rect
}

export const useDeckStore = defineStore('deck', () => {
  const deck = ref<Deck>(loadDeck())
  const currentIndex = ref(0)
  /** 多选：选中的元素 id 列表 */
  const selectedIds = ref<string[]>([])
  /** 画布绘制工具（线/箭头/笔/多边形）：设置后在画布上绘制；多边形为点击放角点 */
  const drawTool = ref<'line' | 'arrow' | 'pen' | 'poly' | null>(null)
  /**
   * 组内单独编辑：非空表示正停留在某个组合内部。
   * 此态下点击/拖拽/属性修改只作用于组内那一个元素，组合本身不解散
   * （类似 PowerPoint 双击进入组合内部）。
   */
  const editingGroupId = ref<string | null>(null)

  // ---- 撤销 / 重做（快照式）----
  const past = ref<string[]>([])
  const future = ref<string[]>([])

  function pushHistory() {
    past.value.push(JSON.stringify(deck.value))
    if (past.value.length > HISTORY_LIMIT) past.value.shift()
    future.value = []
  }
  function undo() {
    const prev = past.value.pop()
    if (!prev) return
    future.value.push(JSON.stringify(deck.value))
    deck.value = JSON.parse(prev)
    clampIndex()
    pruneSelection()
  }
  function redo() {
    const next = future.value.pop()
    if (!next) return
    past.value.push(JSON.stringify(deck.value))
    deck.value = JSON.parse(next)
    clampIndex()
    pruneSelection()
  }
  const canUndo = computed(() => past.value.length > 0)
  const canRedo = computed(() => future.value.length > 0)

  // ---- 版本历史（快照 / 恢复 / 删除）----
  function loadVersions(): Version[] {
    try {
      const raw = localStorage.getItem(VERSIONS_KEY)
      const arr = raw ? JSON.parse(raw) : []
      return Array.isArray(arr) ? arr : []
    } catch {
      return []
    }
  }
  const versions = ref<Version[]>(loadVersions())
  function persistVersions() {
    try { localStorage.setItem(VERSIONS_KEY, JSON.stringify(versions.value)) } catch {}
  }
  function saveVersion(label?: string) {
    const id = uid('ver')
    versions.value.unshift({
      id,
      label: label?.trim() || `快照 ${versions.value.length + 1}`,
      time: Date.now(),
      deck: JSON.parse(JSON.stringify(deck.value)) as Deck,
    })
    if (versions.value.length > VERSIONS_LIMIT) versions.value.splice(VERSIONS_LIMIT)
    persistVersions()
  }
  function restoreVersion(id: string) {
    const v = versions.value.find((x) => x.id === id)
    if (!v) return
    pushHistory()
    deck.value = JSON.parse(JSON.stringify(v.deck)) as Deck
    clampIndex()
    pruneSelection()
  }
  function deleteVersion(id: string) {
    versions.value = versions.value.filter((x) => x.id !== id)
    persistVersions()
  }

  // ---- 派生状态 ----
  const currentSlide = computed<Slide | undefined>(() => deck.value.slides[currentIndex.value])
  const slideCount = computed(() => deck.value.slides.length)

  const selectedElements = computed<SlideElement[]>(() => {
    if (!currentSlide.value) return []
    const ids = new Set(selectedIds.value)
    return currentSlide.value.elements.filter((e) => ids.has(e.id))
  })
  const selectionCount = computed(() => selectedIds.value.length)
  /** 单选时直接给出该元素，方便属性面板 */
  const selectedElement = computed<SlideElement | undefined>(() =>
    selectedElements.value.length === 1 ? selectedElements.value[0] : undefined,
  )
  /** 选区外接框（组合会被整体计入）*/
  const selectionBounds = computed<Rect | null>(() =>
    union(selectedElements.value.map((e) => ({ x: e.x, y: e.y, w: e.w, h: e.h }))),
  )

  function isSelected(id: string) {
    return selectedIds.value.includes(id)
  }

  /** 页面切换或撤销后，清掉已不存在的选中项 */
  function pruneSelection() {
    if (!currentSlide.value) { selectedIds.value = []; return }
    const alive = new Set(currentSlide.value.elements.map((e) => e.id))
    selectedIds.value = selectedIds.value.filter((id) => alive.has(id))
  }

  function clampIndex() {
    if (currentIndex.value >= deck.value.slides.length) currentIndex.value = deck.value.slides.length - 1
    if (currentIndex.value < 0) currentIndex.value = 0
  }

  // ---- 选择 ----
  /** 把 id 展开为「整组」：点任一成员即选中全组 */
  function expandGroups(ids: string[]): string[] {
    if (!currentSlide.value) return ids
    const els = currentSlide.value.elements
    // 组内编辑态：只圈定「属于该组」的元素，不再把整组拉进来
    const gid = editingGroupId.value
    if (gid) return ids.filter((id) => els.find((e) => e.id === id)?.groupId === gid)
    const groupIds = new Set<string>()
    for (const id of ids) {
      const el = els.find((e) => e.id === id)
      if (el?.groupId) groupIds.add(el.groupId)
    }
    if (!groupIds.size) return ids
    const out = new Set(ids)
    for (const e of els) if (e.groupId && groupIds.has(e.groupId)) out.add(e.id)
    return [...out]
  }

  /** 进入组内单独编辑：此后点击/拖拽/改属性只作用于组内那一个元素 */
  function enterGroup(id: string) {
    const el = currentSlide.value?.elements.find((e) => e.id === id)
    if (!el?.groupId) return
    editingGroupId.value = el.groupId
    selectedIds.value = [id]   // 直接赋值：此刻已进组内，不能再被 expandGroups 展开
  }
  /** 退出组内编辑：回到整组选中（保持组合不被解散） */
  function exitGroup() {
    const gid = editingGroupId.value
    if (!gid) return
    editingGroupId.value = null
    const ids = (currentSlide.value?.elements ?? []).filter((e) => e.groupId === gid).map((e) => e.id)
    selectedIds.value = ids
  }
  /** 组内编辑态下点了组外的东西 —— 先退出，再按常规逻辑选中 */
  function syncGroupOnSelect(id: string) {
    const gid = editingGroupId.value
    if (!gid) return
    const el = currentSlide.value?.elements.find((e) => e.id === id)
    if (!el || el.groupId !== gid) exitGroup()
  }

  /** additive=true 时为 Ctrl 加选（点已选项则取消） */
  function selectElement(id: string, additive = false) {
    syncGroupOnSelect(id)
    const expanded = expandGroups([id])
    if (!additive) {
      selectedIds.value = expanded
      return
    }
    const allIn = expanded.every((i) => selectedIds.value.includes(i))
    if (allIn) {
      const drop = new Set(expanded)
      selectedIds.value = selectedIds.value.filter((i) => !drop.has(i))
    } else {
      selectedIds.value = [...new Set([...selectedIds.value, ...expanded])]
    }
  }

  function setSelection(ids: string[]) {
    if (ids.length) syncGroupOnSelect(ids[0])
    selectedIds.value = expandGroups(ids)
  }
  function clearSelection() {
    selectedIds.value = []
    // 点空白处取消选择时一并退出组内编辑，避免「看不见的组内态」残留
    editingGroupId.value = null
  }

  // ---- 页面 ----
  function addSlide() {
    pushHistory()
    deck.value.slides.splice(currentIndex.value + 1, 0, emptySlide())
    currentIndex.value += 1
    clearSelection()
  }
  /** 在当前页之后添加一个子页（挂在当前页或其父页下） */
  function addSubpageAfterCurrent() {
    if (!currentSlide.value) return
    pushHistory()
    const cur = currentSlide.value
    let parent = cur
    if (cur.parentId) {
      const p = deck.value.slides.find((s) => s.id === cur.parentId)
      if (p) parent = p
    }
    const s = emptySlide()
    s.parentId = parent.id
    deck.value.slides.splice(currentIndex.value + 1, 0, s)
    currentIndex.value += 1
    clearSelection()
  }
  /** 用一个单页模板在当前页后新增一页（asSubpage=true 设为子页） */
  function addPageWithTemplate(id: string, asSubpage = false) {
    if (!currentSlide.value) return
    const tpl = findTemplate(id) || findMathAppletTemplate(id) || findProTemplate(id)
    if (!tpl) return
    pushHistory()
    let parent: Slide | undefined
    if (asSubpage) parent = currentSlide.value?.parentId ? deck.value.slides.find((s) => s.id === currentSlide.value?.parentId) : currentSlide.value
    const s: Slide = { ...emptySlide(), elements: (tpl.build() as SlideElement[]).flat() as SlideElement[] }
    if (asSubpage && parent) s.parentId = parent.id
    deck.value.slides.splice(currentIndex.value + 1, 0, s)
    currentIndex.value += 1
    clearSelection()
  }
  /** 把当前页清成空白 */
  function applyBlank() {
    if (!currentSlide.value) return
    pushHistory()
    currentSlide.value.elements = []
    currentSlide.value.bg = '#ffffff'
  }
  /** 在当前页后新增一个空白页（asSubpage=true 设为子页） */
  function addBlankPage(asSubpage = false) {
    if (!currentSlide.value) return
    pushHistory()
    let parent: Slide | undefined
    if (asSubpage) parent = currentSlide.value?.parentId ? deck.value.slides.find((s) => s.id === currentSlide.value?.parentId) : currentSlide.value
    const s = emptySlide()
    if (asSubpage && parent) s.parentId = parent.id
    deck.value.slides.splice(currentIndex.value + 1, 0, s)
    currentIndex.value += 1
    clearSelection()
  }
  /** 用一个整套模板在当前页后新增一整套页（asSubpage=true 设为子页堆叠） */
  function addBundlePages(id: string, asSubpage = false) {
    if (!currentSlide.value) return
    const b = findBundle(id) || findProBundle(id)
    if (!b || !b.slides.length) return
    pushHistory()
    try { saveVersion('整套插入前') } catch { /* 忽略 */ }
    let parent: Slide | undefined
    if (asSubpage) parent = currentSlide.value?.parentId ? deck.value.slides.find((s) => s.id === currentSlide.value?.parentId) : currentSlide.value
    const insertAt = currentIndex.value + 1
    const news = b.slides.map((s: any) => {
      const ns: Slide = { ...(JSON.parse(JSON.stringify(s)) as Slide), id: uid('slide') }
      ns.elements = (s.elements ?? []).map((e: any) => ({ ...(JSON.parse(JSON.stringify(e)) as SlideElement), id: uid('el') }))
      if (asSubpage && parent) ns.parentId = parent.id
      return ns
    })
    deck.value.slides.splice(insertAt, 0, ...news)
    currentIndex.value = insertAt
    clearSelection()
  }

  /**
   * 插入一批幻灯片（模板库用）。
   * @param slides   要插入的幻灯片（元素 id 已在调用方重生成）
   * @param afterIndex 不传则追加到末尾；传则在该索引之后插入
   */
  function insertSlides(slides: Slide[], afterIndex?: number) {
    if (!slides.length) return
    pushHistory()
    try { saveVersion('插入前') } catch { /* 忽略 */ }
    const insertAt = typeof afterIndex === 'number'
      ? Math.max(0, Math.min(deck.value.slides.length, afterIndex + 1))
      : deck.value.slides.length
    deck.value.slides.splice(insertAt, 0, ...slides)
    currentIndex.value = insertAt
    clearSelection()
  }

  /** 用一个完整的演示覆盖当前（模板库"应用整套讲座"用） */
  function replaceDeck(next: { title?: string; width?: number; height?: number; slides: Slide[] }, opts?: { snapshot?: boolean }) {
    pushHistory()
    // 源码面板边打字边重排时不要建版本快照（否则每敲一下都写一份完整快照，卡且占满 localStorage）
    if (opts?.snapshot !== false) { try { saveVersion('整体替换前') } catch { /* 忽略 */ } }
    deck.value.title = next.title ?? deck.value.title
    deck.value.width = next.width ?? deck.value.width
    deck.value.height = next.height ?? deck.value.height
    deck.value.slides = next.slides.length ? next.slides : [emptySlide()]
    currentIndex.value = 0
    clearSelection()
  }
  /** 导入外部演示 JSON：校验+补齐旧字段；失败则不替换并返回 false */
  function importDeck(raw: unknown): boolean {
    const n = normalizeDeck(raw)
    if (!n || !n.slides || !n.slides.length) return false
    // 导入前自动备份当前演示，日后可一键恢复（文件菜单→版本历史）；导入本身也可 Ctrl+Z 撤销
    try { saveVersion('导入前自动备份') } catch {}
    replaceDeck(n)
    return true
  }
  function removeSlide(index: number) {
    if (deck.value.slides.length <= 1) return
    pushHistory()
    const removed = deck.value.slides[index]
    if (removed?.id) {
      // 解除被删父页的子页（否则子页会丢失）
      for (const s of deck.value.slides) if (s.parentId === removed.id) s.parentId = undefined
    }
    deck.value.slides.splice(index, 1)
    clampIndex()
    clearSelection()
  }
  /** 把某页设为/取消子页（parentId）：子页在 Reveal 中作为父页的垂直堆叠，上下滚动 */
  function setSlideSubpage(index: number, subpage: boolean) {
    const arr = deck.value.slides
    const s = arr[index]
    if (!s) return
    if (!subpage) {
      if (!s.parentId) return
      pushHistory()
      s.parentId = undefined
      clampIndex()
      return
    }
    if (index === 0) return // 首页/封面不可为子页
    // 找到前一个“非子页”作为父页
    let parentIdx = -1
    for (let j = index - 1; j >= 0; j--) if (!arr[j].parentId) { parentIdx = j; break }
    if (parentIdx < 0) return
    pushHistory()
    const parent = arr[parentIdx]
    // 目标位置 = 父页最后一个现有子页之后
    let insertAt = parentIdx + 1
    while (insertAt < arr.length && arr[insertAt].parentId === parent.id) insertAt++
    const cur = arr.indexOf(s)
    if (cur !== insertAt) {
      arr.splice(cur, 1)
      let ia = parentIdx + 1
      while (ia < arr.length && arr[ia].parentId === parent.id) ia++
      s.parentId = parent.id
      arr.splice(ia, 0, s)
    } else {
      s.parentId = parent.id
    }
    currentIndex.value = arr.indexOf(s)
    clearSelection()
  }
  function gotoSlide(index: number) {
    if (index < 0 || index >= deck.value.slides.length) return
    currentIndex.value = index
    clearSelection()
  }
  /** 复制当前页为新建页（元素深拷贝并换新 id） */
  function copySlide(index: number) {
    if (index < 0 || index >= deck.value.slides.length) return
    pushHistory()
    const src = deck.value.slides[index]
    const copy: Slide = {
      id: uid('slide'),
      bg: src.bg,
      elements: src.elements.map((e) => ({ ...(JSON.parse(JSON.stringify(e)) as SlideElement), id: uid('el') })),
    }
    deck.value.slides.splice(index + 1, 0, copy)
    currentIndex.value = index + 1
    clearSelection()
  }
  // ---- 幻灯片剪贴板（右键菜单的 剪切 / 复制 / 粘贴）----
  // 存的是深拷贝：粘贴出来的页面元素会换新 id，跟来源页互不影响
  function cloneSlide(src: Slide): Slide {
    return {
      ...(JSON.parse(JSON.stringify(src)) as Slide),
      id: uid('slide'),
      elements: src.elements.map((e) => ({ ...(JSON.parse(JSON.stringify(e)) as SlideElement), id: uid('el') })),
    }
  }
  const slideClip = ref<Slide[] | null>(null)
  function copySlideToClip(index: number) {
    const s = deck.value.slides[index]
    if (!s) return
    slideClip.value = [JSON.parse(JSON.stringify(s)) as Slide]
  }
  function cutSlideToClip(index: number) {
    const s = deck.value.slides[index]
    if (!s) return
    const n = deck.value.slides.length
    if (n <= 1) return // 只剩一页时不允许剪掉
    copySlideToClip(index)
    removeSlide(index)
  }
  /** 粘到第 index 页之后（PPT 的"粘贴"是插到当前页后面） */
  function pasteSlideAt(index: number) {
    const clip = slideClip.value
    if (!clip?.length) return
    pushHistory()
    const made = clip.map((s) => cloneSlide(s))
    deck.value.slides.splice(index + 1, 0, ...made)
    currentIndex.value = index + 1
    clearSelection()
  }
  /**
   * 套用版式库里的某一套版式（会替换该页内容）。
   *
   * 样式一律**跟文稿主题走**：字号取 TypeScale 档位、字体取主题字体、颜色取主题色、
   * 边距取主题网格 —— 这样套出来的页面跟模板页是同一种版面语言（设计宪法：别随手写死字号/颜色）。
   */
  function applyLayoutToSlide(index: number, layoutId: string) {
    const layout = findSlideLayout(layoutId)
    if (!deck.value.slides[index] || !layout) return
    pushHistory()
    gotoSlide(index)
    const cur = deck.value.slides[index]
    cur.elements = []
    cur.bg = '#ffffff'
    delete cur.bgGradient
    delete cur.bgImage

    const th = getTheme(deck.value.theme || 'edumath')
    const W = deck.value.width || 1920
    const H = deck.value.height || 1080
    const rectOf = (s: LayoutSlot) => ({
      x: Math.round(s.x * W),
      y: Math.round(s.y * H),
      w: Math.round(s.w * W),
      h: Math.round(s.h * H),
    })

    for (const slot of layout.slots) {
      const r = rectOf(slot)
      if (slot.kind === 'image') {
        addElement('image', { ...r, src: '', fit: 'contain' } as Partial<SlideElement>)
        continue
      }
      const isTitle = slot.kind === 'title'
      const isSub = slot.kind === 'subtitle'
      addElement('text', {
        ...r,
        text: slot.text || '',
        fontSize: isTitle ? th.type.h1 : isSub ? th.type.h2 : th.type.body,
        fontFamily: isTitle ? th.fontTitle : th.fontBody,
        fontWeight: isTitle ? 700 : isSub ? 600 : 400,
        color: isTitle ? th.text : isSub ? th.muted : th.text,
        align: slot.align || 'left',
        bgColor: 'transparent',
        shadow: 'none',
        // 标题垂直居中（版面更稳），正文顶对齐并开自动换行
        valign: isTitle ? 'middle' : 'top',
        lineHeight: isTitle ? 1.15 : 1.6,
        wrap: !isTitle,
        letterSpacing: 0,
      } as Partial<SlideElement>)
    }

    // 页眉细线：只给"标题在顶上"的内容页加（封面/章节页的标题是居中的，不加）——
    // 跟模板页保持同一种版面语言；主题里 showHeader=false 时不加
    const topTitle = layout.slots.find((s) => s.kind === 'title' && s.y < 0.2)
    if (th.showHeader && topTitle) {
      addElement('shape', {
        shape: 'rect',
        x: th.grid.margin, y: Math.round(H * 0.05),
        w: W - th.grid.margin * 2, h: 2,
        fill: th.line, stroke: 'none', strokeWidth: 0,
      } as Partial<SlideElement>)
    }
    clearSelection()
  }

  /** 隐藏 / 取消隐藏某页（演示与导出会跳过隐藏页） */
  function toggleSlideHidden(index: number) {
    const s = deck.value.slides[index]
    if (!s) return
    pushHistory()
    if (s.hidden) delete s.hidden
    else s.hidden = true
  }
  /** 重设幻灯片：清空本页元素，背景恢复为纯白 */
  function resetSlide(index: number) {
    const s = deck.value.slides[index]
    if (!s) return
    pushHistory()
    s.elements = []
    s.bg = '#ffffff'
    delete s.bgGradient
    delete s.bgImage
    clearSelection()
  }

  /** 上下移动页面 */
  function moveSlide(index: number, dir: -1 | 1) {
    const to = index + dir
    if (to < 0 || to >= deck.value.slides.length) return
    pushHistory()
    const [s] = deck.value.slides.splice(index, 1)
    deck.value.slides.splice(to, 0, s)
    currentIndex.value = to
    clearSelection()
  }
  /** 把页从 from 移动到 to（拖拽排序用） */
  function reorderSlide(from: number, to: number) {
    if (from === to) return
    if (from < 0 || from >= deck.value.slides.length) return
    const to2 = Math.max(0, Math.min(deck.value.slides.length - 1, to))
    if (from === to2) return
    pushHistory()
    const [s] = deck.value.slides.splice(from, 1)
    deck.value.slides.splice(to2, 0, s)
    currentIndex.value = to2
    clearSelection()
  }

  // ---- 元素增删 ----
  function addElement(type: ElementType, overrides: Partial<SlideElement> = {}) {
    if (!currentSlide.value) return
    pushHistory()
    const n = currentSlide.value.elements.length
    const offset = (n % 5) * 32
    const el = createElement(type, { x: 260 + offset, y: 240 + offset })
    Object.assign(el, overrides)
    currentSlide.value.elements.push(el)
    selectedIds.value = [el.id]
  }
  function updateElement(id: string, patch: Partial<SlideElement>) {
    const el = currentSlide.value?.elements.find((e) => e.id === id)
    if (el) Object.assign(el, patch)
  }
  /** 就地切换图形类型（保留位置/尺寸）：shape ⇄ line ⇄ arrow ⇄ mathfig(kind) */
  function switchGraphic(el: SlideElement, target: string) {
    const cat = GRAPHIC_TYPES.find((g) => g.v === target)?.cat
    if (!cat) return
    const a = el as any
    const patch: any = { type: cat, shape: undefined, kind: undefined, points: undefined }
    if (cat === 'shape') {
      patch.shape = target; patch.fill = a.fill ?? '#534AB7'; patch.stroke = 'transparent'; patch.strokeWidth = 0
    } else if (cat === 'line' || cat === 'arrow') {
      patch.stroke = a.stroke || '#1a1a1a'; patch.strokeWidth = a.strokeWidth || 3; patch.rot = 0
    } else {
      patch.kind = target; patch.fill = a.fill ?? 'transparent'; patch.stroke = a.stroke || '#1a1a1a'; patch.strokeWidth = a.strokeWidth || 3
      if (target === 'bezier' || target === 'polygon') patch.points = a.points
    }
    updateElement(el.id, patch as Partial<SlideElement>)
  }
  /** 一键把当前页所有元素标记为「逐条出现」（演示渐显）/ 取消 */
  function setAllFragments(f: boolean) {
    const slide = currentSlide.value
    if (!slide || !slide.elements.length) return
    pushHistory()
    slide.elements.forEach((el, i) => {
      if (f) { el.fragment = true; el.fragmentIndex = i }
      else { el.fragment = false; el.fragmentIndex = undefined }
    })
  }
  /** 拖拽/缩放结束：一次性提交多个元素的矩形 */
  function commitElements(changes: { id: string; rect: Rect }[]) {
    if (!currentSlide.value || !changes.length) return
    pushHistory()
    for (const c of changes) updateElement(c.id, c.rect)
  }
  function removeSelected() {
    if (!currentSlide.value || !selectedIds.value.length) return
    pushHistory()
    const drop = new Set(selectedIds.value)
    currentSlide.value.elements = currentSlide.value.elements.filter((e) => !drop.has(e.id))
    clearSelection()
  }
  /** 按 id 删除单个元素（「把混排拆成多条公式」等场景：先建新元素，再丢掉原元素） */
  function removeElement(id: string) {
    if (!currentSlide.value) return
    const i = currentSlide.value.elements.findIndex((e) => e.id === id)
    if (i < 0) return
    pushHistory()
    currentSlide.value.elements.splice(i, 1)
    if (selectedIds.value.includes(id)) selectedIds.value = selectedIds.value.filter((x) => x !== id)
  }

  // ---- 元素复制 / 剪切 / 粘贴 ----
  const clipboard = ref<SlideElement[]>([])
  const canPaste = computed(() => clipboard.value.length > 0)
  function cloneEl(e: SlideElement): SlideElement {
    return { ...e, id: 'el_' + Math.random().toString(36).slice(2, 10) }
  }
  function copyElements() {
    if (!currentSlide.value) return
    const ids = new Set(selectedIds.value)
    clipboard.value = currentSlide.value.elements.filter((e) => ids.has(e.id)).map(cloneEl)
  }
  function cutElements() {
    if (!currentSlide.value || !selectedIds.value.length) return
    copyElements()
    removeSelected()
  }
  function pasteElements() {
    if (!currentSlide.value || !clipboard.value.length) return
    pushHistory()
    const els = clipboard.value.map(cloneEl)
    els.forEach((e, i) => { e.x += 24 + (i % 3) * 8; e.y += 24 + (i % 3) * 8 })
    currentSlide.value.elements.push(...els)
    selectedIds.value = els.map((e) => e.id)
  }

  function setSlideBg(color: string) {
    if (!currentSlide.value) return
    pushHistory()
    currentSlide.value.bg = color
  }
  /** 演讲者备注 */
  function setSlideNotes(v: string) {
    if (!currentSlide.value) return
    currentSlide.value.notes = v
  }
  /** 页面背景渐变（传 undefined 清除） */
  function setSlideBgGradient(g?: Slide['bgGradient']) {
    if (!currentSlide.value) return
    pushHistory()
    if (g) currentSlide.value.bgGradient = g
    else delete currentSlide.value.bgGradient
  }
  /** 页面背景图（传空字符串或 undefined 清除） */
  function setSlideBgImage(url?: string) {
    if (!currentSlide.value) return
    pushHistory()
    if (url) currentSlide.value.bgImage = url
    else delete currentSlide.value.bgImage
  }
  /** 页面过渡动画（传空字符串用文稿默认） */
  function setSlideTransition(t?: string) {
    if (!currentSlide.value) return
    pushHistory()
    if (t) currentSlide.value.transition = t
    else delete currentSlide.value.transition
  }

  /** 应用模板：用模板生成的一组元素替换当前页，并套用模板内容 */
  function applyTemplate(templateId: string) {
    if (!currentSlide.value) return
    const tpl = findTemplate(templateId) || findMathAppletTemplate(templateId) || findProTemplate(templateId)
    if (!tpl) return
    pushHistory()
    try { saveVersion('模板替换前') } catch { /* 忽略 */ }
    currentSlide.value.elements = tpl.build().flat() as SlideElement[]
    currentSlide.value.bg = '#ffffff'
    clearSelection()
  }

  /** 应用整套讲座：替换整个 deck 为模板里的多张幻灯片 */
  function applyBundle(bundleId: string) {
    const b = findBundle(bundleId) || findProBundle(bundleId)
    if (!b) return
    pushHistory()
    try { saveVersion('整套替换前') } catch { /* 忽略 */ }
    deck.value.title = b.name
    deck.value.slides = b.slides.map((s) => ({
      ...emptySlide(),
      ...s,
      id: 'sl_' + Math.random().toString(36).slice(2, 10),
      elements: s.elements.map((e) => ({ ...e, id: 'el_' + Math.random().toString(36).slice(2, 10) })) as typeof s.elements,
    }))
    currentIndex.value = 0
    clearSelection()
  }

  // ---- 组合 ----
  function groupSelection() {
    const els = selectedElements.value
    if (els.length < 2) return
    pushHistory()
    const gid = uid('group')
    for (const e of els) e.groupId = gid
  }
  function ungroup() {
    const els = selectedElements.value
    if (!els.length) return
    pushHistory()
    for (const e of els) delete e.groupId
    editingGroupId.value = null   // 组合已解散，组内编辑态同步失效
  }

  /** 把选中的元素按组合聚合成对齐/分布的最小单位 */
  function units(): Unit[] {
    const els = selectedElements.value
    const map = new Map<string, SlideElement[]>()
    for (const e of els) {
      const key = e.groupId ? `g:${e.groupId}` : `e:${e.id}`
      const arr = map.get(key)
      if (arr) arr.push(e)
      else map.set(key, [e])
    }
    const out: Unit[] = []
    for (const [key, groupEls] of map) {
      const b = union(groupEls.map((e) => ({ x: e.x, y: e.y, w: e.w, h: e.h })))
      if (b) out.push({ key, els: groupEls, bounds: b })
    }
    return out
  }

  // ---- 对齐 ----
  function alignSelection(mode: AlignMode) {
    const us = units()
    if (!us.length) return
    pushHistory()
    // 只有一个单位时，相对整页对齐
    const ref: Rect = us.length === 1
      ? { x: 0, y: 0, w: deck.value.width, h: deck.value.height }
      : union(us.map((u) => u.bounds))!

    for (const u of us) {
      let dx = 0, dy = 0
      switch (mode) {
        case 'left':    dx = ref.x - u.bounds.x; break
        case 'hcenter': dx = ref.x + (ref.w - u.bounds.w) / 2 - u.bounds.x; break
        case 'right':   dx = ref.x + ref.w - u.bounds.w - u.bounds.x; break
        case 'top':     dy = ref.y - u.bounds.y; break
        case 'vcenter': dy = ref.y + (ref.h - u.bounds.h) / 2 - u.bounds.y; break
        case 'bottom':  dy = ref.y + ref.h - u.bounds.h - u.bounds.y; break
      }
      for (const el of u.els) { el.x += dx; el.y += dy }
    }
  }

  // ---- 分布 ----
  function distributeSelection(axis: DistributeAxis) {
    const us = units()
    if (us.length < 3) return
    pushHistory()
    const sorted = [...us].sort((a, b) =>
      axis === 'h' ? a.bounds.x - b.bounds.x : a.bounds.y - b.bounds.y,
    )
    const first = sorted[0].bounds
    const last = sorted[sorted.length - 1].bounds

    // 间距可能为负（元素互相重叠，例如先做了左对齐）。
    // 此时退化为「零间距依次排开」，避免算出负 gap 导致原地不动。
    if (axis === 'h') {
      const totalW = sorted.reduce((s, u) => s + u.bounds.w, 0)
      const gap = Math.max(0, (last.x + last.w - first.x - totalW) / (sorted.length - 1))
      let x = first.x
      for (const u of sorted) {
        const dx = x - u.bounds.x
        for (const el of u.els) el.x += dx
        x += u.bounds.w + gap
      }
    } else {
      const totalH = sorted.reduce((s, u) => s + u.bounds.h, 0)
      const gap = Math.max(0, (last.y + last.h - first.y - totalH) / (sorted.length - 1))
      let y = first.y
      for (const u of sorted) {
        const dy = y - u.bounds.y
        for (const el of u.els) el.y += dy
        y += u.bounds.h + gap
      }
    }
  }

  // ---- 图层顺序 ----
  function reorderZ(action: ZOrderAction) {
    const els = currentSlide.value?.elements
    if (!els || !selectedIds.value.length) return
    pushHistory()
    const picked = new Set(selectedIds.value)

    if (action === 'front' || action === 'back') {
      const stay = els.filter((e) => !picked.has(e.id))
      const move = els.filter((e) => picked.has(e.id))
      currentSlide.value!.elements = action === 'front' ? [...stay, ...move] : [...move, ...stay]
      return
    }
    // 逐格移动：前移/后移一位，遇到已选元素则跳过（保持相对顺序）
    const arr = [...els]
    if (action === 'forward') {
      for (let i = arr.length - 2; i >= 0; i--) {
        if (picked.has(arr[i].id) && !picked.has(arr[i + 1].id)) {
          ;[arr[i], arr[i + 1]] = [arr[i + 1], arr[i]]
        }
      }
    } else {
      for (let i = 1; i < arr.length; i++) {
        if (picked.has(arr[i].id) && !picked.has(arr[i - 1].id)) {
          ;[arr[i], arr[i - 1]] = [arr[i - 1], arr[i]]
        }
      }
    }
    currentSlide.value!.elements = arr
  }

  /** 把元素移到指定图层位置（0 = 最底层，length-1 = 最顶层） */
  function setElementIndex(id: string, index: number) {
    const els = currentSlide.value?.elements
    if (!els) return
    const from = els.findIndex((e) => e.id === id)
    if (from < 0) return
    const to = Math.max(0, Math.min(els.length - 1, Math.round(index)))
    if (to === from) return
    pushHistory()
    const [item] = els.splice(from, 1)
    els.splice(to, 0, item)
  }

  // ---- 自动保存 + 自动快照（防误操作）----
  let saveTimer: number | undefined
  let lastSnapAt = 0
  watch(deck, () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(deck.value)) } catch { /* 忽略 */ }
      // 每 3 分钟自动存一个版本快照：误操作（整套替换/模板覆盖）后可到「版本」里回退
      const now = Date.now()
      if (now - lastSnapAt > 3 * 60 * 1000) {
        lastSnapAt = now
        try { saveVersion('自动快照 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false })) } catch { /* 忽略 */ }
      }
    }, 600) as unknown as number
  }, { deep: true })

  /** 立即保存到 localStorage（自动保存之外的手动保存） */
  function saveNow() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(deck.value)); return true } catch { return false }
  }

  function resetDeck() {
    pushHistory()
    deck.value = initialDeck()
    currentIndex.value = 0
    clearSelection()
  }

  /**
   * 把整份课件的**样式**对齐到设计主题（templates/pptTheme.ts 的 tokens）✓。
   *
   * ⚠ 与 applyTheme 的区别 ✗：applyTheme 只改页面背景 ✓；
   *   本动作还会把字号吸附到 TypeScale 档位 ✓、字体换主题字体 ✓、
   *   文字颜色**保色相**地夹到可读区间 ✓ —— 但**绝不碰内容** ✓。
   *   ⚠ pushHistory 必须在改动**之前** ✗（否则撤销不回来 ✓）。
   */
  /**
   * 按内容套用模板 ✓：**能识别的页套用版式 ✓，认不出/装不下的页保留原样 ✓**（用户口径 ✓）。
   * 只换 elements ✓（背景/备注不动 ✓）；pushHistory 在改动**之前** ✗（否则撤销不回来 ✓）。
   */
  function applyAutoTemplate(opts: { skip?: number[] } = {}): AutoApplyResult {
    if (!requireAddon('auto-template')) return { applied: 0, kept: deck.value.slides.length, report: [] }
    pushHistory()
    return autoTemplateDeck(deck.value, undefined, opts)
  }

  function applyHouseStyle(themeId?: string, mode: 'soft' | 'strong' = 'soft') {
    if (!requireAddon('house-style')) return { theme: getTheme(deck.value.theme || 'edumath'), changed: 0, slides: 0, mode: 'soft' }
    pushHistory()
    return restyleDeck(deck.value, themeId, mode)
  }

  /** 应用主题：切换整套配色（背景 / 强调 / 文字），应用于全部页面 */
  function applyTheme(id: string) {
    const th = findTheme(id)
    if (!th) return
    pushHistory()
    deck.value.theme = id
    for (const s of deck.value.slides) s.bg = th.bg
  }

  /** 更新文稿级元信息（标题/描述/主题/字体/过渡/速度） */
  function updateDeckMeta(patch: Partial<Deck>) { Object.assign(deck.value, patch) }

  function setDrawTool(t: 'line' | 'arrow' | 'pen' | 'poly' | null) { drawTool.value = t }
  function clearDrawTool() { drawTool.value = null }

  return {
    deck, currentIndex, selectedIds,
    currentSlide, slideCount,
    selectedElements, selectedElement, selectionCount, selectionBounds,
    canUndo, canRedo,
    isSelected, selectElement, setSelection, clearSelection, pruneSelection,
    editingGroupId, enterGroup, exitGroup,
    slideClip, copySlideToClip, cutSlideToClip, pasteSlideAt, toggleSlideHidden, resetSlide, applyLayoutToSlide,
    addSlide, addSubpageAfterCurrent, addPageWithTemplate, addBundlePages, applyBlank, addBlankPage, removeSlide, setSlideSubpage, gotoSlide, insertSlides, replaceDeck, importDeck, copySlide, moveSlide, reorderSlide,
    versions, saveVersion, restoreVersion, deleteVersion,
    addElement, updateElement, switchGraphic, commitElements, setAllFragments, removeSelected, removeElement, copyElements, cutElements, pasteElements, canPaste, setSlideBg, setSlideBgGradient, setSlideBgImage, setSlideTransition, setSlideNotes, applyTemplate, applyBundle,
    groupSelection, ungroup,
    alignSelection, distributeSelection, reorderZ, setElementIndex,
    resetDeck, undo, redo, pushHistory, saveNow,
    drawTool, setDrawTool, clearDrawTool, updateDeckMeta,
    applyTheme,
    applyHouseStyle,
    applyAutoTemplate,
  }
})
