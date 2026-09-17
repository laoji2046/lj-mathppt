
const fs = require('fs');
const X = 'C:/Users/老冀/Desktop/vue-app/参考/pptx-sample/x';
const s4 = fs.readFileSync(X + '/ppt/slides/slide4.xml', 'utf8');
// 找第一个 oMath 附近的上下文
const i = s4.indexOf('<m:oMath');
console.log('=== slide4 里第一个公式的上下文（前后 700 字）===');
console.log(s4.slice(Math.max(0, i - 350), i + 350).replace(/></g, '>\n<').slice(0, 1600));
console.log('');
console.log('=== slide4 有没有 <p:graphicFrame> / OLE 对象 ===');
for (const tag of ['p:graphicFrame', 'p:oleObj', 'p:pic', 'm:oMathPara', 'm:oMath', 'a:tbl', 'p:sp']) {
  console.log('  ' + tag + ': ' + ((s4.match(new RegExp('<' + tag + '[ >]', 'g')) || []).length));
}
console.log('');
console.log('=== 媒体里 WMF/EMF 的文件名（看是不是公式）===');
const md = fs.readdirSync(X + '/ppt/media');
console.log('  ' + md.filter(f => /\.(wmf|emf)$/i.test(f)).slice(0, 10).join(', '));
console.log('  png 前几个: ' + md.filter(f => /\.png$/i.test(f)).slice(0, 8).join(', '));
console.log('');
console.log('=== slide4 的 rels（图片/嵌入指向哪）===');
const rel = fs.readFileSync(X + '/ppt/slides/_rels/slide4.xml.rels', 'utf8');
console.log('  ' + [...rel.matchAll(/Target="([^"]+)"/g)].map(m => m[1]).join(', ').slice(0, 400));
