# TaskManager Electron → Tauri 迁移 · 功能/契约冻结清单（FEATURE-MAP）

- **生成日期**：2026-10-23
- **源码 commit**：`88db4ee`（full: `88db4ee9a14a924946cbe4a4790da72d004c248e`，来源 `.git/refs/heads/main`）
- **只读扫描范围**：`e:/University/TaskManager` 下 `electron/` `src/` `docs/` `scripts/`
- **迁移约定**：渲染层 UI 原样迁移；`window.taskAPI` 契约形状 1:1 保留

## 复核方式（验收项）

| 项目 | 数字 | 复核方法 |
|---|---|---|
| `api-factory.ts` 中 `invoke('...')` 唯一通道数 | **190** | 通读 `electron/api-factory.ts`（811 行），对每个 `invoke('<channel>')` 字面量去重计数 |
| 契约表 invoke 型方法数 | **190** | 第 1 节表格中标注 transport=invoke 的行数，与上行一致 |
| send 型 | 2 | `app:ready-to-show`、`input:diag:append` |
| subscribe 型 | 7 | `ai:delta` `ai:done` `ai:error` `ai:action` `update:progress` `update:available` `app:quickadd` |
| 契约 API 面方法总数 | **199** | 190 invoke + 2 send + 7 subscribe |
| ipcMain.handle/on 注册总数（主进程侧） | 185（另有 ustb/db/ics 等分散注册） | `scripts/check-ipc-align.js` 可作三层对齐校验 |

---

## 1. 契约面：window.taskAPI 全量方法 × 调用点

> 调用点仅统计 `src/**/*.{ts,tsx}`（mocks 为实现方，scripts/e2e 已在备注标明）。路径相对 `e:\University\TaskManager`。

### 1.1 window（invoke 4）

| 命名空间.方法 | 调用点文件 | 调用次数 | 备注 |
|---|---|---|---|
| window.minimize | src/components/TopBar.tsx | 1 | 窗口最小化按钮 |
| window.maximize | src/components/TopBar.tsx | 1 | 最大化/还原 |
| window.close | src/components/TopBar.tsx | 1 | 关闭按钮 |
| window.isMaximized | src/components/TopBar.tsx | 2 | 挂载时 + maximize 后 |

### 1.2 db.*（invoke 76）

