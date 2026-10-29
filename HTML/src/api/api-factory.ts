/**
 * taskAPI 工厂 —— 桌面 preload 与移动端 shim 共用的 API 定义。
 *
 * 本文件不得 import 'electron' 或任何 Node 内置模块：
 * - 桌面：electron/preload.ts 用 contextBridge + ipcRenderer 注入
 * - 移动：src/mobile/bootstrap.ts 用同进程的 ipcMain handler 表直调
 */

/** 更新源（v1.1.4：type='anyshare' 为北科云盘外链源，password 是提取码） */
export type UpdateSourceDTO = {
  name: string;
  url: string;
  enabled: boolean;
  primary: boolean;
  /** v1.2.15：'anyshare'（北科云盘）已随通道下线；'ssio' = 自托管 SSIO 发行服务 */
  type?: 'ssio' | 'http';
  password?: string;
};

// ===== 课表导入（v1.2.17：按「学校档案」解析）=====

/** 一份课表解析档案。不同学校的教务导出格式完全不同，所以让用户在向导里选自己学校 */
export type XlsProfileDTO = {
  id: string;
  name: string;
  /** 'grid' = 格子表（行=节次、列=星期）；'records' = 一行一节课 */
  layout: 'grid' | 'records';
  note?: string;
};

export type XlsFieldMappingDTO = {
  className: number;
  teacher: number;
  weeks: number;
  day: number;
  period: number;
  location: number;
};

export type XlsItemDTO = {
  day: number;
  period: number;
  className: string;
  teacher: string;
  weeksText: string;
  weeks: number[];
  location: string;
  periodName: string;
};

export type XlsParseResultDTO = {
  sheetName: string;
  /** 实际使用的档案 */
  profile: XlsProfileDTO;
  /** 自动猜测的结果（>=85 才自动选中，否则让用户手选） */
  detected: { id: string; confidence: number };
  /** 格子表档案不需要「列映射」这一步 */
  needMapping: boolean;
  headers: string[];
  rows: Record<string, string>[];
  totalRows: number;
  mapping: XlsFieldMappingDTO;
  preview: XlsItemDTO[];
  items: XlsItemDTO[];
  warnings: string[];
  badRows: { row: number; reason: string }[];
  /** 从文件里读出的学期信息（向导据此预填，用户仍可改） */
  term?: { xn: string; xq: '1' | '2'; semesterStart?: number; totalWeeks?: number };
};

/** v1.3.0：补丁持久缓存状态（zip + patch-info.json） */
export type PatchCacheStateDTO = {
  exists: boolean;  info?: {
    fromVersion: string;
    toVersion: string;
    sha256: string;
    size: number;
    baseAsarSha256: string;
    appAsarSha256: string;
    downloadedAt: number;
    zipPath: string;
  };
  zipOk?: boolean | null;
};

export type Invoke = (channel: string, ...args: any[]) => Promise<any>;
export type Send = (channel: string, ...args: any[]) => void;
/** 订阅主进程 → 渲染层事件；返回取消订阅函数 */
export type Subscribe = (channel: string, cb: (payload: any) => void) => () => void;

