/**
 * _ggbexec.cjs —— 【v1735】执行层的回归探针：**拿真执行器 + 假绘图板跑** ✓
 *
 * 为什么要有它：以前 148 条断言全是**纯函数** ✓ —— 执行层（切工具 / evalCommand / 读数 / 删除 / 回滚）
 *   一行都没被测过 ✗，只能靠真机手点 ✓。现在 ggbExec.ts 不认 Vue 了 ✓
 *   → 探针给一个「像 GeoGebra 的假绘图板」就能把执行层跑透 ✓
 *
 * 假绘图板（mockGgb）自带一个**迷你几何引擎**：认 (x,y) / Segment / Midpoint / Circle，
 *   能算 Distance / Radius / x / y，**删除会级联依赖**（跟真 GeoGebra 一样 ✓），
 *   getXML/setXML 能整块存回 ✓ —— 这几条正是我们依赖的引擎契约 ✓
 *
 * 用法：node .probe/_ggbexec.cjs
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
const X = load("ggbExec.ts", "_ggbExec.cjs");
const G = load("ggbSolve.ts", "_ggbSolve2.cjs");
const NL = String.fromCharCode(10);
let bad = 0;
function ok(c, m) { if (c) console.log("  [ok] " + m); else { bad++; console.log("  [XX] " + m) } }

/* ---------------- 假绘图板：迷你几何引擎 ---------------- */
function makeMock(opts) {
  const o = opts || {};
  const objs = new Map();          // 名字 → 定义串（**不带 X=**，跟 GeoGebra 的 getDefinitionString 一致 ✓）
  const calls = [];
  let modeCalls = 0;
  const num = (s) => Number(String(s).trim());
  function tuple(s) {
    const m = /^\(\s*([^,]+?)\s*,\s*([^,)]+?)\s*\)$/.exec(String(s).trim());
    return m ? [num(m[1]), num(m[2])] : null;
  }
  function pt(name) {
    const n = String(name).trim();
    const t = tuple(n);
    if (t) return t;
    const def = String(objs.get(n) || "").trim();
    const t2 = tuple(def);
    if (t2) return t2;
    // 【v1736】点在路径上（描点）：跟着宿主走 ✓（真约束 ✓ —— 拖动测试靠的就是这个行为）
    const pd = /^Point\s*\(\s*([^)]+?)\s*\)$/i.exec(def);
    if (pd) { const c = circleOf(pd[1]); if (c) return [c.c[0] + c.r, c.c[1]] }
    const md = /^Midpoint\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)$/i.exec(def);
    if (md) { const a = pt(md[1]), b = pt(md[2]); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }
    const cd = /^Circle\s*\(\s*(.+?)\s*,\s*(.+?)\s*\)$/i.exec(def);
    if (cd) { const c = pt(cd[1]); if (c) return c }
    return [NaN, NaN];
  }
  function circleOf(name) {
    const def = String(objs.get(String(name).trim()) || "").trim();
    const m = /^Circle\s*\(\s*(.+?)\s*,\s*(.+?)\s*\)$/i.exec(def);
    if (!m) return null;
    const c = pt(m[1]);
    const t = tuple(m[2]);
    const r = t ? Math.sqrt((t[0] - c[0]) ** 2 + (t[1] - c[1]) ** 2) : num(m[2]);
    return Number.isFinite(r) ? { c, r } : null;
  }
  function dist(a, b) { return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) }
  function evalDef(def) {
    let m;
    // 【v1736】拖动测试的残差表达式（挑认得准的三种 ✓ 别的返回 NaN = 取不到 ✓）
    m = /^abs\(\s*Distance\(\s*Center\(([^)]+?)\)\s*,\s*([^,)]+?)\s*\)\s*-\s*Radius\(([^)]+?)\)\s*\)$/i.exec(def);
    if (m) { const c = circleOf(m[3]); const p = pt(m[2]); return c ? Math.abs(dist(c.c, p) - c.r) : NaN }
    m = /^abs\(\s*Distance\(\s*([^,)]+?)\s*,\s*([^,)]+?)\s*\)\s*-\s*Distance\(\s*\2\s*,\s*([^,)]+?)\s*\)\s*\)$/i.exec(def);
    if (m) return Math.abs(dist(pt(m[1]), pt(m[2])) - dist(pt(m[2]), pt(m[3])));
    m = /^Distance\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)$/i.exec(def);
    if (m) return dist(pt(m[1]), pt(m[2]));
    m = /^Radius\s*\(\s*([^)]+?)\s*\)$/i.exec(def);
    if (m) { const c = circleOf(m[1]); return c ? c.r : NaN }
    m = /^x\s*\(\s*([^)]+?)\s*\)$/i.exec(def);
    if (m) return pt(m[1])[0];
    m = /^y\s*\(\s*([^)]+?)\s*\)$/i.exec(def);
    if (m) return pt(m[1])[1];
    return num(def);
  }
  /** 假引擎的级联删除：依赖它的也一起掉（跟真 GeoGebra 一样 ✓） */
  function refsOfDef(def) {
    const out = []; const re = /[A-Za-z_][A-Za-z0-9_']*/g; let m;
    while ((m = re.exec(def))) { const rest = def.slice(m.index + m[0].length); if (/^\s*\(/.test(rest)) continue; if (out.indexOf(m[0]) < 0) out.push(m[0]) }
    return out;
  }
  function del(name) {
    const victims = [String(name)];
    let grew = true;
    while (grew) {
      grew = false;
      for (const [k, v] of objs) {
        if (victims.indexOf(k) >= 0) continue;
        if (refsOfDef(v).some((r) => victims.indexOf(r) >= 0)) { victims.push(k); grew = true }
      }
    }
    for (const v of victims) objs.delete(v);
    return victims;
  }
  const api = {
    calls,
    get modeCalls() { return modeCalls },
    evalCommand(cmd) {
      const c = String(cmd || "").trim();
      calls.push(c);
      if (o.boom && c.indexOf(o.boom) >= 0) throw new Error("mock：不认这条指令");
      const asg = /^([A-Za-z][A-Za-z0-9_']*)\s*=\s*(.+)$/.exec(c);
      if (asg) { objs.set(asg[1], asg[2].trim()); return true }
      // 【v1736】拖动：SetCoords(点, x, y) —— 真引擎**返回 false 但真的拖动成功** ✗ 所以调用方看结果 ✓
      const sc = /^SetCoords\s*\(\s*([A-Za-z][A-Za-z0-9_']*)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/i.exec(c);
      if (sc) { objs.set(sc[1], "(" + sc[2] + ", " + sc[3] + ")"); return o.dragFalse === false ? true : false }
      const d = /^Delete\s*\(([^)]*)\)$/i.exec(c);
      if (d) { for (const n of d[1].split(",").map((s) => s.trim())) if (n) del(n); return o.deleteFalse ? false : true }   // 真引擎：删掉了也返回 false ✗
      // 【v1735】跟真引擎一致：**认不出的指令返回 false（不抛异常 ✗）**✓
      return false;
    },
    getValue(n) { const def = objs.get(String(n)); return def == null ? NaN : evalDef(def) },
    getAllObjectNames() { return [...objs.keys()] },
    getDefinitionString(n) { return objs.get(String(n)) || "" },
    getCommandString(n) { return objs.get(String(n)) || "" },
    deleteObject(n) { del(n); return true },
    setMode() { modeCalls++ },
    getXML() { return JSON.stringify([...objs.entries()]) },
    setXML(x) { objs.clear(); for (const [k, v] of JSON.parse(String(x))) objs.set(k, v) },
    getColor() { return "#3366cc" },
    getLineThickness() { return 3 },
    getVisible() { return true },
  };
  if (o.withDepApi) api.getDependentObjects = (n) => {
    const out = [];
    for (const [k, v] of objs) if (k !== n && refsOfDef(v).indexOf(String(n)) >= 0) out.push(k);
    return out;
  };
  return api;
}
const S = (tool, cmd) => ({ tool, mode: 1, cmd, say: "" });

console.log(NL + "=== 执行层：作图步骤（真执行器 + 假绘图板 v1735）===");
(async () => {
  /* ① 作图步能跑：切工具 + evalCommand + 成功计数 */
  const m1 = makeMock();
  const f1 = [];
  const log1 = [];
  const steps1 = [S("point", "A=(0,0)"), S("point", "B=(3,0)"), S("segment", "s=Segment(A,B)")];
  const n1 = await X.execSolveSteps(m1, steps1, f1, [], (l) => log1.push(l), { mode: 0, step: 0 });
  ok(n1 === 3 && f1.length === 0, "3 步作图全部成功（ok=" + n1 + " 失败=" + f1.length + "）");
  ok(m1.getAllObjectNames().length === 3 && m1.modeCalls === 3, "画布上有 3 个对象 + 切了 3 次工具");
  ok(log1.some((l) => l.indexOf("切换工具：") === 0) && log1.some((l) => l.indexOf("A=(0,0) ✓") >= 0), "日志写了切工具与每步结果 ✓");

  /* ② 失败被收进 fails（不吞 ✓）且不影响后面的步 */
  const m2 = makeMock({ boom: "Boom" });
  const f2 = [];
  const n2 = await X.execSolveSteps(m2, [S("point", "Boom=(1,1)"), S("point", "C=(2,2)")], f2, [], () => {}, { mode: 0, step: 0 });
  ok(n2 === 1 && f2.length === 1 && f2[0].cmd.indexOf("Boom") >= 0, "★报错的步进了 fails（后面的步照跑 ✓）");

  /* ③ 读数步：临时对象量一下 → **立刻删掉**（画布不留垃圾 ✓） */
  const m3 = makeMock();
  const rd3 = [];
  const n3 = await X.execSolveSteps(m3, [
    S("point", "A=(0,0)"), S("point", "B=(3,0)"),
    { tool: "query", mode: -1, cmd: "Distance(A,B)", say: "量 AB", query: true },
  ], [], rd3, () => {}, { mode: 0, step: 0 });
  ok(n3 === 2 && rd3.length === 1 && rd3[0].value === "3", "★读数 Distance(A,B) = 3（真算出来的 ✓）");
  ok(m3.getAllObjectNames().indexOf(G.GGB_QUERY_TMP) < 0, "★临时对象已删掉（板上没有 " + G.GGB_QUERY_TMP + " ✓）");
  ok(m3.calls.indexOf(G.ggbQueryCmd("Distance(A,B)")) >= 0, "读数走的是临时赋值指令（" + G.ggbQueryCmd("Distance(A,B)") + " ✓）");

  /* ④ 非法读数：不执行、不炸、记进日志 ✓ */
  const m4 = makeMock();
  const rd4 = [];
  await X.execSolveSteps(m4, [S("point", "A=(0,0)"), { tool: "query", mode: -1, cmd: "A=(9,9)", say: "", query: true }], [], rd4, () => {}, { mode: 0, step: 0 });
  ok(rd4.length === 1 && rd4[0].ok === false && String(rd4[0].err).indexOf("赋值") >= 0, "★读数里写赋值 → 拒绝（" + rd4[0].err + "）");
  ok(m4.getDefinitionString("A") === "(0,0)", "非法读数**没有**把 A 改掉 ✓（画布没被动 ✗）");

  /* ⑤ 取不到值时也不炸 */
  const m5 = makeMock();
  const rd5 = await X.execQueryExprs(m5, ["x(NoSuchPoint)"], "自动读数", () => {});
  /* 上面那条应被 ggReadPlan 拦住（对象不在板上）→ 用一条合法表达式测「取不到」 */
  const m5b = makeMock();
  m5b.evalCommand("A=(0,0)");
  const rd5b = await X.execQueryExprs(m5b, ["y(A)"], "", () => {});
  ok(rd5.length === 1 && rd5[0].ok === false, "★引用板上没有的对象 → 拒绝并记原因");
  ok(rd5b.length === 1 && rd5b[0].ok === true && rd5b[0].value === "0", "板上有的对象 → 正常取到（y(A)=0 ✓）");

  /* ⑥ 删除步：连带依赖（绘图板 API 优先 ✓） */
  const m6 = makeMock({ withDepApi: true });
  m6.evalCommand("A=(0,0)"); m6.evalCommand("B=(3,0)"); m6.evalCommand("s=Segment(A,B)"); m6.evalCommand("D=Midpoint(A,B)");
  const log6 = [];
  const n6 = await X.execSolveSteps(m6, [{ tool: "delete", mode: 23, cmd: "Delete(A)", say: "删掉画错的 A" }], [], [], (l) => log6.push(l), { mode: 0, step: 0 });
  ok(n6 === 1, "删除步执行成功 ✓");
  const after6 = m6.getAllObjectNames();
  ok(after6.indexOf("A") < 0 && after6.indexOf("s") < 0 && after6.indexOf("D") < 0, "★删 A 连带 s、D 一起掉（板上剩 " + after6.join("、") + "）");
  ok(log6.some((l) => l.indexOf("连带依赖") >= 0 && l.indexOf("s") >= 0), "★日志报出连带依赖（" + (log6[0] || "").slice(0, 40) + "…）");

  /* ⑦ 没有 getDependentObjects 时：用**板上真实定义图**兜底 ✓ */
  const m7 = makeMock();
  m7.evalCommand("A=(0,0)"); m7.evalCommand("B=(3,0)"); m7.evalCommand("s=Segment(A,B)");
  const log7 = [];
  await X.execSolveSteps(m7, [{ tool: "delete", mode: 23, cmd: "Delete(A)", say: "" }], [], [], (l) => log7.push(l), { mode: 0, step: 0 });
  ok(log7.some((l) => l.indexOf("连带依赖") >= 0 && l.indexOf("s") >= 0), "★（无 API 时）照样算出连带 s ✓");

  /* ⑧ 执行后校验：该建的对象没建出来要点出来 */
  const m8 = makeMock();
  m8.evalCommand("A=(0,0)");
  const miss = X.missingObjects(m8, [S("point", "A=(0,0)"), S("point", "Z=(9,9)")]);
  ok(miss.length === 1 && miss[0] === "Z", "★没建出来的对象被点出来（" + miss.join("、") + "）");

  /* ⑨ CanvasTracker 接真数据：来源 / 样式 ✓ */
  const m9 = makeMock();
  m9.evalCommand("A=(0,0)"); m9.evalCommand("B=(3,0)"); m9.evalCommand("s=Segment(A,B)");
  const items = X.readTrack(m9, {}, []);
  ok(items.length === 3, "清单 3 个对象（" + items.map((i) => i.name).join("、") + "）");
  ok(items.some((i) => i.name === "s" && i.refs.join(",") === "A,B"), "★读回来的依赖对（s → A、B ✓）");
  ok(items[0].style && items[0].style.indexOf("3px") >= 0, "★样式摘要从绘图板读出来了（" + items[0].style + "）");
  const items2 = X.readTrack(m9, {}, ["s"]);
  ok(items2.some((i) => i.name === "s" && i.origin === "ai-prev"), "★s 在「上次 AI 名单」里 → 上次 AI 画的 ✓");
  const items3 = X.readTrack(m9, {}, []);
  ok(items3.some((i) => i.name === "s" && i.origin === "user"), "★不在名单里 → 你手画 ✓");

  /* ⑩ 回滚依赖的引擎契约：getXML → 改画布 → setXML 能整块还原 ✓ */
  const m10 = makeMock();
  m10.evalCommand("A=(0,0)");
  const snap = m10.getXML();
  m10.evalCommand("P=(9,9)");
  ok(m10.getAllObjectNames().indexOf("P") >= 0, "快照后加了个 P ✓");
  m10.setXML(snap);
  ok(m10.getAllObjectNames().indexOf("P") < 0 && m10.getDefinitionString("A") === "(0,0)", "★setXML 整块还原（P 没了、A 还在 ✓）—— 回滚按钮靠的就是这条契约 ✓");

  /* ⑪ 等待时长可配：探针用 0 秒过（不然 60 步要等十几秒 ✗） */
  const m11 = makeMock();
  const t0 = Date.now();
  await X.execSolveSteps(m11, [S("point", "A=(0,0)"), S("point", "B=(1,0)"), S("point", "C=(2,0)")], [], [], () => {}, { mode: 0, step: 0 });
  ok(Date.now() - t0 < 300, "★等待时长传 0 → 秒过（" + (Date.now() - t0) + "ms ✓）");

  /* ⑫ 真引擎实测：evalCommand 失败**不抛异常、只返回 false** ✗ → 执行器必须认 ✓ */
  const m12 = makeMock();
  const f12 = [];
  const n12 = await X.execSolveSteps(m12, [S("point", "Nonsense(A,B,C)"), S("point", "C=(2,2)")], f12, [], () => {}, { mode: 0, step: 0 });
  ok(n12 === 1 && f12.length === 1 && String(f12[0].err).indexOf("false") >= 0, "★返回 false 也算失败（真引擎不抛异常 ✓ 后面的步照跑 ✓）");
  /* ⑬ defsOf 优先用 getCommandString（真引擎的 getDefinitionString 是本地化描述 ✗） */
  const m13 = makeMock();
  m13.evalCommand("A=(0,0)"); m13.evalCommand("B=(3,0)"); m13.evalCommand("s=Segment(A,B)");
  m13.getDefinitionString = (n) => (n === "s" ? "线段AB" : "(0, 0)");            // 模仿真引擎 ✗
  m13.getCommandString = (n) => (n === "s" ? "线段(A, B)" : "");                 // 命令串 ✓
  const it13 = X.readTrack(m13, {}, []);
  ok(it13.some((i) => i.name === "s" && i.refs.join(",") === "A,B"), "★定义串优先用 getCommandString → s 的依赖 = A,B（用本地化描述会抠出假名字「AB」✗）");
  /* ⑭ 真引擎实测：Delete(A) **删掉了却返回 false** ✗ → 删除步要看结果 ✓ */
  const m14 = makeMock({ deleteFalse: true });
  m14.evalCommand("A=(0,0)"); m14.evalCommand("B=(3,0)"); m14.evalCommand("s=Segment(A,B)");
  const f14 = [];
  const n14 = await X.execSolveSteps(m14, [{ tool: "delete", mode: 23, cmd: "Delete(A)", say: "" }], f14, [], () => {}, { mode: 0, step: 0 });
  ok(n14 === 1 && f14.length === 0 && m14.getAllObjectNames().indexOf("A") < 0, "★返回 false 但对象确实没了 → 按成功算（不许记成失败 ✗）");

  /* ⑮ 【v1736】命令名规范化（真引擎实测：中文界面给的是「线段(A, B)」「圆周(A, B)」「描点(c)」✗） */
  const NM = load("ggbNorm.ts", "_ggbnorm.cjs");
  ok(NM.ggbCmdName("线段(A, B)") === "Segment" && NM.ggbCmdName("圆周(A, B)") === "Circle", "★中文命令名归一：线段→Segment、圆周→Circle");
  ok(NM.ggbCmdName("描点(c)") === "Point" && NM.ggbCmdName("中点(A, B)") === "Midpoint" && NM.ggbCmdName("交点(c, l, 1)") === "Intersect", "★描点 / 中点 / 交点都认得 ✓");
  ok(NM.ggbCmdName("(0, 0)") === "" && NM.ggbFreePointXY("(1.5, -2)") !== null, "自由点没有命令名、但坐标读得出来 ✓（这正是 driver 的判据 ✓）");
  ok(NM.ggbCmdArgs("交点(c, l, 1)").join(",") === "c,l,1" && NM.ggbCmdArgs("Distance(Center(c), D)").length === 2, "★参数按顶层逗号切（嵌套括号不会切错 ✓）");
  ok(NM.ggbNormalizeNames("中点(A, B)") === "Midpoint(A, B)", "整条命令名归一 ✓");
  /* ⑯ 拖动测试的判定逻辑（纯函数 ✓ 三种情形都要分清） */
  const DR = load("ggbDrag.ts", "_ggbdrag.cjs");
  const oneCheck = [{ name: "D", def: "Point(c)", exprs: ["abs(D)"] }];
  ok(DR.judgeDrag(oneCheck, [0.001], [0.5]).broken.length === 1, "★拖动前 0、拖动后 0.5 → **被判为拖坏**（假约束露馅 ✓）");
  ok(DR.judgeDrag(oneCheck, [0.5], [0.5]).alreadyBad.length === 1 && DR.judgeDrag(oneCheck, [0.5], [0.9]).broken.length === 0, "★拖动前就 >容差 → 记成「本来就不成立」，不算拖坏 ✓");
  ok(DR.judgeDrag(oneCheck, [0.001], [0.002]).broken.length === 0 && DR.judgeDrag(oneCheck, [0.001], [NaN]).broken.length === 1, "★残差保持 0 → 通过 ✓；拖动后取不到值 → 也算坏 ✓");
  ok(DR.dragMoveCmd("A", 1.5, -2) === "SetCoords(A, 1.5, -2)", "拖动指令 = SetCoords(点, x, y) ✓");
  /* ⑰ 拖动测试**跑起来**（假绘图板：真约束拖完仍成立 ✓ 画布还原 ✓ SetCoords 返回 false 但生效 ✓） */
  const dm = makeMock();
  dm.evalCommand("A=(0,0)"); dm.evalCommand("B=(3,0)"); dm.evalCommand("c=Circle(A,B)");
  dm.evalCommand("D=Point(c)"); dm.evalCommand("M=Midpoint(A,B)");
  const dlog = [];
  const dr = await X.runDragTest(dm, (l) => dlog.push(l), { step: 0 }, { maxDrivers: 2, dx: 0.7, dy: 0.45 });
  ok(dr.drivers.length === 2 && dr.checks >= 2, "★认出 2 个驱动点、" + dr.checks + " 条可查关系（描点 + 中点 ✓）");
  ok(dr.broken.length === 0, "★真约束拖完仍成立（没被拖坏 ✓）");
  ok(dr.restored === true && dm.getAllObjectNames().length === 5, "★跑完整块还原（板上还是 5 个对象 ✓ 老师的图没动 ✓）");
  ok(dlog.join("|").indexOf("拖不动") < 0, "★SetCoords 返回 false 但位置确实变了 → 不误报「拖不动」✓");
  ok(dr.unchecked.indexOf("c") >= 0, "★如实报「没查的」（圆本身没查 ✓ 不假装全查了 ✗）");

  /* ⑱【v1737】动画步 / 教学辅助步：执行层真的把台词本跑出来了 ✓ */
  const am = makeMock();
  am.evalCommand("h=Circle((0,0),2)");
  am.evalCommand("s=Slider(0,10,0.1)");
  const alog = [];
  const af = [];
  const an1 = await X.execSolveSteps(am, [
    { tool: "aids", mode: -1, cmd: "显示辅助|h", say: "", aids: true },
    { tool: "animate", mode: -1, cmd: "s|ping_pong|1|0|10", say: "", anim: true },
  ], af, [], (l) => alog.push(l), { step: 0, driveSteps: 6, driveTickMs: 0, driveBlocking: true });
  ok(an1 === 2 && af.length === 0, "★动画步与辅助步都跑成功（" + an1 + "/2 ✓）");
  ok(am.calls.some((c) => c.indexOf("Checkbox(") >= 0), "★辅助步真的发出 Checkbox（一个开关挂全部 ✓）");
  ok(am.calls.some((c) => c.indexOf("Checkbox(") >= 0) && am.calls.some((c) => c.indexOf("SetValue(aidsShow, false)") >= 0), "★开关默认关着 ✓（与「静态复刻图」一致 ✓）");
  const setvals = am.calls.filter((c) => c.indexOf("SetValue(s,") === 0).length;
  ok(setvals >= 6, "★ping_pong 由我们按时间驱动：SetValue 调了 " + setvals + " 次 ✓（引擎没有振荡 API ✗）");
  const af2 = [];
  const an2 = await X.execSolveSteps(am, [{ tool: "animate", mode: -1, cmd: "s|loop", say: "", anim: true }], af2, [], () => {}, { step: 0 });
  ok(an2 === 0 && af2.length === 1 && String(af2[0].err).indexOf("起点与终点") >= 0, "★loop 没给范围 → 记成失败（不静默 ✗）");
  /* ⑲【v1738】复刻往返：原图骨架 ↔ 板上真身（假绘图板 ✓） */
  const rm = makeMock();
  rm.evalCommand("A=(0,0)"); rm.evalCommand("B=(3,0)"); rm.evalCommand("C=(0,4)");
  rm.evalCommand("s=Segment(A,B)"); rm.evalCommand("t=Segment(A,C)");
  const want8 = { points: [{ name: "A", x: 0, y: 0 }, { name: "B", x: 40, y: 0 }, { name: "C", x: 0, y: 53 }],
    edges: [{ a: "A", b: "B", dashed: false }, { a: "A", b: "C", dashed: false }], circles: [] };
  const rd8 = await X.runBuildCheck(rm, want8, () => {});
  ok(rd8.score >= 0.999 && rd8.missing.length === 0, "★复刻往返：板上真身与目标骨架对得上（" + rd8.score.toFixed(3) + " ✓ 单位不同也对得上 ✓）");
  ok(rd8.matched.length === 3 && rd8.edgeBad.length === 0, "★三个点 + 两条边全对上 ✓");
  const want8b = { points: [{ name: "A", x: 0, y: 0 }, { name: "B", x: 40, y: 0 }, { name: "C", x: 60, y: 53 }], edges: want8.edges, circles: [] };
  const rd8b = await X.runBuildCheck(rm, want8b, () => {});
  ok(rd8b.score < 0.999 && rd8b.moved.length >= 1, "★目标里 C 一歪 → 往返比对立刻报出（" + rd8b.score.toFixed(3) + " ✗）");
  console.log(bad ? NL + "[XX] 执行层有 " + bad + " 处问题" : NL + "[ok] 执行层全过");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log("[XX] 跑挂了：" + (e && e.message)); process.exit(1) });
