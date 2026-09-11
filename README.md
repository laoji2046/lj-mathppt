# LJ-MathSlides（Vue 版骨架）

与根目录的原版应用**并行开发**，互不干扰。这一步的目标是把架构从「DOM 即模型」
换成「场景图驱动」，并验证它在 Vue 3 + TypeScript 下跑得通。

> **当前版本：2026.09.1101**（源码快照 `_backup/rollback-20260911-*`；dev 端口 `http://127.0.0.1:5173`；演示 exe 在 `lj-mathslides-demo/lj-mathslides.exe`）
>
> 本版要点：公式与混排「只缩小不放大」（大小由字号决定）· 高中数学例题 8 套模板全部改用混排公式 · 「另存为…」可自选目录 · Markdown 的 `$$` 少一个 `$` 不再丢公式、不再跳页。
>
> 1102 补丁：画布右侧/底部 ＋ 恢复为「打开模板库」（可选模板或空白页）· 演示中画笔与激光笔互斥 · 修复演示底部控制条被激光笔/备注"锁死唤不回"（显隐改为同时监听 iframe 与宿主 window，悬停自家 UI 不隐藏）。

## 核心设计：与原版的三个关键区别

| | 原版 | Vue 版 |
|---|---|---|
| 数据模型 | 幻灯片内容是 **HTML 字符串** | **结构化场景图**（`Slide.elements: SlideElement[]`） |
| 编辑器画布 | Reveal.js 同时负责编辑与演示 | Vue 自己渲染画布，Reveal 只用于**演示/导出** |
| 元素操作 | `querySelectorAll` + 直接改 DOM | 响应式状态 + 拖拽时绕过响应式直写 DOM |

第三条是解决「虚拟 DOM 与 Reveal 争夺节点」的关键：**两者不共享 DOM**。

## 目录结构

```
src/
├── types/index.ts          场景图类型 + 元素工厂
├── stores/deck.ts          Pinia：slides / 选中 / 增删 / 快照式撤销重做 / 自动保存
├── composables/
│   ├── useStageScale.ts    固定 1920×1080 舞台整体缩放（留边，绝不重排）
│   ├── useDragResize.ts    拖拽与八向缩放：move 时直写 DOM，up 时提交 store
│   ├── useMathJax.ts       MathJax 3（SVG）按需加载 + 排版缩放
│   ├── useSnap.ts          吸附计算（元素边/中线 + 页面中心/边缘）
│   └── useGeoGebra.ts      GeoGebra 按需加载 + 注入 / 销毁
├── components/
│   ├── EditorCanvas.vue    画布：拖拽调度、框选、平移、吸附参考线
│   ├── ElementFrame.vue    元素外壳：选中框 + 8 个缩放把手
│   ├── EditToolbar.vue     组合 / 对齐 / 分布 / 图层
│   ├── SlideList.vue       页面缩略图
│   ├── PropertyPanel.vue   属性面板（未选 / 单选 / 多选三态）
│   ├── TopToolbar.vue      顶部工具栏
│   └── elements/           Text / Shape / Image / Math / GeoGebra 渲染器
├── reveal/renderer.ts      场景图 → Reveal.js 演示页
└── App.vue                 布局 + 键盘快捷键
```

## 运行

```bash
cd vue-app
node node_modules/vite/bin/vite.js          # 开发（默认 http://localhost:5173）
node node_modules/vue-tsc/bin/vue-tsc.js --noEmit   # 类型检查
node node_modules/vite/bin/vite.js build    # 构建到 dist/
```

> ⚠️ 本机 `npm install` 会被沙箱的 safe-delete 钩子拖死（npm 的大量文件操作被拦截），
> 因此 `.bin` 软链可能缺失。直接调用上面的入口 JS 即可，功能不受影响。
> 若在正常环境下开发，`npm install && npm run dev` 即可。

## 已实现

**基础**
- 场景图数据模型（text / shape / image / math / geogebra）
- 固定 16:9 舞台（1920×1080）整体缩放
- 属性面板（未选 / 单选 / 多选三态）

