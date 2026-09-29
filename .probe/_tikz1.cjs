/**
 * _tikz1.cjs —— TikZ → 应用图形 的验收探针（v1652）
 *
 * 用法：
 *   node D:\vue-app\.probe\_tikz1.cjs                  （打 D:\vue-app 的源码）
 *   LJ_ROOT=<其它源码根> node …                         （开发时打暂存副本）
 * 产物：<会话工作区>/.probe/shots/_tikz1.html（再截图人工核对）
 *
 * 三条口径：
 *   ① 解析结果对不对（kind / a、b、p / 点 / 线 / 文字）—— 断言；
 *   ② 应用**真渲染**（mathPlot.conicFigure，与 MathFigureElement 同一个函数）画出来的图上，
 *      曲线是否**逐个穿过 TikZ 自己的采样点** —— 数值断言 + 图上叠红点肉眼核对；
 *   ③ 认不出的写法必须**退回占位**，不许瞎猜。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = process.env.LJ_ROOT || "D:/vue-app";
const OUT = process.env.LJ_OUT || "C:/Users/老冀/Desktop/vue-app/.probe/shots";
fs.mkdirSync(OUT, { recursive: true });
/** 默认走 esbuild 打包（与 _thmshot / _vennshot 同一套）；
 *  LJ_TS=1 时直接用 node 自己的类型剥离 require 源文件（开发时省一次子进程，产物完全一样） */
const load = (entry, outfile) => {
  if (process.env.LJ_TS) return require(path.join(ROOT, "src", "composables", entry));
  const esbuild = require("D:/vue-app/node_modules/esbuild");
  esbuild.buildSync({ entryPoints: [path.join(ROOT, "src", "composables", entry)], bundle: true, format: "cjs", platform: "node", outfile: path.join(OUT, outfile), logLevel: "error" });
  return require(path.join(OUT, outfile));
};
const T = load("tikzFigure.ts", "_tikzbundle.cjs");
const M = load("mathPlot.ts", "_mpbundle.cjs");
/** mdDeck 自己 import 了 @/types → 只能走 esbuild（要给它配 @ 别名）；LJ_TS 快路径下跳过用例 6 */
const loadBundled = (entry, outfile) => {
  const esbuild = require("D:/vue-app/node_modules/esbuild");
  esbuild.buildSync({
    entryPoints: [path.join(ROOT, "src", "composables", entry)],
    bundle: true, format: "cjs", platform: "node", logLevel: "error",
    outfile: path.join(OUT, outfile), alias: { "@": path.join(ROOT, "src") },
  });
  return require(path.join(OUT, outfile));
};
/** figureRender 里 import 了 .vue 组件 → 给 esbuild 加个"把 .vue 打桩"的插件，这样能调到**真函数** ✓
 *  （教训：v1652~v1655 期间用例 6 是"照抄一份替换逻辑"跑的，于是 /^tikz:(d+)$/ 丢反斜杠这种 bug 没抓住 ✗） */
const loadWithVueStub = (entry, outfile, vueImport) => {
  const esbuild = require("D:/vue-app/node_modules/esbuild");
  // buildSync 不允许 plugin ✗ → 改用 alias 把那个 .vue 精确映射到一个打桩文件 ✓
  const stub = path.join(OUT, "_vuestub.cjs");   // 必须 .cjs：会话工作区的 package.json 是 type:module，.js 会被当 ESM ✗
  fs.writeFileSync(stub, "module.exports = { default: { name: 'Stub', render: function () { return null } } };\n");
  const alias = {};
  alias[vueImport] = stub;                       // 长键在前，精确命中
  alias["@"] = path.join(ROOT, "src");
  esbuild.buildSync({
    entryPoints: [path.join(ROOT, "src", "composables", entry)],
    bundle: true, format: "cjs", platform: "node", logLevel: "error",
    outfile: path.join(OUT, outfile), alias,
  });
  return require(path.join(OUT, outfile));
};
const D = process.env.LJ_TS ? null : loadBundled("mdDeck.ts", "_mdbundle.cjs");
/** 【v1669】AI 工具模块（只依赖 @/types 与 mathPlot，走 esbuild 别名打包 ✓） */
const AT = process.env.LJ_TS ? null : loadBundled("aiTools.ts", "_aibundle.cjs");
/** 【v1671】课件 → 给 AI 看的纯文本（纯函数） */
const D2T = process.env.LJ_TS ? null : loadBundled("deckToText.ts", "_d2tbundle.cjs");
/** 【v1672】统一风格：restyleDeck（在 src/templates/ 下 —— 用 ../ 跳出 composables 目录 ✓）+ 主题表 */
const RS = process.env.LJ_TS ? null : loadBundled("../templates/restyle.ts", "_rsbundle.cjs");
const TH = process.env.LJ_TS ? null : loadBundled("../templates/pptTheme.ts", "_thbundle.cjs");
const F = process.env.LJ_TS ? null : loadWithVueStub("figureRender.ts", "_frbundle.cjs", "@/components/elements/MathFigureElement.vue");

/** 交给解析器的"应用自己的几何"（与 figureRender.tikzSolver 同一套：弦与曲线的交点 + 取景） */
const SOLVER = {
  lineRoots: (kind, params, line) => M.conicLineRoots(kind, params, line),
  view: (kind, params) => {
    const def = M.CONICS[kind];
    const pv = M.withParams(kind, params);
    return def.viewOf ? def.viewOf(pv) : def.view;
  },
};

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  [ok] " + m) } else { fail++; console.log("  [XX] " + m) } };
const near = (a, b, e = 1e-3) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= e;

/* ------------------------------------------------------------------ 用例 */
/** 用例 1 = **用户原文**（2026-09-26 贴的）：x²/1 − y²/2.25 = 1，过 F₂ 的竖直弦 AB，外加一条 F₁A 线段 */
const CASE1 = String.raw`\begin{tikzpicture}[scale=0.8]
  % 坐标轴
  \draw[->] (-4,0) -- (4,0) node[below] {$x$};
  \draw[->] (0,-3.5) -- (0,3.5) node[left] {$y$};
  \node[below left] at (0,0) {$O$};
  % 双曲线
  \draw[thick,domain=-3:3,samples=100] plot ({-sqrt(1+(\x)^2/2.25)}, \x);
  \draw[thick,domain=-3:3,samples=100] plot ({sqrt(1+(\x)^2/2.25)}, \x);
  % 焦点
  \fill (-1.8,0) circle (1.5pt) node[below left] {$F_1$};
  \fill (1.8,0) circle (1.5pt) node[below right] {$F_2$};
  % 直线与交点
  \draw[thick] (1.8,-2.5) -- (1.8,2.5);
  \fill (1.8,1.8) circle (1.5pt) node[right] {$A$};
  \fill (1.8,-1.8) circle (1.5pt) node[right] {$B$};
  \draw[thick] (-1.8,0) -- (1.8,1.8);
\end{tikzpicture}`;

const CASE2 = String.raw`\begin{tikzpicture}
% 抛物线 y^2 = 4x（p=2），竖直焦点弦 AB 过 F
\draw[->] (-1.2,0) -- (5.2,0) node[right] {$x$};
\draw[->] (0,-3.4) -- (0,3.4) node[above] {$y$};
\draw[domain=-3:3,samples=100] plot ({\x*\x/4},{\x});
\fill (1,0) circle (1.5pt) node[below] {$F$};
\draw (1,-2) -- (1,2);
\fill (1,2) circle (1.5pt) node[right] {$A$};
\fill (1,-2) circle (1.5pt) node[right] {$B$};
\node at (0,0) [below left] {$O$};
\end{tikzpicture}`;

const CASE3 = String.raw`\begin{tikzpicture}
% 椭圆 x^2/16 + y^2/9 = 1 的内接三角形 ABC
\draw[->] (-4.8,0) -- (4.8,0) node[right] {$x$};
\draw[->] (0,-3.6) -- (0,3.6) node[above] {$y$};
\draw (0,0) ellipse (4 and 3);
\coordinate (A) at (0,3);
\coordinate (B) at (-3.4641,-1.5);
\coordinate (C) at (3.4641,-1.5);
\draw (A) -- (B) -- (C) -- cycle;
\fill (0,3) circle (1.5pt) node[above] {$A$};
\fill (-3.4641,-1.5) circle (1.5pt) node[left] {$B$};
\fill (3.4641,-1.5) circle (1.5pt) node[right] {$C$};
\end{tikzpicture}`;

const CASE4 = String.raw`\begin{axis}[axis lines=middle]
\addplot[domain=-2:2]{x^2};
\end{axis}`;

const CASE5 = String.raw`\begin{tikzpicture}
\draw[->] (-3,0)--(3,0);
\foreach \x in {1,2,3} { \draw (\x,0) -- (\x,1); }
\end{tikzpicture}`;

/** 用例里 TikZ 自己的采样（用来核对"应用画出来的曲线穿过这些点"） */
const SAMPLES = {
  // 原文是 x = ±√(1+y²/2.25) 两支：两条 plot 各一支 → fs 里放两支
  1: { fs: [(t) => [-Math.sqrt(1 + (t * t) / 2.25), t], (t) => [Math.sqrt(1 + (t * t) / 2.25), t]], t0: -3, t1: 3 },
  2: { fs: [(t) => [(t * t) / 4, t]], t0: -3, t1: 3 },
  3: { fs: [(t) => [4 * Math.cos(t), 3 * Math.sin(t)]], t0: 0, t1: Math.PI * 2 },
  8: { fs: [(t) => [2 * Math.cosh(t), 3.4641 * Math.sinh(t)], (t) => [-2 * Math.cosh(t), 3.4641 * Math.sinh(t)]], t0: -1.3, t1: 1.3 },
};
/** 隐式方程（应用自己的二次型）在 TikZ 采样点上的最大残差 */
function conicResidual(kind, params, s) {
  const q = M.conicQuadratic(kind, params);
  let worst = 0;
  for (const f of s.fs) {
    for (let i = 0; i <= 60; i++) {
      const t = s.t0 + ((s.t1 - s.t0) * i) / 60;
      const xy = f(t);
      const v = q.A * xy[0] * xy[0] + q.B * xy[1] * xy[1] + q.C * xy[0] + q.D * xy[1] + q.E;
      worst = Math.max(worst, Math.abs(v));
    }
  }
  return worst;
}

/* ------------------------------------------------------------------ 断言 */
const results = [];
console.log("=== 用例 1：双曲线（用户那段）+ 过 F2 的竖直弦 AB ===");
{
  const r = T.parseTikzPicture(CASE1, SOLVER);
  ok(r.ok, "解析成功");
  if (!r.ok) console.log("     原因：" + r.reason);
  else {
    const s = r.spec;
    console.log("  kind=" + s.kind + "  params=" + JSON.stringify(s.params));
    console.log("  points=" + JSON.stringify(s.points));
    console.log("  lines=" + JSON.stringify(s.lines));
    console.log("  notes=" + JSON.stringify(s.notes));
    ok(s.kind === "conicCustomHyperbola", "译成双曲线");
    ok(near(s.params.a, 1) && near(s.params.b, 1.5), "a=1、b=1.5（原文 x=±√(1+y²/2.25) → x²/1 − y²/2.25 = 1）");
    ok(!s.params.aline, "原文没画渐近线 → 不加渐近线");
    ok(s.params.ab === 0, "关掉自带的 a= 标注");
    ok(s.lines.length === 2, "两条线都在：竖直弦 + F₁A 线段");
    const vL = s.lines.find((L) => L.vertical);
    ok(!!vL && near(vL.m, 1.8) && near(vL.s, -2.5) && near(vL.e, 2.5), "竖直弦 x=1.8，y 从 -2.5 到 2.5（原文 |AB|=10 画的就是它）");
    const fL = s.lines.find((L) => !L.vertical);
    ok(!!fL && near(fL.k, 0.5) && near(fL.m, 0.9) && near(fL.s, -1.8) && near(fL.e, 1.8), "F₁A 线段：y=0.5x+0.9，x 从 -1.8 到 1.8");
    ok(s.points.length === 2 && s.points[0].label === "A" && s.points[1].label === "B", "A、B 两个标注点");
    ok(s.points.every((p) => p.label !== "F₂" && p.label !== "F₁"), "焦点没重复画（原文写 ±1.8，真焦点 ±1.80278，容差内）");
    ok(s.texts.length === 0, "x/y/O 不再重复标注");
    // 【v1654】吸附：原文 A、B 标在 (1.8,±1.8)，真交点是 (1.8,±2.2449) → 要钉到第 1 条线（竖直弦）上
    const lk = s.links || [];
    ok(lk.length === 2 && lk[0] && lk[0].line === 1 && lk[0].which === 1 && lk[1] && lk[1].line === 1 && lk[1].which === 0,
      "A、B 钉在**竖直弦**与曲线的两个交点上（不是 F₁A 那条线）：" + JSON.stringify(lk));
    ok(near(s.points[0].y, 2.2449, 2e-3) && near(s.points[1].y, -2.2449, 2e-3), "A、B 挪到真交点 y=±2.2449（原文 ±1.8），x 仍 1.8");
    ok(/钉在/.test(s.notes.join()), "提示里写清了：" + s.notes[s.notes.length - 1]);
    // 吸附之后：点必须**真的落在曲线上**（用应用自己的二次型验），并且应用按绑定现算的位置要对得上
    const q = M.conicQuadratic(s.kind, s.params);
    const f = (p) => q.A * p.x * p.x + q.B * p.y * p.y + q.C * p.x + q.D * p.y + q.E;
    const posA = M.conicPointPos(s.kind, s.params, 1, s.links);
    const posB = M.conicPointPos(s.kind, s.params, 2, s.links);
    ok(!!posA && !!posB && near(posA.y, 2.244994, 1e-5) && near(posB.y, -2.244994, 1e-5),
      "应用自己按绑定现算的位置（conicPointPos）就是真交点：" + JSON.stringify([posA, posB]));
    // 画出来的位置严格在曲线上；存起来的 px/py 是"解除绑定后的落脚点"，按应用的 4 位小数口径存
    ok(Math.abs(f(posA)) < 1e-12 && Math.abs(f(posB)) < 1e-12,
      "应用**实际画**的 A、B 严格在曲线上（二次型 " + Math.abs(f(posA)).toExponential(1) + " / " + Math.abs(f(posB)).toExponential(1) + "）");
    const resid = s.points.map((p) => Math.abs(f(p)));
    ok(resid.every((v) => v < 1e-5), "存起来的 px/py 也落在曲线上（4 位小数口径，残差 " + resid.map((v) => v.toExponential(1)).join(", ") + "）");
    const res = conicResidual(s.kind, s.params, SAMPLES[1]);
    ok(res < 1e-9, "应用的双曲线方程穿过原文两支的 122 个采样点（最大残差 " + res.toExponential(2) + "）");
    results.push({ name: "① 用户原文：双曲线 + 竖直弦 AB + F₁A", spec: s, s: SAMPLES[1] });
  }
}

console.log("=== 用例 2：抛物线 y²=4x + 过焦点的竖直弦 AB ===");
{
  const r = T.parseTikzPicture(CASE2, SOLVER);
  ok(r.ok, "解析成功");
  if (!r.ok) console.log("     原因：" + r.reason);
  else {
    const s = r.spec;
    console.log("  kind=" + s.kind + "  params=" + JSON.stringify(s.params));
    console.log("  points=" + JSON.stringify(s.points));
    console.log("  lines=" + JSON.stringify(s.lines));
    console.log("  notes=" + JSON.stringify(s.notes));
    ok(s.kind === "conicCustomParabola" && near(s.params.p, 2) && s.params.dir === 1, "p=2、开口向右");
    ok(s.params.dline === 0, "没画准线就不加准线（自带默认是显示的）");
    ok(s.lines.length === 1 && s.lines[0].vertical === true && near(s.lines[0].m, 1), "竖直焦点弦 x=1");
    ok(s.points.length === 2 && s.points.map((p) => p.label).join("") === "AB", "A、B 两个标注点（F 去重）");
    const res = conicResidual(s.kind, s.params, SAMPLES[2]);
    ok(res < 1e-9, "应用的抛物线方程穿过 TikZ 采样点（最大残差 " + res.toExponential(2) + "）");
    results.push({ name: "② 抛物线 y²=4x + 焦点弦", spec: s, s: SAMPLES[2] });
  }
}

console.log("=== 用例 3：椭圆 x²/16+y²/9=1 的内接三角形 ===");
{
  const r = T.parseTikzPicture(CASE3, SOLVER);
  ok(r.ok, "解析成功");
  if (!r.ok) console.log("     原因：" + r.reason);
  else {
    const s = r.spec;
    console.log("  kind=" + s.kind + "  params=" + JSON.stringify(s.params));
    console.log("  points=" + JSON.stringify(s.points));
    console.log("  lines=" + JSON.stringify(s.lines));
    console.log("  notes=" + JSON.stringify(s.notes));
    ok(s.kind === "conicCustomEllipse" && near(s.params.a, 4) && near(s.params.b, 3), "a=4、b=3");
    ok(s.lines.length === 3, "三角形的三条边都在（含 -- cycle 的收口边）");
    ok(s.points.length === 3 && s.points.map((p) => p.label).join("") === "ABC", "A、B、C 三个顶点");
    const res = conicResidual(s.kind, s.params, SAMPLES[3]);
    ok(res < 1e-9, "应用的椭圆方程穿过 TikZ 采样点（最大残差 " + res.toExponential(2) + "）");
    results.push({ name: "③ 椭圆 + 内接三角形", spec: s, s: SAMPLES[3] });
  }
}

const CASE7 = String.raw`\begin{tikzpicture}
% 弦 AB 的两头**正好**是交点，另外标了中点 M —— M 不该被钉到交点上去
\draw[->] (-5,0) -- (5,0) node[right] {$x$};
\draw[->] (0,-4) -- (0,4) node[above] {$y$};
\draw[domain=-2.2:2.2,samples=100] plot ({2*cosh(\x)},{1.5*sinh(\x)});
\draw[domain=-2.2:2.2,samples=100] plot ({-2*cosh(\x)},{1.5*sinh(\x)});
\draw (2.5,-1.125) -- (2.5,1.125);
\fill (2.5,1.125) circle (1.5pt) node[right] {$A$};
\fill (2.5,-1.125) circle (1.5pt) node[right] {$B$};
\fill (2.5,0) circle (1.5pt) node[right] {$M$};
\end{tikzpicture}`;

console.log("=== 用例 7：弦的中点 M 不许被误钉（要看整体最优，不是各自找最近）===");
{
  const r = T.parseTikzPicture(CASE7, SOLVER);
  ok(r.ok, "解析成功：" + (r.ok ? "" : r.reason));
  if (r.ok) {
    const s = r.spec;
    console.log("  points=" + JSON.stringify(s.points) + "\n  links=" + JSON.stringify(s.links));
    const byLabel = {};
    s.points.forEach((p, i) => { byLabel[p.label] = s.links[i] });
    ok(!!byLabel.A && byLabel.A.line === 1 && byLabel.A.which === 1 && !!byLabel.B && byLabel.B.line === 1 && byLabel.B.which === 0,
      "弦自己的两头（正好在交点上、且只属于这一条线）钉上 → 拖弦它们跟着走：" + JSON.stringify(s.links));
    ok(byLabel.M == null, "中点 M **没有**被钉（它在弦内部、离交点 10%）");
    ok(near(s.points.find((p) => p.label === "M").y, 0), "M 仍在 (2.5, 0)");
    ok(near(s.points.find((p) => p.label === "A").y, 1.125) && near(s.points.find((p) => p.label === "B").y, -1.125), "A、B 位置没被改动（本来就在曲线上）");
  }
}

const CASE8 = String.raw`\begin{tikzpicture}[scale=0.7]
  % x²/4 − y²/12 = 1（a=2, b=2√3），F₁(−4,0)、F₂(4,0)，过 F₂ 的竖直弦 AB，连 F₁A、F₁B
  \draw[->] (-5,0) -- (5.5,0) node[below] {$x$};
  \draw[->] (0,-7) -- (0,7) node[left] {$y$};
  \draw[domain=-1.3:1.3,samples=100] plot ({2*cosh(\x)},{3.4641*sinh(\x)});
  \draw[domain=-1.3:1.3,samples=100] plot ({-2*cosh(\x)},{3.4641*sinh(\x)});
  \fill (-4,0) circle (1.5pt) node[below left] {$F_1$};
  \fill (4,0) circle (1.5pt) node[below right] {$F_2$};
  \draw (4,-6) -- (4,6);
  \fill (4,6) circle (1.5pt) node[right] {$A$};
  \fill (4,-6) circle (1.5pt) node[right] {$B$};
  \draw (-4,0) -- (4,6);
  \draw (-4,0) -- (4,-6);
\end{tikzpicture}`;

console.log("=== 用例 8：用户截图那道题（按新提示词写出来的形状）===");
{
  const r = T.parseTikzPicture(CASE8, SOLVER);
  ok(r.ok, "解析成功：" + (r.ok ? "" : r.reason));
  if (r.ok) {
    const s = r.spec;
    console.log("  kind=" + s.kind + "  params=" + JSON.stringify(s.params).slice(0, 160));
    console.log("  points=" + JSON.stringify(s.points) + "  links=" + JSON.stringify(s.links));
    console.log("  lines=" + s.lines.length + "  notes=" + JSON.stringify(s.notes));
    ok(s.kind === "conicCustomHyperbola" && near(s.params.a, 2) && near(s.params.b, 3.4641, 2e-3), "a=2、b=2√3≈3.4641");
    ok(s.lines.length === 3, "三条线：竖直弦 AB + F₁A + F₁B");
    ok(s.points.length === 2 && s.points.map((p) => p.label).join("") === "AB", "只有 A、B 两个标注点（两个焦点去重）");
    const q8 = M.conicQuadratic(s.kind, s.params);
    const f8 = (p) => Math.abs(q8.A * p.x * p.x + q8.B * p.y * p.y + q8.C * p.x + q8.D * p.y + q8.E);
    ok(s.points.every((p) => f8(p) < 1e-5), "A(4,6)、B(4,−6) 本来就在曲线上（坐标算准了，残差 " + s.points.map((p) => f8(p).toExponential(1)).join(", ") + "）");
    ok(near(s.points[0].x, 4) && near(s.points[0].y, 6) && near(s.points[1].y, -6), "位置按原文照搬、没被改动");
    results.push({ name: "④ 用户截图那道题（弦 AB + F₁A/F₁B）", spec: s, s: SAMPLES[8] });
  }
}

console.log("=== 用例 4 / 5：认不出的必须退回占位（绝不硬猜）===");
{
  const r4 = T.parseTikzPicture(CASE4, SOLVER);
  ok(!r4.ok && /pgfplots/.test(r4.reason), "pgfplots 的 axis 环境 → 退回占位：" + (r4.ok ? "却解析成功了" : r4.reason));
  const r5 = T.parseTikzPicture(CASE5, SOLVER);
  ok(!r5.ok, "循环宏 → 退回占位：" + (r5.ok ? "却解析成功了" : r5.reason));
  const md = "题目如下：\n\n" + CASE1 + "\n\n解析：略。\n\n" + CASE5;
  const sp = T.tikzToPlaceholders(md, SOLVER);
  ok(sp.specs.length === 1 && sp.fails.length === 1, "整段回答：1 张译出、1 张退回占位");
  ok(/!\[\]\(tikz:0\)/.test(sp.md), "译出的那张写成图片占位（应用会落成图片元素再换成图形）");
  ok(/没能译成图形/.test(sp.md), "认不出的那张写成一行占位文字");
  ok(!/tikzpicture/.test(sp.md), "markdown 里不再剩 tikzpicture（幻灯片不会原样显示代码）");
}

console.log("=== 用例 6：整条链路（AI 回答 → 图片占位 → 换成图形元素）===");
if (!D) {
  console.log("  （LJ_TS=1 跳过：mdDeck 依赖 @/types，要走 esbuild 打包）");
} else {
  const md = "## 例 3\n\n已知双曲线，过 F₂ 的竖直弦 AB 交右支于 A、B。\n\n" + CASE1 + "\n\n求 |AB|。";
  const pre = T.tikzToPlaceholders(md, SOLVER);
  const deck = D.markdownToDeck(pre.md);
  const imgs = [];
  deck.slides.forEach((s, si) => (s.elements || []).forEach((e) => { if (e.type === "image") imgs.push({ si, src: e.src, x: e.x, y: e.y }) }));
  ok(imgs.length === 1 && imgs[0].src === "tikz:0", "markdown 导入把占位落成了一个图片元素：" + JSON.stringify(imgs));
  ok(imgs[0].si === 0 && imgs[0].y > 200, "图就落在题干下面（第 " + (imgs[0].si + 1) + " 页，y=" + imgs[0].y + "；共 " + deck.slides.length + " 页）");
  {
    const els = deck.slides[0].elements || [];
    const last = els[els.length - 1] || { y: 0, h: 0 };
    ok(last.y + (last.h || 0) <= 1080, "这一页最后一条内容没被顶出页底（y+h=" + Math.round(last.y + (last.h || 0)) + " ≤ 1080）");
  }
  // ★ 调**应用自己的** attachTikzFigures（不是照抄一份）→ 这个函数里的正则/分支改动都能被测到 ✓
  const figY0 = imgs[0].y;
  const got = F.attachTikzFigures(deck, pre.specs);
  ok(got.figures === 1, "应用自己的 attachTikzFigures 把占位换成了图形（figures=" + got.figures + "，orphans=" + got.orphans + "）");
  const els = deck.slides.flatMap((s) => s.elements || []);
  const fig = els.find((e) => e.type === "mathfig");
  ok(!!fig && fig.kind === pre.specs[0].kind && near(fig.y, figY0), "deck 里出现 mathfig 元素（kind=" + (fig && fig.kind) + "，y 不变：" + (fig && fig.y) + "）");
  ok(!!fig && Array.isArray(fig.pointLinks) && fig.pointLinks.length === pre.specs[0].points.length, "绑定信息（pointLinks）也带进了元素");
  ok(!JSON.stringify(deck).includes("tikz:"), "占位没有残留在幻灯片里");
  // 防"破图框"：故意给空 specs —— 应当换成一行说明，而不是留下 image ✓
  const deck2 = D.markdownToDeck(pre.md);
  const got2 = F.attachTikzFigures(deck2, []);
  const stillImg = deck2.slides.some((s) => (s.elements || []).some((e) => e.type === "image"));
  ok(got2.orphans === 1 && !stillImg, "占位找不到图形时不会留破图（orphans=" + got2.orphans + "，还剩 image=" + stillImg + "）");
  const texts = deck.slides.flatMap((s) => (s.elements || [])).filter((e) => e.type === "text" && e.text && !/^[\d\s.、（）()]+$/.test(e.text)).map((e) => e.text.replace(/\n/g, " ").slice(0, 24));
  console.log("  页面文字（前几条）：" + JSON.stringify(texts.slice(0, 4)));
}

/* ------------------------------------------------------------------ 渲染 + 叠点对照 */
const W = 520;
let html = '<html><head><meta charset="utf-8"><style>body{margin:0;background:#fff;font:13px/1.5 system-ui,"Microsoft YaHei";padding:10px}h3{margin:6px 0;color:#5b43ad;font-size:14px}.row{display:flex;flex-wrap:wrap;gap:10px}.t{border:1px solid #e6e6e6;border-radius:8px;padding:6px}.m{color:#666;font-size:11px;max-width:520px}</style></head><body><h3>TikZ → 应用图形：真渲染（红点 = TikZ 自己的采样点，曲线应当逐个穿过）</h3><div class="row">';
for (const R of results) {
  const s = R.spec;
  const box = M.figureBox(s.kind, W) || { w: W, h: 392 };
  // 与 MathFigureElement 完全同一条调用：pointLabels + **pointLinks**（绑定的点按交点现算）✓
  const svg = M.conicFigure(s.kind, box.w, box.h, "#1a1a1a", 3, "transparent", s.params, { pointLabels: s.points.map((p) => p.label), pointLinks: s.links });
  const pv = M.withParams(s.kind, s.params);
  const def = M.CONICS[s.kind];
  const view = def.viewOf ? def.viewOf(pv) : def.view;
  const mm = M.mapper(view, box.w, box.h);
  let dots = "";
  for (const f of R.s.fs) {
    for (let i = 0; i <= 60; i++) {
      const t = R.s.t0 + ((R.s.t1 - R.s.t0) * i) / 60;
      const xy = f(t);
      dots += '<circle cx="' + mm.X(xy[0]).toFixed(1) + '" cy="' + mm.Y(xy[1]).toFixed(1) + '" r="1.7" fill="#e23a3a"/>';
    }
  }
  for (const tx of s.texts) dots += '<circle cx="' + mm.X(tx.x).toFixed(1) + '" cy="' + mm.Y(tx.y).toFixed(1) + '" r="3" fill="none" stroke="#2f9e63"/>';
  html += '<div class="t"><h3>' + R.name + '</h3><svg xmlns="http://www.w3.org/2000/svg" width="' + box.w + '" height="' + box.h + '" viewBox="0 0 ' + box.w + " " + box.h + '"><rect width="' + box.w + '" height="' + box.h + '" fill="#fff"/>' + svg + dots + '</svg>' +
    '<div class="m">' + s.curve + ' ｜ 点 ' + s.points.length + ' 线 ' + s.lines.length + ' 文字 ' + s.texts.length +
    ' ｜ 钉在交点上的点 ' + (s.links || []).filter(Boolean).length + '<br>' + (s.notes.join("；") || "（无降级说明）") + '</div></div>';
}
html += "</div></body></html>";
fs.writeFileSync(path.join(OUT, "_tikz1.html"), html);

