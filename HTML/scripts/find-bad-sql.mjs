import initSqlJs from 'sql.js';
import { readFileSync } from 'node:fs';
const SQL = await initSqlJs();
const ddl = readFileSync('E:/University/TaskManager/HTML/migrations/001_init.sql', 'utf8');
const body = ddl.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const stmts = body.split(';').map((s) => s.trim()).filter(Boolean);
const db = new SQL.Database();
stmts.forEach((s, i) => {
  try { db.run(s); }
  catch (e) {
    console.log('=== BAD stmt #' + i + ' ===');
    console.log(s.slice(0, 400));
    console.log('ERR:', e.message);
  }
});
console.log('done,', stmts.length, 'statements');
