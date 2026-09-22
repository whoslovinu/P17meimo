#!/bin/bash
echo '=== INSPECT BATTLE FOLDER ==='
ls -la /var/www/app/app/components/features/battle/ 2>&1
echo '---'
echo 'SpineViewer.tsx exists?'
ls -la /var/www/app/app/components/features/battle/SpineViewer.tsx 2>&1
echo '---'
echo '--- LoadingScreen.tsx head ---'
head -10 /var/www/app/app/components/features/battle/LoadingScreen.tsx 2>&1
echo '---'
echo '--- BattleLayout.tsx head ---'
head -10 /var/www/app/app/components/features/battle/BattleLayout.tsx 2>&1