console.log("=== 用例 9：题目带附件原图 → 直接贴原图、不重建数学图形 ===");
{
  if (!F || !D) {
    console.log("  （LJ_TS=1 跳过：要走 esbuild 打包）");
  } else {
    const md = "**题目** 如图，已知椭圆 C: x^2/25 + y^2/9 = 1，F1 为其左焦点，过 F1 的直线 l 与椭圆交于 A、B 两点。\n\n求弦 AB 的长。\n\n" + CASE1;
    const pre = T.tikzToPlaceholders(md, SOLVER);
    ok(pre.specs.length === 1, "AI 回答里确实有一段 TikZ（会被译 —— 但这次应当**跳过**）");
    const pics = ["data:image/png;base64,AAAAFAKE"];
    // 面板里的做法：有附件原图 → 把 tikz 占位行整行删掉，再走 markdown 导入，最后贴原图 ✓
    const md2 = pre.md.replace(/^!\[\]\(tikz:\d+\)[ \t]*$/gm, "");
    ok(!/tikz:/.test(md2), "有附件原图时，TikZ 占位行被整行删掉（不再重建图形）");
    const deck = D.markdownToDeck(md2);
    const before = deck.slides[0].elements.length;
    const n = F.attachPics(deck, pics);
    const els = deck.slides[0].elements;
    const img = els[els.length - 1];
    ok(n === 1 && img.type === "image" && img.src === pics[0], "附件原图被贴成了图片元素（src 原样、contain）");
    // 【v1665】尺寸改成按图片**自己的比例**、并不超出页面（原来一律 900×560 ✗）
    const r9 = img.w / img.h;
    ok(img.fit === "contain" && r9 > 1.4 && r9 < 1.9 && img.y + img.h <= (deck.height || 720),
      "图按自己的比例插入、且不超出页面（" + img.w + "×" + img.h + "，比例 " + r9.toFixed(2) + "）");
    const lastText = els[before - 1];
    ok(img.y >= (lastText.y || 0) + (lastText.h || 0), "图排在文字**下面**（y=" + img.y + " ≥ 文字底 " + Math.round((lastText.y || 0) + (lastText.h || 0)) + "）");
    ok(!JSON.stringify(deck).includes("mathfig"), "整份 deck 里没有 mathfig —— 确实没有去重建数学图形");
  }
}

console.log("=== 用例 10：切图只留图形（题目文字不切）—— 合成图直接测纯函数 ===");
{
  const C = require(path.join(ROOT, "src", "composables", "figCrop.ts"));
  const W = 600, H = 800;
  const mk = () => new Uint8Array(W * H);
  const rect = (ink, x, y, w, h, v = 1) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (i >= 0 && j >= 0 && i < W && j < H) ink[j * W + i] = v };
  // 造三个字形块（8×10 的小方块当字）+ 一行 20 个 → 正文行
  const textRow = (ink, y, n, x0 = 20, gw = 8, gap = 4) => { for (let k = 0; k < n; k++) rect(ink, x0 + k * (gw + gap), y, gw, 10) };
  // ① 题干 3 行 + 一个"图"（大圆环 + 图里的小字母 A、B）
  const a = mk();
  textRow(a, 40, 26); textRow(a, 70, 24); textRow(a, 100, 27)
  // 连续的圆环（真实线稿是连笔，一个连通域 ✓ —— 用离散小方块拼会被当成"字" ✗）
  const ring = (ink, cx, cy, r) => { for (let t = 0; t < 360; t += 0.4) { const x = Math.round(cx + r * Math.cos((t * Math.PI) / 180)), y = Math.round(cy + r * Math.sin((t * Math.PI) / 180)); rect(ink, x - 1, y - 1, 3, 3) } }
  ring(a, 300, 500, 120)
  rect(a, 420, 400, 8, 10); rect(a, 180, 600, 8, 10)
  const ba = C.figureBoxFromInk(a, W, H);
  ok(!!ba, "① 题+图 → 认出了图形区域：" + JSON.stringify(ba));
  ok(!!ba && ba.y >= 330 && ba.y + ba.h <= 700, "① 切出来的框**不含**那三行题干（题目部分不切）：y=" + (ba && ba.y) + " 到 " + (ba && ba.y + ba.h));
  ok(!!ba && ba.x <= 186 && ba.x + ba.w >= 424, "① 框把图里的 A、B 两个小字母也框住了");
  // ② 整张只有文字 → 认不出（返回 null，调用方整张插 ✓）
  const b = mk();
  for (let k = 0; k < 6; k++) textRow(b, 60 + k * 40, 26)
  ok(C.figureBoxFromInk(b, W, H) === null, "② 整张都是文字 → 返回 null（不硬裁，整张插）");
  // ③ 文字 + 图里的一条长横线和一条虚线 → 两条线都不许被当成"正文行"切掉
  const c = mk();
  textRow(c, 40, 26); textRow(c, 70, 24)
  for (let x = 150; x < 450; x += 14) rect(c, x, 300, 8, 3)   // **只有**一条虚线在图顶上（短划也是"小方块" ✗ 危险）
  ring(c, 300, 500, 100)
  const bc = C.figureBoxFromInk(c, W, H);
  // 虚线被切掉的话，框顶会掉到圆环上沿（≈400）→ 断言 y 仍贴着虚线（≤320）才能**区分**出来 ✓
  ok(!!bc && bc.y <= 320, "③ 图顶的虚线没被当成正文行切掉（框顶 y=" + (bc && bc.y) + "，虚线在 300）");
  ok(!!bc && bc.y + bc.h >= 590, "③ 圆环也在框内（框底 " + (bc && bc.y + bc.h) + "）");
  ok(!!bc && bc.y >= 150, "③ 框仍然不含上面那两行题干：y=" + (bc && bc.y));
  // ④ ★ 粘连文字（真截图的常见情形）：每个字都连成一条长块 → 段数掉到 1~2，必须靠"成组"认出来
  const d = mk();
  const gluedRow = (ink, y, x0, wRow, hRow) => rect(ink, x0, y, wRow, hRow)   // 一整行连成一块 ✗ 段数=1
  gluedRow(d, 40, 30, 300, 12); gluedRow(d, 66, 30, 288, 12); gluedRow(d, 92, 34, 250, 12)
  ring(d, 300, 500, 100)
  const bd = C.figureBoxFromInk(d, W, H);
  ok(!!bd && bd.y >= 200, "④ 汉字粘连成一整块（段数=1）也能认出是题目：框顶 y=" + (bd && bd.y) + "（文字在 40~104）");
  ok(!!bd && bd.y + bd.h >= 590, "④ 图形仍在框内（框底 " + (bd && bd.y + bd.h) + "）");

  // ⑤ ★ 题目最后一行**紧挨着图**（只隔 2 行）—— 不许把图和文字并成一条带
  const e = mk();
  textRow(e, 40, 26); textRow(e, 70, 24)
  ring(e, 300, 200, 100)                       // 图上沿 y=100（和最后一行文字 80 只隔 20 行 → 间距 2 行时更狠）
  const be = C.figureBoxFromInk(e, W, H);
  // 文字到 79 结束、圆环从 100 开始；框顶应当落在两者**之间**（减一点点边距）✓
  ok(!!be && be.y >= 85 && be.y < 100, "⑤ 文字紧挨着图也不许并进来（框顶 y=" + (be && be.y) + "，文字到 79、图从 100 起）");
  // ⑥ ★ 图比文字宽：文字行仍要认出来（宽度基准要用"文字带"而不是"最宽带"）
  const f = mk();
  textRow(f, 40, 20, 20, 8, 4)                 // 文字只占 ~236px
  ring(f, 300, 500, 200)                       // 图宽 ~400px（比文字宽 ✗ 老写法会失效）
  const bf = C.figureBoxFromInk(f, W, H);
  ok(!!bf && bf.y >= 150, "⑥ 图比文字宽时，文字行仍被认出（框顶 y=" + (bf && bf.y) + "，文字在 40~50）");
  ok(!!bf && bf.y + bf.h >= 690, "⑥ 图仍在框内（框底 " + (bf && bf.y + bf.h) + "）");

  // ⑦ Otsu 分界：白底黑字 → 阈值落在中间
  const hist = new Array(256).fill(0); hist[250] = 5000; hist[30] = 500
  const th = C.otsuThreshold(hist, 5500)
  ok(th >= 30 && th < 250, "④ Otsu 阈值落在墨与纸之间（含墨峰本身）：t=" + th);
}

console.log("=== 用例 11：切完插进去的排版（比例尺寸 / 纵向排开 / 白边兜底）===");
{
  const C = require(path.join(ROOT, "src", "composables", "figCrop.ts"));
  // ① 白边兜底：只裁掉四周全空的行列（纯函数，直接测 ✓）
  {
    const w = 400, h = 300;
    const ink = new Uint8Array(w * h);
    for (let y = 90; y < 150; y++) for (let x = 120; x < 220; x++) ink[y * w + x] = 1;
    const tb = C.trimBoxFromInk(ink, w, h);
    ok(!!tb && tb.x >= 100 && tb.x + tb.w <= 240 && tb.y >= 70 && tb.y + tb.h <= 170,
      "① 一圈白边被裁掉、内容不动：" + JSON.stringify(tb));
    ok(!!tb && tb.w * tb.h < w * h * 0.5, "① 裁完确实小多了（" + (tb && tb.w) + "×" + (tb && tb.h) + " ← 400×300）");
    const full = new Uint8Array(w * h).fill(1);
    ok(C.trimBoxFromInk(full, w, h) === null, "① 整张都有墨（省不下）→ 返回 null，不白折腾");
    ok(C.trimBoxFromInk(new Uint8Array(w * h), w, h) === null, "① 全空白 → 返回 null");
  }
  if (!F) {
    console.log("  （LJ_TS=1 跳过：排版函数在 figureRender 里，要走 esbuild 打包）");
  } else {
    // ② 按比例定尺寸：不拉伸、也不放大
    const s1 = F.fitPicSize(1600, 900, 900, 620);
    ok(s1.w === 900 && Math.abs(s1.w / s1.h - 1600 / 900) < 0.01, "② 宽图按比例缩到 900 宽（" + s1.w + "×" + s1.h + "）");
    const s2 = F.fitPicSize(400, 300);
    ok(s2.w === 400 && s2.h === 300, "② 本来就小的图**不放大**（" + s2.w + "×" + s2.h + "）");
    const s3 = F.fitPicSize(400, 1600, 900, 620);
    ok(s3.h === 620 && s3.w < s3.h, "② ★竖长的图现在有 620 高（" + s3.w + "×" + s3.h + "）—— 老写法会被塞进 900×560 框缩成很小 ✗");
    // ③ 多张纵向排开：互不重叠、都在区域内
    const rects = F.layoutPics([
      { src: "a", w: 600, h: 400 },
      { src: "b", w: 400, h: 600 },
    ], { x: 100, y: 200, w: 1000, h: 400 });
    ok(rects.length === 2, "③ 两张图各得一个位置");
    ok(rects[0].y + rects[0].h <= rects[1].y, "③ 两张**不重叠**（上张到底 " + (rects[0].y + rects[0].h) + " ≤ 下张顶 " + rects[1].y + "）");
    ok(rects[1].y + rects[1].h <= 600, "③ 都排在可用区域里（最后一张到底 " + (rects[1].y + rects[1].h) + " ≤ 600）");
    ok(Math.abs(rects[1].w / rects[1].h - 400 / 600) < 0.02, "③ 竖图仍是竖的（" + rects[1].w + "×" + rects[1].h + "，不拉伸 ✓）");
    const cen = F.layoutPics([{ src: "a", w: 200, h: 100 }], { x: 100, y: 200, w: 1000, h: 400 }, 16, "center");
    ok(cen[0].x > 100 && cen[0].x + cen[0].w < 1100, "③ 居中插入时水平居中（x=" + cen[0].x + "）");
    // ④ 第一页排满 → 另起一页放图（原来硬塞到页面外 ✗）
    const d2 = { title: "t", width: 1280, height: 720, slides: [{ id: "s1", bg: "#ffffff", elements: [{ id: "t1", type: "richtex", x: 40, y: 40, w: 1180, h: 640 }] }] };
    const n2 = F.attachPics(d2, [{ src: "data:image/png;base64,AA", w: 800, h: 600 }]);
    const last = d2.slides[d2.slides.length - 1];
    ok(n2 === 1 && d2.slides.length === 2, "④ 第一页排满 → 图片另起一页（页数 " + d2.slides.length + "）");
    const im2 = last.elements[last.elements.length - 1];
    ok(!!im2 && im2.x + im2.w <= 1280 && im2.y + im2.h <= 720, "④ 图在页面内、看得见（" + im2.x + "," + im2.y + " " + im2.w + "×" + im2.h + "）");
  }
}

console.log("=== 用例 12：插入前预览里的选择 → 真正要插的图 ===");
{
  const C = require(path.join(ROOT, "src", "composables", "figCrop.ts"));
  const items = [
    { cut: "cut1", cw: 536, ch: 360, raw: "raw1", rw: 1835, rh: 790, mode: "figure", why: "已按图形区域裁好" },
    { cut: "cut2", cw: 400, ch: 300, raw: "raw2", rw: 900, rh: 700, mode: "trim", why: "只去了白边", useRaw: true },
    { cut: "", cw: 0, ch: 0, raw: "raw3", rw: 600, rh: 400, mode: "raw", why: "认不出图形" },
  ];
  const pics = C.previewToPics(items);
  ok(pics.length === 3, "三张图都得到一项结果");
  ok(pics[0].src === "cut1" && pics[0].w === 536 && pics[0].h === 360, "默认用切好的图形（尺寸按结果 536×360）");
  ok(pics[1].src === "raw2" && pics[1].w === 900 && pics[1].h === 700, "★勾了「用整张原图」的那张改用原图（尺寸换成原图 900×700）");
  ok(pics[2].src === "raw3" && pics[2].w === 600, "认不出图形的直接给原图");
  ok(C.previewToPics([]).length === 0 && C.previewToPics(null).length === 0, "空输入不炸（返回空数组）");
}

console.log("=== 用例 13：一次插多张图（用户实报：只插进去一张）===");
{
  if (!F) {
    console.log("  （LJ_TS=1 跳过：picElementItems 在 figureRender 里，要走 esbuild 打包）");
  } else {
    const area = { x: 60, y: 260, w: 1160, h: 436 };
    const items = F.picElementItems([
      { src: "p1", w: 536, h: 360 },
      { src: "p2", w: 400, h: 600 },
      { src: "p3", w: 1600, h: 900 },
    ], area, 20, "center");
    ok(items.length === 3, "三张图 → 三个元素（不是只插第一张）：" + items.length);
    ok(items.every((it) => it.type === "image" && it.overrides.fit === "contain"), "每个都是 image 元素 + contain（不裁不拉）");
    ok(items.map((it) => it.overrides.src).join(",") === "p1,p2,p3", "顺序与原图一致（p1,p2,p3）");
    const rs = items.map((it) => ({ x: Number(it.overrides.x), y: Number(it.overrides.y), w: Number(it.overrides.w), h: Number(it.overrides.h) }));
    ok(rs.every((r) => r.x >= area.x && r.x + r.w <= area.x + area.w && r.y >= area.y && r.y + r.h <= area.y + area.h),
      "三个都在可用区域里：" + rs.map((r) => r.x + "," + r.y + " " + r.w + "×" + r.h).join(" | "));
    let overlap = false;
    for (let i = 1; i < rs.length; i++) if (rs[i].y < rs[i - 1].y + rs[i - 1].h) overlap = true;
    ok(!overlap, "彼此不重叠（纵向依次排开）");
    ok(Math.abs(rs[1].w / rs[1].h - 400 / 600) < 0.03, "竖图仍是竖的（" + rs[1].w + "×" + rs[1].h + "）");
    // 空输入 / 无效输入不炸
    ok(F.picElementItems([], area).length === 0 && F.picElementItems(["", null], area).length === 0, "空输入返回空数组");
  }
}

console.log("=== 用例 14：AI 回答插到当前页（不新建页、元素不许带旧 id）===");
{
  if (!F) {
    console.log("  （LJ_TS=1 跳过：flowDeckElements 在 figureRender 里，要走 esbuild 打包）");
  } else {
    const deck = {
      title: "md", width: 1920, height: 1080,
      slides: [
        { id: "s1", bg: "#fff", elements: [
          { id: "e1", type: "richtex", x: 150, y: 100, w: 1620, h: 140, fontSize: 32, text: "题目" },
          { id: "e2", type: "mathfig", x: 150, y: 260, w: 800, h: 500, fontSize: 0 },
        ] },
        { id: "s2", bg: "#fff", elements: [
          { id: "e3", type: "richtex", x: 150, y: 100, w: 1620, h: 200, fontSize: 28, text: "解析" },
        ] },
      ],
    };
    const area = { x: 60, y: 300, w: 1160, h: 396, pageW: 1920, pageH: 1080 };
    const els = F.flowDeckElements(deck, area, 16, area.pageW);
    ok(els.length === 3, "两页 3 个元素全部摊平到当前页（" + els.length + " 个）");
    ok(els.every((it) => !("id" in it.overrides) && !("groupId" in it.overrides)), "★搬过来的元素**不带旧 id**（否则跟当前页元素撞号）");
    ok(els[0].overrides.x === 210 && els[0].overrides.y === 300, "第一个元素落在可用区域左上（" + els[0].overrides.x + "," + els[0].overrides.y + "）");
    let stack = true;
    for (let i = 1; i < els.length; i++) if (els[i].overrides.y < els[i - 1].overrides.y + els[i - 1].overrides.h) stack = false;
    ok(stack, "纵向依次排开、互不重叠");
    ok(els[2].overrides.y > els[1].overrides.y + els[1].overrides.h - 1, "第二页的元素接在第一页后面（跨页摊平）");
    ok(els[0].overrides.w === 1620 && els[0].overrides.fontSize === 32, "页面尺寸一样时**不缩放**（w=1620、字号 32）");
    const els2 = F.flowDeckElements(deck, area, 16, 1280);
    ok(Math.abs(els2[0].overrides.w - 1080) <= 1 && Math.abs(els2[0].overrides.fontSize - 21) <= 1,
      "目标页更窄（PPT 导入的 1280）就整体缩（w=" + els2[0].overrides.w + "、字号=" + els2[0].overrides.fontSize + "）");
    ok(F.flowDeckElements(null, area).length === 0, "空 deck 不炸");
  }
}

console.log("=== 用例 18：PPT 导入后统一风格（只改样式、版式绝不动）===");
{
  if (!RS || !TH) {
    console.log("  （LJ_TS=1 跳过：restyle 依赖 @/composables/textMetrics，要走 esbuild 打包）");
  } else {
    const theme = TH.getTheme("edumath");
    const scale = [theme.type.display, theme.type.h1, theme.type.h2, theme.type.h3, theme.type.body, theme.type.small, theme.type.label];
    const deck = {
      title: "导入的 PPT", theme: "edumath", width: 1280, height: 720,
      slides: [{ id: "s1", bg: "#f3f0ff", elements: [
        { id: "t1", type: "richtex", x: 123, y: 77, w: 900, h: 120, fontSize: 27, color: "#cc0000", text: "例题 1：求抛物线的焦点" },
        { id: "im1", type: "image", x: 200, y: 300, w: 400, h: 300, src: "data:image/png;base64,AAA" },
      ] }],
    };
    const before = JSON.parse(JSON.stringify(deck));
    const r = RS.restyleDeck(deck, undefined, "soft");
    const el = deck.slides[0].elements[0];
    ok(r.changed > 0, "确实改了东西（changed=" + r.changed + "，theme=" + (r.theme && r.theme.id) + "）");
    ok(scale.indexOf(el.fontSize) >= 0 && el.fontSize !== 27, "★字号吸附到主题档位（27 → " + el.fontSize + "，合法档位：" + scale.join("/") + "）");
    ok(el.x === before.slides[0].elements[0].x && el.y === before.slides[0].elements[0].y && el.w === before.slides[0].elements[0].w && el.h === before.slides[0].elements[0].h,
      "★**版式一点没动**（x/y/w/h = " + el.x + "," + el.y + "," + el.w + "," + el.h + " 与导入时一致）");
    ok(el.text === before.slides[0].elements[0].text, "文字内容原样（绝不碰内容）");
    ok(deck.slides[0].elements.length === before.slides[0].elements.length, "元素一个不多一个不少（没删没加）");
    ok(deck.slides[0].elements[1].src === before.slides[0].elements[1].src, "图片地址原样");
    ok(deck.slides[0].elements[1].x === 200 && deck.slides[0].elements[1].y === 300, "图片位置也没动");
    ok(typeof deck.slides[0].bg === "string" && deck.slides[0].bg.length > 0, "页面底色换成了主题底色（" + deck.slides[0].bg + "）");
    const twice = RS.restyleDeck(deck, undefined, "soft");
    ok(twice.changed === 0, "再跑一次不再改动（幂等：不会越套越花）");
  }
}

console.log("=== 用例 17：对话窗口吃 PPT（课件 → 给 AI 看的文字）===");
{
  if (!D2T) {
    console.log("  （LJ_TS=1 跳过：deckToText 依赖 @/types，要走 esbuild 打包）");
  } else {
    const deck = {
      title: "抛物线", width: 1280, height: 720,
      slides: [
        { id: "s1", bg: "#fff", elements: [
          { id: "t1", type: "richtex", x: 0, y: 0, w: 100, h: 40, text: "抛物线的定义" },
          { id: "f1", type: "mathfig", x: 0, y: 60, w: 400, h: 300, kind: "conicParabola" },
        ] },
        { id: "s2", bg: "#fff", elements: [
          { id: "t2", type: "text", x: 0, y: 0, w: 100, h: 40, text: "  y²=4x 的焦点  " },
          { id: "tb", type: "table", x: 0, y: 60, w: 400, h: 200, cells: [["p", "焦点"], ["2", "(1,0)"]] },
          { id: "im", type: "image", x: 0, y: 300, w: 200, h: 150, src: "x" },
        ] },
        { id: "s3", bg: "#fff", elements: [] },
      ],
    };
    const txt = D2T.deckToPlainText(deck);
    ok(txt.indexOf("共 3 页") > 0 && txt.indexOf("抛物线") > 0, "开头写清课件名与页数：" + txt.split("\n")[0]);
    ok(txt.indexOf("【第 1 页】") > 0 && txt.indexOf("【第 3 页】") > 0, "每页都有页码标记（AI 才知道自己在说第几页）");
    ok(txt.indexOf("抛物线的定义") > 0, "文字元素原样带出");
    ok(txt.indexOf("[数学图形：conicParabola]") > 0, "数学图形给占位说明（不然 AI 不知道那里有图）");
    ok(txt.indexOf("p | 焦点") > 0 && txt.indexOf("2 | (1,0)") > 0, "表格按行展开（单元格用 | 分隔）");
    ok(txt.indexOf("[图片]") > 0, "图片给占位说明");
    ok(txt.indexOf("y²=4x 的焦点") > 0, "文字两端空白被去掉（text 元素也一样处理）");
    ok(txt.indexOf("（这一页没有文字）") > 0, "空白页也如实说明");
    const long = D2T.deckToPlainText({ title: "x", width: 100, height: 100, slides: [{ id: "s", bg: "#fff", elements: [{ id: "t", type: "text", x: 0, y: 0, w: 1, h: 1, text: "啊".repeat(5000) }] }] }, { maxChars: 100 });
    ok(long.length < 200 && long.indexOf("已截断") > 0, "太长会截断并标注（" + long.length + " 字）");
    ok(D2T.deckToPlainText(null) === "" && D2T.deckToPlainText({ title: "e", width: 1, height: 1, slides: [] }) === "", "空课件不炸（返回空串）");
    ok(D2T.elementToText({ id: "z", type: "chart", x: 0, y: 0, w: 1, h: 1 }) === "[图表]", "认不出的类型也给方括号说明，不静默丢");
  }
}

console.log("=== 用例 15：AI 调应用的功能（工具层用假 ctx 直接跑真代码）===");
const CASE15 = (async () => {
  if (!AT) {
    console.log("  （LJ_TS=1 跳过：aiTools 依赖 @/types，要走 esbuild 打包）");
  } else {
    const made = [];
    const ctx = {
      deck: { width: 1920, height: 1080, title: "t", slides: [{ id: "s1", elements: [{ id: "a", type: "richtex", x: 10, y: 20, w: 300, h: 100, text: "已知函数" }] }] },
      currentIndex: 0,
      addElements: (items) => { made.push(...items); return items.length },
      addSlide: () => { made.push({ type: "__addSlide" }) },
      gotoSlide: (i) => { made.push({ type: "__goto", i }) },
      updateElement: (id, patch) => { made.push({ type: "__update", id, patch }) },
      removeElement: (id) => { made.push({ type: "__remove", id }) },
      undo: () => { made.push({ type: "__undo" }) },
      bank: {
        search: async (q, n) => [{ id: 7, label: "P-2026-0007 抛物线焦点弦 " + q + "/" + n }],
        textOf: async (id, wa) => (id === 7 ? "题干：抛物线 y^2=4x 的焦点弦…\n答案：" + (wa ? "4" : "（略）") : null),
      },
    };
    const names = AT.AI_TOOLS.map((t) => t.function && t.function.name);
    ok(AT.AI_TOOLS.length >= 9, "工具清单 " + AT.AI_TOOLS.length + " 个：" + names.join("、"));
    ok(AT.AI_TOOLS.every((t) => t.type === "function" && t.function && t.function.name && t.function.parameters && t.function.description),
      "每个工具都有 name / description / parameters（缺一个模型就用不了）");
    ok(AT.aiToolGuide().indexOf("insert_math_figure") > 0, "system 补充说明里点名了插入图形的用法");
    const st = await AT.runAiTool("get_deck_state", {}, ctx);
    ok(st.ok && st.result.pages === 1 && st.result.current === 1, "读课件：页数/当前页（" + st.result.pages + "/" + st.result.current + "）");
    ok(st.result.elements.length === 1 && st.result.elements[0].id === "a" && st.result.elements[0].text === "已知函数",
      "读课件给出当前页元素的 id 与文字（AI 才知道该改谁）");
    const f1 = await AT.runAiTool("insert_math_figure", { kind: "conicParabola", params: { p: 2 } }, ctx);
    ok(f1.ok && made.length === 1 && made[0].type === "mathfig", "插入数学图形 → 交给应用一个 mathfig 元素");
    ok(made[0] && made[0].overrides && String(made[0].overrides.kind) === "conicParabola", "kind 落到元素上（" + (made[0].overrides.kind) + "）");
    const f2 = await AT.runAiTool("insert_math_figure", { kind: "根本没有这种图" }, ctx);
    ok(!f2.ok && String(f2.error).indexOf("可选") > 0, "★认不出的 kind → 失败并给出可选清单（模型能自己改）");
    ok(made.length === 1, "认不出时**没有**往课件里塞东西");
    const t1 = await AT.runAiTool("insert_text", { text: "解：由 $y^2=4x$ 得 $p=2$", fontSize: 30 }, ctx);
    ok(t1.ok && made.length === 2 && made[1].type === "richtex" && made[1].overrides.fontSize === 30, "插入文字（字号也带上）");
    const s1 = await AT.runAiTool("add_slide", { title: "解题过程" }, ctx);
    ok(s1.ok && made.some((m) => m.type === "__addSlide") && made.some((m) => m.overrides && m.overrides.text === "解题过程"),
      "加一页并在新页写标题");
    ok((await AT.runAiTool("goto_slide", { page: 9 }, ctx)).ok === false, "页码越界 → 失败（不乱跳）");
    const sb = await AT.runAiTool("search_bank", { query: "抛物线", limit: 5 }, ctx);
    ok(sb.ok && sb.result.命中 === 1 && String(sb.result.题目[0].label).indexOf("P-2026-0007") === 0, "搜题库返回候选（编号+题干开头）");
    const iq = await AT.runAiTool("insert_bank_question", { id: 7 }, ctx);
    ok(iq.ok && made.some((m) => m.overrides && String(m.overrides.text).indexOf("焦点弦") >= 0), "整道题插进当前页（含答案）");
    ok((await AT.runAiTool("insert_bank_question", { id: 999 }, ctx)).ok === false, "库里没有的 id → 失败并提示先搜");
    const up = await AT.runAiTool("update_elements", { ids: ["a"], patch: { x: 200, fontSize: 36, id: "hack", type: "image", color: "#c0392b", 乱来: 1 } }, ctx);
    const u = made.filter((m) => m.type === "__update")[0];
    ok(up.ok && u && u.id === "a" && u.patch.x === 200 && u.patch.fontSize === 36 && u.patch.color === "#c0392b", "改元素：允许的字段真的改了");
    ok(u && !("id" in u.patch) && !("type" in u.patch) && !("乱来" in u.patch), "★白名单生效：id / type / 乱七八糟的字段全被挡掉");
    ok((await AT.runAiTool("update_elements", { ids: ["a"], patch: { type: "image" } }, ctx)).ok === false, "patch 里全是非法字段 → 失败（不动内容）");
    const del = await AT.runAiTool("delete_elements", { ids: ["a", "b"] }, ctx);
    ok(del.ok && made.filter((m) => m.type === "__remove").length === 2, "删元素按个数删");
    ok((await AT.runAiTool("undo", {}, ctx)).ok && made.some((m) => m.type === "__undo"), "撤销能用");
    ok((await AT.runAiTool("不存在的功能", {}, ctx)).ok === false, "没这个功能 → 失败（不静默）");
  }
})();

/* 【v1669】用例 15 是异步的（工具执行器返回 Promise）→ 结尾挂到它后面，
 *   否则断言会在"结果"打印之后才算，数字就是错的 ✗ */