| 命名空间.方法 | 调用点文件 | 调用次数 | 备注 |
|---|---|---|---|
| db.courses.list | src/store/index.ts | 1 | refreshAll |
| db.courses.get | — | 0 | **零调用** |
| db.courses.create | src/pages/Courses/CoursesPage.tsx; src/pages/Courses/tabs/InfoTab.tsx; src/pages/HomeworkModals.tsx | 3 | 新建课 / 接收作业缺课时建课 |
| db.courses.update | src/pages/Courses/tabs/InfoTab.tsx | 1 | |
| db.courses.delete | — | 0 | **零调用**（仅 scripts/e2e-homework-test.js） |
| db.requirements.list | src/store/index.ts; src/pages/Academic.tsx | 2 | |
| db.requirements.create | src/pages/Academic.tsx; src/pages/Courses/ReqInlineEditor.tsx; src/components/QuickAdd.tsx | 3 | 复习任务生成 / 作业新建 / 快速添加 |
| db.requirements.update | src/pages/Courses/ReqInlineEditor.tsx; src/pages/Courses/ReqRow.tsx | 2 | |
| db.requirements.delete | src/pages/Courses/ReqRow.tsx | 1 | |
| db.events.list | src/store/index.ts; src/pages/Calendar.tsx | 3 | |
| db.events.create | src/pages/Calendar.tsx; src/pages/Courses/ScheduleSlotModal.tsx | 2 | |
| db.events.update | src/pages/Calendar.tsx; src/pages/Courses/ScheduleSlotModal.tsx | 2 | |
| db.events.delete | src/pages/Calendar.tsx; src/pages/Courses/tabs/ScheduleTab.tsx | 2 | |
| db.categories.list | src/store/index.ts | 1 | |
| db.categories.create | src/pages/Settings.tsx | 1 | |
| db.categories.update | src/pages/Settings.tsx | 1 | |
| db.categories.delete | src/pages/Settings.tsx | 1 | |
| db.userProfiles.list | src/pages/Settings.tsx | 2 | 切换账户 |
| db.userProfiles.getActive | src/store/index.ts | 1 | |
| db.userProfiles.getByOpenid | — | 0 | **零调用**（仅 mocks/browserApi/dbSettings.ts） |
| db.userProfiles.create | src/pages/Settings.tsx | 3 | |
| db.userProfiles.update | src/pages/Settings.tsx | 3 | |
| db.userProfiles.delete | src/pages/Settings.tsx | 1 | |
| db.userProfiles.setActive | src/pages/Settings.tsx | 3 | |
| db.courseNotes.list | src/pages/Courses/tabs/NotesTab.tsx | 1 | |
| db.courseNotes.create | src/pages/Courses/tabs/NotesTab.tsx | 1 | |
| db.courseNotes.update | src/pages/Courses/tabs/NotesTab.tsx | 1 | |
| db.courseNotes.delete | src/pages/Courses/tabs/NotesTab.tsx | 1 | |
| db.projects.list | src/store/index.ts | 1 | |
| db.projects.get | — | 0 | **零调用** |
| db.projects.create | src/pages/Projects.tsx | 1 | |
| db.projects.update | src/pages/Projects.tsx | 1 | |
| db.projects.delete | src/pages/Projects.tsx | 2 | |
| db.tasks.list | src/store/index.ts | 1 | |
| db.tasks.create | src/pages/Projects.tsx | 2 | |
| db.tasks.update | src/pages/Projects.tsx | 3 | |
| db.tasks.delete | src/pages/Projects.tsx | 3 | |
| db.canvases.list | — | 0 | **零调用** |
| db.canvases.get | — | 0 | **零调用** |
| db.canvases.getByProject | src/components/editor/ProjectCanvas.tsx | 1 | |
| db.canvases.create | src/components/editor/ProjectCanvas.tsx | 1 | |
| db.canvases.update | — | 0 | **零调用** |
| db.canvases.delete | — | 0 | **零调用** |
| db.canvasNodes.listByCanvas | src/components/editor/ProjectCanvas.tsx; src/components/editor/history.ts | 4 | |
| db.canvasNodes.create | src/components/editor/ProjectCanvas.tsx; src/components/editor/history.ts | 3 | |
| db.canvasNodes.update | src/components/editor/ProjectCanvas.tsx | 1 | |
| db.canvasNodes.updatePositions | src/components/editor/ProjectCanvas.tsx | 1 | 拖拽批量写 |
| db.canvasNodes.delete | src/components/editor/ProjectCanvas.tsx; src/components/editor/history.ts | 4 | |
| db.canvasEdges.listByCanvas | src/components/editor/ProjectCanvas.tsx; src/components/editor/history.ts | 4 | |
| db.canvasEdges.create | src/components/editor/ProjectCanvas.tsx; src/components/editor/history.ts | 3 | |
| db.canvasEdges.update | src/components/editor/ProjectCanvas.tsx | 2 | |
| db.canvasEdges.delete | src/components/editor/ProjectCanvas.tsx; src/components/editor/history.ts | 4 | |
| db.settings.getAll | src/store/index.ts | 1 | |
| db.settings.set | src/pages/Settings.tsx; src/features/pomodoro/PomodoroWidget.tsx | 3 | |
| db.stats.dashboard | src/store/index.ts | 1 | |
| db.stats.report | src/pages/Stats.tsx | 1 | 周报/月报 |
| db.grades.list | src/pages/Academic.tsx | 1 | |
| db.grades.create | src/pages/Academic.tsx | 1 | |
| db.grades.update | src/pages/Academic.tsx | 1 | |
| db.grades.delete | src/pages/Academic.tsx | 1 | |
| db.exams.list | src/pages/Academic.tsx; src/pages/Dashboard.tsx | 2 | |
| db.exams.create | src/pages/Academic.tsx | 1 | |
| db.exams.update | src/pages/Academic.tsx | 3 | |
| db.exams.delete | src/pages/Academic.tsx | 2 | |
| db.pomodoro.list | — | 0 | **零调用** |
| db.pomodoro.create | src/features/pomodoro/PomodoroWidget.tsx | 1 | |
| db.pomodoro.stop | — | 0 | **零调用**（疑似被吞） |
| db.pomodoro.stats | src/features/pomodoro/usePomodoro.ts; src/pages/Stats.tsx; src/pages/Dashboard.tsx | 3 | |
| db.habits.list | src/pages/Habits.tsx; src/pages/Dashboard.tsx | 3 | |
| db.habits.create | src/pages/Habits.tsx | 1 | |
| db.habits.update | src/pages/Habits.tsx | 1 | |
| db.habits.delete | src/pages/Habits.tsx | 1 | |
| db.habits.toggleCheckin | src/pages/Habits.tsx; src/pages/Dashboard.tsx | 2 | |
| db.attendance.list | src/pages/Academic.tsx | 1 | |
| db.attendance.upsert | src/pages/Academic.tsx | 3 | |
| db.attendance.stats | — | 0 | **零调用**（Stats 页出勤汇总走 db.stats.report） |

