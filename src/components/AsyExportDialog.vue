<script setup lang="ts">
/** 导出 Asymptote：把选中的数学图形转成 asy 源码，可复制 / 存文件。
 *
 *  导出的是**二维** asy（所见即所得）。为什么不做三维：复刻图本身就是三维立体的一个投影，
 *  元素里只有投影后的二维坐标，没有 z —— 要还原成 A(0,0,0)、B(2,0,0) 这种得靠人，程序硬编只会编错。
 *  弹窗里把这句话也写给用户看，免得他们以为导出来的能直接转。 */
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { figureToAsy } from '@/export/asymptote'
import { saveTextFile } from '@/composables/useTauri'
import type { MathFigureElement } from '@/types'

const props = defineProps<{ el: MathFigureElement }>()
const emit = defineEmits<{ close: [] }>()

const unit = ref(10)
const code = computed(() => figureToAsy(props.el, { unit: unit.value, title: '数学图形' }))
const copied = ref(false)
const err = ref('')

async function copy() {
  try {
    await navigator.clipboard.writeText(code.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1600)
  } catch (e) {
    err.value = '复制失败（浏览器没给剪贴板权限）—— 可以手动全选复制'
  }
}
async function save() {
  try {
    err.value = ''
    // 文件名带上元素 id，避免一次导多个互相覆盖
    await saveTextFile('figure-' + String(props.el.id).slice(-6) + '.asy', code.value)
  } catch (e) {
    err.value = (e as Error)?.message || String(e)
  }
}
const lineCount = computed(() => code.value.split('\n').length)
</script>

<template>
  <div class="ax" @mousedown.self="emit('close')">
    <div class="ax__box">
      <header class="ax__head">
        <div class="ax__title"><span class="ax__badge">asy</span> 导出 Asymptote 代码</div>
        <button class="ax__close" @click="emit('close')"><AppIcon name="close" :size="13" /></button>
      </header>

      <div class="ax__body">
        <p class="ax__note">
          这是**二维** Asymptote，坐标与编辑器里所见一致（顶点字母、虚实、每条边都对得上）。<br>
          复刻图本身是三维立体的一个<b>投影</b>，元素里只有投影后的二维坐标、没有 z，所以没法直接给你
          <code>import three</code> 的三维代码 —— 想转三维得自己按图给出各点的空间坐标。
        </p>
        <div class="ax__row">
          <label>坐标单位（最长边）
            <select v-model.number="unit">
              <option :value="5">5</option>
              <option :value="10">10</option>
              <option :value="20">20</option>
            </select>
          </label>
          <span class="ax__hint">{{ lineCount }} 行 · 最长边 = {{ unit }}</span>
        </div>
        <textarea class="ax__code" readonly :value="code" spellcheck="false"></textarea>
        <p class="ax__hint">
          怎么用：存成 <code>fig.asy</code> 后 <code>asy -f pdf fig.asy</code>；
          或在 LaTeX 里用 <code>asymptote</code> 宏包写 <code>\begin{asy} … \end{asy}</code>。
          整体大小改 <code>size(...)</code>，别改坐标（线宽是按这个尺寸换算的）。
        </p>
        <div v-if="err" class="ax__err">{{ err }}</div>
      </div>

      <footer class="ax__foot">
        <button class="ax__btn" @click="emit('close')">关闭</button>
        <button class="ax__btn" @click="save">存为 .asy 文件</button>
        <button class="ax__btn ax__btn--primary" @click="copy">{{ copied ? '已复制 ✓' : '复制代码' }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.ax { position: fixed; inset: 0; z-index: 500; background: rgba(20, 24, 34, 0.55); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; }
.ax__box { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: 92vw; max-width: 720px; max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; }
.ax__head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--border); }
.ax__title { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: var(--text); }
.ax__badge { display: inline-flex; align-items: center; justify-content: center; height: 20px; padding: 0 6px; border-radius: var(--radius-sm); background: #eef7ee; color: #2f6b34; font-size: 11px; font-weight: 700; }
.ax__close { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; cursor: pointer; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--gray-600); }
.ax__close:hover { background: var(--danger-soft); border-color: var(--danger-border); color: var(--danger); }
.ax__body { padding: 14px; display: flex; flex-direction: column; gap: 9px; overflow: auto; }
.ax__note { margin: 0; font-size: 12px; line-height: 1.7; color: var(--gray-600); background: var(--panel-2, #fafafd); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 10px; }
.ax__note b { color: var(--text); }
.ax__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 12px; color: var(--muted); }
.ax__row select { margin-left: 6px; padding: 3px 6px; font-size: 12px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: #fff; color: var(--text); }
.ax__hint { margin: 0; font-size: 11.5px; line-height: 1.6; color: var(--muted); }
.ax__code { width: 100%; height: 44vh; min-height: 240px; padding: 10px 12px; font-family: Consolas, 'Courier New', monospace; font-size: 12.5px; line-height: 1.55; color: #1f2430; background: #fbfbfd; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); resize: vertical; white-space: pre; overflow: auto; }
.ax__err { font-size: 12.5px; color: var(--danger); background: var(--danger-soft); border: 1px solid var(--danger-border); border-radius: var(--radius-sm); padding: 7px 9px; }
.ax__foot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--border); background: var(--panel-2, #fafafd); }
.ax__btn { padding: 6px 14px; font-size: 13px; cursor: pointer; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--gray-700); }
.ax__btn:hover { background: #eef7ee; border-color: #bfe0bf; color: #2f6b34; }
.ax__btn--primary { background: #2f6b34; border-color: #2f6b34; color: #fff; font-weight: 600; }
.ax__btn--primary:hover { background: #275a2c; color: #fff; }
code { font-family: Consolas, 'Courier New', monospace; font-size: 11.5px; background: #f1f1f5; padding: 1px 4px; border-radius: 3px; }
</style>
