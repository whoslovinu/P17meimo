#!/bin/bash
echo '---STOP EVERYTHING---'
pm2 kill 2>&1 || true
sudo killall -9 next-server 2>&1 || true
sleep 3
echo '---PORT NOW---'
sudo ss -tlpn | grep ':3000' || echo 'port 3000 free'

echo '---DEPLOY NEW BUILD---'
cd /var/www/app
sudo tar -xzf /tmp/deploy.tar.gz
ls -la .next/BUILD_ID

echo '---START FROM CORRECT DIR---'
pm2 start node_modules/.bin/next --name repark-h5 -- start
sleep 6
pm2 status
echo '---FINAL PORT---'
sudo ss -tlpn | grep ':3000'