
const fs = require('fs');
const html = fs.readFileSync('dist/index.html', 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => u.includes('/assets/')).map((u) => u.split('/').pop());
let n = 0, bytes = 0;
for (const f of fs.readdirSync('dist/assets')) {
  if (!/^index-.*\.(js|css)$/.test(f)) continue;
  if (refs.includes(f)) continue;
  bytes += fs.statSync('dist/assets/' + f).size;
  fs.unlinkSync('dist/assets/' + f);
  n++;
}
console.log('删除陈旧产物 ' + n + ' 个，回收 ' + Math.round(bytes / 1024 / 1024) + ' MB；保留 ' + refs.join(', '));
console.log('assets 剩余 ' + fs.readdirSync('dist/assets').length + ' 个文件');
