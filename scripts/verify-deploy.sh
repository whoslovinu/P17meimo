#!/bin/bash
echo '=== PM2 + APP VERIFY ==='
echo '--- PM2 status (5 sec after launch) ---'
sleep 3
sudo -n pm2 list 2>&1
echo '--- PM2 logs last 10 ---'
sudo -n pm2 logs repark-h5 --lines 8 --nostream 2>&1 | grep -v '^$' | tail -15
echo '--- BUILD_ID on server ---'
cat /var/www/app/.next/BUILD_ID
echo ''
echo '--- isCanvasRendered in compiled battle page bundle ---'
grep -c 'isCanvasRendered' /var/www/app/.next/static/chunks/app/battle/*.js 2>/dev/null || true
echo '--- direct page probe ---'
curl -s -o /tmp/battle.html -w 'HTTP %{http_code} bytes=%{size_download}\n' http://127.0.0.1:3000/battle
echo '--- canvas gate string anywhere in .next ---'
grep -rln 'isCanvasRendered' /var/www/app/.next 2>&1 | head -5
echo '--- real canvas gate logic grep in .next ---'
grep -rln 'forceEnter BLOCKED' /var/www/app/.next 2>&1 | head -3
