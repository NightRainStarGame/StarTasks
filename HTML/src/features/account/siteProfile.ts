/**
 * 网站账号资料快取 —— 昵称/头像同步给班级用。
 * 登录态在 siteHandlers（localStorage starmain_token），这里统一读。
 */
export interface SiteProfile {
  loggedIn: boolean;
  username: string;
  avatarUrl: string;
}

export async function getSiteProfile(): Promise<SiteProfile> {
  const site = (window.taskAPI as any).site;
  try {
    const t = await site?.hasToken?.();
    if (!t?.hasToken) return { loggedIn: false, username: '', avatarUrl: '' };
    const r = await site?.me?.();
    if (r?.ok && r.user) {
      return {
        loggedIn: true,
        username: String(r.user.username || ''),
        avatarUrl: String(r.user.avatar_url || r.user.avatar || ''),
      };
    }
    return { loggedIn: false, username: '', avatarUrl: '' };
  } catch {
    return { loggedIn: false, username: '', avatarUrl: '' };
  }
}
