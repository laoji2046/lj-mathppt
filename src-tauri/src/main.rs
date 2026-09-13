#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2（值为 -4 的伪句柄）
#[cfg(windows)]
const DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2: isize = -4;

#[cfg(windows)]
extern "system" {
    fn SetProcessDpiAwarenessContext(value: isize) -> i32;
}

fn main() {
    // **必须在任何窗口/截图之前声明"每显示器 DPI 感知 v2"**。
    //
    // 不声明的话 Windows 会对本进程做坐标虚拟化：多显示器 + 混合缩放时，
    // 枚举出来的显示器数量、位置、尺寸都可能是错的 ——
    // 用户实测"只捕获到 1 个显示器、而且抓到的是第二屏"正是这个现象。
    //
    // 用裸 FFI 调，省得为一个常量再拉 windows-sys 依赖；
    // 若清单里已声明过，这里会返回 0（失败），忽略即可。
    #[cfg(windows)]
    unsafe {
        SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
    lj_mathslides_lib::run()
}
