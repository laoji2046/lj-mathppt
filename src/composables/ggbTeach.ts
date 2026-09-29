/**
 * 【v1737】教学图约定（Math2GGB 的三张图 → 落到我们的能力上）
 *
 * Math2GGB 的三张交付：① 静态复刻图 ② 干净可交互图（约束辅助**保留但隐藏**）③ 动态理解图（辅助挂**一个开关**）
 * 我们能原生做的是它**共同的那一半**（也是最难的一半 ✓）：
 *   · 所有条件用**真依赖**表达 ✓（不是手打坐标凑 ✗）—— 已有：拖动测试会验 ✓
 *   · 约束辅助对象**保留但隐藏** ✓（真引擎实测：关掉后对象仍在板上 ✓ 导出仍在 ✓ —— 「隐藏 ≠ 删除」✓）
 *   · 教学辅助统统挂在**一个「显示辅助」开关**上 ✓（真引擎实测 `Checkbox("显示辅助", {…})` **可用** ✓）
 *   · 验证脚手架**删除**（不是隐藏 ✗）—— 我们的读数临时对象已经是量完就删 ✓
 *
 * 真引擎实测（v1737）：`Checkbox` / `SetConditionToShowObject` / `SetCaption` 都返回 false **但真的生效** ✗
 *   → 一律"看结果" ✓
 */

/** 【v1737】「显示辅助」开关的固定对象名（好找、好查 ✓ 不带空格免得命令行里要引号 ✓） */
export const AIDS_NAME = 'aidsShow'

export interface AidsPlan { ok: boolean; cmds: string[]; caption: string; items: string[]; why?: string }

/**
 * 【v1737】教学辅助 → 一个开关（纯函数 ✓ 探针盯着）
 *  · 一条 `Checkbox("显示辅助", {h1, h2})` 就把它们全挂上 ✓（真引擎实测可用 ✓）
 *  · 默认**关着**（讲课时再打开 ✓ 与"静态复刻图"一致 ✓）
 *  · 名字与说明都写进 notes 交给日志 ✓
 */
export function aidsPlan(caption: unknown, objs: unknown, objects: string[] = []): AidsPlan {
  const cap = String(caption == null ? '' : caption).trim() || '显示辅助'
  const raw = Array.isArray(objs) ? objs : String(objs == null ? '' : objs).split(/[,，\s]+/)
  const items: string[] = []
  for (const x of raw) {
    const n = String(x == null ? '' : x).trim()
    if (n && items.indexOf(n) < 0) items.push(n)
  }
  if (!items.length) return { ok: false, cmds: [], caption: cap, items, why: '没说哪些对象算「辅助」（格式：说明|对象1,对象2 ✓）' }
  if ((objects || []).length) {
    const miss = items.filter((n) => (objects || []).indexOf(n) < 0)
    if (miss.length) return { ok: false, cmds: [], caption: cap, items, why: '板上没有这些对象：' + miss.join('、') + '（先建它们 ✓）' }
  }
  const list = items.map((n) => n).join(', ')
  return {
    ok: true,
    caption: cap,
    items,
    cmds: [
      AIDS_NAME + '=Checkbox("' + cap.replace(/"/g, '') + '", {' + list + '})',
      'SetValue(' + AIDS_NAME + ', false)',   // 默认关着 ✓ 与"静态复刻图"一致 ✓
    ],
  }
}

/** 【v1737】给老师看的说明（纯函数 ✓） */
export function aidsDescribe(plan: AidsPlan): string[] {
  if (!plan.ok) return ['辅助开关没做成：' + (plan.why || '认不出')]
  return [
    '教学辅助已挂到一个开关上：' + plan.caption + '（' + plan.items.join('、') + ' ✓）',
    '· 默认关着 ✓（讲课时在画板左上角勾上它，辅助线/标注才出现 ✓ 取消勾选就回到原图 ✓）',
    '· 这些辅助对象保留但隐藏（不是删掉 ✗）—— 真引擎实测：关掉后对象仍在板上、导出也还在 ✓',
  ]
}

/**
 * 【v1737】问题建模契约（GeoChat v0.6.1 的 8 条，**按我们的口径重写** ✓ 不是照抄 ✗）
 * 进 system 提示词，让"想清楚再画"变成硬要求 ✓
 */
export const TEACH_CONTRACT: string[] = [
  '【问题建模契约】（八条，先想清楚再动手 ✓）',
  '① 观察目标：先一句话说清"这道题要你看懂什么"（求值 / 证明 / 轨迹 / 动态关系 ✓）。',
  '② 数学对象：把点、线、圆、函数分开列；**给语义名**（如 A、B、C、O、l、c ✓），别用没意义的 P1、P2。',
  '③ 参数与自由度：标出**哪些是驱动量**（可以拖的，如边长、角度、滑块）、哪些是**派生量**（由约束算出来的）✓。',
  '④ 关系与依赖：写清"谁由谁定"（原因 → 中间量 → 结果 ✓）—— 作图指令必须按这个顺序排 ✓。',
  '⑤ 交互与状态：要动画就给滑块（`Slider(0,10,0.1)` ✓）；要讲解辅助就挂到一个开关上 ✓。',
  '⑥ 信息编码：**展示层不得反向影响数学正确性** ✗ —— 颜色、标注、标题只是展示 ✓ 不许用它们"补"数学关系 ✗。',
  '⑦ 验证与解释：建完要能**量出来**（长度 / 角度 / 面积 ✓）；解释用学生听得懂的话 ✓。',
  '⑧ 失败恢复：同一条关系**连续两次**没做成就别再试了 ✗ —— 换一种构造、或如实说"这里做不到"，**不许用样式改动掩盖错误** ✗。',
]
