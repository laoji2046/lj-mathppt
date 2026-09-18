/**
 * 语义切题层：MinerU 的 content_list.json -> 结构化题目对象数组
 *
 * 本文件是 mineru-poc/exam_parser.py 的一对一 TypeScript 移植，
 * 行为与 Python 版保持一致（可用同一份 content_list.json 交叉验证）。
 * 纯规则实现，不依赖任何第三方库，可在浏览器里跑。
 */

import type {
  Figure,
  LooseBlock,
  MineruElement,
  ParsedExam,
  Question,
  QuestionOption,
  QuestionType,
  Section,
} from './types';

/** 垂直间距超过这个值(px)且不是题号/小问，就认为是新块而不是上一题的续行 */
export const NEW_BLOCK_GAP = 25;

const QNUM_RE = /^(\d{1,2})\s*[.．、]\s*([\s\S]*)$/;
const SUBQ_RE = /^[（(]\s*(\d+)\s*[)）]\s*([\s\S]*)$/;
const BLANK_RE = /(\\_|＿|__)/;

/** Python str.strip(chars) 的等价实现 */
function stripChars(s: string, chars: string): string {
  const set = new Set(chars.split(''));
  let a = 0;
  let b = s.length;
  while (a < b && set.has(s[a])) a++;
  while (b > a && set.has(s[b - 1])) b--;
  return s.slice(a, b);
}

const stripPunct = (s: string) => stripChars(s.trim(), ' ,，;；');

/* ------------------------------------------------------------------ *
 * 公式边界修复
 * ------------------------------------------------------------------ */

/**
 * 把被吞进 $...$ 的选项标记吐出来。
 *
 * MinerU 常把紧跟公式的选项标签吸进公式，例如
 *   '$|z| = A.1$'  实际应为  '$|z| =$ A.1'
 */
export function fixFormulaBoundary(text: string): { text: string; fixed: string[] } {
  const fixed: string[] = [];
  const out = text.replace(/\$([^$]*)\$/g, (whole, inner: string) => {
    const m = /\s+([A-D][.．、][\s\S]*)$/.exec(inner);
    if (m) {
      const head = inner.slice(0, m.index).replace(/\s+$/, '');
      if (head) {
        fixed.push(inner);
        return `$${head}$ ${m[1]}`;
      }
    }
    return whole;
  });
  return { text: out, fixed };
}

/* ------------------------------------------------------------------ *
 * 选项拆分
 * ------------------------------------------------------------------ */

export interface OptMark {
  start: number;
  end: number;
  label: string;
}

/** 找出不在公式内部的选项标记位置 */
export function findOptionMarks(text: string): OptMark[] {
  const spans: Array<[number, number]> = [];
  for (const m of text.matchAll(/\$[^$]*\$/g)) {
    const i = m.index as number;
    spans.push([i, i + m[0].length]);
  }
  const inside = (i: number) => spans.some(([a, b]) => a <= i && i < b);

  const marks: OptMark[] = [];
  for (const m of text.matchAll(/[A-D][.．、]/g)) {
    const i = m.index as number;
    if (inside(i)) continue;
    const p = i - 1;
    // 前一个字符是字母/数字/反斜杠的话，说明不是选项标记（对齐 Python 的 isalnum 语义）
    if (p >= 0 && /[\p{L}\p{N}\\]/u.test(text[p])) continue;
    marks.push({ start: i, end: i + m[0].length, label: m[0][0] });
  }
  return marks;
}

/** 找最长的 A->B->C->D 有序序列 */
export function longestOrderedRun(marks: OptMark[]): OptMark[] {
  let best: OptMark[] = [];
  for (let i = 0; i < marks.length; i++) {
    const seq = [marks[i]];
    let nxt = String.fromCharCode(marks[i].label.charCodeAt(0) + 1);
    for (let j = i + 1; j < marks.length; j++) {
      if (marks[j].label === nxt) {
        seq.push(marks[j]);
        nxt = String.fromCharCode(nxt.charCodeAt(0) + 1);
        if (nxt > 'D') break;
      }
    }
    if (seq.length > best.length) best = seq;
  }
  return best;
}

