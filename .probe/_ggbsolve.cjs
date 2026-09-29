/**
 * _ggbsolve.cjs —— 【v1711】GGB「贴图解题作图」的检查脚本
 *
 * 用法：
 *   node .probe/_ggbsolve.cjs                        → 静态：工具表 + 计划解析（不需要 key）
 *   LJ_AI_KEY_FILE=<keys.json> node .probe/_ggbsolve.cjs  → 真模型：给一道题，看它给的 JSON 能不能直接执行 ✓
 * 产物：<工作区>/.probe/shots/_ggbsolve.md
 */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = process.env.LJ_ROOT || "D:/vue-app";
const OUT = process.env.LJ_OUT || "C:/Users/老冀/Desktop/vue-app/.probe/shots";
fs.mkdirSync(OUT, { recursive: true });
const esbuild = require("D:/vue-app/node_modules/esbuild");
function load(entry, outfile) {
  esbuild.buildSync({
    entryPoints: [path.join(ROOT, "src", "composables", entry)],
    bundle: true, format: "cjs", platform: "node", logLevel: "error",
    outfile: path.join(OUT, outfile), alias: { "@": path.join(ROOT, "src") },
  });
  return require(path.join(OUT, outfile));
}
const G = load("ggbSolve.ts", "_ggbs.cjs");
const NL = String.fromCharCode(10);
let bad = 0;
function ok(c, m) { if (c) console.log("  [ok] " + m); else { bad++; console.log("  [XX] " + m) } }

console.log("=== 静态：工具表与计划解析 ===");
ok(G.GGB_TOOLS.length >= 20, "工具表 " + G.GGB_TOOLS.length + " 条");
const t1 = G.ggbToolOf("point");
const t2 = G.ggbToolOf("线段");
const t3 = G.ggbToolOf("画个垂线");
const t4 = G.ggbToolOf("圆心+半径");
ok(t1 && t1.mode === 1, "point → mode 1");
ok(t2 && t2.mode === 3, "中文「线段」→ mode 3");
ok(t3 && t3.key === "perpendicular", "「画个垂线」也认（" + (t3 && t3.key) + "）");
ok(t4 && t4.key === "circle_radius", "「圆心+半径」不被「圆」抢走（" + (t4 && t4.key) + "）");
ok(G.ggbToolOf("") === null && G.ggbToolOf("乱写") === null, "认不出 → null");
const menu = G.ggbToolMenu();
ok(G.GGB_TOOLS.every((t) => menu.indexOf(t.key) >= 0), "工具清单里每个 key 都写进了 system 菜单");
const sys = G.ggbSolveSystem();
ok(sys.indexOf("只输出 JSON") > 0 && sys.indexOf("solution") > 0 && sys.indexOf("steps") > 0, "system 写死了输出格式");
ok(sys.indexOf("原生语法") > 0 && sys.indexOf("不是 JS") > 0, "system 说清用 GeoGebra 指令、不用 JS");
const good = JSON.stringify({ solution: "由定义得 |OP|²=13。", steps: [{ tool: "point", cmd: "O=(0,0)", say: "建原点" }, { tool: "circle_radius", cmd: "Circle(O,3.6)", say: "作圆" }] });
const p1 = G.ggbSolvePlan(good);
ok(p1.steps.length === 2 && p1.steps[0].mode === 1 && p1.steps[1].mode === 7, "★合法 JSON → 两步、mode 都对");
ok(p1.solution.indexOf("|OP|") >= 0 && !p1.notes.length, "解题过程原样拿到、没有多余提示");
const fenced = "```json" + NL + good + NL + "```";
ok(G.ggbSolvePlan(fenced).steps.length === 2, "带代码块的也认");
const loose = "{ solution: \"略\", steps: [ { tool: \"point\", cmd: \"A=(1,0)\" }, { tool: \"segment\", cmd: \"Segment(A,B)\" } ] }";
const p2 = G.ggbSolvePlan(loose);
ok(p2.steps.length === 2 && p2.notes.join("").indexOf("JSON 没解析成功") >= 0, "★单引号 / 不合法 JSON → 按 cmd 抠出来（" + p2.steps.length + " 步）");
const weirdTool = JSON.stringify({ solution: "x", steps: [{ tool: "神仙工具", cmd: "A=(0,0)", say: "建点" }] });
const p3 = G.ggbSolvePlan(weirdTool);
ok(p3.steps.length === 1 && p3.steps[0].mode === -1 && p3.notes.join("").indexOf("认不出的工具") >= 0, "★认不出的工具 → 不切工具但指令照跑 + 提示");
const noCmd = JSON.stringify({ solution: "x", steps: [{ tool: "point", cmd: "" }, { tool: "segment", cmd: "Segment(A,B)" }] });
const p4 = G.ggbSolvePlan(noCmd);
ok(p4.steps.length === 1 && p4.notes.join("").indexOf("只有工具没有指令") >= 0, "★空指令 → 丢掉并提示");
const many = JSON.stringify({ solution: "x", steps: new Array(80).fill({ tool: "point", cmd: "A=(0,0)" }) });
ok(G.ggbSolvePlan(many).steps.length === 60, "★最多 60 步");
const junk = G.ggbSolvePlan("我只会画个圆，别的不会。");
ok(junk.steps.length === 0 && junk.solution.length > 0 && junk.notes.length > 0, "★完全不是 JSON → 原文留着 + 提示");
ok(G.ggbSolvePlan(null).steps.length === 0, "null 不炸");
const lines = G.ggbStepLines(p1);
ok(lines.length === 4 && lines[0].indexOf("切换工具：点") === 0, "步骤摘要：" + lines[0]);

