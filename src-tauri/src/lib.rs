use std::fs;
use std::path::PathBuf;

// ////////////////////////////////////////////////////////////////////////////
// LJ-MathSlides (Vue 版) — Tauri 2 后端。
//
// 页面由 Tauri 内嵌的 asset:// 协议加载（frontendDist = ../dist，前端构建产物
// 全部从二进制内嵌内存出）。GeoGebra / MathJax 引擎在 public/ 下随前端打包，
// 离线可用。
//
// 导出能力：前端检测到 __TAURI__ 时用 window.__TAURI__.core.invoke 调用：
//   app_dir()                          -> { dir: "<程序所在目录>" }
//   list_dir(path?)                    -> { ok, path, parent, dirs:[..] }
//   export_json(path, name, dataBase64) -> { ok, path } | { ok:false, error }
//   images_dir()                       -> { ok, dir }  图片根目录（exe 所在目录，任意子目录可放图）
//   read_local_image(name)             -> { ok, dataBase64, mime, path } | { ok:false, error }
// 浏览器环境下回退到 showSaveFilePicker / 下载。
// ////////////////////////////////////////////////////////////////////////////

/// 程序所在目录（可执行文件所在目录）。文件夹选择器默认以此为起点。
fn program_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// 解码 base64 并写入 `<path>/<name>`，防文件名穿越。成功返回最终路径，
/// 失败返回 `(http_status, error_message)`。
fn write_export(path: &str, name: &str, data_base64: &str) -> Result<PathBuf, (u16, String)> {
    if path.trim().is_empty() || name.trim().is_empty() {
        return Err((400, "path/name 为空".to_string()));
    }

    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;
    let bytes = B64
        .decode(data_base64.as_bytes())
        .map_err(|e| (400, format!("bad base64: {}", e)))?;

    let name = name.trim().to_string();
    // 防穿越：文件直接写在所选路径内。
    if name.contains('/') || name.contains('\\') || name == ".." || name == "." {
        return Err((400, "非法文件名".to_string()));
    }

    let mut full = PathBuf::from(path.trim());
    full.push(name);

    fs::write(&full, &bytes).map_err(|e| (500, format!("write failed: {}", e)))?;
    Ok(full)
}

/// 返回程序所在目录。前端「另存为」对话框以此为起点。
#[tauri::command]
fn app_dir() -> serde_json::Value {
    serde_json::json!({ "dir": program_dir().to_string_lossy() })
}

/// 列出指定目录（或程序目录）下的子文件夹。前端文件夹选择器用来浏览。
#[tauri::command]
fn list_dir(path: Option<String>) -> serde_json::Value {
    let req_path = path.unwrap_or_default();
    let dir = PathBuf::from(&req_path);
    let dir = if dir.is_dir() { dir } else { program_dir() };

    let mut dirs: Vec<String> = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                if let Some(n) = p.file_name().and_then(|n| n.to_str()) {
                    dirs.push(n.to_string());
                }
            }
        }
    }
    dirs.sort();

    let parent = dir.parent().map(|p| p.to_string_lossy().into_owned());

    serde_json::json!({
        "ok": true,
        "path": dir.to_string_lossy(),
        "parent": parent,
        "dirs": dirs,
    })
}

/// 常用目录（桌面 / 文档 / 下载 / 用户目录 / 程序目录）：前端「另存为」对话框的快捷入口。
#[tauri::command]
fn user_dirs() -> serde_json::Value {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from);
    let mut out: Vec<serde_json::Value> = Vec::new();
    if let Some(h) = home {
        let cands = [
            ("桌面", h.join("Desktop")),
            ("文档", h.join("Documents")),
            ("下载", h.join("Downloads")),
            ("用户目录", h.clone()),
        ];
        for (label, p) in cands {
            if p.is_dir() {
                out.push(serde_json::json!({ "label": label, "path": p.to_string_lossy() }));
            }
        }
    }
    let pd = program_dir();
    out.push(serde_json::json!({ "label": "程序目录", "path": pd.to_string_lossy() }));
    serde_json::json!({ "ok": true, "dirs": out })
}

/// 写入导出文件：解码 base64 后写到 `<path>/<name>`。
#[tauri::command]
fn export_json(path: String, name: String, data_base64: String) -> serde_json::Value {
    match write_export(&path, &name, &data_base64) {
        Ok(p) => serde_json::json!({ "ok": true, "path": p.to_string_lossy() }),
        Err((status, msg)) => serde_json::json!({ "ok": false, "error": msg, "status": status }),
    }
}

// ---------------------------------------------------------------------------
// 本地试题图：读 exe 同级目录下的任意相对路径（images/、pic/ 等任何子目录）。
//
// 打包后前端跑在 asset:// 内存页里，`pic/3.jpg` 这类相对路径解析不到磁盘文件
// （dist 里没有用户图片，也不该把图打进二进制）。这里由 Rust 直接读盘并回传
// base64，前端内嵌成 data URL —— 既能显示，导出 PDF/PNG 时也不会再受协议限制。
// ---------------------------------------------------------------------------

