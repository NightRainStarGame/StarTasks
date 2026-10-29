/**
 * 云命名空间处理器 —— homework.* / ai.* / ustb.* / xls.* / about.* / cleanup.*
 * 全部收拢到 CloudGateway（SSIO + AI 网关）。由 tauri.ts / sqljs.ts 注入 createInvoke。
 */
import type { PlatformDeps } from './platform';
import type { HandlerMap } from './dispatch';
import {
  fetchBundle, publishEntries, parsePublishCode, derivePublishCode,
  generateCodePairAsync, normalizeSyncCode, SYNCED_SOURCE_TAG,
  type HomeworkFile, type HomeworkEntry,
} from '../cloud/homework';
import { kvGetJson, kvPutJson, SSIO_KEYS, configureSsio } from '../cloud/ssioClient';
import { configureAiGateway, aiChatStream, normalizeModel, sanitizeKey, aiKeyInfo, setAiKey, setSiteToken, type AiChatMessage, type AiUsage } from '../cloud/aiGateway';
import { TOOL_DEFS, executeToolCall, confirmToolCall, type PendingAction } from '../ai/tools';
import { recognizeTimetableXls, type AiXlsRecognition } from '../ai/xlsRecognition';
import { computeCourseKey } from './dbHandlers';
import {
  configureUstbHttp, createContext as createUstbContext,
  startQrLogin, getQrImage, pollQrStatus, completeQrLogin,
  fetchGrades, mapGradeRow,
  fetchCurriculum, fetchPeriods, parseCurriculum, getLastWeekHint,
  type ParsedClassItem, type ByytPeriod,
} from '../ustb/client';
import { periodsOf } from '../core/periods';

/**
 * SSO 扫码会话 —— **全部落库，不用进程内存**。
 *
 * 旧实现把 ctx（CookieJar + lck/appId/returnUrl/randomToken/sid）放在模块级 Map 里，
 * 再用 settings 里的 key 反查；一旦模块重载 / handler 实例不同 / 写入时序错开，
 * Map 里就查不到 → 满屏「会话不存在」。这些字段本来就可序列化，直接存 JSON 最稳。
 */
type UstbCtx = ReturnType<typeof createUstbContext>;

function serializeUstbCtx(ctx: UstbCtx): string {
  return JSON.stringify({
    jar: ctx.jar.toJSON(),
    lck: ctx.lck, appId: ctx.appId, returnUrl: ctx.returnUrl,
    randomToken: ctx.randomToken, sid: ctx.sid,
  });
}

function deserializeUstbCtx(json?: string | null): UstbCtx | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json);
    const ctx = createUstbContext(o.jar);
    if (o.lck) ctx.lck = o.lck;
    if (o.appId) ctx.appId = o.appId;
    if (o.returnUrl) ctx.returnUrl = o.returnUrl;
    if (o.randomToken) ctx.randomToken = o.randomToken;
    if (o.sid) ctx.sid = o.sid;
    return ctx.sid ? ctx : null; // 没 sid 说明不是完整会话
  } catch {
    return null;
  }
}

/** 默认学年：按自然年推（9 月前算上一学年） */
function defaultXn(): string {
  const now = new Date();
  const y = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-${y + 1}`;
}

// ==================== 贝壳课表导入器（移植自 v1 electron/ustb/importer.ts） ====================
const USTB_PALETTE = ['#00FF88', '#00D4FF', '#FFD166', '#FF6B9D', '#A78BFA', '#4ADE80', '#F97316', '#22D3EE', '#F472B6', '#FACC15'];
const DAY_MS = 86400000;

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** 规整到「所在周的周一 0 点」 */
function normalizeToMonday(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0=周日
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return d.getTime();
}

/**
 * 写入课表：按课程名合并 → 建课程 → 按周次展开成具体时间的事件（type='class'）。
 * 幂等策略：每次导入前删除「上次导入的课程」（记在 settings.ustb_imported_courses），
 * 手动添加的课程/日程完全不动。
 */
async function importUstbCurriculum(
  deps: PlatformDeps,
  items: ParsedClassItem[],
  opts: { xn: string; xq: string; semesterStart: number; periods: ByytPeriod[] },
): Promise<{ courses: number; events: number; items: number; courseIds: number[]; warnings: string[] }> {
  const warnings: string[] = [];
  const groups = new Map<string, ParsedClassItem[]>();
  for (const it of items) {
    const arr = groups.get(it.className);
    if (arr) arr.push(it); else groups.set(it.className, [it]);
  }
  const periodMap = new Map<number, ByytPeriod>();
  for (const p of opts.periods) periodMap.set(p.majorId, p);

  const monday0 = normalizeToMonday(opts.semesterStart);
  const semester = `${opts.xn}-${opts.xq}`;
  const termLabel = `${opts.xn}学年${opts.xq === '2' ? '春' : '秋'}学期`;

  // 清掉上一次导入
  try {
    const prev = await deps.sql.get<{ value: string }>("SELECT value FROM settings WHERE key='ustb_imported_courses'");
    if (prev?.value) {
      for (const id of JSON.parse(prev.value) as number[]) {
        await deps.sql.run('DELETE FROM events WHERE course_id = ?', [id]);
        await deps.sql.run('DELETE FROM course_requirements WHERE course_id = ?', [id]);
        await deps.sql.run('DELETE FROM course_notes WHERE course_id = ?', [id]);
        await deps.sql.run('DELETE FROM courses WHERE id = ?', [id]);
      }
    }
  } catch { /* 记录损坏就跳过清理 */ }

  const courseIds: number[] = [];
  let eventCount = 0;

  for (const [name, its] of groups) {
    const color = USTB_PALETTE[hashString(name) % USTB_PALETTE.length];
    const teachers = [...new Set(its.map((i) => i.teacher).filter(Boolean))].join('、');
    await deps.sql.run(
      `INSERT INTO courses (name, code, instructor, semester, color, description, tags, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, null, teachers || null, semester, color, `贝壳课表导入 · ${termLabel}`, JSON.stringify(['贝壳课表']), Date.now()],
    );
    const created = await deps.sql.get<{ id: number }>('SELECT id FROM courses ORDER BY id DESC LIMIT 1');
    const courseId = created?.id;
    if (!courseId) continue;
    courseIds.push(courseId);

    for (const it of its) {
      const period = periodMap.get(it.period);
      const fallback = periodsOf(it.period);
      const startStr = period?.start ?? fallback[0];
      const endStr = period?.end ?? fallback[1];
      if (!period) warnings.push(`第 ${it.period} 大节无官方作息时间，按默认 ${startStr}-${endStr} 处理`);
      const [sh, sm] = startStr.split(':').map(Number);
      const [eh, em] = endStr.split(':').map(Number);
      const weeks = it.weeks.length ? it.weeks : Array.from({ length: 18 }, (_, i) => i + 1);
      if (!it.weeks.length) warnings.push(`「${name}」周次「${it.weeksText || '空'}」解析失败，按 1-18 周导入`);

      for (const w of weeks) {
        const base = new Date(monday0 + (w - 1) * 7 * DAY_MS + (it.day - 1) * DAY_MS);
        const startAt = base.setHours(sh, sm, 0, 0);
        const endAt = base.setHours(eh, em, 0, 0);
        const notes = [it.periodName, it.weeksText, it.teacher].filter(Boolean).join(' · ') || null;
        await deps.sql.run(
          `INSERT INTO events (title, start_at, end_at, location, recurrence, course_id, color, notes, all_day, type)
           VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 0, 'class')`,
          [name, startAt, endAt, it.location || null, courseId, color, notes],
        );
        eventCount++;
      }
    }
  }

  const saveSetting = (k: string, v: string) =>
    deps.sql.run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [k, v]);
  await saveSetting('ustb_imported_courses', JSON.stringify(courseIds));
  await saveSetting('ustb_last_sync', String(Date.now()));
  await saveSetting('ustb_term', JSON.stringify({ xn: opts.xn, xq: opts.xq }));
  await saveSetting('semester_start', String(monday0));
  await saveSetting('semester', semester);

  return {
    courses: groups.size,
    events: eventCount,
    items: items.length,
    courseIds,
    warnings: [...new Set(warnings)],
  };
}

