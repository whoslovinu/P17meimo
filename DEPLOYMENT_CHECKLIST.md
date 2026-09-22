# 🚀 DEPLOYMENT CHECKLIST — P17 H5 魅魔来袭

> **用途**: 部署到客户 EC2 时的完整操作手册。
> **预计耗时**: 2-3 小时（不包括 DNS 传播）
> **不需要 VPN**：EC2 SSH 22 端口直接连

---

## 阶段 A：部署前准备（在您本地完成）

### A.1 生成所有密钥

```bash
cd h:\PROJECT\P17_H5meimo-demo

# 1. ADMIN_SECRET_KEY（管理面板密码）
node scripts/generate-owner-key.mjs --label=ADMIN_SECRET_KEY
# 把输出存到 1Password，标注 "P17 H5 — Admin Login"

# 2. OWNER_COMMAND_KEY（您的远程控制通道）
node scripts/generate-owner-key.mjs --label=OWNER_COMMAND_KEY
# 把输出存到 1Password，标注 "P17 H5 — Owner Command"

# 3. WEBHOOK_SECRET（与客户主站协商的共享密钥）
# 这个由客户/主站提供，不是您生成的
```

**把这两个 ADMIN_SECRET_KEY 和 OWNER_COMMAND_KEY 存好后，继续。**

### A.2 与客户确认以下信息

| 项目 | 客户需要提供的 | 备注 |
|---|---|---|
| 域名 | `h5.example.com` | 您的 EC2 域名或他们买的域名 |
| Webhook Secret | `WEBHOOK_SECRET` 的值 | 客户主站用来签名的密钥 |
| PostgreSQL 端点 | `aws_rds_init/aws_01_schema.sql` 执行确认 | 客户提供 RDS 连接信息 |
| Redis 端点 | ElastiCache 连接串 | 客户提供 |
| SSH 登录方式 | `ec2-user@<ip>` + 密钥文件 | 客户提供 |

### A.3 在 EC2 上创建目录结构

SSH 登录后执行：

```bash
# 1. 创建应用目录
sudo mkdir -p /opt/repark && sudo chown -R ec2-user:ec2-user /opt/repark

# 2. 创建 owner 密钥目录（Phase 10）
sudo mkdir -p /etc/repark && sudo chown -R root:root /etc/repark
chmod 700 /etc/repark

# 3. 创建备份目录
sudo mkdir -p /opt/repark/backups && sudo chown -R ec2-user:ec2-user /opt/repark/backups
```

### A.4 上传 owner 密钥到 EC2

**用您存在 1Password 里的值**：

```bash
# 在您本地执行（不是 EC2）
scp -i /path/to/your/key.pem <<EOF ec2-user@<EC2_IP>:/tmp/owner.env
OWNER_COMMAND_KEY=<您的64位十六进制字符串>
EOF

# 然后在 EC2 上：
ssh -i /path/to/your/key.pem ec2-user@<EC2_IP>
sudo mv /tmp/owner.env /etc/repark/owner.env
sudo chown root:root /etc/repark/owner.env
chmod 600 /etc/repark/owner.env
```

### A.5 创建环境变量文件

在 EC2 上创建 `/opt/repark/.env.production`：

```bash
sudo nano /opt/repark/.env.production
```

内容（根据客户提供的信息填写）：

```bash
# Node
NODE_ENV=production

# PostgreSQL（RDS）
DATABASE_URL="postgresql://postgres:<PASSWORD>@<RDS_ENDPOINT>:5432/postgres"

# Redis（ElastiCache）
REDIS_URL="rediss://<ELASTICACHE_ENDPOINT>:6379"
REDIS_TLS=true

# 管理面板密钥（从 1Password 复制 ADMIN_SECRET_KEY 的值）
ADMIN_SECRET_KEY=<32字节以上的随机字符串>

# Webhook（客户提供）
WEBHOOK_SECRET=<客户提供的 webhook 签名密钥>

# 公开变量
NEXT_PUBLIC_APP_URL=https://<YOUR_DOMAIN>
NEXT_PUBLIC_AUTH_COOKIE_NAME=uid
NEXT_PUBLIC_MAIN_STATION_URL=https://<CUSTOMER_MAIN_STATION_URL>

# owner-command（指向 /etc/repark/owner.env，加载它）
# PM2 会在启动前 source 这个文件
```

### A.6 创建 PM2 ecosystem 文件

在 EC2 上 `/opt/repark/ecosystem.config.js`：

```bash
sudo nano /opt/repark/ecosystem.config.js
```

