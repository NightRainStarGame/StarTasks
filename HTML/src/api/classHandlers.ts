/**
 * class.* 命名空间 —— 对接 SSIO 班级 REST 模块（server/class-module/routes.js）。
 * 契约形状沿用 electron/api-factory.ts 的 class.*（调用方 Class 页面无需改），
 * 但底层从 P2P 文件协议换成 REST：服务端管权限/成员，客户端不再有 ownerToken/HMAC manifest。
 *
 * 部署状态感知：服务端未就绪（404/网络错）时返回明确错误码 CLASS_API_UNAVAILABLE，
 * UI 提示「班级服务升级中」，不静默失败。
 */
import type { PlatformDeps } from './platform';
import type { HandlerMap } from './dispatch';
import { getSsioConfig } from '../cloud/ssioClient';
import { camelize } from '../utils/time';

const ALIAS_KEY = 'class_local_alias';
const TOKEN_KEY = 'class_device_token';

function classBase(): string {
  return `${getSsioConfig().baseUrl}/v1/class`;
}

/**
 * 星芒网站登录态（一键授权后落在 localStorage，与网站同键）。
 * 建班要带它：SSIO 用这把 token 去网站查「创建班级」权益（6.6 元 / 30 天 = 1 个班）。
 */
function siteToken(): string | null {
  try { return localStorage.getItem('starmain_token'); } catch { return null; }
}

/** 服务端未部署时的统一提示（带上真实地址与状态，便于定位，不再只说"升级中"） */
function unavailableText(): string {
  return `班级服务不可用：${classBase()} 返回 404（服务端未部署）`;
}

function ensureToken(deps: PlatformDeps): Promise<string> {
  return (async () => {
    const row = await deps.sql.get<{ value: string }>('SELECT value FROM settings WHERE key=?', [TOKEN_KEY]);
    if (row?.value) return row.value;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const token = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    await deps.sql.run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [TOKEN_KEY, token]);
    return token;
  })();
}

