/**
 * site.* 命名空间 —— 星芒网站（https://nrsc.games）账号认证。
 *
 * 为什么走 taskAPI 而不是页面直接 fetch：Tauri WebView 的 origin 不在网站 CORS
 * 白名单里（白名单只有 nrsc.games / localhost / capacitor / file:// 的 null），
 * 直接 fetch 会被拦。统一走平台传输层（Tauri=原生 HTTP 无 CORS，浏览器=fetch）。
 *
 * 协议（d:\StarMain\Web\server\routes\auth.js）：
 *   POST /api/auth/login  {username,password} → {token, csrfToken, user}
 *   GET  /api/auth/me     (Bearer)            → {user}
 *   POST /api/auth/logout (Bearer)            → {message}
 * token 落 localStorage `starmain_token`（与网站同键，便于排障）。
 */
import type { PlatformDeps } from './platform';
import type { HandlerMap } from './dispatch';

export const SITE_BASE = 'https://nrsc.games';
const TOKEN_KEY = 'starmain_token';

export interface SiteUser {
  id: number;
  username: string;
  email: string | null;
  role: string;
  avatar: string | null;
  avatar_url: string | null;
  bio?: string | null;
  balance?: number;
  token_balance?: number;
  created_at?: number;
}

/**
 * 令牌与 CSRF 的存储策略：**以 SQLite settings 为准**，localStorage 只当缓存。
 *
 * 原因：应用热更新后 WebView 源会从内置资源切到 sthot://，localStorage 换命名空间、
 * 旧值全部读不到 → 表现为「云同步令牌出错 / 又要重新登录」。SQLite 在应用数据目录，
 * 与 WebView 源无关，跨源重启都还在。
 */
const CSRF_KEY = 'starmain_csrf';
const TOKEN_DB_KEY = 'site_token';
const CSRF_DB_KEY = 'site_csrf';
let tokenCache: string | null | undefined;
let csrfCache: string | null | undefined;