console.log(NL + "=== 静态：识图三段式（读图 / 校对 / 校验 / 自愈 v1729）===");
/* ① 视觉模型守卫：带图但没配视觉模型 → 必须说清（原来静默把图发给纯文本模型 ✗） */
ok(G.ggbVisionGuard(false, "") === null, "没图 → 不拦");
ok(G.ggbVisionGuard(true, "gpt-4o") === null, "带图且配了视觉模型 → 不拦");
ok(typeof G.ggbVisionGuard(true, "") === "string" && G.ggbVisionGuard(true, "").indexOf("视觉模型") >= 0,
  "★带图但没配视觉模型 → 明确提示去配视觉模型");
/* ② 读图：只转写、不猜、不解题 */
const RSYS = G.ggbReadSystem();
ok(RSYS.indexOf("转写") >= 0 && RSYS.indexOf("不许解题") >= 0, "读图 system 说清只转写、不许解题");
ok(RSYS.indexOf("看不清就不猜") >= 0 && RSYS.indexOf("unsure") >= 0, "★读图 system 要求把拿不准的写进 unsure");
ok(RSYS.indexOf("照抄原图") >= 0 && RSYS.indexOf("别换算") >= 0, "★数字必须照抄原图、不许换算");
const RB = G.ggbReadBrief("```json" + NL + '{"text":"椭圆 C：x²/9+y²/4=1","given":["F₁、F₂ 为焦点"],"ask":"求 |PF₁|·|PF₂|","figure":["点 P 在 C 上"],"unsure":["角标注疑似 90°"]}' + NL + "```");
ok(RB.text.indexOf("x²/9") >= 0 && RB.given.length === 1 && RB.figure.length === 1, "★读图 JSON → 题干 / 已知 / 图形要素都拿到了");
ok(RB.unsure.length === 1 && RB.unsure[0].indexOf("疑似") >= 0, "拿不准的原样留下（不猜 ✓）");
const RB2 = G.ggbReadBrief("这不是 JSON，就是一段题干文字");
ok(RB2.text.indexOf("题干文字") >= 0 && RB2.given.length === 0, "★不是 JSON → 原文当题干（别给空框 ✗）");
const RB3 = G.ggbReadBrief(null);
ok(RB3.text === "" && RB3.unsure.length === 0, "null 不炸");
const BT = G.ggbBriefText(RB);
ok(BT.indexOf("【题干】") >= 0 && BT.indexOf("【已知】") >= 0 && BT.indexOf("【求/证】") >= 0 && BT.indexOf("【图形要素】") >= 0,
  "校对框文本有题干 / 已知 / 求证 / 图形要素");
ok(BT.indexOf("【待确认") >= 0 && BT.indexOf("疑似") >= 0, "★待确认单独一段（老师先核对这里 ✓）");
const SU = G.ggbSolveUser(BT, "只画第一问");
ok(SU.indexOf("x²/9") >= 0 && SU.indexOf("只画第一问") >= 0 && SU.indexOf("image_url") < 0,
  "★解题 user = 校对后的题干 + 补充要求（不带图 ✓）");
