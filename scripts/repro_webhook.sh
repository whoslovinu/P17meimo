#!/bin/bash
# scripts/repro_webhook.sh — generate exact sig + curl on prod
BODY='{"user_id":"test_user_002","action_type":"consume","amount":50,"tx_id":"tx_repro_002_long_id_xyz","timestamp":1753200001000,"sign":"0000000000000000000000000000000000000000000000000000000000000000"}'
SECRET="${WEBHOOK_SECRET:-your-webhook-secret-placeholder}"
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
echo "BODY=$BODY"
echo "SIG=sha256=$SIG"
echo "---"
curl -sv -X POST 'http://98.93.252.250/api/webhook/user-action' \
  -H 'Content-Type: application/json' \
  -H "X-Webhook-Signature: sha256=$SIG" \
  --data "$BODY" 2>&1 | tail -20