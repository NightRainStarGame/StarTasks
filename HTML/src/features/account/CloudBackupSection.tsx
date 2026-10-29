/**
 * 云备份空间卡 —— 替换旧的 WebDAV 云同步区块。
 *
 * 每个网站账号 30MB 云备份空间（权益 API 下发，商店可扩容）。
 * 数据存 nrsc.games 权益中心（user_backups），按账号隔离。
 * 未登录 → 提示去「账户」登录；已登录 → 空间用量条 + 上传/恢复/删除。
 */
import { useEffect, useState } from 'react';
import { Cloud, Upload, Download, Trash2, RefreshCw, HardDrive } from 'lucide-react';
import { toast } from '@/utils/toast';

interface EntState {
  quotaMb: number;
  usedBytes: number;
  hasBackup: boolean;
}

export default function CloudBackupSection() {
  const [ent, setEnt] = useState<EntState | null>(null);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 6000);
  };

  const load = async () => {
    const site = (window.taskAPI as any).site;
    const t = await site?.hasToken?.();
    if (!t?.hasToken) { setLoggedIn(false); return; }
    setLoggedIn(true);
    const r = await site.entitlements();
    if (r.ok && r.backup) {
      setEnt({ quotaMb: r.backup.quotaMb, usedBytes: r.backup.usedBytes, hasBackup: r.backup.hasBackup });
    } else if (r.ok) {
      setEnt({ quotaMb: r.entitlements?.backup_mb ?? 30, usedBytes: 0, hasBackup: false });
    } else {
      flash(false, r.error || '权益查询失败');
    }
  };
  useEffect(() => { load(); }, []);

  const upload = async () => {
    setBusy('upload');
    try {
      const s = await window.taskAPI.backup.serialize();
      if (!s.ok || !s.json) { flash(false, '本地备份序列化失败'); return; }
      const r = await (window.taskAPI as any).site.backupPut(s.json, '');
      if (r.ok) {
        flash(true, `已上传 ${(r.sizeBytes! / 1024).toFixed(1)} KB（配额 ${r.quotaMb}MB）`);
        load();
      } else flash(false, r.error || '上传失败');
    } finally { setBusy(''); }
  };

  const restore = async () => {
    if (!window.confirm('从云端恢复将【覆盖】当前所有数据，确定？')) return;
    setBusy('restore');
    try {
      const r = await (window.taskAPI as any).site.backupGet();
      if (!r.ok || !r.payload) { flash(false, r.error || '没有云端备份'); return; }
      const applied = await window.taskAPI.backup.applyJson(r.payload);
      if (applied.ok) {
        const n = Object.values(applied.restored || {}).reduce((a: number, b: any) => a + b, 0);
        flash(true, `已从云端恢复 ${n} 条记录，建议刷新页面`);
      } else flash(false, applied.error || '恢复失败');
    } finally { setBusy(''); }
  };

  const remove = async () => {
    if (!window.confirm('删除云端备份？')) return;
    setBusy('del');
    try {
      await (window.taskAPI as any).site.backupDelete();
      flash(true, '云端备份已删除');
      load();
    } finally { setBusy(''); }
  };

  if (loggedIn === false) {
    return (
      <div className="p-3 rounded-md bg-ink-base/40 border border-neon-green/10 text-xs text-text-secondary">
        · 登录<strong className="text-neon-green">星芒网站账号</strong>（上方「账户」区块）即可获得 <strong className="text-neon-yellow">30MB 云备份空间</strong>
        <br />· 换机 / 重装后登录同一账号，一键恢复全部数据
      </div>
    );
  }

  const quotaBytes = (ent?.quotaMb ?? 30) * 1024 * 1024;
  const used = ent?.usedBytes ?? 0;
  const pct = quotaBytes > 0 ? Math.min(100, used / quotaBytes * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="p-3 rounded-md bg-ink-base/40 border border-neon-green/10 text-xs text-text-secondary space-y-1">
        <div>· 每个账号 <strong className="text-neon-yellow">{ent?.quotaMb ?? 30}MB</strong> 云备份空间，备份存网站账号下，换机一键恢复</div>
        <div>· 需要更大空间可在<strong className="text-neon-green">网站商店</strong>购买扩容（自动授权到当前账号）</div>
      </div>

      {/* 用量条 */}
      <div className="p-3 rounded-md border border-neon-green/15 bg-ink-900/40">
        <div className="flex items-center justify-between mb-2">
          <span className="flex items-center gap-1.5 text-xs text-text-secondary"><HardDrive size={13} /> 空间用量</span>
          <span className="font-mono text-[11px] text-text-dim">
            {(used / 1024).toFixed(1)} KB / {ent?.quotaMb ?? 30}MB
          </span>
        </div>
        <div className="h-2 bg-ink-900/70 rounded-full overflow-hidden border border-neon-green/10">
          <div className="h-full bg-neon-green rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 font-mono text-[10px] text-text-dim">
          {ent?.hasBackup ? '✓ 云端已有备份' : '云端还没有备份'}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={upload} disabled={!!busy} className="btn-neon">
          <Upload size={14} /> {busy === 'upload' ? '上传中…' : '上传备份'}
        </button>
        <button onClick={restore} disabled={!!busy || !ent?.hasBackup} className="btn-neon btn-neon-yellow">
          <Download size={14} /> {busy === 'restore' ? '恢复中…' : '从云端恢复'}
        </button>
        <button onClick={remove} disabled={!!busy || !ent?.hasBackup} className="btn-ghost text-neon-danger">
          <Trash2 size={14} /> 删除云端备份
        </button>
        <button onClick={load} disabled={!!busy} className="btn-ghost">
          <RefreshCw size={14} /> 刷新
        </button>
      </div>

      {msg && (
        <div className={`p-3 rounded-md border font-mono text-xs break-all ${msg.ok ? 'border-neon-green/40 text-neon-green bg-neon-green/5' : 'border-neon-danger/50 text-neon-danger bg-neon-danger/5'}`}>
          {msg.ok ? '✓ ' : '✗ '}{msg.text}
        </div>
      )}
    </div>
  );
}
