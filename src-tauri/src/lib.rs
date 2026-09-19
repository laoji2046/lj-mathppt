use std::fs;
use std::path::PathBuf;
use tauri::Emitter;

mod import_gate;
mod source_normalize;

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


// ////////////////////////////////////////////////////////////////////////////
// 内容库（SQLite）—— 第一期：公式库；后续：图形库 / 试题库 / 课件库
//
// 库文件放在**用户目录**下，不是 exe 同目录：
//   %APPDATA%\lj-mathslides\library.db
// 这样换 exe 不会丢库，也方便用户自己备份。
//
// 设计要点：**库是空的也能跑**（表用 IF NOT EXISTS 建）；所有命令都返回
// json!({ ok, ... }) 的扁平结构，与文件里既有的 10 个命令保持同一风格。
// ////////////////////////////////////////////////////////////////////////////

/// 内容库文件路径（顺带确保目录存在）
fn library_path() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("USERPROFILE")
                .map(|h| PathBuf::from(h).join("AppData").join("Roaming"))
        })
        .unwrap_or_else(program_dir);
    let dir = base.join("lj-mathslides");
    let _ = fs::create_dir_all(&dir);
    dir.join("library.db")
}

/// 简单时间戳（秒）。不引 chrono —— 只为排序与显示新旧。
fn now_stamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{}", secs)
}

/// 打开库并保证表结构存在。
fn lib_open() -> Result<rusqlite::Connection, String> {
    let conn = rusqlite::Connection::open(library_path())
        .map_err(|e| format!("打开内容库失败: {}", e))?;
    let sql = concat!(
        "CREATE TABLE IF NOT EXISTS library_item (",
        "id INTEGER PRIMARY KEY AUTOINCREMENT,",
        "type TEXT NOT NULL,",
        "title TEXT NOT NULL,",
        "body TEXT DEFAULT ", "''", ",",
        "meta TEXT DEFAULT ", "''", ",",
        "tags TEXT DEFAULT ", "''", ",",
        "source TEXT DEFAULT ", "''", ",",
        "builtin INTEGER DEFAULT 0,",
        "created_at TEXT DEFAULT ", "''", ",",
        "updated_at TEXT DEFAULT ", "''", ",",
        "used_count INTEGER DEFAULT 0",
        ");",
        "CREATE INDEX IF NOT EXISTS idx_lib_type ON library_item(type);",
        "CREATE TABLE IF NOT EXISTS library_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);"
    );
    conn.execute_batch(sql).map_err(|e| format!("建表失败: {}", e))?;
    // 打开即迁移（版本记在 library_meta.schema_version ✓；每步迁移前先备份 ✓）
    lib_migrate(&conn)?;
    Ok(conn)
}

/// 当前库结构版本（新库建表即 v1；打开时自动升到最新 ✓）
const LIB_SCHEMA_VERSION: i64 = 5;

/// 读库结构版本：library_meta 里没有这行 → 当 v1（老库）✓
fn lib_schema_get(conn: &rusqlite::Connection) -> i64 {
    conn.query_row("SELECT v FROM library_meta WHERE k = 'schema_version'", [], |r| r.get::<_, String>(0))
        .ok()
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(1)
}

/// 迁移前备份：把 .db 复制成 library.db.bak-v{n}-{时间戳}（同目录 ✓）。
/// **备份失败就不迁移** —— 宁可不动，也不能冒险把老师的题库改坏 ✗
fn lib_backup_before(to_v: i64) -> Result<(), String> {
    let p = library_path();
    if !p.exists() { return Ok(()); }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let bak = p.with_file_name(format!("library.db.bak-v{}-{}", to_v, ts));
    std::fs::copy(&p, &bak).map_err(|e| format!("迁移前备份失败（{}）: {}", bak.to_string_lossy(), e))?;
    Ok(())
}

/// 【M4 加固】打一个带标签的整库备份（同目录）：library.db.bak-{tag}-{时间戳}
/// 用途：**批量删除前自动留一份** —— 误点「全选 → 删除」也能整库还原 ✓
/// （v1443 实测教训：一个「全选 → 删除」就把线上 169 道清空了 ✗）
fn lib_backup_tagged(tag: &str) -> String {
    let p = library_path();
    if !p.exists() {
        return String::new();
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let bak = p.with_file_name(format!("library.db.bak-{}-{}", tag, ts));
    match std::fs::copy(&p, &bak) {
        Ok(_) => bak.to_string_lossy().to_string(),
        Err(_) => String::new(),
    }
}

/// 【v4】当前年份（不引 chrono：civil-from-days 换算，只为编号用）
fn current_year() -> i64 {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let z = secs.div_euclid(86400) + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    if m <= 2 { y + 1 } else { y }
}

/// 【v4】分配可读编号：P-{年}-{四位序号}（年度计数器）。
/// ⚠ year <= 0 表示「年份未知」→ 编号写 **P-0000-xxxx**：
///   老数据里 103 道没年份，不能假装是今年（Sitimo 的 code 是身份，不能骗人）。
///   新建题由调用方传当前年（见 lib_prepare_qmeta）。
fn lib_next_code(conn: &rusqlite::Connection, year: i64) -> String {
    let y = if year > 0 { year } else { 0 };
    let _ = conn.execute(
        "INSERT INTO question_code_counter(year, serial) VALUES(?1, 1)
         ON CONFLICT(year) DO UPDATE SET serial = serial + 1",
        [y],
    );
    let serial: i64 = conn
        .query_row("SELECT serial FROM question_code_counter WHERE year = ?1", [y], |r| r.get(0))
        .unwrap_or(1);
    format!("P-{:04}-{:04}", y, serial)
}

/// 【v4】从 meta 里取 v4 那几个真列：(source_kind, warn, status, code)
/// 一律容错：meta 不是合法 JSON、字段缺失 → 空串（交给 SQL 的 CASE 保留旧值）
fn lib_qmeta_cols(meta: &str) -> (String, String, String, String) {
    let v: serde_json::Value = serde_json::from_str(if meta.is_empty() { "{}" } else { meta })
        .unwrap_or(serde_json::Value::Object(Default::default()));
    let gs = |k: &str| {
        v.get(k)
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string()
    };
    let paper = gs("paperName");
    let source_kind = if paper.is_empty() {
        String::new()
    } else {
        source_normalize::kind_of(&paper).to_string()
    };
    (source_kind, gs("warn"), gs("status"), gs("code"))
}

/// 【v4】题目写库前规整 meta（**唯一入口**）：
///   - paperName → 来源归一（§3 规约；校本别名从库外配置读）
///   - status   → 缺省 published（老题 / 手工题行为不变）
///   - code     → 缺省按年度分配 P-{年}-{四位}
fn lib_prepare_qmeta(
    conn: &rusqlite::Connection,
    meta: &str,
    map: &std::collections::HashMap<String, String>,
) -> String {
    let mut m: serde_json::Value =
        serde_json::from_str(if meta.trim().is_empty() { "{}" } else { meta })
            .unwrap_or_else(|_| serde_json::json!({}));
    let Some(obj) = m.as_object_mut() else {
        return meta.to_string();
    };
    if let Some(v) = obj.get("paperName").and_then(|x| x.as_str()) {
        let n = source_normalize::normalize(v, map);
        obj.insert("paperName".to_string(), serde_json::json!(n));
    }
    let has_status = obj
        .get("status")
        .and_then(|x| x.as_str())
        .map(|t| !t.trim().is_empty())
        .unwrap_or(false);
    if !has_status {
        obj.insert("status".to_string(), serde_json::json!("published"));
    }
    let has_code = obj
        .get("code")
        .and_then(|x| x.as_str())
        .map(|t| !t.trim().is_empty())
        .unwrap_or(false);
    if !has_code {
        let year = obj
            .get("year")
            .and_then(|x| x.as_i64().or_else(|| x.as_str().and_then(|t| t.trim().parse().ok())))
            .unwrap_or(0);
        // 新建题没写年份 → 用当前年（今天录的题，年份大概率是今年）
        let code = lib_next_code(conn, if year > 0 { year } else { current_year() });
        obj.insert("code".to_string(), serde_json::json!(code));
    }
    serde_json::to_string(&m).unwrap_or_else(|_| meta.to_string())
}

/// 【题库 v3】从 meta(JSON) 里取要抽成真列的筛选字段：(qtype, level, difficulty, year, paper)
/// 一律**容错**：meta 不是合法 JSON、字段缺失、类型不对 → 给默认值
/// （迁移/保存都不能因为一条脏数据就卡住整个库 ✗）
fn lib_qcols_of(meta: &str) -> (String, String, i64, i64, String) {
    let v: serde_json::Value = serde_json::from_str(if meta.is_empty() { "{}" } else { meta })
        .unwrap_or(serde_json::Value::Object(Default::default()));
    let s = |k: &str| {
        v.get(k)
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string()
    };
    let n = |k: &str| -> i64 {
        v.get(k)
            .map(|x| {
                x.as_i64()
                    .or_else(|| x.as_f64().map(|f| f as i64))
                    .or_else(|| x.as_str().and_then(|t| t.trim().parse::<i64>().ok()))
                    .unwrap_or(0)
            })
            .unwrap_or(0)
    };
    (s("qtype"), s("level"), n("difficulty"), n("year"), s("paperName"))
}

/// 【题库 v3】meta.knowledge（字符串数组）→ 知识点（去空、去重、单个限长 40）
fn lib_kp_of(meta: &str) -> Vec<String> {
    let v: serde_json::Value = match serde_json::from_str(if meta.is_empty() { "{}" } else { meta }) {
        Ok(x) => x,
        Err(_) => return Vec::new(),
    };
    let mut out: Vec<String> = Vec::new();
    if let Some(arr) = v.get("knowledge").and_then(|k| k.as_array()) {
        for it in arr {
            let s = it
                .as_str()
                .map(|t| t.trim().to_string())
                .or_else(|| it.as_i64().map(|n| n.to_string()))
                .unwrap_or_default();
            if !s.is_empty() && s.chars().count() <= 40 && !out.contains(&s) {
                out.push(s);
            }
        }
    }
    out
}

/// 【题库 v3】把一条题目的 meta 同步到真列 + question_kp 表。
/// 插入 / 更新 / 迁移回填**都走这一个入口** —— 三处各写一遍迟早会不一致 ✗
fn lib_sync_qcols(conn: &rusqlite::Connection, id: i64, kind: &str, meta: &str) -> Result<(), String> {
    if kind != "question" {
        return Ok(());
    }
    let (qtype, level, difficulty, year, paper) = lib_qcols_of(meta);
    let (source_kind, warn, status, code) = lib_qmeta_cols(meta);
    // ⚠ code / status 用 CASE 保留旧值：老题的 meta 里没有这两个键，
    //    不能因为一次 patch 就把迁移回填好的编号/状态冲成空 ✗
    conn.execute(
        "UPDATE library_item SET qtype=?1, level=?2, difficulty=?3, year=?4, paper=?5, \
         source_kind=CASE WHEN ?6='' THEN source_kind ELSE ?6 END, warn=?7, \
         status=CASE WHEN ?8='' THEN status ELSE ?8 END, \
         code=CASE WHEN ?9='' THEN code ELSE ?9 END WHERE id=?10",
        rusqlite::params![qtype, level, difficulty, year, paper, source_kind, warn, status, code, id],
    )
    .map_err(|e| format!("同步题库筛选字段失败: {}", e))?;
    conn.execute("DELETE FROM question_kp WHERE qid = ?1", [id])
        .map_err(|e| format!("清理知识点失败: {}", e))?;
    for kp in lib_kp_of(meta) {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO question_kp(qid, kp) VALUES (?1, ?2)",
            rusqlite::params![id, kp],
        );
    }
    Ok(())
}

