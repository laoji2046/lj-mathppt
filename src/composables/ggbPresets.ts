/**
 * 【v1514】GeoGebra 套件 · 预制例子库 + 指令帮助数据 ✓
 *
 * 为什么单独一个文件：例子和帮助都是纯数据，塞进 \`GgbSuite.vue\` 会把它撑到上千行 ✗；
 * 而且这些内容要能一处改、两处用（例子下拉 + 帮助面板）✓。
 *
 * ⚠ 这里每一条都在真机绘图板上验过（\`.probe/v6100run.ps1\`：30 组指令 + 7 段 JS 全过 ✓，
 *    帮助里列的 JS 方法也对 \`window[ggb_suite_*]\` 逐个 \`typeof\` 核过 ✓）——
 *    改内容的时候必须重跑那个探针，别让"教学文档"教错东西 ✗。
 */
export type GgbSampleMode = 'js' | 'cmd'

export interface GgbSample {
  group: string
  label: string
  mode: GgbSampleMode
  /** 需要注意的一句话（比如 3D 要先开 3D 视图）；会显示在"已填入"提示里 ✓ */
  note?: string
  code: string
}

export interface GgbHelpItem {
  code: string
  desc: string
  /**
   * cmd = GeoGebra 指令（在 JS 模式下会包成 ggb.evalCommand ✓）
   * js  = 直接写进脚本的一行 ✓
   * say = 中文句子，填进上面的「AI 作图」框 ✓
   */
  kind: 'cmd' | 'js' | 'say'
}
export interface GgbHelpGroup {
  id: string
  title: string
  tip?: string
  items: GgbHelpItem[]
}

const c = (code: string, desc: string): GgbHelpItem => ({ code, desc, kind: 'cmd' })
const j = (code: string, desc: string): GgbHelpItem => ({ code, desc, kind: 'js' })
const s = (say: string, desc: string): GgbHelpItem => ({ code: say, desc, kind: 'say' })

/* ------------------------------------------------------------------ *
 * 一、预制例子（"插入例子…" 下拉，按分组显示 ✓）
 * ------------------------------------------------------------------ */
