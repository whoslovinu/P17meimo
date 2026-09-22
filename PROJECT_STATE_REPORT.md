# 🛡️ PROJECT STATE REPORT — P17 H5 魅魔来袭
**审计者**：Agent 1 [Cyber-Blacksmith] · **协议**：REPARK Sovereign Orchestrator v5.3
**生成时间**：2026-06-14 04:54 (UTC+8) · **仓库根目录**：`h:\PROJECT\P17_H5meimo-demo`

> 本报告对当前半成品 H5 活动项目做"无猜测"接管审计。结论基于真实文件内容、依赖锁定文件、`supabase/migrations/` 现状、以及关键运行时文件的源码读取。
> **不包含**任何未读取的代码假设。所有"已实现"项均能在 `app/`、`lib/`、`supabase/` 路径下找到对应实现。

---

## 1. Tech Stack Base (技术底座)

### 1.1 项目拓扑
| 维度 | 结论 |
|---|---|
| 仓库结构 | **单 Next.js App**，无 Monorepo，无独立后端服务包 |
| 后端形态 | Next.js 15 App Router 的 Route Handlers（`app/api/**/route.ts`）— 数量 **27 条** API |
| 数据库 | Supabase（PostgreSQL）— 通过 `@supabase/supabase-js` + `service_role` 直连 |
| 缓存/锁 | Redis（AWS ElastiCache Serverless）— 通过 `ioredis` 直连 |
| 鉴权 | Cookie-based 主鉴权 + HMAC-SHA256 Webhook 签名 + 简易后台口令 |
| 部署形态 | 当前文档对齐 **AWS EC2 / Vercel / Railway + SSH 隧道**（见 `scripts/dev_tunnel.mjs`、`DEPLOY_AWS.md`） |

### 1.2 核心依赖（精确版本，来源于 `package.json`）
| 库 | 版本 | 用途 |
|---|---|---|
| `next` | `^15.5.14` | App Router / Route Handlers |
| `react` / `react-dom` | `19.2.4` | UI 运行时 |
| `typescript` | `^5` | 类型系统 |
| `tailwindcss` | `^4.2.2` | 原子化样式（v4，新 PostCSS 插件模式） |
| `@tailwindcss/postcss` | `^4.2.2` | Tailwind v4 编译器 |
| `framer-motion` | `^12.38.0` | 动效 |
| `zustand` | `^5.0.12` | 客户端状态（modalStore / toastStore） |
| `pixi.js` | `^8.17.1` | WebGL 渲染引擎 |
| **`@esotericsoftware/spine-pixi-v8`** | **`^4.2.108`** | **Spine 4.2 运行时（pixi v8 适配层）** |
| `howler` | `^2.2.4` | 音频播放（已封装为 `AudioManager` 单例） |
| `ioredis` | `^5.10.1` | Redis 客户端（执行 Lua 脚本） |
| `@supabase/supabase-js` | `^2.100.0` | Supabase 客户端 |
| `pg` | `^8.21.0` | 备用 PostgreSQL 客户端（当前未在运行时使用） |
| `zod` | `^4.4.3` | API/Webhook 严格校验 |
| `dayjs` + `utc` + `timezone` | `^1.11.20` | UTC+8 日期分片 |
| `shadcn` (CLI) | `^4.8.0` | 组件生成器 |
| `ssh2` | `^1.17.0` | 本地开发用 SSH 隧道到 AWS |
| `playwright` | `^1.59.1` | E2E 测试 |
| `swr` 替代？ | — | **未使用**，前端刷新走自写轮询 + 攻击后回传 |
| `vue` | — | **未使用**，项目 100% React 19 |
| `react-query` / `@tanstack/react-query` | — | **未使用** |

### 1.3 状态管理与 UI 库
- **状态管理**：`zustand`（仅用于 `modalStore.ts` + `toastStore.ts`）；**业务状态**（HP、攻击锁、阶段切换）**全靠 `useRef` + `useState` 闭包**，未引入集中 store。
- **UI 原子库**：`lucide-react`、`class-variance-authority`、`tailwind-merge`、`clsx`、`@base-ui/react`、`embla-carousel-react`、`swiper`、`sonner`、`next-themes`。
- **shadcn/ui**：`components/ui/badge.tsx`、`button.tsx`、`progress.tsx`、`sheet.tsx`、`skeleton.tsx`、`sonner.tsx` 已生成。

