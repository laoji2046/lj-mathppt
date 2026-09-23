<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import AppIcon from './AppIcon.vue'
import { loadMathJax } from '@/composables/useMathJax'
import { imagesDir, isTauri, readLocalImage } from '@/composables/useTauri'
import { libQuery, libRemove, libSave } from '@/composables/useLibrary'
import { useDeckStore } from '@/stores/deck'
import { MATH_FIGURE_OPTIONS } from '@/types'
import { closeFigPalette, openFigPalette } from '@/ui/figPalette'
import { geom3dSink, openGeom3D } from '@/ui/geom3d'
import { vectorizeSink, openVectorize } from '@/ui/vectorize'
import { paperInsertSink, paperPending } from '@/ui/paper'
import type { PaperInsertPayload } from '@/ui/paper'

/**
 * 试卷编辑（A4 分页 + 题号识别），移植自参考版 LJ-PPT 的 PaperMode。
 * - 左侧：输入（# 标题、## 方块标题、### 小标题、1. 大题号、(1) 小题号、$公式$）+ 字体/排版/模板控制。
 * - 右侧：A4 预览（MathJax 渲染公式），支持缩放、插入图片([图N])、保存 PDF。
 */

const emit = defineEmits<{ close: [] }>()

const input = ref('')
/** 图片库：n -> { src 图像源(dataURL或URL), address 地址/文件目录/URL } */
const images = ref<Record<number, { src: string; address?: string; caption?: string }>>({})
const imgSeq = ref(0)
const zoom = ref(1)
const numStyle = ref<'arabic' | 'cn'>('arabic')
const autoNum = ref(true)

const template = ref('')
const fontFamily = ref("'Times New Roman', 'SimSun', serif")
const fontSize = ref(12)
/** 中文字号 → pt */
const CN_FONT_SIZES: { name: string; pt: number }[] = [
  { name: '初号', pt: 42 }, { name: '小初', pt: 36 }, { name: '一号', pt: 26 }, { name: '小一', pt: 24 },
  { name: '二号', pt: 22 }, { name: '小二', pt: 18 }, { name: '三号', pt: 16 }, { name: '小三', pt: 15 },
  { name: '四号', pt: 14 }, { name: '小四', pt: 12 }, { name: '五号', pt: 10.5 }, { name: '小五', pt: 9 },
  { name: '六号', pt: 7.5 }, { name: '小六', pt: 6.5 }, { name: '七号', pt: 5.5 }, { name: '八号', pt: 5 },
]
/** 当前 fontSize 对应的中文字号（无匹配则 '' = 自定义） */
const cnPt = computed(() => CN_FONT_SIZES.find((s) => s.pt === fontSize.value)?.pt ?? '')
function setCnSize(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  if (v !== '') fontSize.value = Number(v)
}
const fontColor = ref('#111111')
const lineHeight = ref(1.7)
const para = ref(6)
const indent = ref(0)
const h2size = ref(18)
const optLayout = ref<'auto' | 'one' | 'two' | 'four'>('auto')
/**
 * **正文分栏**（整篇自动流成 N 栏 ✓ 练习小页最常用 ✓）。
 *
 * ⚠ 与「选项排布 optLayout」不是一回事 ✗ —— 那个只管选择题的 ABCD 怎么摆 ✓，
 *   这个管正文（题目、段落）在页面上分几栏 ✓。
 *
 * 实现要点 ✓：分栏后**每页能装 N 倍内容** ✓，所以分页预算直接乘 N 即可 ✓
 * （不必重写分页逻辑 ✓）；乘 0.96 是留安全余量 —— 浏览器填栏时最后一块常常
 * 塞不进剩余空间会推到下一栏 ✓，用满预算会溢出 ✓。
 */
const bodyCols = ref(1)
/**
 * 分栏填充方式 ✓（两者互斥 ✓ 用户可按场景切 ✓）：
 *   'fill'    = 先填满左栏 ✓ **页面铺满** ✓（右栏可能短 ✓）
 *   'balance' = 两栏等高 ✓ 齐平好看 ✓ 但**内容不满时下方留白** ✗
 * ⚠ 'fill' 必须配合**确定高度** ✗（column-fill:auto 只对定高容器生效 ✓）。
 */
const colFill = ref<'fill' | 'balance'>('fill')
/** 位图 PDF 的图片格式 —— 文字页用 PNG 明显更清晰 ✓，代价是体积大些 ✓（默认 JPEG 省体积 ✓） */
const pdfFmt = ref<'jpeg' | 'png'>('jpeg')
/** 页眉页脚预设模板 —— 一键填好常用栏位 ✓（{page} 会被替换成页码 ✓） */
const HF_PRESETS = [
  { id: '', name: '不使用模板' },
  { id: 'exam', name: '考试卷（学校·科目·分值·姓名学号）', header: 'XX中学 20XX学年 数学试题', footer: '姓名：________　学号：________　得分：______　第 {page} 页' },
  { id: 'lecture', name: '讲义（章节·页码）', header: '第X章　XXXX（讲义）', footer: '第 {page} 页' },
  { id: 'hw', name: '作业（班级·姓名）', header: 'XXXX 作业', footer: '班级：________　姓名：________　第 {page} 页' },
]
function applyHeaderPreset(id: string) {
  const p = HF_PRESETS.find((x) => x.id === id)
  if (!p) return
  headerText.value = p.header || ''
  footerText.value = p.footer || ''
  paperMsg.value = p.id ? '已套用模板：' + p.name : '已清空页眉页脚'
  render()
  saveDraftSoon()
}

/** 总页数 —— 供页眉页脚的 {total} 变量用 ✓（在 paginate 末尾更新 ✓） */
const totalPages = ref(1)

const headerText = ref('')
const footerText = ref('')
const gapQ = ref(6)
const headerGap = ref(0)   // 页眉与顶部边界的距离(px)
const footerGap = ref(0)   // 页脚与底部边界的距离(px)

const pageEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const blankOpen = ref(false)
const blankVal = ref(4)
const blankUnit = ref('cm')
const a4El = ref<HTMLElement | null>(null)

const DEFAULT = '# 函数的奇偶性\n' +
  '## 知识梳理\n' +
  '### 奇偶性定义\n' +
  '1. 设函数 $f(x)$ 定义域为 $D$，对任意 $x\\in D$：\n' +
  '(1) 若 $f(-x)=f(x)$，则 $f(x)$ 为偶函数；\n' +
  '(2) 若 $f(-x)=-f(x)$，则 $f(x)$ 为奇函数。\n' +
  '### 判断步骤\n' +
  '2. 判断 $f(x)=x^2$ 的奇偶性：\n' +
  '(1) 定义域为 $\\mathbb{R}$，关于原点对称。\n' +
  '(2) 计算 $f(-x)=(-x)^2=x^2=f(x)$。\n' +
  '3. 所以 $f(x)=x^2$ 为偶函数。\n' +
  '## 典型例题\n' +
  '1. 已知 $f(x)=\\left\\{\\begin{aligned}-1,x&>0\\\\0,x&=0\\\\1,x&<0\\end{aligned}\\right.$，判断其奇偶性。\n' +
  '### 解答\n' +
  '当 $x>0$ 时 $-x<0$，$f(-x)=-1=-f(x)$；当 $x<0$ 时 $-x>0$，$f(-x)=1=-f(x)$；当 $x=0$ 时 $f(0)=0$。\n' +
  '2. 综上 $f(x)$ 为奇函数。'

const EXAM = '# 数学试卷\n' +
  '## 一、选择题\n' +
  '1. 已知集合 $A=\\{1,2,3\\}$，$B=\\{2,3,4\\}$，则 $A\\cap B=$（　）\n' +
  'A. $\\{1\\}$　B. $\\{2,3\\}$　C. $\\{1,4\\}$　D. $\\{2,4\\}$\n' +
  '2. 若 $f(x)=x^2+1$，则 $f(2)=$（　）\n' +
  'A. $3$　B. $4$　C. $5$　D. $6$\n' +
  '## 二、填空题\n' +
  '3. 函数 $y=\\sin x$ 的最小正周期为______。\n' +
  '4. 若 $a=2$，$b=3$，则 $a^2+b^2=$______。\n' +
  '## 三、解答题\n' +
  '5. 已知 $f(x)=x^2-2x+1$，求 $f(3)$。\n' +
  '### 解答\n' +
  '（1）代入得 $f(3)=3^2-2\\times 3+1=9-6+1=4$。\n' +
  '（2）所以 $f(3)=4$。\n' +
  '6. 在 $\\triangle ABC$ 中，$\\angle A=30^\\circ$，$\\angle B=60^\\circ$，求 $\\angle C$。\n' +
  '### 解答\n' +
  '$\\angle C=180^\\circ - \\angle A-\\angle B=180^\\circ-30^\\circ-60^\\circ=90^\\circ$。'