export const SAMPLES: GgbSample[] = [
  /* --- 基础作图 --- */
  { group: '基础作图', label: '三角形 + 中线（指令）', mode: 'cmd', code: [
    'A=(0,0)',
    'B=(4,0)',
    'C=(2,3)',
    'poly1=Polygon(A,B,C)',
    'M=Midpoint(A,B)',
    's=Segment(C,M)',
  ].join('\n') },
  { group: '基础作图', label: '等边三角形 + 外接圆（指令）', mode: 'cmd', code: [
    'A=(0,0)',
    'B=(4,0)',
    'C=Rotate(B,60°,(A))',
    'poly1=Polygon(A,B,C)',
    'circ=Circle(A,B,C)',
  ].join('\n') },
  { group: '基础作图', label: '垂直平分线 → 外心（指令）', mode: 'cmd', code: [
    'A=(0,0)',
    'B=(4,0)',
    'C=(1,3)',
    'poly1=Polygon(A,B,C)',
    'p1=PerpendicularBisector(A,B)',
    'p2=PerpendicularBisector(B,C)',
    'O=Intersect(p1,p2)',
    'circ=Circle(O,A)',
  ].join('\n') },
  { group: '基础作图', label: '角平分线 → 内心（指令）', mode: 'cmd', code: [
    'A=(0,0)',
    'B=(4,0)',
    'C=(1,3)',
    'poly1=Polygon(A,B,C)',
    'd1=AngleBisector(A,B,C)',
    'd2=AngleBisector(B,C,A)',
    'I=Intersect(d1,d2)',
  ].join('\n') },
  { group: '基础作图', label: '圆外一点的切线（指令）', mode: 'cmd', code: [
    'O=(0,0)',
    'c=Circle(O,3)',
    'A=(5,0)',
    't1=Tangent(A,c)',
    'M=Midpoint(O,A)',
  ].join('\n') },
  { group: '基础作图', label: '中位线（指令）', mode: 'cmd', code: [
    'A=(0,0)',
    'B=(4,0)',
    'C=(1,3)',
    'poly1=Polygon(A,B,C)',
    'M=Midpoint(A,B)',
    'N=Midpoint(A,C)',
    's=Segment(M,N)',
  ].join('\n') },
  { group: '基础作图', label: '勾股定理 · 三边正方形（指令）', mode: 'cmd', code: [
    'A=(0,0)',
    'B=(4,0)',
    'C=(0,3)',
    'poly1=Polygon(A,B,C)',
    'q1=Polygon(A,B,4)',
    'q2=Polygon(B,C,4)',
    'q3=Polygon(C,A,4)',
  ].join('\n') },

  /* --- 函数与图像 --- */
  { group: '函数与图像', label: '一次函数 k / b 滑动条（指令）', mode: 'cmd', note: '拖 k 看陡缓、拖 b 看上下平移（b 就是与 y 轴交点的纵坐标 ✓）', code: [
    'k=Slider(-3,3,0.5)',
    'b=Slider(-5,5,1)',
    'f(x)=k x+b',
  ].join('\n') },
  { group: '函数与图像', label: '二次函数顶点式（指令）', mode: 'cmd', note: '拖动 a / h / k 三个滑动条，看顶点和开口怎么变 ✓', code: [
    'a=Slider(0.2,3,0.1)',
    'h=Slider(-4,4,0.5)',
    'k=Slider(-4,4,0.5)',
    'f(x)=a (x-h)^2+k',
    'V=(h,k)',
  ].join('\n') },
  { group: '函数与图像', label: '分段函数（指令）', mode: 'cmd', code: [
    'f(x)=If(x<0,-x,x)',
    'g(x)=If(-2<x<2,x^2,4)',
  ].join('\n') },
  { group: '函数与图像', label: '正弦型函数 amp·sin(ωx)（指令）', mode: 'cmd', note: 'amp 是振幅、ω 决定周期（ω 是希腊字母，直接敲 ω ✓）', code: [
    'amp=Slider(0.5,3,0.1)',
    'ω=Slider(0.5,4,0.1)',
    'f(x)=amp sin(ω x)',
  ].join('\n') },
  { group: '函数与图像', label: '指数函数与对数函数（指令）', mode: 'cmd', code: [
    'f(x)=2^x',
    'g(x)=log(2,x)',
    'h(x)=x',
  ].join('\n') },
  { group: '函数与图像', label: '导数与切线（指令）', mode: 'cmd', code: [
    'f(x)=x^3-3x',
    'g(x)=Derivative(f)',
    'A=(1,f(1))',
    't=Tangent(A,f)',
    'r=Root(f)',
  ].join('\n') },
  { group: '函数与图像', label: '反比例函数 · 面积不变（指令）', mode: 'cmd', note: '拖一下 P，矩形面积始终是 6 ✓', code: [
    'f(x)=6/x',
    'P=Point(f)',
    'A=(x(P),0)',
    'B=(0,y(P))',
    'poly1=Polygon((0,0),A,P,B)',
  ].join('\n') },
  { group: '函数与图像', label: '抛物线族 · JS 循环（JS）', mode: 'js', code: [
    '// JS 的强项：循环 + 计算 —— 一次性画一族曲线 ✓',
    'for (let i = 1; i <= 5; i++) {',
    "  ggb.evalCommand('f_' + i + '(x)=' + i + ' x^2 / 5')",
    "  ggb.setColor('f_' + i, 40 + i * 30, 90, 220 - i * 25)",
    '}',
    "return '画了 5 条抛物线'",
  ].join('\n') },

  /* --- 圆锥曲线 --- */
  { group: '圆锥曲线', label: '椭圆 · 两焦点距离和（指令）', mode: 'cmd', note: '拖 a 滑动条，看 |PF₁|+|PF₂| 始终等于 2a ✓', code: [
    'F1=(-3,0)',
    'F2=(3,0)',
    'a=Slider(3.5,6,0.1)',
    'e=Ellipse(F1,F2,a)',
    'P=Point(e)',
    's1=Segment(P,F1)',
    's2=Segment(P,F2)',
  ].join('\n') },
  { group: '圆锥曲线', label: '双曲线与渐近线（指令）', mode: 'cmd', code: [
    'F1=(-4,0)',
    'F2=(4,0)',
    'hyp=Hyperbola(F1,F2,3)',
    'as=Asymptote(hyp)',
  ].join('\n') },
  { group: '圆锥曲线', label: '抛物线 · 焦点与准线（指令）', mode: 'cmd', code: [
    'F=(0,1)',
    'l: y=-1',
    'p=Parabola(F,l)',
    'P=Point(p)',
    'd=Segment(P,F)',
    'n=PerpendicularLine(P,l)',
  ].join('\n') },
  { group: '圆锥曲线', label: '参数方程 / 极坐标曲线（指令）', mode: 'cmd', code: [
    'curve1=Curve(cos(t),sin(t),t,0,2 pi)',
    'rose=Curve(cos(3 t) cos(t),cos(3 t) sin(t),t,0,pi)',
  ].join('\n') },

  /* --- 变换 --- */
  { group: '变换', label: '向量平移（指令）', mode: 'cmd', code: [
    'A=(0,0)',
    'B=(3,0)',
    'C=(1,2)',
    'poly1=Polygon(A,B,C)',
    'u=Vector((1,2))',
    'poly2=Translate(poly1,u)',
  ].join('\n') },
  { group: '变换', label: '旋转与轴对称（指令）', mode: 'cmd', code: [
    'poly1=Polygon((0,0),(3,0),(2,2))',
    'poly2=Rotate(poly1,90°,(0,0))',
    'poly3=Reflect(poly1,x=0)',
  ].join('\n') },
  { group: '变换', label: '位似（放大两倍）（指令）', mode: 'cmd', code: [
    'poly1=Polygon((0,0),(3,0),(2,2))',
    'poly2=Dilate(poly1,2,(0,0))',
  ].join('\n') },

  /* --- 数列与统计 --- */
  { group: '数列与统计', label: '数列 · 点列与通项（指令）', mode: 'cmd', code: [
    'pts=Sequence((n,n^2/4),n,1,8)',
    'l1=Sequence(n^2/4,n,1,8)',
  ].join('\n') },
  { group: '数列与统计', label: '条形图 + 平均数 / 标准差（指令）', mode: 'cmd', code: [
    'l1={2,3,3,4,5,5,5,6}',
    'm=Mean(l1)',
    's=SD(l1)',
    'bar=BarChart(l1,1)',
  ].join('\n') },
  { group: '数列与统计', label: '正态分布曲线下面积（指令）', mode: 'cmd', code: [
    'f(x)=Normal(0,1,x)',
    'area=Integral(f,-1,1)',
  ].join('\n') },
  { group: '数列与统计', label: '不等式与区域（指令）', mode: 'cmd', code: [
    'x^2+y^2<9',
    'y>2x-1',
  ].join('\n') },

  /* --- 动态与动画 --- */
  { group: '动态与动画', label: '点在圆上跑（JS 开动画）', mode: 'js', note: '运行后点 P 自己会转；想看轨迹就用下面那条 setTrace ✓', code: [
    "ggb.evalCommand('c=Circle((0,0),3)')",
    "ggb.evalCommand('t=Slider(0,6.28,0.02)')",
    "ggb.evalCommand('P=(3 cos(t),3 sin(t))')",
    "ggb.evalCommand('s=Segment((0,0),P)')",
    "ggb.startAnimation('t')      // 让滑动条自己动 → P 就动起来了 ✓",
    "return 't 已在动：' + ggb.getValueString('t')",
  ].join('\n') },
  { group: '动态与动画', label: '轨迹 Locus（指令）', mode: 'cmd', note: '拖 A 绕圆走，M 的轨迹会一条条画出来 ✓', code: [
    'c=Circle((0,0),3)',
    'A=Point(c)',
    'B=(5,0)',
    'M=Midpoint(A,B)',
    'loc=Locus(M,A)',
  ].join('\n') },
  { group: '动态与动画', label: '随机出题 · 求两点距离（JS）', mode: 'js', code: [
    '// 每点一次「运行」换一组坐标 ✓ —— 课堂练习题现场生成',
    'const rnd = function (n) { return Math.round(Math.random() * n * 2 - n) }',
    "ggb.evalCommand('A=(' + rnd(4) + ',' + rnd(3) + ')')",
    "ggb.evalCommand('B=(' + rnd(4) + ',' + rnd(3) + ')')",
    "ggb.evalCommand('s=Segment(A,B)')",
    "ggb.evalCommand('d=Distance(A,B)')",
    "return 'AB = ' + ggb.getValueString('d')",
  ].join('\n') },
  { group: '动态与动画', label: '3D 立体（指令）', mode: 'cmd', note: '先把上面下拉框切成「🧊 3D 计算器」，否则 3D 视图是关着的看不见 ✓', code: [
    'cube1=Cube((0,0,0),(2,0,0))',
    'pyr1=Pyramid((0,0,0),(3,0,0),(0,3,0),(0,0,3))',
    'pri1=Prism((0,0,0),(2,0,0),(0,2,0),(0,0,3))',
  ].join('\n') },

  /* --- 批处理与样式 --- */
  { group: '批处理与样式', label: '一键"板书风"（JS 遍历上色）', mode: 'js', code: [
    '// 把所有对象统一成一种颜色、加粗 —— JS 才做得到"批量" ✓',
    'const names = ggb.getAllObjectNames()',
    'names.forEach(function (n) {',
    '  ggb.setColor(n, 30, 60, 160)',
    '  ggb.setLineThickness(n, 5)',
    '})',
    "return '已统一 ' + names.length + ' 个对象的样式'",
  ].join('\n') },
  { group: '批处理与样式', label: '批量画 3~8 边形（JS）', mode: 'js', code: [
    'for (let n = 3; n <= 8; n++) {',
    '  const x = n * 2.6',
    "  ggb.evalCommand('poly_' + n + '=Polygon((' + x + ',0),(' + (x + 2) + ',0),' + n + ')')",
    "  ggb.setColor('poly_' + n, 20 * n, 80, 200 - 20 * n)",
    "  ggb.setFilling('poly_' + n, 0.15)",
    '}',
    "return '画了 3~8 边形'",
  ].join('\n') },
  { group: '批处理与样式', label: '清点对象 · 分类统计（JS）', mode: 'js', code: [
    'const names = ggb.getAllObjectNames()',
    'const kinds = {}',
    'names.forEach(function (n) {',
    '  const t = ggb.getObjectType(n)',
    '  kinds[t] = (kinds[t] || 0) + 1',
    '})',
    "return names.length + ' 个对象：' + JSON.stringify(kinds)",
  ].join('\n') },
  { group: '批处理与样式', label: '读回作图信息（JS）', mode: 'js', code: [
    'const names = ggb.getAllObjectNames()',
    "const rows = names.map(function (n) { return n + '=' + ggb.getValueString(n) })",
    "return names.length + ' 个对象：' + rows.join(' | ')",
  ].join('\n') },
  { group: '批处理与样式', label: '改名 + 显示坐标标签（JS）', mode: 'js', note: '让 GeoGebra 自己起名、再改名 —— 这样连着跑几遍也不会"名字被占用" ✗', code: [
    "// evalCommandGetLabels 会返回它自动起的名字（A、B… 不会撞车 ✓）",
    "const base = ggb.evalCommandGetLabels('(2,3)')",
    "let n = 1",
    "while (ggb.exists(base + '_' + n)) n++      // 防重名：跑第二遍也不炸 ✓",
    "const nn = base + '_' + n",
    "ggb.renameObject(base, nn)",
    "ggb.setLabelVisible(nn, true)",
    "ggb.setLabelStyle(nn, 3)                    // 3 = 显示「名称和值」 ✓",
    "return '已把 ' + base + ' 改名成 ' + nn + '，并显示标签 ✓'",
  ].join('\n') },
  { group: '批处理与样式', label: '导出整份作图 XML（JS）', mode: 'js', code: [
    '// getXML() 拿到整份作图（可存起来 / 发给别人 ✓）',
    "return ggb.getXML().slice(0, 240) + '…'",
  ].join('\n') },
]

