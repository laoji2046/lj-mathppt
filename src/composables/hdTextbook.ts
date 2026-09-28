/**
 * 【v1719】教材目录（**人教A版 2019**）—— 给讲义「教材定位」的**章 / 节**当下拉候选 ✓
 *
 * 用户口径：「请根据 发布\LJ-讲义 下教材目录生成，以下拉菜单形式选取」✓
 *   · 讲义库里的文件名/标题就是「册 · 第 X 章 · 第 Y 节」✓ → 但库清空后就没得读了 ✗，
 *     所以这里**内置一份人教A版 2019 目录**（章名由人教社官网核过 ✓ 见
 *     docs/数学讲义-体例研究-v1712.md §5.2 ✓），再**并上讲义库里已经出现过的**章 / 节 ✓
 *   · 节名按教材整理 ✓（有出入直接改这张表 ✓ —— 只有这一处要改 ✓）
 *   · 选中的值写成「第 6 章 平面向量及其应用」这种**带名字**的串 ✓ → 抬头那一行也就写明了册次 / 课题 ✓
 *     （研究报告 §8：页眉要写明册次 / 课题 ✓ 原来只写「第 6 章」✗）
 */
export interface HdTocChapter {
  no: string
  name: string
  secs: { no: string; name: string }[]
}

export interface HdTocBook {
  press: string
  book: string
  chapters: HdTocChapter[]
}

/** 人教A版 2019（必修第一册 / 第二册 + 选择性必修第一~三册 ✓ 章号按教材连排 ✓） */
export const HD_TOC: HdTocBook[] = [
  {
    press: '人教版', book: '必修一',
    chapters: [
      { no: '1', name: '集合与常用逻辑用语', secs: [{ no: '1', name: '集合的概念' }, { no: '2', name: '集合间的基本关系' }, { no: '3', name: '集合的基本运算' }, { no: '4', name: '充分条件与必要条件' }, { no: '5', name: '全称量词与存在量词' }] },
      { no: '2', name: '一元二次函数、方程和不等式', secs: [{ no: '1', name: '等式性质与不等式性质' }, { no: '2', name: '基本不等式' }, { no: '3', name: '二次函数与一元二次方程、不等式' }] },
      { no: '3', name: '函数的概念与性质', secs: [{ no: '1', name: '函数的概念及其表示' }, { no: '2', name: '函数的基本性质' }, { no: '3', name: '幂函数' }, { no: '4', name: '函数的应用（一）' }] },
      { no: '4', name: '指数函数与对数函数', secs: [{ no: '1', name: '指数' }, { no: '2', name: '指数函数' }, { no: '3', name: '对数' }, { no: '4', name: '对数函数' }, { no: '5', name: '函数的应用（二）' }] },
      { no: '5', name: '三角函数', secs: [{ no: '1', name: '任意角和弧度制' }, { no: '2', name: '三角函数的概念' }, { no: '3', name: '诱导公式' }, { no: '4', name: '三角函数的图象与性质' }, { no: '5', name: '三角恒等变换' }, { no: '6', name: '函数 y=Asin(ωx+φ)' }, { no: '7', name: '三角函数的应用' }] },
    ],
  },
  {
    press: '人教版', book: '必修二',
    chapters: [
      { no: '6', name: '平面向量及其应用', secs: [{ no: '1', name: '平面向量的概念' }, { no: '2', name: '平面向量的运算' }, { no: '3', name: '平面向量基本定理及坐标表示' }, { no: '4', name: '平面向量的应用' }] },
      { no: '7', name: '复数', secs: [{ no: '1', name: '复数的概念' }, { no: '2', name: '复数的四则运算' }, { no: '3', name: '复数的三角表示（选学）' }] },
      { no: '8', name: '立体几何初步', secs: [{ no: '1', name: '基本立体图形' }, { no: '2', name: '立体图形的直观图' }, { no: '3', name: '简单几何体的表面积与体积' }, { no: '4', name: '空间点、直线、平面之间的位置关系' }, { no: '5', name: '空间直线、平面的平行' }, { no: '6', name: '空间直线、平面的垂直' }] },
      { no: '9', name: '统计', secs: [{ no: '1', name: '随机抽样' }, { no: '2', name: '用样本估计总体' }, { no: '3', name: '统计分析案例' }] },
      { no: '10', name: '概率', secs: [{ no: '1', name: '随机事件与概率' }, { no: '2', name: '事件的相互独立性' }, { no: '3', name: '频率与概率' }] },
    ],
  },
  {
    press: '人教版', book: '选择性必修一',
    chapters: [
      { no: '1', name: '空间向量与立体几何', secs: [{ no: '1', name: '空间向量及其运算' }, { no: '2', name: '空间向量基本定理' }, { no: '3', name: '空间向量及其运算的坐标表示' }, { no: '4', name: '空间向量的应用' }] },
      { no: '2', name: '直线和圆的方程', secs: [{ no: '1', name: '直线的倾斜角与斜率' }, { no: '2', name: '直线的方程' }, { no: '3', name: '直线的交点坐标与距离公式' }, { no: '4', name: '圆的方程' }, { no: '5', name: '直线与圆、圆与圆的位置关系' }] },
      { no: '3', name: '圆锥曲线的方程', secs: [{ no: '1', name: '椭圆' }, { no: '2', name: '双曲线' }, { no: '3', name: '抛物线' }] },
    ],
  },
  {
    press: '人教版', book: '选择性必修二',
    chapters: [
      { no: '4', name: '数列', secs: [{ no: '1', name: '数列的概念' }, { no: '2', name: '等差数列' }, { no: '3', name: '等比数列' }, { no: '4', name: '数学归纳法' }] },
      { no: '5', name: '一元函数的导数及其应用', secs: [{ no: '1', name: '导数的概念及其意义' }, { no: '2', name: '导数的运算' }, { no: '3', name: '导数在研究函数中的应用' }] },
    ],
  },
  {
    press: '人教版', book: '选择性必修三',
    chapters: [
      { no: '6', name: '计数原理', secs: [{ no: '1', name: '分类加法计数原理与分步乘法计数原理' }, { no: '2', name: '排列与组合' }, { no: '3', name: '二项式定理' }] },
      { no: '7', name: '随机变量及其分布', secs: [{ no: '1', name: '条件概率与全概率公式' }, { no: '2', name: '离散型随机变量及其分布列' }, { no: '3', name: '离散型随机变量的数字特征' }, { no: '4', name: '二项分布与超几何分布' }, { no: '5', name: '正态分布' }] },
      { no: '8', name: '成对数据的统计分析', secs: [{ no: '1', name: '成对数据的相关关系' }, { no: '2', name: '一元线性回归模型及其应用' }, { no: '3', name: '列联表与独立性检验' }] },
    ],
  },
]

