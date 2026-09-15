/** 解锁功能（Addon）面板的开关 —— 提到共享 ref ✓ 便于 ?shot=addon 与其它入口直接调用 */
import { ref } from 'vue'
export const addonPanelOpen = ref(false)
export function openAddonPanel() { addonPanelOpen.value = true }
export function closeAddonPanel() { addonPanelOpen.value = false }