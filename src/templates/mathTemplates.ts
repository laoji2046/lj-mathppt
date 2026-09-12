/**
 * 数学讲义单页模板（模板库「数学讲义模板」标签页的内容）。
 *
 * 纪律（与 pptLayouts / mathAppletTemplates 保持一致）：
 * 1. build() 一律返回「扁平 SlideElement[]」——版式函数本身已经返回扁平数组，直接 return 即可；
 *    拼接多个数组时必须用展开运算符。
 * 2. 数学内容一律写成 $...$ 混排：版式层的 para() / block() 会自动产出 richtex 元素。
 *    不使用 type:'math' 元素，也不用 Unicode 上标 / 下标（x²、aₙ、√ 之类）代替公式。
 * 3. 版式统一交给 pptLayouts，模板里只填内容槽位，保证每页栅格一致。
 * 4. 例外：页眉 eyebrow、两栏标题、图表标题、练习页 note、图片 caption、思考页 note 等槽位
 *    走的是普通 text 元素（不做混排），这些地方只写中文短句，不出现 $...$。
 * 5. 页眉只传 eyebrow，不传 brand：header() 的左右两个文本框在 x 轴上有重叠区，
 *    同时传两段文字会互相压字。
 */
import type { SlideElement } from '@/types'
import { getTheme } from './pptTheme'
import {
  bullets, cover, definition, mistake, practice, section, steps, summary, theorem, think, toc, twoCol,
} from './pptLayouts'

export const TITLE_FONT = 'hei-bold'
export const BODY_FONT = 'sans'
export const THEME = {
  ink: '#1a1a1a',
  accent: '#c0392b',
  sub: '#5f5e5a',
  line: '#d3d1c7',
  gold: '#c9a227',
}

export interface Template {
  id: string
  name: string
  cat: string
  build(): Array<SlideElement | SlideElement[]>
}

const t = getTheme('edumath')

