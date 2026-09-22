// scripts/fix-admin-secret.mjs — Correctly set ADMIN_SECRET_KEY to the
// plain admin password (NOT its hash). Login compares SHA256(input) with
// SHA256(ADMIN_SECRET_KEY), so for those to be equal, the input password
// must EQUAL ADMIN_SECRET_KEY (i.e. store the plain password).

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Client as SshClient } from 'ssh2';

const args = process.argv.slice(2);
const password = args.find(a => a.startsWith('--password='))?.split('=')[1];
if (!password) {
  console.error('Usage: node scripts/fix-admin-secret.mjs --password=<plain>');
  process.exit(2);
}

const sha = createHash('sha256').update(password, 'utf8').digest('hex');

console.log(`Plain password:    ${password}`);
console.log(`SHA256(password):  ${sha}`);
console.log('');
console.log('Updating .env.production → ADMIN_SECRET_KEY = plain password...');

const envPath = '.env.production';
let env = await readFile(envPath, 'utf8');
env = env.replace(/^ADMIN_SECRET_KEY=.*$/m, `ADMIN_SECRET_KEY=${password}`);
await writeFile(envPath, env);
console.log(`[fix] Updated ${envPath}`);

// Upload + restart
const KEY_PATH = 'keys/mercenary_h5_project.pem';
const PASSPHRASE = process.env.DEPLOY_SSH_PASSPHRASE?.trim() || undefined;
const privateKey = await readFile(KEY_PATH, 'utf8');

const client = new SshClient();
client.on('ready', () => {
  client.sftp((err, sftp) => {
    if (err) { console.error('SFTP err:', err.message); process.exit(1); }
    const ws = sftp.createWriteStream('/var/www/app/.env.production', { mode: 0o600 });
    ws.on('close', () => {
      console.log('[fix] Uploaded /var/www/app/.env.production');
      client.exec('pm2 start /var/www/app/ecosystem.config.js --env production && pm2 save && sleep 3 && pm2 status', (e, stream) => {
        if (e) { console.error('exec err:', e.message); process.exit(1); }
        stream.on('close', (code) => {
          console.log(`[fix] PM2 restart code=${code}`);
          client.end();
          process.exit(0);
        });
        stream.on('data', d => process.stdout.write(d));
        stream.stderr.on('data', d => process.stderr.write(d));
      });
    });
    ws.on('error', e => { console.error(e); process.exit(1); });
    ws.end(env);
  });
});
client.on('error', err => { console.error('SSH err:', err.message); process.exit(1); });
client.connect({
  host: '98.93.252.250', port: 22, username: 'ubuntu',
  privateKey, passphrase: PASSPHRASE, readyTimeout: 30000,
});