/**
 * updater.* 命名空间 —— 映射到内容热更新（hotUpdate.ts）。
 *
 * 旧契约（多源 latest.json + asar 补丁：patchPreview/patchApply/patchState/patchDownload/
 * patchCacheState/patchApplyCached/patchClearCache/patchTakeoverSidecar）全部退役，
 * 但保留方法名返回明确「已退役」语义，防止调用方静默失败。
 * UI 侧（PatchPanel/UpdateNotification）后续重写为热更新面板。
 */
import type { HandlerMap } from './dispatch';
import {
  checkHotUpdate, applyHotUpdate, rollbackHotUpdate, fetchPagesManifest,
  type PagesManifest,
} from './hotUpdate';

const RETIRED = { ok: false, retired: true, error: '增量补丁系统已退役（v2 内容热更新取代）' };

export function createUpdaterHandlers(): HandlerMap {
  let cachedManifest: PagesManifest | null = null;

  return {
    'update:config': async () => ({
      defaultSources: [{ name: 'SSIO 内容源', url: 'ssio:pages', enabled: true, primary: true, type: 'ssio' }],
      sources: [{ name: 'SSIO 内容源', url: 'ssio:pages', enabled: true, primary: true, type: 'ssio' }],
      activeIndex: 0,
      source: 'ssio:pages',
      defaultSource: 'ssio:pages',
      autoCheck: true,
      skippedVersion: null,
      lastCheckAt: Date.now(),
    }),
    'update:check': async () => {
      // 当前版本 = 壳版本（内容热更不改变壳版本号）
      let shell = '';
      try {
        const info = await (window as any).taskAPI?.app?.info?.();
        shell = String(info?.version || '');
      } catch { /* 拿不到就留空 */ }
      const r = await checkHotUpdate(shell);
      if (r.manifest) cachedManifest = r.manifest;
      return {
        ok: r.ok,
        configured: true,
        currentVersion: shell || '未知',
        // 没有更新时不要把线上旧版本号当"最新版本"回显，避免界面显示"新版本 v2.0.7"
        latestVersion: r.hasUpdate ? (r.manifest?.version ?? null) : (shell || null),
        hasUpdate: r.hasUpdate,
        notes: r.hasUpdate && r.manifest ? `内容版本 ${r.manifest.version}（${r.manifest.built}）` : null,
        error: r.error,
        checkedAt: Date.now(),
      };
    },
    'update:checkAll': async () => {
      const single = await (createUpdaterHandlers()['update:check'] as any)();
      return {
        currentVersion: single.currentVersion,
        ok: single.ok,
        anyConfigured: true,
        winner: { ...single, source: 'ssio', sourceName: 'SSIO 内容源' },
        perSource: [],
        checkedAt: Date.now(),
      };
    },
    'update:download': async () => ({ ok: true, path: '', size: 0, note: '热更新无需预下载，apply 时拉取' }),
    'update:cancel': async () => ({ ok: true }),
    'update:install': async () => {
      if (!cachedManifest) cachedManifest = await fetchPagesManifest();
      if (!cachedManifest) return { ok: false, error: '没有可用的内容清单' };
      return applyHotUpdate(cachedManifest);
    },
    'update:openExternal': async (url: string) => {
      if (!url) return { ok: false, error: '空链接' };
      // WebView 里 window.open 是空操作（不会开系统浏览器）—— 必须走 opener 插件
      try {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(url);
        return { ok: true };
      } catch {
        window.open(url, '_blank');
        return { ok: true };
      }
    },
    'update:skipVersion': async () => ({ ok: true }),
    // ===== 补丁系统退役（保留方法名防调用方崩溃）=====
    'update:patch:preview': async () => ({ available: false, reason: '补丁系统已退役', ...RETIRED }),
    'update:patch:apply': async () => RETIRED,
    'update:patch:state': async () => ({ applied: false, message: '补丁系统已退役，使用内容热更新' }),
    'update:patch:download': async () => RETIRED,
    'update:patch:cacheState': async () => ({ exists: false }),
    'update:patch:applyCached': async () => RETIRED,
    'update:patch:clearCache': async () => ({ ok: true }),
    'update:patch:takeoverSidecar': async () => RETIRED,
    // ===== 源管理（单源，保留 API 形状）=====
    'update:setSource': async (source: string) => ({ ok: true, source, sources: [] }),
    'update:setSources': async () => ({ ok: true, sources: [], activeIndex: 0 }),
    'update:setActiveSource': async () => ({ ok: true, activeIndex: 0, sources: [] }),
    'update:setAutoCheck': async (enabled: boolean) => ({ ok: true, enabled }),
    // ===== 热更新专属扩展（新通道）=====
    'hot:update:check': async () => checkHotUpdate(''),
    'hot:update:apply': async () => {
      if (!cachedManifest) cachedManifest = await fetchPagesManifest();
      if (!cachedManifest) return { ok: false, error: '没有可用的内容清单' };
      return applyHotUpdate(cachedManifest);
    },
    'hot:update:rollback': () => rollbackHotUpdate(),
    'hot:update:manifest': () => fetchPagesManifest(),
  };
}
