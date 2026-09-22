#!/bin/bash
echo '=== SpineViewer.tsx file integrity ==='
F=/var/www/app/app/components/features/battle/SpineViewer.tsx
echo '--- size ---'
stat -c '%s bytes' "$F"
echo '--- sha256 ---'
sha256sum "$F" 2>&1
echo '--- first line ---'
head -1 "$F"
echo '--- last line ---'
tail -1 "$F"
echo '--- line count ---'
wc -l "$F"
echo '--- file command ---'
file "$F"
echo '--- mime ---'
file --mime-type "$F" 2>&1 || true
echo '--- lsattr (immutable?) ---'
lsattr "$F" 2>&1 || true
echo '--- test reading 10 lines around export ---'
sed -n '1980,1990p' "$F"
