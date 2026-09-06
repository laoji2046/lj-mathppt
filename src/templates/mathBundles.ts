/**
 * 整套讲座模板 —— 把若干张幻灯片打包，一键替换当前演示。
 *
 * 配色与字体严格遵循 slideo-template-prompts.md 的「去 AI 味」设计宪法：
 * - EduMath 风：米白 #FAF7F0 + 深蓝 #1D4E89 + 强调橙 #E8871E + 公式底 #F0EDE6
 * - Formal  风：白底  + 藏青 #14336B + 金色 #B08D44 + 公式底 #F4F2EC
 * - 字号阶梯 84/54/36/30/24/18（EduMath），80/50/34/28/22/16（Formal）
 * - 居中仅用于封面 / 章节页 / 结尾页；正文一律左对齐
 * - 文案真实：标题=结论句、要点=主张+支撑句、数据引用具体到题号
 */

import type { Slide, SlideElement } from '@/types'

// ---- 元素工厂（与 mathTemplates.ts 同源但独立以避免耦合） ----
function eid(): string {
  return 'el_' + Math.random().toString(36).slice(2, 10)
}
function sid(): string {
  return 'sl_' + Math.random().toString(36).slice(2, 10)
}

interface BaseText {
  type: 'text'
  text: string
  fontSize: number
  fontWeight?: number
  fontFamily?: string
  color?: string
  align?: 'left' | 'center' | 'right'
}

function T(
  x: number, y: number, w: number, h: number,
  p: BaseText,
): SlideElement {
  return {
    id: eid(), type: 'text', rot: 0, x, y, w, h,
    text: p.text,
    fontSize: p.fontSize,
    fontWeight: p.fontWeight ?? 400,
    color: p.color ?? '#26282B',
    fontFamily: p.fontFamily ?? 'sans',
    align: p.align ?? 'left',
    bgColor: 'transparent',
    shadow: 'none',
  }
}

function R(x: number, y: number, w: number, h: number, fill: string): SlideElement {
  return { id: eid(), type: 'shape', rot: 0, x, y, w, h, shape: 'rect', fill, stroke: 'transparent', strokeWidth: 0 }
}