### 1.3 ustb / ics（invoke 8）

| 命名空间.方法 | 调用点文件 | 调用次数 | 备注 |
|---|---|---|---|
| ustb.status | src/components/BeikeTimetable.tsx | 1 | |
| ustb.qrStart | src/components/BeikeTimetable.tsx | 1 | SSO 扫码 |
| ustb.qrPoll | src/components/BeikeTimetable.tsx | 1 | |
| ustb.qrCancel | src/components/BeikeTimetable.tsx | 1 | |
| ustb.preview | src/components/BeikeTimetable.tsx | 1 | |
| ustb.import | src/components/BeikeTimetable.tsx | 1 | |
| ustb.logout | src/components/BeikeTimetable.tsx | 1 | |
| ics.export | src/pages/Calendar.tsx | 1 | 导出 .ics |

### 1.4 ai（invoke 10 + subscribe 4）

| 命名空间.方法 | 调用点文件 | 调用次数 | 备注 |
|---|---|---|---|
| ai.config.get | src/components/AiChat.tsx | 1 | |
| ai.config.save | src/components/AiChat.tsx | 1 | |
| ai.test | src/components/AiChat.tsx | 1 | |
| ai.snapshot | src/components/AiChat.tsx | 1 | |
| ai.chat | src/components/AiChat.tsx | 1 | 流式 |
| ai.cancel | src/components/AiChat.tsx | 1 | |
| ai.plan | src/components/AiChat.tsx | 1 | 动作预演 |
| ai.undo | src/components/AiChat.tsx | 1 | 30s 撤销 |
| ai.confirm | src/components/AiChat.tsx | 1 | 唯一写库入口 |
| ai.calls | src/components/AiChat.tsx | 1 | 调用历史 |
| ai.onDelta | src/components/AiChat.tsx | 1 | subscribe('ai:delta') |
| ai.onDone | src/components/AiChat.tsx | 1 | subscribe('ai:done') |
| ai.onError | src/components/AiChat.tsx | 1 | subscribe('ai:error') |
| ai.onAction | src/components/AiChat.tsx | 1 | subscribe('ai:action') |

### 1.5 app / system（invoke 3 + send 1 + subscribe 1）

| 命名空间.方法 | 调用点文件 | 调用次数 | 备注 |
|---|---|---|---|
| app.info | src/components/Layout.tsx | 1 | |
| app.ready | src/App.tsx:67; src/main.tsx:23 | 2 | send('app:ready-to-show')；main.tsx 为 3s 兜底 |
| app.getCloseBehavior | src/pages/Settings.tsx | 1 | |
| app.setCloseBehavior | src/pages/Settings.tsx | 1 | |
| system.onQuickAdd | src/components/Layout.tsx:25 | 1 | subscribe('app:quickadd')，Ctrl+Shift+A/托盘 |

### 1.6 updater（invoke 20 + subscribe 2）

