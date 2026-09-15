/**
 * 文字度量：估算折行数与所需高度 ✓
 *
 * 为什么单独一个文件 ✗：PPT 导入（pptxToDeck）和「统一风格」（templates/restyle）都要用它 ✓，
 * 但**不能让 restyle 去 import pptxToDeck** ✗ —— 那会把懒加载的导入器拖进启动包 ✓（实测过 1299→1076KB 的收益 ✓）。
 * 所以放这里，两边都从这里拿 ✓（一份实现 ✓）。
 */

/** 估算用的可见文本：把 \\(...\\) 公式折算成 3 个字符 ✓
 *  ⚠ 不能按 LaTeX 源码长度算 ✗ —— 实测一条公式源码 40+ 字符 ✓，渲染后只有几字符宽 ✓。 */
export function visibleText(s: string): string {
  const BS = String.fromCharCode(92)
  return String(s).split(BS + '(')
    .map((part, i) => (i === 0 ? part : '○○○' + part.slice(part.indexOf(BS + ')') + 2)))
    .join('')
}

/** 宽度单位：中日韩算 1、西文算 0.55 ✓（宁可略大 ✓） */
export function textUnits(s: string): number {
  let u = 0
  for (const ch of s) u += (ch.codePointAt(0) || 0) > 0x2e80 ? 1 : 0.55
  return u
}

/** 需要的行数（按框宽折行估算 ✓） */
export function estimateLines(text: string, fontSize: number, boxW: number): number {
  const perLine = Math.max(1, boxW / Math.max(1, fontSize))
  let lines = 0
  for (const para of String(text).split(String.fromCharCode(10))) {
    lines += Math.max(1, Math.ceil(textUnits(para) / perLine))
  }
  return Math.max(1, lines)
}

/**
 * 表格的**内容高度**估算 —— 必须和应用的渲染参数对齐 ✓：
 *   fontSize ✓、line-height **1.4** ✓、单元格 padding **6px** ✓、边框 1px ✓。
 * ⚠ 不要用 PPT 的 tr/@h 当元素高 ✗（PowerPoint 会拉伸行填满框 ✓，应用按内容紧凑渲染 ✓）。
 */
export function tableContentHeight(rows: string[][], colWidths: number[], fontSize: number): number {
  const pad = 6
  const BS = String.fromCharCode(92)
  let total = 0
  for (let r = 0; r < rows.length; r++) {
    let lines = 1
    let hasMath = false
    for (let c = 0; c < rows[r].length; c++) {
      const cw = colWidths[c] || Math.round(600 / (rows[r].length || 1))
      const raw = String(rows[r][c] || '')
      if (raw.indexOf(BS + '(') >= 0) hasMath = true
      lines = Math.max(lines, estimateLines(visibleText(raw), fontSize, Math.max(24, cw - 2 * pad)))
    }
    // ⚠ 含公式的行要高一些 ✗：MathJax 渲染的分式/根号比一行字高得多 ✓
    //   （应用自己的模板代码里也是这个口径：混排用 1.9、纯文字用 1.55 ✓ —— 这里跟着对齐 ✓）
    total += lines * fontSize * (hasMath ? 1.9 : 1.4) + pad * 2 + 1
  }
  return Math.round(total)
}

/** 文字块按新字号需要的**至少**高度 ✓（与应用渲染对齐：line-height 1.4 + 余量 ✓） */
export function textBlockHeight(text: string, fontSize: number, boxW: number, lineHeight = 1.4): number {
  const BS = String.fromCharCode(92)
  // 含公式 → 行高按 1.9 算 ✓（与模板的 isMix 口径一致 ✓，否则公式会被裁 ✓）
  const lh = String(text).indexOf(BS + '(') >= 0 ? 1.9 : lineHeight
  return Math.ceil(estimateLines(visibleText(text), fontSize, boxW) * fontSize * lh + fontSize * 0.35)
}