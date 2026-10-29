# StarTasks v2 — 接手者手册（CODE-MAP）

> 路径：`E:\University\TaskManager\HTML`
> 定位：**课程 / 项目 / 日历一体化的可视化工作流应用**。
> v2 是从旧 Electron 33 + Capacitor 架构**迁移到 Tauri 2 双端壳**（Windows + Android）的重构版，
> 功能契约 `window.taskAPI` 1:1 保留，逐功能迁移对照表见 `docs/FEATURE-MAP.md`（26KB，5 节）。
> 本文面向"要接管每一个功能"的人：读完应当能定位任意功能在哪个文件、走哪条链路、改哪里会连带影响什么。

---

## 0. 30 秒速览

**是什么 / 不是什么**

- 是：一份 React 前端 + Tauri 2 壳（桌面/安卓）+ 统一云（SSIO + AI 网关）的单体应用。
- 不是：Electron 旧版（旧工程在 `E:\University\TaskManager` 上层，已废弃），
  也不是带独立 Node 后端的服务——**没有常驻后端**，云能力全走 SSIO/AI 网关/星芒网站。
- v2 相对 v1 的关键变化：月卡付费**整体删除**、班级改**服务端 REST**、更新改**内容热更新**、
  课表导入加 **AI 智能识别**、AI 助手支持**工具调用**。

**五条铁律（违反任何一条都可能静默搞挂）**

1. `src/api/api-factory.ts` 是**契约唯一来源，形状冻结禁止改**。改了会破坏 FEATURE-MAP 冻结的
   ~190 个通道与三实现的一致性；守门脚本是 `npm run test:contract`。
2. `src/App.tsx` **禁止改回 `React.lazy`**。v1.2.10 翻车实录：file:// 下 dynamic import 被 Chromium
   拒掉，除首屏外页面点一个崩一个。
3. 未迁移通道必须**显式报错** `errorCode:'NOT_MIGRATED'`，不允许静默吞功能（`dispatch.ts:66`）。
4. SSIO **KV 命名规范三方共用**（桌面 / 移动 / 发版脚本）：键一律 `taskmgr/<对象>`，
   作业包 `homework/<syncCode>.json`，热更产物 `taskmgr-pages/<版本>/<文件名>`；禁止造平行顶层目录。
5. `tailwind.config.js` 动画关键帧**终态必须 `transform: none`**（`fill-mode: both` 会让非 none 的
   transform 永久保留 → 元素变成后代 `position:fixed` 的 containing block → 所有 fixed 弹层失效）。

---

## 1. 技术栈与命令

| 层 | 选型 |
|---|---|
| 前端 | React 18 + TypeScript 5.6 + Vite 5 + react-router-dom 6（**HashRouter**）+ zustand 5 + Tailwind 3.4 + lucide-react |
| 可视化 | `@xyflow/react` 12（项目画布）、`xlsx`（课表 Excel）、`dayjs`、`lunar-javascript`（农历/节假日） |
| 数据 | SQLite —— Tauri 侧 `tauri-plugin-sql`；浏览器预览侧 `sql.js` WASM 持久化到 localStorage |
| 壳 | Tauri 2 + plugin-sql / http / fs / dialog / notification / global-shortcut / opener（桌面端另有 updater） |
| 云 | SSIO（`src/cloud/ssioClient.ts`）+ AI 网关（`src/cloud/aiGateway.ts`）+ 星芒网站账号（`src/api/siteHandlers.ts`） |

**npm 脚本**

| 命令 | 实际执行 | 说明 |
|---|---|---|
| `npm run dev` | `vite` | 前端 dev（5173，strictPort）。浏览器下自动选 sqljs/mock，`?impl=mock` 强制演示数据 |
| `npm run build` | `tsc -p tsconfig.json && vite build` | 类型检查 + 构建 `dist/` |
| `npm run typecheck` | `tsc --noEmit` | 仅类型检查 |
| `npm run preview` | `vite preview` | 预览产物 |
| `npm run tauri` / `tauri:dev` / `tauri:build` | Tauri CLI / 桌面壳开发 / 双端打包 | **需 Rust 工具链**（本机未装，用 `scripts/rustup-init.exe` 准备） |
| `npm run test:contract` | `node scripts/test-contract.mjs` | 契约回归 + 用户可见面措辞残留检查，缺通道 exit 1 |

**未挂 npm script 的裸脚本（README 记录）**

| 命令 | 作用 |
|---|---|
| `node scripts/test-datalayer.mjs` | 数据层烟雾：sql.js 跑迁移 → 建表校验 → dbHandlers CRUD → 老库导入（验证 billing 表被跳过） |
| `node server/class-module/test-routes.mjs` | 班级 REST 10 项测试 |
| `node scripts/release-content.mjs X.Y.Z --notes-file notes.md [--execute]` | 发版：推 SSIO storage + 写 `taskmgr/pages` 清单 |

**Tauri 配置要点（`src-tauri/tauri.conf.json`）**

- `productName: StarTasks`，`identifier: com.douya.startasks`，`version: 2.0.0`
- `build`：`beforeDevCommand: npm run dev` / `devUrl: http://localhost:5173` /
  `beforeBuildCommand: npm run build` / `frontendDist: ../dist`
- `app.windows`：单窗口 main，1280×800，min 900×600；`security.csp: null`（CSP 由 `index.html` 的 meta 管）
- `bundle.targets: ["nsis","deb","appimage"]`；`bundle.android.enabled: true`
- `plugins.sql.databases.taskmanager: { path: "taskmanager.db", create: true }`

