/**
 * 线稿自动矢量化：位图 → 顶点 + 边表 + 虚实线。
 *
 * 「复刻图形」里那 8 套是手工量的；这个模块把「量」这一步自动化：
 * 试卷 / 讲义里的立体几何插图都是干净的黑白线稿，直接把它拆成
 * 「归一化顶点 + 边拓扑 + 哪条线是虚线」，出来就是普通的数学图形元素，可以拖点、改线型。
 *
 * 流程：二值化 → 挑孤立小块当字母（抹掉）→ **字母分离**（贴着线的字母，认出来）→ Zhang-Suen 细化 → 骨架建图 → 追路径
 *      → Douglas-Peucker 简化 → 共线短划合并成虚线 → 顶点归并 → 解消十字交叉 → 交点精修
 *
 * 实测（拿 solidFigures.ts 里人工核对过的 8 套当真值）：顶点召回 89%、平均误差 1.3%、
 * 虚实线判定 100% 对；会多出几个落在直线上的冗余顶点，由调用方（VectorizeDialog）让用户删。
 */

import { recognizeLabels, isBarLike } from './glyphOcr'
import { matchFigure } from './figMatch'
import type { FigureArc } from '@/types'

export interface VectorizeOpt {
  /** 识别范围（原图像素），不传 = 整图。用来切掉图片下方的「图 1」这类题注 */
  crop?: [number, number, number, number]
  /** 小于这个比例的连通域才可能是字母 / 短划 */
  textMax?: number
  /** 自由端点吸附到顶点的半径（px） */
  snapR?: number
  /** 虚线链端点吸附到顶点的半径（px，默认 60）。虚线链的两端本来就不精确（开头是个缝、或被字母截断），
   *  跟实线段用同一个 14px 半径的话吸不上就新建顶点 —— 一条虚线就变成"悬空长线 + 两个多余顶点"，
   *  这是「识别出来容易多出点」最主要的来源 */
  snapDash?: number
  /** 虚线链端点吸附时允许偏离链所在直线的距离（px，默认 18） */
  snapPerp?: number
  /** 顶点合并半径（px） */
  mergeR?: number
  /** 去毛刺：短于这么长的单端路径丢掉（px） */
  spur?: number
  /** 路径简化容差（px） */
  eps?: number
  /** 当成"一截短划"的最大长度（图对角线的比例），超过的算实线段 */
  pieceMax?: number
  /** 虚线端点沿自身方向往外找落点的半径（px） */
  extendR?: number
  /** 收缩"过短的边"的阈值（图对角线的比例） */
  short?: number
  /** 交点精修的最大位移（图对角线的比例） */
  refine?: number
  /**
   * 虚线短划「到理想直线的垂距」上限（px，默认 16）。
   * ⚠ 原来是写死的 7 —— 但源码注释自己写了「实测 A–E 那条线上各短块相对理想线偏了 2~12px」，
   *   7 会让偏得多的短划全被拆断，凑不满就整条边消失（用户实测：原图里 D–E、A–E 丢了）。
   *   放宽到 12 覆盖实测范围；太大则会把邻近别的直线的短划并进来，出多余的边。
   */
  dashPerp?: number
  /**
   * 虚线短划「方向对齐」的余弦门槛（默认 0.94 ≈ 20°）。
   * ⚠ 原来是写死的 0.97（≈14°）。短划只有十几像素，主轴方向估计本来就有噪声，
   *   14° 会把同一条虚线上的短划拆开 → 凑不满 2 个 → 被当字母抹掉 → 整条虚线消失。
   *   调小 = 更松（更容易并起来）；太大则会把方向不同的短划也并进来。
   */
  dashCos?: number
  /** 虚线短划「沿轴方向的间距」余量（px，默认 20）。碎片化严重时调大。 */
  dashGap?: number
  /**
   * 杂点门槛①：短划短于这么长（px，默认 4）就不算短划，直接当噪点抹掉。
   * 扫描件的噪点小墨团主轴长度只有 1~3px，而真实短划是十几像素 —— 两者差着一个数量级。
   */
  dashMinPiece?: number
  /**
   * 杂点门槛②：一堆短划的总长度不足这么多（px，默认 16）就整堆当噪点抹掉。
   * 两个杂点被"虚线成链"连起来 = 凭空多出一条悬空线段（用户实报的"可删掉又不影响其他的线段"）。
   * 真短虚线哪怕只有两截（D–E 那种），两块加起来也远超这个值。
   * ⚠ 实测（1-原图.png 逐值扫描）：最小的**真实**短划堆总长在 21~22px（阈值提到 22 就会杀掉一堆真短划），
   *   所以 16 是留了 5px 余量后的安全上限 —— 而两个 7px 的杂点凑成的一堆只有 14px，正好被它拦住。
   */
  dashMinTotal?: number
  /**
   * 杂点门槛③：**两端都没吸附到图形顶点**的虚线边，如果短于这个长度（px，默认 80）就整条丢掉。
   * 这才是用户报的"多了一些可删掉又不影响其他的线段"：一小撮杂点自成一段，
   * 两头都是新造出来的孤立顶点 → 画面上就是一条凭空多出来的短线段（删掉它不影响任何别的边）。
   * 只要有一头吸附到了真顶点就不会被丢，所以图中真实的虚线边（实测 89~444px）一律不受影响。
   * ⚠ 实测：这个阈值从 40 一路提到 120，1-原图.png 与 3-人工修正.png 的输出**一条边都没变** ——
   *   真实虚线边全都至少有一头搭在图形顶点上。所以这是个"想拉多紧都安全"的旋钮，专门用来扔掉悬空的杂点段。
   */
  dashMinEdge?: number
  /** 自动把曲线拟合成弧时，要求弧**至少扫过**这么多度（默认 30）。太小会把角当成弧。 */
  arcMinSpan?: number
  /**
   * 「度 2 且几乎在一条直线上」的顶点判为假顶点的方向余弦门槛（默认 0.995 ≈ 5.7°）。
   * 手绘/扫描的直线在中间会有微小折角，0.995 偏严时就会留下用户说的"直线上多出来的点"（例如点 9）。
   * 调大 = 更容易把这种点并掉（0.99 ≈ 8°、0.98 ≈ 11°）。
   */
  collinearCos?: number
  /* ---------- 【v1518】几何规整（把该平行 / 直角 / 等长 / 45° 倍数的关系变成精确的 ✓） ---------- */
  /** 总开关：0 = 完全关掉几何规整（要看原始墨迹结果时用 ✓） */
  snapGeo?: number
  /** 方向吸附：边与 45° 倍数的偏差 ≤ 这个度数就吸正（度，默认 6） */
  snapDir?: number
  /** 判平行：两条边夹角 ≤ 这个度数就归为一组、取加权平均方向（度，默认 3） */
  snapPar?: number
  /** 判直角：共享顶点的两条边与 90° 差 ≤ 这个度数就摆正（度，默认 5）
   *  ⚠ 不能叫 snapPerp —— 那个名字已经被「虚线链吸附垂距」占了 ✗（实测编译报 Duplicate identifier ✓） */
  snapRt?: number
  /** 判等长：同一平行组里长度比 ≤ 1+这个值就取加权平均长度（默认 0.1 = 10%） */
  snapEq?: number
  /** 【v1519 · D2】形状判据：小块"占自身主轴斜外接框"的比例低于此值就当字母抹掉 ✓
   *  （尺度无关 ✓：短划是细长实心的 → 实测 0.53~1.54 ✓；字母紧凑 → 0.20~0.44 ✓） */
  dashFill?: number
  /* ---------- 【v1519 · C】模板匹配：认得出来就吸成标准立体图 ---------- */
  /** 1 = 开（默认）；0 = 关 */
  figMatch?: number
  /** 配准残差上限（占对角线比例，默认 0.08）—— 超过就不吸 */
  figTol?: number
  /** 迭代轮数（默认 16） */
  snapIter?: number
  /** 数据项强度：每轮把顶点往原位置拉回这么多（默认 0.25，越大越保守） */
  snapPull?: number
  /** 单个顶点最大位移（图对角线的比例，默认 0.03） */
  snapMax?: number
  /* ---------- 【v1523】字母分离：把"贴着线的字母"从图形线里切出来 ---------- */
  /**
   * 总开关：1 = 开（默认）；0 = 关（要看 v1522 的老行为时用）。
   * 真实扫描图上，顶点字母**都贴着/压着图形线**，和线粘成同一个大连通域 ——
   * stripText 只处理"孤立小块"，于是这些字母既没被抹掉、也没进字形识别，
   * 每个字母的笔画都变成顶点（user2 五棱锥：真值 11 个顶点、识别出 22 个 ✗）。
   */
  labelPeel?: number
  /**
   * 是否**把分离出来的字母从墨迹里删掉**（默认 0 = 不删 ✗）。
   * 实测（.probe/vecbench.cjs 8 套合成真值 + 6 张真图）：删掉之后
   *   · 好的一面：user2 的顶点从 (216,93) 挪到真正的顶点 (216,77) ✓、顶点数 22→20 ✓、字母数正好 11（= 真值 ✓）；
   *   · 坏的一面：合成基准台顶点召回 93.3%→91.9% ✗、1-原图 10→8 ✗、3-人工修正 19→18 ✗。
   * 原因是"删字母"会连带改变虚线成链的走向（字母位置原来是链的端点），下游一抖就是一两个顶点 ✗。
   * 所以默认**只分离、不删**（零几何回归 ✓），要试这条路的用 labelCut=1。
   */
  labelCut?: number
  /** 找"字母芽"的半径（图对角线的比例，默认 0.055 ≈ 大半个字高）。取小了切不下整个字，取大了会把短线段当成字。 */
  labelBudR?: number
  /** 芽的最小高度（相对"字高参考"，默认 0.6）—— 比这更矮的块一律不是字（虚线短划、墨点碎屑）*/
  labelMinH?: number
  /** 芽的实心度下限（切出来的墨迹 ÷ 它的外框面积，默认 0.30）——
   *  尺度无关 ✓：字母是紧凑笔画（实测 0.30~0.50 ✓），一条线在同样大的框里只有 0.05~0.15 ✓。 */
  labelBudFill?: number
  /** 最多切几轮（默认 2）。一轮切不干净的字（被图形线穿过的 H、A）留下的残笔画，靠第二轮收尾 ✓ */
  labelPass?: number
  /** 切完是否再跑一遍"挑小孤立块"（默认 0 = 不跑 ✗ —— 实测会把散开的虚线短划当字母抹掉） */
  labelRescan?: number
  /** 调试：1 = 把每个候选芽的判定过程打到控制台（node 探针看"为什么没认出来"用 ✓） */
  labelDebug?: number
  /** 【v1525】把"被字母切断的线"接回去（两头都是断头、缺口 ≤1.2 字高、共线、中间有字母 ✓）：1 = 开（默认 ✓）；0 = 关。 */
  labelHeal?: number
  /** 【v1524】按字母数剪多余顶点：1 = 开；**0 = 关（默认 ✗）**。
   *  只剪"附近没有标注撑腰"的断头 / 连线上的度 2 点，剪到标注个数就停 ✓。
   *  ⚠ 实测（六张真图 + 8 套合成真值）：真图上有效（user2 22→18、user5 15→12，两条老样本一动不动 ✓），
   *   但合成图顶点召回 93.3%→87.7% ✗（那边的字大多压在线上、数不准 ✗）→ 默认先关 ✓，见诊断文档 · v1524。 */
  labelPrune?: number
  /** "被抹掉的字母能把线补起来"（v1522 的补接）用哪些字母块：
   *  0 = 只有**字形识别成功**的那些（默认 ✓ = v1522 的老行为）；1 = 所有被抹掉的小块。
   *  ⚠ 实测 1 会误合并真顶点（1-原图 10→8 ✗、3-人工修正 19→18 ✗），所以默认不动 ✓。 */
  healByBlob?: number
}

export interface VectorizeStats {
  verts: number
  edges: number
  dash: number
  text: number
  bars: number
  dashGroups: number
  /** 【v1523】从图形线里**分离出来的字母**个数（贴着线、原来根本没被挑出来的那些） */
  buds?: number
  /** 【v1524】这张图**有几个标注**（正文号 + 下标配对之后的个数 ✓）—— 顶点数的参考目标 */
  labels?: number
  /** 【v1524】按字母数剪掉了几个多余顶点 */
  pruned?: number
  /** 【v1525】把"被字母切断的线"接回去了几处 */
  healed?: number
  /** 识别框四条边上各有多少墨迹像素 —— 非 0 就说明这个框把图形切掉了一块。
   *  实测：image16 的框底边正压在字母 x 的腰上，x 只剩半个字形（像个 V），于是被认成了 v。
   *  只在显式传了 crop 时统计（整图识别时图片边缘本来就可能有内容，报这个没意义）。 */
  clipped?: { top: number; bottom: number; left: number; right: number }
}

export interface VectorizeResult {
  /** 识别框尺寸（= crop 的宽高；没传 crop 就是整图） */
  W: number
  H: number
  /** 识别框在原图里的位置 */
  box: [number, number, number, number]
  /** 原图尺寸 */
  imgW: number
  imgH: number
  /** 归一化顶点（相对识别框），扁平 [x0,y0,x1,y1,...] */
  points: number[]
  /** 边：[起点, 终点, 是否虚线] */
  edges: [number, number, number][]
  /** 被抹掉的字母：位置（归一化，相对识别框）+ 自动认出来的文本 */
  anchors: { x: number; y: number; text: string; conf: number }[]
  /** 拟合出来的椭圆弧（球/圆锥/圆台/圆柱的底、画弧的题）。坐标与 points 同一套 */
  arcs?: FigureArc[]
  stats: VectorizeStats
}

/** 把一串点拟合成**轴对齐**椭圆，返回像素单位的中心/半径/参数角与拟合残差。
 *  立体几何里的底面圆投影下来基本都是轴对齐椭圆，够用；拟合得不像（残差大）就退回折线。
 *  用代数距离最小二乘：x² + B·y² + C·x + D·y + E = 0，展开成 4 元线性方程组。 */
export function fitEllipse(pts: [number, number][], w?: number[]): { cx: number; cy: number; rx: number; ry: number; a0: number; a1: number; rms: number } | null {
  const n = pts.length
  if (n < 8) return null
  // **先在单位框里拟合**：直接拿像素坐标算，x² 的量级是 500²=25 万，跟常数项差 5 个数量级，
  // 法方程条件数极差 —— 实测会解出 rx=452531 这种退化结果、或者干脆失败。
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  const bw = Math.max(1e-6, x1 - x0), bh = Math.max(1e-6, y1 - y0)
  const P = pts.map(([x, y]) => [(x - x0) / bw, (y - y0) / bh] as [number, number])
  let a11 = 0, a12 = 0, a13 = 0, a14 = 0, a22 = 0, a23 = 0, a24 = 0, a33 = 0, a34 = 0, a44 = 0
  let b1 = 0, b2 = 0, b3 = 0, b4 = 0
  // w 是**梯度加权**（Sampson 近似）用的权重：不传就是普通代数拟合（结果与原来完全一致）。
  // 传了的话法方程按 w 加权，外层迭代几轮就把"代数距离"逼近成"几何距离"。
  for (let i = 0; i < n; i++) {
    const [x, y] = P[i]
    const wi = w ? w[i] : 1
    const r0 = y * y, r1 = x, r2 = y
    const t = -x * x
    a11 += wi * r0 * r0; a12 += wi * r0 * r1; a13 += wi * r0 * r2; a14 += wi * r0
    a22 += wi * r1 * r1; a23 += wi * r1 * r2; a24 += wi * r1
    a33 += wi * r2 * r2; a34 += wi * r2
    a44 += wi
    b1 += wi * r0 * t; b2 += wi * r1 * t; b3 += wi * r2 * t; b4 += wi * t
  }
  // 4x4 高斯消元（带部分主元）
  const M = [[a11, a12, a13, a14, b1], [a12, a22, a23, a24, b2], [a13, a23, a33, a34, b3], [a14, a24, a34, a44, b4]]
  for (let c = 0; c < 4; c++) {
    let piv = c
    for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r
    if (Math.abs(M[piv][c]) < 1e-12) return null
    if (piv !== c) { const t = M[piv]; M[piv] = M[c]; M[c] = t }
    for (let r = c + 1; r < 4; r++) {
      const f = M[r][c] / M[c][c]
      for (let k = c; k < 5; k++) M[r][k] -= f * M[c][k]
    }
  }
  const sol = [0, 0, 0, 0]
  for (let r = 3; r >= 0; r--) {
    let s = M[r][4]
    for (let k = r + 1; k < 4; k++) s -= M[r][k] * sol[k]
    sol[r] = s / M[r][r]
  }
  const [B, C, D, E] = sol
  if (!(B > 1e-4)) return null
  const ncx = -C / 2, ncy = -D / 2
  const K = ncx * ncx + B * ncy * ncy - E
  if (!(K > 1e-6)) return null
  const nrx = Math.sqrt(K)
  const nry = Math.sqrt(K / B)
  if (!isFinite(nrx) || !isFinite(nry) || nrx < 1e-3 || nry < 1e-3) return null
  // 换回像素坐标（轴对齐，角度不变）
  const cx = x0 + ncx * bw, cy = y0 + ncy * bh
  const rx = nrx * bw, ry = nry * bh
  if (rx < 3 || ry < 3) return null
  // 残差 = 各点到椭圆的径向距离（像素）
  let sum = 0
  for (const [x, y] of pts) {
    const q = Math.hypot((x - cx) / rx, (y - cy) / ry)
    sum += ((q - 1) * Math.min(rx, ry)) ** 2
  }
  const rms = Math.sqrt(sum / n)
  const ang = (p: [number, number]) => Math.atan2((p[1] - cy) / ry, (p[0] - cx) / rx)
  return { cx, cy, rx, ry, a0: ang(pts[0]), a1: ang(pts[n - 1]), rms }
}

