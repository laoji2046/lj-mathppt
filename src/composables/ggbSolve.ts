/**
 * 【v1711】GGB 套件的「贴图解题作图」：题图 → 解题过程 + 作图步骤（含自动切工具）
 *
 * 用户口径：为 ggb 套件添加贴图绘图功能：导入图片或截图，根据问题自动生成问题的求解过程，
 *   并在绘图套件绘制对应的图形，能自动根据问题切换套件中的工具。
 *
 * 三件事分开：
 *   ① 模型只负责想（给 JSON：解题过程 + 一步步的「切哪个工具 / 执行哪条指令」）
 *   ② 这里负责校验（工具名认不认得出 / 指令空不空 / 步数上限）—— 纯函数，探针能盯
 *   ③ GgbSuite 负责执行（setMode 切工具 → evalCommand 作图）
 */

/** 工具名 → GeoGebra 的 mode 号（官方 setMode 的取值；只放常用且确定的那些，不猜） */
export const GGB_TOOLS: { key: string; mode: number; label: string; cn: string }[] = [
  { key: "move", mode: 0, label: "移动", cn: "移动/选择" },
  { key: "point", mode: 1, label: "点", cn: "点/描点" },
  { key: "line", mode: 2, label: "直线", cn: "直线" },
  { key: "segment", mode: 3, label: "线段", cn: "线段" },
  { key: "ray", mode: 4, label: "射线", cn: "射线" },
  { key: "vector", mode: 5, label: "向量", cn: "向量" },
  { key: "circle", mode: 6, label: "圆", cn: "圆（过一点）/圆" },
  { key: "circle_radius", mode: 7, label: "圆心+半径", cn: "圆（圆心半径）" },
  { key: "circle3", mode: 8, label: "三点圆", cn: "三点圆" },
  { key: "angle", mode: 9, label: "角", cn: "角/角度" },
  { key: "perpendicular", mode: 10, label: "垂线", cn: "垂线/垂直" },
  { key: "parallel", mode: 11, label: "平行线", cn: "平行线/平行" },
  { key: "polygon", mode: 12, label: "多边形", cn: "多边形/三角形" },
  { key: "intersect", mode: 13, label: "交点", cn: "交点/相交" },
  { key: "midpoint", mode: 14, label: "中点", cn: "中点/中心" },
  { key: "perpendicular_bisector", mode: 15, label: "中垂线", cn: "中垂线/垂直平分线" },
  { key: "angle_bisector", mode: 16, label: "角平分线", cn: "角平分线" },
  { key: "tangent", mode: 17, label: "切线", cn: "切线" },
  { key: "reflect_line", mode: 18, label: "轴对称", cn: "对称/轴对称" },
  { key: "reflect_point", mode: 19, label: "中心对称", cn: "中心对称" },
  { key: "translate", mode: 20, label: "平移", cn: "平移" },
  { key: "rotate", mode: 21, label: "旋转", cn: "旋转" },
  { key: "dilate", mode: 22, label: "位似", cn: "位似/缩放" },
  { key: "delete", mode: 23, label: "删除", cn: "删除" },
]

/** 认工具名：英文 key / 中文说法 / 带修饰的说法都认（认不出返回 null，交给调用方说清） */
export function ggbToolOf(name: unknown): { key: string; mode: number; label: string } | null {
  const s = String(name == null ? "" : name).trim().toLowerCase()
  if (!s) return null
  for (const t of GGB_TOOLS) {
    if (t.key === s) return { key: t.key, mode: t.mode, label: t.label }
    if (t.cn === s || t.label === s) return { key: t.key, mode: t.mode, label: t.label }
  }
  // 【v1711b】cn 里用 / 写了多种说法（垂线/垂直）—— 必须**拆开**逐个比 ✗
  //   （上一版拿整串 indexOf → 画个垂线 认不出来 ✗ 真机实测 ✓）
  const norm = (x: string) => x.replace(/[\s（）()、，,。/／|]/g, "")
  const q = norm(s)
  const cands: { t: { key: string; mode: number; label: string; cn: string }; alt: string }[] = []
  for (const t of GGB_TOOLS) {
    for (const raw of (t.cn + "/" + t.label).split(/[/／|]/)) {
      const alt = norm(raw)
      if (alt) cands.push({ t, alt })
    }
  }
  cands.sort((a, b) => b.alt.length - a.alt.length)
  for (const c of cands) {
    if (q.indexOf(c.alt) >= 0) return { key: c.t.key, mode: c.t.mode, label: c.t.label }
  }
  return null
}

/** 给模型看的工具清单（写进 system；探针盯着每个都写进去了） */
export function ggbToolMenu(): string {
  return GGB_TOOLS.map((t) => t.key + "（" + t.cn + "）").join("、")
}

