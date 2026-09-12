/**
 * PowerPoint 风版式工厂（每套模板只定义槽位，颜色字体全来自主题 tokens）
 * 规矩：居中只出现在封面/章节页/结尾页；内容页一律左对齐 + 页眉细线 + 页码。
 * 正文含 $...$ 时自动用「混排元素(richtex)」——模板里只管写 $...$。
 */
import type { ImageElement, RichTextElement, ShapeElement, SlideElement, TextElement } from '@/types'
import { c, gridCell, type Theme } from './pptTheme'

export interface Canvas { width: number; height: number }
const CANVAS: Canvas = { width: 1920, height: 1080 }
function eid(): string { return 'el_' + Math.random().toString(36).slice(2, 10) }
interface Rect4 { x: number; y: number; w: number; h: number }
type Align = 'left' | 'center' | 'right'

function rect(r: Rect4, fill: string, radius = 0): ShapeElement {
  return { id: eid(), type: 'shape', shape: 'rect', x: r.x, y: r.y, w: r.w, h: r.h, rot: 0, fill, stroke: 'transparent', strokeWidth: 0, cornerRadius: radius } as ShapeElement
}
interface TextOpts extends Rect4 {
  text: string; fontSize: number; color: string;
  fontFamily?: string; fontWeight?: number; align?: Align; valign?: 'top' | 'middle' | 'bottom';
  lineHeight?: number; letterSpacing?: number;
}
function txt(o: TextOpts): TextElement {
  return {
    id: eid(), type: 'text', rot: 0, x: o.x, y: o.y, w: o.w, h: o.h, text: o.text,
    fontSize: o.fontSize, color: o.color, fontWeight: o.fontWeight ?? 400,
    align: o.align ?? 'left', fontFamily: o.fontFamily ?? 'sans',
    bgColor: 'transparent', shadow: 'none', valign: o.valign ?? 'top',
    lineHeight: o.lineHeight, letterSpacing: o.letterSpacing,
  } as TextElement
}
/** 混排元素：正文 + $...$ 内联公式（数学内容统一走它） */
function mixEl(o: TextOpts): RichTextElement {
  return {
    id: eid(), type: 'richtex', rot: 0, x: o.x, y: o.y, w: o.w, h: o.h, text: o.text,
    fontSize: o.fontSize, color: o.color, fontWeight: o.fontWeight ?? 400,
    align: o.align ?? 'left', fontFamily: o.fontFamily ?? 'sans',
    bgColor: 'transparent', shadow: 'none', wrap: true, fitMode: 'shrink',
  } as RichTextElement
}
/** 正文段落：含 $...$ 自动用混排，否则普通文本 */
function para(o: TextOpts): SlideElement { return /\$/.test(o.text) ? mixEl(o) : txt(o) }
/** 行数估算：中文 1 字宽、西文 0.55、公式按源码一半折算 */
function estLines(lines: string[], fs: number, w: number): number {
  const per = Math.max(8, w / fs)
  const units = (s: string) => {
    const marked = s.replace(/\$[^$]*\$/g, (m) => '\u0001'.repeat(Math.max(2, Math.round((m.length - 2) * 0.5))))
    let n = 0
    for (const ch of marked) {
      if (ch === '\u0001') n += 1
      else if (/[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/.test(ch)) n += 1
      else n += 0.55
    }
    return n
  }
  return lines.reduce((n, s) => n + Math.max(1, Math.ceil(units(s) / per)), 0)
}
/** 多行正文块：自动算高（混排 1.9 倍字号/行，普通文本 1.55 倍） */
interface BlockOpts { fontSize: number; color: string; fontFamily?: string; fontWeight?: number; align?: Align; pad?: number }
function blockHeight(lines: string[], w: number, o: BlockOpts): number {
  const isMix = /\$/.test(lines.join('\n'))
  return Math.round(estLines(lines, o.fontSize, w) * o.fontSize * (isMix ? 1.9 : 1.55)) + (o.pad ?? 10)
}
function block(x: number, y: number, w: number, lines: string[], o: BlockOpts): SlideElement {
  const h = blockHeight(lines, w, o);
  return para({ x, y, w, h, text: lines.join('\n'), fontSize: o.fontSize, color: o.color, fontFamily: o.fontFamily, fontWeight: o.fontWeight, align: o.align, valign: 'top' });
}
function image(r: Rect4, caption = ''): ImageElement {
  return { id: eid(), type: 'image', x: r.x, y: r.y, w: r.w, h: r.h, rot: 0, src: '', fit: 'contain', caption } as unknown as ImageElement
}
function header(t: Theme, cv: Canvas, eyebrow: string, brand: string): SlideElement[] {
  const col = c(t); const m = t.grid.margin;
  return [
    txt({ x: m, y: 26, w: cv.width / 2 - m, h: 34, text: eyebrow, fontSize: t.type.label, color: col.muted, fontFamily: t.fontTitle, fontWeight: 500 }),
    txt({ x: cv.width / 2, y: 26, w: cv.width / 2 - m, h: 34, text: brand, fontSize: t.type.label, color: col.muted, fontFamily: t.fontMono, align: 'right' }),
    rect({ x: m, y: 68, w: cv.width - m * 2, h: 1 }, col.line),
  ]
}
function pageNum(t: Theme, cv: Canvas, num: string): SlideElement {
  const m = t.grid.margin;
  return txt({ x: cv.width - m - 80, y: cv.height - m - 6, w: 80, h: 34, text: num, fontSize: t.type.label, color: c(t).muted, fontFamily: t.fontMono, align: 'right' });
}
function pageTitle(t: Theme, cv: Canvas, title: string): SlideElement[] {
  const col = c(t); const m = t.grid.margin;
  return [
    para({ x: m, y: 106, w: cv.width - m * 2 - 60, h: 76, text: title, fontSize: t.type.h1, color: col.text, fontFamily: t.fontTitle, fontWeight: 700, valign: 'top' }),
    rect({ x: m, y: 202, w: 64, h: 4 }, col.primary),
  ]
}
/** 内容页正文起始 y（页标题 106~206 之后） */
const BODY_TOP = 252

// ── 1 封面（左色块 + 标题；右侧底部作者/单位/日期）──────────────────────────
export interface CoverOpts { canvas?: Canvas; title: string; subtitle?: string; author?: string; unit?: string; date?: string }
export function cover(t: Theme, o: CoverOpts): SlideElement[] {
  const cv = o.canvas ?? CANVAS; const col = c(t); const m = t.grid.margin;
  const sideW = Math.round(cv.width * 0.38);
  const els: SlideElement[] = [
    rect({ x: 0, y: 0, w: sideW, h: cv.height }, col.primary),
    para({ x: m, y: Math.round(cv.height * 0.26), w: sideW - m * 2, h: 320, text: o.title, fontSize: t.type.display, color: '#FFFFFF', fontFamily: t.fontTitle, fontWeight: 700 }),
    rect({ x: m, y: Math.round(cv.height * 0.26) + 330, w: 96, h: 4 }, col.accent),
  ];
  if (o.subtitle) els.push(para({ x: m, y: Math.round(cv.height * 0.26) + 366, w: sideW - m * 2, h: 140, text: o.subtitle, fontSize: t.type.body, color: 'rgba(255,255,255,0.82)' }));
  const infoX = sideW + m; const infoW = cv.width - sideW - m * 2; let y = cv.height - 264;
  if (o.author) { els.push(txt({ x: infoX, y, w: infoW, h: 56, text: o.author, fontSize: t.type.h2, color: col.text, fontFamily: t.fontTitle, fontWeight: 700 })); y += 66 }
  if (o.unit) { els.push(txt({ x: infoX, y, w: infoW, h: 40, text: o.unit, fontSize: t.type.body, color: col.muted })); y += 54 }
  if (o.date) els.push(txt({ x: infoX, y, w: infoW, h: 40, text: o.date, fontSize: t.type.body, color: col.muted, fontFamily: t.fontMono }));
  return els;
}

// ── 2 目录 ──────────────────────────────────────────────────────────────────
export interface TocItem { no: string; title: string; page?: string }
export interface TocOpts { canvas?: Canvas; eyebrow?: string; brand?: string; pageNum?: string; items: TocItem[] }
export function toc(t: Theme, o: TocOpts): SlideElement[] {
  const cv = o.canvas ?? CANVAS; const col = c(t); const m = t.grid.margin;
  const els: SlideElement[] = header(t, cv, o.eyebrow ?? '', o.brand ?? '');
  els.push(para({ x: m, y: 118, w: 380, h: 120, text: '目　录', fontSize: t.type.display, color: col.primary, fontFamily: t.fontTitle, fontWeight: 700 }));
  els.push(txt({ x: m, y: 250, w: 380, h: 34, text: 'CONTENTS', fontSize: t.type.label, color: col.muted, fontFamily: t.fontMono, fontWeight: 500 }));
  const x = 560; const w = cv.width - x - m; const rowH = 96; const y0 = 138;
  o.items.forEach((it, i) => {
    const y = y0 + i * rowH;
    els.push(txt({ x, y, w: 84, h: 60, text: it.no, fontSize: t.type.h2, color: col.accent, fontFamily: t.fontMono, fontWeight: 700 }));
    els.push(para({ x: x + 104, y: y + 6, w: w - 230, h: 58, text: it.title, fontSize: t.type.h3, color: col.text, fontFamily: t.fontTitle, fontWeight: 600 }));
    if (it.page) els.push(txt({ x: x + w - 96, y: y + 14, w: 96, h: 48, text: 'P.' + it.page, fontSize: t.type.body, color: col.muted, fontFamily: t.fontMono, align: 'right' }));
    if (i < o.items.length - 1) els.push(rect({ x, y: y + rowH - 10, w, h: 1 }, col.line));
  });
  els.push(pageNum(t, cv, o.pageNum ?? '02'));
  return els;
}

// ── 3 章节过渡（居中：仅封面/章节页/结尾页允许）──────────────────────────────
export interface SectionOpts { canvas?: Canvas; no: string; title: string; subtitle?: string }
export function section(t: Theme, o: SectionOpts): SlideElement[] {
  const cv = o.canvas ?? CANVAS; const col = c(t); const cx = Math.round(cv.width / 2);
  const els: SlideElement[] = [
    rect({ x: cx - 30, y: 296, w: 60, h: 6 }, col.primary),
    txt({ x: 0, y: 332, w: cv.width, h: 296, text: o.no, fontSize: 260, color: col.primary, fontFamily: t.fontMono, fontWeight: 700, align: 'center', valign: 'middle' }),
    para({ x: 0, y: 654, w: cv.width, h: 110, text: o.title, fontSize: t.type.h1, color: col.text, fontFamily: t.fontTitle, fontWeight: 700, align: 'center' }),
  ];
  if (o.subtitle) els.push(para({ x: 0, y: 784, w: cv.width, h: 60, text: o.subtitle, fontSize: t.type.body, color: col.muted, align: 'center' }));
  return els;
}

// ── 4 要点页（主张 + 支撑；右侧可选速记卡）──────────────────────────────────
export interface Bullet { lead: string; support?: string }
export interface BulletsOpts { canvas?: Canvas; eyebrow?: string; brand?: string; pageNum?: string; title: string; bullets: Bullet[]; aside?: { title: string; lines: string[] } }
export function bullets(t: Theme, o: BulletsOpts): SlideElement[] {
  const cv = o.canvas ?? CANVAS; const col = c(t); const m = t.grid.margin;
  const els: SlideElement[] = [...header(t, cv, o.eyebrow ?? '', o.brand ?? ''), ...pageTitle(t, cv, o.title)];
  const w = o.aside ? gridCell(cv, t, 1, 8, 0, 0).w : gridCell(cv, t, 1, 12, 0, 0).w;
  let y = BODY_TOP;
  o.bullets.forEach((b) => {
    els.push(rect({ x: m, y: y + 16, w: 10, h: 10 }, col.primary));
    els.push(para({ x: m + 30, y, w: w - 30, h: 54, text: b.lead, fontSize: t.type.h3, color: col.text, fontFamily: t.fontTitle, fontWeight: 700 }));
    if (b.support) {
      const h = blockHeight([b.support], w - 30, { fontSize: t.type.body, color: col.muted });
      els.push(block(m + 30, y + 54, w - 30, [b.support], { fontSize: t.type.body, color: col.muted }));
      y += 54 + h + 22;
    } else y += 78;
  });
  if (o.aside) {
    const ax = gridCell(cv, t, 9, 4, 0, 0).x; const aw = gridCell(cv, t, 9, 4, 0, 0).w;
    const cardH = blockHeight(o.aside.lines, aw - 48, { fontSize: t.type.h3, color: col.text, pad: 60 });
    els.push(txt({ x: ax, y: BODY_TOP - 54, w: aw, h: 44, text: o.aside.title, fontSize: t.type.h3, color: col.primary, fontFamily: t.fontTitle, fontWeight: 700 }));
    els.push(rect({ x: ax, y: BODY_TOP, w: aw, h: cardH }, col.formulaBg, t.radius));
    els.push(block(ax + 24, BODY_TOP + 28, aw - 48, o.aside.lines, { fontSize: t.type.h3, color: col.text }));
  }
  els.push(pageNum(t, cv, o.pageNum ?? '03'));
  return els;
}

// ── 5 定义页（术语条 + 定义正文 + 注意）──────────────────────────────────────
export interface DefinitionOpts { canvas?: Canvas; eyebrow?: string; brand?: string; pageNum?: string; title: string; term: string; body: string[]; note?: string[] }
export function definition(t: Theme, o: DefinitionOpts): SlideElement[] {
  const cv = o.canvas ?? CANVAS; const col = c(t); const m = t.grid.margin;
  const els: SlideElement[] = [...header(t, cv, o.eyebrow ?? '', o.brand ?? ''), ...pageTitle(t, cv, o.title)];
  const full = gridCell(cv, t, 1, 12, 0, 0).w;
  els.push(rect({ x: m, y: BODY_TOP, w: full, h: 82 }, col.formulaBg, t.radius));
  els.push(rect({ x: m, y: BODY_TOP, w: 6, h: 82 }, col.primary));
  els.push(para({ x: m + 30, y: BODY_TOP + 18, w: full - 60, h: 52, text: o.term, fontSize: t.type.h2, color: col.text, fontFamily: t.fontTitle, fontWeight: 700 }));
  const bw = gridCell(cv, t, 1, 9, 0, 0).w;
  let y = BODY_TOP + 130;
  els.push(block(m, y, bw, o.body, { fontSize: t.type.body, color: col.text }));
  y += blockHeight(o.body, bw, { fontSize: t.type.body, color: col.text }) + 44;
  if (o.note && o.note.length) {
    els.push(rect({ x: m, y: y + 4, w: 4, h: 28 }, col.accent));
    els.push(txt({ x: m + 16, y, w: 80, h: 34, text: '注意', fontSize: t.type.small, color: col.accent, fontFamily: t.fontTitle, fontWeight: 700 }));
    els.push(block(m + 100, y - 4, bw - 100, o.note, { fontSize: t.type.small, color: col.muted }));
  }
  els.push(pageNum(t, cv, o.pageNum ?? '03'));
  return els;
}

// ── 6 定理页（定理名 + 陈述卡 + 证明思路 + 右侧图示位）────────────────────────
export interface TheoremOpts { canvas?: Canvas; eyebrow?: string; brand?: string; pageNum?: string; title: string; name: string; statement: string[]; proof?: string[]; figure?: string }
export function theorem(t: Theme, o: TheoremOpts): SlideElement[] {
  const cv = o.canvas ?? CANVAS; const col = c(t); const m = t.grid.margin;
  const els: SlideElement[] = [...header(t, cv, o.eyebrow ?? '', o.brand ?? ''), ...pageTitle(t, cv, o.title)];
  els.push(para({ x: m, y: BODY_TOP, w: 560, h: 48, text: o.name, fontSize: t.type.h2, color: col.primary, fontFamily: t.fontTitle, fontWeight: 700 }));
  const sw = o.figure ? gridCell(cv, t, 1, 7, 0, 0).w : gridCell(cv, t, 1, 12, 0, 0).w;
  const sh = blockHeight(o.statement, sw - 60, { fontSize: t.type.body, color: col.text, pad: 60 });
  els.push(rect({ x: m, y: BODY_TOP + 58, w: sw, h: sh }, col.formulaBg, t.radius));
  els.push(rect({ x: m, y: BODY_TOP + 58, w: 6, h: sh }, col.primary));
  els.push(block(m + 30, BODY_TOP + 86, sw - 60, o.statement, { fontSize: t.type.body, color: col.text }));
  if (o.proof && o.proof.length) {
    const y = BODY_TOP + 58 + sh + 40;
    els.push(txt({ x: m, y, w: 200, h: 34, text: '证明思路', fontSize: t.type.small, color: col.accent, fontFamily: t.fontTitle, fontWeight: 700 }));
    els.push(block(m, y + 42, sw, o.proof, { fontSize: t.type.small, color: col.muted }));
  }
  if (o.figure) {
    const g = gridCell(cv, t, 9, 4, BODY_TOP + 58, 400);
    els.push(rect({ x: g.x, y: g.y, w: g.w, h: g.h }, col.formulaBg, t.radius));
    els.push(txt({ x: g.x + 16, y: g.y + g.h - 44, w: g.w - 32, h: 34, text: o.figure, fontSize: t.type.label, color: col.muted, align: 'center' }));
  }
  els.push(pageNum(t, cv, o.pageNum ?? '03'));
  return els;
}

// ── 7 思考页（问题 + 提示 + 留白）────────────────────────────────────────────
export interface ThinkOpts { canvas?: Canvas; eyebrow?: string; brand?: string; pageNum?: string; title: string; question: string[]; hint?: string; note?: string }
export function think(t: Theme, o: ThinkOpts): SlideElement[] {
  const cv = o.canvas ?? CANVAS; const col = c(t); const m = t.grid.margin;
  const els: SlideElement[] = [...header(t, cv, o.eyebrow ?? '', o.brand ?? ''), ...pageTitle(t, cv, o.title)];
  const w = gridCell(cv, t, 1, 12, 0, 0).w;
  els.push(block(m, BODY_TOP, w, o.question, { fontSize: t.type.h2, color: col.text }));
  let y = BODY_TOP + blockHeight(o.question, w, { fontSize: t.type.h2, color: col.text }) + 34;
  if (o.hint) {
    const hh = blockHeight([o.hint], w - 150, { fontSize: t.type.body, color: col.primary, pad: 44 });
    els.push(rect({ x: m, y, w, h: hh }, col.formulaBg, t.radius));
    els.push(rect({ x: m, y, w: 6, h: hh }, col.accent));
    els.push(txt({ x: m + 26, y: y + 14, w: 90, h: 34, text: '提示', fontSize: t.type.small, color: col.accent, fontFamily: t.fontTitle, fontWeight: 700 }));
    els.push(block(m + 120, y + 8, w - 150, [o.hint], { fontSize: t.type.body, color: col.primary }));
    y += hh + 30;
  }
  const bh = Math.max(140, cv.height - m - 66 - y);
  els.push(rect({ x: m, y, w, h: bh }, '#FFFFFF'));
  els.push(rect({ x: m, y, w, h: 1 }, col.line));
  els.push(rect({ x: m, y: y + bh - 1, w, h: 1 }, col.line));
  els.push(txt({ x: m + 12, y: y + 12, w: w - 24, h: 34, text: o.note ?? '（留白：学生思考 / 板演）', fontSize: t.type.label, color: col.muted }));
  els.push(pageNum(t, cv, o.pageNum ?? '03'));
  return els;
}
// ── 8 推导页（编号步骤 + 结论条）────────────────────────────────────────────
export interface StepsOpts { canvas?: Canvas; eyebrow?: string; brand?: string; pageNum?: string; title: string; steps: string[]; conclusion?: string }
export function steps(t: Theme, o: StepsOpts): SlideElement[] {
  const cv = o.canvas ?? CANVAS; const col = c(t); const m = t.grid.margin;
  const els: SlideElement[] = [...header(t, cv, o.eyebrow ?? '', o.brand ?? ''), ...pageTitle(t, cv, o.title)];
  const w = gridCell(cv, t, 1, 11, 0, 0).w;
  let y = BODY_TOP;
  o.steps.forEach((s, i) => {
    const h = Math.max(46, blockHeight([s], w - 62, { fontSize: t.type.body, color: col.text }));
    els.push(rect({ x: m, y: y + 2, w: 38, h: 38 }, col.primary, 4));
    els.push(txt({ x: m, y: y + 5, w: 38, h: 32, text: String(i + 1), fontSize: t.type.small, color: '#FFFFFF', fontFamily: t.fontMono, fontWeight: 700, align: 'center' }));
    els.push(block(m + 62, y, w - 62, [s], { fontSize: t.type.body, color: col.text }));
    y += h + 24;
  });
  if (o.conclusion) {
    const h = blockHeight([o.conclusion], w - 60, { fontSize: t.type.h3, color: '#FFFFFF', pad: 48 });
    els.push(rect({ x: m, y, w, h }, col.primary, t.radius));
    els.push(block(m + 30, y + 22, w - 60, [o.conclusion], { fontSize: t.type.h3, color: '#FFFFFF' }));
  }
  els.push(pageNum(t, cv, o.pageNum ?? '03'));
  return els;
}

// ── 9 两栏对比（左 6 列 / 右 5 列，中间细线）────────────────────────────────
export interface ColSpec { title: string; lines: string[] }
export interface TwoColOpts { canvas?: Canvas; eyebrow?: string; brand?: string; pageNum?: string; title: string; left: ColSpec; right: ColSpec }
export function twoCol(t: Theme, o: TwoColOpts): SlideElement[] {
  const cv = o.canvas ?? CANVAS; const col = c(t);
  const els: SlideElement[] = [...header(t, cv, o.eyebrow ?? '', o.brand ?? ''), ...pageTitle(t, cv, o.title)];
  const l = gridCell(cv, t, 1, 6, BODY_TOP, 0); const r = gridCell(cv, t, 8, 5, BODY_TOP, 0);
  els.push(txt({ x: l.x, y: BODY_TOP, w: l.w, h: 46, text: o.left.title, fontSize: t.type.h3, color: col.primary, fontFamily: t.fontTitle, fontWeight: 700 }));
  els.push(block(l.x, BODY_TOP + 58, l.w, o.left.lines, { fontSize: t.type.body, color: col.text }));
  els.push(txt({ x: r.x, y: BODY_TOP, w: r.w, h: 46, text: o.right.title, fontSize: t.type.h3, color: col.primary, fontFamily: t.fontTitle, fontWeight: 700 }));
  els.push(block(r.x, BODY_TOP + 58, r.w, o.right.lines, { fontSize: t.type.body, color: col.text }));
  els.push(rect({ x: r.x - 60, y: BODY_TOP, w: 1, h: 520 }, col.line));
  els.push(pageNum(t, cv, o.pageNum ?? '03'));
  return els;
}

// ── 10 三卡（5:4:3 主次，禁止等宽三连）──────────────────────────────────────
export interface CardSpec { title: string; lines: string[] }
export interface CardsOpts { canvas?: Canvas; eyebrow?: string; brand?: string; pageNum?: string; title: string; cards: CardSpec[] }
export function cards(t: Theme, o: CardsOpts): SlideElement[] {
  const cv = o.canvas ?? CANVAS; const col = c(t);
  const els: SlideElement[] = [...header(t, cv, o.eyebrow ?? '', o.brand ?? ''), ...pageTitle(t, cv, o.title)];
  // 5:4:3 主次；列起点 1/6/10 —— 不能写成 1/7/10（第 2、3 卡会在第 10 列重叠）
  const spans = [5, 4, 3]; const cols = [1, 6, 10];
  o.cards.slice(0, 3).forEach((cd, i) => {
    const g = gridCell(cv, t, cols[i], spans[i], BODY_TOP, 520);
    els.push(rect({ x: g.x, y: g.y, w: g.w, h: g.h }, col.formulaBg, t.radius));
    els.push(rect({ x: g.x, y: g.y, w: g.w, h: 5 }, i === 0 ? col.primary : i === 1 ? col.accent : col.line));
    els.push(para({ x: g.x + 26, y: g.y + 30, w: g.w - 52, h: 48, text: cd.title, fontSize: t.type.h3, color: col.text, fontFamily: t.fontTitle, fontWeight: 700 }));
    els.push(block(g.x + 26, g.y + 90, g.w - 52, cd.lines, { fontSize: t.type.small, color: col.muted }));
  });
  els.push(pageNum(t, cv, o.pageNum ?? '03'));
  return els;
}

// ── 11 练习页（题目 + 留白 + 提示）────────────────────────────────────────────
export interface PracticeOpts { canvas?: Canvas; eyebrow?: string; brand?: string; pageNum?: string; title: string; items: string[]; hint?: string; note?: string }
export function practice(t: Theme, o: PracticeOpts): SlideElement[] {
  const cv = o.canvas ?? CANVAS; const col = c(t); const m = t.grid.margin;
  const els: SlideElement[] = [...header(t, cv, o.eyebrow ?? '', o.brand ?? ''), ...pageTitle(t, cv, o.title)];
  const w = gridCell(cv, t, 1, 11, 0, 0).w;
  const qh = blockHeight(o.items, w - 56, { fontSize: t.type.body, color: col.text, pad: 56 });
  els.push(rect({ x: m, y: BODY_TOP, w, h: qh }, col.formulaBg, t.radius));
  els.push(block(m + 28, BODY_TOP + 26, w - 56, o.items, { fontSize: t.type.body, color: col.text }));
  let y = BODY_TOP + qh + 30;
  if (o.hint) {
    const hh = blockHeight([o.hint], w - 130, { fontSize: t.type.small, color: col.accent, pad: 40 });
    els.push(rect({ x: m, y, w, h: hh }, col.formulaBg, t.radius));
    els.push(rect({ x: m, y, w: 6, h: hh }, col.accent));
    els.push(txt({ x: m + 24, y: y + 12, w: 84, h: 32, text: '答案', fontSize: t.type.small, color: col.accent, fontFamily: t.fontTitle, fontWeight: 700 }));
    els.push(block(m + 126, y + 6, w - 152, [o.hint], { fontSize: t.type.small, color: col.accent }));
    y += hh + 24;
  }
  const bh = Math.max(120, cv.height - m - 66 - y);
  els.push(rect({ x: m, y, w, h: bh }, '#FFFFFF'));
  els.push(rect({ x: m, y, w, h: 1 }, col.line));
  els.push(txt({ x: m + 12, y: y + 12, w: w - 24, h: 34, text: o.note ?? '（留白：板演 / 当堂练习）', fontSize: t.type.label, color: col.muted }));
  els.push(pageNum(t, cv, o.pageNum ?? '03'));
  return els;
}

// ── 12 易错页（错解 / 正解 上下两条）────────────────────────────────────────
export interface MistakeOpts { canvas?: Canvas; eyebrow?: string; brand?: string; pageNum?: string; title: string; wrong: string[]; right: string[] }
export function mistake(t: Theme, o: MistakeOpts): SlideElement[] {
  const cv = o.canvas ?? CANVAS; const col = c(t); const m = t.grid.margin;
  const els: SlideElement[] = [...header(t, cv, o.eyebrow ?? '', o.brand ?? ''), ...pageTitle(t, cv, o.title)];
  const w = gridCell(cv, t, 1, 11, 0, 0).w;
  const wh = blockHeight(o.wrong, w - 56, { fontSize: t.type.body, color: col.text, pad: 60 });
  els.push(rect({ x: m, y: BODY_TOP, w, h: wh }, col.formulaBg, t.radius));
  els.push(rect({ x: m, y: BODY_TOP, w: 6, h: wh }, col.accent));
  els.push(txt({ x: m + 26, y: BODY_TOP + 16, w: 200, h: 34, text: '常见错解', fontSize: t.type.small, color: col.accent, fontFamily: t.fontTitle, fontWeight: 700 }));
  els.push(block(m + 28, BODY_TOP + 56, w - 56, o.wrong, { fontSize: t.type.body, color: col.text }));
  const y2 = BODY_TOP + wh + 36;
  const rh = blockHeight(o.right, w - 56, { fontSize: t.type.body, color: col.text, pad: 60 });
  els.push(rect({ x: m, y: y2, w, h: rh }, col.formulaBg, t.radius));
  els.push(rect({ x: m, y: y2, w: 6, h: rh }, col.primary));
  els.push(txt({ x: m + 26, y: y2 + 16, w: 200, h: 34, text: '正确解法', fontSize: t.type.small, color: col.primary, fontFamily: t.fontTitle, fontWeight: 700 }));
  els.push(block(m + 28, y2 + 56, w - 56, o.right, { fontSize: t.type.body, color: col.text }));
  els.push(pageNum(t, cv, o.pageNum ?? '03'));
  return els;
}


// ── 13 小结页（要点回收 + 核心句条）──────────────────────────────────────────
export interface SummaryOpts { canvas?: Canvas; eyebrow?: string; brand?: string; pageNum?: string; title: string; points: string[]; core?: string }
export function summary(t: Theme, o: SummaryOpts): SlideElement[] {
  const cv = o.canvas ?? CANVAS; const col = c(t); const m = t.grid.margin;
  const els: SlideElement[] = [...header(t, cv, o.eyebrow ?? '', o.brand ?? ''), ...pageTitle(t, cv, o.title)];
  const w = gridCell(cv, t, 1, 11, 0, 0).w;
  let y = BODY_TOP;
  o.points.forEach((s) => {
    const h = Math.max(44, blockHeight([s], w - 30, { fontSize: t.type.body, color: col.text }));
    els.push(rect({ x: m, y: y + 16, w: 10, h: 10 }, col.primary));
    els.push(block(m + 30, y, w - 30, [s], { fontSize: t.type.body, color: col.text }));
    y += h + 18;
  });
  if (o.core) {
    const h = blockHeight([o.core], w - 60, { fontSize: t.type.h3, color: '#FFFFFF', pad: 50 });
    els.push(rect({ x: m, y: y + 14, w, h }, col.primary, t.radius));
    els.push(block(m + 30, y + 36, w - 60, [o.core], { fontSize: t.type.h3, color: '#FFFFFF' }));
  }
  els.push(pageNum(t, cv, o.pageNum ?? '03'));
  return els;
}

// ── 14 图文页（左文右图）────────────────────────────────────────────────────
export interface ImageRightOpts { canvas?: Canvas; eyebrow?: string; brand?: string; pageNum?: string; title: string; lines: string[]; caption?: string }
export function imageRight(t: Theme, o: ImageRightOpts): SlideElement[] {
  const cv = o.canvas ?? CANVAS; const col = c(t);
  const els: SlideElement[] = [...header(t, cv, o.eyebrow ?? '', o.brand ?? ''), ...pageTitle(t, cv, o.title)];
  const l = gridCell(cv, t, 1, 5, BODY_TOP, 0);
  els.push(block(l.x, BODY_TOP, l.w, o.lines, { fontSize: t.type.body, color: col.text }));
  const g = gridCell(cv, t, 7, 6, BODY_TOP, 520);
  els.push(rect({ x: g.x, y: g.y, w: g.w, h: g.h }, col.formulaBg, t.radius));
  els.push(image({ x: g.x + 24, y: g.y + 24, w: g.w - 48, h: g.h - 72 }, o.caption ?? ''));
  els.push(txt({ x: g.x + 16, y: g.y + g.h - 44, w: g.w - 32, h: 34, text: o.caption ?? '图：示意（可拖入图片 / 数学图形 / GeoGebra）', fontSize: t.type.label, color: col.muted, align: 'center' }));
  els.push(pageNum(t, cv, o.pageNum ?? '03'));
  return els;
}

// ── 15 数据页（左柱状骨架图 + 右结论）────────────────────────────────────────
export interface ChartOpts { canvas?: Canvas; eyebrow?: string; brand?: string; pageNum?: string; title: string; bars: { label: string; value: number }[]; lines: string[]; chartTitle?: string }
export function chart(t: Theme, o: ChartOpts): SlideElement[] {
  const cv = o.canvas ?? CANVAS; const col = c(t);
  const els: SlideElement[] = [...header(t, cv, o.eyebrow ?? '', o.brand ?? ''), ...pageTitle(t, cv, o.title)];
  const g = gridCell(cv, t, 1, 7, BODY_TOP, 520);
  els.push(txt({ x: g.x, y: g.y, w: g.w, h: 40, text: o.chartTitle ?? '', fontSize: t.type.small, color: col.muted }));
  const baseY = g.y + g.h - 56; const max = Math.max(1, ...o.bars.map((x) => x.value));
  els.push(rect({ x: g.x, y: baseY, w: g.w, h: 1 }, col.line));
  const n = Math.max(1, o.bars.length); const slot = g.w / n; const bw = Math.min(84, slot * 0.5);
  o.bars.forEach((bar, i) => {
    const h = Math.round((g.h - 130) * (bar.value / max));
    const bx = Math.round(g.x + slot * i + (slot - bw) / 2);
    els.push(rect({ x: bx, y: baseY - h, w: Math.round(bw), h }, i === 0 ? col.primary : col.accent));
    els.push(txt({ x: Math.round(g.x + slot * i), y: baseY + 10, w: Math.round(slot), h: 34, text: bar.label, fontSize: t.type.label, color: col.muted, align: 'center' }));
  });
  const g2 = gridCell(cv, t, 9, 4, BODY_TOP, 0);
  els.push(txt({ x: g2.x, y: g2.y, w: g2.w, h: 44, text: '结论', fontSize: t.type.h3, color: col.primary, fontFamily: t.fontTitle, fontWeight: 700 }));
  els.push(block(g2.x, g2.y + 56, g2.w, o.lines, { fontSize: t.type.body, color: col.text }));
  els.push(pageNum(t, cv, o.pageNum ?? '03'));
  return els;
}

// ── 16 时间轴（横向节点）────────────────────────────────────────────────────
export interface TimelineNode { time: string; label: string }
export interface TimelineOpts { canvas?: Canvas; eyebrow?: string; brand?: string; pageNum?: string; title: string; nodes: TimelineNode[] }
export function timeline(t: Theme, o: TimelineOpts): SlideElement[] {
  const cv = o.canvas ?? CANVAS; const col = c(t); const m = t.grid.margin;
  const els: SlideElement[] = [...header(t, cv, o.eyebrow ?? '', o.brand ?? ''), ...pageTitle(t, cv, o.title)];
  const x0 = m; const w = cv.width - m * 2; const axisY = 560;
  els.push(rect({ x: x0, y: axisY, w, h: 2 }, col.line));
  const n = Math.max(1, o.nodes.length); const step = w / n;
  o.nodes.forEach((nd, i) => {
    const cx = Math.round(x0 + step * (i + 0.5));
    els.push(rect({ x: cx - 9, y: axisY - 8, w: 18, h: 18 }, col.primary, 9));
    els.push(txt({ x: cx - 120, y: axisY - 96, w: 240, h: 40, text: nd.time, fontSize: t.type.h3, color: col.accent, fontFamily: t.fontMono, fontWeight: 700, align: 'center' }));
    els.push(block(cx - 150, axisY + 40, 300, [nd.label], { fontSize: t.type.small, color: col.muted, align: 'center' }));
  });
  els.push(pageNum(t, cv, o.pageNum ?? '03'));
  return els;
}

// ── 17 结尾页（居中：允许）──────────────────────────────────────────────────
export interface EndOpts { canvas?: Canvas; title?: string; lines?: string[] }
export function end(t: Theme, o: EndOpts = {}): SlideElement[] {
  const cv = o.canvas ?? CANVAS; const col = c(t); const cx = Math.round(cv.width / 2);
  const els: SlideElement[] = [
    para({ x: 0, y: 420, w: cv.width, h: 140, text: o.title ?? '谢谢', fontSize: 100, color: col.text, fontFamily: t.fontTitle, fontWeight: 700, align: 'center' }),
    rect({ x: cx - 40, y: 600, w: 80, h: 4 }, col.accent),
  ];
  (o.lines ?? []).forEach((ln, i) => els.push(para({ x: 0, y: 660 + i * 60, w: cv.width, h: 50, text: ln, fontSize: t.type.body, color: col.muted, align: 'center' })));
  return els;
}