// ──────────────────────────────────────────────────────────────────────────────
// 讲座 1：三角函数一轮复习（EduMath · 5 页）
// ──────────────────────────────────────────────────────────────────────────────
function trigLessonSlides(): Slide[] {
  const E = {
    bg: '#FAF7F0', ink: '#26282B', primary: '#1D4E89', accent: '#E8871E',
    sub: '#5F5E5A', line: '#D3D1C7', formulaBg: '#F0EDE6',
  }
  return [
    // 1. 封面
    {
      id: sid(), bg: E.bg,
      elements: [
        R(0, 0, 700, 1080, E.primary),
        T(96, 280, 510, 280, { type: 'text', text: '三角函数图像变换', fontSize: 84, fontWeight: 700, color: '#FFFFFF', fontFamily: 'sans' }),
        T(96, 600, 510, 96,  { type: 'text', text: '一轮复习公开课',   fontSize: 30, color: 'rgba(255,255,255,0.78)', fontFamily: 'sans' }),
        T(796, 860, 1024, 56, { type: 'text', text: '老冀',               fontSize: 36, fontWeight: 700, color: E.ink, fontFamily: 'sans' }),
        T(796, 924, 1024, 40, { type: 'text', text: '广东省某中学 · 高三数学组', fontSize: 24, color: E.sub, fontFamily: 'sans' }),
        T(796, 980, 1024, 40, { type: 'text', text: '2026 年 3 月', fontSize: 24, color: E.sub, fontFamily: 'mono' }),
      ],
    },
    // 2. 目录
    {
      id: sid(), bg: E.bg,
      elements: [
        R(96, 56, 1728, 1, E.line),
        T(96, 16, 864, 36, { type: 'text', text: '三角函数 · 图像变换', fontSize: 18, color: E.sub, fontFamily: 'sans' }),
        T(960, 16, 864, 36, { type: 'text', text: 'Slideo · 课件', fontSize: 18, color: E.sub, fontFamily: 'sans', align: 'right' }),
        T(96, 120, 320, 120, { type: 'text', text: '目  录', fontSize: 84, fontWeight: 700, color: E.primary, fontFamily: 'sans' }),
        T(96, 256, 320, 36,  { type: 'text', text: 'CONTENTS', fontSize: 18, color: E.sub, fontFamily: 'mono' }),
        T(480, 156, 80, 84,  { type: 'text', text: '01', fontSize: 36, fontWeight: 700, color: E.accent, fontFamily: 'mono' }),
        T(580, 164, 1100, 64,{ type: 'text', text: '三角函数图像变换的核心参数', fontSize: 30, fontWeight: 600, color: E.ink, fontFamily: 'sans' }),
        T(1700, 172, 80, 56,{ type: 'text', text: 'P.03', fontSize: 22, color: E.sub, fontFamily: 'mono', align: 'right' }),
        R(480, 248, 1300, 1, E.line),
        T(480, 256, 80, 84,  { type: 'text', text: '02', fontSize: 36, fontWeight: 700, color: E.accent, fontFamily: 'mono' }),
        T(580, 264, 1100, 64,{ type: 'text', text: 'ω 与周期 T 的关系', fontSize: 30, fontWeight: 600, color: E.ink, fontFamily: 'sans' }),
        T(1700, 272, 80, 56,{ type: 'text', text: 'P.07', fontSize: 22, color: E.sub, fontFamily: 'mono', align: 'right' }),
        R(480, 348, 1300, 1, E.line),
        T(480, 356, 80, 84,  { type: 'text', text: '03', fontSize: 36, fontWeight: 700, color: E.accent, fontFamily: 'mono' }),
        T(580, 364, 1100, 64,{ type: 'text', text: 'φ 与左右平移的方向判别', fontSize: 30, fontWeight: 600, color: E.ink, fontFamily: 'sans' }),
        T(1700, 372, 80, 56,{ type: 'text', text: 'P.12', fontSize: 22, color: E.sub, fontFamily: 'mono', align: 'right' }),
        R(480, 448, 1300, 1, E.line),
        T(480, 456, 80, 84,  { type: 'text', text: '04', fontSize: 36, fontWeight: 700, color: E.accent, fontFamily: 'mono' }),
        T(580, 464, 1100, 64,{ type: 'text', text: '五点法：一个周期内的关键坐标', fontSize: 30, fontWeight: 600, color: E.ink, fontFamily: 'sans' }),
        T(1700, 472, 80, 56,{ type: 'text', text: 'P.18', fontSize: 22, color: E.sub, fontFamily: 'mono', align: 'right' }),
        R(480, 548, 1300, 1, E.line),
        T(480, 556, 80, 84,  { type: 'text', text: '05', fontSize: 36, fontWeight: 700, color: E.accent, fontFamily: 'mono' }),
        T(580, 564, 1100, 64,{ type: 'text', text: '常见考型与失分点', fontSize: 30, fontWeight: 600, color: E.ink, fontFamily: 'sans' }),
        T(1700, 572, 80, 56,{ type: 'text', text: 'P.24', fontSize: 22, color: E.sub, fontFamily: 'mono', align: 'right' }),
        T(1744, 1032, 80, 36, { type: 'text', text: '02', fontSize: 18, color: E.sub, fontFamily: 'mono', align: 'right' }),
      ],
    },
    // 3. 章节页
    {
      id: sid(), bg: E.bg,
      elements: [
        R(940, 280, 60, 6, E.primary),
        T(0, 320, 1920, 320,  { type: 'text', text: '01', fontSize: 280, fontWeight: 700, color: E.primary, fontFamily: 'mono', align: 'center' }),
        T(0, 680, 1920, 120,  { type: 'text', text: 'ω 决定周期', fontSize: 54, fontWeight: 700, color: E.ink, fontFamily: 'sans', align: 'center' }),
        T(0, 820, 1920, 56,   { type: 'text', text: '把图像横向"挤紧"或"拉开"的那根杠杆', fontSize: 30, color: E.sub, fontFamily: 'sans', align: 'center' }),
      ],
    },
    // 4. 要点页
    {
      id: sid(), bg: E.bg,
      elements: [
        R(96, 56, 1728, 1, E.line),
        T(96, 16, 864, 36, { type: 'text', text: '三角函数 · 图像变换', fontSize: 18, color: E.sub, fontFamily: 'sans' }),
        T(960, 16, 864, 36, { type: 'text', text: 'Slideo · 课件', fontSize: 18, color: E.sub, fontFamily: 'sans', align: 'right' }),
        T(96, 116, 1380, 120, { type: 'text', text: 'ω 决定周期：y = sin(ωx) 的周期为 2π / ω', fontSize: 54, fontWeight: 700, color: E.ink, fontFamily: 'sans' }),
        R(96, 248, 64, 4, E.primary),
        R(96, 322, 8, 8, E.primary), T(122, 300, 900, 48, { type: 'text', text: '周期与 ω 反相关', fontSize: 30, fontWeight: 700, color: E.ink, fontFamily: 'sans' }),
        T(122, 352, 900, 48, { type: 'text', text: 'ω 翻倍，周期 T 缩为一半；ω 缩小一半，T 翻倍。', fontSize: 24, color: E.sub, fontFamily: 'sans' }),
        R(96, 432, 8, 8, E.primary), T(122, 410, 900, 48, { type: 'text', text: '图像横向压缩/拉伸', fontSize: 30, fontWeight: 700, color: E.ink, fontFamily: 'sans' }),
        T(122, 462, 900, 48, { type: 'text', text: '把 x 替换为 ωx，相当于把原图像在 x 方向"挤紧"或"拉开"。', fontSize: 24, color: E.sub, fontFamily: 'sans' }),
        R(96, 542, 8, 8, E.primary), T(122, 520, 900, 48, { type: 'text', text: '不改变振幅与相位', fontSize: 30, fontWeight: 700, color: E.ink, fontFamily: 'sans' }),
        T(122, 572, 900, 48, { type: 'text', text: 'y = sin(ωx) 的最大值、最小值、零点结构由 ω 与初相共同决定。', fontSize: 24, color: E.sub, fontFamily: 'sans' }),
        R(96, 652, 8, 8, E.primary), T(122, 630, 900, 48, { type: 'text', text: '五点法的关键坐标变化', fontSize: 30, fontWeight: 700, color: E.ink, fontFamily: 'sans' }),
        T(122, 682, 900, 48, { type: 'text', text: '原本 ωx = 0, π/2, π, 3π/2, 2π 对应 x = 0, π/2ω, π/ω, 3π/2ω, 2π/ω。', fontSize: 24, color: E.sub, fontFamily: 'sans' }),
        T(1488, 244, 336, 48, { type: 'text', text: '速记', fontSize: 30, fontWeight: 700, color: E.primary, fontFamily: 'sans' }),
        R(1488, 300, 336, 600, E.formulaBg),
        T(1512, 328, 288, 72, { type: 'text', text: 'T = 2π / |ω|', fontSize: 30, color: E.ink, fontFamily: 'mono' }),
        T(1512, 418, 288, 72, { type: 'text', text: 'ω > 0：图像压缩', fontSize: 30, color: E.ink, fontFamily: 'mono' }),
        T(1512, 508, 288, 72, { type: 'text', text: 'ω < 0：取负再按正', fontSize: 30, color: E.ink, fontFamily: 'mono' }),
        T(1744, 1032, 80, 36, { type: 'text', text: '03', fontSize: 18, color: E.sub, fontFamily: 'mono', align: 'right' }),
      ],
    },
    // 5. 结尾页
    {
      id: sid(), bg: E.bg,
      elements: [
        R(940, 320, 60, 6, E.primary),
        T(0, 360, 1920, 160, { type: 'text', text: '练到会为止，考场才不慌', fontSize: 84, fontWeight: 700, color: E.ink, fontFamily: 'sans', align: 'center' }),
        T(0, 560, 1920, 56,  { type: 'text', text: '公众号：老冀聊数学  ·  邮箱：example@school.cn', fontSize: 30, color: E.sub, fontFamily: 'sans', align: 'center' }),
        T(0, 880, 1920, 48,  { type: 'text', text: '老冀  ·  广东省某中学 · 高三数学组', fontSize: 28, fontWeight: 600, color: E.primary, fontFamily: 'sans', align: 'center' }),
      ],
    },
  ]
}

