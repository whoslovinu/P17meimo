#!/bin/bash
set -u
cd /var/www/source-convergence
CHUNK=.next/static/chunks/app/admin/users/page-66d5134812f23933.js
echo "== chunk path = $CHUNK =="
ls -la "$CHUNK"
echo "== BANNER PHRASE 1 occurrences in admin/users chunk (must be 0) =="
grep -c "将直接影响用户可攻击次数" "$CHUNK" || true
echo "== BANNER PHRASE 2 occurrences in admin/users chunk (must be 0) =="
grep -c "修改道具数量将直接影响" "$CHUNK" || true
echo "== ReasonModal present? (must be >=1) =="
grep -c "ReasonModal" "$CHUNK" || true
echo "== ReasonModal-area instruction copy still present =="
grep -o "变更记录操作日志" "$CHUNK" | wc -l
echo "== inventory/adjust route intact =="
ls -la .next/server/app/api/admin/users/\[uid\]/inventory/adjust/route.js
grep -c "audit_log\|admin_audit_log\|onInventorySave\|inventory_adjust" .next/server/app/api/admin/users/\[uid\]/inventory/adjust/route.js || true
echo "== two prop cards still compile =="
grep -c "闪电符文\|潮汐晶石\|PropCard\|propCard" "$CHUNK" || true
echo "== chunk hash for the audit record =="
sha256sum "$CHUNK"
