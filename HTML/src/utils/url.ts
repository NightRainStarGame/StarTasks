/** 资源 URL 归一化 —— 头像等由网站下发的路径是相对的（/uploads/...），
 *  在应用里（tauri:// 或 sthot://）会被解析到错误 origin，图片加载失败只剩空框。
 *  统一补成绝对地址。 */
const SITE_ORIGIN = 'https://nrsc.games';

export function absUrl(u?: string | null): string {
  if (!u) return '';
  const s = String(u).trim();
  if (!s) return '';
  if (/^(https?:|data:|blob:)/i.test(s)) return s;
  if (s.startsWith('//')) return `https:${s}`;
  if (s.startsWith('/')) return `${SITE_ORIGIN}${s}`;
  return `${SITE_ORIGIN}/${s}`;
}
