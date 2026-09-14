# PPT(.pptx) → 课件 JSON · 可行性分析（实测样张）

> 样张：`2.2基本不等式(第一课时).pptx`（1.0 MB，18 页）
> 实测方式：解包后逐页统计 XML 结构（不是推测 ✓）。分析时间：2026-09-15

## 一、样张真实结构

| 项 | 数量 | 备注 |
|---|---|---|
| 页面 | **18 页** | |
| 页面尺寸 | `cx=12192000 cy=6858000` | = **1280×720 px** —— 与咱们画布**完全一致** ✓ 不用缩放 ✓ |
| 文本框 `p:sp` | 187 | |
| 图片 `p:pic` | 80 | 其中 **png 29** ✓、wmf 61 ✗、emf 6 ✗ |
| 表格 `a:tbl` | 2 | |
| 组合 `p:grpSp` | 2 | 很少 ✓ |
| 文本段 `a:t` | 559 | |
| **OMML 公式 `m:oMath`** | **258** | **是原生公式** ✓✓ 可转 LaTeX |
| OLE 对象 `p:oleObj` | 74 | 公式的封装壳 |
| `ppt/embeddings` | 74 | 与 OLE 对应 |

## 二、最关键的一条结论

**那 61 个 WMF / 6 个 EMF 不是内容，只是 OLE 对象的预览图** ✓。

样张第 4 页同时存在：

```
<a14:m><m:oMathPara><m:oMath><m:sSup>…   ← 原生 OMML（可解析 ✓）
<p:oleObj …>                              ← 公式的 OLE 封装
../media/image6.wmf                       ← 上面那个 OLE 的可视化预览（可丢 ✗）
```

所以路线是：**取 OMML 转 LaTeX ✓，跳过 WMF/EMF 预览** ✓ —— 而不是去想办法渲染 WMF（浏览器做不到 ✗）。

## 三、实施计划（复用现有设施，零新依赖）

```
docx/zip.ts            已有：zip 读取（原生 DecompressionStream）→ .pptx 同一套 ✓
pdf/pdfImport.ts       已有：pdfToDeck 先例（"文档 → 课件 JSON"）✓
新增 src/pptx/
  pptxToDeck.ts        主流程：解包 → 逐页 → 形状 → 元素
  ommlToLatex.ts       OMML → LaTeX（子集：m:f 分数 / m:sSup 上标 / m:sSub 下标
                       / m:rad 根号 / m:d 括号 / m:nary 求和积分 / m:func 函数 …）
  emu.ts               EMU → px（/914400*96）
```

**映射**：

| pptx | → 课件 JSON |
|---|---|
| `p:sp` + `a:p`/`a:t`（含 `a:rPr` 字号/粗斜/颜色） | `text` 元素 ✓ |
| `a14:m` / `m:oMath` | `text`/混排元素，公式写成 `$…$` ✓ |
| `p:pic` + `ppt/media/*.png` | `image` 元素（data URL 内嵌 ✓） |
| `a:tbl`（含 `gridSpan`/`rowSpan`） | `table` 元素（**正好接上刚做的合并单元格** ✓） |
| `p:graphicFrame` / `p:oleObj` / wmf / emf | **跳过** ✗ |
| 幻灯片页 | 一页一张 ✓ |

**入口**：工具栏「文件 ▾ → 导入 PPT(.pptx)」，与现有"导入 Word/PDF"并列 ✓。

## 四、已知风险 / v1 不做的

- **OMML 是子集** ✗：复杂结构（矩阵 `m:m`、多行对齐 `m:eqArr`、某些重音）先原样降级成文字 ✓；
- **主题色** ✗：`schemeClr` 要查主题/母版，v1 用近似色或黑 ✓；
- **占位符继承** ✗：文字位置可能在 layout 里（本样张每页都有显式 `a:off`，影响小 ✓）；
- **动画 / 切换** ✗ 不转（模型不同 ✓）。

## 五、下一步

1. 先把 `ommlToLatex.ts` 单独写出来并用**样张里的 258 个公式**跑一遍（能转出多少、哪些降级）✓
2. 再接主流程 `pptxToDeck.ts`（文本框 → 图片 → 表格）✓
3. 用样张 18 页端到端验证：转出的 JSON 能打开、每页元素数与 pptx 对得上 ✓
