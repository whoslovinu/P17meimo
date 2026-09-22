#!/bin/bash
echo "===POST_BUILD_VERIFY==="
echo "--- .next/server/app/api/battle/leaderboard/ ---"
ls -la /var/www/app/.next/server/app/api/battle/leaderboard/ 2>&1
echo ""
echo "--- mtime of compiled leaderboard route ---"
stat -c "%n %y %s bytes" /var/www/app/.next/server/app/api/battle/leaderboard/route.js 2>&1
echo ""
echo "--- grep compiled bundle for migration invariants ---"
ROUTE=/var/www/app/.next/server/app/api/battle/leaderboard/route.js
if [ -f "$ROUTE" ]; then
  echo "[user_inventory in compiled bundle]: $(grep -c 'user_inventory' "$ROUTE" || echo 0)"
  echo "[total_damage_dealt in compiled bundle]: $(grep -c 'total_damage_dealt' "$ROUTE" || echo 0)"
  echo "[user_activity_stats in compiled bundle]: $(grep -c 'user_activity_stats' "$ROUTE" || echo 0)"
  echo "[getActiveActivity in compiled bundle]: $(grep -c 'getActiveActivity' "$ROUTE" || echo 0)"
  echo "[activity_id = \\$1 in compiled bundle]: $(grep -c 'activity_id' "$ROUTE" || echo 0)"
else
  echo "NO COMPILED FILE"
fi
echo ""
echo "--- check .next ownership / permissions on trace file ---"
ls -la /var/www/app/.next/trace 2>&1 || echo "(no .next/trace file — maybe absent)"
echo ""
echo "--- .next dir owner ---"
stat -c '%U:%G %a' /var/www/app/.next 2>&1