console.log("=== 用例 16：字号与图形线条颜色（用户实报改不动）===");
const CASE16 = (async () => {
  if (!AT) {
    console.log("  （LJ_TS=1 跳过：aiTools 要走 esbuild 打包）");
  } else {
    const made = [];
    let snap = 0;
    const ctx = {
      deck: { width: 1920, height: 1080, title: "t", slides: [{ id: "s1", elements: [{ id: "tx", type: "richtex", x: 10, y: 20, w: 300, h: 100, text: "题干" }, { id: "fg", type: "mathfig", kind: "conicParabola", x: 10, y: 200, w: 600, h: 400 }] }] },
      currentIndex: 0,
      addElements: (items) => { made.push(...items); return items.length },
      addSlide: () => {}, gotoSlide: () => {},
      updateElement: (id, patch) => { made.push({ type: "__update", id, patch }) },
      removeElement: (id) => { made.push({ type: "__remove", id }) },
      undo: () => {},
      pushHistory: () => { snap++ },
    };
    await AT.runAiTool("update_elements", { ids: ["tx"], patch: { fontSize: 36 } }, ctx);
    let u = made.filter((m) => m.type === "__update").pop();
    ok(u && u.patch.fontSize === 36, "直接给 fontSize → 落到元素上（" + JSON.stringify(u && u.patch) + "）");
    await AT.runAiTool("update_elements", { ids: ["tx"], patch: { font_size: "44" } }, ctx);
    u = made.filter((m) => m.type === "__update").pop();
    ok(u && u.patch.fontSize === 44, "★写 font_size（字符串 44）也认 → 转成数字 44");
    await AT.runAiTool("update_elements", { ids: ["tx"], patch: { size: 28, textColor: "#c0392b" } }, ctx);
    u = made.filter((m) => m.type === "__update").pop();
    ok(u && u.patch.fontSize === 28 && u.patch.color === "#c0392b", "★size / textColor 也认（字号 28、颜色落上）");
    await AT.runAiTool("update_elements", { ids: ["fg"], patch: { conicStroke: "#c0392b", axisColor: "#8a8a99", lineColors: ["#c0392b", null] } }, ctx);
    u = made.filter((m) => m.type === "__update").pop();
    ok(u && u.patch.conicStroke === "#c0392b" && u.patch.axisColor === "#8a8a99", "图形线条色 conicStroke / 坐标轴 axisColor 能改（上一版被白名单挡掉 ✗）");
    ok(u && Array.isArray(u.patch.lineColors) && u.patch.lineColors.length === 2 && u.patch.lineColors[0] === "#c0392b" && u.patch.lineColors[1] === null,
      "逐条线颜色是**数组**（里面允许 null = 用默认色）");
    await AT.runAiTool("set_figure_style", { ids: ["fg"], curveColor: "#1e7a45", lineWidth: 5, pointColors: ["#c0392b"] }, ctx);
    u = made.filter((m) => m.type === "__update").pop();
    ok(u && u.patch.conicStroke === "#1e7a45" && u.patch.strokeWidth === 5, "set_figure_style：curveColor → 曲线色、lineWidth → 线宽");
    ok(u && Array.isArray(u.patch.pointColors) && u.patch.pointColors[0] === "#c0392b", "set_figure_style：各个点颜色也进得去");
    ok((await AT.runAiTool("set_figure_style", { ids: ["fg"] }, ctx)).ok === false, "没给颜色 → 失败（不乱改）");
    const before = snap;
    await AT.runAiTool("update_elements", { ids: ["tx", "fg"], patch: { x: 100 } }, ctx);
    ok(snap === before + 1, "改元素前存了一份撤销快照（否则老师 Ctrl+Z 回不来 ✗）");
    const b2 = snap;
    await AT.runAiTool("delete_elements", { ids: ["tx", "fg"] }, ctx);
    ok(snap === b2 + 1, "删元素前也存一份快照");
  }
})();

console.log("=== 用例 20：AI 抽题（模型返回的 JSON → 题目结构）===");
{
  const AI = require(path.join(ROOT, "src", "composables", "aiImport.ts"));
  // ① 标准形状 + 中文别名
  const r1 = AI.parseAiQuestions(JSON.stringify({ questions: [
    { stem: "已知抛物线 y^2=4x，求焦点坐标。", options: ["(1,0)", "(0,1)"], answer: "(1,0)", analysis: "p=2，焦点 (p/2,0)", qtype: "选择题", kp: ["抛物线"], section: "解析几何", level: "基础", difficulty: 2 },
    { 题干: "求 |AB|。", 答案: "4", 解析: "联立即可", 题型: "解答题", 难度: "较难" },
  ] }));
  ok(r1.items.length === 2 && r1.skipped === 0, "两条都收下了（" + r1.items.length + " 条）");
  ok(r1.items[0].qtype === "choice" && r1.items[0].level === "基础" && r1.items[0].difficulty === 2, "题型/层次/难度归一（" + r1.items[0].qtype + "/" + r1.items[0].level + "/" + r1.items[0].difficulty + "）");
  ok(r1.items[1].qtype === "answer" && r1.items[1].answer === "4" && r1.items[1].kp.length === 0, "中文别名字段也认（answer=4；缺知识点不编 ✗）");
  ok(r1.warn.some((w) => w.indexOf("没给知识点") > 0), "缺知识点会记警告（不静默）");
  // ② 裸数组 / 代码块围栏 / 单个对象
  const r2 = AI.parseAiQuestions("[{\"stem\":\"A\"},{\"question\":\"B\"}]");
  const r3 = AI.parseAiQuestions("这是结果：\n" + String.fromCharCode(96).repeat(3) + "json\n{\"questions\":[{\"stem\":\"C\"}]}\n" + String.fromCharCode(96).repeat(3));
  const r4 = AI.parseAiQuestions({ stem: "D" });
  ok(r2.items.length === 2, "裸数组也认（" + r2.items.length + " 条）");
  ok(r3.items.length === 1 && r3.items[0].stem === "C", "带解释文字 + 代码块围栏也能抠出 JSON ✓");
  ok(r4.items.length === 1 && r4.items[0].stem === "D", "只回一个题目对象也认");
  // ③ 缺题干 → 丢掉并计数（绝不塞空题 ✗）
  const r5 = AI.parseAiQuestions({ questions: [{ stem: "好的" }, { options: ["A", "B"] }, "不是对象", {}] });
  ok(r5.items.length === 1 && r5.skipped === 3, "★缺题干的 3 条被丢掉（收下 " + r5.items.length + " / 丢 " + r5.skipped + "）");
  // ④ 选项三种写法
  ok(AI.normOptions({ A: "1", B: "2" }).join("|") === "A. 1|B. 2", "选项对象 → 带字母前缀");
  ok(AI.normOptions(["A. 甲", "乙"]).join("|") === "A. 甲|乙", "数组里已带前缀就不重复加 ✓");
  ok(AI.normOptions("甲|乙|丙").length === 3, "竖线分隔的字符串也能拆");
  // ⑤ 题型/难度的兜底
  ok(AI.normQtype("", 4) === "choice" && AI.normQtype("", 0) === "answer", "题型认不出时按有没有选项猜 ✓");
  ok(AI.normDifficulty("难") === 4 && AI.normDifficulty(9) === 5 && AI.normDifficulty("") === 3, "难度：中文/越界/缺省都对（4/5/3）");
  // ⑥ 不是 JSON → 说人话，不炸
  const r6 = AI.parseAiQuestions("模型今天不想干活");
  ok(r6.items.length === 0 && r6.warn.length === 1 && r6.warn[0].indexOf("不是 JSON") > 0, "非 JSON 返回只给一句人话警告：" + r6.warn[0]);
}

console.log("=== 用例 19：离线序列号（验签 + 一个号两台电脑）===");
const CASE19 = (async () => {
  const L = require(path.join(ROOT, "src", "composables", "license.ts"));
  const G = require(path.join(ROOT, ".probe", "_licgen.cjs"));
  const LOCKED = L.LICENSED_FEATURES.join(",");
  ok(LOCKED === "math-figure,ai-assistant,handout,paper-edit", "锁定的功能就是用户指定的四项：" + LOCKED);
  const A = "MACHINE-AAAA-1111", Bm = "MACHINE-BBBB-2222", C = "MACHINE-CCCC-3333";
  const sA = await G.makeSerial([A]);
  ok(/^LJMS-/.test(sA) && sA.length > 100, "发号成功（" + sA.length + " 字符，" + sA.slice(0, 24) + "…）");
  const vA = await L.verifySerial(sA, A);
  ok(vA.ok === true, "★本机机器码对得上 → 通过（签发日 " + (vA.info && vA.info.issued) + "）");
  const vB = await L.verifySerial(sA, Bm);
  ok(vB.ok === false && String(vB.reason).indexOf("不是发给这台电脑") >= 0, "★换一台没登记的电脑 → 拒绝：" + vB.reason);
  const sAB = await G.makeSerial([A, Bm]);
  ok((await L.verifySerial(sAB, A)).ok === true && (await L.verifySerial(sAB, Bm)).ok === true, "★一个号两台电脑：两台都通过");
  ok((await L.verifySerial(sAB, C)).ok === false, "★第三台机器 → 拒绝（用户要求的就是两台）");
  const mid = Math.floor(sA.length / 2);
  const tampered = sA.slice(0, mid) + (sA[mid] === "A" ? "B" : "A") + sA.slice(mid + 1);
  const vt = await L.verifySerial(tampered, A);
  ok(vt.ok === false && String(vt.reason).indexOf("被改过") >= 0, "★改掉中间一位 → 验签不过：" + vt.reason);
  ok((await L.verifySerial("", A)).ok === false && (await L.verifySerial("LJMS-XXXX-XXXX", A)).ok === false, "空号 / 乱码 → 拒绝（不炸）");
  // 伪造：用**另一把私钥**签一份格式完全正确的号 → 必须被内置公钥挡下
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const body = await L.serialBody([A], new Date());
  const badSig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, body));
  const forged = L.encodeSerial(body, badSig);
  const vf = await L.verifySerial(forged, A);
  ok(vf.ok === false && String(vf.reason).indexOf("不是本应用发的") >= 0, "★别的私钥伪造的号（格式全对）→ 拒绝：" + vf.reason);
  // 大小写 / 空格 / 换行容错：老师粘贴时常常带这些
  const messy = "  " + sA.toLowerCase().replace(/-/g, " ") + String.fromCharCode(10);
  ok((await L.verifySerial(messy, A)).ok === true, "粘贴时带空格、换行、小写也认");
})();

console.log("=== 用例 21：抽题提示词与调用（caller 注入，探针用假的）===");
const CASE21 = (async () => {
  const AI = require(path.join(ROOT, "src", "composables", "aiImport.ts"));
  const pr = AI.buildExtractPrompt("第 1 题 已知抛物线 y^2=4x，求焦点。", { sections: ["解析几何", "函数与导数"] });
  const all = pr.system + " " + pr.user;
  ok(["stem", "options", "answer", "analysis", "qtype", "section", "kp", "level", "difficulty"].every((k) => all.indexOf(k) >= 0), "提示词把每个字段都写清了");
  ok(all.indexOf("choice") > 0 && all.indexOf("proof") > 0 && all.indexOf("中档") > 0, "题型与层次的可选值也写清了（不让模型自由发挥）");
  ok(all.indexOf("解析几何") > 0 && all.indexOf("函数与导数") > 0, "章节候选来自题库（传进来才用）");
  ok(pr.user.indexOf("已知抛物线") > 0 && pr.system.indexOf("已知抛物线") < 0, "原文进 user，不进 system");
  ok(AI.buildExtractPrompt("x", { withAnswer: false }).user.indexOf("不要答案") > 0, "只要题干选项时会在提示里说明");
  const fake = async () => JSON.stringify({ questions: [{ stem: "S1", answer: "1" }, { stem: "S2" }] });
  const r1 = await AI.extractQuestions(fake, "随便一段");
  ok(r1.items.length === 2, "★跑通一次抽题（" + r1.items.length + " 条）");
  const boom = async () => { throw new Error("网络断了") };
  const r2 = await AI.extractQuestions(boom, "x");
  ok(r2.items.length === 0 && r2.warn.length === 1 && r2.warn[0].indexOf("调用模型失败") >= 0, "模型调用失败 → 只回警告，不抛：" + r2.warn[0]);
  const prose = async () => "我觉得这道题挺难的";
  const r3 = await AI.extractQuestions(prose, "x");
  ok(r3.items.length === 0 && r3.warn[0].indexOf("不是 JSON") >= 0, "模型回废话 → 说人话，不炸");
  ok((await AI.extractQuestions(fake, "")).items.length === 2, "原文为空也不炸");
})();

console.log("=== 用例 22：逐字段校验（就地编辑要看它 ✓）===");
{
  const AI = require(path.join(ROOT, "src", "composables", "aiImport.ts"));
  const good = { stem: "已知抛物线 y^2=4x", options: ["A. 1", "B. 2"], answer: "(1,0)", analysis: "p=2", qtype: "choice", section: "解析几何", kp: ["抛物线"], level: "中档", difficulty: 2 };
  const i1 = AI.validateQuestion(good).filter((x) => x.level === "error");
  ok(i1.length === 0, "完整的一道选择题：没有 error（" + JSON.stringify(AI.validateQuestion(good).map((x) => x.field)) + " 是 warn）");
  const noAns = AI.validateQuestion(Object.assign({}, good, { answer: "" }));
  ok(noAns.some((x) => x.field === "answer" && x.level === "error"), "★没答案 → error，并且指出是 answer 字段");
  const oneOpt = AI.validateQuestion(Object.assign({}, good, { options: ["A. 1"] }));
  ok(oneOpt.some((x) => x.field === "options" && x.level === "error"), "★只剩一个选项 → error");
  const weird = AI.validateQuestion(Object.assign({}, good, { qtype: "answer" }));
  ok(weird.some((x) => x.field === "options" && x.level === "warn"), "有选项却标成解答题 → warn（能提交但提醒）");
  const empty = AI.validateQuestion(Object.assign({}, good, { stem: "", kp: [], section: "" }));
  ok(empty.filter((x) => x.level === "error").length === 1 && empty.filter((x) => x.level === "warn").length >= 2, "空题干=error，缺知识点/章节=warn");
  const b1 = AI.firstBlocking([good, Object.assign({}, good, { answer: "" })]);
  ok(b1 && b1.index === 1 && b1.issue.field === "answer", "★批量提交前能定位到第几题、哪个字段（第 " + (b1 && b1.index + 1) + " 题 / " + (b1 && b1.issue.field) + "）");
  ok(AI.firstBlocking([good]) === null && AI.firstBlocking([]) === null, "都合格 / 空数组 → 没有拦路的（返回 null）");
}

console.log("=== 用例 23：不抽答案时的提交口径（v1684 AI 导入对话框用）===");
const CASE23 = (async () => {
  const AI = require(path.join(ROOT, "src", "composables", "aiImport.ts"));
  const good = { stem: "已知抛物线 y^2=4x", options: ["A. 1", "B. 2"], answer: "(1,0)", analysis: "p=2", qtype: "choice", section: "解析几何", kp: ["抛物线"], level: "中档", difficulty: 2 };
  const noAns = Object.assign({}, good, { answer: "" });
  // ① 抽了答案：缺答案就是拦路的（要老师补）✗
  ok(AI.softenIssues(AI.validateQuestion(noAns), true).some((x) => x.field === "answer" && x.level === "error"), "抽了答案却没答案 → 仍是 error（拦提交）");
  // ② 没让 AI 抽答案：缺答案降级成提醒，别拦着老师存草稿 ✓
  const soft = AI.softenIssues(AI.validateQuestion(noAns), false);
  ok(soft.some((x) => x.field === "answer" && x.level === "warn"), "★没抽答案 → 缺答案降级成 warn（不再是 error）");
  ok(soft.filter((x) => x.level === "error").length === 0, "★降级后这一批没有 error：能提交 ✓");
  // ③ 只放过「缺答案」这一条，别的 error 一律照拦 ✗
  const badOpt = Object.assign({}, noAns, { options: ["A. 1"] });
  ok(AI.softenIssues(AI.validateQuestion(badOpt), false).some((x) => x.field === "options" && x.level === "error"), "★选项只剩一个 → 仍然是 error（没被顺手放过）");
  const noStem = Object.assign({}, noAns, { stem: "" });
  ok(AI.softenIssues(AI.validateQuestion(noStem), false).some((x) => x.field === "stem" && x.level === "error"), "空题干照样拦（绝不放行 ✗）");
  ok(AI.softenIssues([], false).length === 0 && AI.softenIssues([], true).length === 0, "空结果集不炸");
  // ④ 提交前定位：返回的是**传进来这批**里的下标（界面再换算回题卡号 ✓）
  const b1 = AI.firstBlockerOf([good, noAns, badOpt], true);
  ok(b1 && b1.index === 1 && b1.issue.field === "answer", "抽答案那批：定位到这批的第 2 条 / " + (b1 && b1.issue.field));
  const b2 = AI.firstBlockerOf([good, noAns, badOpt], false);
  ok(b2 && b2.index === 2 && b2.issue.field === "options", "★不抽答案那批：跳过「缺答案」，定位到第 3 条的选项问题");
  ok(AI.firstBlockerOf([good], true) === null && AI.firstBlockerOf([], false) === null, "都合格 / 空子集 → null（不误报）");
})();

console.log("=== 用例 40：选项编号去重（用户实报 AI 整卷里成了「A. A. …」✗ v1702）===");
{
  const O = loadBundled("optionLabel.ts", "_c40o.cjs");
  const NL = String.fromCharCode(10);
  // ① 基本：与位置相符的标签才剥 ✓
  ok(O.stripOptionLabel("A. $(1,3)$", 0) === "$(1,3)$", "★第 0 项剥掉 A. ✓：" + O.stripOptionLabel("A. $(1,3)$", 0));
  ok(O.stripOptionLabel("B. $[0,4]$", 1) === "$[0,4]$", "★第 1 项剥掉 B. ✓");
  ok(O.stripOptionLabel("C、$(1,4]$", 2) === "$(1,4]$", "顿号写法也认 ✓");
  ok(O.stripOptionLabel("D）$[0,3)$", 3) === "$[0,3)$", "全角括号写法也认 ✓");
  ok(O.stripOptionLabel("（A）甲", 0) === "甲", "★（A）这种也认 ✓");
  ok(O.stripOptionLabel("A：甲", 0) === "甲", "冒号写法也认 ✓");
  // ② 位置不符**不许剥** ✗（否则会把内容吃掉 ✓）
  ok(O.stripOptionLabel("B. 甲", 0) === "B. 甲", "★第 0 项写着 B. → 不动（可能是内容 ✓）");
  ok(O.stripOptionLabel("甲", 0) === "甲", "没标签 → 原样 ✓");
  ok(O.stripOptionLabel("A. B. 甲", 0) === "B. 甲", "★双层前缀只剥一层（A. B. 甲 → B. 甲 ✓）");
  ok(O.stripOptionLabel("A.", 0) === "A.", "整条只有标签 → 不剥成空 ✗");
  ok(O.stripOptionLabel("", 0) === "" && O.stripOptionLabel(null, 0) === "", "空 / null 不炸 ✓");
  ok(O.stripOptionLabel("4. 甲", 0) === "4. 甲", "数字开头的内容不动 ✓");
  // ③ 整排 ✓
  const list = O.stripOptionLabels(["A. 甲", "B. 乙", "丙", "D. 丁"]);
  ok(list.join("|") === "甲|乙|丙|丁", "★整排去重：" + list.join("|"));
  // ④ 试卷那边写出来的选项块**不再重复** ✓
  const C = loadBundled("aiPaper.ts", "_c40c.cjs");
  const blk = C.aiQuestionBlockOf({ stem: "设集合 M。", options: ["A. $(1,3)$", "B. $[0,4]$", "C. $(1,4]$", "D. $[0,3)$"], answer: "B", analysis: "画数轴", qtype: "choice", section: "", kp: [], level: "中档", difficulty: 3 }, 2);
  const optLines = blk.split(NL).filter(function (l) { return l.indexOf("．") === 1; });
  ok(blk.indexOf("A. A.") < 0 && blk.indexOf("B. B.") < 0, "★写出来的选项不再「A. A.」✓");
  ok(blk.indexOf("A．$(1,3)$") > 0 && blk.indexOf("D．$[0,3)$") > 0 && blk.indexOf("A．A.") < 0, "四个选项都是「字母＋全角点＋内容」，且不重复（A．$(1,3)$ ✓）");
  ok(optLines.length === 4, "选项正好四行（" + optLines.length + " ✓）");
  const blk2 = C.aiQuestionBlockOf({ stem: "题", options: ["(1,3)", "(0,4)"], answer: "A", analysis: "", qtype: "choice", section: "", kp: [], level: "中档", difficulty: 3 }, 1);
  ok(blk2.indexOf("A．(1,3)") > 0 && blk2.indexOf("B．(0,4)") > 0 && blk2.indexOf("A．A.") < 0, "本来没前缀的照常加字母（A．(1,3) ✓）");
}

console.log("=== 用例 39：选择题的「一行/两行/四行」（用户：它始终学不会 ✗ v1700）===");
{
  const C = loadBundled("aiPaperChat.ts", "_c39.cjs");
  const NL = String.fromCharCode(10);
  // ① 手册里必须**两条都写**：单题标记 + 整卷设置（以前只写了整卷 ✗ → 所以它学不会单题 ✗）
  const help = C.PAPER_HELP;
  ok(help.indexOf("[两行]") > 0 && help.indexOf("[一行]") > 0 && help.indexOf("[四行]") > 0, "★手册写了每题标记 [一行]/[两行]/[四行] ✓");
  ok(help.indexOf("[1行]") > 0 || help.indexOf("[2行]") > 0, "也认阿拉伯数字写法 ✓");
  ok(help.indexOf("optLayout") > 0 && help.indexOf("整卷") > 0, "★手册同时写了整卷的 optLayout，并说清两者区别 ✓");
  ok(help.indexOf("题干行") > 0 && help.indexOf("另起一行不生效") > 0, "★写明必须紧挨题干末尾（另起一行不生效 ✗）");
  // ② system 里点名"这道题 → 改那一题；整卷 → 才动 optLayout" ✓
  const sys = C.buildPaperChatSystem();
  ok(sys.indexOf("选项排成两行") > 0 && sys.indexOf("题干行末尾") > 0, "★system 说清单题改法 ✓");
  ok(sys.indexOf("只有说「整卷都…」才用") > 0, "★system 说清什么时候才改整卷设置 ✓");
  // ③ 大纲要能报出每题当前的排布（老师问「第 2 题几行」得答得上来 ✓）
  const doc = [
    "## 一、选择题",
    "1. 第一题（　）[两行]",
    "A. 甲　B. 乙　C. 丙　D. 丁",
    "2. 第二题（　）[4行]",
    "A. 甲　B. 乙　C. 丙　D. 丁",
    "3. 第三题（　）",
    "A. 甲　B. 乙　C. 丙　D. 丁",
  ].join(NL);
  const o = C.paperOutline(doc);
  ok(o.items[0].opt === "两行", "★第 1 题认出「两行」（实际：" + JSON.stringify(o.items[0].opt) + "）");
  ok(o.items[1].opt === "四行", "★第 2 题认得阿拉伯写法 [4行] → 四行 ✓");
  ok(o.items[2].opt === "", "第 3 题没标记 → 空（没瞎猜 ✗）");
  const brief = C.outlineText(o);
  ok(brief.indexOf("选项两行") > 0 && brief.indexOf("选项四行") > 0, "★大纲把排布报出来：" + brief.split(NL)[1]);
  ok(brief.indexOf("[两行]") < 0, "大纲里不重复带原始标记（省 token ✓，排布已单列 ✓）");
  // ④ 按题号给某题加标记 ✓（这就是"这道题排两行"的正确做法 ✓）
  const r = C.replacePaperQuestion(doc, 3, "3. 第三题（　）[两行]" + NL + "A. 甲　B. 乙　C. 丙　D. 丁");
  ok(r.ok === true, "按题号换掉第 3 题 ✓");
  const o2 = C.paperOutline(r.text);
  ok(o2.items[2].opt === "两行", "★换完后第 3 题的排布就是「两行」✓（其它题不动 ✓）");
  ok(o2.items[0].opt === "两行" && o2.items[1].opt === "四行", "第 1、2 题的排布没被带跑 ✓");
}

console.log("=== 用例 38：按题号办事（用户感受「笨」→ 给它大纲 ✓ v1699）===");
{
  const C = loadBundled("aiPaperChat.ts", "_c38.cjs");
  const NL = String.fromCharCode(10);
  const doc = [
    "# 某中学高三数学",
    "## 一、选择题",
    "1. 已知抛物线 y2=4x，求焦点。",
    "A. (1,0)　B. (0,1)",
    "2. 已知椭圆 C，求离心率。",
    "## 二、填空题",
    "3. 函数的最小正周期为____。",
  ].join(NL);
  const o = C.paperOutline(doc);
  ok(o.sections.length === 2, "认出两个大节：" + o.sections.map(function (s) { return s.title; }).join(" / "));
  ok(o.total === 3, "认出三道题 ✓");
  ok(o.items[0].no === 1 && o.items[0].section === "一、选择题", "第 1 题归到「一、选择题」✓");
  ok(o.items[0].startLine === 2 && o.items[0].endLine === 3, "第 1 题占第 3-4 行（题干 + 选项 ✓）实际 " + (o.items[0].startLine + 1) + "-" + (o.items[0].endLine + 1));
  ok(o.items[1].endLine === 4, "第 2 题在下一节开始前收尾（不吞填空题 ✓）");
  ok(o.items[0].head.indexOf("已知抛物线") === 0, "题干开头：" + o.items[0].head);
  const brief = C.outlineText(o);
  ok(brief.indexOf("第 2 题") > 0 && brief.indexOf("一、选择题") > 0, "大纲文字带题号与大节 ✓");
  ok(brief.indexOf("A. (1,0)") < 0, "★大纲不含选项正文（省 token ✓）");
  const r1 = C.replacePaperQuestion(doc, 2, "2. 已知双曲线 C，求渐近线。");
  ok(r1.ok === true && r1.text.indexOf("已知双曲线") > 0 && r1.text.indexOf("已知椭圆") < 0, "★按题号换掉第 2 题 ✓");
  ok(r1.text.indexOf("已知抛物线") > 0 && r1.text.indexOf("最小正周期") > 0, "其它题一字未动 ✓");
  ok(C.paperOutline(r1.text).items[1].head.indexOf("已知双曲线") === 0, "换完大纲也对得上 ✓");
  const r2 = C.replacePaperQuestion(doc, 9, "9. 新题");
  ok(r2.ok === false && r2.text === doc, "★题号不存在 → 原文原样返回（一个字都没改 ✓）");
  ok(r2.note.indexOf("没有第 9 题") > 0 && r2.note.indexOf("1、2、3") > 0, "回执说清现有题号：" + r2.note.slice(0, 36));
  const r3 = C.insertPaperQuestion(doc, 1, "1. 补充题：求准线。");
  ok(r3.ok === true, "在第 1 题后插入成功 ✓");
  const o3 = C.paperOutline(r3.text);
  ok(o3.total === 4 && o3.items[1].head.indexOf("补充题") >= 0, "★新题落在第 1 题之后（顺序对 ✓）：" + o3.items[1].head);
  ok(r3.text.indexOf("## 一、选择题") > 0 && r3.text.indexOf("## 二、填空题") > 0, "两个大节都还在 ✓");
  const block = ["## 三、解答题", "[题]", "6. 已知二次函数，求值。", "[解析]", "【答案】4", "[/题]", "7. 下一题。"].join(NL);
  const ob = C.paperOutline(block);
  ok(ob.total === 2, "★[题] 块也认（" + ob.total + " 道 ✓）");
  const rb = C.replacePaperQuestion(block, 6, "6. 换成新题。");
  ok(rb.ok && rb.text.indexOf("[题]") < 0 && rb.text.indexOf("7. 下一题。") > 0, "★换掉整块、下一题不受影响 ✓");
  ok(C.paperOutline("").total === 0, "空试卷 → 0 道（不炸 ✓）");
  ok(C.outlineText(C.paperOutline("")).indexOf("还没认出题目") > 0, "空卷大纲说清怎么写题号 ✓");
  ok(C.findQuestion(o, 3) === 2 && C.findQuestion(o, 99) === -1, "findQuestion ✓");
}

console.log("=== 用例 37：试卷侧栏的文档附件（用户要求「+文档 / 截图」✓ v1698）===");
{
  const C = loadBundled("aiPaperChat.ts", "_c37.cjs");
  const NL = String.fromCharCode(10);
  // ① 只带文档（不带图）→ 仍然是**纯字符串**（老口径不变 ✓），里面含文档正文与"这是参考材料"的说明 ✓
  const one = C.chatUserContent("挑三道题进试卷", [], [{ name: "试卷.pdf", chars: 12, text: "1. 已知抛物线 y^2=4x" }]);
  ok(typeof one === "string", "不带图 → 纯字符串 ✓");
  ok(one.indexOf("挑三道题进试卷") === 0, "老师的话在最前 ✓");
  ok(one.indexOf("1. 已知抛物线 y^2=4x") > 0, "文档正文带上了 ✓");
  ok(one.indexOf("参考文档") > 0 && one.indexOf("不是试卷正文") > 0, "★说清是参考材料、不是卷面（否则模型会拿它去改卷子 ✗）");
  ok(one.indexOf("试卷.pdf") > 0, "带文件名（模型知道是哪个附件 ✓）");
  // ② 带图 → 多模态数组，文档进 text 那一段 ✓
  const two = C.chatUserContent("看这张图", ["data:image/png;base64,AAA"], [{ name: "a.md", chars: 3, text: "题干" }]);
  ok(Array.isArray(two) && two[0].type === "text" && two[0].text.indexOf("题干") > 0, "★带图时文档进 text ✓");
  ok(two[1].image_url.url.indexOf("data:image") === 0, "图还是 image_url ✓");
  // ③ 截断：超长文档按 maxChars 剪掉 ✓（整本书塞进去会把上下文烧光 ✗）
  const long = "x".repeat(500);
  const cut = C.paperDocBlock([{ name: "书.txt", chars: 500, text: long }], 100);
  ok(cut.indexOf("已截断") > 0 && cut.length < 500, "★超长文档会截断（" + cut.length + " 字符 ✓）");
  // ④ 空文档不收 ✓（与图片口径一致 ✓）
  ok(C.paperDocBlock([]) === "" && C.paperDocBlock(undefined) === "", "没有文档 → 空串（不硬塞空块 ✓）");
  ok(C.paperDocBlock([{ name: "空", chars: 0, text: "   " + NL + "  " }]) === "", "只有空白的文档不算 ✓");
  ok(C.docCharsOf("  a b" + NL + "c ") === 3, "docCharsOf 只数非空白：" + C.docCharsOf("  a b" + NL + "c "));
  // ⑤ 没文档时与以前**完全一样** ✓（老行为不变 ✓）
  ok(C.chatUserContent("只说话", []) === "只说话", "不带附件 → 原样返回 ✓");
  // ⑥ 只带文档也能发 ✓（计数里含文档 ✓）
  ok(C.canSendPaperChat("", false, 1).ok === true, "★只丢一个文档也能发 ✓");
  ok(C.canSendPaperChat("", false, 0).ok === false, "什么都没有 → 不让发 ✓");
  // ⑦ system 里说清附件的性质 ✓
  const sys = C.buildPaperChatSystem();
  ok(sys.indexOf("附件") > 0 && sys.indexOf("由老师的话决定") > 0, "★system 说明：附件是参考，落不落卷由老师决定 ✓");
}

