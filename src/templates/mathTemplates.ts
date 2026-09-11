/**
 * 模板库已按用户要求清空 —— 这里不再包含任何模板数据，
 * 仅保留类型与查找函数，避免引用处报错。
 */
import type { SlideElement } from '@/types'

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

export const mathTemplates: Template[] = []

export function findTemplate(_id: string): Template | undefined {
  return undefined
}
