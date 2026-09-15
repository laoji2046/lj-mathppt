# 工程注意事项（LJ-MathSlides）

> 给后续开发/协作的人（和 AI）看。每条都是**踩过坑之后定的**，不是偏好。
> 最后更新：v2026.09.1233

## 一、导出侧不要另写一份渲染实现 ★最重要

Reveal 导出（`src/reveal/renderer.ts`）、侧栏缩略图（`SlideThumb.vue`）、应用内演示
（`PresentationOverlay.vue`，iframe + `renderDeckToRevealHtml`）**共用同一条字符串渲染链**；
编辑器画布走 Vue 组件。**两边必须是同一份真相**，否则必然漂移，症状是"编辑器里好好的，
缩略图/演示/导出里空白或不对"。

**踩过的坑（v1229）**：renderer 里曾有手写的 `figureInner()`，只覆盖一部分图形 kind
（有 parabola/sine/cosine，**没有 linear** 等一大批），缺的 kind 渲染成**空 SVG** ——
用户报"数学图形在演示和缩略图里看不见"。

**现行做法**：renderer 的 mathfig 分支调 `renderFigureSvg(el)` —— 用 `createApp` + `h` 把
**真正的 `MathFigureElement` 组件**挂到离屏 div，读它的 `<svg>` 内联；失败才退回 `figureInner`。
**加新图形类型 / 改图形外观，不需要动 renderer。**

同类落点：
- 顶点圆点 `solid3d.vertexDotsSvg()` —— 画布 / 缩略图 / 导出 / 三维弹窗预览**四处共用一份**。
- PDF 文档插图用**屏幕外渲染真元素再抓 SVG**（`MathFigurePalette.grabByRealRender`），
  别拿图形库卡片的缩略图凑（卡片是预览版，viewBox 与线宽都不是真元素那套参数）。

## 二、动画

- 入场 10 种，导出映射到 **Reveal 内置 fragment 类**（`fade-up`/`fade-left`/`zoom-in`/`grow`/`shrink`），
  不自己写 JS 触发。方向语义按 Reveal 实际 transform 核过：`fade-up` = 从**下方**升起。
- 强调 7 种：监听 `Reveal.on('fragmentshown')`，读 `data-anim-em`，
  `去类 → void offsetWidth → 加回`（保证连点可重播）。
- 时长/延迟走 CSS 变量 `--anim-dur` / `--anim-delay`，编辑器与导出同一套。
- **硬规则**：
  1. 关键帧用**独立的 `translate`/`scale`/`rotate` 属性**，不要用 `transform` ——
     元素外层本来就有 `rotate(deg)`，用 transform 会覆盖掉元素自身旋转。
  2. 平移距离用**百分比**（相对元素自身）。曾写死 48px/14px，画布一缩放只剩一两厘米
     （用户："运动轨迹太短"）。飞入类按"从画面外进来"给：±130%。
  3. 预览里"入场→强调"的相位切换要按用户设的 `animDuration` 走，写死 620ms 会掐断长动画。

## 三、验证纪律

- **先量数，再改代码**。线宽问题改了三版，最后是把两份 SVG 的 viewBox / stroke-width / font-family
  打出来对比才定位（真元素 3.0 vs 卡片预览 2.6，**根本不是一套参数**）。
- **编译通过 ≠ 正确**：`fragIdx` 拼字符串漏一个 `+`，TS 把两行当成**函数调用**照样编译通过，
  导出时 `data-fragment-index` 根本不出现。
- **UI 验证要验"看得见、点得到"**，只验 DOM 里存在会漏掉一整类问题。
- **别给 deck 注入 localStorage 构造测试数据**：`normalizeDeck` 可能判为不合法静默回退
  （表现为"画布元素数为 0"）。**走界面操作**更可靠。
- 测试脚本别在字符串里写 `\n` 转义，已多次因此抛错误判；用 `querySelector` + 精确文本匹配。

## 四、发布流程

改 `package.json` → `node .probe/syncver.cjs`（同步 tauri.conf + README 抬头）→
`node .probe/patch-chXXXX.cjs`（插 changelog）→ `npm run build` → `node clean-dist.cjs` →
commit → tag `vYYYY.MM.DDNNNN` → `cargo build --release` → 拷到 `lj-mathslides-demo/lj-mathslides.exe` →
验证时间戳与版本 → 快照 `_backup/save-时间戳.zip`（定时，只留最近 10）+ `_backup/版本号.zip`（里程碑，长期留）。

## 五、容易忘的状态

- Vite watcher 的 `ignore` 里加了 zip/7z/rar、`lj-mathslides-demo/**`、`src-tauri/target/**`、
  `工具/`、`参考/` 等 —— 别再让大文件把 dev server 搞崩。
- dev server 用 `strictPort`：**启动前先确认 5173 上没有旧进程**，否则新实例直接退出、
  旧实例继续服务（会表现为"改了没生效"）。
- `AppIcon` 已注册为**全局组件**，Vue 模板里直接用，不用逐个 import。
- 数学图形顶点圆点：`showDots` 字段，**默认不画**（只有字母），勾上才是教材风小圆点。
- 自定义函数元素支持**多条曲线**，每条独立 `{ expr, color, dash, width, visible }`；
  旧存档只有单条 `expr`，渲染时自动回退兼容。
