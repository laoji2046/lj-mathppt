/**
 * 【v1749】符号面板的数据（**借鉴 AxMath 的分类页签** ✓ 老师截图给的就是它 ✓）
 *
 * 为什么加：以前要打 `\alpha`、`\leqslant`、`\begin{cases}` 得自己记命令 ✗ ——
 *   面板里**点一下就插到光标处** ✓ 结构类（分式 / 根式 / 矩阵 / 方程组）插完
 *   光标自动落进第一个 `{}` 里 ✓ 接着敲就行 ✓
 *
 * 字段说明：
 * - `tex`  插入的 LaTeX ✓（不带 $ 定界符 ✓ 与应用里其他地方一致 ✓）
 * - `show` 面板上显示的字形 ✓（就是老师看得懂的那个符号 ✓）
 * - `in`   插入后光标放在第几个字符处 ✓（结构模板用 ✓ 如 `\frac{}{}` 的 6 = 第一个括号里 ✓）
 *
 * ⚠ 纪律：tex 里**不写 $** ✓、花括号**必须配平** ✓（探针用例 68 会挡 ✗）
 */

export interface MathSymbol {
  /** 插入的 LaTeX */
  tex: string
  /** 面板显示的字形 */
  show: string
  /** 插入后光标偏移（结构模板用 ✓） */
  in?: number
}

export interface SymbolGroup {
  key: string
  /** 页签名（借 AxMath 的分组 ✓） */
  name: string
  /** 页签上的小图标（用字形本身 ✓ 一眼认得出 ✓） */
  icon: string
  syms: MathSymbol[]
}

const G = (tex: string, show: string, inPos?: number): MathSymbol => (inPos == null ? { tex, show } : { tex, show, in: inPos })