**Cargo.toml**：`[lib] name = "startasks_lib"`，crate-type `["staticlib","cdylib","rlib"]`（Android 必需）；
`cfg(not(android/ios))` 下额外依赖 `tauri-plugin-updater`（壳自身更新，低频）。

---

## 2. 仓库地图（逐文件职责与导出）

### 2.1 `src/` 根

| 文件 | 职责 | 备注 |
|---|---|---|
| `src/main.tsx` | 入口：**先 `installTaskAPI()` 装 `window.taskAPI`，再挂载 React**；3s 兜底 `app.ready()`；`unhandledrejection` 只 warn 不白屏 | 顺序不能反 |
| `src/App.tsx` | 路由表（全部静态 import）+ `useApplyTheme` + `useInputDiag` + `refreshAll` + `app.ready()` + UpdateNotification + ToastContainer | 见铁律 2 |
| `src/vite-env.d.ts` | Vite 客户端类型（`?raw` 导入等） | — |

### 2.2 `src/api/` —— taskAPI 契约与三实现（**核心层，改这里先读 FEATURE-MAP**）

| 文件 | 职责 | 主要导出 |
|---|---|---|
| `api/index.ts` | 运行环境探测 + 三实现选择：**tauri → `?impl=mock` → sqljs → 失败降级 mock** | `installTaskAPI()`, `buildAPI`, `type TaskAPI`, `ApiImplName` |
| `api/api-factory.ts`（44.7KB） | **契约唯一来源，形状冻结**；19 个命名空间：`window / db / ustb / ics / ai / app / updater / homework / diag / backup / xls / about / cleanup / webdav / class / site / system` | `buildAPI(invoke, send, subscribe)`；类型 `UpdateSourceDTO / XlsProfileDTO / XlsParseResultDTO / PatchCacheStateDTO` |
| `api/platform.ts` | 平台差异收敛点：`SqlExecutor{run,all,get}` + `PlatformDeps{sql,http,pickFile,saveFile,readFile,writeFile,notify,openExternal,showInFolder,appInfo,window*,subscribe}` | 纯接口，加新平台能力先动这里 |
| `api/dispatch.ts` | 通道分发：`db.*` + window/app/ics + backup + legacy；未迁移通道返回 `{ok:false,errorCode:'NOT_MIGRATED'}` | `createInvoke`, `createSend`, `getInvoke`, `HandlerMap` |
| `api/tauri.ts` | **Tauri 2 实现**：plugin-sql / plugin-http（无 CORS）/ fs / dialog / notification / opener；关闭行为拦截 | `createTauriApi()`, `emit` |
| `api/sqljs.ts` | **浏览器预览实现**：sql.js WASM + localStorage 持久化（键 `taskmgr_sqljs_db_v1`，btoa base64，300ms 防抖写回） | `createSqljsApi()` |
| `api/dbHandlers.ts`（33.8KB） | `db.*` 约 **76 个 SQL 通道**（courses / requirements / events / categories / userProfiles / courseNotes / projects / tasks / canvases / canvasNodes / canvasEdges / settings / stats / grades …） | `createDbHandlers(sql)`, `computeCourseKey` |
| `api/cloudHandlers.ts`（35KB） | 云命名空间 **47 通道**：homework(9) / ai(9) / ustb(6) / xls(7) / about(6) / diag(2) / webdav(4) / cleanup(6) | `createCloudHandlers(deps)`；依赖 `cloud/homework`、`cloud/ssioClient`、`cloud/aiGateway`、`ai/tools`、`ai/xlsRecognition`、`ustb/client` |
| `api/classHandlers.ts` | `class.*` **25 通道** → SSIO REST `/v1/class`（`X-API-Key` + `X-Device-Token`；404 → `CLASS_API_UNAVAILABLE`） | `createClassHandlers(deps)` |
| `api/siteHandlers.ts` | `site.*` 星芒网站账号（<https://nrsc.games>）：login/me/logout/register/hasToken/entitlements/backupPut\|Get\|Delete；token 存 localStorage `starmain_token` | `createSiteHandlers(deps)`, `SITE_BASE` |
| `api/updaterHandlers.ts` | 热更新 + **已退役的补丁系统占位**（方法名保留，返回"补丁系统已退役"） | `createUpdaterHandlers()` |
| `api/hotUpdate.ts` | 内容热更新：SSIO KV 清单 → Rust `hot_update_apply` → 状态存 localStorage `hot_update_state` | `fetchPagesManifest`, `checkHotUpdate`, `applyHotUpdate`, `rollbackHotUpdate` |
| `api/backupHandlers.ts` | 全量 JSON 备份/恢复/完整性；`BACKUP_TABLES` = **27 张表**（无 billing） | `createBackupHandlers(sql,deps)`, `BACKUP_TABLES` |
| `api/legacyImport.ts` | 旧版 Electron SQLite 一次性导入（sql.js 打开老库逐表复制，跳过 `IGNORED_TABLES`） | `legacyImport()`, `importLegacyDb()`, `IGNORED_TABLES`, `ImportReport` |
| `api/migrations.ts` | 迁移执行器：`001_init.sql` + `002_academic.sql`（`?raw` 导入），按分号切句，**失败只 warn 跳过** | `runMigrations(sql)`, `splitStatements` |

### 2.3 `src/cloud/` · `src/ai/` · `src/xls/` · `src/core/` · `src/ustb/` · `src/config/`

