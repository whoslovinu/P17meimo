#!/bin/bash
echo "===PM2_STATUS==="
pm2 list 2>&1 | head -50
echo ""
echo "===PM2_LOGS_TAIL==="
pm2 logs repark-h5 --lines 30 --nostream --raw 2>&1 | tail -80
echo ""
echo "===CWD_APP_CHECK==="
test -f /var/www/app/package.json && echo "package.json: PRESENT" || echo "package.json: MISSING"
test -d /var/www/app/.next && echo ".next/: PRESENT" || echo ".next/: MISSING"
echo ""
echo "===HEALTHCHECK==="
curl -s -o /dev/null -w "HTTP %{http_code} (time=%{time_total}s)\n" http://127.0.0.1:3000/api/time 2>&1