/* 简单的静态 HTTP 服务器：服务 demo\dist 目录（index.html / app.js / styles.css
 *  + revealjs/ + geogebra/），供浏览器通过 http://127.0.0.1:<port> 访问。
 * 用途：绕过 file:// 的 CORS 限制（GeoGebra / Reveal 资源正常加载），
 *       并能在浏览器里打开 F12 调试。
 * 用法：node server.js   （默认 8765 端口，可 node server.js 8080）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2], 10) || 8765;
const ROOT = path.resolve(__dirname, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.map': 'application/json',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);

  // ---- 导出/文件夹相关 JSON 端点（与打包版 Tauri 原生命令行为一致）----
  if (urlPath === '/__app_dir' && (req.method === 'GET' || req.method === 'HEAD')) {
    const dir = __dirname;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ dir: dir }));
    return;
  }
  if (urlPath === '/__list_dir' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let start = null;
      try { start = (JSON.parse(body || '{}').path || '').trim(); } catch (e) { start = ''; }
      let dir = start && fs.statSync(start).isDirectory() ? start : __dirname;
      let dirs = [];
      try {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) dirs.push(e.name);
        }
      } catch (e) {}
      dirs.sort();
      const parent = path.dirname(dir);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, path: dir, parent: parent !== dir ? parent : null, dirs: dirs }));
    });
    return;
  }
  if (urlPath === '/__export_json' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let p = null;
      try {
        p = JSON.parse(body || '{}');
        const dir = (p.path || '').trim();
        const name = (p.name || '').trim();
        if (!dir || !name || name.includes('/') || name.includes('\\') || name === '..' || name === '.') {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: '非法文件名' }));
          return;
        }
        const bytes = Buffer.from(p.dataBase64 || '', 'base64');
        const full = path.join(dir, name);
        fs.writeFileSync(full, bytes);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: true, path: full }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
      }
    });
    return;
  }

  // 其它请求只处理 GET/HEAD
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('405 Method Not Allowed');
    return;
  }

  if (urlPath === '' || urlPath === '/') urlPath = '/index.html';

  // 归一化并限制在 ROOT 内（防止路径穿越）
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      // 未找到：若请求的是带版本参数或扩展名缺失的，给友好 404
      if (err) {
        console.log('  404', req.url, '->', err.code);
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found: ' + urlPath);
      }
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    // 禁用缓存，方便调试（改文件立即生效，不用强刷）
    const headers = {
      'Content-Type': mime,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => { res.destroy(); });
    stream.pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('==========================================');
  console.log('  RevealSlidr 本地静态服务器');
  console.log('  根目录: ' + ROOT);
  console.log('  访问:   http://127.0.0.1:' + PORT + '/index.html');
  console.log('  按 Ctrl+C 停止');
  console.log('==========================================');
});
