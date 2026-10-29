import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useStore } from '@/store';
import { Save, Download, Upload, Database, Palette, Info, Cpu, User, CheckCircle2, GraduationCap, Tags, Plus, Trash2, Pencil, Lock, Users, Shield, RefreshCw, ExternalLink, AlertCircle, Sparkles, FileSpreadsheet, Calendar, CloudUpload, Bug, Package, Bell, BellRing, Timer, Cloud, KeyRound, MessageCircle, Copy } from 'lucide-react';
import Modal from '@/components/Modal';
import clsx from '../utils/clsx';
import SiteAccountSection from '@/features/account/SiteAccountSection';
import CloudBackupSection from '@/features/account/CloudBackupSection';

import AboutPanel from '@/components/AboutPanel';
import { PatchUpdateButton, PatchCacheCard, PatchStateCard } from '@/components/PatchPanel';
import MobileUpdatePanel from '@/components/MobileUpdatePanel';
import HotUpdatePanel from '@/components/HotUpdatePanel';
import XlsImportWizard from '@/components/XlsImportWizard';
import dayjs from 'dayjs';
import type { UserProfile } from '@/types';

/** 移动端（Android 壳）：更新走 APK 自更新链路（见 MobileUpdatePanel），
 *  桌面那套 child_process / 补丁只为安装包设计，在 APK 里不可用 → 一律隐藏。
 *  ⚠️ 桌面专属的 Patch* 卡片在移动端也应隐藏，否则会渲染出永远空白的区块。 */
const IS_MOBILE = !!(window as any).__MOBILE__;

interface UpdateSource {
  name: string;
  url: string;
  enabled: boolean;
  primary: boolean;
  /** v1.2.15：只剩 'ssio'（自托管发行服务）与 'http'（自定义直链镜像）两种源 */
  type?: 'ssio' | 'http';
  /** SSIO 源的 APIKey（只需要 release:read 权限） */
  password?: string;
}

interface PerSourceResult {
  source: UpdateSource;
  result: {
    ok: boolean;
    latestVersion: string | null;
    hasUpdate: boolean;
    reason?: string;
    message?: string;
    downloadUrl?: string | null;
    pageUrl?: string | null;
    sha256?: string | null;
    notes?: string | null;
    forced?: boolean;
    /** 拉清单耗时（毫秒） */
    latencyMs?: number;
    sourceIndex?: number;
    sourceName?: string;
  };
}

