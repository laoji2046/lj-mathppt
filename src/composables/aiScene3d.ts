/**
 * 「一句话 → 3D 场景」（v1438）—— 走 Rust 侧 ai_chat（DeepSeek），模型**只准回 JSON 数据**。
 *
 * 安全边界（沿用 applet3d.ts 的纪律，用户拍板「绝不让模型产出可执行代码」）：
 * 1. 模型产出的是**数据**（Scene3D），不是代码 → 先**白名单过滤 + 数值夹取**，再交给 iframe 里的解释器 ✓
 * 2. 拿到的是文本 → 先剥 markdown 代码块 → 再取第一个**配平**的 {...} → JSON.parse。
 *    解析失败就如实报错，**绝不 eval / 绝不 Function()** ✗
 * 3. 未知 kind、越界数值、奇怪颜色 一律丢弃或夹到安全值 ✗；对象数上限 40，防止模型画一屏乱麻 ✓
 */
import type { Scene3D, Scene3DObject } from './applet3d'

/** 给模型的系统提示：**只输出 JSON**，且字段就是 Scene3D 的白名单字段 */
export const SCENE3D_SYSTEM = [
  '你是高中数学「3D 立体几何」场景生成器。只输出一个 JSON 对象：不要解释、不要 markdown 代码块、不要注释。',
  'JSON 结构：{"title":"说明文字","axis":true,"spin":true,"dist":6,"objects":[ ... ]}',
  'objects 每项只能是下列之一（其他字段会被丢弃）：',
  '{"kind":"box","size":[长,宽,高],"at":[x,y,z],"color":"#5b8ff9","edges":true}',
  '{"kind":"sphere","r":半径,"at":[x,y,z],"color":"#5b8ff9","wire":false}',
  '{"kind":"cylinder","r":半径,"h":高,"at":[x,y,z],"color":"#5b8ff9","edges":true}',
  '{"kind":"cone","r":半径,"h":高,"at":[x,y,z],"color":"#5b8ff9"}',
  '{"kind":"plane","size":[宽,高],"at":[x,y,z],"rot":[rx,ry,rz],"color":"#5b8ff9","opacity":0.35}',
  '{"kind":"line","from":[x,y,z],"to":[x,y,z],"color":"#c0392b"}',
  '{"kind":"point","at":[x,y,z],"label":"A","color":"#c0392b"}',
  '硬性要求：',
  '1. 坐标系：原点在几何体中心，y 轴向上（和课本立体图一致）；整体尺寸不超过 4，相机距离恒为 6；',
  '2. 立体几何题：主体用 box / cylinder / cone 画（会自动半透明），**顶点用 point + label 标 A、B、C、D、A1、B1、C1、D1、P**，',
  '   棱和体对角线用 line 画（被遮挡的线也用 line，颜色用 #c0392b 强调）；',
  '3. 物体总数不超过 30 个；color 一律用 #rrggbb 形式；不要输出 HTML、代码、LaTeX 或多余字段；',
  '4. title 不超过 20 个汉字，说明画的是什么（例如「正方体 ABCD-A1B1C1D1 与体对角线 AC1」）。',
  '5. **顶点坐标必须和主体用同一套坐标**（两者算错一个就会出现「点和盒子对不上」✗）。',
  '   统一约定（照抄即可）：几何体**中心在原点**、棱长 2 ——',
  '   底面 A(-1,-1,-1) B(1,-1,-1) C(1,-1,1) D(-1,-1,1)，上面 A1(-1,1,-1) B1(1,1,-1) C1(1,1,1) D1(-1,1,1)，',
  '   主体 {"kind":"box","size":[2,2,2],"at":[0,0,0]}（这样 8 个顶点正好落在主体的 8 个顶点上 ✓）。',
  '范例（棱长 2 的正方体 + 体对角线 AC1）：',
  '{"title":"正方体 ABCD-A1B1C1D1 与体对角线 AC1","axis":true,"spin":true,"dist":8,"objects":[',
  '{"kind":"box","size":[2,2,2],"at":[0,0,0],"color":"#5b8ff9","edges":true},',
  '{"kind":"point","at":[-1,-1,-1],"label":"A"},{"kind":"point","at":[1,-1,-1],"label":"B"},',
  '{"kind":"point","at":[1,-1,1],"label":"C"},{"kind":"point","at":[-1,-1,1],"label":"D"},',
  '{"kind":"point","at":[-1,1,-1],"label":"A1"},{"kind":"point","at":[1,1,-1],"label":"B1"},',
  '{"kind":"point","at":[1,1,1],"label":"C1"},{"kind":"point","at":[-1,1,1],"label":"D1"},',
  '{"kind":"line","from":[-1,-1,-1],"to":[1,1,1],"color":"#c0392b"}]}',
].join('\n')

