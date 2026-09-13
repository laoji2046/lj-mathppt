
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
function score(file) {
  const auto = JSON.parse(fs.readFileSync(file, 'utf8'));
  let matched = 0, dashOk = 0, truthEdges = 0;
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
    const key = e => Math.min(e[0], e[1]) + '_' + Math.max(e[0], e[1]);
    const aEdges = new Map();
    for (const e of a.edges) aEdges.set(key(e), e[2]);
    for (const e of p.el.mesh.edges) {
      truthEdges++;
      const m = /^(\d+)_(\d+)$/.exec(key(e)), gi = [+m[1], +m[2]];
      if (g2a[gi[0]] === undefined || g2a[gi[1]] === undefined) continue;
      const ak = key([g2a[gi[0]], g2a[gi[1]]]);
      if (aEdges.has(ak)) { matched++; if (aEdges.get(ak) === e[2]) dashOk++; }
    }
  }
  return { matched, dashOk, truthEdges };
}
for (const [tag, file] of [[process.argv[2] || 'v10', process.argv[3] || 'tools/solidfit/v10.json'], [process.argv[4] || 'v17', process.argv[5] || 'tools/solidfit/v17.json']]) {
  const r = score(file);
  console.log(tag + ':  真值边 ' + r.truthEdges + '  配上 ' + r.matched + '  其中虚实判断正确 ' + r.dashOk);
}