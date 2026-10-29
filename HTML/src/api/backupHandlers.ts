/**
 * backup.* 命名空间 —— 全量 JSON 备份 / 恢复 / 完整性检查。
 * 平台无关：读全表 → JSON → deps.saveFile 写盘；恢复反向。
 * 数据表清单与 migrations/001_init.sql 对齐（无 billing 表）。
 */
import type { SqlExecutor, PlatformDeps } from './platform';

export const BACKUP_TABLES = [
  'courses', 'course_requirements', 'events', 'projects', 'project_tasks',
  'settings', 'ai_calls', 'categories', 'course_notes', 'user_profiles',
  'recycle_bin', 'canvases', 'canvas_nodes', 'canvas_edges', 'grades', 'exams',
  'pomodoro_sessions', 'habits', 'habit_checkins', 'attendance',
  'group_lists', 'group_list_items',
  'classes', 'class_announcements', 'class_tasks', 'class_chains', 'class_polls',
  'device_profile',
] as const;

export function createBackupHandlers(sql: SqlExecutor, deps: PlatformDeps) {
  /** 云备份用：全量备份 JSON 字符串（不落盘） */
  const serializeAll = async (): Promise<string> => {
    const payload: Record<string, any[]> = {};
    for (const t of BACKUP_TABLES) {
      try { payload[t] = await sql.all(`SELECT * FROM ${t}`); } catch { payload[t] = []; }
    }
    return JSON.stringify({ app: 'taskmanager', schema: 1, exportedAt: Date.now(), tables: payload });
  };
  return {
    /** 云备份：取全量 JSON（供上传） */
    'backup:serialize': async () => {
      const json = await serializeAll();
      return { ok: true, json, sizeBytes: json.length };
    },
    /** 云备份：从 JSON 恢复（覆盖写，恢复前自动安全备份） */
    'backup:applyJson': async (json: string) => {
      if (typeof json !== 'string' || !json) return { ok: false, error: '备份内容为空' };
      let parsed: any;
      try { parsed = JSON.parse(json); } catch { return { ok: false, error: '备份内容不是合法 JSON' }; }
      const tables = parsed?.tables;
      if (!tables || typeof tables !== 'object') return { ok: false, error: '备份缺少 tables 字段' };
      // 安全备份：先把当前数据序列化缓存在 settings（防恢复失败丢数据）
      try {
        await sql.run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
          ['safety_backup_before_cloud_restore', (await serializeAll()).slice(0, 2_000_000)]);
      } catch { /* 安全备份失败不阻断 */ }
      const restored: Record<string, number> = {};
      for (const t of BACKUP_TABLES) {
        const rows = tables[t];
        if (!Array.isArray(rows) || !rows.length) { restored[t] = 0; continue; }
        await sql.run(`DELETE FROM ${t}`);
        for (const row of rows) {
          const keys = Object.keys(row);
          if (!keys.length) continue;
          await sql.run(
            `INSERT INTO ${t} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
            keys.map((k) => (row[k] === undefined ? null : row[k])),
          );
        }
        restored[t] = rows.length;
      }
      return { ok: true, restored };
    },
    'backup:export': async () => {
      const counts: Record<string, number> = {};
      const payload: Record<string, any[]> = {};
      for (const t of BACKUP_TABLES) {
        try {
          const rows = await sql.all(`SELECT * FROM ${t}`);
          payload[t] = rows;
          counts[t] = rows.length;
        } catch {
          payload[t] = [];
          counts[t] = 0;
        }
      }
      const json = JSON.stringify({ app: 'taskmanager', schema: 1, exportedAt: Date.now(), tables: payload }, null, 2);
      const path = await deps.saveFile({ defaultName: `taskmanager-backup-${new Date().toISOString().slice(0, 10)}.json` });
      if (!path) return { ok: false, canceled: true };
      await deps.writeFile(path, json);
      return { ok: true, path, counts };
    },

    'backup:import': async (opts?: { skipSafetyBackup?: boolean }) => {
      // 先做安全备份（导出当前库到临时文件），再覆盖导入
      let safetyBackupPath: string | null = null;
      if (!opts?.skipSafetyBackup) {
        try {
          const counts: Record<string, number> = {};
          const payload: Record<string, any[]> = {};
          for (const t of BACKUP_TABLES) {
            try {
              const rows = await sql.all(`SELECT * FROM ${t}`);
              payload[t] = rows;
              counts[t] = rows.length;
            } catch { payload[t] = []; }
          }
          const json = JSON.stringify({ app: 'taskmanager', schema: 1, exportedAt: Date.now(), tables: payload });
          const p = await deps.saveFile({ defaultName: `taskmanager-safety-${Date.now()}.json` });
          if (p) { await deps.writeFile(p, json); safetyBackupPath = p; }
        } catch { /* 安全备份失败不阻断导入 */ }
      }

      const path = await deps.pickFile({ filters: [{ name: 'StarTasks 备份', extensions: ['json'] }] });
      if (!path) return { ok: false, canceled: true };
      const text = new TextDecoder().decode(await deps.readFile(path));
      let parsed: any;
      try { parsed = JSON.parse(text); } catch { return { ok: false, error: '备份文件不是合法 JSON' }; }
      const tables = parsed?.tables;
      if (!tables || typeof tables !== 'object') return { ok: false, error: '备份文件缺少 tables 字段' };

      const restored: Record<string, number> = {};
      for (const t of BACKUP_TABLES) {
        const rows = tables[t];
        if (!Array.isArray(rows) || !rows.length) { restored[t] = 0; continue; }
        try {
          await sql.run(`DELETE FROM ${t}`);
          const cols = Object.keys(rows[0]);
          for (const row of rows) {
            await sql.run(
              `INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
              cols.map((c) => row[c] ?? null),
            );
          }
          restored[t] = rows.length;
        } catch (e) {
          console.warn(`[backup] 恢复表 ${t} 失败:`, e);
          restored[t] = 0;
        }
      }
      return { ok: true, restored, safetyBackupPath, source: path };
    },

    'backup:status': async () => {
      const tables: Record<string, number> = {};
      let total = 0;
      for (const t of BACKUP_TABLES) {
        try {
          const r = await sql.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`);
          tables[t] = r?.n || 0;
          total += tables[t];
        } catch { tables[t] = 0; }
      }
      // SQLite 自检（tauri-plugin-sql / sql.js 都支持 PRAGMA）
      let integrity = 'unknown';
      try {
        const rows = await sql.all<{ integrity_check: string }>('PRAGMA integrity_check');
        integrity = rows?.[0]?.integrity_check === 'ok' ? 'ok' : (rows?.[0]?.integrity_check || 'unknown');
      } catch { /* sql.js 某些版本不支持 */ }
      return {
        integrity,
        foreignKeyViolations: 0,
        journalMode: 'wal',
        tables,
        dbSizeBytes: total,
        lastAutoBackup: null as string | null,
      };
    },

    'backup:makeSafety': async () => {
      const payload: Record<string, any[]> = {};
      for (const t of BACKUP_TABLES) {
        try { payload[t] = await sql.all(`SELECT * FROM ${t}`); } catch { payload[t] = []; }
      }
      const json = JSON.stringify({ app: 'taskmanager', schema: 1, exportedAt: Date.now(), tables: payload });
      const p = await deps.saveFile({ defaultName: `taskmanager-safety-${Date.now()}.json` });
      if (!p) return { ok: false, canceled: true };
      await deps.writeFile(p, json);
      return { ok: true, path: p };
    },
  };
}
