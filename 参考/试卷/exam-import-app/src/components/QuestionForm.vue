<script setup lang="ts">
import { computed } from 'vue';
import type { Question, QuestionType } from '../core/types';
import { TYPE_LABEL } from '../core/types';
import { renderMixed } from '../core/katex';

/**
 * 注意：这里直接就地修改传入的 question 对象。
 * 父组件持有的是 reactive 对象，改动会自动生效。
 * POC 阶段这样最省事，将来要接后端时再改成 emit + 不可变更新。
 */
const props = withDefaults(
  defineProps<{
    question: Question;
    /** MinerU 图片路径 -> blob URL。暂未接线，缺省为空对象，图形区会提示"未随结果返回" */
    images?: Record<string, string>;
  }>(),
  { images: () => ({}) },
);
const emit = defineEmits<{ (e: 'change'): void }>();

const TYPES: QuestionType[] = ['choice', 'blank', 'solution', 'unknown'];

const stemHtml = computed(() => renderMixed(props.question.stem));
const subHtml = computed(() => props.question.subquestions.map(renderMixed));
const optHtml = computed(() => props.question.options.map((o) => renderMixed(o.content)));

function touch() {
  emit('change');
}

function addOption() {
  const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
  const next = labels[props.question.options.length] ?? '?';
  props.question.options.push({ label: next, content: '' });
  touch();
}

function removeOption(i: number) {
  props.question.options.splice(i, 1);
  // 重新编号
  props.question.options.forEach((o, idx) => {
    o.label = String.fromCharCode(65 + idx);
  });
  touch();
}

function addSub() {
  props.question.subquestions.push('');
  touch();
}

function removeSub(i: number) {
  props.question.subquestions.splice(i, 1);
  touch();
}

function openImage(url: string) {
  window.open(url, '_blank');
}
</script>

<template>
  <div class="form">
    <div class="head">
      <div class="num">
        <label>题号</label>
        <input type="text" v-model="question.number" @input="touch" style="width:64px" />
      </div>
      <div class="type">
        <label>题型</label>
        <select v-model="question.type" @change="touch">
          <option v-for="t in TYPES" :key="t" :value="t">{{ TYPE_LABEL[t] }}</option>
        </select>
      </div>
      <div class="spacer" />
      <div class="status" :class="question.status">
        <button
          :class="{ primary: question.status === 'confirmed' }"
          @click="question.status = question.status === 'confirmed' ? 'pending' : 'confirmed'; touch()"
        >
          {{ question.status === 'confirmed' ? '已确认' : '标记为已确认' }}
        </button>
      </div>
    </div>

    <div v-if="question.warnings.length" class="warns">
      <div v-for="(w, i) in question.warnings" :key="i" class="warn">⚠ {{ w }}</div>
    </div>

    <section>
      <h3>题干</h3>
      <textarea
        v-model="question.stem"
        rows="3"
        spellcheck="false"
        @input="touch"
      />
      <div class="preview" v-html="stemHtml" />
    </section>

    <section v-if="question.options.length">
      <h3>
        选项
        <button class="mini" @click="addOption">＋</button>
      </h3>
      <div v-for="(o, i) in question.options" :key="i" class="opt">
        <span class="tag">{{ o.label }}</span>
        <input type="text" v-model="o.content" spellcheck="false" @input="touch" />
        <div class="opt-preview" v-html="optHtml[i]" />
        <button class="mini danger" title="删除" @click="removeOption(i)">×</button>
      </div>
    </section>

    <section v-if="question.subquestions.length">
      <h3>
        小问
        <button class="mini" @click="addSub">＋</button>
      </h3>
      <div v-for="(s, i) in question.subquestions" :key="i" class="sub">
        <textarea v-model="question.subquestions[i]" rows="2" spellcheck="false" @input="touch" />
        <div class="preview" v-html="subHtml[i]" />
        <button class="mini danger" title="删除" @click="removeSub(i)">×</button>
      </div>
    </section>

    <section v-if="question.figures.length">
      <h3>图形 · {{ question.figures.length }}</h3>
      <div v-for="(f, i) in question.figures" :key="i" class="fig">
        <img
          v-if="images[f.imgPath]"
          class="fig-img"
          :src="images[f.imgPath]"
          :alt="`图 ${i + 1}`"
          @click="openImage(images[f.imgPath])"
        />
        <div v-else class="fig-missing">
          图片未随结果返回：<span class="mono">{{ f.imgPath || '(无路径)' }}</span>
        </div>
        <div v-if="f.caption.length" class="fig-cap">{{ f.caption.join(' ') }}</div>
        <div v-if="f.tableBody" class="tbl" v-html="f.tableBody" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.form { padding: 18px 20px 60px; }

.head {
  display: flex;
  align-items: flex-end;
  gap: 16px;
  margin-bottom: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
}
.head label {
  display: block;
  font-size: 11px;
  color: var(--text-3);
  margin-bottom: 3px;
}
.spacer { flex: 1; }
.num input { width: 64px; }
.type select { width: 110px; }

section { margin-top: 20px; }
h3 {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  margin: 0 0 7px;
  display: flex;
  align-items: center;
  gap: 8px;
  text-transform: none;
}

.preview {
  margin-top: 6px;
  padding: 8px 11px;
  background: #fafaf8;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 14px;
  line-height: 1.9;
  min-height: 34px;
  overflow-x: auto;
}

.opt {
  display: grid;
  grid-template-columns: 26px 1fr auto;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.opt-preview {
  grid-column: 2 / -1;
  padding: 4px 9px;
  background: #fafaf8;
  border: 1px dashed var(--border);
  border-radius: 6px;
  font-size: 13.5px;
  min-height: 26px;
}
.tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px; height: 24px;
  border-radius: 50%;
  background: var(--accent-bg);
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
}

.sub {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  margin-bottom: 10px;
}
.sub .preview { grid-column: 1 / -1; margin-top: 0; }
.sub textarea { grid-column: 1; }

.mini {
  padding: 1px 7px;
  font-size: 13px;
  line-height: 1.4;
  border-radius: 5px;
}
.mini.danger { color: var(--danger); border-color: #e8c9c9; }
.mini.danger:hover { background: var(--danger-bg); }

.warns { margin-bottom: 14px; }
.warn {
  background: var(--warn-bg);
  color: var(--warn);
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 12.5px;
  margin-bottom: 5px;
}

.figs { display: flex; flex-direction: column; gap: 4px; }
.fig {
  display: flex;
  gap: 10px;
  font-size: 12px;
  color: var(--text-2);
  background: #fafaf8;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
}
.path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.status button { font-size: 12.5px; padding: 4px 12px; }
</style>
