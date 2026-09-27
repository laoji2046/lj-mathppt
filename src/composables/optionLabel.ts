/**
 * 【v1702】选项文本的**去重编号**（用户实报：AI 出的整卷里选项成了「A. A. $(1,3)$」✗）
 *
 * 为什么会重复：模型爱把选项给成对象 \`{"A": "(1,3)"}\` ✓ —— aiImport.normOptions 会**补上前缀**变成 \`"A. (1,3)"\` ✓；
 *   而写进试卷时排版又要加一次字母 ✗ → 就成了 \`A. A. (1,3)\` ✗。
 *
 * 口径：只去掉**与当前位置相符**的那个标签 ✓（第 0 个只去 A ✓、第 1 个只去 B ✓）——
 *   这样「A. 4」会被剥成「4」✓，而选项内容本身以别的前缀开头时**不会被误伤** ✗。
 *
 * 纯函数 → 探针直接测 ✓
 */
const LABELS = 'ABCDEFGH'

/** 去掉一个**与位置相符**的选项标签；不符就原样返回 ✓ */
export function stripOptionLabel(text: string, idx: number): string {
  const s = String(text == null ? '' : text)
  const want = LABELS[idx] || ''
  if (!want) return s.trim()
  const t = s.trim()
  // 认：A. / A． / A、 / A) / A） / （A） / (A) / 【A】 / A: / A： 后面跟空白（也可能紧跟内容 ✓）
  // ⚠ 这里只要**两个**反斜杠（JS 字符串里 \\s → 正则的 \s ✓）；写四个就成了"找反斜杠+s" ✗ 永不匹配（我自己踩过 ✓）
  const re = new RegExp('^(?:[（(【]?\\s*' + want + '\\s*[）)】]?\\s*[.．、:：)]?)\\s*(?=\\S)', 'i')
  const out = t.replace(re, '').trim()
  // 【v1702】剥完必须是**有内容**的（只剩下的标点不算 ✗）：像「A.」这种只有标签的空选项，保留原样 ✓
  return out && /[^\s.．、:：)）】]/.test(out) ? out : t
}

/** 给一排选项统一去重编号 ✓ */
export function stripOptionLabels(list: string[] | undefined): string[] {
  return (list || []).map((x, i) => stripOptionLabel(String(x), i))
}