console.log("=== 用例 36：SVG 规范化（用户实报「转成 PNG 失败」✗ v1697）===");
{
  const N = loadBundled("svgNormalize.ts", "_c36.cjs");
  const count = (s, re) => (s.match(re) || []).length;
  // ① 组件渲出来的 svg **本来就带 width/height** ✗ —— 旧的字符串处理会再加一遍、变成重复属性 ✗
  const comp = '<svg width="640" height="420" viewBox="0 0 640 420" class="mf"><path d="M0 0"/></svg>';
  const a = N.normalizeSvgForRaster(comp, { pxW: 1200 });
  ok(count(a.svg, /\bwidth\s*=/g) === 1 && count(a.svg, /\bheight\s*=/g) === 1, "★width/height 各只剩一份（不再重复 ✗）");
  ok(count(a.svg, /viewBox\s*=/g) === 1 && count(a.svg, /xmlns\s*=/g) === 1, "★viewBox / xmlns 也各一份 ✓");
  ok(a.w === 640 && a.h === 420, "尺寸取原有 viewBox（" + a.w + "×" + a.h + "）✓");
  ok(a.k >= 2 && a.svg.indexOf('width="' + Math.round(640 * a.k) + '"') > 0, "外框像素 = viewBox × 倍率（k=" + a.k.toFixed(2) + "）✓");
  ok(a.svg.indexOf('<path d="M0 0"/>') > 0 && a.svg.indexOf('</svg>') > 0, "图形内容原样保留 ✓");
  // ② 没有 xmlns（Vue 在 HTML 里渲出来的 svg 序列化后常常没有 ✗）→ 必须补上 ✓，否则 data URL 不是合法 SVG ✗
  const noXmlns = '<svg viewBox="0 0 100 50"><circle r="5"/></svg>';
  ok(N.normalizeSvgForRaster(noXmlns).svg.indexOf('xmlns="http://www.w3.org/2000/svg"') > 0, "★缺 xmlns → 自动补上 ✓");
  // ③ 片段（没有外层 <svg> ✗，对话框给的就是这种 ✓）→ 自己包一层 ✓
  const frag = '<g><rect x="1" y="1" width="8" height="8"/></g>';
  const c = N.normalizeSvgForRaster(frag, { w: 480, h: 320 });
  ok(c.svg.indexOf('<svg ') === 0 && c.svg.indexOf('</svg>') > 0, "★片段被包成合法文档 ✓");
  ok(c.w === 480 && c.h === 320, "片段按传入尺寸定框（" + c.w + "×" + c.h + "）✓");
  // ④ 没有 viewBox → 用传入 w/h 造一个 ✓（不能写死 520×380 ✗ 会把圆拉成椭圆 ✓）
  const fb = N.normalizeSvgForRaster('<svg width="10" height="10"><path d="M0 0"/></svg>', { w: 300, h: 200 });
  ok(fb.svg.indexOf('viewBox="0 0 300 200"') > 0, "★没 viewBox → 按传入尺寸造 ✓");
  ok(N.viewBoxSize(fb.svg).w === 300, "viewBoxSize 能读回来 ✓");
  // ⑤ 坏输入不炸 ✓
  ok(N.normalizeSvgForRaster('').svg.indexOf('<svg ') === 0, "空串 → 给一个空的合法文档（不炸 ✓）");
  ok(N.viewBoxSize('没有 svg') === null, "viewBoxSize 对无 svg 的输入返回 null ✓：" + JSON.stringify(N.viewBoxSize('没有 svg')));
  ok(N.viewBoxSize('<svg viewBox="0 0 0 0"></svg>') === null, "★viewBox 宽高为 0 → 视为没有（否则画布 0 像素 ✗）");
}

console.log("=== 用例 35：插数学图形（用户实报：'插入抛物线'连着四次失败 ✗ v1696）===");
const CASE35 = (async () => {
  const AT = loadBundled("aiTools.ts", "_c35t.cjs");
  // ① 清单口径：**完整图形库**里必须有 parabola；旧的窄清单（只圆锥曲线）里没有它 ✗
  const kinds = AT.mathFigureKindList();
  ok(kinds.length >= 60, "★完整图形库共 " + kinds.length + " 种 ✓");
  ok(kinds.indexOf("parabola") >= 0 && kinds.indexOf("ellipse") >= 0 && kinds.indexOf("sine") >= 0, "★parabola / ellipse / sine 都在完整清单里 ✓");
  const narrow = AT.figureKinds();
  ok(narrow.indexOf("parabola") < 0 && narrow.length < kinds.length, "★旧的窄清单 figureKinds 只有 " + narrow.length + " 种、**不含** parabola —— 这就是用户那边失败的真正原因 ✓");
  const hint = AT.figureKindHint(40);
  ok(hint.indexOf("频率分布直方图") > 0, "可选清单带中文名 ✓：" + hint.slice(0, 46));
  ok(AT.figureKindHint(200).indexOf("parabola") > 0, "清单拉长就能看到 parabola（它在库里靠后 ✓）");
  ok(AT.mathFigureLabel("parabola").length > 0, "parabola 的中文名：" + AT.mathFigureLabel("parabola"));
  const base = { deck: { slides: [] }, currentIndex: 0, addElements: () => null, addSlide: () => {}, gotoSlide: () => {}, updateElement: () => {}, removeElement: () => {}, undo: () => {} };
  const mk = (figureImpl) => Object.assign({}, base, {
    paper: { state: () => ({ open: true, text: "" }), append: () => "ok", insertQuestion: async () => "", figure: figureImpl },
  });
  // ② 合法种类必须**过得去**（上一版会被校验拦掉 ✗）
  const pass = await AT.runAiTool("insert_paper_figure", { kind: "parabola", params: { p: 2 } }, mk(async () => "[图3]"));
  ok(pass.ok === true, "★parabola 现在能过了（实为 " + JSON.stringify(pass).slice(0, 90) + "）");
  ok(String(pass.result && pass.result.note).indexOf("[图3]") > 0, "回执带 [图N]：" + String(pass.result && pass.result.note));
  // ③ 真·不认识的种类 → 报错并回**完整清单** ✓
  const bad = await AT.runAiTool("insert_paper_figure", { kind: "这不是种类" }, mk(async () => "[图1]"));
  ok(bad.ok === false, "★乱写种类 → 失败 ✓");
  ok(String(bad.error).indexOf("不认识的图形种类") >= 0, "错误开头说清是种类不认：" + String(bad.error).slice(0, 40));
  ok(String(bad.error).indexOf("共 ") > 0 && String(bad.error).indexOf("、") > 0, "★错误里带完整可选清单（模型能照着改 ✓）");
  // ④ 后端返回的是**原因**（不是 [图N]）→ 原样转达 ✓（上一版吞掉了 ✗）
  const why = await AT.runAiTool("insert_paper_figure", { kind: "parabola" }, mk(async () => "图形没渲染出 SVG（种类 parabola；内部渲染器返回空）"));
  ok(why.ok === false, "★返回原因时 ok 必须是 false（实为 " + JSON.stringify(why).slice(0, 90) + "）");
  ok(String(why.error).indexOf("图形没渲染出 SVG") >= 0, "★真实原因原样转达：" + String(why.error).slice(0, 38));
  // ⑤ 缺 kind / 没有试卷接口 → 说清楚 ✓
  ok((await AT.runAiTool("insert_paper_figure", {}, mk(async () => "[图1]"))).ok === false, "缺 kind → 失败 ✓");
  const noCtx = await AT.runAiTool("insert_paper_figure", { kind: "parabola" }, base);
  ok(noCtx.ok === false && String(noCtx.error).indexOf("没有试卷插图接口") >= 0, "没有试卷接口 → 说清楚 ✓");
  // ⑥ 幻灯片那条路（insert_math_figure）也修了同一个老坑 ✓
  const slide = await AT.runAiTool("insert_math_figure", { kind: "parabola", params: { p: 2 } }, base);
  ok(slide.ok === true, "★幻灯片那条 insert_math_figure 也认 parabola 了 ✓（同一个老 bug ✓）");
})();

console.log("=== 用例 41：切图从「AI 助手」侧栏移植到试卷编辑（v1703）===");
const CASE41 = (async () => {
  const FC = loadBundled("figCrop.ts", "_c41f.cjs");
  // ① 批量口径抽成**共用**函数（两边一份实现，免得以后"改一处漏一处" ✗）
  ok(typeof FC.cropPicsToPreviews === "function" && typeof FC.cropNoteText === "function",
    "figCrop 导出共用口径 cropPicsToPreviews / cropNoteText");
  // ② 开关关掉（选"整张图"）→ 全给原图、不算裁过 ✓
  const off = await FC.cropPicsToPreviews(["a", "b"], false);
  ok(off.items.length === 2 && off.cropped === 0 && off.trimmed === 0 && off.kept === 2, "关掉「只切图形」→ 两张都按整张算");
  ok(off.items.every((it) => it.mode === "raw" && it.cut === it.raw), "★整张可用时 cut 就是原图（原样插 ✓）");
  const empty = await FC.cropPicsToPreviews([], true);
  ok(empty.items.length === 0 && empty.kept === 0, "空附件不炸（返回空 ✓）");
  // ③ 认不出图形（node 里连 canvas 都没有）也**不许抛**，退回原图 ✓
  const one = await FC.cropPicsToPreviews(["raw-x"], true);
  ok(one.items.length === 1 && one.items[0].mode === "raw" && one.items[0].cut === "raw-x",
    "认不出的图退回原图（mode=raw，不抛异常 ✓）：" + one.items[0].why);
  // ④ 结果说明：三档各自成句，都没有就空串 ✓
  const note = FC.cropNoteText({ cropped: 2, trimmed: 1, kept: 3 });
  ok(note.indexOf("2 张只留了图形部分") >= 0 && note.indexOf("1 张只去掉了白边") >= 0 && note.indexOf("3 张认不出图形") >= 0,
    "★切图结果三档都说清楚：" + note);
  ok(FC.cropNoteText({ cropped: 0, trimmed: 0, kept: 0 }) === "" && FC.cropNoteText(null) === "", "什么都没切 / 没传 → 空串（不印空括号 ✗）");
  // ⑤ 侧栏自己那份实现删掉，改成转调共用函数 ✓
  const side = fs.readFileSync(path.join(ROOT, "src", "components", "AiSidePanel.vue"), "utf8");
  ok(side.indexOf("cropPicsToPreviews(pics, onlyFigure.value)") >= 0, "★侧栏的 cutFigures 现在转调共用函数（不再是第二份实现 ✓）");
  ok(side.indexOf("cropToFigure(") < 0, "侧栏不再直接调 cropToFigure（唯一实现留在 figCrop ✓）");
  ok(side.indexOf("cropNoteText(cut)") >= 0, "侧栏的结果说明也用共用函数 ✓");
  // ⑥ 试卷侧栏真的接上了：按钮 → 切图 → 预览 → 插进试卷 ✓
  const paper = fs.readFileSync(path.join(ROOT, "src", "components", "AiPaperChat.vue"), "utf8");
  ok(paper.indexOf("./FigureCropDialog.vue") >= 0 && paper.indexOf("FigureCropDialog v-if=\"previewOpen\"") >= 0,
    "★试卷侧栏挂上了切图预览对话框（与侧栏同一个组件 ✓）");
  ok(paper.indexOf("@click=\"cutToPaper\"") >= 0 && paper.indexOf("切图 → 试卷") >= 0, "★工具栏有「切图 → 试卷」按钮");
  ok(paper.indexOf("cropPicsToPreviews(pics, onlyFigure.value)") >= 0, "试卷这边同样按「只切图形」开关走 ✓");
  ok(paper.indexOf("previewToPics(chosen)") >= 0, "★插的是**切好的结果**（previewToPics(chosen)），不是原图 ✗");
  ok(paper.indexOf("props.insertImage(p.src") >= 0, "★切完直接进试卷（走 PaperModal 的 insertImage → 进图片库 + 给 [图N] ✓）");
  ok(paper.indexOf("已取消，什么都没插") >= 0, "预览里点取消 → 什么都不插 ✓");
  ok(paper.indexOf("lj-mathslides:fig-preview") >= 0 && paper.indexOf("lj-mathslides:fig-only") >= 0,
    "★与侧栏共用「以后不再问 / 只切图形」两个设置（在哪边改都算数 ✓）");
})();
console.log("=== 用例 43：讲义 AI（工具 19 个 / 22 种块 + 手册 + 纯函数 + 接线 ✓ v1707）===");
const CASE43 = (async () => {
  const H = loadBundled("aiHandoutChat.ts", "_c43.cjs");
  const NL = String.fromCharCode(10);
  ok(H.HANDOUT_BLOCK_TYPES.length === 22, "讲义块类型 22 种（" + H.HANDOUT_BLOCK_TYPES.length + " ✓）");
  ok(H.HANDOUT_TOOL_NAMES.length === 19, "讲义工具 19 个（" + H.HANDOUT_TOOL_NAMES.length + " ✓）");
  ok(String(H.HANDOUT_HELP).length > 1500, "手册够长（" + String(H.HANDOUT_HELP).length + " 字 ✓）");
  ok(String(H.buildHandoutChatSystem()).length > 400, "system 提示词在（" + String(H.buildHandoutChatSystem()).length + " 字 ✓）");
  const uh = fs.readFileSync(path.join(ROOT, "src", "composables", "useHandout.ts"), "utf8");
  const labelBody = uh.slice(uh.indexOf("export const HD_LABEL"), uh.indexOf("}", uh.indexOf("export const HD_LABEL")));
  const miss = H.HANDOUT_BLOCK_TYPES.filter(function (t) { return labelBody.indexOf(t + ":") < 0 });
  ok(miss.length === 0, "★块类型与 useHandout.HD_LABEL 一一对应（差的：" + (miss.join("、") || "无") + " ✓）");
  const pressBody = uh.slice(uh.indexOf("export const HD_PRESSES"), uh.indexOf("]", uh.indexOf("export const HD_PRESSES")));
  const bookBody = uh.slice(uh.indexOf("export const HD_BOOKS"), uh.indexOf("]", uh.indexOf("export const HD_BOOKS")));
  const pressMiss = H.HANDOUT_PRESSES.filter(function (x) { return pressBody.indexOf(x) < 0 });
  const bookMiss = H.HANDOUT_BOOKS.filter(function (x) { return bookBody.indexOf(x) < 0 });
  ok(pressMiss.length === 0 && bookMiss.length === 0, "★教材版本 / 册与 useHandout 一致（差的：" + (pressMiss.concat(bookMiss).join("、") || "无") + " ✓）");
  const renderMiss = H.HANDOUT_RENDERS.filter(function (r) { return uh.indexOf("'" + r + "'") < 0 });
  ok(renderMiss.length === 0, "★显示口径（inline/hide/blank/endnote）与 useHandout 一致 ✓");
  const helpMiss = H.HANDOUT_BLOCK_TYPES.filter(function (t) { return String(H.HANDOUT_HELP).indexOf(H.HANDOUT_BLOCK_LABEL[t]) < 0 });
  ok(helpMiss.length === 0, "★手册里每种块都有说法（差的：" + (helpMiss.join("、") || "无") + " ✓）");
  const metaMiss = H.HANDOUT_META_KEYS.filter(function (k) { return String(H.HANDOUT_HELP).indexOf(k) < 0 });
  ok(metaMiss.length === 0, "★手册里每个教材定位字段都有（差的：" + (metaMiss.join("、") || "无") + " ✓）");
  ok(String(H.HANDOUT_HELP).indexOf("学生版") > 0 && String(H.HANDOUT_HELP).indexOf("教师版") > 0, "手册写了学生版 / 教师版 ✓");
  ok(String(H.HANDOUT_HELP).indexOf("自动编号") > 0, "手册写了例题/变式/练习自动编号 ✓");
  ok(String(H.HANDOUT_HELP).indexOf("试卷语法") > 0, "★手册写清「不认试卷语法」✗（否则模型会拿 [题] / [分页] 硬套 ✓）");
  ok(String(H.HANDOUT_HELP).indexOf("别把答案删掉") > 0 || String(H.buildHandoutChatSystem()).indexOf("别把答案删掉") > 0, "★学生版藏答案要改口径、不许删 ✓");
  const at = fs.readFileSync(path.join(ROOT, "src", "composables", "aiTools.ts"), "utf8");
  const noDecl = H.HANDOUT_TOOL_NAMES.filter(function (n) { return at.indexOf("name: '" + n + "'") < 0 });
  ok(noDecl.length === 0, "★19 个工具都在 AI_TOOLS 里声明了（差的：" + (noDecl.join("、") || "无") + " ✓）");
  const noCase = H.HANDOUT_TOOL_NAMES.filter(function (n) { return n !== "search_bank" && at.indexOf("case '" + n + " ':") < 0 && at.indexOf("case '" + n + "':") < 0 });
  ok(noCase.length === 0, "★19 个工具都有执行分支（差的：" + (noCase.join("、") || "无") + " ✓）");
  ok(at.indexOf("handout?: {") > 0, "AiToolCtx 里有 handout 适配器 ✓");
  const good = H.handoutBlockSpecs([{ type: "h1", text: "二、椭圆" }, { type: "example", text: "已知…" }]);
  ok(good.specs.length === 2 && good.errors.length === 0, "两个合法块 → 原样收下 ✓");
  const badType = H.handoutBlockSpecs([{ type: "tihao", text: "x" }]);
  ok(badType.specs.length === 0 && badType.errors.length === 1, "★认不出的块类型 → 不收 + 说清（" + badType.errors[0].slice(0, 24) + "…）");
  const noText = H.handoutBlockSpecs([{ type: "para" }]);
  ok(noText.specs.length === 0 && noText.errors.length === 1, "★正文为空的正文块 → 不收 ✓");
  const pageOk = H.handoutBlockSpecs([{ type: "pagebreak" }]);
  ok(pageOk.specs.length === 1 && pageOk.errors.length === 0, "分页块可以不带正文 ✓");
  const blankOk = H.handoutBlockSpecs([{ type: "blank", blankCm: 99 }, { type: "blank", blankCm: 0 }, { type: "blank" }]);
  ok(blankOk.specs.length === 3 && blankOk.specs[0].blankCm === 20 && blankOk.specs[1].blankCm === 1 && blankOk.specs[2].blankCm === 4,
    "★留白高度夹到 1–20cm（" + blankOk.specs.map(function (s) { return s.blankCm }).join(" / ") + " ✓）");
  const rendOk = H.handoutBlockSpecs([{ type: "answer", text: "x", render: { student: "endnote", teacher: "inline" } }]);
  ok(rendOk.specs.length === 1 && rendOk.specs[0].render.student === "endnote", "显示口径能带进来（student=endnote ✓）");
  const rendBad = H.handoutBlockSpecs([{ type: "answer", text: "x", render: { student: "none" } }]);
  ok(rendBad.specs.length === 1 && rendBad.errors.length === 1 && !rendBad.specs[0].render, "★认不出的口径 → 丢掉并说清 ✓");
  ok(H.handoutBlockSpecs(null).errors.length === 1, "blocks 不是数组 → 说清 ✓");
  const many = H.handoutBlockSpecs(new Array(80).fill({ type: "para", text: "x" }));
  ok(many.specs.length === 60, "★一次最多 60 块（给了 80 → 收 60 ✓）");
  const mp = H.handoutMetaPatch({ press: "人教版", chapter: "3", autoTitle: true });
  ok(Object.keys(mp.patch).length === 3 && mp.patch.press === "人教版" && mp.patch.autoTitle === true && !mp.errors.length, "合法字段原样收下 ✓");
  ok(H.handoutMetaPatch({ press: "人教版xx" }).errors.length === 1, "★press 只认清单里的 ✓");
  ok(H.handoutMetaPatch({ book: "必修九" }).errors.length === 1, "★book 只认清单里的 ✓");
  ok(Object.keys(H.handoutMetaPatch({ nope: "x" }).patch).length === 0, "★认不出的键不收 ✓");
  ok(H.handoutMetaPatch({}).errors.length === 1, "一个字段都没给 → 说清 ✓");
  const ot = H.handoutOutlineText([{ no: 1, type: "h1", text: "一、知识梳理" }, { no: 2, type: "blank", text: "" }]);
  ok(ot.indexOf("#1 [章标题]") === 0 && ot.indexOf("#2 [留白]") > 0, "大纲带块号与类型：" + ot.split(NL)[0]);
  ok(H.handoutOutlineText([]).indexOf("空的") > 0, "空讲义说清 ✓");
  const hd = fs.readFileSync(path.join(ROOT, "src", "components", "HandoutModal.vue"), "utf8");
  ok(hd.indexOf("handoutOpsSink.value = handoutOps") > 0 && hd.indexOf("handoutOpsSink.value = null") > 0, "★打开时登记 / 关掉时清空 ✓");
  ok(hd.indexOf("const handoutOps: HandoutOps = {") > 0, "能力对象按 HandoutOps 接口实现 ✓");
  ok(hd.indexOf("<AiHandoutChat :insert-image=\"insertImageForAi\" />") > 0, "★AI 面板挂进了讲义窗口 ✓");
  ok(hd.indexOf("@click=\"toggleAi\"") > 0 && hd.indexOf(".hd__body--ai {") > 0, "★工具栏有「AI 助手」按钮 + 多一列 ✓");
  ok(hd.indexOf(".hd__ai, .hd__foot { display: none !important; }") > 0, "★打印时 AI 那一列隐藏 ✓（别印到讲义上 ✗）");
  ok(hd.indexOf("if (aiOpen.value) { aiOpen.value = false; return }") > 0, "Esc 先关 AI 面板再关窗口 ✓");
  ok(hd.indexOf("if (drawer.value) aiOpen.value = false") > 0, "抽屉与 AI 面板互斥（都只占第 4 列 ✓）");
  const panel = fs.readFileSync(path.join(ROOT, "src", "components", "AiHandoutChat.vue"), "utf8");
  ok(panel.indexOf("handoutToolsOf(AI_TOOLS)") > 0, "★面板只给它讲义那 19 个工具 ✓");
  ok(panel.indexOf("buildHandoutChatSystem()") > 0, "面板用讲义的 system ✓");
  ok(panel.indexOf("handoutOpsSink.value") > 0, "面板的能力来自讲义的登记对象 ✓");
  ok(panel.indexOf("插成插图") > 0, "附件能插成插图块 ✓");
})();
console.log("=== 用例 44：讲义 AI 的「训练材料」（容错 / 示例 / 评分 ✓ v1708）===");
const CASE44 = (async () => {
  const T = loadBundled("aiHandoutTrain.ts", "_c44t.cjs");
  const H = loadBundled("aiHandoutChat.ts", "_c44h.cjs");
  const NL = String.fromCharCode(10);
  // ① 容错：模型爱写中文块名 / 单对象 / content 字段 / 字符串口径 ✓
  ok(T.guessBlockType("例题") === "example" && T.guessBlockType("h2") === "h2" && T.guessBlockType("章") === "h1", "中文块名 / 英文键都认 ✓");
  ok(T.guessBlockType("知识梳理") === "knowledge" && T.guessBlockType("易错") === "warn" && T.guessBlockType("留白") === "blank", "常用中文标签认全 ✓");
  ok(T.guessBlockType("瞎写的") === "", "认不出的 → 空串（交给下游报错 ✓）");
  ok(T.guessRender("隐藏") === "hide" && T.guessRender("endnote") === "endnote" && T.guessVersion("学生版") === "student", "口径 / 版本的中文别名认 ✓");
  ok(T.guessKind("练习") === "exercise" && T.guessKind("") === "example" && T.guessAction("删掉") === "remove", "题库口径 / 块动作的中文别名认 ✓");
  const one = T.handoutBlockSpecsLoose({ type: "例题", content: "已知椭圆…" });
  ok(one.specs.length === 1 && one.specs[0].type === "example" && one.specs[0].text === "已知椭圆…", "★单个对象 + 中文块名 + content 字段 → 都捋顺（" + one.fixed.length + " 处修正 ✓）");
  const strOne = T.handoutBlockSpecsLoose("就是一段话");
  ok(strOne.specs.length === 1 && strOne.specs[0].type === "para", "纯字符串当成正文块 ✓");
  const rend = T.handoutBlockSpecsLoose([{ type: "answer", text: "x", render: "隐藏" }]);
  ok(rend.specs.length === 1 && rend.specs[0].render && rend.specs[0].render.student === "hide", "★render 写成字符串「隐藏」也认（两版都设 ✓）");
  const badStill = T.handoutBlockSpecsLoose([{ type: "乱写", text: "x" }]);
  ok(badStill.specs.length === 0 && badStill.errors.length === 1, "★真认不出的还是挡住 + 说清 ✓（宽松 ≠ 放水 ✗）");
  // ② 容错：正文里混了 Markdown / 试卷语法 → 拆块 + 说明 ✓
  const sp = T.splitHandoutText("# 一、知识梳理" + NL + "椭圆的第一定义…" + NL + "## 二、例题" + NL + "[分页]" + NL + "正文");
  const types = sp.blocks.map(function (b) { return b.type }).join(",");
  ok(types === "h1,para,h2,pagebreak,para", "★Markdown 标题 / [分页] 拆成讲义块：" + types);
  ok(sp.notes.length === 0, "干净的 Markdown 不用啰嗦 ✓（标题与 [分页] 本来就能认 ✓）");
  const sp2 = T.splitHandoutText("[题]" + NL + "1. 已知椭圆…" + NL + "[选项]" + NL + "A. 1" + NL + "[/题]" + NL + "{c:red} 强调");
  ok(sp2.notes.join("").indexOf("试卷语法") >= 0 && sp2.notes.join("").indexOf("段落样式") >= 0, "★试卷语法与 {c:red} 都清掉并说明：" + sp2.notes.length + " 条");
  ok(sp2.blocks.length > 0 && sp2.blocks.every(function (b) { return H.HANDOUT_BLOCK_TYPES.indexOf(b.type) >= 0 }), "清完剩下的都是合法块类型 ✓");
  const loud = T.handoutBlockSpecsLoose([{ type: "para", text: "# 一、章" + NL + "正文" + NL + "## 一节" }]);
  ok(loud.specs.length === 3 && loud.fixed.length >= 1, "★一整段 Markdown → 一块变三块（并记下改了什么 ✓）");
  // ③ 用例集：24+ 条，覆盖全部 17 个工具，工具名 / 禁用名都真存在 ✓
  const cases = T.HANDOUT_TRAIN_CASES;
  ok(cases.length >= 24, "训练用例 " + cases.length + " 条 ✓");
  const unknown = cases.filter(function (c) { return H.HANDOUT_TOOL_NAMES.indexOf(c.tool) < 0 });
  ok(unknown.length === 0, "★每条期望的工具都真存在（可疑：" + (unknown.map(function (c) { return c.id }).join("、") || "无") + " ✓）");
  const badForbid = [];
  cases.forEach(function (c) { (c.forbid || []).forEach(function (f) { if (H.HANDOUT_TOOL_NAMES.indexOf(f) < 0) badForbid.push(c.id + ":" + f) }) });
  ok(badForbid.length === 0, "禁用名单里的工具也都真存在 ✓");
  const covered = H.HANDOUT_TOOL_NAMES.filter(function (n) { return cases.some(function (c) { return c.tool === n }) });
  ok(covered.length === H.HANDOUT_TOOL_NAMES.length, "★19 个工具**每个**都有用例盯着（缺：" + (H.HANDOUT_TOOL_NAMES.filter(function (n) { return covered.indexOf(n) < 0 }).join("、") || "无") + " ✓）");
  // ④ 打分器：喂对的得满分、喂空的 0 分、喂禁用动作扣分 ✓（评分器自己也要能被验 ✓）
  let full = 0, zero = 0, forb = 0;
  cases.forEach(function (c) {
    const good = T.scoreHandoutCase(c, [T.standardCall(c)]);
    if (good.score === 1 && good.ok) full++;
    if (T.scoreHandoutCase(c, []).score === 0) zero++;
    if (c.forbid && c.forbid.length) {
      const bad = T.scoreHandoutCase(c, [T.standardCall(c), { name: c.forbid[0], args: {} }]);
      if (!bad.ok && bad.score < 0.8) forb++;
    }
  });
  ok(full === cases.length, "★每条喂「标准答案」都满分（" + full + "/" + cases.length + " ✓）");
  ok(zero === cases.length, "★每条规定「什么都不调」得 0 分 ✓");
  const withForbid = cases.filter(function (c) { return c.forbid && c.forbid.length }).length;
  ok(forb === withForbid && withForbid > 0, "★「顺手删块」这种会被扣分并判不过（" + forb + "/" + withForbid + " ✓）");
  const wrong = T.scoreHandoutCase(cases[0], [{ name: "print_handout", args: {} }]);
  ok(wrong.score === 0 && wrong.why.indexOf("没调") >= 0, "调错工具 → 0 分并说清：" + wrong.why);
  const run = T.scoreHandoutRun(cases, cases.map(function (c) { return [T.standardCall(c)] }));
  ok(run.total === 100 && run.passed === cases.length, "整轮满分（" + run.total + " 分 / " + run.passed + " 题达标 ✓）");
  ok(T.handoutTrainReport(run, cases).indexOf("训练报告") >= 0, "能出人看的报告 ✓");
  // 【v1710】真机实测：模型给的是**块对象数组**、还常多给一块 ✗ → 判定要按类型名前缀比 ✓
  const shaped = T.scoreHandoutCase(
    { id: "x", ask: "加一节", tool: "add_handout_blocks", args: { blocks: ["h2"] }, why: "" },
    [{ name: "add_handout_blocks", args: { blocks: [{ type: "h2", text: "二、椭圆" }, { type: "para", text: "…" }] } }],
  );
  ok(shaped.score === 1, "★模型给对象数组 + 多一块 → 也算对（" + shaped.why + "）");
  const offType = T.scoreHandoutCase(
    { id: "y", ask: "加一节", tool: "add_handout_blocks", args: { blocks: ["h2"] }, why: "" },
    [{ name: "add_handout_blocks", args: { blocks: [{ type: "para", text: "x" }] } }],
  );
  ok(offType.score < 1, "★块类型给错了 → 照样扣分（" + offType.why + "）");
  // 【v1710】同样合理的另一条路（altTools）→ 也算达标 ✓
  const alt = T.scoreHandoutCase(
    { id: "z", ask: "再来一道例题", tool: "add_handout_blocks", args: { blocks: ["example"] }, altTools: ["insert_bank_question_to_handout"], why: "" },
    [{ name: "search_bank", args: {} }, { name: "insert_bank_question_to_handout", args: { id: 123, kind: "example" } }],
  );
  ok(alt.score === 1 && alt.why.indexOf("同样合理") >= 0, "★走了同样合理的另一条路也算达标（" + alt.why + "）");
  // ⑤ 示例：写进 system，且每条都提到真工具 ✓
  ok(H.HANDOUT_FEWSHOT.length >= 8, "few-shot 示例 " + H.HANDOUT_FEWSHOT.length + " 条 ✓");
  const sys = String(H.buildHandoutChatSystem());
  ok(sys.indexOf("照着这些例子做") > 0, "★示例真的进了 system ✓");
  const toolHit = H.HANDOUT_TOOL_NAMES.filter(function (n) { return sys.indexOf(n) >= 0 || String(H.HANDOUT_HELP).indexOf(n) >= 0 });
  ok(toolHit.length >= 12, "★system + 手册里提到了 " + toolHit.length + "/" + H.HANDOUT_TOOL_NAMES.length + " 个工具 ✓");
  // ⑥ 接线：工具层真的走宽松校验 / 中文别名 ✓
  const at = fs.readFileSync(path.join(ROOT, "src", "composables", "aiTools.ts"), "utf8");
  ok(at.indexOf("handoutBlockSpecsLoose(args.blocks)") > 0, "★add_handout_blocks 走宽松校验 ✓");
  ok(at.indexOf("guessRender(args.render), guessVersion(args.version)") > 0 && at.indexOf("guessAction(args.action)") > 0 && at.indexOf("guessKind(args.pool)") > 0,
    "★四个枚举参数都吃中文别名 ✓");
})();