/// 【库结构迁移】逐版升级；每步之前先备份 ✓。老库只有 v1 → 会依次跑到最新；
/// 新库建表时是 v1，第一次打开就补到最新 ✓（`CREATE TABLE IF NOT EXISTS` 不会补列，所以必须有它 ✗）
fn lib_migrate(conn: &rusqlite::Connection) -> Result<(), String> {
    let mut v = lib_schema_get(conn);
    if v >= LIB_SCHEMA_VERSION { return Ok(()); }

    // ---- v1 → v2：把 meta 里的 section 抽成**真列 + 索引** ----
    //  为什么：板块筛选/排序现在要扫全部 meta(JSON) ✗；抽成列后能走索引 ✓
    //  **同步不用改保存路径**：用两个触发器从 NEW.meta 里自动抽 section ✓
    if v == 1 {
        lib_backup_before(2)?;
        let has: i64 = conn
            .query_row("SELECT COUNT(*) FROM pragma_table_info('library_item') WHERE name = 'section'", [], |r| r.get(0))
            .unwrap_or(0);
        if has == 0 {
            conn.execute_batch(
                "ALTER TABLE library_item ADD COLUMN section TEXT DEFAULT '';
                 UPDATE library_item SET section = COALESCE(json_extract(meta, '$.section'), '');
                 CREATE INDEX IF NOT EXISTS idx_lib_section ON library_item(section);
                 CREATE TRIGGER IF NOT EXISTS trg_lib_section_ins AFTER INSERT ON library_item
                 BEGIN UPDATE library_item SET section = COALESCE(json_extract(NEW.meta, '$.section'), '') WHERE id = NEW.id; END;
                 CREATE TRIGGER IF NOT EXISTS trg_lib_section_upd AFTER UPDATE OF meta ON library_item
                 BEGIN UPDATE library_item SET section = COALESCE(json_extract(NEW.meta, '$.section'), '') WHERE id = NEW.id; END;",
            )
            .map_err(|e| format!("迁移 v1→v2 失败: {}", e))?;
        }
        v = 2;
    }

    // ---- v2 → v3：新题库要的筛选字段抽成真列 + 知识点拆成一张表 ----
    //  为什么：新设计要「按 题型/难度/年份/来源(试卷名)/知识点 筛」✗
    //  全塞在 meta(JSON) 里只能全表扫 + 现算 ✓
    //  ⚠ library_item **原本就有 source 列**（条目出处/内置标记那类用法）→
    //    试卷名另开 **paper** 列，别抢 source ✗
    //  回填走 lib_sync_qcols：与保存路径同一份逻辑，不会出现「迁移填的」和「保存填的」两套口径 ✓
    if v == 2 {
        lib_backup_before(3)?;
        for (name, ddl) in [
            ("qtype", "TEXT DEFAULT ''"),
            ("level", "TEXT DEFAULT ''"),
            ("difficulty", "INTEGER DEFAULT 0"),
            ("year", "INTEGER DEFAULT 0"),
            ("paper", "TEXT DEFAULT ''"),
        ] {
            let has: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM pragma_table_info('library_item') WHERE name = ?1",
                    [name],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if has == 0 {
                conn.execute_batch(&format!(
                    "ALTER TABLE library_item ADD COLUMN {} {}",
                    name, ddl
                ))
                .map_err(|e| format!("迁移 v2→v3 加列 {} 失败: {}", name, e))?;
            }
        }
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_q_section ON library_item(type, section);
             CREATE INDEX IF NOT EXISTS idx_q_qtype ON library_item(type, qtype);
             CREATE INDEX IF NOT EXISTS idx_q_level ON library_item(type, level);
             CREATE INDEX IF NOT EXISTS idx_q_year ON library_item(type, year);
             CREATE TABLE IF NOT EXISTS question_kp (qid INTEGER NOT NULL, kp TEXT NOT NULL, PRIMARY KEY(qid, kp));
             CREATE INDEX IF NOT EXISTS idx_qkp_kp ON question_kp(kp);",
        )
        .map_err(|e| format!("迁移 v2→v3 建索引/知识点表失败: {}", e))?;
        // 回填已有题目（只动 type='question' ✓ 公式/图形/课件不受影响）
        let rows: Vec<(i64, String)> = {
            let mut st = conn
                .prepare("SELECT id, meta FROM library_item WHERE type = 'question'")
                .map_err(|e| format!("迁移 v2→v3 读旧题失败: {}", e))?;
            let it = st
                .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
                .map_err(|e| format!("迁移 v2→v3 读旧题失败: {}", e))?;
            it.filter_map(|x| x.ok()).collect()
        };
        let mut backfilled: i64 = 0;
        for (id, meta) in rows {
            lib_sync_qcols(conn, id, "question", &meta)?;
            backfilled += 1;
        }
        let _ = conn.execute(
            "INSERT INTO library_meta(k, v) VALUES('v3_backfilled', ?1) ON CONFLICT(k) DO UPDATE SET v = ?1",
            [backfilled.to_string()],
        );
        v = 3;
    }

    // ---- v3 → v4：题目生命周期（status）+ 可读编号（code）+ 来源类别（source_kind）+ 告警（warn）
    //      另建 kp_catalog（**板块级**受控词表：11 板块 + 30 方法；考点级留给后续按需扩）
    //  为什么：169 道题没有 status（没法分草稿/正式）、没有 code（老师没法口头引用）、
    //          来源不成规约（129 空 + 13 可疑年份）、知识点 0 条。
    if v == 3 {
        lib_backup_before(4)?;
        for (name, ddl) in [
            ("code", "TEXT DEFAULT ''"),
            ("status", "TEXT DEFAULT ''"),
            ("source_kind", "TEXT DEFAULT ''"),
            ("warn", "TEXT DEFAULT ''"),
        ] {
            let has: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM pragma_table_info('library_item') WHERE name = ?1",
                    [name],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if has == 0 {
                conn.execute_batch(&format!("ALTER TABLE library_item ADD COLUMN {} {}", name, ddl))
                    .map_err(|e| format!("迁移 v3→v4 加列 {} 失败: {}", name, e))?;
            }
        }
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_q_code ON library_item(type, code);
             CREATE INDEX IF NOT EXISTS idx_q_status ON library_item(type, status);
             CREATE INDEX IF NOT EXISTS idx_q_source_kind ON library_item(type, source_kind);
             CREATE TABLE IF NOT EXISTS question_code_counter (year INTEGER PRIMARY KEY, serial INTEGER NOT NULL DEFAULT 0);
             CREATE TABLE IF NOT EXISTS kp_catalog (
               kp TEXT PRIMARY KEY, kind TEXT NOT NULL, aliases TEXT DEFAULT '',
               parent TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'published'
             );",
        )
        .map_err(|e| format!("迁移 v3→v4 建索引/表失败: {}", e))?;

        // 回填 ①：老题一律 published（**行为完全不变**，不会因为多了状态就看不见）
        conn.execute(
            "UPDATE library_item SET status = 'published' WHERE type = 'question' AND (status IS NULL OR status = '')",
            [],
        )
        .map_err(|e| format!("迁移 v3→v4 回填 status 失败: {}", e))?;

        // 回填 ②：source_kind（由 paper 现算）+ code（按年 + id 顺序分配，确定性）
        let rows: Vec<(i64, i64, String)> = {
            let mut st = conn
                .prepare("SELECT id, year, paper FROM library_item WHERE type = 'question' ORDER BY year, id")
                .map_err(|e| format!("迁移 v3→v4 读旧题失败: {}", e))?;
            let it = st
                .query_map([], |r| {
                    Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?))
                })
                .map_err(|e| format!("迁移 v3→v4 读旧题失败: {}", e))?;
            it.filter_map(|x| x.ok()).collect()
        };
        let mut coded: i64 = 0;
        for (id, year, paper) in rows {
            let sk = source_normalize::kind_of(&paper);
            let code = lib_next_code(conn, year);
            let _ = conn.execute(
                "UPDATE library_item SET code = ?1, source_kind = ?2 WHERE id = ?3",
                rusqlite::params![code, sk, id],
            );
            coded += 1;
        }
        let _ = conn.execute(
            "INSERT INTO library_meta(k, v) VALUES('v4_coded', ?1) ON CONFLICT(k) DO UPDATE SET v = ?1",
            [coded.to_string()],
        );

        // 回填 ③：播种板块级受控词表（kind = knowledge / method）
        const KP_BLOCKS: &[&str] = &[
            "集合与逻辑", "函数与导数", "三角函数与向量", "数列", "不等式",
            "立体几何", "解析几何", "概率与统计", "复数", "计数原理",
        ];
        const KP_METHODS: &[&str] = &[
            "定义法", "分类讨论", "数形结合", "换元法", "待定系数法", "分离参数法",
            "构造函数", "基本不等式法", "韦达定理", "配方法", "消元法", "坐标法",
            "向量法", "空间向量法", "等价转化", "放缩法", "数学建模", "特殊值法",
            "排除法", "综合法", "分析法", "反证法", "裂项相消法", "错位相减法",
            "数学归纳法", "分类计数原理", "古典概型计算", "导数法", "定义域优先",
            "端点与无穷检查",
        ];
        for kp in KP_BLOCKS {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO kp_catalog(kp, kind, aliases, parent, status) VALUES(?1, 'knowledge', '', '高中', 'published')",
                [kp],
            );
        }
        for kp in KP_METHODS {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO kp_catalog(kp, kind, aliases, parent, status) VALUES(?1, 'method', '', '', 'published')",
                [kp],
            );
        }
        v = 4;
    }

    // ---- v4 → v5：录入加固（批次 / 草稿 / 修订快照）+ batch_id / sha256 两个真列 ----
    //  为什么：AI / OCR 的输出**不能直接进正式库**（§5.1）—— 必须先落草稿、过质量闸门、人工确认；
    //          来源与告警要随批次走；每题改动要能回溯（修订快照）。
    if v == 4 {
        lib_backup_before(5)?;
        for (name, ddl) in [("batch_id", "TEXT DEFAULT ''"), ("sha256", "TEXT DEFAULT ''")] {
            let has: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM pragma_table_info('library_item') WHERE name = ?1",
                    [name],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if has == 0 {
                conn.execute_batch(&format!("ALTER TABLE library_item ADD COLUMN {} {}", name, ddl))
                    .map_err(|e| format!("迁移 v4→v5 加列 {} 失败: {}", name, e))?;
            }
        }
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_asset_sha ON library_item(type, sha256);
             CREATE INDEX IF NOT EXISTS idx_q_batch ON library_item(type, batch_id);
             CREATE TABLE IF NOT EXISTS question_revision (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               qid INTEGER NOT NULL,
               version INTEGER NOT NULL,
               snapshot TEXT NOT NULL,
               reason TEXT DEFAULT '',
               created_at TEXT NOT NULL,
               UNIQUE(qid, version)
             );
             CREATE INDEX IF NOT EXISTS idx_rev_qid ON question_revision(qid, version DESC);
             CREATE TABLE IF NOT EXISTS import_batch (
               id TEXT PRIMARY KEY,
               source_type TEXT DEFAULT '',
               source_path TEXT DEFAULT '',
               source_label TEXT DEFAULT '',
               summary TEXT DEFAULT '',
               question_count INTEGER NOT NULL DEFAULT 0,
               status TEXT DEFAULT 'running',
               idem_key TEXT,
               extra TEXT DEFAULT '',
               created_at TEXT NOT NULL,
               finished_at TEXT
             );
             CREATE UNIQUE INDEX IF NOT EXISTS idx_batch_idem ON import_batch(idem_key) WHERE idem_key IS NOT NULL;
             CREATE TABLE IF NOT EXISTS import_draft (
               id TEXT PRIMARY KEY,
               batch_id TEXT DEFAULT '',
               source_item_id TEXT DEFAULT '',
               source_label TEXT DEFAULT '',
               page INTEGER,
               bbox TEXT DEFAULT '',
               confidence REAL,
               needs_review INTEGER NOT NULL DEFAULT 1,
               stem TEXT DEFAULT '', options TEXT DEFAULT '', answer TEXT DEFAULT '', solution TEXT DEFAULT '',
               qtype TEXT DEFAULT '', section TEXT DEFAULT '', difficulty INTEGER DEFAULT 0, knowledge TEXT DEFAULT '',
               year INTEGER DEFAULT 0, paper TEXT DEFAULT '', source_kind TEXT DEFAULT '',
               raw_text TEXT DEFAULT '', warn TEXT DEFAULT '',
               status TEXT NOT NULL DEFAULT 'needs_review',
               target_qid INTEGER DEFAULT 0,
               extra TEXT DEFAULT '',
               created_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_draft_batch ON import_draft(batch_id, status);",
        )
        .map_err(|e| format!("迁移 v4→v5 建表失败: {}", e))?;
        v = 5;
    }

    conn.execute(
        "INSERT INTO library_meta(k, v) VALUES('schema_version', ?1) ON CONFLICT(k) DO UPDATE SET v = ?1",
        [v.to_string()],
    )
    .map_err(|e| format!("写入 schema_version 失败: {}", e))?;
    Ok(())
}

/// 库结构信息（版本 / 条数 / section 列填了几条）—— 诊断与自检用 ✓
#[tauri::command]
fn lib_schema_info() -> serde_json::Value {
    match lib_open() {
        Ok(conn) => {
            let v = lib_schema_get(&conn);
            let n: i64 = conn.query_row("SELECT COUNT(*) FROM library_item", [], |r| r.get(0)).unwrap_or(0);
            let sec: i64 = conn
                .query_row("SELECT COUNT(*) FROM library_item WHERE section IS NOT NULL AND section <> ''", [], |r| r.get(0))
                .unwrap_or(0);
            serde_json::json!({
                "ok": true,
                "version": v,
                "latest": LIB_SCHEMA_VERSION,
                "items": n,
                "sectionFilled": sec,
                "path": library_path().to_string_lossy(),
            })
        }
        Err(e) => serde_json::json!({ "ok": false, "error": e }),
    }
}

/// 【题库体检】只读自检报告：分类 / 题型 / 难度 / 年份 / 来源 的覆盖率 + 明显问题计数。
/// 新题库界面的「体检报告」直接显示这份 JSON ✓；**不动任何数据** ✓
/// ⚠ 用到 json_extract 的地方一律先 json_valid(meta) —— 一条脏 meta 会让整个查询报错 ✗
#[tauri::command]
fn lib_health() -> serde_json::Value {
    let conn = match lib_open() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let q = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap_or(0) };
    let by = |col: &str| -> serde_json::Value {
        let mut out = serde_json::Map::new();
        // ⚠ 一律 CAST(... AS TEXT)：year/difficulty 是 INTEGER 列，
        //   rusqlite 用 String 取整数会整行失败 → 分组直接变空对象 ✗（v1440 实测抓到）
        let sql = format!(
            "SELECT CASE WHEN COALESCE(CAST({c} AS TEXT), '') = '' THEN '(空)' ELSE CAST({c} AS TEXT) END k, \
             COUNT(*) c FROM library_item WHERE type='question' GROUP BY k ORDER BY c DESC",
            c = col
        );
        if let Ok(mut st) = conn.prepare(&sql) {
            if let Ok(rows) = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))) {
                for (k, c) in rows.filter_map(|x| x.ok()) {
                    out.insert(k, serde_json::json!(c));
                }
            }
        }
        serde_json::Value::Object(out)
    };
    let mut kp_top = serde_json::Map::new();
    if let Ok(mut st) = conn
        .prepare("SELECT kp, COUNT(*) c FROM question_kp GROUP BY kp ORDER BY c DESC LIMIT 20")
    {
        if let Ok(rows) = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))) {
            for (k, c) in rows.filter_map(|x| x.ok()) {
                kp_top.insert(k, serde_json::json!(c));
            }
        }
    }
    serde_json::json!({
        "ok": true,
        "version": lib_schema_get(&conn),
        "path": library_path().to_string_lossy(),
        "total": q("SELECT COUNT(*) FROM library_item WHERE type='question'"),
        "section": by("section"),
        "qtype": by("qtype"),
        "level": by("level"),
        "year": by("year"),
        "noSection": q("SELECT COUNT(*) FROM library_item WHERE type='question' AND COALESCE(section,'')=''"),
        "noQtype": q("SELECT COUNT(*) FROM library_item WHERE type='question' AND COALESCE(qtype,'')=''"),
        "noYear": q("SELECT COUNT(*) FROM library_item WHERE type='question' AND COALESCE(year,0)=0"),
        "noPaper": q("SELECT COUNT(*) FROM library_item WHERE type='question' AND COALESCE(paper,'')=''"),
        "noAnswer": q("SELECT COUNT(*) FROM library_item WHERE type='question' AND json_valid(meta) AND COALESCE(json_extract(meta,'$.answer'),'')=''"),
        "noOptions": q("SELECT COUNT(*) FROM library_item WHERE type='question' AND json_valid(meta) AND json_type(meta,'$.options')='array' AND json_array_length(json_extract(meta,'$.options'))=0 AND COALESCE(qtype,'') IN ('choice','')"),
        "kpRows": q("SELECT COUNT(*) FROM question_kp"),
        "kpCovered": q("SELECT COUNT(DISTINCT qid) FROM question_kp"),
        "dupStems": q("SELECT COUNT(*) FROM (SELECT 1 FROM library_item WHERE type='question' GROUP BY substr(body,1,80) HAVING COUNT(*)>1)"),
        // 可疑年份：<2000 或 >2035 基本是解析/OCR 错的（实测有 1981、2027 这种 ✗）
        "suspectYear": q("SELECT COUNT(*) FROM library_item WHERE type='question' AND year > 0 AND (year < 2000 OR year > 2035)"),
        "kpTop": serde_json::Value::Object(kp_top)
    })
}

