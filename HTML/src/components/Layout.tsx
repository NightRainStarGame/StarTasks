import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import ParticleBg from './ParticleBg';
import PlusMenu from './PlusMenu';
import SearchPalette from './SearchPalette';
import PomodoroWidget from './Pomodoro';
import QuickAdd from './QuickAdd';
import useShortcuts from '@/hooks/useShortcuts';
import { useEffect, useState } from 'react';
import { useStore } from '@/store';
import { toast } from '@/utils/toast';
import Modal from './Modal';
import MobileTabBar from './MobileTabBar';

export default function Layout() {
  const { pathname } = useLocation();
  const [plusOpen, setPlusOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const setAppInfo = useStore(s => s.setAppInfo);
  const setUpdateInfo = useStore(s => s.setUpdateInfo);
  useShortcuts(() => setPlusOpen(true), () => setSearchOpen(true));

  // v1.2.3：主进程全局快捷键（Ctrl+Shift+A）→ 呼出快速添加（应用外也能唤起主窗口）
  useEffect(() => {
    const off = window.taskAPI.system?.onQuickAdd?.(() => setQuickAddOpen(true));
    return () => off?.();
  }, []);

  // v2：启动时云备份同步 + 结果提示（登录了网站账号才同步）
  useEffect(() => {
    let alive = true;
    (async () => {
      // 给应用 5 秒起量，不抢启动资源
      await new Promise((r) => setTimeout(r, 5000));
      if (!alive) return;
      try {
        const site = (window.taskAPI as any).site;
        const t = await site?.hasToken?.();
        if (!t?.hasToken) return; // 未登录：不打扰
        const s = await window.taskAPI.backup.serialize();
        if (!s?.ok || !s.json) return;
        const r = await site.backupPut(s.json, '');
        if (!alive) return;
        if (r?.ok) {
          toast.success(`☁️ 云备份同步成功（${((r.sizeBytes || 0) / 1024).toFixed(1)} KB）`);
        } else {
          toast.error(`☁️ 云备份同步失败：${r?.error || '网络异常'}`);
        }
      } catch (e: any) {
        if (alive) toast.error(`☁️ 云备份同步失败：${e?.message || e}`);
      }
    })();
    return () => { alive = false; };
  }, []);

  // 应用信息 + 启动静默检查更新
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const info = await window.taskAPI.app.info();
        if (alive) setAppInfo(info);
      } catch { /* 浏览器 mock 不可用时忽略 */ }

      // v1.2.20：移动端不再「完全跳过」。以前这里直接 return —— 更新入口只有
      // 设置页深处那一个，用户感知不到（「更新没内置」的直接原因）。
      // 现在启动后静默查一次 APK 清单：有新版本 → setUpdateInfo →
      // 侧栏「设置」亮 NEW 徽章 + UpdateNotification 弹手机版提示卡。
      // 桌面通道仍然跳过（install 依赖 child_process，在 APK 下必抛）。
      if ((window as any).__MOBILE__) {
        await new Promise((r) => setTimeout(r, 6000));
        if (!alive) return;
        try {
          const { checkAndroidUpdate } = await import('@/mobile/apkUpdater');
          const r = await checkAndroidUpdate();
          if (alive && r?.ok && r?.hasUpdate && r.latest) {
            setUpdateInfo({
              ok: true,
              hasUpdate: true,
              latestVersion: r.latest.version,
              notes: r.latest.notes || undefined,
            } as any);
          }
        } catch { /* 静默：查不到更新不打扰 */ }
        return;
      }

      // v1.2.10：首屏不再立刻打网络。以前挂载即并发请求 3 个更新源（单源超时 15s），
      // 和首屏渲染抢资源，直接拖慢冷启动。主进程 8s 后会做同样的检查并通过
      // updater:available 推过来（下面已订阅），所以这里延后即可。
      await new Promise((r) => setTimeout(r, 6000));
      if (!alive) return;

      try {
        const cfg = await window.taskAPI.updater.config();
        if (!cfg.source) return;
        const r = await window.taskAPI.updater.check();
        if (alive && r?.hasUpdate && !r?.skipped) setUpdateInfo(r);
      } catch { /* 静默 */ }
    })();

    const off = (window.taskAPI as any)?.updater?.onAvailable?.((r: any) => setUpdateInfo(r));
    return () => { alive = false; off?.(); };
  }, [setAppInfo, setUpdateInfo]);

  // 关闭确认（close_behavior=ask 时由壳层发事件）：没有这个监听，点 ✕ 会毫无反应
  const [closeAsk, setCloseAsk] = useState(false);
  const [rememberClose, setRememberClose] = useState(false);
  useEffect(() => {
    let un: any;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        un = await listen('app:close-requested', () => setCloseAsk(true));
      } catch { /* 浏览器环境无此事件 */ }
    })();
    return () => { un?.(); };
  }, []);

  const doClose = async (mode: 'quit' | 'minimize') => {
    try {
      if (rememberClose) await window.taskAPI.app.setCloseBehavior(mode);
      if (mode === 'quit') await window.taskAPI.window.close();
      else await window.taskAPI.window.minimize();
    } catch { /* 忽略 */ }
    setCloseAsk(false);
  };

  return (
    // v1.2.11：唯一外壳。用 dvh + 安全区内边距把内容推离状态栏/手势条。
    // 内部 absolute inset-0 的背景层仍按 padding box 铺满整屏，所以背景照样
    // 延伸到底，视觉上没有留白，但不重叠。桌面端变量为 0，行为完全不变。
    <div className="relative h-[100dvh] w-screen flex overflow-hidden bg-ink-base pt-[var(--sat)] pb-[var(--sab)] pl-[var(--sal)] pr-[var(--sar)]">
      {/* 动态背景 */}
      <div className="absolute inset-0 z-0">
        <ParticleBg density={50} />
        {/* 扫描线 */}
        <div className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'linear-gradient(180deg, transparent 0%, rgba(0,255,136,0.025) 50%, transparent 100%)',
            backgroundSize: '100% 3px',
          }}
        />
      </div>

      {/* 侧边栏（手机=抽屉 / 平板=图标窄栏 / 桌面=全宽） */}
      <Sidebar mobileOpen={menuOpen} onMobileClose={() => setMenuOpen(false)} />

      {/* 主区域 */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0">
        <TopBar
          onPlus={() => setPlusOpen(true)}
          onSearch={() => setSearchOpen(true)}
          onMenu={() => setMenuOpen(true)}
        />
        {/* v1.2.10：路由切换时按 key 重挂载 + 淡入上移，取代原来的瞬时硬切 */}
        {/* v1.2.12：移动端底部留白 —— 番茄钟悬浮球和页面内的固定操作条（如设置的
            保存条）都贴在视口底部，不给内容留空间的话列表最后几项永远点不到。
            平板/桌面（md+）空间充裕且没有全宽悬浮控件，不需要这个内边距。 */}
        <main className="flex-1 overflow-auto pb-[calc(4.5rem_+_var(--sab))] lg:pb-0">
          <div key={pathname} className="animate-page-in h-full">
            <Outlet />
          </div>
        </main>
      </div>

      {/* 手机端底部导航（桌面隐藏） */}
      <MobileTabBar />

      {/* 全局弹层 */}
      {plusOpen && <PlusMenu onClose={() => setPlusOpen(false)} />}
      {searchOpen && <SearchPalette onClose={() => setSearchOpen(false)} />}
      {/* v1.2.3：全局番茄钟 + 自然语言快速添加 */}
      <PomodoroWidget />
      {quickAddOpen && <QuickAdd onClose={() => setQuickAddOpen(false)} />}

      {/* 关闭确认 */}
      {closeAsk && (
        <Modal title="退出 StarTasks？" onClose={() => setCloseAsk(false)} width="max-w-sm">
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">选择关闭方式：</p>
            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
              <input type="checkbox" checked={rememberClose} onChange={(e) => setRememberClose(e.target.checked)} className="accent-neon-green" />
              记住我的选择（可在设置 → 软件更新 → 关闭按钮行为 修改）
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setCloseAsk(false)} className="btn-ghost px-3 py-1.5 text-xs">取消</button>
              <button onClick={() => doClose('minimize')} className="btn-ghost px-3 py-1.5 text-xs">最小化</button>
              <button onClick={() => doClose('quit')} className="btn-neon px-3 py-1.5 text-xs">退出</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}