| 命名空间.方法 | 调用点文件 | 调用次数 | 备注 |
|---|---|---|---|
| updater.config | src/pages/Settings.tsx; src/components/Layout.tsx | 2 | |
| updater.check | src/components/Layout.tsx | 1 | 启动自动查 |
| updater.checkAll | src/pages/Settings.tsx | 1 | |
| updater.download | src/pages/Settings.tsx; src/components/UpdateNotification.tsx | 2 | |
| updater.cancel | src/components/UpdateNotification.tsx | 1 | |
| updater.install | src/pages/Settings.tsx; src/components/UpdateNotification.tsx | 2 | |
| updater.openExternal | src/pages/Settings.tsx; src/pages/HomeworkModals.tsx; src/components/UpdateNotification.tsx | 3 | |
| updater.skipVersion | src/pages/Settings.tsx; src/components/UpdateNotification.tsx | 2 | |
| updater.patchPreview | src/components/UpdateNotification.tsx; src/components/PatchPanel.tsx | 2 | |
| updater.patchApply | — | 0 | **零调用**（被 patchApplyCached 取代） |
| updater.patchState | src/components/PatchPanel.tsx | 1 | |
| updater.patchDownload | src/components/UpdateNotification.tsx; src/components/PatchPanel.tsx | 2 | |
| updater.patchCacheState | src/components/UpdateNotification.tsx; src/components/PatchPanel.tsx | 3 | |
| updater.patchApplyCached | src/components/UpdateNotification.tsx; src/components/PatchPanel.tsx | 3 | |
| updater.patchClearCache | src/components/PatchPanel.tsx | 1 | |
| updater.patchTakeoverSidecar | src/components/PatchPanel.tsx | 1 | |
| updater.setSource | — | 0 | **零调用**（被 setSources 取代） |
| updater.setSources | src/pages/Settings.tsx | 1 | |
| updater.setActiveSource | — | 0 | **零调用** |
| updater.setAutoCheck | src/pages/Settings.tsx | 1 | |
| updater.onProgress | src/pages/Settings.tsx; src/components/UpdateNotification.tsx; src/components/PatchPanel.tsx | 3 | subscribe('update:progress') |
| updater.onAvailable | src/components/UpdateNotification.tsx | 1 | subscribe('update:available') |

### 1.7 homework（invoke 9）

| 命名空间.方法 | 调用点文件 | 调用次数 | 备注 |
|---|---|---|---|
| homework.config | src/pages/Settings.tsx; src/pages/HomeworkModals.tsx | 2 | |
| homework.saveAuth | src/pages/Settings.tsx | 1 | 仅昵称 |
| homework.generateCodes | src/pages/HomeworkModals.tsx | 1 | |
| homework.listMyCodes | src/pages/HomeworkModals.tsx | 1 | |
| homework.verifyCodes | — | 0 | **零调用 UI**（仅 scripts/e2e-homework-codes-test.js） |
| homework.courseSyncCode | — | 0 | **零调用 UI**（仅 scripts/e2e） |
| homework.publish | src/pages/HomeworkModals.tsx | 1 | 含批量 entries |
| homework.remoteEntries | — | 0 | **零调用 UI**（仅 scripts/e2e-homework-test.js） |
| homework.receive | src/pages/HomeworkModals.tsx | 2 | |

### 1.8 diag / backup / xls（invoke 13 + send 1）

| 命名空间.方法 | 调用点文件 | 调用次数 | 备注 |
|---|---|---|---|
| diag.append | src/components/BeikeTimetable.tsx | 1 | send('input:diag:append') |
| diag.peek | src/components/DiagPanel.tsx | 1 | |
| diag.export | src/components/DiagPanel.tsx | 1 | |
| backup.export | src/pages/Settings.tsx | 1 | |
| backup.import | src/pages/Settings.tsx | 1 | |
| backup.status | src/pages/Settings.tsx | 1 | |
| backup.makeSafety | — | 0 | **零调用**（仅 mocks） |
| xls.pickFile | src/components/XlsImportWizard.tsx | 1 | dialog |
| xls.listProfiles | src/components/XlsImportWizard.tsx | 1 | |
| xls.parseFile | src/components/XlsImportWizard.tsx | 1 | |
| xls.parseBuffer | src/components/XlsImportWizard.tsx | 1 | 移动端唯一入口 |
| xls.reparse | src/components/XlsImportWizard.tsx | 2 | |
| xls.importItems | src/components/XlsImportWizard.tsx | 1 | |
| xls.lastImport | src/pages/Settings.tsx | 1 | |

