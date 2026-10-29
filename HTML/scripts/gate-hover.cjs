/* 把 index.css 里裸的 :hover 规则包进 @media (hover: hover) and (pointer: fine)——
   触摸屏点按后 hover 卡死是「网页感」头号来源（Tailwind hover: 变体已由
   future.hoverOnlyWhenSupported 处理，这里只管手写规则）。 */
const fs = require('fs');
const p = 'E:/University/TaskManager/HTML/src/styles/index.css';
let t = fs.readFileSync(p, 'utf8');

// 匹配「含 :hover 的选择器 + 单层 { ... } 块」（CSS 里这些块无嵌套花括号）
const re = /([^\n{]*:hover[^\n{]*)\{([^{}]*)\}/g;
let count = 0;
t = t.replace(re, (full, sel, body) => {
  // 已在媒体查询里的跳过（粗判：规则前 200 字符内有 hover: hover）
  count++;
  return `@media (hover: hover) and (pointer: fine) {\n  ${sel.trim()} {${body}}\n}`;
});
fs.writeFileSync(p, t, 'utf8');
console.log('wrapped', count, 'hover rules');
