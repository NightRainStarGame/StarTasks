/**
 * USTB SSO + BYYT 教务客户端（v2 移植版）。
 * 协议同源 electron/ustb（参考 isHarryh/USTB-SSO，MIT），传输层换平台 HTTP：
 *   · Tauri = Rust 原生 HTTP（无 CORS）；浏览器降级 fetch（受 CORS 限制，仅桌面壳可用）
 *   · Cookie 手动管理（跨请求持久会话）+ 手动跟随重定向（SSO 流程需要看 Location）
 */
import type { HttpRequest, HttpResponse } from '../api/platform';
import { parseWeeksText } from '../core/ustbTypes';

type HttpFn = (req: HttpRequest) => Promise<HttpResponse>;
let httpImpl: HttpFn | null = null;
export function configureUstbHttp(fn: HttpFn): void { httpImpl = fn; }

/**
 * 浏览器预览时走 dev server 代理（vite.config.ts 的 /__ustb）：
 * 浏览器直连教务会被 CORS 拦，且读不到 Set-Cookie（禁止头）→ 会话建不起来。
 * 打包壳里走 plugin-http（Rust 侧），无此限制，保持原样。
 */
function isTauriEnv(): boolean {
  return typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}
function viaProxy(url: string): string {
  if (isTauriEnv()) return url;
  return `/__ustb?u=${encodeURIComponent(url)}`;
}

const BYYT_APP = {
  entityId: 'YW2025006',
  redirectUri: 'https://byyt.ustb.edu.cn/oauth/login/code',
  state: 'null',
} as const;

const SSO_AUTH_ENTRY = 'https://sso.ustb.edu.cn/idp/authCenter/authenticate';
const SSO_QUERY_AUTH_METHODS = 'https://sso.ustb.edu.cn/idp/authn/queryAuthMethods';
const SSO_QR_INFO = 'https://sso.ustb.edu.cn/idp/authn/getMicroQr';
const SIS_QR_PAGE = 'https://sis.ustb.edu.cn/connect/qrpage';
const SIS_QR_IMG = 'https://sis.ustb.edu.cn/connect/qrimg';
const SIS_QR_STATE = 'https://sis.ustb.edu.cn/connect/state';
const BYYT_BASE = 'https://byyt.ustb.edu.cn';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// ==================== CookieJar ====================
interface CookieEntry { domain: string; path: string; cookies: Record<string, string> }

export class CookieJar {
  private store = new Map<string, Record<string, string>>();

  static fromJSON(json: string | undefined | null): CookieJar {
    const jar = new CookieJar();
    if (!json) return jar;
    try {
      const arr = JSON.parse(json) as CookieEntry[];
      for (const e of arr) {
        if (e && typeof e.domain === 'string' && e.cookies && typeof e.cookies === 'object') {
          jar.store.set(`${e.domain}|${e.path ?? '/'}`, { ...e.cookies });
        }
      }
    } catch { /* 损坏按空 */ }
    return jar;
  }
  toJSON(): string {
    const arr: CookieEntry[] = [];
    for (const [key, cookies] of this.store) {
      const [domain, path] = key.split('|');
      if (Object.keys(cookies).length) arr.push({ domain, path, cookies });
    }
    return JSON.stringify(arr);
  }

  /** 吸收 Set-Cookie（支持 x-taskmgr-set-cookie 透传头） */
  absorb(url: URL, headers: Record<string, string>): void {
    let rawList: string[] = [];
    const single = headers['set-cookie'] || headers['Set-Cookie'];
    if (single) rawList = single.split(/,(?=\s*[^;=]+=)/); // 逗号后跟 name= 才切
    const passthrough = headers['x-taskmgr-set-cookie'];
    if (!rawList.length && passthrough) {
      try { rawList = JSON.parse(passthrough); } catch { rawList = []; }
    }
    for (const raw of rawList) {
      const [pair, ...attrs] = String(raw).split(';');
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      let domain = url.hostname;
      let path = '/';
      for (const attr of attrs) {
        const [k, ...rest] = attr.split('=');
        const v = rest.join('=').trim();
        const key = k.trim().toLowerCase();
        if (key === 'domain' && v) domain = v.replace(/^\./, '');
        if (key === 'path' && v) path = v;
      }
      const bucketKey = `${domain}|${path}`;
      const bucket = this.store.get(bucketKey) ?? {};
      if (value === '') delete bucket[name];
      else bucket[name] = value;
      this.store.set(bucketKey, bucket);
    }
  }

