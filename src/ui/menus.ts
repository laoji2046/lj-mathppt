/**
 * 与 ?shot= 联动的下拉菜单开合状态 ✓。
 *
 * 为什么提到这里 ✗：这些菜单原来都是 TopToolbar 的局部 ref ✓ ——
 * 截图时要模拟点击才能打开（而点击定位正是我一天栽五次的地方 ✗）。
 * 提到共享后，**URL 参数直接就能把菜单打开** ✓，一个选择器都不用猜 ✓。
 *
 * ⚠ 约束：本文件只放 ref ✓，不放任何逻辑 ✓ —— 免得把工具栏的行为搬走 ✗。
 */
import { ref } from 'vue'

/** 「图片 ▾」菜单 */
export const imgMenuOpen = ref(false)
/** 「Desmos ▾」菜单 */
export const dsmMenuOpen = ref(false)
/** 「GeoGebra ▾」菜单 */
export const ggbMenuOpen = ref(false)
/** 「嵌入 ▾」菜单 */
export const embedMenuOpen = ref(false)