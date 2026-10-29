/**
 * 安全时间格式化 —— 任何脏数据都不能让界面崩。
 *
 * 事故背景：班级成员页用 `new Date(m.joinedAt).toISOString()` 渲染「加入于」，
 * 而服务端返回的是 `joined_at`（下划线）→ m.joinedAt 为 undefined →
 * `toISOString()` 抛 RangeError「Invalid time value」→ 整个成员界面被 ErrorBoundary 接住。
 */

export function toDate(v: unknown): Date | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v as any);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 统一格式化；非法/缺失返回 fallback（默认 '—'），绝不抛异常 */
export function fmtDate(
  v: unknown,
  mode: 'date' | 'datetime' | 'md' | 'hm' = 'date',
  fallback = '—',
): string {
  const d = toDate(v);
  if (!d) return fallback;
  const y = d.getFullYear();
  const mo = pad(d.getMonth() + 1);
  const da = pad(d.getDate());
  const h = pad(d.getHours());
  const mi = pad(d.getMinutes());
  switch (mode) {
    case 'datetime': return `${y}-${mo}-${da} ${h}:${mi}`;
    case 'md': return `${mo}-${da}`;
    case 'hm': return `${h}:${mi}`;
    default: return `${y}-${mo}-${da}`;
  }
}

/** 同时兼容 camelCase / snake_case 的字段读取（服务端与 mock 命名不一致） */
export function pick<T = any>(obj: any, ...keys: string[]): T | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

/** 递归把 snake_case 键转 camelCase（服务端直接返回数据库行时用） */
export function camelize<T = any>(v: any): T {
  if (Array.isArray(v)) return v.map((x) => camelize(x)) as any;
  if (v && typeof v === 'object') {
    const out: Record<string, any> = {};
    for (const [k, val] of Object.entries(v)) {
      const key = k.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
      out[key] = camelize(val);
    }
    return out as T;
  }
  return v as T;
}
