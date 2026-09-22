#!/bin/bash
# Wait for rate limit window to expire, then verify successful login still works.
echo "=== Wait 65s for rate limit window to expire ==="
sleep 65
echo "=== Verify successful login after window reset ==="
curl -s -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"password":"giys-agjj-niqt-yx2g"}'
echo
echo "=== Done ==="