#!/bin/bash
UID_COOKIE="uid=c5136bf3-e5c7-42eb-84ec-8b99e4a94f04"
BASE="http://127.0.0.1"

echo "=== A. Reset claim rows ==="
node -e "
const {Client}=require('/var/www/app/node_modules/pg');
(async()=>{
  const c=new Client({host:'rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com',user:'postgres',password:'PhbcRcx5Wt',database:'postgres',ssl:{rejectUnauthorized:false}});
  await c.connect();
  const r=await c.query('DELETE FROM user_milestone_claims WHERE milestone_id IN (\\'1001\\',\\'1002\\')');
  console.log('deleted', r.rowCount);
  await c.end();
})().catch(e=>{console.error(e.message);process.exit(1)});
" 2>&1 | tail -3

echo ""
echo "=== B.1 Claim with milestone_id as 'm1001' (string) ==="
printf '%s' '{"milestone_id":"m1001"}' > /tmp/body.json
START=$(date +%s%N)
curl -s -X POST -H "Content-Type: application/json" -H "Cookie: $UID_COOKIE" --data-binary @/tmp/body.json "$BASE/api/game/milestone/claim"
END=$(date +%s%N)
echo ""
echo "elapsed_ms=$(( (END - START) / 1000000 ))"

echo ""
echo "=== B.2 Claim with milestoneId (camelCase) as 1002 (number) ==="
# First reset m1002
node -e "
const {Client}=require('/var/www/app/node_modules/pg');
(async()=>{
  const c=new Client({host:'rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com',user:'postgres',password:'PhbcRcx5Wt',database:'postgres',ssl:{rejectUnauthorized:false}});
  await c.connect();
  await c.query('DELETE FROM user_milestone_claims WHERE milestone_id = \\'1002\\'');
  await c.end();
})();
" 2>&1 | tail -2
printf '%s' '{"milestoneId":1002}' > /tmp/body.json
START=$(date +%s%N)
curl -s -X POST -H "Content-Type: application/json" -H "Cookie: $UID_COOKIE" --data-binary @/tmp/body.json "$BASE/api/game/milestone/claim"
END=$(date +%s%N)
echo ""
echo "elapsed_ms=$(( (END - START) / 1000000 ))"

echo ""
echo "=== B.3 Claim with { id: 'm1001' } ==="
node -e "
const {Client}=require('/var/www/app/node_modules/pg');
(async()=>{
  const c=new Client({host:'rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com',user:'postgres',password:'PhbcRcx5Wt',database:'postgres',ssl:{rejectUnauthorized:false}});
  await c.connect();
  await c.query('DELETE FROM user_milestone_claims WHERE milestone_id = \\'1001\\'');
  await c.end();
})();
" 2>&1 | tail -2
printf '%s' '{"id":"m1001"}' > /tmp/body.json
START=$(date +%s%N)
curl -s -X POST -H "Content-Type: application/json" -H "Cookie: $UID_COOKIE" --data-binary @/tmp/body.json "$BASE/api/game/milestone/claim"
END=$(date +%s%N)
echo ""
echo "elapsed_ms=$(( (END - START) / 1000000 ))"

echo ""
echo "=== B.4 Claim with malformed JSON (should be tolerant) ==="
START=$(date +%s%N)
curl -s -X POST -H "Content-Type: application/json" -H "Cookie: $UID_COOKIE" --data-binary 'not json' "$BASE/api/game/milestone/claim"
END=$(date +%s%N)
echo ""
echo "elapsed_ms=$(( (END - START) / 1000000 ))"

echo ""
echo "=== B.5 Claim with empty body (should be 400 - missing milestone_id) ==="
START=$(date +%s%N)
curl -s -X POST -H "Content-Type: application/json" -H "Cookie: $UID_COOKIE" --data-binary '{}' "$BASE/api/game/milestone/claim"
END=$(date +%s%N)
echo ""
echo "elapsed_ms=$(( (END - START) / 1000000 ))"

echo ""
echo "=== B.6 Idempotent re-claim ==="
printf '%s' '{"milestone_id":"m1001"}' > /tmp/body.json
curl -s -X POST -H "Content-Type: application/json" -H "Cookie: $UID_COOKIE" --data-binary @/tmp/body.json "$BASE/api/game/milestone/claim"
echo ""