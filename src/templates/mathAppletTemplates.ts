/**
 * 高中数学专用模板：例题（组合公式 / +GeoGebra / +Desmos / +内嵌 HTML）。
 * 设计纪律（吸取教训）：
 * 1. build() 一律返回「扁平 SlideElement[]」——任何返回数组的辅助函数都由调用方 ...展开；
 * 2. 全文一律用「混排元素 richtex：正文 + $...$ 内联公式」—— 插进来就是排好版的数学（不是 a^2 这种裸文本），
 *    双击还能整段再编辑。**本模块不再产出任何 math 元素**：独立成行的关键推导式与右侧「关键公式卡」
 *    改用 display()（混排 + $\displaystyle ...$），理由见该函数注释。
 * 3. 版式固定栅格：左栏用 leftCol() 游标自上而下排，右栏 1180~1800，全部落在 1920×1080 内。
 */
import type { SlideElement } from '@/types'

const INK = '#1a1a1a'
const ACCENT = '#c0392b'
const SUB = '#5f5e5a'
const LINE = '#d3d1c7'
const CARD = '#f7f6f2'

function eid() { return 'el_' + Math.random().toString(36).slice(2, 10) }

// ---- 单元素工厂 ----
function txt(x: number, y: number, w: number, h: number, text: string, o: Record<string, unknown> = {}): SlideElement {
  return { id: eid(), type: 'text', x, y, w, h, rot: 0, text, fontSize: 28, color: INK, fontWeight: 400, align: 'left', fontFamily: 'sans', bgColor: 'transparent', shadow: 'none', ...o } as SlideElement
}
function shape(x: number, y: number, w: number, h: number, o: Record<string, unknown> = {}): SlideElement {
  return { id: eid(), type: 'shape', x, y, w, h, rot: 0, shape: 'rect', fill: '#f1efeb', stroke: 'transparent', strokeWidth: 0, ...o } as SlideElement
}
/**
 * 展示公式（独立成行的关键推导式 / 右侧「关键公式卡」）—— 混排元素，不是 math 元素。
 * 用内联 `$...$` 而不是 `\[...\]`，两个原因：
 * 1. 前面加 `\displaystyle` 就能拿到「显示公式」的排版样式（分式、求和的上下限与原来的公式元素一致）；
 * 2. MathJax 会给 `\[...\]` 的 display 公式套 `display:block; text-align:center; margin:1em 0`
 *    （那是给文档正文设计的），在元素框里会白白撑高约 2em，触发 fitMode:shrink 把公式整体缩小。
 * 内联写法尺寸只由 fontSize 决定，与正文同源，也不用改任何 CSS。
 */