/// 【题库 v3】左栏树 / 筛选条要的计数 —— **一次 IPC 拿全** ✓
/// （别让前端拉 169 条自己算：题量上去会越来越慢 ✗）
#[tauri::command]
fn lib_q_facets() -> serde_json::Value {
    let conn = match lib_open() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let q = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap_or(0) };
    // 成对（名, 数）的通用查询：一律 CAST 成 TEXT（INTEGER 列用 String 取会整行失败 ✗）
    let pair = |sql: &str| -> serde_json::Value {
        let mut out = serde_json::Map::new();
        if let Ok(mut st) = conn.prepare(sql) {
            if let Ok(rows) = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))) {
                for (k, c) in rows.filter_map(|x| x.ok()) {
                    out.insert(k, serde_json::json!(c));
                }
            }
        }
        serde_json::Value::Object(out)
    };
    serde_json::json!({
        "ok": true,
        "total": q("SELECT COUNT(*) FROM library_item WHERE type='question'"),
        "bySection": pair("SELECT CASE WHEN COALESCE(section,'')='' THEN '(未归类)' ELSE section END k, COUNT(*) c FROM library_item WHERE type='question' GROUP BY k ORDER BY c DESC"),
        "byQtype": pair("SELECT CASE WHEN COALESCE(qtype,'')='' THEN '(空)' ELSE qtype END k, COUNT(*) c FROM library_item WHERE type='question' GROUP BY k ORDER BY c DESC"),
        "byLevel": pair("SELECT CASE WHEN COALESCE(level,'')='' THEN '(空)' ELSE level END k, COUNT(*) c FROM library_item WHERE type='question' GROUP BY k ORDER BY c DESC"),
        "byYear": pair("SELECT CASE WHEN COALESCE(year,0)=0 THEN '(空)' ELSE CAST(year AS TEXT) END k, COUNT(*) c FROM library_item WHERE type='question' GROUP BY k ORDER BY c DESC"),
        "byPaper": pair("SELECT CASE WHEN COALESCE(paper,'')='' THEN '(空)' ELSE paper END k, COUNT(*) c FROM library_item WHERE type='question' GROUP BY k ORDER BY c DESC LIMIT 30"),
        "byKp": pair("SELECT kp k, COUNT(*) c FROM question_kp GROUP BY k ORDER BY c DESC"),
        // 【v4/P0b】生命周期状态 + 来源类别（真列，已有索引）—— 界面按它们筛
        "byStatus": pair("SELECT CASE WHEN COALESCE(status,'')='' THEN '(空)' ELSE status END k, COUNT(*) c FROM library_item WHERE type='question' GROUP BY k ORDER BY c DESC"),
        "bySourceKind": pair("SELECT CASE WHEN COALESCE(source_kind,'')='' THEN '(空)' ELSE source_kind END k, COUNT(*) c FROM library_item WHERE type='question' GROUP BY k ORDER BY c DESC"),
        // 带告警的题数（warn 真列非空）—— 题卡上的 ⚠ 角标就是它
        "warned": q("SELECT COUNT(*) FROM library_item WHERE type='question' AND COALESCE(warn,'')<>''"),
        "missing": {
            "section": q("SELECT COUNT(*) FROM library_item WHERE type='question' AND COALESCE(section,'')=''"),
            "answer": q("SELECT COUNT(*) FROM library_item WHERE type='question' AND json_valid(meta) AND COALESCE(json_extract(meta,'$.answer'),'')=''"),
            "kp": q("SELECT COUNT(*) FROM library_item q WHERE type='question' AND NOT EXISTS(SELECT 1 FROM question_kp k WHERE k.qid = q.id)"),
            "year": q("SELECT COUNT(*) FROM library_item WHERE type='question' AND COALESCE(year,0)=0"),
            "paper": q("SELECT COUNT(*) FROM library_item WHERE type='question' AND COALESCE(paper,'')=''"),
            // 【v4/P0b】没有可读编号的题（迁移后应为 0；>0 说明有条写库路径漏了 lib_prepare_qmeta）
            "code": q("SELECT COUNT(*) FROM library_item WHERE type='question' AND COALESCE(code,'')=''")
        }
    })
}

/// 【题库 v3】按条件查题：左树点一下 / 筛选项一变 / 搜索一输，都走这里 ✓
/// filter 支持：section · qtype · level · year · paper(模糊) · kp · q(搜索) ·
///             missingSection / missingAnswer / missingKp / missingYear(true 时才生效) · limit · offset
#[tauri::command]
fn lib_q_search(filter: serde_json::Value) -> serde_json::Value {
    let conn = match lib_open() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let f = filter.as_object().cloned().unwrap_or_default();
    let sget = |k: &str| {
        f.get(k)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string()
    };
    let bget = |k: &str| f.get(k).and_then(|v| v.as_bool()).unwrap_or(false);
    let limit = f.get("limit").and_then(|v| v.as_i64()).unwrap_or(200).clamp(1, 500);
    let offset = f.get("offset").and_then(|v| v.as_i64()).unwrap_or(0).max(0);

    let mut where_sql = String::from(" WHERE type='question'");
    let mut args: Vec<rusqlite::types::Value> = Vec::new();
    let sec = sget("section");
    if !sec.is_empty() {
        if sec == "(未归类)" {
            where_sql.push_str(" AND COALESCE(section,'')=''");
        } else {
            where_sql.push_str(" AND section = ?");
            args.push(rusqlite::types::Value::Text(sec));
        }
    }
    for key in ["qtype", "level"] {
        let v = sget(key);
        if !v.is_empty() {
            where_sql.push_str(&format!(" AND {} = ?", key));
            args.push(rusqlite::types::Value::Text(v));
        }
    }
    // 【v4/P0b】状态 / 来源类别（真列）。筛「(空)」走 COALESCE 判空，与 section 同一口径
    for (key, col) in [("status", "status"), ("sourceKind", "source_kind")] {
        let v = sget(key);
        if !v.is_empty() {
            if v == "(空)" {
                where_sql.push_str(&format!(" AND COALESCE({},'')=''", col));
            } else {
                where_sql.push_str(&format!(" AND {} = ?", col));
                args.push(rusqlite::types::Value::Text(v));
            }
        }
    }
    let y = f.get("year").and_then(|v| v.as_i64()).unwrap_or(0);
    if y > 0 {
        where_sql.push_str(" AND year = ?");
        args.push(rusqlite::types::Value::Integer(y));
    }
    let paper = sget("paper");
    if !paper.is_empty() {
        where_sql.push_str(" AND paper LIKE ?");
        args.push(rusqlite::types::Value::Text(format!("%{}%", paper)));
    }
    let kp = sget("kp");
    if !kp.is_empty() {
        where_sql.push_str(" AND EXISTS (SELECT 1 FROM question_kp k WHERE k.qid = library_item.id AND k.kp = ?)");
        args.push(rusqlite::types::Value::Text(kp));
    }
    let text = sget("q");
    if !text.is_empty() {
        where_sql.push_str(" AND (body LIKE ? OR title LIKE ?)");
        let like = format!("%{}%", text);
        args.push(rusqlite::types::Value::Text(like.clone()));
        args.push(rusqlite::types::Value::Text(like));
    }
    if bget("missingSection") {
        where_sql.push_str(" AND COALESCE(section,'')=''");
    }
    if bget("missingAnswer") {
        where_sql.push_str(" AND json_valid(meta) AND COALESCE(json_extract(meta,'$.answer'),'')=''");
    }
    if bget("missingKp") {
        where_sql.push_str(" AND NOT EXISTS (SELECT 1 FROM question_kp k WHERE k.qid = library_item.id)");
    }
    if bget("missingYear") {
        where_sql.push_str(" AND COALESCE(year,0)=0");
    }

    let total: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM library_item{}", where_sql),
            rusqlite::params_from_iter(args.iter()),
            |r| r.get(0),
        )
        .unwrap_or(0);

    let sql = format!(
        // COALESCE：老行这四个真列可能是 NULL，用 String 取 NULL 会整行失败（P0b 新加的四个列）
        "SELECT id, title, body, meta, section, qtype, level, difficulty, year, paper, COALESCE(code,''), COALESCE(status,''), COALESCE(source_kind,''), COALESCE(warn,''), updated_at          FROM library_item{} ORDER BY id DESC LIMIT ? OFFSET ?",
        where_sql
    );
    args.push(rusqlite::types::Value::Integer(limit));
    args.push(rusqlite::types::Value::Integer(offset));
    let mut stmt = match conn.prepare(&sql) {
        Ok(s) => s,
        Err(e) => return serde_json::json!({ "ok": false, "error": format!("查询失败: {}", e) }),
    };
    let rows = match stmt.query_map(rusqlite::params_from_iter(args.iter()), |r| {
        Ok(serde_json::json!({
            "id": r.get::<_, i64>(0)?,
            "title": r.get::<_, String>(1)?,
            "body": r.get::<_, String>(2)?,
            "meta": r.get::<_, String>(3)?,
            "section": r.get::<_, String>(4)?,
            "qtype": r.get::<_, String>(5)?,
            "level": r.get::<_, String>(6)?,
            "difficulty": r.get::<_, i64>(7)?,
            "year": r.get::<_, i64>(8)?,
            "paper": r.get::<_, String>(9)?,
            "code": r.get::<_, String>(10)?,
            "status": r.get::<_, String>(11)?,
            "sourceKind": r.get::<_, String>(12)?,
            "warn": r.get::<_, String>(13)?,
            "updatedAt": r.get::<_, String>(14)?,
            "kp": Vec::<String>::new()
        }))
    }) {
        Ok(x) => x,
        Err(e) => return serde_json::json!({ "ok": false, "error": format!("查询失败: {}", e) }),
    };
    let mut items: Vec<serde_json::Value> = rows.filter_map(|x| x.ok()).collect();

    // 知识点：一次 IN 查询装回去（别每条一次 SQL ✗）
    if !items.is_empty() {
        let ids: Vec<String> = items
            .iter()
            .map(|x| x.get("id").and_then(|v| v.as_i64()).unwrap_or(0).to_string())
            .collect();
        let kp_sql = format!(
            "SELECT qid, kp FROM question_kp WHERE qid IN ({}) ORDER BY kp",
            ids.join(",")
        );
        let mut by_id: std::collections::HashMap<i64, Vec<String>> = std::collections::HashMap::new();
        if let Ok(mut st) = conn.prepare(&kp_sql) {
            if let Ok(krows) = st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))) {
                for (qid, k) in krows.filter_map(|x| x.ok()) {
                    by_id.entry(qid).or_default().push(k);
                }
            }
        }
        for it in items.iter_mut() {
            let id = it.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            if let Some(list) = by_id.get(&id) {
                if let Some(obj) = it.as_object_mut() {
                    obj.insert("kp".to_string(), serde_json::json!(list));
                }
            }
        }
    }

    serde_json::json!({
        "ok": true, "total": total, "returned": items.len(), "limit": limit, "offset": offset, "items": items
    })
}

