# 🔍 PROJECT FULL-SCAN REPORT — P17 H5 魅魔来袭 (H5meimo Demo)

> **扫描执行人**：Cursor Agent (REPARK 6.0, Scope-Locked)
> **扫描范围**：`h:\PROJECT\P17_H5meimo-demo`（根目录全量）
> **报告生成日期**：2026-07-25
> **项目代号**：P17 H5meimo Demo（私人承接项目，私有仓库）
> **客户对接方**：Main Station（主站）— iframe 嵌入 + Webhook 回调
> **生产环境**：`98.93.252.250:3000`（AWS EC2 + PM2 + RDS PostgreSQL + ElastiCache Redis）
> **关联活字典**：`docs/ENGINEERING_CONTEXT.md`、`docs/HANDOFF_2026-07-25.md`

> ⚠️ **前提声明**：本报告基于静态分析 + 已读代码 + 已存在的工程文档。**未执行 `npm run build`** —— `.next/` 目录已存在但陈旧（最近一次构建产物为 `2026/7/25 16:55`，可能落后于当前源码）。如果需要可执行的验证结论，请在干净环境跑一次 `npm ci && npm run build:no-lint && npx tsc --noEmit`。

---

## 1. 🏗️ 技术栈与依赖审计 (Tech Stack & Dependencies)

### 1.1 核心框架与运行时

| 维度 | 技术 | 版本 | 备注 |
|---|---|---|---|
| **Web 框架** | Next.js (App Router) | `15.5.20` | **⚠️ 与 `eslint-config-next@^15.5.14` 不严格对齐（patch 漂移）**，建议 `15.5.x` 锁紧 |
| **React 运行时** | React | `18.3.1`（stable 锁定，不跟随 React 19） | 类型 `@types/react@18.3.12` |
| **Node 运行时** | node:20-alpine（Docker） | Node 20 LTS | middleware 走 Edge Runtime；业务路由走 Node Runtime |
| **TypeScript** | `^5.9.3` | `strict: true`（已开启） | `target: ES2017` |
| **包管理** | npm（lockfile 已生成 `package-lock.json`，453 KB） | — | Dockerfile 用 `npm ci --legacy-peer-deps` |

### 1.2 状态管理 & 数据校验

| 类别 | 库 | 版本 | 用途 |
|---|---|---|---|
| **客户端状态** | `zustand` | `^5.0.12` | `app/lib/audioStore.ts`, `modalStore.ts`, `toastStore.ts`, `transitionStore.ts`, `rewardStore.ts`（多个独立 store） |
| **服务端校验** | `zod` | `^4.4.3` | webhook / admin / 上传 / 路由参数校验（`WebhookPayloadSchema`、`LoginRequestSchema`、`UploadResultSchema` 等） |
| **DB 驱动** | `pg` (node-postgres) | `^8.21.0` | AWS RDS PostgreSQL 单例 pool（`lib/db/postgres.ts`） |
| **缓存** | `ioredis` | `^5.10.1` | ElastiCache Redis TLS（HMR-safe globalThis 单例） |

### 1.3 UI & 样式体系

| 维度 | 技术 | 备注 |
|---|---|---|
| **样式** | **TailwindCSS v4**（`@tailwindcss/postcss@^4.2.2`） | **⚠️ Tailwind v4 较新，与 Next 15.5 的 PostCSS pipeline 配合有 1~2 个已知坑**（详见 §4） |
| **动画** | `framer-motion@^12.38.0` | Spring 物理动效（标准 `{stiffness: 260, damping: 20}`） |
| **图标** | `lucide-react@latest` | Heroicons 替代 |
| **组件库** | 自研 `shadcn` 风格构件 + `components/ui/{button,sheet,skeleton,progress,badge,sonner}.tsx` | 严格遵循 `.cursor/rules/03-tech-and-ui.mdc` 硬规则 |
| **滑动/轮播** | `embla-carousel-react@^8.6.0` + `swiper@^12.1.4` | **⚠️ 两套轮播并存，可能存在职责重叠** |
| **字体** | Google Fonts: `Geist`（sans）+ `Cinzel`（CSS 内联 link） | `next/font/google` + 动态 stylesheet 双轨 |
| **通知/Toast** | `sonner@^2.0.7` | — |

### 1.4 关键第三方 SDK / 引擎

| 引擎 / SDK | 版本 | 角色 |
|---|---|---|
| **`@esotericsoftware/spine-pixi-v8`** | `^4.2.108` | **核心战斗渲染**：魅魔骨骼动画 + PixiJS v8 shader JIT。`transpilePackages: ["@esotericsoftware/spine-pixi-v8"]` |
| **`pixi.js`** | `^8.17.1` | WebGL 渲染层 |
| **`framer-motion`** | `^12.38.0` | UI 动画 |
| **`howler`** | `^2.2.4` | 音频引擎（`AudioManager` 封装） |
| **`dayjs`** | `^1.11.20` | UTC+8 时间处理 |
| **`ssh2`** | `^1.17.0` | **运维部署**（scripts 内部使用，生产 bundle 不需要） |
| **`adm-zip`** | `^0.5.16` | 部署包打包 |

### 1.5 依赖安全与过时风险

