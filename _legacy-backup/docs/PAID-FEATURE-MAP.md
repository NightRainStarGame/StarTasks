# 班级付费体系 · 代码落点全图（移交文档）

> 目的：把「班级功能的付费内容」从当前实现（收款码 + 本地月卡码）改为**网站发卡**。
> 本文只描述**现状与落点**，不含改造方案；由接手方决策。
>
> 生成时间：2026-10-14 · 基于 v1.2.22 前后工作区（所有行号均为撰写时的实际行号）

---

## 0. 三个必须先知道的结论

### ① 客户端完全不连 `server/`

在 `electron/` 与 `src/` 下搜索 `/v1/monthly`、`/v1/vouchers`、`localhost:3000`、`apiBase` —— **零命中**。
付费是**纯本地**的：客户端只查自己的 SQLite 表 `monthly_subscriptions`。

`server/` 目前只被当作**本机发码 CLI 库**使用：
`scripts/issue-voucher.ps1` → `server/dist/cli/gen-monthly.js` → `server/src/lib/voucher.ts` 的 `issueVoucher()`。

### ② 仓库里存在两套互不兼容的码制

| 体系 | 码格式示例 | 生成者 | 客户端能否接受 |
|---|---|---|---|
| 本地体系（**实际生效**） | `S8DB-AB2C-D3EF-44A5`（16 位 base32，4×4） | `scripts/build-voucher-codes.mjs` | ✅ 接受 |
| 服务端体系（**发码器在用**） | `V1-MONTHLY-<hmac43>-<payload22>` | `server/src/lib/voucher.ts` + `scripts/issue-voucher.ps1` | ❌ **必然被拒** |

原因见 `electron/billing.ts:27` 的正则：只认 4 段各 4 位的 base32。

> 即：**发码器发出去的码，客户端一张都激活不了。**

### ③ 本地校验是空操作 —— 任何人可白嫖

`electron/billing.ts:25-34`：

```ts
function verifyMonthlyCode(code: string): boolean {
  if (!/^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/.test(code)) {
    return false;
  }
  const mac = createHmac('sha256', MONTHLY_SECRET).update(code).digest('base64url');
  return mac.length === 43;   // ← base64url(32 字节) 恒为 43 字符，永远 true
}
```

只要形如 `^[A-HJ-KM-NP-Z2-9]{4}-...$` 就判定有效。**`AAAA-AAAA-AAAA-AAAA` 可直接开通月卡。**
HMAC 只被用来"算一下就丢"，结果从未与任何期望值比较。

---

## 1. 客户端落点（Electron 主进程 + 渲染层）

### 1.1 计费核心

| 文件 | 行号 | 内容 |
|---|---|---|
| `electron/billing.ts`（141 行） | 全文 | **唯一实现**。注释第 1-14 行描述设计（纯本地、无 VPS 通信） |
| 同上 | :20 | `MONTHLY_SECRET = 'v126_monthly_nrs_2026_offline'`（硬编码，与出码脚本同源） |
| 同上 | :23 | `MONTHLY_DAYS = 30` |
| 同上 | :25-34 | `verifyMonthlyCode()` —— **空校验**（见 §0③） |
| 同上 | :37-41 | `maskCode()` → `S8DB-****-****-44A5`（给用户自查用） |
| 同上 | :43 | `export function registerBilling(db: DB)` |
| 同上 | :45-86 | IPC `billing:status`：`MAX(expires_at)`、`isPremium`、`premiumUntil(Iso)`、`remainingDays`、`activatedCount`、`monthlyDays`、`recentlyActivatedCodes`(最近 5 条 mask 后) |
| 同上 | :89-134 | IPC `billing:redeemMonthly`：正则 → 空校验 → `INSERT` 撞 UNIQUE 防重放；重复激活返回 `errorCode:'ALREADY_ACTIVATED'` + 首次/到期时间 |
| 同上 | :137 | IPC `billing:redeemVoucher` —— **兼容桩**，恒返回失败 |
| 同上 | :140 | IPC `billing:syncVouchers` —— **兼容桩**，恒 `{ok:true, activated:0}` |

