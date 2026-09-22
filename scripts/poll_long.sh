echo "=== 3-minute poll for /battle + battle-trace ==="
for i in $(seq 1 36); do
  BTRACE=$(sudo -n grep -c "battle-trace" /root/.pm2/logs/repark-h5-out-0.log 2>/dev/null)
  BATTLE=$(sudo -n grep -c "GET /battle" /root/.pm2/logs/repark-h5-out-0.log 2>/dev/null)
  echo "poll $i (t=$(date -u +%H:%M:%S)): battle-trace=$BTRACE, /battle=$BATTLE"
  if [ "$BTRACE" -gt 0 ]; then
    echo "*** FOUND battle-trace lines ***"
    break
  fi
  sleep 5
done
echo "DONE"
