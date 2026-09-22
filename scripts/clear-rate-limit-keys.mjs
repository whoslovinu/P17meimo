// scripts/clear-rate-limit-keys.mjs — Use SCAN (not KEYS) on Redis Cluster to inspect/clear rate limit keys
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

  const redisUrl = 'rediss://rp1-bkmbmc.serverless.use1.cache.amazonaws.com:6379';
  const redisAuth = 'redis-cli -u "' + redisUrl + '" --no-auth-warning';

  // Use SCAN (cluster-safe) to find rate limit keys
  console.log('=== Scanning rate limit keys via SCAN ===');
  let cursor = '0';
  let totalKeys = 0;
  const allKeys = [];

  for (let i = 0; i < 5; i++) { // max 5 SCAN iterations
    const { out } = await sshExec(client, `${redisAuth} SCAN ${cursor} MATCH ratelimit:* COUNT 100`);
    const lines = out.trim().split('\n').filter(Boolean);
    if (lines.length < 2) break;
    cursor = lines[0].trim();
    const keys = lines.slice(1).map(k => k.trim()).filter(Boolean);
    allKeys.push(...keys);
    totalKeys += keys.length;
    if (cursor === '0') break;
  }

  console.log(`Found ${totalKeys} rate limit key(s):`);
  allKeys.forEach(k => console.log('  ', k));

  if (allKeys.length > 0) {
    // Get TTL of each key
    for (const key of allKeys) {
      const { out: ttlOut } = await sshExec(client, `${redisAuth} TTL "${key}"`);
      const ttl = parseInt(ttlOut.trim(), 10);
      console.log(`  TTL of "${key}": ${ttl}s (${ttl > 0 ? 'expires in ' + ttl + 's' : 'no expiry'})`);
    }
    // Clear them
    const delCmd = allKeys.map(k => `DEL "${k}"`).join(' ');
    const { out: delOut } = await sshExec(client, `${redisAuth} ${delCmd}`);
    console.log(`Deleted keys: ${delOut}`);
  } else {
    console.log('No rate limit keys found — rate limit already cleared');
  }

  // Final login test
  const { out: login } = await sshExec(client,
    'curl -s -X POST http://localhost:3000/api/admin/login ' +
    '-H "Content-Type: application/json" ' +
    '-d \'{"password":"giys-agjj-niqt-yx2g"}\''
  );
  console.log(`\nLogin result: ${login}`);

  client.end();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(2); });