### 1.9 about / cleanup / webdav / billing（invoke 20）

| 命名空间.方法 | 调用点文件 | 调用次数 | 备注 |
|---|---|---|---|
| about.getCache | src/components/AboutPanel.tsx | 1 | |
| about.refresh | src/components/AboutPanel.tsx | 1 | |
| about.saveLocal | src/components/AboutPanel.tsx | 1 | |
| about.setPinned | src/components/AboutPanel.tsx | 1 | |
| about.cachePath | — | 0 | **零调用** |
| about.openCache | src/components/AboutPanel.tsx | 1 | shell.showItemInFolder |
| cleanup.rules | src/pages/Settings.tsx | 1 | |
| cleanup.setRules | src/pages/Settings.tsx | 1 | |
| cleanup.run | src/pages/Settings.tsx | 1 | |
| cleanup.bin | src/pages/Settings.tsx | 1 | |
| cleanup.restore | src/pages/Settings.tsx | 1 | |
| cleanup.purge | src/pages/Settings.tsx | 1 | |
| webdav.config | src/pages/Settings.tsx | 1 | |
| webdav.save | src/pages/Settings.tsx | 1 | |
| webdav.test | src/pages/Settings.tsx | 1 | |
| webdav.push | src/pages/Settings.tsx | 1 | |
| webdav.remoteInfo | src/pages/Settings.tsx | 1 | |
| webdav.pull | src/pages/Settings.tsx | 1 | |
| billing.status | src/pages/Settings.tsx | 2 | |
| billing.redeemMonthly | src/pages/Settings.tsx | 1 | |
| billing.redeemVoucher | — | 0 | **零调用**（仅 mocks） |
| billing.syncVouchers | — | 0 | **零调用**（v1.2.6 起 no-op） |

### 1.10 class（invoke 25）

| 命名空间.方法 | 调用点文件 | 调用次数 | 备注 |
|---|---|---|---|
| class.config | src/pages/Class/index.tsx | 2 | |
| class.saveLocalAlias | src/pages/Class/index.tsx | 1 | |
| class.list | src/pages/Class/index.tsx | 1 | |
| class.info | src/pages/Class/ClassDetail.tsx | 1 | |
| class.create | src/pages/Class/index.tsx | 1 | 月卡门槛 |
| class.join | src/pages/Class/index.tsx | 1 | |
| class.leave | src/pages/Class/index.tsx | 1 | |
| class.listAnnouncements | src/pages/Class/ClassDetail.tsx | 1 | |
| class.listTasks | — | 0 | **零调用**（v1.2.9 作业 tab 已移除，见 ClassDetail.tsx:4 注释） |
| class.publishAnnouncement | src/pages/Class/ClassDetail.tsx | 1 | |
| class.publishTask | — | 0 | **零调用** |
| class.deleteAnnouncement | src/pages/Class/ClassDetail.tsx | 1 | |
| class.promoteMember | src/pages/Class/ClassDetail.tsx | 1 | |
| class.removeMember | src/pages/Class/ClassDetail.tsx | 1 | |
| class.listChains | src/pages/Class/ClassDetail.tsx | 1 | |
| class.createChain | src/pages/Class/ClassDetail.tsx | 1 | |
| class.joinChain | src/pages/Class/ClassDetail.tsx | 1 | |
| class.closeChain | src/pages/Class/ClassDetail.tsx | 1 | |
| class.listPolls | src/pages/Class/ClassDetail.tsx | 1 | |
| class.createPoll | src/pages/Class/ClassDetail.tsx | 1 | |
| class.votePoll | src/pages/Class/ClassDetail.tsx | 1 | |
| class.closePoll | src/pages/Class/ClassDetail.tsx | 1 | |
| class.markAnnouncementRead | src/pages/Class/ClassDetail.tsx | 1 | |
| class.completeTask | — | 0 | **零调用** |
| class.sync | src/pages/Class/ClassDetail.tsx | 1 | |

**第 1 节条目合计：199**（invoke 190 + send 2 + subscribe 7）

---

## 2. 页面 × 用户可见入口

