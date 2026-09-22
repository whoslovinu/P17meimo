#!/bin/bash
set -e
echo '========== STEP 1: DIAGNOSTIC =========='
echo ''
echo '--- ss port 3000 ---'
ss -ltnp | grep :3000 || echo 'NO_LISTENER'
echo ''
echo '--- ps -fp 896097 ---'
ps -fp 896097 2>&1 || echo 'PROCESS_DEAD'
echo ''
echo '--- parent of 896097 ---'
PARENT_PID=$(ps -o ppid= -p 896097 2>/dev/null | tr -d ' ')
echo "parent_pid=$PARENT_PID"
ps -fp "$PARENT_PID" 2>&1 || echo 'PARENT_DEAD'
echo ''
echo '--- pm2 status ---'
sudo -n pm2 list 2>&1 | head -15
echo ''
echo '--- pm2 pid repark-h5 ---'
sudo -n pm2 pid repark-h5 2>&1 || echo 'NO_PID'
echo ''
echo '--- pm2 daemon pid ---'
pm2 pid 2>&1 || echo 'NO_DAEMON'
PM2PID=$(pm2 pid 2>/dev/null | head -1)
echo "pm2_daemon_pid=$PM2PID"
echo ''
echo '--- is parent of 896097 equal to pm2 daemon? ---'
if [ -n "$PARENT_PID" ] && [ -n "$PM2PID" ]; then
  if [ "$PARENT_PID" = "$PM2PID" ]; then
    echo "RESULT=CASE_A (parent is PM2 daemon)"
  else
    echo "RESULT=CASE_B (parent is NOT PM2 daemon, parent=$PARENT_PID, pm2_daemon=$PM2PID)"
  fi
else
  echo "RESULT=UNKNOWN"
fi
echo ''
echo '========== STEP 1 DONE =========='
