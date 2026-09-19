//! 题目**来源**归一化 —— 单一事实源。
//!
//! 借鉴 xiaochen-math-treasure 的 mathbank/source_normalize.py（它把 1312 题 95 种来源规整到 88 种，
//! 合规率 36% → 100%）。这里保留它全部关键设计，但**零新依赖**（不引 regex：全部字符串操作）。
//!
//! 六类命名规约：
//!   校内考试 : {学段} · {考试类型} · {学校} · {学年}
//!   高考真题 : {年份} · {卷种} · 高考真题
//!   模拟     : {年份} · {地区} · 模拟
//!   联考     : {年份} · {考试名} · 联考
//!   专题汇编 : 高考 · 专题汇编 · {专题}
//!   教辅自编 : 教辅 · {名称}
//!   空值     : 未知
//!
//! 归一分两层：
//!   **Tier 1** 精确别名表 —— 内置通用 + **运行时从库外配置加载**（校本条目不进仓库）
//!   **Tier 2** 结构兜底 —— 剥噪声尾缀 → 归一分隔符 → 归一卷种罗马数字
//!
//! 三条防护：
//!   1. 合规判定（is_canonical）→ 幂等保护：已合规的原样返回，避免二次加工；
//!   2. LaTeX 幻觉拦截：模型可能把 \begin{tikzpicture} 塞进来源字段；
//!   3. 校本配置放库外：缺失 / 坏 JSON **静默回退**，不阻断入库。
//!
//! ⚠ 分隔符是**两侧带空格**的 " · "；高考真题是唯一例外（历史上大量无空格写法，
//!   两种都算合规，否则同一份卷会裂成两条来源）。

use std::collections::HashMap;
use std::path::PathBuf;

/// 规约分隔符（两侧带空格）
pub const SEP: &str = " · ";
/// 空值兜底
pub const UNKNOWN: &str = "未知";

/// 噪声尾缀：**只保留「具体、几乎不会出现在真实标题里」的**。
/// ⚠ 泛化的「试卷」「试题」已刻意移除 —— 否则会误伤真实标题（如「公式保真测试卷」末二字被整段截掉）。
const NOISE: &[&str] = &[
    "数学试题", "数学试卷",
    "（原卷版）", "(原卷版)", "（解析版）", "(解析版)", "解析版", "原卷版",
    "（全国通用）", "(全国通用)",
    "（理科）", "(理科)", "（文科）", "(文科)",
    "★", "☆",
];

fn is_year(s: &str) -> bool {
    s.len() == 4 && s.chars().all(|c| c.is_ascii_digit())
}

/// 按规约分隔符切；兼容无空格写法（高考真题的历史形态）
fn split_sep(t: &str) -> Vec<String> {
    if t.contains(SEP) {
        t.split(SEP).map(|s| s.trim().to_string()).collect()
    } else if t.contains('·') {
        t.split('·').map(|s| s.trim().to_string()).collect()
    } else {
        vec![t.trim().to_string()]
    }
}


/// 占位符：「？」这类表示「这里要人补」。
/// **占位符不算成型** —— 否则「高三 · ？ · ？ · ？-？学年」也会被算进成型率，指标立刻变假 ✗
fn is_placeholder(s: &str) -> bool {
    let t = s.trim();
    t.is_empty() || t.chars().all(|c| c == '？' || c == '?' || c == '-' || c == '—')
}

/// 是否已符合某一类模板（幂等保护 + 批量报告残留都用它）
pub fn is_canonical(t: &str) -> bool {
    let s = t.trim();
    if s.is_empty() || s == UNKNOWN {
        return true;
    }
    let p = split_sep(s);
    // 任何一段是占位符 → 还没成型（要人补），别让它混进成型率 ✗
    if p.iter().any(|x| is_placeholder(x)) {
        return false;
    }
    match p.len() {
        // 校内：高一上 · 期末 · 某某中学 · 2025-2026学年
        4 => p[0].starts_with('高') && p[3].ends_with("学年"),
        3 => {
            (is_year(&p[0]) && (p[2] == "高考真题" || p[2] == "模拟" || p[2] == "联考"))
                || (p[0] == "高考" && p[1] == "专题汇编")
        }
        2 => p[0] == "教辅",
        _ => false,
    }
}

