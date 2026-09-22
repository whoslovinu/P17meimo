#!/bin/bash
echo '=== tsconfig check ==='
ls -la /var/www/app/tsconfig.json 2>&1
cat /var/www/app/tsconfig.json 2>&1 | head -50
echo '---'
echo '--- next-env.d.ts exists? ---'
ls -la /var/www/app/next-env.d.ts 2>&1
echo '---'
echo '--- include patterns match SpineViewer? ---'
cd /var/www/app && find . -path ./node_modules -prune -o -path ./.next -prune -o -name 'SpineViewer*' -print 2>&1 | head -5
echo '---'
echo '--- local tsc try from server ---'
cd /var/www/app && timeout 30 npx tsc --noEmit --traceResolution 2>&1 | grep -A 2 'SpineViewer' | head -30
