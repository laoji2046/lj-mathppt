/**
 * 模板主题 tokens（设计宪法）
 *
 * 规矩（这些是"像人做的 PPT"的关键，别随手破）：
 * - 60-30-10：60% 中性（底/字）、30% 主色、10% 强调色；强调色只用于数字、关键词、当前项
 * - 字号只能取 TypeScale 里的档位，禁止随手写 27、31 这种数
 * - 圆角 ≤ 8px、不用渐变/阴影堆叠、字体族 ≤ 2 种
 * - 居中只出现在封面 / 章节页 / 结尾页；其余一律左对齐
 * - 并列元素要有主次（5:4:3），禁止等宽三连
 */
import type { Rect } from '@/types'

export interface TypeScale {
  display: number   // 封面主标题
  h1: number        // 页标题
  h2: number        // 小节标题
  h3: number        // 卡片标题
  body: number      // 正文
  small: number     // 辅助说明
  label: number     // 页眉标签 / 页码
}

export interface GridTokens { margin: number; cols: number; gutter: number }

export interface Theme {
  id: string
  name: string
  description: string
  bg: string
  text: string
  primary: string
  accent: string
  muted: string
  line: string
  formulaBg?: string
  fontTitle: string
  fontBody: string
  fontMono: string
  type: TypeScale
  grid: GridTokens
  radius: number
  showHeader: boolean
}

// ── EduMath · 数学讲义（米白底 + 深蓝 + 橙，课堂/公开课）──────────────────────
const eduMath: Theme = {
  id: 'edumath',
  name: 'EduMath · 讲义',
  description: '高中数学讲义风：米白底、深蓝主色、橙色强调',
  bg: '#FAF7F0',
  text: '#26282B',
  primary: '#1D4E89',
  accent: '#E8871E',
  muted: '#5F5E5A',
  line: '#D3D1C7',
  formulaBg: '#F0EDE6',
  fontTitle: 'hei-bold',
  fontBody: 'sans',
  fontMono: 'mono',
  type: { display: 84, h1: 54, h2: 36, h3: 30, body: 28, small: 24, label: 18 },
  grid: { margin: 96, cols: 12, gutter: 16 },
  radius: 8,
  showHeader: true,
}

// ── Formal · 讲座（白底 + 藏青 + 金，公开课评比/评审）─────────────────────────
const formal: Theme = {
  id: 'formal',
  name: 'Formal · 讲座',
  description: '正式讲座风：白底、藏青主色、金色点缀、宋体标题',
  bg: '#FFFFFF',
  text: '#2B2B2B',
  primary: '#14336B',
  accent: '#B08D44',
  muted: '#6B7280',
  line: '#D1D5DB',
  formulaBg: '#F4F2EC',
  fontTitle: 'serif',
  fontBody: 'sans',
  fontMono: 'mono',
  type: { display: 80, h1: 50, h2: 34, h3: 28, body: 26, small: 22, label: 16 },
  grid: { margin: 88, cols: 12, gutter: 16 },
  radius: 4,
  showHeader: true,
}

// ── Office · 汇报（白底 + Office 蓝 + 浅灰，述职/工作汇报）────────────────────
const office: Theme = {
  id: 'office',
  name: 'Office · 汇报',
  description: 'Office 风：白底、Office 蓝主色、浅灰辅助，适合述职与工作汇报',
  bg: '#FFFFFF',
  text: '#1F1F1F',
  primary: '#4472C4',
  accent: '#C00000',
  muted: '#595959',
  line: '#D9D9D9',
  formulaBg: '#F2F2F2',
  fontTitle: 'hei-bold',
  fontBody: 'sans',
  fontMono: 'mono',
  type: { display: 76, h1: 48, h2: 34, h3: 28, body: 26, small: 22, label: 16 },
  grid: { margin: 88, cols: 12, gutter: 16 },
  radius: 4,
  showHeader: true,
}

export const THEMES: Record<string, Theme> = { edumath: eduMath, formal, office }
export const THEME_LIST: Theme[] = [eduMath, formal, office]
export function getTheme(id: string): Theme { return THEMES[id] ?? eduMath }

/** 12 列网格 → 元素矩形（col 从 1 开始） */
export function gridCell(
  canvas: { width: number; height: number },
  theme: Theme,
  col: number, span: number, rowTop: number, rowHeight: number,
): Rect {
  const { margin, cols, gutter } = theme.grid
  const usable = canvas.width - margin * 2
  const colW = (usable - gutter * (cols - 1)) / cols
  return {
    x: Math.round(margin + (col - 1) * (colW + gutter)),
    y: Math.round(rowTop),
    w: Math.round(span * colW + (span - 1) * gutter),
    h: Math.round(rowHeight),
  }
}

export function c(t: Theme) {
  return { bg: t.bg, text: t.text, primary: t.primary, accent: t.accent, muted: t.muted, line: t.line, formulaBg: t.formulaBg ?? t.bg }
}
