#!/bin/bash
set -e
BASE="http://localhost:3000"
echo '{"password":"giys-agjj-niqt-yx2g"}' > /tmp/login-body.json
cat /tmp/login-body.json
echo
echo "=== Login ==="
curl -s -i -c /tmp/adm3 -X POST $BASE/api/admin/login \
  -H "Content-Type: application/json" \
  -H "Origin: $BASE" \
  --data @/tmp/login-body.json | head -10
echo
echo "=== Cookie file ==="
cat /tmp/adm3