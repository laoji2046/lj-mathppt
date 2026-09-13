
const fs = require('fs');
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
const TOL = 0.035;
const file = process.argv[2] || 'tools/solidfit/v10.json';
const auto = JSON.parse(fs.readFileSync(file, 'utf8'));
let M = 0, D = 0, TE = 0;
const kind = { dangling: 0, collinear: 0, bend: 0, junction: 0 };
const perFig = [];
for (const p of SOLID_FIGURE_PRESETS) {
  const s = SRC[p.id];
  const a = auto.find(x => x.name === s.img);
  if (!a || a.error) continue;
  const crop = s.crop || [0, 0, s.w, s.h];
  const cw = crop[2] - crop[0], ch = crop[3] - crop[1];
  const A = [];
  for (let i = 0; i < a.points.length; i += 2) A.push({ x: a.points[i] * cw / s.w, y: a.points[i + 1] * ch / s.h });
  const G = [];
  for (let i = 0; i < p.el.points.length; i += 2) G.push({ x: p.el.points[i], y: p.el.points[i + 1] });
  const pairs = [];
  for (let i = 0; i < G.length; i++) for (let j = 0; j < A.length; j++) {
    const d = Math.hypot(G[i].x - A[j].x, G[i].y - A[j].y);
    if (d <= TOL) pairs.push({ i, j, d });
  }
  pairs.sort((x, y) => x.d - y.d);
  const g2a = {}, a2g = {};
  for (const q of pairs) { if (g2a[q.i] === undefined && a2g[q.j] === undefined) { g2a[q.i] = q.j; a2g[q.j] = q.i; } }
  const inc = A.map(() => []);
  for (const e of a.edges) { inc[e[0]].push(e[1]); inc[e[1]].push(e[0]); }
  let extra = 0;
  for (let j = 0; j < A.length; j++) {
    if (a2g[j] !== undefined) continue;
    extra++;
    const nb = inc[j];
    if (nb.length <= 1) kind.dangling++;
    else if (nb.length === 2) {
      const a1 = A[nb[0]], a2 = A[nb[1]], me = A[j];
      const v1x = a1.x - me.x, v1y = a1.y - me.y, v2x = a2.x - me.x, v2y = a2.y - me.y;
      const l1 = Math.hypot(v1x, v1y) || 1, l2 = Math.hypot(v2x, v2y) || 1;
      const cos = (v1x * v2x + v1y * v2y) / (l1 * l2);
      if (cos < -0.995) kind.collinear++; else kind.bend++;
    } else kind.junction++;
  }
  perFig.push({ id: p.id, truth: G.length, auto: A.length, matched: Object.keys(g2a).length, extra: extra });
  M += Object.keys(g2a).length; TE += G.length;
  const key = e => Math.min(e[0], e[1]) + '_' + Math.max(e[0], e[1]);
  const aEdges = new Map();
  for (const e of a.edges) aEdges.set(key(e), e[2]);
  for (const e of p.el.mesh.edges) {
    const m = /^(\d+)_(\d+)$/.exec(key(e)), gi = [+m[1], +m[2]];
    if (g2a[gi[0]] === undefined || g2a[gi[1]] === undefined) continue;
    const ak = key([g2a[gi[0]], g2a[gi[1]]]);
    if (aEdges.has(ak)) { D++; if (aEdges.get(ak) === e[2]) D = D; }
  }
}
console.log('文件 ' + file);
console.log('顶点：真值 ' + TE + '  配上 ' + M + '  自动总数 ' + perFig.reduce((a, b) => a + b.auto, 0) + '  多出来 ' + perFig.reduce((a, b) => a + b.extra, 0));
console.log('多出来的点按拓扑分类:');
console.log('  悬空（只连 1 条边）: ' + kind.dangling);
console.log('  二度且几乎共线（去掉不影响图形）: ' + kind.collinear);
console.log('  二度但拐弯（是真拐点）: ' + kind.bend);
console.log('  三度以上（交叉/T 形交点）: ' + kind.junction);
console.log('');
console.log('逐图: 真值 / 自动 / 多出');
perFig.forEach(r => console.log('  ' + r.id.padEnd(11) + r.truth + ' / ' + r.auto + ' / ' + r.extra));