export function createSiteHandlers(deps: PlatformDeps): HandlerMap {
  async function readSetting(key: string): Promise<string | null> {
    try {
      const r = await deps.sql.get<{ value: string }>('SELECT value FROM settings WHERE key=?', [key]);
      return r?.value ?? null;
    } catch { return null; }
  }
  async function writeSetting(key: string, value: string | null): Promise<void> {
    try {
      if (value == null) await deps.sql.run('DELETE FROM settings WHERE key=?', [key]);
      else await deps.sql.run(
        'INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        [key, value],
      );
    } catch { /* 写库失败不阻断请求，至少内存缓存还有 */ }
  }

  async function getToken(): Promise<string | null> {
    if (tokenCache !== undefined) return tokenCache || null;
    const db = await readSetting(TOKEN_DB_KEY);
    let ls: string | null = null;
    try { ls = localStorage.getItem(TOKEN_KEY); } catch { /* noop */ }
    const v = db || ls || '';
    if (!db && ls) await writeSetting(TOKEN_DB_KEY, ls); // 旧版只存 localStorage，迁移过来
    tokenCache = v;
    return v || null;
  }
  async function setToken(t: string | null): Promise<void> {
    tokenCache = t || '';
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch { /* noop */ }
    await writeSetting(TOKEN_DB_KEY, t);
  }
  async function getCsrf(): Promise<string | null> {
    if (csrfCache !== undefined) return csrfCache || null;
    const db = await readSetting(CSRF_DB_KEY);
    let ls: string | null = null;
    try { ls = localStorage.getItem(CSRF_KEY); } catch { /* noop */ }
    const v = db || ls || '';
    if (!db && ls) await writeSetting(CSRF_DB_KEY, ls);
    csrfCache = v;
    return v || null;
  }
  async function setCsrf(t: string | null): Promise<void> {
    csrfCache = t || '';
    try {
      if (t) localStorage.setItem(CSRF_KEY, t);
      else localStorage.removeItem(CSRF_KEY);
    } catch { /* noop */ }
    await writeSetting(CSRF_DB_KEY, t);
  }

  /** 本地没有 csrf 就向网站换一个（该端点免 CSRF），避免"必须重新登录才能写操作" */
  let csrfPending: Promise<void> | null = null;
  async function ensureCsrf(): Promise<void> {
    if ((await getCsrf()) || !(await getToken())) return;

    if (!csrfPending) {
      csrfPending = (async () => {
        try {
          const res = await deps.http({
            method: 'GET',
            url: `${SITE_BASE}/api/auth/csrf-token`,
            headers: { Authorization: `Bearer ${await getToken()}` },
            timeoutMs: 10000,
          });
          const text = await res.bodyText().catch(() => '');
          const j = JSON.parse(text);
          if (j?.csrfToken) await setCsrf(String(j.csrfToken));
        } catch { /* 拿不到就让写操作报错，至少错误是真实的 */ }
        finally { csrfPending = null; }
      })();
    }
    await csrfPending;
  }

  /** 丢弃本地 csrf（缓存 + 数据库 + localStorage），用于 403 后强制换新 */
  async function resetCsrf(): Promise<void> {
    csrfCache = '';
    await writeSetting(CSRF_DB_KEY, null);
    try { localStorage.removeItem(CSRF_KEY); } catch { /* noop */ }
  }

  async function api(
    path: string,
    opts: { method?: string; body?: unknown; auth?: boolean; base?: string } = {},
  ): Promise<any> {
    const doRequest = async (): Promise<any> => {
      const headers: Record<string, string> = {};
      if (opts.body != null) headers['Content-Type'] = 'application/json';
      let token: string | null = null;
      if (opts.auth !== false) {
        token = await getToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        // 写操作前确保有 csrf（GET 不需要，省一次请求）
        if ((opts.method || 'GET') !== 'GET') await ensureCsrf();
        const csrf = await getCsrf();
        if (csrf) headers['x-csrf-token'] = csrf;
      }
      const res = await deps.http({
        method: opts.method || 'GET',
        // 默认 /api/auth（登录相关）；权益/云备份挂在 /api 下（不是 /api/auth）
        url: `${SITE_BASE}${opts.base ?? '/api/auth'}${path}`,
        headers,
        body: opts.body != null ? JSON.stringify(opts.body) : undefined,
        timeoutMs: 15000,
      });
      const text = await res.bodyText().catch(() => '');
      let j: any = null;
      try { j = JSON.parse(text); } catch { /* 非 JSON */ }
      return { status: res.status, data: j, raw: text, hadToken: !!token };
    };

    // 没登录就别发请求了：网站对「无 Authorization 的写操作」会回 403 CSRF 验证失败，
    // 那个报错会误导人（看起来像 CSRF 坏了，其实只是没登录）。
    if (opts.auth !== false && !(await getToken())) {
      return { status: 401, data: { error: '未登录：请先在「账户」里登录网站账号' }, raw: '', hadToken: false };
    }

    const first = await doRequest();
    const text = String(first.data?.error || first.data?.detail || first.raw || '');
    const csrfIssue = first.status === 403 && /csrf/i.test(text);

    if (csrfIssue) {
      // 令牌可能被服务端轮换过：换一枚新的再试一次
      await resetCsrf();
      await ensureCsrf();
      const second = await doRequest();
      if (second.status !== 403) return second;
      // 换了还是 403 → 大概率登录态已失效（服务端认为你没带 Authorization）
      await setToken(null);
      await setCsrf(null);
      return { ...second, data: { ...(second.data || {}), error: '登录已失效，请重新登录网站账号' } };
    }
    return first;
  }

  return {
    /** 登录：成功后 token 落 localStorage */
    'site:login': async (username: string, password: string) => {
      const r = await api('/login', { method: 'POST', body: { username, password }, auth: false });
      if (r.status === 200 && r.data?.token) {
        await setToken(r.data.token);
        if (r.data.csrfToken) await setCsrf(r.data.csrfToken);
        return { ok: true, user: r.data.user as SiteUser };
      }
      return { ok: false, error: r.data?.error || `登录失败（HTTP ${r.status}）` };
    },
    /** 会话恢复：用存的 token 换用户信息 */
    'site:me': async () => {
      const t = await getToken();
      if (!t) return { ok: false, user: null, reason: 'NO_TOKEN' };
      const r = await api('/me');
      if (r.status === 200 && r.data?.user) return { ok: true, user: r.data.user as SiteUser };
      await setToken(null); // token 失效清掉
      await setCsrf(null);
      return { ok: false, user: null, reason: 'INVALID' };
    },
    'site:logout': async () => {
      await api('/logout', { method: 'POST' }).catch(() => { /* 网络错也照常本地登出 */ });
      await setToken(null);
      await setCsrf(null);
      return { ok: true };
    },
    'site:register': async (username: string, password: string, email?: string) => {
      const r = await api('/register', { method: 'POST', body: { username, password, email }, auth: false });
      if (r.status === 200 || r.status === 201) return { ok: true, ...r.data };
      return { ok: false, error: r.data?.error || `注册失败（HTTP ${r.status}）` };
    },
    /** 是否已有本地 token（UI 判断要不要恢复会话） */
    'site:hasToken': async () => ({ hasToken: !!(await getToken()) }),

    // ===== 一键授权登录（设备授权流）=====
    /** 发起授权：返回授权页 URL（用浏览器打开）+ deviceCode（轮询凭证） */
    'site:deviceStart': async () => {
      const r = await api('/device/start', { method: 'POST', body: {}, auth: false });
      if (r.status === 200 && r.data?.deviceCode) {
        return { ok: true, deviceCode: r.data.deviceCode, userCode: r.data.userCode, url: r.data.url };
      }
      return { ok: false, error: r.data?.error || `发起授权失败（HTTP ${r.status}）` };
    },
    /** 轮询授权结果：approved → 存 token 返回 user；pending → ok:false reason:PENDING */
    'site:devicePoll': async (deviceCode: string) => {
      const r = await api('/device/poll', { method: 'POST', body: { deviceCode }, auth: false });
      if (r.status === 200 && r.data?.token) {
        await setToken(r.data.token);
        if (r.data.csrfToken) await setCsrf(r.data.csrfToken);
        return { ok: true, user: r.data.user as SiteUser };
      }
      if (r.status === 200 && r.data?.pending) return { ok: false, reason: 'PENDING' };
      return { ok: false, reason: 'ERROR', error: r.data?.error || `轮询失败（HTTP ${r.status}）` };
    },

    // ===== 权益中心（nrsc.games /api/entitlements）=====
    /** 我的权益 + 云备份状态 */
    'site:entitlements': async () => {
      const r = await api('/entitlements', { base: '/api' });
      if (r.status === 200 && r.data) return { ok: true, ...r.data };
      return { ok: false, error: r.data?.error || `查询权益失败（HTTP ${r.status}）` };
    },
    /** 上传云备份（payload=全量备份 JSON 字符串，限权益 backup_mb MB） */
    'site:backupPut': async (payload: string, appVersion?: string) => {
      const r = await api('/entitlements/backup', { method: 'PUT', body: { payload, appVersion }, base: '/api' });
      if (r.status === 200 && r.data?.ok) return { ok: true, ...r.data };
      return { ok: false, error: r.data?.error || `上传失败（HTTP ${r.status}）` };
    },
    /** 拉取云备份（无备份返回 ok:false reason:NO_BACKUP） */
    'site:backupGet': async () => {
      const r = await api('/entitlements/backup', { base: '/api' });
      if (r.status === 200 && r.data?.payload != null) return { ok: true, ...r.data };
      return { ok: false, reason: 'NO_BACKUP', error: r.data?.error || '没有云端备份' };
    },
    'site:backupDelete': async () => {
      const r = await api('/entitlements/backup', { method: 'DELETE', base: '/api' });
      return { ok: r.status === 200 };
    },
  };
}
