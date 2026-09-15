/**
 * 开发用截图参数 `?shot=<面板>` —— 启动即把某个面板/弹窗打开 ✓。
 *
 * 为什么需要它 ✗：以前靠 CDP 脚本从外部「猜」DOM 来点开关 ✓，
 * 一天之内在同一个病根上栽了五次（猜类名 / 限死叶子 / 合成点击 / 按文字定位 / 只取第一个匹配 ✓）。
 * 有了这个参数 ✓，**每张截图就是一行命令** ✓，选择器一个都不用猜 ✓。
 *
 * 用法（只在 dev / 手动带参时生效 ✓，正常启动不带参即无影响 ✓）：
 *   http://127.0.0.1:5173/?shot=help
 *   http://127.0.0.1:5173/?shot=geom3d
 *   http://127.0.0.1:5173/?shot=ggb
 *   http://127.0.0.1:5173/?shot=template
 *   http://127.0.0.1:5173/?shot=layout
 *   http://127.0.0.1:5173/?shot=md
 *   http://127.0.0.1:5173/?shot=formula
 */
import { ref } from 'vue'

export const shotRequest = ref<string | null>(null)

export function initShotMode() {
  try {
    const v = new URLSearchParams(location.search).get('shot')
    if (v) shotRequest.value = v
  } catch { /* 取不到就算了 ✓ */ }
}