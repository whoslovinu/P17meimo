#!/bin/bash
PAYLOAD='{"password":"giys-agjj-niqt-yx2g"}'
echo "=== POST /api/admin/login ==="
curl -s -D - -X POST http://localhost:3000/api/admin/login \
  -H 'Content-Type: application/json' \
  -d "$PAYLOAD" 2>&1
echo ""
echo "=== GET /admin (should get 302 if cookie works, 200 if bypass) ==="
curl -s -D - http://localhost:3000/admin \
  -H 'Cookie: admin_token=test' 2>&1 | head -20
