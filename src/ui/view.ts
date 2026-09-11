import { ref } from 'vue'
export type ViewMode = 'canvas' | 'split' | 'source'
export const viewMode = ref<ViewMode>('canvas')
export function setViewMode(m: ViewMode) { viewMode.value = m }
