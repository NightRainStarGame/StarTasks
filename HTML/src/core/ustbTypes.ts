/**
 * USTB 课表条目类型 + 周次文本解析（自 electron/ustb/api.ts 抽出的纯函数，
 * xls 解析档案 profiles/* 依赖它；网络部分另在 cloud/ustb.ts）。
 */

export interface ParsedClassItem {
  day: number; // 1=周一 … 7=周日
  period: number; // 大节
  className: string;
  teacher: string;
  weeksText: string;
  weeks: number[];
  location: string;
  periodName: string;
}

/** 解析 "1-16周,单周" 这类周次文本 → 周次数字数组 */
export function parseWeeksText(text: string): number[] {
  const single = text.includes('单');
  const double = text.includes('双');
  const m = /([0-9][0-9,\-]*)/.exec(text.replace(/第/g, ''));
  if (!m) return [];
  const weeks: number[] = [];
  for (const part of m[1].split(',')) {
    const range = part.split('-').map((x) => parseInt(x, 10));
    if (range.some((n) => Number.isNaN(n))) continue;
    const [a, b = a] = range;
    for (let w = a; w <= b; w++) {
      if (single && w % 2 === 0) continue;
      if (double && w % 2 === 1) continue;
      weeks.push(w);
    }
  }
  return weeks;
}
