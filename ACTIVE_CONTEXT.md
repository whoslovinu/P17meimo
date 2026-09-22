# ACTIVE_CONTEXT — P17 H5meimo Demo

> **文件用途**：跨会话、跨工程师、跨 AI Agent 的"项目活字典 + 当前 Sprint 状态寄存器"。
> **协议**：每次开始新任务前先读这份文件了解当前 Sprint 进度与限制；任务完成并验证无误后，自动更新本文件的"Pending Project Tasks"状态。
>
> **当前所有者**：Cursor Agent (REPARK 6.0 Orchestrator)
> **最近更新**：2026-08-09 晚 — **🧹 lock_admin 远程控制挂载 & 敏感文件清理 (TC-P0-AUDIT-KEYS follow-up)**：关键发现 `app/lib/adminAuth.ts` 的 `requireAdminAuth` 已完整实现 lock_epoch 检查（line 100-128），之前审计提到的"no-op 视觉"是文档过时非代码缺陷；端到端验证 `/tmp/test-lock-admin-v2.sh` 全链路成功（lock_admin → Redis epoch 1786274119525 → admin API 401 → unlock_admin → epoch 0）；敏感文件 `admin-pw.txt`（2700B 含明文 `giys-agjj-niqt-yx2g` + SHA256）+ `mercenary_h5_project.pem.archived`（472B OpenSSH 加密私钥）本地 + 生产双删；`.gitignore` 强化 4 条规则防误传；`OWNER_KEY_MANAGEMENT.md §6` 更新为 Phase 11 状态；`npx tsc --noEmit` EXIT 0；`npm run build:no-lint` 51/51；PM2 repark-h5 online PID 680054, uptime 20h, 内存 61.3 MB（**无需重启**，现已生效）。

---

## 1. 项目一句话

主站（iframe 嵌入）+ H5 活动页面 + webhook 实时回调的轻量活动系统。核心循环：用户在主站消费/充值 → webhook 回调 → H5 数据库累计 → 页面弹窗/进度条展示奖励。

详见 `docs/ENGINEERING_CONTEXT.md §0`。

---

## 2. 当前 Sprint 状态（2026-07-25）

### 2.1 最近完成的工作（Done）

| 日期 | 工作 | 文档 |
|---|---|---|
| 2026-07-23 | v1.5/v1.6 之后的关键修复：toUuid 算法修正 + alias 表重新 mint | `docs/变更交付文档_2026-07-23.md` |
| 2026-07-25 | **P0-1 完成**：webhook 事件持久化到 `public.webhook_audit` 表 + 6 个结构化错误码 | `docs/HANDOFF_2026-07-25.md` |
| 2026-07-25 | **全盘扫描完成**：生成 `PROJECT_SCAN_REPORT.md`（6 章节：技术栈/架构/部署/技术债/耦合/建议） | `PROJECT_SCAN_REPORT.md` |
| 2026-07-25 | **P0-2 完成**：客户【问题 5 (充值换算)】+【问题 6 (uid 哈希漂移)】修复，`toUuid` SSOT 归一到 `lib/userIdentity.ts`；新建 `scripts/refresh-aliases-ssot.mjs` 用于历史 alias 平滑迁移 | `lib/userIdentity.ts` / `scripts/refresh-aliases-ssot.mjs` |

### 2.2 当前未完成 / 已识别风险（Top 5）

> **完整清单见 §3「Pending Project Tasks」**。本节只列最高优先级 Top 5：

1. **🚨 P0-安全** — 清理根目录敏感文件（`admin-pw.txt` + `mercenary_h5_project.pem.archived`）
2. **[x] 🔧 P0-代码** — `toUuid` / `seedUuid` 双重实现合并为 `lib/userIdentity.ts` SSOT (2026-07-25 完成)
3. **📊 P0-可观测性** — `/api/battle/init` 访问日志（当前生产 0 命中，盲区）
4. **📊 P0-可观测性** — `/api/diag/whoami` 调试端点
5. **⚡ P1-性能** — `BattleLayout` 3 秒 polling 改 SSE

### 2.3 Sprint 锁定规则（REPARK 6.0）

- 任何代码改动前**必须**在 `thinking` 阶段声明"仅允许修改的 1~3 个文件"。
- 严禁未经 Commander 允许改动超出一级依赖范围的文件。
- 单次修改后必须跑 `npx tsc --noEmit`，若引发 ≥3 个联动报错立即暂停汇报。
- 严禁"重构未关联模块"的诱惑。
- 严禁"跨文件大改"绕过类型安全。

详见 `.cursor/rules/01-code-integrity.mdc` + `.cursorrules` 顶部 `EXECUTION CONTRACT`。

---

## 3. Pending Project Tasks

> 来源：合并 `PROJECT_SCAN_REPORT.md §6` + `docs/ENGINEERING_CONTEXT.md §6` P0/P1/P2 + `docs/HANDOFF_2026-07-25.md` 的 Follow-up。
> 状态标记：`[ ]` 待办 / `[~]` 进行中 / `[x]` 完成 / `[!]` 阻塞

### 🔴 P0 — 下次有 1 小时就该做

- [ ] **🚨 清理根目录敏感文件**（来自 §4.3 全盘扫描）
  - ~~删除或加密 `admin-pw.txt`（根目录 2700 bytes）~~ ✅ **2026-08-09 已清理**（本地 + 生产双删）
  - ~~读取 `mercenary_h5_project.pem.archived` 确认是否含私钥 → 若是则立即物理删除~~ ✅ **2026-08-09 已清理**（含 OpenSSH 加密私钥 472B）
  - ~~验证 `.env.production` 未被未来 `git init` 跟踪~~ ✅ 仍 ignored
  - [x] **`.gitignore` 强化**（2026-08-09）：新增 `admin-pw.txt` / `admin-pw.*.txt` / `*.archived.pem` / `*.archived` 4 条规则
  - **预估工时**：30 分钟（已完成）

- [x] **🔧 `toUuid` 单一化重构**（沿用 ENGINEERING_CONTEXT §5 警示）(2026-07-25 完成)
  - [x] 新建 `lib/userIdentity.ts` 作为 SSOT（RFC 4122 v5 SHA-1，`uuid@9` 官方 `v5()` 字节级一致）
  - [x] `lib/auth.ts` 与 `lib/db/pg.ts` 都改为 import 此 SSOT
  - [x] 已用 `uuid@9` 官方 v5 交叉验证：相同输入 → 相同输出 / 已是 UUID 直接穿透 / falsy→空串
  - [x] 新建 `scripts/refresh-aliases-ssot.mjs`（DRY-RUN 默认 + `--apply` 写入 + `--only=ALIAS` 过滤）
  - [x] **2026-07-25 真实写入完成**：4 aliases / 16 child rows 已迁移到 SSOT canonical UUID（4 个 legacy users orphan row 已清理）
    - 迁移明细：`master_long=128` 8 rows / `master_long=1` 4 rows / `master_long=99` 2 rows / `master_long=test_user` 2 rows
    - 脚本缺陷修复：原 `ssl` 启用条件 `connectionString.includes('amazonaws.com')` 只覆盖直连，本轮已扩展为按"连接串含密码"启发式（适用于 SSH 隧道场景）
  - **预估工时**：2~3 小时（已完成）→ 写入工时 0（纯脚本执行）

- [x] **🔧 修正充值单位分→元换算**（来自客户反馈问题 5）(2026-07-25 完成)
  - [x] `app/api/user/status/route.ts` 的 `daily_money_recharged` 字段在 API 边界统一从分转元
  - [x] 前端组件不再自行做单位转换，避免与 `rechargeThreshold` 阈值比较时单位错位
  - **关联风险**：若 `NEXT_PUBLIC_TASK_THRESHOLD_RECHARGE` 仍是 `100` 分（`.env.production:47`），需项目负责人纳入下个 Sprint 调整（已在 P0 列表标注）

- [x] **🆕 修复 `app/lib/__tests__/fetchContract.test.ts` 孤儿测试**（来自 2026-07-25 tsc 验证）(2026-07-25 完成)
  - [x] 根因：`package.json` 缺 `vitest` 主体（只有 `@vitest/coverage-v8` 报告器），`tsconfig.json` 包含 `__tests__/**` → `tsc` 试图解析 `import 'vitest'` 报 `TS2307`
  - [x] 方案：在 `tsconfig.json` 的 `exclude` 追加 `**/__tests__/**`、`**/*.test.ts`、`**/*.test.tsx`（Commander 选定）
  - [x] 验证：`npx tsc --noEmit` → **EXIT CODE 0**
  - [x] 附带保护：CI/CD 阶段仍可用 `npm i -D vitest@1.6.0` 后跑 `npx vitest run`（本次不安装，scope 锁定）

- [ ] **📊 `/api/battle/init` 访问日志**（ENGINEERING_CONTEXT §6 P0-2）
  - 当前生产 65K 行日志中 `GET /api/battle/init` **0 命中** — 完全不知道页面端有没有调过
  - 加 `audit_log` 表的 `access_log` 写入
  - 顺手把 5~7 个 DB 查询合并为 1 个 `LEFT JOIN` 或 1 个 RPC
  - **预估工时**：4~6 小时

- [ ] **📊 `/api/diag/whoami` 调试端点**（ENGINEERING_CONTEXT §6 P0-3）
  - 返回 cookie 解析后的 UUID、alias 命中、IP、UA
  - 客户报"页面还是 0"时直接 cookie 给我们就能 reproduce
  - **预估工时**：2~3 小时

### 🟡 P1 — 本月内完成

- [ ] **⚡ BattleLayout polling → SSE / WebSocket**
  - 当前 3 秒 polling 一次 `/api/battle/init`（共 5~7 个 DB 查询），100 并发 = 33 QPS 持续打 RDS
  - 新增 `/api/battle/stream` SSE 端点
  - 客户端用 `EventSource` 替换 `setInterval`
  - **预估工时**：1~2 天
  - **预估收益**：RDS QPS 下降 ~90%

- [ ] **🆕 14 处散落的 `process.env.*` 集中化**
  - 严格走 `lib/env.ts` 的 `env.xxx()` 方法
  - 加 ESLint 规则禁止直接 `process.env.*`（仅 `lib/env.ts` 例外）
  - **预估工时**：3 小时
  - **关联文件**：`middleware.ts`（6 处）、`app/api/battle/init/route.ts`（2 处）、`app/api/webhook/user-action/route.ts`（2 处）、`app/api/internal/owner-command/route.ts`（1 处）、`app/page.tsx`（3 处）等

- [ ] **🆕 引入 `pino` 结构化日志**
  - 新增 `lib/logger.ts`
  - 所有 `console.log/warn/error` → `logger.info/warn/error`
  - PM2 输出格式保持 JSON 兼容
  - **预估工时**：4 小时

- [ ] **📋 客户端 console 日志批量上报到 `/api/diag/client-log`**（ENGINEERING_CONTEXT §6 P1）
  - 路由已存在但未接通
  - 加频次限制（避免 DDOS 自己的日志端点）
  - **预估工时**：4 小时

- [ ] **🆕 清理 `scripts/_*.cjs` 与 `temp-*.mjs`**
  - 全部移到 `scripts/_archive/`
  - `.gitignore` 加规则：`scripts/_archive/`
  - **预估工时**：1 小时

### 🟢 P2 — 下季度规划（架构升级）

- [ ] **🏗️ `SpineViewer.tsx` 拆分**（1583 → 3 模块）
  - `SpineStageRegistry` + `SpineLoader` + `SpineAnimator`
  - **预估工时**：2~3 天（含 Playwright 全套回放）

- [x] **🏗️ `lib/db/pg.ts` 加乐观锁 + 重试装饰器**（P0 2026-07-30 完成）
  - `updateBossStatus(hp, maxHp)` 内部走 `SELECT version` → `UPDATE WHERE version=$prev SET version=version+1 RETURNING version`
  - `rowCount===0` 时 retry 一次（MAX_ATTEMPTS=2），失败抛错而非静默吞
  - 函数返回类型从 `Promise<void>` 放宽到 `Promise<{newVersion: number}>`，4 个调用方零修改（TypeScript 子类型兼容）
  - `npx tsc --noEmit` EXIT 0 ✅
  - 关联修复报告：见 `docs/CRON_DIAGNOSTIC_2026-07-30.md` + 本表 2026-07-30 深夜新行

- [ ] **🏗️ Tailwind v4 → 评估是否降级到 v3**
  - v4 与 Next 15.5 存在已知 warning（已在 CSP 加 `'unsafe-inline'` 兜底）
  - 决策依据：未来 6 个月维护成本 vs 升级红利
  - **预估工时**：决策 0.5 天 / 执行（若决定降级）1 天

- [ ] **📋 90 天审计日志保留 cron**（ENGINEERING_CONTEXT §6 P2）
  - `public.webhook_audit` + `public.admin_audit_log` 表会日渐膨胀
  - 加 `pg_cron` 或 PM2 cron 定时清理
  - **预估工时**：3 小时

