/* 修复从旧工程复制后的 import 路径：electron/* → HTML/src 新位置 */
const fs = require('fs');
const path = require('path');

const ROOT = 'E:/University/TaskManager/HTML/src';
const fixes = [
  // [文件相对 src 的路径, [旧串, 新串]...]
  ['api/dbHandlers.ts', [["from '../platform'", "from './platform'"]]],
  ['mocks/browserApi.ts', [
    ["from '../../electron/api-factory'", "from '../api/api-factory'"],
    ["from '../../electron/core/periods'", "from '../core/periods'"],
  ]],
  ['types/index.ts', [["from '../../electron/api-factory'", "from '../api/api-factory'"]]],
  ['mobile/apkUpdater.ts', [["from '../../electron/cloud/ssioClient'", "from '../cloud/ssioClient'"]]],
];

for (const [rel, pairs] of fixes) {
  const p = path.join(ROOT, rel);
  let t = fs.readFileSync(p, 'utf8');
  for (const [a, b] of pairs) {
    if (t.includes(a)) { t = t.split(a).join(b); console.log('fixed', rel, ':', a.slice(0, 40)); }
    else console.log('skip (not found)', rel, ':', a.slice(0, 40));
  }
  fs.writeFileSync(p, t, 'utf8');
}

// bootstrap.ts 是 Capacitor 壳入口，Tauri 下由 src/main.tsx 取代 —— 从编译面摘除（重命名为 .bak）
const boot = path.join(ROOT, 'mobile', 'bootstrap.ts');
if (fs.existsSync(boot)) {
  fs.renameSync(boot, boot + '.bak');
  console.log('renamed bootstrap.ts -> bootstrap.ts.bak（Capacitor 入口，不再编译）');
}
console.log('done');
