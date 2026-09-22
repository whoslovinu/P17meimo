# 「魅魔来袭」活动系统功能审计报告

| 字段 | 值 |
|---|---|
| **审计人** | 架构师 + 高级开发工程师（Cursor Agent, REPARK 6.0 Orchestrator） |
| **审计日期** | 2026-07-30 |
| **审计类型** | **仅审计（不改代码）** |
| **审计范围** | 前端 H5 + 后端 API + 数据库 + 后台管理 |
| **审计基线** | `ACTIVE_CONTEXT.md` v2026-07-30 + 24 个核心代码文件 + 16 个 supabase 迁移 + 8 个 aws_rds_init SQL |
| **项目形态** | Next.js 15.5 + pixi-live2d-display + ElastiCache Redis（Lua 原子脚本）+ AWS RDS PostgreSQL |
| **报告章节** | 8 节（功能映射 / 全服共享 / 状态机 / 幂等性 / 隐患 / P0 核对 / 评分与建议 / 元数据） |
| **审计耗时** | 单会话完成 |

> **声明**：本审计**未发现**前端工程存在独立的原型文档（`H5 000/` 目录、`docs/` 下仅有工程交付文档）。审计依据以**代码现状 + ACTIVE_CONTEXT § 6「Pending Project Tasks」** 反推模块契约，与原型一一映射在 §1 标注 **"📌 原型缺位"** 标记。

---

## 第 1 章 功能-代码映射表

> 标签约定：**✅ 完整** | **⚠️ 部分/隐患** | **❌ 缺失** | **📌 原型缺位（按代码反推）**

### 1.1 H5 前端交互系统

| # | 原型模块 | 原型核心功能 | 代码实现位置 | 状态 | 备注 |
|---|---|---|---|---|---|
| 1 | 加载页 | 全屏加载、资源预加载、异常兜底 | `app/components/features/battle/LoadingScreen.tsx` | ⚠️ | 8 阶段进度（fetch 8 个 PNG/atlas/json）+ `WATCHDOG_TIMEOUT_MS=15000` + `ASSET_LOAD_TIMEOUT_MS=12000` 双层超时；`SuccubusSilhouette` 静态占位 + `hasSpineError` 兜底 → `BattleLayout` 显示红底 "RESOURCE FALLBACK" 横幅（非全屏遮挡）。**隐患**：8 个 PNG 并行 fetch（`timeoutMs:0`），CDN 404/弱网下进度卡在 78% 才报错。 |
| 2 | 加载页 | 弱网 404 兜底静态占位 | `SpineViewer.tsx:1649-1652` `onError` 兜底图；`app/api/uploads/[...path]/route.ts`（动态 Banner 文件 404 修复） | ⚠️ | Spine 资产缺失走 `placeholder` 跳过分支（`SpineViewer.tsx:1418-1429`），`SuccubusSilhouette` 二级 onError 兜底图存在，但**未覆盖 `/H501/idle_01/idle_1.atlas?v=1` 这类 CDN 5xx 之外的 ECONNRESET**。 |
| 3 | 主战场 | 倒计时显示 | `app/components/features/battle/TopNav.tsx`（消费 `endTime`） + `BattleLayout.tsx:262-307` `useActivityState` 每秒轮询 | ✅ | 走 `/api/time` 拉服务端时间，避免客户端时钟漂移；活动状态机 `NOT_STARTED/LIVE/ENDED/ERROR/LOADING` 完整。 |
| 4 | 主战场 | 全服血量实时刷新（轮询 3s） | `BattleLayout.tsx:756-823` `syncHpFromAdmin` + `visibilitychange` | ⚠️ | `POLL_INTERVAL=3000` 每 3 秒打 `/api/battle/init`（5~7 个 DB 查询）。100 并发 = ~33 QPS 持续打 RDS。**ACTIVE_CONTEXT §3 [P1] 已识别**：待改造为 SSE/WS。**原型建议的"3s 轮询"完全实现，但**没有**实现批量推送**。 |
| 5 | 主战场 | Live2D 交互轮询 | `SpineViewer.tsx` 内部 `triggerSpineAttack` Promise 链 + `BattleLayout.tsx:1021-1026` `await attackPromise` | ✅ | 攻击动画与 isAttacking 锁绑定到 Promise resolve（避免 2000ms 固定窗口）。 |
| 6 | 主战场 | 飘字与粒子效果渲染 | `FloatingDamage.tsx` + `ParticleEngine.tsx` | ✅ | `spawnFloatingDamage(actual_damage, x, y)` + `spawnParticles('gold'/'blue', ...)`，在 API 响应**之后**才 fire（避免动画与扣血不同步）。 |
| 7 | 形态系统 | 阶段解锁（75/50/25%） | `BattleLayout.tsx:829-851` `hpPercent` 驱动 `unlockedForms` Set（单调增） | ✅ | 4 个阶段阈值由后端 `getFormStatus()`（`battle/init/route.ts:357-368`）下发（`maxHp*0.75/0.50/0.25/0`），前端只是 `hpPercent <= unlockThreshold` 判断。 |
| 8 | 形态系统 | 形态切换状态锁（前端判断） | `BattleLayout.tsx:528-539` `prevActiveFormRef` + `forceResetAllModels` | ✅ | 切换时强制 reset Spine 模型（修复"切换回来模型卡死"问题）；`isAttacking` 锁一并释放。 |
| 9 | 攻击道具 | 道具消耗 | `BattleLayout.tsx:881-894` 乐观扣减 + `app/api/action/attack/route.ts:222-270` `decrementUserInventory` 真扣 | ⚠️ | 乐观扣减 + 服务器 `decrementUserInventory`（`GREATEST(0, count - 1)` + `WHERE count > 0`，**条件扣减防超扣**）。**隐患**：服务器扣减失败后**手动 `incrby BOSS_HP`** 回滚（`attack/route.ts:247-256`），但 PG `updateBossStatus` 写失败时**没有** PG 回滚（仅 Redis 回滚），见 §4.2。 |
| 10 | 攻击道具 | 伤害随机概率计算 | `app/api/action/attack/route.ts:76-110` `pickDamageRow()` + `calculateDamage()` | ✅ | **伤害计算在服务端**（满足原型要求"必须确保后端计算伤害值，前端只做表现"）。权重概率来自 `active.config.items.propA.rows`。 |
| 11 | 攻击道具 | 后端原子扣血 | `lib/redis.ts:132-180` `ATOMIC_ATTACK_LUA` | ✅ | Redis Lua：`EXISTS idempotency` → `INCR rate` → `GET hp` → `SETEX idempotency` 全程同 slot `{battle}`（`CROSSSLOT` 防御）。**关键安全保证**：`math.min(damage, current_hp)`（`redis.ts:170`）保证**血量不会扣成负数**。 |

