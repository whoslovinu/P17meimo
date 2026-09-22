# 全栈功能矩阵与优化升级报告

> **审计性质**: 纯只读体检扫描（REPARK 6.0 P0）
> **执行日期**: 2026-07-27
> **扫描范围**: `app/components/features/{battle,game,home,ui}` / `app/api/*` / `app/admin/*` / `lib/db/*`
> **规则**: 严禁任何代码修改 — 禁止任何部署

---

## 目录

1. [功能地图 (Functional Map)](#1-功能地图-functional-map)
2. [隐藏断层与风险 (Gaps & Fragilities)](#2-隐藏断层与风险-gaps--fragilities)
3. [测试覆盖缺口 (Test Gaps)](#3-测试覆盖缺口-test-gaps)
4. [升级演进建议 (Upgrade Roadmap)](#4-升级演进建议-upgrade-roadmap)

---

## 1. 功能地图 (Functional Map)

### 1.1 前台核心功能

| # | 功能模块 | 前端组件 | API 路由 | DB 表 | 状态 |
|---|---|---|---|---|---|
| F01 | 战斗攻击 | `WeaponBar` → `BattleLayout` | `POST /api/action/attack` | `user_inventory`, `attack_logs`, `boss_status` | ✅ 已上线 |
| F02 | 战斗 HP 展示 | `StandardHPBar` → `BattleLayout` | `GET /api/battle/init` | `boss_status` (Redis warm) | ✅ 已上线 |
| F03 | 战斗轮询同步 | `BattleLayout` (3s polling) | `GET /api/battle/init` | `boss_status` | ✅ 已上线 |
| F04 | Spine 动画渲染 | `SpineViewer` | 无 (静态 `/H501/`) | 无 | ✅ 已上线 |
| F05 | 形态切换展示 | `FormSelector` | 无 (前端计算) | `user_inventory` (via init) | ✅ 已上线 |
| F06 | 伤害浮动数字 | `FloatingDamage` | 无 | 无 | ✅ 已上线 |
| F07 | 粒子特效 | `ParticleEngine` | 无 | 无 | ✅ 已上线 |
| F08 | BGM 切换 | `BGMController` | 无 (静态 `/audio/`) | 无 | ✅ 已上线 |
| F09 | 排行榜 | `LeaderboardSheet` | `GET /api/battle/leaderboard` | `attack_logs` | ✅ 已上线 |
| F10 | 每日任务领取 | `SubPageModal`, `TaskSheet` (死代码) | `POST /api/battle/task-claim` | `user_daily_tasks`, `user_inventory` | ✅ 已上线 |
| F11 | 充值/消耗进度 | `SubPageModal` | `GET /api/user/status` | `user_daily_tasks` | ✅ 已上线 |
| F12 | 里程碑奖励领取 | `MilestoneBar`, `SubPageModal` | `POST /api/game/milestone/claim` | `milestone_rewards`, `user_inventory` | ✅ 已上线 |
| F13 | 活动倒计时 | `TopNav` (countdown) | `GET /api/time` | 无 | ✅ 已上线 |
| F14 | 音量控制 | `TopNav`, `VolumePopover` | 无 (localStorage) | 无 | ✅ 已上线 |
| F15 | Toast 通知 | `ToastContainer` | 无 | 无 | ✅ 已上线 |
| F16 | 活动结束页 | `ActivityEndPage` | 无 | 无 | ✅ 已上线 |
| F17 | 加载屏预加载 | `LoadingScreen` | 无 (fetch static assets) | 无 | ✅ 已上线 |
| F18 | 首页 Banner 轮播 | `GameBannerCarousel`, `H5Banner` | 无 (server-rendered) | `banner_items` (admin 配置) | ✅ 已上线 |
| F19 | 首页内容卡片 | `HomePageClient` | 无 (全部硬编码) | 无 | ⚠️ 静态原型 |
| F20 | 活动规则页 | `SubPageModal` (rules tab) | 无 (from init) | 无 | ⚠️ 未强制显示 |

---

### 1.2 后端 API 路由

| # | 路由 | 方法 | 核心功能 | DB 写 | Redis 写 | 安全 |
|---|---|---|---|---|---|---|
| A01 | `/api/battle/init` | GET | 初始化战斗状态 (HP/inventory/milestone/task/forms) | — | ✅ (读) | Cookie HMAC |
| A02 | `/api/battle/leaderboard` | GET | 全服伤害排行 top-50 | — | ✅ (读) | Cookie HMAC |
| A03 | `/api/battle/task-claim` | POST | 领取每日任务奖励 | `user_daily_tasks`, `user_inventory` | — | Cookie HMAC |
| A04 | `/api/battle/reward-claim` | POST | 领取充值/消耗里程碑奖励 | `milestone_rewards`, `user_inventory` | — | Cookie HMAC |
| A05 | `/api/battle/attack` | POST | *(已废弃 alias → /api/action/attack)* | — | — | — |
| A06 | `/api/action/attack` | POST | 原子化攻击 (damage roll + item decrement + HP update + attack log) | `user_inventory`, `attack_logs`, `boss_status` | ✅ (Lua HP update + rate limit + idempotency) | Cookie HMAC |
| A07 | `/api/boss/status` | GET | 获取 Boss 状态 | — | ✅ (读) | Cookie HMAC |
| A08 | `/api/boss/sync` | POST | *(存在但未被前端调用)* | — | — | — |
| A09 | `/api/user/status` | GET | 用户每日充值/消耗进度 | — | — | Cookie HMAC |
| A10 | `/api/game/milestone/claim` | POST | 领取里程碑奖励 | `milestone_rewards`, `user_inventory` | — | Cookie HMAC |
| A11 | `/api/webhook/user-action` | POST | 主站 webhook 回调 (充值/消费) | `user_inventory`, `user_daily_tasks`, `user_alias` | ✅ (processed 标记) | HMAC-SHA256 签名 |
| A12 | `/api/time` | GET | 服务器时间 (clock sync) | — | — | 公开 |
| A13 | `/api/admin/login` | POST | Admin 登录 (密码 → HMAC cookie) | — | ✅ (rate limit) | 密码 hash + 5/min 限速 |
| A14 | `/api/admin/activity/update` | PUT | 创建/更新活动 | `activities` | ✅ (config cache) | HMAC token |
| A15 | `/api/admin/activity/set-active` | POST | 激活/停用活动 | `activities` (transaction) | ✅ (config cache flush) | HMAC token |
| A16 | `/api/admin/activity/finalize` | POST | 最终结算里程碑 | `milestone_rewards` | — | HMAC token + dev-only force |
| A17 | `/api/admin/banners/update` | POST | 更新 Banner 配置 | `banner_items`, `banner_config` | — | HMAC token |
| A18 | `/api/admin/boss/update-hp` | POST | 手动覆盖 Boss HP | `boss_status` | ✅ (write-through) | HMAC token |
| A19 | `/api/admin/user/update` | POST | 更新用户道具/状态 | `user_inventory` | — | HMAC token |
| A20 | `/api/admin/users/milestone` | POST | 管理员解锁/锁定里程碑 | `milestone_rewards` | — | HMAC token |
| A21 | `/api/admin/stats` | GET | 仪表盘统计 (KPI) | — | — | HMAC token |
| A22 | `/api/admin/upload` | POST | 上传 ZIP/图片 | 文件系统 | — | HMAC token |
| A23 | `/api/internal/owner-command` | POST | Owner 专用命令 (lock admin/broadcast) | — | ✅ | OWNER_SECRET + nonce |
| A24 | `/api/diag/whoami` | GET | *(已注册但功能未完成)* | — | — | — |
| A25 | `/api/dev-login` | POST | 开发环境快速登录 (dev bypass) | — | — | `ADMIN_DEV_BYPASS=1` only |
| A26 | `/api/test/*` | * | 测试端点 (全部 behind dev guard) | varies | — | NODE_ENV !== production |

---

### 1.3 管理后台页面

| # | 页面 | 功能 | 对应 API |
|---|---|---|---|
| M01 | `/admin` | Dashboard: KPI 统计、boss HP 实时监控 | `/api/admin/stats` |
| M02 | `/admin/activities` | 活动列表、状态切换、创建、删除 | A14, A15, A16 |
| M03 | `/admin/activities/[id]/config` | 活动配置编辑器 (HP/里程碑/概率/Spine 形态/规则) | A14 |
| M04 | `/admin/banners` | Banner CRUD + 全局配置 | A17 |
| M05 | `/admin/users` | 用户列表、道具调整、状态封禁、里程碑管理、数据导出 | A19, A20, `/api/admin/user/export` |
| M06 | `/admin/monitor` | 实时 Boss HP (Redis vs PG 对比) | A01, A07, A18 |
| M07 | `/admin/login` | 登录页面 | A13 |

---

### 1.4 数据层 (lib)

| 文件 | 职责 | 关键函数 |
|---|---|---|
| `lib/db/pg.ts` | PostgreSQL 所有操作 | `ensureUserExists`, `getBossStatus`, `updateBossStatus`, `atomicAttack` (Lua), `getUserInventory`, `upsertUserInventory`, `incrementUserDamage`, `getMilestoneRewards`, `hasUnclaimedMilestone`, `upsertMilestoneReward`, `getActiveActivity`, `setActivityActive`, `getDailyTask`, `incrementDailyTask` |
| `lib/db/userPg.ts` | 用户数据 API 封装 | `listUsers`, `getUserById`, `claimMilestone`, `incrementTotalDamage`, `updateUserInventory`, `updateUserTaskProgress` |
| `lib/db/activitiesPg.ts` | 活动数据 API 封装 | `listActivities`, `getActivityById`, `getActiveActivity`, `insertActivity`, `updateActivity`, `deleteActivity` |
| `lib/redis.ts` | Redis 原子操作 | `atomicAttack` (Lua script), `isWebhookProcessed`, `markWebhookProcessed`, `setBossHpCache`, `rateLimit`, `authenticateInternalCaller`, `checkAdminLock` |
| `lib/auth.ts` | 用户鉴权 | `authenticate`, `getOptionalUserId`, `resolveUserId` (re-exported from `userIdentity`) |
| `lib/userIdentity.ts` | UUID 派生 SSOT | `toUuid`, `seedUuid` (已归一, 2026-07-25 完成) |
| `lib/adminAuth.ts` | Admin HMAC 鉴权中间件 | `requireAdminAuth`, `checkAdminLock` |
| `lib/adminToken.ts` | Admin token 构建/验证 | `buildAdminToken`, `verifyAdminToken`, `ADMIN_DEV_BYPASS` |
| `lib/security/verifyWebhookSignature.ts` | Webhook HMAC-SHA256 验签 | `verifyWebhookSignature` |
| `lib/auditLog.ts` | 审计日志写入 | `insertAuditLog`, `insertWebhookAudit` |
| `lib/actions/battleActions.ts` | Server Action 攻击封装 | `performAttackAction` |
| `lib/env.ts` | 环境变量集中访问 | `env()` 方法 (仅部分覆盖, 14 处散落 `process.env.*`) |

---

## 2. 隐藏断层与风险 (Gaps & Fragilities)

### 🔴 高危 (High)

#### GAP-H1: `dailyLimit` 在前端可配置,后端不执行 — 玩家可绕过每日道具上限

**位置**: `app/admin/activities/[id]/config/page.tsx` (admin 配置) + `lib/db/pg.ts:incrementDailyTask` (后端写入)

**描述**: Admin 可在活动配置中为每个道具设置 `dailyLimit` (每用户每日获取上限)。但 `incrementDailyTask` 函数只做 `+1` 累加,没有任何分支去检查当前 `daily_money_recharged` 是否已超限。

**后果**: 玩家在达到每日上限后,继续触发充值/消费事件,道具仍会持续发放。

**修复方向**: 在 `incrementDailyTask` 中加 `SELECT daily_money_recharged FROM user_daily_tasks WHERE user_id = $1` 检查,超限则跳过累加。

---

#### GAP-H2: `hasUnclaimedMilestone` 存在 TOCTOU 竞态 — 并发请求可能双重领取同一里程碑

**位置**: `lib/db/pg.ts:256-293`

**描述**: 函数执行三步非原子读:
1. `computeUserTotalDamage(userId)` → SELECT SUM from attack_logs
2. `getMilestoneRewards(userId)` → SELECT from milestone_rewards
3. 调用者调用 `upsertMilestoneReward`

第一步和第二步之间有竞态窗口,两个并发请求可能都看到同一里程碑为 unclaimed,然后都尝试写入。PostgreSQL `ON CONFLICT DO UPDATE` 会序列化其中一笔,但调用者无法区分"正常领取"和"被并发抢先"。

**修复方向**: 用 `SELECT ... FOR UPDATE` 锁住 milestone_rewards 行,或在 upsert 中用 `RETURNING` 确认写入成功。

---

#### GAP-H3: `/api/battle/init` 0 命中 — 轮询状态完全不可观测

**位置**: `app/api/battle/init/route.ts`

**描述**: 生产日志中 `GET /api/battle/init` 0 命中 (ACTIVE_CONTEXT §2.2 P0-3)。前端 `BattleLayout` 每 3s polling,但日志层没有任何访问记录。

**后果**: 无法判断前端是否真的在轮询,无法排查"页面刷不出来"问题。

**修复方向**: 在 `init` route 中加 `audit_log` 写入,或引入 pino 结构化日志。

---

### 🟠 中危 (Medium)

#### GAP-M1: Admin 活动 `status` 与 `config.isGlobalEnabled` 两套开关脱节

**位置**: `app/admin/activities/[id]/config/page.tsx` (双开关) + `lib/db/pg.ts:getActiveActivity` (只检查 JSONB 字段)

**描述**: Admin UI 有两个独立的"激活"机制:
- 活动配置页的 `isGlobalEnabled` 布尔开关 → 写入 `activities.config.isGlobalEnabled`
- 活动列表页的状态切换 → 写入 `activities.status`

Battle API 的 `getActiveActivity()` 只检查 JSONB 字段,不检查 `status` 列。

**后果**: Admin 停用一个活动后,若 JSONB 的 `isGlobalEnabled` 仍为 `true`,Battle API 仍会把它当作活跃。

---

#### GAP-M2: Spine 形态阈值在客户端计算,无服务端校验

**位置**: `app/components/features/battle/SpineViewer.tsx` (formThresholds 读取) + `lib/db/pg.ts:getActiveActivity` (阈值存储在 config)

**描述**: 形态阶段切换阈值 (`stage2: 80%`, `stage3: 50%`, `stage4: 25%`) 由 `SpineViewer` 从 activity config 读取后在前端计算。服务端不校验这些值。

**后果**: 修改版客户端可以绕过形态切换阈值,直接展示任意阶段动画。

---

#### GAP-M3: Webhook `isWebhookProcessed` Redis 失败时为 fail-open

**位置**: `lib/redis.ts:395-406`

**描述**: `isWebhookProcessed(eventId)` 在 Redis 不可达时返回 `false` (视为"未处理"),导致 webhook 事件可能被重复处理。

**后果**: Redis 故障期间,同一 `eventId` 的 webhook 请求会被多次处理,造成道具重复发放。

---

#### GAP-M4: Redis Boss HP 缓存更新失败静默降级

**位置**: `lib/db/pg.ts:updateBossStatus` (line 91)

**描述**: Redis warm-cache 更新失败时只打印 `console.warn`,不影响主流程。

**后果**: 攻击 API 正确更新了 PostgreSQL HP,但 Redis 缓存未更新。此后 60s 内所有轮询请求读到的仍是旧 HP。

---

#### GAP-M5: `GlassButton.tsx` 使用 `class` 而非 `className` — Tailwind 不生效

**位置**: `app/components/features/ui/GlassButton.tsx:14`

**描述**: JSX 组件使用了 `class` prop,但 React 标准是 `className`。Tailwind 类名被当作普通 HTML 属性传递,不会应用任何样式。

**后果**: 任何使用 `GlassButton` 的地方,按钮会渲染为无样式的裸元素。

---

#### GAP-M6: Admin `lock_epoch` Redis 检查失败时 fail-open

**位置**: `app/lib/adminAuth.ts:119-123`

**描述**: 若 Redis 不可达,admin lock 检查被静默跳过,请求继续处理。

**后果**: 攻击者如果能造成 Redis 不可用,可以绕过 admin session revocation。

---

#### GAP-M7: 数据库 SSL `rejectUnauthorized: false` — 生产未验证证书

**位置**: `lib/db/postgres.ts` (SSL 配置注释)

**描述**: `ssl: { rejectUnauthorized: false }` 在 SSH 隧道场景下被注释为"可接受",但承诺的生产方案 (RDS CA bundle) 尚未实施。

---

#### GAP-M8: `TaskSheet.tsx` 为死代码,`remainingAttempts` 计算错误

**位置**: `app/components/task/TaskSheet.tsx:155`

**描述**: `TaskSheet` 组件从未被任何父组件渲染 (仅 `SubPageModal` 渲染 task UI)。其 `remainingAttempts` 展示逻辑硬编码为 `1 - (1 - 1) = 0`,始终显示 `0/1`。

---

### 🟡 低危 (Low)

| ID | 描述 | 文件 |
|---|---|---|
| L01 | `SubPageModal` 和 `MilestoneBar` 各维护一套 milestone claim 状态,两处 loading 状态不同步 | `SubPageModal.tsx`, `MilestoneBar.tsx` |
| L02 | `/api/diag/whoami` 路由已注册但 handler 为空 | `app/api/diag/whoami/route.ts` |
| L03 | `rules` 字段在 activity config 中可配置,但前端从未读取展示 | admin config → `SpineViewer.tsx` 无读取 |
| L04 | Spine bundle URL 在 admin 中可填任意值,无服务端可达性校验 | admin config editor |
| L05 | `H5Banner.tsx` 导入了 `@/components/ui/skeleton`,该文件存在性未验证 | `app/components/features/home/H5Banner.tsx:25` |
| L06 | 首页卡片内容全部硬编码,非动态数据驱动 | `HomePageClient.tsx` |
| L07 | `battle/page.tsx` 服务器组件默认值 `inventory = { item_hand: 3 }`,与真实用户 0 道具矛盾 | `app/battle/page.tsx` |
| L08 | `constantTimeHexEqual` 对长度不一致情况提前返回,泄露计时信息 | `app/lib/adminToken.ts:93` |
| L09 | `BGMController` 的 `Howler.unload()` 会销毁全局所有 Howl 实例 (BGM+SFX) | `BGMController.tsx:123` |
| L10 | Loading 阶段 `sessionStorage` 跨 Tab 状态残留 | `LoadingScreen.tsx` |

---

## 3. 测试覆盖缺口 (Test Gaps)

### 3.1 Admin 后台管理 — 人工测试清单

#### M-T01: 活动双开关一致性

**步骤**:
1. 创建一个活动,设置 `isGlobalEnabled=true`, `status=ENABLED`
2. 在活动列表页将 `status` 改为 `DISABLED`
3. 用一个未参与过活动的用户 cookie 调用 `GET /api/battle/init`
4. 验证返回的 `activityStatus === 'ENDED'` (或 NOT_STARTED)
5. 再将 `status` 改回 `ENABLED`,验证行为

**预期**: 两种方式都能正确控制活动的可见性。

**当前风险**: `status` 可能不被 Battle API 读取,导致 DISABLED 状态无效。

---

#### M-T02: 每日道具上限绕过

**步骤**:
1. Admin 设置某道具 `dailyLimit=1`
2. 用测试用户连续发送两次充值 `consume` webhook (不同的 `event_id`)
3. 查询 `user_inventory` 该用户的 `item_hand_count`

**预期**: `item_hand_count` 最多为 1。

**当前风险**: 预计会超过上限。

---

#### M-T03: Admin HP 覆盖与 Redis 缓存一致性

**步骤**:
1. 用浏览器打开 battle 页面,记下当前 Redis HP (可从 Network 响应推断)
2. Admin 在 `/admin/monitor` 将 HP 改为一个特殊值
3. 立即刷新 battle 页面
4. 记录 `GET /api/battle/init` 返回的 `currentHp`

**预期**: 页面立即反映 Admin 设置的值。

**当前风险**: 可能有最长 60s 的 Redis 缓存延迟。

---

#### M-T04: 里程碑并发双重领取

**步骤**:
1. 制造一个用户达到里程碑阈值 (e.g. 50% HP)
2. 立即用 Postman 或 curl 发送两个并发的 `POST /api/game/milestone/claim` 请求 (同一 `milestoneId`)
3. 检查 `milestone_rewards` 表中该用户该里程碑的 `is_claimed` 行数

**预期**: 只有 1 行 `is_claimed=true`。

**当前风险**: 可能出现 1 行 `is_claimed=true` + 1 行 `is_claimed=false` (重复数据)。

---

#### M-T05: Webhook Redis 故障时的幂等性

**步骤**:
1. 模拟 Redis 不可用 (`redisDown` mock 或临时关闭 Redis)
2. 发送一个 webhook 请求,带 `event_id=E1`
3. 检查 `user_inventory` 该用户道具是否增加了 1
4. 再次发送相同 `event_id=E1`

**预期**: 第二次请求不应再发放道具。

**当前风险**: Redis 故障时 `isWebhookProcessed` 返回 `false`,导致道具被重复发放。

---

#### M-T06: `GlassButton` 样式验证

**步骤**:
1. 进入需要使用 `GlassButton` 的页面 (如有)
2. 检查按钮是否有毛玻璃背景、边框、圆角

**预期**: 按钮有样式。

**当前风险**: `class` prop 被当作普通 HTML 属性,无样式生效。

---

### 3.2 核心 Battle API — 人工测试清单

| ID | 测试场景 | 预期结果 | 关联 GAP |
|---|---|---|---|
| B-T01 | `GET /api/battle/init` 无 cookie | 401/403 | — |
| B-T02 | `GET /api/battle/init` 有合法 cookie | 返回完整的 activity/inventory/milestone/task 状态 | GAP-H3 (日志) |
| B-T03 | `POST /api/action/attack` 无 inventory | `return_code: 'insufficient'` | — |
| B-T04 | `POST /api/action/attack` inventory=1 | item 扣减,HP 减少,damage logged | GAP-M4 (Redis) |
| B-T05 | `POST /api/action/attack` 并发 10 QPS | HP 最终一致性,无超扣 | GAP-H2 (竞态) |
| B-T06 | `POST /api/battle/task-claim` 未达阈值 | 400 或 `return_code: 'threshold_not_met'` | GAP-H1 |
| B-T07 | `POST /api/battle/task-claim` 已达阈值 | 道具增加,task 重置 | GAP-H1 |
| B-T08 | `POST /api/game/milestone/claim` 已领取 | `return_code: 'already_claimed'` | GAP-H2 |
| B-T09 | `POST /api/game/milestone/claim` 未达阈值 | 400 或 `return_code: 'threshold_not_met'` | — |
| B-T10 | `GET /api/battle/leaderboard` large offset | 分页正确,无 OOM | — |

### 3.3 Webhook 路由 — 人工测试清单

| ID | 测试场景 | 预期结果 | 关联 GAP |
|---|---|---|---|
| W-T01 | 正确 HMAC 签名的 recharge webhook | 200,道具增加 | — |
| W-T02 | 错误 HMAC 签名 | 401/403,道具不变 | — |
| W-T03 | 重放相同 `event_id` (Redis 正常) | 200,道具不变 | — |
| W-T04 | 重放相同 `event_id` (Redis 故障) | 幂等性验证 | GAP-M3 |
| W-T05 | `amount=0` 的 recharge webhook | 200 但道具不增加 (amount=0 的分支) | — |
| W-T06 | `tx_id` 长度 < 10 | 400 with error code | — |
| W-T07 | `action_type` 为非 recharge/consume | 400 with error code | — |

---

## 4. 升级演进建议 (Upgrade Roadmap)

### Phase 1: 止血 (1~2 天, 影响小, 风险低)

| 优先级 | 动作 | 改动文件 | 风险 |
|---|---|---|---|
| P0 | 修复 `GlassButton.tsx` 的 `class` → `className` | `app/components/features/ui/GlassButton.tsx` | 零风险,样式修复 |
| P0 | 修复 `TaskSheet.tsx` 的 `remainingAttempts` 逻辑错误 | `app/components/task/TaskSheet.tsx` | 零风险,数字显示修复 |
| P0 | 删除或注释 `TaskSheet.tsx` (已死代码,避免未来混淆) | `app/components/task/TaskSheet.tsx` | 零风险 |
| P1 | 移除 `H5Banner.tsx` 中对不存在的 `Skeleton` 组件的 import | `app/components/features/home/H5Banner.tsx` | 零风险,防止运行时崩溃 |
| P1 | 清理 `SpineViewer.tsx` 中的 `onDamageShow`/`onAnimationComplete`/`FETCH_SCALE_MULT` 注释等死代码 | `app/components/features/battle/SpineViewer.tsx` | 零风险 |
| P1 | 清理 `WeaponBar.tsx` 中未使用的 `_SpineViewerRef` 接口 | `app/components/features/battle/WeaponBar.tsx` | 零风险 |
| P1 | 清理 `GameBannerCarousel.tsx` 中未使用的 `dayjs` import | `app/components/features/game/GameBannerCarousel.tsx` | 零风险 |
| P1 | 清理 `BattleLayout.tsx` 中未调用的 `humanizeFetchError` | `app/components/features/battle/BattleLayout.tsx` | 零风险 |

---

### Phase 2: 消除 GAP-H1 — 每日上限服务端强验 (1 天)

> **目标**: 在 `incrementDailyTask` 中加入上限检查,让 Admin 配置的 `dailyLimit` 真正生效。

**第一步** (在改动前):
- 确认 `user_daily_tasks` 表中有 `daily_energy_limit` 和 `daily_money_limit` 列 (如果不存在,需 DB migration)
- 确认 `incrementDailyTask` 的调用方传入的 `dailyLimit` 参数来源 (从 activity config 读取)

**改动范围**:
- `lib/db/pg.ts` 的 `incrementDailyTask` 函数 — 加 SELECT + IF 分支
- 可能需要 `lib/db/pg.ts` 的 `upsertUserDailyTask` 函数 — 在创建新日期行时写入 limit 值

**验证**:
- 执行 M-T02 测试清单

---

### Phase 3: 消除 GAP-H2 — 里程碑领取竞态修复 (1 天)

> **目标**: 用 `SELECT ... FOR UPDATE` 或 upsert RETURNING 消除 TOCTOU 窗口。

**改动范围**:
- `lib/db/pg.ts` 的 `upsertMilestoneReward` — 用 `RETURNING is_claimed` 确认写入结果
- `lib/db/userPg.ts` 的 `claimMilestone` — 根据 RETURNING 结果返回准确状态

**验证**:
- 执行 M-T04 测试清单 (并发双重领取)

---

### Phase 4: 消除 GAP-M1 — 活动状态双开关统一 (0.5 天)

> **目标**: `getActiveActivity()` 同时检查 `status` 列和 `config.isGlobalEnabled`。

**改动范围**:
- `lib/db/pg.ts` 的 `getActiveActivity` 查询条件加 `AND status = 'ENABLED'`

**验证**:
- 执行 M-T01 测试清单

---

### Phase 5: 消除 GAP-M3/GAP-M4 — Redis 故障策略硬化 (1 天)

> **目标**: 
> - Webhook `isWebhookProcessed` 失败时改为 fail-closed (返回 500,让发送方重试)
> - Boss HP Redis 更新失败时报警而非静默

**改动范围**:
- `lib/redis.ts` 的 `isWebhookProcessed` — 失败时 throw 而非返回 false
- `app/api/webhook/user-action/route.ts` — catch 并返回 500
- `lib/db/pg.ts` 的 `updateBossStatus` — Redis 更新失败时 throw 或上报 metrics

**验证**:
- 执行 M-T05 (Redis 故障时幂等性测试)

---

### Phase 6: 可观测性建设 — GAP-H3 解决 + pino 日志 (2 天)

> **目标**: 
> - 为 `/api/battle/init` 加审计日志
> - 引入 pino 结构化日志替换所有 `console.*`
> - 将 5~7 个 DB 查询合并为 1 个 JOIN 或 1 个 RPC

**改动范围**:
- 新建 `lib/logger.ts` (pino)
- `app/api/battle/init/route.ts` — 加 audit log + 查询合并
- `lib/db/pg.ts` — 所有 `console.*` 替换为 `logger.*`
- `middleware.ts` — 访问日志

**验证**:
- `GET /api/battle/init` 在日志中出现
- `pm2 logs` 输出结构化 JSON

---

### Phase 7: Polling → SSE 升级 (3~5 天)

> **目标**: 将 Battle HP 轮询 (3s) 改为 Server-Sent Events,将 RDS QPS 降低 ~90%。

**架构变更**:
- 新增 `GET /api/battle/stream` SSE 端点
- 客户端 `BattleLayout` 用 `EventSource` 替换 `setInterval`
- Redis pub/sub 或 PostgreSQL LISTEN/NOTIFY 触发推送

**改动范围**:
- `app/api/battle/stream/route.ts` (新文件)
- `app/components/features/battle/BattleLayout.tsx` (替换 polling 逻辑)
- `lib/redis.ts` (加 publish 逻辑)

**验证**:
- 100 并发用户压测,RDS QPS < 5

---

### Phase 8: SpineViewer 拆分 (2~3 天)

> **目标**: 将 1764 行的 `SpineViewer.tsx` 拆分为三个模块。

**目标模块**:
- `SpineStageRegistry` — 静态资源配置 (路径、Y偏移、动画名)
- `SpineLoader` — 资源预加载、缓存、错误处理
- `SpineAnimator` — 播放控制、形态切换、特效触发

**Playwright 回归测试** (必须):
- 形态切换动画
- 攻击动画触发
- 加载屏流程
- 错误兜底 (资源 404)

---

### Phase 9: 审计日志保留策略 (0.5 天)

> **目标**: `public.webhook_audit` 和 `public.admin_audit_log` 表设置 90 天自动清理。

**方案**:
- `pg_cron` extension 的 `SELECT cron.schedule(...)` 
- 或 PM2 cron job 定期 `DELETE FROM webhook_audit WHERE created_at < now() - interval '90 days'`

---

## 附录: 所有被审计文件的绝对路径清单

```
app/components/features/battle/SpineViewer.tsx          (1764行)
app/components/features/battle/BattleLayout.tsx          (1349行)
app/components/features/battle/LeaderboardSheet.tsx       (389行)
app/components/features/battle/FormSelector.tsx           (225行)
app/components/features/battle/StandardHPBar.tsx           (182行)
app/components/features/battle/ActivityEndPage.tsx        (173行)
app/components/features/battle/LoadingScreen.tsx          (475行)
app/components/features/battle/MilestoneBar.tsx            (425行)
app/components/features/battle/ParticleEngine.tsx          (173行)
app/components/features/battle/FloatingDamage.tsx         (143行)
app/components/features/battle/BGMController.tsx           (185行)
app/components/features/battle/SubPageModal.tsx            (969行)
app/components/features/battle/WeaponBar.tsx               (285行)
app/components/features/battle/TopNav.tsx                   (472行)
app/components/features/battle/VolumePopover.tsx           (235行)
app/components/features/battle/CharacterIntroPanel.tsx     (223行)
app/components/features/battle/BattlePageClient.tsx         (53行)
app/components/features/battle/SuccubusSilhouette.tsx     (107行)
app/components/features/battle/types.ts                       (1行)
app/components/features/game/HomePageClient.tsx             (311行)
app/components/features/game/GameBannerCarousel.tsx         (540行)
app/components/features/home/H5Banner.tsx                    (453行)
app/components/features/ui/GlassButton.tsx                   (21行)
app/components/task/TaskSheet.tsx                          (444行)
app/components/ui/ToastContainer.tsx                         (79行)
app/battle/page.tsx                                         (25行)
lib/db/pg.ts                                                (全量)
lib/db/userPg.ts
lib/db/activitiesPg.ts
lib/redis.ts
lib/auth.ts
lib/userIdentity.ts
lib/adminAuth.ts
lib/adminToken.ts
lib/security/verifyWebhookSignature.ts
lib/auditLog.ts
lib/actions/battleActions.ts
lib/env.ts
app/api/battle/init/route.ts
app/api/battle/leaderboard/route.ts
app/api/battle/task-claim/route.ts
app/api/battle/reward-claim/route.ts
app/api/action/attack/route.ts
app/api/boss/status/route.ts
app/api/boss/sync/route.ts
app/api/user/status/route.ts
app/api/game/milestone/claim/route.ts
app/api/webhook/user-action/route.ts
app/api/time/route.ts
app/api/admin/login/route.ts
app/api/admin/activity/update/route.ts
app/api/admin/activity/set-active/route.ts
app/api/admin/activity/finalize/route.ts
app/api/admin/banners/update/route.ts
app/api/admin/boss/update-hp/route.ts
app/api/admin/user/update/route.ts
app/api/admin/users/milestone/route.ts
app/api/admin/stats/route.ts
app/api/admin/upload/route.ts
app/api/internal/owner-command/route.ts
app/api/diag/whoami/route.ts
app/api/dev-login/route.ts
app/api/test/*                                             (全部)
middleware.ts
app/admin/page.tsx
app/admin/activities/page.tsx
app/admin/activities/[id]/config/page.tsx
app/admin/banners/page.tsx
app/admin/login/page.tsx
app/admin/monitor/page.tsx
app/admin/users/page.tsx
app/admin/layout.tsx
app/admin/lib/adminApi.ts
app/lib/adminAuth.ts
app/lib/adminToken.ts
lib/csrf.ts
```

---

*报告生成: 2026-07-27 | 扫描深度: 纯只读,无代码修改 | Agent: Cursor REPARK 6.0*
