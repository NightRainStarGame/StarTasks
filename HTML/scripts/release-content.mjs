/**
 * 发版脚本（v2 简化版）—— 取代旧 release-one-click.js 的多步云端编排。
 *
 * 流程：npm run build → 逐文件 sha256 → 上传 SSIO storage → 写清单 KV（taskmgr/pages）
 *   → git commit + push（版本号 + README）。
 * 壳版本变更（Tauri 二进制）才需要 tauri:build + 发行 APK/安装包，内容更新不动壳。
 *
 * 用法：node scripts/release-content.mjs 2.0.0 --notes-file notes.md [--execute]
 * 默认 dry-run；--execute 才真跑。
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const args = process.argv.slice(2);
const version = args.find((a) => /^\d+\.\d+\.\d+$/.test(a));
const EXECUTE = args.includes('--execute');
const notesFile = (() => {
  const i = args.indexOf('--notes-file');
  return i >= 0 ? args[i + 1] : null;
})();

if (!version) {
  console.error('用法: node scripts/release-content.mjs <X.Y.Z> [--notes-file f.md] [--execute]');
  process.exit(1);
}

const SSIO = (process.env.SSIO_BASE || 'http://120.53.9.81:8100').replace(/\/+$/, '');
// 发版 Key 来源（禁止硬编码 —— 全权限 Key 一旦入库/入包就是事故）：
//   1) 环境变量 SSIO_KEY
//   2) 本地文件 scripts/.ssio-release-key（已 gitignore）
const KEY = (() => {
  if (process.env.SSIO_KEY) return process.env.SSIO_KEY.trim();
  const f = path.join(__dirname, '.ssio-release-key');
  if (existsSync(f)) return readFileSync(f, 'utf8').trim();
  throw new Error('缺少发版 Key：设置 SSIO_KEY 环境变量，或写入 scripts/.ssio-release-key（已 gitignore）');
})();

function log(...a) { console.log('[release]', ...a); }

// 1) 构建 —— **每次都必须重跑**。
// 事故：以前写的是 `if (!existsSync(DIST)) build`，dist 一直在 → 永远跳过构建 →
// 连续几版内容发的都是同一份旧产物（字节数完全一致），前端改动根本没有上线。
// 同时注入 VITE_CONTENT_VERSION，让界面能显示「当前运行的是哪一版内容」。
log(`构建 dist/ …（内容版本 ${version}）`);
execSync('npm run build', {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, VITE_CONTENT_VERSION: version },
});

// 2) 收集产物 + sha256
function walk(dir, base = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (statSync(p).isDirectory()) out.push(...walk(p, rel));
    else out.push({ rel, path: p, size: statSync(p).size });
  }
  return out;
}
const files = walk(DIST);
const pages = files.map((f) => ({
  name: f.rel,
  version: 1,
  sha256: createHash('sha256').update(readFileSync(f.path)).digest('hex'),
  size: f.size,
  fileId: '', // 上传后回填
}));
log(`产物 ${pages.length} 个文件，共 ${pages.reduce((a, b) => a + b.size, 0)} 字节`);

const manifest = {
  version,
  built: new Date().toISOString(),
  pages: pages.map((p) => ({ name: p.name, version: p.version, sha256: p.sha256, size: p.size, fileId: p.fileId })),
  notes: notesFile && existsSync(notesFile) ? readFileSync(notesFile, 'utf8').slice(0, 2000) : '',
};

if (!EXECUTE) {
  log('DRY-RUN 清单预览:');
  console.log(JSON.stringify({ ...manifest, pages: manifest.pages.slice(0, 5) }, null, 2));
  log(`… 共 ${manifest.pages.length} 项。加 --execute 真正发布。`);
  process.exit(0);
}

// 3) 逐文件上传 SSIO storage（分片协议：init → chunks/N → complete，见 Web/scripts/_pickup-taskmgr.mjs）
log('上传 SSIO storage …');
const CHUNK = 4 * 1024 * 1024;
for (let i = 0; i < pages.length; i++) {
  const f = pages[i];
  const bytes = readFileSync(files[i].path); // pages 是投影（无 path），原文件在 files[i]
  const initRes = await fetch(`${SSIO}/v1/storage/uploads`, {
    method: 'POST',
    headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: `taskmgr-pages-${version}-${f.name.replaceAll('/', '_')}`, totalSize: bytes.length, mime: 'application/octet-stream', chunkSize: CHUNK }),
  });
  if (!initRes.ok) throw new Error(`上传初始化失败 ${f.name}: HTTP ${initRes.status} ${await initRes.text()}`);
  const init = await initRes.json();
  const total = init.totalChunks || 1;
  for (let c = 0; c < total; c++) {
    const chunk = bytes.subarray(c * CHUNK, Math.min((c + 1) * CHUNK, bytes.length));
    const putRes = await fetch(`${SSIO}/v1/storage/uploads/${init.uploadId}/chunks/${c}`, {
      method: 'PUT',
      headers: { 'X-API-Key': KEY, 'Content-Type': 'application/octet-stream' },
      body: chunk,
    });
    if (!putRes.ok) throw new Error(`分片 ${c} 上传失败 ${f.name}: HTTP ${putRes.status}`);
  }
  const doneRes = await fetch(`${SSIO}/v1/storage/uploads/${init.uploadId}/complete`, {
    method: 'POST',
    headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha256: pages[i].sha256 }),
  });
  if (!doneRes.ok) throw new Error(`上传完成失败 ${f.name}: HTTP ${doneRes.status}`);
  const done = await doneRes.json();
  manifest.pages[i].fileId = done.fileId || done.id || init.fileId || init.uploadId;
  log(`  [${i + 1}/${pages.length}] ${f.name} → ${manifest.pages[i].fileId}`);
}

// 4) 写清单 KV
log('写清单 KV taskmgr/pages …');
const kvRes = await fetch(`${SSIO}/v1/kv?key=taskmgr%2Fpages`, {
  method: 'PUT',
  headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ value: JSON.stringify(manifest) }),
});
if (!kvRes.ok && kvRes.status !== 201) throw new Error(`KV 写入失败: HTTP ${kvRes.status}`);

// 5) git commit + push（可选，RELEASE_GIT=1 才执行）
// ⚠ 默认跳过：HTML/ 不是独立 git 仓库时，`git add -A` 会扫进父仓库全部内容（含备份目录），
//    发版到 SSIO 与 git 推送解耦，避免一次发版误提交/误推送几十 MB 垃圾。
if (process.env.RELEASE_GIT === '1') {
  log('git 提交 …');
  execSync(`git add -A && git commit -m "release: 内容版本 ${version}" && git push origin main`, { cwd: ROOT, stdio: 'inherit' });
} else {
  log('跳过 git 步骤（需要时 RELEASE_GIT=1）');
}

log(`✅ 发布完成：内容版本 ${version}，${pages.length} 个文件`);
