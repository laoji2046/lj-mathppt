import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { APP_NAME, APP_VERSION } from './ui/appInfo'
import './styles/main.css'

// 标题里带版本号 —— 任务栏/浏览器标签页一眼能看出跑的是哪个构建
// （打包出来的 exe 和浏览器里的页面会各自停留在不同版本，没有这个很难分辨）
document.title = APP_NAME + ' v' + APP_VERSION + ' — 幻灯片编辑器'

createApp(App).use(createPinia()).mount('#app')