---

# PPT / 文档导入踩坑笔记（2026-09-15 一天攒出来的）

这天的代码量不大，但**踩的坑高度同质**。下面每条都是"改完才发现"的，写在这里是为了下次先想一下，而不是先撞一次。

## 一、几何值不可信 三连（同一类，各踩一次）

| 踩的地方 | 现象 | 真相 |
|---|---|---|
| 组合 grpSp 的 chExt | 算出 635 倍缩放，差点把整组炸飞 | 生成器写的 chExt 是废数；缩放必须夹到 0.2~5 倍 |
| 表格 graphicFrame 的 a:ext（宽） | 表宽 768px，实际列宽和 1207px | 该用 gridCol/@w 之和 |
| 同上（高） | 表高 288px，实际行高和 375px | 该用 a:tr/@h 之和 |
| p:graphicFrame 的位置 | 表格/公式全落 (0,0)，压在标题上 | 位移在 p:xfrm（直接子节点），不在 spPr 里 |

**规则一：能由子项累加得出的尺寸，不要信父节点的现成值。**

**规则二：读不到 和 读错地方 长得一模一样。** find(null) 静默返回 null，几何值就变成 0 而不是报错。
凡是几何/样式取值：先确认这个值真的在这儿；取不到时留信号（宁可报数，不要静默 0）。

## 二、位移的三种放法（少认一种就静默 0）

    p:sp / p:pic    ->  spPr/a:xfrm
    p:grpSp         ->  grpSpPr/a:xfrm
    p:graphicFrame  ->  p:xfrm        （直接子节点！最容易漏）

## 三、测量工具自己也会骗人（一天三次）

| 现象 | 真因 |
|---|---|
| PowerShell 查带底色的元素 = 0 | ConvertFrom-Json 的过滤写错；Node 一读是 4 个 |
| robocopy 只搬了几个中文目录 | /XD 用相对名会误伤；且退出码被管道吞了 |
| DOM.setFileInputFiles 后没反应 | CDP 设了文件但没派发 change 事件 |

**规则三：改了没反应 时，先怀疑测量方式。** 换一条独立的验证路径（PowerShell→Node、肉眼→数据、单点→逐页）再下结论。
robocopy / 管道类命令：$LASTEXITCODE 才是结论，不要用管道过滤掉它。

## 四、量错了指标 等于没量

给表格做完列宽/行高修复后跑完整性审计（只验文字在不在）→ 全绿；但位置全错（跑到 0,0）。指标选错，绿灯就是假的。

**规则四：每个修复都要配一个能证伪它的指标。** 内容丢没丢→指纹审计；位置飞没飞→几何检查；渲染对不对→逐页截图。
只看 没报错 会以为成功：MathJax 的 \color 那次就是"报错没了，公式却变成了源码"。

## 五、渲染/内容的所有权：一件事只能有一个主

| 位置 | 冲突双方 | 结果 |
|---|---|---|
| 表格单元格 | Vue 的插值 vs 命令式写 innerHTML | 内容偶尔回退成原文 |
| 同上（修完后） | v-html 的节点 vs MathJax 改写 | insertBefore on null 崩溃 |
| 图形渲染 | 真组件 vs 手写平行实现 | 缩略图/放映里图形空白 |

**规则五：同一件事只能有一份实现、一个主。** 修法固定：Vue 负责结构 → 排版只做"只排版不写内容" → 内容一变整表重建。
（宁可重建，不要往 MathJax 动过的树里 patch。）

## 六、用户文本进 innerHTML 前必须转义

$0<a<1$ 里的 < 会被当标签开头，整段烂掉。normalizeMixed 刻意不转义（要塞 SVG），
所以必须在塞文本的调用点转义；顺序是 先转义 → 再插图形（反了会把 SVG 一起转义）。

## 七、导入质量的三层检查

| 层 | 位置 | 查什么 | 现状 |
|---|---|---|---|
| 运行时自检 | pptxToDeck 的 geomSuspect | 位置/尺寸异常、越界 | 样张 1/138 待查 |
| 离线·内容 | .probe/audit.ts | 原文文字 vs 导入结果（指纹比对） | 124 框 / 0 丢失 |
| 离线·位置 | .probe/sanity.ts | 元素是否落在画布附近 | 138 / 1 越界 |

以后有人问"是不是没导进来"，跑一遍就有答案，不用靠肉眼比。

## 八、PPT 结构的两个事实（能省很多猜）

1. 公式来源两条：mc:Choice 里的 p:sp（带原生 m:oMath，能读）；p:oleObj（只有 WMF 预览，读不到）。
   样张 98 个 AlternateContent 里 24 个能读、74 个不能。读不到的必须报数（导入提示里已实现），不要留暗洞。
2. 表格常是"空网格 + 浮在上面的文字/公式"，不是单元格里有内容。
   要按单元格矩形中心点吸附（行高必须用真实的 tr/@h，均分会吸错格）；吸完元素数 138 → 123。

## 九、早返回会吃掉整棵子树

graphicFrame 分支"发现不是表格就 return"，导致藏在里面的 OLE 统计一直是 0。
凡是"这个节点我处理不了"的地方，都要问一句：里面还有没有别人要的东西？
