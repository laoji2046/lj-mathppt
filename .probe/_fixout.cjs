/** 【v1747】把探针的输出目录从 C: 改到项目里（D:）——
 *  4 个探针原来写死 "C:/Users/老冀/Desktop/vue-app/.probe/shots" ✗
 *  （只有 _uismoke.cjs 用的是 path.join(ROOT, ".probe", "shots") ✓）
 *  改法：统一成 `process.env.LJ_OUT || path.join(ROOT, ".probe", "shots")` ✓
 *  先决条件会自己检查：文件里必须**已经有** ROOT 和 require("path") ✓ 否则报错不改 ✗
 */
"use strict";
const fs = require("fs"), path = require("path");
const PROBE = "D:/vue-app/.probe";
const OLD = 'const OUT = process.env.LJ_OUT || "C:/Users/老冀/Desktop/vue-app/.probe/shots";';
const NEW = 'const OUT = process.env.LJ_OUT || path.join(ROOT, ".probe", "shots");   // 【v1747】产物放项目里 ✓ 别写 C: ✗';
const files = ["_tikz1.cjs", "_ggbsolve.cjs", "_ggbexec.cjs", "_ggbreal.cjs"];
let bad = 0;
for (const f of files) {
  const p = path.join(PROBE, f);
  let s = fs.readFileSync(p, "utf8");
  const n = s.split(OLD).length - 1;
  if (n !== 1) { console.log("[XX] " + f + "：旧行命中 " + n + " 处"); bad++; continue }
  const at = s.indexOf(OLD);
  const before = s.slice(0, at);
  const hasROOT = /const ROOT\s*=/.test(before);
  const hasPath = /require\(["']path["']\)/.test(before);
  if (!hasROOT || !hasPath) { console.log("[XX] " + f + "：前置条件不足（ROOT=" + hasROOT + " path=" + hasPath + "）"); bad++; continue }
  fs.writeFileSync(p, s.replace(OLD, NEW), "utf8");
  console.log("[ok] " + f + "：输出目录改到项目里 ✓");
}
process.exit(bad ? 1 : 0);
