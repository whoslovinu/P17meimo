#!/bin/bash
echo '=== FULL PM2 RECOVERY ==='
echo '--- kill all next-server ---'
sudo -n pkill -9 -f 'next-server' 2>&1 || true
sleep 3
echo '--- port 3000 now ---'
sudo -n ss -ltnp | grep ':3000' || echo '(free)'
echo ''
echo '--- delete from ubuntu pm2 daemon ---'
sudo -n -u ubuntu pm2 delete repark-h5 2>&1 || true
sleep 1
echo '--- delete from root pm2 daemon ---'
sudo -n pm2 delete repark-h5 2>&1 || true
sleep 1
echo '--- list both daemons ---'
echo 'ROOT:'; sudo -n pm2 list 2>&1 | head -10
echo ''
echo 'UBUNTU:'; sudo -n -u ubuntu pm2 list 2>&1 | head -10
echo ''
echo '--- start fresh from root daemon ---'
sudo -n pm2 start /var/www/app/ecosystem.config.js --only repark-h5 --env production 2>&1
echo '--- wait 10s ---'
sleep 10
echo '--- final pm2 list (root) ---'
sudo -n pm2 list 2>&1 | head -10
echo '--- final port ---'
sudo -n ss -ltnp | grep ':3000'
echo '--- /api/time ---'
curl -s -o /dev/null -w 'HTTP %{http_code} time=%{time_total}s\n' http://127.0.0.1:3000/api/time
echo '--- /battle ---'
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3000/battle
echo '--- PM2 error logs last 3 ---'
sudo -n pm2 logs repark-h5 --lines 3 --nostream --err 2>&1 | grep -v '^$' | tail -8
