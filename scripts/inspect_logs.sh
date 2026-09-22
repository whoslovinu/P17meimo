echo "=== last 1000 pm2 lines, looking for /battle requests or any /api/diag activity ==="
sudo -n pm2 logs repark-h5 --lines 1000 --nostream --raw 2>/dev/null > /tmp/recent.log
echo "lines total: $(wc -l < /tmp/recent.log)"
echo
echo "--- /battle activity (last 24h if available) ---"
grep -c "/battle" /tmp/recent.log
echo
echo "--- /api/diag activity (last 1000) ---"
grep -c "/api/diag" /tmp/recent.log
echo
echo "--- /api/diag/client-log calls (last 1000) ---"
grep "/api/diag/client-log" /tmp/recent.log | head -10
echo
echo "--- DIAG events received (last 1000) ---"
grep -c "DIAG" /tmp/recent.log
echo
echo "--- last 5 DIAG lines ---"
grep "DIAG" /tmp/recent.log | tail -5
echo
echo "--- last 30 lines overall ---"
tail -30 /tmp/recent.log
echo "DONE"