// ──────────────────────────────────────────────────────────────────────────────
// 讲座 2：高考真题点评讲座（Formal · 6 页）
// ──────────────────────────────────────────────────────────────────────────────
function gaokaoLectureSlides(): Slide[] {
  const F = {
    bg: '#FFFFFF', ink: '#2B2B2B', primary: '#14336B', accent: '#B08D44',
    sub: '#6B7280', line: '#D1D5DB', formulaBg: '#F4F2EC',
  }
  return [
    // 1. 封面
    {
      id: sid(), bg: F.bg,
      elements: [
        R(0, 0, 700, 1080, F.primary),
        R(96, 880, 510, 2, F.accent),
        T(96, 280, 510, 280, { type: 'text', text: '三角函数命题趋势\n与教学启示', fontSize: 70, fontWeight: 700, color: '#FFFFFF', fontFamily: 'serif' }),
        T(96, 620, 510, 96,  { type: 'text', text: '2023–2025 新高考Ⅰ卷考点评析', fontSize: 26, color: 'rgba(255,255,255,0.78)', fontFamily: 'sans' }),
        T(796, 860, 1024, 56, { type: 'text', text: '老冀', fontSize: 32, fontWeight: 700, color: F.ink, fontFamily: 'serif' }),
        T(796, 924, 1024, 40, { type: 'text', text: '高考备考讲座', fontSize: 24, color: F.sub, fontFamily: 'sans' }),
        T(796, 980, 1024, 40, { type: 'text', text: '2026 年 1 月', fontSize: 22, color: F.sub, fontFamily: 'mono' }),
      ],
    },
    // 2. 目录
    {
      id: sid(), bg: F.bg,
      elements: [
        R(88, 56, 1744, 1, F.line),
        T(88, 16, 880, 36, { type: 'text', text: '高考备考 · 三角函数', fontSize: 16, color: F.sub, fontFamily: 'serif' }),
        T(968, 16, 864, 36, { type: 'text', text: 'Slideo · 讲座', fontSize: 16, color: F.sub, fontFamily: 'serif', align: 'right' }),
        T(88, 120, 320, 120, { type: 'text', text: '目  录', fontSize: 80, fontWeight: 700, color: F.primary, fontFamily: 'serif' }),
        T(88, 256, 320, 32,  { type: 'text', text: 'CONTENTS', fontSize: 16, color: F.sub, fontFamily: 'mono' }),
        ...tocRows(480, 156, F, '01', '近三年命题结构与分值', '03'),
        ...tocRows(480, 256, F, '02', '高频考点与图像类题型', '04'),
        ...tocRows(480, 356, F, '03', '例题评析：2025 新高考Ⅰ卷', '05'),
        ...tocRows(480, 456, F, '04', '二轮复习策略与常见失分点', '06'),
        T(1744, 1032, 80, 36, { type: 'text', text: '02', fontSize: 16, color: F.sub, fontFamily: 'mono', align: 'right' }),
      ],
    },
    // 3. 章节页
    {
      id: sid(), bg: F.bg,
      elements: [
        R(950, 280, 60, 6, F.primary),
        T(0, 320, 1920, 320, { type: 'text', text: '01', fontSize: 280, fontWeight: 700, color: F.primary, fontFamily: 'mono', align: 'center' }),
        T(0, 680, 1920, 120, { type: 'text', text: '近三年命题结构与分值', fontSize: 50, fontWeight: 700, color: F.ink, fontFamily: 'serif', align: 'center' }),
        T(0, 820, 1920, 56,  { type: 'text', text: '从 2023 到 2025，三角函数题的"位置"基本不变', fontSize: 28, color: F.sub, fontFamily: 'sans', align: 'center' }),
      ],
    },
    // 4. 例题 1
    {
      id: sid(), bg: F.bg,
      elements: [
        R(88, 56, 1744, 1, F.line),
        T(88, 16, 880, 36, { type: 'text', text: '高考备考 · 三角函数', fontSize: 16, color: F.sub, fontFamily: 'serif' }),
        T(968, 16, 864, 36, { type: 'text', text: 'Slideo · 讲座', fontSize: 16, color: F.sub, fontFamily: 'serif', align: 'right' }),
        T(88, 108, 1744, 36, { type: 'text', text: '例 1 · 2025 新高考 Ⅰ 卷第 6 题', fontSize: 16, fontWeight: 600, color: F.accent, fontFamily: 'mono' }),
        T(88, 148, 1744, 84, { type: 'text', text: '已知 f(x) = sin(2x + π/3)，求其最小正周期', fontSize: 34, fontWeight: 700, color: F.ink, fontFamily: 'serif' }),
        R(88, 248, 1744, 96, F.formulaBg),
        T(112, 264, 1696, 64, { type: 'text', text: '题目原文：函数 f(x) = sin(2x + π/3) 的最小正周期为（    ）。A. π/2  B. π  C. 2π  D. 4π。', fontSize: 24, color: F.ink, fontFamily: 'sans' }),
        ...problemSteps(380, F, [
          { lead: '识别 ω', support: '与 y = sin(ωx + φ) 对照，ω = 2，φ = π/3（与周期无关）。' },
          { lead: '套用周期公式', support: 'T = 2π / |ω| = 2π / 2 = π。' },
          { lead: '验证', support: '令 ω(x + T) = ωx + 2π ⇒ T = π，与公式结果一致。' },
        ]),
        R(88, 920, 1744, 72, F.primary),
        T(112, 932, 1696, 48, { type: 'text', text: '关键结论：最小正周期为 π，答案选 B', fontSize: 28, fontWeight: 700, color: '#FFFFFF', fontFamily: 'serif' }),
        T(1744, 1032, 80, 36, { type: 'text', text: '04', fontSize: 16, color: F.sub, fontFamily: 'mono', align: 'right' }),
      ],
    },
    // 5. 例题 2
    {
      id: sid(), bg: F.bg,
      elements: [
        R(88, 56, 1744, 1, F.line),
        T(88, 16, 880, 36, { type: 'text', text: '高考备考 · 三角函数', fontSize: 16, color: F.sub, fontFamily: 'serif' }),
        T(968, 16, 864, 36, { type: 'text', text: 'Slideo · 讲座', fontSize: 16, color: F.sub, fontFamily: 'serif', align: 'right' }),
        T(88, 108, 1744, 36, { type: 'text', text: '例 2 · 2024 新高考 Ⅱ 卷第 8 题', fontSize: 16, fontWeight: 600, color: F.accent, fontFamily: 'mono' }),
        T(88, 148, 1744, 84, { type: 'text', text: 'y = sin(x/2) 与 y = sin(x) 在 [0, 4π] 上的交点个数', fontSize: 34, fontWeight: 700, color: F.ink, fontFamily: 'serif' }),
        R(88, 248, 1744, 96, F.formulaBg),
        T(112, 264, 1696, 64, { type: 'text', text: '题目原文：在区间 [0, 4π] 上，函数 y = sin(x/2) 与 y = sin(x) 图象的交点个数为（    ）。', fontSize: 24, color: F.ink, fontFamily: 'sans' }),
        ...problemSteps(380, F, [
          { lead: '画图定位', support: 'y = sin(x/2) 周期 4π，在 [0, 4π] 上仅画一个完整周期；y = sin(x) 画两个完整周期。' },
          { lead: '数交点', support: '每个完整周期内两函数交 4 次，再考虑 x = 0 与 x = 4π 重合点。' },
          { lead: '得出结论', support: '共 8 个交点。' },
        ]),
        R(88, 920, 1744, 72, F.primary),
        T(112, 932, 1696, 48, { type: 'text', text: '关键结论：在 [0, 4π] 上共有 8 个交点', fontSize: 28, fontWeight: 700, color: '#FFFFFF', fontFamily: 'serif' }),
        T(1744, 1032, 80, 36, { type: 'text', text: '05', fontSize: 16, color: F.sub, fontFamily: 'mono', align: 'right' }),
      ],
    },
    // 6. 结尾
    {
      id: sid(), bg: F.bg,
      elements: [
        R(950, 320, 60, 6, F.primary),
        T(0, 360, 1920, 160, { type: 'text', text: '研究命题方向，比刷题更省力', fontSize: 70, fontWeight: 700, color: F.ink, fontFamily: 'serif', align: 'center' }),
        T(0, 560, 1920, 56,  { type: 'text', text: '微信公众号：老冀聊数学  ·  邮箱：example@school.cn', fontSize: 26, color: F.sub, fontFamily: 'sans', align: 'center' }),
        T(0, 880, 1920, 48,  { type: 'text', text: '老冀  ·  高考备考讲座', fontSize: 28, fontWeight: 600, color: F.primary, fontFamily: 'serif', align: 'center' }),
        R(920, 960, 80, 2, F.accent),
      ],
    },
  ]
}

