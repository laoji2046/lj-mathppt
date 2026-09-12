/**
 * 整套讲座模板（模板库「数学讲义模板 → 整套」与「常用模板」里的整套卡片）。
 *
 * 纪律：
 * 1. 每套 6~9 页，页内元素一律扁平；每页都用 pptLayouts 的版式函数生成，栅格与页眉统一。
 * 2. 数学内容一律写成 $...$ 混排；页眉 eyebrow、两栏标题、图表标题、练习页 note、
 *    思考页 note 等普通 text 槽位只写中文短句，不出现 $。
 * 3. 页眉只传 eyebrow（header() 左右两个文本框在 x 轴上有重叠区，同时传会压字）。
 */
import type { SlideElement } from '@/types'
import { getTheme } from './pptTheme'
import { cover, definition, mistake, practice, steps, summary, theorem, think, toc, twoCol } from './pptLayouts'

export interface MathBundle {
  id: string
  name: string
  description: string
  slides: { id?: string; bg?: string; elements: SlideElement[] }[]
}

const t = getTheme('edumath')
const BG = t.bg

function slide(id: string, elements: SlideElement[]) {
  return { id, bg: BG, elements }
}

export const mathBundles: MathBundle[] = [
  // ══ 1. 三角函数图像变换 · 一轮复习 ═══════════════════════════════════════
  {
    id: 'bundle-trig-graph',
    name: '三角函数图像变换 · 一轮复习',
    description: '8 页：封面 · 目录 · 变换规则 · 思考 · 例题 · 练习 · 易错 · 小结',
    slides: [
      slide('s1', cover(t, {
        title: '三角函数的\n图像变换',
        subtitle: '一轮复习 · 从 $y=\\sin x$ 到 $y=A\\sin(\\omega x+\\varphi)$',
        author: '主讲 · 张老师',
        unit: '高三数学备课组',
        date: '2025 · 09',
      })),
      slide('s2', toc(t, {
        eyebrow: '三角函数 · 一轮复习',
        pageNum: '02',
        items: [
          { no: '01', title: '图像变换的四种方式', page: '03' },
          { no: '02', title: '周期与对称的整体代换', page: '04' },
          { no: '03', title: '例题：由变换写解析式', page: '05' },
          { no: '04', title: '课堂练习', page: '06' },
          { no: '05', title: '易错点复盘', page: '07' },
          { no: '06', title: '小结', page: '08' },
        ],
      })),
      slide('s3', twoCol(t, {
        eyebrow: '三角函数 · 图像变换',
        pageNum: '03',
        title: '图像变换的规则',
        left: {
          title: '四步变换',
          lines: [
            '横坐标伸缩：$y=\\sin x\\to y=\\sin\\omega x$（横坐标变为原来的 $\\dfrac{1}{\\omega}$）。',
            '左右平移：$y=\\sin\\omega x\\to y=\\sin(\\omega x+\\varphi)$。',
            '纵向伸缩：$y=\\sin\\omega x\\to y=A\\sin\\omega x$（振幅变为 $|A|$）。',
          ],
        },
        right: {
          title: '顺序与平移量',
          lines: [
            '先伸缩后平移：平移量是 $\\dfrac{\\varphi}{\\omega}$。',
            '先平移后伸缩：平移量是 $\\varphi$。',
            '两种顺序的变换结果相同，但中间步骤的解析式不同。',
          ],
        },
      })),
      slide('s4', think(t, {
        eyebrow: '三角函数 · 思考',
        pageNum: '04',
        title: '为什么 $\\omega$ 影响周期',
        question: [
          '$y=\\sin(\\omega x+\\varphi)$（$\\omega>0$）的周期与 $\\omega$ 是什么关系？',
          '为什么 $\\omega$ 只压缩横坐标，却不改变振幅？',
        ],
        hint: '$x$ 的系数 $\\omega$ 只压缩横坐标：把图像上每一点的横坐标变为原来的 $\\dfrac{1}{\\omega}$、纵坐标不变，于是周期变为 $T=\\dfrac{2\\pi}{\\omega}$。',
        note: '振幅由系数 A 决定，周期由横坐标的系数决定，两者互不影响。',
      })),
      slide('s5', twoCol(t, {
        eyebrow: '三角函数 · 例题',
        pageNum: '05',
        title: '例题 · 由变换写解析式',
        left: {
          title: '题目',
          lines: [
            '把 $y=\\sin x$ 图像上各点的横坐标缩短到原来的 $\\dfrac{1}{2}$（纵坐标不变），',
            '再向左平移 $\\dfrac{\\pi}{6}$ 个单位，求所得图像的解析式。',
          ],
        },
        right: {
          title: '解答',
          lines: [
            '横坐标缩短：$y=\\sin x\\to y=\\sin 2x$。',
            '再向左平移 $\\dfrac{\\pi}{6}$：$y=\\sin 2\\left(x+\\dfrac{\\pi}{6}\\right)=\\sin\\left(2x+\\dfrac{\\pi}{3}\\right)$。',
            '所以所得图像的解析式为 $y=\\sin\\left(2x+\\dfrac{\\pi}{3}\\right)$。',
          ],
        },
      })),
      slide('s6', practice(t, {
        eyebrow: '三角函数 · 课堂练习',
        pageNum: '06',
        title: '课堂练习',
        items: [
          '1. 把 $y=\\sin x$ 的图像向右平移 $\\dfrac{\\pi}{4}$ 个单位，再把横坐标缩短到原来的 $\\dfrac{1}{2}$，求所得图像的解析式。',
          '2. 求 $y=3\\sin\\left(2x+\\dfrac{\\pi}{6}\\right)+1$ 的最大值与最小值，并指出取得最值时的 $x$。',
          '3. 若 $y=A\\sin(\\omega x+\\varphi)$ 的图像上相邻的最高点与最低点的横坐标之差为 $\\pi$，求 $\\omega$。',
        ],
        note: '限时 10 分钟，第 1、2 题必做；第 1 题先平移后伸缩，平移量按横坐标本身计算；第 3 题中相邻最高点与最低点的横坐标之差是半个周期。',
      })),
      slide('s7', mistake(t, {
        eyebrow: '三角函数 · 易错',
        pageNum: '07',
        title: '图像变换的三个易错点',
        wrong: [
          '① 先伸缩后平移时，平移量仍按 $\\varphi$ 计算。',
          '② 把横坐标伸缩与纵向伸缩混为一谈，误改振幅。',
          '③ 求单调区间时忘记把 $\\omega$ 除到不等式两边。',
        ],
        right: [
          '① 先伸缩后平移，平移量是 $\\dfrac{\\varphi}{\\omega}$；先平移后伸缩才是 $\\varphi$。',
          '② 横坐标变换只改 $x$ 的系数 $\\omega$，纵向伸缩只改振幅 $A$。',
          '③ 单调区间由 $-\\dfrac{\\pi}{2}+2k\\pi\\le\\omega x+\\varphi\\le\\dfrac{\\pi}{2}+2k\\pi$ 解出，两边同除以 $\\omega$。',
        ],
      })),
      slide('s8', summary(t, {
        eyebrow: '三角函数 · 小结',
        pageNum: '08',
        title: '小结 · 图像变换',
        points: [
          '先把目标解析式写成 $y=A\\sin(\\omega x+\\varphi)$ 的形式，再决定变换步骤与顺序。',
          '$y=A\\sin(\\omega x+\\varphi)$ 的性质由整体代换得到：把 $\\omega x+\\varphi$ 当作一个整体。',
          '周期由 $\\omega$ 决定，振幅由 $A$ 决定，初相由 $\\varphi$ 决定，三者互不影响。',
          '相邻最高点与最低点的横坐标之差是半个周期，这是由图像求 $\\omega$ 的关键。',
        ],
        core: '定 $A$、定 $\\omega$、定 $\\varphi$，是处理三角函数图像问题的固定顺序。',
      })),
    ],
  },

  // ══ 2. 指数函数与对数函数 · 新课 ═════════════════════════════════════════
  {
    id: 'bundle-exp-log',
    name: '指数函数与对数函数 · 新课',
    description: '7 页：封面 · 目录 · 定义 · 图像性质对照 · 例题 · 思考 · 小结',
    slides: [
      slide('s1', cover(t, {
        title: '指数函数与\n对数函数',
        subtitle: '新课 · 图像、性质与互为反函数',
        author: '主讲 · 李老师',
        unit: '高一数学备课组',
        date: '2025 · 10',
      })),
      slide('s2', toc(t, {
        eyebrow: '函数 · 新课',
        pageNum: '02',
        items: [
          { no: '01', title: '指数函数的定义', page: '03' },
          { no: '02', title: '指数函数与对数函数对照', page: '04' },
          { no: '03', title: '例题：比较大小', page: '05' },
          { no: '04', title: '思考：底数为什么有限制', page: '06' },
          { no: '05', title: '小结', page: '07' },
        ],
      })),
      slide('s3', definition(t, {
        eyebrow: '函数 · 概念',
        pageNum: '03',
        title: '指数函数的定义',
        term: '定义 · 指数函数',
        body: [
          '形如 $y=a^{x}$（$a>0$ 且 $a\\ne 1$）的函数叫作指数函数，定义域为 $\\mathbf{R}$，值域为 $(0,+\\infty)$。',
          '当 $a>1$ 时，$y=a^{x}$ 在 $\\mathbf{R}$ 上单调递增；当 $0<a<1$ 时，在 $\\mathbf{R}$ 上单调递减。',
          '图像恒过定点 $(0,1)$，且始终位于 $x$ 轴上方，以 $x$ 轴为渐近线。',
        ],
        note: ['底数必须同时满足 $a>0$ 与 $a\\ne 1$；$y=2\\cdot 3^{x}$ 的形式不是指数函数。'],
      })),
      slide('s4', twoCol(t, {
        eyebrow: '函数 · 图像与性质',
        pageNum: '04',
        title: '指数函数与对数函数对照',
        left: {
          title: '指数函数',
          lines: [
            '定义域 $\\mathbf{R}$，值域 $(0,+\\infty)$。',
            '恒过定点 $(0,1)$。',
            '$a>1$ 时递增，$0<a<1$ 时递减。',
            '图像在 $x$ 轴上方，以 $x$ 轴为渐近线。',
          ],
        },
        right: {
          title: '对数函数',
          lines: [
            '定义域 $(0,+\\infty)$，值域 $\\mathbf{R}$。',
            '恒过定点 $(1,0)$。',
            '$a>1$ 时递增，$0<a<1$ 时递减。',
            '图像在 $y$ 轴右侧，以 $y$ 轴为渐近线。',
          ],
        },
      })),
      slide('s5', twoCol(t, {
        eyebrow: '函数 · 例题',
        pageNum: '05',
        title: '例题 · 比较大小',
        left: {
          title: '题目',
          lines: [
            '比较下列各组数的大小：',
            '（1）$1.7^{2.5}$ 与 $1.7^{3}$；',
            '（2）$0.8^{-0.1}$ 与 $0.8^{-0.2}$。',
          ],
        },
        right: {
          title: '解答',
          lines: [
            '（1）$y=1.7^{x}$ 在 $\\mathbf{R}$ 上单调递增，而 $2.5<3$，所以 $1.7^{2.5}<1.7^{3}$。',
            '（2）$y=0.8^{x}$ 在 $\\mathbf{R}$ 上单调递减，而 $-0.1>-0.2$，所以 $0.8^{-0.1}<0.8^{-0.2}$。',
            '同底数比较大小，先判断单调性，再比较指数。',
          ],
        },
      })),
      slide('s6', think(t, {
        eyebrow: '函数 · 思考',
        pageNum: '06',
        title: '底数为什么有限制',
        question: [
          '指数函数的底数为什么要求 $a>0$ 且 $a\\ne 1$？',
          '如果 $a<0$ 或者 $a=1$，会出现什么问题？',
        ],
        hint: '若 $a<0$，则 $a^{x}$ 对 $x=\\dfrac{1}{2}$ 这样的指数没有意义；若 $a=1$，则 $y=1^{x}=1$ 是常函数，图像没有研究价值。',
        note: '对数函数的底数有同样的限制，指数函数与对数函数互为反函数。',
      })),
      slide('s7', summary(t, {
        eyebrow: '函数 · 小结',
        pageNum: '07',
        title: '小结 · 指数函数与对数函数',
        points: [
          '指数函数与对数函数互为反函数，图像关于直线 $y=x$ 对称。',
          '两者的单调性都由底数 $a$ 决定：$a>1$ 递增，$0<a<1$ 递减。',
          '比较大小先看底数是否相同：同底看单调性，不同底可借助中间量 $1$ 或 $0$。',
          '研究复合函数 $y=\\log_{a}f(x)$ 时，先求定义域，再判断内层函数的取值范围。',
        ],
        core: '底数定单调，定义域定范围，中间量搭桥比较大小。',
      })),
    ],
  },

  // ══ 3. 立体几何 · 线面位置关系 ═══════════════════════════════════════════
  {
    id: 'bundle-solid-line-plane',
    name: '立体几何 · 线面位置关系',
    description: '7 页：封面 · 目录 · 判定定理 · 思考 · 证明思路 · 练习 · 小结',
    slides: [
      slide('s1', cover(t, {
        title: '立体几何\n线面位置关系',
        subtitle: '判定定理与性质定理 · 证明思路',
        author: '主讲 · 王老师',
        unit: '高二数学备课组',
        date: '2025 · 11',
      })),
      slide('s2', toc(t, {
        eyebrow: '立体几何 · 专题',
        pageNum: '02',
        items: [
          { no: '01', title: '直线与平面平行的判定定理', page: '03' },
          { no: '02', title: '思考：线面垂直怎样判定', page: '04' },
          { no: '03', title: '证明思路的五条路径', page: '05' },
          { no: '04', title: '课堂练习', page: '06' },
          { no: '05', title: '小结', page: '07' },
        ],
      })),
      slide('s3', theorem(t, {
        eyebrow: '立体几何 · 定理',
        pageNum: '03',
        title: '直线与平面平行的判定定理',
        name: '直线与平面平行的判定定理',
        statement: [
          '若平面外的一条直线与此平面内的一条直线平行，则该直线与此平面平行。',
          '符号语言：$a\\not\\subset\\alpha$，$b\\subset\\alpha$，$a\\parallel b\\Rightarrow a\\parallel\\alpha$。',
        ],
        proof: [
          '设 $a$、$b$ 确定平面 $\\beta$，则 $\\beta$ 与 $\\alpha$ 相交于直线 $b$；',
          '若 $a$ 与 $\\alpha$ 有公共点，则该点既在 $\\beta$ 内又在 $\\alpha$ 内，必在交线 $b$ 上，这与 $a\\parallel b$ 矛盾。',
        ],
      })),
      slide('s4', think(t, {
        eyebrow: '立体几何 · 思考',
        pageNum: '04',
        title: '线面垂直怎样判定',
        question: [
          '已知直线 $l$ 与平面 $\\alpha$，需要什么条件才能断定 $l\\perp\\alpha$？',
          '如果 $l$ 只与平面内的一条直线垂直，够不够？',
        ],
        hint: '判定定理：若直线 $l$ 与平面 $\\alpha$ 内的两条相交直线都垂直，则 $l\\perp\\alpha$。条件中的"两条相交"缺一不可。',
        note: '只与一条直线垂直不能判定线面垂直，这条直线可能与平面斜交。',
      })),
      slide('s5', steps(t, {
        eyebrow: '立体几何 · 方法',
        pageNum: '05',
        title: '线面位置关系的证明思路',
        steps: [
          '线线平行：中位线、平行四边形、成比例线段。',
          '线面平行：在平面内找一条与已知直线平行的直线，常用中位线或平行四边形。',
          '面面平行：一个平面内的两条相交直线分别平行于另一个平面。',
          '线面垂直：证明直线垂直于平面内的两条相交直线。',
          '面面垂直：证明一个平面经过另一个平面的一条垂线。',
        ],
        conclusion: '把线面关系反复转化为线线关系，是立体几何证明的通用路径。',
      })),
      slide('s6', practice(t, {
        eyebrow: '立体几何 · 课堂练习',
        pageNum: '06',
        title: '课堂练习',
        items: [
          '1. 判断：若 $a\\parallel\\alpha$，$b\\subset\\alpha$，则一定有 $a\\parallel b$。',
          '2. 在正方体 $ABCD-A_{1}B_{1}C_{1}D_{1}$ 中，证明 $BD\\parallel$ 平面 $B_{1}D_{1}C$。',
          '3. 已知 $l\\perp\\alpha$，$m\\subset\\alpha$，判断直线 $l$ 与 $m$ 的位置关系。',
        ],
        note: '第 1 题举反例即可，两直线也可能异面；第 2 题先证线线平行；第 3 题用线面垂直的性质定理，两直线垂直。',
      })),
      slide('s7', summary(t, {
        eyebrow: '立体几何 · 小结',
        pageNum: '07',
        title: '小结 · 线面位置关系',
        points: [
          '判定定理用来证平行与垂直，性质定理用来由平行与垂直推出新结论，两者成对使用。',
          '证明线面平行，关键是在平面内找到那条平行的直线。',
          '证明线面垂直，关键是找到平面内两条相交直线，并说明它们都与已知直线垂直。',
          '书写时把定理的条件逐条写全，再写结论，避免直接跳到结论。',
        ],
        core: '判定找条件，性质得结论：证明的关键始终是找到那条合适的直线。',
      })),
    ],
  },
]

export function findBundle(id: string): MathBundle | undefined {
  return mathBundles.find((b) => b.id === id)
}
