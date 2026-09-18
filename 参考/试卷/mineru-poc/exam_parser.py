#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
语义切题层：MinerU 的 content_list.json -> 结构化题目对象数组

纯规则实现，零依赖、零成本、零延迟。
只做结构性工作（切题 / 拆选项 / 归大题 / 修公式边界），
语义字段（知识点、难度、答案）留给下游模型或人工。

用法:
  python exam_parser.py out/exam_img/*_content_list.json
  python exam_parser.py out/exam_img/*_content_list.json -o questions.json
"""

import argparse
import json
import pathlib
import re
import sys
from collections import Counter

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

QNUM_RE = re.compile(r'^(\d{1,2})\s*[.．、]\s*(.*)$', re.S)
SUBQ_RE = re.compile(r'^[（(]\s*(\d+)\s*[)）]\s*(.*)$', re.S)
OPT_RE = re.compile(r'([A-D])[.．、]')
FORMULA_RE = re.compile(r'\$([^$]*)\$')
BLANK_RE = re.compile(r'(\\_|＿|__)')

# 垂直间距超过这个值(px)且不是题号/小问，就认为是新块而不是上一题的续行
NEW_BLOCK_GAP = 25


# --------------------------------------------------------------------------
# 公式边界修复
# --------------------------------------------------------------------------

def fix_formula_boundary(text):
    """把被吞进 $...$ 的选项标记吐出来。

    MinerU 常把紧跟公式的选项标签吸进公式，例如
        '$|z| = A.1$'  实际应为  '$|z| =$ A.1'
    返回 (修复后的文本, 被修复的片段列表)
    """
    fixed = []

    def repl(m):
        inner = m.group(1)
        mm = re.search(r'\s+([A-D][.．、].*)$', inner)
        if mm:
            head = inner[:mm.start()].rstrip()
            tail = mm.group(1)
            if head:
                fixed.append(inner)
                return '${}$ {}'.format(head, tail)
        return m.group(0)

    return FORMULA_RE.sub(repl, text), fixed


# --------------------------------------------------------------------------
# 选项拆分
# --------------------------------------------------------------------------

def find_option_marks(text):
    """找出不在公式内部的选项标记位置。"""
    spans = [(m.start(), m.end()) for m in FORMULA_RE.finditer(text)]

    def inside(i):
        return any(a <= i < b for a, b in spans)

    marks = []
    for m in OPT_RE.finditer(text):
        if inside(m.start()):
            continue
        p = m.start() - 1
        if p >= 0 and (text[p].isalnum() or text[p] == '\\'):
            continue
        marks.append(m)
    return marks


def longest_ordered_run(marks):
    """找最长的 A->B->C->D 有序序列。"""
    best = []
    for i in range(len(marks)):
        seq = [marks[i]]
        nxt = chr(ord(marks[i].group(1)) + 1)
        for j in range(i + 1, len(marks)):
            if marks[j].group(1) == nxt:
                seq.append(marks[j])
                nxt = chr(ord(nxt) + 1)
                if nxt > 'D':
                    break
        if len(seq) > len(best):
            best = seq
    return best


def parse_question_text(raw):
    """把一段题干原文拆成 (题干, 选项列表, 警告列表)。"""
    warnings = []
    text, fixed = fix_formula_boundary(raw)
    if fixed:
        warnings.append('公式边界修复 {} 处，如 {}'.format(len(fixed), fixed[0][:36]))

    marks = find_option_marks(text)
    if not marks:
        return text.strip(), [], warnings

    seq = longest_ordered_run(marks)
    options = []

    if seq and seq[0].group(1) == 'A':
        stem = text[:seq[0].start()].strip()
        for i, m in enumerate(seq):
            end = seq[i + 1].start() if i + 1 < len(seq) else len(text)
            content = text[m.end():end].strip().strip(' ,，;；')
            options.append({'label': m.group(1), 'content': content})
        return stem, options, warnings

    if seq and seq[0].group(1) == 'B':
        # A 的标记被吞进公式了：把公式尾部的字母还回去
        prefix = text[:seq[0].start()]
        mm = re.search(r'\$([^$]*?)\s*([A-D])\$\s*(.+?)\s*$', prefix, re.S)
        if mm:
            stem = (prefix[:mm.start()] + '$' + mm.group(1).rstrip() + '$').strip()
            options.append({'label': 'A',
                            'content': mm.group(3).strip().strip(' ,，;；')})
            for i, m in enumerate(seq):
                end = seq[i + 1].start() if i + 1 < len(seq) else len(text)
                content = text[m.end():end].strip().strip(' ,，;；')
                options.append({'label': m.group(1), 'content': content})
            warnings.append('选项 A 的标记被并入公式，已按位置还原，需人工核对')
            return stem, options, warnings

        warnings.append('检测到 B/C/D 但定位不到 A，未拆分选项')
        return text.strip(), [], warnings

    warnings.append('选项标记不完整，未拆分')
    return text.strip(), [], warnings


# --------------------------------------------------------------------------
# 题型判定
# --------------------------------------------------------------------------

def detect_type(stem, options, subquestions, section_title):
    if options:
        return 'choice'
    st = section_title or ''
    joined = stem + ' ' + ' '.join(subquestions)
    # 下划线可能被识别丢掉（尤其是文字层通道），所以大题标题也作为判据
    if BLANK_RE.search(joined) or '填空' in st:
        return 'blank'
    if subquestions or '解答' in st:
        return 'solution'
    return 'unknown'


# --------------------------------------------------------------------------
# 主流程
# --------------------------------------------------------------------------

def build(elements):
    exam_title = None
    preamble = []
    sections = []
    loose = []
    cur_section = None
    cur_q = None
    prev_bottom = None

    for el in elements:
        etype = el.get('type')
        bbox = el.get('bbox') or []
        top = bbox[1] if len(bbox) == 4 else None
        bottom = bbox[3] if len(bbox) == 4 else None
        gap = (top - prev_bottom) if (top is not None and prev_bottom is not None) else 0
        if bottom is not None:
            prev_bottom = bottom

        # ---- 图片 / 表格 ----
        if etype in ('image', 'table'):
            node = {
                'type': etype,
                'img_path': el.get('img_path', ''),
                'bbox': bbox,
                'page': el.get('page_idx', 0),
            }
            if etype == 'table':
                node['table_body'] = el.get('table_body', '')
                node['caption'] = el.get('table_caption') or []
            else:
                node['caption'] = el.get('image_caption') or []
            # 和文本一样按垂直间距判断：紧贴题干的是配图，隔得远的是独立块
            if cur_q is not None and gap < NEW_BLOCK_GAP:
                cur_q['figures'].append(node)
            else:
                loose.append(node)
                cur_q = None
            continue

        if etype != 'text':
            continue

        text = (el.get('text') or '').strip()
        if not text:
            continue
        lvl = el.get('text_level')
        base = {'page': el.get('page_idx', 0), 'bbox': bbox}

        # ---- 标题层级 ----
        if lvl == 1:
            exam_title = text
            continue
        if lvl == 2:
            cur_section = {'title': text, 'questions': []}
            sections.append(cur_section)
            cur_q = None
            continue

        # ---- 题号 ----
        m = QNUM_RE.match(text)
        if m:
            cur_q = {
                'number': m.group(1),
                'raw': m.group(2),
                'page': el.get('page_idx', 0),
                'bbox': bbox,
                'subquestions': [],
                'extra': [],
                'figures': [],
                'warnings': [],
            }
            if cur_section is None:
                cur_section = {'title': '', 'questions': []}
                sections.append(cur_section)
            cur_section['questions'].append(cur_q)
            continue

        # ---- 小问 ----
        if SUBQ_RE.match(text):
            if cur_q is not None:
                cur_q['subquestions'].append(text)
            else:
                loose.append(dict(node_type='text', text=text, **base))
            continue

        # ---- 其它文本 ----
        if cur_q is not None and gap < NEW_BLOCK_GAP:
            cur_q['extra'].append(text)
        elif cur_section is None and not sections:
            preamble.append(text)
        else:
            # 判定为游离块：同时断开与上一题的关联，
            # 否则后续紧邻的图/表会被误挂到上一题
            loose.append({'type': 'text', 'text': text, **base})
            cur_q = None

    # ---- 后处理 ----
    out_sections = []
    for sec in sections:
        qs = []
        for i, q in enumerate(sec['questions'], 1):
            raw = q['raw']
            if q['extra']:
                raw = raw + ' ' + ' '.join(q['extra'])
            stem, options, warns = parse_question_text(raw)
            qtype = detect_type(stem, options, q['subquestions'], sec['title'])
            qs.append({
                'id': 'q{}'.format(q['number']),
                'number': q['number'],
                'type': qtype,
                'stem': stem,
                'options': options,
                'subquestions': q['subquestions'],
                'figures': q['figures'],
                'page': q['page'],
                'bbox': q['bbox'],
                'warnings': q['warnings'] + warns,
                'status': 'pending',
            })
        if qs:
            out_sections.append({'title': sec['title'], 'questions': qs})

    return {
        'exam_title': exam_title,
        'preamble': preamble,
        'sections': out_sections,
        'loose_blocks': loose,
    }


# --------------------------------------------------------------------------
# 报告
# --------------------------------------------------------------------------

def report(result):
    print('试卷标题: {}'.format(result['exam_title']))
    if result['preamble']:
        print('卷首信息: {}'.format(' / '.join(result['preamble'])))

    total = 0
    warn = 0
    types = Counter()
    for sec in result['sections']:
        print('\n【{}】'.format(sec['title'] or '(无大题标题)'))
        for q in sec['questions']:
            total += 1
            types[q['type']] += 1
            if q['warnings']:
                warn += 1
            head = '{}. [{}] {}'.format(q['number'], q['type'], q['stem'][:58])
            print('  ' + head + ('…' if len(q['stem']) > 58 else ''))
            for o in q['options']:
                print('       {}. {}'.format(o['label'], o['content'][:56]))
            for s in q['subquestions']:
                print('       · {}'.format(s[:56]))
            for f in q['figures']:
                print('       [{}] {}'.format(f['type'], f['img_path']))
            for w in q['warnings']:
                print('       ! {}'.format(w))

    if result['loose_blocks']:
        print('\n【游离块】')
        for b in result['loose_blocks']:
            print('  [{}] {}'.format(b.get('type'), (b.get('text') or b.get('img_path', ''))[:60]))

    print('\n=== 统计 ===')
    print('  题目总数 {}'.format(total))
    print('  题型分布 {}'.format(dict(types)))
    print('  带警告 {} 题'.format(warn))


def main():
    ap = argparse.ArgumentParser(description='MinerU content_list.json -> 结构化题目')
    ap.add_argument('content_list', help='content_list.json 路径')
    ap.add_argument('-o', '--out', default='', help='输出 questions.json 路径')
    ap.add_argument('--json-only', action='store_true', help='只输出 JSON，不打印报告')
    args = ap.parse_args()

    src = pathlib.Path(args.content_list)

    # 允许直接传目录，自动找 content_list.json（省得记那串 hash 前缀）
    if src.is_dir():
        cands = sorted(p for p in src.glob('*_content_list.json')
                       if not p.name.endswith('_content_list_v2.json'))
        if not cands:
            print('[ERROR] 目录下找不到 *_content_list.json: {}'.format(src), file=sys.stderr)
            sys.exit(1)
        src = cands[0]

    if not src.exists():
        print('[ERROR] 文件不存在: {}'.format(src), file=sys.stderr)
        sys.exit(1)

    elements = json.loads(src.read_text(encoding='utf-8'))
    result = build(elements)

    out = pathlib.Path(args.out) if args.out else src.parent / 'questions.json'
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')

    if not args.json_only:
        report(result)
        print('\n-> {}'.format(out))


if __name__ == '__main__':
    main()
