import type { TableMerge } from '@/types'

/**
 * 表格排版：把 rows（硬网格）+ merges（合并）算成"要渲染的格子列表"。
 *
 * **画布和导出必须共用这一份** —— 跨行跨列的算法如果各写一遍，迟早两边不一样
 *（v1229 图形那次就是这么栽的：renderer 里另写一份，缺了一半 kind，缩略图/演示全空白）。
 */

export interface TableCell {
  r: number
  c: number
  text: string
  /** 占几行 / 几列（≥1） */
  rs: number
  cs: number
  /** 是被别的合并格盖住的（不渲染） */
  covered: boolean
}

export interface TableLayout {
  cols: number
  rows: number
  /** 按行分组的**要渲染的**格子（已剔除被覆盖的） */
  grid: TableCell[][]
}

/** 归一化合并表：越界/重叠的一律丢弃，避免渲染出畸形表格 */
function normalizeMerges(merges: TableMerge[] | undefined, rowCount: number, colCount: number): TableMerge[] {
  if (!merges || !merges.length) return []
  const taken = new Set<string>()
  const out: TableMerge[] = []
  for (const m of merges) {
    const r = Math.max(0, Math.floor(m.r))
    const c = Math.max(0, Math.floor(m.c))
    const rs = Math.max(1, Math.floor(m.rs || 1))
    const cs = Math.max(1, Math.floor(m.cs || 1))
    if (r >= rowCount || c >= colCount) continue
    const rs2 = Math.min(rs, rowCount - r)
    const cs2 = Math.min(cs, colCount - c)
    if (rs2 < 1 || cs2 < 1) continue
    let clash = false
    for (let i = r; i < r + rs2 && !clash; i++) for (let j = c; j < c + cs2; j++) if (taken.has(i + ',' + j)) { clash = true; break }
    if (clash) continue
    for (let i = r; i < r + rs2; i++) for (let j = c; j < c + cs2; j++) taken.add(i + ',' + j)
    out.push({ r, c, rs: rs2, cs: cs2 })
  }
  return out
}

export function layoutTable(rows: string[][], merges?: TableMerge[]): TableLayout {
  const rowCount = rows.length
  const colCount = Math.max(1, ...rows.map((r) => r.length))
  const ms = normalizeMerges(merges, rowCount, colCount)
  const anchor = new Map<string, TableMerge>()
  const covered = new Set<string>()
  for (const m of ms) {
    anchor.set(m.r + ',' + m.c, m)
    for (let i = m.r; i < m.r + m.rs; i++) {
      for (let j = m.c; j < m.c + m.cs; j++) {
        if (i !== m.r || j !== m.c) covered.add(i + ',' + j)
      }
    }
  }
  const grid: TableCell[][] = []
  for (let r = 0; r < rowCount; r++) {
    const line: TableCell[] = []
    for (let c = 0; c < colCount; c++) {
      if (covered.has(r + ',' + c)) continue
      const m = anchor.get(r + ',' + c)
      line.push({
        r, c,
        text: rows[r]?.[c] ?? '',
        rs: m ? m.rs : 1,
        cs: m ? m.cs : 1,
        covered: false,
      })
    }
    grid.push(line)
  }
  return { cols: colCount, rows: rowCount, grid }
}

/** 在第 (r,c) 格上做一次合并操作（返回新的 merges，供属性面板/右键菜单用） */
export function mergeAt(rows: string[][], merges: TableMerge[] | undefined, r: number, c: number, dir: 'right' | 'down'): TableMerge[] {
  const L = layoutTable(rows, merges)
  const cell = L.grid[r]?.find((x) => x.c === c)
  if (!cell) return merges ? [...merges] : []
  const cur = anchorOf(L, r, c)
  const rs = cur ? cur.rs : 1
  const cs = cur ? cur.cs : 1
  const rest = (merges || []).filter((m) => !(m.r === (cur ? cur.r : r) && m.c === (cur ? cur.c : c)))
  if (dir === 'right') {
    if (c + cs >= L.cols) return merges ? [...merges] : []
    return [...rest, { r: cur ? cur.r : r, c: cur ? cur.c : c, rs, cs: cs + 1 }]
  }
  if (r + rs >= L.rows) return merges ? [...merges] : []
  return [...rest, { r: cur ? cur.r : r, c: cur ? cur.c : c, rs: rs + 1, cs }]
}

/** 取消 (r,c) 所在的合并 */
export function unmergeAt(merges: TableMerge[] | undefined, r: number, c: number): TableMerge[] {
  if (!merges || !merges.length) return []
  const hit = (merges || []).find((m) => r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs)
  return hit ? merges.filter((m) => m !== hit) : [...merges]
}

function anchorOf(L: TableLayout, r: number, c: number): TableMerge | null {
  for (const line of L.grid) for (const cell of line) {
    if (r >= cell.r && r < cell.r + cell.rs && c >= cell.c && c < cell.c + cell.cs) {
      return { r: cell.r, c: cell.c, rs: cell.rs, cs: cell.cs }
    }
  }
  return null
}