  header(url: URL): string | undefined {
    const host = url.hostname;
    const parts: string[] = [];
    for (const [key, bucket] of this.store) {
      const [domain, path] = key.split('|');
      if (host !== domain && !host.endsWith('.' + domain)) continue;
      if (path !== '/' && !url.pathname.startsWith(path)) continue;
      for (const [n, v] of Object.entries(bucket)) parts.push(`${n}=${v}`);
    }
    return parts.length ? parts.join('; ') : undefined;
  }
}

// ==================== 通用请求（手动重定向） ====================
interface ReqOpts {
  method?: 'GET' | 'POST';
  json?: unknown;
  form?: Record<string, string>;
  headers?: Record<string, string>;
  followRedirect?: boolean;
  maxRedirects?: number;
  timeoutMs?: number;
}

interface SimpleRes {
  status: number;
  headers: Record<string, string>;
  text: string;
  bytes: Uint8Array;
}

function ensureHttp(): HttpFn {
  if (!httpImpl) throw new Error('USTB HTTP 通道未注入（先调 configureUstbHttp）');
  return httpImpl;
}

async function request(jar: CookieJar, url: string, opts: ReqOpts = {}): Promise<SimpleRes> {
  const http = ensureHttp();
  let current = url;
  const hops = opts.followRedirect === false ? 1 : opts.maxRedirects ?? 8;
  let res!: SimpleRes;
  for (let hop = 0; hop < hops; hop++) {
    const u = new URL(current);
    const headers: Record<string, string> = { 'User-Agent': UA, ...(opts.headers ?? {}) };
    const cookie = jar.header(u);
    if (cookie) headers.Cookie = cookie;
    let body: string | undefined;
    if (hop === 0) {
      if (opts.json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(opts.json);
      } else if (opts.form !== undefined) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        body = new URLSearchParams(opts.form).toString();
      }
    }
    let r: Awaited<ReturnType<typeof http>>;
    try {
      r = await http({
        method: hop === 0 ? (opts.method ?? 'GET') : 'GET',
        url: viaProxy(current),
        headers,
        body,
        followRedirect: false,
        timeoutMs: opts.timeoutMs ?? 20000,
      });
    } catch (e: any) {
      // 手机端常见：cellular 网络访问不到校园站点（DNS/连接被重置），
      // reqwest 只会给 "error sending request for url (...)"，对用户毫无指导意义。
      const host = (() => { try { return new URL(current).host; } catch { return current; } })();
      const raw = String(e?.message || e);
      if (/error sending request|dns|connect|network|timed? ?out/i.test(raw)) {
        throw new Error(
          `无法连接 ${host}：手机网络大概率访问不到该教务站点。请切到 WiFi / 校园网后重试（原始错误：${raw}）`,
        );
      }
      throw new Error(`请求 ${host} 失败：${raw}`);
    }
    jar.absorb(u, r.headers);
    const text = await r.bodyText().catch(() => '');
    let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
    try { bytes = await r.bodyBytes(); } catch { /* noop */ }
    res = { status: r.status, headers: r.headers, text, bytes };
    const s = r.status;
    if (s === 301 || s === 302 || s === 303 || s === 307 || s === 308) {
      const loc = r.headers['location'] || r.headers['Location'];
      if (!loc) break;
      current = new URL(loc, current).toString();
      continue;
    }
    break;
  }
  return res;
}

function readJson(text: string): any {
  try { return JSON.parse(text); } catch { return null; }
}

// ==================== SSO 微信扫码登录 ====================
export interface UstbContext {
  jar: CookieJar;
  lck?: string;
  appId?: string;
  returnUrl?: string;
  randomToken?: string;
  sid?: string;
}

export function createContext(jarJson?: string | null): UstbContext {
  return { jar: CookieJar.fromJSON(jarJson) };
}

