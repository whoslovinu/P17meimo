echo "=== Verify fake session lines ==="
sudo -n grep "battle-trace" /root/.pm2/logs/repark-h5-out-0.log | tail -20 | wc -l
echo
echo "=== Verify session ID with fake in it ==="
sudo -n grep "battle-trace-fake" /root/.pm2/logs/repark-h5-out-0.log | wc -l
echo
echo "=== Show last battle-trace-fake session ==="
sudo -n grep "battle-trace-fake" /root/.pm2/logs/repark-h5-out-0.log | tail -17
echo "DONE"