| 依赖 | 风险等级 | 说明 |
|---|---|---|
| `next@15.5.20` + `eslint-config-next@^15.5.14` | 🟡 中 | **Patch 漂移**。`next` 是具体版本（15.5.20），但 `eslint-config-next` 是 caret range（^15.5.14）。建议锁死至 `15.5.20`，否则 `npm i` 时可能引入意外 ESLint 规则。 |
| `lucide-react@latest` | 🟠 高 | **`latest` 是浮动 tag**，下次 `npm i` 可能引入 breaking change。**必须锁死为具体版本**。 |
| `shadcn@^4.8.0` | 🟡 中 | `shadcn` CLI 工具不应作为运行时依赖；通常应该放 devDependencies。 |
| `react@18.3.1` + `react-dom@18.3.1` | 🟢 低 | 锁定版本，但 **没有 `^`**，未来手动升级即可。 |
| `tailwindcss@^4.2.2` + `@tailwindcss/postcss@^4.2.2` | 🟡 中 | **Tailwind v4 PostCSS pipeline 与 Next 15.5 存在已知 issue**（构建时报 CSS 警告）。已在 `next.config.ts` 中通过 CSP `style-src 'unsafe-inline'` 兜底。 |
| `@base-ui/react@^1.5.0` | 🟠 高 | **已被 import 但实际使用不明**。需要 grep 确认是否真在使用，否则可能成为幽灵依赖。 |
| `zod@^4.4.3` | 🟢 低 | v4 主版本，API 与 v3 大体兼容。 |
| `ssh2` / `adm-zip` | 🟡 中 | 仅 `scripts/*.mjs` 部署脚本用到，**生产 bundle 不需要**。但 Next.js 构建器不会自动 tree-shake `dependencies`（与 `devDependencies` 不同）。建议移到 `devDependencies` 以减小 Docker 镜像。 |
| `pg@^8.21.0` | 🟢 低 | 当前主流版本，无 CVE 报告。 |

### 1.6 构建/测试栈

| 类别 | 库 | 版本 |
|---|---|---|
| E2E | `@playwright/test@^1.59.1` | 配置见 `playwright.config.ts` |
| 单元 | `@vitest/coverage-v8@^1.6.0` + `jsdom@^24.1.3` | 仅用于覆盖率工具，**没有 vitest 实际跑测试**（实际单元测试在 `tests/unit/*.test.mjs` 直接用 node 跑） |
| Lint | `eslint@^9` + `eslint-config-next@^15.5.14` | Next.js 标准配置 |

---

## 2. 📂 项目架构与目录拓扑 (Architecture Topology)

### 2.1 项目类型

**Single Next.js App（App Router）+ 部署运维脚本套件**。**非 Monorepo**（没有 `pnpm-workspace.yaml` / `lerna.json`）。

> **架构特征**：
> - **服务端**：Next.js Route Handlers + 自定义 middleware（Iron Gate + CSRF）
> - **客户端**：React Client Components（带 `'use client'`）
> - **持久层**：AWS RDS PostgreSQL + ElastiCache Redis（**Supabase 已全量退役**，`.env.local.example` 留有 tombstone 注释）
> - **运维**：PM2（生产） + SSH2 + Nginx + `scripts/*.mjs` 自动化

### 2.2 核心入口文件

| 角色 | 路径 |
|---|---|
| **App Router 根布局** | `app/layout.tsx`（注入 Geist 字体 + `id="modal-portal"`） |
| **根页面（Home）** | `app/page.tsx`（Banner 轮播，SSR `force-dynamic`） |
| **战斗页** | `app/battle/page.tsx`（默认 `initialHp=100000`，客户端 hydrate） |
| **Admin 入口** | `app/admin/layout.tsx` + `app/admin/page.tsx`（dashboard） |
| **Admin 登录** | `app/admin/login/page.tsx` |
| **Middleware（Iron Gate）** | `middleware.ts`（admin API + admin UI + `/battle` cookie 守卫） |
| **Next.js 配置** | `next.config.ts`（CSP / HSTS / 图像白名单 / serverActions allowedOrigins） |
| **TS 配置** | `tsconfig.json`（`strict: true`，`paths: {"@/*": ["./*"]}`） |
| **PostCSS** | `postcss.config.mjs` |

### 2.3 主要模块拆分

#### `app/`（Next.js App Router + 业务路由）
```
app/
├── layout.tsx                  # 根布局
├── page.tsx                    # Home（Banner 轮播）
├── battle/page.tsx             # H5 战斗主页
├── admin/                      # 后台管理 UI（dashboard / login / banners / users / monitor）
│   ├── layout.tsx
│   ├── page.tsx
│   ├── banners/
│   ├── users/
│   ├── monitor/
│   ├── activities/
│   ├── login/
│   └── lib/                    # adminApi / 状态
├── api/                        # 服务端 API（22 个端点，见 §2.4）
│   ├── action/attack/          # 战斗核心
│   ├── admin/                  # 管理端 API（11 个子目录）
│   ├── battle/                 # 战斗客户端 API（4 个子目录）
│   ├── banner/                 # Banner（公共 + 后台更新）
│   ├── boss/status/            # Boss HP 查询
│   ├── diag/client-log/        # 客户端日志上报
│   ├── game/                   # 游戏初始化 + 里程碑领取
│   ├── internal/               # 内部通道（startup / cron / owner-command）
│   ├── test/seed-damage/       # 测试用伤害注入
│   ├── time/                   # NTP 校时
│   ├── user/status/            # 用户任务状态（驱动红点）
│   └── webhook/user-action/    # 来自主站的 webhook
├── components/                 # 业务组件（见下）
├── lib/                        # 客户端工具库（store、adminToken、fetch 封装等）
└── error.tsx / not-found.tsx / global-error.tsx
```

#### `lib/`（服务端核心库 — REPARK 哲学 "纯函数 + 显式依赖"）
```
lib/
├── env.ts                      # ★ 环境变量单一入口（lib/env.ts）
├── auth.ts                     # ★ Cookie → UUID 派生（toUuid / getUserIdFromRequest）
├── auditLog.ts                 # Webhook + Admin 操作审计
├── csrf.ts                     # Same-origin CSRF 守卫
├── rateLimiter.ts              # Redis 滑动窗口
├── redis.ts                    # ★ Redis 单例 + Lua 原子攻击脚本（ATOMIC_ATTACK_LUA）
├── upload.ts                   # 上传抽象层（mock / s3 / local 三后端）
├── ownerCommand.ts             # Commander 远程控制 HMAC 校验
├── actions/                    # Server Actions（battleActions）
├── animations.ts
├── db/                         # ★ PostgreSQL 单例（pg.ts / postgres.ts / activitiesPg.ts / userPg.ts）
└── security/verifyWebhookSignature.ts
```