const EXAM19 = '# 高三数学试卷\n' +
  '## 一、选择题（每题 5 分，共 40 分）\n' +
  '1. 已知 $A=\\{1,2,3\\}$，$B=\\{2,3,4\\}$，则 $A\\cap B=$（　）\n' +
  'A. $\\{1\\}$　B. $\\{2,3\\}$　C. $\\{1,4\\}$　D. $\\{2,4\\}$\n' +
  '2. 若 $f(x)=x^2-2x$，则 $f(3)=$（　）\n' +
  'A. $1$　B. $3$　C. $5$　D. $6$\n' +
  '3. 已知 $\\sin\\alpha=\\frac{3}{5}$，且 $\\alpha$ 为第二象限角，则 $\\cos\\alpha=$（　）\n' +
  'A. $-\\frac{4}{5}$　B. $\\frac{4}{5}$　C. $-\\frac{3}{5}$　D. $\\frac{3}{5}$\n' +
  '4. 等差数列 $\\{a_n\\}$ 中 $a_1=2$，$a_3=6$，则 $a_5=$（　）\n' +
  'A. $8$　B. $10$　C. $12$　D. $14$\n' +
  '5. 函数 $y=\\sqrt{x-1}+\\frac{1}{x-2}$ 的定义域为（　）\n' +
  'A. $[1,2)\\cup(2,+\\infty)$　B. $(1,+\\infty)$　C. $[1,+\\infty)$　D. $[1,2]$\n' +
  '6. 从 5 名学生中选 2 名参加活动，不同的选法有（　）\n' +
  'A. $5$　B. $10$　C. $15$　D. $20$\n' +
  '7. 已知向量 $\\vec{a}=(1,2)$，$\\vec{b}=(3,-1)$，则 $\\vec{a}\\cdot\\vec{b}=$（　）\n' +
  'A. $1$　B. $2$　C. $3$　D. $5$\n' +
  '8. 若 $f(x)=x^3-3x$，则 $f\'(2)=$（　）\n' +
  'A. $6$　B. $9$　C. $12$　D. $15$\n' +
  '## 二、多选题（每题 5 分，共 15 分；多选全对得 5 分，漏选得 2 分）\n' +
  '9. 下列函数中，在 $(0,+\\infty)$ 上为增函数的有（　）\n' +
  'A. $y=x^2$　B. $y=\\frac{1}{x}$　C. $y=2^x$　D. $y=\\log_2 x$\n' +
  '10. 已知 $\\triangle ABC$ 中 $a=3$，$b=4$，$\\sin A=\\frac{1}{2}$，则 $\\angle B$ 可能为（　）\n' +
  'A. $30^\\circ$　B. $60^\\circ$　C. $90^\\circ$　D. $150^\\circ$\n' +
  '11. 下列命题中正确的是（　）\n' +
  'A. 垂直于同一直线的两直线平行　B. 垂直于同一平面的两直线平行　C. 平行于同一平面的两直线平行　D. 平行于同一平面的两平面平行\n' +
  '## 三、填空题（每题 5 分，共 15 分）\n' +
  '12. 等差数列 $\\{a_n\\}$ 中 $a_1=1$，$d=2$，则 $S_{10}=$______。\n' +
  '13. 若点 $P(2,3)$ 到直线 $x-2y+1=0$ 的距离为______。\n' +
  '14. 掷一枚均匀硬币两次，恰好一次正面朝上的概率为______。\n' +
  '## 四、解答题（共 80 分）\n' +
  '15. （14 分）已知 $\\sin\\alpha=\\frac{3}{5}$，$\\alpha\\in(0,\\frac{\\pi}{2})$，求 $\\cos\\alpha$ 与 $\\sin2\\alpha$。\n' +
  '### 解答\n' +
  '（1）由 $\\sin^2\\alpha+\\cos^2\\alpha=1$ 得 $\\cos\\alpha=\\sqrt{1-\\frac{9}{25}}=\\frac{4}{5}$。\n' +
  '（2）$\\sin2\\alpha=2\\sin\\alpha\\cos\\alpha=2\\times\\frac{3}{5}\\times\\frac{4}{5}=\\frac{24}{25}$。\n' +
  '16. （14 分）已知等差数列 $\\{a_n\\}$，$a_1=2$，$a_3=6$，求通项 $a_n$ 与前 $n$ 项和 $S_n$。\n' +
  '### 解答\n' +
  '（1）公差 $d=\\frac{a_3-a_1}{2}=2$，$a_n=2+2(n-1)=2n$。\n' +
  '（2）$S_n=\\frac{n(2+2n)}{2}=n(n+1)$。\n' +
  '17. （16 分）在直三棱柱 $ABC-A_1B_1C_1$ 中，$AB\\perp AC$，$AB=AC=2$，$AA_1=4$，求直线 $AB$ 与平面 $A_1BC$ 所成角的正弦值。\n' +
  '### 解答\n' +
  '（1）以 $A$ 为原点，$AB$、$AC$、$AA_1$ 为 $x,y,z$ 轴建系，$B=(2,0,0)$，$C=(0,2,0)$，$A_1=(0,0,4)$。\n' +
  '（2）易得平面 $A_1BC$ 的法向量 $\\vec{n}=(2,2,1)$，故 $\\sin\\theta=\\frac{|\\vec{n}\\cdot\\vec{AB}|}{|\\vec{n}|\\,|\\vec{AB}|}=\\frac{2}{3}$。\n' +
  '18. （18 分）已知 $f(x)=x^3-3x^2+1$，求函数的单调区间与极值。\n' +
  '### 解答\n' +
  '（1）$f\'(x)=3x^2-6x=3x(x-2)$，故 $f$ 在 $(-\\infty,0),(2,+\\infty)$ 递增，在 $(0,2)$ 递减。\n' +
  '（2）极大值 $f(0)=1$，极小值 $f(2)=-3$。\n' +
  '19. （18 分）已知椭圆 $\\frac{x^2}{a^2}+\\frac{y^2}{b^2}=1$ 过点 $(2,0)$，离心率 $e=\\frac{1}{2}$，求椭圆方程。\n' +
  '### 解答\n' +
  '（1）由 $a=2$，$e=\\frac{c}{a}=\\frac{1}{2}$ 得 $c=1$，$b^2=a^2-c^2=3$。\n' +
  '（2）所以椭圆方程为 $\\frac{x^2}{4}+\\frac{y^2}{3}=1$。\n'

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function optHtml(opts: { key: string; text: string }[], layout: string) {
  const cls = layout && layout !== 'auto' ? ' paper-opt-' + layout : ''
  return '<div class="paper-options' + cls + '">' +
    opts.map((o) => '<span class="paper-opt"><i>' + o.key + '.</i>' + o.text + '</span>').join('') +
    '</div>'
}
function autoLayoutOptions() {
  const el = pageEl.value
  if (!el) return
  const blocks = Array.from(el.querySelectorAll('.paper-options')) as HTMLElement[]
  blocks.forEach((b) => {
    if (b.classList.contains('paper-opt-one') || b.classList.contains('paper-opt-two') || b.classList.contains('paper-opt-four')) return
    const opts = Array.from(b.querySelectorAll('.paper-opt')) as HTMLElement[]
    if (!opts.length) return
    // ⚠ 量「内容真实宽度」要用 scrollWidth ✗ 而不是 offsetWidth —— 默认 flex 布局会把选项
    //   **挤扁** ✓（实测 14 字选项被压到 112px ✓），用它判断会以为两栏放得下 ✓ → 选成 two
    //   → 选项在窄栏里折成两行 ✗（用户截图实测 ✓）。scrollWidth 不受挤压影响 ✓。
    const widths = opts.map((o) => Math.max(o.offsetWidth, o.scrollWidth))
    const total = widths.reduce((s, x) => s + x, 0)
    // ⚠ 必须优先用**元素自身**的宽度 ✗ —— 分栏时 .paper-options 处在某一栏内 ✓，
    //   它的 clientWidth 就是**栏宽** ✓；而 parentElement(.paper-cols) 的宽度是**整页宽** ✗，
    //   拿后者判断就会以为位置很宽 ✓ → 选成四列 → 选项挤爆折行 ✓（用户截图实测 ✓）。
    const cw = b.clientWidth || (b.parentElement as HTMLElement | null)?.clientWidth || 300
    const gap = 16
    if (total + gap * (widths.length - 1) <= cw) b.classList.add('paper-opt-one')
    else if (Math.max(...widths) <= cw / 2) b.classList.add('paper-opt-two')
    else b.classList.add('paper-opt-four')
    // ⚠ 自纠 ✗：上面的宽度判断并不可靠 ✓（默认 flex 会把选项挤扁 ✓，量到的是被压后的宽度 ✓，
    //   而文字其实是在选项**内部**折行的 ✓ —— scrollWidth 也量不出来 ✓）。
    //   所以套上排布后**直接量高度** ✓：只要有一个选项被折成两行 ✓ 就说明这个排布放不下 ✓，
    //   退回一栏 ✓。这条不依赖任何宽度估算 ✓，最稳 ✓。
    requestAnimationFrame(() => {
      // ⚠ 基准不能取 opts[0] 的高度 ✗ —— 若四个选项都被折行 ✓，它本身就是 42 ✓，
      //   那么 42 > 42*1.6 永远为假 ✓，自纠永远不触发 ✓（我第一版就是这么错的 ✓）。
      //   改为**从字号算单行高度** ✓，与折没折行无关 ✓。
      const cs = getComputedStyle(opts[0])
      const fsz = parseFloat(cs.fontSize) || 16
      const lh = parseFloat(cs.lineHeight)
      const single = (isNaN(lh) ? fsz * 1.4 : lh) + 8   // 8 = 上下内边距/边框余量
      const wrapped = opts.some((o) => o.offsetHeight > single * 1.45)
      if (wrapped && !b.classList.contains('paper-opt-one')) {
        b.classList.remove('paper-opt-two', 'paper-opt-four')
        b.classList.add('paper-opt-one')
      }
    })
  })
}

/** 解析段落格式前缀 {c:颜色; s:字号; f:字体; b; i}：返回去掉前缀的文本 + 内联样式 */
function stripOpts(t: string): { rest: string; style: string } {
  const m = t.match(/^\{\s*([^}]*)\}\s*(.*)$/)
  if (!m) return { rest: t, style: '' }
  const raw = m[1], rest = m[2]
  const css: string[] = []
  raw.split(';').forEach((part) => {
    const p = part.trim()
    if (p === 'b') { css.push('font-weight:700'); return }
    if (p === 'i') { css.push('font-style:italic'); return }
    const ar = p.match(/^([a-zA-Z]+)\s*[:=]\s*(.*)$/)
    if (!ar) return
    const k = ar[1].toLowerCase(), v = ar[2].trim()
    if (k === 'c') {
      let cv = v
      if (/^#[a-zA-Z]{2,20}$/.test(cv)) cv = cv.slice(1) // #red -> red（容忍带 # 的颜色名）
      if (/^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{2,20}|rgb\([^)]+\)|rgba\([^)]+\))$/.test(cv)) css.push('color:' + cv)
    }
    else if (k === 's') {
      const num = parseFloat(v)
      if (!isNaN(num)) css.push('font-size:' + num + 'pt')
      else { const cn = CN_FONT_SIZES.find((s2) => s2.name === v); if (cn) css.push('font-size:' + cn.pt + 'pt') }
    }
    else if (k === 'f') css.push('font-family:"' + v + '"')
    else if (k === 'b') css.push('font-weight:700')
    else if (k === 'i') css.push('font-style:italic')
  })
  return { rest, style: css.join(';') }
}

