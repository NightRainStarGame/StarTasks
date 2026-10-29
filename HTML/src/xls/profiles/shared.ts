/**
 * 学校档案共用的小工具（**不 import electron**，以便单测直接跑）。
 *
 * v1.2.18：作息表已搬到 electron/core/periods.ts（唯一出处），这里只做 re-export，
 * 免得档案代码里到处 import core/。
 */
import type { ParsedClassItem } from '../../core/ustbTypes';
import { FALLBACK_PERIODS, PERIODS_PER_BIG_SESSION, bigSessionOf, parseTimeRange } from '../../core/periods';

export { FALLBACK_PERIODS, PERIODS_PER_BIG_SESSION, bigSessionOf, parseTimeRange };

/** 单元格 → 去空白的字符串 */
export function cellToString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  return String(v).trim();
}

/** 整表规整成 string[][]（顺手砍掉全空的尾行） */
export function normalizeAoa(aoa: unknown[][]): string[][] {
  const rows = aoa.map((r) => (r || []).map(cellToString));
  while (rows.length && rows[rows.length - 1].every((c) => !c)) rows.pop();
  return rows;
}

/** 周日/周X/数字 → 1-7（周一=1，周日=7） */
export function parseDay(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const map: Record<string, number> = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };
  for (const k of Object.keys(map)) if (t.includes(k)) return map[k];
  const n = parseInt(t, 10);
  if (n >= 1 && n <= 7) return n;
  return null;
}

/**
 * 从节次字段里取出一组节次。
 * - "1-2" / "1~2" → 一项，period=1（大节），periodName="1-2"
 * - "1,3,5"       → 三项（少见，保留扩展能力）
 * - "08:00-09:35" → 一项（时间段反查大节）
 */
export function parsePeriodList(s: string): { items: { period: number; periodName: string }[] } {
  const t = s.replace(/[（()）]/g, '').replace(/第/g, '').trim();
  if (!t) return { items: [] };

  const tr = parseTimeRange(t);
  if (tr.length) return { items: tr.map((x) => ({ period: x.period, periodName: t })) };

  const out: { period: number; periodName: string }[] = [];
  for (const part of t.split(/[,，、\s]+/)) {
    if (!part) continue;
    const m = part.match(/^(\d+)\s*[~\-～]\s*(\d+)$/);
    if (m) {
      const a = +m[1], b = +m[2];
      const [lo, hi] = a < b ? [a, b] : [b, a];
      out.push({ period: lo, periodName: `${lo}-${hi}` });
    } else if (/^\d+$/.test(part)) {
      out.push({ period: +part, periodName: String(+part) });
    }
  }
  return { items: out };
}
