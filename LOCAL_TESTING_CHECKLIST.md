# 🔬 LOCAL TESTING CHECKLIST — P17 H5 魅魔来袭

> **用途**: 在本地机器上完成全部功能性冒烟测试，无需客户配合，无需 VPN，无需部署到 EC2。
> **预计耗时**: 30-60 分钟
> **前提**: `npm install` 已跑完，`npm run dev` 能正常启动

---

## 阶段 0：测试环境准备

### 0.1 环境文件

复制一份 `.env.local.example` → `.env.local`，确保以下变量已设置：

```bash
# 数据库（本地隧道已建立）
DATABASE_URL="postgresql://postgres:PhbcRcx5Wt@127.0.0.1:5433/postgres"
REDIS_URL="rediss://127.0.0.1:6380"

# 管理面板（开发模式 bypass）
ADMIN_DEV_BYPASS=1

# 公开变量
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_AUTH_COOKIE_NAME=uid

# Webhook（本地用假密钥）
WEBHOOK_SECRET=test_webhook_secret_32chars_minimum_ok
```

### 0.2 启动隧道（如果还没跑）

在**单独一个终端**里跑：

```bash
# 如果您还没启动 SSH 隧道
$env:DEPLOY_SSH_PASSPHRASE='REPARK'; node scripts/dev_tunnel.mjs

# 看到类似输出说明成功：
# [TUNNEL] PostgreSQL tunnel: localhost:5433 -> RDS:5432
# [TUNNEL] Redis tunnel: localhost:6380 -> ElastiCache:6379
```

### 0.3 启动开发服务器

```bash
npm run dev
# 等看到:  Ready - started server on 0.0.0.0:3000
```

---

## 阶段 1：核心战斗功能（无需登录）

> **测试目标**: 验证战斗闭环（Redis + PostgreSQL）完全可用
> **不需要客户主站 cookie**

### ✅ 测试用例

| # | 步骤 | 预期结果 | 通过标准 |
|---|---|---|---|
| 1.1 | `curl http://localhost:3000/api/game/init` | 返回 `{ ok: true, data: { activityEnabled, bossHp, ... } }` | HTTP 200，含 bossHP 数字 |
| 1.2 | `curl http://localhost:3000/api/boss/status` | 返回 `{ ok: true, data: { currentHp, maxHp, ... } }` | HTTP 200，含 HP |
| 1.3 | `curl -X POST http://localhost:3000/api/battle/init` | 返回 `{ ok: true, data: { userId, items, ... } }` | HTTP 200，含 userId（即使是 mock） |
| 1.4 | 发送一次攻击（POST /api/action/attack，带 item_type=item_hand + nonce=abc123） | 返回 `{ ok: true, data: { actualDamage > 0, newHp < oldHp } }` | HTTP 200，伤害 > 0 |
| 1.5 | 用同一 nonce 再发一次攻击 | 返回 `{ ok: false, error: { code: 'DUPLICATE_ATTACK' } }` | HTTP 409，幂等生效 |
| 1.6 | 等 1.1 秒后再发一次攻击（nonce 不同） | 成功（rate limit 已过期） | HTTP 200，伤害 > 0 |
| 1.7 | 快速连发 3 次攻击（不同 nonce） | 第 1-2 次成功，第 3 次 429 | 第 1-2 次 200，第 3 次 429 |
| 1.8 | `curl http://localhost:3000/api/battle/leaderboard` | 返回 `{ ok: true, data: { users: [] } }` | HTTP 200，结构正确 |
| 1.9 | `curl http://localhost:3000/api/game/milestone/claim` | 返回 `{ ok: false }` 或 HTTP 200 | 不崩溃即可 |

**快速 curl 命令**（把第 1.4 项的 nonce 换成时间戳）：

```bash
# 1.4 攻击测试
NONCE=$(date +%s%N)
curl -X POST http://localhost:3000/api/action/attack \
  -H "Content-Type: application/json" \
  -H "Cookie: uid=test-user-001" \
  -d "{\"item_type\":\"item_hand\",\"nonce\":\"$NONCE\"}"

# 1.5 重复 nonce 测试（用同一个 nonce）
curl -X POST http://localhost:3000/api/action/attack \
  -H "Content-Type: application/json" \
  -H "Cookie: uid=test-user-001" \
  -d '{"item_type":"item_hand","nonce":"duplicate-test-001"}'

# 1.7 快速 3 连发
for i in 1 2 3; do
  curl -X POST http://localhost:3000/api/action/attack \
    -H "Content-Type: application/json" \
    -H "Cookie: uid=test-user-001" \
    -d "{\"item_type\":\"item_hand\",\"nonce\":\"rapid-$i-$(date +%s%N)\"}" \
    -w " → HTTP %{http_code}\n"
done
```

### ❌ 如果失败

