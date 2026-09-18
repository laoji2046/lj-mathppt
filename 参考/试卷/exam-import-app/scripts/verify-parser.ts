/**
 * 交叉验证：把 TS 切题层的输出写成与 Python 版相同的键名，
 * 便于用 Python 逐字段比对两者是否一致。
 *
 * 用法:
 *   node scripts/verify-parser.ts <content_list.json> <输出.json>
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { parseExam } from '../src/core/examParser';
import type { MineruElement } from '../src/core/types';

const [, , src, out] = process.argv;
if (!src || !out) {
  console.error('用法: verify-parser.ts <content_list.json> <输出.json>');
  process.exit(1);
}

const elements = JSON.parse(readFileSync(src, 'utf-8')) as MineruElement[];
const r = parseExam(elements);

// 转成与 exam_parser.py 完全一致的键名，方便逐字段 diff
const snake = {
  exam_title: r.examTitle,
  preamble: r.preamble,
  sections: r.sections.map((s) => ({
    title: s.title,
    questions: s.questions.map((q) => ({
      id: q.id,
      number: q.number,
      type: q.type,
      stem: q.stem,
      options: q.options,
      subquestions: q.subquestions,
      figures: q.figures.map((f) => {
        const o: Record<string, unknown> = {
          type: f.type,
          img_path: f.imgPath,
          bbox: f.bbox,
          page: f.page,
        };
        if (f.type === 'table') {
          o.table_body = f.tableBody ?? '';
          o.caption = f.caption;
        } else {
          o.caption = f.caption;
        }
        return o;
      }),
      page: q.page,
      bbox: q.bbox,
      warnings: q.warnings,
      status: q.status,
    })),
  })),
  loose_blocks: r.looseBlocks.map((b) => {
    const o: Record<string, unknown> = { type: b.type };
    if (b.type === 'text') {
      o.text = b.text ?? '';
    } else {
      o.img_path = b.imgPath ?? '';
    }
    o.bbox = b.bbox ?? [];
    o.page = b.page ?? 0;
    if (b.type === 'table') o.table_body = b.tableBody ?? '';
    if (b.type !== 'text') o.caption = b.caption ?? [];
    return o;
  }),
};

writeFileSync(out, JSON.stringify(snake, null, 2), 'utf-8');
console.log(`TS 切题层输出 -> ${out}`);