export function createClassHandlers(deps: PlatformDeps): HandlerMap {
  async function api(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<any> {
    const token = await ensureToken(deps);
    const { apiKey } = getSsioConfig();
    const res = await deps.http({
      method: opts.method || 'GET',
      url: `${classBase()}${path}`,
      headers: {
        'X-API-Key': apiKey,
        'X-Device-Token': token,
        ...(opts.body != null ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers || {}),
      },
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
      timeoutMs: 15000,
    });
    if (res.status === 404) {
      const text = await res.bodyText().catch(() => '');
      if (text.includes('NOT_FOUND') || text === '') return null;
    }
    const text = await res.bodyText();
    let j: any = null;
    try { j = JSON.parse(text); } catch { /* 非 JSON */ }
    const ok = res.status >= 200 && res.status < 300;
    if (!ok && !j) {
      return { ok: false, error: `班级服务 HTTP ${res.status}`, errorCode: 'CLASS_API_UNAVAILABLE' };
    }
    // 服务端直接返回数据库行（snake_case：joined_at / author_alias / deadline_at …），
    // 客户端按驼峰读 → 字段全是 undefined（成员页曾因此崩在 toISOString）。这里统一归一化。
    return j ? camelize(j) : { ok };
  }

  return {
    'class:config': async () => {
      const row = await deps.sql.get<{ value: string }>('SELECT value FROM settings WHERE key=?', [ALIAS_KEY]);
      return { ok: true, localAlias: row?.value || '我' };
    },
    'class:saveLocalAlias': async (alias: string) => {
      await deps.sql.run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [ALIAS_KEY, alias]);
      return { ok: true, localAlias: alias };
    },
    'class:list': async () => {
      const r = await api('');
      if (!r) return { ok: false, error: unavailableText(), errorCode: 'CLASS_API_UNAVAILABLE', classes: [] };
      // 服务端业务错误（如 401 UNAUTHORIZED）以前会被吞成「空列表」，现在透出原因
      if (r.ok === false || (r.error && !Array.isArray(r.classes))) {
        return { ok: false, error: String(r.error || '获取班级列表失败'), classes: [] };
      }
      return { ok: true, classes: r.classes || [] };
    },
    'class:info': (classId: number) => api(`/${classId}`),
    'class:create': async (payload: { name: string; description?: string; alias?: string; avatarUrl?: string }) => {
      /* 建班是付费能力：带上网站在登录态，SSIO 拿它查「创建班级」权益（6.6 元 / 30 天 = 1 个班）。
         没登录 → SSIO 回 402 SITE_TOKEN_REQUIRED；额度用尽 → 402 CLASS_QUOTA_EXCEEDED。 */
      const token = siteToken();
      const r = await api('', {
        method: 'POST',
        body: payload,
        headers: token ? { 'X-Site-Token': token } : {},
      });
      if (!r) return { ok: false, error: unavailableText(), errorCode: 'CLASS_API_UNAVAILABLE' };
      if (r.error === 'SITE_TOKEN_REQUIRED') {
        return { ok: false, error: r.message || '请先用星芒账号登录后再创建班级', errorCode: 'SITE_TOKEN_REQUIRED' };
      }
      if (r.error === 'SITE_TOKEN_INVALID') {
        return { ok: false, error: r.message || '网站登录态已失效，请重新登录', errorCode: 'SITE_TOKEN_INVALID' };
      }
      if (r.error === 'CLASS_QUOTA_EXCEEDED') {
        return {
          ok: false,
          error: r.message || '建班额度已用尽',
          errorCode: 'CLASS_QUOTA_EXCEEDED',
          buyUrl: r.buyUrl,
          quota: r.quota,
          used: r.used,
        };
      }
      return r;
    },
    'class:join': (payload: { inviteCode: string; alias?: string; avatarUrl?: string }) =>
      api('/join', { method: 'POST', body: payload }),
    /** owner：编辑班级基本信息 */
    'class:updateSettings': (classId: number, payload: { name?: string; description?: string; maxMembers?: number }) =>
      api(`/${classId}/settings`, { method: 'POST', body: payload }),
    'class:leave': (classId: number) => api(`/${classId}/leave`, { method: 'POST' }),
    'class:listAnnouncements': (classId: number) => api(`/${classId}/announcements`),
    'class:listTasks': (classId: number) => api(`/${classId}/tasks`),
    'class:publishAnnouncement': (classId: number, payload: { title: string; body: string }) =>
      api(`/${classId}/announcements`, { method: 'POST', body: payload }),
    'class:publishTask': (classId: number, payload: { title: string; body?: string; dueAt?: number }) =>
      api(`/${classId}/tasks`, { method: 'POST', body: payload }),
    'class:deleteAnnouncement': (classId: number, annId: number) =>
      api(`/${classId}/announcements/${annId}`, { method: 'DELETE' }),
    'class:promoteMember': (classId: number, payload: { alias: string; role: 'admin' | 'member' }) =>
      api(`/${classId}/members/role`, { method: 'POST', body: payload }),
    /** 改昵称 / 设生日（只能改自己；owner 可传 targetAlias 改任何人） */
    'class:updateProfile': (classId: number, payload: { alias?: string; birthday?: string; targetAlias?: string }) =>
      api(`/${classId}/members/profile`, { method: 'POST', body: payload }),
    'class:removeMember': (classId: number, payload: { alias: string }) =>
      api(`/${classId}/members`, { method: 'DELETE', body: payload }),
    /** 聊天（v2）：增量拉消息 */
    'class:listMessages': (classId: number, sinceId = 0) =>
      api(`/${classId}/messages?sinceId=${encodeURIComponent(sinceId)}`),
    /** 聊天（v2）：发消息（type: text | birthday_wish；带 alias/avatarUrl 让服务端补齐作者信息） */
    'class:sendMessage': (classId: number, payload: { body: string; type?: string; meta?: any; alias?: string; avatarUrl?: string }) =>
      api(`/${classId}/messages`, { method: 'POST', body: payload }),
    'class:listChains': (classId: number) => api(`/${classId}/chains`),
    'class:createChain': (classId: number, payload: { title: string; body?: string }) =>
      api(`/${classId}/chains`, { method: 'POST', body: payload }),
    'class:joinChain': (classId: number, chainId: number, content: string) =>
      api(`/${classId}/chains/${chainId}/join`, { method: 'POST', body: { content } }),
    'class:closeChain': (classId: number, chainId: number) =>
      api(`/${classId}/chains/${chainId}/close`, { method: 'POST' }),
    'class:listPolls': (classId: number) => api(`/${classId}/polls`),
    'class:createPoll': (classId: number, payload: { question: string; description?: string; options: string[]; multi?: boolean; deadlineAt?: number }) =>
      api(`/${classId}/polls`, { method: 'POST', body: payload }),
    'class:votePoll': (classId: number, pollId: number, choices: number[]) =>
      api(`/${classId}/polls/${pollId}/vote`, { method: 'POST', body: { choices } }),
    'class:closePoll': (classId: number, pollId: number) =>
      api(`/${classId}/polls/${pollId}/close`, { method: 'POST' }),
    'class:markAnnouncementRead': (classId: number, annId: number) =>
      api(`/${classId}/announcements/${annId}/read`, { method: 'POST' }),
    'class:completeTask': (classId: number, taskId: number, status: 'open' | 'done' | 'cancelled') =>
      api(`/${classId}/tasks/${taskId}/status`, { method: 'POST', body: { status } }),
    'class:sync': async (classId: number) => {
      const r = await api(`/${classId}/sync`);
      if (!r) return { ok: false, error: unavailableText(), errorCode: 'CLASS_API_UNAVAILABLE' };
      return {
        ok: true,
        newAnnouncements: (r.announcements || []).length,
        newTasks: (r.tasks || []).length,
        newChains: (r.chains || []).length,
        newPolls: (r.polls || []).length,
      };
    },
  };
}
