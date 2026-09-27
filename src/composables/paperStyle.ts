/**
 * 【v1695】试卷段落样式的**闭合标签容错**（用户实报：改完颜色后每行后面都印出 {/c} ✗）
 *
 * 背景：试卷的段落样式是**行首前缀** —— \`{c:blue; b} 这段文字\` ✓，**没有闭合写法** ✗。
 *   但模型（和不少老师）按 HTML / LaTeX 的习惯会补一个 \`{/c}\` ✓ → 解析器不认 ✓ → **原样印在卷子上** ✗。
 * 口径：**渲染时静默丢弃**这类闭合标签 ✓（卷面干净最重要 ✓），
 *   同时把「没有闭合标签」写进 AI 手册与规则 ✓（见 STYLE_CLOSER_RULE ✓），从源头少产生 ✓。
 *
 * 纯函数、不碰 DOM → 探针直接测 ✓
 */

/** 多余的样式闭合标签：{/c}、{ /c }、{/c:blue}、{/b}、{/}（大小写不敏感 ✓） */
const CLOSER = /\{\s*\/\s*[a-zA-Z]*\s*(?::[^}]*)?\}/g

/** 去掉多余的样式闭合标签 ✓；返回新文本与去掉的个数 ✓（个数用来给一次提示 ✓） */
export function stripStyleClosers(text: string): { text: string; dropped: number } {
  const src = String(text == null ? '' : text)
  let dropped = 0
  const out = src.replace(CLOSER, () => { dropped++; return '' })
  // 去掉标签后可能留下行尾空白 ✓（不然卷面上会多出空格 ✗）；不动机器换行结构 ✓
  return { text: dropped ? out.replace(/[ \t]+$/gm, '') : src, dropped }
}

/** 写进 AI 手册 / 规则里的那句话（一处定义、两处引用 ✓ 免得两边说法漂移 ✗） */
export const STYLE_CLOSER_RULE =
  '段落样式是**行首前缀**、**没有闭合标签** ✗ —— 写成 {c:blue} 这段文字 就够了；'
  + '千万别补 {/c} / {/b} 之类（解析器不认，会**原样印在卷子上** ✗）'