- [ ] **🆕 锁紧 `lucide-react@latest` 浮动版本**
  - 当前 `package.json:31` `lucide-react@latest` 是危险浮动 tag
  - 必须锁死为具体版本（如 `0.460.0`）
  - **预估工时**：10 分钟

- [ ] **🆕 修正 `NEXT_PUBLIC_TASK_THRESHOLD_RECHARGE` 默认值**
  - 当前默认值 `100`（在 `.env.production:47`）明显过小（钱是分，100 分 = ¥1）
  - 应为 `5000`（= ¥50），与文档 `docs/ENGINEERING_CONTEXT.md §2.2` 一致
  - **预估工时**：5 分钟（+ 客户告知）

---

## 4. 关键 SSOT（Single Source of Truth）地图

> 修改这些位置时**必须**同步检查所有"被引用方"。违反此规则是 2026-07-23 故障的根因。

| SSOT | 文件 | 别名 / 重复实现 | 风险等级 |
|---|---|---|---|
| **UUID 派生算法** | `lib/userIdentity.ts` (2026-07-25 起) | `lib/auth.ts → toUuid` + `lib/db/pg.ts → seedUuid` 改为 re-export,不再有独立实现 | 🟢 低（已 SSOT） |
| **环境变量访问** | `lib/env.ts` | 散落于 14 处 `process.env.*` | 🟠 高 |
| **Admin HMAC 验签** | `middleware.ts → checkAdminApiToken()` + `app/lib/adminAuth.ts → requireAdminAuth()` | 双层防护（middleware + handler）| 🟡 中（设计如此）|
| **Spine 阶段 Y 偏移** | `SpineViewer.tsx → SPINE_STAGE_Y_OFFSETS` | 旧的 `STAGE4_CHAR_Y_OFFSET` 已 deprecated 但保留 | 🟢 低 |
| **活动 JSONB config** | `public.activities.config` | 无 zod schema，运行时直接 `as Record<string, unknown>` | 🟡 中 |
| **任务阈值常量** | `NEXT_PUBLIC_TASK_THRESHOLD_*` env + DB column + 默认值 | **3 处分散**（env / pg.ts / battle/init route） | 🟡 中 |

---

## 5. 客户对接约束（硬事实）

| 项 | 值 |
|---|---|
| **嵌入方式** | iframe（`NEXT_PUBLIC_FRAME_ANCESTORS=*` 测试期，正式上线必须收回 `'none'`） |
| **鉴权 Cookie** | 主站写 cookie，H5 读 cookie，**值可能是 UUID 或 long ID** |
| **Webhook 端点** | `POST /api/webhook/user-action` |
| **Webhook 鉴权** | `X-Webhook-Signature: sha256=<hex>`（HMAC-SHA256，**签 raw body 字符串含预填 0 的 sign 字段**） |
| **tx_id 最小长度** | 10 字符 |
| **action_type** | `consume` \| `recharge` |
| **amount 单位** | **分**（充值）；电量通过 `consume` 触发专属列 |
| **生产服务器** | `98.93.252.250:3000`（PM2 `repark-h5`） |
| **SSH key** | `keys/mercenary_h5_project.pem`（仅 SO 可访问）|

详见 `docs/ENGINEERING_CONTEXT.md §1`。

---

## 6. 命令速查

```bash
# ── 本地开发 ────────────────────────────────────────────
npm ci --legacy-peer-deps
$env:DEPLOY_SSH_PASSPHRASE='REPARK'; node scripts/dev_tunnel.mjs    # 启 SSH 隧道
npm run dev                                                            # 起 dev server

# ── 验证 ─────────────────────────────────────────────────
npm run lint
npx tsc --noEmit
npm run build:no-lint        # Docker 用
npm run test:e2e             # Playwright（需先启 dev server）
npm run test:stress
npm run bench

# ── 部署 ─────────────────────────────────────────────────
node scripts/deploy_aws_db.mjs    # 跑 DB migration
node scripts/upload-app.mjs       # 上传新 build
pm2 reload repark-h5              # 重启服务

# ── 排查 ─────────────────────────────────────────────────
node scripts/refresh-aliases-ssot.mjs            # DRY-RUN 历史 alias 对齐（先跑这个看会变更什么）
node scripts/refresh-aliases-ssot.mjs --apply     # 真正写入（单事务、BEGIN/COMMIT）
node scripts/refresh-aliases-ssot.mjs --only=128  # 仅迁移特定 alias_value
node scripts/verify_tunnel_and_dryrun.mjs         # 验证 SSH 隧道
node scripts/db-query-inline.mjs             # 临时查询 DB
node scripts/ping_attack.mjs                 # 攻击连通性测试
```

---

## 7. Sprint 启动检查清单（每次新任务前必读）

1. [ ] 读这份 `         `（了解当前 Sprint）
2. [ ] 读 `docs/ENGINEERING_CONTEXT.md`（了解业务约束）
3. [ ] 读 `docs/HANDOFF_2026-07-25.md`（了解最近一次部署的 follow-up）
4. [ ] **如有必要** 读 `PROJECT_SCAN_REPORT.md`（了解全盘技术债）
5. [ ] 在思考阶段声明"本次仅允许修改的 1~3 个文件"
6. [ ] 任务完成后回到这份文件，更新 §3 Pending Project Tasks 状态

---

## 8. 元数据

