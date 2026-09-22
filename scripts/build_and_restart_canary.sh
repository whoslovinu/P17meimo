cd /var/www/app
rm -rf .next
echo "=== build start ==="
/var/www/app/node_modules/.bin/next build --no-lint 2>&1 | tail -10
echo "=== BUILD_ID ==="
cat .next/BUILD_ID
echo
echo "=== verify shipper markers ==="
grep -l "battle-trace" .next/static/chunks/*.js 2>/dev/null | head -5
echo "=== verify TRACE NO-LOSS CANARY marker ==="
grep -l "TRACE NO-LOSS CANARY" .next/static/chunks/*.js 2>/dev/null | head -5
echo
echo "=== restart PM2 ==="
sudo -n pm2 restart repark-h5
sleep 8
echo "=== status ==="
sudo -n pm2 status | head -8
echo "=== /api/time ==="
curl -sS -o /dev/null -w "HTTP %{http_code} in %{time_total}s\n" http://98.93.252.250/api/time
echo "DONE"