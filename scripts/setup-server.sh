#!/usr/bin/env bash
# scripts/setup-server.sh — Run on AWS EC2 to provision for P17 H5.
# Idempotent. Doesn't print env on login.

set -uo pipefail

echo "=== [1/6] apt update ==="
sudo apt-get update -y 2>&1 | tail -5

echo "=== [2/6] install Node.js 20.x ==="
NODE_MAJOR=$(node -v 2>/dev/null | cut -d. -f1 | tr -d 'v' || echo 0)
if [[ -z "${NODE_MAJOR:-0}" || "${NODE_MAJOR}" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>&1 | tail -5
  sudo apt-get install -y nodejs 2>&1 | tail -5
fi
node -v
npm -v

echo "=== [3/6] install PM2 + build tools + nginx ==="
sudo npm install -g pm2 2>&1 | tail -5
pm2 -v
sudo apt-get install -y build-essential nginx 2>&1 | tail -5
nginx -v 2>&1

echo "=== [4/6] UFW firewall ==="
if command -v ufw >/dev/null 2>&1; then
  sudo ufw --force reset 2>&1 | tail -2
  sudo ufw default deny incoming
  sudo ufw default allow outgoing
  sudo ufw allow ssh
  sudo ufw allow http
  sudo ufw allow https
  sudo ufw --force enable
  sudo ufw status
else
  echo "WARN: ufw not found"
fi

echo "=== [5/6] app directories ==="
sudo mkdir -p /var/www/app
sudo mkdir -p /etc/repark
sudo mkdir -p /var/log/repark-h5
sudo chown -R ubuntu:ubuntu /var/www/app /etc/repark /var/log/repark-h5
sudo chmod 750 /etc/repark
sudo chmod 755 /var/log/repark-h5
ls -la /var/www /etc/repark /var/log/repark-h5

echo "=== [6/6] logrotate ==="
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
echo "logrotate installed"

echo ""
echo "=== SERVER READY ==="
node -v
pm2 -v
nginx -v 2>&1
echo "App dir: /var/www/app"
echo "Owner dir: /etc/repark (chmod 750)"
echo "Log dir: /var/log/repark-h5"