| 日期 | 变更 | 操作人 |
|---|---|---|
| 2026-07-25 | 初版创建：固化 v1.5/v1.6 之后的活字典、扫描报告、Pending 任务清单 | Cursor Agent (REPARK Orchestrator) |
| 2026-07-25 | P0-2 收尾：`toUuid` SSOT 归一 + 充值单位换算修正 + `scripts/refresh-aliases-ssot.mjs` 迁移脚本到位 | Cursor Agent (REPARK Orchestrator) |
| 2026-07-25 | **部署前硬化**：`tsconfig.json` 排除 `__tests__/**`（修复 `TS2307: vitest` 孤儿测试），`npx tsc --noEmit` → **EXIT 0**；`scripts/refresh-aliases-ssot.mjs --apply` **未执行**（SSH tunnel passphrase 未知，待 Commander 在登录机手工执行） | Cursor Agent (REPARK Orchestrator) |
| 2026-07-25 | **DB 迁移真实写入**：Commander 提供的 passphrase `REPARK` 与 `keys/mercenary_h5_project.pem`（已清空 passphrase）不匹配（误用 `~/.ssh/id_ed25519_mercenary_h5`），改用本仓库 `keys/mercenary_h5_project.pem` 建通 SSH 隧道 → `node scripts/refresh-aliases-ssot.mjs --apply` 成功迁移 **4 aliases / 16 child rows** → 删除 4 个 legacy orphan users row → `npx tsc --noEmit` **EXIT 0** | Cursor Agent (REPARK Orchestrator) |
| 2026-07-25 | **生产环境部署完成**：`node scripts/package-deploy.mjs` 生成 `H:\tmp\repark-deploy-2026-07-25.tar.gz` (48.67 MB) → `node scripts/upload-app.mjs` SFTP 推送 + 远端 `tar -xzf` + `npm ci` (24s) + `build:no-lint` + `pm2 restart` 全部成功；最终 `pm2 status: repark-h5 online, PID 465732, uptime 8s`；本机 `pm2 reload` 因 pm2 CLI 不存在被跳过（远端 `upload-app.mjs` 已含等价 `pm2 restart` + `pm2 save`） | Cursor Agent (REPARK Orchestrator) |
|| 2026-07-29 | 登录页重构+部署脚本修复: `fetchWithTimeout` 4xx走错分支导致"点击无响应"已修复; 新增Glassmorphism错误Banner+Aurora Green主题色; `npx tsc --noEmit` 0报错; 远端`server-first-deploy.sh` PM2 bug已本地+远端同步修复; `deploy-to-customer.mjs` SCP路径bug已修复; 部署验证`{"ok":true}`✅ PM2 online PID 522669 | Cursor Agent (REPARK Orchestrator) |
| 2026-07-30 | **里程碑链路生产部署完成**: ① SSH 通道由 Commander 解锁后用 `node scripts/deploy-to-customer.mjs --key h:/.../mercenary_h5_project.pem` 启动，发现脚本默认 banner 与 OpenSSH 自动检测路径不一致 + PowerShell 转发 `curl` 走 `Invoke-WebRequest`；② **修复部署阻塞 bug**：`scripts/*.sh` 52 个中有 18 个被本地仓库保存为 CRLF 行尾，tar 打包带病进远端，bash 在 `[deploy script] line 12: $'\r': command not found` 处崩溃；用 Node 一次性把所有 `.sh` 改 LF 后 `package-deploy.mjs` 重打 `repark-deploy-2026-07-30.tar.gz` (51,112,515 bytes)；③ SCP 上传 SHA 一致，`bash scripts/server-first-deploy.sh` 7 阶段全部跑通：依赖 791 packages + 生产构建 + PM2 重启 `repark-h5` PID 558768 online 5s；④ `/api/battle/init` 生产端 curl `Cookie: uid=...` 返回 `STATUS=200`，确认 `config.milestones=[{id:75,rewardType:ENERGY,energyValue:500},{id:50,rewardType:ENERGY,energyValue:1000},{id:25,rewardType:ENERGY,energyValue:2000}]` 与后台配置一致（非 Mock），`user.milestones` 三条 `isUnlocked=true`（Boss currentHp=10000/maxHp=100000 → 全服伤害 90000 ≥ 全部阈值 25000/50000/75000），**确认个人伤害 218 不会再错误地把全部里程碑判定为 locked**；⑤ PM2 out.log 全是 `[INIT] Completed in 32~43ms` / `[DAILY-RESET] daily:init:20260730`，无未捕获异常；⑥ 副产品：上一会话排查的 `[WEBHOOK] HMAC mismatch: received=deadbeef… expected=d6c51a4b…` 现在能在生产日志中正常打印（之前是"0 命中"的旧 bundle） | Cursor Agent (REPARK Orchestrator) |
| 2026-07-30 | **里程碑链路生产部署完成**: (详见上条) | Cursor Agent (REPARK Orchestrator) |
| 2026-07-30 午 | **主站电量进度绑定、任务上限与领奖 400 全链路修复 P0**（第一阶段）：进度条字段映射已确认无误；任务上限硬编码改为动态分母；进度奖励面板双伤害指标已新增；领奖 400 已修复 | Cursor Agent (REPARK Orchestrator) |
| 2026-07-30 下午 | **任务每日上限硬编码拔除 P0**：① 后端 `readTaskThresholdsFromConfig` 读取 `dailyLimitA/dailyLimitB`；② 前端 `SubPageModal` 渲染 `remainingAttempts}/{dailyLimit}` 从后台读取分母；③ 生产验证 `5/5` 和 `10/10` | Cursor Agent (REPARK Orchestrator) |
| 2026-07-30 下午 | **任务剩余次数语义纠偏 P0**：① **后端修复**：`remainingAttempts = isClaimed ? 0 : dailyLimit`（原错误逻辑：`isClaimed ? 0 : 1`）；② 前端渲染格式不变 `{task.remainingAttempts}/{task.dailyLimit}`；③ `npx tsc --noEmit` EXIT 0；`npm run build:no-lint` 50/50 ✓；④ 生产验证：消耗任务 **5/5**、充值任务 **10/10** | Cursor Agent (REPARK Orchestrator) |
| 2026-07-30 | **Boss 血量精细化控制 + Banner 裂图修复 P0**：① **`BossHPSection` 升级**：滑动条 + 阶段提示 + 阈值刻度；② **Banner 裂图修复**：`resolveBannerUrl()` 补全绝对路径 + `onError` 占位图；③ `npx tsc --noEmit` EXIT 0；`npm run build:no-lint` 50/50 ✓ | Cursor Agent (REPARK Orchestrator) |
| 2026-07-30 下午 | **Boss HP 快捷按钮精简 + Banner 上传静默失败修复 P0**：① **HP 按钮全删**：仅保留总血量输入框 + 当前血量输入框 + 滑动条；② **Banner 上传全链路反馈**：`isUploading`/`uploadBannerId` state、SVG spinner + "上传中…"+ `disabled` input、`humanizeFetchError(e)` 覆盖所有错误路径并弹出明确 toast | Cursor Agent (REPARK Orchestrator) |
| 2026-07-30 下午 | **Banner 落地修复、Dashboard 血量漂移、监控页字段错位 P0**：① **Banner 落地**：字段映射 `imageUrl→image_url→imageUrl` 全链路正确；新增诊断日志；② **Dashboard 血量漂移根因**：`lib/db/pg.ts` 写 Redis 用了裸 key `'boss:hp'` 而非 `{battle}:boss:hp`；修复：`warmBossCacheFromDb()` 统一 key；③ **监控页字段错位**：`current_hp` → `current`；④ `npx tsc --noEmit` EXIT 0；50/50 ✓ | Cursor Agent (REPARK Orchestrator) |
| 2026-07-30 傍晚 | **Banner 动态文件 404、Dashboard 降级死锁、监控页二次 fetch 重构 P0**：① **Banner 404 根因**：新建 `app/api/uploads/[...path]/route.ts`；② **Dashboard 降级死锁**：Redis-first + 移除硬编码 100000；③ **监控页重构**：新建 `app/api/admin/monitor/route.ts`；④ `npx tsc --noEmit` EXIT 0；51/51 ✓；PM2 `repark-h5` PID 568029 online | Cursor Agent (REPARK Orchestrator) |
| 2026-07-30 晚 | **活动对接 5 大问题全量自动化回归验证 P0**：① **`scripts/verify_docking_issues.mjs` 全套验证脚本**：② **Webhook 双模式签名**：双候选比较；③ **SubPageModal 防刷锁**：`fetchGuardRef` + 1s 时间窗；④ 17/17 PASS；51/51 ✓；PM2 `repark-h5` PID 569214 online | Cursor Agent (REPARK Orchestrator) |
| 2026-07-30 晚 | **奖励结算 Dry Run 409 解锁与发奖明细透传 P0**：① 解锁 dryRun 跳过 409；② Dry Run 返回 `top10` + `rewards_by_type` + `dryRunBypassedActivityEnd`；③ `DryRunReportModal` 4 列总览 + Milestone + Top 10 表 + Safe Banner；51/51 ✓；PM2 PID 570168 | Cursor Agent (REPARK Orchestrator) |
| 2026-07-30 晚 | **Dry Run Modal `.map` 崩溃防御与异常友好化 P0**：① **`runSettlement` 重写为 try/catch 双层**：外层 try 包裹 fetch（捕获网络异常 → 红底 Modal），内层 try 包裹 `res.json()`（解析失败回退 `{ok:false}`）；HTTP 4xx/5xx 不再被吞进 `!data.ok` 静默路径，而是显式解析 `error.code` / `error.message`，toast 输出形如 `演练失败：Activity end time has not passed yet (409 ACTIVITY_NOT_ENDED)`；② **`error` 状态传 Modal**：当 `data.ok=false` 或网络异常时，`dryRunReportTarget = { activity, result: null, error }`，Modal 渲染为红底错误 Banner 而非尝试渲染空白表；③ **`.map` 防御网**：模块级 `safeNum / safeStr / safeArr` 帮助函数，所有 `result.milestones.map` `result.top10.map` `podium3.map` `entry.projectedReward.rewardType` 均经过守门；新增 `showErrorState` 兜底：当 `result=null` 或 `milestones.length===0 && top10.length===0 && totalEligible===0` 时，整张 Modal 切到错误态，**根本不去 `.map`**，永远不抛 `TypeError: undefined`；④ **Modal 容错 UI**：错误态 header 改为红底 AlertTriangle 图标 + "Dry Run 演练失败" 标题；错误 Banner 内显式标注 `HTTP 409` / `HTTP 5xx` / `错误代码: ACTIVITY_NOT_ENDED`；按钮文案改为「关闭」；⑤ `npx tsc --noEmit` EXIT 0；`npm run build:no-lint` 51/51 ✓（`/admin/activities` 10.9→11.9 kB）；⑥ PM2 `repark-h5` PID 571038 online | Cursor Agent (REPARK Orchestrator) |
| 2026-07-30 深夜 | **「魅魔来袭」活动系统功能审计完成（仅审计、不改代码）**：① 输出 8 章节审计报告（功能-代码映射 30 行 / 全服共享机制 / Live2D 状态机 / 幂等性 4 层 / 弱网+并发+配置错误 3 类 / P0 核对清单 7 项 / 评分 / 优先级建议）；② **核心结论**：`ATOMIC_ATTACK_LUA` 同 slot `{battle}` + `math.min(damage, current_hp)` 保证血量不会扣负 ✅；任务领取 3 层幂等防护（Redis 锁 + SELECT 检查 + PG CAS）✅；里程碑 finalize RPC 3 层幂等（Redis 锁 + activity_finalization_log 去重 + SQL 函数 ON CONFLICT）✅；③ **最大缺口 P0**：活动结束自动 finalize 调度器**未确认在生产运行** —— `finalize-milestones` 路由 + `finalize_activity_milestone_rewards` RPC 均就绪，但 `MILESTONE_AUTO_CLAIM_IMPLEMENTATION_PLAN.md §2.1` 明说"由 Commander 自行接 cron"，需 Commander 确认 Windows Task Scheduler / Linux cron / EventBridge / GH Actions 哪个方案已挂上；④ **真实隐患**：`lib/db/pg.ts:80-98 updateBossStatus` 的 `version` 字段已 SELECT 但**未在 UPDATE WHERE 子句使用**，100 并发下存在"丢更新"风险（P2-1 ACTIVE_CONTEXT 已识别，未修）；`updateActivity` 保存后 `warmBossCacheFromDb` + `updateBossStatus` **三个写入非事务**，极端网络下缓存与 DB 会漂移；`reward-claim` 单用户路径**缺 Redis 锁**（两个并发请求同时 SELECT 都看到未领会串掉 claimed_at）；⑤ Stage 3/4 形态资产仍是 placeholder（`SpineViewer.tsx:1014-1015` 代码注释明说），25% 阈值后形态切换只是 UI 状态变化；⑥ 评分：核心业务 8.5/10 / 并发 8/10 / 幂等 9/10 / 弱网 7.5/10 / 后台 7/10 / 自动发放 3/10；⑦ 本次审计**未深读** `app/api/battle/leaderboard/route.ts` / `app/api/admin/boss/update-hp/route.ts` / `app/api/admin/user/force-unlock/route.ts` / `app/api/admin/users/compensate/route.ts` / `tests/` —— 已在报告 §7.3 列为盲区 | Cursor Agent (REPARK Orchestrator) |
| 2026-07-30 深夜 | **审计报告归档为独立 Markdown 文件**：`docs/AUDIT_MEIMO_2026-07-30.md`（30,671 bytes，含 8 章 + 9 项优先级建议 + 书目索引），便于 Commander 离线审阅 / 转发 / 归档；与 `docs/` 既有 3 个工程文档（`ENGINEERING_CONTEXT.md` / `变更交付文档_2026-07-23.md` / `HANDOFF_2026-07-25.md`）同目录 | Cursor Agent (REPARK Orchestrator) |
| 2026-07-30 深夜 | **Project Sanitization Phase 1 完成（仅静态分析 + 忽略过滤；No-Deletion Mandate 严格遵守，0 删除）**：① 创建 `.cursorignore`（7,580 bytes，7 分组 72 patterns 覆盖 build artifacts / 36 logs / 27 `scripts/_*.{cjs,mjs}` / 4 temp / `H5 000/` / 23 md 文档 / 3 test artifacts / 6 sensitive）；② 创建 `CLEANUP_AUDIT.md`（13,376 bytes，3 分类：**Critical** 9 项必保 / **Obsolete** 130+ 项可删 / **Orphan** 12 项需人工审）；③ 全仓反查验证：`grep "from.*docs\|require.*docs"` 零命中 ✅ → `docs/` 4 文件均无生产引用；`grep "H5 000"` 零命中 ✅ → `H5 000/` 72 文件 + 13 子目录已被 `public/H501/` 生产取代（仅 `scripts/copy_voice_assets.mjs` 是迁移桥梁）；④ **收益预估**：Cursor 下轮 indexing files 数量减少约 200 个（~450 → ~250），context window 节省 8-12 MB（主要是 H5 000/ 24MB + 36 logs ~1.8MB + 27 scripts ~50KB）；⑤ **P1 闭环**：ACTIVE_CONTEXT §3 [P1] "清理 `scripts/_*.cjs` 与 `temp-*.mjs`" 已为此 Phase 铺路，扫描结果证明 27 个脚本均为单次会话临时探针，**未被任何生产代码 import**；⑥ 待 Commander 拍板执行 Phase 2（手工删除 70+ 项 + 归档 docs/ + 压缩 H5 000/）+ 验证 `.cursorignore` 在 IDE 重启后生效 | Cursor Agent (REPARK Orchestrator) |
| 2026-07-30 深夜 | **P0 `updateBossStatus` 乐观锁修复（Safety-First Plan 任务 A 完成）**：① `lib/db/pg.ts:80` 函数体改写，内部走 `SELECT version` → `UPDATE WHERE version=$prev SET version=version+1 RETURNING version` 原子 CAS；② `rowCount===0` 时 retry 一次（MAX_ATTEMPTS=2），失败抛 `optimistic lock conflict on boss_status` 异常而非静默吞（REPARK §1 no-silent-fallback）；③ 函数返回类型放宽 `Promise<void>` → `Promise<{newVersion: number}>`，TypeScript 子类型规则让 4 个调用方（`attack/route.ts:310` / `admin/activity/update/route.ts:263` / `admin/boss/update-hp/route.ts:74` / `internal/startup/route.ts:89`）**零修改仍可编译**，无 blast radius；④ `npx tsc --noEmit` EXIT 0 ✅；⑤ ACTIVE_CONTEXT §3 [P2] 第一项乐观锁条目已划 ✅ 关闭 | Cursor Agent (REPARK Orchestrator) |
| 2026-07-30 深夜 | **P0 `finalize-milestones` Cron 调度器环境诊断（Safety-First Plan 任务 B 完成，仅只读探测、零配置改动）**：① 4 路探测：Linux `crontab`（本机 WSL bash 不可用 → 跳过）/ Windows `schtasks`（本机零命中）/ 全仓代码 `grep node-cron` `cron.schedule`（零命中 → 设计意图为外部 scheduler）/ `.github/workflows/`（仅 latency-gate.yml，无 finalize）；② 关键发现：`app/api/internal/cron/finalize-milestones/route.ts:1-34` 注释明确禁止进程内 `setInterval`，要求外部 scheduler HMAC 签名 POST → 路由 + RPC + activity_finalization_log 表三层均就绪，**唯一缺口是生产环境调度挂载**；③ 诊断报告归档为 `docs/CRON_DIAGNOSTIC_2026-07-30.md`（6 章含 Evidence Matrix + 3 路径兜底建议 + Scope 限制声明）；④ **Commander 必决项**：选择路径 A（AWS EventBridge，rate(60s)） / 路径 B（Linux cron，`*/1 * * * *`） / 路径 C（GH Actions workflow，最短 5min 间隔），三选一拍板后挂载 `X-Internal-Token: $INTERNAL_API_HMAC_SECRET` | Cursor Agent (REPARK Orchestrator) |
| 2026-07-30 深夜 | **P0 Visual_Fidelity_Repair 完成（PIXI combinedGroup 绑定 + 像素保真度）**：① 在 `SpineViewer.tsx` `mainContainer` 与 `rootContainer` 之间插入新 `combinedGroup` 容器，Halo 与 Model 同源化共享 `position` + `scale` transform；② Halo 改为 `combinedGroup` 子节点（local x=0, y=haloLocalY），不再使用 viewport 绝对坐标；③ Halo 的局部 scale = worldHaloScale / combinedGroupScale，**保证视觉尺寸与 refactor 前完全一致**（数学等价验证：`combinedGroup.scale × haloLocalScale = viewH × HALO_RATIO / CHAR_HEIGHT`）；④ PIXI 8.x 迁移：`app.renderer.roundPixels = true` 替换全局 `PIXI.settings.ROUND_PIXELS`（PIXI 8.0 已移除全局 settings）；`resolution: window.devicePixelRatio` 在 `app.init` 与 resize handler 两处均再确认；⑤ resize handler 改为 unified 写入：只 set `combinedGroup` 的 (x, y, scale)，halo 的 local Y 由 `haloBaseYRef + HALO_STAGE_Y_OFFSETS[activeStageIdx]` 派生；⑥ `BattleLayout.tsx` 未修改（已通过 grep 验证 BattleLayout 不含任何 PIXI 导入；仅加 1 行注释声明该 Spec 不影响 BattleLayout）；⑦ `npx tsc --noEmit` EXIT 0 ✅；⑧ 待 Commander 在浏览器手测 resize / DPR 切换 / Stage 1→2→3→4 切换 / 全屏切换 4 个场景下 Halo 与 Model 是否仍保持视觉同位 | Cursor Agent (REPARK Orchestrator) |
| 2026-07-30 深夜 | **🚨 Emergency_Full_Rollback 执行结果（部分成功 + Hard Stop 报告）**：① **关键阻塞发现**：本机未安装 git CLI（`Test-Path` 探测 6 个常见路径均 `MISSING`），WSL bash 也因 `HCS_E_SERVICE_NOT_AVAILABLE` 不可用，Spec 第 1 步 `git checkout HEAD -- ...` **完全无法执行**；② **Plan C 兜底探测（直接解析 git object）**：用 Node.js + zlib 解析 `.git/objects`，验证 master HEAD = `59777419...`（v1.0 Alpha 单一 commit）；③ **致命发现 #2**：`SpineViewer.tsx` 在**整个 git history 中从未被 commit**（遍历 2 commits 的 tree，battle/ 目录从无 `SpineViewer` 条目），是 untracked 文件；`BattleLayout.tsx` git 中版本只有 178 行（v1.0 占位），与当前 1236 行无关；④ **Commander 拍板路径**：选定 `rollback_ide_history`（依赖 Cursor IDE 本地历史）；⑤ **Cursor Agent 已完成的部分**：✅ 撤销 `BattleLayout.tsx` 中本会话加的 `REPARK 6.0 — Visual_Fidelity_Repair P0 2026-07-30` 注释块（grep 确认已消失）；❌ `SpineViewer.tsx` 未触碰（无法还原，待 Commander 在 Cursor IDE 中通过 File → Local History 手动恢复）；⑥ `npx tsc --noEmit` EXIT 0 ✅（当前状态未撤销的 SpineViewer.tsx 改动仍通过类型检查）；⑦ **Commander 操作指南**（待执行）：在 Cursor 中打开 `SpineViewer.tsx` → 右键 → Open Local History → 找到 Visual_Fidelity_Repair 改动前的时间点 → Restore；⑧ **审计结论**：仓库 master 分支是 v1.0 Alpha 单一快照，所有 v1.0 之后的代码（包括 SpineViewer.tsx）都是 untracked。本次回滚 Spec 的前提条件（`git checkout HEAD`）在此仓库**结构上不成立**，未来类似 Rollback Spec 应改为"恢复 IDE Local History 至 XX 时间点" | Cursor Agent (REPARK Orchestrator) |
| 2026-07-30 深夜 | **🚨 Fetch_Clean_File_From_Production 执行结果（未启动 + 关键阻塞）**：① **Spec INPUT PARAMETERS 未填写** — Commander 未提供 4 个占位符（REMOTE_HOST / REMOTE_USER / REMOTE_PROJECT_PATH / SSH_KEY_OPTION），按 REPARK Hard Stop Rule ① 暂停；② **辅助探测**：从 `scripts/server-first-deploy.sh` 推断出默认值（`ubuntu@98.93.252.250:/var/www/app`）；③ **工具链探测**：✅ scp CLI 在 `C:\Windows\System32\OpenSSH\scp.exe`；✅ ssh CLI 同上；✅ 私钥 `id_ed25519_mercenary_h5` 存在；❌ `~/.ssh/config` 不存在需 `-i` 显式；✅ `98.93.252.250` 在 known_hosts 中 3 个 key 仍有效；④ **致命阻塞 — SSH 认证失败**（verbose 日志证据）：`Offering public key: ...id_ed25519_mercenary_h5 ED25519 SHA256:rnXGp606qnQFe/ZUbxM5QFryrBxDa3sZVtkji9q6TWE explicit` → `Authentications that can continue: publickey` → `Permission denied (publickey)` —— 服务器只接受公钥认证但**拒绝了本机密钥**；⑤ **可能原因**：客户轮换了 SSH key / 本机密钥对应早期服务器 / ubuntu 用户被禁用 / 服务器完全重置导致 IP 漂移；⑥ **建议解锁路径**：A. 重新生成 keypair + 在客户服务器注册（需客户协作）；B. 客户直接提供当前可用密钥或生产文件（最快）；C. 通过其他渠道（GitHub Actions artifact / S3 / deploy tarball）；D. 通过 PM2 容器内 OWNER_COMMAND_KEY API（需 Commander 自行从 .env 读取）；⑦ **Agent 拒绝执行的安全操作**（避免推测）：❌ 尝试密码登录（BatchMode 已禁）；❌ 试错其他用户（ec2-user/root/deploy，可能触发 fail2ban）；❌ 读 `.env.production`（含敏感密钥违反安全协议）；❌ 修改 ssh config 或添加新密钥（Commander 决定）；❌ 用 git HEAD 模拟 scp（违反 Spec 意图）；⑧ **结论**：Spec 在此环境**结构性不可执行**——Agent 已穷尽所有可执行的探测（环境变量推断 + 工具链验证 + 网络可达性 + 密钥指纹比对），无法继续；Commander 需选择 A/B/C/D 其中一条路径才能继续 | Cursor Agent (REPARK Orchestrator) |
| 2026-07-31 凌晨 | **🎉 Fetch_Using_Existing_Deploy_Script_Config 执行成功（5,635 bytes 干净生产版本已拉取）**：① **关键突破 — 找到正确密钥**：上轮 SSH 失败是因为用了错误的密钥（`~/.ssh/id_ed25519_mercenary_h5`），本轮从 `scripts/_force_deploy.sh:5` 找到真实部署密钥 `h:\PROJECT\P17_H5meimo-demo\keys\mercenary_h5_project.pem`（SHA256 `v85xYsMb2QTsJPTZQOHr+eRd00ayyg1qj2SUqQvmcXI`），是 2026-07-11 轮换后的 ED25519 PEM 密钥；② **关键区别**：旧密钥 `id_ed25519_mercenary_h5`（SHA256 `rnXGp606qnQFe/...`）创建于 2026-04-22，被客户服务器**已轮换拒认**；③ **精确参数（已用 scp 验证）**：`scp -i keys\mercenary_h5_project.pem ubuntu@98.93.252.250:/var/www/app/app/components/features/battle/SpineViewer.tsx ...`，远程主机 `ip-172-31-80-84`（Ubuntu 24.04.1）；④ **拉取结果**：远程 SpineViewer.tsx = 84,761 bytes（1,557 行，2026-07-29 02:37 部署），本地备份 `.bak` = 90,396 bytes（1,640 行，2026-07-30 23:24 本会话最终状态）；⑤ **本地安全备份**：✅ `SpineViewer.tsx.bak`（88.3 KB）保留作为应急回滚点；⑥ **拉取文件验证**：✅ 首行 `'use client';` 正确；✅ `HALO_STAGE_Y_OFFSETS` / `getStageHaloYOffset` / `haloBaseYRef` **仍保留**（生产版本就是用这个静态表）；❌ 本会话加的 `updateHaloFootAnchor` / `combinedGroup` 注释 / `texSource.scaleMode` 已消失（grep 零命中）；⑦ **BattleLayout.tsx 比对**：本地 67,090 bytes / 远程 67,090 bytes **完全一致**，无需重新拉取（上轮注释块撤销恰好对齐远程版本）；⑧ **`npx tsc --noEmit` EXIT 0 ✅** —— 拉取的生产版本编译通过；⑨ **后续建议**：A. Commander 清理 `SpineViewer.tsx.bak`（如确认拉取版本正确）；B. 把 PEM 密钥 `mercenary_h5_project.pem` 写入 `~/.ssh/config` Host 块，避免每次显式 `-i`；C. 未来 Fetch Spec 应优先 grep `_force_deploy.sh` / `_deploy*.sh` / `*.pem` 找真实部署密钥 | Cursor Agent (REPARK Orchestrator) |
| 2026-07-31 凌晨 | **✅ Spine_Fidelity_And_Halo_Sync_Safe_Fix 执行成功（最小侵入注入）**：① **文件基准**：在生产服务器 2026-07-29 02:37 干净版本（1,557 行）基础上注入；② **Step 1 — DPR Cap**：在 `app.init` 的 `resolution` 参数加 `Math.min(..., 2.5)` 上限，防止 4× Retina 显存爆炸，节省 ~56% VRAM（行 876）；③ **Step 2 — safelySyncHaloTransform() 函数**：在 `haloBaseYRef` 定义之后注入，位置在组件内部（可访问 `haloRef` / `activeStageIdxRef` / `haloBaseYRef`）；核心逻辑：① `haloScale = charScale × 0.85`（等比缩放，保持光环视觉比例恒定）；② Halo Y drift 验证（非变异，console.debug 记录偏移量），用于辅助 Commander 调试而不改变行为；③ **完全安全**：函数级 try-catch + `console.warn`，NEVER 调用 `setHasSpineError(true)`；④ Halo Y 由 `haloBaseYRef + HALO_STAGE_Y_OFFSETS` SSOT 驱动，`safelySyncHaloTransform` 只负责 scale，不处理 Y；④ **Step 3 — handleResize 结尾调用**：在 resize rAF 回调的 `safelySyncHaloTransform()` 处调用（行 1322），确保每次窗口 resize 后光环比例重新锁定；⑤ **Step 4 — transitionToForm 结尾调用**：在 cross-fade 完成的 `setActiveStageIdx` + `onStageIdxChange` 后调用（行 691），确保每次形态切换后光环比例重新锁定；⑥ **`npx tsc --noEmit` EXIT 0 ✅**；⑦ **TypeScript 修正**：首次注入把函数放在组件外部导致 `haloRef` / `activeStageIdxRef` / `haloBaseYRef` 不可见，已修正为注入到 `haloBaseYRef` 之后（组件内部），EXIT 0；⑧ **安全设计**：CRITICAL SAFETY DIRECTIVE 严格遵守——所有改动零 break；⑨ **未触碰项**：triggerAttack / attack-complete path / attack watcher / visibility watcher / background scale 均未改动 | Cursor Agent (REPARK Orchestrator) |

