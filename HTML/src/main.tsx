import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/index.css';
import { installTaskAPI } from './api';

/**
 * 启动顺序：先装 taskAPI，装好才挂 App。
 * 之前 catch 分支重试同一条必然失败的路径后仍然 render，导致
 * window.taskAPI 为 undefined → Layout 调 updater 直接崩（打包版实测）。
 * 现在：任何一步失败都渲染「启动失败」诊断页，把真实错误显示出来，
 * 绝不在 taskAPI 缺失时挂载业务组件。
 */
async function boot() {
  const rootEl = document.getElementById('root')!;
  let impl: string | null = null;
  let firstError: unknown = null;

  try {
    impl = await installTaskAPI();
  } catch (e) {
    firstError = e;
    console.error('[StarTasks] API 初始化失败:', e);
  }

  // 兜底：Tauri 实现失败时退回内存演示层，保证界面能开 —— 但必须让用户看见
  if (!(window as any).taskAPI) {
    try {
      const { createBrowserApi } = await import('./mocks/browserApi');
      (window as any).taskAPI = createBrowserApi();
      impl = 'mock(兜底)';
      console.warn('[StarTasks] 已降级到 mock 演示层:', firstError);
      // 顶部常驻红色警告条：数据层没连上时，界面上的「0.2.5 / 假数据」必须自证
      const bar = document.createElement('div');
      bar.id = 'st-degraded-banner';
      bar.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:9999;background:#5b1218;color:#ffd9de;' +
        'font:12px/1.5 system-ui,sans-serif;padding:8px 14px;border-bottom:1px solid #ff6b7a;';
      const msg = String((firstError as any)?.message || firstError || '未知错误').replace(/[<>&]/g, '');
      bar.innerHTML =
        '<b>⚠ 数据库未连接，当前为演示模式（数据不会保存）</b>' +
        '<div style="opacity:.85;margin-top:2px;word-break:break-all">原因：' + msg + '</div>';
      document.body.appendChild(bar);
    } catch (e2) {
      console.error('[StarTasks] mock 兜底也失败:', e2);
    }
  }

  if (!(window as any).taskAPI) {
    // 彻底失败：显示可读诊断，而不是让组件崩在 ErrorBoundary 里
    rootEl.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#080d0b;color:#e6f5ec;font-family:system-ui,sans-serif;padding:32px">
        <div style="max-width:560px">
          <h1 style="color:#ff6b7a;font-size:20px;margin:0 0 12px">StarTasks 启动失败</h1>
          <p style="color:#8fa89b;font-size:13px;line-height:1.7">数据层未能初始化。请把下面的错误信息发给开发者：</p>
          <pre style="background:#101a15;border:1px solid #22352b;border-radius:8px;padding:12px;font-size:12px;color:#ffb3bc;white-space:pre-wrap;word-break:break-all">${String((firstError as any)?.stack || (firstError as any)?.message || firstError || '未知错误').replace(/[<>&]/g, '')}</pre>
          <button onclick="location.reload()" style="margin-top:16px;padding:10px 18px;border-radius:8px;border:none;background:#00ff88;color:#04120c;font-weight:600;cursor:pointer">重新加载</button>
        </div>
      </div>`;
    return;
  }

  console.info('[StarTasks] API 实现:', impl);
  // 标题栏直接标出实现类型：不用开 devtools 也能判断是不是掉进演示模式
  document.title = impl && String(impl).startsWith('mock')
    ? '⚠ 演示模式 · StarTasks'
    : `StarTasks · ${impl}`;

  /**
   * 热更内容的启动切换。
   * Rust 侧做不了：setup 里跳会被首屏加载覆盖（重启回退），on_page_load 里跳会打断
   * 首屏加载直接黑屏。所以等应用真正跑起来（这里）再切，切完页面会重载。
   * 条件：装的是内置前端（无 VITE_CONTENT_VERSION）+ 当前不在热更 origin + 磁盘上有热更产物。
   */
  try {
    const invoke = (window as any).__TAURI_INTERNALS__?.invoke;
    const builtinVer = ((import.meta.env.VITE_CONTENT_VERSION as string | undefined) || '').trim();
    const onHot = location.protocol === 'sthot:' || location.hostname.endsWith('sthot.localhost');
    if (invoke && !builtinVer && !onHot && !sessionStorage.getItem('hot_boot_switch')) {
      const v = await invoke('hot_update_version');
      if (v) {
        sessionStorage.setItem('hot_boot_switch', '1'); // 防循环：同一会话只尝试一次
        const switched = await invoke('hot_update_reload').catch(() => false);
        if (switched) return; // 正在重载到热更内容，别再渲染内置版本
      }
    }
  } catch { /* 切换失败就继续用内置前端 */ }
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <ErrorBoundary>
        <HashRouter>
          <App />
        </HashRouter>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

boot();

// IPC / 异步错误兜底：只记录，不白屏（页面各自决定如何提示）
window.addEventListener('unhandledrejection', (e) => {
  console.warn('[StarTasks] 未处理的异步错误:', e.reason);
});

// splash 兜底——如果 App 在 3 秒内未调用 ready()，强制通知壳层（Tauri 下是 noop）
setTimeout(() => {
  try { (window.taskAPI as any)?.app?.ready?.(); } catch { /* ignore */ }
}, 3000);
