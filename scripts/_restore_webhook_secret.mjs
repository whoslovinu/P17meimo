// scripts/_restore_webhook_secret.mjs
// Restore the official WEBHOOK_SECRET in /var/www/app/.env.production
// Idempotent: uses sed -i to replace the value in-place.

import { Client } from 'ssh2';
import { readFileSync } from 'node:fs';

const OFFICIAL = 'YOUR_WEBHOOK_SECRET';

function sshExec(client, cmd) {
  return new Promise((resolve, reject) => {
    client.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '', errOut = '';
      stream.on('close', (code) => resolve({ code, out, err: errOut }));
      stream.on('data', d => out += d.toString());
      stream.stderr.on('data', d => errOut += d.toString());
    });
  });
}

const privateKey = readFileSync('h:/PROJECT/P17_H5meimo-demo/keys/mercenary_h5_project.pem', 'utf8');
const client = new Client();
await new Promise((res, rej) => {
  client.on('ready', res);
  client.on('error', rej);
  client.connect({ host: '98.93.252.250', port: 22, username: 'ubuntu', privateKey, readyTimeout: 30000 });
});

const ENV_FILE = '/var/www/app/.env.production';
console.log(`Restoring WEBHOOK_SECRET in ${ENV_FILE} → ${OFFICIAL.slice(0, 8)}…`);

// 1. Show current value (before)
const { out: before } = await sshExec(client, `grep '^WEBHOOK_SECRET=' ${ENV_FILE}`);
console.log(`  Before: ${before.trim()}`);

// 2. sed -i replace (escape any slashes safely — none in OFFICIAL but defensive)
const escaped = OFFICIAL.replace(/\//g, '\\/');
const sedCmd = `sudo sed -i 's/^WEBHOOK_SECRET=.*/WEBHOOK_SECRET=${escaped}/' ${ENV_FILE} 2>&1 || sed -i 's/^WEBHOOK_SECRET=.*/WEBHOOK_SECRET=${escaped}/' ${ENV_FILE}`;
const { out: sedOut, err: sedErr } = await sshExec(client, sedCmd);
console.log(`  sed: ${sedOut}${sedErr}`);

// 3. Show after value
const { out: after } = await sshExec(client, `grep '^WEBHOOK_SECRET=' ${ENV_FILE}`);
console.log(`  After:  ${after.trim()}`);

// 4. Restart PM2 (graceful)
console.log('Restarting PM2...');
const { out: pm2Out } = await sshExec(client, 'pm2 restart repark-h5 && pm2 save');
console.log(`  pm2: ${pm2Out.split('\n').slice(0, 3).join(' | ')}`);

// 5. Verify after restart
await new Promise(r => setTimeout(r, 5000));
const { out: pm2Status } = await sshExec(client, 'pm2 jlist 2>/dev/null | grep -oE \'"pm2_env":\\{[^}]*\\}\' | head -1 || true');
console.log(`  Live env (pm2 jlist): ${pm2Status.slice(0, 200)}`);

client.end();