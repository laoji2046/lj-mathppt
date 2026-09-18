/**
 * MinerU 极薄代理 · Cloudflare Workers 版
 *
 * 与 local-proxy.js 逻辑完全一致，只是换成 Workers 的模块语法。
 *
 * 部署:
 *   npm i -g wrangler
 *   wrangler login
 *   wrangler secret put MINERU_TOKEN        # 粘贴你的 Token，不进代码库
 *   wrangler deploy
 *
 * 可选变量（wrangler.toml 的 [vars]）:
 *   ALLOWED_ORIGIN   允许的跨域来源，默认 "*"。上线建议改成你的前端域名。
 *
 * 路由:
 *   GET  /health
 *   ANY  /api/*                     转发到 https://mineru.net/api/*（注入 Token）
 *   PUT  /upload?to=<编码后的URL>    转发文件上传
 *   GET  /download?to=<编码后的URL>  转发结果下载
 */

const MINERU_ORIGIN = 'https://mineru.net';

// 只允许转发到这些域名，避免变成任意跳板
const ALLOWED_HOSTS = [
  /\.aliyuncs\.com$/,
  /\.openxlab\.org\.cn$/,
];

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': (env && env.ALLOWED_ORIGIN) || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function text(body, status, cors) {
  return new Response(body, {
    status,
    headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function checkTarget(raw) {
  let target;
  try {
    target = new URL(raw);
  } catch {
    return { error: 'to 参数不是合法 URL' };
  }
  if (target.protocol !== 'https:') return { error: '只允许 https' };
  if (!ALLOWED_HOSTS.some((re) => re.test(target.hostname))) {
    return { error: '域名不在白名单: ' + target.hostname };
  }
  return { target };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (url.pathname === '/health') {
        return json({ ok: true, tokenConfigured: Boolean(env.MINERU_TOKEN) }, 200, cors);
      }

      // ---- 文件上传转发 ----
      if (url.pathname === '/upload') {
        if (request.method !== 'PUT') return text('PUT only', 405, cors);
        const { target, error } = checkTarget(url.searchParams.get('to') || '');
        if (error) return json({ error }, 400, cors);

        // 关键：绝对不能带 Content-Type。
        // OSS 签名按「空 Content-Type」计算，多一个头就 SignatureDoesNotMatch。
        // ArrayBuffer 属于 BufferSource，fetch 不会自动补 Content-Type，正好。
        const body = await request.arrayBuffer();
        const upstream = await fetch(target.toString(), { method: 'PUT', body });
        return text(await upstream.text(), upstream.status, cors);
      }

      // ---- 结果下载转发 ----
      if (url.pathname === '/download') {
        const { target, error } = checkTarget(url.searchParams.get('to') || '');
        if (error) return json({ error }, 400, cors);

        const upstream = await fetch(target.toString());
        if (!upstream.ok) {
          return text('下载失败: HTTP ' + upstream.status, upstream.status, cors);
        }
        return new Response(upstream.body, {
          status: 200,
          headers: {
            ...cors,
            'Content-Type': 'application/zip',
            'Content-Length': upstream.headers.get('content-length') || '',
          },
        });
      }

      // ---- API 转发 ----
      if (url.pathname.startsWith('/api/')) {
        if (!env.MINERU_TOKEN) {
          return json({ error: 'MINERU_TOKEN 未配置' }, 500, cors);
        }
        const headers = new Headers();
        headers.set('Authorization', 'Bearer ' + env.MINERU_TOKEN);
        headers.set('Accept', '*/*');
        const ct = request.headers.get('Content-Type');
        if (ct) headers.set('Content-Type', ct);

        const init = { method: request.method, headers };
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          init.body = await request.arrayBuffer();
        }

        const upstream = await fetch(MINERU_ORIGIN + url.pathname + url.search, init);
        return new Response(upstream.body, {
          status: upstream.status,
          headers: {
            ...cors,
            'Content-Type':
              upstream.headers.get('content-type') || 'application/json; charset=utf-8',
          },
        });
      }

      return json({ error: 'not found' }, 404, cors);
    } catch (e) {
      return json({ error: String(e && e.message ? e.message : e) }, 500, cors);
    }
  },
};
