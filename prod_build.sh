cd /var/www/app
npm run build > /tmp/build_full.txt 2>&1
EXIT=$?
echo 'EXIT=' $EXIT
# Route count is in the middle of the output
grep -E '^[├└]' /tmp/build_full.txt | wc -l
grep -E 'Compiled successfully|Type error|error TS' /tmp/build_full.txt