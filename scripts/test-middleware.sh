#!/bin/bash
echo "=== 1. POST /api/admin/login ==="
curl -s -D - -X POST http://localhost:3000/api/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"giys-agjj-niqt-yx2g"}' | grep -E "^HTTP|set-cookie|admin_token|ok"

echo ""
echo "=== 2. Full round-trip: login → cookie → GET /admin ==="
RESP=$(curl -s -D /tmp/h.txt -X POST http://localhost:3000/api/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"giys-agjj-niqt-yx2g"}')
echo "Login: $RESP"
CK=$(sed -n 's/.*[Ss]et-[Cc]ookie:[ ]*\([^;]*\).*/\1/p' /tmp/h.txt | head -1)
echo "Cookie sent: $CK"
RESULT=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/admin -H "Cookie: $CK")
echo "GET /admin → HTTP $RESULT"
if [[ "$RESULT" == "200" ]]; then
  echo "✅ Cookie round-trip PASSED — Middleware accepted the token"
else
  echo "❌ Cookie round-trip FAILED — Middleware rejected the token"
fi
