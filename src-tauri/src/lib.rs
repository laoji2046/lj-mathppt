use std::fs;
use std::path::PathBuf;
use tauri::Manager;

// ////////////////////////////////////////////////////////////////////////////
// 方案 A：用 Tauri 原生能力代替 node 服务。
//
// 页面由 Tauri 内嵌的 asset:// 协议加载（frontendDist = ../dist，静态资源连同
// index.html/app.js/styles.css/图片全部从二进制内嵌内存出，无松散源码文件）。
// GeoGebra / Reveal.js 引擎走 CDN（联网），不随包分发。
//
// 导出（另存为）不再依赖 node 端的 /__export_json 端点，而是暴露三个
// Tauri 原生命令，前端用 window.__TAURI__.core.invoke 调用：
//   app_dir()      -> { dir: "<程序所在目录>" }
//   list_dir(path) -> { ok, path, parent, dirs:[..] }
//   export_json(path, name, dataBase64) -> { ok, path } 或 { ok:false, error }
// 前端在检测到 __TAURI__ 时走 invoke，否则回退到浏览器原生 showSaveFilePicker。
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

/// 写入导出文件：解码 base64 后写到 `<path>/<name>`。
#[tauri::command]
fn export_json(path: String, name: String, data_base64: String) -> serde_json::Value {
    match write_export(&path, &name, &data_base64) {
        Ok(p) => serde_json::json!({ "ok": true, "path": p.to_string_lossy() }),
        Err((status, msg)) => serde_json::json!({ "ok": false, "error": msg, "status": status }),
    }
}

/// 区域截图：LJ-PPT 最小化让开 → 截取整个主屏（此时画面=最上层目标窗口/其它窗口）→
/// 恢复并全屏 LJ-PPT，前端用该快照作全屏遮罩背景（所见即所得），框选目标窗口区域。
#[tauri::command]
fn capture_screen(window: tauri::Window) -> serde_json::Value {
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;

    // 最小化/隐藏自己，露出最上层目标窗口
    let _ = window.hide();
    let _ = window.minimize();
    std::thread::sleep(std::time::Duration::from_millis(260));

    let mut png: Vec<u8> = Vec::new();
    let mut w: u32 = 0;
    let mut h: u32 = 0;
    if let Ok(monitors) = xcap::Monitor::all() {
        if let Some(m) = monitors.into_iter().next() {
            if let Ok(img) = m.capture_image() {
                w = m.width(); h = m.height();
                let _ = xcap::image::DynamicImage::ImageRgba8(img)
                    .write_to(&mut std::io::Cursor::new(&mut png), xcap::image::ImageFormat::Png);
            }
        }
    }

    // 恢复并全屏 LJ-PPT，前端遮罩显示快照
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_always_on_top(true);
    let _ = window.maximize();

    let b64 = B64.encode(&png);
    serde_json::json!({ "ok": !png.is_empty(), "width": w, "height": h, "png": b64,
        "error": if png.is_empty() { "no screen captured" } else { "" } })
}

/// 截图完成后还原 LJ-PPT 窗口状态（去掉最大化 + 取消置顶）。
#[tauri::command]
fn restore_window(window: tauri::Window, maximized: bool) {
    let _ = window.set_always_on_top(false);
    if maximized { let _ = window.unmaximize(); }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_dir, list_dir, export_json, capture_screen, restore_window])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;

    fn b64(s: &str) -> String {
        B64.encode(s.as_bytes())
    }

    #[test]
    fn write_export_writes_base64_payload() {
        let dir = std::env::temp_dir().join("rs_export_test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let payload = "<html>RevealSlidr ✓</html>";
        let file = write_export(dir.to_str().unwrap(), "测试.html", &b64(payload)).unwrap();
        assert_eq!(file, dir.join("测试.html"));
        assert_eq!(fs::read_to_string(&file).unwrap(), payload);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_export_rejects_traversal() {
        let dir = std::env::temp_dir().join("rs_export_test2");
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
