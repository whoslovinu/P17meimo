#!/bin/bash
set -e
echo '--- CURRENT STATE ---'
curl -s -o /dev/null -w '/api/time: %{http_code}\n' http://127.0.0.1:3000/api/time || true
ss -ltnp 2>/dev/null | grep :3000 || echo 'PORT_FREE'
echo ''

echo '--- STEP 1: DELETE STALE PM2 FIRST (stops autorestart) ---'
sudo -n pm2 delete repark-h5 2>/dev/null && echo 'DELETED' || echo 'ALREADY_GONE'
sleep 1

echo '--- STEP 2: KILL ORPHAN via fuser ---'
sudo fuser -k 3000/tcp 2>/dev/null && echo 'KILL_SENT' || true
sleep 4

echo '--- VERIFY PORT FREE ---'
ss -ltnp 2>/dev/null | grep :3000 || echo 'PORT_FREE_NOW'
if ss -ltnp 2>/dev/null | grep -q ':3000'; then
  NPID=$(ss -ltnp 2>/dev/null | grep ':3000' | grep -oP 'pid=\K[0-9]+')
  echo "FATAL: port still held by $NPID, force killing"
  sudo fuser -k -9 3000/tcp 2>/dev/null || true
  sleep 3
  ss -ltnp 2>/dev/null | grep :3000 || echo 'PORT_FREE_AFTER_FORCE'
fi

echo '--- .next owner ---'
stat -c '%U:%G' /var/www/app/.next 2>&1 || true

echo '--- START PM2 ---'
sudo -n pm2 start /var/www/app/ecosystem.config.js --env production 2>&1

echo '--- WAIT 20s ---'
sleep 20

echo '--- PM2 STATUS ---'
sudo -n pm2 list 2>&1 | head -8
NPID2=$(sudo -n pm2 pid repark-h5 2>/dev/null | head -1)
echo "tracked_pid=$NPID2"
echo ''

echo '--- PORT 3000 ---'
ss -ltnp 2>/dev/null | grep :3000 || echo 'NO_LISTENER'
echo ''

echo '--- PARENT CHAIN ---'
NPID3=$(ss -ltnp 2>/dev/null | grep ':3000' | grep -oP 'pid=\K[0-9]+')
echo "actual_pid=$NPID3"
if [ -n "$NPID3" ]; then
  PPID=$(ps -o ppid= -p $NPID3 2>/dev/null | tr -d ' ')
  echo "parent_pid=$PPID"
  ps -fp $PPID 2>/dev/null | head -2 || true
  PM2PID=$(pm2 pid 2>/dev/null | head -1)
  echo "pm2_daemon=$PM2PID"
  if [ "$PPID" = "$PM2PID" ]; then
    echo 'RESULT=ONLINE_UNDER_PM2'
  else
    echo "RESULT=ORPHAN (parent=$PPID, expected=$PM2PID)"
  fi
fi
echo ''

echo '--- HEALTH CHECKS ---'
curl -s -o /dev/null -w '/api/time: %{http_code}\n' http://127.0.0.1:3000/api/time || echo '/api/time: FAILED'
curl -s -o /dev/null -w '/api/battle/leaderboard: %{http_code}\n' http://127.0.0.1:3000/api/battle/leaderboard || echo 'FAILED'
echo 'BUILD_ID:'
cat /var/www/app/.next/BUILD_ID
echo ''

echo '--- PM2 SAVE ---'
sudo -n pm2 save 2>&1 && echo 'SAVED' || echo 'SAVE_FAIL'
echo ''

echo '--- STARTUP CHECK ---'
ls /etc/systemd/system/pm2*.service 2>/dev/null && echo 'SYSTEMD=YES' || echo 'SYSTEMD=NO'
crontab -l 2>/dev/null | grep pm2 && echo 'CRON=YES' || echo 'CRON=NO'
echo ''
echo '=== DONE ==='