/** 最小二乘拟合**圆**（Kasa 法）。只有 3 个参数，短弧上也稳 ——
 *  用它先找出"哪一段确实是弧"，再对整段拟合椭圆（椭圆 5 个参数，短弧上是病态的：实测残差几十像素、甚至解出 rx=452531）。 */
export function fitCircle(pts: [number, number][], w?: number[]): { cx: number; cy: number; r: number; rms: number } | null {
  const n = pts.length
  if (n < 5) return null
  // ⚠ **先平移到质心再拟合**：Kåsa 的法方程里 x² 和常数项差好几个数量级，弧又短，
  //   直接拿像素坐标算会严重病态 —— 实测圆心在 (180,150) 的一段 120° 弧就直接拟合不出来。
  //   平移不改变圆（只是换参考点），把法方程的尺度拉回来，纯粹的数值改善。
  let mx = 0, my = 0
  for (const [x, y] of pts) { mx += x; my += y }
  mx /= n; my /= n
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0, sw = 0
  // 同 fitEllipse：不传 w 时（sw === n）结果与原来逐位一致
  for (let i = 0; i < n; i++) {
    const x = pts[i][0] - mx, y = pts[i][1] - my
    const wi = w ? w[i] : 1
    const z = x * x + y * y
    sw += wi
    sx += wi * x; sy += wi * y; sxx += wi * x * x; syy += wi * y * y; sxy += wi * x * y
    sxz += wi * x * z; syz += wi * y * z; sz += wi * z
  }
  // ⚠ 第 3 行第 3 列必须是 **Σw**，不能写死 n ✗ —— 加权时 RHS 按 w 累加、LHS 却还是 n，
  //   方程左右不一致 → 解直接飞掉（实测圆心飞到 220 万像素外、半径同量级）。
  const A = [[sxx, sxy, sx, -sxz], [sxy, syy, sy, -syz], [sx, sy, sw, -sz]]
  for (let c = 0; c < 3; c++) {
    let piv = c
    for (let r2 = c + 1; r2 < 3; r2++) if (Math.abs(A[r2][c]) > Math.abs(A[piv][c])) piv = r2
    if (Math.abs(A[piv][c]) < 1e-9) return null
    if (piv !== c) { const t = A[piv]; A[piv] = A[c]; A[c] = t }
    for (let r2 = c + 1; r2 < 3; r2++) {
      const f = A[r2][c] / A[c][c]
      for (let k = c; k < 4; k++) A[r2][k] -= f * A[c][k]
    }
  }
  const s = [0, 0, 0]
  for (let r2 = 2; r2 >= 0; r2--) {
    let v = A[r2][3]
    for (let k = r2 + 1; k < 3; k++) v -= A[r2][k] * s[k]
    s[r2] = v / A[r2][r2]
  }
  const cx0 = -s[0] / 2, cy0 = -s[1] / 2        // 相对质心的圆心
  const rr = cx0 * cx0 + cy0 * cy0 - s[2]
  if (!(rr > 1)) return null
  const r = Math.sqrt(rr)
  const cx = cx0 + mx, cy = cy0 + my            // 换回原坐标系
  let sum = 0
  for (const [x, y] of pts) sum += (Math.hypot(x - cx, y - cy) - r) ** 2
  return { cx, cy, r, rms: Math.sqrt(sum / n) }
}

function diagOf(pts: [number, number][]) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  return Math.max(1, Math.hypot(x1 - x0, y1 - y0))
}

/** 一条路径用**直线**拟合时的正交距离 RMS（PCA 主轴）。
 *  它是"这段到底是不是弧"的关键对照：稍微有点弯的直线也能拟合出一个半径几千像素的圆 ——
 *  v1142 那次"凭空多画出一段弧"就是这么来的。所以弧必须**显著优于**直线才算数。 */
function lineRms(pts: [number, number][]): number {
  const n = pts.length
  if (n < 2) return 0
  let mx = 0, my = 0
  for (const [x, y] of pts) { mx += x; my += y }
  mx /= n; my /= n
  let sxx = 0, sxy = 0, syy = 0
  for (const [x, y] of pts) { const dx = x - mx, dy = y - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const ux = Math.cos(th), uy = Math.sin(th)
  let s = 0
  for (const [x, y] of pts) { const dx = x - mx, dy = y - my; const d = dx * -uy + dy * ux; s += d * d }
  return Math.sqrt(s / n)
}

/** 梯度加权迭代（Sampson 近似）：把**代数距离**逐步逼近**几何距离**。
 *  普通代数拟合在局部弧上有系统偏差（Kåsa 尤其明显：弧越短偏得越多）——
 *  这是"拟合方法本身"能改进的地方，迭代几轮就把偏差压下去。 */
export function arcRefine(pts: [number, number][], kind: 'circle' | 'ellipse') {
  let w: number[] | undefined
  let out: { cx: number; cy: number; rx: number; ry: number; rms: number } | null = null
  for (let it = 0; it < 6; it++) {
    if (kind === 'circle') {
      const c = fitCircle(pts, w)
      out = c ? { cx: c.cx, cy: c.cy, rx: c.r, ry: c.r, rms: c.rms } : null
    } else {
      const e = fitEllipse(pts, w)
      out = e ? { cx: e.cx, cy: e.cy, rx: e.rx, ry: e.ry, rms: e.rms } : null
    }
    if (!out) return null
    // Sampson 权重 = 1/|∇F|²；这里 F = u²+v²−1（u=(x−cx)/rx，v=(y−cy)/ry）
    const { cx, cy, rx, ry } = out
    w = pts.map(([x, y]) => {
      const u = (x - cx) / rx, v = (y - cy) / ry
      const g = (u * u) / (rx * rx) + (v * v) / (ry * ry)
      return 1 / Math.max(1e-9, g)
    })
  }
  return out
}

/** 把一条骨架路径**可靠地**拟合成弧；不可靠返回 null（宁可不出弧，也不凭空画一条）。
 *  v1142 是直接把拟合结果加成弧 → 用户反馈"图上凭空多画出一段弧" ✗。所以三道门槛：
 *   ① 弧 RMS < 1.2px，且必须 < 直线 RMS 的 1/3（不够优于直线就当直线）；
 *   ② 95% 以上的点都要贴着弧（覆盖整条路径，不能是"弧 + 顺势追下去的直线"）；
 *   ③ 长短轴比 ≤ 4、半径不超过路径跨度的 3 倍（拟合发散的一律不要）。
 *  返回**像素坐标**下的弧（调用方最后统一归一化）。 */
export function tryFitArc(pts: [number, number][], minSpanDeg: number) {
  const n = pts.length
  if (n < 16) return null
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  const ext = Math.max(1, Math.hypot(x1 - x0, y1 - y0))
  const lr = lineRms(pts)
  // ⚠ 必须**先逐条过滤、再挑**（不能"先挑残差最小的、再看它合不合理"）：
  //   椭圆多 2 个参数，短弧上很容易给出一个"残差极小但形状离谱"的假解（例如 ry 上千）；
  //   旧写法会挑中它、然后被形状门槛整条否掉 —— **连旁边那个完全正确的圆一起丢掉**。
  //   实测：120° / 90° / 60° 的弧全部被这个坑否掉（见 .probe/vfit.cjs）。
  const gate = (c: { cx: number; cy: number; rx: number; ry: number; rms: number } | null) => {
    if (!c || !isFinite(c.rms)) return null
    const r0 = Math.min(c.rx, c.ry), r1 = Math.max(c.rx, c.ry)
    if (!(r0 > 2)) return null                          // 太小 = 噪声
    if (c.rms > 1.2) return null                        // ① 拟合本身要够贴
    if (lr < c.rms * 3) return null                     // ① 不够优于直线 → 当直线
    if (r1 / r0 > 4) return null                        // ③ 太扁 = 发散
    if (r1 > ext * 3) return null                       // ③ 半径离谱
    let bad = 0                                          // ② 必须盖住整条路径
    for (const [x, y] of pts) {
      const q = Math.hypot((x - c.cx) / c.rx, (y - c.cy) / c.ry)
      if (Math.abs(q - 1) * r0 > 2.5) bad++
    }
    if (bad > n * 0.05) return null
    return c
  }
  const okC = gate(arcRefine(pts, 'circle'))
  const okE = gate(arcRefine(pts, 'ellipse'))
  // 椭圆只在**明显更准**时才压过圆（多 2 个参数，容易被短弧上的低残差假解骗到）
  const best = okE && (!okC || okE.rms < okC.rms * 0.7) ? okE : okC
  if (!best) return null
  const angOf = (p: [number, number]) => Math.atan2((p[1] - best.cy) / best.ry, (p[0] - best.cx) / best.rx)
  let span = 0
  for (let i = 1; i < n; i++) {
    let d = angOf(pts[i]) - angOf(pts[i - 1])
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    span += Math.abs(d)
  }
  if ((span * 180) / Math.PI < minSpanDeg) return null   // 太短的弧不值得，折线更稳
  return { cx: best.cx, cy: best.cy, rx: best.rx, ry: best.ry, a0: angOf(pts[0]), a1: angOf(pts[n - 1]) }
}


/** 在一串骨架点里找出"确实是弧"的连续段。
 *  一条路常常是「弧 + 紧接着追下去的直线」，整条拟合残差几十像素；
 *  所以先按窗口判（用**圆**判，短弧上圆稳），把连续的窗口并成段，再对每段整体拟合椭圆。 */
export function fitArcRuns(pts: [number, number][]): { cx: number; cy: number; rx: number; ry: number; a0: number; a1: number; rms: number; i0: number; i1: number }[] {
  const N = pts.length
  const W = 64, STEP = 16
  if (N < W) return []
  const good = new Array<boolean>(N).fill(false)
  for (let s = 0; s + W <= N; s += STEP) {
    const win = pts.slice(s, s + W)
    const c = fitCircle(win)
    if (!c) continue
    if (c.rms > 1.2) continue
    // 半径要跟**这个窗口自己的尺寸**比：一段直线也能"拟合"出一个半径几千像素的圆，
    // 用整条路径的对角线当上限的话这种假圆会混进来，把后面的直线尾巴并进弧里。
    const wd = diagOf(win)
    if (c.r < 12 || c.r > wd * 12) continue             // 太小是噪声、太大基本是直线
    for (let k = s; k < s + W; k++) good[k] = true
  }
  const runs: { i0: number; i1: number }[] = []
  let i = 0
  while (i < N) {
    if (!good[i]) { i++; continue }
    let j = i
    while (j < N && good[j]) j++
    if (j - i >= W) runs.push({ i0: i, i1: j - 1 })
    i = j
  }

  const out: { cx: number; cy: number; rx: number; ry: number; a0: number; a1: number; rms: number; i0: number; i1: number }[] = []
  for (const r of runs) {
    // 段里往往还拖着一截紧接的直线（弧画到角点后顺着直线追下去了），
    // 直接整段拟合会被那截直线带偏 → **剔除离群点再拟合**，两轮就够
    let idx: number[] = []
    for (let k = r.i0; k <= r.i1; k++) idx.push(k)
    let f: ReturnType<typeof fitEllipse> = null
    for (let round = 0; round < 3 && idx.length >= 24; round++) {
      f = fitEllipse(idx.map((k) => pts[k]))
      if (!f) break
      const keep = idx.filter((k) => {
        const q = Math.hypot((pts[k][0] - f!.cx) / f!.rx, (pts[k][1] - f!.cy) / f!.ry)
        return Math.abs(q - 1) * Math.min(f!.rx, f!.ry) < 3
      })
      if (keep.length === idx.length) break
      idx = keep
    }
    if (idx.length < 24) continue
    const inl = idx.map((k) => pts[k])
    // **椭圆和圆都拟一次，谁准用谁**：立体几何里的底多半是圆（投影后才是椭圆），
    // 而椭圆拟合在真实（带噪声的）点上有时候反而不稳 —— 实测同一条弧圆拟合 0.6px、椭圆 47px。
    const fe = fitEllipse(inl)
    const fc = fitCircle(inl)
    let use: { cx: number; cy: number; rx: number; ry: number; a0: number; a1: number; rms: number } | null = null
    if (fe && fc) {
      if (fe.rms <= fc.rms * 1.5) use = fe
      else {
        const ang = (p2: [number, number]) => Math.atan2((p2[1] - fc.cy) / fc.r, (p2[0] - fc.cx) / fc.r)
        use = { cx: fc.cx, cy: fc.cy, rx: fc.r, ry: fc.r, a0: ang(inl[0]), a1: ang(inl[inl.length - 1]), rms: fc.rms }
      }
    } else if (fe) use = fe
    else if (fc) {
      const ang = (p2: [number, number]) => Math.atan2((p2[1] - fc.cy) / fc.r, (p2[0] - fc.cx) / fc.r)
      use = { cx: fc.cx, cy: fc.cy, rx: fc.r, ry: fc.r, a0: ang(inl[0]), a1: ang(inl[inl.length - 1]), rms: fc.rms }
    }
    if (!use || use.rms > 3.0) continue
    if (Math.max(use.rx, use.ry) / Math.min(use.rx, use.ry) > 5) continue
    // 真实扫过角：**沿点序累加相邻角差**（每步取 (-π,π] 那一支）。
    // 直接用 a1-a0 再补 2π 是错的 —— 会把"反向扫过 11°"算成"正向 349°"，于是留下退化成小段的弧。
    const angOf = (p2: [number, number]) => Math.atan2((p2[1] - use!.cy) / use!.ry, (p2[0] - use!.cx) / use!.rx)
    let span = 0
    for (let i2 = 1; i2 < inl.length; i2++) {
      let d2 = angOf(inl[i2]) - angOf(inl[i2 - 1])
      while (d2 > Math.PI) d2 -= Math.PI * 2
      while (d2 < -Math.PI) d2 += Math.PI * 2
      span += d2
    }
    if (Math.abs(span) < 0.7) continue
    out.push({ cx: use.cx, cy: use.cy, rx: use.rx, ry: use.ry, a0: use.a0, a1: use.a0 + span, rms: use.rms, i0: idx[0], i1: idx[idx.length - 1] })
  }
  return out
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image()
    im.crossOrigin = 'anonymous'
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error('图片加载失败（跨域图片无法读取像素，请用本地图片）'))
    im.src = src
  })
}

// ---------- 二值化 ----------
function inkFromRgba(d: ArrayLike<number>, W: number, H: number, crop?: [number, number, number, number]) {
  const ink = new Uint8Array(W * H)
  const box: [number, number, number, number] = crop
    ? [Math.max(0, crop[0] | 0), Math.max(0, crop[1] | 0), Math.min(W, crop[2] | 0), Math.min(H, crop[3] | 0)]
    : [0, 0, W, H]
  for (let y = box[1]; y < box[3]; y++) {
    for (let x = box[0]; x < box[2]; x++) {
      const p = (y * W + x) * 4
      const lum = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]
      if (d[p + 3] > 100 && lum < 150) ink[y * W + x] = 1
    }
  }
  return { ink, W, H, box }
}

/** 主线程入口：把 HTMLImageElement 转成 RGBA，再复用无 DOM 的二值化。 */
export function toInk(img: HTMLImageElement, crop?: [number, number, number, number]) {
  const W = img.naturalWidth, H = img.naturalHeight
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const g = c.getContext('2d', { willReadFrequently: true })
  if (!g) throw new Error('无法创建画布上下文')
  g.drawImage(img, 0, 0)
  return inkFromRgba(g.getImageData(0, 0, W, H).data, W, H, crop)
}

export function vectorizeImageData(data: ArrayLike<number>, W: number, H: number, opt: VectorizeOpt = {}): VectorizeResult {
  return vectorizeFromInk(inkFromRgba(data, W, H, opt.crop), opt)
}

// ---------- 连通域 ----------
interface Comp {
  n: number; x0: number; y0: number; x1: number; y1: number
  sx: number; sy: number; pix: number[]
  cx: number; cy: number; bw: number; bh: number; diag: number
  ux: number; uy: number; len: number
}