/** 【v1711】解题作图的 system：把「想」的活交给模型，但**格式写死**（否则没法自动执行） */
export function ggbSolveSystem(): string {
  const NL2 = String.fromCharCode(10)
  return [
    "你是高中数学老师的**作图助手**：老师会贴一道题（题目照片 / 截图，或直接打字），你要两件事：",
    "① 写出**解题过程**（中文，分步骤，公式用 $…$，学生看得懂；别啰嗦、别客套）；",
    "② 给出**作图步骤**：每一步先说明切到哪个工具、再给一条 GeoGebra 指令。",
    "作图要求：",
    "· 指令用 GeoGebra **原生语法**（不是 JS）：A=(0,0)、Segment(A,B)、Line(A,B)、Circle(O,A)、",
    "  Circle((0,0),3)、Polygon(A,B,C)、Midpoint(A,B)、PerpendicularLine(M,c)、ParallelLine(M,AB)、",
    "  Intersect(c,f)、Tangent(A,c)、Angle(A,B,C)、Rotate(A,60°,(O))、Reflect(A,l)、Ellipse(F,G,A)、",
    "  Hyperbola(F,G,A)、Parabola(F,l)、f(x)=x^2-2x、Slider(0,6.28,0.02) 等；",
    "· 点的坐标要**照着题目的数量关系取**（单位圆取 (1,0)、椭圆 x²/9+y²/4=1 取 (3,0)）——",
    "  别都堆在原点附近，也别编与题目矛盾的数；",
    "· 要换颜色/线宽这类只能在 JS 里做的事就**别管**（这里只跑指令）；",
    "· tool 只能从下面这个清单里选（认不出的会被忽略）：" + ggbToolMenu() + "。",
    "· **卡住或者要核对的时候，插一条「只读」读数步**（【v1731】只量不画 ✓ 不会往画布上添东西 ✓）：",
    "  tool 写 query，cmd 写一条**只读表达式**：Distance(A,B)、Angle(A,B,C)、Area(p)、Radius(c)、",
    "  Center(c)、Slope(l)、Midpoint(A,B)、x(A)、y(A) —— 只能用这些只读函数 + 画布上已有的对象 ✗ 别的会被拒掉；",
    "  量出来的**精确值会回到你手里**，再据此往下画或者核对（这一步不切工具、不画图 ✓）。",
    "· **画错了就删掉重画**（【v1732】删一个对象会**连带删掉依赖它的**对象 ✓）：",
    "  tool 写 delete，cmd 写 Delete(A)（GeoGebra 原生写法 ✓ 多个就用 Delete(A,B) ✓）。",
    "输出格式（**只输出 JSON**，别加解释、别包代码块）：",
    "{\"solution\":\"解题过程（可用换行与 $公式$）\",\"steps\":[{\"tool\":\"point\",\"cmd\":\"A=(0,0)\",\"say\":\"建点 A\"},{\"tool\":\"circle\",\"cmd\":\"Circle(A,B)\",\"say\":\"以 A 为心过 B 作圆\"}]}",
    "steps 按作图顺序排；一步只做一件事（先切工具、再一条指令）；题目里用不到的工具别硬凑。",
  ].join(NL2)
}

export interface GgbSolveStep {
  tool: string
  mode: number
  cmd: string
  say: string
  /** 【v1731】读数步：只量不画（走临时对象，量完立刻删 ✓） */
  query?: boolean
}
export interface GgbSolvePlan { solution: string; steps: GgbSolveStep[]; notes: string[]; raw: string }

/** 从模型回答里抠出 JSON（允许包代码块 / 前后有废话） */
function pickJson(raw: string): unknown {
  const s = String(raw || "").replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim()
  const i = s.indexOf("{")
  const j = s.lastIndexOf("}")
  if (i < 0 || j <= i) return null
  try { return JSON.parse(s.slice(i, j + 1)) } catch { return null }
}

