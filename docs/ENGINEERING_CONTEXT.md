# Engineering Context — H5 活动页面（P17_H5meimo-demo）

> **本文件用途**：跨会话、跨工程师、跨 AI Agent 的"项目活字典"。
> 只记**当下仍然为真的事实**，历史的修复叙事见 `docs/变更交付文档_*.md`。
>
> **使用方式**：
> - 新 Agent / 新工程师接到本项目后，**第一件事**读这份文件
> - 任何重大变更后，**同步更新**这份文件
> - 客户、产品、运维侧的对接约束写进"对接约束"区块
> - 业务事实（已知别名映射、关键阈值、生产环境 URL）写进"事实速查"区块

---

## 0. 项目一句话

主站（iframe 嵌入）+ H5 活动页面 + webhook 实时回调的轻量活动系统。
核心循环：用户在主站消费/充值 → webhook 回调 → H5 数据库累计 → 页面弹窗/进度条展示奖励。

---

## 1. 客户对接约束（不可协商的硬事实）

### 1.1 主站 ↔ H5 通信

| 项 | 值 | 备注 |
|---|---|---|
| 嵌入方式 | **iframe 嵌入** | `NEXT_PUBLIC_FRAME_ANCESTORS` 当前**全开**（客户要求测试便利），正式上线必须收回 |
| 鉴权 cookie | 主站写 cookie，H5 读 cookie | `NEXT_PUBLIC_AUTH_COOKIE_NAME` |
| cookie 值类型 | **可能是 H5 自己的 UUID 或主站原生 long ID**（如 `128`、`1`） | 必须容忍两种 |
| 主站 URL | `NEXT_PUBLIC_MAIN_STATION_URL` | — |

### 1.2 Webhook（主站 → H5）

| 项 | 值 |
|---|---|
| 端点 | `POST /api/webhook/user-action` |
| 鉴权头 | `X-Webhook-Signature: sha256=<hex>`（HMAC-SHA256，密钥 `WEBHOOK_SECRET`） |
| 幂等头 | `X-Request-Id: <tx_id>` |
| **签名正确方式（唯一支持）** | 客户端必须用**完整 raw body 字符串**（包含 `sign` 字段）参与 HMAC。`sign` 字段预填 `0...0` 占位符 |
| ❌ **不允许的方式** | 先剥离 sign 再签、签完回填（永远 401） |
| tx_id 最小长度 | 10 字符 |
| action_type | `consume` \| `recharge` |
| amount 单位 | **分**（充值），电量通过 `consume` 触发专属列 `daily_energy_consumed` |

**为什么只用方案 A**：
服务端验签的是**原始请求 body 字符串**，不依赖字段顺序、不依赖 `sign` 字段是否在不在 payload 里。
只要客户端**用与发送完全相同的 body 字符串**（含预填 0 的 sign）参与 HMAC，签名就一致。
方案 B 失败原因：发送的 body 是 6 字段，签名基于 5 字段子集——两端字符串不同 → 不匹配。
结论：**永远用方案 A**，不要尝试改服务端去"剥 sign 后签"（脆弱、字段顺序敏感）。

### 1.3 金额/电量单位约定

| 概念 | 单位 | 存储列 | 展示 |
|---|---|---|---|
| 充值金额 | **分**（如 ¥50 = 5000） | `user_daily_tasks.daily_money_recharged` (`NUMERIC`) | 前端 `cents/100` |
| 电量消耗 | **点数**（如 11 = 11 点） | `user_daily_tasks.daily_energy_consumed` (`INTEGER`) | 原值 |
| Boss 血量 | 客户端独占 | — | — |

⚠️ **历史坑**：早期代码把充值金额当元（5000）写入 `daily_money_recharged`，导致任务阈值 5000 分被瞬间打爆。已于 v1.5 修。**永远记住：钱是分**。

---

## 2. 事实速查（ask "这个值是多少" 时直接来这查）

### 2.1 别名映射（user_alias）

> 算法：`toUuid(rawId)` = SHA-256(rawId) → UUIDv5 形式。
> **代码层（确定）** 与 **alias 表（v1.5 修复前可能 randomUUID mint）** 可能不一致——见 §5 警告。

