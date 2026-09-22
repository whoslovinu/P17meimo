#!/bin/bash
echo '--- fuser kill ---'
sudo fuser -k 3000/tcp 2>&1 || true
sleep 4
echo '--- port now ---'
sudo fuser 3000/tcp 2>&1 || echo 'FREE'
echo '--- restart pm2 ---'
sudo -n pm2 restart repark-h5 --env production 2>&1 || sudo -n pm2 start /var/www/app/ecosystem.config.js --name repark-h5 --env production 2>&1
sleep 12
echo '--- status ---'
sudo -n pm2 list 2>&1 | head -8
echo '--- health ---'
curl -s -o /dev/null -w 'HTTP %{http_code} time=%{time_total}s' http://127.0.0.1:3000/api/time
echo ''
echo '=== DONE ==='