### 1.2 注册与契约

| 文件 | 行号 | 内容 |
|---|---|---|
| `electron/ipc/index.ts` | :9 | `import { registerBilling } from '../billing'` |
| 同上 | :935 | `registerBilling(db)` —— **唯一注册点**（在 `registerAllIpc` 内） |
| `electron/api-factory.ts` | :634-668 | IPC 契约 DTO：`billing.status` / `redeemMonthly` / `redeemVoucher` / `syncVouchers` |
| `electron/preload.ts` | :2, :13, :15 | 经 `buildAPI(invoke, send, subscribe)` **整体暴露**为 `window.taskAPI`；**无通道白名单** —— 新增通道不必改 preload，但删掉通道也不会报错（重要注意点） |

### 1.3 本地数据库（`electron/db/index.ts`）

| 行号 | 表 / 字段 |
|---|---|
| :633-640 | `monthly_subscriptions(id, voucher_code, opened_at, expires_at, source, server_synced)` |
| :643-644 | `CREATE UNIQUE INDEX uq_monthly_subscriptions_voucher ON monthly_subscriptions(voucher_code)` ← **防重放全靠这个**（仅本机级） |
| :646-652 | `voucher_purchases(id, code UNIQUE, plan, redeemed_at, local_kept_at)` —— 旧「基础开通码」账本，已无生产者 |
| :657-663 | `device_profile(id, device_token, nickname, created_at, server_synced)` —— 单行表；**当前无任何付费逻辑读它** |

> ⚠️ `monthly_subscriptions` 里已有**真实用户数据**，改造时不要 DROP。

### 1.4 定价常量

| 文件 | 行号 | 内容 |
|---|---|---|
| `src/config/pricing.ts`（32 行） | :10-21 | `PRICING.MONTHLY = { priceYuan: 6.6, days: 30, classesLimit: 1, imageSizeMB: 100 }` |
| 同上 | :23-26 | `PRICING.FREE = { imageSizeMB: 10 }` |
| 同上 | :28 | `EXPIRY_WARN_DAYS: 3` |
| 同上 | :32 | `export const HAS_BASIC_PLAN = false` |
| 同上 | :6 | 注释：与服务端 `server/src/lib/voucher.ts` 的 `expDays` **必须手工同步**（无自动化） |

**未消费的字段**（定义了但全仓无人读）：`priceYuan`、`classesLimit`、`EXPIRY_WARN_DAYS`、`HAS_BASIC_PLAN`。
即：「可开 1 个班」「到期前 3 天警示条」**都没实现**。

### 1.5 UI（`src/pages/Settings.tsx`，1709 行）

| 行号 | 内容 |
|---|---|
| :7 | `import paymentWechatQr from '../assets/payment-wechat.png'` |
| :99-120 | `useLocation().state.scrollTo` → 高亮定位逻辑（`highlightId`） |
| :1134 | `<Section icon={<Crown/>} title="月卡与付费（v1.2.6 离线版）" id="monthly" highlight={...}>` ← **锚点，班级页跳转靠它** |
| :1139 | 渲染 `<PurchaseMonthlyRow />` |
| :1145-1147 | 配额文案（读 `PRICING.FREE/MONTHLY.imageSizeMB`） |
| :1619 | `const WECHAT_ID = 'NRSG-Power'` |
| **:1621-1754** | `function PurchaseMonthlyRow()`：收款码图片 + 「我已付款」按钮(:1677) + 客服微信弹窗(:1708-) + 激活输入框(:1689-1699) + `submit()`(:1631 调 `redeemMonthly`) |
| **:1755-1789** | `function PremiumStatusRow()`：`billing.status()` → 会员状态 / 到期日 / 剩余天数 |
| **:1791-1822** | `function ActivatedCodesRow()`：已激活码列表（mask 后，用户自查） |
| :1824 | 注释：`MonthlyRedeemRow 已被 PurchaseMonthlyRow 替换`（**已删除组件的墓碑注释**，2 行） |

