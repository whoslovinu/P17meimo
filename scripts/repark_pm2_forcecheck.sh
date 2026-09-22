#!/bin/bash
set +e
echo "===PM2_FORCE_RESET==="
# Hard-kill any existing repark-h5 PM2 process
echo "--- pm2 kill all (skipping) ---"
# Instead: check if process exists, kill if so
sudo -n ps -ef | grep -E "(node.*next|next-server|repark-h5)" | grep -v grep
echo ""
echo "--- check listener on :3000 ---"
sudo -n ss -tlnp 2>&1 | grep ":3000" || echo "(no listener on :3000)"
echo ""
echo "--- pm2 current status ---"
sudo -n pm2 list 2>&1 | head -10
echo ""
echo "--- pm2 jlist ---"
sudo -n pm2 jlist 2>&1 | head -3
echo ""
exit 0