console.log("=== 用例 45：讲义「导入 MD」（v1710）===");
const CASE45 = (async () => {
  const MD = loadBundled("useHandoutMd.ts", "_c45.cjs");
  const H = loadBundled("aiHandoutChat.ts", "_c45h.cjs");
  const NL = String.fromCharCode(10);
  const md = [
    "# 椭圆的切线问题",
    "## 本节目标",
    "- 会用切线长与半径垂直处理问题",
    "## 一、知识梳理",
    "**定义：** 过椭圆上一点的切线…",
    "## 例题精讲",
    "例1 已知椭圆 C：x²/9+y²/4=1，P 为 C 外一点…",
    "$$x^{2}+y^{2}=13$$",
    "## 当堂练习",
    "1. 求椭圆 x²/16+y²/9=1 的切线方程。",
    "## 本章小结",
    "本节课复习了切线问题。",
    "---",
    "| 项目 | 值 |",
    "| --- | --- |",
    "![示意图](pic.png)",
  ].join(NL);
  const r = MD.mdBlocksOf("3.1-椭圆的切线.md", md);
  const types = r.blocks.map(function (b) { return b.type });
  ok(r.title === "椭圆的切线问题", "md 的 # 标题 → 讲义标题（" + r.title + " ✓）");
  ok(types.indexOf("knowledge") >= 0, "## 一、知识梳理 → knowledge 知识梳理块（v1713 起认栏目名 ✓）");
  ok(types.indexOf("goal") >= 0, "## 本节目标 → goal 学习目标 ✓");
  ok(types.indexOf("knowledge") >= 0, "**定义：** → knowledge 知识梳理 ✓");
  ok(types.indexOf("example") >= 0, "## 例题精讲 → example 例题 ✓");
  ok(types.indexOf("exercise") >= 0, "## 当堂练习 → exercise 练习 ✓");
  ok(types.indexOf("summary") >= 0, "## 本章小结 → summary 小结 ✓");
  ok(types.indexOf("formula") >= 0, "★$$…$$ → formula 公式块 ✓");
  const body = r.blocks.map(function (b) { return String(b.text || "") }).join(NL);
  ok(types.indexOf("figure") >= 0 && body.indexOf("【图：") < 0, "★图片插成插图块（图注 = 方括号里的字 ✓ v1713）");
  ok(body.split(NL).indexOf("---") < 0, "分隔线不进正文 ✓（表格分隔行不算 ✗）");
  ok(r.notes.join("").indexOf("表格") >= 0 && r.notes.join("").indexOf("图") >= 0, "表格 / 图片都给了说明（" + r.notes.length + " 条 ✓）");
  ok(MD.mdBlocksOf("空的.md", "").blocks.length === 0, "空 md → 0 块（不炸 ✓）");
  const only = MD.mdBlocksOf("只有标题.md", "# 只有标题");
  ok(only.blocks.length === 0 && only.title === "只有标题", "只有标题 → 0 块但拿到标题 ✓");
  const hd = fs.readFileSync(path.join(ROOT, "src", "components", "HandoutModal.vue"), "utf8");
  ok(hd.indexOf("导入 MD") > 0 && hd.indexOf("importMdInto") > 0, "★工具栏有「导入 MD」+ 处理函数 ✓");
  ok(hd.indexOf("mdBlocksOf(f.name") > 0, "★用的是与库导入同一个解析器 ✓");
  ok(hd.indexOf("importMarkdown: (markdown, where, afterNo) => {") > 0, "AI 也能导入（ops.importMarkdown ✓）");
  const at = fs.readFileSync(path.join(ROOT, "src", "composables", "aiTools.ts"), "utf8");
  ok(at.indexOf("name: 'import_handout_markdown'") > 0 && at.indexOf("case 'import_handout_markdown':") > 0, "★AI 工具声明 + 分支都在 ✓");
  ok(H.HANDOUT_TOOL_NAMES.indexOf("import_handout_markdown") >= 0, "工具白名单里有它（现在 " + H.HANDOUT_TOOL_NAMES.length + " 个 ✓）");
  ok(String(H.HANDOUT_HELP).indexOf("import_handout_markdown") > 0, "手册里写了它 ✓");
  ok(String(H.buildHandoutChatSystem()).indexOf("import_handout_markdown") > 0, "system 示例里也提了 ✓");
})();
console.log("=== 用例 46：GGB 套件「贴图解题作图」（v1711）===");
const CASE46 = (async () => {
  const G = loadBundled("ggbSolve.ts", "_c46.cjs");
  const NL = String.fromCharCode(10);
  ok(G.GGB_TOOLS.length >= 20, "工具表 " + G.GGB_TOOLS.length + " 条（含切工具用的 mode 号 ✓）");
  ok(G.ggbToolOf("point").mode === 1 && G.ggbToolOf("线段").mode === 3, "英文 key / 中文说法都认 ✓");
  ok(G.ggbToolOf("圆心+半径").key === "circle_radius", "★长的中文说法优先（不被「圆」抢走 ✓）");
  ok((G.ggbToolOf("画个垂线") || {}).key === "perpendicular", "带修饰的说法也认（画个垂线 ✓）");
  ok(G.ggbToolOf("神仙工具") === null, "认不出 → null（调用方好说清 ✓）");
  const menu = G.ggbToolMenu();
  ok(G.GGB_TOOLS.every(function (t) { return menu.indexOf(t.key) >= 0 }), "★每个工具都写进了 system 菜单 ✓");
  const sys = G.ggbSolveSystem();
  ok(sys.indexOf("只输出 JSON") > 0 && sys.indexOf("solution") > 0 && sys.indexOf("steps") > 0, "system 把输出格式写死 ✓");
  ok(sys.indexOf("不是 JS") > 0, "★说清用 GeoGebra 原生指令、不用 JS ✓");
  ok(sys.indexOf("别都堆在原点") > 0, "★要求坐标照题目数量关系取 ✓");
  const good = JSON.stringify({ solution: "由定义得 |OP|²=13。", steps: [{ tool: "point", cmd: "O=(0,0)", say: "建原点" }, { tool: "circle_radius", cmd: "Circle(O,3.6)", say: "作圆" }] });
  const p1 = G.ggbSolvePlan(good);
  ok(p1.steps.length === 2 && p1.steps[0].mode === 1 && p1.steps[1].mode === 7 && !p1.notes.length, "★合法 JSON → 两步、mode 都对、无多余提示");
  ok(G.ggbSolvePlan("```json" + NL + good + NL + "```").steps.length === 2, "带代码块也认 ✓");
  const loose = "{ solution: \"略\", steps: [ { tool: \"point\", cmd: \"A=(1,0)\" }, { tool: \"segment\", cmd: \"Segment(A,B)\" } ] }";
  const p2 = G.ggbSolvePlan(loose);
  ok(p2.steps.length === 2 && p2.notes.join("").indexOf("抠出来") >= 0, "★JSON 不合法 → 按 cmd 抠出来（" + p2.steps.length + " 步 ✓）");
  const p3 = G.ggbSolvePlan(JSON.stringify({ solution: "x", steps: [{ tool: "神仙工具", cmd: "A=(0,0)" }] }));
  ok(p3.steps.length === 1 && p3.steps[0].mode === -1 && p3.notes.join("").indexOf("认不出的工具") >= 0, "★认不出的工具：不切工具但指令照跑 ✓");
  const p4 = G.ggbSolvePlan(JSON.stringify({ solution: "x", steps: [{ tool: "point", cmd: "" }, { cmd: "Segment(A,B)" }] }));
  ok(p4.steps.length === 1 && p4.notes.join("").indexOf("只有工具没有指令") >= 0, "★空指令丢掉并提示 ✓");
  ok(G.ggbSolvePlan(JSON.stringify({ solution: "x", steps: new Array(80).fill({ cmd: "A=(0,0)" }) })).steps.length === 60, "★最多 60 步 ✓");
  const junk = G.ggbSolvePlan("我只会画个圆。");
  ok(junk.steps.length === 0 && junk.solution.length > 0 && junk.notes.length > 0, "★完全不是 JSON：原文留着 + 提示 ✓");
  ok(G.ggbSolvePlan(null).steps.length === 0, "null 不炸 ✓");
  const lines = G.ggbStepLines(p1);
  ok(lines.length === 4 && lines[0].indexOf("切换工具：点") === 0, "步骤摘要第一行 = " + lines[0]);
  const ui = fs.readFileSync(path.join(ROOT, "src", "components", "GgbSuite.vue"), "utf8");
  ok(ui.indexOf("贴图解题作图") > 0 && ui.indexOf("solveAndDraw") > 0, "★面板 + 按钮都在 ✓");
  ok(ui.indexOf("＋ 题目图") > 0 && ui.indexOf("onSolvePaste") > 0 && ui.indexOf("ScreenshotCapture") > 0, "★导入图 / 粘贴 / 截图 三条路都有 ✓");
  const execSrc = fs.readFileSync(path.join(ROOT, "src", "composables", "ggbExec.ts"), "utf8");
  ok(execSrc.indexOf("setMode(s.mode)") > 0 && execSrc.indexOf("evalCommand(s.cmd)") > 0, "★真切工具 + 真作图（v1735 起在 ggbExec.ts ✓）");
  ok(ui.indexOf("execSolveSteps(") > 0, "★面板确实走执行层（execSolveSteps ✓）");
  ok(ui.indexOf("ai_chat_raw") > 0 && ui.indexOf("solveVisionModel()") > 0, "走 AI 通道，带图用视觉模型 ✓");
  ok(ui.indexOf("解题过程") > 0 && ui.indexOf("solveLog") > 0, "界面上有解题过程与步骤日志 ✓");
})();
console.log("=== 用例 47：讲义体例补全（22 种块 + 课型骨架 + 挖空 + 学生版抬头 ✓ v1712）===");
const CASE47 = (async () => {
  const H = loadBundled("aiHandoutChat.ts", "_c47.cjs");
  const T = loadBundled("aiHandoutTrain.ts", "_c47t.cjs");
  const MD = loadBundled("useHandoutMd.ts", "_c47m.cjs");
  const NL = String.fromCharCode(10);
  const uh = fs.readFileSync(path.join(ROOT, "src", "composables", "useHandout.ts"), "utf8");
  const hd = fs.readFileSync(path.join(ROOT, "src", "components", "HandoutModal.vue"), "utf8");
  const at = fs.readFileSync(path.join(ROOT, "src", "composables", "aiTools.ts"), "utf8");
  const NEW5 = ["preview", "explore", "method", "homework", "reflect"];
  ok(H.HANDOUT_BLOCK_TYPES.length === 22, "讲义块类型 22 种（" + H.HANDOUT_BLOCK_TYPES.length + " ✓）");
  const miss = NEW5.filter(function (t) { return H.HANDOUT_BLOCK_TYPES.indexOf(t) < 0 });
  ok(miss.length === 0, "★新增 5 种栏目块都在（预习 / 探究 / 方法 / 作业 / 反思 ✓）");
  const missLab = NEW5.filter(function (t) { return uh.indexOf(t + ": '") < 0 });
  ok(missLab.length === 0, "★每种新块都有中文标签（差的：" + (missLab.join("、") || "无") + " ✓）");
  const missRender = NEW5.filter(function (t) { return uh.indexOf(NL + "  " + t + ": { student:") < 0 });
  ok(missRender.length === 0, "★每种新块都有两版默认口径（差的：" + (missRender.join("、") || "无") + " ✓）");
  const missBox = NEW5.filter(function (t) { return uh.indexOf("if (t === '" + t + "')") < 0 });
  ok(missBox.length === 0, "★pageHtmlOf 里每种新块都有渲染分支（差的：" + (missBox.join("、") || "无") + " ✓）");
  ok(uh.indexOf("hd-pname") > 0 && uh.indexOf("v === 'student') L.push") > 0, "★姓名 / 班级 / 学号行只在学生版出现 ✓");
  const CLS = ["hd-bx--pre", "hd-bx--exp", "hd-bx--met", "hd-bx--hw", "hd-bx--ref", ".hd-fill", ".hd-pname"];
  const missCls = CLS.filter(function (x) { return hd.indexOf(x) < 0 });
  ok(missCls.length === 0, "★新框 / 挖空 / 学生版抬头的样式都在（差的：" + (missCls.join("、") || "无") + " ✓）");
  ok(uh.indexOf("export function hdFillOut") > 0 && uh.indexOf("hdFillOut(hdEsc(it.show), v)") > 0, "★正文渲染走挖空（学生版空线 / 教师版原词 ✓）");
  ok(uh.indexOf("export function hdFillText") > 0 && uh.indexOf("export function hdPlain") > 0, "★导出文本 / 摘要也认挖空标记 ✓");
  ok(hd.indexOf("hdPlain(String(b.text") > 0, "★块列表摘要不显示花括号标记 ✓");
  ok(uh.indexOf("hd-pname") > 0 && uh.indexOf("v === 'student') L.push") > 0, "★姓名 / 班级 / 学号行只在学生版出现 ✓");
  const ids = T.HANDOUT_COURSE_IDS;
  ok(ids.length >= 6, "课型 " + ids.length + " 种（" + ids.join(" / ") + " ✓）");
  const missSkel = ids.filter(function (id) { return uh.indexOf("id: '" + id + "'") < 0 });
  ok(missSkel.length === 0, "★每种课型在 HD_SKELETONS 里都有骨架（差的：" + (missSkel.join("、") || "无") + " ✓）");
  ok(uh.indexOf("export function skeletonBlocks") > 0 && uh.indexOf("export function skeletonById") > 0, "骨架能生成块（每个栏目 = h1 + 空块 ✓）");
  ok(T.guessCourse("新授课") === "new" && T.guessCourse("一轮复习讲义") === "review" && T.guessCourse("导学案") === "learn", "★课型别名认得（新授课 / 一轮复习 / 导学案 ✓）");
  ok(T.guessCourse("随便什么课") === "", "认不出的课型返回空串（工具侧会报错 ✓）");
  const h1n = (uh.match(/\{ h: '/g) || []).length;
  ok(h1n >= 40, "六套骨架一共 " + h1n + " 个栏目 ✓");
  ok(H.HANDOUT_TOOL_NAMES.length === 19 && H.HANDOUT_TOOL_NAMES.indexOf("build_handout_skeleton") >= 0, "讲义工具 19 个，含 build_handout_skeleton ✓");
  ok(at.indexOf("name: 'build_handout_skeleton'") > 0 && at.indexOf("case 'build_handout_skeleton':") > 0, "★工具声明 + 执行分支都在 ✓");
  ok(at.indexOf("guessCourse(args.kind)") > 0, "★工具侧先用别名认出课型 ✓");
  ok(at.indexOf("skeleton: (kind: string, mode: string) => string") > 0, "★能力口子登记在 AiToolCtx 上 ✓");
  ok(hd.indexOf("skeleton: (kind, mode) => {") > 0 && hd.indexOf("skeletonById(kind)") > 0, "★讲义窗口真的实现了它 ✓");
  ok(hd.indexOf("+课型骨架") > 0, "★工具栏有「+课型骨架」入口 ✓");
  ok(String(H.HANDOUT_HELP).indexOf("build_handout_skeleton") > 0 && String(H.HANDOUT_HELP).indexOf("22 种") > 0, "手册里写了骨架 + 22 种块 ✓");
  ok(String(H.HANDOUT_HELP).indexOf("{{") > 0, "手册里写了挖空写法 ✓");
  const sys = String(H.buildHandoutChatSystem());
  ok(sys.indexOf("build_handout_skeleton") > 0 && sys.indexOf("22 种") > 0, "★system 里也提了骨架 + 22 种 ✓");
  const md = ["# 新授课讲义", "## 一、课前预习", "预习任务：读课本 P20。", "## 二、探究思考", "观察椭圆的画法。", "## 三、方法总结", "切线问题三步走。", "## 四、课后作业", "A 组：1. 求切线方程。", "## 五、学后反思", "我还不明白的是……"].join(NL);
  const r2 = MD.mdBlocksOf("2.1-椭圆的切线.md", md);
  const ty = r2.blocks.map(function (b) { return b.type });
  ok(ty.indexOf("preview") >= 0 && ty.indexOf("explore") >= 0 && ty.indexOf("method") >= 0 && ty.indexOf("homework") >= 0 && ty.indexOf("reflect") >= 0,
    "★md 里五个新栏目都认得出来（" + ty.join(" ") + " ✓）");
  const cases = T.HANDOUT_TRAIN_CASES;
  ok(cases.length >= 36, "训练用例 " + cases.length + " 条 ✓");
  ok(cases.some(function (c) { return c.tool === "build_handout_skeleton" }), "★骨架工具有用例盯着 ✓");
  const covered = H.HANDOUT_TOOL_NAMES.filter(function (n) { return cases.some(function (c) { return c.tool === n }) });
  ok(covered.length === H.HANDOUT_TOOL_NAMES.length, "★19 个工具每个都有用例（缺：" + (H.HANDOUT_TOOL_NAMES.filter(function (n) { return covered.indexOf(n) < 0 }).join("、") || "无") + " ✓）");
})();

console.log("=== 用例 48：讲义吃下那批真实资料（图 / 表 / 栏目 ✓ v1713）===");
const CASE48 = (async () => {
  const MD = loadBundled("useHandoutMd.ts", "_c48m.cjs");
  const UH = loadBundled("useHandout.ts", "_c48u.cjs");
  const NL = String.fromCharCode(10);
  const hd = fs.readFileSync(path.join(ROOT, "src", "components", "HandoutModal.vue"), "utf8");
  // ① 七段式栏目 → 块类型（D:\vue-app\高中数学讲义 那批的写法 ✓）
  const want = [
    ["## 【学习目标】", "goal"], ["## 【情境导入】", "explore"], ["## 【知识梳理】", "knowledge"],
    ["## 【典型例题】", "example"], ["## 【变式训练】", "variant"], ["## 【易错提醒】", "warn"],
    ["## 【方法提炼】", "method"], ["## 【课后巩固】", "homework"], ["## 参考答案与详解", "answer"],
    ["## 【素养达标自评】", "reflect"], ["## 本章小结", "summary"],
  ];
  const miss = [];
  for (const pair of want) {
    const r = MD.mdBlocksOf("第99讲 测试.md", pair[0] + NL + "正文一行。" + NL);
    const ty = r.blocks.map(function (b) { return b.type });
    if (ty.indexOf(pair[1]) < 0) miss.push(pair[0] + "→" + pair[1] + "（实际 " + ty.join("/") + "）");
  }
  ok(miss.length === 0, "★七段式栏目全都能认（差的：" + (miss.join("；") || "无") + " ✓）");
  // ② 判据放宽：**【定义】** 也该是 knowledge ✓（那批讲义就是这么写的 ✓）
  const kd = MD.mdBlocksOf("x.md", "**【定义】** 平面内到两定点距离之和为常数。" + NL);
  ok(kd.blocks.some(function (b) { return b.type === "knowledge" }), "★**【定义】** → 知识梳理块（以前被【】挡住 ✗）");
  // ③ 纯栏目名留空 + 正文收进容器块 ✓
  const sec = MD.mdBlocksOf("x.md", "## 【知识梳理】" + NL + "定义：平面内到两定点距离之和为常数。" + NL + "### 一、小节" + NL + "小节正文。" + NL);
  const kn = sec.blocks.filter(function (b) { return b.type === "knowledge" });
  ok(kn.length === 1 && String(kn[0].text).indexOf("【知识梳理】") < 0, "★「## 【知识梳理】」不再把栏目名当正文印一遍 ✓");
  ok(kn.length === 1 && String(kn[0].text).indexOf("定义：") >= 0, "★后面的正文**收进**知识梳理块（以前散成 para ✗）");
  ok(sec.blocks.some(function (b) { return b.type === "h2" }) && sec.blocks.some(function (b) { return String(b.text).indexOf("小节正文") >= 0 }), "★碰到 ### 就断开（小节标题 + 正文各自成块 ✓）");
  // ④ 图片：base64 内嵌 → figure 块（图注 = alt ✓）
  const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
  const im = MD.mdBlocksOf("x.md", "## 【知识梳理】" + NL + "![椭圆示意图](data:image/png;base64," + b64 + ")" + NL);
  const fig = im.blocks.filter(function (b) { return b.type === "figure" });
  ok(fig.length === 1, "★内嵌图 → 拆成 1 个插图块（" + fig.length + " ✓）");
  ok(fig.length === 1 && !!fig[0].img && String(fig[0].img.src).indexOf("data:image/png;base64,") === 0, "★图存在块的 img.src 里（自包含 ✓）");
  ok(fig.length === 1 && fig[0].img.caption === "椭圆示意图", "★图注取方括号里的字（" + (fig.length ? fig[0].img.caption : "-") + " ✓）");
  ok(im.blocks.every(function (b) { return String(b.text || "").indexOf("![") < 0 }), "★正文里不再留 ![…](…) 原文 ✓");
  const rel = MD.mdBlocksOf("x.md", "![三点共线](images/三点共线.png)" + NL);
  ok(rel.blocks.some(function (b) { return b.type === "figure" && !!b.img && b.img.src === "images/三点共线.png" }), "★相对路径图也插成插图块 ✓");
  // ⑤ 表格：竖线表 → 真表格 ✓
  const tbl = ["| 实数中的公式 | 复数中的公式 |", "| --- | --- |", "| $(a+b)(a-b)$ | $(z_1+z_2)(z_1-z_2)$ |"].join(NL);
  const html = UH.hdRichHtml(UH.hdFillOut(UH.hdEsc(tbl), "teacher"));
  ok(html.indexOf('<table class="hd-tbl">') >= 0, "★竖线表 → <table class=hd-tbl> ✓");
  ok(html.indexOf("<th>") >= 0 && html.indexOf("<td>") >= 0, "★表头 / 单元格都在 ✓");
  ok(html.indexOf("---") < 0, "★分隔行不印出来 ✓");
  ok(UH.hdRichHtml("| 只有一行 | 不算表 |").indexOf("<table") < 0, "★没有分隔行 → 不当表格（原样 ✓）");
  // ⑥ 行内图片兜底（老 json 里图仍在正文里 ✓）
  const inl = UH.hdRichHtml("看图：![示意图](data:image/png;base64,AAAA) 完毕。");
  ok(inl.indexOf("<figure") >= 0 && inl.indexOf('alt="示意图"') > 0, "★正文里混排的图也能渲染 ✓");
  ok(hd.indexOf(".hd-tbl") > 0 && hd.indexOf(".hd-fig--inline") > 0, "★表格 / 内联图的样式都在 ✓");
  // ⑦ 真材料验收：真读那批 md（D:\vue-app\高中数学讲义 ✓）
  const real = path.join(ROOT, "高中数学讲义", "必修第二册", "第七章 复数", "第11讲 复数的概念.md");
  if (fs.existsSync(real)) {
    const r = MD.mdBlocksOf("第11讲 复数的概念.md", fs.readFileSync(real, "utf8"));
    const cnt = {};
    for (const b of r.blocks) cnt[b.type] = (cnt[b.type] || 0) + 1;
    ok((cnt.figure || 0) >= 4, "★真讲义第 11 讲：图块 " + (cnt.figure || 0) + " 个（那讲 5 张图 ✓）");
    ok((cnt.knowledge || 0) >= 1 && (cnt.homework || 0) >= 1 && (cnt.answer || 0) >= 1 && (cnt.method || 0) >= 1 && (cnt.warn || 0) >= 1,
      "★真讲义栏目落到对的块上（knowledge=" + (cnt.knowledge || 0) + " warn=" + (cnt.warn || 0) + " method=" + (cnt.method || 0) + " homework=" + (cnt.homework || 0) + " answer=" + (cnt.answer || 0) + " ✓）");
    ok(r.blocks.every(function (b) { return String(b.text || "").indexOf("![") < 0 }), "★真讲义导完正文里没有 ![ 残留 ✓");
  } else {
    ok(true, "（本机没有那批 md → 跳过真材料验收）");
  }
})();

console.log("=== 用例 49：文档缺口补齐（题库 / 试卷 AI / 讲义 / 讲义 AI ✓ v1714）===");
const CASE49 = (async () => {
  const HT = loadBundled("../help/topics.ts", "_c49t.cjs");
  const list = HT.HELP_TOPICS || [];
  const ids = list.map(function (x) { return x.id });
  const want = ["bank", "paper", "handout", "handout-ai"];
  const miss = want.filter(function (x) { return ids.indexOf(x) < 0 });
  ok(miss.length === 0, "★帮助里补上了这四节（差的：" + (miss.join("、") || "无") + " ✓）");
  ok(ids.length === new Set(ids).size, "帮助 topic id 不重复（" + ids.length + " 节 ✓）");
  const sec = "题库 / 试卷 / 讲义";
  const inSec = list.filter(function (x) { return x.section === sec });
  ok(inSec.length === want.length, "四节都归到同一个分组「" + sec + "」（" + inSec.length + " 节 ✓）");
  const thin = inSec.filter(function (x) { return !Array.isArray(x.body) || x.body.length < 6 || !(x.tags || []).length });
  ok(thin.length === 0, "★每节都有正文（≥6 块）与搜索标签（薄的：" + (thin.map(function (x) { return x.id }).join("、") || "无") + " ✓）");
  const text = inSec.map(function (x) { return (x.body || []).map(function (b) { return Array.isArray(b.v) ? b.v.join("；") : String(b.v == null ? "" : b.v) }).join(" ") }).join(" ");
  const mustHave = ["课型骨架", "挖空", "学生版", "AI 助手", "试题库", "19 个工具", "[题]"];
  const lack = mustHave.filter(function (k) { return text.indexOf(k) < 0 });
  ok(lack.length === 0, "★关键说法都在（缺：" + (lack.join("、") || "无") + " ✓）");
  const md = fs.readFileSync(path.join(ROOT, "docs", "使用手册.md"), "utf8");
  const heads = ["## 13.", "## 14.", "## 15.", "## 16."];
  const lackH = heads.filter(function (x) { return md.indexOf(x) < 0 });
  ok(lackH.length === 0, "★手册也补了 13~16 节（缺：" + (lackH.join("、") || "无") + " ✓）");
  const lackM = ["课型骨架", "挖空（填空版）", "学生版与教师版", "19 个工具", "LJ-讲义"].filter(function (k) { return md.indexOf(k) < 0 });
  ok(lackM.length === 0, "★手册里关键说法也在（缺：" + (lackM.join("、") || "无") + " ✓）");
  ok(md.indexOf("## 12. 常见问题") < md.indexOf("## 13. 试题库"), "新增小节接在原文之后（没插到中间 ✓）");
})();

console.log("=== 用例 50：清空讲义库（全部删掉 v1715）===");
const CASE50 = (async () => {
  const hd = fs.readFileSync(path.join(ROOT, "src", "components", "HandoutModal.vue"), "utf8");
  ok(hd.indexOf("function clearAllHandouts()") > 0, "★讲义库里有「清空全部」的处理函数");
  ok(hd.indexOf("@click=" + String.fromCharCode(34) + "clearAllHandouts" + String.fromCharCode(34)) > 0, "★抽屉里接了按钮");
  ok(hd.indexOf("清空讲义库（全部") > 0, "按钮文案写清了「全部」");
  ok(hd.indexOf("deleteHandout(d.id)") > 0, "★走的是应用自己的删除口径（文件挪进 .deleted\、工作副本一起清）");
  ok(hd.indexOf("window.confirm") > 0, "删除前有确认（不会误删）");
  ok(hd.indexOf("deleteHandout,") > 0, "deleteHandout 是从 useHandout import 的");
})();

console.log("=== 用例 51：清空讲义库之后应该是一份**空白**（不是示例讲义 v1716）===");
const CASE51 = (async () => {
  const UH = loadBundled("useHandout.ts", "_c51u.cjs");
  const src = fs.readFileSync(path.join(ROOT, "src", "composables", "useHandout.ts"), "utf8");
  ok(typeof UH.blankHandout === "function", "★有 blankHandout()");
  const b = UH.blankHandout();
  ok(Array.isArray(b.blocks) && b.blocks.length === 0, "★空白讲义 = 0 块（不是那份示例的内容）");
  ok(String(b.meta.title) === "", "★标题留空（让老师写授课题目；抬头没填时显示「未命名讲义」）");
  const s = UH.sampleHandout();
  ok(String(s.meta.title) !== String(b.meta.title) && s.blocks.length > 0, "示例讲义还是原来那份（首启教程 ✓ 两者分开了）");
  const delPart = src.slice(src.indexOf("export function deleteHandout"));
  ok(delPart.indexOf("blankHandout()") > 0, "★删到空时给的是 blankHandout（以前是 sampleHandout ✗）");
  ok(delPart.indexOf("saveHandout(handout.value)") > 0, "★连单份那份（KEY）也写掉（否则老内容下次启动会被迁回来 ✗）");
})();

console.log("=== 用例 52：课型骨架照研究报告重排（新授课 / 习题课 / 讲评课 … v1717）===");
const CASE52 = (async () => {
  const UH = loadBundled("useHandout.ts", "_c52u.cjs");
  const sk = UH.HD_SKELETONS || [];
  ok(sk.length === 6, "六套课型骨架（" + sk.length + "）");
  ok(sk.map(function (x) { return x.id }).join(",") === "new,learn,review,topic,drill,comment", "课型 id 与顺序没漂");
  const blk = function (id) { return UH.skeletonBlocks(id) };
  const heads = function (id) { return blk(id).filter(function (b) { return b.type === "h1" }).map(function (b) { return String(b.text) }).join(" / ") };
  const types = function (id) { return blk(id).map(function (b) { return b.type }).join(" ") };
  ok(heads("new").indexOf("一、学习目标") === 0 && heads("new").indexOf("课后作业") > 0, "★新授课：学习目标打头、课后作业收尾");
  ok(types("new").indexOf("goal") >= 0 && types("new").indexOf("example") >= 0 && types("new").indexOf("blank") >= 0, "新授课有 目标 / 例题 / 留白");
  ok(blk("new").some(function (b) { return b.type === "h2" && String(b.text).indexOf("情境与观察") >= 0 }) && blk("new").some(function (b) { return b.type === "h2" && String(b.text).indexOf("结论梳理") >= 0 }), "★新授课带小节（情境与观察 / 结论梳理）");
  ok(blk("new").filter(function (b) { return b.type === "h2" }).length >= 5, "新授课 h2 小节 " + blk("new").filter(function (b) { return b.type === "h2" }).length + " 个");
  ok(heads("drill").indexOf("题组") > 0 && heads("drill").indexOf("一题多变") > 0 && heads("drill").indexOf("方法归纳") > 0, "★习题课：题组呈现 → 一题多变 → 方法归纳");
  ok(heads("comment").indexOf("考情概览") > 0 && heads("comment").indexOf("我的得失") > 0 && heads("comment").indexOf("错因归类") > 0, "★讲评课：考情概览 / 我的得失 / 错因归类");
  ok(heads("review").indexOf("课标要求与考情分析") > 0 && heads("review").indexOf("课时作业") > 0, "★一轮：课标与考情 → 课时作业");
  ok(heads("topic").indexOf("真题导入") > 0 && heads("topic").indexOf("母题精讲") > 0 && heads("topic").indexOf("同源变式") > 0, "★二轮：真题导入 / 母题精讲 / 同源变式");
  ok(heads("learn").indexOf("合作探究") > 0 && heads("learn").indexOf("学习反思") > 0, "★学案：合作探究 / 学习反思");
  ok(sk.every(function (x) { return String(x.note || "").length > 20 }), "每套都写清了「这一课型放什么」");
  ok(sk.every(function (x) { return blk(x.id).some(function (b) { return b.type === "blank" }) }), "每套都带了留白块（学生写的地方）");
  ok(blk("drill").some(function (b) { return b.type === "blank" && Number(b.blankCm) >= 5 }), "留白带了高度（cm）");
  ok(blk("new").length >= 30, "新授课骨架块数够（" + blk("new").length + " 块）");
  const sys = fs.readFileSync(path.join(ROOT, "src", "composables", "aiHandoutChat.ts"), "utf8");
  ok(sys.indexOf("落地清单") > 0 && sys.indexOf("一题多变") > 0, "★手册里补了栏目链 + 落地清单");
  const hd = fs.readFileSync(path.join(ROOT, "src", "components", "HandoutModal.vue"), "utf8");
  ok(hd.indexOf(":title=") > 0 && hd.indexOf("s.note") > 0, "下拉里能看到每套的说明");
})();

console.log("=== 用例 53：标题要是**授课题目**，不是教材名（用户实报：抬头印成「人教版·必修二」✗ v1718）===");
const CASE53 = (async () => {
  const UH = loadBundled("useHandout.ts", "_c53u.cjs");
  const T = UH.autoTitleOf;
  const mk = function (meta) { return { meta: Object.assign({ press: "人教版", book: "必修二", chapter: "", section: "", period: "", autoTitle: true, title: "" }, meta), blocks: [] } };
  ok(T(mk({})) === "", "★只填了版本 / 册 → 不生成标题（不再印「人教版·必修二」✗）");
  const withChap = T(mk({ chapter: "6", section: "1" }));
  ok(withChap.indexOf("第 6 章 第 1 节") > 0, "章节填了还是照生成（" + withChap + "）");
  ok(T(mk({ period: "2" })).indexOf("第 2 课时") > 0, "只填课时也生成");
  const b = UH.blankHandout();
  ok(String(b.meta.title) === "", "★空白讲义标题留空（让老师写课题）");
  ok(b.meta.autoTitle === false, "★空白讲义默认**手动标题**（否则字段只读，老师写不进去✗）");
  const h = mk({ title: "椭圆外点切线的轨迹" });
  UH.syncAutoTitle(h);
  ok(String(h.meta.title) === "椭圆外点切线的轨迹", "★章节没填时 sync 不覆盖老师写的课题（" + h.meta.title + "）");
  const h2 = mk({ chapter: "6", section: "1", title: "管它呢" });
  UH.syncAutoTitle(h2);
  ok(String(h2.meta.title).indexOf("第 6 章") > 0, "章节填了又开着自动 → 照旧按教材生成（老行为没丢）");
  const hd = fs.readFileSync(path.join(ROOT, "src", "components", "HandoutModal.vue"), "utf8");
  const line = hd.split(String.fromCharCode(10)).filter(function (l) { return l.indexOf("v-model=") >= 0 && l.indexOf("h.meta.title") >= 0 })[0] || "";
  ok(line.indexOf("readonly") < 0, "★标题输入框可编辑了（以前 auto 时 readonly ✗，提示却说「改这里会切成手动」✗）");
  ok(line.indexOf("授课题目") > 0, "输入框给了「授课题目」的提示");
  ok(hd.indexOf("不生成）") > 0, "自动生成那行说明了为什么没生成");
})();

console.log("=== 用例 54：教材定位的章 / 节改成下拉候选（人教A版目录 + 讲义库 v1719）===");
const CASE54 = (async () => {
  const TB = loadBundled("hdTextbook.ts", "_c54t.cjs");
  const ch = TB.hdChapterOptions("人教版", "必修二", []);
  ok(ch.length === 5, "必修二 5 章（" + ch.length + "）");
  ok(ch.join(" | ").indexOf("第 6 章 平面向量及其应用") >= 0, "★章候选带章名（" + ch[0] + "）");
  ok(TB.hdChapterOptions("人教版", "选择性必修二", []).indexOf("第 4 章 数列") >= 0, "★选择性必修二的章号连着排（第 4 章 数列）");
  ok(TB.hdChapterOptions("人教版", "选择性必修三", []).length === 3, "选择性必修三 3 章");
  const sec6 = TB.hdSectionOptions("人教版", "必修二", "6", []);
  ok(sec6.length === 4 && sec6[0] === "第 1 节 平面向量的概念", "★章号 6 → 4 节（" + sec6[0] + "）");
  ok(TB.hdSectionOptions("人教版", "必修二", "第 6 章 平面向量及其应用", []).length === 4, "★已经写成整句的章也能认出（拿主号比）");
  ok(TB.hdSectionOptions("人教版", "必修二", "", []).length >= 10, "章没填 → 给这一册全部节（" + TB.hdSectionOptions("人教版", "必修二", "", []).length + " 个）");
  const docs = [{ meta: { press: "人教版", book: "必修二", chapter: "第 11 章 自编专题", section: "第 1 节 自编专题一" } }];
  ok(TB.hdChapterOptions("人教版", "必修二", docs).indexOf("第 11 章 自编专题") >= 0, "★讲义库里已有的章也进候选（老师自己的活目录）");
  ok(TB.hdSectionOptions("人教版", "必修二", "11", docs).indexOf("第 1 节 自编专题一") >= 0, "★讲义库里的节也进候选");
  ok(TB.hdTocBook("人教版", "必修一").chapters.every(function (c) { return c.secs.length >= 3 }), "每章都有节（内置目录完整）");
  ok(TB.HD_TOC.length === 5, "覆盖 5 册（必修一/二 + 选择性必修一/二/三）：" + TB.HD_TOC.length);
  ok(String(TB.HD_TOC_NOTE).indexOf("人教A版") > 0 && String(TB.HD_TOC_NOTE).indexOf("手打") > 0, "目录来源与「可手打」都写明了");
  const hd = fs.readFileSync(path.join(ROOT, "src", "components", "HandoutModal.vue"), "utf8");
  ok(hd.indexOf("list=" + String.fromCharCode(34) + "hd-chaps" + String.fromCharCode(34)) > 0, "★第几章接了 datalist");
  ok(hd.indexOf("list=" + String.fromCharCode(34) + "hd-secs" + String.fromCharCode(34)) > 0, "★第几节接了 datalist");
  ok(hd.indexOf("hdChapterOptions(h.value.meta.press") > 0 && hd.indexOf("hdSectionOptions(h.value.meta.press") > 0, "章 / 节候选都是响应式算出来的");
  ok(hd.indexOf("@/composables/hdTextbook") > 0, "模块接上了");
})();

console.log("=== 用例 55：第一讲讲义（1.1 集合的概念）能导进来 + 标题用课题（v1720）===");
const CASE55 = (async () => {
  const MD = loadBundled("useHandoutMd.ts", "_c55m.cjs");
  // ① 有节号时，md 的 # 标题仍然优先（课题 ✓ 不再被「人教版·必修一 第 1 章 第 1 节」盖掉）
  const r0 = MD.mdBlocksOf("1.1-集合的概念.md", "# 集合的概念" + String.fromCharCode(10) + "## 【知识梳理】" + String.fromCharCode(10) + "定义：……" + String.fromCharCode(10));
  ok(r0.title === "集合的概念", "★有节号也用 md 的 # 标题（" + r0.title + "）");
  const kn = MD.mdBlocksOf("x.md", "## 【知识链接】（课前小测）" + String.fromCharCode(10) + "1. 旧知一题。" + String.fromCharCode(10));
  ok(kn.blocks.some(function (b) { return b.type === "preview" }), "★【知识链接】→ 课前预习块（课前小测 ✓）");
  // ② 真讲义验收：第一讲那份 md（必修第一册 ✓）
  const f = path.join(ROOT, "高中数学讲义", "人教A版", "必修第一册", "第 1 章 集合与常用逻辑用语", "1.1-集合的概念.md");
  if (fs.existsSync(f)) {
    const r = MD.mdBlocksOf("1.1-集合的概念.md", fs.readFileSync(f, "utf8"));
    const cnt = {};
    for (const b of r.blocks) cnt[b.type] = (cnt[b.type] || 0) + 1;
    ok(r.title === "1.1 集合的概念", "★真讲义标题（" + r.title + "）");
    const want = ["goal", "preview", "knowledge", "example", "variant", "warn", "method", "exercise", "summary", "homework"];
    const miss = want.filter(function (t) { return !(cnt[t] > 0) });
    ok(miss.length === 0, "★新授课七段式栏目都在（缺：" + (miss.join("、") || "无") + "；h2 小节 " + (cnt.h2 || 0) + " 个）");
    ok((cnt.para || 0) > 10 && (cnt.formula || 0) >= 0, "正文与公式没丢（para " + (cnt.para || 0) + "）");
    ok(r.blocks.every(function (b) { return String(b.text || "").indexOf("![") < 0 }), "正文里没有图片残留 ✓");
  } else {
    ok(false, "找不到第一讲 md：" + f);
  }
  // ③ 导出的 JSON（讲义库 ✓）
  const jdir2 = path.join(ROOT, "发布", "LJ-讲义");
  const jname = (fs.existsSync(jdir2) ? fs.readdirSync(jdir2) : []).filter(function (x) { return x.indexOf("集合的概念") >= 0 && x.endsWith(".json") })[0] || "1.1 集合的概念.json";
  const j = path.join(jdir2, jname);
  if (fs.existsSync(j)) {
    const doc = JSON.parse(fs.readFileSync(j, "utf8"));
    const d = doc.doc || doc;
    ok(String((d.meta || {}).title).indexOf("集合的概念") >= 0, "★库里那份标题也是课题（" + String((d.meta || {}).title) + "）");
    ok(String((d.meta || {}).book).indexOf("必修一") >= 0, "册写成了必修一（" + String((d.meta || {}).book) + "）");
    ok(Array.isArray(d.blocks) && d.blocks.length > 20, "库里那份有 " + (d.blocks || []).length + " 块");
    ok(String((d.meta || {}).title).length > 0, "库里那份有标题（" + String((d.meta || {}).title) + "）");
  } else {
    ok(false, "库里还没有第一讲的 JSON：" + j);
  }
})();

console.log("=== 用例 56：讲义目录树（人教版→册→章→节→课时）+ 粗体不再印星号（v1721）===");
const CASE56 = (async () => {
  const MD = loadBundled("useHandoutMd.ts", "_c56m.cjs");
  const UH = loadBundled("useHandout.ts", "_c56u.cjs");
  const TB = loadBundled("hdTextbook.ts", "_c56t.cjs");
  // ① 粗体：**x** 渲染成 <b>，不留星号
  const b = UH.hdRichHtml("这是**重点**内容");
  ok(b.indexOf("<b>重点</b>") > 0 && b.indexOf("**") < 0, "★**重点** 渲染成粗体（不再原样印星号）：" + b);
  const tb = UH.hdRichHtml("| **甲** | 乙 |" + String.fromCharCode(10) + "| --- | --- |" + String.fromCharCode(10) + "| **丙** | 丁 |");
  ok(tb.indexOf("<b>甲</b>") > 0 && tb.indexOf("**") < 0, "★表格里的粗体也认");
  // ② 目录树：章 / 节写**带名字**的全称
  const r = MD.mdToHandout("1.1-集合的概念.md", "# 集合的概念" + String.fromCharCode(10) + "> 教材：人教A版 必修第一册 第一章 1.1" + String.fromCharCode(10));
  ok(String(r.meta.book) === "必修一", "册猜对了（" + r.meta.book + "）");
  ok(String(r.meta.chapter) === "第 1 章 集合与常用逻辑用语", "★章写成带名字的（" + r.meta.chapter + "）");
  ok(String(r.meta.section) === "第 1 节 集合的概念", "★节写成带名字的（" + r.meta.section + "）");
  ok(String(r.meta.period) === "1", "课时默认第 1 课时（" + r.meta.period + "）");
  const r2 = MD.mdToHandout("3.2-双曲线.md", "# 双曲线" + String.fromCharCode(10) + "> 教材：人教A版 选择性必修第一册 第三章 3.2" + String.fromCharCode(10));
  ok(String(r2.meta.book) === "选择性必修一" && String(r2.meta.chapter) === "第 3 章 圆锥曲线的方程" && String(r2.meta.section) === "第 2 节 双曲线",
    "★换一册也对（" + r2.meta.book + " / " + r2.meta.chapter + " / " + r2.meta.section + "）");
  // ③ 第一章五讲真文件：章 / 节标签都对 + 库里的 JSON 也在
  const dir = path.join(ROOT, "高中数学讲义", "人教A版", "必修第一册", "第 1 章 集合与常用逻辑用语");
  const want = [["1.1-集合的概念.md", "第 1 节 集合的概念"], ["1.2-集合间的基本关系.md", "第 2 节 集合间的基本关系"], ["1.3-集合的基本运算.md", "第 3 节 集合的基本运算"], ["1.4-充分条件与必要条件.md", "第 4 节 充分条件与必要条件"], ["1.5-全称量词与存在量词.md", "第 5 节 全称量词与存在量词"]];
  const miss = [];
  for (const pair of want) {
    const f = path.join(dir, pair[0]);
    if (!fs.existsSync(f)) { miss.push(pair[0] + "（没这个文件）"); continue }
    const rr = MD.mdToHandout(pair[0], fs.readFileSync(f, "utf8"));
    if (String(rr.meta.section) !== pair[1]) miss.push(pair[0] + "→" + rr.meta.section);
  }
  ok(miss.length === 0, "★第一章五讲的节标签都对（差的：" + (miss.join("；") || "无") + "）");
  const jdir = path.join(ROOT, "发布", "LJ-讲义");
  const js = fs.existsSync(jdir) ? fs.readdirSync(jdir).filter(function (x) { return x.endsWith(".json") }) : [];
  ok(js.length >= 5, "讲义库里有 " + js.length + " 份 JSON（第一章节数 ≥ 5）");
})();

console.log("=== 用例 57：讲义库不再重复 + 目录树不套两层「第 … 章」（v1722）===");
const CASE57 = (async () => {
  const UH = loadBundled("useHandout.ts", "_c57u.cjs");
  ok(UH.hdUnitLabel("第 1 章 集合与常用逻辑用语", "章") === "第 1 章 集合与常用逻辑用语", "★全称原样用（不再变「第 第 1 章 … 章」）");
  ok(UH.hdUnitLabel("1", "章") === "第 1 章", "★只填数字时照旧套「第 1 章」");
  ok(UH.hdUnitLabel("第 1 节 集合的概念", "节") === "第 1 节 集合的概念", "★节同理");
  ok(UH.hdUnitLabel("", "章") === "", "空值给空串");
  const mk = function (title, upd, file) { return { id: title + upd, updatedAt: upd, file: file, meta: { book: "必修一", chapter: "第 1 章 集合与常用逻辑用语", section: "第 1 节 集合的概念", period: "1", title: title }, blocks: [] } };
  const src = [mk("1.1 集合的概念", "2026-09-27 08:00", "1.1 集合的概念.json"), mk("1.1 集合的概念", "2026-09-27 09:10", "1.1 集合的概念.json"), mk("1.2 集合间的基本关系", "2026-09-27 09:10", "1.2 集合间的基本关系.json")];
  const out = UH.dedupeLibDocs(src, new Set(["1.1 集合的概念.json", "1.2 集合间的基本关系.json"]));
  ok(out.length === 2, "★重复的那些合成 " + out.length + " 份（每讲一份）");
  ok(String(out[0].updatedAt) === "2026-09-27 09:10", "★重复的留**新**的那份（" + out[0].updatedAt + "）");
  const gone = [mk("1.3 集合的基本运算", "2026-09-27 09:10", "1.3 集合的基本运算.json"), { id: "new", updatedAt: "2026-09-27 09:20", meta: { book: "必修一", title: "未命名讲义" }, blocks: [] }];
  const out2 = UH.dedupeLibDocs(gone, new Set(["1.1 集合的概念.json"]));
  ok(out2.length === 1 && String(out2[0].id) === "new", "★文件没了的丢掉、没保存的新讲义留着（剩 " + out2.length + " 份）");
  ok(UH.dedupeLibDocs(gone).length === 2, "没给 alive 集合时不乱丢");
  const Q = String.fromCharCode(39);
  const srcTs = fs.readFileSync(path.join(ROOT, "src", "composables", "useHandout.ts"), "utf8");
  ok(srcTs.indexOf("hdUnitLabel(cp, " + Q + "章" + Q + ")") > 0, "目录树用 hdUnitLabel 拼章");
  ok(srcTs.indexOf(Q + "第 " + Q + " + cp + " + Q + " 章" + Q) < 0, "旧的「第 + cp + 章」拼接已清掉");
  ok(srcTs.indexOf("dedupeLibDocs(lib.value") > 0, "对账时调了去重");
  const ui = fs.readFileSync(path.join(ROOT, "src", "components", "HandoutModal.vue"), "utf8");
  ok(ui.indexOf("第 {{ item.chapter }} 章") < 0, "抽题抽屉里那处也不套两层了");
})();

console.log("=== 用例 58：图形库新增「向量」分类（三角形法则 / 平行四边形法则 / 等和线 v1723）===");
const CASE58 = (async () => {
  const VF = loadBundled("vectorFigures.ts", "_c58v.cjs");
  const Q1 = String.fromCharCode(39);
  const kinds = ["vecTriangle", "vecParallelogram", "vecEqualSum"];
  ok(VF.VECTOR_FIG_KINDS.length === 3, "向量分类 3 张图（" + VF.VECTOR_FIG_KINDS.join(" / ") + "）");
  ok(kinds.every(function (k) { return VF.isVectorFigKind(k) }) && !VF.isVectorFigKind("parallelogram"), "isVectorFigKind 判定正确");
  const s1 = VF.vectorFigureSvg("vecTriangle", 520, 340, "#2563eb", 2);
  const s2 = VF.vectorFigureSvg("vecParallelogram", 520, 340, "#2563eb", 2);
  const s3 = VF.vectorFigureSvg("vecEqualSum", 520, 340, "#2563eb", 2);
  ok(s1.length > 400 && s2.length > 400 && s3.length > 400, "三张图都出了 SVG（" + s1.length + " / " + s2.length + " / " + s3.length + " 字节）");
  ok(s1.indexOf(">a<") > 0 && s1.indexOf(">b<") > 0 && s1.indexOf(">a+b<") > 0, "★三角形法则：标了 a、b、a+b");
  ok(s1.indexOf("首尾相接") > 0 && s1.indexOf(">A<") > 0 && s1.indexOf(">C<") > 0, "★三角形法则：口诀与顶点字母 A、B、C");
  ok(s2.indexOf("共起点") > 0 && s2.indexOf("对角线") > 0, "★平行四边形法则：标注「OC 是对角线」");
  ok((s2.match(/stroke-dasharray/g) || []).length >= 2, "★平行四边形法则：有虚线补边（" + (s2.match(/stroke-dasharray/g) || []).length + " 条）");
  ok(s3.indexOf("x+y=1") > 0 && s3.indexOf("x+y=0.5") > 0 && s3.indexOf("x+y=1.5") > 0, "★等和线：三条线都标了 x+y=k");
  ok(s3.indexOf("等和线") > 0 && s3.indexOf("平行的直线") > 0, "★等和线：写清了「与 AB 平行」");
  ok((s3.match(/<polygon/g) || []).length >= 4, "等和线有三支箭头（polygon ≥ 4）");
  ok(VF.vectorFigureSvg("nope", 520, 340).length === 0, "不认识的 kind 返回空串");
  const T = fs.readFileSync(path.join(ROOT, "src", "types", "index.ts"), "utf8");
  ok(T.indexOf("| " + Q1 + "向量" + Q1) > 0, "★类型里加了「向量」分类");
  const v1 = T.split("cat: " + Q1 + "向量" + Q1).length - 1;
  const v2 = T.split("cat: " + String.fromCharCode(34) + "向量" + String.fromCharCode(34)).length - 1;
  ok(v1 + v2 >= 3, "★图形库里有 " + (v1 + v2) + " 个「向量」项");
  ok(T.indexOf("vecTriangle") > 0 && T.indexOf("vecParallelogram") > 0 && T.indexOf("vecEqualSum") > 0, "三个 kind 都进了图形库选项表");
  const MFE = fs.readFileSync(path.join(ROOT, "src", "components", "elements", "MathFigureElement.vue"), "utf8");
  ok(MFE.indexOf("vectorFigureSvg") > 0 && MFE.indexOf("isVectorFigKind") > 0, "画布渲染器接上了");
  const REV = fs.readFileSync(path.join(ROOT, "src", "reveal", "renderer.ts"), "utf8");
  ok(REV.indexOf("vectorFigureSvg") > 0, "★打印/导出的兜底渲染器也接上了（不会屏幕上有一打印空白）");
  const MP = fs.readFileSync(path.join(ROOT, "src", "composables", "mathPlot.ts"), "utf8");
  ok(MP.indexOf("vecTriangle") > 0, "插入尺寸（viewAspect）给了向量图 1.55 的宽高比");
  // ★【v1724】遮罩块（盖住图形 / 遮答案）
  ok(T.indexOf("v: " + Q1 + "cover" + Q1) > 0, "★图形库里有「遮罩块」");
  ok(T.indexOf("| " + Q1 + "cover" + Q1) > 0, "★kind 类型里加了 cover");
  ok(MFE.indexOf("case " + Q1 + "cover" + Q1 + ":") > 0, "画布渲染器认遮罩块");
  ok(REV.indexOf("case " + Q1 + "cover" + Q1 + ":") > 0, "打印/导出兜底渲染器也认遮罩块");
  // ★【v1724】三条平行线必须等长、等距、平行（用户实报「有点儿错位」✗）
  const vOf = function (tag, key) { const seg = tag.split(key + String.fromCharCode(61) + String.fromCharCode(34))[1]; return seg ? Number(seg.split(String.fromCharCode(34))[0]) : NaN };
  const fam = (s3.match(/<line[^>]*stroke="(?:#6b7280|#dc2626)"[^>]*>/g) || []).filter(function (t) { return t.indexOf("2 3") < 0 }).map(function (tag) {
    return { x1: vOf(tag, "x1"), y1: vOf(tag, "y1"), x2: vOf(tag, "x2"), y2: vOf(tag, "y2") };
  });
  ok(fam.length === 3, "★等和线的平行线族正好 3 条（" + fam.length + "）");
  const lens = fam.map(function (l) { return Math.round(Math.hypot(l.x2 - l.x1, l.y2 - l.y1) * 10) / 10 });
  ok(Math.max.apply(null, lens) - Math.min.apply(null, lens) < 1.5, "★三条等长（" + lens.join(" / ") + "）");
  const dirs = fam.map(function (l) { return Math.round(Math.atan2(l.y2 - l.y1, l.x2 - l.x1) * 1000) / 1000 });
  ok(dirs.every(function (d) { return Math.abs(d - dirs[0]) < 0.01 }), "★三条平行（方向 " + dirs.join(" / ") + "）");
  const mids = fam.map(function (l) { return { x: (l.x1 + l.x2) / 2, y: (l.y1 + l.y2) / 2 } }).sort(function (a, b) { return (a.x - b.x) || (a.y - b.y) });
  const d01 = Math.hypot(mids[1].x - mids[0].x, mids[1].y - mids[0].y);
  const d12 = Math.hypot(mids[2].x - mids[1].x, mids[2].y - mids[1].y);
  ok(Math.abs(d01 - d12) < 1.5, "★三条等距（间距 " + d01.toFixed(1) + " / " + d12.toFixed(1) + "）");
})();

console.log("=== 用例 59：图形裁剪显示 + 打印时隐藏（v1725）===");
const CASE59 = (async () => {
  const FC = loadBundled("figureCrop.ts", "_c59f.cjs");
  ok(FC.cropInsetCss({ l: 0.1, r: 0.2, t: 0.3, b: 0.4 }) === "inset(30% 20% 40% 10%)", "★四边比例 → clip-path inset（" + FC.cropInsetCss({ l: 0.1, r: 0.2, t: 0.3, b: 0.4 }) + "）");
  ok(FC.cropInsetCss({ l: 0, r: 0, t: 0, b: 0 }) === "" && FC.cropInsetCss(undefined) === "", "没裁就返回空串（不留 clip-path）");
  ok(FC.cropInsetCss({ l: 2, r: -1, t: 0, b: 0 }) === "inset(0% 0% 0% 90%)", "越界值夹到 0~90%（" + FC.cropInsetCss({ l: 2, r: -1, t: 0, b: 0 }) + "）");
  ok(FC.figNoPrint({ noPrint: true }) && !FC.figNoPrint({}) && !FC.figNoPrint(null), "figNoPrint 判定正确");
  ok(FC.figCropCss({ crop: { l: 0.05, r: 0, t: 0, b: 0 } }) === "inset(0% 0% 0% 5%)", "figCropCss 从元素上取 crop");
  const T = fs.readFileSync(path.join(ROOT, "src", "types", "index.ts"), "utf8");
  ok(T.indexOf("【v1725】裁剪显示") > 0 && T.indexOf("noPrint?: boolean") > 0, "★mathfig 元素类型加了 crop 与 noPrint");
  const EF = fs.readFileSync(path.join(ROOT, "src", "components", "ElementFrame.vue"), "utf8");
  ok(EF.indexOf("data-noprint") > 0 && EF.indexOf("figCropCss(el)") > 0, "★元素外框接上打印隐藏与裁剪");
  const CSS = fs.readFileSync(path.join(ROOT, "src", "styles", "main.css"), "utf8");
  ok(CSS.indexOf("[data-noprint=" + String.fromCharCode(34) + "1" + String.fromCharCode(34) + "]") > 0, "★打印 CSS 会隐藏 data-noprint 元素");
  const PP = fs.readFileSync(path.join(ROOT, "src", "components", "PropertyPanel.vue"), "utf8");
  ok(PP.indexOf("setFigCrop") > 0 && PP.indexOf("noPrint") > 0, "★属性面板上有裁剪与「打印时隐藏」两个控件");
})();

console.log("=== 用例 60：遮罩（只显示形状内，外面全隐藏 ✓ v1727）===");
const CASE60 = (async () => {
  const FC = loadBundled("figureCrop.ts", "_c60f.cjs");
  ok(FC.maskClipCss({ shape: "circle" }) === "circle(50% at 50% 50%)", "★圆形窗口（" + FC.maskClipCss({ shape: "circle" }) + "）");
  ok(FC.maskClipCss({ shape: "ellipse" }).indexOf("ellipse") === 0, "椭圆窗口");
  ok(FC.maskClipCss({ shape: "round" }).indexOf("inset(0 round") === 0, "圆角矩形窗口");
  ok(FC.maskClipCss({ shape: "none" }) === "" && FC.maskClipCss(undefined) === "" && FC.maskClipCss({ shape: "??" }) === "", "不遮罩 / 认不出的形状 → 空串（不动图形 ✓）");
  const poly = FC.maskClipCss({ shape: "self" }, [0, 0, 1, 0, 0.5, 1]);
  ok(poly === "polygon(0.00% 0.00%, 100.00% 0.00%, 50.00% 100.00%)", "★用它自己的形状当遮罩（" + poly + "）");
  ok(FC.maskClipCss({ shape: "self" }, null) === "circle(50% at 50% 50%)", "没顶点时退回圆形（不会把图形整块藏没 ✓）");
  ok(FC.MASK_SHAPES.length === 5, "遮罩形状清单 5 项（" + FC.MASK_SHAPES.map(function (x) { return x.v }).join("/") + "）");
  ok(FC.figMaskCss({ mask: { shape: "circle" }, points: [] }) === "circle(50% at 50% 50%)", "figMaskCss 从元素取遮罩");
  const T = fs.readFileSync(path.join(ROOT, "src", "types", "index.ts"), "utf8");
  ok(T.indexOf("mask?: { shape?:") > 0 || T.indexOf("mask?:") > 0, "★mathfig 元素类型加了 mask");
  const EF = fs.readFileSync(path.join(ROOT, "src", "components", "ElementFrame.vue"), "utf8");
  ok(EF.indexOf("figMaskCss") > 0, "★元素外框接上了遮罩");
  const PP = fs.readFileSync(path.join(ROOT, "src", "components", "PropertyPanel.vue"), "utf8");
  ok(PP.indexOf("遮罩（只显示形状内）") > 0 || PP.indexOf("maskShape") > 0, "★属性面板有遮罩下拉");
})();

console.log("=== 用例 34：样式闭合标签容错（用户实报：改完色每行后面印出 {/c} ✗ v1695）===");
{
  const ST = loadBundled("paperStyle.ts", "_c34.cjs");
  const NL = String.fromCharCode(10);
  // ① 各种闭合写法都要丢掉 ✓
  const a = ST.stripStyleClosers("{c:blue}2. 已知…{/c}");
  ok(a.dropped === 1 && a.text.indexOf("{/c}") < 0 && a.text.indexOf("{c:blue}2. 已知") === 0, "★行尾 {/c} 丢掉、行首 {c:blue} 保留 ✓");
  ok(ST.stripStyleClosers("{c:blue}一、解答题{/c:blue}").dropped === 1, "带值的闭合 {/c:blue} 也认 ✓");
  ok(ST.stripStyleClosers("{ / c } 文字").dropped === 1 && ST.stripStyleClosers("{/}").dropped === 1, "空格写法 { / c } 与光秃 {/} 都认 ✓");
  ok(ST.stripStyleClosers("{/B}{/I}{/S}{/F}").dropped === 4, "大小写不敏感、四个键都认 ✓");
  // ② 合法的行首前缀**一个都不能动** ✗（宁可少删也别误删 ✓）
  ok(ST.stripStyleClosers("{c:red; s:16; f:楷体; b; i} 这段").dropped === 0, "★合法前缀不动 ✓");
  ok(ST.stripStyleClosers("{b}加粗一段").text === "{b}加粗一段", "★{b} 前缀原样保留 ✓");
  ok(ST.stripStyleClosers("题干里写 {c:blue} 是语法说明").dropped === 0, "★正文中间的 {c:blue}（不是闭合）不动 ✓");
  // ③ 去完不留行尾空白 ✓（否则卷面上会多出空格 ✗）
  const b = ST.stripStyleClosers("第一行{/c}   " + NL + "第二行{/b}" + NL);
  ok(b.text === "第一行" + NL + "第二行" + NL, "★去掉标签后不留行尾空白：" + JSON.stringify(b.text));
  // ④ 空 / null 不炸 ✓
  ok(ST.stripStyleClosers("").dropped === 0 && ST.stripStyleClosers(null).dropped === 0, "空与 null 不炸 ✓");
  // ⑤ 手册与规则里写明「没有闭合标签」（从源头少产生 ✓）
  const C = loadBundled("aiPaperChat.ts", "_c34c.cjs");
  ok(C.PAPER_HELP.indexOf("没有闭合标签") > 0, "★手册写明「没有闭合标签」✓");
  ok(C.PAPER_EDIT_RULE.indexOf("没有闭合标签") > 0, "★编辑规则里也写了 ✓（这次就是这么产生的 ✗）");
  ok(ST.STYLE_CLOSER_RULE.indexOf("原样印在卷子上") > 0, "规则里说清后果（会原样印出来 ✗）✓");
}

console.log("=== 用例 33：就地改正文（用户实报「说改成蓝色 → AI 把解答题抄了一遍」✗ v1694）===");
{
  const C = loadBundled("aiPaperChat.ts", "_c33.cjs");
  const doc = ["## 三、解答题", "2. 已知 $f(x)=x^2-2x+1$，求 $f(3)$。", "（1）代入得 4。"].join(String.fromCharCode(10));
  // ① 单处替换：只动那一段，标题不动 ✓
  const a = C.paperEdit(doc, "（1）代入得 4。", "（1）代入得 $f(3)=4$。");
  ok(a.hits === 1 && a.text.indexOf("f(3)=4") > 0 && a.text.indexOf("## 三、解答题") === 0, "★改一处：只动那一段、标题不动 ✓");
  // ② 多行替换：给整节上色 ✓（这正是用户要的「把解答题改成蓝色」✓）
  const sec = "2. 已知 $f(x)=x^2-2x+1$，求 $f(3)$。" + String.fromCharCode(10) + "（1）代入得 4。";
  const blue = "{c:blue}" + sec.split(String.fromCharCode(10)).join(String.fromCharCode(10) + "{c:blue}");
  const b = C.paperEdit(doc, sec, blue);
  ok(b.hits === 1 && b.text.indexOf("{c:blue}2. 已知") > 0 && b.text.indexOf("{c:blue}（1）") > 0, "★多行替换能给整节上色（每行行首 {c:blue} ✓）");
  // ③ 默认只改第一处；all=true 才全改 ✓
  const NL = String.fromCharCode(10);
  const rep = "求 $f(3)$" + NL + "求 $f(3)$" + NL;
  ok(C.paperEdit(rep, "求 $f(3)$", "求 $f(2)$").hits === 1, "默认只改第一处 ✓");
  ok(C.paperEdit(rep, "求 $f(3)$", "求 $f(2)$", true).hits === 2, "★all=true 才全改 ✓");
  // ④ 数学符号按**字面**匹配（$ { } 都不是正则 ✗ —— 卷子里全是这些 ✓）
  ok(C.paperEdit("A. $\\{1\\}$", "$\\{1\\}$", "X").hits === 1, "★$ 与花括号按字面匹配（不当正则 ✓）");
  // ⑤ 没命中：一个字不改 + 回执说清（不装作改好了 ✗）
  const c = C.paperEdit(doc, "不存在的段落", "X");
  ok(c.hits === 0 && c.text === doc, "★没命中 → 原文一字不动 ✓");
  const note = C.paperEditNote("不存在的段落", 0, false);
  ok(note.indexOf("没找到") === 0 && note.indexOf("不存在的段落") > 0, "回执带上没找到的原文片段：" + note.slice(0, 36));
  ok(C.paperEditNote("x", 2, true).indexOf("已改 2 处") === 0, "命中回执说清改了几处 ✓");
  // ⑥ system 里那条「改 vs 加」的规则必须在（否则模型还会复制一份 ✗）
  const sys = C.buildPaperChatSystem();
  ok(sys.indexOf("edit_paper_text") > 0 && sys.indexOf("复制") > 0, "★system 写明：改已有内容用 edit_paper_text，不要复制一份 ✗");
  // ⑦ 工具名单与工具说明 ✓
  const AT = loadBundled("aiTools.ts", "_c33t.cjs");
  ok(C.PAPER_TOOL_NAMES.indexOf("edit_paper_text") >= 0, "工具名单里有 edit_paper_text ✓");
  const t = AT.AI_TOOLS.find((x) => x.function.name === "edit_paper_text");
  ok(!!t && String(t.function.description).indexOf("不要用 append_to_paper") > 0, "★工具说明里直接点了这个错法 ✓");
  ok(!!t && t.function.parameters.required.indexOf("find") >= 0 && t.function.parameters.required.indexOf("replace") >= 0, "find / replace 都是必填 ✓（留空 replace = 删掉那段 ✓）");
}

console.log("=== 用例 32：AI 能不能用上试卷编辑的**全部功能**（工具层 + 语法手册 ✓ v1693）===");
{
  const C = loadBundled("aiPaperChat.ts", "_c32_chat.cjs");
  const AT = loadBundled("aiTools.ts", "_c32_tools.cjs");
  const allNames = AT.AI_TOOLS.map((t) => t.function.name);
  // ① 侧栏给出的工具名，必须**在 AI_TOOLS 里真有**（名字打错就是这个红灯 ✗）
  const missing = C.PAPER_TOOL_NAMES.filter((n) => allNames.indexOf(n) < 0);
  ok(missing.length === 0, "★试卷的 " + C.PAPER_TOOL_NAMES.length + " 个工具在工具表里都存在" + (missing.length ? "，缺：" + missing.join("、") : " ✓"));
  ok(C.paperToolsOf(AT.AI_TOOLS).length === C.PAPER_TOOL_NAMES.length, "★paperToolsOf 一个不漏（" + C.paperToolsOf(AT.AI_TOOLS).length + " 个 ✓）");
  // ② 能力面：读 / 写 / 设置 / 页眉 / 模板 / 数学图形 / 导出 / 题库 / 手册 各有着落 ✓
  const need = ["get_paper_state", "append_to_paper", "set_paper_style", "set_paper_header", "apply_paper_template",
    "insert_paper_figure", "print_paper", "insert_bank_question_to_paper", "search_bank", "get_paper_help", "get_paper_style"];
  const lack = need.filter((n) => C.PAPER_TOOL_NAMES.indexOf(n) < 0);
  ok(lack.length === 0, "★试卷编辑各类能力都有工具（" + need.length + " 项）" + (lack.length ? "，缺 " + lack.join("、") : " ✓"));
  // ③ 语法手册要覆盖各语法族（模型照着写才不会排出乱码 ✗）
  const h = C.PAPER_HELP;
  const fams = [["[题]", "题目块"], ["[选项]", "选项"], ["[解析]", "解析"], ["[分页]", "分页"], ["[图", "图片"],
    ["{c:", "段落样式"], ["$", "公式"], ["numStyle", "题号样式"], ["optLayout", "选项排布"], ["bodyCols", "分栏"],
    ["handout", "模板"], ["{page}", "页脚变量"]];
  const bad = fams.filter((f) => h.indexOf(f[0]) < 0).map((f) => f[1]);
  ok(bad.length === 0, "★手册覆盖 " + fams.length + " 个语法族" + (bad.length ? "，缺：" + bad.join("、") : " ✓"));
  // ④ 手册里把「可改的设置键」写全（与 PaperModal 的 PF 对齐 —— 少一个模型就改不了那项 ✗）
  const keys = ["fontFamily", "fontSize", "fontColor", "lineHeight", "para", "indent", "h2size", "numStyle",
    "optLayout", "autoNum", "bodyCols", "headerText", "footerText", "pdfName", "gapQ", "headerGap", "footerGap"];
  const noKey = keys.filter((k) => h.indexOf(k) < 0);
  ok(noKey.length === 0, "★手册列全了 " + keys.length + " 个设置键" + (noKey.length ? "，缺：" + noKey.join("、") : " ✓"));
  // ⑤ system 里点名了这些能力（不点名它就只会"追加文字" ✗）
  const sys = C.buildPaperChatSystem();
  ok(sys.indexOf("get_paper_help") > 0 && sys.indexOf("set_paper_style") > 0 && sys.indexOf("print_paper") > 0, "★system 点名了手册 / 设置 / 导出 ✓");
  // ⑥ 两个危险动作的说明必须带警告（套模板会**替换正文** ✗；改设置要**只改传进来的键** ✗）
  const tplTool = AT.AI_TOOLS.find((t) => t.function.name === "apply_paper_template");
  ok(String(tplTool.function.description).indexOf("替换正文") > 0, "★套模板会替换正文 —— 工具说明里警告了 ✓（否则模型会随手套掉老师的卷子 ✗）");
  const styleTool = AT.AI_TOOLS.find((t) => t.function.name === "set_paper_style");
  ok(String(styleTool.function.description).indexOf("只改传进来的键") > 0, "set_paper_style 写明「只改传进来的键」✓");
  // ⑦ 插数学图形那条：说明里要指明与画布同一套 kind（否则模型会编种类 ✗）
  const figTool = AT.AI_TOOLS.find((t) => t.function.name === "insert_paper_figure");
  ok(String(figTool.function.description).indexOf("insert_math_figure") > 0, "★插图形写明「种类同 insert_math_figure」✓");
}

console.log("=== 用例 31：试卷 AI 侧栏的口径（工具子集 / 带图 / 闸门 ✓ v1692）===");
{
  const C = loadBundled("aiPaperChat.ts", "_c31_chat.cjs");
  const AT = loadBundled("aiTools.ts", "_c31_tools.cjs");
  // ① 只给试卷用得上的四个工具（幻灯片那套给了它只会乱调 ✗）
  const kept = C.paperToolsOf(AT.AI_TOOLS).map((t) => t.function.name);
  ok(kept.length === C.PAPER_TOOL_NAMES.length && C.PAPER_TOOL_NAMES.every((n) => kept.indexOf(n) >= 0), "★只留试卷用得上的 " + C.PAPER_TOOL_NAMES.length + " 个工具（v1693 从 4 项扩到 11 项 ✓）：" + kept.join("、"));
  ok(kept.indexOf("add_slide") < 0 && kept.indexOf("insert_math_figure") < 0 && kept.indexOf("insert_text") < 0, "★幻灯片工具一个都没给（否则它会以为在改幻灯片 ✗）");
  ok(C.paperToolsOf([]).length === 0 && C.paperToolsOf(null).length === 0, "空表 / null 不炸 ✓");
  // ② 带图 → 多模态数组；不带图 → 纯字符串 ✓
  const plain = C.chatUserContent("加一节填空题", []);
  ok(typeof plain === "string" && plain.indexOf("填空题") >= 0, "不带图就是纯字符串 ✓");
  const withImg = C.chatUserContent("这道题录进去", ["data:image/png;base64,AAA", "data:image/png;base64,BBB"]);
  ok(Array.isArray(withImg) && withImg.length === 3 && withImg[0].type === "text" && withImg[1].image_url.url.indexOf("data:image") === 0, "★带图 → [{text}, {image_url}…]（视觉模型那条路 ✓）");
  const many = C.chatUserContent("x", ["a", "b", "c", "d", "e", "f"]);
  ok(many.length === 1 + C.PAPER_CHAT_MAX_IMG, "★最多带 " + C.PAPER_CHAT_MAX_IMG + " 张（多的丢掉 ✗ 不硬塞）");
  // ③ 发送闸门：忙 / 空 / 正常 ✓
  ok(C.canSendPaperChat("", false, 0).ok === false, "空话不发：" + C.canSendPaperChat("", false, 0).why);
  ok(C.canSendPaperChat("", false, 1).ok === true, "★只丢一张图也能发 ✓");
  ok(C.canSendPaperChat("改一下", true, 0).ok === false, "上一条没跑完不让发 ✓");
  // ④ 附件闸门：数量与体积 ✓
  ok(C.canAttachPaperChat(0, 1024).ok === true, "小图能收 ✓");
  ok(C.canAttachPaperChat(C.PAPER_CHAT_MAX_IMG, 1024).ok === false, "★超过 " + C.PAPER_CHAT_MAX_IMG + " 张就拦：" + C.canAttachPaperChat(C.PAPER_CHAT_MAX_IMG, 1024).why);
  ok(C.canAttachPaperChat(0, 5 * 1024 * 1024).ok === false, "★超过 4MB 就拦（不让它把窗口/接口撑爆 ✗）");
  // ⑤ system 把试卷排版约定写死了（不写它就会用 Markdown 那套 ✗）
  const sys = C.buildPaperChatSystem();
  ok(sys.indexOf("[题]") > 0 && sys.indexOf("[选项]") > 0 && sys.indexOf("[解析]") > 0, "★system 里写了题目块语法 ✓");
  ok(sys.indexOf("$") > 0 && sys.indexOf("[图N]") > 0 && sys.indexOf("[分页]") > 0, "公式 / 图号 / 分页都写了 ✓");
  ok(sys.indexOf("不要凭空编图号") > 0 && sys.indexOf("页眉页脚") > 0, "★两条纪律在：不许编图号 ✗、页眉页脚别写进正文 ✗");
  // ⑥ 摘要 ✓
  ok(C.chatTitleOf("") === "（图片）", "空话的标题写成（图片）✓");
  ok(C.chatTitleOf("一".repeat(50)).length <= 25, "标题会截断 ✓");
}

console.log("=== 用例 30：fixed 浮层挂在带 transform 的容器里 → 会被裁掉（v1691 我自己踩的 ✓）===");
{
  const fso = require("fs");
  const patho = require("path");
  // 背景：我把 AI 对话框挂在 .pm__box 里面，而它是 transform: translate(-50%,-50%) + overflow: hidden ✗ ——
  //   transform 会给 position: fixed 的子孙**重建包含块**（浮层不再是相对视口，而是相对那个盒子 ✓）
  //   → 浮层被框住 / 被裁掉（试卷自带的 .pm__help 就挂在盒子外面 ✓ 我挂错了 ✗）。
  //   这里静态量：浮层（position: fixed + inset: 0）的祖先里，不许出现 transform / filter / perspective ✓
  function tplOf(src) {
    const a = src.indexOf("<template>"), b = src.lastIndexOf("</template>");
    return a >= 0 && b > a ? src.slice(a + 10, b) : "";
  }
  function treeOf(tpl) {
    const root = { cls: [], kids: [] };
    const stack = [root];
    const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
    let m;
    while ((m = re.exec(tpl))) {
      const closing = m[1] === "/", tag = m[2], attrs = m[3] || "";
      const selfClose = m[4] === "/" || /^(br|hr|img|input|meta|link|source|path|circle|rect|line|use|ellipse|polygon|polyline|stop)$/i.test(tag);
      if (closing) { if (stack.length > 1) stack.pop(); continue }
      const cls = [];
      const cm = attrs.match(/(?:^|\s)class\s*=\s*"([^"]*)"/);
      if (cm) cm[1].split(/\s+/).filter(Boolean).forEach((c) => cls.push(c));
      const node = { cls, kids: [] };
      stack[stack.length - 1].kids.push(node);
      if (!selfClose) stack.push(node);
    }
    return root;
  }
  function rulesOf(css) {
    const out = [];
    let i = 0, sel = "";
    while (i < css.length) {
      const ch = css[i];
      if (ch === "{") {
        const s = sel.trim(); sel = "";
        if (s.charAt(0) === "@") { i++; continue }
        let depth = 1, j = i + 1, body = "";
        while (j < css.length && depth > 0) {
          if (css[j] === "{") depth++;
          else if (css[j] === "}") { depth--; if (!depth) break }
          body += css[j]; j++;
        }
        out.push({ sel: s, body }); i = j;
      } else if (ch === "}") sel = "";
      else sel += ch;
      i++;
    }
    return out;
  }
  const files = [];
  (function walk(d) {
    for (const e of fso.readdirSync(d, { withFileTypes: true })) {
      const q = patho.join(d, e.name);
      if (e.isDirectory()) walk(q);
      else if (e.name.endsWith(".vue")) files.push(q);
    }
  })(patho.join(ROOT, "src"));
  const bad = [];
  for (const f of files) {
    const src = fso.readFileSync(f, "utf8");
    const tpl = tplOf(src);
    const sm = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((x) => x[1]).join("\n");
    if (!tpl || !sm) continue;
    const css = sm.replace(/\/\*[\s\S]*?\*\//g, "");
    if (css.indexOf("position: fixed") < 0) continue;
    const trapCls = new Set(), overlayCls = new Set();
    for (const r of rulesOf(css)) {
      const simple = r.sel.split(",").map((s) => s.trim()).filter((s) => /^\.[A-Za-z0-9_-]+$/.test(s));
      // 「重建包含块」的几样：transform（非 none）/ filter / perspective / will-change: transform / contain: paint
      const isTrap = /transform\s*:\s*(?!none)/.test(r.body) || /(^|[;\s])filter\s*:/.test(r.body)
        || /perspective\s*:/.test(r.body) || /will-change\s*:\s*transform/.test(r.body)
      const isOverlay = /position\s*:\s*fixed/.test(r.body) && /inset\s*:\s*0/.test(r.body)
      for (const s of simple) {
        const c = s.slice(1);
        if (isTrap) trapCls.add(c);
        if (isOverlay) overlayCls.add(c);
      }
    }
    const vwalk = (node, trappedIn) => {
      const here = trappedIn || node.cls.some((c) => trapCls.has(c)) ? (node.cls.join(" ") || trappedIn) : trappedIn;
      if (trappedIn && node.cls.some((c) => overlayCls.has(c))) {
        bad.push(patho.basename(f) + " ." + node.cls.join(".") + "（祖先 ." + trappedIn.split(" ")[0] + " 有 transform/filter ✗）");
      }
      for (const k of node.kids) vwalk(k, here);
    };
    vwalk(treeOf(tpl), "");
  }
  ok(bad.length === 0, "★浮层都没挂在带 transform/filter 的容器里" + (bad.length ? "，命中 " + bad.length + " 处：" + bad.join(" ｜ ") : " ✓"));
}

console.log("=== 用例 29：试卷编辑里的 AI（组卷条件 / 排版 / 缺题报告 ✓ v1691）===");
{
  const P = loadBundled("aiPaper.ts", "_c29.cjs");   // aiPaper import 了 @/composables/aiImport → 走打包加载 ✓
  // ① 模型回的组卷条件：能容错收下（围栏 / 中文键 / counts 写成数组 ✓）
  const plan = P.parsePaperPlan("好的：\`\`\`json\n{\"title\":\"解析几何小测\",\"章节\":\"解析几何\",\"知识点\":\"椭圆\",\"难度\":\"中档\",\"题型数量\":[{\"题型\":\"选择题\",\"数量\":2},{\"题型\":\"解答\",\"数量\":1}]}\n\`\`\`", ["解析几何", "数列"]);
  ok(plan.section === "解析几何" && plan.kp === "椭圆" && plan.level === "中档", "★中文键 + 章节归一（" + plan.section + " / " + plan.kp + " / " + plan.level + "）");
  ok(plan.counts.choice === 2 && plan.counts.answer === 1 && plan.counts.blank === 0, "★题型数量数组也认得（选择 2 / 解答 1 ✓）");
  ok(plan.withAnswer === false, "没说带答案 → 默认不带（考卷口径 ✓）");
  ok(P.planTotal(plan) === 3, "总共 3 道 ✓");
  ok(P.planSummary(plan).indexOf("解析几何") >= 0 && P.planSummary(plan).indexOf("选择题 2 道") >= 0, "条件回显给人看：" + P.planSummary(plan));
  // ② 章节不在题库清单里 → 不当章节用，改当关键词 ✓（模型爱自由发挥 ✗）
  const p2 = P.parsePaperPlan({ section: "圆锥曲线综合", counts: { choice: 1 } }, ["解析几何"]);
  ok(p2.section === "" && p2.kp.indexOf("圆锥曲线综合") >= 0, "★认不出的章节 → 降级成关键词（不硬塞 ✗）");
  // ③ 烂输入不炸 ✓
  const p3 = P.parsePaperPlan("模型今天不想干活", []);
  ok(P.planTotal(p3) === 0 && p3.section === "", "非 JSON → 空计划（不炸 ✓）");
  ok(P.parsePaperPlan(null, []).counts.choice === 0, "null 也不炸 ✓");
  // ④ 缺题报告：题库里不够要说清差几道 ✓
  const gaps = P.planGaps(plan, { choice: 1, answer: 1 });
  ok(gaps.length === 1 && gaps[0].indexOf("选择题要 2 道") >= 0, "★缺题说清楚：" + gaps[0]);
  ok(P.planGaps(plan, { choice: 2, answer: 1 }).length === 0, "够了两边都不响 ✓");
  // ⑤ 排版：题目块 + 分大题（空节不写 ✓）
  const blk = P.aiQuestionBlockOf({ stem: "已知椭圆 $C$。", options: ["A. 1", "B. 2"], answer: "A", analysis: "由定义得", qtype: "choice", section: "", kp: [], level: "中档", difficulty: 3 }, 1);
  ok(blk.indexOf("[题]") === 0 && blk.indexOf("1. 已知椭圆") > 0 && blk.indexOf("[选项]") > 0 && blk.indexOf("A．1") > 0 && blk.indexOf("A．A.") < 0 && blk.indexOf("[/题]") > 0, "题目块排版与题库那份一致（[题]/[选项]/[解析]/[/题] ✓）");
  const doc = P.paperDocOf("解析几何小测", [
    { heading: "一、选择题", blocks: [blk] },
    { heading: "二、多选题", blocks: [] },
  ]);
  ok(doc.indexOf("# 解析几何小测") === 0, "标题成 # 行 ✓");
  ok(doc.indexOf("## 一、选择题") > 0 && doc.indexOf("## 二、多选题") < 0, "★有题的大题才写（空节不写 ✗）");
  // ⑥ 出题提示词：把条件和题量写进去 ✓
  const mk = P.buildMakePrompt(plan, 3);
  ok(mk.system.indexOf("命制 3 道") > 0 && mk.system.indexOf("analysis") > 0, "出题提示词带题量与解析要求 ✓");
  ok(mk.user.indexOf("解析几何") >= 0 && mk.user.indexOf("椭圆") >= 0, "条件进 user（章节 + 知识点 ✓）");
  ok(mk.system.indexOf("不要出需要配图的题") > 0, "明确不要配图题（这里插不了图 ✗）");
}

console.log("=== 用例 28：AI 抽出来的题怎么挂上 MinerU 的图（v1690 修「图形丢失」✓）===");
{
  const MI = loadBundled("mineruImages.ts", "_c28_mi.cjs");
  // 背景（用户实报「试题库导入 PDF 后图形丢失」✗）：上一版 AI 导入把 MinerU 的插图标记**去掉**了，
  //   而用户最近两批都是 ai_extract（19 道），草稿 extra 里没有图 ✗。
  //   现在走的是和「录入试题」同一套：正文留 [图N] → 按引用挂 → 没人认领的按位置兜底（并标 warn ✓）。
  const text = "已知抛物线求焦点。\n[图1]\n如图四棱锥。\n[图2]\n求导。\n[图3]\n";
  const imgs = [
    { n: 1, src: "data:image/jpeg;base64,AAA", caption: "图1" },
    { n: 2, src: "data:image/jpeg;base64,BBB", caption: "" },
    { n: 3, src: "data:image/jpeg;base64,CCC", caption: "" },
  ];
  const marks = { 1: text.indexOf("[图1]"), 2: text.indexOf("[图2]"), 3: text.indexOf("[图3]") };
  const qs = [
    { stem: "已知抛物线求焦点。\n[图1]", options: [], solution: "" },
    { stem: "如图四棱锥。", options: [], solution: "" },
    { stem: "求导。", options: [], solution: "" },
  ];
  const a0 = MI.imagesForText(MI.questionTextOf(qs[0]), imgs);
  ok(a0.length === 1 && a0[0].n === 1, "★题干里带 [图1] → 就挂第 1 张（不多挂 ✓）");
  for (const q of qs) { const got = MI.imagesForText(MI.questionTextOf(q), imgs); if (got.length) q.images = got; }
  ok(!qs[1].images && !qs[2].images, "没引用图的题先不硬塞（交给兜底那步 ✓）");
  const r = MI.attachOrphans(text, qs, imgs, marks, undefined);
  const total = qs.reduce((n, q) => n + (q.images || []).length, 0);
  ok(total === 3, "★三张图最后都在题上（" + total + "/" + imgs.length + "）—— 一张都没丢 ✓");
  ok((qs[1].images || []).some((x) => x.n === 2) && (qs[2].images || []).some((x) => x.n === 3), "★没人引用的图按位置兜底挂到**前一道题** ✓");
  ok(r.orphans.length === 2 && !!qs[1].warn && !!qs[2].warn, "★兜底挂的会标 warn 让人核对（不静默 ✓）：" + String(qs[1].warn || "").slice(0, 24));
  const AI = require(path.join(ROOT, "src", "composables", "aiImport.ts"));
  const pr = AI.buildExtractPrompt("第 1 题 …", {});
  ok((pr.system + pr.user).indexOf("[图1]") >= 0, "★提示词要求模型**原样保留** [图N] 插图标记 ✓");
}

console.log("=== 用例 27：扫描件 PDF 走哪条路（v1689 用户有 MinerU key ✓）===");
{
  const AI = require(path.join(ROOT, "src", "composables", "aiImport.ts"));
  // 背景：用户那份（以及桌面上那一批）试卷 PDF 都是扫描件，本地抽不出文字 ✗。
  //   有 MinerU token（mineru.net 免费申请 ✓）就走精准解析；网页预览没有内核，有 token 也发不出请求 ✗。
  ok(AI.scanPath({ desktop: true, hasToken: true }) === "mineru", "★桌面端 + 有 token → 走 MinerU 精准解析 ✓");
  ok(AI.scanPath({ desktop: true, hasToken: false }) === "paste", "桌面端但没 token → 让老师贴文字（不硬调 ✗）");
  ok(AI.scanPath({ desktop: false, hasToken: true }) === "paste", "★网页预览即使有 token 也不走（没有内核，请求发不出去 ✗）");
  ok(AI.scanPath({ desktop: false, hasToken: false }) === "paste", "两个都没有 → 贴文字 ✓");
  ok(AI.scanPath({ desktop: true, hasToken: true }) === "mineru" && AI.scanPath({ desktop: true, hasToken: false }) !== "mineru", "★半有条件时不冒充能走 ✓");
}

console.log("=== 用例 26：原文够不够 AI 读（扫描件 PDF 的判定 ✓）===");
{
  const AI = require(path.join(ROOT, "src", "composables", "aiImport.ts"));
  // 背景（用户实报「导入PDF → AI抽题 → 未抽到题目」✗）：那份 PDF 没有文字层（/Font 0 个、10 页每页一张整页图），
  //   本地解析只吐出 <!--font:22--> 这一条标记（14 字符）—— 以前照样送去抽题，模型只能回「没找到题目」✗。
  ok(AI.readableChars("<!--font:22-->") === 0, "★PDF 解析器塞的 <!--font:22--> 不算可读字符（" + AI.readableChars("<!--font:22-->") + "）");
  ok(AI.readableChars("<!--font:22-->\n") === 0 && AI.readableChars("   \n\t ") === 0, "只有标记 / 只有空白 → 都是 0 ✓");
  ok(AI.tooThinForAi("<!--font:22-->") === true, "★扫描件那 14 个字符 → 判定「太空」，不该去问模型 ✓");
  ok(AI.tooThinForAi("<!--a--><!--b-->") === true && AI.tooThinForAi("") === true, "多段标记 / 空串也拦下 ✓");
  const real = "第 1 题 已知抛物线 y^2=4x，求焦点坐标。A. (1,0) B. (0,1)";
  ok(AI.readableChars(real) === real.replace(/\s+/g, "").length, "正常原文：只扣空白，字数对得上（" + AI.readableChars(real) + "）");
  ok(AI.tooThinForAi(real) === false, "★有真内容 → 放行 ✓");
  ok(AI.tooThinForAi("题干1", 3) === false && AI.tooThinForAi("题干", 3) === true, "阈值可调（默认 20 ✓）");
}

console.log("=== 用例 25：浮层被 pointer-events 继承坑掉（真鼠标点不动 ✗）===");
{
  const fsp = require("fs");
  const pathp = require("path");
  // 背景（用户实报「AI 打标窗口无法关闭」✗）：补答案 / AI 打标 / 来源报告这三个内联浮层挂在 .qb 下面，
  //   而 .qb 是 pointer-events:none（v1472 为了"不挡画布"加的 ✓）——而 pointer-events 是**继承属性** ✗，
  //   浮层自己没写回 auto → 整层收不到点击，鼠标**穿过去**落到背后的 .qb__box
  //   （现象很怪：浮层里的「关闭」点不动，背后的「试题库 ✕」反倒管用 ✗）。
  //   同 .qi（v1616 踩过）/ .dbx / .aiq 的写法：模态浮层必须显式写 pointer-events: auto ✓。
  //   这里静态量：凡"祖先设了 none"的子树里，全屏浮层（position: fixed|absolute + inset: 0）必须自己写 ✓
  function tplOf(src) {
    const a = src.indexOf("<template>"), b = src.lastIndexOf("</template>");
    return a >= 0 && b > a ? src.slice(a + 10, b) : "";
  }
  function treeOf(tpl) {
    const root = { cls: [], inlineNone: false, kids: [] };
    const stack = [root];
    const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
    let m;
    while ((m = re.exec(tpl))) {
      const closing = m[1] === "/", tag = m[2], attrs = m[3] || "";
      const selfClose = m[4] === "/" || /^(br|hr|img|input|meta|link|source|path|circle|rect|line|use|ellipse|polygon|polyline|stop)$/i.test(tag);
      if (closing) { if (stack.length > 1) stack.pop(); continue }
      const cls = [];
      const cm = attrs.match(/(?:^|\s)class\s*=\s*"([^"]*)"/);
      if (cm) cm[1].split(/\s+/).filter(Boolean).forEach((c) => cls.push(c));
      const bm = attrs.match(/:class\s*=\s*"([^"]*)"/);
      if (bm) (bm[1].match(/'([^']+)'/g) || []).forEach((q) => cls.push(q.replace(/'/g, "")));
      const node = { cls, inlineNone: /style\s*=\s*"[^"]*pointer-events\s*:\s*none/.test(attrs), kids: [] };
      stack[stack.length - 1].kids.push(node);
      if (!selfClose) stack.push(node);
    }
    return root;
  }
  function rulesOf(css) {
    const out = [];
    let i = 0, sel = "";
    while (i < css.length) {
      const ch = css[i];
      if (ch === "{") {
        const s = sel.trim(); sel = "";
        if (s.charAt(0) === "@") { i++; continue }
        let depth = 1, j = i + 1, body = "";
        while (j < css.length && depth > 0) {
          if (css[j] === "{") depth++;
          else if (css[j] === "}") { depth--; if (!depth) break }
          body += css[j]; j++;
        }
        out.push({ sel: s, body }); i = j;
      } else if (ch === "}") sel = "";
      else sel += ch;
      i++;
    }
    return out;
  }
  const vueFiles = [];
  (function walk(d) {
    for (const e of fsp.readdirSync(d, { withFileTypes: true })) {
      const q = pathp.join(d, e.name);
      if (e.isDirectory()) walk(q);
      else if (e.name.endsWith(".vue")) vueFiles.push(q);
    }
  })(pathp.join(ROOT, "src"));
  const vpBad = [];
  let vpChecked = 0;
  for (const f of vueFiles) {
    const src = fsp.readFileSync(f, "utf8");
    const tpl = tplOf(src);
    const sm = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((x) => x[1]).join("\n");
    if (!tpl || !sm) continue;
    const css = sm.replace(/\/\*[\s\S]*?\*\//g, "");
    if (!/pointer-events\s*:\s*none/.test(css)) continue;
    vpChecked++;
    const noneCls = new Set(), overlayCls = new Set();
    for (const r of rulesOf(css)) {
      const simple = r.sel.split(",").map((s) => s.trim()).filter((s) => /^\.[A-Za-z0-9_-]+$/.test(s));
      const isNone = /pointer-events\s*:\s*none/.test(r.body);
      const isOverlay = /position\s*:\s*(fixed|absolute)/.test(r.body) && /inset\s*:\s*0/.test(r.body);
      for (const s of simple) {
        const c = s.slice(1);
        if (isNone) noneCls.add(c);
        if (isOverlay && !/pointer-events\s*:/.test(r.body)) overlayCls.add(c);
      }
    }
    const vwalk = (node, underNone) => {
      const here = underNone || node.cls.some((c) => noneCls.has(c)) || node.inlineNone;
      if (underNone && node.cls.some((c) => overlayCls.has(c))) vpBad.push(pathp.basename(f) + " ." + node.cls.join("."));
      for (const k of node.kids) vwalk(k, here);
    };
    vwalk(treeOf(tpl), false);
  }
  ok(vpBad.length === 0, "★" + vpChecked + " 个含 pointer-events:none 的文件里，浮层都自己写回了 auto" + (vpBad.length ? "，还有 " + vpBad.length + " 处：" + vpBad.join(" ｜ ") : ""));
}