const SETTING_PUBLISHER = 'homework_publisher';
const SETTING_MY_CODES = 'homework_my_codes';
const SETTING_COURSE_SYNC_PREFIX = 'homework_sync_';

export function createCloudHandlers(deps: PlatformDeps): HandlerMap {
  // 云传输注入（幂等）
  configureSsio({ http: deps.http });
  configureAiGateway({ http: deps.http });
  configureUstbHttp(deps.http);

  /**
   * 每次 AI 调用前同步凭据：
   *   - ai_key_override（用户在设置里填的 sk-sm- Key）
   *   - site_token（星芒网站登录态 → 走站内对话入口，无需另签 Key）
   * 这样「登录账号即可用 AI」，也不怕热更/重启后内存态丢失。
   */
  async function syncAiAuth(): Promise<void> {
    try {
      const s = await settingsMap(deps);
      setAiKey(s.ai_key_override || '');
      setSiteToken(s.site_token || '');
    } catch { /* 读不到设置就按无凭据处理，调用时会给出明确提示 */ }
  }

  // AI 会话状态（工具调用循环 + 待确认写操作）
  const pendingActions: PendingAction[] = [];

  const handlers: HandlerMap = {
    // ===== homework =====
    'homework:config': async () => {
      const settings = await deps.sql.all<{ key: string; value: string }>('SELECT * FROM settings');
      const map = Object.fromEntries(settings.map((r) => [r.key, r.value]));
      return {
        dir: 'ssio:homework/',
        publisher: map[SETTING_PUBLISHER] || '',
        lastSync: map.homework_last_sync ? Number(map.homework_last_sync) : null,
      };
    },
    'homework:saveAuth': async (_token: string, publisher: string) => {
      await deps.sql.run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [SETTING_PUBLISHER, publisher || '']);
      return { ok: true };
    },
    'homework:generateCodes': async () => {
      const pair = await generateCodePairAsync();
      // 记录历史
      const row = await deps.sql.get<{ value: string }>('SELECT value FROM settings WHERE key=?', [SETTING_MY_CODES]);
      const list = row ? JSON.parse(row.value || '[]') : [];
      list.unshift({ syncCode: pair.syncCode, createdAt: Date.now(), source: 'generated' });
      await deps.sql.run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [SETTING_MY_CODES, JSON.stringify(list.slice(0, 50))]);
      return { ok: true, ...pair };
    },
    'homework:listMyCodes': async () => {
      const row = await deps.sql.get<{ value: string }>('SELECT value FROM settings WHERE key=?', [SETTING_MY_CODES]);
      const list = row ? JSON.parse(row.value || '[]') : [];
      const codes = [] as any[];
      for (const it of list) {
        codes.push({ ...it, publishCode: await derivePublishCode(it.syncCode) });
      }
      // 课程绑定码也列出
      const courseCodes = await deps.sql.all<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key LIKE 'homework_sync_%'");
      for (const cc of courseCodes) {
        const syncCode = normalizeSyncCode(cc.value);
        if (!syncCode) continue;
        if (codes.some((c) => c.syncCode === syncCode)) continue;
        codes.push({ syncCode, publishCode: await derivePublishCode(syncCode), createdAt: 0, source: 'course' });
      }
      return { ok: true, codes };
    },
    'homework:verifyCodes': async (publishCode: string) => {
      const syncCode = await parsePublishCode(publishCode);
      return syncCode ? { ok: true, syncCode } : { ok: false, error: '作业发布码校验失败' };
    },
    'homework:courseSyncCode': async (courseId: number | null | undefined) => {
      if (!courseId) return { ok: false, error: '缺少课程' };
      const ckRow = await deps.sql.get<{ name: string; instructor: string | null }>('SELECT name, instructor FROM courses WHERE id=?', [courseId]);
      if (!ckRow) return { ok: false, error: '课程不存在' };
      const ck = await computeCourseKey(ckRow.name, ckRow.instructor || '');
      const byKey = normalizeSyncCode((await deps.sql.get<{ value: string }>('SELECT value FROM settings WHERE key=?', ['homework_sync_ck_' + ck]))?.value || '');
      if (byKey) return { ok: true, syncCode: byKey };
      const legacy = normalizeSyncCode((await deps.sql.get<{ value: string }>('SELECT value FROM settings WHERE key=?', [SETTING_COURSE_SYNC_PREFIX + courseId]))?.value || '');
      const fresh = legacy || (await generateCodePairAsync()).syncCode;
      await deps.sql.run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', ['homework_sync_ck_' + ck, fresh]);
      return { ok: true, syncCode: fresh };
    },
    'homework:publish': async (payload: any) => {
      let syncCode: string | undefined;
      if (payload.publishCode && payload.publishCode.trim()) {
        const decoded = await parsePublishCode(payload.publishCode);
        if (!decoded) return { ok: false, error: '作业发布码格式不对（12 位，不含 0/O/1/I/L）' };
        syncCode = decoded;
      } else if (payload.syncCode) {
        const n = normalizeSyncCode(payload.syncCode);
        if (!n) return { ok: false, error: '同步作业码格式不对（8 位）' };
        syncCode = n;
      } else if (payload.courseId) {
        const r = await handlers['homework:courseSyncCode'](payload.courseId) as any;
        if (!r.ok) return r;
        syncCode = r.syncCode as string;
      } else {
        return { ok: false, error: '缺少同步作业码：填发布码/同步码，或选择课程' };
      }
      const publisher = (await deps.sql.get<{ value: string }>('SELECT value FROM settings WHERE key=?', [SETTING_PUBLISHER]))?.value || '匿名';
      const course = await deps.sql.get<any>('SELECT * FROM courses WHERE id=?', [payload.courseId ?? -1]);
      const entries = payload.entries?.length
        ? payload.entries
        : [{ title: payload.title, content: payload.content, type: payload.type, sessionDate: payload.sessionDate, sessionTime: payload.sessionTime, dueDate: payload.dueDate }];
      const r = await publishEntries(
        syncCode,
        { name: payload.courseName || course?.name || '未命名课程', guid: course?.guid },
        entries.map((e: any) => ({ ...e, sessionDate: e.sessionDate || payload.sessionDate })),
        publisher,
      );
      return { ...r, ok: r.ok, syncCode, courseName: payload.courseName, entriesCount: entries.length };
    },
    'homework:remoteEntries': async (syncCode: string) => {
      const n = normalizeSyncCode(syncCode);
      if (!n) return { ok: false, error: '同步作业码格式不对' };
      const file = await fetchBundle(n);
      if (!file) return { ok: false, error: '该码还没有发布过作业' };
      return {
        ok: true,
        courseName: file.courseName,
        entries: (file.entries || []).map((e) => ({
          id: e.id, title: e.title, sessionDate: e.sessionDate, sessionTime: e.sessionTime,
          content: e.content, publisher: e.publisher, publishedAt: e.publishedAt, updatedAt: e.updatedAt,
        })),
      };
    },
    'homework:receive': async (syncCode: string, chooseCourseId?: number | null) => {
      const n = normalizeSyncCode(syncCode);
      if (!n) return { ok: false, error: '同步作业码格式不对' };
      const file = await fetchBundle(n);
      if (!file) return { ok: false, error: '该码还没有发布过作业' };

      // 课程匹配链：手选 > courseKey > guid > 同名
      let course: any = null;
      if (chooseCourseId) {
        course = await deps.sql.get('SELECT * FROM courses WHERE id=?', [chooseCourseId]);
      }
      if (!course && file.courseKey) {
        const rows = await deps.sql.all<any>('SELECT * FROM courses');
        course = rows.find((c: any) => c.course_key === file.courseKey) ?? null;
      }
      if (!course && file.courseGuid) {
        course = await deps.sql.get('SELECT * FROM courses WHERE guid=?', [file.courseGuid]);
      }
      if (!course && file.courseName) {
        const candidates = await deps.sql.all<any>('SELECT * FROM courses WHERE name=?', [file.courseName]);
        if (candidates.length > 1) {
          return {
            ok: false, error: '同名课程有多门，请选择要挂载的课程',
            courseCandidates: candidates.map((c: any) => ({ id: c.id, name: c.name, code: c.code, instructor: c.instructor })),
          };
        }
        course = candidates[0] ?? null;
      }
      if (!course) {
        return { ok: false, courseNotFound: true, courseName: file.courseName };
      }

      // remote_id 去重导入
      let created = 0, updated = 0;
      const items: any[] = [];
      for (const e of file.entries as HomeworkEntry[]) {
        const remoteId = `${n}:${e.id}`;
        const exist = await deps.sql.get<any>('SELECT * FROM course_requirements WHERE remote_id=?', [remoteId]);
        const due = e.dueDate ?? (e.sessionDate ? new Date(e.sessionDate).getTime() : Date.now());
        if (exist) {
          await deps.sql.run(
            'UPDATE course_requirements SET title=?, content=?, description=?, due_date=?, updated=?, source=? WHERE id=?',
            [e.title, e.content, e.content, due, Date.now(), SYNCED_SOURCE_TAG, exist.id],
          );
          updated++;
          items.push({ courseId: course.id, courseName: course.name, title: e.title, sessionDate: e.sessionDate, action: 'updated' });
        } else {
          await deps.sql.run(
            `INSERT INTO course_requirements (course_id, title, type, description, due_date, priority, status, created_at, source, remote_id, session_date, publisher)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [course.id, e.title, e.type || 'homework', e.content, due, 2, 'pending', Date.now(), SYNCED_SOURCE_TAG, remoteId, e.sessionDate, e.publisher],
          );
          created++;
          items.push({ courseId: course.id, courseName: course.name, title: e.title, sessionDate: e.sessionDate, action: 'created' });
        }
      }
      return {
        ok: true, source: 'ssio', syncCode: n, courseName: file.courseName,
        entries: file.entries.length, created, updated,
        coursesTouched: 1, coursesCreated: [],
        perCourse: [{ courseId: course.id, courseName: course.name, entries: file.entries.length, created, updated }],
        items, syncedAt: Date.now(),
      };
    },

    // ===== ai（工具调用 + 流式问答）=====
    'ai:config:get': async () => {
      // ⚠ 必须先同步凭据再判断 hasKey：siteToken 是模块级内存态，
      // 不先 sync 就会出现「已登录网站、但面板判定无凭据」→ 输入框禁用 → 点了没反应。
      await syncAiAuth();
      const s = await settingsMap(deps);
      const info = aiKeyInfo();
      return {
        hasKey: info.source !== 'none',
        keyTail: info.source === 'custom'
          ? `…${info.tail}（自定义 Key）`
          : info.source === 'site'
            ? '网站账号（登录态，扣自己的 tokens）'
            : '（未配置：可登录网站账号，或到钱包签发 Key）',
        insecure: false,
        model: normalizeModel(s.ai_model),
        privacyOn: s.ai_privacy !== '0',
        baseUrl: s.ai_base_url || '（SSIO AI 网关）',
      };
    },
    'ai:config:save': async (patch: any) => {
      if (patch.model) await setSetting(deps, 'ai_model', patch.model);
      if (patch.baseUrl) await setSetting(deps, 'ai_base_url', patch.baseUrl);
      if (patch.privacyOn != null) await setSetting(deps, 'ai_privacy', patch.privacyOn ? '1' : '0');
      // 显式清空（''）必须真的删掉覆盖，否则"清空后仍 401"——之前就是这么踩的坑
      if (patch.key !== undefined && !String(patch.key ?? '').trim()) {
        await setSetting(deps, 'ai_key_override', '');
        setAiKey('');
        return { ...(await handlers['ai:config:get']()), lastError: '已清除自定义 Key，回到应用内置网关' };
      }
      if (patch.key) {
        // 清洗：粘贴时常混入中文/全角/零宽字符 → 构造 Headers 直接抛
        // "String contains non ISO-8859-1 code point"（用户看到的就是这个报错）。
        const clean = sanitizeKey(patch.key);
        if (!clean) {
          return { ...(await handlers['ai:config:get']()), lastError: 'Key 里没有可用的 ASCII 字符（可能粘贴了中文或空白），请重新复制' };
        }
        if (clean !== String(patch.key)) {
          await setSetting(deps, 'ai_key_override', clean);
          configureAiGateway({ http: deps.http, key: clean });
          const cfg = await handlers['ai:config:get']();
          return { ...cfg, lastError: `已自动去掉 Key 中的 ${String(patch.key).length - clean.length} 个非法字符` };
        }
        // 防呆：历史版本里硬编码过一把别人的 Key，那把已被服务端吊销（KEY_REVOKED）。
        if (clean.startsWith('ssio_live_shKz')) {
          return { ...(await handlers['ai:config:get']()), lastError: '这把 Key 已被服务端吊销（KEY_REVOKED），请留空使用应用内置网关' };
        }
        await setSetting(deps, 'ai_key_override', clean);
        setAiKey(clean);
      }
      if (patch.baseUrl || patch.key) {
        configureAiGateway({ http: deps.http, baseUrl: patch.baseUrl || undefined, key: patch.key || undefined });
      }
      return handlers['ai:config:get']();
    },
    'ai:test': async () => {
      try {
        await syncAiAuth();
        const { aiComplete } = await import('../cloud/aiGateway');
        const { content } = await aiComplete([{ role: 'user', content: '回复 ok 即可' }]);
        return { ok: true, models: ['deepseek-flash', 'deepseek-v4-pro'], message: `网关连通（回复：${content.slice(0, 20)}）` };
      } catch (e: any) {
        // 把「当前用哪把 Key」一起报出来：401 时最关键的信息就是这把 Key 的来源
        const info = aiKeyInfo();
        const which = info.source === 'custom'
          ? `自定义 Key …${info.tail}`
          : info.source === 'site'
            ? '网站账号登录态'
            : '未配置（登录网站账号或在钱包签发 Key）';
        return { ok: false, models: [], message: `${e?.message || String(e)}（当前使用：${which}）` };
      }
    },
    'ai:snapshot': async () => buildAiSnapshot(deps),
    'ai:chat': async (payload: { requestId: string; messages: Array<{ role: 'user' | 'assistant'; content: string }> }) => {
      await syncAiAuth(); // 每次对话前刷新凭据（登录态/自定义 Key 都可能刚变）
      // 多轮工具调用循环（上限 5 轮）
      // 把用户真实数据（课程/日程/待办/考试）塞进系统提示——
      // 否则模型会答「我没有你的数据来源」，因为纯对话请求不带任何上下文。
      const snap = await buildAiSnapshot(deps);
      const messages: AiChatMessage[] = [
        {
          role: 'system',
          content: [
            '你是 StarTasks 学习助手，服务对象是这名学生本人。',
            '下面【数据快照】是他的真实数据（来自本地数据库，已脱敏，可直接引用）。',
            '回答时优先依据快照；快照里没有的信息就直说没有，不要编造。',
            '涉及具体日期时请换算成「周几 / 第几周」便于理解。',
            '',
            snap.text,
            '',
            capabilityPrompt(),
          ].join('\n'),
        },
        ...payload.messages.map((m) => ({ role: m.role, content: m.content }) as AiChatMessage),
      ];
      // 单次会话窗口压到 10K tokens（约官方的 1/10），避免长对话把快照挤掉
      const windowed = compactMessages(messages, 10_000);
      const cfg = await settingsMap(deps);
      // 默认**不发送 tools**：网站代理端点不保证支持 function calling，
      // 带上 tools 时请求会挂住（无任何数据返回），这也是「测试能通、对话没反应」的原因。
      // 需要 AI 改数据时在设置里打开 ai_tools=1。
      const useTools = cfg.ai_tools === '1';
      void (async () => {
        try {
          for (let round = 0; round < 5; round++) {
            // 看门狗：90s 内没有任何结果就明确报错，而不是让加载动画转到天荒地老
            const streamPromise = aiChatStream(windowed, {
              onText: (delta) => emit(deps, 'ai:delta', { requestId: payload.requestId, text: delta }),
            }, useTools ? { tools: TOOL_DEFS } : {});
            const watchdog = new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error('AI 响应超时（90 秒无数据）——请检查网络或换一个模型重试')), 90_000);
            });
            const { content, toolCalls, usage } = await Promise.race([streamPromise, watchdog]);

            if (!toolCalls.length) {
              // 解析 prompt 约定的 action 块（**支持一次多个**，逐个生成确认卡片）
              const parsedList = extractActionBlocks(content);
              if (parsedList.length) {
                const clean = stripActionBlocks(content);
                let first = true;
                for (const parsed of parsedList) {
                  try {
                    const result = await executeToolCall(
                      { id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: parsed.name, arguments: JSON.stringify(parsed.arguments) },
                      { api: (globalThis as any).window?.taskAPI ?? makeLazyApi(deps) },
                    );
                    if (result.pendingAction) {
                      pendingActions.push(result.pendingAction);
                      emit(deps, 'ai:action', {
                        requestId: payload.requestId,
                        action: { ...result.pendingAction, toolCallId: '' },
                        // 只在第一张卡片上回传清洗后的正文，避免把最后一条消息反复覆盖
                        cleanText: first ? clean || result.pendingAction.label : undefined,
                      });
                      first = false;
                    }
                  } catch (e: any) {
                    emit(deps, 'ai:error', {
                      requestId: payload.requestId,
                      code: 'AI_ACTION',
                      message: `${parsed.name} 解析失败：${e?.message || e}`,
                    });
                  }
                }
              }
              emit(deps, 'ai:done', { requestId: payload.requestId, usage, tokens: usage?.total_tokens ?? 0, stats: {} });
              return;
            }
            windowed.push({ role: 'assistant', content: content || null, tool_calls: toolCalls.map((t) => ({ id: t.id, type: 'function' as const, function: { name: t.name, arguments: t.arguments } })) });
            for (const tc of toolCalls) {
              const result = await executeToolCall(tc, { api: (globalThis as any).window?.taskAPI ?? makeLazyApi(deps) });
              if (result.pendingAction) {
                pendingActions.push(result.pendingAction);
                emit(deps, 'ai:action', {
                  requestId: payload.requestId,
                  action: { ...result.pendingAction, toolCallId: tc.id },
                  cleanText: result.pendingAction.label,
                });
              }
              windowed.push({ role: 'tool', content: result.payload, tool_call_id: tc.id });
            }
          }
          emit(deps, 'ai:done', { requestId: payload.requestId, tokens: 0, stats: {} });
        } catch (e: any) {
          emit(deps, 'ai:error', { requestId: payload.requestId, code: 'AI_ERROR', message: e?.message || String(e) });
        }
      })();
      return { started: true };
    },
    'ai:cancel': async (requestId: string) => {
      void requestId; // 简化：当前轮自然结束
      return true;
    },
    'ai:plan': async (action: any) => {
      return {
        ok: true, kind: action?.kind, message: '已生成预演',
        target: { id: null, title: action?.params?.title || '' },
        diff: action?.diff || [],
      };
    },
    'ai:confirm': async (action: PendingAction) => {
      const r = await confirmToolCall(action, { api: (globalThis as any).window?.taskAPI ?? makeLazyApi(deps) });
      return { ok: r.ok, message: r.message, id: r.id, kind: action.kind };
    },
    'ai:undo': async (_token: string) => ({ ok: false, message: '撤销窗口已过期或不支持' }),
    'ai:calls': async (limit?: number) => {
      const rows = await deps.sql.all('SELECT * FROM ai_calls ORDER BY ts DESC LIMIT ?', [limit ?? 20]);
      return rows;
    },
    // ===== AI 对话历史（关闭窗口/重启后仍可继续）=====
    'ai:history:get': async () => {
      const s = await settingsMap(deps);
      try {
        const list = s.ai_history ? JSON.parse(s.ai_history) : [];
        return { ok: true, messages: Array.isArray(list) ? list : [] };
      } catch {
        return { ok: true, messages: [] };
      }
    },
    'ai:history:save': async (msgs: Array<{ role: string; content: string }>) => {
      const list = Array.isArray(msgs) ? msgs.slice(-100) : [];
      const json = JSON.stringify(list);
      if (json.length > 200_000) return { ok: false, error: '对话过长，未保存' };
      await setSetting(deps, 'ai_history', json);
      return { ok: true, count: list.length };
    },
    'ai:history:clear': async () => {
      await setSetting(deps, 'ai_history', '');
      return { ok: true };
    },

    // ===== ustb（贝壳课表 + 成绩；协议在 ustb/client.ts，传输走平台 HTTP）=====
    'ustb:status': async () => {
      const s = await settingsMap(deps);
      return { loggedIn: s.ustb_session === '1', message: s.ustb_session === '1' ? '教务已登录' : '未登录' };
    },
    'ustb:qr:start': async () => {
      try {
        const s = await settingsMap(deps);
        const ctx = createUstbContext(s.ustb_cookies);
        await startQrLogin(ctx);
        const qr = await getQrImage(ctx);
        // 会话整体落库（含 CookieJar 与 sid）：poll 时重建，不依赖进程内存
        await setSetting(deps, 'ustb_ctx', serializeUstbCtx(ctx));
        return { ok: true, sessionId: ctx.sid, qrImage: qr, qr };
      } catch (e: any) {
        return { ok: false, error: e?.message || String(e) };
      }
    },
    'ustb:qr:poll': async (sessionId?: string) => {
      try {
        const s = await settingsMap(deps);
        const ctx = deserializeUstbCtx(s.ustb_ctx);
        if (!ctx) return { status: 'error', message: '会话不存在（可能是应用重启或二维码已刷新），请重新发起登录' };
        if (sessionId && ctx.sid && sessionId !== ctx.sid) {
          return { status: 'error', message: '二维码已刷新，请用最新二维码扫码' };
        }
        const r = await pollQrStatus(ctx);
        if (r.status === 'success' && r.passcode) {
          const user = await completeQrLogin(ctx, r.passcode);
          await setSetting(deps, 'ustb_cookies', ctx.jar.toJSON());
          await setSetting(deps, 'ustb_session', '1');
          await setSetting(deps, 'ustb_user', JSON.stringify(user));
          await setSetting(deps, 'ustb_ctx', '');
          return { ...r, user };
        }
        // 轮询过程中 cookie / sid 可能刷新，回写保持最新
        if (r.status !== 'expired') {
          await setSetting(deps, 'ustb_ctx', serializeUstbCtx(ctx)).catch(() => { /* noop */ });
        }
        return r;
      } catch (e: any) {
        return { status: 'error', message: e?.message || String(e) };
      }
    },
    'ustb:qr:cancel': async () => {
      await setSetting(deps, 'ustb_ctx', '').catch(() => { /* noop */ });
      return { ok: true };
    },
    /** 预览：拉课表并解析（不写库）；失败直接抛错，前端显示真实原因 */
    'ustb:preview': async (term?: { xn?: string; xq?: string }) => {
      const s = await settingsMap(deps);
      if (s.ustb_session !== '1') throw new Error('请先扫码登录教务');
      const ctx = createUstbContext(s.ustb_cookies);
      const xn = term?.xn || defaultXn();
      const xq = String(term?.xq ?? '1');
      const raw = await fetchCurriculum(ctx, xn, xq);
      await setSetting(deps, 'ustb_cookies', ctx.jar.toJSON()).catch(() => { /* noop */ });
      const items = parseCurriculum(raw as any[]);
      const user = s.ustb_user ? (() => { try { return JSON.parse(s.ustb_user); } catch { return null; } })() : null;
      return { items, user, rawCount: raw.length };
    },
    /** 导入：解析 → 替换上次导入的课程/事件（手动数据不受影响） */
    'ustb:import': async (opts: { xn: string; xq: string; semesterStart: number }) => {
      const s = await settingsMap(deps);
      if (s.ustb_session !== '1') throw new Error('请先扫码登录教务');
      const ctx = createUstbContext(s.ustb_cookies);
      const xn = opts?.xn || defaultXn();
      const xq = String(opts?.xq ?? '1');
      if (!opts?.semesterStart) throw new Error('请先设置第 1 周周一的日期');
      const raw = await fetchCurriculum(ctx, xn, xq);
      const items = parseCurriculum(raw as any[]);
      if (!items.length) throw new Error('该学期没有解析到任何课程（可能未选课或接口字段变化）');
      const periods = await fetchPeriods(ctx, xn, xq);
      await setSetting(deps, 'ustb_cookies', ctx.jar.toJSON()).catch(() => { /* noop */ });

      /**
       * 第 1 周周一：**优先用教务返回的当前教学周反推**，别再猜校历。
       * 算法：本周周一 − (当前周 − 1) × 7 天。
       * 之前固定「9 月首个周一」，一旦学校实际校历差一周 → 整张课表串一周。
       */
      let semesterStart = opts.semesterStart;
      const hint = getLastWeekHint();
      let usedHint = false;
      if (hint && hint >= 1) {
        const now = new Date();
        const dow = now.getDay();
        const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (dow === 0 ? 6 : dow - 1));
        semesterStart = monday.getTime() - (hint - 1) * 7 * 86400000;
        usedHint = true;
      }
      const res = await importUstbCurriculum(deps, items, { xn, xq, semesterStart, periods });
      return { ...res, weekHint: usedHint ? hint : null, semesterStart };
    },
    /**
     * 周次校正：把「教务导入的课程事件」整体平移 N 周（±）。
     * 用途：自动推断的开学日和学校实际校历差一周时，一键对齐，不必重新导入。
     * 手动添加的日程/课程不受影响（只动 ustb_imported_courses 里的课程）。
     */
    'ustb:shiftWeek': async (weeks: number) => {
      const w = Math.max(-4, Math.min(4, Math.round(Number(weeks) || 0)));
      if (!w) return { ok: true, shifted: 0, weeks: 0 };
      const s = await settingsMap(deps);
      let ids: number[] = [];
      try { ids = s.ustb_imported_courses ? JSON.parse(s.ustb_imported_courses) : []; } catch { ids = []; }
      if (!ids.length) throw new Error('还没有从教务导入过课程，无法校正');
      const d = w * 7 * 86400000;
      const ph = ids.map(() => '?').join(',');
      const row = await deps.sql.get<{ n: number }>(`SELECT COUNT(*) AS n FROM events WHERE course_id IN (${ph})`, ids);
      await deps.sql.run(
        `UPDATE events SET start_at = start_at + ?, end_at = CASE WHEN end_at IS NULL THEN NULL ELSE end_at + ? END WHERE course_id IN (${ph})`,
        [d, d, ...ids],
      );
      const sem = Number(s.semester_start || 0);
      if (sem) await setSetting(deps, 'semester_start', String(sem + d));
      return { ok: true, shifted: row?.n ?? 0, weeks: w };
    },
    /** 成绩同步：教务 → grades 表（total 成分，幂等按课程名+学期覆盖） */
    'ustb:syncGrades': async (xn?: string, xq?: string) => {
      try {
        const s = await settingsMap(deps);
        if (s.ustb_session !== '1') return { ok: false, error: '请先登录教务（扫码）', errorCode: 'NOT_LOGGED_IN' };
        const ctx = createUstbContext(s.ustb_cookies);
        const raw = await fetchGrades(ctx, xn || defaultXn(), xq ?? '0');
        await setSetting(deps, 'ustb_cookies', ctx.jar.toJSON());
        let imported = 0;
        const details: Array<{ course: string; score: number | null }> = [];
        for (const row of raw) {
          const g = mapGradeRow(row);
          if (!g) continue;
          // 找/建课程
          let course = await deps.sql.get<any>('SELECT * FROM courses WHERE name = ? ORDER BY id LIMIT 1', [g.courseName]);
          if (!course) {
            await deps.sql.run(
              'INSERT INTO courses (name, credit, category, course_status, color, tags, created_at) VALUES (?,?,?,?,?,?,?)',
              [g.courseName, g.credit, 'elective', 'done', '#00FF88', '[]', Date.now()],
            );
            course = await deps.sql.get<any>('SELECT * FROM courses WHERE name = ? ORDER BY id DESC LIMIT 1', [g.courseName]);
          }
          const existing = await deps.sql.get<any>(
            "SELECT id FROM grades WHERE course_id = ? AND component = 'total'", [course.id],
          );
          const notes = g.notes || (g.gpa != null ? `教务绩点 ${g.gpa}` : '教务同步');
          if (existing) {
            await deps.sql.run('UPDATE grades SET score = ?, credit = ?, semester = ?, notes = ?, updated_at = ? WHERE id = ?',
              [g.score, g.credit || 0, g.semester || null, notes, Date.now(), existing.id]);
          } else {
            await deps.sql.run(
              "INSERT INTO grades (course_id, semester, component, score, credit, full_score, notes, created_at, updated_at) VALUES (?,?, 'total', ?,?,100,?,?,?)",
              [course.id, g.semester || null, g.score, g.credit || 0, notes, Date.now(), Date.now()],
            );
          }
          imported++;
          details.push({ course: g.courseName, score: g.score });
        }
        return { ok: true, imported, details };
      } catch (e: any) {
        return { ok: false, error: e?.message || String(e) };
      }
    },
    'ustb:logout': async () => {
      await setSetting(deps, 'ustb_session', '0');
      await setSetting(deps, 'ustb_cookies', '');
      await setSetting(deps, 'ustb_user', '');
      return { ok: true };
    },

    // ===== xls（解析在浏览器侧 xlsx + AI 智能识别；选文件走平台）=====
    'xls:pickFile': () => deps.pickFile({ filters: [{ name: '课表 Excel', extensions: ['xlsx', 'xls', 'csv'] }] }),
    'xls:listProfiles': async () => {
      const { listProfiles } = await import('../xls/profiles');
      return listProfiles();
    },
    'xls:parseBuffer': async (buffer: ArrayBuffer, profileId?: string) => {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(buffer, { type: 'array' });
      const sheetName = wb.SheetNames[0];
      const aoa = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName], { header: 1, defval: '' });

      // ⭐ AI 智能识别（用户新需求）：优先 AI 推断，失败降级传统档案
      const rec: AiXlsRecognition = await recognizeTimetableXls(sheetName, aoa);
      const profileIdFinal = profileId || rec.profileId;
      const { getProfile, detectProfile } = await import('../xls/profiles');
      const profile = getProfile(profileIdFinal) || getProfile('generic')!;
      const parsed = profile.layout === 'records'
        ? (() => {
            const generic = profile;
            return generic.parse(aoa);
          })()
        : profile.parse(aoa);

      return {
        sheetName,
        profile: { id: profile.id, name: profile.name, layout: profile.layout, note: profile.note },
        detected: { id: rec.profileId, confidence: rec.confidence },
        needMapping: parsed.needMapping,
        headers: parsed.headers || [],
        rows: parsed.rows || [],
        totalRows: (parsed.rows || []).length,
        mapping: parsed.mapping || rec.mapping,
        preview: (parsed.items || []).slice(0, 20),
        items: parsed.items || rec.items,
        warnings: [...(parsed.warnings || []), ...(rec.source === 'ai' ? [] : ['AI 识别不可用，已用传统档案猜测'])],
        badRows: parsed.badRows || [],
        term: parsed.term ?? (rec.term ? { xn: rec.term.xn, xq: rec.term.xq, totalWeeks: rec.term.totalWeeks } : undefined),
        aiRecognition: { source: rec.source, confidence: rec.confidence, reasoning: rec.reasoning },
      } as any;
    },
    'xls:parseFile': async (filePath: string, profileId?: string) => {
      const bytes = await deps.readFile(filePath);
      return handlers['xls:parseBuffer'](bytes.buffer as ArrayBuffer, profileId);
    },
    'xls:reparse': async (parsed: any, mapping: any) => {
      const { parseRecords } = await import('../xls/profiles/generic');
      const r = parseRecords(parsed.headers, parsed.rows, mapping);
      return { ...parsed, mapping, items: r.items, warnings: r.warnings, badRows: r.badRows, preview: r.items.slice(0, 20) };
    },
    'xls:importItems': async (items: any[], opts: { xn: string; xq: '1' | '2'; semesterStart: number; replaceExisting: boolean }) => {
      // 按 (className, teacher) 聚合建课 + 生成 events
      const byCourse = new Map<string, any[]>();
      for (const it of items) {
        const key = `${it.className}|${it.teacher}`;
        if (!byCourse.has(key)) byCourse.set(key, []);
        byCourse.get(key)!.push(it);
      }
      const courseIds: number[] = [];
      let events = 0;
      for (const [key, list] of byCourse) {
        const [name, teacher] = key.split('|');
        let course = await deps.sql.get<any>('SELECT * FROM courses WHERE name=? AND (instructor=? OR (instructor IS NULL AND ?=?))', [name, teacher, teacher, teacher]);
        if (!course) {
          const created = await (globalThis as any).window?.taskAPI?.db?.courses?.create?.({ name, instructor: teacher, semester: `${opts.xn}-${opts.xq}` });
          course = created ?? await deps.sql.get<any>('SELECT * FROM courses WHERE name=? ORDER BY id DESC LIMIT 1', [name]);
        }
        if (course?.id) courseIds.push(course.id);
        for (const it of list) {
          for (const week of it.weeks?.length ? it.weeks : [1]) {
            const dayOffset = (it.day - 1) + (week - 1) * 7;
            const start = opts.semesterStart + dayOffset * 86400000;
            await deps.sql.run(
              `INSERT INTO events (title, start_at, end_at, location, course_id, type, notes)
               VALUES (?,?,?,?,?, 'event', ?)`,
              [it.className, start, start + 3600000, it.location || null, course?.id ?? null, `第${week}周 ${it.periodName || ''}`],
            );
            events++;
          }
        }
      }
      return { ok: true, courses: courseIds.length, events, items: items.length, courseIds, warnings: [] };
    },
    'xls:lastImport': async () => {
      const s = await settingsMap(deps);
      return { lastSync: s.xls_last_import ? Number(s.xls_last_import) : 0, courseCount: 0 };
    },

    // ===== about（SSIO 单源）—— 通道名用连字符（与 api-factory 一致）=====
    'about:get-cache': async () => {
      const s = await settingsMap(deps);
      return { text: s.about_text || 'StarTasks v2（Tauri）', source: 'local', pinned: s.about_pinned === '1', pulledAt: s.about_pulled_at ? Number(s.about_pulled_at) : undefined };
    },
    'about:refresh': async () => {
      try {
        await kvGetJson(SSIO_KEYS.manifest);
        return { ok: true, source: 'ssio', results: [], pulledAt: Date.now(), size: 0, sha256: '' };
      } catch (e: any) {
        return { ok: false, error: e?.message || String(e), results: [] };
      }
    },
    'about:save-local': async (text: string) => {
      await setSetting(deps, 'about_text', text);
      return { ok: true };
    },
    'about:set-pinned': async (pinned: boolean) => {
      await setSetting(deps, 'about_pinned', pinned ? '1' : '0');
      return { ok: true, pinned };
    },
    'about:cache-path': async () => '',
    'about:open-cache': async () => ({ ok: true }),

    // ===== input:diag（降级：不再写系统日志，保留导出壳）=====
    'input:diag:peek': async () => ({
      ok: true, path: '', byteCount: 0, recent: [],
      note: 'Tauri 版输入诊断已降级（不再采集系统级探测）',
    }),
    'input:diag:export': async () => {
      const p = await deps.saveFile({ defaultName: 'taskmanager-input-diag.log' });
      if (!p) return { ok: false, canceled: true };
      await deps.writeFile(p, '（Tauri 版输入诊断已降级，无采集数据）\n');
      return { ok: true, path: p };
    },

    // ===== webdav（坚果云异机备份通道——配置保留，同步后移）=====
    'webdav:config': async () => {
      const s = await settingsMap(deps);
      return {
        url: s.webdav_url || '', user: s.webdav_user || '',
        hasPass: !!s.webdav_pass, configured: !!(s.webdav_url && s.webdav_user),
      };
    },
    'webdav:save': async (cfg: { url?: string; user?: string; pass?: string; clearPass?: boolean }) => {
      if (cfg.url != null) await setSetting(deps, 'webdav_url', cfg.url);
      if (cfg.user != null) await setSetting(deps, 'webdav_user', cfg.user);
      if (cfg.clearPass) await setSetting(deps, 'webdav_pass', '');
      else if (cfg.pass != null) await setSetting(deps, 'webdav_pass', cfg.pass);
      return { ok: true };
    },
    'webdav:test': async () => ({ ok: false, error: 'WebDAV 同步在 v2 后续版本启用（配置已保留）', deferred: true }),
    'webdav:push': async () => ({ ok: false, error: 'WebDAV 同步在 v2 后续版本启用（配置已保留）', deferred: true }),
    'webdav:remoteInfo': async () => ({ ok: false, exists: false, error: 'WebDAV 同步在 v2 后续版本启用', deferred: true }),
    'webdav:pull': async () => ({ ok: false, error: 'WebDAV 同步在 v2 后续版本启用（配置已保留）', deferred: true }),

    // ===== cleanup / 回收站（纯 SQL）=====
    'cleanup:rules': async () => {
      const s = await settingsMap(deps);
      return {
        enabled: s.cleanup_enabled !== '0',
        reqDays: Number(s.cleanup_req_days || 30),
        taskDays: Number(s.cleanup_task_days || 30),
        eventDays: Number(s.cleanup_event_days || 90),
        projectDays: Number(s.cleanup_project_days || 180),
        homeworkDays: Number(s.cleanup_homework_days || 60),
        binDays: Number(s.cleanup_bin_days || 30),
      };
    },
    'cleanup:setRules': async (patch: any) => {
      for (const [k, v] of Object.entries(patch)) {
        await setSetting(deps, 'cleanup_' + k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()), String(v));
      }
      return handlers['cleanup:rules']();
    },
    'cleanup:run': async () => {
      const rules = await handlers['cleanup:rules']();
      const now = Date.now();
      const cutoff = now - rules.binDays * 86400000;
      // 回收站到期真删
      const purged = await deps.sql.run('DELETE FROM recycle_bin WHERE purge_at < ?', [now]);
      // 过期完成项入回收站（示例：仅 requirements）
      const old = now - rules.reqDays * 86400000;
      const done = await deps.sql.all<any>("SELECT * FROM course_requirements WHERE status='done' AND completed_at < ?", [old]);
      for (const r of done) {
        await deps.sql.run('INSERT INTO recycle_bin (kind, entity_id, snapshot, reason, deleted_at, purge_at) VALUES (?,?,?,?,?,?)',
          ['requirement', r.id, JSON.stringify(r), 'auto-cleanup', now, now + rules.binDays * 86400000]);
        await deps.sql.run('DELETE FROM course_requirements WHERE id=?', [r.id]);
      }
      return {
        local: { ranAt: now, enabled: rules.enabled, binned: { requirements: done.length, tasks: 0, events: 0, projects: 0 }, purgedBin: purged },
        cloud: { ranAt: now, codes: [], ssio: { checked: 0, rewritten: 0, deleted: 0, removedEntries: 0, errors: [] } },
      };
    },
    'cleanup:bin': async (opts?: { kind?: string; limit?: number }) => {
      if (opts?.kind) return deps.sql.all('SELECT * FROM recycle_bin WHERE kind=? ORDER BY deleted_at DESC LIMIT ?', [opts.kind, opts.limit ?? 100]);
      return deps.sql.all('SELECT * FROM recycle_bin ORDER BY deleted_at DESC LIMIT ?', [opts?.limit ?? 100]);
    },
    'cleanup:bin:restore': async (id: number) => {
      const row = await deps.sql.get<any>('SELECT * FROM recycle_bin WHERE id=?', [id]);
      if (!row) return { ok: false, error: '记录不存在' };
      const snap = JSON.parse(row.snapshot || '{}');
      if (row.kind === 'requirement') {
        await deps.sql.run(
          `INSERT INTO course_requirements (course_id, title, type, description, due_date, priority, status, created_at, source, remote_id, session_date, publisher)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [snap.course_id, snap.title, snap.type, snap.description, snap.due_date, snap.priority, snap.status, snap.created_at, snap.source, snap.remote_id, snap.session_date, snap.publisher],
        );
      }
      await deps.sql.run('DELETE FROM recycle_bin WHERE id=?', [id]);
      return { ok: true };
    },
    'cleanup:bin:purge': async (id?: number | null) => {
      const n = id ? await deps.sql.run('DELETE FROM recycle_bin WHERE id=?', [id]) : await deps.sql.run('DELETE FROM recycle_bin');
      return { purged: n };
    },
  };

  return handlers;
}

