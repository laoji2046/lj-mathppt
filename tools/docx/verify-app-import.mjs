/**
 * 端到端验收「应用内 Word 导入」：src/docx/*（浏览器侧模块）→ markdown → 应用自己的 mdDeck 导入器。
 * Node 18+ 自带 DecompressionStream / Blob / Response / btoa，所以浏览器模块能直接在 node 里跑。
 * 用法: node tools/docx/verify-app-import.mjs <文件.docx> [...]
 */
import fs from 'node:fs'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import path from 'node:path'

const files = process.argv.slice(2)
if (!files.length) { console.log('用法: node tools/docx/verify-app-import.mjs <文件.docx>'); process.exit(1) }

// esbuild 多入口必须用 outdir，所以这里现搭一个入口文件把两个模块都导出来（用完删掉）
const ENTRY = 'tools/docx/_tmp_app_entry.ts'
fs.writeFileSync(ENTRY, [
  "export { docxToMarkdown } from '../../src/docx/docxToMarkdown'",
  "export { markdownToDeck } from '../../src/composables/mdDeck'",
].join('\n'))
await build({
  entryPoints: [ENTRY],
  bundle: true, format: 'cjs', outfile: 'tools/docx/_tmp_app.cjs', logLevel: 'silent',
  platform: 'node', alias: { '@': path.resolve('src') }, external: ['vue', 'pinia'],
})
const require = createRequire(path.resolve('tools/docx/_tmp_app.cjs'))
const { docxToMarkdown } = require(path.resolve('tools/docx/_tmp_app.cjs'))
const { markdownToDeck } = require(path.resolve('tools/docx/_tmp_app.cjs'))

let fail = 0
for (const file of files) {
  const buf = new Uint8Array(fs.readFileSync(file))
  const t0 = Date.now()
  const { markdown, stats } = await docxToMarkdown(buf)
  const ms = Date.now() - t0
  const deck = markdownToDeck(markdown)
  let oob = 0, overlap = 0, dollarPlain = 0, dd = 0, dataUrls = 0
  const DD = String.fromCharCode(36, 36)
  for (const line of markdown.split('\n')) {
    const t = line.trim()
    if (!t || t === '---' || t.startsWith('<!--')) continue
    const whole = t.startsWith(DD) && t.endsWith(DD) && t.length > 4 && t.slice(2, -2).indexOf(DD) < 0
    if (!whole && t.indexOf(DD) >= 0) dd++
  }
  const types = {}
  for (const s of deck.slides) {
    for (const e of s.elements) {
      types[e.type] = (types[e.type] || 0) + 1
      if (e.y + e.h > 1080.5 || e.x + e.w > 1920.5) oob++
      if (e.type === 'image' && String(e.src).startsWith('data:image')) dataUrls++
      if (e.type === 'text' && typeof e.text === 'string' && e.text.includes('$')) dollarPlain++
    }
    const boxes = s.elements.filter((e) => (e.type === 'text' || e.type === 'richtex') && e.h > 0)
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j]
      if (Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 2 && Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 2) overlap++
    }
  }
  const bad = oob || overlap || dollarPlain || dd
  if (bad) fail++
  console.log((bad ? '✗ ' : '✓ ') + path.basename(file))
  console.log('   段落 ' + stats.paragraphs + ' · 公式 ' + stats.formulas + ' · 图 ' + stats.images + ' · 表格 ' + stats.tables + ' · 用时 ' + ms + 'ms')
  console.log('   → ' + deck.slides.length + ' 页 · ' + JSON.stringify(types) + ' · 内嵌图 ' + dataUrls)
  console.log('   越界 ' + oob + ' · 重叠 ' + overlap + ' · 残留美元符 ' + dollarPlain + ' · 行内双美元符 ' + dd)
}
fs.unlinkSync('tools/docx/_tmp_app.cjs')
fs.unlinkSync('tools/docx/_tmp_app_entry.ts')
console.log(fail === 0 ? '应用内导入链路通过' : fail + ' 个文件有问题')
process.exit(fail ? 1 : 0)