export function components(ink: Uint8Array, W: number, H: number, box: [number, number, number, number]): Comp[] {
  const seen = new Uint8Array(W * H)
  const list: Comp[] = []
  const stack: number[] = []
  for (let y = box[1]; y < box[3]; y++) {
    for (let x = box[0]; x < box[2]; x++) {
      const s = y * W + x
      if (!ink[s] || seen[s]) continue
      const comp = { n: 0, x0: x, y0: y, x1: x, y1: y, sx: 0, sy: 0, pix: [] as number[] } as Comp
      stack.length = 0; stack.push(s); seen[s] = 1
      while (stack.length) {
        const i = stack.pop() as number
        const px = i % W, py = (i / W) | 0
        comp.n++; comp.pix.push(i)
        comp.sx += px; comp.sy += py
        if (px < comp.x0) comp.x0 = px
        if (py < comp.y0) comp.y0 = py
        if (px > comp.x1) comp.x1 = px
        if (py > comp.y1) comp.y1 = py
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue
            const nx = px + dx, ny = py + dy
            if (nx < box[0] || ny < box[1] || nx >= box[2] || ny >= box[3]) continue
            const j = ny * W + nx
            if (ink[j] && !seen[j]) { seen[j] = 1; stack.push(j) }
          }
        }
      }
      comp.cx = comp.sx / comp.n; comp.cy = comp.sy / comp.n
      comp.bw = comp.x1 - comp.x0 + 1; comp.bh = comp.y1 - comp.y0 + 1
      comp.diag = Math.hypot(comp.bw, comp.bh)
      comp.ux = 0; comp.uy = 0; comp.len = 0
      list.push(comp)
    }
  }
  return list
}

/** 用二阶矩求细长块的主轴方向与长度（对角短划也必须算对，不能只看 bbox 长短边） */
function axisOf(c: Comp, W: number) {
  let mxx = 0, mxy = 0, myy = 0
  for (let k = 0; k < c.pix.length; k++) {
    const x = c.pix[k] % W, y = (c.pix[k] / W) | 0
    const dx = x - c.cx, dy = y - c.cy
    mxx += dx * dx; mxy += dx * dy; myy += dy * dy
  }
  mxx /= c.n; mxy /= c.n; myy /= c.n
  const th = 0.5 * Math.atan2(2 * mxy, mxx - myy)
  const ux = Math.cos(th), uy = Math.sin(th)
  let minT = 1e9, maxT = -1e9, minW = 1e9, maxW = -1e9
  for (let k = 0; k < c.pix.length; k++) {
    const x = c.pix[k] % W, y = (c.pix[k] / W) | 0
    const dx = x - c.cx, dy = y - c.cy
    const t = dx * ux + dy * uy
    const w = dx * -uy + dy * ux
    if (t < minT) minT = t
    if (t > maxT) maxT = t
    if (w < minW) minW = w
    if (w > maxW) maxW = w
  }
  const len = maxT - minT, wid = maxW - minW
  // 【v1519 · D2】"占自身斜外接框"的比例 —— 这是**尺度无关**的形状判据 ✓：
  //   短划是细长实心的（墨迹把细长框填满 ✓ 实测 fill 0.75~1.5 ✓）；
  //   字母是紧凑笔画（框里大量空白 ✓ 实测 fill 0.20~0.44 ✓）。
  //   ⚠ 不能用轴对齐 bbox 的实心度 ✗（对角短划的 bbox 接近正方形、实心度很低 ✗ 老注释说过 ✓）——
  //   必须用**主轴对齐**的框 ✓，这才分得开 ✓。
  const fill = c.n / Math.max(1e-6, len * Math.max(1, wid))
  return { ux, uy, len, wid, fill }
}

/**
 * 挑字母：小连通域里，几个"共线且首尾相接"的细长块 = 一条虚线的短划，留下；
 * 其余小块 = 字母，抹掉。
 * 注意不能用"实心度（墨迹占 bbox 比例）"来分：对角短划的 bbox 接近正方形，实心度很低，
 * 会被当成字母一起抹掉，整条虚线就没了。
 */
export function stripText(comp: Comp[], W: number, diag: number, ink: Uint8Array, opt: VectorizeOpt) {
  const smallMax = opt.textMax ?? 0.16
  const minPiece = opt.dashMinPiece ?? 4
  const bars: Comp[] = []
  const texts: Comp[] = []
  /** 【v1524】被判成"短划"、但其实**不是细长条**的紧凑块 —— 只报给"数标注"用 ✓（不进墨迹 ✓） */
  const solid: Comp[] = []
  for (const c of comp) {
    if (c.diag >= smallMax * diag) continue      // 大块 = 线网本体，留下
    const ax = axisOf(c, W)
    c.ux = ax.ux; c.uy = ax.uy; c.len = ax.len
    // 【v1519 · D2】★ 形状判据：**紧凑块直接当字母**，不许进"虚线成链"的候选池 ✓
    //   起因（真机实测 ✓）：只按"到整条直线的垂距 + 方向"成链时，字母（B、C、D…）又小又方、
    //   方向估计随机 ✗，会被当成"虚线的一截"收进链里 ✗ → 该抹掉的字母留在墨迹里 ✗ →
    //   骨架多出弯曲短路径 → tryFitArc 冒出 3~7 条假弧 ✗✗（1-原图 弧 0→3、3-人工修正 1→7 ✓）。
    //   实测 fill：短划 0.75~1.54 ✓、字母 0.20~0.44 ✓ → 门槛 0.5 干净利落 ✓。
    //   ⚠ 默认值是**扫出来的 0.35** ✗→✓：0.45/0.5 会把真短划一起丢掉（1-原图 掉 2 顶点 2 边 ✗），
    //     0.35 在两张实图上与基线逐项一致（10/18/6/0 与 19/19/9/1 ✓），合成 scorecard 也逐项一致 ✓。
    if (ax.fill < (opt.dashFill ?? 0.35)) { texts.push(c); continue }
    // 【v1524】"实心"的小块里还有一类是**字**：扫描件的字 fill 在 0.24~0.45 ✓，可**矢量渲染 / 合成图**上的字
    //   笔画挤在一起，主轴 fill 能到 0.8 ✗ → 会被当成虚线的短划留在墨迹里 ✗
    //   （实测基准台 8 套合成图：61 个顶点字母只数出 38 个 ✗ → "按字母数剪顶点"就会剪到真顶点 ✗）。
    //   补一刀：**细长条才是短划，不是细长条的紧凑块仍然是字** ✓（与上面那条判据正交 ✓，扫描件上
    //   虚线短划实测 fill 0.75~1.5 且都是细长条 ✓，行为完全不变 ✓）。
    // 杂点：扫描噪声形成的小墨团，主轴长度往往只有 1~3px（真实短划十几像素）。
    // 若让它参与"虚线成链"，两个杂点就会凑成一条"两截的短虚线" → 凭空多出一条悬空线段。
    if (c.len < minPiece) { texts.push(c); continue }
    bars.push(c)
    // 【v1524】"实心"的小块里还有一类是**字**：扫描件的字 fill 在 0.24~0.45 ✓，可**矢量渲染 / 合成图**上的字
    //   笔画挤在一起，主轴 fill 能到 0.8 ✗ → 会被当成虚线的短划留在墨迹里 ✗
    //   （实测基准台 8 套合成图：61 个顶点字母只数出 38 个 ✗ → "按字母数剪顶点"就会剪到真顶点 ✗）。
    //   ⚠ 这一刀**只用于"数标注"**（solid 只是报告出来 ✓，不进墨迹、不进图 ✓）——
    //     实测拿它去改墨迹会把真短划一起抹掉 ✗（1-原图 10→9、3-人工修正 19→18 ✗，两条老样本的锁就破了 ✗）。
    if (!isBarLike({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, pix: c.pix }, W)) solid.push(c)
  }
  const used = new Array(bars.length).fill(false)
  const groups: Comp[][] = []
  for (let a = 0; a < bars.length; a++) {
    if (used[a]) continue
    const grp = [bars[a]]
    used[a] = true
    let grow = true
    while (grow) {
      grow = false
      for (let k = 0; k < bars.length; k++) {
        if (used[k]) continue
        const B = bars[k]
        for (const A of grp) {
          // 短划（十几像素）的**主轴方向估计有噪声**，10° 的对齐门槛会把同一条虚线上的短划拆开；
          // 拆散之后每堆不足 2 个就会被当字母抹掉 —— 整条虚线随之消失
          if (Math.abs(A.ux * B.ux + A.uy * B.uy) < (opt.dashCos ?? 0.94)) continue   // 方向对齐（见 dashCos 注释）
          const vx = B.cx - A.cx, vy = B.cy - A.cy
          const d = Math.hypot(vx, vy)
          if (d > 8 + 6 * Math.max(A.len, B.len)) continue
          if (Math.abs(vx * -A.uy + vy * A.ux) > (opt.dashPerp ?? 16)) continue   // 到 A 所在直线的垂距（见 dashPerp 注释）
          // 4px 太严：虚线本身画得略有抖动，实测 A–E 那条线上各短块相对理想线偏了 2~12px，
          // 一超限就被拆成孤立小块、凑不满 3 个 → 当字母抹掉 → 整条边消失
          const tB = vx * A.ux + vy * A.uy
          if (Math.abs(tB) > 0.5 * (A.len + B.len) + (opt.dashGap ?? 20)) continue  // 沿轴方向的间距
          grp.push(B); used[k] = true; grow = true; break
        }
        if (grow) break
      }
    }
    // ≥2 就算虚线：**只有两截的短虚线**（例如 D–E、C–F 那种）天生凑不满 3，
    // 按 ≥3 判的话它们会被当字母碎片抹掉，用户看到的就是"这条边没识别出来"
    // 整堆总长度不够 = 几个杂点凑出来的假虚线 → 整堆抹掉（真短虚线两截加起来也远超这个值）
    const mass = grp.reduce((s, c) => s + c.len, 0)
    if (grp.length >= 2 && mass >= (opt.dashMinTotal ?? 16)) groups.push(grp)
    else for (const c of grp) texts.push(c)
  }
  const out = ink.slice()
  for (const c of texts) for (const p of c.pix) out[p] = 0
  const anchors = texts.map((c) => ({ x: c.cx, y: c.cy, pix: c.pix, x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 }))
  return { ink: out, anchors, dashGroups: groups.length, barCount: bars.length, textCount: texts.length, solid }
}

/* ---------- 【v1523】字母分离：把"贴着线的字母"从图形线里切出来 ---------- */

/** 切出来的字母块（与 stripText 的 anchors 同构，直接并进字形识别队列 ✓） */
export interface LetterBlob { x: number; y: number; pix: number[]; x0: number; y0: number; x1: number; y1: number }

/**
 * 把"贴着线的字母"从图形线里切出来。
 *
 * 起因（用户 6 张真题图实测 ✓）：教材图**每个顶点都有字母**，而这些字母都贴着/压着图形线 ✗，
 * 和线粘成同一个大连通域 → stripText 只认**孤立**小块 ✓ → 这些字母既没被抹掉、也没进字形识别 ✗
 * → 每个字母的笔画都变成顶点 ✗（user2 五棱锥：真值 11 个顶点，识别出 **22** 个 ✗）。
 *
 * 判据（全部尺度无关，且都能在图上直接看出来 ✓）：
 *   ① **字母挂在线上 = 骨架里必然多出一个度 ≥3 的节点**（接触点）—— 只从这种点出发找 ✓；
 *   ② 从该点沿骨架走：**整条都落在半径 R 内**的路径 = 芽（字母），走到 R 外面的 = 图形线 ✓
 *      （字形内部的交叉点继续往里走，所以 B、A 这种带内部分叉的整字也是一块 ✓）；
 *   ③ 芽要**像字**：外框 ≤ R、外框里墨迹实心度 ≥ 0.30、不是细长条、有笔画端头（或内部分叉）✓；
 *   ④ 真要删墨迹时（`labelCut=1`）按"**离骨架最近**"分配 —— 图形线自己的墨迹离线的骨架更近，不会被误删 ✓
 *      （所以下刀只在字母与线的接触处，线的走向、顶点位置都不动 ✓）。
 *
 * 分离出来的字变成**新的字母块**（与 stripText 的 anchors 同构）→ 并进字形识别队列 ✓ →
 * `VectorizeDialog.adopt()` 就能把它们配回顶点、显示成顶点字母 ✓。
 * ⚠ 默认**只分离、不删墨迹**（`labelCut=0`）：删掉字母会连带改变虚线成链的走向，
 *   基准台顶点召回 93.3%→91.9%、1-原图 10→8 ✗ —— 实测数据见 docs/矢量描摹-诊断.md · v1523。
 */
