<script setup lang="ts">
import type { LooseBlock } from '../core/types';

/**
 * 游离块 = 没被归到任何题目上的版面元素。
 * 典型是卷末的「答题卡」标题 + 表格。用户明确要求支持表格与答题卡区域，
 * 所以这些内容必须能看到、能导出，不能只显示一个计数。
 */
defineProps<{
  block: LooseBlock;
  images: Record<string, string>;
}>();

function openImage(url: string) {
  window.open(url, '_blank');
}
</script>

<template>
  <div class="lb">
    <div class="kind">
      <span class="badge">{{ block.type === 'text' ? '文本' : block.type === 'table' ? '表格' : '图片' }}</span>
      <span v-if="block.page !== undefined" class="mono pos">第 {{ (block.page ?? 0) + 1 }} 页</span>
    </div>

    <template v-if="block.type === 'text'">
      <div class="text">{{ block.text }}</div>
    </template>

    <template v-else>
      <img
        v-if="images[block.imgPath ?? '']"
        class="fig-img"
        :src="images[block.imgPath ?? '']"
        alt="游离块图像"
        @click="openImage(images[block.imgPath ?? ''])"
      />
      <div v-else class="missing">图片未随结果返回：<span class="mono">{{ block.imgPath }}</span></div>

      <div v-if="block.tableBody" class="tbl-wrap">
        <div class="tbl-label">识别出的表格结构</div>
        <!-- table_body 是 MinerU 从用户自己的文档里解析出来的 HTML -->
        <div class="tbl" v-html="block.tableBody" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.lb { padding: 18px 20px 60px; }
.kind {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.badge {
  font-size: 11.5px;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--accent-bg);
  color: var(--accent);
}
.pos { font-size: 12px; color: var(--text-3); }

.text {
  font-size: 14px;
  line-height: 1.9;
  padding: 10px 12px;
  background: #fafaf8;
  border: 1px solid var(--border);
  border-radius: 6px;
}

.fig-img {
  max-width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  cursor: zoom-in;
  display: block;
}

.missing {
  font-size: 12.5px;
  color: var(--warn);
  background: var(--warn-bg);
  border-radius: 6px;
  padding: 8px 11px;
}

.tbl-wrap { margin-top: 16px; }
.tbl-label { font-size: 12px; color: var(--text-2); margin-bottom: 6px; }
.tbl {
  overflow-x: auto;
  font-size: 13px;
}
.tbl :deep(table) {
  border-collapse: collapse;
  min-width: 60%;
}
.tbl :deep(td),
.tbl :deep(th) {
  border: 1px solid var(--border-strong);
  padding: 5px 14px;
  text-align: center;
}
</style>
