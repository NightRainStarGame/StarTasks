/**
 * SSIO 统一客户端（CloudGateway 的传输底座）——
 * 作业 KV / 班级 KV / 发行引用 / 资产存储 / 热更新清单 一律走这里。
 *
 * 协议与 electron/cloud/ssioClient.ts **逐字对齐**（KV 是 /v1/kv?key=... + 乐观锁 body，
 * 不是 RESTful 路径；鉴权是 X-API-Key 头，不是 Bearer）。
 * 传输层换成注入式 http（Tauri plugin-http = Rust 侧无 CORS；浏览器 fetch 降级）。
 */
import type { HttpRequest, HttpResponse } from '../api/platform';
import { SSIO_BASE, SSIO_APP_KEY, SSIO_PATHS } from '../config/ssioKeys';

/** 兼容导出：统一真源在 config/ssioKeys.ts（Key 分权与命名规范见该文件头注释） */
export const SSIO_DEFAULT_BASE = SSIO_BASE;
/** 兼容导出（历史名）：应用内置 Key = storage:rw */
export const SSIO_LIVE_READONLY_KEY = SSIO_APP_KEY;

/** KV 键约定（桌面/移动/发版脚本三方共用常量，勿改字面值） */
export const SSIO_KEYS = {
  manifest: SSIO_PATHS.latestManifest,
  pages: SSIO_PATHS.pagesManifest,
  homework: SSIO_PATHS.homework,
  classDir: 'class',
} as const;

export type HttpFn = (req: HttpRequest) => Promise<HttpResponse>;
export type SsioTarget = 'desktop' | 'android';

let httpImpl: HttpFn | null = null;
let baseUrl = SSIO_DEFAULT_BASE;
let apiKey = SSIO_LIVE_READONLY_KEY;

/**
 * v2 安全：发版/全权限 Key 绝不进前端产物。
 * 应用运行时 Key 解析顺序：显式 configureSsio → 构建时 VITE_SSIO_APP_KEY → localStorage 覆盖。
 * 都没配时给出明确错误（而不是静默 401）。
 */
function resolveKey(): string {
  if (apiKey) return apiKey;
  try {
    const k = localStorage.getItem('ssio_app_key');
    if (k) return k;
  } catch { /* 非浏览器环境 */ }
  throw new Error('SSIO 未配置应用 Key（作业同步等云功能不可用）—— 构建时设 VITE_SSIO_APP_KEY，或在 localStorage 写入 ssio_app_key');
}

export function configureSsio(opts: { http: HttpFn; baseUrl?: string; apiKey?: string }): void {
  httpImpl = opts.http;
  if (opts.baseUrl) baseUrl = opts.baseUrl.replace(/\/+$/, '');
  if (opts.apiKey) apiKey = opts.apiKey;
}

export function getSsioConfig(): { baseUrl: string; apiKey: string } {
  let key = apiKey;
  if (!key) { try { key = localStorage.getItem('ssio_app_key') || ''; } catch { /* noop */ } }
  return { baseUrl, apiKey: key };
}

function ensureHttp(): HttpFn {
  if (!httpImpl) throw new Error('SSIO 传输未初始化（先调用 configureSsio）');
  return httpImpl;
}

async function jsonGet(url: string, key: string): Promise<any> {
  const res = await ensureHttp()({ method: 'GET', url, headers: { 'X-API-Key': key }, timeoutMs: 15000 });
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error(`SSIO 请求失败: HTTP ${res.status} ${url}`);
  return JSON.parse(await res.bodyText());
}

