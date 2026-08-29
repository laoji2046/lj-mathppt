# LJ-PPT 项目进展速记

> 用途：帮下次会话快速接续。最后更新：2026-08-28 晚。

## 当前状态
- 代码 3 件套均已同步到 `dist\`：`app.js` / `styles.css` / `index.html`
- 同步到 dist 后，用 `node server.js 8765` 起服务，浏览器打开 `http://127.0.0.1:8765` 验证（headless Chrome `--dump-dom` / `--screenshot` 做诊断）
- 打包命令：`tauri build`（产物 `src-tauri\target\release\bundle\nsis\LJ-PPT_1.0.0_x64-setup.exe`，最新 2026-08-28 23:16）

## 已验证 OK 的关键改动（本轮会话）
### 演示批注
- 演示控制条加「画笔批注」「清除批注」；批注工具组：画笔/激光笔、红橙绿蓝 4 色、细/中/粗 3 档。
- 激光笔画了约 800ms 自动消失；翻页自动清除；编辑器里保留。
- 关键修复：`#present-annot` 初始带 `hidden`，`toggleAnnot` 开启时需移除 `hidden` 否则画不了；canvas 尺寸用 `window.innerWidth/Height`（不用 reveal.getBoundingClientRect）；z-index 层级（canvas 200 > Reveal 内容，控制条 300）。

### 画布缩放/平移
- `#stage-transform` 包住 `#reveal`；`StageZoom`：Ctrl+滚轮缩放（鼠标锚点）、Alt/Ctrl/中键拖动平移、缩放控制条（−/%/+/适应/重置）。
- `boot` 里 `StageZoom.bind()`。

### 文字精确控制
- 文本面板加「字重」下拉 `#el-font-weight`（300~900）；updateProps 读取、updateFromProps 写入 `textEl.style.fontWeight`。

### 工具栏
- `#toolbar` flex-wrap 两行智能分行（按 `.toolbar-group` 整体换行，不拆散），`.toolbar-divider` 竖线分组；「设置」固定右上角（`#toolbar > .toolbar-group:last-child` absolute + 右侧 padding）。

### 公式功能（重点，多轮打磨）
- 公式弹窗 `#math-modal`：
  - 单击预制公式 → **追加**（用 `,` 连接）到输入框，累积成一个连贯公式；`confirmMath` 插入时作为**一个公式**渲染。
  - 双击预制公式 → 直接插入该单个公式（`confirmMath(true)` 保持弹窗打开可连续双击）。
  - 手动输入：`;`/`；`/换行 分段 → 插入多个（一行内 `;` 分隔 → 横向并排；换行 → 垂直下移）。
  - `confirmMath(keepOpen)`：keepOpen=true 不关闭弹窗、保留输入内容。
  - 添加了「没有当前页则不插入」守卫，避免"提示已插入但没插入"。
- **公式元素随框缩放**（已解决）：MathJax 渲染的是固定尺寸 SVG，改 font-size 无效，须用 `transform: scale(f)`。`fitMathElement(el)` 测量 `.el-math` 内 `mjx-container` 的 offsetWidth/Height 算 `f = min(boxW/cw, boxH/ch)`，设 `m.style.transform='scale(f)'`（transform-origin center）。在 resize 的 onMove（实时）+ onUp 调用；`applyAllMathFit` 在渲染/翻页/演示/resize 时调用。去掉 f≈1 提前返回。
- `.el-math` 字号：四号字 18px，行内 data-math-inline 16px，`mjx-container 0.94em`。

### MathJax 宏递归修复（重要）
- `index.html` 的 `window.MathJax.tex.macros` 曾有多条"定义成自身"的递归宏导致 `\perp`/`\sqrt` 等报 "maximum macro substitution count exceeded"。
- 已删掉 self-ref 宏，只保留真实别名：`R/N/Z/Q/C/E`(→`\mathbb{…}`)、`var`/`cv`。
- `tex` 配置：`inlineMath: [['\\(','\\)'],['$','$']]`、`displayMath: [['$$','$$'],['\\[','\\]']]`、`processEscapes: true`。

### GeoGebra 套件
- 默认 `classic`（全功能经典套件）；下拉 `classic` 放第一位。
- 选项（工具栏/菜单/代数区/缩放）改变 → `reloadKeepContent()`（先 getBase64 保存作图，重建后 setBase64 恢复），使重勾选立即生效且不丢内容。
- 插入 applet 坐标视图与套件一致：`currentViewRange()` 用 `getViewProperties()`（xMin/yMin/width/height/invXscale）换算绝对范围；`confirmGeogebra` file 分支写 `data-ggb-view`；`renderGgbLocal` 用 `setCoordSystem(xmin,xmax,ymin,ymax)` 恢复 + `setScaleContainer(false)`（fixedView，避免不同宿主尺寸 auto-fit 漂移）。
- 演示态隐藏撤销/重做按钮（`.present-reveal .ggb-host .undoRedoPanel` display:none）；重置按钮做成可选项（`data-ggb-reseticon`）。

### 例题模板
- `math-example`（高中数学讲义典型例题）改用**独立公式块元素**（`mhFormula` → `data-type="math"`），文字区纯文字；配图用 `mhImage`（真图片，双击替换）。新增 `mhImage` helper。避免内联 `$...$` 渲染问题。

### 网页嵌入
- `web-embed-demo.html` 多页导航版本（根+dist 各一份）；`iframe-applet` 模板默认 embedSrc。

## 待办 / 可继续方向
- 若有其它要加的功能直接提。
- 公式随框缩放若在打包 exe 里还有问题（CDN/MathJax 加载）需真机确认。

## 约定提醒
- 编辑 `.js/.css/.html` 后记得 `Copy-Item 到 dist\`，再刷新 `http://127.0.0.1:8765` 验证。
- 不会跑 `npm run build`/`tauri build` 除非用户说"打包"。
- `window.__rsTest` 暴露了 `Elements/Toolbar/MathLecture/GgbSuite/PresentControls/StageZoom/renderMath/restoreMathSource/project` 等，便于探针诊断。
