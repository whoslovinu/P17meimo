#!/bin/bash
# Read-only probe — no PM2 commands that could hang.
set +e
echo "===STATE_PROBE==="
echo "--- port 3000 ---"
sudo -n ss -tlnp 2>&1 | grep ":3000" || echo "(no listener on :3000)"
echo ""
echo "--- ps next-server ---"
sudo -n ps -ef | grep -E "next-server|next start" | grep -v grep || echo "(none)"
echo ""
echo "--- direct HTTP probes (no PM2 dependency) ---"
curl -s -m 3 -o /dev/null -w "/api/time → HTTP %{http_code} (%{time_total}s)\n" http://127.0.0.1:3000/api/time 2>&1
curl -s -m 3 -o /dev/null -w "/api/battle/leaderboard → HTTP %{http_code} (%{time_total}s)\n" http://127.0.0.1:3000/api/battle/leaderboard 2>&1
echo ""
echo "--- pm2 daemon alive? ---"
sudo -n pm2 list 2>&1 | head -10
exit 0