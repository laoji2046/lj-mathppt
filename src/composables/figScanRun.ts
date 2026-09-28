/**
 * 【v1730】把图丢给 worker 矢量化（与「矢量识别」对话框同一套 ✓ 主线程不卡 ✓）
 *
 * 为什么单独一个文件：vectorize.ts 有 280KB，只在这里 import（而且只 import **类型** ✓）
 *   → GgbSuite 的 chunk 不会因为它变大 ✓ worker 自己去打包那一坨 ✓
 */
import type { VectorizeOpt, VectorizeResult } from '@/composables/vectorize'

let worker: Worker | null = null
let seq = 0

function getWorker(): Worker {
  if (!worker) worker = new Worker(new URL('../workers/vectorize.worker.ts', import.meta.url), { type: 'module' })
  return worker
}

/** 把一张已加载好的图交给 worker 识别 ✓（画布 / worker 起不来就 reject，由调用方兜底 ✓） */
export function vectorizeInWorker(img: HTMLImageElement, opt: VectorizeOpt = {}): Promise<VectorizeResult> {
  return new Promise((resolve, reject) => {
    try {
      const cv = document.createElement('canvas')
      cv.width = img.naturalWidth || img.width
      cv.height = img.naturalHeight || img.height
      if (!cv.width || !cv.height) { reject(new Error('图尺寸拿不到')); return }
      const ctx = cv.getContext('2d')
      if (!ctx) { reject(new Error('画布不可用')); return }
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(0, 0, cv.width, cv.height)
      const w = getWorker()
      const id = ++seq
      const onMsg = (e: MessageEvent) => {
        const d = (e.data || {}) as { id?: number; result?: VectorizeResult; error?: string }
        if (d.id !== id) return
        w.removeEventListener('message', onMsg)
        if (d.error) reject(new Error(d.error))
        else if (d.result) resolve(d.result)
        else reject(new Error('识别没返回结果'))
      }
      w.addEventListener('message', onMsg)
      w.postMessage({ id, buffer: data.data.buffer, width: cv.width, height: cv.height, opt }, [data.data.buffer])
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })
}
