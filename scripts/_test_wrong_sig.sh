#!/usr/bin/env bash
echo "=== Test with WRONG signature (should 401 with debug log) ==="
BODY='{"action_type":"consume","amount":40,"sign":"0000000000000000000000000000000000000000000000000000000000000000","timestamp":1785327042150,"tx_id":"CONSUME_OTHER","user_id":"128"}'
WRONG_SIG='deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
HTTP_CODE=$(curl -s -o /tmp/wb_wrong.json -w "%{http_code}" -X POST http://localhost:3000/api/webhook/user-action \
  -H "Content-Type: application/json" -H "X-Webhook-Signature: $WRONG_SIG" --data "$BODY")
echo "HTTP $HTTP_CODE"
echo "Body: $(cat /tmp/wb_wrong.json)"
echo
echo "=== Check PM2 error log for the mismatch diagnostic ==="
sleep 1
pm2 logs repark-h5 --nostream --lines 3 --err 2>&1 | grep -E "HMAC mismatch" | tail -3