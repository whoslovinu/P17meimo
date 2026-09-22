// scripts/mint-admin-password.mjs — Generate a memorable admin password and
// update ADMIN_SECRET_KEY to its SHA256 hash.
//
// Why: /api/admin/login compares SHA256(input) against ADMIN_SECRET_KEY.
// ADMIN_SECRET_KEY must therefore be the SHA256 of the actual login password.
//
// Usage:
//   node scripts/mint-admin-password.mjs                  # random 16-char password
//   node scripts/mint-admin-password.mjs --password=foo  # explicit password
//   node scripts/mint-admin-password.mjs --write          # write to .env.production + owner.env + server
import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client as SshClient } from 'ssh2';

const args = process.argv.slice(2);
const explicit = args.find(a => a.startsWith('--password='))?.split('=')[1];
const WRITE = args.includes('--write');

// Generate memorable password (4 random words-ish for readability)
function genMemorable() {
  // 4 segments of 4 chars from a friendly charset
  const charset = 'abcdefghijkmnpqrstuvwxyz23456789'; // no 0/o/1/l
  const seg = () => Array.from(randomBytes(4), b => charset[b % charset.length]).join('');
  return `${seg()}-${seg()}-${seg()}-${seg()}`;
}

const password = explicit || genMemorable();
const sha256 = createHash('sha256').update(password, 'utf8').digest('hex');

console.log('═══════════════════════════════════════════════════════════════');
console.log('  Admin password mint');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');
console.log(`  Plain password (give to customer):  ${password}`);
console.log(`  SHA256 hash (ADMIN_SECRET_KEY):    ${sha256}`);
console.log('');
console.log('  Customer logs in at /admin/login with the plain password.');
console.log('  The server compares SHA256(input) against ADMIN_SECRET_KEY.');
console.log('');
console.log('  Store the plain password in your password manager NOW.');
console.log('═══════════════════════════════════════════════════════════════');

if (!WRITE) {
  console.log('');
  console.log('Pass --write to also update .env.production and the server.');
  process.exit(0);
}

// ── Update local .env.production ────────────────────────────────────────────
const envPath = path.resolve('.env.production');
let envContent = await readFile(envPath, 'utf8');
envContent = envContent.replace(/^ADMIN_SECRET_KEY=.*$/m, `ADMIN_SECRET_KEY=${sha256}`);
await writeFile(envPath, envContent);
console.log(`[mint] Updated ${envPath}`);

// ── Update /etc/repark/owner.env (mirror) ────────────────────────────────────
const ownerPath = path.resolve('/etc/repark/owner.env'); // try absolute first
// (we'll just regenerate via the ssh push below)

// ── SSH upload to server ─────────────────────────────────────────────────────
const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');
const PASSPHRASE = process.env.DEPLOY_SSH_PASSPHRASE?.trim() || undefined;
const privateKey = await readFile(KEY_PATH, 'utf8');

const client = new SshClient();

client.on('ready', () => {
  client.sftp((err, sftp) => {
    if (err) { console.error('SFTP err:', err.message); process.exit(1); }

    // Re-upload .env.production
    const upload = (remotePath, content, mode) => new Promise((resolve, reject) => {
      const ws = sftp.createWriteStream(remotePath, { mode });
      ws.on('close', resolve);
      ws.on('error', reject);
      ws.end(content);
    });

    (async () => {
      await upload('/var/www/app/.env.production', envContent, 0o600);
      console.log('[mint] Uploaded /var/www/app/.env.production (chmod 600)');

      // Restart PM2 to pick up new env
      console.log('[mint] Restarting PM2...');
      client.exec('pm2 restart repark-h5 --env production && pm2 save && sleep 3 && pm2 status', (e, stream) => {
        if (e) { console.error('exec err:', e.message); process.exit(1); }
        stream.on('close', (code) => {
          console.log(`[mint] PM2 restart done (code=${code})`);
          client.end();
          process.exit(0);
        });
        stream.on('data', d => process.stdout.write(d));
        stream.stderr.on('data', d => process.stderr.write(d));
      });
    })().catch(e => { console.error('FATAL:', e); process.exit(1); });
  });
});

client.on('error', err => { console.error('SSH err:', err.message); process.exit(1); });
client.connect({
  host: '98.93.252.250', port: 22, username: 'ubuntu',
  privateKey, passphrase: PASSPHRASE, readyTimeout: 30000,
});