| raw_id | 代码层派生 UUID | alias 表实际 UUID | 状态 |
|---|---|---|---|
| `128` | `2747b7c7-1856-5ba5-b066-f0523b03e17f` | `2747b7c7-1856-5ba5-b066-f0523b03e17f` | ✅ 一致（v1.5 修复后创建） |
| `1`   | `6b86b273-ff34-5ce1-9d6b-804eff5a3f57` | `48573483-01ef-4615-a6b5-8a5b6ceeff76` | ⚠️ **不一致**（v1.5 修复前 mint，UUID 已固化在 alias 表） |
| 空串   | `e3b0c442-98fc-5c14-9afb-f4c8996fb924` | — | 不会出现 |
| 测试 UUID | 直接透传（小写化） | — | — |

⚠️ **客户反复测试时出现的 `1` 实际写到了 `48573483-...`，不是代码派生的 `6b86b273-...`**。下次接到该用户的报告，要按 `48573483-...` 查询。

### 2.2 关键阈值与环境变量

| 变量 | 用途 | 备注 |
|---|---|---|
| `NEXT_PUBLIC_TASK_THRESHOLD_ENERGY` | 每日电量任务完成阈值 | 默认 100（点） |
| `NEXT_PUBLIC_TASK_THRESHOLD_RECHARGE` | 每日充值任务完成阈值 | 默认 5000（**分**） |
| `WEBHOOK_SECRET` | HMAC 共享密钥 | 与主站一致 |
| `DATABASE_URL` | RDS PostgreSQL | 启用 SSL `rejectUnauthorized: false`（RDS CA 走 SSH 隧道时） |
| `REDIS_URL` | ElastiCache（TLS） | 用于 webhook 幂等 + session |
| `INTERNAL_STARTUP_KEY` | 内部 API 鉴权（≥32 字符） | **生产必须设置**，缺失会拒绝所有内部端点 |
| `OWNER_COMMAND_KEY` | 运维后门 | 仅 `/etc/repark/owner.env` |

### 2.3 生产环境

| 项 | 值 |
|---|---|
| 服务器 IP | `98.93.252.250` |
| SSH key | `keys/mercenary_h5_project.pem`（仅 SO 可访问） |
| 用户 | `ubuntu` |
| 应用根 | `/var/www/app` |
| PM2 进程 | `repark-h5`（fork mode，单进程） |
| 日志路径 | `~/.pm2/logs/repark-h5-{out,error}.log`（**stdout 在 out.log**） |
| 环境配置 | `/var/www/app/.env.production` |

---

## 3. 架构（一张图）

```
主站 (long ID user)
   │
   ├─[iframe + cookie]──→ H5 页面
   │                        │
   │                        ├─→ /api/battle/init    ─→ lib/auth.ts → toUuid
   │                        ├─→ /api/battle/leaderboard
   │                        └─→ /api/battle/claim-reward
   │
   └─[POST /api/webhook/user-action]──→ Webhook Handler
                                          │
                                          ├─→ 验签 (HMAC-SHA256)
                                          ├─→ Zod schema 校验
                                          ├─→ resolveAliasToUuid(rawId)
                                          │     │
                                          │     ├─ 若 alias 表已有 → 用表里的
                                          │     └─ 若无 → toUuid(rawId) 并 upsert
                                          │
                                          ├─→ Redis 幂等 (tx_id)
                                          └─→ incrementDailyTask → user_daily_tasks
```

---

## 4. 数据模型关键表

| 表 | 用途 | 关键列 | 备注 |
|---|---|---|---|
| `public.users` | 用户主表 | `id UUID PK` | 由 webhook `ensureUserExists` 自动建 |
| `public.user_alias` | 跨系统 ID 映射 | `alias_type, alias_value, uuid` | `alias_type='master_long'` |
| `public.user_daily_tasks` | 每日任务累计 | `user_id, date, daily_energy_consumed, daily_money_recharged, recharge_processed` | `(user_id, date)` 唯一约束 |
| `public.task_progress` | 任务领取状态 | `user_id, task_type, reset_date, current_progress, is_claimed` | 用于"已领取"判定 |
| `public.user_inventory` | 用户道具 | `user_id, item_hand_count, item_phallus_count, total_damage_dealt` | — |
| `public.webhook_audit` | **webhook 事件持久化** | `tx_id, action_type, user_id, raw_user_id, duration_ms, http_status, success, result, error_code, error_message, raw_body` | ⚠️ 早期失败时 `tx_id` / `user_id` 可能为 NULL |