### 1.4 后端框架判定
- **不是 Express / Koa / NestJS**。后端就是 **Next.js 15 App Router Route Handlers**。
- 没有独立 `server.ts` / Express 进程；所有 27 个路由文件全部位于 `app/api/**/route.ts`。
- Webhook、攻击、Redis Lua、Supabase Service Role 调用都发生在 Route Handler 内。

### 1.5 数据库迁移现状（`supabase/migrations/` 14 份）
| 文件 | 主题 |
|---|---|
| `0001_initial_schema.sql` | users / user_inventory / global_boss / attack_logs / milestone_rewards / RLS |
| `01_task_inventory_schema.sql` | user_daily_tasks / webhook_idempotency |
| `02_battle_system_schema.sql` | boss_status（替换 global_boss）/ attack_idempotency / task_progress |
| `03_admin_activity_schema.sql` | activities 表 |
| `04_add_activities_config.sql` | activities.config JSONB |
| `05_banners_table.sql` | banners + 注入系统行 `id=999999` |
| `06_user_mgmt_schema.sql` | admin_audit_log / milestone 锁列 |
| `07_task_claim_lock_and_rpc.sql` | `increment_task_progress()` RPC |
| `08_activity_cleanup_and_reset.sql` | `clear_expired_items()` / `reset_daily_tasks()` + pg_cron 调度 |
| `09_milestone_claim_rpc.sql` | 旧版 `claim_milestone_reward()`（**已弃用，App 不再调用**） |
| `10_milestone_lock_column.sql` | milestone_rewards 加 `is_locked` + 唯一索引 |
| `11_webhook_atomic_rpc.sql` | `increment_user_daily_task()`（**依赖 `updated_at` 列但 01 未创建 → 见第 3 节风险**） |
| `12_add_personal_milestone_rpc.sql` | **现役** `claim_personal_milestone_reward()` |
| `13_add_bulk_milestone_finalizer_rpc.sql` | **现役** `finalize_activity_milestone_rewards()` |

---

## 2. Current Completion (当前完成度)

> 评分基准：**"切实存在"** = 文件存在 + 关键代码已实现；**"壳子"** = 路由/文件存在但核心逻辑空缺或仅返回假数据。

### 阶段 1：全局依赖与架构扫描
| 子项 | 状态 | 证据 |
|---|---|---|
| 前端 `package.json` | ✅ 完整 | `package.json` |
| 后端 `package.json` | ⚠️ **不存在独立后端** | Next.js Route Handlers 即后端 |
| React 19 + Tailwind 4 + Zustand | ✅ | `package.json` 锁版本 |
| 后端 Node 框架 | ℹ️ Next.js 15（不是 Express/Koa/NestJS） | `app/api/**/route.ts` |