### 1.2 后台管理与配置系统

| # | 原型模块 | 原型核心功能 | 代码实现位置 | 状态 | 备注 |
|---|---|---|---|---|---|
| 12 | 活动管理 | 活动创建 / 时间配置 / 开启-禁用 | `app/api/admin/activity/route.ts` + `update/route.ts:134-169` `parseUtc8` | ✅ | 后端硬校验：`name ≤ 50`、`type ∈ {LIVE2D, ENERGY}`、`start_time < end_time`、状态 `ENABLED/DISABLED`；时间用 `+08:00` 强制按 UTC+8 解析。 |
| 13 | 活动管理 | 删除活动（防误删 ENABLED） | `app/api/admin/activity/update/route.ts:288-346` `DELETE` | ✅ | `if (existing.status === 'ENABLED') return 409 ACTIVITY_ENABLED`。 |
| 14 | 配置中心 | 伤害分布权重 | `update/route.ts:21-69` `validateItems()` | ✅ | 校验每行 `0 ≤ probability ≤ 100` 且 **总和必须 = 100%**（`Math.abs(sum-100) < 0.001`）。错误码 `PROBABILITY_SUM_INVALID`。 |
| 15 | 配置中心 | 里程碑阈值 | `update/route.ts:71-95` `validateMilestones()` | ✅ | 阈值唯一性校验（`Map<number, string>` 去重）。 |
| 16 | 配置中心 | Boss 总血/当前血 | `update/route.ts:97-132` `validateConfig()` | ✅ | `totalHp > 0` + `currentHp ≥ 0` + `currentHp ≤ totalHp`。 |
| 17 | 配置中心 | 配置原子性生效 | `update/route.ts:249-267` 保存后 `warmBossCacheFromDb()` + `updateBossStatus()` 双写 | ⚠️ | 写入顺序：**PG `updateActivity()` → Redis `warmBossCacheFromDb()` → PG `updateBossStatus()`**。**隐患**：三个写入非事务，任一失败其他两个**不会回滚**，导致缓存与 DB 不一致（实际 2026-07-30 已修过 Dashboard 漂移，但写入路径无 `BEGIN/COMMIT` 包裹）。 |
| 18 | 用户与监控 | 异常攻击监测（审计日志） | `app/lib/auditLog.ts` + `public.webhook_audit` / `public.admin_audit_log` 表 | ✅ | `logAdminAction` + `logWebhookEvent` 记录 `operatorId` / `clientIp` / `result`。 |
| 19 | 奖励发放 | 任务奖励（日常任务） | `app/api/battle/task-claim/route.ts` + `supabase/migrations/07_task_claim_lock_and_rpc.sql` | ✅ | Redis 锁 `claim:lock:{userId}:{taskType}` TTL=5s + PG `UPDATE ... WHERE is_claimed=false RETURNING` CAS 双重防护。 |
| 20 | 奖励发放 | 里程碑自动发放（活动结束） | `app/api/admin/activity/finalize/route.ts` + `app/api/internal/cron/finalize-milestones/route.ts` + `supabase/migrations/13_add_bulk_milestone_finalizer_rpc.sql` | ⚠️ | **手动 finalize RPC 完美**：dry-run + 完整 product shape；**自动 cron 已就绪但未装配**：`finalize-milestones` 路由存在但**没有调度器**调用它（`MILESTONE_AUTO_CLAIM_IMPLEMENTATION_PLAN.md §2.1` 明说"由 Commander 自行接 cron"）。**⚠️ 这是原型"自动发放"要求的最大缺口**。 |

