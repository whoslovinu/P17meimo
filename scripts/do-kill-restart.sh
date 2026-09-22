#!/bin/bash
echo '--- kill old process ---'
sudo kill -9 885602 2>&1 && echo 'KILLED' || echo 'ALREADY_DEAD'
sleep 3
echo '--- port check ---'
sudo fuser 3000/tcp 2>&1 || echo 'PORT_FREE'
echo '--- PM2 delete old ---'
sudo -n pm2 delete repark-h5 2>&1 || true
echo '--- PM2 start fresh ---'
sudo -n pm2 start /var/www/app/ecosystem.config.js --name repark-h5 --env production 2>&1
sleep 10
echo '--- PM2 status ---'
sudo -n pm2 list 2>&1 | head -10
echo '--- health check ---'
curl -s -o /dev/null -w 'HTTP %{http_code} time=%{time_total}s' http://127.0.0.1:3000/api/time
echo ''
echo '=== DONE ==='
