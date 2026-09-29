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
      if (r.result && r.result.exceptionDetails) { const d = r.result.exceptionDetails; return "__EXC__" + String(d.text || "") + " " + String((d.exception && d.exception.description) || "").slice(0, 160); }
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

    /* ============ A0. 公式编号（v1748：自己填 ✓ 不自动排号 ✓） ============ */
    console.log("--- A0. 插入公式 → 填编号 → 看它是不是在公式右侧且居中 ---");
    let up0 = await openApp();
    ok(up0, "应用起来了（准备测公式编号 ✓）");
    if (up0) {
      await ev('document.querySelector(\'button[title="插入公式"]\').click()');
      await sleep(300);
      const clicked0 = await ev('(function(){var b=[...document.querySelectorAll(".dropdown__item")].find(x=>x.textContent.indexOf("空白公式")>=0); if(b)b.click(); return !!b})()');
      await sleep(900);
      ok(clicked0 === true && (await ev('!!document.querySelector(".math-el")')) === true, "点「插入公式 → 空白公式」真的插进来了 ✓");
      const hasInput = await ev('(function(){var l=[...document.querySelectorAll(".panel__section label")].find(x=>x.textContent.indexOf("编号")>=0); return l? !!l.querySelector("input[type=text]") : false})()');
      ok(hasInput === true, "★右侧属性面板出现「编号（自己填，可空）」输入框 ✓");
      await ev('(function(){var l=[...document.querySelectorAll(".panel__section label")].find(x=>x.textContent.indexOf("编号")>=0); var i=l&&l.querySelector("input[type=text]"); if(!i) return false; i.value="(1)"; i.dispatchEvent(new Event("input",{bubbles:true})); return true})()');
      /* ⚠ MathJax 首次要加载 2MB 才排得完 ✗ —— 轮询等它出来再量 ✓（只 sleep 会量到 no-math ✓） */
      let mathReady = false;
      for (let i = 0; i < 40; i++) {
        if ((await ev('!!document.querySelector(".math-el__host svg")')) === true) { mathReady = true; break }
        await sleep(500);
      }
      if (mathReady !== true) {
        const diag = await ev(`JSON.stringify({ mj: !!window.MathJax, hasTex2svg: !!(window.MathJax && window.MathJax.tex2svg), err: (document.querySelector(".math-el__err") || {}).textContent || "", scripts: [].slice.call(document.querySelectorAll("script[src]")).map(function(s){return s.getAttribute("src")}).filter(function(x){return /mathjax/i.test(x||"")}), nEl: document.querySelectorAll(".math-el").length, hosts: [].slice.call(document.querySelectorAll(".math-el__host")).map(function(h){return h.innerHTML.length}), eq: document.querySelectorAll(".math-el__eq").length, eqTxt: (document.querySelector(".math-el__eq")||{}).textContent||"", titles: [].slice.call(document.querySelectorAll(".panel__title")).map(function(t){return t.textContent.trim()}).slice(0,3), mjContainers: document.querySelectorAll("mjx-container").length, probe: !!document.querySelector(".math-el__host mjx-container"), head: ((document.querySelector(".math-el__host")||{}).innerHTML||"").slice(0,80) })`);
        console.log("      [诊断] " + String(diag).slice(0, 300));
      }
      ok(mathReady === true, "★公式排出来了（等 MathJax 加载完 ✓）");
      const eq = await ev(`(function(){
        var lab = document.querySelector(".math-el__eq");
        var host = document.querySelector(".math-el__host");
        var mj = host && host.querySelector("svg");   /* 裸 svg ✓ 不是 mjx-container ✗ */
        if (!lab) return "no-label";
        if (!mj) return "no-math";
        var lr = lab.getBoundingClientRect(), mr = mj.getBoundingClientRect();
        return JSON.stringify({ txt: lab.textContent.trim(), gap: Math.round(lr.left - mr.right), dy: Math.round((lr.top + lr.height/2) - (mr.top + mr.height/2)), fs: Math.round(parseFloat(getComputedStyle(lab).fontSize)) });
      })()`);
      let E0 = null; try { E0 = JSON.parse(String(eq)) } catch { /* 见下面的断言 */ }
      ok(!!E0 && E0.txt === "(1)", "★编号真的显示出来了（实测「" + (E0 && E0.txt) + "」✓ 原始：" + String(eq).slice(0, 40) + "）");
      ok(!!E0 && E0.gap >= -3, "★编号在公式**右侧**（公式右边缘 → 编号左边 = " + (E0 && E0.gap) + "px ✓）");
      ok(!!E0 && Math.abs(E0.dy) <= 6, "★编号与公式**垂直居中**（中心差 " + (E0 && E0.dy) + "px ✓ 教材里 (1) 就这么排 ✓）");
      ok(!!E0 && E0.fs >= 10 && E0.fs <= 40, "★编号字号随公式缩放（实测 " + (E0 && E0.fs) + "px ✓ 公式基准 40px ✓）");
    }
    /* ============ A2. 公式库卡片：公式大小是否齐（v1750） ============ */
    console.log("--- A2. 预制公式库卡片：量 14 条公式的渲染高度 ---");
    let up2 = await openApp();
    ok(up2, "应用起来了（准备量卡片大小 ✓）");
    if (up2) {
      await ev('document.querySelector(\'button[title="插入公式"]\').click()');
      await sleep(300);
      await ev('(function(){var b=[...document.querySelectorAll(".dropdown__item")].find(x=>x.textContent.indexOf("混排公式")>=0); if(b)b.click(); return !!b})()');
      /* 等库卡片里的公式都排完（MathJax 首次要加载 2MB ✗ 轮询 ✓） */
      let libReady = false;
      for (let i = 0; i < 40; i++) {
        const n = await ev('document.querySelectorAll(".lcard__pv svg").length');
        if (typeof n === "number" && n >= 5) { libReady = true; break }
        await sleep(500);
      }
      ok(libReady === true, "★公式库卡片排出来了 ✓");
      const spread = await ev(`(function(){
        var hs = [].slice.call(document.querySelectorAll(".lcard__pv svg")).map(function(s){
          var r = s.getBoundingClientRect();
          return { h: +r.height.toFixed(1), w: +r.width.toFixed(1) };
        }).filter(function(x){ return x.h > 0 && x.w > 0 });
        if (hs.length < 4) return JSON.stringify({ n: hs.length });
        var H = hs.map(function(x){ return x.h }), W = hs.map(function(x){ return x.w });
        var boxW = (document.querySelector(".lcard__pv") || {}).clientWidth || 0;
        return JSON.stringify({
          n: hs.length,
          hMin: Math.min.apply(null, H), hMax: Math.max.apply(null, H),
          wMax: Math.max.apply(null, W), boxW: boxW,
          ratio: +(Math.max.apply(null, H) / Math.max(0.1, Math.min.apply(null, H))).toFixed(2)
        });
      })()`);
      let SP = null; try { SP = JSON.parse(String(spread)) } catch { /* 见断言 */ }
      console.log("     卡片实测：" + String(spread));
      ok(!!SP && SP.n >= 5 && SP.hMin >= 12, "★卡片里的公式不再被缩到看不清（最小高度 " + (SP && SP.hMin) + "px ≥ 12 ✓ 改前只有 7.1px ✗ 那一版预览框只有 168px 宽 ✗）");
      ok(!!SP && SP.ratio <= 4.0, "★卡片公式大小不失控（高度比 " + (SP && SP.ratio) + " ≤ 4.0 ✓ 改前 6.51 倍 ✗；剩下这点差是嵌套分式天然更高 ✓ 不该硬压平 ✗）");
      await ev('document.querySelector(".panel__close") && document.querySelector(".panel__close").click()');
      await sleep(250);
    }
    /* ============ A3. 预制公式库里的符号面板（v1757） ============ */
    console.log("--- A3. 插入公式 → 预制公式库 → 符号面板：真点一下看画布有没有多一个公式 ---");
    let up3 = await openApp();
    ok(up3, "应用起来了（准备测预制公式库里的符号面板 ✓）");
    if (up3) {
      const before3 = await ev('document.querySelectorAll(".math-el").length');
      await ev('document.querySelector(\'button[title="插入公式"]\').click()');
      await sleep(300);
      const opened3 = await ev('(function(){var b=[...document.querySelectorAll(".dropdown__item")].find(x=>x.textContent.indexOf("预制公式库")>=0); if(b)b.click(); return !!b})()');
      let hasSym3 = false;
      for (let i = 0; i < 20; i++) { if ((await ev('!!document.querySelector(".sym__grid")')) === true) { hasSym3 = true; break } await sleep(300) }
      ok(opened3 === true && hasSym3 === true, "★预制公式库里**出现了符号面板** ✓（点了菜单「预制公式库」✓）");
      const tabs3 = await ev('JSON.stringify([...document.querySelectorAll(".sym__tab")].map(b=>b.getAttribute("title")))');
      ok(String(tabs3).indexOf("希腊字母") >= 0 && String(tabs3).indexOf("分式与根式") >= 0, "★页签与「组合公式」窗口一致 ✓（实测：" + String(tabs3).slice(0, 60) + "…）");
      const nbtn3 = await ev('document.querySelectorAll(".sym__btn").length');
      ok(typeof nbtn3 === "number" && nbtn3 >= 10, "★符号按钮渲染出来了 ✓（" + nbtn3 + " 个 ✓）");
      await ev('document.querySelector(".sym__btn").click()');
      await sleep(700);
      const after3 = await ev('document.querySelectorAll(".math-el").length');
      ok(typeof after3 === "number" && after3 === Number(before3) + 1, "★点一个符号 → 画布上真多了一个公式元素 ✓（" + before3 + " → " + after3 + " ✓）");
      await ev('document.querySelector(".palette__close") && document.querySelector(".palette__close").click()');
      await sleep(300);
    }
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
      ok(String(cards).split(",").length === 3 && String(cards).indexOf("三维立体图") >= 0 && String(cards).indexOf("AI 还原结构") < 0, "★「图形重建」3 张卡、没有重复的 AI 卡片（实测：" + String(cards) + " ✓）");
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
          const aiState = await ev('(function(){var a=document.querySelector(".vd__aistate"); return a? a.innerText.trim() : ""})()');
          ok(String(aiState).length > 0, "★AI 行上直接显示缺什么（实测：「" + aiState + "」✓ 不用点就知道 ✓）");
          const hasSet = await ev('!!([...document.querySelectorAll(".vd__airow button")].find(b=>b.textContent.indexOf("去设置")>=0))');
          ok(hasSet === true, "★有一键「去设置填视觉模型」✓（点了直接开设置面板 ✓）");
          const hasTry = await ev('!!([...document.querySelectorAll(".vd__airow button")].find(b=>b.textContent.indexOf("硬试一次")>=0))');
          ok(hasTry === true, "★有「硬试一次」兜底 ✓（没配视觉模型也能真发一次请求 ✓）");
          /* 【v1743】字母不许抢点击：① 计算样式是 none ② 在字母中心做**命中测试** */
          const labPe = await ev('(function(){var g=document.querySelector(".vd__lab"); return g? getComputedStyle(g).pointerEvents : "no-label"})()');
          ok(labPe === "none", "★字母层对指针透明（实测 pointer-events = " + labPe + " ✓）");
          const labCnt = await ev('document.querySelectorAll(".vd__lab").length');
          ok(typeof labCnt === "number" && labCnt >= 1, "★字母层真的存在（" + labCnt + " 个 ✓ 上一条断言才有意义 ✓）");
          const hitLab = await ev('(function(){ var g=document.querySelector(".vd__lab"); if(!g) return "no-label"; var r=g.getBoundingClientRect(); if(!r.width||!r.height) return "no-box"; var el=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2); if(!el) return "none"; if(el.closest && el.closest(".vd__lab")) return "label-top"; var ov=el.closest && el.closest(".vd__ov"); return (ov? "overlay:" : "other:") + el.tagName; })()');
          ok(String(hitLab) !== "label-top", "★在字母中心做命中测试：最上层不是字母 ✓（实测 " + hitLab + (String(hitLab) === "no-box" ? " —— 测试图没认出字母，这一条退化为\"不适用\" ✓ 上面那条 pointer-events=none 才是硬证据 ✓" : "") + "）");
          const vp = await ev('(function(){var v=document.querySelector(".vd__viewport"); if(!v) return ""; var r=v.getBoundingClientRect(); return Math.round(r.width)+"x"+Math.round(r.height)})()');
          /* 【v1744】补一个点：按钮在 ✓ → 点一下画布真的多一个顶点（数 .vd__stat 的顶点数 ✓） */
          const hasAddPt = await ev('!!([...document.querySelectorAll(".vd__row button")].find(b=>b.textContent.indexOf("补一个点")>=0))');
          ok(hasAddPt === true, "★工具栏有「＋ 补一个点」按钮 ✓");
          const statBefore = await ev('(function(){var s=document.querySelector(".vd__stat"); return s? s.innerText.trim() : ""})()');
          await ev('[...document.querySelectorAll(".vd__row button")].find(b=>/补一个点|结束补点/.test(b.textContent)).click()');
          await sleep(250);
          const tipOn = await ev('(function(){var t=document.querySelector(".vd__tip--on"); return t? t.innerText : ""})()');
          ok(String(tipOn).indexOf("补点") >= 0, "★进入补点模式后有提示（实测片段：「" + String(tipOn).replace(/\s+/g, " ").slice(0, 40) + "…」✓）");
          /* 挑一个离所有顶点都远的落点（5×5 网格里选最小距离最大的那个 ✓） */
                    /* 挑落点并直接派发 pointerdown（测的是**我们的处理逻辑** ✓ 不依赖 Chrome 的命中测试 ✓
                       之前用 Input.dispatchMouseEvent + elementFromPoint 双重过滤，结果一个候选都没通过 ✗） */
          const fired = await ev(`(function(){
            var st=document.querySelector(".vd__stage"), vp=document.querySelector(".vd__viewport");
            if(!st||!vp) return "no-stage";
            var sr=st.getBoundingClientRect(), vr=vp.getBoundingClientRect();
            var x0=Math.max(sr.left,vr.left), x1=Math.min(sr.right,vr.right);
            var y0=Math.max(sr.top,vr.top), y1=Math.min(sr.bottom,vr.bottom);
            if(x1-x0<40||y1-y0<40) return "too-small";
            var cs=[].slice.call(document.querySelectorAll(".vd__ov circle")).map(function(c){var b=c.getBoundingClientRect(); return [b.left+b.width/2,b.top+b.height/2]});
            var best=null;
            for(var i=1;i<=5;i++){ for(var j=1;j<=5;j++){
              var x=x0+(x1-x0)*i/6, y=y0+(y1-y0)*j/6;
              var d=1e9; cs.forEach(function(c){ d=Math.min(d, Math.hypot(x-c[0], y-c[1])) });
              if(!best || d>best.d) best={x:Math.round(x), y:Math.round(y), d:Math.round(d)};
            } }
            if(!best) return "no-spot";
            var mk=(t,b)=>new PointerEvent(t,{bubbles:true,clientX:best.x,clientY:best.y,pointerId:1,pointerType:"mouse",isPrimary:true,button:0,buttons:b});
            st.dispatchEvent(mk("pointerdown",1));
            st.dispatchEvent(mk("pointerup",0));
            return JSON.stringify(best);
          })()`);
          const sp = JSON.parse(String(fired || "{}"));
          ok(Number(sp.d) >= 20, "★落点离最近的顶点 " + sp.d + " px（≥20 ✓ 不会走「只选中已有顶点」那条 ✓ 原始返回：" + String(fired).slice(0, 20) + "）");
          await sleep(400);
          /* 先把"点一下画布补出 1 个顶点"这条旧断言结掉（它必须在**自己那次点击之后立刻**取状态 ✓
             不然下面还会再点两下 ✗ 状态就被搅了 ✓） */
          const statAfter = await ev('(function(){var s=document.querySelector(".vd__stat"); return s? s.innerText.trim() : ""})()');
          const numOf = (t) => { const m = /顶点\s*(\d+)/.exec(String(t)); return m ? Number(m[1]) : -1 };
          ok(numOf(statAfter) === numOf(statBefore) + 1, "★点一下画布真的补出了 1 个顶点（" + statBefore + " → " + statAfter + " ✓）");
          /* 【v1745】① 再验一次"**点线**"那条路：开补点 → 直接点一条线 → 顶点 +1、边 +1 ✓ */
          const statLine0 = await ev('(function(){var s=document.querySelector(".vd__stat"); return s? s.innerText.trim() : ""})()');
          const resLine = await ev(`(function(){
            var ln=document.querySelector('.vd__ov line[stroke="transparent"]');
            if(!ln) return "no-line";
            var r=ln.getBoundingClientRect();
            var ev2=new PointerEvent("pointerdown",{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,pointerId:3,pointerType:"mouse",isPrimary:true,button:0,buttons:1});
            ln.dispatchEvent(ev2);
            var ev3=new PointerEvent("pointerup",{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,pointerId:3,pointerType:"mouse",isPrimary:true,button:0,buttons:0});
            ln.dispatchEvent(ev3);
            return "clicked";
          })()`);
          await sleep(400);
          const statLine1 = await ev('(function(){var s=document.querySelector(".vd__stat"); return s? s.innerText.trim() : ""})()');
          const nOf = (t, k) => { const m = new RegExp(k + "\\s*(\\d+)").exec(String(t)); return m ? Number(m[1]) : -1 };
          ok(nOf(statLine1, "顶点") === nOf(statLine0, "顶点") + 1 && nOf(statLine1, "边") === nOf(statLine0, "边") + 1,
            "★补点模式下**点线** → 点落在线上并劈成两段（" + statLine0 + " → " + statLine1 + " ✓ 原始：" + resLine + "）");
          /* 【v1745】② 点合并：Shift 点选两个顶点 → 「合并选中的点」 → 顶点 -1 ✓ */
          await ev('[...document.querySelectorAll(".vd__row button")].find(b=>/补一个点|结束补点/.test(b.textContent)).click()');
          await sleep(200);
          const statM0 = await ev('(function(){var s=document.querySelector(".vd__stat"); return s? s.innerText.trim() : ""})()');
          const picked = await ev(`(function(){
            var cs=[].slice.call(document.querySelectorAll('.vd__ov circle[fill="transparent"]'));
            var uniq=[], seen={};
            cs.forEach(function(c){ var r=c.getBoundingClientRect(); var k=Math.round(r.left)+"_"+Math.round(r.top); if(!seen[k]){ seen[k]=1; uniq.push(c) } });
            if(uniq.length<2) return "few:"+uniq.length;
            function click(el,shift){ var r=el.getBoundingClientRect(); var o={bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,pointerId:7,pointerType:"mouse",isPrimary:true,button:0,buttons:1,ctrlKey:!!shift}; el.dispatchEvent(new PointerEvent("pointerdown",o)); el.dispatchEvent(new PointerEvent("pointerup",o)); }
            click(uniq[0],false); click(uniq[1],true);
            return "ok:"+uniq.length;
          })()`);
          await sleep(250);
          const selTxt = await ev('(function(){var e=document.querySelector(".vd__row--sel"); return e? e.innerText : ""})()');
          const mergeBtn = await ev('!!([...document.querySelectorAll(".vd__row button")].find(b=>b.textContent.indexOf("合并选中的点")>=0 && !b.disabled))');
          ok(String(selTxt).indexOf("2") >= 0 && mergeBtn === true, "★选了两个顶点后「合并选中的点」可点（选中行：「" + String(selTxt).replace(/\s+/g, " ").slice(0, 30) + "」✓ 原始：" + picked + "）");
          await ev('[...document.querySelectorAll(".vd__row button")].find(b=>b.textContent.indexOf("合并选中的点")>=0).click()');
          await sleep(350);
          const statM1 = await ev('(function(){var s=document.querySelector(".vd__stat"); return s? s.innerText.trim() : ""})()');
          ok(nOf(statM1, "顶点") === nOf(statM0, "顶点") - 1, "★点合并生效：顶点 " + statM0 + " → " + statM1 + "（-1 ✓）");
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
