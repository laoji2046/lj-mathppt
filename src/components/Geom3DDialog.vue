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
import { buildSolid, projectGeom, solveView, type Geom3D } from '@/composables/geom3d'
import { GEOM3D_PRESETS, GEOM3D_PROMPT } from '@/composables/geom3dPrompt'
import { renderSolid, arcsSvg } from '@/composables/solid3d'
import { closeGeom3D } from '@/ui/geom3d'

const store = useDeckStore()
const H = 620
/** 元素框的宽按内容的宽高比给 —— 固定宽高会把投影拉变形（椭圆最明显）。
 *  这里从当前投影算，随视角变化（角度变了包围盒也变）。 */
const W = computed(() => {
  const m = model.value
  if (!m) return 560
  const asp = projectGeom(m, { azim: azim.value, elev: elev.value }).aspect
  return Math.max(200, Math.min(900, Math.round(H * asp)))
})

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
/** 可用的点名（按出现顺序）：模型顶点 + **定比分点解析出来的点**。
 *  定比分点存在 marks 里、到投影时才解析，所以这里必须自己解析一遍 ——
 *  否则"新加了点却不能拿它连辅助线/定平面"（用户报过这个）。
 *  可传递：一个定比分点可以拿另一个定比分点当端点。 */
const order = computed(() => {
  const m = model.value
  if (!m) return []
  const names = Object.keys(m.vertices || {})
  const known = new Set(names)
  let pend = (m.marks || []).filter((k) => k && k.name)
  for (let pass = 0; pass < 8 && pend.length; pass++) {
    const next: typeof pend = []
    let moved = false
    for (const mk of pend) {
      if (known.has(mk.from) && known.has(mk.to)) {
        if (!known.has(mk.name)) { names.push(mk.name); known.add(mk.name) }
        moved = true
      } else next.push(mk)
    }
    pend = next
    if (!moved) break
  }
  return names
})
const nextName = computed(() => order.value[clicks.value.length] || '')

function parse() {
  parseErr.value = ''
  try {
    const m = JSON.parse(raw.value) as Geom3D & { view?: { azim?: number; elev?: number } }
    // 圆柱 / 圆锥只用 primitive、没有 vertices，别把它们拒了
    const hasVerts = !!m.vertices && Object.keys(m.vertices).length > 0
    if (!m || typeof m !== 'object' || (!hasVerts && !m.primitive)) {
      parseErr.value = '缺少 vertices（或者给 primitive）'; model.value = null; return
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
  const solid = renderSolid('cube', p.points, W.value, H, '#1a1a1a', 2.6, 'transparent', '6 5',
    p.vlabels, undefined, undefined, undefined, undefined, p.faceStyles.length ? p.faceStyles : undefined, undefined, p.mesh)
  // 圆柱 / 圆锥的底面是**弧图元**，renderSolid 不画它，单独叠一层（跟画布里的做法一致）
  return solid + arcsSvg(p.arcs, W.value, H, '#1a1a1a', 2.6)
})

const edgeStat = computed(() => {
  const m = model.value
  if (!m) return ''
  const p = projectGeom(m, { azim: azim.value, elev: elev.value })
  const dash = p.mesh.edges.filter((e) => e[2]).length
  const arc = p.arcs.length ? '＋' + p.arcs.length + ' 段弧' : ''
  return p.mesh.edges.length + ' 条棱（' + dash + ' 虚线）' + arc
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
/** 复制提示词：这份 JSON app 自己不会生成 —— 它由大模型按提示词把题目翻译出来。
 *  所以把提示词一键复制，跟题目（文字或题图）一起发给任意 AI 即可。 */
const copied = ref(false)
async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(GEOM3D_PROMPT)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1600)
  } catch {
    // 剪贴板不可用（无权限等）就退回"选中让用户自己复制"
    const ta = document.createElement('textarea')
    ta.value = GEOM3D_PROMPT
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1600)
  }
}
function usePreset(json: string) {
  raw.value = json
  parse()
}

