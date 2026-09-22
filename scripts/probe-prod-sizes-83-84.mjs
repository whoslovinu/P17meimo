// scripts/probe-prod-sizes-83-84.mjs
// Read-only size check on /var/www/app and /tmp free space.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client as SshClient } from 'ssh2';

const BASTION_HOST = '98.93.252.250';
const BASTION_PORT = 22;
const BASTION_USERNAME = 'ubuntu';
const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');
const PASSPHRASE = process.env.DEPLOY_SSH_PASSPHRASE?.trim() || undefined;

async function main() {
  const privateKey = await readFile(KEY_PATH, 'utf8');
  const client = new SshClient();

  client.on('ready', () => {
    const cmd = `
      echo '=== /tmp FREE ===';
      df -h /tmp | tail -1;
      echo '=== /var/www/app SIZE (excluding .next) ===';
      du -sh /var/www/app --exclude=.next 2>/dev/null;
      echo '=== /var/www/app SIZE (full) ===';
      du -sh /var/www/app 2>/dev/null;
      echo '=== /var/www/app node_modules SIZE ===';
      du -sh /var/www/app/node_modules 2>/dev/null || echo 'NO_NODE_MODULES';
      echo '=== /var/www/app/.next SIZE ===';
      du -sh /var/www/app/.next 2>/dev/null || echo 'NO_NEXT';
      echo '=== /var/www/app SOURCE FILES (count) ===';
      find /var/www/app -type f -not -path '*/node_modules/*' -not -path '*/.next/*' | wc -l;
      echo '=== /var/www/app SOURCE FILES (size) ===';
      du -shc $(find /var/www/app -type f -not -path '*/node_modules/*' -not -path '*/.next/*') 2>/dev/null | tail -1;
      echo '=== END ==='
    `.replace(/\n/g, ' ');

    client.exec(cmd, (e, stream) => {
      if (e) { console.error('exec err:', e.message); process.exit(1); }
      let out = '';
      stream.on('data', (chunk) => { out += chunk.toString('utf8'); process.stdout.write(chunk); });
      stream.on('close', (code) => {
        console.log(`\n[EXEC] code=${code}`);
        client.end();
      });
    });
  });

  client.on('error', (err) => { console.error('SSH error:', err.message); process.exit(1); });
  client.connect({
    host: BASTION_HOST, port: BASTION_PORT, username: BASTION_USERNAME,
    privateKey, passphrase: PASSPHRASE, readyTimeout: 15000,
  });
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
