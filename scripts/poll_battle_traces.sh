echo "=== /api/time pre-poll ==="
date -u +%FT%TZ
curl -sS -o /dev/null -w "HTTP %{http_code} in %{time_total}s\n" http://98.93.252.250/api/time

echo
echo "=== poll for 'battleTraceSessionId' or 'battle-trace' in pm2 log (60s, every 5s) ==="
for i in $(seq 1 12); do
  HITS=$(sudo -n pm2 logs repark-h5 --lines 2000 --nostream --raw 2>/dev/null | grep -cE "battle-trace|battleTraceSessionId" 2>/dev/null)
  echo "poll $i (t=$(date -u +%H:%M:%S)): total battle-trace lines = $HITS"
  if [ "$HITS" -gt 0 ]; then
    echo "FOUND — extracting..."
    break
  fi
  sleep 5
done
echo "DONE"