// ===== 小工具 =====

async function settingsMap(deps: PlatformDeps): Promise<Record<string, string>> {
  const rows = await deps.sql.all<{ key: string; value: string }>('SELECT * FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** 粗略 token 估算：中文约 1.5 字符/token，英文约 4 */
function estimateTokens(s: string): number {
  if (!s) return 0;
  return Math.ceil(s.length / 1.5);
}

/**
 * 上下文压缩：单次会话窗口压到 budget（默认 10K tokens）。
 * 保留 system（快照+能力）与**最近的**对话，超出部分直接丢弃并留一行说明。
 * 纯前端压缩，不依赖服务端 summary，行为可预测。
 */
function compactMessages<T extends { role: string; content: string | null }>(msgs: T[], budget: number): T[] {
  if (!msgs.length) return msgs;
  const head = msgs[0];
  const rest = msgs.slice(1);
  let used = estimateTokens(head.content || '');
  const kept: T[] = [];
  for (let i = rest.length - 1; i >= 0; i--) {
    const cost = estimateTokens(rest[i].content || '');
    if (used + cost > budget && kept.length > 0) break;
    used += cost;
    kept.unshift(rest[i]);
  }
  const dropped = rest.length - kept.length;
  if (dropped > 0) {
    kept.unshift({ role: 'system', content: `（上下文已压缩：更早的 ${dropped} 条消息已省略）` } as T);
  }
  return [head, ...kept];
}

/** 把 TOOL_DEFS 渲染成「能力清单」写进系统提示，让模型知道自己能做什么 */
function capabilityPrompt(): string {
  const defs = TOOL_DEFS as any[];
  const lines = defs.map((d) => {
    const f = d.function || d;
    const params = f.parameters?.properties ? Object.keys(f.parameters.properties).join(', ') : '';
    return `- ${f.name}：${f.description || ''}${params ? `（参数：${params}）` : ''}`;
  });
  return [
    '【你可以调用的接口】',
    ...lines,
    '',
    '当用户要求新增/修改数据时，**不要说自己没有接口**。请直接在回复末尾输出一个 action 代码块（客户端会弹出确认卡片，用户点确认后才真正写入）：',
    '```action',
    '{"name":"create_event","arguments":{"title":"面试","start":"2026-11-03 13:30","end":"2026-11-03 15:00","location":"公司"}}',
    '```',
    '规则：',
    '1. 只读数据已在【数据快照】里，直接引用即可；确实需要更多细节时用 query_* 接口。',
    '2. 写操作只输出 action 块，不要声称"已经添加"——必须等用户点确认。',
    '3. action 块之外可以正常写自然语言说明，块内必须是合法 JSON。',
    '4. 时间统一用 `YYYY-MM-DD HH:mm`（本地时间）。',
    '5. **只有你真的输出了 action 块，才可以对用户说「已生成确认卡片」**；没输出就别说，直接说明缺什么信息（标题/时间）。',
    '6. 代码块请用 ```action 开头（用 ```json 也能被识别，但 action 更明确）。',
    '7. 用户一次要办多件事时，**可以输出多个 action 块**（每件事一个块，块之间用换行分隔），客户端会为每个块各生成一张确认卡片。',
  ].join('\n');
}

/**
 * 从模型回复里抽出 ```action {...}``` 块。
 * 这样即使代理端点不支持 function calling，AI 也能"发起写操作"（仍需用户确认）。
 */
function toMs(v: any): number | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const s = String(v).trim();
  // 允许 "2026-11-03 13:30" / "2026-11-03T13:30" / "2026-11-03"
  const t = new Date(s.includes('T') ? s : s.includes(' ') ? s.replace(' ', 'T') : `${s}T00:00`).getTime();
  return Number.isFinite(t) ? t : undefined;
}

/** 尝试把一段文本解析成 {name, args}（兼容 name/tool/tool_calls 三种写法） */
function parseActionJson(raw: string): { name: string; args: any } | null {
  try {
    const j = JSON.parse(raw);
    const tc = j?.tool_calls?.[0]?.function;
    if (tc?.name) {
      const a = typeof tc.arguments === 'string' ? JSON.parse(tc.arguments || '{}') : (tc.arguments || {});
      return { name: String(tc.name), args: a };
    }
    const name = j?.name || j?.tool;
    if (!name) return null;
    return { name: String(name), args: j?.arguments ?? j?.params ?? {} };
  } catch {
    return null;
  }
}

/** 在裸文本里扫平衡括号的 JSON（模型有时连 ``` 都不写） */
function findBareJson(text: string): { json: string; index: number } | null {
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const sub = text.slice(start, i + 1);
          if (/"name"|"tool"|"tool_calls"/.test(sub)) return { json: sub, index: start };
          break;
        }
      }
    }
  }
  return null;
}

