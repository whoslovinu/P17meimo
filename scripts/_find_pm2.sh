#!/usr/bin/env bash
echo "Global pm2 lib path:"
ls -la /usr/lib/node_modules/pm2/lib/index.js 2>/dev/null
ls -la /usr/lib/node_modules/pm2/ 2>/dev/null | head -10
echo
echo "▼ Global node_modules ▼"
ls /usr/lib/node_modules/ 2>/dev/null | head -20