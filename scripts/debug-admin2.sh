#!/usr/bin/env bash
echo "=== Test /api/admin/validate with 'secret' field ==="
curl -s -X POST http://localhost:3000/api/admin/validate \
  -H "Content-Type: application/json" \
  -H "Origin: http://98.93.252.250:3000" \
  -d '{"secret":"a757119f3e833705b86d8268d377bb0c2f63e0326a3ce6364a2baf6586092865"}' \
  -w "\nHTTP %{http_code}\n"

echo ""
echo "=== Test /api/admin/login with correct password ==="
# Login: compares SHA256(input) with ADMIN_SECRET_KEY
# So input password = 'giys-agjj-niqt-yx2g'
curl -s -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -H "Origin: http://98.93.252.250:3000" \
  -d '{"password":"giys-agjj-niqt-yx2g"}' \
  -w "\nHTTP %{http_code}\n"

echo ""
echo "=== Test /api/admin/validate with the password (not hash) ==="
# Validate endpoint takes the *secret* (already hash) directly
# Login endpoint takes the *plain password* (then hashes server-side)
# So /api/admin/validate should be passed the SHA256 hash
curl -s -X POST http://localhost:3000/api/admin/validate \
  -H "Content-Type: application/json" \
  -H "Origin: http://98.93.252.250:3000" \
  -d '{"secret":"giys-agjj-niqt-yx2g"}' \
  -w "\nHTTP %{http_code}\n"