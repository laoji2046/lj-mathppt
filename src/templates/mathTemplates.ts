/**
 * 高中数学模板库（PowerPoint 版式，统一字体，去 AI 味）。
 *
 * 说明：
 * - 舞台固定 1920×1080；每个模板返回一组绝对定位的 SlideElement[]。
 * - 字体统一：标题用 hei-bold（黑体加粗），正文用 sans（无衬线），
 *   公式用 MathElement，所有模板一致。
 * - 文案刻意写得像一线老师的地道表述 / 高三备考讲义的用词，避免空泛套话。
 */

import type { SlideElement, TextElement, ShapeElement, MathElement } from '@/types'

export const TITLE_FONT = 'hei-bold'   // 标题字体（黑体加粗）
export const BODY_FONT = 'sans'        // 正文字体（无衬线）
export const THEME = {
  ink: '#1a1a1a',        // 主文字
  accent: '#c0392b',     // 强调红（点睛用）
  sub: '#5f5e5a',        // 次级文字
  line: '#d3d1c7',       // 分隔线
  gold: '#c9a227',       // 金色（重难点）
}

// ---- 小工具：快速造元素（省去重复样板代码） ----
function txt(
  x: number, y: number, w: number, h: number,
  text: string,
  o: Partial<TextElement> = {},
): TextElement {
  return {
    id: `el_${Math.random().toString(36).slice(2, 10)}`,
    type: 'text', x, y, w, h, rot: 0,
    text, fontSize: 28, color: THEME.ink, fontWeight: 400,
    align: 'left', fontFamily: BODY_FONT, bgColor: 'transparent', shadow: 'none',
    ...o,
  }
}

function title(x: number, y: number, w: number, h: number, text: string, o: Partial<TextElement> = {}) {
  return txt(x, y, w, h, text, { fontSize: 44, fontWeight: 700, fontFamily: TITLE_FONT, color: THEME.ink, align: 'left', ...o })
}

function shape(
  x: number, y: number, w: number, h: number,
  o: Partial<ShapeElement> = {},
): ShapeElement {
  return {
    id: `el_${Math.random().toString(36).slice(2, 10)}`,
    type: 'shape', x, y, w, h, rot: 0,
    shape: 'rect', fill: '#f1efeb', stroke: 'transparent', strokeWidth: 0,
    ...o,
  }
}

function math(x: number, y: number, w: number, h: number, latex: string, o: Partial<MathElement> = {}): MathElement {
  return {
    id: `el_${Math.random().toString(36).slice(2, 10)}`,
    type: 'math', x, y, w, h, rot: 0,
    latex, color: THEME.ink, fontSize: 36, ...o,
  }
}

/** 左侧竖色条 + 标题的主视觉 */
function headingBar(x: number, y: number, w: number, text: string): SlideElement[] {
  return [
    shape(x, y, 10, 46, { fill: THEME.accent }),
    title(x + 24, y, w, 46, text),
  ]
}

function divider(x: number, y: number, w: number): SlideElement {
  return shape(x, y, w, 2, { fill: THEME.line })
}

// ---- 模板工厂 ----
interface Template {
  id: string
  name: string
  cat: '封面' | '目录' | '章节' | '知识' | '公式' | '例题' | '方法' | '易错' | '高考' | '导图' | '练习' | '小结' | '动画'
  /** 返回值允许嵌套数组（headingBar / 步骤之类），调用方负责 flat() */
  build(): Array<SlideElement | SlideElement[]>
}

