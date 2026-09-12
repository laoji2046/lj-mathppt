// 用法: node tools/solidfit/vectorize.cjs spec.json out.html
// spec.json: [{ name, img, opts?: { crop:[x0,y0,x1,y1], textMax, snapR, mergeR, spur, eps } }]
const fs = require('fs'), path = require('path');
const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const outHtml = process.argv[3] || path.join(__dirname, 'vectorize.html');
const items = spec.map(function (f) {
  const b = fs.readFileSync(f.img);
  if (b.readUInt32BE(16) === 0) throw new Error('not a PNG: ' + f.img);
  return { name: f.name, opts: f.opts || {}, src: 'data:image/png;base64,' + b.toString('base64') };
});
fs.writeFileSync(path.join(path.dirname(outHtml), 'imgs.js'), 'window.__FIGS__ = ' + JSON.stringify(items) + ';');
fs.copyFileSync(path.join(__dirname, 'vectorize.tpl.html'), outHtml);
console.log('wrote ' + outHtml + '  figures=' + items.length);
