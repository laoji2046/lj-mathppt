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
/// 抓一张整个虚拟桌面的**原始位图**（不编码，便于"连续两帧比对"）。
fn grab_desktop_image() -> Result<(image::RgbaImage, i32, i32, Vec<serde_json::Value>), String> {
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

    Ok((canvas, minx, miny, monitor_info_json))
}

/// 真正干活的：截整个虚拟桌面（不含任何"让开"逻辑，便于单测）。
fn capture_desktop_inner() -> Result<serde_json::Value, String> {
    let (canvas, minx, miny, monitors) = grab_desktop_image()?;
    Ok(serde_json::json!({
        "ok": true,
        "dataBase64": png_b64(&canvas)?,
        "w": canvas.width(),
        "h": canvas.height(),
        "minX": minx,
        "minY": miny,
        // 诊断用：几台显示器、各自多大 —— 抓不全时能一眼看出是漏了显示器还是抓的是旧帧
        "monitors": monitors
    }))
}

/// 等桌面"画稳了"再返回：**连续两次抓到的帧一致**才认为稳定。
///
/// 为什么不用固定等待：死等要么不够（抓到旧帧 ✗）、要么白等（每次都拖满 ✗）。
/// 这样多数情况 200~300ms 就能拿到稳定帧，个别时候自动多等一会儿，最多 900ms 兜底。
/// 另外**只在最后编码一次 PNG** —— 一张 3840×2400 编码一次就要一百多毫秒，每轮都编码纯属浪费。
fn capture_desktop_settled() -> Result<serde_json::Value, String> {
    let start = std::time::Instant::now();
    let mut prev_sig: Option<Vec<u8>> = None;
    let mut got: Option<(image::RgbaImage, i32, i32, Vec<serde_json::Value>)> = None;
    loop {
        // 第一轮多等一点让桌面开始重绘，后续每轮短一些
        let wait = if prev_sig.is_none() { 80 } else { 45 };
        std::thread::sleep(std::time::Duration::from_millis(wait));
        match grab_desktop_image() {
            Ok((img, mx, my, ms)) => {
                // 抽样比对（每 4093 字节取一个，3840×2400 大约 900 个样本）。
                // **不能要求完全一致**：桌面上时钟在跳、光标在闪，那样永远等不到 ✗。
                // 差异样本占比 < 0.5% 就认为画面已经定下来了（一个光标大约只占 1 个样本）。
                let sig: Vec<u8> = img.as_raw().iter().step_by(4093).copied().collect();
                let settled = match &prev_sig {
                    Some(p) if p.len() == sig.len() => {
                        let diff = p.iter().zip(sig.iter()).filter(|(a, b)| a != b).count();
                        (diff as f64) / (sig.len().max(1) as f64) < 0.005
                    }
                    _ => false,
                };
                prev_sig = Some(sig);
                got = Some((img, mx, my, ms));
                if settled && start.elapsed().as_millis() >= 120 {
                    break;
                }
            }
            Err(e) => {
                // 抓不到就直接把错误抛回去（通常是环境不支持）
                if start.elapsed().as_millis() > 300 {
                    return Err(e);
                }
            }
        }
        // 兜底上限：正常 200~350ms 就会命中，这里只是防止极端情况一直转
        if start.elapsed().as_millis() > 600 {
            break;
        }
    }
    let (canvas, minx, miny, monitors) = got.ok_or_else(|| "截图失败".to_string())?;
    Ok(serde_json::json!({
        "ok": true,
        "dataBase64": png_b64(&canvas)?,
        "w": canvas.width(),
        "h": canvas.height(),
        "minX": minx,
        "minY": miny,
        "monitors": monitors
    }))
}

/// 截屏（桌面端）：**先把本窗口让开**再抓。
///
/// 关键教训：如果窗口还在屏幕上（尤其是最大化时它盖满整个桌面），抓到的就**只有应用自己** ✗。
/// 所以这里先 hide → 等合成器把下面的桌面画出来 → 抓 → 无论成败都把窗口恢复。
#[cfg(windows)]
extern "system" {
    fn GetDesktopWindow() -> isize;
    fn SetForegroundWindow(hwnd: isize) -> i32;
}

/// 把"桌面"本身顶到前台，逼合成器重画一遍。
/// 光把本窗口 hide 掉，桌面不一定会立刻重绘 —— 于是桌面复制拿到的还是上一帧 ✗。
#[cfg(windows)]
fn force_desktop_redraw() {
    unsafe {
        SetForegroundWindow(GetDesktopWindow());
    }
}
#[cfg(not(windows))]
fn force_desktop_redraw() {}

