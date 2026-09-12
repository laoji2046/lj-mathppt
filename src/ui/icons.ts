/**
 * 主界面图标的唯一来源（工具栏 / 页列表 / 属性面板 / 各弹层都用这里）。
 *
 * 规范（照这个画，别混 emoji 和文字符号 —— 那些在不同系统里字形大小与基线都不一样，
 * 之前 `⧉ ↑ ↓ × ✕ ＋` 就是这么来的，工具栏的 SVG 和它们放在一起明显不齐）：
 * - 24×24 画布，四周留 3~4 的白边
 * - 只用描边：fill: none、stroke: currentColor、stroke-width: 1.9、圆头圆角
 * - 一条路径能画完就别拆成多条；需要多个形状时按绘制顺序排
 */
export const ICONS: Record<string, string> = {
  // ── 工具栏既有 ──────────────────────────────────────────────────────────
  file: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  templates: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  /** 公式：根号（原本和「数学符号」是同一个 Σ，两个菜单里图标完全一样） */
  formula: '<path d="M4 13.5h3.2L9.6 19 14 4h6"/>',
  draw: '<path d="M3 21l1.5-4.5L17 4l3 3L7.5 19.5 3 21zM15 6l3 3"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  theme: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><circle cx="17" cy="17" r="4"/>',
  version: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
  ggb: '<path d="M4 20h16M20 4v16"/><circle cx="8" cy="15" r="1"/><circle cx="15" cy="8" r="1"/>',
  desmos: '<path d="M4 16c2-7 5-11 8-11s6 4 8 11"/>',
  new: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 14v6M9 17h6"/>',
  save: '<path d="M12 3v10M7 9l5 4 5-4M5 19h14"/>',
  html: '<path d="M4 5h16v13H4zM8 9l-2 2 2 2M16 9l2 2-2 2"/>',
  pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13.5h1.5a1.25 1.25 0 0 1 0 2.5H9zM9 16v2"/>',
  png: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="M21 16l-5-5L5 19"/>',
  paste: '<path d="M8 3h8l1 3H7zM5 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2"/><path d="M8 11h8M8 15h8"/>',
  blankMath: '<path d="M8 4v16M16 4v16M8 12l8-4M8 12l8 4"/>',
  library: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/>',
  symbol: '<path d="M18 6H7l5 6-5 6h11"/>',
  /** 数学图形：坐标轴 + 一条曲线（原来和 shape 是同一个空方块） */
  fig: '<path d="M4 3v17h17"/><path d="M6.5 17c2.2-6.5 4.5-9.5 7.5-9.5 1.8 0 3.2 1.2 4 3.4"/>',
  icon: '<path d="M12 3l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9 6.7 19.2l1-5.8L3.5 9.3l5.9-.9z"/>',
  img: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/>',
  /** 绘制/形状：方形 + 圆形叠放（原来是个空方块，完全看不出是什么） */
  shape: '<rect x="3" y="3" width="12" height="12" rx="1.5"/><circle cx="15.5" cy="15.5" r="5.5"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
  line: '<path d="M4 20L20 4"/>',
  arrow: '<path d="M4 20L18 6M13 5h6v6"/>',
  capture: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 8h8v8H8z"/><circle cx="12" cy="12" r="1.4"/>',
  pen: '<path d="M3 21l1.5-4.5L17 4l3 3L7.5 19.5 3 21zM15 6l3 3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  embed: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 11l-2 2 2 2M16 11l2 2-2 2M13 9l-2 6"/>',
  undo: '<path d="M4 7v5h5M4 12a8 8 0 1 0 2-5.3L4 9"/>',
  redo: '<path d="M20 7v5h-5M20 12a8 8 0 1 1-2-5.3l2 2.3"/>',
  fragment: '<path d="M8 5v14l10-7z"/>',
  paper: '<path d="M6 2h8l4 4v16H6zM14 2v5h4M9 13h6M9 17h6"/>',
  play: '<path d="M8 5l12 7-12 7z"/>',

  // ── 本轮补齐：主界面里原本用字符 / emoji 顶替的位置，统一换成同一套 ──────
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="M5 13l4 4L19 7"/>',
  /** 复制（两张错开的纸） */
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M10 11v6M14 11v6"/>',
  /** Markdown 源码（尖括号 + 斜杠） */
  md: '<path d="M8 9l-3 3 3 3M16 9l3 3-3 3M13.5 7l-3 10"/>',
  /** 旋转 90° / 重置（图片编辑、计时重置） */
  rotate: '<path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4h-4"/>',
  /** 暂停（演讲者视图计时） */
  pause: '<path d="M9 5v14M15 5v14"/>',
  /** 载入示例 / 导入 */
  load: '<path d="M12 3v10M8 9l4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',

  // ── 画布浮动工具条（EditToolbar）——原来自带一份，现合并到这里 ──────────────
  group: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><path d="M14 10.5h4.5V6"/>',
  ungroup: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><path d="M14 10.5h4.5V6"/><path d="M4 20L20 4"/>',
  alignLeft: '<path d="M3 3v18"/><rect x="6" y="6" width="12" height="4" rx="1"/><rect x="6" y="14" width="8" height="4" rx="1"/>',
  alignHCenter: '<path d="M12 2v20"/><rect x="4" y="6" width="16" height="4" rx="1"/><rect x="7" y="14" width="10" height="4" rx="1"/>',
  alignRight: '<path d="M21 3v18"/><rect x="6" y="6" width="12" height="4" rx="1"/><rect x="10" y="14" width="8" height="4" rx="1"/>',
  alignTop: '<path d="M3 3h18"/><rect x="6" y="6" width="4" height="12" rx="1"/><rect x="14" y="6" width="4" height="8" rx="1"/>',
  alignVCenter: '<path d="M2 12h20"/><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="7" width="4" height="10" rx="1"/>',
  alignBottom: '<path d="M3 21h18"/><rect x="6" y="6" width="4" height="12" rx="1"/><rect x="14" y="10" width="4" height="8" rx="1"/>',
  distH: '<path d="M2 4v16M22 4v16"/><rect x="7" y="7" width="4" height="10" rx="1"/><rect x="15" y="7" width="4" height="10" rx="1"/>',
  distV: '<path d="M4 2h16M4 22h16"/><rect x="7" y="7" width="10" height="4" rx="1"/><rect x="7" y="15" width="10" height="4" rx="1"/>',
  toFront: '<rect x="3" y="3" width="12" height="12" rx="2"/><path d="M9 21h10a2 2 0 0 0 2-2V9"/>',
  toBack: '<path d="M3 9v10a2 2 0 0 0 2 2h10"/><rect x="9" y="3" width="12" height="12" rx="2"/>',
  forward: '<path d="M12 4v9M8 8l4-4 4 4"/><rect x="3" y="15" width="18" height="5" rx="1.5"/>',
  backward: '<path d="M12 20v-9M8 16l4 4 4-4"/><rect x="3" y="4" width="18" height="5" rx="1.5"/>',
};