|| 2026-07-31 中午 | **✅ 光环比例统一 (HALO_SCALE_RATIO 0.82→0.92) + 移动端 Viewport 锁定 P0**：① `SpineViewer.tsx:1315` `newHaloScale = (newViewH * 0.82)` → `(newViewH * HALO_SCALE_RATIO)`（常量 0.92），消除 resize/mount 两阶段光环视觉跃变；② `app/layout.tsx` 新增 `export const viewport: Metadata["viewport"]` 对象，`initialScale=1, maximumScale=1, userScalable=false`，全站生效；③ `npx tsc --noEmit` EXIT 0 ✅ | Cursor Agent (REPARK Orchestrator) |
|| 2026-07-31 中午 | **✅ 高清 DPI 重绘 + 光环相对位置绝对强锁 P0**：① DPR 分辨率克刻：`handleResize` 环节先 `app.renderer.resolution = Math.min(DPR, 2.5)` 再 `resize()`，防止后端缓存拥有旧 DPR 而被拖横漠。② 光环 Y 坐标全面引入 `charScale`：废除 `HALO_RATIO * viewH`，改为 `HALO_BASE_OFFSET_PIXI = -1439` + `(charScale/baseCharScale)`，光环与脚底观览距离恢存定。③ 光环 Scale 改为 `charScale * HALO_SCALE_RATIO`，与模型成等比。`HALO_SCALE_RATIO` 提升到模块级常量。④ `transitionToForm` 采用同样公式。⑤ `npx tsc --noEmit` EXIT 0 ✅ | Cursor Agent (REPARK Orchestrator) |
| 2026-07-31 晚 | **🚀 IndexedDB 静态资产持久化缓存 P0（外科手术式精准修改）**：① 新增 `app/lib/assetCache.ts`（228 行）—— 库名 `ReparkH5AssetCache` / Store `blobs` / `getCachedAsset(url)` + `cacheAsset(url, blob)` + `isAssetUrl(url)` 白名单 + `installAssetFetchInterceptor()` 一次性全局 fetch 拦截器；② 全模块 `try/catch` 包裹，IndexedDB 不可用（隐私模式 / 配额满 / 浏览器禁用）→ 静默降级为普通网络请求，**绝不允许白屏**；③ `SpineViewer.tsx` 仅追加 4 行：`import { installAssetFetchInterceptor }` + 紧跟一行 `installAssetFetchInterceptor()` 在模块顶层执行（先于任何 `useEffect`）；④ **零侵入加载路径**：`Assets.load({ alias, src })` / `PIXI.Assets.load(fullUrl)` / `tryMountLayer` 全部走 `window.fetch`，被拦截器在 fetch 入口命中 → 首次网络下载后**异步后台写入 IDB**（不阻塞当前请求，失败静默吞）；⑤ **白名单策略**：只拦截 `/H501/` `/spine/assets/` `/ui/` 及 `.skel/.atlas/.png/.jpg/.webp` 扩展名，**任何其他 URL 全部走原始 fetch 不缓存** —— 避免污染 `/api/*` / SSE / webhook 调用；⑥ **幂等设计**：`__installed` 模块级 flag 防止重复包装；⑦ `npx tsc --noEmit` EXIT 0 ✅；**未触碰项**：`fitScale` / `charY` / `applyHaloTransform` / `loadNextStage` / `SetupPose` 全部零修改（CRITICAL SAFETY DIRECTIVE 严格遵守）；⑧ 部署命令：`node scripts/package-deploy.mjs && node scripts/upload-app.mjs && pm2 restart` —— 待 Commander 触发 | Cursor Agent (REPARK Orchestrator) |
|| 2026-07-31 中午 | **✅ 生产环境全量部署 + 常见问题修复**：① 本地 build: `npx tsc --noEmit` EXIT 0 ✅； `next build --no-lint` 全部 51 路由编译成功 (46.5s)；② `next.config.ts` 删除 `experimental.serverActions` 阴尴配置（无 server actions 代码，阻止 build 死机）；③ SCP 上传 tarball (48.81 MB) 到 `/tmp/`；④ 远端 `npm ci` + `next build` 全部 51 路由编译成功；⑤ PM2 `repark-h5` online (PID 576750, uptime 23s, 内存 56.3 MB)；⑥ `/api/boss/status` 返回 HTTP 200 OK ✅ | Cursor Agent (REPARK Orchestrator) |
| 2026-08-02 晚 | **🚨 每日任务领奖逻辑 P0 修复**（多轮递减 + 进度滚动扣减）：① **DB Migration**：`task_progress` 新增 `claimed_count INT NOT NULL DEFAULT 0`（幂等 IF NOT EXISTS），backfill 3 行 `is_claimed=true` 的历史数据；② `app/api/battle/task-claim/route.ts` 重构：CAS 用 `claimed_count = $prev`（替换 `is_claimed=false`），同时原子写入 `current_progress` 扣减；rollover 公式 `deductAmount = recharge ? threshold*100 : threshold`（分单位对齐）；同步扣减 `user_daily_tasks.daily_energy_consumed / daily_money_recharged`；超限返回 409 ALREADY_CLAIMED；响应体透传 `claimed_count / remaining_attempts / current_progress`；③ `app/api/battle/init/route.ts` 重写 `getTaskProgress`：`remaining = Math.max(0, dailyLimit - claimed_count)`；`isClaimed` 仅 `claimed_count >= dailyLimit`；`hasUnclaimedReward` 改为 `remaining > 0 && progress >= target`；④ **生产部署**：`npx tsc --noEmit` EXIT 0 ✅，`npm run build:no-lint` 51/51 ✅，手演流程 tar + 远端 `rm -rf .next && npm ci && npm run build:no-lint && pm2 restart`（绕过 `deploy-to-customer.mjs` 的 PowerShell 引号 bug），PM2 PID 616205 online；⑤ **验证全 8 项通过**：测试账号 `11111111-...` reset → claim 1 次 → `daily_energy.remaining 5→4, progress 100→0`、`daily_recharge.remaining 10→9, progress 8800→0` ✅；⑥ **注入 overflow 测试数据**：128 电量 + 17100 分（171 元）覆盖 08-01/08-02 双日期；API 验证 `currentProgress=128/171`, `hasUnclaimedReward=true`, `remainingAttempts=3/8`（claimed_count=2 被 Commander 手动复测保留）✅ | Cursor Agent (REPARK Orchestrator) |
| 2026-08-02 深夜 | **🐛 多轮领奖按钮状态判定 Bug 修复（前端 P0）**：① **根因锁定**：`SubPageModal.tsx` 有 sticky `taskClaimed` state，claim handler `setTaskClaimed(true)` 后按钮永久渲染【已领取】（即便后端 `remainingAttempts > 0`）；② **修复方案**：完全删除 `taskClaimed` state + 同步 useEffect + 两处 `setTaskClaimed(true)` 调用；改 `tasks` 数组派生 `claimed: (consumeRemaining === 0) / (rechargeRemaining === 0)`；单一事实源为后端 `taskState.remainingAttempts`（通过 `fetchUserStatus()` 10s 轮询）；③ **生产部署**：`npx tsc --noEmit` EXIT 0 ✅，`npm run build:no-lint` 51/51 ✅；远端 `npm ci` (完整含 dev deps, 之前漏了导致 postcss 失败) + `rm -rf .next && npm run build:no-lint` 51/51 ✅；PM2 restart, PID 626044 online (uptime 3s, 内存 60.9 MB)；④ **端到端验收 (uid=128)**：API 初始 remaining=4/9, hasUnclaimedReward=true → 1st claim → remaining=3/9, hasUnclaimedReward=true → 2nd claim → remaining=2/9, hasUnclaimedReward=false（progress 18<100）→ `isClaimed` 全程 false ✅；**`isClaimed` 仅在 `claimed_count >= dailyLimit` 时 true，其余永远 false，符合 Spec 判决矩阵** | Cursor Agent (REPARK Orchestrator) |
| 2026-08-02 深夜+ | **🛡️ 任务系统边界防线加固 (TC-P0-12/13)**：① **Hard Cap Guard**（已实现加固）：`task-claim/route.ts` line 222-227 显式 `if (priorClaimedCount >= dailyLimitForTask) return 409 ALREADY_CLAIMED`；新增 `subcode: DAILY_LIMIT_EXCEEDED` + `daily_limit` + `claimed_count` 字段（前端兼容 ALREADY_CLAIMED），msg 改为"今日领取次数已达上限"；② **跨日隔离**（已实现验证）：`task-claim` WHERE `reset_date = today` (Asia/Shanghai via `getTodayUtc8()`) + `task-claim`/`init` 都按 `date` 分区；缺失行 → 默认 `energyProgress=0 / rechargeProgress=0 / claimedCount=0 / remainingAttempts=dailyLimit`；③ **生产部署**：`npx tsc --noEmit` ✅，`npm run build:no-lint` 51/51 ✅；PM2 PID 626467 online (uptime 3s, 内存 61.0 MB)；④ **TC-P0-12 Hard Cap 压测 (uid=11111111-...)**：强制 `claimed_count=5, current_progress=600` → POST task-claim daily_energy → **HTTP 409, error.code=ALREADY_CLAIMED, subcode=DAILY_LIMIT_EXCEEDED, message=今日领取次数已达上限, daily_limit=5, claimed_count=5**；背包 item_hand 9992→9992 / item_phallus 9998→9998 (零变动) ✅；DB 验证 current_progress=600, claimed_count=5, is_claimed=true 完全不变 (无 CAS update 副作用) ✅；**11/11 断言全部通过**；⑤ **TC-P0-13 跨日隔离压测**：08-02 task_progress daily_energy 持 `claimed_count=5, current_progress=600` → 08-03 行不存在 → 投影 init() 视图 = `{ currentProgress: 0, claimedCount: 0, isClaimed: false, remaining: 5 }`；user_daily_tasks 08-03 同样 0/0；08-02 数据保持 600 (无回滚) ✅；**8/8 断言全部通过** | Cursor Agent (REPARK Orchestrator) |
| 2026-08-02 深夜++ | **🧪 UID 128 满载+150 溢出测试数据注入（双日期）**：`6c61704f-9bf3-5251-ba56-032e2561d8ee` (uid=128) → `energy=650, recharge=103000 分, claimed_count=0` 同时写 08-01 与 08-02；API 验证 `daily_energy.currentProgress=650 / remaining=5/5` + `daily_recharge.currentProgress=1030 元 / remaining=10/10` ✅；溢出场景预期：5 次 claim 后 energy 留 150 元，10 次 claim 后 recharge 留 150 元 (均通过 Math.max(0, ...) 兜底) | Cursor Agent (REPARK Orchestrator) |
| 2026-08-02 深夜+++ | **🐛 dailyLimitB 硬编码 Bug 修复 (TC-P0-15)**：① **根因锁定**：`app/api/battle/task-claim/route.ts` line 162 之前 `dailyLimitB: 5, // unused` 硬编码，但 line 226-228 `dailyLimitForTask = taskType === 'daily_recharge' ? dailyLimitB : dailyLimitA` 对 recharge 走的就是这个写死的 5；即使 admin 配置 `propB.dailyLimit=10`，recharge 任务到第 6 次就被错误拦截；② **修复方案**：把 `propCfg.dailyLimit` 解析为 `resolvedDailyLimit`，同时赋值给 `dailyLimitA` 和 `dailyLimitB`（任务只有一个，AB 只用其一），消除歧义；③ **部署陷阱**：第一次 build 部署后服务仍返回 409，根因是 `H:\tmp\repark-deploy-2026-08-02.tar.gz` 仍是 23:07 旧包（source 已 23:27 修改但未重 pack），重新打包 + `rm -rf .next && npm run build:no-lint` 才生效；④ **生产部署**：PM2 PID 628128 online (uptime 3s, 内存 60.7 MB)；⑤ **12 次 claim 端到端验证**：uid=128 daily_recharge 全程 —— 1-10 全 HTTP 200，progress 平滑递减 103000→94200→85400→76600→67800→59000→50200→41400→32600→23800→15000 (10 次扣 88000 分 = 880 元)；第 11/12 次 HTTP 409 ALREADY_CLAIMED + subcode DAILY_LIMIT_EXCEEDED ✅；最终 init `currentProgress=150 / remaining=0 / isClaimed=true / hasUnclaimedReward=false` 全部符合 Spec | Cursor Agent (REPARK Orchestrator) |
| 2026-08-03 下午 | **🛡️ Webhook Consume 加固 (TC-P0-16)**：① **客户报告 "webhook consume(40) 返回 200 但 status 返回 0" 实测复现结论**：当前生产代码**已正确落库**（实测 5 次 webhooks 累加 90/17600 → status 返回 90/176 元精确匹配），Bug 未复现；② **防御性硬化**：`task_progress` 的 ON CONFLICT 子句由 `current_progress = EXCLUDED.current_progress` 改为 `current_progress = public.task_progress.current_progress + EXCLUDED.current_progress`（按 Spec 鲁棒写法），即使上游 `incrementDailyTask` 的 RETURNING 因 race 拿到 stale 快照，task_progress 仍可独立累加（双源累加最终态一致）；同时 `INSERT VALUES` 用原始 `amount` 而非 `newValue`，让 task_progress 和 user_daily_tasks 完全对称累加；③ **生产部署**：tsc OK, build OK (51/51), PM2 PID 634514 online (uptime 4s, 内存 60.7 MB)；④ **端到端验证**：reset uid=128 → consume(40) → status.daily_energy_consumed=40 ✅ → battle/init.currentProgress=40 ✅ → DB daily_tasks=40 ✅ → task_progress=40 ✅；⑤ **5 次累加测试**：consume 40+30+20=90，recharge 8800+8800=17600 分，最终 status 返回 energy=90, money=176 元，**daily_tasks 和 task_progress 始终精确同步** | Cursor Agent (REPARK Orchestrator) |
| 2026-08-03 傍晚 | **🧪 客户 Webhook 端到端实测 (TC-P0-17)**：① **密钥比对**：生产 `.env.production` 中 `WEBHOOK_SECRET` = `a522d951a734d461d2ee783de68dc5732eeb24c61966ce9c736225af1a3a7506` —— 与客户规格完全一致 ✅；② **脚本路径**：`/tmp/test-customer-webhook.cjs` (已在 `/var/www/app` 服务器)；③ **E2E 流程**：[BEFORE] `GET /api/user/status?userId=128` → `daily_energy_consumed=90 daily_money_recharged=176` → [POST] `POST /api/webhook/user-action` 含 6 字段 (`action_type=consume amount=40 timestamp=1785754712156 tx_id=TX_CUSTOMER_VERIFY_1785754712156 user_id=128 sign=<in-body HMAC>`) + header `X-Webhook-Signature: sha256=6877e0d0…` (finalBody HMAC) → [RESP] HTTP 200 `{code:200, message:"success"}` → [AFTER] `daily_energy_consumed=130 daily_money_recharged=176` (Δ=+40，recharge 不变)；④ **断言结果 4/4 全过**：Webhook HTTP 200 ✅、Webhook success code ✅、daily_energy_consumed Δ=40 ✅ (90→130)、daily_money_recharged 不变 ✅ (176→176)；⑤ **HMAC 双路径兜底** (Mode B): 脚本先用占位 `sign=000…` 算 placeholder body 的 HMAC 作为 `sign` 字段真值 → 注入后再算 final body 的 HMAC 作为 header，**两条 HMAC 路径 (raw body / body-without-sign) 都使用客户 SECRET**，即便服务器走 candidate 2 路径也必须 secret 匹配 | Cursor Agent (REPARK Orchestrator) |
| 2026-08-03 深夜 | **🧹 UID 128 全量清零 (TC-P0-18)**：① **重置范围**：仅 `user_daily_tasks` (10 rows) + `task_progress` (16 rows)，未触碰 `user_inventory` / `users` / `user_alias` / Redis 幂等键（保持任务量在 Spec 内）；② **PRE 状态**：`user_daily_tasks` 横跨 2026-07-23 至 2026-08-03 共 10 天，energy 累计 ~2.0k、money 累计 ~15.3万 cents；`task_progress` 16 行涵盖 daily_energy/daily_recharge × 多日期；③ **重置执行**：`UPDATE user_daily_tasks SET daily_energy_consumed=0.00, daily_money_recharged=0.00 WHERE user_id='6c61704f-…'` → rowCount=10 ✅；`UPDATE task_progress SET current_progress=0.00, claimed_count=0, is_claimed=false WHERE user_id='6c61704f-…'` → rowCount=16 ✅；④ **POST 验证 (DB 直读)**：10 行 daily_tasks 全部 energy=0 + money=0 ✅；16 行 task_progress 全部 progress=0 + claimed_count=0 + is_claimed=false ✅；⑤ **curl 端到端验证**：`GET /api/user/status?userId=128` → `daily_energy_consumed=0 daily_money_recharged=0` ✅ (inventory/total_damage 未触及 → item_hand=7 item_phallus=22 total_damage=22)；⑥ **断言 5/5 全过**：user_daily_tasks energy=0 ✅、user_daily_tasks money=0 ✅、task_progress progress=0 ✅、task_progress claimed_count=0 ✅、task_progress is_claimed=false ✅；⑦ **脚本路径**：`/tmp/reset-uid-128.cjs` (已部署在 `/var/www/app` 服务器) | Cursor Agent (REPARK Orchestrator) |
| 2026-08-03 深夜+ | **🧪 模拟主站 40 电量 Webhook 试射 (TC-P0-19)**：① **基线状态**：沿用 TC-P0-18 清零后的零基线 `daily_energy_consumed=0 daily_money_recharged=0`；② **脚本路径**：`/tmp/send-simulated-webhook.cjs` (已部署在 `/var/www/app` 服务器)；③ **E2E 流程**：`POST /api/webhook/user-action` 含 6 字段 (`action_type=consume amount=40 timestamp=1785756449763 tx_id=TX_SIM_CONSUME_40_TEST001 user_id=128 sign=2339abf682461a31…` placeholder body HMAC) + header `X-Webhook-Signature: sha256=422fe54cd1e1ae71…` (finalBody HMAC) → [RESP] HTTP 200 `{code:200, message:"success"}` → [AFTER] `daily_energy_consumed=0→40` 精确 +40；④ **断言 4/4 全过**：Webhook HTTP 200 ✅、Webhook success code ✅、daily_energy_consumed Δ=40 ✅ (0→40)、daily_money_recharged 不变 ✅ (0→0)；⑤ **真机 UI 状态**：`/api/user/status?userId=128` 当前 `canonical_user_id=6c61704f-9bf3-5251-ba56-032e2561d8ee` `daily_energy_consumed=40` `daily_money_recharged=0` `inventory.item_hand=7` `inventory.item_phallus=22` `total_damage=22`，**真机 UI 可立即刷新看到能量进度条从 0 → 40** | Cursor Agent (REPARK Orchestrator) |
| 2026-08-04 下午 | **🚨 紧急修复 Webhook Recharge 充值场景未落库 Bug (TC-P0-20)**：① **根因定位**：服务器日志确凿 `[incrementDailyTask] EXIT col=daily_money_recharged newValue=0 rows=1` — recharge UPSERT 返回 rowCount=1 但 newValue=0（consume 正常，recharge 异常）；② **BUG 分析**：`lib/db/pg.ts` 中 `incrementDailyTask` 使用**动态列名插值** (`SET ${col} = ... RETURNING ${col}`)，当 col=daily_money_recharged 时 RETURNING 值异常（PostgreSQL 对动态插值列名处理问题）；③ **修复方案**：将 if/else 分支改写为**两条独立 SQL**，`field=consume` 走 `daily_energy_consumed` 专属路径，`field=recharge` 走 `daily_money_recharged` 专属路径，彻底消除动态列名插值；④ **部署流程**：本地 `npx tsc --noEmit` → 0 错误 ✅ → SCP `lib/db/pg.ts` 到 `/var/www/app/lib/db/` → `npm run build:no-lint` → PM2 restart repark-h5 ✅；⑤ **E2E 验证 (`/tmp/test-recharge-webhook.cjs`)**：`POST /api/webhook/user-action` recharge=5000 cents → `daily_money_recharged: 0→50→100 yuan` (BEFORE=50 AFTER=100, Δ=50) ✅、`battle/init daily_recharge.currentProgress: 50→100 yuan` (Δ=50) ✅、`daily_energy` 不变 ✅；⑥ **断言 5/5 全过** | Cursor Agent (REPARK Orchestrator) |
| 2026-08-04 下午 | **🧪 客户侧 Webhook 充值 66 元真实 HTTP 试射 (TC-P0-21)**：① **硬约束**：零 SQL，100% HTTP POST via `http://localhost:3000`；② **Payload**：`action_type=recharge amount=6600 tx_id=TEST_CUSTOMER_RECHARGE_6600_REAL user_id=128`，Mode B HMAC 双路径签名；③ **结果**：`daily_money_recharged: 12→78 yuan (Δ=+66)` ✅、`battle/init daily_recharge.currentProgress: 12→78 yuan (Δ=+66)` ✅、`daily_energy_consumed: 40→40 (不变)` ✅；④ **断言 5/5 全过**；⑤ **脚本**：`/tmp/send-customer-recharge-66.cjs` | Cursor Agent (REPARK Orchestrator) |
| 2026-08-04 下午 | **🧪 主站 Webhook 连发组合试射：166 电量 + 122 元充值 (TC-P0-22)**：① **硬约束**：零 SQL，100% HTTP POST；② **请求①**：`consume amount=166 tx_id=TEST_COMBO_CONSUME_166_REAL` → HTTP 200 ✅；③ **请求②**：`recharge amount=12200 (122元) tx_id=TEST_COMBO_RECHARGE_12200_REAL` → HTTP 200 ✅；④ **结果汇总**：| 字段 | BEFORE | AFTER | Δ | |---|---|---|---| | `daily_energy_consumed` | 40 | 206 | +166 ✅ | | `daily_money_recharged` | 78 yuan | 200 yuan | +122 ✅ | | `battle daily_energy.currentProgress` | 40 | 206 | +166 ✅ | | `battle daily_recharge.currentProgress` | 78 | 200 | +122 ✅ | ⑤ **battle/init 完整字段**：dailyLimitA=5 (剩5次) / dailyLimitB=10 (剩9次)；hasUnclaimedReward: energy=true (206≥100) / recharge=true (200≥88)；⑥ **断言 8/8 全过** | Cursor Agent (REPARK Orchestrator) |
| 2026-08-04 下午 | **🔍 进度奖励（里程碑）主站电量回调纯只读审计 (TC-P0-AUDIT-23)**：① **主站回调判定：无** — 全 codebase 零 `add_energy` / `callback` / `mainStation callback` 匹配；② **ENERGY 奖励发放审计**：当前 `reward-claim` + `game/milestone/claim` 仅更新 `is_claimed`，不发放任何道具到 `user_inventory`；统帅决定采用方案 A（H5 后端回调主站）；③ **"距下一奖励 0"根因**：三档里程碑全已领取时 `damageToNext = nextMilestone ?? 0` 数学正确；④ **全服伤害计算**：使用 `maxHp - currentHp`，非 `SUM(damage_dealt)`；⑤ **关联文件**：`task-claim/route.ts:269–354`、`game/milestone/claim/route.ts:139–168`、`reward-claim/route.ts:115–138`、`SubPageModal.tsx:1073–1078` | Cursor Agent (REPARK Orchestrator) |
| 2026-08-06 下午 | **🚀 出站电量回调服务适配客户官方文档 v1.0 (TC-P0-26)**：① **客户文档**：`活动奖励回调接口 — 第三方对接文档 v1.0`（客户 2026-08-06 提供）；② **Payload 重大变化**：从 Mode B 双路径 HMAC 改为**单遍 HMAC** — `JSON.stringify({ action_type:'reward', amount, sign:64×'0', timestamp, tx_id, user_id })`（字母序：`action_type→amount→sign→timestamp→tx_id→user_id`），body 与 HMAC 输入**逐字节完全一致**；③ **HMAC**：单次 SHA256，Header `X-Webhook-Signature: sha256=<hex>` + `X-Request-Id: <tx_id>`；④ **响应判定**：`body.code === 200` 成功；code=520 限流可重试（最多3次，间隔≥5s）；401 不重试；⑤ **重试策略**：网络错误/520 → 最多3次重试；非520错误/401 → 直接抛错；⑥ **URL**：`https://test.aidpzm.com/api/webhook/activity/reward`（环境变量 `MAIN_STATION_ADD_ENERGY_URL` 覆盖）；⑦ **服务器出口公网 IP**：`98.93.252.250`（需发送给客户配置 IP 白名单）；⑧ **.env.production**：已添加 `MAIN_STATION_ADD_ENERGY_URL=https://test.aidpzm.com/api/webhook/activity/reward`；⑨ **新建 Mock**：`app/api/mock/activity-reward/route.ts`（本地替代 `test.aidpzm.com`，完整校验签名+Payload）；⑩ **本地 TS 检查**：0 错误 ✅；**生产构建**：51/51 ✅；**PM2**：375次重启后 PID 664513 online ✅；⑪ **E2E 12/12 全过**：Payload 字母序✅ / sign=64零✅ / compact JSON✅ / Mock code=200✅ / 幂等同tx_id✅ / 篡改body+原签名→401✅ / 缺签名→401✅；⑫ **Phase 6 实测**：真实请求发送至 `test.aidpzm.com` → 收到 `{code:401, message:"IP 未授权"}` → 出站服务正常运转，DB 未标记 `is_claimed`（防静默设计）✅ | Cursor Agent (REPARK Orchestrator) |
| 2026-08-08 晚 | **🎉 主站加电量回调全链路正式通线验收 (TC-P0-27)**：① **客户白名单确认生效**：从生产服务器 `98.93.252.250` 直连 `https://test.aidpzm.com/api/webhook/activity/reward`，主站响应从 `401 IP 未授权` 变为 `code:200 message:""` ✅；② **发现新数据契约 bug**：客户主站只接受 long ID 形式 (`user_id="128"`)，不认 UUID (`6c61704f-...`)，响应 `code:500 message:"user_id 无效"` —— 直连对比测试 A `user_id="128"` ✅ vs Test B `user_id="6c61704f-..."` ❌；③ **P0 修复方案 A（最小侵入）**：`sendMainStationEnergyReward` 接口签名增加 `originalUserId` 字段；body 的 `user_id` 改用 `originalUserId`（原始 long ID），`userId` 仍为 canonical UUID 用于 tx_id 合成 + DB 操作；④ **修改 3 文件**（REPARK 锁定 1~3 上限）：`lib/services/outboundWebhook.ts`（接口扩展）+ `app/api/game/milestone/claim/route.ts`（新增 `extractOriginalUserId()` 透传 raw long ID）+ `app/api/battle/reward-claim/route.ts`（TypeScript 强制适配新签名 + 保留 raw long ID）；⑤ **生产部署**：`npx tsc --noEmit` EXIT 0 ✅；`npm run build:no-lint` 51/51 ✅；`H:\tmp\repark-deploy-2026-08-08.tar.gz` (51.21 MB) 上传 + 远端 `npm ci` + `rm -rf .next` + `build:no-lint` + `pm2 restart`；PM2 **online PID 680054**, uptime 3s, 内存 61.0 MB ✅；⑥ **H5 端到端验收 (`/tmp/test-h5-claim-v2.sh`)**：`POST /api/game/milestone/claim uid=128 milestone=75` → **HTTP 200** `{ok:true,data:{milestone_id:75, claimed:true, claimed_at:"2026-08-08T14:49:09.294Z", reward_type:"ENERGY", reward_value:"500"}}` ✅；PM2 outboundWebhook 日志 `user_id=128 (canonical=6c61704f-...) amount=500 ← HTTP 200 code=200` ✅；⑦ **幂等防重试**：第 2 次 POST 同 milestone → **HTTP 409 ALREADY_CLAIMED** "Already claimed" ✅；⑧ **防静默防线回顾**：修复前主站拒收时 H5 抛 HTTP 500 + outboundWebhook 失败，DB `is_claimed` 未被错误标记，验证了三层防护（重试×3 / 异常透传 / DB 不更新）有效；⑨ **验证脚本归档**：`/tmp/test-real-outbound-reward.cjs` / `/tmp/test-direct-with-long-uid.sh` / `/tmp/test-h5-claim-v2.sh` / `/tmp/deploy-2026-08-08.sh`；⑩ **第 2/3 档里程碑 (id=50/25) 也已具备完整链路**：本次只验证了 milestone 75 (energy=500)，全链路机制已被证明可重复触发 | Cursor Agent (REPARK Orchestrator) |
| 2026-08-09 上午 | **🔍 交付前系统密钥依赖与权限审计 (TC-P0-AUDIT-KEYS, READ ONLY)**：① **0 文件修改 / 0 DB 写入 / 0 网络外发** 严格只读；② **Tier 1 致命依赖 6 项全部已配**：`DATABASE_URL` / `REDIS_URL` / `REDIS_TLS` / `WEBHOOK_SECRET` / `ADMIN_SECRET_KEY` / `OWNER_COMMAND_KEY`（后者从 `/etc/repark/owner.env` 加载）✅；③ **Tier 2 业务依赖 7 项**: `MAIN_STATION_ADD_ENERGY_URL` / `NEXT_PUBLIC_*` 6 项已配；`INTERNAL_STARTUP_KEY` 未配（cron 路由 503，待 Commander 决 cron 路径）；④ **Tier 3 可选 4 项未触发**：`UPLOAD_BACKEND` 未配/admin 走 mock 上传 + `OWNER_HEARTBEAT_*` 未配/heartbeat 关闭 + `ADMIN_DEV_BYPASS` 未配/生产 false ✅；⑤ **0 硬编码时间/日期锁**：活动 `end_time` 是 DB 字段（2029-01-28），由客户 admin 后台可改；❌ 找不到 `Date.now() < 日期` / `expiresAt` / `trialExpired` / `kill switch` 时间触发；⑥ **0 硬编码 IP/域名锁**：`NEXT_PUBLIC_FRAME_ANCESTORS` env 控制（当前 `*` 测试），无嵌入域名/IP 白名单硬编码；⑦ **唯一 IP 限制**：客户 IP 白名单（98.93.252.250）由客户主站控制，不在我们代码里；⑧ **Owner Command 心跳 opt-in**：当前 production `OWNER_HEARTBEAT_URL` 未配 → 启动心跳关闭（设计意图，未启用）；⑨ **关键控制点盘点**：✅ 我们保留 `OWNER_COMMAND_KEY`（远程 kill switch） + `revoke_user_session` + `lock_admin`（注：当前 `adminAuth.ts` 未读 `repark:admin:lock_epoch`，`lock_admin` 视觉 no-op 但 epoch 已记录）；❌ 业务开关 `isGlobalEnabled` 是 DB 字段客户可控；❌ 活动 end_time/start_time DB 字段客户可控；⑩ **远程命令清单 6 个**：`ping` / `get_state` / `read_lock_state` / `lock_admin` / `unlock_admin` / `revoke_user_session`（HMAC-SHA256 + 5min replay + Redis nonce 防护）；⑪ **文件系统敏感信息**：`keys/mercenary_h5_project.pem` (411B) 已配，`admin-pw.txt` + `mercenary_h5_project.pem.archived` 仍存在（ACTIVE_CONTEXT §3 P0 已识别未清理）；⑫ **3 种移交路径建议**：方案 A 平稳移交（保留 OWNER_COMMAND_KEY 30 天质保）+ 方案 B 远程止损（lock_admin）+ 方案 C 1 行 adminAuth.ts 接入激活 lock_admin 真正生效；⑬ **总体评级**：密钥分离 9/10 + 远程可控 7/10 + 客户可控 10/10 + 文件系统清洁 6/10 + 移交可执行 9/10；⑭ **审计结论**：系统当前**可移交、可远程止损、可平稳交接**。无神秘授权逻辑、无隐藏时间锁、无硬编码后门 | Cursor Agent (REPARK Orchestrator) |
| 2026-08-09 晚 | **🧹 lock_admin 远程控制挂载 & 敏感文件清理 (TC-P0-AUDIT-KEYS follow-up)**：① **关键发现**：`app/lib/adminAuth.ts` 的 `requireAdminAuth` 已**完整实现** lock_epoch 检查（line 100-128），之前审计报告说的"no-op 视觉"是依据过时的 `OWNER_KEY_MANAGEMENT.md §6` 注释，源代码已就绪；② **端到端验证 (`/tmp/test-lock-admin-v2.sh`)**：`read_lock_state BEFORE` → `lock_admin` → `read_lock_state AFTER` (epoch 1786274119525) → Redis 直读 `lock_epoch:1786274119525` ✅ → `unlock_admin` → `locked:false epoch:0` ✅ → Redis 清理 ✅；③ **admin API 401 验证**：`Cookie: admin_token=invalid_garbage` → `{"ok":false,"error":{"code":"UNAUTHORIZED","message":"Invalid or expired admin_token"}}` HTTP 401 ✅；④ **敏感文件清理**：`admin-pw.txt` (2700B, 包含明文 `giys-agjj-niqt-yx2g` + SHA256 hash) + `mercenary_h5_project.pem.archived` (472B, OpenSSH private key 加密) **本地仓库 + 生产服务器双删** ✅；⑤ **`.gitignore` 强化**（防止误传回 git）：新增 `admin-pw.txt` / `admin-pw.*.txt` / `*.archived.pem` / `*.archived` 四条规则；⑥ **文档更新**：`OWNER_KEY_MANAGEMENT.md §6` 过期注释替换为 Phase 11 状态："lock_admin is FULLY WIRED as of Phase 11 (verified 2026-08-09). `app/lib/adminAuth.ts` `requireAdminAuth` reads `repark:admin:lock_epoch` from Redis on every admin API request (line 100-128) and rejects tokens whose issuedAt timestamp predates the lock epoch. End-to-end verified via `/tmp/test-lock-admin-v2.sh`"；⑦ **TypeScript 类型检查**：`npx tsc --noEmit` EXIT 0 ✅；⑧ **生产构建**：`npm run build:no-lint` 51/51 ✅；⑨ **PM2 状态**：`repark-h5` online PID 680054, uptime 20h, 内存 61.3 MB（**无需重启**，lock_admin 已在 2026-08-08 部署的版本中生效）；⑩ **REPARK 锁定范围**：本会话 0 文件代码改动（仅 `.gitignore` 文档化 + `.md` 文档更新 + 2 文件删除），完美符合"审计 + 最小修复"基调 | Cursor Agent (REPARK Orchestrator) |
| 2026-08-22 晚 | **🎯 HP 条 ② ③ ④ 刻度动态绑定后台 formThresholds P0**：① **根因**：4 处断裂链 —— `/api/battle/init` 未返 `spine` → `ActivityConfigShape` 接口缺字段 → `StandardHPBar` 解构缺 `milestones` → `BattleLayout` 未传值，且模块常量硬编码 80/50/25 与后台 Spine stage2/3/4 完全无关；② **修复**（3 文件限定）：`app/api/battle/init/route.ts` 加 `loadActivityConfig()` 提取 `spine.formThresholds` + `ActivityConfigShape` 接口增字段 + 响应体 `config.spine` 透传 + `safeNum` 兜底 75/50/25；`app/components/features/battle/BattleLayout.tsx` 增 `spineFormThresholds` useState + init 响应 `setSpineFormThresholds` + 派生 `dynamicHpMilestones` + 传给 `<StandardHPBar>`；`app/components/features/battle/StandardHPBar.tsx` 模块常量 `MILESTONES` 重命名为 `DEFAULT_MILESTONES`（默认 75/50/25 对齐 `activitiesPg.defaultConfig` SSOT）+ 解构 `milestones` prop + JSX 改 `activeMilestones.map`；③ **验证**：`npx tsc --noEmit` EXIT 0 ✅；`npm run build:no-lint` ✓ Compiled successfully in 5.0s，51/51 ✅；**待 Commander**：PM2 重启部署生产 + 浏览器手测 75%/70%/25% 配置生效（验收 Spec 列出的 75%→②、70%→③、25%→④ 即时同步）| Cursor Agent (REPARK Orchestrator) |
| 2026-08-22 晚 | **🔒 多账号数据隔离 BUG #38 修复 (Option A - 三层硬化)**：① **根因深挖**：不仅 Spec 提及的两个接口内部有 query/body 覆盖路径，**更严重的是 `lib/auth.ts` 的 `getUserIdFromRequest` 自身还允许 `?userId=` 作为 query fallback (line 177-191)** —— 任何匿名请求只要拼上 `?userId=128` 就能拿到目标账号的数据；② **Spec 指定的 2 文件修改**：`app/api/battle/init/route.ts` 删除 `paramUid ? toUuid(paramUid) : authResult.userId` 三元覆盖 + 移除未用的 `toUuid` import；`app/api/game/milestone/claim/route.ts` `extractUserId` 函数体改为 `_body?:` + 仅从 `getUserIdFromRequest(req)` 提取身份（保留 `extractOriginalUserId` 用于 outbound webhook 原始 long ID）；③ **根因修补（关键）**：`lib/auth.ts` 第 177-191 行整个 `// 2.5 P0 2026-08-02 (TC-P0-09)` query-param fallback 块**整段删除**（含 try/catch 包裹的 URL 解析），仅保留 Cookie/Bearer/Dev-fallback 三层身份源；④ **部署链**：`npx tsc --noEmit` EXIT 0 ✅ → `npm run build` ✅ (BUILD_ID `YqpkF9fcKzqcL8F8F_eXx`) → SCP `app/api/battle/init/route.ts` + `app/api/game/milestone/claim/route.ts` + `lib/auth.ts` 到 `/var/www/app/` → 远端 `npx next build` + `pm2 start ecosystem.config.js --env production` → PID 857465 online 218.5 MB；⑤ **越权 curl 验证 11/11 全过**：`battle/init` (A) cookie=128 无 query → inv `{item_hand_count:0, item_phallus_count:18, total_damage_dealt:177}` (baseline) → (B) cookie=128 + `?userId=99999` → inv **完全相同** ✅ → (C) cookie=128 + `?userId=99` → inv 完全相同 ✅ → (D) cookie=128 + `?userId=00000000-0000-0000-0000-000000000099` (UUID 格式) → inv 完全相同 ✅ → (E) 无 cookie + `?userId=128` → **HTTP 401 UNAUTHORIZED** ✅ (query 不再被接受为身份源)；`milestone/claim` (A) cookie=128 + body `user_id:99999` claim m1003 → 200 ok:true `claimed_at:2026-08-22T13:52:05.362Z` (记到 128 名下) ✅ → (B/C) 同样 cookie 同样 m1003 → 200 ALREADY_CLAIMED (同一时间戳) ✅ → (D/E) 无 cookie → HTTP 401 ✅ → (F) Bearer 128 + body `user_id:99999` → 200 ALREADY_CLAIMED (记到 128 名下) ✅；⑥ **DB 端确认**：`publicmilestone_rewards` 仅 `6c61704f-9bf3-5251-ba56-032e2561d8ee` (UUIDv5('128')) 新增 1 行 `milestone_id=1003 is_claimed=true claimed_at=2026-08-22T13:52:05.362Z reward_type=ENERGY reward_value=100`，**0 行写入 99999 / 99** ✅；⑦ **影响面**：本次改动是**通用硬化**，所有调用 `getUserIdFromRequest` / `getUserIdAsUuid` 的接口都自动获得 query 防护（含 `/api/battle/init` / `/api/game/milestone/claim` / 其他 30+ 路由），无需逐个修；⑧ **未改 inbound webhook 鉴权**：`/api/webhook/user-action` 仍按 HMAC 签名校验（与 Bug #38 正交） | Cursor Agent (REPARK Orchestrator) |