export function buildAPI(invoke: Invoke, send: Send, subscribe?: Subscribe) {
  const api = {
    // 窗口
    window: {
      minimize: () => invoke('window:minimize'),
      maximize: () => invoke('window:maximize'),
      close: () => invoke('window:close'),
      isMaximized: () => invoke('window:isMaximized') as Promise<boolean>,
    },
    // 数据库（统一封装）
    db: {
      courses: {
        list: () => invoke('db:courses:list'),
        get: (id: number) => invoke('db:courses:get', id),
        create: (data: any) => invoke('db:courses:create', data),
        update: (id: number, data: any) => invoke('db:courses:update', id, data),
        delete: (id: number) => invoke('db:courses:delete', id),
      },
      requirements: {
        list: (filter?: any) => invoke('db:requirements:list', filter),
        create: (data: any) => invoke('db:requirements:create', data),
        update: (id: number, data: any) => invoke('db:requirements:update', id, data),
        delete: (id: number) => invoke('db:requirements:delete', id),
      },
      events: {
        list: (filter?: any) => invoke('db:events:list', filter),
        create: (data: any) => invoke('db:events:create', data),
        update: (id: number, data: any) => invoke('db:events:update', id, data),
        delete: (id: number) => invoke('db:events:delete', id),
      },
      categories: {
        list: () => invoke('db:categories:list'),
        create: (data: any) => invoke('db:categories:create', data),
        update: (id: number, data: any) => invoke('db:categories:update', id, data),
        delete: (id: number) => invoke('db:categories:delete', id),
      },
      userProfiles: {
        list: () => invoke('db:userProfiles:list'),
        getActive: () => invoke('db:userProfiles:getActive'),
        getByOpenid: (openid: string) => invoke('db:userProfiles:getByOpenid', openid),
        create: (data: any) => invoke('db:userProfiles:create', data),
        update: (id: number, data: any) => invoke('db:userProfiles:update', id, data),
        delete: (id: number) => invoke('db:userProfiles:delete', id),
        setActive: (id: number) => invoke('db:userProfiles:setActive', id),
      },
      courseNotes: {
        list: (courseId: number) => invoke('db:courseNotes:list', courseId),
        create: (data: any) => invoke('db:courseNotes:create', data),
        update: (id: number, data: any) => invoke('db:courseNotes:update', id, data),
        delete: (id: number) => invoke('db:courseNotes:delete', id),
      },
      // v1.2.10：db.miniPrograms 命名空间随小程序模块一并移除
      projects: {
        list: () => invoke('db:projects:list'),
        get: (id: number) => invoke('db:projects:get', id),
        create: (data: any) => invoke('db:projects:create', data),
        update: (id: number, data: any) => invoke('db:projects:update', id, data),
        delete: (id: number) => invoke('db:projects:delete', id),
      },
      tasks: {
        list: (filter?: any) => invoke('db:tasks:list', filter),
        create: (data: any) => invoke('db:tasks:create', data),
        update: (id: number, data: any) => invoke('db:tasks:update', id, data),
        delete: (id: number) => invoke('db:tasks:delete', id),
      },
      // v1.2.1 画布编辑器（与现有 projects/tasks 完全独立的新模块）
      canvases: {
        list: () => invoke('db:canvases:list'),
        get: (id: number) => invoke('db:canvases:get', id),
        /** v1.3.0：画布并入项目 —— 按项目取画布 */
        getByProject: (projectId: number) => invoke('db:canvases:getByProject', projectId),
        create: (data: any) => invoke('db:canvases:create', data),
        update: (id: number, data: any) => invoke('db:canvases:update', id, data),
        delete: (id: number) => invoke('db:canvases:delete', id),
      },
      canvasNodes: {
        listByCanvas: (canvasId: number) => invoke('db:canvasNodes:listByCanvas', canvasId),
        create: (data: any) => invoke('db:canvasNodes:create', data),
        update: (id: number, data: any) => invoke('db:canvasNodes:update', id, data),
        /** 拖拽过程中批量更新坐标（一次 IPC 写多条） */
        updatePositions: (batch: Array<{ id: number; pos_x: number; pos_y: number }>) =>
          invoke('db:canvasNodes:updatePositions', batch),
        delete: (id: number) => invoke('db:canvasNodes:delete', id),
      },
      canvasEdges: {
        listByCanvas: (canvasId: number) => invoke('db:canvasEdges:listByCanvas', canvasId),
        create: (data: any) => invoke('db:canvasEdges:create', data),
        update: (id: number, data: any) => invoke('db:canvasEdges:update', id, data),
        delete: (id: number) => invoke('db:canvasEdges:delete', id),
      },
      settings: {
        getAll: () => invoke('db:settings:getAll'),
        set: (key: string, value: string) => invoke('db:settings:set', key, value),
      },
      stats: {
        dashboard: () => invoke('db:stats:dashboard'),
        /** v1.2.3：周报 / 月报聚合（时间范围毫秒时间戳） */
        report: (from: number, to: number) => invoke('db:stats:report', from, to) as Promise<{
          reqDoneByDay: Array<{ day: string; n: number }>;
          reqDoneByCourse: Array<{ courseId: number; courseName: string | null; courseColor: string | null; n: number }>;
          habitCheckinsByDay: Array<{ day: string; n: number }>;
          attendanceSummary: Record<string, number>;
          range: { from: number; to: number };
        }>,
      },
      // ── v1.2.3 新模块 ──
      grades: {
        list: (filter?: { semester?: string; courseId?: number }) => invoke('db:grades:list', filter),
        create: (data: any) => invoke('db:grades:create', data),
        update: (id: number, data: any) => invoke('db:grades:update', id, data),
        delete: (id: number) => invoke('db:grades:delete', id),
      },
      exams: {
        list: (filter?: { status?: string }) => invoke('db:exams:list', filter),
        create: (data: any) => invoke('db:exams:create', data),
        update: (id: number, data: any) => invoke('db:exams:update', id, data),
        delete: (id: number) => invoke('db:exams:delete', id),
      },
      pomodoro: {
        list: (filter?: { from?: number; to?: number; courseId?: number }) => invoke('db:pomodoro:list', filter),
        create: (data: any) => invoke('db:pomodoro:create', data),
        stop: (id: number, minutes: number) => invoke('db:pomodoro:stop', id, minutes),
        stats: (from: number, to: number) => invoke('db:pomodoro:stats', from, to) as Promise<{
          byDay: Array<{ day: string; minutes: number; sessions: number }>;
          byCourse: Array<{ courseId: number; courseName: string | null; courseColor: string | null; minutes: number; sessions: number }>;
        }>,
      },
      habits: {
        list: () => invoke('db:habits:list') as Promise<Array<{ id: number; name: string; emoji: string; color: string; frequency: string; target_per_week: number | null; archived: number; sort_order: number; created_at: number; checkinDates: string[] }>>,
        create: (data: any) => invoke('db:habits:create', data),
        update: (id: number, data: any) => invoke('db:habits:update', id, data),
        delete: (id: number) => invoke('db:habits:delete', id),
        toggleCheckin: (habitId: number, date: string) => invoke('db:habits:toggleCheckin', habitId, date) as Promise<{ ok: boolean; checked: boolean }>,
      },
      attendance: {
        list: (filter?: { courseId?: number }) => invoke('db:attendance:list', filter),
        upsert: (data: { course_id: number; date: string; status: string; note?: string }) => invoke('db:attendance:upsert', data),
        stats: (courseId?: number) => invoke('db:attendance:stats', courseId) as Promise<Record<string, number>>,
      },
      /** 学业增强（002）：培养方案学分要求 */
      studyPlan: {
        list: () => invoke('db:studyPlan:list') as Promise<Array<{ category: string; required_credit: number; note?: string | null }>>,
        save: (rows: Array<{ category: string; required_credit: number; note?: string | null }>) =>
          invoke('db:studyPlan:save', rows) as Promise<{ ok: boolean }>,
      },
      /** 学业增强（002）：学期排名记录 */
      ranks: {
        list: () => invoke('db:ranks:list'),
        create: (data: { semester: string; rank?: number | null; total?: number | null; gpa?: number | null; note?: string | null }) =>
          invoke('db:ranks:create', data),
        delete: (id: number) => invoke('db:ranks:delete', id),
      },
    },
    // v1.2.10：miniprogram 命名空间已移除（微信小程序嵌套从未真正启用）
    // 贝壳课表（USTB SSO 扫码登录 + BYYT 教务课表导入）
    ustb: {
      status: () => invoke('ustb:status'),
      qrStart: () => invoke('ustb:qr:start') as Promise<{
        ok?: boolean; error?: string; sessionId: string; qrImage: string; qr?: string;
      }>,
      qrPoll: (sessionId: string) => invoke('ustb:qr:poll', sessionId) as Promise<{ status: string; user?: { name: string; school: string; userId: string }; message?: string }>,
      qrCancel: (sessionId: string) => invoke('ustb:qr:cancel', sessionId),
      preview: (term: { xn: string; xq: string }) => invoke('ustb:preview', term),
      import: (opts: { xn: string; xq: string; semesterStart: number }) => invoke('ustb:import', opts) as Promise<{
        courses: number; events: number; items: number; warnings: string[];
        weekHint?: number | null; semesterStart?: number;
      }>,
      /** 周次校正：把教务导入的课程整体平移 N 周（±4），修正与校历差一周的错位 */
      shiftWeek: (weeks: number) => invoke('ustb:shiftWeek', weeks) as Promise<{ ok: boolean; shifted: number; weeks: number }>,
      logout: () => invoke('ustb:logout'),
      /** v2：教务成绩同步（xn=学年如 2025-2026，xq='0' 全年） */
      syncGrades: (xn?: string, xq?: string) => invoke('ustb:syncGrades', xn, xq) as Promise<{
        ok: boolean; error?: string; errorCode?: string; imported?: number;
        details?: Array<{ course: string; score: number | null }>;
      }>,
    },
    // ICS 导出
    ics: {
      export: (events: any[]) => invoke('ics:export', events) as Promise<{ ok: boolean; path?: string; count?: number; canceled?: boolean }>,
    },

    /**
     * v1.3.0 AI 助手（P0：只读问答）
     * Key 明文只在主进程，这里只拿到后 4 位；流式内容走 ai:delta / ai:done / ai:error。
     */
    ai: {
      config: {
        get: () => invoke('ai:config:get') as Promise<{
          hasKey: boolean; keyTail: string; insecure: boolean;
          model: string; privacyOn: boolean; baseUrl: string;
        }>,
        save: (patch: { key?: string; model?: string; privacyOn?: boolean; baseUrl?: string }) =>
          invoke('ai:config:save', patch) as Promise<{
            hasKey: boolean; keyTail: string; insecure: boolean;
            model: string; privacyOn: boolean; baseUrl: string;
          }>,
      },
      test: () => invoke('ai:test') as Promise<{ ok: boolean; models: string[]; message: string }>,
      /** 透明性：查看「这一次会把什么发出去」 */
      snapshot: () => invoke('ai:snapshot') as Promise<{
        text: string; tokens: number;
        stats: { courses: number; requirements: number; exams: number; events: number; tasks: number; chars: number; truncated: boolean };
      }>,
      chat: (payload: { requestId: string; messages: Array<{ role: 'user' | 'assistant'; content: string }> }) =>
        invoke('ai:chat', payload) as Promise<{ started: boolean }>,
      cancel: (requestId: string) => invoke('ai:cancel', requestId) as Promise<boolean>,
      /** P2：动作预演（不写库），返回「改前 → 改后」给确认卡片展示 */
      plan: (action: any) => invoke('ai:plan', action) as Promise<{
        ok: boolean; kind?: string; message?: string; danger?: boolean;
        target?: { id: number | null; title: string };
        diff?: Array<{ field: string; before: string; after: string }>;
      }>,
      /** P2：撤销删除（30 秒内） */
      undo: (token: string) => invoke('ai:undo', token) as Promise<{ ok: boolean; message: string }>,
      /** P1：确认执行模型建议的动作（create_task / create_event），只有这里会写库 */
      confirm: (action: any) =>
        invoke('ai:confirm', action) as Promise<{
          ok: boolean; kind?: string; id?: number; message: string; courseLabel?: string;
          undo?: { token: string; label: string; seconds: number };
        }>,
      history: {
        get: () => invoke('ai:history:get') as Promise<{ ok: boolean; messages: Array<{ role: 'user' | 'assistant'; content: string }> }>,
        save: (msgs: Array<{ role: 'user' | 'assistant'; content: string }>) => invoke('ai:history:save', msgs) as Promise<{ ok: boolean; count?: number; error?: string }>,
        clear: () => invoke('ai:history:clear') as Promise<{ ok: boolean }>,
      },
      calls: (limit?: number) => invoke('ai:calls', limit) as Promise<Array<{
        ts: number; model: string; prompt_tokens: number; completion_tokens: number;
        charged_tokens: number; balance_after: number; status: string; error_code: string; duration_ms: number;
      }>>,
      onDelta: (cb: (p: { requestId: string; text: string }) => void) => {
        if (subscribe) return subscribe('ai:delta', cb);
        return () => { /* 浏览器环境无此事件 */ };
      },
      onDone: (cb: (p: { requestId: string; usage?: any; tokens: number; stats: any }) => void) => {
        if (subscribe) return subscribe('ai:done', cb);
        return () => { /* 同上 */ };
      },
      onError: (cb: (p: { requestId: string; code: string; message: string; balance?: number; required?: number }) => void) => {
        if (subscribe) return subscribe('ai:error', cb);
        return () => { /* 同上 */ };
      },
      /** P1：模型建议了一个写操作（还没执行，等用户点确认） */
      onAction: (cb: (p: { requestId: string; action: any; cleanText: string }) => void) => {
        if (subscribe) return subscribe('ai:action', cb);
        return () => { /* 同上 */ };
      },
    },

    // 应用信息（版本号等）
    app: {
      info: () => invoke('app:info') as Promise<{
        name: string;
        version: string;
        electron: string;
        platform: string;
        packaged: boolean;
      }>,
      /** v1.1.5：渲染层完成 React mount + store.refreshAll() 后调用，通知主进程关 splash */
      ready: () => send('app:ready-to-show'),
      /** v1.2.15：关闭行为（ask / minimize / quit），点 X 时主进程按它决定问还是直接走 */
      getCloseBehavior: () => invoke('app:getCloseBehavior') as Promise<'ask' | 'minimize' | 'quit'>,
      setCloseBehavior: (v: 'ask' | 'minimize' | 'quit') =>
        invoke('app:setCloseBehavior', v) as Promise<'ask' | 'minimize' | 'quit'>,
    },
    // 软件更新
    updater: {
      config: () => invoke('update:config') as Promise<{
        defaultSources: UpdateSourceDTO[];
        sources: UpdateSourceDTO[];
        activeIndex: number;
        /** 兼容旧字段：当前主源 URL */
        source: string;
        defaultSource: string;
        autoCheck: boolean;
        skippedVersion: string | null;
        lastCheckAt: number;
      }>,
      check: (opts?: { force?: boolean; sourceIndex?: number }) => invoke('update:check', opts),
      /** 查所有启用的源，返回合并结果（每源独立结果 + 版本最高的 winner） */
      checkAll: () => invoke('update:checkAll') as Promise<{
        currentVersion: string;
        ok: boolean;
        anyConfigured: boolean;
        winner: {
          ok: boolean;
          configured: boolean;
          currentVersion: string;
          latestVersion: string | null;
          hasUpdate: boolean;
          notes?: string | null;
          downloadUrl?: string | null;
                /** v1.2.7：备援下载直链（清单里的备选 URL，主源取不到时按顺序试） */
                downloadUrlMirrors?: string[] | null;
                pageUrl?: string | null;
                sha256?: string | null;
          forced?: boolean;
          skipped?: boolean;
          source?: string;
          sourceIndex?: number;
          sourceName?: string;
          checkedAt?: number;
          latencyMs?: number;
          /** v1.3.0：增量补丁清单（优先走补丁更新） */
          patches?: any[] | null;
          asarSize?: number | null;
          size?: number | null;
        } | null;
        perSource: Array<{
          source: UpdateSourceDTO;
          result: {
            ok: boolean;
            configured: boolean;
            currentVersion: string;
            latestVersion: string | null;
            hasUpdate: boolean;
            notes?: string | null;
            downloadUrl?: string | null;
            pageUrl?: string | null;
            sha256?: string | null;
            forced?: boolean;
            skipped?: boolean;
            source?: string;
            sourceIndex?: number;
            sourceName?: string;
            reason?: string;
            message?: string;
            checkedAt?: number;
            latencyMs?: number;
          };
        }>;
        checkedAt: number;
      }>,
      /** v1.1.4：北科云盘源的下载需带上源信息（type/url/password），后端据此换签名直链 */
      download: (opts: { url: string; version: string; sha256?: string | null; source?: UpdateSourceDTO | null; mirrors?: string[] | null }) =>
        invoke('update:download', opts) as Promise<{ ok: boolean; path?: string; size?: number; error?: string; canceled?: boolean; triedMirrors?: string[] }>,
      cancel: () => invoke('update:cancel'),
      /** 安装更新：内容热更忽略 filePath（传空即可）；旧安装包流程传 exe 路径 */
      install: (filePath?: string) => invoke('update:install', filePath) as Promise<{ ok: boolean; error?: string; version?: string }>,
      openExternal: (url: string) => invoke('update:openExternal', url) as Promise<{ ok: boolean; error?: string }>,
      skipVersion: (version: string) => invoke('update:skipVersion', version),
      /** v1.1.6 块 4b：增量补丁相关。renderer 端拿当前 winner + 当前 app.getVersion() 自决 */
      patchPreview: (manifest: any, currentVersion: string) =>
        invoke('update:patch:preview', manifest, currentVersion) as Promise<{
          available: boolean;
          reason?: string;
          patch?: {
            fromVersion: string;
            toVersion: string;
            url: string;
            sha256: string;
            size: number;
            baseAsarSha256: string;
            appAsarSha256: string;
          };
          sizeMB?: number;
          fullSizeMB?: number;
        }>,
      /** v1.1.6 块 4b：下载补丁 + 启动 helper + 退出主进程 */
      patchApply: (patch: any) =>
        invoke('update:patch:apply', patch) as Promise<{
          ok: boolean;
          error?: string;
          helperPid?: number;
          nextVersion?: string;
        }>,
      /** v1.1.6 块 4b：校验上次补丁是否应用成功（启动时调一次） */
      patchState: () => invoke('update:patch:state') as Promise<{
        applied?: boolean; failed?: boolean; pendingSidecar?: boolean;
        baseline?: { expected: string; actual: string };
        message?: string;
      }>,
      /** v1.3.0：缓存式补丁更新 —— 只下载 zip+json 到 userData/update-cache，不退出 */
      patchDownload: (patch: any) =>
        invoke('update:patch:download', patch) as Promise<{
          ok: boolean;
          error?: string;
          state?: PatchCacheStateDTO;
        }>,
      /** v1.3.0：查询补丁缓存（设置页"已下载的更新"卡片） */
      patchCacheState: () => invoke('update:patch:cacheState') as Promise<PatchCacheStateDTO>,
      /** v1.3.0：应用缓存补丁（校验 → helper → 重启） */
      patchApplyCached: () => invoke('update:patch:applyCached') as Promise<{
        ok: boolean;
        error?: string;
        state?: PatchCacheStateDTO;
        helperPid?: number;
      }>,
      /** v1.3.0：清空补丁缓存 */
      patchClearCache: () => invoke('update:patch:clearCache') as Promise<{ ok: boolean }>,
      /** v1.2.7：用户主动接管 .new 旁路（PatchStateCard 重试按钮触发），主进程会退出 */
      patchTakeoverSidecar: () => invoke('update:patch:takeoverSidecar') as Promise<{
        ok: boolean; error?: string; helperPid?: number;
      }>,
      /** 兼容旧 API：用单源替换（保留旧行为） */
      setSource: (source: string) => invoke('update:setSource', source) as Promise<{ ok: boolean; source: string; sources: UpdateSourceDTO[] }>,
      /** 新 API：整体保存多源 + 切换主源 */
      setSources: (payload: {
        sources: UpdateSourceDTO[];
        activeIndex: number;
      }) => invoke('update:setSources', payload) as Promise<{ ok: boolean; sources: UpdateSourceDTO[]; activeIndex: number }>,
      /** 仅切换激活的主源（不动其他配置） */
      setActiveSource: (index: number) => invoke('update:setActiveSource', index) as Promise<{ ok: boolean; activeIndex: number; sources: UpdateSourceDTO[] }>,
      setAutoCheck: (enabled: boolean) => invoke('update:setAutoCheck', enabled) as Promise<{ ok: boolean; enabled: boolean }>,
      /** 订阅下载进度，返回取消订阅函数 */
      onProgress: (cb: (p: any) => void) => {
        if (subscribe) return subscribe('update:progress', cb);
        return () => { /* 桌面端由 preload 提供 */ };
      },
      /** 订阅「启动时发现新版本」推送，返回取消订阅函数 */
      onAvailable: (cb: (r: any) => void) => {
        if (subscribe) return subscribe('update:available', cb);
        return () => { /* 桌面端由 preload 提供 */ };
      },
    },
    // 作业发布 / 接收（码制协议：作业包 = homework/<syncCode>.json）
    // v1.2.15：后端只剩 SSIO —— GitHub 令牌与北科云盘源的配置项（saveCloud / tokenSet /
    // cloud）随通道一起下线，saveAuth 只负责「发布人昵称」。
    homework: {
      config: () => invoke('homework:config') as Promise<{
        dir: string; publisher: string; lastSync: number | null;
      }>,
      /** 保存发布人昵称（只存本机；第一个参数保留是为了兼容旧调用方） */
      saveAuth: (_token: string, publisher: string) => invoke('homework:saveAuth', _token, publisher) as Promise<{ ok: boolean }>,
      /** 生成一对新码（同步作业码 + 作业发布码） */
      generateCodes: () => invoke('homework:generateCodes') as Promise<{ ok: boolean; syncCode: string; publishCode: string }>,
      /** v1.2.2：回看已生成的作业码（手动生成历史 + 课程绑定码，同码去重） */
      listMyCodes: () => invoke('homework:listMyCodes') as Promise<{
        ok: boolean;
        codes: Array<{ syncCode: string; publishCode: string; createdAt: number; source: 'generated' | 'course'; courseName?: string }>;
        error?: string;
      }>,
      /** 校验作业发布码（本地 HMAC，无需联网）；通过则返回解析出的同步码 */
      verifyCodes: (publishCode: string) => invoke('homework:verifyCodes', publishCode) as Promise<{ ok: boolean; syncCode?: string }>,
      /** v1.1.3：取某课程对应的同步作业码（首次自动生成）。用作发布时定位远端 bundle */
      courseSyncCode: (courseId: number | null | undefined) => invoke('homework:courseSyncCode', courseId) as Promise<{ ok: boolean; syncCode: string; error?: string }>,
      /** 发布一条作业。publishCode 可选；如未填 syncCode 但传了 courseId，会用该课程持久化的 syncCode（首次自动生成）。
       *  v1.2.17：发布目标（targets / target / perTarget）随 GitHub 与北科云盘通道下线一并移除，
       *  作业只有一个去处：SSIO 云。 */
      publish: (payload: {
        publishCode?: string; syncCode?: string; courseId?: number | null;
        courseName: string; sessionDate: string;
        sessionTime?: string | null;
        /** 单条发布时必填；批量（v1.1.8+）可省，由 entries 提供 */
        title?: string; content?: string;
        type?: string; dueDate?: number | null;
        /** v1.1.8+：批量发布条目；存在时 title/content/type/dueDate 被忽略，每条独立 */
        entries?: Array<{ title: string; content: string; type?: string; sessionDate?: string; sessionTime?: string | null; dueDate?: number | null }>;
      }) => invoke('homework:publish', payload) as Promise<{
        ok: boolean; error?: string;
        entry?: { id: string; title: string; sessionDate: string; publisher: string; updatedAt: number };
        syncCode?: string; bundleCreated?: boolean;
        fileUrl?: string;
        entriesCount?: number;
        /** v1.1.8+：本次实际发布的条目数（批量场景下 >1） */
        entriesPublished?: number;
      }>,
      /** 某个码包在远端已发布的作业 */
      remoteEntries: (syncCode: string) => invoke('homework:remoteEntries', syncCode) as Promise<{
        ok: boolean; error?: string; courseName?: string;
        entries: Array<{ id: string; title: string; sessionDate: string; sessionTime?: string | null; content: string; publisher: string; publishedAt: number; updatedAt: number }>;
      }>,
      /** 按同步作业码接收一个作业包到本地课程；本地缺课程时返回 courseNotFound=true 让前端弹窗询问；
       *  v1.1.6：同名多门课程时返回 courseCandidates 让前端手选，重试时传 chooseCourseId
       *  v1.1.8：perCourse 按课程分组给出精确挂载计数；items 每项加 courseId */
      receive: (syncCode: string, chooseCourseId?: number | null) => invoke('homework:receive', syncCode, chooseCourseId) as Promise<{
        ok: boolean; error?: string; source?: string; syncCode?: string; courseName?: string;
        courseNotFound?: boolean;
        courseCandidates?: Array<{ id: number; name: string; code?: string | null; instructor?: string | null }>;
        entries: number; created: number; updated: number;
        coursesTouched: number; coursesCreated: string[];
        perCourse?: Array<{ courseId: number; courseName: string; entries: number; created: number; updated: number }>;
        items: Array<{ courseId: number; courseName: string; title: string; sessionDate: string; action: 'created' | 'updated' }>;
        syncedAt: number;
        skipped?: Array<{ title: string; courseName: string; reason: string }>;
      }>,
    },
    // v1.1.6 输入诊断（块 3）：探测器上报 + Settings 导出
    diag: {
      /** 探测器触发失灵快照时调用，无返回值（fire & forget）。浏览器环境无 IPC 也能调，但等于 noop */
      append: (snapshot: any) => { send('input:diag:append', snapshot); },
      /** 预览：返回最近 5 条失灵快照（用于 Settings 卡片展示） */
      peek: () => invoke('input:diag:peek') as Promise<{
        ok: boolean;
        path: string;
        byteCount: number;
        recent: Array<{ ts: number; iso: string; reason: string; focusedTag: string; stallCount: number; msSinceLastKeydown: number; appVersion: string }>;
        error?: string;
      }>,
      /** 导出：弹出 save dialog 把 %TMP%/taskmanager-input-diag.log 复制过去 */
      export: () => invoke('input:diag:export') as Promise<{
        ok: boolean; path?: string; canceled?: boolean; byteCount?: number; error?: string;
      }>,
    },
    // 全量备份 / 恢复 / 完整性检查
    backup: {
      export: () => invoke('backup:export') as Promise<{ ok: boolean; path?: string; counts?: Record<string, number>; canceled?: boolean }>,
      /** 云备份：全量 JSON 字符串（供上传） */
      serialize: () => invoke('backup:serialize') as Promise<{ ok: boolean; json?: string; sizeBytes?: number }>,
      /** 云备份：从 JSON 恢复 */
      applyJson: (json: string) => invoke('backup:applyJson', json) as Promise<{ ok: boolean; error?: string; restored?: Record<string, number> }>,
      import: (opts?: { skipSafetyBackup?: boolean }) => invoke('backup:import', opts) as Promise<{
        ok: boolean;
        canceled?: boolean;
        error?: string;
        restored?: Record<string, number>;
        safetyBackupPath?: string;
        source?: string;
      }>,
      status: () => invoke('backup:status') as Promise<{
        integrity: string;
        foreignKeyViolations: number;
        journalMode: string;
        tables: Record<string, number>;
        dbSizeBytes: number;
        lastAutoBackup: string | null;
      }>,
      makeSafety: () => invoke('backup:makeSafety') as Promise<{ ok: boolean; path: string }>,
    },
    // 课表 Excel 导入
    xls: {
      pickFile: () => invoke('xls:pickFile') as Promise<string | null>,
      /** 学校档案列表（渲染层渲染下拉框）；用户选定后把 id 传给 parseFile */
      listProfiles: () => invoke('xls:listProfiles') as Promise<XlsProfileDTO[]>,
      /** profileId 不传 = 后端自动猜（置信度 >=85 才自动选，否则落到通用档案） */
      parseFile: (filePath: string, profileId?: string) =>
        invoke('xls:parseFile', filePath, profileId) as Promise<XlsParseResultDTO>,
      /**
       * v1.2.18：从字节解析（**移动端唯一可用的入口**）。
       * Android 的 dialog.showOpenDialog 在 shim 里直接返回 canceled，选不了文件，
       * 所以那边走渲染层的 <input type="file"> → 字节 → 这里。
       */
      parseBuffer: (buffer: ArrayBuffer, profileId?: string) =>
        invoke('xls:parseBuffer', buffer, profileId) as Promise<XlsParseResultDTO>,
      reparse: (parsed: XlsParseResultDTO, mapping: XlsFieldMappingDTO) =>
        invoke('xls:reparse', parsed, mapping) as Promise<XlsParseResultDTO>,
      importItems: (items: any[], opts: { xn: string; xq: '1' | '2'; semesterStart: number; replaceExisting: boolean }) =>
        invoke('xls:importItems', items, opts) as Promise<{
          courses: number; events: number; items: number; courseIds: number[]; warnings: string[];
        }>,
      lastImport: () => invoke('xls:lastImport') as Promise<{ lastSync: number; courseCount: number }>,
    },
    // 关于文本（about.txt，多源聚合 + 本地缓存）
    about: {
      getCache: () => invoke('about:get-cache') as Promise<{
        text: string;
        source?: string;
        sha256?: string;
        pulledAt?: number;
        pinned: boolean;
        mtimeMs?: number;
      }>,
      refresh: () => invoke('about:refresh') as Promise<{
        ok: boolean;
        source?: string;
        sha256?: string;
        size?: number;
        pulledAt?: number;
        error?: string;
        results: Array<{ source: string; ok: boolean; error?: string; sha256?: string; size?: number }>;
      }>,
      saveLocal: (text: string) => invoke('about:save-local', text) as Promise<{ ok: boolean; sha256?: string; size?: number; error?: string }>,
      setPinned: (pinned: boolean) => invoke('about:set-pinned', pinned) as Promise<{ ok: boolean; pinned: boolean }>,
      cachePath: () => invoke('about:cache-path') as Promise<string>,
      openCache: () => invoke('about:open-cache') as Promise<{ ok: boolean }>,
    },

    /** v1.1.9：自动清理 & 回收站 */
    cleanup: {
      rules: () => invoke('cleanup:rules') as Promise<{
        enabled: boolean;
        reqDays: number;
        taskDays: number;
        eventDays: number;
        projectDays: number;
        homeworkDays: number;
        binDays: number;
      }>,
      setRules: (patch: {
        enabled?: boolean;
        reqDays?: number;
        taskDays?: number;
        eventDays?: number;
        projectDays?: number;
        homeworkDays?: number;
        binDays?: number;
      }) => invoke('cleanup:setRules', patch) as Promise<{
        enabled: boolean;
        reqDays: number;
        taskDays: number;
        eventDays: number;
        projectDays: number;
        homeworkDays: number;
        binDays: number;
      }>,
      run: () => invoke('cleanup:run') as Promise<{
        local: {
          ranAt: number;
          enabled: boolean;
          binned: { requirements: number; tasks: number; events: number; projects: number };
          purgedBin: number;
        };
        cloud: {
          ranAt: number;
          codes: string[];
          /** v1.2.15：云端清理只剩 SSIO，原 github/cloud 两份报告合并为一份 */
          ssio: { checked: number; rewritten: number; deleted: number; removedEntries: number; errors: string[] };
        };
      }>,
      bin: (opts?: { kind?: string; limit?: number }) => invoke('cleanup:bin', opts) as Promise<Array<{
        id: number;
        kind: string;
        entity_id: number | null;
        title: string;
        reason: string | null;
        deleted_at: number;
        purge_at: number;
        snapshot: Record<string, any>;
      }>>,
      restore: (id: number) => invoke('cleanup:bin:restore', id) as Promise<{ ok: boolean; error?: string; newId?: number }>,
      purge: (id?: number | null) => invoke('cleanup:bin:purge', id ?? null) as Promise<{ purged: number }>,
    },

    /** v1.2.3：WebDAV 云同步（坚果云等） */
    webdav: {
      config: () => invoke('webdav:config') as Promise<{ url: string; user: string; hasPass: boolean; configured: boolean }>,
      save: (cfg: { url?: string; user?: string; pass?: string; clearPass?: boolean }) => invoke('webdav:save', cfg) as Promise<{ ok: boolean }>,
      test: () => invoke('webdav:test') as Promise<{ ok: boolean; error?: string; warning?: string }>,
      push: () => invoke('webdav:push') as Promise<{ ok: boolean; size?: number; counts?: Record<string, number>; exportedAt?: number; error?: string }>,
      remoteInfo: () => invoke('webdav:remoteInfo') as Promise<{
        ok: boolean; exists?: boolean; exportedAt?: number; appVersion?: string;
        counts?: Record<string, number>; error?: string;
      }>,
      pull: () => invoke('webdav:pull') as Promise<{
        ok: boolean; restored?: Record<string, number>; safetyBackupPath?: string;
        exportedAt?: number; error?: string;
      }>,
    },

    

        // v1.2.7 起 P2P 班级复活（v1.2.15：后端只剩 SSIO，无任何需要配置的凭据）
    class: {
      config: () => invoke('class:config') as Promise<{
        ok: boolean; localAlias: string;
      }>,
      saveLocalAlias: (alias: string) => invoke('class:saveLocalAlias', alias) as Promise<{ ok: boolean; localAlias?: string; error?: string }>,
      list: () => invoke('class:list') as Promise<{ ok: boolean; classes: any[] }>,
      info: (classId: number) => invoke('class:info', classId) as Promise<{ ok: boolean; [k: string]: any }>,
      create: (payload: { name: string; description?: string; alias?: string; avatarUrl?: string }) => invoke('class:create', payload) as Promise<{
        ok: boolean; warnings?: string[]; error?: string; errorCode?: string; hint?: string;
        id?: number; classCode?: string; inviteCode?: string; ownerToken?: string;
      }>,
      join: (payload: { inviteCode: string; alias?: string; avatarUrl?: string }) => invoke('class:join', payload) as Promise<{
        ok: boolean; error?: string; errorCode?: string;
        classId?: number; className?: string; role?: string; memberCount?: number; warnings?: string[];
      }>,
      /** owner：编辑班级基本信息 */
      updateSettings: (classId: number, payload: { name?: string; description?: string; maxMembers?: number }) =>
        invoke('class:updateSettings', classId, payload) as Promise<{ ok: boolean; error?: string; errorCode?: string; maxMembers?: number }>,
      leave: (classId: number) => invoke('class:leave', classId) as Promise<{ ok: boolean; error?: string }>,
      listAnnouncements: (classId: number) => invoke('class:listAnnouncements', classId) as Promise<{ ok: boolean; announcements: any[] }>,
      listTasks: (classId: number) => invoke('class:listTasks', classId) as Promise<{ ok: boolean; tasks: any[] }>,
      publishAnnouncement: (classId: number, payload: { title: string; body: string }) =>
        invoke('class:publishAnnouncement', classId, payload) as Promise<{ ok: boolean; warnings?: string[]; annId?: number; error?: string }>,
      publishTask: (classId: number, payload: { title: string; body?: string; dueAt?: number }) =>
        invoke('class:publishTask', classId, payload) as Promise<{ ok: boolean; warnings?: string[]; taskId?: number; error?: string }>,
      /** v1.2.9 R2：删除公告（owner/admin；云端文件 + manifest tombstone） */
      deleteAnnouncement: (classId: number, annId: number) =>
        invoke('class:deleteAnnouncement', classId, annId) as Promise<{ ok: boolean; warnings?: string[]; error?: string; errorCode?: string }>,
      /** v1.2.9 R3：成员角色管理（owner 专用：member ↔ admin） */
      promoteMember: (classId: number, payload: { alias: string; role: 'admin' | 'member' }) =>
        invoke('class:promoteMember', classId, payload) as Promise<{ ok: boolean; warnings?: string[]; role?: string; error?: string; errorCode?: string }>,
      /** 改昵称 / 设生日（v2：只能改自己；owner 可传 targetAlias 改任何人） */
      updateProfile: (classId: number, payload: { alias?: string; birthday?: string; targetAlias?: string; avatarUrl?: string }) =>
        invoke('class:updateProfile', classId, payload) as Promise<{ ok: boolean; error?: string; errorCode?: string }>,
      /** v1.2.9 R3：移除成员（owner 可移除任何人除 owner；admin 只能移 member） */
      removeMember: (classId: number, payload: { alias: string }) =>
        invoke('class:removeMember', classId, payload) as Promise<{ ok: boolean; warnings?: string[]; error?: string; errorCode?: string }>,
      /** v1.2.9 R4：接龙 */
      listChains: (classId: number) => invoke('class:listChains', classId) as Promise<{ ok: boolean; chains: any[] }>,
      /** 聊天（v2） */
      listMessages: (classId: number, sinceId?: number) =>
        invoke('class:listMessages', classId, sinceId ?? 0) as Promise<{ ok: boolean; messages?: any[]; error?: string }>,
      sendMessage: (classId: number, payload: { body: string; type?: string; meta?: any }) =>
        invoke('class:sendMessage', classId, payload) as Promise<{ ok: boolean; id?: number; error?: string }>,
      createChain: (classId: number, payload: { title: string; body?: string }) =>
        invoke('class:createChain', classId, payload) as Promise<{ ok: boolean; warnings?: string[]; chainId?: number; error?: string }>,
      joinChain: (classId: number, chainId: number, content: string) =>
        invoke('class:joinChain', classId, chainId, content) as Promise<{ ok: boolean; warnings?: string[]; error?: string; errorCode?: string }>,
      closeChain: (classId: number, chainId: number) =>
        invoke('class:closeChain', classId, chainId) as Promise<{ ok: boolean; warnings?: string[]; error?: string; errorCode?: string }>,
      /** v1.2.9 R5：投票 */
      listPolls: (classId: number) => invoke('class:listPolls', classId) as Promise<{ ok: boolean; polls: any[] }>,
      createPoll: (classId: number, payload: { question: string; description?: string; options: string[]; multi?: boolean; deadlineAt?: number }) =>
        invoke('class:createPoll', classId, payload) as Promise<{ ok: boolean; warnings?: string[]; pollId?: number; error?: string }>,
      votePoll: (classId: number, pollId: number, choices: number[]) =>
        invoke('class:votePoll', classId, pollId, choices) as Promise<{ ok: boolean; warnings?: string[]; error?: string; errorCode?: string }>,
      closePoll: (classId: number, pollId: number) =>
        invoke('class:closePoll', classId, pollId) as Promise<{ ok: boolean; warnings?: string[]; error?: string; errorCode?: string }>,
      markAnnouncementRead: (classId: number, annId: number) =>
        invoke('class:markAnnouncementRead', classId, annId) as Promise<{ ok: boolean }>,
      completeTask: (classId: number, taskId: number, status: 'open' | 'done' | 'cancelled') =>
        invoke('class:completeTask', classId, taskId, status) as Promise<{ ok: boolean }>,
      sync: (classId: number) => invoke('class:sync', classId) as Promise<{
        // v1.2.17：class 的结果不再带 source —— 后端只有一个去处（SSIO），
        // 也没有任何调用方读它（ClassDetail 早就在 UI 上写死了「SSIO 云」）。
        ok: boolean;
        newAnnouncements?: number; newTasks?: number;
        newChains?: number; newPolls?: number;
        kicked?: boolean; errorCode?: string;
        manifest?: any; error?: string;
      }>,
    },

    /** v1.2.3：主进程推送事件（托盘 / 全局快捷键） */
    /** v2：星芒网站账号认证（https://nrsc.games，token 存 localStorage starmain_token） */
    site: {
      login: (username: string, password: string) =>
        invoke('site:login', username, password) as Promise<{ ok: boolean; user?: any; error?: string }>,
      me: () => invoke('site:me') as Promise<{ ok: boolean; user?: any | null; reason?: string }>,
      logout: () => invoke('site:logout') as Promise<{ ok: boolean }>,
      register: (username: string, password: string, email?: string) =>
        invoke('site:register', username, password, email) as Promise<{ ok: boolean; error?: string }>,
      hasToken: () => invoke('site:hasToken') as Promise<{ hasToken: boolean }>,
      /** 一键授权登录（设备授权流） */
      deviceStart: () => invoke('site:deviceStart') as Promise<{
        ok: boolean; error?: string; deviceCode?: string; userCode?: string; url?: string;
      }>,
      devicePoll: (deviceCode: string) => invoke('site:devicePoll', deviceCode) as Promise<{
        ok: boolean; reason?: string; error?: string; user?: any;
      }>,
      /** 权益中心（备份空间/创建班级等按账号授权） */
      entitlements: () => invoke('site:entitlements') as Promise<{
        ok: boolean; error?: string;
        entitlements?: { backup_mb: number; class_create?: string; [k: string]: unknown };
        backup?: { quotaMb: number; usedBytes: number; hasBackup: boolean };
      }>,
      backupPut: (payload: string, appVersion?: string) =>
        invoke('site:backupPut', payload, appVersion) as Promise<{ ok: boolean; error?: string; sizeBytes?: number; quotaMb?: number }>,
      backupGet: () => invoke('site:backupGet') as Promise<{
        ok: boolean; error?: string; reason?: string;
        payload?: string; sizeBytes?: number; updatedAt?: number;
      }>,
      backupDelete: () => invoke('site:backupDelete') as Promise<{ ok: boolean }>,
    },

    system: {
      /** 订阅「呼出快速添加」（Ctrl+Shift+A / 托盘），返回取消订阅函数 */
      onQuickAdd: (cb: () => void) => {
        if (subscribe) return subscribe('app:quickadd', cb);
        return () => { /* 浏览器 / 移动端无此事件 */ };
      },
    },
  };

  return api;
}

export type TaskAPI = ReturnType<typeof buildAPI>;