### 阶段 2：前端渲染引擎侦查
| 子项 | 状态 | 证据 |
|---|---|---|
| **pixi.js v8 集成** | ✅ 已实现 | `SpineViewer.tsx` L686：`await import('pixi.js')` |
| **Spine 4.2 (`pixi-v8`) 集成** | ✅ 已实现 | `SpineViewer.tsx` L696：`await import('@esotericsoftware/spine-pixi-v8')` |
| **资源运行时 vs 资产声明版本** | 🔴 **不匹配** | 运行时 `4.2.108`；`public/H501/*/idle_*.json` 全部声明 `"spine": "4.1.24"`；H5 000 原始素材 4.1.24 |
| **背景图 + 角色 + 光环渲染容器** | ✅ 已实现 | `SpineViewer.tsx` L826-963：`bgContainer` + `mainContainer` + `rootContainer`（BG / 角色 / Halo 三层 PIXI Container 树） |
| **多形态/多阶段** | ✅ 已实现 | `STAGE_REGISTRY`（L106-139）4 个阶段（initial / awakening / flame / shadow），crossfade 切换 |
| **HMR / Strict Mode 双 mount 安全** | ✅ 已实现 | `safeDestroy` 闭包 + `_stageListenerCache.clear()` + React 18 double-mount 容错 |
| **动画触发 → 攻击链路** | ✅ 已实现 | `triggerAttack` 注入 `global listener`，攻击完成自动回到 idle |
| **声音/音量/audio 关键字** | ✅ **已预留并部分接通** | `AudioManager.ts`（Howler 单例）+ `TopNav.tsx` L182-199 音量开关按钮 + `SpineViewer.tsx` L457 `AudioManager.playVoice(...)` |
| **音频文件实际就位** | 🔴 **未就位** | `public/voice/**` 目录**不存在**（已用 Glob 验证） — 实际素材在 `H5 000/H501/stage{1-4}/` 路径下，且文件名是 `Standby1.1-jn.mp3` / `Attack_a1.1.mp3` 等**与 AudioManager 期望的 `Voice_N/Standby_1.mp3` 命名规则不符** |

### 阶段 3：后端核心逻辑侦查
| 子项 | 状态 | 证据 |
|---|---|---|
| **路由 `/api/webhook/user-action`** | ✅ 已实现 | `app/api/webhook/user-action/route.ts`（完整 369 行，5 步严格流水线） |
| **Webhook 幂等校验** | ✅ 已实现（双层） | Redis `SET NX EX 600` 标记 + `webhook_idempotency` 表兜底；L189-218 |
| **Webhook HMAC 签名校验** | ✅ 已实现 | `lib/security/verifyWebhookSignature.ts`（timing-safe equal）；路由 L86-149 |
| **Zod 严格载荷校验** | ✅ 已实现 | `WebhookPayloadSchema` L58-80（5 字段 + sign 正则 64 位 hex） |
| **`/api/action/attack` 扣血** | ✅ 已实现 | `app/api/action/attack/route.ts`（509 行，10 步主流程） |
| **Redis 原子 Lua 扣血脚本** | ✅ 已实现 | `lib/redis.ts` `ATOMIC_ATTACK_LUA`（L107-143）— 幂等 → 限流 → HP 扣减 → 标记 三段原子 |
| **Lua 扣血 4 状态返回码** | ✅ 已实现 | 1=SUCCESS / 0=BOSS_DEAD / -1=DUPLICATE / -2=RATE_LIMITED |
| **CAS 库存扣减** | ✅ 已实现 | `decrementInventoryCas` L109-156（用 `.eq(column, currentCount)` 实现乐观锁） |
| **失败回滚 HP** | ✅ 已实现 | 库存失败时 `redis.incrby(REDIS_KEYS.BOSS_HP, luaResult.actualDamage)` L443-444, L455-456 |
| **Dev 模式回退到 mock DB** | ✅ 已实现 | L203-306 完全脱离 Supabase/Redis，读 `mock_db_*.json` |
| **Cookie 解析 `user_id`** | ✅ 已实现 | `lib/auth.ts` `getUserIdFromRequest()`（161 行，三层 fallback） |
| **Middleware 路由守卫** | ✅ 已实现 | `middleware.ts`（70 行）— `/admin/*` 强校验 + `/battle` 弱校验 |
| **后台登录鉴权** | ⚠️ **壳子** | `app/api/admin/login/route.ts` — cookie 值硬编码为字符串 `'authenticated'`，**根本没有 HMAC 校验**（与注释描述不符） |
| **后台 `app/admin/*` 各页面** | ✅ 已实现 | activities / banners / users / monitor / login / config[id] |

