#!/bin/bash
# Full cookie round-trip test

# Step 1: Login → get Set-Cookie
echo "=== Step 1: POST /api/admin/login ==="
RESPONSE=$(curl -s -D /tmp/cookies.txt -X POST http://localhost:3000/api/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"giys-agjj-niqt-yx2g"}')
echo "$RESPONSE"

# Extract cookie from response headers
COOKIE_LINE=$(grep -i "set-cookie:" /tmp/cookies.txt | head -1)
echo ""
echo "Set-Cookie received:"
echo "$COOKIE_LINE"

# Step 2: Use the cookie to GET /admin
echo ""
echo "=== Step 2: GET /admin (with cookie) ==="
curl -s -D - http://localhost:3000/admin \
  -b /tmp/cookies.txt 2>&1 | head -15