```javascript
const path = require('path');

// Load owner command key from /etc/repark/owner.env if it exists
let ownerEnv = {};
try {
  const fs = require('fs');
  if (fs.existsSync('/etc/repark/owner.env')) {
    const lines = fs.readFileSync('/etc/repark/owner.env', 'utf8').split('\n');
    for (const line of lines) {
      const [key, ...rest] = line.split('=');
      if (key && rest.length > 0) {
        ownerEnv[key.trim()] = rest.join('=').trim();
      }
    }
  }
} catch (e) {
  console.warn('[PM2] Could not load /etc/repark/owner.env:', e.message);
}

module.exports = {
  apps: [{
    name: 'repark-h5',
    script: 'npm',
    args: 'start',
    cwd: '/opt/repark',
    instances: 1,
    autorestart: true,
    max_memory_restart: '1G',
    env_production: {
      NODE_ENV: 'production',
      ...ownerEnv,
      // These are sourced from /opt/repark/.env.production via env_file below
    },
    env_file: '/opt/repark/.env.production',
    max_restarts: 5,
    min_uptime: '10s',
  }],
};
```

### A.7 验证数据库迁移脚本

**在运行应用之前**，确保 RDS 上的表已创建：

```bash
# 在您的本地机器上执行（因为您有 SSH 隧道）
# 运行 aws_rds_init 目录下的所有迁移脚本

psql "postgresql://postgres:PhbcRcx5Wt@localhost:5433/postgres" -f aws_rds_init/aws_01_schema.sql
psql "postgresql://postgres:PhbcRcx5Wt@localhost:5433/postgres" -f aws_rds_init/aws_02_indexes.sql
psql "postgresql://postgres:PhbcRcx5Wt@localhost:5433/postgres" -f aws_rds_init/aws_03_functions.sql
psql "postgresql://postgres:PhbcRcx5Wt@localhost:5433/postgres" -f aws_rds_init/aws_04_seed.sql
psql "postgresql://postgres:PhbcRcx5Wt@localhost:5433/postgres" -f aws_rds_init/aws_05_user_status.sql
psql "postgresql://postgres:PhbcRcx5Wt@localhost:5433/postgres" -f aws_rds_init/aws_06_repark_config.sql

# 验证表是否存在
psql "postgresql://postgres:PhbcRcx5Wt@localhost:5433/postgres" -c "\dt public.*"
```

**预期输出**：boss_status、user_inventory、attack_logs、milestone_rewards、admin_audit_log、repark_config 等表都应该列出。

---

## 阶段 B：部署（SSH 登录 EC2）

### B.1 上传代码

```bash
# 在您的本地机器上
cd h:\PROJECT\P17_H5meimo-demo
rsync -avz --exclude='node_modules' --exclude='.next' --exclude='.env*' \
  -e "ssh -i /path/to/your/key.pem" \
  ./ ec2-user@<EC2_IP>:/opt/repark/

# 或者用 scp 整个目录（慢一点）
scp -ri /path/to/your/key.pem ./* ec2-user@<EC2_IP>:/opt/repark/
```

### B.2 安装依赖

```bash
ssh -i /path/to/your/key.pem ec2-user@<EC2_IP>
cd /opt/repark

# 安装依赖（需要几分钟）
npm install

# 构建（生产模式）
npm run build
```

### B.3 启动服务

```bash
# 全局安装 PM2（如果还没有）
sudo npm install -g pm2

# 启动
cd /opt/repark
pm2 start ecosystem.config.js --env production

# 开机自启
pm2 startup
pm2 save

# 查看状态
pm2 status
```

**预期输出**：
```
┌─────┬──────────┬─────────┬───────┬──────┬──────────┬──────────┬─────┐
│ id  │ name     │ status  │ cpu   │ mem  │ uptime   │ restarts │ ... │
├─────┼──────────┼─────────┼───────┼──────┼──────────┼──────────┼─────┤
│ 0   │ repark-h5│ online  │ 0.5%  │ 85MB │ 5s       │ 0        │     │
└─────┴──────────┴─────────┴───────┴──────┴──────────┴──────────┴─────┘
```

### B.4 设置日志轮转

```bash
# PM2 日志轮转（PM2 内置）
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 save
```

---

## 阶段 C：部署后验证

### C.1 健康检查（SSH 进入 EC2）

```bash
# 检查进程状态
pm2 status

# 查看日志（确保没有 ERROR）
pm2 logs repark-h5 --lines 50 --nostream

# 测试 startup 端点（需要先 curl localhost）
curl -f http://localhost:3000/api/internal/startup
# 预期：{"ok":true,"message":"Already started" 或 "Background services started"}

# 测试 boss status
curl -f http://localhost:3000/api/boss/status
# 预期：HTTP 200，含 boss HP 数据

# 测试 admin login（用您生成的 ADMIN_SECRET_KEY）
curl -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"password":"<您的管理密码>"}'
# 预期：HTTP 200，set-cookie 有 admin_token

# 测试公开 battle init
curl http://localhost:3000/api/battle/init
# 预期：HTTP 200
```

### C.2 从外网测试（您本地浏览器）

```bash
# 用域名或 EC2 公网 IP
curl https://<YOUR_DOMAIN>/api/boss/status

# 如果没有 HTTPS（还没配证书），先用 HTTP 测试
curl http://<EC2_PUBLIC_IP>:3000/api/boss/status
```