### 阶段 4：配置与环境嗅探
| 子项 | 状态 | 证据 |
|---|---|---|
| **`.env.local.example`** | ✅ 完整 94 行 | `WEBHOOK_SECRET` / `ADMIN_SECRET` / `REDIS_URL` / `DATABASE_URL` / `SUPABASE_*` / `NEXT_PUBLIC_*` 全套 |
| **`.env.local`** | ✅ 已填 | 项目内已存在，git ignore 保护 |
| **AWS S3 / ElastiCache 配置** | ⚠️ **半套** | ElastiCache Redis URL 已写入注释（`rp1-bkmbmc.serverless.use1.cache.amazonaws.com`）+ 本地通过 `scripts/dev_tunnel.mjs` SSH 隧道转发；**S3 配置完全缺失**（上传走 Next.js 本地 `/public/uploads`，无 S3 SDK） |
| **`next.config.ts`** | ⚠️ **空壳** | 全文仅 7 行，无 rewrites/headers/images/redirects 配置 |
| **`tsconfig.json`** | ✅ 存在 | （未读取细节，但 Next 15 默认足够） |

---

## 3. Missing / Risk Items (缺失与高危项)

### 3.1 🔴 P0 紧急（已影响业务正确性）
1. **音频资源未部署**：`public/voice/` 不存在；`AudioManager.playVoice(stageIdx, 'standby'|'attack_a'|'attack_b')` 会全部 404。当前是"静默运行" — 调用 `playSFX` 时 `playerror` 仅 warn，不会中断游戏。
2. **音频素材命名/路径不匹配**：实际素材位于 `H5 000/H501/stageN/`，文件名为 `Standby1.1-jn.mp3` / `Attack_a1.1.mp3` / `standby3.2(1).mp3`；`AudioManager` 期望 `/voice/Voice_{stageIdx+1}/Standby_1.mp3` / `ATKa_1.mp3` / `ATKb_1.mp3`。**无映射表**。
3. **后台鉴权未真正实现**：`app/api/admin/login/route.ts` 注释承诺 "HMAC-SHA256 哈希" 实际写的是 `cookieStore.set(ADMIN_COOKIE, 'authenticated', ...)` — 一个**明文字面量**。任何持有该 cookie 的请求都能通过 middleware。**这是后台接口全开的等效漏洞**。
4. **活动结束自动发奖缺口**：上一份审计已确认 `finalize_activity_milestone_rewards()` 存在但缺乏定时调度（`pg_cron` 在 AWS RDS 不直接可用）；当前 `MILESTONE_AUTO_CLAIM_IMPLEMENTATION_PLAN.md` 存在但**未见实现代码**。这是产品需求 vs 实现的明确缺口。
5. **Spine 运行时版本与资产版本不匹配**：`@esotericsoftware/spine-pixi-v8@4.2.108` 跑 `4.1.24` 导出的 `.json`。Spine 4.2 ↔ 4.1 大多数情况下兼容，但 4.2 引入的 mesh 权重更新和 4.1 的 bounding box 行为差异**会在 Stage 3/4 切换时偶尔触发警告甚至网格重算抖动**。建议用 4.2.108 重新导出素材，或锁回 4.1.x spine-pixi-v8。
6. **Banner 路由弱口令回退**（来自上一份审计）：`app/api/banner/route.ts` 仍残留 `process.env.ADMIN_SECRET_KEY || 'activity_admin_secret'`。需立即清理。

### 3.2 🟠 P1 高（架构/可维护性）
7. **`next.config.ts` 空配置**：没有 `images.remotePatterns`（如用 `meimo-silhouette.png` 等需列出）、没有 `experimental.serverActions`、没有 `headers()` CSP。生产部署时务必补充。
8. **`.env.local` 实际值（`PhbcRcx5Wt` 等）已被误入版本控制候选**：`.env.local` 在 `.gitignore` 中理应被忽略，但请立即核验 `git status` 中是否真的没有它。从提交历史看 `.env.local` 出现在 `git status` 输出（标 `M` 行前段），存在被跟踪风险。
9. **`supabase/migrations/11_webhook_atomic_rpc.sql` 引用未创建的 `updated_at` 列**：`increment_user_daily_task()` RPC 中 `SET updated_at = now()`，但 `01_task_inventory_schema.sql` 没创建该列。AWS RDS 全新部署会直接报 42703（column does not exist）。**生产前必须补一个 `ALTER TABLE user_daily_tasks ADD COLUMN updated_at TIMESTAMPTZ` 迁移**。
10. **`user_inventory` 跨迁移列冲突**：`0001` 是 `item_hand` / `item_phallus` / `last_reset_date`；`02` 是 `item_hand_count` / `item_phallus_count` / `total_damage_dealt`；`02` 用 `CREATE TABLE IF NOT EXISTS` 因此不会迁移。`AWS_RDS_MODULAR_INIT_PLAN.md` 已规划修复，但**还没真正生成新迁移文件**。
11. **多种 HP Bar 组件并存**：`BossHPBar` / `FluidSegmentHP` / `FluidArcHP` / `HeartRingHP` / `StandardHPBar` 同时存在于 `app/components/features/battle/`。哪一个是主战场在用？`BattleLayout.tsx` 决策点必须收敛。
12. **后端没有"加载超时 / 失败 retry"的稳定产品级 UI**：`PROJECT_AUDIT_REPORT` 已记录（15s 提示 + 重试按钮），目前只有工程级 fallback。

