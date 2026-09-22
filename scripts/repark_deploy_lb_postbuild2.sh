#!/bin/bash
echo "===POST_BUILD_RECHECK==="
ROUTE=/var/www/app/.next/server/app/api/battle/leaderboard/route.js
echo "--- file info ---"
ls -la "$ROUTE"
echo ""
echo "--- key strings ---"
echo "[user_activity_stats]: $(grep -c 'user_activity_stats' "$ROUTE")"
echo "[user_inventory]: $(grep -c 'user_inventory' "$ROUTE")"
echo "[total_damage_dealt]: $(grep -c 'total_damage_dealt' "$ROUTE")"
echo "[activity_id]: $(grep -c 'activity_id' "$ROUTE")"
echo "[getActiveActivity]: $(grep -c 'getActiveActivity' "$ROUTE")"
echo "[lib/db/pg]: $(grep -c 'lib/db/pg' "$ROUTE")"
echo ""
echo "--- first user_activity_stats match context ---"
grep -o '.\{30\}user_activity_stats.\{30\}' "$ROUTE" | head -3
echo ""
echo "--- first activity_id match context ---"
grep -o '.\{30\}activity_id.\{30\}' "$ROUTE" | head -3