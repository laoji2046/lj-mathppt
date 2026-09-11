/**
 * 整套讲座模板已按用户要求清空 —— 不再包含任何数据。
 */
import type { SlideElement } from '@/types'

export interface MathBundle {
  id: string
  name: string
  description: string
  slides: { id?: string; bg?: string; elements: SlideElement[] }[]
}

export const mathBundles: MathBundle[] = []

export function findBundle(_id: string): MathBundle | undefined {
  return undefined
}