export interface QuestionTextParts {
  stem: string;
  options: QuestionOption[];
  warnings: string[];
}

/** 把一段题干原文拆成 (题干, 选项列表, 警告列表) */
export function parseQuestionText(raw: string): QuestionTextParts {
  const warnings: string[] = [];
  const { text, fixed } = fixFormulaBoundary(raw);
  if (fixed.length) {
    warnings.push(`公式边界修复 ${fixed.length} 处，如 ${fixed[0].slice(0, 36)}`);
  }

  const marks = findOptionMarks(text);
  if (!marks.length) return { stem: text.trim(), options: [], warnings };

  const seq = longestOrderedRun(marks);
  const options: QuestionOption[] = [];

  if (seq.length && seq[0].label === 'A') {
    const stem = text.slice(0, seq[0].start).trim();
    for (let i = 0; i < seq.length; i++) {
      const end = i + 1 < seq.length ? seq[i + 1].start : text.length;
      options.push({ label: seq[i].label, content: stripPunct(text.slice(seq[i].end, end)) });
    }
    return { stem, options, warnings };
  }

  if (seq.length && seq[0].label === 'B') {
    // A 的标记被吞进公式了：把公式尾部的字母还回去
    const prefix = text.slice(0, seq[0].start);
    const mm = /\$([^$]*?)\s*([A-D])\$\s*([\s\S]+?)\s*$/.exec(prefix);
    if (mm) {
      const stem = `${prefix.slice(0, mm.index)}$${mm[1].replace(/\s+$/, '')}$`.trim();
      options.push({ label: 'A', content: stripPunct(mm[3]) });
      for (let i = 0; i < seq.length; i++) {
        const end = i + 1 < seq.length ? seq[i + 1].start : text.length;
        options.push({ label: seq[i].label, content: stripPunct(text.slice(seq[i].end, end)) });
      }
      warnings.push('选项 A 的标记被并入公式，已按位置还原，需人工核对');
      return { stem, options, warnings };
    }
    warnings.push('检测到 B/C/D 但定位不到 A，未拆分选项');
    return { stem: text.trim(), options: [], warnings };
  }

  warnings.push('选项标记不完整，未拆分');
  return { stem: text.trim(), options: [], warnings };
}

/* ------------------------------------------------------------------ *
 * 题型判定
 * ------------------------------------------------------------------ */

