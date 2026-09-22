#!/bin/bash
set -u
echo "== /api/time =="
curl -sS -w 'HTTP=%{http_code}\n' -o /tmp/time.json http://127.0.0.1:3000/api/time
cat /tmp/time.json
echo
echo "== /admin/users unauth =="
curl -sS -o /dev/null -D /tmp/admin.h -w 'HTTP=%{http_code}\n' http://127.0.0.1:3000/admin/users
head -n 1 /tmp/admin.h
echo "== BUILD_ID =="
cat /var/www/app/.next/BUILD_ID
echo "== pm2 =="
sudo -n pm2 jlist | python3 -c "import json,sys
d=json.loads(sys.stdin.read())
p=[x for x in d if x['name']=='repark-h5'][0]
print('pid=%s status=%s' % (p['pid'], p['pm2_env']['status']))"
echo "== snapshot =="
ls -d /var/www/app/.rollback/bug102r4-* | tail -1
echo "== live chunk markers =="
CHUNK=$(find /var/www/app/.next/static/chunks/app/admin/users -type f -name 'page-*.js' | head -1)
echo "CHUNK=$CHUNK"
echo "manual unlock phrase:"
grep -c '确定要解锁奖励' "$CHUNK"
echo "lock phrase:"
grep -c '确定要锁定奖励' "$CHUNK"
echo "banner new:"
grep -c '修改道具数量将直接影响用户可攻击次数，请谨慎操作' "$CHUNK"
echo "banner old (must be 0):"
grep -c '修改道具数量将直接影响用户可攻击次数，所有变更记录操作日志' "$CHUNK"
echo "ReasonModal:"
grep -c '此操作将修改用户数据，所有变更记录操作日志' "$CHUNK"
echo "ENERGY / MEDAL:"
grep -c 'ENERGY' "$CHUNK"
grep -c 'MEDAL' "$CHUNK"
echo "milestone ID column (must be 0):"
grep -c '#m[0-9]\{6,\}' "$CHUNK"
grep -c '>里程碑<' "$CHUNK"
