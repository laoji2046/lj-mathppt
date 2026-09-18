/**
 * 把「中文正文 + $LaTeX$ 混排」的字符串渲染成 HTML。
 * 只有 $...$ 之间的内容交给 KaTeX，其余部分做 HTML 转义。
 */

import katex from 'katex';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

export function renderMixed(text: string): string {
  if (!text) return '';
  const parts = text.split(/(\$[^$]*\$)/g);
  return parts
    .map((p) => {
      if (p.length >= 2 && p.startsWith('$') && p.endsWith('$')) {
        const tex = p.slice(1, -1);
        try {
          return katex.renderToString(tex, {
            throwOnError: false,
            output: 'html',
            strict: false,
          });
        } catch {
          return `<span style="color:#a32d2d">${escapeHtml(p)}</span>`;
        }
      }
      return escapeHtml(p).replace(/\n/g, '<br>');
    })
    .join('');
}

/** 供 v-html 使用 */
export function mixedHtml(text: string): { __html: string } {
  return { __html: renderMixed(text) };
}
