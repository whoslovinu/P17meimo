#!/bin/bash
# REPARK 6.0 — P0 attack diagnostic
# Step 1: Hit the live /api/action/attack endpoint from inside the EC2 box,
# using the same userId Commander QA uses (uid=11111111-...).
# Step 2: Dump the raw response and the PM2 tail so we can SEE the crash.

set -u

# ── 1. Capture a unique nonce so idempotency never blocks us. ──
NONCE="diag-$(date +%s)-$RANDOM"
USER_ID="11111111-1111-1111-1111-111111111111"
ITEM_TYPE="item_hand"

echo "============================================"
echo "[diag-attack] nonce=$NONCE  userId=$USER_ID  item=$ITEM_TYPE"
echo "============================================"

# ── 2. Fire the attack against the same port the production Nginx proxies. ──
# (Using port 3000 directly because nginx may not be configured for the diag.
#  The application is identical either way.)
RESP=$(curl -sS -X POST 'http://127.0.0.1:3000/api/action/attack' \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${USER_ID}" \
  --max-time 15 \
  -w "\nHTTP_STATUS=%{http_code}\nTOTAL_TIME=%{time_total}s\n" \
  --data "{\"item_type\":\"${ITEM_TYPE}\",\"nonce\":\"${NONCE}\"}" 2>&1)

echo
echo "──────────── curl response ────────────"
echo "$RESP"

echo
echo "──────────── pm2 tail (repark-h5 last 50 lines) ────────────"
pm2 logs repark-h5 --lines 50 --nostream --raw 2>&1 | tail -60 || true

echo
echo "──────────── /var/log/repark/*.log (last 80 lines if any) ────────────"
if [ -d /var/log/repark ]; then
  tail -n 80 /var/log/repark/*.log 2>/dev/null || echo "(no log files in /var/log/repark)"
else
  echo "(/var/log/repark not present)"
fi