| 文件 | 职责 | 主要导出 |
|---|---|---|
| `cloud/ssioClient.ts` | CloudGateway 之 SSIO：KV 读写、发行清单、资产解析 | `configureSsio`, `getSsioConfig`, `kvGet / kvGetJson / kvPut / kvPutJson / kvDelete`, `getLatestRelease`, `isSsioRef`, `resolveDownloadRef`, `SSIO_KEYS`, `SsioTarget` |
| `cloud/aiGateway.ts` | AI 网关：SSE 流式 `aiChatStream` + 非流 `aiComplete` + 工具调用 | `configureAiGateway`, `aiChatStream`, `aiComplete`, `AI_DEFAULT_KEY`, `AI_DEFAULT_MODEL='deepseek-v4-flash'`, `AiToolDef / AiUsage / AiChatMessage` |
| `cloud/homework.ts` | 作业同步码体系（syncCode/publishCode 派生、作业包打包） | `generateCodePair/Async`, `derivePublishCode`, `parsePublishCode`, `fetchBundle`, `publishEntries`, `CODE_SECRET`, `SYNCED_SOURCE_TAG='github'`（**历史字面量，勿改**） |
| `ai/tools.ts` | AI 工具调用定义 + 执行 + 二次确认 | `TOOL_DEFS`, `executeToolCall`, `confirmToolCall`, `ToolCall / ToolResult / PendingAction / ToolExecContext` |
| `ai/xlsRecognition.ts` | AI 智能识别课表 Excel（失败降级传统档案猜测） | `recognizeTimetableXls`, `AiXlsRecognition` |
| `xls/profiles/index.ts` | 学校档案注册表（generic + qilu），自动猜测阈值 **85** | `PROFILES`, `AUTO_PICK_THRESHOLD`, `listProfiles`, `getProfile`, `detectProfile` |
| `xls/profiles/generic.ts` | 通用「一行一节课」档案 | `autoMapping`, `toRecords`, `parseRecords`, `genericProfile` |
| `xls/profiles/qilu.ts` + `qiluCell.ts` | 齐鲁「格子表」档案 + 单元格解析器 | `qiluProfile`, `parseQiluCell`, `QILU_DAY_NAMES`, `isAnchor`, `isFooterRow` |
| `xls/profiles/shared.ts` / `types.ts` | 通用单元格/星期/节次解析；档案接口契约 | `cellToString`, `normalizeAoa`, `parseDay`, `parsePeriodList`；`SchoolProfile / ProfileInfo / FieldMapping / ProfileParseResult` |
| `core/periods.ts` | 节次 ↔ 大节 ↔ 时间范围纯函数 | `FALLBACK_PERIODS`, `PERIODS_PER_BIG_SESSION`, `bigSessionOf`, `periodsOf`, `parseTimeRange` |
| `core/ics.ts` | ICS 日历文本生成 | `buildIcs`, `toIcsDate`, `escapeIcs`, `pad`, `IcsEvent` |
| `core/ustbTypes.ts` | USTB 课表项类型 + 周次文本解析 | `ParsedClassItem`, `parseWeeksText` |
| `ustb/client.ts`（15.4KB） | 北科教务 SSO 协议层：扫码登录 + 课表/成绩抓取（**HTTP 由外部注入**） | `configureUstbHttp`, `CookieJar`, `createContext`, `startQrLogin`, `getQrImage`, `pollQrStatus`, `completeQrLogin`, `fetchCurriculum`, `fetchGrades`, `mapGradeRow` |
| `config/ssioKeys.ts` | **SSIO 配置唯一真源**：基址、App Key、Release Key、KV 命名规范 | `SSIO_BASE='http://120.53.9.81:8100'`, `SSIO_APP_KEY`, `SSIO_RELEASE_KEY`, `SSIO_PATHS` |

### 2.4 `src/pages/`

| 文件 | 职责 / 路由 | 备注 |
|---|---|---|
| `Academic.tsx`（34.5KB） | 学业页（成绩 / 考试 / 培养方案聚合） | `AcademicPage` |
| `Academic/StudyPlanTab.tsx` | 培养方案学分要求 tab（表 `study_plan`） | `StudyPlanTab` |
| `Academic/UstbSyncPanel.tsx` | 教务扫码登录 + 成绩同步面板 | `UstbSyncPanel` |
| `Calendar.tsx`（33.8KB） | 日历月 / 周视图 | `CalendarPage` |
| `Courses.tsx`（370B） | **向后兼容 re-export 壳**（指向 `Courses/` 模块） | default + `Field` |
| `Courses/index.ts` | 模块 barrel（11 个子组件 + constants） | — |
| `Courses/CoursesPage.tsx` | 课程列表主页（**默认路由 `/`**） | `CoursesPage` |
| `Courses/TimetableView.tsx` | 课表网格渲染 | `TimetableView` |
| `Courses/CourseDrawer.tsx` · `CourseHomeworkOverview.tsx` | 课程抽屉 / 作业概览 | 同名 |
| `Courses/ReqRow.tsx` · `ReqInlineEditor.tsx` | 课程要求行 / 行内编辑 | 同名 |
| `Courses/ScheduleSlotModal.tsx` | 排课时间段弹窗 | 同名 |
| `Courses/Field.tsx` · `constants.ts` | 通用表单字段 / 模块常量 | `Field` |
| `Courses/tabs/{InfoTab,ScheduleTab,ReqsTab,NotesTab}.tsx` | 课程详情 4 个 tab | 同名 |
| `Dashboard.tsx` | 首页概览（**静态 import，冷启动首屏**） | `Dashboard` |
| `Habits.tsx` | 习惯打卡 | `HabitsPage` |
| `HomeworkModals.tsx`（36.5KB） | 作业同步三个弹窗 | `GenerateCodesModal`, `PublishHomeworkModal`, `ReceiveHomeworkModal` |
| `Projects.tsx`（30.4KB） | 项目列表 + 进入画布 | `ProjectsPage` |
| `Settings.tsx`（**59.8KB，全仓最大**） | 设置页（FEATURE-MAP 记 **14 个 Section**） | `SettingsPage` |
| `Stats.tsx` | 统计报表 | `StatsPage` |
| `Class/index.tsx` | 班级列表 | `ClassListPage` |
| `Class/ClassDetail.tsx`（47.4KB） | 班级详情（公告 / 接龙 / 投票 / 成员） | `ClassDetailPage` |
| `Class/ClassChat.tsx` | 班级聊天（text / birthday_wish） | `ClassChat` |
| `Class/BirthdayBoard.tsx` | 星露谷式生日墙 | `BirthdayBoard` |

