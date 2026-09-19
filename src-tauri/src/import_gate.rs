//! 【v5 · P1a】抽取质量闸门 —— 纯函数 + 单测（方案 §5.3）
//!
//! 原则：**AI / OCR 拿不准就标 needs_review，绝不猜完直接写进正式库**。
//! 每条闸门只回答「这题该不该转人工」，**不改内容、不猜答案、不合并题**。
//!
//! 闸门清单（与方案 §5.3 对齐）：
//!   1 空题干 · 2 选择题 0 选项 · 3 乱码比例 · 4 孤儿解析
//!   5 图片标记没落地 · 6 内容守恒（与原文量级比对）· 7 数量不符（整组转人工）

/// 乱码比例阈值：替换符 / 控制符 / 「???」占比超过它就转人工
const JUNK_RATIO: f64 = 0.10;
/// 内容守恒下限：切出来的正文连原文的 35% 都不到 → 疑似漏切
const KEEP_MIN: f64 = 0.35;
/// 内容守恒上限：超过原文 1.6 倍 → 疑似并题
const KEEP_MAX: f64 = 1.6;

/// 一次闸门检查的输入（全用引用，避免 clone 题干）
pub struct GateInput<'a> {
    pub stem: &'a str,
    pub options: &'a [String],
    pub qtype: &'a str,
    pub answer: &'a str,
    pub solution: &'a str,
    /// 版面解析原文（人工修的底稿）；空串 = 本次不做守恒检查
    pub raw_text: &'a str,
    /// 题干 + 选项里出现的图片标记处数（[图N] / ![alt](src)）
    pub image_refs: usize,
    /// 实际随题带的图数
    pub images: usize,
    /// 机械切块得到的段数；< 0 = 本次不校验数量
    pub expected_count: i64,
    /// 本次实际返回的道数
    pub actual_count: i64,
}

pub struct GateResult {
    pub needs_review: bool,
    pub warn: String,
    pub reasons: Vec<String>,
}

fn chars(s: &str) -> usize {
    s.chars().count()
}

/// 乱码比例：U+FFFD、非空白控制符、连续 3 个以上的「?」都算坏字符
fn junk_ratio(s: &str) -> f64 {
    let mut total = 0usize;
    let mut junk = 0usize;
    let mut run = 0usize;
    for c in s.chars() {
        total += 1;
        if c == '\u{FFFD}' || (c.is_control() && c != '\n' && c != '\r' && c != '\t') {
            junk += 1;
        }
        if c == '?' {
            run += 1;
            if run >= 3 {
                junk += 1;
            }
        } else {
            run = 0;
        }
    }
    if total == 0 {
        return 0.0;
    }
    junk as f64 / total as f64
}

/// 数正文里有几处图片标记：markdown 的 ![alt](src) 与试卷约定的 [图N] / [图 N:x]
pub fn count_image_refs(s: &str) -> usize {
    let md = s.matches("![").count();
    let cs: Vec<char> = s.chars().collect();
    let mut tag = 0usize;
    let mut i = 0usize;
    while i + 1 < cs.len() {
        if cs[i] == '[' && cs[i + 1] == '图' {
            let mut j = i + 2;
            while j < cs.len() && cs[j] == ' ' {
                j += 1;
            }
            if j < cs.len() && cs[j].is_ascii_digit() {
                tag += 1;
            }
        }
        i += 1;
    }
    md + tag
}

