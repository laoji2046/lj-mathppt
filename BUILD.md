# RevealSlidr 桌面版打包说明（Tauri 2.0）

用 Tauri 2.0 打包。实测（2026-08-29）：`dist\` 108MB（含 GeoGebra 离线引擎 97MB + Reveal.js 5MB），
Tauri 会**压缩**嵌入资源，故产物远小于源码体积 —— 裸程序 35.6MB、NSIS 安装包 25.5MB。
Reveal.js 与 GeoGebra 均随包离线可用；Desmos / MathJax / Google Fonts 仍需联网。

## 目录结构
- `dist/`：前端（index.html / app.js / styles.css + geogebra/ 离线引擎）。
  > 修改根目录的 index.html / app.js / styles.css 后，需要重新复制到 dist/ 再打包：
  > `Copy-Item index.html,app.js,styles.css dist\ -Force`
- `src-tauri/`：Rust 工程（Cargo.toml、tauri.conf.json、src/、icons/、placeholder/）。
- `app-icon.png`：图标源文件，`npm run icon` 可重新生成整套图标。

## 运行架构（当前：asset:// 内嵌 + Tauri 原生命令）
前端由 Tauri 内嵌提供（`frontendDist = ../dist`），源码与图片全部打进 exe，安装目录不暴露松散源码。
导出/另存不再走 node 服务，而是 `src-tauri/src/lib.rs` 暴露的原生命令：
`app_dir` / `list_dir` / `export_json` / `capture_screen` / `restore_window`。

> 注：早期版本曾用 "内置 tiny_http 本地服务（v2 架构）"，该实现已移除，本文档按当前方案 A 描述。
> Windows 下 Tauri 2 的页面源为 `http://tauri.localhost`，fetch/XHR 可用，GeoGebra 的 GWT 模块能正常加载。

- 直接跑 `target\release\revealslidr.exe`（未安装）：使用项目根 `dist/`。
- 前端一律用相对路径引用本地引擎（`revealjs/...`、`geogebra/deployggb.js`、`geogebra/5.0/web3d/...`）。

## 本地引擎（2026-08-29 起随包分发）
| 目录 | 体积 | 内容 |
|---|---|---|
| `dist/revealjs/` | 4.9 MB | Reveal.js 核心 + 14 套主题 + markdown/notes/highlight/search/zoom 五插件 |
| `dist/geogebra/` | 97.3 MB | GeoGebra HTML5 离线引擎（web3d 41.3MB + web 40.4MB + webSimple 14.7MB） |

加载策略**本地优先、CDN 兜底**：`index.html` 的加载器与 `app.js` 的 `applyTheme` / `loadGgbAppletAPI`
都先取本地文件，仅当本地缺失或加载失败时才回退 CDN，因此断网也能正常编辑与演示。

## GeoGebra
- **离线引擎已内嵌**（`dist/geogebra/5.0/web3d/`），GeoGebra 小程序无需联网。
- 引擎检测：`app.js` 的 `ggbLocalEnginePresent()` 探测本地运行时，命中即 `setHTML5Codebase('geogebra/5.0/web3d/')`。
- 若要变轻量（依赖网络加载 geogebra.org），删除 `dist/geogebra/` 后重新打包即可，加载器会自动回退 CDN。

## 其他依赖网络的资源
Desmos、MathJax、Google Fonts（仅在使用对应功能时需要联网）。
Reveal.js 与 GeoGebra 已本地化，不再依赖网络。

## 前置
1. Rust：https://rustup.rs（cargo 需能在 PATH 中运行：`cargo --version`）
2. Visual Studio C++ 生成工具（含「使用 C++ 的桌面开发」）：https://visualstudio.microsoft.com/visual-cpp-build-tools/
3. Windows 若开启「智能应用控制」，cargo 会被拦截 → 需在 Windows 安全中心关闭。

## 安装依赖 + 打包
```powershell
cd <项目目录>
npm install
npm run build
```
输出：`src-tauri\target\release\bundle\nsis\LJ-PPT_1.0.0_x64-setup.exe`
（`target\release\revealslidr.exe` 是未打安装包的裸程序，可先跑它调试——此时用项目根 dist/。）

> 打包体积实测（2026-08-29）：`dist\` 约 108MB → 裸程序 **35.6MB**、NSIS 安装包 **25.5MB**。
> Tauri 会压缩嵌入资源，产物远小于 dist 原始体积。
> 若需回到轻量版（裸程序约 16MB，联网可用），删除 `dist\geogebra\` 与 `dist\revealjs\` 后重新打包，
> 加载器会自动回退 CDN，无需改代码。

> ⚠️ 构建环境：Git Bash 默认 PATH 里通常没有 `cargo`（它装在 `%USERPROFILE%\.cargo\bin`）。
> 打包前先 `export PATH="$HOME/.cargo/bin:$PATH"`，并用 `npm.cmd run build`（`npm` 亦可能不在 PATH）。
> 可用 `cargo --version` 验证是否生效。

> ⚠️ `src-tauri\target\release\dist\` 是构建缓存，由 `tauri build` 从根 `dist\` 自动刷新。
> 不要手动拷贝它去分发——可能带着旧版前端。

## 改完源码后
```powershell
Copy-Item index.html,app.js,styles.css dist\ -Force
# 同时更新 index.html 里的版本号 app.js?v=N / styles.css?v=N，避免浏览器缓存旧文件
```