/* ③ 执行前静态校验 */
const V1 = G.ggbValidatePlan([
  { tool: "point", mode: 1, cmd: "A＝（0，0）", say: "建点" },
  { tool: "circle", mode: 6, cmd: "Circle(A,B)", say: "以 A 为心过 B 作圆" },
]);
ok(V1.steps.length === 2 && V1.fixes.length >= 1 && V1.steps[0].cmd === "A=(0,0)", "★全角括号逗号等号 → 半角（" + V1.steps[0].cmd + "）");
ok(V1.issues.join("").indexOf("还没定义的 B") >= 0, "★用到没定义的 B → 报出来（依赖顺序 ✓）");
const V2 = G.ggbValidatePlan([
  { tool: "point", mode: 1, cmd: "A=(0,0)", say: "" },
  { tool: "point", mode: 1, cmd: "B=(1,0)", say: "" },
  { tool: "segment", mode: 3, cmd: "Segment(A,B)", say: "" },
]);
ok(V2.steps.length === 3 && V2.issues.length === 0, "定义过再用 → 不误报（A、B 都定义过 ✓）");
const V3 = G.ggbValidatePlan([{ tool: "", mode: -1, cmd: "Circle((0,0),1); A=(1,1)", say: "" }]);
ok(V3.steps.length === 2 && V3.fixes.join("").indexOf("拆成多步") >= 0, "★一行用 ; 串两条 → 拆成 2 步");
const V4 = G.ggbValidatePlan([{ tool: "", mode: -1, cmd: "Circle((0,0),1", say: "" }]);
ok(V4.issues.join("").indexOf("括号不配平") >= 0, "★括号不配平 → 报出来");
const V5 = G.ggbValidatePlan([{ tool: "", mode: -1, cmd: "   ", say: "" }]);
ok(V5.steps.length === 0 && V5.issues.length >= 1, "空指令 → 跳过并提示");
const V6 = G.ggbValidatePlan([{ tool: "", mode: -1, cmd: "f(x)=x^2-2x", say: "" }]);
ok(V6.steps.length === 1 && V6.issues.length === 0, "函数定义 f(x)=… → 不算「没定义」（不误报 ✓）");
/* ④ 回灌自愈 */
const RPS = G.ggbRepairSystem();
ok(RPS.indexOf("只给错的那几步") >= 0 && RPS.indexOf("原生语法") >= 0, "修错 system 说清只改错的那几步、用原生语法");
const RU = G.ggbRepairUser([{ cmd: "Intersect(c,f)", err: "unknown command" }], ["A", "c"], "【题干】椭圆");
ok(RU.indexOf("绘图板已有对象") >= 0 && RU.indexOf("Intersect(c,f)") >= 0 && RU.indexOf("unknown command") >= 0,
  "★回灌带上了题干 + 现成对象名 + 错指令与报错原文");