export async function startQrLogin(ctx: UstbContext): Promise<void> {
  const entry = new URL(SSO_AUTH_ENTRY);
  entry.searchParams.set('client_id', BYYT_APP.entityId);
  entry.searchParams.set('redirect_uri', BYYT_APP.redirectUri);
  entry.searchParams.set('login_return', 'true');
  entry.searchParams.set('state', BYYT_APP.state);
  entry.searchParams.set('response_type', 'code');
  const entryRes = await request(ctx.jar, entry.toString(), { followRedirect: false });
  if (Math.floor(entryRes.status / 100) !== 3) {
    throw new Error(`认证入口异常（HTTP ${entryRes.status}），请确认网络可以访问 sso.ustb.edu.cn`);
  }
  const location = entryRes.headers['location'] || entryRes.headers['Location'] || '';
  const lck = new URL(location.replace('/#/', '/')).searchParams.get('lck');
  if (!lck) throw new Error('未能获取登录上下文（lck）');
  ctx.lck = lck;

  const methodsRes = await request(ctx.jar, SSO_QUERY_AUTH_METHODS, {
    method: 'POST', json: { lck, entityId: BYYT_APP.entityId },
  });
  const methods = readJson(methodsRes.text);
  if (!methods || methods.code !== 200) {
    throw new Error(`查询认证方式失败：${methods?.message ?? `HTTP ${methodsRes.status}`}`);
  }

  const qrRes = await request(ctx.jar, SSO_QR_INFO, {
    method: 'POST', json: { entityId: BYYT_APP.entityId, lck },
  });
  const qrInfo = readJson(qrRes.text);
  if (!qrInfo || String(qrInfo.code) !== '200') {
    throw new Error(`获取二维码信息失败：${qrInfo?.message ?? `HTTP ${qrRes.status}`}`);
  }
  ctx.appId = qrInfo.data.appId;
  ctx.returnUrl = qrInfo.data.returnUrl;
  ctx.randomToken = qrInfo.data.randomToken;

  const pageRes = await request(ctx.jar,
    `${SIS_QR_PAGE}?appid=${encodeURIComponent(ctx.appId!)}&return_url=${encodeURIComponent(ctx.returnUrl!)}&rand_token=${encodeURIComponent(ctx.randomToken!)}&embed_flag=1`);
  const m = /sid\s?=\s?(\w{32})/.exec(pageRes.text);
  if (!m) throw new Error('二维码页面解析失败（未找到 sid）');
  ctx.sid = m[1];
}

/** 二维码图片 data URL（base64 PNG） */
export async function getQrImage(ctx: UstbContext): Promise<string> {
  const res = await request(ctx.jar, `${SIS_QR_IMG}?sid=${ctx.sid}`);
  if (res.status !== 200) throw new Error(`获取二维码失败（HTTP ${res.status}）`);
  let bin = '';
  for (const b of res.bytes) bin += String.fromCharCode(b);
  return `data:image/png;base64,${btoa(bin)}`;
}

export type QrPollStatus = 'waiting' | 'scanned' | 'success' | 'expired' | 'error';

export async function pollQrStatus(ctx: UstbContext): Promise<{ status: QrPollStatus; passcode?: string; message?: string }> {
  const res = await request(ctx.jar, `${SIS_QR_STATE}?sid=${ctx.sid}`, { timeoutMs: 16000 });
  const data = readJson(res.text);
  if (!data) return { status: 'error', message: '轮询响应解析失败' };
  const code = Number(data.code);
  if (code === 1) return { status: 'success', passcode: String(data.data ?? '') };
  if (code === 2) return { status: 'scanned' };
  if (code === 3 || code === 202) return { status: 'expired', message: '二维码已过期，请点击刷新' };
  if (code === 4) return { status: 'waiting' };
  return { status: 'error', message: data.message ? String(data.message) : `状态码 ${code}` };
}

function decodeLocationValue(v: string): string {
  let s = v;
  try { s = decodeURIComponent(s); } catch { /* keep */ }
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

export interface UstbUserInfo { name: string; school: string; userId: string }

export async function completeQrLogin(ctx: UstbContext, passcode: string): Promise<UstbUserInfo> {
  const u = new URL(ctx.returnUrl!);
  u.searchParams.set('appid', ctx.appId!);
  u.searchParams.set('auth_code', passcode);
  u.searchParams.set('rand_token', ctx.randomToken!);
  const res = await request(ctx.jar, u.toString());
  const actionType = /var actionType\s*=\s*"([^"]+)"/.exec(res.text);
  const locationValue = /var locationValue\s*=\s*"([^"]+)"/.exec(res.text);
  if (actionType && locationValue) {
    if (actionType[1].toUpperCase() !== 'GET') throw new Error(`不支持的认证跳转方式：${actionType[1]}`);
    await request(ctx.jar, decodeLocationValue(locationValue[1]));
  }
  return getByytUserInfo(ctx);
}

