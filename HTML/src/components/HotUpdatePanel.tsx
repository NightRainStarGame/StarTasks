/**
 * 内容热更新面板（取代旧安装包流程的入口）。
 *
 * 旧 UI 的问题：设置页/右下角提示卡都是 Electron 时代逻辑 —— 必须有 downloadUrl
 * 才能「下载」，下载完才有「安装并重启」。而 SSIO 的内容清单没有安装包直链，
 * 于是按钮永远不出现，热更能力虽已实现却没有任何入口能触发。
 *
 * 这里直接对接 update:check / update:install（→ Rust hot_update_apply）：
 *   检查 → 显示线上内容版本 → 一键更新 → 壳层下载校验并切到新内容 → 窗口自动重载
 */
import { useEffect, useState } from 'react';
import { RefreshCw, Download, CheckCircle2, CloudDownload, Info } from 'lucide-react';

/** 构建时注入（发版脚本设置 VITE_CONTENT_VERSION）；安装包内置的前端为空 */
const BUILD_CONTENT_VERSION = (import.meta.env.VITE_CONTENT_VERSION as string | undefined)?.trim() || '';
const RUNNING = BUILD_CONTENT_VERSION ? `热更内容 ${BUILD_CONTENT_VERSION}` : '内置前端（未热更）';

interface CheckResult {
  ok: boolean;
  configured?: boolean;
  currentVersion?: string;
  latestVersion?: string | null;
  hasUpdate?: boolean;
  notes?: string | null;
  error?: string;
}

export default function HotUpdatePanel() {
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [r, setR] = useState<CheckResult | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [shell, setShell] = useState('');
  const [applied, setApplied] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const info = await (window.taskAPI as any)?.app?.info?.();
        setShell(String(info?.version || ''));
      } catch { /* noop */ }
      // 已应用的内容版本：直接问壳（pages/version.txt），比 JS 侧状态可靠
      try {
        const { appliedHotVersion } = await import('@/api/hotUpdate');
        const v = await appliedHotVersion();
        if (v) setApplied(v);
      } catch { /* noop */ }
    })();
  }, []);

  const check = async () => {
    setChecking(true);
    setMsg(null);
    try {
      const res = (await window.taskAPI.updater.check()) as unknown as CheckResult;
      setR(res);
      if (!res?.ok && res?.error) setMsg({ ok: false, text: res.error });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || String(e) });
    } finally {
      setChecking(false);
    }
  };

  const apply = async () => {
    setApplying(true);
    setMsg(null);
    try {
      const res: any = await window.taskAPI.updater.install();
      if (res?.ok) {
        setMsg({ ok: true, text: `已更新到 ${res.version || r?.latestVersion || '新版本'}，窗口即将自动重载…` });
      } else {
        setMsg({ ok: false, text: res?.error || '更新失败' });
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || String(e) });
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="p-3 rounded-md bg-ink-base/40 border border-neon-green/10 text-[11px] font-mono text-text-secondary space-y-1">
        <div>· 只更新前端界面与逻辑，<strong className="text-neon-green">不重装、不丢数据</strong>（数据库在本地）</div>
        <div>· 壳（Rust/权限/原生能力）变更才需要重新下载安装包</div>
        <div>· 更新后会切到新内容源，<strong className="text-neon-yellow">首次需重新登录网站账号</strong>（浏览器本地存储会换命名空间）</div>
      </div>

      <div className="flex items-center gap-3 flex-wrap font-mono text-xs">
        <span className="text-text-dim">壳版本 <strong className="text-neon-green">v{shell || '—'}</strong></span>
        {/* 硬证据：内置前端（安装包自带）还是热更内容。两者视觉完全一样，只能靠这个区分 */}
        <span className="text-text-dim">
          当前运行 <strong className="text-neon-cyan">{RUNNING}</strong>
        </span>
        <span className="text-text-dim">已应用内容 <strong className="text-neon-cyan">{applied || '内置（未热更）'}</strong></span>
        {r && (
          <span className="text-text-dim">
            线上内容 <strong className={r.hasUpdate ? 'text-neon-yellow' : 'text-neon-green'}>{r.latestVersion || '—'}</strong>
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={check} disabled={checking || applying} className="btn-neon">
          <RefreshCw size={14} className={checking ? 'animate-spin' : ''} />
          {checking ? '检查中…' : '检查内容更新'}
        </button>
        {r?.hasUpdate && (
          <button onClick={apply} disabled={applying} className="btn-neon btn-neon-yellow">
            <Download size={14} />
            {applying ? '更新中…' : `立即更新到 ${r.latestVersion}`}
          </button>
        )}
      </div>

      {r && !r.hasUpdate && r.ok && (
        <div className="flex items-center gap-2 p-2 rounded border border-neon-green/30 bg-neon-green/5 font-mono text-xs text-neon-green">
          <CheckCircle2 size={14} /> 已是最新内容
        </div>
      )}

      {r?.hasUpdate && r.notes && (
        <div className="p-2 rounded border border-neon-yellow/30 bg-neon-yellow/5 font-mono text-[11px] text-text-secondary whitespace-pre-wrap">
          <CloudDownload size={12} className="inline mr-1" />{r.notes}
        </div>
      )}

      {msg && (
        <div className={`p-2 rounded font-mono text-[11px] break-all ${msg.ok ? 'border border-neon-green/40 bg-neon-green/5 text-neon-green' : 'border border-neon-danger/40 bg-neon-danger/5 text-neon-danger'}`}>
          {msg.ok ? '✓ ' : '✗ '}{msg.text}
        </div>
      )}

      <div className="flex items-start gap-1.5 font-mono text-[10px] text-text-dim">
        <Info size={11} className="mt-0.5 shrink-0" />
        <span>浏览器预览没有壳命令，热更只能在安装版里用；在此页检查会提示需要壳环境。</span>
      </div>
    </div>
  );
}
