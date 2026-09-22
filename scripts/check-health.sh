#!/usr/bin/env bash
# scripts/check-health.sh — Quick health checks after deploy
echo "=== 1. PM2 status ==="
pm2 status

echo ""
echo "=== 2. /api/internal/startup ==="
STARTUP=$(curl -sf --max-time 5 http://localhost:3000/api/internal/startup 2>&1 || echo "FAILED: $?")
echo "$STARTUP"
if echo "$STARTUP" | grep -q '"ok":true'; then
  echo "PASS: startup ok=true"
else
  echo "FAIL: startup not ok"
fi

echo ""
echo "=== 3. /api/boss/status ==="
BOSS=$(curl -sf --max-time 5 http://localhost:3000/api/boss/status 2>&1 || echo "FAILED: $?")
echo "$BOSS"
if echo "$BOSS" | grep -q '"ok":true'; then
  echo "PASS: boss/status ok=true"
else
  echo "FAIL: boss/status not ok"
fi

echo ""
echo "=== 4. /api/time ==="
TIME=$(curl -sf --max-time 5 http://localhost:3000/api/time 2>&1 || echo "FAILED: $?")
echo "$TIME"

echo ""
echo "=== 5. /api/user/status (no cookie, should 400) ==="
USR=$(curl -sf -o /dev/null -w "HTTP %{http_code}\n" --max-time 5 http://localhost:3000/api/user/status 2>&1)
echo "$USR"

echo ""
echo "=== 6. UFW rules ==="
sudo ufw status

echo ""
echo "=== 7. Disk usage ==="
df -h / /var/www 2>&1 | head -5

echo ""
echo "=== 8. Memory ==="
free -m

echo ""
echo "=== HEALTH CHECK COMPLETE ==="