// ==================== BYYT 教务接口 ====================
export async function getByytUserInfo(ctx: UstbContext): Promise<UstbUserInfo> {
  const res = await request(ctx.jar, `${BYYT_BASE}/user/me`, { method: 'POST' });
  if (res.status === 401 || res.status === 403) throw new Error('登录已失效，请重新扫码');
  const data = readJson(res.text);
  if (!data) throw new Error(`用户信息响应异常（HTTP ${res.status}）`);
  const d = data.xm !== undefined ? data : data.data ?? {};
  if (d.xm === undefined) throw new Error(`获取用户信息失败：${data.msg ?? data.message ?? res.status}`);
  return { name: String(d.xm ?? ''), school: String(d.bmmc ?? ''), userId: String(d.yhdm ?? '') };
}

/**
 * 教务返回的「当前教学周」——有它就不该再靠猜校历推开学日。
 * 不同版本字段名不一，这里宽松扫描。
 */
let lastWeekHint: number | null = null;
export function getLastWeekHint(): number | null {
  return lastWeekHint;
}

/** 课表：POST /Xskbcx/queryXskbcxList */
export async function fetchCurriculum(ctx: UstbContext, xn: string, xq: string): Promise<any[]> {
  const res = await request(ctx.jar, `${BYYT_BASE}/Xskbcx/queryXskbcxList`, {
    method: 'POST', form: { bs: '2', xn, xq },
  });
  if (res.status === 401 || res.status === 403) throw new Error('登录已失效，请重新扫码');
  const data = readJson(res.text);

  // 扫当前周次（dqzc / currentWeek / zc / week / nowWeek …），范围校验 1-30
  lastWeekHint = null;
  const pickWeek = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    for (const k of ['dqzc', 'currentWeek', 'current_week', 'nowWeek', 'zc', 'week']) {
      const n = Number(obj[k]);
      if (Number.isInteger(n) && n >= 1 && n <= 30) { lastWeekHint = n; return; }
    }
  };

  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    if (data.code !== undefined && Number(data.code) !== 200) {
      throw new Error(`课表接口错误：${data.msg ?? data.message ?? data.code}`);
    }
    pickWeek(data);
    pickWeek(data.data);
    pickWeek(data.content && !Array.isArray(data.content) ? data.content : null);
    if (Array.isArray(data.content)) return data.content;
    if (Array.isArray(data.data)) return data.data;
  }
  throw new Error(`课表响应异常（HTTP ${res.status}）`);
}

/**
 * 成绩接口候选（BYYT 本研一体，不同版本路径不同）。
 * 依据：成绩页路由是 /cjgl/grcjcx/grcjcx（个人成绩查询，字段 kcmc/pm/zrs），
 * 数据接口按金智惯例是"路由 + queryXxxList"，同时保留历史路径兜底。
 * 采取**探测**策略：谁先返回可解析的 JSON 就用谁，并记住命中项。
 */
const GRADE_ENDPOINTS = [
  '/cjgl/grcjcx/queryGrcjcxList',
  '/cjgl/grcjcx/grcjcx',
  '/cjgl/grcjcx/queryXsGrcjcxList',
  '/cjgl/grcjcx/queryGrcjcx',
  '/Xscjcx/queryXscjcxList',
];
let gradesEndpointHit: string | null = null;

/**
 * 登录后从成绩页的 JS bundle 里挖出真实接口路径。
 * 教务版本差异大（本次实测静态候选全 404），硬编码不可靠；
 * 页面本身是 SPA，接口字符串一定在它加载的脚本里。
 */