#### `app/components/`（UI 组件 — Battle / Game / Home / Task / UI）
```
app/components/
├── features/
│   ├── battle/                 # 战斗 UI（SpineViewer 1583 行 + BattleLayout 1229 行 + 16 个子组件）
│   ├── game/                   # GameBannerCarousel + HomePageClient
│   ├── home/H5Banner.tsx
│   └── ui/GlassButton.tsx
├── task/TaskSheet.tsx
└── ui/ToastContainer.tsx
```

#### `components/ui/`（shadcn 风格原始构件）
```
components/ui/{button,sheet,skeleton,progress,badge,sonner}.tsx
```

#### `supabase/migrations/`（已迁移到 AWS RDS，但 SQL 文件保留为 schema 真相）
15 个迁移文件，`0001_initial_schema.sql` → `15_webhook_audit_table.sql`（最新）

#### `scripts/`（运维 + 部署 + 调试脚本 — 约 80 个 `.mjs` / `.cjs` / `.sh` / `.ps1`）
- 部署：`deploy_aws_db.mjs`, `upload-app.mjs`, `setup-server.sh`, `package-deploy.mjs`
- SSH 远程：`ssh-exec.mjs`, `ssh-probe.mjs`, `remote-run.mjs`, `remote-bash.mjs`
- 迁移：`migrate-redis-keys.mjs`, `migrate-alias-128.cjs`
- 调试：`verify_tunnel_and_dryrun.mjs`, `db-query-inline.mjs`, `ping_attack.mjs`, `bench_attack.mjs`
- 安全种子：`generate-internal-key.mjs`, `generate-owner-key.mjs`, `mint-env-production.mjs`

#### `tests/`
```
tests/
├── api/    # Playwright API 测试（5 个 spec：00-prerequisites, 01-battle-core, 02-admin, 03-internal-owner, 04-banner-claim）
├── ui/     # Playwright UI 测试（2 个 spec：01-volume-bar, 02-admin-pages）
├── unit/   # Node 原生测试（3 个：cron-finalize-smoke, csrf, internal-auth）
└── manual/ # 全链路手动测试脚本（attack-body.json, test-all.mjs, test-all.ps1）
```

#### `docs/`
3 份核心活字典：
- `ENGINEERING_CONTEXT.md`（P0/P1/P2 待办清单 + 客户对接约束 + 关键事实速查）
- `HANDOFF_2026-07-25.md`（webhook_audit 表的交付报告）
- `变更交付文档_2026-07-23.md`（早期变更记录，疑似乱码文件名）

### 2.4 路由 / API 拓扑

#### Page 路由（App Router）
| 路径 | 文件 | 用途 |
|---|---|---|
| `/` | `app/page.tsx` | Home（Banner 轮播 + 任务红点） |
| `/battle` | `app/battle/page.tsx` | H5 战斗主页（middleware 强制 cookie） |
| `/admin` | `app/admin/page.tsx` | Admin Dashboard（middleware Iron Gate 保护） |
| `/admin/login` | `app/admin/login/page.tsx` | Admin 登录（`ADMIN_DEV_BYPASS=1` 时密码为 `dev`） |
| `/admin/banners` | `app/admin/banners/page.tsx` | Banner 管理（含上传） |
| `/admin/users` | `app/admin/users/page.tsx` | 用户管理（含 InlineEditor） |
| `/admin/activities` | `app/admin/activities/` | 活动配置 |
| `/admin/monitor` | `app/admin/monitor/page.tsx` | 运行时监控 |

#### API 端点（22 个）
| 路径 | 方法 | 用途 | 鉴权 |
|---|---|---|---|
| `/api/action/attack` | POST | 战斗核心（Lua 原子 + 持久化） | Cookie `uid` |
| `/api/battle/init` | GET | 战斗状态初始化（hydration） | Cookie `uid` |
| `/api/battle/leaderboard` | GET | 全局排行榜 | Cookie `uid` |
| `/api/battle/reward-claim` | POST | 进度奖励领取 | Cookie `uid` |
| `/api/battle/task-claim` | POST | 每日任务领取 | Cookie `uid` |
| `/api/webhook/user-action` | POST | **主站回调入口**（HMAC 验签 + Zod 校验 + Redis 幂等 + DB 写） | X-Webhook-Signature |
| `/api/time` | GET | 服务器时间（用于客户端时钟校准） | 公开 |
| `/api/boss/status` | GET | Boss 当前 HP/版本 | Cookie `uid` |
| `/api/user/status` | GET | 用户任务/里程碑状态（驱动红点） | Cookie `uid` |
| `/api/game/init` | GET | 游戏配置（Spine 配置 / 道具 / 里程碑定义） | Cookie `uid` |
| `/api/game/banners` | GET | 客户端 Banner 列表（已用 HomePage 内联替代） | Cookie `uid` |
| `/api/game/milestone/claim` | POST | 里程碑奖励领取 | Cookie `uid` |
| `/api/diag/client-log` | POST | 客户端 console 日志上报（**已存在但未接通**，P1 待办） | 公开 |
| `/api/admin/login` | POST | Admin 登录（HMAC 令牌） | Rate-limited (5/min) |
| `/api/admin/validate` | POST | Admin 凭证预检 | 公开（pre-login） |
| `/api/admin/logout` | POST | Admin 登出 | HMAC token |
| `/api/admin/banners` | GET | 列出 Banner + 全局配置 | HMAC token |
| `/api/admin/banners/update` | POST | 创建/更新/删除/排序 Banner | HMAC token + CSRF |
| `/api/admin/upload` | POST | 图片 / Spine 包上传 | HMAC token |
| `/api/admin/users` | GET | 用户列表 + 库存 | HMAC token |
| `/api/admin/user/{userId}` | GET/POST | 单用户操作（道具增减、封禁、里程碑锁） | HMAC token |
| `/api/admin/activity/{finalize,config,...}` | POST | 活动配置 + finalize | HMAC token |
| `/api/admin/stats` | GET | 运营统计 | HMAC token |
| `/api/admin/boss/update-hp` | POST | Boss HP 强制设置 | HMAC token |
| `/api/internal/startup` | GET | 启动握手（可选 OWNER_HEARTBEAT_URL） | X-Internal-Token (HMAC) |
| `/api/internal/cron/finalize-milestones` | POST | Cron 终结里程碑 | X-Internal-Token (HMAC) |
| `/api/internal/owner-command` | POST | **Commander 远程命令**（`get_state` / `lock_admin` / `revoke_user_session` 等） | X-Owner-Auth (HMAC) + Rate-limit |
| `/api/test/seed-damage` | POST | 测试用伤害注入（**仅 dev**，prod 应禁用） | ⚠️ 无鉴权 |

