import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import AppIcon from './components/AppIcon.vue'
import { APP_NAME, APP_VERSION } from './ui/appInfo'
import './styles/main.css'
import './styles/anim.css'

// 标题里带版本号 —— 任务栏/浏览器标签页一眼能看出跑的是哪个构建
// （打包出来的 exe 和浏览器里的页面会各自停留在不同版本，没有这个很难分辨）
document.title = APP_NAME + ' v' + APP_VERSION + ' — 幻灯片编辑器'

const app = createApp(App).use(createPinia())
// AppIcon 注册成**全局组件**：它是到处都在用的基础图标，逐个文件 import 太容易漏 ——
// 漏了不报错、只是渲染成空白（放映模式的画笔/激光笔、模板库的关闭按钮变没就是这么来的 ✗）。
// 注册全局后这类坑从根上没了。
app.component('AppIcon', AppIcon)
app.mount('#app')