function extractActionBlocks(text: string): Array<{ name: string; arguments: any }> {
  if (!text) return [];
  const out: Array<{ name: string; arguments: any }> = [];
  const consumed: string[] = [];

  // 1) 所有代码块：```action / ```tool / ```json / ```（无标记）通吃
  for (const m of text.matchAll(/```[a-zA-Z]*[ \t]*\n?([\s\S]*?)```/g)) {
    const p = parseActionJson(String(m[1]).trim());
    if (p) { out.push({ name: p.name.trim(), arguments: { ...(p.args || {}) } }); consumed.push(m[0]); }
  }
  // 2) 没有可识别代码块 → 扫裸 JSON（可能有多段）
  if (!out.length) {
    let rest = text;
    for (let guard = 0; guard < 8; guard++) {
      const bare = findBareJson(rest);
      if (!bare) break;
      const p = parseActionJson(bare.json);
      if (!p) break;
      out.push({ name: p.name.trim(), arguments: { ...(p.args || {}) } });
      consumed.push(bare.json);
      rest = rest.slice(bare.index + bare.json.length);
    }
  }

  // 参数归一化：模型习惯写 "2026-11-03 13:30"，而工具要毫秒时间戳
  for (const a of out) {
    const name = a.name;
    const args = a.arguments;
    if (name === 'create_event') {
      const s = toMs(args.startAt ?? args.start_at ?? args.start);
      const e = toMs(args.endAt ?? args.end_at ?? args.end);
      if (s != null) args.startAt = s;
      if (e != null) args.endAt = e;
      delete args.start; delete args.end; delete args.start_at; delete args.end_at;
    }
    if (name === 'create_task') {
      const d = toMs(args.dueDate ?? args.due_date ?? args.due ?? args.deadline);
      if (d != null) args.dueDate = d;
      delete args.due; delete args.deadline; delete args.due_date;
    }
    if (name === 'query_events') {
      const f = toMs(args.from);
      const t = toMs(args.to);
      if (f != null) args.from = f;
      if (t != null) args.to = t;
    }
  }
  return out.filter((a) => a.name);
}

