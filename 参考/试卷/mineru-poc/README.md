# 高中数学试卷自动录入 · POC

用 MinerU 云端 API 把试卷（拍照 / 扫描 / 电子版）转成结构化题目数据。

```
试卷文件
  → [MinerU 解析]        版面分析 · 公式→LaTeX · 表格→HTML · 图形 bbox
  → content_list.json    带 bbox 的版面元素
  → [exam_parser.py]     切题 · 拆选项 · 归大题 · 修公式边界
  → questions.json       结构化题目数组
```

## 目录

| 文件 | 作用 |
|---|---|
| `mineru_poc.py` | MinerU 客户端。提交 / 上传 / 轮询 / 解包，零依赖 |
| `exam_parser.py` | 切题层。吃 `content_list.json`，吐 `questions.json`，纯规则 |
| `proxy/local-proxy.js` | 极薄代理（本地 Node 版），前端接入用 |
| `proxy/worker.js` | 极薄代理（Cloudflare Workers 版） |
| `proxy/mineru-client.js` | 浏览器端客户端，零依赖 |
| `sample/` | 自建仿真试卷，三种形态 |
| `out/` | 实测结果 |

---

## 用法一：命令行快速验证（最简单，不需要代理）

只需要一个 Token：https://mineru.net/apiManage/token （免费，每日 2000 页）

```bash
cd mineru-poc
export MINERU_TOKEN=你的token          # Windows PowerShell: $env:MINERU_TOKEN="你的token"

# 数学试卷必须加 --ocr
python mineru_poc.py sample/exam_img.pdf --precision --ocr
```

输出在 `out/exam_img/`，然后切题（直接传目录即可，会自动找 `content_list.json`）：

```bash
python exam_parser.py out/exam_img
```

会打印切题报告，并在同目录生成 `questions.json`。

**常用参数**

| 参数 | 说明 |
|---|---|
| `--precision` | 用精准 API（要 Token）。**不加则用轻量 API，公式会乱码，别用** |
| `--ocr` | 强制 OCR。**数学试卷必须加**，见下方「两个坑」 |
| `--model vlm` | 精准模式的模型，默认已是 `vlm` |
| `--pages 1-5` | 只解析指定页 |
| `--base URL` | 指向代理，见用法二 |

---

## 用法二：前端 / 浏览器接入

浏览器不能直连 MinerU（没有 CORS 头），必须经代理。

**1. 启动代理**

```bash
cd mineru-poc/proxy
export MINERU_TOKEN=你的token
node local-proxy.js
# MinerU 代理已启动  ->  http://127.0.0.1:8787
```

**2. 验证**

```bash
curl http://127.0.0.1:8787/health
# {"ok":true,"tokenConfigured":true}
```

**3. 前端调用**

```js
import { createMineruClient } from './proxy/mineru-client.js';

const client = createMineruClient({ proxy: 'http://127.0.0.1:8787' });

const r = await client.parse(fileInput.files[0], {
  isOcr: true,
  onProgress: (stage, info) => console.log(stage),  // submitting/uploading/parsing/downloading/done
});

r.markdown      // Markdown 正文
r.contentList   // 带 bbox 的版面元素，切题用
r.images        // { 'images/xxx.jpg': Blob }
```

**4. 用命令行脚本走代理**（验证代理是否通）

```bash
python mineru_poc.py sample/exam_img.pdf --precision --ocr --base http://127.0.0.1:8787
```

这样跑**不需要 Token**，代理会注入。

**5. 上线**：见 `proxy/README.md`，部署到 Cloudflare Workers。

---

## 用法三：完整链路（代理 + 解析 + 切题）

```bash
# 终端 1
cd mineru-poc/proxy && MINERU_TOKEN=xxx node local-proxy.js

# 终端 2
cd mineru-poc
python mineru_poc.py 你的试卷.pdf --precision --ocr --base http://127.0.0.1:8787
python exam_parser.py out/你的试卷
```

---

## 两个坑（都踩过了）

**一、数学试卷必须 `--ocr`，哪怕是电子版 PDF。**

MinerU 会尝试从逐字符定位的文字层重建 LaTeX，插一堆 `~` 占位符，把 `A` 变成 `\cal A`、
`π/3` 变成 `\mathfrak{N}/3`。强制走 OCR 反而干净。实测同一道题：

| 输入 | 结果 |
|---|---|
| 电子版 PDF（文字层）+ 精准 vlm | `$\mathrm { ~ { ~ \cal ~ A ~ } ~ }$` 崩 |
| 图片型 PDF + OCR + 精准 vlm | `$A = \{x \mid x^2 - 3x + 2 \leqslant 0\}$` 正确 |

**二、轻量 API（不加 `--precision`）公式质量不可用。**

免 Token 很诱人，但公式时对时错，只能拿来看版面，不能用于生产。

**三、上传时不能带 `Content-Type`。**

OSS 签名按「空 `Content-Type`」计算。Python 侧已用 `http.client` 规避
（`urllib` 会自动塞 `application/x-www-form-urlencoded`）。

---

## 已知限制

- `exam_parser.py` 是 Python，**尚未移植成 TS**，所以纯前端架构下切题层还不能在浏览器跑。
- 图形（几何图 / 函数图像）目前只保留 MinerU 裁好的位图，未做矢量化。
- 知识点、难度、答案等语义字段尚未抽取，留给下游模型或人工。
