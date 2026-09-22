const path = require('path');
const fs = require('fs');
const { Client: SshClient } = require('ssh2');
(async () => {
  const pk = await fs.promises.readFile(path.resolve('keys/mercenary_h5_project.pem'), 'utf8');
  const c = new SshClient();
  c.on('ready', () => {
    c.exec(`bash -c '
set -e
echo "=== curl /api/time ==="
curl -s http://localhost:3000/api/time
echo ""
echo "=== curl /api/boss/status ==="
curl -s http://localhost:3000/api/boss/status | head -c 200
echo ""
echo "=== current route.ts line count ==="
wc -l /var/www/app/app/api/webhook/user-action/route.ts
echo "=== current pg.ts has alias ==="
grep -c resolveAliasToUuid /var/www/app/lib/db/pg.ts || echo "0 (no alias code)"
echo "=== pm2 mode ==="
pm2 jlist | node -e "const d=require(\"fs\").readFileSync(\"/dev/stdin\",\"utf8\");const j=JSON.parse(d);console.log(JSON.stringify(j[0].pm2_env,{env_production:1,exec_mode:1,env:1},2));"
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