/// 判类别（六类 + 未知）。**老数据多半不成型**，所以额外做一次「线索兜底」，
/// 让统计口径诚实：认不出就是「未知」，不硬塞。
pub fn kind_of(t: &str) -> &'static str {
    let s = t.trim();
    if s.is_empty() || s == UNKNOWN {
        return "未知";
    }
    let p = split_sep(s);
    if p.len() == 4 && p[0].starts_with('高') && p[3].ends_with("学年") {
        return "校内";
    }
    if p.len() == 3 {
        if is_year(&p[0]) {
            match p[2].as_str() {
                "高考真题" => return "高考真题",
                "模拟" => return "模拟",
                "联考" => return "联考",
                _ => {}
            }
        }
        if p[0] == "高考" && p[1] == "专题汇编" {
            return "专题汇编";
        }
    }
    if p.len() == 2 && p[0] == "教辅" {
        return "教辅";
    }
    // 线索兜底（只为统计，不改变原始字符串）
    if s.contains("高考") {
        return "高考真题";
    }
    if s.contains("一模") || s.contains("二模") || s.contains("三模") || s.ends_with("模拟") {
        return "模拟";
    }
    if s.contains("联考") {
        return "联考";
    }
    if s.contains("学年") {
        return "校内";
    }
    "未知"
}

/// LaTeX / TikZ 片段判定：真实来源是「中文 + 分隔符」的可读字符串，绝不含反斜杠命令。
fn looks_like_latex(s: &str) -> bool {
    let b: Vec<char> = s.chars().collect();
    for i in 0..b.len() {
        if b[i] == '\\' && i + 1 < b.len() && b[i + 1].is_ascii_alphabetic() {
            return true;
        }
    }
    false
}

/// 卷种罗马数字归一：只处理「紧跟 卷 字」的独立大写罗马数字。
/// ⚠ 必须**从长到短**替换，否则 "II卷" 会被 "I卷" 先吃掉变成 "IⅠ卷"。
fn roman_fix(s: &str) -> String {
    let mut out = s.to_string();
    for (from, to) in [("III卷", "Ⅲ卷"), ("II卷", "Ⅱ卷"), ("I卷", "Ⅰ卷")] {
        if out.contains(from) {
            out = out.replace(from, to);
        }
    }
    out
}

/// Tier 2：剥噪声尾缀 + 折叠空白 + 归一分隔符 + 罗马数字
fn tier2(t: &str) -> String {
    let mut s = t.trim().replace('\u{3000}', " ");
    // 噪声尾缀可能叠着多个 → 循环剥
    loop {
        let before = s.clone();
        for n in NOISE {
            if let Some(rest) = s.strip_suffix(n) {
                s = rest.trim_end().to_string();
            }
        }
        if s == before {
            break;
        }
    }
    // 折叠内部空白（含连续空格）
    let mut folded = String::new();
    let mut prev_ws = false;
    for c in s.chars() {
        if c.is_whitespace() {
            if !prev_ws {
                folded.push(' ');
                prev_ws = true;
            }
        } else {
            folded.push(c);
            prev_ws = false;
        }
    }
    let s = folded.trim().to_string();
    // 原文本来就有分隔符 → 统一成规约写法（两侧带空格）
    let s = if s.contains('·') { split_sep(&s).join(SEP) } else { s };
    roman_fix(&s)
}

/// 归一入口。
/// **认不出结构时只做噪声清理、不硬判成「未知」** —— 老数据的可读信息不能丢。
pub fn normalize(raw: &str, map: &HashMap<String, String>) -> String {
    let t = raw.trim();
    if t.is_empty() {
        return UNKNOWN.to_string();
    }
    if looks_like_latex(t) {
        return UNKNOWN.to_string(); // 幻觉拦截
    }
    if let Some(hit) = map.get(t) {
        return hit.clone();
    }
    if is_canonical(t) {
        return t.to_string(); // 幂等保护
    }
    let t2 = tier2(t);
    if t2.is_empty() {
        return UNKNOWN.to_string();
    }
    if let Some(hit) = map.get(&t2) {
        return hit.clone();
    }
    t2
}

fn candidate_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(appdata) = std::env::var_os("APPDATA") {
        out.push(
            PathBuf::from(appdata)
                .join("lj-mathslides")
                .join("source_canonical_map.json"),
        );
    }
    if let Some(home) = std::env::var_os("USERPROFILE") {
        out.push(
            PathBuf::from(home)
                .join(".config")
                .join("lj-mathslides")
                .join("source_canonical_map.json"),
        );
    }
    out
}

/// 加载库外别名表（**首个存在且合法者胜出**；缺失 / 坏 JSON 静默回退成空表）。
/// 校本条目放这里 → 不进仓库，也不泄露学校名。
pub fn load_map() -> HashMap<String, String> {
    let mut map = HashMap::new();
    for p in candidate_paths() {
        let Ok(text) = std::fs::read_to_string(&p) else { continue };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        if let Some(o) = v.as_object() {
            for (k, val) in o {
                if let Some(sv) = val.as_str() {
                    let kk = k.trim();
                    if !kk.is_empty() && !sv.trim().is_empty() {
                        map.insert(kk.to_string(), sv.trim().to_string());
                    }
                }
            }
        }
        break; // 首个合法配置生效
    }
    map
}


