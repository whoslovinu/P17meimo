#!/bin/bash
echo '---KILL EVERYTHING NUCLEAR---'
pm2 kill 2>&1 || true
sleep 2
for p in $(ps -ef | grep -E 'next-server|next start' | grep -v grep | awk '{print $2}'); do
  echo "killing $p"
  sudo kill -9 $p 2>&1 || true
done
sleep 3
echo '---PORT---'
sudo ss -tlpn | grep ':3000' || echo 'port 3000 free'

echo '---START FROM CORRECT DIR---'
cd /var/www/app
pm2 start node_modules/.bin/next --name repark-h5 -- start
sleep 6
pm2 status
echo '---FINAL PORT---'
sudo ss -tlpn | grep ':3000'
echo '---HTTP TEST---'
curl -s -o /dev/null -w 'HTTP %{http_code} time %{time_total}s\n' http://127.0.0.1:3000/api/boss/status