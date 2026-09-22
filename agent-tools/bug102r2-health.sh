#!/bin/bash
set -u
echo '== /api/time =='
curl -sS -o /tmp/time.json -w 'HTTP=%{http_code}\n' http://127.0.0.1:3000/api/time
cat /tmp/time.json
echo
echo '== /admin/users unauthenticated =='
curl -sS -o /dev/null -D /tmp/admin.h -w 'HTTP=%{http_code}\n' http://127.0.0.1:3000/admin/users
head -n 1 /tmp/admin.h
echo '== prod BUILD_ID =='
cat /var/www/app/.next/BUILD_ID
echo '== pm2 =='
sudo -n pm2 jlist | python3 -c "import json,sys
d=json.loads(sys.stdin.read())
p=[x for x in d if x['name']=='repark-h5'][0]
print('name=%s pid=%s status=%s' % (p['name'], p['pid'], p['pm2_env']['status']))"
echo '== snapshot dir =='
ls -d /var/www/app/.rollback/bug-102r2-* | tail -1
echo '== live prod chunk banner check =='
NEW=$(grep -c "修改道具数量将直接影响用户可攻击次数，请谨慎操作" /var/www/app/.next/static/chunks/app/admin/users/page-dde16db337278291.js)
OLD=$(grep -c "修改道具数量将直接影响用户可攻击次数，所有变更记录操作日志" /var/www/app/.next/static/chunks/app/admin/users/page-dde16db337278291.js)
RM=$(grep -c "此操作将修改用户数据，所有变更记录操作日志" /var/www/app/.next/static/chunks/app/admin/users/page-dde16db337278291.js)
MH=$(grep -c '#m[0-9]\{6,\}' /var/www/app/.next/static/chunks/app/admin/users/page-dde16db337278291.js)
echo "NEW_BANNER_HITS=$NEW (expect 1)"
echo "OLD_BANNER_HITS=$OLD (expect 0)"
echo "REASON_MODAL_HITS=$RM (expect 1)"
echo "VISIBLE_HASHMARK_HASH_HITS=$MH (expect 0)"