> 该区块共 **3 个局部组件**：`PurchaseMonthlyRow` / `PremiumStatusRow` / `ActivatedCodesRow`。

### 1.6 付费门禁（**唯一真实生效的一处**）

| 文件 | 行号 | 内容 |
|---|---|---|
| `electron/class/index.ts`（926 行） | :360 | `ipcMain.handle('class:create', ...)` |
| 同上 | :364-376 | 查 `monthly_subscriptions`；无有效月卡 → `{ ok:false, error:'创建班级需要月卡（同学加入仍免费）', errorCode:'PREMIUM_REQUIRED', hint:'去「设置 → 月卡与付费」激活月卡后即可创建' }` |
| `src/pages/Class/index.tsx` | :108 | `onJumpToPay={() => nav('/settings', { state: { scrollTo: 'monthly' } })}` |
| 同上 | :230 | `const [needPremium, setNeedPremium] = useState(false)` |
| 同上 | :240-242 | 捕获 `errorCode === 'PREMIUM_REQUIRED'` → `setNeedPremium(true)` |
| 同上 | :250-268 | 「⭐ 创建班级需要月卡」引导弹窗 + 「去激活月卡」按钮 |

> 一句话：**创建班级要月卡，加入班级免费**。

### 1.7 浏览器预览 mock

| 文件 | 行号 | 内容 |
|---|---|---|
| `src/mocks/browserApi.ts` | :507-534 | `billing.status` mock |
| 同上 | :535-561 | `billing.redeemMonthly` mock —— **只认 `DEMO-` 前缀的假码**(:537) |
| 同上 | :562-563 | `redeemVoucher` / `syncVouchers` 桩 |
| `src/mocks/browserApi/data.ts` | — | `billedCodes` 内存表（预览刷新即丢） |

### 1.8 其它资源

| 路径 | 内容 |
|---|---|
| `src/assets/payment-wechat.png` | 微信收款码图片（153,008 字节） |

---

## 2. 服务端（`server/`，Fastify + better-sqlite3）

> 再次强调：**客户端不调它**。它当前的作用是「本机 CLI 出码库」+ 一份未接线的前瞻实现。

| 文件 | 行号 | 内容 |
|---|---|---|
| `server/src/lib/voucher.ts`（49 行） | :22-26 | `issueVoucher(plan, secret)` → `V1-{PLAN}-{mac}-{payload}` |
| 同上 | :29-39 | `verifyVoucherSignature()` —— **真 HMAC + `timingSafeEqual`**（与客户端形成鲜明对比） |
| 同上 | :42-48 | `verifyBasicVoucher()` / `verifyMonthlyVoucher()` |
| `server/src/lib/pricing.ts`（14 行） | — | `PRICING.MONTHLY.days = 30`，注释声明与前端手工同步 |
| `server/src/config.ts` | — | 读 env（含三个 SECRET） |
| `server/src/routes/monthly.ts`（81 行） | :20-27 | `POST /v1/monthly/verify` |
| 同上 | :29-65 | `POST /v1/monthly/redeem`：`requireAuth`、绑定 `device_token`、写 `devices.premium_until`、**续费叠加 30 天**（:57-60）、`ALREADY_USED` → 409 |
| 同上 | :67-80 | `GET /v1/monthly/status` |
| `server/src/routes/vouchers.ts`（52 行） | :13-20 / :23-51 | 基础码 `verify` / `redeem`（含"盲登记"入库逻辑 :36-41） |
| `server/src/cli/gen-monthly.ts`（17 行） | — | 出月卡码 CLI（读 `MONTHLY_VOUCHER_HMAC_SECRET`） |
| `server/src/cli/gen-voucher.ts`（17 行） | — | 出基础码 CLI |
| `server/src/migrations/001_init.sql` | :76-82 | `devices` 表含 `premium_until`(:79) |
| 同上 | :84-90 | `vouchers` 表（`used_by_token`） |
| 同上 | :92-100 | `monthly_vouchers` 表（`used_by_token`, `expires_at`）+ `idx_monthly_used_by` |
| `server/.env.example` | — | `DEVICE_TOKEN_HMAC_SECRET` / `VOUCHER_HMAC_SECRET` / `MONTHLY_VOUCHER_HMAC_SECRET` / `MAX_UPLOAD_MB_FREE` / `MAX_UPLOAD_MB_PREMIUM` / `ANYSHARE_*` |
| `server/package.json` | — | `voucher:gen`、`monthly:gen`、`deploy:win` 等脚本 |
| `server/deploy/install-windows.ps1` | — | Windows 部署（同目录有 `taskmanager-server-v1.2.5.zip` 及 **20+ 个 `.bak` 残留**） |
| `server/data/issue.log` | — | **明文码**发放日志（当前 3 行） |
| `staging/taskmanager-server-v1.2.5/` | — | 服务端旧快照副本 |

