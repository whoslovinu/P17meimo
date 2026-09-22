#!/bin/bash
echo "===PM2_RESTART==="
echo "--- pre-restart status ---"
pm2 list 2>&1 | head -5
echo ""
echo "--- running reload ---"
date +%H:%M:%S
sudo -n pm2 reload repark-h5 --update-env 2>&1 | tail -20
echo "--- reload complete ---"
date +%H:%M:%S
echo ""
echo "--- waiting 8s for boot ---"
sleep 8
echo "--- post-restart status ---"
pm2 list 2>&1 | head -5
echo ""
echo "--- /api/time health ---"
curl -s -o /dev/null -w "HTTP %{http_code} (time=%{time_total}s)\n" http://127.0.0.1:3000/api/time