#[tauri::command]
fn capture_screens(window: tauri::WebviewWindow) -> Result<serde_json::Value, String> {
    // 诊断用：系统（winit/Tauri）自己看到几台显示器 —— 跟 xcap 看到的一对比，
    // 就能区分"是枚举漏了"还是"抓取本身不对"。
    let os_monitors = window
        .available_monitors()
        .map(|ms| {
            ms.iter()
                .map(|m| {
                    let p = m.position();
                    let s = m.size();
                    serde_json::json!({
                        "name": m.name(), "x": p.x, "y": p.y, "w": s.width, "h": s.height,
                        "scale": m.scale_factor()
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let _ = window.hide();
    // 藏掉窗口还不够：桌面本身没被"要求重绘"时，桌面复制很可能继续给旧帧 ✗。
    // 把桌面窗口顶到前台，逼合成器重画一遍。
    force_desktop_redraw();

    // 等桌面"画稳了"再取（连续两帧一致）—— 比死等固定时间又快又稳
    let out = capture_desktop_settled();
    // 无论抓到没抓到，都要把窗口还回来，否则应用就"消失"了
    let _ = window.show();
    match out {
        Ok(mut v) => {
            // 把系统看到的显示器数一并带出去（前端会显示出来）
            if let Some(o) = v.as_object_mut() {
                o.insert("osMonitors".into(), serde_json::json!(os_monitors));
            }
            Ok(v)
        }
        Err(e) => Err(e),
    }
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


/// RGBA 图 → PNG base64（桌面截图与窗口截图共用）
fn png_b64(img: &image::RgbaImage) -> Result<String, String> {
    let mut png: Vec<u8> = Vec::new();
    {
        use image::ImageEncoder;
        let enc = image::codecs::png::PngEncoder::new(&mut png);
        enc.write_image(
            img.as_raw(),
            img.width(),
            img.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| e.to_string())?;
    }
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&png))
}

/// 列出"可截图"的窗口：有标题、没最小化、尺寸像样。
/// 用途：屏幕截图时想截**某个被别的窗口挡住**的窗口 —— 那只能按窗口截，不能按屏幕截。
#[tauri::command]
fn list_windows(window: tauri::WebviewWindow) -> Result<serde_json::Value, String> {
    // 排除本应用自己的窗口：此刻它是全屏覆盖层，截出来就是覆盖层本身，只会让人困惑
    list_windows_impl(window.hwnd().map(|h| h.0 as u32).ok())
}

/// 真正的实现（便于单测，不依赖 Tauri 窗口）
fn list_windows_impl(own: Option<u32>) -> Result<serde_json::Value, String> {
    use xcap::Window;
    let ws = Window::all().map_err(|e| e.to_string())?;
    let mut out: Vec<serde_json::Value> = Vec::new();
    for w in &ws {
        let id = match w.id() {
            Ok(v) => v,
            Err(_) => continue,
        };
        if own == Some(id) {
            continue;
        }
        let title = w.title().unwrap_or_default();
        if title.trim().is_empty() {
            continue; // 无标题的多是工具窗口/隐藏窗口
        }
        if w.is_minimized().unwrap_or(false) {
            continue; // 最小化的截出来是空白
        }
        let width = w.width().unwrap_or(0);
        let height = w.height().unwrap_or(0);
        if width < 120 || height < 80 {
            continue;
        }
        out.push(serde_json::json!({
            "id": id,
            "title": title,
            "app": w.app_name().unwrap_or_default(),
            "w": width,
            "h": height
        }));
    }
    Ok(serde_json::json!({ "ok": true, "windows": out }))
}

/// 截取**指定窗口**：走 PrintWindow 那条路 —— **被别的窗口挡住也能截到它自己的内容** ✓，
/// 这正是"想截别的窗口却被遮挡"场景的唯一解法。
#[tauri::command]
fn capture_window(id: u32) -> Result<serde_json::Value, String> {
    use xcap::Window;
    let ws = Window::all().map_err(|e| e.to_string())?;
    let w = ws
        .iter()
        .find(|x| x.id().map(|v| v == id).unwrap_or(false))
        .ok_or_else(|| "窗口已经关闭了".to_string())?;
    let img = w.capture_image().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "ok": true,
        "dataBase64": png_b64(&img)?,
        "w": img.width(),
        "h": img.height()
    }))
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
            set_capture_mode,
            list_windows,
            capture_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    /// 窗口级截图烟雾测试：列出窗口 → 挑一个截图。
    /// 这是"想截别的窗口却被遮挡"场景的解法，所以必须验证它真能拿到图。
    #[test]
    fn window_capture_smoke() {
        let list = super::list_windows_impl(None).expect("应该能列出窗口");
        let wins = list.get("windows").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        println!("列出 {} 个可截窗口", wins.len());
        for w in wins.iter().take(5) {
            println!(
                "  id={} [{}] {} ({}x{})",
                w.get("id").and_then(|x| x.as_u64()).unwrap_or(0),
                w.get("app").and_then(|x| x.as_str()).unwrap_or(""),
                w.get("title").and_then(|x| x.as_str()).unwrap_or(""),
                w.get("w").and_then(|x| x.as_u64()).unwrap_or(0),
                w.get("h").and_then(|x| x.as_u64()).unwrap_or(0),
            );
        }
        if let Some(first) = wins.first() {
            let id = first.get("id").and_then(|x| x.as_u64()).unwrap_or(0) as u32;
            match super::capture_window(id) {
                Ok(v) => {
                    let b64 = v.get("dataBase64").and_then(|x| x.as_str()).unwrap_or("");
                    let w = v.get("w").and_then(|x| x.as_u64()).unwrap_or(0);
                    let h = v.get("h").and_then(|x| x.as_u64()).unwrap_or(0);
                    use base64::Engine;
                    let png = base64::engine::general_purpose::STANDARD.decode(b64).expect("base64");
                    assert_eq!(&png[..8], &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]);
                    println!("截到窗口 {}x{}，PNG {} 字节", w, h, png.len());
                }
                Err(e) => println!("这个窗口截不了（可能已关闭）：{}", e),
            }
        }
    }

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
        // 顺带量一下"等桌面稳定"实际花多久 —— 这就是用户感受到的等待时间
        let t0 = std::time::Instant::now();
        match super::capture_desktop_settled() {
            Ok(v) => println!(
                "稳定帧耗时 {}ms（{}x{}）",
                t0.elapsed().as_millis(),
                v.get("w").and_then(|x| x.as_u64()).unwrap_or(0),
                v.get("h").and_then(|x| x.as_u64()).unwrap_or(0)
            ),
            Err(e) => println!("稳定帧取不到：{}", e),
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