/** 把 Markdown 图片 ![alt](src) 转成 [图N:alt]，并注册到图片库（src 相同则复用同一图号） */
function normalizeMdImages(src: string): string {
  return String(src).replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, cap: string, url: string) => {
    const u = (url || '').trim()
    if (!u) return _m
    const exist = Object.keys(images.value).find((k) => images.value[Number(k)] && images.value[Number(k)].src === u)
    let n = exist
    if (!n) { n = String(++imgSeq.value); images.value[Number(n)] = { src: u, address: u, caption: cap || undefined } }
    return '[图' + n + (cap ? ':' + cap : '') + ']'
  })
}
function parse(src: string): string {
  if (!src) return ''
  src = normalizeMdImages(src)
  let out = ''
  const lines = String(src).split(/\n/)
  const cn = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  let qNo = 0
  let sec: 'single' | 'multi' | 'fill' | 'solve' = 'single'
  let pendingOpt = ''
  // 引号常量：生成 HTML 时用 ✓ —— 若直接写引号会和模板/字符串语法打架 ✓（吃过亏 ✗）
  const Q1 = String.fromCharCode(39)
  const Q2 = String.fromCharCode(34)

  // 题目块缓冲：null = 不在题目块内 ✓（详见下面的 [题] 标记处说明 ✓）
  let qBuf: { stem: string[]; opts: string[]; sol: string[] | null; inOpts: boolean } | null = null
  /** 把缓冲的题目内容拼成**一个** .pp-block ✓（解析区默认收起，打印时强制展开 ✓） */
  const emitQ = () => {
    if (!qBuf) return ''
    const q = qBuf
    qBuf = null
    const seg = (lines: string[], cls: string) =>
      lines.length ? '<div class=' + Q2 + 'paper-q__' + cls + Q2 + '>' + lines.map((s) => esc(s)).join('<br/>') + '</div>' : ''
    const sol = q.sol && q.sol.length
        ? '<div class=' + Q2 + 'paper-q__sol' + Q2 + ' onclick=' + Q2 + 'this.classList.toggle(' + Q1 + 'paper-q__sol--open' + Q1 + ')' + Q2 + '>'
          + '<div class=' + Q2 + 'paper-q__solbar' + Q2 + '>解析（点这里展开 / 收起）</div>'
          + '<div class=' + Q2 + 'paper-q__solbody' + Q2 + '>' + q.sol.map((s) => esc(s)).join('<br/>') + '</div></div>'
        : ''
    return '<div class=' + Q2 + 'pp-block paper-q' + Q2 + '>' + seg(q.stem, 'stem') + seg(q.opts, 'opts') + sol + '</div>'
  }

  const blk = (h: string, st = '') => '<div class="pp-block"' + (st ? ' style="' + st + '"' : '') + '>' + h + '</div>'
  for (let i = 0; i < lines.length; i++) {
    let t = lines[i].trim()
    if (!t) continue
    const so = stripOpts(t)
    t = so.rest
    const st = so.style
    // ── 题目块：[题] … [选项] … [解析] … [/题] ──────────────────────
    // ⚠ 位置很关键 ✗：必须在这个循环体**最外层** ✓ —— 我第一次插进了 `if (sp) {…}` 花括号里 ✗，
    //   结果只有 [4cm] 那种行才会走到 ✓，标记全被当普通文字打出来了 ✗（截图看得很清楚 ✓）。
    // 为什么要题目块 ✗：分页按 flow.children 逐个块搬 ✓（见 paginate）—— 题干/选项/解析散成
    //   多个块会被拆到两页中间 ✗；做成**一个块**就不会 ✓。
    if (/^\[题\]$/.test(t)) { if (qBuf) out += emitQ(); qBuf = { stem: [], opts: [], sol: null, inOpts: false }; continue }
    if (/^\[\/题\]$/.test(t)) { if (qBuf) { out += emitQ(); qBuf = null } continue }
    if (/^\[选项\]$/.test(t)) { if (qBuf) { qBuf.inOpts = true; qBuf.sol = null } continue }
    if (/^\[解析\]$/.test(t)) { if (qBuf) { qBuf.sol = []; qBuf.inOpts = false } continue }
    if (qBuf) {
      if (qBuf.sol) qBuf.sol.push(t)
      else if (qBuf.inOpts) qBuf.opts.push(t)
      else qBuf.stem.push(t)
      continue
    }
    // 手动分页：[换页] 或 [分页]
    if (/^\[(换页|分页)\]$/.test(t)) { out += '<div class="page-break"></div>'; continue }
    // 指定高度空白：[4cm] / [4厘米] / [10mm] / [10毫米]
    const sp = t.match(/^\[\s*([\d.]+)\s*(cm|厘米|毫米|mm)\s*\]\s*$/)
    if (sp) {
      const unit = sp[2] === '厘米' ? 'cm' : sp[2] === '毫米' ? 'mm' : sp[2]
      out += blk('<div class="paper-space" style="height:' + sp[1] + unit + '"></div>', st)
      continue
    }
    let m: RegExpMatchArray | null
    if (/^###\s+\S/.test(t)) { m = t.match(/^###\s+(.*)$/); out += blk('<div class="paper-sub">' + esc(m![1]) + '</div>', st); continue }
    if (/^##\s+\S/.test(t)) {
      m = t.match(/^##\s+(.*)$/)
      const pt = m![1]
      if (/多选/.test(pt)) sec = 'multi'
      else if (/填空/.test(pt)) sec = 'fill'
      else if (/解答/.test(pt)) sec = 'solve'
      else if (/选择|单项/.test(pt)) sec = 'single'
      out += blk('<div class="paper-sec-title">' + esc(pt) + '</div>', st)
      continue
    }
    if (/^#\s+\S/.test(t)) { m = t.match(/^#\s+(.*)$/); out += blk('<h2>' + esc(m![1]) + '</h2>', st); continue }
    m = t.match(/^([0-9一二三四五六七八九十]+)[.、]\s*([\s\S]*)/)
    if (m) {
      qNo++
      let num = m[1]
      if (autoNum.value) num = numStyle.value === 'cn' ? (cn[qNo - 1] || String(qNo)) : String(qNo)
      // 每题手动排版标记：[1行]/[2行]/[4行]（或 [一/两/四行]）写在题干末尾
      pendingOpt = ''
      let qText = m[2]
      const mk = qText.match(/\[([0-9一二两四]+)\s*行\]\s*$/)
      if (mk) {
        const mv = mk[1]
        pendingOpt = (mv === '1' || mv === '一') ? 'one' : (mv === '2' || mv === '两' || mv === '二') ? 'two' : 'four'
        qText = qText.slice(0, -mk[0].length).trim()
      }
      let tag = sec === 'multi' ? '<span class="paper-q-tag">多选</span>' : ''
      let qHtml = esc(qText)
      if (sec === 'fill') qHtml = qHtml.replace(/_{2,}/g, '<span class="paper-fillblank"></span>')
      out += blk('<div class="paper-q"><span class="paper-q-num">' + num + '.</span> ' + (tag ? tag + ' ' : '') + qHtml + '</div>', st)
      continue
    }
    let sub = -1, body = ''
    m = t.match(/^[（(]([0-9一二三四五六七八九十]+)[)）]\s*([\s\S]*)/)
    if (m) { sub = parseInt(m[1], 10); body = m[2] }
    if (sub >= 0) {
      const num = numStyle.value === 'cn' ? (cn[sub - 1] || String(sub)) : String(sub)
      out += blk('<div class="paper-subq">（' + num + '）' + esc(body) + '</div>', st)
      continue
    }
    // 选择题选项：一行内 A.…B.…C.…D.…，或连续的 A./B./C./D. 行（最多 4 项）→ 分组自动排版
    const inlineOpts = t.match(/([A-Da-d])[.、．]\s*([\s\S]*?)(?=\s*[A-Da-d][.、．]|$)/g)
    if (inlineOpts && inlineOpts.length >= 4) {
      const opts = inlineOpts.map((o) => {
        const mm = o.match(/^([A-Da-d])[.、．]\s*(.*)$/)!
        return { key: mm[1].toUpperCase(), text: esc(mm[2].trim()) }
      })
      out += blk(optHtml(opts, pendingOpt || optLayout.value), st)
      continue
    }
    if (/^[A-Da-d][.、．]\s*/.test(t)) {
      const opts: { key: string; text: string }[] = []
      for (let j = i; j < lines.length && opts.length < 4; j++) {
        const l2 = lines[j].trim()
        const mm = l2.match(/^([A-Da-d])[.、．]\s*(.*)$/)
        if (!mm) break
        opts.push({ key: mm[1].toUpperCase(), text: esc(mm[2].trim()) })
        i = j
      }
      if (opts.length) { out += blk(optHtml(opts, pendingOpt || optLayout.value), st); continue }
    }
    out += blk('<p class="paper-par">' + esc(t) + '</p>', st)
  }
  return out
}

/** 打包(Tauri)时把相对图片路径转成资产协议，可读 exe 同级的 images/（作为内嵌 data URL 失败时的兜底） */
function assetUrl(u: string): string {
  if (!u) return u
  if (/^(https?:|data:|blob:|asset:|file:|[a-zA-Z]:\\)/.test(u)) return u
  const w = typeof window !== 'undefined' ? (window as any) : {}
  const packaged = w.location && (w.location.protocol === 'tauri:' || w.location.protocol === 'http:' && (('__TAURI_INTERNALS__' in w) || w.__TAURI__))
  if (!packaged) return u
  const p = u.replace(/^\/+/, '')
  // 资产协议：http://asset.localhost/<path>（对中文/空格文件名 encodeURI）
  return 'http://asset.localhost/' + encodeURI(p)
}

/** 相对图片路径 → 内嵌 data URL 的缓存（打包后由 Rust 读 exe 同级任意子目录得到） */
const imgCache = ref<Record<string, string>>({})
const imgDirHint = ref('')
const imgLoading = ref(false)

/** 判断是否为「需要读本地磁盘」的相对路径（网络图 / data / 绝对路径直接放行） */
function isLocalRel(u: string): boolean {
  return !!u && !/^(https?:|data:|blob:|asset:|file:|[a-zA-Z]:\\)/.test(u)
}

/**
 * 预加载正文里所有本地图片：打包后前端跑在内存页里，相对路径够不着磁盘，
 * 这里统一通过 Rust 按 exe 同级相对路径读取（images/、pic/ 等任意子目录均可）
 * 并转成 data URL 缓存起来。
 */
async function preloadImages() {
  if (!isTauri()) return
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g
  const todo: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(input.value))) {
    const u = (m[2] || '').trim()
    if (!isLocalRel(u) || imgCache.value[u]) continue
    if (!todo.includes(u)) todo.push(u)
  }
  if (!todo.length) return
  imgLoading.value = true
  try {
    await Promise.all(
      todo.map(async (u) => {
        const d = await readLocalImage(u)
        if (d) imgCache.value[u] = d
      }),
    )
  } finally {
    imgLoading.value = false
  }
}

/** 图片最终 src：优先内嵌 data URL，其次资产协议，最后原样（浏览器 dev 走相对路径） */
function imgSrcFor(u: string): string {
  return imgCache.value[u] || assetUrl(u)
}
function imageHtml(html: string): string {
  return html.replace(/\[图(\d+)((?::[^\[\]:=]+)*)\]/g, (_m0, n: string, params: string) => {
    const im = images.value[Number(n)]
    if (!im) return '<span style="color:#c00">[图片缺失图' + n + ']</span>'
    const url = im.src
    const src = imgSrcFor(url)
    let align = '', width = '', rotate = '', float = '', caption = ''
    ;(params || '').split(':').forEach((p) => {
      if (!p) return
      if (p === 'center' || p === 'left' || p === 'right') align = p
      else if (p === 'float') float = 'right'
      else if (p === 'floatleft') float = 'left'
      else if (/^\d+%$/.test(p)) width = 'max-width:' + p + ';'
      else if (/^-?\d+$/.test(p)) rotate = 'transform:rotate(' + p + 'deg);'
      else caption = p
    })
    const imgStyle = rotate ? 'style="' + rotate + '"' : ''
    const figWidth = width ? 'width:' + width.replace('max-width:', '') + ';' : 'width:fit-content;'
    const figImg = width ? 'width:100%;' : ''
    const mk = (mm: string) => '<figure class="paper-fig" style="' + figWidth + mm + '"><img class="paper-img" style="' + figImg + rotate + '" src="' + src + '" />' +
      (caption ? '<figcaption class="paper-figcap">' + esc(caption) + '</figcaption>' : '') + '</figure>'
    if (float) {
      const s = float === 'left' ? 'float:left;margin:0 10px 8px 0;' : 'float:right;margin:0 0 8px 10px;'
      return '<figure class="paper-fig paper-float-fig" style="' + figWidth + s + '"><img class="paper-float-img" style="' + figImg + rotate + '" src="' + src + '" />' +
        (caption ? '<figcaption class="paper-figcap">' + esc(caption) + '</figcaption>' : '') + '</figure>'
    }
    if (align) {
      let mm = 'margin-left:auto;margin-right:auto;'
      if (align === 'left') mm = 'margin-right:auto;margin-left:0;'
      else if (align === 'right') mm = 'margin-left:auto;margin-right:0;'
      return '<div class="paper-imgbox">' + mk(mm) + '</div>'
    }
    if (caption) return '<div class="paper-imgbox">' + mk('margin-left:auto;margin-right:auto;') + '</div>'
    return '<img class="paper-img-inline" ' + imgStyle + ' src="' + src + '" />'
  })
}

async function render() {
  const el = pageEl.value
  if (!el) return
  await preloadImages()   // 打包后先把本地图读成内嵌 data URL，再生成 HTML
  if (a4El.value) { a4El.value.style.zoom = '1' }   // 先重置缩放，避免上轮 zoom 影响选项测宽
  zoom.value = 1
  const html = imageHtml(parse(input.value)) || '<p style="color:#999">输入内容后在此预览 A4 排版</p>'
  el.innerHTML = html
  try {
    await loadMathJax()
    if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
      try { await window.MathJax.typesetPromise([el]) } catch { /* 忽略 */ }
    }
  } catch { /* 不阻塞 */ }
  refreshLayout()
}

function applyFont(el: HTMLElement | null = pageEl.value) {
  if (!el) return
  el.style.fontFamily = fontFamily.value
  el.style.fontSize = fontSize.value + 'pt'
  el.style.color = fontColor.value
}
function applyLayout(el: HTMLElement | null = pageEl.value) {
  if (!el) return
  el.style.lineHeight = String(lineHeight.value)
  el.style.setProperty('--paper-para', String(para.value))
  el.style.setProperty('--paper-cols', String(bodyCols.value))  // ⚠ 多栏容器**必须有确定高度** ✗ —— 否则 column-fill:auto 不生效 ✓，
  //   浏览器会退回默认的 balance（两栏均分 ✓），就不是「先填满左栏再进右栏」了 ✓。
  const hh = headerText.value ? 42 + (headerGap.value || 0) : 0
  const fh = footerText.value ? 34 + (footerGap.value || 0) : 0
  el.style.setProperty('--paper-body-h', String(Math.max(200, 986 - hh - fh)) + 'px')
  el.style.setProperty('--paper-indent', String(indent.value))
  el.style.setProperty('--paper-h2', String(h2size.value) + 'pt')
  el.style.setProperty('--paper-qgap', String(gapQ.value || 6) + 'px')
  el.style.setProperty('--paper-headergap', String(headerGap.value || 0) + 'px')
  el.style.setProperty('--paper-footergap', String(footerGap.value || 0) + 'px')
  const h2 = el.querySelector('h2') as HTMLElement | null
  if (h2) h2.style.fontSize = h2size.value + 'pt'
}
function refreshLayout() {
  applyFont(); applyLayout()
  autoLayoutOptions()
  paginate()
  setTimeout(fitZoom, 40)
}
function paginate() {
  const flow = pageEl.value
  const a4 = a4El.value
  if (!flow || !a4) return
  const blocks = Array.from(flow.children) as HTMLElement[]
  const headerH = headerText.value ? 42 + (headerGap.value || 0) : 0
  const footerH = footerText.value ? 34 + (footerGap.value || 0) : 0
  const capH = Math.round((986 - headerH - footerH) * bodyCols.value * 0.96)   // 分栏后每页能装 N 倍 ✓（0.96 是安全余量 ✓）
  // ⚠ 量高度必须在「**栏宽**」下量 ✗ —— 分栏后每个块变窄 ✓ → 文字折行变多 ✓ →
  //   高度比单栏宽度下量的更高 ✓。按单栏宽度量会**低估** ✓，内容装不下就溢出成第 3 栏 ✗
  //   （用户实测截图为证 ✓）。这里把 flow 的宽度临时改成栏宽 ✓，量完再还原 ✓。
  const prevFlowW = flow.style.width
  if (bodyCols.value > 1) {
    const fullW = flow.clientWidth || flow.getBoundingClientRect().width || 794
    flow.style.width = Math.max(120, Math.floor(fullW / bodyCols.value)) + 'px'
  }
  const heights = blocks.map((b) => b.offsetHeight)
  if (bodyCols.value > 1) flow.style.width = prevFlowW
  const pages: HTMLElement[][] = []
  let cur: HTMLElement[] = [], curH = 0
  blocks.forEach((b, idx) => {
    if (b.classList.contains('page-break')) { if (cur.length) { pages.push(cur); cur = []; curH = 0 } return }
    const h = heights[idx] + 3
    if (curH + h > capH && cur.length) { pages.push(cur); cur = []; curH = 0 }
    cur.push(b); curH += h
  })
  if (cur.length) pages.push(cur)
  if (!pages.length) pages.push([])
  // ⚠ 关键一步 ✗：页面是**用 outerHTML 复制**过去的 ✓，而 MathJax 的渲染是异步的 ✓ ——
  //   一旦时序没对上 ✓，页面里就会留下未渲染的原始 $…$ ✗
  //   （用户实测：一栏很美 ✓、两栏出现字面 SC_{1} ✗）。
  //   所以在**组装完成后的页面上**再渲染一次 ✓，与复制时序无关 ✓。
  //   MathJax 对已渲染的节点会跳过 ✓，重复调用无害 ✓。
  void typesetPages()
  if (totalPages.value !== pages.length) totalPages.value = pages.length
  const mkPage = (blks: HTMLElement[], pno: number) => {
    const pg = document.createElement('div')
    pg.className = 'paper-page'
    const pv = String(pno), total = String(pages.length)
    const head = headerText.value
      ? '<div class="paper-header">' + imageHtml(esc(headerText.value.replace(/\{page\}/g, pv).replace(/\{total\}/g, String(totalPages.value)).replace(/\{total\}/g, total))) + '</div>'
      : ''
    const foot = footerText.value
      ? '<div class="paper-footer">' + imageHtml(esc(footerText.value.replace(/\{page\}/g, pv).replace(/\{total\}/g, String(totalPages.value)).replace(/\{total\}/g, total))) + '</div>'
      : ''
    // ⚠ 栏数与每栏高度**直接写在容器上** ✗ —— 不走 --paper-cols 变量链 ✓。
    //   实测变量链有一环没生效 ✓（容器 columnCount 仍是 1 ✓），直写最稳 ✓。
    // ⚠ 970 而不是 986 ✓ —— 实测 986 会让栏高比页面可用高多约 3% ✓ 容易顶出页面 ✓
    // ⚠ 一栏时**绝不能**用 column-fill:auto + 固定高度 ✗ ——
    //   多栏容器在内容超过高度时会**继续开新栏** ✓ → 选了一栏却挤出第二栏/被截断 ✓
    //   （用户实测：**双栏正常、一栏不正常** ✗）。一栏就走普通流动 ✓。
    const bh = Math.max(200, 970 - (headerText.value ? 42 + (headerGap.value || 0) : 0) - (footerText.value ? 34 + (footerGap.value || 0) : 0))
    const colsStyle = bodyCols.value > 1 && colFill.value === 'fill'
      ? 'column-count:' + bodyCols.value + ';column-fill:auto;height:' + bh + 'px;'
      : 'column-count:' + bodyCols.value + ';column-fill:balance;'
    // ⚠ 一栏时**根本不套多栏容器** ✗ —— 这样一栏就与「分栏功能出现之前」完全一致 ✓，
    //   那些 column-* 规则一条都不生效 ✓（用户要求：把一栏的正常状态恢复过来 ✓）。
    //   ⭐ 双栏的可用配置（用户确认正常 ✓）记录在 docs/分栏配置-基准.md ✓。
    const inner = blks.map((b) => b.outerHTML).join('')
    pg.innerHTML = head + (bodyCols.value > 1
      ? '<div class="paper-cols" style="' + colsStyle + '">' + inner + '</div>'
      : inner) + foot
    applyFont(pg); applyLayout(pg)
    return pg
  }
  a4.innerHTML = ''
  pages.forEach((pb, i) => a4.appendChild(mkPage(pb, i + 1)))
}
/** 在**组装好的页面**上渲染公式 ✓ —— 补上 outerHTML 复制与异步渲染之间的时序缝隙 ✓ */
async function typesetPages() {
  const a4 = a4El.value
  const mj = (window as unknown as { MathJax?: { typesetPromise?: (n: HTMLElement[]) => Promise<void> } }).MathJax
  if (!a4 || !mj || typeof mj.typesetPromise !== 'function') return
  try { await mj.typesetPromise([a4]) } catch { /* 不能让公式渲染失败影响排版 ✓ */ }
}

