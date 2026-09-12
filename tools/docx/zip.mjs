/**
 * 极简 ZIP 读取器（只读，够用即可）：docx / xlsx / pptx 都是 zip。
 * 不引第三方库 —— 项目离线可用，且这里只用得到「按名字取一个文件」。
 * 支持 stored(0) 与 deflate(8) 两种压缩方式（Office 用的就是这两个）。
 */
import zlib from 'node:zlib'

/** 从尾部找 EOCD（可能带 zip 注释，所以从后往前扫） */
function findEocd(buf) {
  const min = Math.max(0, buf.length - 66000)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i
  }
  return -1
}

/** 列出 zip 内所有条目：{ name, method, compSize, size, offset } */
export function listZip(buf) {
  const eocd = findEocd(buf)
  if (eocd < 0) throw new Error('不是有效的 zip / docx（找不到 EOCD）')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out = []
  // 中央目录：0x02014b50
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const size = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const offset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    out.push({ name, method, compSize, size, offset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** 取出某个条目的内容（Buffer） */
export function readZipEntry(buf, entry) {
  const p = entry.offset
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error('本地文件头损坏: ' + entry.name)
  const nameLen = buf.readUInt16LE(p + 26)
  const extraLen = buf.readUInt16LE(p + 28)
  const start = p + 30 + nameLen + extraLen
  const raw = buf.subarray(start, start + entry.compSize)
  if (entry.method === 0) return Buffer.from(raw)
  if (entry.method === 8) return zlib.inflateRawSync(raw)
  throw new Error('不支持的压缩方式 ' + entry.method + '（' + entry.name + '）')
}

/** 便捷函数：按名字读文本 */
export function readText(buf, name) {
  const e = listZip(buf).find((x) => x.name === name)
  if (!e) return null
  return readZipEntry(buf, e).toString('utf8')
}