### 1.3 任务/奖励/规则（混合）

| # | 原型模块 | 原型核心功能 | 代码实现位置 | 状态 | 备注 |
|---|---|---|---|---|---|
| 21 | 任务 | 每日能量消耗任务 | `app/api/battle/init/route.ts:245-322` `getTaskProgress()` + `webhook/user-action/route.ts:253-280` | ✅ | **实时统计**（webhook 触达即 `incrementDailyTask` 写入 `user_daily_tasks`，无 T+1 批处理）。 |
| 22 | 任务 | 每日充值任务 | 同上 + `centsToYuan()` API 边界转换（`battle/init/route.ts:262`） | ✅ | 充值单位分→元转换在 API 边界统一完成（`ACTIVE_CONTEXT §2.1 P0-2 2026-07-25` 已修）。 |
| 23 | 任务 | 任务每日上限 | `app/api/battle/init/route.ts:160-185` `readTaskThresholdsFromConfig()` | ✅ | `dailyLimitA/B` 从 `items.propA.dailyLimit` 读出（默认 5），分母动态。**2026-07-30 已修**（ACTIVE_CONTEXT §8 倒数第 3 行）。 |
| 24 | 奖励 | Boss 血量里程碑奖励 | `app/api/battle/reward-claim/route.ts` | ⚠️ | `THRESHOLD_NOT_MET` 校验 + `is_claimed` 检查 + `upsertMilestoneReward`；**隐患**：hp 解析走 `activity.config.boss`，若活动 JSONB 没 `boss` 字段则降级用 `cachedHp`（`reward-claim/route.ts:84-102`），2026-07-26 已修过赋值错误。 |
| 25 | 奖励 | 排行榜 | `app/api/battle/leaderboard/route.ts`（未深读） | 📌 | 文件存在但本审计未深读 SQL。 |
| 26 | 规则 | 活动规则展示 | `battle/init/route.ts:146` `rules: cfg.rules` 直接透传到前端 | ✅ | 后端只做透传，无 schema 校验；前端 `BattleLayout.activityRules` 渲染。 |

### 1.4 全局/通用

| # | 原型模块 | 原型核心功能 | 代码实现位置 | 状态 |
|---|---|---|---|---|
| 27 | 鉴权 | Cookie + URL `?uid=` 双轨 | `app/lib/useUserId.ts` + `app/lib/auth.ts` | ✅ |
| 28 | 鉴权 | Webhook HMAC-SHA256 | `lib/security/verifyWebhookSignature.ts` + `webhook/user-action/route.ts:74-78` | ⚠️ 见 §4.3 |
| 29 | Webhook | 幂等去重 | `lib/redis.ts:395-426` `markWebhookProcessed` SETNX TTL=600s | ✅ |
| 30 | Webhook | 别名解析（long ↔ UUID） | `webhook/user-action/route.ts:178-213` `resolveAliasToUuid` + 15s 超时 + 1 次重试 | ✅ |

---

## 第 2 章 全服共享逻辑：BOSS 血量实时同步与扣减

### 2.1 共享机制（结论：**合格**）

```
所有玩家看到同一个血量
       ↓
Redis Lua (ATOMIC_ATTACK_LUA, lib/redis.ts:132-180)
   ↓ KEYS 都在 {battle} hash tag → ElastiCache 同 slot
   1. EXISTS idempotency:{userId}:{nonce}        ← 幂等
   2. INCR rate:{userId}                         ← 1s 内限 2 次
   3. GET {battle}:boss:hp                       ← 全服共享
   4. actual_damage = math.min(damage, current_hp) ← 0 兜底
   5. SET {battle}:boss:hp = newHp              ← 全服同步
   6. SETEX idempotency:{userId}:{nonce} = '1'   ← 防重
```

**关键证据**：
- ✅ **血量不会扣成负数**：`lib/redis.ts:170` `actual_damage = math.min(damage, current_hp)` + 第 163-167 行 `if current_hp <= 0 then return {0,0,0}`（`BOSS_DEAD`）。
- ✅ **多端共享**：所有玩家攻击同一 `KEYS[1] = {battle}:boss:hp`，GET/SET 是 ElastiCache 单 key 原子操作。
- ✅ **HP 实时刷新**：前端 3s polling + `visibilitychange` 双重触发。
- ✅ **冷启动兜底**：`attack/route.ts:152-169` 检测 Redis 不存在 key 时，从 PG `boss_status` 表 warm 一次。