/// 【题库 v3】改一道题的字段（章节 / 题型 / 难度 / 年份 / 试卷名 / 答案 / 知识点…）
/// patch 的键**就是 meta 里的键**（section / qtype / level / difficulty / year / paperName / answer / knowledge…）
/// 值给 null = 删掉这个键 ✓。改完自动同步真列 + 知识点表（走 lib_sync_qcols 同一个入口 ✓）
#[tauri::command]
fn lib_q_patch(id: i64, patch: serde_json::Value) -> serde_json::Value {
    let conn = match lib_open() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let (kind, meta): (String, String) = match conn.query_row(
        "SELECT type, meta FROM library_item WHERE id = ?1",
        [id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
    ) {
        Ok(x) => x,
        Err(e) => return serde_json::json!({ "ok": false, "error": format!("找不到条目 #{}: {}", id, e) }),
    };
    if kind != "question" {
        return serde_json::json!({ "ok": false, "error": format!("只允许改题目（#{} 的类型是 {}）✗", id, kind) });
    }
    let mut m: serde_json::Value =
        serde_json::from_str(if meta.is_empty() { "{}" } else { &meta }).unwrap_or_else(|_| serde_json::json!({}));
    if let Some(obj) = m.as_object_mut() {
        if let Some(p) = patch.as_object() {
            // 【v4】来源归一：手工改的也走同一份规约（别名表从库外配置读）
            let sn_map = source_normalize::load_map();
            for (k, v) in p {
                if v.is_null() {
                    obj.remove(k);
                } else if k == "paperName" {
                    let n = source_normalize::normalize(v.as_str().unwrap_or(""), &sn_map);
                    obj.insert(k.clone(), serde_json::json!(n));
                } else {
                    obj.insert(k.clone(), v.clone());
                }
            }
        }
    }
    let meta2 = serde_json::to_string(&m).unwrap_or_else(|_| "{}".to_string());
    if let Err(e) = conn.execute(
        "UPDATE library_item SET meta = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![meta2, now_stamp(), id],
    ) {
        return serde_json::json!({ "ok": false, "error": format!("更新失败: {}", e) });
    }
    if let Err(e) = lib_sync_qcols(&conn, id, "question", &meta2) {
        return serde_json::json!({ "ok": false, "error": e });
    }
    // 【v5】每次改动留一份修订快照（改坏了能回溯）
    let _ = lib_snapshot_revision(&conn, id, "patch");
    // 取回新的真列（界面即时更新用 ✓）
    let row = conn
        .query_row(
            "SELECT section, qtype, level, difficulty, year, paper, COALESCE(code,''), COALESCE(status,''), COALESCE(source_kind,''), COALESCE(warn,'') FROM library_item WHERE id = ?1",
            [id],
            |r| {
                Ok(serde_json::json!({
                    "section": r.get::<_, String>(0)?,
                    "qtype": r.get::<_, String>(1)?,
                    "level": r.get::<_, String>(2)?,
                    "difficulty": r.get::<_, i64>(3)?,
                    "year": r.get::<_, i64>(4)?,
                    "paper": r.get::<_, String>(5)?,
                    // 【v4/P0b】保存后界面要就地更新编号/状态/来源/告警，一并取回
                    "code": r.get::<_, String>(6)?,
                    "status": r.get::<_, String>(7)?,
                    "sourceKind": r.get::<_, String>(8)?,
                    "warn": r.get::<_, String>(9)?,
                }))
            },
        )
        .unwrap_or_else(|_| serde_json::json!({}));
    serde_json::json!({ "ok": true, "id": id, "row": row })
}

/// 【题库 v3 · M3】批量改题：**一个事务里**改多道（批量改章节 / 批量打知识点 / 批量删除）✓
/// ops 每项 = { id, patch?, delete? }：
///   - delete=true → 删掉这道题（连带清 question_kp）
///   - 否则把 patch 合进 meta（键就是 meta 里的键，值 null = 删键）→ 走 lib_sync_qcols 同步真列 + 知识点
/// 任何一步失败 → 整个事务回滚（**不留半份** ✗）；只允许 type=question ✗
#[tauri::command]
fn lib_q_batch(ops: Vec<serde_json::Value>) -> serde_json::Value {
    let mut conn = match lib_open() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    // 【M4 加固】这次要删东西 → **先整库备份**（4MB 拷贝，代价极小；失败也不拦，照删）
    let will_delete = ops.iter().any(|o| o.get("delete").and_then(|v| v.as_bool()).unwrap_or(false));
    let backup = if will_delete { lib_backup_tagged("qdel") } else { String::new() };
    // 【v4】别名表只读一次（整批共用）
    let sn_map = source_normalize::load_map();
    let tx = match conn.transaction() {
        Ok(t) => t,
        Err(e) => return serde_json::json!({ "ok": false, "error": format!("事务失败: {}", e) }),
    };
    let now = now_stamp();
    let mut updated: i64 = 0;
    let mut deleted: i64 = 0;
    let mut rows: Vec<serde_json::Value> = Vec::new();
    for op in ops.iter() {
        let id = op.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        if id <= 0 {
            continue;
        }
        let kind: String = match tx.query_row(
            "SELECT type FROM library_item WHERE id = ?1",
            [id],
            |r| r.get(0),
        ) {
            Ok(k) => k,
            Err(e) => {
                return serde_json::json!({ "ok": false, "error": format!("找不到条目 #{}: {}", id, e) })
            }
        };
        if kind != "question" {
            return serde_json::json!({ "ok": false, "error": format!("只允许改题目（#{} 的类型是 {}）✗", id, kind) });
        }
        if op.get("delete").and_then(|v| v.as_bool()).unwrap_or(false) {
            if let Err(e) = tx.execute("DELETE FROM library_item WHERE id = ?1 AND builtin = 0", [id]) {
                return serde_json::json!({ "ok": false, "error": format!("删除 #{} 失败: {}", id, e) });
            }
            let _ = tx.execute("DELETE FROM question_kp WHERE qid = ?1", [id]);
            deleted += 1;
            continue;
        }
        let meta: String = tx
            .query_row("SELECT meta FROM library_item WHERE id = ?1", [id], |r| r.get(0))
            .unwrap_or_else(|_| "{}".to_string());
        let mut m: serde_json::Value =
            serde_json::from_str(if meta.is_empty() { "{}" } else { &meta }).unwrap_or_else(|_| serde_json::json!({}));
        if let (Some(obj), Some(p)) = (m.as_object_mut(), op.get("patch").and_then(|v| v.as_object())) {
            for (k, v) in p {
                if v.is_null() {
                    obj.remove(k);
                } else if k == "paperName" {
                    let n = source_normalize::normalize(v.as_str().unwrap_or(""), &sn_map);
                    obj.insert(k.clone(), serde_json::json!(n));
                } else {
                    obj.insert(k.clone(), v.clone());
                }
            }
        }
        let meta2 = serde_json::to_string(&m).unwrap_or_else(|_| "{}".to_string());
        if let Err(e) = tx.execute(
            "UPDATE library_item SET meta = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![meta2, now, id],
        ) {
            return serde_json::json!({ "ok": false, "error": format!("更新 #{} 失败: {}", id, e) });
        }
        if let Err(e) = lib_sync_qcols(&tx, id, "question", &meta2) {
            return serde_json::json!({ "ok": false, "error": e });
        }
        let _ = lib_snapshot_revision(&tx, id, "batch");
        let row = tx
            .query_row(
                "SELECT section, qtype, level, difficulty, year, paper, COALESCE(code,''), COALESCE(status,''), COALESCE(source_kind,''), COALESCE(warn,'') FROM library_item WHERE id = ?1",
                [id],
                |r| {
                    Ok(serde_json::json!({
                        "id": id,
                        "section": r.get::<_, String>(0)?,
                        "qtype": r.get::<_, String>(1)?,
                        "level": r.get::<_, String>(2)?,
                        "difficulty": r.get::<_, i64>(3)?,
                        "year": r.get::<_, i64>(4)?,
                        "paper": r.get::<_, String>(5)?,
                        "code": r.get::<_, String>(6)?,
                        "status": r.get::<_, String>(7)?,
                        "sourceKind": r.get::<_, String>(8)?,
                        "warn": r.get::<_, String>(9)?,
                    }))
                },
            )
            .unwrap_or_else(|_| serde_json::json!({ "id": id }));
        rows.push(row);
        updated += 1;
    }
    if let Err(e) = tx.commit() {
        return serde_json::json!({ "ok": false, "error": format!("提交失败: {}", e) });
    }
    serde_json::json!({ "ok": true, "updated": updated, "deleted": deleted, "backup": backup, "rows": rows })
}

/* ================= 【v5 · P1a】录入加固：批次 / 草稿 / 闸门 / 修订快照 ================= */

/// 草稿的哪些状态**允许**写进正式库（方案 §5.1：只有 ready / approved / published）
fn lib_draft_ok_for_commit(status: &str) -> bool {
    matches!(status, "ready" | "approved" | "published")
}

/// 给一道题存一份修订快照（version = 该题现有最大版本 + 1）。
/// 为什么要：批量改 / 导入 / AI 改都可能改错，**得能回溯**（对齐 deck 已有的版本历史）。
fn lib_snapshot_revision(conn: &rusqlite::Connection, qid: i64, reason: &str) -> Result<(), String> {
    let meta: String = conn
        .query_row("SELECT meta FROM library_item WHERE id = ?1", [qid], |r| r.get(0))
        .unwrap_or_else(|_| "{}".to_string());
    let next: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) + 1 FROM question_revision WHERE qid = ?1",
            [qid],
            |r| r.get(0),
        )
        .unwrap_or(1);
    conn.execute(
        "INSERT INTO question_revision(qid, version, snapshot, reason, created_at) VALUES(?1,?2,?3,?4,?5)",
        rusqlite::params![qid, next, meta, reason, now_stamp()],
    )
    .map_err(|e| format!("写修订快照失败: {}", e))?;
    Ok(())
}

