#!/bin/bash
echo '=== UID84 actual API response ==='
PWHASH=$(echo -n 'giys-agjj-niqt-yx2g' | sha256sum | cut -c1-64)
TOKEN=$(curl -s -X POST http://localhost:3000/api/admin/login -H 'Content-Type: application/json' -d '{"password":"'"$PWHASH"'"}' | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("data",{}).get("token",""))')
echo "token: ${TOKEN:0:20}..."
echo

echo '=== /api/battle/init for UID84 ==='
curl -s 'http://localhost:3000/api/battle/init' -H "Cookie: uid=uid84" 2>&1 | python3 -m json.tool 2>&1 | head -120