export async function discoverGradeEndpoints(ctx: UstbContext): Promise<string[]> {
  const out = new Set<string>();
  try {
    const page = await request(ctx.jar, `${BYYT_BASE}/cjgl/grcjcx/grcjcx`);
    if (page.status !== 200 || !page.text.includes('<')) return [];
    const srcs = [...page.text.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map((m) => m[1]);
    for (const s of srcs.slice(0, 6)) {
      const url = s.startsWith('http') ? s : `${BYYT_BASE}${s.startsWith('/') ? '' : '/'}${s}`;
      const js = await request(ctx.jar, url).catch(() => null);
      if (!js || js.status !== 200 || js.text.length > 12_000_000) continue;
      for (const m of js.text.matchAll(/["'`](\/[A-Za-z0-9_\-/]{2,90})["'`]/g)) {
        const p = m[1];
        if (!/(cj|cjcx|score)/i.test(p)) continue;
        if (/\.(js|css|png|jpe?g|svg|woff2?|ttf|map|ico)$/i.test(p)) continue;
        if (p.split('/').filter(Boolean).length < 3) continue;
        out.add(p);
      }
    }
  } catch { /* 发现失败不影响主流程 */ }
  return [...out].slice(0, 24);
}

/**
 * 成绩：按候选路径探测，返回原始行（字段随教务版本浮动，调用侧宽松解析）。
 * 入参 xn=学年 xq=学期（'0'=全年）。
 */
/** 探测单个接口；返回 null 表示这个路径不行（原因写进 why） */
async function probeGrades(ctx: UstbContext, path: string, xn: string, xq: string, tried: string[]): Promise<any[] | null> {
  const res = await request(ctx.jar, `${BYYT_BASE}${path}`, {
    method: 'POST',
    form: { xn, xq, _search: 'false', nd: String(Date.now()), 'queryModel.showCount': '500' },
  });
  if (res.status === 401 || res.status === 403) throw new Error('登录已失效，请重新扫码');
  if (res.status === 404) { tried.push(`${path}(404)`); return null; }
  const data = readJson(res.text);
  if (data === null) { tried.push(`${path}(非 JSON)`); return null; } // 可能是页面路由
  let rows: any[] | null = null;
  if (Array.isArray(data)) rows = data;
  else if (typeof data === 'object') {
    if (Array.isArray(data.content)) rows = data.content;
    else if (Array.isArray(data.items)) rows = data.items;
    else if (Array.isArray(data.rows)) rows = data.rows;
    else if (Array.isArray(data.datas)) {
      // 金智常见的 {datas:[{list:[...]}]} 嵌套
      rows = data.datas.flatMap((d: any) => (Array.isArray(d?.list) ? d.list : []));
    } else if (Number(data.code) === 200) rows = [];
  }
  if (rows) { gradesEndpointHit = path; return rows; }
  tried.push(`${path}(结构不识别)`);
  return null;
}

export async function fetchGrades(ctx: UstbContext, xn: string, xq = '0'): Promise<any[]> {
  const tried: string[] = [];
  // 1) 上次命中的路径
  if (gradesEndpointHit) {
    const rows = await probeGrades(ctx, gradesEndpointHit, xn, xq, tried);
    if (rows) return rows;
  }
  // 2) 内置候选
  for (const path of GRADE_ENDPOINTS) {
    if (path === gradesEndpointHit) continue;
    const rows = await probeGrades(ctx, path, xn, xq, tried);
    if (rows) return rows;
  }
  // 3) 运行时发现：从成绩页 JS 里挖真实接口
  const discovered = await discoverGradeEndpoints(ctx);
  for (const path of discovered) {
    const rows = await probeGrades(ctx, path, xn, xq, tried).catch(() => null);
    if (rows) return rows;
  }
  const tail = discovered.length
    ? `；页面里发现的候选：${discovered.slice(0, 8).join('、')}`
    : '；也没能从成绩页脚本里发现候选接口';
  throw new Error(`成绩接口不可用（已尝试 ${tried.slice(0, 6).join('、')}${tail}）`);
}

/**
 * 成绩行 → Grade 草稿（宽松映射，字段名随教务版本浮动）。
 * 常见字段：kcmc/xkmc 课程名、cj 成绩、jd 绩点、xf 学分、ksxz 考试性质、bjcj 补考成绩
 */
export function mapGradeRow(row: any): {
  courseName: string; score: number | null; gpa: number | null; credit: number; semester: string; notes: string;
} | null {
  const courseName = String(row.kcmc ?? row.xkmc ?? row.courseName ?? '').trim();
  if (!courseName) return null;
  const rawScore = row.cj ?? row.score ?? row.zcj ?? null;
  let score: number | null = null;
  if (rawScore != null) {
    const n = Number(rawScore);
    if (Number.isFinite(n)) score = n;
    else if (/优/.test(String(rawScore))) score = 95;
    else if (/良/.test(String(rawScore))) score = 85;
    else if (/中/.test(String(rawScore))) score = 75;
    else if (/及格|通过|合格/.test(String(rawScore))) score = 65;
    else if (/不及格|未通过|不合格|缺/.test(String(rawScore))) score = 0;
  }
  const gpaRaw = row.jd ?? row.gpa ?? null;
  const gpa = gpaRaw != null && Number.isFinite(Number(gpaRaw)) ? Number(gpaRaw) : null;
  const credit = Number(row.xf ?? row.credit ?? 0) || 0;
  const semester = String(row.xnxq ?? row.xqmc ?? row.semester ?? '').trim();
  const notes = [row.ksxz && `考试性质:${row.ksxz}`, row.bjcj != null && row.bjcj !== '' && `补考:${row.bjcj}`]
    .filter(Boolean).join(' · ');
  return { courseName, score, gpa, credit, semester, notes };
}


// ==================== 课表解析与作息（移植自 v1 导入器） ====================

export interface ByytPeriod { majorId: number; start: string; end: string; label: string }

/** 节次作息：POST /component/queryKbjg（失败返回空数组，调用方用默认作息兜底） */
export async function fetchPeriods(ctx: UstbContext, xn: string, xq: string): Promise<ByytPeriod[]> {
  try {
    const res = await request(ctx.jar, `${BYYT_BASE}/component/queryKbjg`, {
      method: 'POST', form: { xn, xq, nodataqx: '1' },
    });
    const data = readJson(res.text);
    if (!data || Number(data.code) !== 200 || !Array.isArray(data.content)) return [];
    const byMajor = new Map<number, { start?: string; end?: string; label: string; minors: Array<[string, string]> }>();
    for (const it of data.content) {
      const majorId = Number(it.dj);
      if (!Number.isFinite(majorId) || majorId <= 0) continue;
      const e = byMajor.get(majorId) ?? { label: '', minors: [] };
      if (!e.label && it.djms) e.label = String(it.djms);
      if (it.kskssj) e.start = String(it.kskssj);
      if (it.ksjssj) e.end = String(it.ksjssj);
      if (it.kssj && it.jssj) e.minors.push([String(it.kssj), String(it.jssj)]);
      byMajor.set(majorId, e);
    }
    const out: ByytPeriod[] = [];
    for (const [majorId, e] of byMajor) {
      const minors = e.minors.sort();
      const start = e.start ?? minors[0]?.[0];
      const end = e.end ?? minors[minors.length - 1]?.[1];
      if (start && end) out.push({ majorId, start, end, label: e.label });
    }
    return out.sort((a, b) => a.majorId - b.majorId);
  } catch {
    return [];
  }
}

export interface ParsedClassItem {
  day: number; period: number; className: string; teacher: string;
  weeksText: string; weeks: number[]; location: string; periodName: string;
}

/** 单条课表：key 形如 xq1_jc2（星期1_大节2），kbxx 逐行存 课程名/教师/周次/地点/节次 */
export function parseClassItem(raw: { key?: string; kbxx?: string }): ParsedClassItem | null {
  const key = raw.key ?? '';
  const kbxx = raw.kbxx ?? '';
  if (!key || !kbxx || key === 'bz') return null;
  const km = /xq(\d+)_jc(\d+)/.exec(key);
  if (!km) return null;
  const lines = kbxx.split('\n');
  let className = '', teacher = '', weeksText = '', location = '', periodName = '';
  if (lines.length >= 3 && lines.length <= 4) {
    [className, teacher, weeksText] = lines;
  } else if (lines.length === 5) {
    [className, teacher, weeksText, location, periodName] = lines;
  } else if (lines.length >= 6) {
    className = `${lines[0]}\n${lines[1]}`;
    teacher = lines[2]; weeksText = lines[3]; location = lines[4] ?? ''; periodName = lines[5] ?? '';
  } else {
    return null;
  }
  return {
    day: Number(km[1]), period: Number(km[2]),
    className: className.trim(), teacher: (teacher ?? '').trim(),
    weeksText: (weeksText ?? '').trim(), weeks: parseWeeksText(weeksText ?? ''),
    location: (location ?? '').trim(), periodName: (periodName ?? '').trim(),
  };
}

export function parseCurriculum(raw: Array<{ key?: string; kbxx?: string }>): ParsedClassItem[] {
  const out: ParsedClassItem[] = [];
  for (const r of raw) {
    const item = parseClassItem(r);
    if (item && item.className) out.push(item);
  }
  return out;
}