**文字元素属性**
字体（9 种中文友好预设）/ 字号 / 字重 / 颜色 / **背景色**（可一键清除）/ **阴影**（4 档）/
对齐 / **旋转**（通用）/ **图层 index**（通用，0 为底层）
- 字体与阴影用 key + 预设表（`FONT_OPTIONS` / `SHADOW_OPTIONS`），
  编辑器与导出共用同一份映射，两端渲染一致
- 有背景色时自动加内边距与圆角，跨行时各片段单独上色（`box-decoration-break: clone`）
- 旧存档打开时自动补上新字段的默认值
- 快照式撤销重做、localStorage 自动保存
- 演示模式：场景图生成 Reveal.js 页面并在新窗口打开

**编辑功能**
- 元素选中、拖拽移动、八向缩放
- **多选**：Ctrl 加选、Ctrl+A 全选、空白处拖动框选
- **组合 / 解组**（Ctrl+G / Ctrl+Shift+G）：点任一成员选中整组，对齐与分布以整组为单位
- **对齐**：左 / 水平居中 / 右 / 顶 / 垂直居中 / 底（单个元素时相对整页）
- **分布**：水平 / 垂直等距（至少 3 个；元素重叠时退化为零间距排开）
- **图层**：置顶 / 上移 / 下移 / 置底
- **吸附**：拖到其它元素边缘、中线或页面中心/边缘 6px 内自动吸附并显示红色参考线
- **画布平移**：空格拖动或中键拖动，HUD 有「复位」按钮

**公式（MathJax 3）**
- 本地 `public/mathjax/tex-svg.js`（约 2MB，离线可用，首次按需加载）
- 用 SVG 输出而非 CHTML：字形以路径内嵌，不需要额外字体文件
- 渲染后按元素框**等比缩放**（MathJax 产出固定尺寸 SVG，改 font-size 无效）；
  缩放上限 1（**只缩小、不放大**）：公式大小由「字号」决定，元素框变大不再把公式撑大，
  避免宽框里的短公式被放大到与正文（26~32px）严重不成比例
- 内置 `\R \N \Z \Q \C \E` 等实数集宏
- 属性面板可直接改 LaTeX；输入与尺寸变化都有防抖，不会每帧重排

**GeoGebra**
- **离线引擎已内嵌**：`public/geogebra/5.0/`（约 97MB，随应用打包），编辑器与演示页都不依赖 CDN
- **打开本地 .ggb**：工具栏「📂 打开 .ggb」一步选文件 → 创建元素并自动加载（base64 内嵌场景图）
- 5 种套件：经典 / 函数绘图 / 几何 / 3D / CAS
- **显示选项**：工具栏 / 代数输入 / 菜单栏 / 重置按钮 / Shift 缩放 / **坐标轴** / **网格**
  （编辑器与演示页一致生效；改动自动重载小程序；旧存档自动补默认值）
- 工具栏 / 代数输入 / 菜单栏 / 重置按钮 / Shift 缩放 均可开关

**演示模式**
- **应用内全屏覆盖层 + iframe**（不再 `window.open`——Tauri 不允许任意新开窗口）
- 演示页资源全部本地化（revealjs / mathjax / geogebra 均从应用 origin 加载，离线可用）
- 资源用 `location.origin` 绝对路径 —— **blob URL 无法解析相对路径**（不是层级 URL）
- Reveal ready / MathJax / GeoGebra 三方加载时序不同步：全部改为**轮询重试**，
  避免「ready 只触发一次而引擎尚未加载完」的竞态
- iframe 内按 ESC 用 `postMessage` 通知宿主退出（跨文档按键不冒泡）

### 第三方命令式库与 Vue 共存的三条经验

1. **宿主元素不能被 `v-if` 条件卸载** —— 一旦卸载，ref 变 null，
   而 Vue 的 DOM 更新是异步的，后续重渲染读到的仍是 null，再也恢复不了。
   错误提示要浮在宿主之上，而不是替换它。
2. **等宿主有实际尺寸再注入** —— GeoGebra 在 0×0 容器里会渲染成空白。
3. **尺寸变化不要重新注入** —— 会丢失作图内容；交给库自己的缩放机制处理。

## 快捷键

