// Read-only deploy verification — no mutations.
const path = require('path');
const fs = require('fs');
const { Client: SshClient } = require('ssh2');

const LOCAL_KEY = path.resolve('keys/mercenary_h5_project.pem');

async function sshExec(client, cmd, label) {
  return new Promise((resolve, reject) => {
    console.log(`[${label}] $ ${cmd}`);
    client.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      stream.on('data', d => { out += d; process.stdout.write(d); });
      stream.stderr.on('data', d => process.stderr.write(d));
      stream.on('close', code => resolve({ code, out }));
    });
  });
}

(async () => {
  const pk = await fs.promises.readFile(LOCAL_KEY, 'utf8');
  const c = new SshClient();
  c.on('ready', async () => {
    try {
      // 1) Current server code status — does it already have our fix?
      console.log('\n=== server route.ts line count & alias hint ===');
      await sshExec(c, 'wc -l /var/www/app/app/api/webhook/user-action/route.ts && grep -n "resolveAliasToUuid\\|z.union\\|resolveAlias" /var/www/app/app/api/webhook/user-action/route.ts || echo "(no resolveAliasToUuid found on server)"', 'check-route');

      console.log('\n=== server pg.ts alias function ===');
      await sshExec(c, 'grep -n "resolveAliasToUuid\\|UUID_REGEX\\|user_alias" /var/www/app/lib/db/pg.ts || echo "(not on server yet)"', 'check-pg');

      console.log('\n=== server .env production ===');
      await sshExec(c, 'grep -E "WEBHOOK_SECRET|NODE_ENV|REDIS_URL|POSTGRES" /var/www/app/.env.production | sed "s/=.*/=<REDACTED>/"', 'check-env');

      console.log('\n=== public.user_alias table on RDS ===');
      await sshExec(c, 'cd /tmp && [ -f add_alias.cjs ] && node add_alias.cjs 2>&1 | head -20 || echo "(run /tmp/add_alias.cjs to verify table)"', 'check-db');

      console.log('\n=== pm2 process ===');
      await sshExec(c, 'pm2 jlist 2>/dev/null | head -c 2000', 'pm2');

      c.end();
      process.exit(0);
    } catch (err) {
      console.error('FAIL:', err.message);
      c.end();
      process.exit(1);
    }
  });
  c.on('error', e => { console.error(e); process.exit(1); });
  c.connect({ host: '98.93.252.250', port: 22, username: 'ubuntu', privateKey: pk, readyTimeout: 30000 });
})();