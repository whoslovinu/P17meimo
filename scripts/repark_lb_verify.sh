#!/bin/bash
set +e
echo "===LEADERBOARD_VERIFY==="
echo "--- /api/battle/leaderboard payload (active activity 1) ---"
curl -s -m 5 http://127.0.0.1:3000/api/battle/leaderboard | python3 -m json.tool 2>&1 | head -60
echo ""
echo "--- raw bytes ---"
curl -s -m 5 http://127.0.0.1:3000/api/battle/leaderboard | head -c 500
echo ""
echo ""
echo "--- last 3 [LEADERBOARD] log lines ---"
sudo -n tail -n 200 /root/.pm2/logs/repark-h5-out-0.log 2>&1 | grep LEADERBOARD | tail -5