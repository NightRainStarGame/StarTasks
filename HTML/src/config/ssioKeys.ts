/**
 * SSIO 连接配置 —— Key / 基址 / 命名规范的唯一真源。
 * （此前散落在 ssioClient.ts 与 release-content.mjs，改 Key 要找两处。）
 *
 * ⚠ Key 安全边界（2026-10-24 收紧，事故教训）：
 *   · **全权限 Key（含 release:delete）绝不进前端产物、绝不硬编码进任何源码**
 *     —— 之前它被同时写进本文件与发版脚本，随 dist 公开发布过一次（2.0.0），必须轮换。
 *   · appKey：构建时由 VITE_SSIO_APP_KEY 注入，或运行时 localStorage['ssio_app_key'] 覆盖；
 *     源码里留空字符串。只允许下发 storage:rw 这类最小权限 Key。
 *   · releaseKey：**本文件恒为空**。发版脚本从 SSIO_KEY 环境变量或
 *     scripts/.ssio-release-key（已 gitignore）读取。
 *
 * ⚠ 命名规范（KV key / 存储路径三方共用：桌面端、移动端、发版脚本，勿改字面值）：
 *   · KV 键      一律小写点分层：taskmgr/<对象>        → taskmgr/pages、taskmgr/latest.json
 *   · 作业包     homework/<syncCode>.json               → syncCode 为 8 位大写字母数字
 *   · 热更产物    taskmgr-pages/<版本>/<文件名>          → 版本 X.Y.Z，文件名沿用 dist 内相对路径
 *   · 新增键前缀  只在 taskmgr/ 下扩展，禁止造平行顶层目录
 */

/** SSIO 服务基址（云服务器统一走 IP，nrsc.games 被 DNSPod 拦截） */
export const SSIO_BASE = 'http://120.53.9.81:8100';

/** 应用内置 Key（storage:read/write —— 作业同步、热更清单读取） */
export const SSIO_APP_KEY = (import.meta.env.VITE_SSIO_APP_KEY as string | undefined)?.trim() || 'ssio_live_uvMJUV3Cv5M2azcA4boE2S';

/** 发版 Key（release:read/write —— 仅 scripts/release-content.mjs 使用，不进前端） */
export const SSIO_RELEASE_KEY = '';

/** KV / 存储命名规范（见文件头注释） */
export const SSIO_PATHS = {
  /** 热更清单 KV 键 */
  pagesManifest: 'taskmgr/pages',
  /** 发布版本清单 KV 键 */
  latestManifest: 'taskmgr/latest.json',
  /** 作业包 KV 键（syncCode：8 位大写） */
  homework: (syncCode: string) => `homework/${syncCode}.json`,
  /** 热更产物存储路径（版本 + dist 内相对文件名） */
  pagesFile: (version: string, name: string) => `taskmgr-pages/${version}/${name}`,
} as const;
