// 让命令行工具直接用应用里的那一份算法（避免两处副本各自漂移）
import * as V from '../../src/composables/vectorize'
;(window as any).solidfit = { ...V, loadImage: V.loadImageElement }
