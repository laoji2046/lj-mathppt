/**
 * _uismoke.cjs —— 【v1740 起】**界面冒烟探针**：真把打包后的应用点一遍 ✓
 *
 * 为什么要有它：v1739 那个 TDZ 崩溃，静态断言（"文件里有没有这几个字符串"）**根本抓不到** ✗
 *   —— 纯函数探针也抓不到 ✗（崩的是组件挂载时的求值顺序 ✓）
 *   只有"真的把界面点开"才能发现 ✓ 所以补这一道：
 *     A. 图形库 → 图形重建 → 三维立体图 → **窗口必须出现** ✓
 *     B. 图形库 → 图形重建 → 自图片重建（塞一张测试 PNG 进文件框 ✓）→ **窗口必须出现** + AI 入口在 + 窗口确实放大了 ✓
 *   全程收集未捕获异常 / console.error ✓
 *
 * 用法：node .probe/_uismoke.cjs      （要能起 Chrome —— 受限沙箱下会报 OpenProcess 拒绝 ✓ 需放开）
 */
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const zlib = require("zlib");
const { spawn } = require("child_process");
const ROOT = process.env.LJ_ROOT || "D:/vue-app";
const DIST = path.join(ROOT, "dist");
const OUT = process.env.LJ_OUT || path.join(ROOT, ".probe", "shots");
const PORT = +(process.env.LJ_UI_PORT || 9310);
const CDP = PORT + 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
function ok(c, m) { if (c) console.log("  [ok] " + m); else { bad++; console.log("  [XX] " + m) } }
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".wasm": "application/wasm" };

