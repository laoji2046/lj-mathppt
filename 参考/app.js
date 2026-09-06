/* ============================================================
   RevealSlidr — WYSIWYG Reveal.js Editor
   app.js — main application logic
   ============================================================ */

(function () {
  'use strict';

  /* ===== Constants ===== */
  const STORAGE_KEY = 'revealslidr:project';
  const AUTOSAVE_KEY = 'revealslidr:autosave:v2';

  const REVEAL_CDN = 'https://cdn.jsdelivr.net/npm/reveal.js@5';
  const THEME_CDN = REVEAL_CDN + '/dist/theme';
  const HLJS_CDN = REVEAL_CDN + '/plugin/highlight';

  const DEFAULT_THEME = 'white';
  const DEFAULT_TRANSITION = 'slide';

  /* ===== Template element helpers (used by Layouts / TemplateLibrary) ===== */
  // text element: content is the inner HTML of .el-text; st = extra style on the slide-element
  function tEl(eid, l, t, w, h, content, st, frag) {
    return '<div class="slide-element' + (frag ? ' fragment' : '') + '" data-type="text" data-eid="' + eid + '"' +
      ' contenteditable="false"' +
      ' style="position:absolute;left:' + l + 'px;top:' + t + 'px;width:' + w + 'px;height:' + h + 'px;' + (st || '') + '">' +
      '<div class="el-text" contenteditable="false">' + content + '</div></div>';
  }
  // shape (rect) element — editable like any shape
  function rEl(eid, l, t, w, h, fill, radius, stroke, sw, frag) {
    const sw2 = (sw || 0) * 2;
    // 圆角为 0 时画满幅矩形（无 2% 内缩），并打 data-bleed 标记，
    // 供编辑重渲染时保持满幅 —— 全画布背景/版式真正铺满 1280×720，无白边
    const bleed = !radius ? ' data-bleed="1"' : '';
    const rect = radius
      ? '<rect x="2" y="2" width="96" height="96" rx="' + radius + '" fill="' + fill + '"'
      : '<rect x="0" y="0" width="100" height="100" rx="0" fill="' + fill + '"';
    return '<div class="slide-element' + (frag ? ' fragment' : '') + '" data-type="shape" data-shape="rect" data-eid="' + eid + '"' +
      ' data-fill="' + fill + '" data-stroke="' + (stroke || '#000000') + '" data-stroke-w="' + (sw || 0) + '" data-dash="solid"' + bleed +
      ' contenteditable="false"' +
      ' style="position:absolute;left:' + l + 'px;top:' + t + 'px;width:' + w + 'px;height:' + h + 'px;">' +
      '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
      rect +
      (sw2 > 0 ? ' stroke="' + (stroke || '#000000') + '" stroke-width="' + sw2 + '"' : '') + '/></svg></div>';
  }

  /* ===== Teaching-template helpers (px layout on the 1280×720 canvas) ===== */
  // slide title with accent underline
  function tbTitle(text, accent) {
    return tEl('el_' + uid(), 64, 35, 1147, 53,
      '<span style="font-size:43px;font-weight:700;color:#1f2937;">' + text + '</span>') +
      rEl('el_' + uid(), 64, 101, 120, 6, accent || '#534AB7', 3);
  }
  // theme-aware header for basic layouts (accent underline + 56px title)
  function basicTitle(p, fg, text) {
    return rEl('el_' + uid(), 128, 78, 80, 7, p, 3.5) +
      tEl('el_' + uid(), 128, 99, 1024, 80,
        '<span style="font-size:56px;font-weight:700;color:' + fg + ';display:block;text-align:left;width:100%;">' + text + '</span>');
  }
  // icon + title + description list row
  function tbRow(eid, l, t, w, h, icon, strong, desc, accent, bg) {
    return tEl(eid, l, t, w, h,
      '<div style="display:flex;align-items:center;gap:21px;text-align:left;padding:0 27px;">' +
      '<span style="font-size:32px;flex:none;">' + icon + '</span>' +
      '<div style="min-width:0;"><strong style="font-size:25px;color:' + accent + ';">' + strong + '</strong>' +
      '<p style="margin:4px 0 0;font-size:20px;color:#555;line-height:1.5;">' + desc + '</p></div></div>',
      'background:' + (bg || 'rgba(83,74,183,0.08)') + ';border-left:5px solid ' + accent + ';border-radius:11px;');
  }
  // solution card for "one problem, multiple solutions"
  function tbSolCard(l, accent, title, steps) {
    const stepsHtml = steps.map(function (s) {
      return '<li style="font-size:20px;color:#555;line-height:2;">' + s + '</li>';
    }).join('');
    return tEl('el_' + uid(), l, 265, 363, 391,
      '<div style="display:flex;flex-direction:column;align-items:flex-start;text-align:left;padding:29px 27px;gap:13px;">' +
      '<span style="font-size:25px;font-weight:700;color:' + accent + ';">' + title + '</span>' +
      '<ol style="margin:0;padding-left:27px;">' + stepsHtml + '</ol></div>',
      'background:rgba(' + hexRgb(accent) + ',0.06);border-top:5px solid ' + accent + ';border-radius:16px;');
  }
  // hex color → "r,g,b" (for rgba() strings)
  function hexRgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h, 16);
    return ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
  }

  /* ===== Layout Templates ===== */
  // Resolve the active template theme (business/dark/nature). Basic layouts use it
  // so their colors stay coherent with the Pro layouts when switching themes.
  function activeTheme() {
    return TemplateLibrary.theme();
  }

  /* =====================================================================
     DesignTokens：模板设计令牌体系（去 AI 味 / PowerPoint 质感）
     依据 slideo-template-prompts.md 的 P0 设计宪法 + 六张风格卡。
     · 统一画布/网格/字号阶梯/圆角/阴影规则
     · 6 张风格卡（consulting/academic/edumath/keynote-dark/editorial/formal）
     · 产出的 token 对象与模板 helper（pBg/pCard/tEl/rEl/...）兼容，
       字段：ink/paper/primary/accent/muted/line/surface/radius/shadow 等。
     · 去 AI 味：无渐变、无毛玻璃、无背景光斑、圆角≤8、阴影克制、禁用高饱和色。
     ===================================================================== */
  const DTK = {
    canvas: { w: 1280, h: 720, margin: 64, cols: 12, gutter: 16, baseline: 8 },
    // 只允许这 6 档字号（字号阶梯），模板不得随意取值
    typeScale: { display: 56, h1: 36, h2: 24, body: 20, small: 16, label: 12 },
    lineHeight: { title: 1.15, body: 1.55 },
    // 6 张风格卡：低饱和专业配色（禁用 #8B5CF6/#6366F1/#3B82F6/#22D3EE/#EC4899）
    styles: {
      consulting: {
        bg: '#FFFFFF', text: '#1F2328', primary: '#1F3A5F', accent: '#C4622D',
        muted: '#6B7280', line: '#D1D5DB', surface: '#F6F7F9', serif: false,
      },
      academic: {
        bg: '#FAFAF7', text: '#26282B', primary: '#1E4D3B', accent: '#B3541E',
        muted: '#6B7280', line: '#D8D8D0', surface: '#F0EDE6', serif: true,
      },
      edumath: {
        bg: '#FAF7F0', text: '#2B2B2B', primary: '#1D4E89', accent: '#E8871E',
        muted: '#5B6472', line: '#E0DBD0', surface: '#F3EFE6', serif: false,
      },
      'keynote-dark': {
        bg: '#0D1117', text: '#E6EDF3', primary: '#39C5CF', accent: '#E3B341',
        muted: '#8B949E', line: '#30363D', surface: '#161B22', serif: false, dark: true,
      },
      editorial: {
        bg: '#FFFFFF', text: '#111111', primary: '#2438C8', accent: '#D5451B',
        muted: '#555555', line: '#E5E5E5', surface: '#FAFAFA', serif: true,
      },
      formal: {
        bg: '#FFFFFF', text: '#2B2B2B', primary: '#14336B', accent: '#B08D44',
        muted: '#666666', line: '#E2E2E2', surface: '#F7F7F7', serif: true,
      },
    },
    default: 'edumath',   // Slideo 定制默认：数学课件风

    /** 规范色辅助：给定任一主题对象(含 primary/secondary/bg/ink/fg/sub/...)，
        生成符合设计宪法的 token。styleId 指定风格卡；未指定用 styleId 或主题名匹配。 */
    resolve(styleId, theme) {
      const s = (this.styles && (this.styles[styleId] || (theme && this.styles[theme.id])))
        || this.styles[this.default] || {};
      const dark = !!s.dark;
      const serif = !!s.serif;
      const ink = s.text || theme.ink || theme.fg || (dark ? '#E6EDF3' : '#1F2328');
      const paper = s.bg || theme.paper || theme.bg || (dark ? '#0D1117' : '#FFFFFF');
      const primary = s.primary || theme.primary || '#1D4E89';
      const accent = s.accent || theme.accent || '#E8871E';
      const muted = s.muted || theme.sub || (dark ? '#8B949E' : '#5B6472');
      const line = s.line || (dark ? '#30363D' : '#D1D5DB');
      const surface = s.surface || (dark ? '#161B22' : '#F6F7F9');
      return {
        // 基础字段（模板 helper 兼容）
        ink, paper, fg: ink, sub: muted, faint: muted,
        primary, secondary: muted, accent, success: primary,
        a: primary, s: muted, g: primary, acc: accent,
        card: surface, surface, line, border: line,
        // 去 AI 味：无渐变/毛玻璃/大阴影/背景光斑
        grad: '', gradSoft: '', glow: '', glow2: '', glow3: '',
        blur: 'initial', blurLg: 'initial',
        radius: 8, radiusSm: 4,
        shadow: dark ? '0 1px 3px rgba(0,0,0,0.4)' : '0 1px 3px rgba(15,23,42,0.08)',
        dark,
        // 网格 / 字号阶梯信息（模板可读）
        grid: this.canvas,
        typeScale: this.typeScale,
        lhTitle: this.lineHeight.title, lhBody: this.lineHeight.body,
        // 字族 + 字重（最多 2 个字族：标题/正文；书卷气时标题可换衬线）
        font: {
          title: serif ? "'Noto Serif SC','Songti SC','SimSun',serif" :
            "'Noto Sans SC','Microsoft YaHei','PingFang SC',sans-serif",
          body: "'Noto Sans SC','Microsoft YaHei','PingFang SC',sans-serif",
          titleWeight: 700, bodyWeight: 400,
        },
      };
    },
  };
  // 供模板直接取默认风格 token：DTK.x()
  DTK.x = function (theme) { return DTK.resolve(null, theme); };
  DTK.xStyle = function (styleId, theme) { return DTK.resolve(styleId, theme); };

  const Layouts = {
    /* ---------- PPT 标准版式：标题幻灯片（封面） ---------- */
    title: (c) => {
      c = c || activeTheme();
      const p = c.primary, s = c.secondary, a = c.accent;
      const fg = c.fg, sub = c.sub, fa = c.faint, bg = c.bg;
      return (bg !== '#ffffff' ? rEl('el_' + uid(), 0, 0, 1280, 720, bg, 0) : '') +
        rEl('el_' + uid(), 0, 0, 1280, 12, p, 0) +
        rEl('el_' + uid(), 1093, 93, 107, 82, rgba(s, 0.18), 40) +
        rEl('el_' + uid(), 107, 576, 69, 53, rgba(a, 0.22), 26) +
        tEl('el_' + uid(), 240, 144, 800, 45, '<span style="font-size:21px;font-weight:700;letter-spacing:.4em;color:' + p + ';display:block;text-align:center;">PRESENTATION</span>') +
        tEl('el_' + uid(), 107, 206, 1067, 247, '<span style="font-size:96px;font-weight:800;line-height:1.16;color:' + fg + ';display:block;text-align:center;">演示文稿标题</span>') +
        rEl('el_' + uid(), 573, 475, 133, 8, p, 4) +
        tEl('el_' + uid(), 160, 510, 960, 68, '<span style="font-size:32px;color:' + sub + ';display:block;text-align:center;width:100%;">一句话副标题，说明这份演示的主题与核心价值</span>') +
        tEl('el_' + uid(), 347, 607, 587, 41, '<span style="font-size:20px;color:' + fa + ';display:block;text-align:center;">作者姓名 · 2026 年 8 月</span>');
    },

    /* ---------- PPT 标准版式：标题和内容 ---------- */
    content: (c) => {
      c = c || activeTheme();
      const p = c.primary, fg = c.fg, sub = c.sub, bg = c.bg;
      const lis = ['第一个要点', '第二个要点', '第三个要点', '第四个要点'].map(function (t) {
        return '<li style="margin:0 0 24px;padding-left:29px;position:relative;list-style:none;font-size:27px;color:' + sub + ';">' +
          '<span style="position:absolute;left:0;top:12px;width:13px;height:13px;border-radius:50%;background:' + p + ';"></span>' + t + '</li>';
      }).join('');
      return (bg !== '#ffffff' ? rEl('el_' + uid(), 0, 0, 1280, 720, bg, 0) : '') +
        rEl('el_' + uid(), 128, 78, 80, 7, p, 3.5) +
        tEl('el_' + uid(), 128, 99, 1024, 80, '<span style="font-size:56px;font-weight:700;color:' + fg + ';display:block;text-align:left;width:100%;">幻灯片标题</span>') +
        tEl('el_' + uid(), 128, 206, 1024, 453, '<div style="width:100%;text-align:left;padding:8px 0;"><ul style="margin:0;padding:0;max-width:960px;">' + lis + '</ul></div>');
    },

    /* ---------- PPT 标准版式：两栏内容 ---------- */
    'two-col': (c) => {
      c = c || activeTheme();
      const p = c.primary, s = c.secondary, fg = c.fg, sub = c.sub, bg = c.bg;
      const col = function (l, title, tone, items) {
        const lis = items.map(function (t) {
          return '<li style="margin:0 0 19px;padding-left:24px;position:relative;list-style:none;font-size:23px;color:' + sub + ';">' +
            '<span style="position:absolute;left:0;top:11px;width:11px;height:11px;border-radius:50%;background:' + tone + ';"></span>' + t + '</li>';
        }).join('');
        return tEl('el_' + uid(), l, 216, 496, 329,
          '<div style="width:100%;text-align:left;padding:11px 0;">' +
          '<strong style="font-size:32px;font-weight:700;color:' + fg + ';display:block;margin-bottom:21px;">' + title + '</strong>' +
          '<ul style="margin:0;padding:0;">' + lis + '</ul></div>',
          'background:' + rgba(tone, 0.08) + ';border-radius:19px;');
      };
      return (bg !== '#ffffff' ? rEl('el_' + uid(), 0, 0, 1280, 720, bg, 0) : '') +
        rEl('el_' + uid(), 128, 78, 80, 7, p, 3.5) +
        tEl('el_' + uid(), 128, 99, 1024, 80, '<span style="font-size:56px;font-weight:700;color:' + fg + ';display:block;text-align:left;width:100%;">对比内容</span>') +
        col(128, '左侧标题', p, ['要点 A', '要点 B', '要点 C']) +
        col(656, '右侧标题', s, ['要点 D', '要点 E', '要点 F']);
    },

    /* ---------- PPT 标准版式：图片与标题 ---------- */
    image: (c) => {
      c = c || activeTheme();
      const p = c.primary, fg = c.fg, sub = c.sub, bg = c.bg;
      const imgId = 'el_' + uid();
      const capId = 'el_' + uid();
      return (bg !== '#ffffff' ? rEl('el_' + uid(), 0, 0, 1280, 720, bg, 0) : '') +
        rEl('el_' + uid(), 128, 78, 80, 7, p, 3.5) +
        tEl('el_' + uid(), 128, 99, 1024, 80, '<span style="font-size:56px;font-weight:700;color:' + fg + ';display:block;text-align:left;width:100%;">图文幻灯片</span>') +
        '<div class="slide-element" data-type="image" data-eid="' + imgId + '" contenteditable="false"' +
        ' style="position:absolute;left:347px;top:195px;width:587px;height:309px;">' +
        '<img class="el-image" src="' + imgSvg(p) + '" alt="示例图片" style="width:100%;height:100%;object-fit:cover;border-radius:16px;"></div>' +
        '<div class="slide-element" data-type="text" data-eid="' + capId + '" contenteditable="false"' +
        ' style="position:absolute;left:347px;top:514px;width:587px;height:45px;">' +
        '<div class="el-text" contenteditable="false" style="text-align:center;font-size:20px;color:' + sub + ';">图片说明文字</div></div>';
    },

    /* ---------- PPT 标准版式：代码 ---------- */
    code: (c) => {
      c = c || activeTheme();
      const p = c.primary, fg = c.fg, bg = c.bg;
      return (bg !== '#ffffff' ? rEl('el_' + uid(), 0, 0, 1280, 720, bg, 0) : '') +
        rEl('el_' + uid(), 128, 78, 80, 7, p, 3.5) +
        tEl('el_' + uid(), 128, 99, 1024, 80, '<span style="font-size:56px;font-weight:700;color:' + fg + ';display:block;text-align:left;width:100%;">代码示例</span>') +
        tEl('el_' + uid(), 128, 216, 1024, 432,
          '<pre style="margin:0;width:100%;height:100%;text-align:left;background:#1e1e2e;color:#cdd6f4;padding:32px 37px;border-radius:16px;overflow:auto;font-size:24px;line-height:1.7;font-family:Consolas,Menlo,monospace;"><code>function hello() {\n  console.log("Hello, Reveal.js!");\n}\n</code></pre>');
    },

    /* ---------- PPT 标准版式：引用 ---------- */
    quote: (c) => {
      c = c || activeTheme();
      const p = c.primary, fg = c.fg, sub = c.sub, bg = c.bg;
      return (bg !== '#ffffff' ? rEl('el_' + uid(), 0, 0, 1280, 720, bg, 0) : '') +
        tEl('el_' + uid(), 160, 103, 187, 154, '<span style="font-size:187px;font-weight:800;line-height:1;color:' + rgba(p, 0.2) + ';display:block;text-align:center;">&ldquo;</span>') +
        tEl('el_' + uid(), 240, 267, 800, 185, '<span style="font-size:43px;font-weight:500;color:' + fg + ';line-height:1.7;display:block;text-align:center;">这是一段引人深思的引用文字。</span>') +
        rEl('el_' + uid(), 573, 483, 133, 7, p, 3.5) +
        tEl('el_' + uid(), 440, 514, 400, 45, '<span style="font-size:23px;color:' + sub + ';display:block;text-align:center;">— 引用来源 / 出处</span>');
    },

    /* ---------- PPT 标准版式：节标题 ---------- */
    section: (c) => {
      c = c || activeTheme();
      const p = c.primary, fg = c.fg, sub = c.sub, bg = c.bg;
      return (bg !== '#ffffff' ? rEl('el_' + uid(), 0, 0, 1280, 720, bg, 0) : '') +
        rEl('el_' + uid(), 0, 0, 1280, 12, p, 0) +
        tEl('el_' + uid(), 400, 165, 480, 51, '<span style="font-size:24px;font-weight:700;letter-spacing:.35em;color:' + p + ';display:block;text-align:center;">PART 02</span>') +
        tEl('el_' + uid(), 240, 247, 800, 134, '<span style="font-size:85px;font-weight:800;color:' + fg + ';display:block;text-align:center;">章节标题</span>') +
        rEl('el_' + uid(), 573, 422, 133, 7, p, 3.5) +
        tEl('el_' + uid(), 240, 463, 800, 103, '<span style="font-size:27px;color:' + sub + ';line-height:1.8;display:block;text-align:center;width:100%;">章节引言：简要说明本章主题与学习目标</span>');
    },

    /* ---------- Bento 网格 ---------- */
    bento: (c) => {
      c = c || activeTheme();
      function card(eid, l, t, w, h, bg, title, desc, titleSize) {
        return '<div class="slide-element" data-type="text" data-eid="' + eid + '" contenteditable="false"' +
          ' style="position:absolute;left:' + l + 'px;top:' + t + 'px;width:' + w + 'px;height:' + h + 'px;' +
          (bg ? 'background:' + bg + ';' : '') + 'border-radius:21px;">' +
          '<div class="el-text" contenteditable="false" style="flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:24px 27px;gap:8px;">' +
          '<span style="font-size:' + (titleSize || '0.75em') + ';font-weight:700;color:' + c.fg + ';">' + title + '</span>' +
          (desc ? '<span style="font-size:0.5em;opacity:0.65;line-height:1.5;color:' + c.sub + ';">' + desc + '</span>' : '') +
          '</div></div>';
      }
      return (c.bg !== '#ffffff' ? rEl('el_' + uid(), 0, 0, 1280, 720, c.bg, 0) : '') +
        card('el_' + uid(), 128, 37, 1024, 66, '', 'Bento 网格布局', '', '1.2em') +
        card('el_' + uid(), 128, 123, 627, 309, rgba(c.primary, 0.12), '主卡片', '放置核心内容：图表、图片或关键论点。双击编辑文字。') +
        card('el_' + uid(), 781, 123, 371, 148, rgba(c.accent, 0.12), '要点 A', '简短说明文字') +
        card('el_' + uid(), 781, 284, 371, 148, rgba(c.success, 0.12), '要点 B', '简短说明文字') +
        card('el_' + uid(), 128, 448, 1024, 95, rgba(c.faint, 0.14), '底部条', '可放结论、数据摘要或行动号召');
    },

    /* ---------- PPT 标准版式：空白 ---------- */
    blank: () =>
      '<div style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100%;color:#bbb;">' +
      '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:0.8em;opacity:0.5;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>' +
      '<p style="font-size:0.6em;opacity:0.7;">空白幻灯片 · 点击此处开始编辑</p>' +
      '</div>',

    /* ---------- PPT 标准版式：仅标题 ---------- */
    'title-only': (c) => {
      c = c || activeTheme();
      const p = c.primary, fg = c.fg, bg = c.bg;
      return (bg !== '#ffffff' ? rEl('el_' + uid(), 0, 0, 1280, 720, bg, 0) : '') +
        rEl('el_' + uid(), 128, 247, 80, 7, p, 3.5) +
        tEl('el_' + uid(), 128, 276, 1024, 154, '<span style="font-size:75px;font-weight:800;color:' + fg + ';line-height:1.2;display:block;text-align:left;width:100%;">仅标题版式</span>');
    },

    /* ---------- PPT 标准版式：内容与标题 ---------- */
    'content-caption': (c) => {
      c = c || activeTheme();
      const p = c.primary, fg = c.fg, sub = c.sub, bg = c.bg;
      const lis = ['要点一', '要点二', '要点三'].map(function (t) {
        return '<li style="margin:0 0 24px;padding-left:29px;position:relative;list-style:none;font-size:27px;color:' + sub + ';">' +
          '<span style="position:absolute;left:0;top:12px;width:13px;height:13px;border-radius:50%;background:' + p + ';"></span>' + t + '</li>';
      }).join('');
      return (bg !== '#ffffff' ? rEl('el_' + uid(), 0, 0, 1280, 720, bg, 0) : '') +
        tEl('el_' + uid(), 128, 134, 1024, 339, '<div style="width:100%;text-align:left;padding:8px 0;"><ul style="margin:0;padding:0;max-width:960px;">' + lis + '</ul></div>') +
        rEl('el_' + uid(), 128, 514, 80, 7, p, 3.5) +
        tEl('el_' + uid(), 128, 551, 1024, 82, '<span style="font-size:48px;font-weight:700;color:' + fg + ';display:block;text-align:left;width:100%;">底部标题</span>');
    },

    /* ---------- PPT 标准版式：图片与标题（大字图） ---------- */
    'picture-caption': (c) => {
      c = c || activeTheme();
      const p = c.primary, fg = c.fg, bg = c.bg;
      const imgId = 'el_' + uid();
      return (bg !== '#ffffff' ? rEl('el_' + uid(), 0, 0, 1280, 720, bg, 0) : '') +
        '<div class="slide-element" data-type="image" data-eid="' + imgId + '" contenteditable="false"' +
        ' style="position:absolute;left:128px;top:93px;width:1024px;height:442px;">' +
        '<img class="el-image" src="' + imgSvg(p) + '" alt="示例图片" style="width:100%;height:100%;object-fit:cover;border-radius:16px;"></div>' +
        rEl('el_' + uid(), 128, 566, 80, 7, p, 3.5) +
        tEl('el_' + uid(), 128, 597, 1024, 72, '<span style="font-size:45px;font-weight:700;color:' + fg + ';display:block;text-align:left;width:100%;">图片标题</span>');
    },

    /* ---------- PPT 标准版式：标题和竖排文字 ---------- */
    'vertical-text': (c) => {
      c = c || activeTheme();
      const p = c.primary, fg = c.fg, sub = c.sub, bg = c.bg;
      return (bg !== '#ffffff' ? rEl('el_' + uid(), 0, 0, 1280, 720, bg, 0) : '') +
        rEl('el_' + uid(), 128, 78, 80, 7, p, 3.5) +
        tEl('el_' + uid(), 128, 99, 1024, 80, '<span style="font-size:56px;font-weight:700;color:' + fg + ';display:block;text-align:left;width:100%;">竖排文字版式</span>') +
        tEl('el_' + uid(), 128, 206, 827, 442,
          '<div style="width:100%;height:100%;text-align:left;padding:27px;border-left:5px solid ' + rgba(p, 0.3) + ';">' +
          '<span style="writing-mode:vertical-rl;text-orientation:upright;font-size:27px;color:' + sub + ';letter-spacing:.3em;line-height:2.2;">竖排文字内容 · 适用于中文竖排排版</span></div>');
    },

    /* ---------- 议程 / 目录 ---------- */
    agenda: (c) => {
      c = c || activeTheme();
      const tones = [c.primary, c.secondary, c.accent, c.success];
      const items = ['第一部分：背景与目标', '第二部分：方案与实施', '第三部分：成果与数据', '第四部分：总结与展望'];
      let html = (c.bg !== '#ffffff' ? rEl('el_' + uid(), 0, 0, 1280, 720, c.bg, 0) : '') +
        rEl('el_' + uid(), 128, 78, 80, 7, c.primary, 3.5) +
        tEl('el_' + uid(), 128, 99, 1024, 80, '<span style="font-size:56px;font-weight:700;color:' + c.fg + ';display:block;text-align:left;width:100%;">议程</span>');
      items.forEach(function (t, i) {
        html += tEl('el_' + uid(), 128, 206 + i * 111, 1024, 91,
          '<div style="display:flex;align-items:center;gap:29px;text-align:left;padding:0 27px;width:100%;">' +
          '<span style="width:69px;height:69px;border-radius:16px;background:' + tones[i % 4] + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:29px;font-weight:800;flex:none;">0' + (i + 1) + '</span>' +
          '<span style="font-size:29px;font-weight:600;color:' + c.fg + ';">' + t + '</span></div>',
          'background:' + rgba(tones[i % 4], 0.06) + ';border-radius:16px;');
      });
      return html;
    },

  /* ===== 1. 知识点梳理 ===== */
  'knowledge-summary': () =>
    tbTitle('📋 知识点梳理') +
    tbRow('el_' + uid(), 64, 136, 1152, 109, '🔹', '核心概念 1', '概念解释与关键要点：定义、内涵与常见误区。', '#534AB7') +
    tbRow('el_' + uid(), 64, 257, 1152, 109, '🔹', '核心概念 2', '概念解释与关键要点：定义、内涵与常见误区。', '#534AB7') +
    tbRow('el_' + uid(), 64, 379, 1152, 109, '🔹', '核心概念 3', '概念解释与关键要点：定义、内涵与常见误区。', '#534AB7') +
    tEl('el_' + uid(), 64, 500, 1152, 109,
      '<div style="display:flex;align-items:center;gap:21px;text-align:left;padding:0 27px;">' +
      '<span style="font-size:32px;flex:none;">💡</span>' +
      '<div style="min-width:0;"><strong style="font-size:25px;color:#6b7280;">要点提示</strong>' +
      '<p style="margin:4px 0 0;font-size:20px;color:#6b7280;line-height:1.5;">概念之间的联系与易混点在此补充说明。</p></div></div>',
      'background:#f8fafc;border-radius:11px;'),

  /* ===== 2. 典型例题 ===== */
  'example-problem': () =>
    tbTitle('📝 典型例题', '#E8590A') +
    tEl('el_' + uid(), 64, 136, 1152, 173,
      '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:0 32px;gap:11px;">' +
      '<strong style="font-size:24px;color:#E8590A;">【题目】</strong>' +
      '<span style="font-size:21px;color:#444;line-height:1.7;">在此输入题目内容。已知条件和问题描述应清晰完整，必要时可分两行。</span></div>',
      'background:#FFF8F0;border:3px solid #E8590A;border-radius:16px;') +
    tEl('el_' + uid(), 64, 339, 1152, 329,
      '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:0 32px;gap:16px;">' +
      '<strong style="font-size:24px;color:#0CA678;">【解题步骤】</strong>' +
      '<div style="display:flex;align-items:center;gap:16px;"><span style="width:35px;height:35px;border-radius:50%;background:#0CA678;color:#fff;display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:700;flex:none;">1</span><span style="font-size:21px;color:#444;">第一步：分析题意，确定已知条件与所求目标</span></div>' +
      '<div style="display:flex;align-items:center;gap:16px;"><span style="width:35px;height:35px;border-radius:50%;background:#0CA678;color:#fff;display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:700;flex:none;">2</span><span style="font-size:21px;color:#444;">第二步：建立数学模型，列出关系式</span></div>' +
      '<div style="display:flex;align-items:center;gap:16px;"><span style="width:35px;height:35px;border-radius:50%;background:#0CA678;color:#fff;display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:700;flex:none;">3</span><span style="font-size:21px;color:#444;">第三步：求解并验证结果的合理性</span></div></div>',
      'background:#F0FDF9;border-left:5px solid #0CA678;border-radius:13px;'),

  /* ===== 3. 一题多解 ===== */
  'multi-solution': () =>
    tbTitle('💡 一题多解') +
    tEl('el_' + uid(), 64, 136, 1152, 99,
      '<div style="display:flex;align-items:center;gap:16px;text-align:left;padding:0 27px;">' +
      '<strong style="font-size:23px;color:#534AB7;">【题目】</strong>' +
      '<span style="font-size:21px;color:#444;">在此输入题目，同一道题尝试三种不同解法。</span></div>',
      'background:#F5F3FF;border:3px solid #534AB7;border-radius:13px;') +
    tbSolCard(64, '#534AB7', '解法一：代数法', ['设未知数', '列方程', '求解并检验']) +
    tbSolCard(459, '#E8590A', '解法二：几何法', ['画图分析', '找几何关系', '计算并验证']) +
    tbSolCard(853, '#0CA678', '解法三：向量法', ['建立坐标系', '向量表示', '运算并检验']),

  /* ===== 4. 易错警示 ===== */
  'common-mistakes': () =>
    tbTitle('⚠️ 易错警示', '#DC2626') +
    tEl('el_' + uid(), 64, 136, 1152, 247,
      '<div style="display:flex;align-items:flex-start;gap:21px;text-align:left;padding:27px 32px;">' +
      '<span style="font-size:40px;color:#DC2626;flex:none;">✗</span>' +
      '<div><strong style="font-size:25px;color:#DC2626;">常见错误 1</strong>' +
      '<p style="margin:8px 0 0;font-size:21px;color:#555;line-height:1.7;">错误做法描述及原因分析：写出典型的错误思路，指出容易忽略的条件。</p></div></div>',
      'background:#FEF2F2;border:3px solid #FECACA;border-radius:16px;') +
    tEl('el_' + uid(), 64, 399, 1152, 247,
      '<div style="display:flex;align-items:flex-start;gap:21px;text-align:left;padding:27px 32px;">' +
      '<span style="font-size:40px;color:#0CA678;flex:none;">✓</span>' +
      '<div><strong style="font-size:25px;color:#0CA678;">正确做法</strong>' +
      '<p style="margin:8px 0 0;font-size:21px;color:#555;line-height:1.7;">正确解法及关键步骤：对比错误思路，强调规范流程与检验方法。</p></div></div>',
      'background:#F0FDF4;border:3px solid #BBF7D0;border-radius:16px;') +
    tEl('el_' + uid(), 64, 662, 1152, 49,
      '<div style="display:flex;align-items:center;gap:16px;text-align:left;padding:0 21px;">' +
      '<strong style="font-size:21px;color:#B45309;">💡 提醒：</strong>' +
      '<span style="font-size:20px;color:#78350F;">关键注意事项和检验方法</span></div>',
      'background:#FFFBEB;border-left:5px solid #F59E0B;border-radius:11px;'),

  /* ===== 5. 方法总结 ===== */
  'method-summary': () =>
    tbTitle('🎯 方法总结', '#0CA678') +
    tEl('el_' + uid(), 64, 136, 1152, 535,
      '<div style="display:flex;flex-direction:column;align-items:flex-start;text-align:left;padding:37px 40px;gap:24px;">' +
      '<span style="font-size:27px;font-weight:700;color:#0CA678;">解题通法</span>' +
      '<div style="display:flex;align-items:center;gap:19px;"><span style="width:40px;height:40px;border-radius:50%;background:#0CA678;color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;flex:none;">1</span><span style="font-size:23px;color:#444;">第一步：审题——明确已知与所求</span></div>' +
      '<div style="display:flex;align-items:center;gap:19px;"><span style="width:40px;height:40px;border-radius:50%;background:#0CA678;color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;flex:none;">2</span><span style="font-size:23px;color:#444;">第二步：转化——建立数学模型</span></div>' +
      '<div style="display:flex;align-items:center;gap:19px;"><span style="width:40px;height:40px;border-radius:50%;background:#0CA678;color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;flex:none;">3</span><span style="font-size:23px;color:#444;">第三步：求解——规范书写过程</span></div>' +
      '<div style="display:flex;align-items:center;gap:19px;"><span style="width:40px;height:40px;border-radius:50%;background:#0CA678;color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;flex:none;">4</span><span style="font-size:23px;color:#444;">第四步：检验——验证结果合理性</span></div></div>',
      'background:#F0FDF9;border:3px solid #A7F3D0;border-radius:19px;'),

  /* ===== 6. 高考真题 ===== */
  'exam-question': () =>
    tbTitle('🎓 高考真题') +
    tEl('el_' + uid(), 64, 136, 1152, 288,
      '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:0 32px;gap:16px;">' +
      '<div style="display:flex;align-items:center;gap:19px;">' +
      '<span style="background:#534AB7;color:#fff;padding:5px 16px;border-radius:8px;font-size:19px;font-weight:600;">2024 全国甲卷</span>' +
      '<span style="font-size:20px;color:#7C3AED;font-weight:600;">第 21 题（12 分）</span></div>' +
      '<span style="font-size:21px;color:#333;line-height:1.8;">在此输入高考真题内容。包括已知条件、问题与分值说明，完整再现题目情境。</span></div>',
      'background:linear-gradient(135deg,#F5F3FF 0%,#EDE9FE 100%);border:3px solid #C4B5FD;border-radius:16px;') +
    tEl('el_' + uid(), 64, 455, 1152, 99,
      '<div style="display:flex;align-items:center;gap:16px;text-align:left;padding:0 27px;">' +
      '<strong style="font-size:23px;color:#534AB7;">【考点分析】</strong>' +
      '<span style="font-size:21px;color:#555;">本题考查的知识点与能力要求，以及命题趋势提示。</span></div>',
      'background:#fafafa;border-radius:13px;') +
    tEl('el_' + uid(), 64, 572, 1152, 99,
      '<div style="display:flex;align-items:center;gap:16px;text-align:left;padding:0 27px;">' +
      '<strong style="font-size:23px;color:#0CA678;">【解题思路】</strong>' +
      '<span style="font-size:21px;color:#555;">从条件出发的突破口与关键步骤概述。</span></div>',
      'background:#F0FDF9;border-radius:13px;'),

  /* ===== 7. 公式定理卡片 ===== */
  'formula-card': () =>
    tbTitle('📐 公式定理') +
    tEl('el_' + uid(), 173, 154, 933, 473,
      '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:21px;padding:27px;">' +
      '<span style="font-size:21px;opacity:.85;letter-spacing:.2em;">THM</span>' +
      '<span style="font-size:45px;font-weight:700;">重要公式或定理</span>' +
      '<span style="font-size:27px;opacity:.9;line-height:1.7;">公式内容或定理表述<br/>可多行显示，支持换行</span></div>',
      'background:linear-gradient(135deg,#534AB7 0%,#7C3AED 100%);color:#fff;border-radius:27px;box-shadow:0 19px 59px rgba(83,74,183,.35);'),

  /* ===== 8. 对比辨析 ===== */
  'comparison': () =>
    tbTitle('🔍 对比辨析') +
    tEl('el_' + uid(), 64, 136, 533, 391,
      '<div style="display:flex;flex-direction:column;align-items:flex-start;text-align:left;padding:29px 32px;gap:13px;">' +
      '<strong style="font-size:29px;color:#1D4ED8;">概念 A</strong>' +
      '<ul style="margin:0;padding-left:27px;font-size:21px;color:#444;line-height:2.1;">' +
      '<li>特征 1</li><li>特征 2</li><li>特征 3</li></ul></div>',
      'background:#EFF6FF;border:3px solid #3B82F6;border-radius:16px;') +
    tEl('el_' + uid(), 640, 311, 75, 58,
      '<span style="font-size:29px;font-weight:800;color:#534AB7;display:flex;align-items:center;justify-content:center;width:100%;height:100%;">VS</span>',
      'background:#fff;border:3px solid #e5e7eb;border-radius:50%;box-shadow:0 5px 19px rgba(0,0,0,.08);') +
    tEl('el_' + uid(), 683, 136, 533, 391,
      '<div style="display:flex;flex-direction:column;align-items:flex-start;text-align:left;padding:29px 32px;gap:13px;">' +
      '<strong style="font-size:29px;color:#C2410C;">概念 B</strong>' +
      '<ul style="margin:0;padding-left:27px;font-size:21px;color:#444;line-height:2.1;">' +
      '<li>特征 1</li><li>特征 2</li><li>特征 3</li></ul></div>',
      'background:#FFF7ED;border:3px solid #F97316;border-radius:16px;') +
    tEl('el_' + uid(), 64, 564, 1152, 103,
      '<div style="display:flex;align-items:center;gap:16px;text-align:left;padding:0 29px;">' +
      '<strong style="font-size:23px;color:#534AB7;">关键区别：</strong>' +
      '<span style="font-size:21px;color:#555;">在此总结两者的本质差异与适用场景。</span></div>',
      'background:#F5F3FF;border-radius:13px;'),

  /* ===== 9. 思维导图 ===== */
  'mind-map': () =>
    tbTitle('🧠 知识网络') +
    tEl('el_' + uid(), 533, 309, 213, 82,
      '<span style="font-size:27px;font-weight:700;color:#fff;display:flex;align-items:center;justify-content:center;width:100%;height:100%;">核心概念</span>',
      'background:#534AB7;border-radius:21px;') +
    tEl('el_' + uid(), 227, 165, 200, 66,
      '<span style="font-size:21px;font-weight:600;color:#534AB7;display:flex;align-items:center;justify-content:center;width:100%;height:100%;">分支 1</span>',
      'background:#EDE9FE;border-radius:16px;') +
    tEl('el_' + uid(), 853, 165, 200, 66,
      '<span style="font-size:21px;font-weight:600;color:#534AB7;display:flex;align-items:center;justify-content:center;width:100%;height:100%;">分支 2</span>',
      'background:#EDE9FE;border-radius:16px;') +
    tEl('el_' + uid(), 227, 490, 200, 66,
      '<span style="font-size:21px;font-weight:600;color:#534AB7;display:flex;align-items:center;justify-content:center;width:100%;height:100%;">分支 3</span>',
      'background:#EDE9FE;border-radius:16px;') +
    tEl('el_' + uid(), 853, 490, 200, 66,
      '<span style="font-size:21px;font-weight:600;color:#534AB7;display:flex;align-items:center;justify-content:center;width:100%;height:100%;">分支 4</span>',
      'background:#EDE9FE;border-radius:16px;'),

  /* ===== 10. 课堂练习 ===== */
  'practice': () =>
    tbTitle('✏️ 课堂练习', '#0CA678') +
    tEl('el_' + uid(), 64, 136, 1152, 257,
      '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:0 32px;gap:13px;">' +
      '<strong style="font-size:24px;color:#0CA678;">【练习】</strong>' +
      '<span style="font-size:21px;color:#444;line-height:1.8;">在此输入练习题目。学生当堂完成，巩固所学知识，可分多行描述。</span></div>',
      'background:#F0FDF9;border:3px solid #A7F3D0;border-radius:16px;') +
    tEl('el_' + uid(), 64, 422, 1152, 247,
      '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:0 32px;gap:13px;">' +
      '<strong style="font-size:24px;color:#534AB7;">📌 参考答案</strong>' +
      '<span style="font-size:21px;color:#444;line-height:1.8;">点击查看答案：详细解答过程与评分要点说明。</span></div>',
      'background:#fafafa;border:3px dashed #cbd5e1;border-radius:16px;'),

  /* ===== 11. 变式训练 ===== */
  'variant-training': () =>
    tbTitle('🔄 变式训练', '#E8590A') +
    tEl('el_' + uid(), 64, 136, 1152, 99,
      '<div style="display:flex;align-items:center;gap:16px;text-align:left;padding:0 27px;">' +
      '<strong style="font-size:23px;color:#E8590A;">【原题】</strong>' +
      '<span style="font-size:21px;color:#444;">基础题目内容：在此输入原题。</span></div>',
      'background:#FFF8F0;border:3px solid #FDBA74;border-radius:13px;') +
    tEl('el_' + uid(), 64, 263, 1152, 121,
      '<div style="display:flex;align-items:center;gap:16px;text-align:left;padding:0 27px;">' +
      '<strong style="font-size:23px;color:#534AB7;">变式 1（条件变化）：</strong>' +
      '<span style="font-size:21px;color:#555;">改变已知条件后的变式题目</span></div>',
      'background:#fafafa;border-left:5px solid #534AB7;border-radius:11px;') +
    tEl('el_' + uid(), 64, 401, 1152, 121,
      '<div style="display:flex;align-items:center;gap:16px;text-align:left;padding:0 27px;">' +
      '<strong style="font-size:23px;color:#0CA678;">变式 2（结论变化）：</strong>' +
      '<span style="font-size:21px;color:#555;">改变所求结论的变式题目</span></div>',
      'background:#fafafa;border-left:5px solid #0CA678;border-radius:11px;') +
    tEl('el_' + uid(), 64, 539, 1152, 121,
      '<div style="display:flex;align-items:center;gap:16px;text-align:left;padding:0 27px;">' +
      '<strong style="font-size:23px;color:#E8590A;">变式 3（综合拓展）：</strong>' +
      '<span style="font-size:21px;color:#555;">综合性更强的拓展题目</span></div>',
      'background:#fafafa;border-left:5px solid #E8590A;border-radius:11px;'),

  /* ===== 12. 答题规范 ===== */
  'answer-standard': () =>
    tbTitle('📊 答题规范与评分标准') +
    tEl('el_' + uid(), 64, 136, 1152, 442,
      '<table style="width:100%;height:100%;border-collapse:collapse;font-size:21px;">' +
      '<thead><tr>' +
      '<th style="background:#534AB7;color:#fff;padding:19px 21px;text-align:left;width:25%;">步骤</th>' +
      '<th style="background:#534AB7;color:#fff;padding:19px 21px;text-align:left;width:55%;">内容要求</th>' +
      '<th style="background:#534AB7;color:#fff;padding:19px 21px;text-align:center;width:20%;">分值</th>' +
      '</tr></thead><tbody>' +
      '<tr style="border-bottom:1px solid #eee;"><td style="padding:19px 21px;color:#534AB7;font-weight:600;">第一步</td><td style="padding:19px 21px;">规范书写要求</td><td style="padding:19px 21px;text-align:center;">2 分</td></tr>' +
      '<tr style="background:#fafafa;border-bottom:1px solid #eee;"><td style="padding:19px 21px;color:#534AB7;font-weight:600;">第二步</td><td style="padding:19px 21px;">关键计算过程</td><td style="padding:19px 21px;text-align:center;">3 分</td></tr>' +
      '<tr style="border-bottom:1px solid #eee;"><td style="padding:19px 21px;color:#534AB7;font-weight:600;">第三步</td><td style="padding:19px 21px;">结果与检验</td><td style="padding:19px 21px;text-align:center;">2 分</td></tr>' +
      '</tbody></table>',
      'border:1px solid #ddd;border-radius:13px;overflow:hidden;') +
    tEl('el_' + uid(), 64, 605, 1152, 66,
      '<div style="display:flex;align-items:center;gap:16px;text-align:left;padding:0 27px;">' +
      '<strong style="font-size:21px;color:#DC2626;">⚠️ 扣分点：</strong>' +
      '<span style="font-size:20px;color:#555;">常见扣分情况说明</span></div>',
      'background:#FEF2F2;border-radius:11px;'),

  /* ===== 13. 章节导入 ===== */
  'chapter-intro': () =>
    tEl('el_' + uid(), 267, 165, 747, 45,
      '<span style="font-size:24px;color:#534AB7;font-weight:700;letter-spacing:.3em;display:block;text-align:center;">CHAPTER</span>') +
    tEl('el_' + uid(), 213, 232, 853, 99,
      '<span style="font-size:69px;font-weight:700;color:#1f2937;display:block;text-align:center;">章节标题</span>') +
    rEl('el_' + uid(), 573, 354, 133, 6, '#534AB7', 3) +
    tEl('el_' + uid(), 240, 387, 800, 134,
      '<p style="font-size:25px;color:#555;line-height:1.9;text-align:center;margin:0;">引言或问题导入：通过一个问题、故事或实际情境引入本章主题，激发学生学习兴趣。</p>') +
    tEl('el_' + uid(), 267, 555, 747, 62,
      '<span style="font-size:21px;color:#888;display:block;text-align:center;">📚 本章将学习：核心内容 1 · 核心内容 2 · 核心内容 3</span>'),

  /* ===== 14. 板书推演 ===== */
  'blackboard': () =>
    tbTitle('📝 推导过程', '#1E293B') +
    tEl('el_' + uid(), 64, 136, 1152, 121,
      '<div style="display:flex;align-items:center;gap:16px;text-align:left;padding:0 27px;">' +
      '<strong style="font-size:23px;color:#1E293B;">Step 1：</strong>' +
      '<span style="font-size:21px;color:#555;">第一步推导内容：写下关键变形与依据。</span></div>',
      'background:#F8FAFC;border-left:5px solid #1E293B;border-radius:11px;') +
    tEl('el_' + uid(), 64, 278, 1152, 121,
      '<div style="display:flex;align-items:center;gap:16px;text-align:left;padding:0 27px;">' +
      '<strong style="font-size:23px;color:#1E293B;">Step 2：</strong>' +
      '<span style="font-size:21px;color:#555;">第二步推导内容：中间化简与计算过程。</span></div>',
      'background:#F8FAFC;border-left:5px solid #1E293B;border-radius:11px;') +
    tEl('el_' + uid(), 64, 420, 1152, 121,
      '<div style="display:flex;align-items:center;gap:16px;text-align:left;padding:0 27px;">' +
      '<strong style="font-size:23px;color:#1E293B;">Step 3：</strong>' +
      '<span style="font-size:21px;color:#555;">第三步推导内容：整理结果并写出结论。</span></div>',
      'background:#F8FAFC;border-left:5px solid #1E293B;border-radius:11px;') +
    tEl('el_' + uid(), 64, 568, 1152, 103,
      '<div style="display:flex;align-items:center;gap:16px;text-align:left;padding:0 29px;">' +
      '<strong style="font-size:24px;color:#1D4ED8;">∴ 结论：</strong>' +
      '<span style="font-size:21px;color:#555;">最终结论与检验说明。</span></div>',
      'background:#EFF6FF;border:3px solid #3B82F6;border-radius:13px;'),

  /* ===== 15. 综合拆解 ===== */
  'problem-breakdown': () =>
    tbTitle('🔧 综合问题拆解') +
    tEl('el_' + uid(), 64, 136, 1152, 99,
      '<div style="display:flex;align-items:center;gap:16px;text-align:left;padding:0 27px;">' +
      '<strong style="font-size:23px;color:#534AB7;">【综合题】</strong>' +
      '<span style="font-size:21px;color:#444;">复杂综合题目描述：在此给出完整题目。</span></div>',
      'background:#F5F3FF;border:3px solid #C4B5FD;border-radius:13px;') +
    tEl('el_' + uid(), 64, 263, 560, 185,
      '<div style="display:flex;flex-direction:column;align-items:flex-start;text-align:left;padding:27px 29px;gap:11px;">' +
      '<strong style="font-size:25px;color:#534AB7;">第(1)问</strong>' +
      '<p style="margin:0;font-size:20px;color:#555;line-height:1.7;">子问题 1 内容及解题思路</p></div>',
      'background:#fafafa;border-top:5px solid #534AB7;border-radius:13px;') +
    tEl('el_' + uid(), 656, 263, 560, 185,
      '<div style="display:flex;flex-direction:column;align-items:flex-start;text-align:left;padding:27px 29px;gap:11px;">' +
      '<strong style="font-size:25px;color:#0CA678;">第(2)问</strong>' +
      '<p style="margin:0;font-size:20px;color:#555;line-height:1.7;">子问题 2 内容及解题思路</p></div>',
      'background:#fafafa;border-top:5px solid #0CA678;border-radius:13px;') +
    tEl('el_' + uid(), 64, 465, 560, 185,
      '<div style="display:flex;flex-direction:column;align-items:flex-start;text-align:left;padding:27px 29px;gap:11px;">' +
      '<strong style="font-size:25px;color:#E8590A;">第(3)问</strong>' +
      '<p style="margin:0;font-size:20px;color:#555;line-height:1.7;">子问题 3 内容及解题思路</p></div>',
      'background:#fafafa;border-top:5px solid #E8590A;border-radius:13px;') +
    tEl('el_' + uid(), 656, 465, 560, 185,
      '<div style="display:flex;flex-direction:column;align-items:flex-start;text-align:left;padding:27px 29px;gap:11px;">' +
      '<strong style="font-size:25px;color:#DC2626;">第(4)问</strong>' +
      '<p style="margin:0;font-size:20px;color:#555;line-height:1.7;">子问题 4 内容及解题思路</p></div>',
      'background:#fafafa;border-top:5px solid #DC2626;border-radius:13px;'),

  /* ---------- GeoGebra 互动演示（applet + 图片 + 标题） ----------
     设计画布 1280×720（百分比位置，随页面比例自动缩放）：
     - text  标题通栏：top=10% / width=100%
     - img   左侧示例图：left=10% / top=30% / width=40%
     - applet 右侧 GeoGebra 空白计算器：top=30% / right=5% / width=45% */
  'geogebra-applet': (c) => {
    c = c || activeTheme();
    const p = c.primary, fg = c.fg, sub = c.sub, bg = c.bg;
    const imgId = 'el_' + uid();
    const appId = 'el_' + uid();
    return (bg !== '#ffffff' ? rEl('el_' + uid(), 0, 0, 1280, 720, bg, 0) : '') +
      rEl('el_' + uid(), 0, 0, 1280, 12, p, 0) +
      tEl('el_' + uid(), 0, 72, 1280, 93,
        '<span style="font-size:48px;font-weight:700;color:' + fg + ';display:block;text-align:center;width:100%;">GeoGebra 互动演示</span>' +
        '<span style="font-size:23px;color:' + sub + ';display:block;text-align:center;width:100%;margin-top:8px;">拖动图形 · 改变参数 · 直观感受数学</span>') +
      '<div class="slide-element" data-type="image" data-eid="' + imgId + '" contenteditable="false"' +
      ' style="position:absolute;left:128px;top:216px;width:512px;height:432px;">' +
      '<img class="el-image" src="' + imgSvg(p) + '" alt="示例图片" style="width:100%;height:100%;object-fit:cover;border-radius:16px;"></div>' +
      '<div class="slide-element" data-type="embed" data-embed-method="ggb-app" data-eid="' + appId + '"' +
      ' data-ggb-app="graphing" data-ggb-toolbar="1" data-ggb-zoom="1" data-ggb-menubar="0" data-ggb-algebra="0"' +
      ' contenteditable="false"' +
      ' style="position:absolute;left:640px;top:216px;width:576px;height:432px;background:#fff;border:1px solid rgba(0,0,0,0.12);border-radius:16px;box-shadow:0 11px 32px rgba(0,0,0,0.08);">' +
      '<div class="ggb-host ggb-scale-container" style="width:100%;height:100%;"></div>' +
      '<div class="el-embed-overlay"></div></div>';
  },

  /* ---------- Desmos 互动演示（计算器 + 图片 + 标题） ----------
     版式与 GeoGebra 互动模板一致（1280×720 设计画布，百分比位置随页面比例缩放）：
     - text  标题通栏：top=10% / width=100%
     - img   左侧示例图：left=10% / top=30% / width=40%
     - desmos 右侧 Desmos 函数图像计算器：top=30% / right=5% / width=45% */
  'desmos-applet': (c) => {
    c = c || activeTheme();
    const p = c.primary, fg = c.fg, sub = c.sub, bg = c.bg;
    const imgId = 'el_' + uid();
    const desmosId = 'el_' + uid();
    return (bg !== '#ffffff' ? rEl('el_' + uid(), 0, 0, 1280, 720, bg, 0) : '') +
      rEl('el_' + uid(), 0, 0, 1280, 12, p, 0) +
      tEl('el_' + uid(), 0, 72, 1280, 93,
        '<span style="font-size:48px;font-weight:700;color:' + fg + ';display:block;text-align:center;width:100%;">Desmos 互动演示</span>' +
        '<span style="font-size:23px;color:' + sub + ';display:block;text-align:center;width:100%;margin-top:8px;">输入表达式 · 拖动滑块 · 探索函数图像</span>') +
      '<div class="slide-element" data-type="image" data-eid="' + imgId + '" contenteditable="false"' +
      ' style="position:absolute;left:128px;top:216px;width:512px;height:432px;">' +
      '<img class="el-image" src="' + imgSvg(p) + '" alt="示例图片" style="width:100%;height:100%;object-fit:cover;border-radius:16px;"></div>' +
      '<div class="slide-element" data-type="desmos" data-eid="' + desmosId + '"' +
      ' data-desmos-state="" contenteditable="false"' +
      ' style="position:absolute;left:640px;top:216px;width:576px;height:432px;box-shadow:0 11px 32px rgba(0,0,0,0.08);">' +
      '<div class="desmos-bar"><span class="desmos-bar-title">Desmos 计算器</span>' +
      '<span class="desmos-bar-hint">拖动此处移动 · 演示态可交互</span></div>' +
      '<div class="desmos-host"></div></div>';
  },

  /* ---------- 网页嵌入（iframe）模板 ----------
     布局与 Desmos 互动模板一致（1280×720 设计画布，百分比位置随页面比例缩放）：
     - text  标题通栏：top=10% / width=100%
     - img   左侧示例图：left=10% / top=30% / width=40%
     - iframe 右侧网页嵌入：top=30% / right=5% / width=45%
     双击嵌入区可更换网址 / 上传 HTML（离线友好的 data: 占位页） */
  'iframe-applet': (c) => {
    c = c || activeTheme();
    const p = c.primary, fg = c.fg, sub = c.sub, bg = c.bg;
    const imgId = 'el_' + uid();
    const embedId = 'el_' + uid();
    // 默认嵌入 LJ-PPT 自带的自包含示例页（同源相对路径，iframe 可加载）。
    // 双击嵌入区可更换网址 / 上传 HTML。
    const embedSrc = 'web-embed-demo.html';
    return (bg !== '#ffffff' ? rEl('el_' + uid(), 0, 0, 1280, 720, bg, 0) : '') +
      rEl('el_' + uid(), 0, 0, 1280, 12, p, 0) +
      tEl('el_' + uid(), 0, 72, 1280, 93,
        '<span style="font-size:48px;font-weight:700;color:' + fg + ';display:block;text-align:center;width:100%;">网页嵌入演示</span>' +
        '<span style="font-size:23px;color:' + sub + ';display:block;text-align:center;width:100%;margin-top:8px;">嵌入网页示例 · 双击嵌入区可更换网址 / 上传 HTML</span>') +
      '<div class="slide-element" data-type="image" data-eid="' + imgId + '" contenteditable="false"' +
      ' style="position:absolute;left:128px;top:216px;width:512px;height:432px;">' +
      '<img class="el-image" src="' + imgSvg(p) + '" alt="示例图片" style="width:100%;height:100%;object-fit:cover;border-radius:16px;"></div>' +
      '<div class="slide-element" data-type="embed" data-embed-method="url" data-eid="' + embedId + '"' +
      ' data-embed-src="' + escAttr(embedSrc) + '" contenteditable="false"' +
      ' style="position:absolute;left:640px;top:216px;width:576px;height:432px;border-radius:16px;overflow:hidden;box-shadow:0 11px 32px rgba(0,0,0,0.08);">' +
      '<iframe class="el-embed" src="' + escAttr(embedSrc) + '" style="width:100%;height:100%;border:none;"></iframe>' +
      '<div class="el-embed-overlay"></div></div>';
  },

  /* ---------- 基础布局 · 数据统计（大数字卡片） ---------- */
  stats: (c) => {
    c = c || activeTheme();
    const p = c.primary, s = c.secondary, a = c.accent, g = c.success;
    const fg = c.fg, sub = c.sub, bg = c.bg;
    const stat = (l, num, numColor, label, note) => tEl('el_' + uid(), l, 200, 265, 400,
      '<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:8px 32px;gap:14px;">' +
      '<span style="font-size:20px;font-weight:600;color:' + sub + ';">' + label + '</span>' +
      '<span style="font-size:80px;font-weight:800;color:' + numColor + ';line-height:1;">' + num + '</span>' +
      '<span style="font-size:17px;color:' + sub + ';line-height:1.7;">' + note + '</span></div>',
      'background:' + rgba(p, 0.07) + ';border-radius:20px;border:1px solid ' + rgba(p, 0.15) + ';');
    return (bg !== '#ffffff' ? rEl('el_' + uid(), 0, 0, 1280, 720, bg, 0) : '') +
      basicTitle(p, fg, '核心数据') +
      stat(80, '72%', p, '指标 A', '相比上季度提升 12 个百分点') +
      stat(365, '1.8×', s, '指标 B', '覆盖用户数增长近一倍') +
      stat(650, '96', a, '指标 C', '客户满意度保持高位') +
      stat(935, '500+', g, '指标 D', '累计服务客户数量');
  },

  /* ---------- 基础布局 · 卡片网格（三卡并排） ---------- */
  cards: (c) => {
    c = c || activeTheme();
    const p = c.primary, fg = c.fg, sub = c.sub, bg = c.bg;
    const card = (l, icon, title, desc) => tEl('el_' + uid(), l, 200, 350, 420,
      '<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:8px 34px;gap:18px;">' +
      '<span style="width:72px;height:72px;border-radius:20px;background:' + rgba(p, 0.12) + ';display:flex;align-items:center;justify-content:center;font-size:36px;">' + icon + '</span>' +
      '<span style="font-size:28px;font-weight:700;color:' + fg + ';">' + title + '</span>' +
      '<span style="font-size:19px;color:' + sub + ';line-height:1.8;">' + desc + '</span></div>',
      'background:' + (bg !== '#ffffff' ? 'rgba(255,255,255,0.06)' : '#ffffff') + ';border:1px solid ' + rgba(p, 0.14) + ';border-radius:20px;');
    return (bg !== '#ffffff' ? rEl('el_' + uid(), 0, 0, 1280, 720, bg, 0) : '') +
      basicTitle(p, fg, '卡片展示') +
      card(80, '🚀', '核心优势 A', '一句话说明该卡片的内容与价值，突出亮点与差异。') +
      card(465, '⚙️', '核心优势 B', '一句话说明该卡片的内容与价值，突出亮点与差异。') +
      card(850, '🎯', '核心优势 C', '一句话说明该卡片的内容与价值，突出亮点与差异。');
  },

  /* ---------- 基础布局 · 待办清单 ---------- */
  checklist: (c) => {
    c = c || activeTheme();
    const p = c.primary, s = c.secondary, a = c.accent, g = c.success;
    const fg = c.fg, sub = c.sub, bg = c.bg;
    const tones = [g, p, s, a];
    const items = [
      ['梳理本周核心目标与优先级', '重要'],
      ['完成方案初稿并内部评审', '紧急'],
      ['收集反馈并修订细节', '常规'],
      ['整理归档并同步团队', '常规'],
    ];
    let html = (bg !== '#ffffff' ? rEl('el_' + uid(), 0, 0, 1280, 720, bg, 0) : '') +
      basicTitle(p, fg, '待办清单');
    items.forEach((it, i) => {
      html += tEl('el_' + uid(), 80, 200 + i * 110, 1120, 88,
        '<div style="display:flex;align-items:center;gap:26px;text-align:left;padding:0 30px;width:100%;">' +
        '<span style="width:40px;height:40px;border-radius:12px;background:' + tones[i % 4] + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;flex:none;">✓</span>' +
        '<span style="font-size:27px;font-weight:600;color:' + fg + ';flex:1;">' + it[0] + '</span>' +
        '<span style="font-size:16px;font-weight:600;color:' + tones[i % 4] + ';background:' + rgba(tones[i % 4], 0.12) + ';padding:6px 18px;border-radius:999px;flex:none;">' + it[1] + '</span></div>',
        'background:' + (bg !== '#ffffff' ? 'rgba(255,255,255,0.06)' : (i % 2 ? 'rgba(0,0,0,0.02)' : '#ffffff')) + ';border:1px solid ' + rgba(tones[i % 4], 0.18) + ';border-radius:16px;');
    });
    return html;
  },

  /* ---------- 基础布局 · 发展路线（时间轴） ---------- */
  roadmap: (c) => {
    c = c || activeTheme();
    const p = c.primary, s = c.secondary, a = c.accent, g = c.success;
    const fg = c.fg, sub = c.sub, bg = c.bg;
    const tones = [p, s, a, g];
    const steps = ['2023 起步', '2024 成长', '2025 突破', '2026 腾飞'];
    let html = (bg !== '#ffffff' ? rEl('el_' + uid(), 0, 0, 1280, 720, bg, 0) : '') +
      basicTitle(p, fg, '发展路线');
    html += rEl('el_' + uid(), 80, 360, 1120, 5, rgba(p, 0.35), 2.5);
    steps.forEach((st, i) => {
      const x = 80 + i * 280;
      html += rEl('el_' + uid(), x + 108, 348, 26, 26, tones[i % 4], 13) +
        tEl('el_' + uid(), x, 420, 280, 56, '<span style="font-size:24px;font-weight:700;color:' + tones[i % 4] + ';display:block;text-align:center;">' + st + '</span>') +
        tEl('el_' + uid(), x, 490, 280, 130,
          '<span style="font-size:18px;color:' + sub + ';display:block;text-align:center;line-height:1.8;">关键事件与成果说明<br/>里程碑要点记录</span>');
    });
    return html;
  },

  /* ---------- 基础布局 · 快问快答 ---------- */
  qa: (c) => {
    c = c || activeTheme();
    const p = c.primary, s = c.secondary, a = c.accent;
    const fg = c.fg, bg = c.bg;
    const opt = (x, y, tag, text, tone) => tEl('el_' + uid(), x, y, 540, 110,
      '<div style="width:100%;height:100%;display:flex;align-items:center;gap:22px;text-align:left;padding:0 26px;">' +
      '<span style="font-size:22px;font-weight:800;color:' + tone + ';background:' + rgba(tone, 0.14) + ';border-radius:50%;width:52px;height:52px;display:flex;align-items:center;justify-content:center;flex:none;">' + tag + '</span>' +
      '<span style="font-size:24px;color:' + fg + ';">' + text + '</span></div>',
      'background:' + (bg !== '#ffffff' ? 'rgba(255,255,255,0.06)' : '#ffffff') + ';border:2px solid ' + rgba(tone, 0.35) + ';border-radius:14px;');
    return (bg !== '#ffffff' ? rEl('el_' + uid(), 0, 0, 1280, 720, bg, 0) : '') +
      basicTitle(p, fg, '快问快答') +
      tEl('el_' + uid(), 80, 190, 1120, 170,
        '<div style="width:100%;height:100%;display:flex;align-items:center;gap:28px;text-align:left;padding:0 36px;">' +
        '<span style="font-size:44px;font-weight:800;color:#fff;background:' + p + ';border-radius:16px;width:88px;height:88px;display:flex;align-items:center;justify-content:center;flex:none;">Q</span>' +
        '<span style="font-size:32px;font-weight:700;color:' + fg + ';line-height:1.5;">请思考：这里写一个引导思考的核心问题？</span></div>',
        'background:' + (bg !== '#ffffff' ? 'rgba(255,255,255,0.06)' : rgba(p, 0.06)) + ';border-left:8px solid ' + p + ';border-radius:18px;') +
      opt(80, 400, 'A', '选项答案 A', s) +
      opt(660, 400, 'B', '选项答案 B', a) +
      opt(80, 540, 'C', '选项答案 C', a) +
      opt(660, 540, 'D', '选项答案 D', s);
  },

  /* ===== 16. 学习目标 ===== */
  'learning-goals': () => {
    const goal = (l, icon, title, items) => {
      const lis = items.map(function (i) {
        return '<li style="font-size:19px;color:#555;line-height:1.9;">' + i + '</li>';
      }).join('');
      return tEl('el_' + uid(), l, 150, 373, 440,
        '<div style="display:flex;flex-direction:column;align-items:flex-start;text-align:left;padding:28px 26px;gap:12px;">' +
        '<span style="font-size:38px;">' + icon + '</span>' +
        '<span style="font-size:25px;font-weight:700;color:#534AB7;">' + title + '</span>' +
        '<ul style="margin:0;padding-left:22px;">' + lis + '</ul></div>',
        'background:#F5F3FF;border:2px solid #C4B5FD;border-radius:16px;');
    };
    return tbTitle('🎯 学习目标') +
      goal(64, '📖', '知识与技能', ['掌握核心概念与定义', '理解基本定理及推导', '能够完成典型练习']) +
      goal(454, '🔧', '过程与方法', ['经历探究与发现过程', '学会数形结合等思想', '能独立分析并解决问题']) +
      goal(844, '💡', '情感态度', ['激发学习兴趣与动机', '养成严谨思考习惯', '体会数学与生活的联系']);
  },

  /* ===== 17. 重难点 ===== */
  'key-points': () =>
    tbTitle('⚡ 重难点', '#E8590A') +
    tEl('el_' + uid(), 64, 150, 560, 480,
      '<div style="display:flex;flex-direction:column;align-items:flex-start;text-align:left;padding:30px 30px;gap:14px;">' +
      '<span style="font-size:30px;font-weight:800;color:#1D4ED8;">★ 教学重点</span>' +
      '<ul style="margin:0;padding-left:24px;font-size:20px;color:#444;line-height:2.2;">' +
      '<li>重点知识 1 及理解要求</li><li>重点知识 2 及理解要求</li><li>重点知识 3 及理解要求</li></ul></div>',
      'background:#EFF6FF;border:2px solid #93C5FD;border-radius:16px;') +
    tEl('el_' + uid(), 656, 150, 560, 480,
      '<div style="display:flex;flex-direction:column;align-items:flex-start;text-align:left;padding:30px 30px;gap:14px;">' +
      '<span style="font-size:30px;font-weight:800;color:#DC2626;">⚠ 教学难点</span>' +
      '<ul style="margin:0;padding-left:24px;font-size:20px;color:#444;line-height:2.2;">' +
      '<li>难点知识 1 及突破思路</li><li>难点知识 2 及突破思路</li><li>难点知识 3 及突破思路</li></ul></div>',
      'background:#FEF2F2;border:2px solid #FECACA;border-radius:16px;') +
    tEl('el_' + uid(), 64, 652, 1152, 52,
      '<div style="display:flex;align-items:center;gap:12px;text-align:left;padding:0 20px;">' +
      '<strong style="font-size:18px;color:#B45309;">💡 策略：</strong>' +
      '<span style="font-size:17px;color:#78350F;">用情境 / 类比 / 分解法突破难点，配合即时练习巩固。</span></div>',
      'background:#FFFBEB;border-left:5px solid #F59E0B;border-radius:10px;'),

  /* ===== 18. 分层作业 ===== */
  'homework': () =>
    tbTitle('📚 分层作业') +
    tEl('el_' + uid(), 64, 150, 1152, 145,
      '<div style="display:flex;align-items:center;gap:22px;text-align:left;padding:0 28px;">' +
      '<span style="font-size:20px;font-weight:800;color:#fff;background:#0CA678;padding:8px 22px;border-radius:999px;flex:none;">基础巩固</span>' +
      '<span style="font-size:21px;color:#444;">必做：完成课后练习 1–3 题，夯实基础概念</span></div>',
      'background:#F0FDF9;border:2px solid #A7F3D0;border-radius:14px;') +
    tEl('el_' + uid(), 64, 320, 1152, 145,
      '<div style="display:flex;align-items:center;gap:22px;text-align:left;padding:0 28px;">' +
      '<span style="font-size:20px;font-weight:800;color:#fff;background:#534AB7;padding:8px 22px;border-radius:999px;flex:none;">能力提升</span>' +
      '<span style="font-size:21px;color:#444;">选做：完成拓展练习 4–5 题，尝试一题多解</span></div>',
      'background:#F5F3FF;border:2px solid #C4B5FD;border-radius:14px;') +
    tEl('el_' + uid(), 64, 490, 1152, 145,
      '<div style="display:flex;align-items:center;gap:22px;text-align:left;padding:0 28px;">' +
      '<span style="font-size:20px;font-weight:800;color:#fff;background:#E8590A;padding:8px 22px;border-radius:999px;flex:none;">拓展创新</span>' +
      '<span style="font-size:21px;color:#444;">挑战：完成开放性问题，联系生活实际提出新问题</span></div>',
      'background:#FFF8F0;border:2px solid #FDBA74;border-radius:14px;'),

  /* ===== 19. 评价量表 ===== */
  'rubric': () =>
    tbTitle('📊 评价量表') +
    tEl('el_' + uid(), 64, 150, 1152, 470,
      '<table style="width:100%;height:100%;border-collapse:collapse;font-size:18px;">' +
      '<thead><tr>' +
      '<th style="background:#534AB7;color:#fff;padding:16px 18px;text-align:left;width:22%;">评价维度</th>' +
      '<th style="background:#534AB7;color:#fff;padding:16px 18px;text-align:left;width:56%;">评价标准</th>' +
      '<th style="background:#534AB7;color:#fff;padding:16px 18px;text-align:center;width:22%;">星级</th>' +
      '</tr></thead><tbody>' +
      '<tr style="border-bottom:1px solid #eee;"><td style="padding:16px 18px;color:#534AB7;font-weight:700;">知识掌握</td><td style="padding:16px 18px;">概念清晰，能正确应用公式解决问题</td><td style="padding:16px 18px;text-align:center;color:#F59E0B;">★★★☆☆</td></tr>' +
      '<tr style="background:#fafafa;border-bottom:1px solid #eee;"><td style="padding:16px 18px;color:#534AB7;font-weight:700;">过程方法</td><td style="padding:16px 18px;">思路规范，步骤完整，方法得当</td><td style="padding:16px 18px;text-align:center;color:#F59E0B;">★★★★☆</td></tr>' +
      '<tr style="border-bottom:1px solid #eee;"><td style="padding:16px 18px;color:#534AB7;font-weight:700;">合作表达</td><td style="padding:16px 18px;">积极参与讨论，表达清晰有条理</td><td style="padding:16px 18px;text-align:center;color:#F59E0B;">★★★☆☆</td></tr>' +
      '<tr style="background:#fafafa;"><td style="padding:16px 18px;color:#534AB7;font-weight:700;">创新拓展</td><td style="padding:16px 18px;">能提出新问题，尝试多种解法</td><td style="padding:16px 18px;text-align:center;color:#F59E0B;">★★★★★</td></tr>' +
      '</tbody></table>',
      'border:1px solid #ddd;border-radius:14px;overflow:hidden;') +
    tEl('el_' + uid(), 64, 648, 1152, 56,
      '<div style="display:flex;align-items:center;gap:12px;text-align:left;padding:0 20px;">' +
      '<strong style="font-size:17px;color:#B45309;">📌 说明：</strong>' +
      '<span style="font-size:16px;color:#78350F;">综合评价 = 各维度星级汇总，鼓励学生反思与进步。</span></div>',
      'background:#FFFBEB;border-radius:10px;'),

  /* ===== 20. 课后小结 ===== */
  'review': () =>
    tbTitle('🔁 课后小结') +
    tEl('el_' + uid(), 64, 150, 560, 460,
      '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:30px 30px;gap:12px;">' +
      '<span style="font-size:28px;font-weight:800;color:#0CA678;">✅ 今日收获</span>' +
      '<p style="margin:0;font-size:19px;color:#555;line-height:1.9;">回顾本节课学到的核心知识与方法，写下印象最深的结论。</p>' +
      '<span style="font-size:28px;font-weight:800;color:#E8590A;margin-top:24px;">❓ 我的疑惑</span>' +
      '<p style="margin:0;font-size:19px;color:#555;line-height:1.9;">记录还没有弄明白的地方，下节课提问或课后请教。</p></div>',
      'background:#ffffff;border:2px solid #e5e7eb;border-radius:16px;') +
    tEl('el_' + uid(), 656, 150, 560, 460,
      '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:30px 30px;gap:12px;">' +
      '<span style="font-size:28px;font-weight:800;color:#534AB7;">📌 待巩固</span>' +
      '<p style="margin:0;font-size:19px;color:#555;line-height:1.9;">列出需要反复练习的题型与易错点。</p>' +
      '<span style="font-size:28px;font-weight:800;color:#1D4ED8;margin-top:24px;">🔭 下节预告</span>' +
      '<p style="margin:0;font-size:19px;color:#555;line-height:1.9;">提前浏览下节课内容，带着问题走进课堂。</p></div>',
      'background:#ffffff;border:2px solid #e5e7eb;border-radius:16px;') +
    tEl('el_' + uid(), 64, 640, 1152, 56,
      '<div style="display:flex;align-items:center;justify-content:center;gap:10px;">' +
      '<span style="font-size:18px;color:#ffffff;">💪 每天进步一点点，坚持带来大改变</span></div>',
      'background:linear-gradient(90deg,#534AB7,#7C3AED);color:#fff;border-radius:12px;'),

  };

  /* ===== Presentation themes (template library color palettes) ===== */
  const Themes = {
    business: { id: 'business', name: '商务蓝', bg: '#ffffff',
      primary: '#1F3A5F', secondary: '#6B7280', accent: '#C4622D', success: '#1E4D3B',
      dark: '#0F172A', fg: '#1F2328', sub: '#5B6472', faint: '#9AA3B2', light: '#F6F7F9',
      ink: '#1F2328', paper: '#ffffff', shadow: '0 1px 3px rgba(20,30,60,0.08)' },
    dark: { id: 'dark', name: '深色科技', bg: '#0D1117',
      primary: '#39C5CF', secondary: '#8B949E', accent: '#E3B341', success: '#3FB950',
      dark: '#0D1117', fg: '#E6EDF3', sub: '#8B949E', faint: '#6E7681', light: '#161B22',
      ink: '#E6EDF3', paper: '#0D1117', shadow: '0 1px 3px rgba(0,0,0,0.4)' },
    nature: { id: 'nature', name: '自然清新', bg: '#ffffff',
      primary: '#1E4D3B', secondary: '#6B7280', accent: '#B3541E', success: '#2F7D5B',
      dark: '#0F3A2B', fg: '#1F2328', sub: '#5B6472', faint: '#9AA3B2', light: '#F0F5F1',
      ink: '#1F2328', paper: '#ffffff', shadow: '0 1px 3px rgba(30,60,45,0.08)' },
  };

  // hex color → "r,g,b" is defined above (hexRgb); rgba helper builds an rgba() string
  function rgba(hex, a) {
    return 'rgba(' + hexRgb(hex) + ',' + a + ')';
  }
  // themed SVG placeholder for image areas (offline-safe data URI)
  function imgSvg(hex) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + hex + '"/>' +
      '<stop offset="1" stop-color="#0ea5e9"/></linearGradient></defs>' +
      '<rect width="640" height="480" fill="url(#g)"/>' +
      '<circle cx="520" cy="120" r="90" fill="rgba(255,255,255,0.18)"/>' +
      '<circle cx="120" cy="400" r="70" fill="rgba(255,255,255,0.14)"/>' +
      '<rect x="80" y="190" width="480" height="14" rx="7" fill="rgba(255,255,255,0.75)"/>' +
      '<rect x="80" y="230" width="360" height="14" rx="7" fill="rgba(255,255,255,0.45)"/>' +
      '<rect x="80" y="270" width="400" height="14" rx="7" fill="rgba(255,255,255,0.45)"/>' +
      '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /* ===== Template fit-to-stage =====
     Templates are designed once on the 1280×720 (16:9) design canvas, but the
     presentation can run at other sizes/ratios (4:3, 1:1 square, A4).
     fitTemplateHtml() rescales a 1280×720-designed template to the current page
     size so elements always fill the page proportionally:
       - element boxes (left/top/width/height) scale by directional factors
         (fx for x, fy for y), keeping percentage positions exact;
       - fonts, paddings, radii & other px lengths inside styles scale by the
         smaller of the two factors so text never overflows its box. */
  function stageDims() {
    const size = (project && project.meta && project.meta.size) || 'default';
    return sizeMap(size);
  }

  function fitTemplateHtml(html, dims) {
    if (!html) return html;
    dims = dims || stageDims();
    const fx = dims.w / 1280, fy = dims.h / 720;
    const f = Math.min(fx, fy);
    if (Math.abs(fx - 1) < 0.001 && Math.abs(fy - 1) < 0.001) return html;
    try {
      const doc = new DOMParser().parseFromString('<div id="__tplfit">' + html + '</div>', 'text/html');
      const root = doc.getElementById('__tplfit');
      if (!root) return html;
      // record the design-time geometry of every slide element first
      const boxes = [];
      root.querySelectorAll('.slide-element').forEach(function (el) {
        const st = el.getAttribute('style') || '';
        const read = function (prop) {
          const m = st.match(new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([\\d.]+)px'));
          return m ? parseFloat(m[1]) : null;
        };
        boxes.push({ el: el, left: read('left'), top: read('top'), width: read('width'), height: read('height') });
      });
      // scale every px length inside every style attribute by the smaller factor
      root.querySelectorAll('[style]').forEach(function (el) {
        const st = el.getAttribute('style');
        el.setAttribute('style', st.replace(/([\d.]+)px/g, function (m, n) {
          return (parseFloat(n) * f).toFixed(1) + 'px';
        }));
      });
      // then apply directional scaling to element boxes (overrides the uniform pass)
      boxes.forEach(function (b) {
        if (b.left === null && b.top === null && b.width === null && b.height === null) return;
        let st = (b.el.getAttribute('style') || '');
        st = st.replace(/(?:^|;)\s*(?:left|top|width|height)\s*:\s*[^;]+/g, ';');
        st = st.replace(/^;/, '').replace(/;+/g, ';').replace(/;\s*$/, '');
        const kv = [];
        if (b.left !== null) kv.push('left:' + Math.round(b.left * fx) + 'px');
        if (b.top !== null) kv.push('top:' + Math.round(b.top * fy) + 'px');
        if (b.width !== null) kv.push('width:' + Math.round(b.width * fx) + 'px');
        if (b.height !== null) kv.push('height:' + Math.round(b.height * fy) + 'px');
        b.el.setAttribute('style', st + (st ? ';' : '') + kv.join(';'));
      });
      return root.innerHTML;
    } catch (e) {
      return html;
    }
  }

  /* ===== Pro layouts (theme-aware, PowerPoint-style, 12 layouts) ===== */
    /* =====================================================================
     "手作创意工作室" Pro 模板设计系统（v69）
     三种语汇（借鉴 beautiful-html-templates 模板库）：
       1) 便签软木板 —— 粉彩便签 + 图钉 + 微旋转 + KaiTi 手写批注
       2) 新粗野主义 —— 粗墨边框 + 硬偏移阴影 + 高对比色块
       3) 编辑杂志风 —— 大字重标题 + 大写字距导语 + 手绘涂鸦
     全部使用离线系统字体（KaiTi 手写、系统黑体粗重标题）。
     三个主题（商务蓝/深色科技/自然清新）通过 P() 提供 ink/paper/shadow
     等语义色，同一套版式在深浅背景上都成立。
     ===================================================================== */

  // 语义色解析：主题对象 -> 设计系统色板
    /* =====================================================================
     "手作创意工作室" Pro 模板设计系统（v69）
     三种语汇（借鉴 beautiful-html-templates 模板库）：
       1) 便签软木板 —— 粉彩便签 + 图钉 + 微旋转 + KaiTi 手写批注
       2) 新粗野主义 —— 粗墨边框 + 硬偏移阴影 + 高对比色块
       3) 编辑杂志风 —— 大字重标题 + 大写字距导语 + 手绘涂鸦
     全部使用离线系统字体（KaiTi 手写、系统黑体粗重标题）。
     三个主题（商务蓝/深色科技/自然清新）通过 P() 提供 ink/paper/shadow
     等语义色，同一套版式在深浅背景上都成立。
     ===================================================================== */

  // 语义色解析：主题对象 -> 设计系统色板
  function P(x) {
    // Modern skill-style tokens (A1 现代精致系)。保留原有字段，仅新增，不破坏旧模板。
    // grad: 主渐变; gradSoft: 柔和浅渐变; surface: 半透明卡片底; surf: 不透明卡片底;
    // blur: 毛玻璃投影; radius: 卡片大圆角; glow: 背景光斑色; accentGrad：渐变强调色。
    // 【去 AI 味】radius 收敛到 ≤8，渐变/光斑置空，阴影克制——符合设计宪法。
    const dark = x.bg === '#0D1117' || x.bg === '#0B1020';
    const t = {
      ink: x.ink || '#2B2A28',
      paper: x.paper || '#F6F1E7',
      shadow: x.shadow || '0 1px 3px rgba(43,42,40,0.08)',
      a: x.primary, s: x.secondary, acc: x.accent, g: x.success,
      fg: x.fg, sub: x.sub, fa: x.faint,
      card: dark ? x.light : '#FFFDF7',
      dark: dark,
      // ---- 去 AI 味的规范 token ----
      radius: 8,
      radiusSm: 4,
      grad: '', gradSoft: '',
      surface: dark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.86)',
      surf: dark ? '#131A30' : '#FFFFFF',
      surf2: dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.03)',
      border: dark ? 'rgba(180,200,255,0.14)' : 'rgba(15,23,42,0.08)',
      blur: 'initial', blurLg: 'initial',
      glow: '', glow2: '', glow3: '',
    };
    return t;
  }

  // 纸张背景：全幅纯色画布 + 可选淡点阵纹理（装饰层）
  function pBg(x, dots) {
    let h = rEl('el_' + uid(), 0, 0, 1280, 720, x.paper, 0);
    // 现代质感：默认叠一层柔和渐变光斑（仅在支持现代 token 时），让专业模板整体更精致。
    // dots 参数仍用点阵纹理（兼容旧模板），二者可共存，光斑更克制。
    if (x.glow && x.glow2) {
      h += tEl('el_' + uid(), 0, 0, 1280, 720,
        '<div style="width:100%;height:100%;box-sizing:border-box;pointer-events:none;' +
        'background:radial-gradient(60% 52% at 14% 10%,' + x.glow + ',transparent 70%),' +
        'radial-gradient(52% 46% at 88% 16%,' + x.glow2 + ',transparent 70%),' +
        'radial-gradient(60% 56% at 50% 104%,' + (x.glow3 || x.glow) + ',transparent 74%);"></div>',
        'pointer-events:none;');
    }
    if (dots) {
      let pts = '';
      for (let i = 48; i < 1280; i += 64) {
        for (let j = 48; j < 720; j += 64) {
          pts += '<circle cx="' + i + '" cy="' + j + '" r="2.5" fill="' + x.ink + '" opacity="0.07"/>';
        }
      }
      h += tEl('el_' + uid(), 0, 0, 1280, 720,
        '<svg width="100%" height="100%" viewBox="0 0 1280 720" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' + pts + '</svg>',
        'pointer-events:none;');
    }
    return h;
  }

  // 粉彩便签色板（低饱和、克制——去 AI 味的彩虹感，贴近 PPT 强调色浅底）
  const NOTE_PAL = {
    yellow: '#FDF3D8', blue: '#E3EDFB', pink: '#FAE7EA', green: '#E5F3E8',
    orange: '#FBEEDB', purple: '#EDE8F8',
  };

  // 便签卡片：粉彩底 + 图钉(可选) + 柔和分层阴影 + 微旋转 + 现代圆角
  function pNote(x, l, t, w, h, v, html, o) {
    o = o || {};
    const pin = o.pin
      ? '<span style="position:absolute;top:-7px;left:50%;margin-left:-6px;width:12px;height:12px;border-radius:50%;background:radial-gradient(circle at 35% 35%,' + (o.pinC || '#FF8A8A') + ',' + (o.pinD || '#D96C6C') + ');box-shadow:0 1px 3px rgba(0,0,0,0.22);opacity:.7;"></span>'
      : '';
    const rot = o.rot ? 'transform:rotate(' + (o.rot * 0.6) + 'deg);' : '';
    const radius = o.radius != null ? o.radius : x.radiusSm;
    const fill = v === 'white'
      // dark 主题下白色便签用浅底，保证深色(#2B2A28)手写文字可读；否则用主题卡片色。
      ? 'background:' + (x.dark ? 'rgba(255,255,255,0.92)' : x.card) + ';border:1px solid ' + x.border + ';'
      : 'background:' + NOTE_PAL[v] + ';border:1px solid ' + x.border + ';';
    // 现代柔和投影；o.hard 回退到硬阴影。
    const shadow = o.hard ? x.shadow : x.blur;
    return tEl('el_' + uid(), l, t, w, h,
      '<div style="position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:' + (o.align || 'flex-start') + ';justify-content:center;text-align:' + (o.align === 'center' ? 'center' : 'left') + ';padding:' + (o.pad || '20px 26px') + ';box-sizing:border-box;box-shadow:' + shadow + ';border-radius:' + radius + 'px;">' + pin + html + '</div>',
      fill + 'border-radius:' + radius + 'px;' + rot);
  }

  // 卡片：默认现代卡（大圆角 + 柔和投影 + 半透明 surface）；o.hard 回退到粗野便签风。
  function pCard(x, l, t, w, h, html, o) {
    o = o || {};
    const rot = o.rot ? 'transform:rotate(' + o.rot + 'deg);' : '';
    const hard = o.hard;
    const pad = o.pad || '26px 30px';
    const radius = hard ? (o.r != null ? o.r : 0) : (o.radius != null ? o.radius : x.radius);
    const bg = hard ? (o.bg || x.card) : (o.bg || x.surface);
    const border = hard ? 'border:3px solid ' + x.ink + ';' : 'border:1px solid ' + x.border + ';';
    const shadow = hard ? x.shadow : (o.shadow || x.blur);
    const blur = hard ? '' : 'backdrop-filter:blur(14px) saturate(150%);-webkit-backdrop-filter:blur(14px) saturate(150%);';
    // 现代卡可选顶部渐变强调条
    const topBar = (!hard && o.bar)
      ? '<div style="position:absolute;left:0;top:0;right:0;height:5px;background:' + (o.barC || x.grad) + ';border-radius:' + radius + 'px ' + radius + 'px 0 0;"></div>'
      : '';
    return tEl('el_' + uid(), l, t, w, h,
      '<div style="position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:' + (o.align || 'flex-start') + ';justify-content:center;text-align:' + (o.align === 'center' ? 'center' : 'left') + ';padding:' + pad + ';box-sizing:border-box;">' + topBar + html + '</div>',
      'background:' + bg + ';' + border + 'border-radius:' + radius + 'px;box-shadow:' + shadow + ';' + blur + rot);
  }

  // KaiTi 手写体
  function pHand(x, txt, size, color, more) {
    return '<span style="font-family:\'KaiTi\',\'楷体\',\'STKaiti\',\'Kaiti SC\',cursive;font-size:' + (size || 26) + 'px;color:' + (color || x.sub) + ';line-height:1.55;' + (more || '') + '">' + txt + '</span>';
  }

  // 现代大字距导语：默认渐变强调色；传入 color 时用指定色（兼容旧模板）。
  function pKicker(x, txt, align, color) {
    const inner = color
      ? 'color:' + color + ';'
      : 'background:' + x.grad + ';-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:' + x.a + ';';
    return '<span style="font-size:16px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;' + inner + ';display:block;text-align:' + (align || 'left') + ';width:100%;">' + txt + '</span>';
  }

  // 墨色大标题（可选粗野下划线）
  function pTitle(x, l, t, w, txt, size, o) {
    o = o || {};
    let h = tEl('el_' + uid(), l, t, w, Math.round((size || 68) * 1.45),
      '<span style="font-size:' + (size || 68) + 'px;font-weight:900;color:' + x.ink + ';line-height:1.18;display:block;text-align:' + (o.align || 'left') + ';width:100%;">' + txt + '</span>');
    if (o.band) {
      h += rEl('el_' + uid(), l, t + Math.round((size || 68) * 1.45) + 10, o.band, 10, o.bandColor || x.a, 0);
    }
    return h;
  }

  // 内容页统一页头：导语 + 标题 + 下划线
  function pHead(x, l, t, kick, title, o) {
    o = o || {};
    const ts = o.size || 54;
    return tEl('el_' + uid(), l, t, 700, 36, pKicker(x, kick)) +
      tEl('el_' + uid(), l, t + 38, 800, Math.round(ts * 1.45), '<span style="font-size:' + ts + 'px;font-weight:900;color:' + x.ink + ';line-height:1.2;display:block;text-align:left;width:100%;">' + title + '</span>') +
      rEl('el_' + uid(), l, t + 38 + Math.round(ts * 1.45) + 8, o.band || 130, 9, x.a, 0);
  }

  // 手绘涂鸦装饰（SVG，指针穿透）
  function pDoodle(l, t, size, kind, ink, o) {
    o = o || {};
    const paths = {
      circle: '<circle cx="50" cy="50" r="40" fill="none" stroke="' + ink + '" stroke-width="3" opacity="0.15"/>',
      ring: '<circle cx="50" cy="50" r="38" fill="none" stroke="' + ink + '" stroke-width="3" opacity="0.15" stroke-dasharray="12 8"/>',
      cross: '<path d="M32 32 L68 68 M68 32 L32 68" stroke="' + ink + '" stroke-width="4" opacity="0.15" stroke-linecap="round"/>',
      plus: '<path d="M50 22 L50 78 M22 50 L78 50" stroke="' + ink + '" stroke-width="5" opacity="0.15" stroke-linecap="round"/>',
      tri: '<polygon points="50,14 86,78 14,78" fill="none" stroke="' + ink + '" stroke-width="3" opacity="0.15"/>',
      squiggle: '<path d="M8 30 Q28 8 48 30 T88 30" stroke="' + ink + '" stroke-width="3" fill="none" opacity="0.15" stroke-linecap="round"/>',
    };
    const vb = kind === 'squiggle' ? '0 0 100 100' : '0 0 100 100';
    return tEl('el_' + uid(), l, t, size, size,
      '<svg viewBox="' + vb + '" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">' + (paths[kind] || paths.circle) + '</svg>',
      'pointer-events:none;');
  }

  // 拍立得相纸（含示例图，可双击替换）
  function pPhoto(x, l, t, w, hex, rot, cap) {
    const innerH = Math.round((w - 24) * 0.75);
    return '<div class="slide-element" data-type="image" data-eid="' + uid() + '" contenteditable="false"' +
      ' style="position:absolute;left:' + l + 'px;top:' + t + 'px;width:' + w + 'px;height:' + (innerH + 42) + 'px;transform:rotate(' + (rot || 0) + 'deg);">' +
      '<div style="position:absolute;inset:0;background:#FFFDF7;padding:10px 10px 8px;box-shadow:' + x.shadow + ';box-sizing:border-box;">' +
      '<img class="el-image" src="' + imgSvg(hex) + '" alt="示例图片" style="width:100%;height:' + (innerH + 6) + 'px;object-fit:cover;display:block;">' +
      (cap ? '<div style="text-align:center;font-size:15px;color:#5C5750;padding-top:7px;font-family:\'KaiTi\',\'楷体\',\'STKaiti\',cursive;">' + cap + '</div>' : '') +
      '</div></div>';
  }

  // 墨块数字章
  function pNumChip(x, txt, size) {
    const s = size || 46;
    return '<span style="display:inline-flex;align-items:center;justify-content:center;width:' + s + 'px;height:' + s + 'px;background:' + x.ink + ';color:' + x.paper + ';font-size:' + Math.round(s * 0.52) + 'px;font-weight:800;flex:none;border-radius:' + (s > 56 ? Math.round(s / 2) : 3) + 'px;">' + txt + '</span>';
  }

  // 粉彩小圆片（目录编号等）
  function pPastelChip(txt, v) {
    return '<span style="display:inline-flex;align-items:center;justify-content:center;width:58px;height:58px;background:' + NOTE_PAL[v] + ';color:#2B2A28;font-size:25px;font-weight:800;flex:none;border-radius:3px;box-shadow:3px 3px 0 rgba(43,42,40,0.18);">' + txt + '</span>';
  }

  // 衬线展示字体栈（系统衬线，离线可用）—— 极简·去AI 系列使用
  const SERIF = "'Noto Serif SC','Songti SC','SimSun','STSong',serif";

  /* ===== 现代精致系 helpers（A1 · skill 风）=====
     保留 tEl/rEl 绝对定位坐标系，仅把视觉语言升级为：
       柔和多层投影 + 大圆角 + 半透明 surface + 渐变光斑背景 + 现代字体层级。 */

  // 渐变光斑背景：全幅 canvas + 3 个 radial 光斑。g1/g2/g3 为主题光斑色。
  function pGradBg(x, g1, g2, g3) {
    let h = rEl('el_' + uid(), 0, 0, 1280, 720, x.paper, 0);
    h += tEl('el_' + uid(), 0, 0, 1280, 720,
      '<div style="width:100%;height:100%;box-sizing:border-box;pointer-events:none;' +
      'background:radial-gradient(52% 46% at 16% 12%,' + (g1 || x.glow) + ',transparent 70%),' +
      'radial-gradient(50% 46% at 84% 20%,' + (g2 || x.glow2) + ',transparent 70%),' +
      'radial-gradient(58% 54% at 50% 100%,' + (g3 || x.glow3) + ',transparent 72%);"></div>',
      'pointer-events:none;');
    return h;
  }

  // 现代卡片：半透明 surface + 大圆角 + 分层柔和投影 + 可选顶部渐变强调条。
  function pModernCard(x, l, t, w, h, html, o) {
    o = o || {};
    const pad = o.pad || '26px 30px';
    const topBar = o.bar
      ? '<div style="position:absolute;left:0;top:0;right:0;height:5px;background:' + (o.barC || x.grad) + ';border-radius:' + x.radius + 'px ' + x.radius + 'px 0 0;"></div>'
      : '';
    const bg = o.bg || x.surface;
    return tEl('el_' + uid(), l, t, w, h,
      '<div style="position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:' + (o.align || 'flex-start') + ';justify-content:center;text-align:' + (o.align === 'center' ? 'center' : 'left') + ';padding:' + pad + ';box-sizing:border-box;">' + topBar + html + '</div>',
      'background:' + bg + ';backdrop-filter:blur(14px) saturate(150%);-webkit-backdrop-filter:blur(14px) saturate(150%);' +
      'border:1px solid ' + x.border + ';border-radius:' + (o.radius != null ? o.radius : x.radius) + 'px;box-shadow:' + (o.shadow || x.blur) + ';');
  }

  // 现代导语：大写小字距 + 渐变强调色（可选 lede 副标题）。
  function pModernKicker(x, txt, o) {
    o = o || {};
    return '<span style="font-size:' + (o.size || 14.5) + 'px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:' + x.a + ';display:block;text-align:' + (o.align || 'left') + ';width:100%;">' + txt + '</span>';
  }

  // 渐变数字/文字强调（数据页大数字等）。默认纯主色，贴近 PPT 数据强调；
  // 传入 gradient=true 才用同色系渐变（现已收敛为单色相，不刺眼）。
  function pGradText(x, txt, size, gradient) {
    const inner = gradient
      ? ('background:' + x.grad + ';-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:' + x.a + ';')
      : '';
    return '<span style="font-size:' + (size || 92) + 'px;font-weight:700;line-height:1.05;letter-spacing:-.01em;' + inner + 'color:' + x.a + ';">' + txt + '</span>';
  }

  // 圆角渐变数字徽章（要点编号等）。
  function pNumChip2(x, txt, size) {
    const s = size || 46;
    return '<span style="display:inline-flex;align-items:center;justify-content:center;width:' + s + 'px;height:' + s + 'px;background:' + x.grad + ';color:#fff;font-size:' + Math.round(s * 0.5) + 'px;font-weight:800;flex:none;border-radius:' + Math.round(s / 2) + 'px;box-shadow:' + (x.dark ? '0 6px 16px rgba(0,0,0,0.4)' : '0 6px 16px rgba(37,99,235,0.24)') + ';">' + txt + '</span>';
  }

  const ProLayouts = {

    /* ============ 封面（8） ============ */

    /* ---- 大字报封面：墨色大标题 + 便签副标题 ---- */
    'p-cover': (c) => {
      const x = P(c);
      return pGradBg(x) +
        tEl('el_' + uid(), 128, 120, 640, 40, pModernKicker(x, 'PRESENTATION · 2026')) +
        tEl('el_' + uid(), 128, 178, 980, 250,
          '<span style="font-size:88px;font-weight:700;line-height:1.12;letter-spacing:-.01em;color:' + x.ink + ';display:block;text-align:left;">演示标题<br/><span style="color:' + x.a + ';">从这里开始</span></span>') +
        pModernCard(x, 132, 470, 600, 128,
          '<span style="font-size:23px;line-height:1.75;color:' + x.sub + ';display:block;text-align:left;">一句话副标题，说明这份演示的主题与核心价值。饱满而克制，预留足够的呼吸感。</span>',
          { pad: '24px 30px', bar: true, barC: x.grad }) +
        tEl('el_' + uid(), 128, 646, 600, 36, '<span style="font-size:19px;letter-spacing:.06em;color:' + x.fa + ';display:block;text-align:left;">作者姓名 · 2026 年 8 月</span>') +
        pModernCard(x, 830, 150, 340, 220,
          '<span style="font-size:16px;font-weight:700;letter-spacing:.2em;color:' + x.a + ';">IDEA</span>' +
          '<span style="font-size:25px;line-height:1.6;color:' + x.ink + ';margin-top:16px;display:block;text-align:left;">把想法凝练成一束光，让灵感自然生长</span>',
          { pad: '24px 28px', bg: x.surface2 }) +
        tEl('el_' + uid(), 1184, 132, 20, 20,
          '<span style="display:block;width:20px;height:20px;border-radius:6px;background:' + x.grad + ';"></span>');
    },

    /* ---- 色块封面：粗野主色块 + 白字标题 ---- */
    'p-cover-hero': (c) => {
      const x = P(c);
      return pBg(x, true) +
        tEl('el_' + uid(), 160, 92, 640, 40, pKicker(x, 'PROJECT · 2026')) +
        rEl('el_' + uid(), 178, 258, 960, 200, x.a, 0) +
        rEl('el_' + uid(), 160, 240, 960, 200, x.a, 0) +
        tEl('el_' + uid(), 160, 240, 960, 200,
          '<span style="font-size:68px;font-weight:700;color:#FFFFFF;line-height:1.16;display:block;text-align:center;width:100%;">演示文稿大标题</span>') +
        pCard(x, 420, 486, 440, 110,
          '<span style="font-size:22px;line-height:1.65;color:' + x.ink + ';display:block;text-align:center;width:100%;">一句话副标题，说明主题与核心价值</span>',
          { bg: x.surface, align: 'center', pad: '20px 30px' }) +
        tEl('el_' + uid(), 160, 620, 960, 36, '<span style="font-size:20px;color:' + x.fa + ';display:block;text-align:center;">作者姓名 · 2026 年 8 月</span>') +
        pDoodle(60, 90, 90, 'ring', x.ink) +
        pDoodle(1120, 560, 70, 'plus', x.ink);
    },

    /* ---- 分屏封面：左墨色面板 + 右便签 ---- */
    'p-cover-split': (c) => {
      const x = P(c);
      return pBg(x, false) +
        rEl('el_' + uid(), 0, 0, 520, 720, x.ink, 0) +
        rEl('el_' + uid(), 520, 0, 8, 720, x.a, 0) +
        tEl('el_' + uid(), 64, 96, 400, 40, pKicker(x, 'PROJECT · 2026', 'left', x.acc)) +
        tEl('el_' + uid(), 64, 200, 400, 260,
          '<span style="font-size:62px;font-weight:700;color:' + x.paper + ';line-height:1.18;display:block;text-align:left;">演示标题<br/>从这里开始</span>') +
        tEl('el_' + uid(), 68, 470, 220, 10, x.acc, 0) +
        pCard(x, 620, 210, 500, 150,
          '<span style="font-size:25px;color:' + x.ink + ';line-height:1.7;">一句话副标题，说明这份演示的主题与核心价值</span>',
          { bg: x.surface, align: 'flex-start', pad: '26px 30px' }) +
        tEl('el_' + uid(), 620, 410, 480, 40, '<span style="font-size:21px;color:' + x.sub + ';">作者姓名 · 2026 年 8 月</span>') +
        pCard(x, 740, 500, 260, 100, '<span style="font-size:23px;color:' + x.ink + ';">感谢观看 · 欢迎交流</span>', { bg: x.surface, align: 'center', pad: '0 16px' }) +
        pDoodle(1140, 120, 80, 'cross', x.ink) +
        pDoodle(600, 610, 70, 'ring', x.ink);
    },

    /* ---- 极简封面：上下墨线 + 居中标题 ---- */
    'p-cover-minimal': (c) => {
      const x = P(c);
      return pBg(x, false) +
        tEl('el_' + uid(), 128, 180, 640, 40, pKicker(x, 'MINIMAL DECK')) +
        rEl('el_' + uid(), 128, 244, 1024, 4, x.ink, 2) +
        tEl('el_' + uid(), 128, 276, 1024, 150,
          '<span style="font-size:78px;font-weight:900;color:' + x.ink + ';line-height:1.15;display:block;text-align:left;">演示文稿标题</span>') +
        rEl('el_' + uid(), 128, 452, 1024, 4, x.ink, 2) +
        tEl('el_' + uid(), 128, 490, 820, 60, '<span style="font-size:27px;color:' + x.sub + ';">一句话副标题，说明这份演示的主题与核心价值</span>') +
        tEl('el_' + uid(), 128, 588, 600, 36, '<span style="font-size:20px;color:' + x.fa + ';">作者姓名 · 2026 年 8 月</span>') +
        rEl('el_' + uid(), 1156, 130, 26, 26, x.a, 3) +
        pDoodle(1140, 600, 70, 'ring', x.ink);
    },

    /* ---- 居中封面：粗框 + 居中内容 ---- */
    'p-cover-center': (c) => {
      const x = P(c);
      return pBg(x, false) +
        pCard(x, 90, 90, 1100, 540, '', { r: 0, pad: '0' }) +
        tEl('el_' + uid(), 140, 150, 1000, 40, pKicker(x, 'PRESENTATION · 2026', 'center')) +
        tEl('el_' + uid(), 140, 226, 1000, 170,
          '<span style="font-size:84px;font-weight:900;color:' + x.ink + ';line-height:1.15;display:block;text-align:center;width:100%;">演示文稿标题</span>') +
        rEl('el_' + uid(), 560, 424, 160, 11, x.a, 0) +
        tEl('el_' + uid(), 140, 470, 1000, 60, '<span style="font-size:27px;color:' + x.sub + ';display:block;text-align:center;">一句话副标题，说明这份演示的主题与核心价值</span>') +
        tEl('el_' + uid(), 140, 556, 1000, 36, '<span style="font-size:20px;color:' + x.fa + ';display:block;text-align:center;">作者姓名 · 2026 年 8 月</span>') +
        pDoodle(70, 70, 60, 'plus', x.ink) +
        pDoodle(1150, 590, 80, 'ring', x.ink);
    },

    /* ---- 卡片封面：主便签 + 右侧三要点 ---- */
    'p-cover-card': (c) => {
      const x = P(c);
      return pBg(x, true) +
        pCard(x, 110, 190, 700, 250,
          '<span style="font-size:78px;font-weight:700;color:' + x.ink + ';line-height:1.12;">演示文稿<br/>标题</span>' +
          '<span style="font-size:24px;color:' + x.a + ';margin-top:14px;display:block;">从这里开始，讲述一个好故事</span>',
          { bg: x.surface, bar: true, barC: x.grad, align: 'flex-start', pad: '34px 36px' }) +
        pCard(x, 880, 130, 310, 120,
          '<div style="display:flex;align-items:center;gap:16px;width:100%;">' + pNumChip2(x, '01', 40) + '<span style="font-size:24px;font-weight:600;color:' + x.ink + ';">主题概览</span></div>',
          { bg: x.surface, align: 'flex-start', pad: '0 24px' }) +
        pCard(x, 880, 300, 310, 120,
          '<div style="display:flex;align-items:center;gap:16px;width:100%;">' + pNumChip2(x, '02', 40) + '<span style="font-size:24px;font-weight:600;color:' + x.ink + ';">核心内容</span></div>',
          { bg: x.surface, align: 'flex-start', pad: '0 24px' }) +
        pCard(x, 880, 470, 310, 120,
          '<div style="display:flex;align-items:center;gap:16px;width:100%;">' + pNumChip2(x, '03', 40) + '<span style="font-size:24px;font-weight:600;color:' + x.ink + ';">行动计划</span></div>',
          { bg: x.surface, align: 'flex-start', pad: '0 24px' }) +
        tEl('el_' + uid(), 110, 520, 700, 36, '<span style="font-size:20px;color:' + x.fa + ';">作者姓名 · 2026 年 8 月</span>') +
        pDoodle(60, 120, 70, 'cross', x.ink) +
        pDoodle(1120, 620, 80, 'ring', x.ink);
    },

    /* ---- 网格封面：四角粗野卡 + 中央标题 ---- */
    'p-cover-grid': (c) => {
      const x = P(c);
      return pBg(x, false) +
        pCard(x, 80, 80, 340, 150, '<span style="font-size:48px;font-weight:700;color:' + x.a + ';">01</span>' + '<span style="font-size:24px;font-weight:600;color:' + x.ink + ';margin-top:6px;">战略</span>', { bg: x.surface, bar: true, barC: x.grad, align: 'flex-start', pad: '20px 24px' }) +
        pCard(x, 860, 80, 340, 150, '<span style="font-size:48px;font-weight:700;color:' + x.s + ';">02</span>' + '<span style="font-size:24px;font-weight:600;color:' + x.ink + ';margin-top:6px;">方案</span>', { bg: x.surface, bar: true, barC: x.grad, align: 'flex-start', pad: '20px 24px' }) +
        pCard(x, 80, 490, 340, 150, '<span style="font-size:48px;font-weight:700;color:' + x.acc + ';">03</span>' + '<span style="font-size:24px;font-weight:600;color:' + x.ink + ';margin-top:6px;">执行</span>', { bg: x.surface, bar: true, barC: x.grad, align: 'flex-start', pad: '20px 24px' }) +
        pCard(x, 860, 490, 340, 150, '<span style="font-size:48px;font-weight:700;color:' + x.g + ';">04</span>' + '<span style="font-size:24px;font-weight:600;color:' + x.ink + ';margin-top:6px;">复盘</span>', { bg: x.surface, bar: true, barC: x.grad, align: 'flex-start', pad: '20px 24px' }) +
        tEl('el_' + uid(), 320, 236, 640, 270,
          '<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:' + x.surface + ';border:1px solid ' + x.border + ';border-radius:18px;box-shadow:' + x.blur + ';box-sizing:border-box;">' +
          pKicker(x, '2026 PROJECT', 'center') +
          '<span style="font-size:56px;font-weight:700;color:' + x.ink + ';line-height:1.15;text-align:center;">演示文稿标题</span>' +
          '<span style="font-size:21px;color:' + x.sub + ';">作者姓名 · 2026 年 8 月</span></div>') +
        pDoodle(1120, 60, 70, 'plus', x.ink);
    },

    /* ---- 侧条封面：左侧墨色竖排标题 ---- */
    'p-cover-side': (c) => {
      const x = P(c);
      return pBg(x, false) +
        rEl('el_' + uid(), 0, 0, 120, 720, x.ink, 0) +
        rEl('el_' + uid(), 120, 0, 8, 720, x.a, 0) +
        tEl('el_' + uid(), 0, 90, 120, 560,
          '<span style="writing-mode:vertical-rl;font-size:36px;font-weight:800;color:' + x.paper + ';letter-spacing:.42em;display:flex;align-items:center;justify-content:center;width:100%;height:100%;">演示文稿标题</span>') +
        tEl('el_' + uid(), 240, 150, 640, 40, pKicker(x, 'PROJECT · 2026')) +
        tEl('el_' + uid(), 240, 210, 900, 170,
          '<span style="font-size:84px;font-weight:900;color:' + x.ink + ';line-height:1.15;display:block;text-align:left;">从这里开始<br/>讲述好故事</span>') +
        rEl('el_' + uid(), 244, 396, 220, 11, x.a, 0) +
        tEl('el_' + uid(), 240, 440, 860, 70, '<span style="font-size:28px;color:' + x.sub + ';display:block;text-align:left;">一句话副标题，说明这份演示的主题与核心价值</span>') +
        tEl('el_' + uid(), 240, 560, 860, 36, '<span style="font-size:20px;color:' + x.fa + ';">作者姓名 · 2026 年 8 月</span>') +
        pDoodle(1100, 120, 80, 'ring', x.ink);
    },

    /* ============ 目录（2） ============ */

    'p-toc': (c) => {
      const x = P(c);
      const rows = [
        ['01', '第一部分标题', 'P.04'],
        ['02', '第二部分标题', 'P.08'],
        ['03', '第三部分标题', 'P.12'],
        ['04', '第四部分标题', 'P.16'],
      ];
      let h = pBg(x, false) +
        tEl('el_' + uid(), 128, 80, 640, 36, pKicker(x, 'CONTENTS')) +
        tEl('el_' + uid(), 128, 126, 400, 90, '<span style="font-size:58px;font-weight:700;color:' + x.ink + ';">目录</span>');
      rows.forEach(function (r, i) {
        const y = 262 + i * 92;
        h += tEl('el_' + uid(), 128, y, 1024, 72,
          '<div style="display:flex;align-items:center;gap:24px;width:100%;">' +
          pNumChip2(x, r[0], 40) +
          '<span style="font-size:30px;font-weight:600;color:' + x.ink + ';">' + r[1] + '</span>' +
          '<span style="flex:1;border-bottom:1.5px solid ' + x.border + ';"></span>' +
          '<span style="font-size:20px;color:' + x.fa + ';">' + r[2] + '</span></div>');
      });
      h += tEl('el_' + uid(), 128, 646, 900, 34, '<span style="font-size:19px;color:' + x.fa + ';">章节说明：每部分围绕一个核心主题展开</span>');
      return h;
    },

    'p-toc-cards': (c) => {
      const x = P(c);
      const cards = [
        ['01', '第一部分标题', '章节导语与核心要点说明'],
        ['02', '第二部分标题', '章节导语与核心要点说明'],
        ['03', '第三部分标题', '章节导语与核心要点说明'],
        ['04', '第四部分标题', '章节导语与核心要点说明'],
      ];
      let h = pBg(x, false) +
        tEl('el_' + uid(), 128, 76, 640, 36, pKicker(x, 'CONTENTS')) +
        tEl('el_' + uid(), 128, 122, 400, 84, '<span style="font-size:54px;font-weight:700;color:' + x.ink + ';">目录</span>');
      cards.forEach(function (r, i) {
        const l = i % 2 === 0 ? 110 : 680;
        const t = i < 2 ? 250 : 470;
        h += pCard(x, l, t, 490, 170,
          pNumChip2(x, r[0], 38) +
          '<span style="font-size:28px;font-weight:600;color:' + x.ink + ';margin-top:16px;">' + r[1] + '</span>' +
          '<span style="font-size:18px;color:' + x.sub + ';margin-top:6px;">' + r[2] + '</span>',
          { bg: x.surface, bar: true, barC: x.grad });
      });
      h += pDoodle(1150, 110, 70, 'ring', x.ink);
      return h;
    },

    /* ============ 章节过渡（3） ============ */

    'p-section': (c) => {
      const x = P(c);
      return pBg(x, true) +
        tEl('el_' + uid(), 400, 160, 480, 40, pKicker(x, 'PART 02 · CHAPTER', 'center')) +
        tEl('el_' + uid(), 240, 230, 800, 140, '<span style="font-size:76px;font-weight:700;color:' + x.ink + ';line-height:1.15;display:block;text-align:center;width:100%;">章节标题</span>') +
        rEl('el_' + uid(), 530, 398, 220, 12, x.a, 0) +
        pCard(x, 380, 448, 520, 120,
          '<span style="font-size:23px;color:' + x.sub + ';display:block;text-align:center;width:100%;line-height:1.7;">章节引言：围绕主题循序渐进，逐步深入。</span>',
          { bg: x.surface, align: 'center', pad: '20px 30px' }) +
        pDoodle(100, 100, 80, 'cross', x.ink) +
        pDoodle(1100, 540, 90, 'ring', x.ink);
    },

    'p-section-num': (c) => {
      const x = P(c);
      return pBg(x, false) +
        tEl('el_' + uid(), 80, 40, 560, 420,
          '<span style="font-size:300px;font-weight:700;line-height:1;color:transparent;-webkit-text-stroke:' + (x.dark ? '4px ' + x.ink : '3px ' + x.ink) + ';display:block;text-align:left;">02</span>') +
        tEl('el_' + uid(), 560, 220, 620, 120, '<span style="font-size:64px;font-weight:700;color:' + x.ink + ';line-height:1.15;display:block;text-align:left;">章节标题</span>') +
        rEl('el_' + uid(), 564, 356, 150, 11, x.a, 0) +
        tEl('el_' + uid(), 560, 396, 620, 80, '<span style="font-size:26px;color:' + x.sub + ';display:block;text-align:left;line-height:1.6;">章节引言：简要说明本章主题与学习目标</span>') +
        pCard(x, 560, 510, 440, 100,
          '<span style="font-size:22px;color:' + x.ink + ';line-height:1.7;">先想清楚「为什么」，再动手「怎么做」</span>',
          { bg: x.surface, bar: true, barC: x.grad, align: 'flex-start', pad: '18px 26px' }) +
        pDoodle(1150, 120, 70, 'plus', x.ink);
    },

    'p-section-band': (c) => {
      const x = P(c);
      return pBg(x, false) +
        rEl('el_' + uid(), 0, 300, 1280, 150, x.a, 0) +
        rEl('el_' + uid(), 0, 452, 1280, 6, x.ink, 0) +
        tEl('el_' + uid(), 200, 322, 300, 30, '<span style="font-size:18px;font-weight:700;letter-spacing:.22em;color:#FFFDF7;">PART 02</span>') +
        tEl('el_' + uid(), 200, 356, 800, 80, '<span style="font-size:50px;font-weight:700;color:#FFFDF7;line-height:1.2;display:block;text-align:left;">章节标题</span>') +
        tEl('el_' + uid(), 200, 196, 880, 60, '<span style="font-size:25px;color:' + x.sub + ';">章节导语：一句话概括本章内容与学习目标</span>') +
        pCard(x, 150, 510, 280, 110, '<span style="font-size:24px;color:' + x.ink + ';">关键词一</span>', { bg: x.surface, align: 'center', pad: '0 18px' }) +
        pCard(x, 500, 510, 280, 110, '<span style="font-size:24px;color:' + x.ink + ';">关键词二</span>', { bg: x.surface, align: 'center', pad: '0 18px' }) +
        pCard(x, 850, 510, 280, 110, '<span style="font-size:24px;color:' + x.ink + ';">关键词三</span>', { bg: x.surface, align: 'center', pad: '0 18px' }) +
        pDoodle(1150, 120, 80, 'ring', x.ink);
    },

    /* ============ 内容页（3） ============ */

    'p-title': (c) => {
      const x = P(c);
      return pBg(x, false) +
        tEl('el_' + uid(), 128, 150, 700, 36, pKicker(x, 'SECTION 01 · 章节名')) +
        tEl('el_' + uid(), 128, 196, 1024, 130, '<span style="font-size:70px;font-weight:700;color:' + x.ink + ';line-height:1.15;display:block;text-align:left;">内容页大标题</span>') +
        rEl('el_' + uid(), 132, 344, 230, 12, x.a, 0) +
        tEl('el_' + uid(), 128, 386, 900, 70, '<span style="font-size:29px;color:' + x.sub + ';">副标题或本节导语，一句话说明本节内容</span>') +
        tEl('el_' + uid(), 128, 546, 800, 36, '<span style="font-size:20px;color:' + x.fa + ';">作者 · 日期 · 章节编号</span>') +
        pCard(x, 930, 150, 250, 120,
          '<span style="font-size:20px;font-weight:600;color:' + x.a + ';">本节重点</span>' +
          '<span style="font-size:19px;color:' + x.sub + ';margin-top:8px;display:block;line-height:1.6;">随手记下本节要点</span>',
          { bg: x.surface, align: 'center', pad: '14px 16px' }) +
        pDoodle(1150, 570, 70, 'cross', x.ink);
    },

    'p-points': (c) => {
      const x = P(c);
      const rows = [
        ['1', '要点标题一', '补充说明文字'],
        ['2', '要点标题二', '补充说明文字'],
        ['3', '要点标题三', '补充说明文字'],
        ['4', '要点标题四', '补充说明文字'],
      ];
      let h = pGradBg(x) +
        tEl('el_' + uid(), 128, 78, 700, 36, pModernKicker(x, 'KEY POINTS')) +
        tEl('el_' + uid(), 128, 120, 700, 84, '<span style="font-size:56px;font-weight:900;letter-spacing:-.01em;color:' + x.ink + ';">核心要点</span>') +
        rEl('el_' + uid(), 132, 214, 150, 6, x.a, 3);
      rows.forEach(function (r, i) {
        h += pModernCard(x, 128, 250 + i * 108, 1024, 88,
          '<div style="display:flex;align-items:center;gap:26px;width:100%;">' +
          pNumChip2(x, r[0]) +
          '<span style="font-size:29px;font-weight:800;color:' + x.ink + ';">' + r[1] + '</span>' +
          '<span style="font-size:21px;color:' + x.sub + ';">' + r[2] + '</span>' +
          '<span style="margin-left:auto;flex:none;width:9px;height:9px;border-radius:50%;background:' + x.grad + ';"></span></div>',
          { pad: '0 30px', bg: x.surface, shadow: x.blur, radius: x.radiusSm });
      });
      return h;
    },

    'p-imagetext': (c) => {
      const x = P(c);
      return pBg(x, false) +
        tEl('el_' + uid(), 128, 60, 700, 36, pKicker(x, 'TEXT & IMAGE')) +
        tEl('el_' + uid(), 128, 100, 700, 84, '<span style="font-size:48px;font-weight:700;color:' + x.ink + ';">图文混排</span>') +
        pCard(x, 128, 220, 560, 230,
          '<span style="font-size:32px;font-weight:700;color:' + x.ink + ';">左侧文字区块</span>' +
          '<span style="font-size:21px;color:' + x.sub + ';line-height:1.8;margin-top:12px;">在此填写正文内容：说明要点、背景信息或关键结论。文字与右侧图片相互配合，保持版面均衡。</span>',
          { bg: x.surface, bar: true, barC: x.grad, align: 'flex-start', pad: '26px 28px' }) +
        pCard(x, 200, 480, 320, 90,
          '<span style="font-size:22px;color:' + x.sub + ';">图片可双击替换</span>',
          { bg: x.surface2, align: 'center', pad: '0 16px' }) +
        pPhoto(x, 760, 180, 400, x.a, 0, '示例图片说明') +
        pDoodle(1150, 570, 70, 'plus', x.ink);
    },

    /* ============ 人物（4） ============ */

    'p-about': (c) => {
      const x = P(c);
      return pBg(x, true) +
        tEl('el_' + uid(), 128, 90, 640, 36, pKicker(x, 'ABOUT')) +
        tEl('el_' + uid(), 128, 136, 600, 90, '<span style="font-size:56px;font-weight:700;color:' + x.ink + ';">关于我们</span>') +
        pCard(x, 128, 264, 620, 280,
          '<span style="font-size:23px;color:' + x.sub + ';line-height:1.95;">我们是一支由设计师、工程师与思考者组成的团队，相信好产品来自对问题的真正理解与持续打磨。</span>' +
          '<span style="font-size:24px;font-weight:700;color:' + x.a + ';margin-top:16px;display:block;">保持好奇，动手创造。</span>',
          { bg: x.surface, bar: true, barC: x.grad, align: 'flex-start', pad: '28px 30px' }) +
        pPhoto(x, 800, 200, 360, x.g, 0, '团队合影说明') +
        pCard(x, 900, 560, 240, 90,
          '<span style="font-size:20px;color:' + x.ink + ';">记录每一个瞬间</span>',
          { bg: x.surface, align: 'center', pad: '0 16px' }) +
        pDoodle(1150, 120, 80, 'ring', x.ink) +
        pDoodle(60, 600, 70, 'cross', x.ink);
    },

    'p-team': (c) => {
      const x = P(c);
      const mem = [
        ['成员姓名', '职位'],
        ['成员姓名', '职位'],
        ['成员姓名', '职位'],
        ['成员姓名', '职位'],
      ];
      let h = pBg(x, false) +
        tEl('el_' + uid(), 128, 70, 700, 36, pKicker(x, 'OUR TEAM')) +
        tEl('el_' + uid(), 128, 112, 700, 84, '<span style="font-size:50px;font-weight:700;color:' + x.ink + ';">团队介绍</span>');
      mem.forEach(function (m, i) {
        const l = 90 + i * 290;
        h += pPhoto(x, l, 210, 230, '#D9DEE9', 0, '') +
          pCard(x, l + 22, 500, 186, 90,
            '<span style="font-size:22px;font-weight:700;color:' + x.ink + ';">' + m[0] + '</span>' +
            '<span style="font-size:17px;color:' + x.sub + ';margin-top:4px;">' + m[1] + '</span>',
            { bg: x.surface, align: 'center', pad: '14px 12px' });
      });
      h += tEl('el_' + uid(), 240, 640, 800, 36, '<span style="font-size:22px;color:' + x.fa + ';display:block;text-align:center;width:100%;">一支靠谱的团队，是项目成功的基石</span>');
      return h;
    },

    'p-service': (c) => {
      const x = P(c);
      const svc = [
        ['💡', '服务项目一', '一句话说明该服务的内容、价值与适用场景。'],
        ['⚙️', '服务项目二', '一句话说明该服务的内容、价值与适用场景。'],
        ['🚀', '服务项目三', '一句话说明该服务的内容、价值与适用场景。'],
      ];
      let h = pBg(x, false) +
        tEl('el_' + uid(), 128, 70, 700, 36, pKicker(x, 'SERVICES')) +
        tEl('el_' + uid(), 128, 112, 700, 84, '<span style="font-size:50px;font-weight:700;color:' + x.ink + ';">核心服务</span>');
      svc.forEach(function (s, i) {
        const l = 90 + i * 380;
        h += pCard(x, l, 220, 340, 340,
          '<span style="width:62px;height:62px;background:' + x.grad + ';border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:30px;box-shadow:0 6px 16px rgba(37,99,235,0.22);">' + s[0] + '</span>' +
          '<span style="font-size:29px;font-weight:700;color:' + x.ink + ';margin-top:20px;">' + s[1] + '</span>' +
          '<span style="font-size:19px;color:' + x.sub + ';line-height:1.8;margin-top:10px;">' + s[2] + '</span>',
          { bg: x.surface, bar: true, barC: x.grad, align: 'flex-start', pad: '26px 24px' });
      });
      h += pDoodle(1150, 120, 70, 'ring', x.ink);
      return h;
    },

    'p-contact': (c) => {
      const x = P(c);
      const items = [
        ['📞', '电话', '138-0000-0000'],
        ['✉️', '邮箱', 'hello@example.com'],
        ['📍', '地址', '北京市朝阳区示例街道 88 号'],
        ['🌐', '官网', 'www.example.com'],
      ];
      let h = pBg(x, false) +
        tEl('el_' + uid(), 128, 100, 640, 36, pKicker(x, 'CONTACT')) +
        tEl('el_' + uid(), 128, 146, 600, 90, '<span style="font-size:56px;font-weight:700;color:' + x.ink + ';">联系我们</span>');
      items.forEach(function (it, i) {
        const y = 286 + i * 96;
        h += pCard(x, 128, y, 640, 84,
          '<div style="display:flex;align-items:center;gap:22px;width:100%;">' +
          '<span style="font-size:26px;">' + it[0] + '</span>' +
          '<span style="font-size:23px;font-weight:700;color:' + x.ink + ';width:60px;">' + it[1] + '</span>' +
          '<span style="font-size:22px;color:' + x.sub + ';">' + it[2] + '</span></div>',
          { bg: x.surface, bar: true, barC: x.grad, align: 'flex-start', pad: '0 26px' });
      });
      h += rEl('el_' + uid(), 840, 240, 300, 300, x.ink, 150) +
        tEl('el_' + uid(), 840, 240, 300, 300,
          '<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;">' +
          '<span style="font-size:52px;font-weight:900;color:' + x.paper + ';">联系</span>' +
          pHand(x, '欢迎随时交流', 24, x.paper) + '</div>') +
        pDoodle(60, 610, 70, 'plus', x.ink);
      return h;
    },

    /* ============ 作品（1） ============ */

    'p-gallery': (c) => {
      const x = P(c);
      const items = [
        ['#C7D2E0', '项目一'],
        ['#C7D2E0', '项目二'],
        ['#C7D2E0', '项目三'],
        ['#C7D2E0', '项目四'],
      ];
      let h = pBg(x, false) +
        tEl('el_' + uid(), 128, 70, 700, 36, pKicker(x, 'PORTFOLIO')) +
        tEl('el_' + uid(), 128, 112, 700, 84, '<span style="font-size:50px;font-weight:700;color:' + x.ink + ';">作品展示</span>');
      items.forEach(function (it, i) {
        const l = 70 + i * 295;
        h += pPhoto(x, l, 210, 240, it[0], 0, it[1]);
      });
      h += tEl('el_' + uid(), 128, 640, 1024, 36, '<span style="font-size:21px;color:' + x.fa + ';display:block;text-align:center;width:100%;">精选案例 · 更多作品请访问官网</span>');
      return h;
    },

    /* ============ 数据（3） ============ */

    'p-data': (c) => {
      const x = P(c);
      const stats = [
        ['指标 A', '72%', x.a, '相比上季度提升 12 个百分点，趋势持续向好'],
        ['指标 B', '1.8×', x.s, '覆盖用户数增长近一倍，新增渠道效果显著'],
        ['指标 C', '96', x.acc, '客户满意度保持高位，净推荐值稳步上升'],
      ];
      let h = pGradBg(x) +
        tEl('el_' + uid(), 128, 80, 700, 36, pModernKicker(x, 'KEY METRICS')) +
        tEl('el_' + uid(), 128, 122, 700, 84, '<span style="font-size:56px;font-weight:900;letter-spacing:-.01em;color:' + x.ink + ';">数据展示</span>') +
        rEl('el_' + uid(), 132, 216, 150, 6, x.a, 3);
      stats.forEach(function (s, i) {
        const l = 78 + i * 388;
        h += pModernCard(x, l, 258, 356, 320,
          '<span style="font-size:21px;font-weight:700;letter-spacing:.02em;color:' + x.sub + ';">' + s[0] + '</span>' +
          '<span style="font-size:94px;font-weight:900;line-height:1.06;margin-top:14px;background:' + x.grad + ';-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:' + s[2] + ';">' + s[1] + '</span>' +
          '<span style="font-size:19px;line-height:1.7;color:' + x.fa + ';margin-top:16px;">' + s[3] + '</span>',
          { pad: '28px 30px', bar: true, barC: x.grad, shadow: x.blurLg });
      });
      h += tEl('el_' + uid(), 128, 640, 1024, 36, '<span style="font-size:19px;color:' + x.fa + ';">数据来源与统计口径说明（如有）</span>');
      return h;
    },

    'p-stats': (c) => {
      const x = P(c);
      const stats = [
        ['用户数', '128K', '覆盖学生与教师群体'],
        ['满意度', '96%', '净推荐值持续走高'],
        ['课程量', '320+', '覆盖全部知识章节'],
        ['好评率', '98%', '来自真实学习反馈'],
      ];
      let h = pBg(x, false) +
        tEl('el_' + uid(), 128, 70, 700, 36, pKicker(x, 'STATS')) +
        tEl('el_' + uid(), 128, 112, 700, 84, '<span style="font-size:50px;font-weight:700;color:' + x.ink + ';">核心指标</span>');
      stats.forEach(function (s, i) {
        const l = 70 + i * 295;
        h += pCard(x, l, 240, 270, 330,
          '<span style="font-size:21px;color:' + x.sub + ';">' + s[0] + '</span>' +
          '<span style="font-size:66px;font-weight:700;color:' + x.a + ';line-height:1.05;margin-top:12px;">' + s[1] + '</span>' +
          '<span style="font-size:17px;color:' + x.sub + ';margin-top:12px;">' + s[2] + '</span>',
          { bg: x.surface, bar: true, barC: x.grad, align: 'flex-start', pad: '26px 24px' });
      });
      return h;
    },

    'p-numbers': (c) => {
      const x = P(c);
      const nums = [
        ['12', '核心指标数', x.a],
        ['48', '覆盖城市数', x.s],
        ['200', '团队成员数', x.acc],
        ['1000', '服务客户数', x.g],
      ];
      return pBg(x, false) +
        tEl('el_' + uid(), 128, 76, 700, 36, pKicker(x, 'NUMBERS THAT MATTER')) +
        tEl('el_' + uid(), 128, 118, 700, 80, '<span style="font-size:48px;font-weight:700;color:' + x.ink + ';">数字一览</span>') +
        rEl('el_' + uid(), 660, 226, 4, 470, x.ink, 2) +
        rEl('el_' + uid(), 90, 448, 1100, 4, x.ink, 2) +
        nums.map(function (n, i) {
          const l = i % 2 === 0 ? 90 : 690;
          const t = i < 2 ? 240 : 462;
          return tEl('el_' + uid(), l, t, 560, 180,
            '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;width:100%;height:100%;">' +
            '<span style="font-size:104px;font-weight:700;color:' + n[2] + ';line-height:1;">' + n[0] + '</span>' +
            '<span style="font-size:26px;color:' + x.sub + ';margin-top:14px;">' + n[1] + '</span></div>');
        }).join('');
    },

    /* ============ 对比 / 时间线 / 流程 ============ */

    'p-compare': (c) => {
      const x = P(c);
      const col = function (l, title, note, items) {
        const lis = items.map(function (it) {
          return '<li style="display:flex;align-items:center;gap:12px;margin-top:12px;font-size:21px;color:' + x.ink + ';">' +
            '<span style="width:8px;height:8px;border-radius:50%;background:' + x.a + ';flex:none;"></span>' + it + '</li>';
        }).join('');
        return pCard(x, l, 220, 460, 330,
          '<span style="font-size:31px;font-weight:700;color:' + x.ink + ';">' + title + '</span>' +
          '<span style="font-size:19px;color:' + x.sub + ';line-height:1.7;margin-top:10px;">' + note + '</span>' +
          '<ul style="list-style:none;margin:6px 0 0;padding:0;">' + lis + '</ul>',
          { bg: x.surface, bar: true, barC: x.grad });
      };
      return pBg(x, false) +
        tEl('el_' + uid(), 128, 70, 700, 36, pKicker(x, 'COMPARISON')) +
        tEl('el_' + uid(), 128, 112, 700, 84, '<span style="font-size:50px;font-weight:700;color:' + x.ink + ';">对比分析</span>') +
        col(100, '方案 A', '方案简介：一句话说明定位与适用场景。', ['优势特点 1', '优势特点 2', '优势特点 3']) +
        rEl('el_' + uid(), 565, 320, 150, 150, x.a, 75) +
        tEl('el_' + uid(), 565, 320, 150, 150, '<span style="font-size:34px;font-weight:700;color:' + x.paper + ';display:flex;align-items:center;justify-content:center;width:100%;height:100%;">VS</span>') +
        col(720, '方案 B', '方案简介：一句话说明定位与适用场景。', ['优势特点 1', '优势特点 2', '优势特点 3']) +
        pCard(x, 128, 610, 1024, 80,
          '<span style="font-size:21px;color:' + x.ink + ';"><strong style="font-weight:700;color:' + x.a + ';">关键区别：</strong>在此总结两者的本质差异与适用场景。</span>',
          { bg: x.surface, pad: '0 30px' });
    },

    'p-timeline': (c) => {
      const x = P(c);
      const nodes = [
        ['2023', '第一阶段 · 关键事件与成果说明'],
        ['2024', '第二阶段 · 关键事件与成果说明'],
        ['2025', '第三阶段 · 关键事件与成果说明'],
        ['2026', '第四阶段 · 关键事件与成果说明'],
      ];
      let h = pBg(x, false) +
        tEl('el_' + uid(), 128, 70, 700, 36, pKicker(x, 'TIMELINE')) +
        tEl('el_' + uid(), 128, 112, 700, 84, '<span style="font-size:50px;font-weight:700;color:' + x.ink + ';">发展时间线</span>') +
        rEl('el_' + uid(), 128, 300, 1024, 4, x.a, 2);
      nodes.forEach(function (n, i) {
        const l = 108 + i * 258;
        h += pCard(x, l, 196, 250, 92,
          '<span style="font-size:36px;font-weight:700;color:' + x.a + ';line-height:1;display:block;text-align:center;">' + n[0] + '</span>',
          { bg: x.surface, bar: true, barC: x.grad, align: 'center', pad: '0 12px' }) +
          tEl('el_' + uid(), l, 336, 250, 118,
            '<span style="font-size:20px;color:' + x.sub + ';line-height:1.7;display:block;text-align:center;">' + n[1] + '</span>');
      });
      h += pCard(x, 128, 510, 1024, 130,
        '<span style="font-size:24px;font-weight:700;color:' + x.ink + ';">时间线说明</span>' +
        '<span style="font-size:20px;color:' + x.sub + ';line-height:1.7;margin-top:8px;">在这里补充时间线的整体背景、关键转折点或总结性结论。</span>');
      return h;
    },

    'p-steps': (c) => {
      const x = P(c);
      const steps = [
        ['1', '步骤一', '描述该步骤做什么、产出什么'],
        ['2', '步骤二', '描述该步骤做什么、产出什么'],
        ['3', '步骤三', '描述该步骤做什么、产出什么'],
        ['4', '步骤四', '描述该步骤做什么、产出什么'],
      ];
      let h = pBg(x, false) +
        tEl('el_' + uid(), 128, 70, 700, 36, pKicker(x, 'PROCESS')) +
        tEl('el_' + uid(), 128, 112, 700, 84, '<span style="font-size:50px;font-weight:700;color:' + x.ink + ';">流程步骤</span>');
      steps.forEach(function (s, i) {
        const l = 70 + i * 290;
        h += pCard(x, l, 220, 250, 300,
          pNumChip2(x, s[0], 42) +
          '<span style="font-size:26px;font-weight:700;color:' + x.ink + ';margin-top:20px;">' + s[1] + '</span>' +
          '<span style="font-size:18.5px;color:' + x.sub + ';line-height:1.7;margin-top:10px;">' + s[2] + '</span>',
          { bg: x.surface2, bar: true, barC: x.grad });
        if (i < 3) {
          h += tEl('el_' + uid(), l + 258, 336, 30, 46, '<span style="font-size:30px;font-weight:600;color:' + x.fa + ';display:flex;align-items:center;justify-content:center;width:100%;height:100%;">→</span>');
        }
      });
      h += tEl('el_' + uid(), 128, 578, 1024, 46, '<span style="font-size:20px;color:' + x.fa + ';display:block;text-align:center;">可拖动各卡片重新排列，双击文字直接编辑</span>');
      return h;
    },

    /* ============ 案例 / 计划 / 问答 ============ */

    'p-case': (c) => {
      const x = P(c);
      return pBg(x, true) +
        tEl('el_' + uid(), 128, 70, 700, 36, pKicker(x, 'CASE STUDY')) +
        tEl('el_' + uid(), 128, 112, 700, 84, '<span style="font-size:50px;font-weight:700;color:' + x.ink + ';">案例研究</span>') +
        pCard(x, 90, 230, 500, 330,
          '<span style="font-size:29px;font-weight:700;color:' + x.ink + ';">背景</span>' +
          '<span style="font-size:20px;color:' + x.sub + ';line-height:1.85;margin-top:14px;">在此描述项目背景、面临的问题与挑战，以及目标用户的真实需求。</span>' +
          '<span style="font-size:22px;font-weight:600;color:' + x.a + ';margin-top:16px;display:block;">从问题出发，答案自然浮现</span>',
          { bg: x.surface, bar: true, barC: x.grad, align: 'flex-start', pad: '26px 26px' }) +
        pCard(x, 660, 230, 530, 330,
          '<span style="font-size:29px;font-weight:700;color:' + x.ink + ';">方案与成果</span>' +
          '<ul style="list-style:none;margin:14px 0 0;padding:0;">' +
          '<li style="display:flex;align-items:center;gap:12px;margin-top:13px;font-size:20px;color:' + x.ink + ';"><span style="width:8px;height:8px;border-radius:50%;background:' + x.a + ';flex:none;"></span>核心举措与执行要点 1</li>' +
          '<li style="display:flex;align-items:center;gap:12px;margin-top:13px;font-size:20px;color:' + x.ink + ';"><span style="width:8px;height:8px;border-radius:50%;background:' + x.a + ';flex:none;"></span>核心举措与执行要点 2</li>' +
          '<li style="display:flex;align-items:center;gap:12px;margin-top:13px;font-size:20px;color:' + x.ink + ';"><span style="width:8px;height:8px;border-radius:50%;background:' + x.a + ';flex:none;"></span>核心举措与执行要点 3</li></ul>',
          { bg: x.surface, bar: true, barC: x.grad, align: 'flex-start', pad: '26px 26px' }) +
        pCard(x, 128, 610, 1024, 80,
          '<span style="font-size:21px;color:' + x.ink + ';"><strong style="font-weight:700;color:' + x.a + ';">结论：</strong>在此总结案例的可复制经验与关键收获。</span>',
          { bg: x.surface, pad: '0 30px' });
    },

    'p-plan': (c) => {
      const x = P(c);
      const phases = [
        ['阶段一', '需求梳理', 0.25, x.a],
        ['阶段二', '方案设计', 0.5, x.s],
        ['阶段三', '开发迭代', 0.75, x.acc],
        ['阶段四', '上线复盘', 1, x.g],
      ];
      let h = pBg(x, false) +
        tEl('el_' + uid(), 128, 70, 700, 36, pKicker(x, 'ROADMAP')) +
        tEl('el_' + uid(), 128, 112, 700, 84, '<span style="font-size:50px;font-weight:700;color:' + x.ink + ';">实施计划</span>');
      phases.forEach(function (p, i) {
        const y = 228 + i * 110;
        h += pCard(x, 128, y, 210, 92,
          '<span style="font-size:24px;font-weight:700;color:' + x.ink + ';">' + p[0] + '</span>' +
          '<span style="font-size:18px;color:' + x.sub + ';margin-top:4px;display:block;">' + p[1] + '</span>',
          { bg: x.surface, bar: true, barC: x.grad, align: 'flex-start', pad: '14px 18px' }) +
          rEl('el_' + uid(), 380, y + 32, 640, 28, x.dark ? 'rgba(237,234,227,0.15)' : 'rgba(43,42,40,0.12)', 2) +
          rEl('el_' + uid(), 380, y + 32, Math.round(640 * p[2]), 28, p[3], 2) +
          tEl('el_' + uid(), 1050, y, 140, 92, '<span style="font-size:22px;font-weight:700;color:' + p[3] + ';display:flex;align-items:center;justify-content:center;width:100%;height:100%;">' + Math.round(p[2] * 100) + '%</span>');
      });
      h += pCard(x, 128, 588, 1024, 60,
        '<span style="font-size:21px;color:' + x.sub + ';">计划留出弹性，执行贵在坚持。</span>',
        { bg: x.surface2, align: 'center', pad: '0 26px' });
      return h;
    },

    'p-qa': (c) => {
      const x = P(c);
      const opts = [
        ['A', '选项答案 A', 'yellow', -1],
        ['B', '选项答案 B', 'blue', 1],
        ['C', '选项答案 C', 'pink', -1],
        ['D', '选项答案 D', 'green', 1],
      ];
      let h = pBg(x, true) +
        tEl('el_' + uid(), 128, 70, 700, 36, pKicker(x, 'Q & A')) +
        tEl('el_' + uid(), 128, 112, 700, 84, '<span style="font-size:50px;font-weight:700;color:' + x.ink + ';">快问快答</span>') +
        pCard(x, 128, 220, 1024, 130,
          '<div style="display:flex;align-items:center;gap:16px;width:100%;">' +
          '<span style="display:inline-flex;align-items:center;justify-content:center;width:46px;height:46px;background:' + x.grad + ';color:#fff;font-size:23px;font-weight:700;flex:none;border-radius:50%;">Q</span>' +
          '<span style="font-size:28px;font-weight:600;color:' + x.ink + ';">请思考：这里写一个引导思考的核心问题？</span></div>',
          { bg: x.surface, bar: true, barC: x.grad, align: 'flex-start', pad: '20px 30px' });
      opts.forEach(function (o, i) {
        const l = i % 2 === 0 ? 128 : 660;
        const t = i < 2 ? 390 : 530;
        h += pCard(x, l, t, 492, 120,
          '<div style="display:flex;align-items:center;gap:24px;width:100%;">' +
          pNumChip(x, o[0], 48) +
          '<span style="font-size:25px;color:' + x.ink + ';">' + o[1] + '</span></div>',
          { rot: o[3] });
      });
      return h;
    },

    /* ============ 引言 / 致谢 ============ */

    'p-quote': (c) => {
      const x = P(c);
      return pBg(x, true) +
        pCard(x, 180, 130, 920, 420,
          '<span style="font-size:100px;font-weight:700;color:' + x.a + ';line-height:.6;display:block;">"</span>' +
          '<span style="font-size:38px;color:' + x.ink + ';display:block;margin-top:26px;line-height:1.75;">这是一段引人深思的引言，凝聚本次分享的核心观点与价值主张。</span>' +
          '<span style="font-size:22px;color:' + x.sub + ';margin-top:26px;display:block;text-align:right;">—— 引用来源</span>',
          { bg: x.surface, bar: true, barC: x.grad, align: 'flex-start', pad: '44px 52px' }) +
        pDoodle(1120, 600, 90, 'ring', x.ink) +
        pDoodle(60, 90, 70, 'cross', x.ink);
    },

    'p-thanks': (c) => {
      const x = P(c);
      return pBg(x, true) +
        tEl('el_' + uid(), 400, 160, 480, 40, pKicker(x, 'THANKS', 'center')) +
        tEl('el_' + uid(), 240, 220, 800, 150, '<span style="font-size:92px;font-weight:700;color:' + x.ink + ';line-height:1.1;display:block;text-align:center;width:100%;">谢谢观看</span>') +
        rEl('el_' + uid(), 530, 396, 220, 12, x.a, 0) +
        tEl('el_' + uid(), 300, 440, 680, 60, '<span style="font-size:28px;color:' + x.sub + ';display:block;text-align:center;width:100%;">愿每一次分享，都有回响</span>') +
        pCard(x, 170, 530, 210, 100, '<span style="font-size:24px;color:' + x.ink + ';">欢迎交流</span>', { bg: x.surface, align: 'center', pad: '0 14px' }) +
        pCard(x, 900, 500, 210, 100, '<span style="font-size:24px;color:' + x.ink + ';">欢迎提问</span>', { bg: x.surface, align: 'center', pad: '0 14px' }) +
        pCard(x, 530, 560, 220, 90, '<span style="font-size:24px;color:' + x.ink + ';">保持联系</span>', { bg: x.surface, align: 'center', pad: '0 14px' }) +
        tEl('el_' + uid(), 400, 664, 480, 36, '<span style="font-size:19px;color:' + x.fa + ';display:block;text-align:center;">作者姓名 · 2026 年 8 月</span>') +
        pDoodle(1100, 120, 80, 'ring', x.ink);
    },

    /* ============ 极简·现代·去AI 系列（借鉴 Soft Editorial / Cobalt Grid / Monochrome 的克制感） ============ */

    /* ---- 极简衬线封面 ---- */
    'p-cover-serif': (c) => {
      const x = P(c);
      return pBg(x, false) +
        tEl('el_' + uid(), 128, 132, 520, 34,
          '<span style="font-family:\'JetBrains Mono\',Consolas,monospace;font-size:15px;font-weight:600;letter-spacing:.32em;color:' + x.a + ';display:block;text-align:left;">FIELD NOTE · 2026</span>') +
        tEl('el_' + uid(), 128, 196, 1024, 200,
          '<span style="font-family:' + SERIF + ';font-size:104px;font-weight:600;line-height:1.12;letter-spacing:.01em;color:' + x.ink + ';display:block;text-align:left;">简约<br/>现代</span>') +
        rEl('el_' + uid(), 132, 424, 220, 4, x.ink, 0) +
        tEl('el_' + uid(), 128, 462, 840, 66,
          '<span style="font-family:' + SERIF + ';font-size:26px;color:' + x.sub + ';line-height:1.7;display:block;text-align:left;">一句话副标题，克制而优雅地说明主题。</span>') +
        tEl('el_' + uid(), 128, 596, 520, 34,
          '<span style="font-family:Consolas,monospace;font-size:16px;color:' + x.fa + ';display:block;text-align:left;letter-spacing:.08em;">作者名 · 2026 年 8 月</span>') +
        rEl('el_' + uid(), 1228, 132, 12, 12, x.a, 0);
    },

    /* ---- 极简衬线杂志内容页 ---- */
    'p-magazine': (c) => {
      const x = P(c);
      return pBg(x, false) +
        tEl('el_' + uid(), 128, 92, 520, 32, pKicker(x, 'EDITORIAL')) +
        tEl('el_' + uid(), 128, 130, 760, 96,
          '<span style="font-family:' + SERIF + ';font-size:70px;font-weight:600;line-height:1.14;letter-spacing:.005em;color:' + x.ink + ';display:block;text-align:left;">衬线杂志版式</span>') +
        rEl('el_' + uid(), 132, 244, 150, 4, x.a, 0) +
        tEl('el_' + uid(), 128, 288, 620, 220,
          '<span style="font-family:' + SERIF + ';font-size:24px;line-height:1.95;color:' + x.sub + ';display:block;text-align:left;">正文段落使用衬线字体，行距舒展，字号适中。克制、安静、有出版物的质感——这是去 AI 化、偏人文的方法论表达。</span>') +
        rEl('el_' + uid(), 800, 288, 1, 268, rgba(x.ink, 0.16), 0) +
        tEl('el_' + uid(), 840, 288, 320, 30, '<span style="font-family:Consolas,monospace;font-size:14px;letter-spacing:.22em;color:' + x.fa + ';">KEY POINTS</span>') +
        tEl('el_' + uid(), 840, 336, 320, 220,
          '<div style="display:flex;flex-direction:column;gap:16px;text-align:left;">' +
          '<span style="font-family:' + SERIF + ';font-size:22px;color:' + x.ink + ';">要点一：克制的设计</span>' +
          '<span style="font-family:' + SERIF + ';font-size:22px;color:' + x.ink + ';">要点二：现代的气质</span>' +
          '<span style="font-family:' + SERIF + ';font-size:22px;color:' + x.ink + ';">要点三：清晰的层级</span></div>') +
        tEl('el_' + uid(), 128, 560, 640, 60,
          '<span style="font-family:' + SERIF + ';font-size:20px;color:' + x.fa + ';line-height:1.7;display:block;text-align:left;">—— 底部注脚，说明本节来源或延伸方向。</span>');
    },

    /* ---- 极简衬线引言 ---- */
    'p-quote-serif': (c) => {
      const x = P(c);
      return pBg(x, false) +
        tEl('el_' + uid(), 180, 160, 920, 300,
          '<span style="font-family:' + SERIF + ';font-size:62px;font-weight:600;line-height:1.5;letter-spacing:.01em;color:' + x.ink + ';display:block;text-align:left;">「设计的克制，<br/>往往是一种更<br/>高级的<span style="color:' + x.a + ';">自信</span>。」</span>') +
        rEl('el_' + uid(), 184, 500, 90, 3, x.ink, 0) +
        tEl('el_' + uid(), 180, 528, 420, 34,
          '<span style="font-family:Consolas,monospace;font-size:16px;color:' + x.fa + ';display:block;text-align:left;letter-spacing:.14em;">—— 一句可引用的观点</span>') +
        rEl('el_' + uid(), 1130, 160, 12, 12, x.a, 0);
    },

    /* ---- 极简数据账本（单一强调色 + 发丝线） ---- */
    'p-data-ledger': (c) => {
      const x = P(c);
      const rows = [
        ['指标 A', '72%', x.a], ['指标 B', '1.8×', x.s], ['指标 C', '96', x.acc], ['指标 D', '4.8', x.g],
      ];
      let h = pBg(x, false) +
        tEl('el_' + uid(), 128, 92, 520, 32, pKicker(x, 'LEDGER')) +
        tEl('el_' + uid(), 128, 130, 700, 96,
          '<span style="font-family:' + SERIF + ';font-size:66px;font-weight:600;line-height:1.14;color:' + x.ink + ';display:block;text-align:left;">数据账本</span>') +
        rEl('el_' + uid(), 132, 244, 150, 4, x.ink, 0);
      rows.forEach(function (r, i) {
        const y = 300 + i * 96;
        h += rEl('el_' + uid(), 128, y + 78, 1024, 1, rgba(x.ink, 0.14), 0) +
          tEl('el_' + uid(), 128, y, 360, 60,
            '<span style="font-family:Consolas,monospace;font-size:20px;letter-spacing:.14em;color:' + x.sub + ';display:block;text-align:left;padding-top:16px;">' + r[0] + '</span>') +
          tEl('el_' + uid(), 620, y - 8, 532, 78,
            '<span style="font-family:' + SERIF + ';font-size:70px;font-weight:400;line-height:1;letter-spacing:-.02em;color:' + r[2] + ';display:block;text-align:right;">' + r[1] + '</span>');
      });
      h += tEl('el_' + uid(), 128, 690, 600, 30, '<span style="font-family:Consolas,monospace;font-size:15px;color:' + x.fa + ';display:block;text-align:left;">数据来源与统计口径说明（如有）</span>');
      return h;
    },
  };










  /* ===== MATH-BLOCK-START ===== */
/* =====================================================================
     "高中数学讲义" 专用模板（math-*）
     设计：数学讲义风格 —— 蓝紫色学科色 #534AB7 / #4F46E5，公式卡、步骤卡、
     易错对比、函数图像留白、知识框架。全部 1280×720，可编辑文字/颜色。
     ===================================================================== */

  // 数学课件令牌：完全从 DTK 的 edumath（数学课件风）派生，去 AI 味。
  // 主色深蓝 #1D4E89、强调橙 #E8871E、米白底——符合设计宪法，禁用 AI 高饱和色。
  const MATH_C = (() => {
    const e = DTK.xStyle('edumath');
    return {
      a: e.primary,              // 深蓝 #1D4E89
      a2: '#4A7BB4',             // 浅主色（同色系提亮，不再用禁用紫）
      gold: e.accent,            // 强调橙 #E8871E
      green: '#0E7C66',          // 正确（低饱和墨绿）
      red: '#B3261E',            // 错误（低饱和砖红）
      ink: e.ink,                // 墨色 #2B2B2B
      sub: e.muted,              // 辅灰 #5B6472
      light: e.surface,          // 米白浅底 #F3EFE6
      line: e.line,              // 分隔线 #E0DBD0
    };
  })();

  // 章节标题（数学讲义）
  function mhTitle(txt, sub) {
    return tEl('el_' + uid(), 64, 32, 1152, 56,
      '<span style="font-size:42px;font-weight:800;color:' + MATH_C.ink + ';display:block;text-align:left;">' + txt + '</span>') +
      (sub ? tEl('el_' + uid(), 64, 88, 1152, 40,
        '<span style="font-size:19px;color:' + MATH_C.sub + ';display:block;text-align:left;">' + sub + '</span>') : '') +
      rEl('el_' + uid(), 64, 136, 140, 6, MATH_C.a, 3);
  }

  // 小标题条（带色块）
  function mhSub(txt, color) {
    return rEl('el_' + uid(), 64, 160, 12, 40, color || MATH_C.a, 0) +
      tEl('el_' + uid(), 92, 160, 800, 40,
        '<span style="font-size:25px;font-weight:800;color:' + MATH_C.ink + ';display:block;text-align:left;line-height:40px;">' + txt + '</span>');
  }

  // 数学公式元素（display 模式）：data-type="math" + MathJax 渲染
  function mhFormula(latex, x, y, w, h, color, frag) {
    x = (x === undefined) ? 64 : x; y = (y === undefined) ? 176 : y;
    w = (w === undefined) ? 1152 : w; h = (h === undefined) ? 90 : h;
    const col = color || '#1F2937';
    const eid = 'el_mh_' + uid();
    return '<div class="slide-element' + (frag ? ' fragment' : '') + '" data-type="math" data-eid="' + eid + '" data-formula="' + escAttr(latex) + '" data-color="' + col + '" contenteditable="false" style="position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px;"><div class="el-math" style="color:' + col + '">\\(' + escHTML(latex) + '\\)</div></div>';
  }
  // 数学公式（inline，嵌入文本/段落内）。用 data-latex 保留原始 LaTeX，
  // 以便双击编辑时可还原为可编辑源码、失焦后按 data-latex 重渲。
  function mhFormulaInline(latex, color) {
    return '<span class="el-math-inline" data-latex="' + escAttr(latex) + '">\\(' + escHTML(latex) + '\\)</span>';
  }
  // 数学配图元素（可双击替换的图片）
  function mhImage(x, y, w, h, hex) {
    const eid = 'el_' + uid();
    return '<div class="slide-element" data-type="image" data-eid="' + eid + '" contenteditable="false" style="position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px;"><img class="el-image" src="' + imgSvg(hex || '#E5E7EB') + '" alt="配图" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:10px;"></div>';
  }

  const MathLecture = {

    /* ============ 讲义封面 ============ */
    'math-cover': () => {
      return rEl('el_' + uid(), 0, 0, 1280, 720, '#FFFFFF', 0) +
        rEl('el_' + uid(), 0, 0, 1280, 10, MATH_C.a, 0) +
        tEl('el_' + uid(), 0, 120, 1280, 62, '<span style="font-size:22px;font-weight:700;letter-spacing:.5em;color:' + MATH_C.a2 + ';display:block;text-align:center;">高中数学 · 讲义</span>') +
        tEl('el_' + uid(), 0, 200, 1280, 130, '<span style="font-size:76px;font-weight:800;color:' + MATH_C.ink + ';display:block;text-align:center;line-height:1.1;">章节标题</span>') +
        tEl('el_' + uid(), 0, 356, 1280, 60, '<span style="font-size:26px;color:' + MATH_C.sub + ';display:block;text-align:center;">副标题 · 本节重点与学习目标</span>') +
        rEl('el_' + uid(), 560, 452, 160, 6, MATH_C.gold, 3) +
        tEl('el_' + uid(), 0, 540, 1280, 50, '<span style="font-size:20px;color:' + MATH_C.sub + ';display:block;text-align:center;">教师：____  班级：____  日期：____</span>') +
        tEl('el_' + uid(), 60, 620, 200, 90, '<span style="font-size:64px;color:' + MATH_C.a2 + ';opacity:.5;display:block;text-align:left;font-family:serif;">∫</span>') +
        tEl('el_' + uid(), 1080, 620, 200, 90, '<span style="font-size:64px;color:' + MATH_C.a2 + ';opacity:.5;display:block;text-align:right;font-family:serif;">∑</span>');
    },

    /* ============ 公式定理卡 ============ */
    'math-formula': () => {
      return rEl('el_' + uid(), 0, 0, 1280, 720, '#FFFFFF', 0) +
        mhTitle('🧾 公式与定理', '本节核心公式、定理与限定条件') +
        tEl('el_' + uid(), 64, 180, 1152, 150,
          '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:' + MATH_C.light + ';border:2px solid ' + MATH_C.line + ';border-left:6px solid ' + MATH_C.a + ';border-radius:14px;width:100%;height:100%;">' +
          '<span style="font-size:26px;color:' + MATH_C.sub + ';margin-bottom:6px;">定理 / 公式名称</span>' +
          '<span style="font-size:44px;font-weight:800;color:' + MATH_C.a + ';font-family:Georgia,serif;">公式表达式</span></div>') +
        tEl('el_' + uid(), 64, 350, 560, 260,
          '<div style="display:flex;flex-direction:column;justify-content:center;text-align:left;padding:22px 26px;background:#fff;border:1px solid #E5E7EB;border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:22px;color:' + MATH_C.ink + ';margin-bottom:10px;">📌 说明</strong>' +
          '<span style="font-size:19px;color:#555;line-height:1.7;">适用条件与使用注意：公式成立的前提、常见误区，以及典型应用场景。</span></div>') +
        tEl('el_' + uid(), 656, 350, 560, 260,
          '<div style="display:flex;flex-direction:column;justify-content:center;text-align:left;padding:22px 26px;background:#fff;border:1px solid #E5E7EB;border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:22px;color:' + MATH_C.gold + ';margin-bottom:10px;">✨ 记忆要点</strong>' +
          '<span style="font-size:19px;color:#555;line-height:1.7;">记忆口诀或推导思路，帮助理解与快速回想。</span></div>');
    },

    /* ============ 典型例题详解（题目 + 分析 + 配图 + ∵/∴ 证明） ============ */
    'math-example': () => {
      return rEl('el_' + uid(), 0, 0, 1280, 720, '#FFFFFF', 0) +
        mhTitle('📝 典型例题', '标准解答 · 分析 + 证明') +
        // 【题目】
        tEl('el_' + uid(), 64, 172, 1152, 150,
          '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:0 28px;background:#FFF8F0;border:2px solid ' + MATH_C.gold + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:22px;color:' + MATH_C.gold + ';margin-bottom:8px;">【题目】</strong>' +
          '<span style="font-size:20px;color:#444;line-height:1.65;">例  已知直线与平面垂直，求其充要条件。请写出证明过程。（公式见下方）</span></div>') +
        // 题目公式块（独立 data-type=math，双击可编辑）
        mhFormula('PA \\perp \\alpha,\\quad PA=\\sqrt{3},\\quad BC \\perp PA', 100, 330, 560, 44, '#1F2937') +
        // 【分析】
        tEl('el_' + uid(), 64, 430, 720, 240,
          '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-start;text-align:left;padding:24px 28px;background:#F5F3FF;border:2px solid ' + MATH_C.line + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:22px;color:' + MATH_C.a + ';margin-bottom:12px;">【分析】</strong>' +
          '<span style="font-size:19px;color:#444;line-height:1.85;">要证线面垂直，只需证线垂直于平面内两条相交直线。由题意可得垂直关系，</span>' +
          '<span style="font-size:19px;color:#444;line-height:1.85;"><br><br>思路：找 关键条件 → 判定定理 → 结论。</span></div>') +
        // 分析公式块（独立 data-type=math）
        mhFormula('BC \\perp PA,\\quad BC \\perp AC', 100, 662, 560, 42, '#1F2937') +
        // 配图区（右上，真图片可双击替换）
        mhImage(812, 172, 400, 240, '#E0E7FF') +
        // 【证明】∵/∴ 推理链（文字 + 公式块）
        tEl('el_' + uid(), 812, 428, 400, 242,
          '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-start;text-align:left;padding:22px 24px;background:#F0FDF9;border-left:5px solid ' + MATH_C.green + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:21px;color:' + MATH_C.green + ';margin-bottom:10px;">【证明】</strong>' +
          '<div style="font-size:19px;color:#444;line-height:1.9;">' +
          '<div>∵ 直线垂直平面，</div>' +
          '<div>∴ 线垂直于平面内任一直线，</div>' +
          '<div>又 ∠=90°，即垂直，</div>' +
          '<div>∴ 结论成立</div>' +
          '<div style="margin-top:8px;">（在此替换为本题推理过程）</div></div></div>') +
        // 证明推理公式块（独立 data-type=math，放证明框内）
        mhFormula('BC \\perp \\alpha,\\quad BC \\perp \\beta', 830, 552, 360, 42, '#0CA678');
    },

    /* ============ 立体几何证明（题干 + 分析 + 图 + ∵/∴ 详细证明） ============ */
    'math-proof': () => {
      return rEl('el_' + uid(), 0, 0, 1280, 720, '#FFFFFF', 0) +
        mhTitle('🧩 证明题', '面面垂直 · 逐步推理') +
        // 题目与配图并排
        tEl('el_' + uid(), 64, 172, 660, 250,
          '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:22px 28px;background:#FFF8F0;border:2px solid ' + MATH_C.gold + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:22px;color:' + MATH_C.gold + ';margin-bottom:8px;">【题目】</strong>' +
          '<span style="font-size:20px;color:#444;line-height:1.7;">如图，<em>AB</em>是⊙<em>O</em>的直径，<em>PA</em>⊥平面<em>ABC</em>，<em>C</em>是圆周上不同于<em>A</em>、<em>B</em>的任意一点。<br>求证：平面<em>PAC</em>⊥平面<em>PBC</em>.</span></div>') +
        rEl('el_' + uid(), 752, 172, 464, 250, '#FAFAFA', 8, '#E5E7EB', 2) +
        tEl('el_' + uid(), 752, 172, 464, 250,
          '<div style="display:flex;align-items:center;justify-content:center;text-align:center;width:100%;height:100%;padding:12px;box-sizing:border-box;">' +
          '<span style="font-size:16px;color:' + MATH_C.sub + ';">📐 配图<br>（圆柱/圆锥线框图）</span></div>') +
        // 分析
        tEl('el_' + uid(), 64, 446, 1152, 96,
          '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:0 26px;background:#F5F3FF;border-left:5px solid ' + MATH_C.a + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:20px;color:' + MATH_C.a + ';margin-bottom:6px;">【分析】</strong>' +
          '<span style="font-size:18px;color:#444;line-height:1.7;">要证面面垂直，只需证一条线垂直于另一个面内的两条相交直线。由直径对直角和线面垂直性质可证 <em>BC</em>⊥<em>AC</em> 且 <em>BC</em>⊥<em>PA</em>。</span></div>') +
        // ∵/∴ 证明
        tEl('el_' + uid(), 64, 566, 1152, 108,
          '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-start;text-align:left;padding:18px 26px;background:#F0FDF9;border-left:5px solid ' + MATH_C.green + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:20px;color:' + MATH_C.green + ';margin-bottom:8px;">【证明】</strong>' +
          '<div style="font-size:18px;color:#444;line-height:1.8;">' +
          '∵ <span style="font-style:italic">AB</span>是直径，<span style="font-style:italic">C</span>在圆上，　∴ ∠<span style="font-style:italic">BCA</span>=90°，<span style="font-style:italic">BC</span>⊥<span style="font-style:italic">AC</span>。　<span style="color:#' + MATH_C.sub + ';">①</span><br>' +
          '又 <span style="font-style:italic">PA</span>⊥平面<em>ABC</em>，<em>BC</em>⊂平面<em>ABC</em>，　∴ <em>BC</em>⊥<em>PA</em>。　<span style="color:#' + MATH_C.sub + ';">②</span><br>' +
          '由 ①②，<em>BC</em>⊥平面<em>PAC</em>，又 <em>BC</em>⊂平面<em>PBC</em>，∴ 平面<em>PAC</em>⊥平面<em>PBC</em>.</div></div>');
    },


    /* ============ 一题多解 ============ */
    'math-solution': () => {
      return rEl('el_' + uid(), 0, 0, 1280, 720, '#FFFFFF', 0) +
        mhTitle('💡 一题多解', '同一问题，多角度看') +
        tEl('el_' + uid(), 64, 176, 1152, 86,
          '<div style="display:flex;align-items:center;gap:14px;text-align:left;padding:0 24px;background:#F5F3FF;border:2px solid ' + MATH_C.line + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:21px;color:' + MATH_C.a + ';">【题目】</strong><span style="font-size:20px;color:#444;">在此输入题目，比较不同解法。</span></div>') +
        tEl('el_' + uid(), 64, 282, 363, 356,
          '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:22px 24px;background:rgba(' + hexRgb(MATH_C.a) + ',0.07);border-top:5px solid ' + MATH_C.a + ';border-radius:12px;width:100%;height:100%;">' +
          '<span style="font-size:22px;font-weight:700;color:' + MATH_C.a + ';margin-bottom:10px;">解法一 · 代数</span>' +
          '<span style="font-size:19px;color:#555;line-height:1.7;">步骤：设元 → 列式 → 求解</span></div>') +
        tEl('el_' + uid(), 459, 282, 363, 356,
          '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:22px 24px;background:rgba(' + hexRgb(MATH_C.gold) + ',0.08);border-top:5px solid ' + MATH_C.gold + ';border-radius:12px;width:100%;height:100%;">' +
          '<span style="font-size:22px;font-weight:700;color:' + MATH_C.gold + ';margin-bottom:10px;">解法二 · 几何</span>' +
          '<span style="font-size:19px;color:#555;line-height:1.7;">步骤：作图 → 找关系 → 计算</span></div>') +
        tEl('el_' + uid(), 854, 282, 363, 356,
          '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:22px 24px;background:rgba(' + hexRgb(MATH_C.green) + ',0.07);border-top:5px solid ' + MATH_C.green + ';border-radius:12px;width:100%;height:100%;">' +
          '<span style="font-size:22px;font-weight:700;color:' + MATH_C.green + ';margin-bottom:10px;">解法三 · 向量</span>' +
          '<span style="font-size:19px;color:#555;line-height:1.7;">步骤：建系 → 向量表示 → 运算</span></div>');
    },

    /* ============ 知识框架 / 思维导图 ============ */
    'math-map': () => {
      return rEl('el_' + uid(), 0, 0, 1280, 720, '#FFFFFF', 0) +
        mhTitle('🌐 知识框架') +
        tEl('el_' + uid(), 500, 180, 280, 90, '<div style="display:flex;align-items:center;justify-content:center;text-align:center;background:' + MATH_C.a + ';color:#fff;border-radius:26px;width:100%;height:100%;"><span style="font-size:28px;font-weight:800;">本节主题</span></div>') +
        tEl('el_' + uid(), 90, 340, 320, 130, '<div style="display:flex;flex-direction:column;justify-content:center;text-align:center;background:#fff;border:2px solid ' + MATH_C.line + ';border-radius:12px;width:100%;height:100%;"><span style="font-size:22px;font-weight:700;color:' + MATH_C.a + ';">分支 1</span><span style="font-size:17px;color:#555;margin-top:6px;">子要点</span></div>') +
        tEl('el_' + uid(), 480, 340, 320, 130, '<div style="display:flex;flex-direction:column;justify-content:center;text-align:center;background:#fff;border:2px solid ' + MATH_C.line + ';border-radius:12px;width:100%;height:100%;"><span style="font-size:22px;font-weight:700;color:' + MATH_C.a + ';">分支 2</span><span style="font-size:17px;color:#555;margin-top:6px;">子要点</span></div>') +
        tEl('el_' + uid(), 870, 340, 320, 130, '<div style="display:flex;flex-direction:column;justify-content:center;text-align:center;background:#fff;border:2px solid ' + MATH_C.line + ';border-radius:12px;width:100%;height:100%;"><span style="font-size:22px;font-weight:700;color:' + MATH_C.a + ';">分支 3</span><span style="font-size:17px;color:#555;margin-top:6px;">子要点</span></div>') +
        tEl('el_' + uid(), 90, 540, 1100, 110, '<div style="display:flex;align-items:center;justify-content:center;text-align:center;background:' + MATH_C.light + ';border:1px dashed ' + MATH_C.line + ';border-radius:12px;width:100%;height:100%;"><span style="font-size:20px;color:' + MATH_C.sub + ';">补充：易混点 / 高考常考之处</span></div>');
    },

    /* ============ 课堂笔记（留白） ============ */
    'math-notes': () => {
      return rEl('el_' + uid(), 0, 0, 1280, 720, '#FFFFFF', 0) +
        mhTitle('📓 课堂笔记') +
        tEl('el_' + uid(), 64, 180, 1152, 420,
          '<div style="width:100%;height:100%;background:repeating-linear-gradient(to bottom, transparent, transparent 41px, #E5E7EB 41px, #E5E7EB 42px);border-left:4px solid ' + MATH_C.a2 + ';border-radius:4px;padding:0 24px;"></div>') +
        tEl('el_' + uid(), 64, 634, 1152, 44, '<span style="font-size:18px;color:' + MATH_C.sub + ';display:block;text-align:left;">在本页自由记录讲解要点、例题与疑问。</span>');
    },

    /* ============ 课堂练习 / 随堂练 ============ */
    'math-exercise': () => {
      return rEl('el_' + uid(), 0, 0, 1280, 720, '#FFFFFF', 0) +
        mhTitle('✍️ 课堂练习', '当堂巩固 · 限时完成') +
        tEl('el_' + uid(), 64, 176, 1152, 150,
          '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:0 26px;background:#FAFAFA;border:2px solid #E5E7EB;border-left:5px solid ' + MATH_C.a + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:22px;color:' + MATH_C.a + ';margin-bottom:8px;">1. 基础练</strong>' +
          '<span style="font-size:20px;color:#555;line-height:1.6;">在此输入基础题目，检测对本节概念的理解。</span></div>') +
        tEl('el_' + uid(), 64, 350, 1152, 150,
          '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:0 26px;background:#FAFAFA;border:2px solid #E5E7EB;border-left:5px solid ' + MATH_C.gold + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:22px;color:' + MATH_C.gold + ';margin-bottom:8px;">2. 提升练</strong>' +
          '<span style="font-size:20px;color:#555;line-height:1.6;">在此输入中档题目，考查方法应用与变形。</span></div>') +
        tEl('el_' + uid(), 64, 524, 1152, 150,
          '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:0 26px;background:#FAFAFA;border:2px solid #E5E7EB;border-left:5px solid ' + MATH_C.green + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:22px;color:' + MATH_C.green + ';margin-bottom:8px;">3. 拓展练</strong>' +
          '<span style="font-size:20px;color:#555;line-height:1.6;">在此输入综合/拓展题，供学有余力者挑战。</span></div>');
    },

    /* ============ 易错警示 ============ */
    'math-mistake': () => {
      return rEl('el_' + uid(), 0, 0, 1280, 720, '#FFFFFF', 0) +
        mhTitle('⚠️ 易错警示', '避开常见失分点') +
        tEl('el_' + uid(), 64, 176, 1152, 230,
          '<div style="display:flex;align-items:flex-start;gap:18px;text-align:left;padding:24px 28px;background:#FEF2F2;border:2px solid #FECACA;border-radius:14px;width:100%;height:100%;">' +
          '<span style="font-size:38px;color:' + MATH_C.red + ';flex:none;">✗</span>' +
          '<div><strong style="font-size:22px;color:' + MATH_C.red + ';">常见错误</strong>' +
          '<p style="margin:6px 0 0;font-size:20px;color:#555;line-height:1.7;">描述典型错误做法、原因分析，指出易忽略的条件。</p></div></div>') +
        tEl('el_' + uid(), 64, 434, 1152, 230,
          '<div style="display:flex;align-items:flex-start;gap:18px;text-align:left;padding:24px 28px;background:#F0FDF4;border:2px solid #BBF7D0;border-radius:14px;width:100%;height:100%;">' +
          '<span style="font-size:38px;color:' + MATH_C.green + ';flex:none;">✓</span>' +
          '<div><strong style="font-size:22px;color:' + MATH_C.green + ';">正确做法</strong>' +
          '<p style="margin:6px 0 0;font-size:20px;color:#555;line-height:1.7;">正确解法、规范流程与检验方法，对比错误思路。</p></div></div>') +
        tEl('el_' + uid(), 64, 668, 1152, 44, '<div style="display:flex;align-items:center;gap:12px;text-align:left;padding:0 20px;background:#FFFBEB;border-left:5px solid ' + MATH_C.gold + ';border-radius:10px;width:100%;height:100%;"><span style="font-size:19px;font-weight:700;color:#B45309;">💡 提醒：</span><span style="font-size:18px;color:#78350F;">贴一个关键注意事项或口诀。</span></div>');
    },

    /* ============ 函数图像页 ============ */
    'math-graph': () => {
      return rEl('el_' + uid(), 0, 0, 1280, 720, '#FFFFFF', 0) +
        mhTitle('📈 函数图像') +
        rEl('el_' + uid(), 64, 176, 1152, 4, '#E5E7EB', 0) +
        // 留白作图区（带浅网格）
        tEl('el_' + uid(), 64, 200, 1152, 420,
          '<div style="width:100%;height:100%;background:repeating-linear-gradient(to right, transparent, transparent 46px, #EEF2FF 46px, #EEF2FF 47px), repeating-linear-gradient(to bottom, transparent, transparent 46px, #EEF2FF 46px, #EEF2FF 47px);border:1px solid ' + MATH_C.line + ';border-radius:8px;position:relative;">' +
          '<div style="position:absolute;left:50%;top:0;bottom:0;width:0;border-left:2px solid ' + MATH_C.line + ';"></div>' +
          '<div style="position:absolute;top:50%;left:0;right:0;height:0;border-top:2px solid ' + MATH_C.line + ';"></div>' +
          '<span style="position:absolute;right:8px;bottom:6px;font-size:17px;color:' + MATH_C.sub + ';">在此绘制 / 粘贴函数图像</span></div>') +
        tEl('el_' + uid(), 64, 652, 1152, 44, '<div style="display:flex;align-items:center;justify-content:flex-start;text-align:left;padding:0 20px;background:' + MATH_C.light + ';border-radius:10px;width:100%;height:100%;"><span style="font-size:19px;color:' + MATH_C.a + ';">定义域：______  值域：______  单调性：______</span></div>');
    },

    /* ============ 综合大题 ============ */
    'math-problem': () => {
      return rEl('el_' + uid(), 0, 0, 1280, 720, '#FFFFFF', 0) +
        mhTitle('🎯 综合大题', '多问递进，规范作答') +
        tEl('el_' + uid(), 64, 176, 1152, 120,
          '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:0 24px;background:#FFFBEB;border:2px solid ' + MATH_C.gold + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:21px;color:' + MATH_C.gold + ';margin-bottom:6px;">【题干】</strong>' +
          '<span style="font-size:19px;color:#444;line-height:1.6;">综合题题干，包含多个小问的公共条件。</span></div>') +
        tEl('el_' + uid(), 64, 320, 560, 200,
          '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:20px 24px;background:#fff;border:1px solid #E5E7EB;border-left:5px solid ' + MATH_C.a + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:20px;color:' + MATH_C.a + ';margin-bottom:8px;">（1）第 1 问</strong>' +
          '<span style="font-size:18px;color:#555;line-height:1.6;">求证/求解内容，注明分值。</span></div>') +
        tEl('el_' + uid(), 656, 320, 560, 200,
          '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:20px 24px;background:#fff;border:1px solid #E5E7EB;border-left:5px solid ' + MATH_C.gold + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:20px;color:' + MATH_C.gold + ';margin-bottom:8px;">（2）第 2 问</strong>' +
          '<span style="font-size:18px;color:#555;line-height:1.6;">深入/延伸内容。</span></div>') +
        tEl('el_' + uid(), 64, 556, 1152, 130,
          '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:20px 24px;background:#F0FDF9;border-left:5px solid ' + MATH_C.green + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:20px;color:' + MATH_C.green + ';margin-bottom:8px;">【规范作答区】</strong>' +
          '<span style="font-size:18px;color:#555;line-height:1.6;">书写解题过程与最终答案。</span></div>');
    },

    /* ============ 考点归纳 ============ */
    'math-key': () => {
      return rEl('el_' + uid(), 0, 0, 1280, 720, '#FFFFFF', 0) +
        mhTitle('📌 考点归纳', '本节重要考点一览') +
        tEl('el_' + uid(), 64, 176, 560, 74, '<div style="display:flex;align-items:center;gap:14px;text-align:left;padding:0 22px;background:' + MATH_C.light + ';border-radius:12px;width:100%;height:100%;"><span style="font-size:26px;flex:none;">①</span><span style="font-size:21px;font-weight:700;color:' + MATH_C.a + ';">考点一</span></div>') +
        tEl('el_' + uid(), 656, 176, 560, 74, '<div style="display:flex;align-items:center;gap:14px;text-align:left;padding:0 22px;background:' + MATH_C.light + ';border-radius:12px;width:100%;height:100%;"><span style="font-size:26px;flex:none;">②</span><span style="font-size:21px;font-weight:700;color:' + MATH_C.a + ';">考点二</span></div>') +
        tEl('el_' + uid(), 64, 274, 560, 74, '<div style="display:flex;align-items:center;gap:14px;text-align:left;padding:0 22px;background:' + MATH_C.light + ';border-radius:12px;width:100%;height:100%;"><span style="font-size:26px;flex:none;">③</span><span style="font-size:21px;font-weight:700;color:' + MATH_C.a + ';">考点三</span></div>') +
        tEl('el_' + uid(), 656, 274, 560, 74, '<div style="display:flex;align-items:center;gap:14px;text-align:left;padding:0 22px;background:' + MATH_C.light + ';border-radius:12px;width:100%;height:100%;"><span style="font-size:26px;flex:none;">④</span><span style="font-size:21px;font-weight:700;color:' + MATH_C.a + ';">考点四</span></div>') +
        tEl('el_' + uid(), 64, 372, 1152, 250,
          '<div style="display:flex;flex-direction:column;justify-content:center;text-align:left;padding:24px 28px;background:#fff;border:2px solid ' + MATH_C.line + ';border-radius:14px;width:100%;height:100%;">' +
          '<strong style="font-size:22px;color:' + MATH_C.ink + ';margin-bottom:12px;">📊 考查频率与题型</strong>' +
          '<span style="font-size:19px;color:#555;line-height:1.8;">每个考点的常见题型、分值占比与命题趋势，用简短文字概括。高考 / 期中期末常以此处为主。</span></div>');
    },

    /* ============ 章节小结 ============ */
    'math-review': () => {
      return rEl('el_' + uid(), 0, 0, 1280, 720, '#FFFFFF', 0) +
        mhTitle('🔁 章节小结') +
        tEl('el_' + uid(), 64, 176, 1152, 300,
          '<div style="width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;text-align:left;padding:0 28px;background:' + MATH_C.light + ';border-radius:14px;">' +
          '<span style="font-size:24px;font-weight:800;color:' + MATH_C.a + ';margin-bottom:14px;">✓ 今日收获</span>' +
          '<span style="font-size:20px;color:#555;line-height:1.8;">掌握了…… 理解了…… 能运用……<br>回顾本节核心概念、公式与典型方法。</span></div>') +
        tEl('el_' + uid(), 64, 504, 560, 160,
          '<div style="display:flex;flex-direction:column;justify-content:center;text-align:left;padding:22px 24px;background:#fff;border:1px solid #E5E7EB;border-left:5px solid ' + MATH_C.gold + ';border-radius:12px;width:100%;height:100%;">' +
          '<span style="font-size:21px;font-weight:800;color:' + MATH_C.gold + ';margin-bottom:8px;">❓ 我的疑惑</span>' +
          '<span style="font-size:18px;color:#555;">写下仍未完全理解之处。</span></div>') +
        tEl('el_' + uid(), 656, 504, 560, 160,
          '<div style="display:flex;flex-direction:column;justify-content:center;text-align:left;padding:22px 24px;background:#fff;border:1px solid #E5E7EB;border-left:5px solid ' + MATH_C.a + ';border-radius:12px;width:100%;height:100%;">' +
          '<span style="font-size:21px;font-weight:800;color:' + MATH_C.a + ';margin-bottom:8px;">📌 待巩固</span>' +
          '<span style="font-size:18px;color:#555;">列出需要复习的薄弱点。</span></div>');
    },
  };

  /* ===== MATH-TOPIC-BLOCK-START ===== */
/* =====================================================================
     "高中数学专题" 模板（math-topic-*）
     按高中数学章节划分的专题版式：函数 / 导数 / 数列 / 三角函数 /
     圆锥曲线 / 概率统计 / 不等式 / 计算。沿用 math-* 讲义风格。
     全部 1280×720，可编辑文字/颜色。
     ===================================================================== */

  const MathTopic = {

    /* ============ 函数专题 ============ */
    'math-func': () => {
      return rEl('el_' + uid(), 0, 0, 1280, 720, '#FFFFFF', 0) +
        mhTitle('ƒ 函数专题', '定义域 · 值域 · 单调性 · 奇偶性') +
        // 定义域/值域小卡
        tEl('el_' + uid(), 64, 176, 560, 110,
          '<div style="display:flex;align-items:center;gap:14px;text-align:left;padding:0 22px;background:' + MATH_C.light + ';border-radius:12px;width:100%;height:100%;"><span style="font-size:30px;flex:none;">🔄</span><div><strong style="font-size:21px;color:' + MATH_C.a + ';">定义域 / 值域</strong><p style="margin:4px 0 0;font-size:18px;color:#555;">求定义域：分母≠0、偶次根式≥0、对数真数>0</p></div></div>') +
        tEl('el_' + uid(), 656, 176, 560, 110,
          '<div style="display:flex;align-items:center;gap:14px;text-align:left;padding:0 22px;background:' + MATH_C.light + ';border-radius:12px;width:100%;height:100%;"><span style="font-size:30px;flex:none;">📈</span><div><strong style="font-size:21px;color:' + MATH_C.a + ';">单调性</strong><p style="margin:4px 0 0;font-size:18px;color:#555;">用定义或导数判定增/减区间</p></div></div>') +
        tEl('el_' + uid(), 64, 306, 560, 110,
          '<div style="display:flex;align-items:center;gap:14px;text-align:left;padding:0 22px;background:' + MATH_C.light + ';border-radius:12px;width:100%;height:100%;"><span style="font-size:30px;flex:none;">⚖️</span><div><strong style="font-size:21px;color:' + MATH_C.a + ';">奇偶性</strong><p style="margin:4px 0 0;font-size:18px;color:#555;">f(-x)=f(x) 偶 / f(-x)=-f(x) 奇</p></div></div>') +
        tEl('el_' + uid(), 656, 306, 560, 110,
          '<div style="display:flex;align-items:center;gap:14px;text-align:left;padding:0 22px;background:' + MATH_C.light + ';border-radius:12px;width:100%;height:100%;"><span style="font-size:30px;flex:none;">🎯</span><div><strong style="font-size:21px;color:' + MATH_C.a + ';">最值</strong><p style="margin:4px 0 0;font-size:18px;color:#555;">结合单调性求最大/最小值</p></div></div>') +
        // 例题区
        tEl('el_' + uid(), 64, 440, 1152, 230,
          '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:22px 28px;background:#FFF8F0;border:2px solid ' + MATH_C.gold + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:21px;color:' + MATH_C.gold + ';margin-bottom:10px;">✏ 例：已知函数 f(x)，求其定义域并判断单调性</strong>' +
          '<div style="width:100%;height:100%;background:repeating-linear-gradient(to bottom, transparent, transparent 34px, #F3F4F6 34px, #F3F4F6 35px);border-radius:8px;"></div></div>');
    },

    /* ============ 导数专题 ============ */
    'math-deriv': () => {
      return rEl('el_' + uid(), 0, 0, 1280, 720, '#FFFFFF', 0) +
        mhTitle('∂ 导数专题', '求导 · 单调性 · 极值 · 切线') +
        tEl('el_' + uid(), 64, 176, 1152, 110,
          '<div style="display:flex;align-items:center;gap:16px;text-align:left;padding:0 26px;background:' + MATH_C.light + ';border-left:5px solid ' + MATH_C.a + ';border-radius:12px;width:100%;height:100%;"><span style="font-size:32px;flex:none;">🧾</span><div><strong style="font-size:22px;color:' + MATH_C.a + ';">常用求导公式</strong><p style="margin:4px 0 0;font-size:19px;color:#555;line-height:1.7;">(xⁿ)′=nxⁿ⁻¹　(sinx)′=cosx　(lnx)′=1/x　(eˣ)′=eˣ</p></div></div>') +
        tEl('el_' + uid(), 64, 310, 560, 200,
          '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:20px 24px;background:#fff;border:2px solid ' + MATH_C.line + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:21px;color:' + MATH_C.a + ';margin-bottom:10px;">📝 切线方程</strong>' +
          '<span style="font-size:18px;color:#555;line-height:1.8;">f′(x₀) 为切线斜率<br>y - f(x₀) = f′(x₀)(x - x₀)</span></div>') +
        tEl('el_' + uid(), 656, 310, 560, 200,
          '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:20px 24px;background:#fff;border:2px solid ' + MATH_C.line + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:21px;color:' + MATH_C.a + ';margin-bottom:10px;">🔍 极值判定</strong>' +
          '<span style="font-size:18px;color:#555;line-height:1.8;">f′>0 单调增；f′<0 单调减<br>f′变号处取得极值</span></div>') +
        tEl('el_' + uid(), 64, 534, 1152, 136,
          '<div style="display:flex;flex-direction:column;justify-content:center;text-align:left;padding:0 26px;background:#F0FDF9;border-left:5px solid ' + MATH_C.green + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:21px;color:' + MATH_C.green + ';margin-bottom:8px;">【解题流程】</strong><span style="font-size:19px;color:#444;line-height:1.7;">求导 → 令 f′=0 求驻点 → 列表判断符号 → 得单调区间与极值 → 作答。</span></div>');
    },

    /* ============ 数列专题 ============ */
    'math-seq': () => {
      return rEl('el_' + uid(), 0, 0, 1280, 720, '#FFFFFF', 0) +
        mhTitle('∑ 数列专题', '等差 · 等比 · 通项 · 求和') +
        tEl('el_' + uid(), 64, 176, 560, 200,
          '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:' + MATH_C.light + ';border:2px solid ' + MATH_C.line + ';border-radius:12px;width:100%;height:100%;">' +
          '<span style="font-size:19px;color:' + MATH_C.sub + ';margin-bottom:6px;">等差数列</span>' +
          '<span style="font-size:26px;font-weight:800;color:' + MATH_C.a + ';">aₙ = a₁ + (n-1)d</span>' +
          '<span style="font-size:20px;font-weight:700;color:' + MATH_C.a + ';margin-top:6px;">Sₙ = n(a₁+aₙ)/2</span></div>') +
        tEl('el_' + uid(), 656, 176, 560, 200,
          '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:' + MATH_C.light + ';border:2px solid ' + MATH_C.line + ';border-radius:12px;width:100%;height:100%;">' +
          '<span style="font-size:19px;color:' + MATH_C.sub + ';margin-bottom:6px;">等比数列（q≠1）</span>' +
          '<span style="font-size:26px;font-weight:800;color:' + MATH_C.a + ';">aₙ = a₁·qⁿ⁻¹</span>' +
          '<span style="font-size:20px;font-weight:700;color:' + MATH_C.a + ';margin-top:6px;">Sₙ = a₁(1-qⁿ)/(1-q)</span></div>') +
        tEl('el_' + uid(), 64, 400, 1152, 270,
          '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:22px 28px;background:#FFF8F0;border:2px solid ' + MATH_C.gold + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:21px;color:' + MATH_C.gold + ';margin-bottom:10px;">✏ 例：已知数列 {aₙ}，求通项 aₙ 与前 n 项和 Sₙ</strong>' +
          '<div style="width:100%;height:100%;background:repeating-linear-gradient(to bottom, transparent, transparent 34px, #F3F4F6 34px, #F3F4F6 35px);border-radius:8px;"></div></div>');
    },

    /* ============ 三角函数专题 ============ */
    'math-trig': () => {
      return rEl('el_' + uid(), 0, 0, 1280, 720, '#FFFFFF', 0) +
        mhTitle('sin/cos 三角函数', '诱导公式 · 图像性质 · 恒等变换') +
        tEl('el_' + uid(), 64, 176, 1152, 110,
          '<div style="display:flex;align-items:center;gap:16px;text-align:left;padding:0 26px;background:' + MATH_C.light + ';border-left:5px solid ' + MATH_C.a + ';border-radius:12px;width:100%;height:100%;"><span style="font-size:30px;flex:none;">🧾</span><div><strong style="font-size:22px;color:' + MATH_C.a + ';">公式</strong><p style="margin:4px 0 0;font-size:18px;color:#555;line-height:1.7;">sin²+cos²=1　tan=sin/cos　sin(π-α)=sinα　sin(π/2-α)=cosα</p></div></div>') +
        tEl('el_' + uid(), 64, 310, 560, 200,
          '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:#fff;border:2px solid ' + MATH_C.line + ';border-radius:12px;width:100%;height:100%;">' +
          '<span style="font-size:19px;color:' + MATH_C.sub + ';margin-bottom:6px;">y = sinx</span>' +
          '<span style="font-size:25px;font-weight:800;color:' + MATH_C.a + ';">周期 2π　值域 [-1,1]</span></div>') +
        tEl('el_' + uid(), 656, 310, 560, 200,
          '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:#fff;border:2px solid ' + MATH_C.line + ';border-radius:12px;width:100%;height:100%;">' +
          '<span style="font-size:19px;color:' + MATH_C.sub + ';margin-bottom:6px;">y = cosx</span>' +
          '<span style="font-size:25px;font-weight:800;color:' + MATH_C.a + ';">周期 2π　值域 [-1,1]</span></div>') +
        tEl('el_' + uid(), 64, 534, 1152, 136,
          '<div style="display:flex;flex-direction:column;justify-content:center;text-align:left;padding:0 26px;background:#F0FDF9;border-left:5px solid ' + MATH_C.green + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:21px;color:' + MATH_C.green + ';margin-bottom:8px;">【图象变换】</strong><span style="font-size:19px;color:#444;line-height:1.7;">y=sinx → y=Asin(ωx+φ)：A 振幅、ω 周期、φ 相位平移。</span></div>');
    },

    /* ============ 圆锥曲线专题 ============ */
    'math-conic': () => {
      return rEl('el_' + uid(), 0, 0, 1280, 720, '#FFFFFF', 0) +
        mhTitle('◯ 圆锥曲线', '椭圆 · 双曲线 · 抛物线') +
        tEl('el_' + uid(), 64, 176, 363, 220,
          '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:' + MATH_C.light + ';border-top:5px solid ' + MATH_C.a + ';border-radius:12px;width:100%;height:100%;">' +
          '<span style="font-size:22px;font-weight:800;color:' + MATH_C.a + ';margin-bottom:8px;">椭圆</span>' +
          '<span style="font-size:19px;color:#555;line-height:1.6;">x²/a² + y²/b² = 1<br>a²=b²+c²</span></div>') +
        tEl('el_' + uid(), 459, 176, 363, 220,
          '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:' + MATH_C.light + ';border-top:5px solid ' + MATH_C.gold + ';border-radius:12px;width:100%;height:100%;">' +
          '<span style="font-size:22px;font-weight:800;color:' + MATH_C.gold + ';margin-bottom:8px;">双曲线</span>' +
          '<span style="font-size:19px;color:#555;line-height:1.6;">x²/a² − y²/b² = 1<br>c²=a²+b²</span></div>') +
        tEl('el_' + uid(), 854, 176, 363, 220,
          '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:' + MATH_C.light + ';border-top:5px solid ' + MATH_C.green + ';border-radius:12px;width:100%;height:100%;">' +
          '<span style="font-size:22px;font-weight:800;color:' + MATH_C.green + ';margin-bottom:8px;">抛物线</span>' +
          '<span style="font-size:19px;color:#555;line-height:1.6;">y²=2px<br>焦点 (p/2, 0)</span></div>') +
        // 作图区
        tEl('el_' + uid(), 64, 420, 1152, 250,
          '<div style="display:flex;flex-direction:column;align-items:center;justify-content:flex-start;text-align:left;padding:20px 26px;background:#fff;border:2px solid ' + MATH_C.line + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:21px;color:' + MATH_C.a + ';margin-bottom:10px;align-self:flex-start;">📐 作图 / 联立求解区</strong>' +
          '<div style="width:100%;flex:1;background:repeating-linear-gradient(to right, transparent, transparent 40px, #F3F4F6 40px, #F3F4F6 41px), repeating-linear-gradient(to bottom, transparent, transparent 40px, #F3F4F6 40px, #F3F4F6 41px);border-radius:8px;border:1px solid #E5E7EB;"></div></div>');
    },

    /* ============ 概率统计专题 ============ */
    'math-prob': () => {
      return rEl('el_' + uid(), 0, 0, 1280, 720, '#FFFFFF', 0) +
        mhTitle('🎲 概率统计', '古典概型 · 分布列 · 期望方差') +
        tEl('el_' + uid(), 64, 176, 560, 220,
          '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:' + MATH_C.light + ';border:2px solid ' + MATH_C.line + ';border-radius:12px;width:100%;height:100%;">' +
          '<span style="font-size:20px;color:' + MATH_C.sub + ';margin-bottom:6px;">古典概型</span>' +
          '<span style="font-size:34px;font-weight:800;color:' + MATH_C.a + ';">P = 事件数 / 总数</span></div>') +
        tEl('el_' + uid(), 656, 176, 560, 220,
          '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:' + MATH_C.light + ';border:2px solid ' + MATH_C.line + ';border-radius:12px;width:100%;height:100%;">' +
          '<span style="font-size:20px;color:' + MATH_C.sub + ';margin-bottom:6px;">期望 / 方差</span>' +
          '<span style="font-size:24px;font-weight:800;color:' + MATH_C.a + ';">E(X)=∑xᵢpᵢ　D(X)=E(X²)-[E(X)]²</span></div>') +
        tEl('el_' + uid(), 64, 420, 1152, 250,
          '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:22px 28px;background:#FFF8F0;border:2px solid ' + MATH_C.gold + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:21px;color:' + MATH_C.gold + ';margin-bottom:10px;">✏ 例：某随机变量 X 的分布列及期望、方差</strong>' +
          '<div style="width:100%;height:100%;background:repeating-linear-gradient(to bottom, transparent, transparent 34px, #F3F4F6 34px, #F3F4F6 35px);border-radius:8px;"></div></div>');
    },

    /* ============ 不等式专题 ============ */
    'math-ineq': () => {
      return rEl('el_' + uid(), 0, 0, 1280, 720, '#FFFFFF', 0) +
        mhTitle('≷ 不等式', '均值不等式 · 解不等式') +
        tEl('el_' + uid(), 64, 176, 1152, 120,
          '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:' + MATH_C.light + ';border:2px solid ' + MATH_C.line + ';border-radius:12px;width:100%;height:100%;">' +
          '<span style="font-size:19px;color:' + MATH_C.sub + ';margin-bottom:6px;">均值不等式（a,b>0）</span>' +
          '<span style="font-size:32px;font-weight:800;color:' + MATH_C.a + ';">a + b ≥ 2√(ab)</span></div>') +
        tEl('el_' + uid(), 64, 316, 560, 200,
          '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:20px 24px;background:#fff;border:2px solid ' + MATH_C.line + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:21px;color:' + MATH_C.a + ';margin-bottom:10px;">💡 取等条件</strong>' +
          '<span style="font-size:18px;color:#555;line-height:1.8;">当且仅当 a=b 时取得等号<br>常用于求最值</span></div>') +
        tEl('el_' + uid(), 656, 316, 560, 200,
          '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:20px 24px;background:#fff;border:2px solid ' + MATH_C.line + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:21px;color:' + MATH_C.a + ';margin-bottom:10px;">📝 解不等式类型</strong>' +
          '<span style="font-size:18px;color:#555;line-height:1.8;">一元二次 / 分式 / 含参不等式<br>注意判别式与讨论</span></div>') +
        tEl('el_' + uid(), 64, 540, 1152, 130,
          '<div style="display:flex;flex-direction:column;justify-content:center;text-align:left;padding:0 26px;background:#F0FDF9;border-left:5px solid ' + MATH_C.green + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:21px;color:' + MATH_C.green + ';margin-bottom:8px;">✏ 例：利用均值不等式求最值</strong>' +
          '<span style="font-size:19px;color:#444;line-height:1.7;">一正二定三相等——先看正、再凑定值、最后验取等。</span></div>');
    },

    /* ============ 计算 / 解答题 ============ */
    'math-calc': () => {
      return rEl('el_' + uid(), 0, 0, 1280, 720, '#FFFFFF', 0) +
        mhTitle('🧮 计算题', '规范步骤 · 准确结果') +
        tEl('el_' + uid(), 64, 176, 1152, 130,
          '<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;padding:0 26px;background:#FFF8F0;border:2px solid ' + MATH_C.gold + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:21px;color:' + MATH_C.gold + ';margin-bottom:6px;">【题目】</strong>' +
          '<span style="font-size:20px;color:#444;line-height:1.6;">请计算：________________________________</span></div>') +
        tEl('el_' + uid(), 64, 330, 1152, 340,
          '<div style="display:flex;flex-direction:column;justify-content:flex-start;text-align:left;padding:24px 28px;background:#fff;border:1px solid #E5E7EB;border-left:5px solid ' + MATH_C.a + ';border-radius:12px;width:100%;height:100%;">' +
          '<strong style="font-size:21px;color:' + MATH_C.a + ';margin-bottom:12px;">【解答过程】</strong>' +
          '<div style="width:100%;flex:1;background:repeating-linear-gradient(to bottom, transparent, transparent 36px, #F3F4F6 36px, #F3F4F6 37px);border-radius:8px;"></div></div>');
    },
  };
  try { Object.assign(MathLecture, MathTopic); } catch (e) {}
  /* ===== MATH-TOPIC-BLOCK-END ===== */

  /* ===== MATH-BLOCK-END ===== */

  /* ===== Shape SVG generators ===== */
  // line-type → stroke-dasharray (shape = viewBox units; px = non-scaling screen px for line/arrow/curve)
  function shapeDash(dash, px) {
    const map = px
      ? { solid: '', dashed: '14 9', dotted: '3 9', dashdot: '16 7 3 7' }
      : { solid: '', dashed: '8 6', dotted: '2 6', dashdot: '10 4 2 4' };
    return map[dash] || '';
  }

  const Shapes = {
    rect: function(fill, stroke, sw, dash) {
      const d = shapeDash(dash, false);
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
        '<rect x="2" y="2" width="96" height="96" rx="3" fill="' + fill + '"' +
        (sw > 0 ? ' stroke="' + stroke + '" stroke-width="' + (sw * 2) + '"' + (d ? ' stroke-dasharray="' + d + '" stroke-linecap="round"' : '') : '') + '/></svg>';
    },
    ellipse: function(fill, stroke, sw, dash) {
      const d = shapeDash(dash, false);
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
        '<ellipse cx="50" cy="50" rx="48" ry="48" fill="' + fill + '"' +
        (sw > 0 ? ' stroke="' + stroke + '" stroke-width="' + (sw * 2) + '"' + (d ? ' stroke-dasharray="' + d + '" stroke-linecap="round"' : '') : '') + '/></svg>';
    },
    triangle: function(fill, stroke, sw, dash) {
      const d = shapeDash(dash, false);
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
        '<polygon points="50,4 96,96 4,96" fill="' + fill + '"' +
        (sw > 0 ? ' stroke="' + stroke + '" stroke-width="' + (sw * 2) + '" stroke-linejoin="round"' + (d ? ' stroke-dasharray="' + d + '" stroke-linecap="round"' : '') : '') + '/></svg>';
    },
    line: function(fill, stroke, sw, dash) {
      var c = stroke || fill;
      var w = Math.max(sw || 3, 2);
      var d = shapeDash(dash, true);
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
        '<line x1="0" y1="50" x2="100" y2="50" stroke="' + c + '" stroke-width="' + w + '" stroke-linecap="round" vector-effect="non-scaling-stroke"' + (d ? ' stroke-dasharray="' + d + '"' : '') + '/>' +
        '</svg>';
    },
    arrow: function(fill, stroke, sw, dash) {
      var c = stroke || fill;
      var w = Math.max(sw || 3, 2);
      var d = shapeDash(dash, true);
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
        '<path d="M2 50 L72 50 M60 32 L90 50 L60 68" stroke="' + c + '" stroke-width="' + w + '" fill="none" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"' + (d ? ' stroke-dasharray="' + d + '"' : '') + '/>' +
        '</svg>';
    },

    /** Regular polygon (任意多边形). sides defaults to 5. */
    polygon: function(fill, stroke, sw, dash, sides) {
      sides = sides || 5;
      const cx = 50, cy = 50, r = 48;
      const pts = [];
      for (let i = 0; i < sides; i++) {
        const ang = -Math.PI / 2 + i * 2 * Math.PI / sides;
        pts.push((cx + r * Math.cos(ang)).toFixed(2) + ',' + (cy + r * Math.sin(ang)).toFixed(2));
      }
      const d = shapeDash(dash, false);
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
        '<polygon points="' + pts.join(' ') + '" fill="' + fill + '"' +
        (sw > 0 ? ' stroke="' + stroke + '" stroke-width="' + (sw * 2) + '" stroke-linejoin="round"' + (d ? ' stroke-dasharray="' + d + '" stroke-linecap="round"' : '') : '') + '/></svg>';
    },

    /** Diamond (菱形) — a 4-sided polygon */
    diamond: function(fill, stroke, sw, dash) {
      return this.polygon(fill, stroke, sw, dash, 4);
    },

    /** Five-pointed star (五角星) */
    star: function(fill, stroke, sw, dash) {
      const cx = 50, cy = 50, ro = 48, ri = 20, n = 5;
      const pts = [];
      for (let i = 0; i < n * 2; i++) {
        const r = (i % 2 === 0) ? ro : ri;
        const ang = -Math.PI / 2 + i * Math.PI / n;
        pts.push((cx + r * Math.cos(ang)).toFixed(2) + ',' + (cy + r * Math.sin(ang)).toFixed(2));
      }
      const d = shapeDash(dash, false);
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
        '<polygon points="' + pts.join(' ') + '" fill="' + fill + '"' +
        (sw > 0 ? ' stroke="' + stroke + '" stroke-width="' + (sw * 2) + '" stroke-linejoin="round"' + (d ? ' stroke-dasharray="' + d + '" stroke-linecap="round"' : '') : '') + '/></svg>';
    },

    /** Smooth Bézier curve (曲线) */
    curve: function(fill, stroke, sw, dash) {
      const c = stroke || fill;
      const w = Math.max(sw || 3, 2);
      var d = shapeDash(dash, true);
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
        '<path d="M2 75 C 28 5, 72 95, 98 25" stroke="' + c + '" stroke-width="' + w + '" fill="none" stroke-linecap="round" vector-effect="non-scaling-stroke"' + (d ? ' stroke-dasharray="' + d + '"' : '') + '/>' +
        '</svg>';
    },

    /* ===== 教学数学图形（数学曲线 / 几何）===== */
    /** 抛物线 y = x^2 */
    parabola: function(fill, stroke, sw, dash) {
      const c = stroke || fill, w = Math.max(sw || 3, 2), d = shapeDash(dash, true);
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
        '<path d="M12 90 Q 55 12, 97 90" stroke="' + c + '" stroke-width="' + w + '" fill="none" stroke-linecap="round" vector-effect="non-scaling-stroke"' + (d ? ' stroke-dasharray="' + d + '"' : '') + '/>' +
        '</svg>';
    },
    /** 正弦(y=sin x) 或 余弦(y=cos x)，data-gg = sine|cosine-相移由 data-phase 控制 */
    /** 正弦曲线 */
    sine: function(fill, stroke, sw, dash) {
      const c = stroke || fill, w = Math.max(sw || 3, 2), d = shapeDash(dash, true);
      let pts = [];
      for (let i = 0; i <= 60; i++) { const x = i / 60 * 100; const y = 50 - 32 * Math.sin((i / 60) * Math.PI * 2); pts.push(x.toFixed(1) + ',' + y.toFixed(1)); }
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
        '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + c + '" stroke-width="' + w + '" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"' + (d ? ' stroke-dasharray="' + d + '"' : '') + '/>' +
        '</svg>';
    },
    /** 余弦曲线 */
    cosine: function(fill, stroke, sw, dash) {
      const c = stroke || fill, w = Math.max(sw || 3, 2), d = shapeDash(dash, true);
      let pts = [];
      for (let i = 0; i <= 60; i++) { const x = i / 60 * 100; const y = 50 - 32 * Math.cos((i / 60) * Math.PI * 2); pts.push(x.toFixed(1) + ',' + y.toFixed(1)); }
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
        '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + c + '" stroke-width="' + w + '" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"' + (d ? ' stroke-dasharray="' + d + '"' : '') + '/>' +
        '</svg>';
    },
    /** 指数曲线 y=2^x */
    exp: function(fill, stroke, sw, dash) {
      const c = stroke || fill, w = Math.max(sw || 3, 2), d = shapeDash(dash, true);
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
        '<path d="M12 90 Q 40 78, 97 10" stroke="' + c + '" stroke-width="' + w + '" fill="none" stroke-linecap="round" vector-effect="non-scaling-stroke"' + (d ? ' stroke-dasharray="' + d + '"' : '') + '/>' +
        '</svg>';
    },
    /** 对数曲线 y=log x */
    log: function(fill, stroke, sw, dash) {
      const c = stroke || fill, w = Math.max(sw || 3, 2), d = shapeDash(dash, true);
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
        '<path d="M12 10 Q 22 50, 97 88" stroke="' + c + '" stroke-width="' + w + '" fill="none" stroke-linecap="round" vector-effect="non-scaling-stroke"' + (d ? ' stroke-dasharray="' + d + '"' : '') + '/>' +
        '</svg>';
    },
    /** 绝对值 |x| */
    abs: function(fill, stroke, sw, dash) {
      const c = stroke || fill, w = Math.max(sw || 3, 2), d = shapeDash(dash, true);
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
        '<path d="M12 92 L 50 20 L 88 92" stroke="' + c + '" stroke-width="' + w + '" fill="none" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"' + (d ? ' stroke-dasharray="' + d + '"' : '') + '/>' +
        '</svg>';
    },
    /** 三次函数 y=x^3 */
    cubic: function(fill, stroke, sw, dash) {
      const c = stroke || fill, w = Math.max(sw || 3, 2), d = shapeDash(dash, true);
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
        '<path d="M12 82 C 35 78, 60 22, 88 18" stroke="' + c + '" stroke-width="' + w + '" fill="none" stroke-linecap="round" vector-effect="non-scaling-stroke"' + (d ? ' stroke-dasharray="' + d + '"' : '') + '/>' +
        '</svg>';
    },
    /** 平面直角坐标系（带箭头与刻度） */
    axes: function(fill, stroke, sw, dash) {
      const c = stroke || fill, w = Math.max(sw || 3, 2), d = shapeDash(dash, true);
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
        '<line x1="6" y1="90" x2="94" y2="90" stroke="' + c + '" stroke-width="' + w + '" vector-effect="non-scaling-stroke"/><polygon points="94,90 86,86 86,94" fill="' + c + '"/>' +
        '<line x1="50" y1="96" x2="50" y2="6" stroke="' + c + '" stroke-width="' + w + '" vector-effect="non-scaling-stroke"/><polygon points="50,6 46,14 54,14" fill="' + c + '"/>' +
        '<line x1="50" y1="88" x2="50" y2="92" stroke="' + c + '" stroke-width="1" vector-effect="non-scaling-stroke"/>' +
        '<line x1="50" y1="2" x2="50" y2="10" stroke="' + c + '" stroke-width="1" vector-effect="non-scaling-stroke"/>' +
        (d ? '' : '') +
        '</svg>';
    },
    /** 数轴（水平，带箭头与刻度） */
    numline: function(fill, stroke, sw, dash) {
      const c = stroke || fill, w = Math.max(sw || 3, 2);
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
        '<line x1="6" y1="50" x2="94" y2="50" stroke="' + c + '" stroke-width="' + w + '" vector-effect="non-scaling-stroke"/><polygon points="94,50 86,46 86,54" fill="' + c + '"/>' +
        '<line x1="20" y1="45" x2="20" y2="55" stroke="' + c + '" stroke-width="1.5" vector-effect="non-scaling-stroke"/>' +
        '<line x1="35" y1="45" x2="35" y2="55" stroke="' + c + '" stroke-width="1.5" vector-effect="non-scaling-stroke"/>' +
        '<line x1="50" y1="44" x2="50" y2="56" stroke="' + c + '" stroke-width="2" vector-effect="non-scaling-stroke"/>' +
        '<line x1="65" y1="45" x2="65" y2="55" stroke="' + c + '" stroke-width="1.5" vector-effect="non-scaling-stroke"/>' +
        '<line x1="80" y1="45" x2="80" y2="55" stroke="' + c + '" stroke-width="1.5" vector-effect="non-scaling-stroke"/>' +
        '</svg>';
    },
    /** 集合 Venn 图（两个圆） */
    venn: function(fill, stroke, sw, dash) {
      const c = stroke || fill, w = Math.max(sw || 3, 2);
      const label = (t,x,y) => '<text x="'+x+'" y="'+y+'" font-family="Georgia, serif" font-style="italic" font-size="13" fill="'+c+'" text-anchor="middle">'+t+'</text>';
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
        '<circle cx="38" cy="50" r="26" fill="' + fill + '" fill-opacity="0.15" stroke="' + c + '" stroke-width="' + w + '"/>' +
        '<circle cx="62" cy="50" r="26" fill="' + fill + '" fill-opacity="0.15" stroke="' + c + '" stroke-width="' + w + '"/>' +
        label('A',34,54) + label('B',66,54) +
        '</svg>';
    },

    /* ===== 集合运算 Venn（阴影标示） ===== */

    /** 交集 A∩B：两圆重叠的"透镜"区用阴影填充 */
    vennInter: function(fill, stroke, sw, dash) {
      const c = stroke || fill, w = Math.max(sw || 2, 1);
      const shade = '#e11d48';
      const label = (t,x,y,fs) => '<text x="'+x+'" y="'+y+'" font-family="Georgia, serif" font-style="italic" font-size="'+(fs||13)+'" fill="'+c+'" text-anchor="middle">'+t+'</text>';
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
        '<defs><clipPath id="vlA"><circle cx="38" cy="50" r="26"/></clipPath></defs>' +
        '<circle cx="62" cy="50" r="26" fill="' + shade + '" fill-opacity="0.45" clip-path="url(#vlA)"/>' +
        '<circle cx="38" cy="50" r="26" fill="none" stroke="' + c + '" stroke-width="' + w + '"/>' +
        '<circle cx="62" cy="50" r="26" fill="none" stroke="' + c + '" stroke-width="' + w + '"/>' +
        label('A',28,54) + label('B',72,54) + label('A∩B',50,46,12) +
        '</svg>';
    },

    /** 并集 A∪B：两圆整体用阴影填充 */
    vennUnion: function(fill, stroke, sw, dash) {
      const c = stroke || fill, w = Math.max(sw || 2, 1);
      const shade = '#e11d48';
      const label = (t,x,y,fs) => '<text x="'+x+'" y="'+y+'" font-family="Georgia, serif" font-style="italic" font-size="'+(fs||13)+'" fill="'+c+'" text-anchor="middle">'+t+'</text>';
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
        '<circle cx="38" cy="50" r="26" fill="' + shade + '" fill-opacity="0.45"/>' +
        '<circle cx="62" cy="50" r="26" fill="' + shade + '" fill-opacity="0.45"/>' +
        '<circle cx="38" cy="50" r="26" fill="none" stroke="' + c + '" stroke-width="' + w + '"/>' +
        '<circle cx="62" cy="50" r="26" fill="none" stroke="' + c + '" stroke-width="' + w + '"/>' +
        label('A',28,54) + label('B',72,54) + label('A∪B',50,46,12) +
        '</svg>';
    },

    /** 补集(补A)：全集矩形填充阴影，椭圆 A 内部留白（evenodd 挖空） */
    vennComp: function(fill, stroke, sw, dash) {
      const c = stroke || fill, w = Math.max(sw || 2, 1);
      const shade = '#e11d48';
      const ex = 40, ey = 50, erx = 30, ery = 21;
      // 矩形 + 椭圆(挖空) → 阴影落在"全集 − A"（A 留白）
      const rect = 'M8 12 H92 V88 H8 Z';
      const ell = 'M' + (ex - erx) + ' ' + ey + ' a' + erx + ' ' + ery + ' 0 1 0 ' + (erx * 2) + ' 0 a' + erx + ' ' + ery + ' 0 1 0 -' + (erx * 2) + ' 0 Z';
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
        '<path fill="' + shade + '" fill-opacity="0.4" fill-rule="evenodd" d="' + rect + ' ' + ell + '"/>' +
        '<rect x="8" y="12" width="84" height="76" fill="none" stroke="' + c + '" stroke-width="1.4"/>' +
        '<ellipse cx="' + ex + '" cy="' + ey + '" rx="' + erx + '" ry="' + ery + '" fill="none" stroke="' + c + '" stroke-width="' + w + '"/>' +
        '<text x="' + ex + '" y="' + (ey + 5) + '" font-family="Georgia, serif" font-style="italic" font-size="13" fill="' + c + '" text-anchor="middle">A</text>' +
        '<text x="70" y="70" font-family="Georgia, serif" font-style="italic" font-size="12" fill="' + c + '" text-anchor="middle">∁<tspan baseline-shift="super" font-size="8">U</tspan>A</text>' +
        '<text x="90" y="18" font-family="Georgia, serif" font-style="italic" font-size="11" fill="' + c + '" text-anchor="end">U</text>' +
        '</svg>';
    },

    /** 差集 A−B：圆A中除去与B重叠的部分用阴影填充 */
    vennDiff: function(fill, stroke, sw, dash) {
      const c = stroke || fill, w = Math.max(sw || 2, 1);
      const shade = '#e11d48';
      const label = (t,x,y) => '<text x="'+x+'" y="'+y+'" font-family="Georgia, serif" font-style="italic" font-size="13" fill="'+c+'" text-anchor="middle">'+t+'</text>';
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
        '<path fill="' + shade + '" fill-opacity="0.45" fill-rule="evenodd" d="M38 50 a26 26 0 1 0 0.01 0 Z M62 50 a26 26 0 1 0 0.01 0 Z"/>' +
        '<circle cx="38" cy="50" r="26" fill="none" stroke="' + c + '" stroke-width="' + w + '"/>' +
        '<circle cx="62" cy="50" r="26" fill="none" stroke="' + c + '" stroke-width="' + w + '"/>' +
        label('A',28,54) + label('B',72,54) + label('A−B',32,44) +
        '</svg>';
    },

    /** 子集 A⊂B：小圆 A 完全在 大圆 B 内（无阴影，只用两个圆表示包含关系） */
    vennSubset: function(fill, stroke, sw, dash) {
      const c = stroke || fill, w = Math.max(sw || 2, 1);
      const A = '#38a169';
      // B 大圆(50,50,r40)；A 小圆(55,50,r18) 在 B 内
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
        '<circle cx="55" cy="50" r="18" fill="' + A + '" fill-opacity="0.55" stroke="' + c + '" stroke-width="' + w + '"/>' +
        '<circle cx="50" cy="50" r="40" fill="none" stroke="' + c + '" stroke-width="' + w + '"/>' +
        '<text x="55" y="54" font-family="Georgia, serif" font-style="italic" font-size="13" fill="' + c + '" text-anchor="middle">A</text>' +
        '<text x="20" y="86" font-family="Georgia, serif" font-style="italic" font-size="13" fill="' + c + '" text-anchor="middle">B</text>' +
        '<text x="84" y="30" font-family="Georgia, serif" font-style="italic" font-size="12" fill="' + c + '" text-anchor="middle">A⊂B</text>' +
        '</svg>';
    },
    /** 直角三角形 */
    righttri: function(fill, stroke, sw, dash) {
      const d = shapeDash(dash, false), c = stroke || fill, w = Math.max(sw || 2, 1);
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
        '<polygon points="10,10 10,90 90,90" fill="' + fill + '"' + (sw > 0 ? ' stroke="' + c + '" stroke-width="' + (sw * 2) + '" stroke-linejoin="round"' + (d ? ' stroke-dasharray="' + d + '"' : '') : '') + '/>' +
        '<rect x="10" y="74" width="16" height="16" fill="none" stroke="' + c + '" stroke-width="1.2"/>' +
        '</svg>';
    },
    /** 直角/任意角（角符号） */
    angle: function(fill, stroke, sw, dash) {
      const c = stroke || fill, w = Math.max(sw || 3, 2), d = shapeDash(dash, true);
      // 顶点 V=(10,90)；两边到 A=(90,90)、B=(70,20)。以 V 为圆心、R 为半径，
      // 弧两端点分别落在两条边上。
      const V = [10,90], A = [90,90], B = [70,20], R = 22;
      const len = Math.hypot(B[0]-V[0], B[1]-V[1]);
      const ux = (B[0]-V[0])/len, uy = (B[1]-V[1])/len;
      const P1 = [V[0]+R, V[1]];            // 水平边上：V 沿水平向右 R
      const P2 = [V[0]+R*ux, V[1]+R*uy];    // 斜边上：V 沿方向 B 走 R
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
        '<line x1="' + V[0] + '" y1="' + V[1] + '" x2="' + A[0] + '" y2="' + A[1] + '" stroke="' + c + '" stroke-width="' + w + '" vector-effect="non-scaling-stroke"/>' +
        '<line x1="' + V[0] + '" y1="' + V[1] + '" x2="' + B[0] + '" y2="' + B[1] + '" stroke="' + c + '" stroke-width="' + w + '" vector-effect="non-scaling-stroke"' + (d ? ' stroke-dasharray="' + d + '"' : '') + '/>' +
        '<path d="M' + P1[0].toFixed(1) + ' ' + P1[1].toFixed(1) + ' A ' + R + ' ' + R + ' 0 0 0 ' + P2[0].toFixed(1) + ' ' + P2[1].toFixed(1) + '" fill="none" stroke="#e11d48" stroke-width="2.2" stroke-linecap="round"/>' +
        '</svg>';
    },
    /** 半圆 */
    semicircle: function(fill, stroke, sw, dash) {
      const d = shapeDash(dash, false), c = stroke || fill, w = Math.max(sw || 2, 1);
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
        '<path d="M10 90 A 40 40 0 0 1 90 90 Z" fill="' + fill + '"' + (sw > 0 ? ' stroke="' + c + '" stroke-width="' + (sw * 2) + '"' + (d ? ' stroke-dasharray="' + d + '"' : '') : '') + '/>' +
        '</svg>';
    },

    /* ===== 立体几何角（斜投影示意） ===== */

    /** 二面角：两个平面相交于一条棱，弧标出二面角 */
    dihedral: function(fill, stroke, sw, dash) {
      const c = stroke || fill, w = Math.max(sw || 2, 1);
      const line=(a,bc,w2,dd)=>'<line x1="'+a[0]+'" y1="'+a[1]+'" x2="'+bc[0]+'" y2="'+bc[1]+'" stroke="'+c+'" stroke-width="'+w2+'"'+(dd?' stroke-dasharray="4 3"':'')+'/>';
      const left = line([45,22],[10,42],w,false) + line([45,84],[10,104],w,false) + line([10,42],[10,104],w,false) + line([45,84],[45,22],w,false);
      const right = line([45,22],[80,42],w,false) + line([45,84],[80,104],w,false) + line([80,42],[80,104],w,false) + line([45,84],[45,22],w,false);
      const arc = '<path d="M33 40 A 15 15 0 0 1 57 40" fill="none" stroke="#e11d48" stroke-width="2" stroke-linecap="round"/>';
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' + left + right + arc + '</svg>';
    },

    /** 线面角：一个平面（斜投影平行四边形）+ 一条斜线交于平面，弧标线面角 */
    linePlane: function(fill, stroke, sw, dash) {
      const c = stroke || fill, w = Math.max(sw || 2, 1);
      const plane = '<polygon points="10,70 55,58 90,70 45,82" fill="'+fill+'" fill-opacity="0.14" stroke="'+c+'" stroke-width="'+w+'" stroke-linejoin="round"/>';
      const lfoot=[45,71], ltop=[30,22];
      const sl = '<line x1="'+lfoot[0]+'" y1="'+lfoot[1]+'" x2="'+ltop[0]+'" y2="'+ltop[1]+'" stroke="'+c+'" stroke-width="'+w+'" stroke-linecap="round"/>';
      const norm = '<line x1="'+lfoot[0]+'" y1="'+lfoot[1]+'" x2="'+(lfoot[0]+2)+'" y2="'+(lfoot[1]-18)+'" stroke="'+c+'" stroke-width="1.2" stroke-dasharray="3 2"/>';
      const arc = '<path d="M38 66 A 10 10 0 0 1 43 58" fill="none" stroke="#e11d48" stroke-width="2" stroke-linecap="round"/>';
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' + plane + norm + sl + arc + '</svg>';
    },

    /** 异面直线夹角：两条错开的直线（一实一虚错位），夹角弧标出 */
    skewAngle: function(fill, stroke, sw, dash) {
      const c = stroke || fill, w = Math.max(sw || 2, 1);
      const l1 = '<line x1="12" y1="80" x2="70" y2="28" stroke="'+c+'" stroke-width="'+w+'" stroke-linecap="round"/>';
      const l2 = '<line x1="30" y1="88" x2="88" y2="40" stroke="'+c+'" stroke-width="'+w+'" stroke-dasharray="5 3" stroke-linecap="round"/>';
      const arc = '<path d="M30 66 A 12 12 0 0 1 44 60" fill="none" stroke="#e11d48" stroke-width="2" stroke-linecap="round"/>';
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' + l1 + l2 + arc + '</svg>';
    },
  };

  /* ===== Segment shapes (line / arrow / curve) driven by two endpoints =====
     Endpoints are stored in element-LOCAL px coords (data-x1/y1/x2/y2).
     The element box is the bounding box (with padding), so dragging one
     endpoint recomputes the box while the other endpoint stays fixed. */
  function buildSegmentSVG(type, x1, y1, x2, y2, w, h, stroke, sw, dash, arrow, arrowSize) {
    const c = stroke || '#000000';
    const lw = Math.max(sw || 3, 2);
    const d = shapeDash(dash, true);
    const da = d ? ' stroke-dasharray="' + d + '"' : '';
    // arrow style: none / end / start / both / dot / diamond
    const style = arrow || (type === 'arrow' ? 'end' : 'none');
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const sizeFactor = (parseFloat(arrowSize) || 100) / 100;
    const ah = Math.max(lw * 4.2, 18) * sizeFactor; // arrow-head length (scaled independently of stroke width)
    const aw = ah * 0.45;
    const headEnd = style === 'end' || style === 'both' || style === 'dot' || style === 'diamond';
    const headStart = style === 'start' || style === 'both';

    // shorten the shaft at ends that carry a head so the head connects cleanly
    const endShort = style === 'dot' ? aw * 0.9 : (style === 'diamond' ? ah * 0.55 : ah);
    let sx1 = x1, sy1 = y1, sx2 = x2, sy2 = y2;
    if (headStart) { sx1 = x1 + ah * Math.cos(ang); sy1 = y1 + ah * Math.sin(ang); }
    if (headEnd) { sx2 = x2 - endShort * Math.cos(ang); sy2 = y2 - endShort * Math.sin(ang); }

    let body = '';
    if (type === 'curve') {
      // smooth quadratic between endpoints, bowed perpendicular to the chord
      const mx = (sx1 + sx2) / 2, my = (sy1 + sy2) / 2;
      const dx = sx2 - sx1, dy = sy2 - sy1;
      const len = Math.hypot(dx, dy) || 1;
      const bow = Math.min(len * 0.3, 70);
      const cx = mx - (dy / len) * bow;
      const cy = my + (dx / len) * bow;
      body = '<path d="M' + sx1 + ' ' + sy1 + ' Q ' + cx + ' ' + cy + ' ' + sx2 + ' ' + sy2 + '" stroke="' + c + '" stroke-width="' + lw + '" fill="none" stroke-linecap="round" vector-effect="non-scaling-stroke"' + da + '/>';
    } else {
      body = '<line x1="' + sx1 + '" y1="' + sy1 + '" x2="' + sx2 + '" y2="' + sy2 + '" stroke="' + c + '" stroke-width="' + lw + '" stroke-linecap="round" vector-effect="non-scaling-stroke"' + da + '/>';
    }

    let heads = '';
    if (headEnd) {
      const kind = style === 'dot' ? 'dot' : (style === 'diamond' ? 'diamond' : 'triangle');
      heads += arrowHeadMarkup(kind, x2, y2, ang, ah, c);
    }
    if (headStart) heads += arrowHeadMarkup('triangle', x1, y1, ang + Math.PI, ah, c);

    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="100%" preserveAspectRatio="none">' + body + heads + '</svg>';
  }

  /** Generate a single arrow-head at (x,y), pointing along `ang` (tail→tip). */
  function arrowHeadMarkup(kind, x, y, ang, ah, c) {
    const aw = ah * 0.45;
    const bx = x - ah * Math.cos(ang);
    const by = y - ah * Math.sin(ang);
    const lx = bx + aw * Math.cos(ang + Math.PI / 2);
    const ly = by + aw * Math.sin(ang + Math.PI / 2);
    const rx = bx - aw * Math.cos(ang + Math.PI / 2);
    const ry = by - aw * Math.sin(ang + Math.PI / 2);
    const n = (v) => v.toFixed(2);
    if (kind === 'dot') {
      return '<circle cx="' + n(x) + '" cy="' + n(y) + '" r="' + n(aw * 0.95) + '" fill="' + c + '"/>';
    }
    if (kind === 'diamond') {
      const tailX = x - ah * 1.15 * Math.cos(ang), tailY = y - ah * 1.15 * Math.sin(ang);
      const sideX = x - ah * 0.5 * Math.cos(ang), sideY = y - ah * 0.5 * Math.sin(ang);
      const wx = aw * 1.0, wy = ah * 0.5;
      const px = sideX + wx * Math.cos(ang + Math.PI / 2), py = sideY + wx * Math.sin(ang + Math.PI / 2);
      const qx = sideX - wx * Math.cos(ang + Math.PI / 2), qy = sideY - wx * Math.sin(ang + Math.PI / 2);
      return '<polygon points="' + n(x) + ',' + n(y) + ' ' + n(px) + ',' + n(py) + ' ' + n(tailX) + ',' + n(tailY) + ' ' + n(qx) + ',' + n(qy) + '" fill="' + c + '" stroke="' + c + '" stroke-width="1.2" stroke-linejoin="round"/>';
    }
    // default: filled triangle (solid, rounded joins) — the "beautified" arrow head
    return '<polygon points="' + n(x) + ',' + n(y) + ' ' + n(lx) + ',' + n(ly) + ' ' + n(rx) + ',' + n(ry) + '" fill="' + c + '" stroke="' + c + '" stroke-width="1.2" stroke-linejoin="round"/>';
  }

  /** Read segment endpoints + box from an element and regenerate its SVG. */
  function renderSegment(el) {
    const type = el.dataset.shape;
    const w = parseFloat(el.style.width) || 100;
    const h = parseFloat(el.style.height) || 100;
    const x1 = parseFloat(el.dataset.x1) || 0, y1 = parseFloat(el.dataset.y1) || 0;
    const x2 = parseFloat(el.dataset.x2) || 0, y2 = parseFloat(el.dataset.y2) || 0;
    const c = el.dataset.stroke || '#000000';
    const sw = parseInt(el.dataset.strokeW || '0', 10);
    const dash = el.dataset.dash || 'solid';
    const arrow = el.dataset.arrow || '';
    const arrowSize = el.dataset.arrowSize || '100';
    const svg = buildSegmentSVG(type, x1, y1, x2, y2, w, h, c, sw, dash, arrow, arrowSize);
    if (!svg) return;
    const old = el.querySelector('svg');
    if (old) old.outerHTML = svg;
    else el.insertAdjacentHTML('afterbegin', svg);
  }

  /** Ensure a segment element has endpoint data (covers legacy saves). */
  function normalizeSegment(el) {
    if (el.dataset.x1 !== undefined) return;
    const w = parseFloat(el.style.width) || 100;
    const h = parseFloat(el.style.height) || 100;
    el.dataset.x1 = 0;
    el.dataset.y1 = h / 2;
    el.dataset.x2 = w;
    el.dataset.y2 = h / 2;
  }

  /* ===== Freeform polygon (任意多边形) driven by a normalized point list ===== */
  // Points are stored in data-points as "x,y" pairs, each normalized 0..1
  // relative to the element box — so resizing simply scales the polygon.
  function buildFreeformSVG(points, w, h, fill, stroke, sw, dash) {
    const d = shapeDash(dash, true);
    const pts = points.map(function (p) {
      return ((p[0] * w).toFixed(2)) + ',' + ((p[1] * h).toFixed(2));
    }).join(' ');
    const vw = Math.max(w, 1), vh = Math.max(h, 1);
    return '<svg viewBox="0 0 ' + vw + ' ' + vh + '" width="100%" height="100%" preserveAspectRatio="none">' +
      '<polygon points="' + pts + '" fill="' + fill + '"' +
      (sw > 0 ? ' stroke="' + stroke + '" stroke-width="' + sw + '" stroke-linejoin="round" vector-effect="non-scaling-stroke"' + (d ? ' stroke-dasharray="' + d + '" stroke-linecap="round"' : '') : '') +
      '/></svg>';
  }
  function parseFreeformPoints(el) {
    const raw = el.dataset.points || '';
    return raw.split(/\s+/).filter(Boolean).map(function (pair) {
      const xy = pair.split(',');
      return [parseFloat(xy[0]) || 0, parseFloat(xy[1]) || 0];
    });
  }
  function renderFreeform(el) {
    const pts = parseFreeformPoints(el);
    if (pts.length < 3) return;
    const w = parseFloat(el.style.width) || 100;
    const h = parseFloat(el.style.height) || 100;
    const spec = fillSpec(el);
    const stroke = el.dataset.stroke || '#000000';
    const sw = el.dataset.strokeOff ? 0 : parseInt(el.dataset.strokeW || '0', 10);
    const dash = el.dataset.dash || 'solid';
    const svg = injectDefs(buildFreeformSVG(pts, w, h, spec.ref, stroke, sw, dash), spec.defs);
    const old = el.querySelector('svg');
    if (old) old.outerHTML = svg;
    else el.insertAdjacentHTML('afterbegin', svg);
    applyShapeShadow(el);
  }

  /* ===== Shape shadow presets ===== */
  function shapeShadowFilter(shadow) {
    switch (shadow) {
      case 'soft': return 'drop-shadow(0 2px 6px rgba(0,0,0,0.18))';
      case 'medium': return 'drop-shadow(0 6px 16px rgba(0,0,0,0.25))';
      case 'strong': return 'drop-shadow(0 12px 28px rgba(0,0,0,0.35))';
      default: return '';
    }
  }

  /** 按角度/层次/颜色生成多层阴影（层次越高层数越多、偏移与模糊越大） */
  function buildShadowLayers(angle, depth, color) {
    const a = (angle === undefined || angle === null || angle === '') ? 45 : parseFloat(angle);
    const rad = a * Math.PI / 180;
    const d = Math.max(1, parseInt(depth, 10) || 2);
    const dist = 2 + d * 2.5;
    const layers = [];
    for (let i = d; i >= 1; i--) {
      const len = Math.round((dist * i / d) * 10) / 10;
      const ox = Math.round(Math.cos(rad) * len * 10) / 10;
      const oy = Math.round(Math.sin(rad) * len * 10) / 10;
      const blur = Math.round(2 + i * 3.5);
      layers.push({ ox: ox, oy: oy, blur: blur, color: color || '#000000' });
    }
    return layers;
  }

  function applyShapeShadow(el) {
    if (!el) return;
    const svg = el.querySelector('svg');
    if (!svg) return;
    const s = el.dataset.shadow || '';
    if (!s || s === 'none') { svg.style.filter = ''; return; }
    // 自定义阴影：颜色 + 层次 + 角度（多层 drop-shadow 叠加出层次感）
    if (el.dataset.shadowColor || el.dataset.shadowDepth || el.dataset.shadowAngle) {
      const layers = buildShadowLayers(el.dataset.shadowAngle, el.dataset.shadowDepth, el.dataset.shadowColor);
      svg.style.filter = layers.map(l => 'drop-shadow(' + l.ox + 'px ' + l.oy + 'px ' + l.blur + 'px ' + l.color + ')').join(' ');
    } else {
      // 预设（向后兼容）
      svg.style.filter = shapeShadowFilter(s);
    }
  }

  /* ===== Shape fill types (纯色 / 渐变 / 斜线 / 网格 / 图像) ===== */
  // Returns { defs, ref } where `ref` is the value for the SVG fill attribute
  // and `defs` (if any) holds the <defs> block that must be injected into the SVG.
  function fillSpec(el) {
    // 无填充（仅描边）：直接用 'none' 作为 SVG fill 引用
    if (el.dataset.fillNone === '1') return { defs: '', ref: 'none' };
    const type = el.dataset.fillType || 'solid';
    const c1 = el.dataset.fill || '#534AB7';
    const c2 = el.dataset.fill2 || '#0EA5E9';
    const img = el.dataset.fillImg || '';
    const id = el.dataset.eid || ('f' + uid());
    const angle = (parseFloat(el.dataset.fillAngle) || (type === 'grid' ? 0 : 45));
    const spacing = Math.max(3, Math.min(200, parseFloat(el.dataset.fillSpacing) || (type === 'hatch' ? 10 : 14)));
    if (type === 'gradient') {
      const gid = 'g' + id;
      const rad = angle * Math.PI / 180;
      const dx = Math.cos(rad) * 50, dy = Math.sin(rad) * 50;
      const x1 = (50 - dx).toFixed(2), y1 = (50 - dy).toFixed(2);
      const x2 = (50 + dx).toFixed(2), y2 = (50 + dy).toFixed(2);
      const defs = '<defs><linearGradient id="' + gid + '" x1="' + x1 + '%" y1="' + y1 + '%" x2="' + x2 + '%" y2="' + y2 + '%">' +
        '<stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/></linearGradient></defs>';
      return { defs: defs, ref: 'url(#' + gid + ')' };
    }
    if (type === 'hatch') {
      const pid = 'p' + id;
      const sw = Math.max(1, Math.round(spacing * 0.3));
      const defs = '<defs><pattern id="' + pid + '" width="' + spacing + '" height="' + spacing + '" patternUnits="userSpaceOnUse" patternTransform="rotate(' + angle + ')">' +
        '<rect width="' + spacing + '" height="' + spacing + '" fill="' + c1 + '"/>' +
        '<line x1="0" y1="0" x2="0" y2="' + spacing + '" stroke="' + c2 + '" stroke-width="' + sw + '"/></pattern></defs>';
      return { defs: defs, ref: 'url(#' + pid + ')' };
    }
    if (type === 'grid') {
      const pid = 'p' + id;
      const sw = Math.max(1, Math.round(spacing * 0.125));
      const defs = '<defs><pattern id="' + pid + '" width="' + spacing + '" height="' + spacing + '" patternUnits="userSpaceOnUse" patternTransform="rotate(' + angle + ')">' +
        '<rect width="' + spacing + '" height="' + spacing + '" fill="' + c1 + '"/>' +
        '<path d="M' + spacing + ' 0 H0 V' + spacing + '" fill="none" stroke="' + c2 + '" stroke-width="' + sw + '"/></pattern></defs>';
      return { defs: defs, ref: 'url(#' + pid + ')' };
    }
    if (type === 'image' && img) {
      const pid = 'p' + id;
      const defs = '<defs><pattern id="' + pid + '" width="100%" height="100%" patternUnits="objectBoundingBox" patternContentUnits="objectBoundingBox">' +
        '<image href="' + escAttr(img) + '" x="0" y="0" width="1" height="1" preserveAspectRatio="xMidYMid slice"/></pattern></defs>';
      return { defs: defs, ref: 'url(#' + pid + ')' };
    }
    // solid (default) — no defs, use the color directly
    return { defs: '', ref: c1 };
  }
  function injectDefs(svg, defs) {
    if (!defs) return svg;
    return svg.replace(/(<svg[^>]*>)/, '$1' + defs);
  }

  /* ===== Charts — static SVG chart generator (no runtime dependency) ===== */
  const Charts = {
    PALETTES: {
      default: ['#534AB7', '#E8590C', '#0CA678', '#1971C2', '#D6336C', '#F08C00', '#7048E8', '#2F9E44'],
      warm:    ['#E8590C', '#F08C00', '#D6336C', '#F03E3E', '#E67700', '#C2255C'],
      cool:    ['#1971C2', '#0CA678', '#15AABF', '#4263EB', '#1098AD', '#2F9E44'],
      mono:    ['#403A8F', '#534AB7', '#6B5FC7', '#857AD8', '#A296E3', '#BDB3EE'],
    },

    /** Parse comma/Chinese-comma separated user input */
    parseInput(labelsStr, valuesStr) {
      const labels = String(labelsStr || '').split(/[,，、;；]/).map(s => s.trim()).filter(Boolean);
      const values = String(valuesStr || '').split(/[,，、;；\s]+/).map(s => parseFloat(s)).filter(v => !isNaN(v));
      return { labels: labels, values: values };
    },

    fmt(v) {
      if (!isFinite(v)) return '0';
      if (Math.abs(v) >= 1000) return String(Math.round(v));
      return String(Math.round(v * 10) / 10);
    },

    niceMax(v) {
      if (!isFinite(v) || v <= 0) return 1;
      const p = Math.pow(10, Math.floor(Math.log10(v)));
      const d = v / p;
      const m = d <= 1 ? 1 : d <= 2 ? 2 : d <= 2.5 ? 2.5 : d <= 5 ? 5 : 10;
      return m * p;
    },

    colors(cfg) {
      return this.PALETTES[cfg.palette] || this.PALETTES.default;
    },

    buildSVG(cfg) {
      const type = cfg.type || 'bar';
      if (type === 'pie' || type === 'doughnut') return this.pie(cfg, type === 'doughnut');
      return this.cartesian(cfg, type === 'line');
    },

    /** Bar / line charts */
    cartesian(cfg, isLine) {
      const W = 400, H = 300;
      const values = (cfg.values || []).slice();
      const labels = (cfg.labels || []).slice();
      const n = Math.max(values.length, 1);
      const data = values.slice(0, n);
      while (data.length < n) data.push(0);
      const labs = labels.slice(0, n);
      while (labs.length < n) labs.push(String(labs.length + 1));
      const colors = this.colors(cfg);
      const title = (cfg.title || '').trim();
      const nice = this.niceMax(Math.max.apply(null, data.concat([0])));

      const ml = 38, mr = 12, mt = title ? 34 : 14, mb = 26;
      const pw = W - ml - mr, ph = H - mt - mb;
      let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">';

      if (title) {
        s += '<text x="4" y="19" font-size="14" font-weight="700" fill="currentColor">' + escHTML(title) + '</text>';
      }

      // gridlines + y labels
      for (let i = 0; i <= 4; i++) {
        const y = mt + ph - (ph * i / 4);
        const v = nice * i / 4;
        s += '<line x1="' + ml + '" y1="' + y + '" x2="' + (W - mr) + '" y2="' + y +
          '" stroke="currentColor" stroke-opacity="' + (i === 0 ? 0.45 : 0.12) + '" stroke-width="1"/>';
        s += '<text x="' + (ml - 6) + '" y="' + (y + 3.5) + '" text-anchor="end" font-size="10" fill="currentColor" fill-opacity="0.55">' +
          this.fmt(v) + '</text>';
      }

      const step = pw / n;
      if (isLine) {
        const pts = data.map((v, i) => [ml + step * i + step / 2, mt + ph - (v / nice) * ph]);
        // area fill
        if (n > 1) {
          s += '<polygon points="' + ml + ',' + (mt + ph) + ' ' +
            pts.map(p => p[0] + ',' + p[1]).join(' ') + ' ' + (ml + pw) + ',' + (mt + ph) +
            '" fill="' + colors[0] + '" fill-opacity="0.10"/>';
          s += '<polyline points="' + pts.map(p => p[0] + ',' + p[1]).join(' ') +
            '" fill="none" stroke="' + colors[0] + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
        }
        pts.forEach((p, i) => {
          s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3.5" fill="' + colors[0] + '"/>';
          s += '<text x="' + p[0] + '" y="' + (p[1] - 8) + '" text-anchor="middle" font-size="10" font-weight="600" fill="currentColor">' +
            this.fmt(data[i]) + '</text>';
        });
      } else {
        const bw = Math.min(step * 0.62, 64);
        data.forEach((v, i) => {
          const h = Math.max(0, (v / nice) * ph);
          const x = ml + step * i + (step - bw) / 2;
          const y = mt + ph - h;
          s += '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + h + '" rx="3" fill="' + colors[i % colors.length] + '"/>';
          s += '<text x="' + (x + bw / 2) + '" y="' + (y - 5) + '" text-anchor="middle" font-size="10.5" font-weight="600" fill="currentColor">' +
            this.fmt(v) + '</text>';
        });
      }

      // x labels
      labs.forEach((lab, i) => {
        const x = ml + step * i + step / 2;
        s += '<text x="' + x + '" y="' + (mt + ph + 16) + '" text-anchor="middle" font-size="10" fill="currentColor" fill-opacity="0.6">' +
          escHTML(String(lab)) + '</text>';
      });

      s += '</svg>';
      return s;
    },

    /** Pie / doughnut charts */
    pie(cfg, doughnut) {
      const W = 400, H = 300;
      const values = (cfg.values || []).map(v => Math.max(0, v));
      const labels = (cfg.labels || []).slice();
      const colors = this.colors(cfg);
      const title = (cfg.title || '').trim();
      const total = values.reduce((a, b) => a + b, 0);
      let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">';
      if (title) {
        s += '<text x="4" y="19" font-size="14" font-weight="700" fill="currentColor">' + escHTML(title) + '</text>';
      }
      if (!values.length || total <= 0) {
        s += '<circle cx="120" cy="160" r="80" fill="none" stroke="currentColor" stroke-opacity="0.2" stroke-width="2" stroke-dasharray="6 6"/>' +
          '<text x="120" y="164" text-anchor="middle" font-size="12" fill="currentColor" fill-opacity="0.5">无数据</text></svg>';
        return s;
      }

      const cx = 118, cy = title ? 168 : 158, r = 92;
      const inner = doughnut ? 52 : 0;
      let a0 = -Math.PI / 2;
      values.forEach((v, i) => {
        const frac = v / total;
        const a1 = a0 + frac * Math.PI * 2;
        const large = (a1 - a0) > Math.PI ? 1 : 0;
        const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
        const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
        let d;
        if (frac >= 0.99999) {
          // full circle — draw as two arcs
          if (inner > 0) {
            d = 'M ' + (cx + r) + ' ' + cy + ' A ' + r + ' ' + r + ' 0 1 1 ' + (cx - r) + ' ' + cy +
                ' A ' + r + ' ' + r + ' 0 1 1 ' + (cx + r) + ' ' + cy +
                ' M ' + (cx + inner) + ' ' + cy + ' A ' + inner + ' ' + inner + ' 0 1 0 ' + (cx - inner) + ' ' + cy +
                ' A ' + inner + ' ' + inner + ' 0 1 0 ' + (cx + inner) + ' ' + cy + ' Z';
            s += '<path d="' + d + '" fill="' + colors[i % colors.length] + '" fill-rule="evenodd"/>';
          } else {
            s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + colors[i % colors.length] + '"/>';
          }
        } else if (inner > 0) {
          const ix1 = cx + inner * Math.cos(a1), iy1 = cy + inner * Math.sin(a1);
          const ix0 = cx + inner * Math.cos(a0), iy0 = cy + inner * Math.sin(a0);
          d = 'M ' + x0 + ' ' + y0 + ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x1 + ' ' + y1 +
              ' L ' + ix1 + ' ' + iy1 + ' A ' + inner + ' ' + inner + ' 0 ' + large + ' 0 ' + ix0 + ' ' + iy0 + ' Z';
          s += '<path d="' + d + '" fill="' + colors[i % colors.length] + '"/>';
        } else {
          d = 'M ' + cx + ' ' + cy + ' L ' + x0 + ' ' + y0 + ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x1 + ' ' + y1 + ' Z';
          s += '<path d="' + d + '" fill="' + colors[i % colors.length] + '"/>';
        }
        // percentage label
        if (frac > 0.06) {
          const mid = (a0 + a1) / 2;
          const lr = inner > 0 ? (r + inner) / 2 : r * 0.62;
          const lx = cx + lr * Math.cos(mid), ly = cy + lr * Math.sin(mid);
          s += '<text x="' + lx + '" y="' + (ly + 3.5) + '" text-anchor="middle" font-size="10.5" font-weight="600" fill="#ffffff">' +
            Math.round(frac * 100) + '%</text>';
        }
        a0 = a1;
      });

      // legend
      const lx = 245, ly0 = title ? 74 : 84;
      values.forEach((v, i) => {
        const y = ly0 + i * 24;
        if (y > H - 14) return;
        s += '<rect x="' + lx + '" y="' + (y - 9) + '" width="11" height="11" rx="2.5" fill="' + colors[i % colors.length] + '"/>';
        const lab = labels[i] != null ? String(labels[i]) : String(i + 1);
        s += '<text x="' + (lx + 17) + '" y="' + y + '" font-size="11" fill="currentColor">' + escHTML(lab) +
          ' <tspan fill-opacity="0.55">' + this.fmt(v) + '</tspan></text>';
      });

      s += '</svg>';
      return s;
    },

    /** Read chart config from an element's data attributes */
    readConfig(el) {
      let labels = [], values = [];
      try { labels = JSON.parse(el.dataset.chartLabels || '[]'); } catch (e) { /* ignore */ }
      try { values = JSON.parse(el.dataset.chartValues || '[]'); } catch (e) { /* ignore */ }
      return {
        type: el.dataset.chartType || 'bar',
        title: el.dataset.chartTitle || '',
        labels: labels,
        values: values,
        palette: el.dataset.chartPalette || 'default',
      };
    },

    /** Write config into the element and regenerate its SVG */
    apply(el, cfg) {
      el.dataset.chartType = cfg.type;
      el.dataset.chartTitle = cfg.title || '';
      el.dataset.chartLabels = JSON.stringify(cfg.labels || []);
      el.dataset.chartValues = JSON.stringify(cfg.values || []);
      el.dataset.chartPalette = cfg.palette || 'default';
      const box = el.querySelector('.el-chart');
      if (box) box.innerHTML = this.buildSVG(cfg);
    },
  };

  /* ===== Tables: multiple styles / configurable rows & cols ===== */
  const Table = {
    STYLES: {
      plain:   { thBg: '#f3f4f6', thFg: '#374151', border: '#d1d5db', zebra: null,   header: true },
      striped: { thBg: '#1f2a52', thFg: '#ffffff', border: '#e2e8f0', zebra: '#f1f5f9', header: true, accent: '#534AB7' },
      bordered:{ thBg: '#eef2ff', thFg: '#3730a3', border: '#c7d2fe', zebra: null,   header: true, accent: '#6366f1' },
      dark:    { thBg: '#1F2937', thFg: '#ffffff', border: '#374151', zebra: '#111827', header: true, accent: '#4B5563' },
      grid:    { thBg: '#0062A6', thFg: '#ffffff', border: '#0284C7', zebra: null,   header: true, accent: '#0284C7' },
      soft:    { thBg: '#FCE7F3', thFg: '#9D174D', border: '#FBCFE8', zebra: '#FDF2F8', header: true, accent: '#EC4899' },
      accent:  { thBg: '#534AB7', thFg: '#ffffff', border: '#C7BFFF', zebra: '#F4F1FF', header: true, accent: '#534AB7' },
    },

    /** Build the <table> markup for a config { cols, rows, style, header }. */
    build(cfg) {
      const s = this.STYLES[cfg.style] || this.STYLES.striped;
      const cols = Math.max(1, cfg.cols || 3);
      const rows = Math.max(1, cfg.rows || 3);
      const header = cfg.header !== false;
      const rowH = header ? (rows + 1) : rows;
      let html = '<table class="el-table" style="border-collapse:collapse;width:100%;font-size:14px;table-layout:fixed;">';
      // header row
      if (header) {
        html += '<tr>';
        for (let c = 0; c < cols; c++) {
          html += '<th style="border:2px solid ' + s.border + ';padding:7px;background:' + s.thBg + ';color:' + s.thFg +
            ';text-align:center;font-weight:600;">列 ' + String.fromCharCode(65 + c) + '</th>';
        }
        html += '</tr>';
      }
      // data rows
      let n = 1;
      for (let r = 0; r < rows; r++) {
        html += '<tr>';
        for (let c = 0; c < cols; c++) {
          const bg = (s.zebra && r % 2 === 1) ? 'background:' + s.zebra + ';' : '';
          html += '<td style="border:1px solid ' + s.border + ';padding:7px;text-align:center;' + bg + '">' + n++ + '</td>';
        }
        html += '</tr>';
      }
      html += '</table>';
      return html;
    },

    /** Read a table's config from its element DOM. */
    readConfig(el) {
      const table = el.querySelector('.el-table');
      const ths = table ? table.querySelectorAll('tr:first-child th') : [];
      const trs = table ? table.querySelectorAll('tr') : [];
      const header = trs[0] && trs[0].querySelectorAll('th').length ? true : false;
      const cols = header ? ths.length : (trs[0] ? trs[0].querySelectorAll('td').length : 3);
      const rows = header ? (trs.length - 1) : trs.length;
      // detect style by header background
      let style = 'striped';
      const hb = header && trs[0] ? this.bgHex((trs[0].querySelector('th') || {}).style && trs[0].querySelector('th').style.background) : null;
      for (const key of Object.keys(this.STYLES)) {
        if (this.STYLES[key].thBg === hb) { style = key; break; }
      }
      return { cols: cols, rows: Math.max(1, rows), style: style, header: header };
    },

    bgHex(str) { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(String(str)); if (!m) return String(str || '').trim(); return '#' + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join(''); },

    /** Apply a config to an existing table element (preserve existing cell text). */
    apply(el, cfg) {
      const old = this.readConfig(el);
      const oldCells = [];
      const table = el.querySelector('.el-table');
      if (table) {
        table.querySelectorAll('td,th').forEach(c => { const t = (c.textContent || '').trim(); oldCells.push(t); });
      }
      const wrap = el.querySelector('table.el-table') ? el.querySelector('table.el-table').parentNode : el;
      const fresh = document.createElement('div');
      fresh.innerHTML = this.build(cfg);
      const newTable = fresh.querySelector('table');
      // pour old cell text into the new table in order
      if (newTable && oldCells.length) {
        const cells = newTable.querySelectorAll('td,th');
        cells.forEach((c, i) => { if (oldCells[i] != null) c.textContent = oldCells[i]; });
      }
      if (el.querySelector('table.el-table')) {
        el.querySelector('table.el-table').replaceWith(newTable);
      } else {
        el.insertAdjacentHTML('beforeend', this.build(cfg));
      }
      // re-bind editability
      $$('td, th', el).forEach(cell => { cell.setAttribute('contenteditable', 'false'); });
    },
  };

  /* ===== Icon picker: a palette of built-in SVG icons ===== */
  const IconPicker = {
    ICONS: {
      check:   'M5 13l4 4L19 7', star: 'M12 2l3 6.6 7 .8-5.2 4.7 1.4 6.9-6.2-3.6-6.2 3.6 1.4-6.9L2 9.4l7-.8z',
      heart:   'M12 21S4 14 4 8.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8 2.5C20 14 12 21 12 21z',
      gear:    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.5-2-3.5-2.3 1a7.4 7.4 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.4 7.4 0 0 0-2 1.2l-2.3-1-2 3.5 2 1.5a7.4 7.4 0 0 0 0 2.4l-2 1.5 2 3.5 2.3-1a7.4 7.4 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.4 7.4 0 0 0 2-1.2l2.3 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2z',
      warn:    'M12 3L2 20h20L12 3zm1 12h-2v2h2v-2zm0-6h-2v5h2V9z',
      arrow:   'M5 12h14M13 6l6 6-6 6',
      mail:    'M4 5h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm0 3v11h16V8l-8 5-8-5zm0 0l8 5 8-5',
      phone:   'M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6.4 6.4l1.2-1.2a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z',
      pin:     'M12 2a8 8 0 0 0-8 8c0 5.4 7 11.5 7.3 11.8a1 1 0 0 0 1.4 0C13 21.5 20 15.4 20 10a8 8 0 0 0-8-8zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6z',
      clock:   'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5h-2v6l5 3 1-1.7-4-2.3V7z',
      search:  'M21 21l-5-5M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z',
      chart:   'M18 20V10M12 20V4M6 20v-6',
      book:    'M4 4a2 2 0 0 1 2-2h14v18H6a2 2 0 0 0-2 2V4zm2 16h14v-2H6a2 2 0 0 0-2 2 2 2 0 0 0 2 0zM20 4v12H6.4A3.4 3.4 0 0 0 4 17.6V4z',
      bulb:    'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5V15h8v-1.5A6 6 0 0 0 12 3z',
      flag:    'M4 21V4a1 1 0 0 1 1-.7C6 3.5 7 3 9 3c2.5 0 3.5 1 6 1 1.6 0 2.6-.3 3-.5a1 1 0 0 1 1 1v9l-1 .7c-.7.3-1.8.8-3 .8-2.5 0-3.5-1-6-1-2 0-3 .5-4 1a1 1 0 0 1-1-.5z',
      rocket:  'M4 20c0-6 2-12 8-16 6 4 8 10 8 16H4zm5-4a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
      target:  'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm0 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
      users:   'M16 12a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM3 20a7 7 0 0 1 14 0M21 20a5 5 0 0 0-3.5-4.7',
      lock:    'M6 10V7a6 6 0 0 1 12 0v3m-12 0h12a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm6 5v2',
      lightbulb:'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5V15h8v-1.5A6 6 0 0 0 12 3z',
      doc:     'M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm9 0v5h5M9 13h6M9 17h6',
      calendar:'M5 6h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm-1 4h16M8 3v4M16 3v4',
      plus:    'M12 5v14M5 12h14',
      minus:   'M5 12h14',
      checkbox:'M4 4h16v16H4zM8 12.5l3 3 5-6',
      star2:   'M12 2l3 6.6 7 .8-5.2 4.7 1.4 6.9-6.2-3.6-6.2 3.6 1.4-6.9L2 9.4l7-.8z',
      circle:  'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z',
      square:  'M4 4h16v16H4z',
      triangle:'M12 3l9 18H3z',
      cross:   'M6 6l12 12M18 6L6 18',
    },

    /* ---- 彩色图标：每项 = { d: 路径, fill: 颜色, stroke?: 描边色, sw?: 描边宽 } ---- */
    COLORICONS: {
      redHeart:   { parts: [ { d: 'M12 21S4 14 4 8.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8 2.5C20 14 12 21 12 21z', fill: '#EF4444' } ] },
      goldStar:   { parts: [ { d: 'M12 2l3 6.6 7 .8-5.2 4.7 1.4 6.9-6.2-3.6-6.2 3.6 1.4-6.9L2 9.4l7-.8z', fill: '#F59E0B' } ] },
      blueDrop:   { parts: [ { d: 'M12 2s6 7.2 6 12a6 6 0 0 1-12 0c0-4.8 6-12 6-12z', fill: '#0EA5E9' } ] },
      greenCheck: { parts: [ { d: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', fill: '#10B981' }, { d: 'M7 12.5l3 3 6-6', fill: 'none', stroke: '#FFFFFF', sw: 2.4 }, ] },
      redCross:   { parts: [ { d: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', fill: '#EF4444' }, { d: 'M8.5 8.5l7 7M15.5 8.5l-7 7', stroke: '#FFFFFF', fill: 'none', sw: 2.4 }, ] },
      orangeWarn: { parts: [ { d: 'M12 3L2 20h20L12 3zm1 12h-2v2h2v-2zm0-6h-2v5h2V9z', fill: '#F59E0B' } ] },
      blueInfo:   { parts: [ { d: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', fill: '#2563EB' }, { d: 'M12 10v6M12 7.5v.5', stroke: '#FFFFFF', fill: 'none', sw: 2.4 }, ] },
      purpleLight:{ parts: [ { d: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5V15h8v-1.5A6 6 0 0 0 12 3z', fill: '#8B5CF6' } ] },
      tealLock:   { parts: [ { d: 'M6 10V7a6 6 0 0 1 12 0v3h-1M6 10h12a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm6 5v2', fill: '#14B8A6' } ] },
      pinkTarget: { parts: [ { d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', fill: '#EC4899' }, { d: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z', fill: '#FFFFFF' }, { d: 'M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z', fill: '#EC4899' }, ] },
      cyanSend:   { parts: [ { d: 'M3 11l18-7-7 18-2.5-7.5L3 11z', fill: '#06B6D4' } ] },
      greenJar:   { parts: [ { d: 'M10 3h4M11 3v2h2V3M8 6h8l1 6v7a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-7l1-6z', fill: '#22C55E' }, { d: 'M12 10v6M9 13h6', stroke: '#FFFFFF', fill: 'none', sw: 2.2 }, ] },
      orangeBell: { parts: [ { d: 'M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6zM10 19a2 2 0 0 0 4 0', fill: '#F97316' } ] },
      roseFlag:   { parts: [ { d: 'M5 21V4a1 1 0 0 1 1-.7C7 3.4 8 3 10 3c2 0 3 1 5 1 1.6 0 2.6-.3 3-.5a1 1 0 0 1 1 1v8l-1 .7c-.6.3-1.5.4-3 .4-2 0-3-1-5-1-1.5 0-3 .4-4 1a1 1 0 0 1-1-.7z', fill: '#F43F5E' } ] },
      blueStar:   { parts: [ { d: 'M12 2l3 6.6 7 .8-5.2 4.7 1.4 6.9-6.2-3.6-6.2 3.6 1.4-6.9L2 9.4l7-.8z', fill: '#3B82F6' } ] },
      violetDoc:  { parts: [ { d: 'M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm9 0v5h5M9 13h6M9 17h4', fill: '#7C3AED' } ] },
    },

    /* ---- 教学/数学符号（文本符号，用 SVG <text> 渲染，可插入为独立元素）---- */
    TEXTICONS: {
      'in':      '∈', 'notin':   '∉', 'subset':  '⊂', 'subseteq': '⊆',
      'union':   '∪', 'intersect':'∩', 'empty':   '∅', 'supset':   '⊃',
      'ne':      '≠', 'le':      '≤', 'ge':      '≥', 'pm':      '±',
      'times':   '×', 'divide':  '÷', 'sqrt':    '√', 'infty':   '∞',
      'sum':     '∑', 'prod':    '∏', 'integral':'∫', 'pi':      'π',
      'alpha':   'α', 'beta':    'β', 'gamma':   'γ', 'theta':   'θ',
      'lambda':  'λ', 'delta':   'Δ', 'degree':  '°', 'plusminus':'±',
      'perp':    '⊥', 'parallel':'∥', 'angle':  '∠', 'triangle':'△',
      'arrowrl': '→', 'arrowlr': '↔', 'arrowur':'↗', 'impl':'⇒',
      'forall':  '∀', 'exists':  '∃', 'cong':    '≅', 'similar': '∼',
      'because': '∵', 'therefore':'∴', 'ldots':'…', 'mspace':' ',
      'circ1':   '①', 'circ2':   '②', 'circ3':   '③', 'circ4':   '④',
      'circ5':   '⑤', 'circ6':   '⑥', 'circ7':   '⑦', 'circ8':   '⑧',
      'circ9':   '⑨', 'fra1':    '½', 'fra2':    '⅓', 'fra3':    '¼',
      'square':  '□', 'blacksquare':'■', 'cdot':  '·', 'brace':  '{}',
    },

    open() {
      const grid = $('#icon-grid');
      if (grid && !grid._built) {
        let html = '';
        // 彩色图标区
        html += '<div class="icon-cat">彩色</div>';
        for (const key of Object.keys(this.COLORICONS)) {
          html += '<button class="icon-item" data-icon="' + key + '" title="' + this.label(key) + '">' +
            '<span class="icon-svg">' + this.svgFor(key) + '</span>' +
            '<span>' + this.label(key) + '</span></button>';
        }
        // 单色图标区
        html += '<div class="icon-cat">单色</div>';
        for (const key of Object.keys(this.ICONS)) {
          html += '<button class="icon-item" data-icon="' + key + '" title="' + this.label(key) + '">' +
            '<span class="icon-svg">' + this.svgFor(key) + '</span>' +
            '<span>' + this.label(key) + '</span></button>';
        }
        // 数学/教学符号区
        html += '<div class="icon-cat">数学符号</div>';
        for (const key of Object.keys(this.TEXTICONS)) {
          html += '<button class="icon-item" data-icon="' + key + '" title="' + this.label(key) + '">' +
            '<span class="icon-svg">' + this.svgFor(key) + '</span>' +
            '<span>' + this.label(key) + '</span></button>';
        }
        grid.innerHTML = html;
        grid._built = true;
      }
      $('#icon-modal').classList.remove('hidden');
    },

    /** Is this key a multi-color icon? */
    isColored(key) { return !!this.COLORICONS[key]; },

    label(key) {
      const L = { check: '对勾', star: '星', heart: '心', gear: '齿轮', warn: '警告', arrow: '箭头', mail: '邮件', phone: '电话', pin: '位置', clock: '时钟', search: '搜索', chart: '图表', book: '书', bulb: '灯泡', flag: '旗帜', rocket: '火箭', target: '靶心', users: '用户', lock: '锁', lightbulb: '灯泡', doc: '文档', calendar: '日历', plus: '加号', minus: '减号', checkbox: '复选框', star2: '星', circle: '圆', square: '方块', triangle: '三角', cross: '叉',
        redHeart: '红心', goldStar: '金星', blueDrop: '水滴', greenCheck: '绿勾', redCross: '红叉', orangeWarn: '橙警示', blueInfo: '蓝信息', purpleLight: '紫灯泡', tealLock: '青锁', pinkTarget: '粉靶心', cyanSend: '发送', greenJar: '药瓶', orangeBell: '橙铃', roseFlag: '红旗', blueStar: '蓝星', violetDoc: '紫文档',
        in: '属于', notin: '不属于', subset: '子集', subseteq: '包含', union: '并集', intersect: '交集', empty: '空集', supset: '真包含', ne: '不等', le: '≤', ge: '≥', pm: '±', times: '乘', divide: '除', sqrt: '根号', infty: '∞', sum: '求和', prod: '连乘', integral: '积分', pi: 'π', alpha: 'α', beta: 'β', gamma: 'γ', theta: 'θ', lambda: 'λ', delta: 'Δ', degree: '°', plusminus: '±', perp: '垂直', parallel: '平行', angle: '角', triangle: '三角', arrowrl: '→', arrowlr: '↔', arrowur: '↗', impl: '推出', forall: '任意', exists: '存在', cong: '全等', similar: '相似', because: '因为', therefore: '所以', ldots: '省略', mspace: '空格', circ1: '①', circ2: '②', circ3: '③', circ4: '④', circ5: '⑤', circ6: '⑥', circ7: '⑦', circ8: '⑧', circ9: '⑨', fra1: '½', fra2: '⅓', fra3: '¼', square: '方框', blacksquare: '黑方', cdot: '点', brace: '括号' };
      return L[key] || key;
    },

    svgFor(key, color) {
      const colored = this.COLORICONS[key];
      if (colored) {
        let inner = '';
        (colored.parts || []).forEach(function (p) {
          inner += '<path d="' + p.d + '" fill="' + (p.fill || 'none') + '"' +
            (p.stroke ? ' stroke="' + p.stroke + '"' : '') +
            (p.sw ? ' stroke-width="' + p.sw + '" stroke-linecap="round" stroke-linejoin="round"' : '') + '/>';
        });
        return '<svg viewBox="0 0 24 24" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' + inner + '</svg>';
      }
      // 数学文本符号：用 <text> 渲染（标记 data-textsym，插入时识别）
      const ts = this.TEXTICONS[key];
      if (ts !== undefined) {
        return '<svg viewBox="0 0 24 24" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><text x="12" y="18" font-size="22" text-anchor="middle" dominant-baseline="middle" font-family="serif" fill="' + (color || '#334155') + '">' + ts + '</text></svg>';
      }
      const d = this.ICONS[key] || this.ICONS.star;
      return '<svg viewBox="0 0 24 24" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" fill="none" stroke="' + (color || '#334155') + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="' + d + '"/></svg>';
    },
  };

  /* ===== Online image gallery (图片库/搜图) =====
     Uses free, no-key image sources. Categories give themed thumbnails;
     a keyword search builds a matching picsum seed so images relate to the term. */
  const Gallery = {
    // categories -> themed Unsplash-direct image URLs (verified reachable)
    CATS: {
      background: [
        'https://images.unsplash.com/photo-1557683316-973673baf926?w=800&q=80',
        'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=800&q=80',
        'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=800&q=80',
        'https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=800&q=80',
        'https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=800&q=80',
        'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=800&q=80',
        'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80',
        'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&q=80',
      ],
      geometry: [
        'https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=800&q=80',
        'https://images.unsplash.com/photo-1557682250-33bd709cbe85?w=800&q=80',
        'https://images.unsplash.com/photo-1557682224-5b8590cd9ec5?w=800&q=80',
        'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&q=80',
        'https://images.unsplash.com/photo-1567095761054-7a02e69e5c43?w=800&q=80',
        'https://images.unsplash.com/photo-1591741535014-cb7bd5d597d4?w=800&q=80',
        'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=800&q=80',
      ],
      math: [
        'https://images.unsplash.com/photo-1509228468518-180dd4864904?w=800&q=80',
        'https://images.unsplash.com/photo-1596495577886-d920f1fb7238?w=800&q=80',
        'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=800&q=80',
        'https://images.unsplash.com/photo-1596495578065-6e0763fa1178?w=800&q=80',
        'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=800&q=80',
        'https://images.unsplash.com/photo-1542626991-cbc4e32524cc?w=800&q=80',
      ],
      chart: [
        'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&q=80',
        'https://images.unsplash.com/photo-1543286386-713bdd548da4?w=800&q=80',
        'https://images.unsplash.com/photo-1504868584819-f8e8b4b6d7e3?w=800&q=80',
        'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&q=80',
        'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?w=800&q=80',
        'https://images.unsplash.com/photo-1504868584819-f8e8b4b6d7e3?w=800&q=80',
      ],
      nature: [
        'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800&q=80',
        'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=800&q=80',
        'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=800&q=80',
        'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=800&q=80',
        'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=800&q=80',
        'https://images.unsplash.com/photo-1426604966848-d7adac402bff?w=800&q=80',
        'https://images.unsplash.com/photo-1505142468610-359e7d316be0?w=800&q=80',
      ],
      tech: [
        'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&q=80',
        'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=800&q=80',
        'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=800&q=80',
        'https://images.unsplash.com/photo-1531297484001-80022131f5a1?w=800&q=80',
        'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800&q=80',
        'https://images.unsplash.com/photo-1517430816045-df4b7de11d1d?w=800&q=80',
      ],
      school: [
        'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=800&q=80',
        'https://images.unsplash.com/photo-1509062522246-3755977927d7?w=800&q=80',
        'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=800&q=80',
        'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&q=80',
        'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=800&q=80',
        'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=800&q=80',
      ],
      people: [
        'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?w=800&q=80',
        'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800&q=80',
        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&q=80',
        'https://images.unsplash.com/photo-1543269865-cbf427effbad?w=800&q=80',
        'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=800&q=80',
        'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=800&q=80',
      ],
      city: [
        'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=800&q=80',
        'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=800&q=80',
        'https://images.unsplash.com/photo-1444723121867-7a241cacace9?w=800&q=80',
        'https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=800&q=80',
        'https://images.unsplash.com/photo-1465447142348-e9952c393450?w=800&q=80',
        'https://images.unsplash.com/photo-1493246507139-91e8fad9978e?w=800&q=80',
      ],
      food: [
        'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&q=80',
        'https://images.unsplash.com/photo-1493770348161-369560ae357d?w=800&q=80',
        'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=800&q=80',
        'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=800&q=80',
        'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&q=80',
        'https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=800&q=80',
      ],
      sport: [
        'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=800&q=80',
        'https://images.unsplash.com/photo-1519861531473-9200262188bf?w=800&q=80',
        'https://images.unsplash.com/photo-1531415074968-036ba1b575da?w=800&q=80',
        'https://images.unsplash.com/photo-1546519638-68e109498ffc?w=800&q=80',
        'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=800&q=80',
        'https://images.unsplash.com/photo-1489944440615-453fc2b6a9a9?w=800&q=80',
      ],
      abstract: [
        'https://images.unsplash.com/photo-1541701494587-cb58502866ab?w=800&q=80',
        'https://images.unsplash.com/photo-1549490349-8643362247b5?w=800&q=80',
        'https://images.unsplash.com/photo-1550684376-efcbd6e3f031?w=800&q=80',
        'https://images.unsplash.com/photo-1558591710-4b4a1ae0f04d?w=800&q=80',
        'https://images.unsplash.com/photo-1554080353-a576cf803bda?w=800&q=80',
        'https://images.unsplash.com/photo-1550859492-d5da9d8e45f3?w=800&q=80',
      ],
      animal: [
        'https://images.unsplash.com/photo-1546182990-dffeafbe841d?w=800&q=80',
        'https://images.unsplash.com/photo-1552053831-71594a27632d?w=800&q=80',
        'https://images.unsplash.com/photo-1564349683136-77e08dba1ef7?w=800&q=80',
        'https://images.unsplash.com/photo-1561948955-570b270e7c36?w=800&q=80',
        'https://images.unsplash.com/photo-1543466835-00a7907e9de1?w=800&q=80',
        'https://images.unsplash.com/photo-1425082661705-1834bfd09dca?w=800&q=80',
      ],
      color: [
        'https://images.unsplash.com/photo-1557682250-33bd709cbe85?w=800&q=80',
        'https://images.unsplash.com/photo-1502691876148-a84978e59af8?w=800&q=80',
        'https://images.unsplash.com/photo-1553356084-58ef4a67b2a7?w=800&q=80',
        'https://images.unsplash.com/photo-1568602471122-7832951cc4c5?w=800&q=80',
        'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?w=800&q=80',
        'https://images.unsplash.com/photo-1513151233558-d860c5398176?w=800&q=80',
      ],
    },
    _curCat: 'background',
    _searchSeed: null,
    _built: false,

    open() {
      $('#gallery-modal').classList.remove('hidden');
      // always render fresh so category state is current on every open
      this.render(this._curCat);
      this._built = true;
    },
    close() { $('#gallery-modal').classList.add('hidden'); },

    /** Render the grid for a category (or search). If searchSeed given, use picsum seed */
    render(cat, seed) {
      this._curCat = cat;
      this._searchSeed = seed || null;
      $$('#gallery-cats .gallery-cat').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
      let urls;
      if (seed) {
        // keyword-based random images from picsum (seed = sanitized keyword)
        const s = String(seed).replace(/\s+/g, '-').slice(0, 40);
        urls = [0,1,2,3,4,5].map(i => 'https://picsum.photos/seed/' + s + '-' + i + '/800/600');
      } else {
        urls = (this.CATS[cat] || []).slice(0, 9);
      }
      const grid = $('#gallery-grid');
      if (!grid) return;
      grid.innerHTML = urls.map((u, idx) =>
        '<div class="gallery-item" data-src="' + u + '" title="点击插入">' +
          '<img src="' + u + '" alt="图片' + (idx+1) + '" loading="lazy">' +
        '</div>').join('');
    },

    /** Insert an image URL into the current slide */
    insert(src) {
      Elements.insertImageElement(src);
      this.close();
      toast('已插入图片（在线图源，联网时显示）', 'success');
    },
  };

  /* ===== 组合公式（文本框粘贴多段 LaTeX + 预览 + 颜色） =====
     外观与数学公式面板一致：支持复制粘贴，实时预览组合结果。
     插入逻辑后续接入（复用 data-type="math" 元素渲染）。 */
  const ComboMath = {
    _color: '#000000',
    _fontSize: 18,
    _bgColor: '',
    _fontFamily: '',

    /** 预设组合公式模板（点击填入输入框，可再编辑） */
    PRESETS: {
      eqsys: '$$ \\text{则}\\begin{cases} \\vec{n}\\cdot\\vec{CB}=0 \\\\ \\vec{n}\\cdot\\vec{CP}=0 \\end{cases}\\text{，解得 } x=\\frac{7}{5} $$',
      eqsys2: '$$ \\text{联立}\\begin{cases} y=kx+m \\\\ \\frac{x^2}{6}+\\frac{y^2}{3}=1 \\end{cases}\\text{，消去 } y \\text{ 得一元二次方程} $$',
      multiline: '第一行：$y=x^2$，顶点 $(0,0)$\\n第二行：对称轴 $x=0$\\n第三行：开口向上',
      fracchain: '$\\frac{a}{b}+\\frac{c}{d}=\\frac{ad+bc}{bd}$ 即分式通分规则',
      piecewise: 'f(x)=\\begin{cases} x^2, & x\\ge 0 \\\\ -x, & x<0 \\end{cases}',
      integral: '$\\int_a^b f(x)\\,dx=F(b)-F(a)$（牛顿-莱布尼茨公式）',
      quadratic: '$ax^2+bx+c=0$，判别式 $\\Delta=b^2-4ac$，求根公式 $x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}$',
      ineqchain: '$$H=\\frac{2}{\\frac{1}{a}+\\frac{1}{b}}\\le G=\\sqrt{ab}\\le A=\\frac{a+b}{2}\\le R=\\sqrt{\\frac{a^{2}+b^{2}}{2}}$$',
      ineqchain2: '调和平均 $H=\\frac{2}{\\frac{1}{a}+\\frac{1}{b}}$ ≤ 几何平均 $G=\\sqrt{ab}$ ≤ 算术平均 $A=\\frac{a+b}{2}$ ≤ 平方平均 $R=\\sqrt{\\frac{a^{2}+b^{2}}{2}}$',
      ineqlog: '$$H=\\frac{2}{\\frac{1}{a}+\\frac{1}{b}}\\le G=\\sqrt{ab}\\le L=\\frac{b-a}{\\ln b-\\ln a}\\le A=\\frac{a+b}{2}\\le R=\\sqrt{\\frac{a^{2}+b^{2}}{2}}$$',
      ineqlog2: '几何平均 $G=\\sqrt{ab}$ ≤ 对数平均 $L=\\frac{b-a}{\\ln b-\\ln a}$ ≤ 算术平均 $A=\\frac{a+b}{2}$',
      ineqexp: '$$G=\\sqrt{ab}\\le I=\\frac{e^{b}-e^{a}}{b-a}\\le A=\\frac{a+b}{2} \\quad (a\\ne b)$$',
      ineqexp2: '指数平均 $I=\\frac{e^{b}-e^{a}}{b-a}$，与几何平均、算术平均构成不等关系',
    },

    /** 填入预设组合到输入框并刷新预览 */
    applyPreset(key, autowrap) {
      const t = this.PRESETS[key];
      if (!t) return;
      const input = $('#combo-math-input');
      if (input) input.value = t;
      // 方程组/分段函数等多行预设默认开多行或自动换行
      if (autowrap != null) {
        const c = $('#combo-math-autowrap');
        if (c) c.checked = autowrap;
      }
      this.updatePreview();
    },

    /** 数学内容转义：把 < > 换成 MathJax 的关系符 \lt \gt，避免 innerHTML 把 < 当标签、
        也避免字面显示。注意：不转义 & —— & 在 cases/align 等对齐环境里是合法的列分隔符，
        转义成 \& 会破坏分段函数等预设的对齐。 */
    _escMath(s) {
      return String(s || '')
        .replace(/</g, '\\lt ')
        .replace(/>/g, '\\gt ');
    },

    /** 数学体包络：多行环境（\begin{cases}/aligned/matrix/... 或 \\ 换行）用块级 \[...\]
        显示方程，多行各自对齐、不挤压；单行用行内 \(...\) 与中文同行。 */
    _wrap(body) {
      const b = String(body || '');
      const isBlock = /\\begin\{(?:\w+)\}|\\\\/.test(b);
      return isBlock ? ('\\[' + b + '\\]') : ('\\(' + b + '\\)');
    },

    /** 读取选项：多行显示 / 自动换行 */
    _multiline() { const c = $('#combo-math-multiline'); return c ? c.checked : false; },
    _autowrap() { const c = $('#combo-math-autowrap'); return c ? c.checked : false; },

    /** 把粘贴内容转成「中文文本 + 行内公式」混排 HTML：
        - 识别含 LaTeX 命令（\、^、_、{}、等号+字母、根式/分式）的片段，包成 \(...\) 行内公式；
        - 中文及中文标点保留为普通文本。这样汉字+公式自然换行、字号与正文一致。
        已带定界符（\(\)/$$/$/\[\]）的片段原样保留交给 MathJax。 */
    _toMixedHtml(raw) {
      let s = String(raw || '');
      if (!s) return '';
      // 把字面 "\n"（反斜杠+n，预设里用来表示换行）转成真实换行，再按换行拆行。
      s = s.replace(/\\n/g, '\n');
      let out = '';
      // 先按换行拆分（多行模式时逐行作为段落），行内再做"中文 vs 公式"分词
      const lines = s.split(/\n+/).filter(l => l.trim());
      lines.forEach((line, li) => {
        if (li > 0) out += '<br>';
        out += this._lineToHtml(line);
      });
      return out;
    },

    _lineToHtml(line) {
      let s = String(line || '');
      let out = '';
      // 惰性扫描：遇到 LaTeX 命令起点（\ 或常见数学形态）则收集到公式，否则当文本。
      let i = 0;
      const n = s.length;
      const isMathStart = () => {
        // 有定界符或反斜杠命令 或 形如字母=表达式、字母^/_
        return /\\|(?:\^|_)|\*|/;
      };
      while (i < n) {
        const ch = s[i];
        // 已带定界符片段：直接透传到闭定界符
        if (s.startsWith('\\(', i)) {
          const c = s.indexOf('\\)', i + 2);
          const end = c === -1 ? n : c + 2;
          out += escHTML(s.substring(i, end)); i = end; continue;
        }
        if (s.startsWith('\\[', i)) {
          const c = s.indexOf('\\]', i + 2);
          const end = c === -1 ? n : c + 2;
          out += escHTML(s.substring(i, end)); i = end; continue;
        }
        if (s.startsWith('$$', i)) {
          const c = s.indexOf('$$', i + 2);
          const end = c === -1 ? n : c + 2;
          const body = this._escMath(s.substring(i + 2, c === -1 ? n : c));
          out += this._wrap(body); i = end; continue;
        }
        if (ch === '$') {
          // 单 $ 行内定界：转换为 \(...\)，避免 $. 在插入的 .el-text 里未渲染而残留
          const c = s.indexOf('$', i + 1);
          const end = c === -1 ? n : c + 1;
          const body = this._escMath(s.substring(i + 1, c === -1 ? n : c));
          out += this._wrap(body); i = end; continue;
        }
        // 裸 LaTeX：收集从当前位置开始，直到遇到中文/标点结尾的"数学形态"串
        const m = this._collectMath(s, i);
        if (m) { out += this._wrap(this._escMath(m.latex)); i = m.end; continue; }
        // 否则作为文本：收集直到下一个数学起点或定界符（$、\(、\[、$$）
        let j = i;
        while (j < n) {
          const cj = s[j];
          if (cj === '$' || s.startsWith('\\(', j) || s.startsWith('\\[', j) || s.startsWith('$$', j)) break;
          if (this._collectMath(s, j)) break;
          j++;
        }
        out += escHTML(s.substring(i, j)); i = j;
      }
      return out;
    },

    /** 从 pos 收集一个数学形态串（不含中文/行末/定界符）。返回 {latex,end} 或 null。 */
    _collectMath(s, pos) {
      if (pos >= s.length) return null;
      const ch = s[pos];
      if (/[\u4E00-\u9FFF，。；、：""''（）【】]/.test(ch)) return null; // 中文/中文标点起，不开数学
      // 定界符起（$、\(、\[）不归这里，交给专门分支
      if (ch === '$' || s.startsWith('\\(', pos) || s.startsWith('\\[', pos) || ch === ' ') return null;
      let end = pos, buf = '';
      while (end < s.length) {
        const c = s[end];
        if (/[\u4E00-\u9FFF，。；、：""''（）【】\n]/.test(c)) break;
        if (c === '$' || s.startsWith('\\(', end) || s.startsWith('\\[', end)) break;
        buf += c; end++;
      }
      if (!buf) return null;
      // 仅当串含「数学特征」（LaTeX 命令/典型运算符）才当作公式；纯文本（如 (1)、求、时）不算。
      const mathy = /\\|\^|_|\\frac|\\sqrt|\\sum|\\int|\\lim|\\sin|\\cos|\\tan|\\pi|\\ln|\\log|\\alpha|\\beta|\\gamma|\\theta|\\in|\\le|\\ge|\\neq|\\to|=|\\cdot|\\times|\\div|\\pm|\\pm/.test(buf);
      if (!mathy) return null;
      return { latex: buf, end: end };
    },

    /** 归一化（纯公式模式）：把裸 LaTeX 包成块级，含定界符原样。 */
    _norm(raw) {
      let s = String(raw || '').trim();
      if (!s) return '';
      const hasDelim = /\\\(|\\\[|\$\$|\$/.test(s);
      if (this._multiline() && !hasDelim) {
        const lines = s.split(/\n+/).map(x => x.trim()).filter(Boolean);
        if (lines.length > 1) return '$$' + lines.map(l => '\\displaystyle ' + l).join(' \\\\ ') + '$$';
      }
      if (hasDelim) return s;
      if (!this._autowrap()) return '$$' + s.replace(/\s*\n+\s*/g, ' \\\\ ') + '$$';
      return '$$' + s + '$$';
    },

    open() {
      const modal = $('#combo-math-modal');
      if (!modal) return;
      modal.classList.remove('hidden');
      const input = $('#combo-math-input');
      // 初次打开（非编辑已插入元素）输入框默认为空
      if (!this._editingEl) {
        if (input) input.value = '';
        this._color = '#000000';
        this._fontSize = 18;
        this._bgColor = '';
        this._fontFamily = '';
        const fontSel = $('#combo-math-font');
        if (fontSel) fontSel.value = '';
        const row = $('#combo-math-color-row');
        if (row) row.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('active'));
        const sizeInp = $('#combo-math-size');
        if (sizeInp) sizeInp.value = '18';
        const bgRow = $('#combo-math-bg-row');
        if (bgRow) bgRow.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('active'));
      }
      if (input) input.focus();
      this.updatePreview();
    },

    /** 清空输入框与设置 */
    clear() {
      const input = $('#combo-math-input');
      if (input) input.value = '';
      this._color = '#000000';
      this._fontSize = 18;
      this._bgColor = '';
      this._fontFamily = '';
      const fontSel = $('#combo-math-font');
      if (fontSel) fontSel.value = '';
      const row = $('#combo-math-color-row');
      if (row) row.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('active'));
      const custom = $('#combo-math-color-custom');
      if (custom) custom.value = '#000000';
      const sizeInp = $('#combo-math-size');
      if (sizeInp) sizeInp.value = '18';
      const bgRow = $('#combo-math-bg-row');
      if (bgRow) bgRow.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('active'));
      this._editingEl = null;
      this.updatePreview();
      const input2 = $('#combo-math-input');
      if (input2) input2.focus();
    },

    close() {
      $('#combo-math-modal').classList.add('hidden');
    },

    updatePreview() {
      const input = $('#combo-math-input');
      const preview = $('#combo-math-preview');
      if (!input || !preview) return;
      const raw = input.value;
      const fs = this._fontSize || 18;
      const bg = this._bgColor ? (';background:' + this._bgColor) : '';
      const ff = this._fontFamily ? (';font-family:' + this._fontFamily) : '';
      preview.style.color = this._color || '#000000';
      preview.innerHTML = '';
      if (!raw.trim()) {
        preview.innerHTML = '<span style="color:var(--text-tertiary);font-size:0.7em;">粘贴标准 LaTeX 公式，此处实时预览组合结果</span>';
        return;
      }
      // 混排：中文 + 行内公式（保留换行），字号/背景/字体随设置
      const html = this._toMixedHtml(raw);
      preview.innerHTML = '<div style="font-size:' + fs + 'px;line-height:1.9;text-align:left;white-space:normal;padding:12px 14px;box-sizing:border-box;' + bg + ff + '">' + (html.replace(/<br>/g, '<br>')) + '</div>';
      if (window.MathJax && window.MathJax.typesetPromise) {
        window.MathJax.typesetPromise([preview]).catch(() => {});
      }
    },

    /** 插入：把组合公式内容作为一个「文本元素」（.el-text，中文 + 行内公式混排）插入当前页。
        这样汉字和公式自然换行、字号与正文一致，可双击再次编辑。 */
    insert() {
      const input = $('#combo-math-input');
      const color = this._color || '#000000';
      const raw = input ? input.value : '';
      if (!raw.trim()) { toast('请先粘贴或输入公式', 'error'); return; }
      const section = Elements.currentSection();
      if (!section) { toast('请先进入一个页面再插入公式', 'error'); return; }

      const mixed = this._toMixedHtml(raw);
      const fs = this._fontSize || 18;
      const bgAttr = this._bgColor ? (';background:' + this._bgColor) : '';
      const ffAttr = this._fontFamily ? (';font-family:' + this._fontFamily) : '';
      // 若在编辑已插入的组合公式，则原地更新内容；否则插入新元素。
      if (this._editingEl && this._editingEl.isConnected) {
        const el = this._editingEl;
        el.setAttribute('data-combo-raw', raw);
        el.setAttribute('data-combo-color', color);
        el.setAttribute('data-combo-size', String(fs));
        el.setAttribute('data-combo-bg', this._bgColor || '');
        el.setAttribute('data-combo-font', this._fontFamily || '');
        const txt = el.querySelector('.el-text');
        if (txt) {
          txt.innerHTML = mixed;
          txt.style.color = color;
          txt.style.fontSize = fs + 'px';
          txt.style.background = this._bgColor || '';
          txt.style.fontFamily = this._fontFamily || '';
        }
        renderMathThenSync(el);
        syncCurrentSlide();
        History.push();
        this._editingEl = null;
        this.close();
        toast('已更新组合公式', 'success');
        return;
      }
      const eid = 'el_' + uid();
      const left = 160, top = 170, w = 960, h = 320;
      const inner =
        '<div class="el-text" contenteditable="false" style="font-size:' + fs + 'px;line-height:1.9;text-align:left;padding:14px 18px;color:' + escAttr(color) + ';display:block;white-space:normal;overflow:visible;' + (bgAttr + ffAttr).replace(/^;/, '') + '">' + mixed + '</div>';
      const html =
        '<div class="slide-element" data-type="text" data-eid="' + eid + '"' +
        ' data-combo-math="1" data-combo-raw="' + escAttr(raw) + '" data-combo-color="' + escAttr(color) + '"' +
        ' data-combo-size="' + escAttr(String(fs)) + '" data-combo-bg="' + escAttr(this._bgColor || '') + '"' +
        ' data-combo-font="' + escAttr(this._fontFamily || '') + '"' +
        ' contenteditable="false"' +
        ' style="position:absolute;left:' + left + 'px;top:' + top + 'px;width:' + w + 'px;height:' + h + 'px;overflow:visible;">' + inner + '</div>';
      section.insertAdjacentHTML('beforeend', html);
      const el = section.querySelector('[data-eid="' + eid + '"]');
      if (el) {
        Elements.bindElement(el);
        Elements.select(el);
        renderMathThenSync(el);
      }
      History.push();
      this.close();
      toast('已插入组合公式（双击可再次编辑）', 'success');
    },

    /** 用已插入元素的内容回填并打开对话框（编辑）。 */
    editElement(el) {
      if (!el) return;
      const raw = el.getAttribute('data-combo-raw') || '';
      const color = el.getAttribute('data-combo-color') || '#000000';
      const size = parseFloat(el.getAttribute('data-combo-size')) || 18;
      const bg = el.getAttribute('data-combo-bg') || '';
      const font = el.getAttribute('data-combo-font') || '';
      const input = $('#combo-math-input');
      if (input) input.value = raw;
      this._color = color;
      this._fontSize = size;
      this._bgColor = bg;
      this._fontFamily = font;
      this._editingEl = el;
      const fontSel = $('#combo-math-font');
      if (fontSel) fontSel.value = font;
      // 同步颜色 UI
      const row = $('#combo-math-color-row');
      if (row) {
        row.querySelectorAll('.color-swatch').forEach(b => b.classList.toggle('active', b.dataset.color === color));
      }
      const custom = $('#combo-math-color-custom');
      if (custom) custom.value = color;
      const sizeInp = $('#combo-math-size');
      if (sizeInp) sizeInp.value = String(size);
      const bgRow = $('#combo-math-bg-row');
      if (bgRow) bgRow.querySelectorAll('.color-swatch').forEach(b => b.classList.toggle('active', b.dataset.color === bg));
      this.updatePreview();
      this.open();
    },
  };
  window.ComboMath = ComboMath;

  /* ===== 试卷/讲义模式（A4 分页 + 题号自动识别） =====
     左侧输入（支持 #/##/###/1./(1) 语法 + LaTeX 公式），右侧 A4 预览，
     题号/标题自动识别、公式渲染、按 A4 分页，可打印/PDF、插入当前页。 */
  const PaperMode = {
    _open: false,
    _images: {},          // { n: dataURL } 预览用；输入区用 [图N] 标记
    _imgSeq: 0,
    _zoom: 1,             // 右侧 A4 预览缩放（1 = 100%）

    /** 默认讲义模板（首次打开预填） */
    DEFAULT: '# 函数的奇偶性\n' +
      '## 知识梳理\n' +
      '### 奇偶性定义\n' +
      '1. 设函数 $f(x)$ 定义域为 $D$，对任意 $x\\in D$：\n' +
      '(1) 若 $f(-x)=f(x)$，则 $f(x)$ 为偶函数；\n' +
      '(2) 若 $f(-x)=-f(x)$，则 $f(x)$ 为奇函数。\n' +
      '### 判断步骤\n' +
      '2. 判断 $f(x)=x^2$ 的奇偶性：\n' +
      '(1) 定义域为 $\\mathbb{R}$，关于原点对称。\n' +
      '(2) 计算 $f(-x)=(-x)^2=x^2=f(x)$。\n' +
      '3. 所以 $f(x)=x^2$ 为偶函数。\n' +
      '## 典型例题\n' +
      '1. 已知 $f(x)=\\left\\{\\begin{aligned}-1,x&>0\\\\0,x&=0\\\\1,x&<0\\end{aligned}\\right.$，判断其奇偶性。\n' +
      '### 解答\n' +
      '当 $x>0$ 时 $-x<0$，$f(-x)=-1=-f(x)$；当 $x<0$ 时 $-x>0$，$f(-x)=1=-f(x)$；当 $x=0$ 时 $f(0)=0$。\n' +
      '2. 综上 $f(x)$ 为奇函数。\n',

    /** 试卷模板（选择/填空/解答结构） */
    EXAM: '# 数学试卷\n' +
      '## 一、选择题\n' +
      '1. 已知集合 $A=\\{1,2,3\\}$，$B=\\{2,3,4\\}$，则 $A\\cap B=$（　）\n' +
      'A. $\\{1\\}$　B. $\\{2,3\\}$　C. $\\{1,4\\}$　D. $\\{2,4\\}$\n' +
      '2. 若 $f(x)=x^2+1$，则 $f(2)=$（　）\n' +
      'A. $3$　B. $4$　C. $5$　D. $6$\n' +
      '## 二、填空题\n' +
      '3. 函数 $y=\\sin x$ 的最小正周期为______。\n' +
      '4. 若 $a=2$，$b=3$，则 $a^2+b^2=$______。\n' +
      '## 三、解答题\n' +
      '5. 已知 $f(x)=x^2-2x+1$，求 $f(3)$。\n' +
      '### 解答\n' +
      '（1）代入得 $f(3)=3^2-2\\times 3+1=9-6+1=4$。\n' +
      '（2）所以 $f(3)=4$。\n' +
      '6. 在 $\\triangle ABC$ 中，$\\angle A=30^\\circ$，$\\angle B=60^\\circ$，求 $\\angle C$。\n' +
      '### 解答\n' +
      '$\\angle C=180^\\circ - \\angle A-\\angle B=180^\\circ-30^\\circ-60^\\circ=90^\\circ$。\n',

    open() {
      const m = $('#paper-modal');
      if (!m) return;
      m.classList.remove('hidden');
      this._open = true;
      // 每次打开重置图片表（编号从 1 重新开始，避免与旧图错位）
      this._images = {};
      this._imgSeq = 0;
      this._zoom = 1;
      this.zoom(0, 1);
      const nsEl = $('#paper-numstyle');
      if (nsEl) { this._numStyle = nsEl.value; this._autoNum = true; }
      const input = $('#paper-input');
      if (input) {
        // 首次打开强制预填默认讲义模板（避免只有 placeholder 显得没内容）
        if (!this._inited) { input.value = this.DEFAULT; this._inited = true; }
        else if (!input.value.trim()) { input.value = this.DEFAULT; }
      }
      this.render();
      setTimeout(() => this.fitZoom(), 300);
    },

    close() { $('#paper-modal').classList.add('hidden'); this._open = false; },

    /** 把输入解析成 HTML（题号/标题识别 + 公式留待 MathJax 渲染） */
    _numStyle: 'arabic',   // 'arabic'=1,2,3  'cn'=一、二、三
    _autoNum: true,        // 是否自动编号（忽略手写的数字，按顺序重编号）

    _parse(src) {
      if (!src) return '';
      let out = '';
      const lines = String(src).split(/\n/);
      const esc = (s) => escHTML(String(s));
      const m = (re, t) => t.match(re);
      const cn = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
      let qNo = 0;                    // 大题号累加
      const blk = (h) => '<div class="pp-block">' + h + '</div>';
      for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (!t) continue;
        let mm;
        // 标题
        if (/^###\s+\S/.test(t)) { out += blk('<div class="paper-sub">' + esc(m(/^###\s+(.*)$/, t)[1]) + '</div>'); continue; }
        if (/^##\s+\S/.test(t)) { out += blk('<div class="paper-box-title">' + esc(m(/^##\s+(.*)$/, t)[1]) + '</div>'); continue; }
        if (/^#\s+\S/.test(t)) { out += blk('<h2>' + esc(m(/^#\s+(.*)$/, t)[1]) + '</h2>'); continue; }
        // 大题号（手动数字或中文前缀）
        mm = t.match(/^([0-9一二三四五六七八九十]+)[.、]\s*([\s\S]*)/);
        if (mm) {
          qNo++;
          let num = mm[1];
          if (this._autoNum) num = this._numStyle === 'cn' ? (cn[qNo - 1] || String(qNo)) : String(qNo);
          out += blk('<div class="paper-q"><span class="paper-q-num">' + num + '.</span> ' + esc(mm[2]) + '</div>');
          continue;
        }
        // 小题号 (1) / （1）
        let sub = -1, body = '';
        mm = t.match(/^[（(]([0-9一二三四五六七八九十]+)[)）]\s*([\s\S]*)/);
        if (mm) { sub = parseInt(mm[1], 10); body = mm[2]; }
        if (sub >= 0) {
          let num = this._numStyle === 'cn' ? (cn[sub - 1] || String(sub)) : String(sub);
          out += blk('<div class="paper-subq">（' + num + '）' + esc(body) + '</div>');
          continue;
        }
        // 普通正文段落（首行缩进）
        out += blk('<p class="paper-par">' + esc(t) + '</p>');
      }
      return out;
    },

    /** 渲染：解析 + 生成逐页 A4 + MathJax typeset */
    render() {
      const srcEl = $('#paper-input');
      const a4 = $('#paper-a4');
      if (!srcEl || !a4) return;
      // 每次重建测量页（分页后 #paper-page 会被新的 N 页替换）
      const html = this._imageHtml(this._parse(srcEl.value)) || '<p style="color:#999">输入内容后在此预览 A4 排版</p>';
      a4.innerHTML = '<div class="paper-page" id="paper-page">' + html + '</div>';
      const pageEl = $('#paper-page');
      if (window.MathJax && window.MathJax.typesetPromise) {
        const self = this;
        window.MathJax.typesetPromise([pageEl]).then(() => self._paginate()).catch(() => self._paginate());
      } else { this._paginate(); }
    },

    /** 让 A4 整页缩进预览窗口可见（fit to viewport）：transform:scale + 动态容器高度 */
    fitZoom() {
      const a4 = $('#paper-a4');
      if (!a4) return;
      a4.style.zoom = '';
      const page = a4.querySelector('.paper-page') || $('#paper-page');
      if (!page) return;
      const pw = page.offsetWidth || 794;
      const aw = a4.clientWidth || 500;
      const scale = Math.min(1, Math.max(0.3, ((aw - 28) / pw)));
      a4.style.zoom = scale;
      this._zoom = scale;
      const val = $('#paper-zoom-val'); if (val) val.textContent = Math.round(scale * 100) + '%';
    },

    /** 分页：改为“单页流式”——内容按顺序放入一个 .paper-page（height auto），
        打印时由浏览器按 A4 自然分页（块 break-inside:avoid），避免逐块测量不准导致空页。 */
    _paginate() {
      const a4 = $('#paper-a4');
      const srcEl = $('#paper-page');
      if (!a4 || !srcEl) return;
      const inner = srcEl.innerHTML;
      // 单个 .paper-page 承载全部内容（顺序完整），打印时浏览器分页
      a4.innerHTML = '<div class="paper-page">' + inner + '</div>';
      this._afterPaginate();
    },

    _afterPaginate() {
      const self = this;
      // 保持字体/排版样式 & 自动缩放整页
      this.applyFont(); this.applyLayout();
      setTimeout(() => self.fitZoom(), 120);
    },

    /** 把预览的每一页 A4 导出为多页 PDF，并弹出“保存文件”对话框 */
    savePdf() {
      // 打印当前 DOM（主文档 MathJax 已正确渲染 .paper-page，公式正常）。
      // 配合精简 @media print（只显示 .paper-page、min-height 自然分页），避免空白页。
      const n = $$('.paper-page').length;
      toast('已生成 ' + n + ' 页，请在打印对话框选 “Microsoft Print to PDF” 并取消“页眉和页脚”', 'info');
      setTimeout(() => window.print(), 400);
    },

    /** Blob → base64（Unicode 安全，供 saveExportFile） */
    _blobToBase64(blob) {
      return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).replace(/^data:.*;base64,/, ''));
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      });
    },

    insertCurrent() {
      // 功能已暂时停用：保留按钮，点击提示。
      toast('插入当前页功能已暂时停用（公式渲染问题待解决）', 'info');
    },

    clear() { const i = $('#paper-input'); if (i) { i.value = ''; } this.render(); },

    /** 应用模板：handout=讲义, exam=试卷(选择/填空/解答), blank=清空 */
    applyTemplate(key) {
      const input = $('#paper-input');
      if (!input) return;
      if (key === 'handout') input.value = this.DEFAULT;
      else if (key === 'exam') input.value = this.EXAM;
      else input.value = '';
      this.render();
    },

    /** 应用字体控制（颜色/名称/大小）到所有 A4 页面 */
    applyFont() {
      const pages = $$('.paper-page');
      if (!pages.length) return;
      const fam = $('#paper-font-family'), size = $('#paper-font-size'), col = $('#paper-font-color');
      pages.forEach((page) => {
        if (fam && fam.value) page.style.fontFamily = fam.value;
        if (size && size.value) page.style.fontSize = size.value + 'px';
        if (col && col.value) page.style.color = col.value;
      });
    },

    /** 应用排版细节（行距/段距/缩进/标题字号）到所有 A4 页面（CSS 变量） */
    applyLayout() {
      const pages = $$('.paper-page');
      const lhAst = $('#paper-lh'), paraAst = $('#paper-para'), indentAst = $('#paper-indent'), h2Ast = $('#paper-h2');
      const lh = lhAst ? lhAst.value : 1.7;
      const para = paraAst ? paraAst.value : 6;
      const indent = indentAst ? indentAst.value : 0;
      const h2size = h2Ast ? h2Ast.value : 18;
      pages.forEach((page) => {
        page.style.lineHeight = parseFloat(lh);
        page.style.setProperty('--paper-para', para);
        page.style.setProperty('--paper-indent', indent);
        page.style.setProperty('--paper-h2', h2size);
        const h2 = page.querySelector('h2'); if (h2) h2.style.fontSize = h2size + 'px';
      });
    },

    /** 缩放右侧 A4 预览（delta 为步进；set 为绝对值）。用 CSS zoom（改动布局，滚动/多页正常）。 */
    zoom(delta, set) {
      if (set != null) this._zoom = Math.min(3, Math.max(0.3, set));
      else this._zoom = Math.min(3, Math.max(0.3, this._zoom + delta));
      const a4 = $('#paper-a4');
      if (a4) { a4.style.zoom = this._zoom; }
      const val = $('#paper-zoom-val'); if (val) val.textContent = Math.round(this._zoom * 100) + '%';
    },

    /** 插入本地图片/截图：存 base64，编号 1,2,3...，在光标处插入 [图N] 标记 */
    insertImage() {
      const input = $('#paper-input');
      if (!input) return;
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.onchange = () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const n = ++this._imgSeq;
          this._images[n] = reader.result;
          const tag = '[图' + n + ']';
          const start = input.selectionStart != null ? input.selectionStart : input.value.length;
          const end = input.selectionEnd != null ? input.selectionEnd : input.value.length;
          input.value = input.value.slice(0, start) + tag + input.value.slice(end);
          input.focus(); input.selectionStart = input.selectionEnd = start + tag.length;
          this.render();
          toast('已插入图片（[图' + n + ']；可加 :center/:left/:right 对齐、:50% 缩放）', 'success');
        };
        reader.readAsDataURL(file);
      };
      fileInput.click();
    },

    /** 把 [图N] 标记替换为 <img>，支持多参数：对齐(:center/:left/:right)、缩放(:NN%)、旋转(:NN(度))，如 [图1:center:60%:45] */
    /** 图片标记→<img>。参数（`:` 分隔，可多）：
        对齐 :center/:left/:right；缩放 :NN%；旋转 :NN；
        浮动 :float（右浮、文字环绕）/ :float:left；
        题注：参数里非保留字的文本段（如 图6-1-12）作为图下题注。
        例：[图1:float:图6-1-12]、[图1:right:60%:45] */
    _imageHtml(html) {
      return html.replace(/\[图(\d+)((?::[^\[\]:=]+)*)\]/g, (m, n, params) => {
        const url = this._images[n];
        if (!url) return '<span style="color:#c00">[图片缺失图' + n + ']</span>';
        let align = '', width = '', rotate = '', float = '', caption = '';
        (params || '').split(':').forEach(p => {
          if (!p) return;
          if (p === 'center' || p === 'left' || p === 'right') align = p;
          else if (p === 'float') float = 'right';
          else if (p === 'floatleft') float = 'left';
          else if (/^\d+%$/.test(p)) width = 'max-width:' + p + ';';   // 缩放用 max-width，避免小图被拉大
          else if (/^-?\d+$/.test(p)) rotate = 'transform:rotate(' + p + 'deg);';
          else caption = p;   // 其余文本 → 图题注
        });
        const imgStyle = rotate ? 'style="' + rotate + '"' : '';
        // 缩放参数用于 figure 宽度（相对页面内容宽），图片填满 figure
        const figWidth = width ? 'width:' + width.replace('max-width:', '') + ';' : 'width:fit-content;';
        const figImg = width ? 'width:100%;' : '';
        const mk = (mm) => '<figure class="paper-fig" style="' + figWidth + mm + '"><img class="paper-img" style="' + figImg + rotate + '" src="' + url + '" />' +
          (caption ? '<figcaption class="paper-figcap">' + escHTML(caption) + '</figcaption>' : '') + '</figure>';
        // 浮动：文字环绕
        if (float) {
          const s = float === 'left' ? 'float:left;margin:0 10px 8px 0;' : 'float:right;margin:0 0 8px 10px;';
          return '<figure class="paper-fig paper-float-fig" style="' + figWidth + s + '"><img class="paper-float-img" style="' + figImg + rotate + '" src="' + url + '" />' +
            (caption ? '<figcaption class="paper-figcap">' + escHTML(caption) + '</figcaption>' : '') + '</figure>';
        }
        // 对齐（left/right/center）：margin:auto 可靠定位
        if (align) {
          let mm = 'margin-left:auto;margin-right:auto;';
          if (align === 'left') mm = 'margin-right:auto;margin-left:0;';
          else if (align === 'right') mm = 'margin-left:auto;margin-right:0;';
          return '<div class="paper-imgbox">' + mk(mm) + '</div>';
        }
        // 默认行内；带题注转居中块
        if (caption) {
          return '<div class="paper-imgbox">' + mk('margin-left:auto;margin-right:auto;') + '</div>';
        }
        // 纯行内（无题注）
        return '<img class="paper-img-inline" ' + imgStyle + ' src="' + url + '" />';
      });
    },
  };
  window.PaperMode = PaperMode;

  /* ===== 图像运算：两张位图做交 / 并 / 差 → 一张新图 =====
     基于像素 alpha 通道布尔运算（透明=0，不透明=255）。
     并 outA=max(aA,aB)；交 outA=min(aA,aB)；差(A-B) outA=aA*(1-aB)。 */

  /* ===== Math graphs: coordinate systems / function curves / plane geometry / wireframe solids ===== */
  const MathGraph = {
    // Drawing constants
    C: { axis: '#334155', minor: '#d9dee6', fn: '#534AB7', fn2: '#E8590C', fn3: '#0CA678', text: '#55606f', solid: '#94A3B8', solid2: '#cbd5e1' },

    // Each item: { id, cat, name, svg (card preview 320x220), build() -> <svg> }
    items: [],

    _axisArrow(x1, y1, x2, y2) {
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const a = 7;
      // tip at (x2,y2), draw two short legs back at ±angle
      const lx = x2 - a * Math.cos(ang - 0.45), ly = y2 - a * Math.sin(ang - 0.45);
      const rx = x2 - a * Math.cos(ang + 0.45), ry = y2 - a * Math.sin(ang + 0.45);
      return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + this.C.axis + '" stroke-width="2"/>' +
        '<line x1="' + x2 + '" y1="' + y2 + '" x2="' + lx + '" y2="' + ly + '" stroke="' + this.C.axis + '" stroke-width="2"/>' +
        '<line x1="' + x2 + '" y1="' + y2 + '" x2="' + rx + '" y2="' + ry + '" stroke="' + this.C.axis + '" stroke-width="2"/>';
    },

    _label(x, y, txt, anchor) {
      return '<text x="' + x + '" y="' + y + '" font-size="11" fill="' + this.C.text + '" text-anchor="' + (anchor || 'middle') + '" font-family="inherit">' + txt + '</text>';
    },

    /** 平面直角坐标系 viewport 320x220, origin at (cx,cy), positive distances per axis */
    plane2d(cfg) {
      cfg = cfg || {};
      const W = 320, H = 220;
      const cx = cfg.cx != null ? cfg.cx : 160;
      const cy = cfg.cy != null ? cfg.cy : 110;
      const unit = cfg.unit || 28;          // px per grid cell
      const rangeX = cfg.rangeX || 4;       // cells to positive X
      const rangeY = cfg.rangeY || 3;       // cells to positive Y
      let s = '';
      // minor grid
      for (let i = -rangeX; i <= rangeX; i++) {
        const x = cx + i * unit;
        s += '<line x1="' + x + '" y1="' + 0 + '" x2="' + x + '" y2="' + H + '" stroke="' + this.C.minor + '" stroke-width="1"/>';
      }
      for (let j = -rangeY; j <= rangeY; j++) {
        const y = cy - j * unit;
        s += '<line x1="0" y1="' + y + '" x2="' + W + '" y2="' + y + '" stroke="' + this.C.minor + '" stroke-width="1"/>';
      }
      // axes (arrows)
      s += this._axisArrow(0, cy, W, cy);
      s += this._axisArrow(cx, H, cx, 0);
      // origin + labels
      s += this._label(cx + 5, cy + 14, 'O', 'start');
      s += this._label(W - 4, cy + 14, 'x', 'end');
      s += this._label(cx - 12, 10, 'y', 'end');
      // ticks numeric (1..)
      for (let i = 1; i <= rangeX; i++) { const x = cx + i * unit; s += this._label(x, cy + 13, String(i), 'middle'); }
      for (let j = 1; j <= rangeY; j++) { const y = cy - j * unit; s += this._label(cx - 9, y + 4, String(j), 'end'); }
      return s;
    },

    /** sample a function f(x) over [-4,4], draw polyline in viewport */
    _curve(fx, fnColor, opt) {
      opt = opt || {};
      const W = 320, H = 220, cx = 160, cy = 110, unit = 28;
      // 坐标平面可视范围：横轴 [-4,4]，纵轴 [-3,3]（cell 单位），超出即截断，确保纵坐标不超 y 轴范围
      const pxMin = cx - 4 * unit, pxMax = cx + 4 * unit;
      const pyMin = cy - 3 * unit, pyMax = cy + 3 * unit;
      let path = '';
      const lo = -4, hi = 4, step = 0.07;
      let started = false;
      for (let x = lo; x <= hi; x += step) {
        const y = fx(x);
        if (!isFinite(y)) { started = false; continue; }
        const px = cx + x * unit;
        const py = cy - y * unit;
        if (px < pxMin || px > pxMax || py < pyMin || py > pyMax) { started = false; continue; }
        path += (started ? ' L' : ' M') + px.toFixed(1) + ',' + py.toFixed(1);
        started = true;
      }
      return '<path d="' + path + '" fill="none" stroke="' + (fnColor || this.C.fn) + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';
    },

    _wrap(inner, captions) {
      return '<svg viewBox="0 0 320 220" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' + inner + (captions || '') + '</svg>';
    },

    init() {
      const C = this.C, self = this;
      const plane = function (extra, caps) { return self._wrap(plane2d(extra), caps); };
      /* Need plane2d accessible inside init; hoist a closure */
      function plane2d(cfg) { return self.plane2d(cfg); }
      const basePlane = () => plane({});

      this.items = [
        // ---- 坐标系 ----
        { id: 'frame2d', cat: 'axes', name: '平面直角坐标系', svg: '', build() { return self._el(self._wrap(plane2d({}), self._label(280, 205, 'O', 'end'))); } },
        { id: 'frame2d-neg', cat: 'axes', name: '坐标轴（含负半轴）', svg: '', build() { return self._el(self._wrap(plane2d({ rangeX: 4, rangeY: 3 }), '')); } },
        { id: 'frame3d', cat: 'axes', name: '空间直角坐标系', svg: '', build() { return self._el(self._frame3d()); } },
        // ---- 函数曲线 ----
        { id: 'fn-exp', cat: 'fn', name: '指数函数 y=aˣ', svg: '', build() { return self._el(self._wrap(self._curve(x => Math.pow(1.7, x), C.fn) + plane2d({}), self._label(210, 52, 'y = a^x', 'start'))); } },
        { id: 'fn-log', cat: 'fn', name: '对数函数 y=logax', svg: '', build() { return self._el(self._wrap(self._curve(x => Math.log(x) / Math.log(1.7), C.fn) + plane2d({}), self._label(250, 46, 'y = log_a(x)', 'start'))); } },
        { id: 'fn-sine', cat: 'fn', name: '正弦函数 y=sinx', svg: '', build() { return self._el(self._wrap(self._curve(x => 1.6 * Math.sin(x), C.fn) + plane2d({}), self._label(250, 46, 'y = sin x', 'start'))); } },
        { id: 'fn-cos', cat: 'fn', name: '余弦函数 y=cosx', svg: '', build() { return self._el(self._wrap(self._curve(x => 1.6 * Math.cos(x), C.fn2) + plane2d({}), self._label(250, 46, 'y = cos x', 'start'))); } },
        { id: 'fn-linear', cat: 'fn', name: '一次函数 y=kx+b', svg: '', build() { return self._el(self._wrap(self._curve(x => 0.9 * x + 0.5, C.fn) + plane2d({}), self._label(230, 40, 'y = kx + b', 'start'))); } },
        { id: 'fn-quad', cat: 'fn', name: '二次函数 y=ax²', svg: '', build() { return self._el(self._wrap(self._curve(x => 0.55 * x * x - 1, C.fn) + plane2d({}), self._label(252, 42, 'y = ax²', 'start'))); } },
        { id: 'fn-cubic', cat: 'fn', name: '三次函数 y=ax³', svg: '', build() { return self._el(self._wrap(self._curve(x => 0.28 * x * x * x, C.fn) + plane2d({}), self._label(250, 40, 'y = ax³', 'start'))); } },
        // ---- 平面几何（无填充）----
        { id: 'geo-tri', cat: 'geo', name: '三角形', svg: '', build() { return self._el(self._geo([['160,30','60,190','260,190']])); } },
        { id: 'geo-square', cat: 'geo', name: '正方形', svg: '', build() { return self._el(self._geo([['90,40','230,40','230,180','90,180']])); } },
        { id: 'geo-rect', cat: 'geo', name: '矩形', svg: '', build() { return self._el(self._geo([['60,55','260,55','260,165','60,165']])); } },
        { id: 'geo-para', cat: 'geo', name: '平行四边形', svg: '', build() { return self._el(self._geo([['70,60','210,60','250,160','110,160']])); } },
        { id: 'geo-trap', cat: 'geo', name: '梯形', svg: '', build() { return self._el(self._geo([[ '95,60','205,60','250,170','55,170' ]])); } },
        { id: 'geo-rhombus', cat: 'geo', name: '菱形', svg: '', build() { return self._el(self._geo([['160,40','250,110','160,180','70,110']])); } },
        { id: 'geo-pent', cat: 'geo', name: '五边形', svg: '', build() { return self._el(self._geo([self._poly(160,110,70,5)])); } },
        { id: 'geo-hex', cat: 'geo', name: '六边形', svg: '', build() { return self._el(self._geo([self._poly(160,110,68,6)])); } },
        { id: 'geo-circle', cat: 'geo', name: '圆', svg: '', build() { return self._el('<svg viewBox="0 0 320 220" width="100%" height="100%"><circle cx="160" cy="110" r="72" fill="none" stroke="' + C.solid + '" stroke-width="2.4"/></svg>'); } },
        { id: 'geo-tri-circle', cat: 'geo', name: '圆 + 内接三角形', svg: '', build() { var cx=160,cy=110,r=78; var p=function(a){return (cx+r*Math.cos(a)).toFixed(1)+','+(cy-r*Math.sin(a)).toFixed(1);}; return self._el('<svg viewBox="0 0 320 220" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">'+
        '<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="none" stroke="'+C.solid2+'" stroke-width="1.8" stroke-dasharray="4 3"/>'+
        '<polygon points="'+p(Math.PI/2)+' '+p(Math.PI/2+2*Math.PI/3)+' '+p(Math.PI/2+4*Math.PI/3)+'" fill="none" stroke="'+C.solid+'" stroke-width="2.6" stroke-linejoin="round"/>'+
        '<circle cx="'+cx+'" cy="'+cy+'" r="2.5" fill="'+C.solid+'" stroke="none"/>'+
        '</svg>'); } },
        // ---- 几何体（框架）----
        { id: 'sol-cube', cat: 'solid', name: '正方体', svg: '', build() { return self._el(self._cube(false)); } },
        { id: 'sol-cuboid', cat: 'solid', name: '长方体', svg: '', build() { return self._el(self._cuboid(false)); } },
        { id: 'sol-pyramid', cat: 'solid', name: '四棱锥', svg: '', build() { return self._el(self._pyramid()); } },
        { id: 'sol-prism', cat: 'solid', name: '三棱柱', svg: '', build() { return self._el(self._triPrism()); } },
        { id: 'sol-cyl', cat: 'solid', name: '圆柱', svg: '', build() { return self._el(self._cylinder()); } },
        { id: 'sol-cone', cat: 'solid', name: '圆锥', svg: '', build() { return self._el(self._cone()); } },
        { id: 'sol-sphere', cat: 'solid', name: '球体', svg: '', build() { return self._el(self._sphere()); } },
        { id: 'sol-hexprism', cat: 'solid', name: '六棱柱', svg: '', build() { return self._el(self._hexPrism()); } },
        // ---- 曲线（迁移自图形元素）----
        { id: 'mg-curve', cat: 'fn', name: '曲线', svg: '', build() { return self._el(Shapes.curve('#ffffff', self.C.fn, 3, 'solid')); } },
        { id: 'mg-axes', cat: 'axes', name: '坐标系', svg: '', build() { return self._el(Shapes.axes('#ffffff', self.C.solid, 2, 'solid')); } },
        { id: 'mg-numline', cat: 'axes', name: '数轴', svg: '', build() { return self._el(Shapes.numline('#ffffff', self.C.solid, 2, 'solid')); } },
        { id: 'mg-parabola', cat: 'fn', name: '抛物线 y=x²', svg: '', build() { return self._el(Shapes.parabola('#ffffff', self.C.fn, 3, 'solid')); } },
        { id: 'mg-sine', cat: 'fn', name: '正弦曲线', svg: '', build() { return self._el(Shapes.sine('#ffffff', self.C.fn, 3, 'solid')); } },
        { id: 'mg-cosine', cat: 'fn', name: '余弦曲线', svg: '', build() { return self._el(Shapes.cosine('#ffffff', self.C.fn2, 3, 'solid')); } },
        { id: 'mg-exp', cat: 'fn', name: '指数曲线', svg: '', build() { return self._el(Shapes.exp('#ffffff', self.C.fn, 3, 'solid')); } },
        { id: 'mg-log', cat: 'fn', name: '对数曲线', svg: '', build() { return self._el(Shapes.log('#ffffff', self.C.fn, 3, 'solid')); } },
        // ---- 集合 Venn（迁移自图形元素）----
        { id: 'mg-venn', cat: 'set', name: 'Venn图', svg: '', build() { return self._el(Shapes.venn('rgba(37,99,235,0.3)', '#2563EB', 2, 'solid')); } },
        { id: 'mg-venn-inter', cat: 'set', name: '交集A∩B', svg: '', build() { return self._el(Shapes.vennInter('#e11d48', self.C.solid, 2, 'solid')); } },
        { id: 'mg-venn-union', cat: 'set', name: '并集A∪B', svg: '', build() { return self._el(Shapes.vennUnion('#e11d48', self.C.solid, 2, 'solid')); } },
        { id: 'mg-venn-comp', cat: 'set', name: '补集补A', svg: '', build() { return self._el(Shapes.vennComp('#e11d48', self.C.solid, 2, 'solid')); } },
        { id: 'mg-venn-diff', cat: 'set', name: '差集A−B', svg: '', build() { return self._el(Shapes.vennDiff('#e11d48', self.C.solid, 2, 'solid')); } },
        { id: 'mg-venn-subset', cat: 'set', name: '子集A⊂B', svg: '', build() { return self._el(Shapes.vennSubset('#ffffff', self.C.solid, 2, 'solid')); } },
      ];
    },

    // helper: a generic slide-element wrapping an <svg>
    _el(svg) {
      const eid = 'el_' + uid();
      return '<div class="slide-element" data-type="mathgraph" data-eid="' + eid + '" contenteditable="false"' +
        ' style="position:absolute;left:300px;top:160px;width:440px;height:300px;">' + svg + '</div>';
    },

    // closed polygon from a single path
    _poly(cx, cy, r, sides) {
      const pts = [];
      for (let i = 0; i < sides; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI / sides);
        pts.push(Math.round(cx + r * Math.cos(a)) + ',' + Math.round(cy + r * Math.sin(a)));
      }
      return pts;
    },

    // shapes (no fill, thin outline)
    _geo(polys) {
      let s = '';
      polys.forEach(function (p) {
        s += '<polygon points="' + p.join(' ') + '" fill="none" stroke="' + this.C.solid + '" stroke-width="2.4" stroke-linejoin="round"/>';
      }, this);
      return '<svg viewBox="0 0 320 220" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' + s + '</svg>';
    },

    // 3D frame: isometric axes with labels
    _frame3d() {
      const C = this.C;
      const ox = 160, oy = 176, L = 96;
      function dim(a, b, lbl, anchor) {
        return '<line x1="' + ox + '" y1="' + oy + '" x2="' + (ox + a) + '" y2="' + (oy - b) + '" stroke="#334155" stroke-width="2"/>' +
          '<text x="' + (ox + a * 1.16) + '" y="' + (oy - b * 1.16) + '" font-size="12" fill="#55606f" text-anchor="' + (anchor || 'middle') + '" font-family="inherit">' + lbl + '</text>';
      }
      return '<svg viewBox="0 0 320 220" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' +
        dim(0, L, 'z', 'middle') + dim(L, 0, 'x', 'middle') + dim(-L * 0.85, L * 0.5, 'y', 'middle') +
        '<text x="' + ox + '" y="' + (oy + 16) + '" font-size="11" fill="#55606f" text-anchor="middle" font-family="inherit">O</text>' +
        '</svg>';
    },

    // wireframe solids (front bold, hidden dashed)
    _cube(deep) {
      const C = this.C;
      const dx = 54, dy = -30;               // 后上方偏移（斜二测）
      // 前面四个角
      const fTL = [80,40], fTR = [200,40], fBR = [200,160], fBL = [80,160];
      // 后面四个角 = 前 + 偏移
      const b = (p) => [p[0]+dx, p[1]+dy];
      const bTL=b(fTL), bTR=b(fTR), bBR=b(fBR), bBL=b(fBL);
      const line=(a,bc,w,dash)=>'<line x1="'+a[0]+'" y1="'+a[1]+'" x2="'+bc[0]+'" y2="'+bc[1]+'" stroke="'+C.solid+'" stroke-width="'+w+'"'+(dash?' stroke-dasharray="4 3"':'')+'/>';
      const front='<polygon points="'+fTL.join(',')+' '+fTR.join(',')+' '+fBR.join(',')+' '+fBL.join(',')+'" fill="none" stroke="'+C.solid+'" stroke-width="2.6" stroke-linejoin="round"/>';
      // 背面（隐藏，虚线）
      const back='<polygon points="'+bTL.join(',')+' '+bTR.join(',')+' '+bBR.join(',')+' '+bBL.join(',')+'" fill="none" stroke="'+C.solid2+'" stroke-width="1.6" stroke-dasharray="4 3"/>';
      // 可见连接棱（前→后）：右上、右下、左下为实线；左上为隐藏虚线
      let conn = line(fTR,bTR,2.4,false) + line(fBR,bBR,2.4,false) + line(fBL,bBL,2.4,false) + line(fTL,bTL,1.6,true);
      return '<svg viewBox="0 0 320 220" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' + back + conn + front + '</svg>';
    },

    _cuboid(deep) {
      const C = this.C; const dx = 58, dy = -30;
      const fTL=[56,60], fTR=[224,60], fBR=[224,160], fBL=[56,160];
      const b=(p)=>[p[0]+dx,p[1]+dy];
      const bTL=b(fTL),bTR=b(fTR),bBR=b(fBR),bBL=b(fBL);
      const line=(a,bc,w,dash)=>'<line x1="'+a[0]+'" y1="'+a[1]+'" x2="'+bc[0]+'" y2="'+bc[1]+'" stroke="'+C.solid+'" stroke-width="'+w+'"'+(dash?' stroke-dasharray="4 3"':'')+'/>';
      const front='<polygon points="'+fTL.join(',')+' '+fTR.join(',')+' '+fBR.join(',')+' '+fBL.join(',')+'" fill="none" stroke="'+C.solid+'" stroke-width="2.6" stroke-linejoin="round"/>';
      const back='<polygon points="'+bTL.join(',')+' '+bTR.join(',')+' '+bBR.join(',')+' '+bBL.join(',')+'" fill="none" stroke="'+C.solid2+'" stroke-width="1.6" stroke-dasharray="4 3"/>';
      const conn = line(fTR,bTR,2.4,false) + line(fBR,bBR,2.4,false) + line(fBL,bBL,2.4,false) + line(fTL,bTL,1.6,true);
      return '<svg viewBox="0 0 320 220" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' + back + conn + front + '</svg>';
    },

    _pyramid() {
      const C = this.C; const apex = [160,50];
      const bFL=[70,170], bFR=[250,170], bBR=[210,125], bBL=[110,125]; // 底面前右、左、后右、后左
      const line=(a,bc,w,dash)=>'<line x1="'+a[0]+'" y1="'+a[1]+'" x2="'+bc[0]+'" y2="'+bc[1]+'" stroke="'+C.solid+'" stroke-width="'+w+'"'+(dash?' stroke-dasharray="4 3"':'')+'/>';
      // 底面：前边/左右侧边为实线，后边为隐藏虚线
      const baseFront = line(bFL,bFR,2.6,false) + line(bFL,bBL,2.4,false) + line(bFR,bBR,2.4,false);
      const baseBack = line(bBL,bBR,1.6,true);
      // 侧棱：到底面两个前角为实线，到两个后角为隐藏虚线
      const edges = line(apex,bFL,2.6,false) + line(apex,bFR,2.6,false) + line(apex,bBL,1.6,true) + line(apex,bBR,1.6,true);
      return '<svg viewBox="0 0 320 220" width="100%" height="100%">' + baseBack + baseFront + edges + '</svg>';
    },

    _triPrism() {
      const C = this.C; const dx = 42, dy = -22;
      const tri = [[80,165],[200,165],[120,95]];           // 底面（前）
      const triB = tri.map(p => [p[0]+dx, p[1]+dy]);        // 顶面（后上）
      const line=(a,bc,w,dash)=>'<line x1="'+a[0]+'" y1="'+a[1]+'" x2="'+bc[0]+'" y2="'+bc[1]+'" stroke="'+C.solid+'" stroke-width="'+w+'"'+(dash?' stroke-dasharray="4 3"':'')+'/>';
      // 底面三角形（实线）、顶面三角形（实线，可见）
      const base='<polygon points="'+tri.map(p=>p.join(',')).join(' ')+'" fill="none" stroke="'+C.solid+'" stroke-width="2.6" stroke-linejoin="round"/>';
      const top='<polygon points="'+triB.map(p=>p.join(',')).join(' ')+'" fill="none" stroke="'+C.solid+'" stroke-width="2.4" stroke-linejoin="round"/>';
      // 连接棱：前两条（连接底两角）实线；后一条（连接底顶角）隐藏虚线
      const edges = line(tri[0],triB[0],2.4,false) + line(tri[1],triB[1],2.4,false) + line(tri[2],triB[2],1.6,true);
      return '<svg viewBox="0 0 320 220" width="100%" height="100%">' + top + base + edges + '</svg>';
    },

    _cylinder() {
      const C = this.C; const cx = 160, topY = 60, botY = 170, rx = 70, ry = 22;
      // 底面：前半（可见）实线，后半（隐藏）虚线
      const backArc = 'M' + (cx - rx) + ' ' + botY + ' A' + rx + ' ' + ry + ' 0 0 0 ' + (cx + rx) + ' ' + botY;
      const frontArc = 'M' + (cx + rx) + ' ' + botY + ' A' + rx + ' ' + ry + ' 0 0 0 ' + (cx - rx) + ' ' + botY;
      return '<svg viewBox="0 0 320 220" width="100%" height="100%">' +
        '<path d="' + backArc + '" fill="none" stroke="' + C.solid2 + '" stroke-width="1.6" stroke-dasharray="4 3"/>' +
        '<path d="' + frontArc + '" fill="none" stroke="' + C.solid + '" stroke-width="2.4"/>' +
        '<path d="M' + (cx - rx) + ' ' + topY + ' L' + (cx - rx) + ' ' + botY + '" stroke="' + C.solid + '" stroke-width="2.4"/>' +
        '<path d="M' + (cx + rx) + ' ' + topY + ' L' + (cx + rx) + ' ' + botY + '" stroke="' + C.solid + '" stroke-width="2.4"/>' +
        '<ellipse cx="' + cx + '" cy="' + topY + '" rx="' + rx + '" ry="' + ry + '" fill="none" stroke="' + C.solid + '" stroke-width="2.4"/>' +
        '</svg>';
    },

    _cone() {
      const C = this.C; const cx = 160; const apexY = 62; const baseY = 168; const rx = 66, ry = 20;
      return '<svg viewBox="0 0 320 220" width="100%" height="100%">' +
        '<ellipse cx="' + cx + '" cy="' + baseY + '" rx="' + rx + '" ry="' + ry + '" fill="none" stroke="' + C.solid + '" stroke-width="2.4"/>' +
        '<path d="M' + (cx - rx) + ' ' + baseY + ' L' + cx + ' ' + apexY + '" stroke="' + C.solid + '" stroke-width="2.4"/>' +
        '<path d="M' + (cx + rx) + ' ' + baseY + ' L' + cx + ' ' + apexY + '" stroke="' + C.solid + '" stroke-width="2.4"/>' +
        '</svg>';
    },

    _sphere() {
      const C = this.C; const cx = 160, cy = 110, r = 68;
      return '<svg viewBox="0 0 320 220" width="100%" height="100%">' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + C.solid + '" stroke-width="2.4"/>' +
        '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + r + '" ry="' + (r * 0.42) + '" fill="none" stroke="' + C.solid2 + '" stroke-width="1.4" stroke-dasharray="4 3"/>' +
        '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + (r * 0.42) + '" ry="' + r + '" fill="none" stroke="' + C.solid2 + '" stroke-width="1.4" stroke-dasharray="4 3"/>' +
        '</svg>';
    },

    _hexPrism() {
      const C = this.C; const dx = 42, dy = -22;
      const hex = [];
      for (let i = 0; i < 6; i++) { const a = -Math.PI/2 + i*Math.PI/3; hex.push([Math.round(150 + 62*Math.cos(a)), Math.round(130 + 46*Math.sin(a))]); }
      const hexB = hex.map(p => [p[0]+dx, p[1]+dy]);
      const cY = 130;
      const line=(a,bc,w,dash)=>'<line x1="'+a[0]+'" y1="'+a[1]+'" x2="'+bc[0]+'" y2="'+bc[1]+'" stroke="'+C.solid+'" stroke-width="'+w+'"'+(dash?' stroke-dasharray="4 3"':'')+'/>';
      const link=(a,bc,dash)=>'<line x1="'+a[0]+'" y1="'+a[1]+'" x2="'+bc[0]+'" y2="'+bc[1]+'" stroke="'+C.solid+'" stroke-width="'+(dash?1.6:2.4)+'"'+(dash?' stroke-dasharray="4 3"':'')+'/>';
      // 底面（前多后少）：前边实线、后边虚线
      let s = '<polygon points="' + hex.map(p=>p.join(',')).join(' ') + '" fill="none" stroke="' + C.solid + '" stroke-width="2.6" stroke-linejoin="round"/>';
      // 顶面（后上，可见实线）
      s += '<polygon points="' + hexB.map(p=>p.join(',')).join(' ') + '" fill="none" stroke="' + C.solid + '" stroke-width="2.4" stroke-linejoin="round"/>';
      // 连接棱：前(下)y大 实线，后(上)y小 虚线
      hex.forEach(function(p,i){ s += link(p, hexB[i], p[1] < cY); });
      // 底面后半（隐藏虚线）覆盖——把底面上半的边画虚线
      for(let i=0;i<6;i++){ const a=hex[i], b=hex[(i+1)%6]; const midY=(a[1]+b[1])/2; if(midY < cY){ s += '<line x1="'+a[0]+'" y1="'+a[1]+'" x2="'+b[0]+'" y2="'+b[1]+'" stroke="'+C.solid2+'" stroke-width="1.6" stroke-dasharray="4 3"/>'; } }
      return '<svg viewBox="0 0 320 220" width="100%" height="100%">' + s + '</svg>';
    },

    open() {
      this.init();
      // build tabs
      const tabs = $('#mathgraph-tabs');
      if (tabs && !tabs._built) {
        const cats = [
          { id: 'axes', name: '坐标系' }, { id: 'fn', name: '函数' },
          { id: 'geo', name: '平面几何' }, { id: 'solid', name: '几何体' },
          { id: 'set', name: '集合' },
        ];
        let html = '<button class="tab active" data-mg-cat="axes">坐标系</button>';
        // full set with a small "all" first
        html = '<button class="tab" data-mg-cat="all">全部</button>' +
          cats.map(c => '<button class="tab" data-mg-cat="' + c.id + '">' + c.name + '</button>').join('');
        tabs.innerHTML = html;
        tabs._built = true;
      }
      $('#mathgraph-modal').classList.remove('hidden');
      // rebuild previews at open (colors/positions)
      this.render('all');
    },

    render(catId) {
      const grid = $('#mathgraph-grid');
      if (!grid) return;
      $$('#mathgraph-modal .mathgraph-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.mgCat === catId));
      const list = this.items.filter(it => catId === 'all' || it.cat === catId);
      grid.innerHTML = '';
      list.forEach(it => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'smartart-card';
        card.dataset.mgInsert = it.id;
        // small preview: build() is a full slide-element with absolute positioning,
        // so extract its inner svg for the card.
        const built = it.build();
        const m = built.match(/<svg[\s\S]*<\/svg>/);
        card.innerHTML = '<span class="smartart-preview">' + (m ? m[0] : '') + '</span>' +
          '<span class="smartart-name">' + escHTML(it.name) + '</span>';
        grid.appendChild(card);
      });
      const hint = $('#mathgraph-hint');
      if (hint) hint.textContent = '点击插入当前页 —— 图形为 SVG，整体拖动、缩放、可导出 · 共 ' + list.length + ' 个';
    },

    insert(id) {
      const item = this.items.find(it => it.id === id);
      if (!item) return;
      const section = Elements.currentSection();
      if (!section) return;
      section.insertAdjacentHTML('beforeend', item.build());
      // bind the newest elements
      Array.from(section.querySelectorAll('.slide-element')).forEach(el => {
        if (!el.dataset.bound) Elements.bindElement(el);
      });
      const el = section.querySelector('[data-type="mathgraph"]:last-of-type');
      if (el) { Elements.deselect(); Elements.select(el); }
      syncCurrentSlide();
      History.push();
      this.close();
      toast('已插入数学图形：「' + item.name + '」', 'success');
    },

    close() {
      $('#mathgraph-modal').classList.add('hidden');
    },
  };

  /* ===== State ===== */
  let project = null;
  let currentIndex = 0;
  let currentV = 0;      // active vertical (sub-page) within the current chapter
  let savedRange = null;
  let editorDeck = null;
  let presentDeck = null;
  let presentDeckReady = false;
  let suppressInputSync = false;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // All <section> elements in the deck, including chapter-nested verticals.
  function deckSections(rootSel) {
    const root = rootSel ? $(rootSel) : document;
    if (!root) return [];
    const out = [];
    $$('#slides-container > section', root).forEach((top) => {
      out.push(top);
      $$(':scope > section', top).forEach((v) => out.push(v));
    });
    return out;
  }

  // Find the section whose data-id matches a slide id (handles nested verticals).
  function sectionById(id) {
    return deckSections('#slides-container').find((s) => s.getAttribute('data-id') === id) || null;
  }

  function uid() {
    return 's' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  }

  function toast(msg, type) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast' + (type ? ' ' + type : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.className = 'toast hidden'; }, 2200);
  }

  /** 自定义确认框（替代 window.confirm）：避免 Tauri 原生 confirm 显示 "tauri.localhost 显示" 前缀。
      返回 Promise<boolean>。 */
  function AppConfirm(msg, title) {
    return new Promise(function (resolve) {
      const modal = $('#confirm-modal');
      if (!modal) { resolve(window.confirm(msg)); return; }
      const mt = $('#confirm-title'), mm = $('#confirm-msg');
      if (mt) mt.textContent = title || '确认';
      if (mm) mm.textContent = msg || '';
      modal.classList.remove('hidden');
      const yes = modal.querySelector('[data-action="confirm-yes"]');
      const no = modal.querySelector('[data-action="confirm-no"]');
      const backdrop = modal.querySelector('.modal-backdrop');
      const done = function (val) {
        modal.classList.add('hidden');
        yes.removeEventListener('click', onYes);
        no.removeEventListener('click', onNo);
        if (backdrop) backdrop.removeEventListener('click', onNo);
        document.removeEventListener('keydown', onKey);
        resolve(val);
      };
      const onYes = function () { done(true); };
      const onNo = function () { done(false); };
      const onKey = function (e) { if (e.key === 'Escape') done(false); if (e.key === 'Enter') done(true); };
      yes.addEventListener('click', onYes);
      no.addEventListener('click', onNo);
      if (backdrop) backdrop.addEventListener('click', onNo);
      document.addEventListener('keydown', onKey);
    });
  }

  /* ===== Nav: flat <-> nested(chapter/vertical) mapping =====
   * A slide may carry an optional `children` array, making it a "chapter":
   *   in present/editor decks it renders as one horizontal <section> that
   *   contains the chapter's own vertical <section> (self) plus one vertical
   *   per child. `/// level` (up/down) moves within the chapter; left/right
   *   moves between chapters/singles.
   * Everywhere else treats slides as a flat list indexed by currentIndex, so
   * this module maps a flat index <-> (horizontal index, vertical index). */
  const Nav = {
    // Normalize a stored slide: guarantee `children` is an array.
    isChapter(s) { return !!(s && Array.isArray(s.children) && s.children.length > 0); },
    children(s) { return (s && Array.isArray(s.children)) ? s.children : []; },

    // Total flat slide count including chapter children.
    flatCount() {
      let n = 0;
      (project.slides || []).forEach((s) => {
        n += 1 + this.children(s).length;
      });
      return n;
    },

    // Build a list of flat entries: { slide, parentIdx, childIdx }
    //   - parentIdx: index into project.slides (0-based)
    //   - childIdx:  index into children array, or -1 for a non-chapter's self,
    //                or -2 for a chapter's own (self) vertical.
    flatList() {
      const out = [];
      (project.slides || []).forEach((s, i) => {
        const kids = this.children(s);
        if (kids.length) {
          // chapter: self is vertical 0, then each child
          out.push({ slide: s, parentIdx: i, childIdx: -2 });
          kids.forEach((c, ci) => out.push({ slide: c, parentIdx: i, childIdx: ci }));
        } else {
          out.push({ slide: s, parentIdx: i, childIdx: -1 });
        }
      });
      return out;
    },

    // Reveal navigation coordinates for a flat index.
    toHv(flatIdx) {
      const list = this.flatList();
      if (flatIdx < 0) flatIdx = 0;
      if (flatIdx >= list.length) flatIdx = list.length - 1;
      const e = list[flatIdx];
      let v = 0;
      if (e.childIdx === -2) v = 0;
      else if (e.childIdx >= 0) v = e.childIdx + 1; // child 0 -> vertical 1
      else v = 0;
      return { h: e.parentIdx, v: v };
    },

    // Flat index for a Reveal (h, v) position.
    fromHv(h, v) {
      const list = this.flatList();
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.parentIdx !== h) continue;
        if (e.childIdx === -1 && (v === 0 || v === undefined)) return i;
        if (e.childIdx === -2 && v === 0) return i;
        if (e.childIdx >= 0 && v === e.childIdx + 1) return i;
      }
      // fallback: nearest chapter h, v=0
      const hb = this.flatList().filter((e, i) => e.parentIdx === h);
      return hb.length ? list.indexOf(hb[0]) : 0;
    },

    // Flat index of the "next" / "prev" page in a linear walk that respects
    // chapter boundaries: down first (into a chapter), across siblings, then up
    // when leaving a chapter. Returns -1 if no such page.
    nextFlat(flatIdx) {
      const list = this.flatList();
      const total = list.length;
      if (flatIdx >= total - 1) return -1;
      return flatIdx + 1;
    },
    prevFlat(flatIdx) {
      if (flatIdx <= 0) return -1;
      return flatIdx - 1;
    },

    // The slide object currently shown, given a chapter index and vertical idx.
    activeSlide(idx, v) {
      const s = project.slides[idx];
      if (!s) return null;
      const kids = this.children(s);
      if (!kids.length) return s;
      if (!v || v === 0) return s;              // chapter's own page = vertical 0
      return kids[v - 1] || s;                  // child verticals start at v=1
    },

    // Is this flat index a chapter's own (self) page?
    isChapterSelf(idx, v) {
      const s = project.slides[idx];
      return !!(s && this.isChapter(s) && (!v || v === 0));
    },
  };

  /* ===== SlideStore ===== */
  const Store = {
    newProject() {
      return {
        meta: {
          title: '未命名演示',
          description: '',
          theme: DEFAULT_THEME,
          transition: DEFAULT_TRANSITION,
          transitionSpeed: 'default',
          size: 'wide',
          font: '',
          margin: 0.05,
          lang: 'zh-CN',
          navMode: 'default',
          slideNumbers: false,
          autoSlide: 0,      // 自动播放间隔（毫秒），0 = 关闭
          loop: false,       // 循环播放
          brandName: 'LJ-PPT',
          brandLogo: '',
          copyright: '© ' + new Date().getFullYear() + ' LTJ Studio',
          brandFooter: true,
        },
        slides: [
          { id: uid(), content: this.sanitizeContent(fitTemplateHtml(Layouts.title(), sizeMap('wide'))), bg: null, notes: '' },
          { id: uid(), content: this.sanitizeContent(fitTemplateHtml(Layouts.content(), sizeMap('wide'))), bg: null, notes: '' },
        ],
      };
    },

    load() {
      try {
        // remove legacy autosave keys to avoid stale corrupt data
        localStorage.removeItem('revealslidr:autosave');
        const raw = localStorage.getItem(AUTOSAVE_KEY);
        if (raw) {
          const data = JSON.parse(raw);
          if (data && data.slides) {
            // brand migration: legacy autosave still carries the old RevealSlidr
            // brand; upgrade it to the new LJ-PPT / LTJ Studio defaults so an
            // already-open project shows the rebranded name/copyright too.
            if (data.meta) {
              if (data.meta.brandName === 'RevealSlidr') data.meta.brandName = 'LJ-PPT';
              if (data.meta.copyright && /RevealSlidr/.test(data.meta.copyright)) data.meta.copyright = '© ' + new Date().getFullYear() + ' LTJ Studio';
            }
            data.slides.forEach(s => {
              // guard against corrupted slides with missing content
              if (typeof s.content !== 'string') {
                s.content = '';
              }
              s.content = this.sanitizeContent(s.content);
              // chapter children too
              if (Array.isArray(s.children)) {
                s.children.forEach(c => {
                  if (typeof c.content !== 'string') c.content = '';
                  c.content = this.sanitizeContent(c.content);
                });
              }
            });
          }
          return data;
        }
      } catch (e) { /* ignore */ }
      return this.newProject();
    },

    persist() {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
      } catch (e) { /* ignore quota errors */ }
    },

    /** Strip legacy spurious JS-source fragments left by earlier versions */
    sanitizeContent(content) {
      if (typeof content !== 'string') return content;
      // First pass: remove obvious JS concatenation artifacts
      let cleaned = content
        .replace(/\(\s*\)\s*=>\s*['"\`]?/g, '')
        .replace(/(^|\n)\s*['"\`]\+['"\`]\s*(?=\n|<)/g, '')
        .replace(/['"\`]\+['"\`]/g, '')
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim();

      // Second pass: parse DOM and strip text nodes that are only JS syntax fragments
      try {
        const doc = new DOMParser().parseFromString('<div>' + cleaned + '</div>', 'text/html');
        const root = doc.body.firstChild;
        if (root) {
          const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          const toRemove = [];
          let node;
          while ((node = walker.nextNode())) {
            const text = node.textContent;
            // Remove text nodes containing only whitespace and JS syntax chars
            if (/^[\s'"\`+,\-=>()]*$/.test(text)) {
              toRemove.push(node);
            }
          }
          toRemove.forEach(n => {
            if (n.parentNode) n.parentNode.removeChild(n);
          });
          cleaned = root.innerHTML;
        }
      } catch (e) { /* ignore */ }

      return cleaned;
    },

    addSlide(layout) {
      const raw = Layouts[layout] || Layouts.content();
      const content = fitTemplateHtml(typeof raw === 'function' ? raw() : raw);
      const slide = { id: uid(), content: this.sanitizeContent(content), bg: null, notes: '' };
      project.slides.splice(currentIndex + 1, 0, slide);
      Store.persist();
      return slide;
    },

    deleteSlide(index) {
      if (project.slides.length <= 1) {
        toast('至少保留一张幻灯片', 'error');
        return false;
      }
      project.slides.splice(index, 1);
      Store.persist();
      return true;
    },

    duplicateSlide(index) {
      const orig = project.slides[index];
      const copy = {
        id: uid(), content: orig.content,
        bg: orig.bg ? Object.assign({}, orig.bg) : null,
        notes: orig.notes, autoAnimate: !!orig.autoAnimate,
      };
      project.slides.splice(index + 1, 0, copy);
      Store.persist();
      return copy;
    },

    moveSlide(from, to) {
      if (to < 0 || to >= project.slides.length) return;
      const [s] = project.slides.splice(from, 1);
      project.slides.splice(to, 0, s);
      Store.persist();
    },

    /* ---- Chapter / sub-page operations ---- */

    // Delete by flat index (chapter self, chapter child, or single slide).
    deleteFlat(fi) {
      const list = Nav.flatList();
      const e = list[fi];
      if (!e) return false;
      const kids = Nav.children(project.slides[e.parentIdx]);
      if (e.childIdx === -2) {
        // chapter's own page: if it only has itself, delete the whole chapter;
        // otherwise promote first child to the chapter root. Keep it simple: treat
        // chapter self deletion as removing the entire chapter.
        if (project.slides.length <= 1) { toast('至少保留一张幻灯片', 'error'); return false; }
        project.slides.splice(e.parentIdx, 1);
      } else if (e.childIdx >= 0) {
        // a child sub-page
        project.slides[e.parentIdx].children.splice(e.childIdx, 1);
        if (!project.slides[e.parentIdx].children.length) {
          delete project.slides[e.parentIdx].children;
        }
      } else {
        // a plain single slide
        if (project.slides.length <= 1) { toast('至少保留一张幻灯片', 'error'); return false; }
        project.slides.splice(e.parentIdx, 1);
      }
      Store.persist();
      // keep currentIndex in range
      currentIndex = Math.max(0, Math.min(currentIndex, project.slides.length - 1));
      currentV = 0;
      return true;
    },

    // Move by flat index. Only top-level moves are fully supported; moving a
    // child within its chapter reorders the children array.
    moveFlat(from, to) {
      const list = Nav.flatList();
      const a = list[from], b = list[to];
      if (!a || !b) return;
      if (a.childIdx >= 0 && a.parentIdx === b.parentIdx && b.childIdx >= 0) {
        // reorder children within the same chapter
        const kids = project.slides[a.parentIdx].children;
        const [k] = kids.splice(a.childIdx, 1);
        kids.splice(b.childIdx, 0, k);
        Store.persist();
        return;
      }
      if (a.childIdx >= 0) return; // moving a child across chapters not supported via drag
      // move a top-level chapter/slide
      const [s] = project.slides.splice(a.parentIdx, 1);
      project.slides.splice(b.parentIdx, 0, s);
      Store.persist();
    },

    // Add a sub-page to the chapter at `idx` (appends to children).
    addSubSlide(idx, layout) {
      const chapter = project.slides[idx];
      if (!chapter) return null;
      const raw = layout && Layouts[layout] ? Layouts[layout] : Layouts.content();
      const content = fitTemplateHtml(typeof raw === 'function' ? raw() : raw);
      const child = { id: uid(), content: this.sanitizeContent(content), bg: null, notes: '' };
      if (!Array.isArray(chapter.children)) chapter.children = [];
      chapter.children.push(child);
      Store.persist();
      return child;
    },

    // Turn the slide at `idx` into a chapter (gives it a children array).
    toChapter(idx) {
      const s = project.slides[idx];
      if (!s) return false;
      if (!Array.isArray(s.children)) s.children = [];
      Store.persist();
      return true;
    },

    // Duplicate a slide by flat index (chapter self / child / single). Preserves
    // chapter children when duplicating a chapter's own page.
    duplicateFlat(fi) {
      const list = Nav.flatList();
      const e = list[fi];
      if (!e) return null;
      const src = e.slide;
      const copy = {
        id: uid(), content: src.content,
        bg: src.bg ? Object.assign({}, src.bg) : null,
        notes: src.notes, autoAnimate: !!src.autoAnimate,
      };
      if (e.childIdx === -2) {
        // chapter self: duplicate the whole chapter (incl. children) after it
        const kids = Nav.children(src).map(c => ({
          id: uid(), content: c.content,
          bg: c.bg ? Object.assign({}, c.bg) : null,
          notes: c.notes, autoAnimate: !!c.autoAnimate,
        }));
        if (kids.length) copy.children = kids;
        project.slides.splice(e.parentIdx + 1, 0, copy);
      } else if (e.childIdx >= 0) {
        project.slides[e.parentIdx].children.splice(e.childIdx + 1, 0, copy);
      } else {
        project.slides.splice(e.parentIdx + 1, 0, copy);
      }
      Store.persist();
      return copy;
    },

    updateContent(index, html) {
      if (project.slides[index]) {
        project.slides[index].content = html;
        Store.persist();
      }
    },

    updateMeta(key, value) {
      project.meta[key] = value;
      Store.persist();
    },
  };

  /* ===== PreviewEngine ===== */
  const Preview = {
    _ready: false,

    async init() {
      this._ready = false;
      editorDeck = new Reveal($('#reveal'), {
        embedded: true,
        keyboard: false,
        controls: false,
        progress: false,
        overview: false,
        center: false, // editor positions elements in absolute slide coords; center would shift section.top and cause jumps
        hash: false,
        margin: 0.04,
        minScale: 0.2,
        maxScale: 2.0,
        view: 'slides', // classic per-slide layout
        scrollActivationWidth: null, // never auto-switch to scroll layout (narrow windows crash reveal 5.2 init on the empty deck)
        transition: project.meta.transition,
        transitionSpeed: project.meta.transitionSpeed || 'default',
        backgroundTransition: 'slide',
        plugins: [RevealMarkdown, RevealHighlight, RevealNotes].filter(Boolean),
      });
      await editorDeck.initialize();
      this._ready = true;
      // Re-render from store now that the deck is ready. If a structural change
      // (add page / append template) was clicked while the deck was still
      // initializing on a cold start, its render() deferred the deck sync and
      // left _deferredRender set; this final render() syncs the current project
      // (which already includes that change), so nothing is lost.
      this.render();
      editorDeck.on('slidechanged', () => {
        if (Elements.selected) Elements.deselect();
        if (Elements._freeform) Elements._cancelFreeform();
        const st = editorDeck.getState();
        currentIndex = st.indexh;
        currentV = st.indexv || 0;
        SlidePanel.render();
        PropsPanel.update();
        updateCounter();
        updateStageFrame();
        // mount GeoGebra applets / watch URL embeds only on the slide that is
        // actually visible — injecting into hidden slides renders them blank.
        setTimeout(() => {
          const active = Nav.activeSlide(currentIndex, currentV);
          const sec = active ? sectionById(active.id) : null;
          if (sec) { renderGgbLocal(sec); watchGgbEmbeds(sec); applyEntrance(sec); }
        }, 100);
      });
      editorDeck.on('ready', () => {
        currentIndex = 0;
        updateCounter();
      });
    },

    /** Build the <section> HTML for one slide. If it's a chapter with children,
     *  emit a bare outer wrapper whose *nested* verticals are [self, ...children]
     *  so Reveal navigates left/right across chapters and up/down within. The
     *  chapter's own content lives on the first vertical (not on the outer), so
     *  the children never cover it. */
    sectionHtml(s) {
      const kids = Nav.children(s);
      const selfSec = this._slideSection(s.id, s.bg, s.autoAnimate, s.transitionSpeed, s.content, true);
      if (!kids.length) return selfSec;
      const inner = kids.map(function (c) {
        return this._slideSection(c.id, c.bg, c.autoAnimate, c.transitionSpeed, c.content, true);
      }, this).join('');
      // bare outer wrapper: marks a horizontal chapter; not editable itself.
      return '<section data-chapter="1" data-id-marker="' + s.id + '">' + selfSec + inner + '</section>';
    },

    /** One slide <section> (contenteditable for the editor, unless plain). */
    _slideSection(id, bg, autoAnimate, transitionSpeed, content, editable) {
      const bgAttr = bg && bg.color ? ' data-background-color="' + escAttr(bg.color) + '"' : '';
      const bgStyle = bg && bg.gradient
        ? ' data-background-image="linear-gradient(' + escAttr(bg.gradient) + ')"'
        : '';
      const aaAttr = autoAnimate ? ' data-auto-animate' : '';
      const tsAttr = transitionSpeed ? ' data-transition-speed="' + escAttr(transitionSpeed) + '"' : '';
      const ed = editable ? ' contenteditable="true" data-placeholder="点击编辑..."' : '';
      return '<section data-id="' + id + '"' + bgAttr + bgStyle + aaAttr + tsAttr + ed +
        '>' + injectAAIds(content || '') + '</section>';
    },

    /** Full re-render from store (structural changes) */
    render() {
      suppressInputSync = true;
      const container = $('#slides-container');
      container.innerHTML = project.slides.map(function (s, i) {
        return this.sectionHtml(s);
      }, this).join('');

      // The Reveal deck may not be initialized yet on a cold first launch (its
      // initialize() is awaited after the toolbar binds). Calling sync()/slide()
      // before it's ready silently drops the change, which made "add page /
      // append template" appear to do nothing on first run. Defer the deck sync
      // and replay it once the deck becomes ready (see Preview.init()).
      if (!this._ready || !editorDeck) { this._deferredRender = true; }
      else {
        editorDeck.configure({ transition: project.meta.transition, transitionSpeed: project.meta.transitionSpeed || 'default' });
        editorDeck.sync();
        editorDeck.slide(Math.min(currentIndex, project.slides.length - 1), currentV || 0);
      }
      // restore editable focus after sync
      requestAnimationFrame(() => {
        suppressInputSync = false;
        // bind element interactivity on all slides (incl. chapter verticals)
        deckSections('#slides-container').forEach(sec => Elements.bindToSlide(sec));
        // render math formulas
        renderMath($('#slides-container'));
        // render live Desmos calculators
        renderDesmos($('#slides-container'));
        // re-fit "自动适配字号" text elements
        applyAllRfit($('#slides-container'));
      applyAllMathFit($('#slides-container'));
        // position the presentation-window / safe-area guide FIRST so the
        // stage card is at its final size before the first GeoGebra applet
        // mounts (a settling card used to skew the first applet's aspect)
        updateStageFrame();
        // render local .ggb files / blank apps via GGBApplet API — only on the
        // visible slide; other slides get mounted when they become current
        var curSection = sectionById(Nav.activeSlide(currentIndex, currentV) && Nav.activeSlide(currentIndex, currentV).id) ||
          $$('#slides-container > section')[currentIndex];
        renderGgbLocal(curSection || $('#slides-container'));
        // detect GeoGebra URL embeds that fail to load (offline / blocked network)
        watchGgbEmbeds(curSection || $('#slides-container'));
      });
      // fallback in case layout settles a frame later
      setTimeout(updateStageFrame, 60);
      SlidePanel.render();
      PropsPanel.update();
      updateCounter();
      if (typeof LayerPanel !== 'undefined' && LayerPanel.render) LayerPanel.render();
    },

    /** Re-render a single slide without rebuilding all (preserves others) */
    renderSlide(index) {
      suppressInputSync = true;
      const slide = project.slides[index];
      const section = sectionById(slide && slide.id);
      if (section && slide) {
        // Rebuild the whole chapter (with nested children) so verticals aren't lost.
        section.outerHTML = this.sectionHtml(slide);
        editorDeck.sync();
      }
      requestAnimationFrame(() => {
        suppressInputSync = false;
        const renewed = sectionById(slide && slide.id);
        if (renewed) {
          Elements.bindToSlide(renewed);
          renderMath(renewed);
          renderDesmos(renewed);
          renderGgbLocal(renewed);
          watchGgbEmbeds(renewed);
        }
      });
    },

    goTo(index) {
      if (Elements.selected) Elements.deselect();
      currentIndex = Math.max(0, Math.min(index, project.slides.length - 1));
      currentV = 0;
      editorDeck.slide(currentIndex, 0);
      SlidePanel.render();
      PropsPanel.update();
      updateCounter();
      if (typeof LayerPanel !== 'undefined' && LayerPanel.render) LayerPanel.render();
    },

    next() { this.goTo(currentIndex + 1); },
    prev() { this.goTo(currentIndex - 1); },

    get current() {
      return Nav.activeSlide(currentIndex, currentV);
    },
  };

  /* ===== SlidePanel ===== */
  const SlidePanel = {
    render() {
      const list = $('#slide-list');
      const dims = sizeMap((project && project.meta && project.meta.size) || 'default');
      list.innerHTML = '';
      // Build a flat list of thumbs: chapter self, then indented children.
      Nav.flatList().forEach((entry, fi) => {
        const slide = entry.slide;
        const isChild = entry.childIdx >= 0;
        const chapter = project.slides[entry.parentIdx];
        const thumb = document.createElement('div');
        const isActive = (entry.parentIdx === currentIndex) &&
          ((entry.childIdx === -1 || entry.childIdx === -2) ? (currentV === 0) : (currentV === entry.childIdx + 1));
        thumb.className = 'slide-thumb' + (isActive ? ' active' : '') +
          (isChild ? ' slide-thumb-child' : '') +
          (Nav.isChapter(chapter) ? ' slide-thumb-chapter' : '');
        thumb.dataset.fidx = fi;
        thumb.dataset.id = slide.id;
        thumb.dataset.idx = entry.parentIdx;
        thumb.dataset.v = (entry.childIdx === -1 || entry.childIdx === -2) ? 0 : entry.childIdx + 1;
        // mirror the slide's real aspect ratio (16:9 / 4:3 / 1:1 / A4)
        thumb.style.aspectRatio = dims.w + ' / ' + dims.h;
        // replicate the slide background (color or gradient) on the mini-canvas
        let bg = '';
        if (slide.bg && slide.bg.gradient) bg = 'background-image:linear-gradient(' + slide.bg.gradient + ');';
        else if (slide.bg && slide.bg.color) bg = 'background-color:' + slide.bg.color + ';';
        // render the slide content at its native pixel size, then scale it down
        // (transform) so shapes / text / images keep their exact layout
        const label = Nav.isChapter(chapter) ? ((entry.childIdx === -2) ? '章' : '子·' + (entry.childIdx + 1)) : '';
        thumb.innerHTML =
          '<span class="slide-thumb-num">' + (Nav.isChapter(chapter) ? '<b>' + (entry.parentIdx + 1) + '</b>' + (label ? '<i>·' + label + '</i>' : '') : (entry.parentIdx + 1)) + '</span>' +
          '<button class="slide-thumb-del" data-fdel="' + fi + '" title="删除">✕</button>' +
          '<div class="slide-thumb-content" style="width:' + dims.w + 'px;height:' + dims.h + 'px;' + bg + '">' +
            (slide.content || '') +
          '</div>';
        thumb.addEventListener('click', (e) => {
          if (e.target.closest('[data-fdel]')) return;
          goToFlat(fi);
        });
        // drag to reorder (top-level chapters only; children reorder within)
        thumb.draggable = true;
        thumb.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', String(fi));
          thumb.style.opacity = '0.4';
        });
        thumb.addEventListener('dragend', () => { thumb.style.opacity = ''; });
        thumb.addEventListener('dragover', (e) => { e.preventDefault(); });
        thumb.addEventListener('drop', (e) => {
          e.preventDefault();
          const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
          const to = fi;
          if (from !== to && !isNaN(from)) {
            Store.moveFlat(from, to);
            History.push();
            Preview.render();
          }
        });
        // right-click context menu
        thumb.addEventListener('contextmenu', (e) => SlideContextMenu.show(e, fi));
        list.appendChild(thumb);
      });

      // scale each mini-canvas down to its thumbnail's rendered width so the
      // slide is shown as a true proportional preview (not full-size overflow)
      $$('.slide-thumb', list).forEach((thumb) => {
        const canvas = thumb.querySelector('.slide-thumb-content');
        if (!canvas) return;
        const w = thumb.clientWidth || 1;
        const s = dims.w ? (w / dims.w) : 1;
        canvas.style.transform = 'scale(' + s + ')';
      });

      // delete buttons
      $$('[data-fdel]', list).forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const fi = parseInt(btn.dataset.fdel, 10);
          if (Store.deleteFlat(fi)) {
            History.push();
            Preview.render();
            toast('已删除', 'success');
          }
        });
      });
    },
  };

  /** Navigate the editor to a flat (thumb) index. */
  function goToFlat(fi) {
    const hv = Nav.toHv(fi);
    if (Elements.selected) Elements.deselect();
    currentIndex = hv.h;
    currentV = hv.v;
    if (editorDeck) editorDeck.slide(hv.h, hv.v);
    SlidePanel.render();
    PropsPanel.update();
    updateCounter();
    if (typeof LayerPanel !== 'undefined' && LayerPanel.render) LayerPanel.render();
  }

  /** Update a single thumbnail's content after editing, by slide data-id. */
  function updateThumbnailFor(slide, cleaned) {
    const thumb = $('.slide-thumb[data-id="' + slide.id + '"]');
    if (thumb) {
      const tc = thumb.querySelector('.slide-thumb-content');
      if (tc) tc.innerHTML = cleaned;
    }
  }

  /* ===== PropsPanel — left contextual properties ===== */
  const PropsPanel = {
    init() {
      // deck title / description
      $('#deck-title').value = project.meta.title || '';
      $('#deck-desc').value = project.meta.description || '';
      $('#deck-title').addEventListener('input', (e) => {
        project.meta.title = e.target.value || '未命名演示';
        Store.persist();
      });
      $('#deck-desc').addEventListener('input', (e) => {
        project.meta.description = e.target.value;
        Store.persist();
      });

      // theme
      $('#theme-select').value = project.meta.theme;
      $('#theme-select').addEventListener('change', (e) => {
        applyTheme(e.target.value);
        Store.updateMeta('theme', e.target.value);
      });

      // font
      $('#font-select').value = project.meta.font || '';
      $('#font-select').addEventListener('change', (e) => {
        applyFont(e.target.value);
        Store.updateMeta('font', e.target.value);
      });

      // transition
      $('#transition-select').value = project.meta.transition;
      $('#transition-select').addEventListener('change', (e) => {
        Store.updateMeta('transition', e.target.value);
        editorDeck.configure({ transition: e.target.value });
      });

      // transition speed (全局切换速度)
      $('#transition-speed-select').value = project.meta.transitionSpeed || 'default';
      $('#transition-speed-select').addEventListener('change', (e) => {
        Store.updateMeta('transitionSpeed', e.target.value);
        editorDeck.configure({ transitionSpeed: e.target.value });
      });

      // size
      $('#size-select').value = project.meta.size || 'wide';
      $('#size-select').addEventListener('change', (e) => {
        Store.updateMeta('size', e.target.value);
        applySize(e.target.value);
        editorDeck.sync();
      });

      // background
      $('#bg-color').value = (Preview.current && Preview.current.bg && Preview.current.bg.color) || '#ffffff';
      $('#bg-color').addEventListener('change', (e) => {
        const slide = Preview.current;
        if (slide) {
          slide.bg = { color: e.target.value };
          Store.persist();
          Preview.render();
        }
      });
      $('[data-action="bg-gradient"]').addEventListener('click', () => {
        const slide = Preview.current;
        if (slide) {
          const c1 = randomColor();
          const c2 = randomColor();
          slide.bg = { gradient: '135deg, ' + c1 + ', ' + c2 };
          Store.persist();
          Preview.render();
          toast('已应用渐变背景');
        }
      });
      $('[data-action="bg-clear"]').addEventListener('click', () => {
        const slide = Preview.current;
        if (slide) {
          slide.bg = null;
          Store.persist();
          Preview.render();
        }
      });

      // notes
      $('#notes-area').addEventListener('input', (e) => {
        const slide = Preview.current;
        if (slide) {
          slide.notes = e.target.value;
          Store.persist();
        }
      });

      // auto-animate (morph) toggle for the current slide
      $('#slide-auto-animate').addEventListener('change', (e) => {
        const slide = Preview.current;
        if (slide) {
          slide.autoAnimate = e.target.checked;
          Store.persist();
          Preview.render();
          toast(e.target.checked ? '已开启自动动画：与上一页相同元素将平滑变形' : '已关闭自动动画');
        }
      });
    },

    update() {
      const slide = Preview.current;
      if (!slide) return;
      $('#notes-area').value = slide.notes || '';
      $('#bg-color').value = (slide.bg && slide.bg.color) || '#ffffff';
      $('#slide-auto-animate').checked = !!slide.autoAnimate;
    },

    /** Refresh all inputs from project meta (used after import) */
    refreshAll() {
      $('#deck-title').value = project.meta.title || '';
      $('#deck-desc').value = project.meta.description || '';
      $('#theme-select').value = project.meta.theme || DEFAULT_THEME;
      $('#font-select').value = project.meta.font || '';
      $('#transition-select').value = project.meta.transition || DEFAULT_TRANSITION;
      $('#transition-speed-select').value = project.meta.transitionSpeed || 'default';
      $('#size-select').value = project.meta.size || 'wide';
    },

    switchTo(id) {
      // back to the properties tab if the layers panel is visible
      const layers = $('#layers-panel');
      if (layers && !layers.classList.contains('hidden')) {
        layers.classList.add('hidden');
        $('#props-content').classList.remove('hidden');
        $$('#props-tabs .panel-tab').forEach(t => t.classList.toggle('active', t.dataset.ptab === 'props'));
      }
      $$('.props-section').forEach(s => s.classList.remove('active'));
      const target = $('#props-' + id);
      if (target) target.classList.add('active');
      const titles = { empty: '幻灯片', text: '文本', shape: '形状', embed: '嵌入', common: '通用', multi: '多选' };
      $('#props-title').textContent = titles[id] || '属性';
    },

    /** Multi-selection properties */
    switchToMulti() {
      $$('.props-section').forEach(s => s.classList.remove('active'));
      const target = $('#props-multi');
      if (target) target.classList.add('active');
      $('#props-title').textContent = '多选';
    },

    /** Switch the right panel to the layers tab */
    showLayers() {
      const tabs = $$('#props-tabs .panel-tab');
      tabs.forEach(t => t.classList.toggle('active', t.dataset.ptab === 'layers'));
      $('#props-content').classList.add('hidden');
      const layers = $('#layers-panel');
      layers.classList.remove('hidden');
      LayerPanel.render();
    },

    /** Show element-type panel + common panel simultaneously */
    switchToElement(type) {
      const layers = $('#layers-panel');
      if (layers && !layers.classList.contains('hidden')) {
        layers.classList.add('hidden');
        $('#props-content').classList.remove('hidden');
        $$('#props-tabs .panel-tab').forEach(t => t.classList.toggle('active', t.dataset.ptab === 'props'));
      }
      $$('.props-section').forEach(s => s.classList.remove('active'));
      // map type to panel id
      var panelId = type;
      if (type === 'math') panelId = 'embed'; // math falls back to embed panel
      const typePanel = $('#props-' + panelId);
      if (typePanel) typePanel.classList.add('active');
      const commonPanel = $('#props-common');
      if (commonPanel) commonPanel.classList.add('active');
      const titles = { text: '文本', shape: '形状', embed: '嵌入', image: '图片', table: '表格', math: '公式', chart: '图表', icon: '图标', mathgraph: '数学图形' };
      $('#props-title').textContent = titles[type] || '元素';
    },
  };

  /* base64 string → Uint8Array（用于把 GeoGebra getBase64 结果写为二进制 .ggb） */
  function base64ToBytes(b64) {
    if (!b64) return new Uint8Array(0);
    const clean = b64.replace(/[\r\n\s]/g, '');
    const bin = atob(clean);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  /* ===== GeoGebra 套件作图器（作图 → 保存 .ggb / 插入页面） ===== */
  const GgbSuite = {
    _applet: null,
    _app: 'classic',   // 默认全功能经典套件（含代数/几何/表格/3D/CAS 等全部视图）

    open() {
      const modal = $('#ggb-suite-modal');
      if (!modal) return;
      modal.classList.remove('hidden');
      this._app = 'classic';
      const sel = $('#ggb-suite-app');
      if (sel) sel.value = 'classic';
      this.render();
    },

    close() {
      $('#ggb-suite-modal').classList.add('hidden');
      this.destroy();
    },

    /** (Re)create the workbench applet in the suite host using GGBApplet API. */
    render() {
      const app = $('#ggb-suite-app') ? $('#ggb-suite-app').value : 'graphing';
      this._app = app;
      const hostEl = $('.ggb-suite-host');
      if (!hostEl) return;
      // tear down previous applet
      this.destroy();
      // unique id: GeoGebra registers the live applet as window[id] after inject,
      // and the export methods (getBase64/getXML) live on THAT instance — not on
      // the injection wrapper returned by `new GGBApplet(...)`.
      const ggbId = 'ggb_suite_' + Date.now().toString(36);
      this._ggbId = ggbId;
      loadGgbAppletAPI().then((GGBApplet) => {
        const opts = {
          id: ggbId,
          appName: app,
          showToolBar: $('#ggb-suite-toolbar') ? $('#ggb-suite-toolbar').checked : true,
          showMenuBar: $('#ggb-suite-menubar') ? $('#ggb-suite-menubar').checked : false,
          showAlgebraInput: $('#ggb-suite-algebra') ? $('#ggb-suite-algebra').checked : false,
          enableShiftDragZoom: $('#ggb-suite-zoom') ? $('#ggb-suite-zoom').checked : true,
          showResetIcon: true,
          borderColor: '#ddd',
          width: Math.max(320, hostEl.clientWidth || 640),
          height: Math.max(240, hostEl.clientHeight || 480),
          appletOnLoad: () => {},
        };
        let applet;
        try {
          applet = new GGBApplet(opts, true);
          if (typeof applet.setScaleContainer === 'function') applet.setScaleContainer(true);
          applet.inject(hostEl);
          this._applet = applet;
        } catch (e) {
          hostEl.innerHTML = '<div style="padding:14px;color:#c00;font-size:13px;">GeoGebra 作图器加载失败：' + escHTML(e && e.message || e) + '</div>';
        }
      }).catch((err) => {
        hostEl.innerHTML = '<div style="padding:14px;color:#c00;font-size:13px;line-height:1.6;">GeoGebra 引擎加载失败：' + escHTML(err && err.message || err) + '<br>请检查网络能否访问 geogebra.org。</div>';
      });
    },

    destroy() {
      const hostEl = $('.ggb-suite-host');
      if (hostEl) hostEl.innerHTML = '';
      this._applet = null;
      this._ggbId = null;
    },

    /** 工具栏/菜单栏/代数区/缩放 选项改变时重载：先保存当前作图（getBase64），
        重建 applet（应用新选项），再用 setBase64 恢复作图——既生效选项又不丢内容。 */
    reloadKeepContent() {
      const a = this.liveApplet();
      if (!a || typeof a.getBase64 !== 'function') { this.render(); return; }
      a.getBase64((b64) => {
        this.render();   // 重建，读取最新选项
        // 重建后恢复作图内容
        const tryRestore = (tries) => {
          const live = this.liveApplet();
          if (live && typeof live.setBase64 === 'function') {
            try { live.setBase64(b64); } catch (e) {}
            return;
          }
          if (tries < 25) setTimeout(() => tryRestore(tries + 1), 150);
        };
        tryRestore(0);
      });
    },

    /** 取真正可调用的 applet 实例：注入后在 window[ggbId] 上，导出方法只在那存在。 */
    liveApplet() {
      if (this._ggbId && window[this._ggbId]) return window[this._ggbId];
      return this._applet;
    },

    /** 读取当前坐标视图范围（绝对 xmin/xmax/ymin/ymax）。
        优先用 GeoGebra 的 getViewProperties()（返回 xMin/yMin/width/height/invXscale/invYscale），
        直接换算成绝对范围，避免基于 host 尺寸的像素换算误差。 */
    currentViewRange() {
      const a = this.liveApplet();
      if (!a) return null;
      try {
        if (typeof a.getViewProperties === 'function') {
          const v = a.getViewProperties();
          if (v && typeof v.xMin === 'number' && typeof v.yMin === 'number' &&
              typeof v.width === 'number' && typeof v.height === 'number' &&
              typeof v.invXscale === 'number') {
            const sx = v.invXscale, sy = (typeof v.invYscale === 'number') ? v.invYscale : v.invXscale;
            return {
              xmin: v.xMin,
              xmax: v.xMin + v.width * sx,
              ymin: v.yMin,
              ymax: v.yMin + v.height * sy,
            };
          }
        }
      } catch (e) { /* fall through to XML fallback */ }
      // 回退：从 getXML 的 coordSystem 像素换算
      if (typeof a.getXML !== 'function') return null;
      let hostW = 640, hostH = 480;
      const hostEl = $('.ggb-suite-host');
      if (hostEl) { hostW = Math.max(1, hostEl.clientWidth || 640); hostH = Math.max(1, hostEl.clientHeight || 480); }
      let xZero = 0, yZero = 0, scale = 40, yscale = 40;
      try {
        const xml = a.getXML();
        const m = xml.match(/<coordSystem[^>]*\/>/);
        if (m) {
          const g = m[0];
          const gx = g.match(/xZero="([-\d.]+)"/), gy = g.match(/yZero="([-\d.]+)"/);
          const gs = g.match(/scale="([-\d.]+)"/), gys = g.match(/yscale="([-\d.]+)"/);
          if (gx) xZero = parseFloat(gx[1]);
          if (gy) yZero = parseFloat(gy[1]);
          if (gs) scale = parseFloat(gs[1]);
          if (gys) yscale = parseFloat(gys[1]);
        } else { return null; }
      } catch (e) { return null; }
      if (!scale) return null;
      return {
        xmin: (0 - xZero) / scale,
        xmax: (hostW - xZero) / scale,
        ymin: (yZero - hostH) / yscale,
        ymax: yZero / yscale,
      };
    },

    /** 通过 applet.getBase64() 导出当前构造，保存为本地 .ggb 文件。 */
    save() {
      const a = this.liveApplet();
      if (!a || typeof a.getBase64 !== 'function') {
        toast('作图器尚未就绪，无法导出', 'error');
        return;
      }
      try {
        a.getBase64((b64) => {
          if (!b64) { toast('导出失败：未获取到内容', 'error'); return; }
          // .ggb is a zip blob; getBase64 returns its base64. Decode to bytes and
          // download as a real .ggb file the user can open in GeoGebra or re-insert.
          const bytes = base64ToBytes(b64);
          download('ggb-construction.ggb', bytes, 'application/zip');
          toast('已保存为 .ggb（可用「本地 .ggb」重新插入或分享）', 'success');
        });
      } catch (e) {
        toast('导出失败：' + (e && e.message || e), 'error');
      }
    },

    /** 把当前构造交给「本地 .ggb」插入选项界面：设置 base64 后打开 file 标签，
        让用户像导入本地 .ggb 一样勾选 工具栏/菜单栏/代数区/缩放 再确认插入。 */
    insert() {
      const a = this.liveApplet();
      if (!a || typeof a.getBase64 !== 'function') {
        toast('作图器尚未就绪，无法插入', 'error');
        return;
      }
      try {
        a.getBase64((b64) => {
          if (!b64) { toast('插入失败：未获取到内容', 'error'); return; }
          const name = '套件作图 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + '.ggb';
          this.close();
          // 记录套件的 app 类型（如 classic 全功能），插入时让页面 applet 与其一致
          Toolbar._ggbAppName = this._app || 'classic';
          // 记录当前坐标视图范围，使插入的 applet 与作图器视图一致
          Toolbar._ggbView = this.currentViewRange();
          Toolbar.openGeogebraFile(b64, name);
          // 把作图器里的选项默同步到插入界面，用户可再调整
          const st = $('#ggb-suite-toolbar'), sz = $('#ggb-suite-zoom');
          const sm = $('#ggb-suite-menubar'), sa = $('#ggb-suite-algebra');
          const ft = $('#ggb-toolbar'), fz = $('#ggb-zoom'), fm = $('#ggb-menubar'), fa = $('#ggb-file-algebra');
          if (ft && st) ft.checked = st.checked;
          if (fz && sz) fz.checked = sz.checked;
          if (fm && sm) fm.checked = sm.checked;
          if (fa && sa) fa.checked = sa.checked;
        });
      } catch (e) {
        toast('插入失败：' + (e && e.message || e), 'error');
      }
    },
  };

  /* ===== 画布缩放 / 平移（不改变 Reveal 坐标系，只变换显示比例） ===== */
  const StageZoom = {
    _s: 1,
    _tx: 0,
    _ty: 0,
    _min: 0.25,
    _max: 3,
    _drag: null,
    _bound: false,

    el() { return $('#stage-transform'); },

    apply() {
      const el = this.el();
      if (!el) return;
      el.style.transform = 'translate(' + this._tx + 'px,' + this._ty + 'px) scale(' + this._s + ')';
      const pct = $('#stage-zoom-pct');
      if (pct) pct.textContent = Math.round(this._s * 100) + '%';
    },

    zoomTo(s, cx, cy) {
      s = Math.max(this._min, Math.min(this._max, s));
      // 以 (cx,cy) 为锚点缩放
      const el = this.el();
      if (!el) return;
      const r = el.getBoundingClientRect();
      const prev = this._s;
      this._s = s;
      // 保持锚点对应的内容位置不动：平移补偿
      const ox = (cx != null) ? (cx - (r.left + r.width / 2)) : 0;
      const oy = (cy != null) ? (cy - (r.top + r.height / 2)) : 0;
      if (cx != null) {
        this._tx = this._tx * (s / prev) - ox * (s / prev - 1);
        this._ty = this._ty * (s / prev) - oy * (s / prev - 1);
      }
      this.apply();
    },

    zoomIn() { this.zoomTo(this._s * 1.2); },
    zoomOut() { this.zoomTo(this._s / 1.2); },
    reset() { this._s = 1; this._tx = 0; this._ty = 0; this.apply(); },

    /** 适应窗口：根据 Reveal 实际可视尺寸缩放到刚好覆盖画布区域 */
    fit() {
      const el = this.el();
      const area = $('#canvas-area');
      if (!el || !area) return;
      const er = el.getBoundingClientRect();
      const ar = area.getBoundingClientRect();
      const baseW = er.width, baseH = er.height;
      if (!baseW || !baseH) return;
      const pad = 40;
      const s = Math.min((ar.width - pad) / baseW, (ar.height - pad) / baseH, 1.5);
      this._s = Math.max(this._min, Math.min(this._max, s));
      this._tx = 0; this._ty = 0;
      this.apply();
    },

    bind() {
      if (this._bound) return;
      this._bound = true;
      // 控制条按钮
      $$('#stage-zoom-bar [data-zoom]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const z = btn.dataset.zoom;
          if (z === 'in') this.zoomIn();
          else if (z === 'out') this.zoomOut();
          else if (z === 'fit') this.fit();
          else if (z === 'reset') this.reset();
        });
      });
      const area = $('#canvas-area');
      if (area) {
        // Ctrl + 滚轮缩放
        area.addEventListener('wheel', (e) => {
          if (e.ctrlKey) {
            e.preventDefault();
            this.zoomTo(this._s * (e.deltaY < 0 ? 1.12 : 0.89), e.clientX, e.clientY);
          }
        }, { passive: false });
        // 空格 + 拖动 或 中键 拖动平移
        area.addEventListener('mousedown', (e) => {
          if (e.button === 1 || (e.button === 0 && (e.altKey || e.ctrlKey))) {
            this._drag = { sx: e.clientX, sy: e.clientY, ox: this._tx, oy: this._ty };
            e.preventDefault();
          }
        });
        window.addEventListener('mousemove', (e) => {
          if (this._drag) {
            this._tx = this._drag.ox + (e.clientX - this._drag.sx);
            this._ty = this._drag.oy + (e.clientY - this._drag.sy);
            this.apply();
          }
        });
        window.addEventListener('mouseup', () => { this._drag = null; });
      }
      this.apply();
    },
  };

  /* ===== Toolbar / left tools ===== */
  const Toolbar = {
    currentTool: 'select',

    /** Blank GeoGebra app embed URLs (verified live on geogebra.org) */
    GGB_APPS: {
      graphing: 'https://www.geogebra.org/graphing?embed',
      geometry: 'https://www.geogebra.org/geometry?embed',
      '3d': 'https://www.geogebra.org/3d?embed',
      scientific: 'https://www.geogebra.org/scientific?embed',
      classic: 'https://www.geogebra.org/classic?embed',
    },
    GGB_APP_NAMES: {
      graphing: '图形计算器',
      geometry: '几何',
      '3d': '3D 计算器',
      scientific: '科学计算器',
      classic: '经典套件',
    },

    saveSelection() {
      const sel = window.getSelection();
      if (sel.rangeCount > 0) {
        savedRange = sel.getRangeAt(0);
      }
    },

    restoreSelection() {
      if (savedRange) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
      }
    },

    exec(cmd, value) {
      this.restoreSelection();
      const sel = window.getSelection();
      if (!sel.anchorNode || !isInEditable(sel.anchorNode)) {
        const section = $$('#slides-container > section')[currentIndex];
        if (section) section.focus();
      }
      document.execCommand(cmd, false, value);
      syncCurrentSlide();
    },

    setTool(name) {
      this.currentTool = name;
      $$('[data-tool]').forEach(btn => btn.classList.toggle('active', btn.dataset.tool === name));
      if (name === 'select') return;

      // single-action tools
      switch (name) {
        case 'text': Elements.insertText(); break;
        case 'shape': this.showShapesPopover(); break;
        case 'line': Elements.insertShape('line'); break;
        case 'arrow': Elements.insertShape('arrow'); break;
        case 'iframe': $('#embed-modal').classList.remove('hidden'); break;
        case 'desmos': Elements.insertDesmos(); break;
        case 'geogebra': this.openGeogebra(); break;
        case 'ggb-suite': GgbSuite.open(); break;
        case 'table': this.openTable(); break;
        case 'icon': IconPicker.open(); break;
        case 'mathgraph': MathGraph.open(); break;
        case 'math': this.insertMath(); break;
        case 'combo-math': ComboMath.open(); break;
        case 'image': {
          const btn = document.querySelector('[data-tool="image"]');          const pop = $('#image-popover');
          if (pop && btn) {
            if (pop.classList.contains('hidden')) {
              const r = btn.getBoundingClientRect();
              pop.classList.remove('hidden');
              pop.style.left = Math.max(8, r.left) + 'px';
              pop.style.top = (r.bottom + 6) + 'px';
              this._imagePopOpen = true;
            } else { pop.classList.add('hidden'); this._imagePopOpen = false; }
          } else { this.insertImage(); }
          break;
        }
        case 'video': this.insertVideo(); break;
        case 'chart': this.openChart(); break;
        case 'pen': toast('画笔工具即将上线', 'success'); break;
      }
      // revert to select after single action
      this.setTool('select');
    },

    /** Extract a GeoGebra material ID from a URL or raw ID string */
    parseGgbId(input) {
      if (!input) return '';
      let s = String(input).trim();
      // strip query string / hash
      s = s.split('?')[0].split('#')[0];
      // https://www.geogebra.org/m/XXXX
      let m = s.match(/geogebra\.org\/m\/([^/]+)/i);
      if (m) return m[1];
      // https://www.geogebra.org/material/iframe/id/XXXX
      m = s.match(/geogebra\.org\/material\/iframe\/id\/([^/]+)/i);
      if (m) return m[1];
      // https://www.geogebra.org/classic/XXXX etc.
      m = s.match(/geogebra\.org\/(?:classic|t|w|3d|graphing|calculator)\/([^/]+)/i);
      if (m) return m[1];
      // https://www.geogebra.org/XXXX
      m = s.match(/geogebra\.org\/([^/]+)\/?$/i);
      if (m) return m[1];
      // raw id
      return s;
    },

    /** Build the embeddable GeoGebra iframe URL from a material ID.
        NOTE: GeoGebra retired the old material/iframe/id/{id} route (HTTP 410),
        the current embed scheme is https://www.geogebra.org/classic/{id}?embed */
    buildGgbUrl(id, opts) {
      let url = 'https://www.geogebra.org/classic/' + encodeURIComponent(id) + '?embed&showResetIcon=1';
      if (opts) {
        if (opts.toolbar) url += '&showToolBar=1';
        if (opts.menubar) url += '&showMenuBar=1';
        if (opts.algebra) url += '&showAlgebraInput=1';
        if (opts.zoom) url += '&enableShiftDragZoom=1';
      }
      return url;
    },

    /** Build the embeddable URL for a blank GeoGebra app */
    buildGgbAppUrl(appKey, opts) {
      const base = Toolbar.GGB_APPS[appKey];
      if (!base) return '';
      let url = base + '&showResetIcon=1';
      if (opts) {
        if (opts.toolbar) url += '&showToolBar=1';
        if (opts.menubar) url += '&showMenuBar=1';
        if (opts.algebra) url += '&showAlgebraInput=1';
        if (opts.zoom) url += '&enableShiftDragZoom=1';
      }
      return url;
    },

    /** 打开「本地 .ggb」插入选项界面，预填 base64（供套件作图器「插入当前页」复用）。
        与导入本地 .ggb 完全一致的 flow：用户勾选 工具栏/菜单栏/代数区/缩放 后点「插入」，
        confirmGeogebra() 会以 file 分支 + 这些 opts 通过 insertEmbed('ggb-file', ...) 插入。 */
    openGeogebraFile(b64, name) {
      this._ggbEditing = null;               // 纯插入，非编辑
      this._ggbFileB64 = b64 || '';
      this._ggbFileName = name || '本地 .ggb 文件';
      const setTab = (tab) => {
        $$('#geogebra-modal .tab').forEach(t => t.classList.toggle('active', t.dataset.ggbTab === tab));
        $$('#geogebra-modal [data-ggb-tab-content]').forEach(tc => tc.classList.toggle('hidden', tc.dataset.ggbTabContent !== tab));
      };
      setTab('file');
      const input = $('#geogebra-input');
      if (input) input.value = '';
      const nameEl = $('#geogebra-file-name');
      if (nameEl) nameEl.textContent = this._ggbFileName + (this._ggbFileB64 ? '（已就绪）' : '（无内容）');
      const tb = $('#ggb-toolbar'), zoom = $('#ggb-zoom'), mb = $('#ggb-menubar'), ag = $('#ggb-file-algebra');
      const ri = $('#ggb-reseticon');
      if (tb) tb.checked = true;
      if (zoom) zoom.checked = true;
      if (mb) mb.checked = false;
      if (ag) ag.checked = false;
      if (ri) ri.checked = true;
      $('#geogebra-modal').classList.remove('hidden');
    },

    /** Open the GeoGebra modal; pass an element to edit it in place */
    openGeogebra(editingEl) {
      this._ggbEditing = editingEl || null;
      const input = $('#geogebra-input');
      const tb = $('#ggb-toolbar');
      const zoom = $('#ggb-zoom');
      const mb = $('#ggb-menubar');
      const ag = $('#ggb-algebra');
      const setTab = (tab) => {
        $$('#geogebra-modal .tab').forEach(t => t.classList.toggle('active', t.dataset.ggbTab === tab));
        $$('#geogebra-modal [data-ggb-tab-content]').forEach(tc => tc.classList.toggle('hidden', tc.dataset.ggbTabContent !== tab));
      };
      $$('#geogebra-modal .ggb-app-btn').forEach(b => b.classList.remove('active'));
      if (editingEl) {
        const src = editingEl.dataset.embedSrc || '';
        const appKey = editingEl.dataset.ggbApp || '';
        const isFile = !!editingEl.dataset.ggbFile;
        if (isFile) {
          // local .ggb file: recover base64 from data-ggb-b64 attribute
          setTab('file');
          input.value = '';
          this._ggbFileB64 = editingEl.dataset.ggbB64 || '';
          this._ggbFileName = editingEl.dataset.ggbFilename || '本地 .ggb 文件';
          const nameEl = $('#geogebra-file-name');
          if (nameEl) nameEl.textContent = this._ggbFileName + (this._ggbFileB64 ? '（已加载）' : '（无内容）');
        } else if (appKey && Toolbar.GGB_APPS[appKey]) {
          // blank app mode
          setTab('app');
          const btn = $('#geogebra-modal .ggb-app-btn[data-ggb-app="' + appKey + '"]');
          if (btn) btn.classList.add('active');
          input.value = '';
        } else {
          setTab('material');
          input.value = this.parseGgbId(src);
        }
        // app/file applets store the options as data attributes; URL embeds encode
        // them in the query string — prefer the attributes, fall back to the URL.
        const ds = editingEl.dataset;
        const flag = (v) => v === undefined ? null : (v === '1');
        tb.checked = flag(ds.ggbToolbar) !== null ? flag(ds.ggbToolbar) : src.indexOf('showToolBar=1') !== -1;
        zoom.checked = flag(ds.ggbZoom) !== null ? flag(ds.ggbZoom) : src.indexOf('enableShiftDragZoom=1') !== -1;
        mb.checked = flag(ds.ggbMenubar) !== null ? flag(ds.ggbMenubar) : src.indexOf('showMenuBar=1') !== -1;
        ag.checked = flag(ds.ggbAlgebra) !== null ? flag(ds.ggbAlgebra) : src.indexOf('showAlgebraInput=1') !== -1;
      } else {
        setTab('material');
        input.value = '';
        this._ggbFileB64 = '';
        this._ggbFileName = '';
        const fInput = $('#geogebra-file');
        if (fInput) fInput.value = '';
        const fName = $('#geogebra-file-name');
        if (fName) fName.textContent = '';
        tb.checked = true;
        zoom.checked = true;
        mb.checked = false;
        ag.checked = false;
      }
      $('#geogebra-modal').classList.remove('hidden');
      input.focus();
      input.select();
    },

    /** Confirm insertion/update from the GeoGebra modal */
    confirmGeogebra() {
      const activeTab = Array.from($$('#geogebra-modal .tab')).find(t => t.classList.contains('active'));
      const isApp = !!(activeTab && activeTab.dataset.ggbTab === 'app');
      const isFile = !!(activeTab && activeTab.dataset.ggbTab === 'file');
      const opts = {
        toolbar: $('#ggb-toolbar').checked,
        zoom: $('#ggb-zoom').checked,
        menubar: $('#ggb-menubar').checked,
        // 代数区：file 标签用 ggb-file-algebra（避免与 app 标签的 ggb-algebra 重复 id
        // 导致的 `$('#ggb-algebra')` 取错元素），app/其它标签用 ggb-algebra。
        algebra: (isFile ? $('#ggb-file-algebra') : $('#ggb-algebra')).checked,
        reseticon: $('#ggb-reseticon').checked,   // 右上角「重置视图」按钮
      };
      let url = '';
      let appKey = '';
      if (isApp) {
        const activeBtn = $('#geogebra-modal .ggb-app-btn.active');
        if (!activeBtn) {
          toast('请选择要插入的空白计算器', 'error');
          return;
        }
        appKey = activeBtn.dataset.ggbApp;
        url = this.buildGgbAppUrl(appKey, opts);
        if (!url) {
          toast('无法构建计算器链接', 'error');
          return;
        }
      } else if (isFile) {
        // Use ggb-file method (GGBApplet API) instead of iframe URL with ggbBase64,
        // to avoid CloudFront 494 from long URL rejection.
        // The URL is still stored in data-embed-src for the editor's reference.
        if (!this._ggbFileB64) {
          toast('请先选择本地 .ggb 文件', 'error');
          return;
        }
        url = 'https://www.geogebra.org/classic?embed'; // informational only
      } else {
        const urlVal = $('#geogebra-input').value.trim();
        const id = this.parseGgbId(urlVal);
        if (!id) {
          toast('请填写有效的 GeoGebra 链接或 ID', 'error');
          return;
        }
        url = this.buildGgbUrl(id, opts);
      }
      if (this._ggbEditing) {
        const el = this._ggbEditing;
        if (appKey) {
          el.dataset.ggbApp = appKey;
          delete el.dataset.ggbFile;
          delete el.dataset.ggbFilename;
          delete el.dataset.ggbB64;
          el.dataset.ggbToolbar = opts.toolbar ? '1' : '0';
          el.dataset.ggbZoom = opts.zoom ? '1' : '0';
          el.dataset.ggbMenubar = opts.menubar ? '1' : '0';
          el.dataset.ggbAlgebra = opts.algebra ? '1' : '0';
          el.dataset.ggbReseticon = opts.reseticon ? '1' : '0';
        } else if (isFile) {
          el.dataset.ggbFile = '1';
          el.dataset.ggbFilename = this._ggbFileName || '本地文件';
          el.dataset.ggbB64 = this._ggbFileB64 || ''; // base64 for GGBApplet API
          delete el.dataset.ggbApp;
          el.dataset.ggbToolbar = opts.toolbar ? '1' : '0';
          el.dataset.ggbZoom = opts.zoom ? '1' : '0';
          el.dataset.ggbMenubar = opts.menubar ? '1' : '0';
          el.dataset.ggbAlgebra = opts.algebra ? '1' : '0';
          el.dataset.ggbReseticon = opts.reseticon ? '1' : '0';
        } else {
          delete el.dataset.ggbApp;
          delete el.dataset.ggbFile;
          delete el.dataset.ggbFilename;
          delete el.dataset.ggbB64;
          delete el.dataset.ggbToolbar;
          delete el.dataset.ggbZoom;
          delete el.dataset.ggbMenubar;
          delete el.dataset.ggbAlgebra;
        }
        Elements.updateEmbed(el, isFile ? 'ggb-file' : (appKey ? 'ggb-app' : 'url'), url);
        this._ggbEditing = null;
        toast('已更新 GeoGebra 小程序', 'success');
      } else {
        let extraData = {};
        if (appKey) {
          extraData.ggbApp = appKey;
          // persist the modal options so the applet renders them (and re-editing restores them)
          extraData.ggbToolbar = opts.toolbar ? '1' : '0';
          extraData.ggbZoom = opts.zoom ? '1' : '0';
          extraData.ggbMenubar = opts.menubar ? '1' : '0';
          extraData.ggbAlgebra = opts.algebra ? '1' : '0';
          extraData.ggbReseticon = opts.reseticon ? '1' : '0';
        } else if (isFile) {
          extraData.ggbFile = '1';
          extraData.ggbFilename = this._ggbFileName || '本地文件';
          extraData.ggbB64 = this._ggbFileB64 || ''; // GGBApplet API base64
          // 从套件作图器插入时保留其 app 类型（如 classic 全功能），使插入的
          // applet 与设计时视图一致。
          if (this._ggbAppName) {
            extraData.ggbApp = this._ggbAppName;
            extraData.ggbSuite = '1';   // 标记为套件插入，渲染时固定坐标视图不随宿主缩放
          }
          // 携带套件作图器当前的坐标视图范围，插入后恢复一致视图
          if (this._ggbView) extraData.ggbView = JSON.stringify(this._ggbView);
          extraData.ggbToolbar = opts.toolbar ? '1' : '0';
          extraData.ggbZoom = opts.zoom ? '1' : '0';
          extraData.ggbMenubar = opts.menubar ? '1' : '0';
          extraData.ggbAlgebra = opts.algebra ? '1' : '0';
          extraData.ggbReseticon = opts.reseticon ? '1' : '0';
        }
        // blank apps render via the GGBApplet API (like local .ggb) so they work
        // offline with the bundled engine instead of an iframe to geogebra.org
        // default position fits the current page ratio: top=30% / right=5% / width=45%
        const dims = stageDims();
        const gw = Math.max(240, Math.round(dims.w * 0.45));
        const gh = Math.round(gw * 360 / 560); // keep the classic 560×360 applet aspect
        Elements.insertEmbed(isFile ? 'ggb-file' : (appKey ? 'ggb-app' : 'url'), url, {
          left: Math.round(dims.w - gw - dims.w * 0.05), // right 5%
          top: Math.round(dims.h * 0.30),                // top 30%
          w: gw, h: gh, silent: true, extraData: extraData
        });
        toast('已插入 GeoGebra 小程序', 'success');
      }
      this._ggbFileB64 = '';
      this._ggbFileName = '';
      const ggbFileInput = $('#geogebra-file');
      if (ggbFileInput) ggbFileInput.value = '';
      const ggbFileNameEl = $('#geogebra-file-name');
      if (ggbFileNameEl) ggbFileNameEl.textContent = '';
      $('#geogebra-modal').classList.add('hidden');
    },

    showShapesPopover() {
      const pop = $('#shapes-popover');
      const btn = $('[data-tool="shape"]');
      const rect = btn.getBoundingClientRect();
      pop.style.left = (rect.left + rect.width / 2) + 'px';
      pop.style.top = (rect.bottom + 8) + 'px';
      pop.style.transform = 'translateX(-50%)';
      pop.classList.remove('hidden');
    },

    insertCodeBlock() {
      const section = Elements.currentSection();
      if (!section) return;
      const html = '<pre><code class="language-javascript" data-trim contenteditable="true">// 代码示例\nconsole.log("hello");</code></pre><p></p>';
      document.execCommand('insertHTML', false, html);
      syncCurrentSlide();
      toast('已插入代码块', 'success');
    },

    /** Open the table config modal (choose style / rows / cols), optionally editing an existing table. */
    openTable(editingEl) {
      this._tableEditing = editingEl || null;
      const cfg = editingEl ? Table.readConfig(editingEl) : null;
      $('#table-modal-title').textContent = editingEl ? '编辑表格' : '插入表格';
      $('#table-cols').value = cfg ? cfg.cols : 3;
      $('#table-rows').value = cfg ? cfg.rows : 3;
      $('#table-style').value = cfg ? cfg.style : 'striped';
      $('#table-header').value = cfg ? (cfg.header ? '1' : '0') : '1';
      $('[data-action="confirm-table"]').textContent = editingEl ? '更新' : '插入';
      this.updateTablePreview();
      $('#table-modal').classList.remove('hidden');
    },

    /** Re-render the live preview inside the table modal. */
    updateTablePreview() {
      const box = $('#table-preview');
      if (!box) return;
      const cfg = {
        cols: Math.max(1, parseInt($('#table-cols').value, 10) || 3),
        rows: Math.max(2, parseInt($('#table-rows').value, 10) || 3),
        style: $('#table-style').value,
        header: $('#table-header').value === '1',
      };
      box.innerHTML = Table.build(cfg);
    },

    /** Confirm insertion/update from the table modal. */
    confirmTable() {
      const cfg = {
        cols: Math.max(1, Math.min(8, parseInt($('#table-cols').value, 10) || 3)),
        rows: Math.max(2, Math.min(10, parseInt($('#table-rows').value, 10) || 3)),
        style: $('#table-style').value,
        header: $('#table-header').value === '1',
        content: this._tableEditing ? Table.readConfig(this._tableEditing).content : null,
      };
      if (this._tableEditing) {
        Table.apply(this._tableEditing, cfg);
        this._tableEditing = null;
        syncCurrentSlide();
        History.push();
        toast('已更新表格', 'success');
      } else {
        Elements.insertTable(cfg);
      }
      $('#table-modal').classList.add('hidden');
    },

    insertMath() {
      Toolbar.openMath();
    },

    insertImage() {
      // directly open file picker for local image
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => Elements.insertImageElement(reader.result);
        reader.readAsDataURL(file);
      };
      input.click();
    },

    /** 区域截图：Tauri 用 capture_screen（让开 LJ-PPT 截目标窗口快照，全屏遮罩框选），浏览器回退 getDisplayMedia。 */
    async captureScreen() {
      const isTauri = !!(window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke);
      if (isTauri) {
        try {
          const r = await window.__TAURI__.core.invoke('capture_screen');
          if (!(r && r.ok && r.png)) { toast('截屏失败：' + (r && r.error || '未知'), 'error'); return; }
          const img = new Image();
          await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + r.png; });
          Toolbar._shotMaximized = true;
          const overlay = $('#shot-overlay'), rect = $('#shot-rect');
          if (!overlay || !rect) { window.__TAURI__.core.invoke('restore_window', { maximized: true }); return; }
          overlay.style.background = 'none';
          overlay.style.backgroundImage = 'url(' + img.src + ')';
          overlay.style.backgroundSize = '100% 100%';
          overlay.style.backgroundRepeat = 'no-repeat';
          overlay.style.backgroundPosition = 'center';
          overlay.classList.remove('hidden'); rect.classList.add('hidden');
          const vw = window.innerWidth, vh = window.innerHeight;
          const srcW = r.width, srcH = r.height;
          let startX = 0, startY = 0, active = false, lastX = 0, lastY = 0;
          const onDown = (e) => {
            active = true; startX = e.clientX; startY = e.clientY;
            rect.style.left = startX + 'px'; rect.style.top = startY + 'px';
            rect.style.width = '0px'; rect.style.height = '0px';
            rect.classList.remove('hidden'); e.preventDefault();
          };
          const onMove = (e) => {
            if (!active) return;
            const x = Math.min(startX, e.clientX), y = Math.min(startY, e.clientY);
            const w = Math.abs(e.clientX - startX), h = Math.abs(e.clientY - startY);
            rect.style.left = x + 'px'; rect.style.top = y + 'px';
            rect.style.width = w + 'px'; rect.style.height = h + 'px';
          };
          const cleanup = () => {
            Toolbar._shotMaximized = false;
            try { window.__TAURI__.core.invoke('restore_window', { maximized: true }); } catch (e) {}
            overlay.style.backgroundImage = ''; overlay.style.background = '';
            overlay.classList.add('hidden'); rect.classList.add('hidden');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            overlay.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
          };
          const crop = () => {
            const x = Math.min(startX, lastX), y = Math.min(startY, lastY);
            const w = Math.abs(lastX - startX), h = Math.abs(lastY - startY);
            if (w < 8 || h < 8) { toast('截图区域过小，已取消', 'info'); cleanup(); return; }
            const sx = Math.round(x * srcW / vw), sy = Math.round(y * srcH / vh);
            const sw = Math.round(w * srcW / vw), sh = Math.round(h * srcH / vh);
            try {
              const canvas = document.createElement('canvas');
              canvas.width = Math.max(1, sw); canvas.height = Math.max(1, sh);
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
              const dataUrl = canvas.toDataURL('image/png');
              cleanup();
              Elements.insertImageElement(dataUrl);
              toast('已插入区域截图', 'success');
            } catch (e2) { cleanup(); toast('截图失败：' + (e2 && e2.message || e2), 'error'); }
          };
          const onUp = (e) => {
            if (!active) return; active = false; lastX = e.clientX; lastY = e.clientY;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            crop();
          };
          const onKey = (e) => { if (e.key === 'Escape') { cleanup(); toast('已取消截图', 'info'); } };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
          overlay.addEventListener('mousedown', onDown);
          document.addEventListener('keydown', onKey);
        } catch (e) { toast('截图失败：' + (e && e.message || e), 'error'); }
        return;
      }
      // 浏览器回退：getDisplayMedia 区域截图
      const overlay = $('#shot-overlay');
      const rect = $('#shot-rect');
      if (!overlay || !rect) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        toast('当前环境不支持屏幕截图（桌面 App 用原生截屏，浏览器需 getDisplayMedia）', 'error');
        return;
      }
      let stream;
      try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false }); }
      catch (e) { toast('已取消截图', 'info'); return; }
      const video = document.createElement('video');
      video.srcObject = stream; video.muted = true; video.playsInline = true;
      video.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
      document.body.appendChild(video);
      const p = video.play(); if (p && p.catch) p.catch(() => {});
      const screen = { kind: 'video', el: video, w: 0, h: 0, stop: () => stream.getTracks().forEach(t => t.stop()) };
      overlay.classList.remove('hidden'); rect.classList.add('hidden');
      const vw = window.innerWidth, vh = window.innerHeight;
      let startX = 0, startY = 0, active = false, lastX = 0, lastY = 0;
      const onDown = (e) => {
        active = true; startX = e.clientX; startY = e.clientY;
        rect.style.left = startX + 'px'; rect.style.top = startY + 'px';
        rect.style.width = '0px'; rect.style.height = '0px';
        rect.classList.remove('hidden');
        e.preventDefault();
      };
      const onMove = (e) => {
        if (!active) return;
        const x = Math.min(startX, e.clientX), y = Math.min(startY, e.clientY);
        const w = Math.abs(e.clientX - startX), h = Math.abs(e.clientY - startY);
        rect.style.left = x + 'px'; rect.style.top = y + 'px';
        rect.style.width = w + 'px'; rect.style.height = h + 'px';
      };
      const cleanup = () => {
        if (screen.stop) screen.stop();
        if (screen.el && screen.el.parentNode) screen.el.parentNode.removeChild(screen.el);
        overlay.style.backgroundImage = ''; overlay.style.background = '';
        overlay.classList.add('hidden'); rect.classList.add('hidden');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        overlay.removeEventListener('mousedown', onDown);
        document.removeEventListener('keydown', onKey);
      };
      const cropToDataUrl = () => {
        const x = Math.min(startX, lastX), y = Math.min(startY, lastY);
        const w = Math.abs(lastX - startX), h = Math.abs(lastY - startY);
        if (w < 8 || h < 8) { toast('截图区域过小，已取消', 'info'); cleanup(); return; }
        const draw = () => {
          const srcW = screen.el.videoWidth, srcH = screen.el.videoHeight;
          if (!srcW || !srcH || screen.el.readyState < 2) { setTimeout(draw, 150); return; }
          const sx = Math.round(x * srcW / vw), sy = Math.round(y * srcH / vh);
          const sw = Math.round(w * srcW / vw), sh = Math.round(h * srcH / vh);
          try {
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, sw); canvas.height = Math.max(1, sh);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(screen.el, sx, sy, sw, sh, 0, 0, sw, sh);
            const dataUrl = canvas.toDataURL('image/png');
            cleanup();
            Elements.insertImageElement(dataUrl);
            toast('已插入区域截图', 'success');
          } catch (e2) { cleanup(); toast('截图失败：' + (e2 && e2.message || e2), 'error'); }
        };
        draw();
      };
      const onUp = (e) => {
        if (!active) return; active = false; lastX = e.clientX; lastY = e.clientY;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        cropToDataUrl();
      };
      const onKey = (e) => { if (e.key === 'Escape') { cleanup(); toast('已取消截图', 'info'); } };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      overlay.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
    },

    insertVideo() {
      // open the video modal (本地视频 or 在线 URL / 嵌入代码)
      $('#video-file').value = '';
      $('#video-file-name').textContent = '未选择文件';
      $('#video-url').value = '';
      $('#video-modal').classList.remove('hidden');
    },

    /** Confirm insertion from the video modal. */
    confirmVideo() {
      const fileInput = $('#video-file');
      const file = fileInput && fileInput.files && fileInput.files[0];
      const url = $('#video-url').value.trim();

      if (file && file.size > 0) {
        // 本地视频：读成 data URL，走 data-type="video" 的 <video> 元素
        if (!/^video\//.test(file.type) && !/\.(mp4|webm|ogv|mov|m4v|avi|mkv)$/i.test(file.name)) {
          toast('请选择常见的视频文件（mp4 / webm / ogv / mov 等）', 'error');
          return;
        }
        if (file.size > 60 * 1024 * 1024) {
          toast('视频过大（> 60 MB），本地嵌入会占用大量空间，建议改用在线 URL', 'error');
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          Elements.insertVideo(reader.result, true, file.name);
          $('#video-modal').classList.add('hidden');
        };
        reader.onerror = () => toast('读取视频失败', 'error');
        reader.readAsDataURL(file);
        return;
      }

      if (url) {
        Elements.insertVideo(url, false, url);
        $('#video-modal').classList.add('hidden');
        return;
      }

      toast('请选择本地视频或填写 URL/嵌入代码', 'error');
    },

    /* ===== Chart modal ===== */

    /** Open the chart modal; pass an element to edit it in place */
    openChart(editingEl) {
      this._chartEditing = editingEl || null;
      const typeSel = $('#chart-type');
      const palSel = $('#chart-palette');
      const titleInp = $('#chart-title');
      const labelsInp = $('#chart-labels');
      const valuesInp = $('#chart-values');
      if (editingEl) {
        const cfg = Charts.readConfig(editingEl);
        typeSel.value = cfg.type;
        palSel.value = cfg.palette;
        titleInp.value = cfg.title;
        labelsInp.value = cfg.labels.join(', ');
        valuesInp.value = cfg.values.join(', ');
        $('[data-action="confirm-chart"]').textContent = '更新';
      } else {
        typeSel.value = 'bar';
        palSel.value = 'default';
        titleInp.value = '季度销售额';
        labelsInp.value = 'Q1, Q2, Q3, Q4';
        valuesInp.value = '120, 190, 150, 240';
        $('[data-action="confirm-chart"]').textContent = '插入';
      }
      this.updateChartPreview();
      $('#chart-modal').classList.remove('hidden');
      labelsInp.focus();
    },

    /** Re-render the live preview inside the chart modal */
    updateChartPreview() {
      const box = $('#chart-preview');
      if (!box) return;
      const parsed = Charts.parseInput($('#chart-labels').value, $('#chart-values').value);
      const cfg = {
        type: $('#chart-type').value,
        palette: $('#chart-palette').value,
        title: $('#chart-title').value.trim(),
        labels: parsed.labels,
        values: parsed.values,
      };
      box.innerHTML = Charts.buildSVG(cfg);
    },

    /** Confirm insertion/update from the chart modal */
    confirmChart() {
      const parsed = Charts.parseInput($('#chart-labels').value, $('#chart-values').value);
      if (!parsed.values.length) {
        toast('请至少填写一个数值', 'error');
        return;
      }
      // pie-like charts need labels trimmed to values length
      const cfg = {
        type: $('#chart-type').value,
        palette: $('#chart-palette').value,
        title: $('#chart-title').value.trim(),
        labels: parsed.labels,
        values: parsed.values,
      };
      if (this._chartEditing) {
        Charts.apply(this._chartEditing, cfg);
        this._chartEditing = null;
        syncCurrentSlide();
        History.push();
        toast('已更新图表', 'success');
      } else {
        Elements.insertChart(cfg);
      }
      $('#chart-modal').classList.add('hidden');
    },


    /* ===== Math formula modal ===== */
    _mathEditing: null,
    _mathSelectedFormula: '',
    _mathColor: '#000000',

    openMath(editingEl) {
      this._mathEditing = editingEl || null;
      const input = $('#math-input');
      // clear active preset
      $$('.math-preset').forEach(b => b.classList.remove('active'));
      if (editingEl) {
        const formula = editingEl.dataset.formula || '';
        this._mathSelectedFormula = formula;
        input.value = formula;
        if (formula) {
          // try match a preset
          $$('.math-preset').forEach(b => {
            if (b.dataset.formula === formula) b.classList.add('active');
          });
        }
        this._mathColor = editingEl.dataset.color || '#000000';
      } else {
        this._mathSelectedFormula = '';
        input.value = '';
        this._mathColor = '#000000';
      }
      this._syncMathColorUI();
      this.updateMathPreview();
      $('#math-modal').classList.remove('hidden');
      input.focus();
    },

    _syncMathColorUI() {
      const color = (this._mathColor || '#000000').toLowerCase();
      $$('.color-swatch').forEach(b => {
        b.classList.toggle('active', !!b.dataset.color && b.dataset.color.toLowerCase() === color);
      });
      const custom = $('#math-color-custom');
      if (custom) custom.value = this._mathColor || '#000000';
    },

    updateMathPreview() {
      const preview = $('#math-preview');
      if (!preview) return;
      const formula = this._mathSelectedFormula || $('#math-input').value.trim();
      preview.style.color = this._mathColor || '#000000';
      preview.innerHTML = '';
      if (!formula) {
        preview.innerHTML = '<span style="color:var(--text-tertiary);font-size:0.7em;">选择预置公式或输入自定义 LaTeX（每行一个）</span>';
        return;
      }
      // split into lines for a stacked multi-formula preview
      const lines = String(formula).split(/[\n\r]+|;;|；|;/).map(s => s.trim()).filter(Boolean);
      const frag = document.createDocumentFragment();
      lines.forEach((ln) => {
        const span = document.createElement('span');
        span.textContent = mathProcessInput(ln);
        span.style.display = 'block';
        span.style.margin = '6px 0';
        frag.appendChild(span);
      });
      preview.appendChild(frag);
      if (window.MathJax && window.MathJax.typesetPromise) {
        window.MathJax.typesetPromise([preview]).catch(() => {});
      }
    },

    confirmMath(keepOpen) {
      const input = $('#math-input');
      const raw = this._mathEditing ? input.value : (input.value.trim() ? input.value : this._mathSelectedFormula);
      const color = this._mathColor || '#000000';
      // 拆分：先按换行分行（每行垂直往下），行内再用 ;；;; 分多个公式（横向并排）。
      // 这样既能「一行输入多个公式」（横向一排），也能「多行输入」（逐行下移）。
      const sections = String(raw || '')
        .split(/[\n\r]+/)
        .map(sec => String(sec).split(/(?<!\\);|；|;;/).map(s => s.trim()).filter(Boolean))
        .filter(sec => sec.length);
      const formulas = [];
      sections.forEach((sec) => { sec.forEach((f) => formulas.push(f)); });
      if (!formulas.length) { toast('请选择或输入公式', 'error'); return; }
      // 非编辑某个公式时，插入前必须存在当前页；否则静默跳过会导致「提示已插入但没插入」。
      if (!this._mathEditing && !Elements.currentSection()) {
        toast('请先进入一个页面再插入公式', 'error');
        return;
      }

      const insertOne = (formula, row, col, rowsInRow, colsInRow) => {
        const processed = mathProcessInput(formula);
        const hasInline = processed.indexOf('\\(') !== -1;
        if (this._mathEditing) {
          const el = this._mathEditing;
          el.dataset.formula = formula;
          el.dataset.color = color;
          if (hasInline) el.dataset.mathInline = '1';
          else delete el.dataset.mathInline;
          const mathDiv = el.querySelector('.el-math');
          if (mathDiv) {
            mathDiv.style.color = color;
            mathDiv.innerHTML = escHTML(processed);
            renderMathThenSync(el);
          }
          syncCurrentSlide();
          this._mathEditing = null;
          return;
        }
        // insert new math element (auto-stack multiple formulas)
        const section = Elements.currentSection();
        if (!section) return;
        const eid = 'el_' + uid();
        // 排布：同一行内多个公式横向并排（left 递增），不同行垂直下移（top 递增）。
        // 若一行只有一个公式，则垂直方向继续；多公式时横向铺开并适度收缩宽度。
        const baseTop = 210, rowStep = 110, colStep = 210;
        const baseLeft = 300;
        const top = baseTop + row * rowStep;
        const left = baseLeft + col * (colsInRow > 1 ? colStep : 0);
        const w = colsInRow > 1 ? Math.max(180, 520 - col * 40) : 520;
        const html =
          '<div class="slide-element" data-type="math" data-eid="' + eid + '"' +
          ' data-formula="' + escAttr(formula) + '"' +
          (hasInline ? ' data-math-inline="1"' : '') +
          ' data-color="' + escAttr(color) + '"' +
          ' contenteditable="false"' +
          ' style="position:absolute;left:' + left + 'px;top:' + top + 'px;width:' + w + 'px;height:90px;">' +
          '<div class="el-math" style="color:' + escAttr(color) + '">' + escHTML(processed) + '</div>' +
          '</div>';
        section.insertAdjacentHTML('beforeend', html);
        const el = section.querySelector('[data-eid="' + eid + '"]');
        if (el) {
          Elements.bindElement(el);
          if (row === 0 && col === 0) Elements.select(el);
          renderMathThenSync(el);
        }
      };

      sections.forEach((sec, row) => {
        const colsInRow = sec.length;
        sec.forEach((f, col) => insertOne(f, row, col, 0, colsInRow));
      });
      syncCurrentSlide();
      History.push();
      if (!keepOpen) {
        $('#math-modal').classList.add('hidden');
      } else {
        // 连续插入多个：保留弹窗与输入内容（供查看/继续编辑），仅清选中高亮并聚焦
        $$('.math-preset').forEach(b => b.classList.remove('active'));
        if (input) input.focus();
      }
      toast(formulas.length > 1 ? '已插入 ' + formulas.length + ' 个公式' : '已插入数学公式', 'success');
    },



    bind() {
      // left toolbar tool buttons
      $$('[data-tool]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.setTool(btn.dataset.tool);
        });
      });

      // shape popover
      $$('.shape-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          $('#shapes-popover').classList.add('hidden');
          if (btn.dataset.shape === 'freeform') {
            Elements.startFreeform();
          } else {
            Elements.insertShape(btn.dataset.shape);
          }
        });
      });

      // image popover (本地图片 / 在线图片库)
      $$('#image-popover [data-img-act]').forEach((btn) => {
        btn.addEventListener('click', () => {
          $('#image-popover').classList.add('hidden');
          if (Toolbar._imagePopOpen) Toolbar._imagePopOpen = false;
          const act = btn.dataset.imgAct;
          if (act === 'local') Toolbar.insertImage();
          else if (act === 'gallery') Gallery.open();
          else if (act === 'screenshot') { if (typeof Toolbar.captureScreen === 'function') Toolbar.captureScreen(); else toast('截图功能不可用', 'error'); }
        });
      });
      // close popover when clicking elsewhere
      document.addEventListener('click', (e) => {
        if (Toolbar._imagePopOpen &&
            !e.target.closest('#image-popover') &&
            !e.target.closest('[data-tool="image"]')) {
          $('#image-popover').classList.add('hidden');
          Toolbar._imagePopOpen = false;
        }
      });

      // online image gallery (event delegation so any .gallery-cat works)
      $$('[data-action="close-gallery"]').forEach(btn => btn.addEventListener('click', () => Gallery.close()));
      $('#gallery-modal .modal-backdrop').addEventListener('click', () => Gallery.close());
      $('#gallery-cats').addEventListener('click', (e) => {
        const btn = e.target.closest('.gallery-cat');
        if (btn) { const c = btn.dataset.cat; Gallery.render(c); }
      });
      $('#gallery-search-btn').addEventListener('click', () => {
        const q = $('#gallery-search').value.trim();
        Gallery.render(Gallery._curCat, q || null);
      });
      $('#gallery-search').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); $('#gallery-search-btn').click(); }
      });
      $('#gallery-random').addEventListener('click', () => {
        const ks = ['math','geometry','nature','tech','pattern','abstract','wave','grid','science','color','school','people','city','food','sport','animal','design','light','water','mountain','student','teacher','book','minimal']; 
        const k = ks[Math.floor(Math.random() * ks.length)];
        Gallery.render(Gallery._curCat, k);
      });
      $('#gallery-grid').addEventListener('click', (e) => {
        const item = e.target.closest('.gallery-item');
        if (item) Gallery.insert(item.dataset.src);
      });

      // embed modal
      $$('[data-action="close-embed"]').forEach(btn => {
        btn.addEventListener('click', () => {
          $('#embed-modal').classList.add('hidden');
          Elements._editingEmbed = null;
        });
      });

      // geogebra modal
      $$('[data-action="close-geogebra"]').forEach(btn => {
        btn.addEventListener('click', () => {
          $('#geogebra-modal').classList.add('hidden');
          Toolbar._ggbEditing = null;
          Toolbar._ggbFileB64 = '';
          Toolbar._ggbFileName = '';
          const ggbCloseFile = $('#geogebra-file');
          if (ggbCloseFile) ggbCloseFile.value = '';
          const ggbCloseName = $('#geogebra-file-name');
          if (ggbCloseName) ggbCloseName.textContent = '';
        });
      });
      $('[data-action="confirm-geogebra"]').addEventListener('click', () => Toolbar.confirmGeogebra());
      const ggbInput = $('#geogebra-input');
      if (ggbInput) {
        ggbInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') Toolbar.confirmGeogebra();
        });
      }
      $$('#geogebra-modal .tab').forEach(tab => {
        tab.addEventListener('click', () => {
          $$('#geogebra-modal .tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          $$('#geogebra-modal [data-ggb-tab-content]').forEach(tc => tc.classList.add('hidden'));
          const target = $('[data-ggb-tab-content="' + tab.dataset.ggbTab + '"]', $('#geogebra-modal'));
          if (target) target.classList.remove('hidden');
        });
      });
      $$('#geogebra-modal .ggb-app-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          $$('#geogebra-modal .ggb-app-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });

      // ggb-suite (作图器) modal
      $$('[data-action="close-ggb-suite"]').forEach(btn => {
        btn.addEventListener('click', () => GgbSuite.close());
      });
      $('[data-action="ggb-suite-save"]').addEventListener('click', () => GgbSuite.save());
      $('[data-action="ggb-suite-insert"]').addEventListener('click', () => GgbSuite.insert());
      $('#ggb-suite-modal').addEventListener('change', (e) => {
        // 切 app 类型 → 直接重建；工具栏/菜单栏/代数区/缩放 选项改变 →
        // 重载但保留作图内容（reloadKeepContent 会先保存 base64 再恢复），
        // 这样重新勾选这些选项时 applet 能立即显示对应 UI。
        if (e.target && e.target.id === 'ggb-suite-app') {
          GgbSuite.render();
        } else if (e.target && (
          e.target.id === 'ggb-suite-toolbar' ||
          e.target.id === 'ggb-suite-menubar' ||
          e.target.id === 'ggb-suite-algebra' ||
          e.target.id === 'ggb-suite-zoom'
        )) {
          GgbSuite.reloadKeepContent();
        }
      });
      const ggbFileInput = $('#geogebra-file');
      if (ggbFileInput) {
        ggbFileInput.addEventListener('change', () => {
          const f = ggbFileInput.files && ggbFileInput.files[0];
          const nameEl = $('#geogebra-file-name');
          if (!f) {
            Toolbar._ggbFileB64 = '';
            Toolbar._ggbFileName = '';
            if (nameEl) nameEl.textContent = '';
            return;
          }
          if (f.size > 1024 * 1024) {
            toast('文件过大（超过 1MB），建议精简素材后重新导出', 'error');
            Toolbar._ggbFileB64 = '';
            Toolbar._ggbFileName = '';
            if (nameEl) nameEl.textContent = '';
            ggbFileInput.value = '';
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = String(reader.result || '');
            const comma = dataUrl.indexOf(',');
            Toolbar._ggbFileB64 = comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl;
            Toolbar._ggbFileName = f.name;
            if (nameEl) nameEl.textContent = f.name + '（' + (f.size / 1024).toFixed(1) + ' KB，已转码为 base64）';
          };
          reader.onerror = () => {
            toast('读取文件失败，请重试', 'error');
            Toolbar._ggbFileB64 = '';
            Toolbar._ggbFileName = '';
          };
          reader.readAsDataURL(f);
        });
      }
      const ggbEditBtn = $('[data-action="el-edit-geogebra"]');
      if (ggbEditBtn) {
        ggbEditBtn.addEventListener('click', () => {
          if (this.selected) Toolbar.openGeogebra(this.selected);
        });
      }


      // chart modal
      $$('[data-action="close-chart"]').forEach(btn => {
        btn.addEventListener('click', () => $('#chart-modal').classList.add('hidden'));
      });
      $('[data-action="confirm-chart"]').addEventListener('click', () => Toolbar.confirmChart());

      ['chart-type', 'chart-palette', 'chart-title', 'chart-labels', 'chart-values'].forEach(id => {
        const inp = $('#' + id);
        if (inp) {
          inp.addEventListener('input', () => Toolbar.updateChartPreview());
          inp.addEventListener('change', () => Toolbar.updateChartPreview());
        }
      });
      ['chart-title', 'chart-labels', 'chart-values'].forEach(id => {
        const inp = $('#' + id);
        if (inp) inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') Toolbar.confirmChart();
        });
      });

      // table modal
      $$('[data-action="close-table"]').forEach(btn => btn.addEventListener('click', () => $('#table-modal').classList.add('hidden')));
      $('[data-action="confirm-table"]').addEventListener('click', () => Toolbar.confirmTable());
      ['table-cols', 'table-rows', 'table-style', 'table-header'].forEach(id => {
        const inp = $('#' + id);
        if (inp) inp.addEventListener('input', () => Toolbar.updateTablePreview());
      });
      // props panel "edit table" button
      const editTableBtn = $('#el-edit-table');
      if (editTableBtn) editTableBtn.addEventListener('click', () => { if (Elements.selected) Toolbar.openTable(Elements.selected); });

      // icon modal
      $$('[data-action="close-icon"]').forEach(btn => btn.addEventListener('click', () => $('#icon-modal').classList.add('hidden')));
      $('#icon-grid').addEventListener('click', (e) => {
        const item = e.target.closest('[data-icon]');
        if (item) Elements.insertIcon(item.dataset.icon);
      });

      // mathgraph modal
      $$('[data-action="close-mathgraph"]').forEach(btn => btn.addEventListener('click', () => MathGraph.close()));
      $('#mathgraph-tabs').addEventListener('click', (e) => {
        const tab = e.target.closest('[data-mg-cat]');
        if (tab) MathGraph.render(tab.dataset.mgCat);
      });
      $('#mathgraph-grid').addEventListener('click', (e) => {
        const card = e.target.closest('[data-mg-insert]');
        if (card) MathGraph.insert(card.dataset.mgInsert);
      });

      // video modal
      $$('[data-action="close-video"]').forEach(btn => btn.addEventListener('click', () => $('#video-modal').classList.add('hidden')));
      $('[data-action="confirm-video"]').addEventListener('click', () => Toolbar.confirmVideo());
      $('#video-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') Toolbar.confirmVideo(); });
      $('#video-file').addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        const nameEl = $('#video-file-name');
        if (nameEl && f) {
          const kb = Math.round(f.size / 1024);
          nameEl.textContent = f.name + '（' + (kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB') + '）';
        }
      });

      // math modal
      $$('[data-action="close-math"]').forEach(btn => {
        btn.addEventListener('click', () => $('#math-modal').classList.add('hidden'));
      });
      $('[data-action="confirm-math"]').addEventListener('click', () => Toolbar.confirmMath());
      // 组合公式 modal：关闭 / 插入 / 预览 / 颜色
      $$('[data-action="close-combo-math"]').forEach(btn => btn.addEventListener('click', () => ComboMath.close()));
      $('[data-action="confirm-combo-math"]').addEventListener('click', () => ComboMath.insert());
      const clearCmBtn = $('[data-action="clear-combo-math"]');
      if (clearCmBtn) clearCmBtn.addEventListener('click', () => ComboMath.clear());
      // 试卷/讲义模式
      $$('[data-action="close-paper"]').forEach(b => b.addEventListener('click', () => PaperMode.close()));
      const paperSave = $('[data-action="paper-save-pdf"]');
      if (paperSave) paperSave.addEventListener('click', () => PaperMode.savePdf());
      const paperImgBtn = $('[data-action="paper-insert-image"]');
      if (paperImgBtn) paperImgBtn.addEventListener('click', () => PaperMode.insertImage());
      const paperInsert = $('[data-action="paper-insert"]');
      if (paperInsert) paperInsert.addEventListener('click', () => PaperMode.insertCurrent());
      const paperClear = $('[data-action="paper-clear"]');
      if (paperClear) paperClear.addEventListener('click', () => PaperMode.clear());
      // 右侧 A4 预览缩放
      const zIn = $('[data-action="paper-zoom-in"]'); if (zIn) zIn.addEventListener('click', () => PaperMode.zoom(0.1));
      const zOut = $('[data-action="paper-zoom-out"]'); if (zOut) zOut.addEventListener('click', () => PaperMode.zoom(-0.1));
      const zReset = $('[data-action="paper-zoom-reset"]'); if (zReset) zReset.addEventListener('click', () => PaperMode.zoom(0, 1));
      const paperInput = $('#paper-input');
      if (paperInput) paperInput.addEventListener('input', () => PaperMode.render());
      // 输入框编辑按钮（复制/粘贴/剪切/全选/撤销/重做）
      const execCmd = (cmd) => { const t = $('#paper-input'); if (t) { t.focus(); try { document.execCommand(cmd); } catch (e) {} } };
      const bindCmd = (sel, cmd) => { const b = $(sel); if (b) b.addEventListener('click', () => { execCmd(cmd); PaperMode.render(); }); };
      bindCmd('[data-action="paper-cut"]', 'cut');
      bindCmd('[data-action="paper-copy"]', 'copy');
      bindCmd('[data-action="paper-paste"]', 'paste');
      bindCmd('[data-action="paper-select-all"]', 'selectAll');
      bindCmd('[data-action="paper-undo"]', 'undo');
      bindCmd('[data-action="paper-redo"]', 'redo');
      const panelFontSync = () => { PaperMode.applyFont(); };
      const paperTpl = $('#paper-template');
      if (paperTpl) paperTpl.addEventListener('change', () => { PaperMode.applyTemplate(paperTpl.value); panelFontSync(); });
      // 字体控制 → applyFont
      ['#paper-font-family', '#paper-font-size', '#paper-font-color'].forEach(sel => {
        const c = $(sel);
        if (c) c.addEventListener('input', () => PaperMode.applyFont());
      });
      // 排版细节 → applyLayout + 重渲染（分页随行距/段落变化）
      ['#paper-lh', '#paper-para', '#paper-indent', '#paper-h2'].forEach(sel => {
        const c = $(sel);
        if (c) c.addEventListener('input', () => { PaperMode.applyLayout(); PaperMode.render(); });
      });
      const numStyle = $('#paper-numstyle');
      if (numStyle) numStyle.addEventListener('change', () => { PaperMode._numStyle = numStyle.value; PaperMode.render(); });
      const cmInput = $('#combo-math-input');
      if (cmInput) cmInput.addEventListener('input', () => ComboMath.updatePreview());
      ['#combo-math-multiline', '#combo-math-autowrap'].forEach(sel => {
        const c = $(sel);
        if (c) c.addEventListener('change', () => ComboMath.updatePreview());
      });
      // 预设组合按钮
      $$('[data-combo-preset]').forEach(btn => {
        btn.addEventListener('click', () => ComboMath.applyPreset(btn.dataset.comboPreset));
      });
      const cmColorRow = $('#combo-math-color-row');
      if (cmColorRow) {
        cmColorRow.addEventListener('click', (e) => {
          const sw = e.target.closest('.color-swatch');
          if (!sw) return;
          ComboMath._color = sw.dataset.color;
          cmColorRow.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('active'));
          sw.classList.add('active');
          ComboMath.updatePreview();
        });
      }
      const cmCustom = $('#combo-math-color-custom');
      if (cmCustom) cmCustom.addEventListener('input', () => { ComboMath._color = cmCustom.value; ComboMath.updatePreview(); });
      const cmSize = $('#combo-math-size');
      if (cmSize) cmSize.addEventListener('input', () => { ComboMath._fontSize = parseFloat(cmSize.value) || 18; ComboMath.updatePreview(); });
      const cmFont = $('#combo-math-font');
      if (cmFont) cmFont.addEventListener('change', () => { ComboMath._fontFamily = cmFont.value; ComboMath.updatePreview(); });
      const cmBgRow = $('#combo-math-bg-row');
      if (cmBgRow) cmBgRow.addEventListener('click', (e) => {
        const sw = e.target.closest('.color-swatch');
        if (!sw) return;
        ComboMath._bgColor = sw.dataset.color;
        cmBgRow.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('active'));
        sw.classList.add('active');
        ComboMath.updatePreview();
      });
      // preset buttons: 单击 → 追加该预制公式到输入框（用逗号连接，合成一个公式），
      // 多次点击累积成一段连贯的 LaTeX；插入时作为一个公式渲染。双击 → 只放这一个并预览。
      $$('.math-preset').forEach(btn => {
        btn.addEventListener('click', () => {
          const input = $('#math-input');
          const f = btn.dataset.formula;
          // 若输入框为空则直接填入；否则用逗号连接（合成一个公式）
          const cur = input ? input.value.trim() : '';
          const sep = cur ? (cur.endsWith(',') ? '' : ',') : '';
          if (input) input.value = cur + sep + f;
          Toolbar._mathSelectedFormula = input ? input.value : f;
          Toolbar.updateMathPreview();
        });
        btn.addEventListener('dblclick', () => {
          Toolbar._mathSelectedFormula = btn.dataset.formula;
          $('#math-input').value = btn.dataset.formula;
          Toolbar.updateMathPreview();
          Toolbar.confirmMath(true); // 插入并保持弹窗打开，可继续双击下一个预制
        });
      });
      // custom input
      const mathInput = $('#math-input');
      if (mathInput) {
        mathInput.addEventListener('input', () => {
          Toolbar._mathSelectedFormula = mathInput.value;
          $$('.math-preset').forEach(b => b.classList.remove('active'));
          Toolbar.updateMathPreview();
        });
        mathInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') Toolbar.confirmMath();
        });
      }
      // color swatches
      $$('.color-swatch').forEach(sw => {
        sw.addEventListener('click', () => {
          Toolbar._mathColor = sw.dataset.color || '#000000';
          Toolbar._syncMathColorUI();
          Toolbar.updateMathPreview();
        });
      });
      const mathColorCustom = $('#math-color-custom');
      if (mathColorCustom) {
        mathColorCustom.addEventListener('input', () => {
          Toolbar._mathColor = mathColorCustom.value;
          Toolbar._syncMathColorUI();
          Toolbar.updateMathPreview();
        });
      }
      $$('#embed-modal .tab').forEach((tab) => {
        tab.addEventListener('click', () => {
          $$('#embed-modal .tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          $$('#embed-modal .tab-content').forEach(tc => tc.classList.add('hidden'));
          $('[data-tab-content="' + tab.dataset.tab + '"]', $('#embed-modal')).classList.remove('hidden');
        });
      });
      $('[data-action="confirm-embed"]').addEventListener('click', () => {
        const commit = (method, content) => {
          if (Elements._editingEmbed) {
            Elements.updateEmbed(Elements._editingEmbed, method, content);
            Elements._editingEmbed = null;
          } else {
            Elements.insertEmbed(method, content);
          }
        };
        const activeTab = Array.from($$('#embed-modal .tab')).find(t => t.classList.contains('active'));
        if (!activeTab) return;
        const tabName = activeTab.dataset.tab;
        const hideModal = () => $('#embed-modal').classList.add('hidden');
        if (tabName === 'url') {
          const url = $('#embed-url').value.trim();
          if (url) {
            commit('url', url);
            hideModal();
            $('#embed-url').value = '';
          } else {
            toast('请输入 URL', 'error');
          }
        } else if (tabName === 'code') {
          const code = $('#embed-code').value.trim();
          if (code) {
            commit('code', code);
            hideModal();
            $('#embed-code').value = '';
          } else {
            toast('请输入 HTML 代码', 'error');
          }
        } else if (tabName === 'file') {
          const input = $('#embed-file');
          if (input.files && input.files[0]) {
            const file = input.files[0];
            const reader = new FileReader();
            reader.onload = () => {
              commit('code', reader.result);
              hideModal();
              input.value = '';
            };
            reader.readAsText(file);
          } else {
            toast('请选择文件', 'error');
          }
        } else if (tabName === 'pdf') {
          const fileInput = $('#embed-pdf-file');
          const urlVal = $('#embed-pdf-url').value.trim();
          if (fileInput.files && fileInput.files[0]) {
            const file = fileInput.files[0];
            if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
              toast('请选择 PDF 文件', 'error');
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              commit('pdf', reader.result);
              hideModal();
              fileInput.value = '';
              $('#embed-pdf-url').value = '';
            };
            reader.readAsDataURL(file);
          } else if (urlVal) {
            commit('pdf', urlVal);
            hideModal();
            $('#embed-pdf-url').value = '';
          } else {
            toast('请选择 PDF 文件或输入 URL', 'error');
          }
        }
      });

      // top bar actions
      $('[data-action="new"]').addEventListener('click', () => newPresentation());
      $('[data-action="open"]').addEventListener('click', () => openFile());
      $('[data-action="save"]').addEventListener('click', () => saveProject());
      $('[data-action="export"]').addEventListener('click', (e) => {
        const menu = $('#export-menu');
        if (!menu) return;
        if (menu.classList.contains('hidden')) {
          const r = e.currentTarget.getBoundingClientRect();
          menu.classList.remove('hidden');
          menu.style.left = Math.max(8, r.right - 180) + 'px';
          menu.style.top = (r.bottom + 6) + 'px';
        } else {
          menu.classList.add('hidden');
        }
      });
      $$('#export-menu [data-export]').forEach(item => {
        item.addEventListener('click', () => {
          $('#export-menu').classList.add('hidden');
          const kind = item.dataset.export;
          if (kind === 'html') Exporter.exportHTML();
          else if (kind === 'pdf') Exporter.exportPDF();
          else if (kind === 'png') Exporter.exportPng();
          else if (kind === 'paper') PaperMode.open();
        });
      });

      // help menu (top bar) + about / usage-help modals
      $('[data-action="help"]').addEventListener('click', (e) => {
        const menu = $('#help-menu');
        if (!menu) return;
        if (menu.classList.contains('hidden')) {
          const r = e.currentTarget.getBoundingClientRect();
          menu.classList.remove('hidden');
          menu.style.left = Math.max(8, r.right - 180) + 'px';
          menu.style.top = (r.bottom + 6) + 'px';
        } else {
          menu.classList.add('hidden');
        }
      });
      $$('#help-menu [data-help]').forEach(item => {
        item.addEventListener('click', () => {
          $('#help-menu').classList.add('hidden');
          const kind = item.dataset.help;
          if (kind === 'about') { $('#about-modal').classList.remove('hidden'); }
          else if (kind === 'usage') { $('#help-modal').classList.remove('hidden'); }
        });
      });
      $$('[data-action="close-about"]').forEach(btn => btn.addEventListener('click', () => $('#about-modal').classList.add('hidden')));
      $('#about-modal .modal-backdrop').addEventListener('click', () => $('#about-modal').classList.add('hidden'));
      $$('[data-action="close-help"]').forEach(btn => btn.addEventListener('click', () => $('#help-modal').classList.add('hidden')));
      $('#help-modal .modal-backdrop').addEventListener('click', () => $('#help-modal').classList.add('hidden'));

      // export folder picker modal
      $$('[data-action="close-export-folder"], [data-action="cancel-export-folder"]').forEach(btn => {
        btn.addEventListener('click', () => ExportDialog.close());
      });
      $$('[data-action="save-export-folder"]').forEach(btn => {
        btn.addEventListener('click', () => ExportDialog.save());
      });
      $('#export-folder-list').addEventListener('click', (e) => {
        const item = e.target.closest('[data-dir]');
        if (item) ExportDialog.load(item.dataset.dir);
      });
      $('#export-folder-filename').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') ExportDialog.save();
      });
      $('#export-folder-modal .modal-backdrop').addEventListener('click', () => ExportDialog.close());
      $('[data-action="present"]').addEventListener('click', () => enterPresent());
      PresentControls.bind();
      $('[data-action="add-slide"]').addEventListener('click', () => LayoutPicker.open());
      $('[data-action="template-library"]').addEventListener('click', () => TemplateLibrary.open());
      $('[data-action="versions"]').addEventListener('click', () => VersionControl.open());
      $('[data-action="paper"]').addEventListener('click', () => PaperMode.open());
      // 图像运算
      $$('[data-action="close-versions"]').forEach(btn => btn.addEventListener('click', () => VersionControl.close()));
      const versionSaveBtn = $('#version-save');
      if (versionSaveBtn) versionSaveBtn.addEventListener('click', () => {
        const snap = VersionControl.save();
        VersionControl.render();
        if (snap) toast('已保存当前版本', 'success');
      });
      const versionList = $('#versions-list');
      if (versionList) versionList.addEventListener('click', (e) => {
        const rbtn = e.target.closest('[data-vrestore]');
        if (rbtn) {
          VersionControl.restore(rbtn.dataset.vrestore);
          VersionControl.close();
          return;
        }
        const dbtn = e.target.closest('[data-vdelete]');
        if (dbtn) {
          AppConfirm('删除该版本？此操作不可撤销。', '确认删除').then(function (ok) {
            if (ok) {
              VersionControl.remove(dbtn.dataset.vdelete);
              VersionControl.render();
            }
          });
        }
      });

      // template library modal
      $$('[data-action="close-template"]').forEach(btn => btn.addEventListener('click', () => TemplateLibrary.close()));
      $$('#template-modal .template-tabs .tab').forEach(tab => {
        tab.addEventListener('click', () => TemplateLibrary.render(tab.dataset.tcat));
      });
      $$('#template-theme-bar .theme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          TemplateLibrary.activeTheme = btn.dataset.theme;
          TemplateLibrary.activeStyle = '';
          const sel = $('#template-style');
          if (sel) sel.value = '';
          $$('#template-theme-bar .theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === btn.dataset.theme));
          TemplateLibrary.render('pro');
          // 主题色分组随模板主题联动刷新
          rebuildSwatchPalettes();
        });
      });
      const styleSel = $('#template-style');
      if (styleSel) {
        styleSel.addEventListener('change', () => {
          TemplateLibrary.activeStyle = styleSel.value || '';
          TemplateLibrary.render('pro');
          rebuildSwatchPalettes();
        });
      }
      $('#template-grid').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-tpl-append], [data-tpl-replace], [data-tpl-bg], [data-tpl-subpage]');
        if (!btn) return;
        if (btn.dataset.tplBg) {
          TemplateLibrary.insertBackground(btn.dataset.tplBg);
        } else if (btn.dataset.tplSubpage) {
          TemplateLibrary.insert(btn.dataset.tplSubpage, 'subpage');
        } else {
          const layout = btn.dataset.tplAppend || btn.dataset.tplReplace;
          TemplateLibrary.insert(layout, btn.dataset.tplReplace ? 'replace' : 'append');
        }
      });

      // right panel tabs (属性 / 图层)
      $$('#props-tabs .panel-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          const isLayers = tab.dataset.ptab === 'layers';
          $$('#props-tabs .panel-tab').forEach(t => t.classList.toggle('active', t === tab));
          $('#props-content').classList.toggle('hidden', isLayers);
          $('#layers-panel').classList.toggle('hidden', !isLayers);
          if (isLayers) LayerPanel.render();
        });
      });

      // align bar buttons (multi-selection)
      $$('#align-bar .ab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const align = btn.dataset.align;
          const act = btn.dataset.action;
          if (act === 'el-group') { Group.group(); return; }
          if (act === 'el-ungroup') { Group.ungroup(); return; }
          Align.run(align);
        });
      });

      // multi-props panel buttons
      $$('#props-multi [data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
          const act = btn.dataset.action;
          if (act === 'el-group') Group.group();
          else if (act === 'el-ungroup') Group.ungroup();
          else if (act === 'el-front') Elements.bringToFront();
          else if (act === 'el-back') Elements.sendToBack();
          else if (act === 'delete') Elements.delete();
        });
      });
      $$('#props-multi [data-align]').forEach(btn => {
        btn.addEventListener('click', () => Align.run(btn.dataset.align));
      });

      // layout picker
      $$('[data-action="close-layout"]').forEach(btn => btn.addEventListener('click', () => LayoutPicker.close()));
      $$('.layout-card').forEach(card => {
        card.addEventListener('click', () => {
          const layout = card.dataset.layout;
          syncCurrentSlide();
          Store.addSlide(layout);
          currentIndex++;
          Preview.render();
          LayoutPicker.close();
          History.push();
          toast('已添加 ' + layoutName(layout) + ' 幻灯片', 'success');
        });
      });

      // slide context menu
      $$('#slide-context-menu [data-ctx]').forEach(item => {
        item.addEventListener('click', () => SlideContextMenu.action(item.dataset.ctx));
      });

      // element context menu
      $$('#element-context-menu [data-ectx]').forEach(item => {
        item.addEventListener('click', () => ElementContextMenu.action(item.dataset.ectx));
      });

      // canvas (empty area) context menu — paste at cursor
      $$('#canvas-context-menu [data-cctx]').forEach(item => {
        item.addEventListener('click', () => CanvasContextMenu.action(item.dataset.cctx));
      });

      // settings modal
      $('[data-action="settings"]').addEventListener('click', () => SettingsModal.open());
      $$('[data-action="close-settings"]').forEach(btn => btn.addEventListener('click', () => SettingsModal.close()));
      $('[data-action="save-settings"]').addEventListener('click', () => SettingsModal.save());

      // smartart modal
      $('[data-action="smartart"]').addEventListener('click', () => SmartArt.open());
      $$('[data-action="close-smartart"]').forEach(btn => btn.addEventListener('click', () => SmartArt.close()));
      $$('#smartart-modal .smartart-tabs .tab').forEach(tab => {
        tab.addEventListener('click', () => SmartArt.render(tab.dataset.saCat));
      });
      const saGrid = $('#smartart-grid');
      if (saGrid) {
        saGrid.addEventListener('click', (e) => {
          const card = e.target.closest('[data-sa-insert]');
          if (card) SmartArt.insert(card.dataset.saInsert);
        });
      }

      // theme modal
      $('[data-action="theme-panel"]').addEventListener('click', () => ThemeModal.open());
      $$('[data-action="close-theme"]').forEach(btn => btn.addEventListener('click', () => ThemeModal.close()));
      $('[data-action="save-theme"]').addEventListener('click', () => ThemeModal.save());

      // undo / redo
      $('[data-action="undo"]').addEventListener('click', () => History.undo());
      $('[data-action="redo"]').addEventListener('click', () => History.redo());
    },
  };

  /* ===== Elements module — shapes, text, embeds ===== */
  const Elements = {
    selected: null,
    selection: [],          // multi-selection (includes primary `selected`)
    clipboard: null,        // { html, group, gid } for group-aware copy/paste
    dragging: false,
    resizing: false,
    lastMouse: { x: 0, y: 0 },
    pasteAtMouseOnly: false,
    _multiBox: null,        // union bounding box DOM node when >1 selected
    _marquee: null,         // marquee (rubber band) selection state
    _editingGroup: null,    // gid being edited individually (group-edit mode)
    _freeform: null,        // freeform-polygon drawing state
    _vertexEdit: null,      // freeform element currently in vertex-edit mode
    _vertexEditOnKey: null, // temporary keydown handler during vertex edit
    _vertexEditOnDbl: null, // temporary dblclick handler during vertex edit

    /** Get current Reveal.js scale factor for drag/resize math */
    getScale() {
      const slides = $('#reveal .slides');
      if (!slides) return 1;
      const transform = window.getComputedStyle(slides).transform;
      if (transform && transform !== 'none') {
        const match = transform.match(/matrix\(([^)]+)\)/);
        if (match) {
          const vals = match[1].split(',').map(parseFloat);
          return vals[0] || 1;
        }
      }
      return 1;
    },

    /** Get the current slide section element (active vertical if in a chapter) */
    currentSection() {
      const active = Nav.activeSlide(currentIndex, currentV);
      return active ? sectionById(active.id) : null;
    },

    /** Get the current slide's visual (on-screen) rectangle + scale factor.
     *  Reveal.js 5 collapses the <section> to its content height, so
     *  section.getBoundingClientRect() is NOT the full slide. The `.slides`
     *  track element, however, always matches the logical slide size, so we
     *  measure that instead. */
    slideRect() {
      const slides = $('#slides-container');
      if (!slides) return { left: 0, top: 0, width: 0, height: 0, scale: 1 };
      const dims = sizeMap(project.meta.size || 'default');
      const r = slides.getBoundingClientRect();
      const scale = r.width / dims.w || 1;
      return {
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        scale: scale,
      };
    },

    /** Insert a shape into the current slide */
    insertShape(type) {
      const section = this.currentSection();
      if (!section) return;
      const fill = '#534AB7';
      const stroke = '#000000';
      const sw = 0;
      const dash = 'solid';
      const wide = type === 'line' || type === 'arrow' || type === 'curve';
      const square = type === 'polygon' || type === 'diamond' || type === 'star';
      const w = wide ? 220 : (square ? 140 : 150);
      const h = wide ? 80 : (square ? 140 : 120);
      // center-ish position
      const left = 380 - w / 2;
      const top = 280 - h / 2;
      // default endpoints for segment shapes (horizontal, centered)
      let ex1 = 0, ey1 = h / 2, ex2 = w, ey2 = h / 2;
      const eid = 'el_' + uid();
      const sides = type === 'polygon' ? 5 : 0;
      const arrowStyle = type === 'arrow' ? 'end' : (wide ? 'none' : '');
      const svg = wide
        ? buildSegmentSVG(type, ex1, ey1, ex2, ey2, w, h, stroke, sw, dash, arrowStyle, '100')
        : (Shapes[type] ? Shapes[type](fill, stroke, sw, dash, sides) : '');
      const segAttr = wide
        ? ' data-x1="' + ex1 + '" data-y1="' + ey1 + '" data-x2="' + ex2 + '" data-y2="' + ey2 + '"'
        : '';
      const arrowAttr = wide ? ' data-arrow="' + arrowStyle + '" data-arrow-size="100"' : '';
      const extraAttr = type === 'polygon' ? ' data-sides="' + sides + '"' : '';
      const html =
        '<div class="slide-element" data-type="shape" data-shape="' + type + '"' +
        ' data-eid="' + eid + '" data-fill="' + fill + '" data-stroke="' + stroke + '" data-stroke-w="' + sw + '" data-dash="' + dash + '"' + segAttr + arrowAttr + extraAttr +
        ' contenteditable="false"' +
        ' style="position:absolute;left:' + left + 'px;top:' + top + 'px;width:' + w + 'px;height:' + h + 'px;">' +
        svg + '</div>';
      section.insertAdjacentHTML('beforeend', html);
      syncCurrentSlide();
      // select the new element
      const el = section.querySelector('[data-eid="' + eid + '"]');
      if (el) {
        this.bindElement(el);
        this.select(el);
      }
      History.push();
      toast('已插入图形', 'success');
    },

    /** Start freeform-polygon (任意多边形) drawing mode: click to add vertices,
     *  double-click / Enter to close, Esc to cancel. */
    startFreeform() {
      const section = this.currentSection();
      if (!section) { toast('请先创建幻灯片', 'error'); return; }
      if (this._freeform) return;
      this.deselect();
      const dims = sizeMap(project.meta.size || 'default');
      const vp = this.slideRect();
      const area = $('#canvas-area');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'freeform-overlay');
      svg.setAttribute('viewBox', '0 0 ' + dims.w + ' ' + dims.h);
      svg.setAttribute('width', Math.max(vp.width, 1));
      svg.setAttribute('height', Math.max(vp.height, 1));
      svg.style.cssText = 'position:absolute;left:' + (vp.left - area.getBoundingClientRect().left) +
        'px;top:' + (vp.top - area.getBoundingClientRect().top) + 'px;pointer-events:none;z-index:50;overflow:visible;';
      area.appendChild(svg);
      const self = this;
      const f = { points: [], section: section, overlay: svg };
      f.onClick = (e) => {
        if (self._freeform !== f) return;
        if (e.button !== 0) return;
        const r = self.slideRect();
        if (e.clientX < r.left || e.clientX > r.left + r.width || e.clientY < r.top || e.clientY > r.top + r.height) return;
        const x = (e.clientX - r.left) / r.scale;
        const y = (e.clientY - r.top) / r.scale;
        const last = f.points[f.points.length - 1];
        if (last && Math.hypot(x - last[0], y - last[1]) < 4) return; // swallow dblclick duplicate
        f.points.push([Math.max(0, Math.min(dims.w, x)), Math.max(0, Math.min(dims.h, y))]);
        self._redrawFreeform(f);
      };
      f.onDbl = (e) => {
        if (self._freeform !== f) return;
        e.preventDefault(); e.stopPropagation();
        self._finishFreeform();
      };
      f.onKey = (e) => {
        if (self._freeform !== f) return;
        if (e.key === 'Escape') self._cancelFreeform();
        else if (e.key === 'Enter') self._finishFreeform();
      };
      document.addEventListener('click', f.onClick);
      document.addEventListener('dblclick', f.onDbl);
      document.addEventListener('keydown', f.onKey);
      this._freeform = f;
      toast('任意多边形：单击添加顶点，双击或回车闭合，Esc 取消', 'info');
    },

    _redrawFreeform(f) {
      if (!f || !f.overlay) return;
      const pts = f.points;
      let inner = '';
      if (pts.length >= 3) {
        inner = '<polygon points="' + pts.map(p => p[0] + ',' + p[1]).join(' ') +
          '" fill="rgba(83,74,183,0.18)" stroke="#534AB7" stroke-width="2" stroke-dasharray="6 4" stroke-linejoin="round"/>';
      } else if (pts.length === 2) {
        inner = '<line x1="' + pts[0][0] + '" y1="' + pts[0][1] + '" x2="' + pts[1][0] + '" y2="' + pts[1][1] +
          '" stroke="#534AB7" stroke-width="2" stroke-dasharray="6 4"/>';
      }
      pts.forEach(function (p) {
        inner += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="4" fill="#534AB7" stroke="#fff" stroke-width="1.5"/>';
      });
      if (pts.length >= 3) {
        inner += '<circle cx="' + pts[0][0] + '" cy="' + pts[0][1] + '" r="6" fill="none" stroke="#534AB7" stroke-width="2"/>';
      }
      f.overlay.innerHTML = inner;
    },

    _finishFreeform() {
      const f = this._freeform;
      if (!f) return;
      const pts = f.points;
      this._removeFreeform();
      if (pts.length < 3) { toast('至少需要 3 个顶点才能闭合多边形', 'info'); return; }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      pts.forEach(p => {
        minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]);
        maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]);
      });
      const pad = 4;
      const left = Math.round(minX - pad), top = Math.round(minY - pad);
      const w = Math.round(maxX - minX + pad * 2), h = Math.round(maxY - minY + pad * 2);
      const rel = pts.map(p => [Math.round((p[0] - left) / w * 1000) / 1000, Math.round((p[1] - top) / h * 1000) / 1000]);
      const fill = '#534AB7', stroke = '#000000', sw = 0, dash = 'solid';
      const eid = 'el_' + uid();
      const svg = buildFreeformSVG(rel, w, h, fill, stroke, sw, dash);
      const html =
        '<div class="slide-element" data-type="shape" data-shape="freeform" data-eid="' + eid + '"' +
        ' data-fill="' + fill + '" data-stroke="' + stroke + '" data-stroke-w="' + sw + '" data-dash="' + dash + '"' +
        ' data-points="' + rel.map(p => p[0] + ',' + p[1]).join(' ') + '"' +
        ' contenteditable="false"' +
        ' style="position:absolute;left:' + left + 'px;top:' + top + 'px;width:' + w + 'px;height:' + h + 'px;">' +
        svg + '</div>';
      f.section.insertAdjacentHTML('beforeend', html);
      syncCurrentSlide();
      const el = f.section.querySelector('[data-eid="' + eid + '"]');
      if (el) { this.bindElement(el); this.select(el); }
      History.push();
      toast('已绘制任意多边形', 'success');
    },

    _cancelFreeform() {
      this._removeFreeform();
      toast('已取消绘制', 'info');
    },

    _removeFreeform() {
      const f = this._freeform;
      if (!f) return;
      if (f.onClick) document.removeEventListener('click', f.onClick);
      if (f.onDbl) document.removeEventListener('dblclick', f.onDbl);
      if (f.onKey) document.removeEventListener('keydown', f.onKey);
      if (f.overlay && f.overlay.parentNode) f.overlay.parentNode.removeChild(f.overlay);
      this._freeform = null;
    },

    /** Insert a text box */
    insertText() {
      const section = this.currentSection();
      if (!section) return;
      const eid = 'el_' + uid();
      const left = 330;
      const top = 250;
      const w = 240;
      const h = 60;
      const html =
        '<div class="slide-element" data-type="text" data-eid="' + eid + '"' +
        ' contenteditable="false"' +
        ' style="position:absolute;left:' + left + 'px;top:' + top + 'px;width:' + w + 'px;height:' + h + 'px;">' +
        '<div class="el-text" contenteditable="false" style="font-size:36px;">点击编辑文字</div></div>';
      section.insertAdjacentHTML('beforeend', html);
      syncCurrentSlide();
      const el = section.querySelector('[data-eid="' + eid + '"]');
      if (el) {
        this.bindElement(el);
        this.select(el);
      }
      History.push();
      toast('已插入文本框', 'success');
    },

    /** Insert an image element */
    insertImageElement(src) {
      const section = this.currentSection();
      if (!section) return;
      const eid = 'el_' + uid();
      const left = 340;
      const top = 180;
      const w = 400;
      const h = 280;
      const html =
        '<div class="slide-element" data-type="image" data-eid="' + eid + '"' +
        ' contenteditable="false"' +
        ' style="position:absolute;left:' + left + 'px;top:' + top + 'px;width:' + w + 'px;height:' + h + 'px;">' +
        '<img class="el-image" src="' + escAttr(src) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:4px;">' +
        '</div>';
      section.insertAdjacentHTML('beforeend', html);
      syncCurrentSlide();
      const el = section.querySelector('[data-eid="' + eid + '"]');
      if (el) {
        this.bindElement(el);
        this.select(el);
      }
      History.push();
      toast('已插入图片', 'success');
    },

    /** Insert an HTML embed */
    insertEmbed(method, content, opts) {
      const section = this.currentSection();
      if (!section) return;
      const eid = 'el_' + uid();
      const left = (opts && opts.left) || 260;
      const top = (opts && opts.top) || 200;
      const w = (opts && opts.w) || 400;
      const h = (opts && opts.h) || 200;
      let inner = '';
      if (method === 'url' || method === 'pdf') {
        let src = content;
        if (method === 'pdf') {
          // append PDF viewer params (works for both remote URL and dataURL)
          const sep = (src.indexOf('#') >= 0) ? '&' : '#';
          src = src + sep + 'toolbar=1&navpanes=0&view=FitH';
        }
        inner = '<iframe class="el-embed" src="' + escAttr(src) + '" style="width:100%;height:100%;border:none;"></iframe>' +
          '<div class="el-embed-overlay"></div>';
      } else if (method === 'ggb-file' || method === 'ggb-app') {
        // Local .ggb file (data-ggb-b64) or blank app (data-ggb-app) rendered via
        // the GGBApplet JavaScript API instead of an iframe URL to geogebra.org,
        // so both work with the local offline engine and give proper error
        // feedback when the engine cannot load.
        inner = '<div class="ggb-host ggb-scale-container" style="width:100%;height:100%;"></div>' +
          '<div class="el-embed-overlay"></div>';
      } else {
        inner = '<div class="el-embed-content">' + content + '</div>' +
          '<div class="el-embed-overlay"></div>';
      }
      let extraAttr = '';
      const extraData = (opts && opts.extraData) || {};
      for (const k in extraData) {
        const attrName = k.replace(/([A-Z])/g, '-$1').toLowerCase();
        extraAttr += ' data-' + attrName + '="' + escAttr(String(extraData[k])) + '"';
      }
      const html =
        '<div class="slide-element" data-type="embed" data-embed-method="' + method + '"' +
        ' data-eid="' + eid + '"' +
        extraAttr +
        (method === 'url' || method === 'pdf' ? ' data-embed-src="' + escAttr(content) + '"' : '') +
        ' contenteditable="false"' +
        ' style="position:absolute;left:' + left + 'px;top:' + top + 'px;width:' + w + 'px;height:' + h + 'px;">' +
        inner + '</div>';
      section.insertAdjacentHTML('beforeend', html);
      syncCurrentSlide();
      const el = section.querySelector('[data-eid="' + eid + '"]');
      if (el) {
        this.bindElement(el);
        this.select(el);
        // render GeoGebra applets immediately (previously the .ggb-host stayed
        // empty until the next full render, leaving a blank box)
        if (method === 'ggb-file' || method === 'ggb-app') renderGgbLocal(section);
      }
      History.push();
      if (!(opts && opts.silent)) toast(method === 'pdf' ? '已嵌入 PDF' : '已嵌入网页', 'success');
    },

    /** Insert a video element. isLocal => render <video> (offline data URL);
     *  otherwise render an <iframe> (online embed / direct link). */
    insertVideo(src, isLocal, label) {
      const section = this.currentSection();
      if (!section) return;
      const eid = 'el_' + uid();
      const w = 480, h = 300;
      const left = Math.max(20, Math.round((1280 - w) / 2));
      const top = Math.max(20, Math.round((720 - h) / 2));
      let inner = '';
      let method = isLocal ? 'video-local' : 'video-url';
      if (isLocal) {
        // 本地视频：<video controls> 可离线播放；加载后点击「▶ 播放」进入交互
        inner = '<video class="el-video" controls="controls" preload="metadata" style="width:100%;height:100%;object-fit:contain;background:#000;">' +
          '<source src="' + escAttr(src) + '" type="video/mp4">' +
          '</video>' +
          '<div class="el-embed-overlay"></div>' +
          '<button type="button" class="video-chip" title="播放 / 暂停交互">▶ 交互</button>';
      } else {
        // 在线视频：iframe 嵌入（YouTube/B站/腾讯等）
        let embedSrc = src;
        // 若给了 <iframe> 完整标签，仅抽取 src
        const iframeM = /<iframe[^>]*src=["']([^"']+)["']/i.exec(src);
        if (iframeM) embedSrc = iframeM[1];
        inner = '<iframe class="el-embed" src="' + escAttr(embedSrc) + '" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen style="width:100%;height:100%;border:none;"></iframe>' +
          '<div class="el-embed-overlay"></div>' +
          '<button type="button" class="video-chip" title="播放 / 暂停交互">▶ 播放</button>';
      }
      const html =
        '<div class="slide-element" data-type="video" data-embed-method="' + method + '"' +
        ' data-eid="' + eid + '" data-video-src="' + escAttr(src) + '"' +
        ' contenteditable="false"' +
        ' style="position:absolute;left:' + left + 'px;top:' + top + 'px;width:' + w + 'px;height:' + h + 'px;">' +
        inner + '</div>';
      section.insertAdjacentHTML('beforeend', html);
      syncCurrentSlide();
      const el = section.querySelector('[data-eid="' + eid + '"]');
      if (el) {
        this.bindElement(el);
        this.select(el);
      }
      History.push();
      toast(isLocal ? '已插入本地视频' : '已插入在线视频', 'success');
    },

    /** Insert a live Desmos Graphing Calculator as an interactive element */
    insertDesmos() {
      const section = this.currentSection();
      if (!section) return;
      const eid = 'el_' + uid();
      // default position fits the current page ratio: top=30% / right=5% / width=45%
      // (mirrors the GeoGebra applet default)
      const dims = stageDims();
      const w = Math.max(240, Math.round(dims.w * 0.45));
      const h = Math.round(w * 380 / 520); // keep the classic 520×380 calculator aspect
      const left = Math.round(dims.w - w - dims.w * 0.05); // right 5%
      const top = Math.round(dims.h * 0.30);               // top 30%
      const html =
        '<div class="slide-element" data-type="desmos" data-eid="' + eid + '"' +
        ' data-desmos-state="" contenteditable="false"' +
        ' style="position:absolute;left:' + left + 'px;top:' + top + 'px;width:' + w + 'px;height:' + h + 'px;">' +
        '<div class="desmos-bar"><span class="desmos-bar-title">Desmos 计算器</span>' +
        '<span class="desmos-bar-hint">拖动此处移动 · 演示态可交互</span></div>' +
        '<div class="desmos-host"></div></div>';
      section.insertAdjacentHTML('beforeend', html);
      syncCurrentSlide();
      const el = section.querySelector('[data-eid="' + eid + '"]');
      if (el) {
        this.bindElement(el);
        this.select(el);
        renderDesmos(section);
      }
      History.push();
      toast('已插入 Desmos 计算器（可在画布中直接输入表达式、拖滑块看动画）', 'success');
    },

    /** Update an existing embed element's content (double-click to edit it) */
    updateEmbed(el, method, content) {
      if (!el) return;
      let inner = '';
      if (method === 'url' || method === 'pdf') {
        let src = content;
        if (method === 'pdf') {
          const sep = (src.indexOf('#') >= 0) ? '&' : '#';
          src = src + sep + 'toolbar=1&navpanes=0&view=FitH';
        }
        inner = '<iframe class="el-embed" src="' + escAttr(src) + '" style="width:100%;height:100%;border:none;"></iframe>' +
          '<div class="el-embed-overlay"></div>';
      } else if (method === 'ggb-file' || method === 'ggb-app') {
        // GGBApplet API renders these into .ggb-host; never replace with an iframe
        inner = '<div class="ggb-host ggb-scale-container" style="width:100%;height:100%;"></div>' +
          '<div class="el-embed-overlay"></div>';
      } else {
        inner = '<div class="el-embed-content">' + content + '</div>' +
          '<div class="el-embed-overlay"></div>';
      }
      el.innerHTML = inner;
      el.dataset.embedMethod = method;
      if (method === 'url' || method === 'pdf') el.dataset.embedSrc = content;
      else delete el.dataset.embedSrc;
      // allow the applet/iframe to be (re)rendered after the update; clear any
      // stale GeoGebra applet reference so a re-render re-injects cleanly.
      if (el._ggbApplet) { el._ggbApplet = null; }
      el._ggbInjected = false;
      el._ggbWatched = false;
      syncCurrentSlide();
      History.push();
      if (method === 'ggb-file' || method === 'ggb-app') {
        renderGgbLocal(el.closest('section') || $('#slides-container'));
      }
      toast(method === 'pdf' ? '已更新 PDF' : '已更新嵌入', 'success');
    },


    /** Insert a chart element (static SVG, theme-adaptive) */
    insertChart(cfg) {
      const section = this.currentSection();
      if (!section) return;
      const eid = 'el_' + uid();
      const left = 270;
      const top = 170;
      const w = 440;
      const h = 300;
      const html =
        '<div class="slide-element" data-type="chart" data-eid="' + eid + '"' +
        ' data-chart-type="' + escAttr(cfg.type) + '"' +
        ' data-chart-title="' + escAttr(cfg.title || '') + '"' +
        ' data-chart-labels="' + escAttr(JSON.stringify(cfg.labels || [])) + '"' +
        ' data-chart-values="' + escAttr(JSON.stringify(cfg.values || [])) + '"' +
        ' data-chart-palette="' + escAttr(cfg.palette || 'default') + '"' +
        ' contenteditable="false"' +
        ' style="position:absolute;left:' + left + 'px;top:' + top + 'px;width:' + w + 'px;height:' + h + 'px;">' +
        '<div class="el-chart">' + Charts.buildSVG(cfg) + '</div>' +
        '</div>';
      section.insertAdjacentHTML('beforeend', html);
      syncCurrentSlide();
      const el = section.querySelector('[data-eid="' + eid + '"]');
      if (el) {
        this.bindElement(el);
        this.select(el);
      }
      History.push();
      toast('已插入图表', 'success');
    },

    /** Insert a table element with the given config { rows, cols, style, header }. */
    insertTable(cfg) {
      const section = this.currentSection();
      if (!section) return;
      const eid = 'el_' + uid();
      const cols = Math.max(1, cfg.cols || 3), rows = Math.max(1, cfg.rows || 3);
      const w = Math.max(220, Math.min(720, cols * 140));
      const h = Math.max(80, Math.min(520, (cfg.header === false ? rows : rows + 1) * 40));
      const left = Math.max(20, Math.round((1280 - w) / 2));
      const top = Math.max(20, Math.round((720 - h) / 2));
      const html =
        '<div class="slide-element" data-type="table" data-eid="' + eid + '"' +
        ' data-table-style="' + escAttr(cfg.style || 'striped') + '"' +
        ' data-table-cols="' + cols + '" data-table-rows="' + rows + '"' +
        ' data-table-header="' + (cfg.header === false ? '0' : '1') + '"' +
        ' contenteditable="false"' +
        ' style="position:absolute;left:' + left + 'px;top:' + top + 'px;width:' + w + 'px;height:' + h + 'px;">' +
        Table.build(cfg) +
        '</div>';
      section.insertAdjacentHTML('beforeend', html);
      syncCurrentSlide();
      const el = section.querySelector('[data-eid="' + eid + '"]');
      if (el) {
        this.bindElement(el);
        this.select(el);
      }
      History.push();
      toast('已插入表格', 'success');
    },

    /** Insert a built-in icon element (SVG) from the palette. */
    insertIcon(key) {
      const section = this.currentSection();
      if (!section) return;
      const eid = 'el_' + uid();
      const size = 88;
      const left = Math.max(20, Math.round((1280 - size) / 2));
      const top = Math.max(20, Math.round((720 - size) / 2));
      const html =
        '<div class="slide-element" data-type="icon" data-icon="' + escAttr(key) + '" data-eid="' + eid + '"' +
        ' contenteditable="false"' +
        ' style="position:absolute;left:' + left + 'px;top:' + top + 'px;width:' + size + 'px;height:' + size + 'px;color:#334155;">' +
        IconPicker.svgFor(key, '#334155') +
        '</div>';
      section.insertAdjacentHTML('beforeend', html);
      syncCurrentSlide();
      const el = section.querySelector('[data-eid="' + eid + '"]');
      if (el) {
        this.bindElement(el);
        this.select(el);
      }
      History.push();
      $('#icon-modal').classList.add('hidden');
      toast('已插入图标', 'success');
    },

    /** Set up interactivity for all elements on a slide */
    bindToSlide(section) {
      const els = $$('.slide-element', section);
      els.forEach(el => this.bindElement(el));
    },

    /** Set up a single element's event listeners */
    bindElement(el) {
      if (el.dataset.bound) return;
      el.dataset.bound = 'true';

      // keep a stable auto-animate-id so Reveal can morph matching elements
      if (el.dataset.eid && !el.dataset.autoAnimateId) {
        el.dataset.autoAnimateId = el.dataset.eid;
      }

      // restore shape shadow / freeform geometry for loaded elements
      if (el.dataset.type === 'shape') {
        if (el.dataset.shape === 'freeform' && !el.querySelector('svg')) renderFreeform(el);
        applyShapeShadow(el);
      }

      // add embed overlay for embed elements (if missing, e.g. loaded from saved data)
      if (el.dataset.type === 'embed' && !el.querySelector('.el-embed-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'el-embed-overlay';
        el.appendChild(overlay);
      }
      // GeoGebra applets (ggb-file / ggb-app) get an "interact" toggle chip so the
      // user can use the applet without removing the drag/move overlay
      if (el.dataset.type === 'embed' && (el.dataset.ggbFile || el.dataset.ggbApp) && !el.querySelector('.ggb-chip')) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'ggb-chip';
        chip.title = '进入/退出交互模式（交互中可操作 GeoGebra，拖动元素需先退出）';
        chip.textContent = '▶ 交互';
        chip.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          Elements.toggleGgbInteract(el);
        });
        el.appendChild(chip);
      }

      // video elements: "play / interact" toggle chip so the video/iframe can be
      // played without removing the drag overlay
      if (el.dataset.type === 'video') {
        // ensure overlay present
        if (!el.querySelector('.el-embed-overlay')) {
          const ov = document.createElement('div');
          ov.className = 'el-embed-overlay';
          el.appendChild(ov);
        }
        const chip = el.querySelector('.video-chip') || document.createElement('button');
        chip.type = 'button';
        chip.className = 'video-chip';
        chip.textContent = (el.dataset.videoInteract === '1') ? '✕ 退出' : (el.dataset.embedMethod === 'video-local' ? '▶ 播放' : '▶ 播放');
        chip.title = '进入/退出交互（可播放视频、操作嵌入内容）';
        chip.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          Elements.toggleVideoInteract(el);
        });
        if (!el.querySelector('.video-chip')) el.appendChild(chip);
      }

      // make table cells editable on double-click (listeners attached once)
      if (el.dataset.type === 'table') {
        $$('td, th', el).forEach(cell => {
          cell.addEventListener('blur', () => {
            cell.setAttribute('contenteditable', 'false');
            cell.classList.remove('editing');
            syncCurrentSlide();
          });
          cell.addEventListener('mousedown', (e) => {
            // allow placing the caret while editing, otherwise let the slide-element drag
            if (cell.isContentEditable) e.stopPropagation();
          });
        });
      }

      // click to select
      el.addEventListener('mousedown', (e) => {
        if (Elements._freeform) return; // freeform drawing swallows element interaction
        if (Elements._vertexEdit === el) { e.preventDefault(); e.stopPropagation(); return; } // vertex-edit: body clicks don't drag/select
        if (e.target.classList.contains('el-handle')) return;
        if (e.target.classList.contains('el-endpoint')) return;
        // locked element: allow select (to view/change props) but never drag/resize
        if (el.dataset.lock === '1') {
          if (e.target.closest('.el-handle') || e.target.closest('.el-endpoint')) {
            e.preventDefault(); e.stopPropagation(); return;
          }
          this.select(el);
          e.stopPropagation();
          return;
        }
        // let the live Desmos calculator handle its own pointer events
        if (e.target.closest('.desmos-host')) return;
        // the GeoGebra interact chip handles its own click (don't select/drag)
        if (e.target.closest('.ggb-chip')) return;
        // the video interact chip handles its own click (don't select/drag)
        if (e.target.closest('.video-chip')) return;
        // let an interactive GeoGebra applet receive pointer events
        if (el.dataset.ggbInteract === '1' && e.target.closest('.ggb-host')) return;
        // don't select if editing text
        const textEl = e.target.closest('.el-text');
        if (textEl && textEl.isContentEditable) return;
        // don't drag if editing a table cell
        const cell = e.target.closest('.el-table td, .el-table th');
        if (cell && cell.isContentEditable) return;
        e.preventDefault();
        e.stopPropagation();
        const additive = e.ctrlKey || e.metaKey || e.shiftKey;
        this.select(el, additive);
        if (!additive) this.startDrag(e, el);
      });

      // double-click to edit text
      el.addEventListener('dblclick', (e) => {
        if (Elements._freeform) return; // freeform drawing swallows element interaction
        // double-click a freeform polygon → re-edit its vertices directly
        // (while already in vertex-edit mode, let the event bubble so
        //  double-clicking an edge still adds a vertex)
        if (el.dataset.type === 'shape' && el.dataset.shape === 'freeform') {
          if (Elements._vertexEdit !== el) {
            e.preventDefault();
            e.stopPropagation();
            Elements.startVertexEdit(el);
          }
          return;
        }
        // double-click a table cell to edit its content
        if (el.dataset.type === 'table') {
          const cell = e.target.closest('td, th');
          if (cell) {
            e.preventDefault();
            e.stopPropagation();
            cell.setAttribute('contenteditable', 'true');
            cell.focus();
            const range = document.createRange();
            range.selectNodeContents(cell);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            return;
          }
        }
        // 双击已插入的组合公式 → 重新打开编辑对话框（回填内容）
        if (el.dataset.comboMath === '1') {
          e.preventDefault();
          e.stopPropagation();
          ComboMath.editElement(el);
          return;
        }
        const textEl = el.querySelector('.el-text');
        if (textEl) {
          e.preventDefault();
          e.stopPropagation();
          // 编辑前把已渲染的行内公式 SVG 还原为 \(...\) 源码（便于编辑公式），
          // 同时给其它 mjx-container（块级公式）也还原为 $$...$$ 源码。
          restoreMathSource(textEl);
          textEl.setAttribute('contenteditable', 'true');
          textEl.focus();
          // 编辑高亮
          textEl.classList.add('el-text-editing');
          // select all text (便于直接输入替换)
          const range = document.createRange();
          range.selectNodeContents(textEl);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          // 公式快捷提示（仅首次）
          if (!window.__elMathHintShown) {
            window.__elMathHintShown = true;
            toast('输入公式：行内用 \\(...\\)（如 \\(x^2\\)），块级用 $$...$$', 'info');
          }
          return;
        }
        // double-click to change image
        const imgEl = el.querySelector('.el-image');
        if (imgEl) {
          e.preventDefault();
          e.stopPropagation();
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.onchange = () => {
            const file = input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              imgEl.src = reader.result;
              syncCurrentSlide();
              toast('图片已更换', 'success');
            };
            reader.readAsDataURL(file);
          };
          input.click();
          return;
        }
        // double-click to edit math formula
        if (el.dataset.type === 'math') {
          e.preventDefault();
          e.stopPropagation();
          Toolbar.openMath(el);
          return;
        }
        // double-click to edit chart
        if (el.dataset.type === 'chart') {
          e.preventDefault();
          e.stopPropagation();
          Toolbar.openChart(el);
          return;
        }
        // double-click to change embedded PDF/webpage/HTML
        if (el.dataset.type === 'embed') {
          e.preventDefault();
          e.stopPropagation();
          // double-click a GeoGebra iframe → edit through the GeoGebra modal
          const method = el.dataset.embedMethod || 'url';
          const embedSrc = el.dataset.embedSrc || '';
          if ((method === 'url' && embedSrc.indexOf('geogebra.org') !== -1) || method === 'ggb-file' || method === 'ggb-app') {
            Toolbar.openGeogebra(el);
            return;
          }
          Elements._editingEmbed = el;
          const modal = $('#embed-modal');
          $$('#embed-modal .tab').forEach(t => t.classList.remove('active'));
          const target = $('[data-tab="' + method + '"]', modal) || $('[data-tab="url"]', modal);
          if (target) target.classList.add('active');
          $$('#embed-modal .tab-content').forEach(tc => tc.classList.add('hidden'));
          const tc = $('[data-tab-content="' + method + '"]', modal);
          if (tc) tc.classList.remove('hidden');
          if (method === 'url' || method === 'pdf') {
            const src = el.dataset.embedSrc || '';
            if (src.indexOf('data:') !== 0) {
              const inp = method === 'pdf' ? $('#embed-pdf-url') : $('#embed-url');
              if (inp) inp.value = src;
            }
            const fi = method === 'pdf' ? $('#embed-pdf-file') : (method === 'url' ? $('#embed-file') : null);
            if (fi) fi.value = '';
          } else if (method === 'code') {
            const cd = el.querySelector('.el-embed-content');
            if (cd) $('#embed-code').value = cd.innerHTML;
          }
          modal.classList.remove('hidden');
          return;
        }
        // double-click a group member → enter group-edit mode (edit members individually)
        if (el.dataset.group && Elements._editingGroup !== el.dataset.group) {
          e.preventDefault();
          e.stopPropagation();
          Elements._editingGroup = el.dataset.group;
          Elements.select(el);
          toast('已进入组内编辑，双击空白处退出', 'info');
          return;
        }
      });

      // right-click to open element context menu
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.select(el);
        ElementContextMenu.show(e, el);
      });

      // exit text edit on blur
      const textEl = el.querySelector('.el-text');
      if (textEl) {
        textEl.addEventListener('blur', () => {
          textEl.setAttribute('contenteditable', 'false');
          textEl.classList.remove('el-text-editing');
          syncCurrentSlide();
          // 文本可能含 \(...\)/$$...$$/$...$ 公式 → 编辑后强制重新渲染 MathJax。
          // 用 typesetClear 清掉 MathJax 对该节点的“已处理”标记，保证新粘贴的公式也重渲。
          if (window.MathJax) {
            try {
              if (window.MathJax.typesetClear) window.MathJax.typesetClear(textEl);
            } catch (e) {}
            renderMath(textEl);
          }
        });
        textEl.addEventListener('mousedown', (e) => {
          // allow normal text editing when already focused
          if (textEl.isContentEditable) e.stopPropagation();
        });
      }
    },

    /** Toggle the "interact" mode of a GeoGebra applet element: hides the drag
        overlay so pointer events reach the applet; clicking outside exits. */
    toggleGgbInteract(el) {
      if (!el) return;
      const overlay = el.querySelector('.el-embed-overlay');
      const chip = el.querySelector('.ggb-chip');
      if (el.dataset.ggbInteract === '1') {
        // exit interact mode
        delete el.dataset.ggbInteract;
        if (overlay) overlay.style.display = '';
        if (chip) chip.textContent = '▶ 交互';
        if (Elements._ggbInteractEl === el) Elements._ggbInteractEl = null;
      } else {
        el.dataset.ggbInteract = '1';
        if (overlay) overlay.style.display = 'none';
        if (chip) chip.textContent = '✕ 退出交互';
        Elements._ggbInteractEl = el;
        if (!Elements._ggbExitListener) {
          Elements._ggbExitListener = (e) => {
            const cur = Elements._ggbInteractEl;
            if (cur && !cur.contains(e.target)) Elements.toggleGgbInteract(cur);
          };
          document.addEventListener('mousedown', Elements._ggbExitListener, true);
        }
      }
    },

    /** Toggle a video element between edit mode and play/interact mode. */
    toggleVideoInteract(el) {
      if (!el) return;
      const overlay = el.querySelector('.el-embed-overlay');
      const chip = el.querySelector('.video-chip');
      if (el.dataset.videoInteract === '1') {
        delete el.dataset.videoInteract;
        if (overlay) overlay.style.display = '';
        if (chip) chip.textContent = (el.dataset.embedMethod === 'video-local') ? '▶ 播放' : '▶ 播放';
      } else {
        el.dataset.videoInteract = '1';
        if (overlay) overlay.style.display = 'none';
        if (chip) chip.textContent = '✕ 退出';
      }
    },

    /** Select element(s). additive (Ctrl/Shift) toggles membership; plain click on a group member selects the whole group */
    select(el, additive) {
      if (!el) return;
      // leaving group-edit mode when clicking outside the editing group
      if (this._editingGroup && (!el.dataset.group || el.dataset.group !== this._editingGroup)) {
        this._editingGroup = null;
      }
      if (additive) {
        const idx = this.selection.indexOf(el);
        if (idx >= 0) {
          if (this.selection.length <= 1) { this.deselect(); return; }
          this.selection.splice(idx, 1);
          if (this.selected === el) this.selected = this.selection[this.selection.length - 1];
          this._renderSelection();
          return;
        }
        this.selection.push(el);
        this.selected = el;
        this._renderSelection();
        return;
      }
      // plain select: clicking a group member selects the whole group (unless editing inside the group)
      let targets = [el];
      if (el.dataset.group && !this._editingGroup) {
        targets = this._groupMembers(el.dataset.group);
      }
      this.deselect();
      this.selected = el;
      this.selection = targets;
      this._renderSelection();
    },

    /** Render handles / multi-box / props for the current selection state */
    _renderSelection() {
      // clean previous single-element handles and selection classes
      this.selection.forEach(selEl => {
        selEl.classList.add('selected');
        $$('.el-handle', selEl).forEach(h => h.remove());
        $$('.el-endpoint', selEl).forEach(h => h.remove());
      });
      if (this._multiBox) { this._multiBox.remove(); this._multiBox = null; }

      if (this.selection.length === 1) {
        const el = this.selection[0];
        const shapeType = el.dataset.shape;
        const isSeg = el.dataset.type === 'shape' &&
          (shapeType === 'line' || shapeType === 'arrow' || shapeType === 'curve');
        if (isSeg) {
          // segment shapes use two draggable endpoint handles instead of corner resize
          normalizeSegment(el);
          [1, 2].forEach(idx => {
            const hh = document.createElement('div');
            hh.className = 'el-endpoint end-' + idx;
            hh.dataset.endpoint = idx;
            hh.addEventListener('mousedown', (e) => {
              e.preventDefault();
              e.stopPropagation();
              this.startEndpointDrag(e, el, idx);
            });
            el.appendChild(hh);
          });
          this._positionEndpointHandles(el);
        } else {
          // add resize handles
          const handles = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];
          handles.forEach(dir => {
            const h = document.createElement('div');
            h.className = 'el-handle ' + dir;
            h.dataset.handle = dir;
            h.addEventListener('mousedown', (e) => {
              e.preventDefault();
              e.stopPropagation();
              this.startResize(e, el, dir);
            });
            el.appendChild(h);
          });
        }
        AlignBar.hide();
        this.showProps();
      } else if (this.selection.length > 1) {
        this._showMultiBox();
        AlignBar.show(this.selection.length);
        this.showMultiProps();
      }
      if (typeof LayerPanel !== 'undefined' && LayerPanel.syncActive) LayerPanel.syncActive();
    },

    /** Deselect current element(s) */
    deselect() {
      const section = this.currentSection();
      if (section) {
        $$('.slide-element.selected', section).forEach(el => {
          if (el.dataset.type === 'desmos') saveDesmosState(el);
          el.classList.remove('selected');
          $$('.el-handle', el).forEach(h => h.remove());
          $$('.el-endpoint', el).forEach(h => h.remove());
          $$('.ff-vertex', el).forEach(h => h.remove());
        });
      }
      if (this._vertexEdit) {
        if (this._vertexEditOnKey) { document.removeEventListener('keydown', this._vertexEditOnKey); this._vertexEditOnKey = null; }
        if (this._vertexEditOnDbl) { document.removeEventListener('dblclick', this._vertexEditOnDbl); this._vertexEditOnDbl = null; }
        this._vertexEdit = null;
      }
      if (this._multiBox) { this._multiBox.remove(); this._multiBox = null; }
      AlignBar.hide();
      this.selected = null;
      this.selection = [];
      this._editingGroup = null;
      this.hideProps();
      if (typeof LayerPanel !== 'undefined' && LayerPanel.syncActive) LayerPanel.syncActive();
    },

    /** All elements of a group on the current slide */
    _groupMembers(gid) {
      const section = this.currentSection();
      if (!section || !gid) return [];
      return $$('.slide-element[data-group="' + gid + '"]', section);
    },

    /** Union bounding rect (slide coordinates) of the given elements */
    _unionRect(els) {
      let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
      els.forEach(el => {
        const l = parseFloat(el.style.left) || 0;
        const t = parseFloat(el.style.top) || 0;
        const w = parseFloat(el.style.width) || 0;
        const h = parseFloat(el.style.height) || 0;
        minL = Math.min(minL, l); minT = Math.min(minT, t);
        maxR = Math.max(maxR, l + w); maxB = Math.max(maxB, t + h);
      });
      if (!isFinite(minL)) return { left: 0, top: 0, w: 0, h: 0 };
      return { left: minL, top: minT, w: maxR - minL, h: maxB - minT };
    },

    /** Reposition the multi-select union box after drag/resize */
    _updateMultiBox() {
      if (!this._multiBox || !this.selection.length) return;
      const u = this._unionRect(this.selection);
      this._multiBox.style.left = u.left + 'px';
      this._multiBox.style.top = u.top + 'px';
      this._multiBox.style.width = u.w + 'px';
      this._multiBox.style.height = u.h + 'px';
    },

    /** Show the union bounding box with 8 resize handles for multi-selection */
    _showMultiBox() {
      const section = this.currentSection();
      if (!section) return;
      const u = this._unionRect(this.selection);
      const box = document.createElement('div');
      box.className = 'multi-box';
      box.style.left = u.left + 'px';
      box.style.top = u.top + 'px';
      box.style.width = u.w + 'px';
      box.style.height = u.h + 'px';
      const handles = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];
      handles.forEach(dir => {
        const h = document.createElement('div');
        h.className = 'el-handle ' + dir;
        h.dataset.handle = dir;
        h.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.startResize(e, null, dir);
        });
        box.appendChild(h);
      });
      box.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('el-handle')) return;
        e.preventDefault();
        e.stopPropagation();
        this.startDrag(e, null);
      });
      section.appendChild(box);
      this._multiBox = box;
    },

    /** Show the multi-select properties panel */
    showMultiProps() {
      const n = this.selection.length;
      const cnt = $('#multi-count');
      if (cnt) cnt.textContent = '已选择 ' + n + ' 个元素 · 可整体拖动 / 缩放 / 对齐 / 编组';
      PropsPanel.switchToMulti();
      const grp = this.selection[0] && this.selection[0].dataset.group &&
        this.selection.every(el => el.dataset.group === this.selection[0].dataset.group);
      const ungrpBtn = $('[data-action="el-ungroup"]');
      if (ungrpBtn) ungrpBtn.style.display = grp ? '' : 'none';
    },

    /** Select every element on the current slide (Ctrl+A) */
    selectAll() {
      const section = this.currentSection();
      if (!section) return;
      const els = $$('.slide-element', section);
      if (!els.length) return;
      this.deselect();
      this.selected = els[0];
      this.selection = els.slice();
      this._renderSelection();
      toast('已选择 ' + els.length + ' 个元素', 'info');
    },

    /** Nudge the selection by (dx, dy) slide pixels */
    nudge(dx, dy) {
      const targets = this.selection.length ? this.selection : (this.selected ? [this.selected] : []);
      if (!targets.length) return;
      targets.forEach(el => {
        el.style.left = Math.round((parseFloat(el.style.left) || 0) + dx) + 'px';
        el.style.top = Math.round((parseFloat(el.style.top) || 0) + dy) + 'px';
      });
      this._updateMultiBox();
      syncCurrentSlide();
    },

    /** Rubber-band (marquee) selection starting on empty canvas area */
    _startMarquee(e) {
      if (this.dragging || this.resizing || this._marquee) return;
      if (Toolbar && Toolbar.currentTool && Toolbar.currentTool !== 'select') return;
      if (e.button !== 0) return;
      const section = this.currentSection();
      if (!section) return;
      const vp = this.slideRect();
      const scale = vp.scale;
      e.preventDefault();
      this.deselect();
      const startX = (e.clientX - vp.left) / scale;
      const startY = (e.clientY - vp.top) / scale;
      const box = document.createElement('div');
      box.className = 'marquee-box';
      $('#canvas-area').appendChild(box);
      this._marquee = { box: box, startX: startX, startY: startY, r: vp, scale: scale };
      const onMove = (ev) => {
        const m = this._marquee;
        if (!m) return;
        const x = (ev.clientX - m.r.left) / m.scale;
        const y = (ev.clientY - m.r.top) / m.scale;
        const ar = $('#canvas-area').getBoundingClientRect();
        m.box.style.left = (m.r.left - ar.left + Math.min(x, m.startX) * m.scale) + 'px';
        m.box.style.top = (m.r.top - ar.top + Math.min(y, m.startY) * m.scale) + 'px';
        m.box.style.width = Math.abs(x - m.startX) * m.scale + 'px';
        m.box.style.height = Math.abs(y - m.startY) * m.scale + 'px';
      };
      const onUp = (ev) => {
        const m = this._marquee;
        this._marquee = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (m) m.box.remove();
        if (!m) return;
        const x = (ev.clientX - m.r.left) / m.scale;
        const y = (ev.clientY - m.r.top) / m.scale;
        const minX = Math.min(x, m.startX), maxX = Math.max(x, m.startX);
        const minY = Math.min(y, m.startY), maxY = Math.max(y, m.startY);
        // pure click on empty area → deselect only
        if (maxX - minX < 3 && maxY - minY < 3) return;
        const hits = $$('.slide-element', section).filter(el => {
          if (el.dataset.hidden) return false;
          const l = parseFloat(el.style.left) || 0, t = parseFloat(el.style.top) || 0;
          const w = parseFloat(el.style.width) || 0, h = parseFloat(el.style.height) || 0;
          return l < maxX && l + w > minX && t < maxY && t + h > minY;
        });
        if (!hits.length) return;
        this.selected = hits[0];
        this.selection = hits;
        this._renderSelection();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },

    /** Draw snapping guide lines (slide coords → screen) */
    _showSnapGuides(snap) {
      const area = $('#snap-guides');
      if (!area) return;
      area.innerHTML = '';
      const section = this.currentSection();
      if (!section) return;
      const vp = this.slideRect();
      const ar = $('#canvas-area').getBoundingClientRect();
      const scale = vp.scale;
      if (snap.guides.x !== undefined) {
        const d = document.createElement('div');
        d.className = 'snap-guide snap-guide-v';
        d.style.left = (vp.left - ar.left + snap.guides.x * scale) + 'px';
        d.style.top = (vp.top - ar.top) + 'px';
        d.style.height = vp.height + 'px';
        area.appendChild(d);
      }
      if (snap.guides.y !== undefined) {
        const d = document.createElement('div');
        d.className = 'snap-guide snap-guide-h';
        d.style.top = (vp.top - ar.top + snap.guides.y * scale) + 'px';
        d.style.left = (vp.left - ar.left) + 'px';
        d.style.width = vp.width + 'px';
        area.appendChild(d);
      }
    },

    _hideSnapGuides() {
      const area = $('#snap-guides');
      if (area) area.innerHTML = '';
    },

    /** Start dragging an element (or the whole selection when el is null / a group member) */
    startDrag(e, el) {
      this.dragging = true;
      const scale = this.getScale();
      const startX = e.clientX;
      const startY = e.clientY;
      // drag target set: explicit el → group members (unless in group-edit) or single; null → whole selection
      let targets;
      if (el) {
        targets = (el.dataset.group && !this._editingGroup) ? this._groupMembers(el.dataset.group) : [el];
      } else {
        targets = this.selection.slice();
      }
      if (!targets.length) { this.dragging = false; return; }
      const orig = this._unionRect(targets);
      const originals = targets.map(t => ({
        el: t,
        left: parseFloat(t.style.left) || 0,
        top: parseFloat(t.style.top) || 0,
      }));
      const dims = sizeMap(project.meta.size || 'default');
      let snapped = false;

      const onMove = (ev) => {
        if (!this.dragging) return;
        const dx = (ev.clientX - startX) / scale;
        const dy = (ev.clientY - startY) / scale;
        let nx = Math.round(orig.left + dx);
        let ny = Math.round(orig.top + dy);
        // snapping (Alt temporarily disables)
        if (typeof Snap !== 'undefined' && !ev.altKey) {
          const res = Snap.find(originals, nx, ny, dims, targets);
          if (res) {
            nx = res.x; ny = res.y;
            this._showSnapGuides(res);
            snapped = true;
          } else if (snapped) {
            this._hideSnapGuides();
            snapped = false;
          }
        }
        const ddx = nx - orig.left;
        const ddy = ny - orig.top;
        originals.forEach(o => {
          o.el.style.left = Math.round(o.left + ddx) + 'px';
          o.el.style.top = Math.round(o.top + ddy) + 'px';
        });
        this._updateMultiBox();
        this.updatePropsPosition();
      };
      const onUp = () => {
        this.dragging = false;
        snapped = false;
        this._hideSnapGuides();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        syncCurrentSlide();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },

    /** Start resizing an element. el === null → resize the whole selection (union box). */
    startResize(e, el, handle) {
      this.resizing = true;
      const scale = this.getScale();
      const startX = e.clientX;
      const startY = e.clientY;
      const minSize = 20;

      // --- multi-selection resize (el === null) ---
      const multi = !el && this.selection.length > 1;
      const targets = multi ? this.selection.slice() : [el];
      if (!targets.length || !targets[0]) { this.resizing = false; return; }

      const origU = multi ? this._unionRect(targets) : {
        left: parseFloat(el.style.left) || 0,
        top: parseFloat(el.style.top) || 0,
        w: parseFloat(el.style.width) || 100,
        h: parseFloat(el.style.height) || 100,
      };
      // per-target original geometry (for multi: relative position inside union)
      const snaps = targets.map(t => {
        const g = {
          el: t,
          left: parseFloat(t.style.left) || 0,
          top: parseFloat(t.style.top) || 0,
          w: parseFloat(t.style.width) || 100,
          h: parseFloat(t.style.height) || 100,
        };
        if (multi) {
          g.rx = origU.w ? (g.left - origU.left) / origU.w : 0;
          g.ry = origU.h ? (g.top - origU.top) / origU.h : 0;
          g.rw = origU.w ? g.w / origU.w : 0;
          g.rh = origU.h ? g.h / origU.h : 0;
        }
        return g;
      });

      const applyRect = (g, L, T, W, H) => {
        g.el.style.left = Math.round(L) + 'px';
        g.el.style.top = Math.round(T) + 'px';
        g.el.style.width = Math.round(W) + 'px';
        g.el.style.height = Math.round(H) + 'px';
        // scale segment endpoints proportionally
        if (g.el.dataset.x1 !== undefined) {
          const kx = W / g.w;
          const ky = H / g.h;
          const s = (v, k) => Math.round((parseFloat(v) || 0) * k);
          g.el.dataset.x1 = s(g.el.dataset.x1, kx);
          g.el.dataset.y1 = s(g.el.dataset.y1, ky);
          g.el.dataset.x2 = s(g.el.dataset.x2, kx);
          g.el.dataset.y2 = s(g.el.dataset.y2, ky);
          if (typeof renderSegment === 'function') renderSegment(g.el);
        }
      };

      let snapped = false;
      const onMove = (ev) => {
        if (!this.resizing) return;
        const dx = (ev.clientX - startX) / scale;
        const dy = (ev.clientY - startY) / scale;
        let newLeft = origU.left, newTop = origU.top, newW = origU.w, newH = origU.h;

        if (handle.includes('e')) newW = Math.max(minSize, origU.w + dx);
        if (handle.includes('w')) { newW = Math.max(minSize, origU.w - dx); newLeft = origU.left + (origU.w - newW); }
        if (handle.includes('s')) newH = Math.max(minSize, origU.h + dy);
        if (handle.includes('n')) { newH = Math.max(minSize, origU.h - dy); newTop = origU.top + (origU.h - newH); }

        // 缩放吸附：移动边吸附到页面/其他元素边缘与中线（Alt 临时关闭）
        if (typeof Snap !== 'undefined' && !ev.altKey) {
          const res = Snap.findResize({ left: newLeft, top: newTop, w: newW, h: newH }, handle, targets);
          if (res) {
            newLeft = res.left; newTop = res.top; newW = res.w; newH = res.h;
            this._showSnapGuides(res);
            snapped = true;
          } else if (snapped) {
            this._hideSnapGuides();
            snapped = false;
          }
        }

        if (multi) {
          snaps.forEach(g => {
            const kx = origU.w ? newW / origU.w : 1;
            const ky = origU.h ? newH / origU.h : 1;
            const nx = newLeft + g.rx * newW;
            const ny = newTop + g.ry * newH;
            applyRect(g, nx, ny, Math.max(4, g.w * kx), Math.max(4, g.h * ky));
          });
          this._updateMultiBox();
        } else {
          applyRect(snaps[0], newLeft, newTop, newW, newH);
        }
        this.updatePropsPosition();
        this.updatePropsSize();
        // 拖动过程中实时让公式随框缩放（放大框 → 公式变大）
        if (!multi) { const t = targets[0]; if (t && t.getAttribute && t.getAttribute('data-type') === 'math') fitMathElement(t); }
      };
      const onUp = () => {
        this.resizing = false;
        snapped = false;
        this._hideSnapGuides();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        syncCurrentSlide();
        // re-fit GeoGebra applets after the element was resized by a handle
        resizeGgbApplets(targets[0].closest('section') || $('#slides-container'));
        // re-fit math formulas so enlarging the box enlarges the formula
        targets.forEach((t) => { if (t && t.getAttribute && t.getAttribute('data-type') === 'math') fitMathElement(t); });
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },

    /** Position the two endpoint handles at the stored local endpoint coords */
    _positionEndpointHandles(el) {
      const x1 = parseFloat(el.dataset.x1) || 0, y1 = parseFloat(el.dataset.y1) || 0;
      const x2 = parseFloat(el.dataset.x2) || 0, y2 = parseFloat(el.dataset.y2) || 0;
      const h1 = el.querySelector('.el-endpoint.end-1');
      const h2 = el.querySelector('.el-endpoint.end-2');
      if (h1) { h1.style.left = x1 + 'px'; h1.style.top = y1 + 'px'; }
      if (h2) { h2.style.left = x2 + 'px'; h2.style.top = y2 + 'px'; }
    },

    /** Drag a single endpoint; the other endpoint stays fixed in absolute coords.
        idx: 1 or 2 — which endpoint is being moved. */
    startEndpointDrag(e, el, idx) {
      this.dragging = true;
      const P = 12; // padding around the bounding box
      const dims = sizeMap(project.meta.size || 'default');

      const onMove = (ev) => {
        if (!this.dragging) return;
        const p = Elements.clientToSlide(ev.clientX, ev.clientY);
        // clamp inside the slide
        const mx = Math.max(0, Math.min(dims.w, p.x));
        const my = Math.max(0, Math.min(dims.h, p.y));

        const left = parseFloat(el.style.left) || 0;
        const top = parseFloat(el.style.top) || 0;
        const ox1 = parseFloat(el.dataset.x1) || 0, oy1 = parseFloat(el.dataset.y1) || 0;
        const ox2 = parseFloat(el.dataset.x2) || 0, oy2 = parseFloat(el.dataset.y2) || 0;

        // absolute coords of the fixed endpoint (the one NOT being dragged)
        let fx, fy;
        if (idx === 1) { fx = left + ox2; fy = top + oy2; }
        else { fx = left + ox1; fy = top + oy1; }
        // absolute coords of both endpoints after the move
        const ax1 = idx === 1 ? mx : fx;
        const ay1 = idx === 1 ? my : fy;
        const ax2 = idx === 1 ? fx : mx;
        const ay2 = idx === 1 ? fy : my;

        // recompute the bounding box so the fixed endpoint stays put
        const minX = Math.min(ax1, ax2) - P;
        const minY = Math.min(ay1, ay2) - P;
        const maxX = Math.max(ax1, ax2) + P;
        const maxY = Math.max(ay1, ay2) + P;
        const nW = Math.max(maxX - minX, 2 * P);
        const nH = Math.max(maxY - minY, 2 * P);
        const nLeft = minX, nTop = minY;

        // local endpoint coords within the new box
        const nx1 = ax1 - nLeft, ny1 = ay1 - nTop;
        const nx2 = ax2 - nLeft, ny2 = ay2 - nTop;

        el.style.left = Math.round(nLeft) + 'px';
        el.style.top = Math.round(nTop) + 'px';
        el.style.width = Math.round(nW) + 'px';
        el.style.height = Math.round(nH) + 'px';
        el.dataset.x1 = nx1; el.dataset.y1 = ny1;
        el.dataset.x2 = nx2; el.dataset.y2 = ny2;

        renderSegment(el);
        this._positionEndpointHandles(el);
        this.updatePropsPosition();
        this.updatePropsSize();
      };
      const onUp = () => {
        this.dragging = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        syncCurrentSlide();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },

    /* ===== Freeform polygon vertex re-editing (图形二次编辑) ===== */
    /** Enter vertex-edit mode for a freeform polygon. */
    startVertexEdit(el) {
      if (!el || el.dataset.shape !== 'freeform') return;
      if (this._vertexEdit) this._exitVertexEdit();
      $$('.el-handle', el).forEach(h => h.remove());
      this._vertexEdit = el;
      this._renderVertexHandles(el);
      const self = this;
      this._vertexEditOnKey = (e) => {
        if (e.key === 'Escape') self._exitVertexEdit();
      };
      this._vertexEditOnDbl = (e) => {
        if (e.target.classList.contains('ff-vertex')) return; // vertex dblclick = remove (handled elsewhere)
        const el2 = self._vertexEdit;
        if (!el2 || !el2.contains(e.target)) return;
        const p = self.clientToSlide(e.clientX, e.clientY);
        self._addVertexAt(el2, p.x, p.y);
      };
      document.addEventListener('keydown', this._vertexEditOnKey);
      document.addEventListener('dblclick', this._vertexEditOnDbl);
      toast('顶点编辑：拖动顶点 · 双击边加顶点 · 双击顶点删除 · Esc 完成', 'info');
    },

    _renderVertexHandles(el) {
      $$('.ff-vertex', el).forEach(h => h.remove());
      const pts = parseFreeformPoints(el);
      const w = parseFloat(el.style.width) || 100;
      const h = parseFloat(el.style.height) || 100;
      pts.forEach((p, i) => {
        const hh = document.createElement('div');
        hh.className = 'ff-vertex';
        hh.dataset.vertex = i;
        hh.style.left = (p[0] * w) + 'px';
        hh.style.top = (p[1] * h) + 'px';
        hh.addEventListener('mousedown', (e) => {
          e.preventDefault(); e.stopPropagation();
          this.startVertexDrag(e, el, i);
        });
        hh.addEventListener('dblclick', (e) => {
          e.preventDefault(); e.stopPropagation();
          this._removeVertex(el, i);
        });
        el.appendChild(hh);
      });
    },

    _positionVertexHandles(el) {
      const pts = parseFreeformPoints(el);
      const w = parseFloat(el.style.width) || 100;
      const h = parseFloat(el.style.height) || 100;
      $$('.ff-vertex', el).forEach((hh, idx) => {
        const p = pts[idx];
        if (p) { hh.style.left = (p[0] * w) + 'px'; hh.style.top = (p[1] * h) + 'px'; }
      });
    },

    startVertexDrag(e, el, i) {
      this.dragging = true;
      const dims = sizeMap(project.meta.size || 'default');
      const onMove = (ev) => {
        if (!this.dragging) return;
        const p = this.clientToSlide(ev.clientX, ev.clientY);
        const left = parseFloat(el.style.left) || 0;
        const top = parseFloat(el.style.top) || 0;
        const w = parseFloat(el.style.width) || 1;
        const h = parseFloat(el.style.height) || 1;
        const mx = Math.max(0, Math.min(dims.w, p.x));
        const my = Math.max(0, Math.min(dims.h, p.y));
        const nx = Math.max(0, Math.min(1, (mx - left) / w));
        const ny = Math.max(0, Math.min(1, (my - top) / h));
        const pts = parseFreeformPoints(el);
        pts[i] = [Math.round(nx * 1000) / 1000, Math.round(ny * 1000) / 1000];
        el.dataset.points = pts.map(pt => pt[0] + ',' + pt[1]).join(' ');
        renderFreeform(el);
        this._positionVertexHandles(el);
      };
      const onUp = () => {
        this.dragging = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        syncCurrentSlide();
        History.push();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },

    _addVertexAt(el, sx, sy) {
      const pts = parseFreeformPoints(el);
      if (pts.length < 3) return;
      const w = parseFloat(el.style.width) || 1;
      const h = parseFloat(el.style.height) || 1;
      const left = parseFloat(el.style.left) || 0;
      const top = parseFloat(el.style.top) || 0;
      const nx = Math.max(0, Math.min(1, (sx - left) / w));
      const ny = Math.max(0, Math.min(1, (sy - top) / h));
      let bestIdx = 0, bestDist = Infinity;
      for (let k = 0; k < pts.length; k++) {
        const j = (k + 1) % pts.length;
        const d = Elements._distToSegment(nx, ny, pts[k][0], pts[k][1], pts[j][0], pts[j][1]);
        if (d < bestDist) { bestDist = d; bestIdx = k; }
      }
      pts.splice(bestIdx + 1, 0, [Math.round(nx * 1000) / 1000, Math.round(ny * 1000) / 1000]);
      el.dataset.points = pts.map(p => p[0] + ',' + p[1]).join(' ');
      renderFreeform(el);
      this._renderVertexHandles(el);
      syncCurrentSlide();
      History.push();
    },

    _removeVertex(el, i) {
      const pts = parseFreeformPoints(el);
      if (pts.length <= 3) { toast('多边形至少需要 3 个顶点', 'info'); return; }
      pts.splice(i, 1);
      el.dataset.points = pts.map(p => p[0] + ',' + p[1]).join(' ');
      renderFreeform(el);
      this._renderVertexHandles(el);
      syncCurrentSlide();
      History.push();
    },

    _exitVertexEdit() {
      const el = this._vertexEdit;
      this._vertexEdit = null;
      if (this._vertexEditOnKey) { document.removeEventListener('keydown', this._vertexEditOnKey); this._vertexEditOnKey = null; }
      if (this._vertexEditOnDbl) { document.removeEventListener('dblclick', this._vertexEditOnDbl); this._vertexEditOnDbl = null; }
      if (el) {
        $$('.ff-vertex', el).forEach(h => h.remove());
        this.select(el); // restore normal resize handles
      }
    },

    /** Distance from point (px,py) to segment (ax,ay)-(bx,by) */
    _distToSegment(px, py, ax, ay, bx, by) {
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + t * dx, cy = ay + t * dy;
      return Math.hypot(px - cx, py - cy);
    },

    /** Delete the selected element(s) */
    delete() {
      const targets = this.selection.length ? this.selection.slice() : (this.selected ? [this.selected] : []);
      if (!targets.length) return;
      targets.forEach(el => {
        if (el.dataset.type === 'desmos') saveDesmosState(el);
        el.remove();
      });
      this.selected = null;
      this.selection = [];
      this.hideProps();
      syncCurrentSlide();
      History.push();
      toast(targets.length > 1 ? '已删除 ' + targets.length + ' 个元素' : '已删除元素', 'success');
    },

    /** Bring element(s) to front */
    bringToFront() {
      const targets = this.selection.length ? this.selection.slice() : (this.selected ? [this.selected] : []);
      if (!targets.length) return;
      const section = this.currentSection();
      if (!section) return;
      targets.forEach(el => section.appendChild(el));
      syncCurrentSlide();
      History.push();
      toast('已置于顶层', 'success');
    },

    /** Send element(s) to back */
    sendToBack() {
      const targets = this.selection.length ? this.selection.slice() : (this.selected ? [this.selected] : []);
      if (!targets.length) return;
      const section = this.currentSection();
      if (!section) return;
      // insert in reverse order so the original top-to-bottom order is preserved
      targets.slice().reverse().forEach(el => section.insertBefore(el, section.firstChild));
      syncCurrentSlide();
      History.push();
      toast('已置于底层', 'success');
    },

    /** Duplicate the selected element */
    duplicate() {
      const targets = this.selection.length ? this.selection.slice() : (this.selected ? [this.selected] : []);
      if (!targets.length) return;
      const clones = targets.map(orig => {
        const clone = orig.cloneNode(true);
        const newEid = 'el_' + uid();
        clone.dataset.eid = newEid;
        clone.dataset.autoAnimateId = newEid;
        clone.dataset.bound = '';
        // offset position
        const left = (parseFloat(clone.style.left) || 0) + 20;
        const top = (parseFloat(clone.style.top) || 0) + 20;
        clone.style.left = left + 'px';
        clone.style.top = top + 'px';
        clone.classList.remove('selected');
        // remove old handles
        $$('.el-handle', clone).forEach(h => h.remove());
        $$('.el-endpoint', clone).forEach(h => h.remove());
        $$('.ggb-chip, .video-chip', clone).forEach(h => h.remove());
        // clear the live Desmos calculator so the copy re-initialises from saved state
        $$('.desmos-host', clone).forEach(g => { g.innerHTML = ''; });
      $$('.ggb-host', clone).forEach(g => { g.innerHTML = ''; });
        orig.parentNode.appendChild(clone);
        return clone;
      });
      syncCurrentSlide();
      clones.forEach(c => this.bindElement(c));
      // re-mount any GeoGebra applet copies (their hosts were cleared above)
      if (clones.some(c => c.dataset.ggbFile || c.dataset.ggbApp)) {
        renderGgbLocal(clones[0].closest('section') || $('#slides-container'));
      }
      // clear the source selection so only the new copies stay selected
      this.deselect();
      this.selected = clones[0];
      this.selection = clones;
      this._renderSelection();
      History.push();
      toast(clones.length > 1 ? '已复制 ' + clones.length + ' 个元素' : '已复制元素', 'success');
    },

    /** Serialize an element into clean HTML (no handles/overlay/selection) for the clipboard */
    serialize(el) {
      const clone = el.cloneNode(true);
      clone.classList.remove('selected');
      $$('.el-handle', clone).forEach(h => h.remove());
      $$('.el-endpoint', clone).forEach(h => h.remove());
      $$('.el-embed-overlay', clone).forEach(h => h.remove());
      $$('.ggb-chip, .video-chip', clone).forEach(h => h.remove());
      $$('.ggb-fail', clone).forEach(h => h.remove());
      $$('.ggb-hint', clone).forEach(h => h.remove());
      // clear the live Desmos calculator host (state lives in dataset)
      $$('.desmos-host', clone).forEach(g => { g.innerHTML = ''; });
      $$('.ggb-host', clone).forEach(g => { g.innerHTML = ''; });
      clone.dataset.bound = '';
      // reset any live edit state so the copied markup is clean
      $$('.el-text[contenteditable="true"]', clone).forEach(t => t.setAttribute('contenteditable', 'false'));
      $$('.el-table td[contenteditable="true"], .el-table th[contenteditable="true"]', clone).forEach(c => c.setAttribute('contenteditable', 'false'));
      return clone.outerHTML;
    },

    /** Copy the selected element(s) into the internal clipboard */
    copy() {
      const targets = this.selection.length ? this.selection.slice() : (this.selected ? [this.selected] : []);
      if (!targets.length) return false;
      // preserve group ids across a multi-copy: remember group → new gid mapping
      const gmap = {};
      const html = targets.map(t => {
        const s = this.serialize(t);
        if (t.dataset.group && !gmap[t.dataset.group]) gmap[t.dataset.group] = 'g' + uid();
        return s;
      }).join('');
      this.clipboard = { html: html, group: gmap };
      toast(targets.length > 1 ? '已复制 ' + targets.length + ' 个元素' : '已复制元素', 'success');
      return true;
    },

    /** Cut the selected element(s) (copy to clipboard + remove) */
    cut() {
      if (!this.copy()) return;
      const targets = this.selection.length ? this.selection.slice() : (this.selected ? [this.selected] : []);
      targets.forEach(el => {
        if (el.dataset.type === 'desmos') saveDesmosState(el);
        el.remove();
      });
      this.selected = null;
      this.selection = [];
      this.hideProps();
      syncCurrentSlide();
      History.push();
      toast(targets.length > 1 ? '已剪切 ' + targets.length + ' 个元素' : '已剪切元素', 'success');
    },

    /** Convert client (screen) coordinates to slide-local pixel coordinates */
    clientToSlide(clientX, clientY) {
      const vp = this.slideRect();
      return {
        x: (clientX - vp.left) / vp.scale,
        y: (clientY - vp.top) / vp.scale,
      };
    },

    /** Paste the clipboard element(s) into the current slide.
     *  @param clientX,clientY optional screen coords → paste centered at the cursor */
    paste(clientX, clientY) {
      const section = this.currentSection();
      if (!section) return;
      if (!this.clipboard) {
        toast('剪贴板为空', 'info');
        return;
      }
      // clipboard is either a raw HTML string (legacy) or {html, group}
      const html = typeof this.clipboard === 'string' ? this.clipboard : this.clipboard.html;
      const gmap = (this.clipboard && typeof this.clipboard === 'object') ? (this.clipboard.group || {}) : {};
      // record how many element children exist before inserting, so we only
      // collect the newly pasted elements (the old reverse-walk could sweep up
      // every element when the slide contains nothing but .slide-element nodes,
      // which made paste select and re-id the whole slide).
      const beforeCount = section.children.length;
      section.insertAdjacentHTML('beforeend', html);
      const pasted = Array.from(section.children).slice(beforeCount)
        .filter(el => el.classList && el.classList.contains('slide-element'));
      if (!pasted.length) {
        toast('粘贴失败', 'error');
        return;
      }
      const dims = sizeMap(project.meta.size || 'default');

      // Compute the union bounding box of the pasted elements so we can move
      // the whole set as one unit and keep their relative layout intact
      // (previously each element was centered on the cursor independently,
      // causing multi-element pastes to stack on top of each other).
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      pasted.forEach(el => {
        const l = parseFloat(el.style.left) || 0;
        const t = parseFloat(el.style.top) || 0;
        const w = parseFloat(el.style.width) || 0;
        const h = parseFloat(el.style.height) || 0;
        if (l < minX) minX = l;
        if (t < minY) minY = t;
        if (l + w > maxX) maxX = l + w;
        if (t + h > maxY) maxY = t + h;
      });
      const boxW = maxX - minX;
      const boxH = maxY - minY;

      // Where should the union box's top-left corner land?
      let targetLeft, targetTop;
      if (typeof clientX === 'number' && typeof clientY === 'number') {
        // paste centered on the cursor: center the union box on the cursor
        const p = this.clientToSlide(clientX, clientY);
        targetLeft = p.x - boxW / 2;
        targetTop = p.y - boxH / 2;
      } else {
        // fall back to a small offset from the original position
        targetLeft = minX + 24;
        targetTop = minY + 24;
      }
      // clamp so the whole group stays visible (only when it fits)
      if (boxW <= dims.w) targetLeft = Math.max(0, Math.min(targetLeft, dims.w - boxW));
      if (boxH <= dims.h) targetTop = Math.max(0, Math.min(targetTop, dims.h - boxH));

      const dx = targetLeft - minX;
      const dy = targetTop - minY;

      const placed = pasted.map(el => {
        // fresh id + unbind so it re-binds cleanly
        el.dataset.eid = 'el_' + uid();
        el.dataset.autoAnimateId = el.dataset.eid;
        el.dataset.bound = '';
        el.classList.remove('selected');
        // remap group ids
        if (el.dataset.group && gmap[el.dataset.group]) {
          el.dataset.group = gmap[el.dataset.group];
          el.classList.add('in-group');
        }
        el.style.left = Math.round((parseFloat(el.style.left) || 0) + dx) + 'px';
        el.style.top = Math.round((parseFloat(el.style.top) || 0) + dy) + 'px';
        this.bindElement(el);
        if (el.dataset.type === 'math') renderMath(el);
        return el;
      });
      // re-mount pasted GeoGebra applets (their hosts are cleared by serialize)
      if (placed.some(el => el.dataset.ggbFile || el.dataset.ggbApp)) renderGgbLocal(section);
      syncCurrentSlide();
      // clear the previous selection so only the freshly pasted elements stay
      // selected (otherwise the copy source and the pasted copies end up
      // framed together as one selection).
      this.deselect();
      this.selected = placed[0];
      this.selection = placed;
      this._renderSelection();
      History.push();
      toast(placed.length > 1 ? '已粘贴 ' + placed.length + ' 个元素' : '已粘贴元素', 'success');
    },

    /** Toggle fragment animation on selected element. 若所选是编组的一部分，
        则把整组所有成员一起作为片段（相同 data-fragment-index，Reveal 会同帧渐显），
        而不是只给第一个成员加。 */
    toggleFragment() {
      if (!this.selected) return;
      const el = this.selected;
      const gid = el.dataset.group;
      const members = gid ? this._groupMembers(gid) : [el];
      const on = !(members[0] && members[0].classList.contains('fragment'));
      members.forEach(m => {
        if (on) {
          m.classList.add('fragment');
          m.dataset.fragmentIndex = '1';
        } else {
          m.classList.remove('fragment');
          delete m.dataset.fragmentIndex;
        }
      });
      toast(on ? '已添加片段动画（整组演示时一起渐显）' : '已移除片段', on ? 'success' : 'info');
      // 组内成员共享同一 index，避免逐个出现；仅对非组装成员按 DOM 顺序编号
      this._assignFragments();
      syncCurrentSlide();
      this.updateFragmentBtn();
    },

    /** 分配 data-fragment-index：编组内的成员共享同一个 index（整体渐显），
        其余 .fragment 按 DOM 顺序递增。 */
    _assignFragments() {
      const section = this.currentSection();
      if (!section) return;
      // 先收集所有 fragment 元素，按组分组
      const frags = $$('.slide-element.fragment', section);
      const groups = new Map(); // fragment 整体编号
      let next = 1;
      // 非组 fragment 独立占一号；组内所有成员合占一号
      const fragOnly = frags.filter(f => !f.dataset.group);
      const groupFrags = new Map();
      frags.forEach(f => { if (f.dataset.group) { if (!groupFrags.has(f.dataset.group)) groupFrags.set(f.dataset.group, []); groupFrags.get(f.dataset.group).push(f); } });
      // 按 DOM 顺序：先分配每类一个 index，再赋给组员
      const order = [];
      section.querySelectorAll('.slide-element').forEach(se => {
        if (se.classList.contains('fragment') && !se.dataset.group) order.push({ el: se, kind: 'single' });
        else if (se.classList.contains('fragment') && se.dataset.group && !order.some(o => o.kind === 'group' && o.gid === se.dataset.group)) order.push({ el: se, kind: 'group', gid: se.dataset.group });
      });
      let idx = 1;
      order.forEach(o => {
        if (o.kind === 'single') { o.el.dataset.fragmentIndex = String(idx++); }
        else { (groupFrags.get(o.gid) || []).forEach(m => m.dataset.fragmentIndex = String(idx)); idx++; }
      });
    },

    /** Assign data-fragment-index to every .fragment in the current section in DOM order,
        so the editor badge and Reveal reveal order stay consistent (slides.com-style). */
    reassignFragmentIndices() {
      const section = this.currentSection();
      if (!section) return;
      const frags = $$('.slide-element.fragment', section);
      let idx = 1;
      frags.forEach(f => {
        f.dataset.fragmentIndex = String(idx);
        if (!f.dataset.fragmentOrderSet) f.dataset.fragmentOrderSet = '';
        idx++;
      });
    },

    updateFragmentBtn() {
      const btn = $('#el-fragment-btn');
      if (!btn || !this.selected) return;
      if (this.selected.classList.contains('fragment')) {
        const n = this.selected.dataset.fragmentIndex || '?';
        btn.textContent = '✓ 片段 ' + n;
        btn.style.color = 'var(--accent)';
      } else {
        btn.textContent = '+ 添加片段';
        btn.style.color = '';
      }
    },

    /** Show element properties panel */
    showProps() {
      const el = this.selected;
      if (!el) return;
      const type = el.dataset.type || 'shape';
      PropsPanel.switchToElement(type);
      this.reassignFragmentIndices();
      this.refreshProps();
      this.populateLinkOptions();
      this.updateFragmentBtn();
    },

    /** Hide element properties panel */
    hideProps() {
      PropsPanel.switchTo('empty');
    },

    /** Populate the "jump to slide" dropdown */
    populateLinkOptions() {
      const select = $('#el-link');
      const current = this.selected ? this.selected.dataset.link || '' : '';
      select.innerHTML = '<option value="">无</option>';
      project.slides.forEach((s, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = '第 ' + (i + 1) + ' 页';
        select.appendChild(opt);
      });
      select.value = current;
    },

    /** Refresh property inputs from selected element */
    refreshProps() {
      const el = this.selected;
      if (!el) return;
      const isShape = el.dataset.type === 'shape';
      const isText = el.dataset.type === 'text';

      $('#el-x').value = Math.round(parseFloat(el.style.left) || 0);
      $('#el-y').value = Math.round(parseFloat(el.style.top) || 0);
      $('#el-w').value = Math.round(parseFloat(el.style.width) || 0);
      $('#el-h').value = Math.round(parseFloat(el.style.height) || 0);

      // fill/stroke only for shapes
      if (isShape) {
        $('#el-fill').value = el.dataset.fill || '#534AB7';
        $('#el-stroke').value = el.dataset.stroke || '#000000';
        $('#el-stroke-w').value = el.dataset.strokeW || '0';
        $('#el-dash').value = el.dataset.dash || 'solid';
        const shadowSel = $('#el-shadow');
        if (shadowSel) {
          const hasShadowCustom = !!(el.dataset.shadowColor || el.dataset.shadowDepth || el.dataset.shadowAngle);
          shadowSel.value = hasShadowCustom ? 'custom' : (el.dataset.shadow || 'none');
        }
        // 图形阴影自定义参数（颜色/层次/角度）
        const sc = $('#el-shadow-color');
        if (sc) sc.value = el.dataset.shadowColor || '#000000';
        const sd = $('#el-shadow-depth');
        if (sd) sd.value = el.dataset.shadowDepth || '2';
        const sa = $('#el-shadow-angle');
        if (sa) sa.value = el.dataset.shadowAngle || '45';
        const saVal = $('#el-shadow-angle-val');
        if (saVal) saVal.textContent = (el.dataset.shadowAngle || '45') + '°';
        const sParams = $('#el-shadow-params');
        if (sParams) sParams.style.display = (el.dataset.shadow && el.dataset.shadow !== 'none') ? '' : 'none';
        const ftSel = $('#el-fill-type');
        const ftv = el.dataset.fillType || 'solid';
        if (ftSel) ftSel.value = ftv;
        const f2 = $('#el-fill-2');
        if (f2) f2.value = el.dataset.fill2 || '#0EA5E9';
        const sidesSel = $('#el-sides');
        if (sidesSel) sidesSel.value = el.dataset.sides || '5';
        const arrowSel = $('#el-arrow');
        if (arrowSel) arrowSel.value = el.dataset.arrow || (el.dataset.shape === 'arrow' ? 'end' : 'none');
        const arrowSizeSel = $('#el-arrow-size');
        if (arrowSizeSel) arrowSizeSel.value = el.dataset.arrowSize || '100';
        const arrowSizeVal = $('#el-arrow-size-val');
        if (arrowSizeVal) arrowSizeVal.textContent = (el.dataset.arrowSize || '100') + '%';
        const angleDefault = ftv === 'grid' ? '0' : '45';
        const fillAngleSel = $('#el-fill-angle');
        if (fillAngleSel) fillAngleSel.value = el.dataset.fillAngle || angleDefault;
        const fillAngleVal = $('#el-fill-angle-val');
        if (fillAngleVal) fillAngleVal.textContent = (el.dataset.fillAngle || angleDefault) + '°';
        const fillSpacingSel = $('#el-fill-spacing');
        if (fillSpacingSel) fillSpacingSel.value = el.dataset.fillSpacing || (ftv === 'hatch' ? '10' : '14');
        const strokeOnBox = $('#el-stroke-on');
        if (strokeOnBox) strokeOnBox.checked = !el.dataset.strokeOff;
        // fill-none (仅描边) + 色块高亮
        const fillNoneBox = $('#el-fill-none');
        if (fillNoneBox) fillNoneBox.checked = el.dataset.fillNone === '1';
        syncShapeSwatches('fill', el.dataset.fillNone === '1' ? '' : (el.dataset.fill || ''));
        syncShapeSwatches('stroke', el.dataset.stroke || '');
        syncShapeSwatches('fill2', el.dataset.fill2 || '');
        // 图形类型切换器高亮
        $$('.st-btn[data-shape-type]').forEach(b => b.classList.toggle('active', b.dataset.shapeType === el.dataset.shape));
        // 翻转状态
        const fh = $('#el-flip-h'), fv = $('#el-flip-v');
        if (fh) fh.classList.toggle('active', el.dataset.flipH === '1');
        if (fv) fv.classList.toggle('active', el.dataset.flipV === '1');
        // update shape preview label
        const shapeNames = { rect: '矩形', ellipse: '椭圆', triangle: '三角形', line: '直线', arrow: '箭头',
          polygon: '多边形', diamond: '菱形', star: '五角星', curve: '曲线', freeform: '任意多边形' };
        const preview = $('#shape-preview');
        if (preview) preview.textContent = shapeNames[el.dataset.shape] || '形状';
        this._updateFillControls(el);
      }

      // text properties
      if (isText) {
        const textEl = el.querySelector('.el-text');
        if (textEl) {
          // 优先取子级 span 的内联颜色（模板文字的实际可见色），否则用容器计算色
          let visibleColor = null;
          const sp = textEl.querySelector('span[style*="color"]');
          if (sp) {
            const m = (sp.getAttribute('style') || '').match(/color:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/);
            if (m) visibleColor = m[1];
          }
          const computed = window.getComputedStyle(textEl);
          const tColorHex = rgbToHex(visibleColor || computed.color) || '#333333';
          $('#el-text-color').value = tColorHex;
          syncColorSwatch(tColorHex);
          $('#el-font-size').value = parseInt(computed.fontSize, 10) || 36;
          $('#el-line-height').value = parseFloat(computed.lineHeight) || 1.5;
          $('#el-letter-spacing').value = Math.round(parseFloat(computed.letterSpacing) || 0);
          // font-weight: match the nearest option value
          const fwSel = $('#el-font-weight');
          if (fwSel) {
            const inlineFw = textEl.style.fontWeight || computed.fontWeight;
            const fw = String(inlineFw).replace(/[^\d]/g, '');
            fwSel.value = fw && fwSel.querySelector('option[value="' + fw + '"]') ? fw : '';
          }
          // font-family: read inline style first, fall back to computed
          const ffSel = $('#el-font-family');
          if (ffSel) {
            const inlineFf = textEl.style.fontFamily || '';
            // try match an <option> value
            let matched = false;
            for (const opt of ffSel.options) {
              if (opt.value && (inlineFf === opt.value || inlineFf.indexOf(opt.value.split(',')[0].replace(/['"]/g, '').trim()) >= 0)) {
                ffSel.value = opt.value;
                matched = true;
                break;
              }
            }
            if (!matched) ffSel.value = '';
          }
          // background
          const bgComputed = window.getComputedStyle(el);
          const bg = bgComputed.backgroundColor;
          if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
            $('#el-bg-color').value = rgbToHex(bg);
          } else {
            $('#el-bg-color').value = '#ffffff';
          }
        }
        const cuBox = $('#el-countup');
        if (cuBox) cuBox.checked = el.dataset.countup === '1';

        // text display effects
        const hlBox = $('#el-hl');
        if (hlBox) hlBox.checked = !!el.dataset.hl;
        const hlColor = $('#el-hl-color');
        if (hlColor && el.dataset.hl) hlColor.value = el.dataset.hl;
        const gradBox = $('#el-grad');
        if (gradBox) gradBox.checked = !!el.dataset.grad;
        const gf = $('#el-grad-from'), gt = $('#el-grad-to');
        if (gf && el.dataset.gradFrom) gf.value = el.dataset.gradFrom;
        if (gt && el.dataset.gradTo) gt.value = el.dataset.gradTo;
        const tsSel = $('#el-tshadow');
        if (tsSel) {
          const hasCustom = !!(el.dataset.tshadowColor || el.dataset.tshadowDepth || el.dataset.tshadowAngle);
          tsSel.value = hasCustom ? 'custom' : (el.dataset.tshadow || 'none');
        }
        // 文字阴影自定义参数（颜色/层次/角度）
        const tsc = $('#el-tshadow-color');
        if (tsc) tsc.value = el.dataset.tshadowColor || '#000000';
        const tsd = $('#el-tshadow-depth');
        if (tsd) tsd.value = el.dataset.tshadowDepth || '2';
        const tsa = $('#el-tshadow-angle');
        if (tsa) tsa.value = el.dataset.tshadowAngle || '45';
        const tsaVal = $('#el-tshadow-angle-val');
        if (tsaVal) tsaVal.textContent = (el.dataset.tshadowAngle || '45') + '°';
        const tsParams = $('#el-tshadow-params');
        if (tsParams) tsParams.style.display = (el.dataset.tshadow && el.dataset.tshadow !== 'none') ? '' : 'none';
        const stBox = $('#el-tstroke');
        if (stBox) stBox.checked = !!el.dataset.stroke;
        const stColor = $('#el-tstroke-color'), stW = $('#el-tstroke-w');
        if (stColor && el.dataset.strokeColor) stColor.value = el.dataset.strokeColor;
        if (stW && el.dataset.strokeW) stW.value = el.dataset.strokeW;
        const dcBox = $('#el-dropcap');
        if (dcBox) dcBox.checked = el.dataset.dropcap === '1';
        // typography chips / enter-highlight / auto-fit (Reveal 排版扩展)
        const tfxChips = $$('.fx-chip[data-tfx]');
        if (tfxChips.length) {
          const tfx = (el.dataset.tfx || '').split(/\s+/).filter(Boolean);
          tfxChips.forEach(c => c.classList.toggle('active', tfx.indexOf(c.dataset.tfx) >= 0));
        }
        const ehSel = $('#el-enter-hl');
        if (ehSel) ehSel.value = el.dataset.enterHl || '';
        const rfitBox = $('#el-rfit');
        if (rfitBox) rfitBox.checked = el.dataset.rfit === '1';
      }

      // image properties
      if (el.dataset.type === 'image') {
        const imgEl = el.querySelector('.el-image');
        if (imgEl) {
          const fitSelect = $('#el-img-fit');
          if (fitSelect) {
            // detect object-fit from style
            const match = (imgEl.style.cssText || '').match(/object-fit:\s*(\w+)/);
            fitSelect.value = match ? match[1] : 'cover';
          }
        }
        const animSel = $('#el-img-anim');
        if (animSel) animSel.value = el.dataset.imgAnim || '';
      }

      // chart properties
      const chartHint = $('#chart-edit-hint');
      if (chartHint && el.dataset.type === 'chart') {
        const cfg = Charts.readConfig(el);
        const typeNames = { bar: '柱状图', line: '折线图', pie: '饼图', doughnut: '环形图' };
        chartHint.textContent = (typeNames[cfg.type] || cfg.type) +
          ' · ' + cfg.values.length + ' 个数据点' +
          (cfg.title ? ' · ' + cfg.title : '');
      }

      // GeoGebra properties (embed whose source points at geogebra.org)
      const ggbBlock = $('#ggb-edit-block');
      if (ggbBlock) {
        const isGgb = el.dataset.type === 'embed' && ((el.dataset.embedSrc || '').indexOf('geogebra.org') !== -1 || el.dataset.ggbFile || el.dataset.ggbApp);
        ggbBlock.style.display = isGgb ? '' : 'none';
        if (isGgb) {
          const hint = $('#ggb-edit-hint');
          if (hint) {
            const appKey = el.dataset.ggbApp || '';
            if (el.dataset.ggbFile) {
              hint.textContent = '本地文件：' + (el.dataset.ggbFilename || '（文件名未知）');
            } else if (appKey && Toolbar.GGB_APP_NAMES[appKey]) {
              hint.textContent = '空白计算器：' + Toolbar.GGB_APP_NAMES[appKey];
            } else {
              hint.textContent = '素材 ID：' + Toolbar.parseGgbId(el.dataset.embedSrc || '');
            }
          }
        }
      }


      const opacity = Math.round((parseFloat(el.style.opacity) || 1) * 100);
      $('#el-opacity').value = opacity;
      $('#el-opacity-val').textContent = opacity + '%';

      // rotation from transform
      const transform = el.style.transform || '';
      const rotMatch = transform.match(/rotate\((\d+)deg\)/);
      const rot = rotMatch ? parseInt(rotMatch[1], 10) : 0;
      $('#el-rotate').value = rot;
      $('#el-rotate-val').textContent = rot + '°';

      // lock state
      const locked = el.dataset.lock === '1';
      const lockEl = $('#el-lock');
      if (lockEl) { lockEl.classList.toggle('on', locked); lockEl.dataset.on = locked ? '1' : ''; }
      const lockLabel = $('#el-lock-label');
      if (lockLabel) lockLabel.textContent = locked ? '已锁定' : '不可移动';

      // entrance animation
      $('#el-entrance').value = el.dataset.entrance || 'none';

      // custom anim params
      const axEl = $('#el-anim-x'), ayEl = $('#el-anim-y');
      const asEl = $('#el-anim-scale'), adEl = $('#el-anim-dir');
      if (axEl) axEl.value = el.dataset.animX || 0;
      if (ayEl) ayEl.value = el.dataset.animY || 0;
      if (asEl) asEl.value = el.dataset.animScale || '1';
      const asv = $('#el-anim-scale-val'); if (asv) asv.textContent = (el.dataset.animScale || '1') + '×';
      if (adEl) adEl.value = el.dataset.animDir || 'left';

      // link
      $('#el-link').value = el.dataset.link || '';
    },

    /** Update just position fields (during drag) */
    updatePropsPosition() {
      if (!this.selected) return;
      $('#el-x').value = Math.round(parseFloat(this.selected.style.left) || 0);
      $('#el-y').value = Math.round(parseFloat(this.selected.style.top) || 0);
    },

    /** Update just size fields (during resize) */
    updatePropsSize() {
      if (!this.selected) return;
      $('#el-w').value = Math.round(parseFloat(this.selected.style.width) || 0);
      $('#el-h').value = Math.round(parseFloat(this.selected.style.height) || 0);
    },

    /** Show/hide fill-related controls based on fill type + shape type */
    _updateFillControls(el) {
      const fillType = ($('#el-fill-type') && $('#el-fill-type').value) || 'solid';
      const shape = el ? el.dataset.shape : '';
      const isSeg = shape === 'line' || shape === 'arrow' || shape === 'curve';
      const f2Block = document.getElementById('el-fill-2-block');
      const imgBlock = document.getElementById('el-fill-img-block');
      const sidesBlock = document.getElementById('el-sides-block');
      const editVtx = document.getElementById('el-edit-vertices');
      const arrowBlock = document.getElementById('el-arrow-block');
      const arrowSizeBlock = document.getElementById('el-arrow-size-block');
      const fillAngleBlock = document.getElementById('el-fill-angle-block');
      const fillSpacingBlock = document.getElementById('el-fill-spacing-block');
      const strokeOnBlock = document.getElementById('el-stroke-on-block');
      const fillNoneBlock = document.getElementById('el-fill-none-block');
      const arrowStyle = ($('#el-arrow') && $('#el-arrow').value) || 'none';
      if (f2Block) f2Block.style.display = (fillType === 'gradient' || fillType === 'hatch' || fillType === 'grid') ? '' : 'none';
      if (imgBlock) imgBlock.style.display = (fillType === 'image') ? '' : 'none';
      if (sidesBlock) sidesBlock.style.display = (shape === 'polygon') ? '' : 'none';
      if (editVtx) editVtx.style.display = (shape === 'freeform') ? '' : 'none';
      if (arrowBlock) arrowBlock.style.display = isSeg ? '' : 'none';
      if (arrowSizeBlock) arrowSizeBlock.style.display = (isSeg && arrowStyle !== 'none') ? '' : 'none';
      if (fillAngleBlock) fillAngleBlock.style.display = (fillType === 'gradient' || fillType === 'hatch' || fillType === 'grid') ? '' : 'none';
      if (fillSpacingBlock) fillSpacingBlock.style.display = (fillType === 'hatch' || fillType === 'grid') ? '' : 'none';
      if (strokeOnBlock) strokeOnBlock.style.display = (!isSeg && shape) ? '' : 'none';
      if (fillNoneBlock) fillNoneBlock.style.display = (!isSeg && shape) ? '' : 'none';
    },

    /** Pick an image for the "image" fill type */
    _pickFillImage() {
      const el = this.selected;
      if (!el) return;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          el.dataset.fillImg = reader.result;
          if (el.dataset.fillType !== 'image') {
            el.dataset.fillType = 'image';
            const ft = $('#el-fill-type');
            if (ft) ft.value = 'image';
            this._updateFillControls(el);
          }
          this.updateFromProps();
          toast('已应用图像填充', 'success');
        };
        reader.readAsDataURL(file);
      };
      input.click();
    },

    /** Apply property panel changes to the selected element */
    updateFromProps() {
      const el = this.selected;
      if (!el) return;
      el.style.left = ($('#el-x').value || 0) + 'px';
      el.style.top = ($('#el-y').value || 0) + 'px';
      el.style.width = Math.max(10, ($('#el-w').value || 10)) + 'px';
      el.style.height = Math.max(10, ($('#el-h').value || 10)) + 'px';
      // re-fit GeoGebra applets after a size change from the property panel
      resizeGgbApplets(el.closest('section') || $('#slides-container'));

      const opacity = parseInt($('#el-opacity').value, 10) / 100;
      el.style.opacity = opacity;

      const rot = parseInt($('#el-rotate').value, 10);
      // 旋转 + 水平/垂直翻转（scale 在右先应用，等价于绕图形自身轴翻转）
      let tf = rot ? 'rotate(' + rot + 'deg)' : '';
      if (el.dataset.flipH === '1') tf += ' scaleX(-1)';
      if (el.dataset.flipV === '1') tf += ' scaleY(-1)';
      el.style.transform = tf;

      // entrance animation
      const entrance = $('#el-entrance').value;
      if (entrance === 'none') {
        delete el.dataset.entrance;
      } else {
        el.dataset.entrance = entrance;
      }

      // custom anim params (trajectory / scale / direction) via CSS vars
      const animX = parseInt($('#el-anim-x') && $('#el-anim-x').value || '0', 10);
      const animY = parseInt($('#el-anim-y') && $('#el-anim-y').value || '0', 10);
      const animScale = parseFloat($('#el-anim-scale') && $('#el-anim-scale').value || '1');
      const animDir = ($('#el-anim-dir') && $('#el-anim-dir').value) || 'left';
      el.style.setProperty('--anim-x', animX + 'px');
      el.style.setProperty('--anim-y', animY + 'px');
      el.style.setProperty('--anim-scale', String(animScale));
      el.dataset.animX = String(animX);
      el.dataset.animY = String(animY);
      el.dataset.animScale = String(animScale);
      el.dataset.animDir = animDir;

      const scaleVal = $('#el-anim-scale-val');
      if (scaleVal) scaleVal.textContent = animScale + '×';

      // link to slide
      const link = $('#el-link').value;
      if (link) {
        el.dataset.link = link;
      } else {
        delete el.dataset.link;
      }

      // shape colors
      if (el.dataset.type === 'shape') {
        const fill = $('#el-fill').value;
        const stroke = $('#el-stroke').value;
        const sw = parseInt($('#el-stroke-w').value, 10) || 0;
        const dash = $('#el-dash') ? $('#el-dash').value : 'solid';
        el.dataset.fill = fill;
        el.dataset.stroke = stroke;
        el.dataset.strokeW = sw;
        el.dataset.dash = dash;
        // fill type + secondary color / image + angle / spacing (values are preserved when switching types)
        const fillType = $('#el-fill-type') ? $('#el-fill-type').value : 'solid';
        el.dataset.fillType = fillType;
        const f2 = $('#el-fill-2');
        if (f2 && (fillType === 'gradient' || fillType === 'hatch' || fillType === 'grid')) el.dataset.fill2 = f2.value;
        const fillAngle = $('#el-fill-angle');
        if (fillAngle && (fillType === 'gradient' || fillType === 'hatch' || fillType === 'grid')) el.dataset.fillAngle = fillAngle.value;
        const fillSpacing = $('#el-fill-spacing');
        if (fillSpacing && (fillType === 'hatch' || fillType === 'grid')) el.dataset.fillSpacing = fillSpacing.value;
        // regular polygon side count
        if (el.dataset.shape === 'polygon') {
          const sides = parseInt($('#el-sides').value, 10) || 5;
          el.dataset.sides = Math.max(3, Math.min(12, sides));
        }
        // arrow head style + size (segment shapes)
        const segCheck = el.dataset.shape === 'line' || el.dataset.shape === 'arrow' || el.dataset.shape === 'curve';
        if (segCheck) {
          el.dataset.arrow = ($('#el-arrow') && $('#el-arrow').value) || 'none';
          const arrowSize = $('#el-arrow-size');
          if (arrowSize) el.dataset.arrowSize = arrowSize.value;
        }
        // stroke on/off toggle (filled shapes only)
        const strokeOn = $('#el-stroke-on');
        if (strokeOn && !segCheck) {
          if (strokeOn.checked) delete el.dataset.strokeOff;
          else el.dataset.strokeOff = '1';
        }
        // 无填充（仅描边）——线段形状不适用
        const fillNone = $('#el-fill-none');
        if (fillNone && !segCheck) {
          if (fillNone.checked) el.dataset.fillNone = '1';
          else delete el.dataset.fillNone;
        }
        // shadow：预设（向后兼容）+ 自定义（颜色/层次/角度）
        const shadow = $('#el-shadow') ? $('#el-shadow').value : 'none';
        if (shadow === 'none') {
          delete el.dataset.shadow;
          delete el.dataset.shadowColor;
          delete el.dataset.shadowDepth;
          delete el.dataset.shadowAngle;
        } else {
          el.dataset.shadow = shadow;
          if (shadow === 'custom') {
            const sc = $('#el-shadow-color');
            if (sc) el.dataset.shadowColor = sc.value;
            const sd = $('#el-shadow-depth');
            if (sd) el.dataset.shadowDepth = sd.value;
            const sa = $('#el-shadow-angle');
            if (sa) el.dataset.shadowAngle = sa.value;
          } else {
            delete el.dataset.shadowColor;
            delete el.dataset.shadowDepth;
            delete el.dataset.shadowAngle;
          }
        }
        // regenerate SVG
        const shapeType = el.dataset.shape;
        const isSeg = shapeType === 'line' || shapeType === 'arrow' || shapeType === 'curve';
        const effSw = el.dataset.strokeOff ? 0 : sw;
        if (isSeg) {
          normalizeSegment(el);
          renderSegment(el);
        } else if (shapeType === 'freeform') {
          renderFreeform(el);
        } else if (Shapes[shapeType]) {
          const spec = fillSpec(el);
          // 满幅矩形（全画布背景/色块）：重渲染时保持无内缩、直角
          let newSvgHtml;
          if (shapeType === 'rect' && el.dataset.bleed === '1') {
            const d = shapeDash(dash, false);
            newSvgHtml = '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">' +
              '<rect x="0" y="0" width="100" height="100" fill="' + spec.ref + '"' +
              (effSw > 0 ? ' stroke="' + stroke + '" stroke-width="' + (effSw * 2) + '"' + (d ? ' stroke-dasharray="' + d + '" stroke-linecap="round"' : '') : '') + '/></svg>';
          } else {
            newSvgHtml = injectDefs(Shapes[shapeType](spec.ref, stroke, effSw, dash, el.dataset.sides), spec.defs);
          }
          const oldSvg = el.querySelector('svg');
          if (oldSvg) {
            oldSvg.outerHTML = newSvgHtml;
          } else {
            el.insertAdjacentHTML('afterbegin', newSvgHtml);
          }
        }
        applyShapeShadow(el);
      }

      syncCurrentSlide();
    },

    /** Initialize global event listeners */
    init() {
      // click outside elements to deselect
      document.addEventListener('mousedown', (e) => {
        if (!this.selected) return;
        if (e.target.closest('.slide-element') || e.target.closest('#props-panel') ||
            e.target.closest('#leftbar') || e.target.closest('#toolbar') || e.target.closest('#shapes-popover') ||
            e.target.closest('#embed-modal') || e.target.closest('#geogebra-modal') || e.target.closest('#settings-modal') ||
            e.target.closest('#theme-modal') || e.target.closest('#layout-modal') ||
            e.target.closest('#chart-modal') ||
            e.target.closest('.format-bar') || e.target.closest('#slide-context-menu') ||
            e.target.closest('#element-context-menu')) return;
        this.deselect();
      });

      // close popover on outside click
      document.addEventListener('mousedown', (e) => {
        const pop = $('#shapes-popover');
        if (pop.classList.contains('hidden')) return;
        if (e.target.closest('#shapes-popover') || e.target.closest('[data-tool="shape"]')) return;
        pop.classList.add('hidden');
      });

      // close context menu on outside click
      document.addEventListener('mousedown', (e) => {
        const menu = $('#slide-context-menu');
        if (menu.classList.contains('hidden')) return;
        if (!e.target.closest('#slide-context-menu')) SlideContextMenu.hide();
      });

      // close context menus on outside click
      document.addEventListener('mousedown', (e) => {
        if (!e.target.closest('#element-context-menu')) ElementContextMenu.hide();
        if (!e.target.closest('#canvas-context-menu')) CanvasContextMenu.hide();
        // export dropdown
        if (!e.target.closest('#export-menu') && !e.target.closest('[data-action="export"]')) {
          const em = $('#export-menu');
          if (em) em.classList.add('hidden');
        }
      });

      // track the last mouse position over the canvas (for paste-at-cursor)
      const canvasArea = $('#canvas-area');
      if (canvasArea) {
        canvasArea.addEventListener('mousemove', (e) => {
          this.lastMouse.x = e.clientX;
          this.lastMouse.y = e.clientY;
        });
        // left-click on empty canvas → marquee select / exit group-edit mode
        canvasArea.addEventListener('mousedown', (e) => {
          if (this._freeform) return; // freeform drawing: points are added via its own click listener
          if (e.target.closest('.slide-element')) return;
          if (e.target.closest('.el-handle') || e.target.closest('.el-endpoint')) return;
          if (e.target.closest('.marquee-box')) return;
          if (e.button !== 0) return;
          if (this._editingGroup) {
            this._editingGroup = null;
            this.deselect();
            toast('已退出组内编辑', 'info');
            return;
          }
          this._startMarquee(e);
        });
        // right-click on empty canvas → "paste here" menu
        canvasArea.addEventListener('contextmenu', (e) => {
          // ignore right-clicks on elements (they handle their own menu)
          if (e.target.closest('.slide-element')) return;
          CanvasContextMenu.show(e);
        });
      }

      // bind element property inputs
      this.bindPropInputs();
    },

    /** Bind all element property panel inputs to update the selected element */
    bindPropInputs() {
      // position / size
      ['el-x', 'el-y', 'el-w', 'el-h'].forEach(id => {
        const inp = $('#' + id);
        if (inp) inp.addEventListener('input', () => this.updateFromProps());
      });

      // rotate
      const rot = $('#el-rotate');
      if (rot) {
        rot.addEventListener('input', () => {
          if (rot.nextElementSibling) rot.nextElementSibling.textContent = rot.value + '°';
          this.updateFromProps();
        });
      }

      // opacity
      const opa = $('#el-opacity');
      if (opa) {
        opa.addEventListener('input', () => {
          const val = $('#el-opacity-val');
          if (val) val.textContent = opa.value + '%';
          this.updateFromProps();
        });
      }

      // lock (锁定)：切换元素锁定状态
      const lockEl = $('#el-lock');
      if (lockEl) {
        const toggleLock = () => {
          const el = this.selected;
          if (!el) return;
          const now = el.dataset.lock === '1';
          if (now) { delete el.dataset.lock; }
          else { el.dataset.lock = '1'; }
          this.updateProps();
          toast(now ? '已解锁' : '已锁定（不可移动/缩放，可再点击解锁）', 'success');
        };
        lockEl.addEventListener('click', toggleLock);
        lockEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleLock(); } });
      }

      // entrance
      const ent = $('#el-entrance');
      if (ent) ent.addEventListener('change', () => this.updateFromProps());

      // custom anim params
      ['#el-anim-x', '#el-anim-y'].forEach(sel => {
        const inp = $(sel);
        if (inp) inp.addEventListener('input', () => this.updateFromProps());
      });
      const asInp = $('#el-anim-scale');
      if (asInp) asInp.addEventListener('input', () => { const v = $('#el-anim-scale-val'); if (v) v.textContent = asInp.value + '×'; this.updateFromProps(); });
      const adInp = $('#el-anim-dir');
      if (adInp) adInp.addEventListener('change', () => this.updateFromProps());

      // link
      const link = $('#el-link');
      if (link) link.addEventListener('change', () => this.updateFromProps());

      // shape colors
      const fillInp = $('#el-fill');
      if (fillInp) fillInp.addEventListener('input', () => {
        // 手动选择填充色时自动取消「无填充」
        const fn = $('#el-fill-none');
        if (fn && fn.checked) {
          fn.checked = false;
          if (this.selected) delete this.selected.dataset.fillNone;
        }
        this.updateFromProps();
      });
      const strokeInp = $('#el-stroke');
      if (strokeInp) strokeInp.addEventListener('input', () => this.updateFromProps());
      // 无填充开关
      const fillNoneBox = $('#el-fill-none');
      if (fillNoneBox) fillNoneBox.addEventListener('change', () => this.updateFromProps());
      // 图形类型切换（保留位置尺寸，重新生成 SVG）
      $$('.st-btn[data-shape-type]').forEach(btn => {
        btn.addEventListener('click', () => {
          if (!this.selected || this.selected.dataset.type !== 'shape') return;
          const el = this.selected;
          const t = btn.dataset.shapeType;
          if (el.dataset.shape === t) return;
          const shapeNames = { rect: '矩形', ellipse: '椭圆', triangle: '三角形', line: '直线', arrow: '箭头',
            polygon: '多边形', diamond: '菱形', star: '五角星', curve: '曲线' };
          el.dataset.shape = t;
          if (t !== 'polygon') delete el.dataset.sides;
          this.updateFromProps();
          this.update();
          this._updateFillControls(el);
          syncCurrentSlide();
          History.push();
          toast('已切换为「' + (shapeNames[t] || t) + '」', 'success');
        });
      });
      // 水平/垂直翻转
      const flipH = $('#el-flip-h');
      if (flipH) flipH.addEventListener('click', () => {
        if (!this.selected) return;
        if (this.selected.dataset.flipH === '1') delete this.selected.dataset.flipH;
        else this.selected.dataset.flipH = '1';
        flipH.classList.toggle('active', this.selected.dataset.flipH === '1');
        this.updateFromProps();
        syncCurrentSlide();
        History.push();
      });
      const flipV = $('#el-flip-v');
      if (flipV) flipV.addEventListener('click', () => {
        if (!this.selected) return;
        if (this.selected.dataset.flipV === '1') delete this.selected.dataset.flipV;
        else this.selected.dataset.flipV = '1';
        flipV.classList.toggle('active', this.selected.dataset.flipV === '1');
        this.updateFromProps();
        syncCurrentSlide();
        History.push();
      });
      const sw = $('#el-stroke-w');
      if (sw) sw.addEventListener('input', () => this.updateFromProps());
      const rad = $('#el-radius');
      if (rad) rad.addEventListener('input', () => this.updateFromProps());
      const dashSel = $('#el-dash');
      if (dashSel) dashSel.addEventListener('input', () => this.updateFromProps());
      const shadowSel = $('#el-shadow');
      if (shadowSel) shadowSel.addEventListener('change', () => {
        if (this.selected) {
          // 切换预设时清除自定义参数，让预设默认生效
          const s = $('#el-shadow').value;
          if (s !== 'custom') {
            delete this.selected.dataset.shadowColor;
            delete this.selected.dataset.shadowDepth;
            delete this.selected.dataset.shadowAngle;
          }
          const sParams = $('#el-shadow-params');
          if (sParams) sParams.style.display = (s !== 'none') ? '' : 'none';
        }
        this.updateFromProps();
      });
      // 图形阴影自定义参数（颜色/层次/角度）：改动即切到「自定义」并生效
      ['#el-shadow-color', '#el-shadow-depth', '#el-shadow-angle'].forEach(sel => {
        const node = $(sel);
        if (!node) return;
        node.addEventListener('input', () => {
          const sSel = $('#el-shadow');
          if (sSel && sSel.value !== 'custom') sSel.value = 'custom';
          const val = $('#el-shadow-angle-val');
          if (val && sel === '#el-shadow-angle') val.textContent = $('#el-shadow-angle').value + '°';
          if (sSel) sSel.dispatchEvent(new Event('change', { bubbles: true }));
        });
      });
      // 文字阴影自定义参数（颜色/层次/角度）：改动即切到「自定义」并生效
      ['#el-tshadow-color', '#el-tshadow-depth', '#el-tshadow-angle'].forEach(sel => {
        const node = $(sel);
        if (!node) return;
        node.addEventListener('input', () => {
          const tsSel = $('#el-tshadow');
          if (tsSel && tsSel.value !== 'custom') tsSel.value = 'custom';
          const val = $('#el-tshadow-angle-val');
          if (val && sel === '#el-tshadow-angle') val.textContent = $('#el-tshadow-angle').value + '°';
          if (tsSel) tsSel.dispatchEvent(new Event('change', { bubbles: true }));
        });
      });
      const arrowSel = $('#el-arrow');
      if (arrowSel) arrowSel.addEventListener('change', () => {
        if (this.selected) this._updateFillControls(this.selected);
        this.updateFromProps();
      });
      const arrowSizeSel = $('#el-arrow-size');
      if (arrowSizeSel) arrowSizeSel.addEventListener('input', () => {
        const v = $('#el-arrow-size-val');
        if (v) v.textContent = arrowSizeSel.value + '%';
        this.updateFromProps();
      });

      // fill type / secondary color / angle / spacing / polygon sides / vertex editing
      const fillTypeSel = $('#el-fill-type');
      if (fillTypeSel) fillTypeSel.addEventListener('change', () => {
        if (this.selected) this._updateFillControls(this.selected);
        this.updateFromProps();
      });
      const fill2 = $('#el-fill-2');
      if (fill2) fill2.addEventListener('input', () => this.updateFromProps());
      const fillAngle = $('#el-fill-angle');
      if (fillAngle) fillAngle.addEventListener('input', () => {
        const v = $('#el-fill-angle-val');
        if (v) v.textContent = fillAngle.value + '°';
        this.updateFromProps();
      });
      const fillSpacing = $('#el-fill-spacing');
      if (fillSpacing) fillSpacing.addEventListener('input', () => this.updateFromProps());
      const strokeOn = $('#el-stroke-on');
      if (strokeOn) strokeOn.addEventListener('change', () => this.updateFromProps());
      const sidesSel = $('#el-sides');
      if (sidesSel) sidesSel.addEventListener('input', () => this.updateFromProps());
      const fillImgBtn = $('#el-fill-img-btn');
      if (fillImgBtn) fillImgBtn.addEventListener('click', () => this._pickFillImage());
      const editVtxBtn = $('#el-edit-vertices-btn');
      if (editVtxBtn) editVtxBtn.addEventListener('click', () => this.startVertexEdit(this.selected));

      // text props
      const tColor = $('#el-text-color');
      if (tColor) tColor.addEventListener('input', () => {
        if (this.selected) {
          const textEl = this.selected.querySelector('.el-text');
          if (textEl) {
            textEl.style.color = tColor.value;
            // 模板文字的颜色常写在内层 <span> 的内联样式里，会覆盖容器颜色；
            // 统一覆盖子级 span 颜色，确保取色后文字立即变色（渐变文字除外，
            // 渐变由 applyTextEffects 用 background-clip 处理）。
            if (!this.selected.dataset.grad) {
              $$('span[style*="color"]', textEl).forEach(s => { s.style.color = tColor.value; });
            }
            applyTextEffects(this.selected);
            syncColorSwatch(tColor.value);
          } else {
            this.selected.style.color = tColor.value;
          }
          syncCurrentSlide();
        }
      });
      const tBg = $('#el-bg-color');
      if (tBg) tBg.addEventListener('input', () => {
        if (this.selected) {
          this.selected.style.background = tBg.value;
          syncCurrentSlide();
        }
      });
      const tBgClear = $('#el-bg-clear');
      if (tBgClear) tBgClear.addEventListener('click', () => {
        if (this.selected) {
          this.selected.style.background = '';
          tBg.value = '#ffffff';
          syncCurrentSlide();
        }
      });
      const tFf = $('#el-font-family');
      if (tFf) tFf.addEventListener('change', () => {
        if (this.selected) {
          const textEl = this.selected.querySelector('.el-text');
          if (textEl) {
            textEl.style.fontFamily = tFf.value || '';
            syncCurrentSlide();
          }
        }
      });
      const tFw = $('#el-font-weight');
      if (tFw) tFw.addEventListener('change', () => {
        if (this.selected) {
          const textEl = this.selected.querySelector('.el-text');
          if (textEl) {
            textEl.style.fontWeight = tFw.value || '';
            syncCurrentSlide();
          }
        }
      });
      const tFs = $('#el-font-size');
      if (tFs) tFs.addEventListener('input', () => {
        if (this.selected) {
          const textEl = this.selected.querySelector('.el-text');
          if (textEl) textEl.style.fontSize = tFs.value + 'px';
          syncCurrentSlide();
        }
      });
      const tLh = $('#el-line-height');
      if (tLh) tLh.addEventListener('input', () => {
        if (this.selected) {
          const textEl = this.selected.querySelector('.el-text');
          if (textEl) textEl.style.lineHeight = tLh.value;
          syncCurrentSlide();
        }
      });
      const tLs = $('#el-letter-spacing');
      if (tLs) tLs.addEventListener('input', () => {
        if (this.selected) {
          const textEl = this.selected.querySelector('.el-text');
          if (textEl) textEl.style.letterSpacing = tLs.value + 'px';
          syncCurrentSlide();
        }
      });

      // text layout buttons
      $$('.layout-opt').forEach(btn => {
        btn.addEventListener('click', () => {
          if (!this.selected) return;
          const textEl = this.selected.querySelector('.el-text');
          if (textEl) {
            const al = btn.dataset.textLayout;
            // .el-text is flex; text-align alone doesn't move it — set BOTH
            // justifyContent (flex horizontal) and textAlign (for inline spans).
            textEl.style.textAlign = al;
            textEl.style.justifyContent = al;
            $$('.layout-opt').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            syncCurrentSlide();
          }
        });
      });

      // vertical align (align-items) buttons
      const vAlignWrap = $('#el-valign');
      if (vAlignWrap) {
        vAlignWrap.addEventListener('click', (e) => {
          const btn = e.target.closest('.valign-opt');
          if (!btn || !this.selected) return;
          const textEl = this.selected.querySelector('.el-text');
          if (textEl) {
            textEl.style.alignItems = btn.dataset.valign;
            vAlignWrap.querySelectorAll('.valign-opt').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            syncCurrentSlide();
          }
        });
      }

      // image fit mode
      const imgFit = $('#el-img-fit');
      if (imgFit) imgFit.addEventListener('change', () => {
        if (this.selected && this.selected.dataset.type === 'image') {
          const imgEl = this.selected.querySelector('.el-image');
          if (imgEl) {
            imgEl.style.objectFit = imgFit.value;
            syncCurrentSlide();
          }
        }
      });

      // image ambient animation (Ken Burns)
      const imgAnim = $('#el-img-anim');
      if (imgAnim) imgAnim.addEventListener('change', () => {
        if (this.selected && this.selected.dataset.type === 'image') {
          if (imgAnim.value) {
            this.selected.dataset.imgAnim = imgAnim.value;
          } else {
            delete this.selected.dataset.imgAnim;
          }
          syncCurrentSlide();
          History.push();
        }
      });

      // count-up number animation (text)
      const cuBox = $('#el-countup');
      if (cuBox) cuBox.addEventListener('change', () => {
        if (this.selected && this.selected.dataset.type === 'text') {
          if (cuBox.checked) {
            this.selected.dataset.countup = '1';
            toast('已开启数字滚动：演示时数字从 0 滚动到目标值', 'success');
          } else {
            delete this.selected.dataset.countup;
          }
          syncCurrentSlide();
        }
      });

      // text display effects
      const fxInputs = ['#el-hl', '#el-hl-color', '#el-grad', '#el-grad-from', '#el-grad-to',
        '#el-tshadow', '#el-tstroke', '#el-tstroke-color', '#el-tstroke-w', '#el-dropcap',
        '#el-enter-hl', '#el-rfit'];
      fxInputs.forEach(sel => {
        const node = $(sel);
        if (!node) return;
        const evt = (node.type === 'checkbox' || node.tagName === 'SELECT') ? 'change' : 'input';
        node.addEventListener(evt, () => {
          if (!this.selected || this.selected.dataset.type !== 'text') return;
          const el = this.selected;
          const hl = $('#el-hl'), hlC = $('#el-hl-color');
          if (hl.checked) { el.dataset.hl = hlC.value; } else { delete el.dataset.hl; }
          const gb = $('#el-grad'), gf = $('#el-grad-from'), gt = $('#el-grad-to');
          if (gb.checked) { el.dataset.grad = '1'; el.dataset.gradFrom = gf.value; el.dataset.gradTo = gt.value; }
          else { delete el.dataset.grad; delete el.dataset.gradFrom; delete el.dataset.gradTo; }
          const ts = $('#el-tshadow');
          if (ts.value === 'none') {
            delete el.dataset.tshadow;
            delete el.dataset.tshadowColor;
            delete el.dataset.tshadowDepth;
            delete el.dataset.tshadowAngle;
          } else {
            el.dataset.tshadow = ts.value;
            if (ts.value === 'custom') {
              // 自定义阴影：颜色 + 层次 + 角度
              const tsc = $('#el-tshadow-color');
              if (tsc) el.dataset.tshadowColor = tsc.value;
              const tsd = $('#el-tshadow-depth');
              if (tsd) el.dataset.tshadowDepth = tsd.value;
              const tsa = $('#el-tshadow-angle');
              if (tsa) el.dataset.tshadowAngle = tsa.value;
            } else {
              // 预设：清除自定义参数，让预设默认生效（向后兼容）
              delete el.dataset.tshadowColor;
              delete el.dataset.tshadowDepth;
              delete el.dataset.tshadowAngle;
            }
            const tsParams = $('#el-tshadow-params');
            if (tsParams) tsParams.style.display = '';
          }
          const sb = $('#el-tstroke'), sc = $('#el-tstroke-color'), sw = $('#el-tstroke-w');
          if (sb.checked) { el.dataset.stroke = '1'; el.dataset.strokeColor = sc.value; el.dataset.strokeW = sw.value; }
          else { delete el.dataset.stroke; delete el.dataset.strokeColor; delete el.dataset.strokeW; }
          const dc = $('#el-dropcap');
          if (dc.checked) { el.dataset.dropcap = '1'; } else { delete el.dataset.dropcap; }
          const ehSel = $('#el-enter-hl');
          if (ehSel && ehSel.value) { el.dataset.enterHl = ehSel.value; } else { delete el.dataset.enterHl; }
          const rfitBox = $('#el-rfit');
          if (rfitBox && rfitBox.checked) { el.dataset.rfit = '1'; } else { delete el.dataset.rfit; }
          applyTextEffects(el);
          syncCurrentSlide();
        });
      });

      // typography chips (bold/italic/underline/strike/uppercase/smallcaps)
      $$('.fx-chip[data-tfx]').forEach(chip => {
        chip.addEventListener('click', () => {
          if (!this.selected || this.selected.dataset.type !== 'text') return;
          chip.classList.toggle('active');
          const tfx = Array.from($$('.fx-chip[data-tfx].active')).map(c => c.dataset.tfx);
          if (tfx.length) this.selected.dataset.tfx = tfx.join(' ');
          else delete this.selected.dataset.tfx;
          applyTextEffects(this.selected);
          syncCurrentSlide();
        });
      });

      // chart edit button
      const chartEditBtn = $('[data-action="el-edit-chart"]');
      if (chartEditBtn) chartEditBtn.addEventListener('click', () => {
        if (this.selected && this.selected.dataset.type === 'chart') {
          Toolbar.openChart(this.selected);
        }
      });

      // table add / delete rows & columns
      const tableEl = this.selected && this.selected.dataset.type === 'table' ? this.selected : null;
      const applyTableDelta = (dr, dc) => {
        if (!tableEl) return;
        const cfg = Table.readConfig(tableEl);
        cfg.rows = Math.max(1, Math.min(10, cfg.rows + dr));
        cfg.cols = Math.max(1, Math.min(8, cfg.cols + dc));
        cfg.content = null;
        Table.apply(tableEl, cfg);
        syncCurrentSlide();
        History.push();
        // reposition size a bit
        tableEl.style.width = Math.max(220, Math.min(720, cfg.cols * 140)) + 'px';
        tableEl.style.height = Math.max(80, Math.min(520, (cfg.header ? cfg.rows + 1 : cfg.rows) * 40)) + 'px';
        toast(dr ? (dr > 0 ? '已添加一行' : '已删除一行') : (dc > 0 ? '已添加一列' : '已删除一列'), 'success');
      };
      $$('[data-action="table-add-row"]').forEach(b => b.addEventListener('click', () => applyTableDelta(1, 0)));
      $$('[data-action="table-del-row"]').forEach(b => b.addEventListener('click', () => applyTableDelta(-1, 0)));
      $$('[data-action="table-add-col"]').forEach(b => b.addEventListener('click', () => applyTableDelta(0, 1)));
      $$('[data-action="table-del-col"]').forEach(b => b.addEventListener('click', () => applyTableDelta(0, -1)));

      // image change button
      const imgChangeBtn = $('[data-action="el-change-image"]');
      if (imgChangeBtn) imgChangeBtn.addEventListener('click', () => {
        if (this.selected && this.selected.dataset.type === 'image') {
          const imgEl = this.selected.querySelector('.el-image');
          if (imgEl) {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = () => {
              const file = input.files[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                imgEl.src = reader.result;
                syncCurrentSlide();
                toast('图片已更换', 'success');
              };
              reader.readAsDataURL(file);
            };
            input.click();
          }
        }
      });


      // fragment toggle
      const fragBtn = $('#el-fragment-btn');
      if (fragBtn) fragBtn.addEventListener('click', () => this.toggleFragment());

      // delete element
      const delBtn = $('[data-action="delete-element"]');
      if (delBtn) delBtn.addEventListener('click', () => this.delete());

      // layering + duplicate
      const frontBtn = $('[data-action="el-front"]');
      if (frontBtn) frontBtn.addEventListener('click', () => this.bringToFront());
      const backBtn = $('[data-action="el-back"]');
      if (backBtn) backBtn.addEventListener('click', () => this.sendToBack());
      const dupBtn = $('[data-action="el-duplicate"]');
      if (dupBtn) dupBtn.addEventListener('click', () => this.duplicate());
    },
  };

  /* ===== Layout picker ===== */
  function layoutName(layout) {
    const names = {
      title: '标题页', content: '内容页', 'two-col': '双栏',
      image: '图文', code: '代码', quote: '引用',
      section: '章节页', bento: 'Bento 网格', blank: '空白页',
      'title-only': '仅标题', 'content-caption': '内容与标题',
      'picture-caption': '图片与标题', 'vertical-text': '竖排文字', agenda: '议程',
      'geogebra-applet': 'GeoGebra 互动', 'desmos-applet': 'Desmos 互动', 'iframe-applet': '网页嵌入',
      stats: '数据统计', cards: '卡片网格', checklist: '待办清单', roadmap: '发展路线', qa: '快问快答',
      'learning-goals': '学习目标', 'key-points': '重难点', homework: '分层作业', rubric: '评价量表', review: '课后小结',
      'p-stats': '数据一览', 'p-case': '案例研究', 'p-plan': '行动计划', 'p-qa': '互动问答', 'p-numbers': '数字金句',
      'p-cover-center': '居中封面', 'p-cover-card': '卡片封面', 'p-cover-grid': '网格封面', 'p-cover-side': '侧条封面',
  'knowledge-summary': '知识点梳理',
  'example-problem': '典型例题',
  'multi-solution': '一题多解',
  'common-mistakes': '易错警示',
  'method-summary': '方法总结',
  'exam-question': '高考真题',
  'formula-card': '公式定理',
  'comparison': '对比辨析',
  'mind-map': '知识网络',
  'practice': '课堂练习',
  'variant-training': '变式训练',
  'answer-standard': '答题规范',
  'chapter-intro': '章节导入',
  'blackboard': '推导过程',
  'problem-breakdown': '综合拆解',
  'p-cover': '大字封面', 'p-cover-hero': '渐变封面', 'p-cover-split': '分屏封面',
  'p-cover-minimal': '极简封面', 'p-toc': '目录页', 'p-toc-cards': '目录卡片',
  'p-section': '章节过渡', 'p-section-num': '数字过渡', 'p-section-band': '色带过渡',
  'p-title': '内容标题', 'p-points': '要点列表', 'p-imagetext': '图文混排',
  'p-about': '关于我们', 'p-team': '核心团队', 'p-service': '服务优势',
  'p-contact': '联系我们', 'p-gallery': '作品展示',
  'p-data': '数据展示', 'p-compare': '对比页', 'p-timeline': '发展时间线',
  'p-steps': '流程步骤', 'p-quote': '引言页', 'p-thanks': '结尾致谢',
  'math-cover': '讲义封面', 'math-formula': '公式定理', 'math-example': '典型例题', 'math-proof': '证明题', 'math-solution': '一题多解',
  'math-map': '知识框架', 'math-notes': '课堂笔记', 'math-exercise': '课堂练习', 'math-mistake': '易错警示',
  'math-graph': '函数图像', 'math-problem': '综合大题', 'math-key': '考点归纳', 'math-review': '章节小结',
  'math-func': '函数专题', 'math-deriv': '导数专题', 'math-seq': '数列专题', 'math-trig': '三角函数',
  'math-conic': '圆锥曲线', 'math-prob': '概率统计', 'math-ineq': '不等式', 'math-calc': '计算题',
    };
    return names[layout] || layout;
  }

  const LayoutPicker = {
    open() {
      $('#layout-modal').classList.remove('hidden');
    },
    close() {
      $('#layout-modal').classList.add('hidden');
    },
  };

  /* ===== Template library (basic / teaching / pro templates) ===== */

  /* 去 AI 味 / 贴近 PPT：把 Pro 模板输出做集中归一化，避免逐处硬编码修改。
     - 标题字重 900/800 -> 700（去掉 AI 味的超黑标题）
     - 大标题挤压字距 -.02em -> -.01em
     - 刻意大字距导语 .30em/.26em -> .18em
     - 过重的三色渐变文字 -> 主色（配合 Themes/P 已收敛的同色系渐变）
     - 硬投影 6px 6px 0 rgba(...,0.16/0.45) -> 柔和商业阴影 */
  function deAIFyPro(html) {
    if (!html) return html;
    let out = html
      .replace(/font-weight:900/g, 'font-weight:700')
      .replace(/font-weight:800/g, 'font-weight:700')
      .replace(/(letter-spacing:\s*)-\.02em/g, '$1-.01em')
      .replace(/(letter-spacing:\s*)\.3?0em/g, '$1.18em')
      .replace(/(letter-spacing:\s*)\.26em/g, '$1.18em')
      .replace(/(6px 6px 0 rgba\([^)]+\))/g, '0 10px 30px rgba(15,23,42,0.10), 0 2px 8px rgba(15,23,42,0.05)');
    // 渐变文字 -> 纯色（PPT 质感）：匹配 style 里的
    //   background:linear-gradient(...);-webkit-background-clip:text;background-clip:text;
    //   -webkit-text-fill-color:transparent;color:#xxxx;
    // 去掉 background/clip/transparent，只留 color。
    out = out.replace(/background:linear-gradient\([^)]*\);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:(#[0-9a-fA-F]{3,8});/g,
      'color:$1;');
    return out;
  }
  const TemplateLibrary = {
    cats: [
      { id: 'basic', name: '基础布局',
        layouts: ['title', 'content', 'two-col', 'image', 'code', 'quote', 'section', 'bento', 'blank',
          'title-only', 'content-caption', 'picture-caption', 'vertical-text', 'agenda',
          'stats', 'cards', 'checklist', 'roadmap', 'qa',
          'geogebra-applet', 'desmos-applet', 'iframe-applet'] },
      { id: 'teaching', name: '教学模板',
        layouts: ['knowledge-summary', 'example-problem', 'multi-solution', 'common-mistakes',
          'method-summary', 'exam-question', 'formula-card', 'comparison', 'mind-map', 'practice',
          'variant-training', 'answer-standard', 'chapter-intro', 'blackboard', 'problem-breakdown',
          'learning-goals', 'key-points', 'homework', 'rubric', 'review'] },
      { id: 'math', name: '高中数学讲义',
        layouts: ['math-cover', 'math-formula', 'math-example', 'math-proof', 'math-solution', 'math-map', 'math-notes', 'math-exercise', 'math-mistake', 'math-graph', 'math-problem', 'math-key', 'math-review'] },
      { id: 'pro', name: '专业模板',
        layouts: ['p-cover', 'p-cover-hero', 'p-cover-split', 'p-cover-minimal',
          'p-cover-center', 'p-cover-card', 'p-cover-grid', 'p-cover-side',
          'p-toc', 'p-toc-cards', 'p-section', 'p-section-num', 'p-section-band',
          'p-title', 'p-points', 'p-imagetext',
          'p-about', 'p-team', 'p-service', 'p-contact', 'p-gallery',
          'p-data', 'p-compare', 'p-timeline', 'p-steps', 'p-quote', 'p-thanks',
          'p-stats', 'p-case', 'p-plan', 'p-qa', 'p-numbers',
          'p-cover-serif', 'p-magazine', 'p-quote-serif', 'p-data-ledger'] },
    ],
    themes: ['business', 'dark', 'nature'],
    activeTheme: 'business',
    activeStyle: '',   // 风格卡覆盖：''=用主题配色；否则用 DTK 风格 token

    open(cat) {
      const modal = $('#template-modal');
      if (!modal) return;
      modal.classList.remove('hidden');
      this.render(cat || 'basic');
    },

    close() {
      $('#template-modal').classList.add('hidden');
    },

    theme() {
      // 若选了风格卡，则用 DTK 生成符合设计宪法的 token 主题；否则用规范化主题色。
      if (this.activeStyle) {
        const s = DTK.xStyle(this.activeStyle);
        return {
          id: this.activeStyle, name: this.activeStyle,
          bg: s.paper, primary: s.primary, secondary: s.muted, accent: s.accent,
          success: s.g, fg: s.ink, sub: s.muted, faint: s.muted, light: s.surface,
          ink: s.ink, paper: s.paper, shadow: s.shadow,
        };
      }
      return Themes[this.activeTheme] || Themes.business;
    },

    render(catId) {
      const grid = $('#template-grid');
      if (!grid) return;
      const cat = this.cats.find(c => c.id === catId) || this.cats[0];
      // highlight active tab
      $$('#template-modal .template-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.tcat === cat.id));
      // theme switcher bar: shown only on the pro tab
      const bar = $('#template-theme-bar');
      if (bar) {
        bar.classList.toggle('hidden', cat.id !== 'pro');
        $$('#template-theme-bar .theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === this.activeTheme));
      }
      const isPro = cat.id === 'pro';
      const isMath = cat.id === 'math';
      const theme = this.theme();
      grid.innerHTML = '';
      cat.layouts.forEach(layout => {
        const src = isMath ? MathLecture : (isPro ? ProLayouts : Layouts);
        const fn = src[layout];
        const card = document.createElement('div');
        card.className = 'template-card';
        const name = layoutName(layout) || layout;
        let preview = '<div class="template-preview"><span class="tpl-fallback">' + this.previewLabel(layout) + '</span></div>';
        if (fn) {
          // render the preview fitted to the current page size/ratio so it
          // matches exactly what 「追加/替换」will insert
          const dims = stageDims();
          const html = Store.sanitizeContent(fitTemplateHtml(fn(isPro ? theme : null), dims));
          const k = Math.min(240 / dims.w, 175 / dims.h);
          preview = '<div class="template-preview">' +
            '<div class="tpl-preview-stage" style="pointer-events:none;width:' + dims.w + 'px;height:' + dims.h + 'px;' +
            'left:50%;top:50%;transform:translate(-50%,-50%) scale(' + k.toFixed(4) + ');transform-origin:center center;">' + html + '</div>' +
            (isPro ? '<span class="tpl-theme-badge">' + theme.name + '</span>' : '') +
            '</div>';
        }
        card.innerHTML = preview +
          '<div class="template-card-name"><span>' + name + '</span>' +
          '<span class="template-card-actions">' +
          '<button class="btn btn-xs" data-tpl-append="' + layout + '">追加</button>' +
          '<button class="btn btn-xs" data-tpl-replace="' + layout + '">替换</button>' +
          '<button class="btn btn-xs btn-subpage" data-tpl-subpage="' + layout + '" title="在当前章节下添加为子页（上下切换）">子页</button>' +
          '<button class="btn btn-xs" data-tpl-bg="' + layout + '" title="仅替换当前页的背景图形，保留文字/图片等元素">背景</button>' +
          '</span></div>';
        grid.appendChild(card);
      });
      $('#template-hint').textContent = (isPro ? '「' + theme.name + '」主题 · ' : '') +
        '「追加」插入到末尾 · 「替换」覆盖当前页 · 「子页」加入当前章节 · 「背景」只换背景不丢元素 · 共 ' + cat.layouts.length + ' 个模板';
    },

    /** tiny CSS-drawn preview label per layout (fallback when no real preview) */
    previewLabel(layout) {
      const labels = {
        title: 'T 封面', content: '☰ 内容', 'two-col': '◫ 双栏', image: '🖼 图文',
        code: '‹/› 代码', quote: '" 引用', section: '§ 章节', bento: '▦ Bento', blank: '□ 空白',
        'title-only': 'T 仅标题', 'content-caption': '▤ 内容与标题', 'picture-caption': '🖼 图片与标题',
        'vertical-text': '⇊ 竖排文字', agenda: '☰ 议程',
        'geogebra-applet': '📐 GGB', 'desmos-applet': '📈 DES', 'iframe-applet': '🌐 嵌入',
        stats: '▦ 数据', cards: '▦ 卡片', checklist: '✔ 清单', roadmap: '⏳ 路线', qa: '？ 问答',
        'learning-goals': '🎯 目标', 'key-points': '⚡ 重难点', homework: '📚 作业', rubric: '★ 量表', review: '🔁 小结',
        'p-stats': '▦ 数据墙', 'p-case': '📁 案例', 'p-plan': '🗺 计划', 'p-qa': '？ 问答', 'p-numbers': '# 数字',
        'p-cover-center': '◈ 居中', 'p-cover-card': '▣ 卡片', 'p-cover-grid': '▦ 网格', 'p-cover-side': '▌ 侧条',
        'knowledge-summary': '📋 梳理', 'example-problem': '✏ 例题', 'multi-solution': '♻ 多解',
        'common-mistakes': '⚠ 警示', 'method-summary': '∑ 总结', 'exam-question': '🎯 真题',
        'formula-card': '🧾 公式', comparison: '⇄ 辨析', 'mind-map': '🌐 网络',
        practice: '✍ 练习', 'variant-training': '🔁 变式', 'answer-standard': '✔ 规范',
        'chapter-intro': '🚪 导入', blackboard: '▦ 板书', 'problem-breakdown': '🔧 拆解',
        'p-cover': '◈ 封面', 'p-cover-hero': '◈ 渐变', 'p-cover-split': '◫ 分屏',
        'p-cover-minimal': '◈ 极简', 'p-toc': '☷ 目录', 'p-toc-cards': '▦ 目录卡',
        'p-section': '§ 过渡', 'p-section-num': '② 数字', 'p-section-band': '▌ 色带',
        'p-title': 'T 标题', 'p-points': '▸ 要点', 'p-imagetext': '🖼 图文',
        'p-about': '👥 关于', 'p-team': '👤 团队', 'p-service': '◆ 服务',
        'p-contact': '✉ 联系', 'p-gallery': '▦ 作品',
        'p-data': '▥ 数据', 'p-compare': '⇄ 对比', 'p-timeline': '⏳ 时间线',
        'p-steps': '➜ 流程', 'p-quote': '" 引言', 'p-thanks': '✶ 致谢',
        'p-cover-serif': '衬线封面', 'p-magazine': '衬线杂志', 'p-quote-serif': '衬线引言', 'p-data-ledger': '数据账本',
      };
      return labels[layout] || '▣';
    },

    insert(layout, mode) {
      const isMath = layout.indexOf('math-') === 0;
      const isPro = layout.indexOf('p-') === 0;
      const src = isMath ? MathLecture : (isPro ? ProLayouts : Layouts);
      const fn = src[layout];
      if (!fn) { toast('模板不存在', 'error'); return; }
      const content = Store.sanitizeContent(deAIFyPro(fitTemplateHtml(fn(isPro ? this.theme() : null))));
      // 专业模板用纸色作为页面背景：Reveal 的 4% 留白区被染成纸色，模板满幅无缝 1280×720
      const paperBg = isPro ? { color: this.theme().paper || '#F6F1E7' } : null;
      if (mode === 'replace') {
        if (!project.slides.length) return;
        VersionControl.save('替换模板前 · ' + VersionControl.autoName());
        const target = Nav.activeSlide(currentIndex, currentV) || project.slides[Math.min(currentIndex, project.slides.length - 1)];
        target.content = content;
        target.bg = paperBg;
        History.push();
        Preview.render();
        toast('已用模板替换当前页：「' + layoutName(layout) + '」', 'success');
      } else if (mode === 'subpage') {
        // Add as a sub-page of the current chapter (creating it if needed).
        if (!project.slides.length) return;
        const chapterIdx = Math.max(0, Math.min(currentIndex, project.slides.length - 1));
        if (!Array.isArray(project.slides[chapterIdx].children)) {
          project.slides[chapterIdx].children = [];
        }
        const child = { id: uid(), content: content, bg: paperBg, notes: '' };
        project.slides[chapterIdx].children.push(child);
        History.push();
        currentV = project.slides[chapterIdx].children.length; // last child vertical
        Preview.render();
        editorDeck.slide(currentIndex, currentV);
        toast('已在章节下新增子页：「' + layoutName(layout) + '」', 'success');
      } else {
        // append to the end and jump to it
        const slide = { id: uid(), content: content, bg: paperBg, notes: '' };
        project.slides.push(slide);
        History.push();
        currentIndex = project.slides.length - 1;
        Preview.render();
        toast('已在末尾追加模板页：「' + layoutName(layout) + '」', 'success');
      }
      // 渲染新插入页的数学公式（MathJax），如 math-* 模板里的 \(...\) 内联公式
      renderMath($('#slides-container'));
      this.close();
    },

    /** Replace only the current slide's background/decoration (shape elements)
     *  with the chosen template's shapes — existing text/image/chart/embed
     *  elements are preserved ("替换背景不丢元素"). */
    insertBackground(layout) {
      const isPro = layout.indexOf('p-') === 0;
      const src = isPro ? ProLayouts : Layouts;
      const fn = src[layout];
      if (!fn) { toast('模板不存在', 'error'); return; }
      const tplHtml = Store.sanitizeContent(deAIFyPro(fitTemplateHtml(fn(isPro ? this.theme() : null))));
      const doc = new DOMParser().parseFromString('<div>' + tplHtml + '</div>', 'text/html');
      const tplShapes = Array.from(doc.querySelectorAll('.slide-element[data-type="shape"]'));
      if (!tplShapes.length) { toast('该模板没有背景图形', 'info'); this.close(); return; }
      const active = Nav.activeSlide(currentIndex, currentV);
      const section = active ? sectionById(active.id) : $$('#slides-container > section')[currentIndex];
      if (!section) { this.close(); return; }
      // remove current decoration (shape elements) but keep content elements
      $$('.slide-element[data-type="shape"]', section).forEach(el => el.remove());
      // prepend the template shapes so they sit behind existing content (keep order)
      const frag = document.createDocumentFragment();
      tplShapes.forEach(s => frag.appendChild(s));
      section.insertBefore(frag, section.firstChild);
      tplShapes.forEach(s => Elements.bindElement(s));
      syncCurrentSlide();
      History.push();
      toast('已替换背景（保留现有元素）：「' + layoutName(layout) + '」', 'success');
      this.close();
    },
  };

  /* ===== SmartArt (PowerPoint 风格图示库) =====
     每个图示插入一组可独立编辑的 slide-element（文本 / 矩形 / 箭头 / 连线等），
     位置按当前页面尺寸的比例计算，因此适配 16:9、4:3、方形与 A4。 */
  const SmartArt = {
    cats: [
      { id: 'process', name: '流程' },
      { id: 'hierarchy', name: '层次' },
      { id: 'matrix', name: '矩阵' },
      { id: 'pyramid', name: '棱锥' },
      { id: 'cycle', name: '循环' },
      { id: 'venn', name: '维恩' },
      { id: 'list', name: '列表' },
      { id: 'radial', name: '放射' },
    ],

    /* each item: { id, cat, name, svg (card preview), build() -> html } */
    items: [],

    init() {
      const c = activeTheme();
      const d = stageDims();
      const X = f => Math.round(d.w * f);
      const Y = f => Math.round(d.h * f);
      const FS = f => Math.round(Y(f)); // font sizes proportional to page height
      const tones = [c.primary, c.secondary, c.accent, c.success];
      const rgbaT = (hex, a) => 'rgba(' + hexRgb(hex) + ',' + a + ')';
      // 连接线/箭头用主题色半透明，视觉更统一
      const conn = rgbaT(c.primary, 0.38);
      // 颜色加深/变浅（用于渐变第二停靠点）
      const shade = (hex, pct) => {
        const n = parseInt(hex.replace('#', ''), 16);
        const cl = (v) => Math.max(0, Math.min(255, v + pct));
        return '#' + ((1 << 24) + (cl((n >> 16) & 255) << 16) + (cl((n >> 8) & 255) << 8) + cl(n & 255)).toString(16).slice(1);
      };
      // 节点卡片：去 AI 味——纯色扁平 + 细边框 + 克制阴影；不用 emoji，改用几何点缀。
      const node = (x, y, w, h, title, note, bg, fg, icon) => {
        const solid = bg.charAt(0) === '#';
        const r = FS(0.016);
        const bgCss = solid
          ? 'background:' + bg + ';' +
            'border:1px solid ' + rgbaT(bg, 0.55) + ';' +
            'box-shadow:0 ' + FS(0.01) + 'px ' + FS(0.02) + 'px ' + rgbaT(c.dark || '#0F172A', 0.10) + ';'
          : 'background:' + bg + ';border:1px solid ' + rgbaT(c.primary, 0.18) + ';' +
            'box-shadow:0 ' + FS(0.005) + 'px ' + FS(0.014) + 'px ' + rgbaT(c.dark || '#0F172A', 0.06) + ';';
        // 几何点缀（小圆点），替代 emoji 图标
        const dot = icon
          ? '<span style="width:' + FS(0.024) + 'px;height:' + FS(0.024) + 'px;border-radius:50%;background:' + (fg === '#ffffff' ? 'rgba(255,255,255,0.9)' : rgbaT(bg, 0.9)) + ';flex:none;"></span>'
          : '';
        return tEl('el_' + uid(), X(x), Y(y), X(w), Y(h),
          '<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:' + Math.max(4, FS(0.011)) + 'px;text-align:center;padding:' + FS(0.014) + 'px ' + FS(0.018) + 'px;box-sizing:border-box;">' +
          dot +
          '<span style="font-size:' + FS(0.03) + 'px;font-weight:700;color:' + fg + ';line-height:1.3;">' + title + '</span>' +
          (note ? '<span style="font-size:' + FS(0.019) + 'px;color:' + (fg === '#ffffff' ? 'rgba(255,255,255,0.82)' : c.sub) + ';line-height:1.5;">' + note + '</span>' : '') +
          '</div>',
          'border-radius:' + r + 'px;' + bgCss);
      };
      const shape = (kind, x, y, w, h, color, extra) => {
        const eid = 'el_' + uid();
        if (kind === 'arrow') {
          return '<div class="slide-element" data-type="shape" data-shape="arrow" data-eid="' + eid + '"' +
            ' data-fill="' + color + '" data-stroke="' + color + '" data-stroke-w="4" data-dash="solid" contenteditable="false"' +
            ' style="position:absolute;left:' + X(x) + 'px;top:' + Y(y) + 'px;width:' + X(w) + 'px;height:' + Y(h) + 'px;">' +
            '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none"><path d="M2 50 L68 50 M56 34 L86 50 L56 66" stroke="' + color + '" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"></path></svg></div>';
        }
        if (kind === 'hline') {
          return '<div class="slide-element" data-type="shape" data-shape="line" data-eid="' + eid + '"' +
            ' data-fill="' + color + '" data-stroke="' + color + '" data-stroke-w="3" data-dash="solid" contenteditable="false"' +
            ' style="position:absolute;left:' + X(x) + 'px;top:' + Y(y) + 'px;width:' + X(w) + 'px;height:' + Y(h) + 'px;">' +
            '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none"><line x1="0" y1="50" x2="100" y2="50" stroke="' + color + '" stroke-width="3" stroke-linecap="round" vector-effect="non-scaling-stroke"></line></svg></div>';
        }
        if (kind === 'vline') {
          return '<div class="slide-element" data-type="shape" data-shape="line" data-eid="' + eid + '"' +
            ' data-fill="' + color + '" data-stroke="' + color + '" data-stroke-w="3" data-dash="solid" contenteditable="false"' +
            ' style="position:absolute;left:' + X(x) + 'px;top:' + Y(y) + 'px;width:' + X(w) + 'px;height:' + Y(h) + 'px;">' +
            '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none"><line x1="50" y1="0" x2="50" y2="100" stroke="' + color + '" stroke-width="3" stroke-linecap="round" vector-effect="non-scaling-stroke"></line></svg></div>';
        }
        if (kind === 'ellipse') {
          return '<div class="slide-element" data-type="shape" data-shape="ellipse" data-eid="' + eid + '"' +
            ' data-fill="' + color + '" data-stroke="' + color + '" data-stroke-w="0" data-dash="solid" contenteditable="false"' +
            ' style="position:absolute;left:' + X(x) + 'px;top:' + Y(y) + 'px;width:' + X(w) + 'px;height:' + Y(h) + 'px;">' +
            '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none"><ellipse cx="50" cy="50" rx="48" ry="48" fill="' + color + '"></ellipse></svg></div>';
        }
        if (kind === 'trapezoid') {
          return '<div class="slide-element" data-type="shape" data-shape="freeform" data-eid="' + eid + '"' +
            ' data-points="0.14,0.04 0.86,0.04 0.98,0.96 0.02,0.96" contenteditable="false"' +
            ' data-fill="' + color + '" data-stroke-off="1" data-dash="solid"' +
            ' style="position:absolute;left:' + X(x) + 'px;top:' + Y(y) + 'px;width:' + X(w) + 'px;height:' + Y(h) + 'px;"></div>';
        }
        return '';
      };
      const label = (x, y, w, h, txt, color, fs) => tEl('el_' + uid(), X(x), Y(y), X(w), Y(h),
        '<span style="font-size:' + (fs || FS(0.03)) + 'px;font-weight:700;color:' + color + ';display:block;text-align:center;width:100%;">' + txt + '</span>');

      this.items = [
        /* ---- 流程：横向四步 ---- */
        { id: 'process-horizontal', cat: 'process', name: '横向流程',
          svg: '<svg viewBox="0 0 120 64"><g fill="#2563EB"><rect x="4" y="20" width="22" height="24" rx="3"/><rect x="34" y="20" width="22" height="24" rx="3"/><rect x="64" y="20" width="22" height="24" rx="3"/><rect x="94" y="20" width="22" height="24" rx="3"/></g><path d="M28 32h4M58 32h4M88 32h4" stroke="#94a3b8" stroke-width="3" stroke-linecap="round"/><path d="M30 26l6 6-6 6M60 26l6 6-6 6M90 26l6 6-6 6" fill="none" stroke="#94a3b8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
          build() {
            let h = '';
            const icons = ['🚀', '🔧', '📊', '🎯'];
            for (let i = 0; i < 4; i++) {
              h += node(0.05 + i * 0.245, 0.32, 0.19, 0.36, '步骤 ' + (i + 1), '在此填写说明文字', tones[i % 4], '#ffffff', icons[i]);
              if (i < 3) h += shape('arrow', 0.245 + i * 0.245, 0.42, 0.045, 0.16, conn);
            }
            return h;
          } },
        { id: 'process-vertical', cat: 'process', name: '纵向流程',
          svg: '<svg viewBox="0 0 120 64"><g fill="#059669"><rect x="30" y="3" width="60" height="11" rx="2"/><rect x="30" y="26" width="60" height="11" rx="2"/><rect x="30" y="49" width="60" height="11" rx="2"/></g><path d="M60 16v7M60 39v7" stroke="#94a3b8" stroke-width="3" stroke-linecap="round"/><path d="M55 20h10M55 43h10" stroke="#94a3b8" stroke-width="2.5" stroke-linecap="round"/></svg>',
          build() {
            return node(0.32, 0.08, 0.36, 0.17, '第一步', '在此填写说明文字', tones[0], '#ffffff', '🚀') +
              shape('vline', 0.493, 0.255, 0.014, 0.06, conn) +
              node(0.32, 0.33, 0.36, 0.17, '第二步', '在此填写说明文字', tones[1], '#ffffff', '⚙️') +
              shape('vline', 0.493, 0.505, 0.014, 0.06, conn) +
              node(0.32, 0.58, 0.36, 0.17, '第三步', '在此填写说明文字', tones[2], '#ffffff', '🎯');
          } },

        /* ---- 层次：组织结构 ---- */
        { id: 'hierarchy-org', cat: 'hierarchy', name: '组织结构',
          svg: '<svg viewBox="0 0 120 64"><rect x="35" y="3" width="50" height="10" rx="2" fill="#534AB7"/><rect x="6" y="34" width="30" height="12" rx="2" fill="#7C3AED"/><rect x="45" y="34" width="30" height="12" rx="2" fill="#7C3AED"/><rect x="84" y="34" width="30" height="12" rx="2" fill="#7C3AED"/><path d="M60 15v10M21 30v4M60 30v4M99 30v4M21 30h78" stroke="#94a3b8" stroke-width="2.5" fill="none"/></svg>',
          build() {
            return node(0.38, 0.08, 0.24, 0.13, '总经理', '顶层目标', c.primary, '#ffffff', '🏢') +
              shape('vline', 0.493, 0.215, 0.014, 0.06, conn) +
              shape('hline', 0.185, 0.275, 0.63, 0.02, conn) +
              shape('vline', 0.225, 0.275, 0.014, 0.06, conn) +
              shape('vline', 0.5, 0.275, 0.014, 0.06, conn) +
              shape('vline', 0.775, 0.275, 0.014, 0.06, conn) +
              node(0.13, 0.34, 0.19, 0.22, '部门 A', '说明文字', rgbaT(c.secondary, 0.14), c.fg, '👥') +
              node(0.405, 0.34, 0.19, 0.22, '部门 B', '说明文字', rgbaT(c.secondary, 0.14), c.fg, '👥') +
              node(0.68, 0.34, 0.19, 0.22, '部门 C', '说明文字', rgbaT(c.secondary, 0.14), c.fg, '👥');
          } },

        /* ---- 矩阵：2×2 ---- */
        { id: 'matrix-2x2', cat: 'matrix', name: '2×2 矩阵',
          svg: '<svg viewBox="0 0 120 64"><rect x="5" y="6" width="50" height="22" rx="2" fill="#0EA5E9"/><rect x="65" y="6" width="50" height="22" rx="2" fill="#0EA5E9"/><rect x="5" y="36" width="50" height="22" rx="2" fill="#0EA5E9"/><rect x="65" y="36" width="50" height="22" rx="2" fill="#0EA5E9"/><circle cx="60" cy="32" r="7" fill="#fff" stroke="#0EA5E9" stroke-width="2"/></svg>',
          build() {
            return node(0.07, 0.14, 0.36, 0.28, '象限 一', '说明文字', rgbaT(tones[0], 0.14), c.fg, '📈') +
              node(0.57, 0.14, 0.36, 0.28, '象限 二', '说明文字', rgbaT(tones[1], 0.14), c.fg, '📉') +
              node(0.07, 0.56, 0.36, 0.28, '象限 三', '说明文字', rgbaT(tones[2], 0.14), c.fg, '📊') +
              node(0.57, 0.56, 0.36, 0.28, '象限 四', '说明文字', rgbaT(tones[3], 0.14), c.fg, '📋') +
              shape('ellipse', 0.46, 0.405, 0.08, 0.19, '#ffffff');
          } },

        /* ---- 棱锥：三层 ---- */
        { id: 'pyramid-layers', cat: 'pyramid', name: '棱锥分层',
          svg: '<svg viewBox="0 0 120 64"><polygon points="22,48 98,48 76,30 44,30" fill="#2563EB"/><polygon points="44,30 76,30 64,16 56,16" fill="#3B82F6"/><polygon points="52,4 68,4 64,16 56,16" fill="#60A5FA"/></svg>',
          build() {
            return shape('trapezoid', 0.2, 0.55, 0.6, 0.24, tones[0]) +
              label(0.2, 0.63, 0.6, 0.08, '第三层 · 基础', '#ffffff') +
              shape('trapezoid', 0.3, 0.32, 0.4, 0.21, tones[1]) +
              label(0.3, 0.38, 0.4, 0.08, '第二层', '#ffffff') +
              shape('trapezoid', 0.4, 0.12, 0.2, 0.18, tones[2]) +
              label(0.4, 0.17, 0.2, 0.08, '顶层', '#ffffff');
          } },

        /* ---- 循环：四节点环形 ---- */
        { id: 'cycle-4', cat: 'cycle', name: '循环流程',
          svg: '<svg viewBox="0 0 120 64"><g fill="#F59E0B"><rect x="44" y="3" width="32" height="10" rx="2"/><rect x="95" y="27" width="10" height="32" rx="2"/><rect x="44" y="51" width="32" height="10" rx="2"/><rect x="15" y="27" width="10" height="32" rx="2"/></g><path d="M46 14 C 34 18, 24 22, 20 28 M100 34 C 96 44, 92 48, 80 52 M74 52 C 62 56, 58 56, 46 52 M20 36 C 24 44, 28 48, 40 52" fill="none" stroke="#94a3b8" stroke-width="2.5" stroke-linecap="round"/></svg>',
          build() {
            const arrow = (x, y, ch) => tEl('el_' + uid(), X(x), Y(y), X(0.08), Y(0.08),
              '<span style="font-size:' + FS(0.06) + 'px;color:' + conn + ';display:block;text-align:center;width:100%;line-height:1;">' + ch + '</span>');
            return node(0.44, 0.05, 0.12, 0.15, '①', '节点 1', tones[0], '#ffffff', '🔁') +
              node(0.81, 0.43, 0.12, 0.15, '②', '节点 2', tones[1], '#ffffff', '🔁') +
              node(0.44, 0.8, 0.12, 0.15, '③', '节点 3', tones[2], '#ffffff', '🔁') +
              node(0.07, 0.43, 0.12, 0.15, '④', '节点 4', tones[3], '#ffffff', '🔁') +
              arrow(0.58, 0.06, '→') +
              arrow(0.86, 0.46, '↓') +
              arrow(0.34, 0.86, '←') +
              arrow(0.06, 0.46, '↑');
          } },

        /* ---- 维恩：两圆 ---- */
        { id: 'venn-2', cat: 'venn', name: '维恩图',
          svg: '<svg viewBox="0 0 120 64"><circle cx="42" cy="32" r="20" fill="rgba(37,99,235,.3)" stroke="#2563EB" stroke-width="2"/><circle cx="78" cy="32" r="20" fill="rgba(14,165,233,.3)" stroke="#0EA5E9" stroke-width="2"/></svg>',
          build() {
            return shape('ellipse', 0.14, 0.22, 0.34, 0.56, rgbaT(tones[0], 0.22)) +
              shape('ellipse', 0.52, 0.22, 0.34, 0.56, rgbaT(tones[1], 0.22)) +
              label(0.16, 0.44, 0.3, 0.1, '集合 A 独有', tones[0], FS(0.026)) +
              label(0.54, 0.44, 0.3, 0.1, '集合 B 独有', tones[1], FS(0.026)) +
              label(0.4, 0.47, 0.2, 0.08, 'A ∩ B', c.accent, FS(0.028));
          } },

        /* ---- 列表：编号列表 ---- */
        { id: 'list-steps', cat: 'list', name: '编号列表',
          svg: '<svg viewBox="0 0 120 64"><g><circle cx="10" cy="10" r="5" fill="#10B981"/><rect x="20" y="6" width="96" height="8" rx="4" fill="#cbd5e1"/><circle cx="10" cy="30" r="5" fill="#10B981"/><rect x="20" y="26" width="80" height="8" rx="4" fill="#cbd5e1"/><circle cx="10" cy="50" r="5" fill="#10B981"/><rect x="20" y="46" width="88" height="8" rx="4" fill="#cbd5e1"/></g></svg>',
          build() {
            const rows = ['要点标题 一', '要点标题 二', '要点标题 三', '要点标题 四'];
            const icons = ['✅', '⭐', '📌', '🚩'];
            let h = node(0.07, 0.07, 0.86, 0.12, '编号列表', '', c.primary, '#ffffff', '📋');
            rows.forEach((t, i) => {
              h += node(0.07, 0.24 + i * 0.17, 0.86, 0.14, (i + 1) + '  ' + t, '补充说明文字', i % 2 ? '#ffffff' : rgbaT(tones[i % 4], 0.08), c.fg, icons[i]);
            });
            return h;
          } },

        /* ---- 放射：中心 + 四周 ---- */
        { id: 'radial-burst', cat: 'radial', name: '放射布局',
          svg: '<svg viewBox="0 0 120 64"><circle cx="60" cy="32" r="10" fill="#534AB7"/><rect x="4" y="4" width="24" height="14" rx="2" fill="#7C3AED"/><rect x="92" y="4" width="24" height="14" rx="2" fill="#7C3AED"/><rect x="4" y="46" width="24" height="14" rx="2" fill="#7C3AED"/><rect x="92" y="46" width="24" height="14" rx="2" fill="#7C3AED"/><path d="M60 24v6M52 28l-20 10M68 28l20 10M52 36l-20 10M68 36l20 10" stroke="#94a3b8" stroke-width="2.5" stroke-linecap="round"/></svg>',
          build() {
            return shape('ellipse', 0.44, 0.38, 0.12, 0.24, tones[0]) +
              label(0.4, 0.455, 0.2, 0.09, '中心主题', '#ffffff', FS(0.028)) +
              shape('hline', 0.4, 0.42, 0.14, 0.02, conn) +
              shape('hline', 0.46, 0.52, 0.14, 0.02, conn) +
              shape('vline', 0.42, 0.5, 0.02, 0.14, conn) +
              shape('vline', 0.56, 0.36, 0.02, 0.14, conn) +
              node(0.06, 0.06, 0.18, 0.2, '分支 1', '说明文字', rgbaT(tones[1], 0.14), c.fg, '') +
              node(0.76, 0.06, 0.18, 0.2, '分支 2', '说明文字', rgbaT(tones[2], 0.14), c.fg, '') +
              node(0.06, 0.74, 0.18, 0.2, '分支 3', '说明文字', rgbaT(tones[3], 0.14), c.fg, '') +
              node(0.76, 0.74, 0.18, 0.2, '分支 4', '说明文字', rgbaT(tones[0], 0.14), c.fg, '');
          } },
      ];
      // —— 逐项规范化 SVG 预览缩略图配色：把 AI 味高饱和色映射到主题低饱和色 ——
      // 并确保 node 里的 emoji 图标参数不再传递（已改为几何点），但保留 svg 缩略图一致。
      const saPal = { p: c.primary, s: c.secondary, acc: c.accent, ok: c.success };
      const saMap = {
        '#2563EB': saPal.p, '#3B82F6': saPal.p, '#1D4ED8': saPal.p, '#60A5FA': saPal.p,
        '#7C3AED': saPal.s, '#534AB7': saPal.p, '#8B5CF6': saPal.s, '#6366F1': saPal.s,
        '#A855F7': saPal.s, '#6D5AE6': saPal.s, '#4F46E5': saPal.p,
        '#0EA5E9': saPal.p, '#06B6D4': saPal.p, '#13daec': saPal.p, '#42affa': saPal.p,
        '#F59E0B': saPal.acc, '#F97316': saPal.acc, '#FACC15': saPal.acc, '#E8871E': saPal.acc,
        '#10B981': saPal.ok, '#059669': saPal.ok, '#34D399': saPal.ok, '#14B8A6': saPal.ok,
        '#22C55E': saPal.ok, '#0E9F6E': saPal.ok,
        '#0B1020': c.dark, '#282a36': c.dark, '#000000': c.ink, '#111111': c.ink,
        '#ec4899': saPal.acc, '#FF6B9A': saPal.acc, '#F43F5E': saPal.acc, '#D946EF': saPal.s,
        '#e11d48': saPal.acc, '#ef4444': saPal.acc, '#e53e3e': saPal.acc,
      };
      this.items.forEach(it => {
        if (typeof it.svg === 'string') {
          it.svg = it.svg.replace(/#[0-9a-fA-F]{6}/g, (m) => saMap[m.toLowerCase()] || m);
        }
      });
    },

    open(catId) {
      // rebuild each open so positions/colors follow the current page size & theme
      this.init();
      $('#smartart-modal').classList.remove('hidden');
      this.render(catId || 'all');
    },

    close() {
      $('#smartart-modal').classList.add('hidden');
    },

    render(catId) {
      const grid = $('#smartart-grid');
      if (!grid) return;
      $$('#smartart-modal .smartart-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.saCat === catId));
      const list = this.items.filter(it => catId === 'all' || it.cat === catId);
      grid.innerHTML = '';
      list.forEach(it => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'smartart-card';
        card.dataset.saInsert = it.id;
        card.innerHTML = '<span class="smartart-preview">' + it.svg + '</span>' +
          '<span class="smartart-name">' + escHTML(it.name) + '</span>';
        grid.appendChild(card);
      });
      $('#smartart-hint').textContent = '点击图示插入当前页 —— 所有元素均可单独拖动、编辑文字、更换颜色 · 共 ' + list.length + ' 个';
    },

    insert(id) {
      const item = this.items.find(it => it.id === id);
      if (!item) return;
      const section = Elements.currentSection();
      if (!section) return;
      const before = Array.from(section.querySelectorAll('.slide-element'));
      section.insertAdjacentHTML('beforeend', item.build());
      // bind the newly added elements (existing ones are already bound)
      Array.from(section.querySelectorAll('.slide-element')).forEach(el => {
        if (!el.dataset.bound) Elements.bindElement(el);
      });
      renderFreeform(section);
      // select everything we just inserted so the user can move the diagram as a unit
      Elements.deselect();
      Array.from(section.querySelectorAll('.slide-element')).slice(before.length).forEach(el => {
        if (el.dataset.bound) Elements.select(el, true);
      });
      syncCurrentSlide();
      History.push();
      this.close();
      toast('已插入 SmartArt 图示：「' + item.name + '」（所有元素均可单独编辑）', 'success');
    },
  };

  /* ===== Alignment & distribution ===== */
  const Align = {
    _bounds(els) {
      return els.map(el => ({
        el,
        l: parseFloat(el.style.left) || 0,
        t: parseFloat(el.style.top) || 0,
        w: parseFloat(el.style.width) || 0,
        h: parseFloat(el.style.height) || 0,
      }));
    },

    run(action) {
      const sel = Elements.selection;
      if (!sel || sel.length < 2) { toast('请至少选择 2 个元素', 'info'); return; }
      const b = this._bounds(sel);
      const apply = (fn) => {
        b.forEach(g => fn(g));
        syncCurrentSlide();
        History.push();
        Elements._updateMultiBox();
        toast('已对齐', 'success');
      };
      switch (action) {
        case 'left': {
          const v = Math.min(...b.map(g => g.l));
          apply(g => { g.el.style.left = Math.round(v) + 'px'; });
          break;
        }
        case 'center': {
          const v = b.reduce((s, g) => s + g.l + g.w / 2, 0) / b.length;
          apply(g => { g.el.style.left = Math.round(v - g.w / 2) + 'px'; });
          break;
        }
        case 'right': {
          const v = Math.max(...b.map(g => g.l + g.w));
          apply(g => { g.el.style.left = Math.round(v - g.w) + 'px'; });
          break;
        }
        case 'top': {
          const v = Math.min(...b.map(g => g.t));
          apply(g => { g.el.style.top = Math.round(v) + 'px'; });
          break;
        }
        case 'middle': {
          const v = b.reduce((s, g) => s + g.t + g.h / 2, 0) / b.length;
          apply(g => { g.el.style.top = Math.round(v - g.h / 2) + 'px'; });
          break;
        }
        case 'bottom': {
          const v = Math.max(...b.map(g => g.t + g.h));
          apply(g => { g.el.style.top = Math.round(v - g.h) + 'px'; });
          break;
        }
        case 'dist-h': {
          const sorted = b.slice().sort((a, z) => a.l - z.l);
          const span = sorted[sorted.length - 1].l + sorted[sorted.length - 1].w - sorted[0].l;
          const used = sorted.reduce((s, g) => s + g.w, 0);
          const gap = (span - used) / (sorted.length - 1);
          if (gap < 0) { toast('间距不足，无法水平分布', 'error'); return; }
          let x = sorted[0].l;
          sorted.forEach(g => { g.el.style.left = Math.round(x) + 'px'; x += g.w + gap; });
          syncCurrentSlide(); History.push(); Elements._updateMultiBox();
          toast('已水平分布', 'success');
          break;
        }
        case 'dist-v': {
          const sorted = b.slice().sort((a, z) => a.t - z.t);
          const span = sorted[sorted.length - 1].t + sorted[sorted.length - 1].h - sorted[0].t;
          const used = sorted.reduce((s, g) => s + g.h, 0);
          const gap = (span - used) / (sorted.length - 1);
          if (gap < 0) { toast('间距不足，无法垂直分布', 'error'); return; }
          let y = sorted[0].t;
          sorted.forEach(g => { g.el.style.top = Math.round(y) + 'px'; y += g.h + gap; });
          syncCurrentSlide(); History.push(); Elements._updateMultiBox();
          toast('已垂直分布', 'success');
          break;
        }
        default:
          toast('未知对齐操作', 'error');
      }
    },
  };

  /* ===== Align bar (floating above the canvas when multi-selecting) ===== */
  const AlignBar = {
    show(n) {
      const bar = $('#align-bar');
      if (!bar) return;
      bar.classList.add('active');
      bar.dataset.count = n;
    },
    hide() {
      const bar = $('#align-bar');
      if (bar) bar.classList.remove('active');
    },
  };

  /* ===== Snap guides ===== */
  const Snap = {
    THRESHOLD: 6, // px in slide coordinates

    /** Find the best snap for the union box of `targets` positioned at (nx, ny).
     *  Returns {x, y, guides:{x?, y?}} in slide coordinates, or null. */
    find(originals, nx, ny, dims, targets) {
      const u = Elements._unionRect(targets);
      const uL = nx, uT = ny, uR = nx + u.w, uB = ny + u.h;
      const uCX = nx + u.w / 2, uCY = ny + u.h / 2;
      const sx = new Set([0, dims.w / 2, dims.w]);
      const sy = new Set([0, dims.h / 2, dims.h]);
      const section = Elements.currentSection();
      if (section) {
        $$('.slide-element', section).forEach(el => {
          if (targets.includes(el)) return;
          if (el.dataset.hidden) return;
          const l = parseFloat(el.style.left) || 0, t = parseFloat(el.style.top) || 0;
          const w = parseFloat(el.style.width) || 0, h = parseFloat(el.style.height) || 0;
          sx.add(l); sx.add(l + w / 2); sx.add(l + w);
          sy.add(t); sy.add(t + h / 2); sy.add(t + h);
        });
      }
      let bestX = null, bestY = null, dx = 0, dy = 0;
      sx.forEach(v => {
        [uL, uCX, uR].forEach(edge => {
          const d = v - edge;
          if (Math.abs(d) <= this.THRESHOLD && (bestX === null || Math.abs(d) < Math.abs(dx))) {
            dx = d; bestX = v;
          }
        });
      });
      sy.forEach(v => {
        [uT, uCY, uB].forEach(edge => {
          const d = v - edge;
          if (Math.abs(d) <= this.THRESHOLD && (bestY === null || Math.abs(d) < Math.abs(dy))) {
            dy = d; bestY = v;
          }
        });
      });
      if (bestX === null && bestY === null) return null;
      return {
        x: nx + (bestX !== null ? dx : 0),
        y: ny + (bestY !== null ? dy : 0),
        guides: { x: bestX, y: bestY },
      };
    },

    /** Resize snapping: snap the moving edge(s) of `box` (proposed rect) to
     *  slide edges/center and other elements' edges/centers.
     *  `handle` is one of n/s/e/w/ne/nw/se/sw. Returns adjusted rect + guides. */
    findResize(box, handle, targets) {
      const dims = sizeMap(project.meta.size || 'default');
      const sx = new Set([0, dims.w / 2, dims.w]);
      const sy = new Set([0, dims.h / 2, dims.h]);
      const section = Elements.currentSection();
      if (section) {
        $$('.slide-element', section).forEach(el => {
          if (targets.includes(el)) return;
          if (el.dataset.hidden) return;
          const l = parseFloat(el.style.left) || 0, t = parseFloat(el.style.top) || 0;
          const w = parseFloat(el.style.width) || 0, h = parseFloat(el.style.height) || 0;
          sx.add(l); sx.add(l + w / 2); sx.add(l + w);
          sy.add(t); sy.add(t + h / 2); sy.add(t + h);
        });
      }
      const TH = this.THRESHOLD;
      const bestDelta = (set, edge) => {
        let best = null;
        set.forEach(v => {
          const d = v - edge;
          if (Math.abs(d) <= TH && (best === null || Math.abs(d) < Math.abs(best))) best = d;
        });
        return best;
      };
      let dl = 0, dt = 0, dw = 0, dh = 0;
      let gx, gy;
      const L = box.left, T = box.top, R = box.left + box.w, B = box.top + box.h;
      if (handle.indexOf('e') >= 0) {
        const d = bestDelta(sx, R);
        if (d !== null) { dw = d; gx = R + d; }
      } else if (handle.indexOf('w') >= 0) {
        const d = bestDelta(sx, L);
        if (d !== null) { dl = d; dw = -d; gx = L + d; }
      }
      if (handle.indexOf('s') >= 0) {
        const d = bestDelta(sy, B);
        if (d !== null) { dh = d; gy = B + d; }
      } else if (handle.indexOf('n') >= 0) {
        const d = bestDelta(sy, T);
        if (d !== null) { dt = d; dh = -d; gy = T + d; }
      }
      if (!dl && !dt && !dw && !dh) return null;
      return {
        left: box.left + dl, top: box.top + dt,
        w: Math.max(10, box.w + dw), h: Math.max(10, box.h + dh),
        guides: { x: gx, y: gy },
      };
    },
  };

  /* ===== Grouping (lightweight data-group scheme) ===== */
  const Group = {
    group() {
      const sel = Elements.selection;
      if (!sel || sel.length < 2) { toast('请至少选择 2 个元素', 'info'); return; }
      const gid = 'g' + uid();
      sel.forEach(el => {
        el.dataset.group = gid;
        el.classList.add('in-group');
      });
      Elements.selected = sel[0];
      Elements.selection = [sel[0]];
      Elements._renderSelection();
      syncCurrentSlide();
      History.push();
      toast('已编组 ' + sel.length + ' 个元素 · 双击组内成员可单独编辑', 'success');
    },

    ungroup() {
      const sel = Elements.selection;
      if (!sel || !sel.length) return;
      const gids = new Set();
      sel.forEach(el => { if (el.dataset.group) gids.add(el.dataset.group); });
      if (!gids.size) { toast('所选元素未编组', 'info'); return; }
      let n = 0;
      gids.forEach(gid => {
        Elements._groupMembers(gid).forEach(el => {
          delete el.dataset.group;
          el.classList.remove('in-group');
          n++;
        });
      });
      Elements._editingGroup = null;
      syncCurrentSlide();
      History.push();
      toast('已取消编组 ' + n + ' 个元素', 'success');
    },
  };

  /* ===== Layer panel (right side, 图层 tab) ===== */
  const LayerPanel = {
    _typeNames: {
      text: '文本', shape: '图形', image: '图片', video: '视频', chart: '图表',
      table: '表格', embed: '嵌入', desmos: 'Desmos',
      code: '代码', math: '公式',
    },

    render() {
      const list = $('#layer-list');
      if (!list) return;
      const section = Elements.currentSection();
      const els = section ? $$('.slide-element', section) : [];
      list.innerHTML = '';
      if (!els.length) {
        list.innerHTML = '<div class="layer-empty">当前页还没有元素<br>从上方工具栏插入</div>';
        return;
      }
      els.forEach((el, i) => {
        const row = this.buildRow(el, i);
        list.appendChild(row);
      });
      this.syncActive();
    },

    buildRow(el, i) {
      const row = document.createElement('div');
      row.className = 'layer-row' + (el.classList.contains('selected') ? ' active' : '');
      const typeName = this._typeNames[el.dataset.type] || '元素';
      const label = el.dataset.name ? el.dataset.name : typeName;
      const gid = el.dataset.group ? '<span class="layer-badge" title="编组成员">组</span>' : '';
      row.innerHTML =
        '<span class="layer-eye' + (el.dataset.hidden ? ' off' : '') + '" title="点击显示 / 隐藏">' +
        (el.dataset.hidden ? '◌' : '●') + '</span>' +
        '<span class="layer-name" title="点击选中 · 双击重命名">' + this.escapeHtml(label) + gid + '</span>' +
        '<span class="layer-actions">' +
        '<button class="layer-act" data-lay="up" title="上移一层">↑</button>' +
        '<button class="layer-act" data-lay="down" title="下移一层">↓</button>' +
        '<button class="layer-act" data-lay="front" title="移到顶层">⇈</button>' +
        '<button class="layer-act" data-lay="back" title="移到底层">⇊</button>' +
        '<button class="layer-act layer-del" data-lay="del" title="删除">✕</button>' +
        '</span>';
      // click row → select element
      row.addEventListener('mousedown', (e) => {
        if (e.target.closest('.layer-act')) return;
        e.preventDefault();
        Elements.select(el);
      });
      // dblclick name → rename
      row.addEventListener('dblclick', (e) => {
        if (e.target.closest('.layer-act')) return;
        e.stopPropagation();
        const nameEl = row.querySelector('.layer-name');
        const input = document.createElement('input');
        input.className = 'layer-rename';
        input.value = el.dataset.name || '';
        input.placeholder = this._typeNames[el.dataset.type] || '元素';
        nameEl.innerHTML = '';
        nameEl.appendChild(input);
        input.focus();
        input.select();
        const commit = () => {
          const v = input.value.trim();
          if (v) el.dataset.name = v; else delete el.dataset.name;
          syncCurrentSlide();
          this.render();
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
          if (ev.key === 'Escape') { input.value = ''; input.blur(); }
        });
      });
      // eye icon → toggle visibility
      row.querySelector('.layer-eye').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (el.dataset.hidden) {
          delete el.dataset.hidden;
        } else {
          el.dataset.hidden = 'true';
          if (el.classList.contains('selected')) Elements.deselect();
        }
        syncCurrentSlide();
        History.push();
        this.render();
      });
      // actions
      row.addEventListener('click', (e) => {
        const btn = e.target.closest('.layer-act');
        if (!btn) return;
        const act = btn.dataset.lay;
        const section = Elements.currentSection();
        if (!section) return;
        e.stopPropagation();
        if (act === 'del') {
          const targets = Elements.selection.includes(el) ? Elements.selection.slice() : [el];
          targets.forEach(t => {
            if (t.dataset.type === 'desmos') saveDesmosState(t);
            t.remove();
          });
          Elements.selected = null;
          Elements.selection = [];
          Elements.hideProps();
        } else if (act === 'up') {
          const prev = el.previousElementSibling;
          if (prev) section.insertBefore(el, prev);
        } else if (act === 'down') {
          const next = el.nextElementSibling;
          if (next) section.insertBefore(next, el);
        } else if (act === 'front') {
          section.appendChild(el);
        } else if (act === 'back') {
          section.insertBefore(el, section.firstChild);
        }
        syncCurrentSlide();
        History.push();
        this.render();
      });
      return row;
    },

    /** Highlight the row of the current selection (rows are in DOM order, 1:1 with elements) */
    syncActive() {
      $$('#layer-list .layer-row').forEach(r => r.classList.remove('active'));
      const section = Elements.currentSection();
      if (!section || !Elements.selection || !Elements.selection.length) return;
      const selEids = new Set(Elements.selection.map(el => el.dataset.eid));
      $$('.slide-element', section).forEach((el, idx) => {
        const row = $$('#layer-list .layer-row')[idx];
        if (row && selEids.has(el.dataset.eid)) row.classList.add('active');
      });
    },

    escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      }[c]));
    },
  };

  /* ===== Slide context menu ===== */
  const SlideContextMenu = {
    targetIndex: -1,

    show(e, fi) {
      e.preventDefault();
      this.targetIndex = fi; // flat index into Nav.flatList()
      const menu = $('#slide-context-menu');
      menu.classList.remove('hidden');
      menu.style.left = e.clientX + 'px';
      menu.style.top = e.clientY + 'px';
      // adjust if out of viewport
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        menu.style.left = (e.clientX - rect.width) + 'px';
      }
      if (rect.bottom > window.innerHeight) {
        menu.style.top = (e.clientY - rect.height) + 'px';
      }
      // show/hide nesting items
      const entry = Nav.flatList()[this.targetIndex];
      const isChild = entry && entry.childIdx >= 0;
      const isChapter = entry && Nav.isChapter(project.slides[entry.parentIdx]);
      const mkBtn = $('#scm-make-chapter');
      const addBtn = $('#scm-add-subpage');
      if (mkBtn) mkBtn.classList.toggle('hidden', !!isChild);
      if (addBtn) addBtn.classList.toggle('hidden', isChild || !isChapter);
    },

    hide() {
      $('#slide-context-menu').classList.add('hidden');
      this.targetIndex = -1;
    },

    action(name) {
      const fi = this.targetIndex;
      if (fi < 0) return;
      const list = Nav.flatList();
      const entry = list[fi];
      if (!entry) return;
      const pi = entry.parentIdx;             // top-level index into project.slides
      const isChild = entry.childIdx >= 0;
      const isChapterSelf = entry.childIdx === -2;
      const chapter = project.slides[pi];
      switch (name) {
        case 'make-chapter': {
          // convert a plain slide / chapter-self page into a chapter with a child
          if (isChild) break;
          Store.toChapter(pi);
          if (!Nav.children(chapter).length) {
            Store.addSubSlide(pi, 'content');
          }
          History.push();
          Preview.render();
          toast('已创建章节：可继续添加子页', 'success');
          break;
        }
        case 'add-subpage': {
          if (isChild) break;
          Store.toChapter(pi);
          const child = Store.addSubSlide(pi, 'content');
          if (child) {
            History.push();
            currentIndex = pi;
            currentV = Nav.children(project.slides[pi]).length; // last child vertical
            Preview.render();
            goToFlat(Nav.fromHv(pi, currentV));
            toast('已在章节下新增子页', 'success');
          }
          break;
        }
        case 'duplicate': {
          const copy = Store.duplicateFlat(fi);
          if (copy) { History.push(); Preview.render(); toast('已复制', 'success'); }
          break;
        }
        case 'duplicate-morph': {
          const copy = Store.duplicateFlat(fi);
          if (copy) {
            copy.autoAnimate = true;
            Store.persist();
            History.push();
            Preview.render();
            toast('已创建变形页', 'success');
          }
          break;
        }
        case 'move-up':
          Store.moveFlat(fi, Math.max(0, fi - 1)); History.push(); Preview.render();
          break;
        case 'move-down':
          Store.moveFlat(fi, Math.min(list.length - 1, fi + 1)); History.push(); Preview.render();
          break;
        case 'speed-default':
        case 'speed-fast':
        case 'speed-slow': {
          const sp = name.replace('speed-', '');
          const slide = entry.slide;
          if (!slide) break;
          if (sp === 'default') delete slide.transitionSpeed;
          else slide.transitionSpeed = sp;
          Store.persist();
          History.push();
          Preview.render();
          toast(sp === 'default' ? '本页使用全局切换速度' : '本页切换速度：' + (sp === 'fast' ? '快速' : '慢速'), 'success');
          break;
        }
        case 'delete':
          if (Store.deleteFlat(fi)) {
            History.push();
            Preview.render();
            toast('已删除', 'success');
          }
          break;
      }
      this.hide();
    },
  };

  /* ===== Element context menu ===== */
  const ElementContextMenu = {
    show(e, el) {
      e.preventDefault();
      if (el) Elements.select(el);
      this._target = el || null;
      const ggbItem = $('#element-context-menu [data-ectx="edit-ggb"]');
      if (ggbItem) {
        const isGgb = el && el.dataset.type === 'embed' && (el.dataset.embedSrc || '').indexOf('geogebra.org') !== -1;
        ggbItem.classList.toggle('hidden', !isGgb);
      }
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      const menu = $('#element-context-menu');
      if (!menu) return;
      menu.classList.remove('hidden');
      menu.style.left = e.clientX + 'px';
      menu.style.top = e.clientY + 'px';
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        menu.style.left = (e.clientX - rect.width) + 'px';
      }
      if (rect.bottom > window.innerHeight) {
        menu.style.top = (e.clientY - rect.height) + 'px';
      }
    },

    hide() {
      const menu = $('#element-context-menu');
      if (menu) menu.classList.add('hidden');
    },

    action(name) {
      switch (name) {
        case 'copy': Elements.copy(); break;
        case 'cut': Elements.cut(); break;
        case 'paste': Elements.paste(this._lastX, this._lastY); break;
        case 'front': Elements.bringToFront(); break;
        case 'back': Elements.sendToBack(); break;
        case 'edit-ggb':
          if (this._target) Toolbar.openGeogebra(this._target);
          break;
        case 'delete': Elements.delete(); break;
        case 'group': Group.group(); break;
        case 'ungroup': Group.ungroup(); break;
      }
      this.hide();
    },
  };

  /* ===== Canvas (empty area) context menu ===== */
  const CanvasContextMenu = {
    show(e) {
      e.preventDefault();
      const menu = $('#canvas-context-menu');
      if (!menu) return;
      if (!Elements.clipboard) return; // nothing to paste
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      menu.classList.remove('hidden');
      menu.style.left = e.clientX + 'px';
      menu.style.top = e.clientY + 'px';
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) menu.style.left = (e.clientX - rect.width) + 'px';
      if (rect.bottom > window.innerHeight) menu.style.top = (e.clientY - rect.height) + 'px';
    },

    hide() {
      const menu = $('#canvas-context-menu');
      if (menu) menu.classList.add('hidden');
    },

    action() {
      Elements.paste(this._lastX, this._lastY);
      this.hide();
    },
  };

  /* ===== Undo/Redo ===== */
  const History = {
    stack: [],
    pointer: -1,
    max: 50,
    suspend: false,

    push() {
      if (this.suspend) return;
      // truncate redo entries
      this.stack = this.stack.slice(0, this.pointer + 1);
      // deep clone current project state
      this.stack.push(JSON.parse(JSON.stringify({
        project: project,
        currentIndex: currentIndex,
      })));
      if (this.stack.length > this.max) this.stack.shift();
      this.pointer = this.stack.length - 1;
      this.updateButtons();
    },

    undo() {
      if (this.pointer <= 0) return;
      this.pointer--;
      this.restore();
      toast('已撤销', 'success');
    },

    redo() {
      if (this.pointer >= this.stack.length - 1) return;
      this.pointer++;
      this.restore();
      toast('已重做', 'success');
    },

    restore() {
      const state = this.stack[this.pointer];
      if (!state) return;
      this.suspend = true;
      project = JSON.parse(JSON.stringify(state.project));
      currentIndex = state.currentIndex;
      PropsPanel.refreshAll();
      applyTheme(project.meta.theme);
      applyFont(project.meta.font || '');
      Preview.render();
      this.suspend = false;
      this.updateButtons();
    },

    updateButtons() {
      const undoBtn = $('#undo-btn');
      const redoBtn = $('#redo-btn');
      if (undoBtn) undoBtn.disabled = this.pointer <= 0;
      if (redoBtn) redoBtn.disabled = this.pointer >= this.stack.length - 1;
    },

    canUndo() { return this.pointer > 0; },
    canRedo() { return this.pointer < this.stack.length - 1; },
  };

  /* ===== Branding (专属 Logo 与版权标识) ===== */
  const Branding = {
    defaults() {
      return { brandName: 'LJ-PPT', brandLogo: '', copyright: '© ' + new Date().getFullYear() + ' LTJ Studio', brandFooter: true };
    },
    get() {
      const d = this.defaults();
      const m = project && project.meta ? project.meta : {};
      return {
        name: (m.brandName || '').trim() || d.brandName,
        logo: m.brandLogo || '',
        copyright: (m.copyright === undefined || m.copyright === null) ? d.copyright : String(m.copyright).trim(),
        footer: m.brandFooter === undefined ? d.brandFooter : !!m.brandFooter,
      };
    },
    /** Logo mark markup: uploaded image, or an auto-generated gradient monogram */
    logoHtml(name, logoData) {
      if (logoData) return '<img src="' + escAttr(logoData) + '" alt="logo">';
      const ch = ((name || 'R').trim().charAt(0) || 'R').toUpperCase();
      return '<span class="brand-glyph">' + escHTML(ch) + '</span>';
    },
    /** Push the current branding into the header logo, wordmark and status bar */
    apply() {
      const b = this.get();
      const logoEl = $('#brand-logo');
      if (logoEl) logoEl.innerHTML = this.logoHtml(b.name, b.logo);
      const nameEl = $('#brand-name');
      if (nameEl) nameEl.textContent = b.name;
      const crEl = $('#status-copyright');
      if (crEl) {
        crEl.textContent = b.copyright;
        crEl.classList.toggle('hidden', !b.copyright);
      }
    },
  };

  /* ===== 行内公式垂直微调（CSS 变量 --math-inline-shift） ===== */
  const MATH_SHIFT_DEFAULT = -0.18;
  function applyMathShift(v) {
    var n = parseFloat(v);
    if (!isFinite(n)) n = MATH_SHIFT_DEFAULT;
    try {
      document.documentElement.style.setProperty('--math-inline-shift', n + 'em');
    } catch (e) {}
    var lbl = document.getElementById('math-shift-val');
    if (lbl) lbl.textContent = n.toFixed(2) + 'em';
    return n;
  }
  /** 绑定一次滑块事件：拖动即时预览，松手即写入 project.meta。 */
  function bindMathShiftControl() {
    var el = document.getElementById('setting-math-shift');
    if (!el || el._msBound) return;
    el._msBound = true;
    el.addEventListener('input', function () {
      var n = applyMathShift(el.value);
      Store.updateMeta('mathShift', n);
    });
  }

  /* ===== SettingsModal ===== */
  const SettingsModal = {

    open() {
      $('#setting-title').value = project.meta.title || '';
      $('#setting-desc').value = project.meta.description || '';
      $('#setting-size').value = project.meta.size || 'wide';
      $('#setting-margin').value = String(project.meta.margin || 0.05);
      $('#setting-lang').value = project.meta.lang || 'zh-CN';
      $('#setting-nav').value = project.meta.navMode || 'default';
      $('#setting-slide-numbers').checked = !!project.meta.slideNumbers;
      $('#setting-autoplay').value = String(project.meta.autoSlide || 0);
      $('#setting-loop').checked = !!project.meta.loop;
      var ggbOff = $('#setting-ggb-offline'); if (ggbOff) ggbOff.checked = !!project.meta.ggbOffline;
      var msEl = $('#setting-math-shift');
      if (msEl) {
        msEl.value = (project.meta.mathShift === undefined || project.meta.mathShift === null)
          ? MATH_SHIFT_DEFAULT : project.meta.mathShift;
        applyMathShift(msEl.value);
        bindMathShiftControl();
      }
      try { $('#setting-desmos-key').value = localStorage.getItem('desmosApiKey') || ''; } catch (e) {}
      try {
        const rm = $('#setting-resource-mode');
        if (rm) rm.value = localStorage.getItem('resourceMode') || project.meta.resourceMode || 'auto';
      } catch (e) {}

      // brand block: built-in branding (brand settings removed from modal)
      const b = Branding.get();
      const builtinBrand = Branding.defaults();
      const builtinName = builtinBrand.brandName;
      const builtinCopyright = builtinBrand.copyright;
      // ensure the project meta carries the built-in brand so the header shows it
      if (!project.meta.brandName) project.meta.brandName = builtinName;
      if (!project.meta.copyright) project.meta.copyright = builtinCopyright;

      $('#settings-modal').classList.remove('hidden');
    },

    close() {
      $('#settings-modal').classList.add('hidden');
    },

    save() {
      Store.updateMeta('title', $('#setting-title').value || '未命名演示');
      Store.updateMeta('description', $('#setting-desc').value);
      Store.updateMeta('size', $('#setting-size').value);
      Store.updateMeta('margin', parseFloat($('#setting-margin').value) || 0.05);
      Store.updateMeta('lang', $('#setting-lang').value);
      Store.updateMeta('navMode', $('#setting-nav').value);
      Store.updateMeta('slideNumbers', $('#setting-slide-numbers').checked);
      Store.updateMeta('autoSlide', parseInt($('#setting-autoplay').value, 10) || 0);
      Store.updateMeta('loop', $('#setting-loop').checked);
      var ggbOff2 = $('#setting-ggb-offline'); if (ggbOff2) Store.updateMeta('ggbOffline', ggbOff2.checked);
      var msSave = $('#setting-math-shift');
      if (msSave) {
        var msVal = parseFloat(msSave.value);
        if (!isFinite(msVal)) msVal = MATH_SHIFT_DEFAULT;
        Store.updateMeta('mathShift', msVal);
        applyMathShift(msVal);
      }
      try {
        const key = $('#setting-desmos-key').value.trim();
        if (key) localStorage.setItem('desmosApiKey', key);
        else localStorage.removeItem('desmosApiKey');
      } catch (e) {}
      try {
        const rmEl = $('#setting-resource-mode');
        if (rmEl) {
          const rm = rmEl.value;
          localStorage.setItem('resourceMode', rm);
          Store.updateMeta('resourceMode', rm);
          if (window.__res) window.__res.mode = rm;
        }
      } catch (e) {}

      // brand block: built-in, not user-editable (brand settings removed from modal)
      const builtinBrand = Branding.defaults();
      Store.updateMeta('brandName', builtinBrand.brandName);
      Store.updateMeta('brandLogo', '');
      Store.updateMeta('copyright', builtinBrand.copyright);
      Store.updateMeta('brandFooter', builtinBrand.brandFooter);
      Branding.apply();

      // apply size
      applySize($('#setting-size').value);
      if (editorDeck) editorDeck.sync();

      // sync title in props panel
      $('#deck-title').value = project.meta.title;
      $('#deck-desc').value = project.meta.description;
      $('#size-select').value = project.meta.size;

      this.close();
      toast('设置已保存', 'success');
    },
  };

  /* ===== ThemeModal ===== */
  const ThemeModal = {
    palettes: [
      { name: 'white',    bg: '#ffffff', fg: '#1d1d1f', accent: '#534AB7' },
      { name: 'black',     bg: '#191919', fg: '#fff',    accent: '#42affa' },
      { name: 'league',    bg: '#555a5f', fg: '#fff',    accent: '#13daec' },
      { name: 'beige',     bg: '#f7f3de', fg: '#333',    accent: '#333' },
      { name: 'sky',       bg: '#dcdceb', fg: '#333',    accent: '#3b759e' },
      { name: 'night',     bg: '#111111', fg: '#fff',    accent: '#e7ad4e' },
      { name: 'serif',     bg: '#f0f1eb', fg: '#000',    accent: '#51483d' },
      { name: 'simple',    bg: '#fff',    fg: '#000',    accent: '#000' },
      { name: 'solarized', bg: '#fdf6e3', fg: '#657b83', accent: '#268bd2' },
      { name: 'blood',     bg: '#a23',    fg: '#eee',    accent: '#a23' },
      { name: 'moon',      bg: '#002b36', fg: '#93a1a1', accent: '#268bd2' },
      { name: 'dracula',   bg: '#282a36', fg: '#f8f8f2', accent: '#ff79c6' },
    ],

    selectedTheme: 'white',
    selectedFont: '',

    open() {
      this.selectedTheme = project.meta.theme || 'white';
      this.selectedFont = project.meta.font || '';

      // build palette grid
      const grid = $('#palette-grid');
      grid.innerHTML = '';
      this.palettes.forEach(p => {
        const card = document.createElement('button');
        card.className = 'palette-card' + (p.name === this.selectedTheme ? ' active' : '');
        card.dataset.theme = p.name;
        card.style.background = p.bg;
        card.title = p.name;
        card.addEventListener('click', () => {
          this.selectedTheme = p.name;
          $$('.palette-card').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
        });
        grid.appendChild(card);
      });

      // font grid
      $$('.font-card').forEach(card => {
        card.classList.toggle('active', (card.dataset.font || '') === this.selectedFont);
        card.addEventListener('click', () => {
          this.selectedFont = card.dataset.font || '';
          $$('.font-card').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
        });
      });

      // reveal theme select
      $('#theme-select-modal').value = this.selectedTheme;

      $('#theme-modal').classList.remove('hidden');
    },

    close() {
      $('#theme-modal').classList.add('hidden');
    },

    save() {
      const theme = this.selectedTheme;
      const font = this.selectedFont;

      applyTheme(theme);
      applyFont(font);
      Store.updateMeta('theme', theme);
      Store.updateMeta('font', font);

      // sync props panel selects
      $('#theme-select').value = theme;
      $('#font-select').value = font;

      this.close();
      toast('主题已应用', 'success');
    },
  };

  /* ===== FloatingFormatBar ===== */
  const FormatBar = {
    bar: null,

    init() {
      this.bar = $('#format-bar');

      // bind buttons
      $$('.fb-btn', this.bar).forEach(btn => {
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const cmd = btn.dataset.cmd;
          if (cmd === 'createLink') {
            const url = prompt('输入链接 URL:', 'https://');
            if (url) Toolbar.exec(cmd, url);
          } else {
            Toolbar.exec(cmd);
          }
        });
      });

      // format block select
      const fbSelect = $('.fb-select', this.bar);
      if (fbSelect) {
        fbSelect.addEventListener('change', () => {
          const val = fbSelect.value;
          if (val) Toolbar.exec('formatBlock', '<' + val + '>');
          fbSelect.value = '';
        });
      }

      // color picker
      const fbColor = $('.fb-color', this.bar);
      if (fbColor) {
        fbColor.addEventListener('input', () => {
          Toolbar.exec('foreColor', fbColor.value);
        });
      }

      // show/hide on selection change
      document.addEventListener('selectionchange', () => {
        const sel = window.getSelection();
        if (!sel.rangeCount || sel.isCollapsed) {
          this.hide();
          return;
        }
        const range = sel.getRangeAt(0);
        let node = range.commonAncestorContainer;
        if (node.nodeType === 3) node = node.parentNode;
        const section = node.closest && node.closest('#slides-container > section');
        if (!section) {
          this.hide();
          return;
        }
        // don't show if editing an element text
        if (node.closest && node.closest('.slide-element')) {
          this.hide();
          return;
        }
        this.show(range);
      });

      // hide on scroll
      $('#slides-container').addEventListener('scroll', () => this.hide(), { passive: true });
    },

    show(range) {
      const rect = range.getBoundingClientRect();
      this.bar.classList.remove('hidden');
      this.bar.style.left = (rect.left + rect.width / 2) + 'px';
      this.bar.style.top = (rect.top - 6) + 'px';
    },

    hide() {
      this.bar.classList.add('hidden');
    },
  };

  /* ===== Export folder picker (in-app, default = program dir) ===== */
  const ExportDialog = {
    _cur: '',
    _queue: null,
    _filename: '',

    _api(method, path, body) {
      // 打包版（Tauri）：走原生命令；浏览器开发版：走本地 HTTP 端点。
      if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
        if (path === '/__app_dir') {
          return window.__TAURI__.core.invoke('app_dir').then((d) => d || {});
        }
        if (path === '/__list_dir') {
          return window.__TAURI__.core.invoke('list_dir', { path: body ? body.path : '' });
        }
      }
      const opts = { method: method, headers: { 'Content-Type': 'application/json' } };
      if (body) opts.body = JSON.stringify(body);
      return fetch(path, opts).then(r => r.json());
    },

    /** Ask the user for a folder (defaults to program dir). Returns a Promise
     *  resolving to the chosen directory path, or null if cancelled. `filename`
     *  is pre-filled in the input (editable). */
    pick(filename) {
      this._filename = filename || '';
      return new Promise((resolve) => {
        this._queue = resolve;
        const modal = $('#export-folder-modal');
        $('#export-folder-filename').value = this._filename;
        modal.classList.remove('hidden');
        // start at the program directory
        this._api('GET', '/__app_dir').then((d) => {
          this.load(d && d.dir ? d.dir : '');
        }).catch(() => this.load(''));
      });
    },

    hide() {
      const modal = $('#export-folder-modal');
      if (modal) modal.classList.add('hidden');
    },

    dirName(p) {
      const parts = p.split(/[\\/]+/).filter(Boolean);
      return parts.length ? parts[parts.length - 1] : p;
    },

    load(path) {
      this._cur = path;
      $('#export-folder-cur').textContent = path || ' ';
      this._api('POST', '/__list_dir', { path: path }).then((d) => {
        if (!d || !d.ok) {
          $('#export-folder-list').innerHTML = '<div class="export-folder-empty">无法读取该目录</div>';
          return;
        }
        this._cur = d.path || this._cur;
        $('#export-folder-cur').textContent = this._cur || ' ';
        const list = $('#export-folder-list');
        let html = '';
        if (d.parent) {
          html += '<button class="export-folder-item export-folder-up" data-dir="' + escAttr(d.parent) + '">⬆ 上一级<span class="ef-arrow">' + escHTML(this.dirName(d.parent)) + '</span></button>';
        }
        const dirs = (d.dirs || []).slice(0, 500);
        if (!dirs.length) {
          html += '<div class="export-folder-empty">（此文件夹下没有子目录）</div>';
        }
        dirs.forEach((name) => {
          const child = this._cur.replace(/[\\/]$/, '') + '\\' + name;
          html += '<button class="export-folder-item" data-dir="' + escAttr(child) + '">' +
            '📁 ' + escHTML(name) + '<span class="ef-arrow">›</span></button>';
        });
        list.innerHTML = html;
      }).catch(() => {
        $('#export-folder-list').innerHTML = '<div class="export-folder-empty">无法读取该目录</div>';
      });
    },

    close() {
      this.hide();
      if (this._queue) { const r = this._queue; this._queue = null; r(null); }
    },

    save() {
      const dir = this._cur;
      const name = ($('#export-folder-filename').value || '').trim();
      if (!dir) { toast('请先选择文件夹', 'error'); return; }
      if (!name) { toast('请输入文件名', 'error'); return; }
      if (this._queue) { const r = this._queue; this._queue = null; r({ dir: dir, name: name }); }
      this.hide();
    },
  };

  /** Write an exported file. In the packaged (Tauri) build we call the native
   *  export_json command; in the browser dev build we POST to the dev server.
   *  Both return the same shape: { ok:true, path } or { ok:false, error }. */
  function saveExportFile(dir, name, dataBase64) {
    if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
      return window.__TAURI__.core.invoke('export_json', { path: dir, name: name, dataBase64: dataBase64 });
    }
    return fetch('/__export_json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: dir, name: name, dataBase64: dataBase64 }),
    }).then(r => r.json());
  }

  /** Encode a byte array / string as base64 (Unicode-safe). */
  function b64Encode(strOrBytes) {
    let bytes;
    if (typeof strOrBytes === 'string') {
      bytes = new TextEncoder().encode(strOrBytes);
    } else {
      bytes = strOrBytes;
    }
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  /** Sanitize a filename for the export input. */
  function sanitizeName(s) {
    return String(s || '').replace(/[\\/:*?"<>|]/g, '_');
  }

  /* ===== Exporter ===== */
  const Exporter = {
    /** 构建完整的导出 HTML 字符串（独立单文件演示） */
    buildHTML() {
      // ensure the current slide's live Desmos state is captured before export
      syncCurrentSlide();
      const theme = project.meta.theme;
      const transition = project.meta.transition;
      const dims = sizeMap(project.meta.size);

      // optional branding footer (专属 Logo + 版权标识)
      const brand = Branding.get();
      const brandFooterHtml = (brand.footer && brand.copyright)
        ? '  <div class="brand-footer">' + Branding.logoHtml(brand.name, brand.logo) + escHTML(brand.copyright) + '</div>\n'
        : '';

      const cleanExport = function (c) {
        return injectAAIds((c || '')
          .replace(/ data-bound="true"/g, '')
          .replace(/ contenteditable="false"/g, '')
          .replace(/ class="slide-element[^"]*"/g, ' class="slide-element"')
          .replace(/<div class="el-handle[^"]*"[^>]*><\/div>/g, '')
          .replace(/<div class="el-endpoint[^"]*"[^>]*><\/div>/g, '')
          .replace(/<div class="el-embed-overlay"[^>]*><\/div>/g, ''));
      };
      const exportSec = function (s) {
        const bgAttr = s.bg && s.bg.color ? ' data-background-color="' + escAttr(s.bg.color) + '"' : '';
        const bgGrad = s.bg && s.bg.gradient
          ? ' data-background-image="linear-gradient(' + escAttr(s.bg.gradient) + ')"'
          : '';
        const aaAttr = s.autoAnimate ? ' data-auto-animate' : '';
        const tsAttr = s.transitionSpeed ? ' data-transition-speed="' + escAttr(s.transitionSpeed) + '"' : '';
        const notes = s.notes ? '<aside class="notes">' + escHTML(s.notes) + '</aside>' : '';
        return '    <section' + bgAttr + bgGrad + aaAttr + tsAttr + '>' + cleanExport(s.content) + notes + '</section>';
      };
      const slidesHTML = project.slides.map(function (s) {
        var sec = exportSec(s);
        var kids = Nav.children(s);
        if (kids.length) {
          // bare outer wrapper: chapter self is first vertical, then children,
          // so children never cover the chapter's own page.
          var inner = kids.map(exportSec).join('\n');
          sec = '    <section data-chapter="1">' + sec + '\n' + inner + '\n    </section>';
        }
        return sec;
      }).join('\n');

      const elCSS =
'.slide-element{position:absolute;display:flex;align-items:center;justify-content:center}\n' +
'.slide-element[data-hidden]{display:none!important}\n' +
'.slide-element svg{width:100%;height:100%;display:block}\n' +
'.slide-element .el-text{width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;padding:4px;word-break:break-word;overflow:hidden}\n' +
'.slide-element .el-image{width:100%;height:100%;object-fit:cover;border-radius:4px}\n' +
'.slide-element .el-table{border-collapse:collapse;width:100%}\n' +
'.slide-element .el-embed{width:100%;height:100%;border:none}\n' +
'.slide-element .ggb-host{width:100%;height:100%;overflow:hidden;background:#fff;position:relative}\n' +
'.slide-element .ggb-hint{position:absolute;top:0;left:0;right:0;bottom:0;z-index:4;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;background:#fff;color:#555;font-size:13px;text-align:center;padding:12px;box-sizing:border-box}\n' +
'.slide-element .ggb-fail{position:absolute;top:0;left:0;right:0;bottom:0;z-index:5;display:flex;flex-direction:column;justify-content:center;padding:16px 18px;background:rgba(255,255,255,.96);color:#333;font-size:13px;line-height:1.6;pointer-events:none;box-sizing:border-box}\n' +
'.ggb-fail-title{font-weight:600;color:#c0392b;margin-bottom:6px}\n' +
'.ggb-fail-body{margin-bottom:6px}\n' +
'.ggb-fail-tip{color:#666;font-size:12px}\n' +
'.slide-element .el-embed-content{width:100%;height:100%;overflow:auto}\n' +
'.slide-element .el-math{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.2em}\n' +
'.slide-element[data-math-inline="1"] .el-math{font-size:1em}\n' +
'.el-text mjx-container:not([display="true"]){display:inline-block!important;vertical-align:' + (isFinite(parseFloat(project.meta.mathShift)) ? parseFloat(project.meta.mathShift) : -0.18) + 'em!important;line-height:1}\n' +
'.el-text mjx-container[display="true"]{display:block!important;margin:8px 0}\n' +
'.slide-element .desmos-host{position:absolute;inset:0;width:100%;height:100%;overflow:hidden}\n' +
'.desmos-bar{display:none}\n' +
'.desmos-host .dcg-graph-logo,.dcg-graph-logo,[class*=graph-logo]{display:none!important}\n' +
'.dcg-exppanel-logo,[class*=exppanel-logo]{display:none!important}\n' +
'.slide-element .el-chart{width:100%;height:100%}\n' +
'.slide-element .el-chart svg{width:100%;height:100%;display:block}\n' +
'.slide-element[data-img-anim="kenburns"]{overflow:hidden;border-radius:4px}\n' +
'.slide-element[data-img-anim="kenburns"] .el-image{animation:elKenBurns 16s ease-in-out infinite alternate;transform-origin:center}\n' +
'@keyframes elKenBurns{from{transform:scale(1) translate(0,0)}to{transform:scale(1.12) translate(-2%,-1.5%)}}\n' +
'.slide-element[data-entrance="fade-in"]{animation:elFadeIn .6s ease both}\n' +
'.slide-element[data-entrance="slide-in"]{animation:elSlideIn .6s ease both}\n' +
'.slide-element[data-entrance="zoom-in"]{animation:elZoomIn .6s ease both}\n' +
'.el-text.has-dropcap::first-letter{float:left;font-size:3.2em;line-height:0.8;font-weight:700;padding-right:0.12em;margin-top:0.05em}\n' +
'.slide-element[data-link]{cursor:pointer}\n' +
'.reveal .subtitle{font-size:0.5em;color:#888;margin-top:0.5em}\n' +
'.reveal blockquote{font-style:italic;border-left:4px solid rgba(255,255,255,.2);padding-left:1em}\n' +
'.reveal blockquote footer{font-size:.6em;color:#888;margin-top:.5em}\n' +
'@keyframes elFadeIn{from{opacity:0}to{opacity:1}}\n' +
'@keyframes elSlideIn{from{opacity:0;transform:translateX(-40px)}to{opacity:1;transform:translateX(0)}}\n' +
'@keyframes elZoomIn{from{opacity:0;transform:scale(.5)}to{opacity:1;transform:scale(1)}}\n' +
'.slide-element[data-entrance="drop-in"]{animation:elDropIn .7s cubic-bezier(.2,.7,.3,1) both}\n' +
'.slide-element[data-entrance="bounce-in"]{animation:elBounceIn .8s cubic-bezier(.2,.7,.3,1) both}\n' +
'.slide-element[data-entrance="grow"]{animation:elGrow .6s ease both}\n' +
'.slide-element[data-entrance="shrink"]{animation:elShrink .6s ease both}\n' +
'.slide-element[data-entrance="spin-in"]{animation:elSpinIn .7s ease both}\n' +
'.slide-element[data-entrance="trajectory"]{animation:elTrajectory .8s cubic-bezier(.2,.7,.3,1) both}\n' +
'.slide-element[data-entrance="scroll"]{animation:elMarquee .9s cubic-bezier(.2,.7,.3,1) both}\n' +
'@keyframes elDropIn{0%{opacity:0;transform:translateY(-120px)}60%{opacity:1}100%{transform:translateY(0)}}\n' +
'@keyframes elBounceIn{0%{opacity:0;transform:scale(.3) translateY(-30px)}55%{transform:scale(1.05) translateY(4px)}100%{opacity:1;transform:scale(1) translateY(0)}}\n' +
'@keyframes elGrow{0%{opacity:0;transform:scale(.2)}100%{opacity:1;transform:scale(var(--anim-scale,1))}}\n' +
'@keyframes elShrink{0%{opacity:0;transform:scale(2)}100%{opacity:1;transform:scale(var(--anim-scale,1))}}\n' +
'@keyframes elSpinIn{0%{opacity:0;transform:rotate(-40deg) scale(.4)}100%{opacity:1;transform:rotate(0) scale(1)}}\n' +
'@keyframes elTrajectory{0%{opacity:0;transform:translate(var(--anim-x,0),var(--anim-y,0))}100%{opacity:1;transform:translate(0,0)}}\n' +
'@keyframes elMarquee{0%{transform:translateX(var(--anim-x,200px));opacity:0}100%{transform:translateX(0);opacity:1}}\n' +
'.brand-footer{position:fixed;right:16px;bottom:12px;z-index:40;display:flex;align-items:center;gap:6px;font-size:12px;color:rgba(120,120,120,.72);font-family:inherit;pointer-events:none;user-select:none}\n' +
'.brand-footer img{height:18px;width:auto;border-radius:4px;opacity:.95}\n' +
'.brand-footer .brand-glyph{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:5px;background:linear-gradient(135deg,#534AB7,#7C3AED);color:#fff;font-size:11px;font-weight:700}\n.el-text.enter-hl-red{animation:elEnterHlRed 1.2s ease 1s forwards}.el-text.enter-hl-green{animation:elEnterHlGreen 1.2s ease 1s forwards}.el-text.enter-hl-blue{animation:elEnterHlBlue 1.2s ease 1s forwards}\n@keyframes elEnterHlRed{to{color:#ef4444}}@keyframes elEnterHlGreen{to{color:#10b981}}@keyframes elEnterHlBlue{to{color:#3b82f6}}\n';

      const elJS =
'function elClickNav(e){var el=e.target.closest("[data-link]");if(el){var idx=parseInt(el.dataset.link,10);if(!isNaN(idx)){Reveal.slide(idx,0);}}}\n' +
'document.querySelector(".slides").addEventListener("click",elClickNav);\n' +
'(function(){\n' +
'function applyTextEffects(el){if(!el||el.getAttribute("data-type")!=="text")return;var t=el.querySelector(".el-text");if(!t)return;t.style.background="";t.style.backgroundImage="";t.style.webkitBackgroundClip="";t.style.backgroundClip="";t.style.webkitTextFillColor="";t.style.webkitTextStroke="";t.style.textShadow="";t.style.boxShadow="";t.style.webkitBoxShadow="";t.style.padding="";t.style.borderRadius="";t.style.boxDecorationBreak="";t.style.webkitBoxDecorationBreak="";t.classList.remove("has-dropcap");if(el.dataset.hl){t.style.background=el.dataset.hl;t.style.boxDecorationBreak="clone";t.style.webkitBoxDecorationBreak="clone";t.style.padding="0.05em 0.18em";t.style.borderRadius="0.2em";}if(el.dataset.grad){var from=el.dataset.gradFrom||"#534AB7";var to=el.dataset.gradTo||"#FF6B9A";t.style.backgroundImage="linear-gradient(100deg,"+from+","+to+")";t.style.webkitBackgroundClip="text";t.style.backgroundClip="text";t.style.webkitTextFillColor="transparent";t.style.color="transparent";}var ts=el.dataset.tshadow;if(ts==="soft")t.style.textShadow="0 1px 3px rgba(0,0,0,0.35)";else if(ts==="strong")t.style.textShadow="0 2px 6px rgba(0,0,0,0.55)";else if(ts==="neon"){var glow=el.dataset.tshadowColor||el.dataset.hl||el.dataset.gradFrom||"#534AB7";t.style.textShadow="0 0 6px "+glow+",0 0 16px "+glow;}else if(ts&&ts!=="none"&&(el.dataset.tshadowColor||el.dataset.tshadowDepth||el.dataset.tshadowAngle)){var sColor=el.dataset.tshadowColor||"#000000",sDepth=parseInt(el.dataset.tshadowDepth,10)||2,sAngle=(el.dataset.tshadowAngle===undefined||el.dataset.tshadowAngle==="")?45:parseFloat(el.dataset.tshadowAngle),sRad=sAngle*Math.PI/180,sDist=2+sDepth*2.5,sLayers=[];for(var si=sDepth;si>=1;si--){var sd=Math.round(sDist*si/sDepth*10)/10,sx=Math.round(Math.cos(sRad)*sd*10)/10,sy=Math.round(Math.sin(sRad)*sd*10)/10,sb=Math.round(2+si*3.5);sLayers.push(sx+"px "+sy+"px "+sb+"px "+sColor);}t.style.textShadow=sLayers.join(", ");}if(el.dataset.stroke){var w=el.dataset.strokeW||"2";var c=el.dataset.strokeColor||"#ffffff";t.style.webkitTextStroke=w+"px "+c;}t.style.fontWeight="";t.style.fontStyle="";t.style.textDecoration="";t.style.textTransform="";t.style.fontVariant="";var tfx=(el.getAttribute("data-tfx")||"").split(/\s+/);if(tfx.indexOf("bold")>=0)t.style.fontWeight="700";if(tfx.indexOf("italic")>=0)t.style.fontStyle="italic";if(tfx.indexOf("underline")>=0)t.style.textDecoration="underline";else if(tfx.indexOf("strike")>=0)t.style.textDecoration="line-through";if(tfx.indexOf("uppercase")>=0)t.style.textTransform="uppercase";if(tfx.indexOf("smallcaps")>=0)t.style.fontVariant="small-caps";if(el.dataset.dropcap==="1")t.classList.add("has-dropcap");if(el.dataset.enterHl)t.classList.add("enter-hl-"+el.dataset.enterHl);}\n' +
'window.applyTextEffects=applyTextEffects;function fitRfitText(el){if(!el||el.getAttribute("data-type")!=="text"||el.getAttribute("data-rfit")!=="1")return;var t=el.querySelector(".el-text");if(!t)return;t.style.zoom="1";t.style.transform="";var aw=Math.max(30,el.clientWidth-14),ah=Math.max(30,el.clientHeight-14),w=t.scrollWidth,h=t.scrollHeight;if(w<=aw&&h<=ah)return;var f=Math.min(aw/w,ah/h,1);if(f>=1)return;t.style.zoom=String(f);if(!("zoom" in t.style)){t.style.transform="scale("+f+")";t.style.transformOrigin="top left";}}function applyAllTextFx(root){var els=root.querySelectorAll(".slide-element[data-type=text]");for(var i=0;i<els.length;i++){applyTextEffects(els[i]);if(els[i].getAttribute("data-rfit")==="1")fitRfitText(els[i]);}}if(typeof Reveal!=="undefined"){Reveal.on("ready",function(){applyAllTextFx(document);});Reveal.on("slidechanged",function(e){if(e&&e.currentSlide)applyAllTextFx(e.currentSlide);});}\n' +
'function runCU(scope){if(!scope)return;var els=scope.querySelectorAll(".slide-element[data-countup] .el-text");for(var i=0;i<els.length;i++){var t=els[i];var original=t.getAttribute("data-cu-original")||t.textContent.trim();t.setAttribute("data-cu-original",original);var m=original.match(/^([^0-9]*)([0-9][0-9,]*(?:\\.\\d+)?)([\\s\\S]*)$/);if(!m)continue;var num=parseFloat(m[2].replace(/,/g,""));if(!isFinite(num))continue;var dec=(m[2].split(".")[1]||"").length;var useComma=m[2].indexOf(",")>=0;var dur=1200;var start=performance.now();(function(t,m,num,dec,useComma,start){function frame(now){var p=Math.min(1,(now-start)/dur);var e=1-Math.pow(1-p,3);var v=num*e;var s=v.toFixed(dec);if(useComma)s=Number(s).toLocaleString("en-US",{minimumFractionDigits:dec,maximumFractionDigits:dec});t.textContent=m[1]+s+m[3];if(p<1)requestAnimationFrame(frame);}requestAnimationFrame(frame);})(t,m,num,dec,useComma,start);}}\n' +
'if(typeof Reveal!=="undefined"){Reveal.on("ready",function(e){if(e&&e.currentSlide)runCU(e.currentSlide);});Reveal.on("slidechanged",function(e){if(e&&e.currentSlide)runCU(e.currentSlide);});}\n' +
'function renderDesmos(root){if(!root)return;var els=root.querySelectorAll(".slide-element[data-type=desmos]");if(!els.length)return;function whenApi(cb){if(window.Desmos&&window.Desmos.GraphingCalculator){cb(window.Desmos);}else{setTimeout(function(){whenApi(cb);},150);}}whenApi(function(Desmos){for(var i=0;i<els.length;i++){var el=els[i];var host=el.querySelector(".desmos-host");if(!host)continue;if(host.querySelector(".dcg-calculator")){if(el._dc){try{el._dc.resize();}catch(e){}}continue;}try{var calc=Desmos.GraphingCalculator(host,{keypad:true,expressions:true,settingsMenu:true,zoomButtons:true,expressionsTopbar:true,border:true});el._dc=calc;var st=el.getAttribute("data-desmos-state");if(st){try{calc.setState(JSON.parse(st));}catch(e){}}calc.resize();}catch(e){}}});}\n' +
'if(typeof Reveal!=="undefined"){Reveal.on("ready",function(e){renderDesmos(e&&e.currentSlide?e.currentSlide:document);});Reveal.on("slidechanged",function(e){if(e&&e.currentSlide)renderDesmos(e.currentSlide);});}\n' +
'var GGB_OFFLINE=' + (project.meta.ggbOffline ? 'true' : 'false') + ';var _ggbAppletLoader=null;function loadGgbAppletAPI(){if(_ggbAppletLoader)return _ggbAppletLoader;_ggbAppletLoader=new Promise(function(resolve,reject){if(window.GGBApplet){resolve(window.GGBApplet);return;}var done=function(){if(window.GGBApplet)resolve(window.GGBApplet);else reject(new Error("GGBApplet not found"));};var s=document.createElement("script");s.src="https://www.geogebra.org/apps/deployggb.js";s.onload=done;s.onerror=function(){var s2=document.createElement("script");s2.src="https://cdn.geogebra.org/resources/deployggb.js";s2.onload=done;s2.onerror=function(){reject(new Error("deployggb.js load failed (all CDN sources unreachable)"));};document.head.appendChild(s2);};document.head.appendChild(s);});return _ggbAppletLoader;}\n' +
'function watchGgbEmbeds(root){if(!root)return;var els=root.querySelectorAll(".slide-element[data-type=embed][data-embed-method=url]");for(var i=0;i<els.length;i++){var el=els[i];if(el._ggbWatched)continue;var src=el.getAttribute("data-embed-src")||"";if(src.indexOf("geogebra.org")===-1)continue;el._ggbWatched=true;var iframe=el.querySelector("iframe.el-embed");var loaded=false;if(iframe){iframe.addEventListener("load",function(){loaded=true;clearGgbFail(el);});iframe.addEventListener("error",function(){showGgbFail(el);});}setTimeout(function(){if(!loaded)showGgbFail(el);},15000);}}\n' +
'function showGgbFail(el){if(!el||el.querySelector(":scope > .ggb-fail"))return;var m=document.createElement("div");m.className="ggb-fail";var t=document.createElement("div");t.className="ggb-fail-title";t.textContent="⚠ GeoGebra 素材无法加载";var b=document.createElement("div");b.className="ggb-fail-body";b.textContent="该素材需要访问 geogebra.org 的素材服务，当前网络可能无法连接（国内常被限制）。";var p=document.createElement("div");p.className="ggb-fail-tip";p.textContent="改用方案：①空白计算器直接演示；② 在可访问 GeoGebra 的环境把素材另存为 .ggb，再用「本地 .ggb」插入（可离线运行）。";m.appendChild(t);m.appendChild(b);m.appendChild(p);el.appendChild(m);}\n' +
'function clearGgbFail(el){var m=el&&el.querySelector(":scope > .ggb-fail");if(m)m.remove();}\n' +
'function ggbEngineLocal(){if(window.__ggbEngineCheck)return window.__ggbEngineCheck;window.__ggbEngineCheck=new Promise(function(resolve){var done=false;function finish(v){if(!done){done=true;resolve(v);}}try{fetch("geogebra/5.0/web3d/web3d.nocache.js",{method:"HEAD"}).then(function(r){if(r.ok)finish(true);}).catch(function(){});}catch(e){}try{var s=document.createElement("script");s.src="geogebra/5.0/web3d/web3d.nocache.js";s.onload=function(){finish(true);};s.onerror=function(){finish(false);};document.head.appendChild(s);}catch(e){finish(false);}});return window.__ggbEngineCheck;}\n' +
'function renderGgbLocal(root){if(!root)return;var els=root.querySelectorAll(".slide-element[data-type=embed][data-ggb-file],.slide-element[data-type=embed][data-ggb-app]");if(!els.length)return;loadGgbAppletAPI().then(function(GGBApplet){els.forEach(function(el){if(el._ggbInjected)return;var host=el.querySelector(".ggb-host");if(!host)return;var isFile=el.getAttribute("data-ggb-file")==="1";var appKey=isFile?"":(el.getAttribute("data-ggb-app")||"");if(isFile&&!el.getAttribute("data-ggb-b64"))return;if(!isFile&&!appKey)return;var ggbId="ggb_el_"+Math.random().toString(36).slice(2);var opt=function(v,d){return v===undefined?d:(v==="1");};var tryInject=function(tries){if(host.offsetWidth<=0&&tries<25){setTimeout(function(){tryInject(tries+1);},150);return;}try{if(host.className.indexOf("ggb-scale-container")<0){host.className+=" ggb-scale-container";}var params={id:ggbId,scaleContainerClass:"ggb-scale-container",allowUpscale:true,showResetIcon:true,showToolBar:opt(el.getAttribute("data-ggb-toolbar"),true),enableShiftDragZoom:opt(el.getAttribute("data-ggb-zoom"),true),showMenuBar:opt(el.getAttribute("data-ggb-menubar"),false),showAlgebraInput:opt(el.getAttribute("data-ggb-algebra"),false),borderColor:"#ddd",width:parseFloat(el.style.width)||host.offsetWidth||el.offsetWidth||560,height:parseFloat(el.style.height)||host.offsetHeight||el.offsetHeight||360};if(isFile){params.data=el.getAttribute("data-ggb-b64");params.ggbBase64=el.getAttribute("data-ggb-b64");}else{params.appName=appKey;}var loaded=false;var failTimer=setTimeout(function(){if(!loaded&&host&&!host.querySelector(".ggb-hint")){var m=document.createElement("div");m.className="ggb-hint";m.innerHTML="<div style=font-weight:600;color:#c0392b;>GeoGebra 引擎加载超时</div><div>若处于离线环境，请确认已安装本地引擎（geogebra/5.0/web3d/）。</div>";host.appendChild(m);}},25000);params.appletOnLoad=function(){loaded=true;clearTimeout(failTimer);var hm=host&&host.querySelector(".ggb-hint");if(hm)hm.remove();};var applet=new GGBApplet(params,true);if(typeof applet.setScaleContainer==="function"){applet.setScaleContainer(false);}var injectIt=function(){try{host.innerHTML="";applet.inject(host);el._ggbInjected=true;}catch(e){clearTimeout(failTimer);host.innerHTML="<div style=padding:12px;color:#c00;font-size:13px;>GeoGebra 加载失败："+e.message+"</div>";}};injectIt();}catch(e){if(failTimer)clearTimeout(failTimer);host.innerHTML="<div style=padding:12px;color:#c00;font-size:13px;>GeoGebra 加载失败："+e.message+"</div>";}};tryInject(0);});}).catch(function(err){els.forEach(function(el){var h=el.querySelector(".ggb-host");if(h&&!h.querySelector(".ggb-err")){h.innerHTML="<div class=ggb-err style=padding:12px;color:#c00;font-size:13px;>GeoGebra 引擎加载失败："+err.message+"</div>";}});console.warn("GeoGebra API load failed:",err.message);});}\n' +
'if(typeof Reveal!=="undefined"){Reveal.on("ready",function(e){var r=e&&e.currentSlide?e.currentSlide:document;renderGgbLocal(r);watchGgbEmbeds(r);});Reveal.on("slidechanged",function(e){if(e&&e.currentSlide){renderGgbLocal(e.currentSlide);watchGgbEmbeds(e.currentSlide);}});}\n' +
'});\n';

      // Google Fonts link if a custom font is selected
      const fontName = project.meta.font || '';
      const fontLink = fontName
        ? '  <link rel="preconnect" href="https://fonts.googleapis.com">\n' +
          '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
          '  <link href="https://fonts.googleapis.com/css2?family=' + encodeURIComponent(fontName).replace(/%20/g, '+') + ':wght@400;500;600;700&display=swap" rel="stylesheet">\n'
        : '';
      const fontStyle = fontName
        ? '\n  .reveal, .reveal h1, .reveal h2, .reveal h3, .reveal h4, .reveal h5, .reveal h6, .reveal p, .reveal li, .reveal blockquote { font-family: "' + fontName + '", sans-serif !important; }'
        : '';

      const html =
'<!DOCTYPE html>\n' +
'<html lang="' + (project.meta.lang || 'zh-CN') + '">\n' +
'<head>\n' +
'  <meta charset="UTF-8">\n' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'  <meta name="author" content="' + escAttr(brand.name) + '">\n' +
'  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>\n' +
'  <link rel="preconnect" href="https://unpkg.com" crossorigin>\n' +
'  <link rel="preconnect" href="https://cdnjs.cloudflare.com" crossorigin>\n' +
'  <title>' + escHTML(project.meta.title) + '</title>\n' +
'  <link rel="stylesheet" href="' + REVEAL_CDN + '/dist/reveal.css">\n' +
'  <link rel="stylesheet" href="' + THEME_CDN + '/' + theme + '.css" id="theme">\n' +
'  <link rel="stylesheet" href="' + HLJS_CDN + '/monokai.min.css">\n' +
fontLink +
'  <style>' + elCSS + fontStyle + '\n  </style>\n' +
'</head>\n' +
'<body>\n' +
'  <div class="reveal">\n' +
'    <div class="slides">\n' +
      slidesHTML + '\n' +
'    </div>\n' +
'  </div>\n' +
      brandFooterHtml +
'  <script src="https://www.desmos.com/api/v1.13/calculator.js?apiKey=' + encodeURIComponent(getDesmosApiKey()) + '" onerror="console.warn(\'Desmos API 被拦截：含 Desmos 的幻灯片将不可交互\')"><\/script>\n' +
'  <script>\n' +
'  (function(){\n' +
'    function loadScript(urls){\n' +
'      return new Promise(function(res,rej){\n' +
'        var i=0;\n' +
'        (function nx(){\n' +
'          if(i>=urls.length){rej(new Error("CDN fail: "+urls.join(",")));return;}\n' +
'          var s=document.createElement("script"); s.src=urls[i++];\n' +
'          s.onload=function(){res(s.src);}; s.onerror=function(){s.remove();nx();};\n' +
'          document.head.appendChild(s);\n' +
'        })();\n' +
'      });\n' +
'    }\n' +
'    var CDNS=["https://cdn.jsdelivr.net/npm/reveal.js@5","https://unpkg.com/reveal.js@5","https://cdnjs.cloudflare.com/ajax/libs/reveal.js/5.1.0"];\n' +
'    function ch(suf){return CDNS.map(function(c){return c+"/"+suf;});}\n' +
'    loadScript(ch("dist/reveal.js")).then(function(){\n' +
'      return Promise.all([loadScript(ch("plugin/markdown/markdown.js")),loadScript(ch("plugin/highlight/highlight.js")),loadScript(ch("plugin/notes/notes.js")),loadScript(ch("plugin/search/search.js")),loadScript(ch("plugin/zoom/zoom.js"))]);\n' +
'    }).then(function(){\n' +
'      ' + elJS + '\n' +
'      Reveal.initialize({\n' +
'        controls:true, progress:true, center:true, hash:true,\n' +
'        transition:"' + transition + '",\n' +
'        transitionSpeed:"' + (project.meta.transitionSpeed || 'default') + '",\n' +
'        autoSlide:' + (project.meta.autoSlide || 0) + ',\n' +
'        loop:' + (!!project.meta.loop) + ',\n' +
'        width:' + dims.w + ', height:' + dims.h + ',\n' +
'        margin:' + (project.meta.margin || 0.05) + ',\n' +
'        view:"slides", scrollActivationWidth:null,\n' +
'        slideNumber:' + (project.meta.slideNumbers ? 'true' : 'false') + ',\n' +
'        plugins:[RevealMarkdown, RevealHighlight, RevealNotes, RevealSearch, RevealZoom]\n' +
'      });\n' +
'    }).catch(function(err){\n' +
'      document.body.insertAdjacentHTML("beforeend","<div style=\\"position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font-family:sans-serif;color:#e53e3e;background:#fff\\">⚠️ 无法加载 Reveal.js 演示引擎（"+err.message+"）。请检查网络或 CDN 可用性。</div>");\n' +
'    });\n' +
'  })();\n' +
'  <\/script>\n' +
'</body>\n' +
'</html>\n';

      return html;
    },

    exportHTML() {
      const filename = sanitizeName(project.meta.title || '演示文稿') + '.html';
      const html = this.buildHTML();
      saveViaDialog(filename, 'text/html', html);
    },

    /** 导出 PDF：以 print-pdf 模式构建单页排版，并附打印样式，调起系统打印另存 */
    exportPDF() {
      const html = this.buildHTML();
      // Reveal 通过 location.search 中的 print-pdf 进入打印视图（逐页排版 + @page 尺寸）
      const printCss = ' <style>@media print{' +
        '.reveal .slides{transform:none!important}.reveal .slides section{page-break-after:always;' +
        'position:relative!important;top:auto!important;left:auto!important;visibility:visible!important;' +
        'opacity:1!important;display:block!important;margin:0 auto!important}' +
        '.reveal .backgrounds{display:none!important}.reveal .slide-background{display:none!important}' +
        '.reveal .progress,.reveal .controls,.reveal .slide-number{display:none!important}' +
        '.brand-footer{display:none!important}@page{size:auto;margin:0}}' +
        '</style>';
      const url = URL.createObjectURL(new Blob([html.replace('</head>', printCss + '</head>')], { type: 'text/html' })) + '?print-pdf';
      const w = window.open(url, '_blank', 'width=1280,height=860');
      if (!w) { toast('浏览器拦截了新窗口，请允许弹出窗口后重试', 'error'); return; }
      // 等待 Reveal 就绪 + 页面布局完成后调起打印
      let tries = 0;
      const waitPrint = () => {
        tries++;
        try {
          const secs = w.document.querySelectorAll('.reveal .slides > section');
          if (secs.length >= project.slides.length) {
            setTimeout(() => { try { w.focus(); w.print(); } catch (e) {} }, 800);
            return;
          }
        } catch (e) { /* 窗口尚未就绪 */ }
        if (tries < 60) setTimeout(waitPrint, 250);
        else toast('PDF 打印窗口加载超时，请检查网络后重试', 'error');
      };
      waitPrint();
      toast('已打开打印窗口：目标打印机选择「Microsoft Print to PDF」即可保存为 PDF', 'success');
    },

    /** 导出当前页为 PNG：SVG foreignObject 渲染整页 → canvas → 下载 */
    exportPng() {
      const active = Nav.activeSlide(currentIndex, currentV);
      const section = active ? sectionById(active.id) : $$('#slides-container > section')[currentIndex];
      if (!section) return;
      const dims = sizeMap(project.meta.size || 'default');
      const clone = section.cloneNode(true);
      // 清理编辑器专用节点
      $$('.el-handle, .el-endpoint, .ggb-chip, .video-chip, .el-embed-overlay, .ff-vertex, .marquee-box', clone).forEach(n => n.remove());
      $$('.slide-element.selected', clone).forEach(n => n.classList.remove('selected'));
      // 内联全部样式表（foreignObject 不继承页面样式）
      let cssText = '';
      try {
        for (const sh of document.styleSheets) {
          try { cssText += Array.from(sh.cssRules || []).map(r => r.cssText).join('\n') + '\n'; } catch (e) { /* 跨域样式忽略 */ }
        }
      } catch (e) {}
      const bg = (section.dataset.backgroundColor || '#ffffff');
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + dims.w + '" height="' + dims.h + '">' +
        '<defs><style>' + cssText + '</style></defs>' +
        '<foreignObject width="100%" height="100%">' +
        '<div xmlns="http://www.w3.org/1999/xhtml" style="width:' + dims.w + 'px;height:' + dims.h + 'px;overflow:hidden;background:' + bg + ';">' +
        clone.outerHTML + '</div></foreignObject></svg>';
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = dims.w;
        canvas.height = dims.h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, dims.w, dims.h);
        ctx.drawImage(img, 0, 0, dims.w, dims.h);
        canvas.toBlob((blob) => {
          if (!blob) { toast('PNG 导出失败', 'error'); return; }
          const filename = sanitizeName(project.meta.title || '演示文稿') + '-第' + (currentIndex + 1) + '页.png';
          // 系统原生"另存为"保存 PNG（失败时自动回退自定义对话框）
          blob.arrayBuffer().then((ab) => saveViaDialog(filename, 'image/png', new Uint8Array(ab)));
        }, 'image/png');
      };
      img.onerror = () => toast('PNG 导出失败（该页可能包含无法快照的内容）', 'error');
      img.src = url;
    },
  };

  /* ===== Present-mode control bar =====
     浮动的演示控制条：上一页/下一页 / 概览 / 自动播放 / 循环 / 暂停黑屏 /
     全屏 / 跳转 / 帮助 —— 全部走 Reveal.js 5 原生 API
     (toggleOverview / toggleAutoSlide / togglePause / toggleHelp / configure)。 */
  const PresentControls = {
    _hideTimer: null,
    _bound: false,

    bind() {
      if (this._bound) return;
      this._bound = true;
      const bar = $('#present-controls');
      if (!bar) return;
      bar.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-pc]');
        if (!btn) return;
        this.action(btn.dataset.pc);
      });
      const overlay = $('#present-overlay');
      if (overlay) overlay.addEventListener('mousemove', (e) => this.onMove(e));
      const input = $('#pc-jump-input');
      if (input) {
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            const n = parseInt(input.value, 10);
            if (!isNaN(n) && n >= 1 && presentDeck) {
              presentDeck.slide(Math.min(n - 1, project.slides.length - 1), 0);
            }
            this.hideJump();
          } else if (e.key === 'Escape') {
            this.hideJump();
          }
        });
      }
      const notesClose = $('#present-notes-close');
      if (notesClose) notesClose.addEventListener('click', () => this.toggleNotes(false));
      // 演讲计时器按钮
      const tToggle = $('#present-timer-toggle');
      if (tToggle) tToggle.addEventListener('click', () => this.timerToggle());
      const tReset = $('#present-timer-reset');
      if (tReset) tReset.addEventListener('click', () => this.timerReset());
    },

    /** 底部边缘悬停阈值（px）——收窄，避免与右下角翻页箭头干涉 */
    _EDGE: 10,
    _near: false,

    /** 鼠标移动：贴近底部边缘（且水平落在控制条宽度内）时显示；
        光标悬停在控制条上时保持显示 */
    onMove(e) {
      const bar = $('#present-controls');
      const r = bar ? bar.getBoundingClientRect() : null;
      const overBar = bar && !bar.classList.contains('pc-hidden') &&
        r && e.clientX >= r.left && e.clientX <= r.right &&
        e.clientY >= r.top && e.clientY <= r.bottom;
      // 感应区 = 距底边 <= _EDGE，且 水平坐标落在控制条的视觉宽度内
      // （getBoundingClientRect 含 transform，能拿到居中后的真实左右边界）
      const near = r && r.width > 0 && (window.innerHeight - e.clientY) <= this._EDGE &&
        e.clientX >= r.left && e.clientX <= r.right;
      if (near || overBar) {
        if (!this._near) { this._near = true; this.show(); }
      } else if (this._near) {
        this._near = false;
        this.hideSoon(500);
      }
    },

    show() {
      const bar = $('#present-controls');
      if (bar) bar.classList.remove('pc-hidden');
      clearTimeout(this._hideTimer);
    },

    /** 延迟隐藏（鼠标在底部区域内或光标在控制条上则不隐藏；跳转输入框聚焦时不隐藏） */
    hideSoon(delay) {
      clearTimeout(this._hideTimer);
      this._hideTimer = setTimeout(() => {
        const input = $('#pc-jump-input');
        if (input && document.activeElement === input) return;
        if (this._near) return;
        const bar = $('#present-controls');
        if (bar) bar.classList.add('pc-hidden');
      }, delay || 500);
    },

    hideJump() {
      const box = $('#pc-jump-box');
      const input = $('#pc-jump-input');
      if (box) box.classList.add('hidden');
      if (input) input.value = '';
    },

    toggleJump() {
      const box = $('#pc-jump-box');
      if (!box) return;
      if (box.classList.contains('hidden')) {
        box.classList.remove('hidden');
        const input = $('#pc-jump-input');
        if (input) { input.focus(); input.select(); }
      } else {
        this.hideJump();
      }
    },

    setBtn(name, active) {
      const btn = document.querySelector('#present-controls [data-pc="' + name + '"]');
      if (btn) btn.classList.toggle('active', !!active);
    },

    /** 中文快捷键帮助弹层（替代 Reveal 原生英文 help） */
    toggleHelp() {
      const box = $('#present-help');
      if (!box) return;
      if (!box.classList.contains('hidden')) { this.hideHelp(); return; }
      const rows = [
        ['上一页 / 下一页', ['←', '→', '空格']],
        ['上一张 / 下一张', ['PageUp', 'PageDown']],
        ['跳转到首页 / 尾页', ['Home', 'End']],
        ['全屏 / 退出全屏', ['F']],
        ['黑屏（暂停）', ['B']],
        ['概览所有页面', ['O']],
        ['演讲者窗口', ['S']],
        ['搜索内容', ['Ctrl+F']],
        ['关闭弹层 / 退出', ['Esc']],
      ];
      let html = '<div class="ph-panel">' +
        '<h3>演示快捷键</h3>' +
        '<p class="ph-sub">RevealSlidr 演示模式 · 按 Esc 或点下方按钮关闭</p>' +
        rows.map(function (r) {
          return '<div class="ph-row"><span class="ph-desc">' + r[0] + '</span>' +
            '<span class="ph-keys">' + r[1].map(function (k) { return '<kbd>' + k + '</kbd>'; }).join('') + '</span></div>';
        }).join('') +
        '<button class="ph-close">知道了</button></div>';
      box.innerHTML = html;
      box.classList.remove('hidden');
      const close = box.querySelector('.ph-close');
      if (close) close.addEventListener('click', () => this.hideHelp());
      box.onclick = (e) => { if (e.target === box) this.hideHelp(); };
    },

    hideHelp() {
      const box = $('#present-help');
      if (box) box.classList.add('hidden');
    },

    action(name) {
      if (!presentDeck || !presentDeckReady) return;
      switch (name) {
        case 'prev': presentDeck.prev(); break;
        case 'next': presentDeck.next(); break;
        case 'overview': presentDeck.toggleOverview(); break;
        case 'autoplay': {
          const cfg = presentDeck.getConfig();
          if (!cfg.autoSlide) presentDeck.configure({ autoSlide: project.meta.autoSlide || 5000 });
          presentDeck.toggleAutoSlide();
          break;
        }
        case 'loop': {
          const next = !presentDeck.getConfig().loop;
          presentDeck.configure({ loop: next });
          Store.updateMeta('loop', next);
          this.setBtn('loop', next);
          toast(next ? '已开启循环播放' : '已关闭循环播放', 'success');
          break;
        }
        case 'pause': presentDeck.togglePause(); break;
        case 'fullscreen': {
          const overlay = $('#present-overlay');
          if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
          else if (overlay && overlay.requestFullscreen) overlay.requestFullscreen().catch(() => {});
          break;
        }
        case 'jump': this.toggleJump(); break;
        case 'help': this.toggleHelp(); break;
        case 'search': {
          const sp = presentDeck.getPlugin && presentDeck.getPlugin('search');
          if (sp && typeof sp.open === 'function') sp.open();
          break;
        }
        case 'notes': this.toggleNotes(); break;
        case 'speaker': this.toggleNotes(true); break; // 打开内置演讲者视图（备注+计时+下一页），替代被 WebView 拦截的浏览器弹窗
        case 'annot': this.toggleAnnot(); break;
        case 'annot-clear': this.clearAnnot(); break;
        case 'exit': exitPresent(); break;
      }
      // 点击控制条按钮后保持可见（鼠标当前就在底部区域）
      this._near = true;
      this.show();
    },

    /* ---- 演示画笔/激光笔批注 ---- */
    _annotOn: false,
    _annotEl: null,
    _annotCtx: null,
    _annotDown: false,
    _annotColor: '#e11d48',
    _annotWidth: 2,
    _annotMode: 'pen',        // 'pen' | 'laser'
    _laserTimer: null,
    _laserStart: null,        // 记录激光笔当前笔画的起点，用于延时擦除

    /** 初始化批注 canvas（尺寸 = 演示区全屏视口）。进入演示时调用。 */
    initAnnot() {
      const c = $('#present-annot');
      if (!c) return;
      // 用视口尺寸（present overlay 全屏 fixed），而非 reveal.getBoundingClientRect()
      // ——后者在 Reveal 用 transform 缩放时的返回值可能为 0 或偏移，导致 canvas 尺寸为 0，
      // 真实鼠标点不到、画不出线。
      const w = window.innerWidth, h = window.innerHeight;
      c.width = Math.max(1, w);
      c.height = Math.max(1, h);
      c.style.width = w + 'px';
      c.style.height = h + 'px';
      this._annotEl = c;
      this._annotCtx = c.getContext('2d');
      this._annotDown = false;
      c.addEventListener('mousedown', (e) => { this._annotDown = true; this._annotLast = null; this._annotLaserSeg = []; this._annotStroke(e); });
      c.addEventListener('mousemove', (e) => { if (this._annotDown) this._annotStroke(e); });
      window.addEventListener('mouseup', () => { this._annotDown = false; this._annotEndStroke(); });
      // 绑定工具组控件
      $$('#present-controls .annot-tool').forEach((btn) => {
        btn.addEventListener('click', () => this.setAnnotTool(btn.dataset.annotTool));
      });
      $$('#present-controls .annot-color').forEach((btn) => {
        btn.addEventListener('click', () => this.setAnnotColor(btn.dataset.annotColor));
      });
      $$('#present-controls .annot-width').forEach((btn) => {
        btn.addEventListener('click', () => this.setAnnotWidth(parseInt(btn.dataset.annotWidth, 10)));
      });
      const clr = $('#present-controls [data-annot-clear]');
      if (clr) clr.addEventListener('click', () => this.clearAnnot());
    },

    /** 切换画笔批注：开/关 */
    toggleAnnot() {
      this._annotOn = !this._annotOn;
      const c = $('#present-annot');
      if (c) {
        // 开启时移除 hidden（canvas 初始带 hidden，否则 invisible & 点不到），
        // 并切换绘制拦截；关闭时隐藏。
        c.classList.toggle('hidden', !this._annotOn);
        c.classList.toggle('drawing', this._annotOn);
      }
      const btn = $('#present-controls [data-pc="annot"]');
      if (btn) btn.classList.toggle('active', this._annotOn);
      const group = $('#pc-annot');
      if (group) group.classList.toggle('hidden', !this._annotOn);
      toast(this._annotOn ? '批注开启（画笔/激光笔）' : '批注关闭', this._annotOn ? 'success' : 'info');
    },

    setAnnotTool(mode) {
      this._annotMode = mode === 'laser' ? 'laser' : 'pen';
      $$('#present-controls .annot-tool').forEach((b) => b.classList.toggle('active', b.dataset.annotTool === this._annotMode));
    },

    setAnnotColor(color) {
      this._annotColor = color;
      $$('#present-controls .annot-color').forEach((b) => b.classList.toggle('active', b.dataset.annotColor === color));
    },

    setAnnotWidth(w) {
      this._annotWidth = w;
      $$('#present-controls .annot-width').forEach((b) => b.classList.toggle('active', parseInt(b.dataset.annotWidth, 10) === w));
    },

    /** 清空批注 */
    clearAnnot() {
      if (this._annotCtx) this._annotCtx.clearRect(0, 0, this._annotEl.width, this._annotEl.height);
      if (this._laserTimer) { clearTimeout(this._laserTimer); this._laserTimer = null; }
      this._annotLaserSeg = [];
    },

    /** 绘制一段批注（连接上一鼠标位置到当前位置形成连续笔画） */
    _annotStroke(e) {
      const ctx = this._annotCtx;
      const el = this._annotEl;
      if (!ctx || !el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      ctx.strokeStyle = this._annotColor;
      ctx.lineWidth = this._annotWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      if (this._annotLast) {
        ctx.moveTo(this._annotLast.x, this._annotLast.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      } else {
        ctx.moveTo(x, y);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      // 记录当前笔画的起止点（供激光笔延时擦除）
      if (!this._annotLaserSeg) this._annotLaserSeg = [];
      this._annotLaserSeg.push({ x1: this._annotLast ? this._annotLast.x : x, y1: this._annotLast ? this._annotLast.y : y, x2: x, y2: y });
      this._annotLast = { x: x, y: y };
    },

    /** 抬起鼠标：激光笔模式 → 该笔画在 800ms 后自动擦除（像光点划痕） */
    _annotEndStroke() {
      this._annotLast = null;
      if (this._annotMode !== 'laser') return;
      // 快照本笔画路径（不引用可能被重绘的数组）
      const seg = (this._annotLaserSeg || []).slice();
      this._annotLaserSeg = [];
      const ctx = this._annotCtx, el = this._annotEl;
      if (!ctx || !el || !seg.length) return;
      if (this._laserTimer) clearTimeout(this._laserTimer);
      this._laserTimer = setTimeout(() => {
        // 用 clearRect + 重新画其它笔画过于复杂；激光笔即把本笔画画成"背景色+淡出"。
        // 简单可靠：用背景色重画覆盖（演示页背景透明，改用逐次缩小不透明度模拟消失）。
        // 这里用最稳妥做法：把该笔画逐段清透明一次。
        ctx.save();
        // 逐条擦除（覆盖为透明）——对 canvas 无法真正擦除，改用 globalCompositeOperation
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        ctx.lineWidth = this._annotWidth + 1;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        seg.forEach((s) => { ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); });
        ctx.stroke();
        ctx.restore();
        this._laserTimer = null;
      }, 800);
    },

    /** Update the on-screen speaker-notes panel from the current slide's notes */
    refreshNotes() {      const panel = $('#present-notes');
      if (!panel || panel.classList.contains('hidden')) return;
      const body = $('#present-notes-body');
      if (!body) return;
      const cur = $('#present-slides section.present');
      const noteEl = cur && cur.querySelector('.notes');
      const txt = (noteEl && noteEl.textContent || '').trim();
      body.innerHTML = txt
        ? '<p>' + escHTML(txt).replace(/\n/g, '<br>') + '</p>'
        : '<p class="present-notes-empty">本页没有备注 —— 在编辑器的「备注」区域添加。</p>';
      this.refreshNextPreview();
      this.updateTimerDisplay();
    },

    /* ===== 演讲计时器（Slides.com 演讲者视图灵感） ===== */
    _timerStart: null,
    _timerAccum: 0,
    _timerInt: null,
    _timerRunning: false,

    timerReset() {
      this._timerAccum = 0;
      this._timerStart = this._timerRunning ? Date.now() : null;
      this.updateTimerDisplay();
    },
    timerToggle() {
      if (this._timerRunning) {
        this._timerAccum += Date.now() - this._timerStart;
        this._timerStart = null;
        this._timerRunning = false;
        clearInterval(this._timerInt);
        const btn = $('#present-timer-toggle');
        if (btn) btn.textContent = '▶';
      } else {
        this._timerStart = Date.now();
        this._timerRunning = true;
        const btn = $('#present-timer-toggle');
        if (btn) btn.textContent = '⏸';
        clearInterval(this._timerInt);
        this._timerInt = setInterval(() => this.updateTimerDisplay(), 1000);
      }
      this.updateTimerDisplay();
    },
    updateTimerDisplay() {
      const el = $('#present-timer-val');
      if (!el) return;
      const ms = this._timerAccum + (this._timerRunning ? (Date.now() - this._timerStart) : 0);
      const s = Math.floor(ms / 1000);
      el.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    },

    /* ===== 上一张 / 下一张预览（像设计态缩略图） ===== */
    refreshNextPreview() {
      const box = $('#present-next-preview');
      if (!box) return;
      const deck = presentDeck;
      if (!deck) return;
      // Build a flat order of the currently *shown* slides. Reveal marks the
      // active vertical with .present; flatten chapters (self + children) so
      // prev/next show the correct page even inside a chapter.
      const top = $$('#present-slides > section');
      if (!top.length) return;
      const flat = [];
      top.forEach((t) => {
        const verts = $$(':scope > section', t);
        if (verts.length) verts.forEach((v) => flat.push(v));
        else flat.push(t);
      });
      const presentIdx = flat.findIndex(s => s.classList.contains('present'));
      if (presentIdx < 0) return;
      const cards = [];
      if (presentIdx > 0) cards.push({ el: flat[presentIdx - 1], label: '上一张' });
      if (presentIdx + 1 < flat.length) cards.push({ el: flat[presentIdx + 1], label: '下一张' });
      if (!cards.length) { box.classList.add('hidden'); return; }
      box.classList.remove('hidden');
      const dims = sizeMap(project.meta.size || 'default');
      box.innerHTML = '';
      cards.forEach((c) => {
        const clone = c.el.cloneNode(true);
        const aside = clone.querySelector('.notes');
        if (aside) aside.remove();
        const meta = {};
        const card = document.createElement('div');
        card.className = 'present-preview-card';
        card.style.aspectRatio = dims.w + ' / ' + dims.h;
        card.innerHTML =
          '<span class="preview-num">' + c.label + '</span>' +
          '<div class="preview-stage" style="width:' + dims.w + 'px;height:' + dims.h + 'px;">' +
            clone.innerHTML +
          '</div>';
        box.appendChild(card);
      });
      // scale each stage to its card's rendered width so it fills like a thumbnail
      $$('.present-preview-card', box).forEach((card) => {
        const stage = card.querySelector('.preview-stage');
        if (!stage) return;
        const w = card.clientWidth || 1;
        const s = dims.w ? (w / dims.w) : 1;
        stage.style.transform = 'scale(' + s + ')';
      });
    },

    toggleNotes(force) {
      const panel = $('#present-notes');
      if (!panel) return;
      const show = (typeof force === 'boolean') ? force : panel.classList.contains('hidden');
      panel.classList.toggle('hidden', !show);
      this.setBtn('notes', show);
      if (show) this.refreshNotes();
    },

    setup() {
      this.bind();
      this.setBtn('loop', !!project.meta.loop);
      this.setBtn('autoplay', !!(project.meta.autoSlide > 0 && presentDeck && presentDeck.isAutoSliding()));
      this.hideJump();
      const deck = presentDeck;
      if (!deck) return;
      const on = (type, fn) => { try { deck.on(type, fn); } catch (e) {} };
      this._cleanup = [];
      on('autoslide', () => this.setBtn('autoplay', true));
      on('slidechanged', () => this.setBtn('autoplay', deck.isAutoSliding()));
      on('overviewshown', () => this.setBtn('overview', true));
      on('overviewhidden', () => this.setBtn('overview', false));
      on('paused', () => this.setBtn('pause', true));
      on('resumed', () => this.setBtn('pause', false));
      // 进入演示先短暂展示控制条，之后隐藏，仅悬停底部时再显示
      this._near = false;
      this.show();
      this.hideSoon(2500);
      // 演讲计时自动开始
      this.timerReset();
      this.timerToggle();
    },

    teardown() {
      clearTimeout(this._hideTimer);
      clearInterval(this._timerInt);
      this._timerRunning = false;
      this.hideJump();
      this.setBtn('autoplay', false);
      this.setBtn('overview', false);
      this.setBtn('pause', false);
      this.setBtn('notes', false);
      this.toggleNotes(false);
    },
  };

  /* ===== Present mode ===== */
  async function enterPresent() {
    try {
      // sync current content
      syncCurrentSlide();

      // NOTE: the editor's GeoGebra applet is left running untouched; present
      // mode renders its own copy via renderGgbLocal on the present slides. Under
      // HTTP serving GeoGebra's engine supports multiple applets fine.

      const overlay = $('#present-overlay');
      overlay.classList.remove('hidden');

      // 演示模式默认不显示右下角版权水印（品牌为内置固定，演示时保持干净）。
      // 若未来需要开启，把该常量改为 true 即可。
      const SHOW_PRESENT_COPYRIGHT = false;
      const pcEl = $('#present-copyright');
      if (pcEl) {
        if (SHOW_PRESENT_COPYRIGHT) {
          const b = Branding.get();
          pcEl.innerHTML = (b.copyright ? Branding.logoHtml(b.name, b.logo) + escHTML(b.copyright) : '');
          pcEl.classList.toggle('hidden', !b.copyright);
        } else {
          pcEl.innerHTML = '';
          pcEl.classList.add('hidden');
        }
      }

      // build present slides (no contenteditable, strip editor attrs)
      const container = $('#present-slides');
      const clean = function (c) {
        return injectAAIds((c || '')
          .replace(/ data-bound="true"/g, '')
          .replace(/ contenteditable="false"/g, '')
          .replace(/ class="slide-element selected"/g, ' class="slide-element"')
          .replace(/<div class="el-handle[^"]*"[^>]*><\/div>/g, '')
          .replace(/<div class="el-endpoint[^"]*"[^>]*><\/div>/g, '')
          .replace(/<div class="el-embed-overlay"[^>]*><\/div>/g, ''));
      };
      const slideSec = function (s) {
        const bgAttr = s.bg && s.bg.color ? ' data-background-color="' + escAttr(s.bg.color) + '"' : '';
        const bgGrad = s.bg && s.bg.gradient
          ? ' data-background-image="linear-gradient(' + escAttr(s.bg.gradient) + ')"'
          : '';
        const aaAttr = s.autoAnimate ? ' data-auto-animate' : '';
        const tsAttr = s.transitionSpeed ? ' data-transition-speed="' + escAttr(s.transitionSpeed) + '"' : '';
        const notes = s.notes ? '<aside class="notes">' + escHTML(s.notes) + '</aside>' : '';
        return '<section' + bgAttr + bgGrad + aaAttr + tsAttr + '>' + clean(s.content) + notes + '</section>';
      };
      const presentSlide = function (s) {
        var sec = slideSec(s);
        var kids = Nav.children(s);
        if (!kids.length) return sec;
        // bare outer wrapper: chapter self is the first vertical, then children,
        // so children never cover the chapter's own page.
        var inner = kids.map(slideSec).join('');
        return '<section data-chapter="1">' + sec + inner + '</section>';
      };
      container.innerHTML = project.slides.map(presentSlide).join('');

      // enable element click-to-navigate in present mode
      // remove old listener if exists to avoid duplicates
      if (container._elClickNav) {
        container.removeEventListener('click', container._elClickNav);
      }
      container._elClickNav = function elClickNav(e) {
        var el = e.target.closest('[data-link]');
        if (el) {
          var idx = parseInt(el.dataset.link, 10);
          if (!isNaN(idx)) presentDeck.slide(idx, 0);
        }
      };
      container.addEventListener('click', container._elClickNav);

      // apply current theme
      applyTheme(project.meta.theme);

      // set overlay background to match theme
      const darkThemes = ['black', 'night', 'blood', 'moon', 'dracula', 'league'];
      const overlayBg = darkThemes.indexOf(project.meta.theme) >= 0 ? '#191919' : '#ffffff';
      overlay.style.background = overlayBg;

      // init present deck lazily
      // Use the SAME slide dimensions as the editor so elements don't get clipped
      const dims = sizeMap(project.meta.size || 'default');
      if (!presentDeckReady) {
        presentDeck = new Reveal($('#present-reveal'), {
          controls: true,
          progress: true,
          center: false, // keep present mode aligned with the editor (absolute slide coords)
          hash: false,
          view: 'slides', // classic slide-by-slide presentation
          scrollActivationWidth: null, // never auto-switch to scroll layout in narrow windows
          transition: project.meta.transition,
          transitionSpeed: project.meta.transitionSpeed || 'default',
          autoSlide: project.meta.autoSlide || 0,
          autoSlideStoppable: true,
          loop: !!project.meta.loop,
          width: dims.w,
          height: dims.h,
          margin: 0.04,
          minScale: 0.2,
          maxScale: 2.0,
          // search: Ctrl+F 内容搜索; zoom: Alt+点击 局部放大（仅演示模式启用）
          plugins: [RevealMarkdown, RevealHighlight, RevealNotes, RevealSearch, RevealZoom],
        });
        await presentDeck.initialize();
        presentDeckReady = true;
        // count-up numbers run each time a slide becomes current; GeoGebra
        // applets / URL embeds are mounted only for the slide being shown
        // (injecting into hidden slides renders them blank)
        presentDeck.on('slidechanged', (e) => {
          if (e && e.currentSlide) {
            PresentControls.clearAnnot();   // 翻页自动清除批注
            animateCountUps(e.currentSlide);
            PresentControls.refreshNotes();
            applyAllRfit(e.currentSlide);
      applyAllMathFit(e.currentSlide);
            applyEnterHl(e.currentSlide);
            applyEntrance(e.currentSlide);
            const shown = e.currentSlide;
            setTimeout(() => {
              // only mount when the slide is still the visible one
              if (shown.classList.contains('present')) {
                renderGgbLocal(shown);
                watchGgbEmbeds(shown);
              }
            }, 100);
          }
        });
      } else {
        presentDeck.configure({ transition: project.meta.transition, transitionSpeed: project.meta.transitionSpeed || 'default', autoSlide: project.meta.autoSlide || 0, loop: !!project.meta.loop, width: dims.w, height: dims.h });
        presentDeck.sync();
      }

      presentDeck.slide(currentIndex, currentV || 0);

      // 防止进入演示时误入"概览视图"：Reveal 有时会因布局/时序判定为概览，
      // 或此前遗留的 overview 状态未复位。强制回到普通分页视图，并监听
      // overviewshown 时自动退出（除非用户主动点击控制条的概览按钮）。
      const exitOverviewIfNeeded = () => {
        if (presentDeck && typeof presentDeck.isOverview === 'function' && presentDeck.isOverview()) {
          presentDeck.toggleOverview(false);
        }
      };
      exitOverviewIfNeeded();
      setTimeout(exitOverviewIfNeeded, 60);
      setTimeout(exitOverviewIfNeeded, 300);

      // replay entrance animations on the initially-presented slide (slidechanged
      // only fires on *transition*, so the first page needs an explicit nudge).
      const presInitial = $('#present-slides section.present');
      if (presInitial) {
        setTimeout(() => applyEntrance(presInitial), 100);
        setTimeout(() => applyEntrance(presInitial), 400);
      }

      // show & sync the present-mode control bar (概览/自动播放/循环/暂停/全屏/帮助…)
      PresentControls.setup();

      // init the annotate canvas sized to the reveal viewport
      PresentControls.initAnnot();

      // render math formulas
      renderMath($('#present-slides'));

      // Reveal 排版扩展（演示视图）：自动适配字号
      applyAllRfit($('#present-slides'));
      applyAllMathFit($('#present-slides'));
      // 出现动画色：仅对当前页播放（进入该页时再添加 class，动画随页呈现）
      const presCurSlide = $('#present-slides section.present');
      if (presCurSlide) applyEnterHl(presCurSlide);

      // run count-up on the initial slide (after layout settles)
      requestAnimationFrame(() => {
        const cur = $('#present-slides section.present');
        if (cur) animateCountUps(cur);
      });

      // render live Desmos calculators
      renderDesmos($('#present-slides'));
      // render local .ggb files / blank apps via GGBApplet API — only on the
      // visible slide (deferred until the deck has laid out), others mount on
      // slidechanged
      const presCur = $('#present-slides section.present');
      if (presCur) setTimeout(() => { renderGgbLocal(presCur); watchGgbEmbeds(presCur); }, 120);

      // try fullscreen
      if (overlay.requestFullscreen) {
        overlay.requestFullscreen().catch(() => {});
      }
    } catch (err) {
      console.error('enterPresent error:', err);
      toast('演示模式出错: ' + err.message, 'error');
      // hide overlay if it was shown but broken
      $('#present-overlay').classList.add('hidden');
    }
  }

  function exitPresent() {
    const overlay = $('#present-overlay');
    overlay.classList.add('hidden');
    PresentControls.teardown();
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    // sync back the current slide index from present deck
    if (presentDeckReady && presentDeck) {
      currentIndex = presentDeck.getState().indexh;
      currentV = presentDeck.getState().indexv || 0;
      Preview.goTo(currentIndex);
    }
    // clear the (now hidden) present-mode applets; the editor applet was never
    // touched, so it stays intact and needs no re-injection
    $$('#present-slides .slide-element[data-type="embed"][data-ggb-file], #present-slides .slide-element[data-type="embed"][data-ggb-app]').forEach((el) => {
      const host = el.querySelector('.ggb-host');
      if (host) host.innerHTML = '';
      el._ggbInjected = false;
      el._ggbApplet = null;
    });
  }

  /* ===== Helpers ===== */

  function applyTheme(theme) {
    const link = $('#theme-link');
    // 本地优先：先取随包发布的 revealjs/theme/{theme}.css（离线可用），
    // 加载失败再逐级回退 CDN（jsdelivr -> unpkg）。
    link.onerror = null;
    link.href = 'revealjs/theme/' + theme + '.css';
    link.onerror = () => {
      link.onerror = null;
      link.href = THEME_CDN + '/' + theme + '.css';
      link.onerror = () => {
        link.href = 'https://unpkg.com/reveal.js@5/dist/theme/' + theme + '.css';
        link.onerror = null;
      };
    };
    Store.updateMeta('theme', theme);
  }

  function applyFont(font) {
    const slides = $('#slides-container');
    if (!slides) return;
    slides.style.fontFamily = font || '';
    // dynamically load Google Font
    let fontLink = $('#google-font-link');
    if (font) {
      if (!fontLink) {
        fontLink = document.createElement('link');
        fontLink.id = 'google-font-link';
        fontLink.rel = 'stylesheet';
        document.head.appendChild(fontLink);
      }
      fontLink.href = 'https://fonts.googleapis.com/css2?family=' +
        encodeURIComponent(font).replace(/%20/g, '+') + ':wght@400;500;600;700&display=swap';
    } else if (fontLink) {
      fontLink.remove();
    }
    Store.updateMeta('font', font);
  }

  function applySize(size) {
    const dims = sizeMap(size);
    if (editorDeck) {
      editorDeck.configure({ width: dims.w, height: dims.h });
      // resize the visible editor card to match
      const reveal = $('#reveal');
      if (reveal) {
        reveal.style.width = dims.w + 'px';
        reveal.style.height = dims.h + 'px';
      }
      // re-position the guide after the slide resizes
      setTimeout(updateStageFrame, 60);
    }
  }

  function sizeMap(size) {
    switch (size) {
      case 'wide': return { w: 1280, h: 720 };
      case 'square': return { w: 700, h: 700 };
      case 'a4': return { w: 1123, h: 794 };
      default: return { w: 960, h: 700 };
    }
  }

  /* ===== Presentation window (the editor IS the presentation window) ===== */
  function updateStageFrame() {
    const area = $('#canvas-area');
    const reveal = $('#reveal');
    const overlay = $('#stage-safe-overlay');
    if (!area || !reveal) return;
    // Read Reveal's currently configured dimensions
    const dims = sizeMap(project && project.meta && project.meta.size || 'default');
    // Apply sizing — Reveal itself becomes the "card" on the dark canvas
    reveal.style.setProperty('--stage-w', dims.w + 'px');
    reveal.style.setProperty('--stage-h', dims.h + 'px');
    reveal.style.width = dims.w + 'px';
    reveal.style.height = dims.h + 'px';
    // Tell Reveal.js to use these as its internal viewport too
    if (editorDeck) {
      try { editorDeck.configure({ width: dims.w, height: dims.h }); } catch (e) {}
    }
    // Position the safe-area overlay to match the reveal card
    if (overlay && !overlay.classList.contains('hidden')) {
      const ar = reveal.getBoundingClientRect();
      const ac = area.getBoundingClientRect();
      overlay.style.left = (ar.left - ac.left) + 'px';
      overlay.style.top = (ar.top - ac.top) + 'px';
      overlay.style.width = ar.width + 'px';
      overlay.style.height = ar.height + 'px';
    }
  }

  function toggleStageFrame(force) {
    const overlay = $('#stage-safe-overlay');
    const btn = $('#stage-frame-toggle');
    if (!overlay) return;
    const show = (typeof force === 'boolean') ? force : overlay.classList.contains('hidden');
    overlay.classList.toggle('hidden', !show);
    if (btn) btn.classList.toggle('active', show);
    if (show) updateStageFrame();
  }

  function randomColor() {
    const h = Math.floor(Math.random() * 360);
    return 'hsl(' + h + ', 60%, 25%)';
  }

  function isInEditable(node) {
    let el = node.nodeType === 3 ? node.parentNode : node;
    while (el) {
      if (el.isContentEditable) return true;
      el = el.parentNode;
    }
    return false;
  }

  // debounced history push for content edits
  let historyTimer = null;
  function debouncedHistoryPush() {
    clearTimeout(historyTimer);
    historyTimer = setTimeout(() => History.push(), 800);
  }

  function syncCurrentSlide() {
    if (suppressInputSync) return;
    const active = Nav.activeSlide(currentIndex, currentV);
    if (!active) return;
    // find the section that holds the active slide by its data-id (this may be a
    // child vertical section nested inside a chapter's outer section)
    let section = null;
    const byId = function (sec) {
      if (sec && sec.getAttribute('data-id') === active.id) return sec;
      return null;
    };
    for (const top of $$('#slides-container > section')) {
      section = byId(top);
      if (section) break;
      const verts = $$(':scope > section', top);
      for (const v of verts) { section = byId(v); if (section) break; }
      if (section) break;
    }
    if (!section) return;
    // clone and strip editor-only artifacts before saving
    // persist live Desmos calculator state into the dataset first
    $$('.slide-element[data-type="desmos"]', section).forEach(el => saveDesmosState(el));
    const clone = section.cloneNode(true);
    $$('.el-handle', clone).forEach(h => h.remove());
    $$('.el-endpoint', clone).forEach(h => h.remove());
    $$('.el-embed-overlay', clone).forEach(el => el.remove());
    $$('.ggb-chip, .video-chip', clone).forEach(el => el.remove());
    $$('.ggb-fail', clone).forEach(el => el.remove());
    $$('.ggb-hint', clone).forEach(el => el.remove());
    // reset live Desmos calculator host to empty (keep the saved state in dataset)
    $$('.desmos-host', clone).forEach(g => { g.innerHTML = ''; });
    $$('.ggb-host', clone).forEach(g => { g.innerHTML = ''; });
    $$('.slide-element.selected', clone).forEach(el => el.classList.remove('selected'));
    $$('.slide-element[data-bound]', clone).forEach(el => el.removeAttribute('data-bound'));
    $$('.el-text[contenteditable="true"]', clone).forEach(el => el.setAttribute('contenteditable', 'false'));
    $$('.el-table td[contenteditable="true"], .el-table th[contenteditable="true"]', clone).forEach(el => el.setAttribute('contenteditable', 'false'));
    stripAAIds(clone);
    const cleaned = clone.innerHTML;
    active.content = cleaned;
    Store.persist();
    debouncedHistoryPush();
    // update the matching thumbnail (chapter self or a child)
    updateThumbnailFor(active, cleaned);
  }

  function updateCounter() {
    const total = Nav.flatCount();
    let pos = currentIndex + 1;
    // if currently inside a chapter's vertical, show "h.v / total" style
    let label = (currentIndex + 1) + ' / ' + total;
    if (Nav.isChapter(project.slides[currentIndex]) && currentV > 0) {
      label = (currentIndex + 1) + '.' + currentV + ' / ' + total;
    }
    $('#slide-counter').textContent = label;
    updateStatusBar();
  }

  function updateStatusBar() {
    // element count (active slide only; for a chapter this is the current
    // vertical, not the whole outer section which nests the children)
    const active = Nav.activeSlide(currentIndex, currentV);
    const section = active ? sectionById(active.id) : null;
    const count = section ? $$('.slide-element', section).length : 0;
    const elSpan = $('#status-elements');
    if (elSpan) elSpan.textContent = count + ' 个元素 · 项目 ' + (project.slides ? project.slides.length : 0) + ' 页';

    // layout ratio
    const dims = sizeMap(project.meta.size || 'default');
    const ratio = (dims.w / dims.h).toFixed(2);
    const layoutSpan = $('#status-layout');
    if (layoutSpan) {
      const ratios = { '1.78': '16:9', '1.00': '1:1', '1.41': 'A4', '1.37': '4:3' };
      layoutSpan.textContent = ratios[ratio] || ratio;
    }

    // theme name
    const themeSpan = $('#status-theme-name');
    if (themeSpan) {
      themeSpan.textContent = (project.meta.theme || 'white').charAt(0).toUpperCase() +
        (project.meta.theme || 'white').slice(1);
    }
  }

  function setSaveStatus(saving) {
    const dot = $('#save-dot');
    const text = $('#save-text');
    if (saving) {
      dot.className = 'status-dot saving';
      text.textContent = '保存中...';
    } else {
      dot.className = 'status-dot';
      text.textContent = '已保存';
    }
  }

  function toggleFragment() {
    const sel = window.getSelection();
    if (!sel.rangeCount) {
      toast('请先选中一个元素', 'error');
      return;
    }
    let node = sel.anchorNode;
    if (node.nodeType === 3) node = node.parentNode;
    // find the closest block-level element
    const blocks = ['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'IMG', 'BLOCKQUOTE', 'PRE'];
    while (node && node.tagName !== 'SECTION') {
      if (blocks.indexOf(node.tagName) >= 0) break;
      node = node.parentNode;
    }
    if (!node || node.tagName === 'SECTION') {
      toast('请选中段落或列表项', 'error');
      return;
    }
    if (node.classList.contains('fragment')) {
      node.classList.remove('fragment');
      // remove fade-in etc if present
      ['fade-in', 'fade-out', 'grow', 'shrink', 'fade-out', 'highlight-current-blue', 'highlight-current-green', 'highlight-current-red'].forEach(c => node.classList.remove(c));
      toast('已移除片段');
    } else {
      node.classList.add('fragment');
      toast('已添加片段动画', 'success');
    }
    syncCurrentSlide();
  }

  function newPresentation() {
    AppConfirm('新建将清空当前内容，确定吗？', '新建演示文稿').then(function (ok) {
      if (!ok) return;
      VersionControl.save('新建前 · ' + VersionControl.autoName());
      project = Store.newProject();
      currentIndex = 0;
      localStorage.removeItem(AUTOSAVE_KEY);
      PropsPanel.refreshAll();
      Preview.render();
      applyTheme(project.meta.theme);
      applyFont(project.meta.font || '');
      History.stack = [];
      History.pointer = -1;
      History.push();
      toast('已新建演示文稿', 'success');
    });
  }

  /** 系统原生"另存为"保存。优先用 WebView2/Chromium 的 showSaveFilePicker
   *  （弹系统原生对话框，选路径、输文件名、浏览器直接写文件）；若该 API
   *  不可用或失败，自动回退到自定义 ExportDialog 文件夹对话框（保底）。
   *  @param {string} filename  建议文件名（含扩展名）
   *  @param {string} mime      MIME 类型
   *  @param {string|Uint8Array|ArrayBuffer} data  要写入的内容
   *  @returns {Promise<boolean>} 是否保存成功 */
  async function saveViaDialog(filename, mime, data) {
    // 统一转成 Uint8Array 以便写入
    let bytes;
    if (typeof data === 'string') bytes = new TextEncoder().encode(data);
    else if (data instanceof Uint8Array) bytes = data;
    else bytes = new Uint8Array(data);
    const ext = (String(filename).split('.').pop() || '').toLowerCase();

    // 1) 优先：系统原生"另存为"对话框
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const types = [{ description: mime || '文件', accept: { [mime || 'application/octet-stream']: ['.' + ext] } }];
        const handle = await window.showSaveFilePicker({ suggestedName: filename, types: types });
        const writable = await handle.createWritable();
        await writable.write(bytes);
        await writable.close();
        toast('已保存：' + (handle.name || filename), 'success');
        return true;
      } catch (e) {
        if (e && e.name === 'AbortError') return false; // 用户取消，静默返回
        // 其它失败（如 API 触发错误）→ 降级到自定义对话框
        console.warn('showSaveFilePicker 失败，回退到自定义对话框:', e && e.message);
      }
    }

    // 2) 回退：自定义文件夹对话框 + 后端写文件
    return new Promise((resolve) => {
      ExportDialog.pick(filename).then((dest) => {
        if (!dest) { resolve(false); return; }
        saveExportFile(dest.dir, dest.name, b64Encode(bytes)).then((r) => {
          if (r && r.ok) { toast('已保存到 ' + (r.path || dest.dir), 'success'); resolve(true); }
          else { toast('保存失败: ' + ((r && r.error) || '未知错误'), 'error'); resolve(false); }
        }).catch(() => { toast('保存失败: 无法写入文件', 'error'); resolve(false); });
      });
    });
  }

  function saveProject() {
    syncCurrentSlide();
    const data = JSON.stringify(project, null, 2);
    const filename = (project.meta.title || '演示文稿') + '.revealslidr.json';
    saveViaDialog(filename, 'application/json', data);
  }

  function openFile() {
    const input = $('#file-input');
    input.value = '';
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = reader.result;
          let data;
          if (file.name.endsWith('.json')) {
            data = JSON.parse(text);
          } else if (file.name.endsWith('.html') || file.name.endsWith('.htm')) {
            data = parseHTMLPresentation(text);
          } else {
            // try markdown
            data = parseMarkdownPresentation(text);
          }
          if (data && data.slides && data.slides.length > 0) {
            VersionControl.save('打开前 · ' + VersionControl.autoName());
            project = data;
            currentIndex = 0;
            applyTheme(project.meta.theme || DEFAULT_THEME);
            applyFont(project.meta.font || '');
            PropsPanel.refreshAll();
            Preview.render();
            History.stack = [];
            History.pointer = -1;
            History.push();
            toast('已打开文件', 'success');
          } else {
            toast('无法解析文件', 'error');
          }
        } catch (e) {
          console.error(e);
          toast('文件解析失败: ' + e.message, 'error');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function parseHTMLPresentation(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const sections = Array.from(doc.querySelectorAll('.reveal .slides > section'));
    if (sections.length === 0) throw new Error('未找到幻灯片');
    const themeLink = doc.querySelector('#theme');
    const themeName = themeLink ? (themeLink.href.match(/\/(\w+)\.css$/) || [])[1] : DEFAULT_THEME;
    return {
      meta: {
        title: doc.title || '导入的演示',
        description: '',
        theme: themeName || DEFAULT_THEME,
        transition: DEFAULT_TRANSITION,
        transitionSpeed: 'default',
        size: 'default',
        font: '',
        margin: 0.05,
        lang: 'zh-CN',
        navMode: 'default',
        slideNumbers: false,
        autoSlide: 0,
        loop: false,
      },
      slides: sections.map(s => ({
        id: uid(),
        content: s.innerHTML,
        bg: s.dataset.backgroundColor ? { color: s.dataset.backgroundColor } : null,
        notes: (s.querySelector('.notes') || {}).textContent || '',
        autoAnimate: s.hasAttribute('data-auto-animate'),
        transitionSpeed: s.dataset.transitionSpeed || undefined,
      })),
    };
  }

  function parseMarkdownPresentation(md) {
    // Split by --- or ---\n on its own line as slide separator
    const parts = md.split(/\n---+\s*\n/);
    return {
      meta: {
        title: 'Markdown 导入',
        description: '',
        theme: DEFAULT_THEME,
        transition: DEFAULT_TRANSITION,
        transitionSpeed: 'default',
        size: 'default',
        font: '',
        margin: 0.05,
        lang: 'zh-CN',
        navMode: 'default',
        slideNumbers: false,
        autoSlide: 0,
        loop: false,
      },
      slides: parts.map((part, i) => {
        part = part.trim();
        if (!part) part = '<p>空幻灯片</p>';
        // Convert simple markdown: # headings, - lists
        const html = mdToHtml(part);
        return { id: uid(), content: html, bg: null, notes: '' };
      }),
    };
  }

  function mdToHtml(md) {
    const lines = md.split('\n');
    let html = '';
    let inList = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^#{1}\s/.test(trimmed)) {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<h1>' + escHTML(trimmed.replace(/^#\s/, '')) + '</h1>';
      } else if (/^#{2}\s/.test(trimmed)) {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<h2>' + escHTML(trimmed.replace(/^##\s/, '')) + '</h2>';
      } else if (/^#{3}\s/.test(trimmed)) {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<h3>' + escHTML(trimmed.replace(/^###\s/, '')) + '</h3>';
      } else if (/^[-*]\s/.test(trimmed)) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += '<li>' + escHTML(trimmed.replace(/^[-*]\s/, '')) + '</li>';
      } else if (trimmed) {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<p>' + escHTML(trimmed) + '</p>';
      }
    }
    if (inList) html += '</ul>';
    return html;
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function escHTML(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escAttr(s) {
    return String(s).replace(/"/g, '&quot;');
  }
  function rgbToHex(rgb) {
    if (!rgb) return '#333333';
    if (rgb.charAt(0) === '#') return rgb;
    var match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return '#333333';
    return '#' + ((1 << 24) + (parseInt(match[1], 10) << 16) +
      (parseInt(match[2], 10) << 8) + parseInt(match[3], 10))
      .toString(16).slice(1);
  }

  function renderMath(root) {
    if (window.MathJax && window.MathJax.typesetPromise) {
      root = root || document;
      // 行内公式：优先用 tex2svg 渲染到预置的 .el-math-inline span 内，
      // 保留 span + data-latex，使双击编辑时能把 SVG 还原回 \(...\) 源码。
      try {
        if (typeof window.MathJax.tex2svg === 'function') {
          const spans = root.querySelectorAll ? root.querySelectorAll('.el-math-inline[data-latex]') : [];
          spans.forEach((sp) => {
            const latex = sp.getAttribute('data-latex') || '';
            if (!latex) return;
            const node = window.MathJax.tex2svg(latex, { display: false });
            if (node) {
              sp.innerHTML = '';
              sp.appendChild(node);
            }
          });
        }
      } catch (e) { /* fall back to global typeset below */ }
      // 其余 \(...\) / $$...$$（用户直接输入的文本节点）用全局 typeset 兜底渲染
      window.MathJax.typesetPromise([root]).catch(function(){});
    }
  }

  /** 双击编辑前，把已渲染的公式 SVG 还原回 LaTeX 源码（便于修改公式）。 */
  function restoreMathSource(el) {
    if (!el) return;
    // 行内公式 span（保留 data-latex）：把 SVG 内容替换为 \(latex\)
    if (el.querySelectorAll) {
      el.querySelectorAll('.el-math-inline[data-latex]').forEach((sp) => {
        const latex = sp.getAttribute('data-latex') || '';
        if (!latex) return;
        sp.textContent = '\\(' + latex + '\\)';
      });
      // 块级行内公式（displayMath $$..$$，无 data-latex 时从原始 textContent 兜底）
      el.querySelectorAll('mjx-container').forEach((mj) => {
        // 若未被 data-latex span 处理，且是块级，尝试还原（占位：保留源码提示）
        if (!mj.closest('.el-math-inline')) {
          // 无法可靠还原全局 typeset 的文本，跳过（保持 SVG）
          return;
        }
      });
    }
  }

  /** Normalize user math input for MathJax:
   *  - bare LaTeX (no $)      → display mode  $$...$$
   *  - single-$ segments      → inline mode   \(...\)
   *  - $$...$$ blocks         → passed through as display math
   *  - mixed text like "当$x>0$时" keeps surrounding text as-is
   *  Global MathJax config stays untouched, so ordinary text elements
   *  containing $ (e.g. prices) are never misinterpreted as math.
   */
  function mathProcessInput(src) {
    let s = String(src || '');
    if (!s) return s;
    if (s.indexOf('$') === -1) return '$$' + s + '$$';
    let out = '';
    let i = 0;
    const n = s.length;
    while (i < n) {
      const ch = s[i];
      if (ch !== '$') { out += ch; i++; continue; }
      if (s[i + 1] === '$') {
        // display delimiter pair: pass through to the closing $$
        const close = s.indexOf('$$', i + 2);
        if (close === -1) { out += s.substring(i); break; }
        out += s.substring(i, close + 2);
        i = close + 2;
      } else {
        // inline: find the closing single $ (not followed by another $)
        let found = -1;
        for (let j = i + 1; j < n; j++) {
          if (s[j] === '$' && s[j + 1] !== '$') { found = j; break; }
        }
        if (found === -1) { out += s.substring(i); break; }
        out += '\\(' + s.substring(i + 1, found) + '\\)';
        i = found + 1;
      }
    }
    return out;
  }

  /** Typeset a math element, then re-sync the slide so stored content
      (and therefore exported HTML) contains the rendered SVG output. */
  function renderMathThenSync(el) {
    if (window.MathJax && window.MathJax.typesetPromise) {
      window.MathJax.typesetPromise([el]).catch(function(){}).then(function() {
        syncCurrentSlide();
      });
    } else {
      syncCurrentSlide();
    }
  }

  /* ===== Auto-animate (morph) helpers ===== */

  /** GeoGebra retired https://www.geogebra.org/material/iframe/id/{id}?border=0 (HTTP 410);
      migrate old stored embed URLs to the current classic/{id}?embed scheme. */
  function normalizeGgbEmbeds(html) {
    return String(html).replace(/https:\/\/www\.geogebra\.org\/material\/iframe\/id\/([A-Za-z0-9._~-]+)\?border=0/g,
      function (m, id) { return 'https://www.geogebra.org/classic/' + id + '?embed'; });
  }

  /** Inject data-auto-animate-id (mirroring data-eid) into stored slide HTML */
  function injectAAIds(html) {
    return normalizeGgbEmbeds(html).replace(/(<[^>]*?)data-eid="([^"]+)"/g, '$1data-eid="$2" data-auto-animate-id="$2"');
  }

  /** Strip data-auto-animate-id from a cloned DOM subtree before persisting */
  function stripAAIds(root) {
    $$('[data-auto-animate-id]', root).forEach(el => el.removeAttribute('data-auto-animate-id'));
  }

  /* ===== Count-up number animation (present mode / export) ===== */
  function animateCountUps(slideEl) {
    if (!slideEl) return;
    $$('.slide-element[data-countup] .el-text', slideEl).forEach(t => {
      const original = t.dataset.cuOriginal || t.textContent.trim();
      t.dataset.cuOriginal = original;
      const m = original.match(/^([^0-9]*)([0-9][0-9,]*(?:\.\d+)?)([\s\S]*)$/);
      if (!m) return;
      const num = parseFloat(m[2].replace(/,/g, ''));
      if (!isFinite(num)) return;
      const dec = (m[2].split('.')[1] || '').length;
      const useComma = m[2].indexOf(',') >= 0;
      const dur = 1200;
      const start = performance.now();
      function frame(now) {
        const p = Math.min(1, (now - start) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        const v = num * eased;
        let s = v.toFixed(dec);
        if (useComma) {
          s = Number(s).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
        }
        t.textContent = m[1] + s + m[3];
        if (p < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }

  /* ===== Text display effects (highlight / gradient / shadow / stroke / dropcap) ===== */
  function applyTextEffects(el) {
    if (!el || el.dataset.type !== 'text') return;
    const t = el.querySelector('.el-text');
    if (!t) return;
    // reset effect-scoped inline styles
    t.style.background = '';
    t.style.backgroundImage = '';
    t.style.webkitBackgroundClip = '';
    t.style.backgroundClip = '';
    t.style.webkitTextFillColor = '';
    t.style.webkitTextStroke = '';
    t.style.textShadow = '';
    t.style.boxShadow = '';
    t.style.webkitBoxShadow = '';
    t.style.padding = '';
    t.style.borderRadius = '';
    t.style.boxDecorationBreak = '';
    t.style.webkitBoxDecorationBreak = '';
    t.style.fontWeight = '';
    t.style.fontStyle = '';
    t.style.textDecoration = '';
    t.style.textTransform = '';
    t.style.fontVariant = '';
    t.style.zoom = '';
    t.style.transform = '';
    t.classList.remove('has-dropcap');
    t.classList.remove('enter-hl-red', 'enter-hl-green', 'enter-hl-blue');

    // typography presets (Reveal 排版风格: h4 small-caps / h6 italic / a underline / del strike)
    const tfx = (el.dataset.tfx || '').split(/\s+/).filter(Boolean);
    if (tfx.indexOf('bold') >= 0) t.style.fontWeight = '700';
    if (tfx.indexOf('italic') >= 0) t.style.fontStyle = 'italic';
    if (tfx.indexOf('underline') >= 0) t.style.textDecoration = 'underline';
    if (tfx.indexOf('strike') >= 0) t.style.textDecoration = 'line-through';
    if (tfx.indexOf('uppercase') >= 0) t.style.textTransform = 'uppercase';
    if (tfx.indexOf('smallcaps') >= 0) t.style.fontVariant = 'small-caps';

    // highlight (marker band behind text)
    if (el.dataset.hl) {
      t.style.background = el.dataset.hl;
      t.style.boxDecorationBreak = 'clone';
      t.style.webkitBoxDecorationBreak = 'clone';
      t.style.padding = '0.05em 0.18em';
      t.style.borderRadius = '0.2em';
    }
    // gradient text fill
    if (el.dataset.grad) {
      const from = el.dataset.gradFrom || '#534AB7';
      const to = el.dataset.gradTo || '#FF6B9A';
      t.style.backgroundImage = 'linear-gradient(100deg,' + from + ',' + to + ')';
      t.style.webkitBackgroundClip = 'text';
      t.style.backgroundClip = 'text';
      t.style.webkitTextFillColor = 'transparent';
      t.style.color = 'transparent';
    } else {
      // restore solid color when gradient is removed (editor context)
      const pc = $('#el-text-color');
      if (pc) t.style.color = pc.value;
    }
    // text shadow：预设（向后兼容）+ 自定义（颜色/层次/角度）
    const ts = el.dataset.tshadow;
    t.style.textShadow = '';
    if (ts && ts !== 'none') {
      if (ts === 'neon') {
        const glow = el.dataset.tshadowColor || el.dataset.hl || el.dataset.gradFrom || '#534AB7';
        t.style.textShadow = '0 0 6px ' + glow + ',0 0 16px ' + glow;
      } else if (el.dataset.tshadowColor || el.dataset.tshadowDepth || el.dataset.tshadowAngle) {
        const layers = buildShadowLayers(el.dataset.tshadowAngle, el.dataset.tshadowDepth, el.dataset.tshadowColor);
        t.style.textShadow = layers.map(l => l.ox + 'px ' + l.oy + 'px ' + l.blur + 'px ' + l.color).join(', ');
      } else if (ts === 'soft') {
        t.style.textShadow = '0 1px 3px rgba(0,0,0,0.35)';
      } else if (ts === 'strong') {
        t.style.textShadow = '0 2px 6px rgba(0,0,0,0.55)';
      }
    }
    // stroke / outline (hollow text)
    if (el.dataset.stroke) {
      const w = el.dataset.strokeW || '2';
      const c = el.dataset.strokeColor || '#ffffff';
      t.style.webkitTextStroke = w + 'px ' + c;
    }
    // drop cap
    if (el.dataset.dropcap === '1') t.classList.add('has-dropcap');

    // 自动适配字号（源自 Reveal 的 r-fit-text）：超出文本框时缩放填充
    if (el.dataset.rfit === '1') fitRfitText(el);
  }

  /** r-fit-text 风格自动适配：文字超出文本框时整体缩放（zoom，不改动字号持久值） */
  function fitRfitText(el) {
    if (!el || el.dataset.type !== 'text' || el.dataset.rfit !== '1') return;
    const t = el.querySelector('.el-text');
    if (!t) return;
    t.style.zoom = '1';
    t.style.transform = '';
    const availW = Math.max(30, el.clientWidth - 14);
    const availH = Math.max(30, el.clientHeight - 14);
    const w = t.scrollWidth;
    const h = t.scrollHeight;
    if (w <= availW && h <= availH) return;
    const f = Math.min(availW / w, availH / h, 1);
    if (f >= 1) return;
    t.style.zoom = String(f);
    if (!('zoom' in t.style)) {
      // zoom 属性不支持的浏览器用 transform 缩放（仅视觉，布局不变）
      t.style.transform = 'scale(' + f + ')';
      t.style.transformOrigin = 'top left';
    }
  }

  function applyAllRfit(root) {
    const scope = root || document;
    $$('.slide-element[data-type="text"][data-rfit="1"]', scope).forEach(fitRfitText);
  }

  /** 让数学公式元素的内容自动缩放以撑满其盒子：放大盒子 → 公式变大，缩小 → 变小。
      用于 data-type="math" 的元素。注意 MathJax 渲染的是固定尺寸的 SVG，改 font-size
      不会放大 SVG，须用 transform: scale() 缩放。 */
  function fitMathElement(el) {
    if (!el || el.getAttribute('data-type') !== 'math') return;
    const m = el.querySelector('.el-math');
    if (!m) return;
    // 用真实内容（MathJax 的 mjx-container / 首个子节点）的自然尺寸
    const content = m.querySelector('mjx-container') || m.firstElementChild || m;
    m.style.transform = ''; m.style.zoom = ''; m.style.fontSize = '';
    const boxW = Math.max(30, el.clientWidth - 8);
    const boxH = Math.max(30, el.clientHeight - 8);
    const cw = content.offsetWidth || m.scrollWidth;
    const ch = content.offsetHeight || m.scrollHeight;
    if (!cw || !ch) return;
    // 允许放大（>1）也缩小（<1），让公式撑满盒子（SVG 尺寸固定 → 用 transform scale）。
    // 不设 f≈1 的提前返回，确保放大始终生效。
    const f = Math.min(boxW / cw, boxH / ch);
    if (f <= 0.02) return;
    m.style.transform = 'scale(' + f + ')';
    m.style.transformOrigin = 'center center';
  }
  function applyAllMathFit(root) {
    const scope = root || document;
    $$('.slide-element[data-type="math"]', scope).forEach(fitMathElement);
  }

  /** 给页面里的文本元素添加「出现动画色」class（进入该页时调用，动画随页播放） */
  function applyEnterHl(section) {
    if (!section) return;
    $$('.slide-element[data-type="text"]', section).forEach((pel) => {
      const pt = pel.querySelector('.el-text');
      if (pt && pel.dataset.enterHl) pt.classList.add('enter-hl-' + pel.dataset.enterHl);
    });
  }

  /* Replay each element's entrance (data-entrance) animation when a slide becomes
     current in present mode. CSS animation on [data-entrance] only plays once at
     initial render; force a reflow + re-apply so it replays each time you arrive. */
  function applyEntrance(section) {
    if (!section) return;
    $$('.slide-element[data-entrance]', section).forEach((el) => {
      const a = el.getAttribute('data-entrance');
      if (!a || a === 'none') return;
      // force reflow: reset any running animation, then let the class-rule
      // animation restart so it replays each time the slide becomes current.
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
    });
  }

  /* ===== 统一色板系统（主题色分组 + 自定义收藏色 + 常用色） ===== */
  const TEXT_COLOR_PRESETS = [
    '#000000', '#1F2937', '#374151', '#6B7280', '#9CA3AF', '#D1D5DB', '#F3F4F6',
    '#EF4444', '#F97316', '#F59E0B', '#FACC15', '#22C55E', '#10B981', '#14B8A6',
    '#06B6D4', '#0EA5E9', '#3B82F6', '#6366F1', '#8B5CF6', '#A855F7', '#D946EF',
    '#EC4899', '#F43F5E', '#534AB7', '#7C3AED', '#0B1020', '#1E293B', '#FFFFFF',
  ];
  const SWATCH_FAV_KEY = 'revealslidr:fav-colors';
  const _swatchPalettes = []; // 已注册的色板 { box, inputId, applyFn }

  /** 当前模板主题色（商务蓝 / 深色科技 / 自然清新），主题切换后色板自动刷新 */
  function swatchThemeColors() {
    try {
      const t = TemplateLibrary.theme();
      return [t.primary, t.secondary, t.accent, t.success, t.dark, t.light].filter(Boolean);
    } catch (e) { return []; }
  }
  function getFavColors() {
    try {
      const a = JSON.parse(localStorage.getItem(SWATCH_FAV_KEY) || '[]');
      return Array.isArray(a) ? a.filter(c => typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c)) : [];
    } catch (e) { return []; }
  }
  function saveFavColors(a) {
    try { localStorage.setItem(SWATCH_FAV_KEY, JSON.stringify(a.slice(0, 24))); } catch (e) {}
  }

  function renderSwatchPalette(p) {
    const box = p.box;
    if (!box) return;
    box.innerHTML = '';
    const groups = [
      ['主题色', swatchThemeColors()],
      ['我的收藏', getFavColors()],
      ['常用色', TEXT_COLOR_PRESETS],
    ];
    groups.forEach(([label, colors]) => {
      if (!colors.length) return;
      const lab = document.createElement('span');
      lab.className = 'swatch-group-label';
      lab.textContent = label;
      box.appendChild(lab);
      colors.forEach(hex => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch';
        b.dataset.hex = hex;
        b.style.background = hex;
        b.title = hex + (label === '我的收藏' ? '（右键移除收藏）' : '');
        b.addEventListener('click', () => {
          const input = $(p.inputId);
          if (input) input.value = hex;
          if (p.applyFn) p.applyFn(hex);
          else if (input) input.dispatchEvent(new Event('input', { bubbles: true }));
          box.querySelectorAll('.swatch').forEach(s => s.classList.toggle('active', s.dataset.hex.toLowerCase() === hex.toLowerCase()));
        });
        // 收藏色支持右键移除
        if (label === '我的收藏') {
          b.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            saveFavColors(getFavColors().filter(c => c.toLowerCase() !== hex.toLowerCase()));
            renderSwatchPalette(p);
            toast('已移除收藏色 ' + hex, 'success');
          });
        }
        box.appendChild(b);
      });
    });
    // ☆ 收藏当前颜色（取当前 input 的值）
    const fav = document.createElement('button');
    fav.type = 'button';
    fav.className = 'swatch-fav';
    fav.title = '收藏当前颜色';
    fav.textContent = '☆';
    fav.addEventListener('click', () => {
      const input = $(p.inputId);
      const cur = input ? input.value : '';
      if (!cur || !/^#[0-9a-fA-F]{3,8}$/.test(cur)) { toast('请先通过取色器选择颜色', 'info'); return; }
      const up = cur.toUpperCase();
      if (getFavColors().some(c => c.toUpperCase() === up)) { toast('该颜色已在收藏中', 'info'); return; }
      saveFavColors([up].concat(getFavColors()));
      renderSwatchPalette(p);
      toast('已收藏颜色 ' + up, 'success');
    });
    box.appendChild(fav);
  }

  function rebuildSwatchPalettes() {
    _swatchPalettes.forEach(renderSwatchPalette);
  }

  function initColorSwatches() {
    _swatchPalettes.push({ box: $('#text-color-swatches'), inputId: '#el-text-color', applyFn: null });
    renderSwatchPalette(_swatchPalettes[_swatchPalettes.length - 1]);
  }
  /** 文字颜色读取时同步高亮对应色块 */
  function syncColorSwatch(hex) {
    const box = $('#text-color-swatches');
    if (!box || !hex) return;
    box.querySelectorAll('.swatch').forEach(s => s.classList.toggle('active', s.dataset.hex.toLowerCase() === String(hex).toLowerCase()));
  }

  /** 注册一个图形色板（applyFn 直接应用，不依赖 input 监听器） */
  function buildShapeSwatches(boxId, inputId, applyFn) {
    _swatchPalettes.push({ box: $('#' + boxId), inputId: inputId, applyFn: applyFn });
    renderSwatchPalette(_swatchPalettes[_swatchPalettes.length - 1]);
  }
  function initShapeColorSwatches() {
    // 填充颜色：直接写 dataset 并重绘（自动取消「无填充」）
    buildShapeSwatches('fill-color-swatches', '#el-fill', (hex) => {
      if (!Elements.selected || Elements.selected.dataset.type !== 'shape') return;
      const fn = $('#el-fill-none');
      if (fn && fn.checked) { fn.checked = false; delete Elements.selected.dataset.fillNone; }
      Elements.selected.dataset.fill = hex;
      Elements.updateFromProps();
    });
    // 描边颜色
    buildShapeSwatches('stroke-color-swatches', '#el-stroke', (hex) => {
      if (!Elements.selected || Elements.selected.dataset.type !== 'shape') return;
      Elements.selected.dataset.stroke = hex;
      Elements.updateFromProps();
    });
    // 第二颜色 / 线条（渐变/斜线/网格）
    buildShapeSwatches('fill2-color-swatches', '#el-fill-2', (hex) => {
      if (!Elements.selected || Elements.selected.dataset.type !== 'shape') return;
      Elements.selected.dataset.fill2 = hex;
      Elements.updateFromProps();
    });
  }
  /** 图形属性读取时高亮填充/描边色块（kind: fill | stroke | fill2） */
  function syncShapeSwatches(kind, hex) {
    const boxId = kind === 'fill' ? '#fill-color-swatches'
      : (kind === 'fill2' ? '#fill2-color-swatches' : '#stroke-color-swatches');
    const box = $(boxId);
    if (!box || !hex) return;
    box.querySelectorAll('.swatch').forEach(s => s.classList.toggle('active', s.dataset.hex.toLowerCase() === String(hex).toLowerCase()));
  }



  /* ===== 资源加载模式（联网 A / 断网 B）=====
     mode: auto（默认，按检测）/ online（始终在线 A）/ offline（始终离线 B）
     各引擎加载器调用 order(local, cdn) 得到加载顺序：offline → 先本地，online → 先 CDN，auto → 按检测。 */
  const Res = {
    mode: 'auto',
    _online: null,          // 检测结果缓存
    _probeT: 0,
    getMode() {
      if (this.mode === 'auto') return this.isOnline() ? 'online' : 'offline';
      return this.mode;
    },
    isOnline() {
      if (window.__resModeProbe === 'online') return true;   // 供测试覆盖
      if (navigator.onLine === false) return false;          // 明确离线
      if (this._online !== null) return this._online;
      return true;  // 默认认为在线（若后续探测失败再置 false）
    },
    /** 进行一次轻量探测（可选），成功后 _online=true，失败=false */
    probe() {
      const t = Date.now() + 6000;
      // 用加载 favicon 的隐式请求探测连通性
      try {
        const img = new Image();
        img.onload = () => { if (Date.now() < t) Res._online = true; };
        img.onerror = () => Res._online = false;
        img.src = 'https://www.geogebra.org/favicon.ico?' + Date.now();
      } catch (e) {}
    },
    /** 按模式返回 [首选, 次选, ...]：offline 先 local，online 先 cdn */
    order(local, cdn) {
      const m = this.getMode();
      if (m === 'offline') return local.concat(cdn);
      if (m === 'online') return cdn.concat(local);
      // auto：本地上有则先本地（避免额外网络），否则按检测
      return this.isOnline() ? cdn.concat(local) : local.concat(cdn);
    }
  };
  window.__res = Res;
  // 从本地存储恢复上次模式
  try { const rm = localStorage.getItem('resourceMode'); if (rm) Res.mode = rm; } catch (e) {}
  // 启动时探测一次
  setTimeout(() => Res.probe(), 1200);

  /* ===== Desmos live calculator ===== */
  // Default key is the owner's licensed Desmos API key. It can still be
  // overridden at any time via the Settings modal (stored in localStorage).
  const DESMOS_DEMO_KEY = 'a9e5f11d22054973bcfdd0ff63e12d4b';
  function getDesmosApiKey() {
    try {
      const k = localStorage.getItem('desmosApiKey');
      return k && k.trim() ? k.trim() : DESMOS_DEMO_KEY;
    } catch (e) { return DESMOS_DEMO_KEY; }
  }
  let _desmosApiPromise = null;
  function loadDesmosAPI() {
    if (_desmosApiPromise) return _desmosApiPromise;
    _desmosApiPromise = new Promise((resolve, reject) => {
      if (window.Desmos && window.Desmos.GraphingCalculator) { resolve(window.Desmos); return; }
      // Prefer the local vendored engine (offline-safe, no API key); fall back to the CDN.
      // Loaded lazily so the 3.9MB bundle is only fetched when a Desmos element is actually used.
      // 按资源模式排序：offline 先本地(desmos/index.js)、online 先 CDN、auto 检测
      const sources = Res.order(
        ['desmos/index.js'],
        ['https://www.desmos.com/api/v1.13/calculator.js?apiKey=' + encodeURIComponent(getDesmosApiKey())]
      );
      let i = 0;
      (function next() {
        if (i >= sources.length) { reject(new Error('Desmos API 加载失败（本地与 CDN 均不可用）')); return; }
        const url = sources[i++];
        const s = document.createElement('script');
        s.src = url;
        s.onload = () => {
          (window.Desmos && window.Desmos.GraphingCalculator) ? resolve(window.Desmos) : next();
        };
        s.onerror = () => { s.remove(); next(); };
        document.head.appendChild(s);
      })();
    });
    return _desmosApiPromise;
  }

  /** Persist a live Desmos calculator's state into the element's dataset */
  function saveDesmosState(el) {
    if (!el || !el._desmosCalc) return;
    try { el.dataset.desmosState = JSON.stringify(el._desmosCalc.getState()); } catch (e) { /* ignore */ }
  }
  function saveAllDesmosStates(root) {
    if (!root) return;
    $$('.slide-element[data-type="desmos"]', root).forEach(saveDesmosState);
  }

  /** Mount (or resize) Desmos calculators inside a root element */
  function renderDesmos(root) {
    if (!root) return;
    const els = $$('.slide-element[data-type="desmos"]', root);
    if (!els.length) return;
    loadDesmosAPI().then((Desmos) => {
      els.forEach((el) => {
        const host = el.querySelector('.desmos-host');
        if (!host) return;
        if (el._desmosCalc) { try { el._desmosCalc.resize(); } catch (e) {} return; }
        if (host.querySelector('.dcg-calculator')) return; // already mounted
        const calc = Desmos.GraphingCalculator(host, {
          keypad: true,
          expressions: true,
          settingsMenu: true,
          zoomButtons: true,
          expressionsTopbar: true,
          border: true,
          lockViewport: false,
        });
        el._desmosCalc = calc;
        const stateStr = el.dataset.desmosState;
        if (stateStr) {
          try { calc.setState(JSON.parse(stateStr)); } catch (e) { /* ignore */ }
        }
        let t;
        const save = () => { clearTimeout(t); t = setTimeout(() => saveDesmosState(el), 400); };
        try { calc.observeEvent('change', save); } catch (e) {}
        try { calc.observe('expressions', save); } catch (e) {}
        try { calc.observe('settings', save); } catch (e) {}
        try { calc.resize(); } catch (e) {}
      });
    }).catch((err) => {
      toast('Desmos 加载失败：' + err.message, 'error');
    });
  }

  /** Load GeoGebra's deployggb.js (once), returning a Promise for the GGBApplet constructor.
      Prefers the local copy at geogebra/deployggb.js (no CDN); falls back to the CDN
      only when the local loader is absent. */
  var _ggbAppletLoader = null;
  function loadGgbAppletAPI() {
    if (_ggbAppletLoader) return _ggbAppletLoader;
    _ggbAppletLoader = new Promise((resolve, reject) => {
      if (window.GGBApplet) { resolve(window.GGBApplet); return; }
      var done = function () {
        if (window.GGBApplet) resolve(window.GGBApplet);
        else reject(new Error('GGBApplet not found after load'));
      };
      // 按资源模式排序：offline 先本地 geogebra/deployggb.js、online 先 CDN
      // 决定：GeoGebra 一律走官方 CDN（在线 geogebra.org）。
      var urls = [
        'https://www.geogebra.org/apps/deployggb.js',
        'https://cdn.geogebra.org/resources/deployggb.js',
        'https://cdnjs.cloudflare.com/ajax/libs/geogebra/5.0.552.0/deployggb.js'
      ];
      var i = 0;
      (function next() {
        if (i >= urls.length) { reject(new Error('deployggb.js load failed (local geogebra/ not found and all CDN sources unreachable)')); return; }
        var s = document.createElement('script');
        s.src = urls[i++];
        s.onload = done;
        s.onerror = function () { s.remove(); next(); };
        document.head.appendChild(s);
      })();
    });
    return _ggbAppletLoader;
  }

  /** Mount GeoGebra applets for local .ggb files (data-ggb-b64) and blank apps
      (data-ggb-app) inside a root element. Both render through the GGBApplet
      JavaScript API instead of iframe URLs to geogebra.org, so they work with the
      bundled offline engine (geogebra/5.0/web3d/) and give visible error feedback
      instead of a silent blank box. */
  function renderGgbLocal(root) {
    if (!root) return;
    const els = $$('.slide-element[data-type="embed"][data-ggb-file="1"], .slide-element[data-type="embed"][data-ggb-app]', root);
    if (!els.length) return;
    loadGgbAppletAPI().then((GGBApplet) => {
      els.forEach((el) => {
        if (el._ggbInjected) return; // already rendered
        const host = el.querySelector('.ggb-host');
        if (!host) return;
        const isFile = el.dataset.ggbFile === '1';
        // 本地 .ggb 也可带 app 类型（如从套件插入的 classic），使视图与设计时一致。
        const appKey = (isFile ? (el.dataset.ggbApp || '') : (el.dataset.ggbApp || ''));
        if (isFile && !el.dataset.ggbB64) return;
        if (!isFile && !appKey) return;
        // fresh unique id per inject: GeoGebra registers the applet as
        // window[id]; never reuse an id so a re-created applet cannot collide
        // with a stale one from an earlier inject (editor/present/re-render).
        const ggbId = 'ggb_' + uid();
        const opt = (v, dflt) => v === undefined ? dflt : (v === '1');
        let failTimer = null;
        let loaded = false;
        const attemptInject = (tries) => {
          // GeoGebra computes its render size from the container at render time;
          // a hidden / not-yet-laid-out host (offsetWidth 0) renders blank.
          // Wait for the host to be visible & sized BEFORE injecting. Require
          // BOTH dimensions to be positive & non-trivial: a host with a width
          // but a 0/incorrect height would inject with a wrong aspect and make
          // the applet overflow or render tiny. getBoundingClientRect() is the
          // authoritative "is it laid out and on-screen" measure.
          const r = host.getBoundingClientRect();
          const ready = r.width > 8 && r.height > 8 && r.right > 0 && r.bottom > 0;
          if (!ready && tries < 40) {
            setTimeout(() => attemptInject(tries + 1), 120);
            return;
          }
          try {
            // mark the host as the scale container so the applet fills it exactly
            // (allowUpscale lets it follow element resize, not just shrink)
            if (!host.classList.contains('ggb-scale-container')) host.classList.add('ggb-scale-container');
            const params = {
              id: ggbId,
              scaleContainerClass: 'ggb-scale-container',
              // 绝不放大超出宿主：applet 始终以「元素内联预设尺寸」初始化，
              // 之后只缩小/等大地适配宿主，避免新插入时宿主还在 stage 布局
              // 过渡放大阶段、applet 被一起放大而溢出预设区域。
              allowUpscale: false,
              // 「重置视图」按钮（右上角循环箭头，showResetIcon）可选项：
              // 由 data-ggb-reseticon 控制，默认开；取消勾选则不显示。
              showResetIcon: opt(el.dataset.ggbReseticon, true),
              showToolBar: opt(el.dataset.ggbToolbar, true),
              enableShiftDragZoom: opt(el.dataset.ggbZoom, true),
              showMenuBar: opt(el.dataset.ggbMenubar, false),
              showAlgebraInput: opt(el.dataset.ggbAlgebra, false),
              borderColor: '#ddd',
            // Deterministic size: the authored inline size of the element
            // (the .ggb-host fills it exactly). Measuring the host at inject
            // time is timing-sensitive — on first page load the Reveal deck is
            // still settling, so the FIRST applet could be created with a wrong
            // (taller) aspect while later applets (mounted after navigation)
            // were measured correctly. Inline style size == final container size.
            width: parseFloat(el.style.width) || 576,
            height: parseFloat(el.style.height) || 432,
            };
            if (isFile) {
              params.data = el.dataset.ggbB64;        // newer deploy API param
              params.ggbBase64 = el.dataset.ggbB64;   // GeoGebra 5.0 loader param
            } else {
              params.appName = appKey;                // blank calculator app
            }
            // 本地 .ggb 若带了 app 类型（如从套件插入的 classic），则同时用该
            // app 渲染，保证插入的 applet 视图与设计时（套件/classic）一致。
            if (isFile && appKey) params.appName = appKey;
            // feedback: if the engine has not reported ready in time, surface a hint
            failTimer = setTimeout(() => {
              if (!loaded) showGgbEngineHint(el, host);
            }, 25000);
            params.appletOnLoad = function () {
              loaded = true;
              clearTimeout(failTimer);
              clearGgbHint(el);
            };
            var applet = new GGBApplet(params, true); // true = show in div
            el._ggbApplet = applet;                   // keep for later resize()
            // keep the applet auto-fitted to its container (GGB re-scales via
            // its container observer whenever the host settles/resizes, so the
            // first applet cannot stay stuck at a stale measured aspect)
            // 注意：套件插入的 classic applet（data-ggb-suite）不启用 scale-container，
            // 否则会在编辑/演示不同宿主尺寸下 auto-fit，改写坐标视图导致图形偏移。
            const fixedView = !!(el.dataset.ggbSuite || el.dataset.ggbApp);
            if (typeof applet.setScaleContainer === 'function') applet.setScaleContainer(!fixedView);
            const finalizeApplet = (offlineOk) => {
              try {
                // 决定：GeoGebra 一律走官方 CDN（在线 geogebra.org 引擎）
                applet.setHTML5Codebase('https://www.geogebra.org/apps/5.0/web3d/', true);
                // clear any stale injected markup (e.g. from previously saved slides)
                host.innerHTML = '';
                applet.inject(host);
                el._ggbInjected = true;
                // GeoGebra's own scaleContainerClass makes the applet auto-fit
                // its host (shrink-to-fit when the host is smaller, never upscale
                // because allowUpscale=false). That built-in container observer is
                // the reliable mechanism, so we deliberately do NOT add a manual
                // ResizeObserver here — an extra observer + manual resize() could
                // fight the container fit and over-enlarge the applet (which the
                // previous version hit: new applets rendered larger than the preset
                // slot). No periodic re-fit timers needed either.
                //
                // 套件插入的 applet：插入前记录了坐标视图范围，注入后恢复，
                // 使插入/演示的图形位置与套件作图器一致（而非宿主导入的默认视图）。
                const restoredView = el.dataset.ggbView;
                if (restoredView && el.dataset.ggbSuite) {
                  try {
                    const v = JSON.parse(restoredView);
                    const live = window[ggbId] || applet;
                    if (live && typeof live.setCoordSystem === 'function') {
                      live.setCoordSystem(v.xmin, v.xmax, v.ymin, v.ymax);
                    }
                  } catch (e) {}
                }
                //
                // Belt-and-suspenders safety net: if the container fit didn't kick
                // in (rare), a single delayed re-fit keeps the applet at the preset
                // element size rather than a stale enlarged one.
                setTimeout(() => {
                  if (el._ggbApplet && el._ggbApplet.resize) {
                    try { el._ggbApplet.resize(); } catch (e) {}
                  }
                }, 900);
              } catch (e) {
                clearTimeout(failTimer);
                host.innerHTML = '<div style="padding:12px;color:#c00;font-size:13px;">GeoGebra 加载失败：' + escHTML(e && e.message || e) + '</div>';
              }
            };
            // 本地优先：探测随包引擎 geogebra/5.0/web3d/，命中即用离线 codebase
            // 渲染（完全断网可用，含 base64 .ggb）；未命中才回退在线引擎。
            ggbLocalEnginePresent().then(function (offlineOk) {
              finalizeApplet(offlineOk);
            });
          } catch (e) {
            if (failTimer) clearTimeout(failTimer);
            host.innerHTML = '<div style="padding:12px;color:#c00;font-size:13px;">GeoGebra 加载失败：' + escHTML(e && e.message || e) + '</div>';
          }
        };
        attemptInject(0);
      });
    }).catch((err) => {
      // the loader (deployggb.js) itself could not load → show a visible message
      els.forEach((el) => {
        const host = el.querySelector('.ggb-host');
        if (host && !host.querySelector('.ggb-err')) {
          host.innerHTML = '<div class="ggb-err" style="padding:12px;color:#c00;font-size:13px;line-height:1.6;">GeoGebra 引擎加载失败：' + escHTML(err && err.message || err) + '<br>请检查 geogebra/ 目录是否完整，或当前网络能否访问 geogebra.org。</div>';
        }
      });
      console.warn('GeoGebra API load failed:', err.message);
    });
  }

  /** Engine timeout hint inside a .ggb-host (visible feedback instead of a blank box) */
  function showGgbEngineHint(el, host) {
    if (!host || host.querySelector('.ggb-hint')) return;
    const m = document.createElement('div');
    m.className = 'ggb-hint';
    m.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;background:#fff;color:#555;font-size:13px;text-align:center;padding:12px;z-index:4;box-sizing:border-box;';
    m.innerHTML =
      '<div style="font-weight:600;color:#c0392b;">GeoGebra 引擎加载超时</div>' +
      '<div>若处于离线环境，请确认已安装本地引擎（geogebra/5.0/web3d/）；联网环境下请稍候重试。</div>';
    host.appendChild(m);
  }
  function clearGgbHint(el) {
    const m = el && el.querySelector('.ggb-hint');
    if (m) m.remove();
  }

  /** Re-fit all live GeoGebra applets to their (possibly resized) containers */
  function resizeGgbApplets(root) {
    const scope = root || document;
    $$('.slide-element[data-type="embed"]', scope).forEach((el) => {
      if (el._ggbApplet && el._ggbApplet.resize) {
        try { el._ggbApplet.resize(); } catch (e) {}
      }
    });
  }
  window.addEventListener('resize', () => { resizeGgbApplets(); applyAllRfit(); applyAllMathFit(); });

  // Cached check for the local GeoGebra engine. Returns a Promise<boolean>.
  // Works under http(s) hosting (HEAD fetch, fast path) and under file://
  // (script-tag probe, which file:// browsers still allow). The probe pre-loads
  // the small web3d.nocache.js bootstrap; deployggb.js reuses it, so this is
  // harmless and also warms the engine for the first applet.
  let _ggbEngineCheck = null;
  function ggbLocalEnginePresent() {
    if (_ggbEngineCheck) return _ggbEngineCheck;
    _ggbEngineCheck = new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      // fast path for http(s) hosting
      try {
        fetch('geogebra/5.0/web3d/web3d.nocache.js', { method: 'HEAD' })
          .then((r) => { if (r.ok) finish(true); })
          .catch(() => {});
      } catch (e) {}
      // authoritative probe: script tags load from file:// too
      try {
        const s = document.createElement('script');
        s.src = 'geogebra/5.0/web3d/web3d.nocache.js';
        s.onload = () => finish(true);
        s.onerror = () => finish(false);
        document.head.appendChild(s);
      } catch (e) {
        finish(false);
      }
    });
    return _ggbEngineCheck;
  }

  /* Watch GeoGebra URL-mode iframes. In some networks geogebra.org's material
     service (tube.geogebra.org) is unreachable, so the embedded material never
     loads. Detect that and show an actionable message instead of a blank box. */
  function watchGgbEmbeds(root) {
    if (!root) return;
    const els = $$('.slide-element[data-type="embed"][data-embed-method="url"]', root);
    els.forEach((el) => {
      if (el._ggbWatched) return;
      const src = el.dataset.embedSrc || '';
      if (src.indexOf('geogebra.org') === -1) return;
      el._ggbWatched = true;
      const iframe = el.querySelector('iframe.el-embed');
      let loaded = false;
      if (iframe) {
        iframe.addEventListener('load', () => { loaded = true; clearGgbFail(el); });
        iframe.addEventListener('error', () => { showGgbFail(el); });
      }
      // Hard guard: if nothing usable after 15s, assume the network blocked it.
      setTimeout(() => { if (!loaded) showGgbFail(el); }, 15000);
    });
  }
  function showGgbFail(el) {
    if (!el || el.querySelector(':scope > .ggb-fail')) return;
    const msg = document.createElement('div');
    msg.className = 'ggb-fail';
    msg.innerHTML =
      '<div class="ggb-fail-title">⚠ GeoGebra 素材无法加载</div>' +
      '<div class="ggb-fail-body">该素材需要访问 geogebra.org 的素材服务，当前网络可能无法连接（国内常被限制）。</div>' +
      '<div class="ggb-fail-tip">改用方案：①「空白计算器」直接演示；② 在可访问 GeoGebra 的环境把素材另存为 .ggb，再用「本地 .ggb」插入（可离线运行）。</div>';
    el.appendChild(msg);
  }
  function clearGgbFail(el) {
    const m = el && el.querySelector(':scope > .ggb-fail');
    if (m) m.remove();
  }

  /* ===== Input sync (contenteditable -> store) ===== */
  function bindInputSync() {
    const container = $('#slides-container');
    container.addEventListener('input', (e) => {
      if (suppressInputSync) return;
      const section = e.target.closest('section');
      if (!section) return;
      const id = section.dataset.id;
      // resolve the slide (may be a chapter self or a nested child)
      const slide = Nav.flatList().map(e => e.slide).find(s => s.id === id) || null;
      if (slide) {
        // clean editor-only artifacts before saving
        const clone = section.cloneNode(true);
        $$('.el-handle', clone).forEach(h => h.remove());
        $$('.el-endpoint', clone).forEach(h => h.remove());
        $$('.el-embed-overlay', clone).forEach(el => el.remove());
      $$('.ggb-chip, .video-chip', clone).forEach(el => el.remove());
      $$('.ggb-fail', clone).forEach(el => el.remove());
      $$('.ggb-hint', clone).forEach(el => el.remove());
        // reset live Desmos calculator host to empty (keep the saved state in dataset)
        $$('.desmos-host', clone).forEach(g => { g.innerHTML = ''; });
      $$('.ggb-host', clone).forEach(g => { g.innerHTML = ''; });
        $$('.slide-element.selected', clone).forEach(el => el.classList.remove('selected'));
        stripAAIds(clone);
        const cleaned = clone.innerHTML;
        slide.content = cleaned;
        Store.persist();
        // update thumbnail
        const thumb = $('.slide-thumb[data-id="' + id + '"]');
        if (thumb) {
          const tc = thumb.querySelector('.slide-thumb-content');
          if (tc) tc.innerHTML = cleaned;
        }
      }
    });

    // save selection on editable focus/selection change
    document.addEventListener('selectionchange', () => {
      const sel = window.getSelection();
      if (sel.rangeCount > 0 && isInEditable(sel.anchorNode)) {
        Toolbar.saveSelection();
      }
    });
  }

  /* ===== Keyboard shortcuts ===== */
  function bindShortcuts() {
    document.addEventListener('keydown', (e) => {
      // don't interfere with present mode (Reveal handles it)
      if (!$('#present-overlay').classList.contains('hidden')) {
        if (e.key === 'Escape') exitPresent();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key === 's') {
        e.preventDefault();
        saveProject();
      } else if (mod && e.key === 'o') {
        e.preventDefault();
        openFile();
      } else if (mod && e.key === 'e') {
        e.preventDefault();
        Exporter.exportHTML();
      } else if (mod && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        History.undo();
      } else if (mod && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault();
        History.redo();
      } else if (mod && e.shiftKey && e.key === 'N') {
        e.preventDefault();
        syncCurrentSlide();
        if (Nav.isChapter(project.slides[currentIndex])) {
          // inside a chapter: add a sub-page and jump to it
          Store.addSubSlide(currentIndex, 'content');
          currentV = Nav.children(project.slides[currentIndex]).length;
          History.push();
          Preview.render();
          editorDeck.slide(currentIndex, currentV);
        } else {
          Store.addSlide('content');
          currentIndex++;
          currentV = 0;
          History.push();
          Preview.render();
        }
      } else if (mod && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        var curFi = Nav.fromHv(currentIndex, currentV);
        var dup = Store.duplicateFlat(curFi);
        if (dup) {
          var nh = Nav.toHv(curFi + 1);
          currentIndex = nh.h; currentV = nh.v;
          History.push();
          Preview.render();
        }
      } else if (mod && !e.shiftKey && e.key === 'd' && Elements.selection.length) {
        e.preventDefault();
        Elements.duplicate();
      } else if (mod && e.key === 'a') {
        // Ctrl+A → select all elements (unless editing text)
        const sel = window.getSelection();
        const editing = sel.anchorNode && isInEditable(sel.anchorNode);
        if (!editing) {
          e.preventDefault();
          Elements.selectAll();
        }
      } else if (mod && e.shiftKey && (e.key === 'G')) {
        e.preventDefault();
        Group.ungroup();
      } else if (mod && !e.shiftKey && e.key === 'g') {
        e.preventDefault();
        Group.group();
      } else if (mod && (e.key === 'c' || e.key === 'x' || e.key === 'v')) {
        // copy / cut / paste element — but let the browser handle it while editing text
        const sel = window.getSelection();
        const editing = sel.anchorNode && isInEditable(sel.anchorNode);
        if (!editing) {
          e.preventDefault();
          if (e.key === 'c') {
            if (Elements.selection.length) Elements.copy();
          } else if (e.key === 'x') {
            if (Elements.selection.length) Elements.cut();
          } else if (e.key === 'v') {
            Elements.paste(Elements.lastMouse.x, Elements.lastMouse.y);
          }
        }
      } else if (e.key === 'F5') {
        e.preventDefault();
        enterPresent();
      } else if (!mod && e.key === 'Escape') {
        // exit the editor overview grid first (Reveal's keyboard is disabled here)
        if (editorDeck && editorDeck.isOverview()) {
          editorDeck.toggleOverview(false);
          return;
        }
        // close any open modal first (keyboard accessibility fallback)
        const openModal = $('.modal:not(.hidden)');
        if (openModal) {
          openModal.classList.add('hidden');
          if (Elements._editingEmbed) Elements._editingEmbed = null;
          return;
        }
        // close any open context menu first
        SlideContextMenu.hide();
        ElementContextMenu.hide();
        CanvasContextMenu.hide();
        // exit group-edit mode / deselect element first, then blur active
        if (Elements.selection.length || Elements._editingGroup) {
          Elements.deselect();
        } else {
          const active = document.activeElement;
          if (active && active.blur) active.blur();
        }
      } else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
        // delete selected element (but not when editing text)
        if (Elements.selection.length) {
          const sel = window.getSelection();
          const editing = sel.anchorNode && isInEditable(sel.anchorNode);
          if (!editing) {
            e.preventDefault();
            Elements.delete();
          }
        }
      }
      // nudge with Shift+arrows, slide navigation with plain arrows (not while editing text)
      if (!mod) {
        const sel = window.getSelection();
        const editing = sel.anchorNode && isInEditable(sel.anchorNode);
        if (!editing) {
          if (e.shiftKey && Elements.selection.length &&
              (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            const step = 1;
            if (e.key === 'ArrowLeft') Elements.nudge(-step, 0);
            else if (e.key === 'ArrowRight') Elements.nudge(step, 0);
            else if (e.key === 'ArrowUp') Elements.nudge(0, -step);
            else if (e.key === 'ArrowDown') Elements.nudge(0, step);
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            Preview.prev();
          } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
            e.preventDefault();
            Preview.next();
          }
        }
      }
    });
  }

  /* ===== Version control (版本历史 / 快照) ===== */
  const VersionControl = {
    KEY: 'revealslidr:versions',
    MAX: 10,

    _read() {
      try {
        const arr = JSON.parse(localStorage.getItem(this.KEY) || '[]');
        return Array.isArray(arr) ? arr : [];
      } catch (e) { return []; }
    },
    _write(arr) {
      try { localStorage.setItem(this.KEY, JSON.stringify(arr)); return true; }
      catch (e) { toast('版本存储空间不足，未保存', 'error'); return false; }
    },

    list() {
      return this._read().slice().sort((a, b) => (b.time || 0) - (a.time || 0));
    },

    /** Snapshot the current project into the version history. */
    save(name) {
      if (!project || !project.slides || !project.slides.length) return null;
      const arr = this._read();
      const snap = {
        id: 'v_' + uid(),
        time: Date.now(),
        name: name || this.autoName(),
        title: project.meta.title || '未命名演示',
        slideCount: project.slides.length,
        project: JSON.parse(JSON.stringify(project)),
      };
      arr.push(snap);
      if (arr.length > this.MAX) arr.splice(0, arr.length - this.MAX);
      return this._write(arr) ? snap : null;
    },

    autoName() {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    },

    restore(id) {
      const snap = this._read().find(v => v.id === id);
      if (!snap || !snap.project || !snap.project.slides) return false;
      // keep a safety snapshot of the current state before restoring
      this.save('恢复前 · ' + this.autoName());
      project = JSON.parse(JSON.stringify(snap.project));
      currentIndex = Math.max(0, Math.min(currentIndex, project.slides.length - 1));
      Store.persist();
      PropsPanel.refreshAll();
      Preview.render();
      applyTheme(project.meta.theme || DEFAULT_THEME);
      applyFont(project.meta.font || '');
      History.stack = [];
      History.pointer = -1;
      History.push();
      toast('已恢复版本：「' + (snap.name || '未命名') + '」', 'success');
      return true;
    },

    remove(id) {
      this._write(this._read().filter(v => v.id !== id));
    },

    open() {
      const modal = $('#versions-modal');
      if (modal) modal.classList.remove('hidden');
      this.render();
    },
    close() {
      const modal = $('#versions-modal');
      if (modal) modal.classList.add('hidden');
    },

    render() {
      const list = $('#versions-list');
      if (!list) return;
      const vers = this.list();
      if (!vers.length) {
        list.innerHTML = '<p class="insp-hint">暂无版本。点击上方「保存当前版本」创建第一个快照。</p>';
        return;
      }
      list.innerHTML = vers.map(v => {
        const d = new Date(v.time || 0);
        const p = (n) => String(n).padStart(2, '0');
        const dateStr = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
          ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
        return '<div class="version-item">' +
          '<div class="version-info">' +
          '<span class="version-name">' + escHTML(v.name || '未命名') + '</span>' +
          '<span class="version-meta">' + dateStr + ' · ' + (v.slideCount || 0) + ' 页 · ' + escHTML(v.title || '') + '</span>' +
          '</div>' +
          '<div class="version-actions">' +
          '<button class="btn btn-xs" data-vrestore="' + v.id + '">恢复</button>' +
          '<button class="btn btn-xs btn-danger" data-vdelete="' + v.id + '">删除</button>' +
          '</div></div>';
      }).join('');
    },
  };

  /* ===== Editor init ===== */
  async function init() {
    // load project
    project = Store.load();
    if (!project.slides || project.slides.length === 0) {
      project = Store.newProject();
    }

    // apply theme
    applyTheme(project.meta.theme);

    // 行内公式垂直微调（跟随项目保存）
    applyMathShift(project.meta.mathShift);
    bindMathShiftControl();

    // apply branding (专属 Logo 与版权标识) to the header & status bar
    Branding.apply();

    // build the text-color swatch palette
    initColorSwatches();
    // build the shape fill/stroke swatch palettes
    initShapeColorSwatches();

    // init props panel
    PropsPanel.init();

    // init toolbar
    Toolbar.bind();

    // init canvas zoom / pan (Ctrl+wheel zoom, drag pan, zoom bar)
    StageZoom.bind();

    // suppress the native browser context menu inside the editor surface
    // (our custom element/slide menus handle right-click instead)
    const appRoot = $('#app');
    if (appRoot) {
      appRoot.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // bind input sync
    bindInputSync();

    // bind shortcuts
    bindShortcuts();

    // init elements module
    Elements.init();

    // init format bar
    FormatBar.init();

    // exit present is handled via the bottom control bar's 「✕ 退出」 button

    // init preview
    await Preview.init();

    // apply size
    applySize(project.meta.size || 'default');

    // presentation-window / safe-area guide toggle + resize handling
    const stageToggle = $('#stage-frame-toggle');
    if (stageToggle) stageToggle.addEventListener('click', () => toggleStageFrame());
    window.addEventListener('resize', updateStageFrame);
    updateStageFrame();

    // initialize history with initial state
    History.push();

    // headless smoke-test hook (inert in normal use): expose the Reveal deck
    window.__lastDeck = editorDeck;

    console.log('RevealSlidr ready');
  }

  // ---- resilient startup: wait for Reveal (loaded via the multi-CDN chain in index.html) ----
  function showRevealLoadError() {
    const area = document.getElementById('canvas-area');
    if (area) {
      area.innerHTML =
        '<div style="position:absolute;inset:0;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;text-align:center;color:#ffb4ad;' +
        'font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;gap:10px;">' +
        '<div style="font-size:34px">⚠️</div>' +
        '<div style="font-size:16px;font-weight:600;color:#fff">无法加载 Reveal.js 演示引擎</div>' +
        '<div style="font-size:13px;max-width:440px;line-height:1.6;color:rgba(255,255,255,.6)">' +
        '编辑器依赖 cdn.jsdelivr.net 等 CDN。若处于离线或 CDN 被网络策略拦截，请检查网络连接后刷新；' +
        '或将 Reveal.js 资源本地化（vendoring）以实现完全离线运行。</div>' +
        '</div>';
    }
  }

  function boot() {
    // 只在"所有 Reveal 插件加载完成"（window.__revealReady）后才初始化。
    // 之前 `|| window.Reveal` 会在核心库就绪但插件（markdown/highlight/notes）
    // 尚未加载完时提前 init，导致 new Reveal 时 RevealMarkdown 未定义而报错，
    // 表现为"编辑区空白"（偶发、重开正常）。改为主窗口就绪再启动。
    if (window.__revealReady) { init(); return; }
    let started = false;
    const start = () => { if (started) return; started = true; init(); };
    const fail = () => { if (started) return; started = true; showRevealLoadError(); };
    window.addEventListener('revealslidr:reveal-ready', start, { once: true });
    window.addEventListener('revealslidr:reveal-failed', fail, { once: true });
    // Last-resort: if the ready event was somehow missed but plugins are all loaded, start anyway.
    setTimeout(() => { if (window.__revealReady && !started) start(); }, 15000);
  }

  // start when DOM + Reveal are ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // ---- headless smoke-test hook (inert in normal use) ----
  window.__rsTest = { TemplateLibrary: TemplateLibrary, Layouts: Layouts, ProLayouts: ProLayouts, MathLecture: MathLecture, Themes: Themes, Elements: Elements, Toolbar: Toolbar, Table: Table, IconPicker: IconPicker, MathGraph: MathGraph, SmartArt: SmartArt, ComboMath: ComboMath, normalizeGgbEmbeds: normalizeGgbEmbeds, deAIFyPro: deAIFyPro, GgbSuite: GgbSuite, PresentControls: PresentControls, StageZoom: StageZoom, renderMath: renderMath, restoreMathSource: restoreMathSource, DTK: DTK, get project() { return project; } };
})();