function fitZoom() {
  const a4 = a4El.value
  const page = a4?.querySelector('.paper-page') as HTMLElement | null
  if (!a4 || !page) return
  const pw = page.offsetWidth || 794
  const aw = a4.clientWidth || 500
  const scale = Math.min(1, Math.max(0.3, (aw - 28) / pw))
  a4.style.zoom = String(scale)
  zoom.value = scale
}
function zoomBy(d: number) {
  zoom.value = Math.min(3, Math.max(0.3, zoom.value + d))
  if (a4El.value) a4El.value.style.zoom = String(zoom.value)
}
function zoomReset() { zoom.value = 1; if (a4El.value) a4El.value.style.zoom = '1' }

function applyTemplate(key: string) {
  template.value = key
  if (key === 'handout') input.value = DEFAULT
  else if (key === 'exam') input.value = EXAM
  else if (key === 'exam19') input.value = EXAM19
  else input.value = ''
  render()
}

const helpOpen = ref(false)
const HELP: { title: string; ex: { code: string; desc: string }[] }[] = [
  { title: '标题', ex: [
    { code: '# 大标题', desc: '居中大标题' },
    { code: '## 章节标题', desc: '粗体无框章节标题' },
    { code: '### 小标题', desc: '粗体小标题' },
  ]},
  { title: '题目与选项', ex: [
    { code: '1. 题干…\nA. …　B. …　C. …　D. …', desc: '选择题：题号自动编号，A-D 自动排版' },
    { code: '1. 题干…（　）[两行]\nA. …　B. …　C. …　D. …', desc: '题干末尾 [一行]/[两行]/[四行] 控制选项排版' },
    { code: '（1）小问内容', desc: '小题号' },
  ]},
  { title: '公式', ex: [
    { code: '已知 $f(x)=x^2$，求 $f(2)$', desc: '行内 $...$；独立公式 $$...$$' },
  ]},
  { title: '图片', ex: [
    { code: '![图注](images/a.png)　![图:center](https://…/b.jpg)', desc: 'Markdown 图片语法：![图注](地址)，自动注册到图片库（地址复用同一图号）' },
    { code: '![图2:floatleft:50%](images/4题.jpg)', desc: '图注「图2」+ 左浮动 + 最大宽度 50%' },
    { code: '![图:center:60%](images/x.png)', desc: '居中 + 宽度 60%' },
    { code: '![图:right](images/x.png)　![图:45](images/x.png)', desc: '右对齐 / 旋转 45°' },
    { code: '[图1]　[图2:center]　[图3:60%]　[图4:45]　[图5:图注文字]', desc: '传统 [图N] 标记：center/left/right 对齐；float 右浮、floatleft 左浮；宽度%(如 60%)；角度(如 45)；其余为图注' },
  ]},
      { title: '题目块（题干 / 选项 / 解析）', ex: [
        {
          code: '[题]\n3. 已知 f(x)=x^2-2x+1，求它的最小值。\n[选项]\nA. 0　B. 1　C. -1　D. 2\n[解析]\n配方得 f(x)=(x-1)^2，故最小值为 0。\n[/题]',
          desc: '整块**不会被分页拆开**（题干/选项/解析永远在同一页）；解析默认收起、点一下展开，**打印时自动展开**',
        },
        {
          code: '[题] 只写题干也可以\n[/题]　　[选项] / [解析] 都可省略',
          desc: '块内支持 $…$ 公式与 [图N] 插图；[题] 未写 [/题] 时会在下一个 [题] 或文末自动收尾',
        },
      ] },
  { title: '空白与分页', ex: [
    { code: '[换页]　[4cm]　[10mm]', desc: '手动分页 / 指定高度空白（cm 或 mm）' },
  ]},
  { title: '段落样式', ex: [
    { code: '{c:red; s:16; f:楷体; b; i} 这段内容', desc: '设置本段颜色/字号/字体/加粗/斜体' },
    { code: '{c:#ff0000; b} 2. 题目…', desc: '颜色支持 #ff0000、red、#red、rgb()' },
  ]},
  { title: '多选 / 填空', ex: [
    { code: '## 二、多选题\n9. …\nA. …　B. …　C. …　D. …', desc: '多选节题目自动加「多选」标签' },
    { code: '## 三、填空题\n12. … =____', desc: '填空节下划线自动变成答题横线' },
  ]},
  { title: '页眉页脚', ex: [
    { code: '页眉：某中学 [图N]\n页脚：第 {page} 页 / 共 {total} 页', desc: '支持 [图N] 与页码变量；页眉顶距/页脚底距可调' },
  ]},
  { title: '字号', ex: [
    { code: '中文字号下拉 或 直接输入数字', desc: '初号=42 … 一号=26 四号=14 小四=12 五号=10.5 八号=5' },
  ]},
]
function loadHelpDemo() {
  input.value = '# 示例讲义\n## 知识梳理（多选）\n{c:red; b} 1. 已知集合 $A=\\{1,2,3\\}$，则 $A\\cap B=$（　）[两行]\nA. $\\{1\\}$　B. $\\{2,3\\}$　C. $\\{1,4\\}$　D. $\\{2,4\\}$\n## 二、填空题\n2. 等差数列 $a_1=1$，$d=2$，则 $S_{10}=$______。\n[换页]\n## 三、解答题\n### 解答\n（1）$S_{10}=10\\times1+\\frac{10\\times9}{2}\\times2=100$。'
  render()
  helpOpen.value = false
}
function clear() { input.value = ''; localStorage.removeItem(DRAFT_KEY); render() }

/** 版心宽度（像素）：A4 210mm − 2×16mm 页边距 = 178mm；按 2 倍留清晰度 ≈ 1345px ✓
 *  —— 图片超过这个宽度就等比缩小 ✓，保证既填得满版心、又不让 PDF 白白变大 ✓。 */
const A4_CONTENT_PX = Math.round(((210 - 2 * 16) / 25.4) * 96 * 2)

/**
 * 把一张图片文件读进来并按版心限宽压缩后落进 images ✓（插图与拖拽共用一份实现 ✓）。
 *
 * 为什么必须压缩 ✗：手机拍的题图常是 3000~4000px 宽 ✓，直接内嵌会让 dataURL 有数 MB ✓，
 * 存进草稿会撑爆 localStorage、生成的 PDF 也白白巨大 ✓。
 */
async function addImageFromFile(file: File) {
  if (!file || !file.type || file.type.indexOf('image/') !== 0) { paperMsg.value = '只能插入图片文件（PNG/JPG/WebP/GIF/SVG）'; return }
  try {
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(String(r.result))
      r.onerror = () => rej(new Error('读取文件失败'))
      r.readAsDataURL(file)
    })
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('这不是浏览器能识别的图片'))
      i.src = dataUrl
    })
    const w0 = img.naturalWidth || img.width
    const h0 = img.naturalHeight || img.height
    let w = w0
    let h = h0
    if (w > A4_CONTENT_PX) { h = Math.round((h0 * A4_CONTENT_PX) / w0); w = A4_CONTENT_PX }
    let out = dataUrl
    const isPng = file.type === 'image/png'
    if (w !== w0 || !isPng) {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const cx = c.getContext('2d')
      if (cx) {
        cx.drawImage(img, 0, 0, w, h)
        out = c.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.85)
      }
    }
    const n = ++imgSeq.value
    images.value[n] = { src: out, address: file.name || '本地图片' }
    input.value += '[图' + n + ']'
    render()
    saveDraftSoon()
    const kb0 = Math.round(file.size / 1024)
    const kb1 = Math.round((out.length * 0.75) / 1024)
    const size = kb1 < kb0 ? '（' + kb0 + ' KB → ' + kb1 + ' KB）' : ''
    paperMsg.value = '已插入 ' + (file.name || '图片') + '：' + w0 + '×' + h0 + (w !== w0 ? ' → 缩到 ' + w + '×' + h : '') + size
  } catch (err: any) {
    paperMsg.value = '插入图片失败：' + (err && err.message ? err.message : String(err))
  }
}

/** 拖拽进编辑区：一次可以拖多张 ✓ */
function onDropImages(e: DragEvent) {
  const fs = e.dataTransfer && e.dataTransfer.files
  if (!fs || !fs.length) return
  const list = Array.from(fs)
  let i = 0
  const next = () => { if (i >= list.length) return; const f = list[i++]; addImageFromFile(f).then(next) }
  next()
}
function insertImage() {
  const fi = document.createElement('input')
  fi.type = 'file'
  fi.accept = 'image/*'
  fi.multiple = true
  fi.onchange = () => {
    const fs = fi.files ? Array.from(fi.files) : []
    let i = 0
    const next = () => { if (i >= fs.length) return; const file = fs[i++]; addImageFromFile(file).then(next) }
    next()
  }
  fi.click()
}
// ---- 插入数学图形：把画布上图形的 SVG 栅格化成 PNG，走跟插入图片完全同一条路（[图N]）----
const store = useDeckStore()
const figOpen = ref(false)
/** 文稿里所有数学图形（带所在页码与类型名） */
const figList = computed(() =>
  store.deck.slides.flatMap((s, si) =>
    s.elements.filter((e) => e.type === 'mathfig').map((e) => ({
      id: e.id,
      slide: si,
      label: MATH_FIGURE_OPTIONS.find((o) => o.v === (e as { kind?: string }).kind)?.label
        || (e as { kind?: string }).kind || '数学图形',
    })),
  ),
)

/** SVG → PNG dataURL（2 倍分辨率、白底，PDF 里最稳） */
/** 出图的目标像素宽度：图形库里的卡片 viewBox 只有几十宽，按 2× 出图只有一百多像素，
 *  贴到文档里被放大就显糊 —— 用户反馈"从页面插入的曲线很美观"就是这个原因（页面那条取的.viewBox 有 520 宽）。
 *  这里统一按目标像素宽度出图，线宽是 user 单位、跟着一起放大，观感不受影响。 */
const EXPORT_PX_W = 1200

async function svgToPng(svg: SVGSVGElement, scale?: number): Promise<string> {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const vb = svg.viewBox?.baseVal
  const w = (vb && vb.width) || svg.clientWidth || 400
  const h = (vb && vb.height) || svg.clientHeight || 300
  // 没指定倍数时，按目标像素宽度算（保底 2×，别缩水）
  const k = scale ?? Math.max(2, EXPORT_PX_W / w)
  // 让 SVG 本身以**目标分辨率**渲染（浏览器会按这个尺寸重新栅格化，而不是先画小再放大 ✗）
  clone.setAttribute('width', String(Math.round(w * k)))
  clone.setAttribute('height', String(Math.round(h * k)))
  const text = new XMLSerializer().serializeToString(clone)
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text)
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image()
    im.onload = () => res(im)
    im.onerror = () => rej(new Error('图形转图片失败'))
    im.src = url
  })
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, Math.round(w * k))
  cv.height = Math.max(1, Math.round(h * k))
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = '#ffffff' // 白底：打印/导出更干净，也避免透明底在某些阅读器里发灰
  ctx.fillRect(0, 0, cv.width, cv.height)
  ctx.drawImage(img, 0, 0, cv.width, cv.height)
  return cv.toDataURL('image/png')
}

/**
 * 同上，但收的是 **SVG 字符串** ✓
 * ⚠ 三维立体图交出的是字符串 ✓ 不是 DOM 节点 ✗ —— 所以原来的 svgToPng 用不了 ✓。
 * 宽高从字符串自己的 viewBox 里读 ✓（对话框的 SVG 带 viewBox ✓）。
 */
async function svgStringToPng(text: string, scale?: number): Promise<string> {
  const vb = text.match(/viewBox="([\d.\-\s]+)"/)
  const nums = vb ? vb[1].trim().split(/\s+/).map(Number) : []
  const w = nums.length === 4 && nums[2] > 0 ? nums[2] : 480
  const h = nums.length === 4 && nums[3] > 0 ? nums[3] : 320
  const k = scale ?? Math.max(2, EXPORT_PX_W / w)
  // ⚠ 三维对话框给的是一段**片段** ✗（renderSolid + arcsSvg + 顶点圆点 ✓），
  //   **没有外层 <svg> 标签** ✓ —— 所以 `replace(/<svg\b/, …)` 一次都匹配不上 ✓。
  //   实测：点「插入到当前页」后试卷提示「图形转图片失败」✓ —— 片段不是合法 SVG 文档 ✓。
  //   修法：**没有 <svg> 就自己包一层** ✓，顺带补 xmlns ✓ 并按目标分辨率设 width/height ✓。
  let doc = text
  if (!/<svg[\s>]/.test(doc)) {
    doc =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h +
      '" width="' + Math.round(w * k) + '" height="' + Math.round(h * k) + '">' + doc + '</svg>'
  } else {
    if (doc.indexOf('xmlns') < 0) doc = doc.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"')
    doc = doc.replace(/<svg\b/, '<svg width="' + Math.round(w * k) + '" height="' + Math.round(h * k) + '"')
  }
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(doc)
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image()
    im.onload = () => res(im)
    im.onerror = () => rej(new Error('图形转图片失败'))
    im.src = url
  })
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, Math.round(w * k))
  cv.height = Math.max(1, Math.round(h * k))
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, cv.width, cv.height)
  ctx.drawImage(img, 0, 0, cv.width, cv.height)
  return cv.toDataURL('image/png')
}

