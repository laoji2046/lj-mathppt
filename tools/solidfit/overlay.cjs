
const fs=require('fs'), path=require('path');
const { renderSolid } = require('./_bundle.cjs');
const specPath = process.argv[2], outPath = process.argv[3];
const S = +(process.argv[4] || 1);
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));

function frame(f){
  const imgB = fs.readFileSync(f.img).toString('base64');
  const mesh = { edges: f.edges, faces: f.faces || [] };
  const svg = renderSolid(f.kind, f.points, f.w, f.h, '#e02020', 2.2/S, 'none', '6 5', f.vlabels || null,
    f.edgeStyles || null, undefined, undefined, f.labelOffsets || null, null, undefined, mesh);
  const W = Math.round(f.w*S), H = Math.round(f.h*S);
  const grid = [];
  for (let i=1;i<20;i++){ const p=i*5; const maj = i%2===0?' major':'';
    grid.push('<div class="v'+maj+'" style="left:'+p+'%"></div><div class="h'+maj+'" style="top:'+p+'%"></div>'); }
  return '<div class="fig" style="width:'+W+'px;height:'+H+'px">'
    + '<div class="tag">'+f.name+'  '+f.w+'x'+f.h+'  x'+S+'</div>'
    + '<img src="data:image/png;base64,'+imgB+'">'
    + '<svg class="ov" width="'+W+'" height="'+H+'" viewBox="0 0 '+f.w+' '+f.h+'">'+svg+'</svg>'
    + '<div class="grid">'+grid.join('')+'</div>'
    + '</div>';
}
const html = '<!doctype html><html><head><meta charset="utf-8"><style>'
  + 'body{margin:0;background:#fff;font:12px/1.4 "Segoe UI",sans-serif}'
  + '.wrap{display:flex;flex-wrap:wrap;gap:14px;padding:10px}'
  + '.fig{position:relative;border:1px solid #ddd;flex:none}'+ '.fig img{display:block;width:100%;height:100%}'
  + '.ov{position:absolute;left:0;top:0;pointer-events:none;opacity:.72}'
  + '.grid{position:absolute;inset:0}'
  + '.grid .v,.grid .h{position:absolute;background:rgba(60,120,230,.22)}'
  + '.grid .v{top:0;bottom:0;width:1px}.grid .h{left:0;right:0;height:1px}'
  + '.grid .v.major,.grid .h.major{background:rgba(60,120,230,.5)}'
  + '.tag{position:absolute;left:2px;top:2px;background:#000;color:#fff;padding:0 4px;font-size:11px;z-index:3}'
  + '</style></head><body><div class="wrap">' + spec.map(frame).join('') + '</div></body></html>';
fs.writeFileSync(outPath, html);
console.log('wrote '+outPath);