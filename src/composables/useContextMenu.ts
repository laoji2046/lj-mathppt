import { reactive } from 'vue'

export interface MenuItem {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}
interface MenuState { open: boolean; x: number; y: number; items: MenuItem[] }

// 模块级单例：SlideList / EditorCanvas 共用同一个右键菜单
const state = reactive<MenuState>({ open: false, x: 0, y: 0, items: [] })

export function useContextMenu() {
  function openMenu(x: number, y: number, items: MenuItem[]) {
    state.x = x
    state.y = y
    state.items = items
    state.open = true
  }
  function closeMenu() {
    state.open = false
    state.items = []
  }
  return { state, openMenu, closeMenu }
}
