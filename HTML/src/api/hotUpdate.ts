/**
 * 内容热更新 —— 取代旧的 asar 补丁系统（patch-helper / patches 清单 / ELECTRON_RUN_AS_NODE 雷区全删）。
 *
 * 模式（借鉴学习助手 PageUpdater，不整目录照抄）：
 *   SSIO 存前端产物清单（SSIO_KEYS.pages = 'taskmgr/pages'）→
 *   Rust 侧拉产物写 App 私有目录 → reload 生效，免重装。
 *   安全：清单带 sha256；保留上一版目录作基线回退；下载失败自动回退。
 *
 * 壳（Tauri 二进制）自身更新走 tauri-plugin-updater（低频），与内容更新分离。
 */
import { kvGetJson, getSsioConfig, SSIO_KEYS } from '../cloud/ssioClient';

export interface PageManifestEntry {
  name: string;      // 如 'index.html' / 'assets/main.js'
  version: number;
  sha256: string;
  size: number;
  fileId: string;    // SSIO storage 文件 id
}

export interface PagesManifest {
  version: string;   // 内容版本（semver 或构建号）
  built: string;     // 构建时间
  pages: PageManifestEntry[];
  minShell?: string; // 壳最低版本要求
}

export interface HotUpdateState {
  current: string | null;
  latest: string | null;
  hasUpdate: boolean;
  lastCheckAt: number | null;
  lastResult: string | null;
}

const STATE_KEY = 'hot_update_state';

/** 版本比较：a>b 返回正数（按 . - 分段数值比较，非语义版本也能用） */
export function compareVersion(a: string, b: string): number {
  const pa = String(a || '').split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '').split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** 拉取内容清单（SSIO KV） */
export async function fetchPagesManifest(): Promise<PagesManifest | null> {
  return kvGetJson<PagesManifest>(SSIO_KEYS.pages);
}

/**
 * 磁盘上真正生效的热更版本（Rust 在 pages/version.txt 里记着）。
 * 这是**权威来源**：应用热更时 invoke 会重载 WebView，JS 上下文当场销毁，
 * 任何"更新后写状态"的代码都可能执行不到 → 之前版本号永远记不住、
 * 每次启动都重复提示同一次更新。以磁盘为准可彻底绕开这个时序问题。
 */
export async function appliedHotVersion(): Promise<string | null> {
  try {
    const w = (globalThis as any).window;
    const invoke = w?.__TAURI_INTERNALS__?.invoke || w?.__TAURI__?.invoke;
    if (!invoke) return null;
    const v = await invoke('hot_update_version');
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/**
 * 检查内容更新（渲染层入口；实际写盘走壳命令 hot_update_apply）。
 * 浏览器预览环境无壳命令 → 返回 hasUpdate 但 apply 时明确报错。
 */
export async function checkHotUpdate(shellVersion: string): Promise<{
  ok: boolean; hasUpdate: boolean; manifest?: PagesManifest; error?: string; appliedVersion?: string | null;
}> {
  try {
    const m = await fetchPagesManifest();
    if (!m?.pages?.length) return { ok: true, hasUpdate: false };
    const state = await getState();
    // 以磁盘 version.txt 为准（JS 存的状态可能因重载丢失）；磁盘没有才用记录/壳版本
    const diskVersion = await appliedHotVersion();
    if (diskVersion && diskVersion !== state.current) await saveState({ current: diskVersion });
    // ⚠ 必须比大小而不是「不相等」：线上内容版本可能比当前壳还旧（例如壳 2.0.15、
    // 线上内容仍停在 2.0.7），用 !== 就会把旧版本当新版本提示「发现新版本 v2.0.7」。
    const baseline = diskVersion || state.current || shellVersion;
    const hasUpdate = baseline ? compareVersion(m.version, baseline) > 0 : true;
    return { ok: true, hasUpdate, manifest: m, appliedVersion: diskVersion || state.current };
  } catch (e: any) {
    return { ok: false, hasUpdate: false, error: e?.message || String(e) };
  }
}

/**
 * 应用热更新：下载全部产物 → 校验 sha256 → 写入壳私有目录 → 记录基线 → reload。
 * Tauri 环境调 Rust 命令 hot_update_apply（见 src-tauri/src/hot_update.rs）；
 * 非 Tauri 返回明确错误。
 */
export async function applyHotUpdate(manifest: PagesManifest): Promise<{ ok: boolean; error?: string }> {
  const w = (globalThis as any).window;
  const invoke = w?.__TAURI_INTERNALS__?.invoke || w?.__TAURI__?.invoke;
  if (!invoke) return { ok: false, error: '热更新需要桌面/Android 壳环境' };
  try {
    const { apiKey } = getSsioConfig();
    if (!apiKey) return { ok: false, error: 'SSIO 应用 Key 未配置，无法下载内容' };
    const prev = (await getState()).current;
    // ⚠ 必须先记版本再调命令：hot_update_apply 内部会 navigate 重载 WebView，
    // JS 上下文当场销毁 → 写在 invoke 之后的 saveState 永远执行不到 →
    // 「已应用版本」永远是空 → 每次启动都重复提示同一次更新（实测）。
    await saveState({ current: manifest.version, lastResult: 'applying' });
    try {
      const r = await invoke('hot_update_apply', {
        version: manifest.version,
        apiKey,
        pages: manifest.pages.map((p) => ({ name: p.name, fileId: p.fileId, sha256: p.sha256, size: p.size })),
      });
      // 页面即将重载，这行通常执行不到；执行到了也无害
      void saveState({ lastResult: 'applied' });
      return { ok: true, ...r };
    } catch (e) {
      // 失败没重载，这里能正常回滚版本号
      await saveState({ current: prev, lastResult: 'failed' });
      throw e;
    }
  } catch (e: any) {
    await saveState({ lastResult: 'failed: ' + (e?.message || e) });
    return { ok: false, error: e?.message || String(e) };
  }
}

/** 回退到上一版基线（壳命令） */
export async function rollbackHotUpdate(): Promise<{ ok: boolean; error?: string }> {
  const w = (globalThis as any).window;
  const invoke = w?.__TAURI_INTERNALS__?.invoke || w?.__TAURI__?.invoke;
  if (!invoke) return { ok: false, error: '需要壳环境' };
  try {
    await invoke('hot_update_rollback');
    await saveState({ lastResult: 'rolled-back' });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * 热更状态优先存 SQLite settings。
 * 原因：应用热更后 WebView 会切到 sthot:// 源，**localStorage 换命名空间**，
 * 存在里面的「已应用内容版本」会丢失 → 下次启动又把同一版本当新版本提示（更新死循环）。
 */
async function getState(): Promise<HotUpdateState> {
  try {
    const all = await (window as any)?.taskAPI?.db?.settings?.getAll?.();
    const raw = all?.hot_update_state;
    if (raw) return JSON.parse(raw);
  } catch { /* 壳环境不可用则退回 localStorage */ }
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { current: null, latest: null, hasUpdate: false, lastCheckAt: null, lastResult: null };
}

async function saveState(patch: Partial<HotUpdateState>): Promise<void> {
  const s = await getState();
  Object.assign(s, patch, { lastCheckAt: Date.now() });
  const json = JSON.stringify(s);
  try { await (window as any)?.taskAPI?.db?.settings?.set?.('hot_update_state', json); } catch { /* noop */ }
  try { localStorage.setItem(STATE_KEY, json); } catch { /* noop */ }
}
