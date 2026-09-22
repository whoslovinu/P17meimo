#!/usr/bin/env bash
echo "=== /api/time ==="
curl -sf --max-time 5 http://localhost:3000/api/time
echo
echo "=== /api/boss/status ==="
curl -sf --max-time 5 http://localhost:3000/api/boss/status
echo
echo "=== /api/banner ==="
curl -sf --max-time 5 http://localhost:3000/api/banner
echo
echo "=== / (homepage) ==="
curl -sf -o /dev/null -w 'HTTP %{http_code}, %{size_download} bytes\n' --max-time 8 http://localhost:3000/
echo
echo "=== /battle (expect redirect to login) ==="
curl -s -o /dev/null -w 'HTTP %{http_code}, redirect to %{redirect_url}\n' --max-time 8 http://localhost:3000/battle