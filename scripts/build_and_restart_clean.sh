cd /var/www/app
rm -rf .next
echo "=== build start ==="
/var/www/app/node_modules/.bin/next build --no-lint 2>&1 | tail -10
echo
echo "=== BUILD_ID ==="
cat .next/BUILD_ID
echo
echo "=== verify canary is REMOVED from bundle ==="
grep -c "TRACE NO-LOSS CANARY" .next/static/chunks/*.js 2>&1 | grep -v ':0$' | head -5
grep -rl "TRACE NO-LOSS CANARY" .next 2>&1 | head -5
echo "(empty above = canary removed)"
echo
echo "=== verify traceSessionId is in bundle ==="
grep -l "traceSessionId" .next/static/chunks/*.js | head -5
echo
echo "=== verify afterrender listener pattern in bundle (look for the .on('afterrender' signature) ==="
COUNT=$(grep -cE "afterrender" .next/static/chunks/*.js 2>/dev/null | grep -v ':0$' | head -10)
echo "$COUNT"
echo
echo "=== restart PM2 ==="
sudo -n pm2 restart repark-h5
sleep 8
echo "=== status ==="
sudo -n pm2 status | head -8
echo "=== /api/time ==="
curl -sS -o /dev/null -w "HTTP %{http_code} in %{time_total}s\n" http://98.93.252.250/api/time
echo "DONE"