---

## 3. 🔐 环境与部署基线 (Environment & Deployment Baseline)

### 3.1 环境变量依赖矩阵

> **SSOT**：所有读取都应在 `lib/env.ts` 完成。但扫描发现仍有 ~14 处散落的 `process.env.*` 直接读取（详见 §4.1）。

| Key | 必填（生产） | 默认/可空 | 用途 |
|---|---|---|---|
| `NODE_ENV` | 自动 | `development` | Next.js 自动注入 |
| `DATABASE_URL` | ✅ **必填** | — | RDS PostgreSQL 连接串（**生产密码明文嵌入 `.env.production`**） |
| `REDIS_URL` | ✅ **必填** | — | ElastiCache（TLS 优先：`rediss://`） |
| `REDIS_TLS` | 可选 | `false`（dev）/`true`（prod） | TLS 显式开关 |
| `ADMIN_SECRET_KEY` | ✅ **必填**（≥32 字符） | dev: `dev-admin-secret-do-not-use-in-prod` | HMAC 签名 admin token |
| `ADMIN_DEV_BYPASS` | dev-only | `0` | 非生产时密码 `dev` 即可登录 |
| `WEBHOOK_SECRET` | ✅ **必填**（≥32 字符） | dev: `test_webhook_secret_32chars_minimum_ok` | 主站 HMAC-SHA256 验签 |
| `INTERNAL_STARTUP_KEY` | ✅ **必填**（≥32 字符） | dev: loopback bypass | 内部通道 HMAC 鉴权 |
| `OWNER_COMMAND_KEY` | 可选（启用则 ≥32 字符） | 不设 = 通道禁用 | Commander 远程命令 |
| `OWNER_HEARTBEAT_URL` | 可选 | 不设 = 跳过启动握手 | 启动心跳 URL |
| `OWNER_HEARTBEAT_KEY` | 可选 | — | 心跳 HMAC 密钥 |
| `NEXT_PUBLIC_APP_URL` | ✅ **必填**（生产） | `http://localhost:3000` | CSP self-origin |
| `NEXT_PUBLIC_AUTH_COOKIE_NAME` | ✅ **必填**（生产） | `uid` | 主站 Cookie 名 |
| `NEXT_PUBLIC_MAIN_STATION_URL` | ✅ **必填** | `https://main-station.example.com/login` | 未鉴权时跳转 |
| `NEXT_PUBLIC_FRAME_ANCESTORS` | 可选 | `'none'` | CSP frame-ancestors（生产测试当前为 `*`） |
| `NEXT_PUBLIC_TASK_THRESHOLD_ENERGY` | 可选 | `100` | 每日电量任务阈值（**点**） |
| `NEXT_PUBLIC_TASK_THRESHOLD_RECHARGE` | 可选 | `100` | 每日充值任务阈值（**分** ⚠️ 100 太小，应为 5000） |
| `NEXT_PUBLIC_VOICE_BASE_URL` | 可选 | `/voice` | 语音 CDN |
| `ADMIN_INVENTORY_MAX_PER_TYPE` | 可选 | `10000` | Admin 单次发放道具上限 |
| `UPLOAD_BACKEND` | 可选 | `mock` | `s3` / `mock` / `local`（local 需额外 `ALLOW_LOCAL_DISK=1`） |
| `ALLOW_LOCAL_DISK` | 可选 | `0` | 启用本地磁盘上传（dev-only） |
| `NEXT_PUBLIC_ADMIN_TRUSTED_ORIGINS` | 可选 | `''` | CSRF 跨域白名单 |
| `DEPLOY_SSH_KEY_PATH` / `DEPLOY_SSH_PASSPHRASE` | 部署期 | — | scripts 内部使用 |
| `PORT` | 可选 | `3000` | Docker 监听端口 |
| `HOSTNAME` | 可选 | `0.0.0.0` | Docker 监听地址 |

### 3.2 数据库 / 持久化架构

**部署**：AWS RDS PostgreSQL（生产：`rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com:5432`）
**本地开发**：SSH 隧道 `127.0.0.1:5433` → RDS:5432（`scripts/dev_tunnel.mjs`）

**核心表**（来自 `supabase/migrations/`，最新已应用至 `0001` → `15`）：

