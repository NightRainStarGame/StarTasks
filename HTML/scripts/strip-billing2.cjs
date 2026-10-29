/* 删除 mock 与契约层里的 billing 命名空间（月卡功能整体下线） */
const fs = require('fs');

function stripBlock(path, startPattern, endPattern) {
  let t = fs.readFileSync(path, 'utf8');
  const i = t.search(startPattern);
  if (i < 0) { console.log('not found in', path); return; }
  // 找到块尾（配对的 "    }," 或 "    }"）
  let depth = 0, j = t.indexOf('{', i);
  let k = j;
  while (k < t.length) {
    if (t[k] === '{') depth++;
    else if (t[k] === '}') { depth--; if (depth === 0) break; }
    k++;
  }
  // 吃掉后面的逗号与换行
  let end = k + 1;
  if (t[end] === ',') end++;
  while (t[end] === '\n' || t[end] === '\r') end++;
  t = t.slice(0, i) + t.slice(end);
  fs.writeFileSync(path, t, 'utf8');
  console.log('stripped billing block in', path, 'chars', end - i);
}

const root = 'E:/University/TaskManager/HTML/src';
stripBlock(root + '/mocks/browserApi.ts', /\/\/ v1\.2\.6：付费月卡 mock[\s\S]*?billing:\s*\{/);
stripBlock(root + '/api/api-factory.ts', /\/\*\* v1\.2\.6：付费体系[\s\S]*?billing:\s*\{/);

// config/pricing.ts 整文件删（月卡定价表无引用了）
const pricing = root + '/config/pricing.ts';
if (fs.existsSync(pricing)) { fs.unlinkSync(pricing); console.log('deleted config/pricing.ts'); }
console.log('done');