/** 目录来源说明（界面上给老师看 ✓） */
export const HD_TOC_NOTE = '目录：人教A版 2019（章名已核 ✓ 节名以教材为准 ✓）+ 你讲义库里已有的章 / 节 ✓ 也能直接手打 ✓'

/** 从「6」「第 6 章 …」「6.1」这类串里抠出主号 ✓（抠不出就返回原串 ✓） */
export function hdMainNo(s: unknown): string {
  const t = String(s == null ? '' : s).trim()
  const m = /^(?:第\s*)?(\d+)/.exec(t.replace(/^第\s*/, ''))
  return m ? m[1] : t
}

/** 章标签：第 6 章 平面向量及其应用 ✓ */
export function hdChapterLabel(no: string, name: string): string {
  return '第 ' + no + ' 章' + (name ? ' ' + name : '')
}

/** 节标签：第 1 节 平面向量的概念 ✓ */
export function hdSectionLabel(no: string, name: string): string {
  return '第 ' + no + ' 节' + (name ? ' ' + name : '')
}

/** 这一册的内置目录（没有就返回空 ✓ 别的版本只吃讲义库那部分 ✓） */
export function hdTocBook(press: string, book: string): HdTocBook | null {
  const p = String(press || '').trim()
  const b = String(book || '').trim()
  for (const x of HD_TOC) if (x.book === b && (!p || x.press === p)) return x
  return null
}

/** 讲义库里已经出现过的章 / 节（老师自己的活目录 ✓ docs 就是 lib ✓） */
function hdFromDocs(docs: unknown[] | undefined) {
  const chapters: string[] = []
  const secs: { ch: string; v: string }[] = []
  for (const d of docs || []) {
    const m = ((d as { meta?: Record<string, unknown> })?.meta) || {}
    const ch = String(m.chapter == null ? '' : m.chapter).trim()
    const se = String(m.section == null ? '' : m.section).trim()
    if (ch && chapters.indexOf(ch) < 0) chapters.push(ch)
    if (se) secs.push({ ch: hdMainNo(ch), v: se })
  }
  return { chapters, secs }
}

/** 章候选（内置目录 + 讲义库 ✓ 去重 ✓ 例：'第 6 章 平面向量及其应用'） */
export function hdChapterOptions(press: string, book: string, docs?: unknown[]): string[] {
  const out: string[] = []
  const toc = hdTocBook(press, book)
  if (toc) for (const c of toc.chapters) out.push(hdChapterLabel(c.no, c.name))
  for (const ch of hdFromDocs(docs).chapters) if (out.indexOf(ch) < 0) out.push(ch)
  return out
}

/** 节候选：认得出这一章就给这一章的节 ✓，认不出就给这一册全部节 ✓（再并上讲义库里的 ✓） */
export function hdSectionOptions(press: string, book: string, chapter: string, docs?: unknown[]): string[] {
  const out: string[] = []
  const toc = hdTocBook(press, book)
  const want = hdMainNo(chapter)
  if (toc) {
    const hit = toc.chapters.filter((c) => c.no === want)
    const use = hit.length ? hit : (want ? [] : toc.chapters)
    for (const c of use) for (const s of c.secs) out.push(hdSectionLabel(s.no, s.name))
  }
  for (const x of hdFromDocs(docs).secs) {
    if (want && x.ch && x.ch !== want) continue
    if (out.indexOf(x.v) < 0) out.push(x.v)
  }
  return out
}
