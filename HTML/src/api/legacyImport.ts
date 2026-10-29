/**
 * 老库导入向导 —— 一次性把 %APPDATA%\task-manager\task-manager.db（Electron better-sqlite3）
 * 的数据搬进新存储。billing 表（monthly_subscriptions / voucher_purchases）随月卡功能删除，导入时忽略。
 *
 * 做法：老库是标准 SQLite 文件 → 用 sql.js 打开（Tauri/浏览器都可用同一路径），
 * 逐表复制到目标 SqlExecutor。导入前后输出对账报告。
 */
import initSqlJs from 'sql.js';
import type { SqlExecutor, PlatformDeps } from './platform';
import { BACKUP_TABLES } from './backupHandlers';
import { getInvoke } from './dispatch';

/** 契约外新通道入口：Settings「导入旧版数据」按钮调用 */
export async function legacyImport(): Promise<ImportReport> {
  return getInvoke()('legacy:import');
}

/** 老库存在但新库删除的表（月卡体系）——导入时明确跳过并报告 */
export const IGNORED_TABLES = ['monthly_subscriptions', 'voucher_purchases'];

export interface ImportReport {
  ok: boolean;
  canceled?: boolean;
  error?: string;
  imported: Record<string, number>;
  skipped: Record<string, string>;
  totalRows: number;
}

export async function importLegacyDb(sql: SqlExecutor, deps: PlatformDeps): Promise<ImportReport> {
  const path = await deps.pickFile({
    filters: [{ name: 'StarTasks 老数据库', extensions: ['db', 'sqlite', 'sqlite3'] }],
  });
  if (!path) return { ok: false, canceled: true, imported: {}, skipped: {}, totalRows: 0 };

  const bytes = await deps.readFile(path);
  const SQL = await initSqlJs({
    locateFile: (f: string) => `https://cdn.jsdelivr.net/npm/sql.js@1.14.2/dist/${f}`,
  });
  let legacy: any;
  try {
    legacy = new SQL.Database(bytes);
  } catch (e) {
    return { ok: false, error: `老库打开失败：${(e as Error).message}`, imported: {}, skipped: {}, totalRows: 0 };
  }

  const imported: Record<string, number> = {};
  const skipped: Record<string, string> = {};
  let totalRows = 0;

  // 老库表清单
  const legacyTables = legacy
    .exec("SELECT name FROM sqlite_master WHERE type='table'")[0]
    ?.values.map((v: any[]) => String(v[0])) ?? [];

  for (const t of legacyTables) {
    if (t.startsWith('sqlite_')) continue;
    if ((IGNORED_TABLES as readonly string[]).includes(t)) {
      skipped[t] = '月卡功能已删除，数据忽略';
      continue;
    }
    if (!(BACKUP_TABLES as readonly string[]).includes(t)) {
      skipped[t] = '新库无此表（未知表，忽略）';
      continue;
    }

    // 读老库全量行
    let rows: any[];
    try {
      const res = legacy.exec(`SELECT * FROM "${t}"`);
      if (!res.length) { imported[t] = 0; continue; }
      const cols = res[0].columns;
      rows = res[0].values.map((v: any[]) => Object.fromEntries(cols.map((c: string, i: number) => [c, v[i] ?? null])));
    } catch (e) {
      skipped[t] = `读取失败: ${(e as Error).message}`;
      continue;
    }

    // 目标表存在列的交集（老库可能多列/少列）
    let targetCols: string[] = [];
    try {
      const info = await sql.all<{ name: string }>(`PRAGMA table_info(${t})`);
      targetCols = info.map((r) => r.name);
    } catch {
      skipped[t] = '新库表不存在';
      continue;
    }
    if (!targetCols.length) { skipped[t] = '新库表不存在'; continue; }

    // 导入前清空目标表（一次性向导语义），失败整体回滚不了——先报告
    try {
      await sql.run(`DELETE FROM ${t}`);
    } catch { /* 表可能为空或锁，忽略 */ }

    let n = 0;
    for (const row of rows) {
      const cols = targetCols.filter((c) => c in row);
      if (!cols.length) continue;
      try {
        await sql.run(
          `INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
          cols.map((c) => row[c] ?? null),
        );
        n++;
      } catch (e) {
        // UNIQUE 冲突（如 course_key）跳过单行不阻断
        console.warn(`[legacy] ${t} 行插入失败（跳过）:`, (e as Error).message);
      }
    }
    imported[t] = n;
    totalRows += n;
  }

  legacy.close();
  return { ok: true, imported, skipped, totalRows };
}