const DISPLAY_STYLE = '\\displaystyle '
function display(x: number, y: number, w: number, h: number, latex: string, o: Record<string, unknown> = {}): SlideElement {
  return mix(x, y, w, h, '$' + DISPLAY_STYLE + latex + '$', { fontSize: 36, align: 'center', ...o })
}
function ggb(x: number, y: number, w: number, h: number, commands: string[], o: Record<string, unknown> = {}): SlideElement {
  return {
    id: eid(), type: 'geogebra', x, y, w, h, rot: 0, app: 'graphing', ggbBase64: '',
    showToolbar: false, showAlgebraInput: false, showAlgebra: false, showTitlebar: false,
    showMenuBar: false, showResetIcon: true, enableShiftDragZoom: true, showAxis: true, showGrid: false,
    commands, ...o,
  } as unknown as SlideElement
}
function desmos(x: number, y: number, w: number, h: number, list: Array<Record<string, unknown>>, o: Record<string, unknown> = {}): SlideElement {
  const state = JSON.stringify({ version: 9, graph: { viewport: { xmin: -10, ymin: -6.5, xmax: 10, ymax: 6.5 } }, expressions: { list } })
  return {
    id: eid(), type: 'desmos', x, y, w, h, rot: 0, state,
    showPanel: true, showToolbar: false, showZoomButtons: true, showTitlebar: false, color: '', ...o,
  } as unknown as SlideElement
}
function b64utf8(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
function html(x: number, y: number, w: number, h: number, src: string): SlideElement {
  return { id: eid(), type: 'embed', x, y, w, h, rot: 0, kind: 'html', url: '', dataBase64: b64utf8(src), mime: 'text/html' } as SlideElement
}

// ---- 布局片段（均返回扁平数组，调用方必须 ...展开） ----
function base(titleText: string, page: string): SlideElement[] {
  return [
    shape(120, 72, 10, 46, { fill: ACCENT }),
    txt(144, 72, 1200, 46, titleText, { fontSize: 40, fontWeight: 700, fontFamily: 'hei-bold' }),
    shape(120, 168, 1000, 6, { fill: ACCENT }),
    txt(1620, 72, 180, 40, page, { fontSize: 22, color: SUB, align: 'right' }),
  ]
}
/** 混排元素（正文 + $...$ 内联公式）：双击整段再编辑，字号/颜色/对齐走属性面板 */
function mix(x: number, y: number, w: number, h: number, text: string, o: Record<string, unknown> = {}): SlideElement {
  return {
    id: eid(), type: 'richtex', x, y, w, h, rot: 0, text,
    fontSize: 26, color: INK, fontWeight: 400, align: 'left', fontFamily: 'sans',
    bgColor: 'transparent', shadow: 'none', wrap: true, fitMode: 'shrink', ...o,
  } as SlideElement
}
/**
 * 左栏游标：例题卡 → 分析 → 关键公式 → 解答步骤 → 结论，依次往下排。
 * 行高按 1.85 倍留量（内容自身 line-height:1.5，内联公式会把行撑高），
 * 元素框只做「装不下就缩小」，所以留足高度即可保证按字号 1:1 显示。
 */
function leftCol(y0 = 200) {
  const els: SlideElement[] = []
  const LH = 1.9     // 每行留 1.9 倍字号的高度（内容 line-height:1.5，内联分式还会更高）
  const gap = 22
  /** 估算排版后会占几行：中文按 1 字宽、西文 0.55，公式按源码长度的一半折算 */
  function estLines(lines: string[], fs: number, w: number) {
    const per = Math.max(8, w / fs)
    const units = (s: string) => {
      // 公式片段：LaTeX 源码比实际排版宽（\frac{}{}、\left 等命令占位多），按一半折算
      const marked = s.replace(/\$[^$]*\$/g, (m) => '\u0001'.repeat(Math.max(2, Math.round((m.length - 2) * 0.5))))
      let n = 0
      for (const ch of marked) {
        if (ch === '\u0001') n += 1
        else if (/[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/.test(ch)) n += 1
        else n += 0.55
      }
      return n
    }
    return lines.reduce((n, s) => n + Math.max(1, Math.ceil(units(s) / per)), 0)
  }
  let y = y0
  return {
    els,
    /** 例题卡：浅色底 + 高度随「实际排版行数」自适应 */
    card(lines: string[], o: Record<string, unknown> = {}) {
      const fs = Number(o.fontSize) || 28
      const boxH = estLines(lines, fs, 932) * fs * LH + 18
      els.push(shape(120, y, 1000, boxH + 20, { fill: CARD }))
      els.push(mix(154, y + 10, 932, boxH, lines.join('\n'), { fontSize: fs, ...o }))
      y += boxH + 20 + gap
    },
    /** 一行（分析 / 结论） */
    line(text: string, o: Record<string, unknown> = {}) {
      const fs = Number(o.fontSize) || 26
      const h = estLines([text], fs, 1000) * fs * LH + 8
      els.push(mix(120, y, 1000, h, text, { fontSize: fs, ...o }))
      y += h + gap - 6
    },
    /** 多行解答步骤 */
    block(lines: string[], o: Record<string, unknown> = {}) {
      const fs = Number(o.fontSize) || 26
      const h = estLines(lines, fs, 1000) * fs * LH + 10
      els.push(mix(120, y, 1000, h, lines.join('\n'), { fontSize: fs, ...o }))
      y += h + gap - 4
    },
    /** 居中大公式（关键推导式） */
    formula(latex: string, fontSize = 32, h = 92) {
      els.push(display(120, y, 1000, h, latex, { fontSize }))
      y += h + gap - 6
    },
  }
}
/** 右侧「公式卡片」：组合公式类模板用 */
function formulaCard(titleText: string, formulas: string[]): SlideElement[] {
  const out: SlideElement[] = []
  out.push(shape(1180, 200, 620, 660, { fill: CARD }))
  out.push(txt(1210, 226, 560, 44, titleText, { fontSize: 26, fontWeight: 700, color: ACCENT }))
  formulas.forEach((f, i) => out.push(display(1210, 290 + i * 180, 560, 150, f, { fontSize: 32 })))
  return out
}
function footer(): SlideElement {
  return shape(120, 980, 1680, 2, { fill: LINE })
}

// ---- 内嵌 HTML 演示（自写 SVG/JS，无外部依赖，完全离线） ----
const demoParabola = [
  '<div class="w">',
  '  <div class="h">二次函数 y = a(x-1)² + k 动态演示</div>',
  '  <div class="ctl"><label>a = <input id="a" type="range" min="-3" max="3" step="0.1" value="1"><b id="av">1</b></label><label>k = <input id="k" type="range" min="-4" max="4" step="0.1" value="0"><b id="kv">0</b></label></div>',
  '  <svg id="cv" viewBox="0 0 560 300"></svg>',
  '</div>',
  '<style>body{margin:0;font-family:system-ui,"Microsoft YaHei",sans-serif;background:#fff;color:#1a1a1a}.w{padding:10px 12px;box-sizing:border-box}.h{font-weight:700;font-size:15px;margin-bottom:8px}.ctl{display:flex;gap:18px;font-size:13px;margin-bottom:6px;align-items:center}label{display:flex;align-items:center;gap:6px}input[type=range]{width:130px}b{color:#c0392b;min-width:30px;display:inline-block}svg{width:100%;height:225px;background:#fbfbfd;border-radius:8px}</style>',
  '<script>',
  'var NS="http://www.w3.org/2000/svg";var cv=document.getElementById("cv"),a=document.getElementById("a"),k=document.getElementById("k");',
  'function mk(t,at){var e=document.createElementNS(NS,t);for(var p in at){e.setAttribute(p,at[p])}return e}',
  'function draw(){var A=parseFloat(a.value),K=parseFloat(k.value);document.getElementById("av").textContent=A;document.getElementById("kv").textContent=K;',
  'var W=560,H=300,ox=W/2,oy=H/2,sx=42,sy=24;function X(x){return ox+x*sx}function Y(y){return oy-y*sy}cv.innerHTML="";',
  'cv.appendChild(mk("line",{x1:0,y1:Y(0),x2:W,y2:Y(0),stroke:"#c9c9d2","stroke-width":1}));cv.appendChild(mk("line",{x1:X(0),y1:0,x2:X(0),y2:H,stroke:"#c9c9d2","stroke-width":1}));',
  'for(var t=-4;t<=4;t++){cv.appendChild(mk("line",{x1:X(t),y1:Y(0)-4,x2:X(t),y2:Y(0)+4,stroke:"#c9c9d2","stroke-width":1}))}',
  'var d="";for(var i=0;i<=200;i++){var x=-4+i*8/200;var y=A*(x-1)*(x-1)+K;d+=(i===0?"M":" L")+X(x)+" "+Y(y)}',
  'cv.appendChild(mk("path",{d:d,fill:"none",stroke:"#c0392b","stroke-width":3}));cv.appendChild(mk("circle",{cx:X(1),cy:Y(K),r:5,fill:"#c9a227"}));}',
  'a.addEventListener("input",draw);k.addEventListener("input",draw);draw();',
  '</script>',
].join('\n')

const demoProb = [
  '<div class="w">',
  '  <div class="h">频率的稳定性：抛硬币</div>',
  '  <div class="ctl"><button id="run">投掷 1000 次</button><button id="rs">重置</button><span>次数 <b id="n">0</b>　正面频率 <b id="f">--</b></span></div>',
  '  <svg id="cv" viewBox="0 0 560 260"></svg>',
  '</div>',
  '<style>body{margin:0;font-family:system-ui,"Microsoft YaHei",sans-serif;background:#fff;color:#1a1a1a}.w{padding:10px 12px;box-sizing:border-box}.h{font-weight:700;font-size:15px;margin-bottom:8px}.ctl{display:flex;gap:10px;align-items:center;font-size:13px;margin-bottom:6px}button{padding:4px 12px;border:1px solid #cbb;border-radius:6px;background:#fff;cursor:pointer}button:hover{background:#f6f4ff}b{color:#c0392b}svg{width:100%;height:205px;background:#fbfbfd;border-radius:8px}</style>',
  '<script>',
  'var NS="http://www.w3.org/2000/svg";var cv=document.getElementById("cv");var total=0,head=0,pts=[];',
  'function mk(t,at){var e=document.createElementNS(NS,t);for(var p in at){e.setAttribute(p,at[p])}return e}',
  'function draw(){var W=560,H=260;cv.innerHTML="";',
  'cv.appendChild(mk("line",{x1:40,y1:H-30,x2:W-10,y2:H-30,stroke:"#c9c9d2","stroke-width":1}));cv.appendChild(mk("line",{x1:40,y1:10,x2:40,y2:H-30,stroke:"#c9c9d2","stroke-width":1}));',
  'var y5=H-30-0.5*200;cv.appendChild(mk("line",{x1:40,y1:y5,x2:W-10,y2:y5,stroke:"#c0392b","stroke-width":1,"stroke-dasharray":"6 5"}));',
  'if(pts.length>1){var d="";for(var i=0;i<pts.length;i++){var x=40+(W-50)*pts[i][0];var y=H-30-pts[i][1]*200;d+=(i===0?"M":" L")+x+" "+y}cv.appendChild(mk("path",{d:d,fill:"none",stroke:"#2d70b3","stroke-width":2.5}))}',
  'document.getElementById("n").textContent=total;document.getElementById("f").textContent=total?(head/total).toFixed(4):"--";}',
  'document.getElementById("run").onclick=function(){for(var i=0;i<1000;i++){total++;if(Math.random()<0.5){head++}}if(pts.length<300){pts.push([Math.min(1,total/50000),head/total])}draw();};',
  'document.getElementById("rs").onclick=function(){total=0;head=0;pts=[];draw()};draw();',
  '</script>',
].join('\n')

export type MathAppletCat = '例题·组合公式' | '例题·GeoGebra' | '例题·Desmos' | '例题·HTML'
export interface MathAppletTemplate {
  id: string
  name: string
  cat: MathAppletCat
  tag: string
  desc: string
  build(): SlideElement[]
}

export const mathAppletTemplates: MathAppletTemplate[] = [
  // ================= 例题 · 组合公式 =================
  {
    id: 'ex-formula-quadratic', name: '例题 · 二次函数最值（组合公式）', cat: '例题·组合公式', tag: '组合公式',
    desc: '配方法 + 顶点式 + 区间讨论，关键公式并排呈现',
    build() {
      const els: SlideElement[] = []
      els.push(...base('例题 · 含参二次函数的最值', '01'))
      const c = leftCol()
      c.card([
        '例 已知函数 $f(x)=ax^{2}-2ax+1$（$a\\ne 0$）。',
        '（1）讨论 $f(x)$ 的单调性；',
        '（2）求 $f(x)$ 在区间 $[0,2]$ 上的最小值（用 $a$ 表示）。',
      ])
      c.line('分析 · 配方得顶点式，比较对称轴 $x=1$ 与区间 $[0,2]$ 的位置关系。', { fontSize: 24, color: ACCENT, fontWeight: 700 })
      c.formula('f(x)=a\\left(x-1\\right)^{2}+1-a', 32)
      c.block([
        '① 对称轴 $x=1$ 落在 $[0,2]$ 内，顶点即最低点或最高点。',
        '② $a>0$ 时开口向上，最小值在顶点处取得：$f_{\\min}=1-a$（$x=1$）。',
        '③ $a<0$ 时开口向下，最小值在端点处取得：$f_{\\min}=f(0)=f(2)=1$。',
      ], { fontSize: 26 })
      c.line('结论：$a>0$ 时最小值为 $1-a$；$a<0$ 时最小值为 $1$。', { fontSize: 26, color: ACCENT, fontWeight: 700 })
      els.push(...c.els)
      els.push(...formulaCard('关键公式', [
        'x=-\\dfrac{b}{2a}=-\\dfrac{-2a}{2a}=1',
        'f(x)=a\\left(x-1\\right)^{2}+1-a',
      ]))
      els.push(footer())
      return els
    },
  },
  {
    id: 'ex-formula-sequence', name: '例题 · 等比数列求和（组合公式）', cat: '例题·组合公式', tag: '组合公式',
    desc: '错位相减法 + 求和公式，两步连推',
    build() {
      const els: SlideElement[] = []
      els.push(...base('例题 · 等比数列的前 n 项和', '02'))
      const c = leftCol()
      c.card([
        '例 在等比数列 $\\{a_{n}\\}$ 中，首项 $a_{1}=1$，公比 $q=2$。',
        '（1）求通项公式；（2）求前 $n$ 项和 $S_{n}$。',
      ])
      c.line('分析 · 错位相减法：写出 $S_{n}$ 与 $qS_{n}$，两式相减消去中间项。', { fontSize: 24, color: ACCENT, fontWeight: 700 })
      c.formula('S_{n}=a_{1}+a_{1}q+\\cdots+a_{1}q^{n-1}', 30, 86)
      c.block([
        '① 通项：$a_{n}=a_{1}q^{n-1}=2^{n-1}$。',
        '② 求和：$S_{n}=\\frac{a_{1}\\left(1-q^{n}\\right)}{1-q}$（$q\\ne 1$）。',
        '③ 代入 $a_{1}=1,\\ q=2$：$S_{n}=\\frac{1-2^{n}}{1-2}=2^{n}-1$。',
      ], { fontSize: 26 })
      c.line('结论：$a_{n}=2^{n-1}$，$S_{n}=2^{n}-1$。', { fontSize: 26, color: ACCENT, fontWeight: 700 })
      els.push(...c.els)
      els.push(...formulaCard('关键公式', [
        'a_n=a_1q^{n-1}',
        'S_n=\\dfrac{a_1(1-q^{n})}{1-q}',
      ]))
      els.push(footer())
      return els
    },
  },

  // ================= 例题 + GeoGebra =================
  {
    id: 'ex-ggb-quad', name: '例题 · 二次函数最值 + GeoGebra', cat: '例题·GeoGebra', tag: 'GeoGebra',
    desc: '滑杆 a 实时变化，看开口方向与顶点',
    build() {
      const els: SlideElement[] = []
      els.push(...base('例题 · 二次函数最值（GeoGebra 动态）', '03'))
      const c = leftCol()
      c.card([
        '例 已知函数 $f(x)=ax^{2}-2ax+1$（$a\\ne 0$）。',
        '（1）讨论 $f(x)$ 的单调性；（2）求 $f(x)$ 在 $[0,2]$ 上的最小值。',
      ])
      c.line('分析 · 拖动滑杆 $a$，观察开口方向与顶点位置的变化。', { fontSize: 24, color: ACCENT, fontWeight: 700 })
      c.formula('f(x)=a\\left(x-1\\right)^{2}+1-a', 32)
      c.block([
        '① 对称轴 $x=1$ 落在 $[0,2]$ 内，顶点处取到最值。',
        '② $a>0$ 时开口向上：$f_{\\min}=1-a$；$a<0$ 时开口向下：$f_{\\min}=1$。',
      ], { fontSize: 26 })
      c.line('结论：动图与结论互相印证 —— 顶点纵坐标 $1-a$ 随 $a$ 变化。', { fontSize: 26, color: ACCENT, fontWeight: 700 })
      els.push(...c.els)
      els.push(ggb(1180, 200, 620, 660, [
        'a=Slider(-3,3,0.1)',
        'f(x)=a*x^2-2*a*x+1',
        'V=(1,1-a)',
        'SetColor(f,192,57,43)',
        'SetLineThickness(f,5)',
        'SetColor(V,201,162,39)',
        'SetPointSize(V,6)',
      ]))
      els.push(txt(1180, 876, 620, 40, '拖动滑杆 a，对照左侧结论', { fontSize: 20, color: SUB }))
      els.push(footer())
      return els
    },
  },
  {
    id: 'ex-ggb-ellipse', name: '例题 · 椭圆的定义 + GeoGebra', cat: '例题·GeoGebra', tag: 'GeoGebra',
    desc: '拖动点 P，验证 |PF₁|+|PF₂| 为定值',
    build() {
      const els: SlideElement[] = []
      els.push(...base('例题 · 椭圆的定义（GeoGebra 动态）', '04'))
      const c = leftCol()
      c.card([
        '例 两定点 $F_{1}(-3,0)$、$F_{2}(3,0)$，动点 $P$ 满足 $\\left|PF_{1}\\right|+\\left|PF_{2}\\right|=2a$（$a>3$）。',
        '（1）求动点 $P$ 的轨迹方程；（2）求椭圆的离心率 $e$。',
      ])
      c.line('分析 · 到两定点的距离之和为定值，轨迹是以 $F_{1}$、$F_{2}$ 为焦点的椭圆。', { fontSize: 24, color: ACCENT, fontWeight: 700 })
      c.formula('\\left|PF_{1}\\right|+\\left|PF_{2}\\right|=2a>2c=6', 32)
      c.block([
        '① 由 $F_{1}F_{2}=6$ 得 $c=3$，故 $b^{2}=a^{2}-c^{2}=a^{2}-9$。',
        '② 轨迹方程：$\\frac{x^{2}}{a^{2}}+\\frac{y^{2}}{a^{2}-9}=1$（$a>3$）。',
        '③ 离心率：$e=\\frac{c}{a}=\\frac{3}{a}$。',
      ], { fontSize: 26 })
      c.line('结论：轨迹为椭圆，离心率 $e=\\frac{3}{a}$。', { fontSize: 26, color: ACCENT, fontWeight: 700 })
      els.push(...c.els)
      els.push(ggb(1180, 200, 620, 660, [
        'F_1=(-3,0)',
        'F_2=(3,0)',
        'a=Slider(3.2,6,0.1)',
        'c=3',
        'b=sqrt(a^2-c^2)',
        'e=Ellipse(F_1,F_2,a)',
        'P=Point(e)',
        's_1=Segment(F_1,P)',
        's_2=Segment(F_2,P)',
        'SetColor(e,68,114,196)',
        'SetLineThickness(e,5)',
        'SetColor(s_1,192,57,43)',
        'SetColor(s_2,201,162,39)',
      ]))
      els.push(txt(1180, 876, 620, 40, '拖动点 P，两条焦半径之和恒为 2a', { fontSize: 20, color: SUB }))
      els.push(footer())
      return els
    },
  },

  // ================= 例题 + Desmos =================
  {
    id: 'ex-desmos-func', name: '例题 · 函数图像变换 + Desmos', cat: '例题·Desmos', tag: 'Desmos',
    desc: '滑杆 a / h / k 实时平移伸缩',
    build() {
      const els: SlideElement[] = []
      els.push(...base('例题 · 函数图像的平移与伸缩（Desmos）', '05'))
      const c = leftCol()
      c.card([
        '例 已知 $f(x)=x^{2}$。',
        '（1）说明 $y=a\\,f(x-h)+k$ 的图象如何由 $y=f(x)$ 的图象得到；',
        '（2）若图象经过点 $(3,5)$ 且顶点为 $(1,1)$，求 $a$。',
      ])
      c.line('分析 · 先平移、再伸缩，注意变换顺序与符号。', { fontSize: 24, color: ACCENT, fontWeight: 700 })
      c.formula('y=a\\,f(x-h)+k', 32)
      c.block([
        '① 把 $y=f(x)$ 的图象向右平移 $h$ 个单位、向上平移 $k$ 个单位，再把纵坐标乘 $|a|$。',
        '② 顶点为 $(1,1)$，故 $h=1$、$k=1$，即 $y=a(x-1)^{2}+1$。',
        '③ 代入 $(3,5)$：$4a+1=5$，解得 $a=1$。',
      ], { fontSize: 26 })
      c.line('结论：$a=1$，即 $y=(x-1)^{2}+1$。', { fontSize: 26, color: ACCENT, fontWeight: 700 })
      els.push(...c.els)
      els.push(desmos(1180, 200, 620, 660, [
        { id: '1', type: 'expression', latex: 'f(x)=x^{2}', color: '#2d70b3' },
        { id: '2', type: 'expression', latex: 'a=1', sliderBounds: { min: -3, max: 3, step: 0.1 }, color: '#c74440' },
        { id: '3', type: 'expression', latex: 'h=0', sliderBounds: { min: -5, max: 5, step: 0.1 }, color: '#c74440' },
        { id: '4', type: 'expression', latex: 'k=0', sliderBounds: { min: -5, max: 5, step: 0.1 }, color: '#c74440' },
        { id: '5', type: 'expression', latex: 'y=a f(x-h)+k', color: '#c74440' },
        { id: '6', type: 'expression', latex: '(h,k)', color: '#388c46' },
      ]))
      els.push(txt(1180, 876, 620, 40, '拖动 a、h、k 三个滑杆，观察图像变化', { fontSize: 20, color: SUB }))
      els.push(footer())
      return els
    },
  },
  {
    id: 'ex-desmos-trig', name: '例题 · 三角函数图象 + Desmos', cat: '例题·Desmos', tag: 'Desmos',
    desc: '滑杆 A / ω / φ，看振幅周期相位',
    build() {
      const els: SlideElement[] = []
      els.push(...base('例题 · 三角函数图象（Desmos 动态）', '06'))
      const c = leftCol()
      c.card([
        '例 $y=A\\sin(\\omega x+\\varphi)$（$A>0$，$\\omega>0$，$|\\varphi|<\\frac{\\pi}{2}$），',
        '最高点 $\\left(\\frac{\\pi}{6},3\\right)$，相邻最低点 $\\left(\\frac{2\\pi}{3},-3\\right)$，求解析式。',
      ], { fontSize: 26 })
      c.line('分析 · 由最值定 $A$，由周期定 $\\omega$，由最高点定 $\\varphi$。', { fontSize: 24, color: ACCENT, fontWeight: 700 })
      c.formula('T=\\dfrac{2\\pi}{\\omega},\\qquad A=3', 30, 86)
      c.block([
        '① 由最高点纵坐标得 $A=3$。',
        '② 半周期 $\\frac{T}{2}=\\frac{2\\pi}{3}-\\frac{\\pi}{6}=\\frac{\\pi}{2}$，得 $T=\\pi$，$\\omega=2$。',
        '③ 代入最高点：$\\sin\\left(2\\cdot\\frac{\\pi}{6}+\\varphi\\right)=1$，得 $\\varphi=\\frac{\\pi}{6}$。',
      ], { fontSize: 26 })
      c.line('结论：$y=3\\sin\\left(2x+\\frac{\\pi}{6}\\right)$。', { fontSize: 26, color: ACCENT, fontWeight: 700 })
      els.push(...c.els)
      els.push(desmos(1180, 200, 620, 660, [
        { id: '1', type: 'expression', latex: 'y=\\sin(x)', color: '#9aa0a6' },
        { id: '2', type: 'expression', latex: 'A=3', sliderBounds: { min: 0.5, max: 4, step: 0.1 }, color: '#c74440' },
        { id: '3', type: 'expression', latex: 'b=2', sliderBounds: { min: 0.5, max: 4, step: 0.1 }, color: '#c74440' },
        { id: '4', type: 'expression', latex: 'c=0.52', sliderBounds: { min: -3.14, max: 3.14, step: 0.01 }, color: '#c74440' },
        { id: '5', type: 'expression', latex: 'y=A\\sin(bx+c)', color: '#c74440' },
      ]))
      els.push(txt(1180, 876, 620, 40, '拖动 A、b、c，分别改变振幅、周期、平移', { fontSize: 20, color: SUB }))
      els.push(footer())
      return els
    },
  },

  // ================= 例题 + HTML =================
  {
    id: 'ex-html-parabola', name: '例题 · 二次函数（内嵌 HTML 动态）', cat: '例题·HTML', tag: '内嵌 HTML',
    desc: '自写 SVG 小程序，滑杆实时重绘抛物线',
    build() {
      const els: SlideElement[] = []
      els.push(...base('例题 · 二次函数最值（内嵌 HTML 动态）', '07'))
      const c = leftCol()
      c.card([
        '例 设 $f(x)=a(x-1)^{2}+k$（$a\\ne 0$）。',
        '（1）当 $a>0$ 时求 $f(x)$ 的最小值；（2）若顶点在 $x$ 轴上，求 $k$。',
      ])
      c.line('分析 · 顶点式可直接读出最值；顶点在 $x$ 轴上 $\\Leftrightarrow$ 纵坐标为 $0$。', { fontSize: 24, color: ACCENT, fontWeight: 700 })
      c.formula('f_{\\min}=k\\quad(a>0)', 32)
      c.block([
        '① $a>0$ 时开口向上，最小值在顶点处取得：$f_{\\min}=k$。',
        '② 顶点为 $(1,k)$，在 $x$ 轴上 $\\Leftrightarrow$ $k=0$。',
        '③ $a<0$ 时开口向下，顶点处取到最大值 $k$。',
      ], { fontSize: 26 })
      c.line('结论：$a>0$ 时最小值为 $k$；顶点在 $x$ 轴上时 $k=0$。', { fontSize: 26, color: ACCENT, fontWeight: 700 })
      els.push(...c.els)
      els.push(html(1180, 200, 620, 660, demoParabola))
      els.push(txt(1180, 876, 620, 40, '内嵌 SVG 小程序：拖滑杆实时重绘', { fontSize: 20, color: SUB }))
      els.push(footer())
      return els
    },
  },
  {
    id: 'ex-html-prob', name: '例题 · 频率与概率（内嵌 HTML 模拟）', cat: '例题·HTML', tag: '内嵌 HTML',
    desc: '抛硬币模拟，观察频率稳定于概率',
    build() {
      const els: SlideElement[] = []
      els.push(...base('例题 · 频率的稳定性（内嵌 HTML 模拟）', '08'))
      const c = leftCol()
      c.card([
        '例 抛掷一枚质地均匀的硬币，正面朝上的概率为 $0.5$。',
        '（1）解释“频率的稳定性”；（2）抛掷 $1000$ 次，正面出现的频率约为多少？',
      ])
      c.line('分析 · 频率随试验而波动，但随试验次数增大稳定于概率。', { fontSize: 24, color: ACCENT, fontWeight: 700 })
      c.formula('f_{n}(A)\\to P(A)\\quad(n\\to\\infty)', 32)
      c.block([
        '① 频率 $f_{n}=\\frac{m}{n}$，其中 $m$ 为正面次数，$n$ 为总次数。',
        '② 随 $n$ 增大，$f_{n}$ 围绕 $0.5$ 波动，且波动幅度越来越小。',
        '③ 用频率估计概率：$P(A)\\approx f_{n}$。',
      ], { fontSize: 26 })
      c.line('结论：抛掷 $1000$ 次时，正面频率在 $0.5$ 附近，可用它估计 $P(A)=0.5$。', { fontSize: 26, color: ACCENT, fontWeight: 700 })
      els.push(...c.els)
      els.push(html(1180, 200, 620, 660, demoProb))
      els.push(txt(1180, 876, 620, 40, '点“投掷 1000 次”多次累积，折线逐渐贴近 0.5', { fontSize: 20, color: SUB }))
      els.push(footer())
      return els
    },
  },
]

export function findMathAppletTemplate(id: string): MathAppletTemplate | undefined {
  return mathAppletTemplates.find((t) => t.id === id)
}