/// 草稿里的 options / knowledge 是 **JSON 数组字符串**（TEXT 列）；坏了给空表，绝不让一条脏草稿卡住整批
fn lib_draft_arr(s: &str) -> Vec<String> {
    serde_json::from_str::<serde_json::Value>(if s.trim().is_empty() { "[]" } else { s })
        .ok()
        .and_then(|v| v.as_array().cloned())
        .map(|a| {
            a.iter()
                .map(|x| match x {
                    serde_json::Value::String(t) => t.clone(),
                    other => other.to_string(),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// JSON 值（前端传来的数组）→ Vec<String>
fn lib_json_arr(v: Option<&serde_json::Value>) -> Vec<String> {
    v.and_then(|x| x.as_array())
        .map(|a| {
            a.iter()
                .map(|x| match x {
                    serde_json::Value::String(s) => s.clone(),
                    other => other.to_string(),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// 开一个导入批次。**幂等**：同一 idem_key 直接回老批次（不重复建、不重复计费）。
#[tauri::command]
fn lib_import_begin(payload: serde_json::Value) -> serde_json::Value {
    let conn = match lib_open() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let gs = |k: &str| {
        payload
            .get(k)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string()
    };
    let row_of = |id: &str| -> Option<serde_json::Value> {
        conn.query_row(
            "SELECT id, source_type, source_label, status, question_count, idem_key FROM import_batch WHERE id = ?1",
            [id],
            |r| {
                Ok(serde_json::json!({
                    "id": r.get::<_, String>(0)?,
                    "sourceType": r.get::<_, String>(1)?,
                    "sourceLabel": r.get::<_, String>(2)?,
                    "status": r.get::<_, String>(3)?,
                    "questionCount": r.get::<_, i64>(4)?,
                    "idemKey": r.get::<_, String>(5)?,
                }))
            },
        )
        .ok()
    };
    let idem = gs("idemKey");
    if !idem.is_empty() {
        let found: Option<String> = conn
            .query_row("SELECT id FROM import_batch WHERE idem_key = ?1", [&idem], |r| r.get(0))
            .ok();
        if let Some(id) = found {
            return serde_json::json!({ "ok": true, "reused": true, "code": "IDEM_HIT", "batch": row_of(&id) });
        }
    }
    let base = format!("B-{}", now_stamp());
    let mut id = base.clone();
    let mut n = 1;
    while row_of(&id).is_some() {
        n += 1;
        id = format!("{}-{}", base, n);
    }
    if let Err(e) = conn.execute(
        "INSERT INTO import_batch(id, source_type, source_path, source_label, summary, question_count, status, idem_key, extra, created_at) VALUES(?1,?2,?3,?4,'',0,'running',?5,?6,?7)",
        rusqlite::params![id, gs("sourceType"), gs("sourcePath"), gs("sourceLabel"), idem, gs("extra"), now_stamp()],
    ) {
        return serde_json::json!({ "ok": false, "error": format!("建批次失败: {}", e) });
    }
    serde_json::json!({ "ok": true, "reused": false, "code": "BATCH_NEW", "batch": row_of(&id) })
}

/// 往批次里灌草稿。**每条都过质量闸门**；expectedCount 与实际道数不符 → 整组转人工。
#[tauri::command]
fn lib_import_add_drafts(payload: serde_json::Value) -> serde_json::Value {
    let conn = match lib_open() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let batch = payload.get("batchId").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let expected = payload.get("expectedCount").and_then(|v| v.as_i64()).unwrap_or(-1);
    let drafts = payload.get("drafts").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    if batch.is_empty() || drafts.is_empty() {
        return serde_json::json!({ "ok": false, "error": "batchId 与 drafts 不能为空" });
    }
    let exists: i64 = conn
        .query_row("SELECT COUNT(*) FROM import_batch WHERE id = ?1", [&batch], |r| r.get(0))
        .unwrap_or(0);
    if exists == 0 {
        return serde_json::json!({ "ok": false, "error": format!("批次 {} 不存在（草稿不能挂在不存在的批次上）", batch) });
    }
    let total = drafts.len() as i64;
    let now = now_stamp();
    let mut ids: Vec<String> = Vec::new();
    let mut need: i64 = 0;
    for (i, d) in drafts.iter().enumerate() {
        let dgs = |k: &str| d.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
        let sid = d.get("sourceItemId").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        let id = if sid.is_empty() {
            format!("{}-{:03}", batch, i + 1)
        } else {
            format!("{}-{}", batch, sid)
        };
        let stem = dgs("stem");
        let options = lib_json_arr(d.get("options"));
        let qtype = dgs("qtype");
        let image_refs: usize = import_gate::count_image_refs(&stem)
            + options.iter().map(|o| import_gate::count_image_refs(o)).sum::<usize>();
        let images = d.get("images").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
        let g = import_gate::GateInput {
            stem: &stem,
            options: &options,
            qtype: &qtype,
            answer: &dgs("answer"),
            solution: &dgs("solution"),
            raw_text: &dgs("rawText"),
            image_refs,
            images,
            expected_count: expected,
            actual_count: total,
        };
        let res = import_gate::check(&g);
        if res.needs_review {
            need += 1;
        }
        let nr: i64 = if res.needs_review { 1 } else { 0 };
        let opts_json = serde_json::to_string(&options).unwrap_or_else(|_| "[]".to_string());
        let kp_json = serde_json::to_string(&lib_json_arr(d.get("knowledge"))).unwrap_or_else(|_| "[]".to_string());
        if let Err(e) = conn.execute(
            "INSERT INTO import_draft(id,batch_id,source_item_id,source_label,page,bbox,confidence,needs_review,stem,options,answer,solution,qtype,section,difficulty,knowledge,year,paper,source_kind,raw_text,warn,status,target_qid,extra,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,'needs_review',0,?22,?23) ON CONFLICT(id) DO UPDATE SET stem=excluded.stem, options=excluded.options, answer=excluded.answer, solution=excluded.solution, qtype=excluded.qtype, section=excluded.section, difficulty=excluded.difficulty, knowledge=excluded.knowledge, year=excluded.year, paper=excluded.paper, source_kind=excluded.source_kind, raw_text=excluded.raw_text, warn=excluded.warn, needs_review=excluded.needs_review, page=excluded.page, bbox=excluded.bbox, confidence=excluded.confidence, source_label=excluded.source_label",
            rusqlite::params![
                id,
                batch,
                sid,
                dgs("sourceLabel"),
                d.get("page").and_then(|v| v.as_i64()),
                dgs("bbox"),
                d.get("confidence").and_then(|v| v.as_f64()),
                nr,
                stem,
                opts_json,
                dgs("answer"),
                dgs("solution"),
                qtype,
                dgs("section"),
                d.get("difficulty").and_then(|v| v.as_i64()).unwrap_or(0),
                kp_json,
                d.get("year").and_then(|v| v.as_i64()).unwrap_or(0),
                dgs("paper"),
                dgs("sourceKind"),
                dgs("rawText"),
                res.warn,
                dgs("extra"),
                now
            ],
        ) {
            return serde_json::json!({ "ok": false, "error": format!("写草稿 {} 失败: {}", id, e) });
        }
        ids.push(id);
    }
    serde_json::json!({ "ok": true, "added": total, "needReview": need, "ids": ids })
}

/// 读一批草稿（界面「草稿箱」用）
#[tauri::command]
fn lib_import_drafts(batch: String) -> serde_json::Value {
    let conn = match lib_open() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let mut st = match conn.prepare(
        "SELECT id, source_item_id, source_label, page, confidence, needs_review, stem, options, answer, solution, qtype, section, difficulty, knowledge, year, paper, source_kind, raw_text, warn, status, target_qid, bbox FROM import_draft WHERE batch_id = ?1 ORDER BY created_at, id",
    ) {
        Ok(x) => x,
        Err(e) => return serde_json::json!({ "ok": false, "error": format!("读草稿失败: {}", e) }),
    };
    let items: Vec<serde_json::Value> = st
        .query_map([&batch], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "sourceItemId": r.get::<_, String>(1)?,
                "sourceLabel": r.get::<_, String>(2)?,
                "page": r.get::<_, Option<i64>>(3)?,
                "confidence": r.get::<_, Option<f64>>(4)?,
                "needsReview": r.get::<_, i64>(5)?,
                "stem": r.get::<_, String>(6)?,
                "options": r.get::<_, String>(7)?,
                "answer": r.get::<_, String>(8)?,
                "solution": r.get::<_, String>(9)?,
                "qtype": r.get::<_, String>(10)?,
                "section": r.get::<_, String>(11)?,
                "difficulty": r.get::<_, i64>(12)?,
                "knowledge": r.get::<_, String>(13)?,
                "year": r.get::<_, i64>(14)?,
                "paper": r.get::<_, String>(15)?,
                "sourceKind": r.get::<_, String>(16)?,
                "rawText": r.get::<_, String>(17)?,
                "warn": r.get::<_, String>(18)?,
                "status": r.get::<_, String>(19)?,
                "targetQid": r.get::<_, i64>(20)?,
                "bbox": r.get::<_, String>(21)?,
            }))
        })
        .map(|it| it.filter_map(|x| x.ok()).collect())
        .unwrap_or_default();
    serde_json::json!({ "ok": true, "items": items })
}

/// 人工改草稿。把 status 改成 ready/approved/published 是**唯一**能放行进正式库的动作。
#[tauri::command]
fn lib_import_draft_patch(ids: Vec<String>, patch: serde_json::Value) -> serde_json::Value {
    let conn = match lib_open() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let p = match patch.as_object() {
        Some(o) => o.clone(),
        None => Default::default(),
    };
    if p.is_empty() {
        return serde_json::json!({ "ok": false, "error": "patch 是空的" });
    }
    let col_of = |k: &str| -> Option<&'static str> {
        Some(match k {
            "status" => "status",
            "stem" => "stem",
            "options" => "options",
            "answer" => "answer",
            "solution" => "solution",
            "qtype" => "qtype",
            "section" => "section",
            "difficulty" => "difficulty",
            "knowledge" => "knowledge",
            "year" => "year",
            "paper" => "paper",
            "sourceKind" => "source_kind",
            "rawText" => "raw_text",
            "warn" => "warn",
            "needsReview" => "needs_review",
            "confidence" => "confidence",
            "page" => "page",
            "bbox" => "bbox",
            _ => return None,
        })
    };
    let mut n = 0i64;
    for id in ids.iter() {
        for (k, v) in p.iter() {
            let col = match col_of(k) {
                Some(c) => c,
                None => {
                    return serde_json::json!({ "ok": false, "error": format!("不允许改草稿字段 {}（白名单之外）", k) })
                }
            };
            let val = match v {
                serde_json::Value::Null => rusqlite::types::Value::Null,
                serde_json::Value::Bool(b) => rusqlite::types::Value::Integer(if *b { 1 } else { 0 }),
                serde_json::Value::Number(num) => match num.as_i64() {
                    Some(i) => rusqlite::types::Value::Integer(i),
                    None => rusqlite::types::Value::Real(num.as_f64().unwrap_or(0.0)),
                },
                // ⚠ JSON 字符串要取**里面的**字符串：Value::to_string() 会带上双引号，
                //   会把 status 写成 "approved"（带引号）→ 入库闸门 fail-closed 直接拒掉。
                //   v1447 第一次探针就是这么抓到的。
                serde_json::Value::String(t) => rusqlite::types::Value::Text(t.clone()),
                other => rusqlite::types::Value::Text(other.to_string()),
            };
            if let Err(e) = conn.execute(
                &format!("UPDATE import_draft SET {} = ?1 WHERE id = ?2", col),
                rusqlite::params![val, id],
            ) {
                return serde_json::json!({ "ok": false, "error": format!("改草稿 {} 失败: {}", id, e) });
            }
        }
        // 状态改成能入库的那几档 = 人工已经看过了 → 顺手清掉 needs_review
        if let Some(st) = p.get("status").and_then(|v| v.as_str()) {
            if lib_draft_ok_for_commit(st) {
                let _ = conn.execute("UPDATE import_draft SET needs_review = 0 WHERE id = ?1", [id]);
            }
        }
        n += 1;
    }
    serde_json::json!({ "ok": true, "updated": n })
}

/// 草稿**确认入库**。fail-closed：只要有一条不在 ready/approved/published，**整批拒绝**（不写一半）。
#[tauri::command]
fn lib_import_commit(ids: Vec<String>) -> serde_json::Value {
    let mut conn = match lib_open() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    if ids.is_empty() {
        return serde_json::json!({ "ok": false, "error": "没有选中草稿" });
    }
    let mut rows: Vec<serde_json::Value> = Vec::new();
    let mut blocked: Vec<serde_json::Value> = Vec::new();
    for id in ids.iter() {
        let got = conn.query_row(
            "SELECT id, batch_id, stem, options, answer, solution, qtype, section, difficulty, knowledge, year, paper, warn, status, needs_review FROM import_draft WHERE id = ?1",
            [id],
            |r| {
                Ok(serde_json::json!({
                    "id": r.get::<_, String>(0)?,
                    "batchId": r.get::<_, String>(1)?,
                    "stem": r.get::<_, String>(2)?,
                    "options": r.get::<_, String>(3)?,
                    "answer": r.get::<_, String>(4)?,
                    "solution": r.get::<_, String>(5)?,
                    "qtype": r.get::<_, String>(6)?,
                    "section": r.get::<_, String>(7)?,
                    "difficulty": r.get::<_, i64>(8)?,
                    "knowledge": r.get::<_, String>(9)?,
                    "year": r.get::<_, i64>(10)?,
                    "paper": r.get::<_, String>(11)?,
                    "warn": r.get::<_, String>(12)?,
                    "status": r.get::<_, String>(13)?,
                    "needsReview": r.get::<_, i64>(14)?,
                }))
            },
        );
        match got {
            Ok(v) => {
                let st = v.get("status").and_then(|x| x.as_str()).unwrap_or("").to_string();
                if !lib_draft_ok_for_commit(&st) {
                    blocked.push(serde_json::json!({
                        "id": id,
                        "status": st,
                        "warn": v.get("warn").and_then(|x| x.as_str()).unwrap_or(""),
                    }));
                }
                rows.push(v);
            }
            Err(e) => return serde_json::json!({ "ok": false, "error": format!("找不到草稿 {}: {}", id, e) }),
        }
    }
    if !blocked.is_empty() {
        return serde_json::json!({
            "ok": false,
            "code": "NEEDS_REVIEW",
            "blocked": blocked,
            "error": format!("有 {} 条草稿还没人工确认，整批都不入（只有 ready/approved/published 能进正式库）", blocked.len()),
        });
    }
    let sn_map = source_normalize::load_map();
    let now = now_stamp();
    let tx = match conn.transaction() {
        Ok(t) => t,
        Err(e) => return serde_json::json!({ "ok": false, "error": format!("事务失败: {}", e) }),
    };
    let mut created: Vec<serde_json::Value> = Vec::new();
    let mut batches: Vec<String> = Vec::new();
    for v in rows.iter() {
        let draft_id = v.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let batch_id = v.get("batchId").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let stem = v.get("stem").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let title: String = {
            let t: String = stem.chars().take(40).collect();
            if t.trim().is_empty() { "（无题干）".to_string() } else { t }
        };
        let mut m = serde_json::json!({
            "stem": stem.clone(),
            "options": lib_draft_arr(v.get("options").and_then(|x| x.as_str()).unwrap_or("[]")),
            "answer": v.get("answer").and_then(|x| x.as_str()).unwrap_or(""),
            "solution": v.get("solution").and_then(|x| x.as_str()).unwrap_or(""),
            "qtype": v.get("qtype").and_then(|x| x.as_str()).unwrap_or(""),
            "difficulty": v.get("difficulty").and_then(|x| x.as_i64()).unwrap_or(0),
            "knowledge": lib_draft_arr(v.get("knowledge").and_then(|x| x.as_str()).unwrap_or("[]")),
            "year": v.get("year").and_then(|x| x.as_i64()).unwrap_or(0),
            "section": v.get("section").and_then(|x| x.as_str()).unwrap_or(""),
            "paperName": v.get("paper").and_then(|x| x.as_str()).unwrap_or(""),
            "status": "published",
        });
        // ⚠ section 真列有 AFTER INSERT 触发器从 meta 抽（v1→v2 建的），
        //   所以章节**必须同时进 meta**，只写列会被触发器覆盖成空 ✗（v1447 探针抓到的）
        let warn = v.get("warn").and_then(|x| x.as_str()).unwrap_or("");
        if !warn.is_empty() {
            m["warn"] = serde_json::json!(warn);
        }
        if !batch_id.is_empty() {
            m["batchId"] = serde_json::json!(batch_id);
        }
        let meta = lib_prepare_qmeta(&tx, &m.to_string(), &sn_map);
        let section = v.get("section").and_then(|x| x.as_str()).unwrap_or("").to_string();
        if let Err(e) = tx.execute(
            "INSERT INTO library_item (type,title,body,meta,tags,source,builtin,created_at,updated_at,used_count,section,batch_id) VALUES (?1,?2,?3,?4,'','',0,?5,?6,0,?7,?8)",
            rusqlite::params!["question", title, stem, meta, now, now, section, batch_id],
        ) {
            return serde_json::json!({ "ok": false, "error": format!("写题失败: {}", e) });
        }
        let qid = tx.last_insert_rowid();
        if let Err(e) = lib_sync_qcols(&tx, qid, "question", &meta) {
            return serde_json::json!({ "ok": false, "error": e });
        }
        // 入库即留一份修订快照（reason=import）—— 以后改坏了能回溯
        if let Err(e) = lib_snapshot_revision(&tx, qid, "import") {
            return serde_json::json!({ "ok": false, "error": e });
        }
        if let Err(e) = tx.execute(
            "UPDATE import_draft SET status = 'published', target_qid = ?1, needs_review = 0 WHERE id = ?2",
            rusqlite::params![qid, draft_id],
        ) {
            return serde_json::json!({ "ok": false, "error": format!("回写草稿失败: {}", e) });
        }
        if !batch_id.is_empty() && !batches.contains(&batch_id) {
            batches.push(batch_id.clone());
        }
        created.push(serde_json::json!({ "draftId": draft_id, "qid": qid }));
    }
    // 批次计数 + running / done / partial（还有没确认的草稿就是 partial）
    for b in batches.iter() {
        if let Err(e) = tx.execute(
            "UPDATE import_batch SET question_count = question_count + 1 WHERE id = ?1",
            [b],
        ) {
            return serde_json::json!({ "ok": false, "error": format!("更新批次计数失败: {}", e) });
        }
        let left: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM import_draft WHERE batch_id = ?1 AND status NOT IN ('published','rejected')",
                [b],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let st = if left > 0 { "partial" } else { "done" };
        let _ = tx.execute(
            "UPDATE import_batch SET status = ?1, finished_at = ?2 WHERE id = ?3",
            rusqlite::params![st, now, b],
        );
    }
    if let Err(e) = tx.commit() {
        return serde_json::json!({ "ok": false, "error": format!("提交失败: {}", e) });
    }
    serde_json::json!({ "ok": true, "created": created.len(), "items": created })
}

/// 弃用草稿（明确不入库，**保留审计**）
#[tauri::command]
fn lib_import_discard(ids: Vec<String>) -> serde_json::Value {
    let conn = match lib_open() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let mut n = 0i64;
    for id in ids.iter() {
        match conn.execute("UPDATE import_draft SET status = 'rejected' WHERE id = ?1", [id]) {
            Ok(k) => n += k as i64,
            Err(e) => return serde_json::json!({ "ok": false, "error": format!("弃用草稿 {} 失败: {}", id, e) }),
        }
    }
    serde_json::json!({ "ok": true, "rejected": n })
}

/// 识别历史（批次列表）
#[tauri::command]
fn lib_import_batches(limit: i64) -> serde_json::Value {
    let conn = match lib_open() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let lim = limit.clamp(1, 200);
    let mut st = match conn.prepare(
        "SELECT id, source_type, source_label, status, question_count, idem_key, created_at, finished_at FROM import_batch ORDER BY created_at DESC, id DESC LIMIT ?1",
    ) {
        Ok(x) => x,
        Err(e) => return serde_json::json!({ "ok": false, "error": format!("读批次失败: {}", e) }),
    };
    let items: Vec<serde_json::Value> = st
        .query_map([lim], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "sourceType": r.get::<_, String>(1)?,
                "sourceLabel": r.get::<_, String>(2)?,
                "status": r.get::<_, String>(3)?,
                "questionCount": r.get::<_, i64>(4)?,
                "idemKey": r.get::<_, String>(5)?,
                "createdAt": r.get::<_, String>(6)?,
                "finishedAt": r.get::<_, Option<String>>(7)?,
            }))
        })
        .map(|it| it.filter_map(|x| x.ok()).collect())
        .unwrap_or_default();
    serde_json::json!({ "ok": true, "items": items })
}

/// 从识别历史**重建草稿**（§5.4：重建**只生成待审核草稿，绝不重调 OCR / LLM** —— 这条直接省钱）
#[tauri::command]
fn lib_import_rebuild(batch: String) -> serde_json::Value {
    let conn = match lib_open() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let src: i64 = conn
        .query_row("SELECT COUNT(*) FROM import_batch WHERE id = ?1", [&batch], |r| r.get(0))
        .unwrap_or(0);
    if src == 0 {
        return serde_json::json!({ "ok": false, "error": format!("批次 {} 不存在", batch) });
    }
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM import_draft WHERE batch_id = ?1", [&batch], |r| r.get(0))
        .unwrap_or(0);
    if n == 0 {
        return serde_json::json!({ "ok": false, "error": "这一批没有草稿可重建" });
    }
    let base = format!("B-{}", now_stamp());
    let mut nid = base.clone();
    let mut k = 1;
    while conn
        .query_row("SELECT COUNT(*) FROM import_batch WHERE id = ?1", [&nid], |r| r.get::<_, i64>(0))
        .unwrap_or(0)
        > 0
    {
        k += 1;
        nid = format!("{}-{}", base, k);
    }
    let now = now_stamp();
    let extra_json = serde_json::json!({ "rebuiltFrom": batch.clone() }).to_string();
    if let Err(e) = conn.execute(
        "INSERT INTO import_batch(id, source_type, source_path, source_label, summary, question_count, status, idem_key, extra, created_at) SELECT ?1, source_type, source_path, source_label, summary, 0, 'running', NULL, ?2, ?3 FROM import_batch WHERE id = ?4",
        rusqlite::params![nid, extra_json, now, batch],
    ) {
        return serde_json::json!({ "ok": false, "error": format!("建重建批次失败: {}", e) });
    }
    // 草稿整批复制到新批次（id 前缀换掉）；**不碰 library_item，也不调任何 OCR**
    let copied = conn.execute(
        "INSERT INTO import_draft(id,batch_id,source_item_id,source_label,page,bbox,confidence,needs_review,stem,options,answer,solution,qtype,section,difficulty,knowledge,year,paper,source_kind,raw_text,warn,status,target_qid,extra,created_at) SELECT ?1 || substr(id, length(?2) + 1), ?1, source_item_id, source_label, page, bbox, confidence, needs_review, stem, options, answer, solution, qtype, section, difficulty, knowledge, year, paper, source_kind, raw_text, warn, status, target_qid, extra, ?3 FROM import_draft WHERE batch_id = ?2",
        rusqlite::params![nid, batch, now],
    );
    match copied {
        Ok(c) => serde_json::json!({ "ok": true, "batch": nid, "copied": c, "from": batch, "ocrCalls": 0 }),
        Err(e) => serde_json::json!({ "ok": false, "error": format!("复制草稿失败: {}", e) }),
    }
}

/// 某道题的修订历史（新→旧）
#[tauri::command]
fn lib_q_revisions(qid: i64) -> serde_json::Value {
    let conn = match lib_open() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let mut st = match conn.prepare(
        "SELECT version, snapshot, reason, created_at FROM question_revision WHERE qid = ?1 ORDER BY version DESC",
    ) {
        Ok(x) => x,
        Err(e) => return serde_json::json!({ "ok": false, "error": format!("读修订失败: {}", e) }),
    };
    let items: Vec<serde_json::Value> = st
        .query_map([qid], |r| {
            Ok(serde_json::json!({
                "version": r.get::<_, i64>(0)?,
                "snapshot": r.get::<_, String>(1)?,
                "reason": r.get::<_, String>(2)?,
                "createdAt": r.get::<_, String>(3)?,
            }))
        })
        .map(|it| it.filter_map(|x| x.ok()).collect())
        .unwrap_or_default();
    serde_json::json!({ "ok": true, "items": items })
}

/// 【v4】知识点 / 方法受控词表（**板块级**）：给前端渲染分类与选择用 ✓
#[tauri::command]
fn lib_kp_catalog() -> serde_json::Value {
    match lib_open() {
        Ok(conn) => {
            let mut st = match conn
                .prepare("SELECT kp, kind, aliases, parent FROM kp_catalog ORDER BY kind, parent, kp")
            {
                Ok(x) => x,
                Err(e) => return serde_json::json!({ "ok": false, "error": format!("读词表失败: {}", e) }),
            };
            let items: Vec<serde_json::Value> = st
                .query_map([], |r| {
                    Ok(serde_json::json!({
                        "kp": r.get::<_, String>(0)?,
                        "kind": r.get::<_, String>(1)?,
                        "aliases": r.get::<_, String>(2)?,
                        "parent": r.get::<_, String>(3)?,
                    }))
                })
                .map(|it| it.filter_map(|x| x.ok()).collect())
                .unwrap_or_default();
            serde_json::json!({ "ok": true, "items": items })
        }
        Err(e) => serde_json::json!({ "ok": false, "error": e }),
    }
}

/// 【v4】来源合规报告：给「来源规约」这一步一个可验收的产出 ✓
#[tauri::command]
fn lib_source_report() -> serde_json::Value {
    let conn = match lib_open() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let rows: Vec<(i64, String, String)> = {
        let mut st = match conn.prepare("SELECT id, title, paper FROM library_item WHERE type = 'question'") {
            Ok(x) => x,
            Err(e) => return serde_json::json!({ "ok": false, "error": format!("读题目失败: {}", e) }),
        };
        st.query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        })
        .map(|it| it.filter_map(|x| x.ok()).collect())
        .unwrap_or_default()
    };
    // ⚠ 「空值」不能算合规 —— 169 道里 129 道 paper 是空的，混进分子会看着很漂亮却毫无意义 ✗
    let pct = |num: i64, den: i64| -> f64 {
        if den > 0 {
            ((num as f64) * 1000.0 / (den as f64)).round() / 10.0
        } else {
            100.0
        }
    };
    let mut by_kind: std::collections::BTreeMap<String, i64> = std::collections::BTreeMap::new();
    let mut total: i64 = 0;
    let mut empty: i64 = 0;
    let mut canonical: i64 = 0;
    let mut needs: Vec<serde_json::Value> = Vec::new();
    for (id, title, paper) in rows {
        total += 1;
        let p = paper.trim();
        let ok = !p.is_empty() && source_normalize::is_canonical(p);
        if p.is_empty() {
            empty += 1;
        } else if ok {
            canonical += 1;
        }
        let k = source_normalize::kind_of(p).to_string();
        *by_kind.entry(k.clone()).or_insert(0) += 1;
        if !p.is_empty() && !ok {
            let t: String = title.chars().take(24).collect();
            needs.push(serde_json::json!({ "id": id, "title": t, "paper": paper, "kind": k }));
        }
    }
    let filled = total - empty;
    let items: Vec<serde_json::Value> = by_kind
        .iter()
        .map(|(k, n)| serde_json::json!({ "kind": k, "count": n }))
        .collect();
    serde_json::json!({
        "ok": true,
        "total": total,
        "empty": empty,
        "canonical": canonical,
        // 【P0b 修 bug】items 算出来了却没放进返回值 —— 报告少了「按来源类别」这一块
        "byKind": items,
        "needsWork": needs,
        // 有来源的比例（覆盖率）
        "fillRate": pct(filled, total),
        // 「有来源的里面有多少是成型的」—— 这才是规约真正的验收指标
        "canonicalRate": pct(canonical, filled),
    })
}