| 表 | 关键列 | 备注 |
|---|---|---|
| `public.users` | `id UUID PK` | 通过 `ensureUserExists()` 自动建（FK 根） |
| `public.user_inventory` | `user_id, item_hand_count, item_phallus_count, total_damage_dealt` | 道具 + 累计伤害 |
| `public.user_daily_tasks` | `user_id, date, daily_energy_consumed, daily_money_recharged, recharge_processed` | `(user_id, date)` 唯一约束 |
| `public.task_progress` | `user_id, task_type, reset_date, current_progress, is_claimed` | 任务领取状态 |
| `public.attack_logs` | `id, user_id, item_used, damage_dealt, created_at` | 攻击流水 |
| `public.milestone_rewards` | `user_id, milestone_id, is_claimed, is_locked, claimed_at, reward_type, reward_value` | 里程碑奖励 |
| `public.activities` | `id, name, type, start_time, end_time, status, config(jsonb)` | 活动主表 + JSONB 配置 |
| `public.banners` | `id, image_url, target_activity_id, sort_weight, is_enabled, show_countdown` | Banner |
| `public.boss_status` | `boss_id UUID PK, current_hp, max_hp, version, last_updated_at` | Boss 当前状态 |
| `public.user_alias` | `alias_type, alias_value, uuid` (PK 复合) | 主站 long ID → UUID 映射 |
| `public.webhook_audit` | `tx_id, action_type, user_id, raw_user_id, ..., raw_body, error_code` (12 列) | **🆕 webhook 持久化审计** |
| `public.admin_audit_log` | `route, action, operator_id, target_user_id, ip_address, field_name, old_value, new_value` | Admin 操作审计 |

**Migration 状态**：15 个 SQL 文件，按时间顺序应用。最新 `15_webhook_audit_table.sql` 已部署（详见 `HANDOFF_2026-07-25.md`）。

**Supabase 退役状态**：✅ **完全退役**。`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 在 `.env.local.example` 中显式 tombstone。**任何 grep 到这两个变量被读取的代码都是错误**。

### 3.3 构建与部署配置

| 类别 | 文件 | 备注 |
|---|---|---|
| **Docker** | `Dockerfile`（多阶段：deps → builder → runner） | `node:20-alpine`，HEALTHCHECK 走 `/api/time` |
| **PM2** | `ecosystem.config.js` | `fork mode` 单进程，应用名 `repark-h5` |
| **Nginx** | `scripts/nginx-repark.conf` | 反代 + WS + 安全头 |
| **Shell 部署** | `deploy.sh`, `setup-server.sh`, `server-provision.sh` | EC2 初始化 + 上传 + reload |
| **TS 部署** | `scripts/upload-app.mjs`, `scripts/package-deploy.mjs`, `scripts/deploy_aws_db.mjs` | SSH2 上传 + 数据库迁移 |
| **AWS 专项** | `AWS_RDS_MODULAR_INIT_PLAN.md` + `aws_rds_init/` | RDS 初始化分阶段执行计划 |
| **GitHub Actions** | `.github/` 目录存在但 **未发现工作流文件**（仅目录） | ⚠️ 无 CI/CD 自动化（部署全靠 SSH 脚本 + PM2） |
| **Vercel / Netlify** | **无配置文件**（不部署到这些平台） | 仅 AWS EC2 |
| **Backup 脚本** | `scripts/backup.sh` | 部署前自动备份到 `/var/www/app/.backup_pre_audit_*/` |

### 3.4 构建 / 验证命令

```bash
# ── 标准流程 ─────────────────────────────────────────────────────
npm ci --legacy-peer-deps       # 安装依赖（lockfile 驱动）
npm run build                   # 完整构建（含 lint）
npm run build:no-lint           # 跳过 lint 的构建（Docker 用）
npm run start                   # 启动生产服务
npm run dev                     # 开发模式

# ── 验证 ─────────────────────────────────────────────────────────
npm run lint                    # ESLint
npx tsc --noEmit                # TypeScript 类型检查
npm run test:e2e                # Playwright（需要 CI=1 自动启 dev server）
npm run test:e2e:ui             # Playwright UI 模式
npm run test:stress             # scripts/stress_test.js
npm run bench                   # scripts/bench_attack.mjs 性能基准

