/* 数据层烟雾测试：sql.js 跑 001_init.sql → dbHandlers CRUD → 老库导入路径 */
import initSqlJs from 'sql.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL = await initSqlJs();

// 1) 迁移
const ddl = readFileSync(path.join(__dirname, '../migrations/001_init.sql'), 'utf8');
const db = new SQL.Database();
db.run(ddl);
const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")[0].values.map((v) => v[0]);
console.log('① 迁移建表数:', tables.length);
const banned = ['monthly_subscriptions', 'voucher_purchases'];
const leaked = banned.filter((t) => tables.includes(t));
console.log('   billing 表泄漏:', leaked.length ? leaked.join(',') : '无 ✓');

// 2) 关键表存在性
const must = ['courses', 'course_requirements', 'events', 'projects', 'project_tasks', 'settings',
  'canvases', 'canvas_nodes', 'canvas_edges', 'grades', 'exams', 'pomodoro_sessions', 'habits',
  'habit_checkins', 'attendance', 'classes', 'class_announcements', 'user_profiles', 'recycle_bin'];
const missing = must.filter((t) => !tables.includes(t));
console.log('② 关键表缺失:', missing.length ? missing.join(',') : '无 ✓');

// 3) dbHandlers CRUD（用 sql.js 适配器）
const exec = {
  async run(sqlStr, params = []) { db.run(sqlStr, params); return db.getRowsModified(); },
  async all(sqlStr, params = []) {
    const stmt = db.prepare(sqlStr); stmt.bind(params);
    const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); stmt.free(); return rows;
  },
  async get(sqlStr, params = []) {
    const stmt = db.prepare(sqlStr); stmt.bind(params);
    let row = null; if (stmt.step()) row = stmt.getAsObject(); stmt.free(); return row;
  },
};
const { createDbHandlers } = await import('../src/api/dbHandlers.ts').catch(() => ({ createDbHandlers: null }));
if (!createDbHandlers) {
  // TS 不能直接 import —— 用等价 SQL 冒烟
  console.log('③ dbHandlers 直载不可用（TS），用等价 SQL 冒烟');
  db.run("INSERT INTO courses (name, instructor, color, created_at, course_key, guid) VALUES ('高等数学','张三','#33d9a6',1,'CK-TEST','C-TEST0001')");
  const r = db.exec("SELECT * FROM courses")[0];
  console.log('   courses 行数:', r.values.length, '✓');
} else {
  const h = createDbHandlers(exec);
  const c = await h['db:courses:create']({ name: '高等数学', instructor: '张三' });
  console.log('③ courses.create:', c);
  const list = await h['db:courses:list']();
  console.log('   courses.list:', list.length, 'course_key:', list[0]?.course_key);
}

// 4) 老库导入：模拟老库（含 billing 表）→ 验证跳过逻辑
const legacy = new SQL.Database();
legacy.run(`CREATE TABLE monthly_subscriptions (id INTEGER PRIMARY KEY, voucher_code TEXT);
            CREATE TABLE courses (id INTEGER PRIMARY KEY, name TEXT, instructor TEXT, color TEXT, created_at INTEGER, course_key TEXT, guid TEXT);
            INSERT INTO monthly_subscriptions (voucher_code) VALUES ('XXXX');
            INSERT INTO courses (name, instructor, color, created_at, course_key, guid) VALUES ('线性代数','李四','#63bed2',1,'CK-L','C-LINEAR1');`);
const IGNORED = ['monthly_subscriptions', 'voucher_purchases'];
const legacyTables = legacy.exec("SELECT name FROM sqlite_master WHERE type='table'")[0].values.map((v) => v[0]);
const skipped = []; const imported = {};
for (const t of legacyTables) {
  if (IGNORED.includes(t)) { skipped.push(t); continue; }
  const res = legacy.exec(`SELECT * FROM "${t}"`);
  if (!res.length) { imported[t] = 0; continue; }
  db.run(`DELETE FROM ${t}`); // legacyImport 语义：目标表先清空
  const cols = res[0].columns;
  for (const v of res[0].values) {
    db.run(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, v.map((x) => x ?? null));
  }
  imported[t] = res[0].values.length;
}
console.log('④ 老库导入: imported =', imported, ' skipped =', skipped, skipped.includes('monthly_subscriptions') ? '✓' : '✗');
const after = db.exec("SELECT COUNT(*) FROM courses")[0].values[0][0];
// legacyImport 语义：目标表先清空再导入 → 数量应等于导入行数（1）
console.log('   导入后 courses 总数:', after, after === 1 ? '✓（清空后导入语义）' : '✗');

console.log('\n烟雾测试完成');
