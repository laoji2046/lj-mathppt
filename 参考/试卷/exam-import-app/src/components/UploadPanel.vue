<script setup lang="ts">
import { ref, computed } from 'vue';
import type { ParseStage, ProgressInfo } from '../core/mineruClient';

const props = defineProps<{
  proxy: string;
  busy: boolean;
  stage: ParseStage | null;
  info: ProgressInfo | null;
  error: string;
}>();

const emit = defineEmits<{
  (e: 'update:proxy', v: string): void;
  (e: 'file', f: File): void;
}>();

const dragging = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const STAGE_LABEL: Record<ParseStage, string> = {
  submitting: '提交任务',
  uploading: '上传文件',
  parsing: '等待解析',
  downloading: '下载结果',
  done: '完成',
};

const stageText = computed(() => {
  if (!props.stage) return '';
  let t = STAGE_LABEL[props.stage];
  const i = props.info;
  if (i?.state) t += ` · ${i.state}`;
  if (i?.progress?.total_pages) {
    t += ` · ${i.progress.extracted_pages ?? 0}/${i.progress.total_pages} 页`;
  }
  return t;
});

function pick() {
  fileInput.value?.click();
}

function onPicked(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) emit('file', f);
  (e.target as HTMLInputElement).value = '';
}

function onDrop(e: DragEvent) {
  dragging.value = false;
  const f = e.dataTransfer?.files?.[0];
  if (f) emit('file', f);
}
</script>

<template>
  <div class="wrap">
    <div class="card">
      <h1>高中数学试卷自动录入</h1>
      <p class="sub">
        支持拍照、扫描件、电子版 PDF / Word。整卷解析后逐题校对，公式用 KaTeX 渲染。
      </p>

      <div
        class="drop"
        :class="{ dragging, disabled: busy }"
        @click="!busy && pick()"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <div class="drop-icon">＋</div>
        <div class="drop-main">{{ busy ? '正在处理…' : '把试卷拖到这里，或点击选择文件' }}</div>
        <div class="drop-sub">PDF · JPG · PNG · DOCX</div>
        <input
          ref="fileInput"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.bmp,.doc,.docx"
          hidden
          @change="onPicked"
        />
      </div>

      <div v-if="busy" class="progress">
        <div class="spinner" />
        <span>{{ stageText }}</span>
      </div>

      <div v-if="error" class="err">{{ error }}</div>

      <div class="proxy">
        <label>代理地址</label>
        <input
          type="text"
          :value="proxy"
          :disabled="busy"
          placeholder="http://127.0.0.1:8787"
          @input="emit('update:proxy', ($event.target as HTMLInputElement).value)"
        />
        <div class="hint">
          Token 保存在代理里，浏览器不接触。启动方式见
          <code>mineru-poc/proxy/README.md</code>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.card {
  width: 100%;
  max-width: 560px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 32px;
}
h1 {
  font-size: 19px;
  font-weight: 600;
  margin: 0 0 6px;
}
.sub {
  color: var(--text-2);
  margin: 0 0 22px;
  font-size: 13px;
}
.drop {
  border: 1.5px dashed var(--border-strong);
  border-radius: 12px;
  padding: 36px 20px;
  text-align: center;
  cursor: pointer;
  transition: border-color .15s, background .15s;
}
.drop:hover:not(.disabled) { border-color: var(--accent); background: #fafcff; }
.drop.dragging { border-color: var(--accent); background: var(--accent-bg); }
.drop.disabled { cursor: default; opacity: .6; }
.drop-icon {
  font-size: 26px;
  color: var(--text-3);
  line-height: 1;
  margin-bottom: 10px;
}
.drop-main { font-size: 14px; }
.drop-sub { font-size: 12px; color: var(--text-3); margin-top: 6px; }

.progress {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 18px;
  color: var(--accent);
  font-size: 13px;
}
.spinner {
  width: 14px; height: 14px;
  border: 2px solid var(--accent-bg);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin .7s linear infinite;
  flex: none;
}
@keyframes spin { to { transform: rotate(360deg); } }

.err {
  margin-top: 18px;
  padding: 10px 12px;
  background: var(--danger-bg);
  color: var(--danger);
  border-radius: var(--radius);
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-all;
}

.proxy { margin-top: 26px; padding-top: 20px; border-top: 1px solid var(--border); }
.proxy label { display: block; font-size: 12px; color: var(--text-2); margin-bottom: 6px; }
.hint { font-size: 12px; color: var(--text-3); margin-top: 6px; }
code {
  background: #f2f1ee;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 11.5px;
}
</style>