/** JSON 没解析成功时的兜底：按 key: value 逐个抠出来（模型偶尔会写单引号 / 漏逗号） */
function salvage(raw: string): { cmd: string; tool: string; say: string }[] {
  const out: { cmd: string; tool: string; say: string }[] = []
  const re = /(cmd|tool|say)\s*[:：]\s*[\"\u201c\u2018]([^\"\u201d\u2019]*)[\"\u201d\u2019]/g
  let m: RegExpExecArray | null = null
  let cur: { cmd: string; tool: string; say: string } | null = null
  while ((m = re.exec(String(raw || "")))) {
    const k = m[1]
    const v = m[2]
    if (k === "tool") { if (cur) out.push(cur); cur = { tool: v, cmd: "", say: "" } }
    else if (!cur) cur = { tool: "", cmd: "", say: "" }
    if (k === "cmd" && cur) cur.cmd = v
    if (k === "say" && cur) cur.say = v
  }
  if (cur) out.push(cur)
  return out
}

/**
 * 【v1711】模型回答 → 能执行的计划（纯函数，探针覆盖）
 *  · 认不出工具名 → 跳过「切工具」但**指令照跑** + note 一句（别整段扔掉）
 *  · 空指令 → 丢；步数上限 60；解题过程上限 4000 字
 */
export function ggbSolvePlan(raw: unknown): GgbSolvePlan {
  const text = String(raw == null ? "" : raw)
  const notes: string[] = []
  const obj = pickJson(text) as { solution?: unknown; steps?: unknown } | null
  let solution = obj && typeof obj.solution === "string" ? obj.solution : ""
  let rawSteps: unknown[] = obj && Array.isArray(obj.steps) ? obj.steps : []
  if (!obj) {
    const sal = salvage(text)
    if (sal.length) { notes.push("JSON 没解析成功 —— 已按 cmd / tool 抠出来 " + sal.length + " 步"); rawSteps = sal }
    else notes.push("模型没给出可解析的 JSON（把它说的原文留在下面）")
  }
  const steps: GgbSolveStep[] = []
  for (const it of rawSteps) {
    if (steps.length >= 60) { notes.push("步骤超过 60 步，多的没收"); break }
    const c = coerceStep(it)   // 【v1731】读一步 / 作图步 统一在这里认 ✓（与核对轮共用 ✓）
    if (c.note) notes.push(c.note)
    if (c.step) steps.push(c.step)
  }
  if (!steps.length && !solution) solution = text.slice(0, 4000)
  return { solution: solution.slice(0, 4000), steps, notes, raw: text }
}

/** 计划 → 给老师 / 日志看的一行行摘要（纯函数） */
export function ggbStepLines(plan: GgbSolvePlan): string[] {
  const out: string[] = []
  for (const s of (plan && plan.steps) || []) {
    if (s.tool) {
      const t = ggbToolOf(s.tool)
      out.push("切换工具：" + (t ? t.label : s.tool))
    }
    out.push(s.cmd + (s.say ? "　// " + s.say : ""))
  }
  return out
}
/* ---------------- 【v1729】识图解题三段式：读图 → 校对 → 解题作图 ----------------
 * 为什么拆：原来一步里让模型同时「读图 + 推理 + 写 GeoGebra 语法」✗ —— 三件事捆在一起，
 *   看错了 / 算错了 / 写错了根本分不清 ✗ 现在：
 *   ① 读图：只**转写**（题干逐字 + 已知 + 求什么 + 图形要素 + 看不清的地方 ✓），不许解题、不许猜 ✗
 *   ② 校对：老师在这段文字上直接改 ✓ —— 最便宜的纠错点 ✓
 *   ③ 解题作图：文本模型基于校对后的题干想 → 静态校验 → 执行 → 报错的步骤回灌修一轮 ✓
 */

/** 【v1729】带图但没配视觉模型 → 返回要说清的那句（null = 没问题 ✓）—— 纯函数，探针能盯 */
export function ggbVisionGuard(hasImages: boolean, visionModel: string): string | null {
  if (!hasImages) return null
  if (String(visionModel || "").trim()) return null
  return "带图要用视觉模型：设置 → AI 助手 → 视觉模型（填模型名，必要时填端点）—— 没填的话，图根本送不进模型"
}

/** 【v1729】读图阶段的 system：**只转写、不解题、不猜** */
export function ggbReadSystem(): string {
  const NL2 = String.fromCharCode(10)
  return [
    "你是题目**转写员**（不是解题人）：老师会贴一道题的图片（题目照片 / 截图），你只做一件事 ——",
    "把图里的信息**逐字转写**成结构化 JSON。",
    "铁律：",
    "· 数字、字母、下标、单位**必须照抄原图**（x²/9+y²/4=1 就写这个，别换算、别化简、别补全 ✗）；",
    "· 题干文字尽量逐字写全（含小题号（1）（2）与「求…」「证明…」）；",
    "· 图里的几何要素分开列：点（点名 + 位置，如「A 在原点」）、线段 / 直线 / 射线、圆 / 曲线，",
    "  以及图上**标出来的关系**（垂直、平行、相切、相等、直角、中点、角平分线…）；",
    "· **看不清就不猜** ✗ —— 把拿不准的写进 unsure，并说清是哪个位置的什么内容；",
    "· 不许解题、不许给答案、不许写作图步骤 ✗（那些是下一步的事）。",
    "输出格式（**只输出 JSON**，别加解释、别包代码块）：",
    "{\"text\":\"题干逐字\",\"given\":[\"已知条件 1\",\"已知条件 2\"],\"ask\":\"求（1）…（2）…\",\"figure\":[\"点 A 在原点\",\"圆 c 过 B、C\"],\"unsure\":[\"图中角标注疑似 60°，也可能是 50°\"]}",
  ].join(NL2)
}

export interface GgbBrief { text: string; given: string[]; ask: string; figure: string[]; unsure: string[]; raw: string }

/** 小工具：字符串 / 数组 / 对象都收拢成字符串数组（有条数上限与单条长度上限 ✓） */
function strList(v: unknown, max: number, each: number): string[] {
  const arr = Array.isArray(v) ? v : (v == null || v === "" ? [] : [v])
  const out: string[] = []
  for (const x of arr) {
    const s = (typeof x === "string"
      ? x
      : (x && typeof x === "object"
        ? Object.keys(x as Record<string, unknown>).map((k) => k + "：" + String((x as Record<string, unknown>)[k])).join("；")
        : String(x == null ? "" : x))).trim()
    if (s) out.push(s.slice(0, each))
    if (out.length >= max) break
  }
  return out
}

/** 【v1729】读图回答 → 结构化题干（纯函数 ✓ 容错：JSON 抠取 / 字段类型 / 条数上限 ✓） */
export function ggbReadBrief(raw: unknown): GgbBrief {
  const text = String(raw == null ? "" : raw)
  const obj = pickJson(text) as Record<string, unknown> | null
  if (!obj) {
    // 没给出 JSON：把原文当题干 ✓ —— 宁可让老师看到东西，也别给个空框 ✗
    return { text: text.trim().slice(0, 8000), given: [], ask: "", figure: [], unsure: [], raw: text }
  }
  return {
    text: String(obj.text == null ? "" : obj.text).trim().slice(0, 8000),
    given: strList(obj.given, 20, 200),
    ask: String(obj.ask == null ? "" : obj.ask).trim().slice(0, 500),
    figure: strList(obj.figure, 30, 200),
    unsure: strList(obj.unsure, 12, 200),
    raw: text,
  }
}

/** 【v1729】结构化题干 → 老师可编辑的一段文字（也是送去解题的那段 ✓） */
export function ggbBriefText(b: GgbBrief): string {
  const NL2 = String.fromCharCode(10)
  const out: string[] = []
  if (b.text) out.push("【题干】" + b.text)
  if (b.given.length) out.push("【已知】" + b.given.map((x, i) => (i + 1) + ") " + x).join("　"))
  if (b.ask) out.push("【求/证】" + b.ask)
  if (b.figure.length) out.push("【图形要素】" + b.figure.join("；"))
  if (b.unsure.length) out.push("【待确认（请先核对这里）】" + b.unsure.map((x) => "⚠ " + x).join("；"))
  return out.join(NL2)
}

/** 【v1729】解题阶段的 user 内容：**不带图** ✓（用校对后的文字 ✓ 便宜、且不依赖视觉模型 ✓） */
export function ggbSolveUser(briefText: string, extra: string): string {
  const NL2 = String.fromCharCode(10)
  return "请解下面这道题（题干已由老师核对过），并按格式给出作图步骤。" + NL2 + NL2 +
    String(briefText || "").trim() +
    (String(extra || "").trim() ? NL2 + NL2 + "补充要求：" + String(extra).trim() : "")
}

export interface GgbPlanCheck { steps: GgbSolveStep[]; issues: string[]; fixes: string[] }

/** 全角 → 半角：只换指令里会用到的那几个（GeoGebra 不认全角括号逗号 ✗ 模型却常写 ✗） */
function halfWidth(s: string): string {
  return s
    .replace(/（/g, "(").replace(/）/g, ")").replace(/，/g, ",").replace(/；/g, ";")
    .replace(/：/g, ":").replace(/＋/g, "+").replace(/－/g, "-").replace(/＝/g, "=")
}

/** 括号 / 方括号 / 大括号是否配平 ✓ */
function balanced(s: string): boolean {
  let p = 0, q = 0, r = 0
  for (const ch of s) {
    if (ch === "(") p++
    else if (ch === ")") p--
    else if (ch === "[") q++
    else if (ch === "]") q--
    else if (ch === "{") r++
    else if (ch === "}") r--
    if (p < 0 || q < 0 || r < 0) return false
  }
  return p === 0 && q === 0 && r === 0
}

/**
 * 【v1729】执行前的静态校验（纯函数 ✓ 探针盯着）：
 *  ① 全角标点 → 半角 ✓
 *  ② 一行用 ; 串了好几条 → 拆成多步 ✓（GeoGebra 一次一条最稳 ✓）
 *  ③ 括号不配平 → 记一条 issue ✓
 *  ④ **依赖顺序**：用到 A / B / c 这类对象名，前面却没有 `X=…` 定义过 → 记一条 ⚠
 *     （只认「单个大写字母（可带数字/下标/撇）」这种点名 ✓ —— 免得把 AB、Segment 也当成引用 ✗ 误报 ✗）
 *  只报不改（不拦执行 ✓）—— 真正的修复交给「回灌自愈」✓
 */
export function ggbValidatePlan(steps: GgbSolveStep[], objects: string[] = []): GgbPlanCheck {
  const out: GgbSolveStep[] = []
  const issues: string[] = []
  const fixes: string[] = []
  const defined = new Set<string>(objects || [])   // 【v1731】画布上已存在的对象先算「定义过」✓ 不再误报依赖顺序 ✓
  for (const s of steps) {
    if (out.length >= 60) { issues.push("步骤超过 60 步，多的没收"); break }
    const half = halfWidth(String(s.cmd || "").trim()).replace(/;+$/, "")
    if (half !== String(s.cmd || "").trim()) fixes.push("全角标点已换成半角：" + half.slice(0, 40))
    if (!half) { issues.push("空指令（已跳过）"); continue }
    if (!balanced(half)) issues.push("括号不配平：" + half.slice(0, 50))
    const parts = half.split(";").map((x) => x.trim()).filter(Boolean)
    const list = parts.length ? parts : [half]
    if (parts.length > 1) fixes.push("一行 " + parts.length + " 条已拆成多步：" + half.slice(0, 40))
    for (const one of list) {
      const m = /^\s*([A-Za-z][A-Za-z0-9_']*)\s*(?:\([^)]*\))?\s*=/.exec(one)
      if (m) defined.add(m[1])
      const ids = one.match(/[A-Za-z_][A-Za-z0-9_']*/g) || []
      for (const id of ids) {
        const isPoint = /^[A-Z][0-9]?$/.test(id) || /^[A-Z](_\{?[0-9]+\}?|')$/.test(id)
        if (!isPoint || defined.has(id)) continue
        if (issues.some((x) => x.indexOf("用到还没定义的 " + id) >= 0)) continue
        issues.push("第 " + (out.length + 1) + " 步用到还没定义的 " + id + "（前面没有 " + id + "=… 的定义）")
      }
      // 【v1731】读一步：表达式必须是只读、且引用的对象得在画布上 ✓
      if (s.query) {
        const q = ggbReadPlan(one, objects || [])
        if (!q.ok) issues.push("读数表达式不合法（" + (q.why || "认不出") + "）：" + one.slice(0, 40))
      }
      // 【v1732】删一步：要删的对象得在画布上（或前面刚建过 ✓）
      if (s.tool === "delete") {
        for (const t of ggbDeleteTargets(one)) {
          if (!defined.has(t)) issues.push("要删的 " + t + " 在画布上没有（名字对得上吗 ✓）")
        }
      }
      out.push({ tool: s.tool, mode: s.mode, cmd: one, say: s.say, query: s.query })
    }
  }
  return { steps: out, issues, fixes }
}

/** 【v1729】回灌自愈的 system：**只改错的那几步** ✓ */
export function ggbRepairSystem(): string {
  const NL2 = String.fromCharCode(10)
  return [
    "你是 GeoGebra 作图的**修错员**：老师执行作图时，有几步报错了。",
    "你会拿到：题干 + 绘图板里**已有的对象名** + 出错的步骤（原指令 + 报错原文）。",
    "只做一件事：给出**修正后的那几步**（能跑通为止 ✓）。",
    "铁律：",
    "· 只给错的那几步，别重写全部、别动没报错的步骤 ✗；",
    "· 指令用 GeoGebra **原生语法**（不是 JS）；",
    "· 只引用**已有对象名**或你自己在前面几步新建的对象 ✗ 别引用不存在的对象；",
    "· 给的步数与出错步数一一对应（错了 3 步就给 3 步 ✓）。",
    "输出格式（**只输出 JSON**，别加解释、别包代码块）：",
    "{\"steps\":[{\"tool\":\"point\",\"cmd\":\"A=(0,0)\",\"say\":\"重建点 A\"}]}",
  ].join(NL2)
}

/** 【v1729】回灌自愈的 user 内容：题干 + 现成对象名 + 报错步骤 ✓ */
export function ggbRepairUser(failed: { cmd: string; err: string }[], objects: string[], briefText: string): string {
  const NL2 = String.fromCharCode(10)
  const fl = (failed || []).slice(0, 20).map((f, i) => (i + 1) + ". " + String(f.cmd || "") + "　→ 报错：" + String(f.err || "")).join(NL2)
  return "【题干】" + NL2 + String(briefText || "").trim() + NL2 + NL2 +
    "【绘图板已有对象】" + NL2 + ((objects || []).slice(0, 80).join("、") || "（还没有对象）") + NL2 + NL2 +
    "【出错的步骤】" + NL2 + (fl || "（无）")
}
/* ---------------- 【v1731】读数（query）：把画布上的**精确值**交回模型 ----------------
 * 依据（Draw2Think, arXiv:2605.20743）：模型侧最值钱的一层是 **query 读回** ——
 *   "readout is part of reasoning"：把引擎的精确状态变成可回答的证据；
 *   拿掉读回通道，模型就会走"内部推理 / 抄近路 / 无锚定作答"三条逃逸路线。
 * 这里做两件事：
 *   ① 模型可以**主动**插只读步骤（tool: query）问「AB 多长 / 这个角多少度 / 交点在哪 ✓」
 *   ② 跑完**自动量一批**（点坐标 / 线段长 / 半径 / 面积 ✓）交给模型自查「解题与图形是否自洽 ✓」
 * 实现：临时对象量一下 → 立刻删掉 ✓ 画布不留垃圾 ✓
 */

/** 【v1731】读数用的临时对象名（量完立刻删 ✓ 真要撞名也无所谓：它是临时值 ✓） */
export const GGB_QUERY_TMP = "ljqTemp"

/** 只读函数白名单：用它们量的东西**不会往画布上添对象** ✓（别的函数一律拒 ✗ 免得悄悄画东西 ✓） */
export const GGB_READ_FNS = [
  "Distance", "Length", "Angle", "Area", "Radius", "Circumference", "Perimeter", "Center",
  "Slope", "Midpoint", "Intersect", "x", "y", "abs", "sqrt", "sin", "cos", "tan", "atan", "pi", "π", "max", "min",
]

/** 【v1731】是不是"读一步"（tool 写 query / 读数 / 测量 / query_* 都认 ✓） */
export function isQueryTool(name: unknown): boolean {
  const s = String(name == null ? "" : name).trim().toLowerCase()
  if (!s) return false
  if (s === "query" || s === "read" || s === "measure" || s === "读数" || s === "测量" || s === "量一下") return true
  return s.indexOf("query_") === 0 || s.indexOf("read_") === 0 || s.indexOf("measure_") === 0
}

/** 【v1731】只读表达式 → 临时赋值指令（量完就删 ✓） */
export function ggbQueryCmd(expr: unknown): string {
  return GGB_QUERY_TMP + "=" + String(expr == null ? "" : expr).trim()
}

/**
 * 【v1731】校验一条读数表达式（纯函数 ✓ 探针盯着）：
 *  · 不许赋值（`=` 一律不行 ✗ —— 那是画东西，不是读数 ✓）
 *  · 函数必须在**只读白名单**里 ✓
 *  · 引用的对象名必须在**画布上已经存在**（objects 传进来 ✓）
 * 不合法就给出 why，调用方写进日志 ✓（不静默吞 ✗）
 */
export function ggbReadPlan(cmd: unknown, objects: string[] = []): { ok: boolean; expr: string; why?: string } {
  const expr = String(cmd == null ? "" : cmd).trim().slice(0, 200)
  if (!expr) return { ok: false, expr, why: "空的读数表达式" }
  if (expr.indexOf("=") >= 0) return { ok: false, expr, why: "读数不能是赋值（把 = 去掉 ✓）" }
  const ids = expr.match(/[A-Za-z_][A-Za-z0-9_']*/g) || []
  const known = new Set(objects || [])
  for (const id of ids) {
    if (GGB_READ_FNS.indexOf(id) >= 0) continue
    if (known.has(id)) continue
    return { ok: false, expr, why: "认不出「" + id + "」（只能用只读函数或画布上已有的对象 ✓）" }
  }
  return { ok: true, expr }
}

/**
 * 【v1731】一条原始条目 → 一步（ggbSolvePlan 与 ggbCheckResult 共用 ✓）
 *  · 读一步 → tool 记 query、query=true ✓（不切工具、不 evalCommand 作图 ✓）
 *  · 认不出工具名 → 不切工具但指令照跑 + note（保持 v1711 的老口径 ✓）
 */
function coerceStep(it: unknown): { step: GgbSolveStep | null; note?: string } {
  const o = (it && typeof it === "object" ? it : {}) as Record<string, unknown>
  const cmd = String(o.cmd == null ? "" : o.cmd).trim().slice(0, 300)
  const say = String(o.say == null ? "" : o.say).trim().slice(0, 60)
  const toolRaw = String(o.tool == null ? "" : o.tool).trim()
  if (!cmd) return { step: null, note: toolRaw ? "这一步只有工具没有指令，已跳过：" + toolRaw : undefined }
  if (isQueryTool(toolRaw)) return { step: { tool: "query", mode: -1, cmd, say, query: true } }
  const t = ggbToolOf(toolRaw)
  return {
    step: { tool: t ? t.key : "", mode: t ? t.mode : -1, cmd, say },
    note: toolRaw && !t ? "认不出的工具「" + toolRaw + "」→ 这一步不切工具，指令照跑" : undefined,
  }
}

/** 【v1731】一条读数 */
export interface GgbReadout { expr: string; value: string; ok: boolean; err?: string }

/** 【v1731】读数表 → 给模型看的一段 ✓ */
export function ggbReadoutText(rows: GgbReadout[]): string {
  const NL2 = String.fromCharCode(10)
  const list = (rows || []).slice(0, 40)
  if (!list.length) return "（这次没有读数）"
  return list.map((r) => "- " + r.expr + " = " + (r.ok ? r.value : "取不到" + (r.err ? "（" + r.err + "）" : ""))).join(NL2)
}

/**
 * 【v1731】**自动读数**：从作图步骤里推出"该量什么"（纯函数 ✓ 探针盯着）
 *  —— 模型没主动量也能核对 ✓ 而且量的是它自己刚画的东西 ✓
 *   · `X=(a,b)`        → x(X)、y(X)
 *   · `AB=Segment(A,B)`→ Distance(A,B)（Line 同理）
 *   · `c=Circle(...)`  → Radius(c)
 *   · `poly=Polygon(…)`→ Area(poly)
 *  上限 max 条（省 token ✓）
 */
export function ggbAutoQueries(steps: GgbSolveStep[], max = 12): string[] {
  const out: string[] = []
  const push = (e: string) => { if (out.length < max && out.indexOf(e) < 0) out.push(e) }
  for (const s of steps || []) {
    if (s.query) continue
    const c = String(s.cmd || "").trim()
    let m = /^([A-Za-z][A-Za-z0-9_']*)\s*=\s*\(/.exec(c)
    if (m) { push("x(" + m[1] + ")"); push("y(" + m[1] + ")"); continue }
    m = /^([A-Za-z][A-Za-z0-9_']*)\s*=\s*(?:Segment|Line|Ray)\s*\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)/.exec(c)
    if (m) { push("Distance(" + m[2] + "," + m[3] + ")"); continue }
    m = /^([A-Za-z][A-Za-z0-9_']*)\s*=\s*Circle\s*\(/.exec(c)
    if (m) { push("Radius(" + m[1] + ")"); continue }
    m = /^([A-Za-z][A-Za-z0-9_']*)\s*=\s*Polygon\s*\(/.exec(c)
    if (m) { push("Area(" + m[1] + ")"); continue }
  }
  return out
}

/** 【v1731】核对轮的 system：**用读数核对解题与图形是否自洽** ✓ */
export function ggbCheckSystem(): string {
  const NL2 = String.fromCharCode(10)
  return [
    "你是几何作图的**核对员**：老师刚照你给的步骤在 GeoGebra 上画完图，画布会给出**精确读数**。",
    "你要做一件事：用这些精确读数核对**解题过程与图形是否自洽**（长度 / 角度 / 坐标 / 面积对得上吗 ✓）。",
    "铁律：",
    "· 只依据**读数与题干**判断 ✗ 别凭感觉；读数与题干冲突时以**题干**为准 ✓ 并说清冲突在哪一步；",
    "· verdict = ok：note 一句话说明依据 ✓；verdict = mismatch：note 要写清**哪里不对、该改成什么** ✓；",
    "· 信息不够（读数太少 / 题干不清）就 verdict = unsure ✗ 别硬判；",
    "· 要改图就给 steps（GeoGebra 原生指令 ✓ **只给要改的那几步** ✓ 不用改就给空数组 ✓）。",
    "输出格式（**只输出 JSON**，别加解释、别包代码块）：",
    "{\"verdict\":\"ok|mismatch|unsure\",\"note\":\"一句话结论（说清依据）\",\"steps\":[{\"tool\":\"point\",\"cmd\":\"A=(0,0)\",\"say\":\"改点 A\"}]}",
  ].join(NL2)
}

/** 【v1731】核对轮的 user 内容：题干 + 解题过程 + 作图步骤 + **精确读数** ✓ */
export function ggbCheckUser(briefText: string, solutionText: string, cmds: string[], readouts: GgbReadout[]): string {
  const NL2 = String.fromCharCode(10)
  return "【题干】" + NL2 + String(briefText || "").trim() + NL2 + NL2 +
    "【你的解题过程】" + NL2 + String(solutionText || "").trim() + NL2 + NL2 +
    "【画布上执行的作图步骤】" + NL2 + (((cmds || []).map((c) => "- " + c).join(NL2)) || "（无）") + NL2 + NL2 +
    "【画布精确读数】" + NL2 + ggbReadoutText(readouts)
}

/** 【v1731】核对结果 */
export interface GgbCheck { verdict: "ok" | "mismatch" | "unsure"; note: string; steps: GgbSolveStep[] }

/** 【v1731】核对回答 → 结论（纯函数 ✓ 容错：JSON 抠取 / 认不出的 verdict 归 unsure ✓） */
export function ggbCheckResult(raw: unknown, objects: string[] = []): GgbCheck {
  const text = String(raw == null ? "" : raw)
  const obj = pickJson(text) as { verdict?: unknown; note?: unknown; steps?: unknown } | null
  if (!obj) return { verdict: "unsure", note: text.trim().slice(0, 600) || "（模型没给出可解析的核对结果）", steps: [] }
  const v = String(obj.verdict == null ? "" : obj.verdict).trim().toLowerCase()
  const verdict: GgbCheck["verdict"] = v === "ok" || v === "mismatch" || v === "unsure" ? v : "unsure"
  const steps: GgbSolveStep[] = []
  for (const it of (Array.isArray(obj.steps) ? obj.steps : [])) {
    if (steps.length >= 20) break
    const c = coerceStep(it)
    if (!c.step) continue
    // 修正步里的读数也要合法（不然又是一次白跑 ✗）
    if (c.step.query && !ggbReadPlan(c.step.cmd, objects).ok) continue
    steps.push(c.step)
  }
  return { verdict, note: String(obj.note == null ? "" : obj.note).trim().slice(0, 800), steps }
}
/* ---------------- 【v1732】删除（delete）与依赖闭包：画错了能撤，撤得干净 ----------------
 * 依据 Draw2Think 的工具分类学：Deletion 的状态效果是 `S' = S \ {target ∪ dependents}`
 *   —— 删一个对象要**连依赖它的**一起掉；它的 §5 专门做了 `ablation_wo_delete`（说明这一层不是可有可无 ✓）。
 *
 * 这里给的是**纯函数**（探针能盯 ✓）：
 *   · ggbRefsOf(cmd)        —— 一条指令引用了哪些对象（函数名 / 赋值目标都不算 ✓）
 *   · ggbPlanGraph(steps)   —— plan 级依赖图（名字 → 它引用了谁 ✓）
 *   · ggbDeleteClosure(t, g)—— 删 t 时要连带删掉谁（**传递闭包** ✓ 含 t 自己 ✓）
 *   · ggbDeleteTargets(cmd) —— 从 Delete(A,B) / 删除(A) / 光写名字 里抠出目标 ✓
 * 运行时优先问绘图板自己的 getDependentObjects ✓，拿不到就用 plan 图兜底 ✓。
 */

/** 【v1732】一条指令里**引用的对象名**：
 *  · 后面紧跟 `(` 的标识符是**函数名**（Segment / Circle / Distance / x …）✗ 不算引用
 *  · 行首 `X=…` / `f(x)=…` 里的 X 是**定义的名字** ✗ 不算引用
 */
export function ggbRefsOf(cmd: unknown): string[] {
  const s = String(cmd == null ? "" : cmd).trim()
  // 定义目标：行首 `X=…` / `f(x)=…` 里的 X —— 它在**整个表达式里**都不算引用 ✓
  // （【v1734】修：原来只跳过行首那一次 ✗，`B=Segment(A,B)` 会把参数里的 B 也算成依赖 → 多一条边 ✗）
  const dm = /^([A-Za-z_][A-Za-z0-9_']*)\s*(?:\([^)]*\))?\s*=/.exec(s)
  const defName = dm ? dm[1] : ""
  const out: string[] = []
  const re = /[A-Za-z_][A-Za-z0-9_']*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    const id = m[0]
    const rest = s.slice(m.index + id.length)
    const isCall = /^\s*\(/.test(rest)          // 函数名（Segment / Circle / Distance …）
    if (isCall || id === defName) continue      // 函数名 / 定义目标本身 ✗ 都不算引用
    if (out.indexOf(id) < 0) out.push(id)
  }
  return out
}

/** 【v1732】plan 级依赖图的一项：这个对象引用了谁 */
export interface GgbDep { name: string; refs: string[] }

/** 【v1732】从作图步骤推出依赖图（读数步不产对象 ✗ 跳过 ✓）—— 纯函数 ✓ */
export function ggbPlanGraph(steps: GgbSolveStep[]): GgbDep[] {
  const out: GgbDep[] = []
  for (const s of steps || []) {
    if (s.query) continue
    const c = String(s.cmd || "").trim()
    const m = /^([A-Za-z][A-Za-z0-9_']*)\s*(?:\([^)]*\))?\s*=/.exec(c)
    if (!m) continue
    out.push({ name: m[1], refs: ggbRefsOf(c) })
  }
  return out
}

/**
 * 【v1732】删 `target` 时，plan 里还有谁要跟着掉（**传递闭包** ✓ 含 target 自己 ✓）
 *  —— 这就是 Draw2Think 说的 `target ∪ dependents` ✓
 */
export function ggbDeleteClosure(target: unknown, graph: GgbDep[]): string[] {
  const t = String(target == null ? "" : target).trim()
  if (!t) return []
  const out: string[] = [t]
  let grew = true
  while (grew) {
    grew = false
    for (const d of graph || []) {
      if (out.indexOf(d.name) >= 0) continue
      if ((d.refs || []).some((r) => out.indexOf(r) >= 0)) { out.push(d.name); grew = true }
    }
  }
  return out
}

/** 【v1732】删一步的目标：`Delete(A,B)` / `删除(A)` / 光写 `A` 都认 ✓（宽容，认不出的丢掉 ✓） */
export function ggbDeleteTargets(cmd: unknown): string[] {
  const s = String(cmd == null ? "" : cmd).trim()
  if (!s) return []
  const m = /^(?:Delete|delete|删除)\s*\(([^)]*)\)\s*$/.exec(s)
  const body = m ? m[1] : s
  const out: string[] = []
  for (const raw of body.split(/[,，\s]+/)) {
    const t = raw.trim()
    if (/^[A-Za-z_][A-Za-z0-9_']*$/.test(t) && out.indexOf(t) < 0) out.push(t)
  }
  return out
}
