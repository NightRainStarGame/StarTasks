/* 自查：按 token 扫描主题色类名（避免正则边界误报） */
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'E:/University/TaskManager/HTML/src';
const COLORS = new Set([
  'neon-green', 'neon-green-bright', 'neon-green-dim', 'neon-green-deep',
  'neon-yellow', 'neon-yellow-bright', 'neon-yellow-dim', 'neon-danger', 'neon-cyan',
  'ink-base', 'ink-900', 'ink-800', 'ink-700', 'ink-600', 'ink-500',
  'text-primary', 'text-secondary', 'text-dim',
]);
const FAMILIES = ['neon', 'ink', 'text'];
const PREFIXES = ['bg', 'text', 'border', 'from', 'via', 'to', 'ring', 'divide', 'outline', 'decoration', 'placeholder', 'fill', 'stroke', 'accent', 'caret'];
const SHADOWS = new Set(['shadow-neon-green', 'shadow-neon-green-strong', 'shadow-neon-yellow', 'shadow-glass']);

function walk(dir, out = []) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(n)) out.push(p);
  }
  return out;
}

const bad = new Map();
for (const f of walk(SRC)) {
  const tokens = fs.readFileSync(f, 'utf8').split(/[\s"'`{}()<>,;:=+]+/);
  for (const raw of tokens) {
    // 去掉任意透明度写法（/20、/[0.03]、/\[3%\]）再清洗
    const tk = raw.replace(/\/\S*$/, '').replace(/[^\w-]/g, '');
    if (SHADOWS.has(tk)) continue;
    const m = /^(bg|text|border|from|via|to|ring|divide|outline|decoration|placeholder|fill|stroke|accent|caret)-([a-z][\w-]*)$/.exec(tk);
    if (!m) continue;
    const rest = m[2];
    if (!FAMILIES.some((x) => rest === x || rest.startsWith(x + '-'))) continue;
    if (!COLORS.has(rest)) bad.set(tk, path.relative(SRC, f));
  }
}

console.log('=== 拼错/不存在的主题色类名 ===');
if (!bad.size) console.log('（无）');
else [...bad.entries()].sort().forEach(([c, f]) => console.log(` ${c}   ← ${f}`));
