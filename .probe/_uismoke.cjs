/**
 * _uismoke.cjs —— 【v1740】**界面冒烟探针**：真把打包后的应用点一遍 ✓
 *
 * 为什么要有它：v1739 那个 TDZ 崩溃，静态断言（"文件里有没有这几个字符串"）**根本抓不到** ✗
 *   —— 纯函数探针也抓不到 ✗（崩的是组件挂载时的求值顺序 ✓）
 *   只有"真的把界面点开"才能发现 ✓ 所以补这一道：
 *     起一个临时静态服务器（只读 dist/ ✓ 结束就关 ✓）→ 无头 Chrome 打开 →
 *     点「数学图形」→ 切到「图形重建」→ 点「三维立体图」→ **窗口必须出现** ✓ 且**全程不许有报错** ✓
 *
 * 用法：node .probe/_uismoke.cjs      （要能起 Chrome —— 受限沙箱下会报 OpenProcess 拒绝 ✓ 需放开）
 */
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const ROOT = process.env.LJ_ROOT || "D:/vue-app";
const DIST = path.join(ROOT, "dist");
const PORT = +(process.env.LJ_UI_PORT || 9310);
const CDP = PORT + 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
function ok(c, m) { if (c) console.log("  [ok] " + m); else { bad++; console.log("  [XX] " + m) } }
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".wasm": "application/wasm", ".ggb": "application/octet-stream" };

