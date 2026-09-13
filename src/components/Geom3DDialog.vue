<script setup lang="ts">
/** 三维立体图：把一份「顶点 + 面表」的三维几何描述投影成可编辑的数学图形。
 *
 *  为什么要有这个入口：「图片转图形」是从像素**猜**几何（一条棱该实该虚只能靠墨迹、凸包内外这些启发式），
 *  而这里是**算**：凸多面体的一条棱属于至少一个正面朝向的面就可见，虚实是面表的推论。
 *  所以"多余顶点、虚实判错、异面直线在投影上假交叉"这三类问题在这条路上不存在。
 *
 *  两种确定视角的办法：
 *   ① 直接给 azim / elev（教材常用 -60~-10 / 10~30）；
 *   ② **截图描点对齐** —— 导入同一张截图，按提示依次点出各顶点，反解精确视角（正交投影是线性的，
 *      给定视角后缩放/平移用最小二乘一次解出，所以只要在视角网格上粗搜+细化即可）。
 */
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { useDeckStore } from '@/stores/deck'
import { projectGeom, solveView, type Geom3D } from '@/composables/geom3d'
import { renderSolid } from '@/composables/solid3d'
import { closeGeom3D } from '@/ui/geom3d'

const store = useDeckStore()
const W = 560
const H = 620

/** 示例：正四棱柱 ABCD-A₁B₁C₁D₁（2×2×2），四条竖棱各一个中点，再从 C₂ 连四条辅助线 */
const SAMPLE = `{
  "solid": "prism4",
  "name": "正四棱柱 ABCD-A₁B₁C₁D₁",
  "vertices": {
    "A": [0, 0, 0], "B": [2, 0, 0], "C": [2, 2, 0], "D": [0, 2, 0],
    "A1": [0, 0, 2], "B1": [2, 0, 2], "C1": [2, 2, 2], "D1": [0, 2, 2],
    "A2": [0, 0, 0.7], "B2": [2, 0, 0.7], "C2": [2, 2, 0.7], "D2": [0, 2, 0.7]
  },
  "faces": [
    ["A", "B", "C", "D"],
    ["A1", "B1", "C1", "D1"],
    ["A", "B", "B1", "A1"],
    ["B", "C", "C1", "B1"],
    ["C", "D", "D1", "C1"],
    ["D", "A", "A1", "D1"]
  ],
  "auxiliary": [
    { "from": "C2", "to": "A2" },
    { "from": "C2", "to": "B2" },
    { "from": "C2", "to": "D2" }
  ],
  "view": { "azim": -35, "elev": 20 }
}`

const raw = ref(SAMPLE)
const azim = ref(-35)
const elev = ref(20)
const parseErr = ref('')
const alignImg = ref('')
const clicks = ref<[number, number][]>([])
const fitErr = ref<number | null>(null)
const alignBox = ref<HTMLElement | null>(null)

const model = ref<Geom3D | null>(null)
const order = computed(() => (model.value ? Object.keys(model.value.vertices) : []))
const nextName = computed(() => order.value[clicks.value.length] || '')

function parse() {
  parseErr.value = ''
  try {
    const m = JSON.parse(raw.value) as Geom3D & { view?: { azim?: number; elev?: number } }
    if (!m || typeof m !== 'object' || !m.vertices || !Object.keys(m.vertices).length) {
      parseErr.value = '缺少 vertices'; model.value = null; return
    }
    model.value = m
    if (m.view) {
      if (typeof m.view.azim === 'number') azim.value = m.view.azim
      if (typeof m.view.elev === 'number') elev.value = m.view.elev
    }
  } catch (e) {
    parseErr.value = 'JSON 解析失败：' + (e as Error).message
    model.value = null
  }
}
parse()

/** 预览 / 插入用的 SVG（参数顺序：kind, pts, w, h, stroke, sw, fill, dsh, vlabels,
 *  edgeStyles, selVertex, selEdge, labelOffsets, faceStyles, selFace, mesh —— mesh 在最后一位） */