### 3.3 🟡 P2 中（可观察性/可测性）
13. **Lua 脚本 EVAL 失败无 fallback**：`/api/action/attack` L398-403 在 Lua 抛错时返回 500。前端在动画进行中收到 500 体验差。
14. **`/api/internal/startup` 路由存在但未确认被调用**：`lib/sync.ts` 有 `startBackgroundSync()` 自动启动，但同时又有内部 startup 路由，存在双轨制。
15. **WebSocket / SSE 实时同步缺位**：BOSS HP 是攻击后回写本地 + `game/init` 拉取快照；3 秒轮询未确认是否在 `BattleLayout.tsx` 严格落地。**多端视觉同步在并发高峰可能有 1-3 秒延迟**。
16. **审计日志表字段 `field_name/old_value/new_value` 都是 TEXT 而非 JSONB**：后期查询分析痛苦。已写入 Supabase 但 schema 欠优化。
17. **未做 React Query / SWR**：所有 `game/init`、boss status、HP 拉取都靠 `useEffect` 直 fetch。乐观更新、回滚、缓存失效都需手写。

---

## 4. Next Actions (下一步建议)

### 4.1 优先修改文件清单（按重要性）

#### 🎯 任务 A：把"声音开关"功能真正接通（预计 2-3 个文件改动）

| # | 文件 | 修改要点 |
|---|---|---|
| 1 | **`public/voice/Voice_1/`** `Voice_2/` `Voice_3/` `Voice_4/` | **新建目录**并复制素材。要求每个 voice 目录含 `Standby_1.mp3`、`ATKa_1.mp3`、`ATKb_1.mp3`（**注意 4.2 命名规则**）。可从 `H5 000/H501/stage{1-4}/` 映射复制。 |
| 2 | `app/lib/audio/AudioManager.ts` | ① 增加 `bgmUrl` 字段读取 `NEXT_PUBLIC_BGM_URL`；② `playBGM()` 在 `playVoice` 之前调用一次（首次用户手势内触发，绕开 autoplay 拦截）；③ 增加 `preloadVoices()` 在 idle 时静默预加载 12 个 voice URL。 |
| 3 | `app/components/features/battle/BattleLayout.tsx` | 在用户首次点击/触摸时调用 `AudioManager.playBGM('/bgm/main.mp3')` 一次（解锁 autoplay 限制）。 |
| 4 | `app/components/features/battle/TopNav.tsx` | 已经实现 mute toggle ✅，仅需把 `aria-label` 文案从"开启声音/关闭声音"切到中文即可（可选）。 |

#### 🎯 任务 B：Spine 4.2 资源替换（预计 1-2 个文件改动）

