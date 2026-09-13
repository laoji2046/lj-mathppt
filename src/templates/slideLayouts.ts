/**
 * 幻灯片版式库（对齐 PowerPoint「Office 主题」那一套）。
 *
 * 规矩：槽位一律用**比例**（0~1）定义，套用时按文稿实际尺寸换算 —— 换画布尺寸不用改这里。
 * 说明：PPT 的版式能"保留内容重排版"，本编辑器元素是绝对定位的 ✗，做不到；
 *      所以这里是**成套版式**（套用会替换该页内容），选择器里也写明了。
 * 另：PPT 还有「标题和竖排文字 / 竖排标题与文本」两套竖排版式，本编辑器的文字元素没有竖排能力，未收录。
 */

export interface LayoutSlot {
  kind: 'title' | 'subtitle' | 'text' | 'image'
  /** 均为 0~1 的比例 */
  x: number; y: number; w: number; h: number
  /** 占位文字（图片槽不用） */
  text?: string
  fontSize?: number
  fontWeight?: number
  align?: 'left' | 'center'
}

export interface SlideLayout {
  id: string
  label: string
  slots: LayoutSlot[]
}

const W = 0.84, X0 = 0.08

export const SLIDE_LAYOUTS: SlideLayout[] = [
  {
    id: 'titleSlide', label: '标题幻灯片',
    slots: [
      { kind: 'title', x: X0, y: 0.34, w: W, h: 0.16, text: '标题', fontSize: 64, fontWeight: 700, align: 'center' },
      { kind: 'subtitle', x: X0, y: 0.52, w: W, h: 0.10, text: '副标题', fontSize: 28, fontWeight: 400, align: 'center' },
    ],
  },
  {
    id: 'titleContent', label: '标题和内容',
    slots: [
      { kind: 'title', x: X0, y: 0.08, w: W, h: 0.14, text: '标题', fontSize: 44, fontWeight: 700, align: 'left' },
      { kind: 'text', x: X0, y: 0.28, w: W, h: 0.60, text: '正文内容', fontSize: 24, fontWeight: 400, align: 'left' },
    ],
  },
  {
    id: 'section', label: '节标题',
    slots: [
      { kind: 'title', x: X0, y: 0.36, w: W, h: 0.18, text: '节标题', fontSize: 56, fontWeight: 700, align: 'center' },
      { kind: 'text', x: X0, y: 0.56, w: W, h: 0.08, text: '本节内容', fontSize: 22, fontWeight: 400, align: 'center' },
    ],
  },
  {
    id: 'twoCol', label: '两栏内容',
    slots: [
      { kind: 'title', x: X0, y: 0.08, w: W, h: 0.14, text: '标题', fontSize: 44, fontWeight: 700, align: 'left' },
      { kind: 'text', x: X0, y: 0.28, w: 0.40, h: 0.60, text: '左栏内容', fontSize: 22, align: 'left' },
      { kind: 'text', x: 0.52, y: 0.28, w: 0.40, h: 0.60, text: '右栏内容', fontSize: 22, align: 'left' },
    ],
  },
  {
    id: 'compare', label: '比较',
    slots: [
      { kind: 'title', x: X0, y: 0.08, w: W, h: 0.12, text: '标题', fontSize: 40, fontWeight: 700, align: 'left' },
      { kind: 'subtitle', x: X0, y: 0.24, w: 0.40, h: 0.08, text: '方案 A', fontSize: 22, fontWeight: 600, align: 'left' },
      { kind: 'subtitle', x: 0.52, y: 0.24, w: 0.40, h: 0.08, text: '方案 B', fontSize: 22, fontWeight: 600, align: 'left' },
      { kind: 'text', x: X0, y: 0.34, w: 0.40, h: 0.54, text: '内容', fontSize: 20, align: 'left' },
      { kind: 'text', x: 0.52, y: 0.34, w: 0.40, h: 0.54, text: '内容', fontSize: 20, align: 'left' },
    ],
  },
  {
    id: 'titleOnly', label: '仅标题',
    slots: [
      { kind: 'title', x: X0, y: 0.08, w: W, h: 0.16, text: '标题', fontSize: 44, fontWeight: 700, align: 'left' },
    ],
  },
  { id: 'blank', label: '空白', slots: [] },
  {
    id: 'contentTitle', label: '内容与标题',
    slots: [
      { kind: 'text', x: X0, y: 0.10, w: W, h: 0.52, text: '内容', fontSize: 24, align: 'left' },
      { kind: 'title', x: X0, y: 0.70, w: W, h: 0.14, text: '标题', fontSize: 40, fontWeight: 700, align: 'left' },
    ],
  },
  {
    id: 'imageTitle', label: '图片与标题',
    slots: [
      { kind: 'title', x: X0, y: 0.06, w: W, h: 0.12, text: '标题', fontSize: 40, fontWeight: 700, align: 'left' },
      { kind: 'image', x: X0, y: 0.22, w: 0.46, h: 0.66 },
      { kind: 'text', x: 0.58, y: 0.22, w: 0.34, h: 0.66, text: '说明文字', fontSize: 20, align: 'left' },
    ],
  },
]

export function findSlideLayout(id: string): SlideLayout | undefined {
  return SLIDE_LAYOUTS.find((l) => l.id === id)
}
