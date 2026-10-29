//! 内容热更新（Rust 侧）—— 真正生效的版本。
//!
//! 目录布局（App 私有数据目录）：
//!   pages/current/   ← WebView 实际加载的前端产物（通过 sthot:// 自定义协议提供）
//!   pages/prev/      ← 上一版基线（回退用）
//!
//! 关键点（v2.0.6 修）：以前只把文件下载到 current，但 WebView 始终加载打包内置的 dist，
//! 「下载了从不使用」= 热更新形同虚设。现在 WebView 走 sthot:// 协议，优先读 current/，
//! 缺失时回落到内置资源，apply 完成后直接 navigate 重载。

use std::fs;
use std::path::PathBuf;
use tauri::{Emitter, Manager};
use tauri_plugin_http::reqwest;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")] // JS 侧传 fileId，Rust 侧字段 file_id
pub struct PageUpdate {
    name: String,
    file_id: String,
    sha256: String,
    size: u64,
}

pub fn pages_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("pages");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    hex::encode(h.finalize())
}

/// WebView 里访问已注册自定义协议的真实 URL。
///
/// ⚠ Windows / Android 上 Tauri 把 `sthot://` 映射为 `http://sthot.localhost/`；
/// 直接 navigate 到 `sthot://localhost/...` 会被 WebView2 拒绝（错误又被 `let _ =` 吞掉）
/// —— 表现就是「内容已更新，但窗口毫无反应」（2.0.22 实测）。
pub fn sthot_url(path: &str) -> String {
    let p = path.trim_start_matches('/');
    if cfg!(any(windows, target_os = "android")) {
        format!("http://sthot.localhost/{}", p)
    } else {
        format!("sthot://localhost/{}", p)
    }
}

/// 让 WebView 加载热更产物（失败返回原因，不再静默）
pub fn reload_to_hot(app: &tauri::AppHandle, suffix: &str) -> Result<(), String> {
    let w = app.get_webview_window("main").ok_or_else(|| "找不到主窗口".to_string())?;
    let url = sthot_url(&format!("index.html{}", suffix));
    let parsed = tauri::Url::parse(&url).map_err(|e| format!("URL 解析失败 {url}: {e}"))?;
    w.navigate(parsed)
        .map_err(|e| format!("切换到热更内容失败（{url}）: {e}"))
}

/// 自定义协议 sthot:// 的路径解析：current/ 优先，不存在返回 None（由调用方回落内置资源）
pub fn resolve_hot_file(app: &tauri::AppHandle, rel: &str) -> Option<PathBuf> {
    let root = pages_root(app).ok()?;
    let cleaned = rel.trim_start_matches('/');
    let cleaned = if cleaned.is_empty() { "index.html" } else { cleaned };
    // 防目录穿越
    if cleaned.contains("..") {
        return None;
    }
    let p = root.join("current").join(cleaned);
    if p.is_file() { Some(p) } else { None }
}

/// 当前生效的热更版本（无则 None），供前端展示
#[tauri::command]
pub async fn hot_update_version(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let root = pages_root(&app)?;
    let f = root.join("version.txt");
    if !f.exists() {
        return Ok(None);
    }
    Ok(Some(fs::read_to_string(f).map_err(|e| e.to_string())?.trim().to_string()))
}

/// 前端启动后调用：如果磁盘上有热更产物且当前不在其 origin，则切过去。
/// 返回 true 表示已发起切换（页面会重载）。
#[tauri::command]
pub async fn hot_update_reload(app: tauri::AppHandle) -> Result<bool, String> {
    if resolve_hot_file(&app, "index.html").is_none() {
        return Ok(false);
    }
    reload_to_hot(&app, "?boot=1")?;
    Ok(true)
}

