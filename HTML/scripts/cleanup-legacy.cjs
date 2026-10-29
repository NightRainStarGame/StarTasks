/**
 * 清理旧 TaskManager 内容（Electron 时代产物），保留 HTML/ 新工程与 .git/.codebuddy。
 * 步骤：① 未跟踪文件先 zip 备份到 _legacy-untracked-backup.zip（防永久丢失）
 *      ② 删除旧目录与旧文件（tracked 文件可从 git 恢复）
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = 'E:/University/TaskManager';

// 1) 备份未跟踪文件（排除 HTML/ .git .codebuddy）
console.log('① 备份未跟踪文件…');
try {
  const out = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8' });
  const untracked = out.split('\n')
    .filter(l => l.startsWith('?? ') || l.startsWith(' M') || l.startsWith('M '))
    .map(l => l.slice(3).trim())
    .filter(p => p && !p.startsWith('HTML/') && !p.startsWith('.git') && !p.startsWith('.codebuddy'));
  const tmpList = path.join(ROOT, '.cleanup-list.txt');
  fs.writeFileSync(tmpList, untracked.join('\n'), 'utf8');
  if (untracked.length) {
    // tar 打包（Windows10+ 自带 bsdtar）
    try {
      execSync(`tar -czf "${ROOT}/_legacy-untracked-backup.zip" -C "${ROOT}" -T "${tmpList}"`, { stdio: 'pipe' });
      console.log('   备份完成:', untracked.length, '项 → _legacy-untracked-backup.zip');
    } catch (e) {
      // 逐个复制到备份文件夹兜底
      const bak = path.join(ROOT, '_legacy-backup');
      for (const p of untracked) {
        const src = path.join(ROOT, p);
        const dst = path.join(bak, p);
        if (!fs.existsSync(src)) continue;
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.cpSync(src, dst, { recursive: true });
      }
      console.log('   tar 不可用，已复制到 _legacy-backup/（', untracked.length, '项）');
    }
    fs.unlinkSync(tmpList);
  } else {
    console.log('   无未跟踪文件');
    if (fs.existsSync(tmpList)) fs.unlinkSync(tmpList);
  }
} catch (e) {
  console.log('   备份跳过（git 不可用）:', e.message);
}

// 2) 删除旧内容
const DIRS = [
  'android', 'build', 'data', 'docs', 'electron', 'homework',
  'leastversion', 'oldversion', 'scripts', 'src',
];
const FILES = [
  '{const', '$null', 'x.type+', '05-legal.png', 'a.json', 'b.json', 'about.txt',
  'AGENTS.md', 'capacitor.config.ts', 'index-mobile.html', 'index.html', 'latest.json',
  'LICENSE', 'notes-v1.1.8.md', 'package-lock.json', 'package.json', 'postcss.config.js',
  'README.md', 'tailwind.config.js', 'tsconfig.json', 'tsconfig.node.json',
  'vite.config.ts', 'vite.mobile.config.ts',
];

console.log('② 删除旧内容…');
let removed = 0;
for (const d of DIRS) {
  const p = path.join(ROOT, d);
  if (fs.existsSync(p)) {
    // robocopy /MIR 空目录清空更稳（Windows 句柄问题），再删壳
    try {
      const empty = path.join(ROOT, '.empty-del');
      fs.mkdirSync(empty, { recursive: true });
      execSync(`robocopy "${empty}" "${p}" /MIR /NFL /NDL /NJH /NJS /NC /NS`, { stdio: 'pipe' });
      fs.rmSync(p, { recursive: true, force: true });
      fs.rmdirSync(empty);
    } catch {
      fs.rmSync(p, { recursive: true, force: true });
    }
    removed++;
    console.log('   删目录', d);
  }
}
for (const f of FILES) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p) && fs.statSync(p).isFile()) {
    fs.unlinkSync(p);
    removed++;
    console.log('   删文件', f);
  }
}
// release-notes-*.md 全删
for (const n of fs.readdirSync(ROOT)) {
  if (/^release-notes-.*\.md$/.test(n)) {
    fs.unlinkSync(path.join(ROOT, n));
    removed++;
    console.log('   删文件', n);
  }
}
console.log('完成，共移除', removed, '项。HTML/ 与 .git/.codebuddy 已保留');
