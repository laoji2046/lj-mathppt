
const fs=require('fs'), path=require('path');
const spec=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const items=spec.map(f=>{
  const b=fs.readFileSync(f.img);
  return {...f, src:'data:image/png;base64,'+b.toString('base64')};
});
const dir=path.dirname(process.argv[3]);
fs.writeFileSync(path.join(dir,'figs.js'), 'window.__FIGS__ = '+JSON.stringify(items)+';');
const tpl=fs.readFileSync(path.join(__dirname,'fit.tpl.html'),'utf8');
fs.writeFileSync(process.argv[3], tpl);
console.log('wrote '+process.argv[3]);