- 1.1 / 1.2 失败 → 检查 Redis 隧道和 RDS 隧道是否在跑
- 1.4 失败 → 检查 `lib/redis.ts` 是否连接成功
- 1.7 失败 → rate limit Lua 脚本未生效

---

## 阶段 2：管理面板（需要绕过 auth）

> **测试目标**: 验证 admin 路由完全可用
> **注意**: `ADMIN_DEV_BYPASS=1` 已设置，admin API 应返回成功

### ✅ 测试用例

| # | 步骤 | 预期结果 | 通过标准 |
|---|---|---|---|
| 2.1 | `curl http://localhost:3000/api/admin/login -X POST -d "password=dev"` | HTTP 200，返回 `{ ok: true }` | set-cookie 有 `admin_token=authenticated` |
| 2.2 | `curl -b "admin_token=authenticated" http://localhost:3000/api/admin/stats` | HTTP 200，含统计数据 | 有 `totalUsers` 或类似字段 |
| 2.3 | `curl -b "admin_token=authenticated" http://localhost:3000/api/admin/user?userId=test` | HTTP 200 | 含 inventory 字段 |
| 2.4 | 创建一个假用户 inventory（POST /api/admin/user/inventory） | HTTP 200 | `{ ok: true }` |
| 2.5 | 给用户加物品（POST /api/admin/users/update，action=update_inventory） | HTTP 200 | inventory 数字变化 |
| 2.6 | 测试 H-1 clamp（传 item_hand_count=999999999） | HTTP 400，拒绝超限值 | 返回 400，含错误信息 |
| 2.7 | 测试 toggle_status（action=toggle_status） | HTTP 200，status 在 normal/banned 间切换 | status 字段变化 |
| 2.8 | 测试 lock_epoch 写入（POST /api/internal/owner-command?cmd=lock_admin） | HTTP 401（无 owner key）或 200 | 端点响应正常 |
| 2.9 | 测试 ping（POST /api/internal/owner-command?cmd=ping，无 owner key） | HTTP 401（缺 OWNER_COMMAND_KEY 时 fail-closed） | 不是 200（除非您设了 key） |
| 2.10 | 测试 startup 心跳（GET /api/internal/startup） | HTTP 200 | `{ ok: true, message: "Already started" 或 "Background services started" }` |

**快速 curl 命令**：

```bash
# 2.1 登录
curl -c cookies.txt -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"password":"dev"}'

# 2.2 拿统计
curl -b cookies.txt http://localhost:3000/api/admin/stats

# 2.6 H-1 clamp 测试（应返回 400）
curl -b cookies.txt -X POST http://localhost:3000/api/admin/user/inventory \
  -H "Content-Type: application/json" \
  -d '{"userId":"clamp-test","item_hand_count":999999999}'
```

---

## 阶段 3：后台页面 UI 冒烟（浏览器）

> **测试目标**: 验证页面能渲染，无 console.error

### ✅ 测试用例

| # | 页面 | 检查点 | 通过标准 |
|---|---|---|---|
| 3.1 | `http://localhost:3000/admin` | 重定向到 `/admin/login` 或显示登录页 | 无崩溃 |
| 3.2 | `http://localhost:3000/admin/login` | 显示密码输入框 | 能看到表单 |
| 3.3 | 登录后 `http://localhost:3000/admin/activities` | 显示活动列表或空白状态 | 无 console.error |
| 3.4 | `http://localhost:3000/admin/users` | 显示用户表格 | 能看到表格头部 |
| 3.5 | `http://localhost:3000/admin/banners` | 显示 Banner 管理 | 无崩溃 |
| 3.6 | `http://localhost:3000/admin/monitor` | 显示监控面板 | 无崩溃 |
| 3.7 | `http://localhost:3000/battle` | 战斗页面（可能重定向到登录） | 无 console.error |

**注意**: UI 测试需要在**浏览器**里做，不能用 curl。把上面 URL 粘贴到 Chrome/Edge 里。

---

## 阶段 4：音量条 + 动画锁（需完整 battle 流程）

> **测试目标**: 验证 Phase 3 需求1 + 需求2 的 UI

| # | 步骤 | 检查点 | 通过标准 |
|---|---|---|---|
| 4.1 | 进入 battle 页面后，点击 BGM 按钮两次 | 弹出垂直音量条 | slider 可见 |
| 4.2 | 拖动 BGM slider | 音量数字变化（%） | 0-100% 显示 |
| 4.3 | 点击 BGM 按钮第三次 | 弹出框关闭 | 不再显示 slider |
| 4.4 | 点击语音按钮 | 弹出第二个音量条（独立） | 与 BGM 互斥 |
| 4.5 | 点击空白处 | 音量条关闭 | 外部点击触发关闭 |
| 4.6 | 攻击动画播放时 | 右侧 FormSelector 变灰（disabled） | 按钮不可点击 |