const HEX = /^#[0-9a-fA-F]{6}$/
/** 颜色兜底板（模型给怪色就按顺序取一个，别画成透明看不见 ✓） */
const PALETTE = ['#5b8ff9', '#c0392b', '#2f9e44', '#f08c00', '#7048e8']

function num(v: unknown, dflt: number, lo: number, hi: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n)) return dflt
  return Math.min(hi, Math.max(lo, n))
}
/** 取一个长度 n 的坐标数组；缺位补 dflt 的第 i 位。
 *  坐标一律夹到 ±10（相机距离 6，再大就跑到画面外了 ✗）；尺寸另用 size() 夹 ✓ */
function vec(v: unknown, dflt: number[], n: number, lo = -10, hi = 10): number[] {
  const a = Array.isArray(v) ? v : []
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(num(a[i], dflt[i] ?? 0, lo, hi))
  return out
}
/** 尺寸：别让模型画出 999（会糊满屏幕）✗，也别说 0（看不见）✗ */
function size(v: unknown, dflt: number[], n: number): number[] {
  return vec(v, dflt, n, 0.2, 10)
}
function color(v: unknown, i: number): string {
  return typeof v === 'string' && HEX.test(v.trim()) ? v.trim() : PALETTE[i % PALETTE.length]
}
function label(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim().slice(0, 8)
  return s || undefined
}

/** 把一个「长得像物体」的东西规整成白名单物体；认不出来返回 null（丢弃 ✓） */
function oneObject(raw: unknown, i: number): Scene3DObject | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const kind = String(o.kind || '').toLowerCase()
  const at = vec(o.at ?? o.center ?? o.pos, [0, 0, 0], 3)
  switch (kind) {
    case 'box': return { kind: 'box', size: size(o.size ?? o.dims, [2, 2, 2], 3) as [number, number, number], at, color: color(o.color, i), edges: o.edges !== false }
    case 'sphere': return { kind: 'sphere', r: Math.max(0.1, num(o.r ?? o.radius, 1, 0.1, 8)), at, color: color(o.color, i), wire: !!o.wire }
    case 'cylinder':
    case 'cone': {
      const r = Math.max(0.1, num(o.r ?? o.radius, 1, 0.1, 8))
      const h = Math.max(0.2, num(o.h ?? o.height, 2, 0.2, 12))
      return kind === 'cylinder'
        ? { kind: 'cylinder', r, h, at, color: color(o.color, i), edges: o.edges !== false }
        : { kind: 'cone', r, h, at, color: color(o.color, i) }
    }
    case 'plane': return { kind: 'plane', size: size(o.size ?? o.dims, [3, 3], 2) as [number, number], at, rot: vec(o.rot, [0, 0, 0], 3), color: color(o.color, i), opacity: num(o.opacity, 0.35, 0.05, 1) }
    case 'line': return { kind: 'line', from: vec(o.from ?? o.a, [0, 0, 0], 3), to: vec(o.to ?? o.b, [1, 0, 0], 3), color: color(o.color, i) }
    case 'point': return { kind: 'point', at, label: label(o.label ?? o.name), color: color(o.color, i) }
    default: return null
  }
}

/** 白名单过滤 + 夹取：**模型给什么都不能越界** ✓ */
export function sanitizeScene3d(raw: unknown): Scene3D {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const list = Array.isArray(src.objects) ? src.objects : []
  const objects: Scene3DObject[] = []
  list.slice(0, 40).forEach((o, i) => {
    const one = oneObject(o, i)
    if (one) objects.push(one)
  })
  if (!objects.length) objects.push(...defaultish())
  const title = typeof src.title === 'string' ? src.title.trim().slice(0, 40) : ''
  return {
    title,
    axis: src.axis !== false,
    spin: src.spin !== false,
    dist: num(src.dist, 6, 3, 20),
    objects,
  }
}
/** 模型啥也没给出来时的兜底：一个正方体（至少不是空白 ✗） */
function defaultish(): Scene3DObject[] {
  return [{ kind: 'box', size: [2, 2, 2], at: [0, 0, 1], color: '#5b8ff9', edges: true }]
}

/** 从模型返回的文本里取出第一个**配平**的 JSON 对象（字符串里的花括号不算 ✓） */
export function extractJsonObject(raw: string): string | '' {
  const s = String(raw || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '')
  const start = s.indexOf('{')
  if (start < 0) return ''
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return ''
}

/** 模型文本 → 场景（失败给 error，**不抛异常**，UI 直接显示 ✓） */
export function parseScene3d(raw: string): { scene?: Scene3D; error?: string } {
  const json = extractJsonObject(raw)
  if (!json) return { error: '模型没回 JSON（可能被拒答或网络返回了别的格式）' }
  let obj: unknown
  try {
    obj = JSON.parse(json)
  } catch (e) {
    return { error: 'JSON 解析失败：' + String((e as Error)?.message || e).slice(0, 80) + '；原文开头：' + json.slice(0, 80) }
  }
  const scene = sanitizeScene3d(obj)
  return { scene }
}