/// —— 以下是【P1c】「来源归一建议」用的抽取工具（纯函数，零依赖） ——

/// 找第一个 4 位年份（1900..2100），且前后都不接数字（别把 5 位串里的一段当年份）
fn first_year(s: &str) -> Option<i32> {
    let cs: Vec<char> = s.chars().collect();
    let mut i = 0usize;
    while i + 3 < cs.len() {
        let is4 = cs[i..i + 4].iter().all(|c| c.is_ascii_digit())
            && (i == 0 || !cs[i - 1].is_ascii_digit())
            && (i + 4 >= cs.len() || !cs[i + 4].is_ascii_digit());
        if is4 {
            if let Ok(n) = cs[i..i + 4].iter().collect::<String>().parse::<i32>() {
                if (1900..2100).contains(&n) {
                    return Some(n);
                }
            }
        }
        i += 1;
    }
    None
}

/// 把年份 / 「届」 / 学段 / 类别词剥掉，剩下的当作「地区 / 考试名」（剥不出来就是空串）
fn slot_mid(s: &str) -> String {
    let cs: Vec<char> = s.chars().collect();
    let mut out = String::new();
    let mut i = 0usize;
    while i < cs.len() {
        let is4 = i + 3 < cs.len()
            && cs[i..i + 4].iter().all(|c| c.is_ascii_digit())
            && (i == 0 || !cs[i - 1].is_ascii_digit())
            && (i + 4 >= cs.len() || !cs[i + 4].is_ascii_digit());
        if is4 {
            i += 4;
            continue;
        }
        out.push(cs[i]);
        i += 1;
    }
    for w in [
        "届", "学年", "上学期", "下学期", "高三", "高二", "高一", "初中", "小学",
        "一模", "二模", "三模", "四模", "模拟", "联考", "高考", "真题",
    ] {
        out = out.replace(w, "");
    }
    // 中文标题里的空格是噪声（「8 月底」→「8月底」），规约串不该带它 ✓
    out.split_whitespace().collect::<Vec<_>>().join("")
}

