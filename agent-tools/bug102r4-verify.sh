#!/bin/bash
set -u
cd /var/www/source-convergence

NEW_CHUNK=.next/static/chunks/app/admin/users/page-7cf1447e7936be4c.js
SRV=.next/server/app/admin/users/page.js
echo "== chunk files =="
ls -la "$NEW_CHUNK" "$SRV"

sed "s|page-[a-f0-9]\{16\}.js|page-7cf1447e7936be4c.js|" verify_bundle.py > /tmp/verify_bundle_r4.py
diff verify_bundle.py /tmp/verify_bundle_r4.py | grep '^>'
echo "== gate =="
python3 /tmp/verify_bundle_r4.py
echo RC=$?

echo "== milestone-id table column check =="
echo "client chunk '里程碑<':"
grep -c '<th[^>]*>里程碑' "$NEW_CHUNK"
echo "client chunk '#m<digits>' visible:"
grep -c '#m[0-9]\{6,\}' "$NEW_CHUNK"
echo "server page.js '#m<digits>' visible:"
grep -c '#m[0-9]\{6,\}' "$SRV"

echo "== button visibility texts =="
echo "已结算:"
grep -c '已结算' "$NEW_CHUNK"
echo "手动解锁:"
grep -c '手动解锁' "$NEW_CHUNK"
echo "锁定奖励:"
grep -c '锁定奖励' "$NEW_CHUNK"
echo "确定要解锁奖励:"
grep -c '确定要解锁奖励' "$NEW_CHUNK"
echo "确定要锁定奖励:"
grep -c '确定要锁定奖励' "$NEW_CHUNK"
echo "ENERGY label:"
grep -c 'ENERGY' "$NEW_CHUNK"
echo "MEDAL label:"
grep -c 'MEDAL' "$NEW_CHUNK"
echo "伤害 sub-label:"
grep -c '>伤害<' "$NEW_CHUNK"
echo "banner new phrase:"
grep -c '修改道具数量将直接影响用户可攻击次数，请谨慎操作' "$NEW_CHUNK"
echo "old banner phrase (must be 0):"
grep -c '修改道具数量将直接影响用户可攻击次数，所有变更记录操作日志' "$NEW_CHUNK"
