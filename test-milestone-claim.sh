#!/bin/bash
# Test Milestone Claim Fix
# Tests the /api/game/milestone/claim endpoint with real user data

SERVER="http://98.93.252.250:3000"
USER_ID="a3b84142-7bfd-53d9-9880-bb744115a507"

echo "=== Testing Milestone Claim Fix ==="
echo ""

# Step 1: Get current game state
echo "[1] Fetching current game state..."
INIT_RESPONSE=$(curl -s "${SERVER}/api/game/init" \
  -H "Cookie: userId=${USER_ID}")

echo "Init Response:"
echo "$INIT_RESPONSE" | jq '.'
echo ""

# Extract server total damage and milestones
SERVER_DAMAGE=$(echo "$INIT_RESPONSE" | jq -r '.serverTotalDamage // .server_total_damage')
MILESTONES=$(echo "$INIT_RESPONSE" | jq -c '.milestones')

echo "Server Total Damage: $SERVER_DAMAGE"
echo "Milestones: $MILESTONES"
echo ""

# Step 2: Try to claim milestone m1001 (threshold 10)
echo "[2] Attempting to claim milestone m1001 (threshold: 10)..."
CLAIM_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" "${SERVER}/api/game/milestone/claim" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Cookie: userId=${USER_ID}" \
  -d '{"milestone_id":"m1001"}')

HTTP_CODE=$(echo "$CLAIM_RESPONSE" | grep "HTTP_CODE:" | cut -d':' -f2)
BODY=$(echo "$CLAIM_RESPONSE" | sed '/HTTP_CODE:/d')

echo "HTTP Status: $HTTP_CODE"
echo "Response Body:"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

# Step 3: Try to claim milestone m1002 (threshold 20)
echo "[3] Attempting to claim milestone m1002 (threshold: 20)..."
CLAIM_RESPONSE2=$(curl -s -w "\nHTTP_CODE:%{http_code}" "${SERVER}/api/game/milestone/claim" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Cookie: userId=${USER_ID}" \
  -d '{"milestone_id":"m1002"}')

HTTP_CODE2=$(echo "$CLAIM_RESPONSE2" | grep "HTTP_CODE:" | cut -d':' -f2)
BODY2=$(echo "$CLAIM_RESPONSE2" | sed '/HTTP_CODE:/d')

echo "HTTP Status: $HTTP_CODE2"
echo "Response Body:"
echo "$BODY2" | jq '.' 2>/dev/null || echo "$BODY2"
echo ""

# Step 4: Summary
echo "=== Test Summary ==="
if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Milestone m1001 claim: SUCCESS (HTTP 200)"
else
  echo "❌ Milestone m1001 claim: FAILED (HTTP $HTTP_CODE)"
fi

if [ "$HTTP_CODE2" = "200" ]; then
  echo "✅ Milestone m1002 claim: SUCCESS (HTTP 200)"
else
  echo "❌ Milestone m1002 claim: FAILED (HTTP $HTTP_CODE2)"
fi
