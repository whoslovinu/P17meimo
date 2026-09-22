#!/usr/bin/env bash
echo "=== Startup endpoint ==="
curl -sf http://localhost:3000/api/internal/startup 2>&1 | head -3
echo
echo "=== Boss status ==="
curl -sf http://localhost:3000/api/boss/status 2>&1 | head -3
echo
echo "=== PM2 status ==="
pm2 list