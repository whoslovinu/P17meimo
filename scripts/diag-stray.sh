#!/bin/bash
echo '=== root-level stray files ==='
ls -la /var/www/app/BattleLayout.tsx /var/www/app/LoadingScreen.tsx /var/www/app/SpineViewer.tsx 2>&1
echo '---'
echo '=== root listing of /var/www/app ==='
ls /var/www/app/ | head -30
echo '---'
echo '=== find any BattleLayout.tsx ==='
find /var/www/app -name 'BattleLayout.tsx' -not -path '*/node_modules/*' -not -path '*/.next/*' 2>&1 | head -10
