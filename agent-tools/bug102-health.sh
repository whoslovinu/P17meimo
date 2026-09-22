#!/bin/bash
set -u
echo '== /api/time =='
curl -sS -o /tmp/time.json -w 'HTTP=%{http_code}  TIME=%{time_total}s\n' http://127.0.0.1:3000/api/time
cat /tmp/time.json
echo
echo '== /admin/users unauthenticated (expect 307/302 redirect or 401) =='
curl -sS -o /tmp/admin.html -D /tmp/admin.h -w 'HTTP=%{http_code}\n' http://127.0.0.1:3000/admin/users
echo '--- response headers (first 12) ---'
head -n 12 /tmp/admin.h
echo '== current BUILD_ID =='
cat /var/www/app/.next/BUILD_ID
echo '== repark-h5 jlist =='
sudo -n pm2 jlist | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); p=[x for x in d if x['name']=='repark-h5'][0]; print('pid=%s status=%s uptime=%s restarts=%s' % (p['pid'], p['pm2_env']['status'], p['pm2_env'].get('pm_uptime'), p['pm2_env'].get('restart_time')))"
echo '== checking banner phrase in LIVE prod chunks (must be 0) =='
grep -rc "将直接影响用户可攻击次数" /var/www/app/.next/static/chunks /var/www/app/.next/server/app/admin/users 2>/dev/null | grep -v ':0$' | head
echo 'kept phrase count (must be >=1):'
grep -c "变更记录操作日志" /var/www/app/.next/static/chunks/app/admin/users/page-66d5134812f23933.js