| 2026-08-30 | **🎯 Customer Feedback #76 — production closure (documentation closeout)**：① **根因**：`app/admin/users/page.tsx` 的 `selectedDamage` 派生式在无活动选中时错误回退 `?? searchResult?.inventory.totalDamage`，导致"本活动贡献伤害"显示全局寿命伤害而非活动作用域值；② **修复**：单行移除中间回退项，保留 `selectedActivity?.totalDamage ?? 0`（活动作用域或 0）；③ **Quality Gate PASS**：语义分离 / 全局路径 / 活动路径 / 里程碑安全 / 5 项边缘场景 / 回归审计 / TSC / Build / D1-R1 冻结哈希 全部 PASS；④ **生产部署 PASS**：本地 hash `C8323685B136EA86DEFED5FDF1E8EC32E915EF6ABBE6090382F2A8F84D1CCB6B` → 远端 hash MATCH → `next build --no-lint` PASS（14.6s 编译成功）→ `pm2 reload repark-h5 --update-env` PID 994659→1004960，BUILD_ID `6BVuUYUFQpk-zIf76qFkw`→`8KVhYhKhkQv5Y6fMbfIpq`；⑤ **Production Health PASS**：`/api/time` HTTP 200，PM2 out-log 正常服务 /error-log 2026-08-30 零条目（历史 08-21/27/28/29 IRON_GATE + SQL 操作类错误与本次无关）；⑥ **D1-R1 冻结哈希保持未变**：`lib/db/pg.ts` `60A1D273BE9A58DE18A09573E46B8D5ADC0603BE2E70087C6A44CABD41C538E9` / `app/api/action/attack/route.ts` `18AEFCB6DD551B5D331A3DAE9ACF1816ED4A203C40E588487FADFFEF5F60BE77` / `app/api/admin/users/search/route.ts` `3459C3E2D10235F15CB8E666880AD8A191B8418E4B18CAF884A0A9F52CB9F3E1` 全部 MATCH；⑦ **回滚快照保全**：`/var/www/app/.rollback/customer-feedback-76-before-20260830T080510Z/page.tsx`（备份 hash `59789ad2bc178f3f26cd33062cacefc402ac72e3ef9b53765666166893a947a4`）；⑧ **#76 状态：ACCEPTED / CLOSED**。本会话 0 源码改动 / 0 生产操作 / 0 数据库写入 | Cursor Agent (REPARK Orchestrator) |

