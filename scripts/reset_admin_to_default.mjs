/**
 * reset_admin_to_default.mjs
 *
 * One-shot operator emergency: drop any custom_admin_password_hash row
 * from PostgreSQL and re-seed the Redis negative sentinel so the login
 * immediately falls back to process.env.ADMIN_SECRET_KEY.
 *
 * Run via:
 *   node scripts/reset_admin_to_default.mjs
 *
 * Requires the same env vars (DATABASE_URL, REDIS_URL) as a normal prod
 * start. Since it lives on the host, we read from /var/www/app/.env.production.
 */
import { readFile } from 'node:fs/promises';
import { Client as SshClient } from 'ssh2';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_PATH = path.resolve(__dirname, '../keys/mercenary_h5_project.pem');
const PASSPHRASE = process.env.DEPLOY_SSH_PASSPHRASE?.trim() || undefined;

function sshExec(client, cmd) {
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

  // 1) Read DATABASE_URL & REDIS_URL from .env.production (host file).
  const { out: envText } = await sshExec(client, 'cat /var/www/app/.env.production');
  const env = Object.fromEntries(
    envText
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(l => {
        const idx = l.indexOf('=');
        if (idx < 0) return [l, ''];
        const k = l.slice(0, idx).trim();
        let v = l.slice(idx + 1).trim();
        // Strip matching quotes if present
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        return [k, v];
      })
  );

  const dbUrl = env.DATABASE_URL;
  const redisUrl = env.REDIS_URL;
  if (!dbUrl || !redisUrl) {
    throw new Error('DATABASE_URL or REDIS_URL missing in /var/www/app/.env.production');
  }
  console.log(`[RESET] dbUrl host: ${new URL(dbUrl).host}`);
  console.log(`[RESET] redisUrl host: ${new URL(redisUrl).host}`);

  // 2) Use the server's node + tsx-less inline script to do the work.
  //    We avoid installing pg/ioredis here by SSH-ing into the box and
  //    running node with a payload string that uses the same modules the
  //    app already has in node_modules.
  const script = `
import('pg').then(async ({ default: pg }) => {
  const pool = new pg.Pool({ connectionString: ${JSON.stringify(dbUrl)}, ssl: { rejectUnauthorized: false } });
  const r = await pool.query("DELETE FROM public.repark_config WHERE key = 'custom_admin_password_hash' RETURNING key, config_json");
  console.log('[PG] deleted rows:', r.rowCount);
  if (r.rowCount > 0) console.log('[PG] deleted entry:', JSON.stringify(r.rows[0]));
  await pool.end();

  const { default: IORedis } = await import('ioredis');
  const redis = new IORedis(${JSON.stringify(redisUrl)}, { tls: { rejectUnauthorized: false } });
  const c = await redis.del('repark:admin:password_hash');
  console.log('[REDIS] cache keys deleted:', c);
  await redis.quit();
});
`;

  // Write script to /var/www/app/scripts so it picks up the local node_modules
  const tmpPath = '/var/www/app/scripts/_reset_admin_inline.mjs';
  const heredoc = `cat > ${tmpPath} <<'EOF_RESET_ADMIN'
${script}
EOF_RESET_ADMIN`;
  await sshExec(client, heredoc);
  const { out: runOut, err: runErr } = await sshExec(client, `cd /var/www/app && node ${tmpPath}`);
  console.log('[SERVER OUTPUT]');
  console.log(runOut);
  if (runErr.trim()) console.error('[SERVER STDERR]', runErr);

  // 3) Verify login now works against default password.
  await new Promise(r => setTimeout(r, 1500)); // let cache settle
  const { out: login } = await sshExec(client,
    'curl -s -X POST http://localhost:3000/api/admin/login ' +
    '-H "Content-Type: application/json" ' +
    '-H "Origin: http://localhost:3000" ' +
    '-d \'{"password":"giys-agjj-niqt-yx2g"}\''
  );
  console.log('[VERIFY LOGIN]:', login);

  client.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(2); });