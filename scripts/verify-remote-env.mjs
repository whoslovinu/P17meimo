// scripts/verify-remote-env.mjs — Read the actual remote .env.production and test login
import { readFile } from 'node:fs/promises';
import { Client as SshClient } from 'ssh2';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_PATH = path.resolve(__dirname, '../keys/mercenary_h5_project.pem');
const PASSPHRASE = process.env.DEPLOY_SSH_PASSPHRASE?.trim() || undefined;

const BASTION_HOST = '98.93.252.250';

async function sshExec(client, cmd) {
  return new Promise((resolve, reject) => {
    client.exec(cmd, (err, stream) => {
      if (err) { reject(err); return; }
      let out = '', errOut = '';
      stream.on('close', (code) => resolve({ code, out, err: errOut }));
      stream.on('data', d => { out += d.toString(); });
      stream.stderr.on('data', d => { errOut += d.toString(); });
    });
  });
}

async function main() {
  const privateKey = await readFile(KEY_PATH, 'utf8');
  const client = new SshClient();

  await new Promise((resolve, reject) => {
    client.on('ready', resolve);
    client.on('error', reject);
    client.connect({ host: BASTION_HOST, port: 22, username: 'ubuntu', privateKey, passphrase: PASSPHRASE, readyTimeout: 30000 });
  });

  // Read the ACTUAL remote .env.production
  const { out: remoteEnv } = await sshExec(client, 'cat /var/www/app/.env.production');
  console.log('=== Remote .env.production ===');
  console.log(remoteEnv);

  // Extract ADMIN_SECRET_KEY from remote file
  const match = remoteEnv.match(/^ADMIN_SECRET_KEY=(.*)$/m);
  const remoteSecret = match ? match[1] : null;
  console.log(`\nRemote ADMIN_SECRET_KEY: "${remoteSecret}"`);

  // Also check if ecosystem.config.js has it explicitly
  const { out: ecosystem } = await sshExec(client, 'cat /var/www/app/ecosystem.config.js 2>/dev/null || echo "NOT FOUND"');
  const hasExplicit = ecosystem.includes('ADMIN_SECRET_KEY');
  console.log(`\necosystem.config.js explicitly sets ADMIN_SECRET_KEY: ${hasExplicit}`);

  // Test login
  const { out: curlOut } = await sshExec(client,
    `curl -s -X POST http://localhost:3000/api/admin/login ` +
    `-H "Content-Type: application/json" ` +
    `-d '{"password":"${remoteSecret || 'giys-agjj-niqt-yx2g'}"}'`
  );
  console.log(`\n=== Login Test ===`);
  console.log(curlOut);

  // Also test with the known correct password
  if (remoteSecret !== 'giys-agjj-niqt-yx2g') {
    const { out: curlKnown } = await sshExec(client,
      `curl -s -X POST http://localhost:3000/api/admin/login ` +
      `-H "Content-Type: application/json" ` +
      `-d '{"password":"giys-agjj-niqt-yx2g"}'`
    );
    console.log(`\n=== Login with known password "giys-agjj-niqt-yx2g" ===`);
    console.log(curlKnown);
  }

  client.end();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(2); });
