/**
 * 专业模板（Reveal.js「PowerPoint 风」母版版式），参照《revealjs-ppt风格模板-提示词》。
 *
 * - 舞台 1920×1080；白底 + Office 蓝 #4472C4 + 深灰正文；顶对齐、版心 90px。
 * - 7 种母版版式：封面 / 章节 / 列表 / 双栏 / 图 / 引用 / 结尾。
 * - 全片只用令牌色与固定字号阶梯，无渐变、无 emoji、无外发光。
 */
import type { SlideElement, TextElement, ShapeElement } from '@/types'

export const PPT_FONT_TITLE = 'hei-bold'
export const PPT_FONT_BODY = 'sans'

export const PPT = {
  bg: '#FFFFFF',
  text: '#1F1F1F',
  light: '#595959',
  accent: '#4472C4',
  accentDark: '#2F5597',
  divider: '#D9D9D9',
  footer: '#8C8C8C',
}

const M = 90           // 版心四边距
const CW = 1920 - M * 2 // 内容宽 1740

function uid() { return 'el_' + Math.random().toString(36).slice(2, 10) }

function txt(x: number, y: number, w: number, h: number, text: string, o: Partial<TextElement> = {}): TextElement {
  return {
    id: uid(), type: 'text', x, y, w, h, rot: 0,
    text, fontSize: 30, color: PPT.text, fontWeight: 400,
    align: 'left', fontFamily: PPT_FONT_BODY, bgColor: 'transparent', shadow: 'none', ...o,
  }
}
function shp(x: number, y: number, w: number, h: number, fill: string, o: Partial<ShapeElement> = {}): ShapeElement {
  return { id: uid(), type: 'shape', shape: 'rect', x, y, w, h, rot: 0, fill, stroke: PPT.text, strokeWidth: 0, ...o }
}
/** 内容页标题（左上角 + 强调色细横线） */
function title(x: number, y: number, text: string): SlideElement[] {
  return [
    txt(x, y, CW, 68, text, { fontSize: 54, fontWeight: 700, fontFamily: PPT_FONT_TITLE, color: PPT.text, align: 'left' }),
    shp(x, y + 76, 120, 4, PPT.accent),
  ]
}
/** 页脚：左下机构名 + 右下页码 */
function footer(inst: string, page: string): SlideElement[] {
  return [
    txt(M, 1004, 700, 30, inst, { fontSize: 24, color: PPT.footer, align: 'left' }),
    txt(1600, 1004, 230, 30, page, { fontSize: 24, color: PPT.footer, align: 'right' }),
  ]
}

export interface ProTemplate { id: string; name: string; cat: string; build(): SlideElement[] }

