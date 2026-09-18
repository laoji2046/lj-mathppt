# MinerU 极薄代理

解决三件事，别的什么都不做：

1. **补 CORS 头** —— MinerU 官方接口没有任何 `Access-Control-Allow-Origin`，
   `OPTIONS` 预检直接返回 `405 Method Not Allowed`，浏览器一律拦死。
2. **注入 Token** —— Token 只存在服务端，永远不进浏览器。
3. **转发上传与下载** —— OSS 签名地址（`*.aliyuncs.com`）和结果包 CDN
   （`*.openxlab.org.cn`）都在别的域，浏览器同样跨不过去。

## 路由

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查，返回 `{ok, tokenConfigured}` |
| ANY | `/api/*` | 转发到 `https://mineru.net/api/*`，自动注入 `Authorization` |
| PUT | `/upload?to=<编码后的URL>` | 转发文件上传到 OSS 签名地址 |
| GET | `/download?to=<编码后的URL>` | 转发下载结果包 |

`/upload` 与 `/download` 的目标域名受白名单限制（`*.aliyuncs.com`、
`*.openxlab.org.cn`），且只允许 `https`，避免代理被当成任意跳板。

## 本地跑（零部署，先用这个）

```bash
# bash
MINERU_TOKEN=你的token node local-proxy.js

# Windows CMD
set MINERU_TOKEN=你的token && node local-proxy.js

# Windows PowerShell
$env:MINERU_TOKEN="你的token"; node local-proxy.js
```

零依赖，只用 Node 内置模块，Node 18+ 即可。默认监听 `127.0.0.1:8787`。

验证：

```bash
curl http://127.0.0.1:8787/health
# {"ok":true,"tokenConfigured":true}
```

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `MINERU_TOKEN` | 无 | 必填，MinerU Token |
| `PORT` | `8787` | 监听端口 |
| `ALLOWED_ORIGIN` | `*` | 允许的跨域来源，上线建议改成前端域名 |

## 部署到 Cloudflare Workers

```bash
npm i -g wrangler
wrangler login
wrangler secret put MINERU_TOKEN     # 粘贴 Token，不进代码库
wrangler deploy
```

部署完把 `wrangler.toml` 里的 `ALLOWED_ORIGIN` 改成你的前端域名再重新部署。

## 前端怎么用

```js
import { createMineruClient } from './mineru-client.js';

const client = createMineruClient({ proxy: 'http://127.0.0.1:8787' });

const r = await client.parse(file, {
  isOcr: true,                                  // 数学试卷必须开
  onProgress: (stage) => console.log(stage),    // submitting/uploading/parsing/downloading/done
});

r.markdown      // Markdown 正文
r.contentList   // 带 bbox 的版面元素数组，切题用这个
r.images        // { 'images/xxx.jpg': Blob }
```

## 两个必须知道的坑

**一、上传时绝对不能带 `Content-Type`。**
OSS 的签名是按「空 `Content-Type`」计算的，多一个头就 `SignatureDoesNotMatch`（HTTP 403）。
Node 的 `fetch` 对 `Buffer`、浏览器对 `ArrayBuffer` 都不会自动补这个头，正好；
但 `urllib` 会自动塞 `application/x-www-form-urlencoded`，所以 Python 侧必须用 `http.client`。

**二、`enable_formula` / `is_ocr` / `enable_table` / `language` 只对 PDF 有效。**
直接传 PNG/JPG，公式识别不会启用。所以拍照件要在前端先包成 PDF 再上传。
