/**
 * 契约覆盖回归 —— FEATURE-MAP 冻结的 190 个 invoke 通道必须在新实现里全部有处理器。
 * 防「功能被无声吞掉」（历史两次事故）。输出缺失清单，缺失 > 0 退出码 1。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..');

// 1) 从 api-factory.ts 提取全部 invoke('channel') 通道
const factory = readFileSync(path.join(SRC, 'src/api/api-factory.ts'), 'utf8');
const channels = [...new Set([...factory.matchAll(/invoke\('([^']+)'/g)].map((m) => m[1]))];
console.log('契约 invoke 通道数:', channels.length);

// 2) 从实现侧收集处理器键
const implFiles = [
  'src/api/dbHandlers.ts',
  'src/api/dispatch.ts',
  'src/api/backupHandlers.ts',
  'src/api/cloudHandlers.ts',
  'src/api/classHandlers.ts',
  'src/api/updaterHandlers.ts',
  'src/api/siteHandlers.ts',
];
const handled = new Set();
for (const f of implFiles) {
  const t = readFileSync(path.join(SRC, f), 'utf8');
  for (const m of t.matchAll(/'([a-z][a-zA-Z0-9:_-]*)'\s*:/g)) handled.add(m[1]);
  for (const m of t.matchAll(/"([a-z][a-zA-Z0-9:_-]*)"\s*:/g)) handled.add(m[1]);
}

// 3) 对账
const missing = channels.filter((c) => !handled.has(c));
console.log('实现侧处理器键数:', handled.size);
if (missing.length) {
  console.log('❌ 缺失通道 (' + missing.length + '):');
  for (const c of missing) console.log('   -', c);
} else {
  console.log('✅ 契约通道 100% 有处理器');
}

// 4) 顺带检查用户可见面关键词（旧后端措辞残留）
const uiFiles = [];
function walk(dir) {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== 'node_modules') walk(p); }
    else if (/\.tsx?$/.test(n) && !p.includes('mocks') && !p.includes('legacyImport')) uiFiles.push(p);
  }
}
walk(path.join(SRC, 'src'));
const BAD = [
  { re: /没配 GitHub|先去配置 GitHub|GitHub PAT/, why: 'SSIO 时代误导警告' },
  { re: /去激活月卡|月卡与付费|购买月卡/, why: '月卡已下线' },
  { re: /北科云盘|AnyShare/, why: '云盘通道已下线（注释除外）' },
];
let surfaceIssues = 0;
for (const f of uiFiles) {
  const t = readFileSync(f, 'utf8');
  for (const { re, why } of BAD) {
    const lines = t.split('\n');
    lines.forEach((line, i) => {
      if (re.test(line) && !line.trim().startsWith('*') && !line.trim().startsWith('/*') && !line.trim().startsWith('//') && !line.trim().startsWith('{/*')) {
        console.log(`⚠ 用户可见面残留: ${path.relative(SRC, f)}:${i + 1} [${why}] ${line.trim().slice(0, 60)}`);
        surfaceIssues++;
      }
    });
  }
}
if (!surfaceIssues) console.log('✅ 用户可见面无旧后端/月卡残留');

process.exit(missing.length || surfaceIssues ? 1 : 0);