/// 库信息：路径 + 条目数（前端显示与诊断用）。
#[tauri::command]
fn lib_info() -> serde_json::Value {
    let p = library_path();
    match lib_open() {
        Ok(conn) => {
            let n: i64 = conn
                .query_row("SELECT COUNT(*) FROM library_item", [], |r| r.get(0))
                .unwrap_or(0);
            serde_json::json!({ "ok": true, "path": p.to_string_lossy(), "count": n })
        }
        Err(e) => serde_json::json!({ "ok": false, "path": p.to_string_lossy(), "error": e }),
    }
}

/// 【按 id 取资源】题库大图存成 type='asset' 的条目后，前端按 id 把图取回来。
/// 以前是整库 asset 拉一次（资源多了首次加载很慢 ✗）→ 现在按 id 精确取 ✓
#[tauri::command]
fn asset_get(ids: Vec<i64>) -> serde_json::Value {
    if ids.is_empty() {
        return serde_json::json!({ "ok": true, "items": [] });
    }
    let conn = match lib_open() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let mut out: Vec<serde_json::Value> = Vec::new();
    for id in ids {
        let row = conn.query_row(
            "SELECT id, meta FROM library_item WHERE id = ?1 AND type = 'asset'",
            [id],
            |r| { let i: i64 = r.get(0)?; let m: String = r.get(1)?; Ok((i, m)) },
        );
        if let Ok((i, m)) = row {
            out.push(serde_json::json!({ "id": i, "meta": m }));
        }
    }
    serde_json::json!({ "ok": true, "items": out })
}
/// 取某一类条目（**按 id 降序：新录入的在最上面**）。
///
/// ⚠ 曾经是 ORDER BY used_count DESC, id ASC —— 但界面上早就不显示「引用次数」、
///   抽题也不按它排（pickByRules 是随机的），于是「用过很多次的老题永远压在列表最前」，
///   新导入的一整卷反而排到最后，老师找不到。现在直接按 id 降序（id 是自增主键 = 录入顺序）。
#[tauri::command]
fn lib_query(kind: String) -> serde_json::Value {
    let conn = match lib_open() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let mut stmt = match conn.prepare(concat!(
        "SELECT id, title, body, meta, tags, source, builtin, updated_at, used_count ",
        "FROM library_item WHERE type = ?1 ",
        "ORDER BY id DESC"
    )) {
        Ok(s) => s,
        Err(e) => return serde_json::json!({ "ok": false, "error": format!("查询失败: {}", e) }),
    };
    let rows = stmt.query_map([&kind], |r| {
        Ok(serde_json::json!({
            "id": r.get::<_, i64>(0)?,
            "title": r.get::<_, String>(1)?,
            "body": r.get::<_, String>(2)?,
            "meta": r.get::<_, String>(3)?,
            "tags": r.get::<_, String>(4)?,
            "source": r.get::<_, String>(5)?,
            "builtin": r.get::<_, i64>(6)?,
            "updatedAt": r.get::<_, String>(7)?,
            "usedCount": r.get::<_, i64>(8)?
        }))
    });
    let mut out: Vec<serde_json::Value> = Vec::new();
    match rows {
        Ok(it) => {
            for x in it.flatten() {
                out.push(x);
            }
        }
        Err(e) => return serde_json::json!({ "ok": false, "error": format!("读取失败: {}", e) }),
    }
    serde_json::json!({ "ok": true, "items": out })
}

/// 保存条目：id 为空或 0 时插入，否则更新（内置条目也可更新标题/正文）。
#[tauri::command]
fn lib_save(item: serde_json::Value) -> serde_json::Value {
    let conn = match lib_open() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let gs = |k: &str| {
        item.get(k)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };
    let kind = gs("type");
    let title = gs("title");
    if kind.is_empty() || title.is_empty() {
        return serde_json::json!({ "ok": false, "error": "type 与 title 不能为空" });
    }
    let body = gs("body");
    let tags = gs("tags");
    let source = gs("source");
    let meta = {
        let m = gs("meta");
        if m.is_empty() { "{}".to_string() } else { m }
    };
    // 【v4】题目写库前规整 meta：来源归一 + status/code 缺省（唯一入口）
    let meta = if kind == "question" {
        lib_prepare_qmeta(&conn, &meta, &source_normalize::load_map())
    } else {
        meta
    };
    let builtin = item.get("builtin").and_then(|v| v.as_i64()).unwrap_or(0);
    let id = item.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
    let now = now_stamp();
    let saved: Result<i64, String> = if id > 0 {
        conn.execute(
            concat!(
                "UPDATE library_item SET title=?1, body=?2, meta=?3, tags=?4, ",
                "source=?5, updated_at=?6 WHERE id=?7"
            ),
            rusqlite::params![title, body, meta, tags, source, now, id],
        )
        .map(|_| id)
        .map_err(|e| format!("更新失败: {}", e))
    } else {
        conn.execute(
            concat!(
                "INSERT INTO library_item ",
                "(type,title,body,meta,tags,source,builtin,created_at,updated_at,used_count) ",
                "VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,0)"
            ),
            rusqlite::params![kind, title, body, meta, tags, source, builtin, now, now],
        )
        .map(|_| conn.last_insert_rowid())
        .map_err(|e| format!("写入失败: {}", e))
    };
    match saved {
        Ok(saved_id) => {
            // 【题库 v3】把 meta 里的筛选字段 + 知识点同步到真列与 question_kp 表 ✓
            // （非 question 类型直接返回 Ok，公式/图形/课件走这里不受影响 ✓）
            if let Err(e) = lib_sync_qcols(&conn, saved_id, &kind, &meta) {
                return serde_json::json!({ "ok": false, "error": e });
            }
            // 【v5】题目改动留一份修订快照（公式 / 图形等其他类型不动）
            if kind == "question" {
                let _ = lib_snapshot_revision(&conn, saved_id, "patch");
            }
            serde_json::json!({ "ok": true, "id": saved_id })
        }
        Err(e) => serde_json::json!({ "ok": false, "error": e }),
    }
}

/// 删除条目。**内置条目不允许删**（builtin=0 才删）—— 避免用户误删预制公式。
#[tauri::command]
fn lib_remove(id: i64) -> serde_json::Value {
    match lib_open() {
        Ok(conn) => match conn.execute("DELETE FROM library_item WHERE id = ?1 AND builtin = 0", [id]) {
            Ok(n) => {
                // 题库：条目没了，它的知识点行也要清（否则知识点统计里挂着幽灵 ✗）
                let _ = conn.execute("DELETE FROM question_kp WHERE qid = ?1", [id]);
                serde_json::json!({ "ok": true, "removed": n })
            }
            Err(e) => serde_json::json!({ "ok": false, "error": format!("删除失败: {}", e) }),
        },
        Err(e) => serde_json::json!({ "ok": false, "error": e }),
    }
}

/// 记一次使用（用于排序：常用的排前面）。
#[tauri::command]
fn lib_bump(id: i64) -> serde_json::Value {
    match lib_open() {
        Ok(conn) => {
            let _ = conn.execute("UPDATE library_item SET used_count = used_count + 1 WHERE id = ?1", [id]);
            serde_json::json!({ "ok": true })
        }
        Err(e) => serde_json::json!({ "ok": false, "error": e }),
    }
}

/// 批量灌入内置条目（同一 type+title 且 builtin=1 的已存在则跳过）。
/// 走事务 —— 两百多条一次性写入，避免逐条 IPC。
#[tauri::command]
fn lib_seed(items: Vec<serde_json::Value>) -> serde_json::Value {
    let mut conn = match lib_open() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let tx = match conn.transaction() {
        Ok(t) => t,
        Err(e) => return serde_json::json!({ "ok": false, "error": format!("事务失败: {}", e) }),
    };
    let now = now_stamp();
    let mut added: i64 = 0;
    for item in items.iter() {
        let gs = |k: &str| {
            item.get(k)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        };
        let kind = gs("type");
        let title = gs("title");
        if kind.is_empty() || title.is_empty() {
            continue;
        }
        let exists: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM library_item WHERE type=?1 AND title=?2 AND builtin=1",
                rusqlite::params![kind, title],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if exists > 0 {
            continue;
        }
        let meta = {
            let m = gs("meta");
            if m.is_empty() { "{}".to_string() } else { m }
        };
        let r = tx.execute(
            concat!(
                "INSERT INTO library_item ",
                "(type,title,body,meta,tags,source,builtin,created_at,updated_at,used_count) ",
                "VALUES (?1,?2,?3,?4,?5,?6,1,?7,?8,0)"
            ),
            rusqlite::params![kind, title, gs("body"), meta, gs("tags"), gs("source"), now, now],
        );
        if r.is_ok() {
            added += 1;
        }
    }
    if let Err(e) = tx.commit() {
        return serde_json::json!({ "ok": false, "error": format!("提交失败: {}", e) });
    }
    serde_json::json!({ "ok": true, "added": added })
}

/// 读迁移标记等（键值对）。
#[tauri::command]
fn lib_meta_get(k: String) -> serde_json::Value {
    match lib_open() {
        Ok(conn) => {
            let v: Option<String> = conn
                .query_row("SELECT v FROM library_meta WHERE k = ?1", [&k], |r| r.get(0))
                .ok();
            serde_json::json!({ "ok": true, "value": v })
        }
        Err(e) => serde_json::json!({ "ok": false, "error": e }),
    }
}

/// 写迁移标记等。
#[tauri::command]
fn lib_meta_set(k: String, v: String) -> serde_json::Value {
    match lib_open() {
        Ok(conn) => match conn.execute(
            "INSERT INTO library_meta (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = ?2",
            [&k, &v],
        ) {
            Ok(_) => serde_json::json!({ "ok": true }),
            Err(e) => serde_json::json!({ "ok": false, "error": format!("写入失败: {}", e) }),
        },
        Err(e) => serde_json::json!({ "ok": false, "error": e }),
    }
}


/// 列出某一类下出现过的标签及条数（供筛选界面用）。
/// 注意：SQL 里用 `length(tags) > 0` 而不是 `tags <> ''` —— 避免在 Rust 字符串里出现单引号。
#[tauri::command]
fn lib_tags(kind: String) -> serde_json::Value {
    let conn = match lib_open() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let mut stmt = match conn.prepare(
        "SELECT tags FROM library_item WHERE type = ?1 AND length(tags) > 0",
    ) {
        Ok(s) => s,
        Err(e) => return serde_json::json!({ "ok": false, "error": format!("查询失败: {}", e) }),
    };
    let rows = stmt.query_map([&kind], |r| r.get::<_, String>(0));
    let mut map: std::collections::BTreeMap<String, i64> = std::collections::BTreeMap::new();
    if let Ok(it) = rows {
        for t in it.flatten() {
            for part in t.split(',') {
                let k = part.trim();
                if !k.is_empty() {
                    *map.entry(k.to_string()).or_insert(0) += 1;
                }
            }
        }
    }
    let out: Vec<serde_json::Value> = map
        .iter()
        .map(|(k, v)| serde_json::json!({ "name": k, "count": v }))
        .collect();
    serde_json::json!({ "ok": true, "tags": out })
}