console.log("=== 用例 24：模板静态体检（属性掉成正文 = 界面上会露出 Vue 代码 ✗）===");
{
  const fsx = require("fs");
  const pathx = require("path");
  // 背景（用户截图报的 ✓）：v1679 把课件库/试题库挪到工具条时，一行 button 的 title 后面**多写了一个 ">"** ——
  //   标签被提前闭合，后面的 @click="setViewMode(…)" 成了**正文文本**，整串显示在工具条上 ✗。
  //   类型检查抓不到（对编译器来说那就是一段文字 ✓），所以这里 ① 扫源码 ② 再扫构建产物 ✓。
  const BAD = /(^|[^=!<>-])>\s+(?:@|:|v-)[A-Za-z-]+\s*=/;
  const files = [];
  (function walk(d) {
    for (const e of fsx.readdirSync(d, { withFileTypes: true })) {
      const p = pathx.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".vue")) files.push(p);
    }
  })(pathx.join(ROOT, "src"));
  const bad = [];
  for (const f of files) {
    const src = fsx.readFileSync(f, "utf8");
    // ⚠ 取模板段要用**最后一个** </template>：内层 v-for 也有 <template>，非贪婪匹配会在那里就断掉，
    //   后半段模板根本扫不到 ✗（v1687 做用例 25 时踩到，回头把这里一起修了 ✓）
    const ta = src.indexOf("<template>"), tb = src.lastIndexOf("</template>");
    if (ta < 0 || tb <= ta) continue;
    const tpl = src.slice(ta + 10, tb).replace(/<!--[\s\S]*?-->/g, "");   // 注释里写 @click 是说明，不算 ✗
    tpl.split("\n").forEach((line, i) => {
      const t = line.trim();
      if (t.charAt(0) !== "<") return;                   // 只看标签行
      if (BAD.test(line)) bad.push(pathx.basename(f) + ":" + (i + 1) + " " + t.slice(0, 60));
    });
  }
  ok(bad.length === 0, "★" + files.length + " 个 .vue 的模板里没有『标签被提前闭合、属性掉成正文』的写法" + (bad.length ? "：" + bad.join(" ｜ ") : ""));

  // ② 产物兜底：dist 里不该出现字面量 @click= 这种指令文本（v1679~v1684 就是这么漏到真机上的 ✗）
  const distAssets = pathx.join(ROOT, "dist", "assets");
  if (!fsx.existsSync(distAssets)) {
    console.log("  · 没有 dist/assets，跳过产物检查（npm run build 之后再跑一次 ✓）");
  } else {
    let leaked = 0;
    for (const f of fsx.readdirSync(distAssets)) {
      if (!f.endsWith(".js")) continue;
      leaked += fsx.readFileSync(pathx.join(distAssets, f), "utf8").split("@click=").length - 1;
    }
    ok(leaked === 0, "★构建产物里没有漏出来的 @click= 文本（实测 " + leaked + " 处）");
  }
}

