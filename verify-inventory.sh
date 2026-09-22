#!/bin/bash
BASE="http://127.0.0.1"
UID="c5136bf3-e5c7-42eb-84ec-8b99e4a94f04"

echo "=== Step 1: Admin login ==="
LOGIN=$(curl -s -X POST -H "Content-Type: application/json" -d '{"username":"admin","password":"PhbcRcx5Wt"}' "$BASE/api/admin/login")
echo "$LOGIN"
COOKIE=$(echo "$LOGIN" | grep -oE 'Set-Cookie:[^;]+admin[^;]+' | sed 's/Set-Cookie: //' | head -1)
if [ -z "$COOKIE" ]; then
  COOKIE=$(echo "$LOGIN" | grep -oE '"token":"[^"]+"' | sed 's/"token":"//' | tr -d '"')
fi
echo "COOKIE=$COOKIE"

echo ""
echo "=== Step 2: Adjust inventory for c5136bf3... propA=99 (will create row if missing) ==="
printf '%s' '{"activityId":1,"propType":"prop_a","newCount":99,"reason":"verify-test"}' > /tmp/body.json
START=$(date +%s%N)
RESP=$(curl -s -X POST -H "Content-Type: application/json" -H "Cookie: $COOKIE" --data-binary @/tmp/body.json -w '\nHTTP %{http_code}' "$BASE/api/admin/users/$UID/inventory/adjust")
END=$(date +%s%N)
echo "$RESP"
echo "elapsed_ms=$(( (END - START) / 1000000 ))"

echo ""
echo "=== Step 3: Adjust with propType=prop_b count=5 ==="
printf '%s' '{"activityId":1,"propType":"prop_b","newCount":5,"reason":"verify-test"}' > /tmp/body.json
START=$(date +%s%N)
RESP=$(curl -s -X POST -H "Content-Type: application/json" -H "Cookie: $COOKIE" --data-binary @/tmp/body.json -w '\nHTTP %{http_code}' "$BASE/api/admin/users/$UID/inventory/adjust")
END=$(date +%s%N)
echo "$RESP"
echo "elapsed_ms=$(( (END - START) / 1000000 ))"

echo ""
echo "=== Step 4: Adjust with newCount=0 (boundary) ==="
printf '%s' '{"activityId":1,"propType":"prop_a","newCount":0,"reason":"zero"}' > /tmp/body.json
START=$(date +%s%N)
RESP=$(curl -s -X POST -H "Content-Type: application/json" -H "Cookie: $COOKIE" --data-binary @/tmp/body.json -w '\nHTTP %{http_code}' "$BASE/api/admin/users/$UID/inventory/adjust")
END=$(date +%s%N)
echo "$RESP"
echo "elapsed_ms=$(( (END - START) / 1000000 ))"