/** 从正文里剥掉所有 action 块，供界面显示干净文字 */
function stripActionBlocks(text: string): string {
  if (!text) return '';
  return text
    .replace(/```[a-zA-Z]*[ \t]*\n?([\s\S]*?)```/g, (whole, inner) => (parseActionJson(String(inner).trim()) ? '' : whole))
    .trim();
}

/** 本地时间格式：MM-DD HH:mm */
function fmtTs(ts?: number | null): string {
  if (!ts || !Number.isFinite(Number(ts))) return '—';
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * AI 上下文快照：把用户真实数据压成一段短文本（约 1-3k 字符），
 * 每次对话注入系统提示 —— 否则模型会答「我没有你的数据来源」。
 */
async function buildAiSnapshot(deps: PlatformDeps): Promise<{
  text: string;
  tokens: number;
  stats: { courses: number; requirements: number; exams: number; events: number; tasks: number; chars: number; truncated: boolean };
}> {
  const now = Date.now();
  const weekMs = 7 * 86400000;
  const safe = async (q: string, p: any[] = []): Promise<any[]> => {
    try { return await deps.sql.all<any>(q, p); } catch { return []; }
  };

  const courses = await safe('SELECT id, name, instructor, semester FROM courses ORDER BY id LIMIT 40');
  const events = await safe(
    'SELECT title, start_at, end_at, location, course_id FROM events WHERE start_at >= ? AND start_at < ? ORDER BY start_at LIMIT 40',
    [now - 86400000, now + weekMs],
  );
  const reqs = await safe(
    "SELECT title, due_date, course_id, priority FROM course_requirements WHERE status != 'done' ORDER BY due_date LIMIT 20",
  );
  const exams = await safe(
    'SELECT title, exam_date, location, course_id FROM exams WHERE exam_date >= ? ORDER BY exam_date LIMIT 10',
    [now],
  );

  const courseName = new Map<number, string>();
  for (const c of courses) courseName.set(Number(c.id), String(c.name || ''));
  const nameOf = (id: any) => (id ? courseName.get(Number(id)) || '' : '');

  let semesterStart: number | null = null;
  try {
    const s = await settingsMap(deps);
    semesterStart = s.semester_start ? Number(s.semester_start) : null;
  } catch { /* noop */ }

  const lines: string[] = [];
  const d = new Date(now);
  const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  let weekHint = '';
  if (semesterStart && Number.isFinite(semesterStart)) {
    const n = Math.floor((now - semesterStart) / weekMs) + 1;
    if (n > 0 && n < 40) weekHint = `，第 ${n} 周`;
  }
  lines.push(`今天是 ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 周${wd}${weekHint}。`, '');

  lines.push(`【课程】共 ${courses.length} 门`);
  for (const c of courses) {
    lines.push(`- ${c.name}${c.instructor ? `（${c.instructor}）` : ''}${c.semester ? ` · ${c.semester}` : ''}`);
  }
  lines.push('');

  lines.push(`【未来 7 天日程】共 ${events.length} 条`);
  for (const e of events) {
    const cn = nameOf(e.course_id);
    const end = e.end_at ? `-${fmtTs(e.end_at).slice(6)}` : '';
    lines.push(`- ${fmtTs(e.start_at)}${end} ${e.title}${e.location ? ` @ ${e.location}` : ''}${cn ? ` · ${cn}` : ''}`);
  }
  lines.push('');

  lines.push(`【未完成待办】共 ${reqs.length} 条`);
  for (const r of reqs) {
    const cn = nameOf(r.course_id);
    lines.push(`- ${r.title}${r.due_date ? `（截止 ${fmtTs(r.due_date)}）` : ''}${cn ? ` · ${cn}` : ''}`);
  }
  lines.push('');

  lines.push(`【近期考试】共 ${exams.length} 场`);
  for (const x of exams) {
    const cn = nameOf(x.course_id);
    lines.push(`- ${x.title} ${fmtTs(x.exam_date)}${x.location ? ` @ ${x.location}` : ''}${cn ? ` · ${cn}` : ''}`);
  }

  let body = lines.join('\n');
  const LIMIT = 3000;
  const truncated = body.length > LIMIT;
  if (truncated) body = body.slice(0, LIMIT) + '\n…（快照过长，已截断）';
  const text = `【数据快照】\n${body}`;

  return {
    text,
    tokens: Math.ceil(text.length / 2),
    stats: {
      courses: courses.length,
      requirements: reqs.length,
      exams: exams.length,
      events: events.length,
      tasks: 0,
      chars: text.length,
      truncated,
    },
  };
}

async function setSetting(deps: PlatformDeps, key: string, value: string): Promise<void> {
  await deps.sql.run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value]);
}

