/**
 * 端到端验收：把转换器产出的 .md 交给**应用自己的导入器**（src/composables/mdDeck.ts），
 * 检查产出的 deck 是否正常 —— 光看 Markdown 文本不算验收，要过一遍真正的导入管线。
 *
 * 用法: node tools/docx/verify-import.mjs <文件.md> [...]
 * 退出码 0 = 全过。
 */
import fs from 'node:fs'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import path from 'node:path'

const files = process.argv.slice(2)
if (!files.length) {
  console.log('用法: node tools/docx/verify-import.mjs <文件.md>')
  process.exit(1)
}

await build({
  entryPoints: ['src/composables/mdDeck.ts'],
  bundle: true,
  format: 'cjs',
  outfile: '_tmp_verify.cjs',
  logLevel: 'silent',
  platform: 'node',
  alias: { '@': path.resolve('src') },
  external: ['vue', 'pinia'],
})
// 临时 bundle 写在**当前工作目录**（仓库根），所以按绝对路径 require，别用相对本文件的路径
const require = createRequire(path.resolve('_tmp_verify.cjs'))
const { markdownToDeck, deckToMarkdown } = require(path.resolve('_tmp_verify.cjs'))

let fail = 0
for (const file of files) {
  const md = fs.readFileSync(file, 'utf8')
  const deck = markdownToDeck(md)
  let oob = 0, overlap = 0, dollarPlain = 0, maxBottom = 0, maxCount = 0
  // 行内出现连续两个美元符会被应用的「显示公式」规则命中，**把该行剩下的文字整段吃掉** ——
  // 这类内容丢失最难发现（页面看着正常、只是少了几句），所以单独断言。
  // 注意：patch 脚本里用 String.replace 写这段时，替换串中的 $$ 会被当成「转义成一个 $」——
  // 本文件当初就是这么被写坏的，改用替换函数或字面量编辑才正确。
  const DD = '$' + '$'
  let doubleDollar = 0
  for (const line of md.split('\n')) {
    const t = line.trim()
    if (!t || t === '---') continue
    const whole = t.startsWith(DD) && t.endsWith(DD) && t.length > 4 && t.slice(2, -2).indexOf(DD) < 0
    if (!whole && t.indexOf(DD) >= 0) { doubleDollar++; if (doubleDollar <= 3) console.log('    ! 行内有连续美元符: ' + t.slice(0, 70)) }
  }
  const types = {}
  for (const s of deck.slides) {
    maxCount = Math.max(maxCount, s.elements.length)
    for (const e of s.elements) {
      types[e.type] = (types[e.type] || 0) + 1
      maxBottom = Math.max(maxBottom, e.y + e.h)
      if (e.y + e.h > 1080.5 || e.x + e.w > 1920.5) oob++
      if (e.type === 'text' && typeof e.text === 'string' && e.text.includes('$')) dollarPlain++
    }
    const boxes = s.elements.filter((e) => (e.type === 'text' || e.type === 'richtex') && e.h > 0)
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j]
      if (Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 2 && Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 2) overlap++
    }
  }
  const back = deckToMarkdown(deck).split('\n').filter((l) => l.trim()).length
  const src = md.split('\n').filter((l) => l.trim()).length
  const bad = oob || overlap || dollarPlain || doubleDollar
  if (bad) fail++
  console.log((bad ? '✗ ' : '✓ ') + path.basename(file) + ' → ' + deck.slides.length + ' 页 · ' + JSON.stringify(types))
  console.log('    单页最多 ' + maxCount + ' 元素 · 最大底边 ' + Math.round(maxBottom) + 'px · 越界 ' + oob + ' · 重叠 ' + overlap + ' · 纯文本残留 $ ' + dollarPlain + ' · 往返 ' + back + '/' + src + ' 行')
}
fs.unlinkSync('_tmp_verify.cjs')
console.log(fail === 0 ? '端到端验收通过' : fail + ' 个文件有问题')
process.exit(fail ? 1 : 0)