### 2.1 Dashboard（src/pages/Dashboard.tsx）
| 入口 | 触发 taskAPI |
|---|---|
| 快速添加卡片 | QuickAdd → db.requirements.create |
| AI 助手卡片 | AiChat → ai.*（10 invoke + 4 订阅） |
| 下一考试卡片（跳 /academic） | db.exams.list |
| 习惯打卡行 + MORE→/habits | db.habits.list / toggleCheckin |
| 「即将到期」Panel → /courses | db.stats.dashboard（store） |
| 「今日时间表」Panel | db.events.list |
| 「项目进行中」Panel → /projects | db.projects.list |

### 2.2 Calendar（src/pages/Calendar.tsx）
| 入口 | 触发 taskAPI |
|---|---|
| 月历导航：上一月/今天/下一月 | db.events.list |
| 导出 .ics 按钮 | ics.export |
| 新建日程按钮 | EventModal → db.events.create |
| 日程卡片点击 | EventModal → db.events.update / db.events.delete |
| EventModal 删除/取消/保存 | db.events.delete / create / update |

### 2.3 Courses（src/pages/Courses/*）
| 入口 | 触发 taskAPI |
|---|---|
| 新建课程按钮 | db.courses.create |
| Excel 导入按钮 | XlsImportWizard → xls.pickFile/listProfiles/parseFile/parseBuffer/reparse/importItems |
| 作业菜单（生成作业码/发布/接收） | homework.generateCodes/listMyCodes / publish / receive |
| 贝壳课表按钮 | Modal+BeikeTimetable → ustb.*、diag.append |
| 课表格子点击 | CourseDrawer |
| Drawer Tab：信息 | InfoTab → db.courses.create/update |
| Drawer Tab：上课时间 | ScheduleTab → db.events.create/update/delete |
| Drawer Tab：作业 | ReqsTab → db.requirements.create/update/delete |
| Drawer Tab：笔记 | NotesTab → db.courseNotes.list/create/update/delete |

### 2.4 Academic（src/pages/Academic.tsx）
| 入口 | 触发 taskAPI |
|---|---|
| Tab：成绩 | db.grades.list/create/update/delete |
| Tab：考试 | db.exams.list/create/update/delete；生成复习任务 → db.requirements.list/create |
| Tab：出勤 | db.attendance.list/upsert |
| 成绩 Modal（录入/编辑） | db.grades.create/update |
| 考试卡：标记已考完/改期/删除 | db.exams.update/delete |

### 2.5 Habits（src/pages/Habits.tsx）
| 入口 | 触发 taskAPI |
|---|---|
| 新建习惯按钮 | HabitFormModal → db.habits.create |
| 习惯卡：编辑/删除/打卡 | db.habits.update/delete/toggleCheckin |
| HabitFormModal（名称/emoji/颜色/频率） | db.habits.create/update |

### 2.6 Projects（src/pages/Projects.tsx + components/editor/*）
| 入口 | 触发 taskAPI |
|---|---|
| 视图 Tab：看板/列表/时间线/画布 | — |
| 新建项目按钮 | ProjectModal → db.projects.create |
| 项目卡编辑/删除 | db.projects.update/delete |
| 添加任务按钮 | TaskModal → db.tasks.create |
| 任务行：勾选/编辑/删除/优先级 | db.tasks.update/delete |
| 列表快速添加输入 | db.tasks.create |
| 画布 ProjectCanvas | db.canvases.getByProject/create、db.canvasNodes.*、db.canvasEdges.* |
| 画布：节点工具箱/属性面板/边右键菜单/导入导出/撤销 | canvasNodes/canvasEdges + history |

### 2.7 Stats（src/pages/Stats.tsx）
| 入口 | 触发 taskAPI |
|---|---|
| 周/月切换 | db.stats.report + db.pomodoro.stats |
| 上一期/下一期 | 同上 |
| 6 个 ChartCard（待办/打卡/专注/按课程/出勤汇总） | db.stats.report / db.pomodoro.stats |