const svg = computed(() => {
  const m = model.value
  if (!m) return ''
  const p = projectGeom(m, { azim: azim.value, elev: elev.value })
  return renderSolid('cube', p.points, W, H, '#1a1a1a', 2.6, 'transparent', '6 5',
    p.vlabels, undefined, undefined, undefined, undefined, undefined, undefined, p.mesh)
})

const edgeStat = computed(() => {
  const m = model.value
  if (!m) return ''
  const p = projectGeom(m, { azim: azim.value, elev: elev.value })
  const dash = p.mesh.edges.filter((e) => e[2]).length
  return p.mesh.edges.length + ' 条棱（' + dash + ' 虚线）'
})

// ---------------- 截图描点对齐 ----------------
function pickImage() { const el = document.getElementById('g3-img') as HTMLInputElement | null; el?.click() }
function onPicked(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files && input.files[0]
  input.value = ''
  if (!f) return
  const r = new FileReader()
  r.onload = () => { alignImg.value = String(r.result || ''); clicks.value = []; fitErr.value = null }
  r.readAsDataURL(f)
}
function onClickImage(e: MouseEvent) {
  const box = alignBox.value
  if (!box || !model.value) return
  const r = box.getBoundingClientRect()
  clicks.value = [...clicks.value, [e.clientX - r.left, e.clientY - r.top]]
}
function solve() {
  if (!model.value || clicks.value.length < 3) { fitErr.value = null; return }
  const s = solveView(model.value, order.value, clicks.value)
  azim.value = Math.round(s.azim * 10) / 10
  elev.value = Math.round(s.elev * 10) / 10
  fitErr.value = s.err
}
function insert() {
  const m = model.value
  if (!m) return
  const p = projectGeom(m, { azim: azim.value, elev: elev.value })
  store.addElement('mathfig', {
    kind: 'cube', points: p.points, mesh: p.mesh, vlabels: p.vlabels,
    w: W, h: H, fill: 'transparent', stroke: '#1a1a1a', strokeWidth: 2.6,
  } as never)
  closeGeom3D()
}
</script>

<template>
  <div class="g3" @mousedown.self="closeGeom3D()">
    <div class="g3__box">
      <header class="g3__head">
        <span class="g3__title">三维立体图 —— 由模型算出虚实</span>
        <button class="g3__close" @click="closeGeom3D()"><AppIcon name="close" :size="13" /></button>
      </header>

      <div class="g3__body">
        <div class="g3__left">
          <div class="g3__lab">几何描述（JSON：vertices 必填，faces 决定虚实）</div>
          <textarea v-model="raw" class="g3__ta" spellcheck="false" @blur="parse" @input="parseErr = ''" />
          <p v-if="parseErr" class="g3__err">{{ parseErr }}</p>
          <div class="g3__row">
            <label class="g3__f">方位角 azim <b>{{ azim }}°</b>
              <input v-model.number="azim" type="range" min="-180" max="180" step="1">
            </label>
            <label class="g3__f">仰角 elev <b>{{ elev }}°</b>
              <input v-model.number="elev" type="range" min="-80" max="80" step="1">
            </label>
          </div>
          <p class="g3__tip">教材常用：方位角 −60~−10°，仰角 10~30°（正值是俯视，看得见上底面）。</p>

          <div class="g3__lab g3__lab--mt">截图描点对齐（可选，但最准）</div>
          <button class="g3__btn" @click="pickImage()">{{ alignImg ? '换一张截图' : '导入同一张截图…' }}</button>
          <input id="g3-img" type="file" accept="image/*" style="display:none" @change="onPicked">
          <template v-if="alignImg">
            <p class="g3__tip">
              按提示**依次点出**每个顶点：
              <b>{{ clicks.length }}/{{ order.length }}</b>
              <template v-if="nextName"> —— 下一个点 <b>{{ nextName }}</b></template>
              <template v-else> —— 点完了，点「反解视角」</template>
              （至少 4 个，且要跨上下两层，否则解不准）
            </p>
            <div ref="alignBox" class="g3__imgbox" @click="onClickImage">
              <img :src="alignImg" alt="" draggable="false">
              <span
                v-for="(c, i) in clicks" :key="'c' + i" class="g3__dot"
                :style="{ left: c[0] + 'px', top: c[1] + 'px' }"
              >{{ order[i] }}</span>
            </div>
            <div class="g3__row">
              <button class="g3__btn" :disabled="clicks.length < 3" @click="solve()">反解视角</button>
              <button class="g3__btn" @click="clicks = []; fitErr = null">重点</button>
              <span v-if="fitErr !== null" class="g3__fit">
                残差 {{ (fitErr * 100).toFixed(2) }}%
                <b :class="{ 'g3__fit--bad': fitErr > 0.02 }">{{ fitErr <= 0.02 ? '（对得很准）' : '（还差，检查点的顺序）' }}</b>
              </span>
            </div>
          </template>
        </div>

        <div class="g3__right">
          <svg :viewBox="`0 0 ${W} ${H}`" width="100%" height="100%" v-html="svg" />
        </div>
      </div>

      <footer class="g3__foot">
        <span class="g3__stat">{{ edgeStat }}</span>
        <button class="g3__btn" @click="closeGeom3D()">取消</button>
        <button class="g3__btn g3__btn--primary" :disabled="!model" @click="insert()">插入到当前页</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.g3 { position: fixed; inset: 0; background: rgba(20, 20, 28, .42); display: flex; align-items: center; justify-content: center; z-index: 60; }
