/**
 * 网站账号区块 —— 替换旧的「本地账号密码 / 学籍信息 / 多账户切换」整块。
 *
 * 形态：未登录 → 用户名+密码登录（表单）；已登录 → 头像/用户名/邮箱/余额 + 退出。
 * 认证走 window.taskAPI.site.*（底层在 Tauri 原生 HTTP / 浏览器 fetch 自动切换）。
 * token 存 localStorage `starmain_token`，刷新后自动恢复会话（site:me）。
 */
import { useEffect, useState } from 'react';
import { LogIn, LogOut, User, RefreshCw, ExternalLink, ShieldCheck, Zap } from 'lucide-react';
import { toast } from '@/utils/toast';

interface SiteUser {
  id: number;
  username: string;
  email: string | null;
  role: string;
  avatar_url?: string | null;
  balance?: number;
  token_balance?: number;
}

function siteApi() {
  return (window.taskAPI as any).site;
}

export default function SiteAccountSection() {
  const [user, setUser] = useState<SiteUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 一键授权登录（设备授权流）
  const [authWaiting, setAuthWaiting] = useState<{ userCode: string } | null>(null);

  const startDeviceAuth = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await (window.taskAPI as any).site?.deviceStart?.();
      if (!r?.ok) { setErr(r?.error || '发起授权失败'); setBusy(false); return; }
      // 拉起浏览器到授权页（壳内走系统浏览器）；演示模式 url 为空 → 不拉浏览器
      if (r.url) {
        try {
          await (window.taskAPI as any).updater?.openExternal?.(r.url);
        } catch { window.open(r.url, '_blank'); }
      }
      setAuthWaiting({ userCode: r.userCode });
      setBusy(false);
      // 轮询授权结果（2.5s × 48 次 ≈ 2 分钟）
      for (let i = 0; i < 48; i++) {
        await new Promise((res) => setTimeout(res, 2500));
        const p = await (window.taskAPI as any).site?.devicePoll?.(r.deviceCode);
        if (p?.ok && p.user) {
          setAuthWaiting(null);
          setUser(p.user);
          setPassword('');
          toast.success(`授权成功，已登录：${p.user.username}`);
          try { await (window.taskAPI as any).class?.saveLocalAlias?.(p.user.username); } catch { /* noop */ }
          return;
        }
        if (p?.reason === 'ERROR') {
          setAuthWaiting(null);
          setErr(p?.error || '授权失败，请重试');
          return;
        }
      }
      setAuthWaiting(null);
      setErr('授权超时，请重新发起');
    } catch (e: any) {
      setAuthWaiting(null);
      setErr(e?.message || String(e));
      setBusy(false);
    }
  };

  // 启动恢复会话
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const t = await siteApi()?.hasToken();
        if (!t?.hasToken) { if (alive) setChecking(false); return; }
        const r = await siteApi()?.me();
        if (alive && r?.ok) setUser(r.user ?? null);
      } catch { /* 网络不可用时保持未登录 */ }
      finally { if (alive) setChecking(false); }
    })();
    return () => { alive = false; };
  }, []);

  const login = async () => {
    if (!username.trim() || !password) { setErr('请填写用户名和密码'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await siteApi()?.login(username.trim(), password);
      if (r?.ok && r.user) {
        setUser(r.user);
        setPassword('');
        toast.success(`已登录：${r.user.username}`);
        // 昵称/头像同步：登录即把网站用户名写为班级默认昵称（班内可改）
        try {
          await (window.taskAPI as any).class?.saveLocalAlias?.(r.user.username);
        } catch { /* 同步昵称失败不阻断登录 */ }
      } else {
        setErr(r?.error || '登录失败');
      }
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await siteApi()?.logout();
    setUser(null);
    toast.success('已退出登录');
  };

  if (checking) {
    return (
      <div className="flex items-center gap-2 text-text-dim font-mono text-xs p-3">
        <RefreshCw size={13} className="animate-spin" /> 正在恢复登录状态…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 p-3 rounded-md bg-ink-base/40 border border-neon-green/15">
          <div className="w-12 h-12 rounded-full bg-ink-900 border border-neon-green/20 flex items-center justify-center shrink-0">
            <User size={20} className="text-text-dim" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-text-secondary text-sm">未登录</div>
            <div className="font-mono text-[10px] text-text-dim mt-0.5">登录星芒网站账号（nrsc.games），同步你的云端身份</div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-text-secondary block mb-1">用户名 / 邮箱</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && login()}
              className="input-neon w-full"
              placeholder="网站账号"
              autoComplete="username"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-text-secondary block mb-1">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && login()}
              className="input-neon w-full"
              placeholder="网站密码"
              autoComplete="current-password"
            />
          </div>
        </div>

        {err && <div className="text-neon-danger font-mono text-xs">❌ {err}</div>}

        {/* 一键授权登录：等授权中显示验证码 */}
        {authWaiting && (
          <div className="p-3 rounded-md border border-neon-yellow/40 bg-neon-yellow/5 text-xs space-y-1">
            <div className="text-neon-yellow font-mono">⏳ 等待浏览器授权中…</div>
            <div className="font-mono text-[11px] text-text-secondary">
              授权码：<strong className="text-neon-green tracking-widest">{authWaiting.userCode}</strong>
              （在浏览器里点「授权登录」后这里会自动登录）
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={startDeviceAuth} disabled={busy || !!authWaiting} className="btn-neon btn-neon-yellow">
            <Zap size={14} /> 一键授权登录
          </button>
          <button onClick={login} disabled={busy} className="btn-ghost">
            <LogIn size={14} /> {busy ? '登录中…' : '密码登录'}
          </button>
          <a
            href="https://nrsc.games/register"
            target="_blank"
            rel="noreferrer"
            className="btn-ghost text-xs"
          >
            <ExternalLink size={12} /> 没有账号？去注册
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 p-3 rounded-md bg-ink-base/40 border border-neon-green/15">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center text-2xl font-bold font-mono shrink-0"
          style={{
            background: 'linear-gradient(135deg, #00FF88, #00FFC8)',
            color: '#000',
            boxShadow: '0 0 16px #00FF8866',
          }}
        >
          {user.username[0]?.toUpperCase() || '?'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-neon-green flex items-center gap-2">
            {user.username}
            <ShieldCheck size={14} className="text-neon-green" />
          </div>
          <div className="font-mono text-[10px] text-text-dim mt-0.5">
            星芒网站账号{user.email ? ` · ${user.email}` : ''}{user.role === 'admin' ? ' · 管理员' : ''}
          </div>
        </div>
        <button onClick={logout} className="btn-ghost shrink-0">
          <LogOut size={14} /> 退出登录
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
        <div className="p-2.5 rounded-md bg-ink-base/40 border border-neon-green/10">
          <div className="text-text-dim">星币余额</div>
          <div className="text-neon-green text-sm mt-0.5">{user.balance ?? 0}</div>
        </div>
        <div className="p-2.5 rounded-md bg-ink-base/40 border border-neon-green/10">
          <div className="text-text-dim">Token 余额</div>
          <div className="text-neon-green text-sm mt-0.5">{user.token_balance ?? 0}</div>
        </div>
      </div>
    </div>
  );
}
