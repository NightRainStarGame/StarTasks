import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * 教务（USTB SSO/BYYT）开发代理 —— 只在 dev server 生效。
 *
 * 浏览器有两条硬限制让它没法直连教务：
 *   1. CORS：跨域请求被拦
 *   2. Set-Cookie 是禁止读取的响应头 → 客户端的手动 CookieJar 拿不到会话
 * 这里用 /__ustb?u=<upstream> 转发，并把 set-cookie 复制成可读的
 * x-taskmgr-set-cookie（客户端早就有这个透传头的解析逻辑）。
 */
function ustbDevProxy(): Plugin {
  return {
    name: 'ustb-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/__ustb', (req, res) => {
        const parsed = new URL(req.url ?? '/', 'http://localhost');
        const target = decodeURIComponent(parsed.searchParams.get('u') || '');
        if (!/^https?:\/\//i.test(target)) {
          res.statusCode = 400; res.end('bad target');
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(Buffer.from(c)));
        req.on('end', async () => {
          try {
            const headers: Record<string, string> = {};
            for (const [k, v] of Object.entries(req.headers)) {
              if (!v) continue;
              if (['host', 'connection', 'content-length', 'origin', 'accept-encoding'].includes(k.toLowerCase())) continue;
              headers[k] = Array.isArray(v) ? v.join(',') : String(v);
            }
            const body = Buffer.concat(chunks);
            const method = req.method || 'GET';
            if (body.length && method !== 'GET' && method !== 'HEAD') headers['content-length'] = String(body.length);
            const r = await fetch(target, {
              method,
              headers,
              body: method === 'GET' || method === 'HEAD' ? undefined : body,
              redirect: 'manual',
            });
            const buf = Buffer.from(await r.arrayBuffer());
            res.statusCode = r.status;
            r.headers.forEach((v, k) => {
              if (k.toLowerCase() === 'set-cookie') return;
              if (k.toLowerCase() === 'content-encoding') return;
              try { res.setHeader(k, v); } catch { /* 忽略非法头 */ }
            });
            const cookies = (r.headers as any).getSetCookie?.() ?? [];
            if (cookies.length) res.setHeader('x-taskmgr-set-cookie', JSON.stringify(cookies));
            res.setHeader('cache-control', 'no-store');
            res.end(buf);
          } catch (e: any) {
            res.statusCode = 502;
            res.end('proxy error: ' + (e?.message || e));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), ustbDevProxy()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Tauri 生产模式从 dist/ 加载（dev 用 5173）；相对 base 兼容热更新目录加载
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    // Tauri dev 需要允许来自 WebView 的请求
    clearScreen: false,
  },
  build: {
    // 单入口单 bundle（热更新按文件覆盖，产物名固定不需要哈希；
    // 同时避免 file:// / 自定义协议下动态 import 的兼容性雷）
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});