// ---------------- 搭模型（不依赖 AI） ----------------
const bType = ref<'cube' | 'box' | 'prism' | 'pyramid' | 'cylinder' | 'cone'>('prism')
const bN = ref(4)
const bA = ref(2)
const bB = ref(1.4)
const bH = ref(2)
/** 参数化生成 → 写回 JSON 文本框（文本框始终是唯一数据源，手改也行） */
function build() {
  const m = buildSolid({ type: bType.value, n: bN.value, a: bA.value, b: bB.value, h: bH.value })
  const view = { azim: azim.value, elev: elev.value }
  raw.value = JSON.stringify({ ...m, view }, null, 1)
  parse()
}

/** 在当前模型上加一条辅助线（选 from/to + 线型）。高 PO、体对角线 AC₁ 都这么加。 */
const auxFrom = ref('')
const auxTo = ref('')
const auxStyle = ref<'auto' | 'solid' | 'dashed'>('auto')
function addAux() {
  const m = model.value
  if (!m || !auxFrom.value || !auxTo.value || auxFrom.value === auxTo.value) return
  const next = JSON.parse(raw.value) as Geom3D
  next.auxiliary = [...(next.auxiliary || []), { from: auxFrom.value, to: auxTo.value, style: auxStyle.value }]
  raw.value = JSON.stringify(next, null, 1)
  parse()
}

// ---------------- 定比分点 ----------------
/** 定比分点：P = A + t·(B−A)。中点 t=0.5、三等分点 t=1/3，任意比都行。 */
const mkFrom = ref('')
const mkTo = ref('')
const mkT = ref(0.5)
const mkName = ref('')
/** 默认给还没用过的字母（M、N、E、F…）—— 教材里中点常叫 M / N / E */
function nextMarkName(): string {
  const used = new Set(Object.keys(model.value?.vertices || {}))
  const used2 = new Set((model.value?.marks || []).map((x) => x.name))
  for (const c of ['M', 'N', 'E', 'F', 'G', 'H', 'K', 'Q', 'R', 'S', 'T']) {
    if (!used.has(c) && !used2.has(c)) return c
  }
  return 'M'
}
function addMark() {
  const m = model.value
  if (!m || !mkFrom.value || !mkTo.value || mkFrom.value === mkTo.value) return
  const name = mkName.value.trim() || nextMarkName()
  const next = JSON.parse(raw.value) as Geom3D
  // 同一个字母重复定义会乱：先把旧的同名那条去掉
  next.marks = [...(next.marks || []).filter((x) => x.name !== name), { name, from: mkFrom.value, to: mkTo.value, t: mkT.value }]
  raw.value = JSON.stringify(next, null, 1)
  parse()
  mkName.value = ''
}

/** 加截面 / 辅助面：输入一串顶点名（空格或逗号分隔），按这个顺序围成多边形。
 *  例题里的"截面 A-C-B₁"就是这三个字。填充色浅黄，只描边就留空颜色。 */
const cutText = ref('')
const cutFill = ref(true)
function addCut() {
  const m = model.value
  if (!m) return
  const ids = cutText.value.split(/[\s,，]+/).map((s) => s.trim()).filter(Boolean)
  if (ids.length < 3) return
  const bad = ids.filter((n) => !(n in m.vertices))
  if (bad.length) { parseErr.value = '截面里有不存在的顶点：' + bad.join('、'); return }
  const next = JSON.parse(raw.value) as Geom3D
  next.cutPlanes = [...(next.cutPlanes || []), { points: ids, fill: cutFill.value ? '#f0c674' : null }]
  raw.value = JSON.stringify(next, null, 1)
  parse()
  cutText.value = ''
}

