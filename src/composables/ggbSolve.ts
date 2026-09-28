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
    "输出格式（**只输出 JSON**，别加解释、别包代码块）：",
    "{\"solution\":\"解题过程（可用换行与 $公式$）\",\"steps\":[{\"tool\":\"point\",\"cmd\":\"A=(0,0)\",\"say\":\"建点 A\"},{\"tool\":\"circle\",\"cmd\":\"Circle(A,B)\",\"say\":\"以 A 为心过 B 作圆\"}]}",
    "steps 按作图顺序排；一步只做一件事（先切工具、再一条指令）；题目里用不到的工具别硬凑。",
  ].join(NL2)
}

export interface GgbSolveStep { tool: string; mode: number; cmd: string; say: string }
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
    const o = (it && typeof it === "object" ? it : {}) as Record<string, unknown>
    const cmd = String(o.cmd == null ? "" : o.cmd).trim().slice(0, 300)
    const say = String(o.say == null ? "" : o.say).trim().slice(0, 60)
    const toolRaw = String(o.tool == null ? "" : o.tool).trim()
    const t = ggbToolOf(toolRaw)
    if (!cmd) { if (toolRaw) notes.push("这一步只有工具没有指令，已跳过：" + toolRaw); continue }
    if (toolRaw && !t) notes.push("认不出的工具「" + toolRaw + "」→ 这一步不切工具，指令照跑")
    steps.push({ tool: t ? t.key : "", mode: t ? t.mode : -1, cmd, say })
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
  return "带图要用**视觉模型**：设置 → AI 助手 → 视觉模型（填模型名，必要时填端点）—— 没填的话，图根本送不进模型"
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
export function ggbValidatePlan(steps: GgbSolveStep[]): GgbPlanCheck {
  const out: GgbSolveStep[] = []
  const issues: string[] = []
  const fixes: string[] = []
  const defined = new Set<string>()
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
      out.push({ tool: s.tool, mode: s.mode, cmd: one, say: s.say })
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
