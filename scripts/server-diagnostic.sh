#!/usr/bin/env bash
echo "=== 1. Server alive? ==="
curl -s --max-time 10 -o /dev/null -w "HTTP %{http_code} time=%{time_total}s ip=%{remote_ip}\n" http://98.93.252.250:3000/

echo ""
echo "=== 2. PM2 status ==="
pm2 status

echo ""
echo "=== 3. Listening ports ==="
sudo ss -tlnp 2>/dev/null | grep -E ":3000|:80|:22" || ss -tlnp | grep ":3000"

echo ""
echo "=== 4. UFW allow list ==="
sudo ufw status numbered 2>/dev/null | head -30 || true

echo ""
echo "=== 5. nginx? ==="
systemctl is-active nginx 2>/dev/null || echo "nginx not running"

echo ""
echo "=== 6. Disk space ==="
df -h | head -5

echo ""
echo "=== 7. Last 20 lines of PM2 log ==="
pm2 logs repark-h5 --lines 20 --nostream --raw 2>&1 | tail -25