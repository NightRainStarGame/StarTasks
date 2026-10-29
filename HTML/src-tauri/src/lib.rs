//! StarTasks 壳层：插件注册 + 全局快捷键（Ctrl+Shift+A 呼出快速添加）+ app_info 命令 + 热更新。
use tauri::{Emitter, Manager};

mod hot_update;

#[tauri::command]
fn app_info(app: tauri::AppHandle) -> serde_json::Value {
    serde_json::json!({
        "name": "StarTasks",
        "version": app.package_info().version.to_string(),
        "platform": std::env::consts::OS,
        "packaged": !cfg!(debug_assertions),
    })
}

/// 极简 MIME 映射（自定义协议服务前端产物用）
fn mime_of(path: &str) -> &'static str {
    let p = path.to_ascii_lowercase();
    if p.ends_with(".html") { "text/html; charset=utf-8" }
    else if p.ends_with(".js") || p.ends_with(".mjs") { "text/javascript; charset=utf-8" }
    else if p.ends_with(".css") { "text/css; charset=utf-8" }
    else if p.ends_with(".json") { "application/json; charset=utf-8" }
    else if p.ends_with(".svg") { "image/svg+xml" }
    else if p.ends_with(".png") { "image/png" }
    else if p.ends_with(".jpg") || p.ends_with(".jpeg") { "image/jpeg" }
    else if p.ends_with(".webp") { "image/webp" }
    else if p.ends_with(".ico") { "image/x-icon" }
    else if p.ends_with(".woff2") { "font/woff2" }
    else if p.ends_with(".woff") { "font/woff" }
    else if p.ends_with(".wasm") { "application/wasm" }
    else { "application/octet-stream" }
}

/// ⚠ 移动端必须带 `mobile_entry_point`：它生成 JNI 入口（Java 侧 TauriActivity 通过它
/// 调用 Rust）。缺了这个属性，APK 能装上但**点开即闪退**（2.1.0 实测），桌面端不受影响。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // ⚠ 迁移**不能**放插件的 add_migrations：它在应用启动时执行，任何一条语句失败
    // （旧库 duplicate column / 索引缺列）都会让插件初始化失败 → 窗口根本打不开
    // （2.0.6 实测）。迁移改由前端惰性执行（src/api/migrations.ts，逐条容错 + 列回填）。
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init());

    // global_shortcut 整个 crate 在 Android/iOS 被 cfg 编空 —— 只在桌面注册
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());
    }

    // sthot:// 自定义协议：优先服务 pages/current 的热更产物，缺失回落到内置 dist。
    // 这是热更新「真正生效」的关键 —— 否则下载了新内容 WebView 依然读打包内置的那份。
    builder = builder.register_uri_scheme_protocol("sthot", |ctx, request| {
        let app = ctx.app_handle();
        let raw_path = request.uri().path().trim_start_matches('/').to_string();
        let path = if raw_path.is_empty() { "index.html".to_string() } else { raw_path };

        // 1) 热更目录
        if let Some(p) = hot_update::resolve_hot_file(app, &path) {
            if let Ok(bytes) = std::fs::read(&p) {
                return tauri::http::Response::builder()
                    .header("Content-Type", mime_of(&path))
                    .header("Cache-Control", "no-store")
                    .body(bytes)
                    .unwrap();
            }
        }
        // 2) 内置资源
        if let Some(asset) = app.asset_resolver().get(path.clone()) {
            return tauri::http::Response::builder()
                .header("Content-Type", asset.mime_type.to_string())
                .body(asset.bytes.to_vec())
                .unwrap();
        }
        // 3) SPA 回落 index.html
        if let Some(asset) = app.asset_resolver().get("index.html".to_string()) {
            return tauri::http::Response::builder()
                .header("Content-Type", "text/html; charset=utf-8")
                .body(asset.bytes.to_vec())
                .unwrap();
        }
        tauri::http::Response::builder().status(404).body(Vec::new()).unwrap()
    });

    // ⚠ 不要在 Rust 侧做「启动时切热更」：
    //   setup() 里跳 → 被首屏加载覆盖（重启回退版本）；
    //   on_page_load 里跳 → 打断正在进行的首屏加载 → **黑屏**（2.1.0 实测）。
    // 改由前端在应用跑起来之后调 hot_update_reload（见 src/main.tsx），时序最安全。

    builder
        .invoke_handler(tauri::generate_handler![
            app_info,
            hot_update::hot_update_apply,
            hot_update::hot_update_rollback,
            hot_update::hot_update_version,
            hot_update::hot_update_reload
        ])
        .setup(|app| {
            // 全局快捷键：Ctrl+Shift+A → 通知前端打开快速添加
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
                let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyA);
                let handle = app.handle().clone();
                app.global_shortcut().on_shortcut(shortcut, move |_app, _sc, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = handle.emit("app:quickadd", ());
                    }
                })?;

                // 托盘：显示主窗 / 快速添加 / 退出（对应旧 electron/tray.ts 的最小集）
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::TrayIconBuilder;
                let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
                let quick = MenuItem::with_id(app, "quickadd", "快速添加", true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show, &quick, &quit])?;
                let handle = app.handle().clone();
                TrayIconBuilder::with_id("main-tray")
                    .icon(app.default_window_icon().cloned().expect("缺托盘图标"))
                    .tooltip("StarTasks")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(move |app, event| match event.id().as_ref() {
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "quickadd" => {
                            let _ = handle.emit("app:quickadd", ());
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        // 双击托盘唤起主窗
                        if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                            let app = tray.app_handle();
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    })
                    .build(app)?;
            }

            // 注意：**不在这里 navigate**。setup 阶段窗口的首次页面加载还没完成，
            // 这里跳转会被随后的内置资源加载覆盖 —— 表现就是「重启后又回到旧版本」。
            // 真正的切换放在 on_page_load（见下方 builder 配置）里做。
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Tauri 应用启动失败");
}
