#!/usr/bin/env bash
# Simulate the test team's webhook POST to confirm HMAC verification now works
BODY='{"action_type":"consume","amount":40,"sign":"0000000000000000000000000000000000000000000000000000000000000000","timestamp":1785327042150,"tx_id":"CONSUME_8618","user_id":"128"}'
SIG='fb1b622408b2e72b76a3ab10c80810e655464a620e813d52fb05f4e1686d8362'

echo "=== Test team webhook replay ==="
echo "Body: $BODY"
echo "Body size: $(echo -n "$BODY" | wc -c) bytes"
echo "Signature: $SIG"
echo

echo "=== Response ==="
curl -i -X POST http://localhost:3000/api/webhook/user-action \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: $SIG" \
  --data "$BODY" 2>&1 | head -20