echo "=== BEFORE ==="
sudo -n pm2 status | head -8
sudo -n pm2 jlist 2>/dev/null | head -30
echo "=== RESTART ==="
sudo -n pm2 restart repark-h5
echo "=== WAIT 8s ==="
sleep 8
echo "=== AFTER ==="
sudo -n pm2 status | head -8
echo "=== pid ==="
pgrep -af "next-server" | head -3
echo "=== /api/time ==="
curl -sS -o /dev/null -w "HTTP %{http_code} in %{time_total}s\n" http://98.93.252.250/api/time
echo "=== pm2 log tail ==="
sudo -n pm2 logs repark-h5 --lines 30 --nostream --raw 2>&1 | tail -20
echo "DONE"