/** 取某图形元素当前的 SVG：不在当前页时临时切过去取一下再切回来 */
async function grabFigureSvg(elId: string, slideIndex: number): Promise<SVGSVGElement | null> {
  const back = store.currentIndex
  const switched = slideIndex !== back
  if (switched) {
    store.gotoSlide(slideIndex)
    await new Promise((r) => setTimeout(r, 60)) // 等一帧，让画布把该页渲染出来
  }
  const svg = document.querySelector('[data-el-id="' + elId + '"] svg') as SVGSVGElement | null
  const copy = svg ? (svg.cloneNode(true) as SVGSVGElement) : null
  if (switched) {
    store.gotoSlide(back)
  }
  return copy
}

/** 缩略图缓存：id -> svg dataURL（打开面板时逐个抓，切页动作被弹窗挡住，用户看不到闪） */
const figThumbs = ref<Record<string, string>>({})
function svgDataUrl(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone))
}
/** 打开面板：把还没抓过缩略图的图形补齐（带真实预览，选的时候看得见） */
async function openFigPicker() {
  figOpen.value = !figOpen.value
  if (!figOpen.value) return
  for (const f of figList.value) {
    if (figThumbs.value[f.id]) continue
    const svg = await grabFigureSvg(f.id, f.slide)
    if (svg) figThumbs.value[f.id] = svgDataUrl(svg)
  }
}

/** 把一段 SVG 栅格化后插进文档（图形库直插与画布取图共用这一步） */
async function insertSvgIntoDoc(svg: SVGSVGElement, label: string) {
  try {
    const png = await svgToPng(svg)
    const n = ++imgSeq.value
    images.value[n] = { src: png, address: label }
    input.value += '[图' + n + ']'
    render()
  } catch (e) {
    window.alert(e instanceof Error ? e.message : String(e))
  }
}

/** 打开图形库，点哪张就把哪张插进文档（不用先放到画布上） */
function pickFromLibrary() {
  openFigPalette((svg, label) => { void insertSvgIntoDoc(svg, label) })
}

/**
 * **插入三维立体图** ✓（用户要求 ✓）
 *
 * 做法：给 Geom3DDialog 登记一个接收口 ✓（它 insert() 时优先走接收口 ✓），
 * 然后打开三维窗口 ✓ —— 你在里面调好点「插入到当前页」✓，图形就落到试卷的光标处 ✓。
 * 用完立刻清掉接收口 ✓（否则会影响画布的插入 ✓）。
 */
function insertGeom3D() {
  paperMsg.value = '请在三维窗口里调好，点「插入到当前页」即插入到试卷 ✓'
  geom3dSink.value = async (svgText: string) => {
    geom3dSink.value = null
    try {
      const png = await svgStringToPng(svgText)
      const n = ++imgSeq.value
      images.value[n] = { src: png, address: '三维立体图' }
      input.value += '[图' + n + ']'
      render()
      saveDraftSoon()
      paperMsg.value = '已插入三维立体图 [图' + n + '] ✓'
    } catch (err) {
      paperMsg.value = '三维图插入失败：' + (err instanceof Error ? err.message : String(err))
    }
  }
  openGeom3D()
}

/**
 * **插入矢量描摹图** ✓（用户要求 ✓）。
 *
 * 描摹要先有一张线稿图 ✓ —— 所以先让用户选图 ✓，
 * 再把结果（SVG ✓）栅格化成 [图N] 插进试卷 ✓。
 * 与三维那套完全同构 ✓（登记接收口 → 开对话框 → 交产物 → 清接收口 ✓）。
 */
function insertVectorize() {
  const fi = document.createElement('input')
  fi.type = 'file'
  fi.accept = 'image/*'
  fi.onchange = () => {
    const file = fi.files && fi.files[0]
    if (!file) return
    const rd = new FileReader()
    rd.onload = () => {
      paperMsg.value = '请在描摹窗口里调好，点「插入」即插入到试卷 ✓'
      vectorizeSink.value = async (svgText: string) => {
        vectorizeSink.value = null
        try {
          const png = await svgStringToPng(svgText)
          const n = ++imgSeq.value
          images.value[n] = { src: png, address: '矢量描摹图' }
          input.value += '[图' + n + ']'
          render()
          saveDraftSoon()
          paperMsg.value = '已插入矢量描摹图 [图' + n + '] ✓'
        } catch (err) {
          paperMsg.value = '矢量描摹图插入失败：' + (err instanceof Error ? err.message : String(err))
        }
      }
      openVectorize(String(rd.result))
    }
    rd.readAsDataURL(file)
  }
  fi.click()
}


async function insertFigure(id: string, slideIndex: number, label: string) {
  figOpen.value = false

  try {
    const svg = await grabFigureSvg(id, slideIndex)
    if (!svg) {
      window.alert('取不到这个图形的图形数据，请先切到它所在的页面再试')
      return
    }
    const png = await svgToPng(svg)
    const n = ++imgSeq.value
    images.value[n] = { src: png, address: label }
    input.value += '[图' + n + ']'
    render()
  } catch (e) {
    window.alert(e instanceof Error ? e.message : String(e))
  }
}

function insertHdrFooterImage(target: 'header' | 'footer') {
  const fi = document.createElement('input')
  fi.type = 'file'
  fi.accept = 'image/*'
  fi.onchange = () => {
    const file = fi.files && fi.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const n = ++imgSeq.value
      images.value[n] = { src: String(reader.result), address: file.name || '本地图片' }
      const tag = '[图' + n + ']'
      if (target === 'header') headerText.value = headerText.value + (headerText.value ? ' ' : '') + tag
      else footerText.value = footerText.value + (footerText.value ? ' ' : '') + tag
      render()
    }
    reader.readAsDataURL(file)
  }
  fi.click()
}
function pickFile(accept: string, cb: (text: string) => void) {
  const fi = document.createElement('input')
  fi.type = 'file'
  fi.accept = accept
  fi.onchange = () => {
    const f = fi.files && fi.files[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => cb(String(reader.result || ''))
    reader.readAsText(f)
  }
  fi.click()
}
function importMd() {
  pickFile('.md,.txt,text/markdown,text/plain', (text) => { input.value = text; render() })
}
function importJson() {
  pickFile('.json,application/json', (text) => {
    try {
      const d = JSON.parse(text)
      if (d.input != null) input.value = String(d.input)
      if (d.headerText != null) headerText.value = String(d.headerText)
      if (d.footerText != null) footerText.value = String(d.footerText)
      if (d.gapQ != null) gapQ.value = Number(d.gapQ) || 6
      if (d.template != null) template.value = String(d.template)
      if (d.fontFamily != null) fontFamily.value = String(d.fontFamily)
      if (d.fontSize != null) fontSize.value = Number(d.fontSize)
      if (d.fontColor != null) fontColor.value = String(d.fontColor)
      if (d.lineHeight != null) lineHeight.value = Number(d.lineHeight)
      if (d.para != null) para.value = Number(d.para)
      if (d.indent != null) indent.value = Number(d.indent)
      if (d.h2size != null) h2size.value = Number(d.h2size)
      if (d.numStyle != null) numStyle.value = d.numStyle === 'cn' ? 'cn' : 'arabic'
    if (d.bodyCols != null) bodyCols.value = Number(d.bodyCols) || 1
      if (d.optLayout != null) optLayout.value = (['auto', 'one', 'two', 'four'].includes(d.optLayout) ? d.optLayout : 'auto')
      render()
    } catch (e) { console.error('JSON 解析失败：', e) }
  })
}
function exportJson() {
  const data = {
    input: input.value, headerText: headerText.value, footerText: footerText.value,
    gapQ: gapQ.value, template: template.value, fontFamily: fontFamily.value, fontSize: fontSize.value,
    fontColor: fontColor.value, lineHeight: lineHeight.value, para: para.value, indent: indent.value,
    h2size: h2size.value, numStyle: numStyle.value, optLayout: optLayout.value,
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = '试卷.json'; a.click()
  URL.revokeObjectURL(url)
}
async function ensurePdfLibs() {
  const w = window as any
  if (w.html2canvas && w.jspdf && w.jspdf.jsPDF) return
  const load = (src: string) => new Promise<void>((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error('加载失败: ' + src)); document.head.appendChild(s) })
  const base = window.location.origin + '/'
  const jobs: Promise<void>[] = []
  if (!w.html2canvas) jobs.push(load(base + 'pdf/html2canvas.min.js'))
  if (!w.jspdf || !w.jspdf.jsPDF) jobs.push(load(base + 'pdf/jspdf.umd.min.js'))
  await Promise.all(jobs)
}
/**
 * 打印 / 另存为 PDF —— **矢量**那条路 ✓。
 *
 * 为什么不直接用 savePdf ✗：那条走 html2canvas + jsPDF ✓，是把整页画成 JPEG 再贴上去 ✓ ——
 * 文字不可选、不可搜、放大发虚 ✗。而本组件**早就写好了 @media print 样式** ✓
 *（隐藏界面、A4 尺寸、page-break-after 分页 ✓），所以浏览器自带的「打印为 PDF」就是矢量输出 ✓。
 * 这里只是**把那个能力做成按钮** ✓。
 */
function printPdf() {
  window.print()
}

async function savePdf() {
  try {
    await ensurePdfLibs()
  } catch (e) {
    console.error('PDF 库加载失败，回退打印：', e)
    paperMsg.value = 'PDF 库没能加载（可能是离线或网络受限）→ 已改用「打印」方式；请在打印对话框里选「另存为 PDF」'
    window.print()
    return
  }
  const a4 = a4El.value
  if (!a4) { window.print(); return }
  const pages = Array.from(a4.querySelectorAll('.paper-page')) as HTMLElement[]
  if (!pages.length) { window.print(); return }
  const w = window as any
  const JsPDF = w.jspdf && w.jspdf.jsPDF
  const h2c = w.html2canvas
  if (!JsPDF || !h2c) { window.print(); return }
  // ⭐ 必须在**生成之前**先把「另存为」弹出来 ✗：
  //   showSaveFilePicker 要求**用户点击的瞬时授权**（约 5 秒内有效 ✓），
  //   而生成 PDF 要花几秒 ✓ —— 顺序反了授权就过期 ✓ → SecurityError ✓ → 只能回退下载 ✗
  //   （用户实测：提示「已用浏览器下载方式保存」但没有任何对话框 ✓ 正是这个原因 ✓）。
  let fileHandle: { createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> } | null = null
  const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<any> }).showSaveFilePicker
  const guessName = (headerText.value || '试卷讲义').replace(/[\\/:*?"<>|]/g, '_') + '.pdf'
  if (typeof picker === 'function') {
    try {
      fileHandle = await picker({ suggestedName: guessName, types: [{ description: 'PDF 文件', accept: { 'application/pdf': ['.pdf'] } }] })
    } catch (err: any) {
      if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) { paperMsg.value = '已取消保存'; return }
      paperMsg.value = '无法打开「另存为」对话框（' + (err && err.name ? err.name : String(err)) + '）→ 改用下载方式'
      fileHandle = null
    }
  }

  const prevZoom = a4.style.zoom
  a4.style.zoom = '1'
  let ok = false
  try {
    const pdf = new JsPDF({ unit: 'mm', format: 'a4' })
    for (let i = 0; i < pages.length; i++) {
      if (i) pdf.addPage()
      // ⚠ 必须给反馈 ✗ —— 原来整个循环没有任何提示 ✓，看起来就是「点了没反应」✓（用户实测 ✓）
      paperMsg.value = '正在生成 PDF…第 ' + (i + 1) + ' / ' + pages.length + ' 页（页数多时较慢，请稍候）'
      await new Promise((r) => setTimeout(r, 30))   // 让提示先渲染出来 ✓ 并给主线程喘口气 ✓
      // ⚠ scale 3 → 2 ✗：A4 按 3 倍是 2382×3367 px ✓ 单页 canvas 约 32 MB ✓ 多页必然卡死 ✓
      const canvas = await h2c(pages[i], { scale: 2, useCORS: true, backgroundColor: '#ffffff' })
      const isPng = pdfFmt.value === 'png'
      // ⚠ JPEG 质量 0.95 → 0.85 ✗：体积与耗时都明显下降 ✓ 印刷质量足够 ✓
      const img = isPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85)
      pdf.addImage(img, isPng ? 'PNG' : 'JPEG', 0, 0, 210, 297)
      await new Promise((r) => setTimeout(r, 0))   // 每页之间让出主线程 ✓
    }
    // ⭐ 写文件：有 handle 就写到你选的目录 ✓，否则回退下载 ✓
    const fname = (headerText.value || '试卷讲义').replace(/[\\/:*?"<>|]/g, '_') + '.pdf'
    const outBlob = pdf.output('blob')
    if (fileHandle) {
      try {
        const writable = await fileHandle.createWritable()
        await writable.write(outBlob)
        await writable.close()
        paperMsg.value = '已保存：' + fname
        ok = true
      } catch (err: any) {
        pdf.save(fname)
        paperMsg.value = '写入所选位置失败（' + (err && err.name ? err.name : String(err)) + '）→ 已下载到默认位置：' + fname
        ok = true
      }
    } else {
      pdf.save(fname)
      paperMsg.value = '已保存到默认下载位置：' + fname
        ok = true
    }
  } catch (e) {
    // ⚠ 这里说的是"**导出 PDF** 这一步失败"，不是"试卷编辑"失败 → 保持原话 ✓
    console.error('PDF 生成失败，回退打印：', e)
    paperMsg.value = 'PDF 生成失败 → 已改用打印方式：' + (e && (e as any).message ? (e as any).message : String(e))
  } finally {
    a4.style.zoom = prevZoom
  }
  if (!ok) window.print()
}
function insertBlank() {
  const v = Number(blankVal.value) || 4
  const u = blankUnit.value === 'mm' ? 'mm' : 'cm'
  insertMarker('[' + v + u + ']')
  blankOpen.value = false
}
function insertMarker(marker: string) {
  const el = inputEl.value
  const cur = input.value
  const start = el?.selectionStart != null ? el.selectionStart : cur.length
  const end = el?.selectionEnd != null ? el.selectionEnd : cur.length
  const before = cur[start - 1]
  const after = cur[end]
  let text = marker
  if (before && before !== '\n' && before !== ' ') text = '\n' + text
  if (after && after !== '\n') text = text + '\n'
  input.value = cur.slice(0, start) + text + cur.slice(end)
  if (el) {
    const pos = start + text.length
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = pos })
  }
  render()
}