/// 批量写入条目（用户批量导入用）。与 lib_seed 的区别：
///  - 不动 builtin（固定 0，导入的都是用户自己的题）；
///  - 按 type + body 去重，重复导入同一份文档不会灌出两份；
///  - 走事务，中途失败不会留下半份数据。
/// 返回 { ok, added, skipped }。
#[tauri::command]
fn lib_save_many(items: Vec<serde_json::Value>) -> serde_json::Value {
    let mut conn = match lib_open() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let tx = match conn.transaction() {
        Ok(t) => t,
        Err(e) => return serde_json::json!({ "ok": false, "error": format!("事务失败: {}", e) }),
    };
    // 【v4】别名表只读一次（整批共用，避免每条都读盘）
    let sn_map = source_normalize::load_map();
    let now = now_stamp();
    let mut added: i64 = 0;
    let mut skipped: i64 = 0;
    for item in items.iter() {
        let gs = |k: &str| {
            item.get(k)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        };
        let kind = gs("type");
        let title = gs("title");
        if kind.is_empty() || title.is_empty() {
            skipped += 1;
            continue;
        }
        let body = gs("body");
        let dup: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM library_item WHERE type=?1 AND body=?2",
                rusqlite::params![kind, body],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if dup > 0 && !body.is_empty() {
            skipped += 1;
            continue;
        }
        let meta = {
            let m = gs("meta");
            if m.is_empty() { "{}".to_string() } else { m }
        };
        // 【v4】批量导入同样走唯一入口（来源归一 + status/code 缺省）
        let meta = if kind == "question" {
            lib_prepare_qmeta(&tx, &meta, &sn_map)
        } else {
            meta
        };
        let r = tx.execute(
            concat!(
                "INSERT INTO library_item ",
                "(type,title,body,meta,tags,source,builtin,created_at,updated_at,used_count) ",
                "VALUES (?1,?2,?3,?4,?5,?6,0,?7,?8,0)"
            ),
            rusqlite::params![kind, title, body, meta, gs("tags"), gs("source"), now, now],
        );
        if r.is_ok() {
            // 【题库 v3】批量导入的题同样要填真列 + 知识点 ✓（否则「导入进来的筛不到」✗）
            let new_id = tx.last_insert_rowid();
            if let Err(e) = lib_sync_qcols(&tx, new_id, &kind, &meta) {
                return serde_json::json!({ "ok": false, "error": e });
            }
            added += 1;
        } else {
            skipped += 1;
        }
    }
    if let Err(e) = tx.commit() {
        return serde_json::json!({ "ok": false, "error": format!("提交失败: {}", e) });
    }
    serde_json::json!({ "ok": true, "added": added, "skipped": skipped })
}
// ////////////////////////////////////////////////////////////////////////////
// 「试题库 → 导入 PDF（MinerU）」：HTTP 必须在 Rust 侧发。
//
// 网页端直接 fetch mineru.net 会被 CORS 挡（webview 里 Failed to fetch，
// 而 PowerShell/Node 里 200），所以申请上传 → PUT → 轮询 → 下载 zip 全在这里做。
//
// 命令声明成 #[tauri::command(async)]：对**同步**函数来说它会让 Tauri 把整个函数
// 丢到线程池执行（内部 kind = "sync_threadpool"），所以 blocking reqwest 不会卡 UI 线程；
// 进度用 app.emit("mineru://progress", …) 发给前端。
//
//   mode = "precise"（需 token）：/api/v4 精准解析，出 md + content_list.json；
//   mode = "agent"  （免 token）：/api/v1/agent 轻量接口，只出 md（≤10MB / ≤20 页）。
// ////////////////////////////////////////////////////////////////////////////

const MINERU_V4: &str = "https://mineru.net/api/v4";
const MINERU_AGENT: &str = "https://mineru.net/api/v1/agent";
const MINERU_MAX_WAIT_SECS: u64 = 600; // 最多等 10 分钟

/// 毫秒时间戳 —— 秒级在连续两次导入时会撞名，加毫秒。
fn now_ms_stamp() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{}", ms)
}

/// MinerU 产物目录：%APPDATA%\lj-mathslides\mineru\<毫秒时间戳>\
fn mineru_out_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("USERPROFILE")
                .map(|h| PathBuf::from(h).join("AppData").join("Roaming"))
        })
        .unwrap_or_else(program_dir);
    let dir = base.join("lj-mathslides").join("mineru").join(now_ms_stamp());
    let _ = fs::create_dir_all(&dir);
    dir
}

/// 截断长文本，错误信息里别把整个响应糊上去。
fn mineru_short(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// 从 MinerU 响应里抽可读错误：业务层 {code,msg} 与网关层 {success:false,msgCode,msg} 都认。
fn mineru_error_of(v: &serde_json::Value, fallback: &str) -> String {
    if let Some(m) = v.get("msg").and_then(|x| x.as_str()) {
        if !m.is_empty() {
            return m.to_string();
        }
    }
    if let Some(m) = v
        .get("error")
        .and_then(|e| e.get("message"))
        .and_then(|x| x.as_str())
    {
        if !m.is_empty() {
            return m.to_string();
        }
    }
    if let Some(m) = v.get("err_msg").and_then(|x| x.as_str()) {
        if !m.is_empty() {
            return m.to_string();
        }
    }
    fallback.to_string()
}

/// 暂存前端选中的 PDF。
///
/// 为什么需要它：WebView2 的 <input type="file"> 给不到磁盘路径（实测 File.path 是 undefined），
/// 而 mineru_parse 要的是路径。所以前端把字节发过来，这里落到临时目录再交给 mineru_parse。
#[tauri::command]
fn mineru_stage_pdf(data_base64: String, file_name: String) -> Result<String, String> {
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;
    let bytes = B64
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("PDF base64 解码失败: {}", e))?;
    if bytes.is_empty() {
        return Err("PDF 内容为空".to_string());
    }
    let mut name = file_name.trim().replace('\\', "/");
    if let Some(pos) = name.rfind('/') {
        name = name[pos + 1..].to_string();
    }
    if name.is_empty() {
        name = "upload.pdf".to_string();
    }
    let dir = std::env::temp_dir().join("lj-mathslides-mineru");
    fs::create_dir_all(&dir).map_err(|e| format!("临时目录创建失败: {}", e))?;
    let full = dir.join(format!("{}-{}", now_ms_stamp(), name));
    fs::write(&full, &bytes).map_err(|e| format!("暂存 PDF 失败: {}", e))?;
    Ok(full.to_string_lossy().into_owned())
}

/// 从 Markdown 正文里收集**试卷插图**：找出所有 Markdown 图片语法里的相对路径，
/// 把对应文件读成 base64 回传前端（前端转成 data URL 存进题库 meta，不再依赖产物目录还在）。
///
/// 为什么在 Rust 侧做：
///  ① 图片在 MinerU 产物目录（%APPDATA%\lj-mathslides\mineru\...）里，
///     前端的 read_local_image 只能读 exe 同级，够不着；
///  ② 只回传**正文真的引用到的**图 —— zip 里常有没被引用的表格图/答题卡图，不回传省 IPC。
/// 单张超 4MB / 一批超 16MB 的图直接跳过（防止一张大图把 IPC 与 SQLite 撑死）。
/// 把 content_list.json 里所有 **text 块**的文字拼起来 —— 给前端"救回被 full.md 吃掉的选项"用
/// （实测：MD 里 Q6 的 "A. 1" 丢了，content_list 里还留着 `。1` ✓）。读不到就返回空串，前端退回补占位 ✓
/// 【AI 结构化/校正】把一段试卷正文交给大模型，拿回结构化 JSON（v1429）。
/// 为什么放 Rust 侧：网页端直连 api.deepseek.com 会被 CORS 挡 ✗（和 MinerU 同理）。
/// base_url / model 都可传，方便以后换服务商；api_key 只从设置里来，**绝不写进源码** ✓
#[tauri::command]
fn ai_chat(base_url: String, api_key: String, model: String, system: String, user_text: String) -> serde_json::Value {
    let url = if base_url.trim().is_empty() {
        "https://api.deepseek.com/chat/completions".to_string()
    } else {
        let b = base_url.trim().trim_end_matches('/');
        if b.ends_with("/chat/completions") { b.to_string() } else { format!("{}/chat/completions", b) }
    };
    let model = if model.trim().is_empty() { "deepseek-chat".to_string() } else { model.trim().to_string() };
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = match reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .timeout(std::time::Duration::from_secs(300))
        .build()
    {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "error": format!("HTTP 客户端创建失败: {}", e) }),
    };
    let body = serde_json::json!({
        "model": model,
        "temperature": 0,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user_text }
        ]
    });
    let resp = match client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key.trim()))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
    {
        Ok(r) => r,
        Err(e) => return serde_json::json!({ "ok": false, "error": format!("请求失败: {}", e) }),
    };
    let status = resp.status();
    let text = resp.text().unwrap_or_default();
    if !status.is_success() {
        return serde_json::json!({ "ok": false, "status": status.as_u16(), "error": mineru_short(&text, 400) });
    }
    let v: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return serde_json::json!({ "ok": false, "error": format!("返回非 JSON: {}", mineru_short(&text, 200)) }),
    };
    let content = v.get("choices").and_then(|c| c.get(0)).and_then(|c| c.get("message"))
        .and_then(|m| m.get("content")).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let usage = v.get("usage").cloned().unwrap_or(serde_json::Value::Null);
    serde_json::json!({ "ok": true, "content": content, "usage": usage })
}

/// 把 content_list.json 组装成"**按块、一行一块**"的正文文本 —— 这是我们的解析主入口（v1428 起）：
/// - `header / footer / page_number` **直接跳过** ✓（页眉页脚混进题干是老毛病 ✗）
/// - `text / equation` → 原样一行 ✓（**块边界就是行边界**，选项不会被 MD 那种合并吃掉 ✓）
/// - `table` → 交给前端的 stripHtml 变可读文本（这里原样给 HTML/表格体 ✓）
/// - `image` → 合成 `![](img_path)` 一行 ✓，于是前端的 [图N] 注册照旧能用 ✓
/// 读不到就返回空串，前端退回用 full.md ✓
fn mineru_content_text(json_path: &std::path::Path) -> String {
    use std::io::Read;
    if json_path.as_os_str().is_empty() {
        return String::new();
    }
    let mut s = String::new();
    match std::fs::File::open(json_path) {
        Ok(mut f) => { if f.read_to_string(&mut s).is_err() { return String::new(); } }
        Err(_) => return String::new(),
    }
    let v: serde_json::Value = match serde_json::from_str(&s) { Ok(v) => v, Err(_) => return String::new() };
    let mut out = String::new();
    if let Some(arr) = v.as_array() {
        for b in arr {
            let ty = b.get("type").and_then(|x| x.as_str()).unwrap_or("");
            if ty == "header" || ty == "footer" || ty == "page_number" { continue; }
            // 到「参考答案」就整段停 —— 答案区的块不是题目 ✓（MD 那条路靠文本截断，这里靠块）
            if let Some(t0) = b.get("text").and_then(|x| x.as_str()) {
                if t0.replace([' ', '\t'], "").contains("参考答案") && t0.len() <= 24 { break; }
            }
            if ty == "image" {
                if let Some(p) = b.get("img_path").and_then(|x| x.as_str()) {
                    if !p.is_empty() { out.push_str("![]("); out.push_str(p); out.push_str(")\n"); }
                }
                continue;
            }
            // table 有时在 text 里（HTML），有时在 table_body 里
            let mut t = b.get("text").and_then(|x| x.as_str()).unwrap_or("").to_string();
            if t.is_empty() {
                if let Some(tb) = b.get("table_body").and_then(|x| x.as_str()) { t = tb.to_string(); }
            }
            if !t.is_empty() { out.push_str(&t); out.push('\n'); }
        }
    }
    out
}

