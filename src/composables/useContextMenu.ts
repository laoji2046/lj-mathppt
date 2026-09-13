import { reactive } from 'vue'

export interface MenuItem {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  /** 分隔线（此时 label / onClick 忽略） */
  sep?: boolean
  /** 右侧灰色提示（PPT 那种快捷键/说明文字） */
  hint?: string
  /** 子菜单（鼠标悬停展开，用于「版式」这类二级项） */
  children?: MenuItem[]
  /** 鼠标悬停到该项时触发（参数是该项的 DOM，便于把浮层贴在它旁边）——
   *  用来做"鼠标一落在「版式…」上就把版式库弹出来" */
  hover?: (el: HTMLElement) => void
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
