/**
 * taskAPI 安装入口 —— 运行环境探测 + 三实现选择。
 *
 * 契约形状 = electron/api-factory.ts 的 buildAPI()（原样搬运，禁止改形状）。
 * 三个实现：
 *   1. tauri  —— Tauri 2 壳（桌面/Android）：db 走 plugin-sql，云走 plugin-http（Rust 侧，绕 CORS）
 *   2. sqljs  —— 纯浏览器预览：db 走 sql.js WASM，云走 fetch（受 CORS 限制，降级）
 *   3. mock   —— src/mocks/browserApi 的内存演示数据（连 sql.js 都不装时的兜底）
 *
 * 选择顺序：Tauri 环境 → tauri；否则 URL 参数 ?impl=mock 强制 mock；
 * 否则 sqljs（失败自动降级 mock）。
 */
import { buildAPI, type TaskAPI } from './api-factory';

export type { TaskAPI } from './api-factory';
export type ApiImplName = 'tauri' | 'sqljs' | 'mock';

declare global {
  interface Window {
    taskAPI: TaskAPI;
  }
}

function isTauri(): boolean {
  return typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

export async function installTaskAPI(): Promise<ApiImplName> {
  const force = new URLSearchParams(location.search).get('impl');
  if (force === 'mock') {
    const { createBrowserApi } = await import('../mocks/browserApi');
    (window as any).taskAPI = createBrowserApi();
    console.info('[StarTasks] impl=mock（强制内存演示数据）');
    return 'mock';
  }

  if (isTauri()) {
    const { createTauriApi } = await import('./tauri');
    (window as any).taskAPI = await createTauriApi();
    console.info('[StarTasks] impl=tauri');
    return 'tauri';
  }

  try {
    const { createSqljsApi } = await import('./sqljs');
    (window as any).taskAPI = await createSqljsApi();
    console.info('[StarTasks] impl=sqljs（浏览器预览，本地 SQLite WASM）');
    return 'sqljs';
  } catch (e) {
    console.warn('[StarTasks] sqljs 初始化失败，降级 mock:', e);
    const { createBrowserApi } = await import('../mocks/browserApi');
    (window as any).taskAPI = createBrowserApi();
    return 'mock';
  }
}

/** 测试辅助：不依赖 window，直接构造指定实现 */
export { buildAPI };