/** 延迟格式化：<1s 显示 ms，≥1s 显示 x.xs */
function fmtLatency(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** 延迟分级配色：绿 <800ms / 黄 <3s / 红 ≥3s */
function latencyClass(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return 'text-text-dim';
  if (ms < 800) return 'text-neon-green';
  if (ms < 3000) return 'text-neon-yellow';
  return 'text-neon-danger';
}

export default function SettingsPage() {
  const settings = useStore(s => s.settings);
  const setSettings = useStore(s => s.setSettings);
  const stats = useStore(s => s.stats);
  const categories = useStore(s => s.categories);
  const userProfile = useStore(s => s.userProfile);
  const refreshAll = useStore(s => s.refreshAll);
  const location = useLocation() as { state?: { scrollTo?: string } };
  const [theme, setTheme] = useState('aurora');
  const [semester, setSemester] = useState('2026-Fall');
  const [semesterStart, setSemesterStart] = useState('');
  // v1.2.9 R7：跳转定位高亮（购买月卡 → /settings + state.scrollTo='monthly'）
  const [highlightId, setHighlightId] = useState<string | null>(null);

  useEffect(() => {
    const target = location.state?.scrollTo;
    if (!target) return;
    // 等 DOM 渲染完再滚
    const t = setTimeout(() => {
      const el = document.getElementById(`section-${target}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setHighlightId(target);
        // 高亮 2s 后淡出
        setTimeout(() => setHighlightId(null), 2000);
      }
    }, 120);
    return () => clearTimeout(t);
  }, [location.state?.scrollTo]);

  // （v2：本地账号/学籍信息/多账户已删除，账户区块改为网站账号认证 SiteAccountSection）

  // ===== 软件更新 =====
  const appInfo = useStore(s => s.appInfo);
  const setUpdateInfo = useStore(s => s.setUpdateInfo);
  // （v2：更新源 UI 已删，SSIO 源内置）
  const [updateChecking, setUpdateChecking] = useState(false);
  const [aggregate, setAggregate] = useState<{
    winner: {
      currentVersion: string;
      latestVersion: string | null;
      hasUpdate: boolean;
      downloadUrl?: string | null;
      pageUrl?: string | null;
      sha256?: string | null;
      notes?: string | null;
      forced?: boolean;
      sourceName?: string;
      source?: string;
      sourceIndex?: number;
    } | null;
    perSource: Array<{ source: UpdateSource; result: any }>;
    checkedAt: number;
  } | null>(null);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [dl, setDl] = useState<{ running: boolean; percent: number; received: number; total: number } | null>(null);
  const [dlPath, setDlPath] = useState<string | null>(null);
  const [updateAuto, setUpdateAuto] = useState(true);
  // v1.2.15：关闭按钮行为（主进程拦截 close 弹三选框；这里改的是「不再询问」的默认值）
  const [closeBehavior, setCloseBehaviorState] = useState<'ask' | 'minimize' | 'quit'>('ask');

  // ===== 作业同步（v1.2.15：只剩 SSIO 一个后端，要配的只有发布人昵称） =====
  const [hwPublisher, setHwPublisher] = useState('');
  const [hwAuthSaved, setHwAuthSaved] = useState(false);

  // ===== 自动清理 & 回收站（v1.1.9） =====
  const [cleanRules, setCleanRules] = useState<{
    enabled: boolean; reqDays: number; taskDays: number; eventDays: number;
    projectDays: number; homeworkDays: number; binDays: number;
  } | null>(null);
  const [binItems, setBinItems] = useState<Array<{
    id: number; kind: string; title: string; reason: string | null;
    deleted_at: number; purge_at: number;
  }>>([]);
  const [cleanBusy, setCleanBusy] = useState(false);
  const [cleanMsg, setCleanMsg] = useState<string | null>(null);
  const [showBin, setShowBin] = useState(false);

  const refreshBin = async () => {
    try { setBinItems(await window.taskAPI.cleanup.bin({ limit: 50 })); } catch { /* ignore */ }
  };

  const patchCleanRule = async (patch: Partial<{ enabled: boolean; reqDays: number; taskDays: number; eventDays: number; projectDays: number; homeworkDays: number; binDays: number }>) => {
    try { setCleanRules(await window.taskAPI.cleanup.setRules(patch)); } catch { /* ignore */ }
  };

  const runCleanup = async () => {
    setCleanBusy(true); setCleanMsg(null);
    try {
      const r = await window.taskAPI.cleanup.run();
      const b = r.local.binned;
      const lines = [`本地：作业 ${b.requirements} · 任务 ${b.tasks} · 日程 ${b.events} · 项目 ${b.projects} 项移入回收站；回收站过期清除 ${r.local.purgedBin} 项`];
      if (r.cloud.codes.length) {
        const s = r.cloud.ssio;
        lines.push(`云端（${r.cloud.codes.join('、')}）：SSIO 重写 ${s.rewritten} 个包 / 清理 ${s.removedEntries} 条${s.deleted ? ` / 删空 ${s.deleted} 个` : ''}`);
        const errs = s.errors || [];
        if (errs.length) lines.push('部分错误：' + errs.slice(0, 3).join('；'));
      } else {
        lines.push('云端：本轮未执行（每天最多一次，或未配置发布码）');
      }
      setCleanMsg(lines.join('\n'));
      await refreshBin();
    } catch (e: any) {
      setCleanMsg('清理失败：' + (e?.message || e));
    } finally { setCleanBusy(false); }
  };

  const restoreBinItem = async (id: number) => {
    const r = await window.taskAPI.cleanup.restore(id);
    if (!r.ok) { alert('恢复失败：' + (r.error || '未知错误')); return; }
    await refreshBin();
  };

  const purgeBinItem = async (id: number) => {
    if (!confirm('彻底删除后无法恢复，确定？')) return;
    await window.taskAPI.cleanup.purge(id);
    await refreshBin();
  };

  // v1.2.17：向导本体搬到 components/XlsImportWizard，这里只留开关与上次导入信息。
  const [xlsOpen, setXlsOpen] = useState(false);
  const [xlsLastSync, setXlsLastSync] = useState<{ lastSync: number; courseCount: number } | null>(null);

  useEffect(() => {
    if (!xlsOpen) return;
    window.taskAPI.xls.lastImport().then(setXlsLastSync).catch(() => { /* ignore */ });
  }, [xlsOpen]);


  useEffect(() => {
    (async () => {
      try {
        const cfg = await window.taskAPI.updater.config();
        void cfg;
        setUpdateAuto(cfg.autoCheck);
      } catch { /* 忽略 */ }
      try {
        const cb = await window.taskAPI.app.getCloseBehavior();
        if (cb) setCloseBehaviorState(cb);
      } catch { /* 移动端无此 IPC */ }
      try {
        const hw = await window.taskAPI.homework.config();
        setHwPublisher(hw.publisher || '');
      } catch { /* 忽略 */ }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try { setCleanRules(await window.taskAPI.cleanup.rules()); } catch { /* ignore */ }
      void refreshBin();
    })();
  }, []);

  /** 保存发布人昵称（v1.2.15：GitHub 令牌已随通道下线，SSIO 不需要凭据） */
  const saveHwAuth = async () => {
    const r = await window.taskAPI.homework.saveAuth('', hwPublisher.trim());
    if (!r.ok) { alert('保存失败'); return; }
    setHwAuthSaved(true);
    setTimeout(() => setHwAuthSaved(false), 1800);
  };

  // 下载进度订阅
  useEffect(() => {
    const off = window.taskAPI.updater.onProgress((p) => {
      if (p.phase === 'start') setDl({ running: true, percent: 0, received: 0, total: p.total || 0 });
      else if (p.phase === 'progress') setDl({ running: true, percent: p.percent || 0, received: p.received || 0, total: p.total || 0 });
      else if (p.phase === 'done') {
        setDl({ running: false, percent: 100, received: p.received || 0, total: p.total || 0 });
        setDlPath(p.path || null);
      }
    });
    return () => { off?.(); };
  }, []);

  const toggleAutoCheck = async (v: boolean) => {
    setUpdateAuto(v);
    try { await window.taskAPI.updater.setAutoCheck(v); } catch { /* 忽略 */ }
  };

  const checkUpdate = async () => {
    setUpdateChecking(true);
    setUpdateMsg(null);
    setDl(null);
    setDlPath(null);
    try {
      const r = await window.taskAPI.updater.checkAll();
      setAggregate(r);
      // 把 winner 推给全局 UpdateNotification
      if (r.winner) {
        const perSource = r.perSource.map(({ source, result }) => ({
          name: source.name,
          url: source.url,
          type: source.type,
          password: source.password,
          sourceIndex: result.sourceIndex,
          ok: result.ok,
          latestVersion: result.latestVersion,
          reason: result.reason,
          message: result.message,
          latencyMs: result.latencyMs,
          downloadUrl: result.downloadUrl,
          sha256: result.sha256,
          pageUrl: result.pageUrl,
        }));
        setUpdateInfo({ ...r.winner, perSource } as any);
      } else {
        setUpdateInfo(null);
      }
      const failed = r.perSource.filter((p) => !p.result.ok && p.result.message).map((p) => `${p.source.name}: ${p.result.message}`);
      if (!r.winner && failed.length) setUpdateMsg(failed.join('\n'));
    } catch (e: any) {
      setUpdateMsg(e?.message || '检查更新失败');
    } finally {
      setUpdateChecking(false);
    }
  };

  /** 同版本多源可用时，手动选择从哪个源下载更新 */
  const pickSource = (i: number) => {
    setAggregate((a) => {
      if (!a) return a;
      const entry = a.perSource[i];
      if (!entry?.result?.ok || !entry.result.downloadUrl) return a;
      return { ...a, winner: entry.result };
    });
  };

  const startDownload = async () => {
    const w = aggregate?.winner;
    if (!w?.downloadUrl) return;
    setUpdateMsg(null);
    setDl({ running: true, percent: 0, received: 0, total: 0 });
    try {
      // 北科云盘源的 downloadUrl 是云盘里的文件名，后端要靠 source（提取码）换签名直链
      const src = w.sourceIndex != null ? aggregate?.perSource?.[w.sourceIndex]?.source : null;
      const r = await window.taskAPI.updater.download({
        url: w.downloadUrl,
        version: w.latestVersion || 'latest',
        sha256: w.sha256 || null,
        source: src || null,
      });
      if (!r.ok) {
        setDl(null);
        setUpdateMsg(r.error || '下载失败');
      } else {
        setDlPath(r.path || null);
      }
    } catch (e: any) {
      setDl(null);
      setUpdateMsg(e?.message || '下载失败');
    }
  };

  const runInstaller = async () => {
    if (!dlPath) return;
    const r = await window.taskAPI.updater.install(dlPath);
    if (!r.ok) setUpdateMsg(r.error || '启动安装包失败');
  };

  const openReleasePage = async (url?: string | null) => {
    const u = url || aggregate?.winner?.pageUrl || '';
    if (!u) return;
    const r = await window.taskAPI.updater.openExternal(u);
    if (!r.ok) setUpdateMsg(r.error || '打开链接失败');
  };

  const ignoreVersion = async () => {
    const w = aggregate?.winner;
    if (!w?.latestVersion) return;
    await window.taskAPI.updater.skipVersion(w.latestVersion);
    setAggregate((a) => (a && a.winner ? { ...a, winner: { ...a.winner } as any } : a));
  };

  // 只在挂载时从 store 拉一次用户资料到本地编辑态；之后由用户编辑 + 保存驱动，
  // 避免 settings / userProfile 任意更新（updater 推送、refreshAll 等）反向覆盖正在编辑的内容。
  useEffect(() => {
    if (settings.theme) setTheme(settings.theme);
    if (settings.semester) setSemester(settings.semester);
    if (settings.semester_start) {
      const d = new Date(Number(settings.semester_start));
      setSemesterStart(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    const updates: [string, string][] = [
      ['theme', theme],
      ['semester', semester],
      ['semester_start', semesterStart ? String(new Date(semesterStart).getTime()) : ''],
    ];
    await Promise.all(updates.map(([k, v]) => window.taskAPI.db.settings.set(k, v)));
    const semesterStartMs = semesterStart ? new Date(semesterStart).getTime() : 0;
    setSettings({ ...settings, theme, semester, semester_start: String(semesterStartMs) });
    await refreshAll();
    alert('设置已保存');
  };



  // （v2：WebDAV 云同步已删除，替换为云备份空间 CloudBackupSection）
  /** 单键设置立即写库 + 同步 store */
  const persistSetting = async (key: string, value: string) => {
    await window.taskAPI.db.settings.set(key, value);
    setSettings({ ...settings, [key]: value });
  };

  const testNotification = () => {
    try {
      new Notification('[StarTasks] 测试通知', { body: '通知通道正常 ✓ 上课/作业/考试提醒将按时到达' });
    } catch {
      alert('当前环境不支持系统通知');
    }
  };

  // ===== 数据管理：全量备份 / 恢复 / 完整性检查 =====
  const [backupStatus, setBackupStatus] = useState<{
    integrity: string; foreignKeyViolations: number; journalMode: string;
    tables: Record<string, number>; dbSizeBytes: number; lastAutoBackup: string | null;
  } | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const exportBackup = async () => {
    setBackupBusy(true); setBackupMsg(null);
    try {
      const r = await window.taskAPI.backup.export();
      if (r.ok) {
        const total = Object.values(r.counts || {}).reduce((a, b) => a + Number(b), 0);
        setBackupMsg({ ok: true, text: `备份已导出：${r.path}（共 ${total} 条记录）` });
      } else if (!r.canceled) {
        setBackupMsg({ ok: false, text: '导出失败' });
      }
    } catch (e: any) {
      setBackupMsg({ ok: false, text: `导出失败：${e?.message || e}` });
    } finally { setBackupBusy(false); }
  };

  const importBackup = async () => {
    if (!confirm(
      '从备份导入将【覆盖】当前所有数据（课程、日历、项目、账户、设置）。\n\n' +
      '· 导入前会自动创建安全备份（pre-import-*.db），失败可手动恢复\n' +
      '· 导入在事务内执行，任何异常都会整体回滚\n\n确定继续？'
    )) return;
    setBackupBusy(true); setBackupMsg(null);
    try {
      const r = await window.taskAPI.backup.import();
      if (r.ok) {
        const total = Object.values(r.restored || {}).reduce((a, b) => a + Number(b), 0);
        setBackupMsg({ ok: true, text: `已恢复 ${total} 条记录（安全备份：${r.safetyBackupPath || '已跳过'}）` });
        await refreshAll();
      } else if (!r.canceled) {
        setBackupMsg({ ok: false, text: `导入失败：${r.error}` });
      }
    } catch (e: any) {
      setBackupMsg({ ok: false, text: `导入失败：${e?.message || e}` });
    } finally { setBackupBusy(false); }
  };

  const checkIntegrity = async () => {
    setBackupBusy(true); setBackupMsg(null);
    try {
      const s = await window.taskAPI.backup.status();
      setBackupStatus(s);
      const ok = s.integrity === 'ok' && s.foreignKeyViolations === 0;
      setBackupMsg({
        ok,
        text: ok
          ? `数据库完整性正常（${s.journalMode.toUpperCase()} 模式，外键零违规）`
          : `发现问题：完整性=${s.integrity}，外键违规=${s.foreignKeyViolations}，请立即导出备份并联系开发者`,
      });
    } catch (e: any) {
      setBackupMsg({ ok: false, text: `检查失败：${e?.message || e}` });
    } finally { setBackupBusy(false); }
  };

  /** 旧版（Electron）数据库一次性导入 —— billing 表随月卡功能删除会被跳过 */
  const importLegacy = async () => {
    if (!window.confirm('从旧版 TaskManager 数据库导入？\n\n· 会覆盖当前库的同类数据\n· 月卡/付费记录不再迁移（功能已下线）\n· 建议先「导出全量备份」')) return;
    setBackupBusy(true); setBackupMsg(null);
    try {
      const r = await (await import('@/api/legacyImport')).legacyImport();
      if (r.canceled) { setBackupMsg(null); return; }
      if (!r.ok) { setBackupMsg({ ok: false, text: `导入失败：${r.error}` }); return; }
      const skippedNote = Object.entries(r.skipped || {}).map(([t, why]) => `${t}（${why}）`).join('、');
      setBackupMsg({
        ok: true,
        text: `已导入 ${r.totalRows} 条记录\n` +
          Object.entries(r.imported || {}).filter(([, n]) => Number(n) > 0).map(([t, n]) => `${t}: ${n}`).join('、') +
          (skippedNote ? `\n跳过：${skippedNote}` : ''),
      });
    } catch (e: any) {
      setBackupMsg({ ok: false, text: `导入失败：${e?.message || e}` });
    } finally { setBackupBusy(false); }
  };



  // 分类编辑
  const [catModal, setCatModal] = useState<{ open: boolean; id: number | null; name: string; color: string; emoji: string }>({ open: false, id: null, name: '', color: '#00FF88', emoji: '' });
  const editCategory = (c: any) => {
    setCatModal(c ? { open: true, id: c.id, name: c.name, color: c.color, emoji: c.emoji || '' } : { open: true, id: null, name: '', color: '#00FF88', emoji: '' });
  };
  const saveCategory = async () => {
    if (!catModal.name.trim()) { alert('请输入分类名'); return; }
    if (catModal.id) {
      await window.taskAPI.db.categories.update(catModal.id, { name: catModal.name, color: catModal.color, emoji: catModal.emoji || null });
    } else {
      await window.taskAPI.db.categories.create({ name: catModal.name, color: catModal.color, emoji: catModal.emoji || null });
    }
    await refreshAll();
    setCatModal({ open: false, id: null, name: '', color: '#00FF88', emoji: '' });
  };
  const deleteCategory = async (id: number) => {
    if (!confirm('删除该分类？关联事件会保留但失去分类。')) return;
    await window.taskAPI.db.categories.delete(id);
    await refreshAll();
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6 pb-0">
      <div>
        <p className="label-tag">SETTINGS·系统配置</p>
        <h2 className="text-2xl font-bold mt-1">设置</h2>
      </div>

      {/* 账户（v2：星芒网站账号认证，替换旧的本地账号/学籍信息/多账户） */}
      <Section icon={<User size={14} />} title="账户">
        <SiteAccountSection />
      </Section>

      {/* 主题 */}
      <Section icon={<Palette size={14} />} title="外观">
        <Row label="主题预设">
          <div className="space-y-3 w-full">
            <select value={theme} onChange={(e) => setTheme(e.target.value)} className="input-neon w-48">
              <option value="aurora">🌌 极光（默认 · 新）</option>
              <option value="starry">✦ 星辉（青蓝荧光）</option>
              <option value="ink-green">🌿 墨绿（低饱和护眼 · 新）</option>
              <option value="sakura">🌸 樱花粉（萌系）</option>
              <option value="glass-dark">🪟 玻璃 · 深色（Win11 液态玻璃）</option>
            </select>
            {/* v1.2.1 主题预览卡片：实时反映当前主题的渐变 / 玻璃 / 对比 */}
            <div className="mt-1 p-3 rounded-lg border border-neon-green/15 bg-ink-base/40 max-w-lg">
              <div className="flex items-center gap-2 mb-2">
                <span className="label-tag">PREVIEW · {theme}</span>
                <div className="flex-1 h-px bg-gradient-to-r from-neon-green/30 to-transparent" />
              </div>
              <div className="glass-panel p-3">
                <div className="text-grad-sakura font-mono text-base font-bold mb-2">
                  {theme === 'aurora' ? '🌌 极光主题' : theme === 'sakura' ? '🌸 樱花粉主题' : theme === 'starry' ? '✦ 星辉主题' : theme === 'glass-dark' ? '🪟 玻璃 · 深色主题' : '🌿 墨绿主题'}
                </div>
                <div className="text-xs text-text-secondary mb-2">
                  渐变标题 + 玻璃面板 + <span className="data-pill">数据胶囊</span>
                </div>
                <div className="flex gap-2 mb-2">
                  <button type="button" className="btn-neon text-xs">主要按钮</button>
                  <button type="button" className="btn-ghost text-xs">次要</button>
                </div>
                <div className="status-bar-sakura text-xs text-text-primary">
                  📌 状态条：左侧高光锚点
                </div>
              </div>
              <hr className="divider-grad-sakura" />
              <div className="text-[10px] text-text-dim font-mono">
                预览随主题切换实时刷新 · 樱花粉下透明度 / 高光 / 对比最强
              </div>
            </div>
          </div>
        </Row>
        <Row label="当前学期">
          <input value={semester} onChange={(e) => setSemester(e.target.value)} className="input-neon w-48" />
        </Row>
        <Row label="开学日（用于周次计算）">
          <input type="date" value={semesterStart} onChange={(e) => setSemesterStart(e.target.value)} className="input-neon w-48" />
          <span className="text-[10px] text-text-dim font-mono ml-2">月视图头部显示「第 X 周」</span>
        </Row>
      </Section>

      {/* 日程分类 */}
      <Section icon={<Tags size={14} />} title="日程分类">
        <div className="space-y-1.5">
          {categories.length === 0 && <div className="text-text-dim font-mono text-xs py-4 text-center">暂无分类，点击下方添加</div>}
          {categories.map((c) => (
            <div key={c.id} className="flex items-center gap-3 p-2.5 rounded-md bg-ink-base/40 border border-neon-green/15 hover:border-neon-green/40 transition-colors">
              <div className="w-4 h-4 rounded shrink-0" style={{ background: c.color, boxShadow: `0 0 6px ${c.color}` }} />
              <div className="flex-1 min-w-0">
                <div className="font-mono text-sm text-text-primary">{c.emoji && <span className="mr-1">{c.emoji}</span>}{c.name}</div>
                <div className="font-mono text-[10px] text-text-dim">{c.color}</div>
              </div>
              <button onClick={() => editCategory(c)} className="btn-ghost text-xs" title="编辑"><Pencil size={12} /></button>
              <button onClick={() => deleteCategory(c.id)} className="btn-ghost text-xs text-neon-danger" title="删除"><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
        <div className="pt-3 border-t border-neon-green/10">
          <button onClick={() => editCategory(null)} className="btn-neon btn-neon-yellow"><Plus size={14} /> 新建分类</button>
        </div>
      </Section>

      {/* v1.2.10：微信小程序嵌套 Section 随小程序模块一并移除 */}
      {/* v2：「数据管理」区块按用户要求移除（导出/导入/完整性检查/导入旧版的处理器仍保留在 taskAPI.backup.*） */}

      {/* v1.2.3：提醒通知 */}
      <Section icon={<Bell size={14} />} title="提醒通知（v1.2.3 新增）">
        <div className="p-3 rounded-md bg-ink-base/40 border border-neon-green/10 text-xs text-text-secondary space-y-1 mb-3">
          <div>· 应用常驻托盘后台检查（每分钟），上课前、作业截止前、考试前<strong className="text-neon-green">系统弹窗提醒</strong></div>
          <div>· 关闭主窗口不影响提醒（托盘常驻，右键托盘可退出）</div>
        </div>
        <Row label="系统提醒">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={(settings.notify_enabled ?? '1') !== '0'}
              onChange={(e) => persistSetting('notify_enabled', e.target.checked ? '1' : '0')}
              className="accent-[#00FF88]"
            />
            <span className="font-mono text-[10px] text-text-dim">{(settings.notify_enabled ?? '1') !== '0' ? '已开启（总开关）' : '全部提醒已静默'}</span>
          </div>
        </Row>
        <Row label="上课前提醒">
          <div className="flex items-center gap-1">
            <input type="number" min={0} max={120} value={Number(settings.notify_class_minutes ?? 15)}
              onChange={(e) => persistSetting('notify_class_minutes', String(Math.max(0, Math.min(120, Number(e.target.value) || 0))))}
              className="input-neon w-16 py-0.5 px-2 text-xs text-right" />
            <span className="text-xs text-text-dim">分钟前（0=关闭）</span>
          </div>
        </Row>
        <Row label="作业提前24h">
          <input type="checkbox" checked={(settings.notify_due_24h ?? '1') !== '0'}
            onChange={(e) => persistSetting('notify_due_24h', e.target.checked ? '1' : '0')} className="accent-[#00FF88]" />
        </Row>
        <Row label="作业提前1h">
          <input type="checkbox" checked={(settings.notify_due_1h ?? '1') !== '0'}
            onChange={(e) => persistSetting('notify_due_1h', e.target.checked ? '1' : '0')} className="accent-[#00FF88]" />
        </Row>
        <Row label="考试前1天">
          <input type="checkbox" checked={(settings.notify_exam_1d ?? '1') !== '0'}
            onChange={(e) => persistSetting('notify_exam_1d', e.target.checked ? '1' : '0')} className="accent-[#00FF88]" />
        </Row>
        <div className="flex flex-wrap gap-2 mt-3">
          <button onClick={testNotification} className="btn-ghost"><BellRing size={14} /> 发送测试通知</button>
        </div>
      </Section>

      {/* v1.2.3：番茄钟 */}
      <Section icon={<Timer size={14} />} title="番茄钟（v1.2.3 新增）">
        <div className="p-3 rounded-md bg-ink-base/40 border border-neon-green/10 text-xs text-text-secondary space-y-1 mb-3">
          <div>· 右下角悬浮番茄钟（所有页面可用），专注结束自动记录并统计到<strong className="text-neon-green">「统计」页</strong></div>
        </div>
        <Row label="专注时长">
          <div className="flex items-center gap-1">
            <input type="number" min={5} max={120} value={Number(settings.pomodoro_work ?? 25)}
              onChange={(e) => persistSetting('pomodoro_work', String(Math.max(5, Math.min(120, Number(e.target.value) || 25))))}
              className="input-neon w-16 py-0.5 px-2 text-xs text-right" />
            <span className="text-xs text-text-dim">分钟</span>
          </div>
        </Row>
        <Row label="休息时长">
          <div className="flex items-center gap-1">
            <input type="number" min={1} max={60} value={Number(settings.pomodoro_break ?? 5)}
              onChange={(e) => persistSetting('pomodoro_break', String(Math.max(1, Math.min(60, Number(e.target.value) || 5))))}
              className="input-neon w-16 py-0.5 px-2 text-xs text-right" />
            <span className="text-xs text-text-dim">分钟</span>
          </div>
        </Row>
      </Section>

      {/* v2：云备份空间（替换 WebDAV；每个账号 30MB，网站商店可扩容） */}
      <Section icon={<Cloud size={14} />} title="云备份空间">
        <CloudBackupSection />
      </Section>

      {/* 自动清理 & 回收站（v1.1.9） */}
      <Section icon={<Trash2 size={14} />} title="自动清理 & 回收站">
        <div className="p-3 rounded-md bg-ink-base/40 border border-neon-green/10 text-xs text-text-secondary space-y-1 mb-3">
          <div>· 完成的作业/任务、过期日程、完结项目到期后自动移入<strong className="text-neon-green">回收站</strong>，回收站到期后彻底删除</div>
          <div>· 上传到 SSIO 云的共享作业超过保留天数后自动云端清理（重写过期包 / 删空整包）</div>
          <div>· 手动删除的数据同样先进回收站，可随时恢复</div>
        </div>
        {cleanRules ? (
          <>
            <Row label="自动清理">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={cleanRules.enabled}
                  onChange={(e) => patchCleanRule({ enabled: e.target.checked })}
                  className="accent-[#00FF88]"
                />
                <span className="font-mono text-[10px] text-text-dim">{cleanRules.enabled ? '每小时后台检查' : '已关闭'}</span>
              </div>
            </Row>
            <Row label="完成的作业">
              <div className="flex items-center gap-1">
                <RuleDaysInput value={cleanRules.reqDays} min={0} max={365} onCommit={(v) => patchCleanRule({ reqDays: v })} />
                <span className="text-xs text-text-dim">天后移入回收站</span>
              </div>
            </Row>
            <Row label="完成的任务">
              <div className="flex items-center gap-1">
                <RuleDaysInput value={cleanRules.taskDays} min={0} max={365} onCommit={(v) => patchCleanRule({ taskDays: v })} />
                <span className="text-xs text-text-dim">天后移入回收站</span>
              </div>
            </Row>
            <Row label="过期的日程">
              <div className="flex items-center gap-1">
                <RuleDaysInput value={cleanRules.eventDays} min={0} max={365} onCommit={(v) => patchCleanRule({ eventDays: v })} />
                <span className="text-xs text-text-dim">天后移入回收站</span>
              </div>
            </Row>
            <Row label="完结的项目">
              <div className="flex items-center gap-1">
                <RuleDaysInput value={cleanRules.projectDays} min={0} max={365} onCommit={(v) => patchCleanRule({ projectDays: v })} />
                <span className="text-xs text-text-dim">天后移入回收站</span>
              </div>
            </Row>
            <Row label="上传的作业（云端）">
              <div className="flex items-center gap-1">
                <RuleDaysInput value={cleanRules.homeworkDays} min={1} max={365} onCommit={(v) => patchCleanRule({ homeworkDays: v })} />
                <span className="text-xs text-text-dim">天后云端清理</span>
              </div>
            </Row>
            <Row label="回收站保留">
              <div className="flex items-center gap-1">
                <RuleDaysInput value={cleanRules.binDays} min={1} max={365} onCommit={(v) => patchCleanRule({ binDays: v })} />
                <span className="text-xs text-text-dim">天后彻底删除</span>
              </div>
            </Row>
          </>
        ) : (
          <div className="font-mono text-[10px] text-text-dim">规则加载中…</div>
        )}
        <div className="flex flex-wrap gap-2 mt-3">
          <button onClick={runCleanup} disabled={cleanBusy} className="btn-neon">
            {cleanBusy ? '清理中…' : '立即清理'}
          </button>
          <button onClick={() => { setShowBin((v) => !v); void refreshBin(); }} className="btn-ghost">
            回收站（{binItems.length}）
          </button>
        </div>
        {cleanMsg && (
          <div className="mt-3 p-3 rounded-md border border-neon-green/40 text-neon-green bg-neon-green/5 font-mono text-xs whitespace-pre-wrap">
            {cleanMsg}
          </div>
        )}
        {showBin && (
          <div className="mt-3 rounded-md border border-neon-green/15 bg-ink-base/40 p-2 space-y-1 max-h-64 overflow-y-auto">
            {binItems.length === 0 ? (
              <div className="font-mono text-[10px] text-text-dim p-1">回收站是空的</div>
            ) : binItems.map((it) => (
              <div key={it.id} className="flex items-center gap-2 font-mono text-[10px] p-1.5 rounded border border-neon-green/10 bg-ink-base/30">
                <span className="px-1.5 py-0.5 rounded text-[9px] border border-text-dim/30 text-text-dim shrink-0">
                  {{ requirement: '作业', task: '任务', event: '日程', project: '项目' }[it.kind] || it.kind}
                </span>
                <span className="text-text-secondary truncate flex-1" title={it.title}>{it.title}</span>
                <span className="text-text-dim shrink-0">{dayjs(it.deleted_at).format('MM-DD HH:mm')} 删</span>
                <span className="text-text-dim shrink-0">{dayjs(it.purge_at).format('MM-DD')} 清除</span>
                <button onClick={() => restoreBinItem(it.id)} className="px-1.5 py-0.5 rounded text-[9px] border border-neon-green/40 text-neon-green hover:bg-neon-green/10 shrink-0">恢复</button>
                <button onClick={() => purgeBinItem(it.id)} className="px-1.5 py-0.5 rounded text-[9px] border border-neon-danger/40 text-neon-danger hover:bg-neon-danger/10 shrink-0">彻底删</button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 课表 Excel 导入 */}
      <Section icon={<FileSpreadsheet size={14} />} title="课表导入 (Excel)">
        <div className="p-3 rounded-md bg-ink-base/40 border border-neon-green/10 text-xs text-text-secondary space-y-1 mb-3">
          <div>· 支持 <strong className="text-neon-green">.xlsx / .xls / .csv</strong>；每行一节课，含「课程名称/教师/周次/星期/节次/教室」列</div>
          <div>· 多数教务系统导出与「超级课程表」导出的 xlsx 都能直接识别列头；识别错的可在向导里手动指定</div>
          <div>· 导入会<strong className="text-neon-yellow">替换之前的课表导入</strong>（教务 / Excel）；手动添加的课程/作业不受影响</div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setXlsOpen(true)} className="btn-neon"><FileSpreadsheet size={14} /> 从 Excel 导入课表</button>
          {xlsLastSync && xlsLastSync.courseCount > 0 ? (
            <span className="font-mono text-[10px] text-text-dim">
              上次导入 {xlsLastSync.courseCount} 门课 · {xlsLastSync.lastSync ? dayjs(xlsLastSync.lastSync).format('YYYY-MM-DD HH:mm') : '—'}
            </span>
          ) : (
            <span className="font-mono text-[10px] text-text-dim">尚未导入</span>
          )}
        </div>
      </Section>

      {/* 软件更新 */}
      <Section icon={<RefreshCw size={14} />} title="软件更新">
        <Row label="当前版本">
          <div className="flex items-center gap-3 font-mono text-sm">
            <span className="text-neon-green">v{appInfo?.version || '—'}</span>
            {aggregate?.winner?.hasUpdate && (
              <span className="px-2 py-0.5 rounded text-[10px] bg-neon-yellow/15 text-neon-yellow border border-neon-yellow/40">
                新版本 v{aggregate.winner.latestVersion} 可用
              </span>
            )}
          </div>
        </Row>

        {/* v2：内容热更新（真正能触发的入口；旧的下载安装包流程对内容更新不适用） */}
        {!IS_MOBILE && (
          <Row label="内容更新">
            <HotUpdatePanel />
          </Row>
        )}

        {/* v2：更新源 UI 已删除 —— SSIO 官方源内置为固定配置（见 updaterHandlers / MOCK_DEFAULT_SOURCES） */}

        {!IS_MOBILE && (
        <Row label="关闭按钮行为">
          <div className="flex items-center gap-4">
            {([['ask', '每次询问'], ['minimize', '最小化到托盘'], ['quit', '完全退出']] as const).map(([v, label]) => (
              <label key={v} className="flex items-center gap-1.5 cursor-pointer select-none text-xs">
                <input
                  type="radio"
                  name="close-behavior"
                  checked={closeBehavior === v}
                  onChange={() => {
                    setCloseBehaviorState(v);
                    try { void window.taskAPI.app.setCloseBehavior(v); } catch { /* ignore */ }
                  }}
                  className="accent-[#00FF88]"
                />
                <span className={closeBehavior === v ? 'text-neon-green' : 'text-text-secondary'}>{label}</span>
              </label>
            ))}
          </div>
          <div className="font-mono text-[10px] text-text-dim mt-1">
            点窗口 ✕ 时按这里走；选「每次询问」会当场弹窗让你决定（可勾选记住选择）。
          </div>
        </Row>
        )}

        {!IS_MOBILE && (
        <Row label="启动时自动检查">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={updateAuto} onChange={(e) => toggleAutoCheck(e.target.checked)} className="accent-[#00FF88]" />
            <span className="text-xs text-text-secondary">
              开启后每次启动会<strong className="text-neon-yellow">检查所有启用的更新源</strong>，发现新版本会<strong className="text-neon-yellow">在右下角弹窗告知</strong>；左侧「设置」也会有 NEW 标记。
            </span>
          </label>
        </Row>
        )}

        {!IS_MOBILE ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <button onClick={checkUpdate} disabled={updateChecking} className="btn-neon">
            <RefreshCw size={14} className={updateChecking ? 'animate-spin' : ''} /> {updateChecking ? '检查中…' : '检查更新'}
          </button>
          <PatchUpdateButton aggregate={aggregate} appVersion={appInfo?.version || ''} onMessage={setUpdateMsg} onProgress={setDl} />
          {aggregate?.winner?.hasUpdate && aggregate.winner.downloadUrl && !dlPath && (
            <button onClick={startDownload} disabled={!!dl?.running} className="btn-neon btn-neon-yellow">
              <Download size={14} /> {dl?.running ? '下载中…' : `下载 v${aggregate.winner.latestVersion}`}
            </button>
          )}
          {aggregate?.winner && (aggregate.winner.pageUrl || aggregate.winner.source) && (
            <button onClick={() => openReleasePage(aggregate?.winner?.pageUrl)} className="btn-ghost">
              <ExternalLink size={14} /> 打开发布页
            </button>
          )}
          {!!dlPath && (
            <button onClick={runInstaller} className="btn-neon btn-neon-yellow">
              <Sparkles size={14} /> 立即安装并重启
            </button>
          )}
          {aggregate?.winner?.hasUpdate && (
            <button onClick={ignoreVersion} className="btn-ghost text-text-dim">忽略 v{aggregate.winner.latestVersion}</button>
          )}
        </div>
        ) : (
          // v1.2.11：移动端不再是「不支持更新」的空壳，走 APK 自更新链路
          // （检查 latest.json 的 android 字段 → 原生下载校验 → 拉起系统安装器）
          <MobileUpdatePanel />
        )}

        {/* v1.3.0：已下载的增量补丁（zip + manifest 缓存，随时应用）
            v1.2.11：APK 里没有补丁目录概念，这两块会渲染成永远空白的占位 */}
        {!IS_MOBILE && (
          <>
            <PatchCacheCard appVersion={appInfo?.version || ''} onMessage={setUpdateMsg} />
            {/* v1.2.7：上次补丁的结果（applied / pendingSidecar / failed） + 立即重试 */}
            <PatchStateCard onMessage={setUpdateMsg} />
          </>
        )}

        {/* 下载进度 */}
        {dl && (
          <div className="mt-1 space-y-1">
            <div className="progress-bar">
              <div style={{ width: `${dl.running || dl.percent < 100 ? dl.percent : 100}%`, background: '#FFD60A', boxShadow: '0 0 6px #FFD60A' }} />
            </div>
            <div className="flex justify-between font-mono text-[10px] text-text-dim">
              <span>{dl.running ? '下载中' : '下载完成'}</span>
              <span>
                {dl.percent}%{dl.total ? ` · ${(dl.received / 1048576).toFixed(1)} / ${(dl.total / 1048576).toFixed(1)} MB` : dl.received ? ` · ${(dl.received / 1048576).toFixed(1)} MB` : ''}
              </span>
            </div>
          </div>
        )}

        {/* 多源结果汇总（含测速延迟 + 手动选源下载） */}
        {aggregate && aggregate.perSource.length > 0 && !updateMsg && (
          <div className="mt-1 p-3 rounded-md border border-neon-green/15 bg-ink-base/40 space-y-1">
            <div className="font-mono text-[10px] text-text-dim mb-1">
              {aggregate.checkedAt ? `检查时间：${dayjs(aggregate.checkedAt).format('YYYY-MM-DD HH:mm:ss')}` : '本次检查结果'}
              {' · '}
              {aggregate.perSource.filter((p) => p.result.ok).length}/{aggregate.perSource.length} 源连通
            </div>
            {aggregate.perSource.map(({ source, result }, i) => {
              const isWinner = aggregate.winner?.sourceIndex === result.sourceIndex && !!aggregate.winner;
              const canPick = result.ok && !!result.downloadUrl && result.hasUpdate &&
                result.latestVersion === aggregate.winner?.latestVersion;
              return (
                <div
                  key={i}
                  className={`flex items-center justify-between gap-2 font-mono text-[10px] rounded px-1.5 py-1 border ${
                    isWinner ? 'border-neon-green/40 bg-neon-green/5' : 'border-transparent'
                  }`}
                >
                  <span className="text-text-secondary truncate pr-1 flex items-center gap-1.5">
                    {source.name}{source.primary ? ' (主)' : ''}
                    {result.ok && result.latencyMs != null && (
                      <span className={`px-1 rounded bg-ink-base/60 border border-current/20 ${latencyClass(result.latencyMs)}`} title="拉取该源清单的耗时">
                        {fmtLatency(result.latencyMs)}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <span className={result.ok ? 'text-neon-green' : 'text-neon-danger'}>
                      {result.ok
                        ? `v${result.latestVersion}${result.hasUpdate ? ' · 有更新' : ' · 已是最新'}`
                        : (result.reason === 'network' ? '连不上' : (result.reason || '失败')) + (result.message ? ` · ${result.message}` : '')}
                    </span>
                    {canPick && !isWinner && (
                      <button
                        onClick={() => pickSource(i)}
                        className="px-1.5 py-0.5 rounded text-[9px] border border-neon-yellow/40 text-neon-yellow hover:bg-neon-yellow/10"
                        title="从该源下载更新（版本相同，速度可能不同）"
                      >
                        用此源下载
                      </button>
                    )}
                    {isWinner && result.hasUpdate && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-neon-green/10 border border-neon-green/40 text-neon-green">下载源</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* 错误 */}
        {updateMsg && (
          <div className="mt-1 p-3 rounded-md border border-neon-danger/50 text-neon-danger bg-neon-danger/5 font-mono text-xs whitespace-pre-wrap break-all">
            <div>✗ {updateMsg}</div>
          </div>
        )}

        {/* 已是最新 */}
        {aggregate && !aggregate.winner && !updateMsg && aggregate.perSource.some((p) => p.result.ok) && (
          <div className="mt-1 p-3 rounded-md border border-neon-green/40 bg-neon-green/5 font-mono text-xs text-neon-green flex items-center gap-2">
            <CheckCircle2 size={14} /> 已是最新版本（v{appInfo?.version || '—'}）
          </div>
        )}

        {dlPath && (
          <div className="mt-1 p-3 rounded-md border border-neon-green/40 bg-neon-green/5 font-mono text-[11px] text-neon-green break-all">
            ✓ 安装包已下载：{dlPath}
          </div>
        )}
      </Section>

      {/* 作业同步（v1.1.4） */}
      <Section icon={<CloudUpload size={14} />} title="作业同步">
        {/* v1.2.15：GitHub 令牌与北科云盘源的配置项已随通道下线 —— SSIO 内置凭据，开箱即用 */}
        <div className="bg-neon-green/10 border border-neon-green/30 rounded p-2 text-[10px] font-mono text-neon-green mb-1">
          ✅ 作业读写全部走 <strong>SSIO 云服务器</strong>（强一致），无需配置任何令牌或外链
        </div>

        <Row label="发布人昵称">
          <input
            value={hwPublisher}
            onChange={(e) => setHwPublisher(e.target.value)}
            placeholder="接收方看到的发布人名字（如：豆芽）"
            className="input-neon"
          />
        </Row>

      </Section>

      {/* v2：输入诊断区块已删除（Electron 时代输入失灵排障用；Tauri 版已无此问题场景） */}

      {/* 关于：about.txt 多源聚合 + 本地缓存（v1.1.7+） */}
      <Section icon={<Info size={14} />} title="关于">
        <AboutPanel appVersion={appInfo?.version || ''} />
      </Section>

      {/* v3: sticky 底栏 —— 放在内容容器内，宽度/边距自动与表单对齐（fixed+断点猜侧栏宽度是之前一直错位的根源）。
          滚动时吸在视口底，滚到底自动落位收尾；-mx-6 抵消容器 padding 让底条通栏。 */}
      <div className="sticky bottom-0 z-20 -mx-6 px-6 py-3 bg-ink-900/95 border-t border-neon-green/15 flex justify-start mt-6">
        <button onClick={save} className="btn-neon"><Save size={14} /> 保存所有设置</button>
      </div>

      {/* 分类编辑弹窗 */}
      {catModal.open && (
        <Modal title={catModal.id ? '编辑分类' : '新建分类'} onClose={() => setCatModal({ open: false, id: null, name: '', color: '#00FF88', emoji: '' })} footer={<><button onClick={() => setCatModal({ open: false, id: null, name: '', color: '#00FF88', emoji: '' })} className="btn-ghost mr-auto">取消</button><button onClick={saveCategory} className="btn-neon">保存</button></>}>
          <div className="space-y-3">
            <div><span className="label-tag block mb-1">名称 *</span><input value={catModal.name} onChange={(e) => setCatModal({ ...catModal, name: e.target.value })} className="input-neon" placeholder="如：作业 / 会议 / 倒数日" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><span className="label-tag block mb-1">Emoji</span><input value={catModal.emoji} onChange={(e) => setCatModal({ ...catModal, emoji: e.target.value })} className="input-neon" placeholder="📚 / ⭐" /></div>
              <div><span className="label-tag block mb-1">颜色</span><input type="color" value={catModal.color} onChange={(e) => setCatModal({ ...catModal, color: e.target.value })} className="input-neon h-10 p-1" /></div>
            </div>
          </div>
        </Modal>
      )}

      {/* v1.2.17：向导本体搬到 components/XlsImportWizard —— 课程页顶部也用它 */}
      <XlsImportWizard open={xlsOpen} onClose={() => setXlsOpen(false)} />

    </div>
  );
}

function Section({ icon, title, children, id, highlight }: any) {
  return (
    <div
      id={id ? `section-${id}` : undefined}
      className={`glass-panel p-5 space-y-3 transition-all duration-700 ${highlight ? 'ring-2 ring-neon-yellow/70 border-neon-yellow/50 shadow-[0_0_24px_rgba(251,191,36,0.15)]' : ''}`}
    >
      <div className="flex items-center gap-2 pb-2 border-b border-neon-green/10">
        <span className="text-neon-green">{icon}</span>
        <h3 className="label-tag">{title}</h3>
      </div>
      {children}
    </div>
  );
}

/**
 * 设置页的一行「标签 + 控件」。
 *
 * v1.2.21（用户实机截图逼出来的）：原来是 `flex items-center` + 标签固定 `w-32 shrink-0`。
 * 手机上（~390px）标签列就吃掉三分之一宽，右侧控件被压到不足一字宽 ——
 * 于是「设置账号密码」这类按钮变成**竖排的一个字一行**，整屏看起来像坏掉。
 * 现在窄屏纵向堆叠（标签一行、控件一行），≥sm 才恢复左右布局。
 */
function Row({ label, children }: any) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 py-2 border-b border-neon-green/5 last:border-b-0">
      <span className="text-sm text-text-secondary sm:w-32 sm:shrink-0">{label}</span>
      <div className="w-full sm:flex-1 sm:min-w-0">{children}</div>
    </div>
  );
}

/**
 * v1.2.18：清理规则的天数输入框（「保留设置」那块的病根）。
 *
 * 以前 value 直接绑服务端返回的 cleanRules、且 onChange 每敲一键就 IPC 写库，
 * 然后用响应整体回写 state —— 两个后果：
 *   · 快速输入「30」时两次 patch 的响应可能乱序到达，值被回退成「3」；
 *   · 想清空重输时，Number('')||min 立刻把值强制弹回，根本没法编辑。
 * 用户看到的就是「这块 UI 是错的」。
 *
 * 现在改成本地草稿：输入期间只改 draft，失焦（或回车）才 clamp 到 [min,max] 并落库；
 * 外部值变化（首次加载）只在未聚焦时同步进 draft。
 */
function RuleDaysInput({ value, min, max, onCommit }: { value: number; min: number; max: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(String(value)); }, [value, focused]);
  const commit = () => {
    const n = Math.min(max, Math.max(min, Math.round(Number(draft)) || min));
    setDraft(String(n));
    if (n !== value) onCommit(n);
  };
  return (
    <input
      type="number" min={min} max={max} value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className="input-neon w-16 py-0.5 px-2 text-xs text-right"
    />
  );
}

function Stat({ label, value }: any) {
  return (
    <div className="p-3 rounded-md bg-ink-base/60 border border-neon-green/20">
      <div className="font-mono text-[10px] text-text-dim uppercase">{label}</div>
      <div className="text-xl font-bold text-neon-green font-mono mt-1">{value}</div>
    </div>
  );
}

function Field({ label, children }: any) {
  return (
    <label className="block">
      <span className="label-tag block mb-1">{label}</span>
      {children}
    </label>
  );
}
