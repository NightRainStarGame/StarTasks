/**
 * 教务同步面板 —— 扫码登录 USTB SSO，一键把教务成绩/绩点拉进成绩表。
 * 嵌在学业「成绩」Tab 顶部。浏览器预览下平台 HTTP 走 fetch 受 CORS 限制，
 * 会明确报错；桌面/Android 壳（Rust 原生 HTTP）可用。
 */
import { useEffect, useState } from 'react';
import { RefreshCw, LogIn, LogOut, GraduationCap, QrCode } from 'lucide-react';
import { toast } from '@/utils/toast';

export default function UstbSyncPanel({ onSynced }: { onSynced: () => void }) {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [userName, setUserName] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState('');

  const ustb = () => (window.taskAPI as any).ustb;

  useEffect(() => {
    (async () => {
      const r = await ustb()?.status?.();
      setLoggedIn(!!r?.loggedIn);
      if (r?.loggedIn) {
        try {
          const u = JSON.parse((await (window.taskAPI as any).db.settings.get?.('ustb_user'))?.value || '{}');
          setUserName(u?.name || '');
        } catch { /* noop */ }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startLogin = async () => {
    setBusy('login');
    setStatus('');
    try {
      const r = await ustb()?.qrStart?.();
      if (r?.ok) {
        setQr(r.qrImage || r.qr);
        setStatus('请用企业微信/微信扫描二维码');
        pollLoop(r.sessionId);
      } else {
        setStatus(`❌ ${r?.error || '发起登录失败'}`);
      }
    } catch (e: any) {
      setStatus(`❌ ${e?.message || String(e)}`);
    } finally { setBusy(''); }
  };

  const pollLoop = async (sessionId?: string) => {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const r = await ustb()?.qrPoll?.(sessionId);
        if (r?.status === 'success') {
          setQr(null);
          setLoggedIn(true);
          setUserName(r.user?.name || '');
          setStatus(`✅ 登录成功：${r.user?.name || ''}`);
          toast.success('教务登录成功');
          return;
        }
        if (r?.status === 'scanned') setStatus('已扫码，请在手机上确认…');
        if (r?.status === 'expired') { setStatus('二维码过期，请重新发起'); setQr(null); return; }
        if (r?.status === 'error') { setStatus(`❌ ${r.message || '轮询失败'}`); return; }
      } catch (e: any) {
        setStatus(`❌ ${e?.message || String(e)}`);
        return;
      }
    }
    setStatus('二维码超时，请重新发起');
    setQr(null);
  };

  const syncGrades = async () => {
    setBusy('sync');
    setStatus('');
    try {
      const r = await ustb()?.syncGrades?.();
      if (r?.ok) {
        setStatus(`✅ 已同步 ${r.imported} 门成绩`);
        toast.success(`教务成绩同步完成（${r.imported} 门）`);
        onSynced();
      } else {
        setStatus(`❌ ${r?.error || '同步失败'}`);
      }
    } catch (e: any) {
      setStatus(`❌ ${e?.message || String(e)}`);
    } finally { setBusy(''); }
  };

  const logout = async () => {
    await ustb()?.logout?.();
    setLoggedIn(false);
    setUserName('');
    setStatus('已退出教务');
  };

  return (
    <div className="glass-panel p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="label-tag flex items-center gap-1"><GraduationCap size={12} /> 教务同步</span>
        {loggedIn ? (
          <>
            <span className="font-mono text-[11px] text-neon-green">✓ {userName || '已登录'}</span>
            <button onClick={syncGrades} disabled={!!busy} className="btn-neon px-2.5 py-1 text-xs">
              <RefreshCw size={12} className={busy === 'sync' ? 'animate-spin' : ''} /> 从教务同步成绩
            </button>
            <button onClick={logout} className="btn-ghost px-2 py-1 text-xs"><LogOut size={12} /> 退出</button>
          </>
        ) : (
          <button onClick={startLogin} disabled={!!busy} className="btn-neon px-2.5 py-1 text-xs">
            <LogIn size={12} /> 扫码登录教务
          </button>
        )}
      </div>

      {qr && (
        <div className="flex items-center gap-3">
          <img src={qr} alt="教务登录二维码" className="w-32 h-32 rounded border border-neon-green/30 bg-white p-1" />
          <div className="text-xs text-text-secondary font-mono space-y-1">
            <div className="flex items-center gap-1"><QrCode size={12} /> 用微信扫码</div>
            <div className="text-text-dim">扫码后自动完成登录并拉取成绩</div>
          </div>
        </div>
      )}

      {status && <div className="font-mono text-[11px] text-text-secondary">{status}</div>}
      <div className="text-[10px] text-text-dim font-mono">
        · 同步按课程名合并进成绩表（幂等，可重复点）· 成绩来源：本研一体教务（BYYT）
      </div>
    </div>
  );
}
