/**
 * 上课作息（大节 ↔ 时间）的**唯一出处**。
 *
 * v1.2.18：这张 6 行的表以前被复制了三份 ——
 *   ① electron/timetable-xls/profiles/shared.ts
 *   ② electron/ustb/importer.ts（私有副本）
 *   ③ src/mocks/browserApi.ts（内联在浏览器预览 mock 里）
 * 而它同时承担**正向**（大节 → 时间）和**反向**（时间段 → 大节号）两种用途，
 * 改一处要验证两处；三份副本里 mock 那份最容易漂移（改学校作息时没人会想到去改 mock）。
 *
 * 放进 electron/core/ 的理由与 ics.ts 相同：这个目录不 import electron、不碰 Node 内置模块，
 * 所以**桌面主进程、移动端 webview、浏览器预览 mock 三处都能直接 import**，
 * 并且能被 scripts/test-core.js 直接 require 验证。
 */

/** 大节 → 上课时间。教务导入与课表导入共用这一张表（v1.1.x 起一直没变过）。 */
export const FALLBACK_PERIODS: Record<number, [string, string]> = {
  1: ['08:00', '09:35'], 2: ['09:50', '11:25'], 3: ['14:00', '15:35'],
  4: ['15:50', '17:25'], 5: ['18:30', '20:05'], 6: ['20:10', '21:45'],
};

/** 每半天 2 个小节 → 大节号 = ceil(首节 / 2)。1-2→1、3-4→2、5-6→3… */
export const PERIODS_PER_BIG_SESSION = 2;

export function bigSessionOf(firstPeriod: number): number {
  if (!Number.isFinite(firstPeriod) || firstPeriod <= 0) return 0;
  return Math.ceil(firstPeriod / PERIODS_PER_BIG_SESSION);
}

/** 找不到对应大节时用的兜底（原来散在 3 个调用点的 `?? ['08:00','09:35']`） */
export const FALLBACK_PERIOD: [string, string] = ['08:00', '09:35'];

/** 大节 → 时间；没有该大节则返回兜底 */
export function periodsOf(bigSession: number): [string, string] {
  return FALLBACK_PERIODS[bigSession] || FALLBACK_PERIOD;
}

/** "08:00-09:35" → [{start,end,period}]；不是时间段则返回空数组（反查大节号） */
export function parseTimeRange(s: string): { start: string; end: string; period: number }[] {
  const m = s.match(/(\d{1,2}:\d{2})\s*[~\-～—]\s*(\d{1,2}:\d{2})/);
  if (!m) return [];
  const start = m[1].length === 4 ? '0' + m[1] : m[1];
  const end = m[2].length === 4 ? '0' + m[2] : m[2];
  let period = 0;
  for (const [k, v] of Object.entries(FALLBACK_PERIODS)) {
    if (v[0] === start && v[1] === end) { period = +k; break; }
  }
  return [{ start, end, period }];
}
