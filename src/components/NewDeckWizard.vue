<script setup lang="ts">
/**
 * 打开应用时的「新建向导」✓（用户方案 A ✓）
 *
 * 设计取舍 ✓：**不替用户往文档里写内容** ✗ —— 而是把应用的四项能力摆到眼前 ✓
 * （公式 ✓ 表格 ✓ 几何图形 ✓ PPT 导入 ✓ 这些强项原先全藏在工具栏里 ✗）。
 *
 * 「不再显示」记进 localStorage ✓，勾过之后再打开就直接进空白 ✓。
 */
import { ref } from 'vue'

const KEY = 'lj-mathslides-vue:newdeck-wizard'
const emit = defineEmits<{
  blank: []
  templates: []
  paper: []
  pptx: []
  close: []
}>()

const hidden = ref(localStorage.getItem(KEY) === 'off')
const dontAsk = ref(false)

/** 关闭按钮：**只关掉这个窗口**，不写「不再显示」、也**不动当前文稿**。
 *  ⚠ 绝不能走 emit('blank') ✗ —— 那条路会 resetDeck ✓ 把用户正在做的东西清掉 ✗。
 *  关掉后落到「本来就已经打开的那份文稿」上，这才是"关闭"该有的语义。 */
function dismiss() {
  hidden.value = true
  emit('close')
}

function go(kind: 'blank' | 'templates' | 'paper' | 'pptx') {
  if (dontAsk.value) localStorage.setItem(KEY, 'off')
  hidden.value = true
  // ⚠ 不能写 emit(kind) ✗ —— 联合类型匹配不上 defineEmits 的重载 ✓（TS2769 ✓），显式分支最稳 ✓
  if (kind === 'blank') emit('blank')
  else if (kind === 'templates') emit('templates')
  else if (kind === 'paper') emit('paper')
  else emit('pptx')
}
</script>

<template>
  <div v-if="!hidden" class="ndw">
    <div class="ndw__box">
      <button class="ndw__close" type="button" title="关闭（保留当前文稿）" @click="dismiss">✕</button>
      <h3 class="ndw__title">新建演示文稿</h3>
      <p class="ndw__sub">选一个起点，或直接从空白开始</p>
      <div class="ndw__grid">
        <button class="ndw__card" @click="go('blank')">
          <strong>空白</strong>
          <span>一张干净的白纸</span>
        </button>
        <button class="ndw__card" @click="go('templates')">
          <strong>从模板开始</strong>
          <span>套用现成版式</span>
        </button>
        <button class="ndw__card" @click="go('paper')">
          <strong>试卷 / 讲义</strong>
          <span>A4 排版 · 导出 PDF</span>
        </button>
        <button class="ndw__card" @click="go('pptx')">
          <strong>从 PPT 导入</strong>
          <span>.pptx 转成幻灯片</span>
        </button>
      </div>
      <label class="ndw__chk">
        <input v-model="dontAsk" type="checkbox" />
        启动时不再显示此向导（永久，清空浏览器数据可恢复）
      </label>
    </div>
  </div>
</template>

<style scoped>
.ndw {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(20, 22, 28, 0.45);
  backdrop-filter: blur(2px);
}
.ndw__box {
  position: relative;              /* 关闭按钮定位用 */
  width: min(520px, 92vw);
  background: var(--surface, #fff);
  border: 1px solid var(--border, #e3e0d8);
  border-radius: 8px;
  padding: 22px 24px 16px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.22);
}
.ndw__close {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 26px;
  height: 26px;
  padding: 0;
  line-height: 1;
  font-size: 13px;
  cursor: pointer;
  background: var(--surface, #fff);
  border: 1px solid var(--border, #e3e0d8);
  border-radius: 6px;
  color: var(--text-2, #8a8a8a);
}
.ndw__close:hover { background: #fdecec; border-color: #e5a3a3; color: #c0392b; }
.ndw__title {
  margin: 0 0 4px;
  font-size: 17px;
}
.ndw__sub {
  margin: 0 0 16px;
  font-size: 12.5px;
  color: var(--text-2, #8a8a8a);
}
.ndw__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.ndw__card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  align-items: flex-start;
  text-align: left;
  padding: 13px 14px;
  border: 1px solid var(--border, #e3e0d8);
  border-radius: 8px;
  background: var(--surface, #fff);
  cursor: pointer;
}
.ndw__card:hover {
  border-color: var(--brand, #1668e0);
  background: var(--brand-50, #eff5ff);
}
.ndw__card strong {
  font-size: 14px;
}
.ndw__card span {
  font-size: 12px;
  color: var(--text-2, #8a8a8a);
}
.ndw__chk {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
  font-size: 12.5px;
  color: var(--text-2, #8a8a8a);
  cursor: pointer;
}
</style>