/// 【P1c】套六类模板给一条**半成品建议**：只认得出类别 / 学段 / 学年，缺的部分写「？」。
///
/// 纪律：**绝不猜** —— 抽不出来的（学校名、地区）就留「？」，返回值**不保证 canonical**，
/// 调用方要按 is_canonical() 决定「直接能用」还是「要人工补」。
/// 已经成型的、认不出类别的、空串的 → 一律 None（不硬套模板）。
pub fn template_hint(raw: &str) -> Option<String> {
    let s = tier2(raw);
    if s.is_empty() || s == UNKNOWN || is_canonical(&s) {
        return None;
    }
    let y = first_year(&s).map(|n| n.to_string()).unwrap_or_else(|| "？".to_string());
    let mid = slot_mid(&s);
    let mid = if mid.is_empty() { "？".to_string() } else { mid };
    let kind = kind_of(&s);
    let stage = if s.contains("高三") {
        Some("高三")
    } else if s.contains("高二") {
        Some("高二")
    } else if s.contains("高一") {
        Some("高一")
    } else {
        None
    };
    // 学段 + 届 → 按「校内考试」模板（校本卷子是老数据的大头）
    if let Some(st) = stage {
        let xue = match first_year(&s) {
            Some(n) if s.contains("届") => format!("{}-{}学年", n - 1, n),
            Some(n) => format!("{}-{}学年", n, n + 1),
            None => "？-？学年".to_string(),
        };
        return Some(format!("{} · {} · ？ · {}", st, mid, xue));
    }
    match kind {
        "模拟" => Some(format!("{} · {} · 模拟", y, mid)),
        "联考" => Some(format!("{} · {} · 联考", y, mid)),
        "高考真题" => Some(format!("{} · {} · 高考真题", y, mid)),
        // 教辅 / 专题汇编 / 未知：老数据里极少，不硬套（宁可报「认不出」也不猜）
        _ => None,
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    fn m() -> HashMap<String, String> {
        HashMap::new()
    }

    #[test]
    fn empty_becomes_unknown() {
        assert_eq!(normalize("", &m()), UNKNOWN);
        assert_eq!(normalize("   ", &m()), UNKNOWN);
    }

    #[test]
    fn canonical_is_idempotent() {
        for s in [
            "2026 · 全国I卷 · 高考真题",
            "2025 · 天津 · 模拟",
            "2025 · 五校 · 联考",
            "高考 · 专题汇编 · 导数",
            "教辅 · 必刷题",
            "高三上 · 期末 · 某某中学 · 2025-2026学年",
        ] {
            assert!(is_canonical(s), "should be canonical: {}", s);
            assert_eq!(normalize(s, &m()), s, "idempotent: {}", s);
        }
    }

    #[test]
    fn spaceless_gaokao_stays() {
        let s = "2023·全国甲卷·高考真题";
        assert!(is_canonical(s));
        assert_eq!(normalize(s, &m()), s);
    }

    #[test]
    fn noise_suffix_is_stripped_but_real_title_survives() {
        assert_eq!(normalize("某某中学月考数学试题", &m()), "某某中学月考");
        // 关键：泛化的「试卷」不剥，否则真标题会被截
        assert_eq!(normalize("公式保真测试卷", &m()), "公式保真测试卷");
    }

    #[test]
    fn latex_hallucination_is_rejected() {
        assert_eq!(normalize("\\begin{tikzpicture}[scale=0.8]", &m()), UNKNOWN);
        assert_eq!(normalize("\\frac{1}{2}", &m()), UNKNOWN);
    }

    #[test]
    fn roman_numeral_longest_first() {
        assert_eq!(roman_fix("新高考II卷"), "新高考Ⅱ卷");
        assert_eq!(roman_fix("全国III卷"), "全国Ⅲ卷");
        assert_eq!(roman_fix("全国I卷"), "全国Ⅰ卷");
    }

    #[test]
    fn kind_of_six_categories() {
        assert_eq!(kind_of("2026 · 全国I卷 · 高考真题"), "高考真题");
        assert_eq!(kind_of("2025 · 天津 · 模拟"), "模拟");
        assert_eq!(kind_of("2025 · 五校 · 联考"), "联考");
        assert_eq!(kind_of("高考 · 专题汇编 · 导数"), "专题汇编");
        assert_eq!(kind_of("教辅 · 必刷题"), "教辅");
        assert_eq!(kind_of("高三上 · 期末 · 一中 · 2025-2026学年"), "校内");
        assert_eq!(kind_of("全国卷理"), "未知");
        // 线索兜底：老数据里的「一模」
        assert_eq!(kind_of("2026届某市一模"), "模拟");
    }

    #[test]
    fn user_map_wins() {
        let mut mm = HashMap::new();
        mm.insert("全国卷理".to_string(), "2001 · 全国卷 · 高考真题".to_string());
        assert_eq!(normalize("全国卷理", &mm), "2001 · 全国卷 · 高考真题");
    }

    /// 【P1c】模板建议：能整成型的要成型，缺信息的**留「？」不猜**
    #[test]
    fn template_hint_fills_what_it_can() {
        // 「2026届某市一模数学试题」→ 年份 + 地区 + 类别，**直接成型** ✓
        let a = template_hint("2026届某市一模数学试题").unwrap();
        assert_eq!(a, "2026 · 某市 · 模拟");
        assert!(is_canonical(&a), "应当直接成型: {}", a);
        // 联考同理
        let b = template_hint("2026届四省联考").unwrap();
        assert_eq!(b, "2026 · 四省 · 联考");
        assert!(is_canonical(&b));
    }

    #[test]
    fn template_hint_leaves_unknown_slots_blank() {
        // 校本卷子：认得出学段和学年，**学校名留「？」**（不猜学校 ✗）
        let a = template_hint("2027 届高三 8 月底学情调研").unwrap();
        assert_eq!(a, "高三 · 8月底学情调研 · ？ · 2026-2027学年");
        assert!(!is_canonical(&a), "有「？」就不该算成型: {}", a);
    }

    #[test]
    fn template_hint_skips_canonical_and_unknown() {
        assert!(template_hint("2026 · 全国I卷 · 高考真题").is_none(), "已成型的不该再出建议");
        assert!(template_hint("").is_none());
        assert!(template_hint("   ").is_none());
        // 认不出类别、也没有学段线索 → 不硬套模板
        assert!(template_hint("普通高中总复习资料").is_none());
    }

    #[test]
    fn year_and_slot_extraction() {
        assert_eq!(first_year("2026届某市一模"), Some(2026));
        assert_eq!(first_year("高三 8 月底"), None);
        assert_eq!(first_year("12345 届"), None, "5 位数字里不该切出年份");
        assert_eq!(slot_mid("2026届某市一模"), "某市");
        assert_eq!(slot_mid("2027届高三8月底学情调研"), "8月底学情调研");
    }
}