export function detectType(
  stem: string,
  options: QuestionOption[],
  subquestions: string[],
  sectionTitle: string,
): QuestionType {
  if (options.length) return 'choice';
  const joined = `${stem} ${subquestions.join(' ')}`;
  // 下划线可能被识别丢掉（尤其是文字层通道），所以大题标题也作为判据
  if (BLANK_RE.test(joined) || sectionTitle.includes('填空')) return 'blank';
  if (subquestions.length || sectionTitle.includes('解答')) return 'solution';
  return 'unknown';
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

interface RawQuestion {
  number: string;
  raw: string;
  page: number;
  bbox: number[];
  subquestions: string[];
  extra: string[];
  figures: Figure[];
  warnings: string[];
}

export function parseExam(elements: MineruElement[]): ParsedExam {
  let examTitle: string | null = null;
  const preamble: string[] = [];
  const sections: Section[] = [];
  const rawSections: Array<{ title: string; questions: RawQuestion[] }> = [];
  const looseBlocks: LooseBlock[] = [];

  let curSection: { title: string; questions: RawQuestion[] } | null = null;
  let curQ: RawQuestion | null = null;
  let prevBottom: number | null = null;

  for (const el of elements) {
    const etype = el.type;
    const bbox = el.bbox ?? [];
    const top = bbox.length === 4 ? bbox[1] : null;
    const bottom = bbox.length === 4 ? bbox[3] : null;
    const gap = top !== null && prevBottom !== null ? top - prevBottom : 0;
    if (bottom !== null) prevBottom = bottom;

    // ---- 图片 / 表格 ----
    if (etype === 'image' || etype === 'table') {
      const node: Figure = {
        type: etype,
        imgPath: el.img_path ?? '',
        bbox,
        page: el.page_idx ?? 0,
        caption: (etype === 'table' ? el.table_caption : el.image_caption) ?? [],
      };
      if (etype === 'table') node.tableBody = el.table_body ?? '';

      // 和文本一样按垂直间距判断：紧贴题干的是配图，隔得远的是独立块
      if (curQ && gap < NEW_BLOCK_GAP) {
        curQ.figures.push(node);
      } else {
        looseBlocks.push({
          type: etype,
          imgPath: node.imgPath,
          bbox,
          page: node.page,
          tableBody: node.tableBody,
          caption: node.caption,
        });
        curQ = null;
      }
      continue;
    }

    if (etype !== 'text') continue;

    const text = (el.text ?? '').trim();
    if (!text) continue;
    const lvl = el.text_level;
    const page = el.page_idx ?? 0;

    // ---- 标题层级 ----
    if (lvl === 1) {
      examTitle = text;
      continue;
    }
    if (lvl === 2) {
      curSection = { title: text, questions: [] };
      rawSections.push(curSection);
      curQ = null;
      continue;
    }

    // ---- 题号 ----
    const m = QNUM_RE.exec(text);
    if (m) {
      curQ = {
        number: m[1],
        raw: m[2],
        page,
        bbox,
        subquestions: [],
        extra: [],
        figures: [],
        warnings: [],
      };
      if (!curSection) {
        curSection = { title: '', questions: [] };
        rawSections.push(curSection);
      }
      curSection.questions.push(curQ);
      continue;
    }

    // ---- 小问 ----
    if (SUBQ_RE.test(text)) {
      if (curQ) {
        curQ.subquestions.push(text);
      } else {
        looseBlocks.push({ type: 'text', text, bbox, page });
      }
      continue;
    }

    // ---- 其它文本 ----
    if (curQ && gap < NEW_BLOCK_GAP) {
      curQ.extra.push(text);
    } else if (!rawSections.length) {
      preamble.push(text);
    } else {
      // 判定为游离块：同时断开与上一题的关联，
      // 否则后续紧邻的图/表会被误挂到上一题
      looseBlocks.push({ type: 'text', text, bbox, page });
      curQ = null;
    }
  }

  // ---- 后处理 ----
  for (const sec of rawSections) {
    const questions: Question[] = sec.questions.map((q) => {
      let raw = q.raw;
      if (q.extra.length) raw = `${raw} ${q.extra.join(' ')}`;
      const { stem, options, warnings } = parseQuestionText(raw);
      return {
        id: `q${q.number}`,
        number: q.number,
        type: detectType(stem, options, q.subquestions, sec.title),
        stem,
        options,
        subquestions: q.subquestions,
        figures: q.figures,
        page: q.page,
        bbox: q.bbox,
        warnings: [...q.warnings, ...warnings],
        status: 'pending' as const,
      };
    });
    if (questions.length) sections.push({ title: sec.title, questions });
  }

  return { examTitle, preamble, sections, looseBlocks };
}

/** 统计信息，用于界面上的概览 */
export function summarize(exam: ParsedExam) {
  const all = exam.sections.flatMap((s) => s.questions);
  const byType: Record<string, number> = {};
  for (const q of all) byType[q.type] = (byType[q.type] ?? 0) + 1;
  return {
    total: all.length,
    byType,
    withWarnings: all.filter((q) => q.warnings.length).length,
    confirmed: all.filter((q) => q.status === 'confirmed').length,
    all,
  };
}