ok(G.ggbRepairUser([], [], "").indexOf("（无）") >= 0, "没有错步骤时也不炸");
console.log(NL + "=== 静态：题图预处理 + 图形识别（v1730）===");
const IP = load("imgPrep.ts", "_imgprep.cjs");
const FS = load("figScan.ts", "_figscan.cjs");
function hist2(a, b) { const h = new Array(256).fill(0); h[a] = 100; h[b] = 100; return h }
function grayOf(W, H, dark) { const g = new Array(W * H).fill(255); (dark || []).forEach(function (p) { g[p[1] * W + p[0]] = 0 }); return g }
/* ① 预处理：Otsu / 墨迹包围盒 / 留白 / 缩放计划（都是纯函数 ✓） */
const lv = IP.otsuLevel(hist2(20, 220));
ok(lv >= 20 && lv < 220, "★Otsu 阈值落在两峰之间（含下峰；" + lv + "）");
ok(IP.otsuLevel([]) === 200 && IP.otsuLevel(new Array(256).fill(0)) === 200, "空直方图 → 保守的 200（不炸 ✓）");
const bb = IP.inkBox(grayOf(10, 10, [[3, 4], [4, 4], [3, 5], [4, 5]]), 10, 10, 128);
ok(bb[0] === 3 && bb[1] === 4 && bb[2] === 5 && bb[3] === 6, "★墨迹包围盒 = [3,4,5,6)（" + bb.join(",") + "）");
const bb2 = IP.inkBox(grayOf(10, 10, []), 10, 10, 128);
ok(bb2[0] === 0 && bb2[2] === 10 && bb2[3] === 10, "整张没墨迹 → 返回整幅（不裁成 0 ✗）");
const pb = IP.padBox([3, 4, 5, 6], 2, 10, 10);
ok(pb[0] === 1 && pb[1] === 2 && pb[2] === 7 && pb[3] === 8, "留白 2px → [1,2,7,8]");
const pb2 = IP.padBox([0, 0, 10, 10], 5, 10, 10);
ok(pb2[0] === 0 && pb2[2] === 10, "留白夹进原图（不越界 ✓）");
const f1 = IP.fitPlan(300, 200, 900, 3);
ok(Math.abs(f1.scale - 3) < 1e-6 && f1.outW === 900 && f1.outH === 600, "★短边不足 → 放大 3×（300×200 → 900×600）");
ok(Math.abs(IP.fitPlan(100, 100, 900, 3).scale - 3) < 1e-6, "放大倍率封顶 maxScale（100 → 300 ✓）");
ok(IP.fitPlan(2000, 1500, 900, 3).scale === 1, "已经够大 → 不放大（2000×1500 原样 ✓）");
const f2 = IP.fitPlan(4000, 3000, 900, 3);
ok(f2.outW === 2400 && Math.abs(f2.scale - 0.6) < 1e-6, "★长边超上限 → 缩回 2400（不把巨图原样发出去 ✗）");
/* ② 图 → 几何要素（用假的识别结果，纯函数 ✓） */
const fake = {
  W: 100, H: 100, box: [0, 0, 100, 100], imgW: 100, imgH: 100,
  points: [0, 0, 1, 0, 0.5, 1],
  edges: [[0, 1, 0], [1, 2, 0], [2, 0, 0]],
  anchors: [{ x: 0.5, y: 1.02, text: "A", conf: 0.9 }, { x: 0.02, y: 0.02, text: "B", conf: 0.9 }],
  arcs: [{ cx: 0.5, cy: 0.5, rx: 0.5, ry: 0.5 }],
  stats: {},
};
const SF = FS.scanFromResult(fake);
ok(SF.points.length === 3 && SF.edges.length === 3, "3 个顶点 / 3 条线段");
ok(SF.points[2].name === "A" && SF.points[0].name === "B", "★最近的字母标注贴到顶点上（A、B）");
ok(SF.labelled === 2, "记下贴上了 2 个标注（" + SF.labelled + "）");
ok(SF.circles.length === 1 && Math.abs(SF.circles[0].rx - 0.5) < 1e-6, "★arcs → 圆（圆心 / 半径拿到）");
const badE = FS.scanFromResult({ points: [0, 0, 1, 0], edges: [[0, 1, 0], [0, 5, 0]], anchors: [], arcs: [] });
ok(badE.edges.length === 1, "★越界的边丢掉（0→5 不认）");
ok(FS.scanFromResult(null).points.length === 0, "null 不炸");
ok(FS.describeScan({ points: [], edges: [], circles: [], labelled: 0 }).join("").indexOf("没认出") >= 0, "没元素时给一句话（不返回空数组 ✗）");
const L1 = FS.describeScan(SF).join("|");
ok(L1.indexOf("A(") >= 0 && L1.indexOf("0.50") >= 0, "描述里有顶点名与归一化坐标");
ok(L1.indexOf("水平") >= 0, "★认出一条水平边");
ok(L1.indexOf("A 在圆上") >= 0, "★A 在圆上（半径容差内 ✓）");
ok(L1.indexOf("⊥") < 0, "这个三角形没有直角 → 不许瞎报 ⊥");
const sq = FS.scanFromResult({ points: [0, 0, 1, 0, 1, 1, 0, 1], edges: [[0, 1, 0], [1, 2, 0], [2, 3, 0], [3, 0, 0]], anchors: [], arcs: [] });
const L2 = FS.describeScan(sq).join("|");
ok(L2.indexOf("水平") >= 0 && L2.indexOf("竖直") >= 0, "★正方形：认出一条水平 + 一条竖直");
ok(L2.indexOf("⊥") >= 0, "★正方形：认出垂直");
ok(L2.indexOf("=") >= 0, "★正方形：认出等长");
ok(FS.scanToBrief(SF).indexOf("【图形（自动识别") >= 0 && FS.scanToBrief(SF).indexOf("以**题干**为准") >= 0,
  "★写进校对框时标明是自动识别、以题干为准");