let renderTimer: number | undefined
function onInput() { clearTimeout(renderTimer); renderTimer = window.setTimeout(render, 300) }

// ---- 草稿持久化：关闭后重开保留最后编辑内容 ----
const DEFAULTS_KEY = 'lj-paper-defaults-v1'
/** 设置快照 —— 草稿与「默认设置」共用一份实现 ✓（别各写各的 ✗） */
function settingsSnapshot() {
  return {
    template: template.value, fontFamily: fontFamily.value, fontSize: fontSize.value,
    fontColor: fontColor.value, lineHeight: lineHeight.value, para: para.value, indent: indent.value,
    h2size: h2size.value, numStyle: numStyle.value, optLayout: optLayout.value,
    headerText: headerText.value, footerText: footerText.value, gapQ: gapQ.value,
    headerGap: headerGap.value, footerGap: footerGap.value, autoNum: autoNum.value, bodyCols: bodyCols.value,
  }
}
function applySettings(s: any) {
  if (!s) return
  if (s.template !== undefined) template.value = s.template
  if (s.fontFamily !== undefined) fontFamily.value = s.fontFamily
  if (s.fontSize) fontSize.value = s.fontSize
  if (s.fontColor) fontColor.value = s.fontColor
  if (s.lineHeight) lineHeight.value = s.lineHeight
  if (s.para !== undefined) para.value = s.para
  if (s.indent !== undefined) indent.value = s.indent
  if (s.h2size) h2size.value = s.h2size
  if (s.numStyle) numStyle.value = s.numStyle
  if (s.optLayout) optLayout.value = s.optLayout
  if (s.headerText !== undefined) headerText.value = s.headerText
  if (s.footerText !== undefined) footerText.value = s.footerText
  if (s.gapQ !== undefined) gapQ.value = s.gapQ
  if (s.headerGap !== undefined) headerGap.value = s.headerGap
  if (s.footerGap !== undefined) footerGap.value = s.footerGap
  if (s.autoNum !== undefined) autoNum.value = s.autoNum
  if (s.bodyCols) bodyCols.value = Number(s.bodyCols) || 1
  render()
}
function saveAsDefaults() {
  try { localStorage.setItem(DEFAULTS_KEY, JSON.stringify(settingsSnapshot())); paperMsg.value = '已存为默认设置，下次打开自动套用' } catch { paperMsg.value = '存不上（浏览器隐私模式？）' }
}
function applyDefaults() {
  try { const s = localStorage.getItem(DEFAULTS_KEY); if (!s) { paperMsg.value = '还没有存过默认设置'; return } applySettings(JSON.parse(s)); paperMsg.value = '已套用默认设置' } catch { paperMsg.value = '默认设置读取失败' }
}
const paperMsg = ref('')


const DRAFT_KEY = 'lj-paper-draft-v1'
/** 草稿里图片超过这个字符数就**转存到内容库**（SQLite，容量不受限），草稿只留"已转存"标记。
 *  localStorage 只有 ~5MB，而整卷几十张 data URL 图轻松超 —— 原来超了会 try/catch **静默存不上** ✗ */
const DRAFT_IMG_LIMIT = 1500000
/** 纯函数，便于单测：这份草稿需不需要把图转存出去 */
function draftNeedsOffload(jsonLen: number): boolean { return jsonLen > DRAFT_IMG_LIMIT }

/** 把当前 images 转存进内容库（同名旧行先清掉，只留最新一份） */
async function offloadDraftImages() {
  if (!isTauri()) return
  try {
    for (const it of await libQuery('paperdraftimg')) await libRemove(it.id)
    await libSave({
      type: 'paperdraftimg', title: DRAFT_KEY, body: '',
      meta: { images: images.value } as unknown as Record<string, unknown>,
      tags: '草稿图', source: '试卷草稿', builtin: 0,
    })
  } catch { /* 转存失败：至少草稿文本还在（图会丢，但不静默崩） */ }
}

function saveDraft() {
  try {
    const d: Record<string, unknown> = { images: images.value, input: input.value, template: template.value, fontFamily: fontFamily.value, fontSize: fontSize.value, fontColor: fontColor.value,
      lineHeight: lineHeight.value, para: para.value, indent: indent.value, numStyle: numStyle.value, headerText: headerText.value,
      footerText: footerText.value, autoNum: autoNum.value, h2size: h2size.value, gapQ: gapQ.value, headerGap: headerGap.value,
      footerGap: footerGap.value, optLayout: optLayout.value, bodyCols: bodyCols.value }
    const json = JSON.stringify(d)
    if (!draftNeedsOffload(json.length)) { localStorage.setItem(DRAFT_KEY, json); return }
    // 图太大：草稿本体**去掉 images**（这样一定存得下 ✓），图转存内容库 → 恢复时再取回来
    delete d.images
    d.imgOffloaded = true
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d))
    void offloadDraftImages()
  } catch { /* 忽略配额/隐私模式 */ }
}
function restoreDraft(): boolean {
  try {
    const s = localStorage.getItem(DRAFT_KEY)
    if (!s) return false
    const d = JSON.parse(s)
    if (d.images && typeof d.images === 'object') {
      images.value = d.images as Record<number, { src: string; address?: string; caption?: string }>
      // ⚠ 图号游标要接着草稿里已有的最大图号往下走 —— 否则新插一张图会**覆盖**草稿里的图 1
      //   （imgSeq 从 0 起，草稿里的 images 是 {1:…,2:…}，实测插第二张就把图 1 顶掉了）
      const keys = Object.keys(images.value).map((k) => Number(k)).filter((n) => Number.isFinite(n) && n > 0)
      imgSeq.value = keys.length ? Math.max(...keys) : 0
    } else if (d.imgOffloaded) {
      // 图在内容库里（saveDraft 转存的）→ 异步取回来；取回来前 paperMsg 提示一下，别让人以为图丢了
      paperMsg.value = '正在从内容库取回试卷插图…'
      void (async () => {
        try {
          const rows = (await libQuery('paperdraftimg')).sort((a, b) => Number(b.id) - Number(a.id))
          const im = rows[0] && rows[0].meta ? (rows[0].meta as { images?: Record<number, { src: string; address?: string; caption?: string }> }).images : null
          if (im && typeof im === 'object') {
            images.value = im
            const ks = Object.keys(images.value).map((k) => Number(k)).filter((n) => Number.isFinite(n) && n > 0)
            imgSeq.value = ks.length ? Math.max(...ks) : 0
            paperMsg.value = '已取回 ' + ks.length + ' 张试卷插图 ✓'
          } else { paperMsg.value = '草稿里的插图没能取回（内容库里没有对应数据）' }
        } catch { paperMsg.value = '草稿里的插图取回失败' }
      })()
    }
    if (typeof d.input === 'string') input.value = d.input
    if (typeof d.template === 'string') template.value = d.template
    if (typeof d.fontFamily === 'string') fontFamily.value = d.fontFamily
    if (typeof d.fontSize === 'number') fontSize.value = d.fontSize
    if (typeof d.fontColor === 'string') fontColor.value = d.fontColor
    if (typeof d.lineHeight === 'number') lineHeight.value = d.lineHeight
    if (typeof d.para === 'number') para.value = d.para
    if (typeof d.indent === 'number') indent.value = d.indent
    if (typeof d.numStyle === 'string') numStyle.value = d.numStyle
    if (typeof d.headerText === 'string') headerText.value = d.headerText
    if (typeof d.footerText === 'string') footerText.value = d.footerText
    if (typeof d.autoNum === 'boolean') autoNum.value = d.autoNum
    if (typeof d.h2size === 'number') h2size.value = d.h2size
    if (typeof d.gapQ === 'number') gapQ.value = d.gapQ
    if (typeof d.headerGap === 'number') headerGap.value = d.headerGap
    if (typeof d.footerGap === 'number') footerGap.value = d.footerGap
    if (typeof d.optLayout === 'string') optLayout.value = d.optLayout
    return true
  } catch { return false }
}
/**
 * 试题库 → 试卷：把选题正文插到**正文末尾**（M3 接回；旧实现在 v1439 随旧题库一起摘掉了）✓
 *
 * 题图自带 [图N]（是**题目自己的编号**），本试卷的图号是另一套映射 ——
 * 所以先把题带来的图注册进 images、再把文本里的 [图N] 换成新号；
 * 否则会指到同号的别的图 ✗（用户实报过「图片缺失图N」）。
 * 插完**不关窗**：组卷通常是连续选好几道 ✓
 */
function onQuestionInsert(p: PaperInsertPayload) {
  let body = p.text
  for (const im of p.imgs || []) {
    if (!im || !im.src || !(im.n > 0)) continue
    const exist = Object.keys(images.value).find(
      (k) => images.value[Number(k)] && images.value[Number(k)].src === im.src,
    )
    const n = exist ? Number(exist) : ++imgSeq.value
    if (!exist) images.value[n] = { src: im.src, address: im.caption || '题库插图', caption: im.caption }
    // 只换号，不动后面的参数（[图1:center] → [图7:center]）；
    // 负向先行断言保证 [图1] 不会误伤 [图12] ✓
    body = body.replace(new RegExp('\\[图' + im.n + '(?=[\\]:])', 'g'), '[图' + n)
  }
  const cur = input.value
  const sep = cur && !cur.endsWith('\n') ? '\n\n' : ''
  // 整套 / 组卷（id=0）插到**已经有内容**的正文后面时，先手动分页：
  // 每套卷子各自从新的一页开始，题号各从 1 起才讲得通（否则两套 1.2.3. 混在一页 ✗）
  const brk = p.id === 0 && cur.trim() ? '[分页]\n' : ''
  input.value += sep + brk + body + '\n'
  render()
  saveDraftSoon()
  paperMsg.value = '已插入' + (p.label ? ' ' + p.label : p.id ? ' 试题 #' + p.id : '')
    + ((p.imgs || []).length ? '，配图 ' + (p.imgs || []).length + ' 张' : '') + ' ✓（可继续选下一道）'
}

let draftTimer: number | undefined
function saveDraftSoon() { clearTimeout(draftTimer); draftTimer = window.setTimeout(saveDraft, 300) }
watch([input, template, fontFamily, fontSize, fontColor, lineHeight, para, indent, numStyle, headerText, footerText, autoNum, h2size, gapQ, headerGap, footerGap, optLayout], saveDraftSoon)

onMounted(() => {
  if (!restoreDraft() && !input.value.trim()) input.value = DEFAULT
  // 桌面端顺带拿到 images 目录，界面上提示用户「试题图放这里」
  if (isTauri()) imagesDir().then((d) => { imgDirHint.value = d })
  render()
  // 试题库的接收口：本窗口开着就接住；顺带把「待办」消费掉 ✓
  paperInsertSink.value = onQuestionInsert
  const pend = paperPending.value
  if (pend) { paperPending.value = null; onQuestionInsert(pend) }
})

// 文档关掉时把图形库的"接收方"清掉 —— 否则下次从工具栏打开图形库，
// 点卡片还会往已经关掉的文档里插（面板状态是跨组件共享的）
onBeforeUnmount(() => {
  closeFigPalette()
  // ⚠ 关掉试卷时**必须清掉三维接收口** ✗ —— 否则 sink 一直挂着 ✓
  //   之后在**画布**上插三维 ✓ 也会走这个（已经死掉的）试卷接收口 ✗
  //   → **两边都插不进去** ✓（用户实测：三维插不进试卷、也插不进页面 ✓）。
  geom3dSink.value = null
  vectorizeSink.value = null   // 描摹的接收口同样要清 ✓
  paperInsertSink.value = null   // 试题库的接收口同样要清 ✓
})
/** 图片有更新（用户换了图）时清缓存重渲染 */
function refreshImages() {
  imgCache.value = {}
  render()
}
watch(numStyle, () => render())
watch(optLayout, () => render())
watch(bodyCols, () => render())
watch(colFill, () => render())
watch([fontFamily, fontSize, fontColor, lineHeight, para, indent, h2size, gapQ, headerGap, footerGap], () => refreshLayout())
watch([headerText, footerText], () => render())
</script>