/** 造一张测试 PNG（白底 + 一条黑对角线 + 左边框 ✓ 让识别器有东西可认 ✓ 免得写死 base64 ✗） */
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    let c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function makePng(w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const o = row + 1 + x * 3;
      const on = Math.abs(y - x) <= 1 || y === 0 || x === 0;
      raw[o] = on ? 0 : 255; raw[o + 1] = on ? 0 : 255; raw[o + 2] = on ? 0 : 255;
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

(async () => {
  if (!fs.existsSync(path.join(DIST, "index.html"))) { console.log("[XX] 没有 dist/index.html（先 npm run build ✓）"); process.exit(1) }
  fs.mkdirSync(OUT, { recursive: true });
  const pngPath = path.join(OUT, "_uismoke.png");
  fs.writeFileSync(pngPath, makePng(120, 120));
  /* ① 临时只读静态服务器 */
  const srv = http.createServer((req, res) => {
    const url = decodeURIComponent(String(req.url || "/").split("?")[0]);
    let f = path.join(DIST, url.replace(/^\/+/, ""));
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, "index.html");
    try {
      res.writeHead(200, { "content-type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream" });
      res.end(fs.readFileSync(f));
    } catch { res.writeHead(404); res.end("no") }
  });
  await new Promise((r) => srv.listen(PORT, "127.0.0.1", r));
  console.log("静态服务器：http://127.0.0.1:" + PORT + "（只读 dist/ ✓ 结束就关 ✓）");

  const chrome = fs.existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe") ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : process.env.LJ_GGB_CHROME;
  if (!chrome) { console.log("[XX] 找不到 Chrome"); srv.close(); process.exit(1) }
  const child = spawn(chrome, ["--headless=new", "--remote-debugging-port=" + CDP, "--user-data-dir=" + path.join(OUT, "ui-smoke-prof"),
    "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--window-size=1440,900", "about:blank"], { stdio: "ignore" });
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
    if (!ws) { console.log("[XX] 连不上无头浏览器（受限沙箱下 Chrome 起不来 → 这一步要放开权限 ✓）"); process.exit(1) }
    let id = 0; const pend = new Map(); const errs = [];
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.method === "Runtime.exceptionThrown") errs.push(String(m.params?.exceptionDetails?.exception?.description || m.params?.exceptionDetails?.text || "异常").slice(0, 200));
      if (m.method === "Runtime.consoleAPICalled" && m.params?.type === "error") errs.push("console.error：" + String((m.params.args || []).map((a) => a.value || a.description || "").join(" ")).slice(0, 200));
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
    });
    await new Promise((r) => ws.addEventListener("open", r));
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) });
    const ev = async (expr) => {
      const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) return "__EXC__" + String(r.result.exceptionDetails.text || "");
      return r.result && r.result.result ? r.result.result.value : undefined;
    };
    await send("Runtime.enable");
    await send("Page.enable");
    await send("DOM.enable");
    const openApp = async () => {
      await send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/index.html" });
      await sleep(1200);
      for (let i = 0; i < 40; i++) {
        if ((await ev('!!document.querySelector(\'button[title^="数学图形"]\')')) === true) return true;
        await sleep(500);
      }
      return false;
    };
    const openPalette = async () => {
      await ev('document.querySelector(\'button[title^="数学图形"]\').click()');
      for (let i = 0; i < 20; i++) { if ((await ev('!!document.querySelector(".palette")')) === true) return true; await sleep(300) }
      return false;
    };
    const gotoTab = async (name) => {
      await ev('(function(){var t=[...document.querySelectorAll(".palette__tabs .tab")].find(b=>b.textContent.indexOf("' + name + '")>=0); if(t)t.click(); return !!t})()');
      await sleep(400);
    };

    /* ============ A. 三维立体图（v1739 就是在这里崩的 ✗） ============ */
    console.log("--- A. 图形库 → 图形重建 → 三维立体图 ---");
    let up = await openApp();
    ok(up, "应用起来了（工具栏「数学图形」按钮在 ✓）");
    if (up) {
      ok(await openPalette(), "图形库面板打开了 ✓");
      const tabs = await ev('JSON.stringify([...document.querySelectorAll(".palette__tabs .tab")].map(b=>b.textContent.trim()))');
      ok(String(tabs).indexOf("图形重建") >= 0, "分类里有「图形重建」页签 ✓");
      await gotoTab("图形重建");
      const cards = await ev('JSON.stringify([...document.querySelectorAll(".palette__grid button")].map(b=>b.textContent.trim()))');
      ok(String(cards).indexOf("三维立体图") >= 0, "「图形重建」里有「三维立体图」卡片 ✓");
      ok(String(cards).indexOf("AI 还原结构") >= 0, "「图形重建」里有「AI 还原结构」卡片 ✓");
      await ev('(function(){var b=[...document.querySelectorAll(".palette__grid button")].find(x=>x.textContent.indexOf("三维立体图")>=0); if(b)b.click(); return !!b})()');
      let hasG3 = false;
      for (let i = 0; i < 24; i++) { if ((await ev('!!document.querySelector(".g3")')) === true) { hasG3 = true; break } await sleep(300) }
      ok(hasG3, "★点「三维立体图」→ 三维窗口**真的出现了** ✓（v1739 这里抛 ReferenceError ✗）");
      if (hasG3) ok((await ev('document.querySelector(".g3").innerText.indexOf("让 AI 还原结构") > 0')) === true, "★三维窗口里「让 AI 还原结构」在模型页顶上 ✓");
    }

    /* ============ B. 自图片重建（v1741：放大 + AI 读图） ============ */
    console.log("--- B. 图形库 → 图形重建 → 自图片重建 ---");
    up = await openApp();
    if (up) {
      ok(await openPalette(), "（重进）图形库面板打开了 ✓");
      await gotoTab("图形重建");
      const doc = await send("DOM.getDocument", { depth: -1 });
      // ⚠ 应用里不止一个 `input[type=file]`（工具栏/其它弹窗都有 ✗）→ 必须限定在**图形面板**里 ✓
      let q = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: ".palette input[type=file]" });
      if (!q.result || !q.result.nodeId) q = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "input[type=file]" });
      const nodeId = q.result && q.result.nodeId;
      ok(!!nodeId, "找到选图用的文件输入框 ✓（CDP 直接塞文件，绕开系统文件对话框 ✓）");
      if (nodeId) {
        await send("DOM.setFileInputFiles", { files: [pngPath], nodeId });
        let hasVd = false;
        for (let i = 0; i < 30; i++) { if ((await ev('!!document.querySelector(".vd")')) === true) { hasVd = true; break } await sleep(300) }
        ok(hasVd, "★选中一张图 → 「自图片重建」窗口**真的出现了** ✓");
        if (hasVd) {
          const box = await ev('(function(){var b=document.querySelector(".vd__box"); if(!b) return ""; var r=b.getBoundingClientRect(); return Math.round(r.width)+"x"+Math.round(r.height)})()');
          ok(/^\d+x\d+$/.test(String(box)) && parseInt(String(box).split("x")[0], 10) >= 1000, "★窗口确实放大了（实测 " + box + " px ✓ 以前上限 1000 ✗）");
          const aiRow = await ev('(function(){var a=document.querySelector(".vd__airow"); return a? a.innerText : ""})()');
          ok(String(aiRow).indexOf("AI 读图") >= 0, "★「🤖 AI 读图」入口在窗口顶部（一眼看得见 ✓）");
          const vp = await ev('(function(){var v=document.querySelector(".vd__viewport"); if(!v) return ""; var r=v.getBoundingClientRect(); return Math.round(r.width)+"x"+Math.round(r.height)})()');
          ok(/^\d+x\d+$/.test(String(vp)) && parseInt(String(vp).split("x")[0], 10) > 560, "★画布视口也放大了（实测 " + vp + " ✓ 以前固定 560×450 ✗）");
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