### 2.5 `src/components/`

| 文件 | 职责 |
|---|---|
| `Layout.tsx` | 外壳：Sidebar / TopBar / ParticleBg / PlusMenu / SearchPalette / PomodoroWidget / QuickAdd；**启动 5s 后静默云备份** + `app.info()` + 静默查 APK 更新；全局快捷键 `system.onQuickAdd` |
| `Sidebar.tsx` · `TopBar.tsx` | 侧栏导航（移动端抽屉）/ 顶栏 |
| `PlusMenu.tsx` · `QuickAdd.tsx` · `SearchPalette.tsx` | 加号菜单 / 快速添加（Ctrl+Shift+A 唤起）/ 搜索面板 |
| `UpdateNotification.tsx`（19.6KB） | 更新提示（桌面 + 移动两套表现） |
| `MobileUpdatePanel.tsx` | 移动 APK 更新面板 → `@/mobile/apkUpdater` |
| `AiChat.tsx`（22.8KB） | AI 助手对话（SSE 流式 + 工具调用确认） |
| `XlsImportWizard.tsx`（17KB） | 课表 Excel 导入向导（选档案 → 映射 → 预览 → 导入） |
| `BeikeTimetable.tsx` | 贝壳课表展示组件 |
| `AboutPanel.tsx` · `DiagPanel.tsx` · `PatchPanel.tsx` | 关于（公告缓存）/ 输入诊断面板 / 补丁面板（**已退役但仍渲染**） |
| `ToastContainer.tsx` · `Modal.tsx` · `ParticleBg.tsx` · `ErrorBoundary.tsx` | 全局 Toast / 通用弹窗 / 粒子背景 / 错误边界（崩溃日志环形缓冲 `tm_crash_log`） |
| `Pomodoro.tsx`（372B） | **re-export 壳** → `features/pomodoro/PomodoroWidget` |
| `editor/ProjectCanvas.tsx`（23.8KB） | 项目画布主组件（`@xyflow/react`） |
| `editor/nodes.tsx` · `nodeRegistry.ts` | 6 种节点（Task / Course / Homework / Event / Note / Group / Custom）+ 实体注册表 |
| `editor/edges/{index,SequenceEdge,RelationEdge,DependencyEdge,CriticalEdge}.tsx` · `EdgeContextMenu.tsx` | 4 种边 + 边右键菜单 |
| `editor/PropertiesPanel.tsx` · `NodeToolbox.tsx` · `ImportExport.tsx` | 属性面板 / 节点工具箱 / 画布导入导出 |
| `editor/history.ts` | 撤销/重做快照 + 快照对账落库 + 导出/导入载荷 |
| `editor/cycleDetect.ts` | 依赖环检测 |

### 2.6 `src/features/`

| 文件 | 职责 |
|---|---|
| `pomodoro/PomodoroWidget.tsx` · `PomodoroFab.tsx` · `PomodoroPanel.tsx` | 悬浮番茄钟（可拖拽 FAB + 面板） |
| `pomodoro/usePomodoro.ts` · `useDragPosition.ts` | 计时 hook / 拖拽定位 hook |
| `pomodoro/types.ts` | Phase / State / Reducer + 常量（`POS_STORAGE_KEY='pomodoro_widget_pos'` 等） |
| `pomodoro/TimeDigits.tsx` · `TimerRing.tsx` · `TaskPicker.tsx` | 时间数字 / 进度环 / 任务选择器 |
| `pomodoro/visibility.ts` | 显隐状态（Habits 页用） |
| `pomodoro/index.ts` | barrel（**FEATURE-MAP 记录为 0 引用**） |
| `account/SiteAccountSection.tsx` · `CloudBackupSection.tsx` · `siteProfile.ts` | 网站账号登录 / 云备份区块 / 站点资料 |

### 2.7 基础设施：`hooks/` `store/` `types/` `utils/` `diag/` `styles/`

