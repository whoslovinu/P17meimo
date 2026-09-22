// scripts/upload-env.mjs — SFTP-upload .env.production + owner.env to the server.
// Sets chmod 600 on both. Then verifies via remote ls.
//
// Usage:
//   node scripts/upload-env.mjs
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client as SshClient } from 'ssh2';

const BASTION_HOST = '98.93.252.250';
const BASTION_PORT = 22;
const BASTION_USERNAME = 'ubuntu';
const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');
const PASSPHRASE = process.env.DEPLOY_SSH_PASSPHRASE?.trim() || undefined;

const FILES = [
  { local: '.env.production', remote: '/var/www/app/.env.production', mode: 0o600 },
  // owner.env in /etc/repark — extract OWNER_COMMAND_KEY from .env.production
];

function log(label, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${label}] ${msg}`);
}

async function readOwnerKey() {
  const content = await readFile('.env.production', 'utf8');
  const m = content.match(/^OWNER_COMMAND_KEY=(.+)$/m);
  if (!m) throw new Error('OWNER_COMMAND_KEY not found in .env.production');
  return m[1].trim();
}

async function main() {
  const privateKey = await readFile(KEY_PATH, 'utf8');
  const client = new SshClient();

  client.on('ready', () => {
    log('SSH', 'Connected');
    client.sftp(async (err, sftp) => {
      if (err) { console.error('SFTP err:', err.message); process.exit(1); }

      // 1. Upload .env.production
      const envContent = await readFile('.env.production', 'utf8');
      log('SFTP', `Uploading .env.production (${envContent.length} bytes)`);
      await new Promise((resolve, reject) => {
        const ws = sftp.createWriteStream('/var/www/app/.env.production', { mode: 0o600 });
        ws.on('close', resolve);
        ws.on('error', reject);
        ws.end(envContent);
      });
      log('SFTP', '.env.production uploaded');

      // 2. Write /etc/repark/owner.env with OWNER_COMMAND_KEY
      const ownerKey = await readOwnerKey();
      const ownerEnvContent = `# Loaded by ecosystem.config.js (PM2)
# Generated: ${new Date().toISOString()}
# DO NOT share this file with the customer.

OWNER_COMMAND_KEY=${ownerKey}
`;
      log('SFTP', `Writing /etc/repark/owner.env (${ownerEnvContent.length} bytes)`);
      await new Promise((resolve, reject) => {
        const ws = sftp.createWriteStream('/etc/repark/owner.env', { mode: 0o600 });
        ws.on('close', resolve);
        ws.on('error', reject);
        ws.end(ownerEnvContent);
      });

      // 3. Verify perms via chmod
      log('SSH', 'chmod 600 + verify');
      client.exec('ls -la /var/www/app/.env.production /etc/repark/owner.env; echo ---; stat -c "%a %n" /var/www/app/.env.production /etc/repark/owner.env', (e, stream) => {
        if (e) { console.error('exec err:', e.message); process.exit(1); }
        stream.on('close', (code) => {
          log('EXEC', `done code=${code}`);
          client.end();
          process.exit(code ?? 0);
        });
        stream.on('data', d => process.stdout.write(d));
        stream.stderr.on('data', d => process.stderr.write(d));
      });
    });
  });

  client.on('error', err => { console.error('SSH err:', err.message); process.exit(1); });
  client.connect({
    host: BASTION_HOST, port: BASTION_PORT, username: BASTION_USERNAME,
    privateKey, passphrase: PASSPHRASE, readyTimeout: 30000,
  });
}

main().catch(e => { console.error('FATAL:', e.stack || e.message); process.exit(2); });