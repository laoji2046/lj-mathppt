#!/usr/bin/env node
/**
 * MinerU 极薄代理 · 本地 Node 版
 *
 * 只做三件事：
 *   1. 补 CORS 头（MinerU 官方接口没有 Access-Control-Allow-Origin）
 *   2. 注入 Token（Token 只存在服务端，不进浏览器）
 *   3. 转发上传/下载（OSS 签名地址和 CDN 结果包都在别的域，浏览器同样跨不过去）
 *
 * 零依赖，只用 Node 内置模块。Node 18+ 即可。
 *
 * 启动:
 *   MINERU_TOKEN=你的token node local-proxy.js
 *   # Windows CMD:        set MINERU_TOKEN=xxx && node local-proxy.js
 *   # Windows PowerShell: $env:MINERU_TOKEN="xxx"; node local-proxy.js
 *
 * 路由:
 *   GET  /health                    健康检查
 *   ANY  /api/*                     转发到 https://mineru.net/api/*（自动带 Token）
 *   PUT  /upload?to=<编码后的URL>    转发文件上传到 OSS 签名地址
 *   GET  /download?to=<编码后的URL>  转发下载结果包
 */

const http = require('node:http');

const PORT = Number(process.env.PORT || 8787);
const TOKEN = process.env.MINERU_TOKEN || '';
const MINERU_ORIGIN = 'https://mineru.net';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

// 只允许转发到这些域名，避免变成任意跳板
const ALLOWED_HOSTS = [
  /\.aliyuncs\.com$/,
  /\.openxlab\.org\.cn$/,
];

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function send(res, status, body, extra = {}) {
  res.writeHead(status, { ...corsHeaders(), ...extra });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), {
    'Content-Type': 'application/json; charset=utf-8',
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function checkTarget(raw) {
  let target;
  try {
    target = new URL(raw);
  } catch {
    return { error: 'to 参数不是合法 URL' };
  }
  if (target.protocol !== 'https:') {
    return { error: '只允许 https' };
  }
  if (!ALLOWED_HOSTS.some((re) => re.test(target.hostname))) {
    return { error: '域名不在白名单: ' + target.hostname };
  }
  return { target };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  try {
    if (url.pathname === '/health') {
      return sendJson(res, 200, { ok: true, tokenConfigured: Boolean(TOKEN) });
    }

    // ---- 文件上传转发 ----
    if (url.pathname === '/upload') {
      if (req.method !== 'PUT') return send(res, 405, 'PUT only');
      const { target, error } = checkTarget(url.searchParams.get('to') || '');
      if (error) return sendJson(res, 400, { error });

      const body = await readBody(req);
      // 关键：绝对不能带 Content-Type。
      // OSS 的签名是按「空 Content-Type」计算的，多一个头就 SignatureDoesNotMatch。
      // Buffer 属于 BufferSource，fetch 不会自动补 Content-Type，正好。
      const upstream = await fetch(target.toString(), { method: 'PUT', body });
      const text = await upstream.text();
      return send(res, upstream.status, text, {
        'Content-Type': 'text/plain; charset=utf-8',
      });
    }

    // ---- 结果下载转发 ----
    if (url.pathname === '/download') {
      const { target, error } = checkTarget(url.searchParams.get('to') || '');
      if (error) return sendJson(res, 400, { error });

      const upstream = await fetch(target.toString());
      if (!upstream.ok) {
        return send(res, upstream.status, '下载失败: HTTP ' + upstream.status);
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      return send(res, 200, buf, {
        'Content-Type': 'application/zip',
        'Content-Length': String(buf.length),
      });
    }

    // ---- API 转发 ----
    if (url.pathname.startsWith('/api/')) {
      if (!TOKEN) {
        return sendJson(res, 500, {
          error: 'MINERU_TOKEN 未配置，请在启动代理前设置该环境变量',
        });
      }
      const target = MINERU_ORIGIN + url.pathname + url.search;
      const headers = { Authorization: 'Bearer ' + TOKEN, Accept: '*/*' };
      const ct = req.headers['content-type'];
      if (ct) headers['Content-Type'] = ct;

      const init = { method: req.method, headers };
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        init.body = await readBody(req);
      }

      const upstream = await fetch(target, init);
      const buf = Buffer.from(await upstream.arrayBuffer());
      return send(res, upstream.status, buf, {
        'Content-Type':
          upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      });
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (e) {
    sendJson(res, 500, { error: String(e && e.message ? e.message : e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`MinerU 代理已启动  ->  http://127.0.0.1:${PORT}`);
  console.log(`Token: ${TOKEN ? '已配置' : '未配置（设置 MINERU_TOKEN 后重启）'}`);
  console.log(`允许的跨域来源: ${ALLOW_ORIGIN}`);
});