---

## 3. 脚本 / 文档 / 数据文件

| 路径 | 行数 | 内容 |
|---|---|---|
| `scripts/issue-voucher.ps1` | 159 | 发码器：读 `server/.env` → 跑 `server/dist/cli/gen-*.js` → 写剪贴板 → 追加 `server/data/issue.log` |
| `scripts/install-issue-voucher-shortcut.ps1` | 106 | 安装桌面快捷方式「发码器(月卡).lnk」「发码器(基础码).lnk」 |
| `scripts/build-voucher-codes.mjs` | 108 | **本地体系**的批量出码；`:26` 的 SECRET 与 `billing.ts:20` **完全相同**，`:29` ALPHABET 与客户端正则同源 |
| `docs/ISSUE-VOUCHER.md` | 163 | 发码器手册。第 43-59 行记录了一个**已知 bug**：「客户端 build 没注入 SECRET → 用户激活报『签名无效』」，并给出未实施的 `vite.config.ts define` 补丁方案 |
| `data/voucher-codes.txt`（+ `.sig.txt`） | — | 本地码库输出（由 build-voucher-codes.mjs 生成） |
| `release-notes-1.2.5.md` ~ `1.2.9.md` | — | 该体系的历史发版说明（含定价/流程演变） |

**测试覆盖：无。** 搜索 `scripts/test-*.js` 里 `billing|voucher|monthly|premium` → 零命中。
现有三个测试套件（`test-core` / `test-timetable` / `test-updater-sources`）都不涉及付费。

---

## 4. 改造为「网站发卡」时必然遇到的断层

按处理优先级排列：

1. **码格式统一**
   客户端 `electron/billing.ts:27` 的正则只认 16 位 base32。网站要发的卡若不是这个形状，必须整体替换该校验。

2. **校验必须变成真的**
   现状 `return mac.length === 43` 恒真（§0③）。**只改格式不改校验 = 换个样子继续白嫖。**
   服务端已有可用的参考实现：`server/src/lib/voucher.ts:29-39`。

3. **「网站发卡」意味着引入网络或密钥注入**
   `billing.ts:1-14` 的注释明确写着「完全本地化（无任何 VPS 通信）」。
   改造路径二选一：
   - **(a) 在线校验**：客户端调服务端 API（需决定用 `server/` 还是 SSIO —— 两者目前互不相干）；
   - **(b) 离线验签**：把 HMAC 密钥安全注入 build（`docs/ISSUE-VOUCHER.md:43-59` 描述的 `vite.config.ts define` 方案正是为此，但**从未实施**）。
   注意：密钥一旦进 build 就是可逆的（离线验签的固有代价）。

