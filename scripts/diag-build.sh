#!/bin/bash
echo '=== DIAG: Why SpineViewer import failed ==='
echo '--- pwd ---'
cd /var/www/app && pwd
echo '--- which tsc / which next ---'
which tsc 2>&1 || true
which next 2>&1 || true
echo '--- ls /var/www/app/app/components/features/battle/SpineViewer.tsx ---'
ls -la /var/www/app/app/components/features/battle/SpineViewer.tsx 2>&1
echo '--- readlink ---'
readlink -f /var/www/app/app/components/features/battle/SpineViewer.tsx
echo '--- file types ---'
file /var/www/app/app/components/features/battle/SpineViewer.tsx 2>&1
echo '--- BattleLayout import line ---'
sed -n '1,12p' /var/www/app/app/components/features/battle/BattleLayout.tsx
echo '--- file first chars (head -1) ---'
head -c 100 /var/www/app/app/components/features/battle/SpineViewer.tsx | od -c | head -2
echo '--- node version ---'
node --version
echo '--- npx next version ---'
cd /var/www/app && npx next --version 2>&1 | head -2
