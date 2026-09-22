#!/bin/bash
set -u
cd /var/www/source-convergence
CHUNK=.next/static/chunks/app/admin/users/page-dde16db337278291.js
SRV=.next/server/app/admin/users/page.js

echo "== chunk file =="
ls -la "$CHUNK" "$SRV"
echo
echo "== NEW banner phrase present in client chunk =="
grep -c "修改道具数量将直接影响用户可攻击次数，请谨慎操作" "$CHUNK"
echo "== NEW banner phrase in server page.js =="
grep -c "修改道具数量将直接影响用户可攻击次数，请谨慎操作" "$SRV"
echo "== OLD banner phrase (forbidden) in client chunk =="
grep -c "修改道具数量将直接影响用户可攻击次数，所有变更记录操作日志" "$CHUNK"
echo "== OLD banner phrase (forbidden) in server page.js =="
grep -c "修改道具数量将直接影响用户可攻击次数，所有变更记录操作日志" "$SRV"
echo "== ReasonModal phrase still present (>=1) =="
grep -c "此操作将修改用户数据，所有变更记录操作日志" "$CHUNK"
echo "== ReasonModal phrase in server page.js =="
grep -c "此操作将修改用户数据，所有变更记录操作日志" "$SRV"
echo
echo "== milestone '#m<digits>' visible in client chunk =="
grep -o '#m[0-9]\{6,\}' "$CHUNK" | sort -u | head -5
grep -c '#m[0-9]\{6,\}' "$CHUNK"
echo "== milestone '#m<digits>' visible in server page.js =="
grep -o '#m[0-9]\{6,\}' "$SRV" | sort -u | head -5
grep -c '#m[0-9]\{6,\}' "$SRV"
echo "== '#{' hash marker (in case compiled) =="
grep -c '"#"' "$CHUNK"
echo "== header row visible strings: 伤害阈值/奖励/状态/操作 =="
for kw in "伤害阈值" "奖励" "状态" "操作"; do
  c=$(grep -c "$kw" "$CHUNK")
  echo "$kw = $c"
done
echo "== header '里程碑' must be 0 =="
grep -c '"里程碑"\|>里程碑<' "$CHUNK"