**预期**：返回 JSON 数据，不是 connection refused。

### C.3 配置 HTTPS（Let's Encrypt）

```bash
ssh -i /path/to/your/key.pem ec2-user@<EC2_IP>

# 安装 Certbot
sudo yum install -y certbot python3-certbot-nginx

# 获取证书（需要域名已指向 EC2）
sudo certbot --nginx -d <YOUR_DOMAIN>

# 自动续期测试
sudo certbot renew --dry-run
```

### C.4 配置 Nginx 反向代理（推荐）

```bash
sudo nano /etc/nginx/conf.d/repark.conf
```

```nginx
server {
    listen 80;
    server_name <YOUR_DOMAIN>;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx
```

---

## 阶段 D：运营检查清单

### D.1 每小时监控（前 24 小时）

```bash
# SSH 进去检查一次
ssh -i /path/to/your/key.pem ec2-user@<EC2_IP>

# 1. PM2 状态
pm2 status

# 2. 内存使用
pm2 monit

# 3. 错误日志
pm2 logs repark-h5 --lines 20 --nostream | grep -i error

# 4. Redis 连接
curl http://localhost:3000/api/boss/status | jq .
```

### D.2 备份策略

```bash
# 每日 PostgreSQL 备份（systemd timer）
sudo nano /etc/systemd/system/repark-backup.timer

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
# 备份脚本
sudo nano /opt/repark/scripts/backup.sh
```

```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR=/opt/repark/backups
mkdir -p $BACKUP_DIR

# PostgreSQL 备份
pg_dump "postgresql://postgres:<PASSWORD>@<RDS_ENDPOINT>:5432/postgres" \
  -F c -b -f "$BACKUP_DIR/repark_${DATE}.dump"

# 保留最近 7 天
find $BACKUP_DIR -name "repark_*.dump" -mtime +7 -delete

echo "Backup complete: repark_${DATE}.dump"
```

---

## 阶段 E：回滚方案

### E.1 PM2 回滚

```bash
# 查看历史版本
pm2 list

# 如果当前版本有问题，切到上一版
pm2 delete repark-h5
pm2 start ecosystem.config.js --env production

# 或者直接 reload（Zero-downtime）
pm2 reload repark-h5 --env production
```

### E.2 完全重建

```bash
# 保留 .env.production 和 /etc/repark/owner.env
cd /opt/repark
rm -rf .next node_modules

# 重新安装
npm install
npm run build
pm2 restart repark-h5 --env production
```

---

## 阶段 F：部署完成后的最终检查

| # | 检查项 | 方法 | 通过标准 |
|---|---|---|---|
| F.1 | 首页加载 | 浏览器访问 `https://<domain>` | 显示 H5 魅魔来袭页面，无 500 |
| F.2 | 战斗页面 | 访问 `/battle` | 显示战斗界面或重定向到登录 |
| F.3 | Admin 登录 | 访问 `/admin/login`，用 ADMIN_SECRET_KEY 登录 | 登录成功，看到后台 |
| F.4 | Boss HP 显示 | 打开 F12，看 network 里 `/api/boss/status` | 返回 HP 数据 |
| F.5 | 攻击功能 | 发送攻击请求 | 返回伤害数字，HP 减少 |
| F.6 | 音量条 | 点击 BGM 按钮 | 弹出音量 slider |
| F.7 | HTTPS | 浏览器地址栏 | 显示绿色锁（或灰色锁，不显示"不安全"） |
| F.8 | owner-command | 从您本地用 OWNER_COMMAND_KEY 发送 ping | 返回 { ok: true } |
| F.9 | PM2 自启 | 重启 EC2 | `pm2 list` 显示 online，自动启动 |
| F.10 | 日志无 ERROR | `pm2 logs repark-h5 --lines 100` | 无红色 ERROR 日志 |

---

## ❌ 常见错误与解决方案

| 错误 | 原因 | 解决方案 |
|---|---|---|
| `ECONNREFUSED` on Redis | Redis 端口不通 | 检查 REDIS_URL / REDIS_TLS 配置 |
| `ECONNREFUSED` on PostgreSQL | RDS 端口不通 | 检查 DATABASE_URL，网络 ACL 是否开放 |
| `ADMIN_SECRET_KEY is not set` | 环境变量未加载 | 检查 `/opt/repark/.env.production` 是否存在 |
| `401 Unauthorized` on admin | token 过期或密码错误 | 重新 POST /api/admin/login |
| `owner-command 503` | `OWNER_COMMAND_KEY` 未设置 | 检查 `/etc/repark/owner.env` 是否存在且 chmod 600 |
| PM2 显示 `errored` | npm start 失败 | `pm2 logs` 看具体错误 |
| 页面 502 | Nginx 未配置 | 检查 nginx.conf 和反向代理 |
| HTTPS 证书无效 | Let's Encrypt 未配置 | `sudo certbot --nginx -d <domain>` |

---

*Last updated: Phase 11*