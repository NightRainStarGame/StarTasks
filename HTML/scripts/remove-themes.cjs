/* 移除霓虹绿(neon-green)与玻璃浅色(glass-light)两个主题的全部样式块（用户要求）。
   按 [data-theme="X"] { ... } 与 [data-theme="X"] <selector> { ... } 整块删除。 */
const fs = require('fs');
const p = 'E:/University/TaskManager/HTML/src/styles/index.css';
let t = fs.readFileSync(p, 'utf8');

for (const theme of ['neon-green', 'glass-light']) {
  // 形态一：[data-theme="X"] { ... }
  const re1 = new RegExp(`\\[data-theme="${theme}"\\] \\{[^}]*\\}\\n?\\n?`, 'g');
  // 形态二：[data-theme="X"] .sel { ... }（选择器内可含逗号换行，块内无嵌套花括号）
  const re2 = new RegExp(`\\[data-theme="${theme}"\\][^{]*\\{[^}]*\\}\\n?`, 'g');
  const before = t.length;
  t = t.replace(re2, '');
  fs.writeFileSync(p, t, 'utf8');
  console.log(`removed ${theme} blocks:`, before - t.length, 'chars');
}
// 收尾：压缩连续空行
t = t.replace(/\n{3,}/g, '\n\n');
fs.writeFileSync(p, t, 'utf8');
console.log('done');
