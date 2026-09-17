
const fs = require('fs');
const path = require('path');
const X = 'C:/Users/老冀/Desktop/vue-app/参考/pptx-sample/x';
const slidesDir = path.join(X, 'ppt/slides');
const files = fs.readdirSync(slidesDir).filter(f => /^slide\d+\.xml$/.test(f))
  .sort((a, b) => parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, '')));
const count = (s, re) => (s.match(re) || []).length;
console.log('页号  文本框 图 表 组合 文本段 公式');
let T = { sp: 0, pic: 0, tbl: 0, grp: 0, txt: 0, eq: 0 };
for (const f of files) {
  const s = fs.readFileSync(path.join(slidesDir, f), 'utf8');
  const c = {
    sp: count(s, /<p:sp>/g), pic: count(s, /<p:pic>/g), tbl: count(s, /<a:tbl>/g),
    grp: count(s, /<p:grpSp>/g), txt: count(s, /<a:t>/g), eq: count(s, /m:oMath/g),
  };
  for (const k of Object.keys(T)) T[k] += c[k];
  console.log('  ' + f.replace(/\D/g, '').padEnd(4) + String(c.sp).padEnd(7) + String(c.pic).padEnd(3) +
    String(c.tbl).padEnd(3) + String(c.grp).padEnd(5) + String(c.txt).padEnd(7) + c.eq);
}
console.log('合计: 文本框 ' + T.sp + ' · 图 ' + T.pic + ' · 表 ' + T.tbl + ' · 组合 ' + T.grp + ' · 文本段 ' + T.txt + ' · 公式 ' + T.eq);
const mediaDir = path.join(X, 'ppt/media');
if (fs.existsSync(mediaDir)) {
  const m = fs.readdirSync(mediaDir);
  const byExt = {};
  let bytes = 0;
  for (const f of m) { const e = path.extname(f).slice(1).toLowerCase(); byExt[e] = (byExt[e] || 0) + 1; bytes += fs.statSync(path.join(mediaDir, f)).size; }
  console.log('媒体: ' + m.length + ' 个 / ' + (bytes / 1048576).toFixed(2) + ' MB  ' + JSON.stringify(byExt));
}
for (const d of ['ppt/embeddings', 'ppt/charts', 'ppt/diagrams']) {
  const p = path.join(X, d);
  console.log(d + ': ' + (fs.existsSync(p) ? fs.readdirSync(p).length + ' 个' : '无'));
}
// 第 1 页的文字内容，看排版意图
const s1 = fs.readFileSync(path.join(slidesDir, 'slide1.xml'), 'utf8');
const texts = [...s1.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]);
console.log('--- 第 1 页文字 ---');
console.log(JSON.stringify(texts));
