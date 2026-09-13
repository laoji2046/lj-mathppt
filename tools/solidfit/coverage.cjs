// 用法: node tools/solidfit/coverage.cjs spec.json out.html
// 不需要真值的打分器：双向像素覆盖率（见 coverage.tpl.html 里的说明）
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const outHtml = process.argv[3] || path.join(__dirname, 'coverage.html');
const dir = path.dirname(outHtml);
const esbuild = path.join(__dirname, '..', '..', 'node_modules', 'esbuild', 'bin', 'esbuild');
execFileSync(process.execPath, [esbuild, path.join(__dirname, 'vec-entry.ts'),
  '--bundle', '--format=iife', '--outfile=' + path.join(dir, '_vec.js'), '--log-level=warning'], { stdio: 'inherit' });
const items = spec.map(function (f) {
  const b = fs.readFileSync(f.img);
  return { name: f.name, opts: f.opts || {}, src: 'data:image/png;base64,' + b.toString('base64') };
});
fs.writeFileSync(path.join(dir, 'imgs.js'), 'window.__FIGS__ = ' + JSON.stringify(items) + ';');
fs.copyFileSync(path.join(__dirname, 'coverage.tpl.html'), outHtml);
console.log('wrote ' + outHtml + '  figures=' + items.length);
