/** 预制公式库：按高中数学章节分类的典型公式（LaTeX，可直接插入 MathElement）。
 *
 * 说明：
 * - latex 为不含 $ 定界符的显示公式，MathJax 渲染。
 * - 可在公式面板顶部切换分类、点击卡片插入当前页；也支持双击卡片再次替换。
 * - 复用 useMathJax 内置宏：\R \N \Z \Q \C \E（实数集等）、\comb{n}{k}（组合）、\perm{n}{k}（排列）。
 */

export interface FormulaItem {
  /** 公式名（中文简称，用于卡片标签） */
  label: string
  /** 说明（可选，悬停提示） */
  note?: string
  /** LaTeX 源码，不含 $ 定界符 */
  latex: string
}

export interface FormulaCategory {
  key: string
  name: string
  icon: string
  /** 分类强调色，用于卡片/选项卡着色 */
  accent: string
  formulas: FormulaItem[]
}

export const FORMULA_LIBRARY: FormulaCategory[] = [
  {
    key: 'trig',
    name: '三角函数',
    icon: '∿',
    accent: '#d64545',
    formulas: [
      { label: '同角关系', note: 'sin²α+cos²α=1', latex: '\\sin^2\\alpha+\\cos^2\\alpha=1' },
      { label: '商数关系', note: 'tanα=sinα/cosα', latex: '\\tan\\alpha=\\frac{\\sin\\alpha}{\\cos\\alpha}' },
      { label: '诱导公式', note: '和 π 角互补', latex: '\\sin(\\pi+\\alpha)=-\\sin\\alpha,\\quad \\cos(\\pi+\\alpha)=-\\cos\\alpha' },
      { label: '两角和差', note: '正弦', latex: '\\sin(\\alpha\\pm\\beta)=\\sin\\alpha\\cos\\beta\\pm\\cos\\alpha\\sin\\beta' },
      { label: '两角和差(余弦)', note: '余弦', latex: '\\cos(\\alpha\\pm\\beta)=\\cos\\alpha\\cos\\beta\\mp\\sin\\alpha\\sin\\beta' },
      { label: '两角和差(正切)', note: '正切', latex: '\\tan(\\alpha\\pm\\beta)=\\frac{\\tan\\alpha\\pm\\tan\\beta}{1\\mp\\tan\\alpha\\tan\\beta}' },
      { label: '二倍角(正弦)', note: 'sin2α', latex: '\\sin2\\alpha=2\\sin\\alpha\\cos\\alpha' },
      { label: '二倍角(余弦)', note: '三种形式', latex: '\\cos2\\alpha=\\cos^2\\alpha-\\sin^2\\alpha=2\\cos^2\\alpha-1=1-2\\sin^2\\alpha' },
      { label: '二倍角(正切)', note: 'tan2α', latex: '\\tan2\\alpha=\\frac{2\\tan\\alpha}{1-\\tan^2\\alpha}' },
      { label: '降幂公式', note: '降次升角', latex: '\\sin^2\\alpha=\\frac{1-\\cos2\\alpha}{2},\\quad \\cos^2\\alpha=\\frac{1+\\cos2\\alpha}{2}' },
      { label: '辅助角公式', note: '化为 Asin(x+φ)', latex: 'a\\sin x+b\\cos x=\\sqrt{a^2+b^2}\\,\\sin(x+\\varphi)' },
      { label: '正弦定理', note: '边长/对角正弦', latex: '\\frac{a}{\\sin A}=\\frac{b}{\\sin B}=\\frac{c}{\\sin C}=2R' },
      { label: '余弦定理', note: '边长求角', latex: 'a^2=b^2+c^2-2bc\\cos A' },
      { label: '面积公式', note: '两边夹角求面积', latex: 'S_{\\triangle ABC}=\\frac{1}{2}ab\\sin C' },
      { label: '万能代换', note: 't=tan(α/2)', latex: '\\sin\\alpha=\\frac{2\\tan\\frac{\\alpha}{2}}{1+\\tan^2\\frac{\\alpha}{2}},\\quad \\cos\\alpha=\\frac{1-\\tan^2\\frac{\\alpha}{2}}{1+\\tan^2\\frac{\\alpha}{2}}' },
    ],
  },
  {
    key: 'func',
    name: '函数',
    icon: 'ƒ',
    accent: '#2d7dd2',
    formulas: [
      { label: '判别式', note: '根的判别', latex: '\\Delta=b^2-4ac' },
      { label: '韦达定理', note: '根与系数', latex: 'x_1+x_2=-\\frac{b}{a},\\quad x_1x_2=\\frac{c}{a}' },
      { label: '求根公式', note: '二次方程', latex: 'x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}' },
      { label: '顶点式', note: '对称轴/顶点', latex: 'y=a\\left(x-\\frac{b}{2a}\\right)^2+\\frac{4ac-b^2}{4a}' },
      { label: '指数运算法则', note: '同底相乘', latex: 'a^m\\cdot a^n=a^{m+n},\\quad \\frac{a^m}{a^n}=a^{m-n}' },
      { label: '指数函数', note: '单调性看底数', latex: 'y=a^x\\ (a>0,\\ a\\neq1)' },
      { label: '对数运算法则', note: '积的对数', latex: '\\log_a(MN)=\\log_aM+\\log_aN' },
      { label: '对数运算法则2', note: '商的对数', latex: '\\log_a\\frac{M}{N}=\\log_aM-\\log_aN' },
      { label: '对数运算法则3', note: '幂的对数', latex: '\\log_aM^n=n\\log_aM' },
      { label: '对数换底公式', note: '任意底互转', latex: '\\log_ab=\\frac{\\log_cb}{\\log_ca}' },
      { label: '指对数互化', note: '定义式', latex: 'a^x=N\\iff x=\\log_aN' },
      { label: '导数定义', note: '差商极限', latex: "f'(x)=\\lim_{\\Delta x\\to0}\\frac{f(x+\\Delta x)-f(x)}{\\Delta x}" },
      { label: '常见导数', note: '幂函数', latex: "(x^n)'=nx^{n-1}" },
      { label: '常用极限', note: 'e 的定义', latex: 'e=\\lim_{n\\to\\infty}\\left(1+\\frac{1}{n}\\right)^n' },
      { label: '单调性判定', note: '导数符号', latex: "f'(x)>0\\Rightarrow f(x) \\uparrow,\\quad f'(x)<0\\Rightarrow f(x)\\downarrow" },
      { label: '奇偶性', note: '定义域对称', latex: 'f(-x)=f(x)\\Rightarrow\\text{偶},\\quad f(-x)=-f(x)\\Rightarrow\\text{奇}' },
    ],
  },
  {
    key: 'analyt',
    name: '解析几何',
    icon: '◳',
    accent: '#c07b22',
    formulas: [
      { label: '两点距离', note: '坐标距离', latex: '|AB|=\\sqrt{(x_1-x_2)^2+(y_1-y_2)^2}' },
      { label: '中点坐标', note: '中点', latex: 'M\\left(\\frac{x_1+x_2}{2},\\frac{y_1+y_2}{2}\\right)' },
      { label: '斜率公式', note: '两点求斜', latex: 'k=\\frac{y_2-y_1}{x_2-x_1}' },
      { label: '点斜式', note: '过定点斜率为k', latex: 'y-y_0=k(x-x_0)' },
      { label: '点到直线距离', note: '点到 Ax+By+C=0', latex: 'd=\\frac{|Ax_0+By_0+C|}{\\sqrt{A^2+B^2}}' },
      { label: '两直线平行', note: '斜率相等', latex: 'l_1\\parallel l_2\\iff k_1=k_2\\ (b_1\\neq b_2)' },
      { label: '两直线垂直', note: '斜率之积为-1', latex: 'l_1\\perp l_2\\iff k_1k_2=-1' },
      { label: '弦心距', note: 'd²=r²-½l²', latex: 'd=\\sqrt{r^2-\\left(\\frac{l}{2}\\right)^2}' },
      { label: '圆的方程', note: '标准式', latex: '(x-a)^2+(y-b)^2=r^2' },
      { label: '圆的切线', note: '过圆上点', latex: "(x_0-a)(x-a)+(y_0-b)(y-b)=r^2" },
      { label: '椭圆方程', note: '焦点在x轴', latex: '\\frac{x^2}{a^2}+\\frac{y^2}{b^2}=1\\ (a>b>0)' },
      { label: '双曲线方程', note: '焦点在x轴', latex: '\\frac{x^2}{a^2}-\\frac{y^2}{b^2}=1\\ (a,b>0)' },
      { label: '渐近线方程', note: '双曲线', latex: 'y=\\pm\\frac{b}{a}x' },
      { label: '抛物线方程', note: '开口向右', latex: 'y^2=2px\\ \\left(p>0\\right)' },
      { label: '圆锥曲线离心率', note: '统一式', latex: 'e=\\frac{c}{a}' },
    ],
  },
  {
    key: 'solid',
    name: '立体几何',
    icon: '⬢',
    accent: '#7c4bb8',
    formulas: [
      { label: '棱柱体积', note: '底×高', latex: 'V_{\\text{柱}}=Sh' },
      { label: '棱锥体积', note: '⅓底×高', latex: 'V_{\\text{锥}}=\\frac{1}{3}Sh' },
      { label: '台体体积', note: '圆台/棱台', latex: 'V_{\\text{台}}=\\frac{1}{3}(S_1+S_2+\\sqrt{S_1S_2})h' },
      { label: '球的体积', note: '球', latex: 'V=\\frac{4}{3}\\pi R^3' },
      { label: '球的表面积', note: '球', latex: 'S=4\\pi R^2' },
      { label: '圆柱侧面积', note: '沿高展开', latex: 'S_{\\text{侧}}=2\\pi rh' },
      { label: '圆锥侧面积', note: 'l 为母线', latex: 'S_{\\text{侧}}=\\pi rl' },
      { label: '长方体对角线', note: '体对角线', latex: 'd=\\sqrt{a^2+b^2+c^2}' },
      { label: '异面直线所成角', note: '平移求角', latex: '\\cos\\theta=|\\cos\\langle\\vec{a},\\vec{b}\\rangle|' },
      { label: '线面角', note: '线与平面', latex: '\\sin\\theta=\\frac{|\\vec{n}\\cdot\\vec{v}|}{|\\vec{n}|\\,|\\vec{v}|}' },
      { label: '二面角', note: '法向量夹角', latex: '\\cos\\theta=\\frac{\\vec{n}_1\\cdot\\vec{n}_2}{|\\vec{n}_1|\\,|\\vec{n}_2|}' },
      { label: '点到平面距离', note: '法向量', latex: 'd=\\frac{|\\vec{n}\\cdot\\overrightarrow{AP}|}{|\\vec{n}|}' },
      { label: '线面平行判定', note: '线线平行推线面', latex: 'a\\parallel b,\\ a\\not\\subset\\alpha,\\ b\\subset\\alpha\\ \\Rightarrow\\ a\\parallel\\alpha' },
      { label: '面面垂直判定', note: '线面垂直推面面', latex: 'a\\subset\\alpha,\\ a\\perp\\beta\\ \\Rightarrow\\ \\alpha\\perp\\beta' },
    ],
  },
  {
    key: 'set',
    name: '集合与逻辑',
    icon: '⊂',
    accent: '#2f9e63',
    formulas: [
      { label: '并集', note: 'A∪B', latex: 'A\\cup B=\\{x\\mid x\\in A\\ \\text{或}\\ x\\in B\\}' },
      { label: '交集', note: 'A∩B', latex: 'A\\cap B=\\{x\\mid x\\in A\\ \\text{且}\\ x\\in B\\}' },
      { label: '补集', note: '全集U中', latex: '\\complement_UA=\\{x\\mid x\\in U,\\ x\\notin A\\}' },
      { label: '子集个数', note: 'n 个元素', latex: '\\text{子集 }2^n,\\quad \\text{真子集 }2^n-1' },
      { label: '德摩根律', note: '补集交换', latex: '\\complement_U(A\\cup B)=\\complement_UA\\cap\\complement_UB' },
      { label: '德摩根律2', note: '补集交换', latex: '\\complement_U(A\\cap B)=\\complement_UA\\cup\\complement_UB' },
      { label: '韦恩图关系', note: '子集', latex: 'A\\subseteq B\\iff A\\cap B=A' },
      { label: '充分条件', note: 'p是q的充分条件', latex: 'p\\Rightarrow q' },
      { label: '必要条件', note: 'q是p的必要条件', latex: 'q\\Rightarrow p' },
      { label: '充要条件', note: 'p⇔q', latex: 'p\\iff q' },
      { label: '全称命题', note: '任意', latex: '\\forall x\\in M,\\ p(x)' },
      { label: '特称命题', note: '存在', latex: '\\exists x\\in M,\\ p(x)' },
      { label: '全称特称否定', note: '否定规则', latex: '\\neg(\\forall x\\,\\ p(x))\\iff\\exists x\\,\\ \\neg p(x)' },
      { label: '逻辑联结词', note: '且/或/非', latex: 'p\\land q,\\quad p\\lor q,\\quad \\neg p' },
      { label: '均值不等式', note: 'ab 均值', latex: '\\frac{a+b}{2}\\ge\\sqrt{ab}\\ (a,b>0)' },
    ],
  },
  {
    key: 'prob',
    name: '概率与统计',
    icon: '≣',
    accent: '#b23f88',
    formulas: [
      { label: '古典概型', note: '等可能', latex: 'P(A)=\\frac{m}{n}' },
      { label: '对立事件', note: '互斥且互补', latex: 'P(A)+P(\\bar{A})=1' },
      { label: '互斥事件', note: '互斥相加', latex: 'P(A\\cup B)=P(A)+P(B)' },
      { label: '条件概率', note: '已知A下B', latex: 'P(B|A)=\\frac{P(AB)}{P(A)}' },
      { label: '独立事件', note: 'A、B独立', latex: 'P(AB)=P(A)\\,P(B)' },
      { label: '加法公式', note: '一般概率', latex: 'P(A\\cup B)=P(A)+P(B)-P(AB)' },
      { label: '二项分布', note: 'X~B(n,p)', latex: 'P(X=k)=\\comb{n}{k}\\,p^k(1-p)^{n-k}' },
      { label: '二项分布期望', note: 'E(X)', latex: 'E(X)=np,\\quad D(X)=np(1-p)' },
      { label: '正态分布密度', note: 'N(μ,σ²)', latex: 'f(x)=\\frac{1}{\\sqrt{2\\pi}\\sigma}e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}' },
      { label: '样本均值', note: '平均数', latex: '\\bar{x}=\\frac{1}{n}\\sum_{i=1}^{n}x_i' },
      { label: '样本方差', note: '离差平方均值', latex: 's^2=\\frac{1}{n}\\sum_{i=1}^{n}(x_i-\\bar{x})^2' },
      { label: '样本标准差', note: '方差开方', latex: 's=\\sqrt{\\frac{1}{n}\\sum_{i=1}^{n}(x_i-\\bar{x})^2}' },
      { label: '期望线性性', note: '期望性质', latex: 'E(aX+b)=aE(X)+b' },
      { label: '方差性质', note: '方差性质', latex: 'D(aX+b)=a^2D(X)' },
    ],
  },
  {
    key: 'seq',
    name: '数列',
    icon: '∑',
    accent: '#3c9bb0',
    formulas: [
      { label: '等差数列通项', note: 'a₁+(n-1)d', latex: 'a_n=a_1+(n-1)d' },
      { label: '等差数列求和', note: '倒序相加', latex: 'S_n=\\frac{n(a_1+a_n)}{2}=na_1+\\frac{n(n-1)}{2}d' },
      { label: '等差中项', note: '三项关系', latex: '2a_n=a_{n-1}+a_{n+1}' },
      { label: '等比数列通项', note: 'a₁q^(n-1)', latex: 'a_n=a_1q^{n-1}' },
      { label: '等比数列求和', note: 'q≠1', latex: 'S_n=\\frac{a_1(1-q^n)}{1-q}\\ (q\\neq1)' },
      { label: '等比中项', note: '三项关系', latex: 'a_n^2=a_{n-1}a_{n+1}' },
      { label: '自然数求和', note: 'Σk', latex: '1+2+\\cdots+n=\\frac{n(n+1)}{2}' },
      { label: '平方和', note: 'Σk²', latex: '1^2+2^2+\\cdots+n^2=\\frac{n(n+1)(2n+1)}{6}' },
      { label: '立方和', note: 'Σk³', latex: '1^3+2^3+\\cdots+n^3=\\left(\\frac{n(n+1)}{2}\\right)^2' },
      { label: '累加法求通项', note: '错位相减', latex: 'a_n=a_1+\\sum_{k=2}^{n}(a_k-a_{k-1})' },
      { label: '累乘法求通项', note: '叠乘', latex: 'a_n=a_1\\prod_{k=2}^{n}\\frac{a_k}{a_{k-1}}' },
      { label: '通项与前n项和', note: 'aₙ=Sn-S(n-1)', latex: 'a_n=S_n-S_{n-1}\\ (n\\ge2)' },
    ],
  },
  {
    key: 'tpl',
    name: '常用模板',
    icon: '⎡',
    accent: '#d4573c',
    formulas: [
      { label: '二元方程组', note: 'cases 联立', latex: '\\begin{cases} 2x+3y=1 \\\\ x-y=2 \\end{cases}' },
      { label: '一元二次求根', note: '求根公式', latex: 'x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}' },
      { label: '分段函数', note: '分段定义', latex: 'f(x)=\\begin{cases} x+1, & x\\ge 0 \\\\ x^2, & x<0 \\end{cases}' },
      { label: '二阶矩阵', note: 'pmatrix', latex: 'A=\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' },
      { label: '行列式', note: '二阶行列式', latex: '\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}=ad-bc' },
      { label: '向量点积', note: '夹角公式', latex: '\\vec{a}\\cdot\\vec{b}=|\\vec{a}|\\,|\\vec{b}|\\cos\\theta' },
      { label: '定积分', note: '牛顿-莱布尼茨', latex: '\\int_a^b f(x)\\,dx=F(b)-F(a)' },
      { label: '极限', note: '极限定义', latex: '\\lim_{x\\to x_0}f(x)=L' },
      { label: '二项式定理', note: '(a+b)^n 展开', latex: '(a+b)^n=\\sum_{k=0}^{n}\\comb{n}{k}a^{n-k}b^k' },
      { label: '排列数', note: 'Ank', latex: '\\perm{n}{k}=\\frac{n!}{(n-k)!}' },
      { label: '组合数', note: 'Cnk', latex: '\\comb{n}{k}=\\frac{n!}{k!\\,(n-k)!}' },
      { label: '数列求和', note: 'Σk', latex: '\\sum_{k=1}^{n}k=\\frac{n(n+1)}{2}' },
      { label: '等比数列求和', note: 'q≠1', latex: 'S_n=\\frac{a_1(1-q^n)}{1-q}\\ (q\\neq1)' },
      { label: '基本不等式', note: 'a,b>0', latex: 'a+b\\ge 2\\sqrt{ab}\\ (a,b>0)' },
    ],
  },
]
/** 公式标签（跨类别筛选维度） */
export const FORMULA_TAGS: string[] = ['高考', '重点', '易错', '基础', '常用', '几何', '导数', '数列']

