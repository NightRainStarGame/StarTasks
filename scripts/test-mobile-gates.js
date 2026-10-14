#!/usr/bin/env node
/**
 * test-mobile-gates.js —— 移动端平台门审计（v1.2.20 新增）
 *
 * 为什么要有这个：历史上移动端的功能缺口几乎全是「能跑但被藏起来」或「通道半成品」——
 * 贝壳课表的 nativeHttp 桥 v1.2.10 就写好了，按钮藏到 v1.2.20 才开；插件更是从没装进 APK。
 * 这类问题读代码觉得都对、跑起来全是坑，而且**用户永远是第一个发现的**。
 * 所以把「移动端可见性」变成机械断言：
 *
 *   A. 每一处 IS_MOBILE / __MOBILE__ 平台门，上方 3 行内必须有「移动端/v1.2」注释说明理由
 *   B. 关键移动端能力的不变量（今天修的每一项都钉死在这里）
 *
 * 跑法：npm test（已并入）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (['node_modules', 'dist', 'dist-electron', 'dist-mobile', '.git', 'android', 'release-v1.2.18-r2'].includes(name)) continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  OK ${name}`); }
  else { fail++; console.log(`  XX ${name}${extra ? '   -> ' + extra : ''}`); }
}

console.log('\n[A. 平台门必须有书面理由]');
const files = walk(path.join(ROOT, 'src'));
let gateCount = 0;
const undocumented = [];
for (const f of files) {
  // walk() 返回绝对路径，直接读，不能再拼 ROOT
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!/(IS_MOBILE|__MOBILE__)/.test(line)) return;
    if (/^\s*(const|let|\/\/|\*|\/\*|import)/.test(line)) return;
    if (!/(if \(|return|\?|&&)/.test(line)) return;
    gateCount++;
    const around = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
    if (!/移动端|MOBILE|v1\.2/.test(around)) {
      undocumented.push(path.relative(ROOT, f) + ':' + (i + 1) + ': ' + line.trim().slice(0, 80));
    }
  });
}
if (undocumented.length) {
  console.log('  XX ' + undocumented.length + ' 处平台门没有书面理由:');
  undocumented.forEach((u) => console.log('     ' + u));
  fail++;
} else {
  console.log('  OK 全部 ' + gateCount + ' 处平台门都有书面理由');
  pass++;
}

console.log('\n[B. 移动端能力不变量（今天修复项的回归钉）]');

const courses = read('src/pages/Courses/CoursesPage.tsx');
const beikeIdx = courses.indexOf('贝壳课表');
check('B1 贝壳课表按钮存在', beikeIdx >= 0);
if (beikeIdx >= 0) {
  const before = courses.slice(Math.max(0, beikeIdx - 400), beikeIdx);
  const lastLines = before.split('\n').slice(-4).join('\n');
  check('B1 贝壳课表不再被 IS_MOBILE 藏', !/\{!IS_MOBILE && \(\s*$/.test(lastLines), lastLines.replace(/\s+/g, ' ').slice(-120));
}

const beike = read('src/components/BeikeTimetable.tsx');
check('B2 贝壳课表有相册扫码提示', beike.includes('相册') && beike.includes('__MOBILE__'));

const nativeHttp = read('src/mobile/nativeHttp.ts');
check('B3 nativeHttp 探测 Plugins.Http', nativeHttp.includes('Plugins?.Http'));
const mainAct = read('android/app/src/main/java/com/lasarac/taskmanager/MainActivity.java');
check('B3 MainActivity 注册 Http 插件', /registerPlugin\(com\.getcapacitor\.plugin\.http\.Http\.class\)/.test(mainAct));
const settingsGradle = read('android/capacitor.settings.gradle');
check('B3 settings.gradle 含 capacitor-community-http', settingsGradle.includes('capacitor-community-http'));
const appGradle = read('android/app/capacitor.build.gradle');
check('B3 app 依赖 capacitor-community-http', appGradle.includes("project(':capacitor-community-http')"));

const layout = read('src/components/Layout.tsx');
check('B4 Layout 移动端启动检查 APK 更新', /__MOBILE__[\s\S]{0,700}checkAndroidUpdate/.test(layout));

const upNotif = read('src/components/UpdateNotification.tsx');
check('B5 UpdateNotification 有手机版卡片', upNotif.includes('__MOBILE__') && upNotif.includes('知道了'));

const settingsPage = read('src/pages/Settings.tsx');
check('B6 MobileUpdatePanel 仍挂载在设置页', settingsPage.includes('<MobileUpdatePanel'));

console.log('\n' + '-'.repeat(56));
console.log('  结果：' + pass + ' 通过，' + fail + ' 失败');
console.log('-'.repeat(56) + '\n');
process.exit(fail ? 1 : 0);
