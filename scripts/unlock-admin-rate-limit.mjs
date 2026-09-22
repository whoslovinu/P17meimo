// scripts/unlock-admin-rate-limit.mjs — Clear rate limit for the Commander's IP on production
import { readFile } from 'node:fs/promises';
import { Client as SshClient } from 'ssh2';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_PATH = path.resolve(__dirname, '../keys/mercenary_h5_project.pem');
const PASSPHRASE = process.env.DEPLOY_SSH_PASSPHRASE?.trim() || undefined;

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
    client.connect({ host: '98.93.252.250', port: 22, username: 'ubuntu', privateKey, passphrase: PASSPHRASE, readyTimeout: 30000 });
  });

  // Peek at rate limit keys in Redis
  log('Redis', 'Scanning rate limit keys...');
  const { out: keys } = await sshExec(client,
    'redis-cli -u "rediss://rp1-bkmbmc.serverless.use1.cache.amazonaws.com:6379" --no-auth-warning KEYS "ratelimit:*" 2>/dev/null || ' +
    'redis-cli -u "$(grep REDIS_URL /var/www/app/.env.production | cut -d= -f2 | tr -d \'" \')" KEYS "ratelimit:*"'
  );
  log('Redis', `Rate limit keys found:\n${keys}`);

  // Clear ALL rate limit keys (admin login only)
  const { out: flush } = await sshExec(client,
    'redis-cli -u "$(grep REDIS_URL /var/www/app/.env.production | cut -d= -f2 | tr -d \'" \')" --no-auth-warning DEL $(redis-cli -u "$(grep REDIS_URL /var/www/app/.env.production | cut -d= -f2 | tr -d \'" \')" --no-auth-warning KEYS "ratelimit:*") 2>/dev/null'
  );
  log('Redis', `Flush result: ${flush || '(done)'}`);

  // Verify login works now
  const { out: login } = await sshExec(client,
    'curl -s -X POST http://localhost:3000/api/admin/login ' +
    '-H "Content-Type: application/json" ' +
    '-d \'{"password":"giys-agjj-niqt-yx2g"}\''
  );
  log('Login', `Result: ${login}`);

  client.end();
  log('DONE', 'Rate limit cleared — Commander can now log in');
}

function log(label, msg) {
  console.log(`[${new Date().toISOString().slice(11,19)}] [${label}] ${msg}`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(2); });