<template>
  <Teleport to="body">
    <div class="pm">
      <div class="pm__backdrop"></div>
      <div class="pm__box">
        <header class="pm__head">
          <span>试卷编辑 · A4 文档</span>
          <button class="pm__x" @click="emit('close')" title="关闭"><AppIcon name="close" :size="13" /></button>
        </header>
        <div class="pm__body">
          <div class="pm__split">
          <div class="pm__left" @dragover.prevent @drop.prevent="onDropImages($event)">
              <div class="pm__controls">
                <div class="pm__ctlrow">
                  <label>模板</label>
                  <select v-model="template" @change="applyTemplate(template)">
                    <option value="">—— 请选择模板 ——</option>
                    <option value="handout">讲义模板（奇偶性）</option>
                    <option value="exam">试卷模板（选择/填空/解答）</option>
                    <option value="exam19">19 题试卷模板（8单选/3多选/3填空/5解答）</option>
                    <option value="blank">空白</option>
                  </select>
                </div>
                <div class="pm__ctlrow">
                  <label>字体</label>
                  <select v-model="fontFamily">
                    <option value="'Times New Roman', 'SimSun', serif">Times/宋体</option>
                    <option value="'SimSun', serif">宋体</option>
                    <option value="'Microsoft YaHei', sans-serif">微软雅黑</option>
                    <option value="'KaiTi', serif">楷体</option>
                    <option value="'SimHei', sans-serif">黑体</option>
                    <option value="Arial, sans-serif">Arial</option>
                  </select>
                  <label>字号</label>
                  <select :value="cnPt" @change="setCnSize" title="中文字号">
                    <option value="">自定义</option>
                    <option v-for="s in CN_FONT_SIZES" :key="s.pt" :value="s.pt">{{ s.name }}</option>
                  </select>
                  <input type="number" v-model.number="fontSize" min="5" max="42" step="0.5" title="或直接输入 pt 字号">
                  <label>颜色</label>
                  <input type="color" v-model="fontColor">
                  <label>行距</label>
                  <input type="number" v-model.number="lineHeight" min="1" max="3" step="0.1">
                  <label>段距</label>
                  <input type="number" v-model.number="para" min="0" max="20" step="1">
                  <label>缩进</label>
                  <input type="number" v-model.number="indent" min="0" max="4" step="0.5">
                  <label>标题</label>
                  <input type="number" v-model.number="h2size" min="12" max="32" step="1">
                  <label>题号</label>
                  <select v-model="numStyle">
                    <option value="arabic">1、2、3…</option>
                    <option value="cn">一、二、三…</option>
                  </select>
                  <label>选项排布</label>
                  <select v-model="optLayout" title="选择题的 ABCD 怎么摆（与正文分栏无关）">
                    <option value="auto">自动</option>
                    <option value="one">一栏</option>
                    <option value="two">两栏</option>
                    <option value="four">四栏</option>
                  </select>
                  <label>正文分栏</label>
                  <select v-model="bodyCols" title="整篇正文自动流成几栏（练习小页常用两栏）">
                    <option :value="1">一栏</option>
                    <option :value="2">两栏</option>
                    <option :value="3">三栏</option>
                  </select>
                  <label>填充</label>
                  <select v-model="colFill" title="页面铺满(先填满左栏) 还是 两栏等高(可能下方留白)">
                    <option value="fill">铺满</option>
                    <option value="balance">等高</option>
                  </select>
                </div>
                <div class="pm__ctlrow">
                  <label>页眉</label><input class="pm__wide" v-model="headerText" placeholder="如：某中学高三期末试卷"><button class="pm__btn pm__btn--sm" title="在页眉插入图片（[图N]）" @click="insertHdrFooterImage('header')">插图</button>
                  <label>页脚</label><input class="pm__wide" v-model="footerText" placeholder="第 {page} 页 / 共 {total} 页"><button class="pm__btn pm__btn--sm" title="在页脚插入图片（[图N]）" @click="insertHdrFooterImage('footer')">插图</button>
                  <label>页眉顶距</label><input type="number" v-model.number="headerGap" min="0" max="40" step="1" title="页眉与顶部边界的距离(px)">
                  <label>页脚底距</label><input type="number" v-model.number="footerGap" min="0" max="40" step="1" title="页脚与底部边界的距离(px)">
                  <label>题间距</label><input type="number" v-model.number="gapQ" min="0" max="40" step="2">
                </div>
              </div>
              <textarea ref="inputEl" v-model="input" class="pm__input" rows="18" @input="onInput" placeholder="# 标题  ## 知识梳理  1. 已知 $f(x)=x^2$ 求 $f(2)$"></textarea>
              <div class="pm__actions">
                <button class="pm__btn" title="在光标处插入换页标记 [换页]" @click="insertMarker('[换页]')">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="8" rx="1"/><rect x="5" y="14" width="14" height="8" rx="1"/></svg><span>换页</span>
                </button>
                <button class="pm__btn" title="在光标处插入分页标记 [分页]" @click="insertMarker('[分页]')">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v5M6 16v5M6 9a4 4 0 0 0 4 4M6 15a4 4 0 0 1 4-4"/></svg><span>分页</span>
                </button>
                <button class="pm__btn" title="在光标处插入指定高度空白" @click="blankOpen = !blankOpen">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16M4 19h16"/><path d="M9 9v6M15 9v6" stroke-dasharray="2 2"/></svg><span>空白</span>
                </button>
                <span class="pm__figwrap">
    <button class="pm__btn" title="打开数学图形库（74 种），点哪张就把哪张插进文档 —— 不用先放到画布上" @click="pickFromLibrary()">
      <AppIcon name="graphic" :size="14" />图形库…
    </button>
    <button class="pm__btn" :title="'把文稿里已有的数学图形插到光标处（共 ' + figList.length + ' 个）'" @click="openFigPicker()">
      <AppIcon name="graphic" :size="14" />插入数学图形
    </button>
      <button class="pm__btn" title="插入三维立体图（在三维窗口里调好后点「插入到当前页」）" @click="insertGeom3D">
        <AppIcon name="graphic" :size="14" />三维立体图
      </button>
      <button class="pm__btn" title="插入矢量描摹图（先选一张线稿图，在描摹窗口里调好后点插入）" @click="insertVectorize">
        <AppIcon name="graphic" :size="14" />矢量描摹图
      </button>
    <!-- 图形选择面板：带真实缩略图（选图形得看得见图形） -->
    <div v-if="figOpen" class="pm__figpanel">
      <div class="pm__fighead">文稿里的数学图形（{{ figList.length }} 个）</div>
      <div v-if="!figList.length" class="pm__figempty">还没有 —— 先在画布上放一个（工具栏「数学图形」）</div>
      <div v-else class="pm__figgrid">
        <button
          v-for="f in figList" :key="f.id" class="pm__figcard"
          :title="'插入第 ' + (f.slide + 1) + ' 页的这个图形'"
          @click="insertFigure(f.id, f.slide, f.label)"
        >
          <span class="pm__figthumb">
            <img v-if="figThumbs[f.id]" :src="figThumbs[f.id]" alt="" />
            <span v-else class="pm__figloading">…</span>
          </span>
          <span class="pm__figcap">P{{ f.slide + 1 }} · {{ f.label }}</span>
        </button>
      </div>
    </div>
  </span>
  <button class="pm__btn" title="在光标处插入本地图片" @click="insertImage">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/></svg><span>图片</span>
                </button>
                <button class="pm__btn" title="直接生成多页 PDF" @click="savePdf">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v10M7 9l5 4 5-4"/><path d="M5 19h14"/></svg><span>保存PDF</span>
                </button>                <button class="pm__btn pm__btn--primary" title="打印 / 另存为 PDF（矢量文字，可搜索可选中；比图片版更清晰）" @click="printPdf">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
                </button>
                <button v-if="imgDirHint" class="pm__btn" :title="'重新读取本地图（根目录：' + imgDirHint + '）'" @click="refreshImages">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg><span>{{ imgLoading ? '读图中…' : '刷新图片' }}</span>
                </button>
                <button class="pm__btn pm__btn--danger" title="清空输入" @click="clear">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 4h4M9 7l1 12h4l1-12"/></svg><span>清空</span>
                </button>
                <span class="pm__sep"></span>
                <button class="pm__btn" title="导入 Markdown 文档作为内容" @click="importMd">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></svg><span>导入MD</span>
                </button>
                <button class="pm__btn" title="导入 JSON 试卷设置" @click="importJson">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4c-1.5 0-2 .8-2 3v1c0 1.5-.6 2-2 2 1.4 0 2 .5 2 2v1c0 2.2.5 3 2 3M16 4c1.5 0 2 .8 2 3v1c0 1.5.6 2 2 2-1.4 0-2 .5-2 2v1c0 2.2-.5 3-2 3"/></svg><span>导入JSON</span>
                </button>
                <button class="pm__btn" title="导出当前试卷设置为 JSON" @click="exportJson">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v10M7 9l5 4 5-4M5 19h14"/></svg><span>导出</span>
                </button>
                <select class='pm__btn' style='padding:0 6px' title='页眉页脚模板：一键填好常用栏位' @change='applyHeaderPreset(($event.target as HTMLSelectElement).value)'>
                  <option value=''>页眉页脚模板…</option>
                  <option v-for='p in HF_PRESETS' v-show='p.id' :key='p.id' :value='p.id'>{{ p.name }}</option>
                </select>
                <select class='pm__btn' style='padding:0 6px' v-model='pdfFmt' title='位图 PDF 用哪种图片格式：PNG 文字更清晰，JPEG 体积更小'>
                  <option value='jpeg'>位图 JPEG</option>
                  <option value='png'>位图 PNG</option>
                </select>
                <button class="pm__btn" title="把当前排版参数存为默认（下次打开自动套用）" @click="saveAsDefaults">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>
                </button>
                <button class="pm__btn" title="套用之前存下的默认排版参数" @click="applyDefaults">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
                </button>
                <span v-if="paperMsg" class="pm__imghint">{{ paperMsg }}</span>
                <button class="pm__btn" title="语法帮助（含详细示范）" @click="helpOpen = true">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .3c0 1.8-2.5 1.7-2.5 3.2"/><path d="M12 16.5h.01"/></svg><span>帮助</span>
                </button>
                <span v-if="imgDirHint" class="pm__imghint" :title="imgDirHint + ' 下任意子目录（images/、pic/…）里的图片都能引用'">图片根目录 {{ imgDirHint }}</span>
                <div v-if="blankOpen" class="pm__blankpop">
                  <input type="number" v-model.number="blankVal" min="0.5" max="30" step="0.5" title="空白高度">
                  <select v-model="blankUnit">
                    <option value="cm">cm</option>
                    <option value="mm">mm</option>
                  </select>
                  <button class="pm__btn pm__btn--sm" @click="insertBlank">确定</button>
                  <button class="pm__btn pm__btn--sm" @click="blankOpen = false">取消</button>
                </div>
              </div>
              <p class="pm__hint">题号/标题自动识别、$...$ 公式、[图N] 图片、[换页] 分页、页眉页脚 {page}/{total}。点「<b>帮助</b>」看全部语法与示例。</p>
            </div>
            <div class="pm__right">
              <div class="pm__zoom">
                <button @click="zoomBy(-0.1)"><AppIcon name="minus" :size="14" /></button>
                <span>{{ Math.round(zoom * 100) }}%</span>
                <button @click="zoomBy(0.1)"><AppIcon name="plus" :size="14" /></button>
                <button @click="zoomReset">重置</button>
              </div>
              <div ref="a4El" class="pm__a4"></div>
              <div ref="pageEl" class="paper-flow" style="position:absolute;left:-99999px;top:0;pointer-events:none;"></div>
            </div>
          </div>
        </div>
      </div>
    <div v-if="helpOpen" class="pm__help">
      <div class="pm__helpbox">
        <header class="pm__helphead">
          <strong>试卷编辑 · 语法帮助</strong>
          <button class="pm__x" @click="helpOpen = false"><AppIcon name="close" :size="13" /></button>
        </header>
        <div class="pm__helpbody">
          <div v-for="sec in HELP" :key="sec.title" class="pm__helpsec">
            <h4>{{ sec.title }}</h4>
            <div v-for="(e, i) in sec.ex" :key="i" class="pm__helpex">
              <pre class="pm__helpcode">{{ e.code }}</pre>
              <p class="pm__helpdesc">{{ e.desc }}</p>
            </div>
          </div>
          <button class="pm__btn pm__btn--primary" style="margin-top:12px" @click="loadHelpDemo"><AppIcon name="load" :size="14" /> 载入示例内容到编辑区</button>
        </div>
      </div>
    </div>
    </div>
  </Teleport>
</template>

