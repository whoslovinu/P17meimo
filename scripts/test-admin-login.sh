#!/usr/bin/env bash
echo "=== Test admin login ==="
echo "Trying password: giys-agjj-niqt-yx2g"
RESP=$(curl -s -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -H "Origin: http://98.93.252.250:3000" \
  -d '{"password":"giys-agjj-niqt-yx2g"}' \
  -w "\n---HTTP %{http_code}---" 2>&1)
echo "$RESP"

echo ""
echo "=== Test with bad password ==="
RESP2=$(curl -s -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -H "Origin: http://98.93.252.250:3000" \
  -d '{"password":"wrong"}' \
  -w "\n---HTTP %{http_code}---" 2>&1)
echo "$RESP2"

echo ""
echo "=== Test /admin page without cookie ==="
curl -s -o /dev/null -w "HTTP %{http_code}, redirect %{redirect_url}\n" http://localhost:3000/admin