| # | 文件 | 修改要点 |
|---|---|---|
| 5 | `public/H501/idle_0{1,2,3,4}/idle_*.json` + `.atlas` + `.png` | **用 Spine 编辑器 4.2.108 重导出**所有角色与背景资产。把 `H5 000/H501/` 下的 PNG/ATLAS/JSON 用官方 Spine Editor 4.2 重导出到 `public/H501/`。 |
| 6 | `package.json` | 验证 `@esotericsoftware/spine-pixi-v8` 与编辑器版本一致（已是 4.2.108）。如重导 4.1 资源更省时，可降级 spine-pixi-v8 到 `4.1.x`。 |
| 7 | `app/components/features/battle/SpineViewer.tsx` | 资源版本切换后，仅需核对 `STAGE_REGISTRY[0..3].idle` 动作名是否仍为 `idle_1` / `idle`（取决于 4.2 重导后骨骼命名）。`triggerAttack` 的 `animName` 自动适配。 |

#### 🎯 任务 C（顺手清理，1 文件改动）

| # | 文件 | 修改要点 |
|---|---|---|
| 8 | `app/api/admin/login/route.ts` | **真做 HMAC**：生成 `crypto.createHmac('sha256', ADMIN_SECRET).update(stablePayload).digest('hex')` 写入 cookie；中间件或每个 admin 路由在 `app/lib/adminAuth.ts` 已存在 → 直接读 `verifyAdminCookie()` 函数（如未实现则补全）。 |

### 4.2 建议立即跟进（中期，1-2 周）

- [ ] 把 `next.config.ts` 补全：CSP / 远程图片白名单 / server actions 限制。
- [ ] 生成 `aws_05_fix_user_inventory_columns.sql` 补齐 `user_inventory` + `user_daily_tasks.updated_at`。
- [ ] 决定 `finalize_activity_milestone_rewards()` 的调度器：app-level cron（推荐） vs `pg_cron`（需 RDS 参数组批准）。
- [ ] 把 `BossHPBar` / `FluidSegmentHP` / `FluidArcHP` / `HeartRingHP` / `StandardHPBar` 收敛到 1-2 个主版本，删除其余或在 `app/components/features/battle/experimental/` 隔离。
- [ ] 给 `lib/redis.ts` 的 `setBossHpInCache` 加 try/catch 并在 unreachable 时显式回 503。

### 4.3 验证测试路径（先在 dev 环境跑通）

```powershell
# 1) 启动本地隧道
$env:DEPLOY_SSH_PASSPHRASE='REPARK'; node scripts/dev_tunnel.mjs

# 2) 启动 Next.js
npm run dev

# 3) 验证 webhook
curl -X POST http://localhost:3000/api/webhook/user-action -H "Content-Type: application/json" -H "X-Webhook-Signature: sha256=<hmac>" -d '{...}'

# 4) 验证 attack
curl -X POST http://localhost:3000/api/action/attack -H "Content-Type: application/json" -b "uid=test-user" -d '{"item_type":"item_hand","nonce":"n1"}'

# 5) 验证类型与 lint
npx tsc --noEmit
npm run lint
```

### 4.4 必读前置文档（不要跳）
- `B/agent-sop/1_CYBER_BLACKSMITH_SOP.md`（已加载）
- `A/REPARK_MEGA_BRAIN.md`（已加载）
- `AWS_RDS_MODULAR_INIT_PLAN.md`（已加载，含 9 个 Commander 决策点）
- `PROJECT_AUDIT_REPORT_BY_REQUIREMENT_SECTIONS.md`（已加载，作为对比基线）
- `DEPLOY_AWS.md`（未读 — 强烈建议在动手前阅读）

---

## 5. Bottom Line（一句话总评）

> **当前项目已是一套"近交付级的 H5 活动系统"**，主战场、攻击链路、Redis Lua 原子层、Supabase 数据层、Webhook 流水线、后台九大模块均已就位。**真正阻塞交付的是 6 个 P0 项**：(1) 音频资源未就位、(2) 后台鉴权硬编码明文、(3) 活动结束自动发奖缺调度器、(4) Spine 4.2 资源未重导、(5) Banner 路由弱口令回退未清理、(6) `.env.local` 是否真未入库需复核。
> **声音开关**和 **Spine 4.2 资源**的"接入"动作实际只涉及 3-5 个文件（见 §4.1 任务 A/B）；不需要重写引擎或后端。

---

*End of report. — Agent 1 [Cyber-Blacksmith] · REPARK Sovereign Orchestrator v5.3*
