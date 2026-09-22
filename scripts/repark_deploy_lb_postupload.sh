#!/bin/bash
set -e
echo "===POST_UPLOAD_VERIFY==="
echo "--- size + line count ---"
ls -l /var/www/app/app/api/battle/leaderboard/route.ts
wc -l /var/www/app/app/api/battle/leaderboard/route.ts
echo ""
echo "--- grep for migration invariants ---"
echo "[user_inventory references]:"; grep -c "user_inventory" /var/www/app/app/api/battle/leaderboard/route.ts || true
echo "[total_damage_dealt references]:"; grep -c "total_damage_dealt" /var/www/app/app/api/battle/leaderboard/route.ts || true
echo "[user_activity_stats references]:"; grep -c "user_activity_stats" /var/www/app/app/api/battle/leaderboard/route.ts || true
echo "[getActiveActivity references]:"; grep -c "getActiveActivity" /var/www/app/app/api/battle/leaderboard/route.ts || true
echo "[activity_id = \$1 references]:"; grep -c "activity_id = \$1" /var/www/app/app/api/battle/leaderboard/route.ts || true