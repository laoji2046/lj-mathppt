// node tools/solidfit/annotate.cjs vec.json out.html
// 把自动矢量的结果叠在原图上，并给每个顶点标上序号 —— 用来一眼看出"哪个字母该配哪个顶点"
const fs = require('fs'), path = require('path');
const { renderSolid } = require('./_bundle.cjs');
const vec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const outHtml = process.argv[3] || 'annotate.html';
const dir = process.env.SF_DIR || 'C:\\Users\\老冀\\Desktop\\vue-app\\_docx-out\\images';
const SRC = { image2: 1, image6: 1, image7: 1, image8: 1, image12: [0, 0, 888, 580], image15: [0, 0, 709, 470], image16: [0, 0, 888, 560], image17: [0, 0, 778, 500] };

const cells = [];
for (const a of vec) {
  if (!SRC[a.name] || a.error) continue;
  const p = path.join(dir, a.name + '.png');
  const buf = fs.readFileSync(p);
  const iw = buf.readUInt32BE(16), ih = buf.readUInt32BE(20);
  const c = SRC[a.name] === 1 ? [0, 0, iw, ih] : SRC[a.name];
  const cw = c[2] - c[0], ch = c[3] - c[1];
  const pts = [];
  for (let i = 0; i < a.points.length; i += 2) pts.push(a.points[i] * cw / iw, a.points[i + 1] * ch / ih);
  const n = pts.length / 2;
  const labels = [];
  for (let i = 0; i < n; i++) labels.push(String(i));
  // 序号放在顶点正上方一点点；为了不互相压住，用红字
  const svg = renderSolid('pyramid', pts, iw, ih, '#1668e0', 2.4, 'none', '6 5', labels, null, undefined, undefined, null, null, undefined, { edges: a.edges.map(e => [e[0], e[1], e[2]]), faces: [] });
  const S = Math.min(1, 440 / iw, 470 / ih);
  const W = Math.round(iw * S), H = Math.round(ih * S);
  cells.push('<div class="c"><div class="t">' + a.name + '  v' + n + ' e' + a.edges.length + '</div>' +
    '<div class="fig" style="width:' + W + 'px;height:' + H + 'px">' +
    '<img src="data:image/png;base64,' + buf.toString('base64') + '">' +
    '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + iw + ' ' + ih + '" style="position:absolute;left:0;top:0;opacity:.85">' + svg + '</svg>' +
    '</div></div>');
}
const html = '<!doctype html><html><head><meta charset="utf-8"><style>' +
  'body{margin:0;background:#fff;font:11px/1.3 "Segoe UI",sans-serif}' +
  '.wrap{display:flex;flex-wrap:wrap;gap:14px;padding:10px}' +
  '.c{position:relative}.t{position:absolute;z-index:3;background:#000;color:#fff;padding:0 4px}' +
  '.fig{position:relative;border:1px solid #ddd}.fig img{display:block;width:100%;height:100%}' +
  '</style></head><body><div class="wrap">' + cells.join('') + '</div></body></html>';
fs.writeFileSync(outHtml, html);
console.log('wrote ' + outHtml + ' figures=' + cells.length);