# ── 数据库 / 部署 ────────────────────────────────────────────────
node scripts/dev_tunnel.mjs     # 启动 SSH 隧道（127.0.0.1:5433/6380 → RDS/ElastiCache）
node scripts/migrate-redis-keys.mjs   # Redis key 迁移
node scripts/deploy_aws_db.mjs  # 远程执行 DB migration
```

---

## 4. ⚠️ 隐患与"屎山/技术债"防区 (Technical Debts & Risk Zones)

### 4.1 类型安全死角

| 等级 | 问题 | 证据 | 影响 |
|---|---|---|---|
| 🟠 高 | **`SpineViewer.tsx` 含 20+ 处 `as any` / `: any`** | `app/components/features/battle/SpineViewer.tsx:702, 705, 725, 730, 779, 795, 854, 867, 880, 887, 905, 909, 939, 1081, 1279, 1293, 1322, 1374, 1383, 1404, 1408, 1439` | Spine-pixi-v8 类型缺失导致逃生通道泛滥；未来重构需要重写整个组件 |
| 🟠 高 | **`SpineViewer.tsx` 长达 1583 行**（单文件巨型组件） | 同上 | 任何修改都可能引发视觉回归；ESLint 规则 01-code-integrity 应阻止，但仅靠 agent 自律 |
| 🟡 中 | **`app/admin/users/page.tsx` 与 `app/admin/banners/page.tsx` 含 `(a: any)` / `(s: any)` 等内联 any** | 4~5 处 | Activity 配置 JSONB 解析走 any，**没有 zod 校验 activity.config JSONB 内容** |
| 🟡 中 | **`lib/db/pg.ts → hasUnclaimedMilestone()` 用 `Record<string, unknown>` + `as` 强转** | `lib/db/pg.ts:259-272` | 同上，JSONB 内部字段缺失类型约束 |
| 🟡 中 | **`lib/redis.ts → loadActivityConfig()` 返回 `as ActivityConfig`**，未做运行时校验 | `lib/redis.ts:369` | Redis 中的 JSON 可能已损坏（无 schema 校验） |
| 🟡 中 | **`app/api/battle/init/route.ts` 中 14 处 `process.env.*` 直接读取**（绕过 `lib/env.ts`） | `middleware.ts:14, 22, 43, 44, 160, 181` 也同样散落 | 与 `.cursor/rules/01-code-integrity.mdc` 的"SSOT"要求冲突 |
| 🟢 低 | **`lib/spine/spine-patch.ts` 用 `as any`** | 4 处 | 插件 monkey-patch 必要逃生，可接受 |

### 4.2 状态机 / 复杂逻辑混乱

| 等级 | 问题 | 位置 |
|---|---|---|
| 🟠 高 | **攻击路径存在 4 套 `incrementDailyTask` 实现** | (1) `lib/db/pg.ts` (Postgres 真表) / (2) `lib/redis.ts` (Redis hash) — **代码注释明确说"tier1=tier2"但实际行为不一致**（见 `lib/redis.ts:520-543` 的 `incrResult && !incrResult[0]` 检查是奇怪的 truthy 判断，可能掩盖 Redis 错误） |
| 🟠 高 | **`lib/auth.ts → toUuid()` 与 `lib/db/pg.ts → seedUuid()` 重复实现** | 两个文件各自实现"rawId → UUIDv5"算法，代码注释明确警告"必须严格一致"——**这是典型 DRY 违反**。改动一个忘了另一个会导致 2026-07-23 那种"账号漂移"故障 |
| 🟠 高 | **`BattleLayout.tsx` 内联了完整的 API Response 类型 + 多层 `useState`/`useRef` 状态机** | 1229 行单文件，4 个 polling effect，10+ 个 ref，3 个状态机（HP / Inventory / Tasks / Milestones / Forms）| 一旦修改 props 接口或加新功能，TS 错误会连锁爆发（违反 REPARK 反混乱协议 §2） |
| 🟡 中 | **`SpineViewer.tsx` 的 `STAGE_REGISTRY` 配置 + 内部硬编码 Y 偏移数组 + 动态加载逻辑交织** | SpineViewer 全文 | 新增 stage 需要同时改 3 个地方 |
| 🟡 中 | **嵌入 `<link rel="stylesheet" href="https://fonts.googleapis.com/...">` 直接在 `BattleLayout.tsx` 函数体中** | `app/components/features/battle/BattleLayout.tsx:291-296` | 应在 `layout.tsx` 用 `next/font/google`，与既有 `Geist` 双轨运行 |

### 4.3 硬编码敏感信息风险 🚨

| 等级 | 问题 | 证据 |
|---|---|---|
| 🔴 **严重** | **`.env.production` 中明文嵌入生产 RDS 密码** | `.env.production:12` `DATABASE_URL=postgresql://postgres:PhbcRcx5Wt@...`  |
| 🔴 **严重** | **`WEBHOOK_SECRET` / `OWNER_COMMAND_KEY` / `ADMIN_SECRET_KEY` 在 `.env.production` 中明文** | `.env.production:23, 27, 30` |
| 🟠 高 | **`admin-pw.txt` 文件存在根目录** | 2700 bytes，内容未读但 **文件名暗示密码** |
| 🟠 高 | **`repark:admin:lock_epoch` 与 `repark:user:tombstone:*` 等 Redis Key 没有命名空间加密** | Redis 一旦被入侵可见所有用户封禁列表 |
| 🟡 中 | **`mercenary_h5_project.pem.archived` 文件名暗示曾存在 SSH 私钥**（已被加 `.archived` 后缀，但仍在工作区） | ⚠️ **如果 `.pem` 没在 `.gitignore` 中被严格忽略，存在泄露风险**（已确认 `.gitignore:25` `*.pem` 已忽略，但归档文件扩展名不是 `.pem`，可能被忽略漏掉） |
| 🟢 低 | **CSP 当前设置 `NEXT_PUBLIC_FRAME_ANCESTORS=*`**（生产 `.env.production:43`）| 客户测试期需要，但正式上线必须收回为 `'none'` 或具体域 |

**🚨 立即行动**：
1. 确认 `.env.production` 是否被 git 跟踪（**当前目录 Is directory a git repo: No**，所以问题不大；但未来一旦 `git init` 必须立即 `.gitignore`）
2. **删除 `admin-pw.txt`** 或将其移出仓库
3. 验证 `mercenary_h5_project.pem.archived` 是否含私钥（建议立即读 + 销毁）

### 4.4 潜在性能瓶颈

| 等级 | 问题 | 证据 |
|---|---|---|
| 🟠 高 | **`BattleLayout.tsx` 每 3 秒 polling `/api/battle/init`** | `app/components/features/battle/BattleLayout.tsx:684-685` `POLL_INTERVAL = 3_000`，**每个用户每 3 秒触发一次完整 hydration（HP + inventory + tasks + milestones + forms + config + taskConfig 共 7 张表查询）** | 100 并发用户 = 33 QPS 持续打 RDS。**P1 待办"改 SSE"** 已识别但未实现 |
| 🟠 高 | **`/api/battle/init` 一次调用命中 5~7 个 DB 查询**（getActiveActivity + getBossStatus + getUserInventory + getDailyTask + task_progress + getMilestoneRewards + 多个 Redis lookup）| `app/api/battle/init/route.ts:289-383` 整个 GET handler | 高并发场景下 RDS 连接池（`max: 10`）将成瓶颈 |
| 🟡 中 | **`pg.Pool` `max: 10` 连接数** | `lib/db/postgres.ts:72` | 单进程 10 连接足够本地 dev，但 PM2 多进程 + RDS Proxy 可能不足 |
| 🟡 中 | **`redis.eval(ATOMIC_ATTACK_LUA, 3, ...)` 在每次攻击都执行 Lua** | `lib/redis.ts:217` | Lua 脚本每次重新传输（可 SCRIPT LOAD 缓存） |
| 🟡 中 | **Spine-pixi-v8 在 WebGL 中同时维持多个 stage**（最多 4 个）| `SpineViewer.tsx` STAGE_REGISTRY | 每个 stage ~50-100MB 显存，移动端可能 OOM |
| 🟡 中 | **`updateBossStatus` 在每次攻击都 UPDATE 整张表**，即使 HP 没变 | `app/api/action/attack/route.ts:309-310` + `lib/db/pg.ts:79-97` | 每秒 1+ 次写入 → 频繁 WAL |
| 🟢 低 | **`audioStore.ts` / `modalStore.ts` / `toastStore.ts` 等多个独立 zustand store** | `app/lib/` | 多个 store 没问题，但每个组件订阅模式各异，需审查 selector 性能 |
| 🟢 低 | **`FloatingDamageLayer` + `ParticleLayer` Canvas 重绘** | `app/components/features/battle/FloatingDamage.tsx` + `ParticleEngine.tsx` | 按 03-tech-and-ui.mdc 硬规则"100+ 节点用 Canvas"，已遵循 ✅ |