| 文件 | 职责 / 导出 |
|---|---|
| `hooks/useApplyTheme.ts` | 把 `settings.theme` 写到 `<html data-theme>` |
| `hooks/useShortcuts.ts`（default） | 全局快捷键（加号 / 搜索） |
| `hooks/useMediaQuery.ts` + `useIsMobile` | 响应式断点 |
| `hooks/useLocalStorage.ts` | 泛型 localStorage state |
| `hooks/useInputDiag.ts` | 装输入框失灵探测器 + `triggerInputDiagNow` |
| `store/index.ts` | **全局 zustand store**：courses / requirements / events / categories / projects / tasks / stats / settings / userProfile / appInfo / updateInfo + `refreshAll()`（**8 个并发 `taskAPI.db.*` 拉取**） |
| `types/index.ts`（9.5KB） | **26 个领域类型**（Course / Requirement / CalendarEvent / Project / ProjectTask / DashboardStats / Canvas* / Grade / Exam / PomodoroSession / Habit / Attendance / GroupList* / Update* / Xls* …） |
| `types/lunar-javascript.d.ts` | 第三方库类型声明 |
| `utils/clsx.ts` · `toast.ts` · `lunar.ts` · `holidays.ts` | className 合并 / Toast store（zustand，非生产才 console）/ 农历 + 教学周 / 节假日表 |
| `diag/inputDiag.ts`（12.6KB） | 输入框失灵埋点探测器（事件环形缓冲 + 快照导出） |
| `diag/inputRepair.ts` | 输入框自动修复补丁（自愈） |
| `styles/index.css`（28KB） | 主题 CSS 变量（`--c-primary-rgb` / `--c-ink-*` / `--ease-expo-out` 等）、安全区、动效 |

### 2.8 `src/mocks/` · `src/mobile/`（**注意：mobile 基本是死代码区**）

| 文件 | 职责 |
|---|---|
| `mocks/browserApi.ts`（31KB） | 内存 mock 实现（`?impl=mock` 或降级时用），`createBrowserApi()` |
| `mocks/browserApi/{data,dbCourses,dbProjects,dbCanvas,dbMisc,dbSettings}.ts` | mock 数据种子 + 分域 mock API |
| `mocks/classMock.ts` | 班级 mock（未部署服务端时兜底） |
| `mobile/apkUpdater.ts` | Android APK 更新（版本比较、下载、安装权限）—— **唯一被真实引用的 mobile 文件**（经 `MobileUpdatePanel`） |
| `mobile/{electron-shim,process-shim,shims/*}`（fs/os/path/url/crypto/child_process） | Capacitor 时代的 Node/Electron API 垫片，**v2 下基本为死代码** |
| `mobile/{sqlite3-adapter,nativeHttp,insets,persistence,sha256}.ts` | 旧移动端 SQLite/HTTP/安全区/IndexedDB/哈希实现，同上 |
| `mobile/bootstrap.ts.bak` | Capacitor 壳入口，已被 `fix-imports.cjs` 重命名为 `.bak` 摘出编译面 |

### 2.9 `src-tauri/`（Rust 侧）

| 文件 | 职责 |
|---|---|
| `src/main.rs` | 入口，`#![windows_subsystem="windows"]`（release 不弹控制台）→ `startasks_lib::run()` |
| `src/lib.rs` | **插件注册 + 命令 + 托盘 + 快捷键**：sql / http / fs / dialog / notification / opener / global-shortcut；命令 `app_info` / `hot_update::hot_update_apply` / `hot_update::hot_update_rollback`；**Ctrl+Shift+A → emit `app:quickadd`**；托盘（显示主窗 / 快速添加 / 退出，双击唤起） |
| `src/hot_update.rs` | 内容热更新：下载 SSIO 文件 → **大小校验（sha256 为占位实现）** → `pages/current ↔ pages/prev` 轮转 → emit `hot-update:applied`；`hot_update_rollback`（current→broken，prev→current） |
| `build.rs` | tauri-build 构建脚本 |
| `Cargo.toml` / `tauri.conf.json` | 见 §1 |

### 2.10 `server/class-module/`（Node/Express 模块包，**待合入 SSIO 仓库**）

| 文件 | 职责 |
|---|---|
| `routes.js`（20.3KB） | `registerClassRoutes(app, db)`，前缀 `/v1/class`，鉴权 `X-API-Key` + `X-Device-Token`；**26 个端点**（建班/加入/退出/列表/详情、公告 CRUD+已读、作业、接龙、投票、成员角色/资料/移除、聊天消息、班级设置、增量 sync） |
| `schema.sql` | 服务端表：`classes / class_members / class_messages / class_announcements / class_announcement_reads / class_tasks / class_task_states / class_chains / class_polls` |
| `migrate-from-kv.mjs` | 旧 P2P KV `class/<inviteCode>/` → 新表迁移 + 对账报告 |
| `test-routes.mjs` | 班级 REST 10 项测试 |
| `README.md` | 端点表 + 权限模型 + 4 步集成指引 |

### 2.11 `scripts/`（**多数是一次性写操作脚本，勿随手重跑**）

| 脚本 | 一句话 |
|---|---|
| `test-contract.mjs` | 契约回归：从 `api-factory.ts` 提全部 `invoke('…')` 通道，对账 7 个实现文件的处理器键；顺带扫 UI 里「GitHub 配置 / 月卡 / 北科云盘」措辞残留；缺则 exit 1 |
| `test-datalayer.mjs` | 数据层烟雾：sql.js 跑 `001_init.sql` → 建表数/关键表存在性 → dbHandlers CRUD → 老库导入（验证 billing 表被跳过） |
| `release-content.mjs` | 发版：把 `dist/` 产物推 SSIO storage + 写 `taskmgr/pages` 清单；`--notes-file`、`--execute`；读 `SSIO_BASE` / `SSIO_KEY` |
| `gate-hover.cjs` | 把 `index.css` 里裸 `:hover` 规则包进 `@media (hover:hover) and (pointer:fine)` |
| `check-mobile-imports.cjs` | 扫 `src/mobile/` 里的 import 合法性 |
| `cleanup-legacy.cjs` | 清理旧 Electron 工程产物（未跟踪文件先 zip 备份到 `_legacy-untracked-backup.zip`） |
| `extract-ddl.cjs` | 从旧 `electron/db/index.ts` 抽取 DDL 生成 `migrations/001_init.sql`（去月卡表） |
| `find-bad-sql.mjs` | 用 sql.js 逐句执行 `001_init.sql`，找出语法错误语句 |
| `fix-imports.cjs` | 修正从旧工程复制后的 import 路径；并把 `mobile/bootstrap.ts` 改名 `.bak` |
| `fix-xls-imports.cjs` | `xls/profiles/*` 里 `../../ustb/api` → `../core/ustbTypes` |
| `remove-themes.cjs` | 删除 neon-green / glass-light 两个主题的 CSS 块 |
| `rename-startasks.cjs` | 品牌改名 TaskManager/StarOS → StarTasks（**保留 `taskmgr/` 存储键与历史注释**） |
| `strip-billing.cjs` / `strip-billing2.cjs` | 删除月卡付费 UI 段（`Settings.tsx`）与 mock/契约层的 `billing` 命名空间 |
| `rustup-init.exe`（6.99MB） | Rust 工具链安装器（本机未装工具链时用） |

