/* xls profiles 里 '../../ustb/api' → '../core/ustbTypes'；'../../core/periods' → '../../core/periods' 已在 core/ */
const fs = require('fs');
const path = require('path');
const dir = 'E:/University/TaskManager/HTML/src/xls/profiles';
for (const f of fs.readdirSync(dir)) {
  const p = path.join(dir, f);
  let t = fs.readFileSync(p, 'utf8');
  const before = t;
  t = t.split("from '../../ustb/api'").join("from '../../core/ustbTypes'");
  t = t.split('from "../../ustb/api"').join('from "../../core/ustbTypes"');
  t = t.split("from '../../core/periods'").join("from '../../core/periods'");
  if (t !== before) { fs.writeFileSync(p, t, 'utf8'); console.log('fixed', f); }
  else console.log('skip', f);
}
console.log('done');