export function peelLabels(
  ink: Uint8Array, W: number, H: number, diag: number, opt: VectorizeOpt,
  known: { y0: number; y1: number }[] = [],
  pre?: { sk: Uint8Array; G: SkGraph },
): { ink: Uint8Array; anchors: LetterBlob[]; buds: number; sk?: Uint8Array; G?: SkGraph } {
  const R = Math.max(6, (opt.labelBudR ?? 0.055) * diag)
  const fillMin = opt.labelBudFill ?? 0.15
  // 不删墨迹时只跑一轮：墨迹没变，第二轮会把同一批字母再"发现"一遍 ✗
  const cut = (opt.labelCut ?? 0) !== 0
  const passes = cut ? Math.max(1, Math.round(opt.labelPass ?? 2)) : 1
  // 字高参考：stripText 抹掉的孤立小块几乎全是字母 ✓（虚线的短划会被"成链"留下、不会被抹掉 ✓）。
  // 教材图里**所有标注的字号是同一个**（实测 user2 全是 24px、1-原图 全是 19px、3-人工修正 全是 41px ✓）——
  // 这是个很强的先验：比它矮太多的块（虚线短划 2×7、墨点碎屑）一律不是字 ✓。
  // ⚠ 少了这一条，虚线的每一个短划都会被当成"小字"切掉 ✗（实测 user2 切出 44 块 ✗）。
  const hs = known
    .map((a) => a.y1 - a.y0 + 1)
    .filter((h) => h >= 0.02 * diag && h <= 0.12 * diag)
    .sort((a, b) => a - b)
  const hintH = hs.length ? hs[hs.length >> 1] : 0.035 * diag
  const minH = (opt.labelMinH ?? 0.6) * hintH
  const out = ink.slice()
  const anchors: LetterBlob[] = []
  let lastSk: Uint8Array | undefined
  let lastG: SkGraph | undefined
  for (let pass = 0; pass < passes; pass++) {
    // 第一轮的骨架图表可以直接用调用方刚算好的那份 ✓（不删墨迹时整条流水线只用算一次 thin+buildGraph）
    const sk = pass === 0 && pre ? pre.sk : thin(out, W, H)
    const G = pass === 0 && pre ? pre.G : buildGraph(sk, W, H)
    const deg: number[] = G.nodes.map(() => 0)
    const inc: number[][] = G.nodes.map(() => [])
    G.paths.forEach((p, i) => {
      if (p.aId >= 0) { deg[p.aId]++; inc[p.aId].push(i) }
      if (p.bId >= 0) { deg[p.bId]++; inc[p.bId].push(i) }
    })
    let found = 0
    /**
     * 试切一块：把"离这块骨架比离别的骨架更近"的墨迹划出来，**像字**才删。
     * 下刀只在字母与线的接触处（线自己的墨迹离线的骨架更近 ✓），所以图形线的走向、顶点位置都不动。
     */
    const dbg = (opt.labelDebug ?? 0) !== 0
    const tryPeel = (budPix: number[], tag = ''): boolean => {
      const budSet = new Set(budPix)
      let bx0 = W, by0 = H, bx1 = -1, by1 = -1
      for (const p of budPix) {
        const px = p % W, py = (p / W) | 0
        if (px < bx0) bx0 = px
        if (py < by0) by0 = py
        if (px > bx1) bx1 = px
        if (py > by1) by1 = py
      }
      // ⚠ 便宜预筛放在最贵的"最近骨架"分配之前：大图里自由路径有上百条（虚线的每一截都是一条 ✗），
      //   每条都跑一遍分配就是几百万次距离计算（实测 3-人工修正 29ms → 245ms ✗）。
      //   骨架框本身就太大 / 太矮的，不可能是字（墨迹框最多比骨架框大一个笔画宽）✓。
      const log = (why: string) => { if (dbg) console.log('[peel] ' + tag + ' 骨架(' + bx0 + ',' + by0 + ')-(' + bx1 + ',' + by1 + ') ' + budPix.length + 'px → ' + why) }
      if (Math.hypot(bx1 - bx0 + 1, by1 - by0 + 1) > R * 1.15 + 4) return (log('✗ 骨架框太大 ' + (bx1 - bx0 + 1) + 'x' + (by1 - by0 + 1)), false)
      if (by1 - by0 + 1 < minH * 0.8) return (log('✗ 骨架太矮 ' + (by1 - by0 + 1) + ' < ' + (minH * 0.8).toFixed(1)), false)
      const pad = 2
      const gx0 = Math.max(0, bx0 - pad), gy0 = Math.max(0, by0 - pad)
      const gx1 = Math.min(W - 1, bx1 + pad), gy1 = Math.min(H - 1, by1 + pad)
      const inBud: number[] = [], inOther: number[] = []
      for (let y = gy0; y <= gy1; y++) {
        for (let x = gx0; x <= gx1; x++) {
          const i = y * W + x
          if (!sk[i]) continue
          if (budSet.has(i)) inBud.push(i)
          else inOther.push(i)
        }
      }
      const del: number[] = []
      for (let y = gy0; y <= gy1; y++) {
        for (let x = gx0; x <= gx1; x++) {
          const i = y * W + x
          if (!out[i]) continue
          let db = Infinity, dv = Infinity
          for (const q of inBud) {
            const qx = q % W, qy = (q / W) | 0
            const d = (qx - x) * (qx - x) + (qy - y) * (qy - y)
            if (d < db) db = d
          }
          for (const q of inOther) {
            const qx = q % W, qy = (q / W) | 0
            const d = (qx - x) * (qx - x) + (qy - y) * (qy - y)
            if (d < dv) dv = d
          }
          if (db < dv) del.push(i)
        }
      }
      if (del.length < 12) return (log('✗ 墨迹太少 ' + del.length), false)
      // ③ 像不像一个字 —— 先把这块墨迹拆成连通小块，**整块丢掉"细长条"**（线上的短划 / 短线段 ✓），
      //   剩下的才叫"字芯"，后面的判据全部用字芯算 ✓。
      //   ★ 这条是分开"真字母"和"线交叉点"的关键 ✓：
      //     · 真字母（S、h、O、P、G…）本体是一块**不是细长条**的墨迹 ✓ → 留下 ✓；
      //     · 交叉点上的假芽，每一块都是细长条（线、短划）✗ → 丢完什么都不剩 → 一眼不是字 ✓；
      //     · 字母贴着线时，芽里常**捎带**上压着它的那一小截线 ✗ —— 丢掉它字芯才不被稀释 ✓
      //       （实测 user7 的字母 O：按整块算实心度 0.18 差一点被否掉 ✗，丢掉那截线就是干净的 O ✓）。
      const delSet = new Set(del)
      const seenC = new Set<number>()
      const core: number[] = []
      let pieces = 0
      for (const i of del) {
        if (seenC.has(i)) continue
        pieces++
        const pix: number[] = []
        let px0 = W, py0 = H, px1 = -1, py1 = -1
        const stack2 = [i]
        seenC.add(i)
        while (stack2.length) {
          const p = stack2.pop() as number
          pix.push(p)
          const px = p % W, py = (p / W) | 0
          if (px < px0) px0 = px
          if (py < py0) py0 = py
          if (px > px1) px1 = px
          if (py > py1) py1 = py
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue
              const nx = px + dx, ny = py + dy
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
              const j = ny * W + nx
              if (!delSet.has(j) || seenC.has(j)) continue
              seenC.add(j)
              stack2.push(j)
            }
          }
        }
        if (isBarLike({ x0: px0, y0: py0, x1: px1, y1: py1, pix }, W)) continue
        for (const p of pix) core.push(p)
      }
      // ⚠ 试过第三条路：字芯为空时改用"**笔画端头**"判据（真字的笔画在自己这块里结束 ✓，
      //   线交叉的假芽在框外还接着墨 ✗），想救**直笔画字**（H、E、F、N… 以及基准台那 5 段直线拼的字 ✗）。
      //   实测：基准台标注数一个没多（40/61 ✗），反而把 user2 的 11 变成 12 ✗（多认一个假字 ✗）→ **回退** ✗。
      if (core.length < 12) return (log('✗ 丢掉细长条后不剩什么（' + pieces + ' 块）'), false)
      let dx0 = W, dy0 = H, dx1 = -1, dy1 = -1
      for (const i of core) {
        const px = i % W, py = (i / W) | 0
        if (px < dx0) dx0 = px
        if (py < dy0) dy0 = py
        if (px > dx1) dx1 = px
        if (py > dy1) dy1 = py
      }
      const bw = dx1 - dx0 + 1, bh = dy1 - dy0 + 1
      const dbgTail = ' 字芯 ' + core.length + 'px ' + bw + 'x' + bh + ' fill=' + (core.length / (bw * bh)).toFixed(2)
      if (Math.hypot(bw, bh) > R * 1.15) return (log('✗ 字芯框太大 ' + dbgTail), false)        // 太大 = 不是字
      if (bh < minH) return (log('✗ 太矮 ' + dbgTail + ' < ' + minH.toFixed(1)), false)          // 太矮 = 虚线短划/碎屑
      if (core.length / (bw * bh) < fillMin) return (log('✗ 太空 ' + dbgTail), false)            // 太空 = 线网
      let tips = 0, fork = false
      for (const p of budPix) {
        const px = p % W, py = (p / W) | 0
        let k = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue
            const nx = px + dx, ny = py + dy
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
            const j = ny * W + nx
            if (sk[j] && budSet.has(j)) k++
          }
        }
        if (k <= 1) tips++
        if (k >= 3) fork = true
      }
      if (tips < 1 && !fork) return (log('✗ 没端头也不分叉 ' + dbgTail), false)   // 没端头也不分叉 = 一段线
      // ④ 落地：记成字母块（**只记字芯** ✓ —— 捎带进来的那截线不算这个字的墨迹）
      let sx = 0, sy = 0
      for (const i of core) { if (cut) out[i] = 0; sx += i % W; sy += (i / W) | 0 }
      anchors.push({ x: sx / core.length, y: sy / core.length, pix: core, x0: dx0, y0: dy0, x1: dx1, y1: dy1 })
      log('✓ 收下' + dbgTail)
      return true
    }

    // ① 交叉点上的芽：字母**压在**线上（骨架接上了）→ 接触点必是度 ≥3 的节点 ✓
    for (let v = 0; v < G.nodes.length; v++) {
      if (deg[v] < 3) continue
      const Jx = G.nodes[v].cx, Jy = G.nodes[v].cy
      const seenP = new Set<number>()
      const stack: [number, number][] = []
      for (const pi of inc[v]) stack.push([pi, v])
      const budPix: number[] = []
      let escape = 0
      while (stack.length) {
        const [pi, from] = stack.pop() as [number, number]
        if (seenP.has(pi)) continue
        seenP.add(pi)
        const P = G.paths[pi]
        let dmax = 0
        for (const q of P.pts) { const d = Math.hypot(q[0] - Jx, q[1] - Jy); if (d > dmax) dmax = d }
        if (dmax > R) { escape++; continue }           // 出圈 = 图形线，到此为止
        for (const q of P.pts) budPix.push(q[1] * W + q[0])
        const far = P.aId === from ? P.bId : P.aId
        if (far >= 0 && far !== v) for (const qi of inc[far]) if (qi !== pi) stack.push([qi, far])
      }
      // 一条引出线都没有 = 本来就孤立（stripText 已经管过）→ 不在这儿重复下刀
      if (!escape || !budPix.length) continue
      if (tryPeel(budPix, '①#' + v + '(' + Jx.toFixed(0) + ',' + Jy.toFixed(0) + ')')) found++
    }

    // ② 没有交叉点的骨架块：字母只是**挨着**线（骨架其实没接上）—— 实测真题图里的 S、h 都是这种 ✗
    //    （二值图上它们和线是同一个连通域 ✓，细化的过程中连接断掉了 ✓，于是骨架里是一块"孤岛"。）
    //    这类孤岛里既有字母，也有虚线的短划、被切掉的线段 —— 用同一套"像不像字"的判据筛 ✓。
    //    ⚠ 要按**连通块**整体判：h = 竖 + 拱 + 腿，在图上就是三条自由路径，单独一条会被当成"细长条"漏掉 ✗。
    const uf = new Int32Array(G.nodes.length)
    for (let i = 0; i < uf.length; i++) uf[i] = i
    const ufFind = (x: number): number => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x] } return x }
    for (const P of G.paths) {
      if (P.aId < 0 || P.bId < 0) continue
      const ra = ufFind(P.aId), rb = ufFind(P.bId)
      if (ra !== rb) uf[rb] = ra
    }
    const groups = new Map<number, number[]>()
    G.paths.forEach((P, i) => {
      const key = P.aId >= 0 ? ufFind(P.aId) : P.bId >= 0 ? ufFind(P.bId) : -1 - i
      const g = groups.get(key)
      if (g) g.push(i)
      else groups.set(key, [i])
    })
    const cand: { pix: number[]; x0: number; y0: number; x1: number; y1: number }[] = []
    for (const plist of groups.values()) {
      // 块里有交叉点 = 线网的一部分（该走 ① 或根本不该动）
      let forkNode = false
      for (const pi of plist) {
        const P = G.paths[pi]
        if (P.aId >= 0 && deg[P.aId] >= 3) forkNode = true
        if (P.bId >= 0 && deg[P.bId] >= 3) forkNode = true
      }
      if (forkNode) continue
      const pix: number[] = []
      let cx0 = W, cy0 = H, cx1 = -1, cy1 = -1
      for (const pi of plist) {
        for (const q of G.paths[pi].pts) {
          const i = q[1] * W + q[0]
          pix.push(i)
          if (q[0] < cx0) cx0 = q[0]
          if (q[1] < cy0) cy0 = q[1]
          if (q[0] > cx1) cx1 = q[0]
          if (q[1] > cy1) cy1 = q[1]
        }
      }
      if (pix.length) cand.push({ pix, x0: cx0, y0: cy0, x1: cx1, y1: cy1 })
    }
    // ⚠ 再把**挨在一起的**块并成一个候选：h 这种字在骨架上就是"竖 + 拱 + 腿"几条**互不相连**的自由路径 ✓，
    //   单独一条会被当成"细长条（笔画）"漏掉 ✗。并起来之后才是一个字的大小与形状 ✓。
    //   块间距 ≤ 3px 才算挨着 —— 虚线的短划彼此隔 4px 以上，不会被并进来 ✓。
    const guf = new Int32Array(cand.length)
    for (let i = 0; i < guf.length; i++) guf[i] = i
    const gFind = (x: number): number => { while (guf[x] !== x) { guf[x] = guf[guf[x]]; x = guf[x] } return x }
    const gap = (a: typeof cand[number], b: typeof cand[number]) => {
      const dx = Math.max(0, Math.max(a.x0 - b.x1, b.x0 - a.x1))
      const dy = Math.max(0, Math.max(a.y0 - b.y1, b.y0 - a.y1))
      return Math.max(dx, dy)
    }
    // ⚠ 并块必须**有上限**：只按"间距 ≤3px"并，虚线的短划会一节一节把图形串成一块 ✗
    //   （实测 user7 并出了 328×403 的巨块，真正的字母 N 就永远轮不到被判定 ✗✗）。
    //   并出来的外框一旦超过"一个字的大小"就说明这是在并线、不是在并笔画 ✓ —— 停手 ✓。
    const mergeCap = R * 1.25
    for (let i = 0; i < cand.length; i++) {
      for (let j = i + 1; j < cand.length; j++) {
        if (gap(cand[i], cand[j]) > 3) continue
        const ra = gFind(i), rb = gFind(j)
        if (ra === rb) continue
        const a = cand[i], b = cand[j]
        const w = Math.max(a.x1, b.x1) - Math.min(a.x0, b.x0) + 1
        const h = Math.max(a.y1, b.y1) - Math.min(a.y0, b.y0) + 1
        if (Math.hypot(w, h) > mergeCap) continue
        guf[rb] = ra
      }
    }
    const merged = new Map<number, number[]>()
    cand.forEach((c, i) => {
      const k = gFind(i)
      const g = merged.get(k)
      if (g) g.push(...c.pix)
      else merged.set(k, c.pix.slice())
    })
    for (const seed of merged.values()) if (tryPeel(seed, '②孤岛')) found++
    // 这一轮如果真删了墨迹，骨架/图就作废了（下一轮本来也会重算 ✓）；没删就能直接交给调用方复用 ✓
    lastSk = found && cut ? undefined : sk
    lastG = found && cut ? undefined : G
    if (!found) break
  }
  return { ink: out, anchors, buds: anchors.length, sk: lastSk, G: lastG }
}


/* ---------- 【v1524】字母计数器：这张图里到底有几个标注 ---------- */

/**
 * 数"这张图里有几个标注"（= 用户的想法：**顶点数 = 字母个数** ✓）。
 *
 * 为什么单靠"被抹掉的小块个数"不行 ✗：一个标注会被拆成好几块 ——
 *   · 下标（C₁ 的 1）本来就是独立小块 ✓；
 *   · 被图形线穿过的字，会被切成两半 ✓；
 *   · 虚线的短划、墨点碎屑也混在同一个列表里 ✗。
 *
 * 三步（都是尺度无关的 ✓）：
 *   ① 丢掉不像字的块：墨迹太少（<12px）的碎屑、**细长条**（虚线的短划 = 一条线 ✓）；
 *   ② 按**字号分档**：高度 ≥ 0.75×最大字高的算"正文号"，矮一档的是下标/上标 ✓
 *      —— 教材图里同一个图只有一种字号，这一刀把下标和碎屑挡在计数之外 ✓；
 *   ③ **下标配对**：与某个正文号"水平缝 ≤ 0.5×字高、中心高度差 ≤ 0.75×字高"的小块并进同一个标注 ✓
 *      （与 glyphOcr.groupBoxes 同一套几何，两处口径一致 ✓）。
 *
 * 返回的 `n` 就是"这张图该有几个点"的目标值 ✓（交给 pruneToLabels 用）。
 * ⚠ 前提是**每个顶点都有字母** ✓ —— 实测有图不满足（图里有没标注的顶点，见 docs/矢量描摹-诊断.md · v1524 ✗），
 *   所以它不是"真值"，只是一个**上界/参考值**：剪顶点时只剪"没有字母撑腰"的那些 ✓。
 */
export function countLabels(blobs: LetterBlob[], W: number): { n: number; bodyH: number; bodies: LetterBlob[] } {
  const boxes = blobs.filter((b) => b.pix.length >= 12 && !isBarLike(b, W))
  if (!boxes.length) return { n: 0, bodyH: 0, bodies: [] }
  const hOf = (b: LetterBlob) => b.y1 - b.y0 + 1
  const bodyH = boxes.reduce((m, b) => Math.max(m, hOf(b)), 0)
  const bodyMin = 0.75 * bodyH
  const bodies = boxes.filter((b) => hOf(b) >= bodyMin)
  // 并标注（下标配对 / 被线切开的同一个字）：并查集，几何与 glyphOcr.groupBoxes 一致 ✓
  const parent = boxes.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j]
      const H = Math.max(hOf(a), hOf(b))
      const gap = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1)
      if (gap > 0.5 * H) continue
      const cyA = (a.y0 + a.y1) / 2, cyB = (b.y0 + b.y1) / 2
      if (Math.abs(cyA - cyB) > 0.75 * H) continue
      const ra = find(i), rb = find(j)
      if (ra !== rb) parent[rb] = ra
    }
  }
  // 一个标注 = 一组；**只有含正文号的组才算**（孤零零的下标/碎屑不算一个点 ✓）
  const bodyIdx = new Set(bodies.map((b) => boxes.indexOf(b)))
  const groups = new Set<number>()
  for (let i = 0; i < boxes.length; i++) {
    if (!bodyIdx.has(i)) continue
    groups.add(find(i))
  }
  return { n: groups.size, bodyH, bodies }
}

// ---------- Zhang-Suen 细化 ----------
export function thin(src: Uint8Array, W: number, H: number) {
  const w = W + 2, h = H + 2
  const img = new Uint8Array(w * h)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) img[(y + 1) * w + (x + 1)] = src[y * W + x]
  let changed = true, guard = 0
  while (changed && guard++ < 60) {
    changed = false
    for (let step = 0; step < 2; step++) {
      const del: number[] = []
      for (let yy = 1; yy < h - 1; yy++) {
        for (let xx = 1; xx < w - 1; xx++) {
          const i = yy * w + xx
          if (!img[i]) continue
          const p2 = img[i - w], p3 = img[i - w + 1], p4 = img[i + 1], p5 = img[i + w + 1],
                p6 = img[i + w], p7 = img[i + w - 1], p8 = img[i - 1], p9 = img[i - w - 1]
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (B < 2 || B > 6) continue
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
          let A = 0
          for (let q = 0; q < 8; q++) if (seq[q] === 0 && seq[q + 1] === 1) A++
          if (A !== 1) continue
          if (step === 0) { if (p2 * p4 * p6 || p4 * p6 * p8) continue }
          else { if (p2 * p4 * p8 || p2 * p6 * p8) continue }
          del.push(i)
        }
      }
      if (del.length) { changed = true; for (const i of del) img[i] = 0 }
    }
  }
  const out = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + x] = img[(y + 1) * w + (x + 1)]
  return out
}

// ---------- 骨架 → 节点 + 路径 ----------
/** 岔路判定用"交叉数"：8 邻域绕一圈 0→1 的次数，路径点恒为 2、端点 1、三岔 3。
 *  不能用"邻域分组数"——斜线的台阶点（W 与 S 互为 8 邻）会被算成 1 组，于是整条斜线
 *  每个台阶都成了岔路口，一条直线被切成十几段。 */
