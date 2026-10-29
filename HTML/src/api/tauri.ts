/**
 * Tauri 2 实现 —— PlatformDeps 全量落地（桌面 Windows / Android 同一工程）。
 *
 * - sql   → @tauri-apps/plugin-sql（Rust 侧 SQLite，30+ 表结构见 migrations/）
 * - http  → @tauri-apps/plugin-http（Rust reqwest，**不受 CORS 限制**，USTB/SSIO 直连）
 * - fs    → @tauri-apps/plugin-fs + plugin-dialog
 * - notify→ @tauri-apps/plugin-notification
 * - 窗口  → @tauri-apps/api/window
 * - 事件  → @tauri-apps/api/event（subscribe 型通道：ai:delta / update:progress 等）
 */
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen, emit } from '@tauri-apps/api/event';
import Database from '@tauri-apps/plugin-sql';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { readTextFile, writeTextFile, readFile, writeFile } from '@tauri-apps/plugin-fs';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { sendNotification } from '@tauri-apps/plugin-notification';
import { openUrl } from '@tauri-apps/plugin-opener';
import { buildAPI, type TaskAPI } from './api-factory';
import { createInvoke, createSend, type HandlerMap } from './dispatch';
import { createCloudHandlers } from './cloudHandlers';
import { createClassHandlers } from './classHandlers';
import { createUpdaterHandlers } from './updaterHandlers';
import { createSiteHandlers } from './siteHandlers';
import type { PlatformDeps, SqlExecutor, HttpRequest, HttpResponse } from './platform';
import { runMigrations } from './migrations';

function createSqlExecutor(db: Database): SqlExecutor {
  return {
    async run(sql, params = []) {
      const r = await db.execute(sql, params as any[]);
      return r.rowsAffected ?? 0;
    },
    all<T>(sql: string, params: any[] = []) {
      return db.select<T[]>(sql, params as any[]);
    },
    async get<T>(sql: string, params: any[] = []) {
      const rows = await db.select<T[]>(sql, params as any[]);
      return rows[0] ?? null;
    },
  };
}

/**
 * ⚠ Response body 只能消费一次：以前 bodyText/bodyBytes 各自惰性读同一个 Response，
 * 第二次必然抛错被吞成空值 → 图片类响应（教务二维码 PNG）拿到的字节是空的 → 白块。
 * 这里先读一次到缓冲，两个方法都从缓冲返回。
 */
function toHttpResponse(res: Response, buf: ArrayBuffer): HttpResponse {
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    bodyText: async () => new TextDecoder().decode(buf),
    bodyBytes: async () => new Uint8Array(buf),
  };
}

