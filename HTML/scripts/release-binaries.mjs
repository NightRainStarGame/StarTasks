/**
 * 安装包发版脚本 —— 把 release/ 下的 exe/apk 发到 SSIO releases 分发通道。
 * 与 release-content.mjs（内容热更）配套：壳变更发这里，内容更新发那里。
 *
 * 用法：node scripts/release-binaries.mjs [--channel stable] [--notes-file f.md]
 * 流程：分片上传 SSIO storage → POST /v1/releases（幂等：同版本/平台已存在则跳过）
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RELEASE_DIR = path.join(ROOT, 'release');

const args = process.argv.slice(2);
const CHANNEL = (() => { const i = args.indexOf('--channel'); return i >= 0 ? args[i + 1] : 'stable'; })();
const notesFile = (() => { const i = args.indexOf('--notes-file'); return i >= 0 ? args[i + 1] : null; })();

const SSIO = (process.env.SSIO_BASE || 'http://120.53.9.81:8100').replace(/\/+$/, '');
// 发版 Key 来源（禁止硬编码）：环境变量 SSIO_KEY 或 scripts/.ssio-release-key（已 gitignore）
const KEY = (() => {
  if (process.env.SSIO_KEY) return process.env.SSIO_KEY.trim();
  const f = path.join(__dirname, '.ssio-release-key');
  if (existsSync(f)) return readFileSync(f, 'utf8').trim();
  throw new Error('缺少发版 Key：设置 SSIO_KEY 环境变量，或写入 scripts/.ssio-release-key（已 gitignore）');
})();
const CHUNK = 4 * 1024 * 1024;

function log(...a) { console.log('[release-bin]', ...a); }

/** 文件名 → { platform, arch } */
function classify(name) {
  if (name.endsWith('.exe')) return { platform: 'win', arch: 'x64' };
  if (name.endsWith('.apk')) return { platform: 'android', arch: 'arm64' };
  return null;
}

async function uploadFile(fullPath, name) {
  const bytes = readFileSync(fullPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const initRes = await fetch(`${SSIO}/v1/storage/uploads`, {
    method: 'POST',
    headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: name, totalSize: bytes.length, mime: 'application/octet-stream', chunkSize: CHUNK }),
  });
  if (!initRes.ok) throw new Error(`上传初始化失败: HTTP ${initRes.status} ${await initRes.text()}`);
  const init = await initRes.json();
  const total = init.totalChunks || 1;
  for (let c = 0; c < total; c++) {
    const chunk = bytes.subarray(c * CHUNK, Math.min((c + 1) * CHUNK, bytes.length));
    const putRes = await fetch(`${SSIO}/v1/storage/uploads/${init.uploadId}/chunks/${c}`, {
      method: 'PUT',
      headers: { 'X-API-Key': KEY, 'Content-Type': 'application/octet-stream' },
      body: chunk,
    });
    if (!putRes.ok) throw new Error(`分片 ${c} 上传失败: HTTP ${putRes.status}`);
  }
  const doneRes = await fetch(`${SSIO}/v1/storage/uploads/${init.uploadId}/complete`, {
    method: 'POST',
    headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha256 }),
  });
  if (!doneRes.ok) throw new Error(`上传完成失败: HTTP ${doneRes.status}`);
  const done = await doneRes.json();
  return { fileId: done.fileId || done.id || init.fileId || init.uploadId, sha256, size: bytes.length };
}

if (!existsSync(RELEASE_DIR)) { log('release/ 不存在'); process.exit(1); }
const notes = notesFile && existsSync(notesFile) ? readFileSync(notesFile, 'utf8') : '';

// 已有 release 查询（幂等跳过）
const existingRes = await fetch(`${SSIO}/v1/releases?channel=${CHANNEL}`, { headers: { 'X-API-Key': KEY } });
const existing = existingRes.ok ? await existingRes.json() : [];
const existingList = Array.isArray(existing) ? existing : (existing.releases || []);

for (const name of readdirSync(RELEASE_DIR)) {
  const full = path.join(RELEASE_DIR, name);
  if (!statSync(full).isFile()) continue;
  const info = classify(name);
  if (!info) { log(`跳过（不认识的类型）: ${name}`); continue; }
  const m = name.match(/(\d+\.\d+\.\d+)/);
  const version = m?.[1] || '0.0.0';
  const sizeMB = (statSync(full).size / 1048576).toFixed(2);
  log(`处理 ${name} → ${info.platform}/${info.arch} v${version}（${sizeMB}MB）…`);

  const dup = existingList.find((r) => r.version === version && r.platform === info.platform && r.arch === info.arch);
  if (dup) { log(`  ⊘ 已存在 releaseId=${dup.id}，跳过`); continue; }

  const up = await uploadFile(full, name);
  log(`  ✓ 上传 fileId=${up.fileId}`);
  const relRes = await fetch(`${SSIO}/v1/releases`, {
    method: 'POST',
    headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: CHANNEL,
      platform: info.platform,
      arch: info.arch,
      version,
      fileId: up.fileId,
      notesMd: notes || `StarTasks v${version}`,
      published: true,
      rolloutPercent: 100,
    }),
  });
  if (!relRes.ok) throw new Error(`建 release 失败: HTTP ${relRes.status} ${await relRes.text()}`);
  const rel = await relRes.json();
  log(`  ✅ 已发布 releaseId=${rel.id}`);
}
log('完成');
