#!/bin/bash
set -u
cd /var/www/source-convergence

echo "== admin/users chunks =="
ls .next/static/chunks/app/admin/users/
echo
echo "== find new page chunk =="
NEW_CHUNK=$(find .next/static/chunks/app/admin/users -type f -name 'page-*.js' | head -1)
echo "CHUNK=$NEW_CHUNK"
ls -la "$NEW_CHUNK"

echo "== patch verify_gate =="
HASH=$(basename "$NEW_CHUNK" .js | sed 's/page-//')
sed "s|page-[a-f0-9]\{16\}.js|page-$HASH.js|" verify_bundle.py > /tmp/verify_bundle_r3.py
echo "HASH=$HASH"
echo "== diff (chunk line only) =="
diff verify_bundle.py /tmp/verify_bundle_r3.py | grep '^>'
echo "== run gate =="
python3 /tmp/verify_bundle_r3.py
echo RC=$?

echo "== bundle checks =="
grep -c "确定要解锁奖励" "$NEW_CHUNK"
grep -c "确定要锁定奖励" "$NEW_CHUNK"
grep -c "里程碑 #" "$NEW_CHUNK"
grep -c "里程碑 #" .next/server/app/admin/users/page.js
echo "error message fallback present:"
grep -c "操作失败，请稍后重试" "$NEW_CHUNK"
grep -c "网络请求失败" "$NEW_CHUNK"
