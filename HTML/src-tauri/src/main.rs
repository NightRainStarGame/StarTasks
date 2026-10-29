// StarTasks Tauri 2 壳 —— 入口
// 原则：壳只做窗口/托盘/快捷键/原生能力注入；业务全在 WebView 前端。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    startasks_lib::run()
}
