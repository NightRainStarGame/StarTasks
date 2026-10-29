/* 产品改名 TaskManager/StarOS → StarTasks。
   只改「产品品牌」；保留：taskmgr/ 存储键、旧版导入路径、历史注释里对旧名的客观指涉
   （如 legacyImport 的 task-manager.db 来源说明、协议字面值 SSIO_KEYS）。 */
const fs = require('fs');
const path = require('path');

function sub(file, pairs) {
  const p = path.resolve(file);
  let t = fs.readFileSync(p, 'utf8');
  const before = t;
  for (const [a, b] of pairs) t = t.split(a).join(b);
  if (t !== before) { fs.writeFileSync(p, t, 'utf8'); console.log('updated', file); }
  else console.log('skip', file);
}

const ROOT = 'E:/University/TaskManager/HTML';

// tauri 配置与 Rust
sub(ROOT + '/src-tauri/tauri.conf.json', [
  ['"productName": "TaskManager"', '"productName": "StarTasks"'],
  ['"identifier": "com.douya.taskmanager"', '"identifier": "com.douya.startasks"'],
  ['"title": "TaskManager"', '"title": "StarTasks"'],
]);
sub(ROOT + '/src-tauri/src/lib.rs', [
  ['TaskManager 壳层', 'StarTasks 壳层'],
  ['"name": "TaskManager"', '"name": "StarTasks"'],
  ['.tooltip("TaskManager")', '.tooltip("StarTasks")'],
]);
sub(ROOT + '/src-tauri/src/main.rs', [
  ['TaskManager Tauri 2 壳', 'StarTasks Tauri 2 壳'],
  ['taskmanager_lib::run()', 'startasks_lib::run()'],
]);
sub(ROOT + '/src-tauri/Cargo.toml', [
  ['name = "taskmanager"', 'name = "startasks"'],
  ['description = "TaskManager Tauri 2 双端壳"', 'description = "StarTasks Tauri 2 双端壳"'],
  ['name = "taskmanager_lib"', 'name = "startasks_lib"'],
]);

// package.json（npm 包名与描述）
sub(ROOT + '/package.json', [
  ['"name": "task-manager"', '"name": "star-tasks"'],
  ['课程 / 项目 / 日历一体化可视化工作流（霓虹荧光科技风）', 'StarTasks · 课程 / 项目 / 日历一体化可视化工作流'],
]);

// 前端通知品牌前缀
const srcDir = ROOT + '/src';
function walk(dir, fn) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walk(p, fn);
    else if (/\.tsx?$/.test(n)) fn(p);
  }
}
walk(srcDir, (p) => {
  const t = fs.readFileSync(p, 'utf8');
  const before = t;
  let out = t.split('[StarOS]').join('[StarTasks]');
  out = out.split("'StarOS'").join("'StarTasks'");
  out = out.split('app.info()').join('app.info()'); // noop
  // 通知标题 / 文案里的产品名（不碰 legacyImport 的旧库路径 task-manager）
  out = out.replace(/TaskManager/g, (m, off, str) => {
    // 保留历史指涉：旧版 / 数据库路径 / 旧库 / legacy 上下文
    const ctx = str.slice(Math.max(0, off - 40), off + 50);
    if (/旧版|legacy|task-manager|\.db|Legacy|迁移|Electron/.test(ctx)) return m;
    return 'StarTasks';
  });
  if (out !== before) { fs.writeFileSync(p, out, 'utf8'); console.log('updated src:', path.relative(ROOT, p)); }
});

console.log('rename done');
