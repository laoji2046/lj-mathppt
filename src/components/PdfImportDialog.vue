<script setup lang="ts">
/** PDF 导入：先探一遍（有没有文本层、多少插图），再让用户选模式与页码范围，然后导入。
 *
 *  两种模式的取舍是实打实的：文本模式出**可编辑**文字，但 PDF 里没有公式结构，
 *  公式会残（分式/根号/上下标散掉甚至整块丢），扫描件更是一个字都提不出来；
 *  图片模式**什么都能用、什么都保真**，代价是不可编辑。所以探测完把数据摆出来让人自己选。 */
import { computed, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { useDeckStore } from '@/stores/deck'
import { markdownToDeck } from '@/composables/mdDeck'
import { formatBytes, pdfToDeck, pdfToMarkdown, probePdf, type PdfProbe } from '@/pdf/pdfImport'

const props = defineProps<{ file: File }>()
const emit = defineEmits<{ close: []; done: [msg: string] }>()
const store = useDeckStore()

const busy = ref('')
const err = ref('')
const probe = ref<PdfProbe | null>(null)
const mode = ref<'text' | 'image'>('image')
const autoMode = ref<'text' | 'image'>('image')
const from = ref(1)
const to = ref(1)
const progress = ref(0)

const textRatio = computed(() => {
  const p = probe.value
  if (!p) return '0/0'
  return p.textPages + '/' + p.pages
})
const isScan = computed(() => !!probe.value && probe.value.textPages === 0)
/** 图片模式一页一张图，大文档要拦一下 */
const imageHeavy = computed(() => mode.value === 'image' && (to.value - from.value + 1) > 12)

onMounted(async () => {
  try {
    busy.value = '正在读取 PDF…'
    const data = new Uint8Array(await props.file.arrayBuffer())
    busy.value = '正在探测页数与文本层…'
    const p = await probePdf(data)
    probe.value = p
    autoMode.value = p.mode
    mode.value = p.mode
    from.value = 1
    // 图片模式一页就是一张位图，先只给前 20 页 —— 一次几十页会把演示撑到几十 MB，
    // 而演示是自动存浏览器本地的（配额只有几 MB，超了是静默存不上）
    to.value = p.mode === 'image' ? Math.min(p.pages, 20) : p.pages
    busy.value = ''
  } catch (e) {
    err.value = (e as Error)?.message || String(e)
    busy.value = ''
  }
})

async function run() {
  if (!probe.value) return
  err.value = ''
  busy.value = '正在导入…'
  progress.value = 0
  const onProgress = (done: number, total: number) => { progress.value = total ? done / total : 0 }
  try {
    const data = new Uint8Array(await props.file.arrayBuffer())
    if (mode.value === 'text') {
      const { markdown, stats } = await pdfToMarkdown(data, { from: from.value, to: to.value, onProgress })
      const deck = markdownToDeck(markdown)
      if (!deck.slides.length) throw new Error('这几十页里没抽出文字（可能是扫描件）—— 换成「每页一张图」试试')
      if (!store.importDeck(deck)) throw new Error('生成的演示无效（已取消，未影响当前内容）')
      const warn = stats.skippedImages
        ? ' · 注意：这 ' + stats.skippedImages + ' 张插图没带过来（文本模式只搬字），要图请用「每页一张图」'
        : ''
      emit('done', 'PDF 导入完成：' + deck.slides.length + ' 页 · 约 ' + stats.questions + ' 道题 · ' + stats.chars + ' 字' + warn)
    } else {
      const { deck, stats } = await pdfToDeck(data, { from: from.value, to: to.value, onProgress })
      if (!store.importDeck(deck)) throw new Error('生成的演示无效（已取消，未影响当前内容）')
      emit('done', 'PDF 导入完成：' + stats.pages + ' 页（每页一张图）· 约 ' + formatBytes(stats.bytes) +
        (stats.scanned ? ' · 其中 ' + stats.scanned + ' 页是扫描件，已按 JPEG 压过' : ''))
    }
    emit('close')
  } catch (e) {
    err.value = (e as Error)?.message || String(e)
    busy.value = ''
  }
}
</script>

<template>
  <div class="pd" @mousedown.self="emit('close')">
    <div class="pd__box">
      <header class="pd__head">
        <div class="pd__title"><span class="pd__badge">PDF</span> 导入 PDF</div>
        <button class="pd__close" @click="emit('close')"><AppIcon name="close" :size="13" /></button>
      </header>

      <div class="pd__body">
        <div class="pd__file">{{ props.file.name }} · {{ formatBytes(props.file.size) }}</div>

        <div v-if="err" class="pd__err">{{ err }}</div>
        <div v-else-if="busy" class="pd__busy">{{ busy }}</div>

        <template v-else-if="probe">
          <div class="pd__stat">
            共 <b>{{ probe.pages }}</b> 页 · 页面 {{ Math.round(probe.pageW) }}×{{ Math.round(probe.pageH) }} ·
            有文本层的页 <b :class="{ 'pd__warn': isScan }">{{ textRatio }}</b>
          </div>
          <p class="pd__diag">
            {{ isScan
              ? '这份是扫描件（整页都是图片，抽不出文字）—— 只能用「每页一张图」。'
              : probe.mode === 'text'
                ? '这份有文本层，默认用「抽取文字」；公式会残、插图不会带过来。'
                : '首页文字很少，看着像扫描件，默认用「每页一张图」。' }}
          </p>

          <div class="pd__label">导入方式</div>
          <label class="pd__opt" :class="{ 'pd__opt--on': mode === 'text' }">
            <input type="radio" value="text" v-model="mode" :disabled="isScan">
            <span>
              <b>抽取文字（可编辑）</b>
              <em>正文、标题、题号都变成可以改的文本；公式会残、插图不带过来{{ isScan ? ' · 这份没有文本层，不可用' : '' }}</em>
            </span>
          </label>
          <label class="pd__opt" :class="{ 'pd__opt--on': mode === 'image' }">
            <input type="radio" value="image" v-model="mode">
            <span>
              <b>每页一张图（保真）</b>
              <em>一页一张幻灯片，公式图形和原件一模一样；不能编辑{{ autoMode !== 'image' ? ' · 这份有文本层，选它就不出可编辑文字了' : '' }}</em>
            </span>
          </label>

          <div class="pd__label">页码范围</div>
          <div class="pd__row">
            <input class="pd__num" type="number" min="1" :max="probe.pages" v-model.number="from">
            <span class="pd__dash">–</span>
            <input class="pd__num" type="number" min="1" :max="probe.pages" v-model.number="to">
            <span class="pd__hint">共 {{ probe.pages }} 页，1 页 = 1 张幻灯片</span>
          </div>
          <p v-if="imageHeavy" class="pd__warnline">
            一次导入 {{ to - from + 1 }} 页图片，演示会比较大（估计 {{ formatBytes((to - from + 1) * 250 * 1024) }} 上下）。
            演示是自动存浏览器本地的、配额只有几 MB，**超了会静默存不上**；建议分批导入，
            或导入后用「文件 → 另存为」存成 JSON 文件。
          </p>
        </template>
      </div>

      <footer class="pd__foot">
        <div v-if="busy && progress > 0" class="pd__bar"><span :style="{ width: Math.round(progress * 100) + '%' }"></span></div>
        <button class="pd__btn" @click="emit('close')">取消</button>
        <button class="pd__btn pd__btn--primary" :disabled="!probe || !!busy || from < 1 || to < from || to > probe.pages" @click="run">
          导入
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.pd { position: fixed; inset: 0; z-index: 500; background: rgba(20, 24, 34, 0.55); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; }
.pd__box { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: 92vw; max-width: 620px; max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; }
.pd__head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--border); }
.pd__title { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: var(--text); }
.pd__badge { display: inline-flex; align-items: center; justify-content: center; height: 20px; padding: 0 6px; border-radius: var(--radius-sm); background: var(--danger-soft); color: var(--danger); font-size: 11px; font-weight: 700; }
.pd__close { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; cursor: pointer; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--gray-600); }
.pd__close:hover { background: var(--danger-soft); border-color: var(--danger-border); color: var(--danger); }
.pd__body { padding: 14px; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.pd__file { font-size: 12px; color: var(--muted); word-break: break-all; }
.pd__stat { font-size: 13px; color: var(--muted); }
.pd__stat b { color: var(--text); }
.pd__warn { color: #c77700; }
.pd__diag { margin: 0; font-size: 12px; line-height: 1.6; color: var(--gray-600); background: var(--panel-2, #fafafd); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 7px 9px; }
.pd__label { font-size: 12px; color: var(--muted); margin-top: 4px; }
.pd__opt { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); cursor: pointer; }
.pd__opt--on { background: var(--brand-soft); border-color: var(--brand-400); }
.pd__opt input { margin-top: 3px; }
.pd__opt b { display: block; font-size: 13px; color: var(--text); }
.pd__opt em { display: block; font-style: normal; font-size: 12px; color: var(--gray-500); line-height: 1.55; margin-top: 2px; }
.pd__row { display: flex; align-items: center; gap: 8px; }
.pd__num { width: 84px; padding: 5px 8px; font-size: 13px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: #fff; color: var(--text); }
.pd__dash { color: var(--muted); }
.pd__hint { font-size: 12px; color: var(--muted); }
.pd__warnline { margin: 0; font-size: 12px; line-height: 1.6; color: #a06000; background: #fff8e8; border: 1px solid #efd9a8; border-radius: var(--radius-sm); padding: 7px 9px; }
.pd__err { font-size: 13px; color: var(--danger); background: var(--danger-soft); border: 1px solid var(--danger-border); border-radius: var(--radius-sm); padding: 8px 10px; line-height: 1.5; }
.pd__busy { font-size: 13px; color: var(--muted); }
.pd__foot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--border); background: var(--panel-2, #fafafd); }
.pd__bar { flex: 1; height: 6px; border-radius: 3px; background: var(--border); overflow: hidden; margin-right: 6px; }
.pd__bar span { display: block; height: 100%; background: var(--brand-600); transition: width 0.15s linear; }
.pd__btn { padding: 6px 14px; font-size: 13px; cursor: pointer; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--gray-700); }
.pd__btn:hover:not(:disabled) { background: var(--brand-soft); border-color: var(--brand-400); color: var(--brand-800); }
.pd__btn:disabled { opacity: 0.45; cursor: not-allowed; }
.pd__btn--primary { background: var(--brand-600); border-color: var(--brand-600); color: #fff; font-weight: 600; }
</style>
