#!/bin/bash
set -e
echo "===NEXT_BUILD==="
cd /var/www/app
echo "--- node + next versions ---"
node --version
npx next --version 2>&1 | head -1
echo ""
echo "--- starting build ---"
date +%s
NODE_ENV=production npx next build 2>&1 | tail -40
echo ""
echo "--- build finished ---"
date +%s