#[tauri::command]
pub async fn hot_update_apply(
    app: tauri::AppHandle,
    version: String,
    pages: Vec<PageUpdate>,
    api_key: Option<String>,
) -> Result<serde_json::Value, String> {
    let root = pages_root(&app)?;
    let current = root.join("current");
    let prev = root.join("prev");

    let staging = root.join("staging");
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;

    let base = std::env::var("SSIO_BASE").unwrap_or_else(|_| "http://120.53.9.81:8100".into());
    let key = api_key
        .or_else(|| std::env::var("SSIO_KEY").ok())
        .unwrap_or_default();
    if key.is_empty() {
        return Err("缺少 SSIO 应用 Key，无法下载内容（先在应用内配置 Key）".into());
    }
    let client = reqwest::Client::new();

    let mut downloaded = 0u64;
    for p in &pages {
        let url = format!("{}/v1/storage/files/{}/download", base, p.file_id);
        let resp = client
            .get(&url)
            .header("X-API-Key", &key)
            .send()
            .await
            .map_err(|e| format!("下载 {} 失败: {}", p.name, e))?;
        if !resp.status().is_success() {
            return Err(format!("下载 {} 失败: HTTP {}", p.name, resp.status()));
        }
        let body = resp.bytes().await.map_err(|e| e.to_string())?;

        // ⚠ SSIO 的 /v1/storage/files/{id}/download 不直接返回文件，而是返回
        // {"url":".../v1/storage/raw/..."} 签名直链（约 250 字节）。
        // 以前直接把这段 JSON 当内容 → 大小校验必然失败（实测 250 vs 35208）。
        let bytes = if body.len() < 4096 && body.first() == Some(&b'{') {
            match serde_json::from_slice::<serde_json::Value>(&body) {
                Ok(v) if v.get("url").and_then(|u| u.as_str()).is_some() => {
                    let real = v["url"].as_str().unwrap();
                    let r2 = client
                        .get(real)
                        .send()
                        .await
                        .map_err(|e| format!("下载 {} 的直链失败: {}", p.name, e))?;
                    if !r2.status().is_success() {
                        return Err(format!("下载 {} 直链失败: HTTP {}", p.name, r2.status()));
                    }
                    r2.bytes().await.map_err(|e| e.to_string())?
                }
                _ => body, // 就是文件内容（极少见，但别误判）
            }
        } else {
            body
        };

        if bytes.len() as u64 != p.size {
            return Err(format!("{} 大小不符（期望 {} 实际 {}）", p.name, p.size, bytes.len()));
        }
        // 真 sha256 强校验（发布清单里的就是真 sha256）
        if !p.sha256.is_empty() {
            let digest = sha256_hex(&bytes);
            if digest != p.sha256.to_lowercase() {
                return Err(format!("{} 校验失败（sha256 不匹配）", p.name));
            }
        }
        let dest = staging.join(&p.name);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
        downloaded += bytes.len() as u64;
    }

    // 缺 index.html 直接失败，避免把 WebView 搞成白屏
    if !staging.join("index.html").exists() {
        let _ = fs::remove_dir_all(&staging);
        return Err("新内容缺少 index.html，已中止（未切换）".into());
    }

    // current → prev 轮转
    if prev.exists() {
        fs::remove_dir_all(&prev).map_err(|e| e.to_string())?;
    }
    if current.exists() {
        fs::rename(&current, &prev).map_err(|e| e.to_string())?;
    }
    fs::rename(&staging, &current).map_err(|e| e.to_string())?;
    fs::write(root.join("version.txt"), &version).map_err(|e| e.to_string())?;

    // 真正生效：把 WebView 切到新内容。切换失败不算整体失败（文件已就位，重启即生效），
    // 但必须把 live=false 传回去，界面提示「重启应用生效」而不是骗用户说已生效。
    let live = match reload_to_hot(&app, &format!("?v={}", version)) {
        Ok(()) => true,
        Err(e) => {
            eprintln!("[hot_update] navigate 失败: {e}");
            false
        }
    };
    let _ = app.emit("hot-update:applied", serde_json::json!({ "version": version, "live": live }));

    Ok(serde_json::json!({ "ok": true, "version": version, "downloadedBytes": downloaded, "live": live }))
}

#[tauri::command]
pub async fn hot_update_rollback(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let root = pages_root(&app)?;
    let current = root.join("current");
    let prev = root.join("prev");
    if !prev.exists() {
        return Err("没有可回退的基线".into());
    }
    let broken = root.join("broken");
    if current.exists() {
        if broken.exists() {
            fs::remove_dir_all(&broken).map_err(|e| e.to_string())?;
        }
        fs::rename(&current, &broken).map_err(|e| e.to_string())?;
    }
    fs::rename(&prev, &current).map_err(|e| e.to_string())?;
    let _ = reload_to_hot(&app, &format!("?r={}", chrono_like()));
    let _ = app.emit("hot-update:rolled-back", ());
    Ok(serde_json::json!({ "ok": true }))
}

fn chrono_like() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}
