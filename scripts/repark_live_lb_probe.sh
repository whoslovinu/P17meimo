#!/bin/bash
set +e
echo "===LIVE_LB_SCENARIO==="
echo "--- endpoint payload (active activity=1) ---"
curl -s -m 5 http://127.0.0.1:3000/api/battle/leaderboard | python3 -m json.tool 2>&1
echo ""
echo "--- direct DB check (matches route query exactly) ---"
sudo -n -u postgres psql -d postgres -c "
SELECT uas.user_id, uas.total_damage, COALESCE(NULLIF(u.nickname, ''), '神秘玩家') AS nickname
  FROM public.user_activity_stats uas
  LEFT JOIN public.users u ON u.id = uas.user_id
 WHERE uas.activity_id = 1 AND uas.total_damage > 0
 ORDER BY uas.total_damage DESC LIMIT 50;
" 2>&1 | head -20
echo ""
echo "--- PM2 leaderboard log lines (last 5) ---"
sudo -n tail -n 200 /root/.pm2/logs/repark-h5-out-0.log 2>&1 | grep LEADERBOARD | tail -5
exit 0