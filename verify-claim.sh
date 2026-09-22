#!/bin/bash
UID_COOKIE="uid=c5136bf3-e5c7-42eb-84ec-8b99e4a94f04"
BASE="http://127.0.0.1"

echo "=== Step 1: Reset claim DB rows so we can re-test ==="
PGPASSWORD=PhbcRcx5Wt psql -h rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com -U postgres -d postgres -c "DELETE FROM user_milestone_claims WHERE milestone_id IN ('1001','1002');" 2>&1 | tail -3

echo ""
echo "=== Step 2: Claim m1001 (fire-and-forget mode) ==="
printf '%s' '{"milestone_id":"m1001"}' > /tmp/body.json
START=$(date +%s%N)
curl -s -X POST -H "Content-Type: application/json" -H "Cookie: $UID_COOKIE" --data-binary @/tmp/body.json "$BASE/api/game/milestone/claim"
END=$(date +%s%N)
echo ""
echo "elapsed_ms=$(( (END - START) / 1000000 ))"

echo ""
echo "=== Step 3: Claim m1002 ==="
printf '%s' '{"milestone_id":"m1002"}' > /tmp/body.json
START=$(date +%s%N)
curl -s -X POST -H "Content-Type: application/json" -H "Cookie: $UID_COOKIE" --data-binary @/tmp/body.json "$BASE/api/game/milestone/claim"
END=$(date +%s%N)
echo ""
echo "elapsed_ms=$(( (END - START) / 1000000 ))"

echo ""
echo "=== Step 4: Idempotent re-claim (should return ALREADY_CLAIMED) ==="
printf '%s' '{"milestone_id":"m1001"}' > /tmp/body.json
curl -s -X POST -H "Content-Type: application/json" -H "Cookie: $UID_COOKIE" --data-binary @/tmp/body.json "$BASE/api/game/milestone/claim"
echo ""

echo ""
echo "=== Step 5: Verify DB rows persisted ==="
PGPASSWORD=PhbcRcx5Wt psql -h rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com -U postgres -d postgres -c "SELECT user_id, milestone_id, is_claimed, claimed_at, reward_type, reward_value FROM user_milestone_claims WHERE user_id='c5136bf3-e5c7-42eb-84ec-8b99e4a94f04';" 2>&1

echo ""
echo "=== Step 6: PM2 logs last 20 lines (look for webhook background log) ==="
pm2 logs repark-h5 --lines 20 --nostream 2>&1 | tail -30