export const mathTemplates: Template[] = [
  // ── 封面 ────────────────────────────────────────────────────────────────
  {
    id: 'cover', name: '封面 · 一轮复习主标题', cat: '封面',
    build() {
      return cover(t, {
        title: '函数与导数\n高三一轮复习',
        subtitle: '单调性 · 极值最值 · 导数应用',
        author: '主讲 · 张老师',
        unit: '高三数学备课组',
        date: '2025 · 09',
      })
    },
  },

  // ── 目录 ────────────────────────────────────────────────────────────────
  {
    id: 'toc', name: '目录 · 六讲结构', cat: '目录',
    build() {
      return toc(t, {
        eyebrow: '高中数学 · 一轮复习',
        pageNum: '02',
        items: [
          { no: '01', title: '函数的概念与性质', page: '03' },
          { no: '02', title: '导数的概念与运算', page: '11' },
          { no: '03', title: '导数与单调性、极值', page: '19' },
          { no: '04', title: '数列的通项与求和', page: '27' },
          { no: '05', title: '三角函数与解三角形', page: '35' },
          { no: '06', title: '概率与统计初步', page: '43' },
        ],
      })
    },
  },

  // ── 章节 ────────────────────────────────────────────────────────────────
  {
    id: 'section', name: '章节 · 大序号过渡页', cat: '章节',
    build() {
      return section(t, { no: '01', title: '函数与导数', subtitle: '从单调性到极值：一轮复习第 1 讲' })
    },
  },
  {
    id: 'section-geo', name: '章节 · 立体几何', cat: '章节',
    build() {
      return section(t, { no: '03', title: '立体几何', subtitle: '线面位置关系的判定与性质' })
    },
  },

  // ── 定义 ────────────────────────────────────────────────────────────────
  {
    id: 'def-monotonic', name: '定义 · 函数的单调性', cat: '定义',
    build() {
      return definition(t, {
        animate: true,   // 讲解型：演示时逐条渐显
        eyebrow: '函数与导数 · 概念',
        pageNum: '03',
        title: '函数的单调性',
        term: '定义 · 增函数与减函数',
        body: [
          '设函数 $f(x)$ 的定义域为 $D$，区间 $I\\subseteq D$，且 $x_{1},x_{2}$ 是 $I$ 上任意两个实数，$x_{1}<x_{2}$。',
          '若恒有 $f(x_{1})<f(x_{2})$，则称 $f(x)$ 在区间 $I$ 上单调递增；',
          '若恒有 $f(x_{1})>f(x_{2})$，则称 $f(x)$ 在区间 $I$ 上单调递减。',
        ],
        note: ['单调性是区间上的整体性质，必须指明区间；写成"在定义域上单调"通常没有意义。'],
      })
    },
  },
  {
    id: 'def-gp', name: '定义 · 等比数列', cat: '定义',
    build() {
      return definition(t, {
        animate: true,   // 讲解型：演示时逐条渐显
        eyebrow: '数列 · 概念',
        pageNum: '04',
        title: '等比数列的定义',
        term: '定义 · 等比数列与公比',
        body: [
          '若数列 $\\{a_{n}\\}$ 从第 2 项起，每一项与它前一项的比都等于同一个常数 $q$，即',
          '$\\dfrac{a_{n}}{a_{n-1}}=q$（$n\\ge 2$，$q\\ne 0$ 为常数），',
          '则称 $\\{a_{n}\\}$ 是等比数列，$q$ 叫作公比。',
        ],
        note: ['通项 $a_{n}=a_{1}q^{n-1}$；任意两项满足 $a_{n}=a_{m}q^{n-m}$（$m,n\\in\\mathbf{N}^{*}$）。'],
      })
    },
  },

  // ── 定理 ────────────────────────────────────────────────────────────────
  {
    id: 'thm-sine', name: '定理 · 正弦定理', cat: '定理',
    build() {
      return theorem(t, {
        animate: true,   // 讲解型：演示时逐条渐显
        eyebrow: '解三角形 · 定理',
        pageNum: '05',
        title: '正弦定理',
        name: '正弦定理',
        statement: [
          '在 $\\triangle ABC$ 中，$a,b,c$ 分别是角 $A,B,C$ 的对边，$R$ 是外接圆半径，则',
          '$\\dfrac{a}{\\sin A}=\\dfrac{b}{\\sin B}=\\dfrac{c}{\\sin C}=2R$。',
        ],
        proof: [
          '作 $\\triangle ABC$ 的外接圆，由圆周角定理得 $a=2R\\sin A$；',
          '同理 $b=2R\\sin B$，$c=2R\\sin C$，三式同除以 $2R$ 即得结论。',
        ],
      })
    },
  },
  {
    id: 'thm-cosine', name: '定理 · 余弦定理', cat: '定理',
    build() {
      return theorem(t, {
        animate: true,   // 讲解型：演示时逐条渐显
        eyebrow: '解三角形 · 定理',
        pageNum: '06',
        title: '余弦定理',
        name: '余弦定理',
        statement: [
          '在 $\\triangle ABC$ 中，',
          '$a^{2}=b^{2}+c^{2}-2bc\\cos A$，$b^{2}=a^{2}+c^{2}-2ac\\cos B$，$c^{2}=a^{2}+b^{2}-2ab\\cos C$。',
        ],
        proof: [
          '以 $A$ 为原点、$AB$ 所在直线为 $x$ 轴建系，则 $B(c,0)$，$C(b\\cos A,b\\sin A)$；',
          '由两点间距离公式展开 $\\left|BC\\right|^{2}$，即得 $a^{2}=b^{2}+c^{2}-2bc\\cos A$。',
        ],
      })
    },
  },
  {
    id: 'thm-amgm', name: '定理 · 基本不等式', cat: '定理',
    build() {
      return theorem(t, {
        animate: true,   // 讲解型：演示时逐条渐显
        eyebrow: '不等式 · 定理',
        pageNum: '07',
        title: '基本不等式',
        name: '基本不等式（均值不等式）',
        statement: [
          '若 $a>0$，$b>0$，则 $\\dfrac{a+b}{2}\\ge\\sqrt{ab}$，',
          '等号成立当且仅当 $a=b$。',
        ],
        proof: [
          '由 $(\\sqrt{a}-\\sqrt{b})^{2}\\ge 0$ 展开得 $a+b-2\\sqrt{ab}\\ge 0$，两边同除以 $2$ 即得；',
          '等号成立当且仅当 $\\sqrt{a}=\\sqrt{b}$，即 $a=b$。',
        ],
      })
    },
  },

  // ── 思考 ────────────────────────────────────────────────────────────────
  {
    id: 'think-omega', name: '思考 · 为什么 ω 影响周期', cat: '思考',
    build() {
      return think(t, {
        animate: true,   // 讲解型：演示时逐条渐显
        eyebrow: '三角函数 · 思考',
        pageNum: '08',
        title: '为什么 $\\omega$ 影响周期',
        question: [
          '函数 $y=\\sin(\\omega x+\\varphi)$（$\\omega>0$）的图像，可以由 $y=\\sin x$ 的图像经过怎样的变换得到？',
          '周期 $T$ 与 $\\omega$ 之间是什么关系？',
        ],
        hint: '$x$ 的系数 $\\omega$ 只压缩横坐标：把图像上每一点的横坐标变为原来的 $\\dfrac{1}{\\omega}$、纵坐标不变，周期随之变为 $T=\\dfrac{2\\pi}{\\omega}$。',
        note: '两种变换顺序的平移量不同：先伸缩后平移时，平移量要除以横坐标的系数。',
      })
    },
  },
  {
    id: 'think-perp', name: '思考 · 线面垂直怎样判定', cat: '思考',
    build() {
      return think(t, {
        animate: true,   // 讲解型：演示时逐条渐显
        eyebrow: '立体几何 · 思考',
        pageNum: '09',
        title: '线面垂直怎样判定',
        question: [
          '已知直线 $l$ 与平面 $\\alpha$，需要什么条件才能断定 $l\\perp\\alpha$？',
          '如果 $l$ 只与平面内的一条直线垂直，够不够？',
        ],
        hint: '判定定理：若直线 $l$ 与平面 $\\alpha$ 内的两条相交直线都垂直，则 $l\\perp\\alpha$。"两条相交"缺一不可。',
        note: '性质定理：若一条直线垂直于一个平面，则它垂直于该平面内的任意一条直线。',
      })
    },
  },

  // ── 知识 ────────────────────────────────────────────────────────────────
  {
    id: 'knowledge', name: '知识 · 函数与导数框架', cat: '知识',
    build() {
      return bullets(t, {
        eyebrow: '函数与导数 · 知识梳理',
        pageNum: '10',
        title: '函数与导数的知识框架',
        bullets: [
          { lead: '函数的表示与三要素', support: '定义域、值域、对应关系；讨论性质之前先定定义域。' },
          { lead: '单调性', support: '定义法用于证明，导数法用于求解；区间须落在定义域内。' },
          { lead: '奇偶性与对称性', support: '$f(-x)=\\pm f(x)$ 定奇偶，$f(a+x)=f(a-x)$ 定对称轴。' },
          { lead: '导数与切线', support: '$f^{\\prime}(x_{0})$ 是曲线在 $x_{0}$ 处切线的斜率。' },
          { lead: '极值与最值', support: '极值看导数变号，最值还要比较区间端点的函数值。' },
        ],
        aside: {
          title: '本讲主线',
          lines: ['定义域 → 导数符号', '→ 单调性 → 极值', '→ 最值 → 参数讨论'],
        },
      })
    },
  },
  {
    id: 'knowledge-prob', name: '知识 · 概率与统计三模型', cat: '知识',
    build() {
      return twoCol(t, {
        eyebrow: '概率统计 · 知识梳理',
        pageNum: '11',
        title: '概率与统计的基本模型',
        left: {
          title: '概率模型',
          lines: [
            '古典概型：样本空间有限，每个基本事件等可能，$P(A)=\\dfrac{n(A)}{n(\\Omega)}$。',
            '条件概率：$P(B\\mid A)=\\dfrac{P(AB)}{P(A)}$（$P(A)>0$）。',
            '$A$ 与 $B$ 独立 $\\Leftrightarrow P(AB)=P(A)P(B)$。',
          ],
        },
        right: {
          title: '统计量',
          lines: [
            '均值 $\\bar{x}=\\dfrac{1}{n}\\sum_{i=1}^{n}x_{i}$。',
            '方差 $s^{2}=\\dfrac{1}{n}\\sum_{i=1}^{n}(x_{i}-\\bar{x})^{2}$。',
            '标准差 $s=\\sqrt{s^{2}}$，与原始数据的单位一致。',
          ],
        },
      })
    },
  },

  // ── 公式 ────────────────────────────────────────────────────────────────
  {
    id: 'formula', name: '公式 · 三角恒等变换', cat: '公式',
    build() {
      return twoCol(t, {
        animate: true,   // 讲解型：演示时逐条渐显
        eyebrow: '三角函数 · 公式速查',
        pageNum: '12',
        title: '三角恒等变换公式速查',
        left: {
          title: '和差角与倍角',
          lines: [
            '$\\sin(\\alpha\\pm\\beta)=\\sin\\alpha\\cos\\beta\\pm\\cos\\alpha\\sin\\beta$',
            '$\\cos(\\alpha\\pm\\beta)=\\cos\\alpha\\cos\\beta\\mp\\sin\\alpha\\sin\\beta$',
            '$\\sin 2\\alpha=2\\sin\\alpha\\cos\\alpha$',
            '$\\cos 2\\alpha=\\cos^{2}\\alpha-\\sin^{2}\\alpha=1-2\\sin^{2}\\alpha$',
          ],
        },
        right: {
          title: '辅助角与降幂',
          lines: [
            '$a\\sin x+b\\cos x=\\sqrt{a^{2}+b^{2}}\\sin(x+\\varphi)$',
            '$\\sin^{2}\\alpha=\\dfrac{1-\\cos 2\\alpha}{2}$，$\\cos^{2}\\alpha=\\dfrac{1+\\cos 2\\alpha}{2}$',
            '$\\tan 2\\alpha=\\dfrac{2\\tan\\alpha}{1-\\tan^{2}\\alpha}$（$\\alpha\\ne\\dfrac{\\pi}{4}+\\dfrac{k\\pi}{2}$）',
          ],
        },
      })
    },
  },
  {
    id: 'formula-deriv', name: '公式 · 导数公式与运算法则', cat: '公式',
    build() {
      return twoCol(t, {
        animate: true,   // 讲解型：演示时逐条渐显
        eyebrow: '导数 · 公式速查',
        pageNum: '13',
        title: '导数公式与运算法则',
        left: {
          title: '基本初等函数的导数',
          lines: [
            '$(x^{n})^{\\prime}=nx^{n-1}$',
            '$(\\sin x)^{\\prime}=\\cos x$，$(\\cos x)^{\\prime}=-\\sin x$',
            '$(e^{x})^{\\prime}=e^{x}$，$(\\ln x)^{\\prime}=\\dfrac{1}{x}$',
            '$(a^{x})^{\\prime}=a^{x}\\ln a$（$a>0$，$a\\ne 1$）',
          ],
        },
        right: {
          title: '运算法则与复合函数',
          lines: [
            '$(u\\pm v)^{\\prime}=u^{\\prime}\\pm v^{\\prime}$',
            '$(uv)^{\\prime}=u^{\\prime}v+uv^{\\prime}$',
            '$\\left(\\dfrac{u}{v}\\right)^{\\prime}=\\dfrac{u^{\\prime}v-uv^{\\prime}}{v^{2}}$（$v\\ne 0$）',
            '$[f(g(x))]^{\\prime}=f^{\\prime}(g(x))\\cdot g^{\\prime}(x)$',
          ],
        },
      })
    },
  },

  // ── 例题 ────────────────────────────────────────────────────────────────
  {
    id: 'example', name: '例题 · 用导数研究单调性', cat: '例题',
    build() {
      return twoCol(t, {
        animate: true,   // 讲解型：演示时逐条渐显
        eyebrow: '函数与导数 · 例题',
        pageNum: '14',
        title: '例题 · 用导数研究函数的单调性',
        left: {
          title: '题目',
          lines: [
            '已知函数 $f(x)=x^{3}-3x^{2}+2$。',
            '（1）求 $f(x)$ 的单调区间；',
            '（2）求 $f(x)$ 在 $[-1,3]$ 上的最大值与最小值。',
          ],
        },
        right: {
          title: '解答',
          lines: [
            '$f^{\\prime}(x)=3x^{2}-6x=3x(x-2)$，令 $f^{\\prime}(x)=0$ 得 $x=0$ 或 $x=2$。',
            '$f^{\\prime}(x)>0$ 的解集为 $(-\\infty,0)\\cup(2,+\\infty)$，故增区间为 $(-\\infty,0)$ 与 $(2,+\\infty)$，减区间为 $(0,2)$。',
            '比较端点与极值点：$f(-1)=-2$，$f(0)=2$，$f(2)=-2$，$f(3)=2$。',
            '所以最大值为 $2$，最小值为 $-2$。',
          ],
        },
      })
    },
  },
  {
    id: 'example-conic', name: '例题 · 椭圆标准方程的推导', cat: '例题',
    build() {
      return steps(t, {
        animate: true,   // 讲解型：演示时逐条渐显
        eyebrow: '解析几何 · 例题推导',
        pageNum: '15',
        title: '例题 · 椭圆标准方程的推导',
        steps: [
          '建系：以 $F_{1}$、$F_{2}$ 所在直线为 $x$ 轴，线段 $F_{1}F_{2}$ 的中点为原点，设 $\\left|F_{1}F_{2}\\right|=2c$（$c>0$）。',
          '设点：设动点 $P(x,y)$，由 $\\left|PF_{1}\\right|+\\left|PF_{2}\\right|=2a$（$a>c>0$）得 $\\sqrt{(x+c)^{2}+y^{2}}+\\sqrt{(x-c)^{2}+y^{2}}=2a$。',
          '化简：移项后两边平方，整理得 $a^{2}-cx=a\\sqrt{(x-c)^{2}+y^{2}}$，再平方并代入 $b^{2}=a^{2}-c^{2}$。',
          '结论：整理得 $\\dfrac{x^{2}}{a^{2}}+\\dfrac{y^{2}}{b^{2}}=1$（$a>b>0$）。',
        ],
        conclusion: '满足 $\\left|PF_{1}\\right|+\\left|PF_{2}\\right|=2a>2c$ 的点的轨迹是椭圆，其中 $b^{2}=a^{2}-c^{2}$。',
      })
    },
  },

  // ── 方法 ────────────────────────────────────────────────────────────────
  {
    id: 'method', name: '方法 · 求数列通项的四条路', cat: '方法',
    build() {
      return bullets(t, {
        animate: true,   // 讲解型：演示时逐条渐显
        eyebrow: '数列 · 方法',
        pageNum: '16',
        title: '求数列通项的四条路',
        bullets: [
          { lead: '公式法', support: '已判断为等差或等比数列，直接代入通项公式。' },
          { lead: '累加法', support: '$a_{n+1}-a_{n}=f(n)$ 型，逐项相加得 $a_{n}=a_{1}+\\sum_{k=1}^{n-1}f(k)$。' },
          { lead: '累乘法', support: '$\\dfrac{a_{n+1}}{a_{n}}=g(n)$ 型，逐项相乘得 $a_{n}=a_{1}\\prod_{k=1}^{n-1}g(k)$。' },
          { lead: '构造法', support: '$a_{n+1}=pa_{n}+q$（$p\\ne 1$）型，构造等比数列求通项。' },
        ],
        aside: {
          title: '选用顺序',
          lines: ['先看是否等差、等比', '再看相邻两项的差或比', '最后考虑构造辅助数列'],
        },
      })
    },
  },
  {
    id: 'method-solid', name: '方法 · 线面位置关系的证明', cat: '方法',
    build() {
      return steps(t, {
        animate: true,   // 讲解型：演示时逐条渐显
        eyebrow: '立体几何 · 方法',
        pageNum: '17',
        title: '线面位置关系的证明思路',
        steps: [
          '线线平行：中位线、平行四边形、成比例线段。',
          '线面平行：在平面内找一条与已知直线平行的直线，常用中位线或平行四边形。',
          '面面平行：一个平面内的两条相交直线分别平行于另一个平面。',
          '线面垂直：证明直线垂直于平面内的两条相交直线。',
          '面面垂直：证明一个平面经过另一个平面的一条垂线。',
        ],
        conclusion: '把线面关系反复转化为线线关系，是立体几何证明的通用路径。',
      })
    },
  },

  // ── 易错 ────────────────────────────────────────────────────────────────
  {
    id: 'mistake', name: '易错 · 导数应用三个坑', cat: '易错',
    build() {
      return mistake(t, {
        eyebrow: '函数与导数 · 易错',
        pageNum: '18',
        title: '导数应用中的三个典型错误',
        wrong: [
          '① 求单调区间时忽略定义域，例如 $f(x)=\\ln x+\\dfrac{1}{x}$ 只在 $x>0$ 上讨论。',
          '② 把 $f^{\\prime}(x)\\ge 0$ 直接当作"函数单调递增"的充要条件。',
          '③ 把"在点 $P$ 处的切线"与"过点 $P$ 的切线"当成同一件事。',
        ],
        right: [
          '① 先写定义域，再解 $f^{\\prime}(x)>0$，单调区间必须落在定义域内。',
          '② 递增的充要条件是 $f^{\\prime}(x)\\ge 0$，且 $f^{\\prime}(x)$ 不在任何子区间上恒为 $0$。',
          '③ "在点 $P$ 处"的切点就是 $P$；"过点 $P$"要设切点坐标再解方程。',
        ],
      })
    },
  },

  // ── 练习 ────────────────────────────────────────────────────────────────
  {
    id: 'practice', name: '练习 · 三角函数的图像与性质', cat: '练习',
    build() {
      return practice(t, {
        eyebrow: '三角函数 · 课堂练习',
        pageNum: '19',
        title: '练习 · 三角函数的图像与性质',
        items: [
          '1. 求 $y=2\\sin\\left(2x-\\dfrac{\\pi}{3}\\right)$ 的最小正周期、对称轴和单调递增区间。',
          '2. 在 $\\triangle ABC$ 中，$a=2$，$b=\\sqrt{3}$，$B=\\dfrac{\\pi}{3}$，求角 $A$ 与边 $c$。',
          '3. 已知 $\\tan\\alpha=2$，求 $\\dfrac{\\sin\\alpha+\\cos\\alpha}{\\sin\\alpha-\\cos\\alpha}$ 的值。',
        ],
        note: '限时 12 分钟完成；第 1 题把括号内的整体当作一个量，第 2 题先用正弦定理求角，第 3 题分子分母同时除以余弦。',
      })
    },
  },

  // ── 小结 ────────────────────────────────────────────────────────────────
  {
    id: 'summary', name: '小结 · 函数与导数', cat: '小结',
    build() {
      return summary(t, {
        animate: true,   // 讲解型：演示时逐条渐显
        eyebrow: '函数与导数 · 小结',
        pageNum: '20',
        title: '小结 · 函数与导数',
        points: [
          '讨论函数性质一律从定义域出发：单调性、奇偶性、周期性都建立在定义域之上。',
          '导数是研究单调性的通用工具：$f^{\\prime}(x)>0$ 对应递增，$f^{\\prime}(x)<0$ 对应递减。',
          '极值由导数变号判定，最值还要与区间端点处的函数值比较。',
          '含参数问题先讨论参数对导数符号的影响，再分段给出结论。',
        ],
        core: '定义域 → 导数符号 → 单调性 → 极值与最值：一条主线贯穿全章。',
      })
    },
  },
  {
    id: 'math-summary', name: '小结 · 全章公式速查', cat: '小结',
    build() {
      return twoCol(t, {
        animate: true,   // 讲解型：演示时逐条渐显
        eyebrow: '讲义 · 公式速查',
        pageNum: '21',
        title: '小结 · 全章公式速查',
        left: {
          title: '函数与导数',
          lines: [
            '$(x^{n})^{\\prime}=nx^{n-1}$，$(e^{x})^{\\prime}=e^{x}$，$(\\ln x)^{\\prime}=\\dfrac{1}{x}$',
            '$[f(g(x))]^{\\prime}=f^{\\prime}(g(x))g^{\\prime}(x)$',
            '$f^{\\prime}(x)>0$ 对应递增，$f^{\\prime}(x)<0$ 对应递减。',
          ],
        },
        right: {
          title: '数列与三角',
          lines: [
            '$a_{n}=a_{1}+(n-1)d$，$S_{n}=\\dfrac{n(a_{1}+a_{n})}{2}$',
            '$a_{n}=a_{1}q^{n-1}$，$S_{n}=\\dfrac{a_{1}(1-q^{n})}{1-q}$（$q\\ne 1$）',
            '$\\sin^{2}\\alpha+\\cos^{2}\\alpha=1$，$\\sin 2\\alpha=2\\sin\\alpha\\cos\\alpha$',
            '$a^{2}=b^{2}+c^{2}-2bc\\cos A$',
          ],
        },
      })
    },
  },
]

export function findTemplate(id: string): Template | undefined {
  return mathTemplates.find((x) => x.id === id)
}