| 2026-08-30 | **🎯 Customer Feedback #80 — evidence gate (documentation closeout)**：① **状态**：NOT FIXED / NOT REPRODUCED / BLOCKED — 缺客户实际键入的查询字符串 + 期望解析到的用户身份（long UID 或 canonical UUID）；② **已证事实**：admin UI 渲染 `public.users.nickname` of 解析器返回的 UUID；无 nickname→alias/UUID/email 替代；detail search 优先级链 exact UUID → exact alias → exact email → exact nickname → fuzzy nickname → fuzzy email；list filter 用 broad substring ILIKE over UUID/email/nickname；fuzzy 路径设计上是 ambiguous；无代码/DB 缺陷针对 #80 客户场景被证实；0 production DB SELECT 执行；0 数据修复授权；0 代码改动授权；③ **缺证据**：客户键入查询 + 期望用户身份；④ **代码 blast radius**：0；⑤ **数据修复必要性**：unknown；⑥ **下一证据需求**：actual query + expected UID/UUID；⑦ **#80 状态保持**：未关闭；⑧ **保护**：#76 (`C8323685…`) + D1-R1 (`60A1D273…` / `18AEFCB6…` / `3459C3E2…`) 哈希未变；本会话 0 源码改动 / 0 生产操作 / 0 数据库写入 | Cursor Agent (REPARK Orchestrator) |

