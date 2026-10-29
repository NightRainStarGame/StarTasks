/**
 * 迁移执行器（v2.0.7 重写）—— **必须幂等且容错**。
 *
 * 背景（2.0.6 事故）：把迁移放进 tauri-plugin-sql 的 add_migrations 后，它在应用
 * 启动时执行，任何一条语句失败（旧库 duplicate column / 索引引用不存在的列）都会
 * 让插件初始化失败 → 窗口根本打不开。教训：**迁移不能挡在启动链上**。
 *
 * 策略：
 *   1. CREATE TABLE IF NOT EXISTS —— 天然幂等
 *   2. 列回填：解析建表语句拿到期望列 → PRAGMA table_info 对比 → 缺的 ALTER ADD
 *      （旧库只补列不动数据；SQLite 无 IF NOT EXISTS 的 ADD COLUMN，只能这样补）
 *   3. ALTER ... ADD COLUMN 单独跑，duplicate column 静默跳过
 *   4. 索引放最后跑，失败只记日志不致命（索引是性能优化，不影响功能）
 *   5. 全程单条容错；只有核心表自检失败才抛错（用于启动诊断横幅）
 */
import type { SqlExecutor } from './platform';
import initSql from '../../migrations/001_init.sql?raw';
import academicSql from '../../migrations/002_academic.sql?raw';

const MIGRATIONS: Array<{ name: string; sql: string }> = [
  { name: '001_init', sql: initSql },
  { name: '002_academic', sql: academicSql },
];

/**
 * 按分号切语句。
 * ⚠ 必须先把 CRLF 规范化并用 /m 旗标剥注释：SQL 文件是 \r\n 换行时，
 *   `--.*$` 里 `.` 不匹配 `\r`、`$` 又不在 `\r` 前成立 → 注释剥不掉；
 *   再叠一层 `startsWith('--')` 过滤，就会把「注释开头的语句块」整块丢掉
 *   —— 这正是历史版本大面积丢建表语句、空库报 no such table 的总根源。
 */
function splitStatements(sqlText: string): string[] {
  const normalized = sqlText.replace(/\r\n?/g, '\n');
  const noComments = normalized.replace(/--.*$/gm, '');
  return noComments.split(';').map((s) => s.trim()).filter(Boolean);
}

/** 从 CREATE TABLE 语句里解析「列名 → 列定义（可用于 ADD COLUMN）」 */
function parseTableColumns(stmt: string): { table: string; columns: Array<{ name: string; def: string }> } | null {
  const m = stmt.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?\s*\(([\s\S]*)\)\s*$/i);
  if (!m) return null;
  const table = m[1];
  const body = m[2];
  const columns: Array<{ name: string; def: string }> = [];
  // 逐行找「列名 类型 ...」；跳过表级约束（PRIMARY KEY / UNIQUE / CHECK / FOREIGN KEY）
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line || /^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)\b/i.test(line)) continue;
    const cm = line.match(/^["'`]?(\w+)["'`]?\s+(TEXT|INTEGER|INT|REAL|BLOB|NUMERIC|DOUBLE|FLOAT|BOOLEAN|CHAR(\(\d+\))?|VARCHAR(\(\d+\))?|DATETIME|DATE)([\s\S]*)$/i);
    if (!cm) continue;
    const name = cm[1];
    const type = cm[2];
    let rest = cm[4] || '';
    // ADD COLUMN 不能带 PRIMARY KEY / UNIQUE / NOT NULL(无默认) / CHECK / REFERENCES —— 全部剥掉
    rest = rest
      .replace(/\bPRIMARY\s+KEY\b/gi, '')
      .replace(/\bAUTOINCREMENT\b/gi, '')
      .replace(/\bUNIQUE\b/gi, '')
      .replace(/\bNOT\s+NULL\b/gi, '')
      .replace(/\bCHECK\s*\([^)]*\)/gi, '')
      .replace(/\bREFERENCES\s*\([^)]*\)/gi, '')
      .replace(/\bCOLLATE\s+\w+/gi, '')
      .trim();
    // 保留 DEFAULT 子句（SQLite 的 ADD COLUMN 允许带 DEFAULT）
    const def = (type + (rest ? ' ' + rest : '')).trim();
    columns.push({ name, def });
  }
  return { table, columns };
}

export async function runMigrations(sql: SqlExecutor): Promise<void> {
  // 已就绪就直接返回（Rust/历史版本建过库的情况）
  try {
    await sql.get('SELECT key FROM settings LIMIT 1');
    return;
  } catch { /* 结构未就绪，继续 */ }

  const errors: string[] = [];
  const note = (e: unknown, ctx: string) => {
    const msg = String((e as any)?.message ?? e);
    errors.push(`${ctx}: ${msg}`);
    console.warn('[migrate]', ctx, msg);
  };

  const allStmts: string[] = [];
  for (const m of MIGRATIONS) allStmts.push(...splitStatements(m.sql));

  // 1) 建表（IF NOT EXISTS，幂等）
  for (const stmt of allStmts) {
    if (!/^CREATE\s+TABLE/i.test(stmt)) continue;
    try { await sql.run(stmt); } catch (e) { note(e, 'create-table'); }
  }

  // 2) 列回填：旧库缺列（CREATE TABLE IF NOT EXISTS 不会补列）——这正是旧版
  //    CREATE INDEX 报 "no such column" 的根源
  for (const stmt of allStmts) {
    if (!/^CREATE\s+TABLE/i.test(stmt)) continue;
    const parsed = parseTableColumns(stmt);
    if (!parsed) continue;
    let existing: Array<{ name: string }> = [];
    try {
      existing = await sql.all<{ name: string }>(`PRAGMA table_info(${parsed.table})`);
    } catch (e) { note(e, `pragma ${parsed.table}`); continue; }
    const have = new Set(existing.map((r) => r.name.toLowerCase()));
    for (const col of parsed.columns) {
      if (have.has(col.name.toLowerCase())) continue;
      try {
        await sql.run(`ALTER TABLE ${parsed.table} ADD COLUMN ${col.name} ${col.def}`);
        console.info('[migrate] 补列', parsed.table + '.' + col.name);
      } catch (e) { note(e, `add-column ${parsed.table}.${col.name}`); }
    }
  }

  // 3) ALTER ... ADD COLUMN（002 里的）：列已存在则跳过
  for (const stmt of allStmts) {
    if (!/^ALTER\s+TABLE/i.test(stmt)) continue;
    try { await sql.run(stmt); } catch (e) { note(e, 'alter'); }
  }

  // 4) 索引最后跑，失败不致命（性能优化而已）
  for (const stmt of allStmts) {
    if (!/^CREATE\s+(UNIQUE\s+)?INDEX/i.test(stmt)) continue;
    try { await sql.run(stmt); } catch (e) { note(e, 'index'); }
  }

  // 5) 自检：核心表必须在。缺失说明迁移整体没生效 —— 抛错让启动诊断横幅显示真实原因
  try {
    await sql.get('SELECT key FROM settings LIMIT 1');
  } catch (e) {
    throw new Error(
      `数据库初始化失败（迁移未生效）。语句错误样本：${errors.slice(0, 3).join(' ;; ') || String((e as any)?.message ?? e)}`,
    );
  }
}
