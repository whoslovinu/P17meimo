#!/bin/bash
set +e
BASE="http://localhost:3000"

echo "=== A. Login with default ENV password (after deploy + reset) ==="
curl -s -X POST $BASE/api/admin/login \
  -H "Content-Type: application/json" \
  -H "Origin: $BASE" \
  -d '{"password":"giys-agjj-niqt-yx2g"}'
echo

echo "=== B. 14 wrong attempts (below threshold of 15) ==="
for i in $(seq 1 14); do
  code=$(curl -s -o /dev/null -w '%{http_code}' \
    -X POST $BASE/api/admin/login \
    -H "Content-Type: application/json" \
    -H "Origin: $BASE" \
    -d '{"password":"wrong"}')
  echo "Attempt $i: HTTP $code"
done

echo
echo "=== C. 15th wrong attempt — last allowed (count becomes 15, NOT blocked) ==="
code=$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST $BASE/api/admin/login \
  -H "Content-Type: application/json" \
  -H "Origin: $BASE" \
  -d '{"password":"wrong"}')
echo "Attempt 15: HTTP $code"

echo
echo "=== D. 16th wrong attempt — should be 429 ==="
curl -s -i -X POST $BASE/api/admin/login \
  -H "Content-Type: application/json" \
  -H "Origin: $BASE" \
  -d '{"password":"wrong"}' | head -4

echo
echo "=== E. Wait 60s for window reset then login successfully ==="
echo "(skipping wait in script; would need to sleep 60+ seconds)"