### 4.5 其他异味

- **Logger 不统一**：散落 `console.log`/`console.warn`/`console.error` 多达数百处，**没有任何结构化日志**（无 pino / winston）。生产排查只能 grep PM2 stdout。
- **`scripts/_xxx.cjs` 文件以 `_` 开头**：约 30 个 `scripts/_*.cjs` / `_*.sh`，都是开发/调试一次性脚本，**不应留在生产**。
- **`temp-*.mjs` 文件 10+ 个**：临时补丁，**应清理**。
- **`tsc-app-only.log` 873 KB / `e2e-final.log` 103 KB / `prod-server-err.log` 121 KB**：陈旧的诊断日志，**应清理或归档**。
- **`docs/变更交付文档_2026-07-23.md` 文件名疑似乱码**（实际可能是 GBK → UTF-8 转换异常），影响检索。

---

## 5. 🔗 模块间耦合度评估 (Module Coupling & Blast Radius)

### 5.1 高风险核心模块（修改时最容易引发连锁崩溃）

#### 🥇 #1 极高风险：`lib/auth.ts → toUuid()` + `lib/db/pg.ts → seedUuid()`
- **耦合度**：🔴 **极强**（这是项目里**唯一**一处"两个文件必须保持算法绝对一致"的地方，代码注释已显式警告）。
- **连锁影响**：改动其中一个而忘改另一个 → webhook 写入 A 用户，但页面读取时 hash 出 B 用户 → 用户数据丢失 / 错位。
- **历史教训**：已在 `docs/ENGINEERING_CONTEXT.md §2.1` 记录 v1.5 修复前后不一致的具体案例（`raw_user_id=1` 在 alias 表中变成 `48573483-...`，而非代码派生的 `6b86b273-...`）。
- **触及行数**：~20 行。

#### 🥈 #2 高风险：`middleware.ts` (Iron Gate)
- **耦合度**：🟠 高。被 `app/api/admin/*` + `app/admin/*` + `/battle` 共 3 条路由树强制依赖。
- **连锁影响**：修改 matcher / cookie 名 / origin 校验逻辑，会一次性破坏所有 admin 路径的鉴权。
- **触及行数**：~200 行，**但所有变更都必须配合 Playwright `tests/api/02-admin.spec.ts` 全套回放**。

#### 🥉 #3 高风险：`lib/redis.ts`（`ATOMIC_ATTACK_LUA` + `REDIS_KEYS`）
- **耦合度**：🟠 高。Lua 脚本的 KEYS 数量、ARGV 顺序、tag `{battle}` 都和 ElastiCache Cluster Mode 强相关。
- **连锁影响**：改 Lua 内部逻辑但保持 3-key 不变 → bug 难发现；改 KEYS 数量 → 跨 slot 错误（`CROSSSLOT`）。
- **触及行数**：~570 行，**任何修改都应在 staging 跑 `tests/api/01-battle-core.spec.ts` 全套**。

#### 🎖️ #4 中高风险：`lib/db/pg.ts`（所有 DB helper 的 SSOT）
- **耦合度**：🟡 中。被 `app/api/**/route.ts` 共 ~12 个文件 import。
- **连锁影响**：改函数签名（如 `incrementDailyTask` 的参数顺序）需要 grep + 改所有调用方。
- **触及行数**：~700 行。

#### 🎖️ #5 中高风险：`app/components/features/battle/SpineViewer.tsx`
- **耦合度**：🟡 中。被 `BattleLayout.tsx` 通过 `ref` 强耦合。
- **连锁影响**：props 接口微调 → BattleLayout TS 报错；ref 方法重命名 → 攻击锁失效。
- **触及行数**：1583 行，**任何改动都应锁死 BattleLayout.tsx 同步修改**。

### 5.2 解耦推荐

| 优先级 | 建议 | 收益 | 风险 |
|---|---|---|---|
| 🥇 P0 | **抽离 `lib/userIdentity.ts`** 统一 `toUuid` / `seedUuid` / `resolveAliasToUuid` | 消除算法双实现爆炸风险 | 低（纯重构） |
| 🥇 P0 | **将 `SpineViewer` 拆分为 `SpineStageRegistry` + `SpineLoader` + `SpineAnimator` 三个子模块** | 1583 → 3×500 行 | 中（需要 Playwright 全套回放） |
| 🥈 P1 | **引入结构化 logger**（`pino` + `pino-pretty`）替代 `console.*` | 生产 grep 可索引化 | 低 |
| 🥈 P1 | **`BattleLayout.tsx` 的 polling 改 SSE / WebSocket** | -90% RDS QPS | 中（需要新协议设计） |
| 🥈 P1 | **所有 14 处散落的 `process.env.*` 改走 `lib/env.ts`** | 单一审计入口 | 极低 |
| 🥉 P2 | **`scripts/_*.cjs` 与 `temp-*.mjs` 移到 `scripts/_archive/`** | 工作区清洁 | 无 |
| 🥉 P2 | **`UPDATE public.boss_status` 改为乐观锁（仅当 `version` 不变时 UPDATE，否则 RETRY）** | 减少 race condition | 中 |
| 🥉 P2 | **`getPostgresPool` 改为懒连接 + 健康检查熔断** | RDS 抖动期间降级为 Redis-only 模式 | 中（业务需要明确 fallback 语义） |

