import { ref } from 'vue'
import { requireAddon } from '@/addons/registry'

/** 图片转图形弹窗：把图片里的线稿识别成可编辑的数学图形元素。
 *
 *  三种进入方式（互斥）：
 *   - 只有 src：全新识别，结果只能"插入当前页"（面板里的「＋ 自图片重建…」）
 *   - src + replaceId：从图片元素进来，结果可以"插入为新图形"或"替换这张图片"
 *   - editId：从已转好的图形元素回来**继续编辑**（src 由调用方从元素的 vectorizeCtx 里取）
 */
export const vectorizeOpen = ref(false)
export const vectorizeSrc = ref('')
export const vectorizeReplaceId = ref<string | null>(null)
/** 要"继续编辑"的图形元素 id（此时不跑识别，直接把元素里已有的顶点/边/字母还原进弹窗） */
export const vectorizeEditId = ref<string | null>(null)

export function openVectorize(src: string, replaceId: string | null = null, editId: string | null = null) {
  if (!requireAddon('vectorize')) return
  vectorizeSrc.value = src
  vectorizeReplaceId.value = replaceId
  vectorizeEditId.value = editId
  vectorizeOpen.value = true
}

export function closeVectorize() {
  vectorizeOpen.value = false
  vectorizeSrc.value = ''
  vectorizeReplaceId.value = null
  vectorizeEditId.value = null
}
/**
 * **矢量描摹接收口** —— 让「试卷 / 讲义」也能用描摹结果。
 *
 * 与 geom3dSink 同一套模式：谁要接收就先登记一个回调，
 * 对话框插入时**优先走接收口**，没人登记才走原来的「插入当前页 / 替换图片」。
 *
 * ⚠ 传的是 **PNG 的 dataURL** ✗（不是 mathfig 元素 ✓）—— 因为试卷只认 [图N] 图片 ✓。
 */
export const vectorizeSink = ref<null | ((png: string, label: string) => void)>(null)
