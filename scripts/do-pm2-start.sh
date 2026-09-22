#!/bin/bash
echo '--- PM2 start ---'
sudo -n pm2 start /var/www/app/ecosystem.config.js --only repark-h5 --env production 2>&1
sleep 10
echo '--- PM2 status ---'
sudo -n pm2 list 2>&1 | head -10
echo '--- health check ---'
curl -s -o /dev/null -w 'HTTP %{http_code} time=%{time_total}s' http://127.0.0.1:3000/api/time
echo ''
echo '=== DONE ==='
