/**
 * MinerU 浏览器端客户端
 *
 * 把「提交 → 上传 → 轮询 → 下载 → 解包」整条链路封成一个 Promise。
 * 所有请求都打向代理，浏览器不接触 Token，也不受 CORS 限制。
 *
 * 对应 mineru-poc/proxy/mineru-client.js，这里加了类型。
 */

import type { MineruElement } from './types';

export type ParseStage = 'submitting' | 'uploading' | 'parsing' | 'downloading' | 'done';

export interface ProgressInfo {
  state?: string;
  bytes?: number;
  progress?: { extracted_pages?: number; total_pages?: number; start_time?: string };
}

export type ProgressHandler = (stage: ParseStage, info?: ProgressInfo) => void;

export interface ParseResult {
  markdown: string;
  contentList: MineruElement[] | null;
  contentListV2: unknown[] | null;
  layout: unknown | null;
  model: unknown | null;
  images: Record<string, Blob>;
  files: Record<string, Uint8Array>;
}

export interface ParseOptions {
  onProgress?: ProgressHandler;
  /** 数学试卷务必保持 true：文字层会干扰公式识别 */
  isOcr?: boolean;
  pageRanges?: string;
}

export interface ClientOptions {
  proxy: string;
  pollInterval?: number;
  timeout?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * 最小 ZIP 读取器
 * 只用浏览器原生的 DecompressionStream，不引第三方库。
 * 支持 store(0) 与 deflate(8)，覆盖 Python zipfile 的默认输出。
 * ------------------------------------------------------------------ */

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unzip(buffer: ArrayBuffer): Promise<Record<string, Uint8Array>> {
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
  const files: Record<string, Uint8Array> = {};

  for (let n = 0; n < count; n++) {
    if (view.getUint32(off, true) !== 0x02014b50) break; // 中央目录项签名
    const method = view.getUint16(off + 10, true);
    const compSize = view.getUint32(off + 20, true);
    const nameLen = view.getUint16(off + 28, true);
    const extraLen = view.getUint16(off + 30, true);
    const commentLen = view.getUint16(off + 32, true);
    const localOff = view.getUint32(off + 42, true);
    const name = decoder.decode(u8.subarray(off + 46, off + 46 + nameLen));

    // 本地文件头里的文件名/扩展区长度可能与中央目录不同，必须重读，
    // 否则数据起始偏移会算错
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

function packFiles(files: Record<string, Uint8Array>): ParseResult {
  const decoder = new TextDecoder('utf-8');
  const out: ParseResult = {
    markdown: '',
    contentList: null,
    contentListV2: null,
    layout: null,
    model: null,
    images: {},
    files,
  };

  for (const [name, bytes] of Object.entries(files)) {
    const lower = name.toLowerCase();
    if (lower.endsWith('_content_list_v2.json')) {
      out.contentListV2 = JSON.parse(decoder.decode(bytes));
    } else if (lower.endsWith('_content_list.json')) {
      out.contentList = JSON.parse(decoder.decode(bytes)) as MineruElement[];
    } else if (lower.endsWith('layout.json')) {
      out.layout = JSON.parse(decoder.decode(bytes));
    } else if (lower.endsWith('_model.json')) {
      out.model = JSON.parse(decoder.decode(bytes));
    } else if (lower.endsWith('full.md')) {
      out.markdown = decoder.decode(bytes);
    } else if (lower.startsWith('images/')) {
      const ext = lower.split('.').pop() ?? '';
      const mime =
        ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'application/octet-stream';
      out.images[name] = new Blob([bytes as BlobPart], { type: mime });
    }
  }
  return out;
}

export function createMineruClient({ proxy, pollInterval = 5000, timeout = 900000 }: ClientOptions) {
  if (!proxy) throw new Error('必须提供 proxy 地址');
  const base = String(proxy).replace(/\/+$/, '');

  async function api(path: string, opts: { method?: string; body?: unknown } = {}) {
    const init: RequestInit = { method: opts.method ?? 'GET' };
    if (opts.body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(opts.body);
    }
    const res = await fetch(base + path, init);
    const textBody = await res.text();
    let data: any;
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

  async function uploadTo(fileOrBlob: Blob, signedUrl: string) {
    const buf = await fileOrBlob.arrayBuffer();
    // 注意 1：刻意不设 Content-Type —— OSS 签名是按空 Content-Type 算的
    const res = await fetch(`${base}/upload?to=${encodeURIComponent(signedUrl)}`, {
      method: 'PUT',
      body: buf,
    });
    // 注意 2：必须把响应体读掉。不读的话连接无法复用，浏览器回收时会报
    // net::ERR_ABORTED —— 功能上没出错，但控制台会留下假的失败记录，很误导。
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`上传失败 HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
  }

  async function downloadZip(zipUrl: string) {
    const res = await fetch(`${base}/download?to=${encodeURIComponent(zipUrl)}`);
    if (!res.ok) throw new Error(`结果包下载失败 HTTP ${res.status}`);
    return res.arrayBuffer();
  }

  async function pollBatch(batchId: string, onProgress?: ProgressHandler): Promise<string> {
    const t0 = Date.now();
    let last: string | null = null;
    for (;;) {
      const r = await api(`/api/v4/extract-results/batch/${batchId}`);
      const item = (r.data?.extract_result ?? [])[0];
      if (!item) throw new Error('批量结果为空');

      if (item.state === 'failed') {
        throw new Error(`解析失败: ${item.err_msg || '未知原因'}`);
      }
      if (item.state === 'done' && item.full_zip_url) {
        return item.full_zip_url as string;
      }
      if (item.state !== last) {
        last = item.state;
        onProgress?.('parsing', { state: item.state, progress: item.extract_progress });
      }
      if (Date.now() - t0 > timeout) {
        throw new Error(`等待超时（${Math.round(timeout / 1000)}s）`);
      }
      await sleep(pollInterval);
    }
  }

  const commonOptions = (extra: Record<string, unknown> = {}) => ({
    enable_formula: true,
    enable_table: true,
    language: 'ch',
    model_version: 'vlm',
    ...extra,
  });

  return {
    /** 解析本地文件（File / Blob）。数学试卷务必保持 isOcr = true。 */
    async parse(fileOrBlob: File | Blob, opts: ParseOptions = {}): Promise<ParseResult> {
      const { onProgress, isOcr = true, pageRanges = '' } = opts;
      const name = (fileOrBlob as File).name || 'upload.pdf';

      onProgress?.('submitting');
      const fileEntry: Record<string, unknown> = { name, is_ocr: isOcr };
      if (pageRanges) fileEntry.page_ranges = pageRanges;

      const r = await api('/api/v4/file-urls/batch', {
        method: 'POST',
        body: commonOptions({ files: [fileEntry] }),
      });
      const batchId = r.data.batch_id as string;
      const signedUrl = r.data.file_urls[0] as string;

      onProgress?.('uploading', { bytes: fileOrBlob.size });
      await uploadTo(fileOrBlob, signedUrl);

      const zipUrl = await pollBatch(batchId, onProgress);

      onProgress?.('downloading');
      const buf = await downloadZip(zipUrl);
      const files = await unzip(buf);

      onProgress?.('done');
      return packFiles(files);
    },

    /** 解析远端 URL（MinerU 服务器自己去拉，不需要上传） */
    async parseUrl(url: string, opts: ParseOptions = {}): Promise<ParseResult> {
      const { onProgress, isOcr = false, pageRanges = '' } = opts;

      onProgress?.('submitting');
      const payload: Record<string, unknown> = commonOptions({ url, is_ocr: isOcr });
      if (pageRanges) payload.page_ranges = pageRanges;

      const r = await api('/api/v4/extract/task', { method: 'POST', body: payload });
      const taskId = r.data.task_id as string;

      onProgress?.('parsing', { state: 'pending' });
      const t0 = Date.now();
      let zipUrl: string | null = null;
      let last: string | null = null;
      for (;;) {
        const q = await api(`/api/v4/extract/task/${taskId}`);
        const d = q.data ?? {};
        if (d.state === 'failed') throw new Error(`解析失败: ${d.err_msg || '未知原因'}`);
        if (d.state === 'done' && d.full_zip_url) {
          zipUrl = d.full_zip_url as string;
          break;
        }
        if (d.state !== last) {
          last = d.state;
          onProgress?.('parsing', { state: d.state, progress: d.extract_progress });
        }
        if (Date.now() - t0 > timeout) throw new Error('等待超时');
        await sleep(pollInterval);
      }

      onProgress?.('downloading');
      const buf = await downloadZip(zipUrl as string);
      const files = await unzip(buf);
      onProgress?.('done');
      return packFiles(files);
    },

    unzip,
  };
}
