/**
 * 平台依赖接口 —— tauri.ts 与 sqljs.ts 的差异面收敛点。
 * 业务 handlers 只依赖此接口，不感知运行在哪个壳里。
 */
export interface SqlExecutor {
  /** 执行写语句，返回受影响行数 */
  run(sql: string, params?: any[]): Promise<number>;
  /** 查询多行 */
  all<T = any>(sql: string, params?: any[]): Promise<T[]>;
  /** 查询单行 */
  get<T = any>(sql: string, params?: any[]): Promise<T | null>;
}

export interface HttpRequest {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  /** 是否跟随重定向（USTB SSO 流程需要 false） */
  followRedirect?: boolean;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  bodyText(): Promise<string>;
  bodyBytes(): Promise<Uint8Array>;
}

export interface PlatformDeps {
  sql: SqlExecutor;
  /** 原生 HTTP（Tauri 走 Rust 无 CORS；浏览器降级 fetch 受 CORS 限制） */
  http(req: HttpRequest): Promise<HttpResponse>;
  /** 系统对话框：打开文件，返回路径（浏览器降级返回 null） */
  pickFile(opts?: { filters?: { name: string; extensions: string[] }[] }): Promise<string | null>;
  /** 保存对话框 */
  saveFile(opts?: { defaultName?: string }): Promise<string | null>;
  /** 读文件为字节（浏览器降级：配合 pickFileBuffer 语义） */
  readFile(path: string): Promise<Uint8Array>;
  /** 写文件 */
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  /** 系统通知 */
  notify(title: string, body?: string): Promise<void>;
  /** 打开外部链接 / 文件管理器定位 */
  openExternal(url: string): Promise<void>;
  showInFolder(path: string): Promise<void>;
  /** 应用信息 */
  appInfo(): Promise<{ name: string; version: string; platform: string; packaged: boolean }>;
  /** 窗口控制（浏览器降级 noop） */
  windowMin(): Promise<void>;
  windowMax(): Promise<void>;
  windowClose(): Promise<void>;
  windowIsMax(): Promise<boolean>;
  /** 事件订阅（主进程 → 前端） */
  subscribe(channel: string, cb: (payload: any) => void): () => void;
  /** 关闭行为配置持久化位置（settings 表即可） */
}