export const proTemplates: ProTemplate[] = [
  {
    id: 'ppt-cover', name: '专业模板 · 封面', cat: '封面',
    build() {
      return [
        shp(1740, M, 90, 60, PPT.accent),   // 角部强调色色块
        txt(M + 60, 330, 1500, 140, '主标题 · 可替换', { fontSize: 78, fontWeight: 700, fontFamily: PPT_FONT_TITLE, color: PPT.text, align: 'left' }),
        txt(M + 60, 500, 1300, 60, '一句话副标题，说明本演示的主题与价值', { fontSize: 34, color: PPT.light, align: 'left' }),
        txt(M + 60, 596, 1300, 48, '汇报人 · 机构名 · 2026-03', { fontSize: 28, color: PPT.light, align: 'left' }),
        ...footer('机构名 / 课程名', '1'),
      ]
    },
  },
  {
    id: 'ppt-section', name: '专业模板 · 章节页', cat: '章节',
    build() {
      return [
        shp(M, 340, 1500, 3, PPT.divider),
        txt(M, 200, 900, 200, '01', { fontSize: 168, fontWeight: 700, fontFamily: PPT_FONT_TITLE, color: PPT.accent, align: 'left' }),
        txt(M + 300, 320, 1300, 90, '章节标题（替换）', { fontSize: 56, fontWeight: 700, fontFamily: PPT_FONT_TITLE, color: PPT.text, align: 'left' }),
        txt(M + 302, 430, 1300, 40, '章节引言 / 学习目标', { fontSize: 28, color: PPT.light, align: 'left' }),
        ...footer('机构名 / 课程名', '2'),
      ]
    },
  },
  {
    id: 'ppt-list', name: '专业模板 · 要点列表', cat: '列表',
    build() {
      const items = ['要点一：先把核心结论写清楚', '要点二：逐条展开，每条不超过两行', '要点三：用强调色方块作列表符号']
      const els: SlideElement[] = title(M, 130, '本页标题（要点列表）')
      items.forEach((s, i) => {
        const y = 300 + i * 190
        els.push(shp(M + 20, y + 12, 18, 18, PPT.accent))
        els.push(txt(M + 70, y, 1500, 70, s, { fontSize: 32, color: PPT.text, align: 'left', fragment: true }))
        if (i < items.length - 1) els.push(shp(M + 20, y + 150, 1600, 1, PPT.divider))
      })
      els.push(...footer('机构名 / 课程名', '3'))
      return els
    },
  },
  {
    id: 'ppt-two', name: '专业模板 · 左右双栏', cat: '双栏',
    build() {
      const els: SlideElement[] = title(M, 130, '本页标题（左右双栏）')
      const cols: [number, string][] = [[0, '左栏要点'], [1, '右栏要点']]
      cols.forEach(([i, head]) => {
        const x = M + i * (CW / 2)
        els.push(shp(x, 280, 8, 520, PPT.accent))
        els.push(txt(x + 24, 300, CW / 2 - 60, 40, head, { fontSize: 30, fontWeight: 700, color: PPT.accentDark, align: 'left' }))
        for (let j = 0; j < 3; j++) {
          els.push(txt(x + 24, 360 + j * 150, CW / 2 - 60, 60, '• 子要点内容 ' + (j + 1), { fontSize: 28, color: PPT.text, align: 'left', fragment: true }))
        }
      })
      els.push(...footer('机构名 / 课程名', '4'))
      return els
    },
  },
  {
    id: 'ppt-figure', name: '专业模板 · 图片/图表', cat: '图片',
    build() {
      return [
        ...title(M, 100, '本页标题（图片/图表）'),
        shp(M, 240, 1100, 620, '#F2F2F2'),   // 图片占位
        txt(M, 270, 1100, 60, '（在此插入图片，等比缩放居中）', { fontSize: 26, color: PPT.light, align: 'center' }),
        txt(M, 880, 1100, 40, '图 1-1 图片题注说明', { fontSize: 24, color: PPT.light, align: 'center' }),
        shp(1300, 240, 6, 620, PPT.divider),
        txt(1340, 300, 500, 60, '右栏要点', { fontSize: 30, fontWeight: 700, color: PPT.accentDark, align: 'left' }),
        txt(1340, 380, 480, 60, '• 要点文字', { fontSize: 28, color: PPT.text, align: 'left', fragment: true }),
        txt(1340, 470, 480, 60, '• 要点文字', { fontSize: 28, color: PPT.text, align: 'left', fragment: true }),
        ...footer('机构名 / 课程名', '5'),
      ]
    },
  },
  {
    id: 'ppt-quote', name: '专业模板 · 引用页', cat: '引用',
    build() {
      return [
        txt(M, 140, 300, 180, '“', { fontSize: 200, fontWeight: 700, color: PPT.accent, align: 'left' }),
        shp(M, 380, 6, 300, PPT.accent),
        txt(M + 40, 380, 1500, 90, '这是一段引用文字，突出观点或金句。', { fontSize: 40, color: PPT.text, align: 'left' }),
        txt(M + 42, 500, 1500, 50, '—— 引用出处 / 作者', { fontSize: 28, color: PPT.light, align: 'left' }),
        ...footer('机构名 / 课程名', '6'),
      ]
    },
  },
  {
    id: 'ppt-end', name: '专业模板 · 结尾页', cat: '结尾',
    build() {
      return [
        shp(1740, M, 90, 60, PPT.accent),
        txt(M + 60, 380, 1500, 140, '谢谢！', { fontSize: 78, fontWeight: 700, fontFamily: PPT_FONT_TITLE, color: PPT.text, align: 'left' }),
        txt(M + 60, 540, 1500, 50, '联系方式 · 邮箱 · 机构名', { fontSize: 30, color: PPT.light, align: 'left' }),
        ...footer('机构名 / 课程名', '7'),
      ]
    },
  },
]

export function findProTemplate(id: string): ProTemplate | undefined {
  return proTemplates.find((t) => t.id === id)
}

/** 专业 PPT 整套（7 种母版各一页） */
export interface ProSlide { elements: SlideElement[]; bg: string }
export interface ProBundle { id: string; name: string; description: string; slides: ProSlide[] }

export const proBundles: ProBundle[] = [
  {
    id: 'ppt-bundle',
    name: '专业 PPT 模板（7 种版式）',
    description: 'Office 蓝 · 白底，封面/章节/列表/双栏/图/引用/结尾 各一页，可直接替换文案',
    slides: proTemplates.map((t) => ({ elements: t.build() as SlideElement[], bg: '#ffffff' })),
  },
]

export function findProBundle(id: string): ProBundle | undefined {
  return proBundles.find((b) => b.id === id)
}
