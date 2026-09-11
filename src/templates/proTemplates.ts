/**
 * 专业模板已按用户要求清空 —— 不再包含任何数据。
 */
import type { SlideElement } from '@/types'

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

export interface ProTemplate { id: string; name: string; cat: string; build(): SlideElement[] }
export const proTemplates: ProTemplate[] = []

export function findProTemplate(_id: string): ProTemplate | undefined {
  return undefined
}

export interface ProSlide { elements: SlideElement[]; bg: string }
export interface ProBundle { id: string; name: string; description: string; slides: ProSlide[] }
export const proBundles: ProBundle[] = []

export function findProBundle(_id: string): ProBundle | undefined {
  return undefined
}