export async function createTauriApi(extraHandlers: HandlerMap = {}): Promise<TaskAPI> {
  // ⚠ 必须用 load：Database.get 只取已有句柄、不会真正打开数据库，
  // 在没配 preload 时会返回空壳连接，所有查询都报 "database ... not loaded"（2.0.7 实测）。
  const db = await Database.load('sqlite:taskmanager.db');
  const sql = createSqlExecutor(db);
  await runMigrations(sql);

  const deps: PlatformDeps = {
    sql,
    async http(req: HttpRequest): Promise<HttpResponse> {
      const res = await tauriFetch(req.url, {
        method: (req.method || 'GET') as any,
        headers: req.headers,
        body: req.body as any,
        // ⚠ plugin-http 不支持标准 fetch 的 redirect:'manual'（只认 Rust ClientOptions）。
        // 之前写成 redirect:'manual' 被静默忽略 → reqwest 自动跟随 302 → 拿到落地页 200，
        // 教务扫码「必须是 3xx」的判断必然失败（表现为被吞成「会话不存在」）。
        // 正确做法：followRedirect:false 时用 maxRedirections: 0。
        ...(req.followRedirect === false ? { maxRedirections: 0 } : {}),
        // plugin-http 无 per-request timeout 参数，超时由调用方 AbortController 管
      } as any);
      const buf = await res.arrayBuffer();
      return toHttpResponse(res, buf);
    },
    async pickFile(opts) {
      const p = await openDialog({ multiple: false, filters: opts?.filters });
      return (p as string) ?? null;
    },
    async saveFile(opts) {
      const p = await saveDialog({ defaultPath: opts?.defaultName });
      return (p as string) ?? null;
    },
    async readFile(path) {
      return await readFile(path);
    },
    async writeFile(path, data) {
      if (typeof data === 'string') await writeTextFile(path, data);
      else await writeFile(path, data);
    },
    async notify(title, body) {
      sendNotification({ title, body });
    },
    async openExternal(url) {
      await openUrl(url);
    },
    async showInFolder(path) {
      await tauriInvoke('plugin:opener|reveal_item_in_dir', { path });
    },
    async appInfo() {
      const info = await tauriInvoke<any>('app_info');
      return info;
    },
    async windowMin() { await getCurrentWindow().minimize(); },
    async windowMax() { await getCurrentWindow().toggleMaximize(); },
    async windowClose() {
      const win = getCurrentWindow();
      // 界面上的 ✕ 必须真的能关：close() 会触发 onCloseRequested 拦截，
      // 一旦拦截后前端没弹窗（历史 bug）就永远关不掉。这里按设置处理，
      // 需要退出时直接用 destroy() 绕过拦截。
      try {
        const row = await sql.get<{ value: string }>('SELECT value FROM settings WHERE key=?', ['close_behavior']);
        if (row?.value === 'minimize') { await win.minimize(); return; }
      } catch { /* 读不到设置就按退出处理 */ }
      // destroy 绕过 onclose 拦截；万一被 ACL 拒绝（缺 core:window:allow-destroy），
      // 退回 close()；还失败就抛明确错误给界面提示，不再静默
      try {
        await win.destroy();
      } catch (e1: any) {
        try {
          await win.close();
        } catch (e2: any) {
          throw new Error(`关闭窗口被拒绝（${e2?.message || e2 || e1?.message || e1}）—— 检查 capabilities 是否包含 core:window:allow-destroy / allow-close`);
        }
      }
    },
    windowIsMax() { return getCurrentWindow().isMaximized(); },
    subscribe(channel, cb) {
      const un = listen(channel, (e) => cb((e as any).payload));
      return () => { un.then((f) => f()); };
    },
  };

  const invoke = createInvoke(deps, {
    // ===== 通知 =====
    'notify:send': async (title: string, body?: string) => {
      await deps.notify(title, body);
      return { ok: true };
    },
    // ===== 云命名空间（homework/ai/ustb/xls/about/cleanup/class/site）=====
    ...createCloudHandlers(deps),
    ...createClassHandlers(deps),
    ...createSiteHandlers(deps),
    // ===== updater（内容热更新）=====
    ...createUpdaterHandlers(),
    ...extraHandlers,
  });

  // 关闭行为（ask/minimize/quit）：拦截窗口关闭请求，按 settings 里的 close_behavior
  try {
    const win = getCurrentWindow();
    await win.onCloseRequested(async (e) => {
      let mode = 'quit';
      try {
        const row = await sql.get<{ value: string }>('SELECT value FROM settings WHERE key=?', ['close_behavior']);
        // 默认「直接退出」：旧默认 'ask' 依赖前端弹窗，前端没监听时窗口就永远关不掉（实测卡死）
        mode = row?.value || 'quit';
      } catch { /* 读不到设置也必须能关窗 */ }
      if (mode === 'quit') return; // 放行关闭
      e.preventDefault();
      if (mode === 'minimize') {
        await win.minimize();
        return;
      }
      // ask：通知前端弹确认（Layout 里监听并弹窗）
      emit('app:close-requested', {});
    });
  } catch { /* 非 Tauri 窗口环境忽略 */ }
  const send = createSend(deps);
  const subscribe = (channel: string, cb: (payload: any) => void) => deps.subscribe(channel, cb);

  // 事件重发桥：Rust 侧 emit 的通道原样透传（ai:delta 等）
  return buildAPI(invoke, send, subscribe);
}

/** Rust 侧可调用的 emit（如托盘快速添加 → app:quickadd） */
export { emit };
export type { TaskAPI };