### 2.8 Settings（src/pages/Settings.tsx，14 个 Section）
| Section | 主要入口 | 触发 taskAPI |
|---|---|---|
| 账户 | 资料/自定义字段/密码/切换/删除账户 | db.userProfiles.* |
| 外观 | 主题选择+预览卡 | db.settings.set |
| 日程分类 | 分类增删改 | db.categories.* |
| 数据管理 | 导出全量备份 / 从备份导入 / 完整性检查 | backup.export/import/status |
| 提醒通知 | 开关 | db.settings.set |
| 番茄钟 | 时长 | db.settings.set |
| WebDAV 云同步 | url/user/pass、测试、上传、恢复 | webdav.config/save/test/push/remoteInfo/pull |
| 自动清理&回收站 | 规则/立即清理/恢复/彻底删除 | cleanup.rules/setRules/run/bin/restore/purge |
| 课表导入 (Excel) | 打开向导、上次导入时间 | xls.lastImport + XlsImportWizard |
| 月卡与付费 | 兑换码 | billing.redeemMonthly / status |
| 软件更新 | 源管理/置主/自动检查/检查/下载/安装/跳过/补丁卡片 | updater.* |
| 作业同步 | 发布人昵称 | homework.config/saveAuth |
| 输入诊断 | DiagPanel | diag.peek/export |
| 关于 | AboutPanel | about.getCache/refresh/saveLocal/setPinned/openCache |

### 2.9 Class（src/pages/Class/*）
| 入口 | 触发 taskAPI |
|---|---|
| 刷新/配置/加入班级/创建班级 | class.list/config/join/create |
| 班级卡：复制邀请码/离开 | class.leave |
| Detail Tab：总览/公告/接龙/投票/成员 | class.info/listAnnouncements/listChains/listPolls |
| 同步按钮 | class.sync |
| 发布公告/发起接龙/发起投票 | class.publishAnnouncement/createChain/createPoll |
| 公告标记已读/删除 | class.markAnnouncementRead/deleteAnnouncement |
| 接龙参与/关闭 | class.joinChain/closeChain |
| 投票/关闭投票 | class.votePoll/closePoll |
| 成员升/降/移除 | class.promoteMember/removeMember |

### 2.10 HomeworkModals（src/pages/HomeworkModals.tsx）
| 入口 | 触发 taskAPI |
|---|---|
| GenerateCodesModal | homework.generateCodes/listMyCodes |
| PublishHomeworkModal（批量条目） | homework.publish、updater.openExternal |
| ReceiveHomeworkModal（8 位码/候选课/缺课建课） | homework.receive、db.courses.create |

### 2.11 全局壳（Layout/TopBar/PlusMenu/SearchPalette/PomodoroWidget/QuickAdd）
| 入口 | 触发 taskAPI |
|---|---|
| 窗口按钮 最小化/最大化/关闭 | window.* |
| PlusMenu：新建课程/日历事件/项目/作业 | 路由跳转（/courses?action=new 等） |
| SearchPalette | 路由/本地检索 |
| PomodoroWidget FAB+面板 | db.pomodoro.create/stats、db.settings.set |
| Ctrl+Shift+A / 托盘「快速添加」 | system.onQuickAdd |

**第 2 节条目合计：约 95 条用户可见入口**

---

## 3. localStorage 键清单

| 键名 | 定义处 | 用途 |
|---|---|---|
| `tm_crash_log` | src/components/ErrorBoundary.tsx:27 | 崩溃日志环形缓冲（保留最近 10 条） |
| `pomodoro_widget_pos` | src/features/pomodoro/types.ts:32（POS_STORAGE_KEY） | 番茄钟 FAB 停靠位置 |
| `pomodoro_widget_secs` | src/features/pomodoro/PomodoroWidget.tsx:23（SS_STORAGE_KEY） | 番茄钟秒偏移（经 useLocalStorage） |
| `taskmgr.insets.v1` | src/mobile/insets.ts:30（CACHE_KEY） | 移动端安全区 insets 首帧缓存 |
| （通用 hook） | src/hooks/useLocalStorage.ts | 泛型 getItem/setItem，当前唯一调用方为 pomodoro_widget_secs |

**第 3 节条目合计：4 个显式键 + 1 个通用 hook**

---

## 4. 零引用组件基线（import 引用数 = 0）

扫描范围：`src/components/**`、`src/features/**` 的每个文件（去扩展名）在 `src/` + `electron/` 的 import 引用。

