<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { createMineruClient, type ParseStage, type ProgressInfo } from './core/mineruClient';
import { parseExam, summarize } from './core/examParser';
import { TYPE_LABEL, type LooseBlock, type ParsedExam, type Question } from './core/types';
import UploadPanel from './components/UploadPanel.vue';
import SourceViewer from './components/SourceViewer.vue';
import QuestionForm from './components/QuestionForm.vue';
import LooseBlockView from './components/LooseBlockView.vue';

const PROXY_KEY = 'mineru.proxy';

const proxy = ref(localStorage.getItem(PROXY_KEY) || 'http://127.0.0.1:8787');
watch(proxy, (v) => localStorage.setItem(PROXY_KEY, v));

const file = ref<File | null>(null);
const exam = ref<ParsedExam | null>(null);
const activeId = ref('');
const busy = ref(false);
const stage = ref<ParseStage | null>(null);
const info = ref<ProgressInfo | null>(null);
const error = ref('');
const markdown = ref('');

/** MinerU 图片路径 -> blob URL。MinerU 已经把图形裁好了，直接显示即可 */
const images = ref<Record<string, string>>({});
/** 当前选中的游离块下标；非 null 时右栏显示游离块而不是题目 */
const looseIndex = ref<number | null>(null);

const stats = computed(() => (exam.value ? summarize(exam.value) : null));

const flat = computed<Question[]>(() => stats.value?.all ?? []);

const active = computed<Question | null>(
  () => flat.value.find((q) => q.id === activeId.value) ?? null,
);

const activeIndex = computed(() => flat.value.findIndex((q) => q.id === activeId.value));

const sectionOfActive = computed(() => {
  if (!exam.value) return '';
  for (const s of exam.value.sections) {
    if (s.questions.some((q) => q.id === activeId.value)) return s.title;
  }
  return '';
});

const activeLoose = computed<LooseBlock | null>(() =>
  looseIndex.value !== null ? exam.value?.looseBlocks[looseIndex.value] ?? null : null,
);

/** 原图要展示的区域：游离块优先，其次是当前题目 */
const viewerPage = computed(() => activeLoose.value?.page ?? active.value?.page ?? 0);
const viewerBbox = computed(() => activeLoose.value?.bbox ?? active.value?.bbox ?? null);

const crumbTitle = computed(() =>
  activeLoose.value ? `游离块 ${(looseIndex.value ?? 0) + 1}` : sectionOfActive.value,
);

const crumbPos = computed(() =>
  activeLoose.value ? `${exam.value?.looseBlocks.length ?? 0} 个` : `${activeIndex.value + 1} / ${flat.value.length}`,
);

const LOOSE_LABEL: Record<LooseBlock['type'], string> = {
  text: '文本',
  table: '表格',
  image: '图片',
};

/** 悬浮提示：让用户在点开之前就知道这块是什么 */
function looseHint(b: LooseBlock) {
  if (b.type === 'text') return b.text.slice(0, 60) || '空文本块';
  if (b.tableBody) return '表格';
  return b.imgPath ?? '图片';
}

function selectQuestion(id: string) {
  activeId.value = id;
  looseIndex.value = null;
}

function selectLoose(i: number) {
  looseIndex.value = i;
}

/** 把 MinerU 返回的图片 Blob 转成可显示的 URL，旧的要释放掉避免泄漏 */
function setImages(blobs: Record<string, Blob>) {
  Object.values(images.value).forEach((u) => URL.revokeObjectURL(u));
  const next: Record<string, string> = {};
  for (const [k, b] of Object.entries(blobs)) next[k] = URL.createObjectURL(b);
  images.value = next;
}

async function handleFile(f: File) {
  file.value = f;
  exam.value = null;
  error.value = '';
  busy.value = true;
  stage.value = 'submitting';
  info.value = null;

  try {
    const client = createMineruClient({ proxy: proxy.value });
    const result = await client.parse(f, {
      isOcr: true,
      onProgress: (s, i) => {
        stage.value = s;
        info.value = i ?? null;
      },
    });

    if (!result.contentList) {
      throw new Error('结果包里没有 content_list.json，无法切题');
    }
    markdown.value = result.markdown;
    setImages(result.images);

    const parsed = parseExam(result.contentList);
    if (!parsed.sections.length) {
      throw new Error('没有切出任何题目，请检查试卷版面是否被正确识别');
    }
    exam.value = parsed;
    activeId.value = parsed.sections[0].questions[0].id;
    looseIndex.value = null;
  } catch (e: any) {
    error.value = e?.message ? String(e.message) : String(e);
  } finally {
    busy.value = false;
    stage.value = null;
    info.value = null;
  }
}

function reset() {
  file.value = null;
  exam.value = null;
  error.value = '';
  markdown.value = '';
  activeId.value = '';
  looseIndex.value = null;
  setImages({});
}

