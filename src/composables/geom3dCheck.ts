/**
 * 【v1739】立体几何复刻的**确定性校验**（3D 版的"复刻核对" ✓）
 *
 * 为什么要有：立体复刻窗口现在靠"从二维投影反推三维"—— 这一步**有无穷多解**，只能用 AI ✓
 * 但 AI 给回来的结构**必须能被机器复核** ✓ 本模块就是那层复核（**不依赖任何模型** ✓）：
 *   ① 结构：顶点表在不在、坐标是不是有限数、有没有两点重合（退化 ✗）
 *   ② 面表：每面 ≥3 点 ✓ 引用的顶点都存在 ✓ **真的共面**（4 点以上要验法向残差 ✓）
 *   ③ 引用：辅助线 / 中分点 / 截面 / 平面 / 投影点 / 交线 / 隐藏表 里出现的顶点名都必须存在 ✓
 *   ④ 提示：孤立顶点（谁都不引用它 ✓）· 只有点线没有面 · 顶点/面太多（会糊 ✓）
 * 纯函数 ✓（探针盯着 ✓）；**只报不改** ✓ —— 拦不拦、改不改由老师决定 ✓
 */

/** 模型文本 → 结构（从"可能带 markdown 围栏"的文本里抠出第一个配平的 JSON 对象 ✓） */
export function parseGeom3dText(text: unknown): { model?: Record<string, unknown>; error?: string } {
  const s = String(text == null ? '' : text)
  const json = extractJsonObject(s)
  if (!json) return { error: '模型没回 JSON（原文开头：' + s.trim().slice(0, 80) + '）' }
  try {
    const obj = JSON.parse(json)
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { error: '回来的不是 JSON 对象' }
    return { model: obj as Record<string, unknown> }
  } catch (e) {
    return { error: 'JSON 解析失败：' + String((e as Error)?.message || e).slice(0, 80) }
  }
}

/** 取第一个**配平**的 {...}（字符串里的花括号不算 ✓）—— 与 aiScene3d 里那份同源 ✓ */
export function extractJsonObject(raw: string): string | '' {
  const s = String(raw || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '')
  const start = s.indexOf('{')
  if (start < 0) return ''
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const c = s.charAt(i)
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

export interface Geom3dCheck { errs: string[]; warns: string[]; verts: number; faces: number }

const num3 = (v: unknown): [number, number, number] | null => {
  if (!Array.isArray(v) || v.length < 3) return null
  const a = [Number(v[0]), Number(v[1]), Number(v[2])]
  return a.every((n) => Number.isFinite(n)) ? (a as [number, number, number]) : null
}
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x == null ? '' : x)).filter(Boolean) : [])
const objArr = (v: unknown): Record<string, unknown>[] =>
  (Array.isArray(v) ? v : []).filter((x) => !!x && typeof x === 'object') as Record<string, unknown>[]