/** 例子下拉里的分组顺序（按出现顺序 ✓） */
export const SAMPLE_GROUPS: string[] = SAMPLES.reduce<string[]>((acc, s) => {
  if (!acc.includes(s.group)) acc.push(s.group)
  return acc
}, [])

/** 某分组里的例子在原数组里的下标（下拉里要给出全局下标 ✓） */
export function sampleIndexOf(group: string): number[] {
  return SAMPLES.map((s, i) => ({ s, i })).filter((x) => x.s.group === group).map((x) => x.i)
}

/* ------------------------------------------------------------------ *
 * 二、指令帮助（帮助面板：分类 + 搜索 + 一键填入 ✓）
 *     下面列到的 JS 方法，都在真机 \`window[ggb_suite_*]\` 上 \`typeof === 'function'\` 核过 ✓
 * ------------------------------------------------------------------ */
export const HELP_GROUPS: GgbHelpGroup[] = [
  {
    id: 'syntax',
    title: '语法速查',
    tip: '最常见的一个坑：逗号、括号、等号都要英文半角 ✗（中文输入法下打出来的「，」GeoGebra 不认）。'
      + ' ⚑ 这个版本（GeoGebra 5.0 网页版）没有 SetColor / SetLineThickness / Delete / Rename / RegularPolygon 这些指令 ✗ ——'
      + ' 样式和增删改请到「JavaScript API」或「样式 · 交互」那一栏用 ggb.xxx 做 ✓。',
    items: [
      c('A=(1,2)', '建点 A（坐标用英文括号 + 英文逗号）'),
      c('c: Circle((0,0),2)', '冒号 = 给这个对象起名字 c（不起名它自己编号）'),
      c('f(x)=x^2-2x', '建函数（也可以直接写 y=x^2-2x）'),
      c('l1={1,2,3}', '建列表（统计、Sequence 都用它）'),
      c('A_1=(1,0)', '下标：A_1、A_2 …'),
      c('90°', '角度：写 90° 或 90 deg'),
      c('2 pi', '圆周率写 pi（2 pi 就是 2π）'),
      c('2x', '乘号可以省：2x、3(x+1) 都行'),
      c('sqrt(2)', '根号；abs(x) 绝对值；sin(x) 正弦'),
      c('x^2+y^2=9', '直接写方程就是曲线（不用起名也能画）'),
    ],
  },
  {
    id: 'pointline',
    title: '点 · 线 · 圆',
    items: [
      c('A=(1,2)', '点'),
      c('A=Point(c)', '在对象 c 上取一个可拖动的点'),
      c('Segment(A,B)', '线段'),
      c('Line(A,B)', '直线'),
      c('Ray(A,B)', '射线'),
      c('Vector(A,B)', '向量'),
      c('Midpoint(A,B)', '中点'),
      c('Tangent(A,c)', '过圆外一点作切线（切点自动生成 ✓）'),
      c('Circle((0,0),2)', '圆（圆心 + 半径）'),
      c('Circle(A,B)', '圆（圆心 A，过 B）'),
      c('Circle(A,B,C)', '过三点的圆（外接圆）'),
      c('Semicircle(A,B)', '半圆'),
      c('Arc(c,A,B)', '圆弧'),
      c('Intersect(f,g)', '交点（两个对象相交）'),
      c('Distance(A,B)', '距离 / 长度'),
    ],
  },
  {
    id: 'polygon',
    title: '多边形 · 角',
    items: [
      c('Polygon(A,B,C)', '多边形（按顶点顺序）'),
      c('Polygon(A,B,5)', '正五边形（边 AB + 边数 ✓，一条指令搞定）'),
      c('Polygon(A,B,6)', '正六边形（和正五边形一个写法，只改边数 ✓）'),
      c('Vertex(poly1,3)', '取多边形的第 3 个顶点'),
      c('Angle(A,B,C)', '角 ∠ABC（B 是顶点）'),
      c('AngleBisector(A,B,C)', '角平分线'),
      c('PerpendicularLine(P,f)', '过 P 作 f 的垂线'),
      c('Line(P,l)', '过 P 作直线 l 的平行线（是 Line，不是 ParallelLine ✗）'),
      c('PerpendicularBisector(A,B)', '中垂线（垂直平分线）'),
      c('Center(c)', '圆心（这个版本没有 Centroid / Circumcenter 这类「心」指令 ✗ —— 用中垂线交点自己作，见「垂直平分线 → 外心」例子 ✓）'),
    ],
  },
  {
    id: 'function',
    title: '函数 · 方程',
    items: [
      c('f(x)=x^2-2x', '显函数'),
      c('f(x)=If(x<0,-x,x)', '分段函数（If 三分支：条件、真值、假值）'),
      c('g(x)=Derivative(f)', '导函数'),
      c('Integral(f,0,2)', '定积分（顺便画出曲边梯形）'),
      c('Tangent((1,1),f)', '切线（点 + 函数/曲线）'),
      c('Root(f)', '零点（可写 Root(f,1,3) 限定区间）'),
      c('Extremum(f)', '极值点'),
      c('Intersect(f,g)', '交点'),
      c('Slider(-3,3,0.1)', '滑动条（最小、最大、步长 ✓ 课堂拖动神器）'),
      c('k=2', '直接赋值（把滑动条设成 2；想在 JS 里赋值用 ggb.setValue ✓）'),
      c('2x+3y=6', '直线方程直接写就画出来 ✓；交点用 Intersect 或直接解方程'),
      c('log(2,x)', '以 2 为底的对数；ln(x) 自然对数'),
    ],
  },
  {
    id: 'conic',
    title: '圆锥曲线',
    items: [
      c('Ellipse(F1,F2,3)', '椭圆（两焦点 + 半长轴 a）'),
      c('Hyperbola(F1,F2,3)', '双曲线（两焦点 + 半实轴 a）'),
      c('Parabola(F,l)', '抛物线（焦点 + 准线）'),
      c('Asymptote(hyp)', '渐近线'),
      c('Focus(e)', '焦点；Directrix(p) 准线'),
      c('Curve(cos(t),sin(t),t,0,2 pi)', '参数方程曲线（t 从 0 到 2π）'),
      c('Curve(cos(3t)cos(t),cos(3t)sin(t),t,0,pi)', '极坐标/参数方程画玫瑰线'),
      c('x^2/4+y^2/9=1', '直接写标准方程也行'),
    ],
  },
  {
    id: 'transform',
    title: '变换 · 向量',
    items: [
      c('Translate(poly1,u)', '平移（对象 + 向量）'),
      c('Rotate(poly1,90°,(0,0))', '旋转（对象 + 角 + 旋转中心）'),
      c('Reflect(poly1, x=0)', '关于直线 x=0 对称（写反射轴的方程 ✓ —— 写 yAxis 这个版本反而不认 ✗）'),
      c('Dilate(poly1,2,(0,0))', '位似（放大 2 倍，中心原点）'),
      c('u=Vector((1,2))', '自由向量'),
      c('Zip(f,x,l1)', '把函数作用到列表上（批量计算）'),
    ],
  },
  {
    id: 'stats',
    title: '数列 · 统计',
    items: [
      c('Sequence((n,n^2),n,1,10)', '数列点列（n 从 1 到 10）'),
      c('l1={2,3,3,4,5}', '数据列表'),
      c('Mean(l1)', '平均数；SD(l1) 标准差'),
      c('Median(l1)', '中位数；Mode(l1) 众数'),
      c('BarChart(l1,1)', '条形图（数据 + 条宽）'),
      c('Histogram(l1,l2)', '直方图（数据 + 分界点列表）'),
      c('Normal(0,1,x)', '正态分布密度函数'),
      c('Integral(f,-1,1)', '曲线下面积（概率）'),
    ],
  },
  {
    id: 'style',
    title: '样式 · 交互',
    tip: '⚑ 真机实测：SetColor / SetLineThickness / SetFilling / StartAnimation 这些"样式指令"在这个版本的 GeoGebra 里打不进去 ✗'
      + '（它们只在 GeoGebra 自己的脚本里能用）。样式请用下面这几条 JavaScript（点「填入」会自动切到 JS 模式 ✓），'
      + '或者直接在绘图板里右键对象 →「设置」改 ✓。',
    items: [
      j("ggb.setColor('c',200,60,60)", '改颜色（JS API 用 0~255 ✓）'),
      j("ggb.setLineThickness('c',5)", '线宽 1~13；setLineStyle 线型'),
      j("ggb.setFilling('poly1',0.3)", '填充透明度 0~1'),
      j("ggb.setVisible('A',false)", '显示 / 隐藏；setLabelVisible 显示标签'),
      j("ggb.setCaption('A','顶点')", '改显示名（不改对象名）'),
      j("ggb.startAnimation('a')", '让滑动条动起来；stopAnimation 停下'),
      j("ggb.setValue('k',2)", '给滑动条 / 变量赋值（SetValue 指令这个版本没有 ✗）'),
      j("ggb.deleteObject('A')", '删除对象（Delete 指令这个版本没有 ✗）'),
      j("ggb.renameObject('A','P')", '改名（Rename 指令这个版本也没有 ✗）'),
      c('Slider(-3,3,0.1)', '滑动条（课堂拖动神器 ✓）'),
      c('Checkbox()', '复选框（做交互演示）'),
      c('Button()', '按钮（点一下执行一批指令）'),
      c('Text("结论：a+b=c",(1,2))', '文本标注（放在坐标处 ✓）'),
    ],
  },
  {
    id: 'js',
    title: 'JavaScript API',
    tip: '脚本里的 ggb 就是绘图板本身 ✓；下面这些方法都在真机上核过存在（GeoGebra 5.0）✓',
    items: [
      j("ggb.evalCommand('Circle((0,0),2)')", '执行一条 GeoGebra 指令（最常用 ✓）'),
      j("ggb.evalCommandGetLabels('A=(1,2)')", '执行并返回新建对象的名字'),
      j('ggb.getAllObjectNames()', '所有对象名字（数组）'),
      j("ggb.getValue('a')", '取数值；ggb.getValueString() 取显示值（带单位 / 式子）'),
      j("ggb.setValue('a',2.5)", '给滑动条 / 变量赋值（做动画就靠它 ✓）'),
      j("ggb.setCoords('A',3,4)", '直接移动点的坐标'),
      j("ggb.setColor('c',200,60,60)", '颜色；ggb.getColor() 把颜色读回来'),
      j("ggb.setLineThickness('c',5)", '线宽；setLineStyle 线型'),
      j("ggb.setFilling('poly1',0.3)", '填充透明度；0 就是不填'),
      j("ggb.setVisible('A',false)", '显示 / 隐藏'),
      j("ggb.setLabelVisible('A',true)", '显示标签；setLabelStyle(n,3) 显示名称和值'),
      j("ggb.setCaption('A','顶点')", '改标签文字'),
      j("ggb.setFixed('A',true)", '钉住不让拖；setTrace 打开轨迹'),
      j("ggb.renameObject('A','P')", '改对象名'),
      j("ggb.getObjectType('c')", '对象类型（circle / line / function …）'),
      j("ggb.exists('A')", '在不在；isDefined 是不是有效'),
      j("ggb.deleteObject('A')", '删掉一个对象'),
      j('ggb.newConstruction()', '清空重来（相当于新建作图）'),
      j('ggb.undo()  /  ggb.redo()', '撤销 / 重做一步'),
      j('ggb.getXML()  /  ggb.setXML(xml)', '导出 / 导回整份作图'),
      j('ggb.getBase64(cb)', '拿到 .ggb 内容（回调）；setBase64(b64) 恢复'),
      j('ggb.getPNGBase64(cb,1,false)', '导出 PNG 图片数据（回调，可存文件）'),
      j("ggb.startAnimation('a')", '开始 / 停止动画：stopAnimation、setAnimating、setAnimationSpeed'),
      j('ggb.setAxesVisible(true,true)', '坐标轴开关；setGridVisible(true) 网格'),
      j('ggb.setCoordSystem(xmin,xmax,ymin,ymax)', '设定显示范围（做题演示很好用 ✓）'),
      j('ggb.setErrorDialogsActive(false)', '关掉绘图板自己的报错弹窗（脚本批量跑的时候建议关 ✓）'),
      j('ggb.registerObjectUpdateListener(...)', '注册监听（对象变了回调你 ✓）'),
      j('ggb.getVersion()', '绘图板版本'),
    ],
  },
  {
    id: 'ai',
    title: 'AI 作图句型',
    tip: '上面的「AI 作图」框是离线规则识别的：照下面这些句式写成功率最高 ✓（每行一句，回车执行）',
    items: [
      s('三角形 ABC', '画三角形（顶点自动摆好）'),
      s('等边三角形 ABC', '正三角形（绕 A 转 60° 得到 C）'),
      s('直角三角形 ABC', '直角在 A'),
      s('等腰三角形 ABC / 等腰直角三角形 ABC', '特殊三角形'),
      s('正方形 ABCD', 'AB 为边的正方形'),
      s('平行四边形 ABCD', 'D = A + C − B'),
      s('梯形 ABCD', '上底 DC ∥ 下底 AB'),
      s('正 六边形 AB 6', '正多边形（两点 + 边数）'),
      s('线段 AB / 直线 AB / 射线 AB', '线'),
      s('圆 O 3 / 圆 O A', '圆（半径 / 过点）'),
      s('点 A / 点 A(1,2)', '点（不带坐标就自动放一个）'),
      s('M 是 AB 的中点', '中点'),
      s('AB 中点 M', '中点（另一种说法 ✓）'),
      s('过 M 作 BC 的垂线', '垂线'),
      s('过 M 作 BC 的平行线', '平行线'),
      s('∠ABC 的角平分线', '角平分线'),
      s('椭圆 F1 F2 3', '椭圆（两焦点 + 半长轴）'),
      s('双曲线 F1 F2 3', '双曲线'),
      s('抛物线 F l', '抛物线（焦点 + 准线对象）'),
      s('f(x)=x^2-2x', '函数 / 方程直接写（含 x、y 的式子都走这条 ✓）'),
    ],
  },
]

/** 帮助面板里"AI 句型"那一栏的标题（导出出去给组件判断用 ✓） */
export const HELP_AI_TAB = 'ai'
export const HELP_JS_TAB = 'js'