function exportJson() {
  if (!exam.value) return;
  const payload = {
    ...exam.value,
    markdown: markdown.value,
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${exam.value.examTitle || '试卷'}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function go(delta: number) {
  // 从游离块回到题目时，activeIndex 是 -1，go(1) 正好落到第一题
  const i = activeIndex.value + delta;
  if (i >= 0 && i < flat.value.length) selectQuestion(flat.value[i].id);
}

function onKey(e: KeyboardEvent) {
  if (!exam.value) return;
  const el = e.target as HTMLElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
  if (e.key === 'j' || e.key === 'ArrowDown') { go(1); e.preventDefault(); }
  if (e.key === 'k' || e.key === 'ArrowUp') { go(-1); e.preventDefault(); }
}

window.addEventListener('keydown', onKey);
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  Object.values(images.value).forEach((u) => URL.revokeObjectURL(u));
});
</script>

<template>
  <UploadPanel
    v-if="!exam"
    :proxy="proxy"
    :busy="busy"
    :stage="stage"
    :info="info"
    :error="error"
    @update:proxy="proxy = $event"
    @file="handleFile"
  />

  <div v-else class="app">
    <header class="top">
      <div class="title">
        <strong>{{ exam.examTitle || '未命名试卷' }}</strong>
        <span class="meta mono">
          {{ stats!.total }} 题 · 待校对 {{ stats!.total - stats!.confirmed }}
          <template v-if="stats!.withWarnings"> · ⚠ {{ stats!.withWarnings }}</template>
        </span>
      </div>
      <div class="spacer" />
      <span class="hintkeys">J / K 或 ↑↓ 切换题目</span>
      <button @click="reset">重新导入</button>
      <button class="primary" @click="exportJson">导出 JSON</button>
    </header>

    <div class="body">
      <nav class="rail">
        <template v-for="sec in exam.sections" :key="sec.title">
          <div class="sec-title">{{ sec.title }}</div>
          <button
            v-for="q in sec.questions"
            :key="q.id"
            class="qitem"
            :class="{ active: q.id === activeId && looseIndex === null, warn: q.warnings.length, done: q.status === 'confirmed' }"
            @click="selectQuestion(q.id)"
          >
            <span class="qnum mono">{{ q.number }}</span>
            <span class="qtype">{{ TYPE_LABEL[q.type] }}</span>
            <span v-if="q.warnings.length" class="dot" title="有警告" />
            <span v-if="q.status === 'confirmed'" class="ok">✓</span>
          </button>
        </template>
        <template v-if="exam.looseBlocks.length">
          <div class="sec-title loose">游离块 {{ exam.looseBlocks.length }}</div>
          <button
            v-for="(b, i) in exam.looseBlocks"
            :key="'lb' + i"
            class="qitem loose-item"
            :class="{ active: looseIndex === i }"
            :title="looseHint(b)"
            @click="selectLoose(i)"
          >
            <span class="qnum mono">{{ i + 1 }}</span>
            <span class="qtype">{{ b.type === 'text' ? b.text.slice(0, 10) || '空文本' : LOOSE_LABEL[b.type] }}</span>
          </button>
        </template>
      </nav>

      <SourceViewer
        :file="file"
        :page="viewerPage"
        :bbox="viewerBbox"
      />

      <div class="right">
        <div class="crumb">
          <span class="sec">{{ crumbTitle }}</span>
          <span class="mono pos">{{ crumbPos }}</span>
        </div>
        <div class="form-scroll">
          <QuestionForm v-if="active && !activeLoose" :key="active.id" :question="active" :images="images" />
          <LooseBlockView v-else-if="activeLoose" :key="'lb' + looseIndex" :block="activeLoose" :images="images" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app { display: flex; flex-direction: column; height: 100%; }

.top {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  flex: none;
}
.title { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
.title strong { font-size: 15px; font-weight: 600; }
.meta { font-size: 12px; color: var(--text-2); }
.spacer { flex: 1; }
.hintkeys { font-size: 11.5px; color: var(--text-3); }

.body {
  flex: 1;
  display: grid;
  grid-template-columns: 196px minmax(0, 1fr) minmax(0, 1.05fr);
  min-height: 0;
}

.rail {
  background: var(--panel);
  border-right: 1px solid var(--border);
  overflow-y: auto;
  padding: 10px 8px 30px;
}
.sec-title {
  font-size: 11px;
  color: var(--text-3);
  padding: 10px 8px 5px;
  font-weight: 600;
}
.sec-title.loose { margin-top: 12px; border-top: 1px solid var(--border); }

.qitem {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  text-align: left;
  padding: 5px 9px;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 6px;
  font-size: 12.5px;
  color: var(--text-2);
  margin-bottom: 1px;
}
.qitem:hover { background: #f4f3f0; }
.qitem.active {
  background: var(--accent-bg);
  border-color: #cfe2f5;
  color: var(--accent);
  font-weight: 600;
}
.qitem.warn { color: var(--warn); }
.qitem.warn.active { color: var(--accent); }
.qnum { min-width: 20px; }
.qtype {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 游离块：非题目，用浅色区分，但依然可点 */
.loose-item .qtype { color: var(--text-3); }
.loose-item.active .qtype { color: var(--accent); }
.dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #e0a63c;
  flex: none;
}
.ok { color: var(--ok); font-size: 11px; }

.right {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--panel);
  border-left: 1px solid var(--border);
}
.crumb {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 16px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-2);
  flex: none;
}
.pos { color: var(--text-3); }
.form-scroll { flex: 1; overflow-y: auto; }
</style>
