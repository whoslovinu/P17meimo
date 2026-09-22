const { Client: SshClient } = require('ssh2');
const fs = require('fs');
const path = require('path');
const main = async () => {
  const pk = await fs.promises.readFile(path.resolve('keys/mercenary_h5_project.pem'), 'utf8');
  const c = new SshClient();
  c.on('ready', () => {
    const cmd = [
      'echo "=== /var/www structure ==="',
      'ls -la /var/www/ 2>&1 | head -20',
      'echo "=== /var/www/app top ==="',
      'ls -la /var/www/app/ 2>&1 | head -30',
      'echo "=== route.ts mtime vs others ==="',
      'ls -la --time-style=full-iso /var/www/app/app/api/webhook/user-action/route.ts /var/www/app/lib/db/pg.ts 2>&1',
      'echo "=== .next dir mtime ==="',
      'ls -la --time-style=full-iso /var/www/app/.next 2>&1 | head -5',
      'echo "=== look for deploy scripts ==="',
      'ls -la /var/www/*.sh /var/www/app/*.sh /var/www/app/scripts/*.sh /var/www/app/scripts/*.mjs /var/www/app/scripts/*.cjs 2>&1 | head -40',
      'echo "=== look for backup dirs ==="',
      'ls -d /var/www/backup* /var/www/app-backup* /var/www/app.bak* /var/www/bak* 2>/dev/null',
      'echo "=== look for cron/sync ==="',
      'crontab -l 2>&1 | head -20',
      'echo "=== sudoers-deploy hints ==="',
      'ls /home/ubuntu/.ssh/ 2>&1; cat /home/ubuntu/.ssh/authorized_keys 2>&1 | head -5',
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