console.log(NL + "=== 静态：读数（query）与核对（v1731）===");
/* ① 怎么用：system 里必须告诉模型可以插只读读数步 */
const qSY = G.ggbSolveSystem();
ok(qSY.indexOf("只读") >= 0 && qSY.indexOf("query") >= 0, "解题 system 告诉模型可以插只读读数步");
ok(qSY.indexOf("Distance(A,B)") >= 0 && qSY.indexOf("精确值会回到你手里") >= 0, "读数用 GeoGebra 只读表达式，量出来的值会回到模型手里");
/* ② 认"读一步" */
ok(G.isQueryTool("query") && G.isQueryTool("读数") && G.isQueryTool("query_length") && G.isQueryTool("measure"), "query / 读数 / query_* / measure 都认");
ok(!G.isQueryTool("point") && !G.isQueryTool("") && !G.isQueryTool(null), "普通工具 / 空 / null → 不是读数");
/* ③ 只读表达式校验 */
const qR1 = G.ggbReadPlan("Distance(A,B)", ["A", "B"]);
ok(qR1.ok && qR1.expr === "Distance(A,B)", "合法读数：Distance(A,B) ✓");
const qR2 = G.ggbReadPlan("Distance(A,C)", ["A", "B"]);
ok(!qR2.ok && String(qR2.why).indexOf("C") >= 0, "★引用了画布上没有的 C → 拒（" + qR2.why + "）");
const qR3 = G.ggbReadPlan("A=(0,0)", ["A"]);
ok(!qR3.ok && String(qR3.why).indexOf("赋值") >= 0, "★读数里不许赋值（= 一律拒 ✓）");
const qR4 = G.ggbReadPlan("Foo(A,B)", ["A", "B"]);
ok(!qR4.ok && String(qR4.why).indexOf("Foo") >= 0, "★白名单外的函数 → 拒（免得悄悄往画布上画东西 ✗）");
ok(!G.ggbReadPlan("", []).ok, "空表达式 → 拒");
ok(G.ggbReadPlan("(x(A)+x(B))/2", ["A", "B"]).ok, "只读函数 + 已有对象 + 四则运算 → 允许（自己算个数也行 ✓）");
/* ④ 临时对象（量完就删） */
ok(G.GGB_QUERY_TMP === "ljqTemp" && G.ggbQueryCmd("Distance(A,B)") === "ljqTemp=Distance(A,B)", "读数走临时对象（量完立刻删 ✓）");
ok(G.GGB_READ_FNS.indexOf("Distance") >= 0 && G.GGB_READ_FNS.indexOf("Area") >= 0 && G.GGB_READ_FNS.indexOf("Radius") >= 0, "白名单含 Distance / Area / Radius");
/* ⑤ 计划解析：读一步混在作图步里 */
const qP = G.ggbSolvePlan('{"solution":"解","steps":[{"tool":"point","cmd":"A=(0,0)"},{"tool":"query","cmd":"Distance(A,B)","say":"量 AB"},{"tool":"circle","cmd":"c=Circle(A,B)"}]}');
ok(qP.steps.length === 3 && qP.steps[1].query === true && qP.steps[1].tool === "query", "★读一步被认出来（query=true，不当作图步 ✓）");
ok(qP.steps[0].query !== true && qP.steps[2].query !== true, "作图步不会被误标成读数");
/* ⑥ 校验：读数步表达式要合法；画布上已有的对象不再误报"没定义" */
const qV1 = G.ggbValidatePlan([{ tool: "query", mode: -1, cmd: "Distance(A,B)", say: "", query: true }], ["A", "B"]);
ok(qV1.issues.length === 0, "★读数步：A、B 在画布上 → 不报警");
const qV2 = G.ggbValidatePlan([{ tool: "query", mode: -1, cmd: "Distance(A,C)", say: "", query: true }], ["A", "B"]);
ok(qV2.issues.join("").indexOf("读数表达式不合法") >= 0, "★读数步引用了不存在的 C → 报出来");
const qV3 = G.ggbValidatePlan([{ tool: "segment", mode: 3, cmd: "Segment(A,B)", say: "" }], ["A", "B"]);
ok(qV3.issues.length === 0, "★（顺带修好）引用画布上已有的 A、B → 不再误报依赖顺序");
/* ⑦ 自动读数：从作图步推出该量什么 */
const qAQ = G.ggbAutoQueries([
  { tool: "point", mode: 1, cmd: "A=(0,0)", say: "" },
  { tool: "point", mode: 1, cmd: "B=(4,0)", say: "" },
  { tool: "segment", mode: 3, cmd: "AB=Segment(A,B)", say: "" },
  { tool: "circle", mode: 6, cmd: "c=Circle(A,B)", say: "" },
  { tool: "polygon", mode: 12, cmd: "p=Polygon(A,B,C)", say: "" },
]);
ok(qAQ.indexOf("x(A)") >= 0 && qAQ.indexOf("y(B)") >= 0, "★点 → 自动量 x、y 坐标");
ok(qAQ.indexOf("Distance(A,B)") >= 0, "★线段 → 自动量两点距离");
ok(qAQ.indexOf("Radius(c)") >= 0, "★圆 → 自动量半径");
ok(qAQ.indexOf("Area(p)") >= 0, "★多边形 → 自动量面积");
ok(G.ggbAutoQueries([{ tool: "point", mode: 1, cmd: "A=(0,0)", say: "" }], 1).length === 1, "自动读数有条数上限（省 token ✓）");
ok(G.ggbAutoQueries([{ tool: "query", mode: -1, cmd: "x(A)", say: "", query: true }]).length === 0, "读一步不会被自动再量一遍");
/* ⑧ 读数文本 / 核对提示词 / 核对结果解析 */
const qRT = G.ggbReadoutText([{ expr: "Distance(A,B)", value: "5", ok: true }, { expr: "Radius(c)", value: "", ok: false, err: "取不到" }]);
ok(qRT.indexOf("Distance(A,B) = 5") >= 0 && qRT.indexOf("取不到") >= 0, "★读数文本：取到值 / 取不到都写清");
ok(G.ggbReadoutText([]).indexOf("没有读数") >= 0, "没有读数时也不给空串");
const qCS = G.ggbCheckSystem();
ok(qCS.indexOf("精确读数") >= 0 && qCS.indexOf("以**题干**为准") >= 0, "核对 system：用读数核对，冲突时以题干为准");
ok(qCS.indexOf("mismatch") >= 0 && qCS.indexOf("unsure") >= 0 && qCS.indexOf("只给要改的那几步") >= 0, "★核对 system 定义 ok / mismatch / unsure 三种结论");
const qCU = G.ggbCheckUser("【题干】椭圆", "解法…", ["A=(0,0)", "c=Circle(A,B)"], [{ expr: "Radius(c)", value: "2", ok: true }]);
ok(qCU.indexOf("椭圆") >= 0 && qCU.indexOf("A=(0,0)") >= 0 && qCU.indexOf("Radius(c) = 2") >= 0, "★核对 user 带上题干 + 步骤 + 精确读数");
const qC1 = G.ggbCheckResult('{"verdict":"mismatch","note":"AB 应是 5，画成了 3","steps":[{"tool":"point","cmd":"A=(0,0)"}]}', ["A"]);
ok(qC1.verdict === "mismatch" && qC1.note.indexOf("AB") >= 0 && qC1.steps.length === 1, "★核对结果：mismatch + 说明 + 修正步");
const qC2 = G.ggbCheckResult("模型胡写了一段没有 JSON 的话", ["A"]);
ok(qC2.verdict === "unsure" && qC2.steps.length === 0 && qC2.note.length > 0, "★解析不出来 → unsure + 留下原文（不硬判 ✓）");
ok(G.ggbCheckResult('{"verdict":"乱写","note":"x"}', []).verdict === "unsure", "认不出的 verdict → unsure");
const qC4 = G.ggbCheckResult('{"verdict":"ok","note":"自洽","steps":[{"tool":"query","cmd":"Distance(A,Z)"}]}', ["A"]);
ok(qC4.verdict === "ok" && qC4.steps.length === 0, "★修正步里的非法读数被剔掉（Z 不在画布上 ✓）");
ok(G.ggbCheckResult(null, []).verdict === "unsure", "null 不炸");
function pickKey() {
  const direct = String(process.env.LJ_AI_KEY || process.env.DEEPSEEK_API_KEY || "").trim();
  if (direct) return direct;
  const f = String(process.env.LJ_AI_KEY_FILE || "").trim();
  if (!f || !fs.existsSync(f)) return "";
  try {
    const list = JSON.parse(fs.readFileSync(f, "utf8"));
    for (const x of (Array.isArray(list) ? list : [list])) {
      const s = String((x && x.key) || x || "").trim();
      if (s.indexOf("sk-") === 0) return s;
    }
  } catch { /* 当没有 */ }
  return "";
}
const key = pickKey();
if (!key) {
  console.log(NL + "没有 key → 只做静态检查 ✓（真模型：LJ_AI_KEY_FILE=<keys.json> node .probe\\_ggbsolve.cjs）");
  console.log(bad ? "[XX] 静态检查有 " + bad + " 处问题" : "[ok] 静态检查全过");
  process.exit(bad ? 1 : 0);   // 静态分支还没发过 fetch → exit 是安全的 ✓
}
const model = String(process.env.LJ_AI_MODEL || "deepseek-chat").trim();
const base = String(process.env.LJ_AI_BASE || "https://api.deepseek.com").replace(/\/$/, "");
const PROBLEM = [
  "已知椭圆 C：x²/9 + y²/4 = 1，左、右焦点分别为 F₁、F₂，P 为 C 上一点且 ∠F₁PF₂ = 90°。",
  "（1）求 |PF₁|·|PF₂| 的值；（2）求点 P 的坐标（写出作图步骤）。",
].join(NL);
(async () => {
  console.log(NL + "=== 真模型：" + model + " ===");
  const res = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model, temperature: 0,
      messages: [{ role: "system", content: G.ggbSolveSystem() }, { role: "user", content: PROBLEM }],
    }),
  });
  const txt = await res.text();
  let j = null;
  try { j = JSON.parse(txt) } catch { j = null }
  if (!res.ok || !j || !j.choices || !j.choices.length) {
    const m = (j && j.error && j.error.message) || String(txt).slice(0, 200);
    console.log("[XX] 请求失败：HTTP " + res.status + "：" + m);
    process.exit(1);
  }
  const text = String((j.choices[0].message && j.choices[0].message.content) || "");
  const plan = G.ggbSolvePlan(text);
  const lines = G.ggbStepLines(plan);
  const report = ["# GGB 贴图解题作图 · 真模型检查", "", "## 题", PROBLEM, "", "## 解题过程", plan.solution, "", "## 作图步骤（" + plan.steps.length + " 步）", ...lines.map((x) => "- " + x), "", plan.notes.length ? "## 提示" + NL + plan.notes.map((x) => "- " + x).join(NL) : ""].join(NL);
  fs.writeFileSync(path.join(OUT, "_ggbsolve.md"), report + NL, "utf8");
  ok(plan.steps.length >= 3, "★模型给出了可执行的作图步骤（" + plan.steps.length + " 步）");
  ok(plan.steps.every((s) => s.cmd.length > 1), "每条指令都不是空的");
  ok(plan.solution.length > 20, "解题过程有内容（" + plan.solution.length + " 字）");
  const withTool = plan.steps.filter((s) => s.tool).length;
  ok(withTool >= 2, "★至少两步带工具切换（切了 " + withTool + " 次）");
  const known = plan.steps.filter((s) => s.tool && s.mode >= 0).map((s) => s.tool);
  ok(known.length === withTool, "工具名全认得出（" + (known.join("、") || "无") + "）");
  console.log(NL + "解题过程（前 200 字）：" + NL + plan.solution.slice(0, 200));
  console.log("作图步骤：" + NL + lines.map((x) => "  " + x).join(NL));
  console.log(NL + "报告：" + path.join(OUT, "_ggbsolve.md"));
  console.log(bad ? "[XX] 有 " + bad + " 处问题" : "[ok] 全过");
  process.exitCode = bad ? 1 : 0;
})();
