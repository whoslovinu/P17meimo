#!/bin/bash
set -e
BASE="http://localhost:3000"

echo "=== Login first ==="
curl -s -c /tmp/c.cookies -X POST "$BASE/api/admin/login" \
  -H "Content-Type: application/json" \
  -H "Origin: $BASE" \
  -d '{"password":"giys-agjj-niqt-yx2g"}' > /dev/null

echo "=== Repro: HTTP-style request (no Origin header, Host: 98.93.252.250) ==="
RESP=$(curl -s -i -b /tmp/c.cookies -X POST "$BASE/api/admin/change-password" \
  -H "Content-Type: application/json" \
  -H "Host: 98.93.252.250:3000" \
  -d '{"oldPassword":"giys-agjj-niqt-yx2g","newPassword":"NewSecret#2026","confirmPassword":"NewSecret#2026"}')
echo "$RESP" | head -25

echo
echo "=== Repro: Origin header = http://98.93.252.250 (no port) ==="
RESP2=$(curl -s -i -b /tmp/c.cookies -X POST "$BASE/api/admin/change-password" \
  -H "Content-Type: application/json" \
  -H "Origin: http://98.93.252.250" \
  -d '{"oldPassword":"giys-agjj-niqt-yx2g","newPassword":"NewSecret#2026","confirmPassword":"NewSecret#2026"}')
echo "$RESP2" | head -25

echo
echo "=== Expected (Origin = http://98.93.252.250:3000) ==="
RESP3=$(curl -s -i -b /tmp/c.cookies -X POST "$BASE/api/admin/change-password" \
  -H "Content-Type: application/json" \
  -H "Origin: http://98.93.252.250:3000" \
  -d '{"oldPassword":"giys-agjj-niqt-yx2g","newPassword":"NewSecret#2026","confirmPassword":"NewSecret#2026"}')
echo "$RESP3" | head -25