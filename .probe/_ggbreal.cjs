/**
 * _ggbreal.cjs —— 【v1735】第 ④ 件：**把命令真的跑进 GeoGebra 再断言** ✓
 *
 * 前情：其它探针（含 _ggbexec.cjs 的假绘图板）只能证明"逻辑对" ✓
 *   真引擎的脾气只有真跑才知道 ✗ —— 它一上来就抓出两个真 bug：
 *     · `evalCommand` 失败**不抛异常、只返回 false** ✗（我们原来把失败算成功 ✗）
 *     · `getDefinitionString` 给的是**给人看的本地化描述**（"线段AB" ✗）→ 依赖要改用 `getCommandString` ✓
 *
 * 做法：本地自带的 GeoGebra（dist/geogebra ✓ 离线）+ 无头 Chrome（file:// ✓ 不用起服务器 ✓）
 *   → CDP 把 **src/composables/ggbExec.ts 的真身**注入页面 → 拿真 applet 跑我们的执行器 ✓
 *
 * 用法：node .probe/_ggbreal.cjs   （要能起 Chrome —— 受限沙箱下报 OpenProcess 拒绝 ✓ 需放开）
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const ROOT = process.env.LJ_ROOT || "D:/vue-app";
const OUT = process.env.LJ_OUT || "C:/Users/老冀/Desktop/vue-app/.probe/shots";
const PORT = +(process.env.LJ_GGB_PORT || 9225);
const PROBE_HTML = path.join(ROOT, ".probe", "_ggbprobe.html");
const PROFILE = path.join(OUT, "ggb-chrome-prof");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GGB_DIR = ROOT.replace(/\\/g, "/");
let bad = 0;
function ok(c, m) { if (c) console.log("  [ok] " + m); else { bad++; console.log("  [XX] " + m) } }
function findChrome() {
  const cands = [process.env.LJ_GGB_CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean);
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  return "";
}
const HARNESS = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8" /><title>LJ 真引擎探针</title>
<style>html,body{margin:0;height:100%} #host{width:660px;height:480px}</style></head><body>
<div id="host"></div>
<script src="file:///${GGB_DIR}/dist/geogebra/deployggb.js"></script>
<script>
window.__probe = { ready:false, err:"", logs:[] };
window.addEventListener('error', function(e){ window.__probe.err = String(e.message||e) });
try {
  var app = new GGBApplet({ id:'ggbReal', appName:'classic', width:660, height:480,
    showToolBar:false, showAlgebraInput:false, showMenuBar:false, showResetIcon:false, enableShiftDragZoom:false,
    appletOnLoad:function(api){ window.ggbApi = api; window.__probe.ready = true; window.__probe.logs.push('appletOnLoad ok') } }, true);
  if (typeof app.setHTML5Codebase === 'function') app.setHTML5Codebase('file:///${GGB_DIR}/dist/geogebra/5.0/web3d/', true);
  app.inject('host'); window.__probe.logs.push('injected');
} catch(e) { window.__probe.err = 'inject 异常：' + (e && e.message) }
</script></body></html>`;

(async () => {
  const chrome = findChrome();
  if (!chrome) { console.log("[XX] 找不到 Chrome / Edge（用 LJ_GGB_CHROME=<路径> 指定）"); process.exit(1) }
  fs.writeFileSync(PROBE_HTML, HARNESS, "utf8");
  console.log("浏览器：" + chrome + "\n宿主页：" + PROBE_HTML);
  const child = spawn(chrome, ["--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + PROFILE,
    "--allow-file-access-from-files", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--window-size=760,560", "file:///" + PROBE_HTML.replace(/\\/g, "/")], { stdio: "ignore" });
  try {
    let ws = null;
    for (let i = 0; i < 40 && !ws; i++) {
      try {
        const list = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
        const t = list.find((x) => x.type === "page" && /_ggbprobe\.html/.test(x.url)) || list.find((x) => x.type === "page");
        if (t && t.webSocketDebuggerUrl) ws = new WebSocket(t.webSocketDebuggerUrl);
      } catch (e) { /* 等 */ }
      if (!ws) await sleep(500);
    }
    if (!ws) { console.log("[XX] 连不上无头浏览器（受限沙箱下 Chrome 起不来 → 这一步要放开权限 ✓）"); process.exit(1) }
    let id = 0; const pend = new Map();
    ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } });
    await new Promise((r) => ws.addEventListener("open", r));
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) });
    const ev = async (expr) => {
      const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) return "EXC:" + String(r.result.exceptionDetails.text || "");
      return r.result && r.result.result ? r.result.result.value : undefined;
    };
    const evj = async (expr) => { const s = await ev(expr); try { return JSON.parse(s) } catch (e) { return {} } };
    await send("Runtime.enable");
    let ready = false;
    for (let i = 0; i < 60; i++) {
      const o = await evj("JSON.stringify(window.__probe||null)");
      if (o && o.ready) { ready = true; break }
      if (o && o.err) { console.log("[XX] 引擎起来前报错：" + o.err); break }
      await sleep(500);
    }
    if (!ready) { console.log("[XX] GeoGebra 没能就绪"); process.exit(1) }
    console.log("[ok] 本地 GeoGebra 就绪 ✓（无头 + file:// + 离线）版本 " + (await ev("String(ggbApi.getVersion())")));

    /* 注入真执行器 */
    const esbuild = require(path.join(ROOT, "node_modules", "esbuild"));
    const bundle = (entry, name) => esbuild.buildSync({
      entryPoints: [path.join(ROOT, "src", "composables", entry)],
      bundle: true, format: "iife", globalName: name, platform: "browser", logLevel: "error",
      write: false, alias: { "@": path.join(ROOT, "src") },
    }).outputFiles[0].text;
    await ev(bundle("ggbExec.ts", "LJEx"));
    await ev(bundle("ggbSolve.ts", "LJSv"));
    await ev(bundle("ggbNorm.ts", "LJNm"));
    ok((await ev("!!(window.LJEx && window.LJEx.execSolveSteps && window.LJSv && window.LJSv.ggbAutoQueries && window.LJNm && window.LJNm.ggbCmdName)")) === true,
      "★把真执行器（ggbExec.ts）+ 纯函数（ggbSolve.ts）+ 命令名归一（ggbNorm.ts）注入页面 ✓");

    const S = (tool, cmd, say) => ({ tool, cmd, say: say || "", mode: 1 });
    const plan = JSON.stringify([
      S("point", "A=(0,0)", "建 A"), S("point", "B=(3,0)", "建 B"),
      S("segment", "s=Segment(A,B)", "线段 AB"), S("midpoint", "D=Midpoint(A,B)", "AB 中点"),
    ]);

    /* ① 作图：真引擎上跑我们的执行器 */
    const o1 = await evj(`(async function(){
      var log = []; var push = function(l){ log.push(String(l)) };
      var steps = ${plan}; var fails = [], reads = [];
      var okN = await LJEx.execSolveSteps(ggbApi, steps, fails, reads, push, { mode: 0, step: 0 });
      await new Promise(function(r){ setTimeout(r, 400) });
      return JSON.stringify({ okN: okN, fails: fails, names: ggbApi.getAllObjectNames(),
        missing: LJEx.missingObjects(ggbApi, steps) });
    })()`);
    ok(o1.okN === 4 && (o1.fails || []).length === 0, "★4 步作图在真引擎上全成功（ok=" + o1.okN + "）");
    ok((o1.names || []).indexOf("s") >= 0 && (o1.names || []).indexOf("D") >= 0, "★真引擎上对象都在（" + (o1.names || []).join("、") + "）");
    ok((o1.missing || []).length === 0, "★missingObjects 认为该建的都建出来了 ✓");

    /* ② 读数：真算 + 临时对象清掉 */
    const o2 = await evj(`(async function(){
      var reads = await LJEx.execQueryExprs(ggbApi, ['Distance(A,B)','x(D)','y(D)'], '量一下', function(){});
      await new Promise(function(r){ setTimeout(r, 200) });
      return JSON.stringify({ reads: reads, names: ggbApi.getAllObjectNames() });
    })()`);
    const val = (e) => { const f = (o2.reads || []).find((r) => r.expr === e); return f ? f.value : "（缺）" };
    ok(val("Distance(A,B)") === "3", "★真引擎读数 Distance(A,B) = " + val("Distance(A,B)") + "（期望 3）");
    ok(val("x(D)") === "1.5" && val("y(D)") === "0", "★真引擎读数 x(D)=" + val("x(D)") + "、y(D)=" + val("y(D)") + "（期望 1.5 / 0）");
    ok((o2.names || []).indexOf("ljqTemp") < 0, "★临时对象在真引擎上没留痕 ✓");

    /* ③ 依赖图：**必须用命令串**（真引擎的 getDefinitionString 是本地化描述 ✗） */
    const o3 = await evj(`(function(){
      var items = LJEx.readTrack(ggbApi, {}, []);
      return JSON.stringify({ items: items.map(function(i){ return { name:i.name, refs:i.refs, deps:i.deps, style:i.style||'' } }),
        defS: ggbApi.getDefinitionString ? String(ggbApi.getDefinitionString('s')) : '',
        cmdS: ggbApi.getCommandString ? String(ggbApi.getCommandString('s')) : '' });
    })()`);
    const find3 = (n) => (o3.items || []).find((i) => i.name === n) || {};
    console.log("      真引擎原话：getDefinitionString('s') = " + JSON.stringify(o3.defS) + " ✗ / getCommandString('s') = " + JSON.stringify(o3.cmdS) + " ✓");
    ok((find3("s").refs || []).join(",") === "A,B", "★命令串抠出依赖：s → [" + (find3("s").refs || []).join(",") + "]（期望 A,B）");
    ok((find3("A").deps || []).indexOf("s") >= 0 && (find3("A").deps || []).indexOf("D") >= 0, "★被依赖反向补全：A ← " + (find3("A").deps || []).join("、"));
    ok(typeof find3("s").style === "string" && find3("s").style.length > 0, "★样式 getter 真能读到（" + find3("s").style + "）");

    /* ④ 回滚契约（**在删东西之前做** ✓ 不然快照里就没 A 了 ✗） */
    const o4 = await evj(`(async function(){
      var xml = ggbApi.getXML();
      ggbApi.evalCommand('P=(9,9)');
      await new Promise(function(r){ setTimeout(r, 250) });
      var hasP = ggbApi.getAllObjectNames().indexOf('P') >= 0;
      ggbApi.setXML(xml);
      await new Promise(function(r){ setTimeout(r, 350) });
      var names = ggbApi.getAllObjectNames();
      return JSON.stringify({ hasP: hasP, names: names, hasA: names.indexOf('A') >= 0, hasP2: names.indexOf('P') >= 0 });
    })()`);
    ok(o4.hasP === true && o4.hasP2 === false && o4.hasA === true, "★回滚契约成立：setXML 后 P 没了、A 回来了（剩 " + (o4.names || []).join("、") + "）");

    /* ⑤ 自动读数（也要在删之前 ✓） */
    const o5 = await evj(`(async function(){
      var exprs = LJSv.ggbAutoQueries(${plan});
      var reads = await LJEx.execQueryExprs(ggbApi, exprs, '自动读数', function(){});
      return JSON.stringify({ exprs: exprs, reads: reads.map(function(r){ return r.expr + '=' + r.value }) });
    })()`);
    ok((o5.exprs || []).length >= 4, "★自动读数推出的表达式：" + (o5.exprs || []).join(" / "));
    const got = (o5.reads || []).filter((x) => x.indexOf("=") > 0 && x.split("=")[1] !== "");
    ok(got.length >= 4, "★这些表达式在真引擎上都取到了值（" + got.join("　") + "）");

    /* ⑥ 删除：真级联（真引擎没有 getDependentObjects ✓ 走「板上真实定义图」那一档 ✓） */
    const o6 = await evj(`(async function(){
      var log = []; var push = function(l){ log.push(String(l)) };
      var fails = [];
      var n = await LJEx.execSolveSteps(ggbApi, [{ tool:'delete', mode:23, cmd:'Delete(A)', say:'删 A' }], fails, [], push, { mode:0, step:0 });
      await new Promise(function(r){ setTimeout(r, 300) });
      return JSON.stringify({ n: n, fails: fails, hasApi: (typeof ggbApi.getDependentObjects === 'function'),
        names: ggbApi.getAllObjectNames(), log: log });
    })()`);
    const n6 = o6.names || [];
    ok(o6.n === 1, "删除步在真引擎上执行成功 ✓");
    ok(n6.indexOf("A") < 0 && n6.indexOf("s") < 0 && n6.indexOf("D") < 0, "★真引擎级联：删 A → s、D 也掉（剩 " + n6.join("、") + "）");
    ok(n6.indexOf("B") >= 0, "★B 不受牵连 ✓");
    ok((o6.log || []).some((l) => l.indexOf("连带依赖") >= 0), "★日志报出连带依赖（" + ((o6.log || [])[0] || "").slice(0, 44) + "…）");
    console.log("      （真引擎有 getDependentObjects 吗：" + o6.hasApi + " → 走「板上真实定义图」兜底那一档 ✓）");

    /* ⑦ 真引擎怎么报错：**返回 false 而不是抛异常** ✓（这条就是它抓出来的 bug ✓） */
    const o7 = await evj(`(async function(){
      var log = []; var push = function(l){ log.push(String(l)) };
      var fails = [];
      var n = await LJEx.execSolveSteps(ggbApi, [{ tool:'point', mode:1, cmd:'Nonsense(A,B,C)', say:'故意写错' }], fails, [], push, { mode:0, step:0 });
      return JSON.stringify({ n: n, fails: fails, ret: ggbApi.evalCommand('Nonsense2(A,B)') });
    })()`);
    ok((o7.fails || []).length === 1 && o7.n === 0, "★真引擎返回 false 时，我们的执行器把它算成失败（fails=" + ((o7.fails || [])[0] ? String(o7.fails[0].err).slice(0, 44) : 0) + "）");
    ok(o7.ret === false, "★（顺带记下）真引擎 evalCommand 失败就是返回 false：JSON=" + JSON.stringify(o7.ret));

    /* ⑧【v1736】拖动测试（真引擎）：把驱动点挪开，真约束该跟着走 ✓ 中文命令串该认得出 ✓ */
    const o8 = await evj(`(async function(){
      if (typeof ggbApi.reset === "function") ggbApi.reset();
      var log = []; var push = function(l){ log.push(String(l)) };
      ggbApi.evalCommand("A=(0,0)"); ggbApi.evalCommand("B=(3,0)");
      ggbApi.evalCommand("c=Circle(A,B)"); ggbApi.evalCommand("D=Point(c)"); ggbApi.evalCommand("M=Midpoint(A,B)");
      await new Promise(function(r){ setTimeout(r, 400) });
      var cmds = { c: String(ggbApi.getCommandString("c")), D: String(ggbApi.getCommandString("D")), M: String(ggbApi.getCommandString("M")) };
      var names = { c: LJNm.ggbCmdName(cmds.c), D: LJNm.ggbCmdName(cmds.D), M: LJNm.ggbCmdName(cmds.M) };
      var r = await LJEx.runDragTest(ggbApi, push, { step: 0 }, { maxDrivers: 2, dx: 0.7, dy: 0.45 });
      var after = ggbApi.getAllObjectNames();
      return JSON.stringify({ cmds: cmds, names: names, drivers: r.drivers, checks: r.checks, broken: r.broken,
        alreadyBad: r.alreadyBad, unchecked: r.unchecked, restored: r.restored, after: after, log: log.slice(-4) });
    })()`);
    const n8 = o8.names || {};
    ok(n8.c === "Circle" && n8.D === "Point" && n8.M === "Midpoint",
      "★真引擎的中文命令串归一：" + (o8.cmds || {}).c + "→" + n8.c + "、" + (o8.cmds || {}).D + "→" + n8.D + "、" + (o8.cmds || {}).M + "→" + n8.M);
    ok((o8.drivers || []).length === 2, "★真引擎上认出 " + (o8.drivers || []).length + " 个驱动点（" + (o8.drivers || []).join("、") + "）");
    ok((o8.checks || 0) >= 2, "★" + o8.checks + " 条可查关系（描点 + 中点 ✓）");
    ok((o8.broken || []).length === 0, "★真约束在真引擎上拖动后仍成立（没被拖坏 ✓ 假约束才会露馅 ✓）");
    ok(o8.restored === true && (o8.after || []).indexOf("D") >= 0, "★跑完整块还原（D 还在板上 ✓ 老师的图没动 ✓）");
    ok((o8.unchecked || []).indexOf("c") >= 0, "★如实报「没查的」（圆本身没查 ✓ 不假装全查了 ✗）");
    ok((o8.log || []).some((l) => l.indexOf("挪到") >= 0), "★日志写清把谁挪到哪儿 ✓");

    /* ⑨【v1737】动画三件套 + 教学辅助开关（真引擎端到端 ✓） */
    const o9 = await evj(`(async function(){
      if (typeof ggbApi.reset === "function") ggbApi.reset();
      var log = []; var push = function(l){ log.push(String(l)) };
      ggbApi.evalCommand("h=Circle((0,0),2)");
      ggbApi.evalCommand("s=Slider(0,10,0.1)");
      await new Promise(function(r){ setTimeout(r, 300) });
      var fails = [];
      var n = await LJEx.execSolveSteps(ggbApi, [
        { tool:"aids", mode:-1, cmd:"显示辅助|h", say:"", aids:true },
        { tool:"animate", mode:-1, cmd:"s|ping_pong|1|0|10", say:"", anim:true }
      ], fails, [], push, { step:0, driveSteps:8, driveTickMs:0, driveBlocking:true });
      var names = ggbApi.getAllObjectNames();
      var hasVis = (typeof ggbApi.getVisible === "function");
      var visOff = hasVis ? ggbApi.getVisible("h") : null;
      ggbApi.evalCommand("SetValue(aidsShow, true)");
      await new Promise(function(r){ setTimeout(r, 250) });
      var visOn = hasVis ? ggbApi.getVisible("h") : null;
      var sVal = ggbApi.getValue("s");
      ggbApi.evalCommand("SetValue(aidsShow, false)");
      await new Promise(function(r){ setTimeout(r, 250) });
      var visBack = hasVis ? ggbApi.getVisible("h") : null;
      return JSON.stringify({ n: n, fails: fails, hasCb: names.indexOf("aidsShow") >= 0, hasH: names.indexOf("h") >= 0,
        visOff: visOff, visOn: visOn, visBack: visBack, sVal: sVal, hasVis: hasVis, log: log.slice(-3) });
    })()`);
    ok(o9.n === 2 && (o9.fails || []).length === 0, "★动画步 + 辅助步在真引擎上跑成功（" + o9.n + "/2 ✓）");
    ok(o9.hasCb === true && o9.hasH === true, "★Checkbox 建出来了 ✓ 辅助对象 h 还在板上 ✓（隐藏 ≠ 删除 ✓）");
    ok(o9.visOff === false && o9.visOn === true && o9.visBack === false,
      "★开关真能显示/隐藏辅助（关 → " + o9.visOff + "、开 → " + o9.visOn + "、再关 → " + o9.visBack + " ✓）");
    ok(typeof o9.sVal === "number" && o9.sVal >= 0 && o9.sVal <= 10,
      "★我们自己驱动的动画把滑块停在区间内（s = " + o9.sVal + " ✓ 引擎没有振荡 API ✗）");

    /* ⑩【v1738】复刻往返（真引擎）：建出来 → 读回真身骨架 → 与目标骨架比 ✓ */
    const o10 = await evj(`(async function(){
      if (typeof ggbApi.reset === "function") ggbApi.reset();
      var log = []; var push = function(l){ log.push(String(l)) };
      function build(cx, cy){
        ggbApi.evalCommand("A=(0,0)"); ggbApi.evalCommand("B=(3,0)"); ggbApi.evalCommand("C=(" + cx + "," + cy + ")");
        ggbApi.evalCommand("s=Segment(A,B)"); ggbApi.evalCommand("t=Segment(A,C)"); ggbApi.evalCommand("u=Segment(B,C)");
      }
      var want = { points: [{name:"A",x:0,y:0},{name:"B",x:40,y:0},{name:"C",x:0,y:53}],
        edges: [{a:"A",b:"B",dashed:false},{a:"A",b:"C",dashed:false},{a:"B",b:"C",dashed:false}], circles: [] };
      build(0, 4);
      await new Promise(function(r){ setTimeout(r, 400) });
      var gotSk = await LJEx.boardSkeleton(ggbApi);
      var d1 = await LJEx.runBuildCheck(ggbApi, want, push);
      if (typeof ggbApi.reset === "function") ggbApi.reset();
      build(0, 3.3);
      await new Promise(function(r){ setTimeout(r, 400) });
      var d2 = await LJEx.runBuildCheck(ggbApi, want, push);
      return JSON.stringify({ sk: { p: gotSk.points.length, e: gotSk.edges.length, c: gotSk.circles.length },
        s1: d1.score, moved1: d1.moved.length, miss1: d1.missing.length, edge1: d1.edgeBad.length,
        s2: d2.score, moved2: d2.moved.length, log: log.slice(-4) });
    })()`);
    ok(o10.sk && o10.sk.p === 3 && o10.sk.e === 3, "★板上真身读成骨架：3 个点、" + ((o10.sk || {}).e) + " 条边 ✓（线段从命令串认端点 ✓）");
    ok(o10.s1 === 1 && o10.moved1 === 0 && o10.miss1 === 0 && o10.edge1 === 0,
      "★复刻往返：建对的三角形与目标骨架完全一致（" + o10.s1 + " ✓ 归一化后比，单位不同也对得上 ✓）");
    ok(o10.s2 < 1 && o10.moved2 >= 1, "★把 C 建歪（4 → 3.3）→ 往返比对立刻掉下来（" + o10.s2 + "，偏 " + o10.moved2 + " 个点 ✗）");

    console.log(bad ? "\n[XX] 真引擎有 " + bad + " 处问题" : "\n[ok] 真引擎全过 ✓（本地 GeoGebra 5.2 + 真执行器 ✓）");
    ws.close();
  } finally { try { child.kill() } catch (e) { /* 忽略 */ } }
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log("[XX] 跑挂了：" + (e && e.message)); process.exit(1) });
