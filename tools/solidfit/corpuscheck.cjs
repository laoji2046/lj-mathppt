// node tools/solidfit/corpuscheck.cjs <vectorize 输出.json> [标签]
// 拿一整批图（例如 _docx-out/images 全部）跑一遍，看**整体**结构有没有变化：
// 顶点总数（虚高 = 多出来的点）、虚线总数（偏低 = 虚线成不了链）、碎边数（>0 = 链断成小段）。
// 改算法前后各跑一次对比，比只看 8 张真值更能说明"对别的图有没有变好"。
//
// 生成输入：
//   node -e "const fs=require('fs'),p=require('path');const d='_docx-out/images';const a=[];for(const f of fs.readdirSync(d))if(/\.png$/i.test(f))a.push({name:f.replace(/\.png$/,''),img:p.resolve(d,f).replace(/\\/g,'/')});fs.writeFileSync('tools/solidfit/_all.json',JSON.stringify(a))"
//   node tools/solidfit/vectorize.cjs tools/solidfit/_all.json tools/solidfit/vecall.html
//   chrome --headless=new --virtual-time-budget=900000 --dump-dom file:///.../vecall.html > oall.html
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let verts = 0, edges = 0, dash = 0, tiny = 0, tinyDash = 0, bad = 0;
for (const f of r) {
  if (f.error || !f.points) { bad++; continue; }
  const V = f.points; const n = V.length / 2;
  verts += n; edges += f.edges.length;
  for (const e of f.edges) {
    const L = Math.hypot((V[e[0] * 2] - V[e[1] * 2]) * f.W, (V[e[0] * 2 + 1] - V[e[1] * 2 + 1]) * f.H);
    if (e[2]) dash++;
    if (L < 8) { tiny++; if (e[2]) tinyDash++; }
  }
}
console.log((process.argv[3] || '') + ':  图 ' + (r.length - bad) + '/' + r.length +
  '   顶点合计 ' + verts + '   边合计 ' + edges + '（虚线 ' + dash + '）' +
  '   碎边(<8px) ' + tiny + '（虚线 ' + tinyDash + '）');
