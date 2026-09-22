#!/bin/bash
echo '========== AUDIT CURRENT STATE =========='
echo '---ALL next-server procs---'
ps -ef | grep -E 'next-server|next start' | grep -v grep || echo '(none)'
echo '---ALL PM2 daemons (both users)---'
ps -ef | grep -E 'PM2.*God Daemon' | grep -v grep || echo '(none)'
echo '---PORT 3000 listener---'
sudo ss -tlpn | grep ':3000' || echo '(port 3000 free)'

echo ''
echo '========== NUCLEAR KILL =========='
echo '---kill all PM2 daemons (root + ubuntu)---'
for p in $(ps -ef | grep -E 'PM2.*God Daemon' | grep -v grep | awk '{print $2}'); do
  echo "killing PM2 daemon pid=$p"
  sudo kill -9 $p 2>&1 || true
done
sleep 2
echo '---kill all next-server procs---'
for p in $(ps -ef | grep -E 'next-server|next start' | grep -v grep | awk '{print $2}'); do
  echo "killing next-server pid=$p"
  sudo kill -9 $p 2>&1 || true
done
sleep 3
echo '---PORT AFTER KILL---'
sudo ss -tlpn | grep ':3000' || echo '(port 3000 free)'

echo ''
echo '========== DEPLOY NEW BUILD =========='
cd /var/www/app
echo '---existing .next dir size---'
du -sh .next 2>&1 | head -1
echo '---untarring---'
sudo tar -xzf /tmp/deploy.tar.gz
echo '---new BUILD_ID---'
cat .next/BUILD_ID
echo ''
echo '---new webhook route present---'
ls -la .next/server/app/api/webhook/user-action/route.js 2>&1 | head -2

echo ''
echo '========== START PM2 (clean) =========='
pm2 start node_modules/.bin/next --name repark-h5 -- start
sleep 8
pm2 status
echo ''
echo '---FINAL PORT---'
sudo ss -tlpn | grep ':3000'
echo '---HTTP HEALTH CHECK---'
curl -s -o /dev/null -w 'HTTP %{http_code} time %{time_total}s\n' http://127.0.0.1:3000/api/boss/status
echo '---webhook route health---'
curl -s -o /dev/null -w 'HTTP %{http_code} time %{time_total}s\n' -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:3000/api/webhook/user-action