| 按键 | 功能 |
|---|---|
| `Ctrl+Z` / `Ctrl+Shift+Z` | 撤销 / 重做 |
| `Ctrl+Y` | 重做 |
| `Ctrl+A` | 全选当前页元素 |
| `Ctrl+G` / `Ctrl+Shift+G` | 组合 / 解组 |
| `Ctrl+点击` | 加选 / 反选 |
| `Delete` / `Backspace` | 删除选中 |
| `Esc` | 取消选择 |
| `空格 + 拖动` | 平移画布 |

## 桌面端（Tauri 2）

```bash
# 1. 构建前端（dist/）
node node_modules/vite/bin/vite.js build

# 2. 编译 + 打包（需要 Rust 工具链；本机 cargo 在 ~/.cargo/bin，需先加进 PATH）
export PATH="/c/Users/老冀/.cargo/bin:$PATH"
cd src-tauri && cargo build --release      # 编译 Rust 后端
node ../node_modules/@tauri-apps/cli/tauri.js build   # 生成 NSIS 安装包
```

产物：
- `src-tauri/target/release/lj-mathslides.exe`（裸程序，可单独拷贝运行）
- `src-tauri/target/release/bundle/nsis/LJ-MathSlides_0.1.0_x64-setup.exe`（安装版）

后端提供三个 Tauri 原生命令（`window.__TAURI__.core.invoke`）：
`app_dir` / `list_dir` / `export_json`（base64 写盘，防路径穿越，含 4 个单元测试）。
前端目前用 localStorage 自动保存；将来做「导出 / 另存为」时走这套命令，
浏览器环境下自动回退 `showSaveFilePicker`。

> ⚠️ 本机 `tauri build` 前务必先手动清空 `dist/`（safe-delete 钩子会拦 vite 的清理），
> 且 `revealslidr.exe`（原应用进程）未退出会锁文件导致编译失败。

**新元素（原版 lj-ppt 借鉴，GeoGebra / Desmos 之外）**
- 直线 / 箭头 / 笔（画布空白处拖拽绘制，`Esc` 取消，SVG 矢量、缩放不变粗）
- 数学符号面板（60 个 ∈ ∅ ∪ ∩ √ ∞ ∑ ① ½ 等，点击插为文本元素）
- 数学图形（抛物线、正弦、余弦、指数、对数、坐标系、数轴、Venn 图、直角三角形、角、半圆）
- 图表（柱状 / 折线 / 饼图，属性面板直接编辑标签与数值）
- 表格（行列增删、单元格编辑、表头/边框/字号可调）
- 图标（图标库面板，emoji / 符号，离线可用）
- 在线嵌入（URL / PDF iframe）
- 在线图片库（14 分类 + 关键词搜索 + 随机，插为图片元素）

**版面与整体**
- 主题：一键切换整套配色（背景/强调/文字），应用于全部页面
- 动画版模板（fragment 渐显）：例题 / 推导 / 小结等分类，演示时逐条出现
- 幻灯片管理增强：拖拽排序、复制页、上移 / 下移、`Ctrl+Shift+N` 新建
- 版本历史：保存快照 / 恢复 / 删除（localStorage 独立存储，最多 20 个）

## 尚未实现（后续增量）

- 组合内单独编辑（目前以整组为单位）
- 导出 PDF / PNG（HTML 导出已实现，PDF/PNG 待接 `export_json` 命令）
- 演示批注、设置面板（标题/画布尺寸/导航模式等）

## 验证状态

- `vue-tsc --noEmit` **零错误**
- `vite build` 成功（69 模块，约 116 KB JS / gzip 44 KB）
- 无头浏览器功能实测（全部通过）：
  - 基础：添加元素、拖拽移动、撤销、新增页面、舞台缩放
  - 编辑：Ctrl 加选、组合后整组选中、解组、Ctrl+A、
    水平分布、左对齐、图层置底、框选
  - 吸附：拖到差 4px 处自动吸附重合，拖拽中出现 3 条参考线、松手后消失
  - 平移：translate 由 (0,0) 变为 (120,60)，复位归零
  - 公式：MathJax 渲染出 mjx-container + SVG，等比缩放生效；
    改 LaTeX 后正确重排（二次求根公式 → ∫₀¹x²dx = 1/3）
  - GeoGebra：小程序成功注入（canvas + applet_scaler），属性面板正确切换
