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

// 【v1438】把入口 HTML 再放一份到 dist/app/index.html ——
// 原因（本机实测）：Tauri 打包时 frontendDist **根目录下的文件会被漏掉**
// （dist/index.html → 运行时 "asset not found: index.html"；dist/probe-root.txt 也没进 exe；
//   而 dist/assets/*.js、dist/three/*、dist/geogebra/…/GeoGebra.html 这些**子目录里的**都在 ✓）。
// 所以窗口 URL 改成 app/index.html（见 src-tauri/tauri.conf.json 的 url），根级 index.html 保留不影响 ✓。
const path = require('path');
try {
  const dir = path.join('dist', 'app');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join('dist', 'index.html'), path.join(dir, 'index.html'));
  console.log('已复制入口：dist/app/index.html（供 Tauri 窗口加载，绕开根级文件被漏掉的问题）');
} catch (e) {
  console.log('复制 dist/app/index.html 失败：' + (e && e.message));
}
