// node tools/solidfit/ocrcheck.cjs v.json [confMin]
// 拿 solidFigures.ts 里人工核对过的 8 套当真值，量字母识别准确率。
// 报告分两块，别混在一起看：
//   ① 顶点能不能配上（这是"顶点拟合"的水平，不是字母的）
//   ② **配上了的顶点里，字母认对多少** ← 这才是字母识别器的水平
const fs = require('fs');
const { SOLID_FIGURE_PRESETS } = require('./_presets.cjs');
const vec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const CONF = +(process.argv[3] || 0.7);
const SRC = {
  pabcd: { img: 'image2', w: 709, h: 476 }, cubea1: { img: 'image6', w: 655, h: 696 },
  cube7: { img: 'image7', w: 655, h: 696 }, cubeaxes: { img: 'image8', w: 758, h: 841 },
  pabcdaxes: { img: 'image12', w: 888, h: 659, crop: [0, 0, 888, 580] },
  // 这两张的 crop 底边原先正好压在字形上（0px 余量），字母 C / x 被切掉一截：
  // C 拼出 "c_2"、x 只剩个 V 形被认成 v。放宽到把字形完整包住（题注仍在框外）。
  pabcdo: { img: 'image15', w: 709, h: 584, crop: [0, 0, 709, 478] },
  pabcdoaxes: { img: 'image16', w: 888, h: 683, crop: [0, 0, 888, 582] },
  pabcdc1: { img: 'image17', w: 778, h: 618, crop: [0, 0, 778, 500] },
};
const norm = (s) => String(s || '').replace(/[\s'′]/g, '').toUpperCase();
let okN = 0, allN = 0, noLetter = 0, vMissN = 0, gtN = 0;
const rows = [];
for (const p of SOLID_FIGURE_PRESETS) {
  const s = SRC[p.id];
  const a = vec.find((x) => x.name === s.img);
  if (!a || a.error) { rows.push([p.id, 'ERR', '']); continue; }
  const crop = s.crop || [0, 0, s.w, s.h];
  const cw = crop[2] - crop[0], ch = crop[3] - crop[1];
  const G = [];
  for (let i = 0; i < p.el.points.length; i += 2) {
    G.push({ x: (p.el.points[i] * s.w - crop[0]) / cw, y: (p.el.points[i + 1] * s.h - crop[1]) / ch });
  }
  const A = [];
  for (let i = 0; i < a.points.length; i += 2) A.push({ x: a.points[i], y: a.points[i + 1] });
  const ANC = (a.anchors || []).filter((z) => z.conf >= CONF && z.text);
  // ① 顶点配对（全局按距离贪心）
  const vp = [];
  for (let i = 0; i < G.length; i++) for (let j = 0; j < A.length; j++) {
    const d = Math.hypot(G[i].x - A[j].x, G[i].y - A[j].y);
    if (d <= 0.035) vp.push({ i, j, d });
  }
  vp.sort((x, y) => x.d - y.d);
  const g2a = {}, aUsed = {};
  for (const q of vp) if (g2a[q.i] === undefined && !aUsed[q.j]) { g2a[q.i] = q.j; aUsed[q.j] = 1 }
  // ② 字母配对（和弹窗里同一条规则）
  const lp = [];
  const targets = [];
  for (let i = 0; i < G.length; i++) {
    if (g2a[i] === undefined) continue;
    if (!p.el.vlabels[i]) continue;
    const v = A[g2a[i]];
    targets.push({ i, v });
    for (let k = 0; k < ANC.length; k++) {
      const d = Math.hypot(ANC[k].x - v.x, ANC[k].y - v.y);
      if (d <= 0.16) lp.push({ i, k, d });
    }
  }
  lp.sort((x, y) => x.d - y.d);
  const got = {};
  const aUsed2 = {};
  for (const q of lp) if (got[q.i] === undefined && !aUsed2[q.k]) { got[q.i] = ANC[q.k].text; aUsed2[q.k] = 1 }
  let good = 0, n = 0, nl = 0, miss = 0;
  const detail = [];
  for (const t of targets) {
    const gt = p.el.vlabels[t.i];
    n++;
    if (got[t.i] === undefined) { nl++; detail.push(gt + '→无字母'); continue }
    if (norm(got[t.i]) === norm(gt)) good++;
    else detail.push(gt + '→' + got[t.i]);
  }
  vMissN += p.el.vlabels.filter((l, i) => l && g2a[i] === undefined).length;
  gtN += p.el.vlabels.filter(Boolean).length;
  okN += good; allN += n; noLetter += nl;
  rows.push([p.id, good + '/' + n, detail.join(' ')]);
}
const w = [12, 8, 64];
function pad(s, n) { s = String(s); let len = 0; for (const c of s) len += c.charCodeAt(0) > 255 ? 2 : 1; return s + ' '.repeat(Math.max(1, n - len)); }
console.log('conf 阈值 ' + CONF + '　（"无字母" = 那个顶点附近没找到可信的字母块）');
console.log(rows.map((r) => r.map((c, i) => pad(c, w[i])).join('')).join('\n'));
console.log('');
console.log('**字母准确率 ' + okN + '/' + allN + ' = ' + Math.round(okN / allN * 100) + '%**');
console.log('　另：' + vMissN + '/' + gtN + ' 个真值顶点压根没被识别出来（属顶点拟合，不是字母问题）；' + noLetter + ' 个配上了顶点但附近没有字母块');