/// 按扩展名猜 MIME，未知一律按 jpeg。
fn guess_image_mime(p: &std::path::Path) -> String {
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "png" => "image/png".to_string(),
        "gif" => "image/gif".to_string(),
        "webp" => "image/webp".to_string(),
        "svg" => "image/svg+xml".to_string(),
        "bmp" => "image/bmp".to_string(),
        _ => "image/jpeg".to_string(),
    }
}

/// exe 同级的 images 目录；不存在则创建，方便用户直接往里丢图。
fn images_dir_path() -> PathBuf {
    let mut d = program_dir();
    d.push("images");
    let _ = fs::create_dir_all(&d);
    d
}

/// 返回（并确保存在）images 目录，前端据此提示用户「图片放这里」。
/// 注意：这只是默认/推荐目录，read_local_image 实际支持 exe 同级任意子目录。
#[tauri::command]
fn images_dir() -> serde_json::Value {
    let _ = images_dir_path();
    serde_json::json!({ "ok": true, "dir": program_dir().to_string_lossy() })
}

/// 读取 exe 同级的任意相对路径图片（`pic/3.jpg`、`images/9ti.jpg` 均可）并回传 base64。
/// 兼容旧写法：不带目录的裸文件名（如 `9ti.jpg`）优先按 exe 同级找，找不到再回退 images/ 下。
/// 禁止 `..` 穿越出 exe 目录。
#[tauri::command]
fn read_local_image(name: String) -> serde_json::Value {
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;

    let rel = name.trim().replace('\\', "/");
    let rel = rel.trim_start_matches('/').to_string();
    if rel.is_empty() {
        return serde_json::json!({ "ok": false, "error": "文件名为空" });
    }
    if rel.split('/').any(|s| s.is_empty() || s == "..") {
        return serde_json::json!({ "ok": false, "error": "非法路径" });
    }

    // 按书写原样相对 exe 目录解析：pic/3.jpg、images/9ti.jpg 都能命中
    let mut full = program_dir();
    for seg in rel.split('/') {
        full.push(seg);
    }
    // 旧习惯兜底：裸文件名（不带目录）exe 同级没有时，去 images/ 下找
    if !rel.contains('/') && !full.is_file() {
        full = images_dir_path();
        full.push(rel.as_str());
    }

    match fs::read(&full) {
        Ok(bytes) => serde_json::json!({
            "ok": true,
            "dataBase64": B64.encode(&bytes),
            "mime": guess_image_mime(&full),
            "path": full.to_string_lossy(),
        }),
        Err(e) => serde_json::json!({
            "ok": false,
            "error": format!("读取失败: {}", e),
            "path": full.to_string_lossy(),
        }),
    }
}


/// 原生截屏：把**整个虚拟桌面**（多显示器按实际位置拼起来）截成一张 PNG，返回 base64。
///
/// 为什么要在 Rust 里做：浏览器只能截"用户授权共享的那个源"，而且必须先弹一次共享选择器 ✗。
/// exe 里用原生截屏可以做到 Word/PPT 那种"直接在桌面上拖"的手感（前端把主窗口临时全屏置顶，
/// 把这张图铺满，用户在上面拖选区即可）。
/// 真正干活的：截整个虚拟桌面（不含任何"让开"逻辑，便于单测）。
fn capture_desktop_inner() -> Result<serde_json::Value, String> {
    use xcap::Monitor;

    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    if monitors.is_empty() {
        return Err("没有检测到显示器".into());
    }

    let mut shots: Vec<(i32, i32, image::RgbaImage)> = Vec::new();
    let mut monitor_info_json: Vec<serde_json::Value> = Vec::new();
    for m in &monitors {
        let img = m.capture_image().map_err(|e| e.to_string())?;
        let x = m.x().map_err(|e| e.to_string())?;
        let y = m.y().map_err(|e| e.to_string())?;
        monitor_info_json.push(serde_json::json!({
            "name": m.name().unwrap_or_default(),
            "x": x, "y": y, "w": img.width(), "h": img.height()
        }));
        shots.push((x, y, img));
    }

    // 虚拟桌面的包围盒（多显示器可能是负坐标）
    let mut minx = i32::MAX;
    let mut miny = i32::MAX;
    let mut maxx = i32::MIN;
    let mut maxy = i32::MIN;
    for (x, y, img) in &shots {
        minx = minx.min(*x);
        miny = miny.min(*y);
        maxx = maxx.max(*x + img.width() as i32);
        maxy = maxy.max(*y + img.height() as i32);
    }
    let w = (maxx - minx).max(1) as u32;
    let h = (maxy - miny).max(1) as u32;

    let mut canvas = image::RgbaImage::from_pixel(w, h, image::Rgba([0, 0, 0, 255]));
    for (x, y, img) in shots {
        image::imageops::overlay(&mut canvas, &img, (x - minx) as i64, (y - miny) as i64);
    }

    let mut png: Vec<u8> = Vec::new();
    {
        use image::ImageEncoder;
        let enc = image::codecs::png::PngEncoder::new(&mut png);
        enc.write_image(
            canvas.as_raw(),
            canvas.width(),
            canvas.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| e.to_string())?;
    }

    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
    Ok(serde_json::json!({
        "ok": true,
        "dataBase64": b64,
        "w": canvas.width(),
        "h": canvas.height(),
        "minX": minx,
        "minY": miny,
        // 诊断用：几台显示器、各自多大 —— 抓不全时能一眼看出是漏了显示器还是抓的是旧帧
        "monitors": monitor_info_json
    }))
}

