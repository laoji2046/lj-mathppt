// node tools/solidfit/compare.cjs vecout.json
// vecout.json = 自动矢量化结果（数组，含 name / W / H / points / edges）
// 真值 = src/templates/solidFigures.ts 里已经量好并人工核对过的 8 套预设
const fs = require('fs'), path = require('path');
const { SOLID_FIGURE_PRESETS } = require('./_presets.cjs');

const SRC = {
  pabcd: { img: 'image2', w: 709, h: 476, crop: null },
  cubea1: { img: 'image6', w: 655, h: 696, crop: null },
  cube7: { img: 'image7', w: 655, h: 696, crop: null },
  cubeaxes: { img: 'image8', w: 758, h: 841, crop: null },
  pabcdaxes: { img: 'image12', w: 888, h: 659, crop: [0, 0, 888, 580] },
  pabcdo: { img: 'image15', w: 709, h: 584, crop: [0, 0, 709, 478] },
  pabcdoaxes: { img: 'image16', w: 888, h: 683, crop: [0, 0, 888, 582] },
  pabcdc1: { img: 'image17', w: 778, h: 618, crop: [0, 0, 778, 500] },
};

const auto = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const TOL = +(process.argv[3] || 0.035);   // 归一化容差（约 25px / 850px）

let totVp = 0, totVr = 0, totEp = 0, totEr = 0, totErr = 0, totM = 0;
const rows = [];
for (const p of SOLID_FIGURE_PRESETS) {
  const s = SRC[p.id];
  const a = auto.find(x => x.name === s.img);
  if (!a || a.error) { rows.push([p.id, 'ERR', a && a.error || 'missing']); continue; }
  const crop = s.crop || [0, 0, s.w, s.h];
  const cw = crop[2] - crop[0], ch = crop[3] - crop[1];
  // 自动结果 → 原图归一化
  const A = [];
  for (let i = 0; i < a.points.length; i += 2) A.push({ x: a.points[i] * cw / s.w, y: a.points[i + 1] * ch / s.h });
  // 真值
  const G = [];
  for (let i = 0; i < p.el.points.length; i += 2) G.push({ x: p.el.points[i], y: p.el.points[i + 1] });
  // 顶点贪心配对
  const pairs = [];
  for (let i = 0; i < G.length; i++) for (let j = 0; j < A.length; j++) {
    const d = Math.hypot(G[i].x - A[j].x, G[i].y - A[j].y);
    if (d <= TOL) pairs.push({ i, j, d });
  }
  pairs.sort((x, y) => x.d - y.d);
  const g2a = {}, a2g = {};
  for (const q of pairs) { if (g2a[q.i] === undefined && a2g[q.j] === undefined) { g2a[q.i] = q.j; a2g[q.j] = q.i; } }
  const matched = Object.keys(g2a).length;
  let sumErr = 0;
  for (const k in g2a) sumErr += Math.hypot(G[k].x - A[g2a[k]].x, G[k].y - A[g2a[k]].y);
  // 边
  const key = e => Math.min(e[0], e[1]) + '_' + Math.max(e[0], e[1]);
  const gEdges = new Map(), aEdges = new Map();
  for (const e of p.el.mesh.edges) gEdges.set(key(e), e[2]);
  for (const e of a.edges) aEdges.set(key(e), e[2]);
  let er = 0, ep = 0, dashOk = 0;
  for (const [k, dash] of gEdges) {
    const m = /^(\d+)_(\d+)$/.exec(k);
    const gi = [+m[1], +m[2]];
    if (g2a[gi[0]] === undefined || g2a[gi[1]] === undefined) continue;
    const ak = key([g2a[gi[0]], g2a[gi[1]]]);
    if (aEdges.has(ak)) { er++; if (aEdges.get(ak) === dash) dashOk++; }
  }
  let epOk = 0;
  for (const [k, dash] of aEdges) {
    const m = /^(\d+)_(\d+)$/.exec(k);
    const ai = [+m[1], +m[2]];
    if (a2g[ai[0]] === undefined || a2g[ai[1]] === undefined) continue;
    const gk = key([a2g[ai[0]], a2g[ai[1]]]);
    if (gEdges.has(gk)) epOk++;
  }
  const vPrec = A.length ? matched / A.length : 0;
  const vRec = G.length ? matched / G.length : 0;
  const eRec = gEdges.size ? er / gEdges.size : 0;
  const ePrec = aEdges.size ? epOk / aEdges.size : 0;
  rows.push([p.id, G.length + '/' + A.length, matched + ' (' + Math.round(vRec * 100) + '%)',
    gEdges.size + '/' + aEdges.size, er + ' (' + Math.round(eRec * 100) + '%)',
    (matched ? (sumErr / matched * 100).toFixed(1) + '%' : '-'),
    (er ? Math.round(dashOk / er * 100) + '%' : '-')]);
  totVp += A.length; totVr += G.length; totM += matched;
  totEp += aEdges.size; totEr += gEdges.size;
  totErr += matched ? sumErr / matched : 0;
}
const w = [12, 10, 14, 10, 12, 8, 8];
const head = ['预设', '真值/自动顶点', '配上', '真值/自动边', '对上的边', '平均误差', '虚实测对'];
function pad(s, n) { s = String(s); let len = 0; for (const ch of s) len += ch.charCodeAt(0) > 255 ? 2 : 1; return s + ' '.repeat(Math.max(1, n - len)); }
console.log(head.map((h, i) => pad(h, w[i])).join(''));
for (const r of rows) console.log(r.map((c, i) => pad(c, w[i])).join(''));
console.log('');
console.log('合计：顶点召回 ' + Math.round(totM / totVr * 100) + '%  顶点准确率 ' + Math.round(totM / totVp * 100) +
  '%  平均顶点误差 ' + (totErr / SOLID_FIGURE_PRESETS.length * 100).toFixed(1) + '%');