### 2.12 `migrations/` · `docs/`

- `migrations/001_init.sql`（13.2KB）：**28 张表 + 30 个索引**，全部 `IF NOT EXISTS`（已删 billing 月卡表）
- `migrations/002_academic.sql`：学业增强（`ALTER TABLE` 加列 + `study_plan` / `rank_records` 两表）
- `docs/FEATURE-MAP.md`（26KB）：Electron→Tauri 契约冻结清单，5 节（契约面 / 页面入口 / localStorage 键 /
  零引用基线 / Electron 专属能力）+「疑似被吞清单」

---

## 3. 核心架构：taskAPI 契约模型

```
window.taskAPI  ←  installTaskAPI()（src/api/index.ts）
                      │  探测 __TAURI_INTERNALS__ 决定实现
        ┌─────────────┼─────────────┬──────────────┐
    api/tauri.ts  api/sqljs.ts   mocks/browserApi.ts
        │              │              │
        └────── PlatformDeps（sql/http/fs/… 能力抽象）──────┘
                      │
              api/dispatch.ts（按 <namespace>:<action> 分发）
                      │
   ┌──────────┬───────┴────┬──────────┬──────────┬─────────┐
dbHandlers  cloudHandlers classHandlers siteHandlers updater/backup
   │            │              │             │
 SQL(76)   SSIO/AI/USTB    SSIO REST    nrsc.games
```

**三实现选择顺序**：`tauri` → `?impl=mock` → `sqljs` → 失败降级 `mock`。

**通道命名规范**：`<namespace>:<action>[:<sub>]`，例如 `db:courses:list`、`homework:publish`、`ai:chat`。

**新增一个通道的正确顺序**（漏一步 test-contract 就会红）：
1. `api-factory.ts` 声明形状（契约面）→
2. 对应 handler 文件加处理器键 →
3. UI 调用 →
4. `npm run test:contract` 验证覆盖。

---

## 4. 关键业务流程（6 条主链路）

**① 冷启动 → 看到数据**
`index.html` → `main.tsx#installTaskAPI()`（探测 `__TAURI_INTERNALS__`）→ `api/tauri.ts#createTauriApi`
（`Database.load('sqlite:taskmanager.db')` + `runMigrations`）或 `api/sqljs.ts` →
`createInvoke(deps, {cloud, class, site, updater})` → `buildAPI` → 挂载 `App.tsx` →
`useStore.refreshAll()`（`store/index.ts:57` 并发 8 个 `db.*`）→ `dispatch.ts` → `dbHandlers.ts` SQL →
`Layout` 渲染 `CoursesPage`；随后 `Layout.tsx:58` 拉 `app.info()` + 静默查更新。

**② 课表 Excel 导入**
`XlsImportWizard` → `xls:pickFile`（dialog）→ `xls:parseFile` / `xls:parseBuffer` →
优先 `ai/xlsRecognition.recognizeTimetableXls`（AI 网关），失败降级 `xls/profiles.detectProfile`
（置信度 ≥85 自动选中）→ `xls:reparse`（用户改映射）→ `xls:importItems` →
写 `courses`（`computeCourseKey` 去重）+ `events`；`xls:lastImport` 记录学期信息。

**③ AI 助手（含工具调用）**
`AiChat.tsx` → `ai:chat`（带 `requestId`）→ `cloudHandlers` → `cloud/aiGateway.aiChatStream`
（SSE，逐 token emit `ai:delta`）→ 若模型返回 tool_call → `ai/tools.executeToolCall`
（**只读直接执行；写操作转 `PendingAction` 入队**）→ 前端确认 → `ai:confirm` → `confirmToolCall`
真正写库 → 审计写 `ai_calls` 表；`ai:cancel` 中止。

**④ 作业发布 / 接收（SSIO KV）**
`HomeworkModals#GenerateCodesModal` → `homework:generateCodes`（`cloud/homework.generateCodePairAsync`，
8 位大写 syncCode）→ `homework:publish` → `publishEntries` → `kvPutJson(SSIO_PATHS.homework(syncCode))`；
接收方 `homework:receive` → `parsePublishCode` → `fetchBundle` → 写 `course_requirements`
（`source='github'` 历史字面量）。

**⑤ 班级协作（REST）**
`pages/Class/index.tsx` → `class:list` → `classHandlers.api()`（先 `ensureToken` 生成/读
`class_device_token`，带 `X-API-Key` + `X-Device-Token`）→ SSIO `/v1/class/*` →
结果镜像到本地 `classes` / `class_*` 表；`ClassDetail` → 公告 / 接龙 / 投票 / 聊天；`class:sync` 增量拉取。