function crossNum(sk: Uint8Array, p: number, W: number, H: number) {
  const x = p % W, y = (p / W) | 0
  const s = [0, 0, 0, 0, 0, 0, 0, 0]
  const dxs = [0, 1, 1, 1, 0, -1, -1, -1], dys = [-1, -1, 0, 1, 1, 1, 0, -1]
  for (let q = 0; q < 8; q++) {
    const xx = x + dxs[q], yy = y + dys[q]
    if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
    if (sk[yy * W + xx]) s[q] = 1
  }
  let a = 0
  for (let q = 0; q < 8; q++) if (s[q] === 0 && s[(q + 1) % 8] === 1) a++
  return a
}

interface SkGraph { nodes: { cx: number; cy: number }[]; paths: { pts: [number, number][]; aId: number; bId: number }[]; stubs: Int32Array }

export function buildGraph(sk: Uint8Array, W: number, H: number): SkGraph {
  const nbrs = (i: number) => {
    const x = i % W, y = (i / W) | 0, a: number[] = []
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const j = ny * W + nx
      if (sk[j]) a.push(j)
    }
    return a
  }
  const pix: number[] = []
  for (let i = 0; i < W * H; i++) if (sk[i]) pix.push(i)
  const isNode = new Uint8Array(W * H)
  for (const p of pix) if (crossNum(sk, p, W, H) !== 2) isNode[p] = 1
  const nodeId = new Int32Array(W * H).fill(-1)
  const nodes: { cx: number; cy: number }[] = []
  for (const s of pix) {
    if (!isNode[s] || nodeId[s] >= 0) continue
    const id = nodes.length
    const stack = [s], members: number[] = []
    nodeId[s] = id
    while (stack.length) {
      const j = stack.pop() as number
      members.push(j)
      for (const k of nbrs(j)) if (isNode[k] && nodeId[k] < 0) { nodeId[k] = id; stack.push(k) }
    }
    let sx = 0, sy = 0
    for (const m of members) { sx += m % W; sy += (m / W) | 0 }
    nodes.push({ cx: sx / members.length, cy: sy / members.length })
  }
  const usedPix = new Uint8Array(W * H)
  /** 邻域按"彼此 8 相邻"分组；优先走别的一组，实在没有才在 prev 那组里继续（骨架局部 2px 宽） */
  const groupNeighbors = (N: number[]) => {
    const n = N.length, seen = new Array(n).fill(false), out: number[][] = []
    for (let i = 0; i < n; i++) {
      if (seen[i]) continue
      const stack = [i], grp: number[] = []
      seen[i] = true
      while (stack.length) {
        const k = stack.pop() as number
        grp.push(N[k])
        const ax = N[k] % W, ay = (N[k] / W) | 0
        for (let j = 0; j < n; j++) {
          if (seen[j]) continue
          const bx = N[j] % W, by = (N[j] / W) | 0
          if (Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1) { seen[j] = true; stack.push(j) }
        }
      }
      out.push(grp)
    }
    return out
  }
  const nextPixel = (cur: number, prev: number) => {
    const gs = groupNeighbors(nbrs(cur))
    let gi = -1
    for (let i = 0; i < gs.length; i++) for (const q of gs[i]) if (q === prev) gi = i
    for (let i = 0; i < gs.length; i++) {
      if (i === gi) continue
      for (const q of gs[i]) if (!usedPix[q]) return q
    }
    if (gi >= 0) for (const q of gs[gi]) if (q !== prev && !usedPix[q]) return q
    return -1
  }
  const paths: SkGraph['paths'] = []
  for (const start of pix) {
    if (!isNode[start]) continue
    for (const grp of groupNeighbors(nbrs(start))) {
      let first = -1
      for (const q of grp) if (!usedPix[q]) { first = q; break }
      if (first < 0 || isNode[first]) continue
      const pts: [number, number][] = [[start % W, (start / W) | 0]]
      let prev = start, cur = first, guard = 0
      usedPix[first] = 1
      while (guard++ < 500000) {
        pts.push([cur % W, (cur / W) | 0])
        if (isNode[cur]) break
        const nx = nextPixel(cur, prev)
        if (nx < 0) break
        usedPix[nx] = 1; prev = cur; cur = nx
      }
      const last = pts[pts.length - 1]
      const lastPix = last[1] * W + last[0]
      paths.push({ pts, aId: nodeId[start], bId: isNode[lastPix] ? nodeId[lastPix] : -1 })
    }
  }
  // ---- 补追：第一遍只从节点出发，追到局部变宽/变细的地方会提前断头，剩下的骨架就没人管了。
  // 实测用户那张带半椭圆的图：骨架 2140 像素里 **803 个（38%）不属于任何路径**，范围正好是半椭圆，
  // 于是整条弧凭空消失。这里从没被走过的骨架像素继续往两头追。
  for (const s of pix) {
    if (usedPix[s] || isNode[s]) continue
    const sxy: [number, number] = [s % W, (s / W) | 0]
    const back: [number, number][] = []
    const fwd: [number, number][] = []
    for (const dir of [0, 1]) {
      let prev = s, cur = s, guard = 0
      while (guard++ < 500000) {
        const nx = nextPixel(cur, prev)
        if (nx < 0) break
        usedPix[nx] = 1
        ;(dir ? fwd : back).push([nx % W, (nx / W) | 0])
        prev = cur; cur = nx
        if (isNode[cur]) break
      }
    }
    back.reverse()
    const pts = back.concat([sxy], fwd)
    if (pts.length < 2) continue
    const head = pts[0], tail = pts[pts.length - 1]
    paths.push({
      pts,
      aId: isNode[head[1] * W + head[0]] ? nodeId[head[1] * W + head[0]] : -1,
      bId: isNode[tail[1] * W + tail[0]] ? nodeId[tail[1] * W + tail[0]] : -1,
    })
  }

  // ---- 把"顺路"的两条路径在度 2 节点处接起来 ----
  // 细曲线（椭圆、弧）在对角方向会形成 2x2 阶梯像素块，那些像素的交叉数不是 2 → 被判成节点，
  // 于是**整条曲线被切成几十段几十像素的小路径**（实测椭圆变成 45 段 <40px）。
  // 小段之间又天然不共线，进不了后面的"虚线成链"，最后整条弧都画不出来。
  // 这里把方向连续的两条接回一条：接点在中间、两边各只有一个通路时才接，真拐点（角度 > ~25°）不接。
  const dirOut = (p: SkGraph['paths'][number], end: 'a' | 'b', k = 4): [number, number] => {
    const n = p.pts.length
    const i0 = end === 'a' ? 0 : n - 1
    const i1 = end === 'a' ? Math.min(k, n - 1) : Math.max(0, n - 1 - k)
    const dx = p.pts[i0][0] - p.pts[i1][0], dy = p.pts[i0][1] - p.pts[i1][1]
    const L = Math.hypot(dx, dy) || 1
    return [dx / L, dy / L]
  }
  for (let guard = 0; guard < 4000; guard++) {
    const at = new Map<number, { pi: number; end: 'a' | 'b'; dir: [number, number] }[]>()
    paths.forEach((p, pi) => {
      if (p.aId >= 0) { const g = at.get(p.aId) || []; g.push({ pi, end: 'a', dir: dirOut(p, 'a') }); at.set(p.aId, g) }
      if (p.bId >= 0) { const g = at.get(p.bId) || []; g.push({ pi, end: 'b', dir: dirOut(p, 'b') }); at.set(p.bId, g) }
    })
    let done = false
    for (const [, list] of at) {
      if (list.length !== 2) continue
      const [x, y] = list
      if (x.pi === y.pi) continue
      if (x.dir[0] * y.dir[0] + x.dir[1] * y.dir[1] > -0.9) continue   // 夹角 > ~25°：是真拐点，不接
      const A = paths[x.pi], B = paths[y.pi]
      const first = x.end === 'b' ? A.pts : A.pts.slice().reverse()
      const second = y.end === 'a' ? B.pts : B.pts.slice().reverse()
      const aId = x.end === 'b' ? A.aId : A.bId
      const bId = y.end === 'a' ? B.bId : B.aId
      paths[x.pi] = { pts: first.concat(second.slice(1)), aId, bId }
      paths.splice(y.pi, 1)
      done = true
      break
    }
    if (!done) break
  }

  // 只有"引出 >= 2 条路径"的节点才算顶点；度 1 的节点是自由端（短划的端头、线的断头）
  const stubs = new Int32Array(nodes.length)
  for (const p of paths) { stubs[p.aId]++; if (p.bId >= 0) stubs[p.bId]++ }
  for (const p of paths) {
    if (p.aId >= 0 && stubs[p.aId] < 2) p.aId = -1
    if (p.bId >= 0 && stubs[p.bId] < 2) p.bId = -1
  }
  return { nodes, paths, stubs }
}

// ---------- Douglas-Peucker ----------
export function rdp(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length < 3) return pts.slice()
  const dist = (p: [number, number], a: [number, number], b: [number, number]) => {
    const vx = b[0] - a[0], vy = b[1] - a[1]
    const len2 = vx * vx + vy * vy
    if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
    let t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy))
  }
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [i0, i1] = stack.pop() as [number, number]
    let best = -1, bd = eps
    for (let i = i0 + 1; i < i1; i++) {
      const dd = dist(pts[i], pts[i0], pts[i1])
      if (dd > bd) { bd = dd; best = i }
    }
    if (best > 0) { keep[best] = 1; stack.push([i0, best]); stack.push([best, i1]) }
  }
  const out: [number, number][] = []
  for (let j = 0; j < pts.length; j++) if (keep[j]) out.push(pts[j])
  return out
}

function plen(pts: [number, number][]) {
  let L = 0
  for (let i = 0; i + 1 < pts.length; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
  return L
}

// ---------- 主流程 ----------

/** 识别框的四条边上有没有墨迹（用抹掉字母之后的墨迹量，字母贴边不算问题，线条被切断才是） */
function clippedEdges(ink: Uint8Array, W: number, box: [number, number, number, number]) {
  const [x0, y0, x1, y1] = box
  let top = 0, bottom = 0, left = 0, right = 0
  for (let x = x0; x < x1; x++) {
    if (ink[y0 * W + x]) top++
    if (ink[(y1 - 1) * W + x]) bottom++
  }
  for (let y = y0; y < y1; y++) {
    if (ink[y * W + x0]) left++
    if (ink[y * W + x1 - 1]) right++
  }
  return { top, bottom, left, right }
}

/**
 * 【v1518】几何规整：把"该平行 / 该直角 / 该等长 / 该是 45° 倍数"的关系变成**精确**的 ✓
 *
 * 起因（老师问"怎么进一步提高准确度"）：顶点落在墨迹上、拓扑也对得住，但**几何关系是歪的** ✗ ——
 * 手画 / 扫描 / 压缩都会让"该平行的差 1°、该直角的 89°、该等长的差 6%"。
 * 立体几何插图 99% 是理想图（斜二测：水平 / 45° / 竖直 + 平行 + 等长 ✓），这些关系本来就能量出来 ✓。
 *
 * 做法：从**测量到的**几何关系里挑出明显成立的那些当约束，再用阻尼投影（PBD 风格）：
 *   每轮 = 满足约束（转角度 / 调长度）→ 再往原位置拉一把（数据项）→ 限位。
 * 三条安全线（免得把"本来就不规则"的示意图硬掰直 ✗）：
 *   · 只在偏差 ≤ 容差时才吸（容差可调、可整组关闭 ✓）；
 *   · 每个顶点离原位置不超过 snapMax（默认 3% 对角线 ✓）；
 *   · 贴在拟合弧上的顶点**冻住**（弧的圆心/半径是拟合出来的，动了会脱开 ✗）；
 *   · 等长只在**同一平行组内部**做（三角形两条边碰巧等长不会被硬掰 ✓）。
 */
function snapGeometry(
  verts: { x: number; y: number }[],
  outEdges: [number, number, number][],
  diag: number,
  opt: VectorizeOpt,
  arcs: { cx: number; cy: number; rx: number; ry: number; a0: number; a1: number }[],
) {
  if ((opt.snapGeo ?? 1) === 0) return
  const D2R = Math.PI / 180
  const dirTol = (opt.snapDir ?? 4) * D2R        // 方向吸附（45° 倍数）—— 默认值由基准台扫出来 ✓
  const parTol = (opt.snapPar ?? 4.5) * D2R      // 判平行 —— 4.5° 是基准台上「几何误差最小、位置误差不涨」的那个点 ✓
  const perpTol = (opt.snapRt ?? 5) * D2R        // 判直角
  const eqTol = opt.snapEq ?? 0.1                // 判等长（比值）
  const iter = Math.max(1, Math.round(opt.snapIter ?? 16))
  const pull = opt.snapPull ?? 0.25
  const maxMove = (opt.snapMax ?? 0.03) * diag
  const minLen = 0.02 * diag                     // 太短的边方向估计没意义 → 不参与约束

  const angDiff = (a: number, b: number) => {
    let d = Math.abs(a - b) % (2 * Math.PI)
    if (d > Math.PI) d = 2 * Math.PI - d
    return d
  }

  // ① 冻住"贴在弧上"的顶点 ✓
  const frozen: boolean[] = verts.map(() => false)
  for (const a of arcs) {
    const rx = Math.max(1e-6, a.rx), ry = Math.max(1e-6, a.ry)
    const norm = (t: number) => { let r = t % (2 * Math.PI); if (r < 0) r += 2 * Math.PI; return r }
    const span = norm(a.a1 - a.a0)
    for (let i = 0; i < verts.length; i++) {
      const u = (verts[i].x - a.cx) / rx, v = (verts[i].y - a.cy) / ry
      const q = Math.hypot(u, v)
      if (Math.abs(q - 1) * Math.min(rx, ry) > 2.5) continue
      if (span > Math.PI * 1.99 || norm(Math.atan2(v, u) - a.a0) <= span + 0.2) frozen[i] = true
    }
  }

  // ② 边表
  const es: { i: number; j: number; th: number; len: number; target?: number; group?: number }[] = []
  for (const e of outEdges) {
    if (e[0] === e[1]) continue
    if (frozen[e[0]] || frozen[e[1]]) continue
    const dx = verts[e[1]].x - verts[e[0]].x, dy = verts[e[1]].y - verts[e[0]].y
    const len = Math.hypot(dx, dy)
    if (len < minLen) continue
    es.push({ i: e[0], j: e[1], th: Math.atan2(dy, dx), len })
  }
  if (es.length < 3) return

  // ③ 平行分组（按角度排序后**线性聚类**：簇内最大角差 ≤ parTol ✓
  //     —— 不能用"传递闭包"式并查集：A≈B、B≈C 会把整张图并成一组 ✗）
  const order = es.map((e, k) => ({ k, th: e.th })).sort((a, b) => a.th - b.th)
  const clusters: number[][] = []
  for (const o of order) {
    const last = clusters[clusters.length - 1]
    if (last && angDiff(es[o.k].th, es[last[0]].th) <= parTol) last.push(o.k)
    else clusters.push([o.k])
  }
  if (clusters.length > 1) {   // 首尾两簇其实是同一方向（±π 接缝）✓
    const f = clusters[0], l = clusters[clusters.length - 1]
    if (angDiff(es[f[0]].th, es[l[0]].th) <= parTol) { clusters[0] = l.concat(f); clusters.pop() }
  }
  clusters.forEach((cl, gi) => {
    let sx = 0, sy = 0, sw = 0
    for (const k of cl) { const w = es[k].len; sx += w * Math.cos(2 * es[k].th); sy += w * Math.sin(2 * es[k].th); sw += w }
    void sw
    let t = 0.5 * Math.atan2(sy, sx)
    if (cl.length === 1) {
      // 孤立边：只做"45° 倍数"吸附（斜二测先验 ✓），不在倍数附近就完全不碰 ✓
      const step = Math.PI / 4
      const near = Math.round(t / step) * step
      if (angDiff(t, near) <= dirTol) { es[cl[0]].target = near; es[cl[0]].group = gi }
      return
    }
    const step = Math.PI / 4
    const near = Math.round(t / step) * step
    if (angDiff(t, near) <= dirTol) t = near      // 整簇贴近 45° 倍数 → 直接用那个倍数 ✓
    for (const k of cl) { es[k].target = t; es[k].group = gi }
  })

  // ④ 等长分组（只在同一平行组内 ✓）
  const lenGroups: { members: number[]; target: number }[] = []
  for (const cl of clusters) {
    if (cl.length < 2) continue
    const sorted = cl.slice().sort((a, b) => es[a].len - es[b].len)
    let cur: number[] = []
    const flush = () => { if (cur.length > 1) lenGroups.push({ members: cur, target: 0 }) }
    for (const k of sorted) {
      if (!cur.length || es[k].len / es[cur[0]].len - 1 <= eqTol) cur.push(k)
      else { flush(); cur = [k] }
    }
    flush()
  }
  for (const g of lenGroups) {
    let sw = 0, sl = 0
    for (const k of g.members) { const w = es[k].len; sw += w; sl += w * es[k].len }
    g.target = sl / sw       // 按边长加权（长边更可信 ✓）
  }

  // ⑤ 直角约束：共享顶点的两条边夹角接近 90° → 让**短的那条**垂直于长的那条 ✓（绕共享顶点转，接头不动 ✓）
  const inc: number[][] = verts.map(() => [])
  es.forEach((e, k) => { inc[e.i].push(k); inc[e.j].push(k) })
  const perps: { k: number; ref: number; shared: number }[] = []
  for (const list of inc) {
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const k1 = list[a], k2 = list[b]
      if (es[k1].group !== undefined && es[k1].group === es[k2].group) continue   // 平行的两条不可能垂直 ✓
      const d = angDiff(es[k1].th, es[k2].th)
      if (Math.abs(d - Math.PI / 2) > perpTol) continue
      const ref = es[k1].len >= es[k2].len ? k1 : k2
      const mov = ref === k1 ? k2 : k1
      const shared = es[k1].i === es[k2].i || es[k1].i === es[k2].j ? es[k1].i : es[k1].j
      perps.push({ k: mov, ref, shared })
    }
  }

  // ⑥ 阻尼投影迭代
  const p0 = verts.map((v) => ({ x: v.x, y: v.y }))
  const clampMove = () => {
    for (let i = 0; i < verts.length; i++) {
      if (frozen[i]) continue
      const dx = verts[i].x - p0[i].x, dy = verts[i].y - p0[i].y
      const d = Math.hypot(dx, dy)
      if (d > maxMove) { verts[i].x = p0[i].x + (dx * maxMove) / d; verts[i].y = p0[i].y + (dy * maxMove) / d }
    }
  }
  const rotEdge = (k: number, target: number, about: number | 'mid', factor: number) => {
    const e = es[k]
    const ax = verts[e.i].x, ay = verts[e.i].y, bx = verts[e.j].x, by = verts[e.j].y
    const cur = Math.atan2(by - ay, bx - ax)
    let d = target - cur
    while (d > Math.PI / 2) d -= Math.PI
    while (d < -Math.PI / 2) d += Math.PI
    d *= factor
    if (Math.abs(d) < 1e-4) return
    const cx = about === 'mid' ? (ax + bx) / 2 : verts[about].x
    const cy = about === 'mid' ? (ay + by) / 2 : verts[about].y
    const c = Math.cos(d), s2 = Math.sin(d)
    const rot = (x: number, y: number): [number, number] => {
      const dx = x - cx, dy = y - cy
      return [cx + dx * c - dy * s2, cy + dx * s2 + dy * c]
    }
    const [nax, nay] = rot(ax, ay), [nbx, nby] = rot(bx, by)
    if (Math.hypot(nbx - nax, nby - nay) < minLen * 0.5) return   // 别把边转没了 ✓
    if (!frozen[e.i]) { verts[e.i].x = nax; verts[e.i].y = nay }
    if (!frozen[e.j]) { verts[e.j].x = nbx; verts[e.j].y = nby }
    e.th = target
  }
  const setLen = (k: number, target: number, factor: number) => {
    const e = es[k]
    const ax = verts[e.i].x, ay = verts[e.i].y, bx = verts[e.j].x, by = verts[e.j].y
    const len = Math.hypot(bx - ax, by - ay)
    if (len < 1e-6) return
    if (len < minLen * 0.5 && target < len) return
    const s = 1 + (target / len - 1) * factor
    const mx = (ax + bx) / 2, my = (ay + by) / 2
    if (!frozen[e.i]) { verts[e.i].x = mx + (ax - mx) * s; verts[e.i].y = my + (ay - my) * s }
    if (!frozen[e.j]) { verts[e.j].x = mx + (bx - mx) * s; verts[e.j].y = my + (by - my) * s }
    e.len = Math.hypot(verts[e.j].x - verts[e.i].x, verts[e.j].y - verts[e.i].y)
  }
  for (let it = 0; it < iter; it++) {
    for (let i = 0; i < verts.length; i++) {
      if (frozen[i]) continue
      verts[i].x += pull * (p0[i].x - verts[i].x)
      verts[i].y += pull * (p0[i].y - verts[i].y)
    }
    for (let k = 0; k < es.length; k++) if (es[k].target !== undefined) rotEdge(k, es[k].target as number, 'mid', 0.6)
    for (const g of lenGroups) for (const k of g.members) setLen(k, g.target, 0.5)
    for (const p of perps) rotEdge(p.k, es[p.ref].th + Math.PI / 2, p.shared, 0.5)
    clampMove()
  }
}

