import { vectorizeImageData, type VectorizeOpt } from '@/composables/vectorize'

interface Request {
  id: number
  buffer: ArrayBuffer
  width: number
  height: number
  opt?: VectorizeOpt
}

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, buffer, width, height, opt } = event.data
  try {
    const result = vectorizeImageData(new Uint8ClampedArray(buffer), width, height, opt || {})
    self.postMessage({ id, result })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
