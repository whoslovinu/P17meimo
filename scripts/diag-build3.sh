#!/bin/bash
echo '=== FRESH BUILD ==='
cd /var/www/app
sudo -n rm -rf .next 2>&1 || true
echo "--- starting build ---"
date +%H:%M:%S
sudo -n NODE_ENV=production npx next build 2>&1 | tail -50
echo "--- build done ---"
date +%H:%M:%S