---

## 5. 关键代码模块（改动前必读）

| 文件 | 角色 | 改动警示 |
|---|---|---|
| `lib/auth.ts → toUuid()` | cookie long ID → UUID 的派生 | **唯一权威**。任何其他位置都不要重复实现 UUID 派生 |
| `lib/db/pg.ts → resolveAliasToUuid()` | webhook 端的别名解析 | 与 `toUuid` 算法必须严格一致 |
| `lib/db/pg.ts → incrementDailyTask()` | 写入 `user_daily_tasks` | 通过 `user_daily_tasks` 和 `task_progress` 两处都会写，逻辑分支别动 |
| `lib/security/verifyWebhookSignature.ts` | 验签 | **签的是 raw body 字符串**，不要改成"剥离 sign 后签" |
| `app/api/webhook/user-action/route.ts` | webhook 主入口 | 三步优先：UUID 透传 → `main_station_user_id` alias → rawId fallback |
| `app/api/battle/init/route.ts` | 页面初始化 | 调用 `getUserIdAsUuid`（含 cookie → UUID 强制转换） |
| `app/lib/modalStore.ts` | 全局弹窗状态 | v1.6 起 `current === page` 时 no-op；不要加回冷却时间 |
| `app/components/features/battle/SubPageModal.tsx` | 弹窗渲染容器 | 通过 `useModalStore` 订阅，不要自己维护 open 状态 |

---

## 6. 待办 / 已知盲区（P0/P1 优先级）

### P0（下次有 1 小时就该做）

1. ✅ **`public.webhook_audit` 表 + 持久化**（2026-07-25 完成）
   - 12 列 + 7 索引；写入是 fire-and-forget
   - 排查示例 SQL 见 `docs/HANDOFF_2026-07-25.md`
2. **`/api/battle/init` 访问日志**
   - 当前生产 65K 行日志中 `GET /api/battle/init` **0 命中**——完全不知道页面端有没有调过
   - 这是问题 1 早期难复现的根因
3. **`/api/diag/whoami` 调试端点**
   - 返回 cookie 解析后的 UUID、alias 命中、IP、UA
   - 客户报"页面还是 0"时直接 cookie 给我们就能 reproduce

### P1

4. webhook 错误码结构化：`INVALID_HMAC` / `MALFORMED_JSON` / `SCHEMA_FAIL` / `DB_FAIL` / `IDEMPOTENT_REPLAY`
5. 客户端 console 日志批量上报到 `/api/client-log`（带频次限制）
6. 进度条实时性：SSE `/api/battle/stream` 或 webhook 触发客户端轮询

### P2

7. 所有日志中**同时**打印 `主站 raw_id / alias UUID / 主站昵称`——避免排查时 join

---

## 7. 客户对接习惯（PM 视角）

| 习惯 | 应对 |
|---|---|
| 客户经常用错误的 `user_id` 测试（如 `1` 而非 `128`） | 排查时先看 alias 表，确认写到哪个 UUID 了 |
| 客户看到"页面没变"会立刻怀疑后端 bug | 先确认**页面到底有没有重新加载 / init API 到底有没有调到**（见 §6 P0-2） |
| 客户对"金额单位分/元"很敏感 | 任何金额改动都要明确"×100"，并解释小数点 |
| 客户偏好方案 A（最小改动）胜过方案 B（重构） | 新功能优先"非破坏性扩展"而非"改协议" |
| 客户报"401"通常第一时间怀疑签名 | 实际上可能是 tx_id 太短、JSON 字段缺失等 |

---

## 8. 变更日志（本文件的元数据）

| 日期 | 变更 | 操作人 |
|---|---|---|
| 2026-07-25 | 初版创建；固化 v1.5/v1.6 之后的活字典、盲区清单、对接习惯 | Cursor Agent (REPARK Orchestrator) |
| 2026-07-25 | P0-1 完成：webhook_audit 表 + 错误码结构化；详见 `docs/HANDOFF_2026-07-25.md` | Cursor Agent (REPARK Orchestrator) |

> 每次更新本文件，**必须**在表里加一行，并保留旧行。
