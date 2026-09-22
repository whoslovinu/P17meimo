#!/usr/bin/env bash
# =============================================================================
# scripts/server-provision.sh — One-time AWS EC2 Ubuntu provisioning
# =============================================================================
# Run on a FRESH AWS EC2 Ubuntu 20.04/22.04 instance as `ubuntu` user.
# Idempotent — safe to re-run.
#
# What it does:
#   1. Updates system packages
#   2. Installs Node.js 20.x + npm + build tools
#   3. Installs PM2 (process manager) globally
#   4. Installs Nginx (reverse proxy)
#   5. Configures firewall (UFW) — SSH/HTTP/HTTPS
#   6. Creates /var/www/app and /etc/repark with proper perms
#   7. Sets up logrotate for PM2 logs
# =============================================================================

set -euo pipefail
IFS=$'\n\t'

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; RESET='\033[0m'
log()  { echo -e "${GREEN}[PROVISION]${RESET} $*"; }
warn() { echo -e "${YELLOW}[WARN]${RESET} $*" >&2; }
err()  { echo -e "${RED}[ERROR]${RESET} $*" >&2; exit 1; }
info() { echo -e "${BLUE}[INFO]${RESET} $*"; }

# ── 1. System update ─────────────────────────────────────────────────────────
log "阶段 1/7: 更新系统包"
sudo apt update -y
sudo apt upgrade -y
info "系统更新完成 ✓"

# ── 2. Node.js 20.x ──────────────────────────────────────────────────────────
log "阶段 2/7: 安装 Node.js 20.x"
if command -v node &>/dev/null && [[ "$(node -v | cut -d. -f1 | tr -d 'v')" -ge 20 ]]; then
  info "Node.js $(node -v) 已安装 ✓"
else
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
  info "Node.js $(node -v) 已安装 ✓"
fi

# Build tools (needed for some native modules)
sudo apt install -y build-essential

# ── 3. PM2 ──────────────────────────────────────────────────────────────────
log "阶段 3/7: 安装 PM2"
if command -v pm2 &>/dev/null; then
  info "PM2 $(pm2 -v) 已安装 ✓"
else
  sudo npm install -g pm2
  info "PM2 已安装 ✓"
fi

# ── 4. Nginx ────────────────────────────────────────────────────────────────
log "阶段 4/7: 安装 Nginx"
if command -v nginx &>/dev/null; then
  info "Nginx $(nginx -v 2>&1 | cut -d/ -f2) 已安装 ✓"
else
  sudo apt install -y nginx
  info "Nginx 已安装 ✓"
fi

# ── 5. Firewall ─────────────────────────────────────────────────────────────
log "阶段 5/7: 配置防火墙"
if command -v ufw &>/dev/null; then
  sudo ufw --force reset
  sudo ufw default deny incoming
  sudo ufw default allow outgoing
  sudo ufw allow ssh
  sudo ufw allow http
  sudo ufw allow https
  sudo ufw --force enable
  info "防火墙已配置 (ssh/http/https) ✓"
else
  warn "UFW 未安装，跳过防火墙配置"
fi

# ── 6. App directories ───────────────────────────────────────────────────────
log "阶段 6/7: 创建应用目录"
sudo mkdir -p /var/www/app
sudo mkdir -p /etc/repark
sudo mkdir -p /var/log/repark-h5
sudo chown -R ubuntu:ubuntu /var/www/app
sudo chown -R ubuntu:ubuntu /etc/repark
sudo chown -R ubuntu:ubuntu /var/log/repark-h5
sudo chmod 750 /etc/repark
sudo chmod 755 /var/log/repark-h5
info "/var/www/app, /etc/repark, /var/log/repark-h5 已创建 ✓"

# ── 7. logrotate for PM2 ────────────────────────────────────────────────────
log "阶段 7/7: 配置 logrotate"
sudo tee /etc/logrotate.d/pm2-ubuntu >/dev/null <<'EOF'
/var/www/app/.pm2/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 ubuntu ubuntu
    sharedscripts
    postrotate
        pm2 reloadLogs >/dev/null 2>&1 || true
    endscript
}
EOF
info "logrotate 已配置 ✓"

echo ""
log "服务器准备完成！"
info "下一步："
info "  1. SCP 上传代码：scp repark-deploy-*.tar.gz ubuntu@98.93.252.250:/tmp/"
info "  2. 解压 + 安装：cd /var/www/app && tar -xzf /tmp/repark-deploy-*.tar.gz && ./scripts/server-first-deploy.sh"