import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Tauri 期望固定端口，避免 dev 时漂移
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    // 备份 / 构建产物 / 探针目录不触发文件监听，避免 EBUSY 或误刷新
    watch: { ignored: ['**/node_modules/**', '**/_backup/**', '**/dist/**', '**/.probe/**', '**/参考/**', '**/.*.tmpdir/**'] },
  },
  // Tauri 环境变量以 TAURI_ 为前缀，默认已含 VITE_，无需额外配置
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    outDir: 'dist',
    // Tauri 打包时资源走相对路径
    assetsDir: 'assets',
    // 不让 vite 清空 outDir：safe-delete 钩子拦截 trash 操作会导致构建失败。
    // 构建脚本（.probe/build.cjs）负责先把旧的 assets/index.html 挪走。
    emptyOutDir: false,
    // Tauri 使用较老的内核（WebView2），关闭现代浏览器专属语法
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    // 调试时关 minify 便于排查
    minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
})