/**
 * 事件发送。
 *
 * ⚠ 必须走 **Tauri 事件通道**：前端是用 `@tauri-apps/api/event` 的 `listen('ai:delta')` 订阅的。
 * 以前这里发的是 DOM `CustomEvent`，两条通道压根不通 —— 表现为
 * 「Key 正常、测试能通、对话却一直转圈，一个字都出不来」（2.1.10 实测）。
 * 非 Tauri 环境（浏览器预览）才退回 DOM 事件兜底。
 */
function emit(deps: PlatformDeps, channel: string, payload: any): void {
  try {
    const w = (globalThis as any).window;
    if (w?.__TAURI_INTERNALS__?.invoke) {
      void import('@tauri-apps/api/event')
        .then(({ emit: tauriEmit }) => tauriEmit(channel, payload))
        .catch(() => { /* 事件发不出去也不影响主流程 */ });
      return;
    }
    w?.dispatchEvent?.(new CustomEvent(channel, { detail: payload }));
  } catch { /* noop */ }
}

/** 无 window.taskAPI 时的最小 db 访问（工具执行用） */
function makeLazyApi(deps: PlatformDeps) {
  return {
    db: {
      courses: {
        list: () => deps.sql.all('SELECT * FROM courses ORDER BY created_at DESC'),
        create: async (d: any) => {
          await deps.sql.run('INSERT INTO courses (name, instructor, color, created_at, guid) VALUES (?,?,?,?,?)',
            [d.name, d.instructor ?? null, d.color ?? '#00FF88', Date.now(), 'C-' + Math.random().toString(36).slice(2, 10).toUpperCase()]);
          return deps.sql.get('SELECT * FROM courses ORDER BY id DESC LIMIT 1');
        },
      },
      requirements: {
        list: () => deps.sql.all('SELECT r.*, c.name AS course_name FROM course_requirements r LEFT JOIN courses c ON r.course_id=c.id ORDER BY r.due_date'),
        create: async (d: any) => {
          await deps.sql.run(
            'INSERT INTO course_requirements (course_id, title, type, description, due_date, priority, status, created_at, source) VALUES (?,?,?,?,?,?,?,?,?)',
            [d.course_id ?? null, d.title, d.type ?? 'homework', d.description ?? null, d.due_date, d.priority ?? 2, 'pending', Date.now(), 'local'],
          );
          return deps.sql.get('SELECT * FROM course_requirements ORDER BY id DESC LIMIT 1');
        },
      },
      events: {
        list: (f: any) => deps.sql.all('SELECT * FROM events WHERE start_at >= ? AND start_at < ? ORDER BY start_at', [f?.from ?? 0, f?.to ?? Date.now() * 2]),
        create: async (d: any) => {
          await deps.sql.run('INSERT INTO events (title, start_at, end_at, location, notes, type) VALUES (?,?,?,?,?,?)',
            [d.title, d.start_at, d.end_at ?? null, d.location ?? null, d.notes ?? null, 'event']);
          return deps.sql.get('SELECT * FROM events ORDER BY id DESC LIMIT 1');
        },
      },
      stats: {
        dashboard: async () => {
          const r = await deps.sql.get<{ c: number }>('SELECT COUNT(*) AS c FROM course_requirements');
          return { totalReq: r?.c ?? 0, pendingReq: 0, overdueReq: 0, dueTodayReq: 0, dueWeekReq: 0, totalCourses: 0, activeProjects: 0, todayEvents: 0 };
        },
      },
    },
  };
}