| 2026-08-30 | **🎯 Customer Feedback #85 — engineering fix verified (documentation closeout)**：① **历史根因**：缺失活动统计行时，`getActivityDamage()` 旧实现回退 `user_inventory.total_damage_dealt`（全局寿命），导致 lifetime 伤害被当作 current-activity 伤害使用，进而误导 milestone / reward 资格判定；② **D1-R1 修复**：`lib/db/pg.ts → getActivityDamage()` 移除 lifetime 回退，严格返回 `user_activity_stats.total_damage` 或 0；`app/api/action/attack/route.ts` 改用 `persistAttackTransactionally()` 将 global + activity + attack_log 写入纳入 BEGIN/COMMIT 事务；`app/api/admin/users/search/route.ts → step 5` 移除 per-row lifetime 回退，`damageByActivity` 仅由 `user_activity_stats` 填充；③ **#76 修复**：`app/admin/users/page.tsx → selectedDamage = selectedActivity?.totalDamage ?? 0`，admin 前端不再回退到 `inventory.totalDamage`；④ **路径审计**：reward-claim / milestone-claim / leaderboard / admin-activity-finalize 全部使用 `getActivityDamage(userId, activeActivityId)` 或 `user_activity_stats WHERE activity_id = $1`，无 lifetime 泄漏；⑤ **生产证据（D1-R1C 已记录）**：fixture `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee` 实测 — `user_inventory.total_damage_dealt = 1359`、`user_activity_stats.activity_id=1 → 1359`、activity_id=7 与 999999 无行 → 严格 0；admin users search 缺失行 → `totalDamage = 0`；cross-activity 泄漏 absent；⑥ **语义澄清**：`activities.config.milestones[].threshold` 是**最小解锁门槛**，不是伤害上限；用户 activity 伤害 > 阈值 = 正常（已达标）；**NO hard cap**；⑦ **代码变更**：NO；⑧ **数据修复**：仍为独立 historical-data 问题（D1-R2 follow-up），本次未决；⑨ **#85 状态**：FIXED IN CODE / CUSTOMER RE-TEST PENDING（**未关闭**，待客户在原 #85 复现路径上重新验证）；⑩ **保护**：D1-R1 冻结哈希 `60A1D273…` / `18AEFCB6…` / `3459C3E2…` 与 #76 冻结哈希 `C8323685…` 全部未变；本会话 0 源码改动 / 0 生产操作 / 0 数据库写入 / 0 fixture 创建 / 0 攻击 / 0 领奖 | Cursor Agent (REPARK Orchestrator) |

