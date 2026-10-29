# StarTasks

北科大（USTB）学生向的课业管理桌面/移动应用：课表、作业、成绩、日程、班级协作、AI 助手，一个窗口搞定。

- **桌面端**：Windows（Tauri 2 + WebView2）
- **移动端**：Android（Tauri 2 + 系统 WebView）
- **数据**：本地 SQLite 全量存储，可导出/恢复；云备份为可选项
- **更新**：内置内容热更新（只换前端资源，不重装）

## 目录结构

```
TaskManager/
└─ HTML/                 ← 应用本体（React + Tauri 2）
   ├─ src/               taskAPI 三实现（tauri / sql.js / mock）与全部界面
   ├─ src-tauri/         Rust 壳：窗口、SQLite、HTTP、热更新协议 sthot://
   ├─ migrations/        SQLite 迁移（启动时逐条容错执行）
   ├─ server/class-module 班级服务的参考实现（Express 路由 + 表结构）
   ├─ scripts/           发版脚本（内容热更 / 安装包）
   └─ docs/              架构与功能对照表
```

> 早期 Electron + Capacitor 版本（`electron/`、`android/`）已下线，源码仍可在提交历史中查阅。

## 本地开发

```bash
cd HTML
npm install
npm run dev          # 浏览器预览（内置 mock/sql.js 数据层）
npm run tauri dev    # 桌面壳调试（真 SQLite + 原生能力）
```

## 打包

```bash
cd HTML
npm run tauri build                                    # Windows 安装包
npm run tauri android build --apk --debug --target aarch64   # Android APK
```

## 发版

两条独立通道，版本号各自推进：

| 通道 | 命令 | 作用 |
|---|---|---|
| 内容热更 | `node scripts/release-content.mjs <版本> --notes-file notes.md --execute` | 上传前端产物清单，客户端应用内更新 |
| 安装包 | `node scripts/release-binaries.mjs --notes-file notes.md` | Windows / Android 安装包分发 |

热更新只替换前端资源；涉及 Rust、权限（capabilities）、原生插件的改动必须重新发安装包。

## 文档

- `HTML/README.md` —— 开发者说明（模块划分、taskAPI 契约、已知坑）
- `HTML/CODE-MAP.md` —— 代码地图
- `HTML/docs/FEATURE-MAP.md` —— 旧版功能 → 新版实现对照

## 许可

见 `LICENSE`（若仓库中未包含，请以发布页说明为准）。
