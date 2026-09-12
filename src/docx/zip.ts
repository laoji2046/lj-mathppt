/**
 * 浏览器侧 zip 读取（.docx 就是个 zip）。
 * 用原生 DecompressionStream('deflate-raw') 解压 —— Chromium / WebView2 都支持，不再依赖 node 的 zlib。
 * 只实现「列出条目 + 按名字读一个文件」，够读 docx 即可。
 */

export interface ZipEntry { name: string; method: number; compSize: number; size: number; offset: number }

export function listEntries(buf: Uint8Array): ZipEntry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  // 从尾部找 EOCD（可能带 zip 注释，从后往前扫）
  let eocd = -1
  const min = Math.max(0, buf.length - 66000)
  for (let i = buf.length - 22; i >= min; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是有效的 .docx（找不到 zip 结尾标记）')
  const count = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)
  const out: ZipEntry[] = []
  const dec = new TextDecoder()
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break
    const method = dv.getUint16(p + 10, true)
    const compSize = dv.getUint32(p + 20, true)
    const size = dv.getUint32(p + 24, true)
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const commentLen = dv.getUint16(p + 32, true)
    const offset = dv.getUint32(p + 42, true)
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen))
    out.push({ name, method, compSize, size, offset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

export async function readEntry(buf: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const p = entry.offset
  if (dv.getUint32(p, true) !== 0x04034b50) throw new Error('zip 局部头损坏：' + entry.name)
  const nameLen = dv.getUint16(p + 26, true)
  const extraLen = dv.getUint16(p + 28, true)
  const start = p + 30 + nameLen + extraLen
  const raw = buf.subarray(start, start + entry.compSize)
  if (entry.method === 0) return raw
  if (entry.method !== 8) throw new Error('不支持的压缩方式 ' + entry.method)
  const DS = (globalThis as any).DecompressionStream
  if (!DS) throw new Error('当前环境不支持解压 docx（需要 DecompressionStream）')
  const stream = new Blob([raw]).stream().pipeThrough(new DS('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function readText(buf: Uint8Array, name: string): Promise<string | null> {
  const e = listEntries(buf).find((x) => x.name === name)
  if (!e) return null
  return new TextDecoder().decode(await readEntry(buf, e))
}