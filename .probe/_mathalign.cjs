/**
 * _mathalign.cjs —— 【v1747】**公式排版探针**：中文与"大公式"的垂直对齐，用数字说话 ✓
 *
 * 为什么要有它：老师反馈「联立 + 大括号方程组」里，中文会贴在括号**底部** ✗
 *   根因：MathJax 对行内公式用**基线对齐** ✓（小公式正确 ✓）—— 但对 cases/大括号这种
 *   高度远大于一行的公式 ✗，基线对齐就把前面的中文按"文字基线"贴到公式底部 ✓
 *   本探针渲染三种写法，直接量「中文中心 − 公式中心」的像素差 ✓（0 = 居中 ✓ 越大越贴底 ✓）
 *
 *   A 现状：应用当前规则（inline-flex + margin:0）           → 预期偏差很大（复现问题 ✓）
 *   B 修法：A + `vertical-align: middle`                     → 预期 ≈0（居中 ✓）
 *   C 库配方：把中文写进公式里 `\[\text{联立}\begin{cases}…`  → 预期 ≈0（天然对齐 ✓）
 *
 * 用法：node .probe/_mathalign.cjs      （要能起 Chrome ✓）
 */
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const ROOT = process.env.LJ_ROOT || "D:/vue-app";
const OUT = process.env.LJ_OUT || path.join(ROOT, ".probe", "shots");
const PORT = +(process.env.LJ_MATH_PORT || 9320);
const CDP = PORT + 1;
const MJ = path.join(ROOT, "public", "mathjax", "tex-svg.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
function ok(c, m) { if (c) console.log("  [ok] " + m); else { bad++; console.log("  [XX] " + m) } }

/** 三种写法共用一个"联立 + 大括号方程组"样例 ✓ */
const SYS = String.raw`\begin{cases}2x+3y=1\\x-y=2\end{cases}`;
const PAGE = [
  "<!doctype html><meta charset=\"utf-8\">",
  "<style>",
  "  body { font: 24px \"Microsoft YaHei\", \"Segoe UI\", sans-serif; margin: 0; padding: 20px; color: #111; }",
  "  .mix { margin: 26px 0; }",
  "  /* 应用现有规则（styles/main.css 的 .fx-mixed-host 那段） */",
  "  .mix mjx-container[display=\"true\"] { display: inline-flex !important; margin: 0 !important; }",
  "  /* 修法：只给 display 公式加垂直居中（普通行内公式不受影响 ✓） */",
  "  #b mjx-container[display=\"true\"] { vertical-align: middle !important; }",
  "</style>",
  "<div class=\"mix\" id=\"a\"><span id=\"ta\">联立</span>\\[" + SYS + "\\]</div>",
  "<div class=\"mix\" id=\"b\"><span id=\"tb\">联立</span>\\[" + SYS + "\\]</div>",
  "<div class=\"mix\" id=\"c\"><span id=\"tc\">（中文写在公式里）</span>\\[\\text{联立}" + SYS + "\\]</div>",
  "<script>",
  "window.MathJax = {",
  "  tex: { inlineMath: [['$','$'],['\\\\(','\\\\)']], displayMath: [['$$','$$'],['\\\\[','\\\\]']],",
  "         macros: { R: '\\\\mathbb{R}', abs: ['\\\\left|#1\\\\right|', 1] } },",
  "  startup: { typeset: false },",
  "  svg: { fontCache: 'none' },",
  "};",
  "</scr" + "ipt>",
  "<script src=\"/tex-svg.js\"></scr" + "ipt>",
  "<script>",
  "window.__ready = false; window.__err = '';",
  "MathJax.startup.promise",
  "  .then(function(){ return MathJax.typesetPromise([document.getElementById('a'),document.getElementById('b'),document.getElementById('c')]); })",
  "  .then(function(){ window.__ready = true; })",
  "  .catch(function(e){ window.__err = String(e); });",
  "</scr" + "ipt>",
].join("\n");

(async () => {
  if (!fs.existsSync(MJ)) { console.log("[XX] 没有 " + MJ + "（MathJax 本地副本 ✓）"); process.exit(1) }
  fs.mkdirSync(OUT, { recursive: true });
  const srv = http.createServer((req, res) => {
    const u = String(req.url || "/").split("?")[0];
    if (u === "/tex-svg.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(fs.readFileSync(MJ)); return }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(PAGE);
  });
  await new Promise((r) => srv.listen(PORT, "127.0.0.1", r));

  const chrome = fs.existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe") ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : process.env.LJ_GGB_CHROME;
  if (!chrome) { console.log("[XX] 找不到 Chrome"); srv.close(); process.exit(1) }
  const child = spawn(chrome, ["--headless=new", "--remote-debugging-port=" + CDP, "--user-data-dir=" + path.join(OUT, "math-prof"),
    "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--window-size=900,700", "about:blank"], { stdio: "ignore" });
  const kill = () => { try { child.kill() } catch { /* 忽略 */ } };
  try {
    let ws = null;
    for (let i = 0; i < 40 && !ws; i++) {
      try {
        const list = await (await fetch("http://127.0.0.1:" + CDP + "/json/list")).json();
        const t = list.find((x) => x.type === "page");
        if (t && t.webSocketDebuggerUrl) ws = new WebSocket(t.webSocketDebuggerUrl);
      } catch { /* 等 */ }
      if (!ws) await sleep(500);
    }
    if (!ws) { console.log("[XX] 连不上无头浏览器（受限沙箱下 Chrome 起不来 → 这一步要放开 ✓）"); process.exit(1) }
    let id = 0; const pend = new Map();
    ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } });
    await new Promise((r) => ws.addEventListener("open", r));
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) });
    const ev = async (expr) => {
      const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) return "__EXC__" + String(r.result.exceptionDetails.text || "");
      return r.result && r.result.result ? r.result.result.value : undefined;
    };
    await send("Runtime.enable");
    await send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/" });
    let ready = false;
    for (let i = 0; i < 40; i++) { if ((await ev("window.__ready === true")) === true) { ready = true; break } await sleep(300) }
    const err = await ev("String(window.__err || '')");
    ok(ready === true, "★MathJax 排完了（真引擎 ✓" + (ready ? "" : " 报错：" + err) + "）");

    const meas = await ev(`(function(){
      function m(hid, tid){
        var h = document.getElementById(hid), t = document.getElementById(tid);
        var c = h.querySelector('mjx-container');
        if (!c || !t) return null;
        var tr = t.getBoundingClientRect(), cr = c.getBoundingClientRect();
        return { off: +(((tr.top + tr.height/2) - (cr.top + cr.height/2)).toFixed(1)),
                 w: Math.round(cr.width), h: Math.round(cr.height),
                 paths: c.querySelectorAll('path').length };
      }
      /* C 的中文在**公式内部**（\\text{联立}）→ 要量 MathJax 自己的 mtext 节点 ✓
         （量外面的 span 是错的 ✗ 那跟 A 一回事 ✓ 第一版探针就栽在这儿 ✓） */
      function inner(hid){
        var h = document.getElementById(hid);
        var c = h.querySelector('mjx-container');
        if (!c) return null;
        var mt = c.querySelector('[data-mml-node="mtext"]');
        var cr = c.getBoundingClientRect();
        if (!mt) return { off: null, hasText: false, w: Math.round(cr.width), h: Math.round(cr.height) };
        var mr = mt.getBoundingClientRect();
        return { off: +(((mr.top + mr.height/2) - (cr.top + cr.height/2)).toFixed(1)),
                 hasText: true, w: Math.round(cr.width), h: Math.round(cr.height), paths: c.querySelectorAll('path').length };
      }
      return JSON.stringify({ a: m('a','ta'), b: m('b','tb'), c: inner('c') });
    })()`);
    let R = null;
    try { R = JSON.parse(String(meas)) } catch { /* 见下面的断言 */ }
    if (!R || !R.a) { ok(false, "测量失败：" + String(meas).slice(0, 120)); }
    else {
      ok(R.a.paths > 5 && R.a.h > 30, "★公式真的渲染出来了（" + R.a.w + "×" + R.a.h + "px，" + R.a.paths + " 条字形路径 ✓）");
      console.log("     现状 A（基线对齐）中文中心 − 公式中心 = " + R.a.off + " px");
      console.log("     修法 B（middle）   中文中心 − 公式中心 = " + R.b.off + " px");
      console.log("     库配方 C（\\text{} 写在公式里）中文中心 − 公式中心 = " + (R.c && R.c.off) + " px");
      ok(Math.abs(R.a.off) > 8, "★复现了老师看到的问题：基线对齐下中文明显偏底（偏 " + R.a.off + "px ✓ 越大越贴底）");
      ok(Math.abs(R.b.off) <= 4, "★修法有效：只给 display 公式加 vertical-align:middle 就居中了（偏 " + R.b.off + "px ✓）");
      ok(!!R.c && R.c.hasText === true && Math.abs(R.c.off) <= 6, "★库配方也天然居中（中文在 \\text{} 里、由 MathJax 自己排，偏 " + (R.c && R.c.off) + "px ✓）");
    }
    /* 接线断言：应用 css 里那条规则必须已经带上 middle ✓
       ⚠ 先**剥掉注释**再取规则 ✗ —— 注释里可能出现 `}`（第一版就在这儿栽了 ✓ 取到第一个 } 就断 ✓） */
    const css = fs.readFileSync(path.join(ROOT, "src", "styles", "main.css"), "utf8");
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const mm = stripped.match(/\.fx-mixed-host\s+mjx-container\[display="true"\]\s*\{([^}]*)\}/);
    const body = mm ? mm[1] : "";
    ok(body.indexOf("vertical-align") >= 0, "★应用 css 的 .fx-mixed-host display 公式规则已加 vertical-align（实测片段：「" + body.replace(/\s+/g, " ").trim().slice(0, 70) + "」✓）");
    ok(!/\.fx-mixed-host mjx-container\s*\{/.test(stripped), "★没有误伤普通行内公式（只动 [display=\"true\"] 那一类 ✓）");
  } finally {
    kill();
    srv.close();
  }
  console.log(bad ? "\n[XX] 公式排版探针有 " + bad + " 处问题" : "\n[ok] 公式排版探针全过 ✓");
  process.exit(bad ? 1 : 0);
})();
