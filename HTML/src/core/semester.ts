/**
 * 学期起止推断（北科校历惯例）：
 *   秋季学期 = 9 月第一个周一开学
 *   春季学期 = 3 月第一个周一开学
 * 用于「贝壳课表」同步时自动填「第 1 周周一」，避免默认成今天导致整张课表日期错位。
 */

/** 返回「该学年学期第 1 周周一」的本地时间戳（0 点） */
export function guessSemesterStart(xn: string, xq: string): number {
  const startYear = Number(String(xn).split('-')[0]);
  const year = Number.isFinite(startYear) && startYear > 1990 ? startYear : new Date().getFullYear();
  const isSpring = String(xq) === '2';
  const month = isSpring ? 2 : 8; // 0-based：2=3 月，8=9 月
  const base = new Date(isSpring ? year + 1 : year, month, 1, 0, 0, 0, 0);
  const dow = base.getDay(); // 0=周日
  const delta = dow === 1 ? 0 : (8 - dow) % 7; // 推到下一个周一
  base.setDate(base.getDate() + delta);
  return base.getTime();
}

/** 该学期标签（如 2026-2027-1 → "2026-2027学年秋季学期"） */
export function semesterLabel(xn: string, xq: string): string {
  return `${xn}学年${String(xq) === '2' ? '春' : '秋'}季学期`;
}
