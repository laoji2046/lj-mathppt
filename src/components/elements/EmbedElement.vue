<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import type { EmbedElement } from '@/types'

const props = defineProps<{ el: EmbedElement; selected?: boolean }>()

/** 内容始终 'none'：点/拖任意处都能选中并移动（iframe 才不会吞掉指针）；链接单独保持可点 */
const contentPE = 'none'

/** 本地图片用 data: URL（可持久化、跨刷新） */
const imageSrc = computed(() => {
  if (props.el.kind !== 'image') return ''
  if (props.el.dataBase64) return `data:${props.el.mime || 'image/png'};base64,${props.el.dataBase64}`
  return props.el.url
})

// ---- 网页(html)/外部链接 用 iframe ----
// 【v1438 修】内嵌 HTML 改走 **srcdoc**，不再用 blob:。
// 原因（实测）：blob: 文档里做 URL 解析会失败 ——
//   blob:http://tauri.localhost/<uuid> 作为 base，'/three/three.iife.js' 解析不出绝对地址
//   （控制台报 Failed to parse URL），于是 <script src="/three/..."> 根本不加载 ✗。
// srcdoc 文档继承父文档的 base/origin，相对路径照常解析 ✓（实测 typeof THREE === 'object'）。
const iframeSrc = ref('')
/** 内嵌 HTML 的正文（走 srcdoc；和 iframeSrc 二选一） */
const iframeSrcdoc = ref('')
/** 【3D 嵌入】这种 iframe 要"自己收拖拽"才能转场景 → 指针事件放开；
 *  其它嵌入仍是 none（点/拖任意处都能选中并移动元素 ✓）。
 *  ⚠ 不能把类型断言写进模板（Vue 模板表达式的解析器不认 `as` ✗）→ 放这算 ✓ */
const framePE = computed(() => ((props.el as unknown as { applet3d?: boolean }).applet3d ? 'auto' : contentPE))
let blobUrl = ''
function makeBlob() {
  if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = '' }
  iframeSrcdoc.value = ''
  if (props.el.kind === 'pdf' || props.el.kind === 'image') { iframeSrc.value = ''; return }
  if (props.el.dataBase64) {
    try {
      const bytes = atob(props.el.dataBase64)
      const arr = new Uint8Array(bytes.length)
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
      iframeSrcdoc.value = new TextDecoder('utf-8').decode(arr)
      iframeSrc.value = ''
    } catch { iframeSrc.value = props.el.url }
  } else {
    iframeSrc.value = props.el.url
  }
}
watchEffect(makeBlob)
onBeforeUnmount(() => { if (blobUrl) URL.revokeObjectURL(blobUrl) })

// ---- PDF 用 pdf.js 渲染到 canvas（不依赖浏览器内建 PDF 查看器，Edge 也不拦截） ----
const pdfHost = ref<HTMLElement | null>(null)
let pdfjsP: Promise<any> | null = null
function loadPdfJs(): Promise<any> {
  const w = window as any
  if (w.pdfjsLib) return Promise.resolve(w.pdfjsLib)
  if (pdfjsP) return pdfjsP
  pdfjsP = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    // ⚠ 绝对路径 ✗ —— Tauri 加载的是 `app/index.html` ✓
    //   相对路径会被解析成 `/app/pdfjs/...` ✓ **404** ✓（桌面版无法导入 PDF ✓）
    s.src = import.meta.env.BASE_URL + 'pdfjs/pdf.min.js'
    s.async = true
    s.onload = () => {
      const lib = w.pdfjsLib
      if (lib) { lib.GlobalWorkerOptions.workerSrc = import.meta.env.BASE_URL + 'pdfjs/pdf.worker.min.js'; resolve(lib) }
      else { pdfjsP = null; reject(new Error('pdf.js 加载失败')) }
    }
    s.onerror = () => { pdfjsP = null; reject(new Error('pdf.js 加载失败')) }
    document.head.appendChild(s)
  })
  return pdfjsP
}
let pdfBusy = false
let pdfPending = false
async function renderPdf() {
  await nextTick()   // 等 pdfHost 真正挂载（kind 切换到 pdf 时宿主是 v-else-if 才渲染）
  const host = pdfHost.value
  if (!host) return
  if (props.el.kind !== 'pdf' || !props.el.dataBase64) { host.innerHTML = ''; return }
  if (pdfBusy) { pdfPending = true; return }
  pdfBusy = true
  try {
    do {
      pdfPending = false
      const lib = await loadPdfJs()
      const bytes = atob(props.el.dataBase64)
      const arr = new Uint8Array(bytes.length)
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
      host.innerHTML = ''
      const doc = await lib.getDocument({ data: arr }).promise
      const W = host.clientWidth || 480
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p)
        const v1 = page.getViewport({ scale: 1 })
        const scale = Math.max(0.2, W / v1.width)
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.style.width = '100%'
        canvas.style.display = 'block'
        canvas.style.marginBottom = '8px'
        const ctx = canvas.getContext('2d')!
        await page.render({ canvasContext: ctx, viewport }).promise
        host.appendChild(canvas)
      }
      doc.destroy()
    } while (pdfPending)
  } catch (e) {
    if (pdfHost.value) pdfHost.value.innerHTML = '<div class="embed-el__msg">PDF 渲染失败：' + (e instanceof Error ? e.message : String(e)) + '</div>'
  } finally {
    pdfBusy = false
  }
}
watch(() => [props.el.kind, props.el.dataBase64, props.el.mime], () => renderPdf())
onMounted(() => renderPdf())
onBeforeUnmount(() => { if (blobUrl) URL.revokeObjectURL(blobUrl) })

