/**
 * MinerU 浏览器端客户端（ESM，零依赖）
 *
 * 把「提交 → 上传 → 轮询 → 下载 → 解包」整条链路封成一个 Promise。
 * 所有请求都打向代理，浏览器不接触 Token，也不受 CORS 限制。
 *
 * 用法:
 *   import { createMineruClient } from './mineru-client.js';
 *
 *   const client = createMineruClient({ proxy: 'http://127.0.0.1:8787' });
 *   const r = await client.parse(fileInput.files[0], {
 *     onProgress: (stage, info) => console.log(stage, info),
 *   });
 *   console.log(r.markdown);
 *   console.log(r.contentList);   // 带 bbox 的版面元素，切题用
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * 最小 ZIP 读取器
 * 只用浏览器原生的 DecompressionStream，不引第三方库。
 * 支持 store(0) 与 deflate(8) 两种压缩方式 —— 覆盖 Python zipfile 的默认输出。
 * ------------------------------------------------------------------ */

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unzip(buffer) {
  const u8 = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // 从尾部往前找 End of Central Directory（可能带注释，所以要回扫）
  let eocd = -1;
  const minPos = Math.max(0, u8.length - 22 - 65535);
  for (let i = u8.length - 22; i >= minPos; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 包');

  const count = view.getUint16(eocd + 10, true);
  let off = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder('utf-8');
  const files = {};

  for (let n = 0; n < count; n++) {
    if (view.getUint32(off, true) !== 0x02014b50) break; // 中央目录项签名
    const method = view.getUint16(off + 10, true);
    const compSize = view.getUint32(off + 20, true);
    const nameLen = view.getUint16(off + 28, true);
    const extraLen = view.getUint16(off + 30, true);
    const commentLen = view.getUint16(off + 32, true);
    const localOff = view.getUint32(off + 42, true);
    const name = decoder.decode(u8.subarray(off + 46, off + 46 + nameLen));

    // 本地文件头里的文件名/扩展区长度可能与中央目录不同，必须重读
    const lNameLen = view.getUint16(localOff + 26, true);
    const lExtraLen = view.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = u8.subarray(dataStart, dataStart + compSize);

    if (method === 0) {
      files[name] = raw.slice();
    } else if (method === 8) {
      files[name] = await inflateRaw(raw);
    }
    // 其它压缩方式直接跳过

    off += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/* ------------------------------------------------------------------ *
 * 客户端
 * ------------------------------------------------------------------ */

export function createMineruClient({ proxy, pollInterval = 5000, timeout = 900000 } = {}) {
  if (!proxy) throw new Error('必须提供 proxy 地址');
  const base = String(proxy).replace(/\/+$/, '');

  async function api(path, { method = 'GET', body } = {}) {
    const init = { method };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const res = await fetch(base + path, init);
    const textBody = await res.text();
    let data;
    try {
      data = JSON.parse(textBody);
    } catch {
      throw new Error(`代理返回非 JSON（HTTP ${res.status}）: ${textBody.slice(0, 200)}`);
    }
    if (!res.ok || (data && data.code !== undefined && data.code !== 0)) {
      throw new Error(`接口失败 HTTP ${res.status}: ${textBody.slice(0, 300)}`);
    }
    return data;
  }

  async function uploadTo(fileOrBlob, signedUrl) {
    const buf = await fileOrBlob.arrayBuffer();
    // 注意：这里刻意不设 Content-Type，OSS 签名是按空 Content-Type 算的
    const res = await fetch(base + '/upload?to=' + encodeURIComponent(signedUrl), {
      method: 'PUT',
      body: buf,
    });
    if (!res.ok) {
      throw new Error(`上传失败 HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  }

  async function downloadZip(zipUrl) {
    const res = await fetch(base + '/download?to=' + encodeURIComponent(zipUrl));
    if (!res.ok) throw new Error(`结果包下载失败 HTTP ${res.status}`);
    return res.arrayBuffer();
  }

  async function pollBatch(batchId, onProgress) {
    const t0 = Date.now();
    let last = null;
    for (;;) {
      const r = await api(`/api/v4/extract-results/batch/${batchId}`);
      const list = (r.data && r.data.extract_result) || [];
      const item = list[0];
      if (!item) throw new Error('批量结果为空');

      if (item.state === 'failed') {
        throw new Error(`解析失败: ${item.err_msg || '未知原因'}`);
      }
      if (item.state === 'done' && item.full_zip_url) {
        return item.full_zip_url;
      }
      if (item.state !== last) {
        last = item.state;
        onProgress && onProgress('parsing', { state: item.state, progress: item.extract_progress });
      }
      if (Date.now() - t0 > timeout) {
        throw new Error(`等待超时（${Math.round(timeout / 1000)}s）`);
      }
      await sleep(pollInterval);
    }
  }

  function packFiles(files) {
    const decoder = new TextDecoder('utf-8');
    const out = { markdown: '', contentList: null, contentListV2: null, layout: null, model: null, images: {}, files };
    for (const [name, bytes] of Object.entries(files)) {
      const lower = name.toLowerCase();
      if (lower.endsWith('_content_list_v2.json')) {
        out.contentListV2 = JSON.parse(decoder.decode(bytes));
      } else if (lower.endsWith('_content_list.json')) {
        out.contentList = JSON.parse(decoder.decode(bytes));
      } else if (lower.endsWith('layout.json')) {
        out.layout = JSON.parse(decoder.decode(bytes));
      } else if (lower.endsWith('_model.json')) {
        out.model = JSON.parse(decoder.decode(bytes));
      } else if (lower.endsWith('full.md')) {
        out.markdown = decoder.decode(bytes);
      } else if (lower.startsWith('images/')) {
        const ext = lower.split('.').pop();
        const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'application/octet-stream';
        out.images[name] = new Blob([bytes], { type: mime });
      }
    }
    return out;
  }

  const commonOptions = (extra = {}) => ({
    enable_formula: true,
    enable_table: true,
    language: 'ch',
    model_version: 'vlm',
    ...extra,
  });

  return {
    /** 解析本地文件（File / Blob）。数学试卷务必保持 isOcr = true。 */
    async parse(fileOrBlob, { onProgress, isOcr = true, pageRanges = '' } = {}) {
      const name = fileOrBlob.name || 'upload.pdf';

      onProgress && onProgress('submitting');
      const fileEntry = { name, is_ocr: isOcr };
      if (pageRanges) fileEntry.page_ranges = pageRanges;

      const r = await api('/api/v4/file-urls/batch', {
        method: 'POST',
        body: commonOptions({ files: [fileEntry] }),
      });
      const batchId = r.data.batch_id;
      const signedUrl = r.data.file_urls[0];

      onProgress && onProgress('uploading', { bytes: fileOrBlob.size });
      await uploadTo(fileOrBlob, signedUrl);

      const zipUrl = await pollBatch(batchId, onProgress);

      onProgress && onProgress('downloading');
      const buf = await downloadZip(zipUrl);
      const files = await unzip(buf);

      onProgress && onProgress('done');
      return packFiles(files);
    },

    /** 解析远端 URL（MinerU 服务器自己去拉，不需要上传） */
    async parseUrl(url, { onProgress, isOcr = false, pageRanges = '' } = {}) {
      onProgress && onProgress('submitting');
      const payload = commonOptions({ url, is_ocr: isOcr });
      if (pageRanges) payload.page_ranges = pageRanges;

      const r = await api('/api/v4/extract/task', { method: 'POST', body: payload });
      const taskId = r.data.task_id;

      onProgress && onProgress('parsing', { state: 'pending' });
      const t0 = Date.now();
      let zipUrl = null;
      let last = null;
      for (;;) {
        const q = await api(`/api/v4/extract/task/${taskId}`);
        const d = q.data || {};
        if (d.state === 'failed') throw new Error(`解析失败: ${d.err_msg || '未知原因'}`);
        if (d.state === 'done' && d.full_zip_url) {
          zipUrl = d.full_zip_url;
          break;
        }
        if (d.state !== last) {
          last = d.state;
          onProgress && onProgress('parsing', { state: d.state, progress: d.extract_progress });
        }
        if (Date.now() - t0 > timeout) throw new Error('等待超时');
        await sleep(pollInterval);
      }

      onProgress && onProgress('downloading');
      const buf = await downloadZip(zipUrl);
      const files = await unzip(buf);
      onProgress && onProgress('done');
      return packFiles(files);
    },

    unzip,
  };
}