(async () => {
  if (!fs.existsSync(path.join(DIST, "index.html"))) { console.log("[XX] 没有 dist/index.html（先 npm run build ✓）"); process.exit(1) }
  /* ① 临时静态服务器（只读 ✓ 结束随手关 ✓） */
  const srv = http.createServer((req, res) => {
    const url = decodeURIComponent(String(req.url || "/").split("?")[0]);
    let f = path.join(DIST, url.replace(/^\/+/, ""))
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, "index.html")
    try {
      res.writeHead(200, { "content-type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream" })
      res.end(fs.readFileSync(f))
    } catch { res.writeHead(404); res.end("no") }
  })
  await new Promise((r) => srv.listen(PORT, "127.0.0.1", r))
  console.log("静态服务器：http://127.0.0.1:" + PORT + "（只读 dist/ ✓ 结束就关 ✓）");

  const chrome = fs.existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe") ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : process.env.LJ_GGB_CHROME;
  if (!chrome) { console.log("[XX] 找不到 Chrome"); srv.close(); process.exit(1) }
  const prof = process.env.LJ_OUT ? path.join(process.env.LJ_OUT, "ui-smoke-prof") : path.join(ROOT, ".probe", "shots", "ui-smoke-prof");
  const child = spawn(chrome, ["--headless=new", "--remote-debugging-port=" + CDP, "--user-data-dir=" + prof,
    "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--window-size=1280,900", "about:blank"], { stdio: "ignore" });
  const kill = () => { try { child.kill() } catch { /* 忽略 */ } };
  try {
    let ws = null;
    for (let i = 0; i < 40 && !ws; i++) {
      try {
        const list = await (await fetch("http://127.0.0.1:" + CDP + "/json/list")).json();
        const t = list.find((x) => x.type === "page")
        if (t && t.webSocketDebuggerUrl) ws = new WebSocket(t.webSocketDebuggerUrl)
      } catch { /* 等 */ }
      if (!ws) await sleep(500)
    }
    if (!ws) { console.log("[XX] 连不上无头浏览器（受限沙箱下 Chrome 起不来 → 这一步要放开权限 ✓）"); process.exit(1) }
    let id = 0; const pend = new Map(); const errs = [];
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data)
      if (m.method === "Runtime.exceptionThrown") errs.push(String(m.params?.exceptionDetails?.exception?.description || m.params?.exceptionDetails?.text || "异常").slice(0, 200))
      if (m.method === "Runtime.consoleAPICalled" && m.params?.type === "error") errs.push("console.error：" + String((m.params.args || []).map((a) => a.value || a.description || "").join(" ")).slice(0, 200))
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
    })
    await new Promise((r) => ws.addEventListener("open", r))
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
    const ev = async (expr) => {
      const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })
      if (r.result && r.result.exceptionDetails) return "__EXC__" + String(r.result.exceptionDetails.text || "")
      return r.result && r.result.result ? r.result.result.value : undefined
    }
    await send("Runtime.enable");
    await send("Page.enable");
    await send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/index.html" })
    await sleep(1200)
    /* ② 等应用挂起来（找那个"数学图形"按钮 ✓ 它就是工具栏上的真按钮 ✓） */
    let up = false
    for (let i = 0; i < 40; i++) {
      if ((await ev('!!document.querySelector(\'button[title^="数学图形"]\')')) === true) { up = true; break }
      await sleep(500)
    }
    ok(up, "应用起来了（工具栏「数学图形」按钮在 ✓）");
    if (!up) { console.log("  页面标题：" + await ev("document.title") + " / body 前 120 字：" + String(await ev("document.body ? document.body.innerText.slice(0,120) : ''"))); }
    if (up) {
      await ev('document.querySelector(\'button[title^="数学图形"]\').click()')
      let hasPal = false
      for (let i = 0; i < 20; i++) { if ((await ev('!!document.querySelector(".palette")')) === true) { hasPal = true; break } await sleep(300) }
      ok(hasPal, "图形库面板打开了 ✓");
      if (hasPal) {
        const tabs = await ev('JSON.stringify([...document.querySelectorAll(".palette__tabs .tab")].map(b=>b.textContent.trim()))')
        ok(String(tabs).indexOf("图形重建") >= 0, "分类里有「图形重建」页签：" + String(tabs).slice(0, 120));
        await ev('(function(){var t=[...document.querySelectorAll(".palette__tabs .tab")].find(b=>b.textContent.indexOf("图形重建")>=0); if(t)t.click(); return !!t})()')
        await sleep(400)
        const cards = await ev('JSON.stringify([...document.querySelectorAll(".palette__grid button")].map(b=>b.textContent.trim()))')
        ok(String(cards).indexOf("三维立体图") >= 0, "「图形重建」里有「三维立体图」卡片：" + String(cards).slice(0, 160));
        ok(String(cards).indexOf("AI 还原结构") >= 0, "「图形重建」里有「AI 还原结构」卡片 ✓（用户说找不到入口 ✓）");
        /* ③ 点开三维窗口 —— v1739 就是在这里崩的 ✗ */
        await ev('(function(){var b=[...document.querySelectorAll(".palette__grid button")].find(x=>x.textContent.indexOf("三维立体图")>=0); if(b)b.click(); return !!b})()')
        let hasG3 = false
        for (let i = 0; i < 24; i++) { if ((await ev('!!document.querySelector(".g3")')) === true) { hasG3 = true; break } await sleep(300) }
        ok(hasG3, "★点「三维立体图」→ 三维窗口**真的出现了** ✓（v1739 这里抛 ReferenceError → 用户看到「不见了」✗）");
        if (hasG3) {
          const hasAi = await ev('!!document.querySelector(".g3") && document.querySelector(".g3").innerText.indexOf("让 AI 还原结构") > 0')
          ok(hasAi === true, "★三维窗口里「让 AI 还原结构」就在模型页顶上、一眼能看见 ✓");
        }
      }
    }
    ok(errs.length === 0, "全程没有未捕获异常 / console.error ✓" + (errs.length ? "（实际 " + errs.length + " 条 ✗）" : ""));
    if (errs.length) errs.slice(0, 5).forEach((e) => console.log("      ✗ " + e));
    console.log(bad ? "\n[XX] 界面冒烟有 " + bad + " 处问题" : "\n[ok] 界面冒烟全过 ✓（真点了一遍 ✓）");
    ws.close();
  } finally {
    kill();
    srv.close();
  }
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log("[XX] 冒烟跑挂了：" + (e && e.message)); process.exit(1) });
