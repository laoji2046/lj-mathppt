/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

// 第三方命令式库挂在 window 上，这里只做弱类型声明
interface Window {
  MathJax?: any
  GGBApplet?: any
}
