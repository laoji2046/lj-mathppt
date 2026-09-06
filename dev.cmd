@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动 LJ-MathSlides Vue 开发服务器...
echo 浏览器打开: http://127.0.0.1:5173
echo 按 Ctrl+C 停止
node node_modules\vite\bin\vite.js dev --host 127.0.0.1