/** 按公式 label 映射标签（免改每条公式数据） */
export const FORMULA_TAG_MAP: Record<string, string[]> = {
  '求根公式': ['基础', '高考'], '判别式': ['基础'], '韦达定理': ['高考', '重点'], '顶点式': ['基础'],
  '指数运算法则': ['基础', '常用'], '对数运算法则': ['易错'], '对数换底公式': ['高考'],
  '导数定义': ['导数', '重点'], '常见导数': ['导数', '基础'], '单调性判定': ['导数', '高考', '重点'],
  '两角和差': ['重点', '高考'], '二倍角(余弦)': ['易错', '高考'], '辅助角公式': ['高考', '重点'],
  '正弦定理': ['高考', '重点'], '余弦定理': ['高考'], '诱导公式': ['易错', '常用'],
  '两点距离': ['基础', '几何'], '点到直线距离': ['高考', '常用'], '圆的方程': ['高考', '几何'],
  '椭圆方程': ['高考', '重点'], '双曲线方程': ['高考'], '圆的切线': ['易错', '重点'],
  '等差数列求和': ['高考', '重点'], '等比数列求和': ['高考', '重点', '易错'], '累加法求通项': ['数列', '易错'],
  '二项式定理': ['高考', '重点'], '组合数': ['常用', '重点'], '排列数': ['常用', '重点'],
  '正态分布密度': ['高考', '重点'], '条件概率': ['高考', '易错'], '均值不等式': ['高考', '重点'],
  '充要条件': ['易错', '基础'], '全称特称否定': ['易错'], '棱柱体积': ['基础', '常用'], '球的体积': ['基础'],
  '点到平面距离': ['高考', '重点'],
}

/** 取公式的标签 */
export function formulaTags(item: FormulaItem): string[] {
  return FORMULA_TAG_MAP[item.label] ?? []
}