/** 【v1739】确定性校验（纯函数 ✓ 探针盯着）—— errs 是真错、warns 是提示 ✓ */
export function geom3dIssues(raw: unknown): Geom3dCheck {
  const errs: string[] = []
  const warns: string[] = []
  const m = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const vertsRaw = (m.vertices && typeof m.vertices === 'object' ? m.vertices : {}) as Record<string, unknown>
  const verts: Record<string, [number, number, number]> = {}
  let bad = 0
  for (const k of Object.keys(vertsRaw)) {
    const name = String(k).trim()
    if (!name) { errs.push('有个顶点没有名字（空字符串 ✗）'); continue }
    if (verts[name]) { errs.push('顶点名重复：' + name + ' ✗'); continue }
    const p = num3(vertsRaw[k])
    if (!p) { bad++; continue }
    verts[name] = p
  }
  if (bad) errs.push('有 ' + bad + ' 个顶点坐标不是三个有限数（写错或漏了 ✗）')
  const prim = m.primitive && typeof m.primitive === 'object' ? (m.primitive as Record<string, unknown>) : null
  const vNames = Object.keys(verts)
  if (!vNames.length && !prim) errs.push('既没有 vertices 也没有 primitive —— 画不出东西 ✗')
  /* 退化：两点重合 */
  for (let i = 0; i < vNames.length; i++) {
    for (let j = i + 1; j < vNames.length; j++) {
      const a = verts[vNames[i]]
      const b = verts[vNames[j]]
      const d = Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)
      if (d < 1e-6) errs.push('顶点 ' + vNames[i] + ' 与 ' + vNames[j] + ' 重合（同一个点写了两次 ✗）')
    }
  }
  /* 尺度：算面共面容差用 */
  let scale = 1
  if (vNames.length) {
    let lo = [Infinity, Infinity, Infinity]
    let hi = [-Infinity, -Infinity, -Infinity]
    for (const n of vNames) {
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], verts[n][k]); hi[k] = Math.max(hi[k], verts[n][k]) }
    }
    scale = Math.max(1e-6, Math.sqrt((hi[0] - lo[0]) ** 2 + (hi[1] - lo[1]) ** 2 + (hi[2] - lo[2]) ** 2))
  }
  const tol = 0.02 * scale   // 2% 容差：模型把 √3 写成 1.732 也不会误报 ✓ 明显不共面才会报 ✓
  /* 面表 */
  const faceList: string[][] = (Array.isArray(m.faces) ? m.faces : []).map((f) => strArr(f)).filter((f) => f.length)
  let referenced = new Set<string>()
  faceList.forEach((f, i) => {
    if (f.length < 3) { errs.push('第 ' + (i + 1) + ' 个面只有 ' + f.length + ' 个顶点（至少 3 个 ✗）'); return }
    const miss = f.filter((n) => !verts[n])
    if (miss.length) { errs.push('第 ' + (i + 1) + ' 个面引用了不存在的顶点：' + miss.join('、') + ' ✗'); return }
    f.forEach((n) => referenced.add(n))
    if (f.length >= 4) {
      const p0 = verts[f[0]]
      const p1 = verts[f[1]]
      const p2 = verts[f[2]]
      const u: [number, number, number] = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]
      const v: [number, number, number] = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]]
      let n: [number, number, number] = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
      const nl = Math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2)
      if (nl < 1e-9) { errs.push('第 ' + (i + 1) + ' 个面的前三个点共线（定不出平面 ✗）'); return }
      n = [n[0] / nl, n[1] / nl, n[2] / nl]
      let worst = 0
      let worstName = ''
      for (const nm of f.slice(3)) {
        const p = verts[nm]
        const d = Math.abs((p[0] - p0[0]) * n[0] + (p[1] - p0[1]) * n[1] + (p[2] - p0[2]) * n[2])
        if (d > worst) { worst = d; worstName = nm }
      }
      if (worst > tol) {
        errs.push('第 ' + (i + 1) + ' 个面**不共面**：' + worstName + ' 离这个面 ' + worst.toFixed(3) + '（容差 ' + tol.toFixed(3) + ' ✗）—— 面表写错会让虚实线判错 ✓')
      }
    }
  })
  /* 棱表 */
  const edgeFields: [string, unknown][] = [['edges', m.edges], ['hiddenEdges', m.hiddenEdges]]
  for (const [field, val] of edgeFields) {
    objArr(val).forEach((e, i) => {
      const a = String(e[0] ?? e.a ?? '')
      const b = String(e[1] ?? e.b ?? '')
      const miss = [a, b].filter((n) => n && !verts[n])
      if (miss.length) errs.push(field + ' 第 ' + (i + 1) + ' 条引用了不存在的顶点：' + miss.join('、') + ' ✗')
      else { if (a) referenced.add(a); if (b) referenced.add(b) }
    })
    /* 数组形式 [a,b] 也认 ✓（上面 objArr 只挑对象 ✗ → 这里补一遍数组形式） */
    if (Array.isArray(val)) {
      ;(val as unknown[]).forEach((e, i) => {
        if (!Array.isArray(e)) return
        const a = String((e as unknown[])[0] ?? '')
        const b = String((e as unknown[])[1] ?? '')
        const miss = [a, b].filter((n) => n && !verts[n])
        if (miss.length) errs.push(field + ' 第 ' + (i + 1) + ' 条引用了不存在的顶点：' + miss.join('、') + ' ✗')
        else { if (a) referenced.add(a); if (b) referenced.add(b) }
      })
    }
  }
  /* 其余引用型字段 */
  const refFields: [string, (x: Record<string, unknown>) => string[]][] = [
    ['auxiliary', (x) => [String(x.from ?? ''), String(x.to ?? '')]],
    ['marks', (x) => [String(x.from ?? ''), String(x.to ?? '')]],
    ['cutPlanes', (x) => strArr(x.points)],
    ['planes', (x) => strArr(x.points)],
    ['projectPoints', (x) => [String(x.from ?? ''), ...strArr(x.plane)]],
    ['intersectLines', (x) => [...strArr(x.a), ...strArr(x.b)]],
    ['lineMeets', (x) => [...strArr(x.a), ...strArr(x.b)]],
    ['meetPoints', (x) => [String((x.line as Record<string, unknown>)?.a ?? ''), ...strArr(x.plane)]],
  ]
  for (const [field, get] of refFields) {
    objArr(m[field]).forEach((x, i) => {
      const names = get(x).filter((n) => /^[A-Za-z][A-Za-z0-9_]*$/.test(n))   // 只认像顶点名的 ✓ 别的（面/圆描述）不误报 ✗
      const miss = names.filter((n) => !verts[n])
      if (miss.length) errs.push(field + ' 第 ' + (i + 1) + ' 项引用了不存在的顶点：' + miss.join('、') + ' ✗')
      else names.forEach((n) => referenced.add(n))
    })
  }
  ;(Array.isArray(m.hidden) ? m.hidden : []).forEach((h) => {
    const n = String(h == null ? '' : h)
    if (/^[A-Za-z][A-Za-z0-9_]*$/.test(n) && verts[n]) referenced.add(n)
  })
  /* 提示 */
  const orphans = vNames.filter((n) => !referenced.has(n))
  if (orphans.length && faceList.length) warns.push('有 ' + orphans.length + ' 个顶点没被任何面/棱引用：' + orphans.slice(0, 8).join('、') + (orphans.length > 8 ? ' …' : '') + '（可能是漏写 ✓）')
  if (!faceList.length && !prim) warns.push('没有 faces 也没有 primitive —— 只会画出点与线（虚实线判不出来 ✓）')
  if (vNames.length > 60) warns.push('顶点太多（' + vNames.length + ' 个）—— 画面可能糊 ✗')
  if (faceList.length > 40) warns.push('面太多（' + faceList.length + ' 个）✓')
  /* primitive 合理性 */
  if (prim) {
    const r = Number(prim.r ?? prim.radius)
    const h = Number(prim.h ?? prim.height)
    if (Number.isFinite(r) && r <= 0) errs.push('primitive 的半径必须是正数（现在 ' + r + ' ✗）')
    if (Number.isFinite(h) && h <= 0) errs.push('primitive 的高必须是正数（现在 ' + h + ' ✗）')
    if (!Number.isFinite(r) && !Number.isFinite(h)) warns.push('primitive 没给 r / h（会走默认值 ✓）')
  }
  return { errs, warns, verts: vNames.length, faces: faceList.length }
}

/** 【v1739】给老师看的一段话 ✓（无问题就说"自检通过 ✓"✓） */
export function geom3dLines(res: Geom3dCheck): string[] {
  const out: string[] = []
  if (res.errs.length) out.push('⚠ 结构自检发现 ' + res.errs.length + ' 个问题（照这样画出来会错 ✗）：' + res.errs.slice(0, 6).join('；') + (res.errs.length > 6 ? ' …' : ''))
  else out.push('✓ 结构自检通过（顶点 ' + res.verts + ' 个、面 ' + res.faces + ' 个 ✓ 面都共面、引用都存在 ✓）')
  if (res.warns.length) out.push('· ' + res.warns.slice(0, 4).join('；'))
  return out
}
