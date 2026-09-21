/**
 * 【M2.10】把老师的 Markdown 讲义导成讲义库里的讲义 ✓
 *
 * 文件命名约定（teacher 目录就是这么起的 ✓）：<章>.<节>-<节名>.md ｜ <章>-<章名或小结>.md
 * 正文约定（老师那批 md 的实际写法 ✓）：
 *   # 标题              → 讲义标题
 *   ## 本节目标          → 「学习目标」块 ✓
 *   ## 一、复习引入      → 章级标题块（h1）✓
 *   ### 2.1 元素与集合   → 节级标题块（h2）✓
 *   > 引用               → 「提示」块 ✓
 *   **定义：** …         → 「知识梳理」块 ✓（性质 / 定理 / 公式 / 注意 同理 ✓）
 *   其余段落             → 正文块 ✓
 *   --- 分隔线忽略 ✓；表格原样留在正文里 ✓（讲义渲染暂不支持表格 ✓）
 */
import { hdDocText, hdFileName, hdFolderDir, hdFolderWrite } from '@/composables/useHandoutFolder'
import { autoTitleOf, folderFiles, hdId, lib, makeBlock } from '@/composables/useHandout'
import type { HdBlock, HdDoc, HandoutMeta } from '@/composables/useHandout'

/** 从文件名读 章 / 节 / 名字 ✓ */
export function parseMdName(fileName: string): { chapter: string; section: string; name: string } {
  const base = String(fileName || '').replace(/\.md$/i, '').trim()
  const m = /^(\d+)\s*[.\-—]\s*(\d+)\s*[-—]\s*(.+)$/.exec(base)
  if (m) return { chapter: m[1], section: m[2], name: m[3].trim() }
  const m2 = /^(\d+)\s*[-—]\s*(.+)$/.exec(base)
  if (m2) return { chapter: m2[1], section: '', name: m2[2].trim() }
  return { chapter: '', section: '', name: base }
}

/** 这一段的类型（看开头那几个字 ✓） */
function paraKind(first: string): 'knowledge' | 'warn' | 'note' | 'summary' | 'para' {
  const t = first.replace(/[*_>\s]/g, '')
  if (/^(定义|性质|定理|公式|结论|法则|判定|注意|易错|提示)/.test(t)) {
    if (/^(注意|易错)/.test(t)) return 'warn'
    if (/^提示/.test(t)) return 'note'
    return 'knowledge'
  }
  return 'para'
}

/** 标题块的类型（例题 / 练习 / 变式 / 小结 ✓） */
function headKind(title: string): 'h1' | 'example' | 'exercise' | 'variant' | 'summary' | 'goal' {
  const t = title.replace(/\s/g, '')
  if (/目标/.test(t)) return 'goal'
  if (/(例题|典型例|精讲)/.test(t)) return 'example'
  if (/变式/.test(t)) return 'variant'
  if (/(练习|作业|检测|巩固)/.test(t)) return 'exercise'
  // ⚠ 「复习引入」是**普通小节** ✗ —— 只有"本章小结 / 小结 / 总结 / 归纳小结"才算小结 ✓（老师那批 md 实测 ✓）
  if (/(小结|总结|归纳)/.test(t)) return 'summary'
  return 'h1'
}

/** 一个 md → 一份讲义（meta + blocks ✓） */
export function mdToHandout(fileName: string, text: string): { meta: HandoutMeta; blocks: HdBlock[] } {
  const { chapter, section, name } = parseMdName(fileName)
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
  const blocks: HdBlock[] = []
  let h1Title = ''
  let buf: string[] = []
  /** 【修】目标 / 例题 / 练习 / 小结 这类"容器标题"后面的正文要**收进它自己** ✓
   *  以前另起一个正文块 ✗ → 「学习目标」成了空框、内容游离在下面 ✗（老师那批 md 实测 ✓） */
  let attach: HdBlock | null = null
  const flush = () => {
    const raw = buf.join('\n').trim()
    buf = []
    if (!raw) return
    if (attach) { attach.text = (String(attach.text || '').trim() ? String(attach.text).replace(/\n+$/, '') + '\n' : '') + raw; return }
    const first = raw.split('\n').find((x) => x.trim()) || ''
    blocks.push(makeBlock(paraKind(first), raw))
  }
  for (const line of lines) {
    const t = line.trim()
    if (!t) { flush(); continue }
    if (/^-{3,}$/.test(t)) { flush(); continue }
    let m = /^#\s+(.*)$/.exec(t)
    if (m) { flush(); attach = null; h1Title = m[1].replace(/^§\s*/, '').trim(); continue }
    m = /^##\s+(.*)$/.exec(t)
    if (m) {
      flush()
      const kind = headKind(m[1])
      if (kind === 'goal') { const b = makeBlock('goal', ''); b.kbTitle = m[1].trim(); blocks.push(b) }
      else blocks.push(makeBlock(kind === 'h1' ? 'h1' : kind, m[1].trim()))
      continue
    }
    m = /^###\s+(.*)$/.exec(t)
    if (m) { flush(); attach = null; blocks.push(makeBlock('h2', m[1].trim())); continue }
    if (/^>\s?/.test(t)) { flush(); buf.push(t.replace(/^>\s?/, '').replace(/\s+$/, '')); continue }
    buf.push(line)
  }
  flush()

  const meta: HandoutMeta = {
    school: '', subject: '数学', title: '', subtitle: '', grade: '高一', teacher: '',
    date: new Date().toISOString().slice(0, 10),
    press: '人教版', book: '必修一', chapter, section,
    period: section ? '1' : '',
    autoTitle: true,
  }
  if (section) {
    meta.title = autoTitleOf({ meta, blocks } as never) || name
  } else {
    meta.autoTitle = false
    meta.title = h1Title || name
  }
  for (const b of blocks) if (b.type === 'goal' && !String(b.text || '').trim()) b.text = '（学习目标见 md 原文 ✓）'
  return { meta, blocks }
}

/** 批量导入（每份**直接写成库目录里的一个 .json** ✓ —— 老师要求「导入并保存」✓）
 *  【M4】写的是 **exe 同级的 LJ-讲义**（库跟着 exe 走 ✓），不再写 文档\LJ讲义 ✗ */
export async function importMdFiles(files: { name: string; text: string }[], writeFiles = true): Promise<{ added: number; titles: string[]; dir: string; failed: number }> {
  const titles: string[] = []
  let failed = 0
  const dir = writeFiles ? await hdFolderDir() : ''
  for (const f of files) {
    const { meta, blocks } = mdToHandout(f.name, f.text)
    const doc: HdDoc = { id: hdId(), updatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '), meta, blocks }
    titles.push(doc.meta.title || f.name)
    if (dir) {
      const r = await hdFolderWrite(hdFileName(doc.meta.title || f.name) + '.json', hdDocText(doc))
      if (r.ok) {
        doc.file = r.name
        if (doc.file) folderFiles.value = Array.from(new Set([...folderFiles.value, doc.file]))
      } else failed++
    }
    lib.value = [...lib.value, doc]      // ⚠ 写在 push **之前**：doc.file 才带得上 ✓
  }
  return { added: titles.length, titles, dir, failed }
}