**注意**: 4.1-4.6 需要您能完整进入 battle 页面（有用户 cookie 或用 ADMIN_DEV_BYPASS）。

---

## 阶段 5：Webhook（需手动构造签名）

> **测试目标**: 验证 HMAC-SHA256 验签 + Redis 幂等

```bash
# 伪造一个 webhook 事件（用本地 WEBHOOK_SECRET）
SECRET="test_webhook_secret_32chars_minimum_ok"
PAYLOAD='{"event":"user_action","user_id":"webhook-test-user","action":"consume","item_type":"item_hand","amount":1}'
TIMESTAMP=$(date +%s)
SIGNATURE=$(echo -n "${TIMESTAMP}.${PAYLOAD}" | openssl dgst -sha256 -hmac "$SECRET" | cut -d' ' -f2)

curl -X POST http://localhost:3000/api/webhook/user-action \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: sha256=${SIGNATURE}" \
  -H "X-Webhook-Timestamp: ${TIMESTAMP}" \
  -d "$PAYLOAD"

# 预期：HTTP 200，{ ok: true }
# 重复发同样的请求：HTTP 200（幂等，不重复处理）
```

---

## 阶段 6：owner-command 端点（需设 OWNER_COMMAND_KEY）

> **如果您想完整测试**，在 `.env.local` 里临时加一行：
> `OWNER_COMMAND_KEY=1111111111111111111111111111111111111111111111111111111111111111`
> 重启 dev server 后测试：

```bash
# 生成签名（本地用同一个假 key）
KEY="1111111111111111111111111111111111111111111111111111111111111111"
TS=$(date +%s%3N)
NONCE=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")
CMD="ping"
ARGS='{}'
PAYLOAD="${TS}|${NONCE}|${CMD}|${ARGS}"
SIG=$(node -e "console.log(require('crypto').createHmac('sha256', process.argv[1]).update(process.argv[2]).digest('hex'))" "$KEY" "$PAYLOAD")
HEADER="${TS}.${NONCE}.${SIG}"

curl -X POST "http://localhost:3000/api/internal/owner-command?cmd=${CMD}" \
  -H "X-Owner-Auth: ${HEADER}" \
  -H "Content-Type: application/json" \
  -d "{\"cmd\":\"${CMD}\",\"argsJson\":\"${ARGS}\"}"

# 预期：{ "ok": true, "cmd": "ping", "data": { "pong": true } }
```

---

## ❌ 如果测试失败，排查顺序

```
Step 1. npm run dev 能启动吗？
  → No: 看 terminal 报错，通常是 tsconfig 或环境变量缺失

Step 2. Redis 连接正常吗？
  → 检查隧道: node scripts/dev_tunnel.mjs 是否在跑
  → curl http://localhost:6380 能通吗？（Redis）

Step 3. PostgreSQL 连接正常吗？
  → 检查隧道: localhost:5433 是否在跑
  → psql "postgresql://postgres:xxx@localhost:5433/postgres" -c "SELECT 1"

Step 4. admin 登录 401？
  → 确保 ADMIN_DEV_BYPASS=1 在 .env.local 里
  → 重启 npm run dev

Step 5. 战斗 401？
  → 确保 Cookie: uid=xxx 在请求头里
  → middleware.ts 里的 /battle 保护在 dev 模式下 bypass 了

Step 6. owner-command 401？
  → 这是预期的！没有设 OWNER_COMMAND_KEY 就应该 401
  → 临时加到 .env.local 即可

Step 7. 页面空白或报错？
  → 打开 Chrome DevTools → Console → 看 red 错误
  → 通常是 API 地址没配对（NEXT_PUBLIC_APP_URL）
```

---

## ✅ 全部通过的标准

- [ ] 阶段1：至少 5 次攻击成功（不同 nonce）
- [ ] 阶段1：重复 nonce 返回 409
- [ ] 阶段1：rate limit 生效（快速连发第3次 429）
- [ ] 阶段2：admin login 返回 200
- [ ] 阶段2：H-1 clamp 拒绝 999999999
- [ ] 阶段3：所有 admin 页面能加载（无 console.error）
- [ ] 阶段4：音量条弹出/关闭正常
- [ ] 阶段5：Webhook 签名验证正常
- [ ] 阶段6：owner-command ping 返回 { ok: true }（如果您设了临时 key）

**如果以上全部通过，核心功能在本地是健康的。**

---

## 📋 测试完成后的清理

- 如果您临时加了 `OWNER_COMMAND_KEY` 到 `.env.local`，**删除它**
- 如果您临时改了 `ADMIN_DEV_BYPASS`，确保它保持为 `1`（本地开发需要）
- 把 `cookies.txt` 文件删掉：`Remove-Item cookies.txt`

---

*Last updated: Phase 11*