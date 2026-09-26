/**
 * 【v1673】离线序列号（用户要求：能发给任意老师、防随手复制；一个号两台电脑；永久有效）
 *
 * 怎么做到"不用服务器也能发号"：
 *  · **私钥只在老师的发号工具里**（.probe/_licgen.cjs ✓ 不进应用、不进仓库 ✓）；
 *  · **公钥编译进应用**（LICENSE_PUBLIC_KEY ✓）→ 应用离线验签 ✓，号伪造不出来 ✓；
 *  · 序列号里**写死最多两个机器码的哈希** ✓ → "一个号两台电脑"不用联网也能卡住 ✓
 *    （第三个机器码一来就对不上 ✓）。
 *
 * 用的算法是 WebView 与 Node 都自带的 ECDSA P-256（Web Crypto ✓）—— **不引入任何新依赖** ✓。
 * 纯逻辑（只吃字符串和字节 ✓）→ 探针能把边界全钉死：改一位、换个机器、伪造签名、空号、乱码 ✓。
 */
export const LICENSE_PUBLIC_KEY = 'BJJDYV4Td48IHSeljhzUVi/+s0B27LhpjPexyPHsFN+zZCkLxO1txkJaJOch5TWJbSnTPcHr5/TVY19kHj2I9nw='
export const LICENSE_PREFIX = 'LJMS-'
/** 没激活时锁住的功能（用户指定：数学图形 / AI 助手 / 讲义 / 试卷编辑 ✓） */
export const LICENSED_FEATURES = ['math-figure', 'ai-assistant', 'handout', 'paper-edit'] as const
export type LicensedFeature = (typeof LICENSED_FEATURES)[number]
/** 一个号最多几台电脑（用户要求 2 ✓） */
export const LICENSE_SEATS = 2

export interface LicenseInfo {
  /** 两个机器码哈希的十六进制（第二个没有时是空串） */
  machines: string[]
  /** 签发日 YYYY-MM-DD */
  issued: string
}

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'   // Crockford：去掉 I L O U，避免和 1 0 看混 ✓
const RAW_LEN = 16      // 正文：版本 1 + 机器数 1 + 日期 2 + 两个机器码哈希各 6
const HASH_LEN = 6
const SIG_LEN = 64

function b32encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}
function b32decode(s: string): Uint8Array | null {
  let bits = 0, value = 0
  const out: number[] = []
  for (const ch of s.toUpperCase()) {
    const i = B32.indexOf(ch)
    if (i < 0) return null
    value = (value << 5) | i
    bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return new Uint8Array(out)
}

/** 机器码 → 6 字节哈希（发号工具用**同一个**函数 ✓ 两边必须一致 ✓） */
export async function machineHash(code: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(String(code || '').trim())
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  return h.slice(0, HASH_LEN)
}

const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('')

/** 凑正文（发号工具与探针都用它 ✓，免得两边格式漂移 ✗） */
export async function serialBody(machineCodes: string[], when?: Date): Promise<Uint8Array> {
  const codes = machineCodes.map((c) => String(c || '').trim()).filter(Boolean).slice(0, LICENSE_SEATS)
  const d = when || new Date()
  const days = Math.max(0, Math.min(65535, Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2026, 0, 1)) / 86400000)))
  const body = new Uint8Array(RAW_LEN)
  body[0] = 1
  body[1] = codes.length
  body[2] = (days >> 8) & 255
  body[3] = days & 255
  for (let i = 0; i < codes.length; i++) {
    const h = await machineHash(codes[i])
    body.set(h, 4 + i * HASH_LEN)
  }
  return body
}

export function formatSerial(raw: string): string {
  const groups: string[] = []
  for (let i = 0; i < raw.length; i += 5) groups.push(raw.slice(i, i + 5))
  return LICENSE_PREFIX + groups.join('-')
}

/** 正文 + 签名 → 序列号字符串（发号工具与验号共用这一处 ✓ 免得两边格式漂移 ✗） */
export function encodeSerial(body: Uint8Array, sig: Uint8Array): string {
  const all = new Uint8Array(body.length + sig.length)
  all.set(body, 0)
  all.set(sig, body.length)
  return formatSerial(b32encode(all))
}

/** 去掉前缀与分隔符（老师粘贴时带空格/换行也认 ✓） */
export function normalizeSerial(text: string): string {
  return String(text || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^LJMS/, '')
}

/** 机器码是不是在本号里 ✓（纯函数 ✓ 探针直接测 ✓） */
export function bodyHasMachine(body: Uint8Array, h: Uint8Array): boolean {
  if (body.length < RAW_LEN) return false
  const n = Math.min(body[1], LICENSE_SEATS)
  const want = hex(h)
  for (let i = 0; i < n; i++) {
    if (hex(body.slice(4 + i * HASH_LEN, 4 + (i + 1) * HASH_LEN)) === want) return true
  }
  return false
}

/** 验号：签名 + 本机是否在名单里 ✓ */
export async function verifySerial(text: string, machineCode: string, now?: Date): Promise<{ ok: boolean; reason?: string; info?: LicenseInfo }> {
  const raw = normalizeSerial(text)
  if (!raw) return { ok: false, reason: '没填序列号' }
  const bytes = b32decode(raw)
  if (!bytes || bytes.length < RAW_LEN + SIG_LEN) return { ok: false, reason: '序列号格式不对（少了字符或前缀被删了）' }
  const body = bytes.slice(0, bytes.length - SIG_LEN)
  const sig = bytes.slice(bytes.length - SIG_LEN)
  if (body.length !== RAW_LEN) return { ok: false, reason: '序列号格式不对（长度不对）' }
  if (body[0] !== 1) return { ok: false, reason: '这个号是更新版本的软件发的，请升级应用' }
  let key: CryptoKey
  try {
    const pub = Uint8Array.from(atob(LICENSE_PUBLIC_KEY), (c) => c.charCodeAt(0))
    key = await crypto.subtle.importKey('raw', pub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  } catch {
    return { ok: false, reason: '应用内置公钥读不出来（这是程序的问题，请联系开发者）' }
  }
  let okSig = false
  try { okSig = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, body) } catch { okSig = false }
  if (!okSig) return { ok: false, reason: '序列号验不过：它被改过，或者不是本应用发的' }
  const h = await machineHash(machineCode)
  if (!bodyHasMachine(body, h)) {
    const n = Math.min(body[1], LICENSE_SEATS)
    return { ok: false, reason: '这个号不是发给这台电脑的（一号最多 ' + LICENSE_SEATS + ' 台，本号已登记 ' + n + ' 台）' }
  }
  const days = (body[2] << 8) | body[3]
  const issued = new Date(Date.UTC(2026, 0, 1) + days * 86400000)
  void now
  return { ok: true, info: { machines: [hex(body.slice(4, 4 + HASH_LEN))], issued: issued.toISOString().slice(0, 10) } }
}