async function api(pathname: string, opts: { method: string; body?: unknown }): Promise<any> {
  const res = await ensureHttp()({
    method: opts.method,
    url: `${baseUrl}${pathname}`,
    headers: {
      'X-API-Key': resolveKey(),
      ...(opts.body != null ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    timeoutMs: 15000,
  });
  if (res.status === 404) return null;
  if (res.status === 409) throw new Error('SSIO KV 版本冲突（其他设备已更新，请先拉取再写）');
  if (res.status !== 200 && res.status !== 201) throw new Error(`SSIO API 失败: HTTP ${res.status} ${pathname}`);
  const text = await res.bodyText();
  try { return JSON.parse(text); } catch { return null; }
}

// ===== KV（/v1/kv?key=... 协议）=====

export interface KvEntry {
  key: string;
  value: string;
  version: number;
  sizeBytes: number;
  updatedAt: number;
}

export async function kvGet(key: string): Promise<KvEntry | null> {
  return api(`/v1/kv?key=${encodeURIComponent(key)}`, { method: 'GET' });
}

export async function kvGetJson<T = any>(key: string): Promise<T | null> {
  const e = await kvGet(key);
  if (!e) return null;
  try { return JSON.parse(e.value) as T; } catch { return null; }
}

export async function kvPut(key: string, value: string, expectedVersion?: number): Promise<{ version: number } | null> {
  return api(`/v1/kv?key=${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: expectedVersion != null ? { value, expectedVersion } : { value },
  });
}

export async function kvPutJson(key: string, obj: unknown, expectedVersion?: number): Promise<{ version: number } | null> {
  return kvPut(key, JSON.stringify(obj), expectedVersion);
}

export async function kvDelete(key: string): Promise<void> {
  await api(`/v1/kv?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
}

// ===== 发行 / 资产 =====

export async function getLatestRelease(target: SsioTarget): Promise<any | null> {
  const { platform, arch, clientId } = targetProfile(target);
  const qs = new URLSearchParams({ platform, arch, channel: 'stable', current: '0.0.1', clientId });
  return jsonGet(`${baseUrl}/v1/releases/latest?${qs}`, resolveKey());
}

/** SSIO 引用形态：ssio:release:<id> 或 ssio:file:<id> */
export function isSsioRef(v: unknown): v is string {
  return typeof v === 'string' && /^ssio:(release|file):[A-Za-z0-9_-]+$/i.test(v);
}

/**
 * SSIO 的 platform 枚举只有 win|linux|android|any（不是 Electron 的 win32/darwin），
 * 这张表是唯一出处。
 */
function targetProfile(target: SsioTarget): { platform: string; arch: string; clientId: string } {
  if (target === 'android') return { platform: 'android', arch: 'arm64', clientId: 'taskmgr-apk-dl' };
  return { platform: 'win', arch: 'x64', clientId: 'taskmgr-dl' };
}

/** 把 ssio:release/file 引用解析成可下载直链 */
export async function resolveDownloadRef(
  ref: string,
  opts: { target: SsioTarget; expectVersion?: string; server?: { baseUrl?: string; apiKey?: string } },
): Promise<string> {
  const m = String(ref || '').match(/^ssio:(release|file):([A-Za-z0-9_-]+)$/i);
  if (!m) throw new Error(`SSIO 引用格式无效：${ref}（应为 ssio:release:<id> 或 ssio:file:<id>）`);
  const kind = m[1].toLowerCase();
  const cfg = getSsioConfig();
  const base = (opts.server?.baseUrl || cfg.baseUrl).replace(/\/+$/, '');
  const key = opts.server?.apiKey ?? cfg.apiKey;

  let apiPath: string;
  if (kind === 'release') {
    const { platform, arch, clientId } = targetProfile(opts.target);
    const qs = new URLSearchParams({ platform, arch, channel: 'stable', current: '0.0.1', clientId });
    apiPath = `/v1/releases/latest?${qs.toString()}`;
  } else {
    apiPath = `/v1/storage/files/${encodeURIComponent(m[2])}/download`;
  }
  const j = await jsonGet(`${base}${apiPath}`, key);
  if (kind === 'release' && opts.expectVersion && String(j?.version || '') !== String(opts.expectVersion)) {
    throw new Error(`SSIO 最新发行是 ${j?.version || '?'}，与清单 ${opts.expectVersion} 不一致（可能被回滚），拒绝下载`);
  }
  if (!j?.url) throw new Error('SSIO 没返回下载地址（该版本可能没有挂文件）');
  return String(j.url);
}