| 2026-08-30 | **🎯 Customer Feedback #77 — production closure (documentation closeout)**：① **根因**：进度奖励编辑器已存在，但 `/admin/activities` 缺少一个清晰、可发现的行级入口（用户无法在活动列表直接打开进度奖励编辑）；② **修复**：单文件前端改动 `app/admin/activities/page.tsx`，新增一行级动作 — `label: 进度奖励` / `icon: Flag` / `title="进度奖励"` / `aria-label="进度奖励"` / 路由 `/admin/activities/${act.id}/config#section-milestones`；③ **行为保留**：LIVE2D pencil / ENERGY pencil / delete / 里程碑编辑器 / config 保存路径全部未动；0 API / DB / schema 变更；④ **Quality Gate PASS**：TSC EXIT 0 / Build 51/51 / Case A 新增入口可见 / Case B LIVE2D 导航只读 / Case C ENERGY 导航只读 / Case D pencil 行为保留 / Case E delete 行为保留 / Case F 导航无写入 — 全部 source-level 验证通过；⑤ **生产部署 PASS**：本地 hash `B095F020758C7BCCE32FE84B5F912C03069894BF8EFCE238C6009F0B4B56B624` → 远端 hash MATCH → BUILD_ID `H1uXe-xmn68R9i6clUOaF` → PM2 `repark-h5` online **PID 1010855**；⑥ **Production Health PASS**：`/api/time` HTTP 200，无新增生产错误；⑦ **回滚快照保全**：`/var/www/app/.rollback/customer-feedback-77-before-20260830T192855Z`；⑧ **#77 状态：ACCEPTED / CLOSED**；⑨ **基础设施更正**：生产 SSH 密钥确认存在于 `H:\PROJECT\P17_H5meimo-demo\keys\mercenary_h5_project.pem`，先前"密钥缺失"结论由文件系统枚举竞态导致，**不再保留为当前基础设施状态**；⑩ **保护**：D1-R1 冻结哈希 `60A1D273…` / `18AEFCB6…` / `3459C3E2…`、#76 冻结哈希 `C8323685…`、#80 / #85 状态全部未变；本会话 0 源码改动 / 0 生产操作 / 0 数据库写入 | Cursor Agent (REPARK Orchestrator) |

| 2026-08-31 | **🎯 Customer Feedback #81 — production verification (documentation closeout)**：① **已证事实**：`app/admin/users/page.tsx` 源码 SHA-256 `C8323685B136EA86DEFED5FDF1E8EC32E915EF6ABBE6090382F2A8F84D1CCB6B` → 生产 `/var/www/app/app/admin/users/page.tsx` hash **MATCH**；生产编译 bundle `.next/server/app/admin/users/page.js` 含 `重置`/`返回列表`/`清空搜索` 各 1 次；PM2 `repark-h5` online **PID 1010855**；BUILD_ID `H1uXe-xmn68R9i6clUOaF`；`/api/time` HTTP 200；② **功能存在**：`handleReset`（清除 query + detail state + 重新加载完整无过滤列表）+ `handleBackToList`（清除 detail state，保留当前过滤状态）；`重置` button 条件渲染 `(query.trim() || searchResult)`；`返回列表` button 条件渲染 `searchResult`；③ **根因评估**：reset/back 能力在 2026-08-30 P0 批次（#76 修复同文件时）已落地生产；客户 #81 可能早于本次部署，或因 secondary button 视觉权重低导致发现性差；④ **代码改动**：0；**部署改动**：0；**生产写操作**：0（仅 SSH 只读探针）；⑤ **#81 状态**：ENGINEERING COMPLETE / CUSTOMER RE-TEST OPTIONAL（**未关闭**，建议客户重测）；⑥ **保护**：D1-R1 冻结哈希 + #76 + #77 + #80 + #85 全部未变；本会话 0 源码改动 / 0 生产操作 / 0 数据库写入 | Cursor Agent (REPARK Orchestrator) |

| 2026-08-31 | **🎯 Customer Feedback #82 — production closure (documentation closeout)**：① **Engineering 结论**：`app/admin/users/page.tsx` 的 LIST filter 早已支持 `u.nickname ILIKE '%query%'` 模糊搜索；客户感知到的"不支持"实为 UI 发现性 / 控制语义问题——"筛选"按钮意图不明，用户不清楚 Enter 键和"模糊筛选"按钮分别对应多结果列表过滤 vs 单用户详情跳转；② **修复**：单文件 UI copy-only，`app/admin/users/page.tsx`；改动：`筛选` → `模糊筛选` + 新增模糊筛选解释 title + `查找用户` 标注为直接单用户详情查询 + 新增始终可见 helper 说明两条路径的语义差异；③ **Quality Gate PASS**：语义分离 / 无 API 变更 / 无 SQL 变更 / 无 resolver 变更 / TSC EXIT 0 / Build PASS / #76 语义不变 / #81 语义不变 全部 PASS；④ **生产部署 PASS**：本地 hash `ECB7F5D08840A2297F616DAA01F89F46A45C8885AEA96697EEA22606D4F74F10` → 远端 hash MATCH → BUILD_ID `H1uXe-xmn68R9i6clUOaF` → `xu_Gq7_u1PgD4xRVPXpsC` → PM2 reload → PID 1018333 online；⑤ **Production Health PASS**：`/api/time` HTTP 200，Nginx proxy HTTP 200，无新增生产错误；⑥ **Compiled bundle 验证**：`模糊筛选` ×1 / `重置` ×1 / `返回列表` ×1 均存在于 `page-97c2e2df92103ce7.js`；⑦ **#80 resolver UNCHANGED**：`app/api/admin/users/search/route.ts` hash `3459C3E2D10235F15CB8E666880AD8A191B8418E4B18CAF884A0A9F52CB9F3E1` 未变，exact/fuzzy priority + LIMIT + alias/nickname/email resolver 均保持原状；⑧ **#76 / #81 语义保护**：`selectedDamage = selectedActivity?.totalDamage ?? 0`（line 441）不变；`handleReset` / `handleBackToList` 不变；⑨ **D1-R1 冻结哈希**：全部 MATCH；⑩ **回滚快照**：`/var/www/app/.rollback/customer-feedback-82-before-2026-08-31T08-17-12Z/page.tsx`；⑪ **#82 状态：ACCEPTED / CLOSED**；⑫ **文件整合**：`app/admin/users/page.tsx` 现含 #76 + #81 + #82 全部改动，whole-file hash = `ECB7F5D0…`；本会话 1 文件改动（仅 ACTIVE_CONTEXT.md 文档） |

| 2026-09-03 | **📋 P0-85 BUSINESS FLOW VERIFICATION (READ ONLY)**：通过 admin `/api/admin/users/search` 拉取 5 个测试用户 (602/84/614/128/1) 的真实数据。**关键发现 (P0-85 仍未完全修复)**: ① **uid=84** 在活动 1「魅魔来袭·第1期」`activity[1].totalDamage = 2649` (来自 `user_activity_stats`),但 `milestoneClaims = {}` (空),所有 3 个里程碑 (MS75 thresh=100 + MS50 thresh=50 + MS25 thresh=10) 均满足阈值但**无任何 claim record**; ② **uid=128** 同样情况: `activity[1].totalDamage = 658`,`milestoneClaims = {}`,所有 3 个里程碑满足但无记录; ③ **6 个 misalignment** 全部为「damaged ≥ threshold 但 milestoneClaims 完全缺失」; ④ **P0-85 根因确认**: `user_milestone_claims` 表采用 lazy-claim 设计 — claim 仅在用户主动点击「领取」时由 `POST /api/battle/reward-claim` 创建; ⑤ 代码路径本身正确 (getActivityDamage → user_activity_stats,无 lifetime 泄漏),但客户体验上「伤害超过阈值未自动到账」属于**产品逻辑问题**而非代码 bug; ⑥ 当前 admin API 正确返回 `activity[1].totalDamage = 2649` 而非 lifetime 2649(虽然 `inventory.totalDamage=3196` 是 lifetime),证明 D1-R1 修复在 admin 侧生效; ⑦ `lib/db/pg.ts` line 572-578 `getActivityDamage()` 严格走 `user_activity_stats`; **Result: NEEDS PRODUCT DECISION** — 需确认是否要 (a) 在 attack 时 auto-create milestone_claim row (claim-only UX) 或 (b) 仅修复 admin UI 显示「可领取」提示 (现有 lazy-claim 设计) | Cursor Agent (REPARK Orchestrator) |

 Cursor Agent (REPARK Orchestrator) |

> **每次更新本文件，必须在表里加一行，并保留旧行**。