fn mineru_collect_images(dir: &std::path::Path, md: &str) -> Vec<serde_json::Value> {
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;

    const MAX_IMG_BYTES: usize = 4 * 1024 * 1024;
    const MAX_TOTAL_BYTES: usize = 16 * 1024 * 1024;

    let mut out: Vec<serde_json::Value> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut total = 0usize;
    let mut i = 0usize;
    while i < md.len() {
        let rel = match md[i..].find("](") {
            Some(p) => p,
            None => break,
        };
        let start = i + rel + 2;
        let end = match md[start..].find(')') {
            Some(e) => e,
            None => break,
        };
        let raw = md[start..start + end].trim();
        i = start + end + 1;
        // 取括号里的第一个 token，去掉尖括号写法 <>
        let path = raw
            .split_whitespace()
            .next()
            .unwrap_or("")
            .trim_matches(|c| c == '<' || c == '>')
            .trim();
        if path.is_empty() {
            continue;
        }
        let low = path.to_ascii_lowercase();
        if low.starts_with("http://")
            || low.starts_with("https://")
            || low.starts_with("data:")
            || low.starts_with("asset:")
        {
            continue;
        }
        // 归一化：去掉 ./ 前缀、统一斜杠；挡掉绝对路径与 .. 穿越
        let clean = path.trim_start_matches("./").replace('\\', "/");
        if clean.starts_with('/') || clean.split('/').any(|s| s == ".." || s.is_empty()) {
            continue;
        }
        if !seen.insert(clean.clone()) {
            continue;
        }
        // Windows 的 Path 同时认 / 与 \，直接 join 即可
        let full = dir.join(clean.as_str());
        let bytes = match fs::read(&full) {
            Ok(b) => b,
            Err(_) => continue,
        };
        if bytes.len() > MAX_IMG_BYTES || total + bytes.len() > MAX_TOTAL_BYTES {
            continue;
        }
        total += bytes.len();
        out.push(serde_json::json!({
            "path": clean,
            "mime": guess_image_mime(&full),
            "bytes": bytes.len(),
            "dataBase64": B64.encode(&bytes),
        }));
    }
    out
}
/// MinerU 远程解析：上传 PDF → 轮询 → 下载产物 → 解压出 full.md / content_list.json。
/// 返回 { mdPath, jsonPath, mdText, pages, seconds, mode, outDir }。
// ⚠ 不要写 #[tauri::command(async)]：那会让它在 **async runtime 线程**上跑，而里面用的是
//   reqwest::blocking —— 从 runtime 线程里阻塞会"卡住不返回也不报错"（实测 100 秒无进度无错误）。
//   普通 #[tauri::command] 会被 Tauri 放到**阻塞线程池**上执行，blocking 客户端才安全。
#[tauri::command]
fn mineru_parse(
    app: tauri::AppHandle,
    pdf_path: String,
    token: String,
    mode: String,
) -> Result<serde_json::Value, String> {
    use std::io::Read;

    let t0 = std::time::Instant::now();
    let path = PathBuf::from(pdf_path.trim());
    if !path.is_file() {
        return Err(format!("找不到 PDF 文件：{}", path.to_string_lossy()));
    }
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("paper.pdf")
        .to_string();
    let bytes = fs::read(&path).map_err(|e| format!("读取 PDF 失败: {}", e))?;
    let token = token.trim().to_string();
    let effective = if mode == "agent" { "agent" } else { "precise" };
    if effective == "precise" && token.is_empty() {
        return Err(
            "精准解析需要 MinerU token —— 请在题库顶部「MinerU token」里填入（mineru.net 可免费申请），或改用免 token 的轻量接口（≤10MB / ≤20 页，只出 Markdown）。"
                .to_string(),
        );
    }

    // ⚠ reqwest 用的是 rustls：**必须先安装进程级 CryptoProvider**，否则第一次 .send() 会 panic
    //   "no process-level CryptoProvider available" —— 而命令里 panic 不会回给前端，
    //   表现就是"命令永远不返回、无进度、无报错"（实测 100 秒如此）。这行是幂等的。
    let _ = rustls::crypto::ring::default_provider().install_default();

    let client = reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|e| format!("HTTP 客户端创建失败: {}", e))?;

    let emit = |state: &str, ep: Option<u64>, tp: Option<u64>| {
        let _ = app.emit(
            "mineru://progress",
            serde_json::json!({
                "state": state,
                "extractedPages": ep,
                "totalPages": tp,
                "seconds": t0.elapsed().as_secs(),
            }),
        );
    };

    emit("uploading", None, None);

    // ---------- ① 申请上传地址（两种接口都要） ----------
    let (task_ref, upload_url, endpoint): (String, String, &str) = if effective == "agent" {
        let body = serde_json::json!({
            "file_name": file_name,
            "language": "ch",
            "enable_formula": true,
            "enable_table": true,
        });
        let resp = client
            .post(format!("{}/parse/file", MINERU_AGENT))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .map_err(|e| format!("MinerU 轻量接口建任务失败: {}", e))?;
        let status = resp.status();
        let text = resp.text().map_err(|e| e.to_string())?;
        let v: serde_json::Value = serde_json::from_str(&text)
            .map_err(|_| format!("MinerU 返回非 JSON（HTTP {}）：{}", status, mineru_short(&text, 200)))?;
        let empty = serde_json::Value::Null;
        let data = v.get("data").unwrap_or(&empty);
        let tid = data.get("task_id").and_then(|x| x.as_str()).unwrap_or("");
        let url = data.get("file_url").and_then(|x| x.as_str()).unwrap_or("");
        if tid.is_empty() || url.is_empty() {
            return Err(format!(
                "MinerU 轻量接口没有返回上传地址（HTTP {}）：{}",
                status,
                mineru_error_of(&v, &mineru_short(&text, 200))
            ));
        }
        (tid.to_string(), url.to_string(), MINERU_AGENT)
    } else {
        let body = serde_json::json!({
            "files": [{ "name": file_name, "data_id": "q1", "is_ocr": true }],
            "model_version": "vlm",
            "enable_formula": true,
            "enable_table": true,
        });
        let resp = client
            .post(format!("{}/file-urls/batch", MINERU_V4))
            .header("Authorization", format!("Bearer {}", token))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .map_err(|e| format!("MinerU 建任务失败: {}", e))?;
        let status = resp.status();
        let text = resp.text().map_err(|e| e.to_string())?;
        let v: serde_json::Value = serde_json::from_str(&text)
            .map_err(|_| format!("MinerU 返回非 JSON（HTTP {}）：{}", status, mineru_short(&text, 200)))?;
        let empty = serde_json::Value::Null;
        let data = v.get("data").unwrap_or(&empty);
        let bid = data.get("batch_id").and_then(|x| x.as_str()).unwrap_or("");
        let url = data
            .get("file_urls")
            .and_then(|x| x.as_array())
            .and_then(|a| a.first())
            .and_then(|x| x.as_str())
            .unwrap_or("");
        if bid.is_empty() || url.is_empty() {
            return Err(format!(
                "MinerU 没有返回上传地址（HTTP {}）：{}",
                status,
                mineru_error_of(&v, &mineru_short(&text, 200))
            ));
        }
        (bid.to_string(), url.to_string(), MINERU_V4)
    };

    // ---------- ② PUT 上传 PDF 原始字节（不额外带头） ----------
    let up = client
        .put(&upload_url)
        .body(bytes)
        .send()
        .map_err(|e| format!("上传 PDF 到 MinerU 失败: {}", e))?;
    if !up.status().is_success() {
        return Err(format!("上传 PDF 到 MinerU 失败：HTTP {}", up.status()));
    }

    // ---------- ③ 轮询（每 ~4 秒，最多 10 分钟） ----------
    let mut total_pages: Option<u64> = None;
    let mut zip_url: Option<String> = None;
    let mut md_url: Option<String> = None;
    loop {
        if t0.elapsed().as_secs() > MINERU_MAX_WAIT_SECS {
            return Err(format!(
                "MinerU 解析超时（已等 {} 秒）—— 可稍后在 mineru.net 上查看任务状态",
                t0.elapsed().as_secs()
            ));
        }
        std::thread::sleep(std::time::Duration::from_secs(4));

        let (state, ep, tp, zu, mu, err) = if effective == "agent" {
            let resp = client
                .get(format!("{}/parse/{}", endpoint, task_ref))
                .send()
                .map_err(|e| format!("MinerU 轻量接口轮询失败: {}", e))?;
            let v: serde_json::Value = resp
                .json()
                .map_err(|e| format!("MinerU 轻量接口返回非 JSON: {}", e))?;
            let empty = serde_json::Value::Null;
            let d = v.get("data").unwrap_or(&empty);
            (
                d.get("state").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                None,
                None,
                None,
                d.get("markdown_url").and_then(|x| x.as_str()).map(|s| s.to_string()),
                mineru_error_of(&v, ""),
            )
        } else {
            let resp = client
                .get(format!("{}/extract-results/batch/{}", endpoint, task_ref))
                .header("Authorization", format!("Bearer {}", token))
                .send()
                .map_err(|e| format!("MinerU 轮询失败: {}", e))?;
            let v: serde_json::Value = resp
                .json()
                .map_err(|e| format!("MinerU 轮询返回非 JSON: {}", e))?;
            let empty = serde_json::Value::Null;
            let it = v
                .get("data")
                .and_then(|d| d.get("extract_result"))
                .and_then(|a| a.as_array())
                .and_then(|a| a.first())
                .unwrap_or(&empty);
            let prog = it.get("extract_progress").unwrap_or(&empty);
            (
                it.get("state").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                prog.get("extracted_pages").and_then(|x| x.as_u64()),
                prog.get("total_pages").and_then(|x| x.as_u64()),
                it.get("full_zip_url").and_then(|x| x.as_str()).map(|s| s.to_string()),
                None,
                it.get("err_msg").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            )
        };

        if tp.is_some() {
            total_pages = tp;
        }
        emit(&state, ep, tp);
        if state == "failed" {
            return Err(format!(
                "MinerU 解析失败：{}",
                if err.is_empty() { "（未给出原因）".to_string() } else { err }
            ));
        }
        if let Some(z) = zu {
            zip_url = Some(z);
            break;
        }
        if let Some(m) = mu {
            md_url = Some(m);
            break;
        }
    }

    // ---------- ④ 下载产物并落到 %APPDATA%\lj-mathslides\mineru\<时间戳>\ ----------
    let dir = mineru_out_dir();
    let out_dir = dir.to_string_lossy().into_owned();
    let (md_path, json_path, md_text) = if effective == "agent" {
        let url = md_url.ok_or_else(|| "MinerU 未返回 Markdown 地址".to_string())?;
        let resp = client
            .get(&url)
            .send()
            .map_err(|e| format!("下载 Markdown 失败: {}", e))?;
        let text = resp.text().map_err(|e| format!("读取 Markdown 失败: {}", e))?;
        let p = dir.join("full.md");
        fs::write(&p, text.as_bytes()).map_err(|e| format!("写入 full.md 失败: {}", e))?;
        (p, PathBuf::new(), text)
    } else {
        let url = zip_url.ok_or_else(|| "MinerU 未返回 zip 地址".to_string())?;
        let resp = client.get(&url).send().map_err(|e| format!("下载 zip 失败: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("下载 zip 失败：HTTP {}", resp.status()));
        }
        let zb = resp.bytes().map_err(|e| format!("读取 zip 失败: {}", e))?;
        let mut ar = zip::ZipArchive::new(std::io::Cursor::new(zb))
            .map_err(|e| format!("解析 zip 失败: {}", e))?;
        let mut found_md: Option<PathBuf> = None;
        let mut found_json: Option<PathBuf> = None;
        for i in 0..ar.len() {
            let mut f = ar
                .by_index(i)
                .map_err(|e| format!("读取 zip 条目失败: {}", e))?;
            // enclosed_name 会挡掉 ../ 与绝对路径，返回 None 的条目直接跳过
            let safe = match f.enclosed_name() {
                Some(p) => p.to_path_buf(),
                None => continue,
            };
            let dest = dir.join(&safe);
            if f.is_dir() {
                let _ = fs::create_dir_all(&dest);
                continue;
            }
            if let Some(parent) = dest.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let mut buf = Vec::new();
            f.read_to_end(&mut buf)
                .map_err(|e| format!("解压 {:?} 失败: {}", safe, e))?;
            fs::write(&dest, &buf).map_err(|e| format!("写入 {:?} 失败: {}", safe, e))?;
            let base = safe
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            if base == "full.md" && found_md.is_none() {
                found_md = Some(dest.clone());
            }
            if base.ends_with("_content_list.json")
                && !base.ends_with("_v2.json")
                && found_json.is_none()
            {
                found_json = Some(dest.clone());
            }
        }
        let md = found_md.ok_or_else(|| format!("zip 里没有 full.md（已解压到 {}）", out_dir))?;
        let text = fs::read_to_string(&md).map_err(|e| format!("读取 full.md 失败: {}", e))?;
        (md, found_json.unwrap_or_default(), text)
    };

    // 正文引用到的插图：读成 base64 一起回传（必须在 md_text 被 json! 移走之前）
    let images = mineru_collect_images(&dir, &md_text);
    // content_list 的文字块（救回被 MD 吃掉的选项用）—— 要在 json! 之前算好
    let content_text = mineru_content_text(&json_path);
    let seconds = t0.elapsed().as_secs();
    emit("done", total_pages, total_pages);
    Ok(serde_json::json!({
        "ok": true,
        // 产物落盘位置，前端提示与「后续做插图」都用得上
        "mdPath": md_path.to_string_lossy(),
        "jsonPath": json_path.to_string_lossy(),
        // contentJson：content_list.json 的**原文** —— 前端用它做 bbox 列检测（双栏重排 ✓）
        "contentJson": std::fs::read_to_string(&json_path).unwrap_or_default(),
        // mdText：前端直接灌进批量导入面板
        "mdText": md_text,
        "contentText": content_text,
        "pages": total_pages.unwrap_or(0),
        "seconds": seconds,
        "mode": effective,
        "outDir": out_dir,
        // 正文里引用到的插图（base64）：前端把 md 里的图片语法换成 [图N]，图随题入库
        "images": images,
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
            capture_window,
            lib_info,
        lib_schema_info,
        lib_health,
        lib_q_facets,
        lib_q_search,
        lib_q_patch,
        lib_q_batch,
        lib_import_begin,
        lib_import_add_drafts,
        lib_import_drafts,
        lib_import_draft_patch,
        lib_import_commit,
        lib_import_discard,
        lib_import_batches,
        lib_import_rebuild,
        lib_q_revisions,
        lib_kp_catalog,
        lib_source_report,
        ai_chat,
        asset_get,
            lib_query,
            lib_save,
            lib_remove,
            lib_bump,
            lib_seed,
            lib_meta_get,
            lib_meta_set,
            lib_tags,
            lib_save_many,
            mineru_parse,
            mineru_stage_pdf
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

    /// MinerU 插图收集：拿**真的识别产物**（参考/试卷/mineru-poc/out/exam_fig）跑一遍。
    /// 断言：① 只回传正文引用到的图（目录里有 2 张，正文只引用了 1 张）；
    ///       ② 回传的 base64 能解回 JPEG；③ 明文里的 data:/http 链接不会被当成本地图去读。
    #[test]
    fn mineru_collect_images_real_exam_fig() {
        use base64::Engine;
        let dir = std::path::Path::new(
            r"D:\vue-app\参考\试卷\mineru-poc\out\exam_fig",
        );
        let md_path = dir.join("full.md");
        if !md_path.is_file() {
            println!("跳过：找不到真产物 {}", md_path.to_string_lossy());
            return;
        }
        let md = std::fs::read_to_string(&md_path).expect("读 full.md");
        println!("full.md {} 字符", md.len());
        assert!(
            md.contains("![") && md.contains("images/"),
            "full.md 里应该有 Markdown 图片语法"
        );

        let imgs = super::mineru_collect_images(dir, &md);
        println!("正文引用到的图 {} 张", imgs.len());
        assert_eq!(imgs.len(), 1, "正文只引用了 1 张图（另一张是没被引用的表格图）");
        let one = &imgs[0];
        let p = one.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let mime = one.get("mime").and_then(|v| v.as_str()).unwrap_or("");
        let bytes = one.get("bytes").and_then(|v| v.as_u64()).unwrap_or(0);
        let b64 = one
            .get("dataBase64")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let raw = base64::engine::general_purpose::STANDARD
            .decode(b64.as_bytes())
            .expect("base64 应该能解");
        println!(
            "  path={} mime={} bytes={} base64={} 字符",
            p,
            mime,
            bytes,
            b64.len()
        );
        assert!(p.starts_with("images/"), "路径要相对产物目录：{}", p);
        assert_eq!(mime, "image/jpeg");
        assert_eq!(raw.len() as u64, bytes, "回传字节数要等于真实文件大小");
        assert_eq!(&raw[..2], &[0xFF, 0xD8], "JPEG 头");
        // 目录里第 2 张图（表格图）没被正文引用 —— 不能顺带回传
        let names: Vec<String> = imgs
            .iter()
            .map(|i| i.get("path").and_then(|v| v.as_str()).unwrap_or("").to_string())
            .collect();
        assert!(!names.iter().any(|n| n.contains("14e0be50")), "未引用的表格图不该回传");

        // 外链 / data URL 不能被当成本地文件
        let fake = "![a](https://example.com/x.jpg)\n![b](data:image/png;base64,AAAA)\n";
        let none = super::mineru_collect_images(dir, fake);
        assert!(none.is_empty(), "外链与 data URL 不落盘，不该回传");
    }
}