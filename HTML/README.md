# StarTasks v2（HTML/Tauri 化重构）

> 一份 React HTML 前端 + Tauri 2 双端壳（Windows + Android）+ SSIO/AI 网关统一云。
> 取代旧 Electron 33（~90MB）+ Capacitor 架构。功能契约 1:1 保留（`window.taskAPI`），
> 逐功能迁移对照表见 `docs/FEATURE-MAP.md`。

## 架构

```
src/
├─ api/            taskAPI 契约三实现：tauri.ts / sqljs.ts / mock（src/mocks）
│                  ├─ api-factory.ts   契约唯一来源（形状冻结，禁止改）
│                  ├─ dispatch.ts      通道分发（db/window/app/ics）
│                  ├─ dbHandlers.ts    db.* 76 方法（SQL，双实现共用）
│                  ├─ cloudHandlers.ts homework/ai/ustb/xls/about/diag/webdav/cleanup
│                  ├─ classHandlers.ts class.* 25 方法（REST，服务端管权限）
│                  ├─ updaterHandlers.ts 热更新（补丁系统已退役，方法名保留）
│                  ├─ backupHandlers.ts  备份/恢复/完整性
│                  └─ legacyImport.ts    旧版 SQLite 一次性导入（跳过 billing 表）
├─ cloud/          CloudGateway：ssioClient（KV/发行/资产）+ aiGateway（SSE+工具调用）
├─ ai/             tools.ts（AI 调用软件模块）+ xlsRecognition.ts（AI 智能识别课表）
├─ xls/            课表 Excel 解析档案（generic/qilu），自 electron/timetable-xls 平移
├─ core/           periods / ics / ustbTypes 纯函数
└─ pages|components|features/  渲染层（自旧 src 平移，UI 契约不变）
src-tauri/         Tauri 2 壳：app_info / 热更新 / 托盘 / Ctrl+Shift+A / 关闭行为
migrations/        001_init.sql（28 表，已去 billing 月卡表）
server/class-module/  SSIO 班级 REST 模块（待合入 SSIO 仓库）+ KV 迁移脚本
```

## 关键决策（v2 相对 v1 的变化）

| 项 | v1（Electron） | v2（Tauri） |
|---|---|---|
| 月卡付费 | 纯本地 HMAC 月卡 | **整体删除**（功能全放开） |
| 班级 | P2P 文件协议（KV manifest+HMAC+ownerToken） | **SSIO 服务端 REST**（服务端管权限） |
| 更新 | 多源 latest.json + asar 补丁 | **内容热更新**（SSIO 清单+产物，sha256+基线回退） |
| 云连接 | SSIO + 历史 GitHub/云盘残留 | CloudGateway 单收口（SSIO + AI 网关） |
| 课表 Excel 导入 | 档案自动猜测 | **AI 智能识别**（失败降级传统猜测） |
| AI 助手 | 自填 baseUrl+Key，仅问答+预演 | 直连 AI 网关 + **工具调用**（可操作软件模块） |
| APK 错位 | 双布局分叉 | 单份响应式 + mobile-native 基线（tap/输入/hover/safe-area） |

## 命令

```bash
npm install
npm run dev          # 浏览器预览（sqljs/mock 自动选择；?impl=mock 强制演示数据）
npm run build        # 类型检查 + 构建 dist/
npm run typecheck
node scripts/test-datalayer.mjs      # 数据层烟雾（迁移+CRUD+老库导入）
node server/class-module/test-routes.mjs  # 班级 REST 10 项
node scripts/test-contract.mjs       # 契约覆盖 + 用户可见面残留检查
npm run tauri:dev    # 桌面壳（需 Rust 工具链）
npm run tauri:build  # 双端打包
node scripts/release-content.mjs X.Y.Z --notes-file notes.md [--execute]  # 发版
```

## 老用户迁移

设置 → 数据管理 → **导入旧版数据**：选 `%APPDATA%\task-manager\task-manager.db`，
逐表复制（28 表），月卡表跳过并报告；建议先导出全量备份。

## 已知边界（后续任务）

- **USTB 贝壳课表 SSO**：协议层已平移（`core/ustbTypes` + `xls/`），HTTP 流程接通待
  Rust 侧 cookie jar 调通（`cloudHandlers` 里 `ustb:*` 返回「迁移中」明确错误，不静默）。
- **WebDAV 坚果云同步**：配置保留，同步操作后移（返回 deferred 提示）。
- **班级服务端部署**：`server/class-module/` 待合入 SSIO 仓库（README 有步骤）+ KV 迁移。
- **Rust sha256 强校验**：hot_update.rs 现为大小校验占位，接入 sha2 crate 后启用清单强校验。
- **壳构建**：本机未装 Rust 工具链（rustup 后 `npm run tauri:build`）。
