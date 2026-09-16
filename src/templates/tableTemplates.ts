import type { TableMerge } from '@/types'

/**
 * 表格模板：一键插出教材/统计常用的几种表。
 * 单元格里支持咱们那一套 —— \(LaTeX\) 或 $…$ 写公式、{{fig:kind}} 插数学图形。
 */
export interface TableTemplate {
  id: string
  name: string
  hint?: string
  rows: string[][]
  merges?: TableMerge[]
  caption?: string
  figHeight?: number
  borderMode?: 'all' | 'three'
  /** 建议的元素尺寸（插到画布上的初始大小） */
  w?: number
  h?: number
}

export const TABLE_TEMPLATES: TableTemplate[] = [
  {
    id: 'three-line',
    name: '三线表（教材常用）',
    hint: '只画顶线 / 表头下线 / 底线',
    borderMode: 'three',
    rows: [
      ['项目', '数值', '说明'],
      ['', '', ''],
      ['', '', ''],
      ['', '', ''],
    ],
    w: 620,
    h: 260,
  },
  {
    id: 'compare',
    name: '双栏对比表',
    borderMode: 'three',
    rows: [
      ['', '甲', '乙'],
      ['定义', '', ''],
      ['性质', '', ''],
      ['图像', '', ''],
    ],
    w: 640,
    h: 300,
  },
  {
    id: 'exp-4-1',
    name: '函数图像与性质（表 4-1 式）',
    hint: '左列跨行 + 图形 + 公式',
    caption: '表 4-1',
    figHeight: 120,
    rows: [
      ['$y=a^x$', '$a>1$', '$0<a<1$'],
      ['图像', '{{fig:exponential}}', '{{fig:expDecay}}'],   // ⚠ 右列必须是**递减**的 expDecay ✓（原先两列都写 exponential ✗，于是 0<a<1 那张也画成递增 ✗）
      ['图像特征', '图像都在 $x$ 轴上方，无限趋近于 $x$ 轴', '过点 $(0,1)$'],
      ['函数性质', '定义域为 $\\mathbf{R}$，值域 $(0,+\\infty)$', '在 $\\mathbf{R}$ 上是减函数'],
    ],
    merges: [{ r: 1, c: 0, rs: 3, cs: 1 }],
    w: 860,
    h: 420,
  },
  {
    id: 'stats',
    name: '统计表',
    rows: [
      ['分组', '频数', '频率'],
      ['$[a,b)$', '', ''],
      ['$[b,c)$', '', ''],
      ['合计', '', '1'],
    ],
    w: 560,
    h: 260,
  },
  {
    id: 'blank',
    name: '空白表格 3×3',
    rows: [
      ['', '', ''],
      ['', '', ''],
      ['', '', ''],
    ],
    w: 560,
    h: 240,
  },
]