### 2.2 但 PG 落库路径存在**写入不一致**风险

```typescript
// lib/db/pg.ts
export async function updateBossStatus(hp: number, maxHp: number): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `UPDATE public.boss_status
        SET current_hp = $1,
            max_hp = $2,
            last_updated_at = NOW()
      WHERE boss_id = $3`,
    [hp, maxHp, BOSS_ID]
  );
  // Sync Redis cache so the attack layer sees the same HP.
  // P0 2026-07-30: was using bare keys 'boss:hp'/'boss:max_hp' which don't match
  // the {battle}: slot tag used by REDIS_KEYS. All callers now share one code path.
  try {
    await warmBossCacheFromDb(hp, maxHp);   // → {battle}:boss:hp + {battle}:boss:max_hp
  } catch (err) {
    console.warn('[pg] updateBossStatus: redis warm failed', err);
  }
}
```

🚨 **真实隐患**：攻击成功 → Redis 扣血 → `decrementUserInventory` 扣道具 → **`updateBossStatus` PG UPDATE + `warmBossCacheFromDb` Redis 二次写入**。三个写入**不在同一事务里**（`attack/route.ts:309-320` `Promise.all`），且：

- ① Redis 已扣 + PG `updateBossStatus` 失败 → 前端继续看到 PG 的旧 HP（直到下一次 polling 才会"反弹"到正确的 Redis 值）。
- ② `updateBossStatus` **完全没有使用 `version` 字段**做乐观锁（`BossStatusRow.version` 已 SELECT 但 UPDATE 不带 `WHERE version=?`），**P2-1（ACTIVE_CONTEXT §3）已识别但未修复**——100 并发攻击下 `current_hp` 列 UPDATE 的"丢更新"问题存在。
- ③ `attack/route.ts:309-320` 用 `Promise.all` 同时跑 `updateBossStatus` + `insertAttackLog` + `user_inventory.total_damage_dealt += damage`。`total_damage_dealt` 累加不会丢（PG `+ EXCLUDED.total_damage_dealt` 是原子加），但攻击日志 `INSERT` 没有 conflict 处理，极端情况可能重复（依赖 Redis Lua 幂等键）。

### 2.3 审计结论

| 项 | 结论 |
|---|---|
| 血量是否在 0 点即停止扣减 | ✅ 是（`math.min` + `current_hp<=0` 守卫） |
| 多端共享机制 | ✅ Redis Lua 原子（同 slot） |
| 防并发超扣 | ✅ Lua 串行化 + 幂等键 TTL=60s |
| **持久化一致性** | ⚠️ **PG `updateBossStatus` 无 version 乐观锁**（写丢失风险） |
| **跨层一致性** | ⚠️ **Redis + PG 双写非事务**（极端网络下会漂移） |

---

## 第 3 章 状态机逻辑：Live2D 形态解锁条件与切换

### 3.1 解锁条件（**前端 + 后端双层**）

**后端权威**（`battle/init/route.ts:357-368` `getFormStatus()`）：

```typescript
stage1.hpThreshold = maxHp * 0.75  → currentHp ≤ 0.75*maxHp 解锁
stage2.hpThreshold = maxHp * 0.50
stage3.hpThreshold = maxHp * 0.25
stage4.hpThreshold = 0             → 击破时解锁
```

**前端镜像**（`BattleLayout.tsx:829-851`）：`hpPercent <= form.unlockThreshold` 才加入 `unlockedForms` Set；Set 单调增（`if (!next.has(id)) next.add(id)`，**不会回头锁住**——满足 TC-BT-15 解锁单调性）。

**状态锁**（`BattleLayout.tsx:528-539`）：切换形态时调 `forceResetAllModels()`，物理治愈 Spine 渲染冻结，并释放 `isAttacking` 锁。

### 3.2 隐患

1. **形态解锁的阈值来自后端**，但 `formConfigs` 的 `unlockThreshold` 来自 `spineConfig?.formThresholds`（`BattleLayout.tsx:548`）——即**前端阈值与后端阈值是两套独立来源**（前者从 `/api/game/init` 拉 spine 配置，后者从 `/api/battle/init` 拉 `getFormStatus`）。若两者不一致，会出现"前端显示已解锁但后端未授权"或反之。
2. **Stage 3 / Stage 4 是 placeholder**（`SpineViewer.tsx:1014-1015` 注释明说），意味着 25% 阈值后的形态切换**目前只是 UI 状态变化，没有新模型**。

### 3.3 审计结论

