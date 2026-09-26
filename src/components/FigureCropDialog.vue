<script setup lang="ts">
/**
 * 【v1666】插入前先看一眼（用户要求）：把**切好的图形 + 尺寸**摆出来，确认了才插
 *
 * 为什么需要：自动裁切是按真样本一点点调出来的，但**老师最清楚哪一张切得对不对** ——
 *   插错了还得删掉重来。这里把结果摆出来，哪一张不满意就**单独**把那一张改成"用整张原图"，
 *   其它照旧，不用整条重来。
 *
 * 样子直接沿用应用里现成的对话框（截图弹窗那一套：fixed 蒙层 + 白卡片 + 品牌色主按钮），
 * 免得侧边栏里出现第三种风格。
 */
import { ref } from 'vue'
import type { CropPreview } from '@/composables/figCrop'

const props = defineProps<{ items: CropPreview[] }>()
const emit = defineEmits<{ (e: 'done', sel: CropPreview[] | null, noMore: boolean): void }>()

// 自己留一份：勾选只影响这次插入，不往回改面板里的数据
const list = ref<CropPreview[]>(props.items.map((it) => ({ ...it })))
const noMore = ref(false)

/** 这一张是怎么处理的（一句话） */
function modeText(it: CropPreview): string {
  if (it.mode === 'figure') return '只留了图形部分'
  if (it.mode === 'trim') return '认不出单独的图形，只去掉了四周白边'
  return '认不出图形，整张可用'
}
/** 勾选之后实际会插的尺寸 */
function finalSize(it: CropPreview): string {
  const w = it.useRaw ? it.rw : it.cw
  const h = it.useRaw ? it.rh : it.ch
  return w && h ? w + '×' + h : '尺寸未知'
}
function srcOf(it: CropPreview): string {
  return it.useRaw ? it.raw : (it.cut || it.raw)
}
function confirm() {
  emit('done', list.value.map((it) => ({ ...it })), noMore.value)
}
function cancel() {
  emit('done', null, noMore.value)
}
</script>

<template>
  <div class="figp" @click.self="cancel()">
    <div class="figp__box">
      <header class="figp__head">
        <span>切好的图形，确认一下再插</span>
        <span class="figp__count">共 {{ list.length }} 张</span>
      </header>
      <div class="figp__body">
        <p class="figp__tip">
          下面是自动切出来的结果。<b>哪一张切得不满意，就单独勾上「用整张原图」</b>——只改那一张，其它照旧。
        </p>
        <div class="figp__grid">
          <div v-for="(it, i) in list" :key="i" class="figp__card" :class="{ 'figp__card--raw': it.useRaw }">
            <div class="figp__thumb"><img :src="srcOf(it)" :alt="'第 ' + (i + 1) + ' 张'" /></div>
            <div class="figp__meta">
              <div class="figp__line figp__line--strong">第 {{ i + 1 }} 张 · {{ finalSize(it) }}</div>
              <div class="figp__line">{{ modeText(it) }}</div>
              <div class="figp__line figp__line--dim">原图 {{ it.rw }}×{{ it.rh }}</div>
              <label class="figp__chk">
                <input v-model="it.useRaw" type="checkbox" />
                <span>用整张原图（不切）</span>
              </label>
            </div>
          </div>
        </div>
      </div>
      <footer class="figp__bar">
        <label class="figp__chk figp__chk--foot">
          <input v-model="noMore" type="checkbox" />
          <span>以后不再问，直接插切好的图形</span>
        </label>
        <div class="figp__actions">
          <button class="figp__btn" @click="cancel()">取消</button>
          <button class="figp__btn figp__btn--primary" @click="confirm()">就插这些</button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
/* 与截图弹窗同一套：fixed 蒙层 + 白卡片 + 品牌色主按钮 */
.figp { position: fixed; inset: 0; z-index: 460; background: rgba(20, 24, 34, 0.6); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; }
.figp__box { background: #fff; border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: min(780px, 94vw); max-height: 88vh; display: flex; flex-direction: column; overflow: hidden; }
.figp__head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); font-size: 15px; font-weight: 700; color: var(--text); }
.figp__count { font-size: 12px; font-weight: 400; color: var(--muted); }
.figp__body { padding: 12px 16px; overflow: auto; }
.figp__tip { margin: 0 0 10px; font-size: 12.5px; line-height: 1.6; color: var(--muted); }
.figp__tip b { color: var(--text); }
.figp__grid { display: flex; flex-wrap: wrap; gap: 12px; }
.figp__card { flex: 1 1 250px; max-width: calc(50% - 6px); border: 1px solid var(--border); border-radius: 10px; padding: 8px; background: #fff; display: flex; flex-direction: column; gap: 8px; }
.figp__card--raw { border-color: var(--brand); background: #faf9ff; }
.figp__thumb { height: 140px; border-radius: 8px; background: #f7f8fb; border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; overflow: hidden; }
.figp__thumb img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
.figp__meta { display: flex; flex-direction: column; gap: 2px; }
.figp__line { font-size: 12px; color: var(--muted); line-height: 1.5; }
.figp__line--strong { font-size: 13px; font-weight: 700; color: var(--text); }
.figp__line--dim { font-size: 11.5px; }
.figp__chk { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text); cursor: pointer; margin-top: 4px; }
.figp__chk--foot { margin-top: 0; color: var(--muted); }
.figp__bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px 14px; border-top: 1px solid var(--border); }
.figp__actions { display: flex; gap: 8px; }
.figp__btn { border: 1px solid var(--border-strong); background: #fff; color: var(--text); border-radius: 7px; padding: 7px 14px; cursor: pointer; font-size: 13px; }
.figp__btn:hover { background: var(--gray-50); }
.figp__btn--primary { background: var(--brand); border-color: var(--brand); color: #fff; }
.figp__btn--primary:hover { background: var(--brand-strong); }
</style>
