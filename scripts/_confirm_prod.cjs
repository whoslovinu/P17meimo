const path = require('path');
const fs = require('fs');
const { Client: SshClient } = require('ssh2');
(async () => {
  const pk = await fs.promises.readFile(path.resolve('keys/mercenary_h5_project.pem'), 'utf8');
  const c = new SshClient();
  c.on('ready', () => {
    c.exec(`bash -c '
set -e
echo "=== pm2 status ==="
pm2 list --no-color
echo ""
echo "=== /api/time ==="
curl -s http://localhost:3000/api/time
echo ""
echo "=== /api/boss/status ==="
curl -s http://localhost:3000/api/boss/status
echo ""
echo "=== pm2 restart count ==="
pm2 jlist | node -p "JSON.parse(require(\"fs\").readFileSync(\"/dev/stdin\",\"utf8\"))[0].pm2_env.restart_time || 0"
'`, (e, stream) => {
      if (e) throw e;
      stream.on('data', d => process.stdout.write(d));
      stream.stderr.on('data', d => process.stderr.write(d));
      stream.on('close', code => { c.end(); process.exit(code ?? 0); });
    });
  });
  c.on('error', e => { console.error(e); process.exit(1); });
  c.connect({ host: '98.93.252.250', port: 22, username: 'ubuntu', privateKey: pk, readyTimeout: 30000 });
})();