#!/bin/bash
set +e
echo "===PM2_HARD_RESTART==="
# Kill any orphan next-server processes
echo "--- killing orphan next-server (pid 878384 if alive) ---"
sudo -n kill -9 878384 2>&1 || echo "(kill failed or already gone)"
sleep 2
echo "--- port 3000 after kill ---"
sudo -n ss -tlnp 2>&1 | grep ":3000" || echo "(no listener on :3000 — good)"
echo ""
echo "--- delete old pm2 entry ---"
sudo -n pm2 delete repark-h5 2>&1 || echo "(delete failed — maybe not registered)"
echo ""
echo "--- start fresh ---"
date +%H:%M:%S
sudo -n pm2 start /var/www/app/ecosystem.config.js --only repark-h5 --env production 2>&1 | tail -15
sleep 10
echo "--- status after 10s ---"
date +%H:%M:%S
sudo -n pm2 list 2>&1 | head -10
echo ""
echo "--- health probe ---"
curl -s -o /dev/null -w "HTTP %{http_code} (time=%{time_total}s)\n" http://127.0.0.1:3000/api/time
curl -s -o /dev/null -w "HTTP %{http_code} (time=%{time_total}s)\n" http://127.0.0.1:3000/api/battle/leaderboard
exit 0