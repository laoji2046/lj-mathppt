/**
 * 【优化】从 MinerU 产物缓存**重新拆答案**，补到库里缺答案的题上。
 *
 * 为什么需要：v1459 起**新导入**的卷会当场把卷尾答案区拆出来，但**以前导入的题不会自动回填**。
 * 缓存目录（%APPDATA%\lj-mathslides\mineru\<ms>\）里既有 content_list 也有 full.md，
 * 所以这件事**纯本地就能做**（不再调 MinerU API、不花钱、可重复跑 ✓）。
 *
 * 三条纪律：
 *   ① **只补不覆盖**（Rust 侧强制：已有 answer/solution 的题一律跳过，前端绕不过去 ✓）；
 *   ② 配对是**启发式**的（先整篇题干精确比、再前 30 字比），所以补上的答案都会带一条
 *      「答案从 MinerU 产物缓存重新拆出…请核对」的告警，校对表里逐题可改 ✓；
 *   ③ 只补题干能对上的题，对不上就**不动**（不猜 ✓）。
 */
import { invoke } from './useTauri'
import { assembleContentDoc } from './contentDoc'
import { parseAnyMarkdown } from './useQuestionImport'
import { metaOf, qSearch } from './useQuestionBank'
import type { QItem } from './useQuestionBank'

/** 一份产物缓存的概况（正文按需再取，免得一次传好几 MB ✓） */
export interface MineruCacheInfo { ms: string; jsonBytes?: number; mdBytes?: number }

export interface AnsCandidate {
  id: number
  code: string
  stem: string
  answer: string
  solution: string
  /** 缓存目录名（毫秒时间戳）—— 出问题好回查 ✓ */
  source: string
  /** exact = 题干整篇一致；prefix = 前 30 字一致（多半是识别差异），要更小心 ✓ */
  match: 'exact' | 'prefix'
}

export interface AnsScan {
  caches: number
  cachesWithAns: number
  answers: number
  questions: number
  missing: number
  candidates: AnsCandidate[]
}

const norm = (s: unknown) => String(s == null ? '' : s).replace(/\s+/g, '')

export async function mineruCaches(): Promise<MineruCacheInfo[]> {
  try {
    const r = await invoke<{ ok?: boolean; caches?: MineruCacheInfo[] }>('lib_mineru_caches')
    return (r && r.caches) || []
  } catch {
    return []
  }
}

export async function mineruCacheText(ms: string): Promise<{ contentJson: string; md: string }> {
  try {
    const r = await invoke<{ ok?: boolean; contentJson?: string; md?: string }>('lib_mineru_cache_text', { ms })
    return { contentJson: String((r && r.contentJson) || ''), md: String((r && r.md) || '') }
  } catch {
    return { contentJson: '', md: '' }
  }
}

export interface AnsApplyResult { ok: boolean; updated: number; skipped: number; backup: string; error?: string }

/** 把候选答案补进库（Rust 侧只补不覆盖 + 写前自动备份 ✓） */
export async function applyAnswerBackfill(items: AnsCandidate[]): Promise<AnsApplyResult> {
  try {
    const payload = items.map((c) => ({ id: c.id, answer: c.answer, solution: c.solution, source: c.source }))
    const r = await invoke<{ ok?: boolean; updated?: number; skipped?: number; backup?: string; error?: string }>(
      'lib_q_backfill_answers',
      { items: payload },
    )
    if (r && r.ok) return { ok: true, updated: r.updated || 0, skipped: r.skipped || 0, backup: String(r.backup || '') }
    return { ok: false, updated: 0, skipped: 0, backup: '', error: (r && r.error) || '补答案失败' }
  } catch (e) {
    return { ok: false, updated: 0, skipped: 0, backup: '', error: String((e as Error)?.message || e) }
  }
}

/** 扫所有产物缓存 → 建「题干 → 答案」索引 → 跟库里缺答案的题配对（对不上不动 ✓） */
export async function scanAnswerBackfill(onStep?: (done: number, total: number) => void): Promise<AnsScan> {
  const cs = await mineruCaches()
  const index = new Map<string, { a: string; s: string; src: string }>()
  let cachesWithAns = 0
  let answers = 0
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]
    try {
      const t = await mineruCacheText(c.ms)
      const doc = ((t.contentJson ? assembleContentDoc(t.contentJson) : '') || t.md || '').trim()
      if (doc) {
        const r = parseAnyMarkdown(doc)
        let n = 0
        for (const q of r.list) {
          if (!q.answer && !q.solution) continue
          const k = norm(q.stem)
          if (!k) continue
          // 同题干不覆盖先扫到的（缓存按时间倒序 = 先扫更新的那份 ✓）
          if (!index.has(k)) index.set(k, { a: q.answer || '', s: q.solution || '', src: c.ms })
          n++
        }
        if (n) { cachesWithAns += 1; answers += n }
      }
    } catch {
      /* 单份缓存坏了不影响别的 ✓ */
    }
    if (onStep) onStep(i + 1, cs.length)
  }
  const res = await qSearch({ limit: 2000 })
  const items = (res.items || []) as QItem[]
  const missing = items.filter((it) => {
    const m = metaOf(it)
    return !String(m.answer || '').trim() && !String(m.solution || '').trim()
  })
  const candidates: AnsCandidate[] = []
  for (const it of missing) {
    const m = metaOf(it)
    const stem = String(m.stem || it.body || it.title || '')
    const k = norm(stem)
    let hit = index.get(k)
    let match: 'exact' | 'prefix' = 'exact'
    if (!hit) {
      const pre = k.slice(0, 30)
      if (pre.length >= 12) {
        for (const [key, val] of index) {
          if (key.slice(0, 30) === pre) { hit = val; match = 'prefix'; break }
        }
      }
    }
    if (!hit) continue
    candidates.push({
      id: Number(it.id),
      code: String(it.code || ''),
      stem: stem.replace(/\s+/g, ' ').slice(0, 56),
      answer: hit.a,
      solution: hit.s,
      source: hit.src,
      match,
    })
  }
  return { caches: cs.length, cachesWithAns, answers, questions: items.length, missing: missing.length, candidates }
}
