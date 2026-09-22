// scripts/_pm2_restart_with_env.mjs
// Pragmatic: parse .env.production, then invoke pm2 CLI with env inherited.
import { execSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ENV_FILE = '/var/www/app/.env.production';
const APP_DIR = '/var/www/app';
const NAME = 'repark-h5';

function parseEnv(content) {
  const out = {};
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key) out[key] = val;
  }
  return out;
}

const env = parseEnv(readFileSync(ENV_FILE, 'utf8'));
console.log(`[ENV] Parsed ${Object.keys(env).length} vars from ${ENV_FILE}`);
console.log(`[ENV] WEBHOOK_SECRET[0..20] = ${env.WEBHOOK_SECRET?.slice(0, 20)}…`);
console.log(`[ENV] NEXT_PUBLIC_TASK_THRESHOLD_RECHARGE = ${env.NEXT_PUBLIC_TASK_THRESHOLD_RECHARGE}`);
console.log(`[ENV] NODE_ENV = ${env.NODE_ENV}`);

// Step 1: delete existing
try {
  console.log('[PM2] Deleting existing process...');
  execSync(`pm2 delete ${NAME}`, { stdio: 'inherit', env: { ...process.env, ...env } });
} catch (e) {
  console.log('[PM2] (no existing process or error ignored)');
}

// Step 2: start with env via spawn
console.log('[PM2] Starting npm start with injected env...');
const child = spawn('pm2', ['start', 'npm', '--name', NAME, '--', 'start', '--update-env'], {
  cwd: APP_DIR,
  env: { ...process.env, ...env },
  stdio: 'inherit',
});

await new Promise((res, rej) => {
  child.on('close', (code) => code === 0 ? res() : rej(new Error(`pm2 exit ${code}`)));
});

console.log('[PM2] Started. Saving dump...');
execSync(`pm2 save`, { stdio: 'inherit', env: { ...process.env, ...env } });

console.log('[PM2] Done. Sleep 8s for next-server...');
await new Promise(r => setTimeout(r, 8000));

// Verify
const ps = execSync('ps -ef | grep next-server | grep -v grep').toString().trim();
console.log('--- ps (next-server) ---');
console.log(ps);

if (ps) {
  const nextLine = ps.split('\n').find(l => l.includes('next-server'));
  const pid = parseInt(nextLine.split(/\s+/)[1]);
  console.log(`[VERIFY] next-server PID: ${pid}`);
  const envOut = execSync(
    `cat /proc/${pid}/environ | sed -e 's/\\x00/\\n/g' | grep -E "^(WEBHOOK_SECRET|NODE_ENV|NEXT_PUBLIC_TASK_THRESHOLD)"`
  ).toString();
  console.log('--- env vars in next-server ---');
  console.log(envOut);
  if (!envOut.includes('WEBHOOK_SECRET')) {
    console.error('❌ WEBHOOK_SECRET still missing from next-server env!');
    process.exit(1);
  }
  console.log('✅ WEBHOOK_SECRET is present in next-server env');
}