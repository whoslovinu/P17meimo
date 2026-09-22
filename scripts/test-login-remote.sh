#!/bin/bash
PAYLOAD='{"password":"giys-agjj-niqt-yx2g"}'
RESULT=$(curl -s -X POST http://localhost:3000/api/admin/login \
  -H 'Content-Type: application/json' \
  -d "$PAYLOAD")
echo "Login result: $RESULT"