---

## 6. 📝 接续 Sprint 建议 (Action Plan)

> 已与 `docs/ENGINEERING_CONTEXT.md §6` 的 P0/P1/P2 列表对齐。**新建议标注 🆕**。

### 优先级 1 — 必须在下个 Sprint 处理（阻塞生产稳定）

1. **🚨 清理根目录敏感文件**
   - 删除或加密 `admin-pw.txt`（根目录 2700 bytes）
   - 读取 `mercenary_h5_project.pem.archived` 确认是否为已归档私钥 → 若是，**立即物理删除**（保留 `.pem` 在 `.gitignore` 但归档文件应移除）
   - 验证 `.env.production` 未被 git 跟踪（当前 Is directory a git repo: No，无风险；但**一旦未来 `git init` 必须在第一秒 `.gitignore`**）

2. **🔧 完成 `toUuid` 单一化重构**（P0-1）
   - 新建 `lib/userIdentity.ts` 作为 SSOT
   - `lib/auth.ts` 与 `lib/db/pg.ts` 都改为 import 此 SSOT
   - 加单元测试覆盖：相同输入 → 相同输出 / 大小写不敏感 / 边界值
   - **预估工时**：2~3 小时

3. **📊 `/api/battle/init` 访问日志 + 缓存优化**（沿用 ENGINEERING_CONTEXT §6 P0-2）
   - 加 `audit_log` 表的 `access_log` 写入
   - 把 5~7 个 DB 查询合并为 1 个 `LEFT JOIN` 查询或 1 个 RPC
   - **预估工时**：4~6 小时

### 优先级 2 — 本月内完成（提升可维护性）

4. **🆕 BattleLayout polling → SSE / WebSocket**（替代 3s polling）
   - 新增 `/api/battle/stream` SSE 端点
   - 客户端用 `EventSource` 替换 `setInterval`
   - Boss HP / 任务进度 / 里程碑变更由服务端推送
   - **预估收益**：RDS QPS 下降 ~90%

5. **🆕 14 处散落的 `process.env.*` 集中化**
   - 严格走 `lib/env.ts` 的 `env.xxx()` 方法
   - 加 ESLint 规则禁止直接 `process.env.*`（仅 `lib/env.ts` 例外）
   - **预估工时**：3 小时

6. **🆕 引入 `pino` 结构化日志**
   - 新增 `lib/logger.ts`
   - 所有 `console.log/warn/error` → `logger.info/warn/error`
   - PM2 输出格式保持 JSON 兼容
   - **预估工时**：4 小时

7. **🆕 清理 `scripts/_*.cjs` 与 `temp-*.mjs`**
   - 全部移到 `scripts/_archive/`
   - `.gitignore` 加规则：`scripts/_archive/`
   - **预估工时**：1 小时

### 优先级 3 — 下季度规划（架构升级）

8. **🆕 `SpineViewer.tsx` 拆分**（1583 → 3 模块）
   - **预估工时**：2~3 天（含 Playwright 全套回放）

9. **🆕 `lib/db/pg.ts` 加乐观锁 + 重试装饰器**
   - `updateBossStatus(version: number)` 在不匹配时 retry 一次
   - 减少并发攻击时的 lost update
   - **预估工时**：1 天

10. **🆕 Tailwind v4 → 评估是否降级到 v3**
    - v4 与 Next 15.5 存在已知 warning
    - 决策依据：未来 6 个月维护成本 vs 升级红利
    - **预估工时**：决策 0.5 天 / 执行（若决定降级）1 天

---

## 附录 A：扫描方法论

- **静态读取**：直接读取以下文件 → `package.json`, `tsconfig.json`, `next.config.ts`, `Dockerfile`, `playwright.config.ts`, `middleware.ts`, `lib/env.ts`, `lib/auth.ts`, `lib/csrf.ts`, `lib/redis.ts`, `lib/db/postgres.ts`, `lib/db/pg.ts`, `lib/db/activitiesPg.ts`, `lib/security/verifyWebhookSignature.ts`, `lib/auditLog.ts`, `lib/internalAuth.ts`, `lib/upload.ts`, `.env.production`, `.env.local.example`
- **目录枚举**：完整枚举 `app/`, `lib/`, `components/`, `scripts/`, `tests/`, `supabase/migrations/`, `public/`, `docs/`
- **Grep 审计**：`process.env.*` 共 30+ 处直接读取、`any` 类型共 ~30 处
- **关联文档**：`docs/ENGINEERING_CONTEXT.md`, `docs/HANDOFF_2026-07-25.md`

## 附录 B：未执行的检查（建议下一轮执行）

- ⏸️ **未跑 `npx tsc --noEmit`**：无法给出类型错误的精确数量
- ⏸️ **未跑 `npm run build:no-lint`**：无法验证构建可成功
- ⏸️ **未跑 `npm run test:e2e`**：无法验证当前 E2E 通过率
- ⏸️ **未读 `admin-pw.txt`**：按"零猜测"原则不做内容猜测
- ⏸️ **未读 `mercenary_h5_project.pem.archived`**：同上
- ⏸️ **未读 `aws_rds_init/` 下所有 `.sql`**：仅顶层 schema 已扫

---

> **报告结束**。本报告为接续 Sprint 的安全基线，建议在 Sprint 启动会上逐项 review。
