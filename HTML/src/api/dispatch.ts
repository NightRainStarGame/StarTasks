/**
 * 共享 invoke 分发器 —— 通道 → 处理器 映射。
 * db.* 用 SQL 层；window/app/ics 走平台能力；云命名空间（homework/class/ai/ustb/updater/...）
 * 由 cloudHandlers 注入（见 cloud/ 模块），未迁移的通道返回明确错误而不是静默失败。
 */
import type { PlatformDeps } from './platform';
import { createDbHandlers } from './dbHandlers';
import { createBackupHandlers } from './backupHandlers';
import { importLegacyDb } from './legacyImport';

export type ChannelHandler = (...args: any[]) => Promise<any>;
export type HandlerMap = Record<string, ChannelHandler>;

let currentInvoke: ((channel: string, ...args: any[]) => Promise<any>) | null = null;
/** 暴露最近一次 createInvoke 的分发函数（契约外新通道的旁路入口，如 legacy:import） */
export function getInvoke(): (channel: string, ...args: any[]) => Promise<any> {
  if (!currentInvoke) throw new Error('taskAPI 尚未初始化');
  return currentInvoke;
}

export function createInvoke(deps: PlatformDeps, extra: HandlerMap = {}) {
  const db = createDbHandlers(deps.sql);
  const base: HandlerMap = {
    ...db,
    // ===== window =====
    'window:minimize': () => deps.windowMin(),
    'window:maximize': () => deps.windowMax(),
    'window:close': () => deps.windowClose(),
    'window:isMaximized': () => deps.windowIsMax(),
    // ===== app =====
    'app:info': () => deps.appInfo(),
    'app:ready-to-show': async () => { /* Tauri 无 splash 进程，保留契约 */ },
    'app:getCloseBehavior': async () => {
      try {
        const row = await deps.sql.get<{ value: string }>('SELECT value FROM settings WHERE key=?', ['close_behavior']);
        return row?.value || 'quit'; // 默认直接退出（'ask' 依赖前端弹窗，缺监听就关不掉）
      } catch {
        return 'quit';
      }
    },
    'app:setCloseBehavior': async (v: string) => {
      await deps.sql.run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', ['close_behavior', v]);
      return v;
    },
    // ===== ICS 导出 =====
    'ics:export': async (events: any[]) => {
      const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//StarTasks//v2//CN'];
      for (const e of events || []) {
        lines.push('BEGIN:VEVENT');
        lines.push(`UID:${e.id ?? Math.random().toString(36).slice(2)}@taskmanager`);
        lines.push(`SUMMARY:${e.title ?? ''}`);
        if (e.location) lines.push(`LOCATION:${e.location}`);
        lines.push(`DTSTART:${icsTime(e.start_at)}`);
        lines.push(`DTEND:${icsTime(e.end_at ?? e.start_at)}`);
        lines.push('END:VEVENT');
      }
      lines.push('END:VCALENDAR');
      const path = await deps.saveFile({ defaultName: 'calendar.ics' });
      if (!path) return { ok: false, canceled: true };
      await deps.writeFile(path, lines.join('\r\n'));
      return { ok: true, path, count: events?.length ?? 0 };
    },
    // ===== backup / 老库导入 =====
    ...createBackupHandlers(deps.sql, deps),
    'legacy:import': () => importLegacyDb(deps.sql, deps),
    ...extra,
  };

  const invoker = async (channel: string, ...args: any[]): Promise<any> => {
    const h = base[channel];
    if (!h) {
      // 未迁移通道：明确报错（防止静默吞功能），已知迁移中通道见 FEATURE-MAP
      return { ok: false, error: `通道 ${channel} 尚未迁移到 Tauri 实现`, errorCode: 'NOT_MIGRATED' };
    }
    return h(...args);
  };
  currentInvoke = invoker;
  return invoker;
}

/** send 型通道（fire & forget） */
export function createSend(deps: PlatformDeps): (channel: string, ...args: any[]) => void {
  return (channel, ...args) => {
    if (channel === 'app:ready-to-show') return;
    if (channel === 'input:diag:append') return; // 诊断降级：不再写系统日志
  };
}

function icsTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
}
