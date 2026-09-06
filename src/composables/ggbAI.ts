/**
 * 离线规则式「AI 作图助手」：把中文几何作图描述解析成 GeoGebra 命令。
 * - 自动补齐被引用的点（未定义则按规则放一个默认坐标）。
 * - 常见作图：点/线段/直线/射线/三角形/多边形/正多边形/圆/中点/垂线/平行线/角平分线。
 * - 覆盖常见句型；复杂描述可拆成多条子句（用 ，。； 分隔）。
 */
const POINTS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function defaultCoord(lab: string): [number, number] {
  const i = POINTS.indexOf(lab.toUpperCase())
  const x = -6 + (i * 7) % 12
  const y = -4 + (i * 5) % 8
  return [x, y]
}

function stripCmd(cl: string): string {
  return cl
    .replace(/^(?:请|帮我|我|请帮我|请|作|画出|画|构造|建立|绘制)/i, '')
    .trim()
}

export function describeToCommands(desc: string): string[] {
  const cmds: string[] = []
  const defined = new Set<string>()
  function ensurePoint(lab: string) {
    const L = lab.toUpperCase()
    if (!defined.has(L)) {
      defined.add(L)
      const [x, y] = defaultCoord(L)
      cmds.push(L + '=(' + x + ',' + y + ')')
    }
  }
  function done(label: string) { defined.add(label) }

  const clauses = desc.split(/[。；;\n]/).map((s) => s.trim()).filter(Boolean)
  for (const raw of clauses) {
    let cl = raw.replace(/[，,．]/g, ' ').replace(/\s+/g, ' ').trim()
    cl = stripCmd(cl)
    let m: RegExpMatchArray | null

    // 点 A(1,2)
    if ((m = cl.match(/^点\s*([A-Za-z])\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)$/))) {
      cmds.push(m[1].toUpperCase() + '=(' + m[2] + ',' + m[3] + ')'); done(m[1].toUpperCase()); continue
    }
    // 点 A
    if ((m = cl.match(/^点\s*([A-Za-z])$/))) { ensurePoint(m[1]); continue }
    // 线段 AB
    if ((m = cl.match(/^(?:线段|边)\s*([A-Za-z])([A-Za-z])$/i))) { ensurePoint(m[1]); ensurePoint(m[2]); cmds.push('Segment(' + m[1].toUpperCase() + ',' + m[2].toUpperCase() + ')'); continue }
    // 直线 AB
    if ((m = cl.match(/^直线\s*([A-Za-z])([A-Za-z])$/i))) { ensurePoint(m[1]); ensurePoint(m[2]); cmds.push('Line(' + m[1].toUpperCase() + ',' + m[2].toUpperCase() + ')'); continue }
    // 射线 AB
    if ((m = cl.match(/^射线\s*([A-Za-z])([A-Za-z])$/i))) { ensurePoint(m[1]); ensurePoint(m[2]); cmds.push('Ray(' + m[1].toUpperCase() + ',' + m[2].toUpperCase() + ')'); continue }
    // 等边三角形 ABC（边 AB，C 由绕 A 转 60° 得到）
    if ((m = cl.match(/^(?:等边三角形|正三角形)\s*([A-Za-z])([A-Za-z])([A-Za-z])$/i))) {
      ensurePoint(m[1]); const [x2, y2] = defaultCoord(m[2].toUpperCase()); cmds.push(m[2].toUpperCase() + '=(' + (x2 + 3) + ',' + y2 + ')'); done(m[2].toUpperCase());
      cmds.push(m[3].toUpperCase() + '=Rotate(' + m[2].toUpperCase() + ',60°,(' + m[1].toUpperCase() + '))'); done(m[3].toUpperCase());
      cmds.push('Polygon(' + m[1].toUpperCase() + ',' + m[2].toUpperCase() + ',' + m[3].toUpperCase() + ')'); continue
    }
    // 直角三角形 ABC（直角在 A）
    if ((m = cl.match(/^直角三角形\s*([A-Za-z])([A-Za-z])([A-Za-z])$/i))) {
      ensurePoint(m[1]); cmds.push(m[2].toUpperCase() + '=(' + (defaultCoord(m[2].toUpperCase())[0] + 3) + ',' + defaultCoord(m[2].toUpperCase())[1] + ')'); done(m[2].toUpperCase());
      cmds.push(m[3].toUpperCase() + '=(' + defaultCoord(m[1].toUpperCase())[0] + ',' + (defaultCoord(m[3].toUpperCase())[1] - 4) + ')'); done(m[3].toUpperCase());
      cmds.push('Polygon(' + m[1].toUpperCase() + ',' + m[2].toUpperCase() + ',' + m[3].toUpperCase() + ')'); continue
    }
    // 三角形 ABC
    if ((m = cl.match(/^(?:三角形|△)\s*([A-Za-z])([A-Za-z])([A-Za-z])$/i))) { ensurePoint(m[1]); ensurePoint(m[2]); ensurePoint(m[3]); cmds.push('Polygon(' + m[1].toUpperCase() + ',' + m[2].toUpperCase() + ',' + m[3].toUpperCase() + ')'); continue }
    // 正多边形 A B n
    if ((m = cl.match(/^正\s*(?:多边形|边形)?\s*([A-Za-z])([A-Za-z])\s*[, ]?\s*(\d+)$/i))) { ensurePoint(m[1]); ensurePoint(m[2]); cmds.push('RegularPolygon(' + m[1].toUpperCase() + ',' + m[2].toUpperCase() + ',' + m[3] + ')'); continue }
    // 四边形 ABCD...
    if ((m = cl.match(/^(?:四边形|五边形|多边形)\s*([A-Za-z]+)$/i))) {
      const labs = m[1].toUpperCase().split('')
      if (labs.length >= 3) { labs.forEach(ensurePoint); cmds.push('Polygon(' + labs.join(',') + ')') }
      continue
    }
    // 圆 O A（圆心 O，过 A）
    if ((m = cl.match(/^圆\s*([A-Za-z])\s*([A-Za-z])$/i))) { ensurePoint(m[1]); ensurePoint(m[2]); cmds.push('Circle(' + m[1].toUpperCase() + ',' + m[2].toUpperCase() + ')'); continue }
    // 圆 O 3（圆心 O，半径 3）
    if ((m = cl.match(/^圆\s*([A-Za-z])\s*[, ]?(-?\d+(?:\.\d+)?)$/i))) { ensurePoint(m[1]); cmds.push('Circle(' + m[1].toUpperCase() + ',' + m[2] + ')'); continue }
    // 中点：M 是 AB 的中点（带/不带 点）
    if ((m = cl.match(/^点?\s*([A-Za-z])\s*是\s*(?:线段|边)?\s*([A-Za-z])([A-Za-z])\s*的?中点$/i))) { ensurePoint(m[2]); ensurePoint(m[3]); cmds.push(m[1].toUpperCase() + '=Midpoint(' + m[2].toUpperCase() + ',' + m[3].toUpperCase() + ')'); done(m[1].toUpperCase()); continue }
    // AB 中点 M
    if ((m = cl.match(/^(?:线段|边)?\s*([A-Za-z])([A-Za-z])\s*的?中点\s*(?:为|是)?\s*([A-Za-z])$/i))) { ensurePoint(m[1]); ensurePoint(m[2]); cmds.push(m[3].toUpperCase() + '=Midpoint(' + m[1].toUpperCase() + ',' + m[2].toUpperCase() + ')'); done(m[3].toUpperCase()); continue }
    // 过 P 作 AB 的垂线
    if ((m = cl.match(/^过\s*([A-Za-z])\s*作\s*(?:线段|边)?\s*([A-Za-z])([A-Za-z])\s*的垂线$/i))) { ensurePoint(m[1]); ensurePoint(m[2]); ensurePoint(m[3]); cmds.push('PerpendicularLine(' + m[1].toUpperCase() + ',' + m[2].toUpperCase() + ',' + m[3].toUpperCase() + ')'); continue }
    // 过 P 作 AB 的平行线
    if ((m = cl.match(/^过\s*([A-Za-z])\s*作\s*(?:线段|边)?\s*([A-Za-z])([A-Za-z])\s*的平行线$/i))) {
      ensurePoint(m[1]); const lab = 'l_par'; cmds.push(lab + '=Line(' + m[2].toUpperCase() + ',' + m[3].toUpperCase() + ')'); cmds.push('ParallelLine(' + m[1].toUpperCase() + ',' + lab + ')'); continue
    }
    // ∠ABC 的角平分线
    if ((m = cl.match(/^(?:角|∠)?\s*([A-Za-z])([A-Za-z])([A-Za-z])\s*的?角平分线$/i))) { ensurePoint(m[1]); ensurePoint(m[2]); ensurePoint(m[3]); cmds.push('AngleBisector(' + m[1].toUpperCase() + ',' + m[2].toUpperCase() + ',' + m[3].toUpperCase() + ')'); continue }
    // 等腰三角形 ABC（AB=AC，C 在 AB 中垂线上方）
    if ((m = cl.match(/^等腰三角形\s*([A-Za-z])([A-Za-z])([A-Za-z])$/i))) { ensurePoint(m[1]); cmds.push(m[2].toUpperCase() + '=(' + (defaultCoord(m[2].toUpperCase())[0] + 3) + ',' + defaultCoord(m[2].toUpperCase())[1] + ')'); done(m[2].toUpperCase()); cmds.push(m[3].toUpperCase() + '=(1.5,2.5)'); done(m[3].toUpperCase()); cmds.push('Polygon(' + m[1].toUpperCase() + ',' + m[2].toUpperCase() + ',' + m[3].toUpperCase() + ')'); continue }
    // 等腰直角三角形 ABC（直角在 A）
    if ((m = cl.match(/^等腰直角三角形\s*([A-Za-z])([A-Za-z])([A-Za-z])$/i))) { ensurePoint(m[1]); cmds.push(m[2].toUpperCase() + '=(' + (defaultCoord(m[2].toUpperCase())[0] + 3) + ',' + defaultCoord(m[2].toUpperCase())[1] + ')'); done(m[2].toUpperCase()); cmds.push(m[3].toUpperCase() + '=(' + defaultCoord(m[1].toUpperCase())[0] + ',' + (defaultCoord(m[1].toUpperCase())[1] + 3) + ')'); done(m[3].toUpperCase()); cmds.push('Polygon(' + m[1].toUpperCase() + ',' + m[2].toUpperCase() + ',' + m[3].toUpperCase() + ')'); continue }
    // 正方形 ABCD（边 AB）
    if ((m = cl.match(/^正方形\s*([A-Za-z])([A-Za-z])([A-Za-z])([A-Za-z])$/i))) { ensurePoint(m[1]); ensurePoint(m[2]); cmds.push(m[3].toUpperCase() + '=Rotate(' + m[2].toUpperCase() + ',90°,(' + m[1].toUpperCase() + '))'); done(m[3].toUpperCase()); cmds.push(m[4].toUpperCase() + '=Rotate(' + m[1].toUpperCase() + ',-90°,(' + m[2].toUpperCase() + '))'); done(m[4].toUpperCase()); cmds.push('Polygon(' + m[1].toUpperCase() + ',' + m[2].toUpperCase() + ',' + m[3].toUpperCase() + ',' + m[4].toUpperCase() + ')'); continue }
    // 平行四边形 ABCD（D = A + C - B）
    if ((m = cl.match(/^平行四边形\s*([A-Za-z])([A-Za-z])([A-Za-z])([A-Za-z])$/i))) { ensurePoint(m[1]); ensurePoint(m[2]); ensurePoint(m[3]); cmds.push(m[4].toUpperCase() + '=' + m[1].toUpperCase() + '+' + m[3].toUpperCase() + '-' + m[2].toUpperCase()); done(m[4].toUpperCase()); cmds.push('Polygon(' + m[1].toUpperCase() + ',' + m[2].toUpperCase() + ',' + m[3].toUpperCase() + ',' + m[4].toUpperCase() + ')'); continue }
    // 梯形 ABCD（上底 DC ∥ 下底 AB，近似）
    if ((m = cl.match(/^梯形\s*([A-Za-z])([A-Za-z])([A-Za-z])([A-Za-z])$/i))) { ensurePoint(m[1]); cmds.push(m[2].toUpperCase() + '=(' + (defaultCoord(m[2].toUpperCase())[0] + 4) + ',' + defaultCoord(m[2].toUpperCase())[1] + ')'); done(m[2].toUpperCase()); cmds.push(m[3].toUpperCase() + '=(3,2.2)'); done(m[3].toUpperCase()); cmds.push(m[4].toUpperCase() + '=(1.4,2.2)'); done(m[4].toUpperCase()); cmds.push('Polygon(' + m[1].toUpperCase() + ',' + m[2].toUpperCase() + ',' + m[3].toUpperCase() + ',' + m[4].toUpperCase() + ')'); continue }
    // 椭圆 焦点F1 F2 半长轴a
    if ((m = cl.match(/^椭圆\s*([A-Za-z])\s*[, ]?([A-Za-z])\s*[, ]?(\d+(?:\.\d+)?)$/i))) { ensurePoint(m[1]); ensurePoint(m[2]); cmds.push('Ellipse(' + m[1].toUpperCase() + ',' + m[2].toUpperCase() + ',' + m[3] + ')'); continue }
    // 双曲线 焦点F1 F2 半实轴a
    if ((m = cl.match(/^双曲线\s*([A-Za-z])\s*[, ]?([A-Za-z])\s*[, ]?(\d+(?:\.\d+)?)$/i))) { ensurePoint(m[1]); ensurePoint(m[2]); cmds.push('Hyperbola(' + m[1].toUpperCase() + ',' + m[2].toUpperCase() + ',' + m[3] + ')'); continue }
    // 抛物线 焦点F 准线l
    if ((m = cl.match(/^抛物线\s*([A-Za-z])\s*[, ]?([A-Za-z]\w*)$/i))) { ensurePoint(m[1]); cmds.push('Parabola(' + m[1].toUpperCase() + ',' + m[2] + ')'); continue }
    // 典型函数 / 方程：y=...、f(x)=...、或含 x,y 的方程（如 x^2/4+y^2/9=1）
    let eqCl = cl.replace(/^(?:椭圆|双曲线|抛物线|圆|函数|图像|图象|曲线|方程)\s*/i, '')
    if (/=/.test(eqCl) && /(?:^|[^A-Za-z])(?:x|y|f\s*\(x\))/.test(eqCl) && !/^[A-Za-z]{1,2}\s*=\s*[\d.]/.test(eqCl)) { cmds.push(eqCl); continue }
  }
  return cmds
}

export function previewCommands(desc: string): string[] {
  return describeToCommands(desc)
}
