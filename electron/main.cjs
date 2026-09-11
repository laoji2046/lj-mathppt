const { app, BrowserWindow } = require('electron')
const http = require('http')
const path = require('path')
const fs = require('fs')

const dist = path.join(__dirname, '..', 'dist')
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.wasm': 'application/wasm', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json', '.md': 'text/plain' }
let server = null

function serve(req, res) {
  let p = decodeURIComponent((req.url || '/').split('?')[0])
  if (p === '/') p = '/index.html'
  // 防目录穿越
  const file = path.normalize(path.join(dist, p))
  if (!file.startsWith(path.normalize(dist))) { res.writeHead(403); res.end(); return }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found'); return }
    res.writeHead(200, { 'Content-Type': (MIME[path.extname(file).toLowerCase()] || 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-cache' })
    res.end(data)
  })
}

function createWindow() {
  const win = new BrowserWindow({ width: 1440, height: 900, minWidth: 960, minHeight: 640, autoHideMenuBar: true, backgroundColor: '#f2f2f5', title: 'LJ-MathSlides' })
  win.loadURL('http://127.0.0.1:' + server.address().port + '/')
}

app.whenReady().then(() => {
  server = http.createServer(serve)
  server.listen(0, '127.0.0.1', createWindow)
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (server) server.close(); if (process.platform !== 'darwin') app.quit() })