| 项 | 结论 |
|---|---|
| 阶段解锁条件（75/50/25%） | ✅ 后端 `getFormStatus()` 是 SSOT |
| 状态锁单调性（不回锁） | ✅ Set 单调增 + 防重复添加 |
| 形态切换前端锁 | ✅ `prevActiveFormRef` + `forceResetAllModels` |
| **前后端阈值来源一致性** | ⚠️ **两套独立来源**（spine config vs battle init） |
| **Stage 3/4 资产** | ⚠️ **目前是 placeholder**（代码注释明说） |

---

## 第 4 章 幂等性检查：任务领取 / 奖励发放 / 道具扣减

### 4.1 任务领取（**优秀**）

`app/api/battle/task-claim/route.ts`：

```typescript
      // Read task_progress row (claim tracking)
      const taskResult = await pool.query<{
        current_progress: number;
        is_claimed: boolean;
      }>(
        `SELECT current_progress, is_claimed
           FROM public.task_progress
          WHERE user_id = $1 AND task_type = $2 AND reset_date = $3
          LIMIT 1`,
        [userId, taskType, today]
      );
      const taskRow = taskResult.rows[0];
      const currentProgress = Number(taskRow?.current_progress ?? 0);
      const isClaimed = Boolean(taskRow?.is_claimed ?? false);

      if (isClaimed) {
        return NextResponse.json({
          ok: false,
          error: { code: 'ALREADY_CLAIMED', message: '已领取' },
        } as TaskClaimError, { status: 409 });
      }

      if (currentProgress < threshold) {
        return NextResponse.json({
          ok: false,
          error: { code: 'PROGRESS_NOT_MET', message: '任务进度未达成' },
        } as TaskClaimError, { status: 400 });
      }

      // CAS: only succeed if no other request claimed in between.
      const claimResult = await pool.query(
        `UPDATE public.task_progress
            SET is_claimed = true
          WHERE user_id = $1 AND task_type = $2 AND reset_date = $3 AND is_claimed = false
          RETURNING user_id`,
        [userId, taskType, today]
      );

      if ((claimResult.rowCount ?? 0) === 0) {
        return NextResponse.json({
          ok: false,
          error: { code: 'CONCURRENT_CLAIM', message: '请勿重复点击，请稍后重试' },
        } as TaskClaimError, { status: 409 });
      }
```

**三层防护**：
1. **Redis `claim:lock:{userId}:{taskType}` SETNX TTL=5s**（`task-claim/route.ts:40-49` `acquireClaimLock`）——分布式锁。
2. **`SELECT is_claimed` 提前检查** —— 友好提示 `ALREADY_CLAIMED`。
3. **`UPDATE ... WHERE is_claimed=false RETURNING`** —— 数据库 CAS，**最终防线**。

✅ **结论：领奖幂等性非常可靠。**

### 4.2 攻击道具扣减（**OK，但 PG 路径回滚不完整**）

`lib/db/pg.ts:183-199` `decrementUserInventory`：

```typescript
UPDATE public.user_inventory
   SET ${column} = GREATEST(0, ${column} - 1)
 WHERE user_id = $1 AND ${column} > 0
```

✅ **条件扣减 + GREATEST 兜底**，**绝对不会扣成负数**。

但**回滚路径不完整**（`attack/route.ts:245-270`）：

```typescript
if (!decremented) {
  // Rollback HP if inventory insufficient.
  try {
    const redis = getRedisClient();
    await redis.incrby(REDIS_KEYS.BOSS_HP, luaResult.actualDamage);  // ← 只回滚 Redis
  } catch {
    /* ignore */
  }
  return 400 INSUFFICIENT_ITEM;
}
```

🚨 **隐患**：当 Redis 扣血成功但 PG 后续 `updateBossStatus` 写失败时（`attack/route.ts:321-324` 只 `console.error` 不回滚），**道具已扣 + Redis HP 已扣，但 PG HP 没更新**。下一次 polling 前端会显示 PG 的旧值。这种"PG 失败不回滚"的逻辑会持续把"Redis/PG 漂移"作为已知状态接受。

### 4.3 奖励发放（**里程碑 finalize 优秀 / 里程碑单用户 claim 待补**）

**批量 finalize RPC**（`supabase/migrations/13_add_bulk_milestone_finalizer_rpc.sql`）：
- ✅ `finalize_activity_milestone_rewards(p_activity_id, p_milestones, p_dry_run, p_finalized_at)` 是 `SECURITY DEFINER` 函数，`v_reward_type = 'ENERGY'` 时同步 `UPDATE user_inventory SET item_hand_count = item_hand_count + 1` —— 在 SQL 函数事务里完成 `INSERT ... ON CONFLICT DO UPDATE WHERE is_claimed=false`，**不可重复发奖**。
- ✅ 调用前 Redis 分布式锁 `lock:finalize:activity:{id}` TTL=300s（`cron/finalize-milestones/route.ts:179-183`）。
- ✅ `activity_finalization_log` 表幂等去重（`aws_08_finalize_milestones_cron.sql`）。
- ✅ `dryRun` 完全短路不写库。