/// 截屏（桌面端）：**先把本窗口让开**再抓。
///
/// 关键教训：如果窗口还在屏幕上（尤其是最大化时它盖满整个桌面），抓到的就**只有应用自己** ✗。
/// 所以这里先 hide → 等合成器把下面的桌面画出来 → 抓 → 无论成败都把窗口恢复。
#[tauri::command]
fn capture_screens(window: tauri::WebviewWindow) -> Result<serde_json::Value, String> {
    let _ = window.hide();
    // 等窗口藏掉、桌面重绘出来
    std::thread::sleep(std::time::Duration::from_millis(400));
    // **抓两次、丢掉第一张**：Windows 的桌面复制第一次调用经常拿到"上一帧"（窗口还在的那一帧），
    // 表现就是"只截到应用下面那一层" ✗。第二张才是当前真正的合成结果。
    let _ = capture_desktop_inner();
    std::thread::sleep(std::time::Duration::from_millis(120));
    let out = capture_desktop_inner();
    // 无论抓到没抓到，都要把窗口还回来，否则应用就"消失"了
    let _ = window.show();
    out
}

/// 进入/退出"截屏覆盖"模式：主窗口临时全屏 + 置顶（退出时还原并重新聚焦）。
///
/// 放在 Rust 里而不是前端调 window 插件，是为了避开 Tauri 2 的 capability 配置 —— 
/// 自己的命令不需要额外授权。
#[tauri::command]
fn set_capture_mode(window: tauri::WebviewWindow, on: bool) -> Result<(), String> {
    window.set_fullscreen(on).map_err(|e| e.to_string())?;
    window.set_always_on_top(on).map_err(|e| e.to_string())?;
    if on {
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        let _ = window.set_focus();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            app_dir,
            list_dir,
            user_dirs,
            export_json,
            images_dir,
            read_local_image,
            capture_screens,
            set_capture_mode
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    /// 原生截屏命令的烟雾测试：能跑通就说明 crate 接线、多显示器拼接、PNG 编码、base64 这几步没接错。
    /// 无显示器的环境（比如 CI）拿不到图，此时只要**优雅报错**也算过。
    #[test]
    fn capture_screens_smoke() {
        match super::capture_desktop_inner() {
            Ok(v) => {
                let b64 = v.get("dataBase64").and_then(|x| x.as_str()).unwrap_or("");
                let w = v.get("w").and_then(|x| x.as_u64()).unwrap_or(0);
                let h = v.get("h").and_then(|x| x.as_u64()).unwrap_or(0);
                assert!(w > 0 && h > 0, "尺寸应该 > 0");
                assert!(b64.len() > 100, "base64 太短");
                use base64::Engine;
                let png = base64::engine::general_purpose::STANDARD.decode(b64).expect("base64 应该能解");
                assert_eq!(&png[..8], &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a], "应该是合法 PNG");
                println!("截到 {}x{}，PNG {} 字节", w, h, png.len());
            }
            Err(e) => println!("环境不支持截图（可接受）：{}", e),
        }
    }

    use super::*;
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;

    fn b64(s: &str) -> String {
        B64.encode(s.as_bytes())
    }

    #[test]
    fn write_export_writes_base64_payload() {
        let dir = std::env::temp_dir().join("ms_export_test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let payload = "<html>LJ-MathSlides ✓</html>";
        let file = write_export(dir.to_str().unwrap(), "测试.html", &b64(payload)).unwrap();
        assert_eq!(file, dir.join("测试.html"));
        assert_eq!(fs::read_to_string(&file).unwrap(), payload);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_export_rejects_traversal() {
        let dir = std::env::temp_dir().join("ms_export_test2");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let (status, _) = write_export(dir.to_str().unwrap(), "../../evil.html", &b64("x")).unwrap_err();
        assert_eq!(status, 400);
        let (status, _) = write_export(dir.to_str().unwrap(), "a\\b.html", &b64("x")).unwrap_err();
        assert_eq!(status, 400);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_export_empty_path_or_name() {
        let (s1, _) = write_export("", "x.html", &b64("x")).unwrap_err();
        assert_eq!(s1, 400);
        let (s2, _) = write_export("C:/foo", "", &b64("x")).unwrap_err();
        assert_eq!(s2, 400);
    }

    #[test]
    fn write_export_bad_base64() {
        let (status, _) = write_export("C:/foo", "x.html", "!!!not-base64!!!").unwrap_err();
        assert_eq!(status, 400);
    }
}
