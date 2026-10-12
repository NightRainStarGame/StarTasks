#!/usr/bin/env node
/**
 * republish-android.js —— 只重发 android 段（APK 上传 + latest.json android 段 + KV 同步）。
 *
 * 用途：v1.2.18 首发时漏提了 build.gradle 的 versionCode（仍是 12），导致 Android 1.2.17
 * 用户判定「已是最新」收不到更新。桌面 exe 与补丁不受影响，不值得整条发版重跑 ——
 * 只重传 APK + 重写清单 android 段。
 *
 * 组装逻辑与 release-one-click.js 的 android 段完全一致（zip 解压校验版本、
 * marker 取 releaseId、gradle 取 versionCode、本地算 sha256/size）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const VERSION = process.argv[2];
if (!VERSION) { console.error('用法: node scripts/republish-android.js <X.Y.Z>'); process.exit(1); }

const apkPath = path.join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const latestPath = path.join(ROOT, 'latest.json');

/** 与 release-one-click.js 相同的 zip 条目读取（APK 是 zip，字符串是 deflate 的） */
function readZipEntry(file, entryPath) {
  const buf = fs.readFileSync(file);
  const SIG = 0x04034b50;
  for (let i = 0; i < buf.length - 4; i++) {
    if (buf.readUInt32LE(i) !== SIG) continue;
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const nameStart = i + 30;
    const name = buf.toString('utf8', nameStart, nameStart + nameLen);
    if (name !== entryPath) continue;
    const dataStart = nameStart + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    if (method === 0) return data;
    if (method === 8) return zlib.inflateRawSync(data);
    return null;
  }
  return null;
}

// 0) 上传前自检：APK 里必须烙着当前版本号
const mob = readZipEntry(apkPath, 'assets/public/assets/mobile.js');
if (!mob) { console.error('[x] 读不到 APK 里的 mobile.js'); process.exit(1); }
if (!mob.toString('utf8').includes(`"${VERSION}"`)) {
  console.error(`[x] APK 里找不到版本号 ${VERSION} —— 是旧页面打包的，先重新构建 APK`);
  process.exit(1);
}
console.log(`OK APK self-check passed (carries ${VERSION})`);

// 1) 上传 APK（platform=android；publish-release-ssio 会建 release 并写 marker）
console.log('==> 上传 APK 到 SSIO（android/arm64）');
const r = spawnSync(process.execPath, [
  path.join(ROOT, 'scripts', 'publish-release-ssio.js'),
  apkPath, VERSION, '',
  '--platform', 'android', '--arch', 'arm64',
], { cwd: ROOT, stdio: 'inherit' });
if (r.status !== 0) { console.error('[x] APK 上传失败'); process.exit(1); }

// 2) 用新 marker + gradle versionCode 重写 latest.json 的 android 段
const marker = JSON.parse(fs.readFileSync(path.join(ROOT, '.ssio-last-release-android.json'), 'utf8'));
if (String(marker.version) !== VERSION) { console.error(`[x] marker 版本 ${marker.version} 不等于 ${VERSION}`); process.exit(1); }
const gradleText = fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle'), 'utf8');
const vc = (gradleText.match(/versionCode\s+(\d+)/) || [])[1];
const apkBuf = fs.readFileSync(apkPath);

const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
latest.android = {
  version: VERSION,
  versionCode: vc ? Number(vc) : 0,
  url: `ssio:release:${marker.releaseId}`,
  mirrors: [],
  sha256: crypto.createHash('sha256').update(apkBuf).digest('hex'),
  size: apkBuf.length,
  fileName: `TaskManager-${VERSION}.apk`,
  page: null,
};
fs.writeFileSync(latestPath, JSON.stringify(latest, null, 2) + '\n');
console.log(`OK latest.json android: v${VERSION} versionCode=${latest.android.versionCode} sha256=${latest.android.sha256.slice(0, 16)}...`);

// 3) 同步 KV
console.log('==> 同步清单到 SSIO KV');
const kv = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'publish-manifest-kv.js')], { cwd: ROOT, stdio: 'inherit' });
if (kv.status !== 0) { console.error('[x] KV 同步失败 —— 客户端拿到的还是旧清单！'); process.exit(1); }
console.log('OK android 段重发完成');