<style scoped>
.pm { position: fixed; inset: 0; z-index: 2000; }
.pm__backdrop { position: fixed; inset: 0; background: rgba(20, 24, 34, 0.55); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
.pm__box {
  position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: min(1180px, 96vw); height: 92vh; display: flex; flex-direction: column;
  background: #fff; border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); overflow: hidden;
}
.pm__head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); font-weight: 700; color: var(--text); font-size: 15px; }
.pm__x { border: none; background: transparent; font-size: 18px; cursor: pointer; color: var(--muted); }
.pm__x:hover { color: var(--text); }
.pm__body { flex: 1; min-height: 0; padding: 10px 14px; overflow: hidden; display: flex; flex-direction: column; }
.pm__split { flex: 1; min-height: 0; display: flex; gap: 14px; }
.pm__left { flex: 0 0 42%; display: flex; flex-direction: column; gap: 8px; min-width: 300px; min-height: 0; overflow: auto; }
.pm__right { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.pm__controls {
  display: flex; flex-direction: column; gap: 10px;
  border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; background: var(--bg-sunken);
}
.pm__ctlrow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; color: var(--muted); }
.pm__ctlrow label { font-weight: 600; color: var(--text); white-space: nowrap; }
.pm__ctlrow select, .pm__ctlrow input { border: 1px solid var(--border-strong); border-radius: 6px; padding: 3px 6px; font-size: 12px; width: auto; background: #fff; }
.pm__ctlrow input[type='number'] { width: 54px; }
.pm__ctlrow input[type='color'] { width: 34px; height: 24px; padding: 1px; cursor: pointer; }
.pm__ctlrow .pm__wide { min-width: 150px; }
.pm__input { flex: 0 1 auto; height: 30vh; min-height: 150px; resize: vertical; font-family: ui-monospace, Consolas, monospace; font-size: 13px; line-height: 1.5; overflow-y: auto; border: 1px solid var(--border-strong); border-radius: 8px; padding: 8px; }
.pm__actions { display: flex; gap: 8px; flex-wrap: wrap; position: relative; align-items: center; }
.pm__btn {
  display: inline-flex; align-items: center; gap: 5px;
  border: 1px solid var(--border-strong); background: #fff; color: var(--text);
  border-radius: 8px; padding: 5px 10px; cursor: pointer; font-size: 12px; font-weight: 500;
  transition: background 0.15s, border-color 0.15s, transform 0.06s;
}
/* 插入数学图形：按钮 + 下拉图形清单 */
.pm__figwrap { position: relative; display: inline-flex; }
.pm__figpanel { position: absolute; top: 100%; left: 0; z-index: 40; margin-top: 4px; width: 420px; max-height: 60vh; overflow-y: auto; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-lg); padding: 8px; }
.pm__fighead { font-size: 11.5px; color: var(--muted); padding: 2px 4px 8px; }
.pm__figgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.pm__figcard { display: flex; flex-direction: column; gap: 4px; border: 1px solid var(--border); background: #fff; border-radius: var(--radius-sm); padding: 5px; cursor: pointer; }
.pm__figcard:hover { border-color: var(--brand); background: var(--brand-50); }
.pm__figthumb { display: flex; align-items: center; justify-content: center; height: 74px; overflow: hidden; background: #fff; }
.pm__figthumb img { max-width: 100%; max-height: 74px; display: block; }
.pm__figloading { color: var(--muted); font-size: 12px; }
.pm__figcap { font-size: 10.5px; color: var(--muted); text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pm__figempty { padding: 8px; font-size: 12px; color: var(--muted); line-height: 1.6; }
.pm__btn:hover { background: var(--gray-50); border-color: var(--border-strong); }
.pm__btn:active { transform: scale(0.97); }
.pm__btn svg { flex: none; }
.pm__btn--primary { background: var(--brand); border-color: var(--brand); color: #fff; }
.pm__btn--primary:hover { background: var(--brand-strong); border-color: var(--brand-strong); }
.pm__btn--danger { color: #d84a4a; }
.pm__btn--danger:hover { background: #fdecec; border-color: var(--danger-border); }
.pm__btn--sm { padding: 3px 8px; }
.pm__sep { width: 1px; height: 20px; margin: 0 2px; background: #e0e0ea; }
.pm__imghint {
  max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 11px; color: var(--muted); margin-left: 4px;
  border: 1px dashed var(--border-strong); border-radius: 5px; padding: 2px 7px;
}
.pm__blankpop {
  position: absolute; left: 0; bottom: calc(100% + 6px);
  background: #fff; border: 1px solid var(--border-strong); border-radius: 8px; padding: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.15); display: flex; align-items: center; gap: 6px; z-index: 30;
}
.pm__blankpop input { width: 60px; border: 1px solid var(--border-strong); border-radius: 6px; padding: 3px 6px; }
.pm__blankpop select { border: 1px solid var(--border-strong); border-radius: 6px; padding: 3px 6px; }
.pm__blankpop button { border: 1px solid var(--border-strong); background: var(--panel-2); border-radius: 6px; padding: 3px 8px; cursor: pointer; }
.pm__zoom button { border: 1px solid var(--border-strong); background: var(--panel-2); color: var(--text); border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
.pm__zoom button:hover { background: var(--gray-50); }
.pm__hint { font-size: 12px; color: var(--muted); line-height: 1.6; margin: 0; }
.pm__hint code { background: #f2f2f2; border-radius: 4px; padding: 0 4px; }
.pm__zoom { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; font-size: 12px; color: var(--muted); }
.pm__zoom span { min-width: 48px; text-align: center; font-weight: 600; }
.pm__a4 { flex: 1; min-height: 0; background: #525659; padding: 14px; overflow: auto; }
.pm__help { position: fixed; inset: 0; z-index: 3000; background: rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; }
.pm__helpbox { width: min(760px, 92vw); max-height: 86vh; display: flex; flex-direction: column; background: #fff; border-radius: var(--radius-xl); box-shadow: 0 24px 64px rgba(0,0,0,0.4); overflow: hidden; }
.pm__helphead { display: flex; align-items: center; justify-content: space-between; padding: 13px 18px; border-bottom: 1px solid var(--border); font-size: 15px; }
.pm__helpbody { flex: 1; overflow-y: auto; padding: 14px 18px 18px; }
.pm__helpsec { margin-bottom: 12px; }
.pm__helpsec h4 { margin: 0 0 6px; font-size: 14px; color: var(--text); border-left: 3px solid var(--brand); padding-left: 8px; }
.pm__helpex { background: #f7f7fc; border: 1px solid #eaeaef; border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; }
.pm__helpcode { margin: 0; font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: var(--text); white-space: pre-wrap; word-break: break-word; }
.pm__helpdesc { margin: 4px 0 0; font-size: 12px; color: #777; }
</style>

<style>
@page { size: A4; margin: 0; }
.paper-flow {
  width: 210mm; padding: 0 16mm; box-sizing: border-box;
  font-family: "Times New Roman", "SimSun", serif; font-size: 12pt;
}
.paper-page {
  width: 210mm; min-height: 297mm;
  background: #fff; color: var(--text);
  padding: 18mm 16mm; box-sizing: border-box;
  box-shadow: 0 2px 12px rgba(0,0,0,0.35);
  margin: 0 auto 16px;
  font-family: "Times New Roman", "SimSun", serif;
  font-size: 12px; line-height: 1.7;
  page-break-after: always;
  break-inside: avoid;
  display: flex; flex-direction: column; align-items: stretch;
}
.paper-page .paper-header { border-bottom: 1px solid #999; padding: 0 0 4px; margin: var(--paper-headergap, 0px) 0 8px; text-align: center; font-weight: 600; flex: 0 0 auto; }
.paper-page .paper-footer { border-top: 1px solid #999; padding: 4px 0 0; margin: auto 0 var(--paper-footergap, 0px); text-align: center; flex: 0 0 auto; }
.paper-page .paper-header .paper-img-inline, .paper-page .paper-footer .paper-img-inline { max-height: 26px; max-width: 120px; vertical-align: middle; margin: 0 4px; }
  .paper-page .pp-block { flex: 0 0 auto; }
.paper-page h2 { font-size: var(--paper-h2, 18px); text-align: center; margin: 0 0 6px; font-weight: 700; letter-spacing: 2px; }
.paper-page .paper-box-title { border: 1.5px solid #111; padding: 4px 8px; font-weight: 700; margin: 8px 0 4px; display: inline-block; }
.paper-page .paper-sec-title { font-weight: 700; margin: 10px 0 4px; font-size: 15px; letter-spacing: 1px; }
.paper-page .paper-sub { font-weight: 700; margin: 8px 0 2px; }
.paper-page .paper-q { margin: var(--paper-para, 6px) 0 var(--paper-qgap, 6px); }
.paper-page .page-break { page-break-before: always; break-before: page; height: 0; }
.page-break { height: 0; page-break-before: always; break-before: page; }
.paper-page .paper-q-num { font-weight: 700; }
.paper-q-tag { display: inline-block; background: #eef0ff; color: #4b5bd6; border: 1px solid #d4d9fb; border-radius: 3px; font-size: 11px; line-height: 1.4; padding: 0 5px; margin-right: 6px; vertical-align: middle; }
.paper-fillblank { display: inline-block; min-width: 4em; height: 1.0em; border-bottom: 1px solid #111; vertical-align: bottom; }
.paper-page .paper-subq { margin: 2px 0 2px 20px; }
.paper-page p { margin: var(--paper-para, 6px) 0; }
.paper-page .paper-par { text-indent: var(--paper-indent, 2em); }
.paper-options { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 4px 0 6px 20px; }
.paper-opt { flex: 0 1 auto; display: inline-flex; align-items: baseline; }
.paper-opt i { font-style: normal; font-weight: 700; margin-right: 3px; }
/* 一行 / 两行：选项平均铺满整行（等宽填充，间距自动） */
.paper-opt-one { flex-wrap: nowrap; }
.paper-opt-one .paper-opt { flex: 1 1 0; }
.paper-opt-two { }
.paper-opt-two .paper-opt { flex: 1 1 calc(50% - 12px); }
.paper-opt-four .paper-opt { flex: 0 0 100%; }
.pp-block { display: block; overflow: visible; }
.paper-space { display: block; width: 100%; }
/* ── 题目块（[题]…[选项]…[解析]…[/题]）─────────────────────────────
   解析区默认收起 ✓ 点一下展开 ✓；**打印时强制展开** ✓（否则答案不会印出来 ✗），
   同时隐藏「点击展开」那行提示 ✓。 */
.paper-q { /* 试卷是白纸 ✓ —— 题目块只提供**结构**（不跨页 + 解析折叠），不加背景和边框 ✗ */
  background: none; border: none; padding: 0; margin: 4px 0; }
.paper-q__opts { margin-top: 4px; }
.paper-q__sol { margin-top: 6px; border-top: 1px dashed #ddd; padding-top: 4px; }
.paper-q__solbar { font-size: 0.9em; color: #8a8a8a; cursor: pointer; user-select: none; }
.paper-q__solbody { display: none; margin-top: 4px; }
.paper-q__sol--open .paper-q__solbody { display: block; }
.paper-q__sol--open .paper-q__solbar { color: #1668e0; }
@media print {
  .paper-q__solbody { display: block !important; }
  .paper-q__solbar { display: none !important; }
}

/* ── 正文分栏 ✓（整篇自动流成 N 栏 ✓ 由 --paper-cols 控制 ✓）
   页眉页脚在容器外 ✓ 保持通栏 ✓；块内部不拆栏 ✓（否则一段话会被栏缝劈开 ✗）。 */
/* ⚠ 刻意**不给固定高度** ✗ —— 用户要「两栏等高均分」✓，即 column-fill:balance（CSS 默认 ✓）；
   没有高度时浏览器会均分各栏（balance ✓），就不是先左栏后右栏了 ✓。 */
.paper-cols {
  column-count: var(--paper-cols, 1);
  column-gap: 8mm;
  column-fill: balance;
  column-rule: 1px solid #d8d5cc;
}

/* ⚠ 长公式是「两栏不等宽 + 顶出页面」的元凶 ✗ ——
   MathJax 渲染出的容器默认 white-space:nowrap ✗，一整条长公式无法断行 ✓，
   于是把它所在那一栏**撑宽** ✗（实测两栏起点相距 273px，而按容器宽应只有 165px ✓），
   甚至顶出页面右边界 ✓（用户截图 ✓）。这里允许公式在必要时收缩/换行 ✓。 */
.paper-cols mjx-container, .paper-cols .MathJax {
  max-width: 100% !important;
  overflow: hidden;   /* ⚠ 不能是 auto ✗ —— 公式比栏宽多几个像素就会**每条选项下面出一条灰滚动条** ✓（用户实测 ✓）；hidden 只裁掉溢出的一点点 ✓ 视觉上干净 ✓ */
  overflow-y: hidden;
}
/* ⚠ 允许块拆栏/拆页 ✓（用户明确：长题截断即可 ✓ 不必整块原子搬运 ✗）。
   原来 break-inside:avoid 会让放不进剩余空间的长题**整块推到下一栏** ✓ →
   上一栏下方留出大空档 ✗（实测填充率仅 88% ✗）。放开后页面能填满 ✓。 */
.paper-cols > .pp-block { break-inside: auto; page-break-inside: auto; }
.paper-cols > h2, .paper-cols > .paper-sec-title { column-span: all; }
  @media print { .paper-cols { column-count: var(--paper-cols, 1); column-gap: 8mm; column-fill: balance; column-rule: 1px solid #d8d5cc; } }

.paper-imgbox { display: block; margin: 8px 0; }
.paper-img { max-width: 100%; max-height: 400px; height: auto !important; display: block; }
.paper-fig { display: block; width: fit-content; max-width: 100%; text-align: center; }
.paper-figcap { font-size: 11px; text-align: center; color: var(--text); margin-top: 2px; }
.paper-img-inline { display: inline-block; vertical-align: middle; max-height: 180px; max-width: 45%; width: auto !important; height: auto !important; margin: 0 3px; }
.paper-float-fig { margin: 0 0 8px 10px; max-width: 42%; display: inline-block; }
.paper-float-img { max-width: 100%; max-height: 260px; height: auto !important; display: block; }

@media print {
  .app { display: none !important; }
  .pm { position: static !important; }
  .pm__backdrop, .pm__head, .pm__left, .pm__zoom { display: none !important; }
  .pm__box { box-shadow: none !important; width: auto !important; max-height: none !important; padding: 0 !important; }
  .pm__body { padding: 0 !important; }
  .pm__right, .pm__a4 { overflow: visible !important; background: #fff !important; padding: 0 !important; }
  .pm__a4 { display: block; zoom: 1 !important; }
  .paper-page { width: 210mm; min-height: 0; height: 296mm; box-sizing: border-box; break-after: page; box-shadow: none; margin: 0; page-break-after: always; background: #fff; }
  .paper-page:last-child { page-break-after: auto !important; break-after: auto !important; }
}
</style>