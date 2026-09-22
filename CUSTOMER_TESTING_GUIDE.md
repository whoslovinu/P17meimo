# P17 H5 魅魔来袭 — 客户测试手册 (Customer Testing Guide)

> 本文档指导你作为**最终使用者**体验已部署到客户服务器上的项目。

---

## 📡 服务器信息

| 项 | 值 |
|---|---|
| **应用 URL** | `http://98.93.252.250/` ⚠️ **不要加端口号** |
| ~~旧地址~~ | ~~`http://98.93.252.250:3000/`~~（已被防火墙阻断，统一走 nginx 80 端口） |
| **服务器 IP** | `98.93.252.250` |
| **运行时** | Node.js 20.20.2 + Next.js + PM2（localhost:3000） + nginx（80 反代） |
| **数据库** | AWS RDS PostgreSQL |
| **缓存** | AWS ElastiCache Redis (TLS) |

---

## 🔑 Admin 后台登录

**URL**: `http://98.93.252.250/admin/login`

**登录密码**:

```
giys-agjj-niqt-yx2g
```

> 这是 HMAC 登录密码，请妥善保管。生产环境部署文档约定 `ADMIN_SECRET_KEY` 是 SHA256 后存盘的——本部署**特殊配置**为明文存储以便人工记忆。

**登录后可以测试**：
- `/admin` 管理面板（Dashboard、运营工具）
- `/api/admin/users/compensate` 用户补偿接口
- `/api/admin/user/force-unlock` 强制解锁接口
- `/api/admin/banner/update` Banner 管理

---

## 🎮 客户体验路径（不需要 Main Station 集成）

由于 Main Station 登录门户尚未对接，你可以**通过 URL 参数**或**手动设置 cookie** 直接进 `/battle`：

### 路径 A：URL 参数（最快，推荐）

**任意 userId 都可以**——后端会用这个 ID 查询用户状态。若该用户不存在，会以"零数据"状态返回。

```
http://98.93.252.250:3000/battle?userId=<任意UUID>
```

例：

```
http://98.93.252.250:3000/battle?userId=11111111-1111-1111-1111-111111111111
```

> ⚠️ **注意**：URL 参数 `userId` 会被 middleware 优先采用，但 middleware 仍要求 cookie `uid` 存在才能进入 `/battle`。所以路径 A 仍需要设置 cookie。

### 路径 B：手动设置 cookie（推荐用于完整体验）

打开 Chrome DevTools → **Console** 标签页 → 输入：

```javascript
document.cookie = "uid=11111111-1111-1111-1111-111111111111; path=/";
```

刷新页面 → 自动进入 `/battle`。

### 路径 C：使用 curl 验证 API（无需 cookie）

后端 API 大多数**不要求 cookie**，你可以直接 curl：

```bash
# 服务器时间
curl http://98.93.252.250/api/time

# Boss 状态（HP、剩余血量）
curl http://98.93.252.250/api/boss/status

# Banner 配置
curl http://98.93.252.250/api/banner

# 游戏初始化（活动、任务、奖励）
curl http://98.93.252.250/api/game/init

# 用户状态（用 URL 参数）
curl "http://98.93.252.250/api/user/status?userId=11111111-1111-1111-1111-111111111111"
```

---

## 🧪 推荐测试场景（按优先级）

### 1️⃣ 首页 `/`

```
http://98.93.252.250:3000/
```

应该看到：
- ✅ H5 加载页（7 阶段，280-550ms 延迟）
- ✅ 完成后跳转主页
- ✅ 顶部 banner 轮播（2 个 banner：活动 1 + 占位）
- ✅ "战斗"/"任务"/"奖励"/"规则" 4 个 tab

### 2️⃣ Boss 战斗 `/battle`（需要 cookie，见上）

需要先在浏览器 console 设置 cookie（路径 B），然后访问：

```
http://98.93.252.250:3000/battle
```

应该看到：
- ✅ Spine 动画加载（WebGL 渲染）
- ✅ Boss HP 98057/100000（98%）
- ✅ 4 个 morph chips（变身道具）
- ✅ DD:HH:MM:SS 倒计时（活动结束时间）
- ✅ 顶部"Sound toggle"按钮（点击切换静音）