/** **多点确定平面 → 求截面**：给三个（或更多）点，算出平面与该多面体的真实截面多边形。 */
const planeText = ref('')
function addPlaneCut() {
  const m = model.value
  if (!m) return
  const ids = planeText.value.split(/[\s,，]+/).map((s) => s.trim()).filter(Boolean)
  if (ids.length < 3) { parseErr.value = '至少要三个点才能确定平面'; return }
  const markNames = new Set((m.marks || []).map((x) => x.name))
  const bad = ids.filter((n) => !(n in (m.vertices || {})) && !markNames.has(n))
  if (bad.length) { parseErr.value = '平面里有不存在的点：' + bad.join('、'); return }
  const next = JSON.parse(raw.value) as Geom3D
  next.planeCuts = [...(next.planeCuts || []), { through: ids, fill: '#8ecae6' }]
  raw.value = JSON.stringify(next, null, 1)
  parse()
  planeText.value = ''
}

/** 棱柱：给每条竖棱加一个中点（A2 / B2 / …）—— 教材里那排"中点"一点就齐。 */
function addMidpoints() {
  const m = model.value
  if (!m) return
  const next = JSON.parse(raw.value) as Geom3D
  const add: Record<string, [number, number, number]> = {}
  for (const n of Object.keys(next.vertices)) {
    const base = n.replace(/\d+$/, '')
    const top = base + '1'
    if (!n.endsWith('1') || !next.vertices[top] || !next.vertices[base]) continue
    const lo = next.vertices[base], hi = next.vertices[top]
    add[base + '2'] = [lo[0], lo[1], +((lo[2] + hi[2]) / 2).toFixed(4)]
  }
  if (!Object.keys(add).length) return
  next.vertices = { ...next.vertices, ...add }
  raw.value = JSON.stringify(next, null, 1)
  parse()
}