export const mathTemplates: Template[] = [
  // ========== 封面 ==========
  {
    id: 'cover', name: '封面（学科 / 章节）', cat: '封面',
    build() {
      return [
        shape(0, 0, 1920, 1080, { fill: '#ffffff' }),
        shape(0, 0, 1920, 8, { fill: THEME.accent }),
        shape(0, 720, 1920, 360, { fill: '#f4f2ec' }),
        title(200, 300, 1520, 96, '高考数学 · 专题复习', { fontSize: 58, align: 'left' }),
        title(200, 430, 1520, 70, '三角函数图像与性质', { fontSize: 44, color: THEME.accent }),
        txt(200, 560, 1520, 40, '必修一 · 第一轮复习', { fontSize: 26, color: THEME.sub }),
        txt(200, 900, 1520, 50, '授课人：____　　授课班级：____　　时间：____', { fontSize: 24, color: THEME.sub }),
      ]
    },
  },

  // ========== 目录 ==========
  {
    id: 'toc', name: '目录（本讲要点）', cat: '目录',
    build() {
      const items = [
        '一、三角函数的图像与周期',
        '二、五点法与图像变换',
        '三、值域、单调区间',
        '四、易错点：复合函数单调性',
        '五、高考常考题型演练',
      ]
      const els = headingBar(200, 120, 1520, '目录 · 本节课要解决什么')
      items.forEach((s, i) => {
        els.push(txt(230, 260 + i * 120, 900, 60, s, { fontSize: 30, fontWeight: 500 }))
        els.push(shape(210, 258 + i * 120, 6, 60, { fill: THEME.accent }))
      })
      return els
    },
  },

  // ========== 章节标题 ==========
  {
    id: 'section', name: '章节标题（过渡页）', cat: '章节',
    build() {
      return [
        shape(0, 0, 1920, 1080, { fill: '#2c2a27' }),
        shape(200, 480, 120, 120, { fill: 'transparent', stroke: THEME.gold, strokeWidth: 2, shape: 'rect' }),
        title(200, 480, 120, 120, '', {}),
        title(380, 500, 1200, 120, '第 3 节　导数的应用', { fontSize: 54, color: '#ffffff' }),
        txt(384, 660, 1100, 60, '单调性·极值·最值·零点', { fontSize: 28, color: '#c9c7bf' }),
        shape(380, 748, 120, 4, { fill: THEME.gold }),
      ]
    },
  },

  // ========== 知识梳理 ==========
  {
    id: 'knowledge', name: '知识梳理（要点）', cat: '知识',
    build() {
      const els = headingBar(160, 100, 1600, '知识梳理 · 概念与公式')
      els.push(divider(160, 176, 1600))
      const blocks = [
        { t: '函数奇偶性定义', f: 'f(-x)=f(x)\\ \\text{ 偶 },\\qquad f(-x)=-f(x)\\ \\text{ 奇 }', d: '前提：定义域关于原点对称。' },
        { t: '判断步骤', f: '', d: '① 看定义域；② 算 f(-x)；③ 与 f(x) 比较。' },
        { t: '图像特征', f: '', d: '偶函数关于 y 轴对称，奇函数关于原点对称。' },
      ]
      blocks.forEach((b, i) => {
        const y = 230 + i * 250
        els.push(shape(160, y, 4, 220, { fill: THEME.accent }))
        els.push(txt(200, y, 900, 60, b.t, { fontSize: 30, fontWeight: 600 }))
        if (b.f) els.push(math(200, y + 76, 700, 90, b.f, { fontSize: 30 }))
        els.push(txt(200, y + (b.f ? 188 : 74), 1560, 110, b.d, { fontSize: 26, color: THEME.sub }))
      })
      return els
    },
  },

  // ========== 公式卡 ==========
  {
    id: 'formula', name: '公式卡（定理）', cat: '公式',
    build() {
      return [
        shape(240, 120, 1440, 840, { fill: '#fbfaf6', stroke: THEME.line, strokeWidth: 1 }),
        headingBar(300, 160, 1320, '核心公式 · 牢牢记住'),
        math(300, 290, 1320, 170, '\\sin^2\\alpha+\\cos^2\\alpha=1', { fontSize: 46, align: 'center' }),
        divider(300, 516, 1320),
        math(300, 560, 640, 170, '\\tan\\alpha=\\frac{\\sin\\alpha}{\\cos\\alpha}', { fontSize: 38, align: 'center' }),
        math(980, 560, 640, 170, '\\sin2\\alpha=2\\sin\\alpha\\cos\\alpha', { fontSize: 38, align: 'center' }),
        txt(300, 772, 1320, 100, '适用：恒等变换 / 求值 / 化简。平方关系与商数关系是三角变换的两条主线。', { fontSize: 24, color: THEME.sub }),
      ]
    },
  },

  // ========== 例题讲解 ==========
  {
    id: 'example', name: '例题讲解（题+析）', cat: '例题',
    build() {
      return [
        headingBar(160, 100, 1600, '典型例题'),
        shape(160, 180, 1600, 320, { fill: '#fbfaf6', stroke: THEME.line, strokeWidth: 1 }),
        txt(200, 205, 300, 60, '例 1', { fontSize: 32, fontWeight: 700, color: THEME.accent }),
        math(480, 205, 1240, 100, 'f(x)=x^3-3x', { fontSize: 34, align: 'left' }),
        txt(200, 330, 1520, 120, '求函数 f(x) 的单调区间与极值。', { fontSize: 26, color: THEME.sub }),
        shape(160, 520, 1600, 300, { fill: '#eef2ff', stroke: '#96a4e0', strokeWidth: 1.5 }),
        txt(200, 550, 300, 50, '【分析】', { fontSize: 28, fontWeight: 700, color: '#3a4a9c' }),
        math(520, 545, 1200, 100, "f'(x)=3x^2-3=3(x-1)(x+1)", { fontSize: 30, align: 'left' }),
        txt(200, 672, 1520, 110, '令 f\'(x)=0 得 x=±1，列表判断符号（\u2197 增 / \u2198 减）。\n极小值 f(1)=-2，极大值 f(-1)=2。', { fontSize: 26, color: THEME.sub }),
        shape(160, 840, 1600, 2, { fill: THEME.line }),
      ]
    },
  },

  // ========== 方法总结 ==========
  {
    id: 'method', name: '方法总结（步骤）', cat: '方法',
    build() {
      const els = headingBar(160, 100, 1600, '方法归纳 · 三步走')
      const steps = [
        { n: '第 1 步', t: '设变量 / 建函数', f: 'y=f(x)', d: '把题目条件翻译成数学式子，先确定定义域。' },
        { n: '第 2 步', t: '求导 / 配方', f: "f'(x)=0", d: '找单调性与极值候选点（导数为零的驻点）。' },
        { n: '第 3 步', t: '端点检验', f: 'f(a),\\ f(b)', d: '综合边界与单调性，结合题意下结论。' },
      ]
      steps.forEach((s, i) => {
        const y = 230 + i * 240
        els.push(shape(160, y, 80, 80, { fill: THEME.accent, shape: 'ellipse' }))
        els.push(txt(182, y + 24, 60, 34, String(i + 1), { fontSize: 28, color: '#fff', fontWeight: 700, align: 'center' }))
        els.push(txt(280, y, 420, 80, s.n + '　' + s.t, { fontSize: 30, fontWeight: 600 }))
        els.push(math(720, y + 16, 420, 80, s.f, { fontSize: 28, align: 'left' }))
        els.push(txt(280, y + 60, 1400, 130, s.d, { fontSize: 26, color: THEME.sub }))
      })
      return els
    },
  },

  // ========== 易错警示 ==========
  {
    id: 'pitfall', name: '易错警示（避坑）', cat: '易错',
    build() {
      const els = headingBar(160, 100, 1600, '易错警示 · 考场扣分点')
      const items = [
        { t: '① 先看定义域', f: '\\frac{1}{x},\\ \\ln x,\\ \\sqrt{x}', d: '求单调区间前，别忘分母不为零、真数大于零、根号非负。' },
        { t: '② 极值 ≠ 驻点', f: "f'(x_0)=0", d: '导数为零只是必要条件，需结合左右符号判断极值。' },
        { t: '③ 端点最值', f: 'f(a),\\ f(b)', d: '端点处的"最值"别和"极值"搞混。' },
      ]
      items.forEach((s, i) => {
        const y = 240 + i * 200
        els.push(shape(160, y, 10, 130, { fill: THEME.gold }))
        els.push(txt(200, y + 8, 420, 60, s.t, { fontSize: 30, fontWeight: 600 }))
        els.push(math(640, y + 8, 440, 90, s.f, { fontSize: 28, align: 'left' }))
        els.push(txt(1100, y + 8, 660, 130, s.d, { fontSize: 25, color: THEME.sub }))
      })
      return els
    },
  },

  // ========== 高考题型 ==========
  {
    id: 'gaokao', name: '高考题型（考向）', cat: '高考',
    build() {
      const els = headingBar(160, 100, 1600, '高考怎么考 · 近 5 年命题点')
      const rows: [string, string, string][] = [
        ['年份', '题型', '考查点'],
        ['2023', '第 12 题', '函数单调性与参数范围'],
        ['2022', '第 15 题', '导数与切线、恒不等'],
        ['2021', '第 20 题', '零点问题与分类讨论'],
      ]
      rows.forEach((r, i) => {
        const y = 240 + i * 130
        const fill = i === 0 ? '#2c2a27' : (i % 2 ? '#ffffff' : '#f4f2ec')
        els.push(shape(200, y, 1520, 110, { fill }))
        r.forEach((cell, c) => {
          const color = i === 0 ? '#ffffff' : THEME.ink
          els.push(txt(230 + c * 500, y + 28, 460, 60, cell, { fontSize: i === 0 ? 28 : 26, color, align: 'left', fontWeight: i === 0 ? 600 : 400 }))
        })
      })
      els.push(shape(200, 660, 1520, 230, { fill: '#fdf6e3', stroke: '#e0c48a', strokeWidth: 1.5 }))
      els.push(txt(230, 690, 400, 60, '高频切入点', { fontSize: 28, fontWeight: 700, color: '#a2660a' }))
      els.push(math(620, 680, 720, 100, "y-f(x_0)=f'(x_0)(x-x_0)", { fontSize: 32, align: 'left' }))
      els.push(txt(230, 820, 1460, 60, '切线 / 恒成立 / 零点，最终都回到导数符号与单调性。', { fontSize: 25, color: THEME.sub }))
      return els
    },
  },

  // ========== 思维导图 ==========
  {
    id: 'mindmap', name: '思维导图（知识网络）', cat: '导图',
    build() {
      const els: SlideElement[] = []
      els.push(shape(810, 420, 300, 200, { fill: THEME.accent }))
      els.push(txt(900, 500, 130, 60, '三角函数', { fontSize: 34, color: '#fff', fontWeight: 700, align: 'center' }))
      const leaves = [
        ['图像与性质', 120, 120, 'y=A\\sin(\\omega x+\\varphi)'],
        ['恒等变换', 120, 480, '\\sin 2\\alpha=2\\sin\\alpha\\cos\\alpha'],
        ['解三角形', 120, 840, '\\frac{a}{\\sin A}=2R'],
        ['诱导公式', 1280, 120, '\\sin(\\pi-\\alpha)=\\sin\\alpha'],
        ['和差角', 1280, 480, '\\sin(\\alpha+\\beta)'],
        ['正弦定理', 1280, 840, '\\frac{a}{\\sin A}=\\frac{b}{\\sin B}'],
      ]
      leaves.forEach(([t, x, y, f]) => {
        const nx = Number(x)
        els.push(shape(nx, Number(y), 360, 170, { fill: '#f4f2ec', stroke: THEME.line, strokeWidth: 1, shape: 'rect' }))
        // 连线到中心
        els.push(shape(nx < 810 ? (nx + 360) : 810 + 300, 520, nx < 810 ? (810 - (nx + 360) - 60) : 60, 2, { fill: THEME.line }))
        els.push(txt(nx + 20, Number(y) + 14, 320, 44, String(t), { fontSize: 24, fontWeight: 600, align: 'center' }))
        els.push(math(nx + 20, Number(y) + 70, 320, 90, String(f), { fontSize: 22, align: 'center' }))
      })
      return els
    },
  },

  // ========== 课堂练习 ==========
  {
    id: 'practice', name: '课堂练习（当堂）', cat: '练习',
    build() {
      const els = headingBar(160, 100, 1600, '课堂练习 · 当堂检测')
      const qs = [
        { n: '1. 求函数', f: 'y=\\sin 2x', tail: '的最小正周期。' },
        { n: '2. 已知', f: 'f(x)=\\left|x-2\\right|', tail: '，讨论 f(x) 的单调性。' },
        { n: '3. 若', f: 'f(x)=x^2+ax', tail: '在 [1,2] 上递增，求 a 的取值范围。' },
      ]
      qs.forEach((q, i) => {
        const y = 260 + i * 200
        els.push(shape(160, y, 1600, 170, { fill: '#ffffff', stroke: THEME.line, strokeWidth: 1 }))
        els.push(txt(200, y + 30, 340, 120, q.n, { fontSize: 27, fontWeight: 500 }))
        els.push(math(520, y + 36, 460, 110, q.f, { fontSize: 30, align: 'left' }))
        els.push(txt(1000, y + 30, 720, 120, q.tail, { fontSize: 27, fontWeight: 500 }))
      })
      return els
    },
  },

  // ========== 小结 ==========
  {
    id: 'summary', name: '课堂小结（回顾）', cat: '小结',
    build() {
      const els = headingBar(160, 100, 1600, '课堂小结 · 今天我们掌握了')
      const points = [
        '✔ 会用导数判断单调区间、求极值',
        '✔ 会做恒成立 / 能成立问题的转化',
        '✔ 易错点已列成清单，课后对照巩固',
      ]
      points.forEach((s, i) => {
        const y = 260 + i * 180
        els.push(txt(200, y, 1560, 90, s, { fontSize: 30, fontWeight: 500 }))
        els.push(shape(190, y + 12, 6, 60, { fill: THEME.gold }))
      })
      return els
    },
  },

  // ---- 动画版模板（fragment 渐显）：演示时点击逐条出现，编辑器始终全显 ----
  {
    id: 'anim-example',
    name: '例题·逐条渐显',
    cat: '动画',
    build() {
      const els: SlideElement[] = []
      els.push(...headingBar(160, 140, 900, '典型例题'))
      els.push(shape(160, 260, 1600, 220, { fill: '#f5f5f2' }))
      els.push(txt(200, 300, 420, 70, '例 已知函数', { fontSize: 30, fragment: true }))
      els.push(math(620, 300, 520, 90, 'f(x)=x^{3}-3x^{2}+1', { fontSize: 30, fragment: true, align: 'left' }))
      els.push(txt(1140, 300, 620, 70, '，求 f(x) 的单调区间与极值。', { fontSize: 30, fragment: true }))
      els.push(txt(200, 420, 1520, 70, '思路：求导 → 令 f′(x)=0 解驻点 → 列表判断单调 → 得出极值。', { fontSize: 28, color: THEME.sub, fragment: true }))
      els.push(math(200, 560, 1520, 320, "f'(x)=3x^2-6x=3x(x-2)", { fontSize: 42, fragment: true }))
      els.push(math(200, 720, 1520, 200, '\text{单调增 }(-\infty,0)\;\cup\;(2,+\infty)\quad \text{单调减 }(0,2)', { fontSize: 34, color: THEME.accent, fragment: true }))
      els.push(divider(200, 1000, 1520))
      els.push(txt(200, 1020, 1520, 60, '∴ 极大值 f(0)=1，极小值 f(2)=−3。', { fontSize: 30, fragment: true }))
      return els
    },
  },
  {
    id: 'anim-derive',
    name: '公式推导·逐行显现',
    cat: '动画',
    build() {
      const els: SlideElement[] = []
      els.push(...headingBar(160, 140, 900, '公式推导'))
      els.push(txt(160, 240, 1800, 60, '等比数列前 n 项和（q≠1）', { fontSize: 32, fontWeight: 700, fragment: true }))
      els.push(math(200, 360, 1520, 220, 'S_n = a_1 + a_2 + \cdots + a_n', { fontSize: 38, fragment: true }))
      els.push(math(200, 620, 1520, 220, 'qS_n = a_1q + a_2q + \cdots + a_nq', { fontSize: 38, color: THEME.sub, fragment: true }))
      els.push(math(200, 880, 1520, 220, '(1-q)S_n = a_1(1-q^n)', { fontSize: 38, fragment: true }))
      els.push(divider(200, 1060, 1520))
      return els
    },
  },
  {
    id: 'anim-summarize',
    name: '课堂小结·逐条收拢',
    cat: '动画',
    build() {
      const els: SlideElement[] = []
      els.push(...headingBar(160, 140, 900, '课堂小结'))
      const items: [string, string, boolean][] = [
        ['核心概念', '函数的单调性与导数符号的关系', false],
        ['关键方法', '求导判断法：导数为正则增、为负则减', false],
        ['易错提醒', '驻点不一定都是极值点，需左右两侧单调性验证', true],
      ]
      items.forEach(([k, v, warn], i) => {
        const y = 300 + i * 230
        els.push(shape(160, y, 1600, 190, { fill: warn ? '#fdf1f1' : '#f5f5f2' }))
        els.push(txt(200, y + 26, 300, 60, k, { fontSize: 30, fontWeight: 700, color: THEME.accent, fragment: true }))
        els.push(txt(520, y + 26, 1200, 60, v, { fontSize: 28, fragment: true }))
      })
      return els
    },
  },
  {
    id: 'combo-core',
    name: '排列组合·核心公式',
    cat: '公式',
    build() {
      const els: SlideElement[] = []
      els.push(...headingBar(160, 140, 1000, '排列组合 · 核心公式'))
      els.push(divider(160, 220, 1600))
      els.push(shape(200, 280, 720, 180, { fill: '#f8f6f1' }))
      els.push(txt(230, 306, 300, 60, '排列', { fontSize: 28, fontWeight: 700, color: THEME.accent }))
      els.push(math(230, 348, 680, 100, 'A_n^m=\\frac{n!}{(n-m)!}', { fontSize: 42 }))
      els.push(shape(1000, 280, 720, 180, { fill: '#f8f6f1' }))
      els.push(txt(1030, 306, 300, 60, '组合', { fontSize: 28, fontWeight: 700, color: THEME.accent }))
      els.push(math(1030, 348, 680, 100, 'C_n^m=\\binom{n}{m}=\\frac{n!}{m!\\,(n-m)!}', { fontSize: 42 }))
      els.push(shape(200, 500, 1520, 150, { fill: '#fdf6e3' }))
      els.push(math(230, 530, 660, 120, 'C_n^m=C_n^{n-m}', { fontSize: 40, color: THEME.accent }))
      els.push(math(960, 530, 720, 120, 'n! = n\\cdot(n-1)\\cdots 1', { fontSize: 40, color: THEME.sub }))
      return els
    },
  },
  {
    id: 'math-summary',
    name: '数学总结（多栏）',
    cat: '小结',
    build: () => {
      const els = []
      // 题目框
      els.push(shape(60, 36, 1800, 170, { fill: '#eef2ff', stroke: '#7b8cf0', strokeWidth: 2 }))
      els.push(title(80, 52, 1760, 44, '数学总结（多栏）', { fontSize: 28, color: '#2b3a8c' }))
      els.push(txt(80, 104, 1760, 92, '题目：……（满分 15 分）\n（1）求实数 a,b 的值；（2）解关于 x 的不等式……', { fontSize: 20 }))
      // 左栏：一、求解
      els.push(shape(60, 226, 880, 444, { fill: '#fffdf2', stroke: '#e0d4a0', strokeWidth: 1.5 }))
      els.push(txt(80, 240, 844, 34, '一、求解（1）', { fontSize: 24, fontWeight: 700, color: '#8a6d1f' }))
      els.push(txt(80, 284, 844, 170, '步骤① 利用奇偶性 / 已知条件求参数\n    推导：……\n    结果：……\n步骤② 代入条件求另一个参数\n    推导：……\n    结果：……', { fontSize: 18 }))
      els.push(shape(80, 470, 220, 72, { fill: '#ffe9c9', stroke: '#e0a34a', strokeWidth: 1.5 }))
      els.push(txt(90, 480, 200, 52, '最终结果\x0a  a=…, b=…', { fontSize: 16, color: '#a2660a' }))
      // 右栏：二、解题思路
      els.push(shape(980, 226, 880, 444, { fill: '#f4f6fd', stroke: '#96a4e0', strokeWidth: 1.5 }))
      els.push(txt(1000, 240, 844, 34, '二、解题思路（2）', { fontSize: 24, fontWeight: 700, color: '#3a4a9c' }))
      els.push(txt(1000, 284, 844, 200, '整体思路：\n  ① 利用奇偶性变形\n  ② 证明单调性（导数法 / 定义法）\n  ③ 列出不等式组（先定义域优先，再单调性）\n  ④ 取交集得解集\n步骤1 奇偶性变形：……\n步骤2 单调性：……\n步骤3 不等式组：……', { fontSize: 18 }))
      els.push(shape(1000, 470, 320, 72, { fill: '#ffecec', stroke: '#e0888a', strokeWidth: 1.5 }))
      els.push(txt(1010, 480, 300, 52, '最终解集\x0a  （-1, 1/3）', { fontSize: 16, color: '#a83a3a' }))
      // 底部三栏
      els.push(shape(60, 690, 590, 350, { fill: '#f2faf2', stroke: '#9cc39c', strokeWidth: 1.5 }))
      els.push(txt(80, 700, 550, 34, '三、解题技巧总结', { fontSize: 22, fontWeight: 700, color: '#2f7a2f' }))
      els.push(txt(80, 744, 550, 270, '· 参数求解：奇偶性 + 已知点\n· 单调性判定：导数法/定义法\n· 解不等式：先定义域优先，再由单调性转化\n· 避免"增函数时 A<B 等价于 f(A)<f(B)"误用', { fontSize: 17 }))
      els.push(shape(665, 690, 590, 350, { fill: '#fff7f0', stroke: '#e0b38a', strokeWidth: 1.5 }))
      els.push(txt(685, 700, 550, 34, '四、易错提醒', { fontSize: 22, fontWeight: 700, color: '#b0762a' }))
      els.push(txt(685, 744, 550, 270, '· 确保每个自变量都在定义域内\n· 奇函数 f(-x)=-f(x) 别忘了\n· 解不等式时注意变号方向\n· 取交集勿漏端点', { fontSize: 17 }))
      els.push(shape(1270, 690, 590, 350, { fill: '#f4f4fd', stroke: '#a0a0d0', strokeWidth: 1.5 }))
      els.push(txt(1290, 700, 550, 34, '五、知识点归纳', { fontSize: 22, fontWeight: 700, color: '#4a4a9c' }))
      els.push(txt(1290, 744, 550, 270, '· 奇偶性 / 单调性定义\n· 导数判定单调性\n· 定义域优先原则\n· 不等式与函数单调性转化', { fontSize: 17 }))
      return els
    },
  },
]

export function findTemplate(id: string): Template | undefined {
  return mathTemplates.find((t) => t.id === id)
}
