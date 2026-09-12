// 用法: node tools/solidfit/vectorize.cjs spec.json out.html
// spec.json: [{ name, img, opts?: { crop:[x0,y0,x1,y1], textMax, snapR, mergeR, spur, eps } }]
//
// 用的是应用里那一份算法（src/composables/vectorize.ts），这里先 esbuild 打成浏览器脚本。
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const outHtml = process.argv[3] || path.join(__dirname, 'vectorize.html');
const dir = path.dirname(outHtml);

// 1) 把算法打成 _vec.js
const esbuild = path.join(__dirname, '..', '..', 'node_modules', 'esbuild', 'bin', 'esbuild');
execFileSync(process.execPath, [esbuild, path.join(__dirname, 'vec-entry.ts'),
  '--bundle', '--format=iife', '--outfile=' + path.join(dir, '_vec.js'), '--log-level=warning'], { stdio: 'inherit' });

// 2) 图片内联成 imgs.js
const items = spec.map(function (f) {
  const b = fs.readFileSync(f.img);
  if (b.readUInt32BE(16) === 0) throw new Error('not a PNG: ' + f.img);
  return { name: f.name, opts: f.opts || {}, src: 'data:image/png;base64,' + b.toString('base64') };
});
fs.writeFileSync(path.join(dir, 'imgs.js'), 'window.__FIGS__ = ' + JSON.stringify(items) + ';');
fs.copyFileSync(path.join(__dirname, 'vectorize.tpl.html'), outHtml);
console.log('wrote ' + outHtml + '  figures=' + items.length);