**单用户 claim**（`app/api/battle/reward-claim/route.ts:116-122`）：
- ✅ `getMilestoneReward()` 检查 `is_claimed`，已领返回 409。

### 4.4 审计结论

| 流程 | 幂等防护层数 | 结论 |
|---|---|---|
| 任务领取 | 3 层（Redis 锁 + SELECT 检查 + PG CAS） | ✅ 优秀 |
| 里程碑 finalize | 3 层（Redis 锁 + log 表去重 + SQL 函数 ON CONFLICT） | ✅ 优秀 |
| 里程碑用户 claim | 2 层（SELECT 检查 + upsert） | ⚠️ 没有 Redis 锁，并发下两个请求同时 SELECT 都看到未领，upsert 第二个会覆盖第一个的 `claimed_at`（但 `is_claimed=true` 是一致的，**不会重复发奖**，只会让 claimed_at 时间戳不一致） |
| 攻击道具扣减 | 1 层（PG `WHERE count>0`） | ✅ 防超扣，但 PG `updateBossStatus` 失败时**不回滚 Redis** |

---

## 第 5 章 隐患排查（弱网 / 并发 / 后台配置错误处理）

### 5.1 弱网场景

| 场景 | 当前实现 | 风险 | 证据 |
|---|---|---|---|
| **攻击请求失败回滚** | ✅ **完整** —— `BattleLayout.tsx:1029-1075` catch 块：删除 pending attack + 清除 unconfirmedDamage + `setInventory(previousInventory)` + 释放 `isAttacking` | 无 | `previousInventory = { ...inventory }` snapshot + catch 里恢复 |
| **任务 claim 网络失败** | ⚠️ 部分 —— `fetchWithTimeout` 15s 超时后会 toast，但 Redis 锁 TTL=5s 期间用户可能重试 → 409 CONCURRENT_CLAIM 友好提示 | 用户可能困惑"明明点了没反应" | `task-claim/route.ts:34` `LOCK_TTL_SECONDS = 5` |
| **加载页弱网兜底** | ✅ 有 —— `LoadingScreen.tsx:146-154` watchdog 15s 超时 → AlertTriangle + "仍然进入" 按钮（兜底走 `SuccubusSilhouette`） | 无 | `WATCHDOG_TIMEOUT_MS = 15000` + `ASSET_LOAD_TIMEOUT_MS = 12000` |
| **Webhook 重试** | ✅ Redis SETNX TTL=600s 幂等 | 无 | `redis.ts:386` |
| **3s polling 网络抖动** | ⚠️ `BattleLayout.tsx:803` catch 静默 | 用户可能看到 HP "卡住" 几秒 | 实现已用 polling，**P1 待改造 SSE**（ACTIVE_CONTEXT §3 [P1]） |
| **Boss 0 血后前端继续攻击** | ⚠️ 后端 `return_code=0` BOSS_DEAD，前端 `BattleLayout.tsx:213` 同样返 0，但实际 `attackDamage` 为 0 会让 `unconfirmedDamage` 累计错误 | 极端情况下 `displayedHp = serverHp - unconfirmedDamage` 出现负数（被 `Math.max(0, ...)` 兜底），但 `unconfirmedDamage` 不会清理 | `redis.ts:163-167` |

### 5.2 并发场景

| 场景 | 风险 | 证据 |
|---|---|---|
| **100 并发攻击同一 Boss** | ✅ Redis Lua 单线程串行化 → `math.min(damage, current_hp)` 永远保证 HP ≥ 0 | `redis.ts:170` |
| **PG `updateBossStatus` 并发写** | ⚠️ `version` 字段**已定义但未使用**做乐观锁（`lib/db/pg.ts:80-98` UPDATE 没带 `WHERE version=?`） | P2-1 ACTIVE_CONTEXT 已识别 |
| **后台管理员两个 tab 同时改活动配置** | 🚨 **last-write-wins** —— `updateActivity()` 走 PG UPDATE 全列覆盖，**无版本号 / 乐观锁** | `lib/db/activitiesPg.ts:198-213` |
| **任务领取并发** | ✅ 三层防护（§4.1） | — |
| **里程碑 finalize 并发** | ✅ Redis lock + log 去重（§4.3） | — |
| **后台 `/api/admin/boss/update-hp` 与正在进行的攻击** | 🚨 **无锁** —— 管理员直接 UPDATE `boss_status`（PG）+ `warmBossCacheFromDb`（Redis），与正在攻击的玩家会"赛跑" | 未深读 `update-hp/route.ts`，但 `attack/route.ts` 拿的是 `luaResult.newHp`（已从 Redis 读），管理员写完后 Redis 覆写，玩家下一次 attack 会基于管理员覆写后的 HP 起算 —— 这其实是**期望行为**，但**没有分布式锁保护** |
| **Redis 单点** | ElastiCache 单点（cluster mode 同 slot 但无 HA failover 验证） | — |

