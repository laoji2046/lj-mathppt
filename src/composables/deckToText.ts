/**
 * 【v1671】把一份课件压成"给 AI 看的纯文本"（用户问：对话窗口不支持 ppt？）
 *
 * PPTX 的解析应用里**早就有了** —— 就是 @/pptx/pptxToDeck（「导入 PPT」那个功能用的正是它 ✓），
 * 这里只管把解析出来的 Deck 变成模型读得进去的文字：一页一段、标出页码、表格按行、图形给个说明 ✓。
 *
 * 为什么单独一个纯函数：只吃 Deck、不碰 DOM / Pinia → 探针能拿假 deck 直接断言 ✓
 * （真 PPTX 的解析要 DOM + zip，探针里跑不动 ✗；但"解析结果怎么变成文字"是纯逻辑，必须测得动 ✓）
 */
import type { Deck, SlideElement } from '@/types'

export interface DeckTextOpt {
  /** 最多多少字（超出截断并标注 ✓）；默认 20000 */
  maxChars?: number
  /** 开头要不要写"共 N 页"，默认写 ✓ */
  header?: boolean
}

const S = (v: unknown): string => (typeof v === 'string' ? v : '')

/** 一个元素 → 一行文字（认不出来的给个方括号说明，别静默丢掉 ✗） */
export function elementToText(el: SlideElement): string {
  const e = el as unknown as Record<string, unknown>
  const t = String(e.type || '')
  if (t === 'text' || t === 'richtex') return S(e.text).trim()
  if (t === 'math') return S(e.latex) || S(e.text)
  if (t === 'mathfig') return '[数学图形：' + (S(e.kind) || '未命名') + ']'
  if (t === 'image') return '[图片]'
  if (t === 'table') {
    const cells = e.cells
    if (Array.isArray(cells)) {
      const rows = cells.map((row) => (Array.isArray(row) ? row.map((c) => S(c).replace(/\s+/g, ' ').trim()).join(' | ') : S(row)))
      return '[表格]\n' + rows.join('\n')
    }
    return '[表格]'
  }
  if (t === 'chart') return '[图表]'
  if (t === 'code') return '[代码]'
  if (!t) return ''
  return '[' + t + ']'
}

/** 整份课件 → 纯文本 ✓ */
export function deckToPlainText(deck: Deck | null | undefined, opt: DeckTextOpt = {}): string {
  const slides = (deck && deck.slides) || []
  if (!slides.length) return ''
  const maxChars = opt.maxChars ?? 20000
  const out: string[] = []
  if (opt.header !== false) {
    const t = S((deck as unknown as Record<string, unknown>)?.title)
    out.push('（课件' + (t ? '「' + t + '」' : '') + '共 ' + slides.length + ' 页）')
  }
  slides.forEach((s, i) => {
    const parts: string[] = []
    for (const el of ((s && s.elements) || []) as SlideElement[]) {
      const line = elementToText(el)
      if (line) parts.push(line)
    }
    out.push('【第 ' + (i + 1) + ' 页】' + (parts.length ? '\n' + parts.join('\n') : '\n（这一页没有文字）'))
  })
  let text = out.join('\n\n')
  if (text.length > maxChars) text = text.slice(0, maxChars) + '\n…（内容太长，已截断）'
  return text
}
