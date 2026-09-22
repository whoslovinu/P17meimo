#!/bin/bash
echo '=== STATE ==='
curl -s http://127.0.0.1:3000/api/time | head -c 50
echo ''
ss -ltnp 2>/dev/null | grep :3000 || echo 'PORT_FREE'
echo '=== PM2 DELETE ==='
sudo -n pm2 delete repark-h5 || true
echo '=== KILL ORPHAN ==='
sudo fuser -k 3000/tcp || true
sleep 5
echo '=== PORT CHECK ==='
ss -ltnp 2>/dev/null | grep :3000 || echo 'FREE'
echo '=== .NEXT OWNER ==='
stat -c '%U:%G' /var/www/app/.next 2>/dev/null || true
echo '=== PM2 START ==='
sudo -n pm2 start /var/www/app/ecosystem.config.js --env production 2>&1
sleep 25
echo '=== PM2 LIST ==='
sudo -n pm2 list 2>&1 | head -8
echo '=== PM2 PID ==='
sudo -n pm2 pid repark-h5 2>&1 || true
echo '=== PORT 3000 ==='
ss -ltnp 2>/dev/null | grep :3000 || echo 'NONE'
NPID=$(ss -ltnp 2>/dev/null | grep ':3000' | grep -oP 'pid=\K[0-9]+')
echo "NPID=$NPID"
PPID=$(ps -o ppid= -p $NPID 2>/dev/null | tr -d ' ' || echo '')
echo "PPID=$PPID"
ps -fp $PPID 2>/dev/null | head -2 || true
PM2PID=$(pm2 pid 2>/dev/null | head -1 || echo '')
echo "PM2D=$PM2PID"
echo "RESULT=$(test \"$PPID\" = \"$PM2PID\" && echo 'ONLINE_UNDER_PM2' || echo 'ORPHAN_PARENT='$PPID)"
echo '=== HEALTH ==='
curl -s -o /dev/null -w 'time: %{http_code}\n' http://127.0.0.1:3000/api/time || echo 'FAILED'
curl -s -o /dev/null -w 'lb: %{http_code}\n' http://127.0.0.1:3000/api/battle/leaderboard || echo 'FAILED'
echo 'BUILD_ID:'
cat /var/www/app/.next/BUILD_ID 2>/dev/null || true
echo '=== PM2 SAVE ==='
sudo -n pm2 save 2>&1 && echo 'SAVED' || echo 'SAVE_FAIL'
echo '=== STARTUP ==='
ls /etc/systemd/system/pm2*.service 2>/dev/null && echo 'SYSTEMD=YES' || echo 'SYSTEMD=NO'
crontab -l 2>/dev/null | grep pm2 && echo 'CRON=YES' || echo 'CRON=NO'
echo '=== DONE ==='
