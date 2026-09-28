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
import { hdChapterLabel, hdGuessBook, hdMainNo, hdSectionLabel, hdTocBook } from '@/composables/hdTextbook'
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
function paraKind(first: string): 'knowledge' | 'warn' | 'note' | 'summary' | 'method' | 'reflect' | 'para' {
  const t = first.replace(/[*_>\s【】\[\]]/g, '')
  if (/^(定义|性质|定理|公式|结论|法则|判定|注意|易错|提示)/.test(t)) {
    if (/^(注意|易错)/.test(t)) return 'warn'
    if (/^提示/.test(t)) return 'note'
    return 'knowledge'
  }
  if (/^(方法|技巧|口诀|规律)/.test(t)) return 'method'
  if (/^(反思|疑问|收获)/.test(t)) return 'reflect'
  return 'para'
}

/** 标题块的类型（例题 / 练习 / 变式 / 小结 ✓） */
function headKind(title: string): 'h1' | 'example' | 'exercise' | 'variant' | 'summary' | 'goal' | 'preview' | 'explore' | 'method' | 'homework' | 'reflect' | 'knowledge' | 'warn' | 'answer' {
  const t = title.replace(/\s/g, '')
  if (/目标/.test(t)) return 'goal'
  // 【v1713】那批真实讲义的栏目（必修二 15 讲）：情境导入 / 知识梳理 / 易错提醒 / 方法提炼 /
  //   课后巩固 / 参考答案与详解 / 素养达标自评 —— 以前全落成 h1 ✗（现在都有对应的块 ✓）
  if (/(情境|导入|引入)/.test(t)) return 'explore'
  if (/(探究|思考|观察|发现)/.test(t)) return 'explore'
  if (/(知识梳理|知识清单|必备知识|自主学习|知识回顾|考点整合)/.test(t)) return 'knowledge'
  if (/(典型例|例题|精讲|典例|母题|考点突破|热点题型)/.test(t)) return 'example'
  if (/变式/.test(t)) return 'variant'
  if (/(预习|课前|知识链接)/.test(t)) return 'preview'
  if (/(易错|错因|警示|提醒)/.test(t)) return 'warn'
  if (/(方法|技巧|规律|点拨|提炼)/.test(t)) return 'method'
  if (/(参考答案|答案与|参考解答|解析与)/.test(t)) return 'answer'
  if (/(反思|自评|疑问|收获|自我诊断)/.test(t)) return 'reflect'
  if (/(课后|作业|分层)/.test(t)) return 'homework'
  if (/(练习|检测|巩固|自测|达标|限时)/.test(t)) return 'exercise'
  // ⚠ 「复习引入」是**普通小节** ✗ —— 只有"本章小结 / 小结 / 总结 / 归纳小结"才算小结 ✓（老师那批 md 实测 ✓）
  if (/(小结|总结|归纳)/.test(t)) return 'summary'
  return 'h1'
}

/** 纯栏目名（没有正文信息 ✓）—— 命中就把标题**留空**（框自己会印「知识梳理」✓ 不再重复一遍 ✗） */
const HD_PURE_HEAD = /^(典型例题|例题精讲|例题|典例精讲|典例|知识梳理|知识清单|必备知识|易错提醒|易错警示|易错点|方法提炼|方法总结|方法点拨|学习目标|教学目标|情境导入|复习引入|导入|课后巩固|课后作业|课时作业|参考答案与详解|参考答案|答案与详解|素养达标自评|达标自评|当堂检测|当堂练习|课堂练习|随堂练习|课堂小结|本章小结|小结|变式训练|变式|探究思考|合作探究|课前预习|预习|自主学习|知识回顾)$/

/** 这些块「后面的正文要收进它自己」✓（与 useHandout 的框类型一致 ✓） */
const HD_ATTACH = ['goal', 'knowledge', 'warn', 'note', 'summary', 'method', 'reflect', 'preview', 'explore', 'homework', 'answer', 'solution', 'example', 'variant', 'exercise']

