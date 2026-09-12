# solidfit —— 把一张线稿插图"量"成可编辑的数学图形

用途：试卷 / 讲义里的立体几何插图是位图，想变成能拖顶点、能改线型的图形元素，
就需要把每个顶点的归一化坐标量出来。人眼在放大图上读，误差常有十几像素；
这个工具让**顶点自动吸附到真正的线条交点**。

## 原理

1. 把原图二值化（亮度 < 150 视为墨迹），再把墨迹**膨胀 3px** 得到 "near" 掩码；
2. 给定一套候选拓扑（顶点初值 + 边表），沿每条边等距采样，统计采样点落在 near 掩码里的比例 = **覆盖率**；
3. 以覆盖率之和为目标做**逐顶点坐标下降**（轮次内步长 30→15→7→3→1 px，窗口 ±48px）；
   每条边带**最短边长约束**（初值的 50%），否则顶点会为了刷分塌到一起去；
4. 输出归一化坐标 + 每条边的覆盖率。**某条边覆盖率只有 0.5 左右 → 那条边根本不存在**，
   这是判断"多画了一条线"最快的办法（虚线本来就只有 ~0.93，实线 ~1.0）。

## 用法

```bash
# 1) 写一份 fitspec.json：每张图给原图路径 + 顶点初值(归一化) + 边表
#    初值不用准，±3% 都能收回来
npm run fit:html        # 生成 fit.html + figs.js（图片以 data URL 内联，不依赖本地服务）

# 2) 跑无头 Chrome，从 DOM 里把结果抠出来（页面把 JSON 写进 <pre id="out">）
"C:/Program Files/Google/Chrome/Application/chrome.exe" \
  --headless=new --disable-gpu --virtual-time-budget=120000 --dump-dom \
  file:///<abs>/tools/solidfit/fit.html | Select-String '"name"'
```

`overlay.cjs` 把量出来的结果**叠回原图**看贴合程度：

```bash
node node_modules/esbuild/bin/esbuild tools/solidfit/entry.ts \
  --bundle --format=cjs --outfile=tools/solidfit/_bundle.cjs --log-level=warning
node tools/solidfit/overlay.cjs spec.json out.html 1.0   # 再用 Chrome 截图
```

`spec.json` 的每条形如：

```json
{ "name": "image2", "img": "abs/path/image2.png", "w": 709, "h": 476, "kind": "pyramid",
  "points": [0.27,0.08, ...], "edges": [[0,1,1],[0,2,0]], "vlabels": ["P","A"] }
```

边是 `[起点, 终点, 是否虚线]`，下标对应 `points` 里的顶点序号。

> 吸附好的结果直接贴进 `src/templates/solidFigures.ts` 即可。