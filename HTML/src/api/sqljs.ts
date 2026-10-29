/**
 * sql.js（WASM SQLite）实现 —— 纯浏览器预览，无壳环境。
 * 数据持久化到 localStorage（db.export() → base64），刷新不丢。
 * 云通道走 fetch（受 CORS 限制：SSIO 已放行则可用，USTB 教务不可用 → 明确报错）。
 */
import initSqlJs, { type Database as SqlJsDb } from 'sql.js';
// Vite 会把 wasm 打进产物并用正确 URL 引用（不走 CDN）
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { buildAPI, type TaskAPI } from './api-factory';
import { createInvoke, createSend, type HandlerMap } from './dispatch';
import { createCloudHandlers } from './cloudHandlers';
import { createClassHandlers } from './classHandlers';
import { createUpdaterHandlers } from './updaterHandlers';
import { createSiteHandlers } from './siteHandlers';
import { runMigrations } from './migrations';
import type { PlatformDeps, SqlExecutor, HttpRequest, HttpResponse } from './platform';

const LS_KEY = 'taskmgr_sqljs_db_v1';

function createSqlJsExecutor(db: SqlJsDb): SqlExecutor {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const persist = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const data = db.export();
        let bin = '';
        for (const b of data) bin += String.fromCharCode(b);
        localStorage.setItem(LS_KEY, btoa(bin));
      } catch (e) {
        console.warn('[sqljs] 持久化失败:', e);
      }
    }, 300);
  };
  return {
    async run(sqlStr: string, params: any[] = []) {
      db.run(sqlStr, params as any[]);
      persist();
      return db.getRowsModified();
    },
    async all<T>(sqlStr: string, params: any[] = []) {
      const stmt = db.prepare(sqlStr);
      stmt.bind(params as any[]);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      stmt.free();
      return rows;
    },
    async get<T>(sqlStr: string, params: any[] = []) {
      const stmt = db.prepare(sqlStr);
      stmt.bind(params as any[]);
      let row: T | null = null;
      if (stmt.step()) row = stmt.getAsObject() as T;
      stmt.free();
      return row;
    },
  };
}

export async function createSqljsApi(extraHandlers: HandlerMap = {}): Promise<TaskAPI> {
  // ⚠ wasm 必须本地打包：以前从 jsdelivr CDN 拉，国内拉不到 → 初始化失败 →
  // 静默降级 mock「演示模式」（预览里看到的假数据就是这个原因）。
  // 注意用 wasmBinary 而不是 locateFile：Vite 预打包 CJS 版 sql.js 时，
  // locateFile 的路径解析在浏览器里不可靠（会 404 → 再次掉进 mock）。
  let wasmBinary: ArrayBuffer | undefined;
  try {
    const resp = await fetch(sqlWasmUrl);
    if (!resp.ok) throw new Error(`wasm HTTP ${resp.status}`);
    wasmBinary = await resp.arrayBuffer();
  } catch (e) {
    console.error('[sqljs] wasm 加载失败:', sqlWasmUrl, e);
    throw e;
  }
  const SQL = await initSqlJs({ wasmBinary });
  let db: SqlJsDb;
  const saved = localStorage.getItem(LS_KEY);
  if (saved) {
    try {
      const bin = atob(saved);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      db = new SQL.Database(arr);
    } catch {
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }
  const sql = createSqlJsExecutor(db);
  await runMigrations(sql);

  const deps: PlatformDeps = {
    sql,
    async http(req: HttpRequest): Promise<HttpResponse> {
      const res = await fetch(req.url, {
        method: req.method || 'GET',
        headers: req.headers,
        body: typeof req.body === 'string' ? req.body : undefined,
        redirect: req.followRedirect === false ? 'manual' : 'follow',
      });
      // 同样只能消费一次：先缓冲，再按需返回（否则图片响应第二次读取直接抛错）
      const buf = await res.arrayBuffer();
      return {
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        bodyText: async () => new TextDecoder().decode(buf),
        bodyBytes: async () => new Uint8Array(buf),
      };
    },
    async pickFile() {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.onchange = () => resolve(input.files?.[0]?.name ?? null);
        input.click();
      });
    },
    async saveFile() {
      return null; // 浏览器降级：调用方应改走下载
    },
    async readFile() { throw new Error('浏览器预览不支持读任意路径'); },
    async writeFile() { throw new Error('浏览器预览不支持写任意路径'); },
    async notify(title, body) {
      try { new Notification(title, { body }); } catch { /* 权限拒绝忽略 */ }
    },
    async openExternal(url) { window.open(url, '_blank'); },
    async showInFolder() { /* noop */ },
    async appInfo() {
      return { name: 'StarTasks', version: (globalThis as any).__TASKMANAGER_VERSION__ || 'dev', platform: 'browser', packaged: false };
    },
    async windowMin() {}, async windowMax() {}, async windowClose() {}, windowIsMax: async () => false,
    subscribe(channel, cb) {
      const fn = (e: Event) => cb((e as CustomEvent).detail);
      window.addEventListener(channel, fn);
      return () => window.removeEventListener(channel, fn);
    },
  };

  const invoke = createInvoke(deps, { ...createCloudHandlers(deps), ...createClassHandlers(deps), ...createUpdaterHandlers(), ...createSiteHandlers(deps), ...extraHandlers });
  return buildAPI(invoke, createSend(deps), deps.subscribe);
}