function insert() {
  const m = model.value
  if (!m) return
  const p = projectGeom(m, { azim: azim.value, elev: elev.value })
  store.addElement('mathfig', {
    kind: 'cube', points: p.points, mesh: p.mesh, vlabels: p.vlabels,
    arcs: p.arcs.length ? p.arcs : undefined,
    faceStyles: p.faceStyles.length ? p.faceStyles : undefined,
    w: W.value, h: H, fill: 'transparent', stroke: '#1a1a1a', strokeWidth: 2.6,
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
          <div class="g3__row g3__row--top">
            <select class="g3__sel" @change="usePreset(($event.target as HTMLSelectElement).value)">
              <option value="">常用几何体…</option>
              <option v-for="p in GEOM3D_PRESETS" :key="p.name" :value="p.json">{{ p.name }}</option>
            </select>
            <button class="g3__btn" title="想把题目交给 AI 翻译成 JSON 时用：复制提示词，连同题目一起发出去" @click="copyPrompt()">
              {{ copied ? '已复制 ✓' : '复制提示词（可选）' }}
            </button>
          </div>

          <div class="g3__build">
            <div class="g3__lab">搭一个（不用 AI）</div>
            <div class="g3__row g3__row--top">
              <select v-model="bType" class="g3__sel">
                <option value="prism">正 n 棱柱</option>
                <option value="pyramid">正 n 棱锥</option>
                <option value="cube">正方体</option>
                <option value="box">长方体</option>
                <option value="cylinder">圆柱</option>
                <option value="cone">圆锥</option>
                <option value="sphere">球</option>
              </select>
              <label v-if="bType === 'prism' || bType === 'pyramid'" class="g3__num">n <input v-model.number="bN" type="number" min="3" max="12"></label>
              <label class="g3__num">{{ bType === 'cube' ? '棱长' : (bType === 'cylinder' || bType === 'cone' ? '底半径' : '长/底边') }} <input v-model.number="bA" type="number" step="0.1"></label>
              <label v-if="bType === 'box'" class="g3__num">宽 <input v-model.number="bB" type="number" step="0.1"></label>
              <label class="g3__num">高 <input v-model.number="bH" type="number" step="0.1"></label>
              <button class="g3__btn" @click="build()">生成</button>
              <button class="g3__btn" title="给每条竖棱加中点（A2 / B2 / …）" @click="addMidpoints()">＋竖棱中点</button>
            </div>
            <div class="g3__row g3__row--top">
              <span class="g3__tip g3__tip--inline">加辅助线（高 PO、体对角线 AC₁ 这类）：</span>
              <select v-model="auxFrom" class="g3__sel g3__sel--sm">
                <option value="">从…</option>
                <option v-for="n in order" :key="'af' + n" :value="n">{{ n }}</option>
              </select>
              <select v-model="auxTo" class="g3__sel g3__sel--sm">
                <option value="">到…</option>
                <option v-for="n in order" :key="'at' + n" :value="n">{{ n }}</option>
              </select>
              <select v-model="auxStyle" class="g3__sel g3__sel--sm">
                <option value="auto">自动判</option>
                <option value="solid">实线</option>
                <option value="dashed">虚线</option>
              </select>
              <button class="g3__btn" @click="addAux()">添加</button>
            </div>
            <div class="g3__row g3__row--top">
              <span class="g3__tip g3__tip--inline">定比分点 P = A + t(B−A)：</span>
              <select v-model="mkFrom" class="g3__sel g3__sel--sm">
                <option value="">从…</option>
                <option v-for="n in order" :key="'mf' + n" :value="n">{{ n }}</option>
              </select>
              <select v-model="mkTo" class="g3__sel g3__sel--sm">
                <option value="">到…</option>
                <option v-for="n in order" :key="'mt' + n" :value="n">{{ n }}</option>
              </select>
              <label class="g3__num">t <input v-model.number="mkT" type="number" step="0.05" min="0" max="1"></label>
              <button class="g3__btn g3__btn--tiny" @click="mkT = 0.5">1/2</button>
              <button class="g3__btn g3__btn--tiny" @click="mkT = +(1 / 3).toFixed(4)">1/3</button>
              <input v-model="mkName" class="g3__inp g3__inp--sm" :placeholder="nextMarkName()">
              <button class="g3__btn" @click="addMark()">加这个点</button>
            </div>
            <div class="g3__row g3__row--top">
              <span class="g3__tip g3__tip--inline">多点定平面 → 求截面：</span>
              <input v-model="planeText" class="g3__inp" placeholder="如 A C B1">
              <button class="g3__btn" @click="addPlaneCut()">求截面</button>
            </div>
            <div class="g3__row g3__row--top">
              <span class="g3__tip g3__tip--inline">加截面 / 辅助面（顶点名，空格分隔）：</span>
              <input v-model="cutText" class="g3__inp" placeholder="如 A C B1">
              <label class="g3__num"><input v-model="cutFill" type="checkbox"> 填充</label>
              <button class="g3__btn" @click="addCut()">添加截面</button>
            </div>
          </div>
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
.g3__row--top { margin-top: 0; margin-bottom: 8px; }
.g3__sel { flex: 1; min-width: 150px; border: 1px solid var(--border, #ddd); border-radius: 6px; padding: 5px 8px; font-size: 12px; background: #fff; }
.g3__sel--sm { flex: 0 0 auto; min-width: 68px; }
.g3__num { font-size: 12px; color: #555; display: flex; align-items: center; gap: 4px; }
.g3__num input { width: 58px; border: 1px solid var(--border, #ddd); border-radius: 5px; padding: 4px 6px; font-size: 12px; }
.g3__build { margin-top: 12px; padding: 8px 10px; border: 1px dashed var(--border, #ddd); border-radius: 6px; background: #fafafc; }
.g3__tip--inline { margin: 0; }
.g3__inp { flex: 1; min-width: 110px; border: 1px solid var(--border, #ddd); border-radius: 6px; padding: 5px 8px; font-size: 12px; }
.g3__inp--sm { flex: 0 0 auto; width: 52px; min-width: 0; text-align: center; }
.g3__btn--tiny { padding: 3px 6px; font-size: 11px; }
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
