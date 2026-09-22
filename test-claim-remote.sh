#!/bin/bash
set -e
UID_COOKIE="uid=c5136bf3-e5c7-42eb-84ec-8b99e4a94f04"
BASE="http://127.0.0.1"

echo "=== Step 1: Fetch current init state ==="
INIT_JSON=$(curl -s -H "Cookie: $UID_COOKIE" "$BASE/api/game/init")
echo "$INIT_JSON" | head -c 600
echo ""
echo ""

echo "=== Step 2: Inspect milestones from init ==="
echo "$INIT_JSON" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); ms=d.get('data',{}).get('milestones',[]); print('milestones count:', len(ms)); [print('  -', m.get('id'), 'threshold:', m.get('threshold'), 'claimed:', m.get('claimed')) for m in ms]" 2>&1 || echo "(python parse failed, dumping raw)"

echo ""
echo "=== Step 3: Write body file and POST claim m1001 ==="
printf '%s' '{"milestone_id":"m1001"}' > /tmp/body.json
echo "body file content:"
cat /tmp/body.json
echo ""
echo "POSTing..."
curl -s -X POST -H "Content-Type: application/json" -H "Cookie: $UID_COOKIE" --data-binary @/tmp/body.json "$BASE/api/game/milestone/claim"
echo ""

echo ""
echo "=== Step 4: POST claim m1002 ==="
printf '%s' '{"milestone_id":"m1002"}' > /tmp/body.json
curl -s -X POST -H "Content-Type: application/json" -H "Cookie: $UID_COOKIE" --data-binary @/tmp/body.json "$BASE/api/game/milestone/claim"
echo ""

echo ""
echo "=== Step 5: Inspect server logs from claim route ==="
# Try to find where next.js logs go
for p in /var/log/next.log /var/log/repark-h5.log /tmp/next.log /var/www/app/server.log /var/log/pm2/repark-h5-out.log /var/log/pm2/repark-h5-error.log; do
  if [ -f "$p" ]; then
    echo "FOUND: $p"
    tail -n 20 "$p"
    echo "---"
  fi
done
