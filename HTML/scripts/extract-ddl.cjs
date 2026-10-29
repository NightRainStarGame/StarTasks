/* 抽取 electron/db/index.ts 的 DDL 生成 HTML/migrations/001_init.sql（去月卡表） */
const fs = require('fs');
const path = require('path');

const SRC = 'E:/University/TaskManager/electron/db/index.ts';
const OUT_DIR = 'E:/University/TaskManager/HTML/migrations';
const t = fs.readFileSync(SRC, 'utf8');

const blocks = [...t.matchAll(/db\.exec\(\s*`([\s\S]*?)`\s*\)/g)].map((m) => m[1]);
console.log('exec blocks:', blocks.length);

let sql = blocks.join('\n\n');

// 删月卡相关 DDL（CREATE TABLE ... ; 与相关索引）
function removeCreateTable(s, table) {
  const re = new RegExp('CREATE TABLE IF NOT EXISTS ' + table + '[\\s\\S]*?\\);', 'g');
  return s.replace(re, '-- [removed] ' + table);
}
function removeIndexOn(s, table) {
  const re = new RegExp('CREATE (UNIQUE )?INDEX[^;]*' + table + '[^;]*;', 'g');
  return s.replace(re, '-- [removed] index on ' + table);
}
for (const tb of ['monthly_subscriptions', 'voucher_purchases']) {
  sql = removeCreateTable(sql, tb);
  sql = removeIndexOn(sql, tb);
}

const keeps = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
console.log('tables kept (' + keeps.length + '):', keeps.join(', '));
console.log('monthly still present:', /monthly_subscriptions/.test(sql));

fs.mkdirSync(OUT_DIR, { recursive: true });
const out = [
  '-- TaskManager 初始结构（自 electron/db/index.ts 抽取，已去 billing 月卡表）',
  '-- 兼容 tauri-plugin-sql (SQLite) 与 sql.js',
  'PRAGMA foreign_keys = ON;',
  '',
  sql,
  '',
].join('\n');
fs.writeFileSync(path.join(OUT_DIR, '001_init.sql'), out, 'utf8');
console.log('written 001_init.sql bytes:', out.length);