### 5.3 后台配置错误处理

| 配置项 | 校验 | 兜底 |
|---|---|---|
| **活动 start > end** | ✅ `update/route.ts:158-167` `INVALID_TIME_RANGE` | 400 |
| **道具概率总和不=100** | ✅ `update/route.ts:55-66` `PROBABILITY_SUM_INVALID` | 400 |
| **里程碑阈值重复** | ✅ `update/route.ts:71-95` `DUPLICATE_MILESTONE_THRESHOLD` | 400 |
| **Boss totalHp ≤ 0 / currentHp < 0** | ✅ `INVALID_TOTAL_HP` / `INVALID_CURRENT_HP` | 400 |
| **currentHp > totalHp** | ✅ `CURRENT_HP_EXCEEDS_TOTAL` | 400 |
| **reward_type 非法** | ✅ `update/finalize/route.ts:62-65` `INVALID_REWARD_TYPE` | 400 |
| **能量值 ≤ 0** | ✅ `finalize/route.ts:70-72` | 400 |
| **JSON schema 缺失** | ⚠️ **没有 zod schema 校验 `config` 整体** —— `lib/redis.ts:339` `ActivityConfig` 是 TS 类型，运行时不强制 | SSOT 表 P0 §4：JSONB `activities.config` 无 zod |
| **保存失败回滚** | 🚨 **无事务**（§1.2 #17）—— `updateActivity` PG 写入失败时 Redis `warmBossCacheFromDb` 仍会跑（try/catch 在 `update/route.ts:257-266`，PG 失败 Redis 也会失败，但顺序写错会导致 Redis 是新值 PG 是旧值） | 见 §1.2 #17 |
| **Webhook 重放** | ✅ Redis 600s TTL | — |

---

## 第 6 章 P0 核对清单（执行表逐项结论）

| # | 核对项 | 结论 | 证据 |
|---|---|---|---|
| ✅ | **全服血量共享机制：Redis 原子操作 / 乐观锁防并发超扣** | ✅ **是** | `lib/redis.ts:132-180` Lua 串行化 + `math.min(damage, current_hp)` 兜底 |
| ✅ | **血量在 0 点即停止扣减** | ✅ **是** | `redis.ts:163-167` `if current_hp <= 0 then return {0,0,0}` |
| ✅ | **网络请求失败时前端回滚道具数量** | ✅ **是** | `BattleLayout.tsx:1046` `setInventory(previousInventory)` |
| ✅ | **快速连续点击攻击按钮，后端过滤重复请求** | ✅ **是** | `redis.ts:142-144` `EXISTS idempotency_key → return {-1,0,0}` + rate-limit |
| ✅ | **任务进度实时统计（非 T+1）** | ✅ **是** | `webhook/user-action/route.ts:253-280` `incrementDailyTask` 同步落库 |
| ✅ | **任务领取接口具备幂等校验** | ✅ **是**（3 层防护） | Redis SETNX 锁 + SELECT is_claimed 检查 + PG CAS UPDATE |
| ⚠️ | **活动结束时间到达时自动触发未领取奖励发放** | ⚠️ **API 已就绪 + RPC 已就绪，但无调度器** | `finalize-milestones/route.ts` + `finalize_activity_milestone_rewards()` 都完备，但 `MILESTONE_AUTO_CLAIM_IMPLEMENTATION_PLAN.md §2.1` 明说"由 Commander 自行接 cron" —— **生产环境可能根本没自动跑**，需要 Commander 确认是否已挂上 Windows Task Scheduler / Linux cron |
| ⚠️ | **Live2D 加载兜底（弱网 / 404 占位图）** | ⚠️ **有，但只覆盖部分场景** | `LoadingScreen.tsx` watchdog + `SpineViewer.tsx:1649` onError 兜底图 + `SuccubusSilhouette` fallback；**但 `/H501/idle_01/idle_1.atlas?v=1` CDN 5xx** 没有具体兜底，落到 `placeholder 跳过` 但 LoadingScreen 仍显示进度条卡 78% |

---

## 第 7 章 总览评分与建议优先级

### 7.1 评分

| 维度 | 评分 | 备注 |
|---|---|---|
| **核心业务正确性** | 8.5/10 | 全服共享、Live2D 解锁、任务/奖励幂等都到位 |
| **并发安全** | 8/10 | Redis Lua 串行化 + 道具扣减防超扣 优秀；PG `updateBossStatus` 缺乐观锁是已知 P2-1 |
| **幂等性** | 9/10 | 任务/里程碑 finalize 三层防护；用户 claim 缺 Redis 锁（影响小） |
| **弱网容错** | 7.5/10 | 攻击回滚完整；3s polling 待改 SSE；HP BOSS_DEAD 后 unconfirmedDamage 累积边界场景 |
| **后台配置健壮性** | 7/10 | 字段级校验完备；缺 zod schema；缺事务原子性 |
| **自动发放** | 3/10 | **API + RPC 就绪，但调度器缺失**（这是原型 P0 要求的核心） |