export const MATH_SYMBOLS: SymbolGroup[] = [
  {
    key: 'greek',
    name: '希腊字母',
    icon: 'αβγ',
    syms: [
      G('\\alpha', 'α'), G('\\beta', 'β'), G('\\gamma', 'γ'), G('\\delta', 'δ'), G('\\epsilon', 'ε'), G('\\varepsilon', 'ϵ'),
      G('\\zeta', 'ζ'), G('\\eta', 'η'), G('\\theta', 'θ'), G('\\vartheta', 'ϑ'), G('\\iota', 'ι'), G('\\kappa', 'κ'),
      G('\\lambda', 'λ'), G('\\mu', 'μ'), G('\\nu', 'ν'), G('\\xi', 'ξ'), G('\\pi', 'π'), G('\\varpi', 'ϖ'),
      G('\\rho', 'ρ'), G('\\varrho', 'ϱ'), G('\\sigma', 'σ'), G('\\varsigma', 'ς'), G('\\tau', 'τ'), G('\\upsilon', 'υ'),
      G('\\phi', 'φ'), G('\\varphi', 'ϕ'), G('\\chi', 'χ'), G('\\psi', 'ψ'), G('\\omega', 'ω'), G('\\Gamma', 'Γ'),
      G('\\Delta', 'Δ'), G('\\Theta', 'Θ'), G('\\Lambda', 'Λ'), G('\\Xi', 'Ξ'), G('\\Pi', 'Π'), G('\\Sigma', 'Σ'),
      G('\\Upsilon', 'Υ'), G('\\Phi', 'Φ'), G('\\Psi', 'Ψ'), G('\\Omega', 'Ω'),
    ],
  },
  {
    key: 'rel',
    name: '关系符',
    icon: '＝≤≠',
    syms: [
      G('=', '='), G('\\neq', '≠'), G('\\approx', '≈'), G('\\equiv', '≡'), G('\\sim', '∼'), G('\\simeq', '≃'),
      G('\\le', '≤'), G('\\ge', '≥'), G('\\leqslant', '⩽'), G('\\geqslant', '⩾'), G('\\ll', '≪'), G('\\gg', '≫'),
      G('\\propto', '∝'), G('\\perp', '⊥'), G('\\parallel', '∥'), G('\\angle', '∠'), G('\\triangle', '△'),
      G('\\cong', '≅'), G('\\asymp', '≍'), G('\\doteq', '≐'), G('\\prec', '≺'), G('\\succ', '≻'), G('\\mid', '∣'),
    ],
  },
  {
    key: 'set',
    name: '集合与逻辑',
    icon: '∈∪∩',
    syms: [
      G('\\in', '∈'), G('\\notin', '∉'), G('\\ni', '∋'), G('\\subset', '⊂'), G('\\subseteq', '⊆'), G('\\supset', '⊃'),
      G('\\supseteq', '⊇'), G('\\cup', '∪'), G('\\cap', '∩'), G('\\varnothing', '∅'), G('\\emptyset', '∅'),
      G('\\setminus', '∖'), G('\\complement', '∁'), G('\\forall', '∀'), G('\\exists', '∃'), G('\\nexists', '∄'),
      G('\\neg', '¬'), G('\\land', '∧'), G('\\lor', '∨'), G('\\therefore', '∴'), G('\\because', '∵'), G('\\R', 'ℝ'), G('\\N', 'ℕ'), G('\\Z', 'ℤ'), G('\\Q', 'ℚ'), G('\\C', 'ℂ'),
    ],
  },
  {
    key: 'op',
    name: '运算符',
    icon: '＋×÷',
    syms: [
      G('+', '+'), G('-', '−'), G('\\pm', '±'), G('\\mp', '∓'), G('\\times', '×'), G('\\div', '÷'), G('\\cdot', '·'),
      G('\\ast', '∗'), G('\\star', '⋆'), G('\\circ', '∘'), G('\\bullet', '∙'), G('\\oplus', '⊕'), G('\\ominus', '⊖'),
      G('\\otimes', '⊗'), G('\\odot', '⊙'), G('\\triangleleft', '◁'), G('\\triangleright', '▷'), G('!', '!'),
      G('\\%', '%'), G('\\#', '#'), G('\\&', '&'),
    ],
  },
  {
    key: 'big',
    name: '大型运算符',
    icon: '∑∏∫',
    syms: [
      G('\\sum_{i=1}^{n}', '∑'), G('\\prod_{i=1}^{n}', '∏'), G('\\coprod', '∐'), G('\\bigcup_{i=1}^{n}', '⋃'),
      G('\\bigcap_{i=1}^{n}', '⋂'), G('\\bigoplus', '⨁'), G('\\bigotimes', '⨂'), G('\\bigvee', '⋁'), G('\\bigwedge', '⋀'),
      G('\\lim_{x \\to x_0}', 'lim'), G('\\lim_{n \\to \\infty}', 'lim n→∞'), G('\\max_{x \\in D}', 'max'),
      G('\\min_{x \\in D}', 'min'), G('\\sup', 'sup'), G('\\inf', 'inf'), G('\\limsup', 'lim sup'), G('\\liminf', 'lim inf'),
    ],
  },
  {
    key: 'calc',
    name: '分析与微积分',
    icon: '∂∫',
    syms: [
      G('\\int_{a}^{b}', '∫ᵃᵇ'), G('\\iint_{D}', '∬'), G('\\iiint_{\\Omega}', '∭'), G('\\oint_{L}', '∮'),
      G('\\partial', '∂'), G('\\nabla', '∇'), G('\\mathrm{d}', 'd'), G('\\prime', '′'), G('\\infty', '∞'),
      G('\\to', '→'), G('\\Delta x', 'Δx'), G('\\frac{\\mathrm{d}y}{\\mathrm{d}x}', 'dy/dx', 15),
      G('\\frac{\\partial z}{\\partial x}', '∂z/∂x', 19), G('\\int_{a}^{b} f(x)\\,\\mathrm{d}x', '∫ᵃᵇ f dx'),
    ],
  },
  {
    key: 'struct',
    name: '分式与根式',
    icon: '√½',
    syms: [
      G('\\frac{a}{b}', 'a/b', 6), G('\\dfrac{a}{b}', 'a/b 大', 7), G('\\tfrac{a}{b}', 'a/b 小', 7),
      G('\\sqrt{x}', '√', 6), G('\\sqrt[n]{x}', 'ⁿ√', 10), G('\\frac{1}{2}', '½', 6),
      G('x^{2}', 'x²', 3), G('x_{1}', 'x₁', 3), G('x_{1}^{2}', 'x₁²', 3), G('x_{n+1}', 'xₙ₊₁', 3),
      G('\\overline{x}', 'x̄', 10), G('\\underline{x}', 'x̲', 12), G('\\binom{n}{k}', 'C(n,k)', 7),
      G('\\perm{n}{k}', 'A(n,k)'), G('\\comb{n}{k}', 'C(n,k)'), G('\\frac{a}{b}=\\frac{c}{d}', '比例式', 6),
    ],
  },
  {
    key: 'bracket',
    name: '括号',
    icon: '()[]{}',
    syms: [
      G('\\left( x \\right)', '( )', 6), G('\\left[ x \\right]', '[ ]', 6), G('\\left\\{ x \\right\\}', '{ }', 6),
      G('\\left| x \\right|', '| |', 6), G('\\left\\| x \\right\\|', '‖ ‖', 6), G('\\left\\langle x \\right\\rangle', '⟨ ⟩', 6),
      G('\\left\\lceil x \\right\\rceil', '⌈ ⌉', 6), G('\\left\\lfloor x \\right\\rfloor', '⌊ ⌋', 6),
      G('\\abs{x}', '|x|'), G('\\norm{x}', '‖x‖'),
    ],
  },
  {
    key: 'deco',
    name: '装饰与帽标',
    icon: 'â x̄',
    syms: [
      G('\\vec{a}', 'a⃗', 5), G('\\overrightarrow{AB}', 'AB→', 16), G('\\bar{x}', 'x̄', 5), G('\\overline{AB}', 'AB̅', 10),
      G('\\hat{x}', 'x̂', 5), G('\\widehat{ABC}', 'ABĈ', 9), G('\\tilde{x}', 'x̃', 7), G('\\widetilde{ABC}', 'ABC̃', 11),
      G('\\dot{x}', 'ẋ', 5), G('\\ddot{x}', 'ẍ', 6), G('\\breve{x}', 'x̆', 7), G('\\check{x}', 'x̌', 7),
      G('\\overbrace{a+b}^{n}', '上花括号', 9), G('\\underbrace{a+b}_{n}', '下花括号', 10),
      G('\\stackrel{\\text{def}}{=}', '=ᵈᵉᶠ'), G('\\xrightarrow{n}', '→ⁿ', 14),
    ],
  },
  {
    key: 'arrow',
    name: '箭头',
    icon: '→⇌',
    syms: [
      G('\\to', '→'), G('\\leftarrow', '←'), G('\\uparrow', '↑'), G('\\downarrow', '↓'), G('\\leftrightarrow', '↔'),
      G('\\Leftarrow', '⇐'), G('\\Rightarrow', '⇒'), G('\\Leftrightarrow', '⇔'), G('\\mapsto', '↦'), G('\\longmapsto', '⟼'),
      G('\\longrightarrow', '⟶'), G('\\longleftarrow', '⟵'), G('\\rightleftharpoons', '⇌'), G('\\updownarrow', '↕'),
      G('\\nearrow', '↗'), G('\\searrow', '↘'), G('\\swarrow', '↙'), G('\\nwarrow', '↖'), G('\\hookrightarrow', '↪'), G('\\twoheadrightarrow', '↠'),
    ],
  },
  {
    key: 'matrix',
    name: '矩阵与阵列',
    icon: '⊞',
    syms: [
      G('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', '圆括号矩阵'),
      G('\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}', '方括号矩阵'),
      G('\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}', '行列式'),
      G('\\begin{pmatrix} a_1 \\\\ a_2 \\\\ a_3 \\end{pmatrix}', '列向量'),
      G('\\begin{cases} x + y = 1 \\\\ x - y = 2 \\end{cases}', '方程组'),
      G('\\text{联立}\\begin{cases} x + y = 1 \\\\ x - y = 2 \\end{cases}', '联立方程组'),
      G('\\begin{aligned} a &= b + c \\\\ &= d \\end{aligned}', '对齐推导'),
      G('\\begin{array}{c|c} a & b \\\\ \\hline c & d \\end{array}', '带表格线'),
      G('\\begin{cases} x + 1, & x \\ge 0 \\\\ x^2, & x < 0 \\end{cases}', '分段函数'),
      G('\\begin{matrix} a & b \\\\ c & d \\end{matrix}', '无括号矩阵'),
    ],
  },
]