/** 栏目标题 → 块类型 + 该写什么正文（纯栏目名就留空 ✓） */
function headSpec(title: string): { kind: string; text: string; number: boolean; pure: boolean } {
  const raw = String(title == null ? '' : title).trim()
  const kind = headKind(raw)
  const bare = raw.replace(/[【】\s]/g, '')
  const pure = HD_PURE_HEAD.test(bare)
  return { kind, text: pure ? '' : raw, number: !pure, pure }
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
  /** 【v1713】一段正文 → 块：**整行只有图片**的拆成 figure 块（图注 = alt ✓）
   *   那批真实讲义图是 base64 内嵌（自包含 ✓）或 images/图注.png ✓ —— 以前留在正文里当文本印 ✗
   */
  const pushBody = (raw: string) => {
    const seg = String(raw == null ? '' : raw).split(String.fromCharCode(10))
    let text: string[] = []
    const flushText = () => {
      const t = text.join(String.fromCharCode(10)).trim()
      text = []
      if (!t) return
      const first = t.split(String.fromCharCode(10)).find((x) => x.trim()) || ''
      blocks.push(makeBlock(paraKind(first), t))
    }
    for (const ln of seg) {
      const m = /^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/.exec(ln)
      if (!m) { text.push(ln); continue }
      flushText()
      const fig = makeBlock('figure', '')
      fig.img = { src: m[2], caption: String(m[1] || '').trim(), layout: 'center' }
      blocks.push(fig)
    }
    flushText()
  }

  const flush = () => {
    const raw = buf.join('\n').trim()
    buf = []
    if (!raw) return
    if (attach) {
      // 【v1713】容器块收正文时，**整行的图 / 独立公式**要单独成块 ✓（被容器吞掉就看不见了 ✗ ——
      //   那批真实讲义的「## 【知识梳理】」下面紧跟 base64 图，实测会被吞 ✓）
      const seg = String(raw).split(String.fromCharCode(10))
      const keep: string[] = []
      for (const ln of seg) {
        const mi = /^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/.exec(ln)
        if (mi) {
          const fig = makeBlock("figure", "")
          fig.img = { src: mi[2], caption: String(mi[1] || "").trim(), layout: "center" }
          blocks.push(fig)
          continue
        }
        const mf = /^\s*\$\$(.+?)\$\$\s*$/.exec(ln)
        if (mf) { blocks.push(makeBlock("formula", mf[1].trim())); continue }
        keep.push(ln)
      }
      const body = keep.join(String.fromCharCode(10)).trim()
      if (body) attach.text = (String(attach.text || "").trim() ? String(attach.text).replace(/\n+$/, "") + String.fromCharCode(10) : "") + body
      return
    }

    pushBody(raw)   // 【v1713】整行只有图片的会拆成 figure 块 ✓
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
      const spec = headSpec(m[1])
      const nb = makeBlock(spec.kind === 'h1' ? 'h1' : (spec.kind as HdBlock['type']), spec.text)
      if (spec.kind === 'goal' && !spec.pure) nb.kbTitle = m[1].trim()
      if (!spec.number && (nb.type === 'example' || nb.type === 'variant' || nb.type === 'exercise')) nb.number = false
      blocks.push(nb)
      // 【v1713】容器块把**后面的正文收进它自己** ✓（原设计就是这么写的，但一直没接线 ✗ —— 那批真实讲义实测：
      //   「## 【知识梳理】」只得到一个空框、正文全散成 para 块 ✗）
      if (HD_ATTACH.indexOf(spec.kind) >= 0) attach = nb
      continue
    }
    m = /^###\s+(.*)$/.exec(t)
    if (m) { flush(); attach = null; blocks.push(makeBlock('h2', m[1].trim())); continue }
    if (/^>\s?/.test(t)) { flush(); buf.push(t.replace(/^>\s?/, '').replace(/\s+$/, '')); continue }
    buf.push(line)
  }
  flush()

  /** 【v1721】教材定位写成**带名字**的目录树口子：人教版 → 册 → 第 X 章 <章名> → 第 X 节 <节名> → 第 X 课时 ✓
   *  （章 / 节的**名字**从内置目录表查 ✓ 用户口径：要完整的讲义目录树 ✓）
   */
  const headText = String(text || '').slice(0, 500)
  const book = hdGuessBook(headText) || '必修一'
  const toc = hdTocBook('人教版', book)
  const chHit = toc ? toc.chapters.filter((c) => c.no === hdMainNo(chapter))[0] : undefined
  const seHit = chHit ? chHit.secs.filter((s) => s.no === hdMainNo(section))[0] : undefined
  const meta: HandoutMeta = {
    school: '', subject: '数学', title: '', subtitle: '', grade: '高一', teacher: '',
    date: new Date().toISOString().slice(0, 10),
    press: '人教版', book,
    chapter: chHit ? hdChapterLabel(chHit.no, chHit.name) : chapter,
    section: seHit ? hdSectionLabel(seHit.no, seHit.name) : section,
    period: section ? '1' : '',
    autoTitle: true,
  }

  /** 【v1720】md 里的 `# 标题` 就是**课题** ✓ 优先用它 —— 以前有节号时会被「人教版·必修一 第 1 章 第 1 节」盖掉 ✗
   *  （用户口径：抬头要写授课题目 ✓）✓ 自动标题只在 md 没写 # 标题时才用 ✓
   */
  if (h1Title) {
    meta.title = h1Title
    meta.autoTitle = false
  } else if (section) {
    meta.title = autoTitleOf({ meta, blocks } as never) || name
  } else {
    meta.autoTitle = false
    meta.title = name
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
/* ---------------- 【v1710】把一份 md 变成**当前讲义**能直接用的块 ---------------- */

/** 把正文按 $$…$$ 拆开（独立公式要单独成块 ✓） */
function splitFormula(t: string): { kind: 'text' | 'formula'; text: string }[] {
  const out: { kind: 'text' | 'formula'; text: string }[] = []
  const re = /\$\$([\s\S]+?)\$\$/g
  let last = 0
  let m: RegExpExecArray | null = null
  while ((m = re.exec(t))) {
    const pre = t.slice(last, m.index).trim()
    if (pre) out.push({ kind: 'text', text: pre })
    out.push({ kind: 'formula', text: m[1].trim() })
    last = m.index + m[0].length
  }
  const rest = t.slice(last).trim()
  if (rest) out.push({ kind: 'text', text: rest })
  return out.length ? out : [{ kind: 'text', text: t }]
}

/** 同类型的另一块（保留原块的显示口径 / 题库引用 / 知识底座标题 ✓） */
function sameKind(b: HdBlock, text: string): HdBlock {
  const nb = makeBlock(b.type, text)
  nb.render = { ...b.render }
  nb.ref = b.ref
  nb.kbTitle = b.kbTitle
  return nb
}

/**
 * 【v1710】一份 md → 讲义块（「导入 MD」与 AI 的 import_handout_markdown **共用这一个** ✓）
 *  · 解析与「讲义库」那套**完全一致**（mdToHandout ✓）：章节 / 目标 / 例题 / 变式 / 练习 / 小结 / 定义… 映射一样 ✓
 *  · 在这之上只补三件"进当前讲义"才有意义的事：
 *    ① `$$…$$` 独立公式 → **formula 块** ✓（讲义里独立公式有自己的块 ✓）
 *    ② `![alt](路径)` → 换成一行【图：alt】✗（本地路径读不到 ✓ 图请在讲义里重新插 ✓）
 *    ③ Markdown 表格 → 原样进正文 + 说明 ✓（讲义渲染暂不支持表格 ✓）
 */
export function mdBlocksOf(fileName: string, text: string): { blocks: HdBlock[]; title: string; notes: string[] } {
  const src = String(text == null ? '' : text).replace(/\r\n?/g, '\n')
  const { meta, blocks } = mdToHandout(fileName, src)
  const notes: string[] = []
  const out: HdBlock[] = []
  for (const b of blocks) {
    const t = String(b.text || '')
    if (b.type === 'para' || b.type === 'knowledge' || b.type === 'note' || b.type === 'warn') {
      const parts = splitFormula(t)
      if (parts.length > 1) {
        for (const p of parts) out.push(p.kind === 'formula' ? makeBlock('formula', p.text) : sameKind(b, p.text))
        continue
      }
    }
    out.push(b)
  }
  for (const b of out) {
    if (!b.text || b.text.indexOf('![') < 0) continue
    // 【v1713】图片已经在 mdToHandout 里拆成 figure 块 ✓ —— 这里只兜底处理**行内混排**的图片 ✓
    b.text = b.text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt, url) =>
      '<figure class="hd-fig hd-fig--inline"><img src="' + url + '" alt="' + String(alt || '') + '" />'
      + (String(alt || '').trim() ? '<figcaption>' + String(alt) + '</figcaption>' : '') + '</figure>')
  }
  if (/!\[[^\]]*\]\(/.test(src)) notes.push('md 里的图已插成**插图块**（图注 = 方括号里的字 ✓）：base64 内嵌的自包含 ✓；相对路径（images/x.png）按 exe 同级目录找 ✓ 找不到就是空图 ✗')
  if (/^\s*\|.*\|\s*$/m.test(src)) notes.push('md 里的竖线表已按**表格**渲染 ✓（旧版会印成「| … |」✗）')
  // 【v1710c】标题优先用 md 里的 # 标题 ✓（meta.title 是教材定位自动生成的口径 ✓ 库里那份不动 ✓）
  const h1 = (/^#\s+(.+)$/m.exec(src) || [])[1]
  const title = h1 ? String(h1).replace(/^§\s*/, '').trim() : String(meta.title || '')
  return { blocks: out, title, notes }
}