| 文件 | 引用数 | 说明 |
|---|---|---|
| src/features/pomodoro/index.ts | **0** | barrel 文件无人 import；外部一律深引用 `features/pomodoro/PomodoroWidget`（经 components/Pomodoro.tsx 壳） |

其余组件均 ≥1 引用（Modal 15+、editor/* 全链、pomodoro 内部全链、Layout/App/Settings 引用的 Sidebar/TopBar/ParticleBg/PlusMenu/SearchPalette/QuickAdd/UpdateNotification/ToastContainer/AboutPanel/DiagPanel/PatchPanel/MobileUpdatePanel/XlsImportWizard/BeikeTimetable/AiChat/ErrorBoundary 等）。

**第 4 节条目合计：1 个零引用文件**

---

## 5. Electron 专属能力

| 文件 | 能力 | 渲染层是否感知 |
|---|---|---|
| electron/main.ts | BrowserWindow（主窗+splash）、shell.openExternal（open handler）、dialog.showErrorBox、globalShortcut(Ctrl+Shift+A)、app 生命周期/quit 行为、tray/notify 装配 | 部分（app.ready / system.onQuickAdd / app.getCloseBehavior） |
| electron/tray.ts | Tray、Menu、nativeImage、tooltip（下一节课/考试/待办数）、双击唤起 | 部分（system.onQuickAdd；tooltip 数据渲染层不可见） |
| electron/notify.ts | Notification、60s 定时器（上课/作业 1h/24h/考试 1d/1h）、点击聚焦窗口 | 否（纯主进程；开关存于 db:settings notify_*） |
| electron/preload.ts / splash-preload.ts | contextBridge 注入 taskAPI | 是（契约本体） |
| electron/updater/* | 下载/安装/补丁（child_process helper、relaunch、process.exit、patch-helper.cjs） | 是（updater.*、patchApplyCached 会触发重启） |
| electron/backup/index.ts | dialog.showSaveDialog/showOpenDialog、app.getPath('userData') | 间接（返回 path/canceled） |
| electron/timetable-xls/index.ts | dialog.showOpenDialog（pickFile） | 间接（xls.pickFile 返回路径） |
| electron/diag/inputDiag.ts | fs 日志、dialog 导出 | 间接（diag.peek/export） |
| electron/about/index.ts | fs 缓存读写、shell.showItemInFolder | 间接（about.*） |
| electron/homework/index.ts | fs JSON 作业包 | 否（文件落地渲染层只见结果字段） |
| electron/class/storage.ts | fs 令牌/manifest | 否 |
| electron/db/index.ts | SQLite（better-sqlite3） | 否（经 db.* 抽象） |
| electron/webdav.ts | 网络 https | 间接（webdav.*） |
| electron/quitState.ts | 关闭行为状态 | 间接（app.get/setCloseBehavior） |
| electron/resources/patch-helper.cjs | 独立进程：fs、process.exit | 间接（patchApplyCached/takeoverSidecar） |

**第 5 节条目合计：15 个能力点**

---

## 疑似被吞 / 契约保留但需人工决策清单

1. **class.listTasks / class.publishTask / class.completeTask** — 契约保留，但 v1.2.9 已删除「作业」tab（ClassDetail.tsx:4），UI 无入口；迁移时若只迁 UI 会静默丢掉这 3 个通道。
2. **homework.verifyCodes / courseSyncCode / remoteEntries** — 渲染层 0 调用，仅 `scripts/e2e-*.js` 使用；确认是否为内部协议还是待接 UI。
3. **db.courses.get / db.projects.get / db.canvases.list|get|update|delete / db.pomodoro.list|stop / db.attendance.stats / db.userProfiles.getByOpenid** — 契约有、渲染层 0 调用。
4. **updater.patchApply / setSource / setActiveSource** — 被 patchApplyCached / setSources 取代的旧通道，易在重构时被当作死代码删除。
5. **backup.makeSafety / about.cachePath / billing.redeemVoucher / billing.syncVouchers** — 渲染层 0 调用。
6. **app.ready** — 以可选链调用（`app?.ready?.()`），若 Tauri 侧未实现则 splash 关闭逻辑会无声失效（历史上属于易吞项）。