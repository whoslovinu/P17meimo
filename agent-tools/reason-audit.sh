#!/bin/bash
set -u
cd /var/www/source-convergence
echo "== ReasonModal across all .next chunks =="
grep -rl "ReasonModal" .next 2>/dev/null | head -5
echo "== context around the kept phrase 变更记录操作日志 =="
grep -o ".\{0,40\}变更记录操作日志.\{0,40\}" .next/static/chunks/app/admin/users/page-66d5134812f23933.js | head -3
echo "== server page.js context =="
grep -o ".\{0,40\}变更记录操作日志.\{0,40\}" .next/server/app/admin/users/page.js | head -3
echo "== reason modal substring matches =="
grep -c "reason\|Reason" .next/server/app/admin/users/page.js
grep -c "原因\|提交" .next/static/chunks/app/admin/users/page-66d5134812f23933.js
echo "== banner alternative: search whole .next for banner text =="
grep -rl "将直接影响用户可攻击次数" .next 2>/dev/null | head -5
echo "== page.js size =="
ls -la .next/server/app/admin/users/page.js .next/server/app/admin/users/page_client-reference-manifest.js
