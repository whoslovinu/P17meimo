echo "=== pm2 log files ==="
sudo -n ls -la /root/.pm2/logs/ 2>&1 | head -20
echo
echo "=== out log file size + first/last lines ==="
OUT=/root/.pm2/logs/repark-h5-out-0.log
sudo -n wc -l "$OUT"
echo "--- head ---"
sudo -n head -3 "$OUT"
echo "--- last 5 ---"
sudo -n tail -5 "$OUT"
echo
echo "=== check for /api/diag in entire log ==="
sudo -n grep -c "/api/diag" "$OUT" || echo "no match"
echo
echo "=== check for battle-trace ==="
sudo -n grep -c "battle-trace" "$OUT" || echo "no match"
echo
echo "=== check for /battle route hits ==="
sudo -n grep -c "GET /battle" "$OUT" || echo "no match"
echo
echo "=== full pm2 log size on disk ==="
sudo -n du -h "$OUT" 2>&1
echo "DONE"