const isDoc = computed(() => props.el.kind === 'doc')
</script>

<template>
  <div class="embed-el">
    <img
      v-if="el.kind === 'image' && imageSrc"
      :src="imageSrc"
      alt=""
      draggable="false"
      class="embed-el__img"
      :style="{ pointerEvents: contentPE }"
    />
    <div v-else-if="el.kind === 'pdf'" ref="pdfHost" class="embed-el__pdf" :style="{ pointerEvents: contentPE }"></div>
    <iframe
      v-else-if="iframeSrcdoc || iframeSrc"
      :src="iframeSrcdoc ? undefined : iframeSrc"
      :srcdoc="iframeSrcdoc || undefined"
      class="embed-el__frame"
      :style="{ pointerEvents: framePE }"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
      referrerpolicy="no-referrer"
    ></iframe>
    <div v-else-if="isDoc" class="embed-el__msg">
      该文档类型（{{ el.mime || el.kind }}）无法在内部预览，请用外部程序打开。
    </div>
    <div v-else class="embed-el__empty">
      未嵌入内容<br /><small>在右侧属性面板点「打开本地文件」，或填入 URL</small>
    </div>
    <a
      v-if="el.kind === 'url' && el.url"
      class="embed-el__link"
      :href="el.url"
      style="pointer-events:auto"
      target="_blank"
      rel="noopener"
      title="在新标签页打开链接"
    >
      ↗ <span class="embed-el__linkurl">{{ el.url }}</span>
    </a>
  </div>
</template>

<style scoped>
.embed-el { width: 100%; height: 100%; box-sizing: border-box; position: relative; }
.embed-el__link {
  position: absolute; left: 6px; bottom: 6px;
  max-width: calc(100% - 12px);
  font-size: 11px; color: #fff;
  background: rgba(20, 24, 34, 0.72); padding: 3px 8px; border-radius: 6px;
  text-decoration: none; display: inline-flex; gap: 5px; align-items: center;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  z-index: 2;
}
.embed-el__link:hover { background: rgba(20, 24, 34, 0.9); }
.embed-el__linkurl { overflow: hidden; text-overflow: ellipsis; }
.embed-el__img { width: 100%; height: 100%; object-fit: contain; display: block; }
.embed-el__frame { width: 100%; height: 100%; border: 1px solid var(--border); border-radius: 4px; display: block; }
.embed-el__pdf { width: 100%; height: 100%; overflow: auto; background: #f3f1ee; border: 1px solid var(--border); border-radius: 4px; }
.embed-el__msg, .embed-el__empty {
  width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; background: #f1efe8; color: #888780; font-size: 14px; line-height: 1.6;
}
.embed-el__msg { color: var(--muted); background: var(--panel-2); }
.embed-el__empty small { font-size: 12px; }
</style>
