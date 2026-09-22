const { Client: SshClient } = require('ssh2');
const fs = require('fs');
const path = require('path');
const main = async () => {
  const pk = await fs.promises.readFile(path.resolve('keys/mercenary_h5_project.pem'), 'utf8');
  const c = new SshClient();
  c.on('ready', () => {
    const cmd = [
      'echo "=== pwd ==="',
      'pwd',
      'echo "=== git status ==="',
      'cd /var/www/app 2>/dev/null && git status -sb || echo "NO_GIT_REPO"',
      'echo "=== git log -3 ==="',
      'cd /var/www/app 2>/dev/null && git log -3 --oneline || echo "NO_GIT_REPO"',
      'echo "=== diff stat (uncommitted) ==="',
      'cd /var/www/app 2>/dev/null && git diff --stat HEAD || echo "NO_GIT_REPO"',
      'echo "=== package.json scripts ==="',
      'cat /var/www/app/package.json 2>/dev/null | grep -A 30 "\\"scripts\\"" | head -40',
      'echo "=== pm2 list ==="',
      'pm2 list --no-color 2>&1 | head -40',
      'echo "=== node_modules present? ==="',
      'ls -d /var/www/app/node_modules 2>&1',
    ].join('\n');
    c.exec(cmd, (e, stream) => {
      if (e) throw e;
      stream.on('data', d => process.stdout.write(d));
      stream.stderr.on('data', d => process.stderr.write(d));
      stream.on('close', code => { c.end(); process.exit(code ?? 0); });
    });
  });
  c.on('error', e => { console.error(e); process.exit(1); });
  c.connect({ host: '98.93.252.250', port: 22, username: 'ubuntu', privateKey: pk, readyTimeout: 30000 });
};
main();