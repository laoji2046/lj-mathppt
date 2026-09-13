# solidfit —— 把一张线稿插图"量"成可编辑的数学图形

> 算法只有一份：`src/composables/vectorize.ts`。这个目录先把应用里的算法切成两部分：CLI 工具和应用**共用同一份**，
> `vectorize.cjs` 会用 esbuild 把 `src/composables/vectorize.ts` 打成 `_vec.js` 给页面用，不会再各存一份副本。
> 应用内的入口：「数学图形 → 复刻图形 → ＋ 从图片复刻…」，或选中图片元素后的属性面板「✎ 转成矢量图形」。

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
| 顶点召回（3.5% 容差内） | **93%** |
| 平均顶点误差 | **1.4%**（约 10px / 850px 的图） |
| 顶点准确率 | **72%**（多出来的多是冗余顶点） |
| 虚线 / 实线判定 | 配上 61 条边，**58 条判对** |
| 边召回 | 30%~77%（冗余顶点会把一条边拆成两段，几何上仍是对的） |

另外两个诊断脚本（都拿 8 套真值打分）：

```bash
node tools/solidfit/vertcheck.cjs v18.json      # 多出来的顶点按拓扑分类：悬空 / 共线 / 拐点 / 三度交点
node tools/solidfit/dashcheck.cjs 改前 v10.json 改后 v18.json   # 虚实判定的绝对条数（比百分比可靠）
```

结论：**几何位置和虚实线基本可以直接用**，剩下的活是删掉几个冗余顶点、填字母 —— 
比纯手工量快一个数量级，但还不能完全无人值守。

**冗余顶点的主要来源是虚线**（v1137 修）：虚线链的两端只有 14px 吸附半径，吸不上就新建顶点，
于是一条虚线变成"一条悬空长线 + 两个多余点"。现在虚线链单独用 60px 半径 + 18px 垂距约束。

**短划被当字母抹掉**（v1139 修）：stripText 里"≥3 个共线短块才算虚线、否则当字母碎片抹掉"，
配合 4px 的垂距门槛和 0.985 的方向门槛，会把同一条虚线上的短划拆散、凑不够数 → **整条边消失**。
三处一起放宽（垂距 ≤7、成组 ≥2、方向 ≥0.97）后，8 套真值上的多余顶点 34→18、准确率 62%→76%、召回 92%→95%。

## 已知问题：近乎竖直的细虚线仍可能整条丢

用户原图 `_docx-out/images/_user-real.png`（472×360，A/B/C/D/E/F 那张）到现在仍然会把
**D–E、F–C 两条近竖直虚线整条丢掉**（识别成 8 顶点 / 11 边 / 6 虚线，缺这两条）。

在 `vectorizeFromInk` 里临时打印过链路阶段的边表，分工很明确：

- **F–C 的短划被拆成几段独立的 ~15px 小边**（`[172,108]-[170,123]`、`[168,143]-[165,158]` …），彼此没连成一条；
- **D–E 的十几段短划（4×7px、间隔 12px）根本没进边表** —— 在更前面的骨架 / 取路径阶段就没了；
- 同一张图里**水平**的 E–B（短划 7×3）和**对角**的 D–C（短划 5×6）都正常成链。

⇒ 剩下的毛病看起来和短划的**方向 / 长宽比**有关（竖着的比横着的差）。排查入口：
`stripText → thin → buildGraph → paths 过滤（freeA || 两端有锚点 || plen > spur） → rdp 切段` 这条链路上先插桩。

复现：`node tools/solidfit/vectorize.cjs <spec.json> out.html`，spec 里 img 指向 `_user-real.png`。

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
| `vec-entry.ts` | 把应用里的算法挂到 window（工具与应用共用同一份实现） |
| `vectorize.cjs` | 把图片内联成 imgs.js 并生成 vectorize.html |
| `annotate.cjs` | 结果叠原图 + 顶点序号标注 |
| `tofig.cjs` | 结果 → 可直接粘贴的 fig(...) 代码 |
| `compare.cjs` | 与 solidFigures.ts 的真值打分（顶点 / 边） |
| `ocrcheck.cjs` | 字母识别准确率（同样是拿真值打分） |
| `fit.cjs` / `overlay.cjs` | 手工精修 / 叠加核对 |
| `debug.tpl.html` | 骨架 + 节点 + 路径可视化（排查用） |