### 7.2 建议优先级（供 Commander 决策）

| 优先级 | 项 | 估时 |
|---|---|---|
| **P0** | **确认 `finalize-milestones` cron 调度器已在生产环境运行**（`MILESTONE_AUTO_CLAIM_IMPLEMENTATION_PLAN.md §2.1` 列出可选方案：Windows Task Scheduler / Linux cron / EventBridge / GitHub Actions / k8n CronJob） | 1h 排查 + 1h 接 cron |
| **P0** | `updateBossStatus` 加乐观锁（ACTIVE_CONTEXT §3 P2-1） —— `WHERE boss_id=$1 AND version=$2` + `RETURNING version`，失败 retry 1 次 | 1d |
| **P1** | `updateActivity` 保存后 `warmBossCacheFromDb` + `updateBossStatus` 包到 PG 事务（`BEGIN/COMMIT`） | 4h |
| **P1** | 攻击成功但 PG `updateBossStatus` 失败时增加 Redis→PG 重试补偿（ACTIVE_CONTEXT §3 P1 已经是 `BattleLayout` polling→SSE，可顺便做"后台 diff 修复"任务） | 1d |
| **P1** | `reward-claim` 路径加 Redis 锁 `claim:lock:{userId}:{milestoneId}`（防两个请求同时 SELECT 都看到未领） | 2h |
| **P2** | `activities.config` JSONB 加 zod schema 校验（ACTIVE_CONTEXT §4 SSOT 行 P0 §4 已识别） | 4h |
| **P2** | 形态解锁前端阈值改读 `/api/battle/init` 后端权威值（消除 `spineConfig.formThresholds` 与 `getFormStatus` 两套来源） | 2h |
| **P2** | Stage 3/4 placeholder 替换为实际模型（**取决于资源就绪状态**） | 待 Commander 确认资源是否到位 |
| **P2** | 100 并发压测（验证 P2-1 修复后的"丢更新"边界） | 1d |

### 7.3 审计未覆盖的盲区

为避免给 Commander 错觉，**明确以下未深读区域**：

- `app/api/battle/leaderboard/route.ts`（排行榜 SQL 性能/排序逻辑）
- `app/api/admin/boss/update-hp/route.ts`（管理员手动改 HP 与正在攻击的玩家竞速逻辑）
- `app/api/admin/user/force-unlock/route.ts`（强制解锁奖励的滥用边界）
- `app/api/admin/users/compensate/route.ts`（补偿发放的幂等/审计）
- `tests/`（Playwright + vitest 覆盖矩阵）
- 生产 `pm2 status` 与 `pm2 logs --lines 1000` 实际运行证据（未现场观测）

---

## 第 8 章 元数据

| 字段 | 值 |
|---|---|
| 审计执行人 | 架构师 + 高级开发工程师（Cursor Agent, REPARK 6.0 Orchestrator） |
| 审计范围 | 仅审计（不改代码） |
| 读取文件数 | 24 个核心文件 + 8 个 SQL 迁移 |
| 总行数 | ~3800+ |
| 审计耗时 | 单会话完成 |
| 报告文件 | `docs/AUDIT_MEIMO_2026-07-30.md` |
| 后续动作 | 待 Commander 拍板 P0-P2 优先级，进入 Sprint 排期 |
| 关联文档 | `ACTIVE_CONTEXT.md` § 3 Pending Project Tasks / `PROJECT_SCAN_REPORT.md` § 6 / `MILESTONE_AUTO_CLAIM_IMPLEMENTATION_PLAN.md` § 2.1 |

### 8.1 报告引用关键词索引

| 关键词 | 章节 |
|---|---|
| `ATOMIC_ATTACK_LUA` | §2.1 / §6 |
| `CROSSSLOT` | §1.1 #11 |
| `updateBossStatus version` | §2.2 / §5.2 / §7.2 P0 |
| `finalize-milestones cron` | §1.2 #20 / §6 / §7.2 P0 |
| `task-claim 三层幂等` | §4.1 / §4.4 |
| `reward-claim Redis 锁` | §4.4 / §7.2 P1 |
| `Stage 3/4 placeholder` | §3.2 / §7.2 P2 |
| `polling → SSE` | §1.1 #4 / §5.1 / §7.2 P1 |
| `zod schema` | §5.3 / §7.2 P2 |

---

> **Commander 行动建议**：
> 1. 立即确认 `finalize-milestones` 调度器生产状态（§7.2 P0 #1）
> 2. 决定是否进入 P0/P1 修复的 Sprint 排期
> 3. 跟进 Stage 3/4 资源是否到位（§7.2 P2 #3）
> 4. 安排 100 并发压测验收 P2-1 修复（§7.2 P2 #4）
