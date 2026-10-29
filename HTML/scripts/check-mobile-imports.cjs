const fs = require('fs');
const path = require('path');
const dir = 'E:/University/TaskManager/HTML/src/mobile';
for (const f of fs.readdirSync(dir)) {
  const t = fs.readFileSync(path.join(dir, f), 'utf8');
  const m = [...t.matchAll(/from ['"]([^'"]+)['"]/g)].map((x) => x[1]).filter((x) => x.includes('electron') || x.includes('..'));
  console.log(f, '=>', m.join(' | ') || '(no external)');
}