// 用例 24 是**同步块**（同用例 20 / 22）：加载时就跑完了，不进这条异步链 ✗（挂进来会 CASE24 未定义 ✗）
CASE15.then(() => CASE16).then(() => CASE19).then(() => CASE21).then(() => CASE23).then(() => CASE35).then(() => CASE41).then(() => CASE43).then(() => CASE44).then(() => CASE45).then(() => CASE46).then(() => CASE47).then(() => CASE48).then(() => CASE49).then(() => CASE50).then(() => CASE51).then(() => CASE52).then(() => CASE53).then(() => CASE54).then(() => CASE55).then(() => CASE56).then(() => CASE57).then(() => CASE58).then(() => CASE59).then(() => CASE60).then(() => {
console.log("=== 渲染检查：竖直弦在 SVG 里是不是真竖线 ===");
for (const R of results) {
  if (!R.spec.lines.some((L) => L.vertical)) continue;
  const box = M.figureBox(R.spec.kind, W) || { w: W, h: 392 };
  const svg = M.conicFigure(R.spec.kind, box.w, box.h, "#1a1a1a", 3, "transparent", R.spec.params, { pointLabels: R.spec.points.map((p) => p.label) });
  const segs = [...svg.matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)].map((m) => m.slice(1).map(Number));
  const svgBox = M.figureBox(R.spec.kind, W) || { w: W, h: 392 };
  const pv = M.withParams(R.spec.kind, R.spec.params);
  const def = M.CONICS[R.spec.kind];
  const view = def.viewOf ? def.viewOf(pv) : def.view;
  const mm = M.mapper(view, svgBox.w, svgBox.h);
  for (const L of R.spec.lines.filter((q) => q.vertical)) {
    // 弦的两个端点应当落在 (m, s) 与 (m, e) 的像素位置上（坐标轴那条不算：它的 y 跨满框）
    const yLo = Math.min(mm.Y(L.s), mm.Y(L.e)), yHi = Math.max(mm.Y(L.s), mm.Y(L.e));
    const want = segs.find((q) => Math.abs(q[0] - q[2]) < 0.01 && Math.abs(q[0] - mm.X(L.m)) < 0.6 && Math.abs(Math.min(q[1], q[3]) - yLo) < 0.6 && Math.abs(Math.max(q[1], q[3]) - yHi) < 0.6);
    ok(!!want, R.name + "：竖直弦 x=" + L.m + " 真的画在 (m,s)-(m,e) 上（像素 x=" + mm.X(L.m).toFixed(1) + "，y " + mm.Y(L.e).toFixed(1) + "→" + mm.Y(L.s).toFixed(1) + "）");
  }
}

console.log("=== 用例 61：立体几何复刻的确定性校验 + AI 还原接线（v1739）===");
const G3 = loadBundled("geom3dCheck.ts", "_c61g.cjs");
const CUBE = { vertices: { A: [-1, -1, -1], B: [1, -1, -1], C: [1, -1, 1], D: [-1, -1, 1], A1: [-1, 1, -1], B1: [1, 1, -1], C1: [1, 1, 1], D1: [-1, 1, 1] },
  faces: [["A", "B", "C", "D"], ["A1", "B1", "C1", "D1"], ["A", "B", "B1", "A1"], ["B", "C", "C1", "B1"], ["C", "D", "D1", "C1"], ["D", "A", "A1", "D1"]],
  auxiliary: [{ from: "A", to: "C1" }] };
const c1 = G3.geom3dIssues(CUBE);
ok(c1.errs.length === 0 && c1.verts === 8 && c1.faces === 6, "★正方体结构自检通过（顶点 8 / 面 6 / 无错 ✓）");
const c2 = G3.geom3dIssues({ vertices: { A: [0, 0, 0], B: [1, 0, 0], C: [1, 1, 0], D: [0, 1, 0.5] }, faces: [["A", "B", "C", "D"]] });
ok(c2.errs.join("|").indexOf("不共面") >= 0, "★四点不共面 → 报出来 ✗（面表写错会让虚实线判错 ✓）");
const c3 = G3.geom3dIssues({ vertices: { A: [0, 0, 0], B: [1, 0, 0], C: [0, 1, 0] }, faces: [["A", "B", "Z"]] });
ok(c3.errs.join("|").indexOf("不存在的顶点") >= 0, "★面里引用了不存在的顶点 → 报出来 ✗");
const c4 = G3.geom3dIssues({ vertices: { A: [0, 0, 0], A2: [0, 0, 0], B: [1, 0, 0] }, faces: [["A", "A2", "B"]] });
ok(c4.errs.join("|").indexOf("重合") >= 0, "★两个顶点重合（退化）→ 报出来 ✗");
const c5 = G3.geom3dIssues({ vertices: { A: [0, 0, 0], B: [1, 0, 0], C: [0, 1, 0] }, faces: [["A", "B", "C"]], auxiliary: [{ from: "A", to: "Z9" }] });
ok(c5.errs.join("|").indexOf("auxiliary") >= 0, "★辅助线指向不存在的点 → 报出来 ✗");
const c6 = G3.geom3dIssues({ vertices: { A: [0, 0, 0], B: [1, 0, 0], C: [0, 1, 0], P: [9, 9, 9] }, faces: [["A", "B", "C"]] });
ok(c6.warns.join("|").indexOf("没被任何面") >= 0, "★孤立顶点（谁都不引用）→ 提示而不是报错 ✓");
const c7 = G3.geom3dIssues({ primitive: { type: "cylinder", r: -1, h: 2 } });
ok(c7.errs.join("|").indexOf("半径") >= 0, "★primitive 半径是负数 → 报出来 ✗");
const p1 = G3.parseGeom3dText("好的，这是结构：\n```json\n{\"vertices\":{\"A\":[0,0,0],\"B\":[1,0,0],\"C\":[0,1,0]}}\n```\n希望能帮到你");
ok(!!p1.model && !p1.error && Object.keys(p1.model.vertices).length === 3, "★模型文本 → 结构：剥掉围栏与前后废话，抠出 JSON ✓");
ok(!!G3.parseGeom3dText("抱歉我不能").error, "★模型没回 JSON → 如实报错（不抛异常 ✓）");
ok(G3.geom3dLines(c1).join("|").indexOf("自检通过") >= 0 && G3.geom3dLines(c2).join("|").indexOf("问题") >= 0, "★结论写成给老师看的一段话 ✓");
const g3vue = fs.readFileSync(path.join(ROOT, "src", "components", "Geom3DDialog.vue"), "utf8");
ok(g3vue.indexOf("aiChat(") > 0 && g3vue.indexOf("parseGeom3dText(") > 0 && g3vue.indexOf("GEOM3D_PROMPT") > 0, "★复刻窗口接上了应用内 AI（不再是复制提示词那套人工搬运 ✓）");
ok(g3vue.indexOf("geom3dIssues(") > 0 && g3vue.indexOf("checkMsg") > 0, "★复刻窗口会做确定性自检并把结论显示出来 ✓");
ok(g3vue.indexOf("askAi") > 0 && g3vue.indexOf("让 AI 还原结构") > 0, "★界面上有「让 AI 还原结构」按钮 ✓");
  /* ⑳【v1740】这类 bug 探针得管：**被顶层立即调用的函数，它引用的 ref 必须声明在调用之前** ✗
   *    v1739 我把 checkMsg 插在 parse() 之后 → TDZ → 一开三维窗口就 ReferenceError → 用户看到"三维立体图不见了" ✗
   */
  const g3src = fs.readFileSync(path.join(ROOT, "src", "components", "Geom3DDialog.vue"), "utf8");
  const iDecl = g3src.indexOf("const checkMsg = ref(");
  const mTop = /^parse\(\)$/m.exec(g3src);
  ok(iDecl >= 0 && !!mTop && iDecl < mTop.index, "★checkMsg 必须声明在**顶层 parse() 调用之前**（v1739 插在后面 → TDZ 崩 ✗ v1740 修 ✓）");
  const iAIrow = g3src.indexOf("让 AI 还原结构");
  const iRawBox = g3src.indexOf('v-model="raw"');
  ok(iAIrow >= 0 && iRawBox >= 0 && iAIrow < iRawBox, "★AI 入口要在 JSON 文本框**之前**（放最下面＝找不到 ✗）");
  const pal = fs.readFileSync(path.join(ROOT, "src", "components", "MathFigurePalette.vue"), "utf8");
  ok(pal.indexOf("? 3 : g.list.length") >= 0 && pal.indexOf("三维立体图…") > 0 && pal.indexOf("AI 还原结构…") < 0, "★「图形重建」3 张卡、没有重复的 AI 卡片（用户实报两张卡看着一样 —— 它们本来就是同一个动作 ✗ v1746 删掉重复 ✓）");
console.log("=== 用例 62：自图片重建加 AI 读图（v1741）===");
const VA = loadBundled("vecAi.ts", "_c62v.cjs");
const va1 = VA.parseVecAi('好的：\n```json\n{"points":[{"name":"A","x":0.1,"y":0.2},{"name":"B","x":0.9,"y":0.2},{"name":"C","x":0.5,"y":0.8}],"lines":[["A","B",0],["B","C",1],["C","A",0]],"circles":[],"note":"三角形 ABC"}\n```');
ok(!!va1.draft && !va1.error && va1.draft.pts.length === 6 && va1.draft.edges.length === 3, "★AI 回 JSON → 草稿：3 点 3 线 ✓（剥围栏 / 前后废话 ✓）");
ok(va1.draft.labels.join(",") === "A,B,C" && va1.draft.edges[1][2] === 1, "★字母照抄 ✓ 虚线标记认得出（BC 是虚线 ✓）");
const va2 = VA.parseVecAi('{"points":[{"name":"A","x":12,"y":0.2},{"name":"B","x":2,"y":0.2}],"lines":[["A","Z",0],["A","B",0],["A","B",0]]}');
ok(va2.draft.pts[0] === 0.12 && va2.draft.pts[2] === 0.02, "★坐标夹取：12（当百分比）→ 0.12、2 → 0.02 ✓（模型给百分比也不怕 ✓）");
ok(va2.draft.edges.length === 1, "★指向不存在顶点的线丢掉 ✓ 重复线去重 ✓");
const va3 = VA.parseVecAi('{"points":[{"x":"0.4","y":"0.6"}],"circles":[{"x":0.5,"y":0.5,"r":0.2},{"x":0.5,"y":0.5,"r":0}]}');
ok(!!va3.draft && va3.draft.pts.length === 2 && va3.draft.arcs.length === 1, "★字符串数字也认 ✓ 半径非正的圆丢掉 ✓");
ok(!!VA.parseVecAi("抱歉我不能").error, "★没回 JSON → 如实报错（不抛异常 ✓）");
ok(!!VA.parseVecAi('{"lines":[["A","B",0]]}').error, "★一个顶点都没有 → 报错（不给空草稿 ✗）");
ok(VA.vecAiSummary(va1.draft).indexOf("3 个点") >= 0 && VA.VEC_AI_SYSTEM.indexOf("归一化") > 0, "★摘要与系统提示都在（坐标归一化写清楚了 ✓）");
const vdsrc = fs.readFileSync(path.join(ROOT, "src", "components", "VectorizeDialog.vue"), "utf8");
ok(vdsrc.indexOf("ai_chat_raw") > 0 && vdsrc.indexOf("VEC_AI_SYSTEM") > 0, "★窗口接上了带图的 AI 通道 ✓（ai_chat_raw + 系统提示 ✓）");
ok(vdsrc.indexOf("pushUndo()") > 0 && vdsrc.indexOf("parseVecAi(") > 0, "★AI 结果先留快照再替换（可 Ctrl+Z 撤回 ✓）");
ok(vdsrc.indexOf("vd__airow") > 0 && vdsrc.indexOf("AI 读图") > 0, "★界面上有「🤖 AI 读图」入口 ✓");
ok(vdsrc.indexOf("max-width: 1400px") > 0 && vdsrc.indexOf("min(66vw, 900px)") > 0, "★窗口与画布视口都放大了（1400px / 66vw×900 ✓ 用户要的「扩大」✓）");
console.log("=== 用例 63：用户可见的文字里不许出现 **（v1733 修过一回，v1741 我又犯了一次）===");
const CK3 = loadBundled("geom3dCheck.ts", "_c63a.cjs");
const AN3 = loadBundled("ggbAnim.ts", "_c63b.cjs");
const TE3 = loadBundled("ggbTeach.ts", "_c63c.cjs");
const DR3 = loadBundled("ggbDrag.ts", "_c63d.cjs");
const bad46 = CK3.geom3dLines(CK3.geom3dIssues({ vertices: { A: [0, 0, 0], B: [1, 0, 0], C: [1, 1, 0], D: [0, 1, 0.5] }, faces: [["A", "B", "C", "D"]] })).join(" ");
ok(bad46.indexOf("**") < 0 && bad46.indexOf("不共面") >= 0, "★结构自检那段话没有 **（用户直接看得到 ✓）");
const ap3 = AN3.animPlan(AN3.animParseSpec("s|continuous|6").spec, ["s"]);
const ap3b = AN3.animPlan(AN3.animParseSpec("s|ping_pong|6|0|10").spec, ["s"]);
ok(AN3.animDescribe(ap3).join(" ").indexOf("**") < 0 && AN3.animDescribe(ap3b).join(" ").indexOf("**") < 0, "★动画说明没有 ** ✓");
ok(TE3.aidsDescribe(TE3.aidsPlan("显示辅助", "h", ["h"])).join(" ").indexOf("**") < 0, "★教学辅助说明没有 ** ✓");
ok(DR3.judgeDrag([{ name: "D", def: "Point(c)", exprs: ["abs(D)"] }], [0.001], [0.5]).lines.join(" ").indexOf("**") < 0, "★拖动测试结论没有 ** ✓");
const vd3 = fs.readFileSync(path.join(ROOT, "src", "components", "VectorizeDialog.vue"), "utf8");
const vdMsgs = (vd3.match(/(aiMsg\.value\s*=\s*|aiSay[^=]*=\s*)?['"][^'"]*\*\*[^'"]*['"]/g) || []).filter((x) => x.indexOf("//") < 0 && x.indexOf("* ") < 0).join(" | ");
ok(vd3.indexOf("'读图要用**视觉模型**") < 0 && vd3.indexOf('title="把这张图交给**视觉模型**') < 0, "★「自图片重建」的提示条与按钮 title 里没有 ** ✓（截图里那条 ✗）");
ok(vdMsgs.length === 0, "★「自图片重建」里再没有用户可见的 ** 字符串 ✓" + (vdMsgs ? "（还有：" + vdMsgs.slice(0, 80) + " ✗）" : ""));
const g3v3 = fs.readFileSync(path.join(ROOT, "src", "components", "Geom3DDialog.vue"), "utf8");
ok((g3v3.match(/aiMsg\.value\s*=\s*['"][^'"]*\*\*/g) || []).length === 0 && (g3v3.match(/checkMsg\.value\s*=\s*['"][^'"]*\*\*/g) || []).length === 0, "★三维窗口给用户看的提示里没有 ** ✓");
const vdlab = fs.readFileSync(path.join(ROOT, "src", "components", "VectorizeDialog.vue"), "utf8");
ok(vdlab.indexOf(".vd__lab, .vd__lab * { pointer-events: none; }") >= 0, "★顶点字母层对指针透明（用户实报：字母盖住点、点选不中 ✗ v1743 修 ✓）");
console.log("=== 用例 64：自图形重建的「补一个点」+ 点合并/线合并入口（v1744）===");
const VE = loadBundled("vecEdit.ts", "_c64v.cjs");
/* ① 补自由点：加在末尾、边不动 */
const d0 = { pts: [0, 0, 1, 0], edges: [[0, 1, 0]] };
const r1 = VE.addPointAt(d0, 0.5, 0.5);
ok(r1.kind === "point" && r1.at === 2 && r1.pts.length === 6 && r1.edges.length === 1 && r1.split === -1, "★补一个自由点：顶点 +1、边不变 ✓");
ok(d0.pts.length === 4 && d0.edges.length === 1, "★纯函数：**不改入参**（原草稿没被动过 ✓ 撤销才有意义 ✓）");
/* ② 点在线上：把那条线劈成两段，新点落在线上 */
const r2 = VE.addPointAt({ pts: [0, 0, 1, 0], edges: [[0, 1, 0]] }, 0.5, 0.002);
ok(r2.kind === "point" && r2.split === 0 && r2.edges.length === 2, "★点在线上 → 那条线**劈成两段** ✓（" + JSON.stringify(r2.edges) + "）");
ok(r2.edges.some((e) => e[0] === 0 && e[1] === 2) && r2.edges.some((e) => e[0] === 2 && e[1] === 1), "★两段是 0–新点 与 新点–1 ✓（新点确实落在那条线上 ✓）");
/* ③ 虚线也保持 */
const r3 = VE.addPointAt({ pts: [0, 0, 1, 0], edges: [[0, 1, 1]] }, 0.5, 0.002);
ok(r3.edges.every((e) => e[2] === 1), "★劈出来的两段**虚线也保持** ✓（原来虚的不会变实 ✗）");
/* ④ 点在已有顶点上：不加，只让调用方选中它 */
ok(VE.addPointAt({ pts: [0, 0, 1, 0], edges: [] }, 0.004, 0.003).kind === "vertex", "★贴在已有顶点上 → **不重复加** ✓（返回那个顶点让界面选中它 ✓）");
/* ⑤ 点到线段的距离（判"贴着这条线"用 ✓） */
ok(Math.abs(VE.segDist(0.5, 0.1, 0, 0, 1, 0) - 0.1) < 1e-9 && Math.abs(VE.segDist(2, 0, 0, 0, 1, 0) - 1) < 1e-9, "★点到线段距离 ✓（垂直 0.1 ✓ 越过端点按端点算 1 ✓）");
/* ⑥ 界面接线：按钮 + 模式 + 纯模块 + 原有的合并入口都在 */
const vdsrc64 = fs.readFileSync(path.join(ROOT, "src", "components", "VectorizeDialog.vue"), "utf8");
ok(vdsrc64.indexOf("addPointAt(") > 0 && vdsrc64.indexOf("const addPtMode = ref(false)") > 0, "★弹窗接上了补点（模式 + 调用纯函数 ✓）");
ok(vdsrc64.indexOf("＋ 补一个点") > 0 && vdsrc64.indexOf("结束补点") > 0, "★工具栏有「＋ 补一个点」按钮 ✓（点一下进入/退出 ✓）");
ok(vdsrc64.indexOf("mergeSelectedVertices") > 0 && vdsrc64.indexOf("straightenSelected") > 0, "★点合并 / 线合并的入口都在 ✓（M / L ✓）");
ok(vdsrc64.indexOf("合并成一个点") < 0 && vdsrc64.indexOf("拉成一条边") < 0, "★旧文案都清掉了（合并成一个点 / 拉成一条边 ✗ 现在统一叫「合并选中的点（点合并）」「线合并（拉直）」✓）");
ok(vdsrc64.indexOf("线合并（拉直）") > 0 && vdsrc64.indexOf("合并选中的点（点合并）") > 0, "★合并类按钮**只在工具栏一处**、名字不混 ✓（用户实报：选区行那两个跟工具栏「看着是一样的」✗ v1746 去重 ✓）");
console.log("=== 用例 65：补的点是受约束的点（v1744）===");
const VE65 = loadBundled("vecEdit.ts", "_c65v3.cjs");
/* ① 落在**选中的那条线段**上：给出约束 a/b/t ✓ 并按点击位置投影 ✓ */
const r65 = VE65.addPointOnEdge({ pts: [0, 0, 1, 1], edges: [[0, 1, 0]] }, 0, 0.25, 0.25);
ok(!!r65 && r65.a === 0 && r65.b === 1 && Math.abs(r65.t - 0.25) < 1e-9 && r65.pts.length === 6, "★选中线段上加点：带出约束 a/b/t ✓（t = " + (r65 && r65.t) + " ✓）");
ok(!!r65 && r65.edges.length === 2 && r65.edges.every((e) => e[2] === 0), "★那条线劈成两段且虚实保持 ✓");
/* ② 端点一动，受约束的点**仍然在线上**（这是"受约束"的定义 ✓） */
const p65 = r65.pts.slice();
p65[0] = 0; p65[1] = 1; p65[2] = 2; p65[3] = 2;                  // 把端点 0 挪走
const rc65 = VE65.resolveConstrained(p65, [null, null, { a: 0, b: 1, t: r65.t }], r65.edges);
const cross65 = Math.abs((rc65.pts[4] - p65[0]) * (p65[3] - p65[1]) - (rc65.pts[5] - p65[1]) * (p65[2] - p65[0]));
ok(cross65 < 1e-6, "★端点动了 → 受约束的点仍在线上 ✓（叉积残差 " + cross65.toExponential(1) + " ✓）");
/* ③ 那条边没了 → **解除约束但不删点** ✓ */
const gone65 = { pts: p65, cons: VE65.pruneCons([null, null, { a: 0, b: 1, t: r65.t }], []) };
ok(gone65.cons[0] === null && gone65.pts.length === 6, "★两条半边都没了 → 解除约束、点保留 ✓（不静默删人东西 ✓）");
const keep65 = VE65.pruneCons([null, null, { a: 0, b: 1, t: r65.t }], r65.edges);
ok(!!keep65[2] && keep65[2].t === r65.t, "★劈成两段后约束仍然留着 ✓（半边还在 ✓ 上一版正是在这里误杀 ✗）");
/* ④ 约束点自身不能是那条边的端点（防自环 ✓） */
ok(VE65.resolveConstrained([0, 0, 1, 0], [{ a: 0, b: 1, t: 0.5 }], [[0, 1, 0]]).cons[0] === null, "★约束点自己是端点 → 解除 ✓（不然是自环 ✗）");
/* ⑤ 界面接线：约束表 / 拖动重算 / 撤销 / 蓝点 / 删边解除 ✓ */
const vdc65 = fs.readFileSync(path.join(ROOT, "src", "components", "VectorizeDialog.vue"), "utf8");
ok(vdc65.indexOf("resolveConstrained(") > 0 && vdc65.indexOf("const cons = ref<") > 0, "★弹窗接上了约束表 + 拖动时重算 ✓");
ok(vdc65.indexOf("cons: cons.value.map") > 0 && vdc65.indexOf("cons.value = (s.cons || [])") > 0, "★撤销快照带上约束 ✓（撤销能回到「还是约束点」✓）");
ok(vdc65.indexOf("cons[i - 1] ? ") > 0, "★受约束的点画成蓝点 ✓（一眼看出哪些是钉在边上的 ✓）");
ok(vdc65.indexOf("cons.value.push(r.a != null") > 0, "★补点时把约束记下来 ✓");
ok(vdc65.indexOf("cons.value.splice(i, 1)") > 0 && vdc65.indexOf("解除约束") > 0, "★删点同步删约束、删边解除约束 ✓");
console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
console.log("HTML（用来截图）：" + path.join(OUT, "_tikz1.html"));
process.exit(fail ? 1 : 0);
});
