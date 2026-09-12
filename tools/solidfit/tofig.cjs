// node tools/solidfit/tofig.cjs vec.json names.json
// vec.json   = vectorize.cjs 跑出来的结果
// names.json = { "image2": { "id":"pabcd", "name":"四棱锥 P-ABCD", "labels":["P","C","B","D","A",null] } }
//               labels 按顶点序号给字母；null = 这个顶点不用标（多半是多余顶点，顺手删掉即可）
// 输出可直接粘进 src/templates/solidFigures.ts 的 fig(...) 调用
const fs = require('fs');
const vec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const names = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));

for (const img of Object.keys(names)) {
  const cfg = names[img];
  const a = vec.find(x => x.name === img);
  if (!a || a.error) { console.log('// ' + img + ' 没有结果'); continue; }
  const buf = fs.readFileSync((process.env.SF_DIR || 'C:\\Users\\老冀\\Desktop\\vue-app\\_docx-out\\images') + '\\' + img + '.png');
  const iw = buf.readUInt32BE(16), ih = buf.readUInt32BE(20);
  const n = a.points.length / 2;
  const labels = cfg.labels.slice(0, n);
  while (labels.length < n) labels.push(null);
  // 有裁剪的图，矢量结果的 y 是相对裁剪框的，这里换算回整图
  const CROP = { image12: [0, 0, 888, 580], image15: [0, 0, 709, 470], image16: [0, 0, 888, 560], image17: [0, 0, 778, 500] };
  const c = CROP[img];
  const ky = c ? (c[3] - c[1]) / ih : 1;
  const kx = c ? (c[2] - c[0]) / iw : 1;
  const pts = [];
  for (let i = 0; i < a.points.length; i += 2) {
    pts.push(+(a.points[i] * kx).toFixed(4), +(a.points[i + 1] * ky).toFixed(4));
  }
  const edges = a.edges.map(e => '[' + e[0] + ', ' + e[1] + ', ' + e[2] + ']');
  const lab = labels.map(l => l === null ? 'null' : JSON.stringify(l)).join(', ');
  const lines = [];
  lines.push('  // ' + img + '  —— 自动矢量（顶点 ' + n + ' / 边 ' + a.edges.length + '），字母已人工核对');
  lines.push('  fig(' + JSON.stringify(cfg.id) + ', ' + JSON.stringify(cfg.name) + ', ' + iw + ', ' + ih + ',');
  lines.push('    [' + pts.join(', ') + '],');
  const chunk = [];
  for (let i = 0; i < edges.length; i += 6) chunk.push(edges.slice(i, i + 6).join(', '));
  lines.push('    [' + chunk.join(',\n     ') + '],');
  lines.push('    [' + lab + ']),');
  console.log(lines.join('\n'));
}