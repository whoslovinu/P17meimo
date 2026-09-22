#!/bin/bash
# REPARK 7.0 leaderboard deploy — PM2 reload
# Simpler variant without --update-env (waits for ready via wait_ready flag).
set +e
cd /var/www/app

echo "===PM2_RELOAD==="
date +%H:%M:%S
sudo -n pm2 stop repark-h5
echo "[stop ok]"
sleep 2
sudo -n pm2 start /var/www/app/ecosystem.config.js --only repark-h5 --env production
echo "[start ok]"
sleep 8
echo "===STATUS==="
sudo -n pm2 list | head -10
echo "===HEALTH==="
curl -s -o /dev/null -w "HTTP %{http_code} (time=%{time_total}s)\n" http://127.0.0.1:3000/api/time
echo "===DONE==="
date +%H:%M:%S
exit 0