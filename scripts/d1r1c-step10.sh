#!/bin/bash
# scripts/d1r1c-step10.sh — Log review
echo "═════════════════════════════════════════════════════════════"
echo "[STEP 10] Log review"
echo "═════════════════════════════════════════════════════════════"

# Get the last 100 lines of PM2 logs
echo ""
echo "[STEP 10a] Recent PM2 output (last 100 lines)"
echo "─────────────────────────────────────────────────────────────"
sudo -n tail -n 100 /home/ubuntu/.pm2/logs/repark-h5-out.log 2>/dev/null || \
  sudo -n tail -n 100 /var/log/repark-h5-out.log 2>/dev/null || \
  echo "(log not found at default paths)"

echo ""
echo ""
echo "[STEP 10b] Errors related to D1-R1 path"
echo "─────────────────────────────────────────────────────────────"
sudo -n bash -c "grep -E 'ROLLBACK|persistence FAILED|optimistic lock|transaction failed' /home/ubuntu/.pm2/logs/repark-h5-out.log 2>/dev/null /home/ubuntu/.pm2/logs/repark-h5-error.log 2>/dev/null | tail -30" || echo "  (no log files or no matches)"

echo ""
echo ""
echo "[STEP 10c] Recent attack logs (with our nonce pattern)"
echo "─────────────────────────────────────────────────────────────"
sudo -n bash -c "grep -E 'd1r1c-|aaaaaaaa-bbbb' /home/ubuntu/.pm2/logs/repark-h5-out.log 2>/dev/null | tail -30" || echo "  (no matches)"

echo ""
echo ""
echo "[STEP 10d] Unexpected 500s in last 5 minutes"
echo "─────────────────────────────────────────────────────────────"
sudo -n bash -c "grep -E '500|FATAL ERROR' /home/ubuntu/.pm2/logs/repark-h5-out.log 2>/dev/null /home/ubuntu/.pm2/logs/repark-h5-error.log 2>/dev/null | tail -30" || echo "  (no matches)"

echo ""
echo ""
echo "═════════════════════════════════════════════════════════════"
echo "[STEP 10 COMPLETE]"
echo "═════════════════════════════════════════════════════════════"
