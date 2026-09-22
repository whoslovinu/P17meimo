# AWS Ubuntu 部署手册

本文档说明如何在 AWS EC2 Ubuntu 服务器上部署本 Next.js 应用。

---

## 服务器信息

| 项目 | 值 |
|------|-----|
| 服务器 IP | `98.93.252.250` |
| 用户名 | `ubuntu` |
| SSH 密钥 | 请使用您的 AWS 密钥对 |

---

## 第一步：连接服务器

```bash
ssh -i /path/to/your-key.pem ubuntu@98.93.252.250
```

---

## 第二步：安装必要软件

### 更新系统包

```bash
sudo apt update && sudo apt upgrade -y
```

### 安装 Node.js 20.x

```bash
# 安装 NodeSource 仓库
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# 安装 Node.js
sudo apt install -y nodejs

# 验证安装
node -v   # 应显示 v20.x.x
npm -v
```

### 安装 PM2 (进程管理器)

```bash
sudo npm install -g pm2
```

### 安装 Nginx

```bash
sudo apt install -y nginx
```

---

## 第三步：上传代码

### 方式 A：通过 Git 克隆（推荐）

```bash
# 在服务器上创建应用目录
sudo mkdir -p /var/www/app
sudo chown ubuntu:ubuntu /var/www/app

# 进入目录并克隆代码
cd /var/www/app
git clone https://your-repo-url.git .
```

### 方式 B：通过 SCP 上传

```bash
# 从本地上传压缩包
scp -i /path/to/key.pem app.tar.gz ubuntu@98.93.252.250:/tmp/

# 在服务器上解压
ssh -i /path/to/key.pem ubuntu@98.93.252.250 "mkdir -p /var/www/app && tar -xzf /tmp/app.tar.gz -C /var/www/app"
```

---

## 第四步：配置环境变量

```bash
cd /var/www/app

# 创建生产环境配置文件
sudo nano .env.production
```

### .env.production 示例

```env
# Redis (AWS ElastiCache Serverless - TLS)
REDIS_URL=rediss://rp1-bkmbmc.serverless.use1.cache.amazonaws.com:6379
REDIS_TLS=true

# Supabase
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-real-service-role-key-here

# Application
NEXT_PUBLIC_APP_URL=https://your-domain.com
ADMIN_SECRET_KEY=your-secure-production-admin-secret

# Node Environment
NODE_ENV=production
```

### 复制到正确位置

```bash
sudo cp .env.production /var/www/app/.env.local
sudo chown ubuntu:ubuntu /var/www/app/.env.local
```

---

## 第五步：安装依赖并构建

```bash
cd /var/www/app

# 安装依赖
npm install

# 构建生产版本
npm run build

# 创建 PM2 生态系统配置
nano ecosystem.config.js
```

### ecosystem.config.js 内容

```javascript
module.exports = {
  apps: [
    {
      name: 'boss-battle',
      script: 'npm',
      args: 'start',
      cwd: '/var/www/app',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
};
```

---

## 第六步：启动应用

```bash
# 使用 PM2 启动
pm2 start ecosystem.config.js

# 保存 PM2 进程列表（开机自启）
pm2 save

# 设置开机启动
pm2 startup
```

### 常用 PM2 命令

| 命令 | 说明 |
|------|------|
| `pm2 status` | 查看进程状态 |
| `pm2 logs` | 查看日志 |
| `pm2 restart boss-battle` | 重启应用 |
| `pm2 stop boss-battle` | 停止应用 |

---

## 第七步：配置 Nginx 反向代理

```bash
sudo nano /etc/nginx/sites-available/boss-battle
```

### Nginx 配置内容

```nginx
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 启用配置

```bash
# 创建软链接
sudo ln -s /etc/nginx/sites-available/boss-battle /etc/nginx/sites-enabled/

# 测试配置语法
sudo nginx -t

# 重载 Nginx
sudo systemctl reload nginx
```

---

## 第八步：配置防火墙（可选但推荐）

```bash
# 允许 SSH、HTTP、HTTPS
sudo ufw allow ssh
sudo ufw allow 80
sudo ufw allow 443

# 启用防火墙
sudo ufw enable
```

---

## HTTPS 配置（使用 Let's Encrypt）

```bash
# 安装 Certbot
sudo apt install -y certbot python3-certbot-nginx

# 获取证书（需要域名解析到服务器）
sudo certbot --nginx -d your-domain.com

# 自动续期测试
sudo certbot renew --dry-run
```

---

## 验证部署

```bash
# 检查应用状态
pm2 status

# 检查 Nginx 状态
sudo systemctl status nginx

# 查看应用日志
pm2 logs boss-battle

# 测试 API
curl http://localhost:3000/api/battle/init
```

---

## 故障排除

### 应用启动失败

```bash
# 查看详细错误
pm2 logs boss-battle --err --lines 50

# 常见问题：
# 1. 端口被占用：pm2 delete all && pm2 start
# 2. 环境变量缺失：检查 .env.local 文件
# 3. 权限问题：chown -R ubuntu:ubuntu /var/www/app
```

### Nginx 502 Bad Gateway

```bash
# 检查应用是否运行
curl http://127.0.0.1:3000/api/battle/init

# 检查 Nginx 日志
sudo tail -f /var/log/nginx/error.log
```

### Redis 连接失败

```bash
# 测试 Redis 连接
redis-cli -h rp1-bkmbmc.serverless.use1.cache.amazonaws.com -p 6379 --tls ping

# 检查环境变量
cat /var/www/app/.env.local | grep REDIS
```

---

## 更新部署

```bash
cd /var/www/app

# 拉取新代码
git pull

# 重新构建
npm run build

# 重启应用
pm2 restart boss-battle
```

---

*文档版本：v1.0 | 更新日期：2026-04-28*