### 3️⃣ 任务页 `/task` 或 `/battle?tab=task`

进入战斗页面后 → 任务按钮。

应该看到：
- ✅ Bottom Sheet 弹出
- ✅ "消耗精力" 卡片（10/100 进度）
- ✅ "充值金额" 卡片（10/100 进度）
- ✅ 两个 "领取" 按钮

### 4️⃣ 奖励页 `/reward`

进入战斗页面后 → 奖励按钮。

应该看到：
- ✅ 个人进度面板
- ✅ 4-5 个里程碑（0% / 25% / 50% / 75% / 100%）
- ✅ 状态：locked / reward / claimed

### 5️⃣ Banner 详情

点击首页 banner → 应该跳转 `/banner/[id]` 或打开 Bottom Sheet。

### 6️⃣ Admin 后台 `/admin`

**先访问** `/admin/login`：

```
http://98.93.252.250:3000/admin/login
```

输入密码 `giys-agjj-niqt-yx2g` → 登录成功 → 进入 dashboard。

---

## 🐛 如果出问题

| 现象 | 排查 |
|---|---|
| 页面空白 | 检查浏览器 console → 看 `Cannot read properties` 等报错 |
| `/battle` 重定向到 `/?redirect=...` | 没设置 `uid` cookie → 见路径 B |
| Boss HP 一直不变 | Redis 缓存可能已满 → 检查 `/api/boss/status` |
| 任务 "领取" 按钮点击无反应 | 检查 `/api/battle/task-claim` → 看 Network 面板 |
| Admin 登录 401 "密码错误" | 确认密码完全等于 `giys-agjj-niqt-yx2g`（无前后空格） |

---

## 📊 当前部署状态

| 指标 | 值 |
|---|---|
| PM2 进程 | pid 335625, cluster mode, 1 instance |
| 内存 | 62.1 MB |
| 启动时间 | 2026-07-11 16:30 UTC |
| CPU 占用 | 0% (空闲) |
| 磁盘使用 | 6% (91 GB free) |
| UFW 防火墙 | ssh(22) / http(80) / https(443) 放行 |
| 数据库 | AWS RDS PostgreSQL (private VPC) |
| Redis | AWS ElastiCache (TLS enabled) |

---

## 📞 PM2 管理命令（服务器内）

```bash
# 查看状态
pm2 status

# 查看日志（实时）
pm2 logs repark-h5

# 查看最近 100 行日志（不实时）
pm2 logs repark-h5 --lines 100 --nostream

# 重启
pm2 start /var/www/app/ecosystem.config.js --env production

# 停止
pm2 stop repark-h5

# 删除
pm2 delete repark-h5
```

---

## 🛠️ 部署命令（本地 → 服务器）

如果你在本地做改动后想重新部署：

```bash
# 1. 打包
node scripts/package-deploy.mjs

# 2. 上传 + 部署
node scripts/upload-app.mjs

# 3. PM2 重启
node scripts/pm2-start.mjs restart

# 4. 健康检查
node scripts/remote-bash.mjs scripts/check-health.sh
```

---

## 🔐 安全提示

**客户使用完毕后**（特别是体验阶段），建议轮换以下密钥：

1. **Admin 登录密码**：`giys-agjj-niqt-yx2g` → 改用新密码
   ```bash
   node scripts/mint-admin-password.mjs --password=你的新密码 --write
   ```

2. **RDS 数据库密码**：当前为 `PhbcRcx5Wt`（在 `.env.local.example` 里有痕迹，假设已泄漏）
   - 在 AWS RDS 控制台轮换密码
   - 更新 `/var/www/app/.env.production` 中的 `DATABASE_URL`
   - 重启 PM2

3. **SSH 私钥**：当前 `keys/mercenary_h5_project.pem` 已清空 passphrase
   - 建议重新生成 keypair 并用 passphrase 保护
   - 在 EC2 控制台 `~/.ssh/authorized_keys` 替换

---

End of guide.