function vectorizeFromInk(m: { ink: Uint8Array; W: number; H: number; box: [number, number, number, number] }, opt: VectorizeOpt = {}): VectorizeResult {
  const W = m.W, H = m.H, box = m.box
  const diag = Math.hypot(box[2] - box[0], box[3] - box[1])
  const comp = components(m.ink, W, H, box)
  const st = stripText(comp, W, diag, m.ink, opt)
  // 【v1523】第二刀：把**贴着线的字母**从图形线里切出来（stripText 只认孤立小块 ✗，见 peelLabels）
  const sk0 = thin(st.ink, W, H)
  const G0 = buildGraph(sk0, W, H)
  const peel = (opt.labelPeel ?? 1) !== 0
    ? peelLabels(st.ink, W, H, diag, opt, st.anchors, { sk: sk0, G: G0 })
    : { ink: st.ink, anchors: [] as LetterBlob[], buds: 0, sk: sk0, G: G0 }
  // 切完再扫一遍：分离出来的字母常留下碎片（笔画残端、衬线），不扫掉它们又会变成顶点 ✗
  let letters = st.anchors.concat(peel.anchors)
  let ink = peel.ink
  let textN = st.textCount
  // ⚠ 切完**不要**再跑一遍 stripText：切掉字母会让原来"成链"的短划散开，
  //   第二遍就会把散开的短划当字母抹掉 ✗（实测 1-原图 一条虚线被吃掉 → 顶点 10→8 ✗✗）。
  //   残留的碎片交给后面的 spur 剪枝与顶点归并处理 ✓。
  if (peel.buds && (opt.labelRescan ?? 0) !== 0) {
    const st2 = stripText(components(peel.ink, W, H, box), W, diag, peel.ink, opt)
    ink = st2.ink
    letters = letters.concat(st2.anchors)
    textN += st2.textCount
  }
  const clipped = opt.crop ? clippedEdges(ink, W, box) : undefined
  // 被抹掉的那些小块其实是字母 —— 顺手认一下（模板匹配，见 glyphOcr.ts）
  const labels = recognizeLabels(W, letters)
  // "字母把线截断了"的补接要用**所有被抹掉的字母块**判位置，不能只认"字形识别成功"的那几个 ✗
  // （识别不出来时那一步等于没做，实测真图上正是它把线留在半路 → 多出一堆悬空顶点 ✗）
  const letterPts = (opt.healByBlob ?? 0) !== 0
    ? letters.map((a) => ({ cx: a.x, cy: a.y }))
    : labels.map((L) => ({ cx: L.cx, cy: L.cy }))
  // 【v1524】字母计数器：这张图有几个标注（下游"按字母数剪顶点"的目标 ✓）
  const labelCount = countLabels(
    letters.concat(st.solid.map((c) => ({ x: c.cx, y: c.cy, pix: c.pix, x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 }))),
    W,
  )
  const sk = peel.sk ?? thin(ink, W, H)
  const G = peel.G ?? buildGraph(sk, W, H)

  const freeA = (p: SkGraph['paths'][number]) => p.aId < 0 && p.bId < 0
  const spur = opt.spur ?? 6
  const paths = G.paths.filter((P) => freeA(P) || (P.aId >= 0 && P.bId >= 0) || plen(P.pts) > spur)

  interface Seg { a: [number, number]; b: [number, number]; len: number; aId: number; bId: number }
  const segs: Seg[] = []
  const maxPiece = (opt.pieceMax ?? 0.115) * diag
  // 曲线（弧、椭圆、圆）单独走一条路：折线一简化就成多段，而**相邻段之间天然不共线**，
  // 塞进下面的"按共线连成虚线链"里每段都会变成孤立的碎片，最后整条弧都画不出来。
  // 判据：这条路径够长、且简化后不止两个点（真直的线简化完就是两点）。
  const curveSegs: Seg[] = []
  /** 拟合成功的椭圆弧（像素坐标，最后统一归一化） */
  const fittedArcs: { cx: number; cy: number; rx: number; ry: number; a0: number; a1: number; dash: 0 | 1 }[] = []
  for (const P of paths) {
    if (P.pts.length < 2) continue
    const poly = rdp(P.pts, opt.eps ?? 2.2)
    let plen2 = 0
    for (let k = 1; k < P.pts.length; k++) plen2 += Math.hypot(P.pts[k][0] - P.pts[k - 1][0], P.pts[k][1] - P.pts[k - 1][1])
    const isCurve = poly.length >= 3 && plen2 > maxPiece
    // 【自动拟合弧：v1374 接回来了】
    // v1142 试过、又因为"图上凭空多画出一段弧"回退掉。这次的差别是**先判定可靠才出弧**：
    //   · 用**原始骨架点**拟合（rdp 之后曲率信息就没了）；
    //   · 弧必须**显著优于直线**（直线 RMS < 3×弧残差）—— 稍弯的直线一律当直线；
    //   · 必须覆盖整条路径（"弧 + 顺势追下去的直线"不出弧）；
    //   · 梯度加权迭代压掉代数拟合在短弧上的系统偏差。
    // 弧代表这条路径时**不再出折线**：折线留着就会与弧重叠 —— 那正是 v1142 看到的"多画一段"。
    // 顶点不受影响：顶点是从骨架图 G.nodes 建的，与出不出折线无关。
    const arc = tryFitArc(P.pts, opt.arcMinSpan ?? 30)
    if (arc) { fittedArcs.push({ cx: arc.cx, cy: arc.cy, rx: arc.rx, ry: arc.ry, a0: arc.a0, a1: arc.a1, dash: 0 }); continue }
    void isCurve
    for (let k = 0; k < poly.length - 1; k++) {
      const a = poly[k], b = poly[k + 1]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (len < 2) continue
      const s = { a, b, len, aId: k === 0 ? P.aId : -1, bId: k === poly.length - 2 ? P.bId : -1 }
      if (isCurve) curveSegs.push(s)
      else segs.push(s)
    }
  }

  // 虚线：两端悬空的短段按共线连成链
  const linkOK = (A: Seg, B: Seg) => {
    let ux = A.b[0] - A.a[0], uy = A.b[1] - A.a[1]
    const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul
    let vx = B.b[0] - B.a[0], vy = B.b[1] - B.a[1]
    const vl = Math.hypot(vx, vy) || 1; vx /= vl; vy /= vl
    if (Math.abs(ux * vx + uy * vy) < 0.985) return false
    const perp = (p: [number, number]) => Math.abs((p[0] - A.a[0]) * -uy + (p[1] - A.a[1]) * ux)
    if (perp(B.a) > 4 || perp(B.b) > 4) return false
    const along = (p: [number, number]) => (p[0] - A.a[0]) * ux + (p[1] - A.a[1]) * uy
    const b0 = along(B.a), b1 = along(B.b)
    const lo = Math.min(b0, b1), hi = Math.max(b0, b1)
    const gap = Math.max(0 - hi, lo - ul)
    return gap <= Math.max(20, 3.5 * Math.max(ul, vl))
  }
  const freeSegs: Seg[] = [], fixedSegs: Seg[] = []
  for (const s of segs) {
    if (s.aId < 0 && s.bId < 0 && s.len <= maxPiece) freeSegs.push(s)
    else fixedSegs.push(s)
  }
  const usedS = new Array(freeSegs.length).fill(false)
  const chains: Seg[][] = [], leftover: Seg[] = []
  for (let f = 0; f < freeSegs.length; f++) {
    if (usedS[f]) continue
    const chain = [freeSegs[f]]
    usedS[f] = true
    let grow = true
    while (grow) {
      grow = false
      for (let g = 0; g < freeSegs.length; g++) {
        if (usedS[g]) continue
        const B = freeSegs[g]
        if (chain.some((A) => linkOK(A, B) || linkOK(B, A))) { chain.push(B); usedS[g] = true; grow = true; break }
      }
    }
    if (chain.length >= 2) chains.push(chain)
    else leftover.push(chain[0])
  }

  // snap：这条边的端点允许吸附到多远的已有顶点上（不给就用全局 snapR）。
  // 虚线链需要更大 —— 链的两端本来就不精确（开头是个缝、或被抹掉的字母截断），
  // 只给 14px 的话会"吸附不上就新建顶点"，于是一条虚线变成一条悬空长线 + 两个多余顶点。
  interface Edge { aId: number; bId: number; a: [number, number]; b: [number, number]; dash: 0 | 1; snap?: number; dir?: [number, number] }
  const edges: Edge[] = []
  // 曲线的每一段都是真边（画出来就是那条弧），不参与"虚线成链"
  for (const s of curveSegs) edges.push({ aId: s.aId, bId: s.bId, a: s.a, b: s.b, dash: 0 })
  for (const s of fixedSegs) edges.push({ aId: s.aId, bId: s.bId, a: s.a, b: s.b, dash: 0 })
  for (const s of leftover) {
    // 只认出一截的短划：它**仍然是虚线**，不能当实线短段画。
    // 之前把它标成 dash:0 又没有吸附半径，结果就是"一小段突兀的实线 + 两端各造一个多余顶点"，
    // 而它本该连成的那条虚线（例如 D–E、C–F 这种只有一两截的短虚线）看着就像没识别出来。
    edges.push({ aId: -1, bId: -1, a: s.a, b: s.b, dash: 1 })
  }
  for (const C of chains) {
    let ux = C[0].b[0] - C[0].a[0], uy = C[0].b[1] - C[0].a[1]
    const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul
    const base = C[0].a
    let best0 = C[0].a, best1 = C[0].b, minT = 1e9, maxT = -1e9
    for (const e of C) {
      for (const q of [e.a, e.b]) {
        const t = (q[0] - base[0]) * ux + (q[1] - base[1]) * uy
        if (t < minT) { minT = t; best0 = q }
        if (t > maxT) { maxT = t; best1 = q }
      }
    }
    // 虚线链的另一头可能离角点很远（原图里那一段虚线被字母/其它线吃掉了），
    // 所以吸附半径给得比实线大得多；靠 dir 上的垂距约束保证不会吸到隔壁那条线上去。
    // ⚠ 吸附半径不得超过链自身的跨度：真正的虚线跨度大，够得着远处的顶点；
    //   而几个杂点凑出来的短链跨度只有十几像素，却拿着 60px 的半径去勾远处的顶点 ——
    //   结果就是凭空多出一条横跨图形的线段。跨度 >= 60px 的链行为完全不变。
    const span = Math.max(0, maxT - minT)
    const sr = Math.min(opt.snapDash ?? 60, Math.max(opt.snapR ?? 14, span))
    edges.push({ aId: -1, bId: -1, a: best0, b: best1, dash: 1, snap: sr, dir: [ux, uy] })
  }

  // 顶点
  const verts: { x: number; y: number }[] = []
  const nodeVert = new Int32Array(G.nodes.length).fill(-1)
  for (let i = 0; i < G.nodes.length; i++) {
    if (G.stubs[i] < 2) continue
    nodeVert[i] = verts.length
    verts.push({ x: G.nodes[i].cx, y: G.nodes[i].cy })
  }
  const snapR = opt.snapR ?? 14
  /** 虚线链端点吸附时允许偏离链所在直线的距离（px） */
  const snapPerp = opt.snapPerp ?? 18
  const nearest = (x: number, y: number, r: number) => {
    let bi = -1, bd = r
    for (let i = 0; i < verts.length; i++) {
      const d = Math.hypot(verts[i].x - x, verts[i].y - y)
      if (d < bd) { bd = d; bi = i }
    }
    return bi
  }
  /** 沿某条直线方向找顶点：除了距离，还要求它基本落在这条线上（垂距小）。
   *  不加这个约束的话，虚线链的端点会吸到"旁边那条线的角点"上 —— 实测会吃掉真顶点、还会把虚实判错。 */
  const nearestOn = (x: number, y: number, r: number, ux: number, uy: number, perp: number) => {
    let bi = -1, bd = r
    for (let i = 0; i < verts.length; i++) {
      const dx = verts[i].x - x, dy = verts[i].y - y
      const d = Math.hypot(dx, dy)
      if (d >= bd) continue
      if (Math.abs(dx * -uy + dy * ux) > perp) continue
      // ⚠ 方向必须真的起作用：候选顶点应落在链端点的**外侧**（沿 dir 继续往外），而不是链自身跨度内。
      //   原实现里 sgn 只进了上面那个垂距的绝对值里 → 符号被吃掉 → 这一条约束等于没有，
      //   于是链两端可能吸到同一个顶点（再被 ai===bi 整条吞掉），或把端点拽回直线内部、凭空多出一个假顶点。
      if (dx * ux + dy * uy < -perp) continue
      bd = d; bi = i
    }
    return bi
  }
  const addV = (x: number, y: number) => { verts.push({ x, y }); return verts.length - 1 }
  let outEdges: [number, number, number][] = []
  for (const E of edges) {
    const sr = E.snap ?? snapR
    // E.a 是链沿 dir 的最小端，E.b 是最大端 —— 各自只能往自己那侧外面延伸
    const pick = (x: number, y: number, sgn: number) =>
      E.dir ? nearestOn(x, y, sr, E.dir[0] * sgn, E.dir[1] * sgn, snapPerp) : nearest(x, y, sr)
    let ai = E.aId >= 0 ? nodeVert[E.aId] : pick(E.a[0], E.a[1], -1)
    const aNew = ai < 0
    if (ai < 0) ai = addV(E.a[0], E.a[1])
    let bi = E.bId >= 0 ? nodeVert[E.bId] : pick(E.b[0], E.b[1], 1)
    const bNew = bi < 0
    if (bi < 0) bi = addV(E.b[0], E.b[1])
    if (ai === bi) continue
    // 两头都没搭上图形 = 自成一段的杂点，且又短 → 整条丢掉（见 dashMinEdge 注释）
    if (E.dash && aNew && bNew && Math.hypot(E.b[0] - E.a[0], E.b[1] - E.a[1]) < (opt.dashMinEdge ?? 80)) continue
    if (Math.hypot(verts[ai].x - verts[bi].x, verts[ai].y - verts[bi].y) < 4) continue
    outEdges.push([ai, bi, E.dash])
  }

  const mergeVerts = (r: number) => {
    let again = true
    while (again) {
      again = false
      outer:
      for (let i = 0; i < verts.length; i++) {
        for (let j = i + 1; j < verts.length; j++) {
          if (Math.hypot(verts[i].x - verts[j].x, verts[i].y - verts[j].y) >= r) continue
          verts[i].x = (verts[i].x + verts[j].x) / 2
          verts[i].y = (verts[i].y + verts[j].y) / 2
          for (const e of outEdges) {
            if (e[0] === j) e[0] = i
            if (e[1] === j) e[1] = i
          }
          verts.splice(j, 1)
          // 删掉一个顶点后，比它大的下标全要前移，否则边会指到不存在的顶点上
          for (const e of outEdges) {
            if (e[0] > j) e[0]--
            if (e[1] > j) e[1]--
          }
          again = true
          break outer
        }
      }
    }
  }
  const dedupe = () => {
    const seenE: Record<string, number> = {}
    const out: [number, number, number][] = []
    for (const E of outEdges) {
      if (E[0] === E[1]) continue
      const key = Math.min(E[0], E[1]) + '_' + Math.max(E[0], E[1])
      if (seenE[key] !== undefined) { if (E[2] === 0) out[seenE[key]][2] = 0; continue }
      seenE[key] = out.length
      out.push(E)
    }
    outEdges = out
  }
  mergeVerts(opt.mergeR ?? 8)
  dedupe()

  // 解消十字交叉：度为 4 且两两反向共线 = 两条线交叉，不是顶点
  // 注意：它必须在 extendDashed() **之后**、并且能重复调用 —— 见文件末尾的说明
  const dissolveCrossings = () => {
  for (let guard = 0; guard < 200; guard++) {
    const inc: number[][] = verts.map(() => [])
    outEdges.forEach((e, i) => { inc[e[0]].push(i); inc[e[1]].push(i) })
    let acted = false
    for (let v = 0; v < verts.length; v++) {
      if (inc[v].length !== 4) continue
      const dirs = inc[v].map((ei) => {
        const E = outEdges[ei]
        const o = E[0] === v ? E[1] : E[0]
        const dx = verts[o].x - verts[v].x, dy = verts[o].y - verts[v].y
        const L = Math.hypot(dx, dy) || 1
        return { ei, o, dx: dx / L, dy: dy / L }
      })
      const pairs: { ei: number; o: number }[][] = []
      const used2 = [false, false, false, false]
      let okAll = true
      for (let a = 0; a < 4; a++) {
        if (used2[a]) continue
        let found = -1
        for (let b = a + 1; b < 4; b++) {
          if (used2[b]) continue
          if (dirs[a].dx * dirs[b].dx + dirs[a].dy * dirs[b].dy < -0.97) { found = b; break }
        }
        if (found < 0) { okAll = false; break }
        used2[a] = used2[found] = true
        pairs.push([dirs[a], dirs[found]])
      }
      if (!okAll) continue
      const dropSet: Record<number, number> = {}
      const add: [number, number, number][] = []
      for (const [p1, p2] of pairs) {
        dropSet[p1.ei] = 1; dropSet[p2.ei] = 1
        add.push([p1.o, p2.o, (outEdges[p1.ei][2] || outEdges[p2.ei][2]) ? 1 : 0])
      }
      const kept = outEdges.filter((_, i) => !dropSet[i]).map((e) => e.slice() as [number, number, number])
      outEdges = kept.concat(add)
      verts.splice(v, 1)
      for (const e of outEdges) {
        if (e[0] > v) e[0]--
        if (e[1] > v) e[1]--
      }
      acted = true
      break
    }
    if (!acted) break
  }
  }
  dissolveCrossings()
  dedupe()
  mergeVerts(opt.mergeR ?? 8)
  dedupe()

  // 【字母切断线的补接】被抹掉的字母会把压在它下面的线切断，于是同一条线上留下两个近邻顶点 ——
  // 多出来的那个就是用户说的"不必要的点"（实测 (157,163)/(176,198)=C₂、(292,466)/(286,486)=A₂）。
  // 判据三条一起用：①两点够近；②**正中间确实有一个被抹掉的字母**；③两点各自都有一条边大致指着对方
  // （同一条线的两截，而不是拐角）。三条都不满足就不接 —— 宁可少接不可错接。
  for (let guard = 0; guard < 80; guard++) {
    let acted = false
    outer2:
    for (let i = 0; i < verts.length; i++) {
      for (let j = i + 1; j < verts.length; j++) {
        const dx = verts[j].x - verts[i].x, dy = verts[j].y - verts[i].y
        const d = Math.hypot(dx, dy)
        if (d < 2 || d > 48) continue
        // 【v1523】①' **至少有一头是"断头"（度 1）** —— 补接要修的正是"线被字母切断、留下两个半截端点"。
        //   两头都是有连线的正常顶点时合并，就是在把两个真顶点粘成一个 ✗（实测 3-人工修正 19→16 ✗、
        //   user1 10→8 ✗）。断头判据把这一整类误合并挡在门外 ✓。
        const degOf = (v: number) => outEdges.reduce((s, E) => s + (E[0] === v || E[1] === v ? 1 : 0), 0)
        if (degOf(i) > 1 && degOf(j) > 1) continue
        const ux = dx / d, uy = dy / d
        // ② 中间要有被抹掉的字母：扫描两点连线上的采样点，任一点靠近某个字母中心即可
        //   （不能只看中点 —— 标签是挂在有字母那一端的，实测中点离字母 35px 以上）
        let hasLabel = false
        for (let k = 2; k <= 8 && !hasLabel; k++) {
          const t = k / 10
          const px2 = verts[i].x + dx * t, py2 = verts[i].y + dy * t
          // 用"字母中心的距离"判，阈值 34px —— 实测这一版在真值集上三项各 +1（76% / 68 / 63），
          // 放到 50px 或用外框判都反而退步（真值 配上边掉到 65、虚实掉到 60）。
          // 代价：棱柱图那对（字母中心离连线 41px）接不上，还得另想办法。
          if (letterPts.some((L) => Math.hypot(L.cx - px2, L.cy - py2) < 34)) hasLabel = true
        }
        if (!hasLabel) continue
        if ((opt.labelDebug ?? 0) !== 0) console.log('[heal] 试接 #' + i + '(' + verts[i].x.toFixed(0) + ',' + verts[i].y.toFixed(0) + ')d' + degOf(i) + ' — #' + j + '(' + verts[j].x.toFixed(0) + ',' + verts[j].y.toFixed(0) + ')d' + degOf(j) + '  间距 ' + d.toFixed(0) + '  最近字母 ' + (() => { let m = 1e9; for (const L of letterPts) { for (let k = 2; k <= 8; k++) { const t = k / 10; const px2 = verts[i].x + dx * t, py2 = verts[i].y + dy * t; const dd = Math.hypot(L.cx - px2, L.cy - py2); if (dd < m) m = dd } } return m.toFixed(0) })())
        // ③ 两点各自都有一条边指着对方
        const facing = (v: number) => outEdges.some((E) => {
          if (E[0] !== v && E[1] !== v) return false
          const o = E[0] === v ? E[1] : E[0]
          const ex = verts[o].x - verts[v].x, ey = verts[o].y - verts[v].y
          const el = Math.hypot(ex, ey) || 1
          return (ex / el) * ux + (ey / el) * uy > 0.8
        })
        if (!facing(i) || !facing(j)) continue
        // ★ v1525：**两点之间必须是"断的"** ✓ —— 线被字母切断时，那里的墨**跟着字母一起被抹掉了** ✓；
        //   而两个**真顶点**之间的线是连着的（虚线的短划也算 ✓）✗ —— 这一条专治"误合并真顶点" ✗。
        //   为什么以前没发现：node 端没有字形识别 → 这一刀根本不触发 ✗，只有**真浏览器**量得出来 ✓
        //   （实测：不加这条时 demo111 被并成 11 ✗、3-人工修正 19→18 ✗）。
        let inkHit = 0, samples = 0
        for (let k = 1; k <= 15; k++) {
          const t = k / 16
          const qx = Math.round(verts[i].x + dx * t), qy = Math.round(verts[i].y + dy * t)
          if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue
          samples++
          let hit = false
          for (let oy = -1; oy <= 1 && !hit; oy++) {
            for (let ox = -1; ox <= 1 && !hit; ox++) {
              const nx = qx + ox, ny = qy + oy
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
              if (ink[ny * W + nx]) hit = true
            }
          }
          if (hit) inkHit++
        }
        if (samples && inkHit / samples > 0.35) continue
        verts[i].x = (verts[i].x + verts[j].x) / 2
        verts[i].y = (verts[i].y + verts[j].y) / 2
        for (const e of outEdges) { if (e[0] === j) e[0] = i; if (e[1] === j) e[1] = i }
        verts.splice(j, 1)
        for (const e of outEdges) { if (e[0] > j) e[0]--; if (e[1] > j) e[1]-- }
        acted = true
        break outer2
      }
    }
    if (!acted) break
  }

  // ---------- 【v1524】按字母数剪掉多余的顶点（用户的想法：顶点数 = 字母个数 ✓） ----------
  // 目标 = countLabels 数出来的标注个数 ✓。**只剪"没有字母撑腰"的顶点** ✓：
  //   ① 附近 1.5 个字高内**有标注**的顶点一律不剪 ✓（那是有名字的点，剪了就是丢真顶点 ✗）；
  //   ② 只剪**断头**（度 1）或**落在另外两个顶点连线上的度 2 点** ✓（其余是真正的岔路口 ✓）；
  //   ③ 剪到目标数就停；**没有可剪的就停** ✓ —— 绝不为了凑数把真顶点剪掉 ✗。
  // ⚠ "撑腰的标记"要包含**所有像字的块**（letters ∪ solid ✓），不能只用 letters ✗：
  //   demo111 里两个**实心标注点**（12×12 圆点 ✓）不是"字母"、只是被判成短划的紧凑块 ✓，
  //   它们所在的顶点于是"没人撑腰" ✗ → 目标 10 < 真值 12 → 会被剪掉一个真点 ✗（实测 12→11 ✗）。
  const pruneToLabels = (target: number, bodyH: number, marks: { x: number; y: number }[]) => {
    if (target <= 0 || verts.length <= target) return 0
    const support = 1.5 * Math.max(6, bodyH)
    let cut = 0
    for (let guard = 0; guard < 40 && verts.length > target; guard++) {
      const inc: number[][] = verts.map(() => [])
      outEdges.forEach((e, i) => { inc[e[0]].push(i); inc[e[1]].push(i) })
      let pick = -1, pickScore = -1
      for (let v = 0; v < verts.length; v++) {
        const d = inc[v].length
        if (d < 1 || d > 2) continue                       // 度 0 的孤立点由 dropIsolated 管；度 ≥3 是岔路口，不剪 ✓
        // ① 有标记撑腰 → 不剪 ✓
        let near = false
        for (const b of marks) {
          if (Math.hypot(b.x - verts[v].x, b.y - verts[v].y) < support) { near = true; break }
        }
        if (near) continue
        let far = 1e9
        for (const b of marks) {
          const dd = Math.hypot(b.x - verts[v].x, b.y - verts[v].y)
          if (dd < far) far = dd
        }
        if (d === 2) {
          // ② 度 2：只剪**基本落在另两个顶点连线上**的点（真拐点不剪 ✓）
          const e1 = inc[v][0], e2 = inc[v][1]
          const o1 = outEdges[e1][0] === v ? outEdges[e1][1] : outEdges[e1][0]
          const o2 = outEdges[e2][0] === v ? outEdges[e2][1] : outEdges[e2][0]
          if (o1 === o2) continue
          const a = verts[o1], b2 = verts[o2], p = verts[v]
          const abx = b2.x - a.x, aby = b2.y - a.y
          const L = Math.hypot(abx, aby) || 1
          const perp = Math.abs((p.x - a.x) * (-aby / L) + (p.y - a.y) * (abx / L))
          if (perp > 0.02 * diag) continue
        }
        // 打分：断头优先（离字母越远越该剪 ✓）
        const score = (d === 1 ? 1e6 : 0) + far
        if (score > pickScore) { pickScore = score; pick = v }
      }
      if (pick < 0) break                                   // ③ 没有可剪的就停 ✓
      const v = pick
      if (inc[v].length === 1) {
        outEdges.splice(inc[v][0], 1)
      } else {
        const e1 = inc[v][0], e2 = inc[v][1]
        const o1 = outEdges[e1][0] === v ? outEdges[e1][1] : outEdges[e1][0]
        const o2 = outEdges[e2][0] === v ? outEdges[e2][1] : outEdges[e2][0]
        const dash = (outEdges[e1][2] || outEdges[e2][2]) ? 1 : 0
        const hi = Math.max(e1, e2), lo = Math.min(e1, e2)
        outEdges.splice(hi, 1); outEdges.splice(lo, 1)
        outEdges.push([o1, o2, dash])
      }
      verts.splice(v, 1)
      for (const e of outEdges) { if (e[0] > v) e[0]--; if (e[1] > v) e[1]-- }
      cut++
    }
    return cut
  }
  // ⚠ 这一刀必须放在**最后**（所有会改顶点数的步骤之后）：
  //   实测放在中间时，后面的 extendDashed / 精修 / 规整又会把顶点加回来 ✗
  //   （1-原图 中间态剪了 6 个、最终数还是 10 ✗）—— 那样"目标 = 标注个数"根本对不上 ✓。
  let prunedN = 0
  dedupe()

  // 虚线的短划天然够不到交点（差着一两个划的间距），沿自身方向往外延长，吸附到近旁的顶点上
  const findAlong = (p: { x: number; y: number }, dx: number, dy: number) => {
    const r = opt.extendR ?? 72
    const deg = new Array(verts.length).fill(0)
    for (const e of outEdges) { deg[e[0]]++; deg[e[1]]++ }
    let best = -1, bestJ = -1, bd = 1e9, bdJ = 1e9
    for (let i = 0; i < verts.length; i++) {
      const vx = verts[i].x - p.x, vy = verts[i].y - p.y
      const d = Math.hypot(vx, vy)
      if (d < 3 || d > r) continue
      if ((vx / d) * dx + (vy / d) * dy < 0.9) continue          // 偏离方向 25° 以上不要
      // 岔路口（度 >= 2）比"上一条短划的断头"更可能是这条虚线真正的落点
      if (deg[i] >= 2) { if (d < bdJ) { bdJ = d; bestJ = i } }
      else if (d < bd) { bd = d; best = i }
    }
    return bestJ >= 0 ? bestJ : best
  }
  const extendDashed = () => {
    for (const E of outEdges) {
      if (!E[2]) continue
      const A = verts[E[0]], B = verts[E[1]]
      let dx = B.x - A.x, dy = B.y - A.y
      const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L
      const na = findAlong(A, -dx, -dy), nb = findAlong(B, dx, dy)
      if (na >= 0 && na !== E[1]) E[0] = na
      if (nb >= 0 && nb !== E[0]) E[1] = nb
    }
    outEdges = outEdges.filter((e) => e[0] !== e[1])
  }

  // 度 2 且几乎在一条直线上的顶点 = 直线被切出来的假顶点
  const collinearSimplify = () => {
    for (let guard = 0; guard < 500; guard++) {
      const inc: number[][] = verts.map(() => [])
      outEdges.forEach((e, i) => { inc[e[0]].push(i); inc[e[1]].push(i) })
      let acted = false
      for (let v = 0; v < verts.length; v++) {
        if (inc[v].length !== 2) continue
        const e1 = outEdges[inc[v][0]], e2 = outEdges[inc[v][1]]
        const a = e1[0] === v ? e1[1] : e1[0]
        const b = e2[0] === v ? e2[1] : e2[0]
        if (a === b) continue
        const ux = verts[v].x - verts[a].x, uy = verts[v].y - verts[a].y
        const wx = verts[b].x - verts[v].x, wy = verts[b].y - verts[v].y
        const lu = Math.hypot(ux, uy) || 1, lw = Math.hypot(wx, wy) || 1
        if ((ux / lu) * (wx / lw) + (uy / lu) * (wy / lw) < (opt.collinearCos ?? 0.98)) continue   // 真有转折，保留
        const dash = (e1[2] && e2[2]) ? 1 : 0
        const kept = outEdges.filter((_, i) => i !== inc[v][0] && i !== inc[v][1]).map((e) => e.slice() as [number, number, number])
        kept.push([a, b, dash])
        outEdges = kept
        verts.splice(v, 1)
        for (const e of outEdges) {
          if (e[0] > v) e[0]--
          if (e[1] > v) e[1]--
        }
        acted = true
        break
      }
      if (!acted) break
    }
  }

  // 过短的边：两端其实是一个点
  const contractShort = (maxLen: number) => {
    for (let guard = 0; guard < 300; guard++) {
      let acted = false
      for (const E of outEdges) {
        const A2 = verts[E[0]], B2 = verts[E[1]]
        if (Math.hypot(A2.x - B2.x, A2.y - B2.y) > maxLen) continue
        A2.x = (A2.x + B2.x) / 2; A2.y = (A2.y + B2.y) / 2
        const j = E[1], k = E[0]
        for (const e of outEdges) {
          if (e[0] === j) e[0] = k
          if (e[1] === j) e[1] = k
        }
        verts.splice(j, 1)
        for (const e of outEdges) {
          if (e[0] > j) e[0]--
          if (e[1] > j) e[1]--
        }
        dedupe()
        acted = true
        break
      }
      if (!acted) break
    }
  }
  const dropIsolated = () => {
    const used = new Array(verts.length).fill(false)
    for (const e of outEdges) { used[e[0]] = true; used[e[1]] = true }
    for (let v = verts.length - 1; v >= 0; v--) {
      if (used[v]) continue
      verts.splice(v, 1)
      for (const e of outEdges) {
        if (e[0] > v) e[0]--
        if (e[1] > v) e[1]--
      }
    }
  }

  // 把 (x,y) 吸附到最近的骨架像素，用来取"边上真正的点"
  const snapSkel = (x: number, y: number): [number, number] | null => {
    let bx = x, by = y, bd = 1e9
    const x0 = Math.max(0, Math.round(x) - 7), x1 = Math.min(W - 1, Math.round(x) + 7)
    const y0 = Math.max(0, Math.round(y) - 7), y1 = Math.min(H - 1, Math.round(y) + 7)
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        if (!sk[yy * W + xx]) continue
        const d = (xx - x) * (xx - x) + (yy - y) * (yy - y)
        if (d < bd) { bd = d; bx = xx; by = yy }
      }
    }
    return bd < 64 ? [bx, by] : null
  }
  /** 交点精修：粗线在拐角处细化后骨架的"角"会往里缩一圈（实测偏 2%~3%）。
   *  用交于该点的各条边的直线做最小二乘求交，把顶点推回真正的角上。
   *  边的方向必须取"边上两个真实骨架点"——拿两个顶点算方向是白算的
   *  （那样的直线必然过当前顶点，解出来还是原位）。 */
  const refineCorners = (maxMove: number) => {
    for (let it = 0; it < 4; it++) {
      const inc: number[][] = verts.map(() => [])
      for (const e of outEdges) { inc[e[0]].push(e[1]); inc[e[1]].push(e[0]) }
      let moved = false
      for (let v = 0; v < verts.length; v++) {
        if (inc[v].length < 2) continue
        let a = 0, bb = 0, c = 0, rx = 0, ry = 0, used = 0
        for (const o of inc[v]) {
          const dx = verts[o].x - verts[v].x, dy = verts[o].y - verts[v].y
          const L = Math.hypot(dx, dy)
          if (L < 10) continue
          const p1 = snapSkel(verts[v].x + dx * 0.35, verts[v].y + dy * 0.35)
          const p2 = snapSkel(verts[v].x + dx * 0.7, verts[v].y + dy * 0.7)
          let ux: number, uy: number, px: number, py: number
          if (p1 && p2 && Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) > 3) {
            ux = p2[0] - p1[0]; uy = p2[1] - p1[1]
            const ul = Math.hypot(ux, uy); ux /= ul; uy /= ul
            px = p1[0]; py = p1[1]
          } else {
            ux = dx / L; uy = dy / L; px = verts[o].x; py = verts[o].y
          }
          const nx = -uy, ny = ux                       // 边的法向
          a += nx * nx; bb += nx * ny; c += ny * ny
          const dot = nx * px + ny * py
          rx += nx * dot; ry += ny * dot
          used++
        }
        if (used < 2) continue
        const det = a * c - bb * bb
        // 病态保护：两条入射边接近平行时，最小二乘的交点会跑到很远的地方，
        // 实测会把一个顶点甩到另一个顶点身上（相距 3px），手柄直接叠死、那个点就再也点不到了。
        // 用行列式相对量级判断条件数，太病态就干脆不动这个顶点。
        const scale = a + c
        if (Math.abs(det) < 1e-9 || Math.abs(det) < 0.02 * scale * scale) continue
        const X = (c * rx - bb * ry) / det
        const Y = (a * ry - bb * rx) / det
        let ddx = X - verts[v].x, ddy = Y - verts[v].y
        const dd = Math.hypot(ddx, ddy)
        if (dd < 0.4) continue
        if (dd > maxMove) { ddx *= maxMove / dd; ddy *= maxMove / dd }
        verts[v].x += ddx; verts[v].y += ddy
        moved = true
      }
      if (!moved) break
    }
  }

  extendDashed()
  collinearSimplify()
  contractShort((opt.short ?? 0.035) * diag)
  mergeVerts(opt.mergeR ?? 8)
  dropIsolated()
  dedupe()
  refineCorners((opt.refine ?? 0.03) * diag)
  // ⚠ 图的一次性清理必须放在**所有会改动图形态的步骤之后**。实测漏掉这两个收尾会留下用户点名的假顶点：
  //   · collinearSimplify 只在精修**之前**跑过 —— 而精修会挪顶点，挪完才变共线的"直线上的假顶点"（度 2）
  //     就活到了最后；
  //   · dissolveCrossings 只在 extendDashed **之前**跑过 —— 而 extendDashed 会把虚线的端点改指到
  //     另一个顶点上，那个新接头若正好落在一条直线上就形成假交点（度 4），此前没人再复核它。
  collinearSimplify()
  dissolveCrossings()
  // 精修会把顶点挪位置，**挪完必须再合并一次** —— 否则可能留下两个几乎重合的顶点，
  // 它们的手柄叠在一起，用户会有一个点点不到也拖不动
  mergeVerts(opt.mergeR ?? 8)
  dropIsolated()
  dedupe()

  // 【v1518】几何规整（约束吸附）—— 放在所有形态改动之后、导出之前 ✓
  snapGeometry(verts, outEdges, diag, opt, fittedArcs)
  // 【v1519 · C】模板匹配：这张图如果就是「复刻图形」里那 8 套之一，就直接换成人工核对过的几何
  //   （只在拓扑完全一致时才吸 —— 顶点/边/虚实线一条不增不减；有弧不匹配）
  if ((opt.figMatch ?? 1) !== 0 && !fittedArcs.length) {
    const flat: number[] = []
    for (const v of verts) flat.push(v.x, v.y)
    const m = matchFigure(flat, outEdges, { tol: opt.figTol ?? 0.08 })
    if (m) {
      for (let i = 0; i < verts.length; i++) { verts[i].x = m.points[2 * i]; verts[i].y = m.points[2 * i + 1] }
    }
  }
  // 规整会挪顶点 → 再走一遍收尾清理（共线假点 / 假交点 / 重合点 ✓）
  collinearSimplify()
  dissolveCrossings()
  mergeVerts(opt.mergeR ?? 8)
  dropIsolated()
  dedupe()


  // ---------- 【v1525】把"被字母切断的线"接回去（手术刀式：只认最严的那一种情形 ✓） ----------
  // 为什么放在最后：断头是**后面的成链 / 吸附**造出来的 ✗ —— 放在中间态时那两截还不成对 ✓
  // （v1524 试过把补接判据改宽，结果一处都没触发 ✓）。
  // 判据（五条一起用，缺一不可 ✓）：
  //   ① 两头**都是断头**（度 1）✓；② 缺口很小（≤ 1.2×字高、且 ≤26px）✓；
  //   ③ 两截**共线**（把 i 的边方向当基准，j 的垂距 ≤3px、方向反向 cos ≤ -0.98）✓；
  //   ④ **中间确实有个字母块**（连线中点 34px 内 ✓）—— 这是"线被字切断"的直接证据 ✓；
  //   ⑤ 两点之间**不能夹着别的顶点** ✓。
  // 实测（v1524 数据）：只有这一种最严的组合才不是"动一处、塌一片" ✗。
  const healCutLines = (bodyH: number): number => {
    const maxGap = Math.min(26, Math.max(10, 1.2 * bodyH))
    let fixed = 0
    for (let guard = 0; guard < 40; guard++) {
      const inc: number[][] = verts.map(() => [])
      outEdges.forEach((e, i) => { inc[e[0]].push(i); inc[e[1]].push(i) })
      let acted = false
      for (let i = 0; i < verts.length && !acted; i++) {
        if (inc[i].length !== 1) continue
        for (let j = 0; j < verts.length; j++) {
          if (j === i || inc[j].length !== 1) continue
          const dx = verts[j].x - verts[i].x, dy = verts[j].y - verts[i].y
          const d = Math.hypot(dx, dy)
          if ((opt.labelDebug ?? 0) !== 0 && d >= 3 && d <= 60) console.log('[heal2] #' + i + '(' + verts[i].x.toFixed(0) + ',' + verts[i].y.toFixed(0) + ') — #' + j + '(' + verts[j].x.toFixed(0) + ',' + verts[j].y.toFixed(0) + ') 间距 ' + d.toFixed(1) + (d > maxGap ? ' ✗ 超过缺口上限 ' + maxGap.toFixed(1) : ''))
          if (d < 3 || d > maxGap) continue
          const ux = dx / d, uy = dy / d
          // ③ 两截共线、且各自往外
          const dirOf = (v: number) => {
            const e = outEdges[inc[v][0]]
            const o = e[0] === v ? e[1] : e[0]
            const ex = verts[o].x - verts[v].x, ey = verts[o].y - verts[v].y
            const el = Math.hypot(ex, ey) || 1
            return [ex / el, ey / el] as [number, number]
          }
          const [ax, ay] = dirOf(i), [bx, by] = dirOf(j)
          if ((opt.labelDebug ?? 0) !== 0) console.log('[heal2]   #' + i + '→#' + j + ' cos_i ' + (ax * ux + ay * uy).toFixed(3) + ' cos_j ' + (bx * ux + by * uy).toFixed(3) + ' perp_i ' + Math.abs(-ax * uy + ay * ux).toFixed(3) + ' perp_j ' + Math.abs(-bx * uy + by * ux).toFixed(3) + ' 中点字母最近 ' + (() => { let m = 1e9; const mx2 = (verts[i].x + verts[j].x) / 2, my2 = (verts[i].y + verts[j].y) / 2; for (const L of letters) { const dd = Math.hypot(L.x - mx2, L.y - my2); if (dd < m) m = dd } return m.toFixed(0) })())
          // 门槛是**照着实测数字定的** ✓：user2 那对真断头 cos −0.991 / 0.995、垂距 0.131 / 0.101 ✓；
          //   同一张图里的假配对是 cos −0.786 / −0.463 与 cos 0.006 ✗ —— 两边都留了余量 ✓。
          if (ax * ux + ay * uy > -0.92) continue                 // i 的边要朝着"远离 j"的方向 ✓
          if (bx * ux + by * uy < 0.92) continue                  // j 的边要朝着"远离 i"的方向 ✓
          if (Math.abs(-ax * uy + ay * ux) > 0.25) continue        // 两条边还要大致在同一条直线上 ✓
          if (Math.abs(-bx * uy + by * ux) > 0.25) continue
          // ④ 中间有字母
          const mx = (verts[i].x + verts[j].x) / 2, my = (verts[i].y + verts[j].y) / 2
          let hasLabel = false
          for (const L of letters) if (Math.hypot(L.x - mx, L.y - my) < 34) { hasLabel = true; break }
          if (!hasLabel) continue
          // ⑤ 中间不夹别的顶点
          let between = false
          for (let k = 0; k < verts.length && !between; k++) {
            if (k === i || k === j) continue
            const tx = verts[k].x - verts[i].x, ty = verts[k].y - verts[i].y
            const t = tx * ux + ty * uy
            if (t <= 1 || t >= d - 1) continue
            if (Math.abs(tx * -uy + ty * ux) > 3) continue
            between = true
          }
          if (between) continue
          // 合并：把 j 并进 i —— **位置保持 i 不动** ✓
          // ⚠ 试过"挪到中点" ✗：中点可能正好落进另一个顶点的 8px 合并半径里 ✗ →
          //   后面的 mergeVerts 会顺带把它吃掉 ✗（实测真浏览器里 3-人工修正 19→18 ✗、demo111 12→11 ✗）。
          for (const e of outEdges) { if (e[0] === j) e[0] = i; if (e[1] === j) e[1] = i }
          verts.splice(j, 1)
          for (const e of outEdges) { if (e[0] > j) e[0]--; if (e[1] > j) e[1]-- }
          fixed++
          acted = true
          break
        }
      }
      if (!acted) break
    }
    return fixed
  }
  const healedN = (opt.labelHeal ?? 1) !== 0 ? healCutLines(labelCount.bodyH) : 0
  // ⚠ 这里**不能**再跑 mergeVerts ✗：那是"挪顶点"的操作，会把刚接好的点又并进邻居里 ✗（上面那条实测 ✓）。
  if (healedN) dedupe()

  // ---------- 【v1524】最后一步：按"标注个数"剪掉多余的顶点（用户的想法 ✓） ----------
  // 放在这里是因为**它必须是最后一个动顶点的步骤** ✗：前面任何一步（成链、精修、规整）都会再加回顶点，
  // 中间态剪了也白剪 ✓（实测 1-原图 中间态剪 6 个、最终数还是 10 ✗）。
  // ⚠ 默认 **0（关）**：这一刀在真图上有效（user2 22→18 ✓、user5 15→12 ✓、两条老样本一动不动 ✓），
  //   但基准台会掉顶点召回 93.3%→87.7% ✗ —— 因为**合成图上的字大多压在线上** ✗，
  //   计数在那边只有 40/61 ✗（真图上的字是孤立 + 分离出来的，数得准 ✓）→ 目标偏低就会剪到真顶点 ✗。
  //   所以先留着开关，等"贴着线的字"识别率再上一个台阶，再把它改成默认 ✓。
  // ⚠ 试过把"撑腰的标记"扩到 letters ∪ solid ✗（想让 demo111 的实心标注点也能保护自己的顶点 ✓）：
  //   实测没用 ✓（demo111 还是 12→11 ✗，那两个点根本不在候选里 ✗），却让该剪的少剪了 ✗（user2 18→19 ✗）→ 回退 ✓。
  prunedN = (opt.labelPrune ?? 0) !== 0
    ? pruneToLabels(labelCount.n, labelCount.bodyH, letters)
    : 0
  if (prunedN) { collinearSimplify(); dissolveCrossings(); dropIsolated(); dedupe() }

  const bw = box[2] - box[0], bh = box[3] - box[1]
  const points: number[] = []
  for (const v of verts) {
    points.push(+((v.x - box[0]) / bw).toFixed(4), +((v.y - box[1]) / bh).toFixed(4))
  }
  let dashN = 0
  for (const e of outEdges) if (e[2]) dashN++
  const arcs: FigureArc[] = fittedArcs.map((a) => ({
    cx: +((a.cx - box[0]) / bw).toFixed(4),
    cy: +((a.cy - box[1]) / bh).toFixed(4),
    rx: +(a.rx / bw).toFixed(4),
    ry: +(a.ry / bh).toFixed(4),
    a0: +a.a0.toFixed(4),
    a1: +a.a1.toFixed(4),
    dash: a.dash,
  }))
  return {
    W: bw, H: bh, box, imgW: W, imgH: H,
    points,
    edges: outEdges,
    arcs: arcs.length ? arcs : undefined,
    anchors: labels.map((L) => ({
      x: +((L.cx - box[0]) / bw).toFixed(4),
      y: +((L.cy - box[1]) / bh).toFixed(4),
      text: L.text,
      conf: +L.conf.toFixed(3),
    })),
    stats: { verts: verts.length, edges: outEdges.length, dash: dashN, text: textN, bars: st.barCount, dashGroups: st.dashGroups, buds: peel.buds, labels: labelCount.n, pruned: prunedN, healed: healedN, clipped },
  }
}

/** 保留原有同步 API，供模板工具与旧调用方使用；编辑弹窗优先走后台 Worker。 */
export function vectorizeImage(img: HTMLImageElement, opt: VectorizeOpt = {}): VectorizeResult {
  return vectorizeFromInk(toInk(img, opt.crop), opt)
}
