<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, onMounted, nextTick } from 'vue';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const props = defineProps<{
  file: File | null;
  /** MinerU 的 page_idx，从 0 开始 */
  page: number;
  /** MinerU content_list.json 的 bbox：归一化到 1000×1000 的坐标 */
  bbox: number[] | null;
}>();

const scrollRef = ref<HTMLElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const imgRef = ref<HTMLImageElement | null>(null);
const imgUrl = ref('');
const loading = ref(false);
const errMsg = ref('');
const zoom = ref(1);
const renderedPage = ref(-1);
const pageCount = ref(0);

/** 可视宽度（减去内边距），所有尺寸都从这里推导 */
const baseWidth = ref(640);
/** 实际渲染宽度 = 可视宽度 × 缩放 */
const mediaWidth = computed(() => Math.round(baseWidth.value * zoom.value));

const isImage = computed(() => !!props.file && props.file.type.startsWith('image/'));

/**
 * bbox 归一化到 1000×1000，所以直接换算成百分比即可。
 * 前提：叠加层与画面元素同尺寸同原点 —— 靠下面把 canvas 的 CSS 宽度
 * 显式设成 viewport 宽度来保证，否则 .stage 会被 canvas 的固有尺寸撑大。
 */
const boxStyle = computed(() => {
  const b = props.bbox;
  if (!b || b.length !== 4) return null;
  return {
    left: `${b[0] / 10}%`,
    top: `${b[1] / 10}%`,
    width: `${(b[2] - b[0]) / 10}%`,
    height: `${(b[3] - b[1]) / 10}%`,
  };
});

let pdfDoc: any = null;
let pdfDocFor: File | null = null;
let ro: ResizeObserver | null = null;

function measure() {
  const el = scrollRef.value;
  if (!el) return;
  const w = el.clientWidth - 32; // 左右各 16px 内边距
  if (w > 60 && Math.abs(w - baseWidth.value) > 1) {
    baseWidth.value = w;
    renderedPage.value = -1; // 宽度变了必须重绘
  }
}

async function renderPdf() {
  if (!props.file || isImage.value) return;
  const target = Math.min(props.page + 1, Math.max(1, pageCount.value || 1));
  if (renderedPage.value === target && canvasRef.value?.width) return;

  loading.value = true;
  errMsg.value = '';
  try {
    if (!pdfDoc || pdfDocFor !== props.file) {
      const data = new Uint8Array(await props.file.arrayBuffer());
      pdfDoc = await pdfjsLib.getDocument({ data }).promise;
      pdfDocFor = props.file;
      pageCount.value = pdfDoc.numPages;
    }
    const pageNum = Math.min(props.page + 1, pdfDoc.numPages);
    const page = await pdfDoc.getPage(pageNum);
    await nextTick();

    measure();
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: mediaWidth.value / base.width });

    const canvas = canvasRef.value!;
    const w = Math.floor(viewport.width);
    const h = Math.floor(viewport.height);
    canvas.width = w;
    canvas.height = h;
    // 关键：显式设定 CSS 尺寸，让 .stage 恰好等于画布大小
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    // pdfjs v6 的渲染参数用 canvas，不再是 canvasContext
    await page.render({ canvas, viewport }).promise;
    renderedPage.value = pageNum;
  } catch (e: any) {
    errMsg.value = e?.message ? String(e.message) : String(e);
  } finally {
    loading.value = false;
  }
}

function setupImage() {
  if (imgUrl.value) URL.revokeObjectURL(imgUrl.value);
  imgUrl.value = props.file && isImage.value ? URL.createObjectURL(props.file) : '';
  pdfDoc = null;
  pdfDocFor = null;
  renderedPage.value = -1;
  pageCount.value = 0;
}

watch(() => props.file, () => { setupImage(); measure(); renderPdf(); }, { immediate: true });
watch(() => props.page, renderPdf);
watch(zoom, () => { renderedPage.value = -1; renderPdf(); });

onMounted(() => {
  measure();
  if (scrollRef.value) {
    ro = new ResizeObserver(() => { measure(); renderPdf(); });
    ro.observe(scrollRef.value);
  }
  renderPdf();
});

onBeforeUnmount(() => {
  ro?.disconnect();
  if (imgUrl.value) URL.revokeObjectURL(imgUrl.value);
  pdfDoc?.destroy?.();
});
</script>

<template>
  <div class="viewer">
    <div class="bar">
      <span class="label">原图</span>
      <span v-if="pageCount > 1" class="page mono">{{ page + 1 }} / {{ pageCount }}</span>
      <div class="spacer" />
      <button :disabled="zoom <= 0.5" title="缩小" @click="zoom = Math.max(0.5, zoom - 0.25)">−</button>
      <span class="zoom mono">{{ Math.round(zoom * 100) }}%</span>
      <button :disabled="zoom >= 3" title="放大" @click="zoom = Math.min(3, zoom + 0.25)">＋</button>
    </div>

    <div class="scroll" ref="scrollRef">
      <div v-if="!file" class="empty">未加载文件</div>
      <div v-else-if="errMsg" class="empty err">{{ errMsg }}</div>
      <div v-else class="stage">
        <img v-if="isImage" ref="imgRef" :src="imgUrl" :style="{ width: mediaWidth + 'px' }" alt="试卷原图" />
        <canvas v-else ref="canvasRef" />
        <div v-if="boxStyle" class="box" :style="boxStyle" />
      </div>
      <div v-if="loading" class="loading">渲染中…</div>
    </div>
  </div>
</template>

<style scoped>
.viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: #ecebe7;
}
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  flex: none;
}
.label { font-size: 12px; color: var(--text-2); }
.page { font-size: 12px; color: var(--text-3); }
.spacer { flex: 1; }
.zoom { font-size: 12px; color: var(--text-2); min-width: 42px; text-align: center; }
.bar button { padding: 2px 9px; line-height: 1.3; }

.scroll {
  flex: 1;
  overflow: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
/* 收缩包裹住画面元素，叠加层才能和它精确对齐 */
.stage {
  position: relative;
  display: inline-block;
  flex: none;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, .1);
  line-height: 0;
}
.stage img,
.stage canvas { display: block; }

.box {
  position: absolute;
  border: 2px solid var(--accent);
  background: rgba(24, 95, 165, .13);
  border-radius: 3px;
  pointer-events: none;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, .6) inset;
  transition: all .15s ease;
}

.empty {
  color: var(--text-3);
  font-size: 13px;
  padding: 40px;
}
.empty.err { color: var(--danger); max-width: 420px; word-break: break-all; }
.loading {
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-2);
}
</style>
