const path = require('path');
const fs = require('fs');
const { Client: SshClient } = require('ssh2');
(async () => {
  const pk = await fs.promises.readFile(path.resolve('keys/mercenary_h5_project.pem'), 'utf8');
  const c = new SshClient();
  c.on('ready', () => {
    c.exec(`bash -c 'set -e; echo "=== pm2 status ==="; pm2 list --no-color; echo; echo "=== ports listening ==="; ss -ltnp 2>/dev/null | grep -E ":3000|:300[0-9]" || echo "(none on 3000)"; echo; echo "=== ps for node ==="; ps -ef | grep -E "node|next" | grep -v grep | head -10; echo; echo "=== curl localhost:3000 ==="; curl -s -o /tmp/h.json -w "HTTP=%{http_code} TIME=%{time_total}\\\\n" --max-time 5 http://localhost:3000/api/health || echo "(curl failed)"; echo; echo "=== last 20 lines of out log ==="; tail -20 /var/log/repark-h5/out-0.log 2>/dev/null; echo; echo "=== last 20 lines of err log ==="; tail -20 /var/log/repark-h5/error-0.log 2>/dev/null'`, (e, stream) => {
      if (e) throw e;
      stream.on('data', d => process.stdout.write(d));
      stream.stderr.on('data', d => process.stderr.write(d));
      stream.on('close', (code) => { c.end(); process.exit(code ?? 0); });
    });
  });
  c.on('error', e => { console.error(e); process.exit(1); });
  c.connect({ host: '98.93.252.250', port: 22, username: 'ubuntu', privateKey: pk, readyTimeout: 30000 });
})();