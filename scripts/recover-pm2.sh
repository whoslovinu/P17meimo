#!/bin/bash
echo '=== PM2 RECOVERY: kill stray next-server, restart clean ==='
echo '--- current port 3000 ---'
sudo -n ss -ltnp | grep ':3000'
echo '--- kill stray next-server ---'
sudo -n pkill -9 -f 'next-server' 2>&1 || true
sleep 3
echo '--- port 3000 after kill ---'
sudo -n ss -ltnp | grep ':3000' || echo '(free)'
echo '--- PM2 start ---'
sudo -n pm2 start /var/www/app/ecosystem.config.js --only repark-h5 --env production 2>&1
echo '--- wait 8s for boot ---'
sleep 8
echo '--- PM2 status ---'
sudo -n pm2 list 2>&1 | head -10
echo '--- port 3000 now ---'
sudo -n ss -ltnp | grep ':3000'
echo '--- health check ---'
curl -s -o /dev/null -w 'HTTP %{http_code} time=%{time_total}s\n' http://127.0.0.1:3000/api/time
echo '--- /battle redirect ---'
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3000/battle
echo '--- PM2 error logs last 3 ---'
sudo -n pm2 logs repark-h5 --lines 3 --nostream --err 2>&1 | grep -v '^$' | tail -10
