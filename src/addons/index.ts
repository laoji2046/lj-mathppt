/**
 * 内置 addon 清单 —— 只登记，不改变任何行为。
 * 体积数据来自 docs/体积账本.md 的实测（构建产物 + dist 统计），不是估算。
 */
import { registerAddon } from './registry'

export function registerBuiltinAddons() {
  // ── 导入导出 ──────────────────────────────────────────────
  registerAddon({ id: 'pdf-gen', name: '试卷编辑', desc: 'A4 文档编辑器：正文写公式与插图，再交给打印对话框另存 PDF（矢量文字）', icon: 'paper', category: '导入导出', sizeHint: 39 })
  registerAddon({ id: 'pptx-import', name: 'PPT 导入', desc: '解析 .pptx：文字/公式(OMML→LaTeX)/图片/表格/矢量图形一并搬入，可再按内容套用模板', icon: 'file', category: '导入导出', sizeHint: 16 })
  registerAddon({ id: 'docx-import', name: 'Word 导入', desc: '解析 .docx：一题一页、图片内嵌；MathType 公式会明确报数', icon: 'file', category: '导入导出', sizeHint: 11 })
  // 【v1676】用户要求「去除 文件 → 导入 PDF」→ 这里 **defaultOn: false** 默认关闭 ✓
  //   （关掉后入口隐藏、代码永不加载 ✓；设置里的「插件」里随时能再打开 ✓ 可逆）
  registerAddon({ defaultOn: false, id: 'pdf-import', name: 'PDF 导入', desc: '自动判断有无文本层：有就抽成可编辑文字，没有就每页一张图', icon: 'file', category: '导入导出', sizeHint: 12, runtime: { key: 'pdfjs', mb: 1.3, note: 'pdfjs 解析引擎（仅导入时用）' } })
  // ── 编辑器 ────────────────────────────────────────────────
  registerAddon({ id: 'vectorize', name: '矢量描摹', desc: '把位图转成 SVG（彩色分层或灰度海报化），本地 potrace 流水线', icon: 'image', category: '编辑器', sizeHint: 36 })
  registerAddon({ id: 'geom3d', name: '三维立体图', desc: '可拖顶点的三维几何体编辑，支持显示/隐藏顶点圆点', icon: 'chart', category: '编辑器', sizeHint: 72 })
  registerAddon({ id: 'image-editor', name: '图片编辑器', desc: '裁剪/形状蒙版/阴影/倒影/3D/调色，非破坏性', icon: 'image', category: '编辑器', sizeHint: 7 })
  // ── 参数化 ────────────────────────────────────────────────
  registerAddon({ id: 'house-style', name: '统一风格', desc: '把课件样式对齐到设计主题（轻度：字号/字体/背景；彻底：按 60-30-10 重映射配色）', icon: 'theme', category: '参数化' })
  registerAddon({ id: 'auto-template', name: '按内容套用模板', desc: '识别页面角色（例题/定理/定义/练习/小结/探究）并套用对应版式；识别不出或装不下的页保留原样', icon: 'theme', category: '参数化' })
  // ── 运行时（体积大头在这里，将来外置的首选）─────────────────
  registerAddon({ id: 'geogebra', name: 'GeoGebra', desc: '内嵌 GeoGebra 5.0 几何画板（web3d 版）', icon: 'shapes', category: '运行时', runtime: { key: 'geogebra-web3d', mb: 42.2, note: 'web3d 引擎（已移走无人引用的 web/webSimple 共 55 MB）' } })
  registerAddon({ id: 'desmos', name: 'Desmos', desc: '内嵌 Desmos 图形计算器', icon: 'shapes', category: '运行时', runtime: { key: 'desmos', mb: 3.9, note: 'Desmos 运行时' } })
}