.g3__box { width: 1000px; max-width: 94vw; height: 88vh; background: var(--surface, #fff); border-radius: 8px; box-shadow: 0 18px 48px rgba(0,0,0,.28); display: flex; flex-direction: column; overflow: hidden; }
.g3__head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--border, #e6e6ea); font-size: 13px; }
.g3__title { font-weight: 700; }
.g3__close { border: 0; background: none; cursor: pointer; color: var(--muted, #888); }
.g3__body { flex: 1; display: flex; min-height: 0; }
.g3__left { width: 420px; padding: 12px 14px; overflow: auto; border-right: 1px solid var(--border, #e6e6ea); }
.g3__right { flex: 1; padding: 8px; display: flex; align-items: center; justify-content: center; background: #fff; }
.g3__lab { font-size: 12px; font-weight: 700; color: #444; margin-bottom: 6px; }
.g3__lab--mt { margin-top: 14px; }
.g3__ta { width: 100%; height: 220px; font: 12px/1.5 Consolas, Menlo, monospace; border: 1px solid var(--border, #ddd); border-radius: 6px; padding: 8px; resize: vertical; box-sizing: border-box; }
.g3__err { color: #c0392b; font-size: 12px; margin: 6px 0 0; }
.g3__row { display: flex; align-items: center; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
.g3__f { font-size: 12px; color: #555; flex: 1; min-width: 170px; }
.g3__f input { width: 100%; }
.g3__tip { font-size: 12px; color: #6b6b76; line-height: 1.6; margin: 8px 0 0; }
.g3__btn { border: 1px solid var(--border, #ddd); background: #f7f7f9; border-radius: 6px; padding: 5px 10px; font-size: 12px; cursor: pointer; }
.g3__btn:disabled { opacity: .5; cursor: default; }
.g3__btn--primary { background: #1668e0; border-color: #1668e0; color: #fff; font-weight: 700; }
.g3__imgbox { position: relative; margin-top: 8px; border: 1px solid var(--border, #ddd); border-radius: 6px; overflow: hidden; cursor: crosshair; }
.g3__imgbox img { display: block; width: 100%; }
.g3__dot { position: absolute; transform: translate(-50%, -50%); background: #ff8f1f; color: #fff; font-size: 10px; font-weight: 700; border-radius: 9px; padding: 1px 5px; pointer-events: none; }
.g3__fit { font-size: 12px; color: #555; }
.g3__fit--bad { color: #c0392b; }
.g3__foot { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 10px 14px; border-top: 1px solid var(--border, #e6e6ea); }
.g3__stat { margin-right: auto; font-size: 12px; color: #6b6b76; }
</style>
