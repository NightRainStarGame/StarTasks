/* 删除 Settings.tsx 里整段月卡付费组件（v1.2.6 月卡已随付费体系下线） */
const fs = require('fs');
const p = 'E:/University/TaskManager/HTML/src/pages/Settings.tsx';
const lines = fs.readFileSync(p, 'utf8').split('\n');

// 找 "// ============================================================" 开头 + "// v1.2.6 月卡购买" 的段起点
let start = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('v1.2.6 月卡购买（收款码')) {
    // 回退到紧邻的分隔注释块开头
    start = i;
    while (start > 0 && !lines[start].includes('// ============================================================')) start--;
    break;
  }
}
if (start < 0) { console.log('billing block not found'); process.exit(0); }

// 段终点：文件尾部的注释尾巴（MonthlyRedeemRow 已被…）之后
const out = lines.slice(0, start);
// 兜底：去掉尾部重复注释
while (out.length && (out[out.length - 1].includes('MonthlyRedeemRow 已被') || out[out.length - 1].trim() === '')) out.pop();
fs.writeFileSync(p, out.join('\n') + '\n', 'utf8');
console.log('removed billing block from line', start + 1, 'to end; new line count:', out.length);
