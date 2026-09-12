# solidfit —— 把一张线稿插图"量"成可编辑的数学图形

用途：试卷 / 讲义里的立体几何插图是位图，想变成能拖顶点、能改线型的图形元素，
就需要把顶点坐标和边表量出来。人眼在放大图上读，误差常有十几像素，还要来回好几轮；
这套工具把它变成**自动矢量化**：一张图进去，顶点 + 边表 + 虚实线出来。

## 一条命令跑完（推荐）

```bash
# 1) 写 spec.json：[{ name, img, opts?: { crop:[x0,y0,x1,y1] } }]
#    crop 用来切掉图下方的「图 1」这类题注，不切的话边框会被当成一个方框收进来
node tools/solidfit/vectorize.cjs spec.json vectorize.html

# 2) 浏览器里跑（无头 Chrome），结果从 DOM 里取出来
"…/chrome.exe" --headless=new --disable-gpu --virtual-time-budget=180000 --dump-dom \
  file:///<abs>/tools/solidfit/vectorize.html > out.html
#    取 @@BEGIN@@ … @@END@@ 之间的 JSON，存成 vec.json

# 3) 叠回原图看贴合度 + 顶点序号（一眼读出哪个字母配哪个顶点）
node node_modules/esbuild/bin/esbuild tools/solidfit/entry.ts \
  --bundle --format=cjs --outfile=tools/solidfit/_bundle.cjs --log-level=warning
node tools/solidfit/annotate.cjs vec.json ann.html   # 再用 Chrome 截图看

# 4) 按顶点序号填字母，生成可直接粘进 solidFigures.ts 的 fig(...)
node tools/solidfit/tofig.cjs vec.json names.json
```

想跑 `compare.cjs` 自测（拿 `src/templates/solidFigures.ts` 当真值）时，先生成一份预设包：

```bash
node node_modules/esbuild/bin/esbuild tools/solidfit/entry2.ts \
  --bundle --format=cjs --outfile=tools/solidfit/_presets.cjs --log-level=warning
node tools/solidfit/compare.cjs vec.json
```

`names.json` 形如 `{ "image2": { "id":"pabcd", "name":"四棱锥 P-ABCD", "labels":["P","C","B","D","A",null] } }`，
字母按顶点序号给，`null` 表示那个顶点不用标（一般就是要去掉的多余顶点）。

## 自动矢量化怎么做的

1. **二值化**（亮度 < 150 为墨迹）；
2. **挑字母**：小连通域里，几个"共线且首尾相接"的细长块 = 一条虚线的短划，留下；
   其它小块 = 字母，抹掉（对角短划的"实心度"很低，不能拿它和字母区分，只能靠共线成组）；
3. **Zhang-Suen 细化**成 1px 骨架；
4. **骨架建图**：岔路判定用**交叉数**（8 邻域绕一圈 0→1 的次数），路径点恒为 2、端点 1、三岔 3。
   这里踩过大坑：一开始用"邻域分组数"，斜线的台阶点（W 与 S 互为 8 邻）会被算成 1 组，
   于是整条斜线每个台阶都是"岔路口"，一条直线被切成十几段；
5. **追路径 + Douglas-Peucker 简化** → 直线段；
6. **虚线合并**：两端悬空的短段按共线连成链，链 ≥ 2 段就是一条虚线（实测虚实判定 100% 对）；
7. **顶点归并**：吸附 → 合并近邻 → 收缩过短边 → 删孤立点 → 解消十字交叉（度为 4 且两两反向共线 = 穿过，不是顶点）；
8. **交点精修**：粗线在拐角处细化后骨架的"角"会往里缩一圈（实测偏 2%~3%，十几二十像素）。
   用交于该点的各条边的直线做最小二乘求交把顶点推回角上 —— 注意**边的方向必须取边上两个真实骨架点**，
   拿两个顶点算方向是白算的（那样的直线必然过当前顶点，解出来还是原位）；
9. 输出归一化顶点 + `[起点, 终点, 是否虚线]` + 被抹掉的字母位置（anchors）。

## 准到什么程度

拿 `solidFigures.ts` 里**人工量过并核对过的 8 套**当真值，用 `compare.cjs` 打分：

| 指标 | 结果 |
|---|---|
| 顶点召回（3.5% 容差内） | **89%** |
| 平均顶点误差 | **1.3%**（约 10px / 850px 的图） |
| 虚线 / 实线判定 | **100%** 对（8 图中 7 图全对） |
| 顶点准确率 | 60%（会多出一些落在直线上的冗余顶点） |
| 边召回 | 30%~67%（冗余顶点会把一条边拆成两段，几何上仍是对的） |

结论：**几何位置和虚实线基本可以直接用**，剩下的活是删掉几个冗余顶点、填字母 —— 
比纯手工量快一个数量级，但还不能完全无人值守。

## 手工精修（可选）

自动结果不满意时，`fit.cjs` 可以拿一份"顶点初值 + 边表"做逐顶点吸附迭代：

```bash
node tools/solidfit/fit.cjs fitspec.json fit.html   # 再用 --dump-dom 取结果
node tools/solidfit/overlay.cjs spec.json out.html 1.0   # 叠回原图核对
```

做法：把墨迹膨胀 3px 得到 near 掩码，沿每条边等距采样，以"覆盖率之和"为目标做坐标下降
（步长 30→15→7→3→1 px，带**最短边长约束**防止顶点塌到一起）。
每条边会报一个覆盖率：**只有 0.5 左右就说明那条边根本不存在**（实线 ~1.0、虚线 ~0.93），
这是判断"多画了一条线"最快的办法。

## 文件

| 文件 | 作用 |
|---|---|
| `vectorize.js` | 自动矢量化主流程（纯浏览器 JS，用 canvas 解 PNG，无依赖） |
| `vectorize.cjs` | 把图片内联成 imgs.js 并生成 vectorize.html |
| `annotate.cjs` | 结果叠原图 + 顶点序号标注 |
| `tofig.cjs` | 结果 → 可直接粘贴的 fig(...) 代码 |
| `compare.cjs` | 与 solidFigures.ts 的真值打分 |
| `fit.cjs` / `overlay.cjs` | 手工精修 / 叠加核对 |
| `debug.tpl.html` | 骨架 + 节点 + 路径可视化（排查用） |