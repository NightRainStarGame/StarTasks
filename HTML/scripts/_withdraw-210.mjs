/* 撤下 SSIO 上的 2.1.0 安装包（releases），保留其他版本 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY = readFileSync(path.join(__dirname, '.ssio-release-key'), 'utf8').trim();
const BASE = 'http://120.53.9.81:8100';

const list = await fetch(`${BASE}/v1/releases?channel=stable`, { headers: { 'X-API-Key': KEY } }).then((r) => r.json());
const arr = Array.isArray(list) ? list : (list.releases || []);
const targets = arr.filter((r) => r.version === '2.1.0');
if (!targets.length) {
  console.log('没有 2.1.0 需要撤销');
} else {
  for (const t of targets) {
    const res = await fetch(`${BASE}/v1/releases/${t.id}`, { method: 'DELETE', headers: { 'X-API-Key': KEY } });
    console.log(`删除 ${t.platform}/${t.arch} v${t.version} (${t.id.slice(0, 8)}) → HTTP ${res.status}`);
  }
}

const after = await fetch(`${BASE}/v1/releases?channel=stable`, { headers: { 'X-API-Key': KEY } }).then((r) => r.json());
const arr2 = Array.isArray(after) ? after : (after.releases || []);
console.log('剩余 2.1.0 条目:', arr2.filter((r) => r.version === '2.1.0').length);
console.log('线上最高版本:', arr2.map((r) => r.version).sort((a, b) => parseInt(b.split('.')[2] || 0) - parseInt(a.split('.')[2] || 0))[0]);
