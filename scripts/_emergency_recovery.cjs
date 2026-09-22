// EMERGENCY RECOVERY: app is down, restore backup & restart.
const path = require('path');
const fs = require('fs');
const { Client: SshClient } = require('ssh2');
(async () => {
  const pk = await fs.promises.readFile(path.resolve('keys/mercenary_h5_project.pem'), 'utf8');
  const c = new SshClient();
  c.on('ready', () => {
    c.exec(`bash -c '
set -e
echo "=== restore latest backup ==="
LATEST=$(ls -1dt /var/www/app/.backup_pre_alias_* | head -1)
echo "Restoring from $LATEST"
cp $LATEST/route.ts.bak /var/www/app/app/api/webhook/user-action/route.ts
cp $LATEST/pg.ts.bak /var/www/app/lib/db/pg.ts
echo "OK"

echo ""
echo "=== confirm restored ==="
wc -l /var/www/app/app/api/webhook/user-action/route.ts /var/www/app/lib/db/pg.ts
grep -c resolveAliasToUuid /var/www/app/lib/db/pg.ts || echo "(alias code gone)"

echo ""
echo "=== rebuild ==="
cd /var/www/app
npm run build 2>&1 | tail -15

echo ""
echo "=== pm2 delete + start fresh ==="
pm2 delete repark-h5 2>&1 || true
pm2 start npm --name repark-h5 -- run start 2>&1
sleep 6
pm2 list --no-color

echo ""
echo "=== curl health ==="
curl -s -o /tmp/h.json -w "HTTP=%{http_code} TIME=%{time_total}\\\\n" --max-time 5 http://localhost:3000/api/health
cat /tmp/h.json | head -c 200

echo ""
echo "=== port 3000 ==="
ss -ltnp 2>/dev/null | grep -E ":3000" || echo "(no port)"
'`, (e, stream) => {
      if (e) throw e;
      stream.on('data', d => process.stdout.write(d));
      stream.stderr.on('data', d => process.stderr.write(d));
      stream.on('close', (code) => { c.end(); process.exit(code ?? 0); });
    });
  });
  c.on('error', e => { console.error(e); process.exit(1); });
  c.connect({ host: '98.93.252.250', port: 22, username: 'ubuntu', privateKey: pk, readyTimeout: 30000 });
})();