#!/bin/bash
echo "===REMOTE_DEPLOY_PROBE==="
echo "--- /var/www/app/app/api/battle/leaderboard/ ---"
ls -la /var/www/app/app/api/battle/leaderboard/ 2>&1
echo ""
echo "--- current leaderboard route line count ---"
wc -l /var/www/app/app/api/battle/leaderboard/route.ts 2>&1
echo ""
echo "--- last 4 lines of current route (source-of-truth check) ---"
tail -n 4 /var/www/app/app/api/battle/leaderboard/route.ts 2>&1
echo ""
echo "--- grep for user_inventory.total_damage_dealt in CURRENT route ---"
grep -n "user_inventory\|total_damage_dealt\|user_activity_stats" /var/www/app/app/api/battle/leaderboard/route.ts 2>&1 || echo "(no matches)"
echo ""
echo "--- PM2 status ---"
pm2 list 2>&1 | head -10
echo ""
echo "--- Disk + memory ---"
df -h /var/www/app 2>&1 | head -3
free -h 2>&1 | head -2
echo ""
echo "--- /api/time health ---"
curl -s -o /dev/null -w "HTTP %{http_code} time=%{time_total}s\n" http://127.0.0.1:3000/api/time 2>&1