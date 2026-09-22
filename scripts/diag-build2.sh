#!/bin/bash
echo '=== SpineViewer exports ==='
grep -n 'export' /var/www/app/app/components/features/battle/SpineViewer.tsx | head -10
echo '---'
echo '=== SpineViewerRef export ==='
grep -n 'SpineViewerRef' /var/www/app/app/components/features/battle/SpineViewer.tsx | head -10
echo '---'
echo '=== node_modules check ==='
ls -la /var/www/app/node_modules/next/package.json 2>&1 | head -2
echo '---'
echo '=== force a fresh partial build to see real error ==='
cd /var/www/app
sudo -n rm -rf .next 2>&1 || true
sudo -n NODE_ENV=production timeout 60 npx next build 2>&1 | grep -E 'error|Error|Spine|LoadingScreen|module' | head -30