// 目录条目三件套（编号 + 标题 + 页码 + 分隔线）
function tocRows(x: number, y: number, F: { sub: string; ink: string; accent: string; line: string }, num: string, title: string, page: string): SlideElement[] {
  return [
    T(x, y, 80, 84,   { type: 'text', text: num, fontSize: 34, fontWeight: 700, color: F.accent, fontFamily: 'mono' }),
    T(x + 100, y + 8, 1100, 64, { type: 'text', text: title, fontSize: 28, fontWeight: 600, color: F.ink, fontFamily: 'serif' }),
    T(x + 1220, y + 16, 80, 56, { type: 'text', text: `P.${page}`, fontSize: 22, color: F.sub, fontFamily: 'mono', align: 'right' }),
    R(x, y + 92, 1300, 1, F.line),
  ]
}

// 例题步骤三件套（编号 + 主张 + 支撑句）
function problemSteps(startY: number, F: { primary: string; ink: string; sub: string }, steps: { lead: string; support?: string }[]): SlideElement[] {
  const out: SlideElement[] = []
  steps.forEach((s, i) => {
    const y = startY + i * 96
    out.push(
      T(88, y, 60, 80, { type: 'text', text: `0${i + 1}`, fontSize: 34, fontWeight: 700, color: F.primary, fontFamily: 'mono' }),
      T(168, y + 4, 1664, 44, { type: 'text', text: s.lead, fontSize: 28, fontWeight: 700, color: F.ink, fontFamily: 'serif' }),
    )
    if (s.support) {
      out.push(T(168, y + 48, 1664, 40, { type: 'text', text: s.support, fontSize: 22, color: F.sub, fontFamily: 'sans' }))
    }
  })
  return out
}

export interface MathBundle {
  id: string
  name: string
  description: string
  slides: Slide[]
}

export const mathBundles: MathBundle[] = [
  {
    id: 'bundle-trig-lesson',
    name: '三角函数一轮复习（5 页）',
    description: 'EduMath 风 · 公开课课件骨架 · 配色：米白 + 深蓝 + 强调橙',
    slides: trigLessonSlides(),
  },
  {
    id: 'bundle-gaokao-lecture',
    name: '高考真题点评讲座（6 页）',
    description: 'Formal 风 · 公开课评比 / 备考讲座 · 配色：白底 + 藏青 + 金色',
    slides: gaokaoLectureSlides(),
  },
]

export function findBundle(id: string): MathBundle | undefined {
  return mathBundles.find((b) => b.id === id)
}