4. **去重语义要从「本机」升级为「服务端」**
   现状靠 `monthly_subscriptions.voucher_code` 的 UNIQUE 索引（`electron/db/index.ts:643-644`），**只能防同一台机器重复激活；同一张码可在 N 台机器各激活一次**。
   服务端 `monthly_vouchers.used_by_token` + `monthly.ts:39-47` 的 `ALREADY_USED` 逻辑已经能承担全局唯一。

5. **定价常量目前是两处手工同步**
   `src/config/pricing.ts` 与 `server/src/lib/pricing.ts` 无任何自动化（注释都承认了）。
   若网站要按价签发，建议消灭这份重复。

---

## 5. 改动影响面清单

### 建议删除（纯付费营销/发码链路）

- `src/pages/Settings.tsx:1621-1754` `PurchaseMonthlyRow`（收款码 + 客服微信流程）
- `src/pages/Settings.tsx:1619` `WECHAT_ID`、`:7` 收款码 import
- `src/assets/payment-wechat.png`
- `electron/billing.ts:137` `billing:redeemVoucher`、`:140` `billing:syncVouchers` 两个兼容桩 + `api-factory.ts` 对应 DTO
- `electron/db/index.ts:646-652` `voucher_purchases` 表、`src/config/pricing.ts:32` `HAS_BASIC_PLAN`
- `scripts/issue-voucher.ps1`、`scripts/install-issue-voucher-shortcut.ps1`、`docs/ISSUE-VOUCHER.md`
- `scripts/build-voucher-codes.mjs`（**注意**：它的 `ALPHABET`/`SECRET` 与客户端同源，删它等于弃用本地体系）
- `src/pages/Settings.tsx:1824` 那两行组件墓碑注释

### 建议保留

- `electron/class/index.ts:364-376` 的门禁**判断位置**（只替换判定条件，保留 `PREMIUM_REQUIRED` 错误码）
- `src/pages/Class/index.tsx:250-268` 的引导弹窗（文案要改，`onJumpToPay` 目标要改）
- `billing:status` 的**返回形状**（`Settings.tsx:1755-1789` 与班级页都依赖）
- `electron/db/index.ts:633-644` `monthly_subscriptions`（**存量用户数据，禁止 DROP**）
- `src/pages/Settings.tsx:1134` 的 `id="monthly"` 锚点（除非同时改掉班级页的跳转目标）

### 必须一并检查的耦合点

- `electron/preload.ts` 无通道白名单 → 删通道不会编译报错，**只能靠人工 grep 确认无调用方**
- `src/mocks/browserApi.ts:507-563` 的 mock 必须同步（否则浏览器预览静默不一致）
- `src/pages/Settings.tsx:99-120` 的 `scrollTo` 高亮逻辑依赖 `id="monthly"`

---

## 6. 快速自查命令

```powershell
# 谁还在调计费 IPC
Select-String -Path "src\**\*.tsx","src\**\*.ts","electron\**\*.ts" -Pattern "taskAPI\.billing|registerBilling|monthly_subscriptions"

# 门禁是否仍生效
Select-String -Path "electron\class\index.ts" -Pattern "PREMIUM_REQUIRED|monthly_subscriptions"

# 是否有测试覆盖
Select-String -Path "scripts\test-*.js" -Pattern "billing|voucher|monthly|premium"
```

---

## 7. 易混淆项（避免改错地方）

- **SSIO**（`electron/cloud/ssioClient.ts`）承载**更新 / 作业同步 / 班级数据**，与付费体系**毫无关系**。
- `server/` 与 SSIO 是**两个独立的服务端**，目前都未参与付费链路。
- `src/config/pricing.ts` 的 `days` 是月卡时长，与 `server/src/lib/pricing.ts` 的 `days` 是同一语义的两份副本。
- `src/hooks/useLocalStorage.ts`、`src/mobile/bootstrap.ts` 命中过「卡」字关键词，但**与付费无关**（已核查，是无关文案）。
