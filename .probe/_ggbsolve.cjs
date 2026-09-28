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
