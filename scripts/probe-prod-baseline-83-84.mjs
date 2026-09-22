// scripts/probe-prod-baseline-83-84.mjs
// READ-ONLY baseline check for /var/www/app.
// Does NOT modify anything on the remote server.
// Captures: BUILD_ID, PM2 PID, Node/npm/Next/React versions.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client as SshClient } from 'ssh2';

const BASTION_HOST = '98.93.252.250';
const BASTION_PORT = 22;
const BASTION_USERNAME = 'ubuntu';
const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');
const PASSPHRASE = process.env.DEPLOY_SSH_PASSPHRASE?.trim() || undefined;

function log(label, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${label}] ${msg}`);
}

async function main() {
  const privateKey = await readFile(KEY_PATH, 'utf8');
  const client = new SshClient();

  client.on('ready', () => {
    log('SSH', 'Connected');
    // Single non-interactive read-only command chain.
    // Reads BUILD_ID, lists PM2 process, prints toolchain versions.
    // No writes, no restarts.
    const cmd = `
      echo '=== BUILD_ID ===';
      if [ -f /var/www/app/.next/BUILD_ID ]; then cat /var/www/app/.next/BUILD_ID; else echo 'NO_BUILD_ID'; fi;
      echo '=== PM2 LIST ===';
      pm2 list 2>/dev/null || echo 'PM2_UNAVAILABLE';
      echo '=== TOOLCHAIN ===';
      echo "node: $(node --version 2>/dev/null || echo NA)";
      echo "npm: $(npm --version 2>/dev/null || echo NA)";
      cd /var/www/app && echo "next: $(npx next --version 2>/dev/null | head -1 || echo NA)";
      if [ -f /var/www/app/package.json ]; then
        echo "react-declared: $(grep -E '\"react\"' /var/www/app/package.json | head -1)";
      fi;
      echo '=== END ==='
    `.replace(/\n/g, ' ');

    client.exec(cmd, (e, stream) => {
      if (e) { console.error('exec err:', e.message); process.exit(1); }
      let out = '';
      stream.on('data', (chunk) => { out += chunk.toString('utf8'); process.stdout.write(chunk); });
      stream.on('close', (code) => {
        log('EXEC', `Done code=${code}`);
        client.end();
      });
    });
  });

  client.on('error', (err) => {
    console.error('SSH error:', err.message);
    process.exit(1);
  });

  log('SSH', `Connecting to ${BASTION_USERNAME}@${BASTION_HOST}:${BASTION_PORT} ...`);
  client.connect({
    host: BASTION_HOST,
    port: BASTION_PORT,
    username: BASTION_USERNAME,
    privateKey,
    passphrase: PASSPHRASE,
    readyTimeout: 15000,
  });
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
