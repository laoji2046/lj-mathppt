/**
 * 构建后清理 dist 里的陈旧产物 ✓
 *
 * ⚠ 旧版本只清理 index-*.（js|css） ✗ —— 但 Vite 给每个**懒加载模块**也产出带哈希的文件 ✓
 * （PaperModal-a1b2c3.js ✓ LayoutGallery-d4e5f6.js ✓ …）✓，
 * 而那些文件**不在 index.html 里被引用** ✗ —— 旧脚本压根不看它们 ✓，
 * 结果一路累积到 **1606 个文件 / 31.85 MB** ✗（实测 ✓ PaperModal 一个模块就有 177 个旧版本 ✗）。
 *
 * 正确做法 ✓：**构建前把 dist 整个删掉** ✗，让 Vite 从零产出 ✓。
 * 本脚本改为在构建前执行这一步 ✓，并在构建后只做校验 ✓。
 */
const fs = require('fs');

if (process.argv.includes('--before')) {
  if (fs.existsSync('dist')) {
    let n = 0, bytes = 0;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = d + '/' + e.name;
        if (e.isDirectory()) walk(p);
        else { bytes += fs.statSync(p).size; n++; }
      }
    };
    walk('dist');
    fs.rmSync('dist', { recursive: true, force: true });
    console.log('构建前清空 dist：删除 ' + n + ' 个文件，回收 ' + Math.round(bytes / 1024 / 1024) + ' MB');
  } else {
    console.log('构建前清空 dist：目录不存在，无需清理');
  }
  process.exit(0);
}

if (!fs.existsSync('dist/assets')) {
  console.log('dist/assets 不存在，跳过校验');
  process.exit(0);
}
const files = fs.readdirSync('dist/assets');
const html = fs.readFileSync('dist/index.html', 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
console.log('构建后校验：dist/assets 共 ' + files.length + ' 个文件；index.html 引用 ' + refs.length + ' 个');
