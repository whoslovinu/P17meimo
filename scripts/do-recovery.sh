#!/bin/bash
set -e
echo '========== STEP 2: GRACEFUL STOP =========='
echo ''
echo '--- health check before ---'
curl -s -o /dev/null -w 'HTTP %{http_code} time=%{time_total}s\n' http://127.0.0.1:3000/api/time || true
echo ''
echo '--- graceful kill 896097 ---'
kill 896097 2>/dev/null && echo 'GRACEFUL_KILL_SENT' || echo 'ALREADY_DEAD'
echo ''
echo '--- wait up to 10s ---'
for i in $(seq 1 10); do
  if ps -p 896097 >/dev/null 2>&1; then
    echo "  still alive, waiting... ($i/10)"
    sleep 1
  else
    echo "  PROCESS_DEAD after ${i}s"
    break
  fi
done
if ps -p 896097 >/dev/null 2>&1; then
  echo '--- FORCE KILL ---'
  kill -9 896097 2>/dev/null && echo 'KILLED_FORCED' || echo 'ALREADY_DEAD'
  sleep 2
fi
echo ''
echo '--- port check ---'
ss -ltnp | grep :3000 || echo 'PORT_FREE'
echo ''

echo '========== STEP 3: DELETE STALE PM2 =========='
echo ''
sudo -n pm2 delete repark-h5 2>&1 && echo 'DELETED' || echo 'ALREADY_GONE'
echo ''

echo '========== STEP 4: CHECK OWNERSHIP + START =========='
echo ''
echo '--- .next owner ---'
stat -c '%U:%G' /var/www/app/.next 2>&1
echo ''
echo '--- starting PM2 fresh ---'
sudo -n pm2 start /var/www/app/ecosystem.config.js --env production 2>&1
echo ''

echo '========== STEP 5: VERIFY =========='
echo ''
echo '--- wait 12s for startup ---'
sleep 12
echo ''
echo '--- PM2 status ---'
sudo -n pm2 list 2>&1 | head -15
NEW_PID=$(sudo -n pm2 pid repark-h5 2>/dev/null | head -1)
echo "new_pid=$NEW_PID"
echo ''
echo '--- port check ---'
ss -ltnp | grep :3000 || echo 'NO_LISTENER'
echo ''

echo '========== STEP 6: HEALTH CHECKS =========='
echo ''
echo '--- /api/time ---'
curl -s -o /dev/null -w 'HTTP %{http_code} time=%{time_total}s\n' http://127.0.0.1:3000/api/time || echo 'FAILED'
echo ''
echo '--- /api/battle/leaderboard ---'
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3000/api/battle/leaderboard || echo 'FAILED'
echo ''
echo '--- BUILD_ID ---'
cat /var/www/app/.next/BUILD_ID
echo ''

echo '========== STEP 7: PM2 SAVE + STARTUP =========='
echo ''
echo '--- pm2 save ---'
sudo -n pm2 save 2>&1 && echo 'SAVED' || echo 'SAVE_FAILED'
echo ''
echo '--- pm2 startup check ---'
ls /etc/systemd/system/pm2*.service 2>/dev/null && echo 'SYSTEMD_EXISTS' || echo 'NO_SYSTEMD'
ls /etc/init.d/pm2* 2>/dev/null && echo 'INITD_EXISTS' || echo 'NO_INITD'
crontab -l 2>/dev/null | grep pm2 && echo 'CRON_EXISTS' || echo 'NO_CRON'
echo ''

echo '========== REPORT COMPLETE =========='