**⑥ 内容热更新**
`UpdateNotification` → `hot:update:check` → `api/hotUpdate.fetchPagesManifest()`
（SSIO KV `taskmgr/pages`）→ 比对 `hot_update_state`（localStorage）→ `hot:update:apply` →
`invoke('hot_update_apply')` → `src-tauri/src/hot_update.rs` 下载到 `pages/staging` →
轮转 `current/prev` → emit `hot-update:applied`；异常时 `hot:update:rollback`。

**（附）云备份**：`Layout.tsx:31-55` 启动 5s 后 → `site.hasToken` → `backup.serialize`（27 表 JSON）→
`site.backupPut` → nrsc.games；结果用 `toast` 提示。

---

## 5. 数据层

**三种存储落点**

| 场景 | 实现 | 落点 |
|---|---|---|
| Tauri（桌面/Android） | `tauri-plugin-sql` | `taskmanager.db`（`tauri.conf.json` 声明） |
| 浏览器预览 | sql.js WASM | 整库 base64 存 localStorage `taskmgr_sqljs_db_v1`（300ms 防抖写回） |
| mock | 纯内存 | `src/mocks/browserApi/data.ts` |

**零散 localStorage 键**：`starmain_token`（站点 token）、`hot_update_state`、`tm_crash_log`、
`pomodoro_widget_pos/secs`、`taskmgr.insets.v1`。

**28 张表（`migrations/001_init.sql`）**

| 分组 | 表 | 作用 |
|---|---|---|
| 课程 | `courses`、`course_notes`、`course_requirements` | 课程、笔记、作业/考试/项目等要求（含 `remote_id`/`source` 同步字段） |
| 日程 | `events` | 日程事件（含重复规则、提醒、分类） |
| 项目 | `projects`、`project_tasks` | 项目与任务看板 |
| 画布 | `canvases`、`canvas_nodes`、`canvas_edges` | `@xyflow` 画布持久化 |
| 学业 | `grades`、`exams`、`attendance` | 成绩、考试（考场/座位）、出勤 |
| 习惯 | `habits`、`habit_checkins`、`pomodoro_sessions` | 打卡、番茄钟记录 |
| 系统 | `settings`（KV）、`categories`、`recycle_bin`、`ai_calls`、`device_profile`、`user_profiles` | 设置、分类、回收站、AI 审计、设备令牌、用户档案 |
| 班级 | `classes`、`class_announcements`、`class_tasks`、`class_chains`、`class_polls` | 服务端数据的**本地镜像缓存** |
| 兼容 | `group_lists`、`group_list_items` | 旧小组共享遗留，无新 UI |

`002_academic.sql` 追加：`study_plan`（分类学分要求）、`rank_records`（学期排名），并给 `courses`
加 `credit/category/course_status`、`exams` 加 `exam_room/seat_no`。

**迁移机制**：`migrations/00N_*.sql` 由 `src/api/migrations.ts` 的 `MIGRATIONS` 数组按序执行
（`?raw` 导入，按分号切句，单句失败仅 `console.warn` 跳过）。001 全 `IF NOT EXISTS` 幂等；
002 用 `ALTER TABLE`（SQLite 无 `IF NOT EXISTS` 语法），幂等性依赖执行器的「失败跳过」。
**新增迁移 = 加文件 + 追加数组一项。**

---

## 6. 外部依赖与配置

| 依赖项 | 位置 | 说明 |
|---|---|---|
| SSIO 基址 | `src/config/ssioKeys.ts:18` 硬编码 `http://120.53.9.81:8100`；`scripts/release-content.mjs:34`、`hot_update.rs:60` 读环境变量 `SSIO_BASE` | 云服务器统一走 IP（`nrsc.games` 被 DNSPod 拦截） |
| SSIO Key | `ssioKeys.ts:21`；`release-content.mjs:36` 读 `SSIO_KEY`；`hot_update.rs:61` 读 `SSIO_KEY` | ⚠ **Release Key 已明文入库**，注释要求"绝不进前端产物"，但实际在 `src/config/` 下会被打包 |
| AI 默认 key/model | `src/cloud/aiGateway.ts:14-15` | 内置应用 Key，用户可在设置覆盖 baseUrl/key/model |
| 星芒网站 | `src/api/siteHandlers.ts:17` `SITE_BASE = https://nrsc.games` | 账号与云备份 |
| 北科教务 | `src/ustb/client.ts:25` `BYYT_BASE = https://byyt.ustb.edu.cn` | SSO 协议层 |

**环境变量结论**：本地开发 / Tauri 构建**无必填环境变量**（全部有默认值）。
只有**发版**（`release-content.mjs`）和 **Rust 热更新**建议显式设 `SSIO_BASE` / `SSIO_KEY`
（尤其需要 release:write 权限的 Key）。构建前置是 **Rust 工具链**。

---

## 7. 构建、发版与两条更新通道

- **内容热更新**（前端产物）：`release-content.mjs` → SSIO storage + KV 清单 `taskmgr/pages` →
  客户端 `hotUpdate.ts` 拉取 → Rust `hot_update_apply` 落盘轮转。**无需重装客户端**。
- **壳更新**（Tauri 本体）：`tauri-plugin-updater`，低频，桌面端 only。
- 打包：`npm run tauri:build` → `nsis` / `deb` / `appimage` + Android APK
  （`bundle.android.enabled: true`，但缺 `gen/android` 与 `tauri.android.conf.json`）。

---

## 8. 已知坑与未完成任务

**错误处理约定**

- `dispatch.ts:66`：未迁移通道返回 `{ok:false, error:'通道 X 尚未迁移到 Tauri 实现', errorCode:'NOT_MIGRATED'}`。
- `classHandlers.ts:56`：服务端未就绪 → `errorCode:'CLASS_API_UNAVAILABLE'`（UI 显示"班级服务升级中"）。
- `cloudHandlers.ts:358-359,549-552`：`ustb:preview/import` 与 `webdav:*` 返回**明确错误信息 + `deferred: true`**。
- `migrations.ts:23`：建表语句失败只 `console.warn` 跳过（002 的 ALTER 在列已存在时必然报错）。
- `legacyImport.ts:107`：单行插入冲突（如 `course_key` UNIQUE）跳过该行不阻断导入。

**未完成 / 技术债**

| 项 | 位置 | 状态 |
|---|---|---|
| Rust sha256 强校验 | `hot_update.rs:33-41` | **占位实现**（`DefaultHasher`，16 位 hex），当前只验大小；接 `sha2` crate 后才启用 |
| USTB 贝壳课表 SSO | `cloudHandlers.ts:315-410` | 协议层已平移（`ustb/client.ts`），HTTP 流程待 Rust cookie jar 调通 |
| WebDAV 坚果云同步 | `cloudHandlers.ts:535-552` | 配置保留，同步操作返回 `deferred` |
| 班级服务端部署 | `server/class-module/` | 待合入 SSIO 仓库（`D:\StarMain\StarServerIO\repo`），4 步集成见其 README |
| 补丁系统 | `updaterHandlers.ts:69-76` | **已退役**，`update:patch:*` 全部返回"补丁系统已退役"，方法名保留只为契约不破 |
| 月卡 / billing | `legacyImport.ts:19` | 整体删除；`IGNORED_TABLES=['monthly_subscriptions','voucher_purchases']` |
| CSP | `index.html:10-15` | v1.2.18 起 `connect-src` 放开 `https: http:`（原 `'self'` 拦掉了 SSIO 请求）；保留 `ws://localhost:5173` 给 vite dev |

**构建 / 工程风险（侦察实测，动手前必读）**

- ⚠ `src-tauri/` 下**没有 `capabilities/` 目录**（Tauri 2 的 ACL 默认拒绝插件调用），
  也**没有 `icons/icon.ico|icon.png`**（`tauri.conf.json` 已声明）→ `tauri build` 大概率在此之前就失败。
- ⚠ `bundle.android.enabled: true` 但没有 `gen/android`、`tauri.android.conf.json`；本机未装 Rust 工具链。
- ⚠ 多数 `scripts/*.cjs` **硬编码绝对路径 `E:/University/TaskManager/HTML`**（换机器即失效，且是**写操作**脚本）。
- ⚠ `src/mobile/` 除 `apkUpdater.ts` 外基本是 Capacitor 时代死代码；`bootstrap.ts.bak` 已摘出编译面。
- ⚠ `features/pomodoro/index.ts` 是 0 引用 barrel；`components/Pomodoro.tsx`、`pages/Courses.tsx` 是兼容 re-export 壳。
- ⚠ `src/assets/payment-wechat.png`（149KB）是月卡遗留收款码，已无引用。

---

## 9. 附录

**文件总数统计（排除 `node_modules/`、`dist/`、`package-lock.json`）**

| 扩展名 | 数量 | 主要分布 |
|---|---:|---|
| `.ts` | 80（含 2 个 `.d.ts`） | src 79 + `vite.config.ts` |
| `.tsx` | 67 | pages 33 / components 30 / features 4 |
| `.cjs` | 11 | scripts 10 + `postcss.config.cjs` |
| `.mjs` | 6 | scripts 4 + server 2 |
| `.js` | 2 | `tailwind.config.js`、`server/class-module/routes.js` |
| `.rs` | 4 | `src-tauri/src/{lib,main,hot_update}.rs` + `build.rs` |
| `.sql` | 3 | `migrations/00{1,2}*.sql` + `server/class-module/schema.sql` |
| `.md` | 3 | README / FEATURE-MAP / class-module README |
| `.json` / `.toml` / `.html` / `.css` / `.png` / `.bak` | 3 / 1 / 1 / 1 / 2 / 1 | 配置与资源 |
| **合计** | **184**（+`rustup-init.exe` 1，+`package-lock.json`，+`dist/` 10 = 197） | — |

**术语表**

| 术语 | 含义 |
|---|---|
| SSIO | StarServerIO，自托管 BaaS；本项目用作 KV 存储、发行清单、内容热更新源 |
| taskAPI | `window.taskAPI`，前端唯一数据出入口（契约冻结） |
| 通道 channel | `<namespace>:<action>` 形式的调用名，如 `db:courses:list` |
| 档案 profile | 课表 Excel 的解析规则集（generic / qilu），自动猜测阈值 85 |
| 内容热更新 | 不下发安装包，只替换前端产物目录（`pages/current ↔ pages/prev`） |
| 平台实现 | tauri / sqljs / mock 三套 `PlatformDeps` 实现 |

**补注释优先级建议**：`src/api/*`（契约层，最高）→ `src/tauri.ts` / `sqljs.ts`（平台差异）→
`src-tauri/src/*`（Rust，含 sha256 占位警告）→ `src/cloud/*`（Key 安全边界与命名规范）→
`src/pages/Settings.tsx`（59KB，最大）→ `src/components/editor/*`（画布逻辑密集）→
`scripts/*`（标注写操作风险）。`src/mobile/*` 除 `apkUpdater.ts` 外统一标注"v2 已废弃，Capacitor 遗留"。