pub fn check(g: &GateInput) -> GateResult {
    let mut reasons: Vec<String> = Vec::new();

    // 1 空题干（最硬的闸门：没题干这题根本不存在）
    if g.stem.trim().is_empty() {
        reasons.push("空题干".to_string());
    }
    // 2 选择题必须有 >= 2 个选项
    if (g.qtype == "choice" || g.qtype == "multi") && g.options.len() < 2 {
        reasons.push(format!("选择题只有 {} 个选项", g.options.len()));
    }
    // 3 乱码比例
    let jr = junk_ratio(g.stem);
    if jr > JUNK_RATIO {
        reasons.push(format!("疑似乱码 {:.0}%", jr * 100.0));
    }
    // 4 孤儿解析（有解析却没题干 —— 多半是切块把题干切丢了）
    if g.stem.trim().is_empty() && !g.solution.trim().is_empty() {
        reasons.push("孤儿解析（有解析没题干）".to_string());
    }
    // 5 图片标记没落地
    if g.image_refs > g.images {
        reasons.push(format!(
            "有 {} 处图片标记但只带了 {} 张图",
            g.image_refs, g.images
        ));
    }
    // 6 内容守恒（只在有原文时检查）
    if !g.raw_text.trim().is_empty() {
        let raw = chars(g.raw_text);
        if raw > 0 {
            let mut kept = chars(g.stem) + chars(g.answer) + chars(g.solution);
            for o in g.options {
                kept += chars(o);
            }
            let ratio = kept as f64 / raw as f64;
            if ratio < KEEP_MIN {
                reasons.push(format!(
                    "内容偏少（只保留原文 {:.0}%，疑似漏切）",
                    ratio * 100.0
                ));
            } else if ratio > KEEP_MAX {
                reasons.push(format!("内容偏多（是原文的 {:.1} 倍，疑似并题）", ratio));
            }
        }
    }
    // 7 数量不符 → 整组转人工（不合并、不猜）
    if g.expected_count >= 0 && g.expected_count != g.actual_count {
        reasons.push(format!(
            "机械切块 {} 段与返回 {} 道不符（整组转人工）",
            g.expected_count, g.actual_count
        ));
    }

    GateResult {
        needs_review: !reasons.is_empty(),
        warn: reasons.join("；"),
        reasons,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    /// 一道干净的选择题 → 不转人工、没告警
    #[test]
    fn clean_choice_passes() {
        let o = opts(&["A. 1", "B. 2", "C. 3", "D. 4"]);
        let r = check(&GateInput {
            stem: "已知 $x=1$，求 $x^2+1$ 的值。",
            options: &o,
            qtype: "choice",
            answer: "B",
            solution: "代入得 2。",
            raw_text: "",
            image_refs: 0,
            images: 0,
            expected_count: -1,
            actual_count: 1,
        });
        assert!(!r.needs_review, "干净题不该转人工: {:?}", r.reasons);
        assert!(r.warn.is_empty());
    }

    /// 空题干（+ 孤儿解析）→ 都要报出来
    #[test]
    fn empty_stem_flagged() {
        let o: Vec<String> = Vec::new();
        let r = check(&GateInput {
            stem: "   ",
            options: &o,
            qtype: "answer",
            answer: "",
            solution: "由题意得……",
            raw_text: "",
            image_refs: 0,
            images: 0,
            expected_count: -1,
            actual_count: 1,
        });
        assert!(r.needs_review);
        assert_eq!(r.reasons.len(), 2, "{:?}", r.reasons);
        assert!(r.warn.contains("空题干"));
        assert!(r.warn.contains("孤儿解析"));
    }

    /// 选择题只有 0 / 1 个选项 → 转人工
    #[test]
    fn choice_without_options_flagged() {
        let o = opts(&["A. 只有这一个"]);
        let r = check(&GateInput {
            stem: "下列正确的是（  ）",
            options: &o,
            qtype: "choice",
            answer: "A",
            solution: "",
            raw_text: "",
            image_refs: 0,
            images: 0,
            expected_count: -1,
            actual_count: 1,
        });
        assert!(r.needs_review);
        assert!(r.warn.contains("只有 1 个选项"), "{}", r.warn);
    }

    /// 乱码比例超阈值 → 转人工
    #[test]
    fn junk_flagged() {
        let o = opts(&["A. 1", "B. 2"]);
        let r = check(&GateInput {
            stem: "求\u{FFFD}\u{FFFD}\u{FFFD}的值???",
            options: &o,
            qtype: "choice",
            answer: "",
            solution: "",
            raw_text: "",
            image_refs: 0,
            images: 0,
            expected_count: -1,
            actual_count: 1,
        });
        assert!(r.needs_review);
        assert!(r.warn.contains("乱码"), "{}", r.warn);
    }

    /// 图片标记比实际图多 → 转人工
    #[test]
    fn missing_image_flagged() {
        let o: Vec<String> = Vec::new();
        let r = check(&GateInput {
            stem: "如图，正方体 [图1] 中……",
            options: &o,
            qtype: "answer",
            answer: "",
            solution: "",
            raw_text: "",
            image_refs: count_image_refs("如图，正方体 [图1] 中……"),
            images: 0,
            expected_count: -1,
            actual_count: 1,
        });
        assert!(r.needs_review);
        assert!(r.warn.contains("只带了 0 张图"), "{}", r.warn);
    }

    /// 内容守恒：只切出原文的一小截 → 转人工
    #[test]
    fn keep_ratio_low_flagged() {
        let o: Vec<String> = Vec::new();
        let raw = "甲".repeat(200);
        let r = check(&GateInput {
            stem: "甲甲",
            options: &o,
            qtype: "answer",
            answer: "",
            solution: "",
            raw_text: &raw,
            image_refs: 0,
            images: 0,
            expected_count: -1,
            actual_count: 1,
        });
        assert!(r.needs_review);
        assert!(r.warn.contains("内容偏少"), "{}", r.warn);
    }

    /// 内容守恒：比原文长得多 → 疑似并题
    #[test]
    fn keep_ratio_high_flagged() {
        let o: Vec<String> = Vec::new();
        let raw = "乙".repeat(10);
        let long = "乙".repeat(60);
        let r = check(&GateInput {
            stem: &long,
            options: &o,
            qtype: "answer",
            answer: "",
            solution: "",
            raw_text: &raw,
            image_refs: 0,
            images: 0,
            expected_count: -1,
            actual_count: 1,
        });
        assert!(r.needs_review);
        assert!(r.warn.contains("内容偏多"), "{}", r.warn);
    }

    /// 数量不符 → 每条都要带上（整组转人工）
    #[test]
    fn count_mismatch_flagged() {
        let o: Vec<String> = Vec::new();
        let r = check(&GateInput {
            stem: "正常题干",
            options: &o,
            qtype: "answer",
            answer: "",
            solution: "",
            raw_text: "",
            image_refs: 0,
            images: 0,
            expected_count: 20,
            actual_count: 18,
        });
        assert!(r.needs_review);
        assert!(r.warn.contains("20 段与返回 18 道"), "{}", r.warn);
    }

    /// 图片标记计数：两种写法都要认，且不能把普通方括号算进去
    #[test]
    fn image_ref_counting() {
        assert_eq!(count_image_refs("无图"), 0);
        assert_eq!(count_image_refs("[图1]"), 1);
        assert_eq!(count_image_refs("见图 [图 2:width=6] 与 [图3]"), 2);
        assert_eq!(count_image_refs("![a](/x.png)"), 1);
        assert_eq!(count_image_refs("![a](/x.png) 和 [图4]"), 2);
        assert_eq!(count_image_refs("[答案] 不是图"), 0);
        assert_eq!(count_image_refs("[图]"), 0);
    }
}
