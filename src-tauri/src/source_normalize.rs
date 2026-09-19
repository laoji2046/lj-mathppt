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

/// 是否已符合某一类模板（幂等保护 + 批量报告残留都用它）
pub fn is_canonical(t: &str) -> bool {
    let s = t.trim();
    if s.is_empty() || s == UNKNOWN {
        